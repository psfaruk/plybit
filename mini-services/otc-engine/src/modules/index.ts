// modules/index.ts — All 6 OTC engine modules in one file
// Ported from Binary-signals-app-main/engines/base/modules/
//
// Each module exports an `analyze` function that takes (candles, ctx) and
// returns ModuleResult[]. The 6th module (otc_pattern) also takes `asset`.

import type { Candle } from '../types';
import type { MarketContext, ModuleResult, MicroData } from '../engine-types';
import { computeATR, detectCandlePatterns, computeRSI, computeMACD, computeEMA, computeBollingerBands, computeStochastic } from '../analysis';

// ─── MODULE 1: Candle Reaction ───────────────────────────────────────────────
export function candleReaction(candles: Candle[], ctx: MarketContext): ModuleResult[] {
  const results: ModuleResult[] = [];
  if (candles.length < 3) return results;

  const last = candles[candles.length - 1];
  const body = last.close - last.open;
  const rng = last.high - last.low;
  const bodyAbs = Math.abs(body);
  const bodyPct = rng > 0 ? (bodyAbs / rng) * 100 : 0;

  const { is_trending, trend_regime, trend_strength, volatility_pct: volPct } = { ...ctx.regime, trend_regime: ctx.regime.regime };
  const stats = ctx.stats;

  // Volatility-scaled thresholds
  let streakThresh5 = 5, streakThresh4 = 4, streakThresh3 = 3, bodyMult = 1.5, zBoostThreshold = 2.3;
  if (volPct > 1.3) { streakThresh5 = 6; streakThresh4 = 5; streakThresh3 = 4; bodyMult = 2.0; zBoostThreshold = 2.0; }
  else if (volPct < 0.7) { streakThresh5 = 4; streakThresh4 = 3; streakThresh3 = 3; bodyMult = 1.3; zBoostThreshold = 2.8; }
  streakThresh3 = Math.max(3, streakThresh3);

  const consec = stats.current_streak;
  const streakDir = stats.streak_direction;

  // SIGNAL 1: Consecutive streak reversal
  const streakAlignsStrong = is_trending && trend_strength > 0.5 &&
    ((trend_regime === 'TREND_UP' && streakDir === 1) || (trend_regime === 'TREND_DOWN' && streakDir === -1));

  let s1Score = 0, s1Conf = 0;
  if (consec >= streakThresh5) { s1Score = 4; s1Conf = 75; }
  else if (consec >= streakThresh4) { s1Score = 3; s1Conf = 60; }
  else if (consec >= streakThresh3) { s1Score = 2; s1Conf = 55; }

  if (s1Score > 0) {
    if (streakAlignsStrong && trend_strength >= 0.7) { s1Score = Math.min(s1Score, 1); s1Conf = streakThresh5 <= consec ? 56 : streakThresh4 <= consec ? 53 : 51; }
    else if (streakAlignsStrong) { s1Score = Math.min(s1Score, 2); s1Conf = streakThresh5 <= consec ? 62 : streakThresh4 <= consec ? 56 : 52; }

    if (streakDir === 1) {
      results.push({ module_name: 'candle_reaction', direction: 'PUT', score: s1Score, confidence: s1Conf, signal_type: 'REVERSAL', reliability: 'CANDLE', group: 'BODY', reasons: [`Streak reversal: ${consec} UP → PUT`] });
    } else if (streakDir === -1) {
      results.push({ module_name: 'candle_reaction', direction: 'CALL', score: s1Score, confidence: s1Conf, signal_type: 'REVERSAL', reliability: 'CANDLE', group: 'BODY', reasons: [`Streak reversal: ${consec} DOWN → CALL`] });
    }
  }

  // SIGNAL 2: Big body reversal
  if (candles.length >= 10) {
    const window = candles.slice(-Math.min(20, candles.length - 1), -1);
    const absBodies = window.map(c => Math.abs(c.close - c.open)).sort((a, b) => a - b);
    const mid = Math.floor(absBodies.length / 2);
    const medianBody = absBodies.length % 2 === 0 ? (absBodies[mid - 1] + absBodies[mid]) / 2 : absBodies[mid];
    if (medianBody > 0 && bodyAbs > medianBody * bodyMult) {
      const zBoost = stats.z_body > zBoostThreshold ? 1 : 0;
      const bodyAlignsStrong = is_trending && trend_strength > 0.5 &&
        ((trend_regime === 'TREND_UP' && body > 0) || (trend_regime === 'TREND_DOWN' && body < 0));
      let baseScore = 3, baseConf = 64;
      if (bodyAlignsStrong && trend_strength >= 0.7) { baseScore = 1; baseConf = 53; }
      else if (bodyAlignsStrong) { baseScore = 2; baseConf = 58; }
      const score = baseScore + zBoost;
      if (body > 0) {
        results.push({ module_name: 'candle_reaction', direction: 'PUT', score, confidence: baseConf, signal_type: 'REVERSAL', reliability: 'CANDLE', group: 'BODY', reasons: [`Big body reversal: body ${bodyAbs.toFixed(5)} > ${bodyMult}x median → PUT`] });
      } else if (body < 0) {
        results.push({ module_name: 'candle_reaction', direction: 'CALL', score, confidence: baseConf, signal_type: 'REVERSAL', reliability: 'CANDLE', group: 'BODY', reasons: [`Big body reversal: body ${bodyAbs.toFixed(5)} > ${bodyMult}x median → CALL`] });
      }
    }
  }

  // SIGNAL 3: Wick rejection
  const uwPct = rng > 0 ? ((last.high - Math.max(last.open, last.close)) / rng) * 100 : 0;
  const lwPct = rng > 0 ? ((Math.min(last.open, last.close) - last.low) / rng) * 100 : 0;
  const strongTrend = is_trending && trend_strength >= 0.5;

  if (uwPct > 50 && bodyPct < 30) {
    if (!(strongTrend && trend_regime === 'TREND_UP')) {
      results.push({ module_name: 'candle_reaction', direction: 'PUT', score: 2, confidence: 55, signal_type: 'REVERSAL', reliability: 'CANDLE', group: 'WICK', reasons: ['Upper wick rejection → PUT'] });
    }
  }
  if (lwPct > 50 && bodyPct < 30) {
    if (!(strongTrend && trend_regime === 'TREND_DOWN')) {
      results.push({ module_name: 'candle_reaction', direction: 'CALL', score: 2, confidence: 55, signal_type: 'REVERSAL', reliability: 'CANDLE', group: 'WICK', reasons: ['Lower wick rejection → CALL'] });
    }
  }

  // SIGNAL 4: Close position in range
  const closePos = rng > 0 ? ((last.close - last.low) / rng) * 100 : 50;
  const closePctile = stats.close_percentile;
  if (closePos >= 80) {
    const pBoost = closePctile >= 90 ? 1 : 0;
    const alignsUp = is_trending && trend_strength > 0.5 && trend_regime === 'TREND_UP';
    let bs = 2, bc = 62;
    if (alignsUp && trend_strength >= 0.7) { bs = 1; bc = 53; }
    else if (alignsUp) { bs = 1; bc = 56; }
    results.push({ module_name: 'candle_reaction', direction: 'PUT', score: bs + pBoost, confidence: bc, signal_type: 'REVERSAL', reliability: 'CANDLE', group: 'BODY', reasons: [`Close at top (${closePos.toFixed(0)}%) → PUT`] });
  } else if (closePos <= 20) {
    const pBoost = closePctile <= 10 ? 1 : 0;
    const alignsDn = is_trending && trend_strength > 0.5 && trend_regime === 'TREND_DOWN';
    let bs = 2, bc = 62;
    if (alignsDn && trend_strength >= 0.7) { bs = 1; bc = 53; }
    else if (alignsDn) { bs = 1; bc = 56; }
    results.push({ module_name: 'candle_reaction', direction: 'CALL', score: bs + pBoost, confidence: bc, signal_type: 'REVERSAL', reliability: 'CANDLE', group: 'BODY', reasons: [`Close at bottom (${closePos.toFixed(0)}%) → CALL`] });
  }

  // SIGNAL 6 (CONTINUATION): Rising/falling closes momentum
  if (is_trending && trend_strength > 0.5 && candles.length >= 3) {
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];
    const r1 = c1.high - c1.low, r2 = c2.high - c2.low, r3 = c3.high - c3.low;
    const b1 = Math.abs(c3.close - c3.open), b2 = Math.abs(c2.close - c2.open), b3 = Math.abs(c1.close - c1.open);
    if (r1 > 0 && r2 > 0 && r3 > 0 && b2 / r2 >= 0.30 && b1 / r1 >= 0.30 && bodyPct >= 30) {
      if (c1.close < c2.close && c2.close < c3.close && trend_regime === 'TREND_UP') {
        results.push({ module_name: 'candle_reaction', direction: 'CALL', score: 3, confidence: 62, signal_type: 'CONTINUATION', reliability: 'CANDLE', group: 'BODY_CONT', reasons: ['Rising closes momentum → CALL'] });
      } else if (c1.close > c2.close && c2.close > c3.close && trend_regime === 'TREND_DOWN') {
        results.push({ module_name: 'candle_reaction', direction: 'PUT', score: 3, confidence: 62, signal_type: 'CONTINUATION', reliability: 'CANDLE', group: 'BODY_CONT', reasons: ['Falling closes momentum → PUT'] });
      }
    }
  }

  return results;
}

