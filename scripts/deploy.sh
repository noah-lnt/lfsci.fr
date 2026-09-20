#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

compose=(docker compose -f docker-compose.prod.yml)

[ -f .env ] || { echo ".env missing: copy deploy/env.prod.example and fill it" >&2; exit 1; }
missing=0
while IFS='=' read -r key _; do
  [ -z "$key" ] && continue
  case "$key" in \#*) continue ;; esac
  if ! grep -q "^${key}=" .env; then
    echo "missing in .env: $key" >&2
    missing=1
  fi
done < deploy/env.prod.example
[ "$missing" -eq 0 ] || exit 1

git pull --ff-only
"${compose[@]}" config --quiet
"${compose[@]}" build
"${compose[@]}" --profile migrate run --rm migrate
"${compose[@]}" up -d --wait --remove-orphans
"${compose[@]}" ps
