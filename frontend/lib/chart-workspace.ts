import type { Candle, SymbolChartData } from '@/hooks/useChartIntelligence';
import type { FIIDIISnapshot } from '@/hooks/useFIIDIIFlow';

export type ChartSymbol = 'NIFTY' | 'BANKNIFTY' | 'SENSEX';
export type Timeframe = 3 | 5 | 15 | 30 | 60 | 'D' | 'W' | 'M';
export function timeframeLabel(timeframe: Timeframe): string {
  return typeof timeframe === 'number' ? timeframe === 60 ? '1h' : `${timeframe}m` : `1${timeframe}`;
}
export type Indicator = 'ema9' | 'ema20' | 'ema50' | 'ema100' | 'ema200' | 'supertrend' | 'emaCross' | 'camarilla' | 'volume' | 'vwap' | 'pivots' | 'cpr' | 'rsi' | 'macd' | 'atr';
export type IndicatorSettings = Record<Indicator, boolean>;
export interface ChartPoint { time: number; value: number }
export interface PriceZone { low: number; high: number; center: number }
export interface TradePlan {
  direction: 'BUY' | 'SELL' | 'WAIT';
  score: number;
  requiredScore: number;
  confirmation: string[];
  watchReason: string;
  entry?: number;
  stopLoss?: number;
  targets?: [number, number, number];
  entryZone?: PriceZone;
  support?: PriceZone;
  resistance?: PriceZone;
  invalidation?: string;
  candleTime?: number;
  riskPoints?: number;
  conditional?: boolean;
  exitPrice?: number;
  volumeVerified?: boolean;
  basis?: string;
}

export type TradeOverlayMode = 'live' | 'confirmed' | 'conditional';

export function selectTradeOverlay(confirmed: TradePlan, watch: TradePlan, mode: TradeOverlayMode): TradePlan {
  if (mode === 'conditional') return watch;
  if (mode === 'confirmed' || confirmed.direction !== 'WAIT' || watch.direction === 'WAIT') return confirmed;
  return {
    ...watch,
    watchReason: `NO TRADE confirmed. ${confirmed.watchReason} ${watch.watchReason}`,
  };
}

export function institutionalContext(snapshot: FIIDIISnapshot | null, nowMs: number) {
  const fii = snapshot?.fii;
  const dii = snapshot?.dii;
  const reportDate = (value: string | undefined) => {
    if (!value) return '';
    const match = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(value);
    const month = match ? ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(match[2].toLowerCase()) + 1 : 0;
    const date = match && month ? `${match[3]}-${String(month).padStart(2, '0')}-${match[1]}` : value;
    const parsed = Date.parse(`${date}T00:00:00Z`);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(parsed) &&
      new Date(parsed).toISOString().slice(0, 10) === date ? date : '';
  };
  const date = reportDate(fii?.date);
  const today = sessionDate(Math.floor(nowMs / 1000));
  const age = Date.parse(today) - Date.parse(date);
  const fetched = Date.parse(snapshot?.fetchedAt ?? '');
  const available = snapshot?.success && fii && dii &&
    typeof snapshot.source === 'string' && snapshot.source.trim().length > 0 &&
    Number.isFinite(fii.netValueCr) && Number.isFinite(dii.netValueCr) &&
    date && date === reportDate(dii.date) && age >= 0 && age <= 7 * 86400_000 &&
    Number.isFinite(fetched) && fetched <= nowMs && nowMs - fetched <= 30 * 60_000 &&
    snapshot.staleness !== 'stale';
  if (!available) return { available: false as const, label: 'FII/DII unavailable or stale' };
  return {
    available: true as const, label: `Reported cash flow · ${date}`, source: snapshot.source,
    fii: fii.netValueCr, dii: dii.netValueCr,
    bias: fii.netValueCr > 0 && dii.netValueCr > 0 ? 'Both net buying' :
      fii.netValueCr < 0 && dii.netValueCr < 0 ? 'Both net selling' : 'Mixed participation',
  };
}

