// server.js — Custom Next.js server with Socket.io integrated
// Runs BOTH Next.js + Socket.io on the same port (Railway single-port requirement)
// Uses Prisma (NOT bun:sqlite) for database access — works with Node.js
//
// CRITICAL FIX (2026-08-02): This server now acts as a BRIDGE to the
// mini-service on port 3003. Previously it was standalone and never forwarded
// TICK / SIGNAL / FEED_STATUS / ALGORITHM_CHANGE / AGENT_ACTION events from
// the mini-service to browser clients — so the live chart never updated even
// after a valid Quotex token was provided.

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');
const { io: client } = require('socket.io-client');
const { PrismaClient } = require('@prisma/client');

const PORT = process.env.PORT || 8080;
const MINI_SERVICE_URL = process.env.MINI_SERVICE_URL || 'http://localhost:3003';
const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';

const app = next({ dev, hostname, port: PORT });
const handle = app.getRequestHandler();

const OTC_PAIRS = [
  'USDBRL-OTC', 'USDPKR-OTC', 'USDBDT-OTC', 'USDPHP-OTC', 'USDCHF-OTC',
  'NZDCHF-OTC', 'NZDCAD-OTC', 'USDARS-OTC', 'USDCOP-OTC', 'USDMXN-OTC',
  'GBPCHF-OTC', 'USDZAR-OTC', 'USDDZD-OTC', 'USDINR-OTC', 'AUDCHF-OTC',
];

