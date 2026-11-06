# StudentHub

[![codeChecks](https://github.com/startupjafari/studenthub/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/startupjafari/studenthub/actions/workflows/ci.yml)
[![codeqlScan](https://github.com/startupjafari/studenthub/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/startupjafari/studenthub/actions/workflows/codeql.yml)
[![prodSmoke](https://github.com/startupjafari/studenthub/actions/workflows/smoke.yml/badge.svg?branch=main)](https://github.com/startupjafari/studenthub/actions/workflows/smoke.yml)

Закрытая многоролевая образовательная платформа для университетов: академическая жизнь
(расписание, заявки в деканат, учебные материалы) и социальная активность (лента, чаты,
события) в одном приложении. Плюс карьера (работодатели и вакансии), библиотека, пост
охраны с камерами, помещения с QR, документы. 11 ролей — от администратора платформы до
студента, а также работодатель, охранник и библиотекарь (`docs/PROJECT.md §2`).
Регистрация **только по инвайтам**; единственное исключение — саморегистрация работодателя,
который видит студентов вуза только после допуска от этого вуза.

Монорепо (Turborepo + pnpm): `apps/api` — NestJS + Fastify + Prisma; `apps/web` — Next.js
(App Router, Feature-Sliced Design); рядом — лендинг, Telegram Mini App для админов платформы,
нативные клиенты iOS и Android и агент камер. Инфраструктура: PostgreSQL 16, Redis 7, MinIO.

> Источник истины по продукту, данным и API — [`docs/PROJECT.md`](docs/PROJECT.md).
> Правила разработки — [`docs/BACKEND_RULES.md`](docs/BACKEND_RULES.md),
> [`docs/FRONTEND_RULES.md`](docs/FRONTEND_RULES.md). Эксплуатация — [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

## Стек

- **Backend**: `@nestjs/platform-fastify`, `@prisma/client`, `zod` + `nestjs-zod`, `passport-jwt`
  - `bcrypt`, `@nestjs/bullmq` (Redis), `@nestjs/schedule`, `socket.io`, `minio`, `pino`, `nodemailer`.
- **Frontend**: Next.js (App Router), Tailwind + shadcn/ui, Redux Toolkit (auth/UI),
  TanStack Query, React Hook Form + Zod, axios, socket.io-client, recharts, next-intl (ru/kk/en).
- **Shared**: `packages/shared-types`, `shared-schemas` (единый Zod-контракт API↔формы),
  `shared-utils`, `shared-config`.
- **Прочие приложения**: `apps/landing` — Next.js + framer-motion; `apps/mini-app` — Vite +
  React (Telegram Mini App); `apps/ios` — Swift (XcodeGen, GRDB, Socket.IO);
  `apps/android` — Kotlin + Jetpack Compose + Material 3; `apps/camera-agent` — Node.js без
  зависимостей. Сборка и запуск мобильных клиентов — в их `README.md`.

## Предварительные требования

- Node.js 24+ (Active LTS), `pnpm` 10+
- Docker (для PostgreSQL / Redis / MinIO / Mailpit) — либо уже поднятые локальные инстансы

## Первый запуск (с чистого клона)

```bash
# 1. Зависимости
pnpm install

# 2. Инфраструктура (postgres:16, redis:7, minio, mailpit) — подробнее в docker/README.md
cp docker/dev/.env.example docker/dev/.env    # заполните пароли
pnpm infra:up                                 # ждёт, пока все сервисы станут healthy

# 3. Переменные окружения
cp apps/api/.env.example apps/api/.env        # проверьте DATABASE_URL / REDIS / MINIO
cp apps/web/.env.example apps/web/.env.local  # NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1

# 4. Схема БД (миграции) + демо-данные — из корня; DATABASE_URL берётся из apps/api/.env
pnpm db:deploy              # prisma migrate deploy
pnpm db:seed                # PLATFORM_ADMIN + демо-вуз/факультет/группа + dev-инвайт + КАТО

# 5. Запуск в dev
pnpm dev                    # api:3001 (/api/v1), web:3000, landing:3002, mini-app:3003
```

Проверка здоровья: `curl http://localhost:3001/api/v1/health` → `status: ok` по Prisma/Redis/MinIO.

### Учётные данные seed

```
PLATFORM_ADMIN: admin@studenthub.app / Admin1234!   (сменить сразу)
dev-инвайт UNIVERSITY_ADMIN: /register?token=seed-invite-university-admin-token
```

Порядок выдачи инвайтов при первом запуске — см. `docs/IMPLEMENTATION_PLAN.md` (Приложение Б):
PLATFORM_ADMIN → создать вуз → инвайт UNIVERSITY_ADMIN → факультеты/группы → DEAN/TEACHER →
STAROSTA/STUDENT. Отозвать dev-инвайт из seed.

## Команды

```bash
pnpm dev                              # api, web, landing, mini-app
pnpm build                            # сборка всего монорепо
pnpm start                            # собранное: api:3001, web:3000, landing:3002, mini-app:3003
pnpm lint                             # eslint по всему монорепо
pnpm typecheck                        # tsc --noEmit во всех пакетах

pnpm --filter api test                # unit
pnpm --filter api test:e2e            # e2e (нужен PostgreSQL: DATABASE_URL_TEST, схема через db push)
pnpm --filter api build               # nest build
pnpm --filter web build               # next build
pnpm --filter web test                # vitest
pnpm --filter web e2e                 # Playwright (DATABASE_URL_TEST, база сбрасывается)

pnpm infra:up | infra:down | infra:ps | infra:logs   # dev-стек docker/dev
pnpm cameras:up | cameras:down        # стенд камер (docker/camera-sim)
pnpm relay:up | relay:down            # ретранслятор видео камер (docker/media-relay)

# Prisma — только из корня (multi-file схема в prisma/schema/, конфиг prisma.config.ts).
# prisma.config.ts сам подхватывает DATABASE_URL из apps/api/.env, если он не задан окружением.
pnpm db:validate | db:format | db:status
pnpm db:deploy                        # prisma migrate deploy
pnpm db:seed                          # демо-сид (SEED_SCALE=demo)
pnpm db:seed:small | db:seed:full     # 5 / 100 вузов (full — ~22 млн строк)
pnpm db:seed:test                     # тестовый стенд: 1 вуз (docs/PROJECT.md §14.1)
pnpm db:seed:kato                     # только справочник КАТО (обычно уже залит db:seed)
pnpm db:seed:media                    # только медиа-пул сида в MinIO
pnpm db:seed:library                  # библиотека для уже засеянного вуза
pnpm db:reset:admin                   # очистить данные, оставить одного PLATFORM_ADMIN
```

Генерация новой миграции (интерактивный `migrate dev` не используем):

```bash
# ВНИМАНИЕ: --shadow-database-url должен указывать на ОТДЕЛЬНУЮ пустую БД, НЕ на dev
# (migrate diff сбрасывает shadow-БД). См. docs/RUNBOOK.md.
pnpm exec prisma migrate diff \
  --from-migrations prisma/migrations --to-schema-datamodel prisma/schema \
  --shadow-database-url postgresql://.../studenthub_shadow --script > \
  prisma/migrations/<ts>_<name>/migration.sql
pnpm db:deploy
```

## Структура

```
apps/
  api/           NestJS: src/modules/<feature> (controller/service/dto/spec), src/common/ (guards, interceptors,
                 prisma, queue, realtime); main.ts — HTTP, worker.ts — процесс-воркер медиа; openapi.json
  web/           Next.js FSD: src/{app,shared,entities,features,widgets,views,i18n} · messages/ (ru/kk/en) · e2e/
  landing/       публичный лендинг (Next.js, порт 3002)
  mini-app/      Telegram Mini App для PLATFORM_ADMIN / PLATFORM_MODERATOR (Vite + React, порт 3003)
  ios/           нативный клиент iPhone (Swift, project.yml для XcodeGen)
  android/       нативный клиент Android (Kotlin, Jetpack Compose)
  camera-agent/  агент камер в сети вуза: опрос платформы, проверка камер, видео на ретранслятор
packages/  shared-types · shared-schemas · shared-utils · shared-config
prisma/    schema/ (multi-file) · migrations/ · seed.mjs · seed/ (шаги генератора) · seed-test.mjs ·
           seed-library.mjs · reset-to-admin.mjs · e2e-fixture.mjs
docker/    README.md · dev/ · prod/ · shared/ · camera-sim/ · media-relay/
docs/      PROJECT.md · BACKEND_RULES.md · FRONTEND_RULES.md · IMPLEMENTATION_PLAN.md · DESIGN_SYSTEM.md ·
           RUNBOOK.md · RAILWAY.md · PERSONAL_DATA.md · SECURITY_AUDIT.md · RELEASE*.md · …
```

## Тестирование

- API: unit (`*.spec.ts`, Prisma мокается) + e2e (`test/*.e2e-spec.ts`, реальный PostgreSQL).
  Приоритет 🔴 (guard'ы, InviteService, автомат заявок, auth-flow) блокирует мёрж.
- Роли/scope покрыты unit-тестами по каждому модулю (кросс-scope, IDOR, недопустимые переходы).

## Мониторинг ошибок (Sentry)

Код подключён в обоих приложениях; включается **одной переменной на сервис** — без DSN SDK
не инициализируется, и dev/тесты/CI работают как раньше.

```bash
# api
SENTRY_DSN=https://<key>@o<org>.ingest.sentry.io/<project>
SENTRY_ENVIRONMENT=pilot        # необязательно, по умолчанию NODE_ENV
# web (DSN публичный — он только принимает события)
NEXT_PUBLIC_SENTRY_DSN=https://<key>@o<org>.ingest.sentry.io/<project>
```

Что попадает в трекер: HTTP-5xx, падения job'ов очередей и cron-задач, сбои WS-обработчиков,
ошибки серверного рендера и любые исключения в браузере. Ожидаемые отказы (401/403/404) —
не попадают. Персональные данные вырезаются перед отправкой (см. `docs/PROJECT.md §11.5`).

Необязательно, но полезно — читаемые стектрейсы вместо минифицированных: задать на сборке web
`SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` (загрузка source maps; без токена шаг
молча пропускается). Диагностика и проверка приватности — `docs/RUNBOOK.md`.

## Осталось к продакшн-деплою

Функционально v1.0 готов (Ф0–Ф13); сверх него сделаны документы, помещения с QR, КАТО,
карьера и библиотека (Ф15–Ф18, Ф20) — состояние по фазам в `docs/IMPLEMENTATION_PLAN.md §0.4`.
К моменту деплоя остаются организационные шаги:

- **Push-уведомления** — сгенерировать VAPID-ключи
  (`pnpm --filter api exec web-push generate-vapid-keys`) и положить в env api + web.
- **Sentry** — создать проект, положить DSN в переменные обоих сервисов (см. выше).
- Сменить пароль seed-админа, отозвать dev-инвайт, проверить восстановление из бэкапа
  (`docs/RUNBOOK.md`), убедиться, что Swagger закрыт (он только в `NODE_ENV=development`).
- Прогнать E2E: `pnpm --filter web e2e` (нужен отдельный `DATABASE_URL_TEST` — прогон делает
  `--force-reset` этой БД; на dev-данных запускать нельзя).

## Безопасность (кратко)

Регистрация только по инвайтам; три уровня guard (Jwt → Roles → Scope) + дублирующая проверка
scope в сервисах; access-токен в памяти, refresh — httpOnly+SameSite=Lax cookie с ротацией;
bcrypt cost 12; helmet; throttler; pino-redact для секретов. Полный чеклист — `docs/BACKEND_RULES.md §14`.
