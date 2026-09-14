# StudentHub Landing — production образ (Next.js standalone).
# Контекст сборки — КОРЕНЬ монорепо: docker build -f apps/landing/Dockerfile .
#
# Слой зависимостей здесь заметно тоньше, чем у apps/web: лендинг изолирован от платформы
# и не тянет ни одного workspace-пакета (docs/LANDING.md §3). Копируем только его
# package.json — значит кэш этого слоя не сбрасывается от правок в shared-*.

FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/landing/package.json apps/landing/
# --ignore-scripts не ставим: next нужен его postinstall для бинарников SWC.
RUN pnpm install --frozen-lockfile --filter landing...

FROM deps AS build
# Копируем только приложение и корневые конфиги: остальное монорепо лендингу не нужно,
# и лишние файлы в контексте сборки сбрасывали бы кэш при любой правке в apps/api.
COPY tsconfig.base.json ./
COPY apps/landing apps/landing

# NEXT_PUBLIC_* инлайнятся во время сборки, поэтому каждую нужно объявить ARG и пробросить
# в ENV. Railway передаёт переменные сервиса как build-args.
#
# NEXT_PUBLIC_APP_URL здесь критичен вдвойне: из него строятся не только кнопки «Войти»,
# но и 308-редиректы на платформу (next.config.mjs). Ошибка в нём означает, что
# напечатанные QR-наклейки над дверями аудиторий перестанут работать.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_SALES_EMAIL
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV NEXT_PUBLIC_SALES_EMAIL=${NEXT_PUBLIC_SALES_EMAIL}

# Прямой `pnpm --filter landing build`, а не turbo: у лендинга нет workspace-зависимостей,
# собирать по графу ^build нечего.
RUN pnpm --filter landing build

# ── runner: только standalone-вывод Next ──
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Непривилегированный пользователь: контейнеру, который раздаёт статику, root не нужен.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 -G nodejs

# standalone кладёт минимальный node_modules и server.js; static и public — рядом.
COPY --from=build --chown=nextjs:nodejs /repo/apps/landing/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /repo/apps/landing/.next/static ./apps/landing/.next/static
COPY --from=build --chown=nextjs:nodejs /repo/apps/landing/public ./apps/landing/public

USER nextjs
EXPOSE 3000

# HOSTNAME присваивается прямо в команде, а не только через ENV выше.
#
# Next в режиме standalone берёт адрес бинда из `process.env.HOSTNAME || '0.0.0.0'`.
# Хостинги кладут в эту переменную имя контейнера, и сервер пытается резолвить его как
# адрес: `EAI_AGAIN getaddrinfo studenthub-landing-production`, процесс падает с кодом 1.
# Снаружи это «Application failed to respond» с 502 — контейнер есть, слушателя нет.
#
# ENV в образе тут не спасает: переменная окружения сервиса его перекрывает. Присваивание
# перед командой — перекрывает уже она, и поведение перестаёт зависеть от хостинга.
CMD ["sh", "-c", "HOSTNAME=0.0.0.0 node apps/landing/server.js"]
