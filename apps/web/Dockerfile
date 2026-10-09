# StudentHub Web — production образ (Next.js standalone).
# Контекст сборки — КОРЕНЬ монорепо: docker build -f apps/web/Dockerfile .
# NEXT_PUBLIC_* инлайнятся на этапе build → передавайте build-arg.

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
# Цель прокси /api/* (единый origin). Читается в next.config rewrites на этапе build.
ARG API_PROXY_TARGET
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_APP_NAME=${NEXT_PUBLIC_APP_NAME}
ENV API_PROXY_TARGET=${API_PROXY_TARGET}
# turbo собирает workspace-зависимости web (shared-*) по графу ^build, затем сам web.
# Прямой `pnpm --filter web build` их пропускает → web не находит dist shared-пакетов.
RUN pnpm exec turbo run build --filter=web

# ── runner: только standalone-вывод Next ──
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# standalone кладёт минимальный node_modules и server.js; static/public — рядом.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
