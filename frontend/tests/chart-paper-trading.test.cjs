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
const { createChartPaperAnalyzer } = load('chart-paper-trading');
const { createIndicatorEngine, pivotValues } = load('chart-indicators');
const { DEFAULT_INDICATORS } = load('chart-workspace');
const now = Date.parse('2026-10-19T11:30:00+05:30');
const plan = { direction: 'WAIT', score: 0, requiredScore: 3, confirmation: [], watchReason: '' };
function fixture() {
  const times = [];
  let at = now - 300000;
  while (times.length < 260) {
    const ist = new Date(at + 19800000);
    const minute = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    if (ist.getUTCDay() > 0 && ist.getUTCDay() < 6 && minute >= 555 && minute < 930) times.unshift(new Date(at).toISOString());
    at -= 300000;
  }
  return times.map((t, i) => {
    const c = 100 + i * .03 + Math.sin(i * Math.PI / 8 + 5.8) * .5;
    return { t, o: c - .03, c, h: c + .15, l: c - .15, v: 0 };
  });
}
const daily = [{ t: '2026-10-16T00:00:00+05:30', o: 100, h: 110, l: 90, c: 100, v: 0 }];
const plain = value => JSON.parse(JSON.stringify(value));

test('paper analysis uses exact chart EMA/pivot formulas and records missing cash volume without futures substitution', () => {
  const bars = fixture();
  const frame = createChartPaperAnalyzer().analyze('NIFTY', bars, daily, 5, now, plan);
  assert.equal(frame.source, 'observatory-chart');
  const { series } = createIndicatorEngine().calculate(bars, DEFAULT_INDICATORS, true);
  for (const period of [9, 20, 50, 100, 200]) {
    assert.equal(frame.setup.ema[`ema${period}`].current, series[`ema${period}`].at(-1).value);
  }
  const pivots = pivotValues(110, 90, 100);
  assert.equal(frame.setup.levels.find(level => level.id === 'cpr TC').price, pivots.cpr.TC);
  assert.equal(frame.setup.levels.find(level => level.id === 'camarilla R3').price, pivots.camarilla.R3);
  assert.equal(frame.setup.volume.status, 'UNAVAILABLE');
  assert.equal(frame.setup.vwap, undefined);
  assert.ok(!frame.signals.some(signal => signal.tags.includes('Cash VWAP aligned')));
  assert.equal(frame.setup.previous_day.t, daily[0].t);
});

test('forming candles cannot change confirmed signals or setup evidence', () => {
  const bars = fixture();
  const analyzer = createChartPaperAnalyzer();
  const expected = analyzer.analyze('NIFTY', bars, daily, 5, now, plan);
  const forming = { t: new Date(now).toISOString(), o: 100, h: 1000, l: 1, c: 900, v: 100000 };
  const actual = analyzer.analyze('NIFTY', [...bars, forming], daily, 5, now, plan);
  assert.deepEqual(plain(actual), plain(expected));
});

test('cash paper books never evaluate VWAP even when candles carry positive volume', () => {
  const bars = fixture().map(bar => ({ ...bar, v: 1000 }));
  const frame = createChartPaperAnalyzer().analyze('NIFTY', bars, daily, 5, now, plan);
  assert.ok(frame);
  assert.equal(frame.setup.vwap, undefined);
  assert.ok(frame.setup.levels.every(level => !level.id.includes('VWAP')));
  assert.ok(frame.signals.every(signal => !JSON.stringify(signal).includes('VWAP')));
});

test('rejects stale candles, future candles, closed markets and higher timeframes', () => {
  const bars = fixture();
  const analyzer = createChartPaperAnalyzer();
  for (const timeframe of ['D', 'W', 'M'])
    assert.equal(analyzer.analyze('NIFTY', bars, daily, timeframe, now, plan), null);
  assert.equal(analyzer.analyze('NIFTY', bars, daily, 5, now + 300000, plan), null);
  assert.equal(analyzer.analyze('NIFTY', bars, daily, 5, Date.parse('2026-10-19T16:00:00+05:30'), plan), null);
  assert.equal(analyzer.analyze('NIFTY', bars.map(bar => ({ ...bar, t: new Date(now + 300000).toISOString() })), daily, 5, now, plan), null);
});

test('future daily data is not allowed to contaminate pivots or previous-day levels', () => {
  const bars = fixture();
  const analyzer = createChartPaperAnalyzer();
  const expected = analyzer.analyze('NIFTY', bars, daily, 5, now, plan);
  const actual = analyzer.analyze('NIFTY', bars, [...daily, { t: '2026-10-19T00:00:00+05:30', h: 1000, l: 1, c: 900, o: 100, v: 0 }], 5, now, plan);
  assert.deepEqual(plain(actual.setup.levels), plain(expected.setup.levels));
});

test('directional breakouts and bounce books use stable keys for reversals', () => {
  const bars = fixture();
  const previous = bars.at(-2);
  Object.assign(bars.at(-1), { o: previous.c - .1, c: previous.c + .5, h: previous.c + .55, l: previous.c - .5 });
  const buy = createChartPaperAnalyzer().analyze('NIFTY', bars, daily, 5, now, plan);
  const sellBars = bars.map(bar => ({ ...bar, o: 220 - bar.o, c: 220 - bar.c, h: 220 - bar.l, l: 220 - bar.h }));
  const sell = createChartPaperAnalyzer().analyze('NIFTY', sellBars, [], 5, now, plan);
  const entry = buy.signals.find(signal => signal.strategy.startsWith('EMA ') && signal.side === 'BUY');
  assert.ok(entry);
  assert.ok(sell.signals.some(signal => signal.strategy === entry.strategy && signal.side === 'SELL'));
  assert.ok(buy.signals.every(signal => signal.rationale.length && signal.tags.length));
  assert.ok(buy.signals.length <= 100);
});

test('chart confirmed plans are included but WATCH plans never become confirmed paper setups', () => {
  const bars = fixture();
  const analyzer = createChartPaperAnalyzer();
  const confirmed = { ...plan, direction: 'BUY', candleTime: Date.parse(bars.at(-1).t) / 1000, conditional: false,
    confirmation: ['Chart EMA trend and level bounce'] };
  const frame = analyzer.analyze('BANKNIFTY', bars, daily, 5, now, confirmed);
  assert.ok(frame.signals.some(signal => signal.strategy === 'Chart confirmed setup'));
  const watch = analyzer.analyze('BANKNIFTY', bars, daily, 5, now, { ...confirmed, conditional: true });
  assert.ok(!watch.signals.some(signal => signal.strategy === 'Chart confirmed setup'));
});
