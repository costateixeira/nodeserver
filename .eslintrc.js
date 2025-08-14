module.exports = {
  env: {
    browser: true,
    commonjs: true,
    es6: true,
    es2022: true,
    node: true,
    jest: true
  },
  extends: [
    'eslint:recommended'
  ],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module'
  },
  globals: {
    BigInt: 'readonly'
  },
  rules: {
    // Relax some rules for existing codebase
    'no-redeclare': 'warn',
    'no-useless-escape': 'off', // Disabled due to false positives with regex
    'no-empty': 'warn',
    'no-dupe-keys': 'warn',
    'no-unused-vars': 'warn',
    'no-console': 'off',
    'no-loss-of-precision': 'warn' // Allow large numbers with precision loss as warning
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