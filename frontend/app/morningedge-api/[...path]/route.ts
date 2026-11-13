import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { getApiUrl } from '@/lib/api-config';

export const dynamic = 'force-dynamic';

type RouteContext = { params: { path: string[] } };

const localRuntime = globalThis as typeof globalThis & {
  __morningEdgeChild?: ChildProcess;
  __morningEdgeStart?: Promise<boolean>;
};

async function ensureLocalService(target: URL): Promise<boolean> {
  if (
    process.env.NODE_ENV !== 'development'
    || !['127.0.0.1', 'localhost'].includes(target.hostname)
    || target.port !== '8010'
  ) return false;

  if (localRuntime.__morningEdgeChild && localRuntime.__morningEdgeChild.exitCode === null) return true;
  if (localRuntime.__morningEdgeStart) return localRuntime.__morningEdgeStart;

  const projectRoot = path.resolve(process.cwd(), '..');
  const python = process.env.MORNINGEDGE_PYTHON || path.join(
    projectRoot,
    '.venv',
    process.platform === 'win32' ? 'Scripts' : 'bin',
    process.platform === 'win32' ? 'python.exe' : 'python',
  );
  const serviceDirectory = path.join(projectRoot, 'morningedge');
  if (!existsSync(python) || !existsSync(path.join(serviceDirectory, 'main.py'))) return false;

  localRuntime.__morningEdgeStart = new Promise<boolean>((resolve) => {
    const child = spawn(python, [
      '-m', 'uvicorn', 'main:app', '--app-dir', serviceDirectory,
      '--host', '127.0.0.1', '--port', '8010',
    ], { cwd: projectRoot, stdio: 'ignore', windowsHide: true });
    localRuntime.__morningEdgeChild = child;

    const clearChild = () => {
      if (localRuntime.__morningEdgeChild === child) localRuntime.__morningEdgeChild = undefined;
      localRuntime.__morningEdgeStart = undefined;
    };
    child.once('error', () => {
      clearChild();
      resolve(false);
    });
    child.once('spawn', () => resolve(true));
    child.once('exit', clearChild);
    child.unref();
  });
  return localRuntime.__morningEdgeStart;
}

async function fetchService(
  target: URL,
  request: NextRequest,
  body?: string,
): Promise<Response> {
  const options: RequestInit = {
    method: request.method,
    ...(body ? { body, headers: { 'Content-Type': 'application/json' } } : {}),
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  };
  try {
    return await fetch(target, options);
  } catch (error) {
    if (!await ensureLocalService(target)) throw error;

    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      try {
        return await fetch(target, options);
      } catch {
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    throw new Error('MorningEdge service did not become ready after local startup');
  }
}

async function proxy(request: NextRequest, context: RouteContext) {
  const path = context.params.path.join('/');
  const allowed = (request.method === 'GET' && path === 'api/status')
    || (request.method === 'POST' && path === 'api/feed/control');
  if (!allowed) {
    return NextResponse.json({ detail: 'MorningEdge route not found' }, { status: 404 });
  }
  let body: string | undefined;
  if (request.method === 'POST') {
    const length = Number(request.headers.get('content-length') || 0);
    if (length > 128) return NextResponse.json({ detail: 'Feed control request is too large' }, { status: 413 });
    try {
      const rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).length > 128) {
        return NextResponse.json({ detail: 'Feed control request is too large' }, { status: 413 });
      }
      const parsed = JSON.parse(rawBody) as { enabled?: unknown };
      if (typeof parsed.enabled !== 'boolean' || Object.keys(parsed).some(key => key !== 'enabled')) {
        return NextResponse.json({ detail: 'Expected only a boolean enabled field' }, { status: 400 });
      }
      body = JSON.stringify({ enabled: parsed.enabled });
    } catch {
      return NextResponse.json({ detail: 'Invalid feed control request' }, { status: 400 });
    }
  }

  const baseUrl = process.env.MORNINGEDGE_API_URL || 'http://127.0.0.1:8010';
  let target: URL;
  try {
    target = new URL(path, `${baseUrl.replace(/\/+$/, '')}/`);
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
      return NextResponse.json({ detail: 'MorningEdge service URL is invalid' }, { status: 503 });
    }
  } catch {
    return NextResponse.json({ detail: 'MorningEdge service URL is invalid' }, { status: 503 });
  }

  const sessionBase = process.env.BACKEND_API_URL || getApiUrl() || 'http://127.0.0.1:8000';
  let sessionUrl: URL;
  try {
    sessionUrl = new URL('/api/app-access/session', sessionBase);
  } catch {
    return NextResponse.json({ detail: 'Dashboard authentication service URL is invalid.' }, { status: 503 });
  }
  const sessionHeaders: Record<string, string> = {};
  const cookie = request.headers.get('cookie');
  const deviceId = request.headers.get('X-Device-Id');
  if (cookie) sessionHeaders.Cookie = cookie;
  if (deviceId) sessionHeaders['X-Device-Id'] = deviceId;

  try {
    const session = await fetch(sessionUrl, {
      method: 'GET',
      headers: sessionHeaders,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    const sessionBody = session.ok ? await session.json() as { authenticated?: boolean } : null;
    if (!sessionBody?.authenticated) {
      return NextResponse.json({ detail: 'Sign in to view MorningEdge.' }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ detail: 'Unable to verify your dashboard session.' }, { status: 503 });
  }

  try {
    const response = await fetchService(target, request, body);
    const content = await response.text();
    return new NextResponse(content, {
      status: response.status,
      headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({
      detail: process.env.NODE_ENV === 'development'
        ? 'MorningEdge could not start locally. Check the project .venv has uvicorn and morningedge requirements installed.'
        : 'Standalone MorningEdge service is unreachable. Check that the MorningEdge service is running.',
    }, { status: 503 });
  }
}

export function GET(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export function POST(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}
