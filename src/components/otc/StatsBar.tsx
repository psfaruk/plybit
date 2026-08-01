'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Activity, TrendingUp, Trophy, Clock, Target, Percent, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { TodayStats } from '@/lib/otc/types';

interface StatsBarProps {
  stats: TodayStats | null;
  activePairs: number;
  connected: boolean;
}

export function StatsBar({ stats, activePairs, connected }: StatsBarProps) {
  const [expanded, setExpanded] = useState(false);

  const total = stats?.total ?? 0;
  const wins = stats?.wins ?? 0;
  const losses = stats?.losses ?? 0;
  const pending = stats?.pending ?? 0;
  const winRate = stats?.winRate ?? 0;

  const items = [
    { label: "Today's Signals", value: total.toString(), icon: Activity, color: 'text-foreground' },
    { label: 'Win Rate', value: `${(winRate * 100).toFixed(1)}%`, icon: Percent, color: winRate >= 0.6 ? 'text-emerald-600' : winRate >= 0.5 ? 'text-amber-600' : 'text-rose-600' },
    { label: 'Wins', value: wins.toString(), icon: Trophy, color: 'text-emerald-600' },
    { label: 'Losses', value: losses.toString(), icon: TrendingUp, color: 'text-rose-600' },
    { label: 'Pending', value: pending.toString(), icon: Clock, color: 'text-amber-600' },
    { label: 'Active Pairs', value: activePairs.toString(), icon: Target, color: 'text-foreground' },
  ];

  // When collapsed, show only the 2 most important stats (Win Rate + Today's Signals)
  const visibleItems = expanded ? items : items.slice(0, 2);

  return (
    <div>
      <div className={cn(
        'grid gap-2 transition-all',
        expanded
          ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'
          : 'grid-cols-2'
      )}>
        {visibleItems.map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.label} className="p-3 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] sm:text-xs text-muted-foreground truncate">{item.label}</p>
                  <p className={cn('text-lg sm:text-2xl font-bold tabular-nums', item.color)}>{item.value}</p>
                </div>
                <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground shrink-0 mt-1" />
              </div>
            </Card>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-center">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(e => !e)}
          className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1"
        >
          {expanded ? (
            <>Show less <ChevronUp className="h-3 w-3" /></>
          ) : (
            <>Show stats <ChevronDown className="h-3 w-3" /></>
          )}
        </Button>
      </div>
    </div>
  );
}
