const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const NOW = Date.parse('2026-03-10T11:00:00+05:30');
const at = seconds => new Date(NOW + seconds * 1000).toISOString();

function snapshot() {
  const spot = { price: 22500, fresh: true, age_s: 1 };
  return {
    generated_at: at(0),
    config: { enabled: true, max_data_age_seconds: 10, max_option_quote_age_seconds: 60 },
    runtime: { engine_enabled: true, auto_paper_trading: false, kill_switch: false },
    session: { phase: 'ACTIVE', market_open: true },
    health: { healthy: true, ai_state: 'ACTIVE', next_run_at: null },
    spots: { NIFTY: spot, BANKNIFTY: spot, SENSEX: spot },
    cycle: null, alerts: [], decisions: [], trades: [], open_trades: [],
    performance: { trades: 0, pnl: 0, wins: 0, win_rate: null, best: 0, worst: 0,
      today: { trades: 0, realized: 0, wins: 0, losses: 0 } },
    ai_usage: { today: { calls: 0, cost_usd: 0 }, month: { cost_usd: 0 } },
  };
}

function cycle(signal) {
  const index = {
    signal, errors: [], analysis: { sparkline: [], timeframes: {} },
    quant: { score: 0, bias: 'NEUTRAL', factors: [], flags: [] },
    options: null, futures: null,
  };
  return {
    at: at(0), trigger: 'SCHEDULED', summary: '', market_alert: { tone: 'NEUTRAL', title: '', detail: '' },
    indices: { NIFTY: index, BANKNIFTY: index, SENSEX: index },
  };
}

function paperTrade(overrides = {}) {
  return {
    id: 1, symbol: 'NIFTY', tradingsymbol: 'NIFTYTESTCE', status: 'OPEN',
    entry: 100, stop_loss: 85, trailing_sl: 105, target1: 115, target2: 130,
    lot_size: 65, lots: 1, last_price: 112, last_quote_at: at(-5), last_price_source: 'BID',
    exit_price: null, exit_reason: null, pnl: null, opened_at: at(-120),
    ...overrides,
  };
}

function render(snap, options = {}) {
  const source = readFileSync(path.join(__dirname, '..', 'components', 'AutonomiqProSection.tsx'), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const states = [snap, options.error ?? null, options.tab ?? 'live', false, null, options.receivedAt ?? NOW, NOW,
    options.responseDelay ?? 0, options.showAllDecisions ?? false, options.showAllAlerts ?? false];
  let cursor = 0;
  const react = {
    memo: component => component,
    useState: initial => {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], value => options.onStateChange?.(index, value)];
    },
    useCallback: fn => fn,
    useMemo: fn => fn(),
    useEffect: () => {},
  };
  const context = {
    exports: {},
    Date: class extends Date { static now() { return NOW; } },
    require: id => {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime') return require(id);
      if (id === 'lucide-react') return new Proxy({}, { get: () => () => null });
      if (id === '@/lib/api-config') return { API_CONFIG: { endpoint: value => value } };
      if (id === '@/lib/visitor-id') return { getOrCreateVisitorId: () => 'test-device' };
      throw new Error(`Unexpected dependency ${id}`);
    },
  };
  vm.runInNewContext(compiled, context);
  return context.exports.default({});
}

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (typeof tree.type === 'function') return nodes(tree.type(tree.props));
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
}

function text(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (!tree || typeof tree !== 'object') return '';
  if (typeof tree.type === 'function') return text(tree.type(tree.props));
  return [tree.props?.children].flat(Infinity).map(text).join(' ');
}

function card(tree, symbol = 'NIFTY') {
  const result = nodes(tree).find(node => node.props?.['aria-label'] === `${symbol} trade card`);
  assert.ok(result, `Missing ${symbol} card`);
  return text(result).replace(/\s+/g, ' ');
}

test('header retains the execution warning and no-AI refresh without a duplicate market badge', () => {
  for (const marketOpen of [true, false]) {
    const snap = snapshot();
    snap.session.market_open = marketOpen;
    const header = nodes(render(snap)).find(node => node.type === 'header');
    const body = text(header).replace(/\s+/g, ' ');
    assert.match(body, /AUTONOMIQ PRO/);
    assert.match(body, /LIVE EXECUTION UNAVAILABLE/);
    const warning = nodes(header).find(node => node.props?.role === 'status');
    assert.equal(warning.props['aria-label'], 'Live order execution unavailable');
    assert.match(text(warning), /LIVE UNAVAILABLE/);
    assert.doesNotMatch(body, /MARKET (OPEN|CLOSED)/);
    const refresh = nodes(header).find(node => node.type === 'button' && text(node).includes('Refresh now'));
    assert.ok(refresh);
    assert.equal(refresh.props.disabled, false);
    assert.equal(refresh.props['aria-label'], 'Refresh now, no AI');
    assert.match(text(refresh), /Refresh · no AI/);
    assert.match(refresh.props.title, /never uses AI tokens/);
  }
});

