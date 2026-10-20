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
