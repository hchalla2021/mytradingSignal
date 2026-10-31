const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function compile(file, dependencies = {}, globals = {}) {
  const code = ts.transpileModule(readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, Intl, console, ...globals,
    require: id => {
      if (id in dependencies) return dependencies[id];
      if (id === 'react/jsx-runtime') return require(id);
      throw new Error(`Unexpected dependency ${id}`);
    } });
  return exports;
}
const workspace = compile('lib\\chart-workspace.ts');
const display = compile('lib\\aqte-display.ts');
function all(tree) {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(all)];
}
function harness() {
  const slots = [];
  let cursor = 0;
  let queue = [];
  let history = { candles: [], loading: false, error: null, retry() {} };
  const calls = { charts: 0, removed: 0, disconnected: 0, centered: 0, resized: 0, restored: [], series: [] };
  const range = { from: 1793331900, to: 1793335500 };
  const react = {
    memo: fn => fn,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(fn, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        queue.push(() => {
          previous?.cleanup?.();
          slots[index] = { deps, cleanup: fn() };
        });
      }
    },
  };
  const series = () => {
    const record = {
      resets: 0, updates: 0, data: [],
      setData(data) { this.resets++; this.data = data; },
      update(point) {
        this.updates++;
        const last = this.data.at(-1);
        assert.ok(!last || point.time >= last.time, 'Chart updates must never move backwards');
        if (last?.time === point.time) this.data = [...this.data.slice(0, -1), point];
        else this.data = [...this.data, point];
      },
      priceScale: () => ({ applyOptions() {} }),
    };
    calls.series.push(record);
    return record;
  };
  let resize;
  const component = compile('components\\AQTEChart.tsx', {
    react,
    'lightweight-charts': {
      ColorType: { Solid: 'solid' }, CrosshairMode: { Normal: 0 },
      createChart() {
        calls.charts++;
        return { timeScale: () => ({ getVisibleRange: () => range, setVisibleRange(value) { calls.restored.push(value); } }),
          addCandlestickSeries: series, addHistogramSeries: series,
          addLineSeries: series, remove() { calls.removed++; } };
      },
    },
    '@/hooks/useChartHistory': { useChartHistory: () => history },
    '@/lib/chart-workspace': workspace,
    '@/lib/chart-render-sync': {
      centerLatestCandle() { calls.centered++; },
      resizeChartIfChanged() { calls.resized++; },
    },
    '@/lib/aqte-display': display,
  }, {
    ResizeObserver: class {
      constructor(callback) { resize = callback; }
      observe() {}
      disconnect() { calls.disconnected++; }
    },
  }).default;
  return {
    calls,
    history(value) { history = value; },
    render(props = { symbol: 'NIFTY', tick: null }) {
      cursor = 0;
      queue = [];
      const tree = component(props);
      const canvas = all(tree).find(n => n.props?.className === 'aqte-chart-canvas');
      canvas.ref.current = { clientWidth: 600, clientHeight: 270 };
      for (const effect of queue) effect();
      return tree;
    },
    resize() { resize(); },
    cleanup() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
function bars() {
  const start = Date.parse('2026-10-30T09:15:00+05:30') / 1000;
  return Array.from({ length: 60 }, (_, i) => ({
    t: new Date((start + i * 300) * 1000).toISOString(),
    o: 24900 + i, h: 24903 + i, l: 24899 + i, c: 24901 + i, v: 100 + i,
  }));
}

test('AQTE chart uses incremental price/EMA updates across candles, without recreating or resetting the chart', () => {
  const h = harness();
  const candles = bars();
  h.history({ candles, loading: false, error: null });
  h.render();
  let expected = candles;
  const baseTime = workspace.candleTime(candles.at(-1));
  for (const [seconds, price] of [[10, 24962], [310, 24965], [320, 24967], [610, 24970]]) {
    const timestamp = new Date((baseTime + seconds) * 1000).toISOString();
    expected = workspace.applyLiveTick(expected, { price, time: baseTime + seconds }, 5).candles;
    h.render({ symbol: 'NIFTY', tick: { price, timestamp } });
    assert.equal(h.calls.series[0].data.at(-1).close, price);
    for (const [i, period] of [9, 20, 50].entries()) {
      const actual = h.calls.series[i + 2].data.at(-1).value;
      const calculated = workspace.ema(expected, period).at(-1).value;
      assert.ok(Math.abs(actual - calculated) < 1e-8, `${period} EMA must match candle calculation`);
    }
  }
  assert.equal(h.calls.charts, 1);
  assert.equal(h.calls.series[0].resets, 1, 'Ticks must not re-upload history');
  assert.equal(h.calls.centered, 1, 'Ticks must not reset the user viewport');
  h.resize();
  assert.equal(h.calls.resized, 1);
  h.cleanup();
  assert.equal(h.calls.removed, 1);
  assert.equal(h.calls.disconnected, 1);
});

test('switching indices clears the previous history while loading and exposes chart failures and retry', () => {
  const h = harness();
  h.history({ candles: bars(), loading: false, error: null });
  h.render();
  h.history({ candles: [], loading: true, error: null });
  h.render({ symbol: 'SENSEX', tick: null });
  assert.equal(h.calls.series[0].data.length, 0);
  let retries = 0;
  h.history({ candles: [], loading: false, error: 'History unavailable', retry() { retries++; } });
  const tree = h.render({ symbol: 'SENSEX', tick: null });
  assert.ok(all(tree).some(n => n.props?.role === 'alert'));
  all(tree).find(n => n.type === 'button' && n.props.children === 'Retry chart').props.onClick();
  assert.equal(retries, 1);
  assert.equal(h.calls.charts, 1);
  h.cleanup();
});

test('background history warming never blanks candles or overlays loading and preserves the viewport', () => {
  const h = harness();
  const candles = bars();
  h.history({ candles, loading: false, error: null });
  h.render();
  for (let i = 0; i < 3; i++) {
    h.history({ candles, loading: true, error: null });
    const loading = h.render();
    assert.equal(h.calls.series[0].data.length, 60);
    assert.ok(!all(loading).some(n => n.props?.className === 'aqte-chart-message'));
    h.history({ candles: [...candles], loading: false, error: null });
    h.render();
  }
  assert.equal(h.calls.centered, 1, 'Prefetch must not repeatedly recenter the chart');
  assert.equal(h.calls.restored.length, 3);
  const resets = h.calls.series[0].resets;
  h.history({ candles, loading: false, error: 'Older history unavailable', retry() {} });
  const failed = h.render();
  assert.equal(h.calls.series[0].resets, resets);
  assert.equal(h.calls.series[0].data.length, 60);
  assert.ok(all(failed).some(n => n.props?.className === 'aqte-chart-warning' && n.props.role === 'alert'));
  h.cleanup();
});

test('live candles keep moving through prefetch and do not revert when older history finishes', () => {
  const h = harness();
  const candles = bars();
  h.history({ candles, loading: false, error: null });
  h.render();
  const timestamp = new Date((workspace.candleTime(candles.at(-1)) + 310) * 1000).toISOString();
  const props = { symbol: 'NIFTY', tick: { price: 24965, timestamp } };
  h.history({ candles, loading: true, error: null });
  h.render(props);
  assert.equal(h.calls.series[0].data.at(-1).close, 24965);
  assert.equal(h.calls.series[0].data.length, 61);
  h.history({ candles: [...candles], loading: false, error: null });
  h.render(props);
  assert.equal(h.calls.series[0].data.at(-1).close, 24965);
  assert.equal(h.calls.series[0].data.length, 61);
  assert.equal(h.calls.centered, 1);
  h.cleanup();
});

test('AQTE chart selects 5m by default and allows another display timeframe', () => {
  const h = harness();
  let tree = h.render();
  const buttons = all(tree).filter(n => n.props?.['aria-pressed'] !== undefined);
  assert.equal(buttons.find(n => n.props['aria-pressed']).props.children, '5m');
  buttons.find(n => n.props.children === '1m').props.onClick();
  tree = h.render();
  assert.equal(all(tree).find(n => n.props?.['aria-pressed'] === true).props.children, '1m');
  h.cleanup();
});
