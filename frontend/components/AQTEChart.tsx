'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { ColorType, CrosshairMode, TickMarkType, createChart, type ISeriesApi, type Time, type UTCTimestamp } from 'lightweight-charts';
import { useChartHistory } from '@/hooks/useChartHistory';
import { applyLiveTick, candleTime, ema, type LiveTickExtremes, type Timeframe } from '@/lib/chart-workspace';
import { centerLatestCandle, resizeChartIfChanged } from '@/lib/chart-render-sync';
import { aqteLabel, aqtePrice, type AQTESymbol } from '@/lib/aqte-display';
import type { MarketTick } from '@/hooks/useMarketSocket';
import type { Candle } from '@/hooks/useChartIntelligence';

const FRAMES = [1, 3, 5, 15, 60] as const;
const COLORS = ['#24c7f5', '#e7bd5d', '#fb805a'];
const chartDate = (time: Time) => new Date(typeof time === 'number' ? time * 1000 :
  typeof time === 'string' ? time : Date.UTC(time.year, time.month - 1, time.day));
const clock = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
const dateLabel = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', day: '2-digit' });

function AQTEChart({ symbol, tick }: { symbol: AQTESymbol; tick: MarketTick | null }) {
  const [timeframe, setTimeframe] = useState<Timeframe>(5);
  const history = useChartHistory(symbol, timeframe);
  const container = useRef<HTMLDivElement>(null);
  const runtime = useRef<{
    candle: ISeriesApi<'Candlestick'>; volume: ISeriesApi<'Histogram'>;
    lines: ISeriesApi<'Line'>[]; chart: ReturnType<typeof createChart>;
  } | null>(null);
  const extremes = useRef<LiveTickExtremes | null>(null);
  const source = useRef('');
  const centered = useRef('');
  const averages = useRef<Array<{ time: number; value: number; previous: number | null } | null>>([]);
  const liveBars = useRef<Candle[]>([]);
  const latestTick = useRef(tick);
  latestTick.current = tick;
  const historyKey = `${symbol}:${timeframe}`;

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const chart = createChart(element, {
      width: element.clientWidth, height: element.clientHeight,
      layout: { background: { type: ColorType.Solid, color: '#070f1a' }, textColor: '#98abc3', fontSize: 10 },
      grid: { vertLines: { color: '#132031' }, horzLines: { color: '#132031' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#26394f' },
      timeScale: {
        borderColor: '#26394f', timeVisible: true, secondsVisible: false, rightOffset: 3,
        tickMarkFormatter: (time: Time, type: TickMarkType) =>
          type === TickMarkType.Time || type === TickMarkType.TimeWithSeconds ? clock.format(chartDate(time)) : dateLabel.format(chartDate(time)),
      },
      localization: {
        timeFormatter: (time: Time) => chartDate(time).toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
        }),
      },
    });
    const candle = chart.addCandlestickSeries({
      upColor: '#00d58d', downColor: '#f14d61', wickUpColor: '#00d58d', wickDownColor: '#f14d61',
      borderVisible: false, priceLineColor: '#00d58d',
    });
    candle.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.2 } });
    const volume = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.83, bottom: 0 } });
    const lines = COLORS.map(color => chart.addLineSeries({
      color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    }));
    runtime.current = { candle, volume, lines, chart };
    const observer = new ResizeObserver(() => resizeChartIfChanged(chart, element));
    observer.observe(element);
    return () => { observer.disconnect(); runtime.current = null; chart.remove(); };
  }, []);

  useEffect(() => {
    const current = runtime.current;
    if (!current) return;
    const changed = source.current !== historyKey;
    // History prefetch toggles loading while retaining the current page.
    if (!changed && (history.loading || history.error)) return;
    const range = !changed ? current.chart.timeScale().getVisibleRange() : null;
    if (changed) extremes.current = null;
    let bars = history.error || history.loading ? [] : history.candles;
    if (!changed && bars.length) {
      const lastTime = candleTime(bars[bars.length - 1]);
      bars = [...bars, ...liveBars.current.filter(bar => candleTime(bar) > lastTime)];
      const quote = latestTick.current;
      if (quote) {
        const next = applyLiveTick(bars, { price: quote.price, time: Date.parse(quote.timestamp) / 1000 }, timeframe, extremes.current);
        bars = next.candles;
        extremes.current = next.extremes;
      }
    }
    liveBars.current = bars;
    current.candle.setData(bars.map(bar => ({
      time: candleTime(bar) as UTCTimestamp, open: bar.o, high: bar.h, low: bar.l, close: bar.c,
    })));
    current.volume.setData(bars.map(bar => ({
      time: candleTime(bar) as UTCTimestamp, value: bar.v,
      color: bar.c >= bar.o ? '#00d58d65' : '#f14d6165',
    })));
    [9, 20, 50].forEach((period, index) => {
      const points = ema(bars, period);
      const last = points.at(-1);
      averages.current[index] = last ? { ...last, previous: points.at(-2)?.value ?? null } : null;
      current.lines[index].setData(points.map(point => ({ ...point, time: point.time as UTCTimestamp })));
    });
    if (range) current.chart.timeScale().setVisibleRange(range);
    if (bars.length && centered.current !== historyKey) {
      if (container.current) centerLatestCandle(current.chart, container.current, bars.length);
      centered.current = historyKey;
    }
    source.current = historyKey;
  }, [history.candles, history.loading, history.error, historyKey, timeframe]);

  useEffect(() => {
    const current = runtime.current;
    if (!current || !tick || source.current !== historyKey || !liveBars.current.length) return;
    const previous = liveBars.current.at(-1);
    const next = applyLiveTick(liveBars.current, { price: tick.price, time: Date.parse(tick.timestamp) / 1000 }, timeframe, extremes.current);
    extremes.current = next.extremes;
    liveBars.current = next.candles;
    const bar = next.candles.at(-1);
    if (!bar) return;
    current.candle.update({
      time: candleTime(bar) as UTCTimestamp, open: bar.o, high: bar.h, low: bar.l, close: bar.c,
    });
    [9, 20, 50].forEach((period, index) => {
      const base = averages.current[index];
      if (!base || !previous) return;
      const time = candleTime(bar);
      const seed = time === base.time ? base.previous : base.value;
      const value = seed == null ? base.value + (bar.c - previous.c) / period : seed + 2 / (period + 1) * (bar.c - seed);
      averages.current[index] = { time, value, previous: seed };
      current.lines[index].update({ time: time as UTCTimestamp, value });
    });
  }, [tick, timeframe, history.candles, history.loading, history.error, historyKey]);

  const last = history.candles.at(-1);
  const hasHistory = history.candles.length > 0;
  return (
    <section className="aqte-terminal-card aqte-terminal-chart" aria-label={`${aqteLabel(symbol)} price chart`}>
      <header className="aqte-chart-toolbar">
        <h4>{aqteLabel(symbol)} <span className="aqte-muted">· Index</span></h4>
        <div className="aqte-chart-frames" aria-label="Chart timeframe">
          {FRAMES.map(frame => <button key={frame} type="button" aria-pressed={timeframe === frame}
            onClick={() => setTimeframe(frame)}>{frame === 60 ? '1h' : `${frame}m`}</button>)}
        </div>
      </header>
      <p className="aqte-chart-ohlc">O {aqtePrice(last?.o)} <span>H {aqtePrice(last?.h)}</span> <span>L {aqtePrice(last?.l)}</span> C {aqtePrice(last?.c)} {tick && <span>Live {aqtePrice(tick.price)}</span>}</p>
      <div className="aqte-chart-legend"><span>EMA 9</span><span>EMA 20</span><span>EMA 50</span><small>Index history · not futures intelligence</small></div>
      <div className="aqte-chart-canvas" ref={container} />
      {history.loading && !hasHistory && <p className="aqte-chart-message" role="status">Loading exchange history…</p>}
      {history.error && <div className={hasHistory ? 'aqte-chart-warning' : 'aqte-chart-message'} role="alert"><p>{history.error}</p><button type="button" onClick={() => void history.retry()}>Retry chart</button></div>}
      {!history.loading && !history.error && !history.candles.length && <p className="aqte-chart-message">No recorded candles available.</p>}
      <footer className="aqte-card-footer">Exchange history · {tick ? 'Shared live feed' : 'Historical view'} · IST</footer>
    </section>
  );
}

export default memo(AQTEChart);
