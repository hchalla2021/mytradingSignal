'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ColorType, CrosshairMode, createChart, LineStyle,
  type IChartApi, type ISeriesApi, type UTCTimestamp,
} from 'lightweight-charts';
import { prefetchChartHistory, useChartHistory } from '@/hooks/useChartHistory';
import type { MarketData } from '@/hooks/useMarketSocket';
import type { Candle } from '@/hooks/useChartIntelligence';
import { applyLiveTick, candleTime, ema, rsi, sessionDate, vwap, type ChartSymbol } from '@/lib/chart-workspace';

const SYMBOLS: { id: ChartSymbol; label: string }[] = [
  { id: 'NIFTY', label: 'NIFTY' },
  { id: 'BANKNIFTY', label: 'BANK NIFTY' },
  { id: 'SENSEX', label: 'SENSEX' },
];
const TIMEFRAMES = [1, 3, 5, 15] as const;
type MiniTimeframe = typeof TIMEFRAMES[number];
type OverlayKey = 'ema9' | 'ema20' | 'ema50' | 'vwap' | 'volume';
type MiniChartApi = {
  chart: IChartApi;
  candles: ISeriesApi<'Candlestick'>;
  volume: ISeriesApi<'Histogram'>;
  ema9: ISeriesApi<'Line'>;
  ema20: ISeriesApi<'Line'>;
  ema50: ISeriesApi<'Line'>;
  vwap: ISeriesApi<'Line'>;
};
type ChartDataState = { key: string; source: Candle[]; candles: Candle[] };

