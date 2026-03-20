function add(a, b) {
  return a + b;
}

function capitalize(str) {
  if (str.length === 0) {
    return str;
  }
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function multiply(a, b) {
  return a * b;
}

module.exports = { add, capitalize, multiply };