export const INDICATORS: { id: Indicator; label: string; color: string; group: string }[] = [
  { id: 'ema9', label: 'EMA 9 close 0', color: '#00cbb8', group: 'Trend & Moving Averages' },
  { id: 'ema20', label: 'EMA 20 close 0', color: '#008cff', group: 'Trend & Moving Averages' },
  { id: 'ema50', label: 'EMA 50 close 0', color: '#00bcd4', group: 'Trend & Moving Averages' },
  { id: 'ema100', label: 'EMA 100 close 0', color: '#ab47db', group: 'Trend & Moving Averages' },
  { id: 'ema200', label: 'EMA 200', color: '#ed277b', group: 'Trend & Moving Averages' },
  { id: 'supertrend', label: 'Supertrend 10 2', color: '#00bba5', group: 'Trend & Moving Averages' },
  { id: 'volume', label: 'Volume (Bars)', color: '#00b9a4', group: 'Volume & Price' },
  { id: 'vwap', label: 'VWAP hlc3 Session', color: '#ffc45c', group: 'Volume & Price' },
  { id: 'camarilla', label: 'Pivots Camarilla Auto 15', color: '#e9b85d', group: 'Pivots & CPR' },
  { id: 'cpr', label: 'CPR (TC, Pivot, BC)', color: '#ef355c', group: 'Pivots & CPR' },
  { id: 'rsi', label: 'RSI (14)', color: '#c05bea', group: 'Momentum' },
  { id: 'atr', label: 'ATR (14)', color: '#cc6979', group: 'Momentum' },
];

export const DEFAULT_INDICATORS: IndicatorSettings = {
  ema9: true, ema20: true, ema50: true, ema100: true, ema200: true,
  supertrend: true, emaCross: false, camarilla: true,
  volume: true, vwap: true, pivots: false, cpr: true, rsi: true, macd: false, atr: true,
};

export const TEMPLATES: Record<string, IndicatorSettings> = {
  'Intraday Default': DEFAULT_INDICATORS,
  'Confluence focus': { ...DEFAULT_INDICATORS, pivots: false, macd: false },
  'Image Layout': { ...DEFAULT_INDICATORS, pivots: false, volume: false, macd: false },
  Scalping: { ...DEFAULT_INDICATORS, ema50: false, pivots: false, cpr: false, macd: false },
  Breakout: { ...DEFAULT_INDICATORS, ema9: false, ema20: false, macd: false },
  'Trend Following': { ...DEFAULT_INDICATORS, ema100: true, ema200: true, pivots: false, cpr: false },
  'Clean Chart': Object.fromEntries(INDICATORS.map(({ id }) => [id, false])) as IndicatorSettings,
};

export function sessionDate(time: number): string {
  return new Date((time + 19800) * 1000).toISOString().slice(0, 10);
}

export function isCashSession(nowMs: number): boolean {
  const ist = new Date(nowMs + 19_800_000);
  const minute = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return ist.getUTCDay() > 0 && ist.getUTCDay() < 6 && minute >= 555 && minute < 930;
}

// Today's bars stay merged even if the feed briefly reports CACHED or goes quiet;
// toggling them on/off changes the bar count and makes the chart jump sideways.
export function stableLiveSession(live: Candle[], nowMs: number): string | null {
  const last = live.at(-1);
  if (!last) return null;
  const today = sessionDate(Math.floor(nowMs / 1000));
  return sessionDate(candleTime(last)) === today ? today : null;
}

export function candleTime(candle: Candle): number {
  // The service normally sends offsets; naive exchange timestamps are IST.
  const timestamp = /(?:Z|[+-]\d{2}:\d{2})$/i.test(candle.t) ? candle.t : `${candle.t}+05:30`;
  return Date.parse(timestamp) / 1000;
}

