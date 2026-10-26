const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, modules = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', file), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const module_ = { exports: {} };
  vm.runInNewContext(outputText, { module: module_, exports: module_.exports, require: name => modules[name] ?? {} });
  return module_.exports;
}

const terminal = load('futures-terminal.ts');
const pro = load('pro-confluence.ts', { './futures-terminal': terminal });

// 2024-01-02 09:15 IST, 5m bars
const DAY1 = Date.UTC(2024, 0, 2, 3, 45) / 1000;
const DAY2 = DAY1 + 86_400;
const STEP = 300;

/** Two sessions of a steady up-trend with shallow pullbacks every 4th bar. */
function trend(days = [DAY1, DAY2]) {
  const bars = [];
  let price = 20_000;
  for (const day of days) {
    for (let i = 0; i < 75; i++) {
      const pull = i % 4 === 3;
      const open = price;
      const close = pull ? price - 4 : price + 9;
      bars.push({ time: day + i * STEP, o: open, h: Math.max(open, close) + 2, l: Math.min(open, close) - 2, c: close, v: 1000, oi: 100_000 + bars.length * 50 });
      price = close;
    }
  }
  return bars;
}

function flowFor(bars, ratio = 0.4) {
  let cvd = 0;
  return bars.map(bar => {
    const d = Math.round(bar.v * ratio * (bar.c >= bar.o ? 1 : -0.3));
    cvd += d;
    return { t: bar.time, end: bar.time + STEP, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v, b: (bar.v + d) / 2, s: (bar.v - d) / 2,
      n: 0, d, cvd, poc: null, lv: [], imb: { buy: [], sell: [] }, book: null, depth: null, spread: null, basis: 100,
      complete: true, closed: true, coverage: 1, flags: [], oi: bar.oi, oiOpen: bar.oi };
  });
}

test('without recorded order flow the gate never gives BUY or SELL', () => {
  const bars = trend();
  const replay = pro.proReplay(pro.buildProContext(bars, [], [], 0.05), bars.length);
  assert.equal(replay.trades.length, 0);
  assert.equal(replay.verdict.action, 'WAIT');
  assert.equal(replay.verdict.checks.find(check => check.id === 'delta').pass, false);
});

test('BUY / SELL only when every single check passes', () => {
  const bars = trend();
  const ctx = pro.buildProContext(bars, flowFor(bars), [], 0.05);
  for (let at = 60; at < bars.length; at++) {
    const verdict = pro.proVerdictAt(ctx, at);
    if (verdict.action !== 'WAIT') assert.equal(verdict.passed, verdict.total, `bar ${at}`);
    else assert.ok(verdict.passed < verdict.total || !verdict.plan, `bar ${at}`);
  }
});

test('verdicts never look ahead: appending future candles does not change a closed bar', () => {
  const bars = trend();
  const flow = flowFor(bars);
  const cut = 120;
  const past = pro.buildProContext(bars.slice(0, cut + 1), flow.slice(0, cut + 1), [], 0.05);
  const full = pro.buildProContext(bars, flow, [], 0.05);
  const a = pro.proVerdictAt(past, cut), b = pro.proVerdictAt(full, cut);
  assert.equal(a.action, b.action);
  assert.deepEqual(a.checks.map(check => [check.id, check.pass]), b.checks.map(check => [check.id, check.pass]));
});

test('replay holds one trade at a time and resolves every closed trade with points', () => {
  const bars = trend();
  const replay = pro.proReplay(pro.buildProContext(bars, flowFor(bars), [], 0.05), bars.length);
  let busyUntil = -Infinity;
  for (const trade of replay.trades) {
    assert.ok(trade.signalTime >= busyUntil, 'no overlapping trades');
    assert.ok(trade.signalTime >= DAY2, 'only today is replayed');
    if (trade.status === 'closed') {
      assert.ok(['SL', 'BE', 'T2', 'EOD'].includes(trade.exitReason));
      assert.equal(typeof trade.points, 'number');
      busyUntil = trade.exitTime;
    }
  }
  const closed = replay.trades.filter(trade => trade.status === 'closed');
  assert.equal(replay.stats.closed, closed.length);
  assert.equal(replay.stats.wins + replay.stats.losses, closed.length);
});

test('decision: WAIT on stale or closed feeds, BUY only on the candle right after confirmation, HOLD afterwards', () => {
  const verdict = { time: DAY2 + 3000, passed: 14, total: 14, side: 'BUY' };
  const trade = { side: 'BUY', signalTime: verdict.time, entryTime: null, entry: 100, stop: 95, t1: 107.5, t2: 115, t1Hit: false, status: 'open' };
  const replay = { verdict, trades: [trade], stats: {} };
  assert.equal(pro.proDecision(replay, 'LIVE').action, 'BUY');
  assert.equal(pro.proDecision(replay, 'DELAYED').stage, 'ENTRY');
  for (const state of ['STALE', 'CLOSED', 'POLLING']) assert.equal(pro.proDecision(replay, state).action, 'WAIT');
  const later = { ...replay, verdict: { ...verdict, time: verdict.time + STEP } };
  const hold = pro.proDecision(later, 'LIVE');
  assert.equal(hold.action, 'WAIT');
  assert.equal(hold.stage, 'HOLD');
  const partial = pro.proDecision({ verdict: { ...verdict, passed: 13 }, trades: [], stats: {} }, 'LIVE');
  assert.equal(partial.action, 'WAIT');
  assert.match(partial.reason, /13\/14/);
});

test('labels snap to the containing chart bar and shift futures prices onto the cash index', () => {
  const trade = { id: 'x', side: 'SELL', signalTime: DAY2 + 600, entryTime: DAY2 + 900, entry: 20_100, stop: 20_120, t1: 20_070, t2: 20_040,
    t1Hit: true, status: 'closed', exitTime: DAY2 + 2100, exitPrice: 20_040, exitReason: 'T2', points: 45 };
  const fifteen = [DAY2, DAY2 + 900, DAY2 + 1800];
  const labels = pro.proSignalLabels([trade], fifteen, 900, () => 100);
  assert.equal(labels.length, 2);
  assert.equal(labels[0].time, DAY2 + 900);
  assert.equal(labels[0].price, 20_000);
  assert.equal(labels[0].kind, 'SELL');
  assert.equal(labels[1].time, DAY2 + 1800);
  assert.equal(labels[1].price, 19_940);
  assert.equal(labels[1].detailPositive, true);
  assert.equal(pro.proSignalLabels([trade], fifteen, 900, () => null).length, 0, 'no basis, no label');
  assert.equal(pro.proSignalLabels([trade], [DAY1], 900).length, 0, 'never snaps onto an unrelated bar');
});
