/**
 * Strict "pro trader" confirmation gate shared by every chart (Advanced, Futures, Futures Advanced) and the delta box.
 *
 * One source of truth: closed 5-minute candles of the near-month index future plus its recorded order flow.
 * A BUY / SELL appears only when EVERY check in the checklist agrees; anything less is WAIT.
 * The replay walks today's closed candles with the same rules (no look-ahead) so every signal on the chart carries
 * its real outcome (stop, breakeven, target or session close). Rules reduce false and opposite signals; they cannot
 * guarantee a win — always trade with the stop-loss shown.
 */
import {
  EMA_PERIODS, atr, crossovers, ema, evaluateSignal, istDay, liquiditySweeps, oiBuildup, oiChanges, previousDay,
  pricePatterns, resample, roundToTick, sessionVwap, supportResistance, trendBias,
  type Bias, type EmaPeriod, type Freshness, type FreshnessState, type Level, type Mark, type PrevDay, type Side,
  type TerminalBar, type TerminalSignal,
} from './futures-terminal';
import type { OrderFlowBar, OrderFlowEvent } from './order-flow';
import type { ChartSignalLabel } from './chart-signal-labels';

export const PRO_INTERVAL = 5;
export const PRO_HIGHER = [15, 60] as const;
export const PRO_MIN_BARS = 50;
export const PRO_CONFIDENCE = 70;
export const PRO_MARGIN = 35;
export const PRO_MIN_COVERAGE = 0.6;
export const PRO_FLOW_RATIO = 0.15;
export const PRO_MAX_STRETCH_ATR = 1.5;
export const PRO_MIN_RISK_ATR = 0.3;
export const PRO_MAX_RISK_ATR = 2;
export const PRO_T1_R = 1.5;
export const PRO_T2_R = 3;
export const PRO_SL_COOLDOWN_BARS = 3;
/** Signal-bar close window in IST minutes: skip the opening auction noise and the last half hour. */
export const PRO_WINDOW: [number, number] = [9 * 60 + 30, 15 * 60];
const SESSION_EXIT = 15 * 60 + 15;

export interface ProCheck { id: string; label: string; pass: boolean; detail: string }
export interface ProPlan { side: Side; entry: number; stop: number; t1: number; t2: number; risk: number }
export interface ProVerdict {
  time: number; side: Side | null; action: Side | 'WAIT'; checks: ProCheck[]; passed: number; total: number;
  plan: ProPlan | null; confidence: number; bullScore: number; bearScore: number;
}
export type ProExitReason = 'SL' | 'BE' | 'T2' | 'EOD';
export interface ProTrade {
  id: string; side: Side; signalTime: number; entryTime: number | null; entry: number;
  stop: number; t1: number; t2: number; t1Hit: boolean; status: 'open' | 'closed';
  exitTime?: number; exitPrice?: number; exitReason?: ProExitReason; points?: number;
}
export interface ProStats { signals: number; closed: number; wins: number; losses: number; points: number }
export interface ProReplay { verdict: ProVerdict | null; trades: ProTrade[]; stats: ProStats }

export interface ProContext {
  bars: readonly TerminalBar[];
  emas: Record<EmaPeriod, readonly (number | null)[]>;
  vwap: readonly (number | null)[];
  atr: readonly (number | null)[];
  oiChange: readonly (number | null)[];
  flow: ReadonlyMap<number, OrderFlowBar>;
  flowList: readonly OrderFlowBar[];
  events: readonly OrderFlowEvent[];
  tickSize: number;
}

export function buildProContext(bars: readonly TerminalBar[], flow: readonly OrderFlowBar[], events: readonly OrderFlowEvent[], tickSize: number): ProContext {
  const closes = bars.map(bar => bar.c);
  const emas = Object.fromEntries(EMA_PERIODS.map(period => [period, ema(closes, period)])) as Record<EmaPeriod, (number | null)[]>;
  const flowList = [...flow].sort((a, b) => a.t - b.t);
  return {
    bars, emas, vwap: sessionVwap(bars), atr: atr(bars), oiChange: oiChanges(bars),
    flow: new Map(flowList.map(bar => [bar.t, bar] as const)), flowList, events, tickSize,
  };
}

const istMinutes = (time: number) => Math.floor(((time + 19_800) % 86_400) / 60);
const fmt = (value: number) => value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
export const clock = (time: number) => new Date(time * 1000).toLocaleTimeString('en-IN', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
});
const LIVE_FRESHNESS: Freshness = { state: 'LIVE', tickAge: 0, historyAge: 0, label: '' };

