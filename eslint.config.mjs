import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

// Единый ESLint (flat config) для всего монорепо.
// Правила §16: no-console — warn, @typescript-eslint/no-explicit-any — error.
// Форматирование отдано Prettier — eslint-config-prettier снимает конфликтующие правила.
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      // Сборка api для e2e-стенда (отдельный outDir, чтобы не драться с работающим `pnpm dev`).
      '**/dist-e2e/**',
      '**/build/**',
      '**/.next/**',
      '**/.next-e2e/**',
      '**/out/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/next-env.d.ts',
      // Сгенерированные next-pwa service-worker артефакты (задача 13.2) — не линтуем.
      '**/public/sw.js',
      '**/public/sw.js.map',
      '**/public/workbox-*.js',
      '**/public/fallback-*.js',
      '**/public/swe-worker-*.js',
      // Кастомный SW (customWorkerSrc, Web Push Ф13.3) — компилируется в public/worker-*.js.
      '**/public/worker-*.js',
      '**/public/worker-*.js.map',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Общие правила — ДО блоков с `files`: в flat config побеждает последний подходящий блок,
  // поэтому этот набор должен идти раньше точечных послаблений (иначе `no-console: 'off'`
  // для Node-скриптов ниже перебивался бы обратно на 'warn').
  {
    rules: {
      'no-console': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
      // Аргументы/переменные с префиксом _ считаются намеренно неиспользуемыми.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // CommonJS-файлы (jest-конфиги, e2e-инфраструктура): require/module/exports разрешены.
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        module: 'writable',
        require: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
      },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Node-скрипты (seed и пр.): console/process разрешены.
    files: ['prisma/**/*.mjs', 'apps/web/e2e/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', URL: 'readonly' },
    },
    rules: { 'no-console': 'off' },
  },
  {
    // Конфиг-файлы (next.config.mjs и т.п.) выполняются в Node — глобалы process/URL и пр.
    files: ['**/*.config.mjs', '**/*.config.js'],
    languageOptions: {
      globals: { process: 'readonly', URL: 'readonly', __dirname: 'readonly', console: 'readonly' },
    },
  },
  prettier,
)
