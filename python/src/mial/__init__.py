"""MIAL (MarkdownIsALisp): Python library. ONTOLOGY.md is the reference; cite its IDs."""

from __future__ import annotations

import json
import math
import sys
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Callable

STEP_LIMIT = 200000
DEPTH_LIMIT = 1000

# Host frames used per evaluation, at worst, when sizing Python's recursion limit (D-11).
FRAMES_PER_EVALUATION = 12


# ---------------------------------------------------------------- Values and nodes


# A symbol is a plain str; null is None; booleans are bool; numbers are always float.
@dataclass(frozen=True)
class Str:
    text: str


@dataclass(frozen=True)
class Err:
    message: str


@dataclass(eq=False)
class Env:
    parent: Env | None
    vars: dict[str, Node]


@dataclass(eq=False)
class Closure:
    params: list[str]
    body: list[Node]
    env: Env


@dataclass(frozen=True)
class Arity:
    is_fixed: bool
    count: int


@dataclass(eq=False)
class Builtin:
    name: str
    arity: Arity
    fn: Callable[[list[Node], Any], Node]


@dataclass(eq=False)
class Node:
    value: Any
    children: list[Node]


@dataclass(frozen=True)
class CallResult:
    ok: bool
    value: Node | None
    error: str | None


@dataclass(frozen=True)
class Definition:
    name: str
    line: int
    children: list[Node]


@dataclass(frozen=True)
class Parsed:
    defs: list[Definition]
    diagnostics: list[str]


def node(value: Any, children: list[Node]) -> Node:
    return Node(value, children)


def _atom(value: Any) -> Node:
    return Node(value, [])


def sym(name: str) -> Node:
    return _atom(name)


def str_node(text: str) -> Node:
    return _atom(Str(text))


def num(n: float) -> Node:
    x = float(n)
    return _atom(x) if math.isfinite(x) else make_error("num", "non-finite number")


def bool_node(b: bool) -> Node:
    return _atom(b)


def nil() -> Node:
    return _atom(None)


def list_node(items: list[Node]) -> Node:
    return Node(None, items)


def _ok(value: Node) -> CallResult:
    return CallResult(True, value, None)


def _fail(error: str) -> CallResult:
    return CallResult(False, None, error)


def _is_symbol_value(v: Any) -> bool:
    return isinstance(v, str)


def _is_function_value(v: Any) -> bool:
    return isinstance(v, (Closure, Builtin))


def is_error(n: Node) -> bool:
    return isinstance(n.value, Err)


def _childless(n: Node) -> bool:
    return len(n.children) == 0


def _is_null(n: Node) -> bool:
    return n.value is None and _childless(n)


def _is_list_like(n: Node) -> bool:
    return n.value is None


def _is_number(n: Node) -> bool:
    return isinstance(n.value, float) and _childless(n)


def _is_string(n: Node) -> bool:
    return isinstance(n.value, Str) and _childless(n)


def _is_symbol(n: Node) -> bool:
    return _is_symbol_value(n.value) and _childless(n)


def _is_function(n: Node) -> bool:
    return _is_function_value(n.value) and _childless(n)


def _is_field(f: Node) -> bool:
    return _is_symbol_value(f.value) and len(f.children) == 1


def _is_record(n: Node) -> bool:
    return n.value == "record" and all(_is_field(f) for f in n.children)


def is_truthy(n: Node) -> bool:
    if not _childless(n):
        return True
    v = n.value
    return not (v is None or v is False or (isinstance(v, float) and v == 0))


ATOM_TYPE_NAMES: list[tuple[Any, str]] = [
    (float, "number"),
    (bool, "boolean"),
    (Str, "string"),
    (str, "symbol"),
    ((Closure, Builtin), "function"),
    (Err, "error"),
]


def type_name(n: Node) -> str:
    if n.value is None:
        return "null" if _childless(n) else "list"
    if not _childless(n):
        return "tree"
    return next(name for kinds, name in ATOM_TYPE_NAMES if isinstance(n.value, kinds))


def make_error(symbol: str, reason: str) -> Node:
    return _atom(Err(f"{symbol}: {reason}"))


def _add_trace(err: Node, reason: str) -> Node:
    return Node(err.value, [*err.children, str_node(reason)])


def _expected(name: str, what: str, n: Node) -> Node:
    return make_error(name, f"expected {what}, got {type_name(n)}")


def fixed(n: int) -> Arity:
    return Arity(True, n)


def variadic(minimum: int) -> Arity:
    return Arity(False, minimum)


def builtin(name: str, arity: Arity, fn: Callable[[list[Node], Any], Node]) -> Builtin:
    return Builtin(name, arity, fn)


def library(builtins: list[Builtin]) -> dict[str, Builtin]:
    return {b.name: b for b in builtins}


