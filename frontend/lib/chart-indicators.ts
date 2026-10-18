import type { Candle } from '@/hooks/useChartIntelligence';
import { candleTime, sessionDate, type IndicatorSettings, type Timeframe } from './chart-workspace';

export interface IndicatorSample { time: number; value?: number; color?: string }
export type IndicatorSeries = Record<string, IndicatorSample[]>;
export interface IndicatorCalculation {
  series: IndicatorSeries;
  changedFrom: number;
  rebuilt: boolean;
  processedBars: number;
}

export function indicatorLineTitle(id: string): string {
  const ema = /^ema(\d+)$/.exec(id);
  if (ema) return `EMA ${ema[1]}`;
  const [family, level] = id.split(':');
  if (level) {
    const prefix = family === 'traditional' ? 'Pivot' : family === 'camarilla' ? 'Cam' : family === 'cpr' ? 'CPR' : family;
    return `${prefix} ${level}`;
  }
  const names: Record<string, string> = {
    vwap: 'VWAP', supertrendUp: 'ST 10/2 UP', supertrendDown: 'ST 10/2 DOWN',
    rsi: 'RSI 14', macd: 'MACD 12/26', signal: 'Signal 9', histogram: 'MACD Hist',
    atr: 'ATR 14', volume: 'Volume',
  };
  return names[id] ?? id;
}

const sameCandle = (a: Candle, b: Candle) => a.t === b.t && a.o === b.o &&
  a.h === b.h && a.l === b.l && a.c === b.c && a.v === b.v;

// Lightweight Charts v4 connects whitespace gaps; transparent segments prevent false trend bridges.
export function segmentedLine(values: IndicatorSample[], color: string): IndicatorSample[] {
  let lastValue: number | undefined;
  return values.map((point, index) => {
    if (point.value !== undefined) lastValue = point.value;
    if (lastValue === undefined) return point;
    return { time: point.time, value: lastValue,
      color: point.value === undefined || index + 1 < values.length && values[index + 1].value === undefined ? 'transparent' : color };
  });
}

