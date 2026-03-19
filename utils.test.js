const assert = require('node:assert/strict');
const utils = require('./utils');

assert.strictEqual(typeof utils.add, 'function', 'add should be exported as a function');
assert.strictEqual(utils.add(2, 3), 5, 'add should sum positive operands');
assert.strictEqual(utils.add(-4, -6), -10, 'add should sum negative operands');
assert.strictEqual(utils.add(0, 0), 0, 'add should sum zero operands');

assert.deepStrictEqual(
  Object.keys(utils).sort(),
  ['add', 'capitalize'],
  'utils should export add and capitalize for US-003',
);

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
