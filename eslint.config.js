// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // jest.mock factories must use require(); imports are hoisted above the mock.
    files: ['**/__tests__/**', 'src/test-utils/**', 'src/db/test-utils/**'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  { ignores: ['dist/*', 'android/*', 'ios/*', 'drizzle/*', '.expo/*'] },
]);
