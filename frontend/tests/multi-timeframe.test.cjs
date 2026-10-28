const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const load = (file, modules = {}) => {
  const source = readFileSync(path.join(__dirname, '..', 'lib', file), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const context = { exports: {}, require: name => modules[name] };
  vm.runInNewContext(compiled, context);
  return context.exports;
};
const workspace = load('chart-workspace.ts');
const { MTF_TIMEFRAMES, sessionBucket, bucketEnd, closedCount, candleAt, resampleFlowCandles, dailyFromIntraday } =
  load('multi-timeframe.ts', { './chart-workspace': workspace });
const futuresLive = load('futures-live-candles.ts', { './chart-workspace': workspace });

const at = (date, clock) => Date.parse(`${date}T${clock}:00+05:30`) / 1000;
const minute = (time, price, extra = {}) => ({
  t: time, end: time + 60, o: price, h: price + 2, l: price - 1, c: price + 1, v: 10, b: 6, s: 4, n: 2, d: 2, cvd: 0,
  poc: null, lv: [], imb: { buy: [], sell: [] }, book: null, depth: null, spread: null, basis: null,
  complete: true, closed: true, coverage: 1, flags: [], ohlcvComplete: true, oi: 100, oiOpen: 100, ...extra,
});
const snapshot = (bars, extra = {}) => ({
  available: true, symbol: 'NIFTY', interval: 1, date: '2026-10-15', token: 7, lastTick: bars.at(-1).t + 30, bars, ...extra,
});

test('workspace shows 30m, 15m, 5m and 3m; 3m buckets align to 09:15 IST', () => {
  assert.deepEqual(Array.from(MTF_TIMEFRAMES), [30, 15, 5, 3]);
  assert.equal(sessionBucket(at('2026-10-15', '09:20'), 3), at('2026-10-15', '09:18'));
  assert.equal(sessionBucket(at('2026-10-15', '15:29'), 3), at('2026-10-15', '15:27'));
});

test('session buckets are anchored at 09:15 IST and clipped to the session', () => {
  assert.equal(sessionBucket(at('2026-10-15', '09:44'), 30), at('2026-10-15', '09:15'));
  assert.equal(sessionBucket(at('2026-10-15', '09:45'), 30), at('2026-10-15', '09:45'));
  assert.equal(sessionBucket(at('2026-10-15', '10:07'), 5), at('2026-10-15', '10:05'));
  assert.equal(sessionBucket(at('2026-10-15', '09:14'), 1), null);
  assert.equal(sessionBucket(at('2026-10-15', '15:30'), 1), null);
  assert.equal(bucketEnd(at('2026-10-15', '15:15'), 30), at('2026-10-15', '15:30'));
  assert.equal(closedCount([at('2026-10-15', '10:00')], 15, at('2026-10-15', '10:10')), 0);
  assert.equal(closedCount([at('2026-10-15', '10:00')], 15, at('2026-10-15', '10:15')), 1);
});

test('candleAt finds exact bar times only', () => {
  const candles = [0, 5, 10].map(offset => ({ t: new Date((at('2026-10-15', '09:15') + offset * 60) * 1000).toISOString(), o: 1, h: 1, l: 1, c: offset, v: 0 }));
  assert.equal(candleAt(candles, at('2026-10-15', '09:20')).c, 5);
  assert.equal(candleAt(candles, at('2026-10-15', '09:21')), null);
});

test('1m order flow resamples into exact 5m OHLCV with backend completeness rules', () => {
  const open = at('2026-10-15', '09:15');
  const bars = [0, 1, 2, 3, 4, 5].map(i => minute(open + i * 60, 100 + i));
  const result = resampleFlowCandles(snapshot(bars), 5);
  assert.equal(result.interval, 5);
  assert.equal(result.bars.length, 2);
  const [first, second] = result.bars;
  assert.deepEqual([first.t, first.end, first.o, first.h, first.l, first.c, first.v], [open, open + 300, 100, 106, 99, 105, 50]);
  assert.equal(first.complete, true);
  assert.equal(second.complete, false);
  assert.equal(second.ohlcvComplete, true);
  assert.equal(resampleFlowCandles(snapshot(bars), 1).bars, bars);
});

test('missing or gapped minutes never mark a bucket complete', () => {
  const open = at('2026-10-15', '09:15');
  const missingFirst = resampleFlowCandles(snapshot([1, 2, 3, 4].map(i => minute(open + i * 60, 100))), 5).bars[0];
  assert.equal(missingFirst.complete, false);
  assert.equal(missingFirst.ohlcvComplete, false);
  const gap = resampleFlowCandles(snapshot([0, 1, 2, 3, 4].map(i => minute(open + i * 60, 100, i === 2 ? { complete: false, ohlcvComplete: false } : {}))), 5).bars[0];
  assert.equal(gap.complete, false);
  assert.equal(gap.ohlcvComplete, false);
  assert.equal(resampleFlowCandles(snapshot([minute(open, 100)], { interval: 3 }), 5), null);
});

test('resampled flow feeds the existing futures live-candle merge for that timeframe', () => {
  const open = at('2026-10-15', '09:15');
  const bars = [0, 1, 2, 3, 4, 5, 6].map(i => minute(open + i * 60, 100 + i));
  const flow = resampleFlowCandles(snapshot(bars), 5);
  const history = [{ t: new Date(open * 1000).toISOString(), o: 100, h: 104, l: 99, c: 103, v: 40 }];
  const nowMs = (bars.at(-1).t + 31) * 1000;
  const merged = futuresLive.mergeFuturesLiveCandles(history, flow, 'NIFTY', 7, 5, true, nowMs, 0);
  assert.equal(merged.length, 2);
  assert.deepEqual([merged[0].h, merged[0].c, merged[0].v], [106, 105, 50]);
  assert.equal(workspace.candleTime(merged[1]), open + 300);
  assert.equal(merged[1].c, 107);
});

test('futures daily context uses only full sessions and drops a truncated first week', () => {
  const bar = (date, clock, o, h, l, c) => ({ t: `${date}T${clock}:00+05:30`, o, h, l, c, v: 5 });
  const daily = dailyFromIntraday([
    bar('2026-10-08', '09:15', 1, 9, 1, 5),
    bar('2026-10-12', '09:15', 10, 12, 9, 11), bar('2026-10-12', '15:15', 11, 15, 8, 14),
    bar('2026-10-13', '09:45', 20, 21, 19, 20),
    bar('2026-10-14', '09:15', 14, 16, 13, 15),
  ]);
  assert.deepEqual(Array.from(daily, day => day.t.slice(0, 10)), ['2026-10-12', '2026-10-14']);
  assert.deepEqual([daily[0].o, daily[0].h, daily[0].l, daily[0].c, daily[0].v], [10, 15, 8, 14, 10]);
  assert.equal(dailyFromIntraday([bar('2026-10-12', '09:15', 1, 2, 1, 2)]).length, 1);
});

test('chart-workspace live candles stay empty for 1m (no fake 1m from 5m bars)', () => {
  const data = { candles5m: [{ t: '2026-10-15T09:15:00+05:30', o: 1, h: 2, l: 1, c: 2, v: 0 }], candles3m: [] };
  assert.equal(workspace.workspaceCandles(data, 1).length, 0);
  assert.equal(workspace.timeframeLabel(1), '1m');
});
