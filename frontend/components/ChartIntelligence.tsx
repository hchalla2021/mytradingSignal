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
  GRID_STRONG: 'rgba(148,163,184,0.09)',

  // Candles
  BULL: '#22c55e',
  BULL_WICK: '#16a34a',
  BULL_BODY: 'rgba(34,197,94,0.85)',
  BEAR: '#ef4444',
  BEAR_WICK: '#dc2626',
  BEAR_BODY: 'rgba(239,68,68,0.85)',

  // FVG
  FVG_BULL_FILL: 'rgba(34,197,94,0.12)',
  FVG_BULL_BORDER: '#22c55e',
  FVG_BEAR_FILL: 'rgba(239,68,68,0.12)',
  FVG_BEAR_BORDER: '#ef4444',
  FVG_FILLED_FILL: 'rgba(148,163,184,0.04)',

  // Order Blocks
  OB_BULL_FILL: 'rgba(251,191,36,0.13)',
  OB_BULL_BORDER: '#fbbf24',
  OB_BEAR_FILL: 'rgba(168,85,247,0.13)',
  OB_BEAR_BORDER: '#a855f7',
  OB_MITIGATED_ALPHA: 0.4,

  // Liquidity
  LIQ_SELL: '#f97316',   // sell-side (above equal highs)
  LIQ_BUY: '#06b6d4',   // buy-side (below equal lows)
  LIQ_SWEPT: 'rgba(148,163,184,0.35)',

  // Key Levels
  PDH: '#f97316',
  PDL: '#fb923c',
  CDH: '#22d3ee',
  CDL: '#67e8f9',
  SUPPORT: '#10b981',
  RESISTANCE: '#f43f5e',

  // Current price
  CURRENT_PRICE: '#818cf8',

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
}

