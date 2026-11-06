// D-5: js/mial.js must load as a plain script (no module system), exposing the global Mial.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('a plain script gets the global Mial and can run a program', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'mial.js'), 'utf8'), context);
  const result = vm.runInContext(`
    const it = Mial.load('# main\\n- + \`1\` \`2\`\\n', { libraries: [Mial.HOST], log: () => {}, stepLimit: Mial.STEP_LIMIT, depthLimit: Mial.DEPTH_LIMIT });
    Mial.show(it.run().value);
  `, context);
  assert.strictEqual(result, '3');
});
