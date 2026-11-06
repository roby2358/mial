// Runs the shared corpus in ../../test (test/README.md describes the case format).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../mial.js');

const CORPUS = path.join(__dirname, '..', '..', 'test');

const testLibrary = M.library([
  M.builtin('test-double', M.fixed(1), ([x]) => (typeof x.value === 'number'
    ? M.num(x.value * 2)
    : M.makeError('test-double', 'expected number'))),
  M.builtin('test-apply', M.fixed(2), ([f, x], ctx) => ctx.apply(f, [x], 'test-apply')),
  M.builtin('test-log', M.fixed(1), ([x], ctx) => { ctx.log(M.display(x)); return x; }),
]);

const LIBRARIES = { host: M.HOST, test: testLibrary };

const checkResult = (check, result) => {
  if (check.error !== undefined) {
    assert.deepStrictEqual(result, { ok: false, error: check.error });
    return;
  }
  assert.ok(result.ok, `expected success, got: ${result.error}`);
  const v = result.value;
  if (check.value !== undefined) assert.strictEqual(M.show(v), check.value);
  if (check.markdown !== undefined) assert.strictEqual(M.render(v), check.markdown);
  if (check.compactMarkdown !== undefined) assert.strictEqual(M.renderCompact(v), check.compactMarkdown);
  if (check.display !== undefined) assert.strictEqual(M.display(v), check.display);
  if (check.plain !== undefined) assert.deepStrictEqual(M.toPlain(v), check.plain);
  if (check.serialized !== undefined) assert.strictEqual(M.serialize(v), check.serialized);
};

const CHECKS = {
  call: (check, it, logged) => {
    logged.length = 0;
    checkResult(check, it.call(check.call, check.args.map(M.fromPlain)));
    if (check.log !== undefined) assert.deepStrictEqual(logged, check.log);
  },
  run: (check, it, logged) => {
    logged.length = 0;
    checkResult(check, it.run());
    if (check.log !== undefined) assert.deepStrictEqual(logged, check.log);
  },
  deserialize: (check) => checkResult(check, M.deserialize(check.deserialize)),
  format: (check) => assert.strictEqual(M.formatNumber(check.format), check.text),
};

const checkKind = (check) => Object.keys(CHECKS).find((k) => k in check);

const runCase = (jsonPath) => {
  const spec = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const source = fs.readFileSync(jsonPath.replace(/\.json$/, '.md'), 'utf8');
  const parsed = M.parse(source);
  assert.deepStrictEqual(parsed.diagnostics, spec.diagnostics ?? []);
  if (spec.parsed) assert.deepStrictEqual(parsed.defs.map((d) => M.show(M.node(d.name, d.children))), spec.parsed);
  if (spec.compact !== undefined) assert.strictEqual(M.compactSource(source), spec.compact);

  const logged = [];
  const it = M.load(source, {
    libraries: spec.libraries.map((name) => LIBRARIES[name]),
    log: (text) => logged.push(text),
    stepLimit: spec.stepLimit ?? M.STEP_LIMIT,
    depthLimit: spec.depthLimit ?? M.DEPTH_LIMIT,
  });
  assert.deepStrictEqual(it.names, parsed.defs.map((d) => d.name));
  (spec.checks ?? []).forEach((check, i) => {
    try {
      CHECKS[checkKind(check)](check, it, logged);
    } catch (e) {
      e.message = `check ${i} ${JSON.stringify(check).slice(0, 200)}: ${e.message}`;
      throw e;
    }
  });
};

const caseFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return caseFiles(p);
  return e.name.endsWith('.json') ? [p] : [];
});

for (const file of caseFiles(CORPUS).sort()) {
  test(path.relative(CORPUS, file), () => runCase(file));
}
