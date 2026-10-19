import type { Candle } from '@/hooks/useChartIntelligence';
import { createIndicatorEngine, pivotValues } from './chart-indicators';
import { classifyLevelReaction } from './chart-level-analysis';
import { candleTime, DEFAULT_INDICATORS, isCashSession, sessionDate, type ChartSymbol, type Timeframe, type TradePlan } from './chart-workspace';

export interface PaperSignal {
  strategy: string;
  side: 'BUY' | 'SELL';
  signal_price: number;
  rationale: string[];
  tags: string[];
}

export interface PaperFrame {
  source: 'observatory-chart';
  symbol: ChartSymbol;
  timeframe: number;
  candle_at: string;
  setup: Record<string, unknown>;
  signals: PaperSignal[];
}

const PERIODS = [9, 20, 50, 100, 200] as const;

export function createChartPaperAnalyzer() {
  const engine = createIndicatorEngine();
  return {
    analyze(symbol: ChartSymbol, candles: Candle[], daily: Candle[], timeframe: Timeframe,
      nowMs: number, chartPlan: TradePlan): PaperFrame | null {
      if (typeof timeframe !== 'number' || !isCashSession(nowMs)) return null;
      const index = candles.findLastIndex(bar => candleTime(bar) + timeframe * 60 <= nowMs / 1000);
      if (index < 20) return null;
      const bar = candles[index];
      const previous = candles[index - 1];
      const at = candleTime(bar);
      if (sessionDate(at) !== sessionDate(nowMs / 1000) || nowMs / 1000 >= at + timeframe * 120) return null;
      const { series } = engine.calculate(candles, DEFAULT_INDICATORS, true);
      const atr = series.atr[index]?.value;
      if (atr === undefined || atr <= 0) return null;
      const ema = Object.fromEntries(PERIODS.map(period => [`ema${period}`, {
        current: series[`ema${period}`][index]?.value ?? null,
        previous: series[`ema${period}`][index - 1]?.value ?? null,
      }]));
      const e9 = ema.ema9.current;
      const e20 = ema.ema20.current;
      const e50 = ema.ema50.current;
      const trend = e9 !== null && e20 !== null && e50 !== null
        ? e9 > e20 && bar.c > e50 ? 'BUY' : e9 < e20 && bar.c < e50 ? 'SELL' : 'MIXED'
        : 'WARMING';
      const priorDaily = daily.filter(day => sessionDate(candleTime(day)) < sessionDate(at)).at(-1);
      const levels: { id: string; price: number; reference: number }[] = [];
      for (const period of PERIODS) {
        const value = ema[`ema${period}`];
        if (value.current !== null && value.previous !== null)
          levels.push({ id: `EMA ${period}`, price: value.current, reference: value.previous });
      }
      if (priorDaily) {
        const pivots = pivotValues(priorDaily.h, priorDaily.l, priorDaily.c);
        for (const [family, values] of Object.entries(pivots)) {
          for (const [name, value] of Object.entries(values))
            levels.push({ id: `${family} ${name}`, price: value, reference: value });
        }
        levels.push({ id: 'Previous day high', price: priorDaily.h, reference: priorDaily.h },
          { id: 'Previous day low', price: priorDaily.l, reference: priorDaily.l });
      }
      const vwap = series.vwap[index]?.value;
      const previousVwap = series.vwap[index - 1]?.value;
      if (vwap !== undefined && previousVwap !== undefined && bar.v > 0)
        levels.push({ id: 'Cash session VWAP', price: vwap, reference: previousVwap });
      const prior = candles.slice(index - 20, index);
      const volumeKnown = bar.v > 0 && prior.every(item => item.v > 0);
      const average = prior.reduce((sum, item) => sum + item.v, 0) / 20;
      const relativeVolume = volumeKnown ? bar.v / average : null;
      const body = Math.abs(bar.c - bar.o);
      const range = bar.h - bar.l;
      const patterns: string[] = [];
      if (range > 0 && body <= range * .1) patterns.push('Doji');
      if (bar.c > bar.o && previous.c < previous.o && bar.o <= previous.c && bar.c >= previous.o)
        patterns.push('Bullish engulfing');
      if (bar.c < bar.o && previous.c > previous.o && bar.o >= previous.c && bar.c <= previous.o)
        patterns.push('Bearish engulfing');
      if (range > 0 && Math.min(bar.o, bar.c) - bar.l >= Math.max(body * 2, range * .5)) patterns.push('Bullish pin');
      if (range > 0 && bar.h - Math.max(bar.o, bar.c) >= Math.max(body * 2, range * .5)) patterns.push('Bearish pin');
      const high = Math.max(...prior.map(item => item.h));
      const low = Math.min(...prior.map(item => item.l));
      const structure = bar.c > high ? 'BUY' : bar.c < low ? 'SELL' : 'RANGE';
      const signals: PaperSignal[] = [];
      const add = (strategy: string, side: 'BUY' | 'SELL', rationale: string[]) => {
        strategy = strategy.replace(/Break above|Break below/, 'breakout')
          .replace(/Support bounce|Resistance rejection/, 'bounce');
        const tags = [strategy];
        if (trend === side) tags.push('EMA 9/20/50 trend');
        if (relativeVolume !== null && relativeVolume >= 1.2) tags.push('Relative volume >= 1.2');
        if (vwap !== undefined && bar.v > 0 && (side === 'BUY' ? bar.c > vwap : bar.c < vwap)) tags.push('Cash VWAP aligned');
        if (structure === side) tags.push('20-bar structure break');
        tags.push(...patterns.filter(pattern => pattern.startsWith(side === 'BUY' ? 'Bullish' : 'Bearish')));
        signals.push({ strategy, side, signal_price: bar.c, tags, rationale });
      };
      const reactions = levels.map(level => ({
        ...level, reaction: classifyLevelReaction(bar, previous, level.reference, atr),
      }));
      for (const level of reactions) {
        if (level.reaction === 'Break above' || level.reaction === 'Support bounce')
          add(`${level.id} ${level.reaction}`, 'BUY', [`${level.reaction} at ${level.reference.toFixed(2)}`, 'Completed chart candle']);
        if (level.reaction === 'Break below' || level.reaction === 'Resistance rejection')
          add(`${level.id} ${level.reaction}`, 'SELL', [`${level.reaction} at ${level.reference.toFixed(2)}`, 'Completed chart candle']);
      }
      for (let i = 0; i < PERIODS.length; i++) {
        for (const slow of PERIODS.slice(i + 1)) {
          const fast = PERIODS[i];
          const a = ema[`ema${fast}`];
          const b = ema[`ema${slow}`];
          if (a.previous === null || b.previous === null || a.current === null || b.current === null) continue;
          if (a.previous <= b.previous && a.current > b.current)
            add(`EMA ${fast}/${slow} cross`, 'BUY', [`EMA ${fast} crossed above EMA ${slow} on the closed chart candle`]);
          if (a.previous >= b.previous && a.current < b.current)
            add(`EMA ${fast}/${slow} cross`, 'SELL', [`EMA ${fast} crossed below EMA ${slow} on the closed chart candle`]);
        }
      }
      if (structure === 'BUY' || structure === 'SELL')
        add('20-bar structure breakout', structure, [`Close broke the preceding 20-bar ${structure === 'BUY' ? 'high' : 'low'}`]);
      const patternSide = patterns.some(p => p.startsWith('Bullish')) ? 'BUY' :
        patterns.some(p => p.startsWith('Bearish')) ? 'SELL' : null;
      if (patternSide && patternSide === trend)
        add('Candle pattern + EMA trend', patternSide, patterns);
      if (chartPlan.direction !== 'WAIT' && !chartPlan.conditional && chartPlan.candleTime === at)
        add('Chart confirmed setup', chartPlan.direction, chartPlan.confirmation);
      return {
        source: 'observatory-chart', symbol, timeframe,
        candle_at: new Date(at * 1000).toISOString(),
        setup: {
          bar, previous_bar: previous, completed_at: new Date((at + timeframe * 60) * 1000).toISOString(),
          ema, atr, rsi: series.rsi[index]?.value ?? null, trend,
          levels: reactions, previous_day: priorDaily ?? null, candle_patterns: patterns,
          market_structure: { direction: structure, prior_20_high: high, prior_20_low: low,
            higher_high: bar.h > previous.h, higher_low: bar.l > previous.l,
            lower_high: bar.h < previous.h, lower_low: bar.l < previous.l },
          volume: { source: 'Cash-index chart candles only', value: bar.v, relative: relativeVolume,
            status: volumeKnown ? 'OBSERVED' : 'UNAVAILABLE' },
          vwap: { value: bar.v > 0 ? vwap ?? null : null, source: 'Cash-index chart only; futures not substituted' },
          chart_plan: chartPlan, execution_profile: 'Independent comparison books: 10-point stop, 20-point target',
        },
        signals,
      };
    },
  };
}
