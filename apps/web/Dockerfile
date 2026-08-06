# StudentHub Web — production образ (Next.js standalone).
# Контекст сборки — КОРЕНЬ монорепо: docker build -f apps/web/Dockerfile .
# NEXT_PUBLIC_* инлайнятся на этапе build → передавайте build-arg.

FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/shared-schemas/package.json packages/shared-schemas/
COPY packages/shared-utils/package.json packages/shared-utils/
COPY packages/shared-config/package.json packages/shared-config/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# NEXT_PUBLIC_* инлайнятся во время сборки — Railway передаёт переменные сервиса
# как build-args, поэтому каждую нужно объявить ARG и пробросить в ENV.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_APP_NAME
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_APP_NAME=${NEXT_PUBLIC_APP_NAME}
# turbo собирает workspace-зависимости web (shared-*) по графу ^build, затем сам web.
# Прямой `pnpm --filter web build` их пропускает → web не находит dist shared-пакетов.
RUN pnpm exec turbo run build --filter=web

# ── runner: только standalone-вывод Next ──
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# standalone кладёт минимальный node_modules и server.js; static/public — рядом.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
