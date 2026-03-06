// Enhanced Pivot Analysis Types
// For the refactored Pivot Points section

export type MarketStatus = 
  | 'STRONG_BULLISH'
  | 'BULLISH'
  | 'NEUTRAL'
  | 'BEARISH'
  | 'STRONG_BEARISH';

export type PredictionDirection = 'UP' | 'DOWN' | 'SIDEWAYS';

export interface ClassicPivots {
  s3: number;
  s2: number;
  s1: number;
  pivot: number;
  r1: number;
  r2: number;
  r3: number;
}

export interface CamarillaPivots {
  l4: number;
  l3: number;
  h3: number;
  h4: number;
}

export interface NearestLevel {
  name: string;
  value: number;
  distance: number;
  distance_pct: number;
}

/**
 * Enhanced Pivot Analysis Result
 * Includes market status, confidences, and 5-minute prediction
 */
export interface EnhancedPivotAnalysis {
  // Symbol & Status
  symbol: string;
  status: 'LIVE' | 'CACHED' | 'OFFLINE';
  
  // Price
  current_price: number;
  
  // Pivot Levels (stable, don't change during market)
  classic_pivots: ClassicPivots;
  camarilla_pivots: CamarillaPivots;
  
  // Market Status Analysis
  // 5-level classification based on multiple factors
  market_status: MarketStatus;
  
  // Pivot Confidence Score (0-100%)
  // How reliable are the pivot levels today?
  pivot_confidence: number;
  pivot_confidence_reasons: string[];
  
  // Nearest Support & Resistance
  nearest_resistance?: NearestLevel;
  nearest_support?: NearestLevel;
  
  // 5-Minute Prediction
  // Separate from pivot analysis
  prediction_direction: PredictionDirection;
  prediction_confidence: number;
  prediction_reasons: string[];
  
  // Timestamp
  timestamp: string;
}

/**
 * Market Status Confidence Levels
 * Used for styling and display
 */
export const MARKET_STATUS_CONFIG: Record<MarketStatus, {
  label: string;
  emoji: string;
  bgColor: string;
  borderColor: string;
  textColor: string;
  confidence: number;
}> = {
  STRONG_BULLISH: {
    label: 'STRONG BULLISH',
    emoji: '🚀',
    bgColor: 'bg-green-600/30',
    borderColor: 'border-green-500/60',
    textColor: 'text-green-300',
    confidence: 90,
  },
  BULLISH: {
    label: 'BULLISH',
    emoji: '📈',
    bgColor: 'bg-emerald-600/25',
    borderColor: 'border-emerald-500/50',
    textColor: 'text-emerald-300',
    confidence: 70,
  },
  NEUTRAL: {
    label: 'NEUTRAL',
    emoji: '⚪',
    bgColor: 'bg-amber-600/25',
    borderColor: 'border-amber-500/40',
    textColor: 'text-amber-300',
    confidence: 50,
  },
  BEARISH: {
    label: 'BEARISH',
    emoji: '📉',
    bgColor: 'bg-red-600/25',
    borderColor: 'border-red-500/50',
    textColor: 'text-red-300',
    confidence: 70,
  },
  STRONG_BEARISH: {
    label: 'STRONG BEARISH',
    emoji: '📉',
    bgColor: 'bg-red-700/30',
    borderColor: 'border-red-500/60',
    textColor: 'text-red-300',
    confidence: 90,
  },
};

/**
 * Prediction Direction Config
 */
export const PREDICTION_CONFIG: Record<PredictionDirection, {
  label: string;
  description: string;
  bgColor: string;
  textColor: string;
  accentColor: string;
}> = {
  UP: {
    label: 'Expected Up',
    description: 'Market likely to move upward in next 5 minutes',
    bgColor: 'bg-green-900/20',
    textColor: 'text-green-300',
    accentColor: 'text-green-400',
  },
  DOWN: {
    label: 'Expected Down',
    description: 'Market likely to move downward in next 5 minutes',
    bgColor: 'bg-red-900/20',
    textColor: 'text-red-300',
    accentColor: 'text-red-400',
  },
  SIDEWAYS: {
    label: 'Sideways',
    description: 'Market expected to consolidate in next 5 minutes',
    bgColor: 'bg-amber-900/20',
    textColor: 'text-amber-300',
    accentColor: 'text-amber-400',
  },
};

/**
 * Pivot Level Descriptions
 */
export const PIVOT_LEVELS: Record<string, {
  label: string;
  type: 'resistance' | 'pivot' | 'support';
  description: string;
  strength: 'extreme' | 'strong' | 'moderate';
}> = {
  R3: {
    label: 'R3',
    type: 'resistance',
    description: 'Extreme/Session High Resistance',
    strength: 'extreme',
  },
  R2: {
    label: 'R2',
    type: 'resistance',
    description: 'Strong Resistance',
    strength: 'strong',
  },
  R1: {
    label: 'R1',
    type: 'resistance',
    description: 'Moderate Resistance',
    strength: 'moderate',
  },
  PIVOT: {
    label: 'Pivot',
    type: 'pivot',
    description: 'Central Pivot - Mean Reversion Point',
    strength: 'strong',
  },
  S1: {
    label: 'S1',
    type: 'support',
    description: 'Moderate Support',
    strength: 'moderate',
  },
  S2: {
    label: 'S2',
    type: 'support',
    description: 'Strong Support',
    strength: 'strong',
  },
  S3: {
    label: 'S3',
    type: 'support',
    description: 'Extreme/Session Low Support',
    strength: 'extreme',
  },
};

/**
 * Confidence Level Helper
 */
export function getConfidenceLevel(confidence: number): 'high' | 'moderate' | 'low' {
  if (confidence >= 70) return 'high';
  if (confidence >= 45) return 'moderate';
  return 'low';
}

/**
 * Confidence Color Helper
 */
export function getConfidenceColor(confidence: number): string {
  if (confidence >= 80) return 'text-green-400';
  if (confidence >= 60) return 'text-emerald-400';
  if (confidence >= 45) return 'text-amber-400';
  return 'text-red-400';
}

/**
 * Format Number with Locale
 */
export function formatPrice(price: number | null | undefined): string {
  if (price === null || price === undefined) return '—';
  return price.toLocaleString('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

/**
 * Format Percentage Change
 */
export function formatPercentage(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(3)}%`;
}

/**
 * Determine if price is near a level (within threshold)
 */
export function isNearLevel(
  price: number | null,
  level: number | null,
  thresholdPct: number = 0.5
): boolean {
  if (!price || !level) return false;
  const percentDiff = Math.abs(price - level) / level * 100;
  return percentDiff < thresholdPct;
}

/**
 * Get distance between price and level (in points and percentage)
 */
export function getDistance(
  price: number,
  level: number
): { points: number; percentage: number } {
  const points = Math.abs(price - level);
  const percentage = (points / price) * 100;
  return { points, percentage };
}
