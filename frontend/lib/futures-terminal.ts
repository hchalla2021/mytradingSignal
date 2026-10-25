/**
 * Futures Advanced Chart analytics (pure, allocation-light, unit-tested).
 *
 * Data honesty rules enforced here:
 * - Buyer/seller volume comes only from recorded order-flow bars (aggressor side estimated by the backend with
 *   Lee-Ready on ~1s KiteTicker snapshots). Bars without a recording return null; nothing is inferred from OHLC.
 * - Bid/ask depth is pending orders, never treated as executed volume.
 * - Open interest is null whenever the exchange did not report it.
 * - Signal confidence is a transparent rule score, not a probability. No orders are ever placed.
 */
import type { OrderFlowBar, OrderFlowDom, OrderFlowEvent } from './order-flow';

export const IST_OFFSET = 19_800;
export const EMA_PERIODS = [9, 21, 25, 50, 100, 200] as const;
export type EmaPeriod = typeof EMA_PERIODS[number];
export type Side = 'BUY' | 'SELL';
export type Bias = 'BULL' | 'BEAR' | 'NEUTRAL';

export interface TerminalBar { time: number; o: number; h: number; l: number; c: number; v: number; oi: number | null }
export interface Level { price: number; touches: number; lastIndex: number; kind: 'support' | 'resistance' }
export interface PrevDay { high: number; low: number; close: number; day: number }
export interface Mark { index: number; side: Side | 'NEUTRAL'; kind: string; label: string; price: number }
export type OiBuildup = 'Long build-up' | 'Short build-up' | 'Short covering' | 'Long unwinding';

export const istDay = (time: number) => Math.floor((time + IST_OFFSET) / 86_400);
const sessionOpen = (time: number) => istDay(time) * 86_400 - IST_OFFSET + 555 * 60;

export function roundToTick(price: number, tick: number): number {
  const step = tick > 0 ? tick : 0.05;
  return Math.round(Math.round(price / step) * step * 100) / 100;
}

export function ema(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period < 1 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let previous = sum / period;
  out[period - 1] = previous;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    previous = values[i] * k + previous * (1 - k);
    out[i] = previous;
  }
  return out;
}

/** Session-anchored VWAP (resets each IST trading day); null until volume has traded. */
export function sessionVwap(bars: readonly TerminalBar[]): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null);
  let day = -1, pv = 0, volume = 0;
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const today = istDay(bar.time);
    if (today !== day) { day = today; pv = 0; volume = 0; }
    pv += ((bar.h + bar.l + bar.c) / 3) * bar.v;
    volume += bar.v;
    out[i] = volume > 0 ? pv / volume : null;
  }
  return out;
}

/** Wilder ATR. */
export function atr(bars: readonly TerminalBar[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null);
  let value: number | null = null, sum = 0;
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const previous = i ? bars[i - 1].c : bar.c;
    const range = Math.max(bar.h - bar.l, Math.abs(bar.h - previous), Math.abs(bar.l - previous));
    if (i < period) {
      sum += range;
      if (i === period - 1) value = sum / period;
    } else if (value !== null) value = (value * (period - 1) + range) / period;
    out[i] = value;
  }
  return out;
}

/** High / low / close of the last completed session before the latest bar's session. */
export function previousDay(bars: readonly TerminalBar[]): PrevDay | null {
  if (!bars.length) return null;
  const today = istDay(bars[bars.length - 1].time);
  let i = bars.length - 1;
  while (i >= 0 && istDay(bars[i].time) === today) i--;
  if (i < 0) return null;
  const day = istDay(bars[i].time);
  let high = -Infinity, low = Infinity;
  const close = bars[i].c;
  for (; i >= 0 && istDay(bars[i].time) === day; i--) {
    high = Math.max(high, bars[i].h);
    low = Math.min(low, bars[i].l);
  }
  return { high, low, close, day };
}

