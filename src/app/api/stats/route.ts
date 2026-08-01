// GET /api/stats — today's stats
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const startTs = Math.floor(startOfDay.getTime() / 1000);

  const rows = await db.signalLog.findMany({
    where: { timestamp: { gte: startTs } },
    select: { result: true, signal: true },
  });
  const total = rows.length;
  const wins = rows.filter(r => r.result === 'WIN').length;
  const losses = rows.filter(r => r.result === 'LOSS').length;
  const pending = rows.filter(r => r.result === 'PENDING').length;
  const decided = wins + losses;
  const calls = rows.filter(r => r.signal === 'CALL').length;
  const puts = rows.filter(r => r.signal === 'PUT').length;

  return NextResponse.json({
    total,
    wins,
    losses,
    pending,
    winRate: decided ? wins / decided : 0,
    calls,
    puts,
  });
}
