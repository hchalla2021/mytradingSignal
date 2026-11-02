import type { PositionMetrics } from '@/components/AQTEPosition';

export type AQTESymbol = 'NIFTY' | 'BANKNIFTY' | 'SENSEX';
export type AQTEMode = 'paper' | 'real';
export type AQTELiveState = {
  generated_at: number;
  daily_counts: { executed: number; reserved: number };
  enabled: boolean; paper_validated: boolean; unvalidated_rules?: boolean; expected_ip: string;
  ready: boolean; armed: boolean; automation_on: boolean; killed: boolean;
  automation_wanted?: boolean; automation_waiting?: string | null; entry_window?: boolean;
  flatten_pending?: boolean; error: string | null; connection_error?: string;
  preflight: { ip: string; at: number; account: string } | null;
  limits: { risk_per_trade: number; daily_loss: number; max_trades: number; max_losses: number; max_lots: number };
  active: {
    id: string; symbol: AQTESymbol; state: string; filled: number; exited?: number;
    entry_price: number; stop: number; target: number; initial_stop: number; peak: number;
    error: string | null; trailing_active?: boolean; trail_start_r?: number;
    fill_at?: number; entry_at: number; signal_at?: number | null; entry_ack_at?: number;
    protect_at?: number; trail_at?: number; exit_request_at?: number;
    limit: number; protection_confirmed?: boolean; metrics: PositionMetrics;
    modify?: { order_type: string; trigger_price: number };
    entry_id: string | null; protect_id: string | null; exit_requested?: string | null;
    contract: { trading_symbol: string; lot_size?: number };
  } | null;
  trades: Array<{
    symbol: AQTESymbol; net_pnl: number; exit_at: number;
    entry_at?: number; entry_price?: number; exit_price?: number; filled?: number;
    initial_stop?: number; stop?: number; target?: number; exit_requested?: string | null;
    contract?: { trading_symbol: string };
  }>;
};
export type AQTEExitRequest = { tradeId: string; contract: string; quantity: number; action: 'exit' | 'book' };

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const count = (value: unknown) => finite(value) && Number.isInteger(value) && value >= 0;
const optionalNumber = (value: unknown) => value === undefined || finite(value);
const nullableNumber = (value: unknown) => value === null || finite(value);
const nullableText = (value: unknown) => value === null || typeof value === 'string';
const symbolName = (value: unknown) => value === 'NIFTY' || value === 'BANKNIFTY' || value === 'SENSEX';

export function isAqteLiveState(value: unknown): value is AQTELiveState {
  if (!record(value) || !finite(value.generated_at) ||
      !['enabled', 'paper_validated', 'ready', 'armed', 'automation_on', 'killed'].every(key => typeof value[key] === 'boolean') ||
      !nullableText(value.error) || typeof value.expected_ip !== 'string' ||
      (value.flatten_pending !== undefined && typeof value.flatten_pending !== 'boolean') ||
      (value.unvalidated_rules !== undefined && typeof value.unvalidated_rules !== 'boolean') ||
      (value.automation_wanted !== undefined && typeof value.automation_wanted !== 'boolean') ||
      (value.entry_window !== undefined && typeof value.entry_window !== 'boolean') ||
      (value.automation_waiting !== undefined && !nullableText(value.automation_waiting)) ||
      !record(value.limits) || !record(value.daily_counts) || !Array.isArray(value.trades)) return false;
  const limits = value.limits;
  if (!['risk_per_trade', 'daily_loss', 'max_trades', 'max_losses', 'max_lots'].every(key => finite(limits[key]) && limits[key] > 0) ||
      !count(value.daily_counts.executed) || !count(value.daily_counts.reserved)) return false;
  if (value.preflight !== null && (!record(value.preflight) || typeof value.preflight.ip !== 'string' ||
      typeof value.preflight.account !== 'string' || !finite(value.preflight.at))) return false;
  if (!value.trades.every(trade => record(trade) && symbolName(trade.symbol) && finite(trade.net_pnl) &&
      finite(trade.exit_at) && ['entry_at', 'entry_price', 'exit_price', 'filled', 'initial_stop', 'stop', 'target'].every(key => optionalNumber(trade[key])) &&
      (trade.exit_requested === undefined || nullableText(trade.exit_requested)) &&
      (trade.contract === undefined || (record(trade.contract) && typeof trade.contract.trading_symbol === 'string')))) return false;
  if (value.active === null) return true;
  const active = value.active;
  if (!record(active) || typeof active.id !== 'string' || !/^[0-9a-f]{16}$/.test(active.id) ||
      !symbolName(active.symbol) || typeof active.state !== 'string' || !count(active.filled) ||
      (active.exited !== undefined && !count(active.exited)) || !nullableText(active.error) ||
      !nullableText(active.entry_id) || !nullableText(active.protect_id) ||
      !record(active.contract) || typeof active.contract.trading_symbol !== 'string' ||
      !record(active.metrics)) return false;
  if (!['entry_price', 'stop', 'target', 'initial_stop', 'peak', 'entry_at', 'limit'].every(key => finite(active[key])) ||
      !['fill_at', 'entry_ack_at', 'protect_at', 'trail_at', 'exit_request_at', 'trail_start_r'].every(key => optionalNumber(active[key])) ||
      (active.signal_at !== undefined && !nullableNumber(active.signal_at)) ||
      (active.exit_requested !== undefined && !nullableText(active.exit_requested)) ||
      ['trailing_active', 'protection_confirmed'].some(key => active[key] !== undefined && typeof active[key] !== 'boolean') ||
      (active.modify !== undefined && (!record(active.modify) || typeof active.modify.order_type !== 'string' ||
        !finite(active.modify.trigger_price)))) return false;
  const metrics = active.metrics;
  return typeof metrics.stale === 'boolean' && count(metrics.quantity) &&
    ['quote_at', 'ltp', 'bid', 'points', 'gross_pnl', 'net_pnl', 'return_pct', 'peak_points', 'stop_points'].every(key => nullableNumber(metrics[key]));
}

