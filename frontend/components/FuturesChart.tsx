'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ColorType, CrosshairMode, createChart, LineStyle,
  type AutoscaleInfo, type IChartApi, type ISeriesApi, type UTCTimestamp,
} from 'lightweight-charts';
import { API_CONFIG } from '@/lib/api-config';
import { parsePage } from '@/hooks/useChartHistory';
import type { Candle } from '@/hooks/useChartIntelligence';
import { candleTime, TEMPLATES, timeframeLabel, type ChartSymbol, type Timeframe } from '@/lib/chart-workspace';
import { createIndicatorEngine } from '@/lib/chart-indicators';
import { calculateVwapSignals } from '@/lib/chart-vwap-signals';
import { SignalLabelPrimitive } from '@/lib/chart-signal-labels';
import { futuresChangedFrom, relativeVolume } from '@/lib/futures-chart-metrics';
import { createHistoryPageCache } from '@/lib/chart-history-cache';
import { isFreshFuturesFlow, mergeFuturesLiveCandles } from '@/lib/futures-live-candles';
import { centerLatestCandle, isLatestCandleCentered, resizeChartIfChanged } from '@/lib/chart-render-sync';
import { flowStats, OrderFlowPrimitive } from '@/lib/chart-order-flow';
import { candleFlowCallouts, FLOW_MIN_POINTS, FLOW_ROUND_STEP, recordedFlowMap } from '@/lib/order-flow';
import { proSignalLabels, timeframeSeconds } from '@/lib/pro-confluence';
import { useOrderFlow } from '@/hooks/useOrderFlow';
import { useProConfluence } from '@/hooks/useProConfluence';
import OrderFlowReadout from './OrderFlowReadout';
import { IndexTabList } from './IndexTabs';
import DeltaStrengthBox from './DeltaStrength';
import ProSignalPanel from './ProSignal';
import LevelBattlePanel from './LevelBattle';
import { useLevelBattle } from '@/hooks/useLevelBattle';
import { LevelBattlePrimitive } from '@/lib/level-battle-primitive';
import styles from './ChartWorkspace.module.css';

export interface FuturesContract {
  token: number;
  symbol: ChartSymbol;
  tradingSymbol: string;
  exchange: string;
  expiry: string;
  lotSize: number;
  tickSize: number;
}
interface ContractState { symbol: ChartSymbol; items: FuturesContract[]; error: string | null; loading: boolean }
export interface CandleState { key: string; candles: Candle[]; error: string | null; updated: number | null }
const candleCache = createHistoryPageCache<CandleState>(24);
const contractCache = createHistoryPageCache<FuturesContract[]>(3, 3_600_000);
const contractCacheKey = (symbol: ChartSymbol) => `${symbol}:${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })}`;
const SETTINGS = { ...TEMPLATES['Clean Chart'], vwap: true, ema9: true, ema20: true };
const EMPTY_CANDLES: Candle[] = [];
const formatPrice = (value: number | undefined) => value === undefined ? '--' :
  value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatTime = (time: number) => new Date(time).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
export const formatExpiry = (expiry: string) => new Date(`${expiry}T00:00:00+05:30`).toLocaleDateString('en-IN', {
  timeZone: 'Asia/Kolkata', month: 'long', year: 'numeric', day: '2-digit',
});

async function requestJson(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(API_CONFIG.endpoint(path), { signal, credentials: 'include' });
  const value: unknown = await response.json();
  if (!response.ok) {
    throw new Error(typeof value === 'object' && value !== null && 'detail' in value && typeof value.detail === 'string'
      ? value.detail : `Futures request failed (${response.status}).`);
  }
  return value;
}

