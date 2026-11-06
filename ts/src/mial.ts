/**
 * MIAL (MarkdownIsALisp): TypeScript library. ONTOLOGY.md is the reference; cite its IDs.
 * A hand-written implementation, independent of js/ (D-3).
 */

export const STEP_LIMIT = 200000;
export const DEPTH_LIMIT = 1000;

/* ---------------------------------------------------------------- Values and nodes */

export class Str { text: string; constructor(text: string) { this.text = text; } }
export class Err { message: string; constructor(message: string) { this.message = message; } }

export type Env = { parent: Env | null; vars: Map<string, Node> };

export class Closure {
  params: string[];
  body: Node[];
  env: Env;
  constructor(params: string[], body: Node[], env: Env) { this.params = params; this.body = body; this.env = env; }
}

export type Arity = { fixed: boolean; count: number };
export type Context = { apply(proc: Node, args: Node[], opName: string): Node; log(text: string): void };
export type BuiltinFn = (args: Node[], ctx: Context) => Node;

export class Builtin {
  name: string;
  arity: Arity;
  fn: BuiltinFn;
  constructor(name: string, arity: Arity, fn: BuiltinFn) { this.name = name; this.arity = arity; this.fn = fn; }
}

// A symbol is a plain string.
export type Value = null | boolean | number | string | Str | Err | Closure | Builtin;
export type Node = { value: Value; children: Node[] };
export type Library = Map<string, Builtin>;
export type CallResult = { ok: true; value: Node } | { ok: false; error: string };
export type Definition = { name: string; line: number; children: Node[] };
export type Plain = null | boolean | number | string | Plain[] | { [key: string]: Plain };

export const node = (value: Value, children: Node[]): Node => ({ value, children });
const atom = (value: Value): Node => node(value, []);
export const sym = (name: string): Node => atom(name);
export const str = (text: string): Node => atom(new Str(text));
export const num = (n: number): Node => atom(n);
export const bool = (b: boolean): Node => atom(b);
export const nil = (): Node => atom(null);
export const list = (items: Node[]): Node => node(null, items);

const isSymbolValue = (v: Value): v is string => typeof v === 'string';
const isFunctionValue = (v: Value): v is Closure | Builtin => v instanceof Closure || v instanceof Builtin;
export const isError = (n: Node): boolean => n.value instanceof Err;
const isChildless = (n: Node): boolean => n.children.length === 0;
const isNull = (n: Node): boolean => n.value === null && isChildless(n);
const isListLike = (n: Node): boolean => n.value === null;
const isNumber = (n: Node): boolean => typeof n.value === 'number' && isChildless(n);
const isString = (n: Node): boolean => n.value instanceof Str && isChildless(n);
const isSymbol = (n: Node): boolean => isSymbolValue(n.value) && isChildless(n);
const isFunction = (n: Node): boolean => isFunctionValue(n.value) && isChildless(n);
const isRecord = (n: Node): boolean => n.value === 'record';
const numberOf = (n: Node): number => n.value as number;
const textOf = (n: Node): string => (n.value as Str).text;
export const isTruthy = (n: Node): boolean => !(isChildless(n) && (n.value === false || n.value === null || n.value === 0));

const atomTypeName = (v: Value): string => {
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (v instanceof Str) return 'string';
  if (isSymbolValue(v)) return 'symbol';
  if (isFunctionValue(v)) return 'function';
  return 'error';
};

export const typeName = (n: Node): string => {
  if (n.value === null) return isChildless(n) ? 'null' : 'list';
  return isChildless(n) ? atomTypeName(n.value) : 'tree';
};

export const makeError = (symbol: string, reason: string): Node => atom(new Err(`${symbol}: ${reason}`));
const addTrace = (err: Node, reason: string): Node => node(err.value, [...err.children, str(reason)]);
const expected = (name: string, what: string, n: Node): Node => makeError(name, `expected ${what}, got ${typeName(n)}`);

export const fixed = (n: number): Arity => ({ fixed: true, count: n });
export const variadic = (min: number): Arity => ({ fixed: false, count: min });
export const builtin = (name: string, arity: Arity, fn: BuiltinFn): Builtin => new Builtin(name, arity, fn);
export const library = (builtins: Builtin[]): Library => new Map(builtins.map((b): [string, Builtin] => [b.name, b]));

/* ---------------------------------------------------------------- Number text */

