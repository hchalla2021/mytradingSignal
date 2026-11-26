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
