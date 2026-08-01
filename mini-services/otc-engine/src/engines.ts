// OTC Analysis Engines — 6 modules
//
// Each engine implements `analyze(candles)` and returns:
//   { vote: 'CALL'|'PUT'|'NEUTRAL', confidence: 0..1, reason: string }
//
// Engines are pure functions of candle history — they do NOT call out to the
// network. This makes them trivial to backtest.

import type { Candle, EngineVote, SignalDirection } from './types';

export interface EngineResult {
  vote: SignalDirection;
  confidence: number;
  reason: string;
}

export interface Engine {
  name: string;
  weight: number;
  analyze(candles: Candle[]): EngineResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Mean Reversion — Z-score of close vs SMA(20)
// ─────────────────────────────────────────────────────────────────────────────
export class MeanReversionEngine implements Engine {
  name = 'MeanReversion';
  weight = 0.20;
  private lookback = 20;

  analyze(candles: Candle[]): EngineResult {
    if (candles.length < this.lookback) return neutral('Not enough data');
    const closes = candles.slice(-this.lookback).map(c => c.close);
    const sma = avg(closes);
    const sd = std(closes);
    if (sd === 0) return neutral('Zero variance');
    const z = (closes[closes.length - 1] - sma) / sd;

    if (z > 2.0) {
      return { vote: 'PUT', confidence: clamp(Math.abs(z) / 3, 0.5, 0.95), reason: `Overbought z=${z.toFixed(2)}` };
    }
    if (z < -2.0) {
      return { vote: 'CALL', confidence: clamp(Math.abs(z) / 3, 0.5, 0.95), reason: `Oversold z=${z.toFixed(2)}` };
    }
    return neutral(`Z in range (${z.toFixed(2)})`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Bollinger Bands + RSI
// ─────────────────────────────────────────────────────────────────────────────
export class BollingerRsiEngine implements Engine {
  name = 'BollingerRSI';
  weight = 0.20;

  analyze(candles: Candle[]): EngineResult {
    if (candles.length < 21) return neutral('Not enough data');
    const closes = candles.slice(-20).map(c => c.close);
    const sma = avg(closes);
    const sd = std(closes);
    const upper = sma + 2 * sd;
    const lower = sma - 2 * sd;
    const current = closes[closes.length - 1];
    const rsi = this.rsi(candles, 14);

    if (current <= lower && rsi < 30) {
      return { vote: 'CALL', confidence: 0.85, reason: `BB lower + RSI ${rsi.toFixed(0)}` };
    }
    if (current >= upper && rsi > 70) {
      return { vote: 'PUT', confidence: 0.85, reason: `BB upper + RSI ${rsi.toFixed(0)}` };
    }
    return neutral(`No confluence (RSI ${rsi.toFixed(0)})`);
  }

  private rsi(candles: Candle[], period: number): number {
    if (candles.length < period + 1) return 50;
    const closes = candles.slice(-(period + 1)).map(c => c.close);
    let gains = 0, losses = 0;
    for (let i = 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gains += diff; else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Support/Resistance — cluster-based levels
// ─────────────────────────────────────────────────────────────────────────────
export class SupportResistanceEngine implements Engine {
  name = 'SupportResistance';
  weight = 0.20;
  private lookback = 50;

  analyze(candles: Candle[]): EngineResult {
    if (candles.length < this.lookback) return neutral('Not enough data');
    const window = candles.slice(-this.lookback);
    const lows = window.map(c => c.low).sort((a, b) => a - b);
    const highs = window.map(c => c.high).sort((a, b) => a - b);
    const support = cluster(lows);
    const resistance = cluster(highs);
    const last = candles[candles.length - 1];
    const current = last.close;

    const nearSupport = support !== null && Math.abs(current - support) / current < 0.0015;
    const nearResistance = resistance !== null && Math.abs(current - resistance) / current < 0.0015;

    if (nearSupport && last.close > last.open) {
      return { vote: 'CALL', confidence: 0.80, reason: `Support bounce @ ${support!.toFixed(5)}` };
    }
    if (nearResistance && last.close < last.open) {
      return { vote: 'PUT', confidence: 0.80, reason: `Resistance reject @ ${resistance!.toFixed(5)}` };
    }
    return neutral('No level touch');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Volume Anomaly
// ─────────────────────────────────────────────────────────────────────────────
export class VolumeAnomalyEngine implements Engine {
  name = 'VolumeAnomaly';
  weight = 0.15;
  private lookback = 20;
  private spikeFactor = 2.2;

  analyze(candles: Candle[]): EngineResult {
    if (candles.length < this.lookback) return neutral('Not enough data');
    const window = candles.slice(-this.lookback);
    const vols = window.map(c => c.volume);
    const current = vols[vols.length - 1];
    const priorAvg = avg(vols.slice(0, -1));
    if (priorAvg === 0) return neutral('No avg volume');

    if (current > priorAvg * this.spikeFactor) {
      const last = candles[candles.length - 1];
      const bullish = last.close > last.open;
      const conf = clamp(0.55 + (current / priorAvg - this.spikeFactor) * 0.15, 0.55, 0.92);
      return {
        vote: bullish ? 'CALL' : 'PUT',
        confidence: conf,
        reason: `Vol spike ${(current / priorAvg).toFixed(1)}x ${bullish ? 'bullish' : 'bearish'}`,
      };
    }
    return neutral('Normal volume');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Session Pattern — time-of-day bias
// ─────────────────────────────────────────────────────────────────────────────
export class SessionPatternEngine implements Engine {
  name = 'SessionPattern';
  weight = 0.10;

  // Simulated hourly win-rate table — in production this would be loaded from
  // historical performance data per pair. For demo we use a synthetic profile
  // that favors certain hours.
  private hourlyProfile: Record<number, { dir: SignalDirection; rate: number }> = {
    6:  { dir: 'CALL', rate: 0.68 },
    7:  { dir: 'CALL', rate: 0.66 },
    8:  { dir: 'PUT',  rate: 0.64 },
    12: { dir: 'CALL', rate: 0.67 },
    13: { dir: 'PUT',  rate: 0.65 },
    14: { dir: 'PUT',  rate: 0.69 },
    18: { dir: 'CALL', rate: 0.66 },
    19: { dir: 'PUT',  rate: 0.67 },
    20: { dir: 'CALL', rate: 0.65 },
  };

  analyze(candles: Candle[]): EngineResult {
    const last = candles[candles.length - 1];
    const hour = new Date(last.time * 1000).getUTCHours();
    const p = this.hourlyProfile[hour];
    if (p && p.rate > 0.65) {
      return {
        vote: p.dir,
        confidence: p.rate,
        reason: `Session pattern ${hour}:00 UTC (${(p.rate * 100).toFixed(0)}%)`,
      };
    }
    return neutral(`No pattern @ ${hour}:00`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Candlestick Pattern — engulfing / pin bar / doji
// ─────────────────────────────────────────────────────────────────────────────
export class CandlestickEngine implements Engine {
  name = 'CandlestickPattern';
  weight = 0.15;

  analyze(candles: Candle[]): EngineResult {
    if (candles.length < 2) return neutral('Not enough data');
    const c1 = candles[candles.length - 2];
    const c2 = candles[candles.length - 1];

    // Bullish Engulfing
    if (c1.close < c1.open && c2.close > c2.open &&
        c2.open <= c1.close && c2.close >= c1.open) {
      return { vote: 'CALL', confidence: 0.82, reason: 'Bullish Engulfing' };
    }
    // Bearish Engulfing
    if (c1.close > c1.open && c2.close < c2.open &&
        c2.open >= c1.close && c2.close <= c1.open) {
      return { vote: 'PUT', confidence: 0.82, reason: 'Bearish Engulfing' };
    }

    // Hammer / Pin bar (bullish)
    const body2 = Math.abs(c2.close - c2.open);
    const lowerShadow2 = Math.min(c2.open, c2.close) - c2.low;
    const upperShadow2 = c2.high - Math.max(c2.open, c2.close);
    if (lowerShadow2 > body2 * 2 && upperShadow2 < body2 * 0.6 && body2 > 0) {
      return { vote: 'CALL', confidence: 0.75, reason: 'Hammer / Pin bar' };
    }
    // Shooting star (bearish)
    if (upperShadow2 > body2 * 2 && lowerShadow2 < body2 * 0.6 && body2 > 0) {
      return { vote: 'PUT', confidence: 0.75, reason: 'Shooting Star' };
    }

    // Doji (neutral, but flag low confidence CALL/PUT based on prior trend)
    if (body2 < (c2.high - c2.low) * 0.1) {
      const priorTrend = c1.close - c1.open;
      if (priorTrend > 0) return { vote: 'PUT', confidence: 0.55, reason: 'Doji after uptrend' };
      if (priorTrend < 0) return { vote: 'CALL', confidence: 0.55, reason: 'Doji after downtrend' };
    }
    return neutral('No pattern');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────
function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = avg(xs);
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
  return Math.sqrt(v);
}
function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
function neutral(reason: string): EngineResult {
  return { vote: 'NEUTRAL', confidence: 0, reason };
}

// Find a price cluster: the value that appears in the densest bucket.
function cluster(prices: number[], bucketPct = 0.0015): number | null {
  if (prices.length === 0) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  const range = sorted[sorted.length - 1] - sorted[0];
  if (range === 0) return sorted[0];
  const bucket = Math.max(range * bucketPct, 1e-9);

  let bestStart = sorted[0], bestCount = 1;
  let i = 0;
  for (let j = 1; j < sorted.length; j++) {
    if (sorted[j] - sorted[i] > bucket) {
      while (sorted[j] - sorted[i] > bucket) i++;
    }
    const count = j - i + 1;
    if (count > bestCount) {
      bestCount = count;
      bestStart = sorted[i];
    }
  }
  // return midpoint of densest bucket
  return bestStart + bucket / 2;
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine registry
// ─────────────────────────────────────────────────────────────────────────────
export function buildEngines(): Engine[] {
  return [
    new MeanReversionEngine(),
    new BollingerRsiEngine(),
    new SupportResistanceEngine(),
    new VolumeAnomalyEngine(),
    new SessionPatternEngine(),
    new CandlestickEngine(),
  ];
}

export function toVote(e: Engine, r: EngineResult): EngineVote {
  return {
    engine: e.name,
    vote: r.vote,
    confidence: r.confidence,
    weight: e.weight,
    reason: r.reason,
  };
}
