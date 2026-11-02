const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function compile(file) {
  return ts.transpileModule(readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function routing(env, origin) {
  const location = origin ? new URL(origin) : undefined;
  const globals = {
    process: { env }, URL, console: { log() {} },
    ...(location ? { window: { location } } : {}),
  };
  const environment = { ...globals, exports: {} };
  vm.runInNewContext(compile('lib\\env-detection.ts'), environment);
  const api = { ...globals, exports: {}, require: () => environment.exports };
  vm.runInNewContext(compile('lib\\api-config.ts'), api);
  return { config: environment.exports.getEnvironmentConfig(), api: api.exports.API_CONFIG };
}

const shared = {
  NODE_ENV: 'development', NEXT_PUBLIC_SHARED_PRODUCTION: 'true',
  NEXT_PUBLIC_API_URL: 'http://localhost:8000',
  NEXT_PUBLIC_WS_URL: 'ws://localhost:8000/ws/market',
  NEXT_PUBLIC_LOCAL_API_URL: 'http://localhost:8000',
  NEXT_PUBLIC_LOCAL_WS_URL: 'ws://localhost:8000/ws/market',
};

test('shared mode routes API, auth and every derived feed through the current frontend origin', () => {
  for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'https://localhost:3000']) {
    const { config, api } = routing(shared, origin);
    const base = origin;
    assert.equal(config.sharedProduction, true);
    assert.equal(api.sharedProduction, true);
    assert.equal(api.baseUrl, base);
    assert.equal(config.apiUrl, base);
    assert.equal(api.endpoint('/api/aqte/live/start'), `${base}/api/aqte/live/start`);
    assert.equal(api.endpoint('api/app-access/login'), `${base}/api/app-access/login`);
    assert.equal(api.wsUrl, `${origin.replace(/^http/, 'ws')}/ws/market`);
    assert.equal(config.wsUrl, api.wsUrl);
    assert.match(config.displayName, /Shared Production.*real orders/);
  }
});

test('server rendering uses a relative proxy API and does not invent a WebSocket host', () => {
  const { config, api } = routing(shared);
  assert.equal(api.endpoint('/api/aqte/live/status'), '/api/aqte/live/status');
  assert.equal(config.wsUrl, '');
});

test('ordinary development and deployed production keep their existing routing', () => {
  const local = routing({ ...shared, NEXT_PUBLIC_SHARED_PRODUCTION: 'false' }, 'http://localhost:3000');
  assert.equal(local.api.baseUrl, 'http://localhost:8000');
  assert.equal(local.api.wsUrl, 'ws://localhost:8000/ws/market');
  const production = routing({ ...shared, NODE_ENV: 'production' }, 'https://mydailytradesignals.com');
  assert.equal(production.api.sharedProduction, false);
  assert.equal(production.api.baseUrl, 'https://mydailytradesignals.com');
  assert.equal(production.api.wsUrl, 'wss://mydailytradesignals.com/ws/market');
});

function nextConfig(env) {
  const context = { module: { exports: {} }, process: { env }, URL };
  vm.runInNewContext(readFileSync(path.join(__dirname, '..', 'next.config.js'), 'utf8'), context);
  return context.module.exports;
}

test('proxy sends API and WebSocket namespaces to HTTPS before any local API route can execute', async () => {
  const config = nextConfig({ ...shared, DEV_PRODUCTION_ORIGIN: 'https://mydailytradesignals.com/' });
  assert.deepEqual(JSON.parse(JSON.stringify(await config.rewrites())), {
    beforeFiles: [
      { source: '/api/:path*', destination: 'https://mydailytradesignals.com/api/:path*' },
      { source: '/ws/:path*', destination: 'https://mydailytradesignals.com/ws/:path*' },
    ],
    afterFiles: [],
    fallback: [],
  });
});

test('proxy fails explicitly on missing, insecure or malformed target origins', async () => {
  for (const value of [undefined, '', 'not a URL', 'http://example.com', 'https://user:pass@example.com',
    'https://example.com/api', 'https://example.com?target=other', 'https://example.com#fragment']) {
    await assert.rejects(nextConfig({ ...shared, DEV_PRODUCTION_ORIGIN: value }).rewrites(),
      /HTTPS origin/);
  }
});

test('proxy rewrites cannot be activated in production builds or ordinary development', async () => {
  for (const env of [{ ...shared, NODE_ENV: 'production' }, { ...shared, NEXT_PUBLIC_SHARED_PRODUCTION: 'false' }]) {
    assert.equal((await nextConfig(env).rewrites()).length, 0);
  }
});

const fallbackHooks = [
  ['useChartIntelligence.ts', 'useChartIntelligence', 'fetchWithFallback', 'chart-intelligence'],
  ['useStrikeIntelligence.ts', 'useStrikeIntelligence', 'fetchWithFallback', 'strike-intelligence'],
  ['useMarketRegime.ts', 'useMarketRegime', 'fetchRegimeWithFallback', 'market-regime'],
];

function feedHook(file, extra = {}) {
  const refs = [], effects = [], requests = [], sockets = [];
  const base = 'http://localhost:3000';
  class Socket {
    static OPEN = 1;
    static CONNECTING = 0;
    constructor(url) { this.readyState = 0; sockets.push(url); }
    close() { this.readyState = 3; }
  }
  const context = {
    exports: {}, process: { env: shared }, console, AbortSignal, WebSocket: Socket,
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    localStorage: { getItem: () => null, setItem() {} },
    window: { location: { hostname: 'localhost' } },
    fetch: async url => { requests.push(url); throw new Error('Production unavailable'); },
    require: name => {
      if (name === 'react') return {
        useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
        useRef: current => { const ref = { current }; refs.push(ref); return ref; },
        useCallback: callback => callback,
        useEffect: effect => effects.push(effect),
      };
      if (name === '@/lib/env-detection') return { getEnvironmentConfig: () => ({
        sharedProduction: true, apiUrl: base, wsUrl: `${base.replace(/^http/, 'ws')}/ws/market`,
      }) };
      throw new Error(`Unexpected dependency ${name}`);
    },
    ...extra,
  };
  return { context, refs, effects, requests, sockets, base, code: compile(`hooks\\${file}`) };
}

for (const [file, hook, fetcher, route] of fallbackHooks) {
  test(`${hook} does not fetch a different backend when production is unavailable`, async () => {
    const h = feedHook(file);
    vm.runInNewContext(`${h.code}\nexports.fetchForTest = ${fetcher};`, h.context);
    assert.equal(await h.context.exports.fetchForTest(), null);
    assert.deepEqual(h.requests, [`${h.base}/api/${route}`]);
  });

  test(`${hook} has only the shared production WebSocket as a retry candidate`, () => {
    const h = feedHook(file, { fetch: () => new Promise(() => {}) });
    vm.runInNewContext(h.code, h.context);
    h.context.exports[hook]();
    const cleanup = h.effects.map(effect => effect()).filter(fn => typeof fn === 'function');
    const expected = `${h.base.replace(/^http/, 'ws')}/ws/${route}`;
    assert.deepEqual(h.sockets, [expected]);
    const urls = h.refs.find(ref => Array.isArray(ref.current) && ref.current.includes(expected));
    assert.ok(urls, 'WebSocket retry candidate list is initialized');
    assert.deepEqual(Array.from(urls.current), [expected]);
    cleanup.forEach(fn => fn());
  });
}
