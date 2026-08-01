#!/bin/bash
# Mini-service launcher — properly detaches the OTC engine so it survives shell exit.
cd "$(dirname "$0")"

# Kill any stale instance — try multiple approaches
fuser -k 3003/tcp 2>/dev/null || true
pkill -9 -f "otc-engine/index.ts" 2>/dev/null || true
pkill -9 -f "bun.*otc-engine" 2>/dev/null || true
sleep 2
# Double-check port is free
if ss -ltn 2>/dev/null | grep -q ":3003 "; then
  echo "[launcher] WARN: port 3003 still in use, waiting…"
  sleep 3
fi

# Load env vars from the project root .env (parent of mini-services/otc-engine)
ENV_FILE="$(cd ../.. && pwd)/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  . "$ENV_FILE"
  set +a
  echo "[launcher] loaded env from $ENV_FILE"
fi

# Start fully detached with setsid + nohup.
# Pass --env-file so bun picks up the vars in-process too.
setsid nohup bun --env-file="$ENV_FILE" --hot index.ts > .dev.log 2>&1 < /dev/null &
echo $! > .pid
sleep 4

if ss -ltn 2>/dev/null | grep -q ":3003 "; then
  echo "[launcher] mini-service alive on port 3003 (PID $(cat .pid))"
else
  echo "[launcher] FAILED to start mini-service. Log:"
  cat .dev.log
fi
