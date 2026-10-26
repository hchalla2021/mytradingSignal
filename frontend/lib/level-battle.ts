/**
 * Level battle: when price comes to a key level (EMA, Camarilla, CPR, pivot, VWAP, previous-day high/low),
 * measure who is fighting there — recorded futures buyers vs sellers traded inside the level's zone, resting
 * depth, the momentum of the approach and how the level behaved on earlier tests today — and turn it into a
 * transparent REJECT vs BREAK estimate with the points to the next level either way.
 *
 * Levels are taken from the chart's own candles (so they match the lines on that chart); everything measured
 * comes from the near-month 5m futures recording, mapped through `offset` (futures − chart price).
 */
import type { OrderFlowBar, OrderFlowDom } from './order-flow';
import { atr, ema, istDay, previousDay, sessionVwap, type TerminalBar } from './futures-terminal';
import { pivotValues } from './chart-indicators';

export type LevelGroup = 'EMA' | 'VWAP' | 'CAM' | 'CPR' | 'PIVOT' | 'PDH/PDL';
export interface ChartLevel { id: string; label: string; price: number; group: LevelGroup }
export interface LevelBar { time: number; o: number; h: number; l: number; c: number; v: number }

export type BattleState = 'AT' | 'NEAR' | 'FAR';
export type BattleRole = 'SUPPORT' | 'RESISTANCE';
export type BattleCall = 'REJECT' | 'BREAK' | 'NEUTRAL';
export interface BattleFactor { text: string; points: number }
export interface LevelTest { time: number; result: 'REJECT' | 'BREAK' | 'LIVE' }
export interface LevelBattle {
  id: string;
  /** Combined name of every line inside the zone, e.g. "Cam S3 + EMA 200". */
  label: string;
  members: ChartLevel[];
  /** Chart price of the level (cluster centre) and its zone half-width, both in chart prices. */
  price: number;
  zone: number;
  state: BattleState;
  role: BattleRole;
  /** Signed chart-price distance from the last price (price − level). */
  distance: number;
  /** Recorded futures volume traded inside the zone: today and in the last 30 minutes. */
  buy: number; sell: number; recentBuy: number; recentSell: number;
  /** Resting 5-level depth (only when the level is inside the visible book). */
  bookBid: number | null; bookAsk: number | null;
  tests: LevelTest[];
  /** Probability-style split (sums to 100): price goes UP from here vs DOWN from here. */
  up: number; down: number;
  call: BattleCall;
  /** Next level (chart price) above and below and the points to reach it. */
  above: { label: string; price: number; points: number } | null;
  below: { label: string; price: number; points: number } | null;
  factors: BattleFactor[];
  flowAvailable: boolean;
}

const EMA_LEVELS = [9, 20, 21, 50, 100, 200] as const;
const RECENT_BARS = 6;
export const ZONE_ATR = 0.25;
export const NEAR_ATR = 1.2;

/** Every standard level from the chart's own candles. Pivots use the previous session (previous bar on daily charts). */
export function chartLevels(bars: readonly LevelBar[], options: { intraday: boolean; vwap: boolean }): ChartLevel[] {
  if (!bars.length) return [];
  const out: ChartLevel[] = [];
  const closes = bars.map(bar => bar.c);
  const last = bars.length - 1;
  for (const period of EMA_LEVELS) {
    const value = ema(closes, period)[last];
    if (value != null) out.push({ id: `ema${period}`, label: `EMA ${period}`, price: value, group: 'EMA' });
  }
  const terminal = bars as readonly TerminalBar[];
  if (options.vwap && options.intraday && bars[last].v > 0) {
    const value = sessionVwap(terminal)[last];
    if (value != null) out.push({ id: 'vwap', label: 'VWAP', price: value, group: 'VWAP' });
  }
  const prev = previousDay(terminal);
  if (prev && prev.high > prev.low) {
    const pivots = pivotValues(prev.high, prev.low, prev.close);
    for (const name of ['R1', 'R2', 'R3', 'R4', 'S1', 'S2', 'S3', 'S4'] as const) {
      out.push({ id: `cam:${name}`, label: `Cam ${name}`, price: pivots.camarilla[name], group: 'CAM' });
    }
    out.push({ id: 'cpr:TC', label: 'CPR TC', price: pivots.cpr.TC, group: 'CPR' });
    out.push({ id: 'cpr:P', label: 'CPR P', price: pivots.cpr.P, group: 'CPR' });
    out.push({ id: 'cpr:BC', label: 'CPR BC', price: pivots.cpr.BC, group: 'CPR' });
    for (const name of ['R1', 'R2', 'S1', 'S2'] as const) {
      out.push({ id: `pivot:${name}`, label: `Pivot ${name}`, price: pivots.traditional[name], group: 'PIVOT' });
    }
    out.push({ id: 'pdh', label: 'PDH', price: prev.high, group: 'PDH/PDL' });
    out.push({ id: 'pdl', label: 'PDL', price: prev.low, group: 'PDH/PDL' });
  }
  return out.filter(level => Number.isFinite(level.price) && level.price > 0);
}

