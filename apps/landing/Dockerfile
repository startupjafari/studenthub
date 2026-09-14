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
ENV HOSTNAME=::

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
# Адрес бинда задаётся здесь, и ровно `::` — dual-stack.
#
# Два разных требования сходятся в одной строке.
#
# 1. Next в режиме standalone берёт адрес из `process.env.HOSTNAME || '0.0.0.0'`, а
#    хостинги кладут в эту переменную имя контейнера. Сервер пытается резолвить его как
#    адрес — `EAI_AGAIN getaddrinfo <имя>` — и падает с кодом 1.
#
# 2. Прокси Railway (и публичный edge, и приватная сеть `*.railway.internal`) ходит по
#    IPv6. Слушатель на `0.0.0.0` отвечает только по IPv4, edge получает TCP-reset —
#    снаружи это те же «Application failed to respond» и 502, хотя процесс жив и в логах
#    написано «Ready». Так же решено у api: `app.listen({ host: '::' })` в main.ts.
#    Локально `::` принимает и IPv4, так что запуск на своей машине не меняется.
#
# `ENV` выше от первой беды не спасает: переменная окружения сервиса его перекрывает.
# Присваивание перед командой перекрывает уже она.
#
# Форма важна: `sh -c`, а не exec-форма. Присваивание перед командой умеет только
# оболочка; без неё строка «HOSTNAME=::» читается как имя программы, и контейнер не
# стартует вовсе. По той же причине в railway.json нет `startCommand` — платформа
# запускает CMD образа, и дублировать команду там, где она может исполниться без
# оболочки, незачем.
CMD ["sh", "-c", "HOSTNAME=:: node apps/landing/server.js"]
