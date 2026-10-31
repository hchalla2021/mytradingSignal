const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function compile(file) {
  return ts.transpileModule(readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}

function harness(response, apiUrl) {
  const requests = [], errors = [], timers = [], routes = [], states = [];
  let cursor = 0;
  const window = {
    innerWidth: 400,
    location: { hostname: 'mydailytradesignals.com', origin: 'https://mydailytradesignals.com', href: '' },
  };
  const api = { exports: {}, window, URL, process: { env: { NEXT_PUBLIC_API_URL: apiUrl } },
    require: () => ({ getEnvironmentConfig: () => ({ apiUrl: 'http://localhost:8000' }) }) };
  vm.runInNewContext(compile('lib/api-config.ts'), api);
  const context = {
    exports: {}, window, navigator: { userAgent: 'Android' },
    console: { error: (...args) => errors.push(args) },
    setTimeout: fn => timers.push(fn),
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (response instanceof Error) throw response;
      return { ok: response.ok, json: async () => response.body };
    },
    require: id => {
      if (id === 'react') return {
        useEffect() {},
        useState(initial) {
          const index = cursor++;
          if (!(index in states)) states[index] = initial;
          return [states[index], value => { states[index] = value; }];
        },
      };
      if (id === 'react/jsx-runtime') return require(id);
      if (id === 'next/navigation') return { useSearchParams: () => null, useRouter: () => ({ push: url => routes.push(url) }) };
      if (id === '@/lib/api-config') return api.exports;
      throw new Error(`Unexpected dependency ${id}`);
    },
  };
  vm.runInNewContext(compile('app/login/page.tsx'), context);
  return {
    render() { cursor = 0; return context.exports.default(); },
    requests, errors, timers, routes, window, states,
  };
}

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
}

test('production login uses same-origin broker flow without a baked API URL or with stale localhost URL', async () => {
  for (const apiUrl of [undefined, 'http://localhost:8000']) {
    const h = harness({ ok: true, body: { success: false, configured: false } }, apiUrl);
    await nodes(h.render()).find(n => n.type === 'button').props.onClick();
    assert.equal(h.requests[0].url, 'https://mydailytradesignals.com/api/auth/auto-login');
    assert.equal(h.requests[0].options.method, 'POST');
    assert.equal(h.window.location.href, 'https://mydailytradesignals.com/api/auth/login');
    assert.ok(!h.states.some(value => typeof value === 'string' && value.includes('API URL not configured')));
  }
});

test('successful one-click login schedules dashboard navigation, not a broker login', async () => {
  const h = harness({ ok: true, body: { success: true, user_id: 'TEST' } });
  await nodes(h.render()).find(n => n.type === 'button').props.onClick();
  assert.equal(h.window.location.href, '');
  h.timers[0]();
  assert.deepEqual(h.routes, ['/']);
});

test('unreachable one-click endpoint is explicit and still opens broker login', async () => {
  const h = harness(new Error('Offline'));
  await nodes(h.render()).find(n => n.type === 'button').props.onClick();
  assert.equal(h.errors.length, 1);
  assert.ok(h.states.includes('One-click login unavailable. Opening Zerodha login instead.'));
  assert.equal(h.window.location.href, 'https://mydailytradesignals.com/api/auth/login');
});

test('non-success HTTP responses cannot masquerade as successful one-click login', async () => {
  const h = harness({ ok: false, body: { success: true, configured: true, message: 'Rejected' } });
  await nodes(h.render()).find(n => n.type === 'button').props.onClick();
  assert.equal(h.timers.length, 0);
  assert.ok(h.states.some(value => typeof value === 'string' && value.includes('One-click login failed')));
  assert.equal(h.window.location.href, 'https://mydailytradesignals.com/api/auth/login');
});
