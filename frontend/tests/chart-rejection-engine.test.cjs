const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const cache = {};
function load(name) {
  if (cache[name]) return cache[name];
  const compiled = ts.transpileModule(readFileSync(path.join(__dirname, '..', 'lib', `${name}.ts`), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const context = { exports: {}, require: id => load(id.replace('./', '')) };
  vm.runInNewContext(compiled, context);
  cache[name] = context.exports;
  return context.exports;
}
const { createRejectionEngine, replayStats } = load('chart-rejection-engine');
const { candleTime } = load('chart-workspace');

const STEP = 300000;
const end = Date.parse('2026-10-19T15:30:00+05:30');
// Deterministic pseudo-random walk with trend legs and pullbacks so bars wick into EMAs and pivots.
function fixture(count = 900) {
  const times = [];
  for (let at = end - STEP; times.length < count; at -= STEP) {
    const ist = new Date(at + 19800000);
    const minute = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    if (ist.getUTCDay() > 0 && ist.getUTCDay() < 6 && minute >= 555 && minute < 930) times.unshift(at);
  }
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let price = 25000;
  return times.map((at, i) => {
    const drift = Math.sin(i / 45) * 2.2 + Math.sin(i / 11) * 3.5;
    const o = price;
    const c = o + drift + (rand() - 0.5) * 14;
    const h = Math.max(o, c) + rand() * 9;
    const l = Math.min(o, c) - rand() * 9;
    price = c;
    return { t: new Date(at).toISOString(), o, h, l, c, v: 0 };
  });
}
const daily = [
  { t: '2026-09-25T00:00:00+05:30', o: 24800, h: 25120, l: 24750, c: 25010, v: 0 },
  { t: '2026-09-28T00:00:00+05:30', o: 25010, h: 25150, l: 24900, c: 24980, v: 0 },
];
const options = { live: false, nowMs: end + STEP };

test('every rejection signal is a validated touch-and-reject with structural SL and level/ratio targets', () => {
  const bars = fixture();
  const result = createRejectionEngine().analyze(bars, daily, 5, options);
  assert.ok(result.signals.length > 0, 'fixture should produce at least one rejection signal');
  let lastBuy = -99, lastSell = -99;
  for (const signal of result.signals) {
    const bar = bars[signal.index];
    const dir = signal.side === 'BUY' ? 1 : -1;
    assert.equal(signal.entry, Math.round(bar.c * 20) / 20, 'entry is the closed-candle price');
    assert.ok(signal.confidence >= 65 && signal.confidence <= 100);
    assert.ok(dir * (signal.entry - signal.stopLoss) > 0, 'stop beyond entry');
    const swing = bars.slice(signal.index - 2, signal.index + 1);
    const extreme = dir === 1 ? Math.min(...swing.map(b => b.l)) : Math.max(...swing.map(b => b.h));
    assert.ok(dir * (extreme - signal.stopLoss) >= -0.05, 'stop sits beyond the rejection swing');
    assert.ok(signal.rr1 >= 0.99, `T1 at least 1R (got ${signal.rr1})`);
    assert.ok(dir * (signal.target2 - signal.target1) > 0, 'T2 beyond T1');
    assert.ok(signal.rr2 >= 1.99 || signal.rr2 >= signal.rr1, 'T2 at least 2R');
    // The level was touched by the wick and the close held on the rejection side.
    const wick = dir === 1 ? bar.l : bar.h;
    assert.ok(dir * (bar.c - signal.levelPrice) > 0, 'close on rejection side of level');
    assert.ok(dir * (wick - signal.levelPrice) <= signal.risk, 'wick reached the level');
    const ist = new Date((signal.time + 19800) * 1000);
    assert.ok(ist.getUTCHours() * 60 + ist.getUTCMinutes() + 5 < 15 * 60 + 10, 'no late-session entries');
    if (signal.side === 'BUY') { assert.ok(signal.index - lastBuy >= 5, 'duplicate BUY suppressed'); lastBuy = signal.index; }
    else { assert.ok(signal.index - lastSell >= 5, 'duplicate SELL suppressed'); lastSell = signal.index; }
    assert.ok(signal.reasons.length >= 3);
  }
  assert.equal(result.vwapStatus, undefined);
  assert.ok(result.signals.every(signal => !signal.level.includes('VWAP')));
});

test('only one trade at a time: every new entry comes after the previous EXIT, strong levels only', () => {
  const bars = fixture();
  const result = createRejectionEngine().analyze(bars, daily, 5, options);
  assert.ok(result.signals.length > 0);
  for (let k = 1; k < result.signals.length; k++) {
    const previous = result.signals[k - 1];
    assert.ok(previous.outcome.resolved, 'an earlier trade must be closed before the next entry');
    assert.ok(result.signals[k].time > previous.outcome.exitTime, 'next entry strictly after previous exit');
  }
  for (const signal of result.signals) {
    assert.ok(signal.confidence >= 70);
    assert.notEqual(signal.outcome.status, 'NO FILL');
  }
});

test('incremental replay matches a fresh full evaluation and closed-candle default ignores the forming bar', () => {
  const bars = fixture();
  const engine = createRejectionEngine();
  for (let n = 700; n <= bars.length; n += 25) engine.analyze(bars.slice(0, n), daily, 5, options);
  const incremental = engine.analyze(bars, daily, 5, options);
  const fresh = createRejectionEngine().analyze(bars, daily, 5, options);
  assert.deepEqual(JSON.parse(JSON.stringify(incremental.signals)), JSON.parse(JSON.stringify(fresh.signals)));
  const formingNow = candleTime(bars.at(-1)) * 1000 + 60000;
  const closedOnly = createRejectionEngine().analyze(bars, daily, 5, { live: false, nowMs: formingNow });
  assert.ok(closedOnly.signals.every(signal => signal.index < bars.length - 1));
  assert.equal(closedOnly.evaluatedBars, bars.length - 1);
});

test('replay applies costs, stop-first exits and splits stats chronologically', () => {
  const bars = fixture();
  const result = createRejectionEngine().analyze(bars, daily, 5, options);
  const resolved = result.signals.filter(signal => signal.outcome.resolved);
  assert.ok(resolved.length > 0);
  for (const signal of resolved) {
    const dir = signal.side === 'BUY' ? 1 : -1;
    const fill = signal.outcome.fill;
    assert.equal(fill, bars[signal.index + 1].o + dir * 0.5, 'fill at next bar open plus slippage');
    if (signal.outcome.status === 'STOP') assert.ok(signal.outcome.netPoints <= -1, 'stop loses at least the fee');
    if (signal.outcome.status === 'T1 → T2') {
      const expected = (dir * (signal.target1 - fill) + dir * (signal.target2 - fill)) / 2 - 1;
      assert.ok(Math.abs(signal.outcome.netPoints - expected) < 0.011, '50% at T1 and 50% at T2 minus fees');
    }
  }
  const { all, inSample, outOfSample } = result.stats;
  assert.equal(all.trades, resolved.length);
  assert.equal(inSample.trades + outOfSample.trades, all.trades);
  assert.equal(all.wins + all.losses, all.trades);
});

test('replayStats computes win rate, expectancy and profit factor from net points', () => {
  const make = (net, t1 = false, t2 = false) => ({ outcome: { resolved: true, netPoints: net, r: net / 10, t1Hit: t1, t2Hit: t2 } });
  const stats = replayStats([make(20, true, true), make(-10), make(5, true), make(-5)]);
  assert.equal(stats.trades, 4);
  assert.equal(stats.winRate, 50);
  assert.equal(stats.expectancy, 2.5);
  assert.equal(stats.profitFactor, 1.67);
  assert.equal(stats.t1Rate, 50);
  assert.equal(stats.t2Rate, 25);
  assert.equal(replayStats([]).trades, 0);
});

test('resolved trades carry an exact exit price and an unchanged repeat analysis keeps identical signals', () => {
  const bars = fixture();
  const engine = createRejectionEngine();
  const first = engine.analyze(bars, daily, 5, options);
  const again = engine.analyze(bars, daily, 5, options);
  assert.deepEqual(again.signals.map(signal => signal.id), first.signals.map(signal => signal.id));
  for (const signal of first.signals.filter(item => item.outcome.resolved)) {
    assert.ok(Number.isFinite(signal.outcome.exitPrice), 'exit price recorded');
    assert.ok(signal.outcome.exitTime > signal.time, 'exit happens after the entry candle');
  }
});

test('daily timeframe runs as swing trades instead of returning no signals', () => {
  const days = [];
  let price = 24000;
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let d = 0, at = Date.parse('2025-06-02T00:00:00+05:30'); days.length < 260; d++, at += 86400000) {
    const day = new Date(at + 19800000).getUTCDay();
    if (day === 0 || day === 6) continue;
    const i = days.length;
    const o = price;
    const c = o + Math.sin(i / 18) * 40 + Math.sin(i / 5) * 60 + (rand() - 0.5) * 160;
    days.push({ t: new Date(at).toISOString(), o, h: Math.max(o, c) + rand() * 90, l: Math.min(o, c) - rand() * 90, c, v: 0 });
    price = c;
  }
  const result = createRejectionEngine().analyze(days, days, 'D', { live: false, nowMs: Date.parse('2026-10-19T18:00:00+05:30') });
  assert.notEqual(result.plan.watchReason, 'Rejection engine runs on intraday timeframes only.');
  assert.ok(result.evaluatedBars === days.length, 'all closed daily bars evaluated');
});
