// Prettier has no `extends`: this spreads the root config (the shared
// baseline every workspace inherits) and overrides only what front needs
// (a wider print width, plus the Angular HTML parser override).
module.exports = {
  ...require('../.prettierrc.json'),
  printWidth: 100,
  overrides: [
    {
      files: '*.html',
      options: { parser: 'angular' },
    },
  ],
};
