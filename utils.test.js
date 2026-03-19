const assert = require('node:assert/strict');
const { add, ...rest } = require('./utils');

assert.strictEqual(typeof add, 'function', 'utils should export add as a function');
assert.deepStrictEqual(rest, {}, 'utils should only export add');

assert.strictEqual(add(2, 3), 5, 'add should sum positive operands');
assert.strictEqual(add(-4, -6), -10, 'add should sum negative operands');
assert.strictEqual(add(0, 0), 0, 'add should sum zero operands');
