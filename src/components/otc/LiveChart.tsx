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
}

function fmtPrice(p: number): string {
  if (!p || !Number.isFinite(p)) return '—';
  return p >= 100 ? p.toFixed(3) : p.toFixed(5);
}

const TWEEN_MS = 250;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export function LiveChart({ pair, ticks, feedMode }: LiveChartProps) {
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

  // ── Fetch candle history ───────────────────────────────────────────────────
  const fetchCandles = useCallback((targetPair: string, isFirstLoad: boolean = false) => {
    if (isFirstLoad) {
      setLoading(true);
      setCandles([]);
    }
    fetch(`/api/candles/${encodeURIComponent(targetPair)}?limit=120`)
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

  // ── Chart lifecycle: DESTROY + RECREATE on every pair change ───────────────
  useEffect(() => {
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

    // Use a ref-based flag instead of synchronous setState to avoid lint error.
    // The actual setCandles([]) will happen via the fetch callback.
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
      if (!containerRef.current || !window.LightweightCharts) {
        setTimeout(createChart, 50);
        return;
      }
      // Guard: pair might have changed while waiting
      if (currentPairRef.current !== pair) return;

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
          chartRef.current.applyOptions({
            width: containerRef.current.clientWidth,
            height: containerRef.current.clientHeight,
          });
        }
      });
      ro.observe(containerRef.current);

      // Store cleanup on the chart object
      (chart as any)._cleanup = () => {
        ro.disconnect();
      };

      // Now fetch candle data for this pair (first load — resets candles state)
      fetchCandles(pair, true);
    };
    createChart();

    // Refresh history periodically (NOT first load — just append new candles)
    const refreshId = setInterval(() => {
      if (currentPairRef.current === pair) {
        fetchCandles(pair, false);
      }
    }, 30000);

    return () => {
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
  }, [pair, fetchCandles]);

  // ── RAF animation: smoothly tween the last candle ──────────────────────────
  const rafLoopRef = useRef<(ts: number) => void>(() => {});

  useEffect(() => {
    rafLoopRef.current = (ts: number) => {
      if (!rafActiveRef.current) return;
      if (rafTimeRef.current > 0 && rafOpenRef.current > 0 && seriesRef.current) {
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
      rafIdRef.current = requestAnimationFrame((t) => rafLoopRef.current(t));
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

    const sorted = [...candles].sort((a, b) => a.time - b.time);
    const data = sorted.map(c => ({
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
        const last = sorted[sorted.length - 1];
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
  // KEY FIX: the wick (high/low) is always included in the update —
  // previously only close was animated, so high/low stayed at open until close.
  useEffect(() => {
    if (!seriesRef.current || livePrice <= 0 || candles.length === 0) return;
    if (!historyLoadedRef.current) return;
    if (now === 0) return;

    const lastClosed = candles[candles.length - 1];
    if (!lastClosed) return;

    const currentMinuteBucket = lastClosed.time + 60;
    const nowSec = Math.floor(now / 1000);

    if (nowSec >= currentMinuteBucket) {
      // New candle
      if (!liveCandleRef.current || liveCandleRef.current.time < currentMinuteBucket) {
        const newCandle = {
          time: currentMinuteBucket,
          open: livePrice,
          high: livePrice,
          low: livePrice,
          close: livePrice,
        };
        liveCandleRef.current = newCandle;
        // Immediately add the new candle to the chart (with full OHLC including wick)
        try {
          seriesRef.current.update({
            time: currentMinuteBucket as any,
            open: livePrice,
            high: livePrice,
            low: livePrice,
            close: livePrice,
          });
        } catch {}
      } else if (liveCandleRef.current.time === currentMinuteBucket) {
        // Update the forming candle — INCLUDE high/low so wick is visible
        const updated = {
          time: currentMinuteBucket,
          open: liveCandleRef.current.open,
          high: Math.max(liveCandleRef.current.high, livePrice),
          low: Math.min(liveCandleRef.current.low, livePrice),
          close: livePrice,
        };
        liveCandleRef.current = updated;
        // Tween to the new values (high/low/close all animate)
        startTween(updated);
      }
    } else {
      // Still in the last closed candle's minute — update it with live price
      // This shows the wick forming in real-time on the CURRENT candle
      if (liveCandleRef.current && liveCandleRef.current.time === lastClosed.time) {
        const updated = {
          time: lastClosed.time,
          open: liveCandleRef.current.open,
          high: Math.max(liveCandleRef.current.high, livePrice),
          low: Math.min(liveCandleRef.current.low, livePrice),
          close: livePrice,
        };
        liveCandleRef.current = updated;
        startTween(updated);
      } else {
        // Initialize live candle from the last closed candle
        const newLive = {
          time: lastClosed.time,
          open: lastClosed.open,
          high: Math.max(lastClosed.high, livePrice),
          low: Math.min(lastClosed.low, livePrice),
          close: livePrice,
        };
        liveCandleRef.current = newLive;
        startTween(newLive);
      }
    }
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
        {loading && candles.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm z-10" style={{ color: '#5d606b' }}>
            Loading…
          </div>
        )}
        {candles.length === 0 && !loading && pair && (
          <div className="absolute inset-0 flex items-center justify-center text-sm z-10" style={{ color: '#5d606b' }}>
            Waiting for candles…
          </div>
        )}
      </div>
    </div>
  );
}