/** Snapshots let a forming candle be replaced without accumulating it twice. */
export function createIndicatorEngine() {
  let previous: Candle[] = [];
  let signature = '';
  let frames: Record<string, number>[] = [];
  let series: IndicatorSeries = {};
  let lastInput: Candle[] | null = null;
  let lastResult: IndicatorCalculation | null = null;
  return {
    calculate(candles: Candle[], settings: IndicatorSettings, intraday: boolean): IndicatorCalculation {
      const nextSignature = JSON.stringify([settings, intraday]);
      if (lastInput === candles && signature === nextSignature && lastResult) return lastResult;
      const reset = signature !== nextSignature;
      let start = 0;
      if (!reset) {
        while (start < candles.length && start < previous.length && sameCandle(candles[start], previous[start])) start++;
      }
      const rebuilt = reset || start < Math.max(0, previous.length - 1) || candles.length < previous.length;
      if (reset) { series = {}; frames = []; }
      signature = nextSignature;
      const periods = new Set<number>();
      for (const period of [9, 20, 50, 100, 200] as const) if (settings[`ema${period}`]) periods.add(period);
      if (settings.emaCross) { periods.add(13); periods.add(21); }
      if (settings.macd) { periods.add(12); periods.add(26); }
      const keys = [
        ...Array.from(periods).map(period => `ema${period}`),
        ...(settings.supertrend ? ['supertrendUp', 'supertrendDown'] : []),
        ...(settings.vwap && intraday ? ['vwap'] : []),
        ...(settings.rsi ? ['rsi'] : []),
        ...(settings.atr ? ['atr'] : []),
        ...(settings.macd ? ['macd', 'signal', 'histogram'] : []),
      ];
      for (const key of keys) {
        if (!series[key]) series[key] = [];
        series[key].length = start;
      }
      frames.length = start;
      for (let i = start; i < candles.length; i++) {
        const candle = candles[i];
        const time = candleTime(candle);
        const old = frames[i - 1] ?? {};
        const state = { ...old };
        for (const key of keys) series[key].push({ time });
        const emit = (key: string, value: number) => { series[key][i] = { time, value }; };
        for (const period of Array.from(periods)) {
          const key = `ema${period}`;
          const sum = (old[`${key}Sum`] ?? 0) + candle.c;
          state[`${key}Sum`] = i < period ? sum : old[`${key}Sum`];
          if (i >= period - 1) {
            state[key] = i === period - 1 ? sum / period : candle.c * 2 / (period + 1) + old[key] * (1 - 2 / (period + 1));
            emit(key, state[key]);
          }
        }
        if (settings.rsi && i > 0) {
          const delta = candle.c - candles[i - 1].c;
          state.gain = i <= 14 ? (old.gain ?? 0) + Math.max(0, delta) / 14 : (old.gain * 13 + Math.max(0, delta)) / 14;
          state.loss = i <= 14 ? (old.loss ?? 0) + Math.max(0, -delta) / 14 : (old.loss * 13 + Math.max(0, -delta)) / 14;
          if (i >= 14) emit('rsi', state.loss === 0 ? state.gain === 0 ? 50 : 100 : 100 - 100 / (1 + state.gain / state.loss));
        }
        if (settings.macd && i >= 25) {
          const value = state.ema12 - state.ema26;
          emit('macd', value);
          state.signal = i < 34 ? (old.signal ?? 0) + value / 9 : value * .2 + old.signal * .8;
          if (i >= 33) {
            emit('signal', state.signal);
            emit('histogram', value - state.signal);
          }
        }
        if (settings.vwap && intraday) {
          const newSession = i === 0 || sessionDate(time) !== sessionDate(candleTime(candles[i - 1]));
          state.volume = (newSession ? 0 : old.volume) + candle.v;
          state.turnover = (newSession ? 0 : old.turnover) + (candle.h + candle.l + candle.c) / 3 * candle.v;
          if (state.volume > 0) emit('vwap', state.turnover / state.volume);
        }
        if (settings.supertrend || settings.atr) {
          const previousClose = i > 0 ? candles[i - 1].c : candle.c;
          const tr = Math.max(candle.h - candle.l, Math.abs(candle.h - previousClose), Math.abs(candle.l - previousClose));
          state.trSum = (old.trSum ?? 0) + tr;
          if (settings.atr && i >= 13) {
            state.atr14 = i === 13 ? state.trSum / 14 : (old.atr14 * 13 + tr) / 14;
            emit('atr', state.atr14);
          }
          if (settings.supertrend && i >= 9) {
            state.atr = i === 9 ? state.trSum / 10 : (old.atr * 9 + tr) / 10;
            const upper = (candle.h + candle.l) / 2 + 2 * state.atr;
            const lower = (candle.h + candle.l) / 2 - 2 * state.atr;
            state.upper = i === 9 || upper < old.upper || previousClose > old.upper ? upper : old.upper;
            state.lower = i === 9 || lower > old.lower || previousClose < old.lower ? lower : old.lower;
            state.up = i === 9 ? 0 : old.up === 0 ? Number(candle.c > state.upper) : Number(candle.c >= state.lower);
            emit(state.up ? 'supertrendUp' : 'supertrendDown', state.up ? state.lower : state.upper);
          }
        }
        frames.push(state);
      }
      previous = candles.slice();
      lastInput = candles;
      lastResult = { series, changedFrom: start, rebuilt, processedBars: candles.length - start };
      return lastResult;
    },
  };
}

export type PivotAnchor = 'D' | 'W' | 'M' | 'Y';
export function autoPivotAnchor(timeframe: Timeframe): PivotAnchor {
  return typeof timeframe === 'number' ? timeframe <= 15 ? 'D' : 'W' : timeframe === 'D' ? 'M' : 'Y';
}

function periodKey(date: string, anchor: PivotAnchor): string {
  if (anchor === 'D') return date;
  if (anchor === 'M') return date.slice(0, 7);
  if (anchor === 'Y') return date.slice(0, 4);
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}

export function pivotValues(high: number, low: number, close: number) {
  const p = (high + low + close) / 3;
  const range = high - low;
  const bc = (high + low) / 2;
  return {
    traditional: {
      P: p, R1: 2 * p - low, S1: 2 * p - high,
      R2: p + range, S2: p - range,
      R3: 2 * p + high - 2 * low, S3: 2 * p - 2 * high + low,
      R4: 3 * p + high - 3 * low, S4: 3 * p - 3 * high + low,
      R5: 4 * p + high - 4 * low, S5: 4 * p - 4 * high + low,
    },
    camarilla: {
      P: p,
      R1: close + range * 1.1 / 12, S1: close - range * 1.1 / 12,
      R2: close + range * 1.1 / 6, S2: close - range * 1.1 / 6,
      R3: close + range * 1.1 / 4, S3: close - range * 1.1 / 4,
      R4: close + range * 1.1 / 2, S4: close - range * 1.1 / 2,
      R5: high / low * close, S5: 2 * close - high / low * close,
    },
    cpr: { TC: Math.max(bc, 2 * p - bc), P: p, BC: Math.min(bc, 2 * p - bc) },
  };
}

