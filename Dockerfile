# ─────────────────────────────────────────────────────────────────────────────
# Railway Deploy Dockerfile — OTC Binary Signals App
# Multi-stage: Node.js for build (Turbopack needs worker_threads), Bun for runtime
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Build with Node.js (Bun doesn't support Turbopack worker_threads) ──
FROM node:20-slim AS builder
WORKDIR /app

# Install bun in builder stage (for installing deps)
RUN npm install -g bun

# Copy package files
COPY package.json bun.lock* ./
COPY mini-services/otc-engine/package.json mini-services/otc-engine/bun.lock* ./mini-services/otc-engine/
COPY prisma ./prisma

# Install dependencies with bun (faster)
RUN bun install --frozen-lockfile 2>/dev/null || bun install
RUN cd mini-services/otc-engine && bun install --frozen-lockfile 2>/dev/null || bun install

# Generate Prisma client
RUN bunx prisma generate

# Copy all source
COPY . .

# Build Next.js with Node.js (NOT bun — Turbopack needs worker_threads support)
# Use --no-turbo to use webpack instead of Turbopack (better worker_threads support)
# Limit workers to reduce memory usage (Railway has ~512MB-1GB)
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--max-old-space-size=1024"
RUN npx next build --no-turbo || npx next build

# Copy static files to standalone output
RUN cp -r .next/static .next/standalone/.next/ 2>/dev/null || true
RUN cp -r public .next/standalone/ 2>/dev/null || true

# ── Stage 2: Runtime with Bun (smaller image, faster startup) ──
FROM oven/bun:1.1-slim
WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy built standalone Next.js from builder
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy mini-service source + node_modules
COPY --from=builder /app/mini-services ./mini-services
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json

# Copy startup script
COPY railway-start.sh /app/railway-start.sh
RUN chmod +x /app/railway-start.sh

# Create db directory
RUN mkdir -p /app/db

# Expose ports
EXPOSE 3000 3003 3004

# Environment
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL=file:/app/db/custom.db
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/ || exit 1

CMD ["/app/railway-start.sh"]
