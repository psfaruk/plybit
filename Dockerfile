# ─────────────────────────────────────────────────────────────────────────────
# Railway Deploy Dockerfile — OTC Binary Signals App
# Runs BOTH Next.js (port 3000) + mini-service (port 3003/3004) in one container
# ─────────────────────────────────────────────────────────────────────────────

FROM oven/bun:1.1 AS base
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy package files + install dependencies
COPY package.json bun.lock* ./
COPY mini-services/otc-engine/package.json mini-services/otc-engine/bun.lock* ./mini-services/otc-engine/
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# Install mini-service dependencies
WORKDIR /app/mini-services/otc-engine
RUN bun install --frozen-lockfile 2>/dev/null || bun install
WORKDIR /app

# Copy prisma schema + generate client
COPY prisma ./prisma
RUN bunx prisma generate

# Copy source code
COPY . .

# Create db directory
RUN mkdir -p /app/db

# Create startup script
COPY railway-start.sh /app/railway-start.sh
RUN chmod +x /app/railway-start.sh

# Expose ports (Next.js + mini-service + HTTP API)
EXPOSE 3000 3003 3004

# Environment variables with defaults
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL=file:/app/db/custom.db
ENV HOSTNAME=0.0.0.0

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/ || exit 1

# Start both services
CMD ["/app/railway-start.sh"]
