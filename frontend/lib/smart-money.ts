/**
 * Smart-money structure engine: order blocks, breaker blocks and buy-side / sell-side liquidity.
 * Pure and single-pass over closed bars, so it is cheap enough to rerun on every candle close.
 *
 * - Structure: a close beyond the last confirmed swing high / low is a BOS (with trend) or CHoCH (against it).
 * - Order block: the last opposing candle at the origin of the displacement leg that broke structure.
 *   Scored on displacement (ATR), volume expansion, an FVG left in the leg and CHoCH; each retest consumes it.
 * - Breaker: an order block closed through flips role (failed bull OB -> bearish resistance and vice versa).
 * - Liquidity: resting stops above swing highs (BSL) and below swing lows (SSL); equal highs/lows within
 *   0.1 ATR merge into one stronger pool; previous-day high/low are always pools. A wick through that closes
 *   back inside is a SWEEP (stop hunt); a close through is TAKEN (liquidity run).
 * Price-only analytics: no orders are placed and no flow is inferred.
 */
import { istDay, swingPivots, type TerminalBar } from './futures-terminal';

export type SmcSide = 'bull' | 'bear';
export interface OrderBlock {
  id: string; side: SmcSide; kind: 'OB' | 'BREAKER';
  start: number; breakIndex: number; end: number | null;
  top: number; bottom: number;
  touches: number; fvg: boolean; choch: boolean; score: number;
}
export type PoolSource = 'SWING' | 'EQUAL' | 'PDH' | 'PDL';
export interface LiquidityPool {
  id: string; side: 'BSL' | 'SSL'; price: number; start: number; touches: number; source: PoolSource;
  state: 'RESTING' | 'SWEPT' | 'TAKEN' | 'SWEEPING'; sweptAt: number | null;
}
export interface StructureBreak { index: number; side: SmcSide; kind: 'BOS' | 'CHoCH'; price: number }
export interface SmartMoney {
  blocks: OrderBlock[]; pools: LiquidityPool[]; trend: -1 | 0 | 1;
  lastBreak: StructureBreak | null; target: LiquidityPool | null; lastIndex: number; price: number;
}

export const EMPTY_SMART_MONEY: SmartMoney = { blocks: [], pools: [], trend: 0, lastBreak: null, target: null, lastIndex: -1, price: 0 };

interface Options { swing?: number; liquiditySwing?: number; maxBlocks?: number; maxPools?: number; recentSweepBars?: number }

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** Wick-to-wick zone of the origin candle, tightened to the body (then 1 ATR) when the candle is outsized. */
function zone(bar: TerminalBar, side: SmcSide, a: number): [number, number] {
  let top = bar.h, bottom = bar.l;
  if (top - bottom > 1.5 * a) {
    if (side === 'bull') top = Math.max(bar.o, bar.c); else bottom = Math.min(bar.o, bar.c);
    if (top - bottom > 1.5 * a) { if (side === 'bull') top = bottom + a; else bottom = top - a; }
  }
  return [top, bottom];
}

function averageVolume(bars: readonly TerminalBar[], end: number, length = 20) {
  let sum = 0, count = 0;
  for (let i = Math.max(0, end - length); i < end; i++) { sum += bars[i].v; count++; }
  return count ? sum / count : 0;
}

/**
 * Detects structure on `bars[0..closed)` only (pivots and closes are final there).
 * The forming bar is applied afterwards in `applyFormingBar`, so live ticks never re-run detection.
 */