interface EngineAt { signal: TerminalSignal; levels: { supports: Level[]; resistances: Level[] }; prevDay: PrevDay | null; higher: { label: string; bias: Bias }[] }

/** The full scoring engine on bars[0..at] only, so history signals never see the future. */
function engineAt(ctx: ProContext, at: number): EngineAt {
  const { bars } = ctx;
  const closed = at + 1;
  const visible = bars.slice(0, closed);
  const prevDay = previousDay(visible);
  const levels = supportResistance(bars, closed, bars[at].c, ctx.atr[at]);
  const marks: Mark[] = [
    ...crossovers(ctx.emas[9], ctx.emas[21], closed, 'EMA 9/21', bars),
    ...crossovers(ctx.emas[50], ctx.emas[200], closed, 'EMA 50/200', bars),
    ...pricePatterns(bars, closed, ctx.atr),
    ...liquiditySweeps(bars, closed, prevDay),
  ].sort((a, b) => a.index - b.index);
  const higher = PRO_HIGHER.map(minutes => ({ label: `${minutes}m`, bias: trendBias(resample(visible, minutes)).bias }));
  const signal = evaluateSignal({
    bars, emas: ctx.emas, vwap: ctx.vwap, atr: ctx.atr, oiChange: ctx.oiChange, levels, prevDay, marks,
    flow: ctx.flow, events: ctx.events, dom: null, higherTimeframes: higher, tickSize: ctx.tickSize,
    intervalSeconds: PRO_INTERVAL * 60, freshness: LIVE_FRESHNESS,
  }, at, 'CONFIRMED');
  return { signal, levels, prevDay, higher };
}

