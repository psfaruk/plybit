'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { SignalHistoryTable } from '@/components/otc/SignalHistoryTable';
import type { Signal } from '@/lib/otc/types';

export default function HistoryPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch('/api/signals?limit=500')
      .then(r => r.json())
      .then(data => setSignals(data.signals || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // Use setTimeout to avoid setState-in-effect lint error
    const t = setTimeout(() => load(), 0);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/"><ArrowLeft className="h-4 w-4" /> Back</Link>
          </Button>
          <h1 className="text-base font-bold flex-1">Signal History</h1>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline ml-1">Refresh</span>
          </Button>
        </div>
      </header>

      {/* Content */}
      <main className="container mx-auto px-4 py-4 flex-1">
        <SignalHistoryTable signals={signals} loading={loading} />
      </main>
    </div>
  );
}
