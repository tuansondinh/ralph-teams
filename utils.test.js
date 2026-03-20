const { test } = require('node:test');
const assert = require('node:assert');
const { add } = require('./utils');

test('add() returns the sum of two numbers', () => {
  assert.strictEqual(add(2, 3), 5);
  assert.strictEqual(add(0, 0), 0);
  assert.strictEqual(add(-1, 1), 0);
  assert.strictEqual(add(10, 20), 30);
});
