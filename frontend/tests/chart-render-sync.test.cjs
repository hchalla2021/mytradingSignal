const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(path.join(__dirname, '..', 'lib', 'chart-render-sync.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const { synchronizeChartRange, resizeChartIfChanged } = context.exports;
const { centeredCandleRange, centerLatestCandle, isLatestCandleCentered } = context.exports;

test('recent candle group fits with balanced padding and readable spacing across devices', () => {
  for (const width of [220, 320, 390, 768, 820, 1024, 1440, 1920]) {
    for (const count of [1, 3, 25, 80, 20000]) {
      const range = centeredCandleRange(count, width);
      const capacity = Math.max(20, Math.min(160, Math.floor(width / 9)));
      const padding = Math.max(2, Math.round(capacity * .06));
      const visible = Math.min(count, capacity - padding * 2);
      const first = count - visible;
      assert.equal((range.from + range.to) / 2, (first + count - 1) / 2);
      assert.ok(Math.abs((first - range.from) - (range.to - count + 1)) < 0.001);
      if (count >= capacity) assert.ok((range.to - count + 1) / (range.to - range.from) < .1);
      assert.ok(range.to - range.from >= 20);
      assert.ok(range.to - range.from <= 160);
      if (width <= 1440) assert.ok(width / (range.to - range.from) >= 9);
    }
  }
  assert.equal(centeredCandleRange(0, 400), null);
  assert.equal(centeredCandleRange(20, 0), null);
});

test('hidden chart defers centering until visible and panned views are not considered centered', () => {
  let range = null;
  let writes = 0;
  const chart = { timeScale: () => ({
    width: () => 320,
    getVisibleLogicalRange: () => range,
    setVisibleLogicalRange: next => { range = next; writes++; },
  }) };
  assert.equal(centerLatestCandle(chart, { clientWidth: 0, clientHeight: 0 }, 50), false);
  assert.equal(writes, 0);
  assert.equal(centerLatestCandle(chart, { clientWidth: 390, clientHeight: 500 }, 50), true);
  assert.equal(isLatestCandleCentered(chart, 50), true);
  range = { from: 0, to: 20 };
  assert.equal(isLatestCandleCentered(chart, 50), false);
  assert.equal(isLatestCandleCentered(chart, 0), false);
});

test('range propagation settles instead of replaying asynchronous identical or subpixel ranges', () => {
  let range = { from: 0, to: 100 };
  let writes = 0;
  const chart = { timeScale: () => ({
    getVisibleLogicalRange: () => range,
    setVisibleLogicalRange: next => { writes++; range = next; },
  }) };
  const container = { clientWidth: 800, clientHeight: 400 };
  for (let i = 0; i < 100; i++) synchronizeChartRange(chart, container, { from: 0, to: 100.0001 });
  assert.equal(writes, 0);
  synchronizeChartRange(chart, container, { from: 10, to: 110 });
  assert.equal(writes, 1);
  synchronizeChartRange(chart, container, { from: 10, to: 110 });
  assert.equal(writes, 1);
  synchronizeChartRange(chart, { clientWidth: 0, clientHeight: 0 }, { from: 20, to: 120 });
  assert.equal(writes, 1);
});

test('cash templates forcibly disable VWAP without modifying shared futures settings', () => {
  const cash = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(path.join(__dirname, '..', 'lib', 'chart-workspace.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, cash);
  const original = cash.exports.DEFAULT_INDICATORS;
  const settings = cash.exports.cashIndicatorSettings(original);
  assert.equal(settings.vwap, false);
  assert.equal(original.vwap, true);
  assert.ok(cash.exports.CASH_INDICATORS.every(item => item.id !== 'vwap'));
  assert.ok(cash.exports.INDICATORS.some(item => item.id === 'vwap'));
});

test('resize observer leaves unchanged and hidden canvases alone but applies actual dimension changes', () => {
  let dimensions = { width: 800, height: 400 };
  let calls = 0;
  const chart = {
    options: () => dimensions,
    resize: (width, height) => { calls++; dimensions = { width, height }; },
  };
  assert.equal(resizeChartIfChanged(chart, { clientWidth: 800, clientHeight: 400 }), false);
  assert.equal(resizeChartIfChanged(chart, { clientWidth: 0, clientHeight: 0 }), false);
  assert.equal(calls, 0);
  assert.equal(resizeChartIfChanged(chart, { clientWidth: 900, clientHeight: 450 }), true);
  assert.equal(calls, 1);
  assert.equal(resizeChartIfChanged(chart, { clientWidth: 900, clientHeight: 450 }), false);
  assert.equal(calls, 1);
});
