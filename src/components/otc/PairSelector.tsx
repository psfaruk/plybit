'use client';

import { useState, useRef, useEffect } from 'react';
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
  const scrollYRef = useRef(0);

  // When the popover opens, record the current scroll position. When it closes,
  // restore the scroll position to prevent the page from jumping after the
  // keyboard dismisses on mobile.
  useEffect(() => {
    if (open) {
      scrollYRef.current = window.scrollY;
    } else {
      // On close, restore scroll position (handles keyboard dismiss push-up)
      requestAnimationFrame(() => {
        if (window.scrollY !== scrollYRef.current) {
          window.scrollTo({ top: scrollYRef.current, behavior: 'instant' as ScrollBehavior });
        }
      });
    }
  }, [open]);

  const handleSelect = (pair: string) => {
    onSelect(pair);
    setOpen(false);
    // Blur the active element to dismiss the keyboard immediately
    if (typeof document !== 'undefined') {
      const active = document.activeElement as HTMLElement | null;
      if (active && active.blur) active.blur();
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full sm:w-80 justify-between h-10 font-semibold"
          // Prevent the button from staying focused (which keeps keyboard open on mobile)
          onClick={() => {
            // Use setTimeout to let the popover open first, then focus the search input
            setTimeout(() => {
              const input = document.querySelector('[cmdk-input]') as HTMLInputElement | null;
              if (input) input.focus();
            }, 0);
          }}
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
      <PopoverContent
        className="p-0"
        align="start"
        style={{ width: 'var(--radix-popover-trigger-width)' }}
        // Prevent the popover from causing page scroll on mobile
        onOpenAutoFocus={(e) => {
          // Prevent auto-focus on the trigger button (which would push keyboard)
          // We handle focus manually in the onClick above
          e.preventDefault();
        }}
      >
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
                  onSelect={() => handleSelect(pair)}
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
