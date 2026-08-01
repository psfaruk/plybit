// core/analysis.ts — Ported from Binary-signals-app-main/core/analysis.py
// All candle analysis functions: ATR, EMA, regime classification, key levels,
// statistical edge, candle patterns.

import type { Candle } from './types';

// ── Helpers ──────────────────────────────────────────────────────────────────
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}

function isJpyPair(candles: Candle[]): boolean {
  if (candles.length === 0) return false;
  const sorted = candles.map(c => c.close).sort((a, b) => a - b);
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];
  return median > 10.0;
}

// ── ATR (True Range) ─────────────────────────────────────────────────────────
export function computeATR(candles: Candle[], n: number = 20): number {
  if (!candles || candles.length < 2) return 0.0001;
  const window = candles.slice(-Math.min(n, candles.length));
  let sum = 0;
  for (let i = 0; i < window.length; i++) {
    if (i === 0 || i >= candles.length - window.length) {
      // First in window or first overall — use high-low only
      sum += window[i].high - window[i].low;
    } else {
      const prevClose = candles[candles.length - window.length + i - 1].close;
      const tr = Math.max(
        window[i].high - window[i].low,
        Math.abs(window[i].high - prevClose),
        Math.abs(window[i].low - prevClose),
      );
      sum += tr;
    }
  }
  return sum / window.length;
}

