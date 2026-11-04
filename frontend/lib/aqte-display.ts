import type { PositionMetrics } from '@/components/AQTEPosition';

export type AQTESymbol = 'NIFTY' | 'BANKNIFTY' | 'SENSEX';
export type AQTEMode = 'paper' | 'real';
export type AQTEStyle = 'scalp' | 'swing';
export type AQTELiveState = {
  generated_at: number;
  daily_counts: { executed: number; reserved: number };
  enabled: boolean; paper_validated: boolean; unvalidated_rules?: boolean; expected_ip: string;
  ready: boolean; armed: boolean; automation_on: boolean; killed: boolean;
  automation_wanted?: boolean; automation_waiting?: string | null; entry_window?: boolean;
  entry_note?: string | null; styles?: Partial<Record<AQTESymbol, AQTEStyle>>;
  entry_blocks?: Partial<Record<AQTESymbol, string | null>>;
  ranking?: AQTESymbol[];
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
    entry_at?: number; entry_price?: number; exit_price?: number | null; filled?: number;
    initial_stop?: number; stop?: number; target?: number; exit_requested?: string | null;
    exit_unverified?: boolean;
    // Lifecycle fields copied from the active record at close; read defensively (older journals may lack them).
    signal_at?: number | null; entry_ack_at?: number | null; fill_at?: number | null; protect_at?: number | null;
    trail_at?: number | null; trailing_active?: boolean; protection_confirmed?: boolean; exit_reason?: string | null;
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
      (value.entry_note !== undefined && !nullableText(value.entry_note)) ||
      (value.styles !== undefined && (!record(value.styles) ||
        !Object.entries(value.styles).every(([key, style]) => symbolName(key) && (style === 'scalp' || style === 'swing')))) ||
      (value.entry_blocks !== undefined && (!record(value.entry_blocks) ||
        !Object.entries(value.entry_blocks).every(([key, reason]) => symbolName(key) && nullableText(reason)))) ||
      (value.ranking !== undefined && (!Array.isArray(value.ranking) || !value.ranking.every(symbolName))) ||
      !record(value.limits) || !record(value.daily_counts) || !Array.isArray(value.trades)) return false;
  const limits = value.limits;
  if (!['risk_per_trade', 'daily_loss', 'max_trades', 'max_losses', 'max_lots'].every(key => finite(limits[key]) && limits[key] > 0) ||
      !count(value.daily_counts.executed) || !count(value.daily_counts.reserved)) return false;
  if (value.preflight !== null && (!record(value.preflight) || typeof value.preflight.ip !== 'string' ||
      typeof value.preflight.account !== 'string' || !finite(value.preflight.at))) return false;
  if (!value.trades.every(trade => record(trade) && symbolName(trade.symbol) && finite(trade.net_pnl) &&
      finite(trade.exit_at) && ['entry_at', 'entry_price', 'filled', 'initial_stop', 'stop', 'target'].every(key => optionalNumber(trade[key])) &&
      // Backend emergency square-off records exit_price null + exit_unverified when Kite shows no SELL fill.
      (trade.exit_price === undefined || nullableNumber(trade.exit_price)) &&
      (trade.exit_unverified === undefined || typeof trade.exit_unverified === 'boolean') &&
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
  // An unverified exit carries a placeholder net_pnl of 0, so realised P&L is unknown rather than flat.
  const verified = trades.filter(trade => !trade.exit_unverified);
  const unverified = trades.length - verified.length;
  const realized = unverified ? null : verified.reduce((sum, trade) => sum + trade.net_pnl, 0);
  const metrics = aqteLiveMetrics(status, now);
  const openPnl = metrics?.net_pnl ?? null;
  const dayPnl = known && realized != null && !status?.error && (!status?.active || openPnl != null) ? realized + (openPnl ?? 0) : null;
  const wins = verified.filter(trade => trade.net_pnl > 0).length;
  const losses = verified.filter(trade => trade.net_pnl < 0).length;
  let consecutiveLosses = 0;
  for (const trade of [...verified].reverse()) {
    if (trade.net_pnl >= 0) break;
    consecutiveLosses += 1;
  }
  return {
    known, trades, realized: known ? realized : null, openPnl, dayPnl, wins, losses,
    breakeven: verified.length - wins - losses, unverified, consecutiveLosses,
    tradeCount: known && status ? status.daily_counts.executed + status.daily_counts.reserved : null,
    lossLeft: dayPnl != null && status ? Math.max(0, status.limits.daily_loss + dayPnl) : null,
  };
}

export type AQTERuleId = 'ema' | 'vwap' | 'supertrend' | 'rsi' | 'breakout' | 'volume' | 'imbalance' | 'extension' | 'cpr' | 'structure';
export type AQTERuleEvidence = {
  side: 'CE' | 'PE' | null;
  checks: Array<{ id: AQTERuleId; label: string; passed: boolean | null; requirement: string; reason: string }>;
};

export type AQTEContract = { trading_symbol: string; expiry: string; lot_size?: number; strike?: number; side?: 'CE' | 'PE' };
export type AQTESignal = {
  feed_ready?: boolean;
  decision: 'WAIT' | 'BUY CE' | 'BUY PE';
  reasons: string[];
  confidence: number | null;
  spot: number | null;
  at: number | null;
  strategy?: string;
  warmup?: { completed: number; required: number };
  opening?: { completed: number; required: number };
  rule_checks?: Record<AQTEStyle, AQTERuleEvidence> | null;
  scalp?: {
    decision: 'WAIT' | 'BUY CE' | 'BUY PE'; strategy: string | null; confidence: number | null;
    reasons: string[]; contract: AQTEContract | null;
    entry: { maximum: number; stop: number; target: number; points: number; reward_risk: number } | null;
  };
  intelligence?: {
    ema: Record<string, number>; close: number; at: number; vwap: number | null;
    rsi: number; atr: number; supertrend: string; supertrend_price: number;
    volume_ratio: number | null; imbalance: number | null; breakout: number; sweep: number;
    volume?: number; average_volume?: number; breakout_high?: number; breakout_low?: number;
    structure: string; cpr: { top: number; bottom: number; pivot: number } | null;
    live?: {
      token: number; at: number; received: number; price: number; buy_depth: number; sell_depth: number;
      oi: number | null; oi_reference: number | null; oi_reference_at: number | null;
      oi_change: number | null; oi_change_pct: number | null;
    };
  } | null;
  contract: AQTEContract | null;
  entry: { low: number; high: number; maximum: number; stop: number; target: number; reward_risk: number; quantity?: number } | null;
  engines?: AQTEEngine[] | null;
  orchestration?: AQTEOrchestration | null;
  market?: AQTEMarketContext | null;
  position: {
    entry_at: number | null; entry_price: number | null; limit: number; stop: number;
    initial_stop: number; target: number; peak: number;
    contract: { trading_symbol: string }; metrics: PositionMetrics;
  } | null;
};

export function isAqteIntelligence(value: unknown): value is NonNullable<AQTESignal['intelligence']> {
  if (!record(value) || !record(value.ema)) return false;
  const ema = value.ema;
  if (!['9', '20', '50', '100', '200'].every(key => finite(ema[key]) && ema[key] > 0) ||
      !['close', 'at', 'supertrend_price'].every(key => finite(value[key]) && value[key] > 0) ||
      !finite(value.atr) || value.atr < 0 || !finite(value.rsi) || value.rsi < 0 || value.rsi > 100 ||
      !(value.vwap === null || (finite(value.vwap) && value.vwap > 0)) ||
      !(value.volume_ratio === null || (finite(value.volume_ratio) && value.volume_ratio >= 0)) ||
      !(value.imbalance === null || (finite(value.imbalance) && Math.abs(value.imbalance) <= 1)) ||
      !['breakout', 'sweep'].every(key => finite(value[key]) && [-1, 0, 1].includes(value[key])) ||
      typeof value.supertrend !== 'string' || !['BULLISH', 'BEARISH'].includes(value.supertrend) ||
      typeof value.structure !== 'string' || !['HIGHER_HIGH', 'LOWER_LOW', 'RANGE'].includes(value.structure) ||
      !['volume', 'average_volume', 'breakout_high', 'breakout_low'].every(key =>
        value[key] === undefined || (finite(value[key]) && value[key] >= 0))) return false;
  const cpr = value.cpr;
  if (cpr !== null && (!record(cpr) ||
      !['top', 'bottom', 'pivot'].every(key => finite(cpr[key]) && cpr[key] > 0))) return false;
  if (value.live === undefined) return true;
  const live = value.live;
  return record(live) && count(live.token) && finite(live.token) && live.token > 0 &&
    ['at', 'received', 'price'].every(key => finite(live[key]) && live[key] > 0) &&
    count(live.buy_depth) && count(live.sell_depth) &&
    ['oi', 'oi_reference'].every(key => live[key] === null || count(live[key])) &&
    ['oi_reference_at', 'oi_change', 'oi_change_pct'].every(key => nullableNumber(live[key]));
}

export function isAqteRuleChecks(value: unknown): value is Record<AQTEStyle, AQTERuleEvidence> {
  if (!record(value)) return false;
  const ids = {
    scalp: ['ema', 'vwap', 'supertrend', 'rsi', 'breakout', 'volume', 'imbalance', 'extension'],
    swing: ['ema', 'vwap', 'supertrend', 'rsi', 'cpr', 'volume', 'imbalance', 'breakout', 'structure'],
  };
  return (['scalp', 'swing'] as const).every(style => {
    const evidence = value[style];
    return record(evidence) && (evidence.side === null || evidence.side === 'CE' || evidence.side === 'PE') &&
      Array.isArray(evidence.checks) && evidence.checks.length === ids[style].length &&
      new Set(evidence.checks.map(check => record(check) ? check.id : null)).size === ids[style].length &&
      evidence.checks.every(check => record(check) && typeof check.id === 'string' && ids[style].includes(check.id) &&
        (check.passed === null || typeof check.passed === 'boolean') &&
        ['label', 'requirement', 'reason'].every(key => typeof check[key] === 'string'));
  });
}

export function aqteFeedCurrent(signal: AQTESignal | undefined, now = Date.now() / 1000) {
  const age = signal?.at == null ? NaN : now - signal.at;
  return signal?.feed_ready === true && Number.isFinite(age) && age >= -1 && age <= 5;
}

const formatter = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const aqtePrice = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '--' : formatter.format(value);
export const aqteSigned = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '--' : `${value > 0 ? '+' : ''}${formatter.format(value)}`;
export const aqteLabel = (symbol: AQTESymbol) => symbol === 'BANKNIFTY' ? 'BANK NIFTY' : symbol;

export function aqteOverview(signal: AQTESignal | undefined, mode: AQTEMode, unavailable: boolean, now = Date.now() / 1000) {
  const intelligence = signal?.intelligence;
  const age = intelligence ? now - intelligence.at : NaN;
  const info = !unavailable && isAqteIntelligence(intelligence) && (mode !== 'real' || aqteFeedCurrent(signal, now)) &&
    Number.isFinite(age) && age >= -1 && age <= 180 ? intelligence : null;
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

export type AQTEEngineStatus = 'SATISFIED' | 'PARTIAL' | 'MONITORING' | 'NOT_SATISFIED';
export type AQTEEngineRule = { id: string; label: string; passed: boolean | null; requirement: string; value: string | null };
export type AQTEEngine = {
  id: number; key: string; name: string; status: AQTEEngineStatus; side: 'CE' | 'PE' | null;
  passed: number; total: number; score: number | null; authority: 'ENTRY' | 'ADVISORY' | 'SHADOW';
  rules: AQTEEngineRule[]; reason: string | null;
};
export type AQTEOrchestration = {
  satisfied: number; partial: number; monitoring: number; not_satisfied: number;
  ce: number; pe: number; consensus: 'CE' | 'PE' | null; conflict: boolean; evaluated: number; consensus_pct: number | null;
};
export type AQTEMarketContext = {
  regime: string | null; volatility: string | null; liquidity: string | null;
  pcr: number | null; vix: number | null; vix_change_pct: number | null;
};
export type AQTEEngineEvent = {
  at: number; symbol: AQTESymbol; engine: number; name: string;
  status: AQTEEngineStatus; previous: AQTEEngineStatus | null; side: 'CE' | 'PE' | null;
};
export type AQTEEnginePolicy = { authority: string; veto: boolean; veto_min: number; engines: number };

const ENGINE_STATUSES = ['SATISFIED', 'PARTIAL', 'MONITORING', 'NOT_SATISFIED'];
const sideName = (value: unknown) => value === null || value === 'CE' || value === 'PE';
const nullableLabel = (value: unknown) => value === null || typeof value === 'string';

function isAqteEngine(value: unknown): value is AQTEEngine {
  return record(value) && count(value.id) && typeof value.key === 'string' && typeof value.name === 'string' &&
    ENGINE_STATUSES.includes(value.status as string) && sideName(value.side) &&
    count(value.passed) && count(value.total) && (value.passed as number) <= (value.total as number) &&
    (value.score === null || (finite(value.score) && value.score >= 0 && value.score <= 100)) &&
    ['ENTRY', 'ADVISORY', 'SHADOW'].includes(value.authority as string) && nullableText(value.reason) &&
    Array.isArray(value.rules) && value.rules.length === value.total &&
    value.rules.every(rule => record(rule) && typeof rule.id === 'string' && typeof rule.label === 'string' &&
      (rule.passed === null || typeof rule.passed === 'boolean') && typeof rule.requirement === 'string' &&
      nullableText(rule.value));
}

function isAqteOrchestration(value: unknown): value is AQTEOrchestration {
  return record(value) && ['satisfied', 'partial', 'monitoring', 'not_satisfied', 'ce', 'pe', 'evaluated'].every(key => count(value[key])) &&
    sideName(value.consensus) && typeof value.conflict === 'boolean' &&
    (value.consensus_pct === null || (finite(value.consensus_pct) && value.consensus_pct >= 0 && value.consensus_pct <= 100));
}

function isAqteMarketContext(value: unknown): value is AQTEMarketContext {
  return record(value) && ['regime', 'volatility', 'liquidity'].every(key => nullableLabel(value[key])) &&
    ['pcr', 'vix', 'vix_change_pct'].every(key => nullableNumber(value[key]));
}

export function isAqteEngineEvent(value: unknown): value is AQTEEngineEvent {
  return record(value) && finite(value.at) && symbolName(value.symbol) && count(value.engine) &&
    typeof value.name === 'string' && ENGINE_STATUSES.includes(value.status as string) &&
    (value.previous === null || ENGINE_STATUSES.includes(value.previous as string)) && sideName(value.side);
}

/** Engine deck data for one index, or null when the backend has not supplied a well-formed evaluation. */
export function aqteEngineView(signal: AQTESignal | undefined) {
  const engines = signal?.engines;
  if (!Array.isArray(engines) || engines.length !== 12 || !engines.every(isAqteEngine) ||
      !isAqteOrchestration(signal?.orchestration)) return null;
  return { engines, orchestration: signal.orchestration, market: isAqteMarketContext(signal.market) ? signal.market : null };
}

/** Mirrors the live controller: scalp style trades the quick-scalp sub-signal, swing trades the main signal. */
export function aqteEffectiveSignal(signal: AQTESignal | undefined, style: AQTEStyle = 'scalp') {
  if (!signal) return null;
  if (style !== 'scalp') return { decision: signal.decision, confidence: signal.confidence, contract: signal.contract,
    entry: signal.entry, reasons: signal.reasons, strategy: signal.strategy ?? null };
  const scalp = signal.scalp;
  return { decision: scalp?.decision ?? 'WAIT', confidence: scalp?.confidence ?? null, contract: scalp?.contract ?? null,
    entry: scalp?.entry ?? null, reasons: scalp?.reasons?.length ? scalp.reasons : ['Waiting for a quick-scalp setup'],
    strategy: scalp?.strategy ?? null };
}

/** Same ordering as the backend rank_key: actionable entry, aligned satisfied engines, then rule score. */
export function aqteRankKey(signal: AQTESignal | undefined, style: AQTEStyle = 'scalp'): [number, number, number] {
  const effective = aqteEffectiveSignal(signal, style);
  const side = effective && effective.decision !== 'WAIT' && effective.entry ? effective.decision.slice(-2) as 'CE' | 'PE' : null;
  const orchestration = isAqteOrchestration(signal?.orchestration) ? signal.orchestration : null;
  const aligned = side && orchestration ? side === 'CE' ? orchestration.ce : orchestration.pe : 0;
  const confidence = effective?.confidence;
  return [side ? 1 : 0, aligned, typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : 0];
}

export function aqteRanking(data: Partial<Record<AQTESymbol, AQTESignal>> | undefined,
  styles: Partial<Record<AQTESymbol, AQTEStyle>> = {}): AQTESymbol[] {
  const symbols: AQTESymbol[] = ['NIFTY', 'BANKNIFTY', 'SENSEX'];
  const keys = new Map(symbols.map(symbol => [symbol, aqteRankKey(data?.[symbol], styles[symbol] ?? 'scalp')]));
  return [...symbols].sort((a, b) => {
    const [x, y] = [keys.get(a)!, keys.get(b)!];
    return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
  });
}

/**
 * The index the central controller would enter next. automated_entry walks the ranking and skips any
 * index whose entry checks fail, so the first unblocked index wins; otherwise the top ranked one explains the wait.
 */
export function aqteOpportunitySymbol(ranking: readonly AQTESymbol[],
  blocks?: Partial<Record<AQTESymbol, string | null>> | null): AQTESymbol | null {
  return ranking.find(symbol => blocks?.[symbol] === null) ?? ranking[0] ?? null;
}

/** Value equality for small JSON payloads; lets memoised views skip polls that carry identical data. */
export function aqteSameJson(a: unknown, b: unknown) {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** Keep the last backend-confirmed view this long through browser-side connection drops. */
export const AQTE_RECONNECT_GRACE_MS = 10_000;
export const AQTE_CONNECTION_LOST = 'Server not reachable from this browser · reconnecting automatically. Server-side auto trade does not depend on this page.';

/** True when the browser itself failed to reach the server (offline, sleep, timeout), not a backend answer. */
export function aqteConnectionDrop(cause: unknown): boolean {
  if (!cause || typeof cause !== 'object' || !('name' in cause)) return false;
  const { name, message } = cause as { name?: unknown; message?: unknown };
  return name === 'AbortError' ||
    (name === 'TypeError' && typeof message === 'string' && /fetch|network|load failed/i.test(message));
}

export function aqteErrorText(cause: unknown, fallback: string): string {
  if (aqteConnectionDrop(cause)) return AQTE_CONNECTION_LOST;
  const message = cause && typeof cause === 'object' && 'message' in cause ? (cause as { message?: unknown }).message : null;
  return typeof message === 'string' && message ? message : fallback;
}

/**
 * Runs `tick` now and `everyMs` after each completion. Browsers throttle hidden tabs, so it also
 * re-runs at once when the tab becomes visible, the window regains focus or the network returns.
 */
export function aqtePollLoop(tick: () => Promise<void>, everyMs = 2000): () => void {
  let active = true;
  let running = false;
  let queued = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async (): Promise<void> => {
    if (!active) return;
    if (running) { queued = true; return; }
    clearTimeout(timer);
    running = true;
    try {
      await tick();
    } finally {
      running = false;
      if (active) {
        if (queued) { queued = false; void run(); } else timer = setTimeout(run, everyMs);
      }
    }
  };
  const browser = typeof window !== 'undefined' && typeof document !== 'undefined';
  const wake = () => { if (document.visibilityState === 'visible') void run(); };
  if (browser) {
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
  }
  void run();
  return () => {
    active = false;
    clearTimeout(timer);
    if (browser) {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
    }
  };
}
