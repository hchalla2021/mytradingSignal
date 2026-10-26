'use client';

import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ColorType, CrosshairMode, LineStyle, createChart,
  type IChartApi, type IPriceLine, type ISeriesApi, type LogicalRange, type MouseEventParams,
  type SeriesMarker, type Time, type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from '@/hooks/useChartIntelligence';
import { useOrderFlow } from '@/hooks/useOrderFlow';
import { candleTime, isCashSession, timeframeLabel, type ChartSymbol } from '@/lib/chart-workspace';
import { OrderFlowPrimitive } from '@/lib/chart-order-flow';
import { synchronizeCrosshair } from '@/lib/chart-crosshair';
import { centerLatestCandle, resizeChartIfChanged, synchronizeChartRange } from '@/lib/chart-render-sync';
import { futuresChangedFrom } from '@/lib/futures-chart-metrics';
import { mergeFuturesLiveCandles } from '@/lib/futures-live-candles';
import {
  compactVolume, type OrderFlowBar, type OrderFlowDom, type OrderFlowEvent,
  type OrderFlowSnapshot, type OrderFlowZone,
} from '@/lib/order-flow';
import {
  EMA_PERIODS, atr, crossovers, depthImbalance, dominance, ema, evaluateSignal, freshness, istDay,
  liquiditySweeps, oiBuildup, oiChanges, previousDay, pricePatterns, resample, sessionDominance, sessionVwap,
  supportResistance, trendBias,
  type Bias, type EmaPeriod, type Freshness, type Level, type Mark, type PrevDay, type TerminalBar, type TerminalSignal,
} from '@/lib/futures-terminal';
import { IndexTabList } from './IndexTabs';
import DeltaStrengthBox from './DeltaStrength';
import ProSignalPanel from './ProSignal';
import LevelBattlePanel from './LevelBattle';
import { useLevelBattle } from '@/hooks/useLevelBattle';
import { LevelBattlePrimitive } from '@/lib/level-battle-primitive';
import { useProConfluence } from '@/hooks/useProConfluence';
import { snapTime } from '@/lib/pro-confluence';
import {
  formatExpiry, loadCandles, loadContracts, readCachedCandles, readCachedContracts,
  type CandleState, type FuturesContract,
} from './FuturesChart';
import styles from './FuturesTerminal.module.css';

type Intraday = 3 | 5 | 15 | 30 | 60;
const TIMEFRAMES: Intraday[] = [3, 5, 15, 30, 60];
const HIGHER: Record<Intraday, number[]> = { 3: [15, 60], 5: [15, 60], 15: [60], 30: [60], 60: [] };
const EMA_COLORS: Record<EmaPeriod, string> = {
  9: '#00cbb8', 21: '#3b9dff', 25: '#a78bfa', 50: '#f59e0b', 100: '#f472b6', 200: '#e2e8f0',
};
const UP = '#00bba5';
const DOWN = '#ee4053';
const PREFS_KEY = 'futuresTerminalPrefs_v2';
const EMPTY_CANDLES: Candle[] = [];
const EMPTY_EVENTS: OrderFlowEvent[] = [];
const EMPTY_ZONES: OrderFlowZone[] = [];

interface Prefs {
  ema: Record<EmaPeriod, boolean>;
  vwap: boolean; volume: boolean; orderFlow: boolean; pdhl: boolean; levels: boolean;
  patterns: boolean; crosses: boolean; sweeps: boolean; plan: boolean;
  dom: boolean; signal: boolean; flow: boolean; info: boolean; deltaPane: boolean; oiPane: boolean;
}
const DEFAULT_PREFS: Prefs = {
  ema: { 9: true, 21: true, 25: false, 50: false, 100: false, 200: false },
  vwap: true, volume: true, orderFlow: true, pdhl: true, levels: true,
  patterns: false, crosses: false, sweeps: true, plan: true,
  dom: true, signal: true, flow: true, info: true, deltaPane: true, oiPane: true,
};
const PREF_LABELS: [Exclude<keyof Prefs, 'ema'>, string][] = [
  ['vwap', 'VWAP'], ['volume', 'Volume'], ['orderFlow', 'Footprint / profile / walls'], ['pdhl', 'Prev-day H/L/C'],
  ['levels', 'Support / resistance'], ['crosses', 'EMA crossovers'], ['patterns', 'Price-action patterns'],
  ['sweeps', 'Liquidity sweeps'], ['plan', 'Signal plan lines'], ['deltaPane', 'Delta / CVD pane'],
  ['oiPane', 'Open interest pane'], ['signal', 'Signal panel'], ['dom', 'DOM panel'], ['flow', 'Bar order-flow panel'],
  ['info', 'Levels & events panel'],
];

function loadPrefs(): Prefs {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return DEFAULT_PREFS;
    const saved = raw as Record<string, unknown>;
    const next: Prefs = { ...DEFAULT_PREFS, ema: { ...DEFAULT_PREFS.ema } };
    for (const [key] of PREF_LABELS) if (typeof saved[key] === 'boolean') next[key] = saved[key] as boolean;
    const emas = saved.ema as Record<string, unknown> | undefined;
    for (const period of EMA_PERIODS) if (typeof emas?.[period] === 'boolean') next.ema[period] = emas[period] as boolean;
    return next;
  } catch {
    return DEFAULT_PREFS;
  }
}

const price = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' :
  value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' : compactVolume(value);
const signed = (value: number | null | undefined, format = qty) => value == null ? '—' : `${value > 0 ? '+' : ''}${format(value)}`;
const pct = (value: number | null | undefined) => value == null ? '—' : `${value.toFixed(1)}%`;
const clock = (time: number) => new Date(time * 1000).toLocaleTimeString('en-IN', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
});
const age = (seconds: number | null) => seconds == null ? '—' : seconds < 60 ? `${Math.round(seconds)}s` :
  seconds < 3600 ? `${Math.round(seconds / 60)}m` : `${Math.round(seconds / 3600)}h`;
const biasClass = (bias: Bias | 'BUY' | 'SELL' | 'WAIT') =>
  bias === 'BULL' || bias === 'BUY' ? styles.bull : bias === 'BEAR' || bias === 'SELL' ? styles.bear : styles.neutral;
const sessionLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', {
  timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short',
});

interface FlowStatus { tone: 'live' | 'past' | 'none'; text: string; detail: string }

