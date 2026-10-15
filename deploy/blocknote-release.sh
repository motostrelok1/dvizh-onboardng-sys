#!/usr/bin/env bash
# One-time reviewed full-stack rollout for BlockNote dependencies + additive migration.
# Run directly as root on the VDS in an approved maintenance window.
# NEVER called by the normal GitHub auto-deploy workflow.
set -Eeuo pipefail
umask 077
[[ "$(id -u)" -eq 0 ]] || { echo "Root required" >&2; exit 1; }
export PATH="/opt/node24/bin:$PATH"
APP=/opt/lms
WEB=/var/www/lms/client-dist
BACKUPS=/var/backups/lms
TARGET="${1:?Usage: blocknote-release.sh <40-char-target-SHA>}"
[[ "$TARGET" =~ ^[a-f0-9]{40}$ ]] || exit 1
cd "$APP"
[[ "$(git branch --show-current)" == main && -z "$(git status --porcelain)" ]] || {
  echo "Expected clean main checkout" >&2; exit 1;
}
git fetch origin main
[[ "$(git rev-parse origin/main)" == "$TARGET" ]] || { echo "Target not latest main" >&2; exit 1; }
git merge-base --is-ancestor HEAD "$TARGET"
[[ ! -e "$BACKUPS/RECONCILE-BEFORE-NEXT-DEPLOY" ]] || { echo "Previous deploy needs reconciliation" >&2; exit 1; }
systemctl is-active --quiet lms || { echo "LMS must be active before maintenance" >&2; exit 1; }
[[ -s "$WEB/index.html" && -s "$APP/server/dist/index.js" ]] || exit 1
[[ -f "$APP/server/.env" && -d "$APP/server/uploads" ]] || exit 1
for cmd in pg_dump pg_restore npm tar rsync curl git systemctl flock; do command -v "$cmd" >/dev/null || exit 1; done
# Explicitly limit the special case to the BlockNote additive schema migration.
new_migrations="$(git diff --name-only HEAD "$TARGET" -- server/migrations/)"
[[ "$new_migrations" == "server/migrations/1700000018000_rich_lesson_content.cjs" ]] || {
  echo "Unexpected migration set. Review required" >&2; exit 1;
}
# Refuse changes that need their own infrastructure release.
if git diff --name-only HEAD "$TARGET" | grep -Eq '^(deploy/lms.service|deploy/nginx.conf.example|server/.env|server/package.json)$'; then
  echo "Unexpected infrastructure or backend dependency change" >&2; exit 1
fi
exec 9>"$BACKUPS/blocknote-release.lock"
flock -n 9 || { echo "Another BlockNote release running" >&2; exit 1; }
FROM="$(git rev-parse HEAD)"
mkdir -p "$BACKUPS"
chmod 700 "$BACKUPS"
BACKUP="$(mktemp -d "$BACKUPS/blocknote-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXXXX")"
echo "Maintenance backup: $BACKUP; from $FROM"
stopped=0
migrated=0
rollback() {
  code=$?
  trap - ERR
  if [[ "$stopped" == 1 ]]; then
    echo "Release failed. Restoring old server/frontend and dependencies" >&2
    rsync -a --delete "$BACKUP/server-dist/" "$APP/server/dist/" || true
    rsync -a --checksum --delete --chmod=D755,F644 "$BACKUP/frontend/" "$WEB/" || true
    if [[ -f "$BACKUP/node-modules.tar.gz" ]]; then
      rm -rf "$APP/node_modules"
      tar -xzf "$BACKUP/node-modules.tar.gz" -C "$APP" || true
    fi
    find "$APP/server/dist" -type d -exec chmod a+rx {} + || true
    find "$APP/server/dist" -type f -exec chmod a+r {} + || true
    systemctl start lms || echo "CRITICAL: LMS failed to restart" >&2
    if ! curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3001/health >/dev/null; then
      echo "CRITICAL: service health failed after rollback" >&2
    fi
    if [[ "$(git rev-parse HEAD)" != "$FROM" ]]; then
      echo "$FROM" > "$BACKUPS/RECONCILE-BEFORE-NEXT-DEPLOY"
    fi
    if [[ "$migrated" == 1 ]]; then
      echo "Database migration was applied: additive columns remain. DB dump available at $BACKUP/database.dump" >&2
    fi
  fi
  exit "$code"
}
trap rollback ERR
systemctl stop lms
stopped=1
sudo -u postgres pg_dump -Fc -d lms > "$BACKUP/database.dump"
pg_restore -l "$BACKUP/database.dump" >/dev/null
tar -czf "$BACKUP/uploads.tar.gz" -C "$APP/server" uploads
tar -tzf "$BACKUP/uploads.tar.gz" >/dev/null
rsync -a "$WEB/" "$BACKUP/frontend/"
rsync -a "$APP/server/dist/" "$BACKUP/server-dist/"
tar -czf "$BACKUP/node-modules.tar.gz" -C "$APP" node_modules
tar -tzf "$BACKUP/node-modules.tar.gz" >/dev/null
test -s "$BACKUP/server-dist/index.js"
test -s "$BACKUP/frontend/index.html"
git merge --ff-only "$TARGET"
npm ci
npm run build
# The new migration adds nullable JSONB and nonnegative revision; no legacy text data is rewritten.
npm run check:content-integrity --workspace server
npm run check:attempt-integrity --workspace server
npm run migrate --workspace server
migrated=1
find "$APP/server/dist" -type d -exec chmod a+rx {} +
find "$APP/server/dist" -type f -exec chmod a+r {} +
find "$APP/node_modules" -type d -exec chmod a+rx {} +
find "$APP/node_modules" -type f -exec chmod a+r {} +
rsync -a --checksum --delete --chmod=D755,F644 "$APP/client/dist/" "$WEB/"
systemctl start lms
for i in $(seq 1 15); do
  if curl --fail --silent --show-error --max-time 4 http://127.0.0.1:3001/health >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS http://127.0.0.1:3001/health >/dev/null
curl -fsS http://127.0.0.1:3001/health/db >/dev/null
curl -fsS https://lms.dvizh-school.ru/api/health >/dev/null
curl -fsS https://lms.dvizh-school.ru/index.html > "$BACKUP/new-index.html"
grep -q '<div id="root">' "$BACKUP/new-index.html"
stopped=0
trap - ERR
echo "BlockNote deployed $(git rev-parse --short HEAD); backup $BACKUP"
