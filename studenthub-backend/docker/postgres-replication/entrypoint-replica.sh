#!/bin/bash
set -e

echo "=== PostgreSQL Replica Entrypoint ==="

# Ждем пока Master будет готов
echo "Waiting for master to be ready..."
until PGPASSWORD=${POSTGRES_PASSWORD:-postgres} pg_isready -h postgres-master -p 5432 -U ${POSTGRES_USER:-postgres} 2>/dev/null; do
  echo "Master is not ready yet, waiting..."
  sleep 2
done
echo "Master is ready!"

# Если данные уже существуют и это реплика, просто запускаем PostgreSQL
if [ -f "$PGDATA/PG_VERSION" ] && [ -f "$PGDATA/standby.signal" ]; then
  echo "Replica data already exists, starting PostgreSQL in standby mode..."
  exec /usr/local/bin/docker-entrypoint.sh postgres
fi

# Если данные уже есть, но это не реплика, очищаем
if [ -f "$PGDATA/PG_VERSION" ] && [ ! -f "$PGDATA/standby.signal" ]; then
  echo "Existing data found but not a replica, cleaning up..."
  rm -rf "$PGDATA"/*
fi

# Инициализация реплики (только при первом запуске)
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "Initializing replica from master..."
  
  # Создаем базовый бэкап с Master
  PGPASSWORD=${POSTGRES_PASSWORD:-postgres} pg_basebackup \
    -h postgres-master \
    -p 5432 \
    -U ${POSTGRES_USER:-postgres} \
    -D "$PGDATA" \
    -Fp \
    -Xs \
    -P \
    -R \
    -W
  
  echo "Replica initialized successfully!"
fi

# Запускаем PostgreSQL
exec /usr/local/bin/docker-entrypoint.sh postgres
