/**
 * CRT (Candle Range Theory) Engine — Client-Side Analysis
 * ══════════════════════════════════════════════════════════
 * Implements ICT-style Candle Range Theory for BTST signal generation.
 *
 * Key Concepts Computed:
 * 1. PDR (Previous Day Range) vs CDR (Current Day Range) — expansion/contraction
 * 2. PDH/PDL Sweep Detection — liquidity sweep above/below prior day levels
 * 3. Close Position Analysis — close relative to day's range (near-high = bullish BTST)
 * 4. Displacement Detection — large-body directional candles with momentum
 * 5. Body-to-Wick Ratio — conviction analysis (large body = strong intent)
 * 6. AMD Pattern (Accumulation-Manipulation-Distribution) — session flow
 * 7. Range Reclaim — price sweeps a level then reclaims back into range
 * 8. BTST Composite Score — weighted multi-factor score (0-100)
 *
 * All computations are pure functions — no side effects, no API calls.
 */

// ── Types ──────────────────────────────────────────────────────────────

export interface CRTInput {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
  changePercent: number;
  prevDayHigh: number;
  prevDayLow: number;
  prevDayClose: number;
  timestamp: string;
  status: string;
}

export interface CRTFactors {
  rangeExpansion: {
    score: number;      // -10 to +10
    pdr: number;        // Previous Day Range
    cdr: number;        // Current Day Range
    ratio: number;      // CDR / PDR
    label: string;
  };
  sweepDetection: {
    score: number;
    pdhSwept: boolean;  // Price went above PDH
    pdlSwept: boolean;  // Price went below PDL
    sweepAndReject: 'BULLISH' | 'BEARISH' | 'NONE';
    label: string;
  };
  closePosition: {
    score: number;
    positionPct: number;    // 0 = at low, 100 = at high
    closeVsPDC: number;     // Close vs Previous Day Close %
    label: string;
  };
  displacement: {
    score: number;
    bodyPct: number;        // Body as % of range
    isDisplacement: boolean;
    direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    label: string;
  };
  bodyWickRatio: {
    score: number;
    bodySize: number;
    upperWick: number;
    lowerWick: number;
    ratio: number;          // Body / Total Range
    conviction: 'HIGH' | 'MEDIUM' | 'LOW';
    label: string;
  };
  amdPattern: {
    score: number;
    phase: 'ACCUMULATION' | 'MANIPULATION' | 'DISTRIBUTION' | 'UNKNOWN';
    label: string;
  };
  prevCloseRelationship: {
    score: number;         // -8 to +8
    closeVsPDC: number;    // % diff: (close - PDC) / PDC * 100
    aboveBelow: 'ABOVE' | 'BELOW' | 'NEUTRAL';
    label: string;
  };
  trendAlignment: {
    score: number;
    dayTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    closingStrength: 'STRONG' | 'MODERATE' | 'WEAK';
    label: string;
  };
}

export type BTSTSignal = 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';

export interface BTSTRecommendation {
  signal: BTSTSignal;
  confidence: number;       // 0 - 100
  totalScore: number;       // Raw composite score
  maxScore: number;         // Maximum possible score
  action: string;           // Human-readable action
  reasoning: string[];      // Array of reasons
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  targetGap: string;        // Expected gap direction
  stopLoss: string;         // Suggested SL approach
  entryWindow: string;      // Suggested entry time
  signalQuality: 'BTST_WINDOW' | 'LIVE' | 'POST_MARKET'; // BTST_WINDOW = 15:20–15:30 IST final snapshot
}

export interface CRTAnalysis {
  symbol: string;
  price: number;
  factors: CRTFactors;
  btst: BTSTRecommendation;
  keyLevels: {
    pdh: number;
    pdl: number;
    pdc: number;
    todayHigh: number;
    todayLow: number;
    todayOpen: number;
    rangeHigh: number;      // Max of PDH, today high
    rangeLow: number;       // Min of PDL, today low
    midPoint: number;
  };
  candleStructure: {
    type: string;           // Doji, Marubozu, Hammer, etc.
    bodyPct: number;
    upperWickPct: number;
    lowerWickPct: number;
    isBullish: boolean;
  };
  prevDayDataValid: boolean;  // True when PREV_DAY_OHLC loaded from broker (not fallback)
  isBTSTCriticalWindow: boolean; // True during 15:20–15:30 IST — final candle, most accurate
  sessionDate: string;           // 'YYYY-MM-DD' IST — for date-scoped cache validation
  timestamp: number;
}

