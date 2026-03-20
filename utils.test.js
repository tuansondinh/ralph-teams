const { test } = require('node:test');
const assert = require('node:assert');
const { add, multiply } = require('./utils');

test('add() returns the sum of two numbers', () => {
  assert.strictEqual(add(2, 3), 5);
  assert.strictEqual(add(0, 0), 0);
  assert.strictEqual(add(-1, 1), 0);
  assert.strictEqual(add(10, 20), 30);
});

test('multiply() returns the product of two numbers', () => {
  assert.strictEqual(multiply(2, 3), 6);
  assert.strictEqual(multiply(0, 5), 0);
  assert.strictEqual(multiply(-2, 3), -6);
  assert.strictEqual(multiply(10, 20), 200);
});
