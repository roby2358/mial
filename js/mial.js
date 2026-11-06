/**
 * MIAL (MarkdownIsALisp): JavaScript library. ONTOLOGY.md is the reference; cite its IDs.
 *
 * A single plain file with no build step. A script tag gets the global `Mial` (works from
 * file://); require() gets the same object as module.exports.
 */
(function (root) {
  'use strict';

  const STEP_LIMIT = 200000;
  const DEPTH_LIMIT = 1000;

  /* ---------------------------------------------------------------- Values and nodes */

  // A symbol is a plain JS string; null, booleans and numbers are themselves.
  class Str { constructor(text) { this.text = text; } }
  class Err { constructor(message) { this.message = message; } }
  class Closure { constructor(params, body, env) { this.params = params; this.body = body; this.env = env; } }
  class Builtin { constructor(name, arity, fn) { this.name = name; this.arity = arity; this.fn = fn; } }

  const node = (value, children) => ({ value, children });
  const atom = (value) => node(value, []);
  const sym = (name) => atom(name);
  const str = (text) => atom(new Str(text));
  const num = (n) => atom(n);
  const bool = (b) => atom(b);
  const nil = () => atom(null);
  const list = (items) => node(null, items);

  const isSymbolValue = (v) => typeof v === 'string';
  const isFunctionValue = (v) => v instanceof Closure || v instanceof Builtin;
  const isError = (n) => n.value instanceof Err;
  const isChildless = (n) => n.children.length === 0;
  const isNull = (n) => n.value === null && isChildless(n);
  const isListLike = (n) => n.value === null;
  const isNumber = (n) => typeof n.value === 'number' && isChildless(n);
  const isString = (n) => n.value instanceof Str && isChildless(n);
  const isSymbol = (n) => isSymbolValue(n.value) && isChildless(n);
  const isFunction = (n) => isFunctionValue(n.value) && isChildless(n);
  const isRecord = (n) => n.value === 'record';
  const isTruthy = (n) => !(isChildless(n) && (n.value === false || n.value === null || n.value === 0));

  const ATOM_TYPE_NAMES = [
    [(v) => typeof v === 'number', 'number'],
    [(v) => typeof v === 'boolean', 'boolean'],
    [(v) => v instanceof Str, 'string'],
    [isSymbolValue, 'symbol'],
    [isFunctionValue, 'function'],
    [(v) => v instanceof Err, 'error'],
  ];

  const typeName = (n) => {
    if (n.value === null) return isChildless(n) ? 'null' : 'list';
    if (!isChildless(n)) return 'tree';
    return ATOM_TYPE_NAMES.find(([test]) => test(n.value))[1];
  };

  const makeError = (symbol, reason) => atom(new Err(`${symbol}: ${reason}`));
  const addTrace = (err, reason) => node(err.value, [...err.children, str(reason)]);
  const expected = (name, what, n) => makeError(name, `expected ${what}, got ${typeName(n)}`);

  const fixed = (n) => ({ fixed: true, count: n });
  const variadic = (min) => ({ fixed: false, count: min });
  const builtin = (name, arity, fn) => new Builtin(name, arity, fn);
  const library = (builtins) => new Map(builtins.map((b) => [b.name, b]));

  /* ---------------------------------------------------------------- Number text */

  const formatNumber = (n) => String(n);

  // A literal is a number only when it round-trips exactly (grammar rule).
  const parseNumber = (text) => {
    if (text === '') return null;
    const n = Number(text);
    return Number.isFinite(n) && formatNumber(n) === text ? n : null;
  };

  /* ---------------------------------------------------------------- Parser */

  const isWs = (c) => c === ' ' || c === '\t' || c === '\r';
  const isGap = (c) => c === ' ' || c === '\t';

  const trimWs = (s) => {
    let start = 0;
    let end = s.length;
    while (start < end && isWs(s[start])) start++;
    while (end > start && isWs(s[end - 1])) end--;
    return s.slice(start, end);
  };

  const measureIndent = (line) => {
    let spaces = 0;
    for (const c of line) {
      if (c === ' ') spaces += 1;
      else if (c === '\t') spaces += 2;
      else break;
    }
    return spaces;
  };

  const isQuoted = (s) => s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0];

  const parseLiteral = (text) => {
    if (isQuoted(text)) return str(text.slice(1, -1));
    if (text === 'null') return nil();
    if (text === 'true') return bool(true);
    if (text === 'false') return bool(false);
    const n = parseNumber(text);
    return n === null ? str(text) : num(n);
  };

  const parseToken = (token) => (token[0] === '`' ? parseLiteral(token.slice(1, -1)) : sym(token));

  const tokenize = (text) => {
    const tokens = [];
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

  const parseBullet = (content) => {
    const { tokens, unterminated } = tokenize(content);
    if (tokens.length === 0) return { parsed: sym(''), unterminated };
    const head = parseToken(tokens[0]);
    return { parsed: node(head.value, tokens.slice(1).map(parseToken)), unterminated };
  };

  const isBulletLine = (t) => (t[0] === '-' || t[0] === '*') && t.length > 1 && isGap(t[1]);

  const headingName = (t) => {
    let i = 0;
    while (t[i] === '#') i++;
    return trimWs(t.slice(i));
  };

  const isParamSpec = (n) => {
    if (!isSymbolValue(n.value)) return false;
    if (isChildless(n)) return true;
    return n.value === '*' && n.children.every(isSymbol);
  };

  const structuralDiagnostics = (def, tops) => {
    if (def.children.length === 0) return [`line ${def.line}: definition "${def.name}" has no body — ignored`];
    const c = def.children;
    if (c.length >= 3 && isParamSpec(c[0]) && isSymbol(c[1])) {
      return [`line ${tops[1]}: bare symbol "${c[1].value}" in "# ${def.name}" has its value discarded — declare several parameters with "- * a b"`];
    }
    return [];
  };

  const parse = (source) => {
    const defs = [];
    const allTops = [];
    const diagnostics = [];
    let current = null;
    let tops = null;
    let stack = [];

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
      if (!current) {
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
        current.children.push(parsed);
        tops.push(lineNo);
      }
      stack.push({ parsed, level });
    });

    defs.forEach((def, i) => diagnostics.push(...structuralDiagnostics(def, allTops[i])));
    return { defs, diagnostics };
  };

  /* ---------------------------------------------------------------- Render, display, show */

  const paramSpec = (params) => {
    if (params.length === 0) return sym('*');
    if (params.length === 1) return sym(params[0]);
    return node('*', params.map(sym));
  };
  const lambdaForm = (c) => node('lambda', [paramSpec(c.params), ...c.body]);

  const formatValue = (v) => {
    if (v === null || typeof v === 'number' || typeof v === 'boolean') return `\`${v}\``;
    if (v instanceof Str) return `\`"${v.text}"\``;
    if (v instanceof Err) return `\`ERROR: ${v.message}\``;
    if (v instanceof Closure) return '<lambda>';
    if (v instanceof Builtin) return v.name;
    return v;
  };

  const inlineCount = (children) => {
    let i = 0;
    while (i < children.length && isChildless(children[i]) && !(children[i].value instanceof Closure)) i++;
    return i;
  };

  const renderNode = (n, indent, compact) => {
    if (n.value instanceof Closure && isChildless(n)) return renderNode(lambdaForm(n.value), indent, compact);
    if (n.value === null && !isChildless(n)) return n.children.map((c) => renderNode(c, indent, compact)).join('\n');
    const line = `${'  '.repeat(indent)}- ${formatValue(n.value)}`;
    const inline = compact ? inlineCount(n.children) : 0;
    const head = n.children.slice(0, inline).reduce((text, c) => `${text} ${formatValue(c.value)}`, line);
    return [head, ...n.children.slice(inline).map((c) => renderNode(c, indent + 1, compact))].join('\n');
  };

  const render = (n) => renderNode(n, 0, false);
  const renderCompact = (n) => renderNode(n, 0, true);

  const renderDefinition = (def) => [`# ${def.name}`, ...def.children.map(renderCompact)].join('\n');
  const compactSource = (text) => `${parse(text).defs.map(renderDefinition).join('\n\n')}\n`;

  const display = (n) => {
    if (!isChildless(n)) return renderCompact(n);
    const v = n.value;
    if (v instanceof Str) return v.text;
    if (v instanceof Err) return `ERROR: ${v.message}`;
    if (v instanceof Closure) return '<lambda>';
    if (v instanceof Builtin) return v.name;
    return String(v);
  };

  const SHOW_ESCAPES = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t' };
  const escapeShow = (s) => s.replace(/[\\"\n\r\t]/g, (c) => SHOW_ESCAPES[c]);

  const showValue = (v) => {
    if (v instanceof Str) return `"${escapeShow(v.text)}"`;
    if (v instanceof Err) return `<error: ${v.message}>`;
    if (v instanceof Closure) return '<lambda>';
    if (v instanceof Builtin) return v.name;
    return String(v);
  };

  const show = (n) => (isChildless(n) ? showValue(n.value) : `(${[showValue(n.value), ...n.children.map(show)].join(' ')})`);

  /* ---------------------------------------------------------------- Equality */

  const sameValue = (a, b) => {
    if (a instanceof Str && b instanceof Str) return a.text === b.text;
    if (a instanceof Err && b instanceof Err) return a.message === b.message;
    return a === b;
  };

  const deepEqual = (a, b) => sameValue(a.value, b.value)
    && a.children.length === b.children.length
    && a.children.every((c, i) => deepEqual(c, b.children[i]));

  /* ---------------------------------------------------------------- Interpreter */

  class Abort { constructor(kind) { this.kind = kind; } }

  const createEnv = (parent) => ({ parent, vars: new Map() });

  const lookup = (env, name) => {
    for (let e = env; e; e = e.parent) {
      const found = e.vars.get(name);
      if (found !== undefined) return found;
    }
    return makeError(name, 'undefined symbol');
  };

  const extractParams = (spec) => {
    if (!isChildless(spec)) return spec.children.map((c) => c.value);
    return spec.value === '*' ? [] : [spec.value];
  };

  const bindDefinition = (def, env) => {
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

  const SPECIAL_FORMS = new Map([
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
        if (!isSymbolValue(binding.value)) return makeError('let', `binding ${formatValue(binding.value)} must be a symbol`);
        const val = binding.children.length > 0 ? it.evaluate(binding.children[0], local) : nil();
        if (isError(val)) return addTrace(val, `in let binding ${binding.value}`);
        local.vars.set(binding.value, val);
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
      return isError(args) ? args : it.apply(proc, args, 'call');
    }],

    ['error?', (it, n, env) => bool(isError(it.evaluate(n.children[0], env)))],
  ]);

  const shapeArgs = (args, fixedShape, count) => {
    const shaped = fixedShape ? args.slice(0, count) : [...args];
    while (shaped.length < count) shaped.push(nil());
    return shaped;
  };

  class Interpreter {
    constructor(source, config) {
      const { defs, diagnostics } = parse(source);
      this.diagnostics = diagnostics;
      this.names = defs.map((d) => d.name);
      this.log = config.log;
      this.stepLimit = config.stepLimit;
      this.depthLimit = config.depthLimit;
      this.steps = 0;
      this.depth = 0;
      this.globals = createEnv(null);
      for (const lib of [CORE, ...config.libraries]) {
        lib.forEach((b, name) => this.globals.vars.set(name, atom(b)));
      }
      defs.forEach((def) => bindDefinition(def, this.globals));
    }

    evaluate(n, env) {
      if (++this.steps > this.stepLimit) throw new Abort('steps');
      if (++this.depth > this.depthLimit) throw new Abort('depth');
      const result = this.dispatch(n, env);
      this.depth--;
      return result;
    }

    dispatch(n, env) {
      if (isError(n)) return n;
      if (isChildless(n)) return isSymbolValue(n.value) ? lookup(env, n.value) : n;
      if (!isSymbolValue(n.value)) return makeError(formatValue(n.value), 'not a function');
      const form = SPECIAL_FORMS.get(n.value);
      if (form) return form(this, n, env);
      const proc = lookup(env, n.value);
      if (isError(proc)) return proc;
      const args = this.evaluateArgs(n.children, env, n.value);
      return isError(args) ? args : this.apply(proc, args, n.value);
    }

    // Returns the argument array, or an error node for the first failing argument.
    evaluateArgs(children, env, opName) {
      const args = [];
      for (const child of children) {
        const v = this.evaluate(child, env);
        if (isError(v)) return addTrace(v, `in argument to ${opName}`);
        args.push(v);
      }
      return args;
    }

    evaluateBody(body, env) {
      let result = nil();
      for (const n of body) {
        result = this.evaluate(n, env);
        if (isError(result)) return addTrace(result, 'in body');
      }
      return result;
    }

    apply(proc, args, opName) {
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

    call(name, args) {
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

    run() { return this.call('main', []); }

    abortText(e, name) {
      if (!(e instanceof Abort)) return `"# ${name}" crashed: ${e.message}`;
      return e.kind === 'steps'
        ? `"# ${name}" exceeded the step budget of ${this.stepLimit} evaluations`
        : `"# ${name}" recursed too deeply (depth limit ${this.depthLimit})`;
    }
  }

  const errorText = (n) => (n.children.length > 0
    ? `${n.value.message} (${n.children.map(display).join(' ← ')})`
    : n.value.message);

  const load = (source, config) => new Interpreter(source, config);

  /* ---------------------------------------------------------------- Core library */

  const firstNonNumber = (args) => args.find((a) => !isNumber(a));

  const finite = (name, x) => (Number.isFinite(x) ? num(x) : makeError(name, 'non-finite result'));

  // A builtin over numbers: type-checks every argument, then checks the result is finite.
  const numeric = (name, arity, compute) => builtin(name, arity, (args) => {
    const bad = firstNonNumber(args);
    if (bad) return expected(name, 'number', bad);
    return finite(name, compute(args.map((a) => a.value)));
  });

  const comparison = (name, test) => builtin(name, fixed(2), (args) => {
    const bad = firstNonNumber(args);
    return bad ? expected(name, 'number', bad) : bool(test(args[0].value, args[1].value));
  });

  const plus = builtin('+', variadic(0), (args) => {
    const bad = args.find((a) => !isNumber(a) && !isString(a));
    if (bad) return expected('+', 'number or string', bad);
    if (args.some(isString)) return str(args.map(display).join(''));
    return finite('+', args.reduce((sum, a) => sum + a.value, 0));
  });

  const divide = builtin('/', variadic(1), (args) => {
    const bad = firstNonNumber(args);
    if (bad) return expected('/', 'number', bad);
    const nums = args.map((a) => a.value);
    const divisors = nums.length === 1 ? nums : nums.slice(1);
    if (divisors.includes(0)) return makeError('/', 'division by zero');
    return finite('/', divisors.reduce((a, b) => a / b, nums.length === 1 ? 1 : nums[0]));
  });

  const remainder = builtin('%', fixed(2), (args) => {
    const bad = firstNonNumber(args);
    if (bad) return expected('%', 'number', bad);
    if (args[1].value === 0) return makeError('%', 'division by zero');
    return finite('%', args[0].value % args[1].value);
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
    return node('program', parse(code.value.text).defs.map((d) => node(d.name, d.children)));
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

  const CORE = library([
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

  const isKey = (n) => isString(n) || isSymbol(n);
  const keyText = (n) => (n.value instanceof Str ? n.value.text : n.value);
  const isRecordLike = (n) => isRecord(n) || isNull(n);

  const findField = (r, key) => r.children.find((f) => f.value === key);

  const recordBuiltin = builtin('record', variadic(0), (args) => {
    const fields = [];
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
    return r.children.length === 0 ? nil() : list(r.children.map((f) => str(f.value)));
  });

  const lengthBuiltin = builtin('length', fixed(1), ([x]) => {
    if (isString(x)) return num([...x.value.text].length);
    if (isListLike(x)) return num(x.children.length);
    return expected('length', 'list or string', x);
  });

  const nthBuiltin = builtin('nth', fixed(2), ([l, i]) => {
    if (!isListLike(l)) return expected('nth', 'list', l);
    if (!isNumber(i)) return expected('nth', 'number', i);
    return l.children[i.value] || nil();
  });

  const appendBuiltin = builtin('append', variadic(0), (args) => {
    const bad = args.find((a) => !isListLike(a));
    if (bad) return expected('append', 'list', bad);
    const items = args.flatMap((a) => a.children);
    return items.length === 0 ? nil() : list(items);
  });

  const checkFunctionAndList = (name, f, l) => {
    if (!isFunction(f)) return expected(name, 'function', f);
    if (!isListLike(l)) return expected(name, 'list', l);
    return null;
  };

  const mapBuiltin = builtin('map', fixed(2), ([f, l], ctx) => {
    const bad = checkFunctionAndList('map', f, l);
    if (bad) return bad;
    const out = [];
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
    const out = [];
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

  const roundHalfUp = (x) => {
    const low = Math.floor(x);
    return x - low >= 0.5 ? low + 1 : low;
  };

  const textBuiltin = builtin('text', variadic(0), (args) => str(
    args.flatMap((a) => (isListLike(a) ? a.children : [a])).map(display).join('\n'),
  ));

  const joinBuiltin = builtin('join', fixed(2), ([l, sep]) => {
    if (!isListLike(l)) return expected('join', 'list', l);
    if (!isString(sep) && !isNull(sep)) return expected('join', 'string', sep);
    return str(l.children.map(display).join(isNull(sep) ? '' : sep.value.text));
  });

  const HOST = library([
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

  const fromPlain = (data) => {
    if (data === null) return nil();
    if (typeof data === 'string') return str(data);
    if (typeof data === 'number') return num(data);
    if (typeof data === 'boolean') return bool(data);
    if (Array.isArray(data)) return data.length === 0 ? nil() : list(data.map(fromPlain));
    return node('record', Object.entries(data).map(([k, v]) => node(k, [fromPlain(v)])));
  };

  const toPlain = (n) => {
    if (isRecord(n)) {
      return Object.fromEntries(n.children.map((f) => [displayKey(f), f.children.length > 0 ? toPlain(f.children[0]) : null]));
    }
    if (n.value === null) return isChildless(n) ? null : n.children.map(toPlain);
    if (!isChildless(n)) return show(n);
    const v = n.value;
    if (v instanceof Err) return { error: v.message };
    return typeof v === 'number' || typeof v === 'boolean' ? v : display(n);
  };

  const displayKey = (field) => display(atom(field.value));

  /* ---------------------------------------------------------------- Serialize */

  const serializeValue = (v) => {
    if (typeof v === 'number') return formatNumber(v);
    if (v === null || typeof v === 'boolean') return String(v);
    if (v instanceof Str) return `{"string":${JSON.stringify(v.text)}}`;
    if (v instanceof Err) return `{"error":${JSON.stringify(v.message)}}`;
    if (v instanceof Closure) return JSON.stringify('<lambda>');
    if (v instanceof Builtin) return JSON.stringify(v.name);
    return JSON.stringify(v);
  };

  const serialize = (n) => `{"value":${serializeValue(n.value)},"children":[${n.children.map(serialize).join(',')}]}`;

  const decodeValue = (v) => {
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
    if (typeof v !== 'object' || Array.isArray(v)) return undefined;
    if (typeof v.string === 'string') return new Str(v.string);
    if (typeof v.error === 'string') return new Err(v.error);
    return undefined;
  };

  const decodeNode = (data) => {
    if (typeof data !== 'object' || data === null || !Array.isArray(data.children)) return null;
    const value = decodeValue(data.value);
    if (value === undefined) return null;
    const children = data.children.map(decodeNode);
    return children.includes(null) ? null : node(value, children);
  };

  const parseJson = (text) => {
    try { return JSON.parse(text); } catch (e) { return undefined; }
  };

  const deserialize = (text) => {
    const data = parseJson(text);
    const decoded = data === undefined ? null : decodeNode(data);
    return decoded ? { ok: true, value: decoded } : { ok: false, error: 'not a serialized node' };
  };

  /* ---------------------------------------------------------------- Exports */

  const api = {
    STEP_LIMIT, DEPTH_LIMIT, CORE, HOST,
    load, parse, render, renderCompact, compactSource, display, show, formatNumber,
    serialize, deserialize, fromPlain, toPlain, typeName, isError, isTruthy,
    node, sym, str, num, bool, nil, list, makeError, fixed, variadic, builtin, library,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Mial = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
