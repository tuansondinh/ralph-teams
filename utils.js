function add(a, b) {
  return a + b;
}

function capitalize(str) {
  if (str.length === 0) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

module.exports = { add, capitalize };
