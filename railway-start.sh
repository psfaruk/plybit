#!/bin/bash
# railway-start.sh — Railway runtime startup
# Runs: 1) mini-service (background, internal only)
#       2) custom server.js (Next.js + Socket.io on same port)

set -e

echo "=== [railway] Starting OTC Binary Signals App ==="
echo "=== [railway] Time: $(date -u) ==="

cd /app

# ── Push database schema ──
echo "=== [railway] Setting up database ==="
bunx prisma db push 2>/dev/null || echo "[railway] db push skipped"

# ── Write .env from Railway env vars ──
cat > /app/.env << EOF
DATABASE_URL=file:/app/db/custom.db
QX_TOKEN=${QX_TOKEN:-}
QX_COOKIES=${QX_COOKIES:-}
QX_IS_DEMO=${QX_IS_DEMO:-0}
EOF

# ── Start mini-service (background — connects to Quotex, writes to DB) ──
echo "=== [railway] Starting mini-service (port 3003, internal) ==="
cd /app/mini-services/otc-engine
setsid nohup bun --env-file=/app/.env index.ts > /tmp/mini-service.log 2>&1 < /dev/null &
MINI_PID=$!
disown $MINI_PID
echo "[railway] Mini-service PID: $MINI_PID"

sleep 3

# ── Start custom server.js (Next.js + Socket.io on same port) ──
# Uses Node.js (NOT Bun — Bun crashes with stack smashing on standalone server)
echo "=== [railway] Starting Next.js + Socket.io (port ${PORT:-8080}) ==="
cd /app
exec node server.js