export const formatNumber = (n: number): string => String(n);

const parseNumber = (text: string): number | null => {
  if (text === '') return null;
  const n = Number(text);
  return Number.isFinite(n) && formatNumber(n) === text ? n : null;
};

/* ---------------------------------------------------------------- Parser */

const isWs = (c: string): boolean => c === ' ' || c === '\t' || c === '\r';
const isGap = (c: string): boolean => c === ' ' || c === '\t';

const trimWs = (s: string): string => {
  let start = 0;
  let end = s.length;
  while (start < end && isWs(s[start])) start++;
  while (end > start && isWs(s[end - 1])) end--;
  return s.slice(start, end);
};

const measureIndent = (line: string): number => {
  let spaces = 0;
  for (const c of line) {
    if (c === ' ') spaces += 1;
    else if (c === '\t') spaces += 2;
    else break;
  }
  return spaces;
};

const isQuoted = (s: string): boolean => s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0];

const parseLiteral = (text: string): Node => {
  if (isQuoted(text)) return str(text.slice(1, -1));
  if (text === 'null') return nil();
  if (text === 'true') return bool(true);
  if (text === 'false') return bool(false);
  const n = parseNumber(text);
  return n === null ? str(text) : num(n);
};

const parseToken = (token: string): Node => (token[0] === '`' ? parseLiteral(token.slice(1, -1)) : sym(token));

const tokenize = (text: string): { tokens: string[]; unterminated: boolean } => {
  const tokens: string[] = [];
  let unterminated = false;
  let i = 0;
  while (i < text.length) {
    if (isGap(text[i])) { i++; continue; }
    if (text[i] === '`') {
      const close = text.indexOf('`', i + 1);
      if (close === -1) { unterminated = true; i++; continue; }
      tokens.push(text.slice(i, close + 1));
      i = close + 1;
      continue;
    }
    let end = i;
    while (end < text.length && !isGap(text[end]) && text[end] !== '`') end++;
    tokens.push(text.slice(i, end));
    i = end;
  }
  return { tokens, unterminated };
};

const parseBullet = (content: string): { parsed: Node; unterminated: boolean } => {
  const { tokens, unterminated } = tokenize(content);
  if (tokens.length === 0) return { parsed: sym(''), unterminated };
  const head = parseToken(tokens[0]);
  return { parsed: node(head.value, tokens.slice(1).map(parseToken)), unterminated };
};

const isBulletLine = (t: string): boolean => (t[0] === '-' || t[0] === '*') && t.length > 1 && isGap(t[1]);

const headingName = (t: string): string => {
  let i = 0;
  while (t[i] === '#') i++;
  return trimWs(t.slice(i));
};

const isParamSpec = (n: Node): boolean => {
  if (!isSymbolValue(n.value)) return false;
  if (isChildless(n)) return true;
  return n.value === '*' && n.children.every(isSymbol);
};

const structuralDiagnostics = (def: Definition, tops: number[]): string[] => {
  if (def.children.length === 0) return [`line ${def.line}: definition "${def.name}" has no body — ignored`];
  const c = def.children;
  if (c.length >= 3 && isParamSpec(c[0]) && isSymbol(c[1])) {
    return [`line ${tops[1]}: bare symbol "${c[1].value as string}" in "# ${def.name}" has its value discarded — declare several parameters with "- * a b"`];
  }
  return [];
};

export const parse = (source: string): { defs: Definition[]; diagnostics: string[] } => {
  const defs: Definition[] = [];
  const allTops: number[][] = [];
  const diagnostics: string[] = [];
  let current: Definition | null = null;
  let tops: number[] = [];
  let stack: { parsed: Node; level: number }[] = [];

  source.split('\n').forEach((line, idx) => {
    const lineNo = idx + 1;
    const t = trimWs(line);
    if (t.length === 0) return;
    if (t[0] === '#') {
      current = { name: headingName(t), line: lineNo, children: [] };
      tops = [];
      defs.push(current);
      allTops.push(tops);
      stack = [];
      return;
    }
    if (!isBulletLine(t)) {
      diagnostics.push(`line ${lineNo}: not a "# heading" or "- bullet" — ignored: ${t}`);
      return;
    }
    if (current === null) {
      diagnostics.push(`line ${lineNo}: bullet before any "# heading" — ignored: ${t}`);
      return;
    }
    const spaces = measureIndent(line);
    const level = Math.floor(spaces / 2);
    if (spaces % 2 !== 0) {
      diagnostics.push(`line ${lineNo}: indentation of ${spaces} space(s) is not a multiple of 2 — rounded down to level ${level}`);
    }
    const { parsed, unterminated } = parseBullet(t.slice(1));
    if (unterminated) diagnostics.push(`line ${lineNo}: unterminated backtick literal`);

    while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
    if (stack.length > 0) {
      stack[stack.length - 1].parsed.children.push(parsed);
    } else {
      (current as Definition).children.push(parsed);
      tops.push(lineNo);
    }
    stack.push({ parsed, level });
  });

  defs.forEach((def, i) => diagnostics.push(...structuralDiagnostics(def, allTops[i])));
  return { defs, diagnostics };
};

