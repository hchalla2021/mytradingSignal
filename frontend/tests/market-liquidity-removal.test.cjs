const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

const frontend = path.join(__dirname, '..');
const read = (...parts) => readFileSync(path.join(frontend, ...parts), 'utf8');

test('dashboard no longer mounts or loads the standalone Market Liquidity section', () => {
  const page = read('app', 'page.tsx');
  assert.doesNotMatch(page, /components\/LiquidityIntelligence/);
  assert.doesNotMatch(page, /<LiquidityIntelligence\b/);
  assert.equal(existsSync(path.join(frontend, 'components', 'LiquidityIntelligence.tsx')), false);
  assert.equal(existsSync(path.join(frontend, 'hooks', 'useLiquiditySocket.ts')), false);
});

test('independent liquidity views and the Observatory backend dependency remain intact', () => {
  assert.match(read('lib', 'trade-status', 'plugins.tsx'), /components\/MarketLiquidityIntelligence/);
  assert.ok(existsSync(path.join(frontend, 'components', 'MarketLiquidityIntelligence.tsx')));
  assert.match(
    read('..', 'backend', 'services', 'observatory_service.py'),
    /from services\.liquidity_service import get_liquidity_service/,
  );
  assert.ok(existsSync(path.join(frontend, '..', 'backend', 'services', 'liquidity_service.py')));
});

test('dashboard removes candle and Smart Money sections without leaving unused card code', () => {
  const page = read('app', 'page.tsx');
  assert.doesNotMatch(page, /CandleIntelligenceEngine|InstitutionalMarketView/);
  assert.doesNotMatch(page, /Smart Money \u2022 Order Logic/);
  assert.equal(existsSync(path.join(frontend, 'components', 'InstitutionalMarketView.tsx')), false);
});

test('shared candle engine and order-flow consumers retain their dependencies', () => {
  assert.match(read('lib', 'trade-status', 'plugins.tsx'), /components\/CandleIntelligenceEngine/);
  assert.ok(existsSync(path.join(frontend, 'components', 'CandleIntelligenceEngine.tsx')));
  assert.ok(existsSync(path.join(frontend, 'hooks', 'useCandleIntelligence.ts')));
  assert.match(read('components', 'OverallMarketOutlook.tsx'), /hooks\/useOrderFlowRealtime/);
  assert.ok(existsSync(path.join(frontend, 'hooks', 'useOrderFlowRealtime.ts')));
});
