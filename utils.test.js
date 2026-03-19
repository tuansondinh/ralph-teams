const assert = require('assert');
const { add, capitalize } = require('./utils');

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

// Test 6: capitalize() should uppercase the first character and lowercase the rest
assert.strictEqual(capitalize('hello'), 'Hello', 'capitalize("hello") should equal "Hello"');

// Test 7: capitalize() should handle already capitalized strings
assert.strictEqual(capitalize('Hello'), 'Hello', 'capitalize("Hello") should equal "Hello"');

// Test 8: capitalize() should handle all uppercase strings
assert.strictEqual(capitalize('HELLO'), 'Hello', 'capitalize("HELLO") should equal "Hello"');

// Test 9: capitalize() should handle single character strings
assert.strictEqual(capitalize('a'), 'A', 'capitalize("a") should equal "A"');

// Test 10: capitalize() should handle single uppercase character strings
assert.strictEqual(capitalize('A'), 'A', 'capitalize("A") should equal "A"');

// Test 11: capitalize() should handle empty strings
assert.strictEqual(capitalize(''), '', 'capitalize("") should equal ""');

// Test 12: capitalize() should handle strings with numbers and special characters
assert.strictEqual(capitalize('hello world'), 'Hello world', 'capitalize("hello world") should equal "Hello world"');

// Test 13: capitalize() should handle mixed case with numbers
assert.strictEqual(capitalize('hELLO123'), 'Hello123', 'capitalize("hELLO123") should equal "Hello123"');

console.log('All tests passed!');