// ── Core Analysis Functions ────────────────────────────────────────────

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function safe(val: number | null | undefined, fallback: number = 0): number {
  return typeof val === 'number' && isFinite(val) ? val : fallback;
}

/** Detect candle type from OHLC */
function detectCandleType(
  open: number, high: number, low: number, close: number
): { type: string; bodyPct: number; upperWickPct: number; lowerWickPct: number; isBullish: boolean } {
  const range = high - low;
  if (range <= 0) return { type: 'Doji', bodyPct: 0, upperWickPct: 50, lowerWickPct: 50, isBullish: true };

  const body = Math.abs(close - open);
  const bodyPct = (body / range) * 100;
  const isBullish = close >= open;

  const upperWick = high - Math.max(open, close);
  const lowerWick = Math.min(open, close) - low;
  const upperWickPct = (upperWick / range) * 100;
  const lowerWickPct = (lowerWick / range) * 100;

  let type = 'Standard';

  if (bodyPct < 10) {
    if (lowerWickPct > 60) type = 'Dragonfly Doji';
    else if (upperWickPct > 60) type = 'Gravestone Doji';
    else type = 'Doji';
  } else if (bodyPct > 80) {
    type = isBullish ? 'Bullish Marubozu' : 'Bearish Marubozu';
  } else if (bodyPct < 35 && lowerWickPct > 55) {
    type = isBullish ? 'Hammer' : 'Hanging Man';
  } else if (bodyPct < 35 && upperWickPct > 55) {
    type = 'Shooting Star';
  } else if (bodyPct > 50 && bodyPct <= 80) {
    type = isBullish ? 'Bullish Candle' : 'Bearish Candle';
  } else {
    type = isBullish ? 'Spinning Top (Bullish)' : 'Spinning Top (Bearish)';
  }

  return { type, bodyPct, upperWickPct, lowerWickPct, isBullish };
}

/** Factor 1: Range Expansion/Contraction */
function analyzeRangeExpansion(cdr: number, pdr: number): CRTFactors['rangeExpansion'] {
  if (pdr <= 0) return { score: 0, pdr, cdr, ratio: 0, label: 'No prior range data' };
  const ratio = cdr / pdr;
  let score = 0;
  let label = '';

  if (ratio > 1.5) {
    score = 8;
    label = 'Strong Range Expansion — High volatility day';
  } else if (ratio > 1.2) {
    score = 5;
    label = 'Moderate Expansion — Active session';
  } else if (ratio > 0.8) {
    score = 2;
    label = 'Normal Range — Typical session';
  } else if (ratio > 0.5) {
    score = -2;
    label = 'Range Contraction — Low volatility (compression)';
  } else {
    score = -5;
    label = 'Extreme Contraction — Breakout imminent';
  }

  return { score, pdr: Math.round(pdr * 100) / 100, cdr: Math.round(cdr * 100) / 100, ratio: Math.round(ratio * 100) / 100, label };
}

/** Factor 2: PDH/PDL Sweep Detection */
function analyzeSweep(
  high: number, low: number, close: number, pdh: number, pdl: number
): CRTFactors['sweepDetection'] {
  const pdhSwept = high > pdh;
  const pdlSwept = low < pdl;
  let score = 0;
  let sweepAndReject: 'BULLISH' | 'BEARISH' | 'NONE' = 'NONE';
  let label = '';

  if (pdlSwept && close > pdl) {
    // Swept PDL but closed back above — bullish sweep & reject
    sweepAndReject = 'BULLISH';
    score = 10;
    label = 'PDL Sweep & Reject ↑ — Smart money buying below PDL';
  } else if (pdhSwept && close < pdh) {
    // Swept PDH but closed back below — bearish sweep & reject
    sweepAndReject = 'BEARISH';
    score = -10;
    label = 'PDH Sweep & Reject ↓ — Distribution above PDH';
  } else if (pdhSwept && close > pdh) {
    // Broke above PDH and held — bullish breakout
    score = 7;
    label = 'PDH Breakout & Hold ↑ — Bullish continuation';
  } else if (pdlSwept && close < pdl) {
    // Broke below PDL and held — bearish breakdown
    score = -7;
    label = 'PDL Breakdown ↓ — Bearish continuation';
  } else if (!pdhSwept && !pdlSwept) {
    score = 0;
    label = 'Inside Day — No sweep (range contraction)';
  } else {
    score = 0;
    label = 'Partial sweep detected';
  }

  return { score, pdhSwept, pdlSwept, sweepAndReject, label };
}

