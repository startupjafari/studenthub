# Multi-stage build для оптимизации размера образа
FROM node:20-alpine AS builder

WORKDIR /app

# Устанавливаем необходимые библиотеки для Prisma и сборки
RUN apk add --no-cache \
    curl \
    openssl \
    openssl-dev \
    libc6-compat \
    python3 \
    make \
    g++

# Копируем package files и npm config
COPY package*.json .npmrc* ./

# Устанавливаем ВСЕ зависимости (нужны dev для сборки)
# Добавляем retry логику для обработки сетевых ошибок
RUN set -eux; \
    for i in 1 2 3 4 5; do \
        npm ci --legacy-peer-deps && break || \
        (echo "Attempt $i failed, retrying..." && sleep $((i * 2))); \
    done && \
    npm cache clean --force

# Копируем исходный код
COPY . .

# Генерируем Prisma Client
RUN npx prisma generate

# Собираем приложение
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Устанавливаем необходимые библиотеки для Prisma и health checks
RUN apk add --no-cache \
    wget \
    curl \
    openssl \
    openssl-dev \
    libc6-compat

# Копируем package files и npm config
COPY package*.json .npmrc* ./

# Устанавливаем только production зависимости
# Используем --omit=dev вместо устаревшего --only=production
# Добавляем retry логику для обработки сетевых ошибок
RUN set -eux; \
    for i in 1 2 3 4 5; do \
        npm ci --omit=dev --legacy-peer-deps && break || \
        (echo "Attempt $i failed, retrying..." && sleep $((i * 2))); \
    done && \
    npm cache clean --force

# Копируем собранное приложение
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/prisma ./prisma

# Создаем non-root пользователя
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

# Меняем владельца файлов
RUN chown -R nestjs:nodejs /app
USER nestjs

# Expose порт
EXPOSE 3000

# Health check
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/api/health/live || exit 1

# Запускаем приложение
CMD ["node", "dist/main.js"]
