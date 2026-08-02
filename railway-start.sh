#!/bin/bash
# railway-start.sh — Railway runtime startup
# Runs: 1) mini-service (background, internal only)
#       2) custom server.js (Next.js + Socket.io on same port)

set -e

echo "=== [railway] Starting OTC Binary Signals App ==="
echo "=== [railway] Time: $(date -u) ==="

cd /app

# ── Ensure /app/db directory exists (Prisma needs this for SQLite) ──
mkdir -p /app/db

# ── Write .env FIRST (before prisma db push needs DATABASE_URL) ──
cat > /app/.env << EOF
DATABASE_URL=file:/app/db/custom.db
QX_TOKEN=${QX_TOKEN:-}
QX_COOKIES=${QX_COOKIES:-}
QX_IS_DEMO=${QX_IS_DEMO:-0}
MINI_SERVICE_URL=http://localhost:3003
EOF

# Export vars so subprocesses (prisma, node) inherit them too
export DATABASE_URL=file:/app/db/custom.db
export QX_TOKEN="${QX_TOKEN:-}"
export QX_COOKIES="${QX_COOKIES:-}"
export QX_IS_DEMO="${QX_IS_DEMO:-0}"
export MINI_SERVICE_URL=http://localhost:3003

# ── Write .z-ai-config for the AI agent (GLM 5.2 SDK) ──────────────────────
# The z-ai-web-dev-sdk requires a .z-ai-config file with baseUrl + apiKey.
# On Railway, we generate it at runtime from env vars (or use defaults).
# Priority: ZAI_API_KEY env var > default "Z.ai" (works with internal API).
cat > /app/mini-services/otc-engine/.z-ai-config << ZAICONFIG
{
  "baseUrl": "${ZAI_BASE_URL:-https://internal-api.z.ai/v1}",
  "apiKey": "${ZAI_API_KEY:-Z.ai}",
  "chatId": "${ZAI_CHAT_ID:-chat-otc-agent}",
  "userId": "${ZAI_USER_ID:-otc-agent}"
}
ZAICONFIG

# Also write to home dir as fallback (SDK checks cwd → home → /etc)
cp /app/mini-services/otc-engine/.z-ai-config /root/.z-ai-config 2>/dev/null || true

echo "=== [railway] Environment ==="
echo "  DATABASE_URL=$DATABASE_URL"
echo "  QX_TOKEN length: ${#QX_TOKEN}"
echo "  QX_COOKIES length: ${#QX_COOKIES}"
echo "  QX_IS_DEMO=$QX_IS_DEMO"
echo "  ZAI_BASE_URL=${ZAI_BASE_URL:-https://internal-api.z.ai/v1}"
echo "  ZAI_API_KEY set: $([ -n "$ZAI_API_KEY" ] && echo yes || echo 'no (using default)')"
echo "  .z-ai-config: $(ls -la /app/mini-services/otc-engine/.z-ai-config 2>&1 | awk '{print $5" bytes"}')"

# ── Push database schema (now .env exists, prisma will find DATABASE_URL) ──
echo "=== [railway] Setting up database ==="
bunx prisma db push --accept-data-loss 2>&1 | tail -10 || echo "[railway] db push failed (continuing)"

# ── Verify DB is writable ──
if [ -f /app/db/custom.db ]; then
  echo "=== [railway] DB file exists: $(ls -la /app/db/custom.db) ==="
else
  echo "=== [railway] WARN: DB file not created, prisma may not have initialized properly ==="
fi

# ── Start mini-service (background — connects to Quotex, writes to DB) ──
echo "=== [railway] Starting mini-service (port 3003, internal) ==="
cd /app/mini-services/otc-engine
setsid nohup bun --env-file=/app/.env index.ts > /tmp/mini-service.log 2>&1 < /dev/null &
MINI_PID=$!
disown $MINI_PID
echo "[railway] Mini-service PID: $MINI_PID"

sleep 5

# Show mini-service startup log so we can debug if Quotex auth fails
echo "=== [railway] Mini-service startup log (last 15 lines) ==="
tail -15 /tmp/mini-service.log 2>/dev/null || echo "(no log yet)"

# ── Start custom server.js (Next.js + Socket.io on same port) ──
# Uses Node.js (NOT Bun — Bun crashes with stack smashing on standalone server)
echo "=== [railway] Starting Next.js + Socket.io (port ${PORT:-8080}) ==="
cd /app
exec node server.js
