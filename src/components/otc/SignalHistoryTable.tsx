'use client';

import { useMemo, useState } from 'react';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { decideReason } from '@/lib/otc/reason';
import type { Signal } from '@/lib/otc/types';

interface Props {
  signals: Signal[];
  loading: boolean;
}

type DirFilter = 'ALL' | 'CALL' | 'PUT' | 'NEUTRAL';
type ResFilter = 'ALL' | 'WIN' | 'LOSS' | 'PENDING' | 'TIMEOUT';

export function SignalHistoryTable({ signals, loading }: Props) {
  const [pairF, setPairF]         = useState('');
  const [dirF, setDirF]           = useState<DirFilter>('ALL');
  const [resF, setResF]           = useState<ResFilter>('ALL');
  const [reasonF, setReasonF]     = useState('');

  const rows = useMemo(() => {
    return signals.filter(s => {
      if (pairF && !s.pair.toLowerCase().includes(pairF.toLowerCase())) return false;
      if (dirF !== 'ALL' && s.signal !== dirF) return false;
      if (resF !== 'ALL' && s.result !== resF) return false;
      if (reasonF) {
        const r = decideReason(s.modulesVotes, s.signal).toLowerCase();
        if (!r.includes(reasonF.toLowerCase())) return false;
      }
      return true;
    });
  }, [signals, pairF, dirF, resF, reasonF]);

  const fmtTime = (ts: number) => {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
           ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[100px]">
                <div className="space-y-1">
                  <span className="text-xs font-semibold">Pair</span>
                  <Input
                    placeholder="Filter…"
                    value={pairF}
                    onChange={e => setPairF(e.target.value)}
                    className="h-7 text-xs"
                  />
                </div>
              </TableHead>
              <TableHead className="min-w-[120px]">
                <span className="text-xs font-semibold">Time</span>
              </TableHead>
              <TableHead className="min-w-[90px]">
                <div className="space-y-1">
                  <span className="text-xs font-semibold">Call/Put</span>
                  <Select value={dirF} onValueChange={v => setDirF(v as DirFilter)}>
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(['ALL', 'CALL', 'PUT', 'NEUTRAL'] as DirFilter[]).map(o => (
                        <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </TableHead>
              <TableHead className="min-w-[90px]">
                <div className="space-y-1">
                  <span className="text-xs font-semibold">Win/Loss</span>
                  <Select value={resF} onValueChange={v => setResF(v as ResFilter)}>
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(['ALL', 'WIN', 'LOSS', 'PENDING', 'TIMEOUT'] as ResFilter[]).map(o => (
                        <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </TableHead>
              <TableHead className="min-w-[150px]">
                <div className="space-y-1">
                  <span className="text-xs font-semibold">Reason</span>
                  <Input
                    placeholder="Filter…"
                    value={reasonF}
                    onChange={e => setReasonF(e.target.value)}
                    className="h-7 text-xs"
                  />
                </div>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && Array.from({ length: 8 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell>
              </TableRow>
            ))}
            {!loading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8 text-sm">
                  No signals match the current filters.
                </TableCell>
              </TableRow>
            )}
            {!loading && rows.map(s => (
              <TableRow key={s.id} className="hover:bg-accent/50">
                <TableCell className="font-medium text-sm">
                  {s.pair.replace('-OTC', '')}
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                  {fmtTime(s.timestamp)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={s.signal === 'CALL' ? 'default' : s.signal === 'PUT' ? 'destructive' : 'secondary'}
                    className={cn(
                      s.signal === 'CALL' && 'bg-emerald-600 hover:bg-emerald-700',
                      s.signal === 'PUT' && 'bg-rose-600 hover:bg-rose-700',
                      'text-[10px]',
                    )}
                  >
                    {s.signal}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className={cn(
                    'text-xs font-semibold',
                    s.result === 'WIN' && 'text-emerald-600',
                    s.result === 'LOSS' && 'text-rose-600',
                    (s.result === 'PENDING' || s.result === 'TIMEOUT') && 'text-amber-600',
                  )}>
                    {s.result}
                  </span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-[250px] truncate" title={decideReason(s.modulesVotes, s.signal)}>
                  {decideReason(s.modulesVotes, s.signal)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="px-3 py-2 text-xs text-muted-foreground border-t flex items-center justify-between">
        <span>{rows.length} of {signals.length} signals</span>
        {(pairF || dirF !== 'ALL' || resF !== 'ALL' || reasonF) && (
          <button
            onClick={() => { setPairF(''); setDirF('ALL'); setResF('ALL'); setReasonF(''); }}
            className="text-xs text-primary hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
