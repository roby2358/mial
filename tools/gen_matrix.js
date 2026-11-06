// Generates test/R-33/matrix.{md,json}: every built-in and special form applied to every
// argument kind. The golden results come from js/mial.js; the other languages must agree (R-33).
// Run with `just cc-matrix` after a deliberate semantic change, and review the diff.
const fs = require('node:fs');
const path = require('node:path');
const M = require('../js/mial.js');

const OUT = path.join(__dirname, '..', 'test', 'R-33');
const FORMS = ['mial', 'eval', 'if', 'let', 'lambda', 'and', 'or', 'call', 'error?'];
const NAMES = [...FORMS, ...M.CORE.keys(), ...M.HOST.keys()];

// Each kind is the bullet lines of one argument, relative to its own indentation.
const KIND = {
  null: ['- `null`'],
  zero: ['- `0`'],
  neg: ['- `-1.5`'],
  true: ['- `true`'],
  empty: ['- ``'],
  str: ['- `"a"`'],
  sym: ['- mial', '  - foo'],
  list: ['- list `1` `2`'],
  tree: ['- mial', '  - + `1` `2`'],
  record: ['- record `"a"` `1`'],
  closure: ['- lambda x', '  - x'],
  builtin: ['- +'],
  big: ['- `1e+308`'],
};
const ALL = Object.keys(KIND);
const PAIRED = ['null', 'zero', 'neg', 'true', 'str', 'list', 'record', 'closure'];
const TRIPLED = ['null', 'zero', 'str', 'list', 'closure'];
const THREE_ARG = ['if', 'put', 'reduce', 'clamp', 'get', 'map'];

const combos = (kinds, size) => (size === 0 ? [[]] : combos(kinds, size - 1).flatMap((c) => kinds.map((k) => [...c, k])));

const defLines = (id, name, args) => {
  if (args.length === 0) return [`# ${id}`, `- call ${name}`];
  const lines = args.flatMap((k) => KIND[k].map((l) => `  ${l}`));
  return [`# ${id}`, `- ${name}`, ...lines];
};

const argSets = (name) => [
  ...combos(ALL, 1),
  ...combos(PAIRED, 2),
  ...(THREE_ARG.includes(name) ? combos(TRIPLED, 3) : []),
  ...(FORMS.includes(name) ? [] : [[]]),
];

const defs = NAMES.flatMap((name, n) => argSets(name).map((args, a) => ({ id: `m${n}-${a}`, name, args })));
const source = `${defs.map((d) => defLines(d.id, d.name, d.args).join('\n')).join('\n')}\n`;

const logged = [];
const it = M.load(source, { libraries: [M.HOST], log: (t) => logged.push(t), stepLimit: M.STEP_LIMIT, depthLimit: M.DEPTH_LIMIT });

const checks = defs.map((d) => {
  logged.length = 0;
  const r = it.call(d.id, []);
  const check = { call: d.id, args: [] };
  if (r.ok) check.value = M.show(r.value);
  else check.error = r.error;
  check.log = [...logged];
  return check;
});

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'matrix.md'), source);
fs.writeFileSync(path.join(OUT, 'matrix.json'), `${JSON.stringify({ libraries: ['host'], diagnostics: it.diagnostics, checks }, null, 0)}\n`);
console.log(`${checks.length} checks, ${it.diagnostics.length} diagnostics`);
