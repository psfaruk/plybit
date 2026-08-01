'use client';

import { Card } from '@/components/ui/card';
import { ENGINE_LABELS } from '@/lib/otc/types';
import { cn } from '@/lib/utils';

const WEIGHTS: { name: string; weight: number }[] = [
  { name: 'MeanReversion', weight: 0.20 },
  { name: 'BollingerRSI', weight: 0.20 },
  { name: 'SupportResistance', weight: 0.20 },
  { name: 'VolumeAnomaly', weight: 0.15 },
  { name: 'SessionPattern', weight: 0.10 },
  { name: 'CandlestickPattern', weight: 0.15 },
];

export function EngineWeightsPanel() {
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold mb-1">Smart Blender Weights</h3>
      <p className="text-xs text-muted-foreground mb-3">
        Final signal fires when ≥3 engines agree AND score &gt; 0.35.
      </p>
      <div className="space-y-2">
        {WEIGHTS.map(w => (
          <div key={w.name} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">{ENGINE_LABELS[w.name] || w.name}</span>
              <span className="tabular-nums text-muted-foreground">{(w.weight * 100).toFixed(0)}%</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full',
                  w.weight >= 0.20 ? 'bg-foreground' : 'bg-muted-foreground/60',
                )}
                style={{ width: `${w.weight * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