export function detectSmartMoney(
  bars: readonly TerminalBar[], closed: number, atrValues: readonly (number | null)[], options: Options = {},
): SmartMoney {
  const swing = options.swing ?? 3;
  const liqSwing = options.liquiditySwing ?? 3;
  if (closed < swing * 2 + 3) return { ...EMPTY_SMART_MONEY, lastIndex: bars.length - 1, price: bars[bars.length - 1]?.c ?? 0 };
  const atrAt = (i: number) => atrValues[i] ?? Math.max(bars[i].h - bars[i].l, bars[i].c * 0.0008);

  const structure = swingPivots(bars, closed, swing);
  const liquidity = liqSwing === swing ? structure : swingPivots(bars, closed, liqSwing);

  // Previous-day high / low bar indexes become liquidity pivots confirmed at the next session's first bar.
  const extraHighs = new Map<number, PoolSource>(), extraLows = new Map<number, PoolSource>();
  let dayStart = 0, lastHigh = -1, lastLow = -1;
  for (let i = 1; i < closed; i++) {
    if (istDay(bars[i].time) === istDay(bars[dayStart].time)) continue;
    let hi = dayStart, lo = dayStart;
    for (let j = dayStart; j < i; j++) { if (bars[j].h >= bars[hi].h) hi = j; if (bars[j].l <= bars[lo].l) lo = j; }
    extraHighs.set(hi, 'SWING'); extraLows.set(lo, 'SWING');
    lastHigh = hi; lastLow = lo;
    dayStart = i;
  }
  if (lastHigh >= 0) { extraHighs.set(lastHigh, 'PDH'); extraLows.set(lastLow, 'PDL'); }
  // [pivotIndex, confirmIndex, source]
  const highEvents: [number, number, PoolSource][] = [];
  const lowEvents: [number, number, PoolSource][] = [];
  const nextDay = (i: number) => { let j = i + 1; while (j < closed && istDay(bars[j].time) === istDay(bars[i].time)) j++; return j; };
  for (const p of liquidity.highs) if (!extraHighs.has(p)) highEvents.push([p, p + liqSwing + 1, 'SWING']);
  for (const p of liquidity.lows) if (!extraLows.has(p)) lowEvents.push([p, p + liqSwing + 1, 'SWING']);
  const pivotHighs = new Set(liquidity.highs), pivotLows = new Set(liquidity.lows);
  extraHighs.forEach((source, p) => highEvents.push([p, pivotHighs.has(p) ? p + liqSwing + 1 : Math.max(nextDay(p), p + 1), source]));
  extraLows.forEach((source, p) => lowEvents.push([p, pivotLows.has(p) ? p + liqSwing + 1 : Math.max(nextDay(p), p + 1), source]));
  highEvents.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  lowEvents.sort((a, b) => a[1] - b[1] || a[0] - b[0]);

  const blocks: OrderBlock[] = [];
  const active: OrderBlock[] = [];
  const pools: LiquidityPool[] = [];
  const resting: LiquidityPool[] = [];
  const inside = new Map<OrderBlock, boolean>();
  let trend: -1 | 0 | 1 = 0;
  let lastBreak: StructureBreak | null = null;
  let swingHigh: number | null = null, swingLow: number | null = null; // unbroken structural pivots
  let sh = 0, sl = 0, he = 0, le = 0;

  const addPool = (side: 'BSL' | 'SSL', p: number, source: PoolSource, a: number) => {
    const level = side === 'BSL' ? bars[p].h : bars[p].l;
    const tolerance = Math.max(0.1 * a, level * 0.00015);
    const match = resting.find(pool => pool.side === side && Math.abs(pool.price - level) <= tolerance);
    if (match) {
      match.touches++;
      match.price = side === 'BSL' ? Math.max(match.price, level) : Math.min(match.price, level);
      if (source !== 'SWING') match.source = source;
      else if (match.source === 'SWING') match.source = 'EQUAL';
      return;
    }
    const pool: LiquidityPool = { id: `${side}${p}`, side, price: level, start: p, touches: 1, source, state: 'RESTING', sweptAt: null };
    pools.push(pool);
    resting.push(pool);
  };

  const createBlock = (side: SmcSide, from: number, i: number, choch: boolean) => {
    if (i - from < 1) return;
    // Origin of the displacement leg: extreme bar between the broken pivot and the breaking bar.
    let k = from + 1;
    for (let j = from + 1; j < i; j++) {
      if (side === 'bull' ? bars[j].l <= bars[k].l : bars[j].h >= bars[k].h) k = j;
    }
    if (k >= i) k = i - 1;
    // Last opposing candle at that origin (ICT definition), searching up to 3 bars back.
    let origin = k;
    for (let j = k; j >= Math.max(from, k - 3); j--) {
      if (side === 'bull' ? bars[j].c < bars[j].o : bars[j].c > bars[j].o) { origin = j; break; }
    }
    const a = atrAt(i);
    const [top, bottom] = zone(bars[origin], side, a);
    if (top <= bottom) return;
    let fvg = false, peak = 0;
    for (let j = origin + 1; j <= i; j++) {
      peak = Math.max(peak, bars[j].v);
      if (j + 1 <= i && (side === 'bull' ? bars[j - 1].h < bars[j + 1].l : bars[j - 1].l > bars[j + 1].h)) fvg = true;
    }
    const displacement = side === 'bull' ? (bars[i].c - top) / a : (bottom - bars[i].c) / a;
    const avg = averageVolume(bars, origin);
    const volumeRatio = avg > 0 ? peak / avg : 1;
    const score = Math.round(clamp(25 + clamp(displacement, 0, 2.5) * 10 + (fvg ? 15 : 0) + (choch ? 10 : 0)
      + clamp((volumeRatio - 1) * 10, 0, 15), 0, 99));
    const block: OrderBlock = { id: `${side}${origin}`, side, kind: 'OB', start: origin, breakIndex: i, end: null,
      top, bottom, touches: 0, fvg, choch, score };
    // One zone per area: an overlapping same-side zone keeps whichever scores higher.
    const overlap = active.find(other => other.side === side && other.kind === 'OB' &&
      Math.min(other.top, top) - Math.max(other.bottom, bottom) > 0.5 * Math.min(other.top - other.bottom, top - bottom));
    if (overlap) {
      if (overlap.score >= score) return;
      overlap.end = i;
      active.splice(active.indexOf(overlap), 1);
    }
    blocks.push(block);
    active.push(block);
    inside.set(block, false);
  };

  for (let i = 0; i < closed; i++) {
    const bar = bars[i];
    const a = atrAt(i);
    while (sh < structure.highs.length && structure.highs[sh] + swing < i) swingHigh = structure.highs[sh++];
    while (sl < structure.lows.length && structure.lows[sl] + swing < i) swingLow = structure.lows[sl++];
    while (he < highEvents.length && highEvents[he][1] <= i) { const [p, , s] = highEvents[he++]; addPool('BSL', p, s, a); }
    while (le < lowEvents.length && lowEvents[le][1] <= i) { const [p, , s] = lowEvents[le++]; addPool('SSL', p, s, a); }

    // Retests, invalidation and breaker flips of live zones.
    for (let b = active.length - 1; b >= 0; b--) {
      const block = active[b];
      if (block.breakIndex >= i) continue;
      const support = block.side === 'bull';
      const broken = support ? bar.c < block.bottom : bar.c > block.top;
      if (broken) {
        block.end = i;
        active.splice(b, 1);
        if (block.kind === 'OB') {
          const breaker: OrderBlock = { ...block, id: `brk${block.id}`, side: support ? 'bear' : 'bull', kind: 'BREAKER',
            start: i, breakIndex: i, end: null, touches: 0, score: Math.max(30, block.score - 15) };
          blocks.push(breaker);
          active.push(breaker);
          inside.set(breaker, false);
        }
        continue;
      }
      const touching = support ? bar.l <= block.top : bar.h >= block.bottom;
      if (touching && !inside.get(block)) block.touches++;
      inside.set(block, touching);
      // A zone retested three times has absorbed its orders.
      if (block.touches >= 3 && !touching) { block.end = i; active.splice(b, 1); }
    }

    // Liquidity runs.
    for (let p = resting.length - 1; p >= 0; p--) {
      const pool = resting[p];
      if (pool.start >= i) continue;
      const hit = pool.side === 'BSL' ? bar.h > pool.price : bar.l < pool.price;
      if (!hit) continue;
      pool.sweptAt = i;
      pool.state = (pool.side === 'BSL' ? bar.c < pool.price : bar.c > pool.price) ? 'SWEPT' : 'TAKEN';
      resting.splice(p, 1);
    }

    // Structure breaks create order blocks.
    if (swingHigh !== null && bar.c > bars[swingHigh].h) {
      const choch = trend === -1;
      lastBreak = { index: i, side: 'bull', kind: choch ? 'CHoCH' : 'BOS', price: bars[swingHigh].h };
      trend = 1;
      createBlock('bull', swingHigh, i, choch);
      swingHigh = null;
    } else if (swingLow !== null && bar.c < bars[swingLow].l) {
      const choch = trend === 1;
      lastBreak = { index: i, side: 'bear', kind: choch ? 'CHoCH' : 'BOS', price: bars[swingLow].l };
      trend = -1;
      createBlock('bear', swingLow, i, choch);
      swingLow = null;
    }
  }

  const last = bars[closed - 1];
  return select({ blocks, pools, trend, lastBreak, target: null, lastIndex: closed - 1, price: last.c }, closed, atrAt(closed - 1), options);
}

