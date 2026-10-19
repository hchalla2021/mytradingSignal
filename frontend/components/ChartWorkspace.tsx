'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart, ColorType, CrosshairMode, LineStyle, LineType, PriceScaleMode,
  type IChartApi, type ISeriesApi, type UTCTimestamp, type LogicalRange, type MouseEventParams, type AutoscaleInfo,
} from 'lightweight-charts';
import {
  Camera, Maximize, Minimize, Save, Search, Crosshair, TrendingUp,
  Minus, Square, Trash2, Undo2, Magnet, Eye, EyeOff, ChevronDown, LayoutTemplate,
} from 'lucide-react';
import { useChartIntelligence, type Candle } from '@/hooks/useChartIntelligence';
import { useChartHistory, prefetchChartHistory } from '@/hooks/useChartHistory';
import type { MarketData } from '@/hooks/useMarketSocket';
import type { FIIDIISnapshot } from '@/hooks/useFIIDIIFlow';
import {
  INDICATORS, TEMPLATES, candleTime, workspaceCandles,
  restoreIndicatorSettings, institutionalContext, isCashSession, mergeChartHistory, sessionDate, updatePeriodCandle, timeframeLabel,
  type ChartSymbol, type Timeframe, type IndicatorSettings,
} from '@/lib/chart-workspace';
import {
  createIndicatorEngine, createPivotEngine, autoPivotAnchor, segmentedLine, indicatorLineTitle,
  type IndicatorSample,
} from '@/lib/chart-indicators';
import styles from './ChartWorkspace.module.css';
import { synchronizeCrosshair } from '@/lib/chart-crosshair';
import { layoutTradeLabels } from '@/lib/chart-trade-labels';
import { createLevelAnalysisEngine } from '@/lib/chart-level-analysis';
import { createChartPaperAnalyzer } from '@/lib/chart-paper-trading';
import { createRejectionEngine } from '@/lib/chart-rejection-engine';
import { SignalLabelPrimitive, type ChartSignalLabel } from '@/lib/chart-signal-labels';
import ChartPaperTrading, { usePaperSignalRecorder } from './ChartPaperTrading';
import { useChartPaperTrading } from '@/hooks/useChartPaperTrading';
import { chartPaperLevels, paperEventCandle, selectChartPaperTrade } from '@/lib/chart-paper-overlay';

const SYMBOLS = [{ id: 'NIFTY', name: 'NIFTY 50', exchange: 'NSE' }, { id: 'BANKNIFTY', name: 'BANKNIFTY', exchange: 'NSE' }, { id: 'SENSEX', name: 'SENSEX', exchange: 'BSE' }] as const;
const STORAGE_KEY = 'chartWorkspaceTemplate_v1';
const UP = '#00bba5';
const DOWN = '#ee4053';
const timeLabel = (time: number) => new Date(time * 1000).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
const price = (value: number | undefined) => value === undefined || !Number.isFinite(value) ? '--' : value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = (value: number | undefined) => value === undefined ? '--' : Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
const points = (data: IndicatorSample[]) => data.map(point => ({ ...point, time: point.time as UTCTimestamp }));
type Tool = 'cursor' | 'trend' | 'horizontal' | 'rectangle';
type Anchor = { time: number; price: number };
type Drawing = { id: number; tool: Exclude<Tool, 'cursor'>; start: Anchor; end: Anchor };
type Panel = 'Indicators' | 'Drawing Tools' | 'Chart Settings';
type Range = '1D' | '5D' | 'All';
interface ChartRuntime {
  charts: IChartApi[];
  candles: ISeriesApi<'Candlestick'>;
  signalLabels: SignalLabelPrimitive;
  volume: ISeriesApi<'Histogram'>;
  overlays: Record<string, ISeriesApi<'Line'>>;
  rsi: ISeriesApi<'Line'>;
  macd: ISeriesApi<'Line'>;
  signal: ISeriesApi<'Line'>;
  histogram: ISeriesApi<'Histogram'>;
  atr: ISeriesApi<'Line'>;
}

