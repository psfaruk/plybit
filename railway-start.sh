#!/bin/bash
# railway-start.sh — Railway runtime startup
# Build already done by Nixpacks. Uses bun to run standalone server.

set -e

echo "=== [railway] Starting OTC Binary Signals App ==="
echo "=== [railway] Time: $(date -u) ==="

cd /app

# ── Verify libssl exists (Prisma needs it) ──
if [ ! -f "/usr/lib/x86_64-linux-gnu/libssl.so.3" ]; then
  echo "[railway] ⚠ libssl.so.3 not found at default path, searching..."
  find / -name "libssl.so.3" 2>/dev/null | head -3
fi
echo "[railway] OpenSSL check: $(openssl version 2>/dev/null || echo 'not found')"

# ── Push database schema ──
echo "=== [railway] Setting up database ==="
bunx prisma db push 2>/dev/null || echo "[railway] db push skipped"

# ── Write .env from Railway env vars ──
echo "=== [railway] Writing .env ==="
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
MINI_PID=$!
disown $MINI_PID
echo "[railway] Mini-service PID: $MINI_PID"

# Wait for mini-service to start
sleep 5

# ── Start Next.js standalone server with bun ──
echo "=== [railway] Starting Next.js (port ${PORT:-8080}) ==="
cd /app

# Set LD_LIBRARY_PATH so Prisma can find libssl
export LD_LIBRARY_PATH="/usr/lib/x86_64-linux-gnu:/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"

PORT=${PORT:-8080} HOSTNAME=0.0.0.0 exec bun .next/standalone/server.js
