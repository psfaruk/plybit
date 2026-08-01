#!/bin/bash
# railway-start.sh — Railway deploy startup script
# Starts BOTH Next.js + mini-service, both detached so they survive

set -e

echo "=== [railway] Starting OTC Binary Signals App ==="
echo "=== [railway] Time: $(date -u) ==="
echo "=== [railway] Node env: $NODE_ENV ==="

cd /app

# ── Generate Prisma client + push schema ──
echo "=== [railway] Setting up database ==="
bunx prisma generate
bunx prisma db push || echo "[railway] db push skipped (will use existing)"

# ── Build Next.js for production ──
echo "=== [railway] Building Next.js ==="
bun run build

# ── Write .env from Railway env vars (if not already set) ──
if [ ! -f /app/.env ] || [ -z "$(grep QX_TOKEN /app/.env 2>/dev/null)" ]; then
  echo "=== [railway] Writing .env from Railway environment ==="
  cat > /app/.env << EOF
DATABASE_URL=file:/app/db/custom.db
QX_TOKEN=${QX_TOKEN:-}
QX_COOKIES=${QX_COOKIES:-}
QX_IS_DEMO=${QX_IS_DEMO:-0}
EOF
fi

# ── Start mini-service (detached) ──
echo "=== [railway] Starting mini-service (port 3003 + 3004) ==="
cd /app/mini-services/otc-engine
setsid nohup bun --env-file=/app/.env index.ts > /tmp/mini-service.log 2>&1 < /dev/null &
MINI_PID=$!
disown $MINI_PID
echo "[railway] Mini-service PID: $MINI_PID"

# Wait for mini-service to be ready
sleep 5

# ── Start Next.js (foreground — this is the main process) ──
echo "=== [railway] Starting Next.js (port $PORT) ==="
cd /app
exec bun run start
