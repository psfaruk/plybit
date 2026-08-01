'use client';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowDownCircle, ArrowUpCircle, Circle, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { ENGINE_LABELS, type Signal } from '@/lib/otc/types';
import { cn } from '@/lib/utils';

interface SignalCardProps {
  signal: Signal;
  compact?: boolean;
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatPrice(p: number): string {
  return p >= 100 ? p.toFixed(3) : p.toFixed(5);
}

export function SignalCard({ signal, compact = false }: SignalCardProps) {
  const isCall = signal.signal === 'CALL';
  const isPut = signal.signal === 'PUT';
  const direction = isCall ? 'CALL' : isPut ? 'PUT' : 'NEUTRAL';

  const Icon = isCall ? ArrowUpCircle : isPut ? ArrowDownCircle : Circle;
  const iconColor = isCall ? 'text-emerald-600' : isPut ? 'text-rose-600' : 'text-muted-foreground';

  const ResultIcon =
    signal.result === 'WIN' ? CheckCircle2 :
    signal.result === 'LOSS' ? XCircle :
    Clock;

  const resultColor =
    signal.result === 'WIN' ? 'text-emerald-600 bg-emerald-50 border-emerald-200' :
    signal.result === 'LOSS' ? 'text-rose-600 bg-rose-50 border-rose-200' :
    'text-amber-600 bg-amber-50 border-amber-200';

  return (
    <Card className={cn(
      'overflow-hidden border-l-4 transition-all hover:shadow-md',
      isCall && 'border-l-emerald-500',
      isPut && 'border-l-rose-500',
      !isCall && !isPut && 'border-l-muted',
    )}>
      <div className="p-4 space-y-3">
        {/* header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className={cn('h-5 w-5 shrink-0', iconColor)} />
            <span className="font-semibold text-base truncate">{signal.pair}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Badge variant={isCall ? 'default' : isPut ? 'destructive' : 'secondary'}
              className={cn(
                isCall && 'bg-emerald-600 hover:bg-emerald-700',
                isPut && 'bg-rose-600 hover:bg-rose-700',
              )}>
              {direction}
            </Badge>
            {signal.result !== 'PENDING' && (
              <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded border', resultColor)}>
                <ResultIcon className="h-3 w-3" />
                {signal.result}
              </span>
            )}
          </div>
        </div>

        {/* body */}
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Entry</p>
            <p className="font-mono font-semibold tabular-nums">{formatPrice(signal.entryPrice)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Strength</p>
            <p className={cn(
              'font-semibold tabular-nums',
              signal.strength >= 0.75 ? 'text-emerald-600' :
              signal.strength >= 0.65 ? 'text-amber-600' : 'text-foreground',
            )}>
              {(signal.strength * 100).toFixed(0)}%
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Expiry</p>
            <p className="font-semibold tabular-nums">{signal.expiry / 60}M</p>
          </div>
        </div>

        {/* meta */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{formatTime(signal.timestamp)}</span>
          {signal.resultPrice !== null && (
            <span>Exit: <span className="font-mono">{formatPrice(signal.resultPrice)}</span></span>
          )}
        </div>

        {/* votes */}
        {!compact && signal.modulesVotes && signal.modulesVotes.length > 0 && (
          <div className="border-t pt-2 space-y-1">
            <p className="text-xs text-muted-foreground mb-1">Module votes</p>
            <div className="grid grid-cols-1 gap-1">
              {signal.modulesVotes.map((v) => (
                <div key={v.engine} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={cn(
                      'inline-block w-1.5 h-1.5 rounded-full shrink-0',
                      v.vote === 'CALL' ? 'bg-emerald-500' :
                      v.vote === 'PUT' ? 'bg-rose-500' : 'bg-muted-foreground',
                    )} />
                    <span className="truncate text-foreground">{ENGINE_LABELS[v.engine] || v.engine}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={cn(
                      'font-medium',
                      v.vote === 'CALL' ? 'text-emerald-600' :
                      v.vote === 'PUT' ? 'text-rose-600' : 'text-muted-foreground',
                    )}>
                      {v.vote}
                    </span>
                    <span className="text-muted-foreground tabular-nums w-10 text-right">
                      {(v.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
