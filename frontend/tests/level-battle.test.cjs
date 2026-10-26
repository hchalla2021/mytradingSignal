const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, modules = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', file), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const module_ = { exports: {} };
  vm.runInNewContext(outputText, { module: module_, exports: module_.exports, require: name => modules[name] ?? {} });
  return module_.exports;
}

const terminal = load('futures-terminal.ts');
const indicators = load('chart-indicators.ts', { './chart-workspace': { candleTime: () => 0, sessionDate: () => '' } });
const battle = load('level-battle.ts', { './futures-terminal': terminal, './chart-indicators': indicators });

const DAY1 = Date.UTC(2024, 0, 2, 3, 45) / 1000;
const DAY2 = DAY1 + 86_400;
const STEP = 300;

/** Yesterday ranges 990–1010 (close 1000); today drifts with the given closes. */
function session(todayCloses) {
  const bars = [];
  for (let i = 0; i < 60; i++) {
    const c = 1000 + Math.sin(i / 4) * 8;
    bars.push({ time: DAY1 + i * STEP, o: c, h: Math.min(1010, c + 2), l: Math.max(990, c - 2), c, v: 100, oi: null });
  }
  bars[10].h = 1010; bars[20].l = 990; bars[59].c = 1000;
  let previous = 1000;
  todayCloses.forEach((c, i) => {
    bars.push({ time: DAY2 + i * STEP, o: previous, h: Math.max(previous, c) + 1, l: Math.min(previous, c) - 1, c, v: 100, oi: null });
    previous = c;
  });
  return bars;
}

const flowBar = (t, lv, d = 0, v = 100) => ({ t, end: t + STEP, o: 0, h: 0, l: 0, c: 0, v, b: (v + d) / 2, s: (v - d) / 2, n: 0, d, cvd: 0,
  poc: null, lv, imb: { buy: [], sell: [] }, book: null, depth: null, spread: null, basis: null, complete: true, closed: true,
  coverage: 1, flags: [], oi: null, oiOpen: null });

test('levels come from the chart candles: EMAs, Camarilla, CPR, pivots and previous-day high/low', () => {
  const bars = session([1001, 1002, 1003]);
  const levels = battle.chartLevels(bars, { intraday: true, vwap: true });
  const byId = Object.fromEntries(levels.map(level => [level.id, level.price]));
  assert.equal(byId.pdh, 1010);
  assert.equal(byId.pdl, 990);
  assert.ok(Math.abs(byId['cam:S3'] - (1000 - 20 * 1.1 / 4)) < 1e-9);
  assert.ok(Math.abs(byId['cam:R3'] - (1000 + 20 * 1.1 / 4)) < 1e-9);
  assert.ok(byId['cpr:TC'] >= byId['cpr:BC']);
  for (const id of ['ema9', 'ema20', 'ema21', 'ema50', 'vwap', 'pivot:S1']) assert.ok(id in byId, id);
  assert.ok(!('ema100' in byId), 'no EMA before it has enough candles');
  const cash = battle.chartLevels(bars.map(bar => ({ ...bar, v: 0 })), { intraday: true, vwap: false });
  assert.ok(!cash.some(level => level.id === 'vwap'), 'no VWAP without volume');
});

test('lines within one zone merge into a single confluence level', () => {
  const clusters = battle.clusterLevels([
    { id: 'a', label: 'Cam S3', price: 100, group: 'CAM' },
    { id: 'b', label: 'EMA 200', price: 100.8, group: 'EMA' },
    { id: 'c', label: 'PDL', price: 110, group: 'PDH/PDL' },
  ], 0.5);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].members.length, 2);
});

test('earlier tests are classified as reject or break', () => {
  const bars = session([1001, 999, 997.5, 1000, 1002, 998.5, 995, 993, 990]);
  const tests = battle.levelTests(bars, 996.5, 0.5);
  assert.deepEqual(Array.from(tests, test => test.result), ['REJECT', 'BREAK']);
});

