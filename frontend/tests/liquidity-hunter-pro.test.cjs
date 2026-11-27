const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const source = readFileSync(path.join(__dirname, '..', 'components', 'LiquidityHunterProSection.tsx'), 'utf8');
const page = readFileSync(path.join(__dirname, '..', 'app', 'page.tsx'), 'utf8');

test('Liquidity Hunter is chart-free and uses the one shared QuantumEdge control API', () => {
  assert.match(source, /Liquidity Hunter Pro/);
  assert.match(source, /Liquidity Hunter live trade/);
  assert.match(source, /\/api\/quantumedge\/\$\{path\}/);
  assert.match(source, /RULES MONITORING/);
  assert.doesNotMatch(source, /TradingView|<canvas|<Chart|Recharts|trading-view/i);
  assert.equal((source.match(/role="switch"/g) ?? []).length, 1);
  assert.match(source, /'X-AQTE-Intent': 'manual-live-control'/);
  assert.doesNotMatch(source, /'X-AQTE-Intent': body \? 'manual-live-control' : 'status'/);
});

test('Liquidity Hunter is mounted at the top of the main application', () => {
  assert.match(page, /import LiquidityHunterProSection from '@\/components\/LiquidityHunterProSection'/);
  assert.doesNotMatch(page, /dynamic\(\(\) => import\('@\/components\/LiquidityHunterProSection'\)/);
  assert.match(page, /LiquidityHunterProSection marketData=\{marketData\}/);
  const mount = page.indexOf('<LiquidityHunterProSection');
  assert.ok(mount < page.indexOf('<OpeningEdgeSection'));
  assert.doesNotMatch(page, /QuantumEdgeIntradaySection|AutonomiqProSection|AQTESection|InstitutionalWorkspace/);
});

test('Liquidity Hunter renders without invalid React element types', () => {
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2020, esModuleInterop: true,
  } }).outputText;
  const context = {
    exports: {}, AbortSignal, Intl, Number, Date, fetch: async () => {
      throw new Error('Effects must not run during server rendering.');
    },
    require(id) {
      if (id === './LiquidityHunterProSection.module.css') {
        return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
      }
      if (id === '@/lib/api-config') return { API_CONFIG: { endpoint: value => value } };
      if (id === '@/lib/visitor-id') return { getOrCreateVisitorId: () => 'device' };
      return require(id);
    },
  };
  vm.runInNewContext(code, context);
  const html = renderToStaticMarkup(React.createElement(context.exports.default, {
    marketData: { NIFTY: null, BANKNIFTY: null, SENSEX: null }, isConnected: false,
  }));
  assert.match(html, /Liquidity Hunter Pro/);
  assert.match(html, /LIVE TRADE/);
});

test('Liquidity Hunter never displays an active trade against another selected index', () => {
  assert.match(source, /const trade = active\?\.symbol === selected\.symbol \? active : null/);
});

test('Zerodha badge uses token authentication and does not require closed-market ticks', () => {
  assert.match(source, /snapshot\.zerodha_authenticated \?\? snapshot\.zerodha_connected/);
  assert.match(source, /const connected = zerodhaAuthenticated && !!isConnected/);
  assert.doesNotMatch(source, /snapshot\?\.zerodha_connected && !!isConnected/);
});

test('risk and daily limits have persisted authenticated save controls', () => {
  assert.ok(source.includes('aria-label={`${selected.symbol} risk per trade`}'));
  assert.match(source, /aria-label="Daily loss limit"/);
  assert.match(source, /request<Snapshot>\('limits'/);
  assert.match(source, /daily_loss_limit: dailyValue/);
  assert.doesNotMatch(source, /placeholder="Amount"/);
});

test('live position quotes update P&L without replacing a newer or stale snapshot', () => {
  const code = ts.transpileModule(source + '\nexports.testQuote = withLiveQuote;', { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2020, esModuleInterop: true,
  } }).outputText;
  const context = {
    exports: {}, AbortSignal, Intl, Number, Date,
    require(id) {
      if (id === './LiquidityHunterProSection.module.css') return { __esModule: true, default: {} };
      if (id === '@/lib/api-config') return { API_CONFIG: {} };
      if (id === '@/lib/visitor-id') return { getOrCreateVisitorId: () => 'device' };
      return require(id);
    },
  };
  vm.runInNewContext(code, context);
  const trade = { entry_price: 100, filled: 65, exited: 5, ltp: 101, unrealized: 60, ltp_received_at: 10 };
  const quote = { token: 7, price: 102, received_at: 11, validUntil: 1000 };
  const live = context.exports.testQuote(trade, quote, 999);
  assert.equal(live.ltp, 102);
  assert.equal(live.unrealized, 120);
  assert.equal(context.exports.testQuote(trade, { ...quote, received_at: 9 }, 999), trade);
  const stale = context.exports.testQuote(trade, quote, 1000);
  assert.equal(stale.ltp, null);
  assert.equal(stale.unrealized, null);
});

