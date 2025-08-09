module.exports = {
  env: {
    browser: true,
    commonjs: true,
    es6: true,
    node: true,
    jest: true
  },
  extends: [
    'eslint:recommended'
  ],
  parserOptions: {
    ecmaVersion: 2018,
    sourceType: 'module'
  },
  rules: {
    // Relax some rules for existing codebase
    'no-redeclare': 'warn',
    'no-useless-escape': 'off', // Disabled due to false positives with regex
    'no-empty': 'warn',
    'no-dupe-keys': 'warn',
    'no-unused-vars': 'warn',
    'no-console': 'off'
  },
  // Ignore specific files with known issues
  ignorePatterns: [
    'static/assets/js/**/*.js',
    'node_modules/',
    'dist/',
    'build/',
    'coverage/',
    '*.min.js'
  ]
};