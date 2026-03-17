const { add, multiply, capitalize } = require('./utils');

// Test cases for add function
const addTests = [
  { a: 2, b: 3, expected: 5, description: 'add(2, 3) returns 5' },
  { a: -1, b: 1, expected: 0, description: 'add(-1, 1) returns 0' },
  { a: 0, b: 0, expected: 0, description: 'add(0, 0) returns 0' },
  { a: -5, b: -3, expected: -8, description: 'add(-5, -3) returns -8' },
  { a: 100, b: 50, expected: 150, description: 'add(100, 50) returns 150' },
];

let passedTests = 0;
let failedTests = 0;

addTests.forEach(test => {
  const result = add(test.a, test.b);
  if (result === test.expected) {
    console.log(`✓ ${test.description}`);
    passedTests++;
  } else {
    console.log(`✗ ${test.description} - got ${result}, expected ${test.expected}`);
    failedTests++;
  }
});

// Test cases for multiply function
const multiplyTests = [
  { a: 2, b: 3, expected: 6, description: 'multiply(2, 3) returns 6' },
  { a: -1, b: 4, expected: -4, description: 'multiply(-1, 4) returns -4' },
  { a: 0, b: 5, expected: 0, description: 'multiply(0, 5) returns 0' },
  { a: -3, b: -3, expected: 9, description: 'multiply(-3, -3) returns 9' },
  { a: 7, b: 8, expected: 56, description: 'multiply(7, 8) returns 56' },
];

multiplyTests.forEach(test => {
  const result = multiply(test.a, test.b);
  if (result === test.expected) {
    console.log(`✓ ${test.description}`);
    passedTests++;
  } else {
    console.log(`✗ ${test.description} - got ${result}, expected ${test.expected}`);
    failedTests++;
  }
});

// Test cases for capitalize function
const capitalizeTests = [
  { input: 'hello', expected: 'Hello', description: 'capitalize("hello") returns "Hello"' },
  { input: 'hELLO', expected: 'Hello', description: 'capitalize("hELLO") returns "Hello"' },
  { input: 'Hello', expected: 'Hello', description: 'capitalize("Hello") returns "Hello"' },
  { input: 'a', expected: 'A', description: 'capitalize("a") returns "A"' },
  { input: '', expected: '', description: 'capitalize("") returns ""' },
];

capitalizeTests.forEach(test => {
  const result = capitalize(test.input);
  if (result === test.expected) {
    console.log(`✓ ${test.description}`);
    passedTests++;
  } else {
    console.log(`✗ ${test.description} - got ${result}, expected ${test.expected}`);
    failedTests++;
  }
});

const totalTests = addTests.length + multiplyTests.length + capitalizeTests.length;
console.log(`\nTests passed: ${passedTests}/${totalTests}`);

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