/** Factor 3: Close Position within Day's Range */
function analyzeClosePosition(
  close: number, high: number, low: number, prevClose: number
): CRTFactors['closePosition'] {
  const range = high - low;
  const positionPct = range > 0 ? ((close - low) / range) * 100 : 50;
  const closeVsPDC = prevClose > 0 ? ((close - prevClose) / prevClose) * 100 : 0;
  let score = 0;
  let label = '';

  if (positionPct >= 85) {
    score = 10;
    label = 'Closing at Day High — Maximum bullish BTST signal';
  } else if (positionPct >= 70) {
    score = 7;
    label = 'Strong Close — Upper quartile of range';
  } else if (positionPct >= 55) {
    score = 4;
    label = 'Moderate Bullish Close — Above midpoint';
  } else if (positionPct >= 45) {
    score = 0;
    label = 'Neutral Close — At range midpoint';
  } else if (positionPct >= 30) {
    score = -4;
    label = 'Weak Close — Below midpoint';
  } else if (positionPct >= 15) {
    score = -7;
    label = 'Bearish Close — Lower quartile';
  } else {
    score = -10;
    label = 'Closing at Day Low — Maximum bearish signal';
  }

  return { score, positionPct: Math.round(positionPct), closeVsPDC: Math.round(closeVsPDC * 100) / 100, label };
}

/** Factor 4: Displacement Candle Detection */
function analyzeDisplacement(
  open: number, high: number, low: number, close: number, pdr: number
): CRTFactors['displacement'] {
  const range = high - low;
  const body = Math.abs(close - open);
  const bodyPct = range > 0 ? (body / range) * 100 : 0;
  const isBullish = close > open;
  const isLargeRange = pdr > 0 ? (range / pdr) > 0.7 : false;
  const isDisplacement = bodyPct > 70 && isLargeRange;

  let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  let score = 0;
  let label = '';

  if (isDisplacement && isBullish) {
    direction = 'BULLISH';
    score = 8;
    label = 'Bullish Displacement — Strong directional conviction';
  } else if (isDisplacement && !isBullish) {
    direction = 'BEARISH';
    score = -8;
    label = 'Bearish Displacement — Strong selling pressure';
  } else if (bodyPct > 60) {
    direction = isBullish ? 'BULLISH' : 'BEARISH';
    score = isBullish ? 4 : -4;
    label = `${isBullish ? 'Bullish' : 'Bearish'} Directional Candle`;
  } else {
    label = 'No displacement — Indecisive candle';
  }

  return { score, bodyPct: Math.round(bodyPct), isDisplacement, direction, label };
}

/** Factor 5: Body-to-Wick Ratio (Conviction) */
function analyzeBodyWickRatio(
  open: number, high: number, low: number, close: number
): CRTFactors['bodyWickRatio'] {
  const range = high - low;
  const body = Math.abs(close - open);
  const upperWick = high - Math.max(open, close);
  const lowerWick = Math.min(open, close) - low;
  const ratio = range > 0 ? body / range : 0;

  let conviction: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
  let score = 0;
  let label = '';

  if (ratio > 0.75) {
    conviction = 'HIGH';
    score = close >= open ? 6 : -6;
    label = 'High Conviction — Minimal rejection';
  } else if (ratio > 0.5) {
    conviction = 'MEDIUM';
    score = close >= open ? 3 : -3;
    label = 'Medium Conviction — Some rejection';
  } else {
    conviction = 'LOW';
    score = 0;
    label = 'Low Conviction — Heavy wick rejection';
  }

  return {
    score, bodySize: Math.round(body * 100) / 100,
    upperWick: Math.round(upperWick * 100) / 100,
    lowerWick: Math.round(lowerWick * 100) / 100,
    ratio: Math.round(ratio * 100) / 100, conviction, label
  };
}