/** Confirmed fractal swing points among closed bars (strength bars on each side). */
export function swingPivots(bars: readonly TerminalBar[], closed: number, strength = 3) {
  const highs: number[] = [], lows: number[] = [];
  for (let i = strength; i + strength < closed; i++) {
    let high = true, low = true;
    for (let j = i - strength; j <= i + strength && (high || low); j++) {
      if (j === i) continue;
      if (bars[j].h >= bars[i].h) high = false;
      if (bars[j].l <= bars[i].l) low = false;
    }
    if (high) highs.push(i);
    if (low) lows.push(i);
  }
  return { highs, lows };
}

/** Clusters swing points into support / resistance levels around the current price. */
export function supportResistance(
  bars: readonly TerminalBar[], closed: number, price: number, atrValue: number | null, maxLevels = 3,
): { supports: Level[]; resistances: Level[] } {
  const { highs, lows } = swingPivots(bars, closed);
  const tolerance = Math.max((atrValue ?? 0) * 0.35, price * 0.0004);
  const clusters: { sum: number; count: number; lastIndex: number }[] = [];
  const points = [...highs.map(i => [bars[i].h, i]), ...lows.map(i => [bars[i].l, i])].slice(-160);
  for (const [value, index] of points) {
    const near = clusters.find(cluster => Math.abs(cluster.sum / cluster.count - value) <= tolerance);
    if (near) { near.sum += value; near.count++; near.lastIndex = Math.max(near.lastIndex, index); }
    else clusters.push({ sum: value, count: 1, lastIndex: index });
  }
  const levels = clusters.map(cluster => ({ price: cluster.sum / cluster.count, touches: cluster.count, lastIndex: cluster.lastIndex }));
  const rank = (a: { touches: number; lastIndex: number }, b: { touches: number; lastIndex: number }) =>
    b.touches - a.touches || b.lastIndex - a.lastIndex;
  const supports = levels.filter(level => level.price < price).sort(rank).slice(0, maxLevels)
    .map(level => ({ ...level, kind: 'support' as const })).sort((a, b) => b.price - a.price);
  const resistances = levels.filter(level => level.price > price).sort(rank).slice(0, maxLevels)
    .map(level => ({ ...level, kind: 'resistance' as const })).sort((a, b) => a.price - b.price);
  return { supports, resistances };
}

/** EMA cross markers on closed bars only (a forming bar can still un-cross). */
export function crossovers(fast: readonly (number | null)[], slow: readonly (number | null)[], closed: number, label: string, bars: readonly TerminalBar[]): Mark[] {
  const marks: Mark[] = [];
  for (let i = 1; i < closed; i++) {
    const a0 = fast[i - 1], b0 = slow[i - 1], a1 = fast[i], b1 = slow[i];
    if (a0 == null || b0 == null || a1 == null || b1 == null) continue;
    if (a0 <= b0 && a1 > b1) marks.push({ index: i, side: 'BUY', kind: 'cross', label: `${label} ↑`, price: bars[i].l });
    else if (a0 >= b0 && a1 < b1) marks.push({ index: i, side: 'SELL', kind: 'cross', label: `${label} ↓`, price: bars[i].h });
  }
  return marks;
}

/** Classic price-action patterns on closed bars; tiny bars (< 0.3 ATR) are ignored as noise. */
export function pricePatterns(bars: readonly TerminalBar[], closed: number, atrValues: readonly (number | null)[]): Mark[] {
  const marks: Mark[] = [];
  for (let i = 3; i < closed; i++) {
    const bar = bars[i], prev = bars[i - 1];
    const range = bar.h - bar.l, body = Math.abs(bar.c - bar.o);
    const a = atrValues[i];
    if (range <= 0 || (a != null && range < 0.3 * a)) continue;
    const upper = bar.h - Math.max(bar.o, bar.c), lower = Math.min(bar.o, bar.c) - bar.l;
    const prevBody = Math.abs(prev.c - prev.o);
    const falling = bar.c < bars[i - 3].c || prev.c < bars[i - 3].c;
    const rising = bar.c > bars[i - 3].c || prev.c > bars[i - 3].c;
    if (prev.c < prev.o && bar.c > bar.o && bar.o <= prev.c && bar.c >= prev.o && body > prevBody) {
      marks.push({ index: i, side: 'BUY', kind: 'pattern', label: 'Bull engulf', price: bar.l });
    } else if (prev.c > prev.o && bar.c < bar.o && bar.o >= prev.c && bar.c <= prev.o && body > prevBody) {
      marks.push({ index: i, side: 'SELL', kind: 'pattern', label: 'Bear engulf', price: bar.h });
    } else if (falling && body <= 0.35 * range && lower >= 2 * Math.max(body, range * 0.05) && lower >= 0.55 * range && upper <= 0.2 * range) {
      marks.push({ index: i, side: 'BUY', kind: 'pattern', label: 'Hammer', price: bar.l });
    } else if (rising && body <= 0.35 * range && upper >= 2 * Math.max(body, range * 0.05) && upper >= 0.55 * range && lower <= 0.2 * range) {
      marks.push({ index: i, side: 'SELL', kind: 'pattern', label: 'Shooting star', price: bar.h });
    }
  }
  return marks;
}

