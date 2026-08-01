// OTC pair configuration — 15 pairs selected by user
// Only these 15 pairs are tracked. Fewer pairs = better data quality + no Quotex rate-limiting.

import type { OtcPairConfig } from './types';

export const OTC_PAIRS: OtcPairConfig[] = [
  { symbol: 'USDBRL-OTC', base: 5.42,   pip: 0.001,  vol: 1.6, drift: 0.0013, quotexAsset: 'BRLUSD_otc', invert: true },
  { symbol: 'USDPKR-OTC', base: 278.50, pip: 0.01,   vol: 1.3, drift: 0.013 },
  { symbol: 'USDBDT-OTC', base: 117.50, pip: 0.01,   vol: 1.2, drift: 0.012 },
  { symbol: 'USDPHP-OTC', base: 56.80,  pip: 0.01,   vol: 1.1, drift: 0.011 },
  { symbol: 'USDCHF-OTC', base: 0.9020, pip: 0.0001, vol: 0.9, drift: 0.0007 },
  { symbol: 'NZDCHF-OTC', base: 0.5520, pip: 0.0001, vol: 0.8, drift: 0.0006 },
  { symbol: 'NZDCAD-OTC', base: 0.8390, pip: 0.0001, vol: 0.9, drift: 0.0007 },
  { symbol: 'USDARS-OTC', base: 1450.0, pip: 0.01,   vol: 1.7, drift: 0.0014 },
  { symbol: 'USDCOP-OTC', base: 4100.0, pip: 0.01,   vol: 1.4, drift: 0.014 },
  { symbol: 'USDMXN-OTC', base: 19.20,  pip: 0.0001, vol: 1.5, drift: 0.0012 },
  { symbol: 'GBPCHF-OTC', base: 1.1390, pip: 0.0001, vol: 1.0, drift: 0.0008 },
  { symbol: 'USDZAR-OTC', base: 18.50,  pip: 0.001,  vol: 1.6, drift: 0.0013 },
  { symbol: 'USDDZD-OTC', base: 134.20, pip: 0.01,   vol: 1.3, drift: 0.013 },
  { symbol: 'USDINR-OTC', base: 83.40,  pip: 0.01,   vol: 1.1, drift: 0.011 },
  { symbol: 'AUDCHF-OTC', base: 0.5940, pip: 0.0001, vol: 0.8, drift: 0.0006 },
];

export const OTC_SYMBOLS = OTC_PAIRS.map(p => p.symbol);

export function getPairConfig(symbol: string): OtcPairConfig | undefined {
  return OTC_PAIRS.find(p => p.symbol === symbol);
}