/** Factor 6: AMD Pattern Detection (session-based)
 * ── IST Time Utility ───────────────────────────────────────────────────
 * Handles both UTC ISO strings (2026-05-12T09:50:00Z)
 * and IST ISO strings (2026-05-12T15:20:00+05:30) via getUTCHours().
 */
function parseISTTime(timestamp: string): { hour: number; minute: number } {
  try {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return { hour: 15, minute: 25 };
    // IST = UTC + 330 minutes
    const totalIST = d.getUTCHours() * 60 + d.getUTCMinutes() + 330;
    return { hour: Math.floor(totalIST / 60) % 24, minute: totalIST % 60 };
  } catch {
    return { hour: 15, minute: 25 };
  }
}

function getISTSessionDate(timestamp: string): string {
  try {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    return new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
  } catch {
    return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  }
}

/** Factor 6: AMD Pattern Detection (session-based) */
function analyzeAMDPattern(
  timestamp: string, high: number, low: number, close: number
): CRTFactors['amdPattern'] {
  const { hour, minute } = parseISTTime(timestamp);

  // BTST critical window: 15:20–15:30 IST. Candle is 97%+ formed — highest signal accuracy.
  const isBTSTWindow = hour === 15 && minute >= 20;
  // Post-market: after 15:30 IST
  const isPostMarket = hour > 15 || (hour === 15 && minute > 30);

  let phase: 'ACCUMULATION' | 'MANIPULATION' | 'DISTRIBUTION' | 'UNKNOWN' = 'UNKNOWN';
  let score = 0;
  let label = '';

  const range = high - low;
  const closePos = range > 0 ? (close - low) / range : 0.5;

  if (hour >= 9 && hour < 11) {
    // ── Accumulation (09:15–11:00) ───────────────────────────────────
    phase = 'ACCUMULATION';
    score = 2;
    label = 'Morning session — Accumulation (institutional positioning)';

  } else if (hour >= 11 && hour < 14) {
    // ── Manipulation (11:00–14:00) ───────────────────────────────────
    phase = 'MANIPULATION';
    score = 0;
    label = 'Mid-session — Manipulation phase (traps & false breakouts)';

  } else if (hour >= 14 && !isBTSTWindow && !isPostMarket) {
    // ── Early Distribution (14:00–15:19) ────────────────────────────
    phase = 'DISTRIBUTION';
    if (closePos >= 0.70) { score = 6;  label = 'Early distribution — Closing strong ↑ (BTST positioning)'; }
    else if (closePos >= 0.50) { score = 3;  label = 'Early distribution — Close above midpoint'; }
    else if (closePos >= 0.30) { score = -3; label = 'Early distribution — Close below midpoint'; }
    else                       { score = -6; label = 'Early distribution — Closing weak ↓ (bearish carry)'; }

  } else if (isBTSTWindow) {
    // ── CRITICAL BTST WINDOW (15:20–15:30 IST) ──────────────────────
    // Candle is near-final. 5-tier scoring with ±8 max.
    // At 3:20 PM, smart money has completed all positioning for tomorrow.
    phase = 'DISTRIBUTION';
    if (closePos >= 0.80) {
      score = 8;
      label = `🎯 3:20 PM BTST — Closing at session HIGH (${(closePos * 100).toFixed(0)}%) — Maximum bullish overnight signal`;
    } else if (closePos >= 0.63) {
      score = 6;
      label = `🎯 3:20 PM BTST — Closing in upper range (${(closePos * 100).toFixed(0)}%) — Bullish overnight setup`;
    } else if (closePos >= 0.45) {
      score = 2;
      label = `🎯 3:20 PM BTST — Closing near midpoint (${(closePos * 100).toFixed(0)}%) — Neutral overnight`;
    } else if (closePos >= 0.25) {
      score = -6;
      label = `🎯 3:20 PM BTST — Closing in lower range (${(closePos * 100).toFixed(0)}%) — Bearish overnight setup`;
    } else {
      score = -8;
      label = `🎯 3:20 PM BTST — Closing at session LOW (${(closePos * 100).toFixed(0)}%) — Maximum bearish overnight signal`;
    }

  } else {
    // ── Post-Market ─────────────────────────────────────────────────
    phase = 'UNKNOWN';
    label = 'Post-market — Using final session close data';
  }

  return { score, phase, label };
}

