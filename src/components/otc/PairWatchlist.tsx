'use client';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface PairWatchlistProps {
  pairs: string[];
  ticks: Record<string, number>;
  selected: string | null;
  onSelect: (pair: string) => void;
}

function formatPrice(p: number): string {
  if (!p) return '—';
  return p >= 100 ? p.toFixed(3) : p.toFixed(5);
}

export function PairWatchlist({ pairs, ticks, selected, onSelect }: PairWatchlistProps) {
  return (
    <Card className="overflow-hidden">
      <div className="p-3 border-b">
        <h3 className="text-sm font-semibold">OTC Pairs</h3>
        <p className="text-xs text-muted-foreground">Live prices · click to view chart</p>
      </div>
      <div className="divide-y max-h-[480px] overflow-y-auto">
        {pairs.map(pair => {
          const price = ticks[pair] || 0;
          const isSel = pair === selected;
          return (
            <button
              key={pair}
              onClick={() => onSelect(pair)}
              className={cn(
                'w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors hover:bg-accent',
                isSel && 'bg-accent',
              )}
            >
              <span className="font-medium text-sm">{pair.replace('-OTC', '')}</span>
              <span className="font-mono text-sm tabular-nums">{formatPrice(price)}</span>
            </button>
          );
        })}
        {pairs.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground text-center">No pairs subscribed</div>
        )}
      </div>
    </Card>
  );
}
