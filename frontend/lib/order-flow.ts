/**
 * Order-flow data model shared by the futures and advanced charts.
 * Trade side is estimated by the backend (Lee-Ready quote/tick rule on KiteTicker full-mode snapshots);
 * nothing here creates volume, it only parses, merges and re-buckets what was recorded.
 */

export type OrderFlowSide = 'BUY' | 'SELL';
export type OrderFlowLevel = [price: number, buy: number, sell: number];

export interface OrderFlowBar {
  t: number; end: number; o: number; h: number; l: number; c: number;
  v: number; b: number; s: number; n: number; d: number; cvd: number;
  poc: number | null; lv: OrderFlowLevel[];
  imb: { buy: [number, number][]; sell: [number, number][] };
  book: number | null; depth: number | null; spread: number | null; basis: number | null;
  complete: boolean; closed: boolean; coverage: number; flags: string[];
}

export interface OrderFlowEvent { t: number; kind: string; side: OrderFlowSide; price: number }
export interface OrderFlowZone { side: 'bid' | 'ask'; price: number; qty: number; maxQty: number; status: 'active' | 'broken' }
export interface OrderFlowExit { time: number; price: number; lots: number; reason: string; points: number; fees: number | null }

export interface OrderFlowSignal {
  id: string; time: number; side: OrderFlowSide; entry: number; stop: number; t1: number; t2: number;
  confidence: number; reasons: string[]; status: 'pending' | 'open' | 'closed' | 'skipped' | 'expired';
  fill?: number; fillTime?: number; exits: OrderFlowExit[]; points?: number;
  pnl?: { gross: number; fees: number; net: number };
}

export interface OrderFlowGuidance {
  action: 'BUY' | 'SELL' | 'WAIT'; reasons: string[];
  id?: string; time?: number; side?: OrderFlowSide; entry?: number; stop?: number; stopNow?: number;
  t1?: number; t2?: number; confidence?: number; status?: string; fill?: number | null;
}

export interface OrderFlowReplay {
  trades: number; wins: number; winRate: number | null; unit: string; net: number;
  profitFactor: number | null; expectancy: number | null; maxDrawdown: number; lots: number; lotSize: number | null;
}

export interface OrderFlowSnapshot {
  available: boolean; symbol: string; interval: number; date: string; reason: string | null;
  row: number; token: number | null; recordedToken: number | null; method: string; lastTick: number | null; generatedAt: number;
  recordedFrom: number | null;
  bars: OrderFlowBar[]; events: OrderFlowEvent[]; zones: OrderFlowZone[]; signals: OrderFlowSignal[];
  profile: { poc: number; vah: number; val: number; volume: number } | null;
  guidance: OrderFlowGuidance; replay: OrderFlowReplay | null;
  summary: { delta: number; cvd: number; buy: number; sell: number; book: number | null; coverage: number; basis: number | null };
}

export const ORDER_FLOW_INTERVALS = [1, 3, 5, 15, 30, 60] as const;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const num = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;

function parseBar(value: unknown): OrderFlowBar | null {
  if (!isObject(value)) return null;
  const fields = ['t', 'end', 'o', 'h', 'l', 'c', 'v', 'b', 's', 'n', 'd', 'cvd'] as const;
  if (fields.some(field => num(value[field]) === null) || !Array.isArray(value.lv)) return null;
  const lv = value.lv.filter((row): row is OrderFlowLevel =>
    Array.isArray(row) && row.length === 3 && row.every(item => num(item) !== null));
  const imb = isObject(value.imb) ? value.imb : {};
  const ranges = (list: unknown) => Array.isArray(list)
    ? list.filter((pair): pair is [number, number] => Array.isArray(pair) && pair.length === 2 && pair.every(item => num(item) !== null))
    : [];
  return {
    ...(value as unknown as OrderFlowBar), lv,
    imb: { buy: ranges(imb.buy), sell: ranges(imb.sell) },
    poc: num(value.poc), book: num(value.book), depth: num(value.depth), spread: num(value.spread), basis: num(value.basis),
    complete: value.complete === true, closed: value.closed === true, coverage: num(value.coverage) ?? 0,
    flags: Array.isArray(value.flags) ? value.flags.filter((flag): flag is string => typeof flag === 'string') : [],
  };
}

