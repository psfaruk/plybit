// otc-config.ts — OTC engine configuration
// Ported from Binary-signals-app-main/engines/otc/config.py

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

export const OTC_DISABLED_PAIRS: string[] = [
  'GBPNZD_otc', // 36.4% win rate
  'USDPKR_otc', // 27.3% win rate
  'BRLUSD_otc', // 38.5% win rate
];

export const OTC_PAIR_CONFIGS: Record<string, Record<string, number>> = {
  CADCHF_otc: { candle_reaction: 1.5, running_tick: 1.0, pattern: 1.0, indicator: 1.8, key_level: 1.0, otc_pattern: 1.5 },
  EURNZD_otc: { candle_reaction: 1.0, running_tick: 1.0, pattern: 1.0, indicator: 1.5, key_level: 1.0, otc_pattern: 1.5 },
  NZDUSD_otc: { candle_reaction: 0.5, running_tick: 1.0, pattern: 1.0, indicator: 1.0, key_level: 1.8, otc_pattern: 0.5 },
  USDBDT_otc: { candle_reaction: 0.1, running_tick: 1.0, pattern: 1.8, indicator: 1.0, key_level: 1.5, otc_pattern: 1.0 },
  USDCOP_otc: { candle_reaction: 1.5, running_tick: 1.0, pattern: 0.1, indicator: 1.0, key_level: 1.0, otc_pattern: 1.8 },
  USDIDR_otc: { candle_reaction: 1.0, running_tick: 1.0, pattern: 1.0, indicator: 1.0, key_level: 1.0, otc_pattern: 0.5 },
  USDMXN_otc: { candle_reaction: 0.1, running_tick: 1.0, pattern: 0.5, indicator: 1.0, key_level: 1.5, otc_pattern: 0.1 },
};

export function getPairWeights(asset: string): Record<string, number> {
  // Convert our pair format (EURUSD-OTC) to Quotex format (EURUSD_otc)
  const quotexAsset = asset.replace('-OTC', '_otc').toLowerCase();
  return OTC_PAIR_CONFIGS[quotexAsset] || OTC_DEFAULT_WEIGHTS;
}

export function isPairDisabled(asset: string): boolean {
  const quotexAsset = asset.replace('-OTC', '_otc').toLowerCase();
  return OTC_DISABLED_PAIRS.includes(quotexAsset);
}