# ---------------------------------------------------------------- Number text


def format_number(x: float) -> str:
    """ECMAScript Number::toString."""
    if x == 0:
        return "0"
    sign = "-" if x < 0 else ""
    _, digit_tuple, exponent = Decimal(repr(abs(float(x)))).as_tuple()
    digits = "".join(map(str, digit_tuple)).rstrip("0")
    point = len(digit_tuple) + exponent
    count = len(digits)
    if count <= point <= 21:
        return sign + digits + "0" * (point - count)
    if 0 < point <= 21:
        return f"{sign}{digits[:point]}.{digits[point:]}"
    if -6 < point <= 0:
        return f"{sign}0.{'0' * -point}{digits}"
    e = point - 1
    mantissa = digits if count == 1 else f"{digits[0]}.{digits[1:]}"
    return f"{sign}{mantissa}e{'+' if e >= 0 else '-'}{abs(e)}"


def _parse_number(text: str) -> float | None:
    try:
        n = float(text)
    except ValueError:
        return None
    return n if math.isfinite(n) and format_number(n) == text else None


# ---------------------------------------------------------------- Parser

WHITESPACE = " \t\r"
GAP = " \t"


def _measure_indent(line: str) -> int:
    spaces = 0
    for c in line:
        if c == " ":
            spaces += 1
        elif c == "\t":
            spaces += 2
        else:
            break
    return spaces


def _is_quoted(s: str) -> bool:
    return len(s) >= 2 and s[0] in "\"'" and s[-1] == s[0]


def _parse_literal(text: str) -> Node:
    if _is_quoted(text):
        return str_node(text[1:-1])
    if text == "null":
        return nil()
    if text == "true":
        return bool_node(True)
    if text == "false":
        return bool_node(False)
    n = _parse_number(text)
    return str_node(text) if n is None else _atom(n)


def _parse_token(token: str) -> Node:
    return _parse_literal(token[1:-1]) if token[0] == "`" else sym(token)


def _tokenize(text: str) -> tuple[list[str], bool]:
    tokens: list[str] = []
    unterminated = False
    i = 0
    while i < len(text):
        c = text[i]
        if c in GAP:
            i += 1
            continue
        if c == "`":
            close = text.find("`", i + 1)
            if close == -1:
                unterminated = True
                i += 1
                continue
            tokens.append(text[i : close + 1])
            i = close + 1
            continue
        end = i
        while end < len(text) and text[end] not in GAP and text[end] != "`":
            end += 1
        tokens.append(text[i:end])
        i = end
    return tokens, unterminated


def _parse_bullet(content: str) -> tuple[Node, bool]:
    tokens, unterminated = _tokenize(content)
    if not tokens:
        return sym(""), unterminated
    head = _parse_token(tokens[0])
    return Node(head.value, [_parse_token(t) for t in tokens[1:]]), unterminated


def _is_bullet_line(t: str) -> bool:
    return t[0] in "-*" and len(t) > 1 and t[1] in GAP


def _is_param_spec(n: Node) -> bool:
    if not _is_symbol_value(n.value):
        return False
    if _childless(n):
        return True
    return n.value == "*" and all(_is_symbol(c) for c in n.children)


def _structural_diagnostics(d: Definition, tops: list[int]) -> list[str]:
    c = d.children
    if not c:
        return [f'line {d.line}: definition "{d.name}" has no body — ignored']
    if len(c) >= 3 and _is_param_spec(c[0]) and _is_symbol(c[1]):
        return [
            f'line {tops[1]}: bare symbol "{c[1].value}" in "# {d.name}" has its value discarded'
            ' — declare several parameters with "- * a b"'
        ]
    return []


def parse(source: str) -> Parsed:
    defs: list[Definition] = []
    all_tops: list[list[int]] = []
    diagnostics: list[str] = []
    current: Definition | None = None
    tops: list[int] = []
    stack: list[tuple[Node, int]] = []

    for idx, line in enumerate(source.split("\n")):
        line_no = idx + 1
        t = line.strip(WHITESPACE)
        if not t:
            continue
        if t[0] == "#":
            current = Definition(t.lstrip("#").strip(WHITESPACE), line_no, [])
            tops = []
            defs.append(current)
            all_tops.append(tops)
            stack = []
            continue
        if not _is_bullet_line(t):
            diagnostics.append(f'line {line_no}: not a "# heading" or "- bullet" — ignored: {t}')
            continue
        if current is None:
            diagnostics.append(f'line {line_no}: bullet before any "# heading" — ignored: {t}')
            continue
        spaces = _measure_indent(line)
        level = spaces // 2
        if spaces % 2 != 0:
            diagnostics.append(
                f"line {line_no}: indentation of {spaces} space(s) is not a multiple of 2"
                f" — rounded down to level {level}"
            )
        parsed, unterminated = _parse_bullet(t[1:])
        if unterminated:
            diagnostics.append(f"line {line_no}: unterminated backtick literal")

        while stack and stack[-1][1] >= level:
            stack.pop()
        if stack:
            stack[-1][0].children.append(parsed)
        else:
            current.children.append(parsed)
            tops.append(line_no)
        stack.append((parsed, level))

    for d, d_tops in zip(defs, all_tops):
        diagnostics.extend(_structural_diagnostics(d, d_tops))
    return Parsed(defs, diagnostics)


