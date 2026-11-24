const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness(fetch) {
  const states = [], refs = [], effects = [], intervals = [];
  let stateIndex = 0, refIndex = 0, mounted = false, clock = Date.now();
  class TestDate extends Date {
    static now() { return clock; }
  }
  const react = {
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    },
    useRef(initial) {
      const index = refIndex++;
      return refs[index] ?? (refs[index] = { current: initial });
    },
    useCallback: fn => fn,
    useEffect(fn) { if (!mounted) effects.push(fn); },
  };
  const compiled = ts.transpileModule(readFileSync(
    path.join(__dirname, '..', 'components', 'SMCApexSection.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const context = {
    exports: {}, fetch, Date: TestDate, Intl, Number, AbortSignal,
    setInterval(fn, delay) { intervals.push({ fn, delay }); return intervals.length; },
    clearInterval() {},
    require(id) {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime') return require(id);
      if (id === 'lucide-react') return require(id);
      if (id === '@/lib/api-config') return { API_CONFIG: { endpoint: value => value } };
      if (id === '@/lib/visitor-id') return { getOrCreateVisitorId: () => 'mock-device' };
      throw new Error(`Unexpected import ${id}`);
    },
  };
  vm.runInNewContext(compiled, context);
  const render = () => {
    stateIndex = 0; refIndex = 0;
    const result = context.exports.default();
    mounted = true;
    return result;
  };
  render();
  effects.forEach(fn => fn());
  return { render, intervals, advance: ms => { clock += ms; } };
}

function elements(tree) {
  const result = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    result.push(node);
    for (const child of [node.props?.children].flat(Infinity)) visit(child);
  }
  visit(tree);
  return result;
}
const button = view => elements(view).find(node =>
  node.props?.['aria-label'] === 'Toggle SMC Apex live entry');
function text(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (typeof tree !== 'object') return String(tree);
  return [tree.props?.children].flat(Infinity).map(text).join(' ');
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const response = (body, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => body });
const live = value => response({ live: value, at: new Date().toISOString() });

test('strategy caption is grouped directly beneath the Apex title', async () => {
  const app = harness(async url => url.endsWith('/status') ? response(snapshot()) : live(false));
  await flush();
  const header = elements(app.render()).find(node => node.type === 'header');
  const groups = [header.props.children].flat(Infinity);
  const titleGroup = groups.find(node => elements(node).some(child => child.type === 'h2'));
  const children = [titleGroup.props.children].flat(Infinity);
  assert.equal(children[0].type, 'h2');
  assert.equal(children[1].type, 'p');
  assert.match(text(children[1]), /Order Block \+ Liquidity Sweep \+ Liquidity Run \+ Advanced FVG/);
  assert.ok(elements(groups[1]).some(node => node.props?.['aria-label'] === 'Toggle SMC Apex live entry'));
});

test('single ON/OFF toggle works independently when candle snapshots are unavailable', async () => {
  let enabled = false;
  const writes = [];
  const app = harness(async (url, init) => {
    if (url.endsWith('/status')) return response({ detail: 'Candle snapshot busy' }, false);
    if (init.method === 'PUT') {
      writes.push(JSON.parse(init.body));
      enabled = JSON.parse(init.body).enabled;
      return response({ live: enabled });
    }
    return live(enabled);
  });
  await flush();
  assert.equal(button(app.render()).props.disabled, false);
  assert.equal(button(app.render()).props['aria-checked'], false);
  assert.equal(writes.length, 0);
  await button(app.render()).props.onClick();
  await flush();
  assert.equal(button(app.render()).props['aria-checked'], true);
  await button(app.render()).props.onClick();
  await flush();
  assert.equal(button(app.render()).props['aria-checked'], false);
  assert.deepEqual(writes, [{ enabled: true }, { enabled: false }]);
});

test('unknown toggle sends only OFF and automatically recovers without buying', async () => {
  let available = false;
  const writes = [];
  const app = harness(async (url, init) => {
    if (init.method === 'PUT') {
      writes.push(JSON.parse(init.body));
      available = true;
      return response({ live: false });
    }
    return url.endsWith('/trade-control') && available ? live(false) :
      response({ detail: 'Independent service unavailable' }, false);
  });
  await flush();
  assert.equal(button(app.render()).props.disabled, false);
  assert.equal(button(app.render()).props['aria-checked'], undefined);
  const header = elements(app.render()).find(node => node.type === 'header');
  assert.doesNotMatch(text(header), /Not connected|Retry connection|UNVERIFIED/);
  await button(app.render()).props.onClick();
  await flush();
  assert.equal(button(app.render()).props['aria-checked'], false);
  assert.deepEqual(writes, [{ enabled: false }]);
});

