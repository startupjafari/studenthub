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

## Исправление (фаза 3) — подставить ID задач, проблемы, файлы

You are fixing audited issues in the StudentHub monorepo at /home/mehmanjafari/projects-me/studenthub (NestJS+Fastify+Prisma API in apps/api; Prisma schema prisma/schema/_.prisma; Next.js App Router + FSD web in apps/web; packages/shared-_). Other agents work in the same working tree on OTHER files at the same time.

TASK(S): <ID задач> — issues <ID проблем>. Read each issue block in `.audit/findings/<G>.md` (grep `#### <ID>` and read until the next `####`): «Где», «Суть», «Решение», «Файлы для правки». Verify the problem in code first; implement the fix (you may improve on the proposed solution if you explain why).

SCOPE: only these files (plus their tests / i18n messages apps/web/messages/{ru,kk,en}.json if UI text is needed): <файлы>. If the fix truly needs another file, keep it minimal and mention it in your summary.

PROJECT RULES (from AGENTS.md / docs/*_RULES.md):

- Match surrounding code style and comment density; comments and user-facing strings in Russian; every user-facing string via i18n keys (ru, kk, en).
- API changes must stay backward compatible (web, iOS, Android and the Telegram mini-app share the API): additive optional fields/params only. If you add/change endpoints or schemas, regenerate apps/api/openapi.json (`rm -f apps/api/tsconfig*.tsbuildinfo && pnpm --filter api build && pnpm --filter api run openapi`). DO NOT edit docs/PROJECT.md (other agents work in parallel) — put the exact sentence(s) the docs need into your summary under «Документация:». A breaking change → don't do it, report it.
- Migration needed → edit prisma/schema/*.prisma and write the SQL file prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql by hand (or `pnpm exec prisma migrate diff --from-schema-datamodel … --script` without touching a DB). NEVER apply migrations, never run db push / migrate dev / reset against any database.
- No new dependencies. No git commands that change state (no commit/stash/checkout/reset) — the orchestrator commits. No dev servers, no full builds of web.
- findMany always with take; authorization/scope from JWT, never from the body.

VERIFY: add or adjust a unit test for the scenario where practical. Run only related checks and trim output:

- api: `pnpm --filter api test -- <path or module>` | tail -n 30; `pnpm --filter api exec eslint <changed files>`; `pnpm --filter api typecheck` | tail -n 20 (once, at the end).
- web: `cd apps/web && pnpm exec vitest run <paths>` | tail -n 20; `pnpm exec eslint <changed files>`; `pnpm exec tsc --noEmit -p tsconfig.json | grep "error TS" | head` (once, at the end).
- format changed files with `pnpm exec prettier --write <files>`.

REPLY with ONLY ≤10 lines: done / partially / not done; files changed; tests and lint result; migration created (path) or contract change (what) if any; anything left for a follow-up.
