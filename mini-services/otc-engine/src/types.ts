// Common types for OTC signals app

export type SignalDirection = 'CALL' | 'PUT' | 'NEUTRAL';
export type SignalResult = 'WIN' | 'LOSS' | 'PENDING' | 'TIMEOUT';

export interface Candle {
  time: number;      // open time, unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Tick {
  pair: string;
  price: number;
  ts: number;        // unix ms
}

export interface EngineVote {
  engine: string;
  vote: SignalDirection;
  confidence: number; // 0..1
  weight: number;     // 0..1
  reason: string;
}

export interface BlendedSignal {
  signal: SignalDirection;
  strength: number;     // 0..1
  votes: EngineVote[];
  entry: number;        // entry price
  pair: string;
  timeframe: number;
  expiry: number;       // seconds
  timestamp: number;    // unix seconds
}

export interface OtcPairConfig {
  symbol: string;       // e.g. "EURUSD-OTC"
  base: number;         // base price ~1.0850
  pip: number;          // price increment per pip
  vol: number;          // per-tick volatility (in pips)
  drift: number;        // gentle mean-reverting drift
  quotexAsset?: string; // override Quotex asset name (e.g. USDBRL-OTC → BRLUSD_otc)
  invert?: boolean;     // if true, invert price (1/price) when displaying
}

export interface ClientOutgoing {
  type: 'SIGNAL' | 'TICK' | 'CANDLE_CLOSE' | 'STATS' | 'RESULT' | 'INIT';
  [k: string]: any;
}
