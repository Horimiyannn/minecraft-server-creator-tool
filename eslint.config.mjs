// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'backend/src/generated/**',
      'backend/prisma/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Allow the destructure-omit pattern (`const { secret, ...rest } = x`)
    // and intentionally-unused `_`-prefixed bindings.
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          ignoreRestSiblings: true,
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // Plain CommonJS config files (e.g. backend/jest.config.js) aren't
    // parsed by TS-ESLint's module-source-type assumption; give them
    // the Node/CJS globals so `module`/`require` aren't flagged.
    files: ['**/*.config.js', '**/.*rc.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        module: 'writable',
        exports: 'writable',
        require: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
      },
    },
  },
  prettier,
);
