#!/usr/bin/env bash
# Downloads a pinned PocketBase, verifies its SHA-256, creates a CI superuser and starts it with
# this repo's migrations and hooks. Used by the "PocketBase integration" CI job (M1 acceptance).
set -euo pipefail

PB_VERSION="0.34.2"
PB_SHA256="a469d8ad8e6bd571b50841d63cd8b5c2e79d66552f9749221fd20ce497ade027" # pocketbase_${PB_VERSION}_linux_amd64.zip
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$ROOT/server/bin"
DATA_DIR="$(mktemp -d)"

mkdir -p "$BIN_DIR"
ZIP="$BIN_DIR/pb.zip"
curl -fsSL -o "$ZIP" "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip"
echo "${PB_SHA256}  ${ZIP}" | sha256sum -c -
unzip -o -q "$ZIP" pocketbase -d "$BIN_DIR"

PB="$BIN_DIR/pocketbase"
ARGS=(--dir "$DATA_DIR" --migrationsDir "$ROOT/server/pb_migrations" --hooksDir "$ROOT/server/pb_hooks")
"$PB" migrate up "${ARGS[@]}"
"$PB" superuser upsert "${PB_SUPERUSER_EMAIL:?}" "${PB_SUPERUSER_PASSWORD:?}" "${ARGS[@]}"
"$PB" serve --http 127.0.0.1:8090 "${ARGS[@]}" > "$BIN_DIR/pocketbase.log" 2>&1 &
echo $! > "$BIN_DIR/pocketbase.pid"

for _ in $(seq 1 50); do
  curl -fsS http://127.0.0.1:8090/api/health > /dev/null && exit 0
  sleep 0.2
done
echo "PocketBase did not become healthy" >&2
cat "$BIN_DIR/pocketbase.log" >&2
exit 1
