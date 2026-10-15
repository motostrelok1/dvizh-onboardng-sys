#!/usr/bin/env bash
# Safe frontend-only update for LMS VDS. Does NOT restart backend, migrate DB,
# install dependencies or run deploy/deploy.sh.
set -Eeuo pipefail
umask 077

APP_DIR="${APP_DIR:-/opt/lms}"
WEB_ROOT="${WEB_ROOT:-/var/www/lms/client-dist}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/lms}"
NODE_BIN="${NODE_BIN:-/opt/node24/bin}"
PUBLIC_URL="${PUBLIC_URL:-https://lms.dvizh-school.ru}"

die() { echo "ERROR: $*" >&2; exit 1; }
command -v git >/dev/null && command -v rsync >/dev/null && command -v curl >/dev/null || die "git/rsync/curl required"
[[ -x "$NODE_BIN/node" && -x "$NODE_BIN/npm" ]] || die "Dedicated Node/npm not found at $NODE_BIN"
export PATH="$NODE_BIN:$PATH"
cd "$APP_DIR"
[[ -z "$(git status --porcelain)" ]] || die "Working tree is dirty; inspect with git status --short"
[[ "$(git branch --show-current)" == "main" ]] || die "Checkout main before updating"
git fetch origin main
git merge-base --is-ancestor HEAD origin/main || die "main diverged; manual merge required"

# Frontend-only gate: never accidentally deploy code needing migrations/backend changes.
changed="$(git diff --name-only HEAD origin/main)"
while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  case "$file" in
    client/*|README.md|PROGRESS.md|DEPLOY.md|HARDENING.md|additions.md|docs/*) ;;
    *) die "Not frontend-only change: $file. Use reviewed full-stack rollout." ;;
  esac
done <<< "$changed"

if [[ -z "$changed" ]]; then
  echo "No new commits; verifying current site."
  curl -fsS "$PUBLIC_URL/api/health" >/dev/null
  exit 0
fi

# Existing lockfile/dependencies must already be installed. Keep backend untouched.
git merge --ff-only origin/main
echo "Building client with $(node -v)"
npm run build --workspace client
[[ -s "$APP_DIR/client/dist/index.html" ]] || die "Frontend build missing index.html"

mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="$BACKUP_ROOT/frontend-$stamp"
mkdir -m 700 "$backup"
published=0
rollback() {
  status=$?
  trap - ERR
  if [[ "$published" -eq 1 ]]; then
    echo "ERROR: Publishing failed; restoring old frontend from $backup" >&2
    rsync -a --delete --chmod=D755,F644 "$backup/" "$WEB_ROOT/" || true
  fi
  exit "$status"
}
trap rollback ERR
rsync -a "$WEB_ROOT/" "$backup/"
published=1
rsync -a --delete --chmod=D755,F644 "$APP_DIR/client/dist/" "$WEB_ROOT/"

# Do not leak site contents/tokens; check only public health and required static file.
curl --fail --silent --show-error --max-time 15 "$PUBLIC_URL/api/health" >/dev/null
curl --fail --silent --show-error --max-time 15 "$PUBLIC_URL/index.html" | grep -q '<div id="root">'
published=0
trap - ERR
echo "Frontend updated: $(git rev-parse --short HEAD)"
echo "Rollback copy: $backup"
echo "No backend restart or DB changes were made."
