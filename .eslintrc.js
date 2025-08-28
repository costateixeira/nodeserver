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
    'eslint:recommended',
    '@typescript-eslint/recommended' // Add this
  ],
  parser: '@typescript-eslint/parser', // Add this
  plugins: ['@typescript-eslint'], // Add this
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module'
  },
  globals: {
    BigInt: 'readonly'
  },
  rules: {
    // Your existing rules...
    "@typescript-eslint/no-floating-promises": "error", // Now this will work
    'no-loss-of-precision': 'warn'
  },
  ignorePatterns: [
    'static/assets/js/**/*.js',
    'node_modules/',
    'dist/',
    'build/',
    'coverage/',
    '*.min.js'
  ]
};