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
    exports: {}, URL, AbortSignal,
    process: { env: { BACKEND_API_URL: 'http://backend:8000', OPENINGEDGE_API_URL: 'http://openingedge:8012' } },
    require: name => name === 'next/server' ? { NextResponse } : { getApiUrl: () => '' },
    fetch: async (url) => {
      calls.push(String(url));
      return String(url).includes('app-access/session')
        ? { ok: true, json: async () => ({ authenticated }) }
        : { status: 200, text: async () => '{"zerodha_session":true,"context":{}}' };
    },
  };
  vm.runInNewContext(code, context);
  return { route: context.exports, calls };
}

function request() {
  return {
    method: 'GET', nextUrl: { origin: 'https://example.test' },
    headers: new Headers({ cookie: 'app_access_token=example', 'X-Device-Id': 'device' }),
  };
}

test('global cue proxy serves only authenticated status reads', async () => {
  const h = harness();
  const response = await h.route.GET(request(), { params: { path: ['api', 'status'] } });
  assert.equal(response.status, 200);
  assert.deepEqual(h.calls, [
    'http://backend:8000/api/app-access/session',
    'http://openingedge:8012/api/status',
  ]);
});

test('global cue proxy rejects unauthenticated and unknown routes', async () => {
  const unauth = harness(false);
  assert.equal((await unauth.route.GET(request(), { params: { path: ['api', 'status'] } })).status, 401);
  const h = harness();
  assert.equal((await h.route.GET(request(), { params: { path: ['api', 'trade-control'] } })).status, 404);
  assert.equal(h.calls.length, 0);
  assert.equal(h.route.PUT, undefined);
});
