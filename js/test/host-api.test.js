// Host-facing behaviour the shared corpus can't express: it goes through JS calling conventions.
const test = require('node:test');
const assert = require('node:assert');
const M = require('../mial.js');

const config = { libraries: [], log: () => {}, stepLimit: M.STEP_LIMIT, depthLimit: M.DEPTH_LIMIT };

for (const field of Object.keys(config)) {
  test(`load requires ${field}`, () => {
    const { [field]: _, ...rest } = config;
    assert.throws(() => M.load('# main\n- `1`\n', rest), new TypeError(`load: ${field} is required`));
  });
}

test('num and fromPlain turn a non-finite number into an error', () => {
  for (const n of [NaN, Infinity, -Infinity]) {
    assert.strictEqual(M.show(M.num(n)), '<error: num: non-finite number>');
    assert.strictEqual(M.show(M.fromPlain(n)), '<error: num: non-finite number>');
  }
});

test('a crash reports the thrown message, even when the throw is not an Error', () => {
  const boom = (thrown) => M.library([M.builtin('boom', M.fixed(0), () => { throw thrown; })]);
  const crash = (thrown) => M.load('# main\n- call boom\n', { ...config, libraries: [boom(thrown)] }).run();
  assert.deepStrictEqual(crash(new Error('bad')), { ok: false, error: '"# main" crashed: bad' });
  assert.deepStrictEqual(crash('bad'), { ok: false, error: '"# main" crashed: bad' });
});
