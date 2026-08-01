// Next.js API route — proxies token-refresh requests to the mini-service on port 3004.
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token } = body;

    if (!token || typeof token !== 'string' || token.length < 10) {
      return NextResponse.json({ ok: false, error: 'Invalid token' }, { status: 400 });
    }

    const upstream = await fetch('http://localhost:3004/api/token-refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (e: any) {
    console.error('[api/token-refresh] proxy error:', e.message);
    return NextResponse.json(
      { ok: false, error: `Cannot reach engine: ${e.message}` },
      { status: 502 }
    );
  }
}

export async function GET() {
  try {
    const upstream = await fetch('http://localhost:3004/api/status');
    const data = await upstream.json();
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `Cannot reach engine: ${e.message}` },
      { status: 502 }
    );
  }
}