/**
 * Liquidity sweeps: a closed bar trades through a resting-stop pool (prior confirmed swing high/low, or the
 * previous day's high/low) and closes back inside. Each level can be swept once. Price-based only.
 */
export function liquiditySweeps(bars: readonly TerminalBar[], closed: number, prevDay: PrevDay | null, strength = 3): Mark[] {
  const { highs, lows } = swingPivots(bars, closed, strength);
  const used = new Set<string>();
  const marks: Mark[] = [];
  for (let i = strength * 2 + 1; i < closed; i++) {
    const bar = bars[i];
    const sameDay = prevDay !== null && istDay(bar.time) > prevDay.day;
    const recentHigh = highs.filter(p => p + strength < i && i - p <= 40).pop();
    const recentLow = lows.filter(p => p + strength < i && i - p <= 40).pop();
    const above: [string, number, string][] = [];
    const below: [string, number, string][] = [];
    if (sameDay) { above.push(['pdh', prevDay!.high, 'PDH sweep']); below.push(['pdl', prevDay!.low, 'PDL sweep']); }
    if (recentHigh !== undefined) above.push([`h${recentHigh}`, bars[recentHigh].h, 'Swing-high sweep']);
    if (recentLow !== undefined) below.push([`l${recentLow}`, bars[recentLow].l, 'Swing-low sweep']);
    const high = above.find(([key, level]) => !used.has(key) && bar.h > level && bar.c < level);
    if (high) { used.add(high[0]); marks.push({ index: i, side: 'SELL', kind: 'sweep', label: high[2], price: high[1] }); continue; }
    const low = below.find(([key, level]) => !used.has(key) && bar.l < level && bar.c > level);
    if (low) { used.add(low[0]); marks.push({ index: i, side: 'BUY', kind: 'sweep', label: low[2], price: low[1] }); }
  }
  return marks;
}

export function oiBuildup(priceChange: number, oiChange: number | null): OiBuildup | null {
  if (oiChange === null || oiChange === 0 || priceChange === 0) return null;
  if (priceChange > 0) return oiChange > 0 ? 'Long build-up' : 'Short covering';
  return oiChange > 0 ? 'Short build-up' : 'Long unwinding';
}

/** OI change vs the previous bar that reported OI; null when either side is missing. */
export function oiChanges(bars: readonly TerminalBar[]): (number | null)[] {
  return bars.map((bar, i) => i && bar.oi !== null && bars[i - 1].oi !== null ? bar.oi - bars[i - 1].oi! : null);
}

/** Buy/sell share of classified (side-estimated) volume. Null when the bar has no recorded classified volume. */
export function dominance(flow: Pick<OrderFlowBar, 'b' | 's' | 'n' | 'v'> | null | undefined) {
  if (!flow) return null;
  const classified = flow.b + flow.s;
  if (classified <= 0) return null;
  return { buyPct: (flow.b / classified) * 100, sellPct: (flow.s / classified) * 100, classified, unclassified: flow.n };
}

