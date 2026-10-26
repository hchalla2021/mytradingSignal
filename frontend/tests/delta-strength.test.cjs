const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'delta-strength.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const module_ = { exports: {} };
vm.runInNewContext(outputText, { module: module_, exports: module_.exports, require: () => ({}) });
const { deltaStrength, sanitizeDeltaConfig, DEFAULT_DELTA_CONFIG } = module_.exports;

/** Bars from [buy, sell] pairs; cvd accumulates; unclassified volume n is extra. */
function series(pairs, { n = 0, coverage = 1 } = {}) {
  let cvd = 0;
  return pairs.map(([b, s], i) => {
    cvd += b - s;
    return { t: 1_000_000 + i * 60, b, s, n, v: b + s + n, d: b - s, cvd, coverage, complete: i < pairs.length - 1 };
  });
}
const neutral = Array.from({ length: 10 }, () => [500, 500]);

test('no recorded bars is UNAVAILABLE, never zero or inferred', () => {
  const result = deltaStrength([], DEFAULT_DELTA_CONFIG);
  assert.equal(result.state, 'UNAVAILABLE');
  assert.equal(result.delta, null);
  assert.equal(result.estimated, true);
});

test('sustained aggressive buying calls Buyer Stronger with exact window delta', () => {
  const bars = series([...neutral, [700, 300], [720, 280], [680, 320], [750, 250], [700, 300]]);
  const result = deltaStrength(bars, DEFAULT_DELTA_CONFIG);
  assert.equal(result.state, 'BUYERS');
  assert.equal(result.delta, 400 + 440 + 360 + 500 + 400);
  assert.equal(Math.round(result.deltaPct), 42);
  assert.ok(result.strength > DEFAULT_DELTA_CONFIG.threshold);
});

test('sustained aggressive selling calls Seller Stronger', () => {
  const bars = series([...neutral, [300, 700], [280, 720], [320, 680], [250, 750], [300, 700]]);
  assert.equal(deltaStrength(bars, DEFAULT_DELTA_CONFIG).state, 'SELLERS');
});

test('balanced flow is Sideways', () => {
  const bars = series([...neutral, [510, 490], [495, 505], [505, 495], [500, 500], [490, 510]]);
  assert.equal(deltaStrength(bars, DEFAULT_DELTA_CONFIG).state, 'SIDEWAYS');
});

test('thin volume spikes are filtered as Sideways (noise)', () => {
  const bars = series([...neutral, [40, 0], [40, 0], [40, 0], [40, 0], [40, 0]]);
  const result = deltaStrength(bars, DEFAULT_DELTA_CONFIG);
  assert.equal(result.state, 'SIDEWAYS');
  assert.match(result.reason, /Thin volume/);
});

test('a single-bar burst against the window trend is not called', () => {
  const bars = series([...neutral, [300, 700], [300, 700], [300, 700], [300, 700], [1400, 200]]);
  const result = deltaStrength(bars, DEFAULT_DELTA_CONFIG);
  assert.notEqual(result.state, 'BUYERS');
});

test('hysteresis holds an existing call while strength fades but stays positive', () => {
  const bars = series([...neutral, [550, 450], [560, 440], [550, 450], [555, 445], [550, 450]]);
  const fresh = deltaStrength(bars, DEFAULT_DELTA_CONFIG, null);
  const held = deltaStrength(bars, DEFAULT_DELTA_CONFIG, 'BUYERS');
  assert.equal(fresh.state, 'SIDEWAYS');
  assert.equal(held.state, 'BUYERS');
  assert.equal(deltaStrength(bars, DEFAULT_DELTA_CONFIG, held.state).state, held.state);
});

test('low recording coverage makes the state UNAVAILABLE but keeps the measured value', () => {
  const bars = series([...neutral, [700, 300], [700, 300], [700, 300], [700, 300], [700, 300]], { coverage: 0.3 });
  const result = deltaStrength(bars, DEFAULT_DELTA_CONFIG);
  assert.equal(result.state, 'UNAVAILABLE');
  assert.equal(result.delta, 2000);
});

