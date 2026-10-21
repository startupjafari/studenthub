# Агент камер StudentHub — ставится в сети вуза (docs/PROJECT.md §3.10).
# Контекст сборки — КОРЕНЬ монорепо: docker build -f apps/camera-agent/Dockerfile .
#
# Запуск у вуза:
#   docker run -d --name studenthub-agent --restart unless-stopped \
#     -e STUDENTHUB_API_URL=https://<api>/api/v1 \
#     -e STUDENTHUB_AGENT_TOKEN=<токен из раздела «Камеры»> \
#     -v studenthub-agent:/var/lib/studenthub-agent \
#     <образ>
# Том обязателен: в нём закрытый ключ агента. Без тома после пересоздания контейнера
# пароли камер не расшифровать — придётся перевыпускать токен и вводить их заново.

# Node 24 и pnpm — как в apps/api/Dockerfile (там же — почему не corepack).
FROM node:24-alpine AS build
RUN npm install --global pnpm@10.33.2
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/camera-agent/package.json apps/camera-agent/
# Зависимостей во время работы у агента нет — ставятся только typescript и типы Node.
RUN pnpm install --frozen-lockfile --filter camera-agent --ignore-scripts
COPY apps/camera-agent apps/camera-agent
RUN pnpm --filter camera-agent build

FROM node:24-alpine
# ffprobe — проверка камер; ffmpeg понадобится для отдачи потока.
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY apps/camera-agent/package.json ./
COPY --from=build /repo/apps/camera-agent/dist ./dist
RUN mkdir -p /var/lib/studenthub-agent && chown node:node /var/lib/studenthub-agent
# Не root: агенту не нужны ни порты ниже 1024, ни запись вне своего каталога.
USER node
VOLUME /var/lib/studenthub-agent
ENV NODE_ENV=production
CMD ["node", "dist/main.js"]