/* ---------------------------------------------------------------- Render, display, show */

const paramSpec = (params: string[]): Node => {
  if (params.length === 0) return sym('*');
  if (params.length === 1) return sym(params[0]);
  return node('*', params.map(sym));
};
const lambdaForm = (c: Closure): Node => node('lambda', [paramSpec(c.params), ...c.body]);

const formatValue = (v: Value): string => {
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return `\`${v}\``;
  if (v instanceof Str) return `\`"${v.text}"\``;
  if (v instanceof Err) return `\`ERROR: ${v.message}\``;
  if (v instanceof Closure) return '<lambda>';
  if (v instanceof Builtin) return v.name;
  return v;
};

const inlineCount = (children: Node[]): number => {
  let i = 0;
  while (i < children.length && isChildless(children[i]) && !(children[i].value instanceof Closure)) i++;
  return i;
};

const renderNode = (n: Node, indent: number, compact: boolean): string => {
  if (n.value instanceof Closure && isChildless(n)) return renderNode(lambdaForm(n.value), indent, compact);
  if (n.value === null && !isChildless(n)) return n.children.map((c) => renderNode(c, indent, compact)).join('\n');
  const line = `${'  '.repeat(indent)}- ${formatValue(n.value)}`;
  const inline = compact ? inlineCount(n.children) : 0;
  const head = n.children.slice(0, inline).reduce((text, c) => `${text} ${formatValue(c.value)}`, line);
  return [head, ...n.children.slice(inline).map((c) => renderNode(c, indent + 1, compact))].join('\n');
};

export const render = (n: Node): string => renderNode(n, 0, false);
export const renderCompact = (n: Node): string => renderNode(n, 0, true);

const renderDefinition = (def: Definition): string => [`# ${def.name}`, ...def.children.map(renderCompact)].join('\n');
export const compactSource = (text: string): string => `${parse(text).defs.map(renderDefinition).join('\n\n')}\n`;

export const display = (n: Node): string => {
  if (!isChildless(n)) return renderCompact(n);
  const v = n.value;
  if (v instanceof Str) return v.text;
  if (v instanceof Err) return `ERROR: ${v.message}`;
  if (v instanceof Closure) return '<lambda>';
  if (v instanceof Builtin) return v.name;
  return String(v);
};

