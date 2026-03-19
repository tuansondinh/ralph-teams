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
assert.strictEqual(multiply(-2, -3), 6, 'multiply(-2, -3) should equal 6');

// Test 8: multiply() should return the product of a positive and a negative number
assert.strictEqual(multiply(4, -5), -20, 'multiply(4, -5) should equal -20');

// Test 9: multiply() should return zero when multiplying zero and a number
assert.strictEqual(multiply(0, 7), 0, 'multiply(0, 7) should equal 0');

// Test 10: multiply() should return zero when multiplying two zeros
assert.strictEqual(multiply(0, 0), 0, 'multiply(0, 0) should equal 0');

// Test 11: multiply() should return the number when multiplying by one (identity)
assert.strictEqual(multiply(9, 1), 9, 'multiply(9, 1) should equal 9');

console.log('All tests passed!');
