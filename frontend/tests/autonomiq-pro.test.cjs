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
    config: { enabled: true, deployment_mode: 'local', allow_local_live: false,
      max_data_age_seconds: 10, max_option_quote_age_seconds: 60 },
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
    options.responseDelay ?? 0, options.showAllDecisions ?? false, options.showAllAlerts ?? false,
    options.expandSignalCards ?? false, options.expandSignalCards ?? false, options.expandSignalCards ?? false];
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
    useRef: initial => ({ current: initial }),
    useEffect: effect => options.onEffect?.(effect),
  };
  const context = {
    exports: {},
    Date: class extends Date { static now() { return NOW; } },
    window: options.window ?? { confirm: () => false },
    fetch: options.fetch ?? (() => { throw new Error('Unexpected fetch'); }),
    AbortController,
    setTimeout: options.setTimeout ?? setTimeout,
    clearTimeout: options.clearTimeout ?? clearTimeout,
    setInterval: options.setInterval ?? setInterval,
    clearInterval: options.clearInterval ?? clearInterval,
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

test('header labels config-disabled execution LIVE ORDERS and retains the no-AI refresh', () => {
  for (const marketOpen of [true, false]) {
    const snap = snapshot();
    snap.session.market_open = marketOpen;
    const header = nodes(render(snap)).find(node => node.type === 'header');
    const body = text(header).replace(/\s+/g, ' ');
    assert.match(body, /AUTONOMIQ PRO/);
    assert.match(body, /LIVE ORDERS/);
    assert.match(text(render(snap)), /AI Analysis ON/);
    const warning = nodes(header).find(node => node.props?.role === 'status');
    assert.equal(warning.props['aria-label'], 'Live orders disabled by configuration');
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

test('green quant score shows missing AI and retains the scheduled WAIT after manual refresh', () => {
  const snap = snapshot();
  snap.health.next_run_at = at(300);
  snap.cycle = cycle({
    action: 'WAIT', quant_action: 'BUY_CE', ai_action: null, source: 'quant',
    strength: 'High', timestamp: at(0), reasoning: 'Awaiting AI confirmation',
  });
  snap.cycle.trigger = 'MANUAL';
  snap.cycle.ai_state = 'SKIPPED_MANUAL_QUANT_ONLY';
  snap.last_scheduled = { at: at(-120), ai_state: 'ACTIVE', signals: {
    NIFTY: { action: 'WAIT', reasoning: 'Extended; await a pullback', timestamp: at(-120),
      execution: { status: 'NOT_REQUESTED', detail: '' } },
  } };
  for (const tab of ['live', 'analysis']) {
    const tree = render(snap, { tab });
    const gates = nodes(tree).find(node => node.props?.['aria-label'] === 'NIFTY entry gates');
    assert.ok(gates);
    const body = text(gates).replace(/\s+/g, ' ');
    assert.match(body, /Quant PASSED · BUY CE/);
    assert.match(body, /AI NOT REQUESTED/);
    assert.match(body, /Risk NOT REACHED/);
    assert.match(body, /Broker NOT REQUESTED/);
    assert.match(body, /Refresh now does not request AI/);
    assert.match(body, /Next scheduled AI: 11:05:00 IST/);
    assert.match(body, /Last scheduled result · 10:58:00 IST: WAIT/);
    assert.match(body, /Extended; await a pullback/);
    assert.match(body, /Historical result only; not approval/);
    if (tab === 'live') assert.match(card(tree), /WAIT · AWAITING AI/);
  }
});

test('quant veto and AI agreement cannot advertise that risk or broker submission passed', () => {
  const snap = snapshot();
  snap.cycle = cycle({
    action: 'BUY_CE', quant_action: 'BUY_CE', ai_action: 'BUY_CE', source: 'ai+quant',
    strength: 'High', timestamp: at(0), reasoning: 'Aligned',
    risk: { approved: false, checks: [{ name: 'Risk per trade', passed: false, detail: 'Too large' }] },
    execution: { status: 'BLOCKED', detail: 'Too large' },
  });
  const gates = () => {
    const tree = render(snap, { tab: 'analysis' });
    return text(nodes(tree).find(node => node.props?.['aria-label'] === 'NIFTY entry gates')).replace(/\s+/g, ' ');
  };
  assert.match(gates(), /AI BUY CE · AGREES/);
  assert.match(gates(), /Risk BLOCKED/);
  assert.match(gates(), /Broker BLOCKED/);
  snap.cycle.indices.NIFTY.signal.quant_action = 'WAIT';
  const vetoed = gates();
  assert.match(vetoed, /Quant WAIT/);
  assert.match(vetoed, /AI BUY CE · DOES NOT AGREE/);
  assert.doesNotMatch(vetoed, /PASSED/);
});

test('historical scheduled BUY is never reused as a manual refresh entry plan', () => {
  const snap = snapshot();
  snap.cycle = cycle({
    action: 'WAIT', quant_action: 'BUY_CE', ai_action: null, source: 'quant',
    strength: 'High', timestamp: at(0), reasoning: 'Awaiting AI confirmation',
  });
  snap.cycle.trigger = 'MANUAL';
  snap.last_scheduled = { at: at(-120), ai_state: 'ACTIVE', signals: {
    NIFTY: { action: 'BUY_CE', reasoning: 'Prior candidate', timestamp: at(-120),
      plan: { entry: 100, stop_loss: 90 }, execution: { status: 'BLOCKED', detail: 'Prior risk rejection' } },
  } };
  const body = card(render(snap));
  assert.match(body, /WAIT · AWAITING AI/);
  assert.match(body, /Last scheduled result .* BUY CE · BLOCKED/);
  assert.match(body, /Entry \(Premium\) —/);
  assert.match(body, /Stop Loss —/);
  assert.doesNotMatch(body, /LIVE ENTRY|₹100\.00|₹90\.00/);
});

test('missing option data is not presented as only waiting for an AI confirmation', () => {
  const snap = snapshot();
  snap.cycle = cycle({
    action: 'NO_TRADE', quant_action: 'BUY_CE', ai_action: null, source: 'validation',
    strength: 'Low', timestamp: at(0), reasoning: 'Option chain unavailable',
  });
  const body = card(render(snap));
  assert.match(body, /DATA UNAVAILABLE/);
  assert.match(body, /Quant DATA UNAVAILABLE/);
  assert.match(body, /Option chain unavailable/);
  assert.doesNotMatch(body, /No new AI confirmation|WAIT · AWAITING AI/);
});

test('market alert retains its direction and full text in the responsive wrapping layout', () => {
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
    const textRow = nodes(alert).find(node => node.props?.className === 'autonomiq-market-alert-copy');
    assert.ok(textRow);
    assert.doesNotMatch(textRow.props.className, /whitespace-nowrap|truncate|line-clamp/);
    const mobileLabel = nodes(alert).find(node => node.props?.className?.includes('sm:hidden'));
    const desktopLabel = nodes(alert).find(node => node.props?.className?.includes('hidden sm:inline'));
    assert.equal(text(mobileLabel), 'ALERT');
    assert.equal(text(desktopLabel), 'AUTONOMIQ · MARKET ALERT');
    assert.match(text(alert), /Trend update — Momentum changed across the monitored indices/);
  }
});

test('redesigned navigation retains all six views and only changes the selected tab', () => {
  const changes = [];
  const tree = render(snapshot(), { onStateChange: (index, value) => changes.push([index, value]) });
  const nav = nodes(tree).find(node => node.type === 'nav');
  const buttons = nodes(nav).filter(node => node.type === 'button');
  assert.deepEqual(buttons.map(button => text(button).trim()), [
    'Live Trading', 'Analysis', 'Alerts', 'Trades', 'Performance', 'Settings',
  ]);
  assert.equal(buttons[0].props['aria-pressed'], true);
  assert.ok(buttons.slice(1).every(button => button.props['aria-pressed'] === false));
  buttons[1].props.onClick();
  assert.deepEqual(changes, [[2, 'analysis']]);
  const selected = nodes(render(snapshot(), { tab: 'analysis' })).find(node =>
    node.type === 'button' && text(node).trim() === 'Analysis');
  assert.equal(selected.props['aria-pressed'], true);
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
    assert.match(body, /Entry approval/);
    assert.ok(body.indexOf('Trailing profit / loss') < body.indexOf('Entry approval'));
    assert.doesNotMatch(body, /₹\d/);
  }
});

test('a fresh unfilled proposal stays WAIT without live prices and expires with its quote', () => {
  const snap = snapshot();
  const plan = {
    tradingsymbol: 'NIFTYTESTCE', entry: 100, stop_loss: 85, trailing_sl: 92.5,
    target1: 115, target2: 130, quote: { trade_age_s: 5 }, lot_size: 65, lots: 1,
  };
  snap.cycle = cycle({
    action: 'BUY_CE', strength: 'High', timestamp: at(0), plan,
    risk: { approved: true, checks: [] }, reasoning: 'Confirmed', source: 'ai+quant',
  });
  const tree = render(snap);
  const status = nodes(tree).find(node => node.props?.['aria-label'] === 'NIFTY trade status');
  assert.equal(text(status).trim(), 'WAIT');
  let body = card(tree);
  assert.match(body, /ANALYSIS ONLY · NO LIVE ORDER/);
  assert.match(body, /Entry \(Premium\) —/);
  assert.match(body, /Stop Loss —/);
  assert.match(body, /Target \(T1 \/ T2\) — \/ —/);
  assert.match(body, /Trailing SL —/);
  assert.doesNotMatch(body, /₹92\.50/);
  assert.match(body, /Live P&L \(pts \/ %\) —/);
  assert.match(body, /No broker-confirmed fill/);

  for (const status of ['OFF', 'LIVE_DISABLED']) {
    snap.cycle.indices.NIFTY.signal.execution = { status, detail: 'Analysis only; live entry disabled' };
    body = card(render(snap));
    assert.match(body, /ANALYSIS ONLY · NO LIVE ORDER/);
    assert.match(body, /Entry \(Premium\) —/);
  }
  delete snap.cycle.indices.NIFTY.signal.execution;

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

test('a risk-blocked BUY candidate is WAIT and history includes its execution blocker', () => {
  const snap = snapshot();
  snap.runtime.live_execution_allowed = snap.runtime.live_trading_enabled = true;
  const execution = { status: 'BLOCKED', detail: 'Risk per trade: 1282 > 1000' };
  snap.cycle = cycle({
    action: 'BUY_CE', timestamp: at(0), source: 'ai+quant', reasoning: 'Aligned trend',
    plan: { tradingsymbol: 'NIFTYTESTCE', entry: 100, quote: { trade_age_s: 1 } },
    risk: { approved: false, checks: [{ name: 'Risk per trade', passed: false, detail: '1282 > 1000' }] },
    execution,
  });
  snap.decisions = [{ id: 1, created_at: at(0), symbol: 'NIFTY', action: 'BUY_CE',
    reasoning: 'Aligned trend', approved: 0, execution }];
  const tree = render(snap);
  const body = card(tree);
  assert.match(body, /WAIT/);
  assert.match(body, /ENTRY NOT CONFIRMED/);
  assert.match(body, /Risk per trade: 1282 > 1000/);
  assert.doesNotMatch(body, /LIVE ENTRY|Entry \(Premium\) ₹100/);
  assert.match(text(tree), /BUY CE · BLOCKED/);
});

test('broker precheck and uncertain entry errors remain visible without advertising a BUY', () => {
  for (const status of ['BROKER_ERROR', 'REJECTED', 'ENTRY_UNKNOWN']) {
    const snap = snapshot();
    snap.runtime.live_execution_allowed = snap.runtime.live_trading_enabled = true;
    snap.cycle = cycle({
      action: 'BUY_CE', timestamp: at(0), source: 'ai+quant',
      risk: { approved: true, checks: [] },
      plan: { entry: 100, quote: { trade_age_s: 1 } },
      execution: { status, detail: 'Zerodha: order not permitted from this IP' },
    });
    const body = card(render(snap));
    assert.match(body, /WAIT/);
    assert.match(body, /not permitted from this IP/);
    assert.doesNotMatch(body, /LIVE ENTRY|BUY CE/);
  }
});

test('rejected broker order reasons survive in the Trades tab', () => {
  const snap = snapshot();
  snap.runtime.live_execution_allowed = true;
  snap.live_trades = [paperTrade({ status: 'REJECTED', quantity: 65, error: 'Order not permitted from this IP' })];
  const body = text(render(snap, { tab: 'trades' }));
  assert.match(body, /REJECTED/);
  assert.match(body, /Order not permitted from this IP/);
});

test('empty Trades tab explains recorded WAIT decisions instead of implying a broker failure', () => {
  const snap = snapshot();
  snap.runtime.live_execution_allowed = snap.runtime.live_trading_enabled = true;
  snap.health.next_run_at = at(300);
  snap.cycle = cycle({
    action: 'WAIT', timestamp: at(0), source: 'quant', reasoning: 'Awaiting AI confirmation',
    execution: { status: 'NOT_REQUESTED', detail: '' },
  });
  snap.cycle.trigger = 'MANUAL';
  const tree = render(snap, { tab: 'trades' });
  const decisions = nodes(tree).find(node => node.props?.['aria-label'] === 'Latest order entry decisions');
  assert.ok(decisions);
  for (const symbol of ['NIFTY', 'BANKNIFTY', 'SENSEX']) assert.match(text(decisions), new RegExp(symbol));
  assert.match(text(decisions), /WAIT/);
  assert.match(text(decisions), /NOT REQUESTED/);
  assert.match(text(decisions), /Awaiting AI confirmation/);
  const body = text(tree).replace(/\s+/g, ' ');
  assert.match(body, /Manual refresh is quant-only/);
  assert.match(body, /Next scheduled analysis: 11:05:00 IST/);
  assert.match(body, /Live Trading ON alone does not submit an order/);
});

test('empty Trades tab includes failed risk checks for a BUY candidate', () => {
  const snap = snapshot();
  snap.runtime.live_execution_allowed = true;
  snap.cycle = cycle({
    action: 'BUY_CE', timestamp: at(0), source: 'ai+quant', reasoning: 'Aligned trend',
    risk: { approved: false, checks: [{ name: 'Risk per trade', passed: false, detail: '1282 > 1000' }] },
    execution: { status: 'BLOCKED', detail: '' },
  });
  const tree = render(snap, { tab: 'trades' });
  const decisions = nodes(tree).find(node => node.props?.['aria-label'] === 'Latest order entry decisions');
  assert.match(text(decisions), /BUY CE/);
  assert.match(text(decisions), /BLOCKED/);
  assert.match(text(decisions), /Risk per trade: 1282 > 1000/);
});

test('budget-blocked analysis cannot show ON merely because the AI client is ACTIVE', () => {
  const snap = snapshot();
  snap.config.daily_budget_usd = 1.25;
  snap.config.monthly_budget_usd = 25;
  snap.ai_usage.today.cost_usd = 1.2226;
  snap.ai_usage.month.cost_usd = 1.2226;
  snap.cycle = cycle({ action: 'WAIT', strength: 'Low', timestamp: at(0), source: 'quant' });
  snap.cycle.ai_state = 'DAILY_BUDGET_INSUFFICIENT';
  const tree = render(snap);
  const body = text(tree).replace(/\s+/g, ' ');
  assert.match(body, /AI Engine ACTIVE/);
  assert.match(body, /AI Analysis DAILY BUDGET INSUFFICIENT/);
  assert.doesNotMatch(body, /AI Analysis ON/);
  const blocker = nodes(tree).find(node => node.props?.['aria-label'] === 'AI analysis blocker');
  assert.ok(blocker);
  assert.match(text(blocker), /quant-only results, no new AI confirmation/);
  assert.match(text(blocker), /\$1\.2226 \/ \$1\.25 daily/);
  assert.match(text(blocker), /estimated next request/);
});

test('rule details explain how opposing live factors produce a zero net score', () => {
  const snap = snapshot();
  snap.cycle = cycle({ action: 'WAIT', strength: 'Low', timestamp: at(0), source: 'quant' });
  snap.cycle.indices.NIFTY.quant.factors = [
    { points: 15, factor: '15m trend up' }, { points: -15, factor: '5m bearish factors' },
  ];
  const body = card(render(snap, { expandSignalCards: true }));
  assert.match(body, /\+15 15m trend up/);
  assert.match(body, /-15 5m bearish factors/);
});

test('analysis shows snapshot times and updates measurements without changing rule weights', () => {
  const snap = snapshot();
  snap.cycle = cycle({ action: 'WAIT', strength: 'Low', timestamp: at(0), source: 'quant' });
  snap.health.next_run_at = at(300);
  const index = snap.cycle.indices.NIFTY;
  index.futures = { vwap: 25287.97, order_imbalance: 0.181 };
  index.quant.factors = [{ points: 15, factor: '60m trend up' }];
  let tree = render(snap, { tab: 'analysis' });
  let rules = nodes(tree).find(node => node.props?.['aria-label'] === 'NIFTY analysis rules');
  assert.match(text(rules), /25,287\.97/);
  assert.match(text(rules), /Last computed: 11:00:00 IST/);
  assert.match(text(rules), /60m trend up \+ 15/);
  const cadence = nodes(tree).find(node => node.props?.['aria-label'] === 'Analysis refresh cadence');
  assert.match(text(cadence), /every 5 minutes, not on every tick/);
  assert.match(text(cadence), /Next cycle: 11:05:00 IST/);

  index.futures.vwap = 25290.25;
  index.signal.timestamp = at(300);
  tree = render(snap, { tab: 'analysis' });
  rules = nodes(tree).find(node => node.props?.['aria-label'] === 'NIFTY analysis rules');
  assert.match(text(rules), /25,290\.25/);
  assert.doesNotMatch(text(rules), /25,287\.97/);
  assert.match(text(rules), /Last computed: 11:05:00 IST/);
  assert.match(text(rules), /60m trend up \+ 15/);
});

test('trailing profit uses the owned stop and terminal entry records are not positions', () => {
  const snap = snapshot();
  snap.runtime.live_execution_allowed = true;
  snap.live_trades = [paperTrade({ quantity: 65, entry_filled: 65, exit_filled: 0, entry_price: 100 })];
  assert.match(card(render(snap)), /Trailing profit \/ loss \(pts \/ %\) 5\.00 \/ 5\.00%/);
  for (const status of ['CLOSED', 'UNFILLED', 'REJECTED']) {
    snap.live_trades[0].status = status;
    const body = card(render(snap));
    assert.doesNotMatch(body, /AUTONOMIQ LIVE/);
    assert.match(body, /No AUTONOMIQ live position is open/);
    assert.match(body, /Entry \(Premium\) —/);
  }
});

test('missing analysis data shows unavailable strength, not a low-confidence trading signal', () => {
  const snap = snapshot();
  snap.cycle = cycle({
    action: 'NO_TRADE', strength: 'Low', conviction: 0, timestamp: at(0), source: 'validation',
    reasoning: 'Live spot tick missing or stale; Completed candles unavailable; Option chain unavailable',
  });
  const body = card(render(snap));
  assert.match(body, /DATA UNAVAILABLE/);
  assert.match(body, /Signal strength Unavailable/);
  assert.doesNotMatch(body, /Signal strength Low/);
  assert.match(body, /Entry \(Premium\) —/);
  assert.match(body, /Stop Loss —/);
  assert.match(body, /Trailing SL —/);
});

test('all six real-fill fields are wired independently for every index even without analysis', () => {
  const snap = snapshot();
  snap.cycle = cycle({
    action: 'NO_TRADE', strength: 'Low', timestamp: at(0), source: 'validation', reasoning: 'Candles unavailable',
  });
  const cases = [
    { symbol: 'NIFTY', entry: 100, quantity: 65, pnlPct: '12.00', trailPct: '5.00', gross: '780.00' },
    { symbol: 'BANKNIFTY', entry: 200, quantity: 30, pnlPct: '6.00', trailPct: '2.50', gross: '360.00' },
    { symbol: 'SENSEX', entry: 300, quantity: 20, pnlPct: '4.00', trailPct: '1.67', gross: '240.00' },
  ];
  snap.live_trades = cases.map(({ symbol, entry, quantity }, index) => paperTrade({
    id: index + 1, symbol, tradingsymbol: `${symbol}TESTCE`, quantity,
    entry_filled: quantity, exit_filled: 0, option_type: 'CE',
    entry: entry + 2, entry_price: entry, last_price: entry + 12,
    stop_loss: entry - 15, trailing_sl: entry + 5, target1: entry + 15, target2: entry + 30,
  }));
  const tree = render(snap);
  for (const { symbol, entry, pnlPct, trailPct, gross } of cases) {
    const body = card(tree, symbol);
    assert.match(body, /OPEN CE/);
    assert.doesNotMatch(body, /NO TRADE/);
    for (const expected of [
      `Entry (Premium) ₹${entry.toFixed(2)}`,
      `Stop Loss ₹${(entry - 15).toFixed(2)}`,
      `Trailing SL ₹${(entry + 5).toFixed(2)}`,
      `Target (T1 / T2) ₹${(entry + 15).toFixed(2)} / ₹${(entry + 30).toFixed(2)}`,
      `Live P&L (pts / %) 12.00 / ${pnlPct}% · ₹${gross}`,
      `Trailing profit / loss (pts / %) 5.00 / ${trailPct}%`,
    ]) {
      assert.ok(body.includes(expected), `${symbol} missing ${expected}`);
    }
  }
});

test('unfilled and uncertain intents never advertise live prices or P&L', () => {
  for (const status of ['ENTRY_PENDING', 'ENTRY_UNKNOWN', 'ENTRY_SUBMITTING']) {
    for (const entryFilled of [0, undefined]) {
      const snap = snapshot();
      snap.live_trades = [paperTrade({ status, entry_filled: entryFilled, exit_filled: 0,
        quantity: 65, entry_price: 100, last_price: 112 })];
      const body = card(render(snap));
      assert.match(body, /AUTONOMIQ ORDER/);
      assert.match(body, /Entry \(Premium\) —/);
      assert.match(body, /Stop Loss —/);
      assert.match(body, /Trailing SL —/);
      assert.match(body, /Target \(T1 \/ T2\) — \/ —/);
      assert.match(body, /Live P&L \(pts \/ %\) —/);
      assert.match(body, /Trailing profit \/ loss \(pts \/ %\) —/);
      assert.match(body, /protection starts after a confirmed fill/i);
      assert.doesNotMatch(body, /₹100\.00|₹115\.00|₹130\.00|AUTONOMIQ LIVE/);
      assert.match(body, status === 'ENTRY_PENDING' ? /Broker entry order acknowledged/
        : /Local execution intent recorded; no broker order or fill confirmed/);
    }
  }
});

test('streamed option bids and aggregate P&L change without changing fill or broker stop', () => {
  const snap = snapshot();
  snap.runtime.live_execution_allowed = true;
  snap.live_trades = [paperTrade({
    entry_price: 100, entry_filled: 65, exit_filled: 15, last_price: 112, pnl: 480,
    last_broker_sync: at(-3),
  })];
  let tree = render(snap);
  assert.match(card(tree), /Live option bid: ₹112\.00/);
  assert.match(card(tree), /Last broker state: OPEN · protective stop acknowledged/);
  assert.match(card(tree), /New-entry checks · separate from your open broker position/);
  assert.match(text(tree), /Live P&L · gross ₹600\.00/);
  snap.live_trades[0].last_price = 113;
  snap.live_trades[0].last_quote_at = at(-1);
  tree = render(snap);
  assert.match(card(tree), /Live option bid: ₹113\.00/);
  assert.match(card(tree), /Entry \(Premium\) ₹100\.00/);
  assert.match(card(tree), /Trailing SL ₹105\.00/);
  assert.match(text(tree), /Live P&L · gross ₹650\.00/);
  snap.live_trades[0].last_quote_at = at(-6);
  tree = render(snap);
  assert.match(card(tree), /Live option bid: —/);
  assert.match(text(tree), /Live P&L · gross —/);
  assert.match(card(tree), /estimated net P&L —/);
  snap.live_trades[0].last_quote_at = at(0);
  snap.live_trades[0].status = 'RECONCILIATION_REQUIRED';
  tree = render(snap);
  assert.match(card(tree), /Live option bid: —/);
  assert.match(text(tree), /Live P&L · gross —/);
});

test('closed trade history shows the actual exit fill, not a later option mark', () => {
  const snap = snapshot();
  snap.runtime.live_execution_allowed = true;
  snap.live_trades = [paperTrade({
    status: 'CLOSED', entry_price: 100, entry_filled: 65, exit_filled: 65,
    exit_price: 89.90, last_price: 112, pnl: -806.5,
  })];
  const body = text(render(snap, { tab: 'trades' }));
  assert.match(body, /₹89\.90/);
  assert.doesNotMatch(body, /₹112\.00/);
});

test('live cards omit closed-trade summaries and never keep marking old holdings', () => {
  const snap = snapshot();
  snap.runtime.live_execution_allowed = true;
  snap.cycle = cycle({
    action: 'HOLD', source: 'risk-management', strength: 'Low', timestamp: at(-60),
    reasoning: 'Existing AUTONOMIQ position remains under broker-stop and Python risk management.',
  });
  snap.live_trades = [paperTrade({
    status: 'CLOSED', entry_price: 100, entry_filled: 65, exit_filled: 65, exit_price: 89.9,
    closed_at: at(-10), exit_reason: 'STOP_LOSS', pnl: -806.5, last_price: 112,
  })];
  for (const laterBid of [112, 145]) {
    snap.live_trades[0].last_price = laterBid;
    const tree = render(snap);
    const body = card(tree);
    assert.doesNotMatch(text(tree), /LAST TRADE CLOSED|Filled entry|Realized gross|Closure reconciled/);
    assert.match(body, /Live P&L \(pts \/ %\) —/);
    assert.doesNotMatch(body, /Live option bid:/);
    assert.doesNotMatch(body, /Existing AUTONOMIQ position remains under/);
    assert.match(text(tree), /Live P&L · gross —/);
    assert.match(text(tree), /Recorded analysis, not current holdings/);
  }
  snap.live_trades.unshift(paperTrade({
    id: 2, entry_price: 110, entry_filled: 65, exit_filled: 0, last_quote_at: at(0),
  }));
  assert.doesNotMatch(card(render(snap)), /LAST TRADE CLOSED/);
  assert.match(card(render(snap)), /Live option bid: ₹112\.00/);
});

test('redesigned card details preserve their toggle and expose the controlled panel', () => {
  const snap = snapshot();
  snap.cycle = cycle({
    action: 'WAIT', source: 'quant', strength: 'Low', timestamp: at(0), reasoning: 'No valid entry.',
  });
  const changes = [];
  let tree = render(snap, { onStateChange: (index, value) => changes.push([index, value]) });
  const button = nodes(tree).find(node => node.type === 'button' && text(node).includes('View Details'));
  assert.equal(button.props['aria-expanded'], false);
  button.props.onClick();
  assert.equal(changes.length, 1);
  assert.equal(changes[0][1](false), true);
  tree = render(snap, { expandSignalCards: true });
  const expandedNodes = nodes(tree);
  for (const sym of ['NIFTY', 'BANKNIFTY', 'SENSEX']) {
    const root = expandedNodes.find(node => node.props?.['aria-label'] === `${sym} trade card`);
    const expanded = nodes(root).find(node => node.type === 'button' && text(node).includes('View Details'));
    assert.equal(expanded.props['aria-expanded'], true);
    assert.ok(nodes(root).some(node => node.props?.id === expanded.props['aria-controls']));
  }
});

test('one-second polling does not overlap and aborts in-flight work on cleanup', async () => {
  const effects = [], timers = [], pending = [], requests = [], changes = [];
  render(snapshot(), {
    onEffect: effect => effects.push(effect),
    setInterval: (callback, delay) => { timers.push({ callback, delay }); return 91; },
    clearInterval: id => assert.equal(id, 91),
    onStateChange: (index, value) => changes.push([index, value]),
    fetch: (_url, init) => new Promise((resolve, reject) => {
      requests.push(init);
      pending.push(resolve);
      init.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    }),
  });
  const cleanup = effects[0]();
  assert.equal(timers[0].delay, 1000);
  timers[0].callback();
  assert.equal(requests.length, 1);
  pending[0]({ ok: true, json: async () => snapshot() });
  await new Promise(setImmediate);
  assert.ok(changes.some(([index, value]) => index === 0 && value.generated_at === at(0)));
  timers[0].callback();
  assert.equal(requests.length, 2);
  cleanup();
  await new Promise(setImmediate);
  assert.equal(requests[1].signal.aborted, true);
  assert.equal(changes.filter(([index, value]) => index === 1 && value != null).length, 0);
});

test('a timed-out snapshot reports the error and releases the next poll', async () => {
  const effects = [], timers = [], timeouts = [], errors = [];
  let requests = 0;
  render(snapshot(), {
    onEffect: effect => effects.push(effect),
    setInterval: callback => { timers.push(callback); return 1; },
    clearInterval: () => {},
    setTimeout: callback => { timeouts.push(callback); return timeouts.length; },
    clearTimeout: () => {},
    onStateChange: (index, value) => { if (index === 1 && value) errors.push(value); },
    fetch: (_url, init) => new Promise((_resolve, reject) => {
      requests++;
      init.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    }),
  });
  const cleanup = effects[0]();
  timeouts[0]();
  await new Promise(setImmediate);
  assert.deepEqual(errors, ['Live snapshot request timed out; retrying']);
  timers[0]();
  assert.equal(requests, 2);
  cleanup();
  await new Promise(setImmediate);
});

test('stale owned-position quote hides live P&L but retains the broker stop prices', () => {
  for (const [configuredAge, quoteAge] of [[60, 6], [60, 61], [3, 4]]) {
    const snap = snapshot();
    snap.config.max_option_quote_age_seconds = configuredAge;
    snap.live_trades = [paperTrade({ entry_filled: 65, exit_filled: 0, quantity: 65,
      option_type: 'CE', entry_price: 100, last_quote_at: at(-quoteAge) })];
    const body = card(render(snap));
    assert.match(body, /OPEN CE/);
    assert.match(body, /Stop Loss ₹85\.00/);
    assert.match(body, /Trailing SL ₹105\.00/);
    assert.match(body, /Live P&L \(pts \/ %\) —/);
    assert.match(body, /quote stale or unavailable/i);
    assert.doesNotMatch(body, /₹780\.00/);
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
    assert.match(body, /Live Trade DISABLED/);
  }
  assert.match(text(render(snap, { tab: 'trades' })), /Live execution history is unavailable while execution is disabled/);
  assert.match(text(render(snap, { tab: 'performance' })), /Real trading performance is unavailable while execution is disabled/);
  assert.match(text(render(snap, { tab: 'alerts' })), /KILL SWITCH engaged — entries blocked/);
  assert.match(text(render(snap, { tab: 'settings' })), /Local live orders require AUTONOMIQ_PRO_ALLOW_LOCAL_LIVE=true/);
});

test('legacy simulated-trading state is never surfaced as an active trading control', () => {
  const snap = snapshot();
  snap.runtime.auto_paper_trading = true;
  const body = text(render(snap));
  assert.doesNotMatch(body, /\bpaper\b/i);
  assert.match(body, /Live Trade DISABLED/);
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
  production.config.deployment_mode = 'production';
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
  alreadyOn.config.deployment_mode = 'production';
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

test('opted-in local live controls warn about real orders and require confirmation', async () => {
  const snap = snapshot();
  snap.config.allow_local_live = true;
  snap.runtime.live_execution_allowed = true;
  for (const confirmed of [false, true]) {
    const requests = [];
    const confirmations = [];
    const tree = render(snap, {
      tab: 'settings',
      window: { confirm: message => { confirmations.push(message); return confirmed; } },
      fetch: async (url, init) => {
        requests.push({ url, init });
        return { ok: true, status: 200, json: async () => snap };
      },
    });
    const body = text(tree).replace(/\s+/g, ' ');
    assert.match(body, /Local live execution is configured/);
    assert.match(body, /Disable production entries first/);
    assert.match(body, /Live Trade OFF/);
    assert.doesNotMatch(body, /PRODUCTION ONLY|never places real orders|hard-disabled/);
    const toggle = nodes(tree).find(node => node.props?.role === 'switch' && node.props['aria-label'] === 'Live trading');
    assert.equal(toggle.props.disabled, false);
    toggle.props.onClick();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(confirmations.length, 1);
    assert.match(confirmations[0], /REAL Zerodha orders for AUTONOMIQ PRO in local/);
    assert.match(confirmations[0], /only one live executor/);
    const posts = requests.filter(request => request.init?.method === 'POST');
    assert.equal(posts.length, confirmed ? 1 : 0);
    if (confirmed) {
      assert.deepEqual(JSON.parse(posts[0].init.body), {
        live_trading_enabled: true, confirm_live: 'ENABLE_AUTONOMIQ_LIVE_TRADING',
      });
    }
  }
  assert.match(text(render(snap, { tab: 'trades' })), /No AUTONOMIQ live orders have been recorded/);
  assert.match(text(render(snap, { tab: 'performance' })), /Closed live trades/);
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

test('analysis overview is collapsed by default and retains its full metrics behind a native disclosure', () => {
  const snap = snapshot();
  snap.cycle = cycle({
    action: 'WAIT', source: 'quant', strength: 'Low', timestamp: at(0), reasoning: 'No valid entry.',
  });
  snap.cycle.summary = 'Recorded market analysis';
  const tree = render(snap);
  const overview = nodes(tree).find(node => node.type === 'details');
  assert.ok(overview);
  assert.notEqual(overview.props.open, true);
  const summary = nodes(overview).find(node => node.type === 'summary');
  assert.match(text(summary), /Analysis overview & AI metrics/);
  assert.match(text(overview), /Recorded market analysis/);
  for (const label of ['Model', 'Latest AI cycle', 'Next AI slot', 'AI cost today', 'Live P&L · gross']) {
    assert.ok(text(overview).includes(label));
  }
  const recent = nodes(tree).find(node => node.props?.['aria-label'] === 'Recent AI decisions');
  assert.ok(recent);
  assert.equal(nodes(overview).some(node => node.props?.['aria-label'] === 'Recent AI decisions'), false);
});

test('long decisions, alerts and analysis remain complete in wrapping keyboard-accessible panels', () => {
  const snap = snapshot();
  const detail = 'Live spot tick missing or stale; Completed candles unavailable; Option chain unavailable';
  snap.cycle = cycle({
    action: 'WAIT', source: 'quant', strength: 'Low', timestamp: at(0), reasoning: 'No valid entry.',
  });
  snap.cycle.summary = detail.repeat(4);
  snap.decisions = [{ id: 1, created_at: at(0), symbol: 'BANKNIFTY', action: 'NO_TRADE', reasoning: detail }];
  snap.alerts = [{ id: 2, created_at: at(0), symbol: 'BANKNIFTY', level: 'info',
    message: `BANKNIFTY – NO TRADE (Low): ${detail}` }];
  const tree = render(snap);
  for (const label of ['Recent AI decisions', 'Recent alerts']) {
    const region = nodes(tree).find(node => node.props?.['aria-label'] === label);
    assert.ok(region);
    assert.equal(region.props.tabIndex, 0);
    assert.ok(text(region).includes(detail));
    const list = nodes(region).find(node => node.type === 'ul');
    assert.doesNotMatch(list.props.className, /w-max|whitespace-nowrap|truncate/);
    const row = nodes(region).find(node => node.type === 'li');
    assert.equal(nodes(row).filter(node => node.type === 'span').length, 4);
  }
  const summary = nodes(tree).find(node => node.props?.['aria-label'] === 'Market analysis summary');
  assert.equal(text(summary), snap.cycle.summary);
  assert.doesNotMatch(summary.props.className, /whitespace-nowrap|truncate|line-clamp/);
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
