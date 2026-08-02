// otc-config.ts — OTC engine configuration
// Ported from Binary-signals-app-main/engines/otc/config.py
//
// Phase 1 fix: weights now come from DB (EngineWeights table, managed by AI
// agent). Falls back to hardcoded OTC_PAIR_CONFIGS / OTC_DEFAULT_WEIGHTS when
// no DB row exists for a pair. The AI agent can now ACTUALLY change weights.

import { getEngineWeights } from './store';

export const OTC_RELIABILITY: Record<string, number> = {
  PATTERN: 1.5,
  LEVEL: 1.2,
  TREND: 1.0,
  INDICATOR: 1.0,
  CANDLE: 0.9,
  MICRO: 0.6,
  OTC: 1.3,
};

export const OTC_DEFAULT_WEIGHTS: Record<string, number> = {
  candle_reaction: 0.9,
  running_tick: 1.0,
  pattern: 1.3,
  indicator: 1.0,
  key_level: 1.1,
  otc_pattern: 1.3,
};

// OTC_DISABLED_PAIRS is no longer used — pairs are never disabled.
// (User requirement: signals must always be generated.)
export const OTC_DISABLED_PAIRS: string[] = [];

export const OTC_PAIR_CONFIGS: Record<string, Record<string, number>> = {
  CADCHF_otc: { candle_reaction: 1.5, running_tick: 1.0, pattern: 1.0, indicator: 1.8, key_level: 1.0, otc_pattern: 1.5 },
  EURNZD_otc: { candle_reaction: 1.0, running_tick: 1.0, pattern: 1.0, indicator: 1.5, key_level: 1.0, otc_pattern: 1.5 },
  NZDUSD_otc: { candle_reaction: 0.5, running_tick: 1.0, pattern: 1.0, indicator: 1.0, key_level: 1.8, otc_pattern: 0.5 },
  USDBDT_otc: { candle_reaction: 0.1, running_tick: 1.0, pattern: 1.8, indicator: 1.0, key_level: 1.5, otc_pattern: 1.0 },
  USDCOP_otc: { candle_reaction: 1.5, running_tick: 1.0, pattern: 0.1, indicator: 1.0, key_level: 1.0, otc_pattern: 1.8 },
  USDIDR_otc: { candle_reaction: 1.0, running_tick: 1.0, pattern: 1.0, indicator: 1.0, key_level: 1.0, otc_pattern: 0.5 },
  USDMXN_otc: { candle_reaction: 0.1, running_tick: 1.0, pattern: 0.5, indicator: 1.0, key_level: 1.5, otc_pattern: 0.1 },
};

// In-memory cache of DB weights to avoid hitting DB on every prediction call.
// Cache is invalidated when the AI agent updates a weight (via clearWeightCache()).
let _weightCache = new Map<string, Record<string, number> | null>();
let _cacheTimestamp = 0;
const CACHE_TTL_MS = 30_000; // 30 seconds

export function clearWeightCache(): void {
  _weightCache.clear();
  _cacheTimestamp = 0;
}

export function getPairWeights(asset: string): Record<string, number> {
  // Check cache first (avoid DB hit on hot path)
  const now = Date.now();
  if (now - _cacheTimestamp > CACHE_TTL_MS) {
    _weightCache.clear();
    _cacheTimestamp = now;
  }

  if (_weightCache.has(asset)) {
    const cached = _weightCache.get(asset);
    if (cached) return cached;
  }

  // Try DB first (AI agent managed weights take priority)
  try {
    const dbWeights = getEngineWeights(asset);
    if (dbWeights && Object.keys(dbWeights).length > 0) {
      _weightCache.set(asset, dbWeights);
      return dbWeights;
    }
  } catch {
    // DB not available yet (during boot) — fall through to hardcoded
  }

  // Fall back to hardcoded per-pair config, then default weights
  const quotexAsset = asset.replace('-OTC', '_otc').toLowerCase();
  const hardcoded = OTC_PAIR_CONFIGS[quotexAsset] || OTC_DEFAULT_WEIGHTS;
  _weightCache.set(asset, hardcoded);
  return hardcoded;
}

export function isPairDisabled(_asset: string): boolean {
  // Signals are NEVER disabled (per user requirement).
  // Cooldowns are handled separately in the signal generator, but they only
  // MARK signals — they don't block them.
  return false;
}
