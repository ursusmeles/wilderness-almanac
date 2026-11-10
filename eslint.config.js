import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'dist/**',
      'tools/incremental-renderer/dist/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    rules: {
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: [
      'src/**/*.js',
      'functions/**/*.js',
      'e2e/**/*.js',
      'tools/incremental-renderer/src/**/*.js',
      'tools/incremental-renderer/scripts/compare.mjs',
    ],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['*.config.js', 'server/**/*.js', 'tests/**/*.js', 'e2e/**/*.js', 'tools/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: [
      'src/generation.js',
      'src/map-data.js',
      'src/generation/**/*.js',
      'src/application/**/*.js',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^three(?:/|$)|(?:^|/)(?:ui|rendering|persistence)(?:/|$)',
              message:
                'Keep world and campaign data independent of UI, rendering and storage adapters.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'ImportExpression[source.value=/^(three($|[\\u002F])|.*[\\u002F](ui|rendering|persistence)[\\u002F])/]',
          message:
            'Keep world and campaign data independent of UI, rendering and storage adapters.',
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'document', message: 'DOM access belongs in the UI or renderer lifecycle.' },
        { name: 'window', message: 'Pass browser services into the core through adapters.' },
        { name: 'navigator', message: 'Pass browser services into the core through adapters.' },
      ],
    },
  },
  {
    files: ['e2e/**/*.js'],
    rules: { 'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: true }] },
  },
];
