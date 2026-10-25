const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { performance } = require('node:perf_hooks');
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
const { createLevelAnalysisEngine, classifyLevelReaction } = load('chart-level-analysis');
const { ema } = load('chart-workspace');
const nowMs = Date.parse('2026-10-19T11:30:00+05:30');
const options = { live: true, nowMs, minVolumeRatio: 1.2 };
const emptyDaily = [];

function sessionTimes(count) {
  const result = [];
  let time = nowMs - 300000;
  while (result.length < count) {
    const ist = new Date(time + 19800000);
    const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    if (ist.getUTCDay() > 0 && ist.getUTCDay() < 6 && minutes >= 555 && minutes < 930) result.unshift(new Date(time).toISOString());
    time -= 300000;
  }
  return result;
}
function fixture(sell = false, count = 260, phase = 5.8, delta = .2, lowerWick = .5) {
  const times = sessionTimes(count);
  const bars = times.map((t, i) => {
    const c = 100 + i * .03 + Math.sin(i * Math.PI / 8 + phase) * .5;
    return { t, o: c - .03, h: c + .15, l: c - .15, c, v: 0 };
  });
  const last = bars.at(-1);
  const previous = bars.at(-2);
  Object.assign(last, { o: previous.c - .1, c: previous.c + delta, h: previous.c + delta + .05, l: previous.c - lowerWick });
  return sell ? bars.map(bar => ({ ...bar, o: 220 - bar.o, c: 220 - bar.c, h: 220 - bar.l, l: 220 - bar.h })) : bars;
}
const plain = value => JSON.parse(JSON.stringify(value));

test('classifies completed-candle support/rejection and crosses without predicting the next candle', () => {
  const previous = { o: 101, c: 101, h: 102, l: 100 };
  assert.equal(classifyLevelReaction({ o: 100.5, c: 101.5, h: 101.6, l: 99.9 }, previous, 100, 2), 'Support bounce');
  assert.equal(classifyLevelReaction({ o: 99, c: 98, h: 100.1, l: 97.9 }, { ...previous, c: 99 }, 100, 2), 'Resistance rejection');
  assert.equal(classifyLevelReaction({ o: 99.9, c: 100.8, h: 101, l: 99.8 }, { ...previous, c: 99.9 }, 100, 2), 'Break above');
  assert.equal(classifyLevelReaction({ o: 100.1, c: 99.2, h: 100.2, l: 99 }, { ...previous, c: 100.1 }, 100, 2), 'Break below');
  assert.equal(classifyLevelReaction({ o: 100.01, c: 100.02, h: 100.1, l: 99.9 }, previous, 100, 2), 'Testing');
});

test('all EMA values use full loaded history, including hidden EMA 100/200', () => {
  const bars = fixture();
  const result = createLevelAnalysisEngine().analyze(bars, emptyDaily, 5, options);
  for (const period of [9, 20, 50, 100, 200]) {
    const level = result.levels.find(level => level.id === `ema${period}`);
    assert.ok(level, `EMA ${period}`);
    assert.ok(Math.abs(level.price - ema(bars, period).at(-1).value) < 1e-8);
    assert.ok(level.touches >= level.holds);
    assert.ok(['Support', 'Resistance', 'Testing'].includes(level.role));
  }
});

test('symmetric level-bounce BUY/SELL plans are close-confirmed and explicitly volume-unverified', () => {
  for (const sell of [false, true]) {
    const result = createLevelAnalysisEngine().analyze(fixture(sell), emptyDaily, 5, options);
    assert.equal(result.plan.direction, sell ? 'SELL' : 'BUY');
    assert.equal(result.plan.conditional, false);
    assert.equal(result.plan.volumeVerified, false);
    assert.equal(result.volume, 'Unverified');
    assert.match(result.plan.basis, sell ? /Resistance rejection/ : /Support bounce/);
    assert.ok(result.plan.confirmation.some(reason => /Volume UNVERIFIED/.test(reason)));
    const sign = sell ? -1 : 1;
    assert.ok(sign * (result.plan.entry - result.plan.stopLoss) > 0);
    assert.ok(sign * (result.plan.exitPrice - result.plan.entry) >= result.plan.riskPoints);
    assert.ok(sign * (result.plan.exitPrice - result.plan.entry) <= 2 * result.plan.riskPoints + .05);
  }
});

test('completed level crosses produce symmetric breakout and breakdown plans', () => {
  for (const sell of [false, true]) {
    const result = createLevelAnalysisEngine().analyze(fixture(sell, 260, 2.2, .5, .15), emptyDaily, 5, options);
    assert.equal(result.plan.direction, sell ? 'SELL' : 'BUY');
    assert.match(result.plan.basis, sell ? /Break below/ : /Break above/);
  }
});

test('daily pivots and CPR exclude today/future daily candles, and prior range context is labeled', () => {
  const bars = fixture();
  const daily = [
    { t: '2026-09-30T00:00:00+05:30', o: 100, h: 120, l: 80, c: 100, v: 0 },
    { t: '2026-10-16T00:00:00+05:30', o: 100, h: 110, l: 90, c: 100, v: 0 },
  ];
  const engine = createLevelAnalysisEngine();
  const original = engine.analyze(bars, daily, 5, options);
  assert.equal(original.levels.find(level => level.id === 'traditional:P').price, 100);
  assert.equal(original.levels.find(level => level.id === 'cpr:TC').price, 100);
  assert.equal(original.levels.find(level => level.id === 'camarilla:R3').price, 105.5);
  assert.equal(original.levels.find(level => level.id === 'week:high').price, 110);
  assert.equal(original.levels.find(level => level.id === 'month:high').price, 120);
  const future = { t: '2026-10-20T00:00:00+05:30', o: 500, h: 600, l: 400, c: 500, v: 0 };
  const changed = engine.analyze(bars, [...daily, { ...future, t: '2026-10-19T00:00:00+05:30' }, future], 5, options);
  assert.deepEqual(plain(changed.levels), plain(original.levels));
  assert.equal(changed.plan.entry, original.plan.entry);
});

