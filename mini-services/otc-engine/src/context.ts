// context.ts — Build MarketContext from candle data
// Ported from Binary-signals-app-main/engines/base/context.py

import type { Candle } from './types';
import type { MarketContext, MicroData } from './engine-types';
import {
  computeATR, computeEMA, classifyMarketRegime, findKeyLevels,
  checkLevelConfluence, computeStatisticalEdge,
} from './analysis';

const COLD_START_ATR_FLOOR = 0.0010;
const COLD_START_ATR_FLOOR_JPY = 0.10;

function looksLikeJpy(candles: Candle[]): boolean {
  if (candles.length === 0) return false;
  const sorted = [...candles].map(c => c.close).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted[mid] > 10.0;
}

export function computeContext(candles: Candle[]): MarketContext {
  if (candles.length < 3) {
    const jpy = looksLikeJpy(candles);
    const atrFloor = jpy ? COLD_START_ATR_FLOOR_JPY : COLD_START_ATR_FLOOR;
    return {
      regime: {
        regime: 'COLD_START', trend_strength: 0, volatility_pct: 1.0,
        ema9: 0, ema21: 0, is_trending: false, is_ranging: false, is_volatile: false,
      },
      atr: atrFloor,
      stats: { z_body: 0, z_range: 0, close_percentile: 50, streak_rarity: 0, current_streak: 0, streak_direction: 0 },
      key_levels: [],
      level_confluence: { near_level: false, level_type: null, level_price: null, action: null, distance_atr: 0 },
      ema9: 0, ema21: 0, vol_pct: 1.0,
      closes: candles.map(c => c.close),
    };
  }

  const regime = classifyMarketRegime(candles);
  const atr = computeATR(candles, 20) || (looksLikeJpy(candles) ? COLD_START_ATR_FLOOR_JPY : COLD_START_ATR_FLOOR);
  const stats = computeStatisticalEdge(candles);
  const keyLevels = findKeyLevels(candles);
  const levelConfluence = checkLevelConfluence(candles, keyLevels, atr);
  const closes = candles.map(c => c.close);
  const ema9 = computeEMA(closes, 9);
  const ema21 = computeEMA(closes, 21);
  const atrNow = computeATR(candles, Math.min(10, candles.length));
  const atrHist = computeATR(candles, 20);
  const volPct = atrHist > 0 ? atrNow / atrHist : 1.0;

  return {
    regime, atr, stats, key_levels: keyLevels, level_confluence: levelConfluence,
    ema9, ema21, vol_pct: volPct, closes,
  };
}
