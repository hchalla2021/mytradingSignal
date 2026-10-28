'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ColorType, CrosshairMode, createChart, LineStyle,
  type IChartApi, type IPriceLine, type ISeriesApi, type MouseEventParams, type UTCTimestamp,
} from 'lightweight-charts';
import { Columns4, LayoutGrid, Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import type { Candle, ChartIntelligenceData, SymbolChartData } from '@/hooks/useChartIntelligence';
import type { MarketData } from '@/hooks/useMarketSocket';
import { loadLatestChartHistory, prefetchChartHistory, readCachedChartHistory } from '@/hooks/useChartHistory';
import { useOrderFlow } from '@/hooks/useOrderFlow';
import {
  applyLiveTick, candleTime, isCashSession, mergeChartHistory, stableLiveSession, timeframeLabel, workspaceCandles,
  type ChartSymbol, type IndicatorSettings, type LiveTickExtremes,
} from '@/lib/chart-workspace';
import { createIndicatorEngine, createPivotEngine, indicatorLineTitle, type IndicatorSample } from '@/lib/chart-indicators';
import { futuresChangedFrom } from '@/lib/futures-chart-metrics';
import { mergeFuturesLiveCandles } from '@/lib/futures-live-candles';
import { centerLatestCandle, resizeChartIfChanged } from '@/lib/chart-render-sync';
import { atr, freshness, supportResistance, type TerminalBar } from '@/lib/futures-terminal';
import { applyFormingBar, detectSmartMoney, EMPTY_SMART_MONEY, type SmartMoney } from '@/lib/smart-money';
import { SmartMoneyPrimitive } from '@/lib/smart-money-primitive';
import type { OrderFlowSnapshot } from '@/lib/order-flow';
import {
  candleAt, closedCount, dailyFromIntraday, MTF_TIMEFRAMES, resampleFlowCandles, sessionBucket, type MtfTimeframe,
} from '@/lib/multi-timeframe';
import { formatExpiry, loadCandles, loadContracts, readCachedCandles, readCachedContracts, type FuturesContract } from './FuturesChart';
import { IndexTabList } from './IndexTabs';
import styles from './MultiTimeframeChart.module.css';

type Source = 'spot' | 'futures';
type Layout = 'grid' | 'row';
interface Prefs {
  ema9: boolean; ema20: boolean; ema50: boolean; ema100: boolean; ema200: boolean;
  vwap: boolean; rsi: boolean; cpr: boolean; pivots: boolean; levels: boolean; liquidity: boolean; volume: boolean;
}
// v2: every indicator starts enabled on all four timeframes.
const PREFS_KEY = 'mtfChartPrefs_v2';
const DEFAULT_PREFS: Prefs = {
  ema9: true, ema20: true, ema50: true, ema100: true, ema200: true,
  vwap: true, rsi: true, cpr: true, pivots: true, levels: true, liquidity: true, volume: true,
};
const PREF_LABELS: [keyof Prefs, string, string][] = [
  ['ema9', 'EMA 9', '#00cbb8'], ['ema20', 'EMA 20', '#008cff'], ['ema50', 'EMA 50', '#00bcd4'],
  ['ema100', 'EMA 100', '#ab47db'], ['ema200', 'EMA 200', '#ed277b'], ['vwap', 'VWAP', '#ffc45c'],
  ['rsi', 'RSI', '#c05bea'], ['cpr', 'CPR', '#ef355c'], ['pivots', 'Pivots', '#e9b85d'],
  ['levels', 'S/R', '#94a3b8'], ['liquidity', 'Liquidity', '#38bdf8'], ['volume', 'Volume', '#64748b'],
];
const EMA_COLORS = { ema9: '#00cbb8', ema20: '#008cff', ema50: '#00bcd4', ema100: '#ab47db', ema200: '#ed277b' } as const;
const EMA_KEYS = Object.keys(EMA_COLORS) as (keyof typeof EMA_COLORS)[];
const PIVOT_COLORS: Record<string, string> = { TC: '#ef355c', P: '#f59e0b', BC: '#ef355c' };
const UP = '#00bba5';
const DOWN = '#ee4053';
const EMPTY: Candle[] = [];
const REFRESH_MS = 20_000;

const loadPrefs = (): Prefs => {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    if (!saved || typeof saved !== 'object') return DEFAULT_PREFS;
    return Object.fromEntries(Object.entries(DEFAULT_PREFS).map(([key, value]) =>
      [key, typeof saved[key as keyof Prefs] === 'boolean' ? saved[key as keyof Prefs] : value])) as unknown as Prefs;
  } catch { return DEFAULT_PREFS; }
};
const price = (value: number | undefined) => value === undefined || !Number.isFinite(value) ? '--'
  : value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const clock = (time: number) => new Date(time * 1000).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