# ---------------------------------------------------------------- Render, display, show


def _param_spec(params: list[str]) -> Node:
    if not params:
        return sym("*")
    if len(params) == 1:
        return sym(params[0])
    return Node("*", [sym(p) for p in params])


def _lambda_form(c: Closure) -> Node:
    return Node("lambda", [_param_spec(c.params), *c.body])


def _word(v: Any) -> str:
    """Text of null, a boolean or a number."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    return format_number(v)


def _format_value(v: Any) -> str:
    if v is None or isinstance(v, (bool, float)):
        return f"`{_word(v)}`"
    if isinstance(v, Str):
        return f'`"{v.text}"`'
    if isinstance(v, Err):
        return f"`ERROR: {v.message}`"
    if isinstance(v, Closure):
        return "<lambda>"
    if isinstance(v, Builtin):
        return v.name
    return v


def _inline_count(children: list[Node]) -> int:
    i = 0
    while i < len(children) and _childless(children[i]) and not isinstance(children[i].value, Closure):
        i += 1
    return i


def _render_node(n: Node, indent: int, compact: bool) -> str:
    if isinstance(n.value, Closure) and _childless(n):
        return _render_node(_lambda_form(n.value), indent, compact)
    if n.value is None and not _childless(n):
        return "\n".join(_render_node(c, indent, compact) for c in n.children)
    inline = _inline_count(n.children) if compact else 0
    head = " ".join([f"{'  ' * indent}- {_format_value(n.value)}", *(_format_value(c.value) for c in n.children[:inline])])
    return "\n".join([head, *(_render_node(c, indent + 1, compact) for c in n.children[inline:])])


def render(n: Node) -> str:
    return _render_node(n, 0, False)


def render_compact(n: Node) -> str:
    return _render_node(n, 0, True)


def _render_definition(d: Definition) -> str:
    return "\n".join([f"# {d.name}", *(render_compact(c) for c in d.children)])


def compact_source(text: str) -> str:
    return "\n\n".join(_render_definition(d) for d in parse(text).defs) + "\n"


def display(n: Node) -> str:
    if not _childless(n):
        return render_compact(n)
    v = n.value
    if isinstance(v, Str):
        return v.text
    if isinstance(v, Err):
        return f"ERROR: {v.message}"
    if isinstance(v, Closure):
        return "<lambda>"
    if isinstance(v, Builtin):
        return v.name
    return v if isinstance(v, str) else _word(v)


SHOW_ESCAPES = str.maketrans({"\\": "\\\\", '"': '\\"', "\n": "\\n", "\r": "\\r", "\t": "\\t"})


def _show_value(v: Any) -> str:
    if isinstance(v, Str):
        return f'"{v.text.translate(SHOW_ESCAPES)}"'
    if isinstance(v, Err):
        return f"<error: {v.message}>"
    if isinstance(v, Closure):
        return "<lambda>"
    if isinstance(v, Builtin):
        return v.name
    return v if isinstance(v, str) else _word(v)


def show(n: Node) -> str:
    if _childless(n):
        return _show_value(n.value)
    return "(" + " ".join([_show_value(n.value), *(show(c) for c in n.children)]) + ")"


# ---------------------------------------------------------------- Equality


def _same_value(a: Any, b: Any) -> bool:
    # The type check keeps False from equalling 0.0. Closures and builtins compare by identity.
    return type(a) is type(b) and a == b


def _deep_equal(a: Node, b: Node) -> bool:
    return (
        _same_value(a.value, b.value)
        and len(a.children) == len(b.children)
        and all(_deep_equal(x, y) for x, y in zip(a.children, b.children))
    )


# ---------------------------------------------------------------- Interpreter


class Abort(Exception):
    def __init__(self, kind: str) -> None:
        super().__init__(kind)
        self.kind = kind


def _lookup(env: Env, name: str) -> Node:
    e: Env | None = env
    while e is not None:
        found = e.vars.get(name)
        if found is not None:
            return found
        e = e.parent
    return make_error(name, "undefined symbol")


def _extract_params(spec: Node) -> list[str]:
    if not _childless(spec):
        return [c.value for c in spec.children]
    return [] if spec.value == "*" else [spec.value]


def _bind_definition(d: Definition, env: Env) -> None:
    c = d.children
    if not c:
        return
    if len(c) == 1 and _childless(c[0]) and not _is_symbol_value(c[0].value):
        env.vars[d.name] = c[0]
        return
    if len(c) >= 2 and _is_param_spec(c[0]):
        env.vars[d.name] = _atom(Closure(_extract_params(c[0]), c[1:], env))
    else:
        env.vars[d.name] = _atom(Closure([], c, env))


def _form_mial(it: Interpreter, n: Node, env: Env) -> Node:
    return n.children[0]


def _form_eval(it: Interpreter, n: Node, env: Env) -> Node:
    inner = it.evaluate(n.children[0], env)
    return _add_trace(inner, "in eval") if is_error(inner) else it.evaluate(inner, env)


def _form_if(it: Interpreter, n: Node, env: Env) -> Node:
    test = it.evaluate(n.children[0], env)
    if is_error(test):
        return _add_trace(test, "in if condition")
    index = 1 if is_truthy(test) else 2
    return it.evaluate(n.children[index], env) if index < len(n.children) else nil()


def _form_let(it: Interpreter, n: Node, env: Env) -> Node:
    local = Env(env, {})
    for binding in n.children[0].children:
        if not _is_symbol_value(binding.value):
            return make_error("let", f"binding {_format_value(binding.value)} must be a symbol")
        val = it.evaluate(binding.children[0], local) if binding.children else nil()
        if is_error(val):
            return _add_trace(val, f"in let binding {binding.value}")
        local.vars[binding.value] = val
    return it.evaluate_body(n.children[1:], local)


def _form_lambda(it: Interpreter, n: Node, env: Env) -> Node:
    if not _is_param_spec(n.children[0]):
        return make_error("lambda", "invalid parameter spec")
    return _atom(Closure(_extract_params(n.children[0]), n.children[1:], env))


def _form_and(it: Interpreter, n: Node, env: Env) -> Node:
    for c in n.children:
        v = it.evaluate(c, env)
        if is_error(v):
            return _add_trace(v, "in and")
        if not is_truthy(v):
            return bool_node(False)
    return bool_node(True)


def _form_or(it: Interpreter, n: Node, env: Env) -> Node:
    for c in n.children:
        v = it.evaluate(c, env)
        if is_error(v):
            return _add_trace(v, "in or")
        if is_truthy(v):
            return bool_node(True)
    return bool_node(False)


def _form_call(it: Interpreter, n: Node, env: Env) -> Node:
    proc = it.evaluate(n.children[0], env)
    if is_error(proc):
        return _add_trace(proc, "in call")
    args = it.evaluate_args(n.children[1:], env, "call")
    return it.apply(proc, args, "call") if isinstance(args, list) else args


def _form_error_p(it: Interpreter, n: Node, env: Env) -> Node:
    return bool_node(is_error(it.evaluate(n.children[0], env)))


SPECIAL_FORMS = {
    "mial": _form_mial,
    "eval": _form_eval,
    "if": _form_if,
    "let": _form_let,
    "lambda": _form_lambda,
    "and": _form_and,
    "or": _form_or,
    "call": _form_call,
    "error?": _form_error_p,
}


def _shape_args(args: list[Node], is_fixed: bool, count: int) -> list[Node]:
    shaped = list(args[:count]) if is_fixed else list(args)
    while len(shaped) < count:
        shaped.append(nil())
    return shaped


def _error_text(n: Node) -> str:
    message = n.value.message
    if not n.children:
        return message
    return f"{message} ({' ← '.join(display(c) for c in n.children)})"


class Interpreter:
    def __init__(
        self,
        source: str,
        *,
        libraries: list[dict[str, Builtin]],
        log: Callable[[str], None],
        step_limit: int,
        depth_limit: int,
    ) -> None:
        parsed = parse(source)
        self.diagnostics = parsed.diagnostics
        self.names = [d.name for d in parsed.defs]
        self.log = log
        self.step_limit = step_limit
        self.depth_limit = depth_limit
        self.steps = 0
        self.depth = 0
        self.globals = Env(None, {})
        for lib in [CORE, *libraries]:
            for name, b in lib.items():
                self.globals.vars[name] = _atom(b)
        for d in parsed.defs:
            _bind_definition(d, self.globals)

    def evaluate(self, n: Node, env: Env) -> Node:
        self.steps += 1
        if self.steps > self.step_limit:
            raise Abort("steps")
        self.depth += 1
        if self.depth > self.depth_limit:
            raise Abort("depth")
        result = self._dispatch(n, env)
        self.depth -= 1
        return result

    def _dispatch(self, n: Node, env: Env) -> Node:
        if is_error(n):
            return n
        op = n.value
        if _childless(n):
            return _lookup(env, op) if _is_symbol_value(op) else n
        if not _is_symbol_value(op):
            return make_error(_format_value(op), "not a function")
        form = SPECIAL_FORMS.get(op)
        if form is not None:
            return form(self, n, env)
        proc = _lookup(env, op)
        if is_error(proc):
            return proc
        args = self.evaluate_args(n.children, env, op)
        return self.apply(proc, args, op) if isinstance(args, list) else args

    def evaluate_args(self, children: list[Node], env: Env, op_name: str) -> list[Node] | Node:
        """The argument list, or an error node for the first failing argument."""
        args: list[Node] = []
        for child in children:
            v = self.evaluate(child, env)
            if is_error(v):
                return _add_trace(v, f"in argument to {op_name}")
            args.append(v)
        return args

    def evaluate_body(self, body: list[Node], env: Env) -> Node:
        result = nil()
        for n in body:
            result = self.evaluate(n, env)
            if is_error(result):
                return _add_trace(result, "in body")
        return result

    def apply(self, proc: Node, args: list[Node], op_name: str) -> Node:
        v = proc.value
        if isinstance(v, Closure):
            local = Env(v.env, dict(zip(v.params, _shape_args(args, True, len(v.params)))))
            result = self.evaluate_body(v.body, local)
            return _add_trace(result, f"in call to {op_name}") if is_error(result) else result
        if isinstance(v, Builtin):
            result = v.fn(_shape_args(args, v.arity.is_fixed, v.arity.count), self)
            return _add_trace(result, f"in {op_name}") if is_error(result) else result
        return make_error(op_name, "not a function")

    def call(self, name: str, args: list[Node]) -> CallResult:
        proc = self.globals.vars.get(name)
        if proc is None:
            return _fail(f'missing definition "# {name}"')
        self.steps = 0
        self.depth = 0
        previous_limit = sys.getrecursionlimit()
        sys.setrecursionlimit(max(previous_limit, self.depth_limit * FRAMES_PER_EVALUATION))
        try:
            return self._call_proc(proc, name, args)
        except Abort as abort:
            return _fail(self._abort_text(abort, name))
        except Exception as e:
            return _fail(f'"# {name}" crashed: {e}')
        finally:
            sys.setrecursionlimit(previous_limit)

    def _call_proc(self, proc: Node, name: str, args: list[Node]) -> CallResult:
        if not _is_function(proc):
            return _ok(proc) if not args else _fail(f'"# {name}" is not a function')
        result = self.apply(proc, args, name)
        return _fail(_error_text(result)) if is_error(result) else _ok(result)

    def run(self) -> CallResult:
        return self.call("main", [])

    def _abort_text(self, abort: Abort, name: str) -> str:
        if abort.kind == "steps":
            return f'"# {name}" exceeded the step budget of {self.step_limit} evaluations'
        return f'"# {name}" recursed too deeply (depth limit {self.depth_limit})'


def load(
    source: str,
    *,
    libraries: list[dict[str, Builtin]],
    log: Callable[[str], None],
    step_limit: int,
    depth_limit: int,
) -> Interpreter:
    return Interpreter(source, libraries=libraries, log=log, step_limit=step_limit, depth_limit=depth_limit)


# ---------------------------------------------------------------- Core library


def _first_non_number(args: list[Node]) -> Node | None:
    return next((a for a in args if not _is_number(a)), None)


def _finite(name: str, x: float) -> Node:
    return _atom(x) if math.isfinite(x) else make_error(name, "non-finite result")


def _numeric(name: str, arity: Arity, compute: Callable[[list[float]], float]) -> Builtin:
    """A builtin over numbers: type-checks every argument, then checks the result is finite."""

    def fn(args: list[Node], ctx: Any) -> Node:
        bad = _first_non_number(args)
        if bad is not None:
            return _expected(name, "number", bad)
        return _finite(name, compute([a.value for a in args]))

    return builtin(name, arity, fn)


def _comparison(name: str, test: Callable[[float, float], bool]) -> Builtin:
    def fn(args: list[Node], ctx: Any) -> Node:
        bad = _first_non_number(args)
        return _expected(name, "number", bad) if bad is not None else bool_node(test(args[0].value, args[1].value))

    return builtin(name, fixed(2), fn)


def _fold(ns: list[float], step: Callable[[float, float], float], start: float) -> float:
    # A plain loop: builtin sum() uses compensated summation on newer Pythons, breaking G-1.
    total = start
    for n in ns:
        total = step(total, n)
    return total


def _plus(args: list[Node], ctx: Any) -> Node:
    bad = next((a for a in args if not _is_number(a) and not _is_string(a)), None)
    if bad is not None:
        return _expected("+", "number or string", bad)
    if any(_is_string(a) for a in args):
        return str_node("".join(display(a) for a in args))
    return _finite("+", _fold([a.value for a in args], lambda a, b: a + b, 0.0))


def _divide(args: list[Node], ctx: Any) -> Node:
    bad = _first_non_number(args)
    if bad is not None:
        return _expected("/", "number", bad)
    nums = [a.value for a in args]
    divisors = nums if len(nums) == 1 else nums[1:]
    if any(d == 0 for d in divisors):
        return make_error("/", "division by zero")
    return _finite("/", _fold(divisors, lambda a, b: a / b, 1.0 if len(nums) == 1 else nums[0]))


def _remainder(args: list[Node], ctx: Any) -> Node:
    bad = _first_non_number(args)
    if bad is not None:
        return _expected("%", "number", bad)
    if args[1].value == 0:
        return make_error("%", "division by zero")
    return _finite("%", math.fmod(args[0].value, args[1].value))


def _make_mial(args: list[Node], ctx: Any) -> Node:
    tag, kids = args
    if not _is_list_like(kids):
        return _expected("make-mial", "list", kids)
    return Node(tag.value.text if isinstance(tag.value, Str) else tag.value, list(kids.children))


def _mial_of(args: list[Node], ctx: Any) -> Node:
    f = args[0]
    if isinstance(f.value, Builtin):
        return make_error("mial-of", "builtins have no MIAL source")
    if not isinstance(f.value, Closure):
        return f
    c = f.value
    if c.params:
        return _lambda_form(c)
    return c.body[0] if len(c.body) == 1 else list_node(list(c.body))


def _cons(args: list[Node], ctx: Any) -> Node:
    tail = args[-1]
    for a in reversed(args[:-1]):
        tail = list_node([a, *tail.children]) if _is_list_like(tail) else list_node([a, tail])
    return tail


def _cdr(args: list[Node], ctx: Any) -> Node:
    n = args[0]
    if _childless(n) and n.value is not None:
        return _expected("cdr", "list", n)
    return nil() if len(n.children) <= 1 else list_node(n.children[1:])


def _parse_mial(args: list[Node], ctx: Any) -> Node:
    code = args[0]
    if not _is_string(code):
        return _expected("parse-mial", "string", code)
    return Node("program", [Node(d.name, d.children) for d in parse(code.value.text).defs])


def _print(args: list[Node], ctx: Any) -> Node:
    out = " ".join(display(a) for a in args)
    ctx.log(out)
    return str_node(out)


def _print_mial(args: list[Node], ctx: Any) -> Node:
    ctx.log(render(args[0]))
    return args[0]


def _car(args: list[Node], ctx: Any) -> Node:
    n = args[0]
    return make_error("car", "empty list") if _childless(n) else n.children[0]


def _subtract(ns: list[float]) -> float:
    return -ns[0] if len(ns) == 1 else _fold(ns[1:], lambda a, b: a - b, ns[0])


CORE = library(
    [
        builtin("+", variadic(0), _plus),
        _numeric("-", variadic(1), _subtract),
        _numeric("*", variadic(0), lambda ns: _fold(ns, lambda a, b: a * b, 1.0)),
        builtin("/", variadic(1), _divide),
        builtin("%", fixed(2), _remainder),
        _comparison("<", lambda a, b: a < b),
        _comparison("<=", lambda a, b: a <= b),
        _comparison(">", lambda a, b: a > b),
        _comparison(">=", lambda a, b: a >= b),
        builtin("eq", fixed(2), lambda args, ctx: bool_node(_deep_equal(args[0], args[1]))),
        builtin("!=", fixed(2), lambda args, ctx: bool_node(not _deep_equal(args[0], args[1]))),
        builtin("not", fixed(1), lambda args, ctx: bool_node(not is_truthy(args[0]))),
        builtin("null?", fixed(1), lambda args, ctx: bool_node(_is_null(args[0]))),
        builtin("atom?", fixed(1), lambda args, ctx: bool_node(_childless(args[0]))),
        builtin("list?", fixed(1), lambda args, ctx: bool_node(args[0].value is None and not _childless(args[0]))),
        builtin("tag", fixed(1), lambda args, ctx: _atom(args[0].value)),
        builtin("children", fixed(1), lambda args, ctx: nil() if _childless(args[0]) else list_node(list(args[0].children))),
        builtin("make-mial", fixed(2), _make_mial),
        builtin("mial-of", fixed(1), _mial_of),
        builtin("car", fixed(1), _car),
        builtin("cdr", fixed(1), _cdr),
        builtin("cons", variadic(1), _cons),
        builtin("list", variadic(0), lambda args, ctx: list_node(args)),
        builtin("print", variadic(0), _print),
        builtin("print-mial", fixed(1), _print_mial),
        builtin("parse-mial", fixed(1), _parse_mial),
    ]
)


# ---------------------------------------------------------------- Host library


def _is_key(n: Node) -> bool:
    return _is_string(n) or _is_symbol(n)


def _key_text(n: Node) -> str:
    return n.value.text if isinstance(n.value, Str) else n.value


def _is_record_like(n: Node) -> bool:
    return _is_record(n) or _is_null(n)


def _find_field(r: Node, key: str) -> Node | None:
    return next((f for f in r.children if f.value == key), None)


def _record(args: list[Node], ctx: Any) -> Node:
    fields: list[Node] = []
    for i in range(0, len(args), 2):
        if not _is_key(args[i]):
            return _expected("record", "key", args[i])
        fields.append(Node(_key_text(args[i]), [args[i + 1] if i + 1 < len(args) else nil()]))
    return Node("record", fields)


def _get(args: list[Node], ctx: Any) -> Node:
    r, k = args
    if not _is_record_like(r):
        return _expected("get", "record", r)
    if not _is_key(k):
        return _expected("get", "key", k)
    f = _find_field(r, _key_text(k))
    return f.children[0] if f is not None else nil()


def _put(args: list[Node], ctx: Any) -> Node:
    r, k, v = args
    if not _is_record_like(r):
        return _expected("put", "record", r)
    if not _is_key(k):
        return _expected("put", "key", k)
    key = _key_text(k)
    updated = Node(key, [v])
    if _find_field(r, key) is None:
        return Node("record", [*r.children, updated])
    return Node("record", [updated if f.value == key else f for f in r.children])


def _has(args: list[Node], ctx: Any) -> Node:
    r, k = args
    if not _is_record_like(r):
        return _expected("has?", "record", r)
    if not _is_key(k):
        return _expected("has?", "key", k)
    return bool_node(_find_field(r, _key_text(k)) is not None)


def _keys(args: list[Node], ctx: Any) -> Node:
    r = args[0]
    if not _is_record_like(r):
        return _expected("keys", "record", r)
    return list_node([str_node(f.value) for f in r.children]) if r.children else nil()


def _length(args: list[Node], ctx: Any) -> Node:
    x = args[0]
    if _is_string(x):
        return num(len(x.value.text))
    if _is_list_like(x):
        return num(len(x.children))
    return _expected("length", "list or string", x)


def _nth(args: list[Node], ctx: Any) -> Node:
    items, i = args
    if not _is_list_like(items):
        return _expected("nth", "list", items)
    if not _is_number(i):
        return _expected("nth", "number", i)
    x = i.value
    if x != math.floor(x) or x < 0 or x >= len(items.children):
        return nil()
    return items.children[int(x)]


def _append(args: list[Node], ctx: Any) -> Node:
    bad = next((a for a in args if not _is_list_like(a)), None)
    if bad is not None:
        return _expected("append", "list", bad)
    items = [c for a in args for c in a.children]
    return list_node(items) if items else nil()


def _check_function_and_list(name: str, f: Node, items: Node) -> Node | None:
    if not _is_function(f):
        return _expected(name, "function", f)
    if not _is_list_like(items):
        return _expected(name, "list", items)
    return None


def _map(args: list[Node], ctx: Any) -> Node:
    f, items = args
    bad = _check_function_and_list("map", f, items)
    if bad is not None:
        return bad
    out: list[Node] = []
    for x in items.children:
        r = ctx.apply(f, [x], "map")
        if is_error(r):
            return r
        out.append(r)
    return list_node(out) if out else nil()


def _filter(args: list[Node], ctx: Any) -> Node:
    f, items = args
    bad = _check_function_and_list("filter", f, items)
    if bad is not None:
        return bad
    out: list[Node] = []
    for x in items.children:
        r = ctx.apply(f, [x], "filter")
        if is_error(r):
            return r
        if is_truthy(r):
            out.append(x)
    return list_node(out) if out else nil()


def _reduce(args: list[Node], ctx: Any) -> Node:
    f, acc, items = args
    bad = _check_function_and_list("reduce", f, items)
    if bad is not None:
        return bad
    for x in items.children:
        acc = ctx.apply(f, [acc, x], "reduce")
        if is_error(acc):
            return acc
    return acc


def _round_half_up(x: float) -> float:
    low = float(math.floor(x))
    return low + 1 if x - low >= 0.5 else low


def _pick(ns: list[float], better: Callable[[float, float], bool]) -> float:
    best = ns[0]
    for n in ns[1:]:
        if better(n, best):
            best = n
    return best


def _clamp(ns: list[float]) -> float:
    x, lo, hi = ns
    raised = x if x > lo else lo
    return raised if raised < hi else hi


def _text(args: list[Node], ctx: Any) -> Node:
    items = [c for a in args for c in (a.children if _is_list_like(a) else [a])]
    return str_node("\n".join(display(i) for i in items))


def _join(args: list[Node], ctx: Any) -> Node:
    items, sep = args
    if not _is_list_like(items):
        return _expected("join", "list", items)
    if not _is_string(sep) and not _is_null(sep):
        return _expected("join", "string", sep)
    return str_node(("" if _is_null(sep) else sep.value.text).join(display(c) for c in items.children))


HOST = library(
    [
        builtin("record", variadic(0), _record),
        builtin("get", fixed(2), _get),
        builtin("put", fixed(3), _put),
        builtin("has?", fixed(2), _has),
        builtin("keys", fixed(1), _keys),
        builtin("length", fixed(1), _length),
        builtin("nth", fixed(2), _nth),
        builtin("append", variadic(0), _append),
        builtin("map", fixed(2), _map),
        builtin("filter", fixed(2), _filter),
        builtin("reduce", fixed(3), _reduce),
        _numeric("min", variadic(1), lambda ns: _pick(ns, lambda a, b: a < b)),
        _numeric("max", variadic(1), lambda ns: _pick(ns, lambda a, b: a > b)),
        _numeric("abs", fixed(1), lambda ns: abs(ns[0])),
        _numeric("floor", fixed(1), lambda ns: float(math.floor(ns[0]))),
        _numeric("round", fixed(1), lambda ns: _round_half_up(ns[0])),
        _numeric("clamp", fixed(3), _clamp),
        builtin("str", fixed(1), lambda args, ctx: str_node(display(args[0]))),
        builtin("text", variadic(0), _text),
        builtin("join", fixed(2), _join),
    ]
)


# ---------------------------------------------------------------- Plain data


def from_plain(data: Any) -> Node:
    if data is None:
        return nil()
    if isinstance(data, str):
        return str_node(data)
    if isinstance(data, bool):
        return bool_node(data)
    if isinstance(data, (int, float)):
        return num(data)
    if isinstance(data, list):
        return list_node([from_plain(x) for x in data]) if data else nil()
    if not all(isinstance(k, str) for k in data):
        raise TypeError("from_plain: object keys must be strings")
    return Node("record", [Node(k, [from_plain(v)]) for k, v in data.items()])


def to_plain(n: Node) -> Any:
    if _is_record(n):
        return {f.value: to_plain(f.children[0]) for f in n.children}
    if n.value is None:
        return [to_plain(c) for c in n.children] if n.children else None
    if not _childless(n):
        return show(n)
    v = n.value
    if isinstance(v, Err):
        return {"error": v.message}
    return v if isinstance(v, (bool, float)) else display(n)


# ---------------------------------------------------------------- Serialize


def _json_text(s: str) -> str:
    return json.dumps(s, ensure_ascii=False)


def _serialize_value(v: Any) -> str:
    if v is None or isinstance(v, (bool, float)):
        return _word(v)
    if isinstance(v, Str):
        return '{"string":' + _json_text(v.text) + "}"
    if isinstance(v, Err):
        return '{"error":' + _json_text(v.message) + "}"
    if isinstance(v, Closure):
        return _json_text("<lambda>")
    if isinstance(v, Builtin):
        return _json_text(v.name)
    return _json_text(v)


def serialize(n: Node) -> str:
    children = ",".join(serialize(c) for c in n.children)
    return '{"value":' + _serialize_value(n.value) + ',"children":[' + children + "]}"


class _NotANode(Exception):
    pass


def _is_well_formed(s: str) -> bool:
    """A lone surrogate is not a code point (Value), so it can't be text."""
    return not any("\ud800" <= c <= "\udfff" for c in s)


def _decode_text(s: Any) -> str:
    if not isinstance(s, str) or not _is_well_formed(s):
        raise _NotANode
    return s


def _decode_value(v: Any) -> Any:
    if v is None or isinstance(v, bool):
        return v
    if isinstance(v, str):
        return _decode_text(v)
    if isinstance(v, (int, float)):
        if not math.isfinite(v):
            raise _NotANode
        return float(v)
    if isinstance(v, dict) and len(v) == 1:
        if "string" in v:
            return Str(_decode_text(v["string"]))
        if "error" in v:
            return Err(_decode_text(v["error"]))
    raise _NotANode


def _decode_node(data: Any) -> Node:
    if not isinstance(data, dict) or len(data) != 2 or "value" not in data or not isinstance(data.get("children"), list):
        raise _NotANode
    return Node(_decode_value(data["value"]), [_decode_node(c) for c in data["children"]])


def deserialize(text: str) -> CallResult:
    try:
        return _ok(_decode_node(json.loads(text)))
    except (ValueError, _NotANode, RecursionError, OverflowError):
        return _fail("not a serialized node")
