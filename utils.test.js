const assert = require('node:assert/strict');
const utils = require('./utils');

assert.deepStrictEqual(
  Object.keys(utils).sort(),
  ['add', 'capitalize', 'multiply'],
  'utils should export add, capitalize, and multiply',
);

assert.strictEqual(typeof utils.add, 'function', 'add should be exported as a function');
assert.strictEqual(utils.add(2, 3), 5, 'add should sum positive operands');
assert.strictEqual(utils.add(-4, -6), -10, 'add should sum negative operands');
assert.strictEqual(utils.add(0, 0), 0, 'add should sum zero operands');

assert.strictEqual(
  typeof utils.capitalize,
  'function',
  'capitalize should be exported as a function',
);

assert.strictEqual(
  utils.capitalize('ralph-teams'),
  'Ralph-teams',
  'capitalize should uppercase the first char and lowercase the rest',
);

assert.strictEqual(
  utils.capitalize('ALREADY'),
  'Already',
  'capitalize should lowercase everything after the first char',
);

assert.strictEqual(
  utils.capitalize('a'),
  'A',
  'capitalize should handle single-character strings',
);

assert.strictEqual(
  typeof utils.multiply,
  'function',
  'multiply should be exported as a function',
);
assert.strictEqual(utils.multiply(2, 3), 6, 'multiply should multiply positive operands');
assert.strictEqual(utils.multiply(-4, 5), -20, 'multiply should preserve operand signs');
assert.strictEqual(utils.multiply(0, 7), 0, 'multiply should return zero when an operand is zero');
