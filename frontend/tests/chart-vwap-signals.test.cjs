const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const modules = {};
function load(name) {
  if (modules[name]) return modules[name];
  const source = readFileSync(path.join(__dirname, '..', 'lib', `${name}.ts`), 'utf8');
  const context = { exports: {}, require: id => load(id.replace('./', '')) };
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  modules[name] = context.exports;
  return context.exports;
}
const { calculateVwapSignals } = load('chart-vwap-signals');
const base = Date.parse('2026-10-20T09:15:00+05:30');
const bar = (i, values = {}) => ({
  t: new Date(base + i * 300000).toISOString(), o: 100, h: 101, l: 99, c: 100, v: 10, ...values,
});
const fixture = () => [
  ...Array.from({ length: 5 }, (_, i) => bar(i)),
  bar(5, { o: 99, h: 104, l: 98, c: 103, v: 20 }),
  bar(6, { o: 104, h: 105, l: 103, c: 104 }),
  bar(7, { o: 105, h: 111, l: 104, c: 110 }),
  bar(8, { o: 102, h: 105, l: 101, c: 103 }),
];
function run(bars, extra = {}, frame = 5) {
  const nowMs = Date.parse(bars.at(-1).t) + 300000;
  return calculateVwapSignals(bars, frame, { nowMs, fetchedAt: nowMs, error: false, tickSize: .05, ...extra });
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('VWAP-only BUY setup, next-bar fill, 1R partial and gap-through-breakeven EXIT', () => {
  const bars = fixture();
  const result = run(bars);
  assert.equal(result.trades.length, 1);
  const trade = result.trades[0];
  assert.equal(trade.side, 'BUY');
  assert.equal(trade.entryTime, Date.parse(bars[6].t) / 1000);
  near(trade.entry, 104);
  near(trade.stop, 97.95);
  near(trade.target1, 110.05);
  near(trade.target2, 116.1);
  assert.equal(trade.status, 'CLOSED');
  assert.equal(trade.exitReason, 'BREAKEVEN');
  near(trade.exitPrice, 102);
  assert.ok(result.labels.some(label => label.text.startsWith('T1 50%')));
  assert.ok(result.labels.some(label => label.text.startsWith('EXIT')));
  assert.equal(result.active, null);
});

test('SELL is symmetric and needs no EMA warm-up', () => {
  const bars = fixture().map(item => ({
    ...item, o: 200 - item.o, h: 200 - item.l, l: 200 - item.h, c: 200 - item.c,
  }));
  const trade = run(bars).trades[0];
  assert.equal(trade.side, 'SELL');
  near(trade.entry, 96);
  near(trade.stop, 102.05);
  near(trade.target1, 89.95);
  assert.equal(trade.exitReason, 'BREAKEVEN');
  near(trade.exitPrice, 98);
});

test('VWAP support bounce and resistance rejection produce symmetric closed-candle setups without a cross', () => {
  const bars = [
    ...Array.from({ length: 5 }, (_, i) => bar(i, { o: 101, h: 102, l: 98, c: 101 })),
    bar(5, { o: 102, h: 105, l: 99, c: 104, v: 20 }),
  ];
  const result = run(bars);
  assert.equal(result.trades.length, 1);
  assert.equal(result.active.side, 'BUY');
  assert.equal(result.active.status, 'PENDING');
  const mirrored = bars.map(item => ({
    ...item, o: 200 - item.o, h: 200 - item.l, l: 200 - item.h, c: 200 - item.c,
  }));
  assert.equal(run(mirrored).active.side, 'SELL');
  const formingNow = Date.parse(bars.at(-1).t) + 60000;
  assert.equal(run(bars, { nowMs: formingNow, fetchedAt: formingNow }).trades.length, 0);
  const lowVolume = bars.map(item => ({ ...item }));
  lowVolume[5].v = 9;
  assert.equal(run(lowVolume).trades.length, 0);
});

test('VWAP retests require a real wick touch and directional recovery, not an above-VWAP candle alone', () => {
  const prior = Array.from({ length: 5 }, (_, i) => bar(i, { o: 101, h: 102, l: 98, c: 101 }));
  const noTouch = [...prior, bar(5, { o: 103, h: 105, l: 102, c: 104, v: 20 })];
  assert.equal(run(noTouch).trades.length, 0);
  const wrongDirection = [...prior, bar(5, { o: 104, h: 105, l: 99, c: 102, v: 20 })];
  assert.equal(run(wrongDirection).trades.length, 0);
  const belowClose = [...prior, bar(5, { o: 100, h: 104, l: 97, c: 99, v: 20 })];
  // This is a genuine downward cross, not a BUY support bounce.
  assert.ok(run(belowClose).trades.every(trade => trade.side !== 'BUY'));
});

test('futures signal labels are always wired to the chart with no signal checkbox or dashboard', () => {
  const source = readFileSync(path.join(__dirname, '..', 'components', 'FuturesChart.tsx'), 'utf8');
  assert.match(source, /signalLabels\.setData\(\[\.\.\.signals\.labels/);
  assert.doesNotMatch(source, /showSignals|setShowSignals|VWAP-only entry \/ exit signals|styles\.setupLevels|createPriceLine/);
});

test('forming cross never confirms; closed cross stays pending until a completed next bar', () => {
  const bars = fixture().slice(0, 6);
  const now = Date.parse(bars[5].t) + 60000;
  assert.equal(run(bars, { nowMs: now, fetchedAt: now }).trades.length, 0);
  const result = run(bars);
  assert.equal(result.active.status, 'PENDING');
  assert.equal(result.active.entryTime, undefined);
  assert.match(result.labels[0].text, /^SETUP BUY/);
});

test('low/missing volume, same-session warm-up, non-intraday and invalid tick size suppress entries', () => {
  const bars = fixture();
  bars[5].v = 9;
  assert.equal(run(bars.slice(0, 7)).trades.length, 0);
  assert.equal(run(fixture().map(item => ({ ...item, v: 0 }))).trades.length, 0);
  const mixed = fixture().slice(0, 6);
  mixed[0] = { ...mixed[0], t: '2026-10-19T09:15:00+05:30' };
  assert.equal(run(mixed).trades.length, 0);
  assert.equal(run(fixture(), {}, 'D').trades.length, 0);
  assert.match(run(fixture(), { tickSize: 0 }).reason, /tick size/);
});

test('failed refresh, stale receipt, stale candles and off-session data cannot provide current guidance', () => {
  const bars = fixture().slice(0, 7);
  assert.ok(run(bars).active);
  for (const options of [
    { error: true },
    { fetchedAt: null },
    { fetchedAt: base },
    { nowMs: Date.parse('2026-10-20T12:00:00+05:30'), fetchedAt: Date.parse('2026-10-20T12:00:00+05:30') },
    { nowMs: Date.parse('2026-10-20T16:00:00+05:30'), fetchedAt: Date.parse('2026-10-20T16:00:00+05:30') },
  ]) {
    const result = run(bars, options);
    assert.equal(result.active, null);
    assert.ok(result.labels.length > 0, 'historical replay remains available');
  }
});

test('stop-first ambiguous bar and a gap through structural stop never invent a winning fill', () => {
  const bars = fixture().slice(0, 7);
  bars[6] = bar(6, { o: 104, h: 120, l: 97, c: 110 });
  const stopped = run(bars).trades[0];
  assert.equal(stopped.exitReason, 'STOP');
  assert.equal(stopped.t1Time, undefined);
  bars[6] = bar(6, { o: 97, h: 100, l: 96, c: 99 });
  assert.equal(run(bars).trades.length, 0);
});

test('T2 closes, one position at a time, and changing contract prices cannot leak previous levels', () => {
  const bars = fixture().slice(0, 8);
  bars[7] = bar(7, { o: 105, h: 117, l: 104, c: 116 });
  const result = run(bars);
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].exitReason, 'TARGET 2');
  const shifted = bars.map(item => ({ ...item, o: item.o + 100, h: item.h + 100, l: item.l + 100, c: item.c + 100 }));
  near(run(shifted).trades[0].entry, result.trades[0].entry + 100);
});

test('session reset exits overnight replay at the previous observed close and prevents cross-session entries', () => {
  const bars = fixture().slice(0, 7);
  bars.push({ ...bar(7), t: '2026-10-21T09:15:00+05:30' });
  const result = run(bars);
  assert.equal(result.trades[0].exitReason, 'SESSION CLOSE');
  assert.equal(result.trades[0].exitTime, Date.parse(bars[6].t) / 1000);
  near(result.trades[0].exitPrice, bars[6].c);
});
