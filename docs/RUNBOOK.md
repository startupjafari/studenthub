# StudentHub — Runbook (эксплуатация)

Что делать при инцидентах и рутинных операциях. Прод-архитектура — `docker/docker-compose.prod.yml`
+ nginx (TLS, WS-upgrade). Приложение: API (`:3001`, префикс `/api/v1`) + Web (`:3000`).

## Быстрая диагностика

```bash
curl -s http://localhost:3001/api/v1/health | jq   # Prisma / Redis / MinIO — up/down
ss -ltnp | grep -E ':3000|:3001|:5432|:6379|:9000'  # что слушает
```

`GET /health` (@nestjs/terminus, публичный) проверяет PostgreSQL, Redis, MinIO. Заведите на него
внешний аптайм-мониторинг; алерты по error-rate / p95 / пулу соединений — см. `docs/IMPLEMENTATION_PLAN.md` 13.8.

## Отказ зависимостей (graceful degradation)

| Сервис | Симптомы | Что происходит | Действия |
|---|---|---|---|
| **Redis** | `/health` redis=down; не идут письма/уведомления, счётчик unread не кэшируется | Очереди BullMQ не принимают job'ы; job'ы НЕ теряются после восстановления (продюсеры повторяют по dedupeKey). HTTP-ответы не блокируются. | Поднять redis (`docker compose ... up -d redis`). После — воркеры разгребут очередь. |
| **MinIO** | `/health` minio=down; загрузка/скачивание файлов падает | Cron `cleanOrphanFiles` пропускает бакеты с логом-warn (не падает). Бизнес-операции без файлов работают. | Поднять minio. Проверить бакеты создались (bootstrap на старте API). |
| **PostgreSQL** | `/health` database=down; 500 на большинстве запросов | Приложение неработоспособно. | Поднять postgres; проверить `DATABASE_URL`; при исчерпании пула — рестарт API. |

Идемпотентность job'ов (dedupeKey у Notification, `reminderSentAt` у Event) гарантирует, что
повторная обработка после сбоя не создаёт дубликатов уведомлений/писем.

## Рутинные операции

**Рестарт API (сбрасывает in-memory throttler — счётчики rate-limit):**
```bash
PID=$(ss -ltnp | grep ':3001' | grep -oP 'pid=\K[0-9]+'); kill "$PID"      # не pkill
set -a && . apps/api/.env && set +a && node apps/api/dist/main.js          # :3001
```
> Throttler хранит счётчики в памяти процесса — рестарт API моментально снимает лимиты
> (login 5/15мин, register 3/час, complaints 10/час). Логин/пароли при этом не меняются.

**Рестарт Web:**
```bash
PID=$(ss -ltnp | grep ':3000' | grep -oP 'pid=\K[0-9]+'); kill "$PID"
pnpm --filter web build && apps/web/node_modules/.bin/next start apps/web -p 3000
```

## Миграции БД

- Схема — multi-file `prisma/schema/`, `prisma.config.ts` НЕ грузит `.env` (передавайте `DATABASE_URL` окружением).
- **⚠️ `migrate diff --shadow-database-url` СБРАСЫВАЕТ указанную БД.** Никогда не подставляйте туда
  рабочую БД — только отдельную пустую (`studenthub_shadow`). Иначе данные и история миграций теряются.
- Применение к непустой БД: сначала прочитать SQL глазами, показать владельцу, затем `migrate deploy`.
- `--accept-data-loss`, `db push`, `migrate reset` на не-тестовой БД — запрещены.

**Восстановление истории миграций (если `_prisma_migrations` пуста, а схема есть) БЕЗ дропа:**
```bash
for m in <каждая старая миграция>; do prisma migrate resolve --applied "$m"; done
prisma migrate deploy    # накатит только новые
node prisma/seed.mjs
```

**Пересоздать dev-БД с нуля** (данных не жалко): `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`
через `prisma db execute` (не `migrate reset`) → `migrate deploy` → `node prisma/seed.mjs`.

## Бэкапы и восстановление

- **PostgreSQL**: `pg_dump` по расписанию (cron/systemd-timer), хранить off-site; проверять
  восстановление на staging. Пример: `pg_dump "$DATABASE_URL" | gzip > studenthub_$(date +%F).sql.gz`.
- **MinIO**: `mc mirror` бакетов в резервное хранилище (кроме `stories-media` с TTL 24ч).
- Перед релизом v1.0 обязательно проверить восстановление из бэкапа (критерий готовности §13).

## Ротация логов

- API пишет `pino` (JSON) в stdout; в проде агрегировать через docker log-driver + ротация
  (`max-size`/`max-file`) или внешний коллектор. Секреты (`authorization`, `password`, `token`)
  редактируются на уровне pino — в логах их нет.

## Частые вопросы

- **`RATE_LIMIT` при логине** — исчерпано окно 5/15мин с IP; подождать или рестартнуть API (сброс throttler).
- **`P3005` при `migrate deploy`** — схема есть, а `_prisma_migrations` пуста → baseline через `migrate resolve --applied` (см. выше).
- **Письма «не приходят»** — в dev SMTP не настроен (`jsonTransport`), письма только логируются; это ожидаемо.
