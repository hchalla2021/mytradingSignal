const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const postcss = require('postcss');

const folder = path.join(__dirname, '..', 'components');
const source = readFileSync(path.join(folder, 'ChartWorkspace.tsx'), 'utf8');
const ast = ts.createSourceFile('ChartWorkspace.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let focusEffect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' &&
      node.arguments[0]?.getText(ast).includes('previousOverflow')) focusEffect = node.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);

function lifecycle(fullscreen, controlsOpen = false) {
  const listeners = new Map();
  const state = { fullscreen, controlsOpen };
  const document = {
    body: { style: { overflow: 'auto' } },
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); },
  };
  const compiled = ts.transpileModule(`const effect = ${focusEffect}; result.cleanup = effect();`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const result = {};
  vm.runInNewContext(compiled, {
    result, document, fullscreen, controlsOpen,
    setFullscreen: value => { state.fullscreen = value; },
    setControlsOpen: value => { state.controlsOpen = value; },
  });
  return { document, listeners, state, cleanup: result.cleanup };
}

test('full chart locks background scrolling and Escape exits focus and closes menus', () => {
  assert.ok(focusEffect, 'Focus lifecycle effect must exist');
  const h = lifecycle(true, true);
  assert.equal(h.document.body.style.overflow, 'hidden');
  h.listeners.get('keydown')({ key: 'a' });
  assert.equal(h.state.fullscreen, true);
  h.listeners.get('keydown')({ key: 'Escape' });
  assert.deepEqual(h.state, { fullscreen: false, controlsOpen: false });
  h.cleanup();
  assert.equal(h.document.body.style.overflow, 'auto');
  assert.equal(h.listeners.size, 0);
});

test('opening a menu alone never locks page scrolling; idle charts install no key listener', () => {
  const menu = lifecycle(false, true);
  assert.equal(menu.document.body.style.overflow, 'auto');
  menu.cleanup();
  assert.equal(menu.listeners.size, 0);
  const idle = lifecycle(false);
  assert.equal(idle.listeners.size, 0);
  assert.equal(idle.cleanup, undefined);
});

test('touch layout removes left rail and opens controls without consuming plot grid space', () => {
  const css = postcss.parse(readFileSync(path.join(folder, 'ChartWorkspace.module.css'), 'utf8'));
  const touch = css.nodes.find(node => node.type === 'atrule' && node.params.includes('pointer: coarse'));
  assert.ok(touch, 'Touch layout must include large iPads, not just narrow widths');
  const rule = selector => touch.nodes.find(node => node.selector === selector);
  const value = (selector, prop) => rule(selector)?.nodes.find(node => node.prop === prop)?.value;
  assert.equal(value('.left', 'flex-direction'), 'column');
  assert.equal(value('.sidebar', 'position'), 'absolute');
  assert.equal(value('.workspace select, .workspace input[type="date"]', 'font-size'), '16px');
  assert.doesNotMatch(source, /chart-drawing-tools|Drawing Tools|Drawing tools|data-tools-open|addDrawing/);
  assert.match(source, /\['Indicators', 'Chart Settings'\]/);
  assert.match(source, /aria-label="Chart level overlays"/);
  assert.match(source, /indicators.cpr && renderCprBands\(\)/);
  assert.match(source, /showPaperLevels && selectedPaperTrade/);
  const overlay = css.nodes.find(node => node.selector === '.drawing');
  assert.equal(overlay.nodes.find(node => node.prop === 'pointer-events').value, 'none');
  assert.doesNotMatch(source, /requestFullscreen\(/, 'iOS focus mode must not depend on native fullscreen');
});

test('cleanup removes permanently disabled controls but preserves all working chart tabs', () => {
  const tabs = [];
  const permanentlyDisabled = [];
  function collect(node) {
    if (ts.isJsxOpeningElement(node)) {
      const attrs = node.attributes.properties;
      const id = attrs.find(attr => attr.name?.getText(ast) === 'id');
      if (id?.initializer && /^observatory-.*-tab$/.test(id.initializer.text)) {
        tabs.push(id.initializer.text);
        assert.ok(attrs.some(attr => attr.name?.getText(ast) === 'onClick'));
      }
      if (node.tagName.getText(ast) === 'button' &&
          attrs.some(attr => attr.name?.getText(ast) === 'disabled' && !attr.initializer)) {
        permanentlyDisabled.push(node.getText(ast));
      }
    }
    ts.forEachChild(node, collect);
  }
  collect(ast);
  assert.deepEqual(tabs, [
    'observatory-chart-tab', 'observatory-futures-tab',
    'observatory-terminal-tab', 'observatory-paper-tab',
  ]);
  assert.deepEqual(permanentlyDisabled, []);
  assert.match(source, /disabled=\{history.loading \|\| !history.hasMore\}/);

  const css = postcss.parse(readFileSync(path.join(folder, 'ChartWorkspace.module.css'), 'utf8'));
  const columns = nodes => nodes.find(node => node.selector === '.viewTabs')?.nodes
    .find(node => node.prop === 'grid-template-columns')?.value;
  assert.equal(columns(css.nodes), 'repeat(4, minmax(0, 1fr))');
  const phone = css.nodes.find(node => node.type === 'atrule' && node.params === '(max-width: 639px)');
  assert.equal(columns(phone.nodes), 'repeat(2, minmax(0, 1fr))');
});

test('production chart reconnects never try localhost WebSocket fallbacks', () => {
  const hookSource = readFileSync(path.join(folder, '..', 'hooks', 'useChartIntelligence.ts'), 'utf8');
  assert.match(hookSource, /if \(isLocal\) \{ urlSet.add\(local\); urlSet.add\(port8000\); urlSet.add\(primary\); \}\s*else \{ urlSet.add\(primary\); \}/);
});
