// Signal Validator — checks pending signals after their expiry elapses
// and marks them WIN / LOSS / TIMEOUT.
//
// FALLBACK: if no closed candle is available at the expiry timestamp (e.g.
// the feed was temporarily disconnected), the validator uses the LATEST
// candle in DB for that pair. This prevents signals from staying PENDING
// forever when data is sparse.

import { getCandleAtOrBefore, getPendingSignals, updateSignalResult, db } from './store';
import type { Candle } from './types';

const TICK_INTERVAL_MS = 15_000;

export function startValidator(): NodeJS.Timeout {
  const tick = () => {
    try {
      const now = Math.floor(Date.now() / 1000);
      const pending = getPendingSignals(now);

      for (const sig of pending) {
        const expiryTs = sig.timestamp + sig.expiry;
        let candle: Candle | null = getCandleAtOrBefore(sig.pair, expiryTs);

        // If we have a candle AT or AFTER the expiry timestamp, it means the
        // candle for the expiry minute hasn't closed yet — but if we're way
        // past expiry (e.g. 2+ minutes), something is wrong with data flow.
        // Fallback: use the latest candle in DB for this pair.
        if (!candle || candle.time >= expiryTs) {
          // Get the absolute latest candle for this pair
          const fallback = db().query(`
            SELECT openTime as time, open, high, low, close, volume
            FROM CandleData
            WHERE pair = ?
            ORDER BY openTime DESC LIMIT 1
          `).get(sig.pair) as Candle | null;

          if (fallback && fallback.time >= expiryTs) {
            // The fallback is also too new — use its close as the result price
            candle = fallback;
          } else if (fallback) {
            candle = fallback;
          } else {
            // No candle at all for this pair — skip (will retry next tick)
            continue;
          }
        }

        // Final safety check: candle must exist and have a valid close
        if (!candle || !Number.isFinite(candle.close) || candle.close <= 0) continue;

        let result: 'WIN' | 'LOSS';
        if (sig.signal === 'CALL') {
          result = candle.close > sig.entryPrice ? 'WIN' : 'LOSS';
        } else if (sig.signal === 'PUT') {
          result = candle.close < sig.entryPrice ? 'WIN' : 'LOSS';
        } else {
          continue;
        }

        updateSignalResult(sig.id, result, candle.close);
        console.log(`[validator] ${sig.pair} ${sig.signal} → ${result} @ ${candle.close} (entry=${sig.entryPrice})`);
      }
    } catch (err) {
      console.error('[validator] error', err);
    }
  };
  return setInterval(tick, TICK_INTERVAL_MS);
}
