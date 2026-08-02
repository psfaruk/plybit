'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { Radio, Wifi, WifiOff, Bell, BellOff, History, Brain, Cpu, Activity, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import Link from 'next/link';
import { useOtcEngine } from '@/hooks/use-otc-engine';
import { StatsBar } from '@/components/otc/StatsBar';
import { SignalCard } from '@/components/otc/SignalCard';
import { LiveChart } from '@/components/otc/LiveChart';
import { EngineWeightsPanel } from '@/components/otc/EngineWeightsPanel';
import { PairSelector } from '@/components/otc/PairSelector';
import { TokenRefreshModal } from '@/components/otc/TokenRefreshModal';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ── Algorithm badge colors ────────────────────────────────────────────────────
const ALGO_COLORS: Record<string, string> = {
  MEAN_REVERT:  'bg-blue-50 text-blue-700 border-blue-200',
  TREND_FOLLOW: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  BREAKOUT:     'bg-amber-50 text-amber-700 border-amber-200',
  SCALPING:     'bg-zinc-50 text-zinc-700 border-zinc-200',
  VOLATILE:     'bg-rose-50 text-rose-700 border-rose-200',
  RANDOM_WALK:  'bg-violet-50 text-violet-700 border-violet-200',
  COLD_START:   'bg-zinc-50 text-zinc-400 border-zinc-200',
};

const SEVERITY_COLORS: Record<string, string> = {
  info:     'bg-blue-50 text-blue-700 border-blue-200',
  warning:  'bg-amber-50 text-amber-700 border-amber-200',
  critical: 'bg-rose-50 text-rose-700 border-rose-200',
};