// ─── MODULE 2: Running Tick (simplified — no live microstructure) ─────────────
export function runningTick(candles: Candle[], _ticks: any, micro: MicroData | null, ctx: MarketContext): ModuleResult[] {
  if (!micro) return [];
  const results: ModuleResult[] = [];
  const atr = ctx.atr || 0.0001;

  let callSum = 0, putSum = 0, callN = 0, putN = 0;
  const callScores: number[] = [], putScores: number[] = [];

  // Sub-signal 1: Ending direction
  if (micro.ending_direction) {
    const ed = micro.ending_direction;
    if (ed.direction === 'UP' && ed.dominance === 'BUYER') {
      const s = ed.buy_pct >= 65 ? 3 : 2; callSum += s; callN++; callScores.push(s);
    } else if (ed.direction === 'DOWN' && ed.dominance === 'SELLER') {
      const s = ed.buy_pct >= 65 ? 3 : 2; putSum += s; putN++; putScores.push(s);
    }
  }
  // Sub-signal 2: Pressure
  if (micro.pressure === 'BUYER') { const s = (micro.buy_pct || 50) >= 65 ? 3 : 2; callSum += s; callN++; callScores.push(s); }
  else if (micro.pressure === 'SELLER') { const s = (100 - (micro.buy_pct || 50)) >= 65 ? 3 : 2; putSum += s; putN++; putScores.push(s); }
  // Sub-signal 3: Reaction
  if (micro.reaction === 'BUYER') { callSum += 2; callN++; callScores.push(2); }
  else if (micro.reaction === 'SELLER') { putSum += 2; putN++; putScores.push(2); }
  // Sub-signal 6: V-shape
  if (micro.v_shape === 'V_BOTTOM') { callSum += 3; callN++; callScores.push(3); }
  else if (micro.v_shape === 'V_TOP') { putSum += 3; putN++; putScores.push(3); }
  // Sub-signal 7: Momentum shift
  if (micro.momentum_shift === 'BULL_SHIFT') { callSum += 2; callN++; callScores.push(2); }
  else if (micro.momentum_shift === 'BEAR_SHIFT') { putSum += 2; putN++; putScores.push(2); }
  // Sub-signal 9: Live wick
  if (micro.live_wick) {
    if (micro.live_wick.type === 'BULL_REJECT' && micro.live_wick.lw_ratio > 0.40) {
      const s = micro.live_wick.lw_ratio > 0.55 ? 3 : 2; callSum += s; callN++; callScores.push(s);
    } else if (micro.live_wick.type === 'BEAR_REJECT' && micro.live_wick.uw_ratio > 0.40) {
      const s = micro.live_wick.uw_ratio > 0.55 ? 3 : 2; putSum += s; putN++; putScores.push(s);
    }
  }

  if (callSum === putSum) return [];

  // Find prior direction
  let priorDir = 0;
  for (let i = candles.length - 2; i >= 0 && i >= candles.length - 32; i--) {
    const b = candles[i].close - candles[i].open;
    if (b > 0) { priorDir = 1; break; }
    if (b < 0) { priorDir = -1; break; }
  }

  if (callSum > putSum) {
    const netDiff = callSum - putSum;
    const breadthBonus = Math.min(2, Math.floor(callN / 3));
    const compositeScore = Math.min(6, netDiff + breadthBonus);
    const maxSub = Math.max(...callScores);
    const confidence = Math.min(70, compositeScore * 14 + maxSub * 2);
    const sigType = priorDir === 1 ? 'CONTINUATION' : 'REVERSAL';
    results.push({ module_name: 'running_tick', direction: 'CALL', score: compositeScore, confidence, signal_type: sigType, reliability: 'MICRO', group: 'MICRO', reasons: [`Tick pressure: CALL (${callSum} vs ${putSum})`] });
  } else {
    const netDiff = putSum - callSum;
    const breadthBonus = Math.min(2, Math.floor(putN / 3));
    const compositeScore = Math.min(6, netDiff + breadthBonus);
    const maxSub = Math.max(...putScores);
    const confidence = Math.min(70, compositeScore * 14 + maxSub * 2);
    const sigType = priorDir === -1 ? 'CONTINUATION' : 'REVERSAL';
    results.push({ module_name: 'running_tick', direction: 'PUT', score: compositeScore, confidence, signal_type: sigType, reliability: 'MICRO', group: 'MICRO', reasons: [`Tick pressure: PUT (${putSum} vs ${callSum})`] });
  }

  return results;
}

