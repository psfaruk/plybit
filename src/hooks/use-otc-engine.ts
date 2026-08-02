'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { io, Socket } from 'socket.io-client';
import type {
  Signal, SignalPayload, TickPayload, StatsPayload, TodayStats, EngineVote,
  FeedStatusPayload, Candle,
} from '@/lib/otc/types';

function safeParseVotes(raw: string): EngineVote[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ── Algorithm Detection types ────────────────────────────────────────────────
export interface AlgorithmDetection {
  pair: string;
  algorithm: string;
  prevAlgorithm: string | null;
  confidence: number;
  evidence: {
    atr: number;
    atrRatio: number;
    slope: number;
    slopeStrength: number;
    bodyRatio: number;
    rangeRatio: number;
    streak: number;
    autocorr: number;
  };
  transitionNote: string;
  timestamp: number;
}

// ── AI Agent Action types ────────────────────────────────────────────────────
export interface AgentAction {
  id: string;
  timestamp: number;
  actionType: 'ANALYZE' | 'ADJUST_WEIGHT' | 'DISABLE_PAIR' | 'ALERT' | 'INSIGHT' | 'FIX_APPLIED';
  scope: string;
  summary: string;
  details: any;
  severity: 'info' | 'warning' | 'critical';
  autoApplied: boolean;
}

interface UseOtcEngineResult {
  connected: boolean;
  pairs: string[];
  signals: Signal[];
  ticks: Record<string, number>;
  stats: TodayStats | null;
  feedStatus: FeedStatusPayload | null;
  algorithms: AlgorithmDetection[];
  agentActions: AgentAction[];
  /** Per-pair candle cache — filled lazily as pairs are viewed */
  candlesByPair: Record<string, Candle[]>;
  /** Request candle history for a pair from upstream (cached after first fetch) */
  fetchCandles: (pair: string) => void;
  /** Filter signals by pair */
  getSignalsForPair: (pair: string | null) => Signal[];
  /** Filter algorithm detections by pair */
  getAlgorithmForPair: (pair: string | null) => AlgorithmDetection | null;
  /** Filter agent actions by pair (or return all if pair is null) */
  getAgentActionsForPair: (pair: string | null) => AgentAction[];
  subscribe: (pairs: string[]) => void;
  refreshStats: () => void;
}

const MAX_SIGNALS = 200; // increased so we have enough after pair-filtering

export function useOtcEngine(): UseOtcEngineResult {
  const [connected, setConnected] = useState(false);
  const [pairs, setPairs] = useState<string[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [ticks, setTicks] = useState<Record<string, number>>({});
  const [stats, setStats] = useState<TodayStats | null>(null);
  const [feedStatus, setFeedStatus] = useState<FeedStatusPayload | null>(null);
  const [algorithms, setAlgorithms] = useState<AlgorithmDetection[]>([]);
  const [agentActions, setAgentActions] = useState<AgentAction[]>([]);
  // Per-pair candle cache — keeps the last fetched candles so pair switching is instant.
  const [candlesByPair, setCandlesByPair] = useState<Record<string, Candle[]>>({});
  const socketRef = useRef<Socket | null>(null);

  const payloadToSignal = useCallback((p: SignalPayload): Signal => ({
    id: p.id,
    pair: p.pair,
    timestamp: p.time,
    signal: p.signal,
    entryPrice: p.entry,
    strength: p.strength,
    expiry: p.expiry,
    result: 'PENDING',
    resultPrice: null,
    modulesVotes: p.votes,
  }), []);

  useEffect(() => {
    const socket = io({
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1500,
      timeout: 10000,
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (err: any) => console.error('[otc] connect_error', err.message));

    socket.on('INIT', (data: StatsPayload) => {
      setPairs(data.pairs || []);
      const normalized = (data.recentSignals || []).map(s => ({
        ...s,
        modulesVotes: typeof s.modulesVotes === 'string'
          ? safeParseVotes(s.modulesVotes)
          : (s.modulesVotes || []),
      }));
      setSignals(normalized);
      setStats(data.stats || null);
      setFeedStatus(data.feedStatus || null);
      setTicks(prev => {
        const next = { ...prev };
        for (const p of data.pairs || []) if (!(p in next)) next[p] = 0;
        return next;
      });
    });

    socket.on('FEED_STATUS', (s: FeedStatusPayload) => {
      setFeedStatus(s);
    });

    socket.on('SIGNAL', (p: SignalPayload) => {
      setSignals(prev => {
        const next = [payloadToSignal(p), ...prev];
        return next.slice(0, MAX_SIGNALS);
      });
    });

    socket.on('TICK', (t: TickPayload) => {
      setTicks(prev => ({ ...prev, [t.pair]: t.price }));
    });

    // ── Algorithm Detection events ──────────────────────────────────────────
    socket.on('ALGORITHM_CHANGE', (d: AlgorithmDetection) => {
      setAlgorithms(prev => {
        const filtered = prev.filter(p => p.pair !== d.pair);
        return [d, ...filtered];
      });
    });

    // ── AI Agent events ──────────────────────────────────────────────────────
    socket.on('AGENT_ACTION', (a: AgentAction) => {
      setAgentActions(prev => [a, ...prev].slice(0, 100));
    });

    // Fetch initial algorithm + agent data on connect
    socket.on('connect', () => {
      socket.emit('algorithm-current', {}, (data: AlgorithmDetection[]) => {
        if (Array.isArray(data)) setAlgorithms(data);
      });
      socket.emit('agent-actions', { limit: 50 }, (data: AgentAction[] | { error: string }) => {
        if (Array.isArray(data)) setAgentActions(data);
      });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [payloadToSignal]);

  // ── Fetch candles for a pair (cached in candlesByPair) ─────────────────────
  // This asks the upstream mini-service for its live in-memory history (200 most
  // recent candles) so the chart can render instantly without re-fetching every
  // time the user switches pairs. The cache is never invalidated — new ticks
  // update the forming candle via the TICK event handler in LiveChart.tsx.
  const fetchCandles = useCallback((pair: string) => {
    if (!pair) return;
    // Already cached — skip
    if (candlesByPair[pair]) return;
    const sock = socketRef.current;
    if (!sock) return;

    // Reserve the slot immediately so concurrent calls don't double-fetch
    setCandlesByPair(prev => ({ ...prev, [pair]: [] }));

    try {
      sock.emit('history', { pair }, (candles: Candle[] | { error: string }) => {
        if (Array.isArray(candles)) {
          setCandlesByPair(prev => ({ ...prev, [pair]: candles }));
        } else {
          // On error, fall back to REST API
          fetch(`/api/candles/${encodeURIComponent(pair)}?limit=200`)
            .then(r => r.json())
            .then(data => {
              const cs = data.candles || [];
              setCandlesByPair(prev => ({ ...prev, [pair]: cs }));
            })
            .catch(() => {
              setCandlesByPair(prev => ({ ...prev, [pair]: [] }));
            });
        }
      });
    } catch {
      // Fallback to REST API
      fetch(`/api/candles/${encodeURIComponent(pair)}?limit=200`)
        .then(r => r.json())
        .then(data => {
          const cs = data.candles || [];
          setCandlesByPair(prev => ({ ...prev, [pair]: cs }));
        })
        .catch(() => {});
    }
  }, [candlesByPair]);

  // ── Pair-filtered selectors ────────────────────────────────────────────────
  // These are memoized so they only recompute when the underlying data OR the
  // selected pair changes.

  const getSignalsForPair = useCallback((pair: string | null): Signal[] => {
    if (!pair) return signals;
    return signals.filter(s => s.pair === pair);
  }, [signals]);

  const getAlgorithmForPair = useCallback((pair: string | null): AlgorithmDetection | null => {
    if (!pair) return null;
    return algorithms.find(a => a.pair === pair) || null;
  }, [algorithms]);

  const getAgentActionsForPair = useCallback((pair: string | null): AgentAction[] => {
    if (!pair) {
      // No pair selected → show global-scope actions only
      return agentActions.filter(a =>
        a.scope === 'GLOBAL' || a.scope === 'global' || !a.scope.includes(':')
      );
    }
    // Show global actions + actions for this pair
    const pairScope = `PAIR:${pair}`;
    const moduleScopePrefix = 'MODULE:';
    return agentActions.filter(a =>
      a.scope === 'GLOBAL' ||
      a.scope === 'global' ||
      a.scope === pairScope ||
      a.scope.includes(pairScope) ||
      a.scope.startsWith(moduleScopePrefix) // module-level actions affect all pairs
    );
  }, [agentActions]);

  const subscribe = useCallback((pairs: string[]) => {
    socketRef.current?.emit('subscribe', { pairs });
  }, []);

  const refreshStats = useCallback(() => {
    socketRef.current?.emit('stats', {}, (s: TodayStats) => {
      if (s) setStats(s);
    });
  }, []);

  return {
    connected,
    pairs,
    signals,
    ticks,
    stats,
    feedStatus,
    algorithms,
    agentActions,
    candlesByPair,
    fetchCandles,
    getSignalsForPair,
    getAlgorithmForPair,
    getAgentActionsForPair,
    subscribe,
    refreshStats,
  };
}