test('an old live-state poll cannot undo a newer confirmed ON acknowledgement', async () => {
  let pendingRead, nextReadDeferred = false;
  const app = harness(async (url, init) => {
    if (url.endsWith('/status')) return response({ detail: 'No market data' }, false);
    if (init.method === 'PUT') return response({ live: true });
    if (nextReadDeferred) return new Promise(resolve => { pendingRead = resolve; });
    return live(false);
  });
  await flush();
  nextReadDeferred = true;
  app.intervals.find(timer => timer.delay === 2000).fn();
  await flush();
  await button(app.render()).props.onClick();
  await flush();
  assert.equal(button(app.render()).props['aria-checked'], true);
  pendingRead(live(false));
  await flush();
  assert.equal(button(app.render()).props['aria-checked'], true);
});

test('conflicting acknowledgement and expired live-state timestamps never fabricate ON', async () => {
  let expired = false;
  const app = harness(async (url, init) => {
    if (url.endsWith('/status')) return response({ detail: 'No market data' }, false);
    if (init.method === 'PUT') return response({ live: false });
    return expired ? response({ live: true, at: '2000-01-01T00:00:00+05:30' }) : live(false);
  });
  await flush();
  await button(app.render()).props.onClick();
  await flush();
  assert.equal(button(app.render()).props['aria-checked'], false);
  assert.match(text(app.render()), /did not confirm/);
  expired = true;
  app.intervals.find(timer => timer.delay === 2000).fn();
  await flush();
  assert.equal(button(app.render()).props['aria-checked'], undefined);
  assert.equal(button(app.render()).props.disabled, false);
});

const risk = { lots: 1, risk_per_trade: 2500, daily_loss: 200, stop_percent: 20,
  max_spread_percent: 1, entry_start: '09:25', entry_end: '14:45' };
const snapshot = () => ({ at: new Date().toISOString(), feed: 'CONNECTED', live: true,
  indices: {}, signals: {}, config: { NIFTY: risk }, daily: { daily_loss: 3000 },
  trades: [], daily_used: 0, ai_calls: 0 });
function settings(view, symbol = 'NIFTY') {
  return elements(view).find(node => node.props?.['aria-label'] === `${symbol} risk configuration`);
}
function openSettings(app) {
  elements(app.render()).find(node => node.props?.['aria-label'] === 'Configure NIFTY risk').props.onClick();
}
function saveButton(app) {
  return elements(settings(app.render())).find(node => node.type === 'button' && /^Save NIFTY/.test(text(node)));
}

test('index cards show only price and change, with source and warnings still available', async () => {
  const data = { ...snapshot(), live: false, indices: { NIFTY: {
    price: 100, change_percent: 0, age: 1, fresh: true, timestamp_source: 'RECEIPT',
    data_warning: 'NIFTY: rejected future tick with missing exchange timestamp',
  } } };
  const app = harness(async url => url.endsWith('/status') ? response(data) : live(false));
  await flush();
  const card = elements(app.render()).find(node => node.type === 'button' && text(node).trim().startsWith('NIFTY'));
  assert.match(text(card), /100\.00\s+▲ 0\.00 \(0\.00%\)/);
  assert.doesNotMatch(text(card), /LIVE|RECEIVED|Data incomplete|entries blocked/);
  assert.match(card.props.title, /receipt time, not an exchange timestamp/);
  assert.match(card.props['aria-label'], /receipt time, not an exchange timestamp/);
  assert.match(text(app.render()), /NIFTY: rejected future tick with missing exchange timestamp/);
  assert.equal(elements(app.render()).filter(node => node.props?.role === 'alert').length, 0);
  assert.equal(button(app.render()).props['aria-checked'], false);
});