export function workspaceCandles(data: SymbolChartData | null, timeframe: Timeframe): Candle[] {
  if (typeof timeframe !== 'number') return [];
  const source = timeframe === 3 ? data?.candles3m : data?.candles5m;
  const sorted = new Map<number, Candle>();
  for (const candle of source ?? []) {
    const time = candleTime(candle);
    if (!Number.isFinite(time) || ![candle.o, candle.h, candle.l, candle.c, candle.v].every(Number.isFinite) ||
        candle.l <= 0 || candle.h < Math.max(candle.o, candle.c) || candle.l > Math.min(candle.o, candle.c) || candle.v < 0) continue;
    sorted.set(time, candle);
  }
  const candles = Array.from(sorted.entries()).sort(([a], [b]) => a - b);
  if (timeframe <= 5) return candles.map(([, candle]) => candle);
  const buckets = new Map<number, Candle>();
  for (const [time, candle] of candles) {
    const day = Math.floor((time + 19800) / 86400) * 86400 - 19800;
    const open = day + (9 * 60 + 15) * 60;
    const bucket = open + Math.floor((time - open) / (timeframe * 60)) * timeframe * 60;
    const existing = buckets.get(bucket);
    if (existing) {
      existing.h = Math.max(existing.h, candle.h);
      existing.l = Math.min(existing.l, candle.l);
      existing.c = candle.c;
      existing.v += candle.v;
    } else {
      buckets.set(bucket, { ...candle, t: new Date(bucket * 1000).toISOString() });
    }
  }
  return Array.from(buckets.values());
}

export function mergeChartHistory(history: Candle[], live: Candle[], liveSession: string | null): Candle[] {
  const merged = new Map<number, Candle>();
  for (const candle of history) merged.set(candleTime(candle), candle);
  for (const candle of live) {
    const time = candleTime(candle);
    if (history.length && sessionDate(time) !== liveSession) continue;
    // The legacy stream injects futures volume into index candles. Do not mix it
    // with cash-index history; only the current live session overrides REST bars.
    if (!merged.has(time) || sessionDate(time) === liveSession) {
      merged.set(time, { ...candle, v: 0 });
    }
  }
  return Array.from(merged.entries()).sort(([a], [b]) => a - b).map(([, candle]) => candle);
}

export function updatePeriodCandle(history: Candle[], today: Candle[], timeframe: 'D' | 'W' | 'M'): Candle[] {
  const first = today[0];
  const last = today.at(-1);
  if (!first || !last) return history;
  const date = sessionDate(candleTime(last));
  const day = new Date(`${date}T00:00:00Z`);
  if (timeframe === 'W') day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  if (timeframe === 'M') day.setUTCDate(1);
  const period = day.toISOString().slice(0, 10);
  const timestamp = Date.parse(`${period}T00:00:00+05:30`) / 1000;
  const existing = history.find(candle => candleTime(candle) === timestamp);
  // Do not infer a whole week's/month's open from a single intraday session.
  if (!existing && timeframe !== 'D' && period !== date) return history;
  const openingMinute = new Date((candleTime(first) + 19800) * 1000).toISOString().slice(11, 16);
  if (!existing && openingMinute !== '09:15') return history;
  const high = Math.max(...today.map(candle => candle.h));
  const low = Math.min(...today.map(candle => candle.l));
  const bar: Candle = {
    t: new Date(timestamp * 1000).toISOString(),
    o: existing?.o ?? first.o,
    h: Math.max(existing?.h ?? high, high),
    l: Math.min(existing?.l ?? low, low),
    c: last.c,
    v: existing?.v ?? 0,
  };
  const merged = new Map(history.map(candle => [candleTime(candle), candle]));
  merged.set(timestamp, bar);
  return Array.from(merged.entries()).sort(([a], [b]) => a - b).map(([, candle]) => candle);
}

export function ema(candles: Candle[], period: number): ChartPoint[] {
  let sum = 0;
  let value = 0;
  return candles.flatMap((candle, index) => {
    sum += candle.c;
    if (index < period - 1) return [];
    value = index === period - 1 ? sum / period : candle.c * (2 / (period + 1)) + value * (1 - 2 / (period + 1));
    return [{ time: candleTime(candle), value }];
  });
}

