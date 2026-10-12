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
RUN npm install --global pnpm@10.33.2
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
#
# Переменная, которой здесь нет, в сборку НЕ попадёт, сколько её ни задавай в панели
# Railway: незадекларированный build-arg docker молча игнорирует, а Next подставит в
# бандл `undefined`. Добавляя `NEXT_PUBLIC_*` в код веба, добавляйте строку и сюда.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_APP_NAME
# Хранилище медиа: из него строятся img-src/media-src/connect-src в CSP (next.config).
ARG NEXT_PUBLIC_MINIO_URL
# Флаг раскатки сторис (Ф14.1): '1' включает полосу колец над лентой.
ARG NEXT_PUBLIC_FEATURE_STORIES
# Публичный ключ VAPID — без него веб не умеет подписаться на push-уведомления.
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
# Sentry: DSN и параметры релиза читаются клиентским бандлом на этапе build.
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT
ARG NEXT_PUBLIC_SENTRY_RELEASE
ARG NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE
# Цель прокси /api/* (единый origin). Читается в next.config rewrites на этапе build.
ARG API_PROXY_TARGET
# Идентификатор сборки: из него next.config делает buildId и версию в настройках,
# по которой PWA понимает, что пора обновиться. Без него — метка `dev-<время>`.
ARG RAILWAY_GIT_COMMIT_SHA
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_APP_NAME=${NEXT_PUBLIC_APP_NAME}
ENV NEXT_PUBLIC_MINIO_URL=${NEXT_PUBLIC_MINIO_URL}
ENV NEXT_PUBLIC_FEATURE_STORIES=${NEXT_PUBLIC_FEATURE_STORIES}
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=${NEXT_PUBLIC_VAPID_PUBLIC_KEY}
ENV NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN}
ENV NEXT_PUBLIC_SENTRY_ENVIRONMENT=${NEXT_PUBLIC_SENTRY_ENVIRONMENT}
ENV NEXT_PUBLIC_SENTRY_RELEASE=${NEXT_PUBLIC_SENTRY_RELEASE}
ENV NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=${NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE}
ENV API_PROXY_TARGET=${API_PROXY_TARGET}
ENV RAILWAY_GIT_COMMIT_SHA=${RAILWAY_GIT_COMMIT_SHA}
# SENTRY_AUTH_TOKEN (загрузка source maps) здесь намеренно НЕ объявлен: секрет в
# build-arg оседает в истории сборки, и hadolint справедливо это запрещает (DL3064).
# Через переменные Railway его не передать — нужен `--mount=type=secret`, а это
# отдельная задача. Без токена плагин Sentry молча пропускает выгрузку, остальное
# работает: ORG и PROJECT без него бесполезны и тоже не пробрасываются.
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
