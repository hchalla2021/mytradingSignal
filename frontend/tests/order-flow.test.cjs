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
  const context = {
    exports: {},
    // Only type imports and order-flow are needed; lightweight-charts is type-only in these modules.
    require: id => load(id.replace('./', '').replace('@/lib/', '')),
  };
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return modules[name] = context.exports;
}
const flow = load('order-flow');
const chartOrderFlow = load('chart-order-flow');
const { orderFlowSignalLabels } = chartOrderFlow;
const plain = value => JSON.parse(JSON.stringify(value));

const bar = (t, extra = {}) => ({
  t, end: t + 300, o: 100, h: 102, l: 99, c: 101, v: 100, b: 60, s: 40, n: 0, d: 20, cvd: 20, poc: 101,
  lv: [[100, 20, 20], [101, 40, 20]], imb: { buy: [], sell: [] }, book: 1.2, depth: 1.1, spread: 0.1, basis: 50,
  complete: true, closed: true, coverage: 1, flags: [], ...extra,
});
const snapshot = (bars, extra = {}) => ({
  available: true, symbol: 'NIFTY', interval: 5, date: '2026-10-20', reason: null, row: 1, token: 1, method: 'lee-ready',
  lastTick: 1, generatedAt: 1, recordedFrom: bars[0]?.t ?? null, bars, events: [], zones: [], signals: [], profile: null,
  guidance: { action: 'WAIT', reasons: [] }, replay: null,
  summary: { delta: 0, cvd: 0, buy: 0, sell: 0, book: null, coverage: 1, basis: 50 }, ...extra,
});

test('parseOrderFlow drops malformed bars instead of guessing and sorts by time', () => {
  const parsed = flow.parseOrderFlow(snapshot([bar(600), { t: 'x' }, bar(300)]));
  assert.deepEqual(plain(parsed.bars.map(item => item.t)), [300, 600]);
  assert.equal(flow.parseOrderFlow({ nope: true }), null);
});

test('mergeOrderFlowUpdate replaces the tail by bar time and keeps history', () => {
  const previous = flow.parseOrderFlow(snapshot([bar(0), bar(300), bar(600)]));
  const update = flow.parseOrderFlow(snapshot([bar(600, { c: 105 }), bar(900)]));
  const merged = flow.mergeOrderFlowUpdate(previous, update);
  assert.deepEqual(plain(merged.bars.map(item => item.t)), [0, 300, 600, 900]);
  assert.equal(merged.bars[2].c, 105);
  const other = flow.parseOrderFlow(snapshot([bar(900)], { date: '2026-10-21' }));
  assert.equal(flow.mergeOrderFlowUpdate(previous, other), other);
});

test('coarsenLevels preserves totals and aligns rows to the bucket size', () => {
  const levels = [[100, 1, 2], [101, 3, 4], [102, 5, 6], [103, 7, 8]];
  assert.equal(flow.bucketSize(1, 1.5), 2);
  const rows = flow.coarsenLevels(levels, 1, 1.5);
  assert.deepEqual(plain(rows), [[100, 4, 6], [102, 12, 14]]);
  assert.equal(flow.coarsenLevels(levels, 1, 0.5), levels);
});

test('sessionLevels sums footprints across bars', () => {
  assert.deepEqual(plain(flow.sessionLevels([bar(0), bar(300)])), [[100, 40, 40], [101, 80, 40]]);
});

test('basisAt uses the bar basis, then nearby earlier bars, then the fallback', () => {
  const bars = [bar(0, { basis: 40 }), bar(300, { basis: null }), bar(600, { basis: 60 })];
  assert.equal(flow.basisAt(bars, 300, 99), 40);
  assert.equal(flow.basisAt(bars, 700, 99), 60);
  assert.equal(flow.basisAt([], 0, 99), 99);
});