export function sessionDominance(bars: readonly OrderFlowBar[], day: number) {
  let b = 0, s = 0, n = 0, v = 0;
  for (const bar of bars) if (istDay(bar.t) === day) { b += bar.b; s += bar.s; n += bar.n; v += bar.v; }
  return dominance({ b, s, n, v });
}

/** Book imbalance of the live 5-level depth (pending orders). +100 all bids, -100 all offers. */
export function depthImbalance(dom: OrderFlowDom | null): number | null {
  if (!dom) return null;
  const bid = dom.bids.reduce((sum, row) => sum + row[1], 0), ask = dom.asks.reduce((sum, row) => sum + row[1], 0);
  return bid + ask > 0 ? ((bid - ask) / (bid + ask)) * 100 : null;
}

/** Candles aggregated into a higher intraday timeframe, buckets anchored at 09:15 IST. */
export function resample(bars: readonly TerminalBar[], minutes: number): TerminalBar[] {
  const out: TerminalBar[] = [];
  const size = minutes * 60;
  for (const bar of bars) {
    const open = sessionOpen(bar.time);
    const bucket = open + Math.floor((bar.time - open) / size) * size;
    const last = out[out.length - 1];
    if (last && last.time === bucket) {
      last.h = Math.max(last.h, bar.h); last.l = Math.min(last.l, bar.l); last.c = bar.c; last.v += bar.v;
      last.oi = bar.oi ?? last.oi;
    } else out.push({ ...bar, time: bucket });
  }
  return out;
}

export function trendBias(bars: readonly TerminalBar[]): { bias: Bias; detail: string } {
  if (bars.length < 21) return { bias: 'NEUTRAL', detail: 'Insufficient bars' };
  const closes = bars.map(bar => bar.c);
  const last = bars.length - 1;
  const fast = ema(closes, 9)[last]!, slow = ema(closes, 21)[last]!;
  const vwap = sessionVwap(bars)[last];
  const close = closes[last];
  if (fast > slow && vwap != null && close > vwap) return { bias: 'BULL', detail: 'EMA9>21 · above VWAP' };
  if (fast < slow && vwap != null && close < vwap) return { bias: 'BEAR', detail: 'EMA9<21 · below VWAP' };
  return { bias: 'NEUTRAL', detail: fast > slow ? 'EMA9>21 · VWAP disagrees' : 'EMA9<21 · VWAP disagrees' };
}

export type FreshnessState = 'LIVE' | 'DELAYED' | 'POLLING' | 'STALE' | 'CLOSED';
export interface Freshness { state: FreshnessState; tickAge: number | null; historyAge: number | null; label: string }

export function freshness(input: {
  nowMs: number; lastTick: number | null; historyUpdated: number | null; streamLive: boolean; inSession: boolean;
}): Freshness {
  const tickAge = input.lastTick === null ? null : Math.max(0, input.nowMs / 1000 - input.lastTick);
  const historyAge = input.historyUpdated === null ? null : Math.max(0, (input.nowMs - input.historyUpdated) / 1000);
  if (!input.inSession) return { state: 'CLOSED', tickAge, historyAge, label: 'Market closed · showing last recorded data' };
  if (input.streamLive && tickAge !== null && tickAge <= 3) return { state: 'LIVE', tickAge, historyAge, label: 'Live ticks' };
  if (tickAge !== null && tickAge <= 20) return { state: 'DELAYED', tickAge, historyAge, label: `Ticks delayed ${Math.round(tickAge)}s` };
  if (historyAge !== null && historyAge <= 45) return { state: 'POLLING', tickAge, historyAge, label: 'History polling (no live tick stream)' };
  return { state: 'STALE', tickAge, historyAge, label: 'Data stale — do not act on it' };
}

// ── Signal engine ─────────────────────────────────────────────────────────────

export interface SignalContext {
  bars: readonly TerminalBar[];
  emas: Record<EmaPeriod, readonly (number | null)[]>;
  vwap: readonly (number | null)[];
  atr: readonly (number | null)[];
  oiChange: readonly (number | null)[];
  levels: { supports: Level[]; resistances: Level[] };
  prevDay: PrevDay | null;
  marks: readonly Mark[];
  flow: ReadonlyMap<number, OrderFlowBar>;
  events: readonly OrderFlowEvent[];
  dom: OrderFlowDom | null;
  higherTimeframes: readonly { label: string; bias: Bias }[];
  tickSize: number;
  intervalSeconds: number;
  freshness: Freshness;
}

