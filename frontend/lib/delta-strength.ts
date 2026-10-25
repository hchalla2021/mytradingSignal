/**
 * Live Delta Strength: buyer/seller pressure from recorded order-flow bars.
 *
 * Honesty rules: delta = aggressive buy volume − aggressive sell volume as recorded by the backend. Zerodha Kite does not
 * publish trade-level aggressor flags, so the side of every trade is ESTIMATED (Lee-Ready quote/midpoint/tick rule on
 * ~1s KiteTicker snapshots) and the result is always flagged `estimated`. Unclassified volume is never assigned to a side.
 * With no recorded bars the state is UNAVAILABLE; nothing is derived from OHLC candles.
 */
import type { OrderFlowBar } from './order-flow';

export type DeltaState = 'BUYERS' | 'SELLERS' | 'SIDEWAYS' | 'UNAVAILABLE';
export const DELTA_INTERVALS = [1, 3, 5] as const;
export type DeltaInterval = typeof DELTA_INTERVALS[number];

export interface DeltaStrengthConfig {
  /** Candle size (minutes) of the recorded bars used for the rolling window. */
  interval: DeltaInterval;
  /** Rolling window in candles, the forming candle included. */
  window: number;
  /** Volume-weighted strength (% of classified volume) needed to call buyers/sellers stronger. */
  threshold: number;
  /** Minimum recording coverage (0..1) for a call; below it the state is UNAVAILABLE. */
  minCoverage: number;
  /** Window classified volume must be at least this × the session's typical window volume, else SIDEWAYS (thin). */
  minVolumeRatio: number;
  /** An existing call holds while strength stays above threshold × hysteresis (prevents flip-flopping). */
  hysteresis: number;
}

export const DEFAULT_DELTA_CONFIG: DeltaStrengthConfig = {
  interval: 1, window: 5, threshold: 12, minCoverage: 0.6, minVolumeRatio: 0.5, hysteresis: 0.6,
};

export interface DeltaStrength {
  state: DeltaState;
  /** Rolling-window delta (est. aggressive buy − sell volume). Null when nothing was recorded. */
  delta: number | null;
  /** Window delta as % of classified (side-estimated) volume. */
  deltaPct: number | null;
  /** Recency- and volume-weighted delta % (the value compared with the threshold). */
  strength: number | null;
  /** Session cumulative delta at the latest bar. */
  cvd: number | null;
  /** Volume-weighted recording coverage of the window (0..1). */
  coverage: number | null;
  /** Share of window volume whose aggressor side could be estimated (0..1). */
  classifiedShare: number | null;
  /** Always true: Kite provides no trade-level aggressor flag. */
  estimated: true;
  reason: string;
  barTime: number | null;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function sanitizeDeltaConfig(raw: unknown): DeltaStrengthConfig {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const num = (key: keyof DeltaStrengthConfig, low: number, high: number) => {
    const item = value[key];
    return typeof item === 'number' && Number.isFinite(item) ? clamp(item, low, high) : DEFAULT_DELTA_CONFIG[key] as number;
  };
  const interval = DELTA_INTERVALS.find(item => item === value.interval) ?? DEFAULT_DELTA_CONFIG.interval;
  return {
    interval, window: Math.round(num('window', 2, 30)), threshold: num('threshold', 2, 60),
    minCoverage: num('minCoverage', 0, 1), minVolumeRatio: num('minVolumeRatio', 0, 3), hysteresis: num('hysteresis', 0.2, 1),
  };
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Pure and O(session bars); call on every snapshot/update. `previous` is the last state shown for this
 * instrument (enables hysteresis). Re-evaluating with the returned state as `previous` yields the same state.
 */
export function deltaStrength(bars: readonly OrderFlowBar[], config: DeltaStrengthConfig, previous: DeltaState | null = null): DeltaStrength {
  const empty: DeltaStrength = {
    state: 'UNAVAILABLE', delta: null, deltaPct: null, strength: null, cvd: null, coverage: null,
    classifiedShare: null, estimated: true, reason: 'No recorded order flow for this session.', barTime: null,
  };
  if (!bars.length) return empty;
  const window = bars.slice(-Math.max(1, config.window));
  const last = window[window.length - 1];
  let delta = 0, classified = 0, total = 0, covered = 0, weightedDelta = 0, weightedVolume = 0;
  window.forEach((bar, i) => {
    const sided = bar.b + bar.s;
    const weight = i + 1;
    delta += bar.d;
    classified += sided;
    total += bar.v;
    covered += bar.coverage * bar.v;
    weightedDelta += weight * bar.d;
    weightedVolume += weight * sided;
  });
  const base: DeltaStrength = {
    ...empty, delta, cvd: last.cvd, barTime: last.t,
    deltaPct: classified > 0 ? (delta / classified) * 100 : null,
    strength: weightedVolume > 0 ? (weightedDelta / weightedVolume) * 100 : null,
    coverage: total > 0 ? covered / total : null,
    classifiedShare: total > 0 ? classified / total : null,
  };
  if (classified <= 0 || base.strength === null || base.deltaPct === null) {
    return { ...base, state: 'UNAVAILABLE', reason: 'No side-classified volume in the window.' };
  }
  if (base.coverage !== null && base.coverage < config.minCoverage) {
    return { ...base, state: 'UNAVAILABLE', reason: `Recording coverage ${Math.round(base.coverage * 100)}% is below ${Math.round(config.minCoverage * 100)}%.` };
  }

  // Noise filter 1: thin windows (vs this session's typical window volume) are not called.
  const typical = median(bars.filter(bar => bar.complete).map(bar => bar.b + bar.s)) * window.length;
  if (typical > 0 && classified < typical * config.minVolumeRatio) {
    return { ...base, state: 'SIDEWAYS', reason: 'Thin volume in the window — pressure not significant.' };
  }

  // Noise filter 2: the plain window delta and the session CVD trend must agree with the weighted strength.
  const trendStart = bars[Math.max(0, bars.length - 1 - window.length * 2)];
  const cvdTrend = last.cvd - trendStart.cvd + (trendStart === last ? last.d : 0);
  const half = config.threshold / 2;
  const enterBuy = base.strength >= config.threshold && base.deltaPct >= half && cvdTrend >= 0;
  const enterSell = base.strength <= -config.threshold && base.deltaPct <= -half && cvdTrend <= 0;
  // Noise filter 3: hysteresis keeps an existing call until strength clearly fades.
  const hold = config.threshold * config.hysteresis;
  if (enterBuy || (previous === 'BUYERS' && base.strength >= hold && base.deltaPct > 0)) {
    return { ...base, state: 'BUYERS', reason: enterBuy ? 'Aggressive buying dominates (est.).' : 'Buyers still in control (holding call).' };
  }
  if (enterSell || (previous === 'SELLERS' && base.strength <= -hold && base.deltaPct < 0)) {
    return { ...base, state: 'SELLERS', reason: enterSell ? 'Aggressive selling dominates (est.).' : 'Sellers still in control (holding call).' };
  }
  const conflict = Math.abs(base.strength) >= config.threshold;
  return { ...base, state: 'SIDEWAYS', reason: conflict ? 'Strength not confirmed by window delta / CVD trend.' : 'Balanced aggression — no side dominates.' };
}
