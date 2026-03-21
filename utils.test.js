/**
 * Tests for utils.js
 */

const { add, multiply, capitalize } = require('./utils.js');
const assert = require('assert');

// Test add function with positive numbers
assert.strictEqual(add(2, 3), 5, 'add(2, 3) should return 5');

// Test add function with negative numbers
assert.strictEqual(add(-2, 3), 1, 'add(-2, 3) should return 1');
assert.strictEqual(add(-2, -3), -5, 'add(-2, -3) should return -5');

// Test add function with zero
assert.strictEqual(add(0, 0), 0, 'add(0, 0) should return 0');
assert.strictEqual(add(5, 0), 5, 'add(5, 0) should return 5');
assert.strictEqual(add(0, 5), 5, 'add(0, 5) should return 5');

// Test add function with decimals
assert.strictEqual(add(1.5, 2.5), 4, 'add(1.5, 2.5) should return 4');
assert.strictEqual(add(0.1, 0.2) > 0.29 && add(0.1, 0.2) < 0.31, true, 'add(0.1, 0.2) should be approximately 0.3');

// Test multiply function with positive numbers
assert.strictEqual(multiply(2, 3), 6, 'multiply(2, 3) should return 6');
assert.strictEqual(multiply(5, 4), 20, 'multiply(5, 4) should return 20');

// Test multiply function with negative numbers
assert.strictEqual(multiply(-2, 3), -6, 'multiply(-2, 3) should return -6');
assert.strictEqual(multiply(-2, -3), 6, 'multiply(-2, -3) should return 6');

// Test multiply function with zero
assert.strictEqual(multiply(0, 0), 0, 'multiply(0, 0) should return 0');
assert.strictEqual(multiply(5, 0), 0, 'multiply(5, 0) should return 0');
assert.strictEqual(multiply(0, 5), 0, 'multiply(0, 5) should return 0');

// Test multiply function with decimals
assert.strictEqual(multiply(1.5, 2), 3, 'multiply(1.5, 2) should return 3');
assert.strictEqual(multiply(2.5, 4), 10, 'multiply(2.5, 4) should return 10');

// Test capitalize function with normal strings
assert.strictEqual(capitalize('hello'), 'Hello', 'capitalize("hello") should return "Hello"');
assert.strictEqual(capitalize('WORLD'), 'World', 'capitalize("WORLD") should return "World"');
assert.strictEqual(capitalize('HeLLo'), 'Hello', 'capitalize("HeLLo") should return "Hello"');

// Test capitalize function with single character
assert.strictEqual(capitalize('a'), 'A', 'capitalize("a") should return "A"');
assert.strictEqual(capitalize('Z'), 'Z', 'capitalize("Z") should return "Z"');

// Test capitalize function with special cases
assert.strictEqual(capitalize('hello world'), 'Hello world', 'capitalize("hello world") should return "Hello world"');
assert.strictEqual(capitalize('123abc'), '123abc', 'capitalize("123abc") should return "123abc"');
assert.strictEqual(capitalize(''), '', 'capitalize("") should return ""');

console.log('✓ All tests passed!');
