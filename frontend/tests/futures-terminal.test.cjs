const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'futures-terminal.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const module_ = { exports: {} };
vm.runInNewContext(outputText, { module: module_, exports: module_.exports, require: () => ({}) });
const lib = module_.exports;

// 2024-01-02 09:15 IST
const DAY1 = Date.UTC(2024, 0, 2, 3, 45) / 1000;
const DAY2 = DAY1 + 86_400;
const bar = (time, o, h, l, c, v = 100, oi = null) => ({ time, o, h, l, c, v, oi });

test('ema seeds with SMA and stays null before the period', () => {
  const out = lib.ema([1, 2, 3, 4, 5], 3);
  assert.deepEqual([...out.slice(0, 2)], [null, null]);
  assert.equal(out[2], 2);
  assert.equal(out[3], 3);
  assert.equal(out[4], 4);
});

test('session VWAP resets at the start of each IST day', () => {
  const bars = [bar(DAY1, 10, 12, 8, 10, 100), bar(DAY1 + 60, 20, 22, 18, 20, 100), bar(DAY2, 50, 52, 48, 50, 10)];
  const vwap = lib.sessionVwap(bars);
  assert.equal(vwap[0], 10);
  assert.equal(vwap[1], 15);
  assert.equal(vwap[2], 50);
});

test('previousDay returns the last completed session, or null on the first day', () => {
  const bars = [bar(DAY1, 10, 15, 9, 11), bar(DAY1 + 60, 11, 18, 7, 12), bar(DAY2, 12, 13, 11, 12)];
  assert.deepEqual({ ...lib.previousDay(bars) }, { high: 18, low: 7, close: 12, day: lib.istDay(DAY1) });
  assert.equal(lib.previousDay(bars.slice(0, 2)), null);
});

test('OI build-up classification and null OI handling', () => {
  assert.equal(lib.oiBuildup(5, 100), 'Long build-up');
  assert.equal(lib.oiBuildup(5, -100), 'Short covering');
  assert.equal(lib.oiBuildup(-5, 100), 'Short build-up');
  assert.equal(lib.oiBuildup(-5, -100), 'Long unwinding');
  assert.equal(lib.oiBuildup(5, null), null);
  const changes = lib.oiChanges([bar(DAY1, 1, 1, 1, 1, 1, 1000), bar(DAY1 + 60, 1, 1, 1, 1, 1, null), bar(DAY1 + 120, 1, 1, 1, 1, 1, 1200), bar(DAY1 + 180, 1, 1, 1, 1, 1, 1500)]);
  assert.deepEqual(changes, [null, null, null, 300]);
});

test('dominance is null without recorded classified volume, never inferred', () => {
  assert.equal(lib.dominance(null), null);
  assert.equal(lib.dominance({ b: 0, s: 0, n: 500, v: 500 }), null);
  const result = lib.dominance({ b: 300, s: 100, n: 100, v: 500 });
  assert.equal(result.buyPct, 75);
  assert.equal(result.sellPct, 25);
  assert.equal(result.unclassified, 100);
});

test('depth imbalance uses pending quantities and handles empty books', () => {
  assert.equal(lib.depthImbalance(null), null);
  assert.equal(lib.depthImbalance({ bids: [[100, 300, 3]], asks: [[100.05, 100, 1]] }), 50);
  assert.equal(lib.depthImbalance({ bids: [], asks: [] }), null);
});

test('liquidity sweep flags a wick above a swing high that closes back below', () => {
  const bars = [];
  const highs = [10, 11, 12, 15, 12, 11, 10, 11, 12];
  highs.forEach((h, i) => bars.push(bar(DAY1 + i * 60, h - 1, h, h - 2, h - 1)));
  bars.push(bar(DAY1 + 9 * 60, 13, 16, 12, 14));
  const marks = lib.liquiditySweeps(bars, bars.length, null);
  assert.equal(marks.length, 1);
  assert.equal(marks[0].side, 'SELL');
  assert.equal(marks[0].price, 15);
  assert.equal(marks[0].index, 9);
});

test('resample anchors buckets at 09:15 IST and keeps last OI', () => {
  const bars = [0, 1, 2, 3, 4, 5].map(i => bar(DAY1 + i * 60, 10 + i, 11 + i, 9 + i, 10.5 + i, 10, 100 + i));
  const out = lib.resample(bars, 3);
  assert.equal(out.length, 2);
  assert.equal(out[0].time, DAY1);
  assert.deepEqual([out[0].o, out[0].h, out[0].l, out[0].c, out[0].v, out[0].oi], [10, 13, 9, 12.5, 30, 102]);
  assert.equal(out[1].time, DAY1 + 180);
});

