const assert = require('assert');
const { multiply, capitalize, add } = require('./utils');

// Test basic multiplication
assert.strictEqual(multiply(2, 3), 6, 'multiply(2, 3) should equal 6');

// Test with zero
assert.strictEqual(multiply(5, 0), 0, 'multiply(5, 0) should equal 0');

// Test with negative numbers
assert.strictEqual(multiply(-2, 3), -6, 'multiply(-2, 3) should equal -6');
assert.strictEqual(multiply(-2, -3), 6, 'multiply(-2, -3) should equal 6');

// Test with one
assert.strictEqual(multiply(7, 1), 7, 'multiply(7, 1) should equal 7');

// Test with decimals
assert.strictEqual(multiply(2.5, 4), 10, 'multiply(2.5, 4) should equal 10');

// Test capitalize()
console.log('Testing capitalize()...');

assert.strictEqual(capitalize('hello'), 'Hello', 'capitalize("hello") should return "Hello"');
assert.strictEqual(capitalize('HELLO'), 'Hello', 'capitalize("HELLO") should return "Hello"');
assert.strictEqual(capitalize('hELLO'), 'Hello', 'capitalize("hELLO") should return "Hello"');
assert.strictEqual(capitalize('h'), 'H', 'capitalize("h") should return "H"');
assert.strictEqual(capitalize(''), '', 'capitalize("") should return ""');
assert.strictEqual(capitalize('a'), 'A', 'capitalize("a") should return "A"');

console.log('All capitalize() tests passed!');

// Test add() to ensure it still works
console.log('Testing add()...');

assert.strictEqual(add(2, 3), 5, 'add(2, 3) should return 5');
assert.strictEqual(add(0, 0), 0, 'add(0, 0) should return 0');
assert.strictEqual(add(-1, 1), 0, 'add(-1, 1) should return 0');

console.log('All add() tests passed!');
console.log('All tests passed!');
