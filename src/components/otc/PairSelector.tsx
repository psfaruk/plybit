'use client';

import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PairSelectorProps {
  pairs: string[];
  ticks: Record<string, number>;
  selected: string | null;
  onSelect: (pair: string) => void;
  feedMode?: 'live' | 'disconnected' | null;
}

function fmt(p: number): string {
  if (!p || !Number.isFinite(p)) return '—';
  return p >= 100 ? p.toFixed(3) : p.toFixed(5);
}

export function PairSelector({ pairs, ticks, selected, onSelect, feedMode }: PairSelectorProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full sm:w-80 justify-between h-10 font-semibold"
        >
          <span className="flex items-center gap-2 min-w-0">
            {selected ? (
              <>
                <span className="truncate">{selected.replace('-OTC', '')}</span>
                <span className="text-xs text-muted-foreground">· OTC</span>
              </>
            ) : (
              'Select pair…'
            )}
            {feedMode === 'live' && (
              <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-600 shrink-0">
                LIVE
              </span>
            )}
          </span>
          <span className="flex items-center gap-2 shrink-0">
            {selected && (
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {fmt(ticks[selected] || 0)}
              </span>
            )}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0" align="start" style={{ width: 'var(--radix-popover-trigger-width)' }}>
        <Command filter={(value, search) =>
          value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
        }>
          <CommandInput placeholder="Search pair (e.g. EUR, GBP, JPY)…" />
          <CommandList className="max-h-[300px]">
            <CommandEmpty>No pair found.</CommandEmpty>
            <CommandGroup>
              {pairs.map(pair => (
                <CommandItem
                  key={pair}
                  value={pair}
                  onSelect={() => { onSelect(pair); setOpen(false); }}
                  className="gap-2"
                >
                  <Check className={cn('h-4 w-4', selected === pair ? 'opacity-100' : 'opacity-0')} />
                  <span className="flex-1 font-medium">{pair.replace('-OTC', '')}</span>
                  <span className="text-xs text-muted-foreground">OTC</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground w-20 text-right">
                    {fmt(ticks[pair] || 0)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
