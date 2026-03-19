const assert = require('node:assert/strict');
const utils = require('./utils');

assert.deepStrictEqual(
  Object.keys(utils),
  ['add'],
  'utils should only export add for US-001',
);

assert.strictEqual(typeof utils.add, 'function', 'add should be exported as a function');
assert.strictEqual(utils.add(2, 3), 5, 'add should sum positive operands');
assert.strictEqual(utils.add(-4, -6), -10, 'add should sum negative operands');
assert.strictEqual(utils.add(0, 0), 0, 'add should sum zero operands');
