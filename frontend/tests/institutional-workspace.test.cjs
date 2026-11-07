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

test('AQTE precedes charts and live indices without duplicating dashboard providers', () => {
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
  assert.match(children[0].getText(source), /<AQTESection marketData=\{marketData\} isConnected=\{isConnected\}\s*\/>/);
  assert.match(children[1].getText(source), /<ChartWorkspace marketData=\{marketData\} institutionalData=\{institutionalData\}/);
  const orderOf = node => {
    const opening = ts.isJsxElement(node) ? node.openingElement : node;
    const style = opening.attributes.properties.find(attribute =>
      ts.isJsxAttribute(attribute) && attribute.name.text === 'style');
    const match = style?.getText(source).match(/order:\s*(-?\d+)/);
    return match ? Number(match[1]) : 0;
  };
  assert.ok(children.slice(1).every(child => orderOf(child) > orderOf(children[0])));
  assert.match(children[2].getText(source), /<LiveMarketIndexTabs\b/);
  assert.ok(children.slice(2).every(child => orderOf(child) > orderOf(children[1])));
  assert.ok(children.slice(3).every(child => orderOf(child) > orderOf(children[2])));
  assert.equal((page.match(/<AQTESection\b/g) ?? []).length, 1);
  assert.equal((page.match(/<LiveMarketIndexTabs\b/g) ?? []).length, 1);
  assert.equal((page.match(/<ChartWorkspace\b/g) ?? []).length, 1);
  assert.equal((page.match(/<InstitutionalWorkspace\b/g) ?? []).length, 1);
  assert.match(page, /onSnapshot=\{setInstitutionalData\}/);
});

test('market analysis retains the single selected regime panel', () => {
  const h = harness('MarketAnalysisTabs.tsx');
  const section = { type: 'div', props: { children: 'Regime details' } };
  const tree = h.render({ section });
  const tabs = elements(tree).filter(node => node.props?.role === 'tab');
  const panels = elements(tree, true).filter(node => node.props?.role === 'tabpanel');
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].props.id, 'market-analysis-tab-regime');
  assert.equal(tabs[0].props['aria-selected'], 'true');
  assert.equal(tabs[0].props['aria-controls'], 'market-analysis-panel-regime');
  assert.equal(panels.length, 1);
  assert.equal(panels[0].props['aria-labelledby'], tabs[0].props.id);
  assert.equal(panels[0].props.children, section);
});

test('market regime retains strike intelligence and removes the quantum sections', () => {
  const source = readFileSync(path.join(components, 'MarketRegimeIntelligence.tsx'), 'utf8');
  assert.match(source, /<StrikeIntelligence\s*\/>/);
  assert.doesNotMatch(source, /QuantumFractalSection|Quantum Fractal Intelligence Engine|Institutional Confluence Engine/);
});

test('dashboard keeps only Market Regime in the analysis workspace', () => {
  const page = readFileSync(path.join(components, '..', 'app', 'page.tsx'), 'utf8');
  assert.match(page, /<MarketAnalysisTabs section=\{<MarketRegimeIntelligence marketData=\{marketData\} \/>}/);
  assert.doesNotMatch(page, /SMCStructureSection|TradingIntelligenceEngine|VolumePulseCard|ICTIntelligence|InstitutionalCompass/);
  assert.doesNotMatch(page, /serverOutlook|market-outlook-all|aggregatedMarketSignal/);
});

test('dashboard keeps BTST and removes the retired strategy workspace', () => {
  const page = readFileSync(path.join(components, '..', 'app', 'page.tsx'), 'utf8');
  assert.equal((page.match(/<CRTBTSTCard\b/g) ?? []).length, 1);
  assert.match(page, /data-testid="btst-strategy"/);
  assert.match(page, /idPrefix="strategy-btst"/);
  assert.doesNotMatch(page, /MarketEdgeIntelligence|ExpiryExplosionZone|TrendBaseCard/);
  assert.doesNotMatch(page, /MarketAnalysisTabs variant="strategy"/);
  const tabs = readFileSync(path.join(components, 'MarketAnalysisTabs.tsx'), 'utf8');
  assert.doesNotMatch(tabs, /STRATEGIES|market-strategy|variant: 'strategy'/);
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
