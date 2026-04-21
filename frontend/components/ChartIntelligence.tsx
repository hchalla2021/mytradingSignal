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
  PRICE_AXIS_W: 86,
  TIME_AXIS_H: 24,
  PAD_TOP: 8,
  LEGEND_H: 38,        // top legend strip height (2 compact rows)
  VOL_H: 48,          // volume panel height reserved at bottom (above time axis)
  CANDLE_W: 7,
  CANDLE_GAP: 3,
  CHART_H: 380,

  // Base colors — Zerodha dark theme
  BG: '#131722',
  GRID: 'rgba(255,255,255,0.04)',
  GRID_STRONG: 'rgba(255,255,255,0.07)',
  GRID_ALT: 'rgba(255,255,255,0.015)',

  // ── CANDLES — exactly Zerodha Kite colors ──────────────────────
  // Bull: solid teal #26a69a, Bear: solid red #ef5350
  // Wicks: same color as body — no anti-alias glow tricks
  BULL: '#26a69a',
  BULL_WICK: '#26a69a',
  BULL_BODY: '#26a69a',       // solid fill — same as Zerodha
  BEAR: '#ef5350',
  BEAR_WICK: '#ef5350',
  BEAR_BODY: '#ef5350',
  DOJI: '#787b86',            // neutral grey doji line

  // Volume bars
  VOL_BULL: 'rgba(38,166,154,0.5)',
  VOL_BEAR: 'rgba(239,83,80,0.5)',
  VOL_SEPARATOR: 'rgba(255,255,255,0.05)',

  // ── FVG — muted teal (bull) / dusty rose (bear) ──────────────────
  // Soft mid-tone hues — distinct from levels, easy on eyes for long sessions
  FVG_BULL_FILL:   'rgba(56,178,166,0.08)',   // #38b2a6 muted teal
  FVG_BULL_BORDER: '#38b2a6',
  FVG_BULL_HATCH:  'rgba(56,178,166,0.18)',
  FVG_BEAR_FILL:   'rgba(188,100,140,0.08)',  // #bc648c dusty rose
  FVG_BEAR_BORDER: '#bc648c',
  FVG_BEAR_HATCH:  'rgba(188,100,140,0.18)',
  FVG_FILLED_FILL: 'rgba(148,163,184,0.025)',

  // ── ORDER BLOCKS — warm sand (bull) / soft lavender (bear) ───────
  OB_BULL_FILL:  'rgba(194,154,80,0.09)',   // #c29a50 warm sand-gold
  OB_BULL_FILL2: 'rgba(194,154,80,0.0)',
  OB_BULL_BORDER: '#c29a50',
  OB_BEAR_FILL:  'rgba(138,104,190,0.09)',  // #8a68be soft lavender
  OB_BEAR_FILL2: 'rgba(138,104,190,0.0)',
  OB_BEAR_BORDER: '#8a68be',
  OB_MITIGATED_ALPHA: 0.28,

  // ── LIQUIDITY — muted rose (sell) / sage green (buy) ─────────────
  LIQ_SELL: '#b05878',   // muted rose-pink (sell pressure)
  LIQ_BUY:  '#4a9e7e',   // sage jade-green (buy pressure)
  LIQ_SWEPT: 'rgba(148,163,184,0.25)',

  // ── KEY LEVELS — muted, each hue family unique ────────────────────
  //  PREV H  → warm straw    (#b8983e)  — yesterday's ceiling
  //  PREV L  → terra cotta   (#b06848)  — yesterday's floor
  //  TODAY H → calm teal     (#3aa8bc)  — today's ceiling
  //  TODAY L → slate blue    (#5278b8)  — today's floor
  //  SUPPORT → sage green    (#4e9a62)  — algorithmic support
  //  RESIST  → muted crimson (#a84858)  — algorithmic resistance
  PDH: '#b8983e',      // warm straw    — PREV HIGH
  PDL: '#b06848',      // terra cotta   — PREV LOW
  CDH: '#3aa8bc',      // calm teal     — TODAY HIGH
  CDL: '#5278b8',      // slate blue    — TODAY LOW
  SUPPORT:    '#4e9a62',   // sage green
  RESISTANCE: '#a84858',   // muted crimson

  // ── Structure / SMC — soft, readable tones ───────────────────────
  BOS_BULL:   '#5090b8',   // steel blue   — BOS ↑ (continuation up)
  BOS_BEAR:   '#b87858',   // burnt sienna — BOS ↓ (continuation down)
  CHOCH_BULL: '#68a882',   // moss green   — CHoCH ↑ (reversal up)
  CHOCH_BEAR: '#9868b0',   // soft plum    — CHoCH ↓ (reversal down)
  IND_COLOR:  '#7a8fa8',   // blue-grey    — Inducement / EQH / EQL

  // ── Current price ─────────────────────────────────────────────────
  CURRENT_PRICE: '#9070c0',   // muted violet (calm, nothing else uses this hue)

  // Axis
  AXIS_TEXT: '#787b86',
  AXIS_LINE: 'rgba(255,255,255,0.07)',
  CROSSHAIR: 'rgba(255,255,255,0.15)',
  CROSSHAIR_LABEL_BG: 'rgba(19,23,34,0.97)',

  PROX_PCT: 0.003,
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

// ── SMC / ICT structure types ───────────────────────────────────────────────

interface StructureEvent {
  idx: number;    // candle index where the break occurred
  level: number;  // price level that was broken
  type: 'BOS_BULL' | 'BOS_BEAR' | 'CHOCH_BULL' | 'CHOCH_BEAR';
}

interface InducementPoint {
  idx: number;    // rightmost candle of the equal-high/low cluster
  level: number;  // price of the equal high or low
  side: 'high' | 'low';
}

/** Resample candles to a higher timeframe (factor × base candles per new candle) */
function resampleCandles(candles: Candle[], factor: number): Candle[] {
  if (factor <= 1 || candles.length === 0) return candles;
  const out: Candle[] = [];
  for (let i = 0; i < candles.length; i += factor) {
    const slice = candles.slice(i, i + factor);
    out.push({
      t: slice[0].t,
      o: slice[0].o,
      h: Math.max(...slice.map(c => c.h)),
      l: Math.min(...slice.map(c => c.l)),
      c: slice[slice.length - 1].c,
      v: slice.reduce((s, c) => s + c.v, 0),
    });
  }
  return out;
}

