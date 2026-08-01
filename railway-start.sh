#!/bin/bash
# railway-start.sh — Railway runtime startup
# Build already done by Nixpacks. This starts both services.
# Uses `next start` (NOT standalone server.js — that needs node binary which
# Nixpacks doesn't install at runtime, only bun is available)

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
sleep 3

# ── Start Next.js (foreground) ──
# Use `bun run start` which calls `next start` — works with bun runtime
# Railway sets PORT env var (usually 8080)
echo "=== [railway] Starting Next.js (port ${PORT:-8080}) ==="
cd /app
exec bunx next start -p ${PORT:-8080}