export function rsi(candles: Candle[], period = 14): ChartPoint[] {
  let gain = 0;
  let loss = 0;
  const result: ChartPoint[] = [];
  for (let i = 1; i < candles.length; i++) {
    const delta = candles[i].c - candles[i - 1].c;
    if (i <= period) {
      gain += Math.max(delta, 0) / period;
      loss += Math.max(-delta, 0) / period;
    } else {
      gain = (gain * (period - 1) + Math.max(delta, 0)) / period;
      loss = (loss * (period - 1) + Math.max(-delta, 0)) / period;
    }
    if (i >= period) result.push({
      time: candleTime(candles[i]),
      value: loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss),
    });
  }
  return result;
}

export function macd(candles: Candle[]) {
  const fast = new Map(ema(candles, 12).map(point => [point.time, point.value]));
  const line = ema(candles, 26).map(point => ({ ...point, value: fast.get(point.time)! - point.value }));
  let signal = 0;
  const signalLine: ChartPoint[] = [];
  for (let i = 0; i < line.length; i++) {
    if (i < 9) signal += line[i].value / 9;
    else signal = line[i].value * 0.2 + signal * 0.8;
    if (i >= 8) signalLine.push({ time: line[i].time, value: signal });
  }
  const values = new Map(line.map(point => [point.time, point.value]));
  return { line, signal: signalLine, histogram: signalLine.map(point => ({ ...point, value: values.get(point.time)! - point.value })) };
}

export function vwap(candles: Candle[]): ChartPoint[] {
  let date = '';
  let value = 0;
  let volume = 0;
  return candles.flatMap(candle => {
    const time = candleTime(candle);
    const nextDate = sessionDate(time);
    if (date !== nextDate) { date = nextDate; value = 0; volume = 0; }
    value += (candle.h + candle.l + candle.c) / 3 * candle.v;
    volume += candle.v;
    return volume > 0 ? [{ time, value: value / volume }] : [];
  });
}

export function dailyLevels(data: SymbolChartData | null, candles: Candle[]) {
  const last = candles[candles.length - 1];
  if (!last) return null;
  const date = sessionDate(candleTime(last));
  const previous = (data ? workspaceCandles(data, 5) : candles).filter(c => sessionDate(candleTime(c)) < date);
  const previousDate = previous.length ? sessionDate(candleTime(previous[previous.length - 1])) : '';
  const session = previous.filter(c => sessionDate(candleTime(c)) === previousDate);
  const supplied = data?.levels.previousSession;
  const previousSession = supplied && supplied.date < date ? supplied : session.length ? {
    high: Math.max(...session.map(candle => candle.h)),
    low: Math.min(...session.map(candle => candle.l)),
    close: session[session.length - 1].c,
  } : null;
  // Never substitute today's close or synthetic PDH/PDL for previous-session OHLC.
  if (!previousSession) return null;
  const { high: h, low: l, close } = previousSession;
  if (![h, l, close].every(Number.isFinite) || !(h >= close && close >= l && l > 0)) return null;
  const pivot = (h + l + close) / 3;
  const bc = (h + l) / 2;
  const tc = 2 * pivot - bc;
  return { P: pivot, R1: 2 * pivot - l, R2: pivot + h - l, S1: 2 * pivot - h, S2: pivot - h + l, TC: Math.max(tc, bc), BC: Math.min(tc, bc) };
}

function nearestZone(values: Array<number | undefined>, spot: number, atr: number, direction: 'below' | 'above'): PriceZone | undefined {
  const candidates = values.filter((value): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 && (direction === 'below' ? value < spot : value > spot));
  const center = direction === 'below' ? Math.max(...candidates) : Math.min(...candidates);
  if (!Number.isFinite(center)) return undefined;
  const halfWidth = Math.max(atr * 0.12, center * 0.00015);
  return { center, low: center - halfWidth, high: center + halfWidth };
}