function parseContracts(value: unknown, symbol: ChartSymbol): FuturesContract[] {
  if (typeof value !== 'object' || value === null || !('contracts' in value) || !Array.isArray(value.contracts)) {
    throw new Error('Invalid futures contract response.');
  }
  return value.contracts.map((row: unknown) => {
    if (typeof row !== 'object' || row === null ||
        !('token' in row) || typeof row.token !== 'number' || !Number.isSafeInteger(row.token) || row.token <= 0 ||
        !('symbol' in row) || row.symbol !== symbol ||
        !('tradingSymbol' in row) || typeof row.tradingSymbol !== 'string' ||
        !('exchange' in row) || typeof row.exchange !== 'string' || row.exchange !== (symbol === 'SENSEX' ? 'BFO' : 'NFO') ||
        !('expiry' in row) || typeof row.expiry !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.expiry) ||
        !Number.isFinite(Date.parse(row.expiry)) ||
        !('lotSize' in row) || typeof row.lotSize !== 'number' || !Number.isSafeInteger(row.lotSize) || row.lotSize <= 0 ||
        !('tickSize' in row) || typeof row.tickSize !== 'number' || !Number.isFinite(row.tickSize) || row.tickSize <= 0) {
      throw new Error('Invalid futures contract metadata.');
    }
    return { token: row.token, symbol, tradingSymbol: row.tradingSymbol,
      exchange: row.exchange, expiry: row.expiry, lotSize: row.lotSize, tickSize: row.tickSize };
  });
}

export async function loadContracts(symbol: ChartSymbol, force = false) {
  const key = contractCacheKey(symbol);
  const saved = contractCache.read(key);
  if (saved?.fresh && !force) return saved.value;
  return contractCache.load(key, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      return parseContracts(await requestJson(`/api/chart-intelligence/futures/contracts?symbol=${symbol}`, controller.signal), symbol);
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Futures contracts request timed out. Use Refresh / retry.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  });
}

export async function loadCandles(symbol: ChartSymbol, token: number, timeframe: Timeframe): Promise<CandleState> {
  const key = `${symbol}:${token}:${timeframe}`;
  return candleCache.load(key, async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    try {
      const params = new URLSearchParams({ symbol, token: String(token), interval: String(timeframe) });
      const value = await requestJson(`/api/chart-intelligence/futures/history?${params}`, controller.signal);
      if (typeof value !== 'object' || value === null || !('source' in value) || value.source !== 'ZERODHA_FUTURES' ||
          !('contract' in value) || typeof value.contract !== 'object' || value.contract === null ||
          !('token' in value.contract) || value.contract.token !== token) {
        throw new Error('Futures history does not match the selected contract.');
      }
      return { key, candles: parsePage(value).candles, error: null, updated: Date.now() };
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Futures request timed out. Retry to reconnect.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  });
}

/** Shared cache reads so other futures views paint instantly from already-loaded data. */
export const readCachedContracts = (symbol: ChartSymbol) => contractCache.read(contractCacheKey(symbol));
export const readCachedCandles = (symbol: ChartSymbol, token: number, timeframe: Timeframe) =>
  candleCache.read(`${symbol}:${token}:${timeframe}`);

export async function warmFuturesChart(): Promise<void> {
  const contracts = await loadContracts('NIFTY');
  const nearest = contracts[0];
  if (!nearest) return;
  const saved = candleCache.read(`NIFTY:${nearest.token}:5`);
  if (!saved?.fresh) await loadCandles('NIFTY', nearest.token, 5);
}

