const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const components = path.join(__dirname, '..', 'components');
function harness(filename, imports = {}, initialStates = [], runtime = {}) {
  const states = [...initialStates];
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
    useEffect: runtime.useEffect ?? (() => {}),
    useRef: initial => ({ current: initial }),
    memo: component => component,
  };
  const compiled = ts.transpileModule(readFileSync(path.join(components, filename), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    },
  }).outputText;
  const context = {
    ...runtime.globals,
    exports: {},
    document: { getElementById: id => ({ focus: () => { focused = id; } }) },
    require: id => {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime') return require(id);
      if (id === 'next/dynamic') return () => function DynamicComponent() {};
      if (id === './QuantumEdgeMiniChart') return function QuantumEdgeMiniChart() {};
      if (id.endsWith('.module.css')) return {};
      if (id in imports) return imports[id];
      throw new Error(`Unexpected import ${id}`);
    },
  };
  vm.runInNewContext(compiled, context);
  return {
    setState: (index, value) => { states[index] = value; },
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

test('SMC Apex is first, then QuantumEdge, AQTE, charts and live indices without duplicate providers', () => {
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
  assert.match(children[0].getText(source), /<SMCApexSection\s*\/>/);
  assert.match(children[1].getText(source), /<QuantumEdgeIntradaySection marketData=\{marketData\} isConnected=\{isConnected\}\s*\/>/);
  assert.match(children[3].getText(source), /<AQTESection marketData=\{marketData\} isConnected=\{isConnected\}\s*\/>/);
  assert.match(children[4].getText(source), /<ChartWorkspace marketData=\{marketData\} institutionalData=\{institutionalData\}/);
  const orderOf = node => {
    const opening = ts.isJsxElement(node) ? node.openingElement : node;
    const style = opening.attributes.properties.find(attribute =>
      ts.isJsxAttribute(attribute) && attribute.name.text === 'style');
    const match = style?.getText(source).match(/order:\s*(-?\d+)/);
    return match ? Number(match[1]) : 0;
  };
  assert.ok(children.slice(1).every(child => orderOf(child) > orderOf(children[0])));
  assert.match(children[5].getText(source), /<LiveMarketIndexTabs\b/);
  assert.ok(children.slice(4).every(child => orderOf(child) > orderOf(children[3])));
  assert.ok(children.slice(6).every(child => orderOf(child) > orderOf(children[5])));
  assert.equal((page.match(/<SMCApexSection\b/g) ?? []).length, 1);
  assert.equal((page.match(/<QuantumEdgeIntradaySection\b/g) ?? []).length, 1);
  assert.equal((page.match(/<AQTESection\b/g) ?? []).length, 1);
  assert.equal((page.match(/<LiveMarketIndexTabs\b/g) ?? []).length, 1);
  assert.equal((page.match(/<ChartWorkspace\b/g) ?? []).length, 1);
  assert.equal((page.match(/<InstitutionalWorkspace\b/g) ?? []).length, 1);
  assert.match(page, /onSnapshot=\{setInstitutionalData\}/);
});

test('QuantumEdge dashboard is autonomous and uses independent index controls', () => {
  const source = readFileSync(path.join(components, 'QuantumEdgeIntradaySection.tsx'), 'utf8');
  assert.match(source, /QuantumEdge <span>Intraday<\/span>/);
  assert.match(source, /Python Rules • Price Action • AI Analysis • NIFTY • BANK NIFTY • SENSEX/);
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
  assert.match(css, /\.qe-topbar\s*\{[^}]*border:\s*1px solid #35e676/s);
  assert.match(css, /grid-template-columns:\s*auto minmax\(44px, 72px\) auto minmax\(72px, 1fr\) auto/);
  assert.match(css, /max-width:\s*420px/);
});

test('QuantumEdge market status is green when open and red when closed', () => {
  for (const [phase, label, tone] of [
    ['NORMAL', 'OPEN', 'qe-market-open'],
    ['CLOSED', 'CLOSED', 'qe-market-closed'],
  ]) {
    const snapshot = { generated_at: Date.now() / 1000, market_phase: phase,
      indices: {}, signals: {}, ai: { last_result: {} }, positions: [] };
    const h = harness('QuantumEdgeIntradaySection.tsx', {
      'lucide-react': require('lucide-react'),
      '@/lib/api-config': { API_CONFIG: {} },
      '@/lib/visitor-id': { getOrCreateVisitorId: () => 'test' },
    }, [snapshot]);
    const status = elements(h.render({})).find(node => node.props?.className === 'qe-status');
    const labelNode = elements(status).find(node => node.type === 'b');
    assert.equal(labelNode.props.children, label);
    assert.equal(labelNode.props.className, tone);
  }
});

test('QuantumEdge active panel keeps Square Off above its historical candlestick chart', () => {
  const source = readFileSync(path.join(components, 'QuantumEdgeIntradaySection.tsx'), 'utf8');
  const chart = readFileSync(path.join(components, 'QuantumEdgeMiniChart.tsx'), 'utf8');
  const css = readFileSync(path.join(components, '..', 'app', 'globals.css'), 'utf8');
  assert.match(source, /className="qe-active-actions"[\s\S]*?className="qe-square-off"/);
  assert.match(source, /<QuantumEdgeMiniChart marketData=\{marketData\} \/>/);
  assert.match(chart, /useChartHistory\(symbol, timeframe\)/);
  assert.match(chart, /addCandlestickSeries/);
  assert.match(chart, /addHistogramSeries/);
  assert.match(chart, /history\.jumpToDate\(dateInput\)/);
  assert.match(chart, /history\.loadOlder\(\)/);
  assert.match(chart, /ema\(candles, 9\)/);
  assert.match(chart, /ema\(candles, 20\)/);
  assert.match(chart, /ema\(candles, 50\)/);
  assert.match(chart, /vwap\(candles\)/);
  assert.match(chart, /rsi\(candles, 14\)/);
  assert.match(chart, /aria-label="Choose chart index"/);
  assert.match(css, /\.qe-mini-index-tabs\s*\{[^}]*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.qe-mini-plot\s*\{[^}]*height:\s*270px/);
  assert.match(css, /@container qe-active \(max-width: 480px\)/);
});

test('QuantumEdge opportunity text uses fixed stable viewports and no reflow transitions', () => {
  const css = readFileSync(path.join(components, '..', 'app', 'globals.css'), 'utf8');
  assert.match(css, /@container qe-opportunities \(max-width: 900px\) and \(min-width: 601px\)/);
  assert.match(css, /@container qe-opportunities \(max-width: 600px\)/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*Responsive QuantumEdge live opportunity panel/);
  assert.match(css, /@media \(min-width: 901px\)[\s\S]*display:\s*table-row/);
  assert.match(css, /@media \(min-width: 901px\) and \(max-width: 1220px\)[\s\S]*grid-template-columns:\s*minmax\(520px/);
  assert.match(css, /\.qe-opportunities\s+\.qe-opp-table\s+tbody\s+tr\s*\{[^}]*height:\s*132px/);
  assert.match(css, /\.qe-opp-details\s*\{[^}]*height:\s*auto[^}]*overflow-y:\s*visible/);
  assert.match(css, /Final QuantumEdge opportunity typography and width pass/);
  assert.match(css, /\.qe-opp-table\s+thead\s+th:last-child\s*\{[^}]*width:\s*34%/);
  assert.match(css, /\.qe-opp-details\s+\.qe-wait-reason,[\s\S]*?font-size:\s*11px/);
  assert.match(css, /\.qe-wait-reason\s*\{[^}]*transition:\s*none/);
});

test('QuantumEdge live opportunities header matches the reference composition', () => {
  const source = readFileSync(path.join(components, 'QuantumEdgeIntradaySection.tsx'), 'utf8');
  const css = readFileSync(path.join(components, '..', 'app', 'globals.css'), 'utf8');
  assert.match(source, /LIVE OPPORTUNITIES/);
  assert.match(source, /Market-scanned setups/);
  assert.match(source, /qe-opp-header-spark/);
  assert.match(source, /qe-opp-live/);
  assert.match(css, /\.qe-opp-header\s*\{[^}]*height:\s*112px/);
  assert.match(css, /\.qe-opp-header-title h3\s*\{[^}]*font-size:\s*clamp\(21px/);
  assert.match(css, /\.qe-opp-table\s+thead\s+th:first-child\s*\{[^}]*width:\s*22%/);
});

test('QuantumEdge shows signal, AI rejection and execution blockers without hover', () => {
  const snapshot = {
    generated_at: Date.now() / 1000, enabled: true, market_phase: 'NORMAL',
    indices: {}, signals: {
      NIFTY: { decision: 'WAIT', status: 'WAIT_SIGNAL', reason: 'Trend and breakout are not aligned' },
      BANKNIFTY: { decision: 'BUY CE', status: 'AI_UNAVAILABLE', reason: 'Claude returned an invalid decision',
        strategy_name: 'Opening Range Breakout',
        price_action: { structure: 'BULLISH', displacement: 'BULLISH', fvg: { side: 'BULLISH', low: 201, high: 205 } } },
      SENSEX: { decision: 'BUY CE', side: 'CE', status: 'ENTRY_BLOCKED', reason: 'Daily loss budget exceeded' },
    },
    ai: { last_result: {} }, positions: [],
  };
  const h = harness('QuantumEdgeIntradaySection.tsx', {
    'lucide-react': require('lucide-react'),
    '@/lib/api-config': { API_CONFIG: {} },
    '@/lib/visitor-id': { getOrCreateVisitorId: () => 'test' },
  }, [snapshot]);
  const nodes = elements(h.render({}));
  const table = nodes.find(node => node.props?.['aria-label'] === 'Index opportunities');
  assert.ok(table);
  assert.deepEqual(elements(table).filter(node => node.type === 'th' && node.props.scope === 'col')
    .map(node => node.props.children.props.children[1]), [
      'Index', 'Signal', 'Premium', 'Confidence', 'Status',
    ]);
  assert.equal(elements(table).filter(node => node.props?.className === 'qe-opp-details').length, 3);
  assert.equal(elements(table).filter(node => node.props?.className === 'qe-opp-symbol').length, 3);
  const reasons = nodes.filter(node => node.props?.className === 'qe-wait-reason');
  assert.deepEqual(reasons.map(node => node.props.children).filter(value => typeof value === 'string'), [
    'Trend and breakout are not aligned', 'Claude returned an invalid decision', 'Daily loss budget exceeded',
  ]);
  assert.ok(nodes.some(node => node.type === 'em' && node.props.children === 'AI REVIEW UNAVAILABLE'));
  const source = readFileSync(path.join(components, 'QuantumEdgeIntradaySection.tsx'), 'utf8');
  assert.match(source, /item\.signal\?\.strategy_name/);
  assert.ok(reasons.some(node => node.props.children.includes(
    'Upside 5-bar break · Bullish displacement · Bullish FVG 201.00–205.00')));
  assert.ok(nodes.some(node => node.type === 'b' && node.props.children === 'Daily loss budget exceeded'));
  const confidence = nodes.find(node => node.props?.className === 'qe-confidence');
  assert.equal(confidence.props.children[1].props.children, '—');
});

test('QuantumEdge displays option LTP and tones P&L in the active card and positions table', () => {
  for (const [ltp, pnl, tone, expectedLtp, expectedPnl, expectedReturn, marker] of [
    [110.10, 565.50, 'profit', '₹110.10', '₹565.50', '+8.58%', 45.58],
    [98.45, -191.75, 'loss', '₹98.45', '₹-191.75', '-2.91%', 26.68],
    [101.40, 0, 'flat', '₹101.40', '₹0.00', '0.00%', 31.47],
    [80, null, 'flat', '₹80.00', '—', '—', 0],
    [150, null, 'flat', '₹150.00', '—', '—', 100],
    [null, null, 'flat', '—', '—', '—', null],
  ]) {
    const active = { id: 'trade-1', symbol: 'NIFTY', state: 'PROTECTED', entry_price: 101.40,
      contract: { trading_symbol: 'NIFTY26NOV25800CE', lot_size: 65 },
      stop: 82, target: 143.65, filled: 65, quantity: 65, ltp, unrealized: pnl };
    const { render } = harness('QuantumEdgeIntradaySection.tsx', {
      'lucide-react': require('lucide-react'),
      '@/lib/api-config': { API_CONFIG: {} },
      '@/lib/visitor-id': { getOrCreateVisitorId: () => 'test' },
    }, [{ generated_at: Date.now() / 1000, indices: {}, signals: {}, ai: { last_result: {} },
      active, positions: [active], daily_pnl: pnl }]);
    const nodes = elements(render({}));
    const tile = nodes.find(node => node.props?.className === 'qe-level qe-level-ltp');
    assert.equal(tile.props.children[0].props.children, 'LTP');
    assert.equal(tile.props.children[1].props.children, expectedLtp);
    const caption = nodes.find(node => node.props?.className === 'qe-track-caption');
    assert.equal([caption.props.children.props.children].flat().join(''), `LTP ${expectedLtp}`);
    const dot = nodes.find(node => node.props?.className === 'qe-track-marker');
    if (marker == null) assert.equal(dot, undefined);
    else assert.ok(Math.abs(parseFloat(dot.props.style.left) - marker) < 0.01);
    const pnlTile = nodes.find(node => node.props?.className === `qe-level qe-pnl qe-pnl-${tone}`);
    assert.equal(pnlTile.props.children[1].props.children, expectedPnl);
    assert.equal(pnlTile.props.children[2].props.children, pnl == null ? 'Awaiting mark' : expectedReturn);
    const positionRow = nodes.find(node => node.type === 'tr' && node.key === 'trade-1');
    const cells = positionRow.props.children;
    assert.equal(cells.length, 12);
    for (const cell of cells) {
      assert.equal(cell.type, 'td');
      assert.match(cell.props.children.props.className, /qe-position-value/);
    }
    assert.equal(cells.find(node => node.props.className === 'qe-position-ltp')
      .props.children.props.children, expectedLtp);
    assert.deepEqual(nodes.filter(node => node.type === 'td' && node.props.className === `qe-pnl-${tone}`)
      .map(node => node.props.children.props.children), [expectedPnl, expectedReturn]);
    assert.ok(nodes.some(node => node.type === 'dd' && node.props.className === `qe-pnl-${tone}`
      && node.props.children === expectedPnl));
  }
});

test('QuantumEdge shows futures invalidation separately from its option-premium stop', () => {
  const active = {
    id: 'trade-1', symbol: 'NIFTY', state: 'PROTECTED', entry_price: 101.40,
    contract: { trading_symbol: 'NIFTY26NOV25800CE', lot_size: 65 },
    stop: 82, target: 143.65, filled: 65, quantity: 65,
    trailing_mode: 'SMART_ATR_STRUCTURE', trailing_status: 'SMART_ATR_STRUCTURE',
    futures_invalidation: { level: 22000, reference: 22005, buffer: 5, basis: 'SWING_LOW' },
    futures_invalidation_status: 'MONITORING',
  };
  const { render } = harness('QuantumEdgeIntradaySection.tsx', {
    'lucide-react': require('lucide-react'),
    '@/lib/api-config': { API_CONFIG: {} },
    '@/lib/visitor-id': { getOrCreateVisitorId: () => 'test' },
  }, [{ generated_at: Date.now() / 1000, indices: {}, signals: {}, ai: { last_result: {} },
    active, positions: [active] }]);
  const nodes = elements(render({}));
  const invalidation = nodes.find(node => node.props?.className === 'qe-level qe-level-invalidation');
  assert.equal(invalidation.props.children[0].props.children, 'Futures Invalidation');
  assert.equal(invalidation.props.children[1].props.children, '22,000.00');
  assert.match(invalidation.props.children[2].props.children, /SWING LOW/);
  const stop = nodes.find(node => node.props?.className === 'qe-level qe-level-stop');
  assert.equal(stop.props.children[1].props.children, '₹82.00');
  const trail = nodes.find(node => node.props?.className === 'qe-level qe-level-trail');
  assert.equal(trail.props.children[2].props.children, 'ATR + confirmed option swing');
});

test('QuantumEdge exposes a separate square-off action for every open index position', () => {
  const positions = ['NIFTY26NOV25800CE', 'SENSEX26NOV82000PE'].map((trading_symbol, index) => ({
    id: `trade-${index}`, symbol: index ? 'SENSEX' : 'NIFTY',
    state: 'PROTECTED', entry_price: 101, contract: { trading_symbol, lot_size: 10 },
    stop: 82, target: 143, filled: 10, quantity: 10, ltp: 100, unrealized: -10,
  }));
  const { render } = harness('QuantumEdgeIntradaySection.tsx', {
    'lucide-react': require('lucide-react'),
    '@/lib/api-config': { API_CONFIG: {} },
    '@/lib/visitor-id': { getOrCreateVisitorId: () => 'test' },
  }, [{ generated_at: Date.now() / 1000, indices: {}, signals: {}, ai: { last_result: {} },
    active: positions[0], positions }]);
  const nodes = elements(render({}));
  const rows = nodes.filter(node => node.type === 'tr' && node.key?.startsWith('trade-'));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.props.children[11].props.children.props['aria-label']), [
    'Square off NIFTY26NOV25800CE', 'Square off SENSEX26NOV82000PE',
  ]);
});

test('QuantumEdge switches to faster status polling only while a position is open', () => {
  const effects = [];
  const timers = new Map();
  let nextTimer = 0;
  const snapshot = { generated_at: Date.now() / 1000, indices: {}, signals: {},
    ai: { last_result: {} }, positions: [] };
  const h = harness('QuantumEdgeIntradaySection.tsx', {
    'lucide-react': require('lucide-react'),
    '@/lib/api-config': { API_CONFIG: {} },
    '@/lib/visitor-id': { getOrCreateVisitorId: () => 'test' },
  }, [snapshot], {
    useEffect: effect => effects.push(effect),
    globals: {
      setInterval: (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
      clearInterval: id => timers.delete(id),
    },
  });
  let stopPolling;
  for (const [positions, delay] of [[[], 3000], [[{
    id: 'trade1', symbol: 'NIFTY', contract: { trading_symbol: 'NIFTYCE' },
  }], 1000], [[], 3000]]) {
    stopPolling?.();
    effects.length = 0;
    h.setState(0, { ...snapshot, positions });
    h.render({});
    stopPolling = effects[1]();
    assert.ok([...timers.values()].map(timer => timer.delay).includes(delay));
  }
  stopPolling();
  assert.equal(timers.size, 0);
});

test('QuantumEdge position summary keeps realized P&L separate and never shows a partial open P&L total', () => {
  const trade = { symbol: 'NIFTY', contract: { trading_symbol: 'NIFTYCE' } };
  for (const [marks, expectedOpen, expectedTone] of [
    [[200, -300], '₹-100.00', 'qe-pnl-loss'],
    [[200, null], '—', 'qe-pnl-flat'],
    [[], '₹0.00', 'qe-pnl-flat'],
  ]) {
    const { render } = harness('QuantumEdgeIntradaySection.tsx', {
      'lucide-react': require('lucide-react'),
      '@/lib/api-config': { API_CONFIG: {} },
      '@/lib/visitor-id': { getOrCreateVisitorId: () => 'test' },
    }, [{ generated_at: Date.now() / 1000, indices: {}, signals: {}, ai: { last_result: {} },
      positions: marks.map((unrealized, id) => ({ ...trade, id, unrealized })), daily_pnl: 50 }]);
    const summary = elements(render({})).find(node => node.props?.className === 'qe-positions-summary');
    assert.deepEqual(elements(summary).filter(node => node.type === 'dt').map(node => node.props.children),
      ['Realized P&L', 'Open P&L', 'Open positions']);
    const [realized, open, count] = elements(summary).filter(node => node.type === 'dd');
    assert.equal(realized.props.children, '₹50.00');
    assert.equal(realized.props.className, 'qe-pnl-profit');
    assert.equal(open.props.children, expectedOpen);
    assert.equal(open.props.className, expectedTone);
    assert.equal(count.props.children, String(marks.length));
  }
});

test('QuantumEdge positions panel has its own live header and helpful empty state', () => {
  const { render } = harness('QuantumEdgeIntradaySection.tsx', {
    'lucide-react': require('lucide-react'),
    '@/lib/api-config': { API_CONFIG: {} },
    '@/lib/visitor-id': { getOrCreateVisitorId: () => 'test' },
  }, [{ generated_at: Date.now() / 1000, indices: {}, signals: {}, ai: { last_result: {} },
    positions: [], daily_pnl: 0 }]);
  const nodes = elements(render({}));
  const title = nodes.find(node => node.props?.className === 'qe-positions-title');
  assert.ok(elements(title).some(node => node.type === 'h3'
    && node.props.children[0] === 'ALGO POSITIONS '
    && node.props.children[1].props.children === '(LIVE)'));
  assert.ok(elements(title).some(node => node.type === 'p'
    && node.props.children === 'Up to one position per index · three maximum'));
  assert.ok(nodes.some(node => node.props?.className === 'qe-empty-icon'));
  assert.ok(nodes.some(node => node.type === 'small'
    && node.props.children === 'QuantumEdge positions will appear here after a confirmed fill.'));
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
