function add(a, b) {
  return a + b;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function multiply(a, b) {
  const result = a * b;
  return result === 0 ? 0 : result;
}

module.exports = { add, capitalize, multiply };
