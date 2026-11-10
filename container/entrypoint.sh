#!/bin/sh
set -eu
exec node /opt/daedlo/packages/runtime/src/cli.mjs \
  --project "${DAEDLO_PROJECT:-/opt/daedlo/project/project.mjs}" \
  --host 0.0.0.0 \
  --port "${DAEDLO_PORT:-43100}" \
  --public-origin "${DAEDLO_PUBLIC_ORIGIN:-http://127.0.0.1:43100}" \
  --report "${DAEDLO_REPORT:-/evidence/session.json}" "$@"
