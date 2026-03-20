const assert = require('assert');
const { multiply } = require('./utils.js');

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

console.log('All tests passed!');
