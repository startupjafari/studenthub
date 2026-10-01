# StudentHub Mini App — production-образ (статика за nginx).
# Контекст сборки — КОРЕНЬ монорепо: docker build -f apps/mini-app/Dockerfile .
#
# Мини-апп не тянет ни одного workspace-пакета (типы ответов описаны у себя, см.
# src/api/complaints.ts), поэтому в слой зависимостей копируется только его package.json —
# правки в shared-* кэш этого слоя не сбрасывают.

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
COPY apps/mini-app/package.json apps/mini-app/
RUN pnpm install --frozen-lockfile --filter mini-app...

FROM deps AS build
COPY apps/mini-app apps/mini-app
# VITE_* инлайнятся во время сборки. Здесь он намеренно НЕ задаётся: адрес API в проде
# тот же, что и у страницы, — запросы проксирует nginx (см. nginx.conf.template). Один
# origin избавляет и от CORS, и от пересборки при переезде API.
RUN pnpm --filter mini-app build

# ── runtime: nginx раздаёт dist и проксирует /api ──
FROM nginx:1.27-alpine AS runner

# Шаблон, а не готовый конфиг: nginx:alpine прогоняет /etc/nginx/templates/*.template
# через envsubst при старте, и адрес API с портом приезжают переменными окружения.
# Перечисляем подставляемые переменные явно — иначе envsubst съест $uri и $host самого
# nginx, и конфиг развалится.
ENV NGINX_ENVSUBST_FILTER='(PORT|API_TARGET)'
COPY apps/mini-app/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/mini-app/dist /usr/share/nginx/html

# Railway передаёт порт переменной PORT; значение по умолчанию — для локального запуска.
ENV PORT=8080
ENV API_TARGET=http://localhost:3001

EXPOSE 8080