export function calculatePivotSeries(candles: Candle[], daily: Candle[], timeframe: Timeframe, settings: IndicatorSettings): IndicatorSeries {
  if (!settings.pivots && !settings.camarilla && !settings.cpr) return {};
  const times = candles.map(candleTime);
  const dates = times.map(sessionDate);
  const auto = autoPivotAnchor(timeframe);
  const anchors = new Map<PivotAnchor, string[]>();
  for (const anchor of [auto, 'D'] as PivotAnchor[]) {
    if (!anchors.has(anchor)) anchors.set(anchor, dates.map(date => periodKey(date, anchor)));
  }
  const grouped = new Map<PivotAnchor, [string, { high: number; low: number; close: number }][]>();
  const groups = (anchor: PivotAnchor) => {
    const cached = grouped.get(anchor);
    if (cached) return cached;
    const result = new Map<string, { high: number; low: number; close: number }>();
    for (const candle of daily) {
      const key = periodKey(sessionDate(candleTime(candle)), anchor);
      const previous = result.get(key);
      result.set(key, {
        high: Math.max(previous?.high ?? candle.h, candle.h),
        low: Math.min(previous?.low ?? candle.l, candle.l),
        close: candle.c,
      });
    }
    const sorted = Array.from(result.entries()).sort(([a], [b]) => a.localeCompare(b));
    grouped.set(anchor, sorted);
    return sorted;
  };
  const output: IndicatorSeries = {};
  const kinds = [
    { id: 'traditional', enabled: settings.pivots, anchor: auto },
    { id: 'camarilla', enabled: settings.camarilla, anchor: auto },
    { id: 'cpr', enabled: settings.cpr && typeof timeframe === 'number', anchor: 'D' as PivotAnchor },
  ] as const;
  for (const kind of kinds) {
    if (!kind.enabled) continue;
    const source = groups(kind.anchor);
    const keys = anchors.get(kind.anchor)!;
    const chartPeriods = Array.from(new Set(keys));
    const retained = new Set(chartPeriods.slice(-15));
    const levelsByPeriod = new Map<string, Record<string, number>>();
    let cursor = 0;
    for (const key of chartPeriods) {
      while (cursor < source.length && source[cursor][0] < key) cursor++;
      const prior = source[cursor - 1]?.[1];
      if (prior && retained.has(key)) {
        levelsByPeriod.set(key, pivotValues(prior.high, prior.low, prior.close)[kind.id]);
      }
    }
    const first = levelsByPeriod.values().next().value;
    if (!first) continue;
    for (const name of Object.keys(first)) {
      output[`${kind.id}:${name}`] = times.map((time, index) => {
        const value = levelsByPeriod.get(keys[index])?.[name];
        return value === undefined ? { time } : { time, value };
      });
    }
  }
  return output;
}

/** Price changes cannot change pivots within the same session. */
export function createPivotEngine() {
  let previous: Candle[] = [];
  let previousDaily: Candle[] | null = null;
  let signature = '';
  let series: IndicatorSeries = {};
  return {
    calculate(candles: Candle[], daily: Candle[], timeframe: Timeframe, settings: IndicatorSettings): IndicatorSeries {
      const nextSignature = JSON.stringify([timeframe, settings.pivots, settings.camarilla, settings.cpr]);
      const samePrefix = previousDaily === daily && signature === nextSignature &&
        candles.length >= previous.length && previous.every((bar, index) => bar.t === candles[index].t);
      const sameSession = previous.length > 0 && candles.length > 0 &&
        sessionDate(candleTime(previous[previous.length - 1])) === sessionDate(candleTime(candles[candles.length - 1]));
      if (samePrefix && sameSession) {
        for (let index = previous.length; index < candles.length; index++) {
          const time = candleTime(candles[index]);
          for (const values of Object.values(series)) {
            const value = values[values.length - 1]?.value;
            values.push(value === undefined ? { time } : { time, value });
          }
        }
      } else {
        series = calculatePivotSeries(candles, daily, timeframe, settings);
      }
      previous = candles;
      previousDaily = daily;
      signature = nextSignature;
      return series;
    },
  };
}
