#!/bin/sh
set -eu

: "${TOKEN:?TOKEN must be set}"
: "${DATABASE_PATH:=/data/forzabot.db}"
: "${CAR_IMAGES_PATH:=/data/car-images}"
: "${RUST_API_ADDR:=0.0.0.0:8080}"

# Volumes created by the previous root-running Bun container are root-owned.
# SQLite needs write access to both the database file and its directory (for
# journal/lock files), so repair ownership once and then drop privileges.
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$(dirname "$DATABASE_PATH")" "$CAR_IMAGES_PATH"
  chown -R forzabot:forzabot "$(dirname "$DATABASE_PATH")" "$CAR_IMAGES_PATH" 2>/dev/null || true
  exec setpriv --reuid=forzabot --regid=forzabot --init-groups "$0" "$@"
fi

# The API owns schema upgrades and the HTTP/dashboard listener. The bot only
# consumes the resulting database, so start the API first and stop it with the
# container lifecycle.
forzabot-api &
api_pid=$!

cleanup() {
  kill -TERM "$api_pid" 2>/dev/null || true
  wait "$api_pid" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# Wait until the API has completed migrations and is serving requests. This
# avoids running schema initialization in both processes at once, which can
# surface as "database is locked", especially when redeploying over an existing
# database file.
api_port="${RUST_API_ADDR##*:}"
health_url="http://127.0.0.1:${api_port}/api/races"
i=0
while [ "$i" -lt 1500 ]; do
  if ! kill -0 "$api_pid" 2>/dev/null; then
    echo "API exited before becoming ready" >&2
    wait "$api_pid" || true
    exit 1
  fi
  if wget -qO- "$health_url" >/dev/null 2>&1; then
    break
  fi
  i=$((i + 1))
  sleep 0.2
done
if [ "$i" -ge 1500 ]; then
  echo "API did not become ready at $health_url" >&2
  exit 1
fi

forzabot-discord "$@"
