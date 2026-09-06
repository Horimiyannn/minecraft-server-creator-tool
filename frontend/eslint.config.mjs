import next from 'eslint-config-next/core-web-vitals';
import prettier from 'eslint-config-prettier';

const eslintConfig = [
  ...next,
  prettier,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'prefer-const': 'error',
      // A module's `ui/` is private to that module.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/modules/*/ui', '@/modules/*/ui/*'],
              message:
                "Don't import another module's `ui/` internals — go through the module index, or lift it to @ui/@components.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