/** Every check for one closed bar. `previous` is the engine result of the bar before (anti-flip). */
export function proVerdictAt(ctx: ProContext, at: number, engine: EngineAt = engineAt(ctx, at), previous: TerminalSignal | null = null): ProVerdict {
  const bar = ctx.bars[at];
  const { signal, levels, prevDay, higher } = engine;
  const side: Side | null = signal.bullScore === signal.bearScore ? null : signal.bullScore > signal.bearScore ? 'BUY' : 'SELL';
  const base = { time: bar.time, side, confidence: signal.confidence, bullScore: signal.bullScore, bearScore: signal.bearScore };
  if (!side) {
    return { ...base, action: 'WAIT', checks: [{ id: 'bias', label: 'Direction', pass: false, detail: 'Buyers and sellers are balanced — no side to trade.' }],
      passed: 0, total: 1, plan: null };
  }
  const dir = side === 'BUY' ? 1 : -1;
  const up = side === 'BUY';
  const checks: ProCheck[] = [];
  const add = (id: string, label: string, pass: boolean, detail: string) => checks.push({ id, label, pass, detail });
  const close = bar.c;
  const a = ctx.atr[at] ?? Math.max(bar.h - bar.l, close * 0.001);
  const e9 = ctx.emas[9][at], e21 = ctx.emas[21][at], e50 = ctx.emas[50][at], vwap = ctx.vwap[at];

  add('history', 'Enough history', at + 1 >= PRO_MIN_BARS, `${at + 1} closed 5m candles (needs ${PRO_MIN_BARS}).`);
  const minute = istMinutes(bar.time + PRO_INTERVAL * 60);
  add('window', 'Trading window', minute >= PRO_WINDOW[0] && minute <= PRO_WINDOW[1],
    'Signal candle must close between 09:30 and 15:00 IST (no opening noise, no late entries).');

  const stacked = e9 != null && e21 != null && e50 != null && (up ? e9 > e21 && e21 > e50 : e9 < e21 && e21 < e50);
  add('ema', up ? 'EMA 9 > 21 > 50' : 'EMA 9 < 21 < 50', stacked,
    e9 != null && e21 != null && e50 != null ? `EMA 9 ${fmt(e9)} · 21 ${fmt(e21)} · 50 ${fmt(e50)}` : 'EMAs not ready.');
  add('vwap', up ? 'Above VWAP' : 'Below VWAP', vwap != null && (close - vwap) * dir > 0,
    vwap != null ? `Close ${fmt(close)} vs VWAP ${fmt(vwap)}` : 'VWAP not ready.');

  const opposite = up ? 'BEAR' : 'BULL', same = up ? 'BULL' : 'BEAR';
  add('htf', '15m & 60m trend', !higher.some(item => item.bias === opposite) && higher.some(item => item.bias === same),
    higher.map(item => `${item.label} ${item.bias}`).join(' · ') + ' (none against, at least one with)');

  const range = bar.h - bar.l;
  const position = range > 0 ? (close - bar.l) / range : 0.5;
  add('candle', up ? 'Bullish close' : 'Bearish close', (close - bar.o) * dir > 0 && (up ? position >= 0.5 : position <= 0.5),
    `Candle ${close >= bar.o ? 'green' : 'red'}, closed at ${Math.round(position * 100)}% of its range.`);

  const flow = ctx.flow.get(bar.time);
  const ratio = flow && flow.v ? flow.d / flow.v : null;
  const flowOk = !!flow && flow.coverage >= PRO_MIN_COVERAGE && ratio !== null && ratio * dir >= PRO_FLOW_RATIO;
  add('delta', up ? 'Buyers in control (delta)' : 'Sellers in control (delta)', flowOk,
    !flow ? 'No recorded order flow for this candle.'
      : flow.coverage < PRO_MIN_COVERAGE ? `Recording coverage only ${Math.round(flow.coverage * 100)}%.`
      : `Delta ${ratio! >= 0 ? '+' : ''}${Math.round(ratio! * 100)}% of volume (needs ${up ? '+' : '−'}${PRO_FLOW_RATIO * 100}%).`);

  const flows = ctx.flowList.filter(item => item.t <= bar.time);
  const slope = flows.length >= 4 ? flows[flows.length - 1].cvd - flows[flows.length - 4].cvd : null;
  add('cvd', up ? 'CVD rising' : 'CVD falling', slope !== null && slope * dir > 0,
    slope === null ? 'Needs 4 recorded candles.' : `CVD ${slope >= 0 ? '+' : ''}${Math.round(slope).toLocaleString('en-IN')} over 3 candles.`);

  const build = at ? oiBuildup(close - ctx.bars[at - 1].c, ctx.oiChange[at]) : null;
  const against = up ? build === 'Short build-up' : build === 'Long build-up';
  add('oi', 'Open interest not against', !against, build ?? 'OI change not reported for this candle.');

  const stretch = e21 != null ? Math.abs(close - e21) / a : Infinity;
  add('stretch', 'Not chasing', stretch <= PRO_MAX_STRETCH_ATR,
    Number.isFinite(stretch) ? `${stretch.toFixed(2)} ATR from EMA 21 (max ${PRO_MAX_STRETCH_ATR}).` : 'EMA 21 not ready.');

  const rawStop = signal.stop;
  const stop = rawStop !== null && (close - rawStop) * dir > 0 ? rawStop : null;
  const risk = stop !== null ? Math.abs(close - stop) : null;
  add('risk', 'Stop-loss size', risk !== null && risk >= PRO_MIN_RISK_ATR * a && risk <= PRO_MAX_RISK_ATR * a,
    risk !== null ? `SL ${fmt(stop!)} = ${(risk / a).toFixed(2)} ATR (allowed ${PRO_MIN_RISK_ATR}–${PRO_MAX_RISK_ATR}).` : 'No structural stop.');

  const blockers = [...(up ? levels.resistances.map(level => level.price) : levels.supports.map(level => level.price))];
  if (prevDay) for (const value of [prevDay.high, prevDay.low]) if ((value - close) * dir > 0) blockers.push(value);
  const nearest = blockers.filter(value => (value - close) * dir > 0).sort((x, y) => (x - y) * dir)[0];
  const room = risk ? (nearest === undefined ? Infinity : Math.abs(nearest - close) / risk) : 0;
  add('room', 'Room to target', room >= PRO_T1_R,
    !risk ? 'Needs a valid stop.' : nearest === undefined ? 'No level in the way.'
      : `Next ${up ? 'resistance' : 'support'} ${fmt(nearest)} is ${room.toFixed(1)}R away (needs ${PRO_T1_R}R).`);

  const margin = Math.abs(signal.bullScore - signal.bearScore);
  add('score', 'Confluence score', signal.confidence >= PRO_CONFIDENCE && margin >= PRO_MARGIN,
    `Score ${signal.confidence} (needs ${PRO_CONFIDENCE}) · bull ${signal.bullScore} vs bear ${signal.bearScore} (gap needs ${PRO_MARGIN}).`);

  const flipped = previous !== null && previous.bias === (up ? 'BEAR' : 'BULL');
  add('flip', 'No sudden flip', !flipped, flipped ? 'Previous candle leaned the other way — wait for follow-through.' : 'Previous candle did not lean against.');

  const passed = checks.filter(check => check.pass).length;
  const plan = stop !== null && risk ? {
    side, entry: close, stop, risk,
    t1: roundToTick(close + dir * PRO_T1_R * risk, ctx.tickSize), t2: roundToTick(close + dir * PRO_T2_R * risk, ctx.tickSize),
  } : null;
  return { ...base, action: passed === checks.length && plan ? side : 'WAIT', checks, passed, total: checks.length, plan };
}

