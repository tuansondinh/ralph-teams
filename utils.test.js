const assert = require('assert');
const { add, multiply, capitalize } = require('./utils');

// Test: add() returns sum of two numbers
assert.strictEqual(add(2, 3), 5, 'add(2, 3) should return 5');
assert.strictEqual(add(0, 0), 0, 'add(0, 0) should return 0');
assert.strictEqual(add(-1, 1), 0, 'add(-1, 1) should return 0');
assert.strictEqual(add(10, 20), 30, 'add(10, 20) should return 30');

// Test: multiply() returns product of two numbers
assert.strictEqual(multiply(2, 3), 6, 'multiply(2, 3) should return 6');
assert.strictEqual(multiply(0, 5), 0, 'multiply(0, 5) should return 0');
assert.strictEqual(multiply(-2, 3), -6, 'multiply(-2, 3) should return -6');
assert.strictEqual(multiply(10, 20), 200, 'multiply(10, 20) should return 200');

// Test: capitalize() uppercases first character and lowercases the rest
assert.strictEqual(capitalize('hello'), 'Hello', "capitalize('hello') should return 'Hello'");
assert.strictEqual(capitalize('WORLD'), 'World', "capitalize('WORLD') should return 'World'");
assert.strictEqual(capitalize('hELLO wORLD'), 'Hello world', "capitalize('hELLO wORLD') should return 'Hello world'");
assert.strictEqual(capitalize(''), '', "capitalize('') should return ''");

console.log('All tests passed!');
