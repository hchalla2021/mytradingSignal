const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function setup(overrides = {}) {
  const cacheContext = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(path.join(__dirname, '..', 'lib', 'chart-history-cache.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, cacheContext);
  const requests = [];
  const context = {
    exports: {}, AbortController, URLSearchParams, setTimeout, clearTimeout, console, React: require('react'),
    fetch: url => new Promise(resolve => requests.push({ url, resolve })),
    require: name => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name === 'react') return require('react');
      if (name === './IndexTabs') {
        const tabs = { exports: {}, require, React: require('react') };
        vm.runInNewContext(ts.transpileModule(readFileSync(path.join(__dirname, '..', 'components', 'IndexTabs.tsx'), 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
        }).outputText, tabs);
        return tabs.exports;
      }
      if (name.endsWith('chart-history-cache')) return cacheContext.exports;
      if (name.endsWith('api-config')) return { API_CONFIG: { endpoint: value => value } };
      if (name.endsWith('useChartHistory')) return { parsePage: value => value };
      if (name.endsWith('chart-workspace')) return { TEMPLATES: { 'Clean Chart': {} } };
      return {};
    },
  };
  const source = readFileSync(path.join(__dirname, '..', 'components', 'FuturesChart.tsx'), 'utf8') +
    '\nexport { loadCandles, loadContracts, candleCache };';
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  }).outputText, context);
  return { ...context.exports, requests };
}

test('foreground switching shares in-flight BANKNIFTY/SENSEX preload and caches each contract separately', async () => {
  const { loadCandles, candleCache, requests } = setup();
  const bank = loadCandles('BANKNIFTY', 101, 5);
  const bankSwitch = loadCandles('BANKNIFTY', 101, 5);
  const sensex = loadCandles('SENSEX', 202, 5);
  assert.equal(requests.length, 2);
  requests[0].resolve({ ok: true, json: async () => ({
    source: 'ZERODHA_FUTURES', contract: { token: 101 }, candles: [{ c: 55000 }],
  }) });
  requests[1].resolve({ ok: true, json: async () => ({
    source: 'ZERODHA_FUTURES', contract: { token: 202 }, candles: [{ c: 84000 }],
  }) });
  const [a, b, c] = await Promise.all([bank, bankSwitch, sensex]);
  assert.equal(a, b);
  assert.equal(a.candles[0].c, 55000);
  assert.equal(c.candles[0].c, 84000);
  assert.equal(candleCache.read('BANKNIFTY:101:5').value, a);
  assert.equal(candleCache.read('SENSEX:202:5').value, c);
  assert.equal(candleCache.read('SENSEX:101:5'), undefined);
});

test('a warmed default contract and candles render immediately without a loading frame or new request', async () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  let plotted = null;
  const chart = setup({
    '@/lib/chart-workspace': {
      TEMPLATES: { 'Clean Chart': {} }, candleTime: bar => Date.parse(bar.t) / 1000, timeframeLabel: String,
    },
    '@/lib/chart-indicators': {
      createIndicatorEngine: () => ({ calculate: candles => { plotted = candles; return { series: {} }; } }),
    },
    '@/lib/chart-vwap-signals': { calculateVwapSignals: () => ({ labels: [], reason: 'WAIT' }) },
    '@/lib/futures-chart-metrics': { relativeVolume: () => [] },
    '@/lib/futures-live-candles': {
      mergeFuturesLiveCandles: candles => candles, isFreshFuturesFlow: () => false,
    },
    '@/hooks/useOrderFlow': { useOrderFlow: () => ({ snapshot: null, live: false, error: null }) },
    '@/lib/order-flow': {
      recordedFlowMap: () => new Map(), candleFlowCallouts: () => [],
      FLOW_MIN_POINTS: {}, FLOW_ROUND_STEP: {},
    },
    '@/lib/chart-order-flow': { flowStats: () => ({ valid: 0, resolved: 0, pending: 0 }) },
    './OrderFlowReadout': { default: () => null },
    './DeltaStrength': { default: () => null },
    './ChartWorkspace.module.css': { default: {} },
  });
  const warm = chart.warmFuturesChart();
  chart.requests[0].resolve({ ok: true, json: async () => ({ contracts: [{
    symbol: 'NIFTY', token: 101, tradingSymbol: 'NIFTY26OCTFUT', exchange: 'NFO',
    expiry: '2026-10-27', lotSize: 65, tickSize: 0.05,
  }] }) });
  await new Promise(resolve => setImmediate(resolve));
  chart.requests[1].resolve({ ok: true, json: async () => ({
    source: 'ZERODHA_FUTURES', contract: { token: 101 },
    candles: [{ t: '2026-10-19T09:15:00+05:30', o: 25000, h: 25010, l: 24990, c: 25005, v: 100 }],
  }) });
  await warm;
  const html = renderToStaticMarkup(React.createElement(chart.default, { active: false }));
  assert.match(html, /NIFTY26OCTFUT/);
  assert.match(html, /25,005.00/);
  assert.doesNotMatch(html, /Loading futures (contracts|candles)/);
  assert.equal(plotted.length, 1);
  assert.equal(chart.requests.length, 2);
  assert.match(html, /role="tablist" aria-label="Futures chart index"/);
  for (const symbol of ['NIFTY', 'BANKNIFTY', 'SENSEX']) {
    assert.match(html, new RegExp(`id="futures-index-tab-${symbol}"`));
  }
  assert.match(html, /role="tabpanel" aria-labelledby="futures-index-tab-NIFTY"/);
  assert.equal((html.match(/<select/g) ?? []).length, 3, 'Only expiry year, contract and interval remain dropdowns');
  assert.equal((html.match(/<details/g) ?? []).length, 3, 'Contract controls, readout and explanation are expandable');
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:[=>\s])/, 'Secondary futures menus start collapsed');
});

test('failed preload is retryable and mismatched contract data is never cached', async () => {
  const { loadCandles, candleCache, requests } = setup();
  const first = loadCandles('SENSEX', 202, 5);
  requests[0].resolve({ ok: true, json: async () => ({
    source: 'ZERODHA_FUTURES', contract: { token: 999 }, candles: [],
  }) });
  await assert.rejects(first, /does not match/);
  assert.equal(candleCache.read('SENSEX:202:5'), undefined);
  const retry = loadCandles('SENSEX', 202, 5);
  requests[1].resolve({ ok: true, json: async () => ({
    source: 'ZERODHA_FUTURES', contract: { token: 202 }, candles: [],
  }) });
  await retry;
  assert.equal(requests.length, 2);
});

test('workspace warm-up loads the default contract/history once and shares foreground requests', async () => {
  const { warmFuturesChart, loadCandles, requests } = setup();
  const first = warmFuturesChart();
  const second = warmFuturesChart();
  assert.equal(requests.length, 1);
  requests[0].resolve({ ok: true, json: async () => ({ contracts: [{
    symbol: 'NIFTY', token: 101, tradingSymbol: 'NIFTY26OCTFUT', exchange: 'NFO',
    expiry: '2026-10-27', lotSize: 65, tickSize: 0.05,
  }] }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 2);
  const foreground = loadCandles('NIFTY', 101, 5);
  assert.equal(requests.length, 2);
  requests[1].resolve({ ok: true, json: async () => ({
    source: 'ZERODHA_FUTURES', contract: { token: 101 }, candles: [{ c: 25000 }],
  }) });
  await Promise.all([first, second, foreground]);
  await warmFuturesChart();
  assert.equal(requests.length, 2, 'fresh warm snapshots must not trigger duplicate requests');
});
