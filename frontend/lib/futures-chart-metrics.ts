import type { Candle } from '@/hooks/useChartIntelligence';
import { candleTime, sessionDate } from './chart-workspace';

export function relativeVolume(candles: Candle[], intraday: boolean, period = 20): (number | undefined)[] {
  const result: (number | undefined)[] = [];
  const window: number[] = [];
  let sum = 0;
  let session = '';
  for (const bar of candles) {
    const date = sessionDate(candleTime(bar));
    if (intraday && date !== session) { window.length = 0; sum = 0; }
    session = date;
    result.push(window.length === period && sum > 0 ? bar.v / (sum / period) : undefined);
    window.push(bar.v);
    sum += bar.v;
    if (window.length > period) sum -= window.shift()!;
  }
  return result;
}

/** -1 means a historical correction/context change needs a full setData. */
export function futuresChangedFrom(previous: Candle[], next: Candle[]): number {
  if (!previous.length || next.length < previous.length) return -1;
  const equal = (a: Candle, b: Candle) => a.t === b.t && a.o === b.o && a.h === b.h &&
    a.l === b.l && a.c === b.c && a.v === b.v;
  let index = 0;
  while (index < previous.length && equal(previous[index], next[index])) index++;
  if (index < previous.length - 1) return -1;
  if (index < previous.length && previous[index].t !== next[index].t) return -1;
  return index;
}
