import type { Candle } from '@/hooks/useChartIntelligence';
import { createIndicatorEngine, createPivotEngine, type IndicatorSeries } from './chart-indicators';
import { candleTime, DEFAULT_INDICATORS, sessionDate, type IndicatorSettings, type Timeframe, type TradePlan } from './chart-workspace';

/**
 * Rejection-trading engine for the Observatory chart. It only reads the chart's existing
 * indicators (EMA 9/20/50/100/200, EMA 13/21, SuperTrend 10/2, Camarilla, Traditional
 * pivots, CPR, RSI 14, ATR 14). Prices are INDEX levels; futures/options fills differ.
 */
export type RejectionSide = 'BUY' | 'SELL';
export type RejectionSetup = 'Rejection' | 'Bounce' | 'Failed breakout' | 'Retest';
export type RejectionStatus = 'PENDING' | 'OPEN' | 'T1 HIT' | 'STOP' | 'T1 → BE' | 'T1 → T2' | 'T1 → CLOSE' | 'CLOSE' | 'NO FILL';

export interface RejectionOutcome {
  status: RejectionStatus;
  fill?: number;
  exitTime?: number;
  exitPrice?: number;
  netPoints?: number;
  r?: number;
  t1Hit: boolean;
  t2Hit: boolean;
  resolved: boolean;
}

export interface RejectionSignal {
  id: string;
  time: number;
  index: number;
  side: RejectionSide;
  setup: RejectionSetup;
  level: string;
  levelPrice: number;
  pattern: string;
  entry: number;
  stopLoss: number;
  target1: number;
  target2: number;
  t1Basis: string;
  t2Basis: string;
  risk: number;
  rr1: number;
  rr2: number;
  confidence: number;
  reasons: string[];
  early: boolean;
  outcome: RejectionOutcome;
}

export interface ReplayStats {
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  netPoints: number;
  expectancy: number | null;
  avgR: number | null;
  profitFactor: number | null;
  t1Rate: number | null;
  t2Rate: number | null;
}

export interface RejectionWatch { time: number; side: RejectionSide; level: string; reason: string }

export interface RejectionResult {
  signals: RejectionSignal[];
  active: RejectionSignal | null;
  watch: RejectionWatch | null;
  plan: TradePlan;
  stats: { all: ReplayStats; inSample: ReplayStats; outOfSample: ReplayStats };
  costs: { slippagePoints: number; feePoints: number };
  evaluatedBars: number;
}

export interface RejectionOptions {
  live: boolean;
  nowMs: number;
  early?: boolean;
  minConfidence?: number;
  slippagePoints?: number;
  feePoints?: number;
}

interface Level { id: string; price: number; weight: number }
interface Candidate {
  side: RejectionSide; setup: RejectionSetup; level: Level; confluence: number; pattern: string;
  entry: number; stopLoss: number; target1: number; target2: number; t1Basis: string; t2Basis: string;
  risk: number; confidence: number; reasons: string[];
}
type Evaluation = { candidate: Candidate | null; watch: RejectionWatch | null };

const ENGINE_SETTINGS: IndicatorSettings = { ...DEFAULT_INDICATORS, vwap: false, emaCross: true, macd: false, pivots: true, camarilla: true, cpr: true };
const EMA_WEIGHT: Record<number, number> = { 9: 1, 20: 1, 50: 2, 100: 2, 200: 3 };
const PIVOT_LEVELS: [string, string, number][] = [
  ['cpr:TC', 'CPR TC', 3], ['cpr:P', 'CPR P', 3], ['cpr:BC', 'CPR BC', 3],
  ['camarilla:R4', 'Camarilla R4', 3], ['camarilla:R3', 'Camarilla R3', 3],
  ['camarilla:S3', 'Camarilla S3', 3], ['camarilla:S4', 'Camarilla S4', 3],
  ['camarilla:R2', 'Camarilla R2', 2], ['camarilla:S2', 'Camarilla S2', 2],
  ['traditional:R1', 'Pivot R1', 2], ['traditional:S1', 'Pivot S1', 2],
  ['traditional:R2', 'Pivot R2', 2], ['traditional:S2', 'Pivot S2', 2],
];
const SESSION_LAST_ENTRY_MIN = 15 * 60 + 10;
const tick = (value: number) => Math.round(value * 20) / 20;
const finite = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value);

