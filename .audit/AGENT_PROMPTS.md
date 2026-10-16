# Шаблоны заданий агентам

## Аудит группы (фаза 2) — подставить <G>, название группы и модули

You are auditing business processes of the StudentHub monorepo at /home/mehmanjafari/projects-me/studenthub (NestJS+Fastify+Prisma API in apps/api, Prisma schema prisma/schema/_.prisma, Next.js + FSD web in apps/web, packages/_). This is PHASE 2 (audit, read-only) for GROUP <G> — «<название>» (modules <модули>).

INPUT: read `.audit/processes/<G>.md` — the inventory of processes. Project rules for context: docs/BACKEND_RULES.md and docs/FRONTEND_RULES.md (grep/read relevant sections only).

HARD RULES:

- Read-only: do NOT modify any file except creating/writing `.audit/findings/<G>.md`. No git commands that change state. Don't run builds/dev servers/migrations. You MAY run targeted unit tests (`pnpm --filter api test -- src/modules/<m>`) to confirm behaviour; trim output with `| tail -n 40`.
- Don't load huge files whole: grep and read line ranges.
- Write findings incrementally so progress survives.

For EVERY process check, by reading the actual code: 1) works end-to-end (API + web wired, routes, guards/roles); 2) errors and edge cases; 3) security: validation, authorization/scope from JWT, leaks in responses/logs, rate limiting, enumeration; 4) data integrity: transactions, idempotency, uniqueness; 5) performance: N+1, unbounded findMany, heavy loops, missing pagination, memory growth; 6) duplication/dead code; 7) test coverage gaps.

PRIORITIES: P0 = security hole / data leak / data loss or corruption / main flow broken / crash. P1 = wrong behaviour in a common scenario, inconsistency without transaction, perf problem at production scale. P2 = UX gaps, dead code, minor perf, missing tests. Every P0/P1 MUST cite exact file:line evidence; if not confirmed mark «(не подтверждено)» and lower to P2.

OUTPUT `.audit/findings/<G>.md` IN RUSSIAN:

## Группа <G> — аудит

### Статусы процессов

| Процесс | Статус (работает / работает с проблемами / сломан) | Коротко |

### Проблемы

#### <G>-Fnn [P0|P1|P2] Заголовок

- Процесс: <G>-NN
- Где: file:line
- Суть:
- Решение:
- Файлы для правки:
- Стоп-точки: «миграция» / «новая зависимость» / «контракт API/shared-schemas» / «нет»

Reply with ONLY ≤10 lines: counts of P0/P1/P2, the 3 most important issues, file path.
