const baseConfig = {
  root: true,
  env: {
    node: true,
    browser: true,
    es2021: true,
  },
  extends: ['eslint:recommended', 'prettier'],
  plugins: ['import', 'unused-imports'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: './tsconfig.eslint.json',
  },
  rules: {
    'import/order': [
      'error',
      {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object', 'type'],
        'newlines-between': 'always',
        alphabetize: {
          order: 'asc',
          caseInsensitive: true,
        },
        warnOnUnassignedImports: true,
      },
    ],

    'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    'no-debugger': process.env.NODE_ENV === 'production' ? 'warn' : 'off',

    // Additional eslint rules
    'no-await-in-loop': 'warn',
    'no-promise-executor-return': 'error',
    'no-self-compare': 'error',
    'no-extend-native': 'error',
    'no-alert': 'error',
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-invalid-this': 'off',
    'no-unused-expressions': 'off',
    'no-unused-vars': 'off',
    'unused-imports/no-unused-imports': 'error',
    'unused-imports/no-unused-vars': [
      'warn',
      {
        vars: 'all',
        varsIgnorePattern: '^_',
        args: 'after-used',
        argsIgnorePattern: '^_',
      },
    ],
    'vue/no-multiple-template-root': 'off',
    'vue/no-v-html': 'off',
    'vue/no-v-model-argument': 'off',
  },
}

module.exports = {
  ...baseConfig,
  overrides: [
    {
      files: ['*.ts', '*.tsx'],
      extends: ['plugin:@typescript-eslint/recommended', ...baseConfig.extends],
      parser: '@typescript-eslint/parser',
      rules: {
        ...baseConfig.rules,
        '@typescript-eslint/consistent-type-imports': [
          'error',
          {
            fixStyle: 'inline-type-imports',
          },
        ],
        '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
        '@typescript-eslint/no-explicit-any': 'warn',
        '@typescript-eslint/no-unused-expressions': 'error',
        '@typescript-eslint/no-var-requires': 'error',
        '@typescript-eslint/consistent-type-definitions': ['warn', 'type'],
        '@typescript-eslint/ban-ts-comment': 'warn',
        '@typescript-eslint/prefer-as-const': 'warn',
        '@typescript-eslint/no-inferrable-types': 'warn',
        '@typescript-eslint/ban-types': 'off',
        '@typescript-eslint/camelcase': 'off',
        '@typescript-eslint/explicit-module-boundary-types': 'off',
      },
    },
    {
      files: ['*.vue'],
      extends: ['plugin:vue/recommended', ...baseConfig.extends],
      parser: 'vue-eslint-parser',
      parserOptions: {
        parser: { ts: require('typescript-eslint-parser-for-extra-files') },
        project: './tsconfig.eslint.json',
      },
      rules: {
        ...baseConfig.rules,
        // Check for unsupported Vue features (always keep aligned to yarn.lock'ed version)
        'vue/no-unsupported-features': ['error', { version: '3.4.21' }],

        //https://eslint.vuejs.org/rules/
        'vue/html-button-has-type': 'error',
        'vue/next-tick-style': ['error', 'callback'],
        'vue/match-component-import-name': 'warn',
        'vue/multi-word-component-names': 'warn',
        'vue/no-bare-strings-in-template': 'warn',
        'vue/no-duplicate-attr-inheritance': 'warn',
        'vue/no-template-target-blank': 'warn',
        'vue/no-this-in-before-route-enter': 'warn',
        'vue/require-name-property': 'warn',
        'vue/no-v-for-template-key': 'off',

        'vue/no-constant-condition': 'warn',
        'vue/no-empty-pattern': 'warn',
        'vue/no-irregular-whitespace': 'warn',
        'vue/no-loss-of-precision': 'warn',
        'vue/no-sparse-arrays': 'warn',
        'vue/no-useless-concat': 'warn',
        // If you want to add or change anything, feel free to propose it.
      },
    },
  ],
}
