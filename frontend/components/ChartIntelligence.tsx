'use client';

import React, { memo, useMemo, useState, useRef, useEffect, useCallback } from 'react';
import {
  useChartIntelligence,
  type SymbolChartData,
  type Candle,
  type FVG,
  type OrderBlock,
  type Liquidity,
  type ChartLevels,
  type ChartDataSource,
} from '@/hooks/useChartIntelligence';
import { useMarketSocket } from '@/hooks/useMarketSocket';

// ── Chart constants ─────────────────────────────────────────────────────────

const CFG = {
  PRICE_AXIS_W: 72,
  TIME_AXIS_H: 22,
  PAD_TOP: 14,
  CANDLE_W: 7,
  CANDLE_GAP: 3,
  CHART_H: 360,

  // Base colors
  BG: '#080e1a',
  GRID: 'rgba(148,163,184,0.04)',
  GRID_STRONG: 'rgba(148,163,184,0.08)',

  // ── CANDLES — Zerodha teal-green / coral-red ────────────────────
  BULL: '#26a69a',
  BULL_WICK: '#26a69a',
  BULL_BODY: '#26a69a',
  BEAR: '#ef5350',
  BEAR_WICK: '#ef5350',
  BEAR_BODY: '#ef5350',

  // ── FVG — lime-green / amber  (clearly different from candles) ──
  FVG_BULL_FILL: 'rgba(132,204,22,0.09)',   // lime-green
  FVG_BULL_BORDER: '#84cc16',
  FVG_BEAR_FILL: 'rgba(251,146,60,0.09)',   // amber-orange
  FVG_BEAR_BORDER: '#fb923c',
  FVG_FILLED_FILL: 'rgba(148,163,184,0.03)',

  // ── ORDER BLOCKS — gold / violet ────────────────────────────────
  OB_BULL_FILL: 'rgba(234,179,8,0.11)',     // gold
  OB_BULL_BORDER: '#eab308',
  OB_BEAR_FILL: 'rgba(192,132,252,0.11)',   // violet
  OB_BEAR_BORDER: '#c084fc',
  OB_MITIGATED_ALPHA: 0.35,

  // ── LIQUIDITY — fuchsia / emerald ───────────────────────────────
  LIQ_SELL: '#e879f9',    // fuchsia  (sell-side / equal highs)
  LIQ_BUY: '#34d399',     // emerald  (buy-side / equal lows)
  LIQ_SWEPT: 'rgba(148,163,184,0.30)',

  // ── KEY LEVELS — each a unique hue ──────────────────────────────
  PDH: '#facc15',    // golden-yellow  "previous day high"
  PDL: '#f59e0b',    // amber          "previous day low"
  CDH: '#38bdf8',    // sky-blue       "current day high"
  CDL: '#7dd3fc',    // light-blue     "current day low"
  SUPPORT: '#4ade80',     // bright-green   clearly bullish
  RESISTANCE: '#fb7185',  // rose-pink      clearly bearish (lighter than candle red)

  // ── Current price ────────────────────────────────────────────────
  CURRENT_PRICE: '#818cf8',   // indigo/violet — unique, stands out from everything

  // Axis
  AXIS_TEXT: '#64748b',
  AXIS_LINE: 'rgba(148,163,184,0.10)',
  CROSSHAIR: 'rgba(148,163,184,0.20)',
  CROSSHAIR_LABEL_BG: 'rgba(15,23,42,0.96)',

  // Proximity highlight (glow when candle near a level)
  PROX_PCT: 0.003,   // 0.3% proximity triggers glow
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtPrice(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return ''; }
}

