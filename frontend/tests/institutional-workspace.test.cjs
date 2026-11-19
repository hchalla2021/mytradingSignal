const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const components = path.join(__dirname, '..', 'components');
function harness(filename, imports = {}) {
  const states = [];
  let cursor = 0;
  let focused;
  const react = {
    useState: initial => {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = value; }];
    },
    useMemo: fn => fn(),
    useCallback: fn => fn,
    useEffect: () => {},
    memo: component => component,
  };
  const compiled = ts.transpileModule(readFileSync(path.join(components, filename), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    },
  }).outputText;
  const context = {
    exports: {},
    document: { getElementById: id => ({ focus: () => { focused = id; } }) },
    require: id => {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime') return require(id);
      if (id === 'next/dynamic') return () => function DynamicComponent() {};
      if (id.endsWith('.module.css')) return {};
      if (id in imports) return imports[id];
      throw new Error(`Unexpected import ${id}`);
    },
  };
  vm.runInNewContext(compiled, context);
  return {
    render: props => {
      cursor = 0;
      return context.exports.default(props);
    },
    focused: () => focused,
  };
}

function elements(tree, visibleOnly = false) {
  const result = [];
  function walk(node) {
    if (!node || typeof node !== 'object' || (visibleOnly && node.props?.hidden)) return;
    result.push(node);
    for (const child of [node.props?.children].flat(Infinity)) walk(child);
  }
  walk(tree);
  return result;
}
const find = (tree, id) => elements(tree).find(node => node.props?.id === id);