test('order-flow labels are basis-shifted for the cash chart and show net P&L after fees', () => {
  const signal = {
    id: 'of-1', time: 300, side: 'BUY', entry: 150, stop: 140, t1: 160, t2: 170, confidence: 70, reasons: [],
    status: 'closed', exits: [{ time: 600, price: 160, lots: 2, reason: 'T1', points: 10, fees: 40 }],
    points: 10, pnl: { gross: 1500, fees: 80, net: 1420 },
  };
  const data = flow.parseOrderFlow(snapshot([bar(0), bar(300), bar(600)], { signals: [signal] }));
  const labels = orderFlowSignalLabels(data, true);
  assert.equal(labels.length, 2);
  assert.equal(labels[0].price, 100);
  assert.match(labels[0].text, /^OF BUY 100\.0/);
  assert.equal(labels[1].kind, 'EXIT');
  assert.equal(labels[1].price, 110);
  assert.equal(labels[1].detailPositive, true);
  assert.equal(orderFlowSignalLabels(data, false)[0].price, 150);
  assert.equal(orderFlowSignalLabels({ ...data, available: false }, false).length, 0);
});

const IST_OPEN = 1792468800 + 3 * 3600 + 45 * 60;   // a 09:15 IST bar time
const quiet = (count, start = IST_OPEN, extra = {}) => Array.from({ length: count }, (_, i) => ({ time: start + i * 300, o: 100, h: 101, l: 99, c: 100.5, v: 1000, ...extra }));

test('big-player flow needs a setup at a major level with >= 2.5x volume, and is validated by points', () => {
  const candles = quiet(30);
  // Stop-run below the day low on 3x volume, closes back up, then follows through +25 points.
  candles.push({ time: IST_OPEN + 30 * 300, o: 100, h: 100.8, l: 96, c: 100.6, v: 3000 });
  for (let k = 1; k <= 6; k++) candles.push({ time: IST_OPEN + (30 + k) * 300, o: 100 + k * 4, h: 104 + k * 4, l: 99.5 + k * 4, c: 103 + k * 4, v: 1000 });
  const flows = flow.candleFlowCallouts(candles, { minPoints: 20, roundStep: 100 });
  assert.equal(flows.length, 1);
  assert.equal(flows[0].side, 'BUY');
  assert.equal(flows[0].status, 'confirmed');
  assert.ok(flows[0].points >= 20);
  assert.ok(flows[0].levels.includes('Day low'));
  const labels = chartOrderFlow.candleFlowLabels(flows);
  assert.deepEqual(plain(labels.map(l => [l.text, l.detail, l.early])), [['Buy Order Flow', `+${flows[0].points.toFixed(0)} pts`, false]]);
});

test('the same print on ordinary volume, or one that hits its stop first, is never shown', () => {
  const setup = (v, after) => {
    const candles = quiet(30);
    candles.push({ time: IST_OPEN + 30 * 300, o: 100, h: 100.8, l: 96, c: 100.6, v });
    after.forEach((bar, k) => candles.push({ time: IST_OPEN + (31 + k) * 300, v: 1000, ...bar }));
    return flow.candleFlowCallouts(candles, { minPoints: 20, roundStep: 100 });
  };
  assert.equal(setup(1500, [{ o: 101, h: 130, l: 100, c: 129 }]).length, 0);   // 1.5x volume: small player
  const stopped = setup(3000, [{ o: 100, h: 101, l: 94, c: 95 }]);
  assert.equal(stopped[0].status, 'failed');
  assert.equal(chartOrderFlow.candleFlowLabels(stopped).length, 0);
  const live = setup(3000, [{ o: 100.6, h: 104, l: 100, c: 103 }]);
  assert.equal(live[0].status, 'pending');
  assert.equal(chartOrderFlow.candleFlowLabels(live)[0].early, true);
  assert.deepEqual(plain(chartOrderFlow.flowStats([...stopped, ...live])), { valid: 0, resolved: 1, pending: 1 });
});

test('quiet sessions produce no prints and the forming candle is ignored', () => {
  assert.equal(flow.candleFlowCallouts(quiet(80), { minPoints: 20 }).length, 0);
  const candles = quiet(30);
  candles.push({ time: IST_OPEN + 30 * 300, o: 100, h: 100.8, l: 96, c: 100.6, v: 3000 });
  assert.equal(flow.candleFlowCallouts(candles, { minPoints: 20, closedBefore: IST_OPEN + 30 * 300 }).length, 0);
});
