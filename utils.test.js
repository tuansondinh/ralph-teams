const assert = require('assert');
const { add } = require('./utils');

// Test: add() returns sum of two numbers
assert.strictEqual(add(2, 3), 5, 'add(2, 3) should return 5');
assert.strictEqual(add(0, 0), 0, 'add(0, 0) should return 0');
assert.strictEqual(add(-1, 1), 0, 'add(-1, 1) should return 0');
assert.strictEqual(add(10, 20), 30, 'add(10, 20) should return 30');

console.log('All tests passed!');
