function add(a, b) {
  return a + b;
}

function capitalize(str) {
  if (str === '') {
    return '';
  }

  return str[0].toUpperCase() + str.slice(1).toLowerCase();
}

module.exports = add;
module.exports.capitalize = capitalize;
