// blender-v2.ts — The main prediction pipeline
// Ported from Binary-signals-app-main/engines/base/blender.py
//
// This is the "brain" that combines all 6 module votes into a final
// CALL / PUT / NEUTRAL signal with confidence and strength.

import type { Candle } from './types';
import type { MarketContext, ModuleResult, MicroData, PredictionResult, Direction } from './engine-types';
import { computeContext } from './context';
import { roundHalfUp } from './analysis';
import { candleReaction, runningTick, patternModule, indicatorModule, keyLevel, otcPattern } from './modules';
import { OTC_RELIABILITY, OTC_DEFAULT_WEIGHTS, getPairWeights, isPairDisabled } from './otc-config';

// ── Constants ────────────────────────────────────────────────────────────────
const EXHAUSTION_STREAK_MIN = 4;
const EXHAUSTION_RARE_STREAK_MIN = 3;
const EXHAUSTION_RARITY_MAX = 0.10;
const LOW_CONF_SKIP_OTC = 30;
const TREND_PENALTY = 15;
const TREND_CAP_STANDARD = 45;
const TREND_CAP_OTC_REVERSAL = 55;

// ── Main prediction function ─────────────────────────────────────────────────
export function predict(
  candles: Candle[],
  asset: string,
  period: number = 60,
  micro: MicroData | null = null,
  htfTrend: string = 'SIDEWAYS',
  recentAccuracy: { n: number; value: number } | null = null,
): PredictionResult {
  const empty: PredictionResult = {
    signal: 'NEUTRAL', confidence: 0, strength: 'WEAK', score: 0, reasons: [],
    regime: 'COLD_START', agree: 0, total: 0, signals_fired: 0, modules: {}, asset, profile: 'default',
  };

  if (candles.length < 3) { empty.reasons = ['INSUFFICIENT_DATA']; return empty; }
  if (isPairDisabled(asset)) { empty.reasons = ['PAIR_DISABLED']; return empty; }

  // Step 1: Compute context
  const ctx = computeContext(candles);

  // Step 2: Run all 6 modules
  const allResults: ModuleResult[] = [
    ...candleReaction(candles, ctx),
    ...runningTick(candles, null, micro, ctx),
    ...patternModule(candles, ctx),
    ...indicatorModule(candles, ctx),
    ...keyLevel(candles, ctx),
    ...otcPattern(candles, ctx, asset),
  ];

  if (allResults.length === 0) { empty.reasons = ['NO_SIGNAL']; empty.regime = ctx.regime.regime; return empty; }

  // Step 3: Collapse BODY+BODY_CONT and WICK+WICK_CONT groups from candle_reaction
  const bodyGroup = allResults.filter(r => r.group === 'BODY' || r.group === 'BODY_CONT');
  const wickGroup = allResults.filter(r => r.group === 'WICK' || r.group === 'WICK_CONT');
  const otherResults = allResults.filter(r => !bodyGroup.includes(r) && !wickGroup.includes(r));

  const collapsedBody = collapseBodyGroup(bodyGroup, 'BODY');
  const collapsedWick = collapseBodyGroup(wickGroup, 'WICK');
  const groupedResults = [...otherResults, ...collapsedBody, ...collapsedWick].filter(r => r !== null);

  // Step 4: Exhaustion gate
  let exhaustionIndicators = 0;
  if (ctx.stats.current_streak >= EXHAUSTION_STREAK_MIN) exhaustionIndicators++;
  if (ctx.stats.streak_rarity < EXHAUSTION_RARITY_MAX && ctx.stats.current_streak >= EXHAUSTION_RARE_STREAK_MIN) exhaustionIndicators++;
  if (micro?.last_velocity && micro.last_velocity.accel < 0.7 && Math.abs(micro.net || 0) > ctx.atr * 0.5) exhaustionIndicators++;
  if (micro && (micro.tick_count || 0) >= 60 && Math.abs(micro.net || 0) < ctx.atr * 0.3) exhaustionIndicators++;
  const isExhausting = exhaustionIndicators >= 3;
  const isStronglyExhausting = exhaustionIndicators >= 4;

  // Step 5: Get pair weights
  const pairWeights = getPairWeights(asset);

  // Step 6: Apply multipliers to each signal
  const effectiveResults: { result: ModuleResult; effective: number; raw: number }[] = [];
  for (const r of groupedResults) {
    // Regime multiplier
    let rMult = 1.0;
    if (ctx.regime.is_volatile) rMult = 0.7;
    else if (ctx.regime.is_ranging) {
      rMult = r.signal_type === 'REVERSAL' ? 1.3 : 0.7;
    } else if (ctx.regime.is_trending) {
      if (r.signal_type === 'CONTINUATION') rMult = 1.3;
      else rMult = isStronglyExhausting ? 1.2 : isExhausting ? 1.0 : 0.8;
    }
    // OTC trend inversion
    if (ctx.regime.is_trending) {
      if (r.signal_type === 'CONTINUATION') rMult *= 0.7;
      else rMult *= 1.3;
    }

    const tMult = OTC_RELIABILITY[r.reliability] || 1.0;
    const pMult = pairWeights[r.module_name] || 1.0;

    // HTF multiplier
    let hMult = 1.0;
    if (htfTrend === 'UPTREND') {
      if (r.direction === 'CALL') hMult = 1.1;
      else hMult = (isExhausting && r.signal_type === 'REVERSAL') ? 1.0 : 0.7;
    } else if (htfTrend === 'DOWNTREND') {
      if (r.direction === 'PUT') hMult = 1.1;
      else hMult = (isExhausting && r.signal_type === 'REVERSAL') ? 1.0 : 0.7;
    }

    const rawProduct = r.score * rMult * tMult * pMult * hMult;
    if (rawProduct < 0.5) continue; // suppress
    const effective = roundHalfUp(rawProduct);
    effectiveResults.push({ result: r, effective, raw: rawProduct });
  }

  if (effectiveResults.length === 0) { empty.reasons = ['ALL_SUPPRESSED']; empty.regime = ctx.regime.regime; return empty; }

  // Step 7: Blend
  let callScore = 0, putScore = 0;
  const callGroups = new Set<string>(), putGroups = new Set<string>();
  let rawCall = 0, rawPut = 0;
  for (const er of effectiveResults) {
    if (er.result.direction === 'CALL') { callScore += er.effective; rawCall += er.result.score; callGroups.add(er.result.group); }
    else if (er.result.direction === 'PUT') { putScore += er.effective; rawPut += er.result.score; putGroups.add(er.result.group); }
  }

  const total = callScore + putScore;
  if (total === 0) { empty.reasons = ['CONFLICTING_SIGNALS']; empty.regime = ctx.regime.regime; return empty; }

  const net = callScore - putScore;
  let signal: Direction;
  let tiebreakerScore = 0;

  if (net === 0) {
    // Tiebreaker by group count
    if (callGroups.size > putGroups.size) { signal = 'CALL'; tiebreakerScore = callScore; }
    else if (putGroups.size > callGroups.size) { signal = 'PUT'; tiebreakerScore = putScore; }
    else { empty.reasons = ['TIE_BREAKER_FAILED']; empty.regime = ctx.regime.regime; return empty; }
  } else {
    signal = net > 0 ? 'CALL' : 'PUT';
  }

  const score = tiebreakerScore || Math.abs(net);
  const majorityGroupN = signal === 'CALL' ? callGroups.size : putGroups.size;
  const totalGroups = new Set(effectiveResults.map(er => er.result.group)).size;
  const suppressedGroups = groupedResults.length - effectiveResults.length;
  const effectiveTotalGroups = totalGroups + 0.5 * suppressedGroups;

  // Step 8: Confidence calibration
  const voteRatio = effectiveTotalGroups > 0 ? majorityGroupN / effectiveTotalGroups : 0;
  const weightRatio = Math.max(rawCall, rawPut) / Math.max(1, rawCall + rawPut);
  const netMargin = Math.abs(net) / total;
  const edgeFactor = 0.5 + 0.5 * netMargin;
  let confidence = roundHalfUp(Math.sqrt(voteRatio * weightRatio * edgeFactor) * 100);

  // Calibration caps
  if (score >= 100) confidence = Math.min(confidence, 50);
  else if (score >= 90) confidence = Math.min(confidence, 55);
  else if (score >= 80) confidence = Math.min(confidence, 60);
  else if (score >= 60) confidence = Math.min(confidence, 60);

  // Ultra-consensus override
  if (Math.abs(net) >= 8 && majorityGroupN >= 4) confidence = Math.min(confidence, 75);

  // Single-group adaptive cap
  if (totalGroups === 1) {
    const rawMajority = signal === 'CALL' ? rawCall : rawPut;
    if (rawMajority >= 6) confidence = Math.min(confidence, 55);
    else if (rawMajority >= 4) confidence = Math.min(confidence, 48);
    else confidence = Math.min(confidence, 42);
  }

  // Sideways+Range dampener
  if (htfTrend === 'SIDEWAYS' && ctx.regime.is_ranging) confidence -= 5;

  // Trend penalty
  if (ctx.regime.is_trending) {
    confidence -= TREND_PENALTY;
    const isOtcReversal = effectiveResults.some(er =>
      er.result.signal_type === 'REVERSAL' && er.result.direction === signal && er.effective > 0
    );
    const trendCap = isOtcReversal ? TREND_CAP_OTC_REVERSAL : TREND_CAP_STANDARD;
    confidence = Math.min(confidence, trendCap);
  }

  // Accuracy self-correction
  if (recentAccuracy && recentAccuracy.n >= 3 && recentAccuracy.value < 0.45) {
    confidence = Math.round(confidence * 0.85);
  } else if (recentAccuracy && recentAccuracy.n >= 30 && recentAccuracy.value > 0.65) {
    confidence = Math.min(100, Math.round(confidence * 1.05));
  }

  // Re-apply >75 cap
  if (!(totalGroups >= 3 && netMargin >= 0.6)) {
    confidence = Math.min(confidence, 75);
  }

  // HTF bonus
  const htfAligned = (htfTrend === 'UPTREND' && signal === 'CALL') || (htfTrend === 'DOWNTREND' && signal === 'PUT');
  if (htfAligned) confidence = Math.min(100, confidence + 5);
  else if (htfTrend === 'UPTREND' || htfTrend === 'DOWNTREND') confidence -= 5;

  // Re-apply trend cap after HTF bonus
  if (ctx.regime.is_trending) {
    const isOtcReversal = effectiveResults.some(er =>
      er.result.signal_type === 'REVERSAL' && er.result.direction === signal && er.effective > 0
    );
    const trendCap = isOtcReversal ? TREND_CAP_OTC_REVERSAL : TREND_CAP_STANDARD;
    confidence = Math.min(confidence, trendCap);
  }

  // Low-confidence skip
  if (confidence < LOW_CONF_SKIP_OTC) {
    empty.regime = ctx.regime.regime;
    empty.reasons = ['LOW_CONFIDENCE'];
    return empty;
  }

  // Step: Strength tiers
  let strength = 'WEAK';
  const hasPatternConfluence = effectiveResults.some(er => er.result.module_name === 'pattern' && er.effective > 0);
  if (confidence >= 65 && Math.abs(net) >= 5 && majorityGroupN >= 2 && hasPatternConfluence) strength = 'STRONG';
  else if (confidence >= 75 && Math.abs(net) >= 8 && majorityGroupN >= 4) strength = 'STRONG';
  else if (confidence >= 50 && Math.abs(net) >= 2) strength = 'MEDIUM';
  else if (Math.abs(net) >= 1) strength = 'WEAK';

  // Build module breakdown
  const modulesBreakdown: PredictionResult['modules'] = {};
  for (const er of effectiveResults) {
    const name = er.result.module_name;
    if (!modulesBreakdown[name] || er.effective > (modulesBreakdown[name].score || 0)) {
      modulesBreakdown[name] = {
        direction: er.result.direction, score: er.effective,
        confidence: er.result.confidence, reasons: er.result.reasons,
      };
    }
  }

  const reasons = effectiveResults
    .filter(er => er.result.direction === signal)
    .flatMap(er => er.result.reasons);

  return {
    signal, confidence, strength, score,
    reasons, regime: ctx.regime.regime, agree: majorityGroupN,
    total: totalGroups, signals_fired: totalGroups,
    modules: modulesBreakdown, asset, profile: 'default',
  };
}

