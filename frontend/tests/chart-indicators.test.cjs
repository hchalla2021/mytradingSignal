const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { performance } = require('node:perf_hooks');

function load(name, imports = {}) {
  const source = readFileSync(path.join(__dirname, '..', 'lib', `${name}.ts`), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const context = { exports: {}, require: id => {
    assert.ok(id in imports, `Unexpected import ${id}`);
    return imports[id];
  } };
  vm.runInNewContext(compiled, context);
  return context.exports;
}
const workspace = load('chart-workspace');
const { createIndicatorEngine, createPivotEngine, calculatePivotSeries, autoPivotAnchor, pivotValues, segmentedLine, indicatorLineTitle } =
  load('chart-indicators', { './chart-workspace': workspace });
const { DEFAULT_INDICATORS, TEMPLATES, candleTime, restoreIndicatorSettings } = workspace;
const all = { ...DEFAULT_INDICATORS, emaCross: true, macd: true, pivots: true };
const base = Date.parse('2026-10-01T09:15:00+05:30');
const candle = (index, close = 100, volume = 10) => ({
  t: new Date(base + index * 300000).toISOString(),
  o: close, h: close + 2, l: close - 2, c: close, v: volume,
});
const candles = count => Array.from({ length: count }, (_, i) => candle(i, 100 + i / 10 + Math.sin(i) * 2));
const defined = values => values.filter(point => point.value !== undefined);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const plain = value => JSON.parse(JSON.stringify(value));

test('balanced startup preset enables complementary indicators and renders only their calculated series', () => {
  const settings = TEMPLATES['Confluence focus'];
  assert.deepEqual(Object.keys(settings).filter(id => settings[id]).sort(),
    ['ema9', 'ema20', 'ema50', 'ema100', 'ema200', 'supertrend', 'camarilla', 'volume', 'vwap', 'cpr', 'rsi', 'atr'].sort());
  const input = candles(250);
  const engine = createIndicatorEngine();
  const first = engine.calculate(input, settings, true);
  assert.deepEqual(Object.keys(first.series).sort(), ['ema9', 'ema20', 'ema50', 'ema100', 'ema200', 'vwap', 'rsi', 'atr', 'supertrendUp', 'supertrendDown'].sort());
  for (const id of Object.keys(first.series).filter(id => !id.startsWith('supertrend'))) assert.ok(Number.isFinite(first.series[id].at(-1).value), id);
  const initialValues = Object.fromEntries(Object.entries(first.series).map(([id, values]) => [id, values.at(-1).value]));
  const revised = input.slice();
  revised[249] = { ...input[249], c: input[249].c + 1, h: input[249].h + 1 };
  const live = engine.calculate(revised, settings, true);
  assert.equal(live.processedBars, 1);
  for (const id of ['ema9', 'ema20', 'ema50', 'ema100', 'ema200', 'vwap', 'rsi']) assert.notEqual(live.series[id].at(-1).value, initialValues[id], id);
  const noVolume = createIndicatorEngine().calculate(input.map(bar => ({ ...bar, v: 0 })), settings, true);
  assert.equal(defined(noVolume.series.vwap).length, 0);
  assert.equal(defined(createIndicatorEngine().calculate(input.slice(0, 199), settings, true).series.ema200).length, 0);
});

test('every overlay and pane has a distinct readable indicator label', () => {
  for (const period of [9, 20, 50, 100, 200, 13, 21]) assert.equal(indicatorLineTitle(`ema${period}`), `EMA ${period}`);
  const titles = [];
  for (const [family, levels] of Object.entries(pivotValues(120, 90, 110))) {
    for (const level of Object.keys(levels)) {
      const title = indicatorLineTitle(`${family}:${level}`);
      assert.ok(title.endsWith(` ${level}`));
      titles.push(title);
    }
  }
  assert.equal(new Set(titles).size, titles.length);
  assert.equal(indicatorLineTitle('traditional:S3'), 'Pivot S3');
  assert.equal(indicatorLineTitle('camarilla:R3'), 'Cam R3');
  assert.equal(indicatorLineTitle('cpr:TC'), 'CPR TC');
  assert.equal(indicatorLineTitle('cpr:BC'), 'CPR BC');
  for (const id of ['vwap', 'supertrendUp', 'supertrendDown', 'rsi', 'macd', 'signal', 'histogram', 'atr', 'volume']) {
    assert.ok(indicatorLineTitle(id).length > 0);
    assert.notEqual(indicatorLineTitle(id), id);
  }
});

test('every enabled indicator has aligned real samples and explicit warm-up whitespace', () => {
  const input = candles(250);
  const { series } = createIndicatorEngine().calculate(input, all, true);
  for (const id of ['ema9', 'ema20', 'ema50', 'ema100', 'ema200', 'ema13', 'ema21', 'rsi', 'macd', 'signal', 'histogram', 'atr', 'vwap', 'supertrendUp', 'supertrendDown']) {
    assert.equal(series[id].length, input.length, id);
    assert.equal(series[id][0].time, candleTime(input[0]));
  }
  for (const period of [9, 20, 50, 100, 200, 13, 21]) {
    assert.equal(series[`ema${period}`][period - 2].value, undefined);
    assert.ok(Number.isFinite(series[`ema${period}`][period - 1].value));
  }
  assert.equal(series.rsi[13].value, undefined);
  assert.equal(series.signal[32].value, undefined);
  assert.equal(series.atr[12].value, undefined);
});

test('incremental EMA, Wilder RSI, MACD and session VWAP match reference calculations', () => {
  const input = candles(250);
  const { series } = createIndicatorEngine().calculate(input, all, true);
  const compare = (actual, expected) => {
    assert.equal(actual.length, expected.length);
    actual.forEach((point, index) => {
      assert.equal(point.time, expected[index].time);
      near(point.value, expected[index].value);
    });
  };
  for (const period of [9, 20, 50, 100, 200, 13, 21]) {
    compare(defined(series[`ema${period}`]), workspace.ema(input, period));
  }
  compare(defined(series.rsi), workspace.rsi(input));
  compare(defined(series.vwap), workspace.vwap(input));
  const reference = workspace.macd(input);
  compare(defined(series.macd), reference.line);
  compare(defined(series.signal), reference.signal);
  compare(defined(series.histogram), reference.histogram);
});

test('ATR and Supertrend use true range, Wilder smoothing, and separate direction colors', () => {
  const input = Array.from({ length: 14 }, (_, i) => candle(i));
  const engine = createIndicatorEngine();
  let result = engine.calculate(input, all, true);
  near(result.series.atr[13].value, 4);
  near(result.series.supertrendDown[9].value, 108);
  assert.equal(result.series.supertrendUp[9].value, undefined);
  input.push(candle(14, 120));
  result = engine.calculate(input.slice(), all, true);
  near(result.series.atr[14].value, (4 * 13 + 22) / 14);
  assert.ok(Number.isFinite(result.series.supertrendUp[14].value));
  assert.equal(result.series.supertrendDown[14].value, undefined);
  input.push(candle(15, 80));
  result = engine.calculate(input.slice(), all, true);
  assert.ok(Number.isFinite(result.series.supertrendDown[15].value));
  assert.equal(result.series.supertrendUp[15].value, undefined);
});

test('Supertrend plotting breaks inactive segments instead of bridging whitespace gaps', () => {
  const output = segmentedLine([
    { time: 0 }, { time: 1, value: 100 }, { time: 2, value: 101 },
    { time: 3 }, { time: 4 }, { time: 5, value: 110 }, { time: 6, value: 111 },
  ], '#00bba5');
  assert.equal(output[0].value, undefined);
  assert.equal(output[1].color, '#00bba5');
  assert.equal(output[2].color, 'transparent');
  assert.equal(output[3].color, 'transparent');
  assert.equal(output[4].color, 'transparent');
  assert.equal(output[5].color, '#00bba5');
  assert.equal(output[5].value, 110);
  assert.equal(output[6].color, '#00bba5', 'Newest active value remains visible');
});

test('tail revisions, append, corrections, prepends, and toggles match fresh calculations', () => {
  const engine = createIndicatorEngine();
  let input = candles(230);
  engine.calculate(input, all, true);
  input = [...input.slice(0, -1), candle(229, 126, 50)];
  let result = engine.calculate(input, all, true);
  assert.equal(result.processedBars, 1);
  assert.equal(result.rebuilt, false);
  assert.deepEqual(plain(result.series), plain(createIndicatorEngine().calculate(input, all, true).series));
  assert.equal(engine.calculate(input, all, true), result, 'Repeated render is idempotent');
  input = [...input, candle(230, 125)];
  result = engine.calculate(input, all, true);
  assert.equal(result.processedBars, 1);
  assert.deepEqual(plain(result.series), plain(createIndicatorEngine().calculate(input, all, true).series));
  input = input.map((bar, index) => index === 50 ? candle(index, 106) : bar);
  result = engine.calculate(input, all, true);
  assert.equal(result.rebuilt, true);
  assert.deepEqual(plain(result.series), plain(createIndicatorEngine().calculate(input, all, true).series));
  input = [candle(-1, 99), ...input];
  result = engine.calculate(input, all, true);
  assert.equal(result.rebuilt, true);
  assert.deepEqual(plain(result.series), plain(createIndicatorEngine().calculate(input, all, true).series));
  assert.deepEqual(Object.keys(engine.calculate(input, TEMPLATES['Clean Chart'], true).series), []);
  assert.deepEqual(plain(engine.calculate(input, all, true).series), plain(result.series));
});

test('VWAP resets each IST session, never invents volume, and is intraday only', () => {
  const input = [candle(0, 100, 0), candle(1, 102, 10), { ...candle(2, 200), t: '2026-10-02T09:15:00+05:30' }];
  const engine = createIndicatorEngine();
  const { series } = engine.calculate(input, all, true);
  assert.equal(series.vwap[0].value, undefined);
  near(series.vwap[1].value, 102);
  near(series.vwap[2].value, 200);
  assert.equal(engine.calculate(input, all, false).series.vwap, undefined);
});

test('futures VWAP uses contract volume and switching expiry replaces all prior-contract calculations', () => {
  const settings = { ...TEMPLATES['Clean Chart'], vwap: true };
  const engine = createIndicatorEngine();
  const october = candles(250);
  const november = october.map((bar, index) => ({
    ...bar, o: bar.o + 50, h: bar.h + 50, l: bar.l + 50, c: bar.c + 50, v: (index + 1) * 65,
  }));
  engine.calculate(october, settings, true);
  const switched = engine.calculate(november, settings, true);
  const fresh = createIndicatorEngine().calculate(november, settings, true);
  assert.deepEqual(plain(switched.series), plain(fresh.series));
  assert.deepEqual(Object.keys(switched.series), ['vwap']);
  const session = workspace.sessionDate(candleTime(november.at(-1)));
  const current = november.filter(bar => workspace.sessionDate(candleTime(bar)) === session);
  const expected = current.reduce((sum, bar) => sum + (bar.h + bar.l + bar.c) / 3 * bar.v, 0) /
    current.reduce((sum, bar) => sum + bar.v, 0);
  near(switched.series.vwap.at(-1).value, expected);
  const changed = november.slice();
  changed[249] = { ...changed[249], c: changed[249].c + 1, h: changed[249].h + 1, v: changed[249].v + 650 };
  const updated = engine.calculate(changed, settings, true);
  assert.equal(updated.processedBars, 1);
  assert.deepEqual(plain(updated.series), plain(createIndicatorEngine().calculate(changed, settings, true).series));
  assert.equal(createIndicatorEngine().calculate(november, settings, false).series.vwap, undefined);
});

test('pivot formulas include all Traditional/Camarilla levels and ordered CPR', () => {
  const result = pivotValues(120, 100, 110);
  near(result.traditional.P, 110);
  for (let level = 1; level <= 5; level++) {
    near(result.traditional[`R${level}`], 110 + level * 10);
    near(result.traditional[`S${level}`], 110 - level * 10);
  }
  near(result.camarilla.R3, 115.5);
  near(result.camarilla.S3, 104.5);
  near(result.camarilla.R4, 121);
  near(result.camarilla.R5, 132);
  near(result.camarilla.S5, 88);
  const cpr = pivotValues(120, 100, 118).cpr;
  assert.ok(cpr.TC >= cpr.P && cpr.P >= cpr.BC);
});

const day = (date, close = 110) => ({ t: `${date}T00:00:00+05:30`, o: 110, h: 120, l: 100, c: close, v: 0 });
test('Auto anchors and previous completed period levels exclude current-period lookahead', () => {
  for (const [timeframe, expected] of [[3, 'D'], [15, 'D'], [30, 'W'], [60, 'W'], ['D', 'M'], ['W', 'Y'], ['M', 'Y']]) {
    assert.equal(autoPivotAnchor(timeframe), expected);
  }
  for (const [timeframe, prior, current] of [
    [5, '2026-09-30', '2026-10-01'], [30, '2026-09-25', '2026-10-01'],
    ['D', '2026-09-30', '2026-10-01'], ['W', '2025-12-31', '2026-10-01'], ['M', '2025-12-31', '2026-10-01'],
  ]) {
    const chart = [day(current)];
    const context = [day(prior), { ...day(current), h: 200, c: 190 }];
    const output = calculatePivotSeries(chart, context, timeframe, all);
    near(output['traditional:P'][0].value, 110);
    near(output['camarilla:R3'][0].value, 115.5);
    if (typeof timeframe === 'number') assert.ok(output['cpr:P']);
    else assert.equal(output['cpr:P'], undefined);
  }
  assert.deepEqual(Object.keys(calculatePivotSeries([day('2026-10-01')], [], 5, all)), []);
});

test('pivot series retain exactly the last 15 periods with aligned whitespace', () => {
  const daily = Array.from({ length: 22 }, (_, i) => day(`2026-10-${String(i + 1).padStart(2, '0')}`));
  const chart = daily.slice(1);
  const output = calculatePivotSeries(chart, daily, 5, all);
  assert.equal(Object.keys(output).length, 25);
  for (const values of Object.values(output)) {
    assert.equal(values.length, chart.length);
    assert.equal(defined(values).length, 15);
    assert.equal(values[5].value, undefined);
    assert.ok(Number.isFinite(values[6].value));
  }
});

test('pivot cache reuses price-only updates and rebuilds for new sessions, daily corrections and prepends', () => {
  const engine = createPivotEngine();
  const context = [day('2026-09-30'), day('2026-10-01')];
  let input = candles(50);
  const initial = engine.calculate(input, context, 5, all);
  input = [...input.slice(0, -1), candle(49, 150)];
  assert.equal(engine.calculate(input, context, 5, all), initial);
  input = [...input, candle(50, 151)];
  const appended = engine.calculate(input, context, 5, all);
  assert.equal(appended, initial);
  assert.deepEqual(plain(appended), plain(calculatePivotSeries(input, context, 5, all)));
  input = [...input, { ...candle(0), t: '2026-10-02T09:15:00+05:30' }];
  const nextSession = engine.calculate(input, context, 5, all);
  assert.notEqual(nextSession, initial);
  assert.deepEqual(plain(nextSession), plain(calculatePivotSeries(input, context, 5, all)));
  const correctedContext = [context[0], { ...context[1], c: 118 }];
  const corrected = engine.calculate(input, correctedContext, 5, all);
  near(corrected['traditional:P'].at(-1).value, (120 + 100 + 118) / 3);
  input = [{ ...candle(-1), t: '2026-09-30T15:25:00+05:30' }, ...input];
  assert.deepEqual(plain(engine.calculate(input, correctedContext, 5, all)),
    plain(calculatePivotSeries(input, correctedContext, 5, all)));
  assert.deepEqual(Object.keys(engine.calculate(input, context, 5, TEMPLATES['Clean Chart'])), []);
});

test('older saved templates migrate only new keys and preserve explicit visibility', () => {
  const legacy = { ...DEFAULT_INDICATORS, ema20: false };
  for (const key of ['supertrend', 'camarilla', 'emaCross', 'atr']) delete legacy[key];
  const restored = restoreIndicatorSettings(legacy);
  assert.equal(restored.ema20, false);
  assert.equal(restored.supertrend, true);
  assert.equal(restored.atr, true);
  assert.equal(restoreIndicatorSettings({ ...legacy, ema20: 'false' }), null);
  delete legacy.ema9;
  assert.equal(restoreIndicatorSettings(legacy), null);
  assert.equal(TEMPLATES['Image Layout'].rsi, true);
  assert.equal(TEMPLATES['Image Layout'].atr, true);
  assert.equal(TEMPLATES['Image Layout'].pivots, false);
});

test('large-history live updates recalculate only one candle', context => {
  const input = candles(20000);
  const engine = createIndicatorEngine();
  const start = performance.now();
  engine.calculate(input, all, true);
  const fullMs = performance.now() - start;
  const updated = [...input.slice(0, -1), candle(input.length - 1, input.at(-1).c + 1)];
  const tailStart = performance.now();
  const result = engine.calculate(updated, all, true);
  const tailMs = performance.now() - tailStart;
  assert.equal(result.processedBars, 1);
  assert.equal(result.rebuilt, false);
  assert.ok(tailMs < 250, `Single live update exceeded 250ms: ${tailMs}`);
  context.diagnostic(`20,000 bars: full ${fullMs.toFixed(1)}ms; live tail ${tailMs.toFixed(1)}ms; processed ${result.processedBars} bar`);
  const pivotEngine = createPivotEngine();
  const daily = [day('2026-09-30'), day('2026-10-01')];
  const pivotStart = performance.now();
  const original = pivotEngine.calculate(input, daily, 5, all);
  const fullPivotMs = performance.now() - pivotStart;
  const pivotTailStart = performance.now();
  assert.equal(pivotEngine.calculate(updated, daily, 5, all), original);
  const pivotTailMs = performance.now() - pivotTailStart;
  assert.ok(pivotTailMs < 100, `Price-only pivot update exceeded 100ms: ${pivotTailMs}`);
  context.diagnostic(`20,000 bars: pivots full ${fullPivotMs.toFixed(1)}ms; cached live update ${pivotTailMs.toFixed(1)}ms`);
});
