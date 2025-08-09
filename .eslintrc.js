module.exports = {
  env: {
    browser: false,
    node: true,
    es2021: true,
    jest: true
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module'
  },
  ignorePatterns: [
    '**/*.html',
    '**/*.css',
    'public/**',
    'node_modules/**',
    'coverage/**',
    'dist/**'
  ],
  rules: {
    'no-console': 'off',
    'no-unused-vars': ['warn', { 
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_' 
    }],
    'indent': ['warn', 2],
    'quotes': ['warn', 'single'],
    'semi': ['warn', 'always'],
    'no-undef': 'warn',
    'no-useless-escape': ['error', {
      'extra': ['/'] // Allow escaping forward slashes
    }]
  }
};