export const aqteIstDay = (seconds: number) => new Date((seconds + 19_800) * 1000).toISOString().slice(0, 10);
export function aqteControllerCurrent(status: AQTELiveState | null | undefined, now = Date.now() / 1000) {
  const age = status ? now - status.generated_at : NaN;
  return !!status && !status.connection_error && status.ready && Number.isFinite(age) && age >= -1 && age <= 10;
}
export function aqteLiveMetrics(status: AQTELiveState | null | undefined, now = Date.now() / 1000) {
  const active = status?.active;
  const metrics = active?.metrics;
  const age = metrics?.quote_at != null ? now - metrics.quote_at : NaN;
  return aqteControllerCurrent(status, now) && !status?.error && !active?.error && metrics &&
    !metrics.stale && Number.isFinite(age) && age >= -1 && age <= 5 ? metrics : null;
}
export function aqteCanExit(status: AQTELiveState | null | undefined) {
  return aqteControllerCurrent(status) && !status?.killed && !status?.flatten_pending &&
    !!status?.active?.id && status.active.filled > (status.active.exited ?? 0);
}
export function aqteDaySummary(status: AQTELiveState | null | undefined, now = Date.now() / 1000) {
  const known = aqteControllerCurrent(status, now);
  const trades = known ? status?.trades.filter(trade => aqteIstDay(trade.exit_at) === aqteIstDay(now)) ?? [] : [];
  const realized = trades.reduce((sum, trade) => sum + trade.net_pnl, 0);
  const metrics = aqteLiveMetrics(status, now);
  const openPnl = metrics?.net_pnl ?? null;
  const dayPnl = known && !status?.error && (!status?.active || openPnl != null) ? realized + (openPnl ?? 0) : null;
  const wins = trades.filter(trade => trade.net_pnl > 0).length;
  const losses = trades.filter(trade => trade.net_pnl < 0).length;
  let consecutiveLosses = 0;
  for (const trade of [...trades].reverse()) {
    if (trade.net_pnl >= 0) break;
    consecutiveLosses += 1;
  }
  return {
    known, trades, realized: known ? realized : null, openPnl, dayPnl, wins, losses,
    breakeven: trades.length - wins - losses, consecutiveLosses,
    tradeCount: known && status ? status.daily_counts.executed + status.daily_counts.reserved : null,
    lossLeft: dayPnl != null && status ? Math.max(0, status.limits.daily_loss + dayPnl) : null,
  };
}

export type AQTESignal = {
  decision: 'WAIT' | 'BUY CE' | 'BUY PE';
  reasons: string[];
  confidence: number | null;
  spot: number | null;
  at: number | null;
  strategy?: string;
  warmup?: { completed: number; required: number };
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
