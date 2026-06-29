module.exports = {
  root: true,
  reportUnusedDisableDirectives: false,
  env: {
    node: true,
    browser: true,
    es2021: true,
  },
  extends: [
    'plugin:vue/essential',
    'eslint:recommended',
  ],
  rules: {
    'max-len': 'off',
    'no-console': 'off',
    'no-unused-vars': 'warn',
    'vue/multi-word-component-names': 'off',
    'vue/no-mutating-props': 'off',
    'vue/no-reserved-component-names': 'off',
  },
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module',
  },
};