function fmtNum(n: number): string {
  if (n >= 10_000_000) return (n / 10_000_000).toFixed(1) + 'Cr';
  if (n >= 100_000) return (n / 100_000).toFixed(1) + 'L';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

/** Returns true if |a-b|/b <= pct */
function near(a: number, b: number, pct = CFG.PROX_PCT): boolean {
  return b > 0 && Math.abs(a - b) / b <= pct;
}

// ── Canvas Chart ────────────────────────────────────────────────────────────

interface CandleChartProps {
  candles: Candle[];
  fvg: FVG[];
  ob: OrderBlock[];
  liquidity: Liquidity[];
  levels: ChartLevels;
  spot: number;
  liveSpot?: number;
  chartHeight?: number; // expandable height from parent
}

const CandleChart = memo<CandleChartProps>(({ candles, fvg, ob, liquidity, levels, spot, liveSpot, chartHeight }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // ── State stored in refs (no re-render needed, RAF reads them directly) ──
  // scrollRef: how many candles to offset from the "live" right edge (0 = latest candle visible)
  const scrollRef = useRef(0);
  const mouseRef = useRef({ x: -1, y: -1 });

  // Horizontal drag
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartScroll = useRef(0);   // in candles
  const dragStartPixelPan = useRef(0); // sub-candle pixel offset at drag start

  // Sub-candle pixel pan (0 … candleStep-1) for buttery smooth panning
  const pixelPanRef = useRef(0);

  // Vertical drag (price scale)
  const isVDragging = useRef(false);
  const vDragStartY = useRef(0);
  const vDragStartScale = useRef(1);

  // Zoom levels
  const candleWRef = useRef(CFG.CANDLE_W);    // current candle body width (zoom)
  const candleGapRef = useRef(CFG.CANDLE_GAP); // current gap between candles
  const vScaleRef = useRef(1.0);               // vertical price range multiplier (>1 = zoomed in)

  // Live spot ref — updated every tick, read by RAF without recreating callbacks
  const liveSpotRef = useRef<number>(liveSpot ?? spot);
  useEffect(() => { liveSpotRef.current = liveSpot ?? spot; }, [liveSpot, spot]);

  // Track last rendered canvas size — only resize when it actually changes
  // (resizing canvas clears it and causes a blank flash = flicker)
  const lastCanvasW = useRef(0);
  const lastCanvasDpr = useRef(0);

  // Smoothed Y-axis range — lerp toward target each frame to prevent axis jumping
  const smoothMinRef = useRef(0);
  const smoothMaxRef = useRef(0);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || candles.length === 0) return;

    const effectiveSpot = liveSpotRef.current > 0 ? liveSpotRef.current : spot;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const W = rect.width;
    const H = chartHeight ?? CFG.CHART_H;

    // Only set canvas dimensions when size actually changed — avoids flicker
    if (lastCanvasW.current !== W || lastCanvasDpr.current !== dpr || lastCanvasW.current === 0) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      lastCanvasW.current = W;
      lastCanvasDpr.current = dpr;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const chartLeft = 0;
    const chartRight = W - CFG.PRICE_AXIS_W;
    const chartTop = CFG.PAD_TOP;
    const chartBottom = H - CFG.TIME_AXIS_H;
    const chartW = chartRight - chartLeft;
    const chartH = chartBottom - chartTop;

    const cw = candleWRef.current;
    const cg = candleGapRef.current;
    const candleStep = cw + cg;

    // How many candles fit across the full chart width
    const visibleCount = Math.max(1, Math.floor(chartW / candleStep));

    // ── CENTER the view: 0 scroll = most recent candle centred in view ──
    // The "anchor" candle index (in the candles array) drawn at centre
    const halfVisible = Math.floor(visibleCount / 2);
    // scrollRef = 0 → latest candle is centred; positive → scroll left (older)
    const maxScroll = Math.max(0, candles.length - halfVisible - 1);
    scrollRef.current = Math.max(0, Math.min(scrollRef.current, maxScroll));

    // Index of the candle drawn at the horizontal centre of the chart
    const centreIdx = candles.length - 1 - scrollRef.current;

    // Visible index range
    const startIdx = Math.max(0, centreIdx - halfVisible);
    const endIdx = Math.min(candles.length, centreIdx + halfVisible + 1);

    // X position: centreIdx maps to chartW / 2, shifted by sub-candle pixel offset
    const centreX = chartLeft + chartW / 2 - pixelPanRef.current;
    const idxToX = (arrayIdx: number) => centreX + (arrayIdx - centreIdx) * candleStep;

    // Patch last candle with live spot (no mutation)
    const rawSlice = candles.slice(startIdx, endIdx);
    const visible: Candle[] = rawSlice.map((c, si) => {
      const arrayIdx = startIdx + si;
      if (arrayIdx === candles.length - 1 && effectiveSpot > 0) {
        return { ...c, c: effectiveSpot, h: Math.max(c.h, effectiveSpot), l: Math.min(c.l, effectiveSpot) };
      }
      return c;
    });
    if (visible.length === 0) return;

    // ── Price range — driven by CANDLES ONLY so Y-axis stays stable ──
    // Key levels outside the visible range are simply clipped (not drawn).
    // Including distant PDH/PDL in the range made candles tiny + caused jitter.
    let priceMin = Infinity, priceMax = -Infinity;
    for (const c of visible) {
      if (c.h > priceMax) priceMax = c.h;
      if (c.l < priceMin) priceMin = c.l;
    }
    // Include current spot so the live price line is always visible
    if (effectiveSpot > 0) {
      if (effectiveSpot > priceMax) priceMax = effectiveSpot;
      if (effectiveSpot < priceMin) priceMin = effectiveSpot;
    }
    const basePad = (priceMax - priceMin) * 0.08;
    const mid = (priceMax + priceMin) / 2;
    const halfRange = ((priceMax - priceMin) / 2 + basePad) / vScaleRef.current;
    const targetMin = mid - halfRange;
    const targetMax = mid + halfRange;

    // Lerp smoothed range toward target — eliminates axis jump when new candle arrives
    // First frame: snap immediately; subsequent frames: ease at ~12% per frame
    const isFirstFrame = smoothMinRef.current === 0 && smoothMaxRef.current === 0;
    const ease = isFirstFrame ? 1 : 0.12;
    smoothMinRef.current = smoothMinRef.current + (targetMin - smoothMinRef.current) * ease;
    smoothMaxRef.current = smoothMaxRef.current + (targetMax - smoothMaxRef.current) * ease;
    priceMin = smoothMinRef.current;
    priceMax = smoothMaxRef.current;
    const priceRange = priceMax - priceMin || 1;

    const priceToY = (p: number) => chartTop + (1 - (p - priceMin) / priceRange) * chartH;

    // ── Proximity alert set ───────────────────────────────────────
    const keyLevels = [
      levels.pdh, levels.pdl, levels.cdh, levels.cdl,
      ...levels.support, ...levels.resistance,
      ...liquidity.map(l => l.level),
      ...ob.filter(o => !o.mitigated).map(o => (o.top + o.bottom) / 2),
    ].filter(lv => lv > 0);

    const proxSet = new Set<number>();
    for (let i = 0; i < visible.length; i++) {
      const c = visible[i];
      for (const lv of keyLevels) {
        if ((c.h >= lv && c.l <= lv) || near(c.h, lv) || near(c.l, lv) || near(c.c, lv)) {
          proxSet.add(i); break;
        }
      }
    }

    // ── Background ─────────────────────────────────────────────────
    ctx.fillStyle = CFG.BG;
    ctx.fillRect(0, 0, W, H);

    // ── Grid ───────────────────────────────────────────────────────
    const gridSteps = 8;
    for (let i = 0; i <= gridSteps; i++) {
      const y = chartTop + (chartH / gridSteps) * i;
      ctx.strokeStyle = i % 2 === 0 ? CFG.GRID_STRONG : CFG.GRID;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(chartLeft, y);
      ctx.lineTo(chartRight, y);
      ctx.stroke();
    }
    ctx.strokeStyle = CFG.GRID;
    for (let i = 0; i < visible.length; i += 15) {
      const x = idxToX(startIdx + i);
      ctx.beginPath();
      ctx.moveTo(x, chartTop);
      ctx.lineTo(x, chartBottom);
      ctx.stroke();
    }

    // ── ORDER BLOCKS ──────────────────────────────────────────────
    for (const o of ob) {
      const relStart = o.startIdx - startIdx;
      if (relStart >= visible.length) continue;
      const absDrawFrom = startIdx + Math.max(0, relStart);
      const x1 = idxToX(absDrawFrom) - candleStep / 2;
      const x2 = chartRight;
      const y1 = priceToY(o.top);
      const y2 = priceToY(o.bottom);
      const h = Math.abs(y2 - y1);

      const isBull = o.type === 'bullish';
      const alpha = o.mitigated ? CFG.OB_MITIGATED_ALPHA : 1;

      // Fill
      ctx.globalAlpha = alpha;
      ctx.fillStyle = isBull ? CFG.OB_BULL_FILL : CFG.OB_BEAR_FILL;
      ctx.fillRect(x1, y1, x2 - x1, h);

      // Left edge bar (thick)
      ctx.fillStyle = isBull ? CFG.OB_BULL_BORDER : CFG.OB_BEAR_BORDER;
      ctx.fillRect(x1, y1, 3, h);

      // Border top/bottom lines
      ctx.strokeStyle = isBull ? CFG.OB_BULL_BORDER : CFG.OB_BEAR_BORDER;
      ctx.lineWidth = 1;
      ctx.setLineDash(o.mitigated ? [4, 4] : []);
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y1);
      ctx.moveTo(x1, y2); ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label
      if (h > 8) {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = isBull ? CFG.OB_BULL_BORDER : CFG.OB_BEAR_BORDER;
        ctx.font = 'bold 8px sans-serif';
        ctx.textAlign = 'left';
        const mid = (y1 + y2) / 2;
        ctx.fillText(
          (isBull ? '▲OB' : '▼OB') + (o.mitigated ? ' ✗' : ` ×${o.strength.toFixed(1)}`),
          x1 + 6, mid + 3
        );
      }
      ctx.globalAlpha = 1;
    }

    // ── FVG ZONES ───────────────────────────────────────────────────
    for (const f of fvg) {
      const relStart = f.startIdx - startIdx;
      if (relStart >= visible.length) continue;
      const absDrawFrom = startIdx + Math.max(0, relStart);
      const x1 = idxToX(absDrawFrom) - candleStep / 2;
      const x2 = chartRight;
      const y1 = priceToY(f.top);
      const y2 = priceToY(f.bottom);
      const h = Math.abs(y2 - y1);
      const isBull = f.type === 'bullish';

      if (f.filled) {
        ctx.fillStyle = CFG.FVG_FILLED_FILL;
        ctx.fillRect(x1, y1, x2 - x1, h);
        continue;
      }

      // Fill
      ctx.fillStyle = isBull ? CFG.FVG_BULL_FILL : CFG.FVG_BEAR_FILL;
      ctx.fillRect(x1, y1, x2 - x1, h);

      // Dashed border
      ctx.strokeStyle = isBull ? CFG.FVG_BULL_BORDER : CFG.FVG_BEAR_BORDER;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(x1, y1, x2 - x1, h);
      ctx.setLineDash([]);

      // Midline (equilibrium)
      const midY = (y1 + y2) / 2;
      const fvgMidColor = isBull ? 'rgba(132,204,22,0.5)' : 'rgba(251,146,60,0.5)';
      ctx.strokeStyle = fvgMidColor;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(x1, midY); ctx.lineTo(x2, midY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label pill — only if tall enough to read
      if (h > 10) {
        const fvgColor = isBull ? CFG.FVG_BULL_BORDER : CFG.FVG_BEAR_BORDER;
        const fvgTag = isBull ? 'FVG ▲' : 'FVG ▼';
        const fvgPrice = `${fmtPrice(f.bottom)}–${fmtPrice(f.top)}`;
        const fvgFull = `${fvgTag}  ${fvgPrice}`;
        ctx.font = 'bold 8px sans-serif';
        const tw = ctx.measureText(fvgFull).width;
        const lw = tw + 8, lh = 14;
        const lx = x1 + 4, ly = midY - lh / 2;
        // Pill bg
        ctx.fillStyle = isBull ? 'rgba(38,166,154,0.18)' : 'rgba(239,83,80,0.18)';
        roundRect(ctx, lx, ly, lw, lh, 3); ctx.fill();
        // Pill border
        ctx.strokeStyle = fvgColor; ctx.lineWidth = 0.8;
        ctx.setLineDash([]); roundRect(ctx, lx, ly, lw, lh, 3); ctx.stroke();
        // Text
        ctx.fillStyle = fvgColor;
        ctx.textAlign = 'left';
        ctx.fillText(fvgFull, lx + 4, ly + 10);
      }
    }

    // ── KEY LEVEL LINES ─────────────────────────────────────────────
    const drawLevel = (
      price: number,
      color: string,
      dash: number[],
      label: string,
      lineW = 1,
    ) => {
      if (price <= 0) return;
      const y = priceToY(price);
      if (y < chartTop || y > chartBottom) return;

      const isNearSpot = near(effectiveSpot, price, 0.004);

      ctx.save();
      if (isNearSpot) { ctx.shadowColor = color; ctx.shadowBlur = 14; }
      ctx.strokeStyle = color;
      ctx.lineWidth = isNearSpot ? lineW + 1.5 : lineW;
      ctx.setLineDash(dash);
      ctx.globalAlpha = isNearSpot ? 1 : 0.82;
      ctx.beginPath();
      ctx.moveTo(chartLeft, y);
      ctx.lineTo(chartRight, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.restore();

      // ── Left inline tag (label only, no price) ──────────────────
      ctx.font = `bold 8.5px sans-serif`;
      const tagW = ctx.measureText(label).width + 8;
      const tagH = 15;
      const tagX = chartLeft + 4;
      const tagY = y - tagH / 2;
      ctx.fillStyle = color;
      ctx.globalAlpha = isNearSpot ? 1 : 0.88;
      roundRect(ctx, tagX, tagY, tagW, tagH, 3); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#07101f';
      ctx.textAlign = 'left';
      ctx.fillText(label, tagX + 4, tagY + 11);

      // ── Right axis pill (label + price) ─────────────────────────
      const priceStr = fmtPrice(price);
      const rightLabel = `${label} ${priceStr}`;
      ctx.font = 'bold 8px sans-serif';
      const rw = ctx.measureText(rightLabel).width + 10;
      const rh = 16;
      const rx = chartRight + 2;
      const ry = y - rh / 2;
      ctx.fillStyle = color;
      ctx.globalAlpha = isNearSpot ? 1 : 0.88;
      roundRect(ctx, rx, ry, rw, rh, 4); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#07101f';
      ctx.textAlign = 'left';
      ctx.fillText(rightLabel, rx + 5, ry + 11);
    };

    // PDH / PDL — previous day (dashed orange)
    drawLevel(levels.pdh, CFG.PDH, [8, 5], 'PDH', 1.5);
    drawLevel(levels.pdl, CFG.PDL, [8, 5], 'PDL', 1.5);

    // CDH / CDL — current day high/low (solid cyan)
    drawLevel(levels.cdh, CFG.CDH, [5, 3], 'CDH', 1.5);
    drawLevel(levels.cdl, CFG.CDL, [5, 3], 'CDL', 1.5);

    // Support / Resistance (dotted, named clearly)
    for (const s of levels.support) drawLevel(s, CFG.SUPPORT, [3, 4], 'SUP', 1.2);
    for (const r of levels.resistance) drawLevel(r, CFG.RESISTANCE, [3, 4], 'RES', 1.2);

    // ── LIQUIDITY LEVELS ────────────────────────────────────────────
    for (const lq of liquidity) {
      const y = priceToY(lq.level);
      if (y < chartTop || y > chartBottom) continue;
      const isSell = lq.type === 'sell_side';
      const color = lq.swept ? CFG.LIQ_SWEPT : (isSell ? CFG.LIQ_SELL : CFG.LIQ_BUY);
      const isNear = near(effectiveSpot, lq.level, 0.005);

      // Draw toothed (jagged) liquidity line
      ctx.strokeStyle = color;
      ctx.lineWidth = isNear ? 2 : 1;
      ctx.save();
      if (isNear && !lq.swept) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
      }
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(chartLeft, y);
      ctx.lineTo(chartRight, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Small diamond markers at line ends
      const diamond = (cx: number, cy: number, size = 4) => {
        ctx.beginPath();
        ctx.moveTo(cx, cy - size);
        ctx.lineTo(cx + size, cy);
        ctx.lineTo(cx, cy + size);
        ctx.lineTo(cx - size, cy);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      };
      if (!lq.swept) {
        diamond(chartLeft + 6, y);
        diamond(chartRight - 6, y);
      }

      // Label pill for liquidity
      const liqTag = lq.swept
        ? `${isSell ? 'SSL ✗' : 'BSL ✗'}`
        : `${isSell ? 'SSL' : 'BSL'} ×${lq.touchCount}`;
      const liqFull = `${liqTag}  ${fmtPrice(lq.level)}`;
      ctx.font = 'bold 8px sans-serif';
      const llw = ctx.measureText(liqFull).width + 10;
      const llh = 15;
      const llx = chartRight + 2, lly = y - llh / 2;
      ctx.fillStyle = color;
      ctx.globalAlpha = lq.swept ? 0.45 : 0.9;
      roundRect(ctx, llx, lly, llw, llh, 3); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#07101f';
      ctx.textAlign = 'left';
      ctx.fillText(liqFull, llx + 5, lly + 11);
    }

    // ── CURRENT PRICE LINE ──────────────────────────────────────────
    if (effectiveSpot > 0) {
      const y = priceToY(effectiveSpot);
      if (y >= chartTop && y <= chartBottom) {
        ctx.save();
        ctx.shadowColor = CFG.CURRENT_PRICE;
        ctx.shadowBlur = 8;
        ctx.strokeStyle = CFG.CURRENT_PRICE;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(chartLeft, y);
        ctx.lineTo(chartRight, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        // Badge
        ctx.fillStyle = CFG.CURRENT_PRICE;
        roundRect(ctx, chartRight, y - 9, CFG.PRICE_AXIS_W - 2, 18, 4);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(fmtPrice(effectiveSpot), chartRight + (CFG.PRICE_AXIS_W - 2) / 2, y + 3);
      }
    }

    // ── CANDLES ─────────────────────────────────────────────────────
    for (let i = 0; i < visible.length; i++) {
      const c = visible[i];
      const x = idxToX(startIdx + i);
      // Skip candles outside the draw area (off screen)
      if (x + cw / 2 < chartLeft || x - cw / 2 > chartRight) continue;
      const isBull = c.c >= c.o;
      const bodyTop = priceToY(Math.max(c.o, c.c));
      const bodyBot = priceToY(Math.min(c.o, c.c));
      const bodyH = Math.max(1.5, bodyBot - bodyTop);
      const wickTop = priceToY(c.h);
      const wickBot = priceToY(c.l);
      const isProx = proxSet.has(i);
      const halfW = cw / 2;

      // Proximity glow halo
      if (isProx) {
        ctx.save();
        ctx.shadowColor = isBull ? CFG.BULL : CFG.BEAR;
        ctx.shadowBlur = 10;
      }

      // Wick
      ctx.strokeStyle = isBull ? CFG.BULL_WICK : CFG.BEAR_WICK;
      ctx.lineWidth = isProx ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(x, wickTop);
      ctx.lineTo(x, wickBot);
      ctx.stroke();

      // Body
      ctx.fillStyle = isBull ? CFG.BULL_BODY : CFG.BEAR_BODY;
      ctx.fillRect(x - halfW, bodyTop, cw, bodyH);

      if (isProx) {
        // Bright border on proximity candle
        ctx.strokeStyle = isBull ? '#4db6ac' : '#e57373';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - halfW, bodyTop, cw, bodyH);
        ctx.restore();
      }

      // Rejection / pin-bar highlight: wick ≥ 2× body
      const bodySize = Math.abs(c.c - c.o);
      const upperWick = c.h - Math.max(c.o, c.c);
      const lowerWick = Math.min(c.o, c.c) - c.l;
      if (bodySize > 0 && (upperWick >= bodySize * 2 || lowerWick >= bodySize * 2)) {
        ctx.save();
        ctx.shadowColor = isBull ? CFG.BULL : CFG.BEAR;
        ctx.shadowBlur = 14;
        ctx.strokeStyle = isBull ? '#86efac' : '#fca5a5';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, wickTop);
        ctx.lineTo(x, wickBot);
        ctx.stroke();
        ctx.restore();
      }
    }

    // ── PRICE AXIS ──────────────────────────────────────────────────
    ctx.fillStyle = 'rgba(8,14,26,0.92)';
    ctx.fillRect(chartRight, 0, CFG.PRICE_AXIS_W, H);
    ctx.strokeStyle = CFG.AXIS_LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(chartRight, chartTop);
    ctx.lineTo(chartRight, chartBottom);
    ctx.stroke();

    ctx.fillStyle = CFG.AXIS_TEXT;
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    for (let i = 0; i <= gridSteps; i++) {
      const y = chartTop + (chartH / gridSteps) * i;
      const price = priceMax - (priceMax - priceMin) * (i / gridSteps);
      ctx.fillText(fmtPrice(price), W - 4, y + 3);
    }

    // ── TIME AXIS ───────────────────────────────────────────────────
    ctx.fillStyle = 'rgba(8,14,26,0.92)';
    ctx.fillRect(0, chartBottom, chartRight, CFG.TIME_AXIS_H);
    ctx.strokeStyle = CFG.AXIS_LINE;
    ctx.beginPath();
    ctx.moveTo(chartLeft, chartBottom);
    ctx.lineTo(chartRight, chartBottom);
    ctx.stroke();

    ctx.fillStyle = CFG.AXIS_TEXT;
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    const timeStep = Math.max(1, Math.floor(visible.length / 8));
    for (let i = 0; i < visible.length; i += timeStep) {
      const tx = idxToX(startIdx + i);
      if (tx < chartLeft + 20 || tx > chartRight - 20) continue;
      ctx.fillText(fmtTime(visible[i].t), tx, chartBottom + 14);
    }

    // ── CROSSHAIR ───────────────────────────────────────────────────
    const mx = mouseRef.current.x;
    const my = mouseRef.current.y;
    if (mx >= chartLeft && mx <= chartRight && my >= chartTop && my <= chartBottom) {
      ctx.strokeStyle = CFG.CROSSHAIR;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(chartLeft, my); ctx.lineTo(chartRight, my); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mx, chartTop); ctx.lineTo(mx, chartBottom); ctx.stroke();
      ctx.setLineDash([]);

      // Price cursor label
      const crossPrice = priceMax - (my - chartTop) / chartH * priceRange;
      ctx.fillStyle = CFG.CROSSHAIR_LABEL_BG;
      ctx.fillRect(chartRight, my - 9, CFG.PRICE_AXIS_W, 18);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(fmtPrice(crossPrice), chartRight + CFG.PRICE_AXIS_W / 2, my + 3);

      // Time cursor label — find nearest candle by x position
      const cIdx = Math.round((mx - centreX) / candleStep + centreIdx - startIdx);
      if (cIdx >= 0 && cIdx < visible.length) {
        const tLabel = fmtTime(visible[cIdx].t);
        const tw = ctx.measureText(tLabel).width + 8;
        ctx.fillStyle = CFG.CROSSHAIR_LABEL_BG;
        ctx.fillRect(mx - tw / 2, chartBottom, tw, CFG.TIME_AXIS_H);
        ctx.fillStyle = '#e2e8f0';
        ctx.textAlign = 'center';
        ctx.fillText(tLabel, mx, chartBottom + 14);

        // OHLCV tooltip
        const c = visible[cIdx];
        const info = `O:${fmtPrice(c.o)}  H:${fmtPrice(c.h)}  L:${fmtPrice(c.l)}  C:${fmtPrice(c.c)}  V:${fmtNum(c.v)}`;
        ctx.font = '9px monospace';
        const iw = ctx.measureText(info).width + 12;
        ctx.fillStyle = CFG.CROSSHAIR_LABEL_BG;
        ctx.fillRect(4, chartTop + 2, iw, 16);
        ctx.fillStyle = '#e2e8f0';
        ctx.textAlign = 'left';
        ctx.fillText(info, 10, chartTop + 13);

        // Near-level tooltip: show what level this candle is near
        const nearLabels: string[] = [];
        if (near(c.h, levels.pdh) || near(c.l, levels.pdh)) nearLabels.push('PDH');
        if (near(c.h, levels.pdl) || near(c.l, levels.pdl)) nearLabels.push('PDL');
        if (near(c.h, levels.cdh) || near(c.l, levels.cdh)) nearLabels.push('CDH');
        if (near(c.h, levels.cdl) || near(c.l, levels.cdl)) nearLabels.push('CDL');
        for (const s of levels.support) if (near(c.h, s) || near(c.l, s) || near(c.c, s)) { nearLabels.push('SUPPORT'); break; }
        for (const r of levels.resistance) if (near(c.h, r) || near(c.l, r) || near(c.c, r)) { nearLabels.push('RESIST'); break; }
        for (const lq of liquidity) if (near(c.h, lq.level) || near(c.l, lq.level)) { nearLabels.push(lq.type === 'sell_side' ? 'SSL' : 'BSL'); break; }
        for (const o of ob) if (!o.mitigated && c.h >= o.bottom && c.l <= o.top) { nearLabels.push(o.type === 'bullish' ? 'Bull OB' : 'Bear OB'); break; }

        if (nearLabels.length > 0) {
          const nlText = `⚡ ${nearLabels.join(' · ')}`;
          ctx.font = 'bold 9px sans-serif';
          const nw = ctx.measureText(nlText).width + 12;
          ctx.fillStyle = 'rgba(251,191,36,0.15)';
          ctx.fillRect(4, chartTop + 20, nw, 16);
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 1;
          ctx.strokeRect(4, chartTop + 20, nw, 16);
          ctx.fillStyle = '#fbbf24';
          ctx.textAlign = 'left';
          ctx.fillText(nlText, 10, chartTop + 31);
        }
      }
    }
  }, [candles, fvg, ob, liquidity, levels, spot]);

  // Reset smooth range when symbol/data changes so axis snaps immediately
  useEffect(() => {
    smoothMinRef.current = 0;
    smoothMaxRef.current = 0;
    lastCanvasW.current = 0; // force canvas resize on next frame
  }, [candles, chartHeight]);

  // ── Continuous RAF loop — runs at display refresh rate (60fps) ──────
  useEffect(() => {
    let rafId: number;
    const loop = () => { render(); rafId = requestAnimationFrame(loop); };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [render]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Reset cached size so render() re-measures on next RAF tick
    const ro = new ResizeObserver(() => { lastCanvasW.current = 0; });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // ── Interaction handlers ──────────────────────────────────────────

  // ── Interaction: mouse (React handlers are fine for mouse) ──────────

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    if (isDragging.current) {
      const dx = e.clientX - dragStartX.current;
      const candleStep = candleWRef.current + candleGapRef.current;
      // Pixel-level pan: track exact pixel offset, derive scroll in candles
      const totalStartPx = dragStartScroll.current * candleStep + dragStartPixelPan.current;
      const newTotalPx = Math.max(0, totalStartPx - dx);
      scrollRef.current = Math.floor(newTotalPx / candleStep);
      pixelPanRef.current = newTotalPx % candleStep;
    }
    if (isVDragging.current) {
      const dy = vDragStartY.current - e.clientY;
      vScaleRef.current = Math.max(0.25, Math.min(8, vDragStartScale.current * Math.exp(dy / 200)));
    }
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      isDragging.current = true;
      dragStartX.current = e.clientX;
      dragStartScroll.current = scrollRef.current;
      dragStartPixelPan.current = pixelPanRef.current;
    } else if (e.button === 2) {
      isVDragging.current = true;
      vDragStartY.current = e.clientY;
      vDragStartScale.current = vScaleRef.current;
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
    isVDragging.current = false;
  }, []);

  const handleMouseLeave = useCallback(() => {
    mouseRef.current = { x: -1, y: -1 };
    isDragging.current = false;
    isVDragging.current = false;
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  const handleDblClick = useCallback(() => {
    candleWRef.current = CFG.CANDLE_W;
    candleGapRef.current = CFG.CANDLE_GAP;
    vScaleRef.current = 1;
    scrollRef.current = 0;
    pixelPanRef.current = 0;
  }, []);

  // ── Native listeners: wheel + touch (must be passive:false to preventDefault) ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const candleStep = candleWRef.current + candleGapRef.current;
      if (e.ctrlKey || e.metaKey) {
        // Ctrl/Cmd + scroll → zoom candle width
        const factor = e.deltaY > 0 ? 0.88 : 1.14;
        candleWRef.current = Math.max(2, Math.min(40, candleWRef.current * factor));
        candleGapRef.current = Math.max(1, Math.round(candleWRef.current * 0.43));
        pixelPanRef.current = 0; // reset sub-pixel on zoom
      } else if (e.shiftKey) {
        // Shift + scroll → vertical zoom
        const factor = e.deltaY > 0 ? 0.88 : 1.14;
        vScaleRef.current = Math.max(0.25, Math.min(8, vScaleRef.current * factor));
      } else {
        // Plain scroll → horizontal pan
        const px = e.deltaY * 1.2; // scale deltaY to pixel amount
        const totalPx = Math.max(0, scrollRef.current * candleStep + pixelPanRef.current + px);
        scrollRef.current = Math.floor(totalPx / candleStep);
        pixelPanRef.current = totalPx % candleStep;
      }
    };

    // Touch state
    let t1x = 0, t1y = 0, tScroll = 0, tPixelPan = 0;
    let tVScale = 1, tDist = 0, tCW = CFG.CANDLE_W;
    let touchDir: 'h' | 'v' | null = null; // lock axis after first few px

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        t1x = e.touches[0].clientX;
        t1y = e.touches[0].clientY;
        tScroll = scrollRef.current;
        tPixelPan = pixelPanRef.current;
        tVScale = vScaleRef.current;
        touchDir = null;
      } else if (e.touches.length === 2) {
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        tDist = Math.sqrt(dx * dx + dy * dy);
        tCW = candleWRef.current;
        touchDir = null;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault(); // blocks page scroll — needs passive:false
      if (e.touches.length === 1) {
        const dx = e.touches[0].clientX - t1x;
        const dy = e.touches[0].clientY - t1y;
        // Determine dominant axis after 8px threshold
        if (!touchDir && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
          touchDir = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
        }
        if (touchDir === 'h') {
          const candleStep = candleWRef.current + candleGapRef.current;
          const totalPx = Math.max(0, tScroll * candleStep + tPixelPan - dx);
          scrollRef.current = Math.floor(totalPx / candleStep);
          pixelPanRef.current = totalPx % candleStep;
        } else if (touchDir === 'v') {
          vScaleRef.current = Math.max(0.25, Math.min(8, tVScale * Math.exp(dy / -180)));
        }
      } else if (e.touches.length === 2) {
        // Pinch = horizontal zoom (candle width)
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const ratio = tDist > 0 ? dist / tDist : 1;
        candleWRef.current = Math.max(2, Math.min(40, tCW * ratio));
        candleGapRef.current = Math.max(1, Math.round(candleWRef.current * 0.43));
        pixelPanRef.current = 0;
      }
    };

    const onTouchEnd = () => { touchDir = null; };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
    };
  }, []);  // empty deps — only runs once; reads refs directly

  return (
    <div
      ref={containerRef}
      className="w-full select-none cursor-crosshair relative"
      style={{ height: chartHeight ?? CFG.CHART_H }}
    >
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onContextMenu={handleContextMenu}
        onDoubleClick={handleDblClick}
        className="w-full h-full block"
        style={{ touchAction: 'none' }}
      />

      {/* ── Zoom / pan toolbar — bottom-right corner ── */}
      <div className="absolute bottom-7 right-20 flex items-center gap-1 pointer-events-none">
        {/* Zoom out */}
        <button
          className="pointer-events-auto w-6 h-6 rounded bg-slate-800/80 border border-slate-600/50 text-slate-300 text-xs flex items-center justify-center hover:bg-slate-700/90 active:scale-95 transition-all"
          title="Zoom out (candles)"
          onMouseDown={e => { e.stopPropagation(); candleWRef.current = Math.max(2, candleWRef.current * 0.8); candleGapRef.current = Math.max(1, Math.round(candleWRef.current * 0.43)); pixelPanRef.current = 0; }}
        >−</button>
        {/* Zoom in */}
        <button
          className="pointer-events-auto w-6 h-6 rounded bg-slate-800/80 border border-slate-600/50 text-slate-300 text-xs flex items-center justify-center hover:bg-slate-700/90 active:scale-95 transition-all"
          title="Zoom in (candles)"
          onMouseDown={e => { e.stopPropagation(); candleWRef.current = Math.min(40, candleWRef.current * 1.25); candleGapRef.current = Math.max(1, Math.round(candleWRef.current * 0.43)); pixelPanRef.current = 0; }}
        >+</button>
        {/* Scroll left (older) */}
        <button
          className="pointer-events-auto w-6 h-6 rounded bg-slate-800/80 border border-slate-600/50 text-slate-300 text-xs flex items-center justify-center hover:bg-slate-700/90 active:scale-95 transition-all"
          title="Scroll to older candles"
          onMouseDown={e => { e.stopPropagation(); scrollRef.current = Math.min(scrollRef.current + 10, 9999); }}
        >‹</button>
        {/* Scroll right (newer) */}
        <button
          className="pointer-events-auto w-6 h-6 rounded bg-slate-800/80 border border-slate-600/50 text-slate-300 text-xs flex items-center justify-center hover:bg-slate-700/90 active:scale-95 transition-all"
          title="Scroll to latest"
          onMouseDown={e => { e.stopPropagation(); scrollRef.current = Math.max(0, scrollRef.current - 10); pixelPanRef.current = 0; }}
        >›</button>
        {/* Reset */}
        <button
          className="pointer-events-auto w-6 h-6 rounded bg-slate-800/80 border border-slate-600/50 text-slate-400 text-[9px] flex items-center justify-center hover:bg-slate-700/90 active:scale-95 transition-all"
          title="Reset zoom & scroll"
          onMouseDown={e => { e.stopPropagation(); candleWRef.current = CFG.CANDLE_W; candleGapRef.current = CFG.CANDLE_GAP; vScaleRef.current = 1; scrollRef.current = 0; pixelPanRef.current = 0; }}
        >⟳</button>
      </div>

      {/* ── Hint strip — bottom left ── */}
      <div className="absolute bottom-7 left-1 text-[8px] text-slate-600 pointer-events-none select-none">
        drag·scroll·pinch · dbl-click reset
      </div>
    </div>
  );
});
CandleChart.displayName = 'CandleChart';