export interface Factor { side: Side; points: number; text: string }
export interface TerminalSignal {
  action: Side | 'WAIT'; bias: Bias; stage: 'CONFIRMED' | 'EARLY';
  confidence: number; bullScore: number; bearScore: number; time: number;
  entry: [number, number] | null; stop: number | null; targets: number[]; riskReward: number | null;
  reasons: string[]; against: string[]; cautions: string[];
}

const BULL_EVENTS: Record<string, [number, string]> = {
  absorption_sellers: [15, 'Sellers absorbed at the low (recorded flow)'],
  failed_breakdown: [12, 'Failed breakdown with non-negative delta'],
  exhaustion_sellers: [10, 'Selling exhaustion at the low'],
  stacked_buy_imbalance: [8, 'Stacked buy imbalances in footprint'],
  cvd_divergence_bull: [6, 'Bullish CVD divergence'],
};
const BEAR_EVENTS: Record<string, [number, string]> = {
  absorption_buyers: [15, 'Buyers absorbed at the high (recorded flow)'],
  failed_breakout: [12, 'Failed breakout with non-positive delta'],
  exhaustion_buyers: [10, 'Buying exhaustion at the high'],
  stacked_sell_imbalance: [8, 'Stacked sell imbalances in footprint'],
  cvd_divergence_bear: [6, 'Bearish CVD divergence'],
};

export const MIN_SIGNAL_BARS = 50;
export const ACTION_CONFIDENCE = 60;
export const ACTION_MARGIN = 25;

/**
 * Scores the bar at `at`. `stage` EARLY means `at` is the still-forming bar (may change before close).
 * Returns WAIT whenever data is stale/closed, history is short, or the risk is too wide.
 */