/** Detect swing highs and lows with a lookback on each side */
function findSwings(candles: Candle[], LB = 4) {
  const highs: Array<{ idx: number; p: number }> = [];
  const lows:  Array<{ idx: number; p: number }> = [];
  for (let i = LB; i < candles.length - LB; i++) {
    let isH = true, isL = true;
    for (let j = i - LB; j <= i + LB; j++) {
      if (j === i) continue;
      if (candles[j].h >= candles[i].h) isH = false;
      if (candles[j].l <= candles[i].l) isL = false;
    }
    if (isH) highs.push({ idx: i, p: candles[i].h });
    if (isL) lows.push({ idx: i, p: candles[i].l });
  }
  return { highs, lows };
}

/** Compute BOS and ChoCh events from candles */
function computeStructure(candles: Candle[], LB = 4): StructureEvent[] {
  if (candles.length < LB * 4) return [];
  const { highs, lows } = findSwings(candles, LB);
  const events: StructureEvent[] = [];
  let lastBullIdx = -1, lastBearIdx = -1;

  // For each swing high: find first close above it
  for (const sh of highs) {
    for (let i = sh.idx + 2; i < candles.length; i++) {
      if (candles[i].c > sh.p) {
        if (i > lastBullIdx + 1 && i > lastBearIdx + 1) {
          const isChoCh = lastBearIdx > lastBullIdx;
          events.push({ idx: i, level: sh.p, type: isChoCh ? 'CHOCH_BULL' : 'BOS_BULL' });
          lastBullIdx = i;
        }
        break;
      }
      // Invalidated if price drops below the swing low before breaking high
      const nearLow = lows.find(sl => sl.idx < sh.idx);
      if (nearLow && candles[i].c < nearLow.p) break;
    }
  }

  // For each swing low: find first close below it
  for (const sl of lows) {
    for (let i = sl.idx + 2; i < candles.length; i++) {
      if (candles[i].c < sl.p) {
        if (i > lastBullIdx + 1 && i > lastBearIdx + 1) {
          const isChoCh = lastBullIdx > lastBearIdx;
          events.push({ idx: i, level: sl.p, type: isChoCh ? 'CHOCH_BEAR' : 'BOS_BEAR' });
          lastBearIdx = i;
        }
        break;
      }
      const nearHigh = highs.find(sh => sh.idx < sl.idx);
      if (nearHigh && candles[i].c > nearHigh.p) break;
    }
  }

  return events.sort((a, b) => a.idx - b.idx).slice(-10);
}

/** Detect inducement clusters — equal highs / equal lows within tight tolerance */
function computeInducements(candles: Candle[], LB = 4): InducementPoint[] {
  if (candles.length < LB * 3) return [];
  const { highs, lows } = findSwings(candles, LB);
  const pts: InducementPoint[] = [];
  const EQ = 0.0012; // 0.12% tolerance

  // Equal highs
  for (let i = 0; i < highs.length - 1; i++) {
    for (let j = i + 1; j < highs.length; j++) {
      if (highs[j].idx - highs[i].idx > 40) break;
      if (Math.abs(highs[i].p - highs[j].p) / highs[i].p <= EQ) {
        pts.push({ idx: highs[j].idx, level: Math.max(highs[i].p, highs[j].p), side: 'high' });
        break;
      }
    }
  }
  // Equal lows
  for (let i = 0; i < lows.length - 1; i++) {
    for (let j = i + 1; j < lows.length; j++) {
      if (lows[j].idx - lows[i].idx > 40) break;
      if (Math.abs(lows[i].p - lows[j].p) / lows[i].p <= EQ) {
        pts.push({ idx: lows[j].idx, level: Math.min(lows[i].p, lows[j].p), side: 'low' });
        break;
      }
    }
  }
  return pts.slice(-8);
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
  chartHeight?: number;
  onMaximize?: () => void;
  structure?: StructureEvent[];
  inducements?: InducementPoint[];
  htfMode?: boolean;
}