export default function Home() {
  const {
    connected, pairs, signals, ticks, stats, feedStatus, algorithms, agentActions,
    candlesByPair, fetchCandles,
    getSignalsForPair, getAlgorithmForPair, getAgentActionsForPair,
    refreshStats,
  } = useOtcEngine();

  const [selectedPair, setSelectedPair] = useState<string | null>(null);
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [algoDropdownOpen, setAlgoDropdownOpen] = useState(false);

  // Auto-open token modal when feed disconnects for more than 3s (avoids flicker)
  const isDisconnected = feedStatus?.mode === 'disconnected';
  useEffect(() => {
    if (isDisconnected) {
      const t = setTimeout(() => setTokenModalOpen(true), 3000);
      return () => clearTimeout(t);
    }
  }, [isDisconnected]);
  const [soundOn, setSoundOn] = useState(true);
  const lastBeepedId = useRef<string | null>(null);

  // Derived: effective selected pair falls back to first pair
  const effectivePair = selectedPair ?? (pairs.length > 0 ? pairs[0] : null);

  // ── Pair-filtered data for the UI ──────────────────────────────────────────
  // Only show signals/history/algorithms/agent-actions relevant to the selected pair.
  // Background collection (mini-service) keeps running for ALL pairs — these are
  // just view filters.
  const pairSignals = useMemo(
    () => getSignalsForPair(effectivePair),
    [getSignalsForPair, effectivePair]
  );
  const pairAlgorithm = useMemo(
    () => getAlgorithmForPair(effectivePair),
    [getAlgorithmForPair, effectivePair]
  );
  const pairAgentActions = useMemo(
    () => getAgentActionsForPair(effectivePair),
    [getAgentActionsForPair, effectivePair]
  );

  const activeSignals = useMemo(
    () => pairSignals.filter(s => s.result === 'PENDING'),
    [pairSignals]
  );
  const decidedSignals = useMemo(
    () => pairSignals.filter(s => s.result !== 'PENDING'),
    [pairSignals]
  );

  // Cached candles for the currently-selected pair
  const cachedCandles = effectivePair ? (candlesByPair[effectivePair] || []) : [];

  // Beep on a brand-new top signal (only for the selected pair)
  useEffect(() => {
    if (!soundOn || pairSignals.length === 0) return;
    const top = pairSignals[0];
    if (lastBeepedId.current === top.id) return;
    const ageSec = Math.floor(Date.now() / 1000) - top.timestamp;
    if (ageSec > 4) {
      lastBeepedId.current = top.id;
      return;
    }
    lastBeepedId.current = top.id;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = top.signal === 'CALL' ? 880 : 440;
      osc.connect(ctx.destination);
      osc.start();
      setTimeout(() => { osc.stop(); ctx.close(); }, 220);
    } catch { /* ignore */ }
  }, [pairSignals, soundOn]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-foreground text-background shrink-0">
              <Radio className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold leading-tight truncate">OTC Binary Signals</h1>
              <p className="text-xs text-muted-foreground truncate hidden sm:block">
                {effectivePair
                  ? `${effectivePair.replace('-OTC', '')} · OTC · 5M expiry`
                  : 'Real-time multi-engine analysis · 5M expiry'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSoundOn(s => !s)}
              className="h-8 px-2"
              aria-label={soundOn ? 'Mute alerts' : 'Enable alerts'}
            >
              {soundOn ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
            </Button>
            <Button asChild size="sm" variant="ghost" className="h-8 px-2">
              <Link href="/history" aria-label="Signal history">
                <History className="h-4 w-4" />
              </Link>
            </Button>
            {feedStatus && (
              <div
                className={cn(
                  'hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
                  feedStatus.mode === 'live'
                    ? 'bg-violet-50 text-violet-700 border-violet-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200',
                )}
                title={feedStatus.message}
              >
                {feedStatus.mode === 'live' ? 'Quotex Live' : 'Demo'}
              </div>
            )}
            <div className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
              connected ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200',
            )}>
              {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              <span className="hidden sm:inline">{connected ? 'Connected' : 'Disconnected'}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="container mx-auto px-4 py-4 space-y-4 flex-1">
        {/* Persistent token-expired banner */}
        {isDisconnected && (
          <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-rose-700">
                Live signals are paused — Quotex token expired or mini-service not running.
              </p>
              <p className="text-xs text-rose-600 mt-0.5">
                {feedStatus?.message ?? 'Update the token to resume.'}
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => setTokenModalOpen(true)}
              className="bg-rose-600 hover:bg-rose-700 text-white shrink-0"
            >
              Refresh Token
            </Button>
          </div>
        )}

        <StatsBar stats={stats} activePairs={pairs.length} connected={connected} />

        {/* Pair selector + Chart */}
        <div className="space-y-3">
          <PairSelector
            pairs={pairs}
            ticks={ticks}
            selected={effectivePair}
            onSelect={setSelectedPair}
            feedMode={feedStatus?.mode ?? null}
          />
          <div className="h-[340px] sm:h-[420px] lg:h-[460px]">
            <LiveChart
              key={effectivePair}
              pair={effectivePair}
              ticks={ticks}
              feedMode={feedStatus?.mode ?? null}
              cachedCandles={cachedCandles}
              onRequestCandles={fetchCandles}
            />
          </div>

          {/* Algorithm strip — show the SELECTED pair's algorithm prominently
              and all other pairs as small badges for context */}
          <div className="space-y-2">
            {pairAlgorithm && (
              <div className={cn(
                'rounded-lg border p-3 flex items-center gap-3',
                ALGO_COLORS[pairAlgorithm.algorithm] ?? ALGO_COLORS.COLD_START
              )}>
                <Cpu className="h-5 w-5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium opacity-70">
                    Selected pair · {pairAlgorithm.pair.replace('-OTC', '')}
                  </p>
                  <p className="text-sm font-bold">
                    {pairAlgorithm.algorithm.replace('_', ' ')} · {(pairAlgorithm.confidence * 100).toFixed(0)}% confidence
                  </p>
                  {pairAlgorithm.transitionNote && (
                    <p className="text-[10px] opacity-70 mt-0.5">{pairAlgorithm.transitionNote}</p>
                  )}
                </div>
              </div>
            )}

            {/* All pairs algorithm dropdown — collapsible to save vertical space */}
            {algorithms.length > 0 && (
              <div className="rounded-lg border bg-card/30 overflow-hidden">
                <button
                  onClick={() => setAlgoDropdownOpen(o => !o)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Cpu className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs font-medium text-muted-foreground">
                      All pairs · broker algorithm detection
                    </span>
                    <span className="text-[10px] text-muted-foreground/70">
                      ({algorithms.length} pairs · background)
                    </span>
                  </div>
                  {algoDropdownOpen
                    ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                    : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
                </button>
                {algoDropdownOpen && (
                  <div className="px-3 pb-3 pt-1 border-t">
                    <div className="flex flex-wrap gap-1.5 pt-2">
                      {algorithms.map(a => (
                        <button
                          key={a.pair}
                          onClick={() => { setSelectedPair(a.pair); setAlgoDropdownOpen(false); }}
                          className={cn(
                            'inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium border transition-all hover:scale-105',
                            ALGO_COLORS[a.algorithm] ?? ALGO_COLORS.COLD_START,
                            a.pair === effectivePair && 'ring-2 ring-offset-1 ring-foreground/40'
                          )}
                          title={a.transitionNote}
                        >
                          <span className="opacity-70">{a.pair.replace('-OTC', '')}</span>
                          <span>·</span>
                          <span>{a.algorithm.replace('_', ' ')}</span>
                          <span className="opacity-60">{(a.confidence * 100).toFixed(0)}%</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Tabbed area: Signals | History | Engines | AI Agent — all pair-filtered */}
        <Tabs defaultValue="active" className="w-full">
          <TabsList className="grid w-full max-w-2xl grid-cols-4">
            <TabsTrigger value="active">
              Active ({activeSignals.length})
            </TabsTrigger>
            <TabsTrigger value="history">
              History ({decidedSignals.length})
            </TabsTrigger>
            <TabsTrigger value="engines">
              Engines
            </TabsTrigger>
            <TabsTrigger value="agent">
              <Brain className="h-3 w-3 inline sm:mr-1" />
              AI Agent
            </TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="mt-3">
            {activeSignals.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground border rounded-lg bg-card/30">
                <Radio className="h-8 w-8 mx-auto mb-2 opacity-40" />
                {effectivePair
                  ? `No active signals for ${effectivePair.replace('-OTC', '')}. Engines are scanning in the background.`
                  : 'Waiting for first signal… engines are scanning OTC pairs.'}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {activeSignals.map(s => <SignalCard key={s.id} signal={s} />)}
              </div>
            )}
          </TabsContent>

          <TabsContent value="history" className="mt-3">
            {decidedSignals.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground border rounded-lg bg-card/30">
                {effectivePair
                  ? `No closed signals yet for ${effectivePair.replace('-OTC', '')}. WIN/LOSS results will appear here after the 5-minute expiry.`
                  : 'No closed signals yet. WIN/LOSS results will appear here after the 5-minute expiry.'}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {decidedSignals.map(s => <SignalCard key={s.id} signal={s} compact />)}
                </div>
                <div className="mt-4 text-center">
                  <Button asChild variant="link">
                    <Link href="/history">View full signal history →</Link>
                  </Button>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="engines" className="mt-3">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <EngineWeightsPanel />
                {pairAlgorithm && (
                  <div className="mt-3 rounded-lg border p-3 bg-card/50">
                    <h4 className="text-xs font-semibold mb-2">
                      {effectivePair?.replace('-OTC', '')} · detected algorithm
                    </h4>
                    <div className="space-y-1 text-[11px] text-muted-foreground">
                      <div className="flex justify-between"><span>Algorithm:</span><span className="font-mono">{pairAlgorithm.algorithm}</span></div>
                      <div className="flex justify-between"><span>Confidence:</span><span className="font-mono">{(pairAlgorithm.confidence * 100).toFixed(0)}%</span></div>
                      <div className="flex justify-between"><span>ATR:</span><span className="font-mono">{pairAlgorithm.evidence.atr.toFixed(5)}</span></div>
                      <div className="flex justify-between"><span>Slope:</span><span className="font-mono">{pairAlgorithm.evidence.slope.toFixed(5)}</span></div>
                      <div className="flex justify-between"><span>Body ratio:</span><span className="font-mono">{(pairAlgorithm.evidence.bodyRatio * 100).toFixed(0)}%</span></div>
                      <div className="flex justify-between"><span>Streak:</span><span className="font-mono">{pairAlgorithm.evidence.streak}</span></div>
                    </div>
                  </div>
                )}
              </div>
              <div className="rounded-lg border p-4 bg-card/50">
                <h3 className="text-sm font-semibold mb-2">OTC Success Tips</h3>
                <ul className="space-y-1.5 text-xs text-muted-foreground">
                  <li>• Take trades only when strength ≥ 65%.</li>
                  <li>• Require ≥3 engines to agree (auto-enforced).</li>
                  <li>• Avoid news windows (NFP, FOMC, CPI).</li>
                  <li>• Max 2–3 signals per hour — no overtrading.</li>
                  <li>• Always backtest 1 month before going live.</li>
                </ul>
                <div className="mt-3 pt-3 border-t text-[11px] text-muted-foreground">
                  <p>📊 <span className="font-medium">Background engine status:</span></p>
                  <p className="mt-1">
                    {signals.length} total signals in memory · {algorithms.length}/{pairs.length} pairs with algorithm detection · {agentActions.length} agent actions logged
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="agent" className="mt-3">
            <div className="space-y-3">
              {/* AI Agent status + recent actions */}
              <div className="rounded-lg border bg-gradient-to-br from-violet-50/50 to-blue-50/30 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 text-violet-700 shrink-0">
                    <Brain className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      Embedded AI Agent (GLM 5.2)
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-700 border border-emerald-200">
                        <Activity className="h-2.5 w-2.5" />
                        ACTIVE
                      </span>
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      24/7 analyzer. Runs every 5 minutes, reads DB state, computes per-pair
                      and per-module accuracy, and auto-applies safe fixes.
                      {effectivePair && (
                        <> Showing actions for <span className="font-medium">{effectivePair.replace('-OTC', '')}</span> (and global actions).</>
                      )}
                    </p>
                  </div>
                </div>
              </div>

              {pairAgentActions.length === 0 ? (
                <div className="text-center py-12 text-sm text-muted-foreground border rounded-lg bg-card/30">
                  <Brain className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  {effectivePair
                    ? `No agent actions for ${effectivePair.replace('-OTC', '')} yet. Global analysis runs every 5 minutes.`
                    : 'Agent is warming up — first analysis runs 30 seconds after boot, then every 5 minutes.'}
                </div>
              ) : (
                <div className="space-y-2">
                  {pairAgentActions.map(a => (
                    <div key={a.id} className="rounded-lg border bg-card/50 p-3">
                      <div className="flex items-start gap-2">
                        <span
                          className={cn(
                            'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border shrink-0',
                            SEVERITY_COLORS[a.severity] ?? SEVERITY_COLORS.info,
                          )}
                        >
                          {a.actionType}
                        </span>
                        {a.autoApplied && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-700 border border-emerald-200 shrink-0">
                            AUTO
                          </span>
                        )}
                        <span className="text-xs font-mono text-muted-foreground shrink-0">
                          {a.scope}
                        </span>
                        <span className="text-xs text-muted-foreground ml-auto shrink-0">
                          {new Date(a.timestamp * 1000).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-sm mt-1.5">{a.summary}</p>
                      {a.details && Object.keys(a.details).length > 0 && (
                        <pre className="mt-2 text-[10px] text-muted-foreground bg-muted/30 rounded p-2 overflow-x-auto">
                          {JSON.stringify(a.details, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Token Refresh Modal */}
      <TokenRefreshModal
        open={tokenModalOpen}
        onClose={() => setTokenModalOpen(false)}
        onRefreshed={() => {
          // Refresh stats + give the engine time to reconnect before re-arming
          refreshStats();
        }}
      />

      {/* Footer */}
      <footer className="border-t mt-auto">
        <div className="container mx-auto px-4 py-3 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-2">
          <span>
            OTC Binary Signals ·{' '}
            {feedStatus?.mode === 'live'
              ? <span className="text-violet-600 font-medium">Quotex LIVE feed</span>
              : feedStatus?.mode === 'disconnected'
                ? <span className="text-rose-600 font-medium">⛔ Token expired — waiting for refresh</span>
                : 'Feed status unknown'}
          </span>
          <span>Not financial advice · Trade at your own risk</span>
        </div>
      </footer>
    </div>
  );
}