// ── EMA ──────────────────────────────────────────────────────────────────────
export function computeEMA(values: number[], period: number): number {
  if (!values || values.length === 0) return 0;
  const k = 2 / (period + 1);
  const seedLen = Math.min(period, values.length);
  let ema = values.slice(0, seedLen).reduce((a, b) => a + b, 0) / seedLen;
  for (let i = seedLen; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

// ── RSI (Wilder's) ───────────────────────────────────────────────────────────
export function computeRSI(candles: Candle[], period: number = 14): number {
  if (candles.length < period + 1) return 50;
  const closes = candles.map(c => c.close);
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ── MACD ─────────────────────────────────────────────────────────────────────
export function computeMACD(candles: Candle[]) {
  const closes = candles.map(c => c.close);
  const ema12 = computeEMAArray(closes, 12);
  const ema26 = computeEMAArray(closes, 26);
  const macdLine = closes.map((_, i) => ema12[i] - ema26[i]);
  const signalLine = computeEMAArray(macdLine, 9);
  const histogram = macdLine.map((m, i) => m - signalLine[i]);
  return { macdLine, signalLine, histogram };
}

function computeEMAArray(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  const seedLen = Math.min(period, values.length);
  let ema = values.slice(0, seedLen).reduce((a, b) => a + b, 0) / seedLen;
  for (let i = 0; i < values.length; i++) {
    if (i < seedLen) {
      // During seed period, compute running average
      ema = values.slice(0, i + 1).reduce((a, b) => a + b, 0) / (i + 1);
    } else {
      ema = values[i] * k + ema * (1 - k);
    }
    result.push(ema);
  }
  return result;
}

// ── Stochastic ───────────────────────────────────────────────────────────────
export function computeStochastic(candles: Candle[], kPeriod: number = 14, dPeriod: number = 3) {
  if (candles.length < kPeriod + dPeriod) return { k: 50, d: 50, kPrev: 50, dPrev: 50 };
  const window = candles.slice(-(kPeriod + dPeriod + 1));
  const kValues: number[] = [];
  for (let i = kPeriod - 1; i < window.length; i++) {
    const slice = window.slice(i - kPeriod + 1, i + 1);
    const highestHigh = Math.max(...slice.map(c => c.high));
    const lowestLow = Math.min(...slice.map(c => c.low));
    const k = highestHigh === lowestLow ? 50 : ((window[i].close - lowestLow) / (highestHigh - lowestLow)) * 100;
    kValues.push(k);
  }
  const k = kValues[kValues.length - 1] || 50;
  const kPrev = kValues[kValues.length - 2] || 50;
  const dValues = kValues.slice(-dPeriod);
  const d = dValues.reduce((a, b) => a + b, 0) / dValues.length;
  const dPrevValues = kValues.slice(-dPeriod - 1, -1);
  const dPrev = dPrevValues.length > 0 ? dPrevValues.reduce((a, b) => a + b, 0) / dPrevValues.length : d;
  return { k, d, kPrev, dPrev };
}

// ── Bollinger Bands ──────────────────────────────────────────────────────────
export function computeBollingerBands(candles: Candle[], period: number = 20, numStd: number = 2) {
  if (candles.length < period) {
    const close = candles[candles.length - 1]?.close || 0;
    return { upper: close, middle: close, lower: close, width: 0 };
  }
  const closes = candles.slice(-period).map(c => c.close);
  const sma = closes.reduce((a, b) => a + b, 0) / period;
  const variance = closes.reduce((sum, c) => sum + (c - sma) ** 2, 0) / (period - 1);
  const std = Math.sqrt(variance);
  const upper = sma + numStd * std;
  const lower = sma - numStd * std;
  return { upper, middle: sma, lower, width: upper - lower };
}

// ── Regime Classification ────────────────────────────────────────────────────
export interface MarketRegime {
  regime: string;
  trend_strength: number;
  volatility_pct: number;
  ema9: number;
  ema21: number;
  is_trending: boolean;
  is_ranging: boolean;
  is_volatile: boolean;
}

export function classifyMarketRegime(candles: Candle[], lookback: number = 30): MarketRegime {
  if (candles.length < 10) {
    return {
      regime: 'RANGE', trend_strength: 0, volatility_pct: 1.0,
      ema9: 0, ema21: 0, is_trending: false, is_ranging: true, is_volatile: false,
    };
  }
  const recent = candles.slice(-Math.min(lookback, candles.length));
  const closes = recent.map(c => c.close);
  const ema9 = computeEMA(closes, 9);
  const ema21 = computeEMA(closes, 21);
  const emaDiff = ema21 !== 0 ? (ema9 - ema21) / ema21 : 0;
  const atrVal = computeATR(candles, 20);
  const priceMid = (ema9 + ema21) / 2;
  const atrNorm = Math.max(atrVal * 4.0, Math.abs(priceMid) * 0.0005);
  const trendStrength = Math.min(Math.abs(emaDiff * priceMid) / atrNorm, 1.0);

  // Swing structure (Dow theory)
  let hhHl = 0, lhLl = 0;
  let prevSwingHigh = 0, prevSwingLow = Infinity;
  for (let i = 2; i < recent.length - 2; i++) {
    const isSwingHigh = recent[i].high >= recent[i - 1].high && recent[i].high > recent[i - 2].high &&
                        recent[i].high >= recent[i + 1].high && recent[i].high > recent[i + 2].high;
    const isSwingLow = recent[i].low <= recent[i - 1].low && recent[i].low < recent[i - 2].low &&
                       recent[i].low <= recent[i + 1].low && recent[i].low < recent[i + 2].low;
    if (isSwingHigh) {
      if (prevSwingHigh > 0 && recent[i].high > prevSwingHigh) hhHl++;
      else if (prevSwingHigh > 0) lhLl++;
      prevSwingHigh = recent[i].high;
    }
    if (isSwingLow) {
      if (prevSwingLow < Infinity && recent[i].low > prevSwingLow) hhHl++;
      else if (prevSwingLow < Infinity) lhLl++;
      prevSwingLow = recent[i].low;
    }
  }

  const atrNow = computeATR(candles, Math.min(10, candles.length));
  const atrHist = computeATR(candles, 20);
  const volPct = atrHist > 0 ? atrNow / atrHist : 1.0;

  let regime = 'RANGE';
  if (volPct > 1.5) {
    regime = 'VOLATILE';
  } else if (ema9 > ema21 && trendStrength > 0.25 && hhHl > lhLl) {
    regime = 'TREND_UP';
  } else if (ema9 < ema21 && trendStrength > 0.25 && lhLl > hhHl) {
    regime = 'TREND_DOWN';
  }

  return {
    regime,
    trend_strength: Math.round(trendStrength * 1000) / 1000,
    volatility_pct: Math.round(volPct * 1000) / 1000,
    ema9: Math.round(ema9 * 1000000) / 1000000,
    ema21: Math.round(ema21 * 1000000) / 1000000,
    is_trending: regime === 'TREND_UP' || regime === 'TREND_DOWN',
    is_ranging: regime === 'RANGE',
    is_volatile: regime === 'VOLATILE',
  };
}

// ── Key Levels (swing pivots) ────────────────────────────────────────────────
export interface KeyLevel {
  price: number;
  type: 'resistance' | 'support';
  idx: number;
}

export function findKeyLevels(candles: Candle[], lookback: number = 50): KeyLevel[] {
  if (candles.length < 5) return [];
  const recent = candles.slice(-Math.min(lookback, candles.length));
  const baseOffset = candles.length - recent.length;
  const resistances: KeyLevel[] = [];
  const supports: KeyLevel[] = [];

  for (let i = 2; i < recent.length - 2; i++) {
    const isSwingHigh = recent[i].high >= recent[i - 1].high && recent[i].high > recent[i - 2].high &&
                        recent[i].high >= recent[i + 1].high && recent[i].high > recent[i + 2].high;
    const isSwingLow = recent[i].low <= recent[i - 1].low && recent[i].low < recent[i - 2].low &&
                       recent[i].low <= recent[i + 1].low && recent[i].low < recent[i + 2].low;
    if (isSwingHigh) {
      resistances.push({ price: recent[i].high, type: 'resistance', idx: baseOffset + i });
    }
    if (isSwingLow) {
      supports.push({ price: recent[i].low, type: 'support', idx: baseOffset + i });
    }
  }
  // Return last 8 of each, resistances first
  return [...resistances.slice(-8), ...supports.slice(-8)];
}

// ── Level Confluence ─────────────────────────────────────────────────────────
export interface LevelConfluence {
  near_level: boolean;
  level_type: string | null;
  level_price: number | null;
  action: string | null;
  distance_atr: number;
}

export function checkLevelConfluence(candles: Candle[], levels: KeyLevel[], atr: number): LevelConfluence {
  const result: LevelConfluence = {
    near_level: false, level_type: null, level_price: null, action: null, distance_atr: 0,
  };
  if (!candles.length || levels.length === 0) return result;

  const last = candles[candles.length - 1];
  const prev = candles.length >= 2 ? candles[candles.length - 2] : last;
  const tol = atr * 0.30;

  let nearest: KeyLevel | null = null;
  let nearestDist = Infinity;
  for (const lvl of levels) {
    const dist = Math.abs(last.close - lvl.price);
    if (dist < tol && dist < nearestDist) {
      nearest = lvl;
      nearestDist = dist;
    }
  }
  if (!nearest) return result;

  result.near_level = true;
  result.level_type = nearest.type;
  result.level_price = nearest.price;
  result.distance_atr = Math.round((nearestDist / Math.max(atr, 0.0001)) * 1000) / 1000;

  if (nearest.type === 'resistance') {
    if (last.close > nearest.price) result.action = 'breakout';
    else if (last.high > nearest.price && last.close < nearest.price) result.action = 'wick_rejection';
    else result.action = 'bounce';
  } else {
    if (last.close < nearest.price) result.action = 'breakdown';
    else if (last.low < nearest.price && last.close > nearest.price) result.action = 'wick_rejection';
    else result.action = 'bounce';
  }
  return result;
}

// ── Statistical Edge ─────────────────────────────────────────────────────────
export interface StatisticalEdge {
  z_body: number;
  z_range: number;
  close_percentile: number;
  streak_rarity: number;
  current_streak: number;
  streak_direction: number;
}

export function computeStatisticalEdge(candles: Candle[], lookback: number = 50): StatisticalEdge {
  if (candles.length < 10) {
    return { z_body: 0, z_range: 0, close_percentile: 50, streak_rarity: 0, current_streak: 0, streak_direction: 0 };
  }
  const recent = candles.slice(-Math.min(lookback, candles.length));

  // Z-body (excludes current candle)
  const absBodies = recent.slice(0, -1).map(c => Math.abs(c.close - c.open));
  const lastAbsBody = Math.abs(recent[recent.length - 1].close - recent[recent.length - 1].open);
  const meanBody = absBodies.reduce((a, b) => a + b, 0) / absBodies.length;
  const varianceBody = absBodies.reduce((s, v) => s + (v - meanBody) ** 2, 0) / Math.max(1, absBodies.length - 1);
  const stdBody = Math.sqrt(varianceBody);
  const zBody = stdBody > 0 ? (lastAbsBody - meanBody) / stdBody : 0;

  // Z-range
  const absRanges = recent.slice(0, -1).map(c => Math.abs(c.high - c.low));
  const lastAbsRange = Math.abs(recent[recent.length - 1].high - recent[recent.length - 1].low);
  const meanRange = absRanges.reduce((a, b) => a + b, 0) / absRanges.length;
  const varianceRange = absRanges.reduce((s, v) => s + (v - meanRange) ** 2, 0) / Math.max(1, absRanges.length - 1);
  const stdRange = Math.sqrt(varianceRange);
  const zRange = stdRange > 0 ? (lastAbsRange - meanRange) / stdRange : 0;

  // Close percentile
  const lastClose = recent[recent.length - 1].close;
  const priorCloses = recent.slice(0, -1).map(c => c.close);
  const countBelow = priorCloses.filter(c => c < lastClose).length;
  const countEqual = priorCloses.filter(c => c === lastClose).length;
  const pctile = (countBelow + 0.5 * countEqual) / priorCloses.length * 100;

  // Streak
  const last = recent[recent.length - 1];
  const body = last.close - last.open;
  let direction = 0;
  if (body > 0) direction = 1;
  else if (body < 0) direction = -1;

  let streak = 0;
  let streakDir = 0;
  if (direction !== 0) {
    streak = 1;
    streakDir = direction;
    for (let i = recent.length - 2; i >= 0; i--) {
      const b = recent[i].close - recent[i].open;
      const d = b > 0 ? 1 : b < 0 ? -1 : 0;
      if (d === direction) streak++;
      else break;
    }
  }

  // Streak rarity — count historical streaks >= current
  const historicalCandles = recent.slice(0, recent.length - streak);
  const historicalStreaks: number[] = [];
  let i = 0;
  while (i < historicalCandles.length) {
    const b = historicalCandles[i].close - historicalCandles[i].open;
    const d = b > 0 ? 1 : b < 0 ? -1 : 0;
    if (d === 0) { i++; continue; }
    let s = 1;
    for (let j = i + 1; j < historicalCandles.length; j++) {
      const b2 = historicalCandles[j].close - historicalCandles[j].open;
      const d2 = b2 > 0 ? 1 : b2 < 0 ? -1 : 0;
      if (d2 === d) s++;
      else break;
    }
    historicalStreaks.push(s);
    i += s;
  }
  let rarity = 0.5;
  if (historicalStreaks.length > 0 && streak > 0) {
    const count = historicalStreaks.filter(s => s >= streak).length;
    rarity = count / historicalStreaks.length;
  }

  return {
    z_body: Math.round(zBody * 100) / 100,
    z_range: Math.round(zRange * 100) / 100,
    close_percentile: Math.round(pctile * 10) / 10,
    streak_rarity: Math.round(rarity * 1000) / 1000,
    current_streak: streak,
    streak_direction: streakDir,
  };
}

// ── Candle Patterns ──────────────────────────────────────────────────────────
export interface CandlePattern {
  name: string;
  direction: 'CALL' | 'PUT';
  score: number;
}

export function detectCandlePatterns(candles: Candle[]): CandlePattern[] {
  if (candles.length < 3) return [];
  const c1 = candles[candles.length - 3];
  const c2 = candles[candles.length - 2];
  const c3 = candles[candles.length - 1];
  const b1 = c1.close - c1.open;
  const b2 = c2.close - c2.open;
  const b3 = c3.close - c3.open;
  const b2Abs = Math.abs(b2);
  const b3Abs = Math.abs(b3);
  const r2 = c2.high - c2.low;
  const r3 = c3.high - c3.low;
  const atr = computeATR(candles, 10);
  const atr20 = computeATR(candles, 20);
  const volPct = atr20 > 0 ? atr / atr20 : 1.0;
  const exhaustRatio = volPct > 1.3 ? 0.75 : volPct < 0.7 ? 0.55 : 0.65;

  const patterns: CandlePattern[] = [];
  const c2Mid = (c2.open + c2.close) / 2;
  const bodyPct3 = r3 > 0 ? (b3Abs / r3) * 100 : 0;
  const lwPct3 = r3 > 0 ? ((Math.min(c3.open, c3.close) - c3.low) / r3) * 100 : 0;
  const uwPct3 = r3 > 0 ? ((c3.high - Math.max(c3.open, c3.close)) / r3) * 100 : 0;

  // Bullish/Bearish Engulfing
  if (b2 < 0 && b3 > 0 && c3.close >= c2.open && c3.open <= c2.close) {
    const ratio = b2Abs > 0 ? b3Abs / b2Abs : 0;
    patterns.push({ name: 'BULL_ENGULF', direction: 'CALL', score: ratio > 2.0 ? 3 : 2 });
  }
  if (b2 > 0 && b3 < 0 && c3.close <= c2.open && c3.open >= c2.close) {
    const ratio = b2Abs > 0 ? b3Abs / b2Abs : 0;
    patterns.push({ name: 'BEAR_ENGULF', direction: 'PUT', score: ratio > 2.0 ? 3 : 2 });
  }

  // Morning/Evening Star
  if (b1 < 0 && Math.abs(b2) < r2 * 0.3 && b3 > 0 && c3.close > (c1.open + c1.close) / 2) {
    patterns.push({ name: 'MORNING_STAR', direction: 'CALL', score: 4 });
  }
  if (b1 > 0 && Math.abs(b2) < r2 * 0.3 && b3 < 0 && c3.close < (c1.open + c1.close) / 2) {
    patterns.push({ name: 'EVENING_STAR', direction: 'PUT', score: 4 });
  }

  // Tweezer Top/Bottom
  if (Math.abs(c2.high - c3.high) < atr * 0.08 && b2 > 0 && b3 < 0) {
    patterns.push({ name: 'TWEEZER_TOP', direction: 'PUT', score: 2 });
  }
  if (Math.abs(c2.low - c3.low) < atr * 0.08 && b2 < 0 && b3 > 0) {
    patterns.push({ name: 'TWEEZER_BOTTOM', direction: 'CALL', score: 2 });
  }

  // 3 Soldiers (exhaust + normal)
  if (b1 > 0 && b2 > 0 && b3 > 0 && c3.close > c2.close && c2.close > c1.close) {
    if (b3Abs < b2Abs * exhaustRatio) {
      patterns.push({ name: '3_SOLDIERS_EXHAUST', direction: 'PUT', score: 3 });
    } else {
      patterns.push({ name: '3_SOLDIERS', direction: 'CALL', score: 2 });
    }
  }
  if (b1 < 0 && b2 < 0 && b3 < 0 && c3.close < c2.close && c2.close < c1.close) {
    if (b3Abs < b2Abs * exhaustRatio) {
      patterns.push({ name: '3_CROWS_EXHAUST', direction: 'CALL', score: 3 });
    } else {
      patterns.push({ name: '3_CROWS', direction: 'PUT', score: 2 });
    }
  }

  // Piercing Line / Dark Cloud
  if (b2 < 0 && b3 > 0 && c3.open < c2.close && c3.close > c2Mid && c3.close < c2.open) {
    patterns.push({ name: 'PIERCING_LINE', direction: 'CALL', score: 3 });
  }
  if (b2 > 0 && b3 < 0 && c3.open > c2.close && c3.close < c2Mid && c3.close > c2.open) {
    patterns.push({ name: 'DARK_CLOUD', direction: 'PUT', score: 3 });
  }

  // Bull/Bear Harami
  if (b2 < 0 && b3 > 0 && b3Abs < b2Abs * 0.5 && c3.open >= c2.close && c3.close <= c2.open) {
    patterns.push({ name: 'BULL_HARAMI', direction: 'CALL', score: 2 });
  }
  if (b2 > 0 && b3 < 0 && b3Abs < b2Abs * 0.5 && c3.open <= c2.close && c3.close >= c2.open) {
    patterns.push({ name: 'BEAR_HARAMI', direction: 'PUT', score: 2 });
  }

  // Hammer / Shooting Star
  if (lwPct3 > 65 && bodyPct3 < 20) {
    patterns.push({ name: 'HAMMER', direction: 'CALL', score: 2 });
  }
  if (uwPct3 > 65 && bodyPct3 < 20) {
    patterns.push({ name: 'SHOOTING_STAR', direction: 'PUT', score: 3 });
  }

  return patterns;
}