/** Validates the server payload; malformed bars are dropped rather than guessed. */
export function parseOrderFlow(value: unknown): OrderFlowSnapshot | null {
  if (!isObject(value) || typeof value.available !== 'boolean' || typeof value.symbol !== 'string') return null;
  const bars = Array.isArray(value.bars) ? value.bars.map(parseBar).filter((bar): bar is OrderFlowBar => bar !== null) : [];
  const guidance = isObject(value.guidance) && typeof value.guidance.action === 'string'
    ? value.guidance as unknown as OrderFlowGuidance : { action: 'WAIT' as const, reasons: [] };
  const summary = isObject(value.summary) ? value.summary : {};
  return {
    available: value.available, symbol: value.symbol, interval: num(value.interval) ?? 5,
    date: typeof value.date === 'string' ? value.date : '', reason: typeof value.reason === 'string' ? value.reason : null,
    row: num(value.row) ?? 1, token: num(value.token), recordedToken: num(value.recordedToken), method: typeof value.method === 'string' ? value.method : '',
    lastTick: num(value.lastTick), generatedAt: num(value.generatedAt) ?? 0, recordedFrom: num(value.recordedFrom),
    bars: bars.sort((a, b) => a.t - b.t),
    events: Array.isArray(value.events) ? value.events as OrderFlowEvent[] : [],
    zones: Array.isArray(value.zones) ? value.zones as OrderFlowZone[] : [],
    signals: Array.isArray(value.signals) ? value.signals as OrderFlowSignal[] : [],
    profile: isObject(value.profile) ? value.profile as OrderFlowSnapshot['profile'] : null,
    guidance: { ...guidance, reasons: Array.isArray(guidance.reasons) ? guidance.reasons : [] },
    replay: isObject(value.replay) ? value.replay as unknown as OrderFlowReplay : null,
    summary: {
      delta: num(summary.delta) ?? 0, cvd: num(summary.cvd) ?? 0, buy: num(summary.buy) ?? 0, sell: num(summary.sell) ?? 0,
      book: num(summary.book), coverage: num(summary.coverage) ?? 0, basis: num(summary.basis),
    },
  };
}

/** Applies a streamed update: the last few bars are replaced by time, everything else is taken from the update. */
export function mergeOrderFlowUpdate(previous: OrderFlowSnapshot | null, update: OrderFlowSnapshot): OrderFlowSnapshot {
  if (!previous || previous.symbol !== update.symbol || previous.interval !== update.interval || previous.date !== update.date) {
    return update;
  }
  if (!update.bars.length) return { ...update, bars: previous.bars };
  const first = update.bars[0].t;
  let cut = previous.bars.length;
  while (cut > 0 && previous.bars[cut - 1].t >= first) cut--;
  return { ...update, bars: [...previous.bars.slice(0, cut), ...update.bars] };
}

/**
 * Re-buckets footprint rows so each drawn row is at least `minRow` price units tall.
 * Totals are preserved exactly; rows are aligned to multiples of the bucket size.
 */
export function bucketSize(row: number, minRow: number): number {
  return row * Math.max(1, Math.ceil(minRow / Math.max(row, 1e-9) - 1e-9));
}

export function coarsenLevels(levels: OrderFlowLevel[], row: number, minRow: number): OrderFlowLevel[] {
  const size = bucketSize(row, minRow);
  if (size === row) return levels;
  const buckets = new Map<number, OrderFlowLevel>();
  for (const [price, buy, sell] of levels) {
    const key = Math.round(Math.floor(price / size + 1e-9) * size * 100) / 100;
    const cell = buckets.get(key);
    if (cell) { cell[1] += buy; cell[2] += sell; } else buckets.set(key, [key, buy, sell]);
  }
  return Array.from(buckets.values()).sort((a, b) => a[0] - b[0]);
}

/** Session volume-at-price from bar footprints (same data the server profile is built from). */
export function sessionLevels(bars: OrderFlowBar[]): OrderFlowLevel[] {
  const cells = new Map<number, OrderFlowLevel>();
  for (const bar of bars) {
    for (const [price, buy, sell] of bar.lv) {
      const cell = cells.get(price);
      if (cell) { cell[1] += buy; cell[2] += sell; } else cells.set(price, [price, buy, sell]);
    }
  }
  return Array.from(cells.values()).sort((a, b) => a[0] - b[0]);
}

