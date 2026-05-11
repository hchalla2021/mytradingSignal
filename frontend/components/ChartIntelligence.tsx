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
} from '@/hooks/useChartIntelligence';
import { useMarketSocket } from '@/hooks/useMarketSocket';

// ── Chart constants ─────────────────────────────────────────────────────────

const CFG = {
  PRICE_AXIS_W: 72,
  TIME_AXIS_H: 24,
  PAD_TOP: 8,
  LEGEND_H: 38,        // top legend strip height (2 compact rows)
  VOL_H: 60,          // volume panel height reserved at bottom (above time axis)
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

  // ── Fractals — Williams 5-bar ─────────────────────────────────────
  FRACTAL_TOP: '#e8a030',   // bright amber  — bearish fractal high (▼)
  FRACTAL_BOT: '#30a8e8',   // bright sky    — bullish fractal low  (▲)

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

/**
 * Returns true only during NSE trading hours: Mon–Fri 09:15–15:30 IST.
 * All proximity-glow and pulse animations are suppressed outside this window.
 */
function isMarketOpen(): boolean {
  // IST = UTC+5:30
  const now   = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const ist   = new Date(utcMs + 5.5 * 3_600_000);
  const day   = ist.getDay();   // 0=Sun … 6=Sat
  if (day === 0 || day === 6) return false;
  const hhmm  = ist.getHours() * 100 + ist.getMinutes();
  return hhmm >= 915 && hhmm < 1530;
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return ''; }
}

function fmtNum(n: number): string {
  if (n <= 0) return '0';
  const fmt = (val: number, suffix: string) => {
    const s = val % 1 === 0 ? val.toFixed(0) : val.toFixed(1);
    return s.replace(/\.0$/, '') + suffix;
  };
  if (n >= 1_000_000_000) return fmt(n / 1_000_000_000, 'B');
  if (n >= 1_000_000)     return fmt(n / 1_000_000,     'M');
  if (n >= 1_000)         return fmt(n / 1_000,         'K');
  return n.toFixed(0);
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
  /** HIGH = large displacement (strong institutional move) | LOW = marginal break (possible fakeout) */
  quality: 'HIGH' | 'LOW';
  /** % distance close moved past the level — higher = stronger break */
  displacement: number;
}

interface InducementPoint {
  idx: number;    // rightmost candle of the equal-high/low cluster
  level: number;  // price of the equal high or low
  side: 'high' | 'low';
  /** How many swing points form this cluster (2 = STANDARD, 3+ = PREMIUM) */
  touches: number;
  /** PREMIUM = 3+ equal highs/lows (strong liquidity magnet) | STANDARD = 2 touches */
  quality: 'PREMIUM' | 'STANDARD';
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
          // Measure how far price closed beyond the level — larger = more institutional conviction
          const disp = sh.p > 0 ? (candles[i].c - sh.p) / sh.p : 0;
          // CHoCH needs a stronger break than BOS, but keep thresholds practical for live intraday charts.
          const threshold = isChoCh ? 0.0035 : 0.0025;
          const quality: 'HIGH' | 'LOW' = disp >= threshold ? 'HIGH' : 'LOW';
          events.push({ idx: i, level: sh.p, type: isChoCh ? 'CHOCH_BULL' : 'BOS_BULL', quality, displacement: disp });
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
          const disp = sl.p > 0 ? (sl.p - candles[i].c) / sl.p : 0;
          const threshold = isChoCh ? 0.0035 : 0.0025;
          const quality: 'HIGH' | 'LOW' = disp >= threshold ? 'HIGH' : 'LOW';
          events.push({ idx: i, level: sl.p, type: isChoCh ? 'CHOCH_BEAR' : 'BOS_BEAR', quality, displacement: disp });
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
        // Count ALL swing highs in this cluster (not just the pair)
        let touches = 2;
        for (let k = j + 1; k < highs.length; k++) {
          if (highs[k].idx - highs[i].idx > 60) break;
          if (Math.abs(highs[k].p - highs[i].p) / highs[i].p <= EQ) touches++;
        }
        const quality: 'PREMIUM' | 'STANDARD' = touches >= 3 ? 'PREMIUM' : 'STANDARD';
        pts.push({ idx: highs[j].idx, level: Math.max(highs[i].p, highs[j].p), side: 'high', touches, quality });
        break;
      }
    }
  }
  // Equal lows
  for (let i = 0; i < lows.length - 1; i++) {
    for (let j = i + 1; j < lows.length; j++) {
      if (lows[j].idx - lows[i].idx > 40) break;
      if (Math.abs(lows[i].p - lows[j].p) / lows[i].p <= EQ) {
        let touches = 2;
        for (let k = j + 1; k < lows.length; k++) {
          if (lows[k].idx - lows[i].idx > 60) break;
          if (Math.abs(lows[k].p - lows[i].p) / lows[i].p <= EQ) touches++;
        }
        const quality: 'PREMIUM' | 'STANDARD' = touches >= 3 ? 'PREMIUM' : 'STANDARD';
        pts.push({ idx: lows[j].idx, level: Math.min(lows[i].p, lows[j].p), side: 'low', touches, quality });
        break;
      }
    }
  }
  return pts.slice(-8);
}

/** Detect Williams 5-bar fractals (N bars on each side of the middle candle).
 *  Top fractal: middle candle high > all N neighbours on both sides.
 *  Bottom fractal: middle candle low < all N neighbours on both sides.
 */
interface FractalPoint {
  idx: number;      // index of the pivot (middle) candle
  price: number;    // high (top) or low (bottom) of the pivot candle
  type: 'top' | 'bottom';
}

type SetupDirection = 'bullish' | 'bearish';
type SetupModel = 'REVERSAL_SNIPER' | 'CONTINUATION_POWER' | 'FLIP_ENTRY';

interface PrioritySetup {
  priority: 1 | 2 | 3;
  model: SetupModel;
  direction: SetupDirection;
  zoneTop: number;
  zoneBottom: number;
  entryLine: number;
  triggerIdx: number;
  confidence: number;
}

function computeFractals(candles: Candle[], N = 2): FractalPoint[] {
  const pts: FractalPoint[] = [];
  if (candles.length < N * 2 + 1) return pts;
  for (let i = N; i < candles.length - N; i++) {
    let isTop = true, isBot = true;
    for (let j = i - N; j <= i + N; j++) {
      if (j === i) continue;
      if (candles[j].h >= candles[i].h) isTop = false;
      if (candles[j].l <= candles[i].l) isBot = false;
    }
    if (isTop) pts.push({ idx: i, price: candles[i].h, type: 'top' });
    if (isBot) pts.push({ idx: i, price: candles[i].l, type: 'bottom' });
  }
  return pts;
}

// ── Zone Prediction Engine — Institutional Break/Reject Forecaster ────────────
// Predicts whether price will BREAK through or REJECT from a zone/level.
// Factors: momentum, volume, structure context, zone freshness, candle body.
// Pure function — zero async, zero state. Called in RAF only when near spot.

interface ZonePrediction {
  outcome: 'BREAK' | 'REJECT' | 'WATCH';
  direction: 'UP' | 'DOWN';
  confidence: number; // 55–92
}

function predictZoneOutcome(
  zoneTop: number,
  zoneBottom: number,
  candles: Candle[],
  spot: number,
  structure: StructureEvent[],
  isFreshZone: boolean,
  touchCount = 1,
  partialFill = 0,
): ZonePrediction {
  if (candles.length < 10 || zoneTop <= 0)
    return { outcome: 'WATCH', direction: 'UP', confidence: 52 };

  const zoneMid     = (zoneTop + zoneBottom) / 2;
  const zoneIsAbove = zoneMid > spot;

  // ── Factor 1: Momentum (0–1) ─────────────────────────────────────────────
  // How many of the last 5 candles are moving TOWARD the zone?
  const LOOK   = Math.min(5, candles.length - 1);
  const recent = candles.slice(candles.length - 1 - LOOK, candles.length - 1);
  let bullCnt = 0, bearCnt = 0;
  for (const c of recent) {
    if (c.c > c.o) bullCnt++;
    else if (c.c < c.o) bearCnt++;
  }
  const approachRatio  = zoneIsAbove
    ? bullCnt / Math.max(recent.length, 1)
    : bearCnt / Math.max(recent.length, 1);
  const priceStart     = candles[Math.max(0, candles.length - 6)].c || spot;
  const priceDeltaPct  = priceStart > 0 ? (spot - priceStart) / priceStart : 0;
  const momentumDir    = zoneIsAbove ? priceDeltaPct : -priceDeltaPct; // +ve = toward zone
  const momentumScore  = Math.min(1, Math.max(0,
    approachRatio * 0.65 + Math.min(1, Math.max(-1, momentumDir * 40)) * 0.35,
  ));

  // ── Factor 2: Volume (0–1) ───────────────────────────────────────────────
  // High volume approach = institutional push = BREAK more likely
  const VOL_LOOK = Math.min(20, candles.length);
  const volSlice = candles.slice(Math.max(0, candles.length - VOL_LOOK));
  const avgVol   = volSlice.length > 0
    ? volSlice.reduce((s, c) => s + c.v, 0) / volSlice.length : 1;
  const lastV          = candles[candles.length - 1]?.v ?? 0;
  const prevV          = candles[candles.length - 2]?.v ?? lastV;
  const recentVolRatio = avgVol > 0 ? (lastV + prevV) / (2 * avgVol) : 1;
  // 2× avg → break score 1.0; 0.4× avg → break score 0
  const volumeScore = Math.min(1, Math.max(0, (recentVolRatio - 0.4) / 1.6));

  // ── Factor 3: Structure context (0–1) ────────────────────────────────────
  // BOS in approach direction = continuation = BREAK
  // CHoCH opposing           = reversal      = REJECT
  let structureScore = 0.50;
  const recentStr = structure.filter(ev => ev.quality === 'HIGH').slice(-3);
  if (recentStr.length > 0) {
    const last   = recentStr[recentStr.length - 1];
    const isBull = last.type === 'BOS_BULL' || last.type === 'CHOCH_BULL';
    const isBos  = last.type === 'BOS_BULL' || last.type === 'BOS_BEAR';
    if (zoneIsAbove) {
      // Zone above: bullish momentum needed to reach/break
      if (isBos  &&  isBull)  structureScore = 0.82; // BOS up → continuation → BREAK
      else if (!isBos && isBull)  structureScore = 0.70; // CHoCH up → reversal up → BREAK
      else if (isBos  && !isBull) structureScore = 0.30; // BOS down → moving away
      else                        structureScore = 0.22; // CHoCH down → reversal down
    } else {
      // Zone below: bearish momentum needed
      if (isBos  && !isBull)  structureScore = 0.82;
      else if (!isBos && !isBull) structureScore = 0.70;
      else if (isBos  &&  isBull) structureScore = 0.30;
      else                        structureScore = 0.22;
    }
  }

  // ── Factor 4: Zone freshness (0–1) ───────────────────────────────────────
  // Fresh first touch → REJECT (institutional memory)
  // Repeated tests    → BREAK (liquidity thinning, zone weakening)
  let freshnessScore = 0.50;
  if (isFreshZone && partialFill < 0.05 && touchCount <= 1) {
    freshnessScore = 0.18;
  } else if (touchCount >= 3 || partialFill >= 0.40) {
    freshnessScore = 0.80;
  } else if (touchCount === 2 || partialFill >= 0.20) {
    freshnessScore = 0.62;
  }

  // ── Factor 5: Last candle body strength (0–1) ────────────────────────────
  // Full body toward zone = BREAK; wick-dominated candle = REJECT
  const lastC = candles[candles.length - 1];
  let bodyScore = 0.50;
  if (lastC && lastC.o > 0) {
    const body      = Math.abs(lastC.c - lastC.o);
    const range     = Math.max(lastC.h - lastC.l, 0.001);
    const bodyRatio = body / range;
    const aligned   = zoneIsAbove ? lastC.c > lastC.o : lastC.c < lastC.o;
    bodyScore = aligned
      ? Math.min(1, bodyRatio * 1.2)
      : Math.max(0, 1 - bodyRatio * 1.2);
  }

  // ── Weighted composite break score (0–1) ─────────────────────────────────
  const breakScore =
    momentumScore  * 0.30 +
    volumeScore    * 0.25 +
    structureScore * 0.25 +
    freshnessScore * 0.15 +
    bodyScore      * 0.05;

  // ── Classify outcome ─────────────────────────────────────────────────────
  const outcome: ZonePrediction['outcome'] =
    breakScore >= 0.60 ? 'BREAK' :
    breakScore <= 0.40 ? 'REJECT' : 'WATCH';

  // Direction: break = through zone; reject = bounce back
  const direction: 'UP' | 'DOWN' =
    outcome === 'BREAK'
      ? (zoneIsAbove ? 'UP' : 'DOWN')
      : (zoneIsAbove ? 'DOWN' : 'UP');

  // Confidence: distance from neutral 50% → maps to 55–92%
  const dist       = Math.abs(breakScore - 0.5);
  const confidence = Math.round(55 + dist * 74);

  return { outcome, direction, confidence };
}

function getCandle(candles: Candle[], idx: number): Candle | null {
  if (idx < 0 || idx >= candles.length) return null;
  return candles[idx];
}

function isStrongDisplacement(candle: Candle | null): boolean {
  if (!candle || candle.o <= 0) return false;
  const body = Math.abs(candle.c - candle.o);
  const range = Math.max(candle.h - candle.l, 0.0001);
  const bodyPct = body / candle.o;
  const bodyToRange = body / range;
  // STRICT: body must be ≥0.5% of price AND fill ≥70% of the candle range
  return bodyPct >= 0.005 && bodyToRange >= 0.70;
}

function normalizeZone(top: number, bottom: number): { top: number; bottom: number } {
  return top >= bottom ? { top, bottom } : { top: bottom, bottom: top };
}

function overlapZone(
  aTop: number,
  aBottom: number,
  bTop: number,
  bBottom: number,
): { top: number; bottom: number } | null {
  const a = normalizeZone(aTop, aBottom);
  const b = normalizeZone(bTop, bBottom);
  const top = Math.min(a.top, b.top);
  const bottom = Math.max(a.bottom, b.bottom);
  if (top <= bottom) return null;
  return { top, bottom };
}

function modelConfidence(parts: number[]): number {
  const score = parts.reduce((s, p) => s + p, 0);
  return Math.max(55, Math.min(95, Math.round(score / parts.length)));
}