test('QuantumEdge is first, then AQTE, charts and live indices without duplicate providers', () => {
  const page = readFileSync(path.join(components, '..', 'app', 'page.tsx'), 'utf8');
  const source = ts.createSourceFile('page.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let dashboard;
  function visit(node) {
    if (ts.isJsxElement(node)) {
      const className = node.openingElement.attributes.properties.find(attribute =>
        ts.isJsxAttribute(attribute) && attribute.name.text === 'className' &&
        attribute.initializer && ts.isStringLiteral(attribute.initializer) &&
        attribute.initializer.text === 'mx-auto flex w-full max-w-[1820px] flex-col');
      if (className) dashboard = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(dashboard, 'Dashboard flex container must exist');
  const children = dashboard.children.filter(child => ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child));
  assert.match(children[0].getText(source), /<QuantumEdgeIntradaySection marketData=\{marketData\} isConnected=\{isConnected\}\s*\/>/);
  assert.match(children[2].getText(source), /<AQTESection marketData=\{marketData\} isConnected=\{isConnected\}\s*\/>/);
  assert.match(children[3].getText(source), /<ChartWorkspace marketData=\{marketData\} institutionalData=\{institutionalData\}/);
  const orderOf = node => {
    const opening = ts.isJsxElement(node) ? node.openingElement : node;
    const style = opening.attributes.properties.find(attribute =>
      ts.isJsxAttribute(attribute) && attribute.name.text === 'style');
    const match = style?.getText(source).match(/order:\s*(-?\d+)/);
    return match ? Number(match[1]) : 0;
  };
  assert.ok(children.slice(1).every(child => orderOf(child) > orderOf(children[0])));
  assert.match(children[4].getText(source), /<LiveMarketIndexTabs\b/);
  assert.ok(children.slice(3).every(child => orderOf(child) > orderOf(children[2])));
  assert.ok(children.slice(5).every(child => orderOf(child) > orderOf(children[4])));
  assert.equal((page.match(/<QuantumEdgeIntradaySection\b/g) ?? []).length, 1);
  assert.equal((page.match(/<AQTESection\b/g) ?? []).length, 1);
  assert.equal((page.match(/<LiveMarketIndexTabs\b/g) ?? []).length, 1);
  assert.equal((page.match(/<ChartWorkspace\b/g) ?? []).length, 1);
  assert.equal((page.match(/<InstitutionalWorkspace\b/g) ?? []).length, 1);
  assert.match(page, /onSnapshot=\{setInstitutionalData\}/);
});

test('QuantumEdge dashboard is autonomous and uses independent index controls', () => {
  const source = readFileSync(path.join(components, 'QuantumEdgeIntradaySection.tsx'), 'utf8');
  assert.match(source, /QuantumEdge IntraDay Algo — Intraday Algo \| CE \/ PE/);
  assert.match(source, /QuantumEdge master auto live/);
  assert.match(source, /independent engine/);
  assert.match(source, /Risk \/ lot/);
  assert.match(source, /Signal-triggered AI only/);
  assert.match(source, /Edit \$\{displayName\(symbol\)\} lots and risk/);
  assert.match(source, /qe-save-config/);
  assert.match(source, /recorded\?\.setup_key === signal\.setup_key/);
  assert.match(source, /title=\{item\.reason\}/);
  assert.match(source, /signal\.status/);
  assert.match(source, /LIVE_POSITION/);
  assert.match(source, /generation\.current \+= 1/);
  assert.match(source, /mutating\.current = true/);
  assert.doesNotMatch(source, /\? 0\s*:\s*null/);
  assert.match(source, /active\?\.entry_at/);
  assert.doesNotMatch(source, /MANUAL ORDER|PLACE ORDER/);
  const css = readFileSync(path.join(components, '..', 'app', 'globals.css'), 'utf8');
  assert.match(css, /\.qe-shell\s*\{[^}]*isolation:\s*isolate/s);
  assert.match(css, /grid-template-columns:\s*auto minmax\(44px, 72px\) auto minmax\(72px, 1fr\) auto/);
  assert.match(css, /max-width:\s*420px/);
});

test('dashboard keeps BTST and removes the retired strategy workspace', () => {
  const page = readFileSync(path.join(components, '..', 'app', 'page.tsx'), 'utf8');
  assert.equal((page.match(/<CRTBTSTCard\b/g) ?? []).length, 1);
  assert.match(page, /data-testid="btst-strategy"/);
  assert.match(page, /idPrefix="strategy-btst"/);
  assert.doesNotMatch(page, /MarketEdgeIntelligence|ExpiryExplosionZone|TrendBaseCard/);
  assert.doesNotMatch(page, /MarketAnalysisTabs|MarketRegimeIntelligence|StrikeIntelligence/);
});

function workspace() {
  function IndexTabList() {}
  const h = harness('InstitutionalWorkspace.tsx', {
    '@/components/IndexTabs': { IndexTabList },
  });
  const props = { marketData: {}, isConnected: true, onSnapshot: () => {} };
  return { ...h, render: () => h.render(props), props, IndexTabList };
}

test('workspace keeps only FII/DII and official cash tabs with a shared index selection', () => {
  const h = workspace();
  let tree = h.render();
  const tabs = elements(tree).filter(node => node.props?.role === 'tab');
  assert.deepEqual(tabs.map(tab => tab.props.id), ['institutional-feature-flow', 'institutional-feature-official']);
  const selector = elements(tree).find(node => node.type === h.IndexTabList);
  assert.equal(selector.props.activeSymbol, 'NIFTY');
  assert.equal(find(tree, 'institutional-content-flow').props.hidden, undefined);
  selector.props.onSelect('BANKNIFTY');
  tree = h.render();
  const flow = find(tree, 'institutional-content-flow');
  assert.equal(flow.props.children[1].props.selectedSymbol, 'BANKNIFTY');
  assert.equal(flow.props.children[1].props.activeView, 'flow');
  const provider = flow.props.children[1];
  assert.equal(provider.props.onSnapshot, h.props.onSnapshot);
  assert.equal(provider.props.marketData, h.props.marketData);
  assert.doesNotMatch(readFileSync(path.join(components, 'InstitutionalWorkspace.tsx'), 'utf8'), /SmartAIAlgoSection|Big Player Radar|institutional-feature-(algo|radar)/);
});

test('official tab hides the index selector without losing selection or disconnecting snapshot delivery', () => {
  const h = workspace();
  elements(h.render()).find(node => node.type === h.IndexTabList).props.onSelect('SENSEX');
  find(h.render(), 'institutional-feature-official').props.onClick();
  const tree = h.render();
  assert.equal(elements(tree, true).some(node => node.type === h.IndexTabList), false);
  assert.equal(find(tree, 'institutional-index-content').props.role, undefined);
  const official = find(tree, 'institutional-content-official');
  const provider = elements(official).find(node => node.props?.activeView === 'official');
  assert.ok(provider);
  assert.equal(provider.props.onSnapshot, h.props.onSnapshot);
  for (const feature of ['flow', 'official']) {
    const tab = find(tree, `institutional-feature-${feature}`);
    const panel = find(tree, tab.props['aria-controls']);
    assert.equal(panel.props['aria-labelledby'], tab.props.id);
    assert.equal(tab.props['aria-selected'], feature === 'official');
  }
  find(tree, 'institutional-feature-flow').props.onClick();
  assert.equal(elements(h.render()).find(node => node.type === h.IndexTabList).props.activeSymbol, 'SENSEX');
});

test('feature tabs support wrapping keyboard navigation and move focus', () => {
  const h = workspace();
  find(h.render(), 'institutional-feature-official').props.onClick();
  for (const [key, expected] of [['ArrowLeft', 'flow'], ['ArrowRight', 'official'], ['End', 'official'], ['Home', 'flow']]) {
    const active = elements(h.render()).find(node => node.props?.role === 'tab' && node.props['aria-selected']);
    let prevented = false;
    active.props.onKeyDown({ key, preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(h.focused(), `institutional-feature-${expected}`);
    assert.equal(find(h.render(), `institutional-feature-${expected}`).props['aria-selected'], true);
  }
});

test('FII/DII provider has no Big Player Radar view or markup', () => {
  const source = readFileSync(path.join(components, 'FIIDIIFlowStrip.tsx'), 'utf8');
  assert.doesNotMatch(source, /Big Player Radar|activeView === 'radar'|radarEvents/);
});