export function deriveConditionalTradePlan(
  candles: Candle[],
  timeframe: Timeframe,
  options: { live: boolean; nowMs: number; dailyCandles: Candle[]; latestPrice?: number },
): TradePlan {
  const waiting = (watchReason: string): TradePlan => ({
    direction: 'WAIT', score: 0, requiredScore: 3, confirmation: [], conditional: true, watchReason,
  });
  if (typeof timeframe !== 'number') return waiting('Advance intraday levels are disabled on daily, weekly and monthly charts.');
  if (!options.live || !isCashSession(options.nowMs)) return waiting('No advance levels: fresh live cash-session data is required.');
  if (options.latestPrice !== undefined && !(Number.isFinite(options.latestPrice) && options.latestPrice > 0)) {
    return waiting('No advance levels: the latest market price is invalid.');
  }
  const duration = timeframe * 60_000;
  const recent = candles.slice(-251);
  const closed = recent.filter(bar => candleTime(bar) * 1000 + duration <= options.nowMs);
  const last = closed.at(-1);
  if (!last || closed.length < 50) return waiting('No advance levels: at least 50 completed candles are required.');
  const lastTime = candleTime(last);
  const today = sessionDate(options.nowMs / 1000);
  if (sessionDate(lastTime) !== today || options.nowMs - (lastTime * 1000 + duration) >= duration) {
    return waiting('No advance levels: waiting for a fresh completed candle from this session.');
  }
  const e9 = ema(closed, 9).at(-1)?.value;
  const e20 = ema(closed, 20).at(-1)?.value;
  const e50 = ema(closed, 50).at(-1)?.value;
  if (e9 === undefined || e20 === undefined || e50 === undefined) return waiting('No advance levels: trend warm-up is incomplete.');
  const previous = closed.at(-2)!;
  const buy = e9 > e20 && e20 > e50 && last.c > last.o && last.l > previous.l && last.c > e9;
  const sell = e9 < e20 && e20 < e50 && last.c < last.o && last.h < previous.h && last.c < e9;
  if (!buy && !sell) return waiting('No advance levels: trend, candle direction and swing structure do not align.');
  const ranges = closed.slice(-14).map((bar, index) => {
    const previousClose = closed[closed.length - 15 + index].c;
    return Math.max(bar.h - bar.l, Math.abs(bar.h - previousClose), Math.abs(bar.l - previousClose));
  });
  const atr = ranges.reduce((sum, value) => sum + value, 0) / 14;
  if (!(atr > 0 && Number.isFinite(atr))) return waiting('No advance levels: valid candle volatility is required.');
  const roundUp = (value: number) => Math.ceil(value * 20 - 1e-8) / 20;
  const roundDown = (value: number) => Math.floor(value * 20 + 1e-8) / 20;
  const breakout = closed.slice(-5);
  const swing = closed.slice(-3);
  const buffer = Math.max(0.05, atr * 0.1);
  const entry = buy ? roundUp(Math.max(...breakout.map(bar => bar.h)) + buffer)
    : roundDown(Math.min(...breakout.map(bar => bar.l)) - buffer);
  const stopLoss = buy ? roundDown(Math.min(...swing.map(bar => bar.l)) - buffer)
    : roundUp(Math.max(...swing.map(bar => bar.h)) + buffer);
  const risk = buy ? entry - stopLoss : stopLoss - entry;
  if (!(stopLoss > 0 && entry > 0 && risk > 0 && risk <= atr * 2.5)) {
    return waiting('No advance levels: structural risk exceeds the 2.5 ATR limit.');
  }
  // Daily context is official completed OHLC, never today's forming bar.
  const daily = options.dailyCandles.filter(bar => sessionDate(candleTime(bar)) < today).slice(-20);
  const barriers = daily.flatMap(bar => [bar.h, bar.l]).filter(value =>
    Number.isFinite(value) && (buy ? value > entry : value < entry));
  const obstacle = buy ? Math.min(...barriers) : Math.max(...barriers);
  const rawExit = buy ? Math.min(entry + 2 * risk, obstacle - 0.05)
    : Math.max(entry - 2 * risk, obstacle + 0.05);
  const exitPrice = buy ? roundDown(rawExit) : roundUp(rawExit);
  const reward = buy ? exitPrice - entry : entry - exitPrice;
  if (!(exitPrice > 0 && reward >= risk - 1e-8)) return waiting('No advance levels: prior daily structure leaves less than 1R of room.');
  const forming = recent.filter(bar => candleTime(bar) > lastTime && candleTime(bar) * 1000 <= options.nowMs);
  const spot = options.latestPrice ?? last.c;
  if ((buy ? spot >= entry || spot <= stopLoss : spot <= entry || spot >= stopLoss) ||
      forming.some(bar => buy ? bar.h >= entry || bar.l <= stopLoss : bar.l <= entry || bar.h >= stopLoss)) {
    return waiting('Advance setup withdrawn: its trigger or stop was touched. No entry or execution is assumed; wait for a new completed candle.');
  }
  return {
    direction: buy ? 'BUY' : 'SELL', conditional: true, score: 3, requiredScore: 3,
    confirmation: ['EMA 9/20/50 trend', 'Directional completed candle', buy ? 'Higher low' : 'Lower high'],
    watchReason: `Conditional only: wait for a ${timeframeLabel(timeframe)} close ${buy ? 'above' : 'below'} ENTRY. Reassess after each completed candle; no fill or next-candle prediction is assumed.${daily.length ? '' : ' Prior daily context unavailable; EXIT uses 2R only.'}`,
    entry, exitPrice, stopLoss, riskPoints: risk, candleTime: lastTime,
    invalidation: `Cancel before entry if STOP ${stopLoss.toFixed(2)} is touched. EXIT ${exitPrice.toFixed(2)} is a proposed profit-taking level after confirmation, not a predicted execution. Gaps and slippage can exceed STOP.`,
  };
}

