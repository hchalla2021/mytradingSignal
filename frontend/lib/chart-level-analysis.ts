import type { Candle } from '@/hooks/useChartIntelligence';
import { createIndicatorEngine, pivotValues, type IndicatorSeries, type IndicatorCalculation } from './chart-indicators';
import { candleTime, sessionDate, isCashSession, DEFAULT_INDICATORS, type Timeframe, type TradePlan } from './chart-workspace';

export type LevelReaction = 'Support bounce' | 'Resistance rejection' | 'Break above' | 'Break below' | 'Testing' | 'No test';
export interface ChartLevel {
  id: string;
  label: string;
  price: number;
  role: 'Support' | 'Resistance' | 'Testing';
  reaction: LevelReaction;
  touches: number;
  holds: number;
  crosses: number;
  scope: string;
}
export interface LevelAnalysis {
  levels: ChartLevel[];
  support?: ChartLevel;
  resistance?: ChartLevel;
  trend: 'Bullish' | 'Bearish' | 'Mixed' | 'Warming up';
  volume: 'Verified' | 'Unverified' | 'Weak / conflicting';
  plan: TradePlan;
  processedBars: number;
  reviewedBars: number;
  from?: string;
  through?: string;
}

const SETTINGS = {
  ...DEFAULT_INDICATORS,
  supertrend: false, emaCross: false, camarilla: false, pivots: false, cpr: false,
  volume: false, macd: false, vwap: false,
};
const positive = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value > 0;
const roundUp = (value: number) => Math.ceil(value * 20 - 1e-8) / 20;
const roundDown = (value: number) => Math.floor(value * 20 + 1e-8) / 20;
const weekStart = (date: string) => {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
};

export function classifyLevelReaction(bar: Candle, previous: Candle, level: number, atr: number): LevelReaction {
  const tolerance = Math.max(.05, atr * .12);
  const buffer = Math.max(.05, atr * .08);
  const touched = bar.l <= level + tolerance && bar.h >= level - tolerance;
  const body = Math.abs(bar.c - bar.o);
  const range = bar.h - bar.l;
  if (body < atr * .15 || range <= 0) return touched ? 'Testing' : 'No test';
  if (previous.c <= level && bar.o <= level + tolerance && bar.c > level + buffer && bar.c > bar.o) return 'Break above';
  if (previous.c >= level && bar.o >= level - tolerance && bar.c < level - buffer && bar.c < bar.o) return 'Break below';
  if (touched && previous.c >= level && bar.c > level + buffer && bar.c > previous.c &&
      bar.c > bar.o && (bar.c - bar.l) / range >= .65) return 'Support bounce';
  if (touched && previous.c <= level && bar.c < level - buffer && bar.c < previous.c &&
      bar.c < bar.o && (bar.h - bar.c) / range >= .65) return 'Resistance rejection';
  return touched ? 'Testing' : 'No test';
}