/** Futures-to-index offset for a bar: its own recorded basis, else the latest known basis. */
export function basisAt(bars: OrderFlowBar[], time: number, fallback: number | null): number | null {
  let low = 0, high = bars.length - 1, found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (bars[mid].t <= time) { found = mid; low = mid + 1; } else high = mid - 1;
  }
  for (let i = found; i >= 0 && i > found - 6; i--) if (bars[i].basis !== null) return bars[i].basis;
  return fallback;
}

export interface OrderFlowCallout {
  t: number; side: OrderFlowSide; price: number; low: number; high: number; score: number; reason: string; delta: number;
}

export interface FlowCandle { time: number; o: number; h: number; l: number; c: number; v: number }

/** Recorded tick order flow for a bar (futures), used as extra confirmation / veto. */
export interface RecordedFlow { flags: string[]; d: number; v: number }

export interface FlowOptions {
  /** Candles with `time >= closedBefore` are still forming and never labelled. */
  closedBefore?: number;
  /** Minimum points a trade must make before its stop for the flow to count as valid. */
  minPoints?: number;
  /** Round-number spacing treated as a major level (e.g. 100 for NIFTY). */
  roundStep?: number;
  /** Bars allowed for the follow-through. */
  horizon?: number;
  recorded?: Map<number, RecordedFlow>;
}

export type FlowStatus = 'confirmed' | 'pending' | 'failed';

export interface ValidatedFlow extends OrderFlowCallout {
  status: FlowStatus;
  entry: number;
  stop: number;
  target: number;
  /** Best points reached before the stop (confirmed), or 0. */
  points: number;
  levels: string[];
  volumeRatio: number | null;
}

/** Points a trade needs, per index, before an order-flow print is treated as genuine. */
export const FLOW_MIN_POINTS: Record<string, number> = { NIFTY: 20, BANKNIFTY: 50, SENSEX: 60 };
export const FLOW_ROUND_STEP: Record<string, number> = { NIFTY: 100, BANKNIFTY: 500, SENSEX: 500 };

const IST = 19800;
const BULL_FLAGS = new Set(['absorption_sellers', 'failed_breakdown', 'exhaustion_sellers', 'stacked_buy_imbalance', 'aggressive_buy', 'cvd_divergence_bull']);
const BEAR_FLAGS = new Set(['absorption_buyers', 'failed_breakout', 'exhaustion_buyers', 'stacked_sell_imbalance', 'aggressive_sell', 'cvd_divergence_bear']);
const MAJOR = new Set(['PDH', 'PDL', 'PDC', 'Day high', 'Day low', 'OR high', 'OR low']);
const FLOW_THRESHOLD = 85;
/** Big-player prints only: the strongest few per session. */
const MAX_PER_SESSION = 2;

interface Context {
  atr: number; avgRange: number; avgVolume: number; ema20: number; ema50: number;
  vwap: number | null; pdh: number | null; pdl: number | null; pdc: number | null;
  dayHigh: number | null; dayLow: number | null; orHigh: number | null; orLow: number | null;
}

/**
 * High-conviction buy / sell order flow from candles (+ recorded tick flow when present). A candle qualifies
 * only with ALL of: a setup (stop-run reversal, absorption wick or displacement breakout), institutional-size
 * participation (volume >= 2.5x the 20-bar average, or range >= 2x when the index has no volume), and a
 * major area (previous-day H/L/C, day H/L, opening range or round number; VWAP / EMA 20/50 add confluence). Context adds or
 * removes points (trend, crash / spike exhaustion, recorded footprint flags and delta). Score >= 85 is a
 * candidate, at most 2 per session; it is then validated: entry at the close, stop beyond the candle extreme, and it is genuine
 * only if price makes `minPoints` (or 0.8 ATR, whichever is larger) before the stop within `horizon` bars.
 */
