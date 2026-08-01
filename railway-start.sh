#!/bin/bash
# railway-start.sh — Railway runtime startup
# Build already done by Nixpacks. Uses bun to run standalone server.

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

# ── Verify build output exists ──
if [ ! -d ".next/standalone" ]; then
  echo "[railway] ✗ .next/standalone MISSING — build may have failed"
  exit 1
fi
echo "[railway] ✓ .next/standalone exists"

# ── Start mini-service (background) ──
echo "=== [railway] Starting mini-service (port 3003+3004) ==="
cd /app/mini-services/otc-engine
setsid nohup bun --env-file=/app/.env index.ts > /tmp/mini-service.log 2>&1 < /dev/null &
echo "[railway] Mini-service PID: $!"

sleep 3

# ── Start Next.js standalone server with bun ──
echo "=== [railway] Starting Next.js (port ${PORT:-8080}) ==="
cd /app
PORT=${PORT:-8080} HOSTNAME=0.0.0.0 exec bun .next/standalone/server.js
