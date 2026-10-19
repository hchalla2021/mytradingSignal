const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = readFileSync(path.join(__dirname, '..', 'lib', 'chart-workspace.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const context = { exports: {} };
vm.runInNewContext(compiled, context);
const { candleTime, workspaceCandles, mergeChartHistory, updatePeriodCandle, timeframeLabel, ema, rsi, macd, vwap, dailyLevels, deriveTradePlan, deriveConditionalTradePlan, selectTradeOverlay, institutionalContext, isCashSession, isIndicatorSettings, DEFAULT_INDICATORS } = context.exports;
const base = Date.parse('2026-10-15T09:15:00+05:30');
const candle = (index, close = 100, volume = 10) => ({
  t: new Date(base + index * 300000).toISOString(),
  o: close - 1, h: close + 2, l: close - 2, c: close, v: volume,
});
const data = candles => ({ candles5m: candles, candles3m: candles, levels: { pdh: 120, pdl: 90 } });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('normalizes timestamps, sorts, deduplicates and rejects invalid OHLCV', () => {
  const first = candle(0);
  const latest = { ...first, c: 101 };
  const result = workspaceCandles(data([candle(1), first, { ...candle(2), h: 90 }, latest, { ...candle(3), v: -1 }]), 5);
  assert.equal(result.length, 2);
  assert.equal(result[0].c, 101);
  assert.equal(candleTime({ ...first, t: '2026-10-15T09:15:00' }), base / 1000);
  assert.equal(workspaceCandles(null, 5).length, 0);
});

test('aggregates true OHLCV from the 09:15 session open', () => {
  const input = Array.from({ length: 9 }, (_, i) => candle(i, 100 + i, 10 + i));
  const result = workspaceCandles(data(input), 15);
  assert.equal(result.length, 3);
  assert.equal(candleTime(result[0]), base / 1000);
  assert.equal(result[0].o, 99);
  assert.equal(result[0].h, 104);
  assert.equal(result[0].l, 98);
  assert.equal(result[0].c, 102);
  assert.equal(result[0].v, 33);
  assert.equal(candleTime(workspaceCandles(data(input), 60)[0]), base / 1000);
});

test('never aggregates candles across IST sessions', () => {
  const nextDay = { ...candle(0, 200), t: '2026-10-16T09:15:00+05:30' };
  const result = workspaceCandles(data([candle(0), nextDay]), 60);
  assert.equal(result.length, 2);
  assert.equal(result[0].c, 100);
  assert.equal(result[1].c, 200);
});

test('history/live handoff deduplicates by timestamp and does not inject futures volume', () => {
  const historical = candle(0, 100, 0);
  const live = candle(0, 101, 500);
  const next = candle(1, 102, 1000);
  const merged = mergeChartHistory([historical], [live, next], '2026-10-15');
  assert.equal(merged.length, 2);
  assert.equal(merged[0].c, 101);
  assert.equal(merged[0].v, 0);
  assert.equal(merged[1].v, 0);
  assert.equal(mergeChartHistory([historical], [live], null)[0].c, 100);
  assert.equal(mergeChartHistory([historical], [next], null).length, 1);
});

test('chart does not mistake a cached closed-session snapshot for the current market schedule', () => {
  const component = readFileSync(path.join(__dirname, '..', 'components', 'ChartWorkspace.tsx'), 'utf8');
  assert.ok(component.includes("!sessionOpen ? 'Market Closed'"));
  assert.ok(!component.includes("!sessionOpen || source === 'MARKET_CLOSED'"));
});

test('higher-timeframe controls have explicit labels and never masquerade as intraday bars', () => {
  assert.equal(timeframeLabel('D'), '1D');
  assert.equal(timeframeLabel('W'), '1W');
  assert.equal(timeframeLabel('M'), '1M');
  assert.equal(timeframeLabel(60), '1h');
  assert.equal(workspaceCandles(data([candle(0)]), 'D').length, 0);
  for (const timeframe of ['D', 'W', 'M']) {
    const plan = deriveTradePlan([], null, timeframe, {
      live: true, minConfluences: 5, minVolumeRatio: 1.2,
    });
    assert.equal(plan.direction, 'WAIT');
    assert.match(plan.watchReason, /Intraday trade signals are disabled/);
  }
});

test('forming daily and weekly bars preserve official opens and do not invent futures volume', () => {
  const today = [candle(0, 101, 500), candle(1, 104, 500)];
  const day = { t: '2026-10-15T00:00:00+05:30', o: 98, h: 110, l: 95, c: 100, v: 0 };
  const updated = updatePeriodCandle([day], today, 'D');
  assert.equal(updated.length, 1);
  assert.equal(updated[0].o, 98);
  assert.equal(updated[0].h, 110);
  assert.equal(updated[0].l, 95);
  assert.equal(updated[0].c, 104);
  assert.equal(updated[0].v, 0);
  const week = { ...day, t: '2026-10-12T00:00:00+05:30' };
  const updatedWeek = updatePeriodCandle([week], today, 'W');
  assert.equal(updatedWeek.length, 1);
  assert.equal(updatedWeek[0].o, 98);
  assert.equal(updatedWeek[0].c, 104);
  assert.equal(updatePeriodCandle([], today, 'W').length, 0);
  const month = { ...day, t: '2026-10-01T00:00:00+05:30' };
  assert.equal(updatePeriodCandle([month], today, 'M')[0].c, 104);
});

test('EMA uses an SMA seed and waits for its full period', () => {
  const input = [1, 2, 3, 4, 5].map((value, i) => candle(i, value));
  assert.equal(ema(input, 3).length, 3);
  near(ema(input, 3)[0].value, 2);
  near(ema(input, 3)[2].value, 4);
  assert.equal(ema(input, 9).length, 0);
});

test('Wilder RSI handles rising, falling, flat and mixed prices', () => {
  const rising = Array.from({ length: 30 }, (_, i) => candle(i, 100 + i));
  const falling = Array.from({ length: 30 }, (_, i) => candle(i, 100 - i));
  const flat = Array.from({ length: 30 }, (_, i) => candle(i, 100));
  assert.equal(rsi(rising)[0].value, 100);
  assert.equal(rsi(falling)[0].value, 0);
  assert.equal(rsi(flat)[0].value, 50);
  assert.equal(rsi(flat.slice(0, 14)).length, 0);
  const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46];
  near(rsi(closes.map((value, i) => candle(i, value)))[0].value, 70.46413502109705);
});

test('MACD uses 12/26 EMA difference, 9-period signal and histogram', () => {
  const input = Array.from({ length: 50 }, (_, i) => candle(i, 100 + i));
  const result = macd(input);
  assert.equal(result.line.length, 25);
  assert.equal(result.signal.length, 17);
  result.line.forEach(point => near(point.value, 7));
  result.signal.forEach(point => near(point.value, 7));
  result.histogram.forEach(point => near(point.value, 0));
  assert.equal(macd(input.slice(0, 25)).line.length, 0);
});

test('VWAP is volume-weighted, resets in IST and does not invent zero-volume values', () => {
  const first = { ...candle(0, 100, 10), h: 102, l: 98 };
  const second = { ...candle(1, 110, 30), h: 112, l: 108 };
  const nextDay = { ...candle(0, 200, 10), t: '2026-10-16T09:15:00+05:30', h: 202, l: 198 };
  const result = vwap([first, second, nextDay]);
  near(result[0].value, 100);
  near(result[1].value, 107.5);
  near(result[2].value, 200);
  assert.equal(vwap([candle(0, 100, 0)]).length, 0);
});

test('daily pivots and CPR use previous-session close and sorted CPR boundaries', () => {
  const previous = candle(0, 110);
  const current = { ...candle(0, 200), t: '2026-10-16T09:15:00+05:30' };
  const snapshot = data([previous, current]);
  snapshot.levels.previousSession = { date: '2026-10-15', high: 120, low: 90, close: 110 };
  const levels = dailyLevels(snapshot, [previous, current]);
  near(levels.P, (120 + 90 + 110) / 3);
  near(levels.R1, 2 * levels.P - 90);
  near(levels.S1, 2 * levels.P - 120);
  assert.ok(levels.TC >= levels.BC);
  assert.equal(dailyLevels(data([current]), [current]), null);
  const historical = dailyLevels(data([previous, current]), [previous, current]);
  near(historical.P, (previous.h + previous.l + previous.c) / 3);
  snapshot.levels.previousSession.date = '2026-10-16';
  snapshot.candles5m = [current];
  const sameDay = dailyLevels(snapshot, [current]);
  assert.equal(sameDay, null);
});

test('saved indicator templates require every setting to be boolean', () => {
  assert.equal(isIndicatorSettings(DEFAULT_INDICATORS), true);
  assert.equal(isIndicatorSettings({ ...DEFAULT_INDICATORS, rsi: 'yes' }), false);
  assert.equal(isIndicatorSettings({ rsi: true }), false);
  assert.equal(isIndicatorSettings(null), false);
});

function confirmedBreakoutFixture() {
  const start = Date.parse('2026-10-16T09:15:00+05:30');
  const candles = [];
  for (let index = 0; index < 70; index++) {
    const open = candles.at(-1)?.c ?? 100;
    let close = 100 + index * 0.1 + Math.sin(index * Math.PI / 4) * 0.8;
    let high = Math.max(open, close) + 0.1;
    let low = Math.min(open, close) - 0.1;
    if (index === 69) {
      close = Math.max(...candles.slice(-5).map(item => item.h)) + 0.2;
      high = close + 0.25;
      low = open - 0.1;
    }
    candles.push({
      t: new Date(start + index * 300_000).toISOString(),
      o: open, h: high, l: low, c: close, v: index === 69 ? 200 : 100,
    });
  }
  const snapshot = {
    levels: {
      pdh: 0, pdl: 0, cdh: 0, cdl: 0, support: [], resistance: [],
      previousSession: { date: '2026-10-15', high: 99, low: 90, close: 95 },
    },
  };
  return { candles, snapshot, nowMs: start + 70 * 300_000 };
}

test('trade plan confirms only a fresh closed-candle breakout and provides bounded risk levels', () => {
  const { candles, snapshot, nowMs } = confirmedBreakoutFixture();
  const plan = deriveTradePlan(candles, snapshot, 5, {
    live: true, minConfluences: 5, minVolumeRatio: 1.2, nowMs,
  });
  assert.equal(plan.direction, 'BUY');
  assert.equal(plan.score, 6);
  assert.equal(plan.confirmation.length, 6);
  assert.equal(plan.targets.length, 3);
  assert.ok(plan.stopLoss < plan.entry);
  assert.ok(plan.targets[0] > plan.entry);
  assert.ok(plan.targets[1] > plan.targets[0]);
  assert.ok(plan.targets[2] > plan.targets[1]);
  near(plan.riskPoints, plan.entry - plan.stopLoss);
  plan.targets.forEach((target, index) => near((target - plan.entry) / plan.riskPoints, index + 1));
  assert.match(plan.invalidation, /close below/);
  assert.ok(plan.entryZone.low < plan.entry && plan.entryZone.high > plan.entry);
});

function advanceFixture(sell = false) {
  const fixture = confirmedBreakoutFixture();
  const candles = fixture.candles.map((source, index) => {
    const close = 100 + index * 0.1;
    const bar = { ...source, o: close - 0.05, h: close + 0.5, l: close - 0.5, c: close };
    const transform = value => 220 - value;
    return sell ? { ...bar, o: transform(bar.o), c: transform(bar.c), h: transform(bar.l), l: transform(bar.h), v: 0 } : { ...bar, v: 0 };
  });
  return { candles, options: { live: true, nowMs: fixture.nowMs, dailyCandles: [] } };
}

test('advance price-action mode proposes symmetric conditional entry, exit and stop without fabricating volume', () => {
  for (const sell of [false, true]) {
    const { candles, options } = advanceFixture(sell);
    const plan = deriveConditionalTradePlan(candles, 5, options);
    assert.equal(plan.direction, sell ? 'SELL' : 'BUY');
    assert.equal(plan.conditional, true);
    assert.equal(plan.score, 3);
    assert.equal(plan.targets, undefined);
    assert.match(plan.watchReason, /Conditional only/);
    const sign = sell ? -1 : 1;
    assert.ok(sign * (plan.entry - candles.at(-1).c) > 0);
    assert.ok(sign * (plan.entry - plan.stopLoss) > 0);
    near(sign * (plan.exitPrice - plan.entry) / plan.riskPoints, 2);
    for (const value of [plan.entry, plan.stopLoss, plan.exitPrice]) near(value * 20, Math.round(value * 20));
    assert.match(plan.invalidation, /not a predicted execution/);
  }
});

test('live overlay shows cash-index watch prices without promoting missing-volume setups to confirmed trades', () => {
  for (const sell of [false, true]) {
    const { candles, options } = advanceFixture(sell);
    const confirmed = deriveTradePlan(candles, {
      levels: { previousSession: { date: '2026-10-15', high: 110, low: 90, close: 100 } },
    }, 5, { ...options, minConfluences: 5, minVolumeRatio: 1.2 });
    const watch = deriveConditionalTradePlan(candles, 5, options);
    const overlay = selectTradeOverlay(confirmed, watch, 'live');
    assert.equal(confirmed.direction, 'WAIT');
    assert.equal(overlay.direction, sell ? 'SELL' : 'BUY');
    assert.equal(overlay.conditional, true);
    assert.ok(overlay.entry && overlay.exitPrice && overlay.stopLoss);
    assert.match(overlay.watchReason, /NO TRADE confirmed/);
    assert.equal(selectTradeOverlay(confirmed, watch, 'confirmed').direction, 'WAIT');
    assert.equal(selectTradeOverlay(confirmed, watch, 'conditional'), watch);
  }
});

test('live overlay prefers confirmed trades and hides watch prices on stale or invalid data', () => {
  const { candles, snapshot, nowMs } = confirmedBreakoutFixture();
  const confirmed = deriveTradePlan(candles, snapshot, 5, {
    live: true, minConfluences: 5, minVolumeRatio: 1.2, nowMs,
  });
  const fixture = advanceFixture();
  const watch = deriveConditionalTradePlan(fixture.candles, 5, fixture.options);
  assert.equal(selectTradeOverlay(confirmed, watch, 'live'), confirmed);
  const staleConfirmed = deriveTradePlan(candles, snapshot, 5, {
    live: false, minConfluences: 5, minVolumeRatio: 1.2, nowMs,
  });
  const staleWatch = deriveConditionalTradePlan(fixture.candles, 5, { ...fixture.options, live: false });
  const hidden = selectTradeOverlay(staleConfirmed, staleWatch, 'live');
  assert.equal(hidden.direction, 'WAIT');
  assert.equal(hidden.entry, undefined);
  assert.equal(hidden.exitPrice, undefined);
  assert.equal(hidden.stopLoss, undefined);
});

test('advance mode withdraws after an intrabar trigger or stop touch, even if price returns', () => {
  for (const sell of [false, true]) {
    const { candles, options } = advanceFixture(sell);
    const plan = deriveConditionalTradePlan(candles, 5, options);
    const close = candles.at(-1).c;
    for (const touched of [plan.entry, plan.stopLoss]) {
      const spotResult = deriveConditionalTradePlan(candles, 5, { ...options, latestPrice: touched });
      assert.equal(spotResult.direction, 'WAIT');
      assert.match(spotResult.watchReason, /trigger or stop was touched/);
      const forming = { t: new Date(options.nowMs).toISOString(), o: close, c: close, h: Math.max(close, touched), l: Math.min(close, touched), v: 0 };
      const result = deriveConditionalTradePlan([...candles, forming], 5, { ...options, nowMs: options.nowMs + 1000 });
      assert.equal(result.direction, 'WAIT');
      assert.equal(result.entry, undefined);
      assert.match(result.watchReason, /trigger or stop was touched/);
    }
  }
});

test('advance exit respects completed daily barriers, rejects insufficient room and ignores future daily candles', () => {
  for (const sell of [false, true]) {
    const { candles, options } = advanceFixture(sell);
    const original = deriveConditionalTradePlan(candles, 5, options);
    const sign = sell ? -1 : 1;
    const dailyBar = distance => {
      const barrier = original.entry + sign * original.riskPoints * distance;
      return { t: '2026-10-15T00:00:00+05:30', o: barrier, c: barrier, h: sell ? barrier + 20 : barrier, l: sell ? barrier : barrier - 20, v: 0 };
    };
    const capped = deriveConditionalTradePlan(candles, 5, { ...options, dailyCandles: [dailyBar(1.5)] });
    assert.equal(capped.direction, original.direction);
    assert.ok(sign * (capped.exitPrice - capped.entry) < original.riskPoints * 1.5);
    assert.ok(sign * (capped.exitPrice - capped.entry) >= original.riskPoints);
    const blocked = deriveConditionalTradePlan(candles, 5, { ...options, dailyCandles: [dailyBar(0.5)] });
    assert.equal(blocked.direction, 'WAIT');
    assert.match(blocked.watchReason, /less than 1R/);
    const future = deriveConditionalTradePlan(candles, 5, { ...options, dailyCandles: [{ ...dailyBar(0.5), t: '2026-10-16T00:00:00+05:30' }] });
    near(future.exitPrice, original.exitPrice);
  }
});

test('advance mode rejects stale, off-session, higher-timeframe, insufficient and conflicting histories', () => {
  const { candles, options } = advanceFixture();
  for (const changed of [
    { live: false }, { nowMs: options.nowMs + 300_000 },
    { nowMs: Date.parse('2026-10-18T12:00:00+05:30') },
    { nowMs: options.nowMs - 70 * 300_000 },
  ]) {
    const plan = deriveConditionalTradePlan(candles, 5, { ...options, ...changed });
    assert.equal(plan.direction, 'WAIT');
    assert.equal(plan.entry, undefined);
  }
  for (const timeframe of ['D', 'W', 'M']) assert.equal(deriveConditionalTradePlan(candles, timeframe, options).direction, 'WAIT');
  assert.equal(deriveConditionalTradePlan(candles.slice(-49), 5, options).direction, 'WAIT');
  const flat = candles.map(bar => ({ ...bar, o: 100, h: 101, l: 99, c: 100 }));
  assert.equal(deriveConditionalTradePlan(flat, 5, options).direction, 'WAIT');
  const future = { t: new Date(options.nowMs + 300_000).toISOString(), o: 100, h: 999, l: 1, c: 100, v: 0 };
  near(deriveConditionalTradePlan([...candles, future], 5, options).entry, deriveConditionalTradePlan(candles, 5, options).entry);
  for (const latestPrice of [NaN, Infinity, 0, -1]) {
    const result = deriveConditionalTradePlan(candles, 5, { ...options, latestPrice });
    assert.equal(result.direction, 'WAIT');
    assert.match(result.watchReason, /latest market price is invalid/);
  }
});

test('advance mode rejects excessive structural risk in both directions', () => {
  for (const sell of [false, true]) {
    const { candles, options } = advanceFixture(sell);
    candles[candles.length - 3] = { ...candles.at(-3), ...(sell ? { h: 210 } : { l: 10 }) };
    const plan = deriveConditionalTradePlan(candles, 5, options);
    assert.equal(plan.direction, 'WAIT');
    assert.match(plan.watchReason, /2.5 ATR/);
  }
});

test('advance calculations remain bounded when years of intraday history are loaded', () => {
  const { candles, options } = advanceFixture();
  const older = Array.from({ length: 20_000 }, (_, i) => ({
    ...candles[0], t: new Date(Date.parse(candles[0].t) - (20_000 - i) * 300_000).toISOString(),
  }));
  const history = [...older, ...candles];
  const started = performance.now();
  const plan = deriveConditionalTradePlan(history, 5, options);
  const elapsed = performance.now() - started;
  const bounded = deriveConditionalTradePlan(history.slice(-251), 5, options);
  assert.equal(plan.direction, 'BUY');
  for (const key of ['entry', 'exitPrice', 'stopLoss']) near(plan[key], bounded[key]);
  console.log(`Advance levels with 20,070 loaded bars: ${elapsed.toFixed(1)}ms; at most 251 intraday bars inspected`);
});

test('trade plan does not signal on cached data or an unclosed candle', () => {
  const { candles, snapshot, nowMs } = confirmedBreakoutFixture();
  const stale = deriveTradePlan(candles, snapshot, 5, {
    live: false, minConfluences: 5, minVolumeRatio: 1.2, nowMs,
  });
  assert.equal(stale.direction, 'WAIT');
  assert.match(stale.watchReason, /Live, fresh/);
  const unclosed = deriveTradePlan(candles, snapshot, 5, {
    live: true, minConfluences: 5, minVolumeRatio: 1.2, nowMs: nowMs - 60_000,
  });
  assert.equal(unclosed.direction, 'WAIT');
});

test('trade plan remains WAIT outside the weekday cash session', () => {
  const { candles, snapshot, nowMs } = confirmedBreakoutFixture();
  const afterClose = deriveTradePlan(candles, snapshot, 5, {
    live: true, minConfluences: 5, minVolumeRatio: 1.2, nowMs: nowMs + 26 * 60_000,
  });
  assert.equal(afterClose.direction, 'WAIT');
  assert.match(afterClose.watchReason, /weekday 09:15–15:30 IST cash session/);
});

test('fresh connection cannot reuse a delayed breakout candle', () => {
  const { candles, snapshot, nowMs } = confirmedBreakoutFixture();
  const plan = deriveTradePlan(candles, snapshot, 5, {
    live: true, minConfluences: 5, minVolumeRatio: 1.2, nowMs: nowMs + 6 * 60_000,
  });
  assert.equal(plan.direction, 'WAIT');
  assert.match(plan.watchReason, /fresh closed candle/);
});

test('chart status and setup gate share IST cash-session boundaries', () => {
  for (const [date, expected] of [
    ['2026-10-16T09:14:59+05:30', false], ['2026-10-16T09:15:00+05:30', true],
    ['2026-10-16T15:29:59+05:30', true], ['2026-10-16T15:30:00+05:30', false],
    ['2026-10-17T11:00:00+05:30', false], ['2026-10-18T11:00:00+05:30', false],
  ]) assert.equal(isCashSession(Date.parse(date)), expected, date);
});

test('entry expires if forming price already reaches stop or target one', () => {
  const { candles, snapshot, nowMs } = confirmedBreakoutFixture();
  const options = { live: true, minConfluences: 5, minVolumeRatio: 1.2, nowMs };
  const original = deriveTradePlan(candles, snapshot, 5, options);
  for (const close of [original.stopLoss, original.targets[0]]) {
    const forming = { t: new Date(nowMs).toISOString(), o: close, c: close, h: close + 0.1, l: close - 0.1, v: 100 };
    const plan = deriveTradePlan([...candles, forming], snapshot, 5, { ...options, nowMs: nowMs + 10_000 });
    assert.equal(plan.direction, 'WAIT');
    assert.equal(plan.entry, undefined);
    assert.match(plan.watchReason, /Setup expired/);
  }
});

test('missing index volume never produces a VWAP-confirmed entry', () => {
  const { candles, snapshot, nowMs } = confirmedBreakoutFixture();
  const plan = deriveTradePlan(candles.map(bar => ({ ...bar, v: 0 })), snapshot, 5, {
    live: true, minConfluences: 4, minVolumeRatio: 1.2, nowMs,
  });
  assert.equal(plan.direction, 'WAIT');
  assert.match(plan.watchReason, /volume unavailable/);
});

test('relative volume is mandatory even when the other five confirmations align', () => {
  const { candles, snapshot, nowMs } = confirmedBreakoutFixture();
  const plan = deriveTradePlan(candles.map(bar => ({ ...bar, v: 100 })), snapshot, 5, {
    live: true, minConfluences: 4, minVolumeRatio: 1.2, nowMs,
  });
  assert.equal(plan.direction, 'WAIT');
  assert.equal(plan.entry, undefined);
  assert.match(plan.watchReason, /relative-volume/);
});

test('nearby resistance blocks an otherwise confirmed BUY when reward room is below 1R', () => {
  const { candles, snapshot, nowMs } = confirmedBreakoutFixture();
  snapshot.levels.resistance = [candles.at(-1).c + 0.2];
  const plan = deriveTradePlan(candles, snapshot, 5, {
    live: true, minConfluences: 5, minVolumeRatio: 1.2, nowMs,
  });
  assert.equal(plan.direction, 'WAIT');
  assert.equal(plan.exitPrice, undefined);
  assert.match(plan.watchReason, /support\/resistance/);
});

test('the breakout candle current-day high is not a pre-existing resistance barrier', () => {
  const { candles, snapshot, nowMs } = confirmedBreakoutFixture();
  snapshot.levels.cdh = candles.at(-1).h;
  snapshot.levels.cdl = candles.at(-1).l;
  const plan = deriveTradePlan(candles, snapshot, 5, {
    live: true, minConfluences: 5, minVolumeRatio: 1.2, nowMs,
  });
  assert.equal(plan.direction, 'BUY');
  assert.equal(plan.exitPrice, plan.targets[0]);
});

test('a recovered intrabar stop or target touch cannot resurrect a confirmed setup', () => {
  const { candles, snapshot, nowMs } = confirmedBreakoutFixture();
  const options = { live: true, minConfluences: 5, minVolumeRatio: 1.2, nowMs };
  const original = deriveTradePlan(candles, snapshot, 5, options);
  for (const stop of [true, false]) {
    const forming = {
      t: new Date(nowMs).toISOString(), o: original.entry, c: original.entry,
      h: stop ? original.entry + 0.01 : original.targets[0],
      l: stop ? original.stopLoss : original.entry - 0.01, v: 100,
    };
    const plan = deriveTradePlan([...candles, forming], snapshot, 5, { ...options, nowMs: nowMs + 10_000 });
    assert.equal(plan.direction, 'WAIT');
    assert.equal(plan.stopLoss, undefined);
    assert.match(plan.watchReason, /Setup expired/);
  }
});

test('institutional context validates source dates, freshness and finite reported flows', () => {
  const nowMs = Date.parse('2026-10-18T12:00:00+05:30');
  const snapshot = {
    success: true, source: 'Moneycontrol', fetchedAt: new Date(nowMs - 60_000).toISOString(), staleness: 'fresh',
    fii: { date: '16-Oct-2026', netValueCr: 500 }, dii: { date: '16-Oct-2026', netValueCr: 300 },
  };
  const result = institutionalContext(snapshot, nowMs);
  assert.equal(result.available, true);
  assert.equal(result.bias, 'Both net buying');
  assert.match(result.label, /2026-10-16/);
  assert.equal(result.source, 'Moneycontrol');
  assert.equal(institutionalContext({ ...snapshot, fii: { date: '2026-10-16', netValueCr: -400 } }, nowMs).bias, 'Mixed participation');
  for (const changed of [
    { success: false }, { staleness: 'stale' }, { fetchedAt: new Date(nowMs - 31 * 60_000).toISOString() },
    { fetchedAt: new Date(nowMs + 1000).toISOString() }, { fii: { date: '2026-10-19', netValueCr: 500 } },
    { fii: { date: '31-Feb-2026', netValueCr: 500 } }, { fii: { date: '2026-10-16', netValueCr: NaN } },
    { fii: { date: '2026-10-01', netValueCr: 500 }, dii: { date: '2026-10-01', netValueCr: 300 } },
  ]) assert.equal(institutionalContext({ ...snapshot, ...changed }, nowMs).available, false);
  assert.equal(institutionalContext(null, nowMs).available, false);
});

test('trade plan builds a symmetrical SELL setup after confirmed downside breakdown', () => {
  const start = Date.parse('2026-10-16T09:15:00+05:30');
  const candles = [];
  for (let index = 0; index < 70; index++) {
    const open = candles.at(-1)?.c ?? 100;
    let close = 100 - index * 0.05 + Math.sin(index * Math.PI / 4) * 0.2;
    let high = Math.max(open, close) + 0.1;
    let low = Math.min(open, close) - 0.1;
    if (index === 69) {
      close = Math.min(...candles.slice(-5).map(item => item.l)) - 0.05;
      high = open + 0.1;
      low = close - 0.25;
    }
    candles.push({
      t: new Date(start + index * 300_000).toISOString(),
      o: open, h: high, l: low, c: close, v: index === 69 ? 200 : 100,
    });
  }
  const snapshot = {
    levels: {
      pdh: 0, pdl: 0, cdh: 0, cdl: 0, support: [], resistance: [],
      previousSession: { date: '2026-10-15', high: 110, low: 100, close: 105 },
    },
  };
  const plan = deriveTradePlan(candles, snapshot, 5, {
    live: true, minConfluences: 5, minVolumeRatio: 1.2, nowMs: start + 70 * 300_000,
  });
  assert.equal(plan.direction, 'SELL');
  assert.ok(plan.stopLoss > plan.entry);
  assert.ok(plan.targets[0] < plan.entry);
  assert.ok(plan.targets[1] < plan.targets[0]);
  assert.ok(plan.targets[2] < plan.targets[1]);
  near(plan.riskPoints, plan.stopLoss - plan.entry);
  plan.targets.forEach((target, index) => near((plan.entry - target) / plan.riskPoints, index + 1));
  assert.match(plan.invalidation, /close above/);
  const obstructed = deriveTradePlan(candles, {
    ...snapshot, levels: { ...snapshot.levels, support: [plan.entry - plan.riskPoints * 0.5] },
  }, 5, { live: true, minConfluences: 5, minVolumeRatio: 1.2, nowMs: start + 70 * 300_000 });
  assert.equal(obstructed.direction, 'WAIT');
  assert.match(obstructed.watchReason, /support\/resistance/);
  for (const close of [plan.stopLoss, plan.targets[0]]) {
    const nowMs = start + 70 * 300_000;
    const forming = { t: new Date(nowMs).toISOString(), o: close, c: close, h: close + .1, l: close - .1, v: 100 };
    const expired = deriveTradePlan([...candles, forming], snapshot, 5, {
      live: true, minConfluences: 5, minVolumeRatio: 1.2, nowMs: nowMs + 10_000,
    });
    assert.equal(expired.direction, 'WAIT');
    assert.match(expired.watchReason, /Setup expired/);
  }
});