export function candleFlowCallouts(candles: FlowCandle[], options: FlowOptions = {}): ValidatedFlow[] {
  const { closedBefore = Infinity, minPoints = 0, roundStep = 0, horizon = 10, recorded } = options;
  const out: ValidatedFlow[] = [];
  if (candles.length < 25) return out;
  let atr = 0, ema20 = candles[0].c, ema50 = candles[0].c;
  const ranges: number[] = [], volumes: number[] = [];
  let rangeSum = 0, volumeSum = 0;
  let day = -1, dayStart = 0, pdh: number | null = null, pdl: number | null = null, pdc: number | null = null;
  let dayHigh = -Infinity, dayLow = Infinity, orHigh = -Infinity, orLow = Infinity, pv = 0, vol = 0;
  const lastIndex: Record<OrderFlowSide, number> = { BUY: -99, SELL: -99 };

  for (let index = 0; index < candles.length; index++) {
    const bar = candles[index];
    const barDay = Math.floor((bar.time + IST) / 86400);
    if (barDay !== day) {
      if (day !== -1 && dayHigh > -Infinity) { pdh = dayHigh; pdl = dayLow; pdc = candles[index - 1].c; }
      day = barDay; dayStart = bar.time;
      dayHigh = -Infinity; dayLow = Infinity; orHigh = -Infinity; orLow = Infinity; pv = 0; vol = 0;
    }
    const range = bar.h - bar.l;
    const ready = index >= 20 && atr > 0 && range > 0 && bar.time < closedBefore;
    if (ready) {
      const context: Context = {
        atr, avgRange: rangeSum / ranges.length, avgVolume: volumeSum / volumes.length,
        ema20, ema50, vwap: vol > 0 ? pv / vol : null, pdh, pdl, pdc,
        dayHigh: dayHigh > -Infinity ? dayHigh : null, dayLow: dayLow < Infinity ? dayLow : null,
        orHigh: orHigh > -Infinity ? orHigh : null, orLow: orLow < Infinity ? orLow : null,
      };
      for (const side of ['BUY', 'SELL'] as const) {
        const candidate = scoreFlow(candles, index, side, context, roundStep, recorded?.get(bar.time));
        if (!candidate) continue;
        // One print per move: a weaker same-side print within 4 bars is dropped, a stronger one replaces it.
        const previous = out[out.length - 1];
        if (previous && previous.side === side && index - lastIndex[side] <= 4) {
          if (candidate.score <= previous.score) continue;
          out.pop();
        }
        // Conflicting prints 2 bars apart are noise: keep only the stronger side.
        const other = out[out.length - 1];
        if (other && other.side !== side && index - lastIndex[other.side] <= 2) {
          if (candidate.score <= other.score) continue;
          out.pop();
        }
        out.push(validate(candles, index, candidate, Math.max(minPoints, 0.8 * atr), horizon, closedBefore));
        lastIndex[side] = index;
      }
    }

    // Update rolling state after scoring so a bar is judged only against what came before it.
    const previousClose = index > 0 ? candles[index - 1].c : bar.o;
    const trueRange = Math.max(range, Math.abs(bar.h - previousClose), Math.abs(bar.l - previousClose));
    atr = index === 0 ? trueRange : atr + (trueRange - atr) / 14;
    ema20 += (bar.c - ema20) * (2 / 21);
    ema50 += (bar.c - ema50) * (2 / 51);
    ranges.push(range); rangeSum += range;
    volumes.push(bar.v > 0 ? bar.v : 0); volumeSum += bar.v > 0 ? bar.v : 0;
    if (ranges.length > 20) { rangeSum -= ranges.shift()!; volumeSum -= volumes.shift()!; }
    dayHigh = Math.max(dayHigh, bar.h); dayLow = Math.min(dayLow, bar.l);
    if (bar.time < dayStart + 900) { orHigh = Math.max(orHigh, bar.h); orLow = Math.min(orLow, bar.l); }
    if (bar.v > 0) { pv += bar.v * (bar.h + bar.l + bar.c) / 3; vol += bar.v; }
  }
  // Keep only the strongest prints of each session (ties go to the earlier print).
  const keep = new Set<ValidatedFlow>();
  const byDay = new Map<number, ValidatedFlow[]>();
  for (const flow of out) {
    const key = Math.floor((flow.t + IST) / 86400);
    byDay.set(key, [...(byDay.get(key) ?? []), flow]);
  }
  byDay.forEach(list => list.slice().sort((a, b) => b.score - a.score || a.t - b.t).slice(0, MAX_PER_SESSION).forEach(flow => keep.add(flow)));
  return out.filter(flow => keep.has(flow));
}