/** Walks one trade forward over closed bars: stop first, half booked at T1 with stop to breakeven, rest at T2 or 15:15. */
function simulate(trade: ProTrade, bars: readonly TerminalBar[], from: number, closed: number) {
  const dir = trade.side === 'BUY' ? 1 : -1;
  const exit = (j: number, price: number, reason: ProExitReason) => {
    const full = (price - trade.entry) * dir;
    Object.assign(trade, {
      status: 'closed', exitTime: bars[j].time, exitPrice: price, exitReason: reason,
      points: trade.t1Hit ? 0.5 * (trade.t1 - trade.entry) * dir + 0.5 * full : full,
    });
  };
  for (let j = from; j < closed; j++) {
    const bar = bars[j];
    const stop = trade.t1Hit ? trade.entry : trade.stop;
    const hitStop = trade.side === 'BUY' ? bar.l <= stop : bar.h >= stop;
    if (hitStop) {
      // A gap through the stop fills at the open, not at the stop.
      exit(j, trade.side === 'BUY' ? Math.min(bar.o, stop) : Math.max(bar.o, stop), trade.t1Hit ? 'BE' : 'SL');
      return j;
    }
    if (!trade.t1Hit && (trade.side === 'BUY' ? bar.h >= trade.t1 : bar.l <= trade.t1)) trade.t1Hit = true;
    if (trade.t1Hit && (trade.side === 'BUY' ? bar.h >= trade.t2 : bar.l <= trade.t2)) { exit(j, trade.t2, 'T2'); return j; }
    const next = bars[j + 1];
    if (istMinutes(bar.time) >= SESSION_EXIT || (next && istDay(next.time) !== istDay(bar.time))) { exit(j, bar.c, 'EOD'); return j; }
  }
  return closed;
}

/**
 * Replays today's session on closed bars with the gate. One trade at a time; after a stop-loss the same side is
 * blocked for a few candles. Returns the latest closed bar's verdict and every trade with its outcome.
 */
export function proReplay(ctx: ProContext, closed: number): ProReplay {
  const { bars } = ctx;
  const stats: ProStats = { signals: 0, closed: 0, wins: 0, losses: 0, points: 0 };
  if (!closed) return { verdict: null, trades: [], stats };
  const day = istDay(bars[closed - 1].time);
  let start = closed - 1;
  while (start > 0 && istDay(bars[start - 1].time) === day) start--;
  const trades: ProTrade[] = [];
  let previous: TerminalSignal | null = start > 0 ? engineAt(ctx, start - 1).signal : null;
  let verdict: ProVerdict | null = null;
  let busyUntil = -1;
  const cooldown: Record<Side, number> = { BUY: -1, SELL: -1 };
  for (let i = start; i < closed; i++) {
    const engine = engineAt(ctx, i);
    verdict = proVerdictAt(ctx, i, engine, previous);
    previous = engine.signal;
    if (verdict.action === 'WAIT' || !verdict.plan || i <= busyUntil || i <= cooldown[verdict.action]) continue;
    const plan = verdict.plan;
    const next = bars[i + 1];
    const trade: ProTrade = {
      id: `pro:${bars[i].time}:${plan.side}`, side: plan.side, signalTime: bars[i].time,
      entryTime: next && istDay(next.time) === day ? next.time : null, entry: next && istDay(next.time) === day ? next.o : plan.entry,
      stop: plan.stop, t1: plan.t1, t2: plan.t2, t1Hit: false, status: 'open',
    };
    const dir = plan.side === 'BUY' ? 1 : -1;
    // A gap through the stop or past T1 on the entry candle's open means the setup is gone — no chase.
    if (trade.entryTime !== null && ((trade.entry - trade.stop) * dir <= 0 || (trade.entry - trade.t1) * dir >= 0)) continue;
    trades.push(trade);
    stats.signals++;
    if (trade.entryTime === null || i + 1 >= closed) { busyUntil = closed; continue; }
    const end = simulate(trade, bars, i + 1, closed);
    busyUntil = end;
    if (trade.status === 'closed') {
      stats.closed++;
      stats.points += trade.points!;
      if (trade.points! > 0) stats.wins++; else stats.losses++;
      if (trade.exitReason === 'SL') cooldown[trade.side] = end + PRO_SL_COOLDOWN_BARS;
    }
  }
  return { verdict, trades, stats };
}

