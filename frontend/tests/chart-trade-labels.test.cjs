const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const compiled = ts.transpileModule(readFileSync(path.join(__dirname, '..', 'lib', 'chart-trade-labels.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const context = { exports: {} };
vm.runInNewContext(compiled, context);
const { layoutTradeLabels } = context.exports;

test('entry, exit and stop labels stay in bounds and never overlap at clustered prices', () => {
  for (const width of [180, 280, 900]) {
    for (const y of [0, 20, 200, 395, 600]) {
      const anchors = ['entry', 'exit', 'stop'].map((id, i) => ({ id, x: width - 2, y: y + i, width: 210 }));
      const labels = layoutTradeLabels(anchors, width, 400);
      assert.equal(labels.length, 3);
      labels.forEach((label, i) => {
        assert.ok(label.x >= 4 && label.x + label.width <= width - 4);
        assert.ok(label.y >= 4 && label.y + label.height <= 396);
        if (i) assert.ok(label.y >= labels[i - 1].y + labels[i - 1].height + 5);
      });
    }
  }
});

test('layout retains exact price anchors and separates labels rather than moving the candle marker', () => {
  const labels = layoutTradeLabels([
    { id: 'entry', x: 100, y: 150, width: 170 },
    { id: 'exit', x: 100, y: 151, width: 170 },
    { id: 'stop', x: 100, y: 152, width: 170 },
  ], 600, 400);
  labels.forEach((label, i) => {
    assert.equal(label.anchorX, 100);
    assert.equal(label.anchorY, 150 + i);
    assert.equal(label.onScreen, true);
  });
});

test('offscreen anchors remain identified as offscreen while callouts are pinned inside the plot', () => {
  for (const x of [-500, 1000]) {
    const [label] = layoutTradeLabels([{ id: 'entry', x, y: 500, width: 200 }], 280, 400);
    assert.equal(label.onScreen, false);
    assert.ok(label.x >= 4 && label.x + label.width <= 276);
    assert.ok(label.y >= 4 && label.y + label.height <= 396);
  }
});

test('invalid dimensions and coordinates never generate invalid SVG geometry', () => {
  assert.equal(layoutTradeLabels([{ id: 'entry', x: NaN, y: 10, width: 100 }], 300, 400).length, 0);
  assert.equal(layoutTradeLabels([], NaN, 400).length, 0);
  assert.equal(layoutTradeLabels([{ id: 'entry', x: 10, y: 10, width: 100 }], 50, 400).length, 0);
});
