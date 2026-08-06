#!/bin/bash
# Создаёт тестовую БД studenthub_test рядом с основной.
# Запускается один раз при инициализации пустого тома postgres.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	SELECT 'CREATE DATABASE studenthub_test'
	WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'studenthub_test')\gexec
EOSQL

echo "postgres init: база studenthub_test готова"