const CandleChart = memo<CandleChartProps>(({ candles, fvg, ob, liquidity, levels, spot, liveSpot, chartHeight, onMaximize, structure = [], inducements = [], htfMode = false }) => {
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
    const chartTop = CFG.PAD_TOP + CFG.LEGEND_H;  // below the legend strip
    const volBottom = H - CFG.TIME_AXIS_H;       // bottom of volume panel
    const chartBottom = volBottom - CFG.VOL_H;   // candle chart bottom (above volume panel)
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

    // ── LEGEND STRIP — always visible top bar ────────────────────────
    // Two rows × 19px. Each item: colored swatch + short label.
    // Row 1: Day levels + Previous levels + Structure
    // Row 2: Zones (FVG, OB, Liquidity)
    {
      const lY = CFG.PAD_TOP;          // strip top
      const lH = CFG.LEGEND_H;         // strip height
      const row1Y = lY + 13;           // text baseline row 1
      const row2Y = lY + 28;           // text baseline row 2

      // Strip background
      ctx.fillStyle = 'rgba(13,17,28,0.97)';
      ctx.fillRect(0, lY, W, lH);
      // Bottom border
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, lY + lH);
      ctx.lineTo(W, lY + lH);
      ctx.stroke();

      ctx.font = 'bold 9.5px sans-serif';
      ctx.textAlign = 'left';

      // Helper: draw colored line swatch + text
      const lItem = (x: number, y: number, color: string, text: string, dash: number[] = []) => {
        // Swatch (horizontal line segment)
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash(dash);
        ctx.beginPath();
        ctx.moveTo(x, y - 3);
        ctx.lineTo(x + 14, y - 3);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        // Label
        ctx.fillStyle = color;
        ctx.fillText(text, x + 17, y);
        const tw = ctx.measureText(text).width;
        return x + 17 + tw + 10;  // next x
      };

      // Helper: draw colored filled rect swatch + text
      const zItem = (x: number, y: number, color: string, text: string) => {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.8;
        ctx.fillRect(x, y - 8, 12, 9);
        ctx.globalAlpha = 1;
        // slim border
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y - 8, 12, 9);
        ctx.fillStyle = color;
        ctx.fillText(text, x + 15, y);
        const tw = ctx.measureText(text).width;
        return x + 15 + tw + 10;
      };

      // Helper: draw diamond swatch + text
      const dItem = (x: number, y: number, color: string, text: string) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x + 5, y - 7);
        ctx.lineTo(x + 10, y - 3);
        ctx.lineTo(x + 5, y + 1);
        ctx.lineTo(x, y - 3);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = color;
        ctx.fillText(text, x + 14, y);
        const tw = ctx.measureText(text).width;
        return x + 14 + tw + 10;
      };

      // ROW 1: Key levels + structure lines
      let cx = 6;
      cx = lItem(cx, row1Y, CFG.CDH,        'DAY H',  []);
      cx = lItem(cx, row1Y, CFG.CDL,        'DAY L',  []);
      cx = lItem(cx, row1Y, CFG.PDH,        'PREV H', [8, 4]);
      cx = lItem(cx, row1Y, CFG.PDL,        'PREV L', [8, 4]);
      cx = lItem(cx, row1Y, CFG.SUPPORT,    'SUP',    [2, 4]);
      cx = lItem(cx, row1Y, CFG.RESISTANCE, 'RES',    [2, 4]);
      cx = lItem(cx, row1Y, CFG.BOS_BULL,   'BOS↑',   [4, 3]);
      cx = lItem(cx, row1Y, CFG.BOS_BEAR,   'BOS↓',   [4, 3]);
      cx = lItem(cx, row1Y, CFG.CHOCH_BULL, 'CHoCH↑', []);
           lItem(cx, row1Y, CFG.CHOCH_BEAR, 'CHoCH↓', []);

      // ROW 2: Zones + liquidity
      let cx2 = 6;
      cx2 = zItem(cx2, row2Y, CFG.FVG_BULL_BORDER,  'FVG▲');
      cx2 = zItem(cx2, row2Y, CFG.FVG_BEAR_BORDER,  'FVG▼');
      cx2 = zItem(cx2, row2Y, CFG.OB_BULL_BORDER,   'OB▲');
      cx2 = zItem(cx2, row2Y, CFG.OB_BEAR_BORDER,   'OB▼');
      cx2 = dItem(cx2, row2Y, CFG.LIQ_BUY,          'BSL');
      cx2 = dItem(cx2, row2Y, CFG.LIQ_SELL,         'SSL');
      cx2 = dItem(cx2, row2Y, CFG.IND_COLOR,         'EQH/EQL');
           lItem(cx2, row2Y, CFG.CURRENT_PRICE,     'LTP',    [5, 3]);
    }

    // ── Grid — alternating band shading ───────────────────────────
    const gridSteps = 8;
    for (let i = 0; i < gridSteps; i++) {
      const y1g = chartTop + (chartH / gridSteps) * i;
      const y2g = chartTop + (chartH / gridSteps) * (i + 1);
      if (i % 2 === 0) {
        ctx.fillStyle = CFG.GRID_ALT;
        ctx.fillRect(chartLeft, y1g, chartW, y2g - y1g);
      }
    }
    for (let i = 0; i <= gridSteps; i++) {
      const y = chartTop + (chartH / gridSteps) * i;
      ctx.strokeStyle = i % 2 === 0 ? CFG.GRID_STRONG : CFG.GRID;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(chartLeft, y);
      ctx.lineTo(chartRight, y);
      ctx.stroke();
    }
    // Vertical grid — every ~10 candles
    ctx.strokeStyle = CFG.GRID;
    ctx.lineWidth = 0.5;
    for (let i = 0; i < visible.length; i += 10) {
      const x = idxToX(startIdx + i);
      if (x < chartLeft || x > chartRight) continue;
      ctx.beginPath();
      ctx.moveTo(x, chartTop);
      ctx.lineTo(x, chartBottom);
      ctx.stroke();
    }

    // ── ORDER BLOCKS — gradient fill + accent bar + right-side label ───
    for (const o of ob) {
      const isBull = o.type === 'bullish';
      const alpha = o.mitigated ? CFG.OB_MITIGATED_ALPHA : 1;
      const borderColor = isBull ? CFG.OB_BULL_BORDER : CFG.OB_BEAR_BORDER;
      const fillStart = isBull ? CFG.OB_BULL_FILL : CFG.OB_BEAR_FILL;
      const fillEnd   = isBull ? CFG.OB_BULL_FILL2 : CFG.OB_BEAR_FILL2;

      let x1: number, x2: number;
      if (htfMode) {
        x1 = chartLeft;
        x2 = chartRight;
      } else {
        const relStart = o.startIdx - startIdx;
        if (relStart >= visible.length) continue;
        const absDrawFrom = startIdx + Math.max(0, relStart);
        x1 = idxToX(absDrawFrom) - candleStep / 2;
        x2 = chartRight;
      }
      const y1 = priceToY(o.top);
      const y2 = priceToY(o.bottom);
      const zoneH = Math.abs(y2 - y1);
      if (zoneH < 1) continue;

      ctx.globalAlpha = alpha;
      // Gradient fill — strong left, fades right
      const grad = ctx.createLinearGradient(x1, 0, x2, 0);
      grad.addColorStop(0, fillStart);
      grad.addColorStop(0.6, fillEnd);
      grad.addColorStop(1, fillEnd);
      ctx.fillStyle = grad;
      ctx.fillRect(x1, y1, x2 - x1, zoneH);
      // Left accent bar (4px solid)
      ctx.fillStyle = borderColor;
      ctx.fillRect(x1, y1, 5, zoneH);
      // Top and bottom border lines
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = o.mitigated ? 0.5 : 1;
      ctx.setLineDash(o.mitigated ? [6, 4] : []);
      ctx.beginPath();
      ctx.moveTo(x1 + 5, y1); ctx.lineTo(x2, y1);
      ctx.moveTo(x1 + 5, y2); ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
      // Label: right-aligned inside zone — clear, bigger text
      if (zoneH > 14) {
        const mid = (y1 + y2) / 2;
        const statusStr = o.mitigated ? ' ✗' : ` ×${o.strength.toFixed(1)}`;
        const tag = (isBull ? '▲ OB' : '▼ OB') + statusStr;
        ctx.font = 'bold 10px sans-serif';
        const tw = ctx.measureText(tag).width + 12;
        const tx = x2 - tw - 6;
        if (tx > x1 + 20) {
          roundRect(ctx, tx, mid - 9, tw, 17, 3);
          ctx.fillStyle = isBull ? 'rgba(234,179,8,0.3)' : 'rgba(192,132,252,0.3)';
          ctx.fill();
          ctx.fillStyle = borderColor;
          ctx.textAlign = 'left';
          ctx.fillText(tag, tx + 6, mid + 5);
        }
      }
      ctx.globalAlpha = 1;
    }

    // ── FVG ZONES — diagonal hatch pattern ─────────────────────────
    for (const f of fvg) {
      const isBull = f.type === 'bullish';
      const borderColor = isBull ? CFG.FVG_BULL_BORDER : CFG.FVG_BEAR_BORDER;
      const hatchColor  = isBull ? CFG.FVG_BULL_HATCH  : CFG.FVG_BEAR_HATCH;

      let x1: number, x2: number;
      if (htfMode) {
        x1 = chartLeft;
        x2 = chartRight;
      } else {
        const relStart = f.startIdx - startIdx;
        if (relStart >= visible.length) continue;
        const absDrawFrom = startIdx + Math.max(0, relStart);
        x1 = idxToX(absDrawFrom) - candleStep / 2;
        x2 = chartRight;
      }
      const y1 = priceToY(f.top);
      const y2 = priceToY(f.bottom);
      const zoneH = Math.abs(y2 - y1);
      const isBullF = f.type === 'bullish';
      if (f.filled) {
        ctx.fillStyle = CFG.FVG_FILLED_FILL;
        ctx.fillRect(x1, y1, x2 - x1, zoneH);
        continue;
      }
      ctx.fillStyle = isBullF ? CFG.FVG_BULL_FILL : CFG.FVG_BEAR_FILL;
      ctx.fillRect(x1, y1, x2 - x1, zoneH);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x1, y1, x2 - x1, zoneH);
      ctx.clip();
      ctx.strokeStyle = hatchColor;
      ctx.lineWidth = 1;
      const step = 8;
      for (let lx = x1 - zoneH; lx < x2 + zoneH; lx += step) {
        ctx.beginPath();
        ctx.moveTo(lx, y1);
        ctx.lineTo(lx + zoneH, y2);
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1.5;  // thicker FVG border — clearly visible
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y1);
      ctx.moveTo(x1, y2); ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
      const midY = (y1 + y2) / 2;
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 0.8;
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(x1, midY); ctx.lineTo(x2, midY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      // Label: right-aligned near top of FVG zone — clear, bigger text
      if (zoneH > 16) {
        const tag = isBullF ? '▲ FVG' : '▼ FVG';
        ctx.font = 'bold 10px sans-serif';
        const tw = ctx.measureText(tag).width + 12;
        const tx = x2 - tw - 6;
        if (tx > x1 + 10) {
          roundRect(ctx, tx, y1 + 3, tw, 16, 3);
          ctx.fillStyle = isBullF ? 'rgba(132,204,22,0.32)' : 'rgba(251,146,60,0.32)';
          ctx.fill();
          ctx.fillStyle = borderColor;
          ctx.textAlign = 'left';
          ctx.fillText(tag, tx + 6, y1 + 14);
        }
      }
    }

    // ── KEY LEVEL LINES ──────────────────────────────────────────────
    // Design system (every type visually distinct):
    //   DAY H/L   → solid line, thick, no dash  — "active" session levels
    //   PREV H/L  → long railroad dash [14,5]   — "yesterday" reference
    //   SUP/RES   → fine dots [2,5]             — algorithmic, less intrusive
    //
    // Label system:
    //   LEFT  → colored pill badge (full solid bg, white text) — instantly readable
    //   RIGHT → price pill on axis — exact price value
    const drawLevel = (
      price: number,
      color: string,
      dash: number[],
      label: string,
      lineW: number,
    ) => {
      if (price <= 0) return;
      const y = priceToY(price);
      if (y < chartTop || y > chartBottom) return;

      const isNearSpot = near(effectiveSpot, price, 0.004);

      // ── The line (starts after badge, ends before right axis) ──
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = isNearSpot ? lineW + 0.8 : lineW;
      ctx.setLineDash(dash);
      ctx.globalAlpha = isNearSpot ? 1 : 0.75;
      ctx.beginPath();
      ctx.moveTo(chartLeft + 52, y);   // leave room for left badge
      ctx.lineTo(chartRight, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.restore();

      // ── Left badge — solid colored pill with white text ──────────
      // Large enough to read on mobile
      const badgeFont = 'bold 10px sans-serif';
      ctx.font = badgeFont;
      const bw = ctx.measureText(label).width + 10;
      const bh = 17;
      const bx = chartLeft + 1;
      const by = y - bh / 2;
      ctx.fillStyle = color;
      ctx.globalAlpha = isNearSpot ? 1 : 0.88;
      roundRect(ctx, bx, by, bw, bh, 3);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#0d1117';   // near-black text on colored pill
      ctx.textAlign = 'left';
      ctx.fillText(label, bx + 5, by + 12);

      // ── Right axis price pill ────────────────────────────────────
      const priceStr = fmtPrice(price);
      ctx.font = 'bold 10px sans-serif';
      const rw = ctx.measureText(priceStr).width + 12;
      const rh = 18;
      const rx = chartRight + 2;
      const ry = y - rh / 2;
      ctx.fillStyle = color;
      ctx.globalAlpha = isNearSpot ? 1 : 0.85;
      roundRect(ctx, rx, ry, rw, rh, 4);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#0d1117';
      ctx.textAlign = 'left';
      ctx.fillText(priceStr, rx + 6, ry + 13);
    };

    // DAY HIGH — solid 2px electric cyan
    drawLevel(levels.cdh, CFG.CDH, [], 'DAY H', 2);
    // DAY LOW — solid 1.5px royal blue
    drawLevel(levels.cdl, CFG.CDL, [], 'DAY L', 1.5);
    // PREV HIGH — long dash [12,4] vivid gold
    drawLevel(levels.pdh, CFG.PDH, [12, 4], 'PREV H', 1.5);
    // PREV LOW — medium dash [6,4] deep orange (shorter dashes = different rhythm from PREV H)
    drawLevel(levels.pdl, CFG.PDL, [6, 4], 'PREV L', 1.2);
    // SUPPORT — dash-dot [5,3] neon lime, 1.5px (thick enough to see clearly)
    for (const s of levels.support) drawLevel(s, CFG.SUPPORT, [5, 3], 'SUP', 1.5);
    // RESISTANCE — dots [2,4] neon red, 1.5px (different dash from SUP)
    for (const r of levels.resistance) drawLevel(r, CFG.RESISTANCE, [2, 4], 'RES', 1.5);

    // ── LIQUIDITY LEVELS ────────────────────────────────────────────
    // SSL = Sell-side liquidity (below lows) — fuchsia
    // BSL = Buy-side liquidity  (above highs) — emerald
    // Swept = faded grey (already taken by market)
    for (const lq of liquidity) {
      const y = priceToY(lq.level);
      if (y < chartTop || y > chartBottom) continue;
      const isSell = lq.type === 'sell_side';
      const color = lq.swept ? CFG.LIQ_SWEPT : (isSell ? CFG.LIQ_SELL : CFG.LIQ_BUY);
      const isNear = near(effectiveSpot, lq.level, 0.005);

      // Fine dot pattern [1,4] — clearly different from level lines [14,5]
      ctx.strokeStyle = color;
      ctx.lineWidth = isNear ? 1.5 : 0.8;
      ctx.globalAlpha = lq.swept ? 0.35 : (isNear ? 0.9 : 0.65);
      ctx.setLineDash([1, 4]);
      ctx.beginPath();
      ctx.moveTo(chartLeft, y);
      ctx.lineTo(chartRight, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // Small diamond markers at both ends (only for active, unswept levels)
      if (!lq.swept) {
        const diamond = (cx: number, cy: number, size = 3.5) => {
          ctx.beginPath();
          ctx.moveTo(cx, cy - size);
          ctx.lineTo(cx + size, cy);
          ctx.lineTo(cx, cy + size);
          ctx.lineTo(cx - size, cy);
          ctx.closePath();
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.85;
          ctx.fill();
          ctx.globalAlpha = 1;
        };
        diamond(chartLeft + 5, y);
        diamond(chartRight - 5, y);
      }

      // Right-axis label pill — bigger font
      const liqTag = lq.swept
        ? `${isSell ? 'SSL ✗' : 'BSL ✗'}`
        : `${isSell ? 'SSL' : 'BSL'} ×${lq.touchCount}`;
      const liqFull = `${liqTag}  ${fmtPrice(lq.level)}`;
      ctx.font = 'bold 10px sans-serif';
      const llw = ctx.measureText(liqFull).width + 12;
      const llh = 17;
      const llx = chartRight + 2, lly = y - llh / 2;
      ctx.fillStyle = color;
      ctx.globalAlpha = lq.swept ? 0.35 : 0.85;
      roundRect(ctx, llx, lly, llw, llh, 3); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#0d1117';
      ctx.textAlign = 'left';
      ctx.fillText(liqFull, llx + 6, lly + 12);
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
        roundRect(ctx, chartRight, y - 10, CFG.PRICE_AXIS_W - 2, 20, 4);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(fmtPrice(effectiveSpot), chartRight + (CFG.PRICE_AXIS_W - 2) / 2, y + 4);
      }
    }

    // ── CANDLES — Zerodha Kite exact style ─────────────────────────────
    // Both bull and bear are solid filled rectangles.
    // Wick is 1px, same color as body. No glow, no stroke on body.
    for (let i = 0; i < visible.length; i++) {
      const c = visible[i];
      const x = idxToX(startIdx + i);
      if (x + cw / 2 < chartLeft || x - cw / 2 > chartRight) continue;

      const isBull = c.c >= c.o;
      const bodySize = Math.abs(c.c - c.o);
      const range = c.h - c.l || 1;
      const isDoji = bodySize / range < 0.05 && bodySize < 0.5; // very tiny body relative to range
      const halfW = Math.max(1, cw / 2);
      const bodyTop = priceToY(Math.max(c.o, c.c));
      const bodyBot = priceToY(Math.min(c.o, c.c));
      const bodyH   = Math.max(1, bodyBot - bodyTop);
      const wickTop = priceToY(c.h);
      const wickBot = priceToY(c.l);
      const color   = isDoji ? CFG.DOJI : isBull ? CFG.BULL_BODY : CFG.BEAR_BODY;

      // Upper wick
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, wickTop);
      ctx.lineTo(x, bodyTop);
      ctx.stroke();

      // Lower wick
      ctx.beginPath();
      ctx.moveTo(x, bodyBot);
      ctx.lineTo(x, wickBot);
      ctx.stroke();

      if (isDoji) {
        // Doji: horizontal line at close price
        ctx.strokeStyle = CFG.DOJI;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - halfW, bodyTop);
        ctx.lineTo(x + halfW, bodyTop);
        ctx.stroke();
      } else {
        // Solid filled body — same for both bull and bear
        ctx.fillStyle = color;
        ctx.fillRect(x - halfW, bodyTop, cw, bodyH);
      }
    }

    // ── VOLUME BARS ──────────────────────────────────────────────────
    {
      const volTop = chartBottom + 3;
      const volH = CFG.VOL_H - 3;

      // Separator line above volume
      ctx.strokeStyle = CFG.VOL_SEPARATOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(chartLeft, chartBottom);
      ctx.lineTo(chartRight, chartBottom);
      ctx.stroke();

      // Max volume for normalization
      let maxVol = 1;
      for (const c of visible) if (c.v > maxVol) maxVol = c.v;

      for (let i = 0; i < visible.length; i++) {
        const c = visible[i];
        const x = idxToX(startIdx + i);
        if (x + cw / 2 < chartLeft || x - cw / 2 > chartRight) continue;
        const isBullV = c.c >= c.o;
        const barH = Math.max(1, (c.v / maxVol) * volH);
        ctx.fillStyle = isBullV ? CFG.VOL_BULL : CFG.VOL_BEAR;
        ctx.fillRect(x - cw / 2, volTop + volH - barH, cw, barH);
      }

      // "VOL" label
      ctx.fillStyle = 'rgba(100,116,139,0.6)';
      ctx.font = '8px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('VOL', 3, volTop + 9);
    }

    // ── BOS / ChoCh MARKERS ─────────────────────────────────────────────
    // Rendering order: BOS first (less important), ChoCh on top (more important)
    // BOS  = break of market structure, continuation signal     → dashed, thinner
    // ChoCh= change of character, REVERSAL signal               → solid, thicker, bright
    for (const ev of structure) {
      const evX = idxToX(ev.idx);
      if (evX < chartLeft - 20 || evX > chartRight + 20) continue;
      const evY = priceToY(ev.level);
      if (evY < chartTop || evY > chartBottom) continue;

      const isBull = ev.type === 'BOS_BULL' || ev.type === 'CHOCH_BULL';
      const isChoCh = ev.type === 'CHOCH_BULL' || ev.type === 'CHOCH_BEAR';
      const color = ev.type === 'BOS_BULL'   ? CFG.BOS_BULL
                  : ev.type === 'BOS_BEAR'   ? CFG.BOS_BEAR
                  : ev.type === 'CHOCH_BULL' ? CFG.CHOCH_BULL
                  : CFG.CHOCH_BEAR;

      // Line extends to chartRight so it's always visible (not just 18 candles)
      // ChoCh: solid 2px;  BOS: medium dash 1px
      ctx.strokeStyle = color;
      ctx.lineWidth = isChoCh ? 2 : 1;
      ctx.setLineDash(isChoCh ? [] : [5, 4]);
      ctx.globalAlpha = isChoCh ? 0.9 : 0.7;
      ctx.beginPath();
      ctx.moveTo(evX, evY);
      ctx.lineTo(chartRight, evY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // Vertical tick at the break candle (shows exact break point)
      const tickLen = isChoCh ? 8 : 5;
      ctx.strokeStyle = color;
      ctx.lineWidth = isChoCh ? 2 : 1.5;
      ctx.globalAlpha = isChoCh ? 1 : 0.8;
      ctx.beginPath();
      ctx.moveTo(evX, evY - tickLen);
      ctx.lineTo(evX, evY + tickLen);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Arrow (triangle) above/below the tick
      const arrowSize = isChoCh ? 5 : 4;
      const arrowOffY = isChoCh ? 10 : 8;
      const arrowY = isBull ? evY + arrowOffY : evY - arrowOffY;
      ctx.fillStyle = color;
      ctx.globalAlpha = isChoCh ? 1 : 0.8;
      ctx.beginPath();
      if (isBull) {
        ctx.moveTo(evX, arrowY + arrowSize);
        ctx.lineTo(evX - arrowSize, arrowY - arrowSize);
        ctx.lineTo(evX + arrowSize, arrowY - arrowSize);
      } else {
        ctx.moveTo(evX, arrowY - arrowSize);
        ctx.lineTo(evX - arrowSize, arrowY + arrowSize);
        ctx.lineTo(evX + arrowSize, arrowY + arrowSize);
      }
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;

      // Label pill — solid for ChoCh (reversal), ghost for BOS (continuation)
      const label = isChoCh ? (isBull ? 'CHoCH ↑' : 'CHoCH ↓') : (isBull ? 'BOS ↑' : 'BOS ↓');
      ctx.font = `bold ${isChoCh ? 10 : 9}px sans-serif`;
      const lw = ctx.measureText(label).width + 12;
      const lh = isChoCh ? 17 : 15;
      const lx = evX + 8;
      const ly = isBull ? evY - lh - 4 : evY + 4;
      if (lx + lw < chartRight - 10) {
        if (isChoCh) {
          // Solid pill for ChoCh — high importance
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.95;
          roundRect(ctx, lx, ly, lw, lh, 4);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#0d1117';
        } else {
          // Ghost pill for BOS — lower importance
          ctx.fillStyle = `${color}28`;
          roundRect(ctx, lx, ly, lw, lh, 3);
          ctx.fill();
          ctx.fillStyle = color;
        }
        ctx.textAlign = 'left';
        ctx.fillText(label, lx + 6, ly + lh - 4);
      }
    }

    // ── INDUCEMENT MARKERS (Equal H/L) ──────────────────────────────
    for (const ind of inducements) {
      const indX = idxToX(ind.idx);
      if (indX < chartLeft || indX > chartRight) continue;
      const indY = priceToY(ind.level);
      if (indY < chartTop || indY > chartBottom) continue;

      const isHigh = ind.side === 'high';
      const offsetY = isHigh ? -10 : 10;
      const markerY = indY + offsetY;

      // Small diamond marker
      ctx.fillStyle = CFG.IND_COLOR;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(indX, markerY - 4);
      ctx.lineTo(indX + 3, markerY);
      ctx.lineTo(indX, markerY + 4);
      ctx.lineTo(indX - 3, markerY);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;

      // EQH / EQL text — bigger, clearer
      const tag = isHigh ? 'EQH' : 'EQL';
      ctx.fillStyle = CFG.IND_COLOR;
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.globalAlpha = 0.8;
      ctx.fillText(tag, indX, markerY + (isHigh ? -7 : 13));
      ctx.globalAlpha = 1;
    }

    // ── KEY LEVELS HUD — hidden (values shown on right axis price pills) ──
    // Uncomment the block below to restore the floating HUD overlay.
    /*
    {
      const hudItems: { label: string; val: number; color: string }[] = [
        { label: 'DAY H', val: levels.cdh, color: CFG.CDH },
        { label: 'DAY L', val: levels.cdl, color: CFG.CDL },
        { label: 'PREV H', val: levels.pdh, color: CFG.PDH },
        { label: 'PREV L', val: levels.pdl, color: CFG.PDL },
      ].filter(x => x.val > 0);
    }
    */

    // ── PRICE AXIS ──────────────────────────────────────────────────
    ctx.fillStyle = 'rgba(19,23,34,0.96)';
    ctx.fillRect(chartRight, 0, CFG.PRICE_AXIS_W, H);
    ctx.strokeStyle = CFG.AXIS_LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(chartRight, chartTop);
    ctx.lineTo(chartRight, chartBottom);
    ctx.stroke();

    ctx.fillStyle = CFG.AXIS_TEXT;
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    for (let i = 0; i <= gridSteps; i++) {
      const y = chartTop + (chartH / gridSteps) * i;
      const price = priceMax - (priceMax - priceMin) * (i / gridSteps);
      ctx.fillText(fmtPrice(price), W - 4, y + 3);
    }

    // ── TIME AXIS ───────────────────────────────────────────────────
    ctx.fillStyle = 'rgba(19,23,34,0.96)';
    ctx.fillRect(0, volBottom, chartRight, CFG.TIME_AXIS_H);
    ctx.strokeStyle = CFG.AXIS_LINE;
    ctx.beginPath();
    ctx.moveTo(chartLeft, volBottom);
    ctx.lineTo(chartRight, volBottom);
    ctx.stroke();

    ctx.fillStyle = CFG.AXIS_TEXT;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    const timeStep = Math.max(1, Math.floor(visible.length / 8));
    for (let i = 0; i < visible.length; i += timeStep) {
      const tx = idxToX(startIdx + i);
      if (tx < chartLeft + 20 || tx > chartRight - 20) continue;
      ctx.fillText(fmtTime(visible[i].t), tx, volBottom + 15);
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
      ctx.fillRect(chartRight, my - 10, CFG.PRICE_AXIS_W, 20);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(fmtPrice(crossPrice), chartRight + CFG.PRICE_AXIS_W / 2, my + 4);

      // Time cursor label — find nearest candle by x position
      const cIdx = Math.round((mx - centreX) / candleStep + centreIdx - startIdx);
      if (cIdx >= 0 && cIdx < visible.length) {
        const tLabel = fmtTime(visible[cIdx].t);
        const tw = ctx.measureText(tLabel).width + 10;
        ctx.fillStyle = CFG.CROSSHAIR_LABEL_BG;
        ctx.fillRect(mx - tw / 2, volBottom, tw, CFG.TIME_AXIS_H);
        ctx.fillStyle = '#e2e8f0';
        ctx.textAlign = 'center';
        ctx.fillText(tLabel, mx, volBottom + 16);

        // OHLCV tooltip — bigger, clearer
        const c = visible[cIdx];
        const info = `O:${fmtPrice(c.o)}  H:${fmtPrice(c.h)}  L:${fmtPrice(c.l)}  C:${fmtPrice(c.c)}  V:${fmtNum(c.v)}`;
        ctx.font = '10px monospace';
        const iw = ctx.measureText(info).width + 14;
        ctx.fillStyle = 'rgba(13,17,28,0.92)';
        roundRect(ctx, 4, chartTop + 2, iw, 18, 3);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 0.5;
        roundRect(ctx, 4, chartTop + 2, iw, 18, 3);
        ctx.stroke();
        ctx.fillStyle = '#cbd5e1';
        ctx.textAlign = 'left';
        ctx.fillText(info, 11, chartTop + 15);

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
          ctx.font = 'bold 10px sans-serif';
          const nw = ctx.measureText(nlText).width + 14;
          ctx.fillStyle = 'rgba(251,191,36,0.15)';
          roundRect(ctx, 4, chartTop + 22, nw, 18, 3);
          ctx.fill();
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 1;
          roundRect(ctx, 4, chartTop + 22, nw, 18, 3);
          ctx.stroke();
          ctx.fillStyle = '#fbbf24';
          ctx.textAlign = 'left';
          ctx.fillText(nlText, 11, chartTop + 34);
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
        {/* Maximize */}
        {onMaximize && (
          <button
            className="pointer-events-auto w-6 h-6 rounded bg-slate-800/80 border border-slate-600/50 text-slate-400 text-[10px] flex items-center justify-center hover:bg-indigo-600/70 hover:text-white hover:border-indigo-500/60 active:scale-95 transition-all"
            title="Maximize chart"
            onMouseDown={e => { e.stopPropagation(); onMaximize(); }}
          >⛶</button>
        )}
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
  const [timeframe, setTimeframe] = useState<'1h' | '15m' | '5m' | '3m'>('5m');
  const [expanded, setExpanded] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [modalChartH, setModalChartH] = useState(420);
  const chartH = expanded ? 560 : CFG.CHART_H;

  useEffect(() => {
    if (!isMaximized) return;
    const compute = () => {
      const vh = window.innerHeight;
      const modalH = Math.min(vh * 0.9, 880);
      setModalChartH(Math.max(260, modalH - 48));
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [isMaximized]);

  const [signalFlash, setSignalFlash] = useState(false);
  const prevSignalRef = useRef<string>('');

  // Derive candles for each TF:
  //   1H  = resample 5m × 12  (12×5m = 60m)
  //   15M = resample 3m × 5   (5×3m = 15m)
  //   5M  = direct 5m data
  //   3M  = direct 3m data
  const candles = useMemo(() => {
    if (!data) return [];
    if (timeframe === '1h')  return resampleCandles(data.candles5m ?? [], 12);
    if (timeframe === '15m') return resampleCandles(data.candles3m ?? [], 5);
    if (timeframe === '5m')  return data.candles5m ?? [];
    return data.candles3m ?? [];
  }, [data, timeframe]);

  const fvgList = useMemo(() => {
    if (!data) return [];
    if (timeframe === '1h' || timeframe === '5m')  return data.fvg5m ?? [];
    return data.fvg3m ?? [];
  }, [data, timeframe]);

  const obList = useMemo(() => {
    if (!data) return [];
    if (timeframe === '1h' || timeframe === '5m')  return data.ob5m ?? [];
    return data.ob3m ?? [];
  }, [data, timeframe]);

  const liqList = useMemo(() => {
    if (!data) return [];
    if (timeframe === '1h' || timeframe === '5m')  return data.liquidity5m ?? [];
    return data.liquidity3m ?? [];
  }, [data, timeframe]);

  // htfMode: OB/FVG zones drawn full-width when TF is aggregated beyond backend granularity
  const htfMode = timeframe === '1h' || timeframe === '15m';

  // ICT structure: BOS / ChoCh events computed client-side
  const structure = useMemo(() => computeStructure(candles, 4), [candles]);

  // Equal H/L inducement clusters
  const inducements = useMemo(() => computeInducements(candles, 4), [candles]);

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
            {([
              { tf: '1h',  label: '1H',  hint: 'MACRO' },
              { tf: '15m', label: '15M', hint: 'STRUCT' },
              { tf: '5m',  label: '5M',  hint: 'EXEC' },
              { tf: '3m',  label: '3M',  hint: 'ENTRY' },
            ] as const).map(({ tf, label, hint }, idx, arr) => {
              const active = timeframe === tf;
              const isLast = idx === arr.length - 1;
              return (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  title={hint}
                  className={`flex flex-col items-center px-2 py-0.5 text-[9px] font-bold transition-colors leading-tight ${
                    !isLast ? 'border-r border-slate-700/50' : ''
                  } ${
                    active
                      ? 'bg-indigo-500/20 text-indigo-300'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <span className="text-[10px]">{label}</span>
                  <span className={`text-[7px] font-normal ${active ? 'text-indigo-400/70' : 'text-slate-600'}`}>{hint}</span>
                </button>
              );
            })}
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
        onMaximize={() => setIsMaximized(true)}
        structure={structure}
        inducements={inducements}
        htfMode={htfMode}
      />

      {/* Maximized floating modal */}
      {isMaximized && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-6"
          style={{ background: 'rgba(2,6,23,0.78)', backdropFilter: 'blur(4px)' }}
          onClick={() => setIsMaximized(false)}
        >
          <div
            className="w-full max-w-5xl flex flex-col rounded-2xl overflow-hidden shadow-[0_8px_48px_rgba(0,0,0,0.75)] border border-slate-700/50"
            style={{ background: '#0d1117', maxHeight: 'min(90vh, 880px)' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 border-b border-slate-700/40 bg-slate-900/80 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-[3px] h-5 rounded-full bg-gradient-to-b from-indigo-400 to-purple-500 shrink-0" />
                <span className="text-[13px] font-bold text-white tracking-tight truncate">{name}</span>
                <span className="text-[10px] font-mono text-indigo-400/70 shrink-0">{timeframe.toUpperCase()}</span>
                <span className="hidden sm:inline text-[9px] text-slate-500 truncate">FVG · OB · BOS · ChoCH · Liq</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => setTimeframe(tf => tf === '5m' ? '3m' : tf === '3m' ? '15m' : tf === '15m' ? '1h' : '5m')}
                  className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800/80 border border-slate-600/40 text-slate-300 hover:bg-indigo-600/40 hover:text-indigo-200 hover:border-indigo-500/40 transition-all"
                  title="Switch timeframe"
                >{timeframe === '5m' ? '→ 3m' : timeframe === '3m' ? '→ 15m' : timeframe === '15m' ? '→ 1h' : '→ 5m'}</button>
                <button
                  onClick={() => setIsMaximized(false)}
                  className="w-7 h-7 rounded bg-slate-800/70 border border-slate-600/40 text-slate-400 text-xs flex items-center justify-center hover:bg-red-600/70 hover:text-white hover:border-red-500/50 active:scale-95 transition-all"
                  title="Close"
                >✕</button>
              </div>
            </div>
            {/* Chart — fills remaining modal height exactly */}
            <div className="shrink-0">
              <CandleChart
                candles={candles}
                fvg={fvgList}
                ob={obList}
                liquidity={liqList}
                levels={levels}
                spot={data.spot}
                liveSpot={liveSpot}
                chartHeight={modalChartH}
                structure={structure}
                inducements={inducements}
                htfMode={htfMode}
              />
            </div>
          </div>
        </div>
      )}

      {/* Footer Legend */}
      <div className="px-3 py-2 border-t border-slate-700/30 bg-slate-900/40">
        {/* Row 1: Level + Structure labels */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-1.5">
          <span className="flex items-center gap-1 text-[8px] font-bold" style={{ color: CFG.PDH }}>
            <span className="w-4 border-t-2 border-dashed inline-block" style={{ borderColor: CFG.PDH }} /> PREV H/L
          </span>
          <span className="flex items-center gap-1 text-[8px] font-bold" style={{ color: CFG.CDH }}>
            <span className="w-4 border-t-2 inline-block" style={{ borderColor: CFG.CDH }} /> DAY H/L
          </span>
          <span className="flex items-center gap-1 text-[8px] font-bold" style={{ color: CFG.BOS_BULL }}>
            <span className="text-[9px]">↑</span> BOS
          </span>
          <span className="flex items-center gap-1 text-[8px] font-bold" style={{ color: CFG.CHOCH_BULL }}>
            <span className="text-[9px]">↑</span> ChoCH
          </span>
          <span className="flex items-center gap-1 text-[8px] font-bold" style={{ color: CFG.IND_COLOR }}>
            ◆ EQH/EQL
          </span>
          <span className="flex items-center gap-1 text-[8px] font-bold" style={{ color: CFG.SUPPORT }}>
            <span className="w-3 border-t border-dotted inline-block" style={{ borderColor: CFG.SUPPORT }} /> SUP/RES
          </span>
        </div>
        {/* Row 2: Zone counts + structure count */}
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
          <span className="text-[8px] font-mono" style={{ color: CFG.BOS_BULL }}>
            BOS {structure.filter(e => e.type === 'BOS_BULL' || e.type === 'BOS_BEAR').length}
          </span>
          <span className="text-[8px] font-mono" style={{ color: CFG.CHOCH_BULL }}>
            ChoCH {structure.filter(e => e.type === 'CHOCH_BULL' || e.type === 'CHOCH_BEAR').length}
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
