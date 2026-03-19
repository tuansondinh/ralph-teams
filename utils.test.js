const assert = require('node:assert/strict');
const { add, multiply, ...rest } = require('./utils');

assert.strictEqual(typeof add, 'function', 'utils should export add as a function');
assert.strictEqual(typeof multiply, 'function', 'utils should export multiply as a function');
assert.deepStrictEqual(rest, {}, 'utils should only export add and multiply');

assert.strictEqual(add(2, 3), 5, 'add should sum positive operands');
assert.strictEqual(add(-4, -6), -10, 'add should sum negative operands');
assert.strictEqual(add(0, 0), 0, 'add should sum zero operands');

assert.strictEqual(multiply(2, 3), 6, 'multiply should handle positive operands');
assert.strictEqual(multiply(-2, 3), -6, 'multiply should handle negative operands');
assert.strictEqual(multiply(0, 5), 0, 'multiply should handle zero operands');
