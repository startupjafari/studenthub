#!/bin/bash
set -e

echo "=== Configuring PostgreSQL for replication ==="

# Настройка pg_hba.conf для репликации
# Добавляем правила для репликации из Docker сети
cat >> "$PGDATA/pg_hba.conf" <<EOF

# Replication connections from Docker network
host replication postgres 0.0.0.0/0 md5
EOF

echo "pg_hba.conf configured for replication"
