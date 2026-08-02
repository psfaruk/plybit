// OTC Engine — Socket.io mini-service
// Port: 3003
// Path: "/" (required by Caddy gateway)
//
// Responsibilities:
//   1. Connect to Quotex WebSocket (live) or fall back to simulator
//   2. On every closed candle, run the OTCBlender for that pair
//   3. If a non-NEUTRAL signal fires, persist it and broadcast to all clients
//   4. Stream live ticks to subscribed clients
//   5. Run the SignalValidator loop to mark WIN/LOSS
//   6. Broadcast feed-mode status so the UI can show "Quotex Live" vs "Demo"

import { createServer } from 'http';
import { Server } from 'socket.io';
import { createFeed, type UnifiedFeed, type FeedStatus } from './src/feed-factory';
import { predict as predictV2 } from './src/blender-v2';
import { insertSignal, upsertCandle, getRecentSignals, getTodayStats, getAllPerformance, DB_PATH } from './src/store';
import { startValidator } from './src/validator';
import { OTC_SYMBOLS } from './src/pairs';
import type { Candle, Tick } from './src/types';
import { randomUUID } from 'crypto';
import { detectAlgorithm, getAllCurrentDetections, type DetectionResult } from './src/algorithm-detector';
import { startAgent, stopAgent } from './src/ai-agent';
import { writeEnvKey } from './src/paths';

const PORT = Number(process.env.MINI_SERVICE_PORT) || 3003;
const HTTP_API_PORT = Number(process.env.MINI_SERVICE_HTTP_PORT) || 3004;

