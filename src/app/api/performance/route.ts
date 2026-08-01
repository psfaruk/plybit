// GET /api/performance — per-pair aggregated stats
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  // group by pair using Prisma
  const all = await db.performance.findMany();
  const byPair = new Map<string, { pair: string; total: number; wins: number; losses: number }>();
  for (const p of all) {
    const cur = byPair.get(p.pair) || { pair: p.pair, total: 0, wins: 0, losses: 0 };
    cur.total += p.totalSignals;
    cur.wins += p.winCount;
    cur.losses += p.lossCount;
    byPair.set(p.pair, cur);
  }
  const out = Array.from(byPair.values())
    .map(r => ({
      pair: r.pair,
      totalSignals: r.total,
      winCount: r.wins,
      lossCount: r.losses,
      winRate: r.total ? r.wins / r.total : 0,
    }))
    .sort((a, b) => b.winRate - a.winRate);
  return NextResponse.json({ performance: out });
}