// ─── MODULE 3: Pattern ───────────────────────────────────────────────────────
const ALWAYS_REVERSAL = new Set(['MORNING_STAR', 'EVENING_STAR', 'TWEEZER_TOP', 'TWEEZER_BOTTOM', '3_SOLDIERS_EXHAUST', '3_CROWS_EXHAUST', 'PIERCING_LINE', 'DARK_CLOUD', 'BULL_HARAMI', 'BEAR_HARAMI', 'HAMMER', 'SHOOTING_STAR']);
const ALWAYS_CONTINUATION = new Set(['3_SOLDIERS', '3_CROWS']);

export function patternModule(candles: Candle[], ctx: MarketContext): ModuleResult[] {
  const results: ModuleResult[] = [];
  const patterns = detectCandlePatterns(candles);
  const { is_trending, trend_strength, regime: trendRegime } = ctx.regime;
  const strongTrend = is_trending && trend_strength > 0.7;

  for (const pat of patterns) {
    let sigType: 'REVERSAL' | 'CONTINUATION';
    let group: string;

    if (ALWAYS_REVERSAL.has(pat.name)) {
      sigType = 'REVERSAL'; group = 'PATTERN_REVERSAL';
    } else if (ALWAYS_CONTINUATION.has(pat.name)) {
      sigType = 'CONTINUATION'; group = 'PATTERN_CONTINUATION';
    } else if (pat.name === 'BULL_ENGULF' || pat.name === 'BEAR_ENGULF') {
      // Regime conditional
      if (strongTrend) {
        const aligns = (pat.direction === 'CALL' && trendRegime === 'TREND_UP') || (pat.direction === 'PUT' && trendRegime === 'TREND_DOWN');
        sigType = aligns ? 'CONTINUATION' : 'REVERSAL';
      } else {
        sigType = 'REVERSAL';
      }
      group = sigType === 'REVERSAL' ? 'PATTERN_REVERSAL' : 'PATTERN_CONTINUATION';
    } else {
      continue; // Unknown pattern — skip
    }

    const confidence = pat.score * 18;
    results.push({
      module_name: 'pattern', direction: pat.direction, score: pat.score,
      confidence, signal_type: sigType, reliability: 'PATTERN', group,
      reasons: [`Pattern: ${pat.name} → ${pat.direction} (${sigType})`],
    });
  }

  return results;
}