/** What order flow the chart is showing, in one honest line. */
function orderFlowStatus(snapshot: OrderFlowSnapshot | null, recordedToken: number | null, live: boolean, inSession: boolean): FlowStatus {
  if (snapshot && snapshot.bars.length) {
    if (snapshot.latestRecorded) return {
      tone: 'past', text: `Order flow · ${sessionLabel(snapshot.date)} (last recorded)`,
      detail: 'Today has no recording yet. Footprint, delta and absorption shown are from the last recorded session.',
    };
    const from = snapshot.recordedFrom ? ` since ${clock(snapshot.recordedFrom)}` : '';
    return live && inSession
      ? { tone: 'live', text: `Order flow · live${from}`, detail: 'Recorded from Kite ticks; aggressor side estimated (Lee-Ready).' }
      : { tone: 'past', text: `Order flow · ${sessionLabel(snapshot.date)}${from}`, detail: 'Recorded session; not currently streaming.' };
  }
  if (recordedToken !== null) return {
    tone: 'none', text: 'Order flow is recorded for the near-month contract only',
    detail: 'Switch the contract to the near month to see footprint, delta, buy/sell volume and absorption.',
  };
  return {
    tone: 'none', text: 'No order flow recorded yet',
    detail: inSession
      ? 'Waiting for live futures ticks from the backend. Footprint, delta and absorption appear here within a minute of the first tick.'
      : 'Footprint, buy/sell volume, delta and absorption are recorded from live Kite ticks during market hours (09:15–15:30 IST) and appear here. Nothing is estimated from candles.',
  };
}

function barClose(time: number, minutes: number) {
  const close = istDay(time) * 86_400 - 19_800 + 930 * 60;
  return Math.min(time + minutes * 60, close);
}

