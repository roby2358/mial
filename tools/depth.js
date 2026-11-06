// Reports how far each JS call shape gets before a default V8 stack overflows, against
// DEPTH_LIMIT (D-11). Run with `just cc-depth`.
const M = require('../js/mial.js');

const PROGRAMS = {
  'plain recursion': '# f\n- n\n- f n\n',
  'through if and let': '# f\n- n\n- if `true`\n  - let\n    - vars\n      - x\n        - f n\n    - x\n',
  'through map': '# f\n- n\n- map\n  - lambda x\n    - f x\n  - list n\n',
  'through reduce and call': '# f\n- n\n- reduce\n  - lambda\n    - * a x\n    - call f x\n  - `0`\n  - list n\n',
  'through and': '# f\n- n\n- and\n  - f n\n',
};

const reached = (source) => {
  let low = 100;
  let high = 200000;
  while (high - low > 50) {
    const mid = Math.floor((low + high) / 2);
    const it = M.load(source, { libraries: [M.HOST], log: () => {}, stepLimit: 10000000, depthLimit: mid });
    const r = it.call('f', [M.num(1)]);
    if (r.error.includes('crashed')) high = mid;
    else low = mid;
  }
  return low;
};

for (const [name, source] of Object.entries(PROGRAMS)) {
  console.log(`${name}: survives depth ${reached(source)} (DEPTH_LIMIT ${M.DEPTH_LIMIT})`);
}