const httpServer = createServer();
const io = new Server(httpServer, {
  path: '/socket.io/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ── Separate HTTP API server (port 3004) ────────────────────────────────────
// Socket.io on port 3003 with path '/' intercepts all HTTP requests, so we
// use a separate port for /api/* endpoints (token-refresh, status, etc.).
const apiServer = createServer((req, res) => {
  const url = req.url || '';
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // GET /api/status
  if (req.method === 'GET' && url.startsWith('/api/status')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      mode: feedStatus?.mode ?? 'unknown',
      message: feedStatus?.message ?? '',
      live: feedStatus?.live ?? null,
      timestamp: Math.floor(Date.now() / 1000),
    }));
    return;
  }

  // POST /api/token-refresh
  if (req.method === 'POST' && url.startsWith('/api/token-refresh')) {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const { token } = JSON.parse(body);
        if (!token || typeof token !== 'string' || token.length < 10) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid token' }));
          return;
        }
        // Persist to .env (dynamic path — works in dev AND Railway)
        try {
          writeEnvKey('QX_TOKEN', token);
          console.log('[http] token persisted to .env');
        } catch (e: any) {
          console.error('[http] failed to persist .env:', e.message);
        }
        // Push to feed
        const accepted = (feed as any)?.refreshToken?.(token) ?? false;
        console.log(`[http] token refresh accepted=${accepted}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          accepted,
          message: accepted
            ? 'Token accepted — reconnecting. Live data will resume in ~5s.'
            : 'Token forwarded to feed. Live data will resume in ~10s (auto-detect).',
        }));
      } catch (e: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found', url }));
});

let feed: UnifiedFeed;
let feedStatus: FeedStatus;

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────
const lastSignalPerPair = new Map<string, number>(); // pair → last signal timestamp
const SIGNAL_COOLDOWN_SEC = 240; // max one signal per pair per 4 minutes

// track which clients are subscribed to which pairs
const clientSubs = new Map<string, Set<string>>();

function broadcastFeedStatus(): void {
  io.emit('FEED_STATUS', feedStatus);
}

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────
async function boot() {
  feed = await createFeed();
  feedStatus = feed.getStatus();
  console.log(`[boot] feed mode: ${feedStatus.mode} — ${feedStatus.message}`);

  // Hook up status updates (only LiveAdapter supports this)
  (feed as any).onStatusChange?.((s: FeedStatus) => {
    feedStatus = s;
    broadcastFeedStatus();
  });

  // Subscribe to all OTC pairs
  feed.subscribe(OTC_SYMBOLS);

  // Wire feed events
  feed.onTick((tick: Tick) => {
    for (const [socketId, subs] of clientSubs) {
      if (subs.has(tick.pair)) {
        io.to(socketId).emit('TICK', {
          type: 'TICK',
          pair: tick.pair,
          price: tick.price,
          ts: tick.ts,
        });
      }
    }
  });

  feed.onCandle((pair: string, candle: Candle, closed: boolean) => {
    if (closed) {
      upsertCandle(pair, 60, candle);
      const history = feed.getHistory(pair);
      if (history.length >= 10) {
        // Run algorithm detection BEFORE prediction (so blender can use it)
        runAlgorithmDetection(pair, history);
        // Use the v2 prediction engine
        const prediction = predictV2(history, pair, 60);
        if (prediction.signal !== 'NEUTRAL') {
          maybeEmitSignalV2(prediction);
        }
      }
    }
  });

  // Start signal validator
  startValidator();

  // Start HTTP servers
  httpServer.listen(PORT, () => {
    console.log(`[otc-engine] WebSocket server on port ${PORT}`);
  });
  apiServer.listen(HTTP_API_PORT, () => {
    console.log(`[otc-engine] HTTP API server on port ${HTTP_API_PORT}`);
  });

  // Start the embedded AI agent (24/7 GLM 5.2 analyzer)
  startAgent(io);
}

// ── Algorithm Detection — runs on every candle close, persists transitions ──
function runAlgorithmDetection(pair: string, candles: Candle[]): DetectionResult | null {
  if (candles.length < 10) return null;

  let recentWinRate = -1;
  try {
    const db = new (require('bun:sqlite').Database)(DB_PATH, { readonly: true });
    const recent = db.query(
      `SELECT result FROM SignalLog WHERE pair = ? AND result IN ('WIN', 'LOSS') ORDER BY createdAt DESC LIMIT 10`
    ).all(pair) as { result: string }[];
    db.close();
    if (recent.length >= 3) {
      const wins = recent.filter(r => r.result === 'WIN').length;
      recentWinRate = wins / recent.length;
    }
  } catch {}

  const result = detectAlgorithm(pair, candles, recentWinRate);
  if (!result) return null;

  const isTransition = !!result.transitionNote && result.transitionNote.includes('→');

  if (isTransition) {
    try {
      const Database = require('bun:sqlite').Database;
      const db = new Database(DB_PATH);
      const now = Math.floor(Date.now() / 1000);
      const lastRow = db.query(
        'SELECT algorithm FROM AlgorithmDetection WHERE pair = ? ORDER BY detectedAt DESC LIMIT 1'
      ).get(pair) as { algorithm: string } | null;
      const prevAlgo = lastRow?.algorithm ?? null;

      db.query(
        `INSERT INTO AlgorithmDetection (id, pair, detectedAt, algorithm, prevAlgorithm, confidence, evidence, atr, slope, bodyRatio, rangeRatio, streak, transitionNote)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        randomUUID(), pair, now,
        result.algorithm, prevAlgo, result.confidence,
        JSON.stringify(result.evidence),
        result.evidence.atr, result.evidence.slope,
        result.evidence.bodyRatio, result.evidence.rangeRatio,
        result.evidence.streak,
        result.transitionNote ?? null,
      );
      db.close();

      io.emit('ALGORITHM_CHANGE', {
        type: 'ALGORITHM_CHANGE',
        pair,
        algorithm: result.algorithm,
        prevAlgorithm: prevAlgo,
        confidence: result.confidence,
        evidence: result.evidence,
        transitionNote: result.transitionNote,
        timestamp: now,
      });
      console.log(`[algo] ${pair}: ${prevAlgo ?? 'COLD_START'} → ${result.algorithm} (conf=${(result.confidence * 100).toFixed(0)}%) — ${result.transitionNote}`);
    } catch (e) {
      console.error('[algo] persist error:', e);
    }
  }

  return result;
}