// ── Helper: Collapse body/wick groups ────────────────────────────────────────
function collapseBodyGroup(signals: ModuleResult[], targetGroup: string): ModuleResult[] {
  if (signals.length === 0) return [];
  if (signals.length === 1) return [{ ...signals[0], group: targetGroup }];

  const callSignals = signals.filter(s => s.direction === 'CALL');
  const putSignals = signals.filter(s => s.direction === 'PUT');

  const callSum = callSignals.reduce((a, b) => a + b.score, 0);
  const putSum = putSignals.reduce((a, b) => a + b.score, 0);

  if (callSum === putSum) return []; // tie — no composite

  const winner = callSum > putSum ? callSignals : putSignals;
  const winnerSum = Math.max(callSum, putSum);
  const maxScore = Math.max(...winner.map(s => s.score));
  const agreeN = winner.length;
  const bonus = agreeN >= 3 ? 1 : 0;
  const score = maxScore + bonus;

  const contCount = winner.filter(s => s.signal_type === 'CONTINUATION').length;
  const revCount = winner.filter(s => s.signal_type === 'REVERSAL').length;
  const sigType = contCount > revCount ? 'CONTINUATION' : 'REVERSAL';

  return [{
    module_name: 'candle_reaction',
    direction: winner[0].direction,
    score,
    confidence: Math.min(70, score * 15),
    signal_type: sigType as 'REVERSAL' | 'CONTINUATION',
    reliability: 'CANDLE',
    group: targetGroup,
    reasons: [`Collapsed ${targetGroup}: ${winner.length} signals, score=${score}`],
  }];
}