const CandleChart = memo<CandleChartProps>(({ candles, fvg, ob, liquidity, levels, spot }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef(0);
  const mouseRef = useRef({ x: -1, y: -1 });
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartScroll = useRef(0);
  const rafRef = useRef(0);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || candles.length === 0) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const W = rect.width;
    const H = CFG.CHART_H;

    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const chartLeft = 0;
    const chartRight = W - CFG.PRICE_AXIS_W;
    const chartTop = CFG.PAD_TOP;
    const chartBottom = H - CFG.TIME_AXIS_H;
    const chartW = chartRight - chartLeft;
    const chartH = chartBottom - chartTop;
    const candleStep = CFG.CANDLE_W + CFG.CANDLE_GAP;

    const visibleCount = Math.floor(chartW / candleStep);
    const maxScroll = Math.max(0, candles.length - visibleCount);
    scrollRef.current = Math.max(0, Math.min(scrollRef.current, maxScroll));

    const startIdx = Math.max(0, candles.length - visibleCount - scrollRef.current);
    const endIdx = Math.min(candles.length, startIdx + visibleCount);
    const visible = candles.slice(startIdx, endIdx);
    if (visible.length === 0) return;

    // Price range
    let priceMin = Infinity, priceMax = -Infinity;
    for (const c of visible) {
      if (c.h > priceMax) priceMax = c.h;
      if (c.l < priceMin) priceMin = c.l;
    }
    const allLevels = [
      levels.pdh, levels.pdl, levels.cdh, levels.cdl,
      ...levels.support, ...levels.resistance,
      spot,
      ...liquidity.map(l => l.level),
    ];
    for (const lv of allLevels) {
      if (lv > 0) { if (lv > priceMax) priceMax = lv; if (lv < priceMin) priceMin = lv; }
    }
    // Include OB zones
    for (const o of ob) {
      if (o.high > priceMax) priceMax = o.high;
      if (o.low < priceMin) priceMin = o.low;
    }
    const pricePad = (priceMax - priceMin) * 0.07;
    priceMin -= pricePad;
    priceMax += pricePad;
    const priceRange = priceMax - priceMin || 1;

    const priceToY = (p: number) => chartTop + (1 - (p - priceMin) / priceRange) * chartH;
    const idxToX = (i: number) => chartLeft + (i + 0.5) * candleStep;

    // Build proximity alert set (candle indices touching a key level)
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
        if (
          (c.h >= lv && c.l <= lv) ||
          near(c.h, lv) ||
          near(c.l, lv) ||
          near(c.c, lv)
        ) {
          proxSet.add(i);
          break;
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
      const x = idxToX(i);
      ctx.beginPath();
      ctx.moveTo(x, chartTop);
      ctx.lineTo(x, chartBottom);
      ctx.stroke();
    }

    // ── ORDER BLOCKS ────────────────────────────────────────────────
    for (const o of ob) {
      const relStart = o.startIdx - startIdx;
      if (relStart >= visible.length) continue;
      const drawFrom = Math.max(0, relStart);
      const x1 = idxToX(drawFrom) - candleStep / 2;
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
      const drawFrom = Math.max(0, relStart);
      const x1 = idxToX(drawFrom) - candleStep / 2;
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
      ctx.strokeStyle = isBull ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(x1, midY); ctx.lineTo(x2, midY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label
      if (h > 6) {
        ctx.fillStyle = isBull ? CFG.FVG_BULL_BORDER : CFG.FVG_BEAR_BORDER;
        ctx.font = '7px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`FVG ${isBull ? '↑' : '↓'}`, x1 + 4, midY + 3);
      }
    }

    // ── KEY LEVEL LINES ─────────────────────────────────────────────
    const drawLevel = (
      price: number,
      color: string,
      dash: number[],
      label: string,
      lineW = 1,
      extendLabel = true,
    ) => {
      if (price <= 0) return;
      const y = priceToY(price);
      if (y < chartTop || y > chartBottom) return;

      // Proximity glow — thick glow if spot is near this level
      const isNearSpot = near(spot, price, 0.004);
      if (isNearSpot) {
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 12;
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = isNearSpot ? lineW + 1.5 : lineW;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(chartLeft, y);
      ctx.lineTo(chartRight, y);
      ctx.stroke();
      ctx.setLineDash([]);

      if (isNearSpot) ctx.restore();

      if (!extendLabel) return;

      // Pill label on right
      const px = fmtPrice(price);
      const labelText = `${label} ${px}`;
      ctx.font = 'bold 8.5px sans-serif';
      const tw = ctx.measureText(labelText).width;
      const pw = tw + 8;
      const ph = 14;
      const px0 = chartRight + 2;
      const py0 = y - ph / 2;

      // Pill bg
      ctx.fillStyle = color;
      ctx.globalAlpha = isNearSpot ? 1 : 0.85;
      roundRect(ctx, px0, py0, pw, ph, 3);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Text
      ctx.fillStyle = '#0b1120';
      ctx.font = 'bold 8px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(labelText, px0 + 4, py0 + 10);
    };

    // PDH / PDL (dashed orange)
    drawLevel(levels.pdh, CFG.PDH, [7, 4], 'PDH');
    drawLevel(levels.pdl, CFG.PDL, [7, 4], 'PDL');

    // CDH / CDL (solid cyan, day range)
    drawLevel(levels.cdh, CFG.CDH, [], 'CDH', 1.5);
    drawLevel(levels.cdl, CFG.CDL, [], 'CDL', 1.5);

    // Support / Resistance (dotted)
    for (const s of levels.support) drawLevel(s, CFG.SUPPORT, [2, 3], 'S');
    for (const r of levels.resistance) drawLevel(r, CFG.RESISTANCE, [2, 3], 'R');

    // ── LIQUIDITY LEVELS ────────────────────────────────────────────
    for (const lq of liquidity) {
      const y = priceToY(lq.level);
      if (y < chartTop || y > chartBottom) continue;
      const isSell = lq.type === 'sell_side';
      const color = lq.swept ? CFG.LIQ_SWEPT : (isSell ? CFG.LIQ_SELL : CFG.LIQ_BUY);
      const isNear = near(spot, lq.level, 0.005);

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

      // Label
      const liqLabel = lq.swept
        ? `${isSell ? 'SSL✗' : 'BSL✗'} ${fmtPrice(lq.level)}`
        : `${isSell ? 'SSL' : 'BSL'} ×${lq.touchCount} ${fmtPrice(lq.level)}`;
      ctx.font = 'bold 8px sans-serif';
      ctx.fillStyle = color;
      ctx.globalAlpha = lq.swept ? 0.5 : 1;
      ctx.textAlign = 'left';
      ctx.fillText(liqLabel, chartRight + 2, y - 2);
      ctx.globalAlpha = 1;
    }

    // ── CURRENT PRICE LINE ──────────────────────────────────────────
    if (spot > 0) {
      const y = priceToY(spot);
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
        ctx.fillText(fmtPrice(spot), chartRight + (CFG.PRICE_AXIS_W - 2) / 2, y + 3);
      }
    }

    // ── CANDLES ─────────────────────────────────────────────────────
    for (let i = 0; i < visible.length; i++) {
      const c = visible[i];
      const x = idxToX(i);
      const isBull = c.c >= c.o;
      const bodyTop = priceToY(Math.max(c.o, c.c));
      const bodyBot = priceToY(Math.min(c.o, c.c));
      const bodyH = Math.max(1.5, bodyBot - bodyTop);
      const wickTop = priceToY(c.h);
      const wickBot = priceToY(c.l);
      const isProx = proxSet.has(i);
      const halfW = CFG.CANDLE_W / 2;

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
      ctx.fillRect(x - halfW, bodyTop, CFG.CANDLE_W, bodyH);

      if (isProx) {
        // Bright border on proximity candle
        ctx.strokeStyle = isBull ? '#4ade80' : '#f87171';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - halfW, bodyTop, CFG.CANDLE_W, bodyH);
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
      ctx.fillText(fmtTime(visible[i].t), idxToX(i), chartBottom + 14);
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

      // Time cursor label
      const cIdx = Math.round((mx - chartLeft) / candleStep - 0.5);
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

  useEffect(() => {
    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  }, [render]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => { rafRef.current = requestAnimationFrame(render); });
    ro.observe(container);
    return () => ro.disconnect();
  }, [render]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (isDragging.current) {
      const dx = e.clientX - dragStartX.current;
      scrollRef.current = dragStartScroll.current + Math.round(dx / (CFG.CANDLE_W + CFG.CANDLE_GAP));
    }
    rafRef.current = requestAnimationFrame(render);
  }, [render]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartScroll.current = scrollRef.current;
  }, []);
  const handleMouseUp = useCallback(() => { isDragging.current = false; }, []);
  const handleMouseLeave = useCallback(() => {
    mouseRef.current = { x: -1, y: -1 };
    isDragging.current = false;
    rafRef.current = requestAnimationFrame(render);
  }, [render]);
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    scrollRef.current += e.deltaY > 0 ? 3 : -3;
    rafRef.current = requestAnimationFrame(render);
  }, [render]);

  const touchStartX = useRef(0);
  const touchStartScroll = useRef(0);
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) { touchStartX.current = e.touches[0].clientX; touchStartScroll.current = scrollRef.current; }
  }, []);
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const dx = e.touches[0].clientX - touchStartX.current;
      scrollRef.current = touchStartScroll.current + Math.round(dx / (CFG.CANDLE_W + CFG.CANDLE_GAP));
      rafRef.current = requestAnimationFrame(render);
    }
  }, [render]);

  return (
    <div ref={containerRef} className="w-full cursor-crosshair select-none" style={{ height: CFG.CHART_H }}>
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        className="w-full h-full"
      />
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

// ── Symbol Chart Card ───────────────────────────────────────────────────────

const SymbolChartCard = memo<{ data: SymbolChartData | null; name: string }>(({ data, name }) => {
  const [timeframe, setTimeframe] = useState<'3m' | '5m'>('3m');

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
  const change = lastCandle.c - prevClose;
  const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;
  const changeColor = change >= 0 ? 'text-emerald-400' : 'text-red-400';
  const changeIcon = change >= 0 ? '▲' : '▼';

  return (
    <div className="rounded-xl bg-dark-card/60 border border-slate-700/40 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 border-b border-slate-700/30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs sm:text-sm font-bold text-white truncate">{name}</span>
          <span className="text-[11px] font-mono text-slate-400">{fmtPrice(data.spot)}</span>
          <span className={`text-[10px] font-mono ${changeColor}`}>
            {changeIcon}{Math.abs(change).toFixed(2)} ({changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%)
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
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
          <span className={`text-[9px] font-mono ${sourceColor}`}>{sourceLabel}</span>
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
          <span className="text-[10px] sm:text-[11px] text-indigo-400/60 font-medium">
            FVG · OB · Liquidity · S/R · PDH/PDL · CDH/CDL
          </span>
          <span className={`text-[9px] font-mono ml-1 ${dataStatus.color}`}>
            {dataStatus.label}
          </span>
        </div>
        {/* Legend pills */}
        <div className="flex flex-wrap items-center gap-1.5 text-[8px] font-bold">
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
        <SymbolChartCard data={chartData.NIFTY} name="NIFTY 50" />
        <SymbolChartCard data={chartData.BANKNIFTY} name="BANK NIFTY" />
        <SymbolChartCard data={chartData.SENSEX} name="SENSEX" />
      </div>
    </div>
  );
});
ChartIntelligence.displayName = 'ChartIntelligence';

export default ChartIntelligence;
