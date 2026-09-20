#!/usr/bin/env bash
# Starts the web app's standalone production build in the background and waits
# for it to answer, the way the container image runs it.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

standalone="apps/web/.next/standalone"
rm -rf "$standalone/apps/web/.next/static" "$standalone/apps/web/public"
cp -r apps/web/.next/static "$standalone/apps/web/.next/static"
cp -r apps/web/public "$standalone/apps/web/public"

# The runner sets HOSTNAME to the machine name, which is not what the tests dial.
export NODE_ENV=production PORT="${PORT:-3000}" HOSTNAME="${WEB_HOST:-127.0.0.1}"

if curl -fsS "http://localhost:${PORT}/healthz" > /dev/null 2>&1; then
  echo "something already answers on :${PORT}; refusing to report it as this build" >&2
  exit 1
fi
(cd "$standalone" && nohup node apps/web/server.js > "${WEB_LOG:-/tmp/lfsci-web.log}" 2>&1 &)

for _ in $(seq 1 60); do
  if curl -fsS "http://localhost:${PORT}/healthz" > /dev/null 2>&1; then
    echo "web answering on :${PORT}"
    exit 0
  fi
  sleep 1
done
echo "web did not answer within 60 s" >&2
tail -50 "${WEB_LOG:-/tmp/lfsci-web.log}" >&2
exit 1