interface Cluster { price: number; members: ChartLevel[] }

/** Lines closer together than one zone act as a single level (confluence). */
export function clusterLevels(levels: readonly ChartLevel[], zone: number): Cluster[] {
  const sorted = [...levels].sort((a, b) => a.price - b.price);
  const out: Cluster[] = [];
  for (const level of sorted) {
    const current = out[out.length - 1];
    if (current && level.price - current.members[0].price <= zone * 2) {
      current.members.push(level);
      current.price = current.members.reduce((sum, item) => sum + item.price, 0) / current.members.length;
    } else out.push({ price: level.price, members: [level] });
  }
  return out;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const ratio = (a: number, b: number) => (a + b > 0 ? (a - b) / (a + b) : 0);
const ORDER: Record<LevelGroup, number> = { CAM: 0, CPR: 1, 'PDH/PDL': 2, VWAP: 3, EMA: 4, PIVOT: 5 };
const nameOf = (members: ChartLevel[]) => [...members].sort((a, b) => ORDER[a.group] - ORDER[b.group]).map(level => level.label).join(' + ');

/** Earlier tests of the level today on 5m futures: a test ends when a candle no longer touches the zone. */
export function levelTests(bars: readonly TerminalBar[], level: number, zone: number): LevelTest[] {
  if (!bars.length) return [];
  const today = istDay(bars[bars.length - 1].time);
  const tests: LevelTest[] = [];
  let start = -1, from: 1 | -1 = 1;
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    if (istDay(bar.time) !== today) continue;
    const touching = bar.l <= level + zone && bar.h >= level - zone;
    if (touching && start < 0) {
      start = i;
      const before = i > 0 && istDay(bars[i - 1].time) === today ? bars[i - 1].c : bar.o;
      from = before >= level ? 1 : -1;
    } else if (!touching && start >= 0) {
      const side = bar.c >= level ? 1 : -1;
      tests.push({ time: bars[start].time, result: side === from ? 'REJECT' : 'BREAK' });
      start = -1;
    }
  }
  if (start >= 0) tests.push({ time: bars[start].time, result: 'LIVE' });
  return tests;
}

export interface BattleInput {
  levels: readonly ChartLevel[];
  /** Latest chart price. */
  price: number;
  /** Near-month 5m futures candles (touches, momentum, trend, ATR). */
  futures: readonly TerminalBar[];
  flowBars: readonly OrderFlowBar[];
  dom: OrderFlowDom | null;
  /** futures − chart price; 0 on the near-month futures chart, the basis on the cash chart, null if unrelated. */
  offset: number | null;
}

