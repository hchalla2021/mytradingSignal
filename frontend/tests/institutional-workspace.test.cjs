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

test('market analysis section tabs show one panel and preserve all six keyed children', () => {
  const h = harness('MarketAnalysisTabs.tsx');
  const ids = ['smc', 'greeks', 'regime', 'volume', 'ict', 'compass'];
  const sections = Object.fromEntries(ids.map(id => [id, { type: 'div', props: { children: id } }]));
  const render = () => h.render({ sections });
  assert.equal(find(render(), 'market-analysis-panel-smc').props.hidden, false);
  for (const id of ids) {
    find(render(), `market-analysis-tab-${id}`).props.onClick();
    const tree = render();
    const visible = elements(tree, true).filter(node => node.props?.role === 'tabpanel');
    assert.equal(visible.length, 1);
    assert.equal(visible[0].props.id, `market-analysis-panel-${id}`);
    for (const key of ids) {
      const panel = find(tree, `market-analysis-panel-${key}`);
      const tab = find(tree, `market-analysis-tab-${key}`);
      assert.equal(panel.key, key);
      assert.equal(panel.props.children, sections[key]);
      assert.equal(panel.props['aria-labelledby'], tab.props.id);
      assert.equal(tab.props['aria-controls'], panel.props.id);
      assert.equal(tab.props.tabIndex, key === id ? 0 : -1);
    }
  }
  sections.smc = { type: 'div', props: { children: 'Updated hidden data' } };
  assert.equal(find(render(), 'market-analysis-panel-smc').props.children, sections.smc);
});

