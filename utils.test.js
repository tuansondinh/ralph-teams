const assert = require('node:assert/strict');
const { add, multiply } = require('./utils');

assert.strictEqual(add(2, 3), 5, 'add should sum positive operands');
assert.strictEqual(add(-4, -6), -10, 'add should sum negative operands');
assert.strictEqual(add(0, 0), 0, 'add should sum zero operands');
assert.strictEqual(multiply(2, 3), 6, 'multiply should multiply positive operands');
assert.strictEqual(multiply(-4, 5), -20, 'multiply should preserve operand signs');
assert.strictEqual(multiply(0, 9), 0, 'multiply should return zero when either operand is zero');