export function evaluateSignal(ctx: SignalContext, at: number, stage: 'CONFIRMED' | 'EARLY'): TerminalSignal {
  const bar = ctx.bars[at];
  const empty: TerminalSignal = {
    action: 'WAIT', bias: 'NEUTRAL', stage, confidence: 0, bullScore: 0, bearScore: 0, time: bar?.time ?? 0,
    entry: null, stop: null, targets: [], riskReward: null, reasons: [], against: [], cautions: [],
  };
  if (!bar) return { ...empty, cautions: ['No candles loaded.'] };
  const factors: Factor[] = [];
  const add = (side: Side, points: number, text: string) => factors.push({ side, points, text });
  const cautions: string[] = [];
  const close = bar.c;
  const a = ctx.atr[at] ?? Math.max(bar.h - bar.l, close * 0.001);
  const e = (period: EmaPeriod) => ctx.emas[period][at];
  const e9 = e(9), e21 = e(21), e50 = e(50), e200 = e(200), vwap = ctx.vwap[at];

  // Trend & averages
  if (e9 != null && e21 != null) e9 > e21 ? add('BUY', 10, 'EMA 9 above EMA 21') : add('SELL', 10, 'EMA 9 below EMA 21');
  if (e21 != null && e50 != null) e21 > e50 ? add('BUY', 8, 'EMA 21 above EMA 50') : add('SELL', 8, 'EMA 21 below EMA 50');
  if (e200 != null) close > e200 ? add('BUY', 5, 'Price above EMA 200') : add('SELL', 5, 'Price below EMA 200');
  if (vwap != null) close > vwap ? add('BUY', 10, 'Price above session VWAP') : add('SELL', 10, 'Price below session VWAP');

  // Recent structural marks (crosses / patterns / sweeps) within 3 bars
  for (const mark of ctx.marks) {
    if (mark.side === 'NEUTRAL' || mark.index > at || at - mark.index > 3) continue;
    const points = mark.kind === 'sweep' ? 12 : mark.kind === 'cross' ? 8 : 7;
    add(mark.side, points, `${mark.label} ${at - mark.index ? `${at - mark.index} bar(s) ago` : 'on this bar'}`);
  }

  // Recorded order flow (estimated aggressor side)
  const flow = ctx.flow.get(bar.time);
  if (!flow) cautions.push('No recorded order flow for this bar — flow factors excluded.');
  else if (flow.coverage < 0.6) cautions.push(`Order-flow coverage only ${Math.round(flow.coverage * 100)}% — flow factors excluded.`);
  else {
    const ratio = flow.v ? flow.d / flow.v : 0;
    if (ratio >= 0.15) add('BUY', 10, `Buy-side delta ${Math.round(ratio * 100)}% of volume (est. aggressor)`);
    else if (ratio <= -0.15) add('SELL', 10, `Sell-side delta ${Math.round(-ratio * 100)}% of volume (est. aggressor)`);
    const flows = Array.from(ctx.flow.values()).filter(item => item.t <= bar.time);
    if (flows.length >= 4) {
      const slope = flows[flows.length - 1].cvd - flows[flows.length - 4].cvd;
      if (slope > 0) add('BUY', 6, 'CVD rising over 3 bars');
      else if (slope < 0) add('SELL', 6, 'CVD falling over 3 bars');
    }
    if (flow.book !== null && flow.book >= 1.2) add('BUY', 4, `Bid book ${flow.book.toFixed(2)}× offers (pending orders)`);
    else if (flow.book !== null && flow.book <= 1 / 1.2) add('SELL', 4, `Offer book ${(1 / flow.book).toFixed(2)}× bids (pending orders)`);
  }
  for (const event of ctx.events) {
    if (event.t > bar.time || bar.time - event.t > 2 * ctx.intervalSeconds) continue;
    const bull = BULL_EVENTS[event.kind], bear = BEAR_EVENTS[event.kind];
    if (bull) add('BUY', bull[0], bull[1]);
    if (bear) add('SELL', bear[0], bear[1]);
  }
  if (stage === 'EARLY' && ctx.dom && ctx.freshness.state === 'LIVE') {
    const imbalance = depthImbalance(ctx.dom);
    if (imbalance !== null && imbalance >= 25) add('BUY', 3, `5-level depth ${Math.round(imbalance)}% bid-heavy (can be pulled)`);
    else if (imbalance !== null && imbalance <= -25) add('SELL', 3, `5-level depth ${Math.round(-imbalance)}% offer-heavy (can be pulled)`);
  }

  // Open interest
  const build = at ? oiBuildup(close - ctx.bars[at - 1].c, ctx.oiChange[at]) : null;
  if (build === 'Long build-up') add('BUY', 8, 'Long build-up (price ↑, OI ↑)');
  else if (build === 'Short covering') add('BUY', 4, 'Short covering (price ↑, OI ↓)');
  else if (build === 'Short build-up') add('SELL', 8, 'Short build-up (price ↓, OI ↑)');
  else if (build === 'Long unwinding') add('SELL', 4, 'Long unwinding (price ↓, OI ↓)');
  if (ctx.oiChange[at] === null) cautions.push('OI change unavailable for this bar.');

  // Higher-timeframe alignment
  for (const item of ctx.higherTimeframes) {
    if (item.bias === 'BULL') add('BUY', 6, `${item.label} trend bullish`);
    else if (item.bias === 'BEAR') add('SELL', 6, `${item.label} trend bearish`);
  }

  // Location vs levels
  const resistances = [...ctx.levels.resistances.map(level => level.price)];
  const supports = [...ctx.levels.supports.map(level => level.price)];
  if (ctx.prevDay) {
    (ctx.prevDay.high > close ? resistances : supports).push(ctx.prevDay.high);
    (ctx.prevDay.low > close ? resistances : supports).push(ctx.prevDay.low);
  }
  resistances.sort((x, y) => x - y);
  supports.sort((x, y) => y - x);
  const nearResistance = resistances.find(price => price - close <= 0.3 * a);
  const nearSupport = supports.find(price => close - price <= 0.3 * a);
  if (nearResistance !== undefined) add('SELL', 6, `Price at resistance ${nearResistance.toFixed(2)}`);
  if (nearSupport !== undefined) add('BUY', 6, `Price at support ${nearSupport.toFixed(2)}`);

  const bullScore = factors.filter(f => f.side === 'BUY').reduce((sum, f) => sum + f.points, 0);
  const bearScore = factors.filter(f => f.side === 'SELL').reduce((sum, f) => sum + f.points, 0);
  const top = Math.max(bullScore, bearScore), other = Math.min(bullScore, bearScore);
  const side: Side | null = bullScore === bearScore ? null : bullScore > bearScore ? 'BUY' : 'SELL';
  const confidence = Math.round(Math.max(0, Math.min(95, top - other * 0.5)));
  const bias: Bias = side === null || top - other < 10 ? 'NEUTRAL' : side === 'BUY' ? 'BULL' : 'BEAR';
  const reasons = factors.filter(f => f.side === side).sort((x, y) => y.points - x.points).map(f => f.text);
  const against = factors.filter(f => f.side !== side).sort((x, y) => y.points - x.points).map(f => f.text);
  const result: TerminalSignal = { ...empty, bias, confidence, bullScore, bearScore, reasons, against, cautions };
  if (!side) return result;

  // Trade plan (analytical suggestion)
  const tick = ctx.tickSize;
  const dir = side === 'BUY' ? 1 : -1;
  const pullbacks = [vwap, e9, e21].filter((value): value is number => value != null && (value - close) * dir < 0 && Math.abs(value - close) <= a);
  const far = close - dir * 0.6 * a;
  const pullback = pullbacks.length ? (side === 'BUY' ? Math.max(...pullbacks) : Math.min(...pullbacks)) : close - dir * 0.3 * a;
  const zoneEdge = side === 'BUY' ? Math.max(pullback, far) : Math.min(pullback, far);
  const recent = ctx.bars.slice(Math.max(0, at - 2), at + 1);
  const extreme = side === 'BUY' ? Math.min(...recent.map(item => item.l), zoneEdge) : Math.max(...recent.map(item => item.h), zoneEdge);
  const stop = roundToTick(extreme - dir * 0.2 * a, tick);
  const entry: [number, number] = side === 'BUY'
    ? [roundToTick(zoneEdge, tick), roundToTick(close, tick)] : [roundToTick(close, tick), roundToTick(zoneEdge, tick)];
  const mid = (entry[0] + entry[1]) / 2;
  const risk = Math.abs(mid - stop);
  const objectives = (side === 'BUY' ? resistances.filter(price => price > mid + 0.8 * risk)
    : supports.filter(price => price < mid - 0.8 * risk));
  const t1 = objectives[0] ?? mid + dir * 1.5 * risk;
  const extension = mid + dir * 2.5 * risk;
  const t2 = objectives.find(price => (price - t1) * dir > 0.25 * risk) ??
    (side === 'BUY' ? Math.max(t1 + 0.5 * risk, extension) : Math.min(t1 - 0.5 * risk, extension));
  const targets = [roundToTick(t1, tick), roundToTick(t2, tick)];
  const riskReward = risk > 0 ? Math.abs(targets[0] - mid) / risk : null;
  Object.assign(result, { entry, stop, targets, riskReward });

  const block = (text: string) => ({ ...result, action: 'WAIT' as const, cautions: [text, ...cautions] });
  if (ctx.freshness.state === 'STALE') return block('Data is stale — signals suspended.');
  if (ctx.freshness.state === 'CLOSED') return block('Market closed — plan shown for study only.');
  if (at + 1 < MIN_SIGNAL_BARS) return block(`Need at least ${MIN_SIGNAL_BARS} candles of context.`);
  if (risk > 2.5 * a) return block('Stop distance exceeds 2.5× ATR — risk too wide.');
  if (riskReward !== null && riskReward < 1) return block('Reward to first target is below 1R.');
  if (confidence >= ACTION_CONFIDENCE && top - other >= ACTION_MARGIN) return { ...result, action: side };
  return result;
}
