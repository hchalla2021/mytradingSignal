const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, snapshot, overrides = {}) {
  const source = readFileSync(path.join(__dirname, '..', 'components', file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020,
  } }).outputText;
  const context = {
    exports: {}, Intl, Number, URL, AbortSignal, ...overrides.globals,
    require(name) {
      if (name === './OpeningEdgeSection.module.css') return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
      if (name === '@/lib/visitor-id') return { getOrCreateVisitorId: () => 'test' };
      if (name === 'react' && overrides.react) return overrides.react;
      if (name === 'react' && snapshot) return { ...React, useState(initial) {
        const [value, setValue] = React.useState(initial);
        return [initial === null ? snapshot : value, setValue];
      } };
      return require(name);
    },
  };
  vm.runInNewContext(code, context);
  return context.exports.default;
}

test('master trade switches ON and OFF without a confirmation popup', async () => {
  for (const enabled of [false, true]) {
    const snapshot = {
      stage: 'ENTRY LOCK', feed_enabled: true, feed_status: 'connected', feed_error: null,
      indices: {}, config: { indices: {}, daily_loss: null }, reviews: {}, ai_error: null,
      context: {}, active: null, trade_enabled: true, automation_on: enabled,
      execution_status: 'LOCKED',
    };
    const calls = [];
    const stateUpdates = [];
    const mockReact = {
      ...React,
      useState: initial => [initial === null ? snapshot : initial, value => stateUpdates.push(value)],
      useRef: initial => ({ current: initial }),
      useCallback: fn => fn,
      useEffect: () => {},
    };
    const OpeningEdge = load('OpeningEdgeSection.tsx', null, {
      react: mockReact,
      globals: {
        window: { confirm: () => { throw new Error('Unexpected confirmation popup'); } },
        fetch: async (url, options) => {
          calls.push({ url, options });
          return { ok: true, json: async () => options.method === 'PUT'
            ? { automation_on: !enabled } : { ...snapshot, automation_on: !enabled } };
        },
      },
    });
    const findSwitch = element => {
      if (!element || typeof element !== 'object') return null;
      if (element.props?.role === 'switch') return element;
      for (const child of React.Children.toArray(element.props?.children)) {
        const found = findSwitch(child);
        if (found) return found;
      }
      return null;
    };
    const button = findSwitch(OpeningEdge());
    assert.ok(button);
    button.props.onClick();
    await new Promise(resolve => setImmediate(resolve));
    const put = calls.find(call => call.options.method === 'PUT');
    assert.ok(put, 'click should send a control request');
    assert.equal(JSON.parse(put.options.body).enabled, !enabled);
    assert.equal(put.options.headers['X-OpeningEdge-Intent'], 'manual-live-control');
    assert.ok(!stateUpdates.some(value => typeof value === 'string' && value.includes('Backend confirmed approval')));
  }
});

test('opening dashboard retains index and daily configuration and exposes a fail-safe trade control', () => {
  const OpeningEdge = load('OpeningEdgeSection.tsx');
  const html = renderToStaticMarkup(React.createElement(OpeningEdge));
  assert.equal((html.match(/Pre-open data &amp; risk settings/g) || []).length, 3);
  for (const label of ['Save NIFTY 50', 'Save BANK NIFTY', 'Save SENSEX', 'Daily risk settings']) {
    assert.ok(html.includes(label));
  }
  assert.ok(html.includes('MASTER TRADE'));
  assert.match(html, /<h2>OpeningEdge <em>AI<\/em><\/h2><p class="tagline">Opening Trade Algo for NIFTY \| BANK NIFTY \| SENSEX<\/p>/);
  assert.ok(!html.includes('INDEPENDENT MARKET MONITOR'));
  assert.ok(html.includes('Request OFF to block new entries'));
  assert.ok(html.includes('Execution locked'));
  assert.ok(!html.includes('ALGO ACTIVE'));
  assert.ok(!html.includes('BUY CE'));
});

test('approval ON is distinct from locked execution, and an old server is unknown', () => {
  const base = {
    stage: 'ENTRY LOCK', feed_enabled: true, feed_status: 'connected', feed_error: null,
    indices: {}, config: { indices: {}, daily_loss: null }, reviews: {}, ai_error: null,
    context: {}, active: null, trade_enabled: true,
  };
  const OpeningEdge = load('OpeningEdgeSection.tsx', {
    ...base, automation_on: true, execution_status: 'LOCKED',
    execution_block_reason: 'Broker execution is not yet verified.',
  });
  const on = renderToStaticMarkup(React.createElement(OpeningEdge));
  assert.ok(on.includes('MASTER TRADE'));
  assert.ok(on.includes('OpeningEdge master trade approval ON'));
  assert.ok(on.includes('Execution locked'));
  assert.ok(on.includes('Trade Status: <b>LOCKED</b>'));
  assert.ok(!on.includes('Scanning 09:15'));
  assert.match(on, /aria-checked="true"/);

  const OldOpeningEdge = load('OpeningEdgeSection.tsx', {
    ...base, trade_enabled: false, execution_status: 'NOT IMPLEMENTED',
  });
  const old = renderToStaticMarkup(React.createElement(OldOpeningEdge));
  assert.ok(old.includes('Trade control unavailable'));
  assert.ok(!old.includes('aria-checked="false"'));
});

test('opening dashboard labels live context and keeps unsupported cues unavailable', () => {
  const snapshot = {
    stage: 'ENTRY LOCK', feed_status: 'connected', feed_error: null, trade_enabled: false,
    indices: {}, config: { indices: {}, daily_loss: null }, reviews: {}, ai_error: null,
    context: {
      nifty_future: { status: 'LIVE', value: 25000, change_percent: 1, detail: 'Zerodha future' },
      usdinr: { status: 'LIVE', value: 84.1234, change_percent: null, detail: 'USDINR future, not spot FX' },
      pcr: { status: 'LIVE', value: 1.25, change_percent: null, detail: 'Five paired strikes' },
    },
  };
  const OpeningEdge = load('OpeningEdgeSection.tsx', snapshot);
  const html = renderToStaticMarkup(React.createElement(OpeningEdge));
  assert.ok(html.includes('25,000.00'));
  assert.ok(html.includes('84.1234'));
  assert.ok(html.includes('NIFTY OI PCR (5 strikes)'));
  assert.ok(html.includes('USDINR future, not spot FX'));
  assert.ok(html.includes('Waiting for Zerodha global data.'));
  assert.ok(html.includes('Display only; not used for trading or AI review.'));
});
