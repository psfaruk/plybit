// engine-types.ts — Types for the OTC prediction engine
// Ported from Binary-signals-app-main/engines/base/types.py

export type Direction = 'CALL' | 'PUT' | 'NEUTRAL';
export type SignalType = 'REVERSAL' | 'CONTINUATION';
export type Reliability = 'PATTERN' | 'LEVEL' | 'CANDLE' | 'MICRO' | 'INDICATOR' | 'OTC' | 'TREND';

export interface ModuleResult {
  module_name: string;
  direction: Direction;
  score: number;
  confidence: number;
  signal_type: SignalType;
  reliability: Reliability;
  group: string;
  reasons: string[];
}

export interface MarketContext {
  regime: {
    regime: string;
    trend_strength: number;
    volatility_pct: number;
    ema9: number;
    ema21: number;
    is_trending: boolean;
    is_ranging: boolean;
    is_volatile: boolean;
  };
  atr: number;
  stats: {
    z_body: number;
    z_range: number;
    close_percentile: number;
    streak_rarity: number;
    current_streak: number;
    streak_direction: number;
  };
  key_levels: { price: number; type: 'resistance' | 'support'; idx: number }[];
  level_confluence: {
    near_level: boolean;
    level_type: string | null;
    level_price: number | null;
    action: string | null;
    distance_atr: number;
  };
  ema9: number;
  ema21: number;
  vol_pct: number;
  closes: number[];
}

export interface PredictionResult {
  signal: Direction;
  confidence: number;
  strength: string;
  score: number;
  reasons: string[];
  regime: string;
  agree: number;
  total: number;
  signals_fired: number;
  modules: Record<string, { direction: Direction; score: number; confidence: number; reasons: string[] }>;
  asset: string;
  profile: string;
}

export interface MicroData {
  ending_direction?: { direction: string; dominance: string; buy_pct: number };
  buy_pct?: number;
  pressure?: string;
  reaction?: string;
  orderflow?: { imbalance: number; big_dir: string; big_buy_pct: number };
  vap_migration?: { dir: string; pct: number };
  v_shape?: string;
  momentum_shift?: string;
  last_velocity?: { accel: number; dir5: string; dir10: string; spd5: number };
  live_wick?: { type: string; lw_ratio: number; uw_ratio: number };
  td_buy_pct?: number;
  td_diverge?: boolean;
  last_react?: string;
  net?: number;
  phases?: string[];
  tick_count?: number;
}