test('all trade fields remain visible while waiting, without invented prices', () => {
  const tree = render(snapshot());
  for (const symbol of ['NIFTY', 'BANKNIFTY', 'SENSEX']) {
    const body = card(tree, symbol);
    assert.match(body, /Entry \(Premium\) —/);
    assert.match(body, /Stop Loss —/);
    assert.match(body, /Trailing SL —/);
    assert.match(body, /Target \(T1 \/ T2\) — \/ —/);
    assert.match(body, /Live P&L \(pts \/ %\) —/);
    assert.match(body, /Trailing profit \/ loss \(pts \/ %\) —/);
    assert.doesNotMatch(body, /₹\d/);
  }
});

test('a fresh proposal is indicative only and expires with its quote', () => {
  const snap = snapshot();
  const plan = {
    tradingsymbol: 'NIFTYTESTCE', entry: 100, stop_loss: 85, trailing_sl: 92.5,
    target1: 115, target2: 130, quote: { trade_age_s: 5 }, lot_size: 65, lots: 1,
  };
  snap.cycle = cycle({
    action: 'BUY_CE', strength: 'High', timestamp: at(0), plan,
    risk: { approved: true, checks: [] }, reasoning: 'Confirmed', source: 'ai+quant',
  });
  let body = card(render(snap));
  assert.match(body, /BUY CE/);
  assert.match(body, /INDICATIVE SETUP · NO LIVE ORDER/);
  assert.match(body, /Entry \(Premium\) ₹100\.00/);
  assert.match(body, /Stop Loss ₹85\.00/);
  assert.match(body, /Trailing SL —/);
  assert.doesNotMatch(body, /₹92\.50/);
  assert.match(body, /Live P&L \(pts \/ %\) —/);
  assert.match(body, /no order has been placed/i);

  plan.quote.trade_age_s = 61;
  body = card(render(snap));
  assert.match(body, /WAIT/);
  assert.match(body, /Previous signal expired or unavailable/);
  assert.match(body, /Entry \(Premium\) —/);
  assert.doesNotMatch(body, /₹100\.00/);

  plan.quote.trade_age_s = 5;
  snap.spots.NIFTY = { ...snap.spots.NIFTY, age_s: 9 };
  body = card(render(snap, { responseDelay: 2000 }));
  assert.match(body, /WAIT/);
  assert.match(body, /Entry \(Premium\) —/);
});

test('legacy simulated positions and results are never displayed as live across tabs', () => {
  const snap = snapshot();
  snap.open_trades = [paperTrade()];
  snap.trades = [paperTrade({ status: 'CLOSED', exit_price: 95, exit_reason: 'STOP_LOSS', pnl: -325 })];
  snap.performance = { trades: 1, pnl: -325, wins: 0, win_rate: 0, best: 0, worst: -325,
    today: { trades: 1, realized: -325, wins: 0, losses: 1 } };
  snap.config = { ...snap.config, auto_paper_trading: true, paper_lots: 1, live_trading: true, monthly_budget_usd: 25 };
  snap.alerts = [
    { id: 1, created_at: at(0), level: 'success', symbol: 'NIFTY', message: 'PAPER BUY NIFTYTESTCE' },
    { id: 2, created_at: at(0), level: 'error', symbol: null,
      message: 'KILL SWITCH engaged — all paper positions closed, entries blocked' },
  ];
  for (const tab of ['live', 'analysis', 'alerts', 'trades', 'performance', 'settings']) {
    const body = text(render(snap, { tab })).replace(/\s+/g, ' ');
    assert.doesNotMatch(body, /\bpaper\b/i, `${tab} exposes simulated trading`);
    assert.doesNotMatch(body, /NIFTYTESTCE|₹-325|₹780/, `${tab} exposes simulated results`);
    assert.match(body, /LIVE EXECUTION UNAVAILABLE/);
  }
  assert.match(text(render(snap, { tab: 'trades' })), /Live trade history is unavailable/);
  assert.match(text(render(snap, { tab: 'performance' })), /Live trading performance is unavailable/);
  assert.match(text(render(snap, { tab: 'alerts' })), /KILL SWITCH engaged — entries blocked/);
  assert.match(text(render(snap, { tab: 'settings' })), /Live trading.*Locked/);
});

test('an old backend with simulated entries enabled displays a restart warning', () => {
  const snap = snapshot();
  snap.runtime.auto_paper_trading = true;
  assert.match(text(render(snap)), /simulated entries may still be active.*Restart the backend/i);
});

