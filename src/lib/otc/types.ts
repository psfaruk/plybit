// Shared OTC types — mirrors the mini-service types on the client side.

export type SignalDirection = 'CALL' | 'PUT' | 'NEUTRAL';
export type SignalResult = 'WIN' | 'LOSS' | 'PENDING' | 'TIMEOUT';

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface EngineVote {
  engine: string;
  vote: SignalDirection;
  confidence: number;
  weight: number;
  reason: string;
}

export interface Signal {
  id: string;
  pair: string;
  timestamp: number;
  signal: SignalDirection;
  entryPrice: number;
  strength: number;
  expiry: number;
  result: SignalResult;
  resultPrice: number | null;
  modulesVotes: EngineVote[];
}

export interface SignalPayload {
  type: 'SIGNAL';
  id: string;
  pair: string;
  time: number;
  signal: SignalDirection;
  strength: number;
  entry: number;
  expiry: number;
  votes: EngineVote[];
}

export interface TickPayload {
  type: 'TICK';
  pair: string;
  price: number;
  ts: number;
}

export interface StatsPayload {
  type: 'INIT';
  pairs: string[];
  recentSignals: Signal[];
  stats: {
    total: number;
    wins: number;
    losses: number;
    pending: number;
    winRate: number;
  };
  feedStatus?: FeedStatusPayload;
}

export interface FeedStatusPayload {
  mode: 'live' | 'disconnected';
  message: string;
}

export interface TodayStats {
  total: number;
  wins: number;
  losses: number;
  pending: number;
  winRate: number;
  calls?: number;
  puts?: number;
}

export const OTC_PAIRS = [
  'USDBRL-OTC', 'USDPKR-OTC', 'USDBDT-OTC', 'USDPHP-OTC', 'USDCHF-OTC',
  'NZDCHF-OTC', 'NZDCAD-OTC', 'USDARS-OTC', 'USDCOP-OTC', 'USDMXN-OTC',
  'GBPCHF-OTC', 'USDZAR-OTC', 'USDDZD-OTC', 'USDINR-OTC', 'AUDCHF-OTC',
];

export const ENGINE_LABELS: Record<string, string> = {
  MeanReversion: 'Mean Reversion',
  BollingerRSI: 'Bollinger + RSI',
  SupportResistance: 'Support / Resistance',
  VolumeAnomaly: 'Volume Anomaly',
  SessionPattern: 'Session Pattern',
  CandlestickPattern: 'Candlestick Pattern',
};
