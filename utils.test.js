const { add } = require('./utils');

// Test cases for add function
const tests = [
  { a: 2, b: 3, expected: 5, description: 'add(2, 3) returns 5' },
  { a: -1, b: 1, expected: 0, description: 'add(-1, 1) returns 0' },
  { a: 0, b: 0, expected: 0, description: 'add(0, 0) returns 0' },
  { a: -5, b: -3, expected: -8, description: 'add(-5, -3) returns -8' },
  { a: 100, b: 50, expected: 150, description: 'add(100, 50) returns 150' },
];

let passedTests = 0;
let failedTests = 0;

tests.forEach(test => {
  const result = add(test.a, test.b);
  if (result === test.expected) {
    console.log(`✓ ${test.description}`);
    passedTests++;
  } else {
    console.log(`✗ ${test.description} - got ${result}, expected ${test.expected}`);
    failedTests++;
  }
});

console.log(`\nTests passed: ${passedTests}/${tests.length}`);

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
