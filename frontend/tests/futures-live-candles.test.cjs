const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { performance } = require('node:perf_hooks');

const modules = {};
function load(name) {
  if (modules[name]) return modules[name];
  const context = { exports: {}, require: id => load(id.replace('./', '')) };
  vm.runInNewContext(ts.transpileModule(
    readFileSync(path.join(__dirname, '..', 'lib', `${name}.ts`), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText, context);
  return modules[name] = context.exports;
}
const { mergeFuturesLiveCandles: merge, isFreshFuturesFlow: fresh } = load('futures-live-candles');
const { futuresChangedFrom } = load('futures-chart-metrics');
const start = Date.parse('2026-10-19T09:20:00+05:30') / 1000;
const now = (start + 121) * 1000;
const candle = (t = start, c = 101) => ({
  t: new Date(t * 1000).toISOString(), o: 100, h: 102, l: 99, c, v: 100,
});
const bar = (patch = {}) => ({
  t: start, end: start + 300, o: 100, h: 104, l: 98, c: 103, v: 150,
  complete: false, ohlcvComplete: true, ...patch,
});
const snapshot = (patch = {}) => ({
  available: true, symbol: 'NIFTY', token: 101, interval: 5, date: '2026-10-19',
  lastTick: now / 1000, bars: [bar()], ...patch,
});
const apply = (history, flow = snapshot(), at = now, connected = true, updated = 0) =>
  merge(history, flow, 'NIFTY', 101, 5, connected, at, updated);

test('forming same-contract ticks update only the tail without mutating history or rebuilding the series', () => {
  const history = [candle(start - 300), candle()];
  const result = apply(history);
  assert.equal(history[1].c, 101);
  assert.equal(result[0], history[0]);
  assert.equal(result[1].c, 103);
  assert.equal(result[1].h, 104);
  assert.equal(result[1].l, 98);
  assert.equal(result[1].v, 150);
  assert.equal(futuresChangedFrom(history, result), 1);
  assert.equal(apply(result), result, 'unchanged ticks preserve the array identity');
});

test('new fully observed candle appends, keeping exchange open/extrema/volume on revisions', () => {
  const history = [candle(start - 300)];
  const result = apply(history);
  assert.equal(result.length, 2);
  assert.equal(futuresChangedFrom(history, result), 1);
  const official = [{ ...candle(), o: 99.5, h: 105, l: 97, v: 200 }];
  const merged = apply(official);
  assert.equal(merged[0].o, 99.5);
  assert.equal(merged[0].h, 105);
  assert.equal(merged[0].l, 97);
  assert.equal(merged[0].v, 200);
});

test('rejects stale/disconnected/wrong contract, symbol, interval, date and closed-session streams', () => {
  const history = [candle()];
  for (const patch of [
    { available: false }, { symbol: 'BANKNIFTY' }, { token: 202 }, { interval: 3 },
    { date: '2026-10-18' }, { lastTick: null }, { lastTick: now / 1000 - 11 },
    { lastTick: now / 1000 + 3 },
  ]) assert.equal(apply(history, snapshot(patch)), history);
  assert.equal(apply(history, snapshot(), now, false), history);
  assert.equal(apply(history, snapshot(), Date.parse('2026-10-19T16:00:00+05:30')), history);
  assert.equal(fresh(snapshot({ date: '2026-10-24', lastTick: Date.parse('2026-10-24T10:00:00+05:30') / 1000 }),
    'NIFTY', 101, 5, true, Date.parse('2026-10-24T10:00:00+05:30')), false);
});

test('invalid OHLCV, misaligned buckets and older ticks never overwrite official history', () => {
  const history = [candle()];
  for (const patch of [
    { h: 90 }, { l: 110 }, { v: -1 }, { c: NaN },
    { t: start + 60 }, { end: start }, { end: start + 299 }, { end: start + 301 },
    { t: start - 300, end: start },
  ]) assert.equal(apply(history, snapshot({ bars: [bar(patch)] })), history);
  assert.equal(apply(history, snapshot(), now, true, now), history);
  assert.equal(apply(history, snapshot(), now, true, now + 1000), history);
});

test('partial recording updates official forming prices immediately without inventing open or volume', () => {
  const history = [{ ...candle(), oi: 12345 }];
  const flow = snapshot({ bars: [bar({ ohlcvComplete: false, o: 102, v: 999 })] });
  const result = apply(history, flow);
  assert.equal(result[0].c, 103);
  assert.equal(result[0].o, history[0].o);
  assert.equal(result[0].h, 104);
  assert.equal(result[0].l, 98);
  assert.equal(result[0].v, history[0].v);
  assert.equal(result[0].oi, 12345);
  assert.equal(apply([], flow).length, 0, 'partial recording cannot invent a new candle');
  assert.equal(apply([candle(start - 300)], flow).length, 1, 'missing official open stays unavailable');
  assert.equal(apply(history, { ...flow, lastTick: start + 301 }, (start + 301) * 1000), history,
    'partial recording cannot revise a closed candle');
});

test('each supported intraday bucket and the shortened closing-session bucket keep exchange alignment', () => {
  const open = start - 300;
  for (const interval of [3, 5, 15, 30, 60]) {
    const at = (open + 61) * 1000;
    const flow = snapshot({ interval, lastTick: at / 1000, bars: [bar({ t: open, end: open + interval * 60 })] });
    assert.equal(merge([], flow, 'NIFTY', 101, interval, true, at).length, 1);
  }
  const close = open + 375 * 60;
  const at = (close - 1) * 1000;
  const flow = snapshot({
    interval: 60, lastTick: at / 1000, bars: [bar({ t: open + 360 * 60, end: close })],
  });
  assert.equal(merge([], flow, 'NIFTY', 101, 60, true, at).length, 1);
  assert.equal(merge([], flow, 'NIFTY', 101, 'D', true, at).length, 0);
});

test('live updates over 20,000 historical candles stay tail-only within 50ms', t => {
  const history = Array.from({ length: 20000 }, (_, i) => candle(start - (19999 - i) * 300));
  const began = performance.now();
  const result = apply(history);
  const elapsed = performance.now() - began;
  assert.equal(futuresChangedFrom(history, result), 19999);
  assert.ok(elapsed < 50, `live merge took ${elapsed.toFixed(1)}ms`);
  t.diagnostic(`20,000 candles: live merge ${elapsed.toFixed(2)}ms; render tail: 1 candle`);
});
