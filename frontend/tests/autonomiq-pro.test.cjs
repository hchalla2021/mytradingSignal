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
    runtime: { engine_enabled: true, auto_paper_trading: false, kill_switch: false,
      live_execution_allowed: false, live_trading_enabled: false },
    session: { phase: 'ACTIVE', reason: '', market_open: true, trading_day: true },
    health: { healthy: true, ai_state: 'ACTIVE', ai_last_error: null, last_cycle_at: null, next_run_at: null,
      cycle_running: false, last_error: null },
    spots: { NIFTY: spot, BANKNIFTY: spot, SENSEX: spot },
    cycle: null, alerts: [], decisions: [], trades: [], open_trades: [], live_trades: [],
    performance: { trades: 0, pnl: 0, wins: 0, win_rate: null, best: 0, worst: 0,
      today: { trades: 0, realized: 0, wins: 0, losses: 0 } },
    live_performance: { trades: 0, pnl: 0, wins: 0, today: { trades: 0, realized: 0, wins: 0, losses: 0 } },
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
    at: at(0), trigger: 'SCHEDULED', ai_state: 'ACTIVE', summary: '',
    market_alert: { tone: 'NEUTRAL', title: '', detail: '' },
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
    window: options.window ?? { confirm: () => false },
    fetch: options.fetch ?? (() => { throw new Error('Unexpected fetch'); }),
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

test('header labels the production-only feature LIVE ORDERS and retains the no-AI refresh', () => {
  for (const marketOpen of [true, false]) {
    const snap = snapshot();
    snap.session.market_open = marketOpen;
    const header = nodes(render(snap)).find(node => node.type === 'header');
    const body = text(header).replace(/\s+/g, ' ');
    assert.match(body, /AUTONOMIQ PRO/);
    assert.match(body, /LIVE ORDERS/);
    assert.match(text(render(snap)), /AI Analysis ON/);
    const warning = nodes(header).find(node => node.props?.role === 'status');
    assert.equal(warning.props['aria-label'], 'Live orders production only');
    assert.match(text(warning), /LIVE ORDERS/);
    assert.match(warning.props.className, /border-emerald-500/);
    assert.doesNotMatch(body, /MARKET (OPEN|CLOSED)/);
    const refresh = nodes(header).find(node => node.type === 'button' && text(node).includes('Refresh now'));
    assert.ok(refresh);
    assert.equal(refresh.props.disabled, false);
    assert.equal(refresh.props['aria-label'], 'Refresh now, no AI');
    assert.match(text(refresh), /Refresh · no AI/);
    assert.match(refresh.props.title, /never uses AI tokens/);
  }
});

test('market alert appears above the AUTONOMIQ tab navigation', () => {
  const tree = render(snapshot());
  const children = tree.props.children.flat(Infinity);
  const alert = children.find(node => node?.props?.['aria-label'] === 'AUTONOMIQ market alert');
  const tabs = children.find(node => node?.type === 'nav' && node.props['aria-label'] === 'AUTONOMIQ PRO tabs');
  assert.ok(alert);
  assert.ok(tabs);
  assert.ok(children.indexOf(alert) < children.indexOf(tabs));
  assert.match(text(alert), /AUTONOMIQ · MARKET ALERT/);
  assert.match(text(alert), /Awaiting analysis/);
});

