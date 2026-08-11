#!/usr/bin/env bash
# Cross-language e2e: start the Python FastAPI cloud, drive it with the real
# Node desktop sync client. Proves the migration preserves the HTTP contract.
set -u
cd "$(dirname "$0")/.."

PORT=8791
SID="sch_cross"
KEY="sk_crosstest_key"

SEED_SCHOOL_ID="$SID" SEED_SCHOOL_KEY="$KEY" SEED_SCHOOL_NAME="Ave Maria" \
  ALLOW_DEV_SECRET=1 ALLOW_MEMORY_STORE=1 \
  python3 -m uvicorn app.main:app --port "$PORT" --log-level warning &
UV_PID=$!
trap 'kill $UV_PID 2>/dev/null' EXIT

# Wait for the server to be ready.
for i in $(seq 1 40); do
  if curl -s "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then break; fi
  sleep 0.25
done

node tests/cross_client.js "http://127.0.0.1:$PORT" "$SID" "$KEY"
RC=$?
kill $UV_PID 2>/dev/null
exit $RC
