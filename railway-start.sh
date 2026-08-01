#!/bin/bash
# railway-start.sh — Railway deploy startup script
# Build already done in Dockerfile. This just starts both services.

set -e

echo "=== [railway] Starting OTC Binary Signals App ==="
echo "=== [railway] Time: $(date -u) ==="
echo "=== [railway] Node env: $NODE_ENV ==="

cd /app

# ── Push database schema (create tables if not exist) ──
echo "=== [railway] Setting up database ==="
bunx prisma db push 2>/dev/null || echo "[railway] db push skipped (tables may already exist)"

# ── Write .env from Railway env vars ──
echo "=== [railway] Writing .env ==="
cat > /app/.env << EOF
DATABASE_URL=file:/app/db/custom.db
QX_TOKEN=${QX_TOKEN:-}
QX_COOKIES=${QX_COOKIES:-}
QX_IS_DEMO=${QX_IS_DEMO:-0}
EOF

# ── Start mini-service (detached) ──
echo "=== [railway] Starting mini-service (port 3003 + 3004) ==="
cd /app/mini-services/otc-engine
setsid nohup bun --env-file=/app/.env index.ts > /tmp/mini-service.log 2>&1 < /dev/null &
MINI_PID=$!
disown $MINI_PID
echo "[railway] Mini-service PID: $MINI_PID"

# Wait for mini-service to start
sleep 5

# ── Start Next.js (foreground — main process) ──
echo "=== [railway] Starting Next.js (port $PORT) ==="
cd /app

# Use the standalone server built by Next.js
# It's a Node.js server, so we run it with bun (which can run node servers)
exec bun .next/standalone/server.js 2>&1
