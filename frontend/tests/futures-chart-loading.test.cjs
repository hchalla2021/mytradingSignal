const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function setup() {
  const cacheContext = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(path.join(__dirname, '..', 'lib', 'chart-history-cache.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, cacheContext);
  const requests = [];
  const context = {
    exports: {}, AbortController, URLSearchParams, setTimeout, clearTimeout, console,
    fetch: url => new Promise(resolve => requests.push({ url, resolve })),
    require: name => {
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