// ── COMBINATION MATCH LOGIC ─────────────────────────────────────────────────
// Detect ALL valid setup combinations (P1/P2/P3) and return a deduped list.
// Rendering layer draws each match line so users can see every qualified setup.
// ─────────────────────────────────────────────────────────────────────────────
function findPrioritySetups(
  candles: Candle[],
  fvg: FVG[],
  ob: OrderBlock[],
  liquidity: Liquidity[],
  structure: StructureEvent[],
): PrioritySetup[] {
  if (candles.length < 30) return [];

  const setups: PrioritySetup[] = [];

  const lastIdx = candles.length - 1;

  const byRecent = <T extends { startIdx?: number; idx?: number; sweepIdx?: number | null }>(arr: T[]) =>
    [...arr].sort((a, b) => ((b.startIdx ?? b.idx ?? b.sweepIdx ?? -1) - (a.startIdx ?? a.idx ?? a.sweepIdx ?? -1)));

  // STRICT sweep: PREMIUM liquidity only (3+ touches), swept within 12 candles of the structure break
  const findSweep = (dir: SetupDirection, beforeIdx: number): Liquidity | null => {
    const liqType = dir === 'bullish' ? 'buy_side' : 'sell_side';
    for (const lq of byRecent(liquidity.filter(l => l.swept && l.type === liqType && (l.sweepIdx ?? -1) < beforeIdx))) {
      const sIdx = lq.sweepIdx ?? -1;
      if (sIdx < 0) continue;
      if (beforeIdx - sIdx > 12) continue;          // tightened: was 24
      if (lq.touchCount < 3) continue;             // tightened: was 2 (PREMIUM sweep only)
      return lq;
    }
    return null;
  };

  // Overlap must be at least 0.15% wide to be a meaningful confluence zone
  const isWideEnough = (zone: { top: number; bottom: number }): boolean =>
    (zone.top - zone.bottom) / zone.bottom >= 0.0015;

  const fvgDir = (dir: SetupDirection) => (dir === 'bullish' ? 'bullish' : 'bearish');
  const oppositeFvgDir = (dir: SetupDirection) => (dir === 'bullish' ? 'bearish' : 'bullish');

  // Only consider structure events within the last 20 candles (fresh breaks only)
  const chochCandidates = byRecent(
    structure.filter(
      ev =>
        ev.quality === 'HIGH' &&
        ev.displacement >= 0.003 &&              // STRICT: ≥0.3% displacement through level
        lastIdx - ev.idx <= 20 &&               // STRICT: fresh — within last 20 candles
        (ev.type === 'CHOCH_BULL' || ev.type === 'CHOCH_BEAR'),
    ),
  );

  // ── P1: REVERSAL SNIPER ─────────────────────────────────────────────────
  // ALL 5 conditions must be STRONG: sweep + displacement + PREMIUM FVG + IFVG confirm + PREMIUM OB overlap
  for (const ev of chochCandidates) {
    const direction: SetupDirection = ev.type === 'CHOCH_BULL' ? 'bullish' : 'bearish';
    const sweep = findSweep(direction, ev.idx);
    if (!sweep) continue;
    if (!isStrongDisplacement(getCandle(candles, ev.idx))) continue;

    // FVG: PREMIUM quality only, unfilled, within 8 candles of CHoCH
    const ifvg = byRecent(
      fvg.filter(
        z =>
          !z.filled &&
          z.quality === 'PREMIUM' &&             // STRICT: PREMIUM FVG only
          z.type === fvgDir(direction) &&
          z.startIdx > ev.idx &&
          z.startIdx - ev.idx <= 8,             // tightened: was 14
      ),
    )[0];
    if (!ifvg) continue;

    // IFVG confirmation: an opposite FVG that was invalidated (filled) within 15 candles before the IFVG
    const invalidatedFvg = fvg.some(
      z =>
        z.filled &&
        z.type === oppositeFvgDir(direction) &&
        z.startIdx >= ev.idx - 15 &&           // tightened: was 35
        z.startIdx < ifvg.startIdx,
    );
    if (!invalidatedFvg) continue;

    // OB: PREMIUM quality only, unmitigated, formed within 8 candles of CHoCH
    const overlapMatch = byRecent(
      ob.filter(
        zone =>
          !zone.mitigated &&
          zone.quality === 'PREMIUM' &&          // STRICT: PREMIUM OB only
          zone.type === fvgDir(direction) &&
          zone.startIdx >= ev.idx - 8,          // tightened: was 20
      ),
    )
      .map(zone => overlapZone(ifvg.top, ifvg.bottom, zone.top, zone.bottom))
      .find(z => z != null && isWideEnough(z)) ?? null;   // STRICT: meaningful overlap width

    if (!overlapMatch) continue;

    setups.push({
      priority: 1,
      model: 'REVERSAL_SNIPER',
      direction,
      zoneTop: overlapMatch.top,
      zoneBottom: overlapMatch.bottom,
      entryLine: (overlapMatch.top + overlapMatch.bottom) / 2,
      triggerIdx: ev.idx,
      confidence: modelConfidence([90, 88, 86, 91, 90]),
    });
  }

  // Only consider BOS events within the last 20 candles
  const bosCandidates = byRecent(
    structure.filter(
      ev =>
        ev.quality === 'HIGH' &&
        ev.displacement >= 0.003 &&              // STRICT: ≥0.3% displacement
        lastIdx - ev.idx <= 20 &&               // STRICT: fresh
        (ev.type === 'BOS_BULL' || ev.type === 'BOS_BEAR'),
    ),
  );

  // ── P2: CONTINUATION POWER ─────────────────────────────────────────────
  // ALL 4 conditions must be STRONG: sweep + displacement + PREMIUM clean FVG + PREMIUM OB overlap
  for (const ev of bosCandidates) {
    const direction: SetupDirection = ev.type === 'BOS_BULL' ? 'bullish' : 'bearish';
    const sweep = findSweep(direction, ev.idx);
    if (!sweep) continue;
    if (!isStrongDisplacement(getCandle(candles, ev.idx))) continue;

    // FVG: PREMIUM quality, unfilled, ≤10% touched, within 8 candles of BOS
    const cleanFvg = byRecent(
      fvg.filter(
        z =>
          !z.filled &&
          z.quality === 'PREMIUM' &&             // STRICT: PREMIUM FVG only
          z.type === fvgDir(direction) &&
          z.startIdx > ev.idx &&
          z.startIdx - ev.idx <= 8 &&           // tightened: was 14
          (z.partialFill ?? 0) <= 0.10,         // tightened: was 0.35 — nearly pristine gap
      ),
    )[0];
    if (!cleanFvg) continue;

    // OB: PREMIUM quality only, unmitigated, formed within 8 candles of BOS
    const overlapMatch = byRecent(
      ob.filter(
        zone =>
          !zone.mitigated &&
          zone.quality === 'PREMIUM' &&          // STRICT: PREMIUM OB only
          zone.type === fvgDir(direction) &&
          zone.startIdx >= ev.idx - 8,          // tightened: was 20
      ),
    )
      .map(zone => overlapZone(cleanFvg.top, cleanFvg.bottom, zone.top, zone.bottom))
      .find(z => z != null && isWideEnough(z)) ?? null;   // STRICT: meaningful overlap width

    if (!overlapMatch) continue;

    setups.push({
      priority: 2,
      model: 'CONTINUATION_POWER',
      direction,
      zoneTop: overlapMatch.top,
      zoneBottom: overlapMatch.bottom,
      entryLine: (overlapMatch.top + overlapMatch.bottom) / 2,
      triggerIdx: ev.idx,
      confidence: modelConfidence([84, 83, 82, 85]),
    });
  }

  // ── P3: FLIP ENTRY ──────────────────────────────────────────────────────
  // ALL 4 conditions must be STRONG: sweep + displacement + filled opp FVG + PREMIUM fresh IFVG (untouched)
  for (const ev of chochCandidates) {
    const direction: SetupDirection = ev.type === 'CHOCH_BULL' ? 'bullish' : 'bearish';
    const sweep = findSweep(direction, ev.idx);
    if (!sweep) continue;
    if (!isStrongDisplacement(getCandle(candles, ev.idx))) continue;

    // Broken opposite FVG: filled within 5 candles of CHoCH
    const brokenFvg = byRecent(
      fvg.filter(
        z =>
          z.filled &&
          z.type === oppositeFvgDir(direction) &&
          z.startIdx >= ev.idx &&
          z.startIdx - ev.idx <= 5,             // tightened: was 8
      ),
    )[0];
    if (!brokenFvg) continue;

    // Fresh IFVG: PREMIUM quality, completely untouched (partialFill === 0), within 5 candles of broken FVG
    const ifvg = byRecent(
      fvg.filter(
        z =>
          !z.filled &&
          z.quality === 'PREMIUM' &&             // STRICT: PREMIUM IFVG only
          (z.partialFill ?? 0) === 0 &&          // STRICT: zero fill — completely fresh
          z.type === fvgDir(direction) &&
          z.startIdx > brokenFvg.startIdx &&
          z.startIdx - brokenFvg.startIdx <= 5, // tightened: was 8
      ),
    )[0];
    if (!ifvg) continue;

    setups.push({
      priority: 3,
      model: 'FLIP_ENTRY',
      direction,
      zoneTop: ifvg.top,
      zoneBottom: ifvg.bottom,
      entryLine: (ifvg.top + ifvg.bottom) / 2,
      triggerIdx: ev.idx,
      confidence: modelConfidence([76, 74, 78]),
    });
  }

  // Deduplicate nearly identical lines to avoid visual stacking noise.
  const ordered = [...setups].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.triggerIdx !== b.triggerIdx) return b.triggerIdx - a.triggerIdx;
    return b.confidence - a.confidence;
  });

  const deduped: PrioritySetup[] = [];
  for (const s of ordered) {
    const isDuplicate = deduped.some(existing => {
      if (existing.priority !== s.priority) return false;
      if (existing.direction !== s.direction) return false;
      const base = Math.max(Math.abs(existing.entryLine), 1);
      return Math.abs(existing.entryLine - s.entryLine) / base <= 0.0006;
    });
    if (!isDuplicate) deduped.push(s);
  }

  return deduped.slice(0, 4);
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
  fractals?: FractalPoint[];
  htfMode?: boolean;
  /** Changes only on symbol / timeframe switch — resets Y-axis without restarting RAF */
  chartKey?: string;
  /** LIVE = fresh Zerodha data; CACHED or MARKET_CLOSED = stale — never distort candle H/L */
  dataSource?: string;
  prioritySetups?: PrioritySetup[];
}

