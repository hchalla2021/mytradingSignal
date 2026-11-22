const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness(authenticated = true) {
  const calls = [];
  class NextResponse {
    constructor(body, options = {}) { this.body = body; this.status = options.status || 200; }
    static json(body, options = {}) { return new NextResponse(body, options); }
  }
  const source = readFileSync(path.join(__dirname, '..', 'app', 'openingedge-api', '[...path]', 'route.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const context = {
    exports: {}, URL, AbortSignal, TextEncoder,
    process: { env: { BACKEND_API_URL: 'http://backend:8000', OPENINGEDGE_API_URL: 'http://openingedge:8012' } },
    require: name => name === 'next/server' ? { NextResponse } : { getApiUrl: () => '' },
    fetch: async (url, options) => {
      calls.push({ url: String(url), options });
      return String(url).includes('app-access/session')
        ? { ok: true, json: async () => ({ authenticated }) }
        : { status: 200, text: async () => '{"saved":true}' };
    },
  };
  vm.runInNewContext(code, context);
  return { route: context.exports, calls };
}

function request(method, origin = 'https://example.test') {
  return {
    method, nextUrl: { origin: 'https://example.test' },
    headers: new Headers({ origin, cookie: 'app_access_token=example', 'X-Device-Id': 'device', 'X-OpeningEdge-Intent': 'save-configuration' }),
    text: async () => '{"lots":1,"risk":500}',
  };
}

test('configuration write requires same origin and authenticated session', async () => {
  const h = harness();
  const crossOrigin = await h.route.PUT(request('PUT', 'https://other.test'), { params: { path: ['api', 'config', 'NIFTY'] } });
  assert.equal(crossOrigin.status, 403);
  assert.equal(h.calls.length, 0);
  const unauth = harness(false);
  const denied = await unauth.route.PUT(request('PUT'), { params: { path: ['api', 'config', 'NIFTY'] } });
  assert.equal(denied.status, 401);
  assert.equal(unauth.calls.length, 1);
});

test('authenticated configuration writes reach only the independent service', async () => {
  const h = harness();
  const result = await h.route.PUT(request('PUT'), { params: { path: ['api', 'config', 'NIFTY'] } });
  assert.equal(result.status, 200);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].url, 'http://openingedge:8012/api/config/NIFTY');
  assert.equal(h.calls[1].options.headers['Content-Type'], 'application/json');
  assert.equal(h.calls[1].options.headers.Cookie, undefined);
});

test('live trade control uses the dedicated manual intent and reaches only the trade endpoint', async () => {
  const h = harness();
  const live = request('PUT');
  live.headers = new Headers({
    origin: 'https://example.test', cookie: 'app_access_token=example',
    'X-Device-Id': 'device', 'X-OpeningEdge-Intent': 'manual-live-control',
  });

  live.text = async () => '{"enabled":true,"confirmation":"START OPENINGEDGE LIVE TRADING"}';
  const result = await h.route.PUT(live, { params: { path: ['api', 'trade-control'] } });
  assert.equal(result.status, 200);
  assert.equal(h.calls[1].url, 'http://openingedge:8012/api/trade-control');
  assert.equal(h.calls[1].options.headers.Cookie, undefined);
});

test('HTTPS reverse proxy uses the public host and scheme, not the internal Next URL', async () => {
  const h = harness();
  const proxied = request('PUT');
  proxied.nextUrl = { origin: 'http://localhost:3000', protocol: 'http:' };
  proxied.headers.set('host', 'example.test');
  proxied.headers.set('x-forwarded-proto', 'https');
  const result = await h.route.PUT(proxied, { params: { path: ['api', 'config', 'NIFTY'] } });
  assert.equal(result.status, 200);
  assert.equal(h.calls.length, 2);
});

test('proxy origin checks reject foreign origins, invalid schemes and forwarded-host substitution', async () => {
  for (const headers of [
    { origin: 'https://other.test', host: 'example.test', 'x-forwarded-proto': 'https' },
    { origin: 'https://example.test', host: 'example.test', 'x-forwarded-proto': 'https,http' },
    { origin: 'https://other.test', host: 'example.test', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'other.test' },
  ]) {
    const h = harness();
    const proxied = request('PUT');
    proxied.nextUrl = { origin: 'http://localhost:3000', protocol: 'http:' };
    for (const [name, value] of Object.entries(headers)) proxied.headers.set(name, value);
    const result = await h.route.PUT(proxied, { params: { path: ['api', 'config', 'NIFTY'] } });
    assert.equal(result.status, 403);
    assert.equal(h.calls.length, 0);
  }
});
