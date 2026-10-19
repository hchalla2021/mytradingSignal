const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function compile(file, extras = {}) {
  const compiled = ts.transpileModule(readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const context = { exports: {}, ...extras };
  vm.runInNewContext(compiled, context);
  return context.exports;
}

test('history cache deduplicates concurrent interval requests and returns the exact stored page', async () => {
  const { createHistoryPageCache } = compile('lib/chart-history-cache.ts');
  const cache = createHistoryPageCache();
  let resolve;
  let requests = 0;
  const fetch = () => { requests++; return new Promise(done => { resolve = done; }); };
  const first = cache.load('NIFTY:3', fetch);
  const second = cache.load('NIFTY:3', fetch);
  assert.equal(first, second);
  assert.equal(requests, 1);
  const page = { candles: [{ t: '2026-10-19T09:15:00+05:30' }] };
  resolve(page);
  await first;
  assert.equal(cache.read('NIFTY:3').value, page);
  assert.equal(cache.read('NIFTY:3').fresh, true);
  assert.equal(cache.read('NIFTY:5'), undefined);
});

test('expired pages remain instantly readable while refresh failures are retryable', async () => {
  let now = 1000;
  const { createHistoryPageCache } = compile('lib/chart-history-cache.ts', { Date: { now: () => now } });
  const cache = createHistoryPageCache(12, 20_000);
  await cache.load('NIFTY:5', async () => 'old');
  now += 20_001;
  assert.equal(cache.read('NIFTY:5').fresh, false);
  await assert.rejects(cache.load('NIFTY:5', async () => { throw new Error('offline'); }), /offline/);
  assert.equal(cache.read('NIFTY:5').value, 'old');
  await cache.load('NIFTY:5', async () => 'new');
  assert.equal(cache.read('NIFTY:5').value, 'new');
});

test('LRU bounds memory and keeps date jumps, symbols and intervals isolated', async () => {
  const { createHistoryPageCache } = compile('lib/chart-history-cache.ts');
  const cache = createHistoryPageCache(2);
  await cache.load('NIFTY:5:latest:2026-10-19', async () => 'latest');
  await cache.load('NIFTY:5:2024-10-15', async () => 'historical');
  cache.read('NIFTY:5:latest:2026-10-19');
  await cache.load('BANKNIFTY:3:latest:2026-10-19', async () => 'bank');
  assert.equal(cache.read('NIFTY:5:2024-10-15'), undefined);
  assert.equal(cache.read('NIFTY:5:latest:2026-10-19').value, 'latest');
  assert.equal(cache.read('NIFTY:5:latest:2026-10-20'), undefined);
});

test('timeframe hook restores cached candles synchronously and ignores switched-away responses', async () => {
  let now = Date.parse('2026-10-19T11:30:00+05:30');
  class Clock extends Date { static now() { return now; } }
  const { createHistoryPageCache } = compile('lib/chart-history-cache.ts', { Date: Clock });
  const timers = new Map();
  let timerId = 0;
  const slots = [];
  let cursor = 0;
  let effects = [];
  const equal = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useRef(value) { const i = cursor++; return slots[i] ?? (slots[i] = { current: value }); },
    useState(value) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = value;
      return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
    },
    useCallback(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !equal(slots[i].deps, deps)) slots[i] = { fn, deps };
      return slots[i].fn;
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !equal(slots[i].deps, deps)) {
        const old = slots[i];
        slots[i] = { deps };
        effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); });
      }
    },
  };
  const pending = [];
  const hook = compile('hooks/useChartHistory.ts', {
    require(name) {
      if (name === 'react') return react;
      if (name.endsWith('chart-history-cache')) return { createHistoryPageCache };
      if (name.endsWith('api-config')) return { API_CONFIG: { endpoint: value => value } };
      if (name.endsWith('chart-workspace')) return {
        candleTime: row => Date.parse(row.t) / 1000,
        sessionDate: time => new Date((time + 19800) * 1000).toISOString().slice(0, 10),
      };
      throw new Error(name);
    },
    fetch: url => new Promise(resolve => pending.push({ url, resolve })),
    Date: Clock, AbortController, URLSearchParams, console,
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const render = interval => { flush(); cursor = 0; return hook.useChartHistory('NIFTY', interval); };
  const flush = () => { const queued = effects; effects = []; queued.forEach(fn => fn()); };
  const page = (close, nextBefore = null, date = '2026-10-19') => ({
    candles: [{ t: `${date}T09:15:00+05:30`, o: close, h: close + 1, l: close - 1, c: close, v: 0 }],
    dailyCandles: [], nextBefore,
  });
  const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
  render(3); flush();
  pending[0].resolve({ ok: true, json: async () => page(103) });
  await settle();
  assert.equal(render(3).candles[0].c, 103);
  render(5); flush();
  const back = render(3);
  assert.equal(back.candles[0].c, 103);
  assert.equal(back.loading, false);
  flush();
  assert.equal(pending.length, 2);
  pending[1].resolve({ ok: true, json: async () => page(105, '2026-10-06') });
  await settle();
  assert.equal(render(3).candles[0].c, 103);
  assert.equal(render(5).candles[0].c, 105);
  flush();
  assert.equal(pending.length, 2);
  render(5).jumpToDate('2024-10-14');
  assert.match(pending[2].url, /before=2024-10-15/);
  pending[2].resolve({ ok: true, json: async () => page(90) });
  await settle();
  assert.equal(render(5).candles[0].c, 90);
  render(3); flush();
  assert.equal(render(5).candles[0].c, 105);
  flush();
  assert.equal(pending.length, 3);
  render(5).loadOlder();
  pending[3].resolve({ ok: true, json: async () => page(99, null, '2026-09-30') });
  await settle();
  assert.equal(render(5).candles.length, 2);
  // Commit the context snapshot, then switch away and back without losing the older page.
  flush();
  render(3); flush();
  const warmed = render(5);
  assert.equal(warmed.candles.length, 2);
  assert.equal(warmed.candles[0].c, 99);
  assert.equal(warmed.candles[1].c, 105);
  flush();
  assert.equal(pending.length, 4);
  render(3); flush();

  const warm = () => {
    const timer = [...timers].find(([, value]) => value.ms === 800);
    assert.ok(timer, 'next context page should be scheduled in the background');
    timers.delete(timer[0]); timer[1].fn();
  };
  const noWarm = () => assert.equal([...timers.values()].some(value => value.ms === 800), false);
  render(15); flush();
  pending[4].resolve({ ok: true, json: async () => page(115, '2026-10-05') });
  await settle(); render(15); flush(); warm();
  assert.match(pending[5].url, /before=2026-10-05/);
  pending[5].resolve({ ok: true, json: async () => page(95, '2026-09-21', '2026-09-30') });
  await settle(); render(15); flush(); warm();
  assert.match(pending[6].url, /before=2026-09-21/);
  pending[6].resolve({ ok: true, json: async () => page(85, '2026-09-07', '2026-09-16') });
  await settle();
  assert.equal(render(15).candles.length, 3);
  assert.equal(render(15).warmingContext, false);
  flush(); noWarm();

  // Date jumps must not start automatic warming, even when their cursor is recent.
  render(15).jumpToDate('2026-10-15');
  pending[7].resolve({ ok: true, json: async () => page(114, '2026-10-02', '2026-10-15') });
  await settle();
  assert.equal(render(15).warmingContext, false);
  flush(); noWarm();
  render(15).latest();
  assert.equal(render(15).candles.length, 3);
  flush();

  // Reading the merged context must not extend the latest native page's freshness.
  now += 15000;
  render(15).latest();
  render(15); flush();
  assert.equal(pending.length, 8);
  // A stale latest-page refresh must preserve the previously warmed older pages.
  now += 10000;
  render(15).latest();
  assert.equal(render(15).candles.length, 3);
  pending[8].resolve({ ok: true, json: async () => page(116, '2026-10-05') });
  await settle();
  const refreshed = render(15);
  assert.equal(refreshed.candles.length, 3);
  assert.equal(refreshed.candles.at(-1).c, 116);
  assert.equal(refreshed.warmingContext, false);
  flush(); noWarm();
});
