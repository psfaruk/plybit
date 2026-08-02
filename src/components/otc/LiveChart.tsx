'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import type { Candle } from '@/lib/otc/types';

declare global {
  interface Window {
    LightweightCharts: any;
  }
}

interface LiveChartProps {
  pair: string | null;
  ticks: Record<string, number>;
  feedMode?: 'live' | 'disconnected' | null;
  /** Cached candles for this pair (from useOtcEngine.candlesByPair[pair]) */
  cachedCandles?: Candle[];
  /** Called when the chart needs candles for a pair (delegates to the hook) */
  onRequestCandles?: (pair: string) => void;
}

function fmtPrice(p: number): string {
  if (!p || !Number.isFinite(p)) return '—';
  return p >= 100 ? p.toFixed(3) : p.toFixed(5);
}

const TWEEN_MS = 250;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export function LiveChart({ pair, ticks, feedMode, cachedCandles, onRequestCandles }: LiveChartProps) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<any>(null);

  // Refs for all mutable state (avoids re-render churn)
  const candleDataRef = useRef<any[]>([]);
  const liveCandleRef = useRef<any>(null);
  const historyLoadedRef = useRef(false);
  const rafActiveRef = useRef(false);
  const rafIdRef = useRef(0);

  // Tween state
  const rafTimeRef = useRef(0);
  const rafOpenRef = useRef(0);
  const fromCloseRef = useRef(0);
  const fromHighRef = useRef(0);
  const fromLowRef = useRef(0);
  const toCloseRef = useRef(0);
  const toHighRef = useRef(0);
  const toLowRef = useRef(0);
  const tweenStartRef = useRef(0);

  // Track current pair to avoid stale fetches
  const currentPairRef = useRef<string | null>(null);

  const livePrice = pair ? ticks[pair] : 0;

  // ── Tick "now" every second (client-only, starts at 0 to avoid hydration mismatch) ──
  useEffect(() => {
    const t = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearTimeout(t); clearInterval(id); };
  }, []);

  // ── Fetch candle history (REST fallback) ──────────────────────────────────
  // Only used if the upstream socket.io 'history' RPC fails or isn't available.
  // Primary path is via onRequestCandles → cached candles prop.
  const fetchCandles = useCallback((targetPair: string, isFirstLoad: boolean = false) => {
    if (isFirstLoad) {
      setLoading(true);
    }
    fetch(`/api/candles/${encodeURIComponent(targetPair)}?limit=200`)
      .then(r => r.json())
      .then(data => {
        // Guard: if pair changed while fetching, discard
        if (currentPairRef.current !== targetPair) return;
        const newCandles = data.candles || [];
        setCandles(newCandles);
        setLoading(false);
      })
      .catch(() => { setLoading(false); });
  }, []);

  // ── Request candles when pair changes (delegates to hook, which caches) ──
  useEffect(() => {
    if (!pair) return;
    if (onRequestCandles) {
      onRequestCandles(pair);
    }
  }, [pair, onRequestCandles]);

  // ── When cachedCandles prop changes for the current pair, adopt them ─────
  useEffect(() => {
    if (!pair || !cachedCandles) return;
    if (currentPairRef.current !== pair) return;
    // Only adopt if we have no candles yet OR the cached set is newer/larger
    if (candles.length === 0 && cachedCandles.length > 0) {
      setCandles(cachedCandles);
    }
  }, [cachedCandles, pair, candles.length]);

  // ── Chart lifecycle: DESTROY + RECREATE on every pair change ───────────────
  // CRITICAL FIX: track whether this effect is still mounted so async retries
  // (setTimeout for createChart) and RAF loops don't try to update a destroyed
  // chart. Without this, pair switching could crash the chart.
  useEffect(() => {
    let isMounted = true;
    let createChartRetryTimer: ReturnType<typeof setTimeout> | null = null;

    currentPairRef.current = pair;

    // HARD reset everything
    rafActiveRef.current = false;
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    rafTimeRef.current = 0;
    rafOpenRef.current = 0;
    fromCloseRef.current = fromHighRef.current = fromLowRef.current = 0;
    toCloseRef.current = toHighRef.current = toLowRef.current = 0;
    candleDataRef.current = [];
    liveCandleRef.current = null;
    historyLoadedRef.current = false;

    if (!pair) {
      return;
    }

    // Destroy old chart if it exists — this also removes its canvas from the DOM
    if (chartRef.current) {
      try {
        const c = chartRef.current as any;
        if (c._cleanup) c._cleanup();
        c.remove();
      } catch {}
      chartRef.current = null;
      seriesRef.current = null;
    }

    // Create new chart (after a microtask so DOM is clean)
    const createChart = () => {
      if (!isMounted) return;  // pair changed while waiting
      if (!containerRef.current || !window.LightweightCharts) {
        createChartRetryTimer = setTimeout(createChart, 50);
        return;
      }
      // Guard: pair might have changed while waiting
      if (currentPairRef.current !== pair) return;

      try {
        const chart = window.LightweightCharts.createChart(containerRef.current, {
          layout: {
            background: { type: 'solid', color: '#1e222d' },
            textColor: '#787b86',
            fontSize: 11,
          },
          grid: {
            vertLines: { color: 'transparent' },
            horzLines: { color: '#2a2e39' },
          },
          rightPriceScale: {
            borderColor: '#2a2e39',
            scaleMargins: { top: 0.1, bottom: 0.1 },
          },
          timeScale: {
            borderColor: '#2a2e39',
            timeVisible: true,
            secondsVisible: false,
            rightOffset: 3,
            shiftVisibleRangeOnNewBar: false,
          },
          crosshair: {
            mode: 1,
            vertLine: { color: '#5d606b', width: 1, style: 2, labelBackgroundColor: '#363a45' },
            horzLine: { color: '#5d606b', width: 1, style: 2, labelBackgroundColor: '#363a45' },
          },
          handleScroll: true,
          handleScale: true,
        });

        const series = chart.addCandlestickSeries({
          upColor: '#089981',
          downColor: '#f23645',
          borderUpColor: '#089981',
          borderDownColor: '#f23645',
          wickUpColor: '#089981',
          wickDownColor: '#f23645',
        });

        chartRef.current = chart;
        seriesRef.current = series;

        // Resize observer
        const ro = new ResizeObserver(() => {
          if (containerRef.current && chartRef.current) {
            try {
              chartRef.current.applyOptions({
                width: containerRef.current.clientWidth,
                height: containerRef.current.clientHeight,
              });
            } catch {}
          }
        });
        ro.observe(containerRef.current);

        // Store cleanup on the chart object
        (chart as any)._cleanup = () => {
          ro.disconnect();
        };

        // Use cached candles if available (instant pair switching — no refetch).
        // Otherwise, fetch from REST API as fallback.
        if (cachedCandles && cachedCandles.length > 0) {
          setCandles(cachedCandles);
        } else {
          fetchCandles(pair, true);
        }
      } catch (e) {
        console.error('[chart] createChart error:', e);
      }
    };
    createChart();

    // Refresh history periodically from REST (keeps DB-persisted candles fresh).
    const refreshId = setInterval(() => {
      if (isMounted && currentPairRef.current === pair) {
        fetchCandles(pair, false);
      }
    }, 60000);

    return () => {
      isMounted = false;
      if (createChartRetryTimer) clearTimeout(createChartRetryTimer);
      clearInterval(refreshId);
      rafActiveRef.current = false;
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      if (chartRef.current) {
        try {
          const c = chartRef.current as any;
          if (c._cleanup) c._cleanup();
          c.remove();
        } catch {}
        chartRef.current = null;
        seriesRef.current = null;
      }
    };
  }, [pair, fetchCandles, cachedCandles]);

  // ── RAF animation: smoothly tween the last candle ──────────────────────────
  const rafLoopRef = useRef<(ts: number) => void>(() => {});

  useEffect(() => {
    rafLoopRef.current = (ts: number) => {
      if (!rafActiveRef.current) return;
      // Guard: chart/series might have been destroyed by a pair switch.
      // Always re-check before calling seriesRef.current.update().
      if (!seriesRef.current || !chartRef.current) {
        rafActiveRef.current = false;
        return;
      }
      if (rafTimeRef.current > 0 && rafOpenRef.current > 0) {
        const elapsed = ts - tweenStartRef.current;
        const progress = Math.min(elapsed / TWEEN_MS, 1.0);
        const eased = easeOutCubic(progress);

        const curClose = fromCloseRef.current + (toCloseRef.current - fromCloseRef.current) * eased;
        const curHigh  = fromHighRef.current  + (toHighRef.current  - fromHighRef.current)  * eased;
        const curLow   = fromLowRef.current   + (toLowRef.current   - fromLowRef.current)   * eased;

        if (!isFinite(curClose) || !isFinite(curHigh) || !isFinite(curLow)) {
          rafActiveRef.current = false;
          return;
        }

        const safeHigh = Math.max(curHigh, curClose, rafOpenRef.current);
        const safeLow  = Math.min(curLow,  curClose, rafOpenRef.current);
        const safeClose = Math.min(safeHigh, Math.max(safeLow, curClose));

        if (safeHigh > 0 && safeLow > 0 && safeClose > 0) {
          try {
            if (!seriesRef.current) {  // re-check inside try (chart may have been destroyed)
              rafActiveRef.current = false;
              return;
            }
            seriesRef.current.update({
              time: rafTimeRef.current as any,
              open: rafOpenRef.current,
              high: safeHigh,
              low: safeLow,
              close: safeClose,
            });
          } catch {
            rafActiveRef.current = false;
            return;
          }
        }

        if (progress >= 1.0) {
          rafActiveRef.current = false;
          return;
        }
      } else {
        rafActiveRef.current = false;
        return;
      }
      if (rafActiveRef.current) {
        rafIdRef.current = requestAnimationFrame((t) => rafLoopRef.current(t));
      }
    };
  }, []);

  const startTween = useCallback((candle: { time: number; open: number; high: number; low: number; close: number }) => {
    if (!candle || candle.open <= 0 || !candle.time) return;
    if (rafTimeRef.current > 0 && candle.time < rafTimeRef.current) return;

    const isNew = rafTimeRef.current !== candle.time;
    if (isNew) {
      rafTimeRef.current = candle.time;
      rafOpenRef.current = candle.open;
      fromCloseRef.current = candle.open;
      fromHighRef.current = candle.open;
      fromLowRef.current = candle.open;
    } else {
      fromCloseRef.current = toCloseRef.current;
      fromHighRef.current = toHighRef.current;
      fromLowRef.current = toLowRef.current;
    }
    toCloseRef.current = candle.close;
    toHighRef.current = candle.high;
    toLowRef.current = candle.low;
    tweenStartRef.current = performance.now();

    if (!rafActiveRef.current) {
      rafActiveRef.current = true;
      rafIdRef.current = requestAnimationFrame((t) => rafLoopRef.current(t));
    }
  }, []);

  // ── Set candle data when history arrives ───────────────────────────────────
  // This effect runs when candles state changes. If the chart isn't ready yet
  // (seriesRef null), we retry after a short delay.
  //
  // CRITICAL: LightweightCharts requires:
  //   1. Strictly ascending time values (no duplicates)
  //   2. All OHLC values to be finite numbers (no NaN/Infinity)
  //   3. high >= max(open, close) and low <= min(open, close)
  // Without sanitization, certain pairs crash the chart on render.
  useEffect(() => {
    if (candles.length === 0) return;
    if (currentPairRef.current !== pair) return;

    // If chart isn't ready yet, wait and retry
    if (!seriesRef.current) {
      const retryId = setTimeout(() => {
        // Force a state update to re-trigger this effect
        setCandles(prev => [...prev]);
      }, 150);
      return () => clearTimeout(retryId);
    }

    // ── Sanitize candle data ──────────────────────────────────────────────────
    // 1. Filter out invalid OHLC (NaN, Infinity, zero/negative price)
    // 2. Ensure high >= max(open, close, low) and low <= min(open, close, high)
    // 3. Sort ascending by time
    // 4. Dedupe by time (keep last occurrence)
    const seenTimes = new Set<number>();
    const cleaned = candles
      .filter(c => {
        if (!c || typeof c.time !== 'number') return false;
        if (!Number.isFinite(c.time) || c.time <= 0) return false;
        if (!Number.isFinite(c.open) || c.open <= 0) return false;
        if (!Number.isFinite(c.high) || c.high <= 0) return false;
        if (!Number.isFinite(c.low) || c.low <= 0) return false;
        if (!Number.isFinite(c.close) || c.close <= 0) return false;
        return true;
      })
      .map(c => {
        // Enforce OHLC consistency
        const high = Math.max(c.high, c.open, c.close, c.low);
        const low = Math.min(c.low, c.open, c.close, c.high);
        return {
          time: c.time,
          open: c.open,
          high,
          low,
          close: c.close,
        };
      })
      .sort((a, b) => a.time - b.time)
      .filter(c => {
        // Dedupe: keep only the first occurrence of each timestamp
        if (seenTimes.has(c.time)) return false;
        seenTimes.add(c.time);
        return true;
      });

    if (cleaned.length === 0) return;

    const data = cleaned.map(c => ({
      time: c.time as any,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    if (!historyLoadedRef.current) {
      // First load — full setData
      try {
        seriesRef.current.setData(data);
        candleDataRef.current = data;
        historyLoadedRef.current = true;
        chartRef.current?.timeScale().fitContent();

        // Initialize live candle from last closed candle
        const last = data[data.length - 1];
        if (last) {
          liveCandleRef.current = {
            time: last.time,
            open: last.open,
            high: last.high,
            low: last.low,
            close: last.close,
          };
        }
      } catch (e) {
        console.error('[chart] setData error:', e);
      }
    } else {
      // Incremental: append new closed candles via update()
      const lastLocalTime = candleDataRef.current.length > 0
        ? candleDataRef.current[candleDataRef.current.length - 1].time : 0;
      for (const candle of data) {
        if (candle.time > lastLocalTime) {
          try {
            seriesRef.current.update(candle);
            candleDataRef.current.push(candle);
          } catch {}
        }
      }
    }
  }, [candles, pair]);

  // ── Live tick handler: update the forming candle ───────────────────────────
  // This handler is responsible for taking each live tick and turning it into
  // a visual candle update on the chart.
  //
  // KEY INSIGHT: the forming candle must ALWAYS live at the CURRENT minute
  // boundary (Math.floor(nowSec/60)*60), NOT at lastClosed.time + 60.
  // If the DB has stale candles (e.g. from hours ago), using lastClosed.time + 60
  // would create candles at wrong timestamps far off-screen.
  //
  // Cases handled:
  //   A. DB empty + tick arrives → create a forming candle at current minute boundary
  //      AND seed chart with this single candle so the user sees something.
  //   B. DB has stale candles + tick arrives → same as A (forming candle at current minute)
  //   C. DB has fresh candles + tick arrives in same minute → update the forming candle
  //   D. Minute boundary crossed → close previous forming candle, start a new one
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;  // chart may have been destroyed
    if (livePrice <= 0) return;
    if (!Number.isFinite(livePrice)) return;
    if (now === 0) return;
    // Don't gate on candles.length or historyLoadedRef — even with zero candles
    // we must show the live forming candle so the user sees data flowing.

    const nowSec = Math.floor(now / 1000);
    const currentMinuteBucket = Math.floor(nowSec / 60) * 60;

    const lastClosed = candles.length > 0 ? candles[candles.length - 1] : null;
    // Sanitize lastClosed — if it has invalid data, treat as null
    const safeLastClosed = (lastClosed && Number.isFinite(lastClosed.time) && lastClosed.time > 0
      && Number.isFinite(lastClosed.open) && lastClosed.open > 0)
      ? lastClosed : null;

    // If we have NO liveCandleRef yet, or the existing one is from a PREVIOUS
    // minute, we need to start a new forming candle at the current minute boundary.
    if (!liveCandleRef.current || liveCandleRef.current.time < currentMinuteBucket) {
      // If the last DB candle is in the SAME minute as current time, adopt its
      // open/high/low as the seed (so the chart shows continuity with history).
      let seedOpen = livePrice;
      let seedHigh = livePrice;
      let seedLow = livePrice;
      if (safeLastClosed && safeLastClosed.time === currentMinuteBucket) {
        seedOpen = safeLastClosed.open;
        seedHigh = Math.max(safeLastClosed.high, livePrice);
        seedLow = Math.min(safeLastClosed.low, livePrice);
      }

      const newCandle = {
        time: currentMinuteBucket,
        open: seedOpen,
        high: seedHigh,
        low: seedLow,
        close: livePrice,
      };
      liveCandleRef.current = newCandle;

      try {
        seriesRef.current.update({
          time: currentMinuteBucket as any,
          open: seedOpen,
          high: seedHigh,
          low: seedLow,
          close: livePrice,
        });
      } catch {}

      // If historyLoadedRef is false (no DB candles), force a setData() with
      // just this one candle so the chart shows it instead of "Waiting for candles…"
      if (!historyLoadedRef.current) {
        try {
          seriesRef.current.setData([{
            time: currentMinuteBucket as any,
            open: seedOpen,
            high: seedHigh,
            low: seedLow,
            close: livePrice,
          }]);
          historyLoadedRef.current = true;
          candleDataRef.current = [{
            time: currentMinuteBucket,
            open: seedOpen,
            high: seedHigh,
            low: seedLow,
            close: livePrice,
          }];
          chartRef.current?.timeScale().fitContent();
        } catch {}
      }
      return;
    }

    // Same minute as the existing forming candle — update OHLC
    if (liveCandleRef.current.time === currentMinuteBucket) {
      const updated = {
        time: currentMinuteBucket,
        open: liveCandleRef.current.open,
        high: Math.max(liveCandleRef.current.high, livePrice),
        low: Math.min(liveCandleRef.current.low, livePrice),
        close: livePrice,
      };
      liveCandleRef.current = updated;
      startTween(updated);
    }
    // Else: liveCandleRef.current.time > currentMinuteBucket — impossible (clock
    // doesn't go backwards); ignore.
  }, [livePrice, now, candles, startTween]);

  // ── Price change indicator ─────────────────────────────────────────────────
  const prevClose = candles.length >= 2 ? candles[candles.length - 2].close : null;
  const priceChangePct = prevClose && livePrice ? ((livePrice - prevClose) / prevClose) * 100 : null;
  const isPriceUp = (priceChangePct ?? 0) >= 0;
  const secondsRemaining = now > 0 ? 60 - (Math.floor(now / 1000) % 60) : 0;
  const countdownStr = now > 0 ? `${secondsRemaining.toString().padStart(2, '0')}s` : '--s';

  return (
    <div className="overflow-hidden border-0 p-0 h-full flex flex-col rounded-lg" style={{ background: '#1e222d' }}>
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: '#2a2e39' }}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold" style={{ color: '#d1d4dc' }}>
            {pair ? pair.replace('-OTC', '') + ' · OTC' : 'Select a pair'}
          </span>
          {feedMode === 'live' && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold"
                  style={{ background: 'rgba(8,153,129,0.15)', color: '#089981' }}>
              ● LIVE
            </span>
          )}
          <span className="text-[10px]" style={{ color: '#5d606b' }}>1m</span>
          <span className="text-[10px] font-mono" style={{ color: '#2962ff' }}>⏱ {countdownStr}</span>
        </div>
        {livePrice > 0 && (
          <div className="flex items-baseline gap-2">
            <span className="text-base font-mono font-bold tabular-nums" style={{ color: '#d1d4dc' }}>
              {fmtPrice(livePrice)}
            </span>
            {priceChangePct !== null && (
              <span className="text-[11px] font-mono tabular-nums font-semibold"
                    style={{ color: isPriceUp ? '#089981' : '#f23645' }}>
                {isPriceUp ? '▲' : '▼'} {Math.abs(priceChangePct).toFixed(2)}%
              </span>
            )}
          </div>
        )}
      </div>

      <div ref={containerRef} className="flex-1 relative min-h-[280px]" style={{ background: '#1e222d' }}>
        {loading && candles.length === 0 && livePrice <= 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm z-10" style={{ color: '#5d606b' }}>
            Loading…
          </div>
        )}
        {candles.length === 0 && !loading && pair && livePrice <= 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm z-10" style={{ color: '#5d606b' }}>
            Waiting for live ticks…
          </div>
        )}
      </div>
    </div>
  );
}
