#!/usr/bin/env bash
# Run on VDS as root, from a manually approved GitHub Actions deployment.
# No migrations, no git reset, no DB restores.
set -Eeuo pipefail
umask 077
TARGET="${1:?Expected target commit SHA}"
[[ "$TARGET" =~ ^[a-f0-9]{40}$ ]] || { echo "Invalid SHA" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || { echo "Must run as root" >&2; exit 1; }
export PATH="/opt/node24/bin:$PATH"
APP=/opt/lms
WEB=/var/www/lms/client-dist
BACKUPS=/var/backups/lms
cd "$APP"
[[ "$(git branch --show-current)" == main ]] || { echo "Not on main" >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo "Dirty checkout" >&2; exit 1; }
git fetch origin main
[[ "$(git rev-parse origin/main)" == "$TARGET" ]] || { echo "Target is not latest origin/main" >&2; exit 1; }
git merge-base --is-ancestor HEAD "$TARGET" || { echo "Non-fast-forward" >&2; exit 1; }
[[ ! -e "$BACKUPS/RECONCILE-BEFORE-NEXT-DEPLOY" ]] || { echo "Previous rollback needs manual reconciliation" >&2; exit 1; }
FROM="$(git rev-parse HEAD)"
if [[ "$FROM" == "$TARGET" ]]; then echo "Already at target (verify deployed artifacts manually)"; exit 0; fi
while IFS= read -r file; do
  case "$file" in
    server/migrations/*|package.json|package-lock.json|server/package.json|client/package.json|deploy/lms.service|deploy/nginx.conf.example)
      echo "Manual review required for dependency/migration/service change: $file" >&2; exit 1;;
  esac
done < <(git diff --name-only "$FROM" "$TARGET")
for cmd in pg_dump pg_restore tar rsync curl git npm systemctl; do command -v "$cmd" >/dev/null || { echo "Missing: $cmd" >&2; exit 1; }; done
[[ -s "$WEB/index.html" && -s "$APP/server/dist/index.js" ]] || { echo "Missing existing builds" >&2; exit 1; }
[[ -d "$APP/server/uploads" ]] || { echo "Missing uploads" >&2; exit 1; }
systemctl is-active --quiet lms || { echo "LMS not active before deployment" >&2; exit 1; }
mkdir -p "$BACKUPS"
chmod 700 "$BACKUPS"
BACKUP="$(mktemp -d "$BACKUPS/action-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXXXX")"
echo "Backup: $BACKUP; old commit: $FROM"
stopped=0
published=0
rollback() {
  rc=$?
  trap - ERR
  if [[ "$stopped" == 1 ]]; then
    echo "Deploy failed; restoring previous server/frontend builds" >&2
    if [[ -d "$BACKUP/server-dist" ]]; then
      rsync -a --delete "$BACKUP/server-dist/" "$APP/server/dist/" || true
      find "$APP/server/dist" -type d -exec chmod a+rx {} + || true
      find "$APP/server/dist" -type f -exec chmod a+r {} + || true
    fi
    if [[ -d "$BACKUP/frontend" ]]; then
      rsync -a --delete --chmod=D755,F644 "$BACKUP/frontend/" "$WEB/" || true
    fi
    if ! systemctl start lms; then
      echo "CRITICAL: lms.service failed to restart after rollback" >&2
    elif ! curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3001/health >/dev/null; then
      echo "CRITICAL: old LMS is not healthy after rollback" >&2
    fi
    if [[ "$(git rev-parse HEAD)" != "$FROM" ]]; then
      echo "$FROM" > "$BACKUPS/RECONCILE-BEFORE-NEXT-DEPLOY"
      echo "WARNING: old builds restored but git HEAD advanced. Manual reconciliation required." >&2
    fi
  fi
  exit "$rc"
}
trap rollback ERR
systemctl stop lms
stopped=1
# Stopping writers keeps the database dump and uploads consistent.
sudo -u postgres pg_dump -Fc -d lms > "$BACKUP/database.dump"
pg_restore -l "$BACKUP/database.dump" > /dev/null
tar -czf "$BACKUP/uploads.tar.gz" -C "$APP/server" uploads
tar -tzf "$BACKUP/uploads.tar.gz" >/dev/null
rsync -a "$WEB/" "$BACKUP/frontend/"
rsync -a "$APP/server/dist/" "$BACKUP/server-dist/"
test -s "$BACKUP/frontend/index.html"
test -s "$BACKUP/server-dist/index.js"
git merge --ff-only "$TARGET"
# Lockfiles and dependencies are gated above. Avoid npm ci against live node_modules.
[[ -d "$APP/node_modules" ]] || { echo "Dependencies missing; manual rollout required" >&2; exit 1; }
npm run build
# Only compiled artifacts need read access; never chmod secrets/uploads.
find "$APP/server/dist" -type d -exec chmod a+rx {} +
find "$APP/server/dist" -type f -exec chmod a+r {} +
test -s "$APP/client/dist/index.html"
test -s "$APP/server/dist/index.js"
rsync -a --checksum --delete --chmod=D755,F644 "$APP/client/dist/" "$WEB/"
published=1
systemctl start lms
for i in $(seq 1 10); do
  if curl --fail --silent --show-error --max-time 3 http://127.0.0.1:3001/health >/dev/null 2>&1; then break; fi
  sleep 2
done
curl --fail --silent --show-error --max-time 20 http://127.0.0.1:3001/health >/dev/null
curl --fail --silent --show-error --max-time 20 http://127.0.0.1:3001/health/db >/dev/null
curl --fail --silent --show-error --max-time 20 https://lms.dvizh-school.ru/api/health >/dev/null
curl --fail --silent --show-error --max-time 20 https://lms.dvizh-school.ru/index.html > "$BACKUP/post-deploy-index.html"
grep -q '<div id="root">' "$BACKUP/post-deploy-index.html"
stopped=0
trap - ERR
echo "Deployed $(git rev-parse --short HEAD). Backup: $BACKUP"
