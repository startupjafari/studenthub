import { defineConfig, devices } from '@playwright/test'

import { readEnv } from './e2e/support/test-env.cjs'

// E2E-стенд (задача 13.4). Поднимается на отдельных портах и отдельной БД (DATABASE_URL_TEST),
// чтобы прогон можно было запускать параллельно с обычным `pnpm dev` и не трогать рабочие данные.
// Схему тестовой БД готовит e2e/prepare-db.mjs — он запускается ДО playwright (скрипт `e2e`).

const WEB_PORT = 3100
const API_PORT = 3101
const API_URL = `http://localhost:${API_PORT}`

export default defineConfig({
  testDir: './e2e',
  // Именование флоу — <flow>.e2e.ts (FRONTEND_RULES §12); дефолтный шаблон Playwright
  // (*.spec.ts / *.test.ts) их не подхватывает, поэтому задаём свой.
  testMatch: /.*\.e2e\.ts$/,
  // В CI потолок выше: раннер медленнее машины разработчика, а на первый тест приходится
  // ещё и вход в систему (фикстура роли) — он идёт один раз на весь прогон.
  timeout: process.env.CI ? 120_000 : 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'ru-RU',
  },

  // Два проекта. `chromium` — обычные сценарии: авторизация живёт в фикстурах
  // (e2e/support/fixtures.ts), а не в storageState, поэтому делить прогон на роли через
  // projects незачем. `ui-audit` — широкая развёртка по всем экранам всех ролей
  // (e2e/ui-audit): она идёт десятки минут, и в обычном прогоне ей не место, поэтому у
  // проектов разные testMatch, а скрипты пакета всегда указывают проект явно.
  projects: [
    {
      name: 'chromium',
      testMatch: /.*\.e2e\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'ui-audit',
      testMatch: /.*\.audit\.ts$/,
      // Зона = один тест на сорок экранов по семь ширин каждый. Свой таймаут теста
      // выставляется внутри (test.setTimeout), здесь — потолок на всякий случай.
      timeout: 30 * 60_000,
      use: {
        ...devices['Desktop Chrome'],
        // Свои скриншоты аудит пишет сам в ui-audit/screenshots; дубли от Playwright
        // при падении шлагбаума только засоряют артефакты.
        screenshot: 'off',
      },
    },
  ],

  webServer: [
    {
      // Сборка в отдельный outDir (tsconfig.e2e.json) — иначе экземпляр для тестов и работающий
      // `pnpm dev` затирают друг другу ./dist.
      command: 'npx nest build -p tsconfig.e2e.json && node dist-e2e/main.js',
      cwd: '../api',
      port: API_PORT,
      // Тестовая БД: подставляется поверх apps/api/.env (dotenv не перетирает то, что уже
      // есть в process.env), поэтому dev-база прогоном не затрагивается. Источник тот же, что
      // у prepare-db.mjs — окружение, иначе apps/api/.env: без общего fallback'а api поднимался
      // с пустым DATABASE_URL, если переменной не было в шелле.
      env: {
        PORT: String(API_PORT),
        DATABASE_URL: readEnv('DATABASE_URL_TEST') ?? '',
        NODE_ENV: 'development',
        // Веб e2e-стенда живёт на своём порту — без него браузер режет запросы по CORS (§14.5).
        CORS_ORIGIN: `http://localhost:${WEB_PORT}`,
        // Штатный выключатель форса 2FA (env.schema.ts: «в e2e/тестах выключается»), тот же, что
        // в jest-стенде. Иначе ролям от декана API отвечает 403 TWO_FACTOR_SETUP_REQUIRED, пока у
        // аккаунта нет второго фактора, а seed создаёт сотрудников без него — недоступны сценарии
        // заявок, расписания и публикации поста. Само правило форса не теряется: оно покрыто
        // юнит-тестами TwoFactorGuard.
        TWO_FACTOR_ENFORCE: 'false',
        // Счётчик запросов считает ПО IP, а весь прогон идёт с одного адреса: общий лимит
        // 100/мин и вход 5/15 мин выбираются первыми же сценариями, после чего API
        // отвечает 429 на что попало — список чатов приходит пустым, вход не проходит, и
        // падения выглядят как ошибки вёрстки. В проде флаг не действует (app.module.ts).
        THROTTLE_DISABLED: 'true',
      },
      // Свежий процесс на каждый прогон: стенд должен подниматься на том коде, который
      // проверяют, а не на оставшемся от прошлого запуска.
      reuseExistingServer: false,
      timeout: 180_000,
      // Логи api — построчный JSON на каждый запрос; в отчёте прогона они топят полезное.
      // Ошибки старта всё равно видны: stderr Playwright показывает всегда.
      stdout: 'ignore',
    },
    {
      // В CI стенд поднимается на ПРОД-сборке, а не на `next dev`. Причина не в скорости
      // ради скорости: `next dev` компилирует страницу при первом заходе на неё, и на
      // холодном раннере это десятки секунд — сценарии падали по таймауту на компиляции,
      // а не на приложении, причём падал тот тест, которому не повезло зайти первым.
      // Сборка стоит около трёх минут один раз и снимает весь класс таких падений.
      //
      // Локально остаётся dev: там прогон запускают по горячим следам правки, и ждать
      // сборку на каждый запуск незачем.
      command: process.env.CI
        ? `npx next build && npx next start -p ${WEB_PORT}`
        : `npx next dev -p ${WEB_PORT}`,
      port: WEB_PORT,
      // Своя папка сборки — иначе прогон подерётся с работающим `pnpm dev` за общий .next.
      env: {
        NEXT_DIST_DIR: '.next-e2e',
        NEXT_PUBLIC_API_URL: `${API_URL}/api/v1`,
        NEXT_PUBLIC_WS_URL: API_URL,
        // Прод-сборка включает PWA, а на стенде он только мешает: service worker кэширует
        // страницы между тестами и переписывает public/sw.js (см. next.config.mjs).
        E2E: '1',
      },
      reuseExistingServer: !process.env.CI,
      // В CI в это время укладывается ещё и сборка.
      timeout: process.env.CI ? 600_000 : 180_000,
      stdout: 'ignore',
    },
  ],
})