// ── Rounded rect helper (canvas) ────────────────────────────────────────────
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Chart Pattern Signal Engine ─────────────────────────────────────────────

type ChartSignal = 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';

const CHART_SIGNAL_CFG: Record<ChartSignal, { label: string; color: string; bg: string; border: string; glow: string }> = {
  STRONG_BUY:  { label: 'STRONG BUY',  color: 'text-emerald-300', bg: 'bg-emerald-500/20', border: 'border-emerald-400/60', glow: 'shadow-emerald-500/30' },
  BUY:         { label: 'BUY',          color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-400/30', glow: '' },
  NEUTRAL:     { label: 'NEUTRAL',      color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-400/30',   glow: '' },
  SELL:        { label: 'SELL',         color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-400/30',     glow: '' },
  STRONG_SELL: { label: 'STRONG SELL', color: 'text-red-300',     bg: 'bg-red-500/20',     border: 'border-red-400/60',     glow: 'shadow-red-500/30' },
};

/**
 * Chart Pattern Signal Engine — 6 independent pillars, total ±115 pts
 *
 * 1. Swing structure   ±30  — HH/HL (bull trend) vs LH/LL (bear trend) last 20 candles
 * 2. Key levels        ±25  — PDH/PDL breakout|breakdown, CDH/CDL, S&R cross
 * 3. FVG zones         ±20  — price inside/below/above bullish or bearish FVG
 * 4. Order blocks      ±15  — active OB above/below price = resistance/support
 * 5. Liquidity         ±15  — swept SSL/BSL direction + unswept proximity targets
 * 6. Candle momentum   ±10  — last 6 candles, body-weighted, recent candles 2×
 *
 * Thresholds: ≥32 STRONG_BUY | ≥12 BUY | ≤−12 SELL | ≤−32 STRONG_SELL
 */
function computeChartSignal(
  candles: Candle[],
  fvg: FVG[],
  ob: OrderBlock[],
  liquidity: Liquidity[],
  levels: ChartLevels,
  spot: number,
): { signal: ChartSignal; score: number } {
  if (candles.length < 5 || spot <= 0) return { signal: 'NEUTRAL', score: 0 };

  let score = 0;

  // ── 1. SWING STRUCTURE (±30) ─────────────────────────────────────────────
  // Track actual sequence of swing highs/lows to detect HH/HL vs LH/LL trend
  const sc = candles.slice(-20);
  let lastSH = -Infinity, lastSL = Infinity;
  let hh = 0, hl = 0, lh = 0, ll = 0;
  for (let i = 1; i < sc.length - 1; i++) {
    const p = sc[i - 1], c = sc[i], n = sc[i + 1];
    if (c.h > p.h && c.h > n.h) {           // swing high found
      if (lastSH > -Infinity) { if (c.h > lastSH) hh++; else lh++; }
      lastSH = c.h;
    }
    if (c.l < p.l && c.l < n.l) {           // swing low found
      if (lastSL < Infinity)  { if (c.l > lastSL) hl++; else ll++; }
      lastSL = c.l;
    }
  }
  let swingScore = (hh * 4 + hl * 3) - (lh * 3 + ll * 4);
  // Fallback when too few swings detected: compare first-half vs second-half average close
  if (hh + hl + lh + ll < 2 && sc.length >= 10) {
    const mid = Math.floor(sc.length / 2);
    const firstAvg = sc.slice(0, mid).reduce((s, c) => s + c.c, 0) / mid;
    const lastAvg  = sc.slice(mid).reduce((s, c) => s + c.c, 0) / (sc.length - mid);
    const trendPct = (lastAvg - firstAvg) / firstAvg;
    swingScore += trendPct > 0.002 ? 8 : trendPct < -0.002 ? -8 : trendPct * 3000;
  }
  score += Math.min(30, Math.max(-30, swingScore));

  // ── 2. KEY LEVELS POSITION (±25) ─────────────────────────────────────────
  let lvl = 0;
  const { pdh = 0, pdl = 0, cdh = 0, cdl = 0, support = [], resistance = [] } = levels;

  // Always have a price-position reference: use PDH/PDL if set, else recent 20-candle range
  const window20 = candles.slice(-20);
  const recentHigh = Math.max(...window20.map(c => c.h));
  const recentLow  = Math.min(...window20.map(c => c.l));
  const hiRef = pdh > 0 ? pdh : recentHigh;
  const loRef = pdl > 0 ? pdl : recentLow;

  if (spot > hiRef * 1.001)      lvl += 14;   // confirmed breakout above reference high
  else if (spot > hiRef)         lvl += 7;    // above reference high
  else if (spot < loRef * 0.999) lvl -= 14;   // confirmed breakdown below reference low
  else if (spot < loRef)         lvl -= 7;    // below reference low
  else {
    const range = hiRef - loRef;
    if (range > 0) lvl += ((spot - loRef) / range - 0.5) * 16; // position within range ±8
  }

  // CDH / CDL — current day session extremes
  // spot AT/ABOVE CDH = making new intraday highs = BULLISH
  // spot AT/BELOW CDL = making new intraday lows  = BEARISH
  if (cdh > 0 && cdl > 0) {
    const dayRange = cdh - cdl;
    if (spot >= cdh * 0.9998)      lvl += 9;   // at/above CDH = new intraday high = bullish
    else if (spot <= cdl * 1.0002) lvl -= 9;   // at/below CDL = new intraday low  = bearish
    else if (dayRange > 0) {
      lvl += ((spot - cdl) / dayRange - 0.5) * 8; // position within today's range ±4
    }
  } else if (cdh > 0) {
    if (spot >= cdh * 0.9998) lvl += 9;
  } else if (cdl > 0) {
    if (spot <= cdl * 1.0002) lvl -= 9;
  }

  // S&R — nearest levels only
  const nearRes = resistance.length > 0 ? resistance[resistance.length - 1] : 0;
  const nearSup = support.length > 0 ? support[0] : 0;
  if (nearRes > 0) {
    if (spot > nearRes * 1.001)      lvl += 5;
    else if (spot > nearRes * 0.997) lvl -= 3;
  }
  if (nearSup > 0) {
    if (spot < nearSup * 0.999)      lvl -= 5;
    else if (spot < nearSup * 1.003) lvl += 3;
  }
  score += Math.min(25, Math.max(-25, lvl));

  // ── 3. FVG ZONES (±20) ───────────────────────────────────────────────────
  // Where FVG is relative to spot tells direction of imbalance
  let fvgRaw = 0;
  for (const f of fvg) {
    if (f.filled) continue;
    const mid = (f.top + f.bottom) / 2;
    const distPct = Math.abs(mid - spot) / spot;
    const prox = distPct < 0.003 ? 3 : distPct < 0.008 ? 2 : 1;
    const str = f.strength ?? 1;

    if (f.type === 'bullish') {
      if (spot >= f.bottom && spot <= f.top) fvgRaw += 8 * str;   // price INSIDE bullish FVG
      else if (mid < spot)                   fvgRaw += 3 * prox * str; // FVG below = support
      else                                   fvgRaw += 1.5 * prox * str; // FVG above = target
    } else {
      if (spot >= f.bottom && spot <= f.top) fvgRaw -= 8 * str;   // price INSIDE bearish FVG
      else if (mid > spot)                   fvgRaw -= 3 * prox * str; // FVG above = resistance
      else                                   fvgRaw -= 2 * prox * str; // FVG below = broke thru = bearish
    }
  }
  score += Math.min(20, Math.max(-20, fvgRaw));

  // ── 4. ORDER BLOCK ANALYSIS (±15) ────────────────────────────────────────
  let obRaw = 0;
  for (const o of ob) {
    if (o.mitigated) continue;
    const mid = (o.high + o.low) / 2;
    const distPct = Math.abs(mid - spot) / spot;
    if (distPct > 0.025) continue;             // only OBs within 2.5% matter
    const prox = distPct < 0.003 ? 3 : distPct < 0.01 ? 2 : 1;
    const str = o.strength ?? 1;

    if (o.type === 'bullish') {
      obRaw += mid < spot ? 4 * prox * str : -2 * prox * str; // below=demand, above=broke below=bearish
    } else {
      obRaw -= mid > spot ? 4 * prox * str : 2 * prox * str;  // above=supply, below=broke thru=bearish
    }
  }
  score += Math.min(15, Math.max(-15, obRaw));

  // ── 5. LIQUIDITY ANALYSIS (±15) ──────────────────────────────────────────
  // Swept SSL (sell-side stops triggered below) = smart money bought = bullish
  // Swept BSL (buy-side stops triggered above) = smart money sold = bearish
  // Unswept BSL above price = upside target (magnets) = mild bullish
  // Unswept SSL below price = downside target = mild bearish
  let liqRaw = 0;
  for (const l of liquidity) {
    if (l.swept) {
      const recency = l.sweepIdx !== null && (candles.length - l.sweepIdx) < 6 ? 2 : 1;
      liqRaw += l.type === 'sell_side' ? 5 * recency : -5 * recency;
    } else {
      const distPct = Math.abs(l.level - spot) / spot;
      if (distPct > 0.03) continue;
      const prox = distPct < 0.005 ? 2 : 1;
      if (l.type === 'buy_side' && l.level > spot)  liqRaw += 2 * prox; // BSL above = upside magnet
      if (l.type === 'sell_side' && l.level < spot) liqRaw -= 2 * prox; // SSL below = downside magnet
      if (l.touchCount > 2) liqRaw += l.type === 'buy_side' ? 1 : -1;   // many touches = strong pool
    }
  }
  score += Math.min(15, Math.max(-15, liqRaw));

  // ── 6. CANDLE MOMENTUM (±10) ─────────────────────────────────────────────
  // Body ratio: big-body candles count more than doji/spinning tops
  let momRaw = 0;
  const recent = candles.slice(-6);
  for (let i = 0; i < recent.length; i++) {
    const c = recent[i];
    const weight = i >= recent.length - 2 ? 2 : 1;  // last 2 candles double weight
    const body = Math.abs(c.c - c.o);
    const range = (c.h - c.l) || 1;
    const bodyRatio = body / range;                   // 0=doji, 1=full marubozu
    const dir = c.c > c.o ? 1 : c.c < c.o ? -1 : 0;
    momRaw += dir * weight * (0.5 + bodyRatio * 0.5);
  }
  score += Math.min(10, Math.max(-10, momRaw * 1.5));

  // ── Map to signal ─────────────────────────────────────────────────────────
  const s = Math.round(score);
  let signal: ChartSignal;
  if (s >= 32)       signal = 'STRONG_BUY';
  else if (s >= 12)  signal = 'BUY';
  else if (s <= -32) signal = 'STRONG_SELL';
  else if (s <= -12) signal = 'SELL';
  else               signal = 'NEUTRAL';

  return { signal, score: s };
}

// ── Symbol Chart Card ───────────────────────────────────────────────────────

const SymbolChartCard = memo<{ data: SymbolChartData | null; name: string; liveSpot?: number }>(({ data, name, liveSpot }) => {
  const [timeframe, setTimeframe] = useState<'3m' | '5m'>('3m');
  const [expanded, setExpanded] = useState(false);
  const chartH = expanded ? 560 : CFG.CHART_H;

  // Flash animation when signal changes
  const [signalFlash, setSignalFlash] = useState(false);
  const prevSignalRef = useRef<string>('');

  const candles = useMemo(() => {
    if (!data) return [];
    return timeframe === '3m' ? (data.candles3m ?? []) : (data.candles5m ?? []);
  }, [data, timeframe]);

  const fvgList = useMemo(() => {
    if (!data) return [];
    return timeframe === '3m' ? (data.fvg3m ?? []) : (data.fvg5m ?? []);
  }, [data, timeframe]);

  const obList = useMemo(() => {
    if (!data) return [];
    return timeframe === '3m' ? (data.ob3m ?? []) : (data.ob5m ?? []);
  }, [data, timeframe]);

  const liqList = useMemo(() => {
    if (!data) return [];
    return timeframe === '3m' ? (data.liquidity3m ?? []) : (data.liquidity5m ?? []);
  }, [data, timeframe]);

  const levels = useMemo<ChartLevels>(() => {
    if (!data?.levels) return { pdh: 0, pdl: 0, cdh: 0, cdl: 0, support: [], resistance: [] };
    return data.levels;
  }, [data]);

  const stats = useMemo(() => {
    const activeFvg = fvgList.filter(f => !f.filled);
    const activeOb = obList.filter(o => !o.mitigated);
    const activeLiq = liqList.filter(l => !l.swept);
    return {
      fvgBull: activeFvg.filter(f => f.type === 'bullish').length,
      fvgBear: activeFvg.filter(f => f.type === 'bearish').length,
      obBull: activeOb.filter(o => o.type === 'bullish').length,
      obBear: activeOb.filter(o => o.type === 'bearish').length,
      ssl: activeLiq.filter(l => l.type === 'sell_side').length,
      bsl: activeLiq.filter(l => l.type === 'buy_side').length,
    };
  }, [fvgList, obList, liqList]);

  // Chart pattern signal — recomputes on every liveSpot tick (every ~1s)
  const chartSignal = useMemo(() => {
    const effectiveSpot = (liveSpot && liveSpot > 0) ? liveSpot : data?.spot ?? 0;
    return computeChartSignal(candles, fvgList, obList, liqList, levels, effectiveSpot);
  }, [candles, fvgList, obList, liqList, levels, liveSpot, data?.spot]);

  // Trigger flash animation whenever signal category changes
  useEffect(() => {
    if (prevSignalRef.current && prevSignalRef.current !== chartSignal.signal) {
      setSignalFlash(true);
      const t = setTimeout(() => setSignalFlash(false), 600);
      return () => clearTimeout(t);
    }
    prevSignalRef.current = chartSignal.signal;
  }, [chartSignal.signal]);

  if (!data || candles.length === 0) {
    return (
      <div className="rounded-xl bg-dark-card/60 border border-slate-700/40 p-3 sm:p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs sm:text-sm font-bold text-slate-400">{name}</span>
        </div>
        <div className="text-center py-16 text-slate-600 text-xs">Loading chart data...</div>
      </div>
    );
  }

  const sourceColor = data.dataSource === 'LIVE' ? 'text-emerald-400' : data.dataSource === 'CACHED' ? 'text-amber-400' : 'text-slate-500';
  const sourceLabel = data.dataSource === 'LIVE' ? '● LIVE' : data.dataSource === 'CACHED' ? '◐ CACHED' : '○ CLOSED';

  const lastCandle = candles[candles.length - 1];
  const prevClose = candles.length >= 2 ? candles[candles.length - 2].c : lastCandle.o;
  // Use liveSpot for display price if available — same price shown on chart
  const displayPrice = (liveSpot && liveSpot > 0) ? liveSpot : lastCandle.c;
  const change = displayPrice - prevClose;
  const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;
  const changeColor = change >= 0 ? 'text-emerald-400' : 'text-red-400';
  const changeIcon = change >= 0 ? '▲' : '▼';

  return (
    <div className="rounded-xl bg-dark-card/60 border border-slate-700/40 overflow-hidden">
      {/* Header — 2-row on mobile, single row on sm+ */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-3 sm:px-4 py-2 gap-1.5 border-b border-slate-700/30">
        {/* Row 1: name + price + change */}
        <div className="flex items-center min-w-0">
          <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-2 py-1 rounded-md bg-emerald-500/5 border border-emerald-500/30 shadow-[0_0_6px_rgba(52,211,153,0.15)] w-full sm:w-auto">
            <span className="text-[11px] sm:text-xs font-bold text-emerald-200 shrink-0">{name}</span>
            <span className="text-[12px] sm:text-[13px] font-mono font-semibold text-emerald-300 shrink-0">{fmtPrice(displayPrice)}</span>
            <span className={`text-[10px] sm:text-[11px] font-mono font-semibold shrink-0 ${changeColor}`}>
              {changeIcon}{Math.abs(change).toFixed(2)} ({changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%)
            </span>
          </span>
        </div>
        {/* Row 2 on mobile / right side on desktop: controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Chart Pattern Signal Badge */}
          {(() => {
            const cfg = CHART_SIGNAL_CFG[chartSignal.signal];
            const pulse = chartSignal.signal === 'STRONG_BUY' || chartSignal.signal === 'STRONG_SELL';
            return (
              <span
                key={chartSignal.signal}
                title={`Chart pattern score: ${chartSignal.score > 0 ? '+' : ''}${chartSignal.score} · Updates every ~1s with live spot`}
                className={`
                  inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wide
                  border shadow-sm transition-all duration-300
                  ${cfg.bg} ${cfg.color} ${cfg.border} ${cfg.glow ? `shadow-sm ${cfg.glow}` : ''}
                  ${pulse ? 'animate-pulse' : ''}
                  ${signalFlash ? 'ring-1 ring-white/40 scale-105' : 'scale-100'}
                `}
                style={{ transition: 'transform 0.2s ease, box-shadow 0.3s ease' }}
              >
                {chartSignal.signal === 'STRONG_BUY' || chartSignal.signal === 'BUY' ? '▲' : chartSignal.signal === 'STRONG_SELL' || chartSignal.signal === 'SELL' ? '▼' : '●'}
                {cfg.label}
                <span className="opacity-70 font-mono text-[9px] tabular-nums">{chartSignal.score > 0 ? '+' : ''}{chartSignal.score}</span>
                {/* Live heartbeat dot — proves the score is updating every second */}
                <span
                  className="w-1 h-1 rounded-full bg-current opacity-50 animate-ping"
                  style={{ animationDuration: '1.4s' }}
                />
              </span>
            );
          })()}
          <div className="flex rounded-md overflow-hidden border border-slate-700/50">
            <button
              onClick={() => setTimeframe('3m')}
              className={`px-2 py-0.5 text-[10px] font-bold transition-colors ${
                timeframe === '3m' ? 'bg-cyan-500/20 text-cyan-300 border-r border-cyan-500/30' : 'text-slate-500 hover:text-slate-300 border-r border-slate-700/50'
              }`}
            >3m</button>
            <button
              onClick={() => setTimeframe('5m')}
              className={`px-2 py-0.5 text-[10px] font-bold transition-colors ${
                timeframe === '5m' ? 'bg-cyan-500/20 text-cyan-300' : 'text-slate-500 hover:text-slate-300'
              }`}
            >5m</button>
          </div>
          <span className={`hidden sm:inline text-[9px] font-mono ${sourceColor}`}>{sourceLabel}</span>
          {/* Expand / collapse */}
          <button
            onClick={() => setExpanded(v => !v)}
            className="w-6 h-6 rounded bg-slate-700/50 border border-slate-600/40 text-slate-400 text-[10px] flex items-center justify-center hover:bg-slate-600/60 hover:text-slate-200 transition-all"
            title={expanded ? 'Collapse chart' : 'Expand chart'}
          >
            {expanded ? '⊟' : '⊞'}
          </button>
        </div>
      </div>

      {/* Chart Canvas */}
      <CandleChart
        candles={candles}
        fvg={fvgList}
        ob={obList}
        liquidity={liqList}
        levels={levels}
        spot={data.spot}
        liveSpot={liveSpot}
        chartHeight={chartH}
      />

      {/* Footer Legend */}
      <div className="px-3 py-2 border-t border-slate-700/30 bg-slate-900/40">
        {/* Row 1: Level Labels */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-1.5">
          <span className="flex items-center gap-1 text-[8px] font-bold" style={{ color: CFG.PDH }}>
            <span className="w-4 border-t-2 border-dashed inline-block" style={{ borderColor: CFG.PDH }} /> PDH/PDL
          </span>
          <span className="flex items-center gap-1 text-[8px] font-bold" style={{ color: CFG.CDH }}>
            <span className="w-4 border-t-2 inline-block" style={{ borderColor: CFG.CDH }} /> CDH/CDL
          </span>
          <span className="flex items-center gap-1 text-[8px] font-bold" style={{ color: CFG.SUPPORT }}>
            <span className="w-4 border-t border-dotted inline-block" style={{ borderColor: CFG.SUPPORT }} /> Support
          </span>
          <span className="flex items-center gap-1 text-[8px] font-bold" style={{ color: CFG.RESISTANCE }}>
            <span className="w-4 border-t border-dotted inline-block" style={{ borderColor: CFG.RESISTANCE }} /> Resist
          </span>
        </div>
        {/* Row 2: Zone counts */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[8px] font-mono" style={{ color: CFG.FVG_BULL_BORDER }}>
            ▲FVG {stats.fvgBull}
          </span>
          <span className="text-[8px] font-mono" style={{ color: CFG.FVG_BEAR_BORDER }}>
            ▼FVG {stats.fvgBear}
          </span>
          <span className="text-[8px] font-mono" style={{ color: CFG.OB_BULL_BORDER }}>
            ▲OB {stats.obBull}
          </span>
          <span className="text-[8px] font-mono" style={{ color: CFG.OB_BEAR_BORDER }}>
            ▼OB {stats.obBear}
          </span>
          <span className="text-[8px] font-mono" style={{ color: CFG.LIQ_SELL }}>
            SSL {stats.ssl}
          </span>
          <span className="text-[8px] font-mono" style={{ color: CFG.LIQ_BUY }}>
            BSL {stats.bsl}
          </span>
          <span className="ml-auto text-[8px] font-mono text-slate-600">
            {candles.length}c · {lastCandle ? fmtTime(lastCandle.t) : ''}
          </span>
        </div>
        {/* Proximity hint */}
        <div className="mt-1 text-[7.5px] text-slate-600">
          ⚡ Candles touching/near a level glow · Rejection wicks highlighted · Hover for zone tooltip
        </div>
      </div>
    </div>
  );
});
SymbolChartCard.displayName = 'SymbolChartCard';

// ── Main Component ──────────────────────────────────────────────────────────

const ChartIntelligence = memo(() => {
  const { chartData } = useChartIntelligence();
  // Live tick prices from the main market socket — updates every Zerodha tick (~1s)
  const { marketData } = useMarketSocket();

  const dataStatus = useMemo(() => {
    const sources = [chartData.NIFTY?.dataSource, chartData.BANKNIFTY?.dataSource, chartData.SENSEX?.dataSource].filter(Boolean);
    if (sources.length === 0) return { label: '○ WAITING', color: 'text-slate-500' };
    if (sources.includes('LIVE')) return { label: '● LIVE', color: 'text-emerald-400' };
    if (sources.includes('CACHED')) return { label: '◐ CACHED', color: 'text-amber-400' };
    return { label: '○ CLOSED', color: 'text-slate-500' };
  }, [chartData]);

  return (
    <div className="mt-4">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="w-[3px] h-6 rounded-full bg-gradient-to-b from-indigo-400 to-purple-500 shrink-0" />
          <h3 className="text-[13px] sm:text-[15px] font-bold text-white tracking-tight">
            Real-Time Chart Intelligence
          </h3>
          <span className="hidden sm:inline text-[10px] sm:text-[11px] text-indigo-400/60 font-medium">
            FVG · OB · Liquidity · S/R · PDH/PDL · CDH/CDL
          </span>
          <span className={`text-[9px] font-mono ${dataStatus.color}`}>
            {dataStatus.label}
          </span>
        </div>
        {/* Legend pills — hidden on mobile to save space */}
        <div className="hidden sm:flex flex-wrap items-center gap-1.5 text-[8px] font-bold">
          <span className="px-1.5 py-0.5 rounded" style={{ background: CFG.OB_BULL_FILL, color: CFG.OB_BULL_BORDER, border: `1px solid ${CFG.OB_BULL_BORDER}` }}>▲ Bull OB</span>
          <span className="px-1.5 py-0.5 rounded" style={{ background: CFG.OB_BEAR_FILL, color: CFG.OB_BEAR_BORDER, border: `1px solid ${CFG.OB_BEAR_BORDER}` }}>▼ Bear OB</span>
          <span className="px-1.5 py-0.5 rounded" style={{ background: CFG.FVG_BULL_FILL, color: CFG.FVG_BULL_BORDER, border: `1px solid ${CFG.FVG_BULL_BORDER}` }}>↑ FVG</span>
          <span className="px-1.5 py-0.5 rounded" style={{ background: CFG.FVG_BEAR_FILL, color: CFG.FVG_BEAR_BORDER, border: `1px solid ${CFG.FVG_BEAR_BORDER}` }}>↓ FVG</span>
          <span className="px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/30">SSL</span>
          <span className="px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">BSL</span>
        </div>
      </div>

      {/* Chart Cards Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-3">
        <SymbolChartCard data={chartData.NIFTY} name="NIFTY 50" liveSpot={marketData.NIFTY?.price} />
        <SymbolChartCard data={chartData.BANKNIFTY} name="BANK NIFTY" liveSpot={marketData.BANKNIFTY?.price} />
        <SymbolChartCard data={chartData.SENSEX} name="SENSEX" liveSpot={marketData.SENSEX?.price} />
      </div>
    </div>
  );
});
ChartIntelligence.displayName = 'ChartIntelligence';

export default ChartIntelligence;
