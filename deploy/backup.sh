#!/usr/bin/env bash
# Ежедневный бэкап LMS: дамп PostgreSQL + архив вложений (uploads),
# с ротацией старых копий. Запускать по cron на сервере:
#   0 3 * * * APP_DIR=/opt/lms BACKUP_DIR=/var/backups/lms /opt/lms/deploy/backup.sh >> /var/log/lms-backup.log 2>&1
#
# Восстановление — см. комментарий внизу файла.

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/lms}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/lms}"
KEEP_DAYS="${KEEP_DAYS:-14}"
DATABASE_URL="${DATABASE_URL:-$(grep -E '^DATABASE_URL=' "$APP_DIR/server/.env" | cut -d= -f2-)}"
UPLOAD_DIR="${UPLOAD_DIR:-$APP_DIR/server/uploads}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"

echo "==> Дамп базы данных"
pg_dump --format=custom --file="$BACKUP_DIR/db-$STAMP.dump" "$DATABASE_URL"

echo "==> Архив вложений"
if [ -d "$UPLOAD_DIR" ]; then
  tar -czf "$BACKUP_DIR/uploads-$STAMP.tar.gz" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"
else
  echo "    $UPLOAD_DIR не найден — пропущено"
fi

echo "==> Ротация копий старше $KEEP_DAYS дней"
find "$BACKUP_DIR" -maxdepth 1 -name 'db-*.dump' -mtime "+$KEEP_DAYS" -print -delete
find "$BACKUP_DIR" -maxdepth 1 -name 'uploads-*.tar.gz' -mtime "+$KEEP_DAYS" -print -delete

echo "==> Готово: $BACKUP_DIR/db-$STAMP.dump, $BACKUP_DIR/uploads-$STAMP.tar.gz"

# --- Восстановление ---
#
# База данных (дамп подаётся через stdin — pg_restore от пользователя
# postgres не может прочитать файл в домашней директории другого юзера):
#   createdb lms_restore
#   pg_restore -d lms_restore < "$BACKUP_DIR/db-<STAMP>.dump"
#
# Вложения:
#   tar -xzf "$BACKUP_DIR/uploads-<STAMP>.tar.gz" -C /путь/назначения
#
# Проверка восстановления делается на тестовой БД (lms_restore), не на
# боевой — см. журнал STAGE12.md, где зафиксирован результат такой проверки.