/** Factor 7: Prev Close Relationship — close position vs PDC (Previous Day Close)
 * Distinct from sweepDetection (which uses PDH/PDL).
 * Measures net institutional commitment: did they close above or below prior session price?
 */
function analyzePrevCloseRelationship(
  close: number, pdc: number
): CRTFactors['prevCloseRelationship'] {
  if (pdc <= 0) return { score: 0, closeVsPDC: 0, aboveBelow: 'NEUTRAL', label: 'No PDC data — prev close unavailable' };

  const closeVsPDC = ((close - pdc) / pdc) * 100;
  let aboveBelow: 'ABOVE' | 'BELOW' | 'NEUTRAL' = 'NEUTRAL';
  let score = 0;
  let label = '';

  if (closeVsPDC > 0.8) {
    aboveBelow = 'ABOVE'; score = 8;
    label = `+${closeVsPDC.toFixed(2)}% above PDC — Institutional accumulation above prev close`;
  } else if (closeVsPDC > 0.3) {
    aboveBelow = 'ABOVE'; score = 5;
    label = `+${closeVsPDC.toFixed(2)}% above PDC — Bullish carry above prev close`;
  } else if (closeVsPDC > 0.05) {
    aboveBelow = 'ABOVE'; score = 2;
    label = `Marginally above PDC (+${closeVsPDC.toFixed(2)}%) — Mild bullish close`;
  } else if (closeVsPDC >= -0.05) {
    aboveBelow = 'NEUTRAL'; score = 0;
    label = 'At PDC — No directional commitment vs prior close';
  } else if (closeVsPDC >= -0.3) {
    aboveBelow = 'BELOW'; score = -2;
    label = `Marginally below PDC (${closeVsPDC.toFixed(2)}%) — Mild bearish close`;
  } else if (closeVsPDC >= -0.8) {
    aboveBelow = 'BELOW'; score = -5;
    label = `${closeVsPDC.toFixed(2)}% below PDC — Bearish carry below prev close`;
  } else {
    aboveBelow = 'BELOW'; score = -8;
    label = `${closeVsPDC.toFixed(2)}% below PDC — Institutional distribution below prev close`;
  }

  return { score, closeVsPDC: Math.round(closeVsPDC * 100) / 100, aboveBelow, label };
}

/** Factor 8: Intraday Trend Alignment — open→close session momentum
 * Uses open-to-close move only, NOT gap-adjusted changePercent.
 * This is DISTINCT from prevCloseRelationship (which measures full net move vs PDC).
 * Example: market gaps down -1% then rallies → intradayChg = +0.8% (BULLISH session)
 * even if changePercent = -0.2% (looks neutral when gap-adjusted).
 */
function analyzeTrendAlignment(
  open: number, close: number
): CRTFactors['trendAlignment'] {
  let dayTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  let closingStrength: 'STRONG' | 'MODERATE' | 'WEAK' = 'WEAK';
  let score = 0;
  let label = '';

  const intradayChg = open > 0 ? ((close - open) / open) * 100 : 0;
  const absChange = Math.abs(intradayChg);

  if (absChange > 0.8) {
    closingStrength = 'STRONG';
  } else if (absChange > 0.3) {
    closingStrength = 'MODERATE';
  }

  if (intradayChg > 0.2) {
    dayTrend = 'BULLISH';
    score = closingStrength === 'STRONG' ? 8 : closingStrength === 'MODERATE' ? 5 : 2;
    label = `Intraday Bullish +${intradayChg.toFixed(2)}% (open→close, ${closingStrength.toLowerCase()}) — Session momentum carry`;
  } else if (intradayChg < -0.2) {
    dayTrend = 'BEARISH';
    score = closingStrength === 'STRONG' ? -8 : closingStrength === 'MODERATE' ? -5 : -2;
    label = `Intraday Bearish ${intradayChg.toFixed(2)}% (open→close, ${closingStrength.toLowerCase()}) — Negative session momentum`;
  } else {
    dayTrend = 'NEUTRAL';
    score = 0;
    label = 'Intraday Flat — Open≈Close, no clear session momentum';
  }

  return { score, dayTrend, closingStrength, label };
}