const points = (data: IndicatorSample[]) => data.map(point => ({ ...point, time: point.time as UTCTimestamp }));

/** Crosshair bus: maps the hovered bar to the bucket that contains it on every other timeframe. */
interface CrosshairTarget { chart: IChartApi; series: ISeriesApi<'Candlestick'>; candles: () => Candle[]; hover: (time: number | null) => void }
function createCrosshairBus() {
  const targets = new Map<MtfTimeframe, CrosshairTarget>();
  let syncing = false;
  return {
    register(tf: MtfTimeframe, target: CrosshairTarget) { targets.set(tf, target); return () => { targets.delete(tf); }; },
    publish(source: MtfTimeframe, time: number | null) {
      if (syncing) return;
      syncing = true;
      try {
        targets.forEach((target, tf) => {
          if (tf === source) return;
          const bucket = time === null ? null : sessionBucket(time, tf);
          const bar = bucket === null ? null : candleAt(target.candles(), bucket);
          if (bar && bucket !== null) target.chart.setCrosshairPosition(bar.c, bucket as UTCTimestamp, target.series);
          else target.chart.clearCrosshairPosition();
          target.hover(bar ? bucket : null);
        });
      } finally { syncing = false; }
    },
  };
}
type CrosshairBus = ReturnType<typeof createCrosshairBus>;

interface HistoryState { key: string; candles: Candle[]; daily: Candle[]; updated: number | null; error: string | null }

interface PanelProps {
  tf: MtfTimeframe;
  symbol: ChartSymbol;
  source: Source;
  contract: FuturesContract | undefined;
  active: boolean;
  prefs: Prefs;
  live: SymbolChartData | null;
  liveSession: string | null;
  tickPrice: number | undefined;
  tickTime: number;
  flow: OrderFlowSnapshot | null;
  flowLive: boolean;
  now: number;
  maximized: boolean;
  hidden: boolean;
  onMaximize: (tf: MtfTimeframe | null) => void;
  bus: CrosshairBus;
  syncCrosshair: boolean;
}

interface Runtime {
  chart: IChartApi;
  candles: ISeriesApi<'Candlestick'>;
  volume: ISeriesApi<'Histogram'>;
  rsi: ISeriesApi<'Line'>;
  vwap: ISeriesApi<'Line'>;
  emas: Record<string, ISeriesApi<'Line'>>;
  pivots: Map<string, ISeriesApi<'Line'>>;
  levels: IPriceLine[];
  smartMoney: SmartMoneyPrimitive;
}

