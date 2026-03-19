const assert = require('node:assert/strict');
const { add, capitalize, ...rest } = require('./utils');

assert.strictEqual(typeof add, 'function', 'utils should export add as a function');
assert.strictEqual(
  typeof capitalize,
  'function',
  'utils should export capitalize as a function'
);
assert.deepStrictEqual(rest, {}, 'utils should only export add and capitalize');

assert.strictEqual(add(2, 3), 5, 'add should sum positive operands');
assert.strictEqual(add(-4, -6), -10, 'add should sum negative operands');
assert.strictEqual(add(0, 0), 0, 'add should sum zero operands');

assert.strictEqual(capitalize('hello'), 'Hello', 'capitalize should uppercase the first letter');
assert.strictEqual(capitalize('hELLO'), 'Hello', 'capitalize should lowercase the remaining letters');
assert.strictEqual(capitalize('a'), 'A', 'capitalize should handle single-character strings');
assert.strictEqual(capitalize(''), '', 'capitalize should handle empty strings');