export default function FuturesChart({ active = true }: { active?: boolean } = {}) {
  const [symbol, setSymbol] = useState<ChartSymbol>('NIFTY');
  const [token, setToken] = useState<number | null>(null);
  const [year, setYear] = useState('');
  const [timeframe, setTimeframe] = useState<Timeframe>(5);
  const [retry, setRetry] = useState(0);
  const [contracts, setContracts] = useState<ContractState>(() => {
    const saved = contractCache.read(contractCacheKey('NIFTY'));
    return { symbol: 'NIFTY', items: saved?.value ?? [], error: null, loading: !saved?.fresh };
  });
  const [data, setData] = useState<CandleState>({ key: '', candles: [], error: null, updated: null });
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [showVwap, setShowVwap] = useState(true);
  const [now, setNow] = useState(Date.now);
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingCenter = useRef(false);
  const engine = useRef(createIndicatorEngine());
  const previousBars = useRef<{ key: string; candles: Candle[] }>({ key: '', candles: [] });
  const runtime = useRef<{
    chart: IChartApi; candles: ISeriesApi<'Candlestick'>; volume: ISeriesApi<'Histogram'>;
    vwap: ISeriesApi<'Line'>; ema9: ISeriesApi<'Line'>; ema20: ISeriesApi<'Line'>;
    signalLabels: SignalLabelPrimitive; orderFlow: OrderFlowPrimitive; levelBattle: LevelBattlePrimitive; key: string;
  } | null>(null);
  const items = contracts.symbol === symbol ? contracts.items : [];
  const years = Array.from(new Set(items.map(item => item.expiry.slice(0, 4))));
  const selectedYear = years.includes(year) ? year : years[0] ?? '';
  const matching = items.filter(item => item.expiry.startsWith(selectedYear));
  const contract = matching.find(item => item.token === token) ?? matching[0];
  const key = `${symbol}:${contract?.token ?? ''}:${timeframe}`;
  const flow = useOrderFlow(symbol, timeframe, contract?.token, active && contract !== undefined);
  const pro = useProConfluence(symbol, active);
  const history = data.key === key ? data : candleCache.read(key)?.value;
  const historyCandles = history?.candles ?? EMPTY_CANDLES;
  const liveHistory = useRef({ key: '', history: EMPTY_CANDLES, candles: EMPTY_CANDLES });
  const candles = useMemo(() => {
    const prior = liveHistory.current;
    const base = prior.key === key && prior.history === historyCandles ? prior.candles : historyCandles;
    const merged = mergeFuturesLiveCandles(
      base, flow.snapshot, symbol, contract?.token, timeframe, flow.live, Date.now(), history?.updated ?? 0,
    );
    liveHistory.current = { key, history: historyCandles, candles: merged };
    return merged;
  }, [historyCandles, flow.snapshot, symbol, contract?.token, timeframe, flow.live, key, history?.updated]);
  const liveCandles = isFreshFuturesFlow(flow.snapshot, symbol, contract?.token, timeframe, flow.live, Date.now()) &&
    flow.snapshot.bars.some(bar => bar.ohlcvComplete &&
      bar.t <= flow.snapshot!.lastTick! && bar.end > flow.snapshot!.lastTick!);
  const calculation = useMemo(() => engine.current.calculate(candles, SETTINGS, typeof timeframe === 'number'),
    [candles, timeframe]);
  const hoveredIndex = hoverTime === null ? -1 : candles.findIndex(candle => candleTime(candle) === hoverTime);
  const readoutIndex = hoveredIndex < 0 ? candles.length - 1 : hoveredIndex;
  const vwapValue = calculation.series.vwap?.[readoutIndex]?.value;
  const rvol = useMemo(() => relativeVolume(candles, typeof timeframe === 'number'), [candles, timeframe]);
  const relative = rvol[readoutIndex];
  const selectedCandle = candles[readoutIndex];
  const contractError = contracts.symbol === symbol ? contracts.error : null;
  const historyError = data.key === key ? data.error : null;
  const signals = useMemo(() => calculateVwapSignals(candles, timeframe, {
    nowMs: now, fetchedAt: history?.updated ?? null,
    error: Boolean(contractError || historyError), tickSize: contract?.tickSize ?? 0,
  }), [candles, timeframe, now, history?.updated, contractError, historyError, contract?.tickSize]);

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const saved = contractCache.read(contractCacheKey(symbol));
    setContracts(previous => ({
      symbol, items: saved?.value ?? (previous.symbol === symbol ? previous.items : []),
      error: null, loading: !(saved?.fresh && retry === 0),
    }));
    void loadContracts(symbol, retry > 0)
      .then(items => {
        if (!cancelled) setContracts({ symbol, items, error: null, loading: false });
      }).catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Unable to load futures contracts.';
        console.error('Futures contracts:', error);
        setContracts(previous => ({ ...previous, symbol, error: message, loading: false }));
      });
    return () => { cancelled = true; };
  }, [symbol, retry, active]);

  const hasCandles = candles.length > 0;
  useEffect(() => {
    if (!active || !hasCandles) return;
    let cancelled = false;
    void (async () => {
      for (const other of ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const) {
        if (cancelled) return;
        if (other === symbol) continue;
        try {
          const listed = await loadContracts(other);
          if (cancelled) return;
          const nearest = listed[0];
          if (!nearest) continue;
          const saved = candleCache.read(`${other}:${nearest.token}:${timeframe}`);
          if (!saved?.fresh) await loadCandles(other, nearest.token, timeframe);
        } catch (error) {
          console.error(`Futures preload ${other}:`, error);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [symbol, timeframe, hasCandles, active]);

  const contractToken = contract?.token;
  useEffect(() => {
    if (!active || contractToken === undefined) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const saved = candleCache.read(key);
    setData(previous => previous.key === key ? previous :
      saved?.value ?? { key, candles: [], error: null, updated: null });
    const load = async () => {
      try {
        const next = await loadCandles(symbol, contractToken, timeframe);
        if (!cancelled) {
          setNow(Date.now());
          setData(next);
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Unable to load futures candles.';
          console.error('Futures chart:', error);
          setData(previous => previous.key === key ? { ...previous, error: message } :
            { key, candles: [], updated: null, error: message });
        }
      } finally {
        if (!cancelled) timer = setTimeout(() => void load(), 20_000);
      }
    };
    if (saved?.fresh && retry === 0) timer = setTimeout(() => void load(), Math.max(0, 20_000 - (Date.now() - (saved.value.updated ?? 0))));
    else void load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [symbol, contractToken, timeframe, key, retry, active]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      width: container.clientWidth, height: container.clientHeight,
      layout: { background: { type: ColorType.Solid, color: '#00111c' }, textColor: '#94aabd', fontSize: 11 },
      grid: { vertLines: { color: '#0b2939' }, horzLines: { color: '#0b2939' } },
      rightPriceScale: { minimumWidth: 96, scaleMargins: { top: .1, bottom: .24 } },
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 5 },
      localization: { timeFormatter: (time: number) => formatTime(time * 1000) },
      crosshair: { mode: CrosshairMode.Magnet },
    });
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#00bba5', downColor: '#ee4053', wickUpColor: '#00bba5', wickDownColor: '#ee4053', borderVisible: false,
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const info = original();
        return info && { ...info, margins: { above: 40, below: 40 } };
      },
    });
    const signalLabels = new SignalLabelPrimitive({ maxBottom: .8 });
    candleSeries.attachPrimitive(signalLabels);
    // Delta/CVD strip sits in the gap between the candle margin (bottom 24%) and the volume band (top 82%).
    const orderFlow = new OrderFlowPrimitive({ detail: false, footprint: true, basisAdjust: false, strip: { top: .765, bottom: .815 }, plan: false });
    candleSeries.attachPrimitive(orderFlow);
    const levelBattle = new LevelBattlePrimitive();
    candleSeries.attachPrimitive(levelBattle);
    const volume = chart.addHistogramSeries({
      title: 'Volume', priceFormat: { type: 'volume' }, priceScaleId: 'volume',
      priceLineVisible: false, lastValueVisible: false,
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: .82, bottom: 0 }, visible: false });
    const vwap = chart.addLineSeries({
      title: 'VWAP', color: '#ffc45c', lineWidth: 2, lineStyle: LineStyle.Solid,
      priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true,
    });
    const ema9 = chart.addLineSeries({
      title: 'EMA 9', color: '#00cbb8', lineWidth: 2, priceLineVisible: false,
    });
    const ema20 = chart.addLineSeries({
      title: 'EMA 20', color: '#008cff', lineWidth: 2, priceLineVisible: false,
    });
    runtime.current = { chart, candles: candleSeries, volume, vwap, ema9, ema20, signalLabels, orderFlow, levelBattle, key: '' };
    previousBars.current = { key: '', candles: [] };
    const onCrosshair = (event: { time?: unknown }) => setHoverTime(typeof event.time === 'number' ? event.time : null);
    chart.subscribeCrosshairMove(onCrosshair);
    const observer = new ResizeObserver(() => {
      const count = previousBars.current.candles.length;
      const centered = isLatestCandleCentered(chart, count);
      const resized = resizeChartIfChanged(chart, container);
      if ((pendingCenter.current || resized && centered) &&
          centerLatestCandle(chart, container, count)) pendingCenter.current = false;
    });
    observer.observe(container);
    return () => {
      observer.disconnect(); chart.unsubscribeCrosshairMove(onCrosshair); chart.remove(); runtime.current = null;
    };
  }, []);

  useEffect(() => {
    const api = runtime.current;
    if (!api) return;
    const previous = previousBars.current;
    const from = previous.key === key ? futuresChangedFrom(previous.candles, candles) : -1;
    const changed = from < 0 ? candles : candles.slice(from);
    const priceBars = changed.map(candle => ({
      time: candleTime(candle) as UTCTimestamp, open: candle.o, high: candle.h, low: candle.l, close: candle.c,
    }));
    const volumeBars = changed.map((candle, index) => ({
      time: candleTime(candle) as UTCTimestamp, value: candle.v, color: candle.c >= candle.o ? '#00bba566' : '#ee405366',
      ...(rvol[(from < 0 ? 0 : from) + index] !== undefined && rvol[(from < 0 ? 0 : from) + index]! >= 2
        ? { color: candle.c >= candle.o ? '#00e8ad' : '#ff586d' } : {}),
    }));
    if (from < 0) {
      api.candles.setData(priceBars);
      api.volume.setData(volumeBars);
    } else {
      priceBars.forEach(bar => api.candles.update(bar));
      volumeBars.forEach(bar => api.volume.update(bar));
    }
    for (const id of ['vwap', 'ema9', 'ema20'] as const) {
      const values = calculation.series[id] ?? [];
      const samples = (from < 0 ? values : values.slice(from)).map(point => ({ ...point, time: point.time as UTCTimestamp }));
      if (from < 0) api[id].setData(samples);
      else samples.forEach(point => api[id].update(point));
    }
    previousBars.current = { key, candles };
    if (api.key !== key) api.chart.applyOptions({ timeScale: { timeVisible: typeof timeframe === 'number',
      tickMarkFormatter: (time: number) => new Date(time * 1000).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata', ...(typeof timeframe === 'number'
          ? { hour: '2-digit', minute: '2-digit', hour12: false } : { day: '2-digit', month: 'short' }),
      }),
    } });
    if (candles.length && api.key !== key) {
      api.key = key;
      api.chart.priceScale('right').applyOptions({ autoScale: true });
      pendingCenter.current = !centerLatestCandle(api.chart, containerRef.current!, candles.length);
    }
  }, [candles, calculation, timeframe, key, rvol]);

  useEffect(() => {
    runtime.current?.vwap.applyOptions({ visible: showVwap });
  }, [showVwap]);

  useEffect(() => {
    runtime.current?.orderFlow.setData(flow.snapshot);
  }, [flow.snapshot]);

  // Candle-inferred buy / sell flow for every candle without recorded tick order flow; the forming candle is skipped.
  const recordedFlow = useMemo(() => recordedFlowMap(flow.snapshot), [flow.snapshot]);
  const candleFlow = useMemo(() => candleFlowCallouts(
    candles.map(bar => ({ time: candleTime(bar), o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v })),
    {
      closedBefore: Date.now() / 1000 - (typeof timeframe === 'number' ? timeframe * 60 : 86400) + 1,
      minPoints: FLOW_MIN_POINTS[symbol], roundStep: FLOW_ROUND_STEP[symbol], recorded: recordedFlow,
    },
  ), [candles, timeframe, symbol, recordedFlow]);
  const candleFlowSummary = useMemo(() => flowStats(candleFlow), [candleFlow]);

  useEffect(() => {
    runtime.current?.orderFlow.setEstimated(candleFlow);
  }, [candleFlow]);

  // Only gate-confirmed entries / exits are labelled; prices are this contract's, so other expiries get none.
  const proTrades = pro.contract?.token === contract?.token ? pro.replay?.trades : undefined;
  useEffect(() => {
    const times = candles.map(candleTime);
    runtime.current?.signalLabels.setData(proSignalLabels(proTrades ?? [], times, timeframeSeconds(timeframe)),
      candles.map(bar => ({ time: candleTime(bar), h: bar.h, l: bar.l })));
  }, [candles, proTrades, timeframe]);

  const proOpen = pro.contract?.token === contract?.token ? pro.open : null;
  const proLevels = proOpen ? `${proOpen.t1Hit ? proOpen.entry : proOpen.stop}|${proOpen.t1}|${proOpen.t2}` : '';
  useEffect(() => {
    const api = runtime.current;
    if (!api || !proLevels) return;
    const [stop, t1, t2] = proLevels.split('|').map(Number);
    const lines = ([['SL', stop, '#ff4d5e'], ['T1', t1, '#38d6b0'], ['T2', t2, '#c084fc']] as const)
      .map(([title, value, color]) => api.candles.createPriceLine({
        price: value, color, title, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true,
      }));
    return () => lines.forEach(line => api.candles.removePriceLine(line));
  }, [proLevels]);

  // Levels come from this chart's candles; buyers/sellers can only be measured when it is the recorded near-month contract.
  const levelBars = useMemo(() => candles.map(bar => ({ time: candleTime(bar), o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v })), [candles]);
  const battle = useLevelBattle(pro, levelBars, {
    intraday: typeof timeframe === 'number', vwap: true,
    offset: contract && pro.contract?.token === contract.token ? 0 : null,
  });
  useEffect(() => { runtime.current?.levelBattle.setData(battle.active); }, [battle]);

  return <div className={styles.futuresWorkspace}>
    <IndexTabList idPrefix="futures-index" label="Futures chart index" activeSymbol={symbol}
      panelId="futures-index-content" onSelect={next => {
        if (next === symbol) return;
        setSymbol(next); setToken(null); setYear('');
      }} />
    <div id="futures-index-content" role="tabpanel" aria-labelledby={`futures-index-tab-${symbol}`}
      tabIndex={0} className="min-w-0 space-y-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">
    <div className="flex flex-wrap items-center gap-2">
      <DeltaStrengthBox symbol={symbol} active={active} decision={pro.decision} />
    </div>
    <ProSignalPanel pro={pro} />
    <LevelBattlePanel state={battle} />
    <details className={styles.compactDetails}>
    <summary>Contract & chart settings · {timeframeLabel(timeframe)} · {contract?.tradingSymbol ?? symbol}</summary>
    <div className={styles.futuresControls}>
      <label>Expiry year <select className={styles.button} value={selectedYear} disabled={!years.length}
        onChange={event => { setYear(event.target.value); setToken(null); }}>
        {!years.length && <option value="">Loading...</option>}
        {years.map(item => <option key={item} value={item}>{item}</option>)}
      </select></label>
      <label>Contract / expiry <select className={styles.button} value={contract?.token ?? ''} disabled={!matching.length}
        onChange={event => setToken(Number(event.target.value))}>
        {!matching.length && <option value="">No listed contracts</option>}
        {matching.map(item => <option key={item.token} value={item.token}>{formatExpiry(item.expiry)} - {item.tradingSymbol}</option>)}
      </select></label>
      <label>Interval <select className={styles.button} value={String(timeframe)} onChange={event =>
        setTimeframe(event.target.value === 'D' ? 'D' : Number(event.target.value) as Timeframe)}>
        {([3, 5, 15, 30, 60, 'D'] as const).map(item => <option key={item} value={item}>{timeframeLabel(item)}</option>)}
      </select></label>
      <button className={styles.button} onClick={() => setRetry(value => value + 1)}>Refresh / retry</button>
    </div>
    <p className="text-xs text-slate-400">
      Zerodha-listed contracts only: October, November, December 2026 and 2027 appear when the exchange lists them.
      No future candles or synthetic rollover history. Prices and volume always belong to the selected contract.
      Near-month intraday candles update from the recorded live stream when fully observed (about once per second).
      History reconciles every 20 seconds; other expiries and incomplete recordings use history polling. No futures paper orders.
    </p>
    </details>
    {(contractError || historyError) && <p role="alert" className="rounded border border-red-500/40 p-2 text-red-300">
      {contractError || historyError} Displayed data may be stale.
    </p>}
    {!contractError && !contract && <p role="status">
      {contracts.symbol !== symbol || contracts.loading ? 'Loading futures contracts...' :
        'Zerodha returned no currently listed futures for this index. No prices have been substituted.'}
    </p>}
    <details className={styles.compactDetails}>
    <summary>Live values & indicators · {contract?.tradingSymbol ?? symbol} · {liveCandles ? 'LIVE' : 'HISTORY'}</summary>
    <div className={styles.chartHeading}>
      <strong>{contract ? `${contract.tradingSymbol} · ${contract.exchange} · ${timeframeLabel(timeframe)}` : 'Futures Chart'}</strong>
      {contract && <span>Expiry {contract.expiry} · Lot {contract.lotSize}</span>}
      <span className={liveCandles ? 'text-emerald-300' : 'text-amber-300'}>
        {liveCandles ? 'LIVE · recorded futures ticks' : 'HISTORY · 20s refresh'}
      </span>
      {selectedCandle && <span>O {formatPrice(selectedCandle.o)} · H {formatPrice(selectedCandle.h)} ·
        L {formatPrice(selectedCandle.l)} · C {formatPrice(selectedCandle.c)} · Volume {selectedCandle.v.toLocaleString('en-IN')}</span>}
      <span className="text-teal-300">EMA 9 {formatPrice(calculation.series.ema9?.[readoutIndex]?.value)}</span>
      <span className="text-blue-400">EMA 20 {formatPrice(calculation.series.ema20?.[readoutIndex]?.value)}</span>
      <span title="Current candle volume divided by the average of the previous 20 candles; intraday resets each IST session. Forming candle RVOL is provisional.">
        RVOL 20 {relative === undefined ? '-- (20 prior bars required)' : `${relative.toFixed(2)}x`}
        {selectedCandle && candleTime(selectedCandle) * 1000 + (typeof timeframe === 'number' ? timeframe * 60000 : 86400000) > now
          ? ' · forming' : ''}
      </span>
      <OrderFlowReadout state={flow} intraday={typeof timeframe === 'number'} />
      <span className="text-slate-400" title={'Big-player prints only (max 2 per session): stop-run / absorption / drive setup + volume >= 2.5x average (range >= 2x on the cash index) + major level (PDH/PDL/PDC, day H/L, opening range, round number). A print is valid only if price made the minimum points before its stop; failed prints are hidden. Candle-based estimate: FII/DII identity is not in any live feed.'}>Flow valid {candleFlowSummary.valid}/{candleFlowSummary.resolved}{candleFlowSummary.pending ? ` ? ${candleFlowSummary.pending} confirming` : ''}</span>
    </div>
    <label className="flex items-center gap-1 text-[#ffc45c]">
      <input type="checkbox" checked={showVwap} onChange={event => setShowVwap(event.target.checked)} />
      VWAP {vwapValue === undefined
        ? typeof timeframe !== 'number' ? '(intraday only)' : '(waiting for traded volume)'
        : formatPrice(vwapValue)}
    </label>
    </details>
    {contract && !candles.length && !historyError && <p role="status">
      {data.key === key && data.updated ? 'No candles returned for this contract in the latest history window.' : 'Loading futures candles...'}
    </p>}
    <div ref={containerRef} className={styles.price} aria-label="Selected futures contract candlestick chart with EMA 9, EMA 20, VWAP, volume, relative volume and entry/exit signals" />
    <details className={styles.compactDetails}>
    <summary>Data freshness & calculation details</summary>
    <p className="text-xs text-slate-400">
      Last history refresh {history?.updated ? `${formatTime(history.updated)} IST` : '--'} ·
      Last candle {candles.length ? `${formatTime(candleTime(candles[candles.length - 1]) * 1000)} IST` : '--'}.
      VWAP = session sum(HLC3 x traded volume) / session volume, reset each IST date. Forming candles can change.
      Session VWAP is intraday only. Broker historical-data permissions are required.
      RVOL compares volume with the previous 20 same-session bars (daily: previous 20 days); bars at 2x or higher are highlighted.
      Volume bar colors indicate candle direction, not buyer/seller delta.
      Order flow (footprint bid x ask, delta/CVD strip, POC/VAH/VAL, walls, A=absorption E=exhaustion F=failed auction, OF BUY/SELL)
      is recorded live from Zerodha full-mode ticks for the near-month contract only, from when the backend started recording;
      trade side is estimated (quote/tick rule), not exchange-flagged. Zoom in for footprint numbers.
      Chart BUY / SELL / EXIT labels come only from the pro confirmation gate (every check passed on a closed 5m near-month candle);
      the replay books half at T1 (stop to breakeven), the rest at T2 or 15:15. Raw VWAP crosses, order-flow callouts and
      server OF plans are not drawn as signals. Fees/slippage excluded. {signals.reason}
    </p>
    </details>
    </div>
  </div>;
}
