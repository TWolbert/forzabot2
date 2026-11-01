#!/bin/sh
set -eu

: "${TOKEN:?TOKEN must be set}"
: "${DATABASE_PATH:=/data/forzabot.db}"

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

# Give the API a moment to initialize the database before the bot opens it.
# The bot itself retries nothing, so a failure here is fatal and visible.
i=0
while [ "$i" -lt 50 ]; do
  if [ -f "$DATABASE_PATH" ]; then break; fi
  i=$((i + 1))
  sleep 0.2
done

forzabot-discord "$@"
