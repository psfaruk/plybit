// algorithm-detector.ts — Detects which "broker algorithm" is currently
// running on a pair, tracks transitions, and persists them to DB.
//
// Quotex (and other OTC brokers) rotate algorithms on pairs to keep
// traders off-balance. Common algorithms observed:
//
//   MEAN_REVERT  — price oscillates around a baseline; big candles
//                  immediately reverse. REVERSAL signals work well.
//   TREND_FOLLOW — price trends strongly in one direction for many
//                  candles. CONTINUATION signals work (rare in OTC).
//   BREAKOUT     — tight consolidation then sudden sharp move.
//   SCALPING     — tiny candles, low ATR, frequent direction changes.
//                  Signals are noise — best to skip.
//   RANDOM_WALK  — no detectable structure. Pure noise.
//   VOLATILE     — huge ATR, long wicks, no clear direction.

import type { Candle } from './types';
import { computeATR } from './analysis';

export type AlgorithmType =
  | 'MEAN_REVERT'
  | 'TREND_FOLLOW'
  | 'BREAKOUT'
  | 'SCALPING'
  | 'RANDOM_WALK'
  | 'VOLATILE'
  | 'COLD_START';

export interface AlgorithmEvidence {
  atr: number;
  atrRatio: number;
  slope: number;
  slopeStrength: number;
  bodyRatio: number;
  rangeRatio: number;
  streak: number;
  autocorr: number;
  winRateRecent: number;
}

export interface DetectionResult {
  pair: string;
  algorithm: AlgorithmType;
  confidence: number;
  evidence: AlgorithmEvidence;
  transitionNote?: string;
}

const lastDetectionByPair = new Map<string, DetectionResult>();

function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

