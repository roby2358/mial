// Host-facing behaviour the shared corpus can't express: it goes through TS calling conventions.
import test from 'node:test';
import assert from 'node:assert';
import * as M from '../src/mial.ts';

test('num and fromPlain turn a non-finite number into an error', () => {
  for (const n of [NaN, Infinity, -Infinity]) {
    assert.strictEqual(M.show(M.num(n)), '<error: num: non-finite number>');
    assert.strictEqual(M.show(M.fromPlain(n)), '<error: num: non-finite number>');
  }
});

test('a crash reports the thrown message, even when the throw is not an Error', () => {
  const crash = (thrown: unknown) => {
    const libraries = [M.library([M.builtin('boom', M.fixed(0), () => { throw thrown; })])];
    return M.load('# main\n- call boom\n', { libraries, log: () => {}, stepLimit: M.STEP_LIMIT, depthLimit: M.DEPTH_LIMIT }).run();
  };
  assert.deepStrictEqual(crash(new Error('bad')), { ok: false, error: '"# main" crashed: bad' });
  assert.deepStrictEqual(crash('bad'), { ok: false, error: '"# main" crashed: bad' });
});