function scoreFlow(candles: FlowCandle[], index: number, side: OrderFlowSide, ctx: Context, roundStep: number, flow?: RecordedFlow): FlowCandidate | null {
  const bar = candles[index];
  const buy = side === 'BUY';
  const range = bar.h - bar.l;
  const body = Math.abs(bar.c - bar.o);
  const clv = (2 * bar.c - bar.h - bar.l) / range;          // +1 close at high, -1 close at low
  const wick = buy ? Math.min(bar.o, bar.c) - bar.l : bar.h - Math.max(bar.o, bar.c);
  const extreme = buy ? bar.l : bar.h;
  const tolerance = 0.3 * ctx.atr;

  // 1) Setup.
  let priorExtreme = buy ? Infinity : -Infinity;
  for (let k = Math.max(0, index - 10); k < index; k++) {
    priorExtreme = buy ? Math.min(priorExtreme, candles[k].l) : Math.max(priorExtreme, candles[k].h);
  }
  const swept = buy ? bar.l < priorExtreme && bar.c > priorExtreme : bar.h > priorExtreme && bar.c < priorExtreme;
  const rejection = wick >= 0.4 * range && (buy ? clv >= 0.2 : clv <= -0.2);
  const displacement = body >= 0.65 * range && range >= 1.6 * ctx.avgRange && (buy ? clv >= 0.6 && bar.c > bar.o : clv <= -0.6 && bar.c < bar.o);
  let setup = '', score = 0;
  if (swept && rejection) { setup = 'Stop-run reversal'; score += 40; }
  else if (rejection && wick >= 0.55 * range) { setup = 'Absorption'; score += 35; }
  else if (displacement) { setup = buy ? 'Breakout drive' : 'Breakdown drive'; score += 40; }
  if (!setup) return null;

  // 2) Institutional-size participation (mandatory).
  const hasVolume = bar.v > 0 && ctx.avgVolume > 0;
  const volumeRatio = hasVolume ? bar.v / ctx.avgVolume : null;
  if (volumeRatio !== null) {
    if (volumeRatio < 2.5) return null;
    score += Math.min(30, Math.round((volumeRatio - 1) * 12));
  } else {
    if (range < 2 * ctx.avgRange) return null;
    score += 15;
  }

  // 3) Major area (mandatory): reversals must trade at a level, drives must close through one.
  const named: [string, number | null][] = [
    ['PDH', ctx.pdh], ['PDL', ctx.pdl], ['PDC', ctx.pdc], ['Day high', ctx.dayHigh], ['Day low', ctx.dayLow],
    ['OR high', ctx.orHigh], ['OR low', ctx.orLow], ['VWAP', ctx.vwap], ['EMA 20', ctx.ema20], ['EMA 50', ctx.ema50],
  ];
  if (roundStep > 0) {
    const round = Math.round(extreme / roundStep) * roundStep;
    named.push([`${round}`, round]);
    if (setup.endsWith('drive')) named.push([`${Math.round(bar.c / roundStep) * roundStep}`, Math.round(bar.c / roundStep) * roundStep]);
  }
  const levels: string[] = [];
  for (const [name, level] of named) {
    if (level === null || !isFinite(level)) continue;
    const hit = setup.endsWith('drive')
      ? (buy ? bar.o < level && bar.c > level + 0.1 * ctx.atr : bar.o > level && bar.c < level - 0.1 * ctx.atr)
      : Math.abs(extreme - level) <= tolerance || (buy ? bar.l < level && bar.c > level : bar.h > level && bar.c < level);
    if (hit && levels.indexOf(name) < 0) levels.push(name);
  }
  // Big players act at major areas: VWAP / EMA alone is not enough.
  if (!levels.some(name => MAJOR.has(name) || /^\d+$/.test(name))) return null;
  score += Math.min(30, levels.reduce((sum, name) => sum + (MAJOR.has(name) || /^\d+$/.test(name) ? 15 : 8), 0));

  // 4) Context: crash / spike exhaustion, trend alignment, recorded tick flow.
  const back = candles[Math.max(0, index - 6)];
  const move = bar.c - back.o;
  const reversal = setup !== 'Breakout drive' && setup !== 'Breakdown drive';
  let crash = false;
  if (reversal && (buy ? move < 0 && back.o - bar.l >= 2.5 * ctx.atr : move > 0 && bar.h - back.o >= 2.5 * ctx.atr)) {
    score += 15; crash = true;
  }
  const trendUp = ctx.ema20 > ctx.ema50 && bar.c > ctx.ema20;
  const trendDown = ctx.ema20 < ctx.ema50 && bar.c < ctx.ema20;
  if (buy ? trendUp : trendDown) score += 10;
  else if ((buy ? trendDown : trendUp) && !crash && !levels.some(name => MAJOR.has(name))) score -= 20;
  if (flow) {
    const agree = flow.flags.filter(flag => (buy ? BULL_FLAGS : BEAR_FLAGS).has(flag)).length;
    score += Math.min(20, agree * 10);
    // Recorded aggressor delta strongly against the print vetoes it.
    if (flow.v > 0 && (buy ? flow.d : -flow.d) < -0.25 * flow.v) return null;
  }
  if (score < FLOW_THRESHOLD) return null;
  const reason = [crash ? (buy ? 'Selling climax' : 'Buying climax') : setup, levels.slice(0, 2).join(' + ')]
    .concat(volumeRatio !== null ? [`${volumeRatio.toFixed(1)}x vol`] : []).join(' · ');
  return { side, setup, score: Math.min(100, score), levels, volumeRatio, reason, crash };
}

