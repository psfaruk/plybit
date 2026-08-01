// Smart Blender — combines 6 engine votes into one blended signal
//
// Score = Σ (confidence × weight) per direction.
// Signal fires only if:
//   1. winning side score > losing side score
//   2. winning side score > THRESHOLD (0.55)
//   3. at least MIN_AGREE engines agree on the direction

import type { BlendedSignal, Candle, EngineVote, SignalDirection } from './types';
import { buildEngines, toVote, type Engine } from './engines';

const THRESHOLD = 0.35;
const MIN_AGREE = 3;
const EXPIRY_SEC = 300; // 5 minute binary expiry

export class OTCBlender {
  private engines: Engine[];

  constructor(engines?: Engine[]) {
    this.engines = engines ?? buildEngines();
  }

  blend(pair: string, candles: Candle[]): BlendedSignal {
    const votes: EngineVote[] = this.engines.map(e => {
      const r = e.analyze(candles);
      return toVote(e, r);
    });

    let callScore = 0, putScore = 0;
    let callAgree = 0, putAgree = 0;
    for (const v of votes) {
      if (v.vote === 'CALL') { callScore += v.confidence * v.weight; callAgree++; }
      else if (v.vote === 'PUT') { putScore += v.confidence * v.weight; putAgree++; }
    }

    let signal: SignalDirection = 'NEUTRAL';
    let strength = 0;

    if (callScore > putScore && callScore > THRESHOLD && callAgree >= MIN_AGREE) {
      signal = 'CALL';
      strength = callScore;
    } else if (putScore > callScore && putScore > THRESHOLD && putAgree >= MIN_AGREE) {
      signal = 'PUT';
      strength = putScore;
    }

    return {
      signal,
      strength,
      votes,
      entry: candles[candles.length - 1].close,
      pair,
      timeframe: 60,
      expiry: EXPIRY_SEC,
      timestamp: Math.floor(Date.now() / 1000),
    };
  }

  static get weights(): { name: string; weight: number }[] {
    return buildEngines().map(e => ({ name: e.name, weight: e.weight }));
  }
}