const price = (value: number | undefined) => value == null || !Number.isFinite(value)
  ? '—' : `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const indicatorValue = (value: number | undefined) => value == null || !Number.isFinite(value)
  ? '—' : value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatAxisPrice = (value: number) => value.toLocaleString('en-IN', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const formatChartTime = (time: number) => new Date(time * 1000).toLocaleString('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
});

export default function QuantumEdgeMiniChart({ marketData }: { marketData?: MarketData }) {
  const [symbol, setSymbol] = useState<ChartSymbol>('NIFTY');
  const [timeframe, setTimeframe] = useState<MiniTimeframe>(5);
  const [dateInput, setDateInput] = useState('');
  const [reviewDate, setReviewDate] = useState('');
  const [switching, setSwitching] = useState(false);
  const [visible, setVisible] = useState<Record<OverlayKey, boolean>>({
    ema9: true, ema20: true, ema50: false, vwap: true, volume: true,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<MiniChartApi | null>(null);
  const previousData = useRef<ChartDataState | null>(null);
  const history = useChartHistory(symbol, timeframe);
  const jumpToDate = history.jumpToDate;
  const tick = marketData?.[symbol] ?? null;
  const tickTime = tick ? Date.parse(tick.timestamp) / 1000 : NaN;
  const tickFresh = !reviewDate && tick?.status === 'LIVE' && Number.isFinite(tickTime)
    && Math.abs(Date.now() / 1000 - tickTime) < 30;
  const candles = useMemo(() => {
    if (!history.candles.length || !tickFresh || !tick) return history.candles;
    return applyLiveTick(history.candles, { price: tick.price, time: tickTime }, timeframe).candles;
  }, [history.candles, tickFresh, tick, tickTime, timeframe]);
  const indicators = useMemo(() => ({
    ema9: ema(candles, 9),
    ema20: ema(candles, 20),
    ema50: ema(candles, 50),
    vwap: vwap(candles),
    rsi14: rsi(candles, 14).at(-1)?.value,
  }), [candles]);
  const latest = candles.at(-1);
  const latestVwap = latest && indicators.vwap.at(-1) &&
    sessionDate(indicators.vwap.at(-1)!.time) === sessionDate(candleTime(latest))
    ? indicators.vwap.at(-1)?.value : undefined;
  const hasVolume = candles.some(candle => candle.v > 0);
  const quote = tickFresh && tick ? tick.price : latest?.c;
  const today = sessionDate(Math.floor(Date.now() / 1000));
  const chartKey = `${symbol}:${timeframe}:${history.jumpRevision}`;
  const rsiLevel = Math.min(100, Math.max(0, indicators.rsi14 ?? 50));
  const historical = Boolean(reviewDate);

  useEffect(() => {
    if (history.loading || history.error) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        for (const item of SYMBOLS) {
          if (cancelled) return;
          if (item.id !== symbol) await prefetchChartHistory(item.id, timeframe);
        }
      })();
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [history.error, history.loading, symbol, timeframe]);

  useEffect(() => {
    if (reviewDate) jumpToDate(reviewDate);
  }, [jumpToDate, reviewDate]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      width: container.clientWidth || 640,
      height: container.clientHeight || 270,
      layout: {
        background: { type: ColorType.Solid, color: '#06121b' },
        textColor: '#93a8b8',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        fontSize: 11,
      },
      grid: { vertLines: { color: '#142634' }, horzLines: { color: '#142634' } },
      rightPriceScale: {
        borderColor: '#243847',
        minimumWidth: 76,
        scaleMargins: { top: 0.1, bottom: 0.24 },
      },
      timeScale: {
        borderColor: '#243847',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        barSpacing: 8,
        minBarSpacing: 3,
        tickMarkFormatter: (time: number) => new Date(time * 1000).toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
        }),
      },
      localization: {
        priceFormatter: formatAxisPrice,
        timeFormatter: formatChartTime,
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: 'rgba(147, 168, 184, .45)', style: LineStyle.Dashed, labelBackgroundColor: '#263d4d' },
        horzLine: { color: 'rgba(147, 168, 184, .45)', style: LineStyle.Dashed, labelBackgroundColor: '#263d4d' },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#39c6a5',
      downColor: '#f05b6f',
      wickUpColor: '#39c6a5',
      wickDownColor: '#f05b6f',
      borderVisible: false,
      priceLineColor: '#e65f70',
      priceLineStyle: LineStyle.Dashed,
      lastValueVisible: true,
    });
    const volumeSeries = chart.addHistogramSeries({
      title: 'Volume',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      priceLineVisible: false,
      lastValueVisible: false,
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
    const ema9Series = chart.addLineSeries({
      title: 'EMA 9', color: '#57d7bd', lineWidth: 2,
      priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true,
    });
    const ema20Series = chart.addLineSeries({
      title: 'EMA 20', color: '#4e9bff', lineWidth: 2,
      priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true,
    });
    const ema50Series = chart.addLineSeries({
      title: 'EMA 50', color: '#c19aff', lineWidth: 1, lineStyle: LineStyle.Dashed,
      priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true, visible: false,
    });
    const vwapSeries = chart.addLineSeries({
      title: 'VWAP', color: '#ffc45c', lineWidth: 2,
      priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true,
    });
    chartRef.current = {
      chart, candles: candleSeries, volume: volumeSeries,
      ema9: ema9Series, ema20: ema20Series, ema50: ema50Series, vwap: vwapSeries,
    };
    const observer = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      if (width > 0 && height > 0) chart.applyOptions({ width: Math.floor(width), height: Math.floor(height) });
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      previousData.current = null;
    };
  }, []);

  useEffect(() => {
    const api = chartRef.current;
    if (!api) return;
    const prior = previousData.current;
    if (!candles.length && history.loading && prior?.candles.length) return;
    const keyChanged = prior?.key !== chartKey;
    const replaceData = keyChanged || prior?.source !== history.candles ||
      Boolean(prior?.candles.length && candles.length && candleTime(candles.at(-1)!) < candleTime(prior.candles.at(-1)!));
    const candleData = candles.map(candle => ({
      time: candleTime(candle) as UTCTimestamp,
      open: candle.o, high: candle.h, low: candle.l, close: candle.c,
    }));
    const volumeData = candles.map(candle => ({
      time: candleTime(candle) as UTCTimestamp,
      value: candle.v,
      color: candle.c >= candle.o ? 'rgba(57, 198, 165, .54)' : 'rgba(240, 91, 111, .54)',
    }));
    const lineData = {
      ema9: indicators.ema9.map(point => ({ ...point, time: point.time as UTCTimestamp })),
      ema20: indicators.ema20.map(point => ({ ...point, time: point.time as UTCTimestamp })),
      ema50: indicators.ema50.map(point => ({ ...point, time: point.time as UTCTimestamp })),
      vwap: indicators.vwap.map(point => ({ ...point, time: point.time as UTCTimestamp })),
    };
    if (replaceData) {
      api.candles.setData(candleData);
      api.volume.setData(volumeData);
      api.ema9.setData(lineData.ema9);
      api.ema20.setData(lineData.ema20);
      api.ema50.setData(lineData.ema50);
      api.vwap.setData(lineData.vwap);
      if (keyChanged && candles.length) {
        const to = candles.length + 3;
        api.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - 85), to });
      }
    } else if (candles.length) {
      api.candles.update(candleData.at(-1)!);
      api.volume.update(volumeData.at(-1)!);
      for (const [key, series] of [
        ['ema9', api.ema9], ['ema20', api.ema20], ['ema50', api.ema50], ['vwap', api.vwap],
      ] as const) {
        const point = lineData[key].at(-1);
        if (point) series.update(point);
      }
    }
    api.ema9.applyOptions({ visible: visible.ema9 });
    api.ema20.applyOptions({ visible: visible.ema20 });
    api.ema50.applyOptions({ visible: visible.ema50 });
    api.vwap.applyOptions({ visible: visible.vwap });
    api.volume.applyOptions({ visible: visible.volume && hasVolume });
    previousData.current = { key: chartKey, source: history.candles, candles };
    if (candles.length || !history.loading) setSwitching(false);
  }, [candles, chartKey, hasVolume, history.candles, history.loading, indicators, visible]);

  const review = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dateInput) return;
    setSwitching(true);
    if (reviewDate === dateInput) history.jumpToDate(dateInput);
    else setReviewDate(dateInput);
  };
  const latestSession = () => {
    setSwitching(true);
    setReviewDate('');
    setDateInput('');
    history.latest();
  };
  const toggleOverlay = (key: OverlayKey) => {
    setVisible(current => ({ ...current, [key]: !current[key] }));
  };
  const overlays: { key: OverlayKey; label: string; color: string }[] = [
    { key: 'ema9', label: 'EMA 9', color: '#57d7bd' },
    { key: 'ema20', label: 'EMA 20', color: '#4e9bff' },
    { key: 'ema50', label: 'EMA 50', color: '#c19aff' },
    { key: 'vwap', label: 'VWAP', color: '#ffc45c' },
    { key: 'volume', label: 'Volume', color: '#39c6a5' },
  ];

  return <section className="qe-mini-chart" aria-label={`${symbol} candlestick chart`}>
    <div className="qe-mini-chart-head">
      <div className="qe-mini-chart-title">
        <div className="qe-mini-chart-title-line">
          <h4>LIVE INDEX CHART</h4>
          <span className={`qe-mini-feed-state${tickFresh ? ' is-live' : historical ? ' is-history' : ''}`}>
            {historical ? 'HISTORICAL REVIEW' : tickFresh ? 'LIVE' : 'LAST DATA'}
          </span>
          {history.loading &&           <span className="qe-mini-loading"><i />LOADING HISTORY</span>}
        </div>
        <span>{symbol.replace('BANKNIFTY', 'BANK NIFTY')} · {timeframe}m · {candles.length.toLocaleString('en-IN')} bars</span>
      </div>
      <div className="qe-mini-quote">
        <small>{historical ? 'REVIEW PRICE' : tickFresh ? 'LIVE PRICE' : 'LAST CLOSE'}</small>
        <b>{price(quote)}</b>
      </div>
    </div>

    <div className="qe-mini-index-tabs" role="group" aria-label="Choose chart index">
      {SYMBOLS.map(item => <button key={item.id} type="button" aria-pressed={symbol === item.id}
        onClick={() => { setSwitching(true); setSymbol(item.id); }}>{item.label}</button>)}
    </div>

    <div className="qe-mini-chart-toolbar">
      <div className="qe-mini-timeframes" role="group" aria-label="Chart timeframe">
        {TIMEFRAMES.map(period => <button key={period} type="button" aria-pressed={timeframe === period}
          onClick={() => { setSwitching(true); setTimeframe(period); }}>{period}m</button>)}
      </div>
      <form className="qe-mini-history-form" onSubmit={review}>
        <label htmlFor="qe-chart-history-date">Review session</label>
        <input id="qe-chart-history-date" aria-label="Choose historical session" type="date"
          max={today} value={dateInput} onChange={event => setDateInput(event.target.value)} />
        <button type="submit" disabled={!dateInput}>Go</button>
        <button type="button" className="qe-mini-latest" onClick={latestSession} disabled={!historical}>
          Latest
        </button>
      </form>
    </div>

    <div className="qe-mini-indicators" role="group" aria-label="Toggle chart indicators">
      {overlays.map(item => <button key={item.key} type="button"
        className={`qe-mini-indicator qe-mini-indicator-${item.key}`}
        aria-pressed={visible[item.key] && (item.key !== 'volume' || hasVolume)}
        onClick={() => toggleOverlay(item.key)}
        disabled={item.key === 'volume' && !hasVolume}
        title={item.key === 'volume' && !hasVolume ? 'Volume is not supplied for these cash-index candles' : undefined}>
        <i style={{ backgroundColor: item.color }} />{item.key === 'volume' && !hasVolume ? 'Volume N/A' : item.label}
        {item.key === 'ema9' && <b>{indicatorValue(indicators.ema9.at(-1)?.value)}</b>}
        {item.key === 'ema20' && <b>{indicatorValue(indicators.ema20.at(-1)?.value)}</b>}
        {item.key === 'ema50' && <b>{indicatorValue(indicators.ema50.at(-1)?.value)}</b>}
        {item.key === 'vwap' && <b>{indicatorValue(latestVwap)}</b>}
      </button>)}
    </div>

    <div className="qe-mini-plot-wrap">
      <div className="qe-mini-plot" ref={containerRef}
        role="img" aria-label={`${symbol} ${timeframe}-minute candlesticks with interactive price and volume chart`} />
      {!candles.length && <div className={`qe-mini-chart-message${switching ? ' is-switching' : ''}`}
        role={history.error ? 'alert' : 'status'}>
        {history.error ? <>
          <span>Unable to load chart history</span>
          <button type="button" onClick={() => void history.retry()}>Retry</button>
        </> : history.loading ? <>
          <i className="qe-mini-spinner" /> Loading {symbol.replace('BANKNIFTY', 'BANK NIFTY')} {timeframe}m candles…
        </> : 'No candles for this session. Choose another date or retry.'}
      </div>}
      {history.error && candles.length > 0 && <div className="qe-mini-chart-warning" role="alert">
        Showing cached candles · history refresh failed
        <button type="button" onClick={() => void history.retry()}>Retry</button>
      </div>}
    </div>
    {candles.length > 0 && !hasVolume && <div className="qe-mini-data-note">
      Volume and VWAP are unavailable because the cash-index feed does not include traded volume.
    </div>}

    <div className="qe-mini-rsi" aria-label={`RSI 14 ${indicatorValue(indicators.rsi14)}`}>
      <span>RSI 14</span>
      <div className="qe-mini-rsi-track" aria-hidden="true">
        <i className="qe-mini-rsi-low" /><i className="qe-mini-rsi-high" />
        <b style={{ left: `${rsiLevel}%` }} />
      </div>
      <strong className={rsiLevel >= 70 ? 'is-high' : rsiLevel <= 30 ? 'is-low' : ''}>
        {indicatorValue(indicators.rsi14)}
      </strong>
      <small>{rsiLevel >= 70 ? 'Overbought' : rsiLevel <= 30 ? 'Oversold' : 'Neutral'}</small>
    </div>

    <div className="qe-mini-chart-footer">
      <span>Drag to review · pinch or wheel to zoom · crosshair for price/time</span>
      <button type="button" onClick={() => chartRef.current?.chart.timeScale().fitContent()}
        disabled={!candles.length}>Reset view</button>
      <button type="button" onClick={() => history.loadOlder()}
        disabled={!history.hasMore || history.loading}>Load earlier candles</button>
    </div>
  </section>;
}