test('support with buyers absorbing in the zone reads REJECT ↑; heavy sellers pushing in reads BREAK ↓', () => {
  const futures = session([1006, 1004, 1003, 1002, 1001]);
  const price = futures[futures.length - 1].c;
  const level = { id: 'cam:S1', label: 'Cam S1', price: 1001, group: 'CAM' };
  const t = futures[futures.length - 1].time;
  const absorb = [flowBar(t - STEP, [[1001, 900, 200]], 120), flowBar(t, [[1001, 800, 150]], 80)];
  const bull = battle.levelBattles({ levels: [level], price, futures, flowBars: absorb, dom: null, offset: 0 })[0];
  assert.equal(bull.state, 'AT');
  assert.equal(bull.role, 'SUPPORT');
  assert.equal(bull.buy, 1700);
  assert.equal(bull.sell, 350);
  assert.equal(bull.call, 'REJECT');
  assert.ok(bull.up >= 65 && bull.up + bull.down === 100);
  assert.match(battle.battleHeadline(bull), /^REJECT \d+% ↑/);

  const dump = [flowBar(t - STEP, [[1001, 100, 900]], -80), flowBar(t, [[1001, 120, 1000]], -90)];
  const bear = battle.levelBattles({ levels: [level], price, futures, flowBars: dump, dom: null, offset: 0 })[0];
  assert.equal(bear.call, 'BREAK');
  assert.ok(bear.down >= 65);
  assert.match(battle.battleHeadline(bear), /^BREAK \d+% ↓/);
});

test('cash levels are measured at their futures price through the basis; unrelated contracts get no flow', () => {
  const futures = session([1006, 1004, 1003, 1002, 1001]);
  const t = futures[futures.length - 1].time;
  const flow = [flowBar(t, [[1001, 500, 100]], 50)];
  const cashLevel = { id: 'cam:S1', label: 'Cam S1', price: 951, group: 'CAM' };
  const cash = battle.levelBattles({ levels: [cashLevel], price: 951.2, futures, flowBars: flow, dom: null, offset: 50 })[0];
  assert.equal(cash.buy, 500);
  assert.ok(cash.flowAvailable);
  const other = battle.levelBattles({ levels: [cashLevel], price: 951.2, futures, flowBars: flow, dom: null, offset: null })[0];
  assert.equal(other.buy, 0);
  assert.equal(other.flowAvailable, false);
});

test('away from levels the nearest support and resistance are shown with points to the next level', () => {
  const futures = session([1003, 1003.5, 1004]);
  const levels = [
    { id: 'r', label: 'Cam R3', price: 1030, group: 'CAM' },
    { id: 'r2', label: 'Cam R4', price: 1050, group: 'CAM' },
    { id: 's', label: 'Cam S3', price: 970, group: 'CAM' },
  ];
  const all = battle.levelBattles({ levels, price: 1004, futures, flowBars: [], dom: null, offset: 0 });
  const shown = battle.activeBattles(all);
  assert.deepEqual(Array.from(shown, item => item.label), ['Cam R3', 'Cam S3']);
  assert.ok(shown.every(item => item.state === 'FAR'));
  assert.equal(shown[0].above.label, 'Cam R4');
  assert.equal(shown[0].above.points, 20);
});

test('when price is near several resistances the nearest support is still shown', () => {
  const futures = session([1003, 1003.5, 1004]);
  const levels = [1005, 1007, 1009, 1011, 1013].map((price, i) => ({ id: `r${i}`, label: `R${i}`, price, group: 'CAM' }))
    .concat([{ id: 's', label: 'Cam S3', price: 970, group: 'CAM' }]);
  const shown = battle.activeBattles(battle.levelBattles({ levels, price: 1004, futures, flowBars: [], dom: null, offset: 0 }));
  assert.ok(shown.length <= 4);
  assert.ok(shown.some(item => item.role === 'SUPPORT'));
  assert.ok(shown.some(item => item.role === 'RESISTANCE'));
});