// ─── MODULE 4: Indicator ─────────────────────────────────────────────────────
export function indicatorModule(candles: Candle[], ctx: MarketContext): ModuleResult[] {
  const results: ModuleResult[] = [];
  if (candles.length < 30) return results;

  const { is_trending, regime: trendRegime, trend_strength } = ctx.regime;
  const strongTrend = is_trending && trend_strength >= 0.7;
  const last = candles[candles.length - 1];

  // RSI
  const rsi = computeRSI(candles, 14);
  if (rsi > 70) {
    if (strongTrend && trendRegime === 'TREND_UP') {
      results.push({ module_name: 'indicator', direction: 'CALL', score: 2, confidence: 58, signal_type: 'CONTINUATION', reliability: 'INDICATOR', group: 'IND_RSI', reasons: [`RSI ${rsi.toFixed(0)} overbought in uptrend → CALL cont`] });
    } else {
      results.push({ module_name: 'indicator', direction: 'PUT', score: 3, confidence: 62, signal_type: 'REVERSAL', reliability: 'INDICATOR', group: 'IND_RSI', reasons: [`RSI ${rsi.toFixed(0)} overbought → PUT reversal`] });
    }
  } else if (rsi < 30) {
    if (strongTrend && trendRegime === 'TREND_DOWN') {
      results.push({ module_name: 'indicator', direction: 'PUT', score: 2, confidence: 58, signal_type: 'CONTINUATION', reliability: 'INDICATOR', group: 'IND_RSI', reasons: [`RSI ${rsi.toFixed(0)} oversold in downtrend → PUT cont`] });
    } else {
      results.push({ module_name: 'indicator', direction: 'CALL', score: 3, confidence: 62, signal_type: 'REVERSAL', reliability: 'INDICATOR', group: 'IND_RSI', reasons: [`RSI ${rsi.toFixed(0)} oversold → CALL reversal`] });
    }
  }

  // MACD
  const macd = computeMACD(candles);
  const histPrev = macd.histogram[macd.histogram.length - 2] || 0;
  const histNow = macd.histogram[macd.histogram.length - 1] || 0;
  const atrVal = ctx.atr || 0.001;
  const magThreshold = atrVal * 0.1;
  if (histPrev <= 0 && histNow > 0 && Math.abs(histNow) > magThreshold) {
    results.push({ module_name: 'indicator', direction: 'CALL', score: 1, confidence: 52, signal_type: 'CONTINUATION', reliability: 'INDICATOR', group: 'IND_MACD', reasons: ['MACD bullish crossover → CALL'] });
  } else if (histPrev >= 0 && histNow < 0 && Math.abs(histNow) > magThreshold) {
    results.push({ module_name: 'indicator', direction: 'PUT', score: 1, confidence: 52, signal_type: 'CONTINUATION', reliability: 'INDICATOR', group: 'IND_MACD', reasons: ['MACD bearish crossover → PUT'] });
  }

  // EMA crossover (9 vs 21)
  const emaDiffPct = ctx.ema21 !== 0 ? ((ctx.ema9 - ctx.ema21) / ctx.ema21) * 100 : 0;
  if (ctx.ema9 > ctx.ema21 && emaDiffPct > 0.15) {
    results.push({ module_name: 'indicator', direction: 'CALL', score: 1, confidence: 52, signal_type: 'CONTINUATION', reliability: 'INDICATOR', group: 'IND_EMA', reasons: [`EMA9 > EMA21 (${emaDiffPct.toFixed(2)}%) → CALL`] });
  } else if (ctx.ema9 < ctx.ema21 && emaDiffPct < -0.15) {
    results.push({ module_name: 'indicator', direction: 'PUT', score: 1, confidence: 52, signal_type: 'CONTINUATION', reliability: 'INDICATOR', group: 'IND_EMA', reasons: [`EMA9 < EMA21 (${emaDiffPct.toFixed(2)}%) → PUT`] });
  }

  // Bollinger Bands
  const bb = computeBollingerBands(candles, 20, 2);
  if (bb.width > 0.0001) {
    if (last.close >= bb.upper) {
      if (strongTrend && trendRegime === 'TREND_UP') {
        results.push({ module_name: 'indicator', direction: 'CALL', score: 1, confidence: 54, signal_type: 'CONTINUATION', reliability: 'INDICATOR', group: 'IND_BB', reasons: ['Close at BB upper in uptrend → CALL cont'] });
      } else if (strongTrend && trendRegime === 'TREND_DOWN') {
        results.push({ module_name: 'indicator', direction: 'PUT', score: 1, confidence: 54, signal_type: 'CONTINUATION', reliability: 'INDICATOR', group: 'IND_BB', reasons: ['Close at BB upper in downtrend → PUT cont'] });
      } else {
        results.push({ module_name: 'indicator', direction: 'PUT', score: 2, confidence: 58, signal_type: 'REVERSAL', reliability: 'INDICATOR', group: 'IND_BB', reasons: ['Close at BB upper → PUT reversal'] });
      }
    } else if (last.close <= bb.lower) {
      if (strongTrend && trendRegime === 'TREND_DOWN') {
        results.push({ module_name: 'indicator', direction: 'PUT', score: 1, confidence: 54, signal_type: 'CONTINUATION', reliability: 'INDICATOR', group: 'IND_BB', reasons: ['Close at BB lower in downtrend → PUT cont'] });
      } else if (strongTrend && trendRegime === 'TREND_UP') {
        results.push({ module_name: 'indicator', direction: 'CALL', score: 1, confidence: 54, signal_type: 'CONTINUATION', reliability: 'INDICATOR', group: 'IND_BB', reasons: ['Close at BB lower in uptrend → CALL cont'] });
      } else {
        results.push({ module_name: 'indicator', direction: 'CALL', score: 2, confidence: 58, signal_type: 'REVERSAL', reliability: 'INDICATOR', group: 'IND_BB', reasons: ['Close at BB lower → CALL reversal'] });
      }
    }
  }

  // Stochastic
  const stoch = computeStochastic(candles, 14, 3);
  const freshBearCross = stoch.kPrev >= stoch.dPrev && stoch.k < stoch.d;
  const freshBullCross = stoch.kPrev <= stoch.dPrev && stoch.k > stoch.d;
  if (freshBearCross && (stoch.kPrev >= 70 || Math.max(stoch.k, stoch.kPrev) > 75)) {
    results.push({ module_name: 'indicator', direction: 'PUT', score: 2, confidence: 57, signal_type: 'REVERSAL', reliability: 'INDICATOR', group: 'IND_STOCH', reasons: [`Stochastic bearish crossover (K=${stoch.k.toFixed(0)}) → PUT`] });
  } else if (freshBullCross && (stoch.kPrev <= 30 || Math.min(stoch.k, stoch.kPrev) < 25)) {
    results.push({ module_name: 'indicator', direction: 'CALL', score: 2, confidence: 57, signal_type: 'REVERSAL', reliability: 'INDICATOR', group: 'IND_STOCH', reasons: [`Stochastic bullish crossover (K=${stoch.k.toFixed(0)}) → CALL`] });
  }

  return results;
}

