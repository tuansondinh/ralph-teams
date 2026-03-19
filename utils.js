function add(a, b) {
  return a + b;
}

function capitalize(str = '') {
  const input = String(str);
  if (input === '') {
    return '';
  }

  const firstChar = input[0].toUpperCase();
  const rest = input.slice(1).toLowerCase();
  return `${firstChar}${rest}`;
}

module.exports = { add, capitalize };
