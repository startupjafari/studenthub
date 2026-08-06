# StudentHub

Закрытая многоролевая образовательная платформа для университетов: академическая жизнь
(расписание, заявки в деканат, учебные материалы) и социальная активность (лента, чаты,
события) в одном приложении. 8 ролей, регистрация **только по инвайтам**.

Монорепо (Turborepo + pnpm): `apps/api` — NestJS + Fastify + Prisma; `apps/web` — Next.js
(App Router, Feature-Sliced Design). Инфраструктура: PostgreSQL 16, Redis 7, MinIO.

> Источник истины по продукту, данным и API — [`docs/PROJECT.md`](docs/PROJECT.md).
> Правила разработки — [`docs/BACKEND_RULES.md`](docs/BACKEND_RULES.md),
> [`docs/FRONTEND_RULES.md`](docs/FRONTEND_RULES.md). Эксплуатация — [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

## Стек

- **Backend**: `@nestjs/platform-fastify`, `@prisma/client`, `zod` + `nestjs-zod`, `passport-jwt`
  - `bcrypt`, `@nestjs/bullmq` (Redis), `@nestjs/schedule`, `socket.io`, `minio`, `pino`, `nodemailer`.
- **Frontend**: Next.js (App Router), Tailwind + shadcn/ui, Redux Toolkit (auth/UI),
  TanStack Query, React Hook Form + Zod, axios, socket.io-client, chart.js, next-intl (ru/kk/en).
- **Shared**: `packages/shared-types`, `shared-schemas` (единый Zod-контракт API↔формы),
  `shared-utils`, `shared-config`.

## Предварительные требования

- Node.js 20+, `pnpm` 10+
- Docker (для PostgreSQL / Redis / MinIO) — либо уже поднятые локальные инстансы

## Первый запуск (с чистого клона)

```bash
# 1. Зависимости
pnpm install

# 2. Инфраструктура (postgres:16, redis:7, minio)
docker compose -f docker/docker-compose.yml up -d postgres redis minio
#    Дождитесь healthy: docker compose -f docker/docker-compose.yml ps

# 3. Переменные окружения
cp apps/api/.env.example apps/api/.env        # проверьте DATABASE_URL / REDIS / MINIO
cp apps/web/.env.example apps/web/.env.local  # NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1

# 4. Схема БД (миграции) + демо-данные
export DATABASE_URL="postgresql://<user>:<pass>@localhost:5432/studenthub"
pnpm --filter api exec prisma migrate deploy
node prisma/seed.mjs        # создаёт PLATFORM_ADMIN + демо-вуз/факультет/группу + dev-инвайт

# 5. Запуск в dev
pnpm dev                    # api:3001 (/api/v1), web:3000
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
pnpm dev                              # api + web
pnpm build                            # сборка всего монорепо
pnpm lint                             # eslint по всему монорепо

pnpm --filter api test                # unit
pnpm --filter api test:e2e            # e2e (нужен PostgreSQL; схема через db push)
pnpm --filter api build               # nest build
pnpm --filter web build               # next build

# Prisma (multi-file схема в prisma/schema/, prisma.config.ts НЕ грузит .env автоматически)
export DATABASE_URL=...               # обязательно перед prisma-командами
pnpm --filter api exec prisma migrate deploy
node prisma/seed.mjs                  # seed (либо корневой скрипт: pnpm db:seed)
```

Генерация новой миграции (интерактивный `migrate dev` не используем):

```bash
# ВНИМАНИЕ: --shadow-database-url должен указывать на ОТДЕЛЬНУЮ пустую БД, НЕ на dev
# (migrate diff сбрасывает shadow-БД). См. docs/RUNBOOK.md.
pnpm --filter api exec prisma migrate diff \
  --from-migrations prisma/migrations --to-schema-datamodel prisma/schema \
  --shadow-database-url postgresql://.../studenthub_shadow --script > \
  prisma/migrations/<ts>_<name>/migration.sql
pnpm --filter api exec prisma migrate deploy
```

## Структура

```
apps/
  api/   NestJS: modules/<feature> (controller/service/dto/spec), common/ (guards, interceptors, prisma, queue, realtime)
  web/   Next.js FSD: app/ · shared/ · entities/ · features/ · widgets/ · views/ · messages/ (i18n)
packages/  shared-types · shared-schemas · shared-utils · shared-config
prisma/    schema/ (multi-file) · migrations/ · seed.mjs
docker/    docker-compose.yml · docker-compose.prod.yml · nginx/
docs/      PROJECT.md · BACKEND_RULES.md · FRONTEND_RULES.md · IMPLEMENTATION_PLAN.md · RUNBOOK.md
```

## Тестирование

- API: unit (`*.spec.ts`, Prisma мокается) + e2e (`test/*.e2e-spec.ts`, реальный PostgreSQL).
  Приоритет 🔴 (guard'ы, InviteService, автомат заявок, auth-flow) блокирует мёрж.
- Роли/scope покрыты unit-тестами по каждому модулю (кросс-scope, IDOR, недопустимые переходы).

## Осталось к продакшн-деплою (требует ключей/браузеров)

Функционально v1.0 готов (Ф0–Ф12 + полировка Ф13). Три пункта Ф13 намеренно включаются
**на этапе деплоя**, т.к. требуют внешних ресурсов, недоступных в dev-песочнице:

- **E2E-тесты (Playwright, 13.4)** — `pnpm --filter web add -D @playwright/test` + `pnpm exec playwright install`
  (браузеры) + прогон против запущенного стенда на CI. Флоу: логин, регистрация по инвайту, лента,
  отправка сообщения, заявка (создание→обработка), изменение расписания.
- **Push-уведомления (13.3)** — Web-Push (VAPID) или FCM: сгенерировать/получить ключи, положить в env,
  добавить подписку + обработчик в service worker (SW уже есть от PWA).
- **Мониторинг (Sentry, 13.8)** — `@sentry/nestjs` + `@sentry/nextjs` + `SENTRY_DSN` в env; алерты
  по error-rate / p95 / пулу соединений на `/health`.

Также при первом проде: сменить пароль seed-админа, отозвать dev-инвайт, проверить восстановление
из бэкапа (`docs/RUNBOOK.md`), закрыть Swagger (уже только в `NODE_ENV=development`).

## Безопасность (кратко)

Регистрация только по инвайтам; три уровня guard (Jwt → Roles → Scope) + дублирующая проверка
scope в сервисах; access-токен в памяти, refresh — httpOnly+SameSite=Lax cookie с ротацией;
bcrypt cost 12; helmet; throttler; pino-redact для секретов. Полный чеклист — `docs/BACKEND_RULES.md §14`.
