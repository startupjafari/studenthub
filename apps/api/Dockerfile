# StudentHub API — production образ (NestJS + Fastify + Prisma).
# Multi-stage: сборка монорепо (turbo: shared-* → api) → минимальный runner.
# Контекст сборки — КОРЕНЬ монорепо: docker build -f apps/api/Dockerfile .

FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

# ── deps: установка по манифестам (кэш слоя не инвалидируется от изменений кода) ──
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/shared-schemas/package.json packages/shared-schemas/
COPY packages/shared-utils/package.json packages/shared-utils/
COPY packages/shared-config/package.json packages/shared-config/
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
# prod-зависимости для runner
RUN pnpm --filter api --prod deploy /app --legacy

# ── runner ──
FROM node:20-alpine AS runner
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