test('forming candles cannot confirm a reaction, and intrabar target/stop touches withdraw a setup', () => {
  const bars = fixture();
  const engine = createLevelAnalysisEngine();
  const original = engine.analyze(bars, emptyDaily, 5, options);
  const forming = { t: new Date(nowMs).toISOString(), o: original.plan.entry, c: original.plan.entry,
    h: original.plan.entry + .05, l: original.plan.entry - .05, v: 0 };
  const stable = engine.analyze([...bars, forming], emptyDaily, 5, { ...options, nowMs: nowMs + 10000 });
  assert.equal(stable.levels, original.levels);
  assert.equal(stable.plan.entry, original.plan.entry);
  for (const touched of [
    { ...forming, l: original.plan.stopLoss },
    { ...forming, h: original.plan.exitPrice },
  ]) {
    const result = engine.analyze([...bars, touched], emptyDaily, 5, { ...options, nowMs: nowMs + 10000 });
    assert.equal(result.plan.direction, 'WAIT');
    assert.match(result.plan.watchReason, /already touched/);
    assert.equal(result.plan.entry, undefined);
  }
});

test('observed weak volume is rejected rather than treated as missing, and a volume surge verifies the setup', () => {
  const bars = fixture().map(bar => ({ ...bar, v: 100 }));
  const engine = createLevelAnalysisEngine();
  const weak = engine.analyze(bars, emptyDaily, 5, options);
  assert.equal(weak.plan.direction, 'WAIT');
  assert.match(weak.plan.watchReason, /Observed volume/);
  const strong = engine.analyze([...bars.slice(0, -1), { ...bars.at(-1), v: 200 }], emptyDaily, 5, options);
  assert.equal(strong.plan.direction, 'BUY');
  assert.equal(strong.plan.volumeVerified, true);
});

test('stale data, insufficient history, higher timeframes and chased entries never emit executable levels', () => {
  for (const [bars, timeframe, settings, reason] of [
    [fixture(), 5, { ...options, live: false }, /Fresh live/],
    [fixture(), 5, { ...options, nowMs: nowMs + 360000 }, /fresh completed/],
    [fixture().slice(-100), 5, options, /EMA 200/],
    [fixture(), 'D', options, /Higher timeframes/],
    [fixture(), 5, { ...options, latestPrice: 108.7 }, /moved away|already touched/],
  ]) {
    const result = createLevelAnalysisEngine().analyze(bars, emptyDaily, timeframe, settings);
    assert.equal(result.plan.direction, 'WAIT');
    assert.equal(result.plan.entry, undefined);
    assert.match(result.plan.watchReason, reason);
  }
});

test('nearby overhead structure prevents a level entry with insufficient reward room', () => {
  const daily = [{ t: '2026-10-16T00:00:00+05:30', o: 107, h: 108.2, l: 100, c: 107, v: 0 }];
  const result = createLevelAnalysisEngine().analyze(fixture(), daily, 5, options);
  assert.equal(result.plan.direction, 'WAIT');
  assert.match(result.plan.watchReason, /less than 1R/);
  assert.equal(result.plan.exitPrice, undefined);
});

test('timer-only and forming-only updates reuse level evidence, while corrected historical bars rebuild correctly', () => {
  const bars = fixture();
  const engine = createLevelAnalysisEngine();
  const original = engine.analyze(bars, emptyDaily, 5, options);
  assert.equal(engine.analyze(bars, emptyDaily, 5, { ...options, nowMs: nowMs + 1000 }).levels, original.levels);
  const corrected = bars.map((bar, i) => i === 100 ? { ...bar, c: bar.c + .1, h: bar.h + .1 } : bar);
  const revised = engine.analyze(corrected, emptyDaily, 5, options);
  const reference = createLevelAnalysisEngine().analyze(corrected, emptyDaily, 5, options);
  assert.notEqual(revised.levels, original.levels);
  assert.deepEqual(plain(revised.levels), plain(reference.levels));
});

test('incremental revisions match a fresh engine and process exactly one live candle', t => {
  const bars = fixture(false, 5000);
  const engine = createLevelAnalysisEngine();
  engine.analyze(bars, emptyDaily, 5, options);
  const tail = { ...bars.at(-1), c: bars.at(-1).c + .01, h: bars.at(-1).h + .01 };
  const updated = [...bars.slice(0, -1), tail];
  const start = performance.now();
  const result = engine.analyze(updated, emptyDaily, 5, options);
  const elapsed = performance.now() - start;
  const reference = createLevelAnalysisEngine().analyze(updated, emptyDaily, 5, options);
  assert.equal(result.processedBars, 1);
  assert.deepEqual(plain(result.levels), plain(reference.levels));
  assert.deepEqual(plain(result.plan), plain(reference.plan));
  assert.ok(elapsed < 100, `5000-bar tail update took ${elapsed.toFixed(1)}ms`);
  t.diagnostic(`5000 bars: ${elapsed.toFixed(1)}ms tail update; one indicator candle processed; evidence bounded to 500 bars/level`);
});