function buildLevels(candles: Candle[], daily: Candle[], series: IndicatorSeries, index: number): ChartLevel[] {
  const last = candles[index];
  const today = sessionDate(candleTime(last));
  const atr = series.atr[index]?.value ?? 0;
  const evidenceStart = Math.max(1, index - 499);
  const dates = candles.slice(evidenceStart, index + 1).map(bar => sessionDate(candleTime(bar)));
  const definitions: { id: string; label: string; price: number; scope: string; ema?: string }[] = [];
  for (const period of [9, 20, 50, 100, 200]) {
    const id = `ema${period}`;
    const price = series[id][index]?.value;
    if (positive(price)) definitions.push({ id, label: `EMA ${period}`, price, scope: 'Last 500 loaded bars', ema: id });
  }
  const priorDaily = daily.filter(bar => sessionDate(candleTime(bar)) < today);
  const previous = priorDaily.at(-1);
  if (previous) {
    const values = pivotValues(previous.h, previous.l, previous.c);
    for (const family of ['traditional', 'camarilla', 'cpr'] as const) {
      const prefix = family === 'traditional' ? 'Daily Pivot' : family === 'camarilla' ? 'Daily Cam' : 'Daily CPR';
      for (const [name, price] of Object.entries(values[family])) {
        if (family !== 'cpr' && !['P', 'R1', 'R2', 'R3', 'R4', 'S1', 'S2', 'S3', 'S4'].includes(name)) continue;
        definitions.push({ id: `${family}:${name}`, label: `${prefix} ${name}`, price, scope: 'Current session' });
      }
    }
    definitions.push(
      { id: 'pdh', label: 'Previous day high', price: previous.h, scope: 'Current session' },
      { id: 'pdl', label: 'Previous day low', price: previous.l, scope: 'Current session' },
    );
  }
  const monday = weekStart(today);
  const previousMonday = new Date(`${monday}T00:00:00Z`);
  previousMonday.setUTCDate(previousMonday.getUTCDate() - 7);
  const lastWeek = previousMonday.toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);
  const month = new Date(`${currentMonth}-01T00:00:00Z`);
  month.setUTCMonth(month.getUTCMonth() - 1);
  const lastMonth = month.toISOString().slice(0, 7);
  for (const [id, label, bars] of [
    ['week', 'Previous week', priorDaily.filter(bar => sessionDate(candleTime(bar)) >= lastWeek && sessionDate(candleTime(bar)) < monday)],
    ['month', 'Previous month', priorDaily.filter(bar => sessionDate(candleTime(bar)).slice(0, 7) === lastMonth)],
  ] as const) {
    if (!bars.length) continue;
    definitions.push(
      { id: `${id}:high`, label: `${label} high (loaded)`, price: Math.max(...bars.map(bar => bar.h)), scope: 'Current session' },
      { id: `${id}:low`, label: `${label} low (loaded)`, price: Math.min(...bars.map(bar => bar.l)), scope: 'Current session' },
    );
  }
  const priorBars = candles.slice(Math.max(0, index - 20), index);
  if (priorBars.length === 20) definitions.push(
    { id: 'swing:high', label: '20-bar swing high', price: Math.max(...priorBars.map(bar => bar.h)), scope: 'Current setup' },
    { id: 'swing:low', label: '20-bar swing low', price: Math.min(...priorBars.map(bar => bar.l)), scope: 'Current setup' },
  );
  return definitions.filter(level => positive(level.price)).map(level => {
    let touches = 0;
    let holds = 0;
    let crosses = 0;
    const start = level.scope === 'Current setup' ? index : evidenceStart;
    for (let i = start; i <= index; i++) {
      const bar = candles[i];
      if (!level.ema && dates[i - evidenceStart] !== today) continue;
      // Test against the EMA known before this candle, not its revised close value.
      const reference = level.ema ? series[level.ema][i - 1]?.value : level.price;
      const volatility = series.atr[i - 1]?.value;
      if (!positive(reference) || !positive(volatility)) continue;
      if (bar.l <= reference + volatility * .12 && bar.h >= reference - volatility * .12) touches++;
      const reaction = classifyLevelReaction(bar, candles[i - 1], reference, volatility);
      if (reaction === 'Support bounce' || reaction === 'Resistance rejection') holds++;
      if (reaction === 'Break above' || reaction === 'Break below') crosses++;
    }
    const reference = level.ema ? series[level.ema][index - 1]?.value : level.price;
    const reaction = positive(reference) && index > 0
      ? classifyLevelReaction(last, candles[index - 1], reference, atr) : 'No test';
    return {
      id: level.id, label: level.label, price: level.price, scope: level.scope,
      role: Math.abs(last.c - level.price) <= atr * .12 ? 'Testing' : last.c > level.price ? 'Support' : 'Resistance',
      reaction, touches, holds, crosses,
    };
  });
}