export function deriveTradePlan(
  candles: Candle[],
  data: SymbolChartData | null,
  timeframe: Timeframe,
  options: { live: boolean; minConfluences: number; minVolumeRatio: number; nowMs?: number },
): TradePlan {
  const requiredScore = Math.max(4, Math.min(6, Math.round(options.minConfluences)));
  if (typeof timeframe !== 'number') {
    return {
      direction: 'WAIT', score: 0, requiredScore, confirmation: [],
      watchReason: 'Daily, weekly and monthly charts are for higher-timeframe analysis. Intraday trade signals are disabled.',
    };
  }
  const nowMs = options.nowMs ?? Date.now();
  const closed = candles.filter(candle => candleTime(candle) * 1000 + timeframe * 60_000 <= nowMs);
  const last = closed.at(-1);
  if (!last || !data) {
    return { direction: 'WAIT', score: 0, requiredScore, confirmation: [], watchReason: 'Waiting for valid candles and previous-session levels.' };
  }

  const closes = closed.length;
  const lastTime = candleTime(last);
  const lastSession = sessionDate(lastTime);
  const currentSession = sessionDate(Math.floor(nowMs / 1000));
  const current = closed.filter(candle => sessionDate(candleTime(candle)) === lastSession);
  const e9 = ema(closed, 9).at(-1)?.value;
  const e20 = ema(closed, 20).at(-1)?.value;
  const e50 = ema(closed, 50).at(-1)?.value;
  const sessionVwap = vwap(current).at(-1)?.value;
  const momentum = rsi(closed).at(-1)?.value;
  const daily = dailyLevels(data, closed);
  const prior = closed.slice(-6, -1);
  const volumeWindow = closed.slice(-21, -1);
  const averageVolume = volumeWindow.length === 20
    ? volumeWindow.reduce((total, candle) => total + candle.v, 0) / volumeWindow.length
    : 0;
  const relativeVolume = averageVolume > 0 ? last.v / averageVolume : 0;
  const trueRanges = closed.slice(-15).map((candle, index, values) => {
    const previous = index > 0 ? values[index - 1].c : candle.o;
    return Math.max(candle.h - candle.l, Math.abs(candle.h - previous), Math.abs(candle.l - previous));
  });
  const atr = trueRanges.length === 15 ? trueRanges.slice(1).reduce((sum, value) => sum + value, 0) / 14 : 0;
  const priorHigh = prior.length === 5 ? Math.max(...prior.map(candle => candle.h)) : 0;
  const priorLow = prior.length === 5 ? Math.min(...prior.map(candle => candle.l)) : 0;
  const longChecks = [
    e9 !== undefined && e20 !== undefined && e50 !== undefined && e9 > e20 && e20 > e50,
    sessionVwap !== undefined && last.c > sessionVwap,
    daily !== null && last.c > daily.P && last.c > daily.TC,
    momentum !== undefined && momentum >= 52 && momentum <= 68,
    relativeVolume >= options.minVolumeRatio,
    prior.length === 5 && last.c > priorHigh && last.c > last.o,
  ];
  const shortChecks = [
    e9 !== undefined && e20 !== undefined && e50 !== undefined && e9 < e20 && e20 < e50,
    sessionVwap !== undefined && last.c < sessionVwap,
    daily !== null && last.c < daily.P && last.c < daily.BC,
    momentum !== undefined && momentum >= 32 && momentum <= 48,
    relativeVolume >= options.minVolumeRatio,
    prior.length === 5 && last.c < priorLow && last.c < last.o,
  ];
  const longScore = longChecks.filter(Boolean).length;
  const shortScore = shortChecks.filter(Boolean).length;
  const requiredSessionBars = Math.min(15, Math.max(3, Math.floor(375 / timeframe * 0.2)));
  const validHistory = closes >= 50 && current.length >= requiredSessionBars && daily !== null && atr > 0;
  const candleClosed = candleTime(last) * 1000 + timeframe * 60_000 <= nowMs;
  const withinMarketHours = isCashSession(nowMs);
  const candleFresh = nowMs - (lastTime * 1000 + timeframe * 60_000) < timeframe * 60_000;
  const freshLiveSession = options.live && withinMarketHours && lastSession === currentSession && candleClosed && candleFresh;
  const direction = freshLiveSession && validHistory
    ? longScore >= requiredScore && longChecks[0] && longChecks[1] && longChecks[4] && longChecks[5]
      ? 'BUY'
      : shortScore >= requiredScore && shortChecks[0] && shortChecks[1] && shortChecks[4] && shortChecks[5]
        ? 'SELL'
        : 'WAIT'
    : 'WAIT';
  const supportPrices = [
    ...(data.levels?.support ?? []),
    data.levels?.pdl,
    daily?.S1,
    daily?.S2,
    daily?.BC,
    ...closed.slice(-21, -1).map(candle => candle.l),
  ];
  const resistancePrices = [
    ...(data.levels?.resistance ?? []),
    data.levels?.pdh,
    daily?.R1,
    daily?.R2,
    daily?.TC,
    ...closed.slice(-21, -1).map(candle => candle.h),
  ];
  const support = nearestZone(supportPrices, last.c, atr || last.c * 0.001, 'below');
  const resistance = nearestZone(resistancePrices, last.c, atr || last.c * 0.001, 'above');
  const checks = direction === 'SELL' || (direction === 'WAIT' && shortScore > longScore) ? shortChecks : longChecks;
  const names = ['EMA 9/20/50 alignment', 'VWAP alignment', 'CPR + pivot alignment', 'RSI momentum', `Relative volume ≥ ${options.minVolumeRatio.toFixed(1)}×`, 'Closed-candle 5-bar breakout'];
  const confirmation = names.filter((_, index) => checks[index]);
  const watchReason = !options.live
    ? 'Live, fresh market data is required before a signal can be shown.'
    : !withinMarketHours
      ? 'Signals are available only during the weekday 09:15–15:30 IST cash session.'
    : lastSession !== currentSession
      ? 'Waiting for a completed candle from today’s live session.'
      : !validHistory
        ? 'Waiting for 50 candles, current-session volume and valid previous-session OHLC.'
        : !candleFresh ? 'Waiting for a fresh closed candle; the last completed candle is delayed.'
        : sessionVwap === undefined ? 'Index volume unavailable: VWAP confirmation cannot be verified. No entry.'
        : relativeVolume < options.minVolumeRatio ? 'NO TRADE · Breakout volume is below the required relative-volume threshold.'
        : `NO TRADE · ${Math.max(shortScore, longScore)}/${requiredScore} required confirmations; a closed-candle breakout, relative volume and aligned trend/VWAP are mandatory.`;

  if (direction === 'WAIT' || atr <= 0) {
    return { direction: 'WAIT', score: Math.max(longScore, shortScore), requiredScore, confirmation, watchReason, support, resistance, candleTime: lastTime };
  }
  const isBuy = direction === 'BUY';
  const entry = last.c;
  const swing = closed.slice(-4, -1).map(candle => isBuy ? candle.l : candle.h);
  const stopLoss = isBuy
    ? Math.min(...swing) - atr * 0.15
    : Math.max(...swing) + atr * 0.15;
  const risk = Math.abs(entry - stopLoss);
  if (!(risk > 0 && risk <= atr * 2.5)) {
    return {
      direction: 'WAIT', score: isBuy ? longScore : shortScore, requiredScore, confirmation,
      watchReason: 'WAIT · Setup rejected because the structural stop is wider than 2.5 ATR.',
      support, resistance, candleTime: lastTime,
    };
  }
  const barrier = isBuy ? resistance?.low : support?.high;
  if (barrier !== undefined && (isBuy ? barrier - entry : entry - barrier) < risk) {
    return {
      direction: 'WAIT', score: isBuy ? longScore : shortScore, requiredScore, confirmation,
      watchReason: 'NO TRADE · Nearby support/resistance leaves less than 1R room before the first target.',
      support, resistance, candleTime: lastTime,
    };
  }
  const entryHalfWidth = atr * 0.12;
  const latestPrice = candles.at(-1)?.c ?? entry;
  const subsequent = candles.filter(candle => candleTime(candle) > lastTime && candleTime(candle) * 1000 <= nowMs);
  const levelTouched = subsequent.some(candle => isBuy
    ? candle.l <= stopLoss || candle.h >= entry + risk
    : candle.h >= stopLoss || candle.l <= entry - risk);
  if (levelTouched || (isBuy ? latestPrice <= stopLoss || latestPrice >= entry + risk : latestPrice >= stopLoss || latestPrice <= entry - risk)) {
    return {
      direction: 'WAIT', score: isBuy ? longScore : shortScore, requiredScore, confirmation,
      watchReason: 'Setup expired: current price has reached its stop or first target. Wait for a new closed-candle setup.',
      support, resistance, candleTime: lastTime,
    };
  }
  return {
    direction,
    score: isBuy ? longScore : shortScore,
    requiredScore,
    confirmation,
    watchReason: '',
    entry,
    stopLoss,
    exitPrice: isBuy ? entry + risk : entry - risk,
    riskPoints: risk,
    targets: isBuy
      ? [entry + risk, entry + 2 * risk, entry + 3 * risk]
      : [entry - risk, entry - 2 * risk, entry - 3 * risk],
    entryZone: { low: entry - entryHalfWidth, high: entry + entryHalfWidth, center: entry },
    support,
    resistance,
    invalidation: `Exit at stop ${stopLoss.toFixed(2)}; also invalidate on a ${timeframe === 60 ? '1h' : `${timeframe}m`} candle close ${isBuy ? 'below' : 'above'} EMA 20 or session VWAP. No execution is tracked.`,
    candleTime: lastTime,
  };
}

export function isIndicatorSettings(value: unknown): value is IndicatorSettings {
  return typeof value === 'object' && value !== null &&
    INDICATORS.every(({ id }) => id in value && typeof Reflect.get(value, id) === 'boolean');
}

export function restoreIndicatorSettings(value: unknown): IndicatorSettings | null {
  if (typeof value !== 'object' || value === null) return null;
  const added = new Set<Indicator>(['supertrend', 'emaCross', 'camarilla', 'atr']);
  if (!INDICATORS.every(({ id }) => id in value
    ? typeof Reflect.get(value, id) === 'boolean' : added.has(id))) return null;
  return { ...Object.fromEntries(INDICATORS.map(({ id }) => [
    id, id in value ? Reflect.get(value, id) : DEFAULT_INDICATORS[id],
  ])), macd: false, pivots: false, emaCross: false } as IndicatorSettings;
}
