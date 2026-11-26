import { NextRequest, NextResponse } from 'next/server';
import { getApiUrl } from '@/lib/api-config';

export const dynamic = 'force-dynamic';
type Context = { params: { path: string[] } };

async function proxy(request: NextRequest, context: Context) {
  const path = context.params.path.join('/');
  if (path !== 'api/status') {
    return NextResponse.json({ detail: 'Route not found.' }, { status: 404 });
  }

  let sessionUrl: URL;
  let target: URL;
  try {
    sessionUrl = new URL('/api/app-access/session', process.env.BACKEND_API_URL || getApiUrl() || 'http://127.0.0.1:8000');
    target = new URL(path, `${(process.env.OPENINGEDGE_API_URL || 'http://127.0.0.1:8012').replace(/\/+$/, '')}/`);
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('Invalid URL');
  } catch {
    return NextResponse.json({ detail: 'OpeningEdge service configuration is invalid.' }, { status: 503 });
  }

  const headers: Record<string, string> = {};
  const cookie = request.headers.get('cookie');
  const deviceId = request.headers.get('X-Device-Id');
  if (cookie) headers.Cookie = cookie;
  if (deviceId) headers['X-Device-Id'] = deviceId;
  try {
    const response = await fetch(sessionUrl, {
      headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000),
    });
    const session = response.ok ? await response.json() as { authenticated?: boolean } : null;
    if (!session?.authenticated) return NextResponse.json({ detail: 'Sign in to view global cues.' }, { status: 401 });
  } catch {
    return NextResponse.json({ detail: 'Unable to verify your dashboard session.' }, { status: 503 });
  }

  try {
    const response = await fetch(target, {
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000),
    });
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ detail: 'Global cue service is unavailable.' }, { status: 503 });
  }
}

export const GET = proxy;