/** Indicators update incrementally; level evidence is recomputed only after a completed-bar change. */
export function createLevelAnalysisEngine() {
  const indicators = createIndicatorEngine();
  let memo: { index: number; daily: Candle[]; levels: ChartLevel[]; calculation: IndicatorCalculation } | undefined;
  return {
    analyze(candles: Candle[], daily: Candle[], timeframe: Timeframe, options: {
      live: boolean; nowMs: number; latestPrice?: number; minVolumeRatio: number;
    }): LevelAnalysis {
      const intraday = typeof timeframe === 'number';
      const duration = intraday ? timeframe * 60 : 0;
      const calculation = indicators.calculate(candles, SETTINGS, intraday);
      const series = calculation.series;
      let index = candles.length - 1;
      while (index >= 0 && (!intraday || candleTime(candles[index]) + duration > options.nowMs / 1000)) index--;
      const wait = (reason: string, levels: ChartLevel[] = []): LevelAnalysis => ({
        levels, trend: 'Warming up', volume: 'Unverified',
        plan: { direction: 'WAIT', score: 0, requiredScore: 3, confirmation: [], watchReason: reason },
        processedBars: calculation.processedBars, reviewedBars: Math.max(0, index + 1),
        from: candles[0]?.t, through: candles[Math.max(0, index)]?.t,
      });
      if (!intraday) return wait('NO TRADE · Higher timeframes are context only; select an intraday interval for entries.');
      if (index < 50) return wait('NO TRADE · Warming trend: at least 50 completed candles are required.',
        index > 0 ? buildLevels(candles, daily, series, index) : []);
      const last = candles[index];
      const atr = series.atr[index]?.value;
      if (!positive(atr)) return wait('NO TRADE · Waiting for valid volatility.');
      if (!memo || memo.index !== index || memo.daily !== daily ||
          memo.calculation !== calculation && calculation.changedFrom <= index) {
        memo = { index, daily, levels: buildLevels(candles, daily, series, index), calculation };
      }
      memo.calculation = calculation;
      const levels = memo.levels;
      const e9 = series.ema9[index].value!;
      const e20 = series.ema20[index].value!;
      const e50 = series.ema50[index].value!;
      const previous20 = series.ema20[index - 3].value!;
      const momentum = series.rsi[index]?.value ?? 50;
      const trend = e9 > e20 && last.c > e50 && e20 > previous20 ? 'Bullish' :
        e9 < e20 && last.c < e50 && e20 < previous20 ? 'Bearish' : 'Mixed';
      const priorVolume = candles.slice(index - 20, index);
      const volumeKnown = last.v > 0 && priorVolume.every(bar => bar.v > 0);
      const averageVolume = priorVolume.reduce((sum, bar) => sum + bar.v, 0) / 20;
      const buy = trend === 'Bullish';
      const volume = !volumeKnown ? 'Unverified' :
        last.v >= averageVolume * options.minVolumeRatio ? 'Verified' : 'Weak / conflicting';
      const support = levels.filter(level => level.price < last.c).sort((a, b) => b.price - a.price)[0];
      const resistance = levels.filter(level => level.price > last.c).sort((a, b) => a.price - b.price)[0];
      const result: LevelAnalysis = {
        ...wait('', levels), trend, volume, support, resistance,
      };
      const reject = (reason: string) => {
        result.plan.watchReason = reason;
        return result;
      };
      if (index < 200) return reject('NO TRADE · Warming EMA 200: at least 201 completed candles are required.');
      const currentSession = sessionDate(options.nowMs / 1000);
      const signalTime = candleTime(last);
      if (!options.live || !isCashSession(options.nowMs)) return reject('NO TRADE · Fresh live cash-session data is required.');
      if (sessionDate(signalTime) !== currentSession ||
          options.nowMs / 1000 - signalTime - duration >= duration) return reject('NO TRADE · Waiting for a fresh completed candle from today.');
      const candidates = levels.filter(level => buy
        ? level.reaction === 'Support bounce' || level.reaction === 'Break above'
        : level.reaction === 'Resistance rejection' || level.reaction === 'Break below');
      if (trend === 'Mixed' || !candidates.length) return reject('NO TRADE · No completed-candle level bounce/breakout with aligned EMA trend.');
      if (buy ? momentum < 50 || momentum > 72 : momentum > 50 || momentum < 28) return reject('NO TRADE · RSI does not confirm the level reaction.');
      if (volume === 'Weak / conflicting') return reject('NO TRADE · Observed volume conflicts with the setup.');
      const event = candidates.sort((a, b) => Math.abs(a.price - last.c) - Math.abs(b.price - last.c))[0];
      const entry = buy ? roundUp(last.c) : roundDown(last.c);
      const swing = candles.slice(index - 2, index + 1);
      const stopLoss = buy ? roundDown(Math.min(...swing.map(bar => bar.l), event.price) - atr * .15)
        : roundUp(Math.max(...swing.map(bar => bar.h), event.price) + atr * .15);
      const risk = buy ? entry - stopLoss : stopLoss - entry;
      if (!(stopLoss > 0 && risk >= .25 * atr && risk <= 2.5 * atr)) return reject('NO TRADE · Structural stop is outside the 0.25-2.5 ATR risk bounds.');
      const obstacle = buy ? resistance?.price : support?.price;
      const target = buy ? roundDown(Math.min(entry + 2 * risk, (obstacle ?? Infinity) - atr * .1))
        : roundUp(Math.max(entry - 2 * risk, (obstacle ?? -Infinity) + atr * .1));
      if (!(target > 0 && (buy ? target - entry : entry - target) >= risk)) return reject('NO TRADE · Next support/resistance leaves less than 1R reward room.');
      const forming = candles.slice(index + 1).filter(bar => candleTime(bar) * 1000 <= options.nowMs);
      const spot = options.latestPrice ?? forming.at(-1)?.c ?? last.c;
      if (!positive(spot)) return reject('NO TRADE · Latest quote is invalid.');
      if ((buy ? spot <= stopLoss || spot >= target : spot >= stopLoss || spot <= target) ||
          forming.some(bar => buy ? bar.l <= stopLoss || bar.h >= target : bar.h >= stopLoss || bar.l <= target)) {
        return reject('NO TRADE · Target or stop already touched; wait for a new completed-candle setup.');
      }
      if (Math.abs(spot - entry) > atr * .35) return reject('NO TRADE · Price has moved away from the close entry; do not chase.');
      result.plan = {
        direction: buy ? 'BUY' : 'SELL', conditional: false, score: volume === 'Verified' ? 4 : 3, requiredScore: 3,
        confirmation: [`${event.reaction} at ${event.label}`, 'EMA 9/20 trend + EMA 50 location', `RSI ${momentum.toFixed(1)}`,
          volume === 'Verified' ? 'Relative volume verified' : 'Volume UNVERIFIED: cash-index volume unavailable'],
        watchReason: '', entry, stopLoss, exitPrice: target, riskPoints: risk, candleTime: signalTime,
        volumeVerified: volume === 'Verified', basis: `${event.reaction} · ${event.label}`,
        invalidation: `Exit analysis at stop ${stopLoss.toFixed(2)} or target ${target.toFixed(2)}. Reassess after every close. Volume ${volume.toLowerCase()}; no fill is tracked and no bounce is guaranteed.`,
      };
      return result;
    },
  };
}