/** Keeps the chart clean: nearest live zones per side, nearest resting pools, and only fresh sweeps. */
function select(state: SmartMoney, closed: number, a: number, options: Options): SmartMoney {
  const maxBlocks = options.maxBlocks ?? 3, maxPools = options.maxPools ?? 3, recent = options.recentSweepBars ?? 20;
  const price = state.price;
  const distance = (block: OrderBlock) => price > block.top ? price - block.top : price < block.bottom ? block.bottom - price : 0;
  // Weak or consumed zones are hidden unless price is trading inside them right now.
  const live = state.blocks.filter(block => block.end === null && distance(block) <= 6 * a &&
    (effectiveScore(block) >= 30 || distance(block) === 0));
  const pick = (side: SmcSide, kind: OrderBlock['kind'], count: number) =>
    live.filter(block => block.side === side && block.kind === kind).sort((x, y) => distance(x) - distance(y)).slice(0, count);
  const zones = [...pick('bull', 'OB', maxBlocks), ...pick('bear', 'OB', maxBlocks)];
  const overlaps = (x: OrderBlock, y: OrderBlock) => Math.min(x.top, y.top) > Math.max(x.bottom, y.bottom);
  // A breaker that sits on an order block adds nothing but clutter; the order block wins.
  const breakers = [...pick('bull', 'BREAKER', 2), ...pick('bear', 'BREAKER', 2)]
    .filter(breaker => !zones.some(zone => overlaps(zone, breaker)));
  const blocks = [...zones, ...breakers.filter(b => b.side === 'bull').slice(0, 1), ...breakers.filter(b => b.side === 'bear').slice(0, 1)];

  const restingSide = (side: 'BSL' | 'SSL') => state.pools
    .filter(pool => pool.side === side && pool.state === 'RESTING')
    .sort((x, y) => Math.abs(x.price - price) - Math.abs(y.price - price)).slice(0, maxPools);
  const swept = (side: 'BSL' | 'SSL') => state.pools
    .filter(pool => pool.side === side && pool.sweptAt !== null && closed - 1 - pool.sweptAt <= recent)
    .sort((x, y) => y.sweptAt! - x.sweptAt!).slice(0, 1);
  const bsl = restingSide('BSL'), ssl = restingSide('SSL');
  const pools = [...bsl, ...ssl, ...swept('BSL'), ...swept('SSL')];
  // Draw on liquidity: the nearest resting pool in the direction of structure.
  const target = state.trend === 1 ? bsl[0] ?? null : state.trend === -1 ? ssl[0] ?? null : null;
  return { ...state, blocks, pools, target };
}

