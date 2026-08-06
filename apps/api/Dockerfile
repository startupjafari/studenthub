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
RUN pnpm --filter api exec prisma generate
RUN pnpm --filter api build
# prod-зависимости для runner
RUN pnpm --filter api --prod deploy /app --legacy

# ── runner ──
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/prisma ./prisma
# Prisma Client сгенерирован в node_modules (deploy тянет его).
EXPOSE 3001
# Миграции применяются отдельным шагом (migrate deploy) до старта, не в CMD.
CMD ["node", "dist/main.js"]