test('index cards show last close then live price, with the session date accessible', async () => {
  const data = { ...snapshot(), live: false, indices: { NIFTY: {
    price: 111, change_percent: 0, age: 145, fresh: false, timestamp_source: 'RECEIPT',
    last_close: { price: 110, change_percent: 10, session_date: '2026-11-23' },
  } } };
  const app = harness(async url => url.endsWith('/status') ? response(data) : live(false));
  await flush();
  const card = () => elements(app.render()).find(node => node.type === 'button' && text(node).trim().startsWith('NIFTY'));
  assert.match(text(card()), /110\.00/);
  assert.match(text(card()), /▲ 10\.00 \(10\.00%\)/);
  assert.match(card().props['aria-label'], /2026-11-23, not live/);
  assert.match(text(app.render()), /Underlying \(last close\).*2026-11-23/);
  assert.doesNotMatch(text(card()), /111\.00|LAST CLOSE|LIVE/);
  data.indices.NIFTY.fresh = true;
  data.indices.NIFTY.age = 1;
  app.intervals.find(timer => timer.delay === 3000).fn();
  await flush();
  assert.match(text(card()), /111\.00/);
  assert.match(card().props.title, /Live quote using WebSocket receipt time/);
  assert.doesNotMatch(text(card()), /LIVE|RECEIVED|LAST CLOSE/);
  assert.equal(button(app.render()).props['aria-checked'], false);
});

test('declining last close shows the actual point loss and percentage with a red down arrow', async () => {
  const data = { ...snapshot(), indices: { NIFTY: {
    price: null, change_percent: null, age: null, fresh: false,
    last_close: { price: 90, change_percent: -10, session_date: '2026-11-23' },
  } } };
  const app = harness(async url => url.endsWith('/status') ? response(data) : live(false));
  await flush();
  const card = elements(app.render()).find(node => node.type === 'button' && text(node).trim().startsWith('NIFTY'));
  assert.match(text(card), /90\.00\s+▼ 10\.00 \(10\.00%\)/);
  assert.match(card.props['aria-label'], /down 10\.00 points, 10\.00 percent/);
  assert.match(elements(card).find(node => node.type === 'span' && text(node).includes('▼')).props.className, /text-red-400/);
});

test('stale last-received quote shows no misleading change or extra status text', async () => {
  const data = { ...snapshot(), indices: { NIFTY: {
    price: 100, change_percent: 0, age: 209.59, fresh: false, timestamp_source: 'RECEIPT',
  } } };
  const app = harness(async url => url.endsWith('/status') ? response(data) : live(false));
  await flush();
  const card = elements(app.render()).find(node => node.type === 'button' && text(node).trim().startsWith('NIFTY'));
  assert.match(text(card), /100\.00\s+--/);
  assert.doesNotMatch(text(card), /RECEIVED|209|0\.00%|Data incomplete/);
  assert.match(card.props['aria-label'], /Last received quote, not live/);
});

test('connection interruptions while OFF appear as retrying status, without masking protective errors', async () => {
  const data = { ...snapshot(), live: false, error: 'Protective order requires operator attention',
    connection_warnings: ['Zerodha candle history connection unavailable; retrying. New entries disabled.'] };
  const app = harness(async url => url.endsWith('/status') ? response(data) : live(false));
  await flush();
  assert.equal(button(app.render()).props['aria-checked'], false);
  assert.match(text(app.render()), /candle history connection unavailable; retrying/);
  assert.match(text(elements(app.render()).find(node => node.props?.role === 'alert')), /Protective order requires operator attention/);
  assert.doesNotMatch(text(app.render()), /Service failure: ConnectionError/);
});

