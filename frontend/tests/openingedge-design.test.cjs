const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(snapshot) {
  const source = readFileSync(path.join(__dirname, '..', 'components', 'OpeningEdgeSection.tsx'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020,
  } }).outputText;
  const context = {
    exports: {}, Intl, Number, URL, AbortSignal,
    window: { setInterval: () => 0, clearInterval: () => {} },
    require(name) {
      if (name === './OpeningEdgeSection.module.css') return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
      if (name === '@/lib/visitor-id') return { getOrCreateVisitorId: () => 'test' };
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

test('OpeningEdge renders only global and pre-open intelligence', () => {
  const OpeningEdge = load();
  const html = renderToStaticMarkup(React.createElement(OpeningEdge));
  assert.match(html, /Global &amp; Pre-Open Intelligence/);
  assert.ok(!html.includes('Zerodha session'));
  assert.ok(html.includes('USA'));
  assert.ok(html.includes('India &amp; Pre-Open'));
  for (const removed of ['MASTER TRADE', 'ACTIVE TRADE', 'Daily risk settings', 'NO NEW ENTRIES', 'Save NIFTY']) {
    assert.ok(!html.includes(removed), removed);
  }
});

test('global cues preserve live values and display-only messaging', () => {
  const snapshot = {
    zerodha_session: true, feed_enabled: true, feed_status: 'connected', feed_error: null,
    snapshot_error: null,
    context: {
      nifty_future: { status: 'LIVE', value: 25000, change_percent: 1, detail: 'Zerodha future' },
      usdinr: { status: 'LIVE', value: 84.1234, change_percent: null, detail: 'USDINR future, not spot FX' },
      pcr: { status: 'LIVE', value: 1.25, change_percent: null, detail: 'Five paired strikes' },
    },
  };
  const OpeningEdge = load(snapshot);
  const html = renderToStaticMarkup(React.createElement(OpeningEdge));
  assert.ok(html.includes('25,000.00'));
  assert.ok(html.includes('84.1234'));
  assert.ok(html.includes('NIFTY OI PCR (5 strikes)'));
  assert.ok(html.includes('Display only; not used for trading.'));
});

test('global cue source contains no configuration or trade requests', () => {
  const source = readFileSync(path.join(__dirname, '..', 'components', 'OpeningEdgeSection.tsx'), 'utf8');
  assert.match(source, /method: 'GET'/);
  assert.doesNotMatch(source, /trade-control|daily-limit|api\/config|manual-live-control/);
});
