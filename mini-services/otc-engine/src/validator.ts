// Signal Validator — checks pending signals after their expiry elapses
// and marks them WIN / LOSS / TIMEOUT.

import { getCandleAtOrBefore, getPendingSignals, updateSignalResult } from './store';

const TICK_INTERVAL_MS = 15_000;

export function startValidator(): NodeJS.Timeout {
  const tick = () => {
    try {
      const now = Math.floor(Date.now() / 1000);
      const pending = getPendingSignals(now);
      for (const sig of pending) {
        // expiry candle = candle at or just before timestamp + expiry
        const expiryTs = sig.timestamp + sig.expiry;
        const candle = getCandleAtOrBefore(sig.pair, expiryTs);
        if (!candle) continue; // wait until data arrives
        // require the candle to actually be closed (openTime < expiryTs)
        if (candle.time >= expiryTs) continue;

        let result: 'WIN' | 'LOSS';
        if (sig.signal === 'CALL') {
          result = candle.close > sig.entryPrice ? 'WIN' : 'LOSS';
        } else if (sig.signal === 'PUT') {
          result = candle.close < sig.entryPrice ? 'WIN' : 'LOSS';
        } else {
          continue;
        }
        updateSignalResult(sig.id, result, candle.close);
        console.log(`[validator] ${sig.pair} ${sig.signal} → ${result} @ ${candle.close}`);
      }
    } catch (err) {
      console.error('[validator] error', err);
    }
  };
  return setInterval(tick, TICK_INTERVAL_MS);
}
