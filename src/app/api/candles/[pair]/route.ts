// GET /api/candles/[pair]?limit=200
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ pair: string }> }) {
  const { pair: rawPair } = await params;
  const pair = decodeURIComponent(rawPair);
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '200', 10), 500);

  const rows = await db.candleData.findMany({
    where: { pair, timeframe: 60 },
    orderBy: { openTime: 'asc' },
    take: limit,
  });
  return NextResponse.json({
    pair,
    timeframe: 60,
    candles: rows.map(r => ({
      time: r.openTime,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
    })),
  });
}
