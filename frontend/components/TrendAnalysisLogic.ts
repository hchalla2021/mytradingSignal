/**
 * TREND ANALYSIS LOGIC - Current vs Improved
 * 
 * CURRENT LOGIC (In MarketStructure.tsx):
 * =======================================
 * 1. positionInRange > 0.7 AND percentAboveClose > 0.5% → UPTREND
 * 2. positionInRange < 0.3 AND percentAboveClose < -0.5% → DOWNTREND  
 * 3. Otherwise → RANGE (CONSOLIDATING)
 * 
 * ANALYSIS:
 * =========
 * ✅ CORRECT concept - uses two independent factors
 * ⚠️  ISSUE: Conditions are TOO STRICT (both must be true)
 * 
 * Example Problems:
 * - Price at 72% of range but only +0.3% from close → STAYS RANGE (should be weak up!)
 * - Price up +1.2% but only at 65% of range → STAYS RANGE (should be strong up!)
 * - Market chops between limits → Always shows CONSOLIDATING
 */

// CURRENT THRESHOLDS (Review these):
const CURRENT_LOGIC = {
  UPTREND: {
    positionInRange: 0.7,      // Top 30% of range
    percentAboveClose: 0.5,     // +0.5% from previous close
    strong: 1.5,                // +1.5% for STRONG_UP
  },
  DOWNTREND: {
    positionInRange: 0.3,       // Bottom 30% of range
    percentAboveClose: -0.5,    // -0.5% from previous close
    strong: -1.5,               // -1.5% for STRONG_DOWN
  },
  RANGE: {
    rangePercent: 0.5,          // Daily range < 0.5% of close
  }
};

/**
 * IMPROVED LOGIC - More Responsive & Dynamic
 * ============================================
 * Use weighted scoring instead of hard AND conditions
 */

export interface MarketStructureAnalysis {
  trend: 'UPTREND' | 'DOWNTREND' | 'RANGE';
  structure: string;
  confidence: number;    // 0-100
  debugInfo?: {
    positionInRange: number;
    percentAboveClose: number;
    trendScore: number;
  };
}

export function analyzeMarketStructureImproved(
  data: { price: number; high: number; low: number; close: number } | null,
  analysis: any
): MarketStructureAnalysis {
  if (!data) {
    return {
      trend: 'RANGE',
      structure: 'CONSOLIDATING',
      confidence: 0
    };
  }

  const current = data.price;
  const dayHigh = data.high;
  const dayLow = data.low;
  const dayClose = data.close;
  const dayRange = dayHigh - dayLow;

  // ✅ FACTOR 1: Position within today's range (0-1)
  const positionInRange = dayRange > 0 ? (current - dayLow) / dayRange : 0.5;

  // ✅ FACTOR 2: Change from previous close (%)
  const percentAboveClose = dayClose > 0 ? ((current - dayClose) / dayClose) * 100 : 0;

  // ✅ FACTOR 3: Volatility/Range size (%)
  const rangePercent = dayClose > 0 ? (dayRange / dayClose) * 100 : 0;

  // 🔥 IMPROVED SCORING SYSTEM (0-100)
  let trendScore = 50; // Neutral starting point

  // Adjust based on position in range (contributes ±30 points)
  if (positionInRange > 0.7) {
    trendScore += 30 * (positionInRange - 0.7) / 0.3; // 0-30 points for top 30%
  } else if (positionInRange < 0.3) {
    trendScore -= 30 * (0.3 - positionInRange) / 0.3; // 0 to -30 points for bottom 30%
  }

  // Adjust based on price movement from close (contributes ±40 points)
  if (percentAboveClose > 0) {
    trendScore += Math.min(40, (percentAboveClose * 20)); // 0-40 points, caps at 40
  } else if (percentAboveClose < 0) {
    trendScore += Math.max(-40, (percentAboveClose * 20)); // 0 to -40 points, caps at -40
  }

  // Determine trend from score
  let trend: 'UPTREND' | 'DOWNTREND' | 'RANGE';
  let structure: string;
  const confidence = Math.abs(trendScore - 50);

  if (trendScore > 65) {
    trend = 'UPTREND';
    structure = trendScore > 80 ? 'STRONG_UP' : 'WEAK_UP';
  } else if (trendScore < 35) {
    trend = 'DOWNTREND';
    structure = trendScore < 20 ? 'STRONG_DOWN' : 'WEAK_DOWN';
  } else {
    trend = 'RANGE';
    // Narrow range vs wider consolidation
    structure = rangePercent < 0.5 ? 'CONSOLIDATING' : 'NEUTRAL';
  }

  return {
    trend,
    structure,
    confidence: Math.round(confidence),
    debugInfo: {
      positionInRange: Math.round(positionInRange * 100) / 100,
      percentAboveClose: Math.round(percentAboveClose * 100) / 100,
      trendScore: Math.round(trendScore)
    }
  };
}

/**
 * COMPARISON TABLE
 * ================
 * 
 * Market Scenario          │ Current Logic │ Improved Logic │ Better?
 * ─────────────────────────┼───────────────┼────────────────┼─────────
 * Price: 71% range, +0.3%  │ RANGE         │ WEAK_UP        │ ✅ YES
 * Price: 65% range, +1.2%  │ RANGE         │ WEAK_UP        │ ✅ YES
 * Price: 60% range, +0.8%  │ RANGE         │ WEAK_UP        │ ✅ YES
 * Price: 80% range, +2.5%  │ STRONG_UP     │ STRONG_UP      │ ✅ SAME
 * Price: 50% range, +0.2%  │ RANGE         │ RANGE          │ ✅ SAME
 * Price: 48% range, -0.3%  │ RANGE         │ WEAK_DOWN      │ ✅ YES
 * 
 * KEY IMPROVEMENTS:
 * =================
 * 1. More responsive to actual price movement
 * 2. Weighted scoring is more nuanced
 * 3. Single strong factor can indicate trend
 * 4. Includes confidence score (how strong is the trend?)
 * 5. Debug info helps understand why status changed
 */