test('trade prices and P&L show gain, loss and neutral colors consistently', () => {
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2020, esModuleInterop: true,
  } }).outputText;
  for (const [ltp, pnl, color] of [[102, 130, 'positive'], [98, -130, 'negative'],
    [100, 0, 'neutral'], [null, null, 'neutral']]) {
    const trade = {
      id: 'trade', symbol: 'NIFTY', state: 'PROTECTED', entry_price: 100,
      quantity: 65, filled: 65, initial_stop: 90, stop: 95, target: 120, ltp, unrealized: pnl,
      protection_confirmed: true,
      contract: { token: 7, trading_symbol: 'NIFTYTEST', lot_size: 65 },
    };
    const snapshot = {
      active: trade, positions: [trade], trades: [], daily_trades: 0, daily_pnl: pnl,
      signals: {}, ai: { last_result: {} }, indices: { NIFTY: { lots: 1 } },
    };
    let firstState = true;
    const react = { ...React, useState(initial) {
      if (firstState) { firstState = false; return React.useState(snapshot); }
      return React.useState(initial);
    } };
    const context = {
      exports: {}, AbortSignal, Intl, Number, Date,
      require(id) {
        if (id === 'react') return react;
        if (id === './LiquidityHunterProSection.module.css') {
          return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
        }
        if (id === '@/lib/api-config') return { API_CONFIG: {} };
        if (id === '@/lib/visitor-id') return { getOrCreateVisitorId: () => 'device' };
        return require(id);
      },
    };
    vm.runInNewContext(code, context);
    const html = renderToStaticMarkup(React.createElement(context.exports.default, {
      marketData: { NIFTY: null, BANKNIFTY: null, SENSEX: null }, isConnected: false,
    }));
    for (const label of ['Live LTP', 'Current P&amp;L', 'Profit (Points)', 'Profit (%)',
      'Today&#x27;s P&amp;L', 'Realized P&amp;L', 'Unrealized P&amp;L']) {
      assert.ok(html.includes(`${label}</small><b class="${color}">`), `${label}: ${color}`);
    }
    assert.match(html, new RegExp(`<td class="${color}">${ltp == null ? '--' : `${ltp}\\.00`}</td>`));
    assert.match(html, new RegExp(`<td class="${color}">${pnl == null ? '--' : '[^<]+'}</td>`));
    assert.match(html, /Initial stop loss<\/small><b>₹90\.00<\/b>/);
    assert.match(html, /Trailing stop<\/small><b>₹95\.00<\/b>/);
  }
});

test('trailing status distinguishes waiting, smart mode, unconfirmed and pending stops', () => {
  const code = ts.transpileModule(source + '\nexports.testTrailing = trailingMessage;', { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2020, esModuleInterop: true,
  } }).outputText;
  const context = {
    exports: {}, AbortSignal, Intl, Number, Date,
    require(id) {
      if (id === './LiquidityHunterProSection.module.css') return { __esModule: true, default: {} };
      if (id === '@/lib/api-config') return { API_CONFIG: {} };
      if (id === '@/lib/visitor-id') return { getOrCreateVisitorId: () => 'device' };
      return require(id);
    },
  };
  vm.runInNewContext(code, context);
  const trade = { state: 'PROTECTED', protection_confirmed: true, entry_price: 161.10,
    initial_stop: 129.15, trail_start_r: 1, trailing_active: false };
  assert.equal(context.exports.testTrailing(trade), 'R-multiple trail (smart off): starts at bid ₹193.05');
  assert.equal(context.exports.testTrailing({ ...trade, trailing_mode: 'SMART_ATR_STRUCTURE' }),
    'Smart trail: starts at bid ₹193.05');
  assert.equal(context.exports.testTrailing({ ...trade, modify: {} }), 'Stop update pending Kite confirmation');
  assert.equal(context.exports.testTrailing({ ...trade, protection_confirmed: false }), 'Protection unconfirmed - check Kite');
  assert.equal(context.exports.testTrailing({ ...trade, trailing_active: true,
    trailing_mode: 'SMART_ATR_STRUCTURE', trailing_status: 'R_MULTIPLE_FALLBACK' }),
  'Smart trail: R-multiple fallback: stop trailed');
  assert.match(context.exports.testTrailing({ ...trade, error: 'Quote unavailable' }), /Trailing paused/);
});
