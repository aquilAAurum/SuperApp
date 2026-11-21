// ESLint flat config (HB-QUAL-01). Extends the Core v4 template rules (reimagined-bassoon
// core/template-repo/eslint.config.js) and encodes the spec's architecture rules as lint errors.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';

const XSS_SINKS = [
  { selector: "AssignmentExpression[left.property.name='innerHTML']", message: 'HB-SEC-04: use textContent / DOM APIs (XSS).' },
  { selector: "AssignmentExpression[left.property.name='outerHTML']", message: 'HB-SEC-04: use DOM APIs (XSS).' },
  { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: 'HB-SEC-04: use DOM APIs (XSS).' },
  { selector: "CallExpression[callee.object.name='document'][callee.property.name='write']", message: 'HB-SEC-04: document.write is banned.' },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/release/**',
      '**/test-results/**',
      '**/playwright-report/**',
      'apps/shell/android/**',
      'apps/shell/public/builtin/**',
      'server/pb_data/**',
      'server/bin/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser, ...globals.node } },
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-alert': 'error', // CORE-24: non-blocking feedback only
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-restricted-syntax': ['error', ...XSS_SINKS],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'svelte/no-at-html-tags': 'error', // HB-SEC-04 in Svelte templates
    },
  },
  {
    files: ['**/*.svelte'],
    languageOptions: { parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.svelte'] } },
  },
  // Spec implementation note 2: native plugins only inside the CapabilityBroker; server SDK only in src/server/.
  {
    files: ['apps/shell/src/**/*.{ts,svelte}'],
    ignores: ['apps/shell/src/native/**', 'apps/shell/src/server/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@capacitor/*', '@aparajita/*', '@capacitor-community/*'], message: 'Native plugins are only imported in src/native/CapabilityBroker.ts.' },
            { group: ['pocketbase'], message: 'Server calls live in src/server/.' },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/shell/src/server/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['@capacitor/*', '@aparajita/*'], message: 'Use the CapabilityBroker via injection.' }] }],
    },
  },
  // Spec implementation note 3: subapps depend only on @superapp/sdk.
  {
    files: ['subapps/**/*.{ts,svelte,js}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@superapp/shell', '@superapp/shell/*', '**/apps/shell/**'], message: 'Subapps may not import the shell; use @superapp/sdk.' },
            { group: ['@capacitor/*', 'pocketbase', '@superapp/contracts', '@superapp/contracts/*'], message: 'Subapps reach everything through @superapp/sdk.' },
          ],
        },
      ],
    },
  },
  // PocketBase JSVM hooks/migrations run in goja with injected globals.
  {
    files: ['server/pb_hooks/**/*.js', 'server/pb_migrations/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { migrate: 'readonly', Collection: 'readonly', Record: 'readonly', routerAdd: 'readonly', onRecordUpdate: 'readonly', onRecordCreate: 'readonly', onRecordUpdateRequest: 'readonly', onRecordCreateRequest: 'readonly', cronAdd: 'readonly', $app: 'readonly', $apis: 'readonly', $security: 'readonly', $os: 'readonly', __hooks: 'readonly', DynamicModel: 'readonly', BadRequestError: 'readonly', NotFoundError: 'readonly', ForbiddenError: 'readonly', ApiError: 'readonly', module: 'writable', require: 'readonly', toString: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['**/*.test.{ts,mjs,js}', '**/tests/**/*.{ts,mjs,js}', 'tools/**/*.mjs', '**/*.config.{ts,js}'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
