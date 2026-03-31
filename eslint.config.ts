import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import unicorn from 'eslint-plugin-unicorn';
import importX from 'eslint-plugin-import-x';
import prettier from 'eslint-plugin-prettier/recommended';

// eslint-disable-next-line @typescript-eslint/no-deprecated -- defineConfig not yet available in this version
export default tseslint.config(
    {
        ignores: [
            '**/dist/',
            '**/node_modules/',
            'packages/core/test/bun/**',
            'packages/core/test/deno/**',
            'scripts/',
            'examples/nextjs/.next/',
            'examples/nextjs/next-env.d.ts',
            'packages/site/.next/',
            'packages/site/.source/',
            'packages/site/next-env.d.ts',
            'packages/site/*.config.*',
            'packages/site/scripts/'
        ]
    },
    eslint.configs.recommended,
    tseslint.configs.strictTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                project: 'tsconfig.eslint.json',
                tsconfigRootDir: import.meta.dirname
            }
        }
    },
    unicorn.configs['recommended'],
    {
        plugins: {
            'import-x': importX
        }
    },
    {
        rules: {
            'unicorn/no-null': 'off',
            'unicorn/prevent-abbreviations': 'off',
            'unicorn/no-array-for-each': 'off',
            'unicorn/no-nested-ternary': 'off',
            'unicorn/no-process-exit': 'off',
            'unicorn/filename-case': 'off',
            'unicorn/no-lonely-if': 'off',
            '@typescript-eslint/consistent-type-imports': ['error', { disallowTypeAnnotations: false }],
            'import-x/consistent-type-specifier-style': ['error', 'prefer-top-level']
        }
    },
    {
        files: [
            'packages/core/test/**/*.ts',
            'packages/redis/test/**/*.ts',
            'packages/middleware/*/test/**/*.ts',
            'packages/site/test/**/*.ts',
            'examples/*/test/**/*.ts',
            'examples/shared/**/*.ts'
        ],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/no-non-null-assertion': 'off',
            '@typescript-eslint/no-floating-promises': 'off',
            'unicorn/consistent-function-scoping': 'off',
            '@typescript-eslint/require-await': 'off',
            '@typescript-eslint/no-misused-promises': 'off',
            '@typescript-eslint/restrict-template-expressions': 'off',
            '@typescript-eslint/no-confusing-void-expression': 'off',
            'unicorn/no-useless-undefined': 'off'
        }
    },
    // Site app uses its own tsconfig (JSX + DOM types)
    {
        files: ['packages/site/src/**/*.ts', 'packages/site/src/**/*.tsx'],
        languageOptions: {
            parserOptions: {
                project: 'packages/site/tsconfig.typecheck.json',
                tsconfigRootDir: import.meta.dirname
            }
        }
    },
    prettier
);
