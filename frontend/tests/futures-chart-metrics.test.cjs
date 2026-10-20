const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { performance } = require('node:perf_hooks');
const modules = {};
function load(name) {
  if (modules[name]) return modules[name];
  const source = readFileSync(path.join(__dirname, '..', 'lib', `${name}.ts`), 'utf8');
  const context = { exports: {}, require: id => load(id.replace('./', '')) };
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return modules[name] = context.exports;
}
const { relativeVolume, futuresChangedFrom } = load('futures-chart-metrics');
const base = Date.parse('2026-10-20T09:15:00+05:30');
const bar = (i, v = 100) => ({
  t: new Date(base + i * 180000).toISOString(), o: 100, h: 102, l: 99, c: 101, v,
});
test('RVOL uses exactly 20 prior bars without current-bar lookahead', () => {
  const bars = Array.from({ length: 22 }, (_, i) => bar(i));
  bars[20].v = 500;
  const result = relativeVolume(bars, true);
  assert.equal(result[19], undefined);
  assert.equal(result[20], 5);
  assert.equal(result[21], 100 / 120);
});
test('intraday RVOL resets by IST date, daily RVOL spans days, and zero baseline never fabricates a ratio', () => {
  const bars = Array.from({ length: 21 }, (_, i) => bar(i));
  bars.push({ ...bar(21, 1000), t: '2026-10-21T09:15:00+05:30' });
  assert.equal(relativeVolume(bars, true)[21], undefined);
  assert.equal(relativeVolume(bars, false)[21], 10);
  assert.equal(relativeVolume(bars.map(item => ({ ...item, v: 0 })), true)[20], undefined);
  bars[20].v = 0;
  assert.equal(relativeVolume(bars, true)[20], 0);
});
test('tail rendering distinguishes unchanged, revision, append, prepend, truncation and historical correction', () => {
  const bars = Array.from({ length: 30 }, (_, i) => bar(i));
  assert.equal(futuresChangedFrom([], bars), -1);
  assert.equal(futuresChangedFrom(bars, bars.slice()), 30);
  assert.equal(futuresChangedFrom(bars, [...bars.slice(0, -1), { ...bars[29], v: 200 }]), 29);
  assert.equal(futuresChangedFrom(bars, [...bars, bar(30)]), 30);
  const corrected = bars.slice();
  corrected[4] = { ...corrected[4], c: 100 };
  assert.equal(futuresChangedFrom(bars, corrected), -1);
  assert.equal(futuresChangedFrom(bars, [bar(-1), ...bars]), -1);
  assert.equal(futuresChangedFrom(bars, bars.slice(1)), -1);
  assert.equal(futuresChangedFrom(bars, [...bars.slice(0, -1), bar(30)]), -1);
});
test('20,000-bar RVOL and tail-change detection stay within a 250ms calculation budget', t => {
  const bars = Array.from({ length: 20000 }, (_, i) => bar(i));
  const next = [...bars.slice(0, -1), { ...bars.at(-1), v: 300 }];
  const start = performance.now();
  const ratios = relativeVolume(next, true);
  const from = futuresChangedFrom(bars, next);
  const duration = performance.now() - start;
  assert.equal(ratios.length, 20000);
  assert.equal(from, 19999);
  assert.ok(duration < 250, `20,000 bars took ${duration.toFixed(1)}ms`);
  t.diagnostic(`20,000 bars RVOL + change detection: ${duration.toFixed(1)}ms; render tail: 1 candle`);
});