interface FlowCandidate { side: OrderFlowSide; setup: string; score: number; levels: string[]; volumeRatio: number | null; reason: string; crash: boolean }

function validate(candles: FlowCandle[], index: number, candidate: FlowCandidate,
  minMove: number, horizon: number, closedBefore: number): ValidatedFlow {
  const bar = candles[index];
  const buy = candidate.side === 'BUY';
  const atrPad = Math.max(minMove * 0.1, (bar.h - bar.l) * 0.05);
  const entry = bar.c;
  const stop = buy ? bar.l - atrPad : bar.h + atrPad;
  const target = buy ? entry + minMove : entry - minMove;
  let status: FlowStatus = 'pending', best = 0, k = index + 1;
  for (; k < candles.length && k <= index + horizon && candles[k].time < closedBefore; k++) {
    const next = candles[k];
    // Same-candle stop and target is counted as a loss (worst case).
    if (buy ? next.l <= stop : next.h >= stop) { status = status === 'confirmed' ? 'confirmed' : 'failed'; break; }
    best = Math.max(best, buy ? next.h - entry : entry - next.l);
    if (best >= minMove) status = 'confirmed';
  }
  if (status === 'pending' && k > index + horizon) status = 'failed';   // no follow-through in time
  return {
    t: bar.time, side: candidate.side, price: buy ? bar.l : bar.h, low: bar.l, high: bar.h, score: candidate.score,
    reason: candidate.reason, delta: 0, status, entry, stop, target,
    points: status === 'confirmed' ? Math.round(best * 10) / 10 : 0, levels: candidate.levels, volumeRatio: candidate.volumeRatio,
  };
}

/** Recorded tick order flow keyed by bar time, used to confirm / veto candle prints. */
export function recordedFlowMap(snapshot: OrderFlowSnapshot | null): Map<number, RecordedFlow> | undefined {
  if (!snapshot?.available || !snapshot.bars.length) return undefined;
  return new Map(snapshot.bars.filter(bar => bar.closed && bar.complete).map(bar => [bar.t, { flags: bar.flags, d: bar.d, v: bar.v }]));
}

export function compactVolume(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e7) return `${(value / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `${(value / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}k`;
  return String(Math.round(value));
}

export const isOrderFlowInterval = (value: unknown): value is (typeof ORDER_FLOW_INTERVALS)[number] =>
  typeof value === 'number' && (ORDER_FLOW_INTERVALS as readonly number[]).includes(value);