function emptyStats(): ReplayStats {
  return { trades: 0, wins: 0, losses: 0, winRate: null, netPoints: 0, expectancy: null, avgR: null, profitFactor: null, t1Rate: null, t2Rate: null };
}

export function replayStats(signals: RejectionSignal[]): ReplayStats {
  const done = signals.filter(signal => signal.outcome.resolved && signal.outcome.netPoints !== undefined);
  if (!done.length) return emptyStats();
  const pts = done.map(signal => signal.outcome.netPoints!);
  const gains = pts.filter(value => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = -pts.filter(value => value <= 0).reduce((sum, value) => sum + value, 0);
  const net = pts.reduce((sum, value) => sum + value, 0);
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    trades: done.length,
    wins: pts.filter(value => value > 0).length,
    losses: pts.filter(value => value <= 0).length,
    winRate: round(pts.filter(value => value > 0).length / done.length * 100),
    netPoints: round(net),
    expectancy: round(net / done.length),
    avgR: round(done.reduce((sum, signal) => sum + (signal.outcome.r ?? 0), 0) / done.length),
    profitFactor: losses > 0 ? round(gains / losses) : gains > 0 ? null : 0,
    t1Rate: round(done.filter(signal => signal.outcome.t1Hit).length / done.length * 100),
    t2Rate: round(done.filter(signal => signal.outcome.t2Hit).length / done.length * 100),
  };
}

function patterns(bar: Candle, previous: Candle, side: RejectionSide, tolerance: number): string[] {
  const range = bar.h - bar.l;
  if (range <= 0) return [];
  const body = Math.abs(bar.c - bar.o);
  const upper = bar.h - Math.max(bar.o, bar.c);
  const lower = Math.min(bar.o, bar.c) - bar.l;
  const found: string[] = [];
  if (side === 'BUY') {
    if (lower >= Math.max(body * 2, range * 0.45) && upper <= range * 0.35) found.push('Hammer / long lower wick');
    if (bar.c > bar.o && previous.c < previous.o && bar.c >= previous.o && bar.o <= previous.c) found.push('Bullish engulfing');
    if (Math.abs(bar.l - previous.l) <= tolerance * 0.5 && previous.c < previous.o && bar.c > bar.o) found.push('Tweezer bottom');
    if (!found.length && bar.c > bar.o && bar.c - bar.l >= range * 0.65 && lower >= range * 0.3) found.push('Bullish rejection close');
  } else {
    if (upper >= Math.max(body * 2, range * 0.45) && lower <= range * 0.35) found.push('Shooting star / long upper wick');
    if (bar.c < bar.o && previous.c > previous.o && bar.c <= previous.o && bar.o >= previous.c) found.push('Bearish engulfing');
    if (Math.abs(bar.h - previous.h) <= tolerance * 0.5 && previous.c > previous.o && bar.c < bar.o) found.push('Tweezer top');
    if (!found.length && bar.c < bar.o && bar.h - bar.c >= range * 0.65 && upper >= range * 0.3) found.push('Bearish rejection close');
  }
  return found;
}

const barCache = new WeakMap<Candle, { time: number; session: string }>();
function barInfo(bar: Candle) {
  let info = barCache.get(bar);
  if (!info) {
    const time = candleTime(bar);
    info = { time, session: sessionDate(time) };
    barCache.set(bar, info);
  }
  return info;
}
const barTime = (bar: Candle) => barInfo(bar).time;
const barSession = (bar: Candle) => barInfo(bar).session;

function istMinutes(time: number) {
  const ist = new Date((time + 19800) * 1000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

/** Epoch seconds when a bar is final: intraday bars after their duration, D/W/M at the 15:30 IST close of the period. */
function barClose(bar: Candle, timeframe: Timeframe): number {
  const time = barTime(bar);
  if (typeof timeframe === 'number') return time + timeframe * 60;
  const ist = new Date((time + 19800) * 1000);
  const start = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) / 1000 - 19800;
  const close = 15 * 3600 + 30 * 60;
  if (timeframe === 'D') return start + close;
  if (timeframe === 'W') return start + ((5 - ist.getUTCDay() + 7) % 7) * 86400 + close;
  const lastDay = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, 0)).getUTCDate();
  return start + (lastDay - ist.getUTCDate()) * 86400 + close;
}

