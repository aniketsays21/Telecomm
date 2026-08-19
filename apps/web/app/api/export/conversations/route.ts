import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Forward all query params to the API
  const qs = req.nextUrl.searchParams.toString();
  const upstream = await fetch(`${API}/inbox/conversations/export${qs ? `?${qs}` : ''}`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });

  if (!upstream.ok) {
    return NextResponse.json({ error: 'Export failed' }, { status: upstream.status });
  }

  const csv = await upstream.text();
  const filename = upstream.headers.get('Content-Disposition') ?? 'attachment; filename="conversations.csv"';

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': filename,
    },
  });
}