export function levelBattles(input: BattleInput): LevelBattle[] {
  const { futures, price, offset } = input;
  if (!input.levels.length || !futures.length || !Number.isFinite(price)) return [];
  const atrNow = atr(futures, 14)[futures.length - 1] ?? null;
  const fallback = futures.slice(-14).reduce((sum, bar) => sum + (bar.h - bar.l), 0) / Math.min(14, futures.length);
  const range = atrNow ?? fallback;
  if (!(range > 0)) return [];
  const zone = Math.max(range * ZONE_ATR, price * 0.00005);
  const clusters = clusterLevels(input.levels, zone);
  const mapped = offset != null;
  const toFut = (value: number) => value + (offset ?? 0);

  const closes = futures.map(bar => bar.c);
  const lastIndex = futures.length - 1;
  const e21 = ema(closes, 21)[lastIndex], e50 = ema(closes, 50)[lastIndex];
  const trend = e21 != null && e50 != null ? Math.sign(e21 - e50) : 0;
  const today = istDay(futures[lastIndex].time);
  const todayFlow = mapped ? input.flowBars.filter(bar => istDay(bar.t) === today) : [];
  const recentFrom = todayFlow.length > RECENT_BARS ? todayFlow[todayFlow.length - RECENT_BARS].t : -Infinity;
  const momentumBars = todayFlow.slice(-3);
  const momentum = momentumBars.reduce((acc, bar) => ({ d: acc.d + bar.d, v: acc.v + bar.v }), { d: 0, v: 0 });
  const back = futures[Math.max(0, lastIndex - 3)].c;

  return clusters.map((cluster, index) => {
    const distance = price - cluster.price;
    const abs = Math.abs(distance);
    const state: BattleState = abs <= zone ? 'AT' : abs <= range * NEAR_ATR ? 'NEAR' : 'FAR';
    const role: BattleRole = distance >= 0 ? 'SUPPORT' : 'RESISTANCE';
    const support = role === 'SUPPORT';
    const level = toFut(cluster.price);

    let buy = 0, sell = 0, recentBuy = 0, recentSell = 0;
    for (const bar of todayFlow) {
      for (const [p, b, s] of bar.lv) {
        if (Math.abs(p - level) > zone) continue;
        buy += b; sell += s;
        if (bar.t >= recentFrom) { recentBuy += b; recentSell += s; }
      }
    }
    let bookBid: number | null = null, bookAsk: number | null = null;
    if (mapped && input.dom && state !== 'FAR') {
      const inZone = (row: [number, number, number]) => Math.abs(row[0] - level) <= zone * 2;
      const bids = input.dom.bids.filter(inZone), asks = input.dom.asks.filter(inZone);
      if (bids.length || asks.length) {
        bookBid = bids.reduce((sum, row) => sum + row[1], 0);
        bookAsk = asks.reduce((sum, row) => sum + row[1], 0);
      }
    }
    const tests = levelTests(futures, mapped ? level : cluster.price + (futures[lastIndex].c - price), zone);

    // Positive points = the level holds (support bounces up / resistance pushes down).
    const factors: BattleFactor[] = [];
    const add = (points: number, text: string) => { if (Math.round(points)) factors.push({ points: Math.round(points), text }); };
    const defend = support ? 'Buyers' : 'Sellers', attack = support ? 'sellers' : 'buyers';
    const [defToday, attToday] = support ? [buy, sell] : [sell, buy];
    const [defRecent, attRecent] = support ? [recentBuy, recentSell] : [recentSell, recentBuy];
    if (defToday + attToday > 0) add(25 * ratio(defToday, attToday), `${defend} ${share(defToday, attToday)}% of volume traded at this level today`);
    if (defRecent + attRecent > 0) add(20 * ratio(defRecent, attRecent), `Last 30 min at the level: ${defend.toLowerCase()} ${share(defRecent, attRecent)}%`);
    if (momentum.v > 0) {
      const push = (support ? -momentum.d : momentum.d) / momentum.v;
      add(-25 * clamp(push / 0.3, -1, 1), `Last 15 min delta ${signed(momentum.d)} (${Math.round((momentum.d / momentum.v) * 100)}% of volume) ${push > 0 ? `— ${attack} pushing into the level` : `— ${attack} fading`}`);
    }
    const speed = ((support ? back - futures[lastIndex].c : futures[lastIndex].c - back) / range);
    if (speed > 1.5) add(-10, `Fast approach (${speed.toFixed(1)} ATR in 15 min) — momentum favours a break`);
    else if (speed > 0 && speed < 0.5) add(5, 'Slow, tired approach — favours a rejection');
    const rejects = tests.filter(test => test.result === 'REJECT').length, breaks = tests.filter(test => test.result === 'BREAK').length;
    if (rejects) add(Math.min(2, rejects) * 8, `Rejected ${rejects}× earlier today`);
    if (breaks) add(-Math.min(2, breaks) * 8, `Broken ${breaks}× earlier today`);
    if (tests.length >= 3) add(-8, `${tests.length} tests today — level is getting weaker`);
    if (cluster.members.length > 1) add(Math.min(3, cluster.members.length - 1) * 6, `${cluster.members.length} lines stacked here (confluence)`);
    if (trend) add((support ? trend : -trend) * 10, `5m trend (EMA 21 vs 50) is ${trend > 0 ? 'up' : 'down'}`);
    if (bookBid != null && bookAsk != null && bookBid + bookAsk > 0) {
      add(10 * ratio(support ? bookBid : bookAsk, support ? bookAsk : bookBid), `Resting orders at the level: bids ${bookBid.toLocaleString('en-IN')} vs asks ${bookAsk.toLocaleString('en-IN')}`);
    }
    if (!mapped) factors.push({ points: 0, text: 'No recorded order flow for this contract — reading uses price behaviour only' });
    else if (!todayFlow.length) factors.push({ points: 0, text: 'No order flow recorded yet today' });

    const score = clamp(factors.reduce((sum, factor) => sum + factor.points, 0), -80, 80);
    const hold = Math.round(50 + score / 2);
    const up = support ? hold : 100 - hold;
    const call: BattleCall = hold >= 65 ? 'REJECT' : hold <= 35 ? 'BREAK' : 'NEUTRAL';
    const next = (step: 1 | -1) => {
      const other = clusters[index + step];
      return other ? { label: nameOf(other.members), price: other.price, points: Math.abs(other.price - cluster.price) } : null;
    };
    return {
      id: cluster.members.map(member => member.id).join('|'), label: nameOf(cluster.members), members: cluster.members,
      price: cluster.price, zone, state, role, distance,
      buy, sell, recentBuy, recentSell, bookBid, bookAsk, tests,
      up, down: 100 - up, call, above: next(1), below: next(-1), factors, flowAvailable: mapped && todayFlow.length > 0,
    };
  });
}