export function createRejectionEngine() {
  const indicators = createIndicatorEngine();
  const pivots = createPivotEngine();
  let cache: (Evaluation | undefined)[] = [];
  let pivotRef: IndicatorSeries | null = null;
  let calculationRef: unknown = null;
  let cacheKey = '';
  // Intraday timeframes trade one session at a time; D/W/M run as swing trades across bars.
  let intraday = true;

  const levelsAt = (candles: Candle[], series: IndicatorSeries, pivotSeries: IndicatorSeries, i: number, current: boolean): Level[] => {
    const at = current ? i : i - 1;
    const levels: Level[] = [];
    for (const period of [9, 20, 50, 100, 200]) {
      const value = series[`ema${period}`]?.[at]?.value;
      if (finite(value)) levels.push({ id: `EMA ${period}`, price: value, weight: EMA_WEIGHT[period] });
    }
    for (const [key, id, weight] of PIVOT_LEVELS) {
      const value = pivotSeries[key]?.[i]?.value;
      if (finite(value)) levels.push({ id, price: value, weight });
    }
    const session = barSession(candles[i]);
    let high = -Infinity, low = Infinity, count = 0;
    for (let k = Math.max(0, i - 30); k < i - 2; k++) {
      const bar = candles[k];
      if (intraday && barSession(bar) !== session) continue;
      if (bar.h > high) high = bar.h;
      if (bar.l < low) low = bar.l;
      count++;
    }
    if (count >= 6) levels.push({ id: 'Swing high', price: high, weight: 2 }, { id: 'Swing low', price: low, weight: 2 });
    return levels;
  };

  const evaluate = (candles: Candle[], series: IndicatorSeries, pivotSeries: IndicatorSeries, i: number, minutes: number): Evaluation => {
    const none: Evaluation = { candidate: null, watch: null };
    if (i < 6) return none;
    const bar = candles[i];
    const previous = candles[i - 1];
    const time = barTime(bar);
    const session = sessionDate(time);
    if (intraday && barSession(candles[i - 2]) !== session) return none;
    const atr = series.atr?.[i]?.value;
    if (!finite(atr) || atr <= 0) return none;
    const tolerance = Math.max(atr * 0.15, bar.c * 0.0002);
    const levels = levelsAt(candles, series, pivotSeries, i, false);
    const prior = candles.slice(i - 5, i);
    const value = (key: string, at = i) => series[key]?.[at]?.value;
    const e9 = value('ema9'), e20 = value('ema20'), e50 = value('ema50'), e200 = value('ema200');
    const e13 = value('ema13'), e21 = value('ema21');
    const rsi = value('rsi'), rsiPrevious = value('rsi', i - 1);
    const stUp = finite(value('supertrendUp')), stDown = finite(value('supertrendDown'));
    const volumes = candles.slice(i - 20, i).map(item => item.v);
    const volumeKnown = bar.v > 0 && volumes.length === 20 && volumes.every(item => item > 0);
    const relativeVolume = volumeKnown ? bar.v / (volumes.reduce((sum, item) => sum + item, 0) / 20) : null;
    const lateSession = intraday && istMinutes(time) + minutes >= SESSION_LAST_ENTRY_MIN;
    const results: Candidate[] = [];
    let watch: RejectionWatch | null = null;

    for (const side of ['BUY', 'SELL'] as const) {
      const dir = side === 'BUY' ? 1 : -1;
      // Touch: the wick reached the level, but the close held on the rejection side.
      const touched = levels.filter(level => side === 'BUY'
        ? bar.l <= level.price + tolerance && bar.c > level.price && bar.l >= level.price - atr * 1.5
        : bar.h >= level.price - tolerance && bar.c < level.price && bar.h <= level.price + atr * 1.5);
      if (!touched.length) continue;
      const level = touched.reduce((best, item) => item.weight > best.weight ||
        item.weight === best.weight && Math.abs(item.price - (side === 'BUY' ? bar.l : bar.h)) < Math.abs(best.price - (side === 'BUY' ? bar.l : bar.h)) ? item : best);
      const confluence = touched.filter(item => Math.abs(item.price - level.price) <= tolerance * 2).length;
      const found = patterns(bar, previous, side, tolerance);
      if (!found.length) {
        if (level.weight >= 2) watch = { time, side, level: level.id, reason: `${level.id} touched — no ${side === 'BUY' ? 'bullish' : 'bearish'} rejection candle yet` };
        continue;
      }
      const beyond = (item: Candle) => dir * (item.c - level.price) < 0;
      let setup: RejectionSetup;
      if (beyond(previous) || beyond(candles[i - 2])) setup = 'Failed breakout';
      else if (prior.slice(0, -1).some((item, k) => !beyond(item) && beyond(candles[i - 6 + k]))) setup = 'Retest';
      else setup = /wick|Tweezer/.test(found[0]) ? 'Rejection' : 'Bounce';
      if (setup === 'Rejection' || setup === 'Bounce') {
        const approached = prior.slice(-3).filter(item => !beyond(item)).length >= 2;
        if (!approached) continue;
      }
      const reasons = [`${setup} at ${level.id} ${level.price.toFixed(2)}`, found.join(' + ')];
      const emaAligned = finite(e9) && finite(e20) && dir * (e9 - e20) > 0;
      const majorAligned = finite(e200) ? dir * (bar.c - e200) > 0 || finite(e50) && dir * (e50 - e200) > 0 : false;
      const stAligned = side === 'BUY' ? stUp : stDown;
      const stAgainst = side === 'BUY' ? stDown : stUp;
      const rsiTurning = finite(rsi) && finite(rsiPrevious) && dir * (rsi - rsiPrevious) > 0;
      const rsiExtreme = finite(rsi) && (side === 'BUY' ? rsi >= 72 : rsi <= 28);
      const rsiReset = finite(rsi) && candles.slice(i - 3, i + 1).some((_, k) => {
        const past = value('rsi', i - 3 + k);
        return finite(past) && (side === 'BUY' ? past <= 35 : past >= 65);
      });
      const crossAligned = finite(e13) && finite(e21) && dir * (e13 - e21) > 0;
      if (rsiExtreme) { watch = { time, side, level: level.id, reason: `RSI ${rsi!.toFixed(1)} already stretched — late ${side}` }; continue; }
      const confirms = [emaAligned, stAligned, rsiTurning].filter(Boolean).length;
      if (confirms < 2) { watch = { time, side, level: level.id, reason: `${setup} at ${level.id} lacks direction (EMA 9/20, SuperTrend, RSI: ${confirms}/3)` }; continue; }
      if (lateSession) { watch = { time, side, level: level.id, reason: 'Too late in session for a new intraday entry' }; continue; }
      const distance = dir * (bar.c - level.price);
      if (distance > atr * 1.2) { watch = { time, side, level: level.id, reason: `Close already ${distance.toFixed(1)} pts from ${level.id} — late entry suppressed` }; continue; }

      let score = 20 + Math.min(18, level.weight * 6) + (confluence >= 2 ? 8 : 0);
      if (emaAligned) { score += 12; reasons.push(`EMA 9 ${side === 'BUY' ? '>' : '<'} EMA 20`); }
      if (majorAligned) { score += 10; reasons.push(`EMA 50/200 ${side === 'BUY' ? 'bullish' : 'bearish'} context`); }
      if (stAligned) { score += 14; reasons.push(`SuperTrend ${side === 'BUY' ? 'up' : 'down'}`); }
      if (stAgainst) score -= 10;
      if (crossAligned) { score += 8; reasons.push(`EMA 13/21 ${side === 'BUY' ? 'bullish' : 'bearish'}`); }
      if (rsiTurning) { score += 10; reasons.push(`RSI ${rsi!.toFixed(1)} turning ${side === 'BUY' ? 'up' : 'down'}`); }
      if (rsiReset) { score += 6; reasons.push(side === 'BUY' ? 'RSI recovered from oversold' : 'RSI rolled from overbought'); }
      if (/engulfing|Hammer|Shooting/.test(found.join())) score += 8;
      if (dir * (bar.c - (side === 'BUY' ? previous.h : previous.l)) > 0) { score += 6; reasons.push(`Closed ${side === 'BUY' ? 'above prior high' : 'below prior low'}`); }
      if (relativeVolume !== null && relativeVolume >= 1.2) { score += 8; reasons.push(`Volume ${relativeVolume.toFixed(1)}× average`); }
      if (confluence >= 2) reasons.push(`${confluence} levels in confluence`);

      const entry = tick(bar.c);
      const swing = candles.slice(i - 2, i + 1);
      const extreme = side === 'BUY' ? Math.min(...swing.map(item => item.l)) : Math.max(...swing.map(item => item.h));
      let stopLoss = tick(extreme - dir * atr * 0.15);
      if (dir * (entry - stopLoss) < atr * 0.5) stopLoss = tick(entry - dir * atr * 0.5);
      const risk = Math.abs(entry - stopLoss);
      if (risk > atr * 2) { watch = { time, side, level: level.id, reason: `Rejection swing risk ${risk.toFixed(1)} pts > 2× ATR` }; continue; }
      const ahead = levelsAt(candles, series, pivotSeries, i, true)
        .filter(item => dir * (item.price - entry) > risk * 0.25)
        .sort((a, b) => dir * (a.price - b.price));
      const blocker = ahead.find(item => item.weight >= 2 && dir * (item.price - entry) < risk * 0.8);
      if (blocker) { watch = { time, side, level: level.id, reason: `${blocker.id} ${blocker.price.toFixed(2)} blocks the move (< 1R room)` }; continue; }
      const t1Level = ahead.find(item => dir * (item.price - entry) >= risk && dir * (item.price - entry) <= risk * 4);
      const target1 = tick(t1Level ? t1Level.price - dir * 0.05 : entry + dir * risk * 1.5);
      const t2Level = ahead.find(item => dir * (item.price - target1) >= risk * 0.5 && dir * (item.price - entry) >= risk * 2);
      const target2 = tick(t2Level ? t2Level.price - dir * 0.05 : entry + dir * Math.max(risk * 2.5, Math.abs(target1 - entry) + risk));
      results.push({
        side, setup, level, confluence, pattern: found[0], entry, stopLoss, target1, target2,
        t1Basis: t1Level ? t1Level.id : '1.5R projection', t2Basis: t2Level ? t2Level.id : 'R-multiple projection',
        risk, confidence: Math.max(0, Math.min(100, Math.round(score))), reasons,
      });
    }
    if (results.length > 1) return { candidate: null, watch: { time, side: results[0].side, level: results[0].level.id, reason: 'Conflicting BUY and SELL rejections — no trade' } };
    return { candidate: results[0] ?? null, watch };
  };

  const simulate = (candles: Candle[], signal: Candidate, i: number, closedCount: number, slip: number, fees: number, minutes: number): RejectionOutcome => {
    const dir = signal.side === 'BUY' ? 1 : -1;
    const session = barSession(candles[i]);
    if (i + 1 >= closedCount) return { status: 'PENDING', t1Hit: false, t2Hit: false, resolved: false };
    if (intraday && barSession(candles[i + 1]) !== session) return { status: 'NO FILL', t1Hit: false, t2Hit: false, resolved: false };
    // Signal is known at the close; the first executable price is the next bar's open.
    const fill = candles[i + 1].o + dir * slip;
    let stop = signal.stopLoss;
    let leg1: number | null = null;
    const finish = (status: RejectionStatus, exit: number, time: number, t2Hit = false): RejectionOutcome => {
      const first = leg1 ?? exit;
      const net = (dir * (first - fill) + dir * (exit - fill)) / 2 - fees;
      return { status, fill, exitTime: time, exitPrice: tick(exit), netPoints: Math.round(net * 100) / 100, r: Math.round(net / signal.risk * 100) / 100,
        t1Hit: leg1 !== null, t2Hit, resolved: true };
    };
    for (let j = i + 1; j < closedCount; j++) {
      const bar = candles[j];
      const time = barTime(bar);
      if (intraday && sessionDate(time) !== session) {
        const last = candles[j - 1];
        return finish(leg1 === null ? 'CLOSE' : 'T1 → CLOSE', last.c - dir * slip, barTime(last));
      }
      const stopHit = dir * ((dir === 1 ? bar.l : bar.h) - stop) <= 0;
      // Same-bar stop and target is resolved conservatively: stop first.
      if (stopHit) {
        const exit = (dir * (bar.o - stop) <= 0 ? bar.o : stop) - dir * slip;
        return finish(leg1 === null ? 'STOP' : 'T1 → BE', exit, time);
      }
      if (leg1 === null && dir * ((dir === 1 ? bar.h : bar.l) - signal.target1) >= 0) {
        leg1 = signal.target1;
        stop = fill;
      }
      if (leg1 !== null && dir * ((dir === 1 ? bar.h : bar.l) - signal.target2) >= 0)
        return finish('T1 → T2', signal.target2, time, true);
    }
    const last = candles[closedCount - 1];
    const sessionOver = intraday && (istMinutes(barTime(last)) + minutes >= 15 * 60 + 30 || barSession(last) !== session);
    if (sessionOver) return finish(leg1 === null ? 'CLOSE' : 'T1 → CLOSE', last.c - dir * slip, barTime(last));
    return { status: leg1 === null ? 'OPEN' : 'T1 HIT', fill, t1Hit: leg1 !== null, t2Hit: false, resolved: false };
  };

  return {
    analyze(candles: Candle[], daily: Candle[], timeframe: Timeframe, options: RejectionOptions): RejectionResult {
      const slip = options.slippagePoints ?? 0.5;
      const fees = options.feePoints ?? 1;
      // W/M histories are too short for EMA 50/200 context, so their baseline score is lower.
      const minConfidence = options.minConfidence ?? (timeframe === 'W' || timeframe === 'M' ? 60 : 70);
      const costs = { slippagePoints: slip, feePoints: fees };
      const wait = (reason: string): TradePlan => ({ direction: 'WAIT', score: 0, requiredScore: minConfidence, confirmation: [], watchReason: reason, basis: 'Rejection engine' });
      intraday = typeof timeframe === 'number';
      const minutes = typeof timeframe === 'number' ? timeframe : 0;
      const calculation = indicators.calculate(candles, ENGINE_SETTINGS, intraday);
      const series = calculation.series;
      const pivotSeries = pivots.calculate(candles, daily, timeframe, ENGINE_SETTINGS);
      const key = `${timeframe}:${candles.length ? candles[0].t : ''}`;
      // The indicator engine returns the same result object for unchanged candles; only invalidate on real change.
      if (calculation !== calculationRef) {
        if (calculation.rebuilt || pivotSeries !== pivotRef || key !== cacheKey) cache = [];
        else cache.length = Math.min(cache.length, Math.max(0, calculation.changedFrom - 1));
      } else if (pivotSeries !== pivotRef || key !== cacheKey) cache = [];
      calculationRef = calculation;
      pivotRef = pivotSeries;
      cacheKey = key;
      const nowSec = options.nowMs / 1000;
      let closedCount = candles.length;
      while (closedCount > 0 && barClose(candles[closedCount - 1], timeframe) > nowSec) closedCount--;
      for (let i = cache.length; i < closedCount; i++) cache[i] = evaluate(candles, series, pivotSeries, i, minutes);

      const signals: RejectionSignal[] = [];
      const lastBySide: Partial<Record<RejectionSide, { index: number; level: string }>> = {};
      // One position at a time: no new entry until the previous trade has exited.
      let busyUntil = -1;
      for (let i = 0; i < closedCount; i++) {
        const candidate = cache[i]?.candidate;
        if (!candidate || candidate.confidence < minConfidence || i <= busyUntil) continue;
        if (candidate.level.weight < 2 && candidate.confluence < 2) continue;
        const previous = lastBySide[candidate.side];
        // Duplicate suppression: one signal per side per 5 bars, one per level per 12 bars.
        if (previous && (i - previous.index < 5 || previous.level === candidate.level.id && i - previous.index < 12)) continue;
        lastBySide[candidate.side] = { index: i, level: candidate.level.id };
        const time = barTime(candles[i]);
        const outcome = simulate(candles, candidate, i, closedCount, slip, fees, minutes);
        if (outcome.status === 'NO FILL') continue;
        if (outcome.resolved && outcome.exitTime !== undefined) {
          let exitIndex = i + 1;
          while (exitIndex < closedCount - 1 && barTime(candles[exitIndex]) < outcome.exitTime) exitIndex++;
          busyUntil = exitIndex;
        } else busyUntil = Infinity;
        signals.push({
          id: `${time}:${candidate.side}:${candidate.level.id}`, time, index: i, side: candidate.side, setup: candidate.setup,
          level: candidate.level.id, levelPrice: candidate.level.price, pattern: candidate.pattern,
          entry: candidate.entry, stopLoss: candidate.stopLoss, target1: candidate.target1, target2: candidate.target2,
          t1Basis: candidate.t1Basis, t2Basis: candidate.t2Basis, risk: candidate.risk,
          rr1: Math.round(Math.abs(candidate.target1 - candidate.entry) / candidate.risk * 100) / 100,
          rr2: Math.round(Math.abs(candidate.target2 - candidate.entry) / candidate.risk * 100) / 100,
          confidence: candidate.confidence, reasons: candidate.reasons, early: false,
          outcome,
        });
      }

      const today = sessionDate(Math.floor(nowSec));
      let active = [...signals].reverse().find(signal => (intraday ? options.live && sessionDate(signal.time) === today : true) &&
        ['PENDING', 'OPEN', 'T1 HIT'].includes(signal.outcome.status)) ?? null;
      if (options.live && options.early && closedCount < candles.length && candles.length - 1 > 6) {
        const formingIndex = candles.length - 1;
        const early = evaluate(candles, series, pivotSeries, formingIndex, minutes).candidate;
        if (early && early.confidence - 10 >= minConfidence && (!intraday || barSession(candles[formingIndex]) === today) &&
            (!active || active.side !== early.side)) {
          const time = barTime(candles[formingIndex]);
          active = {
            id: `${time}:${early.side}:${early.level.id}:early`, time, index: formingIndex, side: early.side, setup: early.setup,
            level: early.level.id, levelPrice: early.level.price, pattern: early.pattern, entry: early.entry,
            stopLoss: early.stopLoss, target1: early.target1, target2: early.target2, t1Basis: early.t1Basis, t2Basis: early.t2Basis,
            risk: early.risk, rr1: Math.round(Math.abs(early.target1 - early.entry) / early.risk * 100) / 100,
            rr2: Math.round(Math.abs(early.target2 - early.entry) / early.risk * 100) / 100,
            confidence: early.confidence - 10, reasons: ['EARLY: candle not closed — may repaint', ...early.reasons], early: true,
            outcome: { status: 'PENDING', t1Hit: false, t2Hit: false, resolved: false },
          };
        }
      }
      const lastEvaluation = closedCount ? cache[closedCount - 1] : undefined;
      const watch = !active && lastEvaluation?.watch && options.live ? lastEvaluation.watch : null;
      const resolved = signals.filter(signal => signal.outcome.resolved);
      const split = Math.floor(resolved.length * 0.7);
      const stats = { all: replayStats(resolved), inSample: replayStats(resolved.slice(0, split)), outOfSample: replayStats(resolved.slice(split)) };
      const plan: TradePlan = active ? {
        direction: active.side, score: active.confidence, requiredScore: minConfidence, confirmation: active.reasons,
        watchReason: '', entry: active.entry, stopLoss: active.stopLoss, targets: [active.target1, active.target2, active.target2],
        exitPrice: active.target1, riskPoints: active.risk, candleTime: active.time, conditional: active.early,
        basis: `${active.setup} @ ${active.level}`,
        invalidation: `Exit if price trades through SL ${active.stopLoss.toFixed(2)}. Book 50% at T1 ${active.target1.toFixed(2)} (${active.t1Basis}), trail rest to breakeven, T2 ${active.target2.toFixed(2)} (${active.t2Basis}). Index levels — futures/options fills differ.`,
      } : wait(!options.live ? 'Live session required for new rejection entries; historical signals stay on the chart.' :
        watch ? `WAIT: ${watch.reason}.` : 'WAIT: no validated rejection at EMA / CPR / Camarilla / pivot levels.');
      return { signals, active, watch, plan, stats, costs, evaluatedBars: closedCount };
    },
  };
}
