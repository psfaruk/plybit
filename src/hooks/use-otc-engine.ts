'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type {
  Signal, SignalPayload, TickPayload, StatsPayload, TodayStats, EngineVote,
  FeedStatusPayload,
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
  subscribe: (pairs: string[]) => void;
  refreshStats: () => void;
}

const MAX_SIGNALS = 50;

export function useOtcEngine(): UseOtcEngineResult {
  const [connected, setConnected] = useState(false);
  const [pairs, setPairs] = useState<string[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [ticks, setTicks] = useState<Record<string, number>>({});
  const [stats, setStats] = useState<TodayStats | null>(null);
  const [feedStatus, setFeedStatus] = useState<FeedStatusPayload | null>(null);
  const [algorithms, setAlgorithms] = useState<AlgorithmDetection[]>([]);
  const [agentActions, setAgentActions] = useState<AgentAction[]>([]);
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
    const socket = io('/?XTransformPort=3003', {
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
      setAgentActions(prev => [a, ...prev].slice(0, 50));
    });

    // Fetch initial algorithm + agent data on connect
    socket.on('connect', () => {
      socket.emit('algorithm-current', {}, (data: AlgorithmDetection[]) => {
        if (Array.isArray(data)) setAlgorithms(data);
      });
      socket.emit('agent-actions', { limit: 20 }, (data: AgentAction[] | { error: string }) => {
        if (Array.isArray(data)) setAgentActions(data);
      });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [payloadToSignal]);

  const subscribe = useCallback((pairs: string[]) => {
    socketRef.current?.emit('subscribe', { pairs });
  }, []);

  const refreshStats = useCallback(() => {
    socketRef.current?.emit('stats', {}, (s: TodayStats) => {
      if (s) setStats(s);
    });
  }, []);

  return { connected, pairs, signals, ticks, stats, feedStatus, algorithms, agentActions, subscribe, refreshStats };
}