const MtfPanel = memo(function MtfPanel({
  tf, symbol, source, contract, active, prefs, live, liveSession, tickPrice, tickTime, flow, flowLive, now,
  maximized, hidden, onMaximize, bus, syncCrosshair,
}: PanelProps) {
  const futures = source === 'futures';
  const token = contract?.token;
  const key = futures ? `F:${symbol}:${token ?? ''}:${tf}` : `S:${symbol}:${tf}`;
  const [retry, setRetry] = useState(0);
  const [history, setHistory] = useState<HistoryState>({ key: '', candles: EMPTY, daily: EMPTY, updated: null, error: null });
  const [hoverState, setHover] = useState<{ key: string; time: number | null }>({ key: '', time: null });
  const keyRef = useRef(key);
  keyRef.current = key;
  const containerRef = useRef<HTMLDivElement>(null);
  const runtime = useRef<Runtime | null>(null);
  const previous = useRef<{ key: string; candles: Candle[] }>({ key: '', candles: EMPTY });
  const indicatorEngine = useRef(createIndicatorEngine());
  const pivotEngine = useRef(createPivotEngine());
  const latest = useRef<Candle[]>(EMPTY);
  const syncRef = useRef(syncCrosshair);
  syncRef.current = syncCrosshair;
  // A fresh symbol/source/view gets a centred, auto-scaled range; retried until the panel has a real size.
  const viewPending = useRef(true);
  const resetView = useRef(() => {
    const api = runtime.current;
    const container = containerRef.current;
    if (!api || !container || !latest.current.length || !viewPending.current) return;
    api.chart.priceScale('right').applyOptions({ autoScale: true });
    if (centerLatestCandle(api.chart, container, latest.current.length)) viewPending.current = false;
  });

  // Instant paint from the caches other chart tabs already filled.
  const cached = useMemo<HistoryState | null>(() => {
    if (futures) {
      const saved = token === undefined ? undefined : readCachedCandles(symbol, token, tf)?.value;
      return saved ? { key, candles: saved.candles, daily: dailyFromIntraday(saved.candles), updated: saved.updated, error: null } : null;
    }
    const saved = readCachedChartHistory(symbol, tf)?.value;
    return saved ? { key, candles: saved.candles, daily: saved.dailyCandles, updated: null, error: null } : null;
  }, [futures, token, symbol, tf, key]);
  const current = history.key === key ? history : cached ?? { key, candles: EMPTY, daily: EMPTY, updated: null, error: null };

  useEffect(() => {
    if (!active || (futures && token === undefined)) return;
    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next: HistoryState = futures
          ? await loadCandles(symbol, token!, tf).then(page => ({
            key, candles: page.candles, daily: dailyFromIntraday(page.candles), updated: page.updated, error: null }))
          : await loadLatestChartHistory(symbol, tf).then(page => ({
            key, candles: page.candles, daily: page.dailyCandles, updated: Date.now(), error: null }));
        failures = 0;
        if (!cancelled) setHistory(next);
      } catch (error) {
        failures += 1;
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Unable to load candles.';
        setHistory(prior => prior.key === key ? { ...prior, error: message } : { ...(cached ?? { key, candles: EMPTY, daily: EMPTY, updated: null }), key, error: message });
      } finally {
        // Transient Kite failures recover quickly (2s, 4s, 8s…) instead of waiting a full refresh cycle.
        if (!cancelled) timer = setTimeout(() => void load(), failures ? Math.min(REFRESH_MS, 1000 * 2 ** failures) : REFRESH_MS);
      }
    };
    void load();
    return () => { cancelled = true; clearTimeout(timer); };
    // `cached` is only an error fallback; reloading on its identity would double-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, futures, symbol, token, tf, key, retry]);

  // ── live merge ──
  const liveTf = useMemo(() => futures ? EMPTY : workspaceCandles(live, tf), [futures, tf, live]);
  const extremes = useRef<{ key: string; value: LiveTickExtremes | null }>({ key: '', value: null });
  const futuresBase = useRef({ key: '', history: EMPTY, candles: EMPTY });
  const candles = useMemo(() => {
    const nowMs = Date.now();
    if (futures) {
      const prior = futuresBase.current;
      const base = prior.key === key && prior.history === current.candles ? prior.candles : current.candles;
      const merged = mergeFuturesLiveCandles(base, flow, symbol, token, tf, flowLive, nowMs, current.updated ?? 0);
      futuresBase.current = { key, history: current.candles, candles: merged };
      return merged;
    }
    const merged = liveTf.length ? mergeChartHistory(current.candles, liveTf, liveSession) : current.candles;
    if (tickPrice === undefined || !isCashSession(nowMs) || !(Math.abs(nowMs / 1000 - tickTime) < 60)) return merged;
    const tracked = extremes.current.key === key ? extremes.current.value : null;
    const result = applyLiveTick(merged, { price: tickPrice, time: tickTime }, tf, tracked);
    extremes.current = { key, value: result.extremes };
    return result.candles;
  }, [futures, key, current.candles, current.updated, flow, symbol, token, tf, flowLive, liveTf, liveSession, tickPrice, tickTime]);
  latest.current = candles;

  // ── indicators ──
  const settings = useMemo<IndicatorSettings>(() => ({
    ema9: prefs.ema9, ema20: prefs.ema20, ema50: prefs.ema50, ema100: prefs.ema100, ema200: prefs.ema200,
    supertrend: false, emaCross: false, camarilla: false, volume: futures && prefs.volume,
    // Index volume is zero, so VWAP is only meaningful on futures.
    vwap: futures && prefs.vwap, pivots: prefs.pivots, cpr: prefs.cpr, rsi: prefs.rsi, macd: false, atr: false,
  }), [prefs, futures]);
  const calculation = useMemo(() => indicatorEngine.current.calculate(candles, settings, true), [candles, settings]);
  const pivots = useMemo(() => pivotEngine.current.calculate(candles, current.daily, tf, settings), [candles, current.daily, tf, settings]);
  const bars = useMemo<TerminalBar[]>(() => candles.map(candle => ({
    time: candleTime(candle), o: candle.o, h: candle.h, l: candle.l, c: candle.c, v: candle.v, oi: candle.oi ?? null,
  })), [candles]);
  const closed = closedCount(bars.length ? [bars[bars.length - 1].time] : [], tf, now / 1000) < 1 ? bars.length - 1 : bars.length;
  const atrValues = useMemo(() => atr(bars), [bars]);
  const lastClosed = closed > 0 ? bars[closed - 1] : undefined;
  const structureSignature = `${key}|${closed}|${bars[0]?.time}|${lastClosed?.time}|${lastClosed?.h}|${lastClosed?.l}|${lastClosed?.c}`;
  const structureCache = useRef<{ signature: string; levels: ReturnType<typeof supportResistance>; smc: SmartMoney }>(
    { signature: '', levels: { supports: [], resistances: [] }, smc: EMPTY_SMART_MONEY });
  if (structureCache.current.signature !== structureSignature) {
    const closePrice = lastClosed?.c ?? 0;
    structureCache.current = {
      signature: structureSignature,
      levels: closed > 0 ? supportResistance(bars, closed, closePrice, atrValues[closed - 1]) : { supports: [], resistances: [] },
      smc: detectSmartMoney(bars, closed, atrValues),
    };
  }
  const smc = useMemo(() => applyFormingBar(structureCache.current.smc, bars, closed),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [structureSignature, bars, closed]);

  // ── chart lifecycle ──
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      width: container.clientWidth, height: container.clientHeight || 300,
      layout: { background: { type: ColorType.Solid, color: '#00111c' },       textColor: '#8aa3b8', fontSize: 11, fontFamily: 'Inter, system-ui, Arial, sans-serif', attributionLogo: tf === 30 },
            grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(48, 70, 87, .35)', style: LineStyle.Dotted } },
            rightPriceScale: { borderVisible: false, minimumWidth: 64 },
            timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 4, barSpacing: 7, tickMarkFormatter: (time: number) => clock(time) },
      localization: { timeFormatter: (time: number) => new Date(time * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }) },
      crosshair: { mode: CrosshairMode.Magnet, vertLine: { color: '#6a8b9f', labelBackgroundColor: '#123d56' }, horzLine: { color: '#6a8b9f', labelBackgroundColor: '#123d56' } },
    });
    const candleSeries = chart.addCandlestickSeries({ upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false });
    const smartMoney = new SmartMoneyPrimitive();
    candleSeries.attachPrimitive(smartMoney);
    const volume = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false });
    volume.priceScale().applyOptions({ scaleMargins: { top: .86, bottom: 0 }, visible: false });
    const rsi = chart.addLineSeries({ priceScaleId: 'rsi', title: 'RSI 14', color: '#c05bea', lineWidth: 1, priceLineVisible: false,
      autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
    rsi.priceScale().applyOptions({ scaleMargins: { top: .8, bottom: .02 }, visible: false });
    for (const level of [30, 70]) rsi.createPriceLine({ price: level, color: '#77638b', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false });
    const vwap = chart.addLineSeries({ title: 'VWAP', color: '#ffc45c', lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const emas = Object.fromEntries(EMA_KEYS.map(id => [id, chart.addLineSeries({
      color: EMA_COLORS[id], lineWidth: id === 'ema200' ? 2 : 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    })]));
    runtime.current = { chart, candles: candleSeries, volume, rsi, vwap, emas, pivots: new Map(), levels: [], smartMoney };
    previous.current = { key: '', candles: EMPTY };
    const hover = (time: number | null) => setHover({ key: keyRef.current, time });
    const unregister = bus.register(tf, { chart, series: candleSeries, candles: () => latest.current, hover });
    const onMove = (event: MouseEventParams) => {
      // Programmatic (synced) moves have no sourceEvent; the bus already updated this panel's readout.
      if (!event.sourceEvent && event.time !== undefined) return;
      const time = typeof event.time === 'number' ? event.time : null;
      hover(time);
      if (syncRef.current) bus.publish(tf, time);
    };
    chart.subscribeCrosshairMove(onMove);
    const observer = new ResizeObserver(() => { resizeChartIfChanged(chart, container); resetView.current(); });
    observer.observe(container);
    return () => {
      observer.disconnect();
      unregister();
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      runtime.current = null;
    };
  }, [bus, tf]);

  // Candles + volume: incremental `update` for the forming/new bar, full `setData` only on history changes.
  useEffect(() => {
    const api = runtime.current;
    const container = containerRef.current;
    if (!api || !container) return;
    const prior = previous.current;
    const from = prior.key === key && prior.candles.length ? futuresChangedFrom(prior.candles, candles) : -1;
    const toBar = (candle: Candle) => ({ time: candleTime(candle) as UTCTimestamp, open: candle.o, high: candle.h, low: candle.l, close: candle.c });
    const toVolume = (candle: Candle) => ({ time: candleTime(candle) as UTCTimestamp, value: candle.v,
      color: candle.c >= candle.o ? 'rgba(0,187,165,.45)' : 'rgba(238,64,83,.45)' });
    const showVolume = futures && prefs.volume;
    if (from < 0) {
      api.candles.setData(candles.map(toBar));
      api.volume.setData(showVolume ? candles.map(toVolume) : []);
      if (prior.key !== key) viewPending.current = true;
    } else {
      for (let index = from; index < candles.length; index++) {
        api.candles.update(toBar(candles[index]));
        if (showVolume) api.volume.update(toVolume(candles[index]));
      }
    }
    previous.current = { key, candles };
    api.chart.priceScale('right').applyOptions({ scaleMargins: { top: .06, bottom: prefs.rsi ? .24 : showVolume ? .16 : .06 } });
    resetView.current();
  }, [candles, key, futures, prefs.volume, prefs.rsi]);

  // Coming back to the tab, a symbol, or out of maximize always shows the normal centred view.
  useEffect(() => {
    if (!active || hidden) return;
    viewPending.current = true;
    const frame = requestAnimationFrame(() => resetView.current());
    return () => cancelAnimationFrame(frame);
  }, [active, hidden, maximized, key]);

  useEffect(() => {
    const api = runtime.current;
    if (!api) return;
    const { series, changedFrom, rebuilt } = calculation;
    const incremental = !rebuilt && changedFrom > 0;
    const apply = (target: ISeriesApi<'Line'>, data: IndicatorSample[] | undefined, visible: boolean) => {
      if (!visible || !data) { target.setData([]); return; }
      if (incremental && data.length) {
        for (let index = Math.min(changedFrom, data.length - 1); index < data.length; index++) {
          target.update({ ...data[index], time: data[index].time as UTCTimestamp });
        }
      } else target.setData(points(data));
    };
    for (const id of EMA_KEYS) apply(api.emas[id], series[id], settings[id]);
    apply(api.vwap, series.vwap, settings.vwap);
    apply(api.rsi, series.rsi, settings.rsi);
  }, [calculation, settings]);

  // Pivot / CPR values are fixed per session; redraw only when the bar count or anchor data changes.
  const pivotSignature = `${key}|${candles.length}|${bars[0]?.time}|${Object.keys(pivots).join(',')}`;
  useEffect(() => {
    const api = runtime.current;
    if (!api) return;
    for (const [name, line] of Array.from(api.pivots.entries())) {
      if (!pivots[name]) { api.chart.removeSeries(line); api.pivots.delete(name); }
    }
    for (const [name, data] of Object.entries(pivots)) {
      let line = api.pivots.get(name);
      if (!line) {
        const level = name.split(':')[1] ?? '';
        line = api.chart.addLineSeries({
          title: indicatorLineTitle(name), color: name.startsWith('cpr:') ? PIVOT_COLORS[level] ?? '#ef355c' : '#e9b85d',
          lineWidth: 1, lineStyle: name.startsWith('cpr:') ? LineStyle.Solid : LineStyle.Dotted,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
          // Distant pivot levels must not squash the candles; they stay drawn when price reaches them.
          autoscaleInfoProvider: () => null,
        });
        api.pivots.set(name, line);
      }
      line.setData(points(data));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pivotSignature]);

  const { levels } = structureCache.current;
  useEffect(() => {
    const api = runtime.current;
    if (!api) return;
    api.levels.forEach(line => api.candles.removePriceLine(line));
    api.levels = prefs.levels ? [
      ...levels.supports.map(level => api.candles.createPriceLine({ price: level.price, color: 'rgba(0,187,165,.75)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `S ×${level.touches}` })),
      ...levels.resistances.map(level => api.candles.createPriceLine({ price: level.price, color: 'rgba(238,64,83,.75)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `R ×${level.touches}` })),
    ] : [];
  }, [levels, prefs.levels]);

  useEffect(() => {
    runtime.current?.smartMoney.setData(prefs.liquidity ? smc : null, { blocks: false, liquidity: prefs.liquidity });
  }, [smc, prefs.liquidity]);

  // ── status ──
  const inSession = isCashSession(now);
  const fresh = freshness({
    nowMs: now,
    lastTick: futures ? flow?.lastTick ?? null : tickPrice !== undefined && Number.isFinite(tickTime) ? tickTime : null,
    historyUpdated: current.updated, streamLive: futures ? flowLive : tickPrice !== undefined, inSession,
  });
  const loading = !candles.length && !current.error;
  const hoverTime = hoverState.key === key ? hoverState.time : null;
  const shown = (hoverTime === null ? null : candleAt(candles, hoverTime)) ?? candles[candles.length - 1];
  const change = shown ? shown.c - shown.o : 0;
  const changePct = shown && shown.o ? (change / shown.o) * 100 : 0;
  const tone = change >= 0 ? styles.up : styles.down;

  return (
    <section className={`${styles.panel} ${maximized ? styles.maximized : ''}`} hidden={hidden} aria-label={`${timeframeLabel(tf)} chart`}>
      <header className={styles.panelHeader}>
        <strong className={styles.tf}>{timeframeLabel(tf)}</strong>
        {shown ? (
          <div className={styles.quote}>
            <span className={styles.quoteMain}>
              <span className={`${styles.last} ${tone}`}>{price(shown.c)}</span>
              <span className={`${styles.chg} ${tone}`}>{change >= 0 ? '+' : ''}{price(change)} ({change >= 0 ? '+' : ''}{changePct.toFixed(2)}%)</span>
              <span className={styles.muted}>{clock(candleTime(shown))}</span>
            </span>
            <span className={styles.ohlc}>
              <span><em>O</em>{price(shown.o)}</span><span><em>H</em>{price(shown.h)}</span><span><em>L</em>{price(shown.l)}</span>
            </span>
          </div>
        ) : <span className={`${styles.quote} ${styles.muted}`}>--</span>}
        <span className={`${styles.badge} ${styles[`state${fresh.state}`]}`} title={fresh.label}>
          {fresh.state === 'LIVE' && <i className={styles.pulse} aria-hidden="true" />}{fresh.state}
        </span>
        <button type="button" className={styles.iconButton} onClick={() => onMaximize(maximized ? null : tf)}
          aria-label={maximized ? `Restore ${timeframeLabel(tf)} chart` : `Maximize ${timeframeLabel(tf)} chart`} aria-pressed={maximized}>
          {maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      </header>
      {current.error && !candles.length && (
        <div role="alert" className={styles.error}>
          <span>{current.error}</span>
          <button type="button" className={styles.retry} onClick={() => setRetry(value => value + 1)}><RefreshCw size={12} /> Retry</button>
        </div>
      )}
      {current.error && candles.length > 0 && <div className={styles.stale} title={current.error}>Reconnecting to Zerodha history — showing last loaded candles.</div>}
      {fresh.state === 'STALE' && candles.length > 0 && <div className={styles.stale}>{fresh.label}</div>}
      <div className={styles.chartBox}>
        <div ref={containerRef} className={styles.chart} />
        {loading && <div className={styles.loading} aria-live="polite">Loading {timeframeLabel(tf)} candles…</div>}
      </div>
    </section>
  );
});

export default function MultiTimeframeChart({ active, marketData, chartData }: {
  active: boolean; marketData: MarketData; chartData: ChartIntelligenceData;
}) {
  const [symbol, setSymbol] = useState<ChartSymbol>('NIFTY');
  const [source, setSource] = useState<Source>('spot');
  const [layout, setLayout] = useState<Layout>('grid');
  const [maximized, setMaximized] = useState<MtfTimeframe | null>(null);
  const [syncCrosshair, setSyncCrosshair] = useState(true);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [now, setNow] = useState(() => Date.now());
  const [contractRetry, setContractRetry] = useState(0);
  const [contracts, setContracts] = useState<{ symbol: ChartSymbol; items: FuturesContract[]; error: string | null }>(
    () => ({ symbol: 'NIFTY', items: readCachedContracts('NIFTY')?.value ?? [], error: null }));
  const bus = useMemo(createCrosshairBus, []);

  useEffect(() => { setPrefs(loadPrefs()); }, []);
  const togglePref = (id: keyof Prefs) => setPrefs(prior => {
    const next = { ...prior, [id]: !prior[id] };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* storage disabled */ }
    return next;
  });

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (!maximized) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMaximized(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [maximized]);

  const futures = source === 'futures';
  useEffect(() => {
    if (!active || !futures) return;
    let cancelled = false;
    setContracts(prior => ({ symbol, items: readCachedContracts(symbol)?.value ?? (prior.symbol === symbol ? prior.items : []), error: null }));
    loadContracts(symbol, contractRetry > 0).then(items => {
      if (!cancelled) setContracts({ symbol, items, error: null });
    }).catch((error: unknown) => {
      if (!cancelled) setContracts(prior => ({ ...prior, symbol, error: error instanceof Error ? error.message : 'Unable to load futures contracts.' }));
    });
    return () => { cancelled = true; };
  }, [active, futures, symbol, contractRetry]);
  const items = contracts.symbol === symbol ? contracts.items : readCachedContracts(symbol)?.value ?? [];
  // Live order flow is recorded for the near-month contract only.
  const contract = futures ? items[0] : undefined;

  // Warm every index × timeframe in the background so switching NIFTY/BANKNIFTY/SENSEX paints instantly.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const others = (['NIFTY', 'BANKNIFTY', 'SENSEX'] as const).filter(id => id !== symbol);
    const timer = setTimeout(() => void (async () => {
      for (const id of others) {
        if (cancelled) return;
        if (!futures) {
          for (const tf of MTF_TIMEFRAMES) { if (!cancelled) await prefetchChartHistory(id, tf); }
          continue;
        }
        try {
          const near = (await loadContracts(id))[0];
          for (const tf of MTF_TIMEFRAMES) {
            if (cancelled || !near) break;
            if (!readCachedCandles(id, near.token, tf)?.fresh) await loadCandles(id, near.token, tf);
          }
        } catch (error) { console.error('Multi-timeframe preload:', error); }
      }
    })(), 600);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [active, futures, symbol]);

  // One 1m order-flow socket feeds every futures timeframe.
  const flow = useOrderFlow(symbol, 1, contract?.token, active && futures && contract !== undefined);
  const flowSnapshot = flow.snapshot?.available && flow.snapshot.token === contract?.token ? flow.snapshot : null;
  const flowByTf = useMemo(() => new Map(MTF_TIMEFRAMES.map(tf =>
    [tf, flowSnapshot ? resampleFlowCandles(flowSnapshot, tf) : null] as const)), [flowSnapshot]);

  const live = futures ? null : chartData[symbol];
  const liveFive = useMemo(() => workspaceCandles(live, 5), [live]);
  const liveSession = stableLiveSession(liveFive, now);
  const tick = marketData[symbol];
  const tickPrice = !futures && tick?.status === 'LIVE' ? tick.price : undefined;
  const tickTime = tick?.timestamp ? Date.parse(tick.timestamp) / 1000 : NaN;
  const onMaximize = useCallback((tf: MtfTimeframe | null) => setMaximized(tf), []);

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div className={styles.symbols}>
          <IndexTabList idPrefix="mtf-index" label="Multi-timeframe index" activeSymbol={symbol} onSelect={setSymbol} />
        </div>
        <div className={styles.controls}>
          <div className={styles.segment} role="group" aria-label="Price source">
            <button type="button" aria-pressed={!futures} onClick={() => setSource('spot')}>Spot</button>
            <button type="button" aria-pressed={futures} onClick={() => setSource('futures')}>Futures</button>
          </div>
          <div className={styles.segment} role="group" aria-label="Layout">
            <button type="button" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')} aria-label="2 by 2 grid"><LayoutGrid size={14} /> Grid</button>
            <button type="button" aria-pressed={layout === 'row'} onClick={() => setLayout('row')} aria-label="Horizontal layout"><Columns4 size={14} /> Row</button>
          </div>
          <label className={styles.check}>
            <input type="checkbox" checked={syncCrosshair} onChange={event => setSyncCrosshair(event.target.checked)} /> Sync crosshair
          </label>
          {futures && contract && <span className={styles.contract}>{contract.tradingSymbol} · {formatExpiry(contract.expiry)}</span>}
        </div>
      </div>
      <div className={styles.indicators} role="group" aria-label="Indicators">
        <span className={styles.indicatorTitle}>Indicators</span>
        <div className={styles.indicatorList}>
          {PREF_LABELS.filter(([id]) => futures || (id !== 'vwap' && id !== 'volume')).map(([id, label, color]) => (
            <label key={id} className={`${styles.chip} ${prefs[id] ? styles.chipOn : ''}`}>
              <input type="checkbox" checked={prefs[id]} onChange={() => togglePref(id)} />
              <i style={{ background: color }} aria-hidden="true" />{label}
            </label>
          ))}
        </div>
      </div>
      {futures && contracts.symbol === symbol && contracts.error && (
        <div role="alert" className={styles.error}>
          <span>{contracts.error}</span>
          <button type="button" className={styles.retry} onClick={() => setContractRetry(value => value + 1)}><RefreshCw size={12} /> Retry</button>
        </div>
      )}
      {futures && flow.error && <div className={styles.stale}>Live futures stream: {flow.error} — charts refresh from history every 20s.</div>}
      <div className={`${styles.workspace} ${layout === 'row' ? styles.row : styles.grid} ${maximized ? styles.hasMaximized : ''}`}>
        {MTF_TIMEFRAMES.map(tf => (
          <MtfPanel key={tf} tf={tf} symbol={symbol} source={source} contract={contract} active={active} prefs={prefs}
            live={live} liveSession={liveSession} tickPrice={tickPrice} tickTime={tickTime}
            flow={futures ? flowByTf.get(tf) ?? null : null} flowLive={futures && flow.live} now={now}
            maximized={maximized === tf} hidden={maximized !== null && maximized !== tf}
            onMaximize={onMaximize} bus={bus} syncCrosshair={syncCrosshair} />
        ))}
      </div>
      <p className={styles.note}>
        {futures
          ? 'Futures: Zerodha history for the near-month contract, live candles from one 1-minute order-flow stream. CPR/pivots use futures sessions only.'
          : 'Spot: Zerodha index history refreshed every 20s; forming candles move with live exchange ticks. Index volume is not published, so VWAP/volume are futures-only.'}
      </p>
    </div>
  );
}
