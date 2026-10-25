const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const source = readFileSync(path.join(__dirname, '..', 'components', 'ChartPaperTrading.tsx'), 'utf8') +
  '\nexport { OrderFlowLedger };';
function load(react = React) {
  const context = { exports: {}, require: id => {
    if (id === 'react') return react;
    if (id === 'react/jsx-runtime') return require(id);
    if (id === '@/lib/api-config') return { API_CONFIG: { endpoint: x => x } };
    throw new Error(`Unexpected import ${id}`);
  } };
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context);
  return context.exports.OrderFlowLedger;
}
const statuses = ['WATCHING', 'ARMED', 'OPEN', 'CLOSED', 'REJECTED', 'EXPIRED'];
const book = {
  running: true, last_scan: '2026-10-19T04:45:00Z', error: null, net_points: 18.5,
  policy: { scope: 'All three indices, 5m', fills: 'Fresh futures ticks only' },
  total: 106, counts: Object.fromEntries(statuses.map(s => [s, 1])),
  setups: statuses.map((status, i) => ({
    id: `of:${i}`, symbol: 'NIFTY', token: 7, side: i % 2 ? 'SELL' : 'BUY', status,
    reason: `Decision ${i}`, signal_at: '2026-10-19T04:35:00Z',
    observed_at: '2026-10-19T04:35:01Z', updated_at: '2026-10-19T04:45:00Z',
    entry_at: ['OPEN', 'CLOSED'].includes(status) ? '2026-10-19T04:40:02Z' : null,
    entry_price: ['OPEN', 'CLOSED'].includes(status) ? 101.5 : undefined,
    exit_at: status === 'CLOSED' ? '2026-10-19T04:45:00Z' : null, exit_price: 120,
    stop: 90, target: 120, points: status === 'CLOSED' ? 18.5 : null, unrealized_points: 1.5,
    data_gaps: 0, mfe: 4, mae: 1, contract: { tradingSymbol: 'NIFTY26OCTFUT' },
    plan: { reasons: ['Recorded absorption'], confidence: 75 },
  })),
};

test('paper ledger renders all decisions without presenting skipped setups as filled trades', () => {
  const html = renderToStaticMarkup(React.createElement(load(), { book, offset: 0, onOffset: () => {} }));
  for (const status of statuses) assert.match(html, new RegExp(`${status}: 1`));
  assert.match(html, /NIFTY26OCTFUT/);
  assert.match(html, /18.50/);
  assert.match(html, /1.50 unrealized/);
  assert.match(html, /not cash-index or rupee P&amp;L/);
  assert.match(html, /overflow-x-auto/);
  assert.match(html, /min-h-\[44px\]/);
  assert.match(html, /Existing chart indicator strategies below are unchanged/);
});

test('ledger pagination and setup-detail selection are independent of cash-index controls', () => {
  let selected = null;
  const component = load({ ...React, useState: () => [selected, value => { selected = value; }] });
  const elements = tree => {
    const result = [];
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      result.push(node);
      [node.props?.children].flat(Infinity).forEach(walk);
    }
    walk(tree);
    return result;
  };
  let offset = 0;
  const render = () => component({ book, offset, onOffset: value => { offset = value; } });
  let tree = render();
  let buttons = elements(tree).filter(e => e.type === 'button');
  assert.equal(buttons.find(e => e.props.children === 'Previous 100 OF setups').props.disabled, true);
  buttons.find(e => e.props.children === 'Next 100 OF setups').props.onClick();
  assert.equal(offset, 100);
  tree = render();
  buttons = elements(tree).filter(e => e.type === 'button');
  assert.equal(buttons.find(e => e.props.children === 'Next 100 OF setups').props.disabled, true);
  buttons.find(e => e.props.children === 'OPEN').props.onClick();
  tree = render();
  assert.equal(elements(tree).find(e => e.props.setup)?.props.setup.id, 'of:2');
});

test('empty and unhealthy monitor states are explicit', () => {
  const html = renderToStaticMarkup(React.createElement(load(), {
    book: { ...book, setups: [], total: 0, counts: {}, running: false, error: 'Feed unavailable' },
    offset: 0, onOffset: () => {},
  }));
  assert.match(html, /Backend monitor stopped/);
  assert.match(html, /role="alert"/);
  assert.match(html, /Feed unavailable/);
  assert.match(html, /Historical chart replay trades are not imported/);
});
