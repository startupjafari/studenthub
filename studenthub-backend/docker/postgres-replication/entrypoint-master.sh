#!/bin/bash
set -e

echo "=== PostgreSQL Master Entrypoint ==="

# Функция для настройки pg_hba.conf
configure_pg_hba() {
  local pg_hba_file="$PGDATA/pg_hba.conf"
  
  if [ ! -f "$pg_hba_file" ]; then
    echo "pg_hba.conf not found, will be created by PostgreSQL"
    return 0
  fi
  
  # Проверяем, есть ли уже нужная запись
  if ! grep -q "host replication postgres 0.0.0.0/0 md5" "$pg_hba_file"; then
    echo "Configuring pg_hba.conf for replication..."
    {
      echo ""
      echo "# Replication connections from Docker network"
      echo "host replication postgres 0.0.0.0/0 md5"
    } >> "$pg_hba_file"
    echo "pg_hba.conf configured for replication"
    return 0
  else
    echo "pg_hba.conf already configured for replication"
    return 0
  fi
}

# Если БД уже инициализирована, настраиваем pg_hba.conf перед запуском
if [ -f "$PGDATA/PG_VERSION" ]; then
  configure_pg_hba
fi

# Запускаем стандартный entrypoint PostgreSQL
# Он создаст pg_hba.conf при первой инициализации
exec /usr/local/bin/docker-entrypoint.sh "$@"
