// SQLite store for mini-service (uses bun:sqlite, no Prisma needed here)
// Same schema as the Next.js Prisma models — both write to the same DB file.

import { Database } from 'bun:sqlite';
import type { Candle, SignalResult } from './types';
import { getDbPath } from './paths';

const DB_PATH = getDbPath();

let _db: Database | null = null;
function db(): Database {
  if (!_db) {
    _db = new Database(DB_PATH, { create: true });
    _db.exec('PRAGMA journal_mode = WAL;');
    _db.exec('PRAGMA synchronous = NORMAL;');
    _db.exec(`
      CREATE TABLE IF NOT EXISTS SignalLog (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        pair TEXT NOT NULL,
        timeframe INTEGER DEFAULT 60,
        signal TEXT NOT NULL,
        entryPrice REAL,
        strength REAL DEFAULT 0,
        expiry INTEGER DEFAULT 300,
        result TEXT DEFAULT 'PENDING',
        resultPrice REAL,
        modulesVotes TEXT,
        createdAt TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_signal_pair_ts ON SignalLog(pair, timestamp);
      CREATE INDEX IF NOT EXISTS idx_signal_result ON SignalLog(result);

      CREATE TABLE IF NOT EXISTS CandleData (
        id TEXT PRIMARY KEY,
        pair TEXT NOT NULL,
        timeframe INTEGER NOT NULL,
        openTime INTEGER NOT NULL,
        open REAL, high REAL, low REAL, close REAL, volume REAL,
        createdAt TEXT DEFAULT (datetime('now')),
        UNIQUE(pair, timeframe, openTime)
      );
      CREATE INDEX IF NOT EXISTS idx_candle_pair_time ON CandleData(pair, openTime);

      CREATE TABLE IF NOT EXISTS Performance (
        id TEXT PRIMARY KEY,
        pair TEXT NOT NULL,
        date TEXT NOT NULL,
        totalSignals INTEGER DEFAULT 0,
        winCount INTEGER DEFAULT 0,
        lossCount INTEGER DEFAULT 0,
        winRate REAL DEFAULT 0,
        createdAt TEXT DEFAULT (datetime('now')),
        UNIQUE(pair, date)
      );

      CREATE TABLE IF NOT EXISTS AlgorithmDetection (
        id TEXT PRIMARY KEY,
        pair TEXT NOT NULL,
        detectedAt INTEGER NOT NULL,
        algorithm TEXT NOT NULL,
        prevAlgorithm TEXT,
        confidence REAL DEFAULT 0,
        evidence TEXT,
        atr REAL,
        slope REAL,
        bodyRatio REAL,
        rangeRatio REAL,
        streak INTEGER,
        transitionNote TEXT,
        createdAt TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_algo_pair_ts ON AlgorithmDetection(pair, detectedAt);
      CREATE INDEX IF NOT EXISTS idx_algo_algorithm ON AlgorithmDetection(algorithm);

      CREATE TABLE IF NOT EXISTS AgentAction (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        actionType TEXT NOT NULL,
        scope TEXT NOT NULL,
        summary TEXT,
        details TEXT,
        severity TEXT DEFAULT 'info',
        autoApplied INTEGER DEFAULT 0,
        createdAt TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_agent_ts ON AgentAction(timestamp);
      CREATE INDEX IF NOT EXISTS idx_agent_scope ON AgentAction(scope);
      CREATE INDEX IF NOT EXISTS idx_agent_actionType ON AgentAction(actionType);
    `);
    console.log(`[db] Opened ${DB_PATH}`);
  }
  return _db!;
}

export { DB_PATH };