test('unclassified volume is never assigned a side', () => {
  const bars = series([...neutral, [700, 300], [700, 300], [700, 300], [700, 300], [700, 300]], { n: 1000 });
  const result = deltaStrength(bars, DEFAULT_DELTA_CONFIG);
  assert.equal(result.delta, 2000);
  assert.equal(Math.round(result.deltaPct), 40);
  assert.equal(result.classifiedShare, 0.5);
});

test('config is clamped and invalid values fall back to defaults', () => {
  const config = sanitizeDeltaConfig({ interval: 7, window: 500, threshold: -3, minCoverage: 'x' });
  assert.equal(config.interval, DEFAULT_DELTA_CONFIG.interval);
  assert.equal(config.window, 30);
  assert.equal(config.threshold, 2);
  assert.equal(config.minCoverage, DEFAULT_DELTA_CONFIG.minCoverage);
  assert.equal(sanitizeDeltaConfig(null).window, DEFAULT_DELTA_CONFIG.window);
});

const ENTRY_BUY = { action: 'BUY', stage: 'ENTRY', headline: 'BUY', reason: 'All checks confirmed' };
const GATE_WAIT = { action: 'WAIT', stage: 'WAIT', headline: 'WAIT', reason: '9/14 checks' };

function renderDelta({ age = 1, live = true, latestRecorded = false, sessionOpen = true, error = null, decision = ENTRY_BUY } = {}) {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const now = Date.parse('2026-10-26T10:00:00+05:30');
  const flow = {
    snapshot: {
      available: true, lastTick: now / 1000 - age, latestRecorded,
      bars: series([...neutral, ...Array.from({ length: 5 }, () => [700, 300])]),
    },
    live, error,
  };
  const componentSource = fs.readFileSync(path.join(__dirname, '..', 'components', 'DeltaStrength.tsx'), 'utf8');
  const compiled = ts.transpileModule(componentSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const component = { exports: {} };
  const mocks = {
    '@/hooks/useOrderFlow': { useOrderFlow: () => flow },
    '@/lib/chart-workspace': { isCashSession: () => sessionOpen },
    '@/lib/delta-strength': module_.exports,
    '@/lib/order-flow': { compactVolume: String },
    './DeltaStrength.module.css': { default: new Proxy({}, { get: (_, key) => String(key) }) },
  };
  vm.runInNewContext(compiled, {
    module: component, exports: component.exports, Date: { now: () => now },
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
  });
  return renderToStaticMarkup(React.createElement(component.exports.default, { symbol: 'NIFTY', active: true, decision }));
}

test('delta box shows BUY only when the pro gate confirms on a fresh connected in-session feed', () => {
  assert.match(renderDelta(), /🟢 BUY/);
  assert.match(renderDelta({ age: 20 }), /🟢 BUY/);
});

test('strong buyer delta alone is pressure, not an order: WAIT until the pro gate confirms', () => {
  const html = renderDelta({ decision: GATE_WAIT });
  assert.match(html, /🟡 WAIT/);
  assert.match(html, /Buyer pressure/);
  assert.doesNotMatch(html, /🟢 BUY|🔴 SELL/);
});

test('delta box keeps the measured value but shows WAIT on stale, closed, archived, disconnected, future or failed feeds', () => {
  for (const options of [
    { age: 21 }, { sessionOpen: false }, { latestRecorded: true },
    { live: false }, { age: -1 }, { error: 'Feed failed' },
  ]) {
    const html = renderDelta(options);
    assert.match(html, /WAIT/, JSON.stringify(options));
    assert.doesNotMatch(html, /🟢 BUY|🔴 SELL/, JSON.stringify(options));
    assert.match(html, /\+2000/, 'Recorded delta remains visible for reference');
    assert.match(html, /est\./);
  }
});
