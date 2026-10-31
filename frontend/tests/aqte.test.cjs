const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness(filename = 'AQTESection.tsx') {
  const states = [];
  const timers = new Map();
  const requests = [];
  let effect, cursor, timer = 0, response;
  const react = {
    memo: component => component,
    useState: initial => {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = value; }];
    },
    useEffect: fn => { effect = fn; },
    useRef: initial => {
      const index = cursor++;
      if (!(index in states)) states[index] = { current: initial };
      return states[index];
    },
  };
  const source = readFileSync(path.join(__dirname, '..', 'components', filename), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const context = {
    exports: {}, AbortController,
    setTimeout: (fn, delay) => { timers.set(++timer, { fn, delay }); return timer; },
    clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (response instanceof Error) throw response;
      return { ok: true, json: async () => response };
    },
    require: id => {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime') return require(id);
      if (id === '@/lib/api-config') return { API_CONFIG: { endpoint: p => p } };
      if (id === '@/components/AQTELivePanel') return { default: () => null };
      if (id === '@/components/AQTEAutomationSwitch') return { default: () => null };
      if (id === '@/components/AQTEDailyControl') return { default: () => null };
      if (id === 'next/dynamic') return { default: () => () => null };
      if (id === '@/lib/aqte-display') {
        const code = ts.transpileModule(readFileSync(path.join(__dirname, '..', 'lib', 'aqte-display.ts'), 'utf8'),
          { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
        const exports = {};
        vm.runInNewContext(code, { exports, Intl });
        return exports;
      }
      if (id === '@/components/AQTETerminal') {
        const component = harness('AQTETerminal.tsx');
        return { default: props => component.render(props) };
      }
      if (id === '@/components/AQTEBrokerPositions') {
        const component = harness('AQTEBrokerPositions.tsx');
        return { default: props => component.render(props) };
      }
      if (id === '@/components/AQTEPosition') {
        const component = harness('AQTEPosition.tsx');
        return { default: props => component.render(props) };
      }
      if (id === '@/lib/visitor-id') return { getOrCreateVisitorId: () => 'test-device' };
      throw new Error(`Unexpected dependency ${id}`);
    },
  };
  vm.runInNewContext(compiled, context);
  return {
    render(props = {}) { cursor = 0; return context.exports.default(props); },
    mount(value) { response = value; return effect(); },
    respond(value) { response = value; },
    async poll(value) {
      response = value;
      const pending = [...timers.entries()].find(([, value]) => value.delay === 2000);
      assert.ok(pending, 'Polling retry should be scheduled after completion');
      timers.delete(pending[0]);
      await pending[1].fn();
    },
    timers, requests,
  };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (typeof tree.type === 'function') return [tree, ...nodes(tree.type(tree.props))];
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
}
function text(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (!tree || typeof tree !== 'object') return '';
  if (typeof tree.type === 'function') return text(tree.type(tree.props));
  return [tree.props?.children].flat(Infinity).map(text).join(' ');
}
function fixture() {
  const waiting = { decision: 'WAIT', reasons: ['No setup'], spot: 22000,
    at: Date.now() / 1000, confidence: null, entry: null, contract: null, position: null };
  return {
    mode: 'ANALYSIS_ONLY', generated_at: Date.now() / 1000, recording: true,
    fault: null, subscription_error: null,
    risk: { realized_pnl: 0, trades: 0, max_trades: 5, killed: false },
    data: {
      NIFTY: { ...waiting, decision: 'BUY CE', confidence: 75, reasons: ['Trend continuation'],
        contract: { trading_symbol: 'NIFTY_TEST_CE', expiry: '2026-11-03' },
        entry: { low: 99, high: 100, maximum: 100, stop: 80, target: 140, reward_risk: 1.7 } },
      BANKNIFTY: waiting, SENSEX: waiting,
    },
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

function dailyFixture() {
  const config = { enabled: false, max_trades: 5, min_confidence: 90, stop_percent: 20,
    target_rr: 2, trail_start_r: 1, daily_loss: 2000 };
  const row = { config, executed: 1, reserved: 1, remaining: 3, status: 'WAITING',
    reason: 'Unvalidated evidence; WAIT', direction: 'BULLISH',
    opportunity: { decision: 'WAIT', confidence: 80, entry: null, contract: null, reasons: [] } };
  return { data: { NIFTY: structuredClone(row), BANKNIFTY: structuredClone(row), SENSEX: structuredClone(row) },
    editable: true, limits_editable: true, long_only: true, account: { max_trades: 5, executed: 1, reserved: 1, remaining: 3 } };
}
test('daily control saves a per-index draft without arming; polling preserves unsaved choices', async () => {
  const h = harness('AQTEDailyControl.tsx');
  h.render();
  const initial = dailyFixture();
  const cleanup = h.mount(initial);
  await settle();
  let tree = h.render();
  assert.match(text(tree), /Maximum, not a target/);
  assert.match(text(tree), /Executed\s*1/);
  assert.match(text(tree), /Remaining\s*3/);
  assert.match(text(tree), /Unvalidated evidence; WAIT/);
  nodes(tree).find(n => n.props?.['aria-label'] === 'Decrease NIFTY daily trades').props.onClick();
  tree = h.render();
  nodes(tree).find(n => n.props?.['aria-label'] === 'Decrease NIFTY daily trades').props.onClick();
  tree = h.render();
  await h.poll(initial);
  tree = h.render();
  assert.equal(text(nodes(tree).find(n => n.props?.['aria-label'] === 'NIFTY daily trade limit')), '3');
  const saved = dailyFixture();
  saved.data.NIFTY.config.max_trades = 3;
  saved.data.NIFTY.remaining = 1;
  h.respond(saved);
  nodes(tree).find(n => n.props?.['aria-label'] === 'Save NIFTY daily limit').props.onClick();
  await settle();
  const post = h.requests.find(r => r.options.method === 'POST');
  assert.equal(post.url, '/api/aqte/live/daily-limit');
  const body = JSON.parse(post.options.body);
  assert.equal(body.symbol, 'NIFTY');
  assert.equal(body.max_trades, 3);
  assert.equal(body.config, undefined);
  assert.match(text(h.render()), /daily limit saved. This does not arm or start trading/);
  assert.ok(h.requests.every(r => ['/api/aqte/live/daily-controls', '/api/aqte/live/daily-limit'].includes(r.url)));
  cleanup();
  assert.equal(h.timers.size, 0);
});

test('daily control isolates index drafts and allows count edits but not risk edits while ON', async () => {
  const h = harness('AQTEDailyControl.tsx');
  h.render();
  const initial = dailyFixture();
  const cleanup = h.mount(initial);
  await settle();
  let tree = h.render();
  nodes(tree).find(n => n.props?.['aria-label'] === 'Increase NIFTY daily trades').props.onClick();
  tree = h.render();
  nodes(tree).find(n => n.props?.['aria-label'] === 'Daily control index').props.onChange({ target: { value: 'SENSEX' } });
  tree = h.render();
  assert.equal(text(nodes(tree).find(n => n.props?.['aria-label'] === 'SENSEX daily trade limit')), '5');
  assert.equal(text(nodes(tree).find(n => n.props?.['aria-label'] === 'NIFTY daily trade limit')), '6');
  await h.poll({ ...initial, editable: false });
  tree = h.render();
  assert.ok(nodes(tree).filter(n => n.type === 'input').every(n => n.props.disabled));
  assert.equal(nodes(tree).find(n => n.props?.['aria-label'] === 'Increase SENSEX daily trades').props.disabled, false);
  assert.match(text(tree), /Turn automation OFF/);
  assert.match(text(tree), /cannot bypass the account cap/);
  cleanup();
});

test('daily controls reject malformed and offline responses rather than showing successful save', async () => {
  const h = harness('AQTEDailyControl.tsx');
  h.render();
  const cleanup = h.mount({});
  await settle();
  assert.ok(nodes(h.render()).some(n => n.props?.role === 'alert'));
  assert.ok(nodes(h.render()).filter(n => n.type === 'button').every(n => n.props.disabled));
  await h.poll(dailyFixture());
  h.render();
  await h.poll(new Error('offline'));
  let tree = h.render();
  assert.match(text(tree), /STATUS UNAVAILABLE/);
  assert.ok(nodes(tree).filter(n => n.type === 'button').every(n => n.props.disabled));
  await h.poll(dailyFixture());
  tree = h.render();
  h.respond(new Error('save response lost'));
  nodes(tree).find(n => n.props?.['aria-label'] === 'Increase NIFTY daily trades').props.onClick();
  tree = h.render();
  nodes(tree).find(n => n.props?.['aria-label'] === 'Save NIFTY daily limit').props.onClick();
  await settle();
  assert.match(text(h.render()), /Save outcome may be unknown/);
  cleanup();
});

test('configured live trailing threshold is displayed instead of a hard-coded +1R', () => {
  const value = text(harness('AQTEPosition.tsx').render({
    ...positionFixture(), mode: 'real', trailing: false, trailStartR: 2,
  }));
  assert.match(value, /Starts at \+2R/);
  assert.match(value, /WAITING FOR \+2R/);
  assert.doesNotMatch(value, /WAITING FOR \+1R/);
});

test('all three compact counters have independent saves and enforce stepper bounds', async () => {
  const h = harness('AQTEDailyControl.tsx');
  h.render();
  const initial = dailyFixture();
  initial.data.NIFTY.config.max_trades = 1;
  initial.data.SENSEX.config.max_trades = 10;
  const cleanup = h.mount(initial);
  await settle();
  const tree = h.render();
  const button = name => nodes(tree).find(n => n.props?.['aria-label'] === name);
  assert.equal(button('Decrease NIFTY daily trades').props.disabled, true);
  assert.equal(button('Increase SENSEX daily trades').props.disabled, true);
  assert.equal(button('Increase BANK NIFTY daily trades').props.disabled, false);
  for (const index of ['NIFTY', 'BANK NIFTY', 'SENSEX']) {
    assert.ok(button(`Save ${index} daily limit`));
    assert.equal(button(`Save ${index} daily limit`).props.disabled, true);
  }
  assert.match(text(tree), /Each trade is still one lot/);
  cleanup();
});

test('reference-style terminal has six overview cards, honest depth placeholders and no invented ML or targets', () => {
  const tree = harness('AQTETerminal.tsx').render({
    symbol: 'NIFTY', mode: 'paper', signal: fixture().data.NIFTY,
    unavailable: false, active: true, tick: null, execution: null,
  });
  const overview = nodes(tree).find(n => n.props?.className === 'aqte-overview-grid');
  assert.equal(overview.props.children.length, 6);
  assert.equal(nodes(tree).filter(n => n.type === 'nav' || n.type === 'a').length, 0,
    'Sidebar shortcuts stay hidden without hiding the underlying sections');
  for (const title of ['Market View', 'Trade Signal', 'Entry Price', 'Stop Loss', 'Trailing Stop Loss', 'Targets',
    'Order Book', 'Analysis', 'Trade Setup', 'Strategy Logic', 'Expected Profit']) assert.ok(text(tree).includes(title), title);
  assert.match(text(tree), /No synthetic book/);
  assert.match(text(tree), /Not a calibrated win probability/);
  assert.match(text(tree), /Illustration only/);
  assert.doesNotMatch(text(tree), /XGBoost|LSTM|Target 2|Target 3|Delta\s+0\.|Gamma\s+0\./);
  assert.equal(nodes(tree).filter(n => n.type === 'button').length, 0, 'No new trading actions in a visual redesign');
});

test('terminal real overview uses only matching broker fills and confirmed stops, never paper-plan prices', () => {
  const h = harness('AQTETerminal.tsx');
  const live = liveFixture();
  live.active = { symbol: 'NIFTY', filled: 15, entry_price: 102.5, stop: 110,
    target: 140, protection_confirmed: false, trailing_active: true, trail_start_r: 2,
    contract: { trading_symbol: 'NIFTY_REAL_CE' }, metrics: positionFixture().metrics };
  const props = { symbol: 'NIFTY', mode: 'real', signal: fixture().data.NIFTY,
    unavailable: false, active: true, tick: null, execution: null, liveStatus: live };
  let tree = h.render(props);
  let overview = nodes(tree).find(n => n.props?.className === 'aqte-overview-grid');
  assert.match(text(overview), /LONG OPEN/);
  assert.match(text(overview), /NIFTY_REAL_CE/);
  assert.match(text(overview), /102.50/);
  assert.match(text(overview), /Protection not confirmed/);
  assert.doesNotMatch(text(overview), /110.00|NIFTY_TEST_CE|BUY CE|78\/100/);
  live.active.protection_confirmed = true;
  tree = h.render(props);
  assert.match(text(tree), /Broker-confirmed SL/);
  assert.match(text(tree), /Current TSL:\s*110.00/);
  live.active.metrics = { ...live.active.metrics, stale: true };
  tree = h.render(props);
  assert.doesNotMatch(text(tree), /121.00/);
  tree = h.render({ ...props, symbol: 'BANKNIFTY' });
  assert.doesNotMatch(text(tree), /NIFTY_REAL_CE|102.50|110.00/);
});

test('compact position row keeps live entry, stop, trailing, net profit, points and percent visible', () => {
  const tree = harness('AQTEPosition.tsx').render({ ...positionFixture(), compact: true });
  const summary = nodes(tree).find(n => n.props?.['aria-label'] === 'Compact position summary');
  assert.ok(summary);
  for (const value of ['Entry', 'LTP', 'Initial SL', 'Current SL', 'Trailing SL', 'Return %',
    '100.00', '121.00', '105.00', '+255.05', '+20.00']) assert.ok(text(summary).includes(value), value);
  const stale = harness('AQTEPosition.tsx').render({ ...positionFixture(), compact: true, unavailable: true });
  const staleSummary = nodes(stale).find(n => n.props?.['aria-label'] === 'Compact position summary');
  assert.doesNotMatch(text(staleSummary), /121.00|255.05|\+20.00/);
  assert.match(text(staleSummary), /100.00|105.00/);
});

test('manual Kite positions show actual price and stops without pretending to manage trailing or placing orders', async () => {
  const h = harness('AQTEBrokerPositions.tsx');
  h.render({ selectedSymbol: 'NIFTY' });
  const cleanup = h.mount({ generated_at: Date.now() / 1000, read_only: true, positions: [
    {symbol:'NIFTY',trading_symbol:'NIFTY_KITE_CE',exchange:'NFO',product:'MIS',quantity:15,
      entry:100,ltp:120,quote_at:Date.now()/1000,points:20,return_pct:20,gross_pnl:300,
      stops:[{order_id:'manual-stop',quantity:10,trigger:80,status:'TRIGGER PENDING'}],exit_orders:[]},
    {symbol:'BANKNIFTY',trading_symbol:'BANK_KITE_PE',exchange:'NFO',product:'MIS',quantity:30,
      entry:100,ltp:90,points:-10,return_pct:-10,gross_pnl:-300,stops:[],exit_orders:[]},
  ] });
  await settle();
  let value = text(h.render({ selectedSymbol: 'NIFTY' }));
  assert.match(value, /NIFTY_KITE_CE/);
  assert.match(value, /120.00/);
  assert.match(value, /manual-stop/);
  assert.match(value, /10\s*\/\s*15/);
  assert.match(value, /does not prove trailing is active/);
  assert.match(value, /Buy entry price/);
  assert.match(value, /Running option LTP/);
  assert.match(value, /Open P&L · gross LTP/);
  assert.match(value, /NOT MANAGED BY AQTE/);
  assert.match(value, /Current broker SL/);
  assert.doesNotMatch(value, /WAITING FOR ENTRY|WAITING FOR \+1R|Open P&L · est. net/);
  assert.doesNotMatch(value, /BANK_KITE_PE/);
  value = text(h.render({ selectedSymbol: 'BANKNIFTY' }));
  assert.match(value, /No working broker SL found/);
  await h.poll(new Error('Broker offline'));
  value = text(h.render({ selectedSymbol: 'NIFTY' }));
  assert.match(value, /Zerodha positions unavailable/);
  assert.match(value, /Last known, unverified/);
  assert.doesNotMatch(value, /120.00|300.00/);
  assert.ok(h.requests.every(r => !r.options.method || r.options.method === 'GET'));
  cleanup();
  assert.equal(h.timers.size, 0);
});

test('manual broker readout never fabricates initial SL, target, trailing or net profit', () => {
  const tree = harness('AQTEPosition.tsx').render({
    ...positionFixture(), mode: 'real', brokerReadOnly: true, entryAt: null,
    initialStop: null, target: null, peak: null, trailing: false, stop: 80,
    metrics: { ...positionFixture().metrics, net_pnl: null, peak_points: null, stop_points: null },
  });
  const value = text(tree);
  assert.match(value, /Buy entry price 100.00/);
  assert.match(value, /Running option LTP 121.00/);
  assert.match(value, /Initial stop loss Not available/);
  assert.match(value, /Target price Not available/);
  assert.match(value, /Current broker SL 80.00/);
  assert.match(value, /NOT MANAGED BY AQTE/);
  assert.match(value, /\+300.00/);
  assert.doesNotMatch(value, /Starts at \+1R|WAITING FOR \+1R|est. net|ACTIVE/);
});

test('AQTE tabs have scoped accent styling without changing keyboard or selection semantics', () => {
  const tree = harness().render();
  for (const tab of nodes(tree).filter(n => n.props?.role === 'tab')) {
    assert.match(tab.props.className, /\baqte-rich-tab\b/);
    assert.ok(typeof tab.props['aria-selected'] === 'boolean');
    assert.ok(tab.props.onKeyDown);
  }
  for (const tablist of nodes(tree).filter(n => n.props?.role === 'tablist')) {
    assert.match(tablist.props.className, /\baqte-rich-tabs\b/);
  }
});

test('live control badge is green only for confirmed ON, yellow for OFF/unknown and red for emergency stop', () => {
  const h = harness();
  const badge = () => nodes(h.render()).find(n => n.props?.['aria-label'] === 'AQTE view status');
  const report = nodes(h.render()).find(n => n.props?.onStatus && !n.props.selectedSymbol).props.onStatus;
  assert.match(text(badge()), /STATUS UNKNOWN/);
  assert.match(badge().props.className, /text-amber/);
  report({ automation_on: false, killed: false });
  assert.match(text(badge()), /LIVE CONTROL · OFF/);
  assert.match(badge().props.className, /text-amber/);
  report({ automation_on: true, killed: false });
  assert.match(text(badge()), /LIVE CONTROL · ON/);
  assert.match(badge().props.className, /text-emerald/);
  report(null);
  assert.match(text(badge()), /STATUS UNKNOWN/);
  assert.doesNotMatch(badge().props.className, /text-emerald/);
  report({ automation_on: true, killed: true });
  assert.match(text(badge()), /EMERGENCY STOP/);
  assert.match(badge().props.className, /text-rose/);
  assert.equal(h.requests.length, 0);
});

test('AQTE defaults to Real Trade without submitting or exposing paper trades', async () => {
  const h = harness();
  let tree = h.render();
  assert.match(text(tree), /Real Trade.*Auto/);
  assert.match(text(tree), /Paper trading disabled.*Automation defaults OFF/);
  assert.equal(nodes(tree).filter(n => n.props?.id === 'aqte-tab-paper').length, 0);
  const cleanup = h.mount(fixture());
  await settle();
  tree = h.render();
  assert.match(text(tree), /LIVE CONTROL/);
  assert.doesNotMatch(text(tree), /BUY CE|NIFTY_TEST_CE|Paper realized P&L/);
  assert.ok(h.requests.every(request => !request.options.method || request.options.method === 'GET'));
  cleanup();
});

test('AQTE has three index-only cards above charts, without execution controls', async () => {
  const h = harness();
  let tree = h.render();
  assert.equal(nodes(tree).filter(n => n.type === 'article').length, 3);
  assert.equal(nodes(tree).filter(n => n.props?.role === 'tab').length, 3);
  assert.equal(nodes(tree).filter(n => ['input', 'select'].includes(n.type)).length, 0);
  assert.ok(nodes(tree).filter(n => n.type === 'button').every(n => n.props.role === 'tab'));
  assert.match(text(tree), /Adaptive Quantitative Trading Engine/);
  const cleanup = h.mount(fixture());
  await settle();
  tree = h.render();
  const cards = nodes(tree).filter(n => n.type === 'article');
  assert.doesNotMatch(text(cards[0]), /NIFTY_TEST_CE|BUY CE/);
  assert.match(text(cards[1]), /BANK NIFTY/);
  assert.doesNotMatch(text(cards[1]), /BUY CE|NIFTY_TEST_CE/);
  assert.doesNotMatch(text(cards[2]), /BUY CE|NIFTY_TEST_CE/);
  assert.match(text(tree), /Unvalidated rule baseline/);
  cleanup();
  assert.equal(h.timers.size, 0);
});

test('connection failure reports unavailable analysis and successful retry recovers without paper entries', async () => {
  const h = harness();
  h.render();
  const cleanup = h.mount(fixture());
  await settle();
  assert.doesNotMatch(text(h.render()), /BUY CE|NIFTY_TEST_CE/);
  await h.poll(new Error('Offline'));
  assert.doesNotMatch(text(h.render()), /BUY CE|NIFTY_TEST_CE/);
  assert.match(text(h.render()), /AQTE connection unavailable/);
  await h.poll(fixture());
  assert.doesNotMatch(text(h.render()), /AQTE connection unavailable|BUY CE|NIFTY_TEST_CE/);
  cleanup();
});

test('underlying price follows the shared live feed immediately without waiting for AQTE polling', async () => {
  const h = harness();
  h.render();
  const cleanup = h.mount(fixture());
  await settle();
  const tick = { price: 23111.25, timestamp: new Date().toISOString(), status: 'LIVE',
    change: 111.25, changePercent: 0.48 };
  const props = { isConnected: true, marketData: { NIFTY: tick, BANKNIFTY: null, SENSEX: null } };
  let first = nodes(h.render(props)).find(n => n.props?.id === 'aqte-index-panel-NIFTY');
  assert.match(text(first), /23,111.25/);
  assert.match(text(first), /LIVE FEED/);
  assert.match(text(first), /\+\s*111.25\s+pts/);
  assert.match(text(first), /\+\s*0.48\s*% today/);
  first = nodes(h.render({ ...props, marketData: { ...props.marketData, NIFTY: {
    ...tick, price: 23112.75, timestamp: new Date().toISOString(),
  } } })).find(n => n.props?.id === 'aqte-index-panel-NIFTY');
  assert.match(text(first), /23,112.75/);
  assert.equal(h.requests.length, 1, 'Streaming changes must not fetch snapshots or open another feed');
  assert.match(text(first), /WAIT/, 'Streaming prices must not authorize real entries');
  for (const change of [
    { isConnected: false },
    { marketData: { ...props.marketData, NIFTY: { ...tick, status: 'DEMO' } } },
    { marketData: { ...props.marketData, NIFTY: { ...tick, timestamp: new Date(Date.now() - 15000).toISOString() } } },
    { marketData: { ...props.marketData, NIFTY: { ...tick, price: NaN } } },
  ]) {
    const panel = nodes(h.render({ ...props, ...change })).find(n => n.props?.id === 'aqte-index-panel-NIFTY');
    assert.doesNotMatch(text(panel), /LIVE FEED|23,111.25/);
    assert.match(text(panel), /AQTE SNAPSHOT/);
  }
  cleanup();
});

test('invalid, stale and failed-recorder responses cannot show BUY', async () => {
  for (const payload of [
    { broken: true }, { ...fixture(), generated_at: Date.now() / 1000 - 20 },
    { ...fixture(), recording: false }, { ...fixture(), fault: 'Journal failed' },
  ]) {
    const h = harness();
    h.render();
    const cleanup = h.mount(payload);
    await settle();
    assert.doesNotMatch(text(h.render()), /BUY CE|NIFTY_TEST_CE/);
    cleanup();
  }
});

test('real-only view never shows retained paper entries, positions or P&L during polling', async () => {
  const h = harness();
  h.render();
  const payload = fixture();
  payload.data.NIFTY.position = { entry_at: 123, entry_price: 100, limit: 100, stop: 80, target: 140,
    initial_stop: 80, peak: 100, contract: { trading_symbol: 'NIFTY_POSITION_CE' } };
  const cleanup = h.mount(payload);
  await settle();
  let tree = h.render();
  assert.equal(nodes(tree).find(n => n.props?.id === 'aqte-trading-panel').props['aria-labelledby'], 'aqte-real-view');
  assert.equal(nodes(tree).filter(n => n.props?.id === 'aqte-tab-paper').length, 0);
  assert.match(text(tree), /LIVE CONTROL/);
  assert.doesNotMatch(text(tree), /BUY CE|NIFTY_TEST_CE|Paper position|Paper realized P&L/);
  assert.equal(nodes(tree).filter(n => n.type === 'article').length, 3);
  await h.poll(payload);
  assert.doesNotMatch(text(h.render()), /BUY CE|NIFTY_TEST_CE/);
  assert.doesNotMatch(text(h.render()), /Paper position|NIFTY_POSITION_CE/);
  cleanup();
});

test('real-only view has a labelled region and no paper mode navigation', () => {
  const h = harness();
  const tree = h.render();
  const region = nodes(tree).find(n => n.props?.id === 'aqte-trading-panel');
  assert.equal(region.props.role, 'region');
  assert.equal(region.props['aria-labelledby'], 'aqte-real-view');
  assert.equal(nodes(tree).filter(n => n.props?.['aria-label'] === 'AQTE trading view').length, 0);
  assert.equal(nodes(tree).filter(n => n.props?.role === 'tab').length, 3);
});

test('terminal presentation has bordered index cards and separated risk readouts without extra controls', async () => {
  const h = harness();
  h.render();
  const cleanup = h.mount(fixture());
  await settle();
  const tree = h.render();
  const cards = nodes(tree).filter(n => n.type === 'article');
  for (const card of cards) {
    assert.match(card.props.className, /\bborder\b/);
    assert.match(text(card), /Underlying index/);
    assert.match(text(card), /Execution protection/);
  }
  assert.match(cards[0].props.className, /border-cyan-400/);
  assert.match(cards[1].props.className, /border-indigo-400/);
  assert.match(cards[2].props.className, /border-violet-400/);
  const setup = nodes(cards[0]).find(n => n.type === 'section' && /Trade Setup/.test(text(n)));
  assert.ok(setup);
  assert.deepEqual(nodes(setup).filter(n => n.type === 'dt').map(text), ['Signal', 'Maximum buy', 'Entry range', 'Stop loss', 'Target', 'Reward / risk']);
  assert.equal(nodes(tree).filter(n => n.type === 'button').length, 3);
  cleanup();
});

function liveFixture() {
  return {
    enabled: false, paper_validated: false, expected_ip: '122.177.245.101',
    ready: true, armed: false, automation_on: false, killed: false, error: null, preflight: null,
    limits: { risk_per_trade: 500, daily_loss: 2000, max_trades: 5, max_losses: 3, max_lots: 1 },
    active: null, trades: [],
  };
}

function positionFixture() {
  return {
    mode: 'paper', contract: 'NIFTY_POSITION_CE', state: 'OPEN', entry: 100,
    entryAt: 1793347200, limit: 100, initialStop: 80, stop: 105, target: 140,
    peak: 125, trailing: true, unavailable: false,
    metrics: { quantity: 15, quote_at: 1793347260, stale: false, ltp: 121, bid: 120,
      points: 20, gross_pnl: 300, net_pnl: 255.05, return_pct: 20, peak_points: 25, stop_points: 5 },
  };
}

test('waiting index cards keep all requested metrics visible without any paper position', async () => {
  const h = harness();
  h.render();
  const payload = fixture();
  for (const signal of Object.values(payload.data)) signal.position = null;
  const cleanup = h.mount(payload);
  await settle();
  const cards = nodes(h.render()).filter(n => n.type === 'article');
  for (const card of cards) {
    const value = text(card);
    for (const label of ['Trade Setup', 'Signal', 'Maximum buy', 'Entry range',
      'Stop loss', 'Target', 'Reward / risk', 'Execution protection']) {
      assert.ok(value.includes(label), label);
    }
    assert.match(value, /WAIT/);
    assert.match(value, /--/);
    assert.doesNotMatch(value, /Limit pending @|FRESH QUOTE|WAITING FOR \+1R|Paper position/);
  }
  assert.ok(h.requests.every(r => r.options.method !== 'POST'));
  cleanup();
});

test('index tabs show one full-width panel and preserve selection and polling across trading views', async () => {
  const h = harness();
  h.render();
  const cleanup = h.mount(fixture());
  await settle();
  const panels = () => nodes(h.render()).filter(n => n.props?.id?.startsWith('aqte-index-panel-'));
  const tabs = () => nodes(h.render()).filter(n => n.props?.id?.startsWith('aqte-index-tab-'));
  assert.equal(panels().filter(n => !n.props.hidden).length, 1);
  assert.equal(panels().find(n => !n.props.hidden).props.id, 'aqte-index-panel-NIFTY');
  for (const symbol of ['BANKNIFTY', 'SENSEX', 'NIFTY']) {
    tabs().find(n => n.props.id === `aqte-index-tab-${symbol}`).props.onClick();
    assert.equal(panels().find(n => !n.props.hidden).props.id, `aqte-index-panel-${symbol}`);
    assert.equal(panels().length, 3);
    assert.equal(tabs().filter(n => n.props['aria-selected']).length, 1);
    assert.equal(tabs().find(n => n.props['aria-selected']).props.tabIndex, 0);
    assert.ok(tabs().filter(n => !n.props['aria-selected']).every(n => n.props.tabIndex === -1));
  }
  tabs().find(n => n.props.id === 'aqte-index-tab-SENSEX').props.onClick();
  assert.equal(nodes(h.render()).filter(n => n.props?.id === 'aqte-tab-paper').length, 0);
  await h.poll(fixture());
  assert.equal(panels().find(n => !n.props.hidden).props.id, 'aqte-index-panel-SENSEX');
  assert.equal(h.requests.length, 2, 'Switching index tabs must not fetch or submit orders');
  cleanup();
});

test('index tabs wrap keyboard selection and support Home and End independently of trading tabs', () => {
  const h = harness();
  h.render();
  let focused;
  for (const [from, key, expected] of [
    ['NIFTY', 'ArrowLeft', 'SENSEX'], ['SENSEX', 'ArrowRight', 'NIFTY'],
    ['NIFTY', 'ArrowRight', 'BANKNIFTY'], ['BANKNIFTY', 'End', 'SENSEX'],
    ['SENSEX', 'Home', 'NIFTY'],
  ]) {
    const tab = nodes(h.render()).find(n => n.props?.id === `aqte-index-tab-${from}`);
    tab.props.onKeyDown({ key, preventDefault() {}, currentTarget: { parentElement: { querySelectorAll: () =>
      ['NIFTY', 'BANKNIFTY', 'SENSEX'].map(symbol => ({ focus() { focused = symbol; } })),
    } } });
    assert.equal(focused, expected);
    const selected = nodes(h.render()).find(n => n.props?.id === `aqte-index-tab-${expected}`);
    assert.equal(selected.props['aria-selected'], true);
    assert.match(text(h.render()), /Real Trade.*Auto/);
  }
});

test('live view shows waiting metrics when no live position exists or status cannot load', async () => {
  for (const response of [liveFixture(), new Error('Offline')]) {
    const h = harness('AQTELivePanel.tsx');
    h.render();
    const cleanup = h.mount(response);
    await settle();
    const value = text(h.render());
    assert.match(value, /Buy entry price/);
    assert.match(value, /Running option LTP/);
    assert.match(value, /Initial stop loss/);
    assert.match(value, /Trailing stop loss/);
    assert.match(value, /Points gained/);
    assert.match(value, /Open P&L/);
    assert.match(value, /Waiting for entry/);
    assert.doesNotMatch(value, /Limit pending @|FRESH QUOTE|Broker-confirmed SL/);
    assert.ok(h.requests.every(r => r.options.method === 'GET'));
    cleanup();
  }
});

test('position terminal shows entry, option price, points, costs and independent trailing levels', () => {
  const h = harness('AQTEPosition.tsx');
  const value = text(h.render(positionFixture()));
  for (const label of ['Buy entry price', 'Running option LTP', 'Initial stop loss',
    'Current paper SL', 'Target price', 'Best observed gain', 'Entry time', 'IST',
    'Open quantity', 'Points gained', 'Open P&L', 'Gross INR', 'Trailing stop loss']) {
    assert.ok(value.includes(label), label);
  }
  assert.match(value, /\+20\.00/);
  assert.match(value, /\+255\.05/);
  assert.match(value, /121\.00/);
  assert.match(value, /Sell bid\s+120\.00/);
  assert.match(value, /Peak bid\s+125\.00/);
  assert.match(value, /ACTIVE/);
  assert.equal(nodes(h.render(positionFixture())).filter(n => n.type === 'button').length, 0);
});

test('explanatory text is collapsed by default without hiding trading metrics or emergency controls', async () => {
  const position = harness('AQTEPosition.tsx').render(positionFixture());
  const calculation = nodes(position).find(n => n.type === 'details');
  assert.ok(calculation);
  assert.ok(!calculation.props.open);
  assert.match(text(calculation), /sufficient depth/);
  assert.doesNotMatch(text(calculation), /Buy entry price|Initial stop loss|Trailing stop loss/);
  const live = harness('AQTELivePanel.tsx');
  live.render();
  const cleanup = live.mount(liveFixture());
  await settle();
  const tree = live.render();
  const setup = nodes(tree).find(n => n.type === 'details' && text(n).includes('Setup, limits'));
  assert.ok(setup);
  assert.ok(!setup.props.open);
  assert.match(text(setup), /122.177.245.101/);
  assert.match(text(setup), /stop-limit orders/);
  assert.match(text(setup), /Check static IP & Kite/);
  assert.match(text(setup), /Arm real trading today/);
  assert.doesNotMatch(text(setup), /Emergency stop & request exit/);
  const topControls = nodes(tree).find(n => n.props?.['aria-label'] === 'Live trading controls');
  assert.match(text(topControls), /Emergency stop & request exit/);
  assert.doesNotMatch(text(topControls), /Check static IP|Arm real trading today/);
  const emergency = nodes(topControls).find(n => n.type === 'button');
  assert.match(emergency.props.className, /ml-auto/);
  assert.match(emergency.props.className, /sm:w-auto/);
  await emergency.props.onClick();
  await settle();
  const sent = live.requests.find(r => r.options.method === 'POST');
  assert.ok(sent.url.endsWith('/live/stop'));
  assert.ok(nodes(tree).some(n => n.type === 'button' && text(n).includes('Emergency stop')));
  const section = harness().render();
  for (const detail of nodes(section).filter(n => n.type === 'details')) assert.ok(!detail.props.open);
  cleanup();
});

test('all position and trailing prices have distinct bordered boxes with wrapping labels and values', () => {
  const tree = harness('AQTEPosition.tsx').render(positionFixture());
  for (const label of ['Position prices', 'Trailing stop metrics']) {
    const grid = nodes(tree).find(n => n.props?.['aria-label'] === label);
    assert.ok(grid, label);
    assert.match(grid.props.className, /grid-cols-2/);
    for (const cell of [grid.props.children].flat()) {
      assert.match(cell.props.className, /\bborder\b/);
      assert.match(cell.props.className, /rounded-/);
      assert.match(cell.props.className, /min-w-0/);
      assert.match(cell.props.className, /\baqte-metric\b/);
      const value = nodes(cell).find(n => n.type === 'dd');
      assert.match(value.props.className, /break-words/);
    }
  }
  assert.match(text(tree), /Entry time/);
  assert.match(text(tree), /Open quantity/);
});

test('entry and market prices lead the compact layout, followed by live profit, points and percent', () => {
  const tree = harness('AQTEPosition.tsx').render(positionFixture());
  const all = nodes(tree);
  const prices = all.find(n => n.props?.['aria-label'] === 'Position prices');
  const profit = all.find(n => n.props?.['aria-label'] === 'Live profit and change');
  assert.ok(all.indexOf(prices) < all.indexOf(profit));
  assert.deepEqual(nodes(prices).filter(n => n.type === 'dt').map(text), [
    'Buy entry price', 'Running option LTP', 'Initial stop loss', 'Current paper SL',
    'Target price', 'Best observed gain',
  ]);
  assert.match(text(prices), /Trailing SL · Active/);
  assert.match(text(profit), /\+20\.00/);
  assert.match(text(profit), /% from entry/);
  assert.match(text(profit), /\+255\.05/);
  assert.match(prices.props.className, /xl:grid-cols-6/);
  for (const cell of prices.props.children) assert.match(cell.props.className, /border-(cyan|sky|rose|amber|emerald|violet)-400/);
});

test('responsive AQTE avoids clipped containers and keeps tabs and live actions touch-friendly', async () => {
  const tree = harness().render();
  const section = nodes(tree).find(n => n.type === 'section');
  assert.match(section.props.className, /min-w-0/);
  assert.match(section.props.className, /max-w-full/);
  assert.match(section.props.className, /\baqte-theme\b/);
  const styles = readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8');
  assert.match(styles, /\.aqte-theme \.aqte-metric\s*\{\s*border-color: rgb\(134 239 172 \/ 0\.3\)/);
  assert.doesNotMatch(styles, /\.aqte-theme :is\(/);
  assert.match(section.props.className, /border-slate-600/);
  assert.doesNotMatch(section.props.className, /overflow-hidden/);
  for (const tab of nodes(tree).filter(n => n.props?.role === 'tab')) {
    assert.match(tab.props.className, /min-w-0/);
    assert.match(tab.props.className, /min-h-\[(44|48)px\]/);
  }
  const automation = harness('AQTEAutomationSwitch.tsx').render();
  const control = nodes(automation).find(n => n.props?.role === 'switch');
  assert.match(control.props.className, /flex-wrap/);
  assert.match(control.props.className, /w-full/);
  const live = harness('AQTELivePanel.tsx');
  live.render();
  const cleanup = live.mount(liveFixture());
  await settle();
  const actions = nodes(live.render()).find(n => n.props?.['aria-label'] === 'Live setup controls');
  assert.ok(actions);
  assert.match(actions.props.className, /grid-cols-1/);
  assert.match(actions.props.className, /sm:grid-cols-2/);
  cleanup();
});

test('stale or disconnected position suppresses current profit while retaining entry and confirmed stop', () => {
  const h = harness('AQTEPosition.tsx');
  for (const props of [
    { ...positionFixture(), unavailable: true },
    { ...positionFixture(), metrics: { ...positionFixture().metrics, stale: true } },
  ]) {
    const value = text(h.render(props));
    assert.doesNotMatch(value, /\+20\.00|\+255\.05|121\.00/);
    assert.match(value, /100\.00/);
    assert.match(value, /105\.00/);
    assert.match(value, /STATUS NOT CURRENT|STALE QUOTE/);
  }
});

test('position distinguishes negative, zero, pending fill and pending broker stop without inventing profit', () => {
  const h = harness('AQTEPosition.tsx');
  for (const points of [-3, 0]) {
    const tree = h.render({ ...positionFixture(), metrics: {
      ...positionFixture().metrics, points, net_pnl: points, gross_pnl: points, return_pct: points,
    } });
    assert.match(text(tree), new RegExp(points === 0 ? '0\\.00' : '-3\\.00'));
    assert.ok(nodes(tree).some(n => n.props?.className?.includes(points < 0 ? 'text-rose-300' : 'text-slate-200')));
  }
  const pending = text(h.render({ ...positionFixture(), mode: 'real', entry: null, entryAt: null,
    trailing: false, stopConfirmed: false, metrics: undefined }));
  assert.match(pending, /Awaiting fill/);
  assert.match(pending, /No filled-entry P&L/);
  assert.match(pending, /Planned SL \(unconfirmed\)/);
  assert.doesNotMatch(pending, /Broker-confirmed SL/);
  const confirmed = text(h.render({ ...positionFixture(), mode: 'real', stopConfirmed: true, pendingStop: 110 }));
  assert.match(confirmed, /Broker-confirmed SL 105\.00/);
  assert.match(confirmed, /Requested SL\s+110\.00/);
  assert.match(confirmed, /Awaiting broker confirmation/);
});

test('real position receives backend metrics and hides them after disconnect', async () => {
  const h = harness('AQTELivePanel.tsx');
  h.render();
  const props = positionFixture();
  const payload = { ...liveFixture(), active: {
    symbol: 'NIFTY', state: 'PROTECTED', filled: 15, entry_price: 100, entry_at: props.entryAt,
    limit: 100, initial_stop: 80, stop: 105, target: 140, peak: 125, trailing_active: true,
    protection_confirmed: true, metrics: props.metrics, contract: { trading_symbol: props.contract },
    entry_id: 'entry-test', protect_id: 'stop-test', error: null,
  } };
  const cleanup = h.mount(payload);
  await settle();
  assert.match(text(h.render()), /Real position/);
  assert.match(text(h.render()), /\+255\.05/);
  const otherIndex = text(h.render({ selectedSymbol: 'BANKNIFTY' }));
  assert.match(otherIndex, /active NIFTY live position/);
  assert.match(otherIndex, /BANK NIFTY/);
  assert.doesNotMatch(otherIndex, /NIFTY_POSITION_CE|\+255\.05/);
  assert.match(text(h.render({ selectedSymbol: 'NIFTY' })), /\+255\.05/);
  assert.equal(h.requests.length, 1);
  await h.poll(new Error('Offline'));
  assert.match(text(h.render()), /STATUS NOT CURRENT/);
  assert.doesNotMatch(text(h.render()), /\+255\.05/);
  cleanup();
  assert.equal(h.timers.size, 0);
});

test('real controller polls status only and keeps entry controls disabled by default', async () => {
  const h = harness('AQTELivePanel.tsx');
  h.render();
  const cleanup = h.mount(liveFixture());
  await settle();
  const tree = h.render();
  assert.match(text(tree), /122.177.245.101/);
  assert.match(text(tree), /LIVE LOCKED/);
  const buttons = nodes(tree).filter(n => n.type === 'button');
  assert.ok(buttons.filter(n => !text(n).includes('Emergency')).every(n => n.props.disabled));
  assert.ok(h.requests.every(r => r.options.method === 'GET'));
  assert.equal(h.requests[0].options.headers['X-AQTE-Intent'], 'manual-live-control');
  assert.equal(h.requests[0].options.credentials, 'include');
  cleanup();
});

test('header switch defaults OFF and only confirmed ON sends automation command', async () => {
  const h = harness('AQTEAutomationSwitch.tsx');
  h.render();
  const status = { ...liveFixture(), enabled: true, paper_validated: true, armed: true };
  const cleanup = h.mount(status);
  await settle();
  const schedule = nodes(h.render()).find(n => n.props?.['aria-label'] === 'AQTE auto trading schedule');
  assert.match(text(schedule), /AQTE auto trading only.*9:15 AM–3:30 PM IST/);
  assert.match(text(schedule), /New entries until 3:15 PM.*Square-off starts 3:25 PM/);
  assert.match(text(schedule), /saved index limits and risk settings/);
  assert.match(text(schedule), /OFF: pause new entries; open-position protection continues/);
  assert.equal(nodes(h.render()).find(n => n.props?.role === 'switch').props['aria-checked'], false);
  assert.ok(h.requests.every(r => r.options.method === 'GET'));
  nodes(h.render()).find(n => n.props?.role === 'switch').props.onClick();
  assert.match(text(h.render()), /Start automated real-money orders/);
  assert.match(text(h.render()), /one-lot BUY CE\/BUY PE.*No qualifying signal means no trade/);
  assert.equal(h.requests.filter(r => r.options.method === 'POST').length, 0);
  nodes(h.render()).find(n => n.type === 'button' && /Confirm ON/.test(text(n))).props.onClick();
  await settle();
  const sent = h.requests.find(r => r.url.endsWith('/automation'));
  assert.deepEqual(JSON.parse(sent.options.body), { enabled: true, confirmation: 'START AUTOMATED REAL TRADING' });
  assert.doesNotMatch(text(h.render()), /Start automated real-money orders/);
  await h.poll({ ...status, automation_on: true });
  assert.equal(nodes(h.render()).find(n => n.props?.role === 'switch').props['aria-checked'], true);
  nodes(h.render()).find(n => n.props?.role === 'switch').props.onClick();
  await settle();
  const off = h.requests.filter(r => r.options.method === 'POST').at(-1);
  assert.deepEqual(JSON.parse(off.options.body), { enabled: false, confirmation: 'STOP NEW ENTRIES' });
  cleanup();
});

test('header switch blocks ON before arming and never shows failed request as successful OFF', async () => {
  const h = harness('AQTEAutomationSwitch.tsx');
  h.render();
  const cleanup = h.mount(liveFixture());
  await settle();
  assert.equal(nodes(h.render()).find(n => n.props?.role === 'switch').props.disabled, true);
  await h.poll(new Error('Network failed'));
  assert.match(text(h.render()), /UNKNOWN/);
  assert.equal(nodes(h.render()).find(n => n.props?.role === 'switch').props.disabled, false);
  nodes(h.render()).find(n => n.props?.role === 'switch').props.onClick();
  await settle();
  assert.match(text(h.render()), /UNKNOWN/);
  assert.deepEqual(JSON.parse(h.requests.at(-1).options.body), { enabled: false, confirmation: 'STOP NEW ENTRIES' });
  cleanup();
});

test('AQTE refresh restores highlighted backend ON, OFF and emergency states using GET only', async () => {
  for (const [patch, label, color] of [
    [{ automation_on: true, armed: true }, 'ON', 'emerald'],
    [{ automation_on: false }, 'OFF', 'amber'],
    [{ automation_on: false, killed: true }, 'EMERGENCY STOP', 'rose'],
  ]) {
    const h = harness('AQTEAutomationSwitch.tsx');
    h.render();
    const cleanup = h.mount({ ...liveFixture(), ...patch });
    await settle();
    const tree = h.render();
    const control = nodes(tree).find(n => n.props?.role === 'switch');
    assert.match(control.props.className, new RegExp(`border-${color}`));
    assert.match(control.props.className, /border-2/);
    assert.ok(nodes(control).some(n => n.type === 'span' && text(n) === label));
    assert.equal(control.props['aria-checked'], label === 'ON');
    assert.match(text(tree), label === 'EMERGENCY STOP' ? /Emergency stop latched/ : /Backend confirmed.*Restored on page refresh/);
    assert.ok(h.requests.every(r => r.options.method === 'GET'));
    cleanup();
  }
});

test('AQTE acknowledges automatic save only after command response and removes it when status is unknown', async () => {
  const h = harness('AQTEAutomationSwitch.tsx');
  const on = { ...liveFixture(), enabled: true, paper_validated: true, armed: true, automation_on: true };
  h.render();
  const cleanup = h.mount(on);
  await settle();
  h.respond({ ...on, automation_on: false });
  nodes(h.render()).find(n => n.props?.role === 'switch').props.onClick();
  await settle();
  assert.match(text(h.render()), /Saved automatically.*OFF.*Restored on page refresh/);
  await h.poll(new Error('Lost connection'));
  assert.doesNotMatch(text(h.render()), /Saved automatically|Backend confirmed/);
  assert.match(text(h.render()), /Do not assume OFF/);
  await h.poll(on);
  assert.match(text(h.render()), /Backend confirmed.*ON/);
  assert.equal(nodes(h.render()).filter(n => n.props?.role === 'alert').length, 0);
  cleanup();
});