function ChartWorkspace({ marketData, institutionalData = null }: { marketData: MarketData; institutionalData?: FIIDIISnapshot | null }) {
  const { chartData, isConnected } = useChartIntelligence();
  const [symbol, setSymbol] = useState<ChartSymbol>('NIFTY');
  const [workspaceTab, setWorkspaceTab] = useState<'chart' | 'paper'>('chart');
  const [timeframe, setTimeframe] = useState<Timeframe>(5);
  const [indicators, setIndicators] = useState<IndicatorSettings>({ ...TEMPLATES['Confluence focus'] });
  const [controlsOpen, setControlsOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>('Indicators');
  const [query, setQuery] = useState('');
  const [template, setTemplate] = useState('Confluence focus');
  const [custom, setCustom] = useState<IndicatorSettings | null>(null);
  const [notice, setNotice] = useState('');
  const [grid, setGrid] = useState(true);
  const [logScale, setLogScale] = useState(false);
  const [autoScale, setAutoScale] = useState(true);
  const [magnet, setMagnet] = useState(true);
  const [tool, setTool] = useState<Tool>('cursor');
  const [showDrawings, setShowDrawings] = useState(true);
  const [drawings, setDrawings] = useState<Partial<Record<ChartSymbol, Drawing[]>>>({});
  const [draft, setDraft] = useState<Anchor | null>(null);
  const [preview, setPreview] = useState<Anchor | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [range, setRange] = useState<Range>('1D');
  const [fullscreen, setFullscreen] = useState(false);
  const [showTradePlan, setShowTradePlan] = useState(true);
  const [showPaperLevels, setShowPaperLevels] = useState(false);
  const [selectedPaperTradeId, setSelectedPaperTradeId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [historyDate, setHistoryDate] = useState('');
  const [browsingDate, setBrowsingDate] = useState('');
  const [, redraw] = useState(0);
  const rootRef = useRef<HTMLElement>(null);
  const priceRef = useRef<HTMLDivElement>(null);
  const volumeRef = useRef<HTMLDivElement>(null);
  const rsiRef = useRef<HTMLDivElement>(null);
  const macdRef = useRef<HTMLDivElement>(null);
  const atrRef = useRef<HTMLDivElement>(null);
  const runtime = useRef<ChartRuntime | null>(null);
  const revision = useRef('');
  const previousBars = useRef<{ key: string; candles: Candle[] }>({ key: '', candles: [] });
  const indicatorEngine = useRef(createIndicatorEngine());
  const pivotEngine = useRef(createPivotEngine());
  const levelEngine = useRef(createLevelAnalysisEngine());
  const paperAnalyzer = useRef(createChartPaperAnalyzer());
  const rejectionEngine = useRef(createRejectionEngine());
  const previousCalculation = useRef<{ key: string; daily: Candle[]; trend?: string }>({ key: '', daily: [] });
  const loadOlderRef = useRef<() => void>(() => {});
  const historyGesture = useRef(false);
  const data = chartData[symbol];
  const history = useChartHistory(symbol, timeframe);
  useEffect(() => {
    if (history.loading || history.error) return;
    // After the visible chart is ready, warm every other timeframe and the other indices so switching is instant.
    const others = SYMBOLS.map(item => item.id).filter(id => id !== symbol);
    const frames = ([5, 3, 15, 30, 60, 'D', 'W', 'M'] as const).filter(frame => frame !== timeframe);
    const jobs: [ChartSymbol, Timeframe][] = [
      ...frames.map(frame => [symbol, frame] as [ChartSymbol, Timeframe]),
      ...others.map(id => [id, timeframe] as [ChartSymbol, Timeframe]),
    ];
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        for (const [id, frame] of jobs) {
          if (cancelled) return;
          await prefetchChartHistory(id, frame);
        }
      })();
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [symbol, timeframe, history.loading, history.error]);
  const liveCandles = useMemo(() => workspaceCandles(data, timeframe), [data, timeframe]);
  const streamAge = data ? now - Date.parse(data.timestamp) : NaN;
  const freshStream = isConnected && data?.dataSource === 'LIVE' && streamAge >= 0 && streamAge < 30000;
  const liveSession = freshStream ? sessionDate(Math.floor(now / 1000)) : null;
  const candles = useMemo(() => mergeChartHistory(
    typeof timeframe !== 'number' && !browsingDate && liveSession
      ? updatePeriodCandle(history.candles, workspaceCandles(data, 5).filter(candle => sessionDate(candleTime(candle)) === liveSession), timeframe)
      : history.candles,
    browsingDate ? [] : liveCandles, liveSession,
  ), [history.candles, liveCandles, liveSession, browsingDate, timeframe, data]);
  const historyKey = `${symbol}:${timeframe}:${history.jumpRevision}:${browsingDate}`;
  const volumeAvailable = useMemo(() => candles.some(candle => candle.v > 0), [candles]);
  const volumeVisible = indicators.volume && volumeAvailable;
  useEffect(() => {
    loadOlderRef.current = history.loadOlder;
  }, [history.loadOlder]);
  const calculation = useMemo(() => indicatorEngine.current.calculate(candles, indicators, typeof timeframe === 'number'),
    [candles, indicators, timeframe]);
  const analytics = calculation.series;
  const pivotSeries = useMemo(() => pivotEngine.current.calculate(candles, history.dailyCandles, timeframe, indicators),
    [candles, history.dailyCandles, timeframe, indicators]);
  const cprSessions = useMemo(() => {
    const tops = pivotSeries['cpr:TC'];
    const bottoms = pivotSeries['cpr:BC'];
    const sessions: { from: number; to: number; top: number; bottom: number; date: string }[] = [];
    if (!tops || !bottoms) return sessions;
    for (let index = 0; index < candles.length; index++) {
      const top = tops[index]?.value;
      const bottom = bottoms[index]?.value;
      if (top === undefined || bottom === undefined) continue;
      const time = tops[index].time;
      const date = sessionDate(time);
      const previous = sessions.at(-1);
      if (previous?.date === date) previous.to = time;
      else sessions.push({ from: time, to: time, top, bottom, date });
    }
    return sessions;
  }, [pivotSeries, candles.length]);
  const selected = SYMBOLS.find(item => item.id === symbol)!;
  const last = candles[candles.length - 1];
  const hovered = candles.find(candle => candleTime(candle) === hoverTime) ?? last;
  const selectedDrawings = drawings[symbol] ?? [];
  const source = data?.dataSource;
  const sessionOpen = isCashSession(now);
  const live = !browsingDate && freshStream && sessionOpen;
  const levelAnalysis = useMemo(() => levelEngine.current.analyze(candles, history.dailyCandles, timeframe, {
    live, nowMs: now, latestPrice: data?.spot, minVolumeRatio: 1.2,
  }), [candles, history.dailyCandles, timeframe, live, now, data?.spot]);
  const rejection = useMemo(() => !history.loading
    ? rejectionEngine.current.analyze(candles, history.dailyCandles, timeframe, { live, nowMs: now, early: true }) : null,
  [history.loading, candles, history.dailyCandles, timeframe, live, now]);
  const paperFrame = useMemo(() => live && !history.loading && !history.error
    ? paperAnalyzer.current.analyze(symbol, candles, history.dailyCandles, timeframe, now, levelAnalysis.plan) : null,
    [live, history.loading, history.error, symbol, candles, history.dailyCandles, timeframe, now, levelAnalysis.plan]);
  const paperRecorderError = usePaperSignalRecorder(paperFrame);
  const paperDay = sessionDate(Math.floor(now / 1000));
  const paper = useChartPaperTrading(symbol, timeframe, paperDay);
  const selectedPaperTrade = useMemo(() => selectChartPaperTrade(paper.snapshot?.trades ?? [], selectedPaperTradeId),
    [paper.snapshot?.trades, selectedPaperTradeId]);
  useEffect(() => {
    if (selectedPaperTradeId && !paper.snapshot?.trades.some(trade => trade.id === selectedPaperTradeId))
      setSelectedPaperTradeId(null);
  }, [paper.snapshot?.trades, selectedPaperTradeId]);
  const institutional = useMemo(() => institutionalContext(institutionalData, now), [institutionalData, now]);

  useEffect(() => {
    if (!controlsOpen) return;
    const frame = requestAnimationFrame(() => rootRef.current?.querySelector('aside')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    return () => cancelAnimationFrame(frame);
  }, [controlsOpen]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
      if (stored !== null) {
        const restored = restoreIndicatorSettings(stored);
        if (!restored) throw new Error('Invalid saved chart template');
        setCustom(restored);
      }
    } catch (error) {
      console.error('Unable to restore chart template:', error);
      setNotice('Saved chart template could not be loaded. Default settings are in use.');
    }
    const onFullscreen = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);

  useEffect(() => {
    const containers = [priceRef.current, volumeRef.current, rsiRef.current, macdRef.current, atrRef.current];
    if (containers.some(container => !container)) return;
    const charts = containers.map((container, index) => createChart(container!, {
      width: container!.clientWidth, height: container!.clientHeight || 64,
      // One TradingView attribution (on the price pane) satisfies the library notice.
      layout: { background: { type: ColorType.Solid, color: index === 2 ? '#100f26' : '#00111c' }, textColor: '#94aabd', fontSize: 10, fontFamily: 'Arial, sans-serif', attributionLogo: index === 0 },
      grid: { vertLines: { color: '#0b2939', visible: true }, horzLines: { color: '#0b2939', visible: true } },
      rightPriceScale: { borderColor: '#304657', minimumWidth: 72, alignLabels: true, scaleMargins: index === 0 ? { top: .10, bottom: .08 } : { top: .2, bottom: .1 } },
      timeScale: { visible: index === 3, timeVisible: true, secondsVisible: false, borderColor: '#304657', rightOffset: 6, barSpacing: 8, tickMarkFormatter: (time: number) => timeLabel(time) },
      localization: { timeFormatter: (time: number) => new Date(time * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }) },
      crosshair: { mode: CrosshairMode.Magnet, vertLine: { color: '#6a8b9f', labelBackgroundColor: '#123d56' }, horzLine: { color: '#6a8b9f', labelBackgroundColor: '#123d56' } },
    }));
    const main = charts[0];
    const candleSeries = main.addCandlestickSeries({
      upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN,
      borderVisible: false, priceLineColor: UP,
      // Pixel headroom so BUY/SELL/EXIT labels at the highest/lowest candles stay on screen.
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const info = original();
        return info && { ...info, margins: { above: 40, below: 40 } };
      },
    });
    const signalLabels = new SignalLabelPrimitive();
    candleSeries.attachPrimitive(signalLabels);
    const overlays: ChartRuntime['overlays'] = {};
    const volume = charts[1].addHistogramSeries({ title: indicatorLineTitle('volume'), priceFormat: { type: 'volume' }, priceLineVisible: false });
    const rsiSeries = charts[2].addLineSeries({ title: indicatorLineTitle('rsi'), color: '#c05bea', lineWidth: 1, priceLineVisible: false, autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
    for (const level of [30, 70]) rsiSeries.createPriceLine({ price: level, color: '#77638b', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false });
    const macdSeries = charts[3].addLineSeries({ title: indicatorLineTitle('macd'), color: '#008cff', lineWidth: 1, priceLineVisible: false });
    const signal = charts[3].addLineSeries({ title: indicatorLineTitle('signal'), color: '#ff8800', lineWidth: 1, priceLineVisible: false });
    const histogram = charts[3].addHistogramSeries({ title: indicatorLineTitle('histogram'), priceLineVisible: false, lastValueVisible: true });
    const atr = charts[4].addLineSeries({ title: indicatorLineTitle('atr'), color: '#cc6979', lineWidth: 1, priceLineVisible: false });
    runtime.current = { charts, candles: candleSeries, signalLabels, volume, overlays, rsi: rsiSeries, macd: macdSeries, signal, histogram, atr };
    revision.current = '';
    let syncing = false;
    let frame = 0;
    const scheduleRedraw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => redraw(value => value + 1));
    };
    const rangeHandlers = charts.map((chart, index) => {
      const handler = (next: LogicalRange | null) => {
        if (!next || syncing) return;
        syncing = true;
        try {
          charts.forEach((other, otherIndex) => {
            if (otherIndex !== index) other.timeScale().setVisibleLogicalRange(next);
          });
        } finally {
          syncing = false;
        }
        scheduleRedraw();
        if (index === 0 && next.from < 10 && historyGesture.current) {
          historyGesture.current = false;
          loadOlderRef.current();
        }
      };
      chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
      return handler;
    });
    const series = [candleSeries, volume, rsiSeries, macdSeries, atr] as const;
    const crosshairHandlers = charts.map((chart, index) => {
      const handler = (event: MouseEventParams) => {
        if (syncing) return;
        syncing = true;
        try {
          setHoverTime(typeof event.time === 'number' ? event.time : null);
          charts.forEach((other, otherIndex) => {
            if (otherIndex !== index) synchronizeCrosshair(other, series[otherIndex], containers[otherIndex]!, event);
          });
        } finally {
          syncing = false;
        }
      };
      chart.subscribeCrosshairMove(handler);
      return handler;
    });
    const observer = new ResizeObserver(() => {
      charts.forEach((chart, index) => {
        const container = containers[index]!;
        if (container.clientWidth > 0 && container.clientHeight > 0) chart.resize(container.clientWidth, container.clientHeight);
      });
      scheduleRedraw();
    });
    containers.forEach(container => observer.observe(container!));
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      charts.forEach((chart, index) => {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(rangeHandlers[index]);
        chart.unsubscribeCrosshairMove(crosshairHandlers[index]);
        chart.remove();
      });
      runtime.current = null;
    };
  }, []);

  useEffect(() => {
    const api = runtime.current;
    if (!api) return;
    const visible = [true, volumeVisible, indicators.rsi, indicators.macd, indicators.atr];
    const bottom = visible.lastIndexOf(true);
    api.charts.forEach((chart, index) => chart.timeScale().applyOptions({ visible: index === bottom }));
  }, [volumeVisible, indicators.rsi, indicators.macd, indicators.atr]);

  useEffect(() => {
    const intraday = typeof timeframe === 'number';
    runtime.current?.charts.forEach(chart => chart.applyOptions({ timeScale: {
      timeVisible: intraday,
      tickMarkFormatter: (time: number) => intraday ? timeLabel(time) : new Date(time * 1000).toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
        ...(timeframe === 'M' ? { month: 'short', year: '2-digit' } : { day: '2-digit', month: 'short', year: '2-digit' }),
      }),
    } }));
  }, [timeframe]);

  const applyRange = useCallback((choice: Range) => {
    const chart = runtime.current?.charts[0];
    if (!chart || !candles.length) return;
    const lastTime = candleTime(candles[candles.length - 1]);
    const cutoff = choice === '1D'
      ? Math.floor((lastTime + 19800) / 86400) * 86400 - 19800
      : lastTime - 5 * 86400;
    const from = choice === 'All' ? 0 : typeof timeframe !== 'number' ? Math.max(0, candles.length - 60) :
      Math.max(0, candles.findIndex(candle => candleTime(candle) >= cutoff));
    chart.timeScale().setVisibleLogicalRange({ from: from - 1, to: candles.length + 5 } as LogicalRange);
  }, [candles, timeframe]);

  useEffect(() => {
    const api = runtime.current;
    if (!api) return;
    const old = previousBars.current;
    const oldRange = api.charts[0].timeScale().getVisibleLogicalRange();
    const prepended = old.key === historyKey && old.candles.length && candles.length
      ? candles.findIndex(candle => candleTime(candle) === candleTime(old.candles[0])) : 0;
    const incremental = old.key === historyKey && old.candles.length > 0 && candles.length >= old.candles.length &&
      old.candles.slice(0, -1).every((bar, index) => {
        const next = candles[index];
        return candleTime(bar) === candleTime(next) && bar.o === next.o && bar.h === next.h &&
          bar.l === next.l && bar.c === next.c && bar.v === next.v;
      }) && candleTime(old.candles[old.candles.length - 1]) === candleTime(candles[old.candles.length - 1]);
    const changedCandles = incremental ? candles.slice(old.candles.length - 1) : candles;
    const priceBars = changedCandles.map(candle => ({ time: candleTime(candle) as UTCTimestamp, open: candle.o, high: candle.h, low: candle.l, close: candle.c }));
    const volumeBars = changedCandles.map(candle => ({ time: candleTime(candle) as UTCTimestamp, value: candle.v, color: candle.c >= candle.o ? '#00bba599' : '#ee405399' }));
    if (incremental) {
      priceBars.forEach(bar => api.candles.update(bar));
      volumeBars.forEach(bar => api.volume.update(bar));
    } else {
      api.candles.setData(priceBars);
      api.volume.setData(volumeBars);
    }
    const previous = previousCalculation.current;
    const trend = analytics.supertrendUp?.at(-1)?.value !== undefined ? 'up' : 'down';
    const tailOnly = incremental && !calculation.rebuilt && previous.key === historyKey;
    const tailFrom = Math.min(calculation.changedFrom, Math.max(0, old.candles.length - 1));
    const syncLine = (series: ISeriesApi<'Line'>, values: IndicatorSample[], tail: boolean) => {
      if (tail) points(values.slice(tailFrom)).forEach(point => series.update(point));
      else series.setData(points(values));
    };
    const overlayData = Object.fromEntries(Object.entries(analytics).filter(([id]) =>
      !['rsi', 'macd', 'signal', 'histogram', 'atr', 'ema12', 'ema26'].includes(id)));
    const allOverlays = { ...overlayData, ...pivotSeries };
    for (const id of Object.keys(api.overlays)) {
      if (!(id in allOverlays)) {
        api.charts[0].removeSeries(api.overlays[id]);
        delete api.overlays[id];
      }
    }
    for (const [id, values] of Object.entries(allOverlays)) {
      const pivot = id.includes(':');
      const metadata = INDICATORS.find(item => item.id === id);
      const name = id.split(':').at(-1) ?? '';
      const color = id === 'supertrendDown' ? DOWN : id === 'supertrendUp' ? UP :
        id === 'ema13' ? '#e2b74d' : id === 'ema21' ? '#af81ff' :
        pivot ? name.startsWith('R') || name === 'TC' ? '#e85c78' :
          name.startsWith('S') || name === 'BC' ? '#00bba5' : '#6c99eb' : metadata?.color ?? '#00cbb8';
      const existed = !!api.overlays[id];
      if (!existed) api.overlays[id] = api.charts[0].addLineSeries({
        color, lineWidth: id.startsWith('supertrend') || ['ema9', 'ema20', 'ema50', 'vwap'].includes(id) ? 2 :
          ['ema100', 'ema200'].includes(id) ? 3 : 1,
        lineType: pivot ? LineType.WithSteps : LineType.Simple,
        lineStyle: id.startsWith('camarilla:') || id === 'ema100' ? LineStyle.Dashed :
          id === 'vwap' || id === 'ema200' ? LineStyle.Dotted : LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        autoscaleInfoProvider: pivot ? () => null : undefined,
        crosshairMarkerVisible: !pivot,
        title: indicatorLineTitle(id),
      });
      const samePivotPeriod = old.candles.length > 0 && candles.length > 0 &&
        sessionDate(candleTime(old.candles[old.candles.length - 1])) === sessionDate(candleTime(candles[candles.length - 1]));
      const supertrend = id.startsWith('supertrend');
      const plotValues = supertrend ? segmentedLine(values, color) : values;
      syncLine(api.overlays[id], plotValues, existed && tailOnly &&
        (!pivot || previous.daily === history.dailyCandles && samePivotPeriod) &&
        (!supertrend || old.candles.length === candles.length && previous.trend === trend));
      const latestValue = values.at(-1)?.value;
      const labelVisible = latestValue !== undefined && Number.isFinite(latestValue);
      if (api.overlays[id].options().lastValueVisible !== labelVisible) {
        api.overlays[id].applyOptions({ lastValueVisible: labelVisible });
      }
    }
    syncLine(api.rsi, analytics.rsi ?? [], tailOnly && indicators.rsi);
    syncLine(api.atr, analytics.atr ?? [], tailOnly && indicators.atr);
    syncLine(api.macd, analytics.macd ?? [], tailOnly && indicators.macd);
    syncLine(api.signal, analytics.signal ?? [], tailOnly && indicators.macd);
    const histogram = analytics.histogram ?? [];
    const bars = (tailOnly && indicators.macd ? histogram.slice(tailFrom) : histogram).map(point => ({
      ...point, time: point.time as UTCTimestamp, color: (point.value ?? 0) >= 0 ? UP : DOWN,
    }));
    if (tailOnly && indicators.macd) bars.forEach(bar => api.histogram.update(bar));
    else api.histogram.setData(bars);
    previousCalculation.current = { key: historyKey, daily: history.dailyCandles, trend };
    const nextRevision = historyKey;
    if (candles.length && revision.current !== nextRevision) {
      revision.current = nextRevision;
      applyRange(range);
    } else if (prepended > 0 && oldRange) {
      api.charts[0].timeScale().setVisibleLogicalRange({
        from: oldRange.from + prepended, to: oldRange.to + prepended,
      } as LogicalRange);
    }
    previousBars.current = { key: historyKey, candles };
    redraw(value => value + 1);
  }, [candles, analytics, calculation, pivotSeries, history.dailyCandles, indicators, historyKey, range, applyRange]);

  useEffect(() => {
    const api = runtime.current;
    if (!api) return;
    if (!rejection || !showTradePlan) { api.signalLabels.setData([], []); return; }
    // Clean chart: BUY / SELL at entry and EXIT where the trade closed, each with its exact price.
    const exact = (value: number) => value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    const bars = candles.map(candle => ({ time: candleTime(candle), h: candle.h, l: candle.l }));
    const byTime = new Map(bars.map(bar => [bar.time, bar]));
    const labels: ChartSignalLabel[] = [];
    const signals = rejection.active?.early ? [...rejection.signals, rejection.active] : rejection.signals;
    for (const signal of signals) {
      const buy = signal.side === 'BUY';
      labels.push({
        id: signal.id, time: signal.time, price: signal.entry, kind: signal.side, placement: buy ? 'below' : 'above',
        text: `${signal.early ? 'EARLY ' : ''}${signal.side} ${exact(signal.entry)}`, early: signal.early,
      });
      const { exitTime, exitPrice, netPoints, resolved } = signal.outcome;
      const exitBar = exitTime !== undefined ? byTime.get(exitTime) : undefined;
      if (!resolved || exitBar === undefined || exitPrice === undefined) continue;
      labels.push({
        id: `${signal.id}:exit`, time: exitBar.time, price: exitPrice, kind: 'EXIT',
        // Opposite side from the entry label so ENTRY and EXIT never share a spot.
        placement: buy ? 'above' : 'below',
        text: `EXIT ${exact(exitPrice)}`,
        ...(netPoints !== undefined ? { detail: `${netPoints >= 0 ? '+' : ''}${netPoints.toFixed(1)} pts`, detailPositive: netPoints >= 0 } : {}),
      });
    }
    api.signalLabels.setData(labels, bars);
  }, [rejection, showTradePlan, candles]);

  const activeTrade = showTradePlan && rejection?.active ? rejection.active : null;
  const activeLevels = activeTrade ? `${activeTrade.stopLoss}|${activeTrade.target1}|${activeTrade.target2}` : '';
  useEffect(() => {
    const api = runtime.current;
    if (!api || !activeLevels) return;
    const [stopLoss, target1, target2] = activeLevels.split('|').map(Number);
    // Open trade only: where it exits (stop / targets) is visible before price gets there.
    const lines = ([['SL', stopLoss, '#ff4d5e'], ['T1', target1, '#38d6b0'], ['T2', target2, '#c084fc']] as const)
      .map(([title, value, color]) => api.candles.createPriceLine({
        price: value, color, title, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true,
      }));
    return () => lines.forEach(line => api.candles.removePriceLine(line));
  }, [activeLevels]);

  useEffect(() => {
    const api = runtime.current;
    if (!api) return;
    api.charts.forEach(chart => chart.applyOptions({
      grid: { vertLines: { visible: grid }, horzLines: { visible: grid } },
      crosshair: { mode: magnet ? CrosshairMode.Magnet : CrosshairMode.Normal },
    }));
    api.charts[0].priceScale('right').applyOptions({ mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal, autoScale });
    // Dragging the axis turns library auto-scale off silently; re-apply it whenever the instrument or timeframe changes.
  }, [grid, logScale, autoScale, magnet, indicators.volume, indicators.rsi, indicators.macd, symbol, timeframe]);

  const changeSymbol = (next: ChartSymbol) => {
    setSymbol(next); setDraft(null); setPreview(null); setHoverTime(null); setBrowsingDate(''); setHistoryDate('');
  };
  const chooseTemplate = (name: string) => {
    const next = name === 'Custom' ? custom : TEMPLATES[name];
    if (!next) { setNotice('Save a custom template first using "Save as Template".'); return; }
    setIndicators({ ...next }); setTemplate(name); setNotice('');
  };
  const saveTemplate = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(indicators));
      setCustom({ ...indicators }); setTemplate('Custom'); setNotice('Custom indicator template saved in this browser.');
    } catch (error) {
      console.error('Unable to save chart template:', error);
      setNotice('Could not save the template. Browser storage may be unavailable.');
    }
  };
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === rootRef.current) await document.exitFullscreen();
      else await rootRef.current?.requestFullscreen();
    } catch (error) {
      console.error('Unable to change chart fullscreen:', error);
      setNotice('Fullscreen is unavailable in this browser.');
    }
  };
  const downloadImage = () => {
    const api = runtime.current;
    if (!api) return;
    try {
      const chartImages = api.charts.filter((_, i) => i === 0 || [volumeVisible, indicators.rsi, indicators.macd, indicators.atr][i - 1]).map(chart => chart.takeScreenshot());
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(...chartImages.map(image => image.width));
      canvas.height = chartImages.reduce((height, image) => height + image.height, 40);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas is unavailable');
      context.fillStyle = '#00111c'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#dce6f0'; context.font = '14px Arial';
      context.fillText(`${selected.name} | ${timeframeLabel(timeframe)} | ${source ?? 'Waiting'} | MyDailyTradeSignals`, 12, 25);
      let y = 40;
      chartImages.forEach(image => { context.drawImage(image, 0, y); y += image.height; });
      const anchor = document.createElement('a');
      anchor.download = `${symbol}-${timeframeLabel(timeframe)}-chart.png`; anchor.href = canvas.toDataURL('image/png'); anchor.click();
      setNotice('Chart image downloaded (chart series only; drawings are not included).');
    } catch (error) {
      console.error('Unable to export chart image:', error);
      setNotice('The chart image could not be exported.');
    }
  };
  const pointerAnchor = (event: React.PointerEvent<SVGSVGElement>): Anchor | null => {
    const api = runtime.current;
    if (!api || !candles.length) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const logical = api.charts[0].timeScale().coordinateToLogical(x);
    const value = api.candles.coordinateToPrice(y);
    if (logical === null || value === null) return null;
    const index = Math.max(0, Math.min(candles.length - 1, Math.round(logical)));
    const candle = candles[index];
    const snap = magnet ? [candle.o, candle.h, candle.l, candle.c].reduce((a, b) => Math.abs(a - value) < Math.abs(b - value) ? a : b) : value;
    return { time: candleTime(candle), price: snap };
  };
  const addDrawing = (event: React.PointerEvent<SVGSVGElement>) => {
    const anchor = pointerAnchor(event);
    if (!anchor || tool === 'cursor') return;
    if (tool === 'horizontal' || draft) {
      const drawing: Drawing = { id: Date.now(), tool, start: draft ?? anchor, end: anchor };
      setDrawings(current => ({ ...current, [symbol]: [...(current[symbol] ?? []), drawing] }));
      setDraft(null); setPreview(null); setTool('cursor');
    } else { setDraft(anchor); setPreview(anchor); }
  };
  const drawingCoordinates = (anchor: Anchor) => {
    const api = runtime.current;
    if (!api) return null;
    const x = api.charts[0].timeScale().timeToCoordinate(anchor.time as UTCTimestamp);
    const y = api.candles.priceToCoordinate(anchor.price);
    return x === null || y === null ? null : { x, y };
  };
  const setDrawingTool = (next: Tool) => { setTool(next); setDraft(null); setPreview(null); setShowDrawings(true); };
  const tools = [
    { id: 'cursor', label: 'Crosshair', icon: Crosshair },
    { id: 'trend', label: 'Trend line', icon: TrendingUp },
    { id: 'horizontal', label: 'Horizontal line', icon: Minus },
    { id: 'rectangle', label: 'Rectangle zone', icon: Square },
  ] as const;
  const hoveredIndex = hoverTime === null ? candles.length - 1 : candles.findIndex(candle => candleTime(candle) === hoverTime);
  const indicatorValue = (id: string) => (analytics[id] ?? pivotSeries[id])?.[hoveredIndex]?.value;
  const toggleIndicator = (id: keyof IndicatorSettings) => {
    setIndicators(current => ({ ...current, [id]: !current[id] }));
    setTemplate('');
  };
  const indicatorReadout = (id: keyof IndicatorSettings): string => {
    if (!indicators[id]) return 'Hidden';
    if (!candles.length) return 'Waiting for candles';
    if (id === 'volume') return hovered?.v ? compact(hovered.v) : 'Index volume not provided';
    if (id === 'macd') return `${price(indicatorValue('macd'))} / ${price(indicatorValue('signal'))}`;
    if (id === 'emaCross') return analytics.ema21?.[hoveredIndex]?.value === undefined
      ? 'Warm-up: 21 candles required' : `${price(indicatorValue('ema13'))} / ${price(indicatorValue('ema21'))}`;
    if (id === 'supertrend') {
      const up = indicatorValue('supertrendUp');
      const down = indicatorValue('supertrendDown');
      return up !== undefined ? `${price(up)} Uptrend` : down !== undefined ? `${price(down)} Downtrend` : 'Warm-up: 10 candles required';
    }
    if (id === 'camarilla' || id === 'pivots' || id === 'cpr') {
      if (id === 'cpr' && typeof timeframe !== 'number') return 'Intraday only';
      const key = id === 'pivots' ? 'traditional' : id;
      const names = id === 'cpr' ? ['TC', 'P', 'BC'] : ['P', 'R1', 'R2', 'R3', 'R4', 'R5', 'S1', 'S2', 'S3', 'S4', 'S5'];
      const available = names.filter(name => indicatorValue(`${key}:${name}`) !== undefined);
      return available.length ? available.map(name => `${name} ${price(indicatorValue(`${key}:${name}`))}`).join('  ') :
        'Previous completed period OHLC unavailable';
    }
    if (id === 'vwap') return typeof timeframe !== 'number' ? 'Session VWAP: intraday only' :
      indicatorValue('vwap') === undefined ? 'Unavailable: index volume not provided' : price(indicatorValue('vwap'));
    const value = indicatorValue(id);
    return value === undefined ? id.startsWith('ema') ? `Warm-up: ${id.slice(3)} candles required` : 'Waiting for sufficient history' : price(value);
  };
  const renderDrawing = (drawing: Drawing) => {
    const start = drawingCoordinates(drawing.start);
    const end = drawingCoordinates(drawing.end);
    if (!start || !end) return null;
    if (drawing.tool === 'horizontal') return <line key={drawing.id} x1="0" x2="100%" y1={start.y} y2={start.y} stroke="#00b9ff" strokeWidth="1.5" />;
    if (drawing.tool === 'rectangle') return <rect key={drawing.id} x={Math.min(start.x, end.x)} y={Math.min(start.y, end.y)} width={Math.max(1, Math.abs(end.x - start.x))} height={Math.max(1, Math.abs(end.y - start.y))} fill="#008cff22" stroke="#00b9ff" />;
    return <line key={drawing.id} x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="#00b9ff" strokeWidth="1.5" />;
  };
  const renderCprBands = () => {
    const api = runtime.current;
    if (!api) return null;
    return cprSessions.map(session => {
      const from = api.charts[0].timeScale().timeToCoordinate(session.from as UTCTimestamp);
      const to = api.charts[0].timeScale().timeToCoordinate(session.to as UTCTimestamp);
      const top = api.candles.priceToCoordinate(session.top);
      const bottom = api.candles.priceToCoordinate(session.bottom);
      if (from === null || to === null || top === null || bottom === null) return null;
      return <rect key={session.date} x={from - 3} y={Math.min(top, bottom)}
        width={Math.max(6, to - from + 6)} height={Math.max(1, Math.abs(bottom - top))}
        fill="#ee355c20" stroke="#ee355c55" strokeWidth="0.5" />;
    });
  };
  return (
    <section id="observatory-trade-chart" ref={rootRef} className={styles.workspace} aria-label="Market Intelligence Observatory trade chart">
      <div className="flex gap-2 p-3" role="tablist" aria-label="Observatory chart view">
        <button id="observatory-chart-tab" role="tab" aria-selected={workspaceTab === 'chart'} aria-controls="observatory-chart-content"
          className={styles.button} onClick={() => setWorkspaceTab('chart')}>Advanced Chart</button>
        <button id="observatory-paper-tab" role="tab" aria-selected={workspaceTab === 'paper'} aria-controls="observatory-paper-content"
          className={styles.button} onClick={() => setWorkspaceTab('paper')}>Automated Paper Trading</button>
      </div>
      {paperRecorderError && <p role="alert" className="p-3 text-red-400">{paperRecorderError}</p>}
      <div id="observatory-paper-content" role="tabpanel" aria-labelledby="observatory-paper-tab" hidden={workspaceTab !== 'paper'}>
        {workspaceTab === 'paper' && <ChartPaperTrading recorderError={paperRecorderError} />}
      </div>
      <div id="observatory-chart-content" role="tabpanel" aria-labelledby="observatory-chart-tab" hidden={workspaceTab !== 'chart'}>
      <div className="flex flex-wrap items-center gap-2 px-3 pb-2 text-xs">
        <label className="flex items-center gap-2"><input type="checkbox" checked={showPaperLevels}
          onChange={event => setShowPaperLevels(event.target.checked)} />
          Automated paper levels on chart</label>
        {paper.error && <span className="text-red-400">{paper.error}</span>}
        {!paper.error && paper.snapshot && <span>{paper.snapshot.health.running ? 'Paper engine running' : 'Paper engine not running'} ·
          {paper.snapshot.pending_count} pending signals · {paper.snapshot.trades.length} recent paper trades</span>}
        {paper.snapshot && paper.snapshot.trades.length > 0 && <select
          aria-label="Select paper trade overlay" className={styles.button}
          value={selectedPaperTrade?.id ?? ''} onChange={event => setSelectedPaperTradeId(event.target.value || null)}>
          <option value="">Auto-select latest</option>
          {paper.snapshot.trades.map(trade => <option key={trade.id} value={trade.id}>
            {trade.strategy} | {trade.side} | {trade.exit_at ? trade.exit_reason : 'OPEN'}
          </option>)}
        </select>}
      </div>
      <div className={styles.toolbar}>
        <div className={styles.symbols} role="tablist" aria-label="Chart index">
          {SYMBOLS.map(item => {
            const tick = marketData[item.id];
            const quote = chartData[item.id]?.spot ?? tick?.price;
            return <button key={item.id} id={`chart-tab-${item.id}`} role="tab" aria-selected={symbol === item.id} aria-controls="index-chart-panel" className={styles.symbol} onClick={() => changeSymbol(item.id)}
              onKeyDown={event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const index = SYMBOLS.findIndex(index => index.id === item.id);
                const next = event.key === 'Home' ? SYMBOLS[0] : event.key === 'End' ? SYMBOLS[2] : SYMBOLS[(index + (event.key === 'ArrowRight' ? 1 : 2)) % 3];
                changeSymbol(next.id); document.getElementById(`chart-tab-${next.id}`)?.focus();
              }} tabIndex={symbol === item.id ? 0 : -1}>
              <span><span className={styles.symbolName}>{item.name}</span><span className={styles.quote}><strong>{price(quote)}</strong>{tick && <small className={tick.change >= 0 ? styles.up : styles.down}>{tick.change >= 0 ? '+' : ''}{price(tick.change)} ({tick.changePercent >= 0 ? '+' : ''}{tick.changePercent.toFixed(2)}%)</small>}</span></span>
            </button>;
          })}
        </div>
        <div className={styles.intervals} aria-label="Chart timeframe">
          <button disabled title="The chart feed provides 3-minute and 5-minute candles, not 1-minute candles">1m</button>
          {([3, 5, 15, 30, 60, 'D', 'W', 'M'] as const).map(value => <button key={value} aria-pressed={timeframe === value}
            onPointerEnter={() => { if (value !== timeframe) void prefetchChartHistory(symbol, value); }}
            onFocus={() => { if (value !== timeframe) void prefetchChartHistory(symbol, value); }}
            onClick={() => { setTimeframe(value); setRange('1D'); setDraft(null); setPreview(null); setBrowsingDate(''); setHistoryDate(''); }}>{timeframeLabel(value)}</button>)}
        </div>
        <div className={styles.status} data-live={live}><i /><span>{browsingDate ? 'Historical view' : live ? 'Market Open' : !sessionOpen ? 'Market Closed' : data ? 'Cached Data' : 'Connecting'}<small>{browsingDate ? 'No live signals' : live ? 'Live' : data ? 'Last available session' : 'Waiting for feed'}</small></span></div>
        <div className={styles.actions}>
          <button className={styles.button} onClick={() => { setPanel('Indicators'); setControlsOpen(value => !value); }} aria-expanded={controlsOpen} aria-controls="chart-controls-content" title="Indicator controls"><LayoutTemplate size={14} /><span>Indicators & setup</span><ChevronDown size={11} /></button>
          <button className={styles.button} onClick={saveTemplate} title="Save current indicator template"><Save size={14} />Save</button>
          <button className={styles.button} onClick={downloadImage} aria-label="Download chart image"><Camera size={15} /></button>
          <button className={styles.button} onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit chart fullscreen' : 'Chart fullscreen'}>{fullscreen ? <Minimize size={15} /> : <Maximize size={15} />}</button>
        </div>
      </div>
      <div className={styles.historyBar} aria-label="Chart history navigation">
        <button className={styles.button} disabled={history.loading || !history.hasMore} onClick={history.loadOlder}>
          {history.loading ? 'Loading history...' : 'Load older'}
        </button>
        <form onSubmit={event => {
          event.preventDefault();
          if (!historyDate) return;
          setBrowsingDate(historyDate); setRange('1D'); history.jumpToDate(historyDate);
        }}>
          <label htmlFor="chart-history-date">Go to session</label>
          <input id="chart-history-date" type="date" min="1970-01-02"
            max={sessionDate(Math.floor(now / 1000))} value={historyDate} required
            onChange={event => setHistoryDate(event.target.value)} />
          <button className={styles.button} type="submit" disabled={history.loading}>Go</button>
        </form>
        <button className={styles.button} onClick={() => {
          setBrowsingDate(''); setHistoryDate(''); setRange('1D');
          history.latest();
        }}>Latest session</button>
        <span>{candles.length.toLocaleString('en-IN')} bars · Zerodha cash-index OHLC · Scroll left for more</span>
        {history.warmingContext && <span>Warming month context in background</span>}
        {browsingDate && <strong>Historical view · live signals disabled</strong>}
        {history.error && <div role="alert">{history.error} <button className={styles.button} onClick={history.retry}>Retry history</button></div>}
        {!history.loading && !history.error && history.candles.length === 0 && <span>No Zerodha candles in this date range. Try another date or load an older page.</span>}
      </div>
      <div className={styles.body} data-controls-open={controlsOpen}>
        <div className={styles.left} id="index-chart-panel" role="tabpanel" aria-labelledby={`chart-tab-${symbol}`}>
          <div className={styles.tools} role="toolbar" aria-label="Chart drawing tools">
            {tools.map(({ id, label, icon: Icon }) => <button key={id} className={styles.tool} title={label} aria-label={label} aria-pressed={tool === id} onClick={() => setDrawingTool(id)}><Icon size={19} strokeWidth={1.4} /></button>)}
            <div className={styles.toolDivider} />
            <button className={styles.tool} title="Snap drawing points to candle prices" aria-label="Magnet mode" aria-pressed={magnet} onClick={() => setMagnet(value => !value)}><Magnet size={19} strokeWidth={1.4} /></button>
            <button className={styles.tool} aria-label="Undo last drawing" disabled={!selectedDrawings.length} onClick={() => setDrawings(current => ({ ...current, [symbol]: selectedDrawings.slice(0, -1) }))}><Undo2 size={19} strokeWidth={1.4} /></button>
            <button className={styles.tool} aria-label={showDrawings ? 'Hide drawings' : 'Show drawings'} onClick={() => setShowDrawings(value => !value)}>{showDrawings ? <Eye size={19} strokeWidth={1.4} /> : <EyeOff size={19} strokeWidth={1.4} />}</button>
            <button className={styles.tool} aria-label="Clear drawings" disabled={!selectedDrawings.length} onClick={() => setDrawings(current => ({ ...current, [symbol]: [] }))}><Trash2 size={19} strokeWidth={1.4} /></button>
          </div>
          <div className={styles.plots} onPointerDownCapture={() => { historyGesture.current = true; }}
            onWheelCapture={() => { historyGesture.current = true; }}>
            <div className={styles.chartHeading}>
              <strong>{selected.name} · {timeframeLabel(timeframe)} · {selected.exchange}</strong>
              {hovered && <span className={hovered.c >= hovered.o ? styles.up : styles.down}>O {price(hovered.o)} · H {price(hovered.h)} · L {price(hovered.l)} · C {price(hovered.c)}</span>}
            </div>
            <div className={styles.price} onPointerMove={event => { if (event.buttons) redraw(value => value + 1); }} onPointerUp={() => redraw(value => value + 1)} onWheel={() => requestAnimationFrame(() => redraw(value => value + 1))}>
              <div ref={priceRef} style={{ width: '100%', height: '100%' }} />
              <svg className={`${styles.drawing} ${tool !== 'cursor' ? styles.drawingEnabled : ''}`}
                style={{ right: runtime.current?.charts[0].priceScale('right').width() ?? 72, width: `calc(100% - ${runtime.current?.charts[0].priceScale('right').width() ?? 72}px)` }}
                onPointerDown={addDrawing} onPointerMove={event => { if (draft) setPreview(pointerAnchor(event)); }} onKeyDown={event => { if (event.key === 'Escape') setDrawingTool('cursor'); }} tabIndex={tool === 'cursor' ? -1 : 0} aria-label="Chart drawing surface">
                {indicators.cpr && renderCprBands()}
                {showDrawings && selectedDrawings.map(renderDrawing)}
                {draft && preview && tool !== 'cursor' && renderDrawing({ id: -1, tool, start: draft, end: preview })}
                {showPaperLevels && selectedPaperTrade && (() => {
                  const api = runtime.current;
                  if (!api || typeof timeframe !== 'number') return null;
                  const plotWidth = (priceRef.current?.clientWidth ?? 0) - api.charts[0].priceScale('right').width() - api.charts[0].priceScale('left').width();
                  if (!Number.isFinite(plotWidth) || plotWidth <= 0) return null;
                  const labels = chartPaperLevels(selectedPaperTrade).flatMap(level => {
                    const anchor = paperEventCandle(candles, level.at, timeframe);
                    if (anchor === null) return [];
                    const x = api.charts[0].timeScale().timeToCoordinate(anchor as UTCTimestamp);
                    const y = api.candles.priceToCoordinate(level.value);
                    if (x === null || y === null) return [];
                    const text = `${level.text} ${price(level.value)}`;
                    return [{ ...level, text, x, y, width: text.length * 6.5 + 16 }];
                  });
                  return layoutTradeLabels(labels, plotWidth, priceRef.current?.clientHeight ?? 0).map(label => {
                    const level = labels.find(item => item.id === label.id)!;
                    return <g role="img" aria-label={level.text} key={`paper-${label.id}`}>
                      <line x1={label.anchorX} y1={label.anchorY} x2={plotWidth - 4} y2={label.anchorY}
                        stroke={level.color} strokeWidth={label.id === 'entry' ? 2 : 1.5} strokeDasharray={label.id === 'entry' ? undefined : '5 4'} opacity="0.85" />
                      <line x1={label.anchorX} y1={label.anchorY} x2={label.x + 8} y2={label.y + label.height / 2} stroke={level.color} strokeWidth="1" strokeDasharray="3 3" />
                      <rect x={label.x} y={label.y} width={label.width} height={label.height} rx="4" fill="#00131f" stroke={level.color} />
                      <text x={label.x + 8} y={label.y + 15} fill={level.color} fontSize="11" fontFamily="Arial, sans-serif">{level.text}</text>
                    </g>;
                  });
                })()}
              </svg>
              {!candles.length && <div className={styles.empty} role="status"><strong>Waiting for {selected.name} candles</strong><p>No chart data is available yet. The chart will update automatically when the market feed connects.</p></div>}
            </div>
            <div className={styles.pane} style={{ display: volumeVisible ? 'block' : 'none' }}><span className={styles.paneLabel}>Index volume <span style={{ color: UP }}>{hovered?.v ? compact(hovered.v) : 'Not provided by feed'}</span></span><div ref={volumeRef} style={{ height: 64 }} /></div>
            <div className={styles.pane} style={{ display: indicators.rsi ? 'block' : 'none', background: '#140e2b' }}><span className={styles.paneLabel}>RSI (14) <span style={{ color: '#c05bea' }}>{price(indicatorValue('rsi'))}</span></span><div ref={rsiRef} style={{ height: 80 }} /></div>
            <div className={styles.pane} style={{ display: 'none' }}><div ref={macdRef} style={{ height: 94 }} /></div>
            <div className={styles.pane} style={{ display: indicators.atr ? 'block' : 'none' }}><span className={styles.paneLabel}>ATR (14) <span style={{ color: '#cc6979' }}>{price(indicatorValue('atr'))}</span></span><div ref={atrRef} style={{ height: 80 }} /></div>
            <div className={styles.footer}>
              {(['1D', '5D', 'All'] as const).filter(choice => typeof timeframe === 'number' || choice !== '5D').map(choice => <button key={choice} className={range === choice ? styles.selectedRange : ''} onClick={() => { setRange(choice); applyRange(choice); }}>{typeof timeframe !== 'number' && choice === '1D' ? 'Recent' : choice}</button>)}
              <span className={styles.clock}>{last ? new Date(candleTime(last) * 1000).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) + ' · ' : ''}{browsingDate && last ? `${timeLabel(candleTime(last))} (IST) · Historical` : data?.timestamp ? `${timeLabel(Date.parse(data.timestamp) / 1000)} (IST)` : history.candles.length ? 'Zerodha history' : 'No data'}{!browsingDate && source && source !== 'LIVE' ? ` · ${source === 'MARKET_CLOSED' ? 'Closed' : 'Cached'}` : ''}</span>
              <button aria-pressed={logScale} onClick={() => setLogScale(value => !value)}>log</button>
              <button aria-pressed={autoScale} className={autoScale ? styles.selectedRange : ''} onClick={() => setAutoScale(value => !value)}>auto</button>
            </div>
          </div>
        </div>
        <aside className={styles.sidebar} aria-label="Chart controls">
          <div className={styles.controlsHeading}><strong>Chart controls</strong>
            <button className={styles.button} onClick={() => setControlsOpen(false)}>Close</button>
          </div>
          <details className={styles.riskPanel}>
            <summary>Setup & risk <span>{!showTradePlan ? 'OFF' : rejection?.active ? `${rejection.active.side} open` : 'No open trade'}</span></summary>
            <div className={styles.setupLevels}>
              {([
                ['ENTRY', rejection?.active?.entry, '#00d895'], ['STOP', rejection?.active?.stopLoss, '#ff5065'],
                ['TARGET 1', rejection?.active?.target1, '#38d6b0'], ['TARGET 2', rejection?.active?.target2, '#c084fc'],
              ] as const).map(([label, value, color]) => <span key={label}><small style={{ color }}>{label}</small><b>{showTradePlan ? price(value) : '--'}</b></span>)}
            </div>
            <div className={styles.setupNotes}>
              <span>Only strong rejections at support/resistance (EMA, CPR, Camarilla, pivots, swing high/low) confirmed by EMA 9/20, SuperTrend and RSI. BUY/SELL confirm on candle close; a dashed EARLY label shows a setup building on the live candle and can still change before close. One trade at a time; SL/T1/T2 lines show the open trade&apos;s exits. EXIT is the stop, target or session close (D/W/M hold across sessions). Rule-based signals, not a guaranteed prediction.</span>
              {rejection && <details open><summary>Rejection replay · {rejection.signals.length} signals</summary>
                <table className={styles.replayTable}><thead><tr><th>Set</th><th>Trades</th><th>Win%</th><th>Exp pts</th><th>PF</th><th>T1/T2</th></tr></thead>
                  <tbody>{([['All', rejection.stats.all], ['In-sample 70%', rejection.stats.inSample], ['Out-of-sample 30%', rejection.stats.outOfSample]] as const).map(([name, stat]) => <tr key={name}>
                    <td>{name}</td><td>{stat.trades}</td><td>{stat.winRate === null ? '--' : `${stat.winRate}%`}</td>
                    <td>{stat.expectancy === null ? '--' : stat.expectancy.toFixed(1)}</td><td>{stat.profitFactor === null ? '--' : stat.profitFactor.toFixed(2)}</td>
                    <td>{stat.t1Rate === null ? '--' : `${stat.t1Rate}/${stat.t2Rate ?? 0}%`}</td>
                  </tr>)}</tbody></table>
                <p>Replay on loaded candles: fill at next bar open + {rejection.costs.slippagePoints} pt slippage, {rejection.costs.feePoints} pt fees per trade, stop counted first when SL and target share a bar, 50% booked at T1 then stop to breakeven. Fixed rules; the 30% out-of-sample split is chronological. Past replay does not guarantee future results.</p>
                <p>{rejection.vwapStatus}. Levels are index prices; futures/options execution prices differ.</p>
              </details>}
            </div>
          </details>
          <details className={styles.institutionalPanel}>
            <summary>FII / DII context <span>{institutional.available ? institutional.bias : 'Unavailable'}</span></summary>
            <p>{institutional.label}{institutional.available ? ` · ${institutional.source}` : ''}</p>
            {institutional.available && <p>FII {price(institutional.fii)} Cr · DII {price(institutional.dii)} Cr</p>}
            <p>Reported market-wide daily cash flows, not live index-specific trades. Context only; excluded from intraday confidence and entries.</p>
          </details>
          <div className={styles.panelTabs} role="tablist" aria-label="Chart controls panel">
            {(['Indicators', 'Drawing Tools', 'Chart Settings'] as const).map(name => <button role="tab" key={name} aria-selected={panel === name} aria-controls="chart-controls-content" onClick={() => setPanel(name)}>{name}</button>)}
          </div>
          <div className={styles.panelContent} id="chart-controls-content">
            {panel === 'Indicators' && <>
              <div className={styles.priority}>
                <b>EMA 9/20/50 + EMA 200 context</b>
                <span>VWAP + volume · Daily CPR · RSI 14</span>
                <p>Balanced default, not a win-rate ranking. EMA 200 needs 200 bars. Cash-index VWAP needs genuine index volume; futures volume is never substituted. Camarilla and other pivots stay optional to avoid duplicate levels.</p>
                <button className={styles.button} onClick={() => chooseTemplate('Confluence focus')}>Use confluence focus</button>
              </div>
              <label className={styles.search}><Search size={14} /><input type="search" placeholder="Search indicators..." aria-label="Search indicators" value={query} onChange={event => setQuery(event.target.value)} /></label>
              <div className={styles.groupGrid}>
                {Array.from(new Set(INDICATORS.map(item => item.group))).map(group => {
                  const matches = INDICATORS.filter(item => item.group === group && `${item.label} ${group}`.toLowerCase().includes(query.toLowerCase()));
                  return matches.length > 0 && <details key={group} className={styles.group} open><summary>{group}</summary>{matches.map(item => (
                    <div key={item.id} className={styles.indicatorCard} data-core={TEMPLATES['Confluence focus'][item.id]}>
                      <label className={styles.indicator}><input type="checkbox" aria-label={item.label} checked={indicators[item.id]} onChange={() => toggleIndicator(item.id)} />
                        <span className={styles.swatch} style={{ background: item.color }} />
                        <span>{item.label}</span>{TEMPLATES['Confluence focus'][item.id] && <small>CORE</small>}
                      </label>
                      {indicators[item.id] && <div className={styles.indicatorValue} style={{ color: item.color }}>
                        {['pivots', 'camarilla', 'cpr'].includes(item.id) ? <details><summary>{item.id === 'cpr' ? 'Daily levels' : `Auto ${autoPivotAnchor(timeframe)} · last 15 periods`}</summary><p>{indicatorReadout(item.id)}</p></details> : indicatorReadout(item.id)}
                      </div>}
                    </div>
                  ))}</details>;
                })}
                {!INDICATORS.some(item => `${item.label} ${item.group}`.toLowerCase().includes(query.toLowerCase())) && <p className={styles.hint}>No matching indicators.</p>}
              </div>
              <div className={styles.templates}>
                <h4>Quick Templates</h4><div className={styles.templateGrid}>{[...Object.keys(TEMPLATES), 'Custom'].map(name => <button key={name} className={`${styles.button} ${template === name ? styles.active : ''}`} onClick={() => chooseTemplate(name)}>{name}</button>)}</div>
                <button className={`${styles.button} ${styles.saveTemplate}`} onClick={saveTemplate}>Save as Template</button>
              </div>
            </>}
            {panel === 'Drawing Tools' && <div className={styles.settings}>
              <h4>Drawing Tools</h4><p>Choose a tool, then click the chart. Trend lines and rectangles use two clicks. Drawings are kept separately for each index during this visit.</p>
              {tools.map(({ id, label, icon: Icon }) => <button key={id} className={`${styles.button} ${tool === id ? styles.active : ''}`} onClick={() => setDrawingTool(id)}><Icon size={15} />{label}</button>)}
              <p>{draft ? 'Click the second point to complete the drawing.' : tool === 'cursor' ? 'Drag to pan. Scroll to zoom.' : 'Click the chart to place the first point.'}</p>
              {tool !== 'cursor' && <button className={styles.button} onClick={() => setDrawingTool('cursor')}>Cancel drawing</button>}
              <div className={styles.drawingList}>{selectedDrawings.map((drawing, index) => <div className={styles.drawingRow} key={drawing.id}><span>{drawing.tool} {index + 1}</span><button className={styles.button} aria-label={`Delete drawing ${index + 1}`} onClick={() => setDrawings(current => ({ ...current, [symbol]: selectedDrawings.filter(item => item.id !== drawing.id) }))}><Trash2 size={12} /></button></div>)}</div>
            </div>}
            {panel === 'Chart Settings' && <div className={styles.settings}>
              <h4>Chart Settings</h4>
              <label>Grid lines<input type="checkbox" checked={grid} onChange={event => setGrid(event.target.checked)} /></label>
              <label>Logarithmic price scale<input type="checkbox" checked={logScale} onChange={event => setLogScale(event.target.checked)} /></label>
              <label>Auto price scale<input type="checkbox" checked={autoScale} onChange={event => setAutoScale(event.target.checked)} /></label>
              <label>Magnet crosshair<input type="checkbox" checked={magnet} onChange={event => setMagnet(event.target.checked)} /></label>
              <h4>Trade setup overlays</h4>
              <label>Show BUY / SELL / EXIT markers<input type="checkbox" checked={showTradePlan} onChange={event => setShowTradePlan(event.target.checked)} /></label>
              <button className={styles.button} onClick={() => { setRange('1D'); applyRange('1D'); setAutoScale(true); }}>Reset chart view</button>
              <p>Times are displayed in IST. Historical candles use native Zerodha intervals, loaded in 14-day pages and cached on the server. Scroll left or jump to a date for the maximum history available from Zerodha; availability varies by instrument and interval. No missing candles are invented.</p>
              <p>1D uses Zerodha daily OHLCV. 1W groups daily candles from Monday; 1M groups calendar months. Higher-timeframe history loads one year of daily records per page. The current period is forming, not a confirmed closed candle. Intraday signals, session VWAP and daily CPR are disabled; Auto pivots use monthly/yearly anchors.</p>
              <p>Cash-index prices are never mixed with futures volume. Index volume and VWAP are unavailable when Zerodha provides no traded volume. Live updates retain the existing stream cadence; zero latency or exact tick-for-tick parity with broker charts cannot be guaranteed.</p>
              <p>EMA and RSI need sufficient candle history. VWAP requires volume; cash-index feeds may not provide it. Daily pivots and CPR require previous-session OHLC.</p>
            </div>}
          </div>
        </aside>
      </div>
      {notice && <div className={styles.notice} role="status">{notice}</div>}
      {tool !== 'cursor' && <div className={styles.notice}>{tool === 'horizontal' ? 'Click a price to place a horizontal line.' : draft ? 'Click the second point to finish. Use Crosshair to cancel.' : 'Click the first point on the chart. Use Crosshair to cancel.'}</div>}
      </div>
    </section>
  );
}

export default memo(ChartWorkspace);
