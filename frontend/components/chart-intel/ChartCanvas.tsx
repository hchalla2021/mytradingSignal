'use client';

import { useEffect, useMemo, useRef } from 'react';
import {
  createChart,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type CandlestickData,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import type { Candle } from './useAIPrediction';
import { analyzeSMC, type SMC } from './smc';
import { CI, fmtINR, fmtCompact } from './theme';

interface Props {
  candles: Candle[];
  visiblePlots: Record<string, boolean>;
  onSMC?: (s: SMC) => void;
}

export default function ChartCanvas({ candles, visiblePlots, onSMC }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const lastSetTimeRef = useRef<number | null>(null);
  const lastSetLenRef = useRef<number>(0);
  const didInitialFitRef = useRef<boolean>(false);

  const smc = useMemo(() => analyzeSMC(candles), [candles]);

  useEffect(() => { onSMC?.(smc); }, [smc, onSMC]);

  // Init chart
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: 'transparent' },
        textColor: '#7c8aa6',
        fontFamily: 'ui-sans-serif, system-ui',
      },
      grid: {
        vertLines: { color: CI.grid, style: LineStyle.Dotted },
        horzLines: { color: CI.grid, style: LineStyle.Dotted },
      },
      rightPriceScale: {
        borderColor: 'transparent',
        scaleMargins: { top: 0.08, bottom: 0.12 },
      },
      timeScale: {
        borderColor: 'transparent',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(34,211,238,0.5)', width: 1, style: LineStyle.Solid, labelBackgroundColor: '#0a1024' },
        horzLine: { color: 'rgba(34,211,238,0.5)', width: 1, style: LineStyle.Solid, labelBackgroundColor: '#0a1024' },
      },
    });
    const series = chart.addCandlestickSeries({
      upColor: CI.bull,
      downColor: CI.bear,
      wickUpColor: CI.bull,
      wickDownColor: CI.bear,
      borderVisible: false,
      priceFormat: { type: 'price', precision: 2, minMove: 0.05 },
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => drawOverlay());
    ro.observe(containerRef.current);
    chart.timeScale().subscribeVisibleTimeRangeChange(drawOverlay);
    chart.subscribeCrosshairMove(drawOverlay);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push data — use incremental `update()` for tick-level changes so the chart
  // actually animates in real time. Fall back to `setData()` for bulk loads /
  // timeframe switches where the array shape changes.
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || candles.length === 0) return;

    const lastCandle = candles[candles.length - 1];
    const lastTime = lastCandle.time as number;
    const prevLen = lastSetLenRef.current;
    const prevLastTime = lastSetTimeRef.current;

    const lenDiff = candles.length - prevLen;
    const isAppend = prevLastTime !== null && lenDiff === 1 && lastTime > prevLastTime;
    const isInPlaceUpdate = prevLastTime !== null && lenDiff === 0 && lastTime === prevLastTime;

    if (isAppend || isInPlaceUpdate) {
      series.update({
        time: lastTime as UTCTimestamp,
        open: lastCandle.open,
        high: lastCandle.high,
        low: lastCandle.low,
        close: lastCandle.close,
      });
    } else {
      const data: CandlestickData[] = candles.map(c => ({
        time: c.time as UTCTimestamp,
        open: c.open, high: c.high, low: c.low, close: c.close,
      }));
      series.setData(data);
      if (!didInitialFitRef.current) {
        chart.timeScale().fitContent();
        didInitialFitRef.current = true;
      }
    }
    lastSetTimeRef.current = lastTime;
    lastSetLenRef.current = candles.length;

    // Keep the latest candle in view as new bars print.
    if (isAppend) {
      try { chart.timeScale().scrollToRealTime(); } catch { /* ignore */ }
    }

    // Markers for BOS / CHOCH
    if (visiblePlots.bos) {
      const markers: SeriesMarker<Time>[] = smc.structures.map(s => ({
        time: candles[s.i]?.time as UTCTimestamp,
        position: s.dir === 'UP' ? 'belowBar' : 'aboveBar',
        color: s.kind === 'BOS' ? (s.dir === 'UP' ? CI.bull : CI.bear) : CI.cyan,
        shape: s.dir === 'UP' ? 'arrowUp' : 'arrowDown',
        text: s.kind,
      }));
      series.setMarkers(markers.filter(m => m.time != null));
    } else {
      series.setMarkers([]);
    }

    drawOverlay();
  }, [candles, smc, visiblePlots]);

  // Overlay zones (FVG / OB / Liquidity pools) drawn on a canvas above the chart
  function drawOverlay() {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const canvas = overlayRef.current;
    const container = containerRef.current;
    if (!chart || !series || !canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const ts = chart.timeScale();
    const toX = (t: number) => ts.timeToCoordinate(t as UTCTimestamp);
    const toY = (p: number) => series.priceToCoordinate(p);

    // FVG zones
    if (visiblePlots.fvg) {
      for (const z of smc.zones) {
        if (z.kind !== 'FVG_UP' && z.kind !== 'FVG_DOWN') continue;
        const x1 = toX(z.startTime); const y1 = toY(z.top);
        const x2 = ts.timeToCoordinate(candles[candles.length - 1]?.time as UTCTimestamp);
        const y2 = toY(z.bottom);
        if (x1 == null || x2 == null || y1 == null || y2 == null) continue;
        ctx.fillStyle = CI.fvg;
        ctx.fillRect(x1, Math.min(y1, y2), Math.max(2, x2 - x1), Math.abs(y2 - y1));
        ctx.strokeStyle = CI.fvgEdge;
        ctx.strokeRect(x1, Math.min(y1, y2), Math.max(2, x2 - x1), Math.abs(y2 - y1));
        ctx.fillStyle = '#cbd5ff';
        ctx.font = '10px ui-sans-serif';
        ctx.fillText(`FVG  ${fmtINR(z.bottom,0)}–${fmtINR(z.top,0)}  ${fmtCompact(z.liquidity||0)}`, x1 + 6, Math.min(y1, y2) + 12);
      }
    }

    // Order blocks
    if (visiblePlots.ob) {
      for (const z of smc.zones) {
        if (z.kind !== 'BULL_OB' && z.kind !== 'BEAR_OB') continue;
        const x1 = toX(z.startTime);
        const x2 = ts.timeToCoordinate(candles[candles.length - 1]?.time as UTCTimestamp);
        const y1 = toY(z.top); const y2 = toY(z.bottom);
        if (x1 == null || x2 == null || y1 == null || y2 == null) continue;
        ctx.fillStyle = z.kind === 'BULL_OB' ? 'rgba(16,224,163,0.10)' : 'rgba(255,77,109,0.10)';
        ctx.fillRect(x1, Math.min(y1, y2), Math.max(2, x2 - x1), Math.abs(y2 - y1));
        ctx.strokeStyle = z.kind === 'BULL_OB' ? 'rgba(16,224,163,0.55)' : 'rgba(255,77,109,0.55)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x1, Math.min(y1, y2), Math.max(2, x2 - x1), Math.abs(y2 - y1));
        ctx.fillStyle = z.kind === 'BULL_OB' ? '#bbf7d0' : '#fecaca';
        ctx.font = '11px ui-sans-serif';
        ctx.fillText(
          `${z.kind === 'BULL_OB' ? 'BULLISH OB' : 'BEARISH OB'}  ${fmtINR(z.bottom,0)}–${fmtINR(z.top,0)}`,
          x1 + 6, Math.min(y1, y2) - 4
        );
      }
    }

    // Liquidity pools (dashed horizontal)
    if (visiblePlots.liquidity) {
      for (const p of smc.pools.slice(0, 5)) {
        const y = toY(p.price);
        if (y == null) continue;
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = p.side === 'BSL' ? 'rgba(34,211,238,0.55)' : 'rgba(168,85,247,0.55)';
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(rect.width - 60, y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = p.side === 'BSL' ? '#67e8f9' : '#d8b4fe';
        ctx.font = '10px ui-sans-serif';
        ctx.fillText(`${p.side}  ${fmtINR(p.price,0)}`, 8, y - 4);
      }
    }

    // Support/Resistance + Day H/L + Prev Day H/L pill labels (right side)
    const drawLevel = (price: number, color: string, label: string) => {
      const y = toY(price); if (y == null) return;
      ctx.setLineDash([2, 6]);
      ctx.strokeStyle = color;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(rect.width - 80, y); ctx.stroke();
      ctx.setLineDash([]);
      // right pill
      ctx.fillStyle = color;
      ctx.fillRect(rect.width - 78, y - 9, 72, 18);
      ctx.fillStyle = '#0a1024';
      ctx.font = '600 10px ui-monospace, ui-sans-serif';
      ctx.fillText(fmtINR(price, 2), rect.width - 72, y + 4);
      ctx.fillStyle = color;
      ctx.font = '10px ui-sans-serif';
      ctx.fillText(label, rect.width - 78 - ctx.measureText(label).width - 6, y + 4);
    };

    if (visiblePlots.supres) {
      drawLevel(smc.resistance, '#ec4899', 'RESISTANCE');
      drawLevel(smc.support,    '#2dd4bf', 'SUPPORT');
    }
    if (visiblePlots.dayhl) {
      drawLevel(smc.dayHigh, '#f59e0b', 'DAY HIGH');
      drawLevel(smc.dayLow,  '#f59e0b', 'DAY LOW');
    }
    if (visiblePlots.prevhl) {
      drawLevel(smc.prevDayHigh, '#fb923c', 'PREV HIGH');
      drawLevel(smc.prevDayLow,  '#fb923c', 'PREV LOW');
    }
  }

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="absolute inset-0" />
      <canvas ref={overlayRef} className="absolute inset-0 pointer-events-none" />
    </div>
  );
}
