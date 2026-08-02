// server.js — Custom Next.js server with Socket.io integrated
// This runs BOTH Next.js + Socket.io on the same port (Railway's PORT)
// Solves the problem of Railway only exposing ONE port.

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');
const { Database } = require('bun:sqlite');
const { randomUUID } = require('crypto');

const PORT = process.env.PORT || 8080;
const DB_PATH = '/app/db/custom.db';

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';

const app = next({ dev, hostname, port: PORT });
const handle = app.getRequestHandler();

const OTC_PAIRS = [
  'USDBRL-OTC', 'USDPKR-OTC', 'USDBDT-OTC', 'USDPHP-OTC', 'USDCHF-OTC',
  'NZDCHF-OTC', 'NZDCAD-OTC', 'USDARS-OTC', 'USDCOP-OTC', 'USDMXN-OTC',
  'GBPCHF-OTC', 'USDZAR-OTC', 'USDDZD-OTC', 'USDINR-OTC', 'AUDCHF-OTC',
];

app.prepare().then(() => {
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

  // ── Socket.io connection handler ──
  io.on('connection', (socket) => {
    console.log('[socket.io] client connected:', socket.id);

    // Send INIT with available pairs
    let recentSignals = [];
    let feedStatus = { mode: 'live', message: 'Quotex LIVE feed' };

    try {
      const db = new Database(DB_PATH, { readonly: true });
      recentSignals = db.query(
        `SELECT * FROM SignalLog ORDER BY timestamp DESC LIMIT 20`
      ).all();
      db.close();
    } catch (e) {
      // DB might not be ready yet
    }

    socket.emit('INIT', {
      type: 'INIT',
      pairs: OTC_PAIRS,
      recentSignals,
      stats: null,
      feedStatus,
    });

    socket.emit('FEED_STATUS', feedStatus);

    // ── Socket event handlers ──
    socket.on('subscribe', (data) => {
      // Accept subscription (all pairs by default)
    });

    socket.on('stats', (_data, ack) => {
      if (typeof ack === 'function') {
        try {
          const db = new Database(DB_PATH, { readonly: true });
          const today = new Date().toISOString().slice(0, 10);
          const stats = db.query(
            `SELECT
               COUNT(*) as total,
               SUM(CASE WHEN result='WIN' THEN 1 ELSE 0 END) as wins,
               SUM(CASE WHEN result='LOSS' THEN 1 ELSE 0 END) as losses,
               SUM(CASE WHEN result='PENDING' THEN 1 ELSE 0 END) as pending
             FROM SignalLog WHERE date(createdAt/1000, 'unixepoch') = date('now')`
          ).get();
          db.close();
          ack(stats || { total: 0, wins: 0, losses: 0, pending: 0 });
        } catch (e) {
          ack({ total: 0, wins: 0, losses: 0, pending: 0 });
        }
      }
    });

    socket.on('feed-status', (_data, ack) => {
      if (typeof ack === 'function') ack(feedStatus);
    });

    socket.on('recent-signals', (data, ack) => {
      if (typeof ack !== 'function') return;
      try {
        const db = new Database(DB_PATH, { readonly: true });
        const limit = Math.min(data?.limit ?? 50, 200);
        const rows = db.query(
          `SELECT * FROM SignalLog ORDER BY timestamp DESC LIMIT ?`
        ).all(limit);
        db.close();
        ack(rows);
      } catch (e) {
        ack([]);
      }
    });

    socket.on('algorithm-current', (_data, ack) => {
      if (typeof ack === 'function') ack([]);
    });

    socket.on('algorithm-history', (_data, ack) => {
      if (typeof ack === 'function') {
        try {
          const db = new Database(DB_PATH, { readonly: true });
          const rows = db.query(
            `SELECT * FROM AlgorithmDetection ORDER BY detectedAt DESC LIMIT 50`
          ).all();
          db.close();
          ack(rows);
        } catch (e) {
          ack([]);
        }
      }
    });

    socket.on('agent-actions', (_data, ack) => {
      if (typeof ack === 'function') {
        try {
          const db = new Database(DB_PATH, { readonly: true });
          const rows = db.query(
            `SELECT * FROM AgentAction ORDER BY timestamp DESC LIMIT 50`
          ).all();
          db.close();
          ack(rows);
        } catch (e) {
          ack([]);
        }
      }
    });

    socket.on('history', (data, ack) => {
      if (typeof ack === 'function') ack([]);
    });

    socket.on('performance', (_data, ack) => {
      if (typeof ack === 'function') ack([]);
    });

    socket.on('disconnect', () => {
      console.log('[socket.io] client disconnected:', socket.id);
    });
  });

  // ── Periodically check DB for new signals and broadcast ──
  let lastSignalTimestamp = 0;
  setInterval(() => {
    try {
      const db = new Database(DB_PATH, { readonly: true });
      const newSignals = db.query(
        `SELECT * FROM SignalLog WHERE timestamp > ? ORDER BY timestamp ASC`
      ).all(lastSignalTimestamp);
      db.close();

      for (const sig of newSignals) {
        // Parse modulesVotes
        let votes = sig.modulesVotes;
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
          votes: votes || [],
        });
        lastSignalTimestamp = sig.timestamp;
      }
    } catch (e) {
      // DB might not be ready
    }
  }, 5000);

  server.listen(PORT, () => {
    console.log(`> Ready on http://${hostname}:${PORT}`);
    console.log(`> Socket.io path: /`);
  });
});