// ── V2 signal emission (using the prediction engine) ─────────────────────────
function maybeEmitSignalV2(pred: import('./src/engine-types').PredictionResult): void {
  if (pred.signal === 'NEUTRAL') return;
  const now = Math.floor(Date.now() / 1000);
  const last = lastSignalPerPair.get(pred.asset) || 0;
  if (now - last < SIGNAL_COOLDOWN_SEC) return;
  lastSignalPerPair.set(pred.asset, now);

  const id = randomUUID();
  const entryPrice = feed.getHistory(pred.asset).slice(-1)[0]?.close || 0;

  // Convert PredictionResult to the format expected by DB + UI
  const votes = Object.entries(pred.modules).map(([name, info]) => ({
    engine: name,
    vote: info.direction,
    confidence: info.confidence / 100,
    weight: 1.0,
    reason: info.reasons[0] || '',
  }));

  insertSignal({
    id,
    timestamp: now,
    pair: pred.asset,
    timeframe: 60,
    signal: pred.signal,
    entryPrice,
    strength: pred.confidence / 100,
    expiry: 300,
    modulesVotes: JSON.stringify(votes),
  });

  io.emit('SIGNAL', {
    type: 'SIGNAL',
    id,
    pair: pred.asset,
    time: now,
    signal: pred.signal,
    strength: pred.confidence / 100,
    entry: entryPrice,
    expiry: 300,
    votes,
  });
  console.log(`[signal-v2] ${pred.asset} ${pred.signal} conf=${pred.confidence} str=${pred.strength} agree=${pred.agree}/${pred.total}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Socket.io handlers
// ─────────────────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[io] connect ${socket.id}`);
  clientSubs.set(socket.id, new Set(OTC_SYMBOLS));

  const stats = getTodayStats();
  socket.emit('INIT', {
    type: 'INIT',
    pairs: OTC_SYMBOLS,
    recentSignals: getRecentSignals(20),
    stats,
    feedStatus,
  });

  // Also push the latest feed status immediately
  socket.emit('FEED_STATUS', feedStatus);

  socket.on('subscribe', (data: { pairs: string[] }) => {
    const subs = new Set<string>((data?.pairs || []).filter(p => OTC_SYMBOLS.includes(p)));
    clientSubs.set(socket.id, subs.size ? subs : new Set(OTC_SYMBOLS));
  });

  socket.on('stats', (_data, ack) => {
    if (typeof ack === 'function') ack(getTodayStats());
  });

  socket.on('performance', (_data, ack) => {
    if (typeof ack === 'function') ack(getAllPerformance());
  });

  socket.on('recent-signals', (data: { limit?: number }, ack) => {
    if (typeof ack === 'function') ack(getRecentSignals(data?.limit ?? 50));
  });

  socket.on('history', (data: { pair: string }, ack) => {
    if (typeof ack === 'function') ack(feed.getHistory(data.pair));
  });

  socket.on('feed-status', (_data, ack) => {
    if (typeof ack === 'function') ack(feedStatus);
  });

  // ── Algorithm Detection endpoints ────────────────────────────────────────
  socket.on('algorithm-current', (_data, ack) => {
    if (typeof ack === 'function') ack(getAllCurrentDetections());
  });

  socket.on('algorithm-history', (data: { pair?: string; limit?: number }, ack) => {
    if (typeof ack !== 'function') return;
    try {
      const Database = require('bun:sqlite').Database;
      const db = new Database(DB_PATH, { readonly: true });
      const limit = Math.min(data?.limit ?? 50, 200);
      const rows = data?.pair
        ? db.query(`SELECT * FROM AlgorithmDetection WHERE pair = ? ORDER BY detectedAt DESC LIMIT ?`).all(data.pair, limit)
        : db.query(`SELECT * FROM AlgorithmDetection ORDER BY detectedAt DESC LIMIT ?`).all(limit);
      db.close();
      ack(rows);
    } catch (e) {
      ack({ error: (e as Error).message });
    }
  });

  // ── Agent Action endpoints ───────────────────────────────────────────────
  socket.on('agent-actions', (data: { limit?: number }, ack) => {
    if (typeof ack !== 'function') return;
    try {
      const Database = require('bun:sqlite').Database;
      const db = new Database(DB_PATH, { readonly: true });
      const limit = Math.min(data?.limit ?? 50, 200);
      const rows = db.query(`SELECT * FROM AgentAction ORDER BY timestamp DESC LIMIT ?`).all(limit);
      db.close();
      ack(rows);
    } catch (e) {
      ack({ error: (e as Error).message });
    }
  });

  socket.on('disconnect', () => {
    clientSubs.delete(socket.id);
    console.log(`[io] disconnect ${socket.id}`);
  });

  socket.on('error', (err) => console.error(`[io] error ${socket.id}`, err));
});

boot().catch(err => {
  console.error('[boot] fatal', err);
  process.exit(1);
});

// ── Crash handlers — log the real error before dying ──────────────────────
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err.message);
  console.error(err.stack?.slice(0, 500));
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason);
});

process.on('SIGTERM', () => {
  console.log('[otc-engine] SIGTERM');
  stopAgent();
  io.close();
  apiServer.close();
  httpServer.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  console.log('[otc-engine] SIGINT');
  stopAgent();
  io.close();
  apiServer.close();
  httpServer.close(() => process.exit(0));
});
