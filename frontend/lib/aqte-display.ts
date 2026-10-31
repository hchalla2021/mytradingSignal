import type { PositionMetrics } from '@/components/AQTEPosition';

export type AQTESymbol = 'NIFTY' | 'BANKNIFTY' | 'SENSEX';
export type AQTEMode = 'paper' | 'real';
export type AQTESignal = {
  decision: 'WAIT' | 'BUY CE' | 'BUY PE';
  reasons: string[];
  confidence: number | null;
  spot: number | null;
  at: number | null;
  strategy?: string;
  intelligence?: {
    ema: Record<string, number>; close: number; at: number; vwap: number | null;
    rsi: number; atr: number; supertrend: string; supertrend_price: number;
    volume_ratio: number; imbalance: number | null; breakout: number; sweep: number;
    structure: string; cpr: { top: number; bottom: number; pivot: number } | null;
  } | null;
  contract: { trading_symbol: string; expiry: string } | null;
  entry: { low: number; high: number; maximum: number; stop: number; target: number; reward_risk: number; quantity?: number } | null;
  position: {
    entry_at: number | null; entry_price: number | null; limit: number; stop: number;
    initial_stop: number; target: number; peak: number;
    contract: { trading_symbol: string }; metrics: PositionMetrics;
  } | null;
};

const formatter = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const aqtePrice = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '--' : formatter.format(value);
export const aqteSigned = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '--' : `${value > 0 ? '+' : ''}${formatter.format(value)}`;
export const aqteLabel = (symbol: AQTESymbol) => symbol === 'BANKNIFTY' ? 'BANK NIFTY' : symbol;

export function aqteOverview(signal: AQTESignal | undefined, mode: AQTEMode, unavailable: boolean) {
  const intelligence = signal?.intelligence;
  const age = intelligence ? Date.now() / 1000 - intelligence.at : NaN;
  const info = !unavailable && Number.isFinite(age) && age >= -1 && age <= 180 ? intelligence : null;
  const decision = mode === 'real' || unavailable ? 'WAIT' : signal?.decision ?? 'WAIT';
  const entry = decision === 'WAIT' ? null : signal?.entry;
  const position = mode === 'real' ? null : signal?.position;
  const marked = !unavailable && position?.metrics && !position.metrics.stale;
  return {
    info, decision, entry, position,
    contract: decision !== 'WAIT' ? signal?.contract?.trading_symbol : null,
    direction: info?.supertrend === 'BULLISH' ? 'BULLISH' : info?.supertrend === 'BEARISH' ? 'BEARISH' : 'WAITING',
    confidence: decision === 'WAIT' ? null : signal?.confidence,
    ltp: marked ? position.metrics.ltp : null,
    stop: position?.stop ?? entry?.stop,
    target: position?.target ?? entry?.target,
    trailing: !!position && position.stop > position.initial_stop,
    expected: entry?.quantity ? (entry.target - entry.maximum) * entry.quantity : null,
  };
}