/** Applies the still-forming candle (live ticks) without re-running detection. */
export function applyFormingBar(state: SmartMoney, bars: readonly TerminalBar[], closed: number): SmartMoney {
  if (!bars.length) return state;
  const last = bars[bars.length - 1];
  if (closed >= bars.length) return state.price === last.c ? state : { ...state, price: last.c, lastIndex: bars.length - 1 };
  const pools = state.pools.map(pool => pool.state === 'RESTING' && (pool.side === 'BSL' ? last.h > pool.price : last.l < pool.price)
    ? { ...pool, state: 'SWEEPING' as const, sweptAt: bars.length - 1 } : pool);
  return { ...state, pools, price: last.c, lastIndex: bars.length - 1 };
}

export const blockLabel = (block: OrderBlock) =>
  `${block.side === 'bull' ? 'Bull' : 'Bear'} ${block.kind === 'OB' ? 'OB' : 'Breaker'}`;
export const poolLabel = (pool: LiquidityPool) =>
  `${pool.side}${pool.source === 'PDH' || pool.source === 'PDL' ? ` · ${pool.source}` : ''}${pool.touches > 1 ? ` · ${pool.side === 'BSL' ? 'EQH' : 'EQL'}×${pool.touches}` : ''}`;
/** Score after retests: each retest consumes resting orders in the zone. */
export const effectiveScore = (block: OrderBlock) => Math.max(0, block.score - block.touches * 12);
