import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import unicorn from 'eslint-plugin-unicorn';
import prettier from 'eslint-plugin-prettier/recommended';

// eslint-disable-next-line @typescript-eslint/no-deprecated -- defineConfig not yet available in this version
export default tseslint.config(
    {
        ignores: ['**/dist/', '**/node_modules/']
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
        rules: {
            'unicorn/no-null': 'off',
            'unicorn/prevent-abbreviations': 'off',
            'unicorn/no-array-for-each': 'off',
            'unicorn/no-nested-ternary': 'off',
            'unicorn/no-process-exit': 'off',
            'unicorn/filename-case': 'off',
            'unicorn/no-lonely-if': 'off'
        }
    },
    {
        files: ['packages/core/test/**/*.ts', 'packages/middleware/*/test/**/*.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/no-non-null-assertion': 'off',
            '@typescript-eslint/no-floating-promises': 'off',
            'unicorn/consistent-function-scoping': 'off',
            '@typescript-eslint/require-await': 'off',
            'unicorn/no-useless-undefined': 'off'
        }
    },
    prettier
);
