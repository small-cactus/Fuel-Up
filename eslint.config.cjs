const reactPerf = require('eslint-plugin-react-perf');
const react = require('eslint-plugin-react');
const native = require('eslint-plugin-react-native');
const hooks = require('eslint-plugin-react-hooks');
module.exports = [{
  files: ['app/**/*.{js,jsx}', 'src/**/*.{js,jsx}'],
  ignores: ['src/services/fuel/shared/**'],
  languageOptions: { ecmaVersion: 2022, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
  plugins: { 'react-perf': reactPerf, react, 'react-native': native, 'react-hooks': hooks },
  settings: { react: { version: '19.2' } },
  rules: {
    ...Object.fromEntries(['jsx-no-new-object-as-prop', 'jsx-no-new-array-as-prop', 'jsx-no-new-function-as-prop', 'jsx-no-jsx-as-prop'].map(rule => ['react-perf/'+rule, 'warn'])),
    'react/no-array-index-key': 'warn', 'react/jsx-no-bind': 'warn',
    'react/jsx-no-constructed-context-values': 'warn', 'react/no-unstable-nested-components': 'error',
    'react/no-object-type-as-default-prop': 'warn',
    ...Object.fromEntries(['no-inline-styles','no-unused-styles','no-color-literals','no-single-element-style-arrays'].map(rule => ['react-native/'+rule, 'warn'])),
    'react-hooks/exhaustive-deps': 'warn', 'react-hooks/rules-of-hooks': 'error',
    'no-empty': ['error', { allowEmptyCatch: false }],
  },
}];
