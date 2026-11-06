#!/usr/bin/env bash
# Проверка бэкапа восстановлением (Ф13.9, критерий готовности v1.0).
#
# ЗАЧЕМ ОТДЕЛЬНЫЙ СКРИПТ. Снятый бэкап — это ещё не бэкап, а файл. Бэкапом он становится
# в тот момент, когда из него поднялась работающая база; до тех пор это предположение.
# Проверять предположение руками раз в полгода никто не будет — поэтому процедура
# оформлена командой, которую можно поставить в расписание рядом со снятием.
#
# ЧТО ДЕЛАЕТ
#   1. Создаёт временную базу рядом с целевой (никогда не трогает существующую).
#   2. Восстанавливает в неё дамп.
#   3. Проверяет, что база РАБОЧАЯ, а не просто непустая:
#      — применены все миграции (таблица _prisma_migrations, нет незавершённых);
#      — ключевые таблицы на месте и не пусты;
#      — внешние ключи целы (случайная выборка связей разрешается).
#   4. Удаляет временную базу (если не задан KEEP_DB=1).
#
#   ./scripts/restore-drill.sh backups/studenthub-20261012-0300.dump
#
# Переменные:
#   ADMIN_URL   подключение с правом CREATE DATABASE (по умолчанию DATABASE_URL)
#   DRILL_DB    имя временной базы (по умолчанию studenthub_drill_<timestamp>)
#   KEEP_DB=1   не удалять базу после проверки — чтобы посмотреть глазами

set -euo pipefail

DUMP="${1:-}"
if [[ -z "$DUMP" || ! -f "$DUMP" ]]; then
  echo "Укажите файл дампа: ./scripts/restore-drill.sh <файл.dump>" >&2
  exit 2
fi

: "${DATABASE_URL:?нужна переменная DATABASE_URL — рядом с какой базой поднимать проверку}"
ADMIN_URL="${ADMIN_URL:-$DATABASE_URL}"
DRILL_DB="${DRILL_DB:-studenthub_drill_$(date -u +%H%M%S)}"

# CREATE DATABASE выполняется из подключения к ЛЮБОЙ другой базе — берём ту, что в URL.
# Базы `postgres` может не быть вовсе: у managed-провайдеров и у образов с заданным
# POSTGRES_DB она не создаётся, и предположение о ней ломает проверку на ровном месте.
# Параметры запроса (?schema=…) psql не понимает — отрезаем.
ADMIN_CONN="${ADMIN_URL%%\?*}"
ADMIN_BASE="${ADMIN_CONN%/*}"
DRILL_URL="${ADMIN_BASE}/${DRILL_DB}"

cleanup() {
  if [[ "${KEEP_DB:-0}" != "1" ]]; then
    psql "$ADMIN_CONN" -q -c "DROP DATABASE IF EXISTS \"${DRILL_DB}\"" || true
  else
    echo "База ${DRILL_DB} оставлена (KEEP_DB=1)"
  fi
}
trap cleanup EXIT

echo "→ Временная база ${DRILL_DB}"
psql "$ADMIN_CONN" -q -c "CREATE DATABASE \"${DRILL_DB}\""

echo "→ Восстановление ${DUMP}"
# --no-owner: роли целевой машины не обязаны совпадать с исходными.
# Код возврата pg_restore ненулевой и на безобидных предупреждениях, поэтому смотрим
# не на него, а на результат проверок ниже.
pg_restore --no-owner --dbname="$DRILL_URL" "$DUMP" > /tmp/restore-drill.log 2>&1 || true

fail() {
  echo "ПРОВЕРКА НЕ ПРОЙДЕНА: $1" >&2
  echo "Лог восстановления — /tmp/restore-drill.log" >&2
  exit 1
}

echo "→ Проверки"

# 1. Миграции. Пустая таблица означает, что восстановилась не наша схема, а незавершённые
#    записи — что дамп снят с базы в середине миграции.
applied=$(psql "$DRILL_URL" -tAc "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL" 2>/dev/null || echo 0)
pending=$(psql "$DRILL_URL" -tAc "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL" 2>/dev/null || echo 0)
[[ "$applied" -gt 0 ]] || fail "в восстановленной базе нет применённых миграций"
[[ "$pending" -eq 0 ]] || fail "есть незавершённые миграции ($pending) — дамп снят в середине обновления схемы"
echo "   миграций применено: ${applied}"

# 2. Ключевые таблицы. Список короткий намеренно: это не инвентаризация схемы, а ответ на
#    вопрос «данные доехали?». Пользователи и вуз есть всегда; остальное зависит от стенда.
for table in users universities faculties groups; do
  rows=$(psql "$DRILL_URL" -tAc "SELECT count(*) FROM \"${table}\"" 2>/dev/null || echo 0)
  [[ "$rows" -gt 0 ]] || fail "таблица ${table} пуста"
  echo "   ${table}: ${rows}"
done

# 3. Целостность связей. Дамп восстанавливается по частям, и потерянный внешний ключ —
#    самая тихая из возможных поломок: база откроется, а половина экранов отдаст 404.
orphans=$(psql "$DRILL_URL" -tAc "
  SELECT count(*) FROM users u
  WHERE u.university_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM universities x WHERE x.id = u.university_id)")
[[ "$orphans" -eq 0 ]] || fail "у ${orphans} пользователей вуз не разрешается — связи битые"
echo "   висячих ссылок на вуз: 0"

echo "Бэкап восстанавливается и проходит проверки: ${DUMP}"