test('recent decisions and live alerts show five and can expand independently', () => {
  const snap = snapshot();
  snap.decisions = Array.from({ length: 8 }, (_, id) => ({
    id, created_at: at(0), symbol: 'NIFTY', action: 'WAIT', reasoning: `Decision ${id}`,
  }));
  snap.alerts = Array.from({ length: 7 }, (_, id) => ({
    id, created_at: at(0), level: 'info', message: `Alert ${id}`,
  }));
  const changes = [];
  let tree = render(snap, { onStateChange: (index, value) => changes.push([index, value]) });
  let body = text(tree);
  assert.match(body, /Decision 4/);
  assert.doesNotMatch(body, /Decision 5/);
  assert.match(body, /Alert 4/);
  assert.doesNotMatch(body, /Alert 5/);
  for (const label of ['View details for recent decisions', 'View details for live alerts']) {
    const button = nodes(tree).find(node => node.props?.['aria-label'] === label);
    assert.ok(button);
    assert.equal(button.props['aria-expanded'], false);
    button.props.onClick();
  }
  assert.deepEqual(changes, [[8, true], [9, true]]);

  body = text(render(snap, { showAllDecisions: true }));
  assert.match(body, /Decision 7/);
  assert.doesNotMatch(body, /Alert 5/);

  tree = render(snap, { showAllDecisions: true, showAllAlerts: true,
    onStateChange: (index, value) => changes.push([index, value]) });
  body = text(tree);
  assert.match(body, /Decision 7/);
  assert.match(body, /Alert 6/);
  for (const label of ['Show fewer recent decisions', 'Show fewer live alerts']) {
    const button = nodes(tree).find(node => node.props?.['aria-label'] === label);
    assert.ok(button);
    assert.equal(button.props['aria-expanded'], true);
    button.props.onClick();
  }
  assert.deepEqual(changes.slice(2), [[8, false], [9, false]]);
});

test('show more is hidden for five or fewer records and the alerts tab remains unbounded', () => {
  const snap = snapshot();
  snap.alerts = Array.from({ length: 5 }, (_, id) => ({
    id, created_at: at(0), level: 'info', message: `Alert ${id}`,
  }));
  snap.decisions = Array.from({ length: 5 }, (_, id) => ({
    id, created_at: at(0), symbol: 'NIFTY', action: 'WAIT', reasoning: `Decision ${id}`,
  }));
  const tree = render(snap);
  assert.equal(nodes(tree).some(node => node.props?.['aria-label'] === 'View details for live alerts'), false);
  assert.equal(nodes(tree).some(node => node.props?.['aria-label'] === 'View details for recent decisions'), false);
  snap.alerts.push({ id: 5, created_at: at(0), level: 'info', message: 'Alert 5' });
  assert.match(text(render(snap, { tab: 'alerts' })), /Alert 5/);
});

test('decisions and alerts use the same time, symbol, action and detail order', () => {
  const snap = snapshot();
  snap.decisions = [{ id: 1, created_at: at(0), symbol: 'NIFTY', action: 'WAIT', reasoning: 'Decision reason' }];
  snap.alerts = [
    { id: 2, created_at: at(0), symbol: 'SENSEX', level: 'info',
      message: 'SENSEX – NO TRADE (Low): Live tick unavailable' },
    { id: 3, created_at: at(0), symbol: null, level: 'error', message: 'KILL SWITCH engaged' },
  ];
  const rows = nodes(render(snap)).filter(node => node.type === 'li').map(node => text(node).replace(/\s+/g, ' '));
  assert.ok(rows.some(row => /11:00:00 NIFTY WAIT Decision reason/.test(row)));
  assert.ok(rows.some(row => /11:00:00 SENSEX NO TRADE \(Low\) Live tick unavailable/.test(row)));
  assert.ok(rows.some(row => /11:00:00 — — KILL SWITCH engaged/.test(row)));
});

test('long decisions and alerts remain fully available in keyboard-scrollable lists', () => {
  const snap = snapshot();
  const detail = 'Live spot tick missing or stale; Completed candles unavailable; Option chain unavailable';
  snap.decisions = [{ id: 1, created_at: at(0), symbol: 'BANKNIFTY', action: 'NO_TRADE', reasoning: detail }];
  snap.alerts = [{ id: 2, created_at: at(0), symbol: 'BANKNIFTY', level: 'info',
    message: `BANKNIFTY – NO TRADE (Low): ${detail}` }];
  const tree = render(snap);
  for (const label of ['Recent AI decisions, scroll horizontally for full details',
    'Recent alerts, scroll horizontally for full details']) {
    const region = nodes(tree).find(node => node.props?.['aria-label'] === label);
    assert.ok(region);
    assert.equal(region.props.tabIndex, 0);
    assert.ok(text(region).includes(detail));
  }
});

test('matching decision and alert actions use the same text styling', () => {
  const snap = snapshot();
  const actions = [
    ['BUY_CE', 'BUY CE'], ['BUY_PE', 'BUY PE'], ['WAIT', 'WAIT'], ['NO_TRADE', 'NO TRADE'],
  ];
  snap.decisions = actions.map(([action], id) => ({
    id, created_at: at(0), symbol: 'NIFTY', action, reasoning: 'Decision',
  }));
  snap.alerts = actions.map(([, label], id) => ({
    id, created_at: at(0), symbol: 'NIFTY', level: 'info',
    message: `NIFTY – ${label} (Low): Alert`,
  }));
  const rows = nodes(render(snap)).filter(node => node.type === 'li');
  for (const [, label] of actions) {
    const matches = rows.filter(row => nodes(row).some(node => node.type === 'span' && text(node) === label));
    assert.equal(matches.length, 2);
    const styles = matches.map(row => nodes(row).find(node => node.type === 'span' && text(node) === label).props.className);
    assert.equal(styles[0], styles[1], `Different styles for ${label}`);
  }
});
