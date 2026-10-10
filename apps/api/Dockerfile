# StudentHub API — production образ (NestJS + Fastify + Prisma).
# Multi-stage: сборка монорепо (turbo: shared-* → api) → минимальный runner.
# Контекст сборки — КОРЕНЬ монорепо: docker build -f apps/api/Dockerfile .

# Node 24 — Active LTS: поддержка до 30.04.2028. На 20-й оставаться нельзя, он EOL
# с 30.04.2026 — патчи безопасности для него больше не выходят. На 26-ю не идём: она
# станет LTS только 28.10.2026, до тех пор это Current.
#
# pnpm ставится через npm, а не `corepack enable`: из образов Node начиная с 26-й corepack
# убрали, и сборка падает с `corepack: not found`. Версия продублирована из `packageManager`
# в корневом package.json — меняя её там, поправьте и здесь.
FROM node:24-alpine AS base
RUN npm install --global pnpm@11.28.3
WORKDIR /repo

# ── deps: установка по манифестам (кэш слоя не инвалидируется от изменений кода) ──
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/shared-schemas/package.json packages/shared-schemas/
COPY packages/shared-utils/package.json packages/shared-utils/
COPY packages/shared-config/package.json packages/shared-config/
# Сборке нужен доступ не только к реестру npm, но и к cdn.sheetjs.com: xlsx ставится
# тарболлом оттуда (в npm лежит только уязвимая 0.18.5 — см. src/modules/invites/bulk-parse.ts).
RUN pnpm install --frozen-lockfile

# ── build: генерация Prisma Client + сборка shared → api ──
FROM deps AS build
COPY . .
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
# Схема и prisma.config.ts — в КОРНЕ монорепо, поэтому generate запускается из /repo,
# а не из apps/api (иначе Prisma не находит prisma/schema).
RUN pnpm exec prisma generate
# С pnpm сгенерированный клиент оседает в виртуальном сторе
# (node_modules/.pnpm/@prisma+client@.../node_modules/.prisma) и не попадает в `pnpm deploy`.
# Кладём его в стабильный путь node_modules/.prisma (glob вместо хардкода хэша),
# откуда runner заберёт его в /app.
RUN cp -r /repo/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma /repo/node_modules/.prisma
# turbo собирает workspace-зависимости api (shared-*) по графу ^build, затем сам api.
# Прямой `pnpm --filter api build` их пропускает → api не находит dist shared-пакетов.
RUN pnpm exec turbo run build --filter=api
# prod-зависимости для runner.
#
# minimumReleaseAge=0 отключает выдержку из pnpm-workspace.yaml для этой одной команды.
# Легаси-deploy не раскладывает /app по локу напрямую: он заново прогоняет разрешение по
# всему воркспейсу, и выдержка проверяет каждую версию в дереве — в том числе зависимости
# чужих приложений (сборка падала на undici 7.30.0 из дерева apps/web). Защиты здесь
# никакой: версии всё равно приходят из лока (сверено — все 424 пакета в /app совпадают с
# pnpm-lock.yaml, из реестра не скачивается ничего), а сам лок собран с выдержкой. Без
# флага образ не собирается ровно неделю после каждого обновления любой зависимости.
#
# --frozen-lockfile не помогает: deploy его игнорирует и разрешает дерево в любом случае.
# Отказаться от --legacy тоже нельзя: новый deploy требует inject-workspace-packages=true
# для всего воркспейса (ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE), а это другой способ
# раскладки node_modules во всём репозитории.
RUN pnpm --filter api --prod deploy /app --legacy --config.minimumReleaseAge=0

# ── runner ──
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/prisma ./prisma
# Сгенерированный Prisma Client (+ query engine) лежит в /repo/node_modules/.prisma —
# это артефакт генерации, а не зависимость, поэтому `pnpm deploy` его не переносит.
# Копируем вручную, иначе @prisma/client падает с MODULE_NOT_FOUND '.prisma/client'.
COPY --from=build /repo/node_modules/.prisma ./node_modules/.prisma
EXPOSE 3001
# Миграции применяются отдельным шагом (migrate deploy) до старта, не в CMD.
CMD ["node", "dist/main.js"]
