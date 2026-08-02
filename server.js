// server.js — Custom Next.js server with Socket.io integrated
// Runs BOTH Next.js + Socket.io on the same port (Railway single-port requirement)
// Uses Prisma (NOT bun:sqlite) for database access — works with Node.js

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');
const { PrismaClient } = require('@prisma/client');

const PORT = process.env.PORT || 8080;
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

  const io = new Server(server, {
    path: '/',
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  let lastSignalTimestamp = Math.floor(Date.now() / 1000);

  // ── Socket.io connection handler ──
  io.on('connection', async (socket) => {
    console.log('[socket.io] client connected:', socket.id);

    try {
      const recentSignals = await prisma.signalLog.findMany({
        orderBy: { timestamp: 'desc' },
        take: 20,
      });

      const feedStatus = { mode: 'live', message: 'Quotex LIVE feed' };

      socket.emit('INIT', {
        type: 'INIT',
        pairs: OTC_PAIRS,
        recentSignals,
        stats: null,
        feedStatus,
      });
      socket.emit('FEED_STATUS', feedStatus);
    } catch (e) {
      console.error('[socket.io] INIT error:', e.message);
      socket.emit('INIT', {
        type: 'INIT',
        pairs: OTC_PAIRS,
        recentSignals: [],
        stats: null,
        feedStatus: { mode: 'live', message: 'Connecting...' },
      });
    }

    // ── Event handlers ──
    socket.on('subscribe', () => {});
    socket.on('feed-status', (_d, ack) => ack && ack({ mode: 'live', message: 'Quotex LIVE' }));

    socket.on('stats', async (_d, ack) => {
      if (!ack) return;
      try {
        const total = await prisma.signalLog.count();
        const wins = await prisma.signalLog.count({ where: { result: 'WIN' } });
        const losses = await prisma.signalLog.count({ where: { result: 'LOSS' } });
        const pending = await prisma.signalLog.count({ where: { result: 'PENDING' } });
        ack({ total, wins, losses, pending });
      } catch (e) { ack({ total: 0, wins: 0, losses: 0, pending: 0 }); }
    });

    socket.on('recent-signals', async (data, ack) => {
      if (!ack) return;
      try {
        const limit = Math.min(data?.limit ?? 50, 200);
        const rows = await prisma.signalLog.findMany({
          orderBy: { timestamp: 'desc' },
          take: limit,
        });
        ack(rows);
      } catch (e) { ack([]); }
    });

    socket.on('algorithm-current', (_d, ack) => ack && ack([]));

    socket.on('algorithm-history', async (_d, ack) => {
      if (!ack) return;
      try {
        const rows = await prisma.algorithmDetection.findMany({
          orderBy: { detectedAt: 'desc' },
          take: 50,
        });
        ack(rows);
      } catch (e) { ack([]); }
    });

    socket.on('agent-actions', async (_d, ack) => {
      if (!ack) return;
      try {
        const rows = await prisma.agentAction.findMany({
          orderBy: { timestamp: 'desc' },
          take: 50,
        });
        ack(rows);
      } catch (e) { ack([]); }
    });

    socket.on('history', (_d, ack) => ack && ack([]));
    socket.on('performance', (_d, ack) => ack && ack([]));

    socket.on('disconnect', () => {});
  });

  // ── Poll DB for new signals and broadcast ──
  setInterval(async () => {
    try {
      const newSignals = await prisma.signalLog.findMany({
        where: { timestamp: { gt: lastSignalTimestamp } },
        orderBy: { timestamp: 'asc' },
      });

      for (const sig of newSignals) {
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
  });
});