const SHOW_ESCAPES: Record<string, string> = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t' };
const escapeShow = (s: string): string => s.replace(/[\\"\n\r\t]/g, (c) => SHOW_ESCAPES[c]);

const showValue = (v: Value): string => {
  if (v instanceof Str) return `"${escapeShow(v.text)}"`;
  if (v instanceof Err) return `<error: ${v.message}>`;
  if (v instanceof Closure) return '<lambda>';
  if (v instanceof Builtin) return v.name;
  return String(v);
};

export const show = (n: Node): string => (isChildless(n)
  ? showValue(n.value)
  : `(${[showValue(n.value), ...n.children.map(show)].join(' ')})`);

/* ---------------------------------------------------------------- Equality */

const sameValue = (a: Value, b: Value): boolean => {
  if (a instanceof Str && b instanceof Str) return a.text === b.text;
  if (a instanceof Err && b instanceof Err) return a.message === b.message;
  return a === b;
};

const deepEqual = (a: Node, b: Node): boolean => sameValue(a.value, b.value)
  && a.children.length === b.children.length
  && a.children.every((c, i) => deepEqual(c, b.children[i]));

/* ---------------------------------------------------------------- Interpreter */

class Abort {
  kind: 'steps' | 'depth';
  constructor(kind: 'steps' | 'depth') { this.kind = kind; }
}

const createEnv = (parent: Env | null): Env => ({ parent, vars: new Map() });

const lookup = (env: Env, name: string): Node => {
  for (let e: Env | null = env; e; e = e.parent) {
    const found = e.vars.get(name);
    if (found !== undefined) return found;
  }
  return makeError(name, 'undefined symbol');
};

const extractParams = (spec: Node): string[] => {
  if (!isChildless(spec)) return spec.children.map((c) => c.value as string);
  return spec.value === '*' ? [] : [spec.value as string];
};

const bindDefinition = (def: Definition, env: Env): void => {
  const c = def.children;
  if (c.length === 0) return;
  if (c.length === 1 && isChildless(c[0]) && !isSymbolValue(c[0].value)) {
    env.vars.set(def.name, c[0]);
    return;
  }
  const closure = c.length >= 2 && isParamSpec(c[0])
    ? new Closure(extractParams(c[0]), c.slice(1), env)
    : new Closure([], c, env);
  env.vars.set(def.name, atom(closure));
};

type SpecialForm = (it: Interpreter, n: Node, env: Env) => Node;

const SPECIAL_FORMS: Map<string, SpecialForm> = new Map<string, SpecialForm>([
  ['mial', (it, n) => n.children[0]],

  ['eval', (it, n, env) => {
    const inner = it.evaluate(n.children[0], env);
    return isError(inner) ? addTrace(inner, 'in eval') : it.evaluate(inner, env);
  }],

  ['if', (it, n, env) => {
    const test = it.evaluate(n.children[0], env);
    if (isError(test)) return addTrace(test, 'in if condition');
    const branch = n.children[isTruthy(test) ? 1 : 2];
    return branch ? it.evaluate(branch, env) : nil();
  }],

  ['let', (it, n, env) => {
    const local = createEnv(env);
    for (const binding of n.children[0].children) {
      const name = binding.value;
      if (!isSymbolValue(name)) return makeError('let', `binding ${formatValue(name)} must be a symbol`);
      const val = binding.children.length > 0 ? it.evaluate(binding.children[0], local) : nil();
      if (isError(val)) return addTrace(val, `in let binding ${name}`);
      local.vars.set(name, val);
    }
    return it.evaluateBody(n.children.slice(1), local);
  }],

  ['lambda', (it, n, env) => (isParamSpec(n.children[0])
    ? atom(new Closure(extractParams(n.children[0]), n.children.slice(1), env))
    : makeError('lambda', 'invalid parameter spec'))],

  ['and', (it, n, env) => {
    for (const c of n.children) {
      const v = it.evaluate(c, env);
      if (isError(v)) return addTrace(v, 'in and');
      if (!isTruthy(v)) return bool(false);
    }
    return bool(true);
  }],

  ['or', (it, n, env) => {
    for (const c of n.children) {
      const v = it.evaluate(c, env);
      if (isError(v)) return addTrace(v, 'in or');
      if (isTruthy(v)) return bool(true);
    }
    return bool(false);
  }],

  ['call', (it, n, env) => {
    const proc = it.evaluate(n.children[0], env);
    if (isError(proc)) return addTrace(proc, 'in call');
    const args = it.evaluateArgs(n.children.slice(1), env, 'call');
    return Array.isArray(args) ? it.apply(proc, args, 'call') : args;
  }],

  ['error?', (it, n, env) => bool(isError(it.evaluate(n.children[0], env)))],
]);

const shapeArgs = (args: Node[], fixedShape: boolean, count: number): Node[] => {
  const shaped = fixedShape ? args.slice(0, count) : [...args];
  while (shaped.length < count) shaped.push(nil());
  return shaped;
};

export type LoadConfig = {
  libraries: Library[];
  log: (text: string) => void;
  stepLimit: number;
  depthLimit: number;
};

const errorText = (n: Node): string => {
  const message = (n.value as Err).message;
  return n.children.length > 0 ? `${message} (${n.children.map(display).join(' ← ')})` : message;
};

export class Interpreter implements Context {
  diagnostics: string[];
  names: string[];
  log: (text: string) => void;
  stepLimit: number;
  depthLimit: number;
  steps = 0;
  depth = 0;
  globals: Env;

  constructor(source: string, config: LoadConfig) {
    const { defs, diagnostics } = parse(source);
    this.diagnostics = diagnostics;
    this.names = defs.map((d) => d.name);
    this.log = config.log;
    this.stepLimit = config.stepLimit;
    this.depthLimit = config.depthLimit;
    this.globals = createEnv(null);
    for (const lib of [CORE, ...config.libraries]) {
      lib.forEach((b, name) => this.globals.vars.set(name, atom(b)));
    }
    defs.forEach((def) => bindDefinition(def, this.globals));
  }

  evaluate(n: Node, env: Env): Node {
    if (++this.steps > this.stepLimit) throw new Abort('steps');
    if (++this.depth > this.depthLimit) throw new Abort('depth');
    const result = this.dispatch(n, env);
    this.depth--;
    return result;
  }

  dispatch(n: Node, env: Env): Node {
    if (isError(n)) return n;
    const op = n.value;
    if (isChildless(n)) return isSymbolValue(op) ? lookup(env, op) : n;
    if (!isSymbolValue(op)) return makeError(formatValue(op), 'not a function');
    const form = SPECIAL_FORMS.get(op);
    if (form) return form(this, n, env);
    const proc = lookup(env, op);
    if (isError(proc)) return proc;
    const args = this.evaluateArgs(n.children, env, op);
    return Array.isArray(args) ? this.apply(proc, args, op) : args;
  }

  // Returns the argument array, or an error node for the first failing argument.
  evaluateArgs(children: Node[], env: Env, opName: string): Node[] | Node {
    const args: Node[] = [];
    for (const child of children) {
      const v = this.evaluate(child, env);
      if (isError(v)) return addTrace(v, `in argument to ${opName}`);
      args.push(v);
    }
    return args;
  }

  evaluateBody(body: Node[], env: Env): Node {
    let result = nil();
    for (const n of body) {
      result = this.evaluate(n, env);
      if (isError(result)) return addTrace(result, 'in body');
    }
    return result;
  }

  apply(proc: Node, args: Node[], opName: string): Node {
    const v = proc.value;
    if (v instanceof Closure) {
      const local = createEnv(v.env);
      const shaped = shapeArgs(args, true, v.params.length);
      v.params.forEach((p, i) => local.vars.set(p, shaped[i]));
      const result = this.evaluateBody(v.body, local);
      return isError(result) ? addTrace(result, `in call to ${opName}`) : result;
    }
    if (v instanceof Builtin) {
      const result = v.fn(shapeArgs(args, v.arity.fixed, v.arity.count), this);
      return isError(result) ? addTrace(result, `in ${opName}`) : result;
    }
    return makeError(opName, 'not a function');
  }

  call(name: string, args: Node[]): CallResult {
    const proc = this.globals.vars.get(name);
    if (proc === undefined) return { ok: false, error: `missing definition "# ${name}"` };
    this.steps = 0;
    this.depth = 0;
    try {
      if (!isFunction(proc)) {
        return args.length === 0 ? { ok: true, value: proc } : { ok: false, error: `"# ${name}" is not a function` };
      }
      const result = this.apply(proc, args, name);
      return isError(result) ? { ok: false, error: errorText(result) } : { ok: true, value: result };
    } catch (e) {
      return { ok: false, error: this.abortText(e, name) };
    }
  }

  run(): CallResult { return this.call('main', []); }

  private abortText(e: unknown, name: string): string {
    if (!(e instanceof Abort)) return `"# ${name}" crashed: ${(e as Error).message}`;
    return e.kind === 'steps'
      ? `"# ${name}" exceeded the step budget of ${this.stepLimit} evaluations`
      : `"# ${name}" recursed too deeply (depth limit ${this.depthLimit})`;
  }
}

export const load = (source: string, config: LoadConfig): Interpreter => new Interpreter(source, config);

/* ---------------------------------------------------------------- Core library */

const firstNonNumber = (args: Node[]): Node | undefined => args.find((a) => !isNumber(a));

const finite = (name: string, x: number): Node => (Number.isFinite(x) ? num(x) : makeError(name, 'non-finite result'));

// A builtin over numbers: type-checks every argument, then checks the result is finite.
const numeric = (name: string, arity: Arity, compute: (ns: number[]) => number): Builtin => builtin(name, arity, (args) => {
  const bad = firstNonNumber(args);
  if (bad) return expected(name, 'number', bad);
  return finite(name, compute(args.map(numberOf)));
});

const comparison = (name: string, test: (a: number, b: number) => boolean): Builtin => builtin(name, fixed(2), (args) => {
  const bad = firstNonNumber(args);
  return bad ? expected(name, 'number', bad) : bool(test(numberOf(args[0]), numberOf(args[1])));
});

const plus = builtin('+', variadic(0), (args) => {
  const bad = args.find((a) => !isNumber(a) && !isString(a));
  if (bad) return expected('+', 'number or string', bad);
  if (args.some(isString)) return str(args.map(display).join(''));
  return finite('+', args.reduce((sum, a) => sum + numberOf(a), 0));
});

const divide = builtin('/', variadic(1), (args) => {
  const bad = firstNonNumber(args);
  if (bad) return expected('/', 'number', bad);
  const nums = args.map(numberOf);
  const divisors = nums.length === 1 ? nums : nums.slice(1);
  if (divisors.includes(0)) return makeError('/', 'division by zero');
  return finite('/', divisors.reduce((a, b) => a / b, nums.length === 1 ? 1 : nums[0]));
});

const remainder = builtin('%', fixed(2), (args) => {
  const bad = firstNonNumber(args);
  if (bad) return expected('%', 'number', bad);
  if (numberOf(args[1]) === 0) return makeError('%', 'division by zero');
  return finite('%', numberOf(args[0]) % numberOf(args[1]));
});

const makeMial = builtin('make-mial', fixed(2), ([tag, kids]) => {
  if (!isListLike(kids)) return expected('make-mial', 'list', kids);
  return node(tag.value instanceof Str ? tag.value.text : tag.value, [...kids.children]);
});

const mialOf = builtin('mial-of', fixed(1), ([f]) => {
  if (f.value instanceof Builtin) return makeError('mial-of', 'builtins have no MIAL source');
  if (!(f.value instanceof Closure)) return f;
  const c = f.value;
  if (c.params.length > 0) return lambdaForm(c);
  return c.body.length === 1 ? c.body[0] : list([...c.body]);
});

const cons = builtin('cons', variadic(1), (args) => {
  let tail = args[args.length - 1];
  for (let i = args.length - 2; i >= 0; i--) {
    tail = isListLike(tail) ? list([args[i], ...tail.children]) : list([args[i], tail]);
  }
  return tail;
});

const cdr = builtin('cdr', fixed(1), ([n]) => {
  if (isChildless(n) && n.value !== null) return expected('cdr', 'list', n);
  return n.children.length <= 1 ? nil() : list(n.children.slice(1));
});

const parseMial = builtin('parse-mial', fixed(1), ([code]) => {
  if (!isString(code)) return expected('parse-mial', 'string', code);
  return node('program', parse(textOf(code)).defs.map((d) => node(d.name, d.children)));
});

const printBuiltin = builtin('print', variadic(0), (args, ctx) => {
  const out = args.map(display).join(' ');
  ctx.log(out);
  return str(out);
});

const printMial = builtin('print-mial', fixed(1), ([n], ctx) => {
  ctx.log(render(n));
  return n;
});

export const CORE: Library = library([
  plus,
  numeric('-', variadic(1), (ns) => (ns.length === 1 ? -ns[0] : ns.reduce((a, b) => a - b))),
  numeric('*', variadic(0), (ns) => ns.reduce((a, b) => a * b, 1)),
  divide,
  remainder,
  comparison('<', (a, b) => a < b),
  comparison('<=', (a, b) => a <= b),
  comparison('>', (a, b) => a > b),
  comparison('>=', (a, b) => a >= b),
  builtin('eq', fixed(2), ([a, b]) => bool(deepEqual(a, b))),
  builtin('!=', fixed(2), ([a, b]) => bool(!deepEqual(a, b))),
  builtin('not', fixed(1), ([a]) => bool(!isTruthy(a))),
  builtin('null?', fixed(1), ([a]) => bool(isNull(a))),
  builtin('atom?', fixed(1), ([a]) => bool(isChildless(a))),
  builtin('list?', fixed(1), ([a]) => bool(a.value === null && !isChildless(a))),
  builtin('tag', fixed(1), ([n]) => atom(n.value)),
  builtin('children', fixed(1), ([n]) => (isChildless(n) ? nil() : list([...n.children]))),
  makeMial,
  mialOf,
  builtin('car', fixed(1), ([n]) => (isChildless(n) ? makeError('car', 'empty list') : n.children[0])),
  cdr,
  cons,
  builtin('list', variadic(0), (args) => list(args)),
  printBuiltin,
  printMial,
  parseMial,
]);

/* ---------------------------------------------------------------- Host library */

const isKey = (n: Node): boolean => isString(n) || isSymbol(n);
const keyText = (n: Node): string => (n.value instanceof Str ? n.value.text : n.value as string);
const isRecordLike = (n: Node): boolean => isRecord(n) || isNull(n);
const displayKey = (field: Node): string => display(atom(field.value));

const findField = (r: Node, key: string): Node | undefined => r.children.find((f) => f.value === key);

const recordBuiltin = builtin('record', variadic(0), (args) => {
  const fields: Node[] = [];
  for (let i = 0; i < args.length; i += 2) {
    if (!isKey(args[i])) return expected('record', 'key', args[i]);
    fields.push(node(keyText(args[i]), [i + 1 < args.length ? args[i + 1] : nil()]));
  }
  return node('record', fields);
});

const getBuiltin = builtin('get', fixed(2), ([r, k]) => {
  if (!isRecordLike(r)) return expected('get', 'record', r);
  if (!isKey(k)) return expected('get', 'key', k);
  const f = findField(r, keyText(k));
  return f && f.children.length > 0 ? f.children[0] : nil();
});

const putBuiltin = builtin('put', fixed(3), ([r, k, v]) => {
  if (!isRecordLike(r)) return expected('put', 'record', r);
  if (!isKey(k)) return expected('put', 'key', k);
  const key = keyText(k);
  const updated = node(key, [v]);
  const replaced = findField(r, key)
    ? r.children.map((f) => (f.value === key ? updated : f))
    : [...r.children, updated];
  return node('record', replaced);
});

const hasBuiltin = builtin('has?', fixed(2), ([r, k]) => {
  if (!isRecordLike(r)) return expected('has?', 'record', r);
  if (!isKey(k)) return expected('has?', 'key', k);
  return bool(findField(r, keyText(k)) !== undefined);
});

const keysBuiltin = builtin('keys', fixed(1), ([r]) => {
  if (!isRecordLike(r)) return expected('keys', 'record', r);
  return r.children.length === 0 ? nil() : list(r.children.map((f) => str(displayKey(f))));
});

const lengthBuiltin = builtin('length', fixed(1), ([x]) => {
  if (isString(x)) return num([...textOf(x)].length);
  if (isListLike(x)) return num(x.children.length);
  return expected('length', 'list or string', x);
});

const nthBuiltin = builtin('nth', fixed(2), ([l, i]) => {
  if (!isListLike(l)) return expected('nth', 'list', l);
  if (!isNumber(i)) return expected('nth', 'number', i);
  return l.children[numberOf(i)] ?? nil();
});

const appendBuiltin = builtin('append', variadic(0), (args) => {
  const bad = args.find((a) => !isListLike(a));
  if (bad) return expected('append', 'list', bad);
  const items = args.flatMap((a) => a.children);
  return items.length === 0 ? nil() : list(items);
});

const checkFunctionAndList = (name: string, f: Node, l: Node): Node | null => {
  if (!isFunction(f)) return expected(name, 'function', f);
  if (!isListLike(l)) return expected(name, 'list', l);
  return null;
};

const mapBuiltin = builtin('map', fixed(2), ([f, l], ctx) => {
  const bad = checkFunctionAndList('map', f, l);
  if (bad) return bad;
  const out: Node[] = [];
  for (const x of l.children) {
    const r = ctx.apply(f, [x], 'map');
    if (isError(r)) return r;
    out.push(r);
  }
  return out.length === 0 ? nil() : list(out);
});

const filterBuiltin = builtin('filter', fixed(2), ([f, l], ctx) => {
  const bad = checkFunctionAndList('filter', f, l);
  if (bad) return bad;
  const out: Node[] = [];
  for (const x of l.children) {
    const r = ctx.apply(f, [x], 'filter');
    if (isError(r)) return r;
    if (isTruthy(r)) out.push(x);
  }
  return out.length === 0 ? nil() : list(out);
});

const reduceBuiltin = builtin('reduce', fixed(3), ([f, init, l], ctx) => {
  const bad = checkFunctionAndList('reduce', f, l);
  if (bad) return bad;
  let acc = init;
  for (const x of l.children) {
    acc = ctx.apply(f, [acc, x], 'reduce');
    if (isError(acc)) return acc;
  }
  return acc;
});

const roundHalfUp = (x: number): number => {
  const low = Math.floor(x);
  return x - low >= 0.5 ? low + 1 : low;
};

const textBuiltin = builtin('text', variadic(0), (args) => str(
  args.flatMap((a) => (isListLike(a) ? a.children : [a])).map(display).join('\n'),
));

const joinBuiltin = builtin('join', fixed(2), ([l, sep]) => {
  if (!isListLike(l)) return expected('join', 'list', l);
  if (!isString(sep) && !isNull(sep)) return expected('join', 'string', sep);
  return str(l.children.map(display).join(isNull(sep) ? '' : textOf(sep)));
});

export const HOST: Library = library([
  recordBuiltin,
  getBuiltin,
  putBuiltin,
  hasBuiltin,
  keysBuiltin,
  lengthBuiltin,
  nthBuiltin,
  appendBuiltin,
  mapBuiltin,
  filterBuiltin,
  reduceBuiltin,
  numeric('min', variadic(1), (ns) => ns.reduce((a, b) => (b < a ? b : a))),
  numeric('max', variadic(1), (ns) => ns.reduce((a, b) => (b > a ? b : a))),
  numeric('abs', fixed(1), ([x]) => Math.abs(x)),
  numeric('floor', fixed(1), ([x]) => Math.floor(x)),
  numeric('round', fixed(1), ([x]) => roundHalfUp(x)),
  numeric('clamp', fixed(3), ([x, lo, hi]) => {
    const raised = x > lo ? x : lo;
    return raised < hi ? raised : hi;
  }),
  builtin('str', fixed(1), ([x]) => str(display(x))),
  textBuiltin,
  joinBuiltin,
]);

/* ---------------------------------------------------------------- Plain data */

export const fromPlain = (data: Plain): Node => {
  if (data === null) return nil();
  if (typeof data === 'string') return str(data);
  if (typeof data === 'number') return num(data);
  if (typeof data === 'boolean') return bool(data);
  if (Array.isArray(data)) return data.length === 0 ? nil() : list(data.map(fromPlain));
  return node('record', Object.entries(data).map(([k, v]) => node(k, [fromPlain(v)])));
};

export const toPlain = (n: Node): Plain => {
  if (isRecord(n)) {
    return Object.fromEntries(n.children.map((f) => [displayKey(f), f.children.length > 0 ? toPlain(f.children[0]) : null]));
  }
  if (n.value === null) return isChildless(n) ? null : n.children.map(toPlain);
  if (!isChildless(n)) return show(n);
  const v = n.value;
  if (v instanceof Err) return { error: v.message };
  return typeof v === 'number' || typeof v === 'boolean' ? v : display(n);
};

/* ---------------------------------------------------------------- Serialize */

const serializeValue = (v: Value): string => {
  if (typeof v === 'number') return formatNumber(v);
  if (v === null || typeof v === 'boolean') return String(v);
  if (v instanceof Str) return `{"string":${JSON.stringify(v.text)}}`;
  if (v instanceof Err) return `{"error":${JSON.stringify(v.message)}}`;
  if (v instanceof Closure) return JSON.stringify('<lambda>');
  if (v instanceof Builtin) return JSON.stringify(v.name);
  return JSON.stringify(v);
};

export const serialize = (n: Node): string => `{"value":${serializeValue(n.value)},"children":[${n.children.map(serialize).join(',')}]}`;

const decodeValue = (v: unknown): Value | undefined => {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = v as { string?: unknown; error?: unknown };
  if (typeof o.string === 'string') return new Str(o.string);
  if (typeof o.error === 'string') return new Err(o.error);
  return undefined;
};

const decodeNode = (data: unknown): Node | null => {
  if (typeof data !== 'object' || data === null) return null;
  const o = data as { value?: unknown; children?: unknown };
  if (!Array.isArray(o.children)) return null;
  const value = decodeValue(o.value);
  if (value === undefined) return null;
  const children = o.children.map(decodeNode);
  return children.some((c) => c === null) ? null : node(value, children as Node[]);
};

const parseJson = (text: string): unknown => {
  try { return JSON.parse(text); } catch { return undefined; }
};

export const deserialize = (text: string): CallResult => {
  const data = parseJson(text);
  const decoded = data === undefined ? null : decodeNode(data);
  return decoded ? { ok: true, value: decoded } : { ok: false, error: 'not a serialized node' };
};
