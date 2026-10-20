import type { Candle } from '@/hooks/useChartIntelligence';
import { candleTime, isCashSession, sessionDate, type Timeframe } from './chart-workspace';
import type { ChartSignalLabel } from './chart-signal-labels';

export interface VwapTrade {
  id: string;
  side: 'BUY' | 'SELL';
  signalTime: number;
  entryTime?: number;
  entry: number;
  stop: number;
  target1: number;
  target2: number;
  t1Time?: number;
  exitTime?: number;
  exitPrice?: number;
  exitReason?: 'STOP' | 'BREAKEVEN' | 'TARGET 2' | 'SESSION CLOSE';
  status: 'PENDING' | 'OPEN' | 'T1 HIT' | 'CLOSED';
}
export interface VwapSignalOptions {
  nowMs: number;
  fetchedAt: number | null;
  error: boolean;
  tickSize: number;
}
export interface VwapSignalResult {
  trades: VwapTrade[];
  active: VwapTrade | null;
  labels: ChartSignalLabel[];
  reason: string;
}

/** Closed-bar replay; next-bar opens are hypothetical fills, never broker executions. */
export function calculateVwapSignals(
  candles: Candle[], timeframe: Timeframe, options: VwapSignalOptions,
): VwapSignalResult {
  const trades: VwapTrade[] = [];
  const labels: ChartSignalLabel[] = [];
  const wait = (reason: string): VwapSignalResult => ({ trades, active: null, labels, reason });
  if (typeof timeframe !== 'number') return wait('VWAP entry/exit signals are intraday only.');
  if (!Number.isFinite(options.tickSize) || options.tickSize <= 0) return wait('Contract tick size unavailable; signals disabled.');
  const tick = options.tickSize;
  const round = (value: number) => Math.round(value / tick) * tick;
  const times = candles.map(candleTime);
  let volume = 0;
  let turnover = 0;
  let session = '';
  const vwaps = candles.map((bar, index) => {
    const date = sessionDate(times[index]);
    if (date !== session) { volume = 0; turnover = 0; session = date; }
    if (!Number.isFinite(bar.v) || bar.v < 0) return undefined;
    volume += bar.v;
    turnover += (bar.h + bar.l + bar.c) / 3 * bar.v;
    return volume > 0 ? turnover / volume : undefined;
  });
  let position: VwapTrade | null = null;
  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i];
    const time = times[i];
    const date = sessionDate(time);
    const closesAt = time + timeframe * 60;
    if (closesAt * 1000 > options.nowMs) break;
    const ist = new Date((time + 19800) * 1000);
    const minute = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    if (position && sessionDate(position.signalTime) !== date) {
      if (position.status === 'PENDING') trades.pop();
      else {
        position.status = 'CLOSED';
        position.exitTime = times[i - 1];
        position.exitPrice = round(candles[i - 1].c);
        position.exitReason = 'SESSION CLOSE';
      }
      position = null;
    }
    if (position) {
      const dir = position.side === 'BUY' ? 1 : -1;
      if (position.status === 'PENDING') {
        // A gap through the structural stop invalidates the setup, rather than inventing a fill.
        if (dir * (bar.o - position.stop) <= 0) {
          trades.pop(); position = null; continue;
        }
        position.entry = round(bar.o);
        position.entryTime = time;
        const risk = dir * (position.entry - position.stop);
        position.target1 = round(position.entry + dir * risk);
        position.target2 = round(position.entry + dir * 2 * risk);
        position.status = 'OPEN';
      }
      const stop = position.t1Time === undefined ? position.stop : position.entry;
      const stopHit = dir === 1 ? bar.l <= stop : bar.h >= stop;
      const t1Hit = dir === 1 ? bar.h >= position.target1 : bar.l <= position.target1;
      const t2Hit = dir === 1 ? bar.h >= position.target2 : bar.l <= position.target2;
      if (stopHit) {
        const gapPrice = dir === 1 ? Math.min(bar.o, stop) : Math.max(bar.o, stop);
        position.exitPrice = round(gapPrice);
        position.exitReason = position.t1Time === undefined ? 'STOP' : 'BREAKEVEN';
      } else if (t2Hit) {
        position.t1Time ??= time;
        position.exitPrice = position.target2;
        position.exitReason = 'TARGET 2';
      } else if (t1Hit && position.t1Time === undefined) {
        position.t1Time = time;
        position.status = 'T1 HIT';
      }
      if (minute + timeframe >= 930 && position.exitPrice === undefined) {
        position.exitPrice = round(bar.c);
        position.exitReason = 'SESSION CLOSE';
      }
      if (position.exitPrice !== undefined) {
        position.exitTime = time;
        position.status = 'CLOSED';
        position = null;
      }
      continue;
    }
    if (i < 5 || minute < 555 || minute + timeframe >= 910 || ist.getUTCDay() === 0 || ist.getUTCDay() === 6) continue;
    const previous = candles[i - 1];
    const vwap = vwaps[i];
    const priorVwap = vwaps[i - 1];
    const prior = candles.slice(i - 5, i);
    if (vwap === undefined || priorVwap === undefined || prior.some((item, offset) =>
      item.v <= 0 || sessionDate(times[i - 5 + offset]) !== date)) continue;
    const averageVolume = prior.reduce((sum, item) => sum + item.v, 0) / prior.length;
    if (bar.v <= 0 || bar.v < averageVolume || bar.h <= bar.l) continue;
    const crossedUp = previous.c <= priorVwap;
    const crossedDown = previous.c >= priorVwap;
    const supportBounce = previous.c > priorVwap && bar.o > priorVwap &&
      bar.l <= priorVwap && bar.l <= vwap && bar.c > priorVwap;
    const resistanceRejection = previous.c < priorVwap && bar.o < priorVwap &&
      bar.h >= priorVwap && bar.h >= vwap && bar.c < priorVwap;
    const buy = (crossedUp || supportBounce) && bar.c > vwap && bar.c > bar.o && bar.c >= (bar.h + bar.l) / 2;
    const sell = (crossedDown || resistanceRejection) && bar.c < vwap && bar.c < bar.o && bar.c <= (bar.h + bar.l) / 2;
    if (!buy && !sell) continue;
    const dir = buy ? 1 : -1;
    const swing = candles.slice(i - 2, i + 1);
    const stop = round(buy ? Math.min(...swing.map(item => item.l)) - tick : Math.max(...swing.map(item => item.h)) + tick);
    const entry = round(bar.c);
    const risk = dir * (entry - stop);
    if (risk < tick * 2) continue;
    position = {
      id: `${time}:${buy ? 'BUY' : 'SELL'}`, side: buy ? 'BUY' : 'SELL', signalTime: time,
      entry, stop, target1: round(entry + dir * risk), target2: round(entry + dir * 2 * risk), status: 'PENDING',
    };
    trades.push(position);
  }
  const exact = (value: number) => value.toLocaleString('en-IN', { maximumFractionDigits: 4 });
  for (const trade of trades) {
    labels.push({
      id: trade.id, time: trade.entryTime ?? trade.signalTime, price: trade.entry, kind: trade.side,
      text: `${trade.status === 'PENDING' ? 'SETUP ' : ''}${trade.side} ${exact(trade.entry)}`,
      placement: trade.side === 'BUY' ? 'below' : 'above', early: trade.status === 'PENDING',
    });
    if (trade.t1Time !== undefined) labels.push({
      id: `${trade.id}:t1`, time: trade.t1Time, price: trade.target1, kind: 'EXIT',
      text: `T1 50% ${exact(trade.target1)}`, placement: trade.side === 'BUY' ? 'above' : 'below',
    });
    if (trade.exitTime !== undefined && trade.exitPrice !== undefined) labels.push({
      id: `${trade.id}:exit`, time: trade.exitTime, price: trade.exitPrice, kind: 'EXIT',
      text: `EXIT ${exact(trade.exitPrice)} ${trade.exitReason}`, placement: trade.side === 'BUY' ? 'above' : 'below',
    });
  }
  if (options.error) return wait('Data request failed; current guidance disabled. Labels are historical replay.');
  const age = options.fetchedAt === null ? Infinity : options.nowMs - options.fetchedAt;
  if (age < 0 || age > 45_000) return wait('Data refresh is stale; current guidance disabled. Labels are historical replay.');
  if (!isCashSession(options.nowMs)) return wait('Outside the weekday 09:15–15:30 IST session. Historical replay only.');
  const latestTime = times.at(-1);
  if (latestTime === undefined || latestTime * 1000 > options.nowMs ||
      options.nowMs - (latestTime + timeframe * 60) * 1000 > 45_000 ||
      sessionDate(latestTime) !== sessionDate(options.nowMs / 1000)) {
    return wait('Latest contract candle is delayed; current guidance disabled.');
  }
  return { trades, active: position, labels, reason: position
    ? position.status === 'PENDING' ? 'Closed-candle setup: next-bar entry is indicative, not an executed order.'
      : 'Replay position only; broker fills and intrabar exits are not verified.'
    : 'WAIT: no volume-confirmed VWAP cross, support bounce or resistance rejection on a closed candle.' };
}
