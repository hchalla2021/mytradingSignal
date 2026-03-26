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
  rangeReclaim: {
    score: number;
    reclaimed: 'PDH' | 'PDL' | 'BOTH' | 'NONE';
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

/** Factor 6: AMD Pattern Detection (session-based) */
function analyzeAMDPattern(
  timestamp: string, open: number, high: number, low: number, close: number
): CRTFactors['amdPattern'] {
  let hour = 15; // Default to afternoon
  try {
    const d = new Date(timestamp);
    if (!isNaN(d.getTime())) {
      // Convert to IST (UTC+5:30)
      const istHour = (d.getUTCHours() + 5) % 24;
      const istMinute = d.getUTCMinutes() + 30;
      hour = istMinute >= 60 ? istHour + 1 : istHour;
    }
  } catch { /* use default */ }

  let phase: 'ACCUMULATION' | 'MANIPULATION' | 'DISTRIBUTION' | 'UNKNOWN' = 'UNKNOWN';
  let score = 0;
  let label = '';

  if (hour >= 9 && hour < 11) {
    phase = 'ACCUMULATION';
    score = 2;
    label = 'Morning Session — Accumulation phase (institutional positioning)';
  } else if (hour >= 11 && hour < 14) {
    phase = 'MANIPULATION';
    score = 0;
    label = 'Mid-Session — Manipulation phase (fake moves, traps)';
  } else if (hour >= 14 && hour <= 16) {
    phase = 'DISTRIBUTION';
    // In distribution, closing near high = bullish for BTST
    const range = high - low;
    const closePos = range > 0 ? (close - low) / range : 0.5;
    if (closePos > 0.65) {
      score = 6;
      label = 'Distribution Phase — Closing strong ↑ (BTST favorable)';
    } else if (closePos < 0.35) {
      score = -6;
      label = 'Distribution Phase — Closing weak ↓ (avoid BTST)';
    } else {
      score = 0;
      label = 'Distribution Phase — Neutral close';
    }
  } else {
    label = 'Post-Market — Using last session data';
  }

  return { score, phase, label };
}

/** Factor 7: Range Reclaim Detection */
function analyzeRangeReclaim(
  close: number, high: number, low: number, pdh: number, pdl: number
): CRTFactors['rangeReclaim'] {
  const pdhSwept = high > pdh;
  const pdlSwept = low < pdl;
  let reclaimed: 'PDH' | 'PDL' | 'BOTH' | 'NONE' = 'NONE';
  let score = 0;
  let label = '';

  // Range reclaim: price sweeps a level but closes back within prior range
  const reclaimedPDH = pdhSwept && close < pdh && close > pdl;
  const reclaimedPDL = pdlSwept && close > pdl && close < pdh;

  if (reclaimedPDH && reclaimedPDL) {
    reclaimed = 'BOTH';
    score = 0;
    label = 'Both levels swept & reclaimed — Extreme volatility';
  } else if (reclaimedPDL) {
    reclaimed = 'PDL';
    score = 8;
    label = 'PDL Swept & Reclaimed ↑ — Bullish rejection (smart money buy)';
  } else if (reclaimedPDH) {
    reclaimed = 'PDH';
    score = -8;
    label = 'PDH Swept & Reclaimed ↓ — Bearish rejection (distribution)';
  } else {
    label = 'No range reclaim pattern';
  }

  return { score, reclaimed, label };
}

/** Factor 8: Trend Alignment & Closing Strength */
function analyzeTrendAlignment(
  open: number, close: number, changePercent: number
): CRTFactors['trendAlignment'] {
  const isBullish = close > open;
  let dayTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  let closingStrength: 'STRONG' | 'MODERATE' | 'WEAK' = 'WEAK';
  let score = 0;
  let label = '';

  const absChange = Math.abs(changePercent);

  if (absChange > 1.0) {
    closingStrength = 'STRONG';
  } else if (absChange > 0.4) {
    closingStrength = 'MODERATE';
  }

  if (changePercent > 0.5) {
    dayTrend = 'BULLISH';
    score = closingStrength === 'STRONG' ? 8 : closingStrength === 'MODERATE' ? 5 : 2;
    label = `Bullish Day (${closingStrength.toLowerCase()} close) — Momentum carry for BTST`;
  } else if (changePercent < -0.5) {
    dayTrend = 'BEARISH';
    score = closingStrength === 'STRONG' ? -8 : closingStrength === 'MODERATE' ? -5 : -2;
    label = `Bearish Day (${closingStrength.toLowerCase()} close) — Negative carry`;
  } else {
    dayTrend = 'NEUTRAL';
    score = 0;
    label = 'Flat Day — Low directional conviction';
  }

  return { score, dayTrend, closingStrength, label };
}

// ── BTST Signal Generation ─────────────────────────────────────────────

function generateBTSTRecommendation(factors: CRTFactors, price: number): BTSTRecommendation {
  const totalScore =
    factors.rangeExpansion.score +
    factors.sweepDetection.score +
    factors.closePosition.score +
    factors.displacement.score +
    factors.bodyWickRatio.score +
    factors.amdPattern.score +
    factors.rangeReclaim.score +
    factors.trendAlignment.score;

  const maxScore = 10 + 10 + 10 + 8 + 6 + 6 + 8 + 8; // 66
  const confidence = clamp(Math.round(((totalScore + maxScore) / (2 * maxScore)) * 100), 0, 100);

  let signal: BTSTSignal;
  let action: string;
  let targetGap: string;
  let stopLoss: string;
  let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';

  if (totalScore >= 35) {
    signal = 'STRONG_BUY';
    action = 'BTST Buy — Strong overnight bullish setup';
    targetGap = 'Gap-up 0.3-0.8% expected';
    stopLoss = 'Below today\'s low';
    riskLevel = 'LOW';
  } else if (totalScore >= 18) {
    signal = 'BUY';
    action = 'BTST Buy — Moderate bullish setup';
    targetGap = 'Flat to gap-up 0.1-0.4%';
    stopLoss = 'Below PDL or today\'s low';
    riskLevel = 'MEDIUM';
  } else if (totalScore >= -18) {
    signal = 'NEUTRAL';
    action = 'No BTST — Neutral outlook, avoid overnight risk';
    targetGap = 'Uncertain gap direction';
    stopLoss = 'N/A';
    riskLevel = 'HIGH';
  } else if (totalScore >= -35) {
    signal = 'SELL';
    action = 'BTST Sell — Moderate bearish setup';
    targetGap = 'Flat to gap-down 0.1-0.4%';
    stopLoss = 'Above today\'s high';
    riskLevel = 'MEDIUM';
  } else {
    signal = 'STRONG_SELL';
    action = 'BTST Sell — Strong overnight bearish setup';
    targetGap = 'Gap-down 0.3-0.8% expected';
    stopLoss = 'Above PDH or today\'s high';
    riskLevel = 'LOW';
  }

  // Build reasoning
  const reasoning: string[] = [];
  if (Math.abs(factors.sweepDetection.score) >= 7) reasoning.push(factors.sweepDetection.label);
  if (Math.abs(factors.closePosition.score) >= 7) reasoning.push(factors.closePosition.label);
  if (Math.abs(factors.displacement.score) >= 4) reasoning.push(factors.displacement.label);
  if (Math.abs(factors.rangeReclaim.score) >= 8) reasoning.push(factors.rangeReclaim.label);
  if (Math.abs(factors.trendAlignment.score) >= 5) reasoning.push(factors.trendAlignment.label);
  if (Math.abs(factors.amdPattern.score) >= 6) reasoning.push(factors.amdPattern.label);
  if (Math.abs(factors.rangeExpansion.score) >= 5) reasoning.push(factors.rangeExpansion.label);
  if (reasoning.length === 0) reasoning.push('No strong individual factors — composite analysis');

  const entryWindow = signal === 'STRONG_BUY' || signal === 'BUY'
    ? '3:00 PM - 3:25 PM (Last 30 min before close)'
    : signal === 'STRONG_SELL' || signal === 'SELL'
      ? 'Sell/Short after 3:00 PM'
      : 'No entry recommended';

  return { signal, confidence, totalScore, maxScore, action, reasoning, riskLevel, targetGap, stopLoss, entryWindow };
}

// ── Main Analysis Function ─────────────────────────────────────────────

export function analyzeCRT(input: CRTInput): CRTAnalysis {
  const {
    symbol, price, open, high, low, close, volume, change, changePercent,
    prevDayHigh, prevDayLow, prevDayClose, timestamp, status
  } = input;

  const pdh = safe(prevDayHigh, high);
  const pdl = safe(prevDayLow, low);
  const pdc = safe(prevDayClose, close);
  const o = safe(open, price);
  const h = safe(high, price);
  const l = safe(low, price);
  const c = safe(close, price);

  const pdr = pdh - pdl;
  const cdr = h - l;

  // Run all 8 factor analyses
  const factors: CRTFactors = {
    rangeExpansion: analyzeRangeExpansion(cdr, pdr),
    sweepDetection: analyzeSweep(h, l, c, pdh, pdl),
    closePosition: analyzeClosePosition(c, h, l, pdc),
    displacement: analyzeDisplacement(o, h, l, c, pdr),
    bodyWickRatio: analyzeBodyWickRatio(o, h, l, c),
    amdPattern: analyzeAMDPattern(timestamp, o, h, l, c),
    rangeReclaim: analyzeRangeReclaim(c, h, l, pdh, pdl),
    trendAlignment: analyzeTrendAlignment(o, c, changePercent),
  };

  const btst = generateBTSTRecommendation(factors, price);
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
    timestamp: Date.now(),
  };
}