const CandleChart = memo<CandleChartProps>(({ candles, fvg, ob, liquidity, levels, spot, liveSpot, chartHeight, onMaximize, structure = [], inducements = [], fractals = [], htfMode = false, chartKey = '', dataSource = 'LIVE', prioritySetups = [] }) => {
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

  // Zoom levels
  const candleWRef = useRef(CFG.CANDLE_W);    // current candle body width (zoom)
  const candleGapRef = useRef(CFG.CANDLE_GAP); // current gap between candles
  const vScaleRef = useRef(1.0);               // vertical price range multiplier (>1 = zoomed in)

  // Live spot ref — updated every tick, read by RAF without recreating callbacks
  const liveSpotRef = useRef<number>(liveSpot ?? spot);
  useEffect(() => { liveSpotRef.current = liveSpot ?? spot; }, [liveSpot, spot]);

  // ── Data refs — updated at render time so RAF loop never restarts on data change ──
  const candlesRef      = useRef(candles);
  const fvgRef          = useRef(fvg);
  const obRef           = useRef(ob);
  const liquidityRef    = useRef(liquidity);
  const levelsRef       = useRef(levels);
  const spotRef         = useRef(spot);
  const structureRef    = useRef(structure);
  const inducementsRef  = useRef(inducements);
  const fractalsRef     = useRef(fractals);
  const htfModeRef      = useRef(htfMode);
  const chartHeightRef  = useRef(chartHeight);
  const dataSourceRef   = useRef(dataSource);
  const prioritySetupsRef = useRef(prioritySetups);
  candlesRef.current     = candles;
  fvgRef.current         = fvg;
  obRef.current          = ob;
  liquidityRef.current   = liquidity;
  levelsRef.current      = levels;
  spotRef.current        = spot;
  structureRef.current   = structure;
  inducementsRef.current = inducements;
  fractalsRef.current    = fractals;
  htfModeRef.current     = htfMode;
  chartHeightRef.current = chartHeight;
  dataSourceRef.current  = dataSource;
  prioritySetupsRef.current = prioritySetups;

  // ── Render scheduler refs (performance) ───────────────────────────────
  // dirtyRef: render only when scene changed (data/interaction/resize)
  // lastFrameTsRef: frame limiter to avoid wasting 60fps when idle
  const dirtyRef = useRef(true);
  const lastFrameTsRef = useRef(0);
  const markDirty = useCallback(() => {
    dirtyRef.current = true;
  }, []);

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
    // Read latest data from refs — avoids recreating this callback on every data update
    const candles    = candlesRef.current;
    const fvg        = fvgRef.current;
    const ob         = obRef.current;
    const liquidity  = liquidityRef.current;
    const levels     = levelsRef.current;
    const spot       = spotRef.current;
    const structure  = structureRef.current;
    const inducements = inducementsRef.current;
    const htfMode    = htfModeRef.current;
    const chartHeight = chartHeightRef.current;
    const dataSource = dataSourceRef.current;
    const prioritySetups = prioritySetupsRef.current;
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

    // Guard: container not yet laid out (first paint) — bail, RAF will retry
    if (W <= 0 || chartW <= 0 || chartH <= 0) return;

    const cw = candleWRef.current;
    const cg = candleGapRef.current;
    const candleStep = cw + cg;

    // ── Dual-mode anchor: CENTER when candles fit, TradingView-78% when they overflow ──
    //
    // Problem: a fixed 78% anchor leaves a huge empty black area on the left for short
    // history timeframes (3M = 5 candles, 5M = 20 candles early session).
    //
    // Solution — two anchor candidates, pick the smaller (further left):
    //
    //   centeredAnchorX  — places the entire candle block perfectly centered in chartW.
    //                       Formula: chartW/2 + (n-1)*step/2
    //                       → for 5 candles: candles span from chartW/2-2*step to chartW/2+2*step
    //                       → for 20 candles: spans chartW/2±9.5*step
    //   defaultAnchorX   — classic TradingView: latest candle at 78% from left.
    //
    //   When n is small  → centeredAnchorX < defaultAnchorX → use centeredAnchorX (CENTERED)
    //   When n overflows → centeredAnchorX > defaultAnchorX → use defaultAnchorX (TV-MODE)
    //
    // Crossover at: chartW/2 + (n-1)*step/2 = chartW*0.78
    //   → (n-1)*step = chartW*0.56  → on mobile(358px,step=10): n≈21
    //
    // scroll=0  → latest candle at anchorX
    // scroll+N  → pan left, older candles come into view
    const maxScroll = Math.max(0, candles.length - 1);
    scrollRef.current = Math.max(0, Math.min(scrollRef.current, maxScroll));

    // Index of the candle pinned to anchorX
    const latestIdx = candles.length - 1;
    const centreIdx = latestIdx - scrollRef.current;

    // centeredAnchorX: position of latest candle when entire block is centered
    // Derivation: center of block = chartLeft + chartW/2
    //             center = (idxToX(0) + idxToX(n-1)) / 2 = anchorX - (n-1)*step/2
    //             → anchorX = chartLeft + chartW/2 + (n-1)*step/2
    const centeredAnchorX = chartLeft + chartW / 2 + (latestIdx * candleStep) / 2;
    // defaultAnchorX: TradingView-style — latest candle at 78% from left
    const defaultAnchorX  = chartLeft + Math.round(chartW * 0.78);
    // Use centered when few candles; TradingView when many
    const anchorX = Math.min(centeredAnchorX, defaultAnchorX) - pixelPanRef.current;

    // idxToX: positions ANY candle relative to the anchor
    const idxToX = (arrayIdx: number) => anchorX + (arrayIdx - centreIdx) * candleStep;

    // Compute which candle indices are actually visible (within chartLeft..chartRight)
    const firstVisibleIdx = Math.max(0, Math.floor((chartLeft - anchorX) / candleStep) + centreIdx - 1);
    const lastVisibleIdx  = Math.min(candles.length - 1, Math.ceil((chartRight - anchorX) / candleStep) + centreIdx + 1);
    const startIdx = firstVisibleIdx;
    const endIdx   = lastVisibleIdx + 1;

    // Patch last candle close with live spot (no mutation).
    // H/L of the last candle are ONLY extended when dataSource === 'LIVE':
    //   - LIVE   : Zerodha data is fresh — safe to extend the current live bar
    //   - CACHED : data is stale (fetched hours ago) — extending H/L creates monster wicks
    //             (e.g. cached H=79,100 + live spot=77,836 → 1264 pt red candle)
    // The current-price dashed line (drawn later) always reflects liveSpot regardless.
    const rawSlice = candles.slice(startIdx, endIdx);
    const visible: Candle[] = rawSlice.map((c, si) => {
      const arrayIdx = startIdx + si;
      if (arrayIdx === candles.length - 1 && effectiveSpot > 0) {
        const isLive = dataSource === 'LIVE';
        const drift  = c.o > 0 ? Math.abs(effectiveSpot - c.o) / c.o : 1;
        const safeToExtend = isLive && drift < 0.015;
        if (safeToExtend) {
          return { ...c, c: effectiveSpot, h: Math.max(c.h, effectiveSpot), l: Math.min(c.l, effectiveSpot) };
        }
        // Cached/closed data: only update visual close, never touch H/L
        return { ...c, c: effectiveSpot };
      }
      return c;
    });
    if (visible.length === 0) return;

    // ── Strong-only rendering filters ─────────────────────────────────────
    // Hide weak/noisy parameters; only high-conviction structures are drawn.
    const strongTouchPct = 0.0015; // 0.15%
    const recentCandles = candles.slice(Math.max(0, candles.length - 160));
    const levelTouchCount = (level: number): number => {
      if (level <= 0) return 0;
      let touches = 0;
      for (const c of recentCandles) {
        if (
          (c.h >= level && c.l <= level) ||
          near(c.h, level, strongTouchPct) ||
          near(c.l, level, strongTouchPct)
        ) touches++;
      }
      return touches;
    };
    const isStrongReferenceLevel = (level: number): boolean => {
      if (level <= 0) return false;
      const distPct = Math.abs(effectiveSpot - level) / level;
      return distPct <= 0.03 || levelTouchCount(level) >= 1;
    };
    const isStrongSR = (level: number): boolean => level > 0 && levelTouchCount(level) >= 2;

    // ── Zone Lifecycle Filters — Create → Track → Degrade → Delete ──────────
    // Each zone passes through: FRESH → 1ST TOUCH → WEAKENED → CONSUMED (deleted).
    // Only actionable zones are shown. Used zones are removed, not just faded.

    const strongFvg = fvg.filter(f => {
      if (f.filled) return false;                                    // shown separately as mitigated
      const partial = f.partialFill ?? 0;
      if (partial > 0.60) return false;                             // heavily consumed → shown as mitigated
      const q = f.quality ?? (f.strength >= 0.80 ? 'PREMIUM' : f.strength >= 0.55 ? 'STANDARD' : 'WEAK');
      if (q === 'WEAK') return false;
      const freshEnough = (f.candles_ago ?? 999) <= 80;
      const sizeable = Math.abs(f.top - f.bottom) >= (effectiveSpot * 0.0008);
      return freshEnough && sizeable;
    });

    // Mitigated FVG: filled OR heavily consumed (>60%) — shown as historical reference, dimmed
    const mitigatedFvg = fvg.filter(f => {
      const q = f.quality ?? (f.strength >= 0.80 ? 'PREMIUM' : f.strength >= 0.55 ? 'STANDARD' : 'WEAK');
      if (q === 'WEAK') return false;
      const recentEnough = (f.candles_ago ?? 999) <= 40;           // only recent mitigations
      const sizeable = Math.abs(f.top - f.bottom) >= (effectiveSpot * 0.0008);
      const isMitigated = f.filled || (f.partialFill ?? 0) > 0.60;
      return isMitigated && recentEnough && sizeable;
    });

    const strongOb = ob.filter(o => {
      if (o.mitigated) return false;                                // shown separately as mitigated
      const q = o.quality ?? (o.strength >= 0.80 ? 'PREMIUM' : o.strength >= 0.45 ? 'STANDARD' : 'WEAK');
      if (q === 'WEAK') return false;
      // FIX: Extended from 80→160 candles (~2 trading days on 5m TF).
      // 80 candles = ~6.7 h — too short for structural OBs below support from a prior
      // session that price has not yet revisited. These were being silently hidden.
      const freshEnough = (o.candles_ago ?? 999) <= 160;
      return freshEnough;
    });

    // Mitigated OB: touched/broken — shown as historical reference, dimmed with strikethrough
    const mitigatedOb = ob.filter(o => {
      if (!o.mitigated) return false;
      const q = o.quality ?? (o.strength >= 0.80 ? 'PREMIUM' : o.strength >= 0.45 ? 'STANDARD' : 'WEAK');
      if (q === 'WEAK') return false;
      const recentEnough = (o.candles_ago ?? 999) <= 40;           // only recent mitigations
      return recentEnough;
    });

    const strongLiquidity = liquidity.filter(lq => {
      const recentSweep = lq.swept && (lq.sweepIdx != null) && ((candles.length - 1) - lq.sweepIdx <= 8);
      if (lq.swept && !recentSweep) return false;                   // keep only fresh sweeps for visibility
      const q = lq.quality ?? (lq.touchCount >= 3 ? 'PREMIUM' : lq.touchCount >= 2 ? 'STANDARD' : 'WEAK');
      return q !== 'WEAK';
    });

    const strongStructure = structure.filter(ev => {
      if ((ev.quality ?? 'LOW') === 'HIGH') return true;
      // Keep meaningful LOW events too; renderer already dims LOW quality via alpha.
      return (ev.displacement ?? 0) >= 0.0018;
    });
    const strongInducements = inducements.filter(ind => (ind.quality ?? (ind.touches >= 3 ? 'PREMIUM' : 'STANDARD')) === 'PREMIUM' || ind.touches >= 3);

    const strongLevels = {
      pdh: isStrongReferenceLevel(levels.pdh) ? levels.pdh : 0,
      pdl: isStrongReferenceLevel(levels.pdl) ? levels.pdl : 0,
      cdh: isStrongReferenceLevel(levels.cdh) ? levels.cdh : 0,
      cdl: isStrongReferenceLevel(levels.cdl) ? levels.cdl : 0,
      support: levels.support.filter(isStrongSR),
      resistance: levels.resistance.filter(isStrongSR),
    };

    // ── Price range — driven by CANDLES ONLY so Y-axis stays stable ──
    // Key levels outside the visible range are simply clipped (not drawn).
    // Including distant PDH/PDL in the range made candles tiny + caused jitter.
    // Skip malformed candles (l<=0, h<=0, l>h) — these come from backend edge-cases
    // and would massively distort the Y-axis scale.
    let priceMin = Infinity, priceMax = -Infinity;
    for (const c of visible) {
      if (c.l > 0 && c.h > 0 && c.l <= c.h) {
        if (c.h > priceMax) priceMax = c.h;
        if (c.l < priceMin) priceMin = c.l;
      }
    }
    if (priceMin === Infinity || priceMax === -Infinity) return; // all candles malformed
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

    // ── Approach detection — pulsing glow when price is near a zone ──────────
    // Glow is ONLY active during NSE market hours (Mon–Fri 09:15–15:30 IST).
    const _mktOpen = isMarketOpen();
    const _t  = _mktOpen ? Date.now() : 0;
    const _pF = _mktOpen ? 0.55 + 0.45 * Math.sin(_t / 280) : 0;   // ~3.5 Hz fast pulse (0.55–1.0) · 0 off-market
    const _pM = _mktOpen ? 0.55 + 0.45 * Math.sin(_t / 420) : 0;   // ~2.4 Hz med  pulse
    const HOT_D  = 0.002;  // 0.2% — hot  (candle wick essentially touching the level)
    const WARM_D = 0.005;  // 0.5% — warm (visibly heading toward the level)

    // Proximity for a price zone [bot … top]
    const zoneProx = (top: number, bot: number): 'hot' | 'warm' | 'off' => {
      if (!_mktOpen) return 'off';
      if (effectiveSpot >= bot && effectiveSpot <= top) return 'hot';
      const d = effectiveSpot > top
        ? (effectiveSpot - top) / top
        : bot > 0 ? (bot - effectiveSpot) / bot : 1;
      if (d < HOT_D)  return 'hot';
      if (d < WARM_D) return 'warm';
      return 'off';
    };

    // Proximity for a single horizontal price line
    const lineProx = (level: number): 'hot' | 'warm' | 'off' => {
      if (!_mktOpen || level <= 0) return 'off';
      const d = Math.abs(effectiveSpot - level) / level;
      if (d < HOT_D)  return 'hot';
      if (d < WARM_D) return 'warm';
      return 'off';
    };

    // ── Predictive tag helpers ─────────────────────────────────────────────
    // shouldPredict: returns true only when price is within 2% of zone AND market is open.
    // Keeps prediction draws limited to actionable proximity — never clutters distant zones.
    const shouldPredict = (top: number, bot: number): boolean => {
      if (!_mktOpen || effectiveSpot <= 0) return false;
      const mid = top > 0 ? (top + bot) / 2 : 0;
      return mid > 0 && Math.abs(effectiveSpot - mid) / mid <= 0.02;
    };
    // drawPredTag: renders BREAK▲/REJECT▼/WATCH~ confidence% pill using the slot system.
    // Color: emerald = BREAK, red = REJECT, amber = WATCH.
    const drawPredTag = (anchorY: number, pred: ZonePrediction, above: boolean) => {
      const col = pred.outcome === 'BREAK'  ? '#34d399'
                : pred.outcome === 'REJECT' ? '#f87171'
                : '#fbbf24';
      const arr = pred.direction === 'UP' ? '▲' : '▼';
      drawLineTag(anchorY, `${pred.outcome}${arr} ${pred.confidence}%`, col, above);
    };

    // Alert banner collector — zones push here as they are drawn
    const alertZones: Array<{ label: string; color: string }> = [];

    // ── Inline label helper — draws a pill directly at its zone/candle position ──
    // cx/cy = centre of the pill; auto-clamped to stay within chart bounds.
    const drawLabel = (cx: number, cy: number, text: string, fg: string, bg: string, bold = true) => {
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.font = bold ? 'bold 9px sans-serif' : '9px monospace';
      const tw = ctx.measureText(text).width;
      const lw = tw + 10; const lh = 15;
      const lx = Math.max(chartLeft + 1, Math.min(chartRight - lw - 1, cx - lw / 2));
      const ly = Math.max(chartTop + 1, Math.min(chartBottom - lh - 1, cy - lh / 2));
      roundRect(ctx, lx, ly, lw, lh, 3);
      ctx.fillStyle = bg; ctx.globalAlpha = 1; ctx.fill();
      ctx.fillStyle = fg; ctx.textAlign = 'left';
      ctx.fillText(text, lx + 4, ly + lh - 4);
      ctx.restore();
    };

    // ── Zone label system — above/below the line, never ON the line ─────────
    // ONE shared Y pool — right-side labels and left-side count pills
    // both register into it, so they can NEVER land at the same row.
    const _usedTagY: number[] = [];
    const _TAG_H = 15;   // slightly taller for 10px font
    // Walks away from preferred Y (up to 12 steps) until a free slot is found.
    // min_gap = _TAG_H + 2 ensures a 2px breathing gap between any two pills.
    const _claimSlot = (prefTagTopY: number, above: boolean): number | null => {
      const step = _TAG_H + 2;
      for (let i = 0; i <= 12; i++) {
        const offsets = i === 0 ? [0] : (above ? [-i * step, i * step] : [i * step, -i * step]);
        for (const d of offsets) {
          const ty      = prefTagTopY + d;
          const clamped = Math.max(chartTop + 2, Math.min(chartBottom - _TAG_H - 2, ty));
          const cy      = clamped + _TAG_H / 2;
          if (_usedTagY.every(uy => Math.abs(uy - cy) >= _TAG_H + 2)) {
            _usedTagY.push(cy);
            return clamped;
          }
        }
      }
      return null;
    };
    // Both sides use the same claimer → shared pool, zero cross-side collisions
    const _claimCountSlot = _claimSlot;
    const drawLineTag = (anchorY: number, text: string, color: string, above: boolean, alpha = 1.0) => {
      ctx.save();
      ctx.font = 'bold 8px sans-serif';
      const tw = ctx.measureText(text).width;
      const tagW = tw + 8;
      // X: 14 px gap from right edge — label is clearly inside the chart, not glued to axis
      const tx = Math.max(chartLeft + 2, chartRight - tagW - 14);
      // Ideal tag position — above → bottom edge clears anchorY by 3px; below → top edge clears by 3px
      const idealTagTopY = above ? anchorY - _TAG_H - 3 : anchorY + 3;
      const finalTagTopY = _claimSlot(idealTagTopY, above);
      if (finalTagTopY === null) { ctx.restore(); return; }
      // Pill background
      roundRect(ctx, tx, finalTagTopY, tagW, _TAG_H, 2);
      ctx.fillStyle = `${color}18`;
      ctx.globalAlpha = alpha;
      ctx.fill();
      // Pill border
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.7;
      ctx.globalAlpha = 0.45 * alpha;
      roundRect(ctx, tx, finalTagTopY, tagW, _TAG_H, 2);
      ctx.stroke();
      // Text
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.92 * alpha;
      ctx.textAlign = 'left';
      ctx.fillText(text, tx + 4, finalTagTopY + _TAG_H - 3);
      ctx.restore();
    };

    // Draws line-specific count near first visible candle with a guide connector.
    // sourceCode keeps identity obvious (OB/FVG/SUP/RES/LIQ/BOS/CH/EQ...)
    const drawCenterCount = (
      anchorY: number,
      countText: string,
      color: string,
      above: boolean,
      alpha = 1.0,
      fresh = false,
      sourceCode = '',
    ) => {
      const baseCount = countText.replace(/^\s*·\s*/, '').trim();
      const text = sourceCode ? `${sourceCode} ${baseCount}` : baseCount;
      if (!text) return;

      // Parse magnitude to drive intensity
      const parseVal = (s: string): number => {
        const m = s.match(/([\d.]+)([KkMm]?)/);
        if (!m) return 0;
        const n = parseFloat(m[1]);
        const sfx = m[2].toUpperCase();
        return sfx === 'M' ? n * 1_000_000 : sfx === 'K' ? n * 1_000 : n;
      };
      const nums = Array.from(baseCount.matchAll(/([\d.]+[KkMm]?)/g)).map(m => parseVal(m[1]));
      const mag       = nums.length ? Math.max(...nums) : 0;
      const intensity = Math.min(1, mag <= 0 ? 0 : mag < 500 ? 0.20 : mag < 2_000 ? 0.50 : mag < 5_000 ? 0.75 : 1.0);

      const glowBlur = intensity > 0.70 ? 4 + intensity * 8 : 0;
      const lineW    = 1.0 + intensity * 0.8;

      ctx.save();
      ctx.font = 'bold 10px "Segoe UI", Arial, sans-serif';
      const tw   = ctx.measureText(text).width;
      const tagH = _TAG_H;
      const tagW = tw + 12;

      // X: pill right-edge sits 8px before first visible candle.
      // Clamp to chartLeft+4 so it never goes off-screen.
      const firstCandleX = idxToX(startIdx) - candleStep / 2;
      const idealTx      = firstCandleX - tagW - 8;
      const tx           = Math.max(chartLeft + 4, idealTx);

      // Mobile guard: if pill would still overlap the candle body, skip entirely
      if (tx + tagW > firstCandleX - 2) { ctx.restore(); return; }

      // Claim a Y slot from the shared pool — guarantees no overlap with right labels
      const idealTagTopY = above ? anchorY - tagH - 3 : anchorY + 3;
      const finalTy = _claimCountSlot(idealTagTopY, above);
      if (finalTy === null) { ctx.restore(); return; }
      const centerY = finalTy + tagH / 2;

      // Guide connector: visually ties this count pill to its exact chart line
      ctx.beginPath();
      ctx.moveTo(tx + tagW + 1, centerY);
      ctx.lineTo(Math.max(tx + tagW + 2, firstCandleX - 2), anchorY);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = (0.35 + intensity * 0.35) * alpha;
      ctx.setLineDash([2, 2]);
      ctx.stroke();
      ctx.setLineDash([]);

      // ── NEW-ZONE pulse ring ────────────────────────────────────────────────
      if (fresh) {
        const pulse = (Math.sin(_t / 450) + 1) / 2;
        const ringR = tagW / 2 + 2 + pulse * 5;
        ctx.beginPath();
        ctx.arc(tx + tagW / 2, centerY, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth   = 1.2;
        ctx.globalAlpha = (0.55 - pulse * 0.45) * alpha;
        ctx.shadowColor = color;
        ctx.shadowBlur  = 6;
        ctx.stroke();
        ctx.shadowBlur  = 0;
      }

      // Dark opaque background — readable on any chart colour
      roundRect(ctx, tx, finalTy, tagW, tagH, 3);
      ctx.fillStyle   = 'rgba(8,12,18,0.90)';
      ctx.globalAlpha = alpha;
      ctx.fill();

      // Coloured border — glows at high intensity
      if (glowBlur > 0) { ctx.shadowColor = color; ctx.shadowBlur = glowBlur; }
      ctx.strokeStyle = color;
      ctx.lineWidth   = lineW;
      ctx.globalAlpha = (0.55 + intensity * 0.45) * alpha;
      roundRect(ctx, tx, finalTy, tagW, tagH, 3);
      ctx.stroke();
      ctx.shadowBlur  = 0;

      // Text — near-white base, zone colour tint at high intensity
      ctx.fillStyle    = intensity > 0.65 ? color : '#dde3ea';
      ctx.globalAlpha  = alpha;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, tx + 6, centerY);
      ctx.textBaseline = 'alphabetic';
      ctx.restore();
    };

    const formatPushTag = (up: number, down: number): string => {
      const u = Math.max(0, Math.round(up));
      const d = Math.max(0, Math.round(down));
      if (u <= 0 && d <= 0) return '';
      return ` · ↑${fmtNum(u)} ↓${fmtNum(d)}`;
    };

    /**
     * OB-specific volume tag — shows directionally meaningful numbers.
     *
     * WHY: A bullish OB is formed by the LAST BEARISH candle before an up-impulse.
     * So bull_vol < bear_vol at the OB zone, causing a misleading "↑low ↓high" display
     * at a demand zone.  The fix: use impulse_vol (volume of the 3 confirmation candles
     * AFTER the OB) as the ↑/↓ direction indicator — it always points the same way as
     * the OB type and represents the actual institutional conviction move.
     * Zone depth (total_vol at the OB candle) is shown as the second number.
     */
    const obVolTag = (o: OrderBlock): string => {
      const impulse = Math.max(0, Math.round(o.impulse_vol ?? 0));
      const zoneVol = Math.max(0, Math.round(o.total_vol ?? ((o.bull_vol ?? 0) + (o.bear_vol ?? 0))));
      if (impulse > 0) {
        // impulse_vol always aligns with OB direction (buying for bullish OB, selling for bearish OB)
        return o.type === 'bullish'
          ? ` · ↑${fmtNum(impulse)} ↓${fmtNum(zoneVol)}`   // ↑ = buying impulse, ↓ = zone depth absorbed
          : ` · ↓${fmtNum(impulse)} ↑${fmtNum(zoneVol)}`;  // ↓ = selling impulse, ↑ = zone depth absorbed
      }
      // Fallback: use CE/PE OI if available (OI is not subject to the candle-direction inversion issue)
      const ceOI = Math.max(0, o.ce_oi ?? 0);
      const peOI = Math.max(0, o.pe_oi ?? 0);
      if (ceOI > 0 || peOI > 0) {
        // PE OI at a support = puts written = bullish confirmation; CE OI at resistance = bearish
        return o.type === 'bullish'
          ? formatPushTag(peOI, ceOI)   // ↑PE (bullish puts) ↓CE (bearish calls)
          : formatPushTag(peOI, ceOI);  // same convention; higher CE = stronger supply zone
      }
      return '';
    };

    const participantPushTag = (src?: {
      bull_vol?: number;
      bear_vol?: number;
      total_vol?: number;
      bull_pct?: number;
      touch_count?: number;
      ce_oi?: number;
      pe_oi?: number;
    }): string => {
      if (!src) return '';
      const bullVol = Math.max(0, src.bull_vol ?? 0);
      const bearVol = Math.max(0, src.bear_vol ?? 0);
      if (bullVol > 0 || bearVol > 0) {
        return formatPushTag(bullVol, bearVol);
      }
      const totalVol = Math.max(0, src.total_vol ?? 0);
      const bullPct = Math.min(100, Math.max(0, src.bull_pct ?? 0));
      if (totalVol > 0) {
        const up = totalVol * (bullPct / 100);
        const down = Math.max(0, totalVol - up);
        return formatPushTag(up, down);
      }
      const ceOI = Math.max(0, src.ce_oi ?? 0);
      const peOI = Math.max(0, src.pe_oi ?? 0);
      if (ceOI > 0 || peOI > 0) {
        return formatPushTag(peOI, ceOI);
      }
      return '';
    };

    const nearestLevelParticipant = (
      price: number,
      arr?: Array<{
        price: number;
        bull_vol: number;
        bear_vol: number;
        total_vol: number;
        bull_pct: number;
        touch_count: number;
        ce_oi?: number;
        pe_oi?: number;
      }>,
    ) => {
      if (!arr || arr.length === 0 || price <= 0) return undefined;
      let best: (typeof arr)[number] | undefined;
      let bestDiff = Number.POSITIVE_INFINITY;
      for (const p of arr) {
        const diff = Math.abs(p.price - price);
        if (diff < bestDiff) {
          best = p;
          bestDiff = diff;
        }
      }
      const tolerance = price * 0.0015;
      return best && bestDiff <= tolerance ? best : undefined;
    };

    const eventPushTag = (idx: number): string => {
      if (!Number.isFinite(idx)) return '';
      const win = 6;
      const from = Math.max(0, idx - win);
      const to = Math.min(candles.length - 1, idx + win);
      let up = 0;
      let down = 0;
      for (let i = from; i <= to; i++) {
        const c = candles[i];
        if (!c || c.v <= 0) continue;
        if (c.c >= c.o) up += c.v;
        else down += c.v;
      }
      return formatPushTag(up, down);
    };

    // ── Proximity alert set ───────────────────────────────────────
    const keyLevels = [
      strongLevels.pdh, strongLevels.pdl, strongLevels.cdh, strongLevels.cdl,
      ...strongLevels.support, ...strongLevels.resistance,
      ...strongLiquidity.map(l => l.level),
      ...strongOb.map(o => (o.top + o.bottom) / 2),
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
      cx2 = zItem(cx2, row2Y, CFG.FVG_BULL_BORDER,  '★FVG▲');
      cx2 = zItem(cx2, row2Y, CFG.FVG_BEAR_BORDER,  '★FVG▼');
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

    // ── MITIGATED ORDER BLOCKS — historical reference (draw first, below active zones) ──
    // Dimmed fill + diagonal strikethrough + dashed border + ✗OB tag
    for (const o of mitigatedOb) {
      const isBull = o.type === 'bullish';
      const borderColor = isBull ? CFG.OB_BULL_BORDER : CFG.OB_BEAR_BORDER;
      let x1: number, x2: number;
      if (htfMode) { x1 = chartLeft; x2 = chartRight; }
      else {
        const relStart = o.startIdx - startIdx;
        if (relStart >= visible.length) continue;
        x1 = idxToX(startIdx + Math.max(0, relStart)) - candleStep / 2;
        x2 = chartRight;
      }
      const y1 = priceToY(o.top);
      const y2 = priceToY(o.bottom);
      const zoneH = Math.abs(y2 - y1);
      if (zoneH < 2) continue;

      ctx.save();
      // Very dim fill — consumed zone memory
      ctx.globalAlpha = 0.04;
      ctx.fillStyle = isBull ? CFG.OB_BULL_FILL : CFG.OB_BEAR_FILL;
      ctx.fillRect(x1, y1, x2 - x1, zoneH);
      // Dashed border — distinct from active
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y1);
      ctx.moveTo(x1, y2); ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
      // Diagonal strikethrough — signals mitigation clearly
      ctx.globalAlpha = 0.18;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      // Right tag — very dim, compact
      // tag above zone-top for bearish (zone is above price), below zone-bottom for bullish
      drawLineTag(isBull ? y2 : y1, `✗${isBull ? '▲' : '▼'}OB·MIT`, borderColor, !isBull, 0.38);
    }

    // ── MITIGATED FVG — historical reference (draw first, below active zones) ──
    // Ghost fill + diagonal strikethrough + ✗FVG tag
    for (const f of mitigatedFvg) {
      const isBull = f.type === 'bullish';
      const borderColor = isBull ? CFG.FVG_BULL_BORDER : CFG.FVG_BEAR_BORDER;
      let x1: number, x2: number;
      if (htfMode) { x1 = chartLeft; x2 = chartRight; }
      else {
        const relStart = f.startIdx - startIdx;
        if (relStart >= visible.length) continue;
        x1 = idxToX(startIdx + Math.max(0, relStart)) - candleStep / 2;
        x2 = chartRight;
      }
      const y1 = priceToY(f.top);
      const y2 = priceToY(f.bottom);
      const zoneH = Math.abs(y2 - y1);
      if (zoneH < 2) continue;

      ctx.save();
      // Very dim ghost fill
      ctx.globalAlpha = 0.04;
      ctx.fillStyle = isBull ? 'rgba(56,178,166,1)' : 'rgba(188,100,140,1)';
      ctx.fillRect(x1, y1, x2 - x1, zoneH);
      // Dashed border
      ctx.globalAlpha = 0.20;
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y1);
      ctx.moveTo(x1, y2); ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
      // Full diagonal strikethrough — gap is closed
      ctx.globalAlpha = 0.16;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 7]);
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      // Right tag — very dim
      const partialTag = f.filled ? '·FULL' : `·${Math.round((f.partialFill ?? 1) * 100)}%`;
      drawLineTag(isBull ? y2 : y1, `✗${isBull ? '▲' : '▼'}FVG${partialTag}`, borderColor, !isBull, 0.35);
    }

    // ── ORDER BLOCKS — gradient fill + accent bar + right-side tag label ───
    for (const o of strongOb) {
      const isBull = o.type === 'bullish';
      // Quality tier: PREMIUM (strong impulse, fresh) | STANDARD | WEAK
      const obQuality = o.quality ?? (o.strength >= 0.80 ? 'PREMIUM' : o.strength >= 0.45 ? 'STANDARD' : 'WEAK');
      // Lifecycle decay: FRESH (≤8 candles old) = full, OLDER = 70%, near 80-candle limit = 45%
      const obAge = o.candles_ago ?? 0;
      const lifecycleAlpha = obAge <= 8 ? 1.0 : obAge <= 30 ? 0.78 : 0.52;
      const qualityAlpha = obQuality === 'PREMIUM' ? 1.0 : 0.70;
      const alpha = lifecycleAlpha * qualityAlpha;
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
      // Approach detection — OB glows when price enters or nears zone
      const obProx = o.mitigated ? 'off' as const : zoneProx(o.top, o.bottom);
      if (obProx !== 'off') alertZones.push({ label: `${obQuality === 'PREMIUM' ? '★' : ''}${isBull ? '▲' : '▼'}OB`, color: borderColor });

      // Left accent bar — widens + glows on approach
      const obAccW = obProx === 'hot' ? 7 : obProx === 'warm' ? 5 : 2;
      ctx.save();
      if (obProx !== 'off') { ctx.shadowColor = borderColor; ctx.shadowBlur = obProx === 'hot' ? 12 + 8 * _pF : 5; }
      ctx.fillStyle   = borderColor;
      ctx.globalAlpha = obProx === 'hot' ? 0.8 + 0.2 * _pF : obProx === 'warm' ? 0.75 : (o.mitigated ? CFG.OB_MITIGATED_ALPHA : 0.28);
      ctx.fillRect(x1, y1, obAccW, zoneH);
      // Top and bottom border lines — sharp glow on approach
      ctx.strokeStyle = borderColor;
      ctx.lineWidth   = o.mitigated ? 0.5 : obProx === 'hot' ? 2.5 + _pM : obProx === 'warm' ? 1.8 : 0.6;
      ctx.setLineDash(o.mitigated ? [6, 4] : []);
      ctx.globalAlpha = obProx === 'hot' ? 0.85 + 0.15 * _pF : obProx === 'warm' ? 0.75 : (o.mitigated ? CFG.OB_MITIGATED_ALPHA : 0.28);
      ctx.beginPath();
      ctx.moveTo(x1 + obAccW, y1); ctx.lineTo(x2, y1);
      ctx.moveTo(x1 + obAccW, y2); ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      ctx.restore();
      // Label: right-side tag — never overlaps candles
      if (zoneH > 6) {
        const isFreshOB = obAge <= 6;
        const starMark = obQuality === 'PREMIUM' ? '★' : '';
        const statusStr = isFreshOB ? ' NEW' : '';
        // FIX: Use obVolTag instead of participantPushTag for OBs.
        // participantPushTag used bull_vol/bear_vol from the OB candle itself, which is
        // ALWAYS the opposite direction to the OB type (bullish OB = last bearish candle →
        // bear_vol dominates → "↓more millions" at a demand zone = false/confusing signal).
        // obVolTag uses impulse_vol (the 3 candles that confirmed the move), which is
        // directionally aligned with the OB type and represents institutional conviction.
        const pushTag = obVolTag(o);
        const tag = starMark + (isBull ? '▲OB' : '▼OB') + statusStr;
        // bull OB: zone is below price → tag BELOW zone bottom; bear OB: above price → tag ABOVE zone top
        drawLineTag(isBull ? y2 : y1, tag, borderColor, !isBull, lifecycleAlpha * qualityAlpha);
        // Skip count for mitigated OB — zone is invalidated (SL hit), auto-removed
        if (pushTag && !o.mitigated) drawCenterCount(isBull ? y2 : y1, pushTag, borderColor, !isBull, lifecycleAlpha * qualityAlpha, isFreshOB, isBull ? 'OB+' : 'OB-');
        // Predictive forecast — only when price within 2% proximity
        if (shouldPredict(o.top, o.bottom)) {
          const pred = predictZoneOutcome(o.top, o.bottom, candles, effectiveSpot, structure, isFreshOB, 1, 0);
          drawPredTag(isBull ? y2 : y1, pred, !isBull);
        }
      }
      ctx.globalAlpha = 1;
    }

    // ── FVG ZONES — quality-tiered rendering with lifecycle decay ─────────────
    // FRESH (partialFill=0)        : full opacity, bold borders
    // 1ST TOUCH (fill 1–30%)       : 75% opacity, slightly faded
    // WEAKENED (fill 30–60%)       : 45% opacity, dim fill, thinner borders
    // CONSUMED (fill>60% or filled): filtered out above — never reaches here
    for (const f of strongFvg) {
      const isBull   = f.type === 'bullish';
      const quality  = f.quality ?? 'STANDARD';
      const partial  = f.partialFill ?? 0;

      // Lifecycle alpha — decays as zone is consumed
      const lifecycleAlpha = partial === 0 ? 1.0 : partial < 0.30 ? 0.75 : 0.45;

      // Per-quality visual params
      const cfg_fvg = quality === 'PREMIUM'
        ? {
            fillAlpha:     isBull ? 0.15 : 0.15,
            hatchAlpha:    isBull ? 0.28 : 0.28,
            borderW:       2.2,
            midW:          1.2,
            midDash:       [6, 3],
            borderDash:    [] as number[],
            glowEnabled:   true,
          }
        : quality === 'STANDARD'
        ? {
            fillAlpha:     isBull ? 0.07 : 0.07,
            hatchAlpha:    isBull ? 0.14 : 0.14,
            borderW:       1.2,
            midW:          0.8,
            midDash:       [4, 4],
            borderDash:    [5, 4],
            glowEnabled:   true,
          }
        : {  // WEAK — filtered above, but safety fallback
            fillAlpha:     0.025,
            hatchAlpha:    0.04,
            borderW:       0.6,
            midW:          0,
            midDash:       [] as number[],
            borderDash:    [3, 6],
            glowEnabled:   false,
          };

      const borderColor = isBull ? CFG.FVG_BULL_BORDER : CFG.FVG_BEAR_BORDER;
      const hatchColor  = isBull
        ? `rgba(56,178,166,${cfg_fvg.hatchAlpha})`
        : `rgba(188,100,140,${cfg_fvg.hatchAlpha})`;
      const fillColor = isBull
        ? `rgba(56,178,166,${cfg_fvg.fillAlpha})`
        : `rgba(188,100,140,${cfg_fvg.fillAlpha})`;

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
      if (zoneH < 1) continue;

      // Filled FVGs are removed by the filter above — nothing to ghost-render.

      // ── PARTIAL FILL: split fill — consumed (grey) vs remaining (colored) ──
      const consumedH = zoneH * partial;
      const remainH   = zoneH - consumedH;
      // Apply lifecycle opacity to all fills
      ctx.globalAlpha = lifecycleAlpha;
      if (partial > 0) {
        if (isBull) {
          ctx.fillStyle = 'rgba(148,163,184,0.06)';
          ctx.fillRect(x1, y1, x2 - x1, consumedH);
          ctx.fillStyle = fillColor;
          ctx.fillRect(x1, y1 + consumedH, x2 - x1, remainH);
        } else {
          ctx.fillStyle = 'rgba(148,163,184,0.06)';
          ctx.fillRect(x1, y2 - consumedH, x2 - x1, consumedH);
          ctx.fillStyle = fillColor;
          ctx.fillRect(x1, y1, x2 - x1, remainH);
        }
      } else {
        ctx.fillStyle = fillColor;
        ctx.fillRect(x1, y1, x2 - x1, zoneH);
      }
      ctx.globalAlpha = 1;

      // ── HATCH (clip to zone, lifecycle-dimmed) ────────────────────────────
      if (quality !== 'WEAK') {
        ctx.save();
        ctx.globalAlpha = lifecycleAlpha;
        ctx.beginPath();
        ctx.rect(x1, y1, x2 - x1, zoneH);
        ctx.clip();
        ctx.strokeStyle = hatchColor;
        ctx.lineWidth = 1;
        const hatchStep = quality === 'PREMIUM' ? 6 : 10;
        for (let lx = x1 - zoneH; lx < x2 + zoneH; lx += hatchStep) {
          ctx.beginPath();
          ctx.moveTo(lx, y1);
          ctx.lineTo(lx + zoneH, y2);
          ctx.stroke();
        }
        ctx.restore();
      }

      // ── APPROACH DETECTION + GLOW ─────────────────────────────────────────
      const fvgProx = cfg_fvg.glowEnabled ? zoneProx(f.top, f.bottom) : 'off';
      if (fvgProx !== 'off') alertZones.push({ label: `${isBull ? '▲' : '▼'}FVG${quality === 'PREMIUM' ? '★' : ''}`, color: borderColor });

      // ── BORDERS (top + bottom lines, lifecycle-dimmed) ───────────────────
      ctx.save();
      if (fvgProx !== 'off') {
        ctx.shadowColor = borderColor;
        ctx.shadowBlur  = fvgProx === 'hot' ? 18 + 10 * _pF : 8;
      }
      ctx.strokeStyle = borderColor;
      ctx.lineWidth   = fvgProx === 'hot'
        ? cfg_fvg.borderW + 1.5 + _pM
        : fvgProx === 'warm'
          ? cfg_fvg.borderW + 0.6
          : cfg_fvg.borderW;
      ctx.setLineDash(cfg_fvg.borderDash);
      ctx.globalAlpha = lifecycleAlpha * (quality === 'WEAK' ? 0.35 : 1);
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y1);
      ctx.moveTo(x1, y2); ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      ctx.restore();

      // ── MID LINE (equilibrium / 50% level) ──────────────────────────────
      if (cfg_fvg.midW > 0) {
        const midY = (y1 + y2) / 2;
        ctx.save();
        ctx.strokeStyle = borderColor;
        ctx.lineWidth   = cfg_fvg.midW;
        ctx.globalAlpha = lifecycleAlpha * (quality === 'PREMIUM' ? 0.55 : 0.30);
        ctx.setLineDash(cfg_fvg.midDash);
        ctx.beginPath();
        ctx.moveTo(x1, midY); ctx.lineTo(x2, midY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // ── PARTIAL FILL DIVIDER LINE ────────────────────────────────────────
      if (partial > 0.05 && partial < 0.95) {
        const divY = isBull ? y1 + consumedH : y2 - consumedH;
        ctx.save();
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.4 * lifecycleAlpha;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x1, divY); ctx.lineTo(x2, divY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // ── LABEL: right-side tag only — never overlaps candles ──────────────
      if (zoneH > 6) {
        const isFresh = (f.candles_ago ?? 999) <= 8;
        const star    = quality === 'PREMIUM' ? '★' : '';
        const freshTag = isFresh ? '·NEW' : '';
        const partialTag = partial > 0.10 ? `·${Math.round(partial * 100)}%` : '';
        const pushTag = participantPushTag(f);
        const tag = `${star}${isBull ? '▲' : '▼'}FVG${freshTag}${partialTag}`;
        // bull FVG: zone is below price → tag BELOW zone bottom; bear FVG: above price → tag ABOVE zone top
        drawLineTag(isBull ? y2 : y1, tag, borderColor, !isBull, lifecycleAlpha);
        if (pushTag) drawCenterCount(isBull ? y2 : y1, pushTag, borderColor, !isBull, lifecycleAlpha, isFresh, isBull ? 'FVG+' : 'FVG-');
        // Predictive forecast — only when price within 2% proximity
        if (shouldPredict(f.top, f.bottom)) {
          const pred = predictZoneOutcome(f.top, f.bottom, candles, effectiveSpot, structure, partial === 0, 1, partial);
          drawPredTag(isBull ? y2 : y1, pred, !isBull);
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
      pushTag = '',
    ) => {
      if (price <= 0) return;
      const y = priceToY(price);
      if (y < chartTop || y > chartBottom) return;

      const lvProx = lineProx(price);
      if (lvProx !== 'off') alertZones.push({ label, color });
      const isHot  = lvProx === 'hot';
      const isWarm = lvProx === 'warm';

      // ── The line — sharp glow when price is approaching ──────────
      ctx.save();
      if (lvProx !== 'off') {
        ctx.shadowColor = color;
        ctx.shadowBlur  = isHot ? 14 + 8 * _pF : 5 + 3 * _pM;
      }
      ctx.strokeStyle = color;
      ctx.lineWidth   = isHot ? lineW + 1.5 + _pM * 0.8 : isWarm ? lineW + 0.8 : lineW;
      ctx.setLineDash(dash);
      // Always clearly visible — base 0.65, hot 0.95, warm 0.80
      ctx.globalAlpha = isHot ? 0.90 + 0.10 * _pF : isWarm ? 0.80 : 0.65;
      ctx.beginPath();
      ctx.moveTo(chartLeft, y);
      ctx.lineTo(chartRight, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.restore();

      // H/RES lines: tag BELOW the line (avoid top of chart); L/SUP: tag ABOVE the line
      const _lvlAbove = label.includes('L') || label === 'SUP';
      drawLineTag(y, label, color, _lvlAbove);
      if (pushTag) drawCenterCount(y, pushTag, color, _lvlAbove, 1.0, false, label.replace('DAY ', 'D').replace('PREV ', 'P'));
      // Price pill: right price-axis strip (standard axis annotation)
      ctx.save();
      ctx.shadowBlur = 0;
      const priceStr = fmtPrice(price);
      ctx.font = '9px monospace';
      const pw = ctx.measureText(priceStr).width + 10;
      roundRect(ctx, chartRight + 2, y - 7, pw, 14, 3);
      ctx.fillStyle = color; ctx.globalAlpha = 1; ctx.fill();
      ctx.fillStyle = '#0d1117'; ctx.textAlign = 'left';
      ctx.fillText(priceStr, chartRight + 6, y + 4);
      ctx.restore();
    };

    // Helper: add prediction tag beside a key level line (only when near spot)
    const addLevelPred = (level: number, labelAbove: boolean) => {
      if (!shouldPredict(level, level) || level <= 0) return;
      const tc   = levelTouchCount(level);
      const pred = predictZoneOutcome(level * 1.0005, level * 0.9995, candles, effectiveSpot, structure, tc <= 1, tc, 0);
      drawPredTag(priceToY(level), pred, labelAbove);
    };

    // DAY HIGH — solid 2px electric cyan
    drawLevel(strongLevels.cdh, CFG.CDH, [], 'DAY H', 2, participantPushTag(levels.cdh_participants ?? levels.cdh_strike_oi));
    addLevelPred(strongLevels.cdh, false); // CDH above price → rejection bounces down
    // DAY LOW — solid 1.5px royal blue
    drawLevel(strongLevels.cdl, CFG.CDL, [], 'DAY L', 1.5, participantPushTag(levels.cdl_participants ?? levels.cdl_strike_oi));
    addLevelPred(strongLevels.cdl, true);  // CDL below price → rejection bounces up
    // PREV HIGH — long dash [12,4] vivid gold
    drawLevel(strongLevels.pdh, CFG.PDH, [12, 4], 'PREV H', 1.5, participantPushTag(levels.pdh_participants ?? levels.pdh_strike_oi));
    addLevelPred(strongLevels.pdh, false);
    // PREV LOW — medium dash [6,4] deep orange (shorter dashes = different rhythm from PREV H)
    drawLevel(strongLevels.pdl, CFG.PDL, [6, 4], 'PREV L', 1.2, participantPushTag(levels.pdl_participants ?? levels.pdl_strike_oi));
    addLevelPred(strongLevels.pdl, true);
    // SUPPORT — dash-dot [5,3] neon lime, 1.5px (thick enough to see clearly)
    for (const s of strongLevels.support) {
      const sPart = nearestLevelParticipant(s, levels.sr_participants?.support);
      drawLevel(s, CFG.SUPPORT, [5, 3], 'SUP', 1.5, participantPushTag(sPart));
      addLevelPred(s, true);
    }
    // RESISTANCE — dots [2,4] neon red, 1.5px (different dash from SUP)
    for (const r of strongLevels.resistance) {
      const rPart = nearestLevelParticipant(r, levels.sr_participants?.resistance);
      drawLevel(r, CFG.RESISTANCE, [2, 4], 'RES', 1.5, participantPushTag(rPart));
      addLevelPred(r, false);
    }

    // ── LIQUIDITY LEVELS ────────────────────────────────────────────
    // SSL = Sell-side liquidity (above equal highs) — swept from downside ↑
    // BSL = Buy-side liquidity  (below equal lows)  — swept from upside  ↓
    // Swept = faded grey (market already took liquidity)
    //
    // SWEEP DETECTION — 3 states:
    //   activeSweep : the live/most-recent candle's wick is crossing the level RIGHT NOW
    //   justSwept   : level is already marked swept in backend data
    //   approaching : price within WARM_D% but wick not yet touching
    for (const lq of strongLiquidity) {
      const y = priceToY(lq.level);
      if (y < chartTop || y > chartBottom) continue;
      const isSell  = lq.type === 'sell_side';
      const baseCol = isSell ? CFG.LIQ_SELL : CFG.LIQ_BUY;
      const color   = lq.swept ? CFG.LIQ_SWEPT : baseCol;

      // ── Determine approach direction ──────────────────────────────
      // SSL sits above price  → approached from DOWNSIDE (price moving up)
      // BSL sits below price  → approached from UPSIDE   (price moving down)
      const lqProx = lq.swept ? 'off' as const : lineProx(lq.level);

      // Active sweep: most-recent visible candle's wick crosses the level
      const lastC      = visible[visible.length - 1];
      const activeSweep = !lq.swept && lastC && (
        isSell
          ? lastC.h >= lq.level   // wick pierced ABOVE SSL — upside sweep
          : lastC.l <= lq.level   // wick pierced BELOW BSL — downside sweep
      );

      if (activeSweep) {
        alertZones.push({ label: isSell ? '⚡SSL SWEEP↑' : '⚡BSL SWEEP↓', color: baseCol });
      } else if (lqProx === 'hot') {
        alertZones.push({ label: isSell ? `SSL↑` : `BSL↓`, color: baseCol });
      }

      // ── STEP 1: Glowing band around level when approached / swept ─
      if (activeSweep || lqProx === 'hot') {
        const bandH = activeSweep ? 6 + 4 * _pF : 4 + 2 * _pF;
        ctx.save();
        ctx.globalAlpha = 0.18 + 0.12 * _pF;
        ctx.fillStyle   = baseCol;
        ctx.fillRect(chartLeft, y - bandH / 2, chartRight - chartLeft, bandH);
        ctx.restore();
      }

      // ── STEP 2: Highlight every visible candle whose wick crosses level
      for (let i = 0; i < visible.length; i++) {
        const c    = visible[i];
        const cx_v = idxToX(startIdx + i);
        const wickCross = isSell
          ? (c.h >= lq.level && c.l < lq.level)   // wick above, body below → SSL sweep candle
          : (c.l <= lq.level && c.h > lq.level);  // wick below, body above → BSL sweep candle
        if (!wickCross) continue;

        const isLive   = i === visible.length - 1;
        const glowA    = isLive ? (0.22 + 0.14 * _pF) : 0.14;
        const glowW    = Math.max(8, cw + 4);
        const wickTopY = priceToY(c.h);
        const wickBotY = priceToY(c.l);

        ctx.save();
        // Translucent candle-wide vertical glow column
        ctx.globalAlpha = glowA;
        ctx.fillStyle   = baseCol;
        ctx.fillRect(cx_v - glowW / 2, wickTopY, glowW, wickBotY - wickTopY);
        // Brighter rim at the level crossing
        ctx.globalAlpha = isLive ? 0.55 + 0.3 * _pF : 0.35;
        ctx.shadowColor = baseCol;
        ctx.shadowBlur  = isLive ? 10 + 6 * _pF : 5;
        const crossY = isSell ? priceToY(lq.level) : priceToY(lq.level);
        ctx.strokeStyle = baseCol;
        ctx.lineWidth   = isLive ? 2 + _pM * 0.8 : 1.2;
        ctx.beginPath();
        ctx.moveTo(cx_v - glowW / 2, crossY);
        ctx.lineTo(cx_v + glowW / 2, crossY);
        ctx.stroke();
        ctx.shadowBlur  = 0;
        ctx.restore();
      }

      // ── STEP 3: Level line — solid + thick when being swept, dotted otherwise
      ctx.save();
      if (activeSweep) {
        // Solid bright line during live sweep
        ctx.shadowColor = baseCol;
        ctx.shadowBlur  = 14 + 10 * _pF;
        ctx.strokeStyle = baseCol;
        ctx.lineWidth   = 2.5 + _pF;
        ctx.globalAlpha = 0.9 + 0.1 * _pF;
        ctx.setLineDash([]);
      } else if (lqProx !== 'off') {
        ctx.shadowColor = color;
        ctx.shadowBlur  = lqProx === 'hot' ? 10 + 6 * _pF : 4;
        ctx.strokeStyle = color;
        ctx.lineWidth   = lqProx === 'hot' ? 2 + _pM : 1.2;
        ctx.globalAlpha = lqProx === 'hot' ? 0.85 + 0.15 * _pF : 0.8;
        ctx.setLineDash([3, 4]);
      } else {
        ctx.strokeStyle = color;
        ctx.lineWidth   = lq.swept ? 0.6 : 0.8;
        ctx.globalAlpha = lq.swept ? 0.3 : 0.65;
        ctx.setLineDash([1, 4]);
      }
      ctx.beginPath();
      ctx.moveTo(chartLeft, y);
      ctx.lineTo(chartRight, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur  = 0;
      ctx.globalAlpha = 1;
      ctx.restore();

      // ── STEP 4: Spark burst — 8 radial lines at the live crossing point ──
      if (activeSweep) {
        const sparkX = idxToX(candles.length - 1);  // last candle x
        if (sparkX >= chartLeft && sparkX <= chartRight) {
          const sparkR = 7 + 5 * _pF;
          ctx.save();
          ctx.shadowColor = baseCol;
          ctx.shadowBlur  = 8 + 6 * _pF;
          ctx.strokeStyle = baseCol;
          ctx.lineWidth   = 1.5;
          ctx.globalAlpha = 0.65 + 0.35 * _pF;
          for (let k = 0; k < 8; k++) {
            const ang = (k * Math.PI) / 4 + (_t / 400);  // slow rotation
            const innerR = 3;
            ctx.beginPath();
            ctx.moveTo(sparkX + Math.cos(ang) * innerR, y + Math.sin(ang) * innerR);
            ctx.lineTo(sparkX + Math.cos(ang) * sparkR, y + Math.sin(ang) * sparkR);
            ctx.stroke();
          }
          ctx.shadowBlur  = 0;
          ctx.globalAlpha = 1;
          ctx.restore();
        }
      }

      // ── STEP 5: Diamond end-markers — grow + glow ────────────────
      if (!lq.swept) {
        const dSize = activeSweep ? 7 + 2 * _pF : lqProx !== 'off' ? 5 + 2 * _pM : 3.5;
        const dAlpha = activeSweep ? 0.85 + 0.15 * _pF : lqProx !== 'off' ? 0.9 + 0.1 * _pF : 0.85;
        const diamond = (cx: number, cy: number, sz = dSize) => {
          ctx.save();
          if (activeSweep) { ctx.shadowColor = baseCol; ctx.shadowBlur = 8 + 4 * _pF; }
          ctx.beginPath();
          ctx.moveTo(cx, cy - sz);
          ctx.lineTo(cx + sz, cy);
          ctx.lineTo(cx, cy + sz);
          ctx.lineTo(cx - sz, cy);
          ctx.closePath();
          ctx.fillStyle   = color;
          ctx.globalAlpha = dAlpha;
          ctx.fill();
          ctx.shadowBlur  = 0;
          ctx.globalAlpha = 1;
          ctx.restore();
        };
        diamond(chartLeft + 5, y);
        diamond(chartRight - 5, y);
      }

      // ── STEP 6: Right-side tag — never overlaps candles ──────────────
      const liqBase = activeSweep
        ? `${isSell ? '⚡SSL' : '⚡BSL'}×${lq.touchCount}`
        : `${isSell ? 'SSL' : 'BSL'}×${lq.touchCount}`;
      const liqCount = participantPushTag(lq);
      // SSL (above price): tag BELOW the line; BSL (below price): tag ABOVE the line
      drawLineTag(y, liqBase, baseCol, !isSell);
      // Skip count for swept liquidity — level invalidated (SL hit), auto-removed
      if (liqCount && !lq.swept) drawCenterCount(y, liqCount, baseCol, !isSell, 1.0, activeSweep, isSell ? 'SSL' : 'BSL');
      // Predictive forecast for liquidity level
      if (shouldPredict(lq.level, lq.level)) {
        const liqTop = lq.level * 1.0005;
        const liqBot = lq.level * 0.9995;
        const pred = predictZoneOutcome(liqTop, liqBot, candles, effectiveSpot, structure, !lq.swept, lq.touchCount ?? 1, 0);
        drawPredTag(y, pred, !isSell);
      }
    }

    // ── PRIORITY ENTRY LINES ───────────────────────────────────────────────────
    // Draw all matched combination setups (deduped) so users see each valid setup.
    for (const prioritySetup of prioritySetups) {
      const y = priceToY(prioritySetup.entryLine);
      if (y >= chartTop && y <= chartBottom) {
        const isBull  = prioritySetup.direction === 'bullish';
        const p       = prioritySetup.priority;

        // Eye-friendly color palette — medium saturation, never harsh
        const pColor  = p === 1
          ? (isBull ? '#38bdf8' : '#f87171')   // sky-400 / red-400
          : p === 2
            ? (isBull ? '#34d399' : '#fbbf24') // emerald-400 / amber-400
            : (isBull ? '#818cf8' : '#c084fc'); // indigo-400 / purple-400

        const pLabel  = p === 1 ? 'P1 · REVERSAL SNIPER'
          : p === 2   ? 'P2 · CONTINUATION POWER'
          :               'P3 · FLIP ENTRY';

        // Gentle breathing pulse — subtle, not distracting
        const pulse   = p === 1 ? 0.72 + 0.18 * Math.sin(_t / 320)
          : p === 2             ? 0.72 + 0.14 * Math.sin(_t / 480)
          :                       0.70 + 0.10 * Math.sin(_t / 600);

        ctx.save();

        // ── Layer 1: Wide soft ambient glow (very low alpha — just a warm halo) ──
        ctx.shadowBlur  = 0;
        ctx.strokeStyle = pColor;
        ctx.lineWidth   = p === 1 ? 14 : p === 2 ? 11 : 8;
        ctx.globalAlpha = 0.04 * pulse;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(chartLeft + 4, y);
        ctx.lineTo(chartRight - 4, y);
        ctx.stroke();

        // ── Layer 2: Medium glow band ──
        ctx.lineWidth   = p === 1 ? 6 : p === 2 ? 5 : 4;
        ctx.globalAlpha = 0.10 * pulse;
        ctx.beginPath();
        ctx.moveTo(chartLeft + 4, y);
        ctx.lineTo(chartRight - 4, y);
        ctx.stroke();

        // ── Layer 3: Crisp main line — sharp but not aggressive ──
        ctx.shadowColor  = pColor;
        ctx.shadowBlur   = p === 1 ? 5 : p === 2 ? 4 : 3;   // tight glow only
        ctx.lineWidth    = p === 1 ? 1.8 : p === 2 ? 1.5 : 1.2;
        ctx.globalAlpha  = 0.88 * pulse;
        ctx.setLineDash(p === 1 ? [] : p === 2 ? [7, 4] : [3, 5]);
        ctx.beginPath();
        ctx.moveTo(chartLeft + 4, y);
        ctx.lineTo(chartRight - 4, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;

        // ── Layer 4: Spark entry marker — small filled diamond at 38.2% width ──
        // One small accent diamond marks the exact entry confluence point.
        const sparkX = chartLeft + (chartRight - chartLeft) * 0.382;
        const sr     = p === 1 ? 4.5 : p === 2 ? 3.8 : 3.2;  // half-size of diamond
        ctx.globalAlpha = 0.90 * pulse;
        ctx.fillStyle   = pColor;
        ctx.shadowColor = pColor;
        ctx.shadowBlur  = p === 1 ? 8 : 6;
        ctx.beginPath();
        ctx.moveTo(sparkX,      y - sr);  // top
        ctx.lineTo(sparkX + sr, y);       // right
        ctx.lineTo(sparkX,      y + sr);  // bottom
        ctx.lineTo(sparkX - sr, y);       // left
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;

        // ── Layer 5: Tiny tick marks every ~60px along the line (eye-friendly rhythm) ──
        ctx.strokeStyle  = pColor;
        ctx.lineWidth    = 1;
        ctx.globalAlpha  = 0.22 * pulse;
        const tickSpacing = 60;
        for (let tx = chartLeft + 4 + tickSpacing; tx < chartRight - 4; tx += tickSpacing) {
          if (Math.abs(tx - sparkX) < sr + 4) continue; // skip near diamond
          ctx.beginPath();
          ctx.moveTo(tx, y - 3);
          ctx.lineTo(tx, y + 3);
          ctx.stroke();
        }

        ctx.restore();

        // ── Label badge — floats ABOVE line for bull, BELOW for bear ──────
        // Anchored to the entry line Y; never overlaps the line itself.
        const labelAbove = isBull;   // bull entry: badge above line; bear entry: badge below
        const text    = `${pLabel}  ${isBull ? '▲' : '▼'}  ${prioritySetup.confidence}%`;
        ctx.save();
        ctx.font      = 'bold 9px sans-serif';
        const tw      = ctx.measureText(text).width;
        const bw = tw + 12; const bh = 16;
        // X: 14 px from right edge (aligned with drawLineTag)
        const bx = chartRight - bw - 14;
        // Y: above → bottom of badge clears line by 4px; below → top of badge clears line by 4px
        const rawBy = labelAbove ? y - bh - 4 : y + 4;
        const by = Math.max(chartTop + 2, Math.min(chartBottom - bh - 2, rawBy));
        // Badge background — subtle, readable
        ctx.globalAlpha = 0.82;
        roundRect(ctx, bx, by, bw, bh, 4);
        ctx.fillStyle   = `${pColor}26`;
        ctx.fill();
        // Badge border — breathes with pulse
        ctx.globalAlpha = 0.50 * pulse;
        ctx.strokeStyle  = pColor;
        ctx.lineWidth    = 0.8;
        roundRect(ctx, bx, by, bw, bh, 4);
        ctx.stroke();
        // Badge text
        ctx.globalAlpha  = 0.95;
        ctx.fillStyle    = '#f1f5f9';
        ctx.textAlign    = 'left';
        ctx.fillText(text, bx + 5, by + bh - 4);
        ctx.restore();
      }
    }

    // ── CURRENT PRICE LINE (dashed only — badge drawn after price axis to stay on top) ──
    if (effectiveSpot > 0) {
      const y = priceToY(effectiveSpot);
      if (y >= chartTop && y <= chartBottom) {
        const isLive = dataSourceRef.current === 'LIVE';
        const lastOpen = visible.length > 0 ? visible[visible.length - 1].o : effectiveSpot;
        const isUp = effectiveSpot >= lastOpen;
        const lineColor = isLive ? (isUp ? '#22c55e' : '#ef4444') : '#9070c0';
        ctx.save();
        ctx.shadowColor = lineColor;
        ctx.shadowBlur = isLive ? 14 : 8;
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = isLive ? 2 : 1.5;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(chartLeft, y);
        ctx.lineTo(chartRight, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    // ── CANDLES — Zerodha Kite exact style ─────────────────────────────
    // Defensive state reset: zone/line rendering above may leave globalAlpha, shadowBlur
    // or lineDash in a non-default state despite save/restore pairs (e.g. early returns,
    // exceptions, or DPR-scaling artefacts). Explicitly reset so candles always render.
    ctx.globalAlpha = 1;
    ctx.shadowBlur  = 0;
    ctx.setLineDash([]);
    // Both bull and bear are solid filled rectangles.
    // Wick is 1px, same color as body. No glow, no stroke on body.
    for (let i = 0; i < visible.length; i++) {
      const c = visible[i];
      const x = idxToX(startIdx + i);
      // Correct visibility check: skip only if candle is ENTIRELY off-screen
      // (right edge < chartLeft  OR  left edge > chartRight)
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

    // ── CURRENT CANDLE VOLUME PILL ───────────────────────────────────
    // Only the live forming candle. Detects high-volume spike and
    // renders a sharp bright multi-layer glow for emphasis.
    {
      const lastC = visible[visible.length - 1];
      const lastI = visible.length - 1;
      if (lastC && lastC.v > 0) {
        const x      = idxToX(startIdx + lastI);
        const isBull = lastC.c >= lastC.o;

        // Rolling 20-candle average to detect spikes
        const lookback = visible.slice(Math.max(0, lastI - 20), lastI);
        const volSum   = lookback.reduce((s, c) => s + c.v, 0);
        const volAvg   = lookback.length > 0 ? volSum / lookback.length : 0;
        // spike = current > 1.5× avg; huge spike > 2.5×
        const isSpike  = volAvg > 0 && lastC.v > volAvg * 1.5;
        const isHuge   = volAvg > 0 && lastC.v > volAvg * 2.5;

        const volText = fmtNum(lastC.v);

        ctx.save();
        ctx.font = `bold ${isHuge ? 13 : 12}px monospace`;
        ctx.textAlign = 'center';

        const tw  = ctx.measureText(volText).width;
        const pH  = isHuge ? 21 : 19;
        const pW  = tw + (isHuge ? 22 : 18);
        const pY  = Math.max(chartTop + 2, priceToY(lastC.h) - pH - 6);

        // ── Multi-layer glow for spike candles ──────────────────────
        if (isSpike && _mktOpen) {
          const glowColor = isHuge
            ? (isBull ? '#00ffc8' : '#ff4444')   // extreme — bright cyan/red
            : (isBull ? '#26a69a' : '#ef5350');   // normal spike — teal/red

          // Outer glow (wide, soft)
          ctx.shadowColor = glowColor;
          ctx.shadowBlur  = isHuge ? 28 : 18;
          ctx.strokeStyle = 'transparent';
          roundRect(ctx, x - pW / 2, pY, pW, pH, 5);
          ctx.stroke();

          // Middle glow pass
          ctx.shadowBlur  = isHuge ? 14 : 9;
          roundRect(ctx, x - pW / 2, pY, pW, pH, 5);
          ctx.stroke();
        }

        // ── Background ──────────────────────────────────────────────
        ctx.shadowBlur = 0;
        if (isHuge) {
          // Vivid gradient-like fill for extreme spikes
          ctx.fillStyle = isBull ? 'rgba(0,60,45,0.98)' : 'rgba(70,5,5,0.98)';
        } else if (isSpike) {
          ctx.fillStyle = isBull ? 'rgba(0,48,36,0.98)' : 'rgba(58,5,5,0.98)';
        } else {
          ctx.fillStyle = isBull ? 'rgba(0,35,28,0.97)' : 'rgba(45,5,5,0.97)';
        }
        ctx.globalAlpha = 1;
        roundRect(ctx, x - pW / 2, pY, pW, pH, 5);
        ctx.fill();

        // ── Border ──────────────────────────────────────────────────
        const bAlpha = _mktOpen ? 0.75 + 0.25 * _pM : 0.65;
        let borderColor: string;
        if (isHuge) {
          borderColor = isBull ? `rgba(0,255,200,${bAlpha})` : `rgba(255,68,68,${bAlpha})`;
        } else if (isSpike) {
          borderColor = isBull ? `rgba(38,200,180,${bAlpha})` : `rgba(239,100,80,${bAlpha})`;
        } else {
          borderColor = isBull ? `rgba(38,166,154,${bAlpha})` : `rgba(239,83,80,${bAlpha})`;
        }
        ctx.strokeStyle = borderColor;
        ctx.lineWidth   = isHuge ? 2 : isSpike ? 1.8 : 1.5;

        // Sharp inner glow on border for spike
        if (isSpike && _mktOpen) {
          ctx.shadowColor = isHuge
            ? (isBull ? '#00ffc8' : '#ff4444')
            : (isBull ? '#26a69a' : '#ef5350');
          ctx.shadowBlur = isHuge ? 10 : 6;
        }
        roundRect(ctx, x - pW / 2, pY, pW, pH, 5);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // ── Text ────────────────────────────────────────────────────
        if (isHuge && _mktOpen) {
          ctx.shadowColor = isBull ? '#00ffc8' : '#ff6666';
          ctx.shadowBlur  = 8 * _pM;
        } else if (_mktOpen) {
          ctx.shadowColor = isBull ? '#26a69a' : '#ef5350';
          ctx.shadowBlur  = 5 * _pM;
        }
        ctx.fillStyle = isHuge
          ? (isBull ? '#b3fff0' : '#ffaaaa')
          : isSpike
            ? (isBull ? '#a7f3d0' : '#fca5a5')
            : (isBull ? '#6ee7b7' : '#fca5a5');
        ctx.fillText(volText, x, pY + pH - 5);

        ctx.shadowBlur  = 0;
        ctx.globalAlpha = 1;
        ctx.restore();
      }
    }

    // ── VOLUME BARS (enhanced — MA spike detection, live badge, axis labels) ─
    {
      const volTop = chartBottom + 3;
      const volH = CFG.VOL_H - 5;

      // Separator line above volume
      ctx.strokeStyle = CFG.VOL_SEPARATOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(chartLeft, chartBottom);
      ctx.lineTo(chartRight, chartBottom);
      ctx.stroke();

      // Max volume across visible candles (stable scale)
      let maxVol = 1;
      for (const c of visible) if (c.v > maxVol) maxVol = c.v;

      // 20-period volume moving average (per visible index)
      const MA_PERIOD = 20;
      const volMA: number[] = new Array(visible.length);
      for (let i = 0; i < visible.length; i++) {
        const s = Math.max(0, i - MA_PERIOD + 1);
        let sum = 0; for (let j = s; j <= i; j++) sum += visible[j].v;
        volMA[i] = sum / (i - s + 1);
      }
      const lastMA = volMA[visible.length - 1] ?? 0;

      // ── Draw bars ────────────────────────────────────────────────
      for (let i = 0; i < visible.length; i++) {
        const c = visible[i];
        const x = idxToX(startIdx + i);
        if (x - cw / 2 < chartLeft || x - cw / 2 > chartRight) continue;
        const isBullV = c.c >= c.o;
        const barH = Math.max(1, (c.v / maxVol) * volH);
        const barTop = volTop + volH - barH;
        const isSpike = volMA[i] > 0 && c.v > volMA[i] * 1.5;

        // Spike bars = full opacity; normal = muted
        ctx.fillStyle = isSpike
          ? (isBullV ? 'rgba(38,166,154,0.88)' : 'rgba(239,83,80,0.88)')
          : (isBullV ? CFG.VOL_BULL : CFG.VOL_BEAR);
        ctx.fillRect(x - cw / 2, barTop, cw, barH);

        // Thin border highlight on spike bars
        if (isSpike && cw >= 4) {
          ctx.save();
          ctx.strokeStyle = isBullV ? '#26a69a' : '#ef5350';
          ctx.lineWidth = 0.8;
          ctx.globalAlpha = 0.7;
          ctx.strokeRect(x - cw / 2, barTop, cw, barH);
          ctx.restore();
        }
      }

      // ── Volume MA line (amber dashed) ─────────────────────────────
      ctx.save();
      ctx.strokeStyle = 'rgba(251,191,36,0.50)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      let maLineStarted = false;
      for (let i = 0; i < visible.length; i++) {
        const x = idxToX(startIdx + i);
        if (x - cw / 2 < chartLeft || x - cw / 2 > chartRight) continue;
        const maY = volTop + volH - Math.max(0, (volMA[i] / maxVol) * volH);
        if (!maLineStarted) { ctx.moveTo(x, maY); maLineStarted = true; }
        else ctx.lineTo(x, maY);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // ── Volume axis labels ─────────────────────────────────────────
      ctx.fillStyle = 'rgba(100,116,139,0.55)';
      ctx.font = '8px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('VOL', 3, volTop + 9);

      // Max vol (top of axis) and MA vol label on right
      ctx.font = '8px monospace';
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(100,116,139,0.50)';
      if (maxVol > 1) ctx.fillText(fmtNum(maxVol), chartRight - 2, volTop + 9);
      // MA label
      ctx.fillStyle = 'rgba(251,191,36,0.55)';
      if (lastMA > 0) ctx.fillText(`MA ${fmtNum(Math.round(lastMA))}`, chartRight - 2, volTop + 19);
    }

    // ── BOS / ChoCh MARKERS ─────────────────────────────────────────────
    // Rendering order: BOS first (less important), ChoCh on top (more important)
    // BOS  = break of market structure, continuation signal     → dashed, thinner
    // ChoCh= change of character, REVERSAL signal               → solid, thicker, bright
    for (const ev of strongStructure) {
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

      // Quality multiplier: HIGH = full visible, LOW = very faint (ghost)
      const evQuality = ev.quality ?? 'HIGH';
      const _qMult = evQuality === 'HIGH' ? 1.0 : 0.32;

      // Approach detection — structure line glows when price is near this level
      const strProx = lineProx(ev.level);
      if (strProx !== 'off') alertZones.push({
        label: `${evQuality === 'HIGH' ? '★' : ''}${isChoCh ? 'CHoCH' : 'BOS'}`,
        color,
      });

      // Line — sharp glow when price approaching
      ctx.save();
      if (strProx !== 'off') { ctx.shadowColor = color; ctx.shadowBlur = strProx === 'hot' ? 12 + 8 * _pF : 5; }
      ctx.strokeStyle = color;
      ctx.lineWidth   = isChoCh
        ? (strProx === 'hot' ? 3.5 + _pM : strProx === 'warm' ? 2.5 : 1)
        : (strProx === 'hot' ? 2 + _pM * 0.6 : strProx === 'warm' ? 1.4 : 0.7);
      ctx.setLineDash(isChoCh ? [] : [5, 4]);
      ctx.globalAlpha = (strProx === 'hot' ? 0.75 + 0.25 * _pF : strProx === 'warm' ? (isChoCh ? 0.65 : 0.50) : (isChoCh ? 0.20 : 0.16)) * _qMult;
      ctx.beginPath();
      ctx.moveTo(evX, evY);
      ctx.lineTo(chartRight, evY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.restore();

      // Vertical tick at the break candle (shows exact break point)
      const tickLen = isChoCh ? 8 : 5;
      ctx.strokeStyle = color;
      ctx.lineWidth = isChoCh ? 2 : 1.5;
      ctx.globalAlpha = (isChoCh ? 1 : 0.8) * _qMult;
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
      ctx.globalAlpha = (isChoCh ? 1 : 0.8) * _qMult;
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

      // Label pill — ★ for HIGH quality CHoCH; displacement % shown when significant
      // LOW-quality events: only show label when price is approaching (not on every candle)
      const evDisp = ev.displacement ?? 0;
      const dispStr = evQuality === 'HIGH' && evDisp >= 0.003 ? ` +${(evDisp * 100).toFixed(1)}%` : '';
      const starStr = evQuality === 'HIGH' ? '★' : '';
      const label = isChoCh
        ? (isBull ? `${starStr}CHoCH ↑${dispStr}` : `${starStr}CHoCH ↓${dispStr}`)
        : (isBull ? `BOS ↑${dispStr}` : `BOS ↓${dispStr}`);
      const pushTag = eventPushTag(ev.idx);
      drawLineTag(evY, label, color, !isBull, 0.92 * _qMult);
      if (pushTag) drawCenterCount(evY, pushTag, color, !isBull, 0.92 * _qMult, false, isChoCh ? 'CH' : 'BOS');
      // Label centred on the break candle, above (bull) or below (bear) the arrow
      {
        const bgColor = (isChoCh && evQuality === 'HIGH') ? color : `${color}28`;
        const fgColor = (isChoCh && evQuality === 'HIGH') ? '#0d1117' : color;
        drawLabel(evX, isBull ? evY - 22 : evY + 22, label, fgColor, bgColor);
      }
      // Predictive forecast when price revisits this structure level
      if (shouldPredict(ev.level, ev.level)) {
        const strTop = ev.level * 1.0005;
        const strBot = ev.level * 0.9995;
        const pred   = predictZoneOutcome(strTop, strBot, candles, effectiveSpot, structure, true, 1, 0);
        drawPredTag(evY, pred, !isBull);
      }
    }

    // ── INDUCEMENT MARKERS (Equal H/L) ──────────────────────────────
    for (const ind of strongInducements) {
      const indX = idxToX(ind.idx);
      if (indX < chartLeft || indX > chartRight) continue;
      const indY = priceToY(ind.level);
      if (indY < chartTop || indY > chartBottom) continue;

      const isHigh  = ind.side === 'high';
      const offsetY = isHigh ? -10 : 10;
      const markerY = indY + offsetY;
      const indPremium = ind.quality === 'PREMIUM';

      // Approach detection — diamond + label glow when price near this equal H/L
      const indProx = lineProx(ind.level);
      if (indProx !== 'off') alertZones.push({
        label: `${indPremium ? '★' : ''}${isHigh ? 'EQH' : 'EQL'}${indPremium ? `×${ind.touches}` : ''}`,
        color: CFG.IND_COLOR,
      });
      // PREMIUM = larger diamond, STANDARD = normal size, both grow on approach
      const iSize = indPremium
        ? (indProx !== 'off' ? 7 + 2 * _pM : 5.5)
        : (indProx !== 'off' ? 5 + 1.5 * _pM : 4);

      // Diamond marker — grows + glows on approach; PREMIUM always brighter
      ctx.save();
      if (indProx !== 'off') { ctx.shadowColor = CFG.IND_COLOR; ctx.shadowBlur = indProx === 'hot' ? 8 + 5 * _pF : 3; }
      ctx.fillStyle   = CFG.IND_COLOR;
      ctx.globalAlpha = indProx === 'hot'
        ? 0.85 + 0.15 * _pF
        : indProx === 'warm'
          ? (indPremium ? 0.75 : 0.60)
          : (indPremium ? 0.55 : 0.28);
      ctx.beginPath();
      ctx.moveTo(indX, markerY - iSize);
      ctx.lineTo(indX + iSize * 0.75, markerY);
      ctx.lineTo(indX, markerY + iSize);
      ctx.lineTo(indX - iSize * 0.75, markerY);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.restore();

      // Label above diamond (EQH) or below (EQL), centred on its candle
      const touchStr = ind.touches >= 3 ? `×${ind.touches}` : '';
      const tag = (indPremium ? '★' : '') + (isHigh ? 'EQH' : 'EQL') + touchStr;
      const indPushTag = eventPushTag(ind.idx);
      drawLineTag(indY, tag, CFG.IND_COLOR, !isHigh, 0.9);
      if (indPushTag) drawCenterCount(indY, indPushTag, CFG.IND_COLOR, !isHigh, 0.9, false, isHigh ? 'EQH' : 'EQL');
      drawLabel(indX, isHigh ? markerY - 10 : markerY + 10, tag, CFG.IND_COLOR, 'rgba(122,143,168,0.20)');
      // Predictive forecast for equal high/low clusters (liquidity magnets)
      if (shouldPredict(ind.level, ind.level)) {
        const indTop = ind.level * 1.0005;
        const indBot = ind.level * 0.9995;
        const pred   = predictZoneOutcome(indTop, indBot, candles, effectiveSpot, structure, true, ind.touches, 0);
        drawPredTag(indY + offsetY, pred, !isHigh);
      }
    }

    // Fractal markers intentionally hidden from chart rendering to avoid weak/noisy signals.

    // ── APPROACH ALERT BANNER ─────────────────────────────────────────────────
    // Floats near the top of the chart area when price is near key zones.
    // Deduplicates labels; border pulses with the zone color.
    {
      const seen = new Set<string>();
      const uniq = alertZones
        .filter(z => { if (seen.has(z.label)) return false; seen.add(z.label); return true; })
        .slice(0, 6);
      if (uniq.length > 0) {
        const bannerText = `⚡  ${uniq.map(z => z.label).join('  ·  ')}`;
        ctx.font = 'bold 9.5px sans-serif';
        const bw = ctx.measureText(bannerText).width + 20;
        const bh = 20;
        const bx = Math.max(chartLeft + 4, chartLeft + (chartW - bw) / 2);
        const by = chartTop + 8;
        ctx.save();
        // Dark translucent background
        ctx.globalAlpha = 0.88;
        ctx.fillStyle   = 'rgba(8, 10, 22, 0.92)';
        roundRect(ctx, bx, by, bw, bh, 6);
        ctx.fill();
        // Pulsing glow border
        ctx.shadowColor = uniq[0].color;
        ctx.shadowBlur  = 8 + 6 * _pF;
        ctx.strokeStyle = uniq[0].color;
        ctx.lineWidth   = 1.5;
        ctx.globalAlpha = 0.65 + 0.35 * _pF;
        roundRect(ctx, bx, by, bw, bh, 6);
        ctx.stroke();
        ctx.shadowBlur  = 0;
        // White text
        ctx.globalAlpha = 0.9 + 0.1 * _pF;
        ctx.fillStyle   = '#f1f5f9';
        ctx.textAlign   = 'left';
        ctx.fillText(bannerText, bx + 10, by + bh - 5);
        ctx.restore();
      }
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

    // ── CURRENT PRICE BADGE (drawn after axis bg so it always sits on top) ──
    if (effectiveSpot > 0) {
      const y = priceToY(effectiveSpot);
      if (y >= chartTop && y <= chartBottom) {
        const isLive = dataSourceRef.current === 'LIVE';
        // Green if price ≥ current candle open (up), red if below (down)
        const lastOpen = visible.length > 0 ? visible[visible.length - 1].o : effectiveSpot;
        const isUp = effectiveSpot >= lastOpen;
        const badgeBg   = isLive ? (isUp ? '#22c55e' : '#ef4444') : '#7a60b0';
        const textColor = '#ffffff';
        // Glow
        ctx.save();
        ctx.shadowColor = badgeBg;
        ctx.shadowBlur = isLive ? 18 : 10;
        ctx.fillStyle = badgeBg;
        roundRect(ctx, chartRight + 1, y - 12, CFG.PRICE_AXIS_W - 3, 24, 5);
        ctx.fill();
        ctx.restore();
        // Price text
        ctx.fillStyle = textColor;
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(fmtPrice(effectiveSpot), chartRight + (CFG.PRICE_AXIS_W - 2) / 2, y + 4);
      }
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
      const cIdx = Math.round((mx - anchorX) / candleStep + centreIdx - startIdx);
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

    // Scene rendered successfully — clear dirty flag until next data/interaction change
    dirtyRef.current = false;
  }, []);

  // Reset view when chart identity changes (symbol or timeframe switch).
  // This ensures candles are correctly anchored at the right edge on every TF switch.
  useEffect(() => {
    smoothMinRef.current = 0;
    smoothMaxRef.current = 0;
    lastCanvasW.current = 0; // force canvas resize on next frame
    // Reset pan/scroll so latest candle anchors at 78% position on every TF change
    scrollRef.current = 0;
    pixelPanRef.current = 0;
    dirtyRef.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartKey]);

  // ── Adaptive RAF loop — active drag/zoom gets high fps, idle is throttled ──
  useEffect(() => {
    let rafId: number;
    const loop = (ts: number) => {
      if (typeof document !== 'undefined' && document.hidden) {
        rafId = requestAnimationFrame(loop);
        return;
      }
      const interacting = isDragging.current || isVDragging.current;
      const targetFps = interacting ? 60 : 24;
      const minDt = 1000 / targetFps;
      const dt = ts - lastFrameTsRef.current;
      const mustRender = dirtyRef.current || interacting;
      if (mustRender && dt >= minDt) {
        lastFrameTsRef.current = ts;
        render();
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [render]);

  // Mark scene dirty when data changes (no callback recreation needed)
  useEffect(() => {
    markDirty();
  }, [candles, fvg, ob, liquidity, levels, spot, liveSpot, structure, inducements, fractals, dataSource, prioritySetups, markDirty]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Reset cached size so render() re-measures on next RAF tick
    const ro = new ResizeObserver(() => {
      lastCanvasW.current = 0;
      markDirty();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [markDirty]);

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
      markDirty();
    }
    // Crosshair movement also needs redraw
    markDirty();
  }, [markDirty]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      isDragging.current = true;
      dragStartX.current = e.clientX;
      dragStartScroll.current = scrollRef.current;
      dragStartPixelPan.current = pixelPanRef.current;
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
    isVDragging.current = false;
    markDirty();
  }, [markDirty]);

  const handleMouseLeave = useCallback(() => {
    mouseRef.current = { x: -1, y: -1 };
    isDragging.current = false;
    isVDragging.current = false;
    markDirty();
  }, [markDirty]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  const handleDblClick = useCallback(() => {
    candleWRef.current = CFG.CANDLE_W;
    candleGapRef.current = CFG.CANDLE_GAP;
    vScaleRef.current = 1;
    scrollRef.current = 0;
    pixelPanRef.current = 0;
    markDirty();
  }, [markDirty]);

  // ── Native listeners: wheel + touch (must be passive:false to preventDefault) ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const candleStep = candleWRef.current + candleGapRef.current;
      const rect = canvas.getBoundingClientRect();
      const chartRight = rect.width - CFG.PRICE_AXIS_W;
      const chartW = chartRight; // chartLeft=0
      const n = candlesRef.current.length;
      const centreIdxBefore = n - 1 - Math.max(0, scrollRef.current);
      // Mirror dual-mode anchor from render()
      const centeredAnchorX = chartW / 2 + ((n - 1) * candleStep) / 2;
      const defaultAnchorX  = Math.round(chartW * 0.78);
      const centreXBefore = Math.min(centeredAnchorX, defaultAnchorX) - pixelPanRef.current;
      const mouseX = e.clientX - rect.left;
      const anchorArrayIdxBefore = centreIdxBefore + (mouseX - centreXBefore) / candleStep;

      if (e.ctrlKey || e.metaKey) {
        // Ctrl/Cmd + scroll → vertical zoom (price scale)
        const factor = e.deltaY > 0 ? 0.88 : 1.14;
        vScaleRef.current = Math.max(0.25, Math.min(8, vScaleRef.current * factor));
      } else if (e.shiftKey || e.altKey) {
        // Shift/Alt + scroll → horizontal pan (scroll through history)
        const px = e.deltaY * 1.2;
        const totalPx = Math.max(0, scrollRef.current * candleStep + pixelPanRef.current + px);
        scrollRef.current = Math.floor(totalPx / candleStep);
        pixelPanRef.current = totalPx % candleStep;
      } else {
        // Plain scroll → zoom candle width (TradingView default — cursor-anchored)
        const factor = e.deltaY > 0 ? 0.88 : 1.14;
        candleWRef.current = Math.max(2, Math.min(40, candleWRef.current * factor));
        candleGapRef.current = Math.max(1, Math.round(candleWRef.current * 0.43));

        // Cursor-anchored zoom: keep candle under cursor stable like TradingView
        const newStep = candleWRef.current + candleGapRef.current;
        const centreIdxNeeded = anchorArrayIdxBefore - (mouseX - Math.round(chartW * 0.78)) / newStep;
        const rawScroll = (candlesRef.current.length - 1) - centreIdxNeeded;
        const maxScroll = Math.max(0, candlesRef.current.length - 1);
        scrollRef.current = Math.max(0, Math.min(maxScroll, Math.floor(rawScroll)));
        pixelPanRef.current = 0;
      }
      markDirty();
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
        // Update crosshair position for OHLCV tooltip while dragging
        const rect = canvas.getBoundingClientRect();
        mouseRef.current = { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
        markDirty();
      } else if (e.touches.length === 2) {
        // Pinch = horizontal zoom (candle width) — cursor-anchored on midpoint
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const ratio = tDist > 0 ? dist / tDist : 1;
        candleWRef.current = Math.max(2, Math.min(40, tCW * ratio));
        candleGapRef.current = Math.max(1, Math.round(candleWRef.current * 0.43));
        pixelPanRef.current = 0;
        // Show crosshair at pinch midpoint
        const rect = canvas.getBoundingClientRect();
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
        mouseRef.current = { x: midX, y: midY };
        markDirty();
      }
    };

    const onTouchEnd = () => {
      touchDir = null;
      // Clear crosshair when finger lifts
      mouseRef.current = { x: -1, y: -1 };
      markDirty();
    };

    // Global mouseup — stops pan/scale even when mouse released outside canvas
    const onDocMouseUp = () => {
      if (isDragging.current || isVDragging.current) {
        isDragging.current = false;
        isVDragging.current = false;
        markDirty();
      }
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: true });
    document.addEventListener('mouseup', onDocMouseUp);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('mouseup', onDocMouseUp);
    };
  }, [markDirty]);

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
      {/* onMouseDown stops propagation so clicks here never start canvas drag */}
      <div
        className="absolute bottom-7 right-20 flex items-center gap-1 pointer-events-none"
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Zoom out (candle width) */}
        <button
          className="pointer-events-auto w-8 h-8 sm:w-6 sm:h-6 rounded bg-slate-800/90 border border-slate-600/50 text-slate-300 text-sm sm:text-xs flex items-center justify-center hover:bg-slate-700/90 active:scale-95 transition-all"
          title="Zoom out (candles) · or use mouse wheel"
          onClick={() => { candleWRef.current = Math.max(2, candleWRef.current * 0.8); candleGapRef.current = Math.max(1, Math.round(candleWRef.current * 0.43)); pixelPanRef.current = 0; markDirty(); }}
          onTouchEnd={e => { e.stopPropagation(); e.preventDefault(); candleWRef.current = Math.max(2, candleWRef.current * 0.8); candleGapRef.current = Math.max(1, Math.round(candleWRef.current * 0.43)); pixelPanRef.current = 0; markDirty(); }}
        >−</button>
        {/* Zoom in (candle width) */}
        <button
          className="pointer-events-auto w-8 h-8 sm:w-6 sm:h-6 rounded bg-slate-800/90 border border-slate-600/50 text-slate-300 text-sm sm:text-xs flex items-center justify-center hover:bg-slate-700/90 active:scale-95 transition-all"
          title="Zoom in (candles) · or use mouse wheel"
          onClick={() => { candleWRef.current = Math.min(40, candleWRef.current * 1.25); candleGapRef.current = Math.max(1, Math.round(candleWRef.current * 0.43)); pixelPanRef.current = 0; markDirty(); }}
          onTouchEnd={e => { e.stopPropagation(); e.preventDefault(); candleWRef.current = Math.min(40, candleWRef.current * 1.25); candleGapRef.current = Math.max(1, Math.round(candleWRef.current * 0.43)); pixelPanRef.current = 0; markDirty(); }}
        >+</button>
        {/* Vertical zoom in (price scale) */}
        <button
          className="pointer-events-auto w-8 h-8 sm:w-6 sm:h-6 rounded bg-slate-800/90 border border-slate-600/50 text-slate-400 text-[10px] sm:text-[9px] flex items-center justify-center hover:bg-slate-700/90 active:scale-95 transition-all"
          title="Expand price scale (vertical zoom in) · or Ctrl+wheel"
          onClick={() => { vScaleRef.current = Math.min(8, vScaleRef.current * 1.3); markDirty(); }}
          onTouchEnd={e => { e.stopPropagation(); e.preventDefault(); vScaleRef.current = Math.min(8, vScaleRef.current * 1.3); markDirty(); }}
        >↕+</button>
        {/* Vertical zoom out (price scale) */}
        <button
          className="pointer-events-auto w-8 h-8 sm:w-6 sm:h-6 rounded bg-slate-800/90 border border-slate-600/50 text-slate-400 text-[10px] sm:text-[9px] flex items-center justify-center hover:bg-slate-700/90 active:scale-95 transition-all"
          title="Compress price scale (vertical zoom out) · or Ctrl+wheel"
          onClick={() => { vScaleRef.current = Math.max(0.25, vScaleRef.current * 0.77); markDirty(); }}
          onTouchEnd={e => { e.stopPropagation(); e.preventDefault(); vScaleRef.current = Math.max(0.25, vScaleRef.current * 0.77); markDirty(); }}
        >↕−</button>
        {/* Scroll left (older) */}
        <button
          className="pointer-events-auto w-8 h-8 sm:w-6 sm:h-6 rounded bg-slate-800/90 border border-slate-600/50 text-slate-300 text-sm sm:text-xs flex items-center justify-center hover:bg-slate-700/90 active:scale-95 transition-all"
          title="Scroll to older candles · or drag left"
          onClick={() => { scrollRef.current = Math.min(scrollRef.current + 10, 9999); markDirty(); }}
          onTouchEnd={e => { e.stopPropagation(); e.preventDefault(); scrollRef.current = Math.min(scrollRef.current + 10, 9999); markDirty(); }}
        >‹</button>
        {/* Scroll right (newer) */}
        <button
          className="pointer-events-auto w-8 h-8 sm:w-6 sm:h-6 rounded bg-slate-800/90 border border-slate-600/50 text-slate-300 text-sm sm:text-xs flex items-center justify-center hover:bg-slate-700/90 active:scale-95 transition-all"
          title="Scroll to latest · or drag right"
          onClick={() => { scrollRef.current = Math.max(0, scrollRef.current - 10); pixelPanRef.current = 0; markDirty(); }}
          onTouchEnd={e => { e.stopPropagation(); e.preventDefault(); scrollRef.current = Math.max(0, scrollRef.current - 10); pixelPanRef.current = 0; markDirty(); }}
        >›</button>
        {/* Reset */}
        <button
          className="pointer-events-auto w-8 h-8 sm:w-6 sm:h-6 rounded bg-slate-800/90 border border-slate-600/50 text-slate-400 text-[10px] sm:text-[9px] flex items-center justify-center hover:bg-slate-700/90 active:scale-95 transition-all"
          title="Reset zoom & scroll · or double-click chart"
          onClick={() => { candleWRef.current = CFG.CANDLE_W; candleGapRef.current = CFG.CANDLE_GAP; vScaleRef.current = 1; scrollRef.current = 0; pixelPanRef.current = 0; markDirty(); }}
          onTouchEnd={e => { e.stopPropagation(); e.preventDefault(); candleWRef.current = CFG.CANDLE_W; candleGapRef.current = CFG.CANDLE_GAP; vScaleRef.current = 1; scrollRef.current = 0; pixelPanRef.current = 0; markDirty(); }}
        >⟳</button>
        {/* Maximize */}
        {onMaximize && (
          <button
            className="pointer-events-auto w-8 h-8 sm:w-6 sm:h-6 rounded bg-slate-800/90 border border-slate-600/50 text-slate-400 text-[11px] sm:text-[10px] flex items-center justify-center hover:bg-indigo-600/70 hover:text-white hover:border-indigo-500/60 active:scale-95 transition-all"
            title="Maximize chart (fullscreen view)"
            onClick={() => onMaximize()}
            onTouchEnd={e => { e.stopPropagation(); e.preventDefault(); onMaximize(); }}
          >⛶</button>
        )}
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
  structure: StructureEvent[]    = [],
  inducements: InducementPoint[] = [],
  fractals: FractalPoint[]       = [],
  liveSpot?: number,   // real-time tick price — may differ from last candle close
): { signal: ChartSignal; score: number } {
  if (candles.length < 5 || spot <= 0) return { signal: 'NEUTRAL', score: 0 };

  let score = 0;
  const N = candles.length;

  // ── 1. SWING STRUCTURE (±30) ─────────────────────────────────────────────
  // HH/HL sequence = uptrend; LH/LL = downtrend
  // FIX: Weight swing points in the RECENT half of the 20-candle window 2×
  // so a reversal in the last 10 candles immediately shifts the score.
  const sc = candles.slice(-20);
  let lastSH = -Infinity, lastSL = Infinity;
  let hh = 0, hl = 0, lh = 0, ll = 0;
  const midIdx = Math.floor(sc.length / 2);
  for (let i = 1; i < sc.length - 1; i++) {
    const p = sc[i - 1], c = sc[i], n = sc[i + 1];
    // Candles in the recent half get 2× weight (they reflect the current move)
    const w = i >= midIdx ? 2 : 1;
    if (c.h > p.h && c.h > n.h) {
      if (lastSH > -Infinity) { if (c.h > lastSH) hh += w; else lh += w; }
      lastSH = c.h;
    }
    if (c.l < p.l && c.l < n.l) {
      if (lastSL < Infinity)  { if (c.l > lastSL) hl += w; else ll += w; }
      lastSL = c.l;
    }
  }
  let swingScore = (hh * 4 + hl * 3) - (lh * 3 + ll * 4);
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
  const window20 = candles.slice(-20);
  const recentHigh = Math.max(...window20.map(c => c.h));
  const recentLow  = Math.min(...window20.map(c => c.l));
  const hiRef = pdh > 0 ? pdh : recentHigh;
  const loRef = pdl > 0 ? pdl : recentLow;

  if (spot > hiRef * 1.001)      lvl += 14;
  else if (spot > hiRef)         lvl += 7;
  else if (spot < loRef * 0.999) lvl -= 14;
  else if (spot < loRef)         lvl -= 7;
  else {
    const range = hiRef - loRef;
    if (range > 0) lvl += ((spot - loRef) / range - 0.5) * 16;
  }
  if (cdh > 0 && cdl > 0) {
    const dayRange = cdh - cdl;
    if (spot >= cdh * 0.9998)      lvl += 9;
    else if (spot <= cdl * 1.0002) lvl -= 9;
    else if (dayRange > 0)         lvl += ((spot - cdl) / dayRange - 0.5) * 8;
  } else if (cdh > 0 && spot >= cdh * 0.9998) { lvl += 9; }
    else if (cdl > 0 && spot <= cdl * 1.0002) { lvl -= 9; }

  const nearRes = resistance.length > 0 ? resistance[resistance.length - 1] : 0;
  const nearSup = support.length > 0 ? support[0] : 0;
  if (nearRes > 0) { if (spot > nearRes * 1.001) lvl += 5; else if (spot > nearRes * 0.997) lvl -= 3; }
  if (nearSup > 0) { if (spot < nearSup * 0.999) lvl -= 5; else if (spot < nearSup * 1.003) lvl += 3; }
  score += Math.min(25, Math.max(-25, lvl));

  // ── 3. BOS / CHoCH STRUCTURE EVENTS (±22) ────────────────────────────────
  // CHoCH = character change (reversal signal) — stronger than BOS (continuation)
  // Only the last ~15 events matter; recency amplifies weight.
  let bosRaw = 0;
  const recentStructure = structure.slice(-15);
  for (const ev of recentStructure) {
    const age = N - ev.idx;                               // candles ago
    const recency = age <= 3 ? 2.0 : age <= 8 ? 1.5 : age <= 15 ? 1.0 : 0.5;
    const isChoch  = ev.type === 'CHOCH_BULL' || ev.type === 'CHOCH_BEAR';
    const weight   = isChoch ? 8 : 5;                     // CHoCH > BOS
    if (ev.type === 'BOS_BULL' || ev.type === 'CHOCH_BULL') bosRaw += weight * recency;
    else                                                    bosRaw -= weight * recency;
  }
  score += Math.min(22, Math.max(-22, bosRaw));

  // ── 4. FVG ZONES (±20) ───────────────────────────────────────────────────
  let fvgRaw = 0;
  for (const f of fvg) {
    if (f.filled) continue;
    const mid = (f.top + f.bottom) / 2;
    const distPct = Math.abs(mid - spot) / spot;
    const prox = distPct < 0.003 ? 3 : distPct < 0.008 ? 2 : 1;
    const str = f.strength ?? 1;
    if (f.type === 'bullish') {
      if (spot >= f.bottom && spot <= f.top) fvgRaw += 8 * str;
      else if (mid < spot)                   fvgRaw += 3 * prox * str;
      else                                   fvgRaw += 1.5 * prox * str;
    } else {
      if (spot >= f.bottom && spot <= f.top) fvgRaw -= 8 * str;
      else if (mid > spot)                   fvgRaw -= 3 * prox * str;
      else                                   fvgRaw -= 2 * prox * str;
    }
  }
  score += Math.min(20, Math.max(-20, fvgRaw));

  // ── 5. ORDER BLOCK ANALYSIS (±18) ────────────────────────────────────────
  let obRaw = 0;
  for (const o of ob) {
    if (o.mitigated) continue;
    const mid = (o.high + o.low) / 2;
    const distPct = Math.abs(mid - spot) / spot;
    if (distPct > 0.025) continue;
    const prox = distPct < 0.003 ? 3 : distPct < 0.01 ? 2 : 1;
    const str = o.strength ?? 1;
    if (o.type === 'bullish') {
      obRaw += mid < spot ? 5 * prox * str : -2 * prox * str;
    } else {
      obRaw -= mid > spot ? 5 * prox * str : 2 * prox * str;
    }
  }
  score += Math.min(18, Math.max(-18, obRaw));

  // ── 6. LIQUIDITY SWEEP ANALYSIS (±18) ────────────────────────────────────
  // Swept SSL = smart money absorbed sell stops → bullish reversal
  // Swept BSL = smart money absorbed buy stops  → bearish reversal
  // Unswept BSL above / SSL below = price magnets
  let liqRaw = 0;
  for (const l of liquidity) {
    if (l.swept) {
      const age = l.sweepIdx !== null ? N - (l.sweepIdx ?? N) : N;
      const recency = age <= 3 ? 2.5 : age <= 6 ? 2.0 : age <= 12 ? 1.5 : 1.0;
      liqRaw += l.type === 'sell_side' ? 6 * recency : -6 * recency;
    } else {
      const distPct = Math.abs(l.level - spot) / spot;
      if (distPct > 0.03) continue;
      const prox = distPct < 0.005 ? 2 : 1;
      if (l.type === 'buy_side'  && l.level > spot) liqRaw += 2 * prox;
      if (l.type === 'sell_side' && l.level < spot) liqRaw -= 2 * prox;
      if (l.touchCount > 2) liqRaw += l.type === 'buy_side' ? 1.5 : -1.5;
    }
  }
  score += Math.min(18, Math.max(-18, liqRaw));

  // ── 7. FRACTALS (±10) ────────────────────────────────────────────────────
  // A recent fractal top just above spot = resistance/liquidity wall
  // A recent fractal bottom just below spot = support / demand
  // Breakout: price just closed ABOVE a fractal top = bullish
  // Breakdown: price just closed BELOW a fractal bottom = bearish
  let fracRaw = 0;
  const lastClose = candles[N - 1]?.c ?? spot;
  for (const fr of fractals) {
    const age = N - 1 - fr.idx;
    if (age > 30) continue;                               // only recent fractals matter
    const recency = age <= 3 ? 2.0 : age <= 10 ? 1.5 : 1.0;
    const distPct = Math.abs(fr.price - spot) / spot;
    if (fr.type === 'top') {
      if (lastClose > fr.price && distPct < 0.005) fracRaw += 5 * recency; // broke above top fractal
      else if (fr.price > spot && distPct < 0.01)  fracRaw -= 2 * recency; // fractal top overhead = resistance
    } else {
      if (lastClose < fr.price && distPct < 0.005) fracRaw -= 5 * recency; // broke below bot fractal
      else if (fr.price < spot && distPct < 0.01)  fracRaw += 2 * recency; // fractal bottom below = support
    }
  }
  score += Math.min(10, Math.max(-10, fracRaw));

  // ── 8. INDUCEMENTS / EQH-EQL (±8) ────────────────────────────────────────
  // Equal highs above = liquidity pool — price drawn to tap them = mild bullish bias
  // Equal lows below  = liquidity pool — price drawn to tap them = mild bearish bias
  // Very close = strong magnet; already tapped / below spot = price came from there = structural cue
  let indRaw = 0;
  for (const ind of inducements) {
    const age = N - 1 - ind.idx;
    if (age > 40) continue;
    const distPct = Math.abs(ind.level - spot) / spot;
    if (distPct > 0.03) continue;
    const prox = distPct < 0.004 ? 3 : distPct < 0.012 ? 2 : 1;
    if (ind.side === 'high' && ind.level > spot) indRaw += 2 * prox;  // EQH above = upside draw
    if (ind.side === 'low'  && ind.level < spot) indRaw -= 2 * prox;  // EQL below = downside draw
    // Price already through the EQ level → structural shift confirmation
    if (ind.side === 'high' && ind.level < spot) indRaw += 1;
    if (ind.side === 'low'  && ind.level > spot) indRaw -= 1;
  }
  score += Math.min(8, Math.max(-8, indRaw));

  // ── 9. CANDLE MOMENTUM (±14) ────────────────────────────────────────────────
  // Body-weighted direction of last 6 candles; last 2 candles get 3× weight.
  let momRaw = 0;
  const recent = candles.slice(-6);
  for (let i = 0; i < recent.length; i++) {
    const c = recent[i];
    // Last 2 candles are 3× more important (they are the most recent completed bars)
    const weight = i >= recent.length - 2 ? 3 : 1;
    const body = Math.abs(c.c - c.o);
    const range = (c.h - c.l) || 1;
    const bodyRatio = body / range;
    const dir = c.c > c.o ? 1 : c.c < c.o ? -1 : 0;
    momRaw += dir * weight * (0.5 + bodyRatio * 0.5);
  }
  score += Math.min(14, Math.max(-14, momRaw * 1.6));

  // ── 10. LIVE SPOT MOMENTUM (±35) — HIGHEST-PRIORITY, REAL-TIME ──────────
  //
  // ROOT-CAUSE FIX for “still shows STRONG SELL during 30-min rally”:
  // The candle array only refreshes every 10s from Zerodha API. During an
  // intraday reversal, liveSpot (from WebSocket, every ~0.5s) races ahead of
  // the stale closes. This factor measures that gap — it fires immediately
  // on every liveSpot tick, independent of candle-refresh latency.
  //
  // Comparison points:
  //   A) vs last candle close (most immediate — current bar direction)
  //   B) vs candle[-2].close  (one completed bar ago — short-term trend)
  //   C) vs candle[-4].close  (4 bars ago — ~12–20 min intraday trend)
  //   D) vs candle[-8].close  (8 bars ago — ~24–40 min reversal window)
  //
  // For each, the magnitude of the price move is bucketed into point tiers.
  // All four are summed with recency weighting (A most recent = 4×).
  if (liveSpot && liveSpot > 0 && candles.length >= 2) {
    let liveRaw = 0;

    const anchors: { idx: number; weight: number }[] = [
      { idx: candles.length - 1, weight: 4 },   // A: last close (current bar)
      { idx: candles.length - 2, weight: 3 },   // B: 1 bar ago
      { idx: Math.max(0, candles.length - 4), weight: 2 }, // C: ~12–20 min ago
      { idx: Math.max(0, candles.length - 8), weight: 1 }, // D: ~24–40 min ago
    ];

    for (const { idx, weight } of anchors) {
      const anchorClose = candles[idx]?.c;
      if (!anchorClose || anchorClose <= 0) continue;
      const movePct = ((liveSpot - anchorClose) / anchorClose) * 100;

      // Bucket the move into points, with a cap at 12 per anchor
      let pts = 0;
      const abs = Math.abs(movePct);
      if      (abs >= 0.8) pts = 12;
      else if (abs >= 0.5) pts = 9;
      else if (abs >= 0.3) pts = 6;
      else if (abs >= 0.15) pts = 4;
      else if (abs >= 0.05) pts = 2;
      else                  pts = 0;

      liveRaw += movePct >= 0 ? pts * weight : -pts * weight;
    }

    // Normalise: max possible raw = 12*(4+3+2+1) = 120 → cap to ±35
    score += Math.min(35, Math.max(-35, liveRaw / 3.5));
  }

  // ── Map to signal ────────────────────────────────────────────────────
  // Theoretical max ±196 (30+25+22+20+18+18+10+8+14+35).
  // Thresholds tuned so STRONG fires when live momentum confirms chart structure.
  const s = Math.round(score);
  let signal: ChartSignal;
  if (s >= 44)       signal = 'STRONG_BUY';
  else if (s >= 18)  signal = 'BUY';
  else if (s <= -44) signal = 'STRONG_SELL';
  else if (s <= -18) signal = 'SELL';
  else               signal = 'NEUTRAL';

  return { signal, score: s };
}

// ── Symbol Chart Card ───────────────────────────────────────────────────────

const SymbolChartCard = memo<{ data: SymbolChartData | null; name: string; liveSpot?: number; forceChartHeight?: number; fullPage?: boolean }>(({ data, name, liveSpot, forceChartHeight, fullPage = false }) => {
  const [timeframe, setTimeframe] = useState<'1h' | '15m' | '5m' | '3m'>('5m');
  // Chart opens in a dedicated /chart/[symbol] tab — no in-page modal needed.
  const chartH = forceChartHeight ?? CFG.CHART_H;

  const openModal = useCallback(() => {
    const slug = (data?.symbol || name.replace(/\s+/g, '')).toUpperCase();
    window.open(`/chart/${slug}`, '_blank', 'noopener,noreferrer');
  }, [data?.symbol, name]);

  const [signalFlash, setSignalFlash] = useState(false);
  const prevSignalRef = useRef<string>('');
  // Keep last non-empty candles so the chart never flashes "Loading..." on a
  // transient empty update (e.g. 5m API hiccup returns [] for one cycle).
  const prevCandlesRef = useRef<Candle[]>([]);

  // Derive candles for each TF:
  //   1H  = resample 5m × 12  (12×5m = 60m)
  //   15M = resample 3m × 5   (5×3m = 15m)
  //   5M  = direct 5m data
  //   3M  = direct 3m data
  // Sort by timestamp to fix out-of-order candles from backend new-bar appends
  // (backend sometimes appends bars with timestamps earlier than already-fetched candles).
  const candles = useMemo(() => {
    if (!data) return prevCandlesRef.current;
    let raw: Candle[];
    if (timeframe === '1h')  raw = resampleCandles(data.candles5m ?? [], 12);
    else if (timeframe === '15m') raw = resampleCandles(data.candles3m ?? [], 5);
    else if (timeframe === '5m')  raw = data.candles5m ?? [];
    else raw = data.candles3m ?? [];
    // Deduplicate by timestamp and sort chronologically
    const seen = new Set<string>();
    const deduped = raw.filter(c => { if (seen.has(c.t)) return false; seen.add(c.t); return true; });
    const sorted = deduped.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
    // Never replace good candles with an empty array (transient API hiccup guard)
    if (sorted.length > 0) prevCandlesRef.current = sorted;
    return sorted.length > 0 ? sorted : prevCandlesRef.current;
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

  // Williams 5-bar fractals
  const fractals = useMemo(() => computeFractals(candles, 2), [candles]);

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
      fracTop: fractals.filter(f => f.type === 'top').length,
      fracBot: fractals.filter(f => f.type === 'bottom').length,
    };
  }, [fvgList, obList, liqList, fractals]);

  // Chart pattern signal — recomputes on every liveSpot tick (every ~1s)
  // All 10 factors: swing structure, key levels, BOS/CHoCH, FVG, OB, liquidity sweep,
  // fractals, inducements, candle momentum, live-spot real-time momentum.
  const chartSignal = useMemo(() => {
    const effectiveSpot = (liveSpot && liveSpot > 0) ? liveSpot : data?.spot ?? 0;
    return computeChartSignal(
      candles, fvgList, obList, liqList, levels, effectiveSpot,
      structure, inducements, fractals,
      liveSpot,   // pass separately so Factor 10 can compare vs stale candle closes
    );
  }, [candles, fvgList, obList, liqList, levels, liveSpot, data?.spot, structure, inducements, fractals]);

  // Combination setup selector: returns all valid setup matches (deduped).
  const prioritySetups = useMemo(() => {
    return findPrioritySetups(candles, fvgList, obList, liqList, structure);
  }, [candles, fvgList, obList, liqList, structure]);

  // MTF alignment — compare 3m vs 5m signals to measure confluence confidence.
  // Computed independently from the user-selected TF so the badge is always consistent.
  const mtfSignal = useMemo(() => {
    if (!data) return null;
    const effectiveSpot = (liveSpot && liveSpot > 0) ? liveSpot : data.spot ?? 0;
    if (effectiveSpot <= 0) return null;
    const c3 = data.candles3m ?? [];
    const c5 = data.candles5m ?? [];
    if (c3.length < 5 || c5.length < 5) return null;
    const emptyLevels: ChartLevels = { pdh: 0, pdl: 0, cdh: 0, cdl: 0, support: [], resistance: [] };
    const lv = data.levels ?? emptyLevels;
    // Compute lightweight (no structure/fractals) signals for both TFs
    const sig3 = computeChartSignal(c3, data.fvg3m ?? [], data.ob3m ?? [], data.liquidity3m ?? [], lv, effectiveSpot, [], [], [], liveSpot);
    const sig5 = computeChartSignal(c5, data.fvg5m ?? [], data.ob5m ?? [], data.liquidity5m ?? [], lv, effectiveSpot, [], [], [], liveSpot);
    const isBull = (s: ChartSignal) => s === 'STRONG_BUY' || s === 'BUY';
    const isBear = (s: ChartSignal) => s === 'STRONG_SELL' || s === 'SELL';
    const aligned = (isBull(sig3.signal) && isBull(sig5.signal)) || (isBear(sig3.signal) && isBear(sig5.signal));
    const direction: 'bull' | 'bear' | 'split' = aligned ? (isBull(sig3.signal) ? 'bull' : 'bear') : 'split';
    return { sig3: sig3.signal, score3: sig3.score, sig5: sig5.signal, score5: sig5.score, aligned, direction };
  }, [data, liveSpot]);

  // Nearest key level for the intelligence strip
  const nearestLevel = useMemo(() => {
    if (!data?.levels || !data.spot) return null;
    const effectiveSpot = (liveSpot && liveSpot > 0) ? liveSpot : data.spot;
    const candidates: Array<{ label: string; price: number }> = [
      { label: 'PDH', price: levels.pdh },
      { label: 'PDL', price: levels.pdl },
      { label: 'CDH', price: levels.cdh },
      { label: 'CDL', price: levels.cdl },
      ...levels.support.map(s => ({ label: 'SUP', price: s })),
      ...levels.resistance.map(r => ({ label: 'RES', price: r })),
    ].filter(c => c.price > 0);
    if (candidates.length === 0) return null;
    let best = candidates[0];
    let bestDist = Math.abs(best.price - effectiveSpot) / effectiveSpot;
    for (const c of candidates) {
      const d = Math.abs(c.price - effectiveSpot) / effectiveSpot;
      if (d < bestDist) { bestDist = d; best = c; }
    }
    return { ...best, distPct: bestDist * 100, above: best.price > effectiveSpot };
  }, [data, liveSpot, levels]);

  // Trigger flash animation whenever signal category changes
  useEffect(() => {
    if (prevSignalRef.current && prevSignalRef.current !== chartSignal.signal) {
      setSignalFlash(true);
      const t = setTimeout(() => setSignalFlash(false), 600);
      return () => clearTimeout(t);
    }
    prevSignalRef.current = chartSignal.signal;
    return;
  }, [chartSignal.signal]);

  if (!data || candles.length === 0) {
    return (
      <div className={`${fullPage ? '' : 'rounded-xl border border-slate-700/30'} bg-dark-card/50 overflow-hidden`}>
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-700/20">
          <span className="text-[10px] font-bold text-slate-500 tracking-[0.08em] uppercase">{name}</span>
          <div className="ml-auto flex gap-1.5">
            {['1H','15M','5M','3M'].map(tf => (
              <span key={tf} className="w-8 h-5 rounded bg-slate-700/40 animate-pulse inline-block" />
            ))}
          </div>
        </div>
        <div className="flex flex-col items-center justify-center gap-2" style={{ height: chartH }}>
          <div className="w-5 h-5 rounded-full border-2 border-indigo-500/40 border-t-indigo-400 animate-spin" />
          <span className="text-[10px] text-slate-600 font-mono">Waiting for market data…</span>
        </div>
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

  // Determine border tint based on live signal for premium institutional feel
  const signalBorderTint =
    chartSignal.signal === 'STRONG_BUY'  ? 'border-emerald-500/40' :
    chartSignal.signal === 'BUY'         ? 'border-emerald-500/20' :
    chartSignal.signal === 'STRONG_SELL' ? 'border-red-500/40' :
    chartSignal.signal === 'SELL'        ? 'border-red-500/20' :
    'border-slate-700/40';

  return (
    <div className={`${
      fullPage ? '' : `rounded-xl border ${signalBorderTint} transition-colors duration-500`
    } bg-dark-card/60 overflow-hidden flex flex-col`}>

      {/* ─── Header ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col px-3 pt-2.5 pb-2 gap-1.5 border-b border-slate-700/25 bg-slate-900/20 shrink-0">

        {/* Row 1 — Symbol · Price · Change · Source badge */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-bold text-slate-400 tracking-[0.1em] uppercase shrink-0 whitespace-nowrap select-none">
            {name}
          </span>
          <span className="text-[13px] font-mono font-bold text-white shrink-0 tabular-nums">
            {fmtPrice(displayPrice)}
          </span>
          <span className={`text-[10px] font-mono shrink-0 tabular-nums ${changeColor}`}>
            {changeIcon}{Math.abs(change).toFixed(2)}
            <span className="text-[9px] opacity-70 ml-0.5">({changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%)</span>
          </span>
          <span className={`ml-auto text-[9px] font-mono shrink-0 ${sourceColor}`}>
            {sourceLabel}
          </span>
        </div>

        {/* Row 2 — Signal · MTF · TF Tabs (unified, works on all sizes) */}
        <div className="flex items-center gap-1.5 min-w-0">

          {/* Chart Pattern Signal */}
          {(() => {
            const cfg = CHART_SIGNAL_CFG[chartSignal.signal];
            const pulse = chartSignal.signal === 'STRONG_BUY' || chartSignal.signal === 'STRONG_SELL';
            return (
              <span
                title={`Chart pattern score: ${chartSignal.score > 0 ? '+' : ''}${chartSignal.score} · live spot updates every tick`}
                className={`
                  inline-flex items-center gap-1 px-2 py-1 rounded text-[9px] font-bold border shrink-0
                  transition-all duration-300 select-none
                  ${cfg.bg} ${cfg.color} ${cfg.border}
                  ${pulse ? 'animate-pulse' : ''}
                  ${signalFlash ? 'ring-1 ring-white/25 scale-[1.04]' : 'scale-100'}
                `}
              >
                <span className="shrink-0">
                  {chartSignal.signal === 'STRONG_BUY' || chartSignal.signal === 'BUY' ? '▲'
                   : chartSignal.signal === 'STRONG_SELL' || chartSignal.signal === 'SELL' ? '▼' : '●'}
                </span>
                <span className="whitespace-nowrap">{cfg.label}</span>
                <span className="opacity-60 font-mono text-[8px] tabular-nums">
                  {chartSignal.score > 0 ? '+' : ''}{chartSignal.score}
                </span>
              </span>
            );
          })()}

          {/* MTF Alignment */}
          {mtfSignal && (
            <span
              title={`Multi-timeframe: 3M=${mtfSignal.sig3} (${mtfSignal.score3 > 0 ? '+' : ''}${mtfSignal.score3}) · 5M=${mtfSignal.sig5} (${mtfSignal.score5 > 0 ? '+' : ''}${mtfSignal.score5})`}
              className={`
                inline-flex items-center gap-1 px-1.5 py-1 rounded text-[9px] font-bold border shrink-0 select-none
                ${mtfSignal.aligned
                  ? mtfSignal.direction === 'bull'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                    : 'bg-red-500/10 text-red-400 border-red-500/25'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/25'
                }
              `}
            >
              <span>MTF</span>
              <span>{mtfSignal.aligned ? (mtfSignal.direction === 'bull' ? '▲' : '▼') : '⊘'}</span>
            </span>
          )}

          {/* TF Tabs — single unified implementation, works across all breakpoints */}
          <div className="flex rounded-md overflow-hidden border border-slate-700/50 ml-auto shrink-0">
            {(['1h', '15m', '5m', '3m'] as const).map((tf, idx) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                title={{ '1h': 'Macro (1 hour)', '15m': 'Structure (15 min)', '5m': 'Execution (5 min)', '3m': 'Entry (3 min)' }[tf]}
                className={`
                  px-2.5 sm:px-3 py-1.5 text-[10px] font-bold transition-colors select-none
                  ${idx < 3 ? 'border-r border-slate-700/50' : ''}
                  ${timeframe === tf
                    ? 'bg-indigo-500/20 text-indigo-300'
                    : 'text-slate-500 hover:text-slate-300 active:bg-slate-700/30'
                  }
                `}
              >
                {tf.toUpperCase()}
              </button>
            ))}
          </div>

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
        onMaximize={fullPage ? undefined : openModal}
        structure={structure}
        inducements={inducements}
        fractals={fractals}
        htfMode={htfMode}
        chartKey={`${name}-${timeframe}`}
        dataSource={data.dataSource}
        prioritySetups={prioritySetups}
      />

      {/* ─── Intelligence Footer ────────────────────────────────────────── */}
      <div className="px-3 pt-2 pb-2.5 border-t border-slate-700/25 bg-slate-900/30 shrink-0 space-y-1.5">

        {/* ── Row 1: Priority setups + context chips + zone counts ── */}
        <div className="flex flex-wrap items-center gap-1">

          {/* Priority combination setups — most actionable intel */}
          {prioritySetups.map((setup, idx) => (
            <span
              key={`${setup.priority}-${setup.model}-${setup.direction}-${setup.triggerIdx}-${idx}`}
              title={`Entry @ ${fmtPrice(setup.entryLine)} · ${setup.model} overlap`}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border select-none ${
                setup.priority === 1
                  ? 'bg-cyan-500/12 text-cyan-300 border-cyan-400/35'
                  : setup.priority === 2
                    ? 'bg-emerald-500/12 text-emerald-300 border-emerald-400/35'
                    : 'bg-blue-500/12 text-blue-300 border-blue-400/35'
              }`}
            >
              <span className="opacity-60 text-[8px]">P{setup.priority}</span>
              <span>
                {setup.model === 'REVERSAL_SNIPER' ? 'SNIPER'
                  : setup.model === 'CONTINUATION_POWER' ? 'CONT'
                  : 'FLIP'}
              </span>
              <span>{setup.direction === 'bullish' ? '▲' : '▼'}</span>
              <span className="font-mono text-[8px] opacity-75">{setup.confidence}%</span>
            </span>
          ))}

          {/* Last BOS / CHoCH event */}
          {(() => {
            const last = structure.length > 0 ? structure[structure.length - 1] : null;
            if (!last) return null;
            const isChoch = last.type === 'CHOCH_BULL' || last.type === 'CHOCH_BEAR';
            const isBull  = last.type === 'BOS_BULL'   || last.type === 'CHOCH_BULL';
            const age     = candles.length - 1 - last.idx;
            const color   = isChoch ? (isBull ? CFG.CHOCH_BULL : CFG.CHOCH_BEAR) : (isBull ? CFG.BOS_BULL : CFG.BOS_BEAR);
            return (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border select-none"
                style={{ color, background: `${color}10`, borderColor: `${color}35` }}
                title={`${last.type} @ ${fmtPrice(last.level)} · ${age} bars ago · displacement ${((last.displacement ?? 0) * 100).toFixed(2)}%`}
              >
                <span>{isChoch ? 'CHoCH' : 'BOS'}{isBull ? '↑' : '↓'}</span>
                <span className="opacity-55 font-mono text-[8px]">{age}c</span>
              </span>
            );
          })()}

          {/* Nearest key level proximity */}
          {nearestLevel && (
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border select-none ${
                nearestLevel.distPct < 0.15
                  ? 'bg-amber-500/12 text-amber-300 border-amber-500/35'
                  : nearestLevel.distPct < 0.40
                  ? 'bg-slate-700/35 text-slate-300 border-slate-600/35'
                  : 'bg-slate-800/30 text-slate-500 border-slate-700/25'
              }`}
              title={`Nearest key level: ${nearestLevel.label} @ ${fmtPrice(nearestLevel.price)}`}
            >
              {nearestLevel.above ? '↑' : '↓'}{nearestLevel.label}
              <span className="font-mono text-[8px] opacity-70">{nearestLevel.distPct.toFixed(2)}%</span>
            </span>
          )}

          {/* Zone inventory — right-anchored, font-mono count badges */}
          <div className="flex items-center gap-1.5 ml-auto flex-wrap justify-end">
            {stats.obBull > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[8px] font-mono font-semibold" style={{ color: CFG.OB_BULL_BORDER }}>▲OB<span className="opacity-70">{stats.obBull}</span></span>
            )}
            {stats.obBear > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[8px] font-mono font-semibold" style={{ color: CFG.OB_BEAR_BORDER }}>▼OB<span className="opacity-70">{stats.obBear}</span></span>
            )}
            {stats.fvgBull > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[8px] font-mono font-semibold" style={{ color: CFG.FVG_BULL_BORDER }}>▲FVG<span className="opacity-70">{stats.fvgBull}</span></span>
            )}
            {stats.fvgBear > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[8px] font-mono font-semibold" style={{ color: CFG.FVG_BEAR_BORDER }}>▼FVG<span className="opacity-70">{stats.fvgBear}</span></span>
            )}
            {stats.ssl > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[8px] font-mono font-semibold" style={{ color: CFG.LIQ_SELL }}>SSL<span className="opacity-70">{stats.ssl}</span></span>
            )}
            {stats.bsl > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[8px] font-mono font-semibold" style={{ color: CFG.LIQ_BUY }}>BSL<span className="opacity-70">{stats.bsl}</span></span>
            )}
          </div>
        </div>

        {/* ── Row 2: Color legend + candle count + timestamp ── */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 min-w-0">
          <span className="inline-flex items-center gap-1 text-[8px] font-semibold" style={{ color: CFG.OB_BULL_BORDER }}>
            <span className="w-3 h-2 rounded-sm inline-block opacity-60" style={{ background: CFG.OB_BULL_BORDER }} />
            Bull OB
          </span>
          <span className="inline-flex items-center gap-1 text-[8px] font-semibold" style={{ color: CFG.OB_BEAR_BORDER }}>
            <span className="w-3 h-2 rounded-sm inline-block opacity-60" style={{ background: CFG.OB_BEAR_BORDER }} />
            Bear OB
          </span>
          <span className="inline-flex items-center gap-1 text-[8px] font-semibold" style={{ color: CFG.FVG_BULL_BORDER }}>
            <span className="w-3 h-1 inline-block opacity-70" style={{ background: CFG.FVG_BULL_BORDER }} />
            FVG
          </span>
          <span className="inline-flex items-center gap-1 text-[8px] font-semibold" style={{ color: CFG.PDH }}>
            <span className="w-3 border-t border-dashed inline-block" style={{ borderColor: CFG.PDH }} />
            PDH/L
          </span>
          <span className="inline-flex items-center gap-1 text-[8px] font-semibold" style={{ color: CFG.CDH }}>
            <span className="w-3 border-t inline-block" style={{ borderColor: CFG.CDH }} />
            CDH/L
          </span>
          <span className="inline-flex items-center gap-1 text-[8px] font-semibold" style={{ color: CFG.SUPPORT }}>
            <span className="w-3 border-t border-dotted inline-block" style={{ borderColor: CFG.SUPPORT }} />
            S/R
          </span>
          <span className="ml-auto text-[8px] font-mono text-slate-600 tabular-nums shrink-0">
            {candles.length}c
            {lastCandle ? <> · {fmtTime(lastCandle.t)}</> : null}
          </span>
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
      {/* ── Section header ── */}
      <div className="flex flex-col xs:flex-row xs:items-start xs:justify-between gap-2 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-[3px] h-5 rounded-full bg-gradient-to-b from-indigo-400 to-purple-500 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-[13px] sm:text-[15px] font-bold text-white tracking-tight leading-none">
              Real-Time Chart Intelligence
            </h3>
            <p className="mt-0.5 text-[9px] text-slate-600 tracking-wider uppercase hidden sm:block select-none">
              FVG · OB · Liquidity · S/R · PDH/PDL · CDH/CDL · BOS/CHoCH · EQH/EQL
            </p>
          </div>
          <span className={`text-[9px] font-mono shrink-0 ${dataStatus.color}`}>
            {dataStatus.label}
          </span>
        </div>
        {/* Compact legend — hidden on mobile (each card footer has its own legend) */}
        <div className="hidden sm:flex flex-wrap items-center gap-1 text-[8px] font-bold shrink-0">
          <span className="px-1.5 py-0.5 rounded" style={{ background: CFG.OB_BULL_FILL, color: CFG.OB_BULL_BORDER, border: `1px solid ${CFG.OB_BULL_BORDER}40` }}>▲OB</span>
          <span className="px-1.5 py-0.5 rounded" style={{ background: CFG.OB_BEAR_FILL, color: CFG.OB_BEAR_BORDER, border: `1px solid ${CFG.OB_BEAR_BORDER}40` }}>▼OB</span>
          <span className="px-1.5 py-0.5 rounded" style={{ background: CFG.FVG_BULL_FILL, color: CFG.FVG_BULL_BORDER, border: `1px solid ${CFG.FVG_BULL_BORDER}40` }}>▲FVG</span>
          <span className="px-1.5 py-0.5 rounded" style={{ background: CFG.FVG_BEAR_FILL, color: CFG.FVG_BEAR_BORDER, border: `1px solid ${CFG.FVG_BEAR_BORDER}40` }}>▼FVG</span>
          <span className="px-1.5 py-0.5 rounded bg-orange-500/8 text-orange-400 border border-orange-500/25">SSL</span>
          <span className="px-1.5 py-0.5 rounded bg-cyan-500/8 text-cyan-400 border border-cyan-500/25">BSL</span>
        </div>
      </div>

      {/* Chart Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
        <SymbolChartCard data={chartData.NIFTY} name="NIFTY 50" liveSpot={marketData.NIFTY?.price} />
        <SymbolChartCard data={chartData.BANKNIFTY} name="BANK NIFTY" liveSpot={marketData.BANKNIFTY?.price} />
        <SymbolChartCard data={chartData.SENSEX} name="SENSEX" liveSpot={marketData.SENSEX?.price} />
      </div>
    </div>
  );
});
ChartIntelligence.displayName = 'ChartIntelligence';

export { SymbolChartCard };
export default ChartIntelligence;
