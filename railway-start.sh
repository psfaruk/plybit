#!/bin/bash
# railway-start.sh — Railway runtime startup (FINAL VERSION)
# Uses ONLY bun (no node dependency). Build already done by Nixpacks.

set -e

echo "=== [railway] Starting OTC Binary Signals App ==="
echo "=== [railway] Time: $(date -u) ==="
echo "=== [railway] Runtime: $(which bun) ==="
echo "=== [railway] Bun version: $(bun --version 2>/dev/null || echo 'unknown') ==="

cd /app

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

# ── Verify .next directory exists (build output) ──
echo "=== [railway] Checking build output ==="
if [ -d ".next" ]; then
  echo "[railway] ✓ .next directory exists"
  ls .next/ | head -5
else
  echo "[railway] ✗ .next directory MISSING — build may have failed"
  echo "[railway] Attempting to build now..."
  NEXT_TELEMETRY_DISABLED=1 npx next build --no-turbo 2>&1 | tail -20 || true
fi

# ── Start mini-service (background) ──
echo "=== [railway] Starting mini-service (port 3003+3004) ==="
cd /app/mini-services/otc-engine
setsid nohup bun --env-file=/app/.env index.ts > /tmp/mini-service.log 2>&1 < /dev/null &
MINI_PID=$!
disown $MINI_PID
echo "[railway] Mini-service PID: $MINI_PID"

# Wait for mini-service to start
sleep 3

# ── Start Next.js (foreground — main process) ──
echo "=== [railway] Starting Next.js (port ${PORT:-8080}) ==="
cd /app

# Use bunx to run next start — bunx finds the next binary in node_modules/.bin
# This does NOT require node to be installed (bun runs the JS directly)
exec bunx next start -p ${PORT:-8080}