export interface ProDecision {
  action: Side | 'WAIT'; stage: 'ENTRY' | 'HOLD' | 'WAIT'; headline: string; reason: string;
}

/**
 * What the trader should do right now. BUY / SELL only on the candle right after a fully confirmed signal, with live
 * data; HOLD while that trade is still open; WAIT for everything else (including stale data and partial confluence).
 */
export function proDecision(replay: ProReplay | null, fresh: FreshnessState): ProDecision {
  const verdict = replay?.verdict ?? null;
  const open = replay?.trades.find(trade => trade.status === 'open') ?? null;
  if (fresh !== 'LIVE' && fresh !== 'DELAYED') {
    return { action: 'WAIT', stage: 'WAIT', headline: 'WAIT', reason: fresh === 'CLOSED' ? 'Market closed — no new signals.' : 'Live feed not fresh — signals suspended.' };
  }
  if (!verdict) return { action: 'WAIT', stage: 'WAIT', headline: 'WAIT', reason: 'Loading 5m futures candles…' };
  if (open && open.signalTime === verdict.time) {
    return { action: open.side, stage: 'ENTRY', headline: open.side,
      reason: `All ${verdict.total} checks confirmed on the ${clock(verdict.time + PRO_INTERVAL * 60)} close · SL ${fmt(open.stop)} · T1 ${fmt(open.t1)}.` };
  }
  if (open) return { action: 'WAIT', stage: 'HOLD', headline: `HOLD ${open.side}`, reason: `Trade open from ${fmt(open.entry)} · SL ${fmt(open.t1Hit ? open.entry : open.stop)} · T2 ${fmt(open.t2)}. No new entry.` };
  const lean = verdict.side ? ` · ${verdict.side === 'BUY' ? 'buyers' : 'sellers'} leading` : '';
  return { action: 'WAIT', stage: 'WAIT', headline: 'WAIT', reason: `${verdict.passed}/${verdict.total} checks${lean} — need all ${verdict.total}.` };
}

/** Start time of the chart bar containing `time` (charts may use another timeframe than the 5m gate). */
export function snapTime(barTimes: readonly number[], time: number, barSeconds: number): number | null {
  let low = 0, high = barTimes.length - 1, found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (barTimes[mid] <= time) { found = mid; low = mid + 1; } else high = mid - 1;
  }
  return found < 0 || time - barTimes[found] >= barSeconds ? null : barTimes[found];
}

/** Bar length in seconds for a chart timeframe (minutes, or D / W / M). */
export const timeframeSeconds = (timeframe: number | string) =>
  typeof timeframe === 'number' ? timeframe * 60 : timeframe === 'D' ? 86_400 : timeframe === 'W' ? 7 * 86_400 : 31 * 86_400;

/**
 * Confirmed entries and their exits as chart labels. `shift` converts futures prices to the chart's prices
 * (the futures − spot basis on the cash chart); null skips a label that cannot be placed honestly.
 */
export function proSignalLabels(
  trades: readonly ProTrade[], barTimes: readonly number[], barSeconds: number, shift: (time: number) => number | null = () => 0,
): ChartSignalLabel[] {
  const labels: ChartSignalLabel[] = [];
  for (const trade of trades) {
    const buy = trade.side === 'BUY';
    const at = trade.entryTime ?? trade.signalTime;
    const time = snapTime(barTimes, at, barSeconds);
    const offset = shift(at);
    if (time === null || offset === null) continue;
    labels.push({
      id: trade.id, time, price: trade.entry - offset, kind: trade.side, placement: buy ? 'below' : 'above',
      text: `✔ ${trade.side} ${fmt(trade.entry - offset)}`, early: trade.entryTime === null,
    });
    if (trade.status !== 'closed' || trade.exitTime === undefined || trade.exitPrice === undefined) continue;
    const exitTime = snapTime(barTimes, trade.exitTime, barSeconds);
    const exitOffset = shift(trade.exitTime) ?? offset;
    if (exitTime === null) continue;
    const points = trade.points ?? 0;
    labels.push({
      id: `${trade.id}:exit`, time: exitTime, price: trade.exitPrice - exitOffset, kind: 'EXIT', placement: buy ? 'above' : 'below',
      text: `EXIT ${fmt(trade.exitPrice - exitOffset)} ${trade.exitReason}`,
      detail: `${points >= 0 ? '+' : ''}${points.toFixed(1)} pts`, detailPositive: points >= 0,
    });
  }
  return labels;
}
