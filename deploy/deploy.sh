#!/usr/bin/env bash
# Обновление LMS на VDS: подтянуть код, собрать server и client, прогнать
# миграции, перезапустить сервис. Запускать на сервере, от пользователя,
# у которого есть право на `systemctl restart lms` (sudo) и запись в APP_DIR.
#
# Использование: ./deploy.sh
# Переменные можно переопределить перед вызовом, например:
#   APP_DIR=/opt/lms ./deploy.sh

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/lms}"
WEB_ROOT="${WEB_ROOT:-/var/www/lms/client-dist}"
SERVICE_NAME="${SERVICE_NAME:-lms}"
BRANCH="${BRANCH:-main}"

echo "==> Обновление репозитория ($APP_DIR, ветка $BRANCH)"
cd "$APP_DIR"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "==> Установка зависимостей"
npm ci

echo "==> Миграции БД"
npm run migrate --workspace=server

echo "==> Сборка сервера"
npm run build --workspace=server

echo "==> Проверка APP_ORIGIN для production"
# Read the service's env file, not a possibly different shell APP_ORIGIN.
# Fail before publishing client files or restarting the working service.
node --input-type=module -e '
import { config } from "dotenv";
import { configuredOrigin } from "./server/dist/csrf.js";
const env = config({ path: "server/.env" });
if (env.error) throw new Error("Cannot read server/.env");
configuredOrigin(env.parsed?.APP_ORIGIN ?? "", true);
'

echo "==> Сборка клиента"
npm run build --workspace=client

echo "==> Публикация статики клиента в $WEB_ROOT"
mkdir -p "$WEB_ROOT"
rsync -a --delete "$APP_DIR/client/dist/" "$WEB_ROOT/"

echo "==> Перезапуск сервиса $SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"
sleep 1
sudo systemctl --no-pager --full status "$SERVICE_NAME" | head -n 10

echo "==> Проверка здоровья"
curl -fsS http://127.0.0.1:3000/health
echo
curl -fsS http://127.0.0.1:3000/health/db
echo
echo "==> Готово"
