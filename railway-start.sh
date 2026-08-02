#!/bin/bash
# railway-start.sh — Railway runtime startup
# Uses `next start` (NOT standalone server.js which crashes Bun with stack smashing)

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

# ── Start mini-service (background) ──
echo "=== [railway] Starting mini-service (port 3003+3004) ==="
cd /app/mini-services/otc-engine
setsid nohup bun --env-file=/app/.env index.ts > /tmp/mini-service.log 2>&1 < /dev/null &
MINI_PID=$!
disown $MINI_PID
echo "[railway] Mini-service PID: $MINI_PID"

sleep 3

# ── Start Next.js using `next start` (NOT standalone server.js) ──
# standalone server.js crashes Bun with "stack smashing detected"
# `next start` is designed to work with any runtime including Bun
echo "=== [railway] Starting Next.js (port ${PORT:-8080}) ==="
cd /app
exec bunx next start -p ${PORT:-8080}
