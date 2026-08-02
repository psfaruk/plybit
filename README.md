# PlyBit — OTC Binary Signals

Real-time OTC binary options signals app with live Quotex data, AI-powered analysis (GLM 5.2), and algorithm detection.

## Features

- **Live Quotex Data** — Real-time candle data via WebSocket (NO simulation)
- **15 OTC Pairs** — USDBRL, USDPKR, USDBDT, USDPHP, USDCHF, NZDCHF, NZDCAD, USDARS, USDCOP, USDMXN, GBPCHF, USDZAR, USDDZD, USDINR, AUDCHF
- **6 Analysis Modules** — candle_reaction, running_tick, pattern, indicator, key_level, otc_pattern
- **Smart Blender** — Combines all module votes with adaptive per-pair weights
- **Algorithm Detection** — Detects broker algorithm (MEAN_REVERT, TREND_FOLLOW, BREAKOUT, etc.)
- **AI Agent (GLM 5.2)** — 24/7 analyzer that auto-adjusts weights based on performance
- **1-Minute Expiry** — Predict candle direction at open, validate at close
- **Token Auto-Refresh** — UI modal for quick token refresh when expired

## Tech Stack

- **Frontend**: Next.js 16, TypeScript, Tailwind CSS, TradingView Lightweight Charts
- **Backend**: Bun, Socket.io, Prisma (SQLite)
- **AI**: z-ai-web-dev-sdk (GLM 5.2)
- **Data**: Quotex WebSocket (live only, no simulation)

## Deploy to Railway

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/psfaruk/plybit.git
git push -u origin main
```

### 2. Deploy on Railway

1. Go to https://railway.app
2. Click **New Project** → **Deploy from GitHub repo**
3. Select `psfaruk/plybit`
4. Railway will auto-detect the Dockerfile
5. Add environment variables:
   - `QX_TOKEN` — Your Quotex session token
   - `QX_COOKIES` — Cookies from market-qx.trade
   - `QX_IS_DEMO` — `0` for live, `1` for demo
6. Click **Deploy**

### 3. Get Quotex Token

1. Login to https://market-qx.trade/en/trade
2. Open browser DevTools (F12)
3. Go to Console tab
4. Run: `copy(window.settings.token)`
5. Token is now in clipboard — paste it in Railway env vars

## Local Development

```bash
# Install dependencies
bun install
cd mini-services/otc-engine && bun install && cd ../..

# Set up database
bunx prisma generate
bunx prisma db push

# Set environment variables
# Edit .env with your QX_TOKEN and QX_COOKIES

# Start Next.js (port 3000)
bun run dev

# Start mini-service (port 3003 + 3004, in another terminal)
cd mini-services/otc-engine
bun run dev
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `QX_TOKEN` | Quotex session token | Yes |
| `QX_COOKIES` | Cookies from market-qx.trade | Yes |
| `QX_IS_DEMO` | `0` for live account, `1` for demo | No (default: 0) |
| `DATABASE_URL` | SQLite database path | No (default: file:/app/db/custom.db) |
| `PORT` | Next.js port | No (default: 3000) |

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│   Browser (UI)  │◄───►│   Next.js (:3000) │◄───►│   Mini-service   │
│  Chart + Signals│ WS │   API + Socket.io │     │   (:3003 WS)    │
└─────────────────┘     └──────────────────┘     │   (:3004 HTTP)  │
                                                  └────────┬────────┘
                                                           │
                                                  ┌────────▼────────┐
                                                  │  Quotex WebSocket│
                                                  │  (live data)     │
                                                  └─────────────────┘
```

## License

Private — All rights reserved.

## Deploy Status

- Last build fix: 2026-08-01T17:59:58Z
- Commit: 689fd67
- Status: Multi-stage Dockerfile (Node.js build + Bun runtime)
