import type { Candle } from '@/hooks/useChartIntelligence';
import type { OrderFlowSnapshot } from './order-flow';
import { candleTime, sessionDate, isCashSession } from './chart-workspace';

export function isFreshFuturesFlow(
  snapshot: OrderFlowSnapshot | null, symbol: string, token: number | undefined,
  interval: unknown, connected: boolean, nowMs: number,
): snapshot is OrderFlowSnapshot {
  return Boolean(connected && snapshot?.available && typeof interval === 'number' &&
    snapshot.symbol === symbol && snapshot.token === token && snapshot.interval === interval &&
    snapshot.date === sessionDate(nowMs / 1000) && isCashSession(nowMs) &&
    snapshot.lastTick !== null && nowMs / 1000 - snapshot.lastTick >= -2 &&
    nowMs / 1000 - snapshot.lastTick <= 10);
}

/** Patch only fully observed same-contract session bars; never invent missing opens or volume. */
export function mergeFuturesLiveCandles(
  history: Candle[], snapshot: OrderFlowSnapshot | null, symbol: string, token: number | undefined,
  interval: unknown, connected: boolean, nowMs: number, historyUpdated = 0,
): Candle[] {
  if (!isFreshFuturesFlow(snapshot, symbol, token, interval, connected, nowMs)) return history;
  const lastTick = snapshot.lastTick;
  if (lastTick === null || lastTick * 1000 <= historyUpdated) return history;
  const sessionOpen = Date.parse(`${snapshot.date}T09:15:00+05:30`) / 1000;
  const sessionClose = sessionOpen + 375 * 60;
  const seconds = Number(interval) * 60;
  const latest = history.length ? candleTime(history[history.length - 1]) : 0;
  const eligible = snapshot.bars.filter(bar =>
    (bar.ohlcvComplete || bar.complete) && bar.t >= latest && bar.t <= lastTick &&
    bar.t >= sessionOpen && bar.t < sessionClose && (bar.t - sessionOpen) % seconds === 0 &&
    bar.end === Math.min(bar.t + seconds, sessionClose) &&
    [bar.o, bar.h, bar.l, bar.c, bar.v].every(Number.isFinite) &&
    Math.min(bar.o, bar.h, bar.l, bar.c) > 0 && bar.v >= 0 &&
    bar.h >= Math.max(bar.o, bar.c) && bar.l <= Math.min(bar.o, bar.c) && bar.h >= bar.l);
  if (!eligible.length) return history;
  const first = eligible[0].t;
  let cut = history.length;
  while (cut > 0 && candleTime(history[cut - 1]) >= first) cut--;
  const tail = history.slice(cut);
  let changed = false;
  for (const bar of eligible) {
    const at = tail.findIndex(candle => candleTime(candle) === bar.t);
    const prior = at >= 0 ? tail[at] : undefined;
    const next: Candle = {
      t: prior?.t ?? new Date(bar.t * 1000).toISOString(),
      o: prior?.o ?? bar.o, h: Math.max(prior?.h ?? bar.h, bar.h),
      l: Math.min(prior?.l ?? bar.l, bar.l), c: bar.c, v: Math.max(prior?.v ?? 0, bar.v),
    };
    if (prior && prior.o === next.o && prior.h === next.h && prior.l === next.l &&
        prior.c === next.c && prior.v === next.v) continue;
    if (at >= 0) tail[at] = next;
    else tail.push(next);
    changed = true;
  }
  return changed ? [...history.slice(0, cut), ...tail.sort((a, b) => candleTime(a) - candleTime(b))] : history;
}
