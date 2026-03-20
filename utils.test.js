const { test } = require('node:test');
const assert = require('node:assert');
const { add, capitalize, multiply } = require('./utils');

test('add() returns the sum of two numbers', () => {
  assert.strictEqual(add(2, 3), 5);
  assert.strictEqual(add(0, 0), 0);
  assert.strictEqual(add(-1, 1), 0);
  assert.strictEqual(add(10, 20), 30);
});

test('capitalize() uppercases first character and lowercases the rest', () => {
  assert.strictEqual(capitalize('hello'), 'Hello');
  assert.strictEqual(capitalize('HELLO'), 'Hello');
  assert.strictEqual(capitalize('hELLO'), 'Hello');
  assert.strictEqual(capitalize('HeLLo'), 'Hello');
});

test('capitalize() handles single character', () => {
  assert.strictEqual(capitalize('a'), 'A');
  assert.strictEqual(capitalize('Z'), 'Z');
});

test('capitalize() handles empty string', () => {
  assert.strictEqual(capitalize(''), '');
});

test('capitalize() handles single uppercase character', () => {
  assert.strictEqual(capitalize('H'), 'H');
});

test('multiply() returns the product of two numbers', () => {
  assert.strictEqual(multiply(2, 3), 6);
  assert.strictEqual(multiply(0, 5), 0);
  assert.strictEqual(multiply(-2, 3), -6);
  assert.strictEqual(multiply(10, 20), 200);
});
