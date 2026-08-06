# StudentHub — инструкция для агента

Единая точка входа для Claude Code и Codex. Прочитай этот файл целиком перед первым действием в репозитории.

## Обязательное чтение перед кодом

| Работа | Читать до написания кода |
|---|---|
| Любая задача | `docs/PROJECT.md` (концепция, данные, контракты) |
| Бэкенд (`apps/api`, `prisma/`) | `docs/BACKEND_RULES.md` |
| Фронтенд (`apps/web`) | `docs/FRONTEND_RULES.md` |
| Планирование, выбор следующего шага | `docs/IMPLEMENTATION_PLAN.md` |

Правила в `docs/*_RULES.md` имеют приоритет над плагин-скиллами `sevenhillskz:*`. Отклонения перечислены в §0 каждого файла правил — не «исправляй» проект под конвенции скиллов.

## Что это за проект

Закрытая многоролевая образовательная платформа для университетов. 8 ролей, 4 зоны, регистрация только по инвайтам. Монорепо: Turborepo + pnpm; `apps/api` — NestJS + Fastify + Prisma; `apps/web` — Next.js App Router + FSD.

## Команды

```bash
pnpm install
pnpm dev                                    # api:3001 + web:3000
pnpm lint                                   # весь монорепо
pnpm build

docker compose -f docker/docker-compose.yml up -d postgres redis minio

pnpm --filter api test                      # unit
pnpm --filter api test:e2e
pnpm --filter api prisma validate
pnpm --filter api prisma format
pnpm --filter api prisma migrate dev --name <имя>
pnpm --filter api prisma db seed

pnpm --filter web lint
pnpm --filter web build
pnpm --filter web test
pnpm --filter web e2e
```

## Границы задачи

- Одна задача из `IMPLEMENTATION_PLAN.md` = один PR. Не выходи за её пределы.
- Не рефактори чужие модули «попутно».
- Не добавляй зависимости без обоснования.
- Не редактируй применённые миграции в `prisma/migrations/`.
- Не переписывай `docs/*` без явной просьбы; но **обновляй** `docs/PROJECT.md`, если менял API-контракт, WS-событие, код ошибки или модель данных.

## Стоп-точки: остановись и спроси человека

1. Применение миграции к непустой БД — сначала покажи SQL.
2. Добавление новой зависимости.
3. Изменение схемы в `packages/shared-schemas` (ломает контракт с фронтом).
4. Изменение guard'ов, формата ответа API или списка публичных эндпоинтов.
5. Любое действие, потенциально ведущее к потере данных.

## Перед тем как сказать «готово»

Запусти и **покажи вывод**:
```
pnpm --filter <api|web> lint
pnpm --filter <api|web> test
pnpm --filter <api|web> build
```
Затем пройди чеклист Definition of Done из соответствующего файла правил (`BACKEND_RULES §17` / `FRONTEND_RULES §14`). Формулировки вида «тесты должны проходить» без фактического запуска недопустимы.

## Абсолютные запреты (краткая версия)

- Секреты в коде или в git.
- Отключение guard'ов, валидации, helmet, throttler «чтобы заработало».
- Роль или scope, прочитанные из тела запроса вместо JWT.
- `passwordHash` или токены в ответах API и в логах.
- Токены в `localStorage` / `sessionStorage`.
- `findMany()` без `take`.
- Публичный эндпоинт, создающий пользователя в обход инвайта.
- `--accept-data-loss`, `db push`, `migrate reset` на не-тестовой БД.
- Хардкод пользовательских строк вместо i18n-ключей.

Полные списки — `BACKEND_RULES §18`, `FRONTEND_RULES §15`.
