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

// Test 6: capitalize() should uppercase first character and lowercase the rest
assert.strictEqual(capitalize('hello'), 'Hello', "capitalize('hello') should equal 'Hello'");

// Test 7: capitalize() should return unchanged if already capitalized
assert.strictEqual(capitalize('Hello'), 'Hello', "capitalize('Hello') should equal 'Hello'");

// Test 8: capitalize() should handle all uppercase input
assert.strictEqual(capitalize('HELLO'), 'Hello', "capitalize('HELLO') should equal 'Hello'");

// Test 9: capitalize() should handle mixed case input
assert.strictEqual(capitalize('hELLO'), 'Hello', "capitalize('hELLO') should equal 'Hello'");

// Test 10: capitalize() should handle single lowercase character
assert.strictEqual(capitalize('a'), 'A', "capitalize('a') should equal 'A'");

// Test 11: capitalize() should handle single uppercase character
assert.strictEqual(capitalize('A'), 'A', "capitalize('A') should equal 'A'");

// Test 12: capitalize() should handle empty string
assert.strictEqual(capitalize(''), '', "capitalize('') should equal ''");

// Test 13: capitalize() should handle numbers and special characters at start
assert.strictEqual(capitalize('123abc'), '123abc', "capitalize('123abc') should equal '123abc'");

// Test 14: capitalize() should handle non-letter first character
assert.strictEqual(capitalize('!hello'), '!hello', "capitalize('!hello') should equal '!hello'");

// Test 15: capitalize() should handle whitespace only
assert.strictEqual(capitalize('   '), '   ', "capitalize('   ') should equal '   '");

console.log('All tests passed!');