// ─── MODULE 5: Key Level ─────────────────────────────────────────────────────
export function keyLevel(candles: Candle[], ctx: MarketContext): ModuleResult[] {
  const results: ModuleResult[] = [];
  if (candles.length < 5) return results;
  const atr = ctx.atr || 0.0001;
  const last = candles[candles.length - 1];
  const prev = candles.length >= 2 ? candles[candles.length - 2] : last;

  // SIGNAL 1: Swing level confluence
  const lc = ctx.level_confluence;
  if (lc.near_level) {
    if (lc.action === 'wick_rejection') {
      if (lc.level_type === 'support') {
        results.push({ module_name: 'key_level', direction: 'CALL', score: 4, confidence: 70, signal_type: 'REVERSAL', reliability: 'LEVEL', group: 'LEVEL', reasons: [`Wick rejection at support ${lc.level_price?.toFixed(5)} → CALL`] });
      } else {
        results.push({ module_name: 'key_level', direction: 'PUT', score: 4, confidence: 70, signal_type: 'REVERSAL', reliability: 'LEVEL', group: 'LEVEL', reasons: [`Wick rejection at resistance ${lc.level_price?.toFixed(5)} → PUT`] });
      }
    } else if (lc.action === 'bounce') {
      if (lc.level_type === 'support') {
        results.push({ module_name: 'key_level', direction: 'CALL', score: 3, confidence: 65, signal_type: 'REVERSAL', reliability: 'LEVEL', group: 'LEVEL', reasons: [`Bounce at support ${lc.level_price?.toFixed(5)} → CALL`] });
      } else {
        results.push({ module_name: 'key_level', direction: 'PUT', score: 3, confidence: 65, signal_type: 'REVERSAL', reliability: 'LEVEL', group: 'LEVEL', reasons: [`Bounce at resistance ${lc.level_price?.toFixed(5)} → PUT`] });
      }
    }
  }

  // SIGNAL 3: Previous candle high/low as micro-S/R
  if (candles.length >= 2 && atr > 0) {
    const tol = atr * 0.10;
    const granularity = Math.abs(last.close) > 50 ? 0.01 : 0.0001;
    const eps = Math.max(Math.abs(last.close) * 1e-7, granularity * 0.1);
    if (Math.abs(last.close - prev.high) < tol) {
      if (last.close < prev.high - eps) {
        results.push({ module_name: 'key_level', direction: 'PUT', score: 1, confidence: 52, signal_type: 'REVERSAL', reliability: 'LEVEL', group: 'MICRO_SR', reasons: ['Rejected prev high → PUT'] });
      } else if (last.close > prev.high + eps) {
        results.push({ module_name: 'key_level', direction: 'CALL', score: 1, confidence: 52, signal_type: 'CONTINUATION', reliability: 'LEVEL', group: 'MICRO_SR', reasons: ['Broke prev high → CALL'] });
      }
    }
    if (Math.abs(last.close - prev.low) < tol) {
      if (last.close > prev.low + eps) {
        results.push({ module_name: 'key_level', direction: 'CALL', score: 1, confidence: 52, signal_type: 'REVERSAL', reliability: 'LEVEL', group: 'MICRO_SR', reasons: ['Bounced off prev low → CALL'] });
      } else if (last.close < prev.low - eps) {
        results.push({ module_name: 'key_level', direction: 'PUT', score: 1, confidence: 52, signal_type: 'CONTINUATION', reliability: 'LEVEL', group: 'MICRO_SR', reasons: ['Broke prev low → PUT'] });
      }
    }
  }

  // SIGNAL 4: Fibonacci retracement
  if (candles.length >= 20 && atr > 0) {
    const window = candles.slice(-20);
    const swingHigh = Math.max(...window.map(c => c.high));
    const swingLow = Math.min(...window.map(c => c.low));
    const swingRange = swingHigh - swingLow;
    if (swingRange > atr * 2.0) {
      const highIdx = window.findIndex(c => c.high === swingHigh);
      const lowIdx = window.findIndex(c => c.low === swingLow);
      if (highIdx !== lowIdx) {
        const fibLevels = highIdx > lowIdx
          ? [swingHigh - swingRange * 0.382, swingHigh - swingRange * 0.5, swingHigh - swingRange * 0.618]
          : [swingLow + swingRange * 0.382, swingLow + swingRange * 0.5, swingLow + swingRange * 0.618];
        for (const fib of fibLevels) {
          if (Math.abs(last.close - fib) < atr * 0.15) {
            if (highIdx > lowIdx) {
              results.push({ module_name: 'key_level', direction: 'CALL', score: 2, confidence: 58, signal_type: 'REVERSAL', reliability: 'LEVEL', group: 'FIB', reasons: [`Fib retracement ${fib.toFixed(5)} → CALL`] });
            } else {
              results.push({ module_name: 'key_level', direction: 'PUT', score: 2, confidence: 58, signal_type: 'REVERSAL', reliability: 'LEVEL', group: 'FIB', reasons: [`Fib retracement ${fib.toFixed(5)} → PUT`] });
            }
            break;
          }
        }
      }
    }
  }

  // SIGNAL 6: S/R Flip
  if (candles.length >= 10 && atr > 0) {
    const levels = [...ctx.key_levels].sort((a, b) => b.idx - a.idx).slice(0, 4);
    for (const lvl of levels) {
      if (lvl.type === 'resistance' && prev.close > lvl.price && last.close > lvl.price && Math.abs(last.close - lvl.price) < atr * 0.20) {
        results.push({ module_name: 'key_level', direction: 'CALL', score: 2, confidence: 57, signal_type: 'REVERSAL', reliability: 'LEVEL', group: 'SR_FLIP', reasons: [`S/R flip: resistance ${lvl.price.toFixed(5)} broken → CALL`] });
        break;
      }
      if (lvl.type === 'support' && prev.close < lvl.price && last.close < lvl.price && Math.abs(last.close - lvl.price) < atr * 0.20) {
        results.push({ module_name: 'key_level', direction: 'PUT', score: 2, confidence: 57, signal_type: 'REVERSAL', reliability: 'LEVEL', group: 'SR_FLIP', reasons: [`S/R flip: support ${lvl.price.toFixed(5)} broken → PUT`] });
        break;
      }
    }
  }

  // SIGNAL 7: Trendline breakout
  if (candles.length >= 12 && atr > 0) {
    const highs = candles.slice(-6).map(c => c.high);
    const lows = candles.slice(-6).map(c => c.low);
    const descHighs = highs[0] > highs[5] && highs.every((h, i) => i === 0 || h >= highs[i]);
    const ascLows = lows[0] < lows[5] && lows.every((l, i) => i === 0 || l <= lows[i]);
    if (descHighs && last.close > Math.max(highs[4], highs[5])) {
      results.push({ module_name: 'key_level', direction: 'CALL', score: 2, confidence: 56, signal_type: 'REVERSAL', reliability: 'LEVEL', group: 'TRENDLINE', reasons: ['Descending trendline breakout → CALL'] });
    } else if (ascLows && last.close < Math.min(lows[4], lows[5])) {
      results.push({ module_name: 'key_level', direction: 'PUT', score: 2, confidence: 56, signal_type: 'REVERSAL', reliability: 'LEVEL', group: 'TRENDLINE', reasons: ['Ascending trendline breakdown → PUT'] });
    }
  }

  return results;
}