function autocorrLag1(series: number[]): number {
  if (series.length < 4) return 0;
  const n = series.length - 1;
  const meanX = series.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const meanY = series.slice(1).reduce((a, b) => a + b, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = series[i] - meanX;
    const dy = series[i + 1] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  if (den === 0) return 0;
  return num / den;
}

function computeEvidence(candles: Candle[], recentWinRate: number = -1): AlgorithmEvidence {
  const closes = candles.map(c => c.close);
  const atrLong = computeATR(candles, Math.min(20, candles.length));
  const last5 = candles.slice(-5);
  const atrShort = computeATR(last5, 5);

  const ema20 = ema(closes, Math.min(20, closes.length));
  const lastEma = ema20[ema20.length - 1];
  const prevEma = ema20[Math.max(0, ema20.length - 4)];
  const slope = (lastEma - prevEma) / 3;
  const slopeStrength = atrLong > 0 ? Math.abs(slope) / atrLong : 0;

  const bodyRatios = candles.slice(-15).map(c => {
    const range = c.high - c.low;
    const body = Math.abs(c.close - c.open);
    return range > 0 ? body / range : 0;
  });
  const bodyRatio = bodyRatios.reduce((a, b) => a + b, 0) / bodyRatios.length;

  const lastCandle = candles[candles.length - 1];
  const rangeRatio = atrLong > 0 ? (lastCandle.high - lastCandle.low) / atrLong : 0;

  let streak = 0;
  for (let i = candles.length - 1; i >= 1; i--) {
    const dir = Math.sign(candles[i].close - candles[i].open);
    if (i === candles.length - 1) streak = dir;
    else if (Math.sign(candles[i].close - candles[i].open) === streak) streak += dir;
    else break;
  }

  const dirs = candles.slice(-20).map(c => Math.sign(c.close - c.open) || 1);
  const autocorr = autocorrLag1(dirs);

  return {
    atr: atrShort,
    atrRatio: atrLong > 0 ? atrShort / atrLong : 1,
    slope,
    slopeStrength,
    bodyRatio,
    rangeRatio,
    streak,
    autocorr,
    winRateRecent: recentWinRate,
  };
}

function classifyAlgorithm(e: AlgorithmEvidence): { algorithm: AlgorithmType; confidence: number; note?: string } {
  if (e.atr === 0) return { algorithm: 'COLD_START', confidence: 0.3 };

  if (e.atrRatio > 1.8 && e.rangeRatio > 1.5) {
    return { algorithm: 'VOLATILE', confidence: 0.7, note: 'ATR spiked — broker injected volatility' };
  }

  if (e.atrRatio < 0.6 && e.bodyRatio < 0.5 && e.slopeStrength < 0.3) {
    return { algorithm: 'SCALPING', confidence: 0.75, note: 'Tight compression — broker running scalping algo' };
  }

  if (e.slopeStrength > 0.5 && e.autocorr > 0.2 && Math.abs(e.streak) >= 3) {
    const dir = e.streak > 0 ? 'UP' : 'DOWN';
    return {
      algorithm: 'TREND_FOLLOW',
      confidence: Math.min(0.9, 0.5 + e.slopeStrength * 0.3 + e.autocorr * 0.2),
      note: `Strong ${dir} trend (streak=${Math.abs(e.streak)}, slope=${e.slopeStrength.toFixed(2)})`,
    };
  }

  if (e.autocorr < -0.15 && e.slopeStrength < 0.4) {
    return {
      algorithm: 'MEAN_REVERT',
      confidence: Math.min(0.9, 0.5 + Math.abs(e.autocorr) * 0.4),
      note: `Mean-reverting (autocorr=${e.autocorr.toFixed(2)}) — reversal signals favored`,
    };
  }

  if (e.atrRatio > 1.3 && e.bodyRatio > 0.6 && e.rangeRatio > 1.2) {
    return {
      algorithm: 'BREAKOUT',
      confidence: 0.65,
      note: 'Range expansion — breakout pattern detected',
    };
  }

  return {
    algorithm: 'RANDOM_WALK',
    confidence: 0.4,
    note: 'No detectable structure — signal accuracy will be low',
  };
}

function buildTransitionNote(prev: AlgorithmType, curr: AlgorithmType, e: AlgorithmEvidence): string {
  const dir = e.streak > 0 ? 'UP' : e.streak < 0 ? 'DOWN' : 'FLAT';
  switch (curr) {
    case 'MEAN_REVERT':
      return `${prev}→MEAN_REVERT: directions flipping (autocorr=${e.autocorr.toFixed(2)}). Reversal signals now favored.`;
    case 'TREND_FOLLOW':
      return `${prev}→TREND_FOLLOW: ${dir} trend started (streak=${Math.abs(e.streak)}, slope=${e.slopeStrength.toFixed(2)}).`;
    case 'BREAKOUT':
      return `${prev}→BREAKOUT: range expanded ${e.rangeRatio.toFixed(2)}x ATR. Watch for continuation.`;
    case 'SCALPING':
      return `${prev}→SCALPING: ATR compressed to ${e.atrRatio.toFixed(2)}x baseline. Signals will be noise — consider skipping.`;
    case 'VOLATILE':
      return `${prev}→VOLATILE: ATR spiked ${e.atrRatio.toFixed(2)}x baseline. Reversal signals risky.`;
    case 'RANDOM_WALK':
      return `${prev}→RANDOM_WALK: no structure detected. Lower confidence on all signals.`;
    default:
      return `${prev}→${curr}`;
  }
}

export function detectAlgorithm(
  pair: string,
  candles: Candle[],
  recentWinRate: number = -1,
): DetectionResult | null {
  if (candles.length < 10) return null;

  const evidence = computeEvidence(candles, recentWinRate);
  const { algorithm, confidence, note } = classifyAlgorithm(evidence);

  const lastDetection = lastDetectionByPair.get(pair);
  const isTransition = !lastDetection || lastDetection.algorithm !== algorithm;

  const transitionNote = isTransition && lastDetection
    ? buildTransitionNote(lastDetection.algorithm, algorithm, evidence)
    : note;

  const result: DetectionResult = {
    pair,
    algorithm,
    confidence,
    evidence,
    transitionNote,
  };

  if (isTransition) {
    lastDetectionByPair.set(pair, result);
  }

  return result;
}

export function getCurrentAlgorithm(pair: string): AlgorithmType {
  return lastDetectionByPair.get(pair)?.algorithm ?? 'COLD_START';
}

export function getCurrentDetection(pair: string): DetectionResult | null {
  return lastDetectionByPair.get(pair) ?? null;
}

export function getAllCurrentDetections(): DetectionResult[] {
  return Array.from(lastDetectionByPair.values());
}

export function getAlgorithmSignalBias(algo: AlgorithmType): {
  reversalMult: number;
  continuationMult: number;
  patternMult: number;
  confidenceScale: number;
} {
  switch (algo) {
    case 'MEAN_REVERT':
      return { reversalMult: 1.5, continuationMult: 0.4, patternMult: 1.2, confidenceScale: 1.1 };
    case 'TREND_FOLLOW':
      return { reversalMult: 0.5, continuationMult: 1.6, patternMult: 1.0, confidenceScale: 1.15 };
    case 'BREAKOUT':
      return { reversalMult: 0.8, continuationMult: 1.3, patternMult: 1.5, confidenceScale: 1.05 };
    case 'SCALPING':
      return { reversalMult: 0.3, continuationMult: 0.3, patternMult: 0.5, confidenceScale: 0.5 };
    case 'VOLATILE':
      return { reversalMult: 0.4, continuationMult: 1.0, patternMult: 0.8, confidenceScale: 0.7 };
    case 'RANDOM_WALK':
      return { reversalMult: 0.8, continuationMult: 0.8, patternMult: 0.9, confidenceScale: 0.75 };
    default:
      return { reversalMult: 1.0, continuationMult: 1.0, patternMult: 1.0, confidenceScale: 1.0 };
  }
}