// ── BTST Signal Generation ─────────────────────────────────────────────

function generateBTSTRecommendation(factors: CRTFactors, isBTSTCriticalWindow: boolean): BTSTRecommendation {
  const totalScore =
    factors.rangeExpansion.score +
    factors.sweepDetection.score +
    factors.closePosition.score +
    factors.displacement.score +
    factors.bodyWickRatio.score +
    factors.amdPattern.score +
    factors.prevCloseRelationship.score +
    factors.trendAlignment.score;

  // maxScore: rangeExp(8)+sweep(10)+closePos(10)+disp(8)+bwr(6)+amd(8 in window/6 normal)+pcr(8)+trend(8)
  // Use 66 during BTST window (AMD max=8), 64 otherwise
  const MAX_SCORE = isBTSTCriticalWindow ? 66 : 64;
  const confidence = clamp(Math.round(((totalScore + MAX_SCORE) / (2 * MAX_SCORE)) * 100), 0, 100);

  let signal: BTSTSignal;
  let action: string;
  let targetGap: string;
  let stopLoss: string;
  let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';

  // Thresholds stay constant — direction decision must be time-independent
  if (totalScore >= 32) {
    signal = 'STRONG_BUY';
    action = isBTSTCriticalWindow
      ? '🎯 FINAL BTST Buy — Strong 3:20 PM bullish close, buy before 3:25 PM'
      : 'BTST Buy — Strong overnight bullish setup';
    targetGap = 'Gap-up 0.3-0.8% expected next open';
    stopLoss = 'SL: Below today\'s low';
    riskLevel = 'LOW';
  } else if (totalScore >= 16) {
    signal = 'BUY';
    action = isBTSTCriticalWindow
      ? '🎯 FINAL BTST Buy — Moderate 3:20 PM bullish close'
      : 'BTST Buy — Moderate bullish setup';
    targetGap = 'Flat to gap-up 0.1-0.4%';
    stopLoss = 'SL: Below PDL or today\'s low';
    riskLevel = 'MEDIUM';
  } else if (totalScore >= -15) {
    signal = 'NEUTRAL';
    action = isBTSTCriticalWindow
      ? '🎯 FINAL BTST — Neutral 3:20 PM close, skip overnight trade'
      : 'No BTST — Neutral outlook, avoid overnight risk';
    targetGap = 'Uncertain gap direction';
    stopLoss = 'N/A — No trade';
    riskLevel = 'HIGH';
  } else if (totalScore >= -31) {
    signal = 'SELL';
    action = isBTSTCriticalWindow
      ? '🎯 FINAL BTST Sell — Moderate 3:20 PM bearish close'
      : 'BTST Sell — Moderate bearish setup';
    targetGap = 'Flat to gap-down 0.1-0.4%';
    stopLoss = 'SL: Above today\'s high';
    riskLevel = 'MEDIUM';
  } else {
    signal = 'STRONG_SELL';
    action = isBTSTCriticalWindow
      ? '🎯 FINAL BTST Sell — Strong 3:20 PM bearish close, avoid longs'
      : 'BTST Sell — Strong overnight bearish setup';
    targetGap = 'Gap-down 0.3-0.8% expected next open';
    stopLoss = 'SL: Above PDH or today\'s high';
    riskLevel = 'LOW';
  }

  const signalQuality: BTSTRecommendation['signalQuality'] = isBTSTCriticalWindow
    ? 'BTST_WINDOW'
    : factors.amdPattern.phase === 'UNKNOWN' ? 'POST_MARKET' : 'LIVE';

  // Build reasoning — ordered by signal strength
  const reasoning: string[] = [];
  if (isBTSTCriticalWindow)                                  reasoning.push(factors.amdPattern.label);
  if (Math.abs(factors.sweepDetection.score) >= 7)          reasoning.push(factors.sweepDetection.label);
  if (Math.abs(factors.closePosition.score) >= 7)           reasoning.push(factors.closePosition.label);
  if (Math.abs(factors.displacement.score) >= 4)            reasoning.push(factors.displacement.label);
  if (Math.abs(factors.prevCloseRelationship.score) >= 5)   reasoning.push(factors.prevCloseRelationship.label);
  if (Math.abs(factors.trendAlignment.score) >= 5)          reasoning.push(factors.trendAlignment.label);
  if (!isBTSTCriticalWindow && Math.abs(factors.amdPattern.score) >= 6) reasoning.push(factors.amdPattern.label);
  if (Math.abs(factors.rangeExpansion.score) >= 5)          reasoning.push(factors.rangeExpansion.label);
  if (reasoning.length === 0) reasoning.push('No strong individual factors — composite analysis');

  const entryWindow = isBTSTCriticalWindow
    ? 'NOW — 3:20–3:25 PM IST (BTST entry window active)'
    : signal === 'STRONG_BUY' || signal === 'BUY'
      ? '3:20 PM - 3:25 PM IST (last 10 min before close)'
      : signal === 'STRONG_SELL' || signal === 'SELL'
        ? 'Sell/Short near 3:20–3:25 PM IST'
        : 'No entry recommended';

  return { signal, confidence, totalScore, maxScore: MAX_SCORE, action, reasoning, riskLevel, targetGap, stopLoss, entryWindow, signalQuality };
}