test('visible risk settings select and save each index without losing unsaved drafts', async () => {
  const data = snapshot();
  const writes = [];
  const app = harness(async (url, init) => {
    if (init.method === 'PUT') {
      const body = JSON.parse(init.body);
      writes.push({ url, body });
      if (url.endsWith('/config/BANKNIFTY')) data.config.BANKNIFTY = body;
      if (url.endsWith('/config/SENSEX')) data.config.SENSEX = body;
      return response({ saved: true });
    }
    return url.endsWith('/status') ? response(data) : live(false);
  });
  await flush();
  const header = elements(app.render()).find(node => node.type === 'header');
  assert.match(text(header), /Risk settings/);
  openSettings(app);
  const select = name => {
    const region = elements(app.render()).find(node => node.props?.['aria-label'] === 'Select index risk settings');
    const tab = elements(region).find(node => node.type === 'button' && text(node).trim().startsWith(name));
    tab.props.onClick();
  };
  const setField = (symbol, name, value) => {
    const label = elements(settings(app.render(), symbol)).find(node => node.type === 'label' && text(node).startsWith(name));
    elements(label).find(node => node.type === 'input').props.onChange({ target: { value } });
  };
  const enterRisk = symbol => {
    for (const [name, value] of [['Lots (whole number)', '1'], ['Per-trade maximum exposure (Rs)', '2500'],
      ['Index daily loss cap (Rs)', '200']]) setField(symbol, name, value);
  };
  assert.match(text(settings(app.render())), /BANKNIFTY\s+· Not saved/);
  select('BANKNIFTY');
  enterRisk('BANKNIFTY');
  select('SENSEX');
  enterRisk('SENSEX');
  select('BANKNIFTY');
  assert.equal(elements(settings(app.render(), 'BANKNIFTY')).find(node => node.type === 'input').props.value, '1');
  elements(settings(app.render(), 'BANKNIFTY')).find(node => node.type === 'button' && text(node).startsWith('Save BANKNIFTY')).props.onClick();
  await flush();
  assert.match(text(settings(app.render(), 'BANKNIFTY')), /BANKNIFTY and Apex daily limits saved/);
  select('SENSEX');
  elements(settings(app.render(), 'SENSEX')).find(node => node.type === 'button' && text(node).startsWith('Save SENSEX')).props.onClick();
  await flush();
  assert.match(text(settings(app.render(), 'SENSEX')), /SENSEX and Apex daily limits saved/);
  assert.deepEqual(writes.map(item => item.url), ['/api/smc-apex/config/BANKNIFTY', '/api/smc-apex/daily',
    '/api/smc-apex/config/SENSEX', '/api/smc-apex/daily']);
  assert.deepEqual(writes[0].body, risk);
  assert.deepEqual(writes[2].body, risk);
  assert.equal(button(app.render()).props['aria-checked'], false);
});

test('risk form saves independent daily caps while ON and shows acknowledgement beside Save', async () => {
  const writes = [];
  const app = harness(async (url, init) => {
    if (init.method === 'PUT') {
      writes.push({ url, body: JSON.parse(init.body) });
      return response({ saved: true });
    }
    return url.endsWith('/status') ? response(snapshot()) : live(true);
  });
  await flush();
  openSettings(app);
  saveButton(app).props.onClick();
  await flush();
  assert.deepEqual(writes.map(entry => entry.body), [risk, { daily_loss: 3000 }]);
  assert.match(text(settings(app.render())), /NIFTY and Apex daily limits saved/);
  assert.equal(button(app.render()).props['aria-checked'], true);
});

test('server validation errors are shown inside the risk form rather than only at the page header', async () => {
  const app = harness(async (url, init) => {
    if (init.method === 'PUT') return { ...response({ detail: [
      { msg: 'Value error, Entry window must be within 09:15-15:00 IST' },
    ] }, false), status: 422 };
    return url.endsWith('/status') ? response(snapshot()) : live(false);
  });
  await flush();
  openSettings(app);
  saveButton(app).props.onClick();
  await flush();
  const alert = elements(settings(app.render())).find(node => node.props?.role === 'alert');
  assert.match(text(alert), /Entry window must be within 09:15-15:00 IST/);
  assert.doesNotMatch(text(alert), /Invalid risk settings|Value error,/);
});

test('stale market snapshots do not disable saving manually entered risk settings', async () => {
  const writes = [];
  const app = harness(async (url, init) => {
    if (init.method === 'PUT') {
      writes.push(JSON.parse(init.body));
      return response({ saved: true });
    }
    return url.endsWith('/status') ? response({ detail: 'Snapshot unavailable' }, false) : live(false);
  });
  await flush();
  openSettings(app);
  for (const [name, value] of [['Lots (whole number)', '1'], ['Per-trade maximum exposure (Rs)', '2500'],
    ['Index daily loss cap (Rs)', '200'], ['Apex combined daily loss cap (Rs)', '3000']]) {
    const label = elements(settings(app.render())).find(node => node.type === 'label' && text(node).startsWith(name));
    elements(label).find(node => node.type === 'input').props.onChange({ target: { value } });
  }
  assert.equal(saveButton(app).props.disabled, false);
  saveButton(app).props.onClick();
  await flush();
  assert.deepEqual(writes, [risk, { daily_loss: 3000 }]);
  assert.match(text(settings(app.render())), /NIFTY and Apex daily limits saved/);
});