test('market analysis section keyboard navigation wraps and supports Home/End', () => {
  const h = harness('MarketAnalysisTabs.tsx');
  const sections = Object.fromEntries(['smc', 'greeks', 'regime', 'volume', 'ict', 'compass'].map(id => [id, id]));
  for (const [key, expected] of [
    ['ArrowLeft', 'compass'], ['ArrowRight', 'smc'], ['End', 'compass'], ['Home', 'smc'], ['ArrowRight', 'greeks'],
  ]) {
    const active = elements(h.render({ sections })).find(node => node.props?.role === 'tab' && node.props['aria-selected']);
    let prevented = false;
    active.props.onKeyDown({ key, preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(h.focused(), `market-analysis-tab-${expected}`);
    assert.equal(find(h.render({ sections }), `market-analysis-tab-${expected}`).props['aria-selected'], true);
  }
  find(h.render({ sections }), 'market-analysis-tab-greeks').props.onKeyDown({
    key: 'Tab', preventDefault: () => assert.fail('Tab must keep browser focus navigation'),
  });
});

test('dashboard mounts each analysis module exactly once inside the section workspace', () => {
  const page = readFileSync(path.join(components, '..', 'app', 'page.tsx'), 'utf8');
  for (const component of ['SMCStructureSection', 'TradingIntelligenceEngine', 'MarketRegimeIntelligence', 'ICTIntelligence', 'InstitutionalCompass']) {
    assert.equal((page.match(new RegExp(`<${component}\\b`, 'g')) ?? []).length, 1);
  }
  assert.match(page, /<MarketAnalysisTabs sections=/);
  assert.match(page, /idPrefix="volume-pulse"/);
});

test('strategy workspace has four independent tabs and preserves hidden live content', () => {
  const h = harness('MarketAnalysisTabs.tsx');
  const ids = ['edge', 'trend', 'expiry', 'btst'];
  const sections = Object.fromEntries(ids.map(id => [id, { type: 'div', props: { children: id } }]));
  const render = () => h.render({ variant: 'strategy', sections });
  assert.equal(find(render(), 'market-strategy-panel-edge').props.hidden, false);
  for (const id of ids) {
    find(render(), `market-strategy-tab-${id}`).props.onClick();
    const tree = render();
    const visible = elements(tree, true).filter(node => node.props?.role === 'tabpanel');
    assert.equal(visible.length, 1);
    assert.equal(visible[0].props.id, `market-strategy-panel-${id}`);
    for (const key of ids) {
      const tab = find(tree, `market-strategy-tab-${key}`);
      const panel = find(tree, tab.props['aria-controls']);
      assert.equal(panel.props.children, sections[key]);
      assert.equal(panel.key, key);
      assert.equal(panel.props['aria-labelledby'], tab.props.id);
      assert.equal(tab.props.tabIndex, key === id ? 0 : -1);
    }
  }
  sections.edge = { type: 'div', props: { children: 'Fresh hidden edge' } };
  assert.equal(find(render(), 'market-strategy-panel-edge').props.children, sections.edge);
  for (const [key, expected] of [['ArrowRight', 'edge'], ['ArrowLeft', 'btst'], ['Home', 'edge'], ['End', 'btst']]) {
    const active = elements(render()).find(node => node.props?.role === 'tab' && node.props['aria-selected']);
    active.props.onKeyDown({ key, preventDefault: () => {} });
    assert.equal(h.focused(), `market-strategy-tab-${expected}`);
    assert.equal(find(render(), `market-strategy-tab-${expected}`).props['aria-selected'], true);
  }
  const analysis = harness('MarketAnalysisTabs.tsx');
  assert.equal(find(analysis.render({ sections: { smc: 'SMC' } }), 'market-analysis-tab-smc').props['aria-selected'], true);
});

test('dashboard mounts each strategy once and provides Trend Base and BTST index tabs', () => {
  const page = readFileSync(path.join(components, '..', 'app', 'page.tsx'), 'utf8');
  for (const component of ['MarketEdgeIntelligence', 'ExpiryExplosionZone', 'TrendBaseCard', 'CRTBTSTCard']) {
    assert.equal((page.match(new RegExp(`<${component}\\b`, 'g')) ?? []).length, 1);
  }
  assert.match(page, /<MarketAnalysisTabs variant="strategy"/);
  assert.match(page, /idPrefix="strategy-trend"/);
  assert.match(page, /idPrefix="strategy-btst"/);
});

function workspace() {
  function IndexTabList() {}
  const h = harness('InstitutionalWorkspace.tsx', {
    '@/components/IndexTabs': { IndexTabList },
  });
  const props = { marketData: {}, isConnected: true, onSnapshot: () => {} };
  return { ...h, render: () => h.render(props), props, IndexTabList };
}

test('workspace defaults to NIFTY algo and shares one selected index across feature tabs', () => {
  const h = workspace();
  let tree = h.render();
  const selector = elements(tree).find(node => node.type === h.IndexTabList);
  assert.equal(selector.props.activeSymbol, 'NIFTY');
  assert.equal(find(tree, 'institutional-content-algo').props.hidden, false);
  selector.props.onSelect('BANKNIFTY');
  tree = h.render();
  const algo = find(tree, 'institutional-content-algo').props.children;
  assert.equal(algo.props.selectedSymbol, 'BANKNIFTY');
  const algoType = algo.type;
  find(tree, 'institutional-feature-radar').props.onClick();
  tree = h.render();
  assert.equal(find(tree, 'institutional-content-algo').props.hidden, true);
  assert.equal(find(tree, 'institutional-content-algo').props.children.type, algoType);
  const radar = find(tree, 'institutional-content-radar');
  assert.equal(radar.props.hidden, false);
  const provider = radar.props.children[1];
  assert.equal(provider.props.selectedSymbol, 'BANKNIFTY');
  assert.equal(provider.props.activeView, 'radar');
  assert.equal(provider.props.onSnapshot, h.props.onSnapshot);
  assert.equal(provider.props.marketData, h.props.marketData);
  const providerType = provider.type;
  find(tree, 'institutional-feature-flow').props.onClick();
  tree = h.render();
  assert.equal(find(tree, 'institutional-content-flow').props.children[1].type, providerType);
  assert.equal(find(tree, 'institutional-content-flow').props.children[1].props.selectedSymbol, 'BANKNIFTY');
});

test('official tab hides the index selector without losing selection or disconnecting snapshot delivery', () => {
  const h = workspace();
  elements(h.render()).find(node => node.type === h.IndexTabList).props.onSelect('SENSEX');
  find(h.render(), 'institutional-feature-official').props.onClick();
  const tree = h.render();
  assert.equal(elements(tree, true).some(node => node.type === h.IndexTabList), false);
  assert.equal(find(tree, 'institutional-index-content').props.role, undefined);
  const official = find(tree, 'institutional-content-official');
  assert.equal(official.props.children[1].props.activeView, 'official');
  assert.equal(official.props.children[1].props.onSnapshot, h.props.onSnapshot);
  for (const feature of ['algo', 'radar', 'flow', 'official']) {
    const tab = find(tree, `institutional-feature-${feature}`);
    const panel = find(tree, tab.props['aria-controls']);
    assert.equal(panel.props['aria-labelledby'], tab.props.id);
    assert.equal(tab.props['aria-selected'], feature === 'official');
  }
  find(tree, 'institutional-feature-algo').props.onClick();
  assert.equal(elements(h.render()).find(node => node.type === h.IndexTabList).props.activeSymbol, 'SENSEX');
});

test('feature tabs support wrapping keyboard navigation and move focus', () => {
  const h = workspace();
  for (const [key, expected] of [['ArrowLeft', 'official'], ['ArrowRight', 'algo'], ['End', 'official'], ['Home', 'algo']]) {
    const active = elements(h.render()).find(node => node.props?.role === 'tab' && node.props['aria-selected']);
    let prevented = false;
    active.props.onKeyDown({ key, preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(h.focused(), `institutional-feature-${expected}`);
    assert.equal(find(h.render(), `institutional-feature-${expected}`).props['aria-selected'], true);
  }
});

test('focused algo keeps all three keyed cards mounted, hiding only the other indices', () => {
  const h = harness('SmartAIAlgoSection.tsx', {
    '@/hooks/useSmartAlgo': { useSmartAlgo: () => ({
      data: {}, isConnected: false, aiEnabled: false, adjustSLTarget: () => {}, toggleAlgo: () => {},
    }) },
  });
  const cards = elements(h.render({ selectedSymbol: 'BANKNIFTY' })).filter(node => ['NIFTY', 'BANKNIFTY', 'SENSEX'].includes(node.key));
  assert.equal(cards.length, 3);
  assert.deepEqual(cards.map(node => node.props.hidden), [true, false, true]);
});

test('radar totals, recent events and inferred flow cards are scoped to the selected index', () => {
  const data = {
    success: false,
    realtime: { bigPlayers: {
      sessionBuyCr: 999, sessionSellCr: 900, sessionNetCr: 99, eventsToday: 40, sessionDate: '2026-10-23',
      perSymbol: { NIFTY: { buyCr: 20, sellCr: 5 }, BANKNIFTY: { buyCr: 80, sellCr: 30 } },
      events: [
        { ts: '10:00', symbol: 'NIFTY', side: 'BUY', notionalCr: 20, zScore: 3 },
        { ts: '10:01', symbol: 'BANKNIFTY', side: 'SELL', notionalCr: 30, zScore: 4 },
      ],
    } },
  };
  const h = harness('FIIDIIFlowStrip.tsx', {
    '@/hooks/useFIIDIIFlow': { useFIIDIIFlow: () => ({ data, isLoading: false, error: null, refresh: () => {} }) },
    '@/lib/buyerIntelligence': {},
    '@/lib/participantFlowRealtime': {
      updateParticipantFlowRealtime: () => null,
      aggregateParticipantFlowRealtime: () => null,
    },
    '@/lib/indexMoneyFlowRealtime': { updateIndexMoneyFlow: () => null },
  });
  const props = { isConnected: false, marketData: {}, selectedSymbol: 'BANKNIFTY', activeView: 'radar' };
  const text = tree => elements(tree, true).flatMap(node => [node.props?.children].flat(Infinity).filter(child => typeof child === 'string')).join(' ');
  const radarText = text(h.render(props));
  assert.match(radarText, /BANKNIFTY/);
  assert.doesNotMatch(radarText, /NIFTY \d|999|900|10:00/);
  assert.match(radarText, /80 Cr/);
  assert.match(radarText, /30 Cr/);
  assert.match(radarText, /10:01/);
  const flow = h.render({ ...props, activeView: 'flow' });
  assert.match(text(flow), /not official per-index/);
  assert.doesNotMatch(text(flow), /TOTAL IN:|TOTAL FLOW:|PARTICIPANT TOTAL/);
});
