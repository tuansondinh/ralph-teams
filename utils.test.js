const assert = require('assert');
const { add, multiply } = require('./utils');

// Test 1: add() should return the sum of two positive numbers
assert.strictEqual(add(2, 3), 5, 'add(2, 3) should equal 5');

// Test 2: add() should return the sum of two negative numbers
assert.strictEqual(add(-1, -1), -2, 'add(-1, -1) should equal -2');

// Test 3: add() should return the sum of a positive and negative number
assert.strictEqual(add(10, -5), 5, 'add(10, -5) should equal 5');

// Test 4: add() should return the sum of zero and a number
assert.strictEqual(add(0, 5), 5, 'add(0, 5) should equal 5');

// Test 5: add() should return the sum of two zeros
assert.strictEqual(add(0, 0), 0, 'add(0, 0) should equal 0');

// Test 6: multiply() should return the product of two positive numbers
assert.strictEqual(multiply(2, 3), 6, 'multiply(2, 3) should equal 6');

// Test 7: multiply() should return the product of two negative numbers
assert.strictEqual(multiply(-1, -1), 1, 'multiply(-1, -1) should equal 1');

// Test 8: multiply() should return the product of a positive and negative number
assert.strictEqual(multiply(10, -5), -50, 'multiply(10, -5) should equal -50');

// Test 9: multiply() should return the product of zero and a positive number
assert.strictEqual(multiply(0, 5), 0, 'multiply(0, 5) should equal 0');

// Test 10: multiply() should return the product of two zeros
assert.strictEqual(multiply(0, 0), 0, 'multiply(0, 0) should equal 0');

console.log('All tests passed!');
