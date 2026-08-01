// GET /api/signals?limit=50&pair=EUR&result=WIN&signal=CALL&reason=overbought&from=123&to=456
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(parseInt(sp.get('limit') || '100', 10), 500);

  // Build filter conditions
  const where: any = {};

  const pair = sp.get('pair');
  if (pair) where.pair = { contains: pair.toUpperCase() };

  const result = sp.get('result');
  if (result) where.result = result.toUpperCase();

  const signal = sp.get('signal');
  if (signal) where.signal = signal.toUpperCase();

  const reasonSearch = sp.get('reason');
  if (reasonSearch) where.modulesVotes = { contains: reasonSearch };

  const from = sp.get('from');
  const to = sp.get('to');
  if (from || to) {
    where.timestamp = {};
    if (from) where.timestamp.gte = parseInt(from, 10);
    if (to) where.timestamp.lte = parseInt(to, 10);
  }

  const rows = await db.signalLog.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: limit,
  });

  return NextResponse.json({
    signals: rows.map(r => ({
      ...r,
      modulesVotes: r.modulesVotes ? JSON.parse(r.modulesVotes) : [],
    })),
  });
}
