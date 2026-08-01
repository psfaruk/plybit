#!/bin/bash
# railway-start.sh — Railway runtime startup (build already done by Nixpacks)
# Starts BOTH Next.js + mini-service

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
echo "[railway] Mini-service PID: $!"

# Wait for mini-service
sleep 5

# ── Start Next.js (foreground) ──
echo "=== [railway] Starting Next.js (port ${PORT:-3000}) ==="
cd /app
exec node .next/standalone/server.js