test('freshness states: live, delayed, polling, stale, closed', () => {
  const now = 1_700_000_000_000;
  const base = { nowMs: now, lastTick: null, historyUpdated: null, streamLive: true, inSession: true };
  assert.equal(lib.freshness({ ...base, lastTick: now / 1000 - 1 }).state, 'LIVE');
  assert.equal(lib.freshness({ ...base, lastTick: now / 1000 - 1, streamLive: false }).state, 'DELAYED');
  assert.equal(lib.freshness({ ...base, lastTick: now / 1000 - 10 }).state, 'DELAYED');
  assert.equal(lib.freshness({ ...base, historyUpdated: now - 30_000 }).state, 'POLLING');
  assert.equal(lib.freshness({ ...base, historyUpdated: now - 120_000 }).state, 'STALE');
  assert.equal(lib.freshness({ ...base, lastTick: now / 1000, inSession: false }).state, 'CLOSED');
});

function trendContext(count, state = 'LIVE') {
  const bars = [];
  for (let i = 0; i < count; i++) {
    const c = 100 + i * 0.5;
    bars.push(bar(DAY1 + i * 60, c - 0.3, c + 0.4, c - 0.5, c, 100, 1000 + i * 10));
  }
  const closes = bars.map(item => item.c);
  const emas = {};
  for (const period of lib.EMA_PERIODS) emas[period] = lib.ema(closes, period);
  return {
    bars, emas, vwap: lib.sessionVwap(bars), atr: lib.atr(bars), oiChange: lib.oiChanges(bars),
    levels: { supports: [], resistances: [] }, prevDay: null, marks: [], flow: new Map(), events: [], dom: null,
    higherTimeframes: [{ label: '15m', bias: 'BULL' }, { label: '1h', bias: 'BULL' }],
    tickSize: 0.05, intervalSeconds: 60,
    freshness: { state, tickAge: 1, historyAge: 1, label: '' },
  };
}

test('trend alone without recorded flow stays WAIT (below action confidence)', () => {
  const signal = lib.evaluateSignal(trendContext(80), 79, 'CONFIRMED');
  assert.equal(signal.action, 'WAIT');
  assert.equal(signal.bias, 'BULL');
  assert.ok(signal.confidence < lib.ACTION_CONFIDENCE);
  assert.ok(signal.cautions.some(text => text.includes('No recorded order flow')));
});

test('uptrend confirmed by recorded flow yields a BUY plan with stop below entry and targets above', () => {
  const ctx = trendContext(80);
  ctx.flow = new Map(ctx.bars.slice(-4).map((item, k) => [item.time, { t: item.time, v: 100, b: 65, s: 35, n: 0, d: 30, cvd: 30 * (k + 1), coverage: 0.9, book: null }]));
  const signal = lib.evaluateSignal(ctx, 79, 'CONFIRMED');
  assert.equal(signal.action, 'BUY');
  assert.ok(signal.confidence >= lib.ACTION_CONFIDENCE && signal.confidence <= 95);
  assert.ok(signal.stop < signal.entry[0] && signal.entry[0] <= signal.entry[1]);
  assert.ok(signal.targets[0] > signal.entry[1] && signal.targets[1] > signal.targets[0]);
  assert.ok(signal.riskReward >= 1);
  assert.ok(signal.reasons.some(text => text.includes('est. aggressor')));
});

test('signal engine returns WAIT on stale data, closed market, or short history', () => {
  assert.equal(lib.evaluateSignal(trendContext(80, 'STALE'), 79, 'CONFIRMED').action, 'WAIT');
  assert.equal(lib.evaluateSignal(trendContext(80, 'CLOSED'), 79, 'CONFIRMED').action, 'WAIT');
  const short = lib.evaluateSignal(trendContext(30), 29, 'CONFIRMED');
  assert.equal(short.action, 'WAIT');
  assert.ok(short.cautions[0].includes('candles of context'));
  assert.equal(lib.evaluateSignal(trendContext(0), 0, 'CONFIRMED').action, 'WAIT');
});

test('low-coverage order flow is excluded from scoring', () => {
  const ctx = trendContext(80);
  const last = ctx.bars[79];
  ctx.flow = new Map([[last.time, { t: last.time, v: 100, b: 0, s: 100, n: 0, d: -100, cvd: -100, coverage: 0.3, book: null }]]);
  const signal = lib.evaluateSignal(ctx, 79, 'CONFIRMED');
  assert.ok(signal.cautions.some(text => text.includes('coverage only 30%')));
  assert.ok(!signal.against.some(text => text.includes('delta')));
});