// ── Main Analysis Function ─────────────────────────────────────────────

export function analyzeCRT(input: CRTInput): CRTAnalysis {
  const {
    symbol, price, open, high, low, close,
    prevDayHigh, prevDayLow, prevDayClose, timestamp
  } = input;

  const pdh = safe(prevDayHigh, high);
  const pdl = safe(prevDayLow, low);
  const pdc = safe(prevDayClose, close);
  const o = safe(open, price);
  const h = safe(high, price);
  const l = safe(low, price);
  const c = safe(close, price);

  // IST time — used for BTST window detection and session-date cache key
  const { hour: istHour, minute: istMinute } = parseISTTime(timestamp);
  const isBTSTCriticalWindow = istHour === 15 && istMinute >= 20;
  const sessionDate = getISTSessionDate(timestamp);

  // Prev day data is valid only when broker returned real values (not fallback to today's OHLC).
  // When PREV_DAY_OHLC fetch fails (expired token), pdh/pdl collapse to today's high/low.
  const prevDayDataValid =
    safe(prevDayHigh) > 0 && safe(prevDayLow) > 0 &&
    Math.abs(pdh - h) > 1 && Math.abs(pdl - l) > 1;

  const pdr = pdh - pdl;
  const cdr = h - l;

  // Run all 8 factor analyses
  const factors: CRTFactors = {
    rangeExpansion: analyzeRangeExpansion(cdr, pdr),
    sweepDetection: analyzeSweep(h, l, c, pdh, pdl),
    closePosition: analyzeClosePosition(c, h, l, pdc),
    displacement: analyzeDisplacement(o, h, l, c, pdr),
    bodyWickRatio: analyzeBodyWickRatio(o, h, l, c),
    amdPattern: analyzeAMDPattern(timestamp, h, l, c),
    prevCloseRelationship: analyzePrevCloseRelationship(c, pdc),
    trendAlignment: analyzeTrendAlignment(o, c),
  };

  const btst = generateBTSTRecommendation(factors, isBTSTCriticalWindow);
  const candleStructure = detectCandleType(o, h, l, c);

  const keyLevels = {
    pdh, pdl, pdc,
    todayHigh: h, todayLow: l, todayOpen: o,
    rangeHigh: Math.max(pdh, h),
    rangeLow: Math.min(pdl, l),
    midPoint: Math.round(((Math.max(pdh, h) + Math.min(pdl, l)) / 2) * 100) / 100,
  };

  return {
    symbol, price: safe(price, c),
    factors, btst, keyLevels, candleStructure,
    prevDayDataValid,
    isBTSTCriticalWindow,
    sessionDate,
    timestamp: Date.now(),
  };
}
