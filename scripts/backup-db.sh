#!/usr/bin/env bash
# Снимок базы и медиа (Ф13.9). Один скрипт на все способы запуска: ночной прогон
# GitHub Actions, cron на сервере, руки человека перед рискованной миграцией.
#
# ЧТО ДЕЛАЕТ
#   1. pg_dump в custom-формате (-Fc) — он сжат, восстанавливается выборочно и переживает
#      смену минорной версии Postgres; обычный .sql такого не умеет.
#   2. Проверяет дамп на месте: pg_restore --list читает оглавление. Нечитаемый дамп,
#      обнаруженный в момент аварии, — это отсутствующий бэкап, только хуже: на него
#      рассчитывали.
#   3. Если задан BACKUP_S3_*, кладёт дамп в объектное хранилище и зеркалит бакеты MinIO.
#   4. Чистит старые снимки по BACKUP_KEEP_DAYS.
#
# ЧЕГО НЕ ДЕЛАЕТ: не проверяет, что из дампа поднимается рабочая база — это отдельная
# процедура и отдельный скрипт (scripts/restore-drill.sh). Проверка чтением оглавления
# ловит битый файл, но не ловит, например, потерю прав или расширений.
#
#   DATABASE_URL=postgres://... ./scripts/backup-db.sh
#
# Переменные:
#   DATABASE_URL        обязательна — что дампим
#   BACKUP_DIR          куда класть локально (по умолчанию ./backups)
#   BACKUP_KEEP_DAYS    сколько дней хранить локальные снимки (по умолчанию 14)
#   BACKUP_S3_ENDPOINT  адрес хранилища снимков (напр. https://s3.example.kz) — опционально
#   BACKUP_S3_BUCKET    бакет для снимков
#   BACKUP_S3_KEY/SECRET доступы к нему
#   MEDIA_S3_ENDPOINT   адрес MinIO продакшена — опционально, для зеркала медиа
#   MEDIA_S3_KEY/SECRET доступы к нему

set -euo pipefail

: "${DATABASE_URL:?нужна переменная DATABASE_URL — что дампить}"

BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%d-%H%M)"
DUMP="${BACKUP_DIR}/studenthub-${STAMP}.dump"

mkdir -p "$BACKUP_DIR"

echo "→ Снимок базы: $DUMP"
# --no-owner и --no-acl: восстанавливаем в другую роль (на стенде проверки, в облаке
# у managed-Postgres своя). Без них восстановление спотыкается на GRANT'ах к ролям,
# которых в целевой базе нет.
pg_dump --format=custom --no-owner --no-acl --file="$DUMP" "$DATABASE_URL"

echo "→ Проверка читаемости"
pg_restore --list "$DUMP" > /dev/null
SIZE="$(du -h "$DUMP" | cut -f1)"
TABLES="$(pg_restore --list "$DUMP" | grep -c 'TABLE DATA' || true)"
echo "   ок: ${SIZE}, таблиц с данными: ${TABLES}"

# Контрольная сумма рядом: по ней видно, что файл доехал до хранилища целым.
sha256sum "$DUMP" > "${DUMP}.sha256"

# ── Выгрузка в объектное хранилище ───────────────────────────────────────────
# Снимок, лежащий на той же машине, что и база, бэкапом не является: пожар в одном
# месте уносит оба. Поэтому хранилище — обязательный шаг везде, кроме ручного запуска
# «для себя», когда переменные просто не заданы.
if [[ -n "${BACKUP_S3_ENDPOINT:-}" && -n "${BACKUP_S3_BUCKET:-}" ]]; then
  : "${BACKUP_S3_KEY:?нужен BACKUP_S3_KEY}"
  : "${BACKUP_S3_SECRET:?нужен BACKUP_S3_SECRET}"
  echo "→ Выгрузка в ${BACKUP_S3_BUCKET}"
  mc alias set backup "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_KEY" "$BACKUP_S3_SECRET" > /dev/null
  mc cp "$DUMP" "backup/${BACKUP_S3_BUCKET}/db/" > /dev/null
  mc cp "${DUMP}.sha256" "backup/${BACKUP_S3_BUCKET}/db/" > /dev/null

  # Зеркало медиа. stories-media исключён намеренно: его содержимое живёт сутки и
  # удаляется само (TTL бакета), бэкапить срочное бессмысленно.
  if [[ -n "${MEDIA_S3_ENDPOINT:-}" ]]; then
    : "${MEDIA_S3_KEY:?нужен MEDIA_S3_KEY}"
    : "${MEDIA_S3_SECRET:?нужен MEDIA_S3_SECRET}"
    mc alias set media "$MEDIA_S3_ENDPOINT" "$MEDIA_S3_KEY" "$MEDIA_S3_SECRET" > /dev/null
    for bucket in avatars posts-media applications documents materials profile-media chat-media; do
      if mc ls "media/${bucket}" > /dev/null 2>&1; then
        echo "→ Зеркало ${bucket}"
        mc mirror --overwrite --remove "media/${bucket}" "backup/${BACKUP_S3_BUCKET}/media/${bucket}"
      fi
    done
  fi

  # Ротация в хранилище: столько же дней, сколько локально.
  mc rm --recursive --force --older-than "${KEEP_DAYS}d" "backup/${BACKUP_S3_BUCKET}/db/" > /dev/null || true
fi

# ── Ротация локальных снимков ────────────────────────────────────────────────
find "$BACKUP_DIR" -name 'studenthub-*.dump*' -mtime "+${KEEP_DAYS}" -delete

echo "Готово: ${DUMP} (${SIZE})"
