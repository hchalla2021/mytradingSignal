const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = readFileSync(path.join(__dirname, '..', 'lib', 'chart-crosshair.ts'), 'utf8');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const { synchronizeCrosshair } = context.exports;

function fixture(overrides = {}) {
  let cleared = 0;
  const positions = [];
  const scale = {
    timeToCoordinate: () => 50,
    coordinateToLogical: () => 10,
    getVisibleLogicalRange: () => ({ from: 0, to: 20 }),
    ...overrides.scale,
  };
  const chart = {
    timeScale: () => scale,
    clearCrosshairPosition: () => cleared++,
    setCrosshairPosition: (...args) => positions.push(args),
  };
  const series = {
    options: () => ({ visible: true }),
    dataByIndex: index => {
      assert.equal(index, 10, 'Must not fall back to bar zero');
      return { time: 1000, value: 55 };
    },
    priceToCoordinate: () => 25,
    ...overrides.series,
  };
  const container = { isConnected: true, clientWidth: 600, clientHeight: 94, ...overrides.container };
  const event = { time: 1000, point: { x: 50, y: 20 }, ...overrides.event };
  return { run: () => synchronizeCrosshair(chart, series, container, event), positions, cleared: () => cleared, series };
}

test('synchronizes initialized line, histogram and candlestick series at the exact timestamp', () => {
  for (const point of [{ time: 1000, value: 55 }, { time: 1000, close: 100 }]) {
    const f = fixture({ series: { dataByIndex: () => point } });
    f.run();
    assert.equal(f.positions.length, 1);
    assert.equal(f.positions[0][0], point.value ?? point.close);
    assert.equal(f.positions[0][1], 1000);
    assert.equal(f.positions[0][2], f.series);
    assert.equal(f.cleared(), 0);
  }
});

test('hidden, unmounted and zero-sized panes are never synchronized', () => {
  for (const container of [
    { isConnected: false }, { clientWidth: 0 }, { clientHeight: 0 },
  ]) {
    const f = fixture({ container, series: { dataByIndex: () => { throw new Error('Hidden pane read'); } } });
    assert.doesNotThrow(f.run);
    assert.equal(f.positions.length, 0);
    assert.equal(f.cleared(), 1);
  }
});

test('missing scale first value reproducing Value is null is rejected before setting crosshair', () => {
  const f = fixture({ series: { priceToCoordinate: () => null } });
  assert.doesNotThrow(f.run);
  assert.equal(f.positions.length, 0);
  assert.equal(f.cleared(), 1);
});

test('uninitialized scales, whitespace, invalid values and unmatched timestamps clear the crosshair', () => {
  for (const overrides of [
    { scale: { timeToCoordinate: () => null } },
    { scale: { getVisibleLogicalRange: () => null } },
    { scale: { coordinateToLogical: () => null } },
    { scale: { coordinateToLogical: () => NaN } },
    { series: { dataByIndex: () => null } },
    { series: { dataByIndex: () => ({ time: 1000 }) } },
    { series: { dataByIndex: () => ({ time: 999, value: 55 }) } },
    { series: { dataByIndex: () => ({ time: 1000, value: NaN }) } },
    { series: { priceToCoordinate: () => NaN } },
    { series: { options: () => ({ visible: false }) } },
    { event: { time: undefined } },
    { event: { point: undefined } },
    { event: { point: { x: NaN, y: 20 } } },
  ]) {
    const f = fixture(overrides);
    assert.doesNotThrow(f.run);
    assert.equal(f.positions.length, 0);
    assert.equal(f.cleared(), 1);
  }
});

test('a pane can recover from warm-up or hiding and synchronize on the next event', () => {
  let ready = false;
  const f = fixture({ series: { priceToCoordinate: () => ready ? 25 : null } });
  f.run();
  ready = true;
  f.run();
  assert.equal(f.cleared(), 1);
  assert.equal(f.positions.length, 1);
});