/** Battles to show: levels being tested or approached plus the closest level on each side (max 4, top to bottom). */
export function activeBattles(battles: readonly LevelBattle[]): LevelBattle[] {
  const byDistance = [...battles].sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance));
  const picked = new Set<LevelBattle>(byDistance.filter(battle => battle.state !== 'FAR').slice(0, 4));
  for (const role of ['RESISTANCE', 'SUPPORT'] as BattleRole[]) {
    const nearest = byDistance.find(battle => battle.role === role);
    if (nearest && !picked.has(nearest)) {
      if (picked.size >= 4) picked.delete(Array.from(picked).filter(battle => battle.role !== role).pop()!);
      picked.add(nearest);
    }
  }
  return Array.from(picked).sort((a, b) => b.price - a.price);
}

function share(a: number, b: number) {
  return a + b > 0 ? Math.round((a / (a + b)) * 100) : 50;
}

function signed(value: number) {
  return `${value >= 0 ? '+' : '−'}${Math.abs(Math.round(value)).toLocaleString('en-IN')}`;
}

/** One-line headline used by the chart label and the panel. */
export function battleHeadline(battle: LevelBattle): string {
  if (battle.call === 'NEUTRAL') return `NEUTRAL ${battle.up}↑ / ${battle.down}↓`;
  const hold = battle.call === 'REJECT';
  const upMove = battle.role === 'SUPPORT' ? hold : !hold;
  return `${battle.call} ${upMove ? `${battle.up}% ↑` : `${battle.down}% ↓`}`;
}