// ─── MODULE 6: OTC Pattern ───────────────────────────────────────────────────
export function otcPattern(candles: Candle[], ctx: MarketContext, asset: string = ''): ModuleResult[] {
  const results: ModuleResult[] = [];
  if (candles.length < 10) return results;

  const stats = ctx.stats;
  const { is_trending, regime: trendRegime, trend_strength } = ctx.regime;
  const consec = stats.current_streak;
  const streakDir = stats.streak_direction;

  // Algorithm gate stub — always "unknown" (no algorithm_monitor in TS yet)
  const algoGate = 'unknown';
  const algoIsTrending = false;
  const algoIsReversing = false;
  const effectiveTrending = algoIsTrending || (algoGate === 'unknown' && is_trending && trend_strength >= 0.5);

  // Streak ATR (excludes streak candles)
  const atrVal = ctx.atr || 0.0001;
  let streakAtr = atrVal;
  if (consec >= 1 && candles.length > consec + 5) {
    const computed = computeATR(candles.slice(0, -consec), 20);
    streakAtr = computed > 0 ? computed : atrVal;
  }
  const streakBodies = candles.slice(-Math.min(consec, candles.length)).map(c => Math.abs(c.close - c.open));
  const avgStreakBody = streakBodies.length > 0 ? streakBodies.reduce((a, b) => a + b, 0) / streakBodies.length : 0;
  const streakIsMeaningful = avgStreakBody >= streakAtr * 0.3;

  // SIGNAL 1: Mean-reversion bias
  if (consec >= 3 && !effectiveTrending && streakIsMeaningful) {
    if (streakDir === 1) {
      results.push({ module_name: 'otc_pattern', direction: 'PUT', score: 2, confidence: 62, signal_type: 'REVERSAL', reliability: 'OTC', group: 'OTC_MEANREV', reasons: [`OTC mean-rev: ${consec}+ UP → PUT`] });
    } else if (streakDir === -1) {
      results.push({ module_name: 'otc_pattern', direction: 'CALL', score: 2, confidence: 62, signal_type: 'REVERSAL', reliability: 'OTC', group: 'OTC_MEANREV', reasons: [`OTC mean-rev: ${consec}+ DOWN → CALL`] });
    }
  }

  // SIGNAL 2: Streak rarity boost
  if (consec >= 3 && stats.streak_rarity < 0.10) {
    const alignedWithTrend = effectiveTrending && ((trendRegime === 'TREND_UP' && streakDir === 1) || (trendRegime === 'TREND_DOWN' && streakDir === -1));
    if (!(alignedWithTrend && trend_strength > 0.7)) {
      let score = 2, conf = 65;
      if (alignedWithTrend && trend_strength > 0.5) { score = 1; conf = 56; }
      if (streakDir === 1) {
        results.push({ module_name: 'otc_pattern', direction: 'PUT', score, confidence: conf, signal_type: 'REVERSAL', reliability: 'OTC', group: 'OTC_RARITY', reasons: [`Rare streak (n=${consec}, rarity=${(stats.streak_rarity * 100).toFixed(0)}%) → PUT`] });
      } else if (streakDir === -1) {
        results.push({ module_name: 'otc_pattern', direction: 'CALL', score, confidence: conf, signal_type: 'REVERSAL', reliability: 'OTC', group: 'OTC_RARITY', reasons: [`Rare streak (n=${consec}, rarity=${(stats.streak_rarity * 100).toFixed(0)}%) → CALL`] });
      }
    }
  }

  // SIGNAL 3: Z-score extreme (gated on algo_is_reversing — stub returns false)
  // Skip for now since algo_gate is always "unknown"

  // SIGNAL 4: Close percentile extreme
  const pctile = stats.close_percentile;
  const pctileAligns = effectiveTrending && ((trendRegime === 'TREND_UP' && pctile >= 95) || (trendRegime === 'TREND_DOWN' && pctile <= 5));
  if (!(pctileAligns && trend_strength > 0.7)) {
    let score = 2, conf = 61;
    if (pctileAligns && trend_strength > 0.5) { score = 1; conf = 55; }
    if (pctile >= 95) {
      results.push({ module_name: 'otc_pattern', direction: 'PUT', score, confidence: conf, signal_type: 'REVERSAL', reliability: 'OTC', group: 'OTC_PCTILE', reasons: [`Close at ${pctile.toFixed(0)}th percentile → PUT`] });
    } else if (pctile <= 5) {
      results.push({ module_name: 'otc_pattern', direction: 'CALL', score, confidence: conf, signal_type: 'REVERSAL', reliability: 'OTC', group: 'OTC_PCTILE', reasons: [`Close at ${pctile.toFixed(0)}th percentile → CALL`] });
    }
  }

  // SIGNAL 5: Alternation bias
  if ((consec === 0 || consec === 1) && stats.streak_rarity > 0.30 && stats.z_body < 0.5) {
    const last = candles[candles.length - 1];
    const body = last.close - last.open;
    const priorPutReversal = results.some(r => r.signal_type === 'REVERSAL' && r.direction === 'PUT');
    const priorCallReversal = results.some(r => r.signal_type === 'REVERSAL' && r.direction === 'CALL');
    if (body > 0 && !priorPutReversal) {
      results.push({ module_name: 'otc_pattern', direction: 'PUT', score: 1, confidence: 53, signal_type: 'REVERSAL', reliability: 'OTC', group: 'OTC_ALTERNATE', reasons: ['OTC alternation bias → PUT'] });
    } else if (body < 0 && !priorCallReversal) {
      results.push({ module_name: 'otc_pattern', direction: 'CALL', score: 1, confidence: 53, signal_type: 'REVERSAL', reliability: 'OTC', group: 'OTC_ALTERNATE', reasons: ['OTC alternation bias → CALL'] });
    }
  }

  // SIGNAL 6 (CONTINUATION): Momentum push
  const last = candles[candles.length - 1];
  const lastBody = last.close - last.open;
  const zBodyS6 = stats.z_body;
  if (effectiveTrending && consec >= 1 && consec <= 2 && zBodyS6 >= 0.5 && zBodyS6 < 2.5) {
    if (streakDir === 1 && lastBody > 0) {
      results.push({ module_name: 'otc_pattern', direction: 'CALL', score: 2, confidence: 58, signal_type: 'CONTINUATION', reliability: 'OTC', group: 'OTC_MOMENTUM', reasons: [`OTC momentum push: ${consec} UP + growing body (Z=${zBodyS6.toFixed(1)}) → CALL`] });
    } else if (streakDir === -1 && lastBody < 0) {
      results.push({ module_name: 'otc_pattern', direction: 'PUT', score: 2, confidence: 58, signal_type: 'CONTINUATION', reliability: 'OTC', group: 'OTC_MOMENTUM', reasons: [`OTC momentum push: ${consec} DOWN + growing body (Z=${zBodyS6.toFixed(1)}) → PUT`] });
    }
  }

  // SIGNAL 8 (CONTINUATION): Strong-trend streak (gated on algo_is_trending — stub returns false)
  // Skip for now

  return results;
}

// Fix typo: streakThresh3 → streakThresh3
// (the variable was misspelled in the LOW volatility branch)