test('market alert stays on one line and changes color with its direction', () => {
  for (const [tone, borderClass] of [
    ['BULLISH', 'border-emerald-500/40'],
    ['BEARISH', 'border-rose-500/40'],
    ['CAUTION', 'border-amber-500/30'],
  ]) {
    const snap = snapshot();
    snap.cycle = cycle({
      action: 'WAIT', strength: 'Low', timestamp: at(0), source: 'ai+quant',
    });
    snap.cycle.market_alert = { tone, title: 'Trend update', detail: 'Momentum changed across the monitored indices.' };
    const alert = nodes(render(snap)).find(node => node.props?.['aria-label'] === 'AUTONOMIQ market alert');
    assert.ok(alert);
    assert.ok(alert.props.className.includes(borderClass));
    const textRow = nodes(alert).find(node => node.props?.className?.includes('overflow-x-auto'));
    assert.ok(textRow);
    assert.match(textRow.props.className, /whitespace-nowrap/);
    assert.match(textRow.props.className, /touch-pan-x/);
    assert.match(textRow.props.className, /no-scrollbar/);
    const mobileLabel = nodes(alert).find(node => node.props?.className?.includes('sm:hidden'));
    const desktopLabel = nodes(alert).find(node => node.props?.className?.includes('hidden sm:inline'));
    assert.equal(text(mobileLabel), 'ALERT');
    assert.equal(text(desktopLabel), 'AUTONOMIQ · MARKET ALERT');
    assert.match(text(alert), /Trend update — Momentum changed across the monitored indices/);
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
  assert.match(body, /ANALYSIS ONLY · NO LIVE ORDER/);
  assert.match(body, /Entry \(Premium\) ₹100\.00/);
  assert.match(body, /Stop Loss ₹85\.00/);
  assert.match(body, /Trailing SL —/);
  assert.doesNotMatch(body, /₹92\.50/);
  assert.match(body, /Live P&L \(pts \/ %\) —/);
  assert.match(body, /no live order has been placed/i);

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

test('live diagnostics show actual AI request and failed risk checks', () => {
  const snap = snapshot();
  snap.config.min_signal_score = 60;
  snap.health.ai_last_error = 'BAD_OUTPUT';
  snap.ai_usage.recent = [{
    created_at: at(-30), model: 'configured-model', status: 'BAD_OUTPUT', error: 'unparseable',
  }];
  snap.cycle = cycle({
    action: 'WAIT', strength: 'Low', timestamp: at(0), source: 'ai+quant',
    risk: { approved: false, checks: [
      { name: 'Entry window', passed: true, detail: 'Open' },
      { name: 'Risk per trade', passed: false, detail: 'Estimated risk exceeds limit' },
    ] },
  });
  const tree = render(snap);
  const diagnostics = nodes(tree).find(node => node.props?.['aria-label'] === 'AI execution diagnostics');
  assert.match(text(diagnostics), /10:59:30 IST · configured-model · BAD_OUTPUT/);
  assert.match(text(diagnostics).replace(/\s+/g, ' '), /Analysis error: BAD_OUTPUT/);
  const body = card(tree);
  assert.match(body, /entry needs ≥ \+60 CE \/ ≤ -60 PE and AI agreement/);
  assert.match(body, /Risk per trade : Estimated risk exceeds limit/);
  assert.doesNotMatch(body, /Entry window : Open/);
});

test('trailing profit uses the owned stop and terminal entry records are not positions', () => {
  const snap = snapshot();
  snap.runtime.live_execution_allowed = true;
  snap.live_trades = [paperTrade({ quantity: 65, entry_price: 100 })];
  assert.match(card(render(snap)), /Trailing profit \/ loss \(pts \/ %\) 5\.00 \/ 5\.00%/);
  for (const status of ['CLOSED', 'UNFILLED', 'REJECTED']) {
    snap.live_trades[0].status = status;
    const body = card(render(snap));
    assert.doesNotMatch(body, /AUTONOMIQ LIVE/);
    assert.match(body, /No AUTONOMIQ live position is open/);
    assert.match(body, /Entry \(Premium\) —/);
  }
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
    assert.match(body, /PRODUCTION ONLY/);
  }
  assert.match(text(render(snap, { tab: 'trades' })), /Live execution history is available only in the production deployment/);
  assert.match(text(render(snap, { tab: 'performance' })), /Real trading performance is available only from the production executor/);
  assert.match(text(render(snap, { tab: 'alerts' })), /KILL SWITCH engaged — entries blocked/);
  assert.match(text(render(snap, { tab: 'settings' })), /Real orders are hard-disabled in local\/dev/);
});

test('legacy simulated-trading state is never surfaced as an active trading control', () => {
  const snap = snapshot();
  snap.runtime.auto_paper_trading = true;
  const body = text(render(snap));
  assert.doesNotMatch(body, /\bpaper\b/i);
  assert.match(body, /PRODUCTION ONLY/);
});

test('production live trading toggles ON with one confirmation and OFF directly', async () => {
  const localTree = render(snapshot(), { tab: 'settings' });
  const localToggle = nodes(localTree).find(node => node.props?.role === 'switch' && node.props['aria-label'] === 'Live trading');
  assert.ok(localToggle);
  assert.equal(localToggle.props.disabled, true);

  const requests = [];
  const confirmations = [];
  const fetch = async (url, init) => {
    requests.push({ url, init });
    return { ok: true, status: 200, json: async () => snapshot() };
  };
  const production = snapshot();
  production.runtime.live_execution_allowed = true;
  const onTree = render(production, {
    tab: 'settings',
    window: { confirm: message => { confirmations.push(message); return true; } },
    fetch,
  });
  const onToggle = nodes(onTree).find(node => node.props?.role === 'switch' && node.props['aria-label'] === 'Live trading');
  assert.ok(onToggle);
  assert.equal(onToggle.props.disabled, false);
  onToggle.props.onClick();
  await new Promise(resolve => setImmediate(resolve));

  const onRequest = requests.find(request => request.init?.method === 'POST');
  assert.ok(onRequest);
  assert.deepEqual(JSON.parse(onRequest.init.body), {
    live_trading_enabled: true, confirm_live: 'ENABLE_AUTONOMIQ_LIVE_TRADING',
  });
  assert.equal(confirmations.length, 1);
  assert.match(confirmations[0], /REAL Zerodha orders/);

  requests.length = 0;
  const alreadyOn = snapshot();
  alreadyOn.runtime.live_execution_allowed = true;
  alreadyOn.runtime.live_trading_enabled = true;
  const offTree = render(alreadyOn, {
    tab: 'settings',
    window: { confirm: () => assert.fail('Turning OFF should not require confirmation') },
    fetch,
  });
  const offToggle = nodes(offTree).find(node => node.props?.role === 'switch' && node.props['aria-label'] === 'Live trading');
  assert.ok(offToggle);
  offToggle.props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  const offRequest = requests.find(request => request.init?.method === 'POST');
  assert.ok(offRequest);
  assert.deepEqual(JSON.parse(offRequest.init.body), { live_trading_enabled: false });
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