/** Crosshair time shared with the readout panel without re-rendering the terminal. */
function createHoverStore() {
  let value: number | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: number | null) {
      if (next === value) return;
      value = next;
      listeners.forEach(listener => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
type HoverStore = ReturnType<typeof createHoverStore>;

interface LineSpec { id: string; price: number; color: string; title: string; style?: LineStyle; width?: 1 | 2 }
function syncPriceLines(series: ISeriesApi<'Candlestick'>, lines: Map<string, IPriceLine>, specs: LineSpec[]) {
  const wanted = new Set(specs.map(spec => spec.id));
  lines.forEach((line, id) => {
    if (!wanted.has(id)) { series.removePriceLine(line); lines.delete(id); }
  });
  for (const spec of specs) {
    const options = {
      price: spec.price, color: spec.color, title: spec.title, lineWidth: spec.width ?? 1,
      lineStyle: spec.style ?? LineStyle.Dashed, axisLabelVisible: true, lineVisible: true,
    };
    const existing = lines.get(spec.id);
    if (existing) existing.applyOptions(options);
    else lines.set(spec.id, series.createPriceLine(options));
  }
}

interface Runtime {
  main: IChartApi; delta: IChartApi; oi: IChartApi;
  candles: ISeriesApi<'Candlestick'>; volume: ISeriesApi<'Histogram'>; vwap: ISeriesApi<'Line'>;
  emas: Record<EmaPeriod, ISeriesApi<'Line'>>;
  deltaBars: ISeriesApi<'Histogram'>; cvd: ISeriesApi<'Line'>;
  oiLine: ISeriesApi<'Line'>; oiChange: ISeriesApi<'Histogram'>;
  orderFlow: OrderFlowPrimitive; levelBattle: LevelBattlePrimitive; lines: Map<string, IPriceLine>;
}

export default function FuturesTerminal({ active = true }: { active?: boolean }) {
  const [symbol, setSymbol] = useState<ChartSymbol>('NIFTY');
  const [token, setToken] = useState<number | null>(null);
  const [timeframe, setTimeframe] = useState<Intraday>(5);
  const [retry, setRetry] = useState(0);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [now, setNow] = useState(Date.now);
  const [contracts, setContracts] = useState<{ symbol: ChartSymbol; items: FuturesContract[]; error: string | null; loading: boolean }>(
    () => ({ symbol: 'NIFTY', items: readCachedContracts('NIFTY')?.value ?? [], error: null, loading: true }));
  const [data, setData] = useState<CandleState>({ key: '', candles: [], error: null, updated: null });
  const hover = useMemo(createHoverStore, []);

  useEffect(() => { setPrefs(loadPrefs()); }, []);
  const updatePrefs = (change: (previous: Prefs) => Prefs) => setPrefs(previous => {
    const next = change(previous);
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* storage full or disabled */ }
    return next;
  });

  const items = contracts.symbol === symbol ? contracts.items : readCachedContracts(symbol)?.value ?? [];
  // Until the contracts effect runs for a newly selected index, the state still belongs to the old one.
  const contractsLoading = contracts.symbol !== symbol || contracts.loading;
  const contract = items.find(item => item.token === token) ?? items[0];
  const key = `${symbol}:${contract?.token ?? ''}:${timeframe}`;
  const flow = useOrderFlow(symbol, timeframe, contract?.token, active && contract !== undefined, true);
  const pro = useProConfluence(symbol, active);
  const [footprint, setFootprint] = useState(false);
  const history = data.key === key ? data : contract ? readCachedCandles(symbol, contract.token, timeframe)?.value : undefined;
  const historyCandles = history?.candles ?? EMPTY_CANDLES;
  const contractError = contracts.symbol === symbol ? contracts.error : null;
  const historyError = data.key === key ? data.error : null;

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const saved = readCachedContracts(symbol);
    setContracts(previous => ({ symbol, items: saved?.value ?? (previous.symbol === symbol ? previous.items : []),
      error: null, loading: !(saved?.fresh && retry === 0) }));
    loadContracts(symbol, retry > 0).then(list => {
      if (!cancelled) setContracts({ symbol, items: list, error: null, loading: false });
    }).catch((error: unknown) => {
      if (cancelled) return;
      console.error('Futures terminal contracts:', error);
      setContracts(previous => ({ ...previous, symbol, loading: false,
        error: error instanceof Error ? error.message : 'Unable to load futures contracts.' }));
    });
    return () => { cancelled = true; };
  }, [symbol, retry, active]);

  const contractToken = contract?.token;
  useEffect(() => {
    if (!active || contractToken === undefined) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const saved = readCachedCandles(symbol, contractToken, timeframe);
    setData(previous => previous.key === key ? previous : saved?.value ?? { key, candles: [], error: null, updated: null });
    const load = async () => {
      try {
        const next = await loadCandles(symbol, contractToken, timeframe);
        if (!cancelled) setData(next);
      } catch (error) {
        if (cancelled) return;
        console.error('Futures terminal history:', error);
        const message = error instanceof Error ? error.message : 'Unable to load futures candles.';
        setData(previous => previous.key === key ? { ...previous, error: message } : { key, candles: [], updated: null, error: message });
      } finally {
        if (!cancelled) timer = setTimeout(() => void load(), 20_000);
      }
    };
    if (saved?.fresh && retry === 0) timer = setTimeout(() => void load(), Math.max(0, 20_000 - (Date.now() - (saved.value.updated ?? 0))));
    else void load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [symbol, contractToken, timeframe, key, retry, active]);

  // ── data pipeline (memoised; each stage recomputes only when its inputs change) ──
  const snapshot: OrderFlowSnapshot | null = flow.snapshot?.available && flow.snapshot.token === contractToken ? flow.snapshot : null;
  const liveRef = useRef({ key: '', history: EMPTY_CANDLES, candles: EMPTY_CANDLES });
  const candles = useMemo(() => {
    const prior = liveRef.current;
    const base = prior.key === key && prior.history === historyCandles ? prior.candles : historyCandles;
    const merged = mergeFuturesLiveCandles(base, flow.snapshot, symbol, contractToken, timeframe, flow.live, Date.now(), history?.updated ?? 0);
    liveRef.current = { key, history: historyCandles, candles: merged };
    return merged;
  }, [historyCandles, flow.snapshot, symbol, contractToken, timeframe, flow.live, key, history?.updated]);

  const flowMap = useMemo(() => new Map((snapshot?.bars ?? []).map(bar => [bar.t, bar] as const)), [snapshot]);
  const bars = useMemo<TerminalBar[]>(() => candles.map(candle => {
    const time = candleTime(candle);
    return { time, o: candle.o, h: candle.h, l: candle.l, c: candle.c, v: candle.v, oi: candle.oi ?? flowMap.get(time)?.oi ?? null };
  }), [candles, flowMap]);
  const closed = bars.length && barClose(bars[bars.length - 1].time, timeframe) > now / 1000 ? bars.length - 1 : bars.length;
  const indicators = useMemo(() => {
    const closes = bars.map(bar => bar.c);
    const emas = Object.fromEntries(EMA_PERIODS.map(period => [period, ema(closes, period)])) as Record<EmaPeriod, (number | null)[]>;
    return { emas, vwap: sessionVwap(bars), atr: atr(bars), oiChange: oiChanges(bars) };
  }, [bars]);
  const structure = useMemo(() => {
    const last = bars[bars.length - 1];
    const prevDay = previousDay(bars);
    const levels = last ? supportResistance(bars, closed, last.c, indicators.atr[bars.length - 1]) : { supports: [], resistances: [] };
    const marks: Mark[] = [
      ...crossovers(indicators.emas[9], indicators.emas[21], closed, 'EMA 9/21', bars),
      ...crossovers(indicators.emas[50], indicators.emas[200], closed, 'EMA 50/200', bars),
      ...pricePatterns(bars, closed, indicators.atr),
      ...liquiditySweeps(bars, closed, prevDay),
    ].sort((a, b) => a.index - b.index);
    return { prevDay, levels, marks };
  }, [bars, closed, indicators]);
  const higher = useMemo(() => HIGHER[timeframe].map(minutes => ({
    label: timeframeLabel(minutes as Intraday), ...trendBias(resample(bars.slice(0, closed), minutes)),
  })), [bars, closed, timeframe]);
  const fresh = freshness({
    nowMs: now, lastTick: snapshot?.lastTick ?? null, historyUpdated: history?.updated ?? null,
    streamLive: flow.live, inSession: isCashSession(now),
  });
  const freshState = fresh.state;
  const dom = snapshot?.dom && snapshot.dom.token === contractToken ? snapshot.dom : null;
  const events = snapshot?.events ?? EMPTY_EVENTS;
  const signals = useMemo(() => {
    if (!bars.length || !closed) return { confirmed: null, early: null };
    const context = {
      bars, ...indicators, levels: structure.levels, prevDay: structure.prevDay, marks: structure.marks, flow: flowMap,
      events, dom, higherTimeframes: higher, tickSize: contract?.tickSize ?? 0.05, intervalSeconds: timeframe * 60,
      freshness: { state: freshState, tickAge: null, historyAge: null, label: '' } as Freshness,
    };
    return {
      confirmed: evaluateSignal(context, closed - 1, 'CONFIRMED'),
      early: closed < bars.length ? evaluateSignal(context, bars.length - 1, 'EARLY') : null,
    };
  }, [bars, closed, indicators, structure, flowMap, events, dom, higher, contract?.tickSize, timeframe, freshState]);

  // ── charts (created once; all updates are imperative) ──
  const mainRef = useRef<HTMLDivElement>(null);
  const deltaRef = useRef<HTMLDivElement>(null);
  const oiRef = useRef<HTMLDivElement>(null);
  const runtime = useRef<Runtime | null>(null);
  const previous = useRef<{ key: string; candles: Candle[] }>({ key: '', candles: [] });
  const centeredKey = useRef('');

  useEffect(() => {
    const mainEl = mainRef.current, deltaEl = deltaRef.current, oiEl = oiRef.current;
    if (!mainEl || !deltaEl || !oiEl) return;
    const base = (el: HTMLElement, timeVisible: boolean) => createChart(el, {
      width: el.clientWidth, height: el.clientHeight,
      layout: { background: { type: ColorType.Solid, color: '#00111c' }, textColor: '#94aabd', fontSize: 11 },
      grid: { vertLines: { color: '#0a2433' }, horzLines: { color: '#0a2433' } },
      rightPriceScale: { minimumWidth: 86, borderColor: '#103044' },
      leftPriceScale: { visible: false },
      timeScale: { visible: timeVisible, timeVisible: true, secondsVisible: false, rightOffset: 6, borderColor: '#103044' },
      localization: { timeFormatter: (time: number) => new Date(time * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }) },
      crosshair: { mode: CrosshairMode.Normal },
    });
    const main = base(mainEl, true);
    const delta = base(deltaEl, false);
    const oi = base(oiEl, false);
    main.applyOptions({
      rightPriceScale: { scaleMargins: { top: .08, bottom: .2 } },
      timeScale: { tickMarkFormatter: (time: number) => clock(time) },
    });
    const candles = main.addCandlestickSeries({
      upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false,
    });
    const orderFlow = new OrderFlowPrimitive({ detail: true, footprint: true, basisAdjust: false, strip: { top: 0, bottom: 0 }, plan: false });
    candles.attachPrimitive(orderFlow);
    const levelBattle = new LevelBattlePrimitive();
    candles.attachPrimitive(levelBattle);
    const volume = main.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false });
    volume.priceScale().applyOptions({ scaleMargins: { top: .84, bottom: 0 }, visible: false });
    const vwap = main.addLineSeries({ title: 'VWAP', color: '#ffc45c', lineWidth: 2, priceLineVisible: false, crosshairMarkerVisible: false });
    const emas = Object.fromEntries(EMA_PERIODS.map(period => [period, main.addLineSeries({
      title: `EMA ${period}`, color: EMA_COLORS[period], lineWidth: period >= 100 ? 2 : 1,
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    })])) as Record<EmaPeriod, ISeriesApi<'Line'>>;
    const deltaBars = delta.addHistogramSeries({ title: 'Δ (est.)', priceFormat: { type: 'volume' }, priceLineVisible: false });
    const cvd = delta.addLineSeries({ title: 'CVD', color: '#ffb547', lineWidth: 2, priceScaleId: 'cvd', priceLineVisible: false, lastValueVisible: false });
    cvd.priceScale().applyOptions({ visible: false, scaleMargins: { top: .1, bottom: .1 } });
    const oiLine = oi.addLineSeries({ title: 'OI', color: '#60a5fa', lineWidth: 2, priceFormat: { type: 'volume' }, priceLineVisible: false });
    const oiChange = oi.addHistogramSeries({ priceScaleId: 'oichg', priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false });
    oiChange.priceScale().applyOptions({ visible: false, scaleMargins: { top: .55, bottom: 0 } });
    runtime.current = { main, delta, oi, candles, volume, vwap, emas, deltaBars, cvd, oiLine, oiChange, orderFlow, levelBattle, lines: new Map() };
    previous.current = { key: '', candles: [] };
    centeredKey.current = '';

    const panes: [IChartApi, HTMLElement, ISeriesApi<'Candlestick'> | ISeriesApi<'Histogram'> | ISeriesApi<'Line'>][] =
      [[main, mainEl, candles], [delta, deltaEl, deltaBars], [oi, oiEl, oiLine]];
    const unsubscribers: (() => void)[] = [];
    // Only the pane under the pointer may drive the others; data loads in the delta/OI panes otherwise
    // emit stale ranges (their empty-data right offset) that would drag the price chart off its candles.
    let driver: IChartApi = main;
    for (const [chart, el] of panes) {
      const enter = () => { driver = chart; };
      const leave = () => { if (driver === chart) driver = main; };
      el.addEventListener('pointerenter', enter);
      el.addEventListener('pointerleave', leave);
      unsubscribers.push(() => {
        el.removeEventListener('pointerenter', enter);
        el.removeEventListener('pointerleave', leave);
      });
    }
    for (const [chart] of panes) {
      const onRange = (range: LogicalRange | null) => {
        if (!range || chart !== driver) return;
        for (const [other, el] of panes) if (other !== chart) synchronizeChartRange(other, el, range);
      };
      const onCrosshair = (event: MouseEventParams) => {
        hover.set(typeof event.time === 'number' ? event.time : null);
        for (const [other, el, series] of panes) if (other !== chart) synchronizeCrosshair(other, series, el, event);
      };
      chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
      chart.subscribeCrosshairMove(onCrosshair);
      unsubscribers.push(() => {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
        chart.unsubscribeCrosshairMove(onCrosshair);
      });
    }
    const observer = new ResizeObserver(() => {
      for (const [chart, el] of panes) resizeChartIfChanged(chart, el);
      if (centeredKey.current === 'pending') {
        if (centerLatestCandle(main, mainEl, previous.current.candles.length)) centeredKey.current = previous.current.key;
      }
    });
    for (const [, el] of panes) observer.observe(el);
    return () => {
      observer.disconnect();
      unsubscribers.forEach(fn => fn());
      main.remove(); delta.remove(); oi.remove();
      runtime.current = null;
    };
  }, [hover]);

  // Candles, volume, VWAP, EMAs: incremental update of the changed tail only.
  useEffect(() => {
    const api = runtime.current;
    if (!api) return;
    const prior = previous.current;
    const from = prior.key === key ? futuresChangedFrom(prior.candles, candles) : -1;
    if (from >= 0 && from >= candles.length) return;
    const start = from < 0 ? 0 : from;
    const time = (index: number) => bars[index].time as UTCTimestamp;
    const apply = <S extends 'Candlestick' | 'Histogram' | 'Line'>(series: ISeriesApi<S>, rows: Parameters<ISeriesApi<S>['update']>[0][]) => {
      if (from < 0) series.setData(rows as Parameters<ISeriesApi<S>['setData']>[0]);
      else rows.forEach(row => series.update(row));
    };
    const range = Array.from({ length: bars.length - start }, (_, i) => start + i);
    apply(api.candles, range.map(i => ({ time: time(i), open: bars[i].o, high: bars[i].h, low: bars[i].l, close: bars[i].c })));
    apply(api.volume, range.map(i => ({ time: time(i), value: bars[i].v, color: bars[i].c >= bars[i].o ? '#00bba555' : '#ee405355' })));
    const line = (values: readonly (number | null)[]) => range.map(i => values[i] == null ? { time: time(i) } : { time: time(i), value: values[i]! });
    apply(api.vwap, line(indicators.vwap));
    for (const period of EMA_PERIODS) apply(api.emas[period], line(indicators.emas[period]));
    // Live order-flow bars can paint before the history arrives; when history is prepended the
    // old viewport points past the data, so re-center instead of leaving the latest bar pinned left.
    const prepended = from < 0 && prior.key === key && prior.candles.length > 0 && candles.length > 0 &&
      candleTime(candles[0]) < candleTime(prior.candles[0]);
    previous.current = { key, candles };
    if (candles.length && (centeredKey.current !== key || prepended)) {
      api.main.priceScale('right').applyOptions({ autoScale: true });
      centeredKey.current = centerLatestCandle(api.main, mainRef.current!, candles.length) ? key : 'pending';
    }
  }, [candles, bars, indicators, key]);

  // Delta / CVD and OI panes: whitespace where nothing was recorded so logical indexes stay aligned.
  useEffect(() => {
    const api = runtime.current;
    if (!api) return;
    const frame = requestAnimationFrame(() => {
      const time = (bar: TerminalBar) => bar.time as UTCTimestamp;
      api.deltaBars.setData(bars.map(bar => {
        const item = flowMap.get(bar.time);
        return item ? { time: time(bar), value: item.d, color: item.d >= 0 ? (item.complete ? '#00d39bcc' : '#00d39b66') : (item.complete ? '#ff4d5ecc' : '#ff4d5e66') } : { time: time(bar) };
      }));
      api.cvd.setData(bars.map(bar => {
        const item = flowMap.get(bar.time);
        return item ? { time: time(bar), value: item.cvd } : { time: time(bar) };
      }));
      api.oiLine.setData(bars.map(bar => bar.oi === null ? { time: time(bar) } : { time: time(bar), value: bar.oi }));
      api.oiChange.setData(bars.map((bar, i) => {
        const change = indicators.oiChange[i];
        return change === null ? { time: time(bar) } : { time: time(bar), value: change, color: change >= 0 ? '#60a5fa88' : '#f9731688' };
      }));
      const range = api.main.timeScale().getVisibleLogicalRange();
      if (range) {
        if (deltaRef.current) synchronizeChartRange(api.delta, deltaRef.current, range);
        if (oiRef.current) synchronizeChartRange(api.oi, oiRef.current, range);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [bars, flowMap, indicators]);

  useEffect(() => {
    runtime.current?.orderFlow.setData(prefs.orderFlow && snapshot?.interval === timeframe ? snapshot : null);
  }, [snapshot, prefs.orderFlow, timeframe]);

  useEffect(() => {
    const api = runtime.current;
    if (!api) return;
    api.vwap.applyOptions({ visible: prefs.vwap });
    api.volume.applyOptions({ visible: prefs.volume });
    for (const period of EMA_PERIODS) api.emas[period].applyOptions({ visible: prefs.ema[period] });
  }, [prefs]);

  // Markers and price lines.
  const confirmed = signals.confirmed;
  const early = signals.early;
  useEffect(() => {
    const api = runtime.current;
    if (!api) return;
    const markers: SeriesMarker<Time>[] = [];
    for (const mark of structure.marks) {
      if ((mark.kind === 'cross' && !prefs.crosses) || (mark.kind === 'pattern' && !prefs.patterns) || (mark.kind === 'sweep' && !prefs.sweeps)) continue;
      const bar = bars[mark.index];
      if (!bar) continue;
      const buy = mark.side === 'BUY';
      markers.push({
        time: bar.time as UTCTimestamp, position: buy ? 'belowBar' : 'aboveBar',
        shape: mark.kind === 'cross' ? (buy ? 'arrowUp' : 'arrowDown') : mark.kind === 'sweep' ? 'square' : 'circle',
        color: mark.kind === 'sweep' ? (buy ? '#22d3ee' : '#f472b6') : buy ? UP : DOWN,
        text: mark.label, size: mark.kind === 'pattern' ? 0.6 : 1,
      });
    }
    const proTrades = pro.contract?.token === contractToken ? pro.replay?.trades ?? [] : [];
    if (prefs.plan) {
      const times = bars.map(bar => bar.time);
      for (const trade of proTrades) {
        const buy = trade.side === 'BUY';
        const entryAt = snapTime(times, trade.entryTime ?? trade.signalTime, timeframe * 60);
        if (entryAt !== null) markers.push({
          time: entryAt as UTCTimestamp, position: buy ? 'belowBar' : 'aboveBar', shape: buy ? 'arrowUp' : 'arrowDown',
          color: buy ? '#00ffa3' : '#ff2e4d', text: `✔ ${trade.side} ${trade.entry.toFixed(1)}`, size: 2,
        });
        const exitAt = trade.exitTime !== undefined ? snapTime(times, trade.exitTime, timeframe * 60) : null;
        if (exitAt !== null && trade.points !== undefined) markers.push({
          time: exitAt as UTCTimestamp, position: buy ? 'aboveBar' : 'belowBar', shape: 'square',
          color: trade.points >= 0 ? '#00d39b' : '#ff4d5e',
          text: `EXIT ${trade.exitReason} ${trade.points >= 0 ? '+' : ''}${trade.points.toFixed(1)}`, size: 1,
        });
      }
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    api.candles.setMarkers(markers);

    const lines: LineSpec[] = [];
    const pd: PrevDay | null = structure.prevDay;
    if (prefs.pdhl && pd) {
      lines.push({ id: 'pdh', price: pd.high, color: '#fb923c', title: 'PDH' }, { id: 'pdl', price: pd.low, color: '#fb923c', title: 'PDL' },
        { id: 'pdc', price: pd.close, color: '#94a3b8', title: 'PDC', style: LineStyle.Dotted });
    }
    if (prefs.levels) {
      structure.levels.resistances.forEach((level, i) => lines.push({ id: `r${i}`, price: level.price, color: '#f8717188', title: `R${i + 1}`, style: LineStyle.SparseDotted }));
      structure.levels.supports.forEach((level, i) => lines.push({ id: `s${i}`, price: level.price, color: '#34d39988', title: `S${i + 1}`, style: LineStyle.SparseDotted }));
    }
    // Plan lines only for a gate-confirmed open trade; partial or forming-bar setups never draw an entry.
    const open = proTrades.find(trade => trade.status === 'open');
    if (prefs.plan && open) {
      lines.push(
        { id: 'entryA', price: open.entry, color: '#e2e8f0', title: `PRO ${open.side}`, style: LineStyle.Solid },
        { id: 'sl', price: open.t1Hit ? open.entry : open.stop, color: '#ff4d5e', title: open.t1Hit ? 'SL (BE)' : 'SL', style: LineStyle.Solid, width: 2 },
        { id: 't0', price: open.t1, color: '#00d39b', title: 'T1', style: LineStyle.Solid },
        { id: 't1', price: open.t2, color: '#00d39b', title: 'T2', style: LineStyle.Solid },
      );
    }
    syncPriceLines(api.candles, api.lines, lines);
  }, [structure, bars, prefs, pro.contract?.token, pro.replay, contractToken, timeframe]);

  const battle = useLevelBattle(pro, bars, {
    intraday: true, vwap: true, offset: contractToken !== undefined && pro.contract?.token === contractToken ? 0 : null,
  });
  useEffect(() => { runtime.current?.levelBattle.setData(battle.active); }, [battle]);

  const toggleFootprint = () => {
    const api = runtime.current;
    if (!api || !mainRef.current) return;
    const next = !footprint;
    setFootprint(next);
    api.main.timeScale().applyOptions({ barSpacing: next ? 72 : 8 });
    if (next) api.main.timeScale().scrollToRealTime();
    else centerLatestCandle(api.main, mainRef.current, candles.length);
  };
  const goLatest = () => {
    const api = runtime.current;
    if (api && mainRef.current) centerLatestCandle(api.main, mainRef.current, candles.length);
  };

  const today = bars.length ? istDay(bars[bars.length - 1].time) : 0;
  const last = bars[bars.length - 1];
  const flowBars = snapshot?.bars.length ?? 0;
  const flowDay = snapshot && flowBars ? istDay(snapshot.bars[flowBars - 1].t) : today;
  const sessionFlow = useMemo(() => snapshot ? sessionDominance(snapshot.bars, flowDay) : null, [snapshot, flowDay]);
  const flowStatus = orderFlowStatus(snapshot, flow.snapshot?.recordedToken ?? null, flow.live, isCashSession(now));
  const firstToday = bars.find(bar => istDay(bar.time) === today && bar.oi !== null);
  const dayOiChange = last?.oi != null && firstToday?.oi != null ? last.oi - firstToday.oi : null;
  const panelData = useMemo(() => ({ bars, flowMap, ...indicators }), [bars, flowMap, indicators]);

  return <section className={styles.terminal} aria-label="Futures advanced chart terminal">
    <IndexTabList idPrefix="futures-terminal-index" label="Futures terminal index" activeSymbol={symbol}
      panelId="futures-terminal-content" onSelect={next => { if (next !== symbol) { setSymbol(next); setToken(null); } }} />
    <div id="futures-terminal-content" role="tabpanel" aria-labelledby={`futures-terminal-index-tab-${symbol}`} className={styles.body}>
      <div className={styles.toolbar}>
        <label className={styles.field}><span>Contract</span>
          <select value={contract?.token ?? ''} disabled={!items.length} onChange={event => setToken(Number(event.target.value))}>
            {!items.length && <option value="">{contractsLoading ? 'Loading…' : 'No listed contracts'}</option>}
            {items.map(item => <option key={item.token} value={item.token}>{item.tradingSymbol} · {formatExpiry(item.expiry)}</option>)}
          </select>
        </label>
        <div className={styles.segment} role="group" aria-label="Timeframe">
          {TIMEFRAMES.map(item => <button key={item} aria-pressed={timeframe === item} onClick={() => setTimeframe(item)}>{timeframeLabel(item)}</button>)}
        </div>
        <button className={styles.tool} aria-pressed={footprint} onClick={toggleFootprint} disabled={!flowBars}
          title={flowBars ? 'Zoom in until bid × ask footprint cells are visible on every candle' : 'Footprint needs recorded order flow'}>Footprint</button>
        <button className={styles.tool} onClick={goLatest}>Latest</button>
        <button className={styles.tool} onClick={() => setRetry(value => value + 1)}>Refresh</button>
        <details className={styles.settings}>
          <summary className={styles.tool}>Customize</summary>
          <div className={styles.settingsMenu}>
            <fieldset><legend>EMAs</legend>
              {EMA_PERIODS.map(period => <label key={period}><input type="checkbox" checked={prefs.ema[period]}
                onChange={event => updatePrefs(p => ({ ...p, ema: { ...p.ema, [period]: event.target.checked } }))} />
                <i style={{ background: EMA_COLORS[period] }} />EMA {period}</label>)}
            </fieldset>
            <fieldset><legend>Overlays & panels</legend>
              {PREF_LABELS.map(([id, label]) => <label key={id}><input type="checkbox" checked={prefs[id]}
                onChange={event => updatePrefs(p => ({ ...p, [id]: event.target.checked }))} />{label}</label>)}
            </fieldset>
            <button className={styles.tool} onClick={() => updatePrefs(() => DEFAULT_PREFS)}>Reset defaults</button>
          </div>
        </details>
        <DeltaStrengthBox symbol={symbol} active={active} decision={pro.decision} />
        <FreshnessBadge lastTick={snapshot?.lastTick ?? null} historyUpdated={history?.updated ?? null} live={flow.live} />
      </div>

      {(contractError || historyError) && <p role="alert" className={styles.alert}>{contractError || historyError} Displayed data may be stale.</p>}
      {!contractError && !contract && <p role="status" className={styles.note}>
        {contractsLoading ? 'Loading futures contracts…' : 'Zerodha returned no listed futures for this index. Nothing has been substituted.'}</p>}

      <div className={styles.quote}>
        <strong>{contract?.tradingSymbol ?? symbol}</strong>
        <span className={styles.ltp}>{price(dom?.ltp ?? last?.c)}</span>
        {structure.prevDay && last && <span className={last.c >= structure.prevDay.close ? styles.bull : styles.bear}>
          {signed(last.c - structure.prevDay.close, price)} ({signed(((last.c - structure.prevDay.close) / structure.prevDay.close) * 100, (v: number | null | undefined) => (v ?? 0).toFixed(2))}%)</span>}
        <span>OI {qty(last?.oi ?? dom?.oi)}{dayOiChange !== null && <> · day {signed(dayOiChange)}</>}</span>
        <span>VWAP {price(indicators.vwap[bars.length - 1])}</span>
        <span title="Session share of classified volume (aggressor side estimated, Lee-Ready)">
          Buy/Sell {sessionFlow ? `${sessionFlow.buyPct.toFixed(0)}% / ${sessionFlow.sellPct.toFixed(0)}%` : 'not recorded'}</span>
        <span>CVD {snapshot ? signed(snapshot.summary.cvd) : '—'}</span>
        {contract && <span className={styles.muted}>Lot {contract.lotSize} · tick {contract.tickSize}</span>}
        <span className={`${styles.badge} ${fresh.state === 'LIVE' ? styles.bull : fresh.state === 'STALE' ? styles.bear : styles.neutral}`}>{fresh.label}</span>
        <span className={styles.mtf} aria-label="Multi-timeframe trend">
          <span>{timeframeLabel(timeframe)} {confirmed ? <b className={biasClass(confirmed.bias)}>{confirmed.bias}</b> : '—'}</span>
          {higher.map(item => <span key={item.label} title={item.detail}>{item.label} <b className={biasClass(item.bias)}>{item.bias}</b></span>)}
        </span>
      </div>

      <div className={`${styles.layout} ${prefs.signal || prefs.dom || prefs.flow ? '' : styles.full}`}>
        <div className={styles.charts}>
          <div className={styles.mainWrap}>
            <div ref={mainRef} className={styles.mainChart} />
            <Legend prefs={prefs} />
            <span className={`${styles.flowChip} ${styles[flowStatus.tone]}`} title={flowStatus.detail}>
              <i />{flowStatus.text}</span>
            {flowStatus.tone === 'none' && prefs.orderFlow && <div className={styles.flowEmpty} role="status">
              <strong>{flowStatus.text}</strong><span>{flowStatus.detail}</span></div>}
          </div>
          <div className={styles.paneLabel} hidden={!prefs.deltaPane}>
            {flowBars ? 'Delta per bar & CVD · aggressor side estimated' : 'Delta & CVD · appears once order flow is recorded'}</div>
          <div ref={deltaRef} className={styles.subChart} hidden={!prefs.deltaPane || !flowBars} />
          <div className={styles.paneLabel} hidden={!prefs.oiPane}>Open interest & change per bar · blank where the exchange did not report OI</div>
          <div ref={oiRef} className={styles.subChart} hidden={!prefs.oiPane} />
        </div>
        <aside className={styles.side}>
          <ProSignalPanel pro={pro} open />
          <LevelBattlePanel state={battle} />
          {prefs.signal && <SignalPanel confirmed={confirmed} early={early} fresh={fresh} />}
          {prefs.flow && <BarPanel hover={hover} data={panelData} timeframe={timeframe} />}
          {prefs.dom && <DomPanel dom={dom} recordedOther={flow.snapshot?.recordedToken != null} />}
        </aside>
      </div>
      {prefs.info && <InfoPanels prevDay={structure.prevDay} levels={structure.levels} zones={snapshot?.zones ?? EMPTY_ZONES}
        profile={snapshot?.profile ?? null} marks={structure.marks} events={events} bars={bars} />}
      <details className={styles.disclaimer}>
        <summary>Analytical suggestions only — this terminal never places orders. Data notes</summary>
        Not predictions, guarantees or investment advice; every trading decision is manual.
        Buyer/seller volume is executed futures volume whose aggressor side is <em>estimated</em> by the backend (Lee-Ready quote/tick rule on ~1s
        KiteTicker full-mode snapshots) — Zerodha does not publish trade-level aggressor flags. Bid/ask quantities and walls are <em>pending</em> depth
        orders that can be modified or pulled. Candles without a recording show no flow values; nothing is inferred from OHLC.
      </details>
    </div>
  </section>;
}

const Legend = memo(function Legend({ prefs }: { prefs: Prefs }) {
  return <div className={styles.legend}>
    {prefs.vwap && <span><i style={{ background: '#ffc45c' }} />VWAP</span>}
    {EMA_PERIODS.filter(period => prefs.ema[period]).map(period => <span key={period}><i style={{ background: EMA_COLORS[period] }} />EMA {period}</span>)}
    {prefs.pdhl && <span><i style={{ background: '#fb923c' }} />PDH/PDL</span>}
    {prefs.sweeps && <span><i style={{ background: '#22d3ee' }} />Sweep</span>}
  </div>;
});

const FreshnessBadge = memo(function FreshnessBadge({ lastTick, historyUpdated, live }: { lastTick: number | null; historyUpdated: number | null; live: boolean }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const state = freshness({ nowMs: now, lastTick, historyUpdated, streamLive: live, inSession: isCashSession(now) });
  return <span className={styles.freshness} role="status" aria-live="off">
    <i className={state.state === 'LIVE' ? styles.dotLive : state.state === 'STALE' ? styles.dotStale : styles.dotWarn} />
    {state.state} · tick {age(state.tickAge)} · history {age(state.historyAge)} · stream {live ? 'connected' : 'offline'}
  </span>;
});

const SignalPanel = memo(function SignalPanel({ confirmed, early, fresh }: {
  confirmed: TerminalSignal | null; early: TerminalSignal | null; fresh: Freshness;
}) {
  if (!confirmed) return <section className={styles.card}><h3>Score engine</h3><p className={styles.muted}>Waiting for candles…</p></section>;
  const warn = early && early.bias !== confirmed.bias && early.bias !== 'NEUTRAL';
  return <section className={styles.card} aria-label="Score engine">
    <h3>Score engine <small>closed bar {clock(confirmed.time)} · one input of the pro gate</small></h3>
    <div className={styles.signalHead}>
      <span className={`${styles.action} ${biasClass(confirmed.bias)}`}>{confirmed.bias}</span>
      <div className={styles.meter} title="Rule score 0-95, not a probability">
        <span>Score {confirmed.confidence}</span>
        <div><i className={biasClass(confirmed.bias)} style={{ width: `${confirmed.confidence}%` }} /></div>
        <small>Bull {confirmed.bullScore} · Bear {confirmed.bearScore}</small>
      </div>
    </div>
    <p className={styles.muted}>Bias only — not an order. BUY / SELL comes from the pro gate above when every check passes.</p>
    {warn && <div className={`${styles.early} ${biasClass(early!.bias)}`} role="status">
      ⚡ Forming bar: {early!.bias} bias building · score {early!.confidence}
      <small>Information only; can change before the candle closes. {early!.reasons.slice(0, 2).join(' · ')}</small>
    </div>}
    {confirmed.reasons.length > 0 && <><h4>Why</h4><ul>{confirmed.reasons.slice(0, 7).map(text => <li key={text}>{text}</li>)}</ul></>}
    {confirmed.against.length > 0 && <><h4>Against</h4><ul className={styles.against}>{confirmed.against.slice(0, 4).map(text => <li key={text}>{text}</li>)}</ul></>}
    {confirmed.cautions.length > 0 && <ul className={styles.cautions}>{confirmed.cautions.map(text => <li key={text}>{text}</li>)}</ul>}
    <p className={styles.tiny}>{fresh.label}. Suggestions only — no orders are placed.</p>
  </section>;
});

const BarPanel = memo(function BarPanel({ hover, data, timeframe }: {
  hover: HoverStore; timeframe: Intraday;
  data: { bars: TerminalBar[]; flowMap: Map<number, OrderFlowBar>; vwap: (number | null)[]; oiChange: (number | null)[] };
}) {
  const hovered = useSyncExternalStore(hover.subscribe, hover.get, hover.get);
  const index = hovered === null ? data.bars.length - 1 : data.bars.findIndex(bar => bar.time === hovered);
  const bar = data.bars[index];
  if (!bar) return null;
  const item = data.flowMap.get(bar.time);
  const share = dominance(item);
  const change = data.oiChange[index];
  const build = index > 0 ? oiBuildup(bar.c - data.bars[index - 1].c, change) : null;
  return <section className={styles.card} aria-label="Bar order flow">
    <h3>Bar {clock(bar.time)} <small>{timeframeLabel(timeframe)} · {hovered === null ? 'latest' : 'crosshair'}</small></h3>
    <dl className={styles.grid}>
      <div><dt>O / H</dt><dd>{price(bar.o)} / {price(bar.h)}</dd></div>
      <div><dt>L / C</dt><dd>{price(bar.l)} / {price(bar.c)}</dd></div>
      <div><dt>Volume</dt><dd>{qty(bar.v)}</dd></div>
      <div><dt>VWAP</dt><dd>{price(data.vwap[index])}</dd></div>
      <div><dt>OI</dt><dd>{bar.oi === null ? 'not reported' : qty(bar.oi)}</dd></div>
      <div><dt>OI change</dt><dd className={change === null ? '' : change >= 0 ? styles.bull : styles.bear}>{signed(change)}</dd></div>
    </dl>
    {build && <p className={styles.muted}>OI read: <b>{build}</b></p>}
    {item ? <>
      <div className={styles.dominance} aria-label="Buy versus sell dominance">
        <i className={styles.buyFill} style={{ width: `${share?.buyPct ?? 50}%` }} />
        <span>{share ? `Buy ${share.buyPct.toFixed(0)}% · Sell ${share.sellPct.toFixed(0)}%` : 'No classified volume'}</span>
      </div>
      <dl className={styles.grid}>
        <div><dt>Buy aggr. (est.)</dt><dd className={styles.bull}>{qty(item.b)}</dd></div>
        <div><dt>Sell aggr. (est.)</dt><dd className={styles.bear}>{qty(item.s)}</dd></div>
        <div><dt>Unclassified</dt><dd>{qty(item.n)}</dd></div>
        <div><dt>Delta / CVD</dt><dd>{signed(item.d)} / {signed(item.cvd)}</dd></div>
        <div><dt>Book bid/ask</dt><dd title="Average total pending bid ÷ ask quantity">{item.book === null ? '—' : `${item.book.toFixed(2)}×`}</dd></div>
        <div><dt>Coverage</dt><dd>{pct(item.coverage * 100)}{item.complete ? '' : ' (partial)'}</dd></div>
        <div><dt>POC</dt><dd>{price(item.poc)}</dd></div>
        <div><dt>Spread</dt><dd>{price(item.spread)}</dd></div>
      </dl>
      {item.flags.length > 0 && <p className={styles.flags}>{item.flags.map(flag => <span key={flag}>{flag.replace(/_/g, ' ')}</span>)}</p>}
    </> : <p className={styles.muted}>No recorded order flow for this candle (recording covers the near-month contract during live sessions only). No values are estimated from OHLC.</p>}
  </section>;
});

const DomPanel = memo(function DomPanel({ dom, recordedOther }: { dom: OrderFlowDom | null; recordedOther: boolean }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!dom) {
    return <section className={styles.card} aria-label="Market depth"><h3>DOM · 5-level depth</h3>
      <p className={styles.muted}>{recordedOther ? 'Depth is streamed for the near-month contract only — select it to view the book.' :
        'No live depth yet. It appears once the backend receives full-mode ticks for this contract.'}</p></section>;
  }
  const maxQty = Math.max(1, ...dom.bids.map(row => row[1]), ...dom.asks.map(row => row[1]));
  const imbalance = depthImbalance(dom);
  const spread = dom.asks[0] && dom.bids[0] ? dom.asks[0][0] - dom.bids[0][0] : null;
  const domAge = Math.max(0, now / 1000 - dom.ts);
  const row = (side: 'bid' | 'ask', [p, q, orders]: [number, number, number]) =>
    <div key={`${side}${p}`} className={`${styles.domRow} ${side === 'bid' ? styles.domBid : styles.domAsk}`}>
      <i style={{ width: `${(q / maxQty) * 100}%` }} />
      <span>{orders || '—'}</span><b>{price(p)}</b><span>{qty(q)}</span>
    </div>;
  return <section className={styles.card} aria-label="Market depth">
    <h3>DOM · 5-level depth <small className={domAge > 5 ? styles.bear : ''}>{age(domAge)} old</small></h3>
    <div className={styles.domHead}><span>Orders</span><span>Price</span><span>Qty</span></div>
    {[...dom.asks].reverse().map(item => row('ask', item))}
    <div className={styles.domSpread}>LTP {price(dom.ltp)} · spread {price(spread)}</div>
    {dom.bids.map(item => row('bid', item))}
    <dl className={styles.grid}>
      <div><dt>5-level imbalance</dt><dd className={imbalance === null ? '' : imbalance >= 0 ? styles.bull : styles.bear}>{imbalance === null ? '—' : `${imbalance > 0 ? '+' : ''}${imbalance.toFixed(0)}%`}</dd></div>
      <div><dt>Total bid / ask</dt><dd>{qty(dom.totalBid)} / {qty(dom.totalAsk)}</dd></div>
      <div><dt>OI (day H/L)</dt><dd>{qty(dom.oi)} ({qty(dom.oiHigh)}/{qty(dom.oiLow)})</dd></div>
    </dl>
    <p className={styles.tiny}>Pending orders only — not executed trades; quantities can be pulled at any time.</p>
  </section>;
});

const InfoPanels = memo(function InfoPanels({ prevDay, levels, zones, profile, marks, events, bars }: {
  prevDay: PrevDay | null; levels: { supports: Level[]; resistances: Level[] }; zones: OrderFlowZone[];
  profile: OrderFlowSnapshot['profile']; marks: Mark[]; events: OrderFlowEvent[]; bars: TerminalBar[];
}) {
  const feed = [
    ...marks.slice(-12).map(mark => ({ t: bars[mark.index]?.time ?? 0, side: mark.side, text: `${mark.label} @ ${price(mark.price)}`, source: 'price' })),
    ...events.filter(event => /absorption|exhaustion|failed|stacked/.test(event.kind)).slice(-12)
      .map(event => ({ t: event.t, side: event.side, text: `${event.kind.replace(/_/g, ' ')} @ ${price(event.price)}`, source: 'flow' })),
  ].sort((a, b) => b.t - a.t).slice(0, 12);
  return <div className={styles.info}>
    <section className={styles.card} aria-label="Key levels">
      <h3>Key levels</h3>
      <dl className={styles.grid}>
        <div><dt>Prev-day high</dt><dd>{price(prevDay?.high)}</dd></div>
        <div><dt>Prev-day low</dt><dd>{price(prevDay?.low)}</dd></div>
        <div><dt>Prev-day close</dt><dd>{price(prevDay?.close)}</dd></div>
        <div><dt>Session POC</dt><dd>{price(profile?.poc)}</dd></div>
        <div><dt>Value area</dt><dd>{profile ? `${price(profile.val)} – ${price(profile.vah)}` : '—'}</dd></div>
      </dl>
      <h4>Resistance</h4>
      <ul className={styles.levels}>{levels.resistances.length ? levels.resistances.map(level =>
        <li key={level.price}><b className={styles.bear}>{price(level.price)}</b> · {level.touches} touch{level.touches > 1 ? 'es' : ''}</li>) : <li>—</li>}</ul>
      <h4>Support</h4>
      <ul className={styles.levels}>{levels.supports.length ? levels.supports.map(level =>
        <li key={level.price}><b className={styles.bull}>{price(level.price)}</b> · {level.touches} touch{level.touches > 1 ? 'es' : ''}</li>) : <li>—</li>}</ul>
    </section>
    <section className={styles.card} aria-label="Liquidity zones">
      <h3>Liquidity walls <small>resting depth ≥ 3× median</small></h3>
      {zones.length ? <ul className={styles.levels}>{zones.slice(0, 8).map(zone => <li key={`${zone.side}${zone.price}`}>
        <b className={zone.side === 'bid' ? styles.bull : styles.bear}>{zone.side === 'bid' ? 'Bid' : 'Ask'} {price(zone.price)}</b>
        {' '}· {qty(zone.qty)} (max {qty(zone.maxQty)}) · {zone.status}</li>)}</ul> :
        <p className={styles.muted}>No persistent depth walls recorded this session.</p>}
    </section>
    <section className={styles.card} aria-label="Event feed">
      <h3>Event feed <small>sweeps · absorption · patterns · crosses</small></h3>
      {feed.length ? <ul className={styles.feed}>{feed.map((item, i) => <li key={`${item.t}${i}`}>
        <time>{clock(item.t)}</time><b className={biasClass(item.side === 'NEUTRAL' ? 'WAIT' : item.side)}>{item.side}</b>
        <span>{item.text}</span><small>{item.source === 'flow' ? 'recorded flow' : 'price action'}</small></li>)}</ul> :
        <p className={styles.muted}>No events yet.</p>}
    </section>
  </div>;
});
