const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness(filename = 'AQTESection.tsx', now, sharedProduction = false) {
  const states = [];
  const timers = new Map();
  const requests = [];
  let effect, cursor, timer = 0, response, accessExpired = 0;
  const react = {
    memo: component => component,
    useState: initial => {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    },
    useEffect: fn => { effect = fn; },
    useMemo: fn => fn(),
    useCallback: fn => fn,
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
    Date: now === undefined ? Date : class extends Date { static now() { return typeof now === 'function' ? now() : now; } },
    setTimeout: (fn, delay) => { timers.set(++timer, { fn, delay }); return timer; },
    clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (response instanceof Error) throw response;
      const value = response;
      return { ok: !value?.__httpStatus || value.__httpStatus < 400, status: value?.__httpStatus ?? 200,
        json: async () => value?.__httpStatus ? value.__body : value };
    },
    require: id => {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime') return require(id);
      if (id === '@/lib/api-config') return { API_CONFIG: { endpoint: p => p, sharedProduction } };
      if (id === '@/components/AQTELiveController') return { default: () => null };
      if (id === '@/components/AQTEAutomationSwitch') return { default: () => null };
      if (id === '@/components/AQTEDailyControl') return { default: () => null };
      if (id === 'next/dynamic') return { default: () => () => null };
      if (id === '@/hooks/useChartHistory') return { prefetchChartHistory: async () => {} };
      if (id === '@/lib/aqte-display') {
        const code = ts.transpileModule(readFileSync(path.join(__dirname, '..', 'lib', 'aqte-display.ts'), 'utf8'),
          { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
        const exports = {};
        vm.runInNewContext(code, { exports, Intl, Date: context.Date, setTimeout: context.setTimeout, clearTimeout: context.clearTimeout });
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
      if (id === '@/components/AQTEEngineDeck') {
        const component = harness('AQTEEngineDeck.tsx');
        return { default: props => component.render(props) };
      }
      if (id === '@/components/AQTEPosition') {
        const component = harness('AQTEPosition.tsx');
        return { default: props => component.render(props) };
      }
      if (id === '@/lib/visitor-id') return { getOrCreateVisitorId: () => 'test-device' };
      if (id === '@/lib/app-access-events') return { notifyAppAccessExpired: () => { accessExpired++; } };
      throw new Error(`Unexpected dependency ${id}`);
    },
  };
  vm.runInNewContext(compiled, context);
  return {
    render(props = {}) { cursor = 0; return context.exports.default(props); },
    mount(value) { response = value; return effect(); },
    respond(value) { response = value; },
    respondHTTP(status, value) { response = { __httpStatus: status, __body: value }; },
    async poll(value) {
      response = value;
      const pending = [...timers.entries()].find(([, value]) => value.delay === 2000);
      assert.ok(pending, 'Polling retry should be scheduled after completion');
      timers.delete(pending[0]);
      await pending[1].fn();
    },
    timers, requests,
    exports: context.exports,
    get accessExpired() { return accessExpired; },
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
  const config = { enabled: true, style: 'both', max_trades: 5, min_confidence: 75, stop_percent: 20,
    target_rr: 2, trail_start_r: 1, daily_loss: 2000,
    setups: { momentum_breakout: true, trend_continuation: true, liquidity_reversal: true, mean_reversion: true } };
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

test('daily control defaults select all seven checkboxes per index without saving and use a 75-80 score range', async () => {
  const h = harness('AQTEDailyControl.tsx');
  h.render();
  const initial = dailyFixture();
  const cleanup = h.mount(initial);
  await settle();
  for (const symbol of ['NIFTY', 'BANKNIFTY', 'SENSEX']) {
    nodes(h.render()).find(n => n.props?.['aria-label'] === 'Daily control index').props.onChange({ target: { value: symbol } });
    const tree = h.render();
    const boxes = nodes(tree).filter(n => n.type === 'input' && n.props.type === 'checkbox');
    assert.equal(boxes.length, 7);
    assert.ok(boxes.every(box => box.props.checked), symbol);
    const score = nodes(tree).find(n => n.props?.['aria-label'] === 'Minimum rule score');
    assert.equal(score.props.value, 75);
    assert.deepEqual([score.props.min, score.props.max, score.props.step], [75, 80, 1]);
    assert.match(text(tree), /no manual checking is required/);
    assert.match(text(tree), /including unvalidated-rule mode/);
  }
  assert.ok(h.requests.every(request => request.options.method !== 'POST'), 'defaults never submit or arm trading');
  const tree = h.render();
  nodes(tree).find(n => n.props?.['aria-label'] === 'Minimum rule score').props.onChange({ target: { value: '78' } });
  h.respond(initial);
  nodes(h.render()).find(n => n.type === 'button' && /Save SENSEX controls/.test(text(n))).props.onClick();
  await settle();
  const post = h.requests.find(request => request.options.method === 'POST');
  assert.equal(post.url, '/api/aqte/live/daily-controls');
  assert.equal(JSON.parse(post.options.body).config.min_confidence, 78);
  cleanup();

  for (const invalid of [74, 81, 90, 75.5, '75']) {
    const broken = harness('AQTEDailyControl.tsx');
    broken.render();
    const value = dailyFixture();
    value.data.NIFTY.config.min_confidence = invalid;
    const stop = broken.mount(value);
    await settle();
    assert.ok(nodes(broken.render()).some(n => n.props?.role === 'alert'), String(invalid));
    stop();
  }
});

test('swing controls show per-setup switches, save them with the draft and reject malformed setups', async () => {
  const setups = { momentum_breakout: true, trend_continuation: false, liquidity_reversal: false, mean_reversion: false };
  const swing = style => {
    const value = dailyFixture();
    for (const index of ['NIFTY', 'BANKNIFTY', 'SENSEX']) Object.assign(value.data[index].config, { style, setups: { ...setups } });
    return value;
  };
  const box = (tree, name) => nodes(tree).find(n => n.props?.['aria-label'] === `Allow ${name} entries`);
  const h = harness('AQTEDailyControl.tsx');
  h.render();
  const initial = swing('swing');
  const cleanup = h.mount(initial);
  await settle();
  let tree = h.render();
  for (const name of ['Momentum breakout', 'Trend continuation', 'Liquidity-sweep reversal', 'Mean reversion']) {
    assert.equal(box(tree, name).props.checked, name === 'Momentum breakout', name);
  }
  assert.match(text(tree), /Each setup must pass every one of its own checks/);
  box(tree, 'Trend continuation').props.onChange({ target: { checked: true } });
  tree = h.render();
  assert.equal(box(tree, 'Trend continuation').props.checked, true);
  h.respond(initial);
  nodes(tree).find(n => n.type === 'button' && /Save NIFTY controls/.test(text(n))).props.onClick();
  await settle();
  const post = h.requests.find(r => r.options.method === 'POST');
  assert.equal(post.url, '/api/aqte/live/daily-controls');
  assert.deepEqual(JSON.parse(post.options.body).config.setups, { ...setups, trend_continuation: true });
  cleanup();

  const scalp = harness('AQTEDailyControl.tsx');
  scalp.render();
  const stopScalp = scalp.mount(swing('scalp'));
  await settle();
  assert.equal(box(scalp.render(), 'Trend continuation'), undefined, 'Setups apply to Swing only');
  stopScalp();
  for (const bad of [{ momentum_breakout: true }, { ...setups, mean_reversion: 'yes' }, [true, false, false, false],
    { ...setups, martingale: true }]) {
    const broken = harness('AQTEDailyControl.tsx');
    broken.render();
    const value = swing('swing');
    value.data.NIFTY.config.setups = bad;
    const stop = broken.mount(value);
    await settle();
    assert.ok(nodes(broken.render()).some(n => n.props?.role === 'alert'), JSON.stringify(bad));
    stop();
  }
});

function ruleSignal() {
  const now = Date.now() / 1000;
  const ids = ['ema', 'vwap', 'supertrend', 'rsi', 'breakout', 'volume', 'imbalance', 'extension'];
  const checks = ids.map(id => ({
    id, label: id, passed: !['supertrend', 'rsi', 'breakout'].includes(id),
    requirement: `${id} threshold from backend`, reason: `${id} does not confirm`,
  }));
  return {
    ...fixture().data.NIFTY, feed_ready: true, decision: 'WAIT', confidence: 73,
    scalp: { decision: 'WAIT', strategy: null, confidence: null, contract: null, entry: null,
      reasons: ['SuperTrend not aligned'] },
    intelligence: {
      ema: { '9': 95, '20': 96, '50': 97, '100': 98, '200': 99 }, close: 94,
      at: Math.floor(now / 60) * 60 - 60, vwap: 100, rsi: 49.03, atr: 10,
      supertrend: 'BULLISH', supertrend_price: 92, structure: 'RANGE',
      volume_ratio: 1.84, volume: 1840, average_volume: 1000,
      imbalance: -0.4584, breakout: 0, sweep: 0, breakout_high: 110, breakout_low: 90,
      cpr: { top: 103, bottom: 97, pivot: 100 },
      live: { token: 20, at: now, received: now, price: 94.5, buy_depth: 2708, sell_depth: 7292,
        oi: 101000, oi_reference: 100000, oi_reference_at: Math.floor(now / 60) * 60,
        oi_change: 1000, oi_change_pct: 1 },
    },
    rule_checks: {
      scalp: { side: 'PE', checks },
      swing: { side: 'PE', checks: [...checks.filter(c => c.id !== 'extension'),
        ...['cpr', 'structure'].map(id => ({ id, label: id, passed: false, requirement: id, reason: id }))] },
    },
  };
}
const rulePanel = tree => nodes(tree).find(n => n.props?.['aria-label'] === 'Rule-Based Trade Engine');
const ruleProps = signal => ({
  symbol: 'NIFTY', signal, unavailable: false, active: true, tick: null,
  liveStatus: { ...liveFixture(), styles: { NIFTY: 'scalp' } },
});

test('rule card keeps eight compact essentials visible and collapses all technical evidence by default', () => {
  const signal = ruleSignal();
  const before = JSON.stringify(signal);
  const panel = rulePanel(harness('AQTETerminal.tsx').render(ruleProps(signal)));
  const compact = nodes(panel).find(n => n.props?.['aria-label'] === 'Key trading indicators');
  const details = nodes(panel).find(n => n.type === 'details' && n.props?.['aria-label'] === 'Advanced rule details');
  assert.ok(compact, 'The primary card must stay visible');
  assert.ok(details, 'Technical data remains available on demand');
  assert.notEqual(details.props.open, true, 'Start collapsed, not an expanded technical table');
  assert.equal(nodes(panel).filter(n => n.type === 'details').length, 1, 'One simple disclosure, no nested accordions');
  assert.equal(text(nodes(details).find(n => n.type === 'summary')).trim(), 'Advanced details');
  assert.deepEqual(nodes(compact).filter(n => n.type === 'li').map(n => n.props['data-rule']),
    ['supertrend', 'ema', 'vwap', 'rsi', 'imbalance', 'oi_change', 'volume', 'score']);
  const primary = text(compact);
  assert.match(primary, /49\.03/);
  assert.match(primary, /-45\.84%/);
  assert.match(primary, /\+1\.00%/);
  assert.match(primary, /1\.84×/);
  assert.doesNotMatch(primary, /N\/A|INFO|Closed 1m|IST|CPR|ATR|2,708|7,292|1,01,000|threshold|14, 3/);
  const technical = text(details);
  for (const value of ['1,01,000', '2,708', '7,292', 'Closed 1m candle', 'Live futures tick', 'EMA20 gap',
    '20-candle breakout', 'rsi threshold from backend', 'No ML order decisions']) {
    assert.ok(technical.includes(value), value);
  }
  assert.equal(JSON.stringify(signal), before, 'Collapsing presentation cannot change trading inputs');
});

test('collapsed technical evidence still updates for every index without losing hidden entry checks', () => {
  for (const symbol of ['NIFTY', 'BANKNIFTY', 'SENSEX']) {
    const h = harness('AQTETerminal.tsx');
    const props = ruleProps(ruleSignal());
    props.symbol = symbol;
    props.liveStatus.styles = { [symbol]: 'swing' };
    const first = rulePanel(h.render(props));
    const technical = panel => nodes(panel).find(n => n.type === 'details' && n.props?.['aria-label'] === 'Advanced rule details');
    assert.notEqual(technical(first).props.open, true);
    assert.match(text(technical(first)), /Previous-day spot CPR/);
    assert.equal(nodes(technical(first)).find(n => n.props?.['data-rule'] === 'breakout').props['data-status'], 'FAIL');
    Object.assign(props.signal.intelligence.live, { oi: 102000, oi_change: 2000, oi_change_pct: 2 });
    const next = rulePanel(h.render(props));
    assert.notEqual(technical(next).props.open, true);
    assert.match(text(technical(next)), /1,02,000/);
    assert.match(text(nodes(next).find(n => n.props?.['aria-label'] === 'Key trading indicators')), /\+2\.00%/);
  }
});

test('rule-check validator accepts each swing setup only with its exact backend check ids', () => {
  const code = ts.transpileModule(readFileSync(path.join(__dirname, '..', 'lib', 'aqte-display.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const lib = {};
  vm.runInNewContext(code, { exports: lib, Intl, Date, setTimeout, clearTimeout });
  const gate = id => ({ id, label: id, passed: null, requirement: id, reason: id });
  const scalp = { side: null, checks: ['ema', 'vwap', 'supertrend', 'rsi', 'breakout', 'volume', 'imbalance', 'extension'].map(gate) };
  // Mirrors backend setup_checks ids exactly.
  const ids = {
    momentum_breakout: ['ema', 'vwap', 'supertrend', 'rsi', 'cpr', 'volume', 'imbalance', 'breakout', 'structure'],
    trend_continuation: ['ema', 'vwap', 'supertrend', 'rsi', 'cpr', 'pullback', 'resume', 'structure', 'volume', 'imbalance'],
    liquidity_reversal: ['sweep', 'trend_filter', 'rsi', 'volume', 'imbalance', 'confirm'],
    mean_reversion: ['stretch', 'rsi', 'range', 'volume', 'imbalance', 'turn'],
  };
  assert.deepEqual([...lib.AQTE_SWING_SETUPS], Object.keys(ids));
  const valid = swing => lib.isAqteRuleChecks({ scalp, swing });
  for (const [setup, list] of Object.entries(ids)) {
    assert.equal(valid({ side: 'CE', setup, checks: list.map(gate) }), true, setup);
    assert.equal(valid({ side: 'PE', setup, checks: list.slice(1).map(gate) }), false, `${setup} missing a check`);
    assert.equal(valid({ side: 'PE', setup, checks: [...list.slice(1), 'extension'].map(gate) }), false, `${setup} foreign check`);
  }
  const breakout = ids.momentum_breakout.map(gate);
  assert.equal(valid({ side: null, setup: null, checks: breakout }), true, 'No setup on the candle reports the breakout gate');
  assert.equal(valid({ side: null, checks: breakout }), true, 'Older backend without the setup field');
  assert.equal(valid({ side: 'CE', setup: 'trend_continuation', checks: breakout }), false);
  assert.equal(valid({ side: 'CE', setup: 'martingale', checks: breakout }), false);
  assert.equal(lib.isAqteRuleChecks({ scalp: { ...scalp, setup: 'momentum_breakout' }, swing: { side: null, checks: breakout } }), false);
});

test('swing evidence names its setup and shows every setup-specific check with its measured value', () => {
  const signal = ruleSignal();
  const gate = (id, passed) => ({ id, label: `${id} gate`, passed, requirement: `${id} requirement`, reason: `${id} reason` });
  signal.rule_checks.swing = { side: 'CE', setup: 'liquidity_reversal', checks: [
    gate('sweep', true), gate('trend_filter', true), gate('rsi', true), gate('volume', true), gate('imbalance', false), gate('confirm', true)] };
  signal.intelligence.sweep = 1;
  const props = ruleProps(signal);
  props.liveStatus.styles = { NIFTY: 'swing' };
  const panel = rulePanel(harness('AQTETerminal.tsx').render(props));
  assert.match(text(nodes(panel).find(n => n.props?.['aria-label'] === 'Rule alignment')),
    /Swing · Liquidity-sweep reversal · CE · 5\/6 aligned/);
  const details = nodes(panel).find(n => n.type === 'details' && n.props?.['aria-label'] === 'Advanced rule details');
  const row = id => nodes(details).find(n => n.props?.['data-rule'] === id);
  for (const id of ['sweep', 'trend_filter', 'rsi', 'confirm']) assert.equal(row(id).props['data-status'], 'PASS', id);
  assert.equal(row('imbalance').props['data-status'], 'FAIL');
  assert.equal(row('breakout').props['data-status'], 'CONTEXT', 'Not part of this setup gate');
  const technical = text(details);
  for (const value of [/Swept prior low, closed back inside/, /EMA 9-200: Bearish stack/, /Live 94\.50 vs close 94\.00/,
    /sweep requirement/, /confirm gate/]) assert.match(technical, value);
});

test('swing card shows the setup the controller trades when the engine pick is OFF in Controls', () => {
  const ids = {
    momentum_breakout: ['ema', 'vwap', 'supertrend', 'rsi', 'cpr', 'volume', 'imbalance', 'breakout', 'structure'],
    trend_continuation: ['ema', 'vwap', 'supertrend', 'rsi', 'cpr', 'pullback', 'resume', 'structure', 'volume', 'imbalance'],
    liquidity_reversal: ['sweep', 'trend_filter', 'rsi', 'volume', 'imbalance', 'confirm'],
  };
  const gates = name => ids[name].map(id => ({ id, label: `${id} gate`, passed: true, requirement: `${name} ${id}`, reason: id }));
  const signal = { ...ruleSignal(), decision: 'BUY CE', strategy: 'momentum_breakout', confidence: 75,
    reasons: ['momentum breakout', 'EMA aligned'] };
  signal.rule_checks.swing = { side: 'CE', setup: 'momentum_breakout', checks: gates('momentum_breakout') };
  signal.setups = [
    { name: 'momentum_breakout', side: 'CE', score: 75, passed: true, checks: gates('momentum_breakout') },
    { name: 'liquidity_reversal', side: 'PE', score: 74, passed: true, checks: gates('liquidity_reversal') },
    { name: 'trend_continuation', side: 'CE', score: 68, passed: true, checks: gates('trend_continuation') },
  ];
  const before = JSON.stringify(signal);
  const switches = { momentum_breakout: false, trend_continuation: true, liquidity_reversal: true, mean_reversion: false };
  const render = setups => {
    const props = ruleProps(signal);
    Object.assign(props.liveStatus, { styles: { NIFTY: 'swing' }, swing_setups: { NIFTY: setups } });
    const panel = rulePanel(harness('AQTETerminal.tsx').render(props));
    return {
      alignment: text(nodes(panel).find(n => n.props?.['aria-label'] === 'Rule alignment')),
      score: text(nodes(panel).find(n => n.props?.['data-rule'] === 'score')),
      technical: text(nodes(panel).find(n => n.type === 'details' && n.props?.['aria-label'] === 'Advanced rule details')),
    };
  };
  const swapped = render(switches);
  assert.match(swapped.alignment, /Swing · Trend continuation · CE · 10\/10 aligned/, 'Same-side ON setup, not the OFF pick or the PE one');
  assert.match(swapped.score, /68\.00 \/ 100/);
  assert.match(swapped.technical, /trend_continuation pullback/);
  assert.doesNotMatch(swapped.technical, /momentum_breakout breakout/);
  const own = render({ ...switches, momentum_breakout: true });
  assert.match(own.alignment, /Swing · Momentum breakout · CE · 9\/9 aligned/, 'An ON engine pick is never swapped');
  assert.match(own.score, /75\.00 \/ 100/);
  assert.match(render({ ...switches, trend_continuation: false }).alignment, /Momentum breakout/,
    'No ON same-side setup: the (blocked) engine pick stays visible, exactly like the controller');
  signal.setups[2].checks = signal.setups[2].checks.slice(1);
  assert.match(render(switches).alignment, /Swing · Unverified/, 'A malformed swapped gate never shows the OFF setup instead');
  signal.setups[2].checks = gates('trend_continuation');
  assert.equal(JSON.stringify(signal), before, 'Mirroring the swap never mutates the engine signal');
});

test('effective signal and ranking mirror the controller enabled-setup swap; status switches are validated', () => {
  const display = displayModule();
  const candidate = (name, side, score, passed = true) => ({ name, side, score, passed, checks: [] });
  const signal = { ...fixture().data.NIFTY, decision: 'BUY PE', strategy: 'momentum_breakout', confidence: 75,
    reasons: ['momentum breakout', 'Book pressure'], entry: { maximum: 100, stop: 90, target: 120, reward_risk: 2 },
    setups: [candidate('momentum_breakout', 'PE', 75), candidate('mean_reversion', 'PE', 70, false),
      candidate('liquidity_reversal', 'CE', 69), candidate('trend_continuation', 'PE', 68)] };
  const off = { momentum_breakout: false, trend_continuation: true, liquidity_reversal: true, mean_reversion: true };
  const swapped = display.aqteEffectiveSignal(signal, 'swing', off);
  assert.deepEqual([swapped.strategy, swapped.confidence, [...swapped.reasons]],
    ['trend_continuation', 68, ['trend continuation', 'Book pressure']], 'Skips failing and opposite-side setups');
  assert.equal(display.aqteEffectiveSignal(signal, 'swing').strategy, 'momentum_breakout', 'No switches known: no swap');
  assert.equal(display.aqteEffectiveSignal(signal, 'swing', { ...off, momentum_breakout: true }).confidence, 75);
  assert.equal(display.aqteEffectiveSignal({ ...signal, decision: 'WAIT' }, 'swing', off).strategy, 'momentum_breakout');
  assert.equal(display.aqteEffectiveSignal(signal, 'swing', off).decision, 'BUY PE', 'The side and contract never change');
  assert.equal(display.aqteTradedSetup({ ...signal, setups: [{ ...signal.setups[3], score: 'x' }] }, off).name, 'trend_continuation');
  assert.equal(display.aqteEffectiveSignal({ ...signal, setups: [{ ...signal.setups[3], score: 'x' }] }, 'swing', off).confidence, null,
    'A malformed swapped score is unknown, not the OFF pick score');
  assert.deepEqual([...display.aqteRankKey(signal, 'swing', off)], [1, 0, 68]);
  const status = liveFixture();
  assert.equal(display.isAqteLiveState({ ...status, swing_setups: { NIFTY: off, SENSEX: { mean_reversion: false } } }), true);
  for (const swing_setups of [{ NIFTY: { martingale: true } }, { NIFTY: { mean_reversion: 'yes' } }, { OTHER: off }, { NIFTY: null },
    { NIFTY: [true] }, []]) {
    assert.equal(display.isAqteLiveState({ ...status, swing_setups }), false, JSON.stringify(swing_setups));
  }
});

test('rule card keeps the same keyed rows through loading, stale data, errors and recovery', () => {
  const h = harness('AQTETerminal.tsx');
  const props = ruleProps(ruleSignal());
  const primary = panel => nodes(panel).find(n => n.props?.['aria-label'] === 'Key trading indicators');
  const rows = panel => nodes(primary(panel)).filter(n => n.type === 'li');
  const first = rulePanel(h.render(props));
  const ids = rows(first).map(row => row.props['data-rule']);
  const keys = panel => nodes(primary(panel)).filter(n => n.props?.check).map(n => n.key);
  const rowKeys = keys(first);
  assert.equal(rowKeys.length, 7);
  for (const [change, expected] of [
    [{ signal: undefined }, /^Current evidence unavailable$/],
    [{ signal: { ...props.signal, intelligence: undefined, reasons: ['Warming up: need 201 contiguous completed one-minute futures candles'],
      warmup: { completed: 87, required: 201 } } }, /^Warming up · 87\/201 candles$/],
    [{ signal: { ...props.signal, intelligence: null, reasons: ['Opening range: need 15 completed one-minute candles from 09:15 IST'],
      opening: { completed: 4, required: 15 } } }, /^Opening range · 4\/15 candles$/],
    [{ signal: { ...props.signal, feed_ready: false, intelligence: null, reasons: ['Outside regular market session'] } },
      /^Market closed · rules run 09:15–15:30 IST$/],
    [{ signal: { ...props.signal, feed_ready: false, reasons: ['Market data stale: futures last tick 9s ago'] } },
      /^Market data stale: futures last tick 9s ago$/],
    [{ signal: { ...props.signal, feed_ready: false, decision: 'BUY CE' } }, /^Current evidence unavailable$/],
    [{ signal: { ...props.signal, feed_ready: undefined } }, /^Backend freshness unavailable$/],
    [{ now: props.signal.at + 6 }, /^Current evidence unavailable$/],
    [{ unavailable: true }, /^Current evidence unavailable$/],
  ]) {
    const panel = rulePanel(h.render({ ...props, ...change }));
    assert.ok(primary(panel), 'Never replace the primary list with an empty-state paragraph');
    assert.deepEqual(rows(panel).map(row => row.props['data-rule']), ids);
    assert.deepEqual(keys(panel), rowKeys, 'Fresh and unavailable rows must have the same React keys');
    for (const row of rows(panel).filter(row => row.props['data-rule'] !== 'score')) {
      assert.equal(row.props['data-status'], 'UNAVAILABLE');
      assert.equal(text(nodes(row).find(n => n.type === 'strong')), '--');
    }
    assert.doesNotMatch(text(panel), /49\.03|1,01,000|5\s*\/\s*8/);
    assert.match(text(nodes(panel).find(n => n.props?.['aria-label'] === 'Rule alignment')).trim(), expected,
      'Say why evidence is blank using the backend governing WAIT reason');
    const details = nodes(panel).find(n => n.type === 'details');
    assert.equal(details.props.open, undefined, 'Polling must never control disclosure state');
  }
  const recovered = rulePanel(h.render(props));
  assert.deepEqual(keys(recovered), rowKeys);
  assert.match(text(primary(recovered)), /49\.03|\+1\.00%/);
  assert.equal(nodes(recovered).find(n => n.type === 'details').props.open, undefined);
});

test('rule colors distinguish buy, sell and waiting without confusing direction with entry approval', () => {
  const h = harness('AQTETerminal.tsx');
  const props = ruleProps(ruleSignal());
  const row = (panel, id) => nodes(panel).find(n => n.props?.['data-rule'] === id);
  const value = node => nodes(node).find(n => n.type === 'strong');
  let panel = rulePanel(h.render(props));
  const imbalance = row(panel, 'imbalance');
  assert.match(text(value(imbalance)), /Sell/);
  assert.match(value(imbalance).props.className, /\baqx-down\b/);
  assert.equal(imbalance.props['data-status'], 'PASS', 'Sell pressure can pass a PE entry check');
  assert.ok(nodes(imbalance).some(n => n.props?.className === 'aqx-check aqx-check-up'));
  assert.match(value(row(panel, 'supertrend')).props.className, /\baqx-up\b/);
  assert.equal(row(panel, 'supertrend').props['data-status'], 'FAIL');
  assert.ok(nodes(row(panel, 'supertrend')).some(n => n.props?.className === 'aqx-check aqx-check-wait'),
    'A failed entry check means wait, not a sell instruction');
  assert.match(value(row(panel, 'rsi')).props.className, /\baqx-wait\b/);
  props.signal.intelligence.imbalance = 0.25;
  panel = rulePanel(h.render(props));
  assert.match(text(value(row(panel, 'imbalance'))), /Buy/);
  assert.match(value(row(panel, 'imbalance')).props.className, /\baqx-up\b/);
  props.signal.intelligence.imbalance = 0;
  panel = rulePanel(h.render(props));
  assert.match(text(value(row(panel, 'imbalance'))), /Balanced/);
  assert.match(value(row(panel, 'imbalance')).props.className, /\baqx-wait\b/);
  panel = rulePanel(h.render({ ...props, unavailable: true }));
  assert.match(value(row(panel, 'imbalance')).props.className, /\baqx-flat\b/);
});

test('rule card reserves responsive value slots and a keyboard-accessible advanced scroll area', () => {
  const panel = rulePanel(harness('AQTETerminal.tsx').render(ruleProps(ruleSignal())));
  const details = nodes(panel).find(n => n.type === 'details');
  const body = nodes(details).find(n => n.props?.['aria-label'] === 'Advanced rule evidence');
  assert.ok(body);
  assert.equal(body.props.tabIndex, 0, 'The bounded advanced area must scroll with a keyboard');
  const css = readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8');
  assert.match(css, /\.aqte-theme \.aqx-engine \{[^}]*align-self: start;[^}]*container: aqxengine \/ inline-size/s);
  assert.match(css, /\.aqte-theme \.aqx-check-compact \{[^}]*grid-auto-rows: [\d.]+em/s);
  assert.match(css, /\.aqte-theme \.aqx-check-compact strong \{[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis/s);
  assert.match(css, /\.aqte-theme \.aqx-engine \{[^}]*font-variant-numeric: tabular-nums/s);
  assert.match(css, /\.aqte-theme \.aqx-evidence-body \{[^}]*block-size: [\d.]+rem;[^}]*overflow: auto;[^}]*scrollbar-gutter: stable/s);
  assert.match(css, /@container aqxengine \(max-width: 17em\)/);
});

test('live rule panel shows measured OI and exact PE checks instead of a misleading bullish all-clear', () => {
  const tree = harness('AQTETerminal.tsx').render(ruleProps(ruleSignal()));
  const panel = rulePanel(tree);
  const value = text(panel);
  assert.match(value, /Quick scalp.*PE.*5\s*\/\s*8/);
  assert.match(value, /1,01,000/);
  assert.match(value, /\+1,000.*\+1\.00%/);
  assert.match(value, /27\.08%.*2,708/);
  assert.match(value, /72\.92%.*7,292/);
  assert.match(value, /Closed 1m candle.*IST/);
  assert.match(value, /Live futures tick.*IST/);
  assert.doesNotMatch(value, /not provided|73\.00\s*\/\s*100/);
  const row = id => nodes(panel).find(n => n.props?.['data-rule'] === id);
  assert.equal(row('imbalance').props['data-status'], 'PASS', 'Seller pressure supports a PE setup');
  assert.equal(row('supertrend').props['data-status'], 'FAIL', 'Bullish SuperTrend opposes this PE setup');
  assert.equal(row('rsi').props['data-status'], 'FAIL', 'Neutral RSI does not qualify for PE');
  assert.equal(row('oi_change').props['data-status'], 'CONTEXT', 'Futures OI is not an invented option-chain gate');
  assert.match(row('rsi').props.title, /rsi threshold from backend/, 'The row explains its actual backend requirement');
  assert.match(value, /rsi threshold from backend/, 'Requirements are also available without hovering');
});

test('live rule panel distinguishes missing OI, missing baseline and a measured zero change', () => {
  const h = harness('AQTETerminal.tsx');
  const signal = ruleSignal();
  signal.intelligence.live.oi = null;
  signal.intelligence.live.oi_change = null;
  signal.intelligence.live.oi_change_pct = null;
  assert.match(text(rulePanel(h.render(ruleProps(signal)))), /Not supplied by Kite/);
  signal.intelligence.live.oi = 100000;
  signal.intelligence.live.oi_reference = null;
  signal.intelligence.live.oi_reference_at = null;
  assert.match(text(rulePanel(h.render(ruleProps(signal)))), /Waiting for a completed-minute OI reference/);
  Object.assign(signal.intelligence.live, { oi_reference: 100000, oi_reference_at: Math.floor(Date.now() / 60000) * 60,
    oi_change: 0, oi_change_pct: 0 });
  assert.match(text(rulePanel(h.render(ruleProps(signal)))), /0\s*\(0\.00%\)/);
  Object.assign(signal.intelligence.live, { oi: 15374515, oi_reference: 15374190, oi_change: 325,
    oi_change_pct: 325 / 15374190 * 100 });
  assert.match(text(rulePanel(h.render(ruleProps(signal)))), /\+325\s*\(\+0\.002114%\)/);
});

test('live rule panel hides stale values and never borrows a swing score when scalp or controller data is unavailable', () => {
  const h = harness('AQTETerminal.tsx');
  for (const patch of [{ feed_ready: false }, { feed_ready: undefined }, { at: Date.now() / 1000 - 6 }]) {
    const value = text(rulePanel(h.render(ruleProps({ ...ruleSignal(), ...patch }))));
    assert.doesNotMatch(value, /49\.03|1,01,000|73\.00|5\s*\/\s*8/);
    assert.match(value, /current|freshness|unavailable/i);
  }
  const signal = ruleSignal();
  signal.intelligence.live.at -= 6;
  let value = text(rulePanel(h.render(ruleProps(signal))));
  assert.doesNotMatch(value, /1,01,000|27\.08|5\s*\/\s*8/);
  assert.match(value, /Live depth\/OI unavailable/);
  const props = ruleProps(ruleSignal());
  props.liveStatus.generated_at -= 11;
  value = text(rulePanel(h.render(props)));
  assert.match(value, /Entry style unavailable/);
  assert.doesNotMatch(value, /73\.00|5\s*\/\s*8/);
});

test('rule values age out while no new snapshot response arrives', async () => {
  let now = Date.now();
  const h = harness('AQTESection.tsx', () => now);
  h.render();
  const snapshot = fixture();
  snapshot.data.NIFTY = ruleSignal();
  const cleanup = h.mount(snapshot);
  await settle();
  assert.match(text(rulePanel(h.render())), /1,01,000/);
  now += 6001;
  const timer = [...h.timers.entries()].find(([, value]) => value.delay === 1000);
  assert.ok(timer, 'A freshness clock must run independently of network polling');
  h.timers.delete(timer[0]);
  timer[1].fn();
  assert.doesNotMatch(text(rulePanel(h.render())), /1,01,000|49\.03/);
  assert.equal(h.requests.length, 1, 'No replacement snapshot was needed to expire the display');
  cleanup();
  assert.equal(h.timers.size, 0);
});

test('rule snapshot rejects malformed indicator evidence and accepts an unavailable volume ratio', async () => {
  const h = harness();
  h.render();
  const snapshot = fixture();
  snapshot.data.NIFTY = ruleSignal();
  const cleanup = h.mount(snapshot);
  await settle();
  assert.doesNotMatch(text(h.render()), /Invalid AQTE response/);
  for (const mutate of [
    s => { s.intelligence.ema = null; },
    s => { s.intelligence.live.oi = -1; },
    s => { s.intelligence.imbalance = 2; },
    s => { s.intelligence.rsi = 101; },
    s => { s.rule_checks.scalp.checks.pop(); },
    s => { s.rule_checks.scalp.checks[0].passed = 'yes'; },
  ]) {
    snapshot.data.NIFTY = ruleSignal();
    mutate(snapshot.data.NIFTY);
    await h.poll(snapshot);
    assert.match(text(h.render()), /Invalid AQTE response/);
  }
  snapshot.data.NIFTY = ruleSignal();
  snapshot.data.NIFTY.intelligence.volume_ratio = null;
  await h.poll(snapshot);
  assert.doesNotMatch(text(h.render()), /Invalid AQTE response/);
  cleanup();
});

test('mockup terminal shows waiting hero, explainable engine and real exit rules without invented targets', () => {
  const tree = harness('AQTETerminal.tsx').render({
    symbol: 'NIFTY', signal: fixture().data.NIFTY, unavailable: false, active: true, tick: null,
  });
  const value = text(tree);
  for (const title of ['STATUS UNAVAILABLE', 'NIFTY · Position status unverified', 'Entry', 'LTP', 'Stop Loss (SL)',
    'Trailing SL (TSL)', 'P&L', 'Targets', 'T1', 'Position', 'Trail & Hold', 'Exit Now', 'Signal',
    'Order Placed', 'Entry Filled', 'SL Protected', 'Trailing Active', 'Rule-Based Trade Engine', 'Auto Exit Rules',
    'Broker SL order', 'Session exit', '15:25 IST', 'Stale quote', 'Not a win probability']) {
    assert.ok(value.includes(title), title);
  }
  assert.equal(nodes(tree).filter(n => n.type === 'nav' || n.type === 'a').length, 0, 'No left sidebar');
  assert.doesNotMatch(value, /XGBoost|LSTM|Delta\s+0\.|Gamma\s+0\.|NIFTY_TEST_CE|LIVE TRADE/);
  assert.match(value, /T2\/T3 not configured/);
  assert.match(value, /booking needs multiple whole lots/);
  const buttons = nodes(tree).filter(n => n.type === 'button');
  assert.equal(buttons.length, 5);
  assert.ok(buttons.every(button => button.props.disabled), 'No trade action without confirmed live status');
});

test('entry readiness exposes the real WAIT reason and optional warm-up progress without claiming ML inference', () => {
  const h = harness('AQTETerminal.tsx');
  const signal = { ...fixture().data.BANKNIFTY,
    reasons: ['Warming up: need 201 contiguous completed one-minute futures candles'],
    warmup: { completed: 86, required: 201 } };
  const liveStatus = { ...liveFixture(), enabled: true, armed: true, automation_on: true };
  const props = { symbol: 'NIFTY', signal, liveStatus, unavailable: false, active: true, tick: null };
  let tree = h.render(props);
  const readiness = () => text(nodes(tree).find(n => n.props?.['aria-label'] === 'Entry readiness'));
  assert.match(readiness(), /Warming up: need 201 contiguous/);
  assert.match(readiness(), /Warm-up:\s+86\s*\/\s*201\s+consecutive completed futures candles/);
  assert.match(text(tree), /Rule-Based Trade Engine/);
  assert.match(text(tree), /No ML order decisions/);
  assert.doesNotMatch(text(tree), /AI Trade Engine/);
  assert.doesNotMatch(text(nodes(tree).find(n => n.props?.['aria-label'] === 'Trade prices')), /₹/);
  tree = h.render({ ...props, signal: { ...signal, warmup: undefined } });
  assert.match(readiness(), /Warming up: need 201 contiguous/);
  assert.doesNotMatch(readiness(), /Warm-up:/, 'Older backends do not get an invented progress count');
  tree = h.render({ ...props, unavailable: true });
  assert.match(readiness(), /Current signal data unavailable/);
  assert.doesNotMatch(readiness(), /86|Warming up/);
  tree = h.render({ ...props, liveStatus: { ...liveStatus, automation_on: false } });
  assert.match(readiness(), /Auto Trade OFF/);
  tree = h.render({ ...props, liveStatus: { ...liveStatus, active: livePositionFixture() } });
  assert.equal(readiness(), '', 'An open trade keeps its position/protection display, not a pre-entry notice');
});

test('scalp-style readiness shows scalp reasons, opening range and the last skipped entry check', () => {
  const h = harness('AQTETerminal.tsx');
  const signal = { ...fixture().data.BANKNIFTY, reasons: ['Opening range: need 15 completed one-minute candles from 09:15 IST'],
    warmup: { completed: 201, required: 201 }, opening: { completed: 7, required: 15 },
    scalp: { decision: 'WAIT', strategy: null, confidence: null, contract: null, entry: null,
      reasons: ['Breakout volume below 1.5x'] } };
  const liveStatus = { ...liveFixture(), enabled: true, armed: true, automation_on: true,
    styles: { NIFTY: 'scalp', BANKNIFTY: 'swing', SENSEX: 'scalp' },
    entry_note: 'NIFTY: Fresh broker ask/depth does not fit the approved no-chase limit' };
  const props = { symbol: 'NIFTY', signal, liveStatus, unavailable: false, active: true, tick: null };
  let tree = h.render(props);
  const readiness = () => text(nodes(tree).find(n => n.props?.['aria-label'] === 'Entry readiness'));
  assert.match(readiness(), /Quick scalp · Breakout volume below 1\.5x/);
  assert.match(readiness(), /Opening range:\s+7\s*\/\s*15\s+one-minute candles since 09:15 IST/);
  assert.match(readiness(), /Last entry check:\s+Fresh broker ask/);
  assert.doesNotMatch(readiness(), /Warm-up:/);
  tree = h.render({ ...props, liveStatus: { ...liveStatus, styles: { NIFTY: 'swing' } } });
  assert.match(readiness(), /Swing · Opening range: need 15/);
  tree = h.render({ ...props, symbol: 'SENSEX' });
  assert.doesNotMatch(readiness(), /Last entry check/, 'Another index note is not shown');
  tree = h.render({ ...props, liveStatus: { ...liveStatus, styles: undefined } });
  assert.match(readiness(), /^Opening range: need 15/, 'Older backends keep the main signal reasons');
});

test('daily control uses independent style checkboxes, saves both or neither and locks them while ON', async () => {
  const h = harness('AQTEDailyControl.tsx');
  h.render();
  const initial = dailyFixture();
  for (const row of Object.values(initial.data)) row.config.style = 'scalp';
  initial.data.NIFTY.opportunity = { decision: 'BUY CE', confidence: 75, strategy: 'quick_scalp_20',
    contract: { trading_symbol: 'NIFTY_TEST_CE' }, entry: { maximum: 101, stop: 93, target: 121, points: 20 },
    reasons: ['Quick scalp: target +20 / stop -8 premium points'] };
  const cleanup = h.mount(initial);
  await settle();
  let tree = h.render();
  const box = name => nodes(tree).find(n => n.props?.['aria-label'] === `Allow ${name} entries`);
  assert.equal(box('Quick scalp').props.checked, true);
  assert.equal(box('Swing').props.checked, false);
  assert.equal(nodes(tree).find(n => n.type === 'select' && n.props?.['aria-label'] === 'Entry style'), undefined);
  assert.match(text(tree), /quick scalp 20/);
  assert.match(text(tree), /\+20 pts/);
  assert.match(text(tree), /SL % and target multiple below apply to Swing only/);
  box('Swing').props.onChange({ target: { checked: true } });
  tree = h.render();
  assert.equal(box('Quick scalp').props.checked, true);
  assert.equal(box('Swing').props.checked, true);
  const saved = structuredClone(initial);
  saved.data.NIFTY.config.style = 'both';
  h.respond(saved);
  nodes(tree).find(n => n.type === 'button' && /Save NIFTY controls/.test(text(n))).props.onClick();
  await settle();
  const post = h.requests.find(r => r.options.method === 'POST');
  assert.equal(post.url, '/api/aqte/live/daily-controls');
  assert.equal(JSON.parse(post.options.body).config.style, 'both');
  tree = h.render();
  box('Quick scalp').props.onChange({ target: { checked: false } });
  tree = h.render();
  assert.equal(box('Swing').props.checked, true);
  box('Swing').props.onChange({ target: { checked: false } });
  tree = h.render();
  assert.equal(box('Quick scalp').props.checked, false);
  assert.equal(box('Swing').props.checked, false);
  saved.data.NIFTY.config.style = 'none';
  h.respond(saved);
  nodes(tree).find(n => n.type === 'button' && /Save NIFTY controls/.test(text(n))).props.onClick();
  await settle();
  assert.equal(JSON.parse(h.requests.filter(r => r.options.method === 'POST').at(-1).options.body).config.style, 'none');
  await h.poll({ ...saved, editable: false });
  tree = h.render();
  assert.equal(box('Quick scalp').props.disabled, true, 'Styles are locked while Auto Trade is ON');
  assert.equal(box('Swing').props.disabled, true);
  const legacy = dailyFixture();
  for (const row of Object.values(legacy.data)) delete row.config.style;
  await h.poll(legacy);
  tree = h.render();
  assert.equal(box('Quick scalp'), undefined, 'A backend without style support never receives the field');
  const invalid = dailyFixture();
  invalid.data.NIFTY.config.style = 'martingale';
  await h.poll(invalid);
  assert.match(text(h.render()), /Incomplete daily-control response/);
  cleanup();
});

test('all styles and setups display checked and save independently for NIFTY, BANKNIFTY and SENSEX', async () => {
  const initial = dailyFixture();
  for (const row of Object.values(initial.data)) {
    row.config.style = 'both';
    row.config.setups = { momentum_breakout: true, trend_continuation: true, liquidity_reversal: true, mean_reversion: true };
    row.opportunity.style = 'swing';
    row.opportunity.style_checks = { scalp: 'Quick-scalp rules no longer hold', swing: null };
  }
  const h = harness('AQTEDailyControl.tsx');
  h.render();
  const cleanup = h.mount(initial);
  await settle();
  let tree = h.render();
  for (const symbol of ['NIFTY', 'BANKNIFTY', 'SENSEX']) {
    nodes(tree).find(n => n.props?.['aria-label'] === 'Daily control index').props.onChange({ target: { value: symbol } });
    tree = h.render();
    for (const name of ['Quick scalp', 'Swing', 'Momentum breakout', 'Trend continuation', 'Liquidity-sweep reversal', 'Mean reversion']) {
      const box = nodes(tree).find(n => n.props?.['aria-label'] === `Allow ${name} entries`);
      assert.equal(box.type, 'input');
      assert.equal(box.props.type, 'checkbox');
      assert.equal(box.props.checked, true, `${symbol}: ${name}`);
    }
    assert.match(text(tree), /Swing\s*:\s*Rules and risk checks passed\s*· Selected for broker recheck/);
    h.respond(initial);
    nodes(tree).find(n => n.type === 'button' && /controls$/.test(text(n))).props.onClick();
    await settle();
    const body = JSON.parse(h.requests.filter(r => r.options.method === 'POST').at(-1).options.body);
    assert.equal(body.symbol, symbol);
    assert.equal(body.config.style, 'both');
    assert.deepEqual(body.config.setups, initial.data[symbol].config.setups);
    assert.equal(body.config.enabled, initial.data[symbol].config.enabled, 'Saving styles never enables an index');
    tree = h.render();
  }
  cleanup();
});

test('controller-selected styles drive the opportunity and none never falls back to scalp', () => {
  const display = displayModule();
  const signal = { ...ruleSignal(), decision: 'BUY CE', confidence: 85, strategy: 'momentum_breakout',
    contract: { trading_symbol: 'SWING_CONTRACT', expiry: '2026-11-05' },
    entry: { maximum: 100, stop: 90, target: 120, reward_risk: 2 },
    scalp: scalpSignal('BUY CE', 90) };
  const status = { ...liveFixture(), styles: { NIFTY: 'swing', BANKNIFTY: 'scalp', SENSEX: null },
    style_checks: { NIFTY: { scalp: 'No tier fits risk', swing: null }, SENSEX: {} } };
  assert.equal(display.isAqteLiveState(status), true);
  for (const style_checks of [{ NIFTY: { both: null } }, { NIFTY: { scalp: true } }, { OTHER: {} }, []]) {
    assert.equal(display.isAqteLiveState({ ...status, style_checks }), false);
  }
  assert.equal(display.aqteEffectiveSignal(signal, status.styles.NIFTY).contract.trading_symbol, 'SWING_CONTRACT');
  assert.equal(display.aqteEffectiveSignal(signal, status.styles.BANKNIFTY).contract.trading_symbol, 'NIFTY_SCALP_CE');
  assert.equal(display.aqteEffectiveSignal(signal, status.styles.SENSEX).decision, 'WAIT');
  assert.equal(display.aqteEffectiveSignal(signal, status.styles.SENSEX).entry, null);
  assert.deepEqual([...display.aqteRankKey(signal, null)], [0, 0, 0]);
  const panel = rulePanel(harness('AQTETerminal.tsx').render({
    ...ruleProps(signal), liveStatus: { ...status, styles: { NIFTY: null } },
  }));
  assert.match(text(panel), /No entry style selected in Controls/);
});

test('malformed scalp or opening-range evidence is rejected', async () => {
  for (const patch of [{ opening: { completed: 16, required: 15 } }, { scalp: null },
    { scalp: { decision: 'SELL', reasons: [], entry: null } },
    { scalp: { decision: 'BUY CE', reasons: ['x'], entry: { maximum: 101, stop: 93, target: 121 } } }]) {
    const h = harness();
    h.render();
    const invalid = fixture();
    Object.assign(invalid.data.NIFTY, patch);
    const cleanup = h.mount(invalid);
    await settle();
    assert.match(text(h.render()), /Invalid AQTE response/, JSON.stringify(patch));
    cleanup();
  }
});

test('malformed warm-up evidence is rejected while legacy snapshots without it remain supported', async () => {
  for (const warmup of [null, { completed: -1, required: 201 }, { completed: 202, required: 201 },
    { completed: '86', required: 201 }, { completed: 0, required: 0 }, { completed: 86.5, required: 201 }]) {
    const h = harness();
    h.render();
    const invalid = fixture();
    invalid.data.NIFTY.warmup = warmup;
    const cleanup = h.mount(invalid);
    await settle();
    assert.match(text(h.render()), /Invalid AQTE response/);
    await h.poll(fixture());
    assert.doesNotMatch(text(h.render()), /Invalid AQTE response/);
    cleanup();
  }
});

test('terminal hero uses only the matching live trade and fresh metrics, never paper-plan prices', () => {
  const h = harness('AQTETerminal.tsx');
  const live = liveFixture();
  live.active = { ...livePositionFixture(), symbol: 'NIFTY', filled: 15, entry_price: 102.5, stop: 110, initial_stop: 90,
    target: 140, peak: 125, protection_confirmed: false, trailing_active: true, trail_start_r: 2,
    entry_id: 'ORDER1', contract: { trading_symbol: 'NIFTY_REAL_CE' }, metrics: positionFixture().metrics };
  let exits = 0;
  const props = { symbol: 'NIFTY', signal: fixture().data.NIFTY, unavailable: false, active: true,
    tick: null, liveStatus: live, onExit: () => { exits += 1; } };
  let tree = h.render(props);
  let hero = nodes(tree).find(n => n.props?.id === 'aqte-terminal-NIFTY-overview');
  assert.match(text(hero), /LIVE TRADE/);
  assert.match(text(hero), /NIFTY_REAL_CE/);
  assert.match(text(hero), /102.50/);
  assert.match(text(hero), /121.00/);
  assert.match(text(hero), /\+20.00\s+pts/);
  assert.match(text(hero), /Protection unverified/);
  assert.match(text(hero), /Last ₹110.00/, 'Last stop is not shown as confirmed protection');
  assert.doesNotMatch(text(hero), /Broker-confirmed SL|NIFTY_TEST_CE|BUY CE|profit locked/);
  const exit = nodes(tree).find(n => n.type === 'button' && /Exit Now/.test(text(n)));
  assert.ok(!exit.props.disabled);
  exit.props.onClick();
  assert.equal(exits, 1);
  live.active.protection_confirmed = true;
  tree = h.render(props);
  assert.match(text(tree), /Broker-confirmed SL/);
  assert.doesNotMatch(text(tree), /profit locked/);
  live.active.metrics = { ...live.active.metrics, stale: true };
  tree = h.render(props);
  assert.doesNotMatch(text(tree), /121.00|255.05/);
  assert.match(text(tree), /102.50/);
  tree = h.render({ ...props, symbol: 'BANKNIFTY' });
  assert.doesNotMatch(text(tree), /NIFTY_REAL_CE|102.50|110.00/);
});

test('overview keeps concise readable values without placeholder explanations', () => {
  const tree = harness('AQTETerminal.tsx').render({
    symbol: 'SENSEX', unavailable: true, active: true, tick: null,
  });

  test('AQTE typography stays readable without shrinking mobile labels', () => {
    const styles = readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8');
    assert.match(styles, /\.aqte-theme \{ font-size: 0\.875rem; line-height: 1\.6; \}/);
    assert.match(styles, /\.aqte-theme #aqte-title \{[^}]*font-size: clamp\(1\.125rem, 1\.5cqw, 1\.5rem\)/);
    assert.match(styles, /\.aqte-theme \.aqte-position-cell dd \{ font-size: 1rem; \}/);
    assert.match(styles, /\.aqte-theme \.aqte-overview-tile \.aqte-hero-value \{\s*font-size: 1\.5rem; font-weight: 700/);
    assert.match(styles, /font-family: var\(--font-inter\), 'Segoe UI', sans-serif; letter-spacing: normal/);
    assert.match(styles, /@container \(max-width: 380px\) \{\s*\.aqte-theme \.aqte-overview-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  });

  test('broker metrics have individual light-green bordered tiles within a matching panel', () => {
    const tree = harness('AQTEBrokerPositions.tsx').render({ selectedSymbol: 'SENSEX' });
    assert.match(tree.props.className, /aqte-broker-panel/);
    const styles = readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8');
    assert.match(styles, /\.aqte-theme \.aqte-broker-panel \.aqte-position-table \{\s*gap: 8px; padding: 10px/);
    assert.match(styles, /\.aqte-theme \.aqte-broker-panel \.aqte-position-cell \{\s*border: 1px solid rgb\(134 239 172 \/ 0\.35\); border-radius: 8px/);
  });
  const hero = nodes(tree).find(n => n.props?.id === 'aqte-terminal-SENSEX-overview');
  const prices = nodes(hero).find(n => n.props?.['aria-label'] === 'Trade prices');
  const values = nodes(prices).filter(n => n.type === 'dd').map(n => text(n).trim());
  assert.deepEqual(values, ['--', '--', '--', '--']);
  assert.match(text(tree), /Waiting for current backend evidence/);
  assert.doesNotMatch(text(tree), /See real execution below|SEE BELOW|Real · gated|Broker ✓/);
  assert.doesNotMatch(text(hero), /Rule score/);
  const score = nodes(rulePanel(tree)).find(n => n.props?.['data-rule'] === 'score');
  assert.equal(text(nodes(score).find(n => n.type === 'strong')), '--');
  const styles = readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8');
  assert.match(styles, /AQTE ∞ terminal \(aqx\)/);
  assert.match(styles, /\.aqte-theme \.aqx-price-row \{/);
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
  assert.match(value, /Broker offline/);
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
  const tabs = nodes(tree).filter(n => n.props?.role === 'tab');
  assert.equal(tabs.length, 14);
  for (const tab of tabs) {
    const id = tab.props.id;
    assert.match(tab.props.className, id.startsWith('aqte-index-tab-') ? /\baqte-rich-tab\b/ : id.startsWith('aqte-ctab-') ? /\baqx-ctab\b/ : /\baqx-book-tab\b/);
    assert.ok(typeof tab.props['aria-selected'] === 'boolean');
    assert.ok(tab.props.onKeyDown);
  }
  const lists = nodes(tree).filter(n => n.props?.role === 'tablist');
  assert.match(lists.find(n => n.props['aria-label'] === 'AQTE index').props.className, /\baqte-rich-tabs\b/);
  assert.match(lists.find(n => n.props['aria-label'] === 'AQTE trade book').props.className, /\baqx-book-tabs\b/);
  assert.match(lists.find(n => n.props['aria-label'] === 'Analytics view').props.className, /\baqx-ctabs\b/);
});

test('trade book tabs support arrow, Home and End keys and show one panel', () => {
  const h = harness();
  h.render();
  let focused;
  const order = ['active', 'today', 'positions', 'performance', 'controls'];
  for (const [from, key, expected] of [
    ['active', 'ArrowLeft', 'controls'], ['controls', 'ArrowRight', 'active'],
    ['active', 'End', 'controls'], ['controls', 'Home', 'active'], ['active', 'ArrowRight', 'today'],
  ]) {
    const tab = nodes(h.render()).find(n => n.props?.id === `aqte-book-tab-${from}`);
    tab.props.onKeyDown({ key, preventDefault() {}, currentTarget: { parentElement: { querySelectorAll: () =>
      order.map(name => ({ focus() { focused = name; } })),
    } } });
    assert.equal(focused, expected);
    const tree = h.render();
    assert.equal(nodes(tree).find(n => n.props?.id === `aqte-book-tab-${expected}`).props['aria-selected'], true);
    const visible = nodes(tree).filter(n => n.props?.id?.startsWith('aqte-book-') && n.props.role === 'tabpanel' && !n.props.hidden);
    assert.deepEqual(visible.map(n => n.props.id), [`aqte-book-${expected}`]);
  }
});

test('market badge requires the selected AQTE feed, not just a fresh dashboard spot price', async () => {
  for (const [at, connected, age, expected] of [
    ['2026-10-30T09:15:00+05:30', true, 0, 'LIVE (Zerodha)'],
    ['2026-10-30T10:00:00+05:30', false, 0, 'FEED OFF'],
    ['2026-10-30T10:00:00+05:30', true, 10, 'FEED OFF'],
    ['2026-10-30T15:30:00+05:30', true, 0, 'CLOSED'],
    ['2026-10-31T10:00:00+05:30', true, 0, 'CLOSED'],
  ]) {
    const now = Date.parse(at);
    const h = harness('AQTESection.tsx', now);
    const props = { isConnected: connected, marketData: {
      NIFTY: { price: 23000, status: 'LIVE', timestamp: new Date(now - age * 1000).toISOString() },
    } };
    h.render(props);
    const snapshot = fixture();
    snapshot.generated_at = now / 1000;
    snapshot.data.NIFTY.at = now / 1000;
    snapshot.data.NIFTY.feed_ready = true;
    const cleanup = h.mount(snapshot);
    await settle();
    let tree = h.render(props);
    const badge = nodes(tree).find(n => n.props?.['aria-label'] === 'AQTE view status');
    const title = nodes(tree).find(n => n.props?.id === 'aqte-title');
    if (expected === 'CLOSED') {
      assert.equal(badge, undefined);
      assert.doesNotMatch(text(title), /CLOSED/);
      assert.match(text(title), /Trading Engine\s*$/);
      cleanup();
      continue;
    }
    assert.equal(text(badge).trim(), expected);
    assert.equal(nodes(title).find(n => n.props?.['aria-label'] === 'AQTE view status'), badge);
    assert.match(text(title), /Trading Engine\s+(LIVE \(Zerodha\)|FEED OFF)$/);
    assert.match(badge.props.className, expected === 'FEED OFF' ? /text-amber/ : /text-emerald/);
    snapshot.data.NIFTY.at -= 100;
    await h.poll(snapshot);
    tree = h.render(props);
    assert.equal(text(nodes(tree).find(n => n.props?.['aria-label'] === 'AQTE view status')).trim(), 'FEED OFF');
    snapshot.data.NIFTY.at = now / 1000;
    snapshot.data.NIFTY.feed_ready = false;
    await h.poll(snapshot);
    tree = h.render(props);
    assert.equal(text(nodes(tree).find(n => n.props?.['aria-label'] === 'AQTE view status')).trim(), 'FEED OFF');
    cleanup();
  }
});

test('terminal reports backend rule/risk blockers rather than implying a buy setup is ready', () => {
  const h = harness('AQTETerminal.tsx');
  const props = { symbol: 'NIFTY', signal: fixture().data.NIFTY, unavailable: false, active: true, tick: null,
    liveStatus: { ...liveFixture(), armed: true, automation_on: true,
      entry_blocks: { NIFTY: 'One lot exceeds live per-trade risk limit' } } };
  const tree = h.render(props);
  assert.match(text(nodes(tree).find(n => n.props?.['aria-label'] === 'Entry readiness')), /per-trade risk limit/);
});

test('AQTE title wraps within a shrinkable column and keeps the status badge together', () => {
  const styles = readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8');
  assert.match(styles, /\.aqte-theme \.aqte-heading \{\s*display: grid; grid-template-columns: 44px minmax\(0, 1fr\); align-items: start/);
  assert.match(styles, /grid-template-columns: 32px minmax\(0, 1fr\); gap: 8px/);
  assert.match(styles, /\.aqte-theme #aqte-title \{[^}]*white-space: normal; word-break: normal; overflow-wrap: anywhere/s);
  assert.match(styles, /\.aqte-theme \.aqte-view-status \{[^}]*white-space: nowrap/s);
  assert.doesNotMatch(styles, /\.aqte-theme \.aqte-heading \{[^}]*padding-right:/);
});

test('AQTE defaults to Real Trade without submitting or exposing paper trades', async () => {
  const h = harness();
  let tree = h.render();
  assert.match(text(tree), /Real Trade.*Auto/);
  assert.match(nodes(tree).find(n => n.props?.id === 'aqte-real-view').props.className, /sr-only/);
  assert.doesNotMatch(text(tree), /Paper trading disabled.*Automation defaults OFF/);
  assert.equal(nodes(tree).filter(n => n.props?.id === 'aqte-tab-paper').length, 0);
  const cleanup = h.mount(fixture());
  await settle();
  tree = h.render();
  assert.match(text(tree), /STATUS UNAVAILABLE/);
  assert.doesNotMatch(text(tree), /BUY CE|NIFTY_TEST_CE|Paper realized P&L|LIVE TRADE/);
  assert.ok(h.requests.every(request => !request.options.method || request.options.method === 'GET'));
  cleanup();
});

test('AQTE has three index cards and disables trade actions while live status is unknown', async () => {
  const h = harness();
  let tree = h.render();
  assert.equal(nodes(tree).filter(n => n.props?.id?.startsWith('aqte-index-tab-')).length, 3);
  assert.deepEqual(nodes(tree).filter(n => n.props?.id?.startsWith('aqte-book-tab-')).map(text),
    ['Active Trades (--)', "Today's Trades (--)", 'Positions', 'Performance', 'Controls']);
  assert.equal(nodes(tree).filter(n => ['input', 'select'].includes(n.type)).length, 0);
  // Engine deck filters, rule-detail toggles and dashboard navigation are view-only, not trade actions.
  const deckControl = n => n.type === 'button' && /aqx-deck-filter|aqx-eng-card/.test(String(n.props?.className));
  const viewOnly = n => n.type === 'button' && /\baqx-viewonly\b/.test(String(n.props?.className));
  const actions = nodes(tree).filter(n => n.type === 'button' && n.props.role !== 'tab' && !deckControl(n) && !viewOnly(n));
  assert.equal(actions.length, 15);
  assert.equal(nodes(tree).filter(deckControl).length, 17);
  assert.ok(nodes(tree).filter(viewOnly).every(n => !/Exit|Flatten|Kill|Buy|Sell|Confirm/i.test(text(n))), 'Navigation never trades');
  assert.ok(actions.every(n => n.props.disabled), 'Trade actions need a confirmed matching live position');
  const summary = nodes(tree).find(n => n.props?.['aria-label'] === 'Today summary');
  for (const label of ['Today P&L', 'Win Rate', 'Trades', 'Risk']) assert.ok(text(summary).includes(label), label);
  assert.match(text(summary), /--/, 'No fabricated P&L before live status loads');
  assert.match(text(tree), /Adaptive Quantitative Trading Engine/);
  const cleanup = h.mount(fixture());
  await settle();
  tree = h.render();
  const cards = nodes(tree).filter(n => n.props?.id?.startsWith('aqte-index-tab-'));
  assert.match(text(cards[1]), /BANK NIFTY/);
  for (const card of cards) assert.doesNotMatch(text(card), /NIFTY_TEST_CE|BUY CE/);
  assert.doesNotMatch(text(tree), /Backend analysis · Gated real execution only|Execution notes/);
  cleanup();
  assert.equal(h.timers.size, 0);
});

test('connection failure reports unavailable analysis and successful retry recovers without paper entries', async () => {
  const h = harness();
  h.render();
  const cleanup = h.mount(fixture());
  await settle();
  assert.doesNotMatch(text(h.render()), /BUY CE|NIFTY_TEST_CE/);
  await h.poll(new Error('Backend refused'));
  assert.doesNotMatch(text(h.render()), /BUY CE|NIFTY_TEST_CE/);
  assert.match(text(h.render()), /Backend refused/);
  await h.poll(fixture());
  assert.doesNotMatch(text(h.render()), /Backend refused|BUY CE|NIFTY_TEST_CE/);
  cleanup();
});

test('a brief browser network drop keeps the confirmed view, then reports reconnecting without blaming auto trade', async () => {
  let clock = Date.now();
  const h = harness('AQTESection.tsx', () => clock);
  h.render();
  const cleanup = h.mount(fixture());
  await settle();
  await h.poll(new TypeError('Failed to fetch'));
  assert.doesNotMatch(text(h.render()), /Server not reachable|Failed to fetch/);
  clock += 11_000;
  await h.poll(new TypeError('Failed to fetch'));
  const value = text(h.render());
  assert.match(value, /Server not reachable from this browser/);
  assert.match(value, /Server-side auto trade does not depend on this page/);
  clock = Date.now();
  await h.poll(fixture());
  assert.doesNotMatch(text(h.render()), /Server not reachable/);
  cleanup();
  assert.equal([...h.timers.values()].filter(t => t.delay === 2000).length, 0);
});

test('AQTE polling re-runs at once when the tab, focus or network comes back', async () => {
  const code = ts.transpileModule(readFileSync(path.join(__dirname, '..', 'lib', 'aqte-display.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const listeners = {};
  const on = (event, fn) => { listeners[event] = fn; };
  const off = event => { delete listeners[event]; };
  const document = { visibilityState: 'hidden', addEventListener: on, removeEventListener: off };
  const window = { addEventListener: on, removeEventListener: off };
  const exports = {};
  vm.runInNewContext(code, { exports, Intl, Date, setTimeout, clearTimeout, document, window });
  let runs = 0;
  const stop = exports.aqtePollLoop(async () => { runs++; }, 60_000);
  await settle();
  assert.equal(runs, 1);
  listeners.visibilitychange();
  await settle();
  assert.equal(runs, 1, 'hidden tab does not trigger an extra poll');
  document.visibilityState = 'visible';
  listeners.visibilitychange();
  await settle();
  assert.equal(runs, 2);
  listeners.online();
  await settle();
  assert.equal(runs, 3);
  stop();
  assert.deepEqual(Object.keys(listeners), []);
  assert.equal(exports.aqteConnectionDrop(new TypeError('Failed to fetch')), true);
  assert.equal(exports.aqteConnectionDrop(Object.assign(new Error('aborted'), { name: 'AbortError' })), true);
  assert.equal(exports.aqteConnectionDrop(new Error('Explicit live-control intent header required')), false);
  assert.equal(exports.aqteConnectionDrop(new TypeError('Cannot read properties of null')), false);
});

test('underlying price follows the shared live feed immediately without waiting for AQTE polling', async () => {
  const h = harness();
  h.render();
  const cleanup = h.mount(fixture());
  await settle();
  const tick = { price: 23111.25, timestamp: new Date().toISOString(), status: 'LIVE',
    change: 111.25, changePercent: 0.48 };
  const props = { isConnected: true, marketData: { NIFTY: tick, BANKNIFTY: null, SENSEX: null } };
  const card = tree => nodes(tree).find(n => n.props?.id === 'aqte-index-tab-NIFTY');
  let first = card(h.render(props));
  assert.match(text(first), /23,111.25/);
  assert.match(text(first), /\+111.25 \(\+0.48%\)/);
  first = card(h.render({ ...props, marketData: { ...props.marketData, NIFTY: {
    ...tick, price: 23112.75, timestamp: new Date().toISOString(),
  } } }));
  assert.match(text(first), /23,112.75/);
  assert.equal(h.requests.length, 1, 'Streaming changes must not fetch snapshots or open another feed');
  const panel = nodes(h.render(props)).find(n => n.props?.id === 'aqte-index-panel-NIFTY');
  assert.match(text(panel), /STATUS UNAVAILABLE/, 'Streaming prices must not authorize real entries');
  assert.doesNotMatch(text(panel), /LIVE TRADE|BUY CE/);
  for (const change of [
    { isConnected: false },
    { marketData: { ...props.marketData, NIFTY: { ...tick, status: 'DEMO' } } },
    { marketData: { ...props.marketData, NIFTY: { ...tick, timestamp: new Date(Date.now() - 15000).toISOString() } } },
    { marketData: { ...props.marketData, NIFTY: { ...tick, price: NaN } } },
  ]) {
    const value = text(card(h.render({ ...props, ...change })));
    assert.doesNotMatch(value, /LIVE FEED|23,111.25|111.25/);
    assert.match(value, /AQTE SNAPSHOT/);
  }
  cleanup();
});

test('index cards show the official close after hours without unlocking live gating', async () => {
  const now = Date.parse('2026-11-02T18:00:00+05:30');
  const h = harness('AQTESection.tsx', now);
  h.render();
  const snapshot = fixture();
  snapshot.generated_at = now / 1000;
  const cleanup = h.mount(snapshot);
  await settle();
  const closed = { price: 23331.1, change: 278, changePercent: 1.21, status: 'CLOSED', timestamp: '2026-11-02T15:25:54+05:30' };
  const card = tree => nodes(tree).find(n => n.props?.id === 'aqte-index-tab-NIFTY');
  let tree = h.render({ isConnected: true, marketData: { NIFTY: closed, BANKNIFTY: null, SENSEX: null } });
  const value = text(card(tree));
  assert.match(value, /23,331.10/);
  assert.match(value, /\+278.00 \(\+1.21%\)/);
  assert.equal(text(nodes(card(tree)).find(n => n.props?.className === 'aqx-index-tag')), 'Closed');
  assert.doesNotMatch(text(nodes(tree).find(n => n.props?.['aria-label'] === 'System health')), /Live|\d+ ms/,
    'A closed tick must not be reported as a live feed');
  for (const status of ['DEMO', 'OFFLINE', 'LIVE']) {
    tree = h.render({ isConnected: true, marketData: { NIFTY: { ...closed, status }, BANKNIFTY: null, SENSEX: null } });
    assert.doesNotMatch(text(card(tree)), /23,331.10|Closed/, `${status} ticks after hours must not be shown`);
  }
  tree = h.render({ isConnected: true, marketData: { NIFTY: { ...closed, price: 0 }, BANKNIFTY: null, SENSEX: null } });
  assert.doesNotMatch(text(card(tree)), /Closed/);
  cleanup();
});

test('index cards explain a missing quote instead of claiming a snapshot', async () => {
  for (const [at, expected] of [['2026-11-02T18:00:00+05:30', /MARKET CLOSED/], ['2026-11-02T10:00:00+05:30', /WAITING FOR LIVE FEED/]]) {
    const now = Date.parse(at);
    const h = harness('AQTESection.tsx', now);
    h.render();
    const snapshot = fixture();
    snapshot.generated_at = now / 1000;
    for (const symbol of ['NIFTY', 'BANKNIFTY', 'SENSEX']) snapshot.data[symbol].spot = null;
    const cleanup = h.mount(snapshot);
    await settle();
    const value = text(nodes(h.render()).find(n => n.props?.id === 'aqte-index-tab-NIFTY'));
    assert.match(value, /No live quote/);
    assert.match(value, expected);
    assert.doesNotMatch(value, /SNAPSHOT/);
    cleanup();
  }
  const h = harness();
  const value = text(nodes(h.render()).find(n => n.props?.id === 'aqte-index-tab-NIFTY'));
  assert.match(value, /No live quote\s*AQTE OFFLINE/);
});

test('tick age uses the wall clock at render instead of the one-second UI clock', async () => {
  let clock = Date.now();
  const h = harness('AQTESection.tsx', () => clock);
  h.render();
  const snapshot = fixture();
  const at = Date.parse('2026-10-30T10:00:00+05:30');
  clock = at;
  snapshot.generated_at = at / 1000;
  snapshot.data.NIFTY.at = at / 1000;
  snapshot.data.NIFTY.feed_ready = true;
  const cleanup = h.mount(snapshot);
  await settle();
  h.render();
  clock = at + 640;
  const tick = { price: 23000, status: 'LIVE', timestamp: new Date(at + 400).toISOString() };
  const health = nodes(h.render({ isConnected: true, marketData: { NIFTY: tick } }))
    .find(n => n.props?.['aria-label'] === 'System health');
  assert.match(text(health), /Tick age\s*240 ms/);
  cleanup();
});

test('market context colours a zero VIX change as flat and explains each value source', () => {
  const h = harness();
  const tree = h.render();
  const tiles = nodes(tree).filter(n => n.props?.className === 'aqx-context-tile');
  assert.equal(tiles.length, 5);
  for (const tile of tiles) assert.match(tile.props.title, /\S+/);
  assert.match(tiles[0].props.title, /shows -- until AQTE has live data/);
});

test('market context VIX change tone is numeric: zero is flat, negative is down', async () => {
  for (const [change, expected, shown] of [[0, 'aqx-flat', /\(0\.00%\)/], [-0.8, 'aqx-down', /\(-0\.80%\)/], [1.5, 'aqx-up', /\(\+1\.50%\)/]]) {
    const h = harness();
    h.render();
    const snapshot = fixture();
    snapshot.data.NIFTY = { ...snapshot.data.NIFTY, ...engineSet({ ce: 3 }) };
    snapshot.data.NIFTY.market = { ...snapshot.data.NIFTY.market, vix_change_pct: change };
    const cleanup = h.mount(snapshot);
    await settle();
    const tile = nodes(h.render()).filter(n => n.props?.className === 'aqx-context-tile')[4];
    const small = nodes(tile).find(n => n.type === 'small');
    assert.equal(small.props.className, expected);
    assert.match(text(tile).replace(/\s+/g, ''), shown);
    cleanup();
  }
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
  assert.match(text(tree), /STATUS UNAVAILABLE/);
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
  assert.equal(nodes(tree).filter(n => n.props?.id?.startsWith('aqte-index-tab-')).length, 3);
  assert.equal(nodes(tree).filter(n => /paper/i.test(n.props?.id ?? '')).length, 0);
});

test('terminal presentation has per-index hero cards, engine and exit-rule panels without extra controls', async () => {
  const h = harness();
  h.render();
  const cleanup = h.mount(fixture());
  await settle();
  const tree = h.render();
  const heroes = nodes(tree).filter(n => n.type === 'article');
  assert.equal(heroes.length, 3);
  for (const [index, symbol] of ['NIFTY', 'BANKNIFTY', 'SENSEX'].entries()) {
    assert.match(heroes[index].props.className, /\baqx-hero\b/);
    assert.equal(heroes[index].props.id, `aqte-terminal-${symbol}-overview`);
    const aside = nodes(tree).find(n => n.props?.id === `aqte-terminal-${symbol}-risk`);
    assert.match(text(aside), /Rule-Based Trade Engine/);
    assert.match(text(aside), /Auto Exit Rules\s+UNKNOWN/, 'Unknown protection must not be shown as OFF');
  }
  for (const symbol of ['NIFTY', 'BANKNIFTY', 'SENSEX']) {
    assert.match(nodes(tree).find(n => n.props?.id === `aqte-index-tab-${symbol}`).props.className, new RegExp(`aqte-tab-${symbol}`));
  }
  assert.equal(nodes(tree).filter(n => n.type === 'button' && !/aqx-deck-filter|aqx-eng-card|aqx-viewonly/.test(String(n.props?.className))).length,
    23, '3 index tabs, 5 book tabs, 15 gated trade actions');
  cleanup();
});

function liveFixture() {
  return {
    generated_at: Date.now() / 1000, daily_counts: { executed: 0, reserved: 0 },
    enabled: false, expected_ip: '122.177.245.101',
    ready: true, armed: false, automation_on: false, killed: false, flatten_pending: false, error: null, preflight: null,
    limits: { risk_per_trade: 500, daily_loss: 2000, max_trades: 5, max_losses: 3, max_lots: 1 },
    active: null, trades: [],
  };
}

function livePositionFixture(overrides = {}) {
  return {
    id: '0123456789abcdef', symbol: 'NIFTY', state: 'PROTECTED', filled: 15, exited: 0,
    entry_price: 100, entry_at: Date.now() / 1000 - 60, fill_at: Date.now() / 1000 - 58,
    signal_at: Date.now() / 1000 - 65, entry_ack_at: Date.now() / 1000 - 59,
    limit: 100, initial_stop: 80, stop: 105, target: 140, peak: 125, trailing_active: true,
    protection_confirmed: true, metrics: positionFixture().metrics,
    contract: { trading_symbol: 'NIFTY_POSITION_CE', lot_size: 15 },
    entry_id: 'entry-test', protect_id: 'stop-test', error: null, ...overrides,
  };
}
const autoSwitch = tree => nodes(tree).find(n => n.type === 'button' && n.props.className?.startsWith('aqte-auto-switch '));

function positionFixture() {
  return {
    mode: 'paper', contract: 'NIFTY_POSITION_CE', state: 'OPEN', entry: 100,
    entryAt: 1793347200, limit: 100, initialStop: 80, stop: 105, target: 140,
    peak: 125, trailing: true, unavailable: false,
    metrics: { quantity: 15, quote_at: Date.now() / 1000, stale: false, ltp: 121, bid: 120,
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
    for (const label of ['STATUS UNAVAILABLE', 'Entry', 'LTP', 'Stop Loss (SL)', 'Trailing SL (TSL)',
      'Targets', 'Position', 'Trail & Hold', 'Exit Now']) {
      assert.ok(value.includes(label), label);
    }
    assert.match(value, /--/);
    assert.doesNotMatch(value, /Limit|LIVE TRADE|ORDER PENDING|WAITING FOR \+1R|Paper position|NIFTY_TEST_CE/);
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

test('live controller publishes status without recreating the removed safety panel on success or failure', async () => {
  for (const response of [liveFixture(), new Error('Offline')]) {
    const h = harness('AQTELiveController.tsx');
    const published = [];
    const props = { onStatus: status => published.push(status) };
    h.render(props);
    const cleanup = h.mount(response);
    await settle();
    assert.equal(text(h.render(props)).trim(), '');
    assert.equal(nodes(h.render(props)).filter(n => typeof n.type === 'string').length, 0);
    assert.equal(published.length, 1);
    assert.equal(published[0], response instanceof Error ? null : response);
    assert.ok(h.requests.every(r => r.options.method === 'GET' && r.url.endsWith('/live/status')));
    cleanup();
    assert.equal(h.timers.size, 0);
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

test('explanatory text stays collapsed and the removed safety/setup panel leaves no wrapper', () => {
  const position = harness('AQTEPosition.tsx').render(positionFixture());
  const calculation = nodes(position).find(n => n.type === 'details');
  assert.ok(calculation);
  assert.ok(!calculation.props.open);
  assert.match(text(calculation), /sufficient depth/);
  assert.doesNotMatch(text(calculation), /Buy entry price|Initial stop loss|Trailing stop loss/);
  const section = harness().render();
  for (const detail of nodes(section).filter(n => n.type === 'details')) assert.ok(!detail.props.open);
  assert.doesNotMatch(text(section), /Safety & emergency|Live setup|Emergency stop · close all|Reset emergency stop/);
  assert.ok(!nodes(section).some(n => n.props?.id === 'aqte-live-execution'));
  assert.equal(nodes(section).filter(n => n.props?.onStatus && 'exitRequest' in n.props).length, 1);
  const styles = readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8');
  assert.doesNotMatch(styles, /\.aqx-safety\b/);
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
  assert.match(styles, /\.aqte-theme :is\(p, h2, h3, h4, dt, dd, summary, label, output\) \{ overflow-wrap: anywhere; \}/);
  assert.match(styles, /@container \(max-width: 900px\)/);
  assert.match(styles, /@container \(max-width: 300px\)/);
  assert.match(styles, /\.aqte-theme \.aqte-daily-label[\s\S]*?grid-column: 1 \/ -1/);
  assert.match(section.props.className, /border-slate-600/);
  assert.doesNotMatch(section.props.className, /overflow-hidden/);
  for (const tab of nodes(tree).filter(n => n.props?.role === 'tab')) {
    assert.match(tab.props.className, /min-w-0/);
    assert.match(tab.props.className, /min-h-\[(44|48)px\]/);
  }
  const automation = harness('AQTEAutomationSwitch.tsx').render();
  const control = autoSwitch(automation);
  assert.equal(control.props.disabled, true);
  assert.match(styles, /\.aqte-theme \.aqte-auto-switch \{[^}]*min-height: 44px; max-width: 100%/s);
  assert.match(styles, /\.aqte-theme \.aqte-auto-switch-label \{[^}]*font-size: 14px/s);
  const live = harness('AQTELiveController.tsx');
  live.render();
  const status = { ...liveFixture(), active: livePositionFixture() };
  const cleanup = live.mount(status);
  await settle();
  const props = { exitRequest: { tradeId: status.active.id, contract: status.active.contract.trading_symbol, quantity: 15, action: 'exit' } };
  live.render(props);
  const dialog = nodes(live.render(props)).find(n => n.props?.role === 'alertdialog');
  assert.ok(dialog);
  for (const button of nodes(dialog).filter(n => n.type === 'button')) assert.match(button.props.className, /min-h-\[44px\]/);
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
  const h = harness('AQTELiveController.tsx');
  let liveStatus;
  h.render({ onStatus: status => { liveStatus = status; } });
  const payload = { ...liveFixture(), active: livePositionFixture() };
  const cleanup = h.mount(payload);
  await settle();
  const terminal = symbol => text(harness('AQTETerminal.tsx').render({
    symbol, liveStatus, active: true, unavailable: false, tick: null,
  }));
  assert.equal(liveStatus.active, payload.active);
  assert.match(terminal('NIFTY'), /\+₹255\.05/);
  const otherIndex = terminal('BANKNIFTY');
  assert.doesNotMatch(otherIndex, /NIFTY_POSITION_CE|255\.05/);
  assert.match(terminal('NIFTY'), /\+₹255\.05/);
  assert.equal(h.requests.length, 1);
  await h.poll({ __httpStatus: 503, __body: { detail: 'Offline' } });
  assert.equal(liveStatus.connection_error, 'Offline');
  assert.equal(liveStatus.active, payload.active);
  assert.match(terminal('NIFTY'), /POSITION UNVERIFIED/);
  assert.doesNotMatch(terminal('NIFTY'), /\+₹255\.05/);
  cleanup();
  assert.equal(h.timers.size, 0);
});

test('real controller remains read-only until a selected exit is explicitly confirmed', async () => {
  const h = harness('AQTELiveController.tsx');
  h.render();
  const cleanup = h.mount(liveFixture());
  await settle();
  const tree = h.render();
  assert.equal(text(tree).trim(), '');
  assert.equal(nodes(tree).filter(n => n.type === 'button').length, 0);
  assert.ok(h.requests.every(r => r.options.method === 'GET'));
  assert.equal(h.requests[0].options.headers['X-AQTE-Intent'], 'manual-live-control');
  assert.equal(h.requests[0].options.credentials, 'include');
  cleanup();
});

test('shared production is visibly identified without sending any order commands', async () => {
  const h = harness('AQTEAutomationSwitch.tsx', undefined, true);
  h.render();
  const cleanup = h.mount(liveFixture());
  await settle();
  assert.match(text(h.render()), /Shared production · REAL ORDERS/);
  assert.ok(h.requests.every(request => request.options.method === 'GET'));
  cleanup();
});

test('header switch defaults OFF and only confirmed ON sends automation command', async () => {
  const h = harness('AQTEAutomationSwitch.tsx');
  h.render();
  const status = { ...liveFixture(), enabled: true, armed: false };
  const cleanup = h.mount(status);
  await settle();
  assert.equal(nodes(h.render()).filter(n => n.props?.['aria-label'] === 'AQTE auto trading schedule').length, 0);
  assert.equal(nodes(h.render()).filter(n => n.type === 'details').length, 0);
  assert.match(nodes(h.render()).find(n => n.props?.id === 'aqte-automation-help').props.className, /sr-only/);
  assert.equal(nodes(h.render()).find(n => n.props?.role === 'switch').props['aria-checked'], false);
  assert.ok(h.requests.every(r => r.options.method === 'GET'));
  nodes(h.render()).find(n => n.props?.role === 'switch').props.onClick();
  assert.match(text(h.render()), /Start automated real-money orders/);
  assert.match(text(h.render()), /one-lot BUY CE\/BUY PE.*No qualifying signal means no trade/);
  assert.match(text(h.render()), /AQTE manages only its own tagged orders.*never closes, cancels or modifies your manual Kite trades.*different strike/);
  assert.equal(h.requests.filter(r => r.options.method === 'POST').length, 0);
  nodes(h.render()).find(n => n.type === 'button' && /Confirm ON/.test(text(n))).props.onClick();
  await settle();
  const sent = h.requests.find(r => r.url.endsWith('/start'));
  assert.deepEqual(JSON.parse(sent.options.body), { enabled: true, confirmation: 'START AUTOMATED REAL TRADING' });
  assert.doesNotMatch(text(h.render()), /Start automated real-money orders/);
  await h.poll({ ...status, automation_on: true });
  assert.equal(nodes(h.render()).find(n => n.props?.role === 'switch').props['aria-checked'], true);
  autoSwitch(h.render()).props.onClick();
  await settle();
  const off = h.requests.filter(r => r.options.method === 'POST').at(-1);
  assert.deepEqual(JSON.parse(off.options.body), { enabled: false, confirmation: 'STOP NEW ENTRIES' });
  cleanup();
});

test('paper approval is not required by status parsing or the ON switch', async () => {
  const display = displayModule();
  for (const legacy of [{}, { paper_validated: false }, { paper_validated: true }]) {
    const status = { ...liveFixture(), enabled: true, ...legacy };
    assert.equal(display.isAqteLiveState(status), true);
    for (const key of ['enabled', 'ready', 'armed', 'automation_on', 'killed']) {
      const missing = { ...status };
      delete missing[key];
      assert.equal(display.isAqteLiveState(missing), false, key);
      assert.equal(display.isAqteLiveState({ ...status, [key]: 'true' }), false, key);
    }
    const h = harness('AQTEAutomationSwitch.tsx');
    h.render();
    const cleanup = h.mount(status);
    await settle();
    assert.equal(autoSwitch(h.render()).props.disabled, false);
    assert.equal(autoSwitch(h.render()).props['aria-checked'], false);
    assert.doesNotMatch(text(h.render()), /ON locked/);
    autoSwitch(h.render()).props.onClick();
    assert.match(text(h.render()), /Start automated real-money orders/);
    assert.ok(h.requests.every(r => r.options.method === 'GET'));
    cleanup();
  }
});

test('ON remains locked for a disabled or unavailable controller without paper approval', async () => {
  for (const [patch, message] of [
    [{ enabled: false }, /ON locked · AQTE_LIVE_ENABLED is false/],
    [{ ready: false }, /ON locked · Live controller is not ready/],
    [{ killed: true }, /Emergency stop latched/],
  ]) {
    const h = harness('AQTEAutomationSwitch.tsx');
    h.render();
    const cleanup = h.mount({ ...liveFixture(), enabled: true, ...patch });
    await settle();
    assert.equal(autoSwitch(h.render()).props.disabled, true);
    assert.match(text(h.render()), message);
    assert.ok(h.requests.every(r => r.options.method === 'GET'));
    cleanup();
  }
});

test('header switch blocks ON before arming and never shows failed request as successful OFF', async () => {
  const h = harness('AQTEAutomationSwitch.tsx');
  h.render();
  const cleanup = h.mount(liveFixture());
  await settle();
  assert.equal(autoSwitch(h.render()).props.disabled, true);
  await h.poll(new Error('Network failed'));
  assert.match(text(h.render()), /UNKNOWN/);
  assert.match(nodes(h.render()).find(n => n.props?.role === 'status').props.className, /sr-only/);
  assert.equal(autoSwitch(h.render()).props.disabled, true);
  assert.equal(nodes(h.render()).find(n => n.props?.['aria-label'] === 'Stop AQTE new entries').props.disabled, false);
  nodes(h.render()).find(n => n.props?.['aria-label'] === 'Stop AQTE new entries').props.onClick();
  await settle();
  assert.match(text(h.render()), /UNKNOWN/);
  assert.deepEqual(JSON.parse(h.requests.at(-1).options.body), { enabled: false, confirmation: 'STOP NEW ENTRIES' });
  cleanup();
});

test('AQTE refresh restores highlighted backend ON, OFF and emergency states using GET only', async () => {
  for (const [patch, label, variant] of [
    [{ automation_on: true, armed: true }, 'ON', 'on'],
    [{ automation_on: false }, 'OFF', 'off'],
    [{ automation_on: false, killed: true }, 'EMERGENCY STOP', 'stopped'],
  ]) {
    const h = harness('AQTEAutomationSwitch.tsx');
    h.render();
    const cleanup = h.mount({ ...liveFixture(), ...patch });
    await settle();
    const tree = h.render();
    const control = nodes(tree).find(n => n.props?.role === 'switch');
    assert.match(control.props.className, new RegExp(`aqte-auto-switch-${variant}`));
    assert.match(text(control), new RegExp(`Auto Trade\\s+${label === 'EMERGENCY STOP' ? 'STOPPED' : label}`));
    assert.equal(nodes(tree).filter(n => n.props?.role === 'switch').length, 1, 'One compact switch replaces separate ON/OFF buttons');
    assert.equal(nodes(tree).filter(n => n.type === 'button').length, label === 'EMERGENCY STOP' ? 2 : 1);
    if (label === 'EMERGENCY STOP') assert.equal(control.props.disabled, true);
    assert.equal(control.props['aria-checked'], label === 'ON');
    assert.match(text(tree), label === 'EMERGENCY STOP' ? /Emergency stop latched/ : /Backend confirmed/);
    assert.equal(nodes(tree).filter(n => n.type === 'h3').length, 0);
    assert.equal(nodes(tree).filter(n => n.props?.className === 'aqte-auto-heading').length, 0);
    assert.ok(h.requests.every(r => r.options.method === 'GET'));
    cleanup();
  }
});

test('AQTE acknowledges automatic save only after command response and removes it when status is unknown', async () => {
  const h = harness('AQTEAutomationSwitch.tsx');
  const on = { ...liveFixture(), enabled: true, armed: true, automation_on: true };
  h.render();
  const cleanup = h.mount(on);
  await settle();
  h.respond({ ...on, automation_on: false });
  autoSwitch(h.render()).props.onClick();
  await settle();
  assert.match(text(h.render()), /Saved automatically.*OFF/);
  await h.poll(new Error('Lost connection'));
  assert.doesNotMatch(text(h.render()), /Saved automatically|Backend confirmed/);
  assert.match(text(h.render()), /Do not assume OFF/);
  await h.poll(on);
  assert.match(text(h.render()), /Backend confirmed.*ON/);
  assert.equal(nodes(h.render()).filter(n => n.props?.role === 'alert').length, 0);
  cleanup();
});

test('manual broker readout shows a market-hours pause rather than claiming no positions', async () => {
  const h = harness('AQTEBrokerPositions.tsx');
  h.render({ selectedSymbol: 'NIFTY' });
  const cleanup = h.mount({
    read_only: true, generated_at: Date.now() / 1000, positions: [], paused: true,
    reason: 'Market closed. Broker readout resumes during 09:15–15:30 IST on trading weekdays.',
  });
  await settle();
  const tree = h.render({ selectedSymbol: 'NIFTY' });
  assert.match(text(tree), /Broker readout paused · Positions unverified/);
  assert.doesNotMatch(text(tree), /Manual trades are not managed by AQTE|Broker readout resumes/);
  assert.match(nodes(tree).find(n => n.props?.role === 'status').props.title, /Market closed.*09:15–15:30 IST/);
  assert.doesNotMatch(text(tree), /No open Zerodha derivative position|FRESH QUOTE/);
  assert.ok(h.requests.every(r => !r.options.method || r.options.method === 'GET'));
  cleanup();
});

test('hero metrics and rule engine remain visible; manual broker positions stay in the Positions tab', () => {
  const terminal = harness('AQTETerminal.tsx').render({
    symbol: 'NIFTY', signal: fixture().data.NIFTY, unavailable: false, active: true, tick: null,
  });
  const disclosures = nodes(terminal).filter(n => n.type === 'details');
  assert.equal(disclosures.length, 2);
  assert.deepEqual(disclosures.map(detail => text(nodes(detail).find(n => n.type === 'summary')).trim()),
    ['Advanced details', 'Additional image rules · Not enabled']);
  const engine = nodes(terminal).find(n => n.props?.['aria-label'] === 'Rule-Based Trade Engine');
  assert.equal(engine.type, 'section', 'Keep the primary engine card visible, not inside a disclosure');
  assert.ok(disclosures.every(detail => !nodes(detail).some(n => n.props?.['aria-label'] === 'Trade prices')));
  assert.ok(nodes(terminal).find(n => n.props?.['aria-label'] === 'Trade lifecycle'));
  const h = harness();
  nodes(h.render()).find(n => n.props?.id === 'aqte-book-tab-positions').props.onClick();
  const positions = nodes(h.render()).find(n => n.props?.id === 'aqte-book-positions');
  assert.equal(positions.props.hidden, false);
  assert.ok(nodes(positions).some(n => typeof n.type === 'function' && n.props?.selectedSymbol === 'NIFTY'));
  assert.ok(nodes(h.render()).find(n => n.props?.id === 'aqte-book-controls'));
});

test('emergency latch still blocks header ON without directing users to removed reset controls', async () => {
  for (const flatten_pending of [true, false]) {
    const h = harness('AQTEAutomationSwitch.tsx');
    h.render();
    const cleanup = h.mount({ ...liveFixture(), enabled: true, killed: true, flatten_pending });
    await settle();
    const tree = h.render();
    assert.equal(autoSwitch(tree).props.disabled, true);
    assert.match(text(tree), flatten_pending ? /Closing AQTE positions only · manual trades untouched/ : /Owner reset required before ON/);
    assert.doesNotMatch(text(tree), /Closing all Kite positions/);
    const reset = nodes(tree).find(n => n.type === 'button' && text(n) === 'Reset emergency stop');
    assert.equal(reset.props.disabled, flatten_pending);
    assert.doesNotMatch(text(tree), /Reset below/);
    assert.ok(h.requests.every(r => r.options.method === 'GET'));
    cleanup();
  }
});
test('owner emergency reset is confirmed separately and restores OFF without starting trading', async () => {
  const h = harness('AQTEAutomationSwitch.tsx');
  h.render();
  const stopped = { ...liveFixture(), enabled: true, killed: true };
  const cleanup = h.mount(stopped);
  await settle();
  const reset = () => nodes(h.render()).find(n => n.type === 'button' && text(n) === 'Reset emergency stop');
  reset().props.onClick();
  assert.match(text(h.render()), /keeps automation OFF/);
  assert.match(text(h.render()), /09:15–15:15 IST/);
  assert.equal(h.requests.filter(r => r.options.method === 'POST').length, 0);
  nodes(h.render()).find(n => n.type === 'button' && text(n) === 'Cancel reset').props.onClick();
  assert.ok(!nodes(h.render()).some(n => n.props?.['aria-label'] === 'Confirm emergency reset'));
  reset().props.onClick();
  h.respond({ ...stopped, killed: false });
  const confirm = nodes(h.render()).find(n => n.type === 'button' && text(n) === 'Confirm reset · keep OFF');
  confirm.props.onClick();
  confirm.props.onClick();
  await settle();
  const posts = h.requests.filter(r => r.options.method === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, '/api/aqte/live/reset');
  assert.deepEqual(JSON.parse(posts[0].options.body), { confirmation: 'RESET EMERGENCY STOP' });
  assert.equal(posts[0].options.credentials, 'include');
  assert.equal(posts[0].options.headers['X-AQTE-Intent'], 'manual-live-control');
  assert.equal(posts[0].options.headers['X-Device-Id'], 'test-device');
  assert.match(text(autoSwitch(h.render())), /Auto Trade\s+OFF/);
  assert.equal(autoSwitch(h.render()).props.disabled, false);
  assert.ok(!reset());
  autoSwitch(h.render()).props.onClick();
  assert.match(text(h.render()), /Start automated real-money orders/);
  assert.equal(h.requests.filter(r => r.options.method === 'POST').length, 1, 'ON requires a separate confirmation');
  cleanup();
});
test('reset recovery does not bypass backend live enablement', async () => {
  const h = harness('AQTEAutomationSwitch.tsx');
  h.render();
  const stopped = { ...liveFixture(), killed: true };
  const cleanup = h.mount(stopped);
  await settle();
  nodes(h.render()).find(n => n.type === 'button' && text(n) === 'Reset emergency stop').props.onClick();
  h.respond({ ...stopped, killed: false });
  nodes(h.render()).find(n => n.type === 'button' && text(n) === 'Confirm reset · keep OFF').props.onClick();
  await settle();
  assert.match(text(autoSwitch(h.render())), /Auto Trade\s+OFF/);
  assert.equal(autoSwitch(h.render()).props.disabled, true);
  assert.match(text(h.render()), /ON locked · AQTE_LIVE_ENABLED is false/);
  assert.ok(h.requests.every(r => r.url.endsWith('/status') || r.url.endsWith('/reset')));
  cleanup();
});
test('emergency reset stays blocked while pending, active, unready or unverified', async () => {
  for (const patch of [
    { flatten_pending: true }, { flatten_pending: undefined },
    { active: livePositionFixture() }, { ready: false },
    { generated_at: Date.now() / 1000 - 11 },
  ]) {
    const h = harness('AQTEAutomationSwitch.tsx');
    h.render();
    const cleanup = h.mount({ ...liveFixture(), killed: true, ...patch });
    await settle();
    const reset = nodes(h.render()).find(n => n.type === 'button' && text(n) === 'Reset emergency stop');
    assert.ok(!reset || reset.props.disabled);
    if (reset) reset.props.onClick();
    assert.ok(!nodes(h.render()).some(n => n.props?.['aria-label'] === 'Confirm emergency reset'));
    assert.ok(h.requests.every(r => r.options.method === 'GET'));
    cleanup();
  }
});
test('reset confirmation rechecks status and supports Escape without a mutation', async () => {
  const h = harness('AQTEAutomationSwitch.tsx');
  h.render();
  const stopped = { ...liveFixture(), killed: true };
  const cleanup = h.mount(stopped);
  await settle();
  nodes(h.render()).find(n => n.type === 'button' && text(n) === 'Reset emergency stop').props.onClick();
  await h.poll({ ...stopped, flatten_pending: true });
  let tree = h.render();
  const confirm = nodes(tree).find(n => n.type === 'button' && text(n) === 'Confirm reset · keep OFF');
  assert.equal(confirm.props.disabled, true);
  confirm.props.onClick();
  assert.match(text(tree), /Reset unavailable/);
  const group = nodes(tree).find(n => n.props?.['aria-label'] === 'Confirm emergency reset');
  group.props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  tree = h.render();
  assert.ok(!nodes(tree).some(n => n.props?.['aria-label'] === 'Confirm emergency reset'));
  assert.ok(h.requests.every(r => r.options.method === 'GET'));
  cleanup();
});
test('ON confirmation states the entry mode; Cancel and Escape keep OFF without any command', async () => {
  const h = harness('AQTEAutomationSwitch.tsx');
  h.render();
  const status = { ...liveFixture(), enabled: true };
  const cleanup = h.mount(status);
  await settle();
  const open = () => nodes(h.render()).find(n => n.props?.role === 'switch').props.onClick();
  const group = () => nodes(h.render()).find(n => n.props?.['aria-label'] === 'Confirm automated real trading');
  open();
  assert.match(text(group()), /Strict validation mode.*without placing orders/);
  assert.ok(!nodes(h.render()).some(n => n.type === 'button' && text(n) === 'Keep OFF'));
  nodes(h.render()).find(n => n.type === 'button' && text(n) === 'Cancel · stay OFF').props.onClick();
  assert.equal(group(), undefined);
  assert.match(text(h.render()), /Auto Trade\s+OFF/);
  await h.poll({ ...status, unvalidated_rules: true });
  open();
  assert.match(text(group()), /unvalidated rule entries.*real one-lot orders/);
  group().props.onKeyDown({ key: 'Enter', preventDefault() {}, stopPropagation() {} });
  assert.ok(group());
  group().props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.equal(group(), undefined);
  assert.ok(h.requests.every(r => r.options.method === 'GET'));
  await h.poll({ ...status, unvalidated_rules: 'yes' });
  assert.match(text(h.render()), /UNKNOWN/);
  cleanup();
});
test('risk card separates disabled live trading, unarmed OFF and armed pause without paper approval', () => {
  const h = harness();
  const publish = status => nodes(h.render()).find(n => n.props?.onStatus && 'exitRequest' in n.props).props.onStatus(status);
  const risk = () => text(nodes(h.render()).find(n => n.props?.['aria-label'] === 'Today summary'));
  publish(liveFixture());
  assert.match(risk(), /Locked\s+₹[\d.,\s]+\/\s+₹[\d.,\s]+Live trading disabled/);
  for (const legacy of [{}, { paper_validated: false }]) {
    publish({ ...liveFixture(), enabled: true, ...legacy });
    assert.match(risk(), /Not armed\s+₹[\d.,\s]+\/\s+₹[\d.,\s]+Arms when Auto Trade turns ON/);
    assert.doesNotMatch(risk(), /Locked|Live approval required/);
  }
  publish({ ...liveFixture(), enabled: true, armed: true });
  assert.match(risk(), /Paused\s+₹[\d.,\s]+\/\s+₹[\d.,\s]+Protection continues/);
  publish({ ...liveFixture(), enabled: true, armed: true, automation_on: true });
  assert.match(risk(), /Within limits/);
  publish({ ...liveFixture(), enabled: true, automation_wanted: true, entry_window: false });
  assert.match(risk(), /Waiting\s+₹[\d.,\s]+\/\s+₹[\d.,\s]+ON · arms 09:15 IST/);
  publish({ ...liveFixture(), enabled: true, automation_wanted: true, entry_window: true });
  assert.match(risk(), /Waiting\s+₹[\d.,\s]+\/\s+₹[\d.,\s]+ON · arming \/ preflight/);
});
test('standing ON is accepted while the market is closed and shows the waiting reason until OFF', async () => {
  const h = harness('AQTEAutomationSwitch.tsx');
  h.render();
  const off = { ...liveFixture(), enabled: true, automation_wanted: false, entry_window: false };
  const waiting = { ...off, automation_wanted: true,
    automation_waiting: 'Waiting for market: auto trade arms on weekdays 09:15 to 15:15 IST' };
  const cleanup = h.mount(off);
  await settle();
  autoSwitch(h.render()).props.onClick();
  assert.match(text(h.render()), /stays saved until you switch OFF, even when the market is closed/);
  h.respond(waiting);
  nodes(h.render()).find(n => n.type === 'button' && /Confirm ON/.test(text(n))).props.onClick();
  await settle();
  assert.equal(autoSwitch(h.render()).props['aria-checked'], true);
  assert.match(text(autoSwitch(h.render())), /Auto Trade\s+ON/);
  assert.match(text(h.render()), /ON ·\s+Waiting for market.*09:15 to 15:15 IST/);
  assert.equal(nodes(h.render()).filter(n => n.props?.role === 'alert').length, 0);
  await h.poll({ ...waiting, automation_waiting: null, automation_on: true, armed: true, entry_window: true });
  assert.doesNotMatch(text(h.render()), /ON ·\s+Waiting/);
  h.respond(off);
  autoSwitch(h.render()).props.onClick();
  await settle();
  assert.deepEqual(JSON.parse(h.requests.filter(r => r.options.method === 'POST').at(-1).options.body),
    { enabled: false, confirmation: 'STOP NEW ENTRIES' });
  assert.equal(autoSwitch(h.render()).props['aria-checked'], false);
  cleanup();
});
test('standing ON acknowledgements must match the requested state', async () => {
  const base = { ...liveFixture(), enabled: true };
  for (const [initial, response] of [
    [base, { ...base, automation_wanted: false }],
    [{ ...base, automation_wanted: true }, { ...base, automation_wanted: true }],
    [{ ...base, automation_wanted: true }, { ...base, automation_wanted: false, automation_on: true, armed: true }],
  ]) {
    const h = harness('AQTEAutomationSwitch.tsx');
    h.render();
    const cleanup = h.mount(initial);
    await settle();
    h.respond(response);
    autoSwitch(h.render()).props.onClick();
    const confirm = nodes(h.render()).find(n => n.type === 'button' && /Confirm ON/.test(text(n)));
    if (confirm) confirm.props.onClick();
    await settle();
    assert.match(text(autoSwitch(h.render())), /UNKNOWN/);
    assert.match(text(h.render()), /Backend did not confirm the requested automation state/);
    cleanup();
  }
});
test('reset failures and inconsistent acknowledgements never present a confirmed OFF', async () => {
  const stopped = { ...liveFixture(), enabled: true, killed: true };
  for (const response of [
    { __httpStatus: 401, __body: { detail: 'Owner sign-in required' } },
    { __httpStatus: 409, __body: { detail: 'Emergency square-off still in progress' } },
    stopped,
    { ...stopped, killed: false, automation_on: true },
    { ...stopped, killed: false, armed: true },
    { ...stopped, killed: false, generated_at: Date.now() / 1000 - 11 },
  ]) {
    const h = harness('AQTEAutomationSwitch.tsx');
    h.render();
    const cleanup = h.mount(stopped);
    await settle();
    nodes(h.render()).find(n => n.type === 'button' && text(n) === 'Reset emergency stop').props.onClick();
    h.respond(response);
    nodes(h.render()).find(n => n.type === 'button' && text(n) === 'Confirm reset · keep OFF').props.onClick();
    await settle();
    assert.match(text(autoSwitch(h.render())), /UNKNOWN/);
    assert.equal(autoSwitch(h.render()).props.disabled, true);
    assert.ok(nodes(h.render()).find(n => n.props?.role === 'alert'));
    assert.ok(!nodes(h.render()).some(n => n.type === 'button' && text(n) === 'Reset emergency stop'));
    assert.equal(h.requests.filter(r => r.options.method === 'POST').length, 1);
    cleanup();
  }
});
test('Exit Now confirms a fixed trade identity and never invokes account-wide emergency close', async () => {
  const h = harness('AQTELiveController.tsx');
  const status = { ...liveFixture(), active: livePositionFixture() };
  const request = { tradeId: status.active.id, contract: status.active.contract.trading_symbol, quantity: 15, action: 'exit' };
  h.render();
  const cleanup = h.mount(status);
  await settle();
  assert.equal(nodes(h.render()).filter(n => n.props?.role === 'alertdialog').length, 0);
  h.render({ exitRequest: request });
  const dialog = nodes(h.render({ exitRequest: request })).find(n => n.props?.role === 'alertdialog');
  assert.ok(dialog, 'Exit Now must ask for confirmation');
  assert.match(text(dialog), /Selected AQTE trade/);
  assert.match(text(dialog), /NIFTY_POSITION_CE/);
  assert.match(text(dialog), /Other Kite positions and orders are untouched/);
  assert.equal(h.requests.filter(r => r.options.method === 'POST').length, 0);
  nodes(dialog).find(n => n.type === 'button' && text(n) === 'Confirm selected trade exit').props.onClick();
  await settle();
  const sent = h.requests.find(r => r.options.method === 'POST');
  assert.ok(sent.url.endsWith('/live/exit'));
  assert.deepEqual(JSON.parse(sent.options.body), { trade_id: status.active.id, confirmation: 'CLOSE SELECTED AQTE TRADE' });
  assert.ok(h.requests.every(r => r.url.endsWith('/live/status') || r.url.endsWith('/live/exit')));
  cleanup();
});
test('selected-exit errors remain explicit after the safety panel is removed', async () => {
  const h = harness('AQTELiveController.tsx');
  let published;
  const onStatus = status => { published = status; };
  const status = { ...liveFixture(), active: livePositionFixture() };
  h.render({ onStatus });
  const cleanup = h.mount(status);
  await settle();
  const props = { onStatus, exitRequest: {
    tradeId: status.active.id, contract: status.active.contract.trading_symbol, quantity: 15, action: 'exit',
  } };
  h.render(props);
  let dialog = nodes(h.render(props)).find(n => n.props?.role === 'alertdialog');
  nodes(dialog).find(n => n.type === 'button' && text(n) === 'Cancel').props.onClick();
  assert.equal(h.requests.filter(r => r.options.method === 'POST').length, 0);
  props.exitRequest = { ...props.exitRequest };
  h.render(props);
  dialog = nodes(h.render(props)).find(n => n.props?.role === 'alertdialog');
  h.respondHTTP(409, { detail: 'Trade exit cannot be confirmed; inspect Kite' });
  const confirm = nodes(dialog).find(n => n.type === 'button' && text(n) === 'Confirm selected trade exit');
  confirm.props.onClick();
  confirm.props.onClick();
  await settle();
  assert.equal(h.requests.filter(r => r.options.method === 'POST').length, 1);
  assert.equal(published.active, status.active);
  assert.match(published.connection_error, /Trade exit cannot be confirmed/);
  assert.match(text(nodes(h.render(props)).find(n => n.props?.role === 'alert')), /Trade exit cannot be confirmed/);
  await h.poll(status);
  assert.match(text(h.render(props)), /Trade exit cannot be confirmed/, 'polling must not silently dismiss an exit failure');
  assert.doesNotMatch(text(h.render(props)), /Safety & emergency|Live setup/);
  cleanup();
});
test('trade actions remain connected to the controller when index tabs change', () => {
  const h = harness();
  const controller = () => nodes(h.render()).find(n => n.props?.onStatus && 'exitRequest' in n.props);
  const status = { ...liveFixture(), active: livePositionFixture() };
  controller().props.onStatus(status);
  nodes(h.render()).find(n => n.type === 'button' && text(n).includes('Exit Now')).props.onClick();
  const request = controller().props.exitRequest;
  assert.equal(request.tradeId, status.active.id);
  assert.equal(request.action, 'exit');
  nodes(h.render()).find(n => n.props?.id === 'aqte-index-tab-BANKNIFTY').props.onClick();
  assert.equal(controller().props.exitRequest, request);
  nodes(h.render()).find(n => n.props?.id === 'aqte-index-tab-NIFTY').props.onClick();
  nodes(h.render()).find(n => n.type === 'button' && text(n).includes('Book All')).props.onClick();
  assert.equal(controller().props.exitRequest.tradeId, status.active.id);
  assert.equal(controller().props.exitRequest.action, 'book');
});
test('trade controls explain locked exits and unlock only for a filled, selected AQTE trade', () => {
  const render = liveStatus => harness('AQTETerminal.tsx').render({ symbol: 'NIFTY', unavailable: false, tick: null, onExit() {}, liveStatus });
  const controls = tree => nodes(tree).find(n => n.props?.['aria-label'] === 'Trade controls');
  const exits = tree => nodes(tree).filter(n => n.type === 'button' && /Exit Now|Exit Requested|Book All/.test(text(n)));
  const partial = tree => nodes(tree).filter(n => n.type === 'button' && /^Book \d+%/.test(n.props['aria-label'] ?? ''));
  let tree = render(liveFixture());
  assert.equal(controls(tree).props['data-state'], 'idle');
  assert.match(text(controls(tree)), /Standby · no open trade/);
  assert.equal(exits(tree).length, 2);
  assert.ok(exits(tree).every(b => b.props.disabled && /No open trade/.test(text(b))));
  assert.equal(partial(tree).length, 3);
  tree = render({ ...liveFixture(), active: livePositionFixture() });
  assert.equal(controls(tree).props['data-state'], 'ready');
  assert.ok(exits(tree).every(b => !b.props.disabled));
  assert.match(text(controls(tree)), /Exit ready.*Selected AQTE trade.*Selected trade only/);
  assert.ok(partial(tree).every(b => b.props.disabled), 'one-lot pilot never offers partial booking');
  tree = render({ ...liveFixture(), active: livePositionFixture({ exit_requested: 'MANUAL_EXIT' }) });
  assert.equal(controls(tree).props['data-state'], 'pending');
  assert.ok(exits(tree).every(b => b.props.disabled && /Exit requested/.test(text(b))));
});
test('trade lifecycle tracks live, completed and idle trades with explicit per-stage states', () => {
  const render = liveStatus => harness('AQTETerminal.tsx').render({ symbol: 'NIFTY', unavailable: false, tick: null, onExit() {}, liveStatus });
  const life = tree => nodes(tree).find(n => n.props?.className === 'aqx-lifecycle');
  const stages = tree => nodes(nodes(tree).find(n => n.props?.['aria-label'] === 'Trade lifecycle')).filter(n => n.type === 'li')
    .map(n => [n.props.className.replace('aqx-step-', ''), text(n).replace(/\s+/g, ' ').trim()]);
  const states = tree => stages(tree).map(([state]) => state).join(',');
  const now = Date.now() / 1000;

  let tree = render(liveFixture());
  assert.equal(life(tree).props['data-mode'], 'idle');
  assert.equal(states(tree), 'plan,plan,plan,plan,plan,plan');
  assert.match(stages(tree)[0][1], /Auto OFF/);
  assert.doesNotMatch(text(life(tree)), /--/, 'idle lifecycle explains the plan instead of blank dashes');
  tree = render({ ...liveFixture(), automation_on: true, armed: true });
  assert.equal(stages(tree)[0][0], 'scan');
  assert.equal(life(tree).props['data-tone'], 'scan');
  assert.match(text(life(tree)), /Scanning/);
  tree = render({ ...liveFixture(), killed: true });
  assert.equal(stages(tree)[0][0], 'fail');
  assert.equal(life(tree).props['data-tone'], 'fail');

  tree = render({ ...liveFixture(), active: livePositionFixture() });
  assert.equal(life(tree).props['data-mode'], 'live');
  assert.equal(states(tree), 'done,done,done,done,done,plan');
  assert.match(stages(tree)[2][1], /₹100\.00 · 15 qty/);
  assert.match(stages(tree)[3][1], /SL Protected ₹80\.00/, 'SL stage keeps the initial broker stop');
  assert.match(stages(tree)[4][1], /Trailing Active ₹105\.00 \+₹75\.00 locked/);
  assert.match(stages(tree)[5][1], /Target ₹140\.00/);
  assert.match(text(life(tree)), /5\s*\/\s*6/);
  assert.match(text(life(tree)), /in trade/);

  tree = render({ ...liveFixture(), active: livePositionFixture({ trailing_active: false, stop: 80, peak: 104 }) });
  assert.equal(states(tree), 'done,done,done,done,current,plan');
  assert.match(stages(tree)[4][1], /Arms ₹120\.00 Peak ₹104\.00/, 'trail arms at entry + 1R');
  tree = render({ ...liveFixture(), active: livePositionFixture({ filled: 0, entry_price: 0, fill_at: undefined,
    protection_confirmed: false, trailing_active: false, protect_id: null, state: 'ENTRY_PENDING' }) });
  assert.equal(states(tree), 'done,done,current,plan,plan,plan');
  assert.match(stages(tree)[2][1], /Awaiting fill Limit ₹100\.00/);
  tree = render({ ...liveFixture(), active: livePositionFixture({ protection_confirmed: false, trailing_active: false, error: 'Kite down' }) });
  assert.equal(stages(tree)[3][0], 'fail');
  assert.equal(life(tree).props['data-tone'], 'fail');
  tree = render({ ...liveFixture(), active: livePositionFixture({ exit_requested: 'TARGET', exit_request_at: now - 2 }) });
  assert.equal(stages(tree)[5][0], 'warn');
  assert.match(stages(tree)[5][1], /Exit Target hit Sent/);
  assert.equal(stages(tree).filter(([state]) => state === 'current').length, 0, 'an exit supersedes earlier pending stages');

  const closed = { symbol: 'NIFTY', net_pnl: 412.5, exit_at: now - 30, entry_at: now - 400, signal_at: now - 405,
    entry_ack_at: now - 399, fill_at: now - 398, protect_at: now - 396, trail_at: now - 120, filled: 15, entry_price: 100,
    exit_price: 128, initial_stop: 80, stop: 110, target: 140, trailing_active: true, protection_confirmed: true,
    exit_requested: null, contract: { trading_symbol: 'NIFTY_CLOSED_CE' } };
  tree = render({ ...liveFixture(), trades: [closed] });
  assert.equal(life(tree).props['data-mode'], 'closed');
  assert.equal(states(tree), 'done,done,done,done,done,done');
  assert.match(text(life(tree)), /Completed.*NIFTY_CLOSED_CE.*\+₹412\.50.*Held 6m 15s.*6\s*\/\s*6/);
  assert.match(stages(tree)[5][1], /Trailing SL hit .*₹128\.00/, 'a broker SL fill after trailing reads as a trailing-stop exit');
  tree = render({ ...liveFixture(), trades: [{ ...closed, trailing_active: false, exit_requested: 'SESSION_EXIT' }] });
  assert.equal(stages(tree)[4][0], 'skip');
  assert.match(stages(tree)[5][1], /Session exit 15:25/);
  tree = render({ ...liveFixture(), trades: [{ ...closed, exit_reason: 'EMERGENCY_STOP', exit_price: null, exit_unverified: true }] });
  assert.equal(stages(tree)[5][0], 'fail');
  assert.match(text(life(tree)), /Check Kite/);
  tree = render({ ...liveFixture(), trades: [{ ...closed, symbol: 'SENSEX' }] });
  assert.equal(life(tree).props['data-mode'], 'idle', 'another index never fills this tab lifecycle');
  tree = render({ ...liveFixture(), trades: [{ ...closed, exit_at: now - 2 * 86400 }] });
  assert.equal(life(tree).props['data-mode'], 'idle', 'only today\'s trade is replayed');
});

test('idle lifecycle and readiness name a disabled/capped index and a closed session instead of a generic arming state', () => {
  const display = displayModule();
  assert.equal(display.aqteIndexHold('Index auto trading disabled'), 'Disabled in Controls');
  assert.equal(display.aqteIndexHold('Daily index trade limit reached'), 'Limit reached');
  assert.equal(display.aqteIndexHold('Account-wide daily trade cap reached'), 'Limit reached');
  assert.equal(display.aqteIndexHold('Daily index loss limit reached'), null, 'a loss limit is a risk block, not a Controls switch');
  assert.equal(display.aqteIndexHold(null), null);
  assert.deepEqual(['Outside regular market session', 'Daily index loss limit reached', 'Trade exceeds remaining daily index loss budget',
    'This strategy candle was already submitted', 'Entry retry cooldown after a transient price/quote check', 'No setup']
    .map(reason => display.aqteBlockLabel(reason)), ['Market closed', 'Loss budget', 'Loss budget', 'Setup used', 'Retry cooldown', 'Waiting for signal']);
  assert.equal(display.aqteBlockLabel('One lot exceeds live per-trade risk limit', true), 'Waiting for entry');
  assert.equal(display.aqteOpportunitySymbol(['NIFTY', 'BANKNIFTY', 'SENSEX'],
    { NIFTY: 'Index auto trading disabled', BANKNIFTY: 'Daily index trade limit reached', SENSEX: 'Outside regular market session' }), 'SENSEX');

  const render = (liveStatus, signal) => harness('AQTETerminal.tsx').render({ symbol: 'NIFTY', unavailable: false, tick: null, onExit() {}, liveStatus, signal });
  const life = tree => nodes(tree).find(n => n.props?.className === 'aqx-lifecycle');
  const first = tree => text(nodes(nodes(tree).find(n => n.props?.['aria-label'] === 'Trade lifecycle')).find(n => n.type === 'li')).replace(/\s+/g, ' ').trim();
  const readiness = tree => text(nodes(tree).find(n => n.props?.['aria-label'] === 'Entry readiness'));
  const waiting = { ...liveFixture(), enabled: true, automation_wanted: true, entry_window: false,
    automation_waiting: 'Waiting for market: auto trade arms on weekdays 09:15 to 15:15 IST',
    entry_blocks: { NIFTY: 'Outside regular market session' } };
  let tree = render(waiting);
  assert.match(first(tree), /Entries closed 09:15 to 15:15 IST/);
  assert.match(text(life(tree)), /Entries closed/);
  assert.doesNotMatch(text(life(tree)), /Arming/);
  tree = render({ ...waiting, automation_on: true, armed: true, automation_waiting: null });
  assert.match(first(tree), /Entries closed/);
  assert.doesNotMatch(first(tree), /Scanning/);
  assert.match(readiness(tree), /09:15 to 15:15 IST/);
  tree = render({ ...waiting, entry_window: true, automation_waiting: 'Outbound IP mismatch' });
  assert.match(first(tree), /Arming Preflight/, 'inside the window an unarmed switch is a preflight problem');

  const disabled = { ...waiting, entry_blocks: { NIFTY: 'Index auto trading disabled' } };
  tree = render(disabled);
  assert.match(first(tree), /Index off Enable in Controls/);
  assert.match(text(life(tree)), /Index off/);
  assert.match(readiness(tree), /Index auto trading disabled · tick "Enable NIFTY entries" in Daily Trade Control · Waiting for market/);
  tree = render({ ...disabled, automation_on: true, armed: true, automation_waiting: null, entry_window: true,
    entry_blocks: { NIFTY: 'Daily index trade limit reached' } });
  assert.match(first(tree), /Limit hit Resets next day/);
  assert.equal(readiness(tree).trim(), 'Daily index trade limit reached');
  tree = render({ ...disabled, automation_wanted: false, automation_waiting: null });
  assert.match(first(tree), /Auto OFF/, 'with the master switch off, Auto OFF is the first cause');

  // Warm-up/opening progress only shows while the feed is live; after the close it is not a stuck 0/201.
  const armed = { ...liveFixture(), enabled: true, armed: true, automation_on: true };
  const signal = { ...fixture().data.NIFTY, warmup: { completed: 0, required: 201 }, opening: { completed: 0, required: 15 } };
  assert.match(readiness(render(armed, signal)), /Warm-up:\s+0\s*\/\s*201/);
  assert.doesNotMatch(readiness(render(armed, { ...signal, feed_ready: false })), /Warm-up|Opening range/);
});

test('trail start follows the per-index Controls value until a trade stores its own', () => {
  const display = displayModule();
  const status = { ...liveFixture(), trail_starts: { NIFTY: 1.5, BANKNIFTY: 2 } };
  assert.equal(display.isAqteLiveState(status), true);
  for (const trail_starts of [{ NIFTY: 0 }, { NIFTY: 0.5 }, { NIFTY: 3.5 }, { NIFTY: '1' }, { OTHER: 1 }, [1]]) {
    assert.equal(display.isAqteLiveState({ ...status, trail_starts }), false, JSON.stringify(trail_starts));
  }
  assert.equal(display.aqteTrailStart(status, 'NIFTY'), 1.5);
  assert.equal(display.aqteTrailStart(status, 'SENSEX'), 1, 'older backends and unset indices default to 1R');
  assert.equal(display.aqteTrailStart({ ...status, active: livePositionFixture({ trail_start_r: 2.5 }) }, 'NIFTY'), 2.5);
  assert.equal(display.aqteTrailStart({ ...status, active: livePositionFixture({ trail_start_r: undefined }) }, 'NIFTY'), 1,
    'legacy open trades use the backend 1R fallback, never mutable Controls values');
  assert.equal(display.aqteTrailStart({ ...status, active: livePositionFixture() }, 'BANKNIFTY'), 2, 'another index trade does not leak');
  assert.equal(display.aqteTrailStart(null, 'NIFTY'), 1);

  const terminal = harness('AQTETerminal.tsx').render({ symbol: 'NIFTY', unavailable: false, tick: null, onExit() {},
    liveStatus: { ...status, armed: true, automation_on: true } });
  assert.match(text(terminal), /Trailing SL\s+\+\s*1\.5\s*R/);
  assert.doesNotMatch(text(terminal), /Trailing SL\s+\+\s*1\s*R/);

  const deck = harness('AQTEEngineDeck.tsx');
  const data = fixture().data;
  data.NIFTY = { ...data.NIFTY, ...engineSet({ ce: 3 }), scalp: scalpSignal('BUY CE', 90) };
  const tree = deck.render({ symbol: 'NIFTY', data, unavailable: false, policy: null, events: [],
    liveStatus: { ...status, ranking: ['NIFTY'], entry_blocks: { NIFTY: null } } });
  assert.match(text(nodes(tree).find(n => n.props?.['aria-label'] === 'Enterprise trade management')), /from \+1\.5R/);
  assert.match(text(tree), /No engine status changes since AQTE started/);
  assert.doesNotMatch(text(tree), /yet today/);
});
test('mobile title keeps the market badge in the same row beside the wrapping title', () => {
  const styles = readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8');
  const mobile = styles.match(/@container \(max-width: 620px\) \{\s*\.aqte-theme #aqte-title \{[^}]*\}[\s\S]*?\n\}/)?.[0];
  assert.ok(mobile, 'mobile title rules');
  assert.match(mobile, /#aqte-title \{ display: flex; align-items: center/);
  assert.match(mobile, /#aqte-title > span:first-child \{[^}]*white-space: nowrap/);
  assert.match(mobile, /#aqte-title > span:nth-child\(2\) \{[^}]*min-width: 0/);
  assert.match(mobile, /#aqte-title \.aqte-view-status \{[^}]*flex: 0 0 auto/);
});
test('index tabs switch instantly: charts prefetch, stay mounted and controls reuse last data', () => {
  const read = name => readFileSync(path.join(__dirname, '..', 'components', name), 'utf8');
  assert.match(read('AQTESection.tsx'), /SYMBOLS\.forEach\(symbol => void prefetchChartHistory\(symbol, 5\)\)/);
  // The dashboard chart for an index mounts on first view and stays mounted (hidden) after switching away.
  const section = read('AQTESection.tsx');
  assert.match(section, /if \(!chartsOpened\[selectedSymbol\]\) setChartsOpened\(/);
  assert.match(section, /\{chartsOpened\[symbol\] \? <Chart /);
  assert.doesNotMatch(read('AQTETerminal.tsx'), /<Chart /);
  assert.match(read('AQTEDailyControl.tsx'), /useState<Snapshot \| null>\(lastSnapshot\)/);
});

test('compact switch has no optimistic ON, ignores repeated clicks and sends OFF from the same pill', async () => {
  const h = harness('AQTEAutomationSwitch.tsx');
  const initial = h.render();
  assert.match(text(autoSwitch(initial)), /Checking/);
  assert.equal(autoSwitch(initial).props['aria-checked'], undefined);
  assert.equal(autoSwitch(initial).props.disabled, true);
  const off = { ...liveFixture(), enabled: true };
  const cleanup = h.mount(off);
  await settle();
  const pill = autoSwitch(h.render());
  assert.match(text(pill), /Auto Trade\s+OFF/);
  assert.equal(nodes(h.render()).filter(n => n.type === 'button').length, 1);
  pill.props.onClick();
  const confirm = nodes(h.render()).find(n => n.type === 'button' && /Confirm ON/.test(text(n)));
  let finish;
  h.respond(new Promise(resolve => { finish = resolve; }));
  confirm.props.onClick();
  confirm.props.onClick();
  await settle();
  assert.equal(h.requests.filter(r => r.options.method === 'POST').length, 1);
  assert.equal(autoSwitch(h.render()).props['aria-checked'], false);
  assert.equal(autoSwitch(h.render()).props.disabled, true);
  finish({ ...off, armed: true, automation_on: true });
  await settle();
  assert.equal(autoSwitch(h.render()).props['aria-checked'], true);
  assert.equal(autoSwitch(h.render()).props.disabled, false, 'Confirmed ON can always request OFF');
  h.respond(off);
  autoSwitch(h.render()).props.onClick();
  await settle();
  assert.equal(autoSwitch(h.render()).props['aria-checked'], false);
  const posts = h.requests.filter(r => r.options.method === 'POST');
  assert.ok(posts[0].url.endsWith('/live/start'));
  assert.ok(posts[1].url.endsWith('/live/automation'));
  assert.deepEqual(JSON.parse(posts[1].options.body), { enabled: false, confirmation: 'STOP NEW ENTRIES' });
  cleanup();
});

test('unauthorized, stale and rejected switch responses never masquerade as confirmed OFF or ON', async () => {
  const h = harness('AQTEAutomationSwitch.tsx');
  h.render();
  const status = { ...liveFixture(), enabled: true, armed: true, automation_on: true };
  const cleanup = h.mount(status);
  await settle();
  h.respondHTTP(401, { detail: 'Sign in with the configured owner app-access session' });
  assert.equal(h.accessExpired, 0);
  autoSwitch(h.render()).props.onClick();
  await settle();
  assert.equal(h.accessExpired, 1, 'a 401 asks the access gate to re-verify and show sign-in');
  assert.match(text(h.render()), /Sign in with the configured owner/);
  assert.match(text(autoSwitch(h.render())), /UNKNOWN/);
  assert.equal(autoSwitch(h.render()).props['aria-checked'], undefined);
  assert.doesNotMatch(autoSwitch(h.render()).props.className, /switch-on|switch-off/);
  assert.ok(nodes(h.render()).find(n => n.props?.['aria-label'] === 'Stop AQTE new entries'));
  await h.poll({ ...status, generated_at: Date.now() / 1000 - 11 });
  assert.match(text(h.render()), /stale/);
  assert.match(text(autoSwitch(h.render())), /UNKNOWN/);
  await h.poll(status);
  h.respond(status);
  autoSwitch(h.render()).props.onClick();
  await settle();
  assert.match(text(h.render()), /did not confirm/);
  assert.match(text(autoSwitch(h.render())), /UNKNOWN/);
  cleanup();
});

test('active protection stays visible with entries OFF; initial SL, trailing and bid target are distinct', () => {
  const live = { ...liveFixture(), active: livePositionFixture({ initial_stop: 80, stop: 105 }) };
  live.active.metrics = { ...live.active.metrics, ltp: 145, bid: 120 };
  const props = { symbol: 'NIFTY', active: true, unavailable: false, tick: null, liveStatus: live, onExit() {} };
  let tree = harness('AQTETerminal.tsx').render(props);
  const prices = nodes(tree).find(n => n.props?.['aria-label'] === 'Trade prices');
  const rows = nodes(prices).filter(n => n.props?.className === 'aqx-price-row');
  assert.match(text(rows[2]), /80\.00.*Initial level/);
  assert.match(text(rows[3]), /105\.00.*Broker-confirmed/);
  const rules = nodes(tree).find(n => n.props?.['aria-label'] === 'Auto exit rules');
  assert.match(text(rules), /ACTIVE/);
  assert.match(text(rules), /continues with Auto Trade OFF/);
  assert.doesNotMatch(text(tree), /Bid reached/);
  assert.ok(nodes(tree).filter(n => n.type === 'button' && /Book (25|50|75)%/.test(text(n))).every(n => n.props.disabled));
  live.active.metrics.bid = 145;
  tree = harness('AQTETerminal.tsx').render(props);
  assert.match(text(tree), /Bid reached · not a fill/);
  live.active.metrics.quote_at -= 6;
  tree = harness('AQTETerminal.tsx').render(props);
  assert.doesNotMatch(text(tree), /Bid reached|\+255\.05/);
  assert.match(text(tree), /Current quote\/P&L unavailable/);
  for (const failed of [
    { ...live, error: 'Broker reconciliation required' },
    { ...live, active: { ...live.active, error: 'Protective order is unverified' } },
  ]) {
    tree = harness('AQTETerminal.tsx').render({ ...props, liveStatus: failed });
    assert.match(text(nodes(tree).find(n => n.props?.role === 'alert')), /Broker reconciliation required|Protective order is unverified/);
  }
});

test('day summary uses backend entry counts and never treats an unavailable open mark as zero', () => {
  const h = harness();
  const publish = status => nodes(h.render()).find(n => n.props?.onStatus && 'exitRequest' in n.props).props.onStatus(status);
  const status = { ...liveFixture(), daily_counts: { executed: 3, reserved: 1 }, active: livePositionFixture(),
    trades: [10, -5, 0].map(net_pnl => ({ symbol: 'NIFTY', net_pnl, exit_at: Date.now() / 1000 })) };
  publish(status);
  let tree = h.render();
  const summary = () => nodes(tree).find(n => n.props?.['aria-label'] === 'Today summary');
  assert.match(text(summary()), /260\.05/);
  assert.match(text(summary()), /4 \/ 5/);
  assert.match(text(nodes(tree).find(n => n.props?.id === 'aqte-book-performance')), /Wins \/ Losses \/ Flat\s+1 \/ 1 \/ 1/);
  status.active.metrics.stale = true;
  publish(status);
  tree = h.render();
  assert.match(text(summary()), /Today P&L\s+--/);
  assert.doesNotMatch(text(summary()), /Safe|260\.05/);
  publish({ ...status, connection_error: 'Disconnected' });
  tree = h.render();
  assert.match(text(summary()), /Unverified/);
  assert.match(text(nodes(tree).find(n => n.props?.id === 'aqte-book-active')), /100/);
  assert.ok(nodes(tree).filter(n => n.type === 'button' && /Exit Now|Book All/.test(text(n))).every(n => n.props.disabled));
});

test('a replacement trade cannot be closed by an already-open selected-exit confirmation', async () => {
  const h = harness('AQTELiveController.tsx');
  h.render();
  const status = { ...liveFixture(), active: livePositionFixture() };
  const cleanup = h.mount(status);
  await settle();
  const request = { tradeId: status.active.id, contract: 'ORIGINAL_CONTRACT', quantity: 15, action: 'book' };
  h.render({ exitRequest: request });
  await h.poll({ ...status, active: livePositionFixture({ id: 'aaaaaaaaaaaaaaaa' }) });
  const dialog = nodes(h.render({ exitRequest: request })).find(n => n.props?.role === 'alertdialog');
  const confirm = nodes(dialog).find(n => n.type === 'button' && /Confirm selected/.test(text(n)));
  assert.ok(confirm.props.disabled);
  confirm.props.onClick();
  assert.equal(h.requests.filter(r => r.options.method === 'POST').length, 0);
  assert.match(text(dialog), /ORIGINAL_CONTRACT/);
  assert.match(text(dialog), /Selected trade changed/);
  let prevented = false, stopped = false;
  dialog.props.onKeyDown({ key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.equal(nodes(h.render({ exitRequest: request })).filter(n => n.props?.role === 'alertdialog').length, 0);
  cleanup();
});
function displayModule() {
  const code = ts.transpileModule(readFileSync(path.join(__dirname, '..', 'lib', 'aqte-display.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, Intl, Date });
  return exports;
}
const ENGINE_KEYS = ['momentum', 'breakout', 'trend', 'liquidity_sweep', 'order_flow', 'scalping', 'mean_reversion',
  'volatility_breakout', 'options', 'multi_timeframe', 'stat_arb', 'ml'];
function engineSet({ ce = 0, pe = 0, satisfied = ce + pe } = {}) {
  const engines = ENGINE_KEYS.map((key, index) => {
    const status = index < ce ? 'SATISFIED' : index < ce + pe ? 'SATISFIED' : index === 11 ? 'MONITORING' : index % 2 ? 'PARTIAL' : 'NOT_SATISFIED';
    const side = index < ce ? 'CE' : index < ce + pe ? 'PE' : null;
    const rules = [
      { id: 'a', label: `Rule A ${key}`, passed: status === 'SATISFIED' ? true : status === 'MONITORING' ? null : false, requirement: 'Needs A', value: index === 0 ? '1.60x' : null },
      { id: 'b', label: 'Rule B', passed: status !== 'NOT_SATISFIED' && status !== 'MONITORING', requirement: 'Needs B', value: null },
    ];
    const passed = rules.filter(rule => rule.passed === true).length;
    return { id: index + 1, key, name: `Engine ${index + 1}`, status, side, passed, total: 2, score: passed * 50,
      authority: key === 'ml' ? 'SHADOW' : key === 'scalping' ? 'ENTRY' : 'ADVISORY', rules,
      reason: key === 'ml' ? 'Shadow model not configured' : null };
  });
  const count = state => engines.filter(engine => engine.status === state).length;
  return {
    engines,
    orchestration: { satisfied: count('SATISFIED'), partial: count('PARTIAL'), monitoring: count('MONITORING'),
      not_satisfied: count('NOT_SATISFIED'), ce, pe, consensus: ce > pe ? 'CE' : pe > ce ? 'PE' : null,
      conflict: !!(ce && pe), evaluated: 11, consensus_pct: Math.max(ce, pe) ? Math.round(Math.max(ce, pe) / 11 * 100) : null },
    market: { regime: 'Trending Bullish', volatility: 'Moderate', liquidity: 'High', pcr: 1.18, vix: 14.2, vix_change_pct: 1.5 },
  };
}
function scalpSignal(decision = 'BUY CE', confidence = 80) {
  return { decision, strategy: decision === 'WAIT' ? null : 'quick_scalp_20', confidence: decision === 'WAIT' ? null : confidence,
    reasons: decision === 'WAIT' ? ['Waiting for a quick-scalp setup'] : ['Quick scalp'],
    contract: decision === 'WAIT' ? null : { trading_symbol: `NIFTY_SCALP_${decision.slice(-2)}`, expiry: '2026-11-03' },
    entry: decision === 'WAIT' ? null : { maximum: 100, stop: 90, target: 120, points: 20, reward_risk: 2 } };
}

test('engine ranking mirrors the live controller: actionable, aligned engines, then score', () => {
  const display = displayModule();
  const base = fixture().data;
  const data = {
    NIFTY: { ...base.NIFTY, ...engineSet({ ce: 2 }), scalp: scalpSignal('BUY CE', 95) },
    BANKNIFTY: { ...base.BANKNIFTY, ...engineSet({ pe: 5 }), scalp: scalpSignal('BUY PE', 70) },
    SENSEX: { ...base.SENSEX, ...engineSet({ ce: 9 }), scalp: scalpSignal('WAIT') },
  };
  assert.deepEqual([...display.aqteRanking(data)], ['BANKNIFTY', 'NIFTY', 'SENSEX']);
  // Swing style ranks the main signal, which is the only actionable one in this fixture.
  assert.deepEqual([...display.aqteRanking(data, { SENSEX: 'swing', NIFTY: 'swing', BANKNIFTY: 'swing' })], ['NIFTY', 'BANKNIFTY', 'SENSEX']);
  assert.deepEqual([...display.aqteRankKey(data.NIFTY)], [1, 2, 95]);
  assert.equal(display.aqteEffectiveSignal(data.SENSEX).decision, 'WAIT');
});

test('engine view rejects malformed or partial engine evaluations instead of displaying them', () => {
  const display = displayModule();
  const good = engineSet({ ce: 3 });
  assert.equal(display.aqteEngineView(good).engines.length, 12);
  assert.equal(display.aqteEngineView({ ...good, engines: good.engines.slice(1) }), null);
  assert.equal(display.aqteEngineView({ ...good, engines: good.engines.map((e, i) => i ? e : { ...e, status: 'GREAT' }) }), null);
  assert.equal(display.aqteEngineView({ ...good, engines: good.engines.map((e, i) => i ? e : { ...e, passed: 3 }) }), null);
  assert.equal(display.aqteEngineView({ ...good, orchestration: { ...good.orchestration, ce: -1 } }), null);
  assert.equal(display.aqteEngineView({ ...good, market: { regime: 5 } }).market, null);
  assert.equal(display.aqteEngineView({}), null);
  assert.equal(display.isAqteEngineEvent({ at: 1, symbol: 'NIFTY', engine: 3, name: 'Trend', status: 'SATISFIED', previous: null, side: 'CE' }), true);
  assert.equal(display.isAqteEngineEvent({ at: 1, symbol: 'FINNIFTY', engine: 3, name: 'Trend', status: 'SATISFIED', previous: null, side: 'CE' }), false);
});

test('engine deck shows 12 live engines, rule details on demand and an honest execution state', () => {
  const h = harness('AQTEEngineDeck.tsx');
  const data = fixture().data;
  data.NIFTY = { ...data.NIFTY, ...engineSet({ ce: 4, pe: 1 }), scalp: scalpSignal('BUY CE', 82) };
  const live = { ...liveFixture(), enabled: true, armed: true, automation_on: true,
    ranking: ['NIFTY', 'BANKNIFTY', 'SENSEX'], entry_blocks: { NIFTY: null, BANKNIFTY: 'No setup', SENSEX: 'No setup' } };
  const props = { symbol: 'NIFTY', data, liveStatus: live, unavailable: false, policy: { authority: 'ADVISORY_VETO', veto: true, veto_min: 2, engines: 12 },
    events: [{ at: Date.now() / 1000, symbol: 'NIFTY', engine: 1, name: 'Momentum', status: 'SATISFIED', previous: null, side: 'CE' }] };
  let tree = h.render(props);
  const cards = nodes(tree).filter(n => String(n.props?.className).includes('aqx-eng-card'));
  assert.equal(cards.length, 12);
  assert.ok(cards.every(card => !card.props.disabled && card.props['aria-expanded'] === false));
  assert.match(text(tree), /Satisfied \(5\)/);
  assert.match(text(tree), /Consensus\s+CE 36%/);
  const opportunity = nodes(tree).find(n => n.props?.['aria-label'] === 'Top opportunity');
  assert.match(text(opportunity), /NIFTY_SCALP_CE/);
  assert.match(text(opportunity), /4 aligned · 1 opposed/);
  assert.match(text(opportunity), /Score\s+82%/);
  assert.match(text(opportunity), /Auto Execution:\s+READY/);
  assert.match(text(opportunity), /Eligible · central controller places the IOC entry/);
  const orchestration = text(nodes(tree).find(n => n.props?.['aria-label'] === 'Orchestration and risk'));
  assert.match(orchestration, /Signal Aggregation\s+4 aligned · 1 opposed/);
  assert.match(orchestration, /Quantity Control\s+1 lot \(enforced\)/);
  const management = text(nodes(tree).find(n => n.props?.['aria-label'] === 'Enterprise trade management'));
  assert.match(management, /Initial Stop Loss\s+₹90\.00/);
  assert.match(management, /Arms after fill/, 'No trailing before a broker-confirmed fill');
  assert.match(text(nodes(tree).find(n => n.props?.['aria-label'] === 'Live P&L current trade')), /No open trade/);
  assert.match(text(nodes(tree).find(n => n.props?.['aria-label'] === 'Recent executions')), /No AQTE executions today/);
  assert.match(text(nodes(tree).find(n => n.props?.['aria-label'] === 'Live engine events')), /NIFTY · Engine 01 \(Momentum\)/);
  // Analytics tabs: the Engine Signals view lists all 12 engines; arrow keys move between views.
  nodes(tree).find(n => n.props?.id === 'aqte-ctab-chart').props.onKeyDown({ key: 'ArrowRight', preventDefault() {},
    currentTarget: { parentElement: { querySelectorAll: () => [] } } });
  tree = h.render(props);
  assert.equal(nodes(tree).find(n => n.props?.id === 'aqte-ctab-signals').props['aria-selected'], true);
  assert.equal(nodes(nodes(tree).find(n => n.props?.id === 'aqte-cpanel-signals')).filter(n => n.type === 'tr').length, 13);
  assert.equal(nodes(tree).find(n => n.props?.id === 'aqte-engine-rules').props.hidden, true);
  cards[0].props.onClick();
  tree = h.render(props);
  const rules = nodes(tree).find(n => n.props?.id === 'aqte-engine-rules');
  assert.equal(rules.props.hidden, false);
  assert.match(text(rules), /Rule A momentum/);
  assert.match(text(rules), /1\.60x/);
  nodes(tree).find(n => n.type === 'button' && /^Partial/.test(text(n).trim())).props.onClick();
  tree = h.render(props);
  const dimmed = nodes(tree).filter(n => String(n.props?.className).includes('aqx-eng-dim'));
  assert.equal(dimmed.length, 12 - engineSet({ ce: 4, pe: 1 }).orchestration.partial);

  // Opposition beyond the veto threshold is shown as a conflict, never as eligible execution.
  data.NIFTY = { ...data.NIFTY, ...engineSet({ ce: 1, pe: 3 }) };
  tree = h.render({ ...props, data, liveStatus: { ...live, entry_blocks: { NIFTY: 'Engine conflict: 3 satisfied engines oppose CE (1 aligned); WAIT' } } });
  const blocked = text(nodes(tree).find(n => n.props?.['aria-label'] === 'Top opportunity'));
  assert.match(blocked, /Engine conflict/);
  assert.match(blocked, /Veto · WAIT/);
  assert.doesNotMatch(blocked, /Eligible|READY/);
  // Even before the controller reports the block, a veto is never shown as eligible.
  tree = h.render({ ...props, data });
  const vetoed = text(nodes(tree).find(n => n.props?.['aria-label'] === 'Top opportunity'));
  assert.match(vetoed, /Engine veto · WAIT \(3 oppose CE, 1 aligned\)/);
  assert.doesNotMatch(vetoed, /Eligible|READY/);
  assert.match(text(nodes(tree).find(n => n.props?.['aria-label'] === 'Orchestration and risk')), /Conflict Check\s+Veto · WAIT/);
});

test('engine deck keeps stable placeholders when engines are unavailable or AQTE is offline', () => {
  const h = harness('AQTEEngineDeck.tsx');
  const data = fixture().data;
  data.NIFTY = { ...data.NIFTY, ...engineSet({ ce: 6 }), scalp: scalpSignal('BUY CE') };
  const tree = h.render({ symbol: 'NIFTY', data, liveStatus: null, unavailable: true, policy: null, events: [] });
  const cards = nodes(tree).filter(n => String(n.props?.className).includes('aqx-eng-card'));
  assert.equal(cards.length, 12);
  assert.ok(cards.every(card => card.props.disabled));
  assert.match(text(tree), /Momentum/);
  assert.match(text(tree), /ML Prediction/);
  assert.doesNotMatch(text(tree), /Trending Bullish|NIFTY_SCALP_CE|Eligible/);
  assert.match(text(tree), /Engine events unavailable/);
  const missing = h.render({ symbol: 'BANKNIFTY', data, liveStatus: null, unavailable: false, policy: null, events: [] });
  assert.ok(nodes(missing).filter(n => String(n.props?.className).includes('aqx-eng-card')).every(card => card.props.disabled));
  assert.match(text(nodes(missing).find(n => n.props?.['aria-label'] === 'Top opportunity')), /Controller status unavailable/);
});

test('execution preflight failure is NOT ARMED rather than an ordinary technical signal wait', () => {
  const now = Date.now() / 1000;
  const h = harness('AQTEEngineDeck.tsx');
  const reason = 'Outbound IP does not match allowlisted IP';
  const signalWait = 'RSI outside scalp momentum band';
  const data = { ...fixture().data, NIFTY: { ...fixture().data.NIFTY,
    scalp: { ...scalpSignal('WAIT'), reasons: [signalWait] } } };
  const live = { ...liveFixture(), generated_at: now, enabled: true, entry_window: true,
    armed: false, automation_on: false, automation_wanted: true, automation_waiting: reason,
    ranking: ['NIFTY'], entry_blocks: { NIFTY: signalWait } };
  const props = { symbol: 'NIFTY', data, liveStatus: live, unavailable: false, policy: null, events: [], now };
  const execution = tree => nodes(tree).find(n => n.props?.role === 'status' && String(n.props.className).split(' ').includes('aqx-exec'));
  const waiting = h.render(props);
  assert.match(text(execution(waiting)), /Auto Execution:\s+NOT ARMED/);
  assert.match(text(execution(waiting)), /Outbound IP does not match allowlisted IP/);
  assert.doesNotMatch(text(execution(waiting)), /RSI|READY|Eligible/);
  const row = nodes(nodes(waiting).find(n => n.props?.['aria-label'] === 'Index ranking')).find(n => n.type === 'li');
  assert.equal(row.props.title, signalWait);
  const armed = h.render({ ...props, liveStatus: { ...live, armed: true, automation_on: true, automation_waiting: null } });
  assert.match(text(execution(armed)), /Auto Execution:\s+WAITING/);
  assert.match(text(execution(armed)), /RSI outside scalp momentum band/);
  assert.doesNotMatch(text(execution(armed)), /NOT ARMED|READY|Eligible/);
});

test('opportunity readiness expires with controller status and respects errors and the entry window', () => {
  const now = Date.now() / 1000;
  const h = harness('AQTEEngineDeck.tsx');
  const data = fixture().data;
  data.NIFTY = { ...data.NIFTY, ...engineSet({ ce: 4 }), scalp: scalpSignal('BUY CE', 90) };
  const live = { ...liveFixture(), generated_at: now, enabled: true, armed: true,
    automation_on: true, entry_window: true, ranking: ['NIFTY'], entry_blocks: { NIFTY: null } };
  const props = { symbol: 'NIFTY', data, liveStatus: live, unavailable: false, policy: null, events: [], now };
  const panel = tree => text(nodes(tree).find(n => n.props?.['aria-label'] === 'Top opportunity'));
  assert.match(panel(h.render(props)), /Auto Execution:\s+READY/);
  assert.match(panel(h.render({ ...props, now: now + 10 })), /Auto Execution:\s+READY/);
  for (const change of [{ now: now + 10.01 }, { liveStatus: { ...live, generated_at: now + 2 } },
    { liveStatus: { ...live, connection_error: 'Disconnected' } }, { liveStatus: { ...live, ready: false } }]) {
    const tree = h.render({ ...props, ...change });
    assert.match(panel(tree), /Auto Execution:\s+UNKNOWN/);
    assert.doesNotMatch(panel(tree), /READY|Eligible|Top pick/);
    assert.doesNotMatch(text(nodes(tree).find(n => n.props?.['aria-label'] === 'Orchestration and risk')),
      /Risk Validation\s+Passed|Position & Exposure\s+Within limits|Next entry routes to Zerodha/);
  }
  for (const [change, reason] of [
    [{ error: 'Broker account identity changed' }, /Broker account identity changed/],
    [{ entry_window: false }, /09:15.*15:15/],
    [{ flatten_pending: true }, /Emergency square-off pending/],
  ]) {
    const output = panel(h.render({ ...props, liveStatus: { ...live, ...change } }));
    assert.match(output, reason);
    assert.doesNotMatch(output, /READY|Eligible/);
  }
  const unknownTrade = h.render({ ...props, now: now + 11,
    liveStatus: { ...live, active: livePositionFixture() } });
  assert.match(panel(unknownTrade), /UNKNOWN/);
  assert.match(text(nodes(unknownTrade).find(n => n.props?.['aria-label'] === 'Enterprise trade management')),
    /Initial Stop Loss\s+₹80\.00/, 'retain recorded trade levels, but do not confirm current protection');
  assert.doesNotMatch(text(unknownTrade), /Sent to Live Execution \(Zerodha\)/);
});

test('auto execution highlights ready entries and current trades, with a stronger border only in trade', () => {
  const now = Date.now() / 1000;
  const h = harness('AQTEEngineDeck.tsx');
  const data = fixture().data;
  data.NIFTY = { ...data.NIFTY, ...engineSet({ ce: 4 }), scalp: scalpSignal('BUY CE', 90) };
  const live = { ...liveFixture(), generated_at: now, armed: true, automation_on: true, entry_window: true,
    ranking: ['NIFTY'], entry_blocks: { NIFTY: null } };
  const render = changes => nodes(h.render({ symbol: 'NIFTY', data, liveStatus: { ...live, ...changes },
    unavailable: false, policy: null, events: [], now }))
    .find(n => n.props?.role === 'status' && String(n.props.className).split(' ').includes('aqx-exec'));
  for (const [changes, label, state] of [
    [{}, 'READY', 'ready'],
    [{ active: livePositionFixture() }, 'IN TRADE', 'live'],
    [{ entry_window: false }, 'WAITING', 'wait'],
    [{ automation_on: false, armed: false }, 'OFF', 'off'],
    [{ killed: true }, 'STOPPED', 'stop'],
    [{ error: 'Broker unavailable' }, 'BLOCKED', 'off'],
    [{ generated_at: now - 11, active: livePositionFixture() }, 'UNKNOWN', 'wait'],
  ]) {
    const panel = render(changes);
    assert.match(text(panel), new RegExp(`Auto Execution:\\s+${label}`));
    assert.equal(panel.props.className, `aqx-exec aqx-exec-${state}`);
  }
  const styles = readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8');
  assert.match(styles, /\.aqx-exec:is\(\.aqx-exec-ready, \.aqx-exec-live\) \{\s*border-color: rgb\(74 222 128 \/ 0\.6\); background: transparent; box-shadow: none;/);
  assert.match(styles, /\.aqx-exec:is\(\.aqx-exec-ready, \.aqx-exec-live\) :is\(p, b, small, \.aqx-exec-mark\) \{\s*color: var\(--aqx-green-text\);/);
  assert.match(styles, /\.aqx-exec\.aqx-exec-live \{\s*border-color: var\(--aqx-green-text\);\s*box-shadow: 0 0 0 1px rgb\(74 222 128 \/ 0\.22\), 0 0 16px rgb\(34 197 94 \/ 0\.18\);/);
});

test('opportunity levels show the controller entry plan, not the uncapped raw rule levels', () => {
  const now = Date.now() / 1000;
  const h = harness('AQTEEngineDeck.tsx');
  const data = fixture().data;
  data.NIFTY = { ...data.NIFTY, ...engineSet({ ce: 4 }), scalp: scalpSignal('BUY CE', 90) };
  const live = { ...liveFixture(), generated_at: now, enabled: true, armed: true,
    automation_on: true, entry_window: true, ranking: ['NIFTY'], entry_blocks: { NIFTY: null },
    entry_plans: { NIFTY: { maximum: 101, stop: 97.25, target: 111.5, reward_risk: 2.4, quantity: 65, risk: 290, points: 10 } } };
  const display = displayModule();
  assert.equal(display.isAqteLiveState(live), true);
  assert.equal(display.isAqteLiveState({ ...live, entry_plans: { NIFTY: { ...live.entry_plans.NIFTY, stop: 120 } } }), false,
    'reject inverted levels');
  const props = { symbol: 'NIFTY', data, liveStatus: live, unavailable: false, policy: null, events: [], now };
  const panel = tree => text(nodes(tree).find(n => n.props?.['aria-label'] === 'Top opportunity'));
  const shown = panel(h.render(props));
  assert.match(shown, /Target\s*₹111\.50/);
  assert.match(shown, /Stop Loss\s*₹97\.25/);
  assert.match(shown, /1 : 2\.4/);
  // The controller reports plans but has none for this index: never fall back to levels it would not send.
  const none = panel(h.render({ ...props, liveStatus: { ...live, entry_plans: { NIFTY: null } } }));
  assert.doesNotMatch(none, /₹111\.50|₹97\.25/);
});

test('top opportunity follows the controller: first unblocked ranked index, else the top-ranked block reason', () => {
  const display = displayModule();
  assert.equal(display.aqteOpportunitySymbol(['NIFTY', 'BANKNIFTY', 'SENSEX'], { NIFTY: 'Daily index trade limit reached', BANKNIFTY: null }), 'BANKNIFTY');
  assert.equal(display.aqteOpportunitySymbol(['NIFTY', 'BANKNIFTY'], { NIFTY: 'x', BANKNIFTY: 'y' }), 'NIFTY');
  assert.equal(display.aqteOpportunitySymbol(['SENSEX'], undefined), 'SENSEX');
  assert.equal(display.aqteOpportunitySymbol([], {}), null);

  const h = harness('AQTEEngineDeck.tsx');
  const data = fixture().data;
  data.NIFTY = { ...data.NIFTY, ...engineSet({ ce: 4 }), scalp: scalpSignal('BUY CE', 90) };
  data.BANKNIFTY = { ...data.BANKNIFTY, ...engineSet({ pe: 3 }), scalp: scalpSignal('BUY PE', 75) };
  const live = { ...liveFixture(), enabled: true, armed: true, automation_on: true,
    ranking: ['NIFTY', 'BANKNIFTY', 'SENSEX'], entry_blocks: { NIFTY: 'Daily index trade limit reached', BANKNIFTY: null, SENSEX: 'No setup' } };
  const props = { symbol: 'NIFTY', data, liveStatus: live, unavailable: false, policy: { veto: true, veto_min: 2 }, events: [] };
  // automated_entry would skip the blocked NIFTY and enter BANKNIFTY, so the panel must show BANKNIFTY.
  const panel = text(nodes(h.render(props)).find(n => n.props?.['aria-label'] === 'Top opportunity'));
  assert.match(panel, /NIFTY_SCALP_PE/);
  assert.match(panel, /3 aligned · 0 opposed/);
  assert.match(panel, /Auto Execution:\s+READY/);
  const ladder = nodes(nodes(h.render(props)).find(n => n.props?.['aria-label'] === 'Index ranking')).filter(n => n.type === 'li');
  assert.deepEqual(ladder.map(row => text(row).replace(/\s+/g, ' ').trim()),
    ['1 NIFTY Limit reached CE 90%', '♛ BANK NIFTY Top pick PE 75%', '3 SENSEX Waiting for signal WAIT --']);
  assert.deepEqual(ladder.map(row => row.props.className), ['', 'aqx-rank-top', '']);
  assert.deepEqual(ladder.map(row => row.props.title), ['Daily index trade limit reached', undefined, 'No setup'],
    'every short row label carries the controller reason as a tooltip');
  // A capped index cannot enter today, so the next ranked index that still can explains the wait.
  const blocked = text(nodes(h.render({ ...props, liveStatus: { ...live, entry_blocks: { ...live.entry_blocks, BANKNIFTY: 'No setup' } } }))
    .find(n => n.props?.['aria-label'] === 'Top opportunity'));
  assert.match(blocked, /NIFTY_SCALP_PE/);
  assert.match(blocked, /No setup/);
  assert.match(blocked, /Top · Waiting for entry/);
  assert.doesNotMatch(blocked, /READY|Eligible/);
  // Every index capped: the top-ranked one is shown and the card says nothing can trade today.
  const capped = 'Daily index trade limit reached';
  const held = text(nodes(h.render({ ...props, liveStatus: { ...live, entry_blocks: { NIFTY: capped, BANKNIFTY: capped, SENSEX: capped } } }))
    .find(n => n.props?.['aria-label'] === 'Top opportunity'));
  assert.match(held, /NIFTY_SCALP_CE/);
  assert.match(held, /Auto Execution:\s+BLOCKED/);
  assert.match(held, /No index can trade today/);
});

test('index ranking waits independently with stable text and changing reasons only in descriptions', () => {
  const now = Date.now() / 1000;
  const h = harness('AQTEEngineDeck.tsx');
  const reasons = {
    NIFTY: 'No fresh 20-candle breakout',
    BANKNIFTY: 'RSI outside scalp momentum band',
    SENSEX: 'Order-book imbalance does not confirm',
  };
  const data = Object.fromEntries(Object.entries(reasons).map(([symbol, reason]) =>
    [symbol, { ...fixture().data[symbol], scalp: { ...scalpSignal('WAIT'), reasons: [reason] } }]));
  const live = { ...liveFixture(), generated_at: now, enabled: true, armed: true,
    automation_on: true, entry_window: true, ranking: Object.keys(reasons), entry_blocks: { ...reasons } };
  const props = { symbol: 'NIFTY', data, liveStatus: live, unavailable: false, policy: null, events: [], now };
  const panel = tree => nodes(tree).find(n => n.props?.['aria-label'] === 'Top opportunity');
  const rows = tree => nodes(nodes(tree).find(n => n.props?.['aria-label'] === 'Index ranking')).filter(n => n.type === 'li');
  const reasonOf = row => row.props['aria-description'] ?? '';

  const waiting = h.render(props);
  assert.doesNotMatch(text(panel(waiting)), /Blocked|BLOCKED|READY|Eligible/);
  assert.match(text(panel(waiting)), /Auto Execution:\s+WAITING/);
  assert.deepEqual(rows(waiting).map(reasonOf), Object.values(reasons));
  assert.ok(rows(waiting).every(row => /Waiting for signal/.test(text(row)) && row.props['data-side'] === 'WAIT'));
  const visibleRows = rows(waiting).map(text);
  for (const reason of ['Breakout volume below 1.5x', 'No scalp bias: price vs VWAP and EMA 9/20 disagree',
    'Liquidity-sweep reversal: Fully stacked opposite trend; no reversal; Volume below 1.5x average; Live futures gave back the reclaim']) {
    const updated = h.render({ ...props, liveStatus: { ...live,
      entry_blocks: { NIFTY: reason, BANKNIFTY: reason, SENSEX: reason } } });
    assert.deepEqual(rows(updated).map(text), visibleRows, 'technical reason changes must not change visible row content');
    assert.ok(rows(updated).every(row => row.props.title === reason && reasonOf(row) === reason));
    assert.ok(rows(updated).every(row => !nodes(row).some(node => node.props?.className === 'aqx-rank-reason')));
  }

  for (const [symbol, side] of [['NIFTY', 'CE'], ['BANKNIFTY', 'PE'], ['SENSEX', 'CE']]) {
    const tree = h.render({ ...props, data: { ...data, [symbol]: { ...data[symbol], scalp: scalpSignal(`BUY ${side}`) } },
      liveStatus: { ...live, entry_blocks: { ...reasons, [symbol]: null } } });
    const ladder = rows(tree);
    const selected = ladder.find(row => row.props.className === 'aqx-rank-top');
    assert.match(text(selected), /Top pick/);
    assert.match(text(selected), new RegExp(symbol === 'BANKNIFTY' ? 'BANK NIFTY' : symbol));
    assert.equal(selected.props['data-side'], side);
    assert.equal(reasonOf(selected), '', 'a ready index never inherits another index wait reason');
    assert.match(text(panel(tree)), /Auto Execution:\s+READY/);
    assert.deepEqual(ladder.filter(row => row !== selected).map(reasonOf),
      Object.entries(reasons).filter(([name]) => name !== symbol).map(([, reason]) => reason));
    assert.ok(ladder.filter(row => row !== selected).every(row => /Waiting for signal/.test(text(row))));
  }

  const noApproval = h.render({ ...props, liveStatus: { ...live, automation_on: false, armed: false } });
  assert.match(text(panel(noApproval)), /Auto Execution:\s+OFF/);
  assert.ok(rows(noApproval).every(row => /Waiting for signal/.test(text(row))));
  const beforeStatus = h.render({ ...props, liveStatus: null });
  assert.deepEqual(rows(beforeStatus).map(reasonOf), Object.values(reasons));
  assert.ok(rows(beforeStatus).every(row => /Waiting for signal/.test(text(row))));
  assert.match(text(panel(beforeStatus)), /Auto Execution:\s+UNKNOWN/);
  const offline = h.render({ ...props, unavailable: true });
  assert.ok(rows(offline).every(row => /No data/.test(text(row)) && reasonOf(row) === ''));
  const inconsistent = h.render({ ...props, liveStatus: { ...live, entry_blocks: { NIFTY: null, BANKNIFTY: null, SENSEX: null } } });
  assert.ok(rows(inconsistent).every(row => /Waiting for signal/.test(text(row))));
  assert.doesNotMatch(text(panel(inconsistent)), /READY|Eligible|Top pick|Clear/);
});

test('un-evaluated engines read as awaiting data with the backend reason, and empty levels stay neutral', () => {
  const display = displayModule();
  assert.equal(display.aqteSameJson({ a: [1, { b: null }] }, { a: [1, { b: null }] }), true);
  assert.equal(display.aqteSameJson({ a: [1] }, { a: [2] }), false);
  assert.equal(display.aqteSameJson(null, null), true);

  const h = harness('AQTEEngineDeck.tsx');
  const data = fixture().data;
  const reason = 'Outside regular market session';
  const idle = engineSet();
  data.NIFTY = { ...data.NIFTY, scalp: scalpSignal('WAIT'),
    engines: idle.engines.map(engine => ({ ...engine, status: 'MONITORING', side: null, passed: 0, total: 0, score: null, rules: [], reason })),
    orchestration: { satisfied: 0, partial: 0, monitoring: 12, not_satisfied: 0, ce: 0, pe: 0, consensus: null, conflict: false, evaluated: 0, consensus_pct: null } };
  const tree = h.render({ symbol: 'NIFTY', data, liveStatus: { ...liveFixture(), ranking: ['NIFTY'], entry_blocks: { NIFTY: reason } },
    unavailable: false, policy: null, events: [] });
  const cards = nodes(tree).filter(n => String(n.props?.className).includes('aqx-eng-card'));
  assert.equal(cards.length, 12);
  assert.ok(cards.every(card => !card.props.disabled && card.props.title === reason));
  assert.ok(cards.every(card => /Market closed/.test(text(card)) && !/0 \/ 0/.test(text(card))));
  for (const [why, label] of [['Warming up: need 20 contiguous completed one-minute futures candles', 'Warming up'],
    ['Market data stale: futures last tick 9s ago', 'Feed stale'], [null, 'Awaiting live data']]) {
    const warm = { ...data, NIFTY: { ...data.NIFTY, engines: data.NIFTY.engines.map(engine => ({ ...engine, reason: why })) } };
    const card = nodes(h.render({ symbol: 'NIFTY', data: warm, liveStatus: null, unavailable: false, policy: null, events: [] }))
      .find(n => String(n.props?.className).includes('aqx-eng-card'));
    assert.match(text(card), new RegExp(label));
  }
  const head = text(nodes(tree).find(n => n.props?.className === 'aqx-deck-title'));
  assert.match(head, /All engines monitoring/);
  assert.match(head, /Outside regular market session/);
  const levels = nodes(nodes(tree).find(n => n.props?.['aria-label'] === 'Top opportunity')).filter(n => n.type === 'dd');
  assert.equal(levels.length, 5);
  assert.ok(levels.every(dd => !dd.props.className), 'No buy/sell colour without an entry plan');
  const management = nodes(nodes(tree).find(n => n.props?.['aria-label'] === 'Enterprise trade management')).filter(n => n.type === 'dd');
  assert.equal(management.length, 6);
  assert.ok(management.every(dd => !dd.props.className), 'Empty stop/target rows are not coloured');
  const risk = nodes(nodes(tree).find(n => n.props?.['aria-label'] === 'Orchestration and risk')).find(n => n.type === 'li' && /Risk Validation/.test(text(n)));
  assert.equal(risk.props.title, reason, 'Blocked risk check explains why');
});

test('trade management and risk checks for a pending and a protected controller position', () => {
  const h = harness('AQTEEngineDeck.tsx');
  const data = fixture().data;
  data.NIFTY = { ...data.NIFTY, ...engineSet({ ce: 3 }), scalp: scalpSignal('WAIT') };
  // Controller semantics: entry_price stays 0 until the broker fill; trail_start_r may be omitted (backend default 1R).
  const pending = livePositionFixture({ state: 'PENDING', filled: 0, entry_price: 0, fill_at: undefined, limit: 100,
    initial_stop: 80, stop: 80, peak: 0, trailing_active: false, protection_confirmed: false, protect_id: null });
  const live = { ...liveFixture(), enabled: true, armed: true, automation_on: true, active: pending,
    limits: { ...liveFixture().limits, max_lots: 2 }, ranking: ['NIFTY'], entry_blocks: { NIFTY: 'One managed position already open' } };
  const props = { symbol: 'NIFTY', data, liveStatus: live, unavailable: false, policy: null, events: [] };
  let tree = h.render(props);
  const management = text(nodes(tree).find(n => n.props?.['aria-label'] === 'Enterprise trade management'));
  assert.match(management, /Trail Distance\s+₹20\.00 · from \+1\.0R/, 'Pending entry measures 1R from its limit, not entry_price 0');
  assert.match(management, /Initial Stop Loss\s+₹80\.00\s+\(\s*-20\.00%\s*\)/);
  const checks = nodes(nodes(tree).find(n => n.props?.['aria-label'] === 'Orchestration and risk')).filter(n => n.type === 'li');
  const check = label => checks.find(li => text(li).includes(label));
  assert.equal(check('Position & Exposure').props.className, 'aqx-pending', 'An open trade is capacity in use, not a failure');
  assert.match(text(check('Position & Exposure')), /1 \/ 1 open/);
  assert.match(text(check('Quantity Control')), /2 lots \(enforced\)/);
  assert.equal(check('Trailing Stop').props.className, 'aqx-fail');
  assert.match(text(check('Trailing Stop')), /SL unconfirmed/);

  tree = h.render({ ...props, liveStatus: { ...live, active: livePositionFixture({ trailing_active: false, trail_start_r: undefined }) } });
  const protectedChecks = text(nodes(tree).find(n => n.props?.['aria-label'] === 'Orchestration and risk'));
  assert.match(protectedChecks, /Trailing Stop\s+Arms at \+1\.0R/);
  assert.match(text(nodes(tree).find(n => n.props?.['aria-label'] === 'Enterprise trade management')), /Trail Distance\s+₹20\.00 · from \+1\.0R/);
});

test('AQTE section renders the engine deck from the snapshot and drops malformed engine events', async () => {
  const h = harness();
  h.render();
  const snapshot = fixture();
  snapshot.data.NIFTY = { ...snapshot.data.NIFTY, ...engineSet({ ce: 3 }) };
  snapshot.engine_events = [
    { at: Date.now() / 1000, symbol: 'NIFTY', engine: 3, name: 'Trend Following', status: 'SATISFIED', previous: 'PARTIAL', side: 'CE' },
    { at: 'bad', symbol: 'NIFTY', engine: 1, name: 'Injected', status: 'SATISFIED', previous: null, side: 'CE' },
  ];
  snapshot.engine_policy = { authority: 'ADVISORY_VETO', veto: true, veto_min: 2, engines: 12 };
  const cleanup = h.mount(snapshot);
  await settle();
  const deck = nodes(h.render()).find(n => n.props?.['aria-label'] === 'AQTE strategy engines');
  assert.ok(deck);
  assert.match(text(deck), /NIFTY · Engine 03 \(Trend Following\)/);
  assert.doesNotMatch(text(deck), /Injected/);
  // Market context tiles come from the same validated engine snapshot.
  const context = text(nodes(h.render()).find(n => n.props?.['aria-label'] === 'Market context'));
  assert.match(context, /Trending Bullish/);
  assert.match(context, /PCR\s+1\.18/);
  assert.match(context, /India VIX\s+14\.20\s+\(\s*\+1\.50%\s*\)/);
  const nav = nodes(h.render()).filter(n => String(n.props?.className).includes('aqx-nav-item'));
  assert.equal(nav.length, 0);
  assert.match(text(nodes(h.render()).find(n => n.props?.['aria-label'] === 'System health')), /System\s+(Healthy|Degraded|Offline)/);
  cleanup();
});

test('live trade terminal keeps empty levels neutral and formats ring, lots and signed rupees', () => {
  const h = harness('AQTETerminal.tsx');
  const dd = (tree, label) => nodes(nodes(tree).find(n => n.props?.['aria-label'] === 'Trade prices'))
    .find(n => n.props?.className === 'aqx-price-row' && text(n).trim().startsWith(label)).props.children[1];
  const ring = tree => nodes(nodes(tree).find(n => n.props?.['aria-label'] === 'Open profit and loss'));
  let tree = h.render({ symbol: 'NIFTY', signal: fixture().data.NIFTY, unavailable: false, liveStatus: liveFixture() });
  assert.equal(dd(tree, 'Stop Loss').props.className, '', 'No red placeholder without a trade');
  assert.equal(dd(tree, 'Trailing SL').props.className, '', 'No cyan placeholder without a trade');
  assert.equal(text(ring(tree).find(n => n.type === 'strong')).trim(), '--', 'No "-- pts" placeholder');
  assert.match(text(nodes(tree).find(n => n.props?.['aria-label'] === 'Position')), /1 lot max/);

  const live = liveFixture();
  live.active = livePositionFixture({ metrics: { ...positionFixture().metrics, points: -4, net_pnl: -72.5, return_pct: -4 } });
  tree = h.render({ symbol: 'NIFTY', signal: fixture().data.NIFTY, unavailable: false, liveStatus: live });
  assert.equal(dd(tree, 'Stop Loss').props.className, 'aqx-down');
  assert.equal(dd(tree, 'Trailing SL').props.className, 'aqx-cyan');
  assert.match(text(ring(tree).find(n => n.type === 'strong')), /-4\.00\s+pts/);
  assert.equal(text(ring(tree).find(n => n.type === 'em')).trim(), '−₹72.50', 'Sign precedes the currency symbol');
  const position = text(nodes(tree).find(n => n.props?.['aria-label'] === 'Position'));
  assert.match(position, /\b1 lot\b/);
  assert.doesNotMatch(position, /1\.00 lots/);
  live.active = livePositionFixture({ filled: 30 });
  tree = h.render({ symbol: 'NIFTY', signal: fixture().data.NIFTY, unavailable: false, liveStatus: live });
  assert.match(text(nodes(tree).find(n => n.props?.['aria-label'] === 'Position')), /\b2 lots\b/);
});

test('hidden index terminals skip re-renders until their tab is selected again', () => {
  const equal = harness('AQTETerminal.tsx').exports.aqteTerminalPropsEqual;
  const base = { symbol: 'NIFTY', unavailable: false, liveStatus: null, now: 100, paused: true };
  assert.equal(equal(base, { ...base, now: 101, liveStatus: liveFixture() }), true, 'Hidden tab ignores clock and status churn');
  assert.equal(equal(base, { ...base, now: 101, paused: false }), false, 'Re-selecting renders current data at once');
  const shown = { ...base, paused: false };
  assert.equal(equal(shown, { ...shown }), true);
  assert.equal(equal(shown, { ...shown, now: 101 }), false, 'Visible tab follows the clock');
  const h = harness();
  const terminals = nodes(h.render()).filter(n => n.props && 'paused' in n.props && 'onExit' in n.props);
  assert.deepEqual(terminals.map(n => [n.props.symbol, n.props.paused]),
    [['NIFTY', false], ['BANKNIFTY', true], ['SENSEX', true]]);
});

test('today performance keeps the win-rate placeholder neutral and colours real win rates', () => {
  const h = harness();
  const publish = status => nodes(h.render()).find(n => n.props?.onStatus && 'exitRequest' in n.props).props.onStatus(status);
  const winRate = () => nodes(nodes(h.render()).find(n => n.props?.['aria-label'] === 'Today summary'))
    .filter(n => n.type === 'div').find(n => /^Win Rate/.test(text(n).trim())).props.children[1];
  assert.equal(winRate().props.className, '');
  assert.equal(text(winRate()).trim(), '--');
  const at = Date.now() / 1000;
  publish({ ...liveFixture(), trades: [10, -5, -2].map(net_pnl => ({ symbol: 'NIFTY', net_pnl, exit_at: at })) });
  assert.equal(text(winRate()).trim(), '33%');
  assert.equal(winRate().props.className, 'aqx-down');
  publish({ ...liveFixture(), trades: [10, 5, -2].map(net_pnl => ({ symbol: 'NIFTY', net_pnl, exit_at: at })) });
  assert.equal(text(winRate()).trim(), '67%');
  assert.equal(winRate().props.className, 'aqx-up');
});

test('live engine events show an offline dot and label when AQTE data is unavailable', () => {
  const deck = harness('AQTEEngineDeck.tsx');
  const head = props => nodes(nodes(deck.render(props)).find(n => n.props?.['aria-label'] === 'Live engine events')).find(n => n.type === 'h3');
  const base = { symbol: 'NIFTY', data: fixture().data, liveStatus: null, events: [], policy: null, now: Date.now() / 1000 };
  let h3 = head({ ...base, unavailable: true });
  assert.match(text(h3), /\(Offline\)/);
  assert.match(nodes(h3).find(n => n.type === 'span').props.className, /aqx-live-dot-off/);
  h3 = head({ ...base, unavailable: false });
  assert.match(text(h3), /\(Real-time\)/);
  assert.doesNotMatch(nodes(h3).find(n => n.type === 'span').props.className, /off/);
  const styles = readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8');
  assert.match(styles, /\.aqx-live-dot\.aqx-live-dot-off \{[^}]*animation: none/);
  assert.match(styles, /\.aqx-perfbar \.aqx-perf-risk dd \{ white-space: normal; \}/, 'Daily Risk figure wraps on narrow cells');
});
test('emergency trades with an unverified exit keep the live status valid and never count as flat P&L', () => {
  const { isAqteLiveState, aqteDaySummary } = displayModule();
  const at = Date.now() / 1000;
  const status = { ...liveFixture(), generated_at: at, trades: [
    { symbol: 'NIFTY', net_pnl: 25, exit_at: at - 60, exit_price: 120, entry_price: 100 },
    { symbol: 'NIFTY', net_pnl: 0, exit_at: at, exit_price: null, entry_price: 100, exit_unverified: true, exit_requested: 'EMERGENCY_STOP' },
  ] };
  assert.equal(isAqteLiveState(status), true);
  assert.equal(isAqteLiveState({ ...status, trades: [{ ...status.trades[1], exit_unverified: 'yes' }] }), false);
  assert.equal(isAqteLiveState({ ...status, trades: [{ ...status.trades[1], exit_price: 'x' }] }), false);
  const day = aqteDaySummary(status, at);
  assert.equal(day.realized, null);
  assert.equal(day.dayPnl, null);
  assert.equal(day.lossLeft, null);
  assert.deepEqual([day.wins, day.losses, day.breakeven, day.unverified], [1, 0, 0, 1]);
  const verified = aqteDaySummary({ ...status, trades: [status.trades[0]] }, at);
  assert.deepEqual([verified.realized, verified.dayPnl, verified.unverified], [25, 25, 0]);

  const h = harness();
  nodes(h.render()).find(n => n.props?.onStatus && 'exitRequest' in n.props).props.onStatus(status);
  const tree = h.render();
  const today = text(nodes(tree).find(n => n.props?.id === 'aqte-book-today'));
  assert.match(today, /EMERGENCY STOP/);
  assert.match(today, /Unverified/);
  const perf = text(nodes(tree).find(n => n.props?.id === 'aqte-book-performance'));
  assert.match(perf, /Wins \/ Losses \/ Flat\s+1 \/ 0 \/ 0 · 1 unverified/);
  assert.match(perf, /Win rate\s+100%/);
  assert.match(perf, /Realized net\s+--/);
  assert.match(perf, /Best trade\s+\+₹25\.00/);
  assert.match(perf, /Worst trade\s+\+₹25\.00/);
  const summary = text(nodes(tree).find(n => n.props?.['aria-label'] === 'Today summary'));
  assert.match(summary, /Today P&L\s+--/);
  assert.match(summary, /Max Drawdown\s+--/);
});

test('performance tab uses sign-first rupees and neutral/up/down win-rate tones', () => {
  const h = harness();
  const publish = status => nodes(h.render()).find(n => n.props?.onStatus && 'exitRequest' in n.props).props.onStatus(status);
  const cell = label => nodes(nodes(h.render()).find(n => n.props?.id === 'aqte-book-performance'))
    .find(n => n.props?.className === 'aqx-perf-cell' && text(n).trim().startsWith(label)).props.children[1];
  assert.equal(cell('Win rate').props.className, '');
  const at = Date.now() / 1000;
  publish({ ...liveFixture(), trades: [10, -72.5, -2].map(net_pnl => ({ symbol: 'NIFTY', net_pnl, exit_at: at })) });
  assert.equal(cell('Win rate').props.className, 'aqx-down');
  assert.equal(text(cell('Realized net')).trim(), '−₹64.50');
  assert.equal(text(cell('Best trade')).trim(), '+₹10.00');
  assert.equal(cell('Best trade').props.className, 'aqx-up');
  assert.equal(text(cell('Worst trade')).trim(), '−₹72.50');
  assert.equal(cell('Worst trade').props.className, 'aqx-down');
  publish({ ...liveFixture(), trades: [10, 5].map(net_pnl => ({ symbol: 'NIFTY', net_pnl, exit_at: at })) });
  assert.equal(cell('Win rate').props.className, 'aqx-up');
  assert.equal(text(cell('Realized net')).trim(), '+₹15.00');
});

test('broker SL rule reads "After entry" without a trade and the stop price once confirmed', () => {
  const rule = props => nodes(nodes(harness('AQTETerminal.tsx').render(props)).find(n => n.props?.['aria-label'] === 'Auto exit rules'))
    .filter(n => n.type === 'li').find(n => /Broker SL order/.test(text(n)));
  const base = { symbol: 'NIFTY', active: true, unavailable: false, tick: null, onExit() {} };
  assert.match(text(rule({ ...base, liveStatus: liveFixture() })), /After entry/);
  assert.doesNotMatch(text(rule({ ...base, liveStatus: liveFixture() })), /Unverified/);
  assert.match(text(rule({ ...base, liveStatus: { ...liveFixture(), active: livePositionFixture() } })), /₹105\.00/);
  assert.match(text(rule({ ...base, liveStatus: { ...liveFixture(), active: livePositionFixture({ protection_confirmed: false }) } })), /Unverified/);
});

test('phone timeline wraps all six lifecycle steps instead of hiding Exit in a sideways scroll', () => {
  const css = readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8');
  const phone = css.slice(css.indexOf('@container aqte (max-width: 620px)'));
  const block = phone.slice(0, phone.indexOf('\n}\n'));
  assert.match(block, /\.aqx-timeline \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(block, /\.aqx-timeline li:nth-child\(3n \+ 1\)::before \{ display: none; \}/);
  assert.doesNotMatch(block, /\.aqx-timeline \{[^}]*overflow-x: auto/);
});
test('header switch reads the shared live feed without its own status poll', async () => {
  const h = harness('AQTEAutomationSwitch.tsx');
  assert.match(text(autoSwitch(h.render({ feed: 'pending' }))), /Checking/);
  assert.equal(h.mount(), undefined, 'shared mode starts no poll loop');
  await settle();
  assert.equal(h.requests.length, 0);
  assert.equal(h.timers.size, 0);
  const on = { ...liveFixture(), enabled: true, armed: true, automation_on: true };
  let tree = h.render({ feed: on });
  assert.equal(autoSwitch(tree).props['aria-checked'], true);
  assert.match(text(tree), /Backend confirmed · ON/);
  tree = h.render({ feed: null, feedError: 'Sign in again' });
  assert.match(text(autoSwitch(tree)), /UNKNOWN/);
  assert.equal(autoSwitch(tree).props['aria-checked'], undefined);
  assert.match(text(tree), /Sign in again/);
  assert.ok(nodes(tree).find(n => n.props?.['aria-label'] === 'Stop AQTE new entries'), 'unknown state keeps Request OFF');
  tree = h.render({ feed: { ...on, connection_error: 'Live status unavailable; inspect Kite' } });
  assert.match(text(autoSwitch(tree)), /UNKNOWN/);
  assert.match(text(tree), /Live status unavailable; inspect Kite/);
  assert.equal(h.requests.length, 0);
});

test('shared switch publishes command results and ignores a poll that started before the command', async () => {
  const h = harness('AQTEAutomationSwitch.tsx');
  const published = [];
  const onStatus = value => published.push(value);
  const t = Date.now() / 1000;
  const on = { ...liveFixture(), generated_at: t - 1, enabled: true, armed: true, automation_on: true };
  h.render({ feed: on, onStatus });
  h.respond({ ...on, generated_at: t, automation_on: false });
  autoSwitch(h.render({ feed: on, onStatus })).props.onClick();
  await settle();
  assert.deepEqual(h.requests.map(r => r.url), ['/api/aqte/live/automation']);
  assert.equal(published.length, 1);
  assert.equal(published[0].automation_on, false);
  // The parent's in-flight poll from before the command still reports ON; the newer OFF must stay.
  let tree = h.render({ feed: on, onStatus });
  assert.equal(autoSwitch(tree).props['aria-checked'], false);
  assert.match(text(tree), /Saved automatically · OFF/);
  h.respondHTTP(500, { detail: 'Broker timeout' });
  autoSwitch(tree).props.onClick();
  nodes(h.render({ feed: on, onStatus })).find(n => n.type === 'button' && /Confirm ON/.test(text(n))).props.onClick();
  await settle();
  assert.equal(published.length, 1, 'a failed command does not blank the shared live status');
  tree = h.render({ feed: { ...on, generated_at: Date.now() / 1000 + 0.5 } });
  assert.match(text(autoSwitch(tree)), /UNKNOWN/, 'a status within clock skew of the failed command cannot resolve it');
  assert.match(text(tree), /Broker timeout/);
  tree = h.render({ feed: { ...on, generated_at: Date.now() / 1000 + 2 } });
  assert.equal(autoSwitch(tree).props['aria-checked'], true);
  assert.doesNotMatch(text(tree), /Broker timeout/);
});

test('live controller owns the sign-in prompt and forwards poll errors with the null status', async () => {
  const h = harness('AQTELiveController.tsx');
  const published = [];
  h.render({ onStatus: (value, error) => published.push([value, error]) });
  const cleanup = h.mount({ __httpStatus: 401, __body: { detail: 'Sign in with the configured owner app-access session' } });
  await settle();
  assert.equal(h.accessExpired, 1);
  assert.deepEqual(published.at(-1), [null, 'Sign in with the configured owner app-access session']);
  cleanup();
});

test('section polls live status once and feeds the header switch with the newest state', () => {
  const h = harness();
  const switchNode = () => nodes(h.render()).find(n => n.props && 'feed' in n.props);
  const controller = () => nodes(h.render()).find(n => n.props?.onStatus && 'exitRequest' in n.props);
  assert.equal(switchNode().props.feed, 'pending');
  const t = Date.now() / 1000;
  const fresh = { ...liveFixture(), generated_at: t, automation_on: true };
  switchNode().props.onStatus(fresh);
  assert.equal(switchNode().props.feed, fresh, 'a switch command result reaches the section state');
  controller().props.onStatus({ ...liveFixture(), generated_at: t - 1 });
  assert.equal(switchNode().props.feed, fresh, 'an older poll cannot roll back a newer switch result');
  const failed = { ...fresh, generated_at: t - 1, connection_error: 'Live status unavailable; inspect Kite' };
  controller().props.onStatus(failed);
  assert.equal(switchNode().props.feed, failed, 'connection errors always surface');
  controller().props.onStatus(null, 'Untrusted live-control origin');
  assert.equal(switchNode().props.feed, null);
  assert.equal(switchNode().props.feedError, 'Untrusted live-control origin');
  const source = readFileSync(path.join(__dirname, '..', 'components', 'AQTESection.tsx'), 'utf8');
  assert.match(source, /hourCycle: 'h23'/, 'midnight renders 00, never 24');
  assert.doesNotMatch(source, /className="aqx-clock" aria-label/);
});

test('opportunity card shows Auto Trade waiting to arm with its reason, never OFF, while the switch is ON', () => {
  const h = harness('AQTEEngineDeck.tsx');
  const data = fixture().data;
  data.NIFTY = { ...data.NIFTY, ...engineSet({ ce: 4 }), scalp: scalpSignal('BUY CE', 82) };
  const base = { ...liveFixture(), enabled: true, ranking: ['NIFTY', 'BANKNIFTY', 'SENSEX'],
    entry_blocks: { NIFTY: null, BANKNIFTY: 'No setup', SENSEX: 'No setup' } };
  const props = { symbol: 'NIFTY', data, unavailable: false, policy: { veto: true, veto_min: 2 }, events: [] };
  const card = live => text(nodes(h.render({ ...props, liveStatus: live })).find(n => n.props?.['aria-label'] === 'Top opportunity'));
  const ip = 'Outbound IP 122.177.240.29 does not match allowlisted IP 159.65.147.167';
  let panel = card({ ...base, automation_on: false, armed: false, automation_wanted: true, automation_waiting: ip });
  assert.match(panel, /Auto Execution:\s+NOT ARMED/);
  assert.match(panel, /does not match allowlisted IP/);
  assert.doesNotMatch(panel, /OFF|Eligible/);
  panel = card({ ...base, automation_on: false, armed: false, automation_wanted: true, automation_waiting: null });
  assert.match(panel, /waiting to arm for the market session/);
  panel = card({ ...base, automation_on: false, armed: false, automation_wanted: false });
  assert.match(panel, /Auto Execution:\s+OFF/);
  assert.match(panel, /Auto Trade is not ON and armed/);
  panel = card({ ...base, automation_on: false, armed: false, automation_wanted: true, killed: true });
  assert.match(panel, /Auto Execution:\s+STOPPED/);
  // With no setup, a disabled index is skipped (as automated_entry does) and the next index explains the wait.
  data.NIFTY = { ...data.NIFTY, scalp: scalpSignal('WAIT') };
  const disabled = { ...base, armed: true, automation_on: true, automation_wanted: true,
    entry_blocks: { NIFTY: 'Index auto trading disabled', BANKNIFTY: 'No setup', SENSEX: 'No setup' } };
  panel = card(disabled);
  assert.match(panel, /No setup/);
  assert.match(panel, /Disabled in Controls/);
  assert.match(panel, /Auto Execution:\s+WAITING/);
  // Waiting for the session never hides that every index is switched off in Controls.
  const off = 'Index auto trading disabled';
  panel = card({ ...disabled, automation_on: false, armed: false, automation_waiting: 'Waiting for market',
    entry_blocks: { NIFTY: off, BANKNIFTY: off, SENSEX: off } });
  assert.match(panel, /Auto Execution:\s+BLOCKED/);
  assert.match(panel, /every index is disabled or at its trade limit in Controls/);
  assert.doesNotMatch(panel, /Waiting for market/);
});
test('engine deck counts only engines actively evaluating; an unconfigured ML shadow engine is not counted', () => {
  const h = harness('AQTEEngineDeck.tsx');
  const data = fixture().data;
  data.NIFTY = { ...data.NIFTY, ...engineSet({ ce: 1 }) };
  const head = props => text(nodes(h.render(props)).find(n => n.props?.className === 'aqx-deck-title'));
  const props = { symbol: 'NIFTY', data, liveStatus: liveFixture(), unavailable: false, policy: null, events: [] };
  assert.match(head(props), /11\/12 engines evaluated from shared data/);
  assert.doesNotMatch(head(props), /parallel/);
  assert.match(text(h.render(props)), /Scalp\/swing rules control entry\. Engines rank or veto; ML is shadow-only/);
  assert.doesNotMatch(head(props), /12\/12/);
  data.NIFTY = { ...data.NIFTY, engines: data.NIFTY.engines.map(engine => ({ ...engine, status: 'MONITORING' })) };
  assert.match(head(props), /All engines monitoring/);
});

test('last entry scan is validated and shown as historical evidence only for the selected idle index', () => {
  const display = displayModule();
  const at = Date.now() / 1000;
  const scan = { at: at - 60, blocks: { NIFTY: 'Trade exceeds remaining daily index loss budget' },
    styles: { NIFTY: 'swing' } };
  const status = { ...liveFixture(), entry_scan: scan };
  assert.equal(display.isAqteLiveState(status), true);
  assert.equal(display.isAqteLiveState({ ...status, entry_scan: null }), true);
  for (const invalid of [{ ...scan, at: 'now' }, { ...scan, blocks: { NIFTY: 3 } },
    { ...scan, styles: { NIFTY: 'auto' } }, { ...scan, blocks: { OTHER: 'No setup' } }]) {
    assert.equal(display.isAqteLiveState({ ...status, entry_scan: invalid }), false);
  }
  const h = harness('AQTETerminal.tsx');
  const props = { symbol: 'NIFTY', unavailable: false, tick: null, liveStatus: status, now: at };
  const scanText = tree => text(nodes(tree).find(n => n.props?.['aria-label'] === 'Last entry scan'));
  assert.match(scanText(h.render(props)), /Last scan .* IST.*Swing.*remaining daily index loss budget/);
  assert.equal(scanText(h.render({ ...props, symbol: 'BANKNIFTY' })), '');
  assert.equal(scanText(h.render({ ...props, liveStatus: { ...status, generated_at: at - 11 } })), '');
  assert.equal(scanText(h.render({ ...props, liveStatus: { ...status, active: livePositionFixture() } })), '');
  assert.equal(scanText(h.render({ ...props, liveStatus: liveFixture() })), '');
});

test('Positions tab lists positions squared off today with realised P&L instead of only "no open position"', async () => {
  const h = harness('AQTEBrokerPositions.tsx');
  h.render({ selectedSymbol: 'NIFTY' });
  const cleanup = h.mount({ generated_at: Date.now() / 1000, read_only: true, paused: false, positions: [], closed: [
    { symbol: 'NIFTY', trading_symbol: 'NIFTY26N0323650CE', exchange: 'NFO', product: 'MIS', quantity: 65,
      buy_price: 120.3, sell_price: 128, gross_pnl: 500.5, aqte: true },
    { symbol: 'NIFTY', trading_symbol: 'NIFTY26N0323700CE', exchange: 'NFO', product: 'MIS', quantity: 65,
      buy_price: 110, sell_price: 112.5, gross_pnl: 162.5, aqte: false },
    { symbol: 'SENSEX', trading_symbol: 'SENSEX_CLOSED_PE', exchange: 'BFO', product: 'MIS', quantity: 20,
      buy_price: 100, sell_price: 90, gross_pnl: -200, aqte: true },
  ] });
  await settle();
  const flat = symbol => text(h.render({ selectedSymbol: symbol })).replace(/\s+/g, ' ');
  let value = flat('NIFTY');
  assert.match(value, /No open Zerodha derivative position for this index\. 2 closed today below\./);
  assert.match(value, /Closed today · 2/);
  assert.match(value, /NIFTY26N0323650CE · MIS · AQTE/);
  assert.match(value, /NIFTY26N0323700CE · MIS · Manual/);
  assert.match(value, /Buy 120\.30 → Sell 128\.00 · \+₹500\.50/);
  assert.match(value, /Realised gross \+₹663\.00/);
  assert.doesNotMatch(value, /SENSEX_CLOSED_PE/);
  value = flat('SENSEX');
  assert.match(value, /−₹200\.00/);
  value = flat('BANKNIFTY');
  assert.match(value, /Check other index tabs/);
  assert.doesNotMatch(value, /Closed today/);
  assert.ok(h.requests.every(r => !r.options.method || r.options.method === 'GET'));
  cleanup();
});