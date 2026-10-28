import type { Candle } from '@/hooks/useChartIntelligence';
import { candleTime, sessionDate } from './chart-workspace';
import type { OrderFlowBar, OrderFlowSnapshot } from './order-flow';

export const MTF_TIMEFRAMES = [30, 15, 5, 3] as const;
export type MtfTimeframe = typeof MTF_TIMEFRAMES[number];

const IST = 19_800;
const OPEN = (9 * 60 + 15) * 60;
const SESSION = 375 * 60;

const dayOpen = (time: number) => Math.floor((time + IST) / 86_400) * 86_400 - IST + OPEN;

/** Exchange bucket (anchored at 09:15 IST, same as Kite and the order-flow recorder); null outside the session. */
export function sessionBucket(time: number, minutes: number): number | null {
  const open = dayOpen(time);
  if (!Number.isFinite(time) || time < open || time >= open + SESSION) return null;
  return open + Math.floor((time - open) / (minutes * 60)) * minutes * 60;
}

/** Last second (exclusive) of the bar that starts at `time`; the 15:00 30m bar closes at 15:30. */
export function bucketEnd(time: number, minutes: number): number {
  return Math.min(time + minutes * 60, dayOpen(time) + SESSION);
}

/** Bars whose end is in the past; the remaining tail bar (if any) is still forming. */
export function closedCount(times: readonly number[], minutes: number, nowSeconds: number): number {
  const last = times[times.length - 1];
  return last !== undefined && bucketEnd(last, minutes) > nowSeconds ? times.length - 1 : times.length;
}

/** Binary search for the bar that covers `time` in an ascending candle array. */
export function candleAt(candles: readonly Candle[], time: number): Candle | null {
  let low = 0, high = candles.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const value = candleTime(candles[middle]);
    if (value === time) return candles[middle];
    if (value < time) low = middle + 1; else high = middle - 1;
  }
  return null;
}

/**
 * Re-buckets a 1-minute order-flow stream into a higher interval so one WebSocket can drive all charts.
 * Completeness mirrors the backend aggregator: a bucket is `complete` only when every expected minute was
 * recorded gap-free, and its forming OHLCV is usable only when the recorded minutes are contiguous from
 * the bucket open. Footprint fields (levels, POC, imbalances) are not rebuilt — only price, volume and OI.
 */
export function resampleFlowCandles(snapshot: OrderFlowSnapshot, interval: number): OrderFlowSnapshot | null {
  if (snapshot.interval === interval) return snapshot;
  if (snapshot.interval !== 1 || !Number.isInteger(interval) || interval < 1) return null;
  const groups = new Map<number, OrderFlowBar[]>();
  for (const bar of snapshot.bars) {
    const key = sessionBucket(bar.t, interval);
    if (key === null) continue;
    const group = groups.get(key);
    if (group) group.push(bar); else groups.set(key, [bar]);
  }
  const bars = Array.from(groups.entries()).sort(([a], [b]) => a - b).map(([t, minutes]): OrderFlowBar => {
    minutes.sort((a, b) => a.t - b.t);
    const first = minutes[0];
    const last = minutes[minutes.length - 1];
    const end = bucketEnd(t, interval);
    const expected = Math.max(1, Math.round((end - t) / 60));
    const recorded = minutes.every(minute => minute.complete || minute.ohlcvComplete);
    const contiguous = minutes.every((minute, index) => minute.t === t + index * 60);
    let h = -Infinity, l = Infinity, v = 0, b = 0, s = 0, n = 0, d = 0, weighted = 0;
    let oi: number | null = null, oiOpen: number | null = null;
    const flags = new Set<string>();
    for (const minute of minutes) {
      h = Math.max(h, minute.h);
      l = Math.min(l, minute.l);
      v += minute.v; b += minute.b; s += minute.s; n += minute.n; d += minute.d;
      weighted += minute.coverage * minute.v;
      if (minute.oi !== null) oi = minute.oi;
      if (oiOpen === null) oiOpen = minute.oiOpen ?? minute.oi;
      minute.flags.forEach(flag => flags.add(flag));
    }
    return {
      t, end, o: first.o, h, l, c: last.c, v, b, s, n, d, cvd: last.cvd,
      poc: null, lv: [], imb: { buy: [], sell: [] },
      book: last.book, depth: last.depth, spread: last.spread, basis: last.basis,
      complete: recorded && contiguous && minutes.length >= expected,
      ohlcvComplete: recorded && contiguous,
      closed: last.closed && last.end >= end,
      coverage: v > 0 ? weighted / v : 0,
      flags: Array.from(flags), oi, oiOpen,
    };
  });
  return { ...snapshot, interval, bars };
}

/**
 * Daily OHLC for pivots/CPR built from real futures intraday history (never from the cash index).
 * Sessions that do not start at 09:15 are dropped, and so is the window's first week unless it starts on a
 * Monday, so a weekly anchor is never computed from a truncated week.
 */
export function dailyFromIntraday(candles: readonly Candle[]): Candle[] {
  const sessions = new Map<string, Candle>();
  const opens = new Map<string, number>();
  for (const candle of candles) {
    const time = candleTime(candle);
    if (!Number.isFinite(time)) continue;
    const date = sessionDate(time);
    const day = sessions.get(date);
    if (!day) {
      opens.set(date, time);
      sessions.set(date, { t: `${date}T00:00:00+05:30`, o: candle.o, h: candle.h, l: candle.l, c: candle.c, v: candle.v });
    } else {
      day.h = Math.max(day.h, candle.h);
      day.l = Math.min(day.l, candle.l);
      day.c = candle.c;
      day.v += candle.v;
    }
  }
  const dates = Array.from(sessions.keys()).sort()
    .filter(date => opens.get(date) === Date.parse(`${date}T09:15:00+05:30`) / 1000);
  if (!dates.length) return [];
  const first = new Date(`${dates[0]}T00:00:00Z`);
  let start = dates[0];
  if (first.getUTCDay() !== 1) {
    first.setUTCDate(first.getUTCDate() + (8 - first.getUTCDay()) % 7);
    start = first.toISOString().slice(0, 10);
  }
  return dates.filter(date => date >= start).map(date => sessions.get(date)!);
}