app.prepare().then(async () => {
  const prisma = new PrismaClient();

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  // ── Browser-facing socket.io ──────────────────────────────────────────────
  // CRITICAL: use the default path '/socket.io/' (NOT '/'). A custom path of '/'
  // causes socket.io to intercept ALL HTTP requests including /api/* routes,
  // breaking Next.js API routes with "Transport unknown" errors.
  const io = new Server(server, {
    path: '/socket.io/',
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // ── Mini-service client (bridge) ──────────────────────────────────────────
  // Connects to the OTC engine on port 3003 and re-broadcasts every event
  // to all connected browser clients. Reconnects automatically if the engine
  // restarts.
  let upstream = null;
  let upstreamConnected = false;
  let lastFeedStatus = { mode: 'live', message: 'Connecting to engine…' };
  let cachedAlgorithms = [];
  let cachedAgentActions = [];
  let cachedRecentSignals = [];

  function connectUpstream() {
    if (upstream) {
      try { upstream.disconnect(); } catch {}
      upstream = null;
    }

    upstream = client(MINI_SERVICE_URL, {
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1500,
      reconnectionDelayMax: 10000,
      timeout: 10000,
    });

    upstream.on('connect', () => {
      console.log('[bridge] ✓ connected to mini-service on', MINI_SERVICE_URL);
      upstreamConnected = true;
    });

    upstream.on('disconnect', (reason) => {
      console.warn('[bridge] disconnected from mini-service:', reason);
      upstreamConnected = false;
      // Mark feed as disconnected so UI shows the token-refresh banner
      lastFeedStatus = {
        mode: 'disconnected',
        message: 'Engine disconnected — reconnecting…',
      };
      io.emit('FEED_STATUS', lastFeedStatus);
    });

    upstream.on('connect_error', (err) => {
      // Silent — reconnection will retry. Only log first failure per attempt.
      if (upstreamConnected) {
        console.warn('[bridge] mini-service connect_error:', err.message);
      }
    });

    // ── Forward all upstream events to browser clients ──
    upstream.on('INIT', (data) => {
      // Cache so newly-connected browsers can get the same data
      if (data?.feedStatus) lastFeedStatus = data.feedStatus;
      if (Array.isArray(data?.recentSignals)) cachedRecentSignals = data.recentSignals;
      // Don't re-broadcast INIT — we send our own on browser connection below.
    });

    upstream.on('FEED_STATUS', (s) => {
      lastFeedStatus = s;
      io.emit('FEED_STATUS', s);
    });

    upstream.on('TICK', (t) => {
      io.emit('TICK', t);
    });

    upstream.on('SIGNAL', (p) => {
      io.emit('SIGNAL', p);
    });

    upstream.on('ALGORITHM_CHANGE', (d) => {
      // Update cached list so new browsers see the current algorithm set
      const idx = cachedAlgorithms.findIndex(a => a.pair === d.pair);
      if (idx >= 0) cachedAlgorithms[idx] = d;
      else cachedAlgorithms.unshift(d);
      io.emit('ALGORITHM_CHANGE', d);
    });

    upstream.on('AGENT_ACTION', (a) => {
      cachedAgentActions = [a, ...cachedAgentActions].slice(0, 50);
      io.emit('AGENT_ACTION', a);
    });
  }

  connectUpstream();

  // ── Browser connection handler ────────────────────────────────────────────
  io.on('connection', async (socket) => {
    console.log('[socket.io] browser connected:', socket.id);

    // Send INIT using cached upstream state + DB fallbacks
    try {
      let recentSignals = cachedRecentSignals;
      if (recentSignals.length === 0) {
        recentSignals = await prisma.signalLog.findMany({
          orderBy: { timestamp: 'desc' },
          take: 20,
        });
        cachedRecentSignals = recentSignals;
      }

      let stats = null;
      try {
        const total = await prisma.signalLog.count();
        const wins = await prisma.signalLog.count({ where: { result: 'WIN' } });
        const losses = await prisma.signalLog.count({ where: { result: 'LOSS' } });
        const pending = await prisma.signalLog.count({ where: { result: 'PENDING' } });
        stats = { total, wins, losses, pending, winRate: (wins + losses) ? wins / (wins + losses) : 0 };
      } catch {}

      socket.emit('INIT', {
        type: 'INIT',
        pairs: OTC_PAIRS,
        recentSignals,
        stats,
        feedStatus: lastFeedStatus,
      });
      socket.emit('FEED_STATUS', lastFeedStatus);

      // Push cached algorithm + agent data to the new client
      if (cachedAlgorithms.length > 0) {
        for (const a of cachedAlgorithms) socket.emit('ALGORITHM_CHANGE', a);
      }
      if (cachedAgentActions.length > 0) {
        for (const a of cachedAgentActions.slice(0, 20)) socket.emit('AGENT_ACTION', a);
      }
    } catch (e) {
      console.error('[socket.io] INIT error:', e.message);
      socket.emit('INIT', {
        type: 'INIT',
        pairs: OTC_PAIRS,
        recentSignals: [],
        stats: null,
        feedStatus: lastFeedStatus,
      });
    }

    // ── RPC handlers — forward to upstream when possible, fall back to DB ──
    socket.on('subscribe', (data) => {
      // Forward to mini-service so it knows which pairs to stream ticks for
      try { upstream?.emit('subscribe', data); } catch {}
    });

    socket.on('feed-status', (_d, ack) => {
      if (typeof ack === 'function') ack(lastFeedStatus);
    });

    socket.on('stats', async (_d, ack) => {
      if (typeof ack !== 'function') return;
      try {
        const total = await prisma.signalLog.count();
        const wins = await prisma.signalLog.count({ where: { result: 'WIN' } });
        const losses = await prisma.signalLog.count({ where: { result: 'LOSS' } });
        const pending = await prisma.signalLog.count({ where: { result: 'PENDING' } });
        ack({ total, wins, losses, pending, winRate: (wins + losses) ? wins / (wins + losses) : 0 });
      } catch { ack({ total: 0, wins: 0, losses: 0, pending: 0, winRate: 0 }); }
    });

    socket.on('recent-signals', async (data, ack) => {
      if (typeof ack !== 'function') return;
      try {
        const limit = Math.min(data?.limit ?? 50, 200);
        const rows = await prisma.signalLog.findMany({
          orderBy: { timestamp: 'desc' },
          take: limit,
        });
        ack(rows);
      } catch { ack([]); }
    });

    socket.on('algorithm-current', (_d, ack) => {
      if (typeof ack !== 'function') return;
      // First try upstream (live), fall back to cached
      if (upstreamConnected && upstream) {
        try {
          upstream.emit('algorithm-current', {}, (data) => {
            if (Array.isArray(data)) {
              cachedAlgorithms = data;
              ack(data);
            } else {
              ack(cachedAlgorithms);
            }
          });
          return;
        } catch {}
      }
      ack(cachedAlgorithms);
    });

    socket.on('algorithm-history', async (_d, ack) => {
      if (typeof ack !== 'function') return;
      try {
        const rows = await prisma.algorithmDetection.findMany({
          orderBy: { detectedAt: 'desc' },
          take: 50,
        });
        ack(rows);
      } catch { ack([]); }
    });

    socket.on('agent-actions', async (data, ack) => {
      if (typeof ack !== 'function') return;
      try {
        const limit = Math.min(data?.limit ?? 50, 200);
        const rows = await prisma.agentAction.findMany({
          orderBy: { timestamp: 'desc' },
          take: limit,
        });
        cachedAgentActions = rows;
        ack(rows);
      } catch { ack([]); }
    });

    socket.on('history', async (data, ack) => {
      if (typeof ack !== 'function') return;
      try {
        // Ask upstream for live in-memory history (most accurate)
        if (upstreamConnected && upstream && data?.pair) {
          upstream.emit('history', { pair: data.pair }, (candles) => {
            ack(Array.isArray(candles) ? candles : []);
          });
          return;
        }
      } catch {}
      ack([]);
    });

    socket.on('performance', async (_d, ack) => {
      if (typeof ack !== 'function') return;
      try {
        const all = await prisma.performance.findMany();
        const byPair = new Map();
        for (const p of all) {
          const cur = byPair.get(p.pair) || { pair: p.pair, total: 0, wins: 0, losses: 0 };
          cur.total += p.totalSignals;
          cur.wins += p.winCount;
          cur.losses += p.lossCount;
          byPair.set(p.pair, cur);
        }
        const out = Array.from(byPair.values())
          .map(r => ({
            pair: r.pair,
            totalSignals: r.total,
            winCount: r.wins,
            lossCount: r.losses,
            winRate: r.total ? r.wins / r.total : 0,
          }))
          .sort((a, b) => b.winRate - a.winRate);
        ack(out);
      } catch { ack([]); }
    });

    socket.on('disconnect', () => {});
  });

  // ── DB poll fallback: if upstream bridge is broken, still surface new signals ──
  let lastSignalTimestamp = Math.floor(Date.now() / 1000);
  setInterval(async () => {
    try {
      const newSignals = await prisma.signalLog.findMany({
        where: { timestamp: { gt: lastSignalTimestamp } },
        orderBy: { timestamp: 'asc' },
      });

      for (const sig of newSignals) {
        // Only broadcast if upstream didn't already (avoid duplicates by checking
        // whether the signal was emitted less than 5s ago — heuristic via timestamp)
        const ageSec = Math.floor(Date.now() / 1000) - sig.timestamp;
        if (ageSec > 10) {
          // Old signal — probably already broadcast by upstream, just update pointer
          lastSignalTimestamp = sig.timestamp;
          continue;
        }

        let votes = [];
        try { votes = JSON.parse(sig.modulesVotes); } catch {}

        io.emit('SIGNAL', {
          type: 'SIGNAL',
          id: sig.id,
          pair: sig.pair,
          time: sig.timestamp,
          signal: sig.signal,
          strength: sig.strength,
          entry: sig.entryPrice,
          expiry: sig.expiry,
          votes,
        });
        lastSignalTimestamp = sig.timestamp;
      }
    } catch (e) {}
  }, 5000);

  server.listen(PORT, () => {
    console.log(`> Ready on http://${hostname}:${PORT}`);
    console.log(`> Bridging to mini-service at ${MINI_SERVICE_URL}`);
  });
});
