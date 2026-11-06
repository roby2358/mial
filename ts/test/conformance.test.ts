// Runs the shared corpus in ../../test (test/README.md describes the case format).
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import * as M from '../src/mial.ts';

const CORPUS = path.join(import.meta.dirname, '..', '..', 'test');

type Check = {
  call?: string; args?: M.Plain[]; run?: boolean; deserialize?: string; format?: number; text?: string;
  error?: string; value?: string; markdown?: string; compactMarkdown?: string; display?: string;
  plain?: M.Plain; serialized?: string; log?: string[];
};
type Case = {
  libraries: string[]; stepLimit?: number; depthLimit?: number; diagnostics?: string[];
  parsed?: string[]; compact?: string; checks?: Check[];
};

const testLibrary = M.library([
  M.builtin('test-double', M.fixed(1), ([x]) => (typeof x.value === 'number'
    ? M.num(x.value * 2)
    : M.makeError('test-double', 'expected number'))),
  M.builtin('test-apply', M.fixed(2), ([f, x], ctx) => ctx.apply(f, [x], 'test-apply')),
  M.builtin('test-log', M.fixed(1), ([x], ctx) => { ctx.log(M.display(x)); return x; }),
]);

const LIBRARIES: Record<string, M.Library> = { host: M.HOST, test: testLibrary };

const checkResult = (check: Check, result: M.CallResult): void => {
  if (check.error !== undefined) {
    assert.deepStrictEqual(result, { ok: false, error: check.error });
    return;
  }
  if (!result.ok) throw new Error(`expected success, got: ${result.error}`);
  const v = result.value;
  if (check.value !== undefined) assert.strictEqual(M.show(v), check.value);
  if (check.markdown !== undefined) assert.strictEqual(M.render(v), check.markdown);
  if (check.compactMarkdown !== undefined) assert.strictEqual(M.renderCompact(v), check.compactMarkdown);
  if (check.display !== undefined) assert.strictEqual(M.display(v), check.display);
  if (check.plain !== undefined) assert.deepStrictEqual(M.toPlain(v), check.plain);
  if (check.serialized !== undefined) assert.strictEqual(M.serialize(v), check.serialized);
};

const runCheck = (check: Check, it: M.Interpreter, logged: string[]): void => {
  logged.length = 0;
  if (check.call !== undefined) checkResult(check, it.call(check.call, (check.args as M.Plain[]).map(M.fromPlain)));
  else if (check.run !== undefined) checkResult(check, it.run());
  else if (check.deserialize !== undefined) checkResult(check, M.deserialize(check.deserialize));
  else assert.strictEqual(M.formatNumber(check.format as number), check.text);
  if (check.log !== undefined) assert.deepStrictEqual(logged, check.log);
};

const runCase = (jsonPath: string): void => {
  const spec = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as Case;
  const source = fs.readFileSync(jsonPath.replace(/\.json$/, '.md'), 'utf8');
  const parsed = M.parse(source);
  assert.deepStrictEqual(parsed.diagnostics, spec.diagnostics ?? []);
  if (spec.parsed) assert.deepStrictEqual(parsed.defs.map((d) => M.show(M.node(d.name, d.children))), spec.parsed);
  if (spec.compact !== undefined) assert.strictEqual(M.compactSource(source), spec.compact);

  const logged: string[] = [];
  const it = M.load(source, {
    libraries: spec.libraries.map((name) => LIBRARIES[name]),
    log: (text) => logged.push(text),
    stepLimit: spec.stepLimit ?? M.STEP_LIMIT,
    depthLimit: spec.depthLimit ?? M.DEPTH_LIMIT,
  });
  assert.deepStrictEqual(it.names, parsed.defs.map((d) => d.name));
  (spec.checks ?? []).forEach((check, i) => {
    try {
      runCheck(check, it, logged);
    } catch (e) {
      (e as Error).message = `check ${i} ${JSON.stringify(check).slice(0, 200)}: ${(e as Error).message}`;
      throw e;
    }
  });
};

const caseFiles = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return caseFiles(p);
  return e.name.endsWith('.json') ? [p] : [];
});

for (const file of caseFiles(CORPUS).sort()) {
  test(path.relative(CORPUS, file), () => runCase(file));
}