export function insertSignal(s: {
  id: string;
  timestamp: number;
  pair: string;
  timeframe: number;
  signal: string;
  entryPrice: number;
  strength: number;
  expiry: number;
  modulesVotes: string;
}): void {
  db().query(`
    INSERT INTO SignalLog (id, timestamp, pair, timeframe, signal, entryPrice, strength, expiry, modulesVotes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(s.id, s.timestamp, s.pair, s.timeframe, s.signal, s.entryPrice, s.strength, s.expiry, s.modulesVotes);
}

export function updateSignalResult(id: string, result: SignalResult, resultPrice: number): void {
  db().query(`UPDATE SignalLog SET result = ?, resultPrice = ? WHERE id = ?`)
    .run(result, resultPrice, id);

  // Update Performance table
  const row = db().query(`SELECT pair, timestamp, result FROM SignalLog WHERE id = ?`).get(id) as any;
  if (!row) return;
  const date = new Date(row.timestamp * 1000).toISOString().slice(0, 10);
  const pair = row.pair;
  const perfId = `${pair}-${date}`;
  const perfRow = db().query(`SELECT * FROM Performance WHERE id = ?`).get(perfId) as any;
  if (!perfRow) {
    const wins = result === 'WIN' ? 1 : 0;
    const losses = result === 'LOSS' ? 1 : 0;
    const total = wins + losses;
    db().query(`
      INSERT INTO Performance (id, pair, date, totalSignals, winCount, lossCount, winRate)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(perfId, pair, date, total, wins, losses, total ? wins / total : 0);
  } else {
    const wins = perfRow.winCount + (result === 'WIN' ? 1 : 0);
    const losses = perfRow.lossCount + (result === 'LOSS' ? 1 : 0);
    const total = wins + losses;
    db().query(`
      UPDATE Performance SET totalSignals = ?, winCount = ?, lossCount = ?, winRate = ? WHERE id = ?
    `).run(total, wins, losses, total ? wins / total : 0, perfId);
  }
}

export function upsertCandle(pair: string, tf: number, c: Candle): void {
  const id = `${pair}-${tf}-${c.time}`;
  db().query(`
    INSERT OR REPLACE INTO CandleData (id, pair, timeframe, openTime, open, high, low, close, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, pair, tf, c.time, c.open, c.high, c.low, c.close, c.volume);
}

export interface PendingSignal {
  id: string;
  pair: string;
  timestamp: number;
  signal: string;
  entryPrice: number;
  expiry: number;
}

export function getPendingSignals(now: number): PendingSignal[] {
  return db().query(`
    SELECT id, pair, timestamp, signal, entryPrice, expiry
    FROM SignalLog
    WHERE result = 'PENDING' AND (timestamp + expiry) <= ?
  `).all(now) as PendingSignal[];
}

export function getCandleAtOrBefore(pair: string, ts: number): Candle | null {
  const row = db().query(`
    SELECT openTime as time, open, high, low, close, volume
    FROM CandleData
    WHERE pair = ? AND openTime <= ?
    ORDER BY openTime DESC LIMIT 1
  `).get(pair, ts) as any;
  return row ? (row as Candle) : null;
}

export interface SignalRow {
  id: string;
  timestamp: number;
  pair: string;
  signal: string;
  entryPrice: number;
  strength: number;
  expiry: number;
  result: string;
  resultPrice: number | null;
  modulesVotes: string;
}

export function getRecentSignals(limit = 50): SignalRow[] {
  return db().query(`
    SELECT id, timestamp, pair, signal, entryPrice, strength, expiry, result, resultPrice, modulesVotes
    FROM SignalLog
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(limit) as SignalRow[];
}

export function getTodayStats(): { total: number; wins: number; losses: number; pending: number; winRate: number } {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const startTs = Math.floor(startOfDay.getTime() / 1000);
  const row = db().query(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN result='WIN' THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN result='LOSS' THEN 1 ELSE 0 END) as losses,
      SUM(CASE WHEN result='PENDING' THEN 1 ELSE 0 END) as pending
    FROM SignalLog WHERE timestamp >= ?
  `).get(startTs) as any;
  const total = row?.total || 0;
  const wins = row?.wins || 0;
  const losses = row?.losses || 0;
  const pending = row?.pending || 0;
  const decided = wins + losses;
  return {
    total,
    wins,
    losses,
    pending,
    winRate: decided ? wins / decided : 0,
  };
}

export function getAllPerformance(): { pair: string; totalSignals: number; winCount: number; lossCount: number; winRate: number }[] {
  return db().query(`
    SELECT pair, SUM(totalSignals) as totalSignals, SUM(winCount) as winCount, SUM(lossCount) as lossCount,
      CASE WHEN SUM(totalSignals) > 0 THEN 1.0 * SUM(winCount) / SUM(totalSignals) ELSE 0 END as winRate
    FROM Performance GROUP BY pair ORDER BY winRate DESC
  `).all() as any[];
}
