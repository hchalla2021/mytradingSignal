'use client';

import { useEffect, useRef, useState } from 'react';
import { API_CONFIG } from '@/lib/api-config';
import { notifyAppAccessExpired } from '@/lib/app-access-events';
import { getOrCreateVisitorId } from '@/lib/visitor-id';
import { aqteObserveServerClock, aqteServerNow } from '@/lib/aqte-display';
import type { MarketData } from '@/hooks/useMarketSocket';
import { Activity, ArrowDown, ArrowUp, BarChart3, Check, ShieldCheck, TrendingUp, Zap } from 'lucide-react';

type QepSignal = {
  decision: string;
  side?: 'CE' | 'PE' | null;
  reason?: string;
  contract?: { trading_symbol?: string; option_type?: string; lot_size?: number };
  entry?: { maximum?: number; stop?: number; target?: number; quantity?: number; reward_risk?: number };
  risk?: number;
  metrics?: Record<string, number | null>;
  rules?: Record<string, boolean | Record<string, boolean>>;
};
type QepTrade = {
  id: string;
  symbol: string;
  state: string;
  contract: { trading_symbol: string; option_type?: string; lot_size?: number };
  stop: number;
  target: number;
  filled: number;
  quantity: number;
  entry_price: number;
  trailing_active?: boolean;
};
type QepStatus = {
  generated_at: number;
  ready: boolean;
  enabled: boolean;
  armed: boolean;
  entry_window: boolean;
  lots: number;
  risk_per_trade: number;
  daily_loss_limit: number;
  max_trades: number;
  daily_trades: number;
  daily_pnl: number;
  active: QepTrade | null;
  error: string | null;
  signals: Record<string, QepSignal>;
  hybrid_ai?: {
    enabled: boolean;
    model: string;
    busy: boolean;
    pending: number;
    deduplicated: number;
    ai_slot: string | null;
    last_ai_at: number | null;
    last_error: string | null;
    daily_calls: number;
    daily_cost_usd: number;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function isQepSignal(value: unknown): value is QepSignal {
  if (!isRecord(value) || typeof value.decision !== 'string') return false;
  if (value.side !== undefined && value.side !== null && value.side !== 'CE' && value.side !== 'PE') return false;
  if (value.reason !== undefined && typeof value.reason !== 'string') return false;
  if (value.contract !== undefined && value.contract !== null &&
      (!isRecord(value.contract) || (value.contract.trading_symbol !== undefined &&
        typeof value.contract.trading_symbol !== 'string'))) return false;
  if (value.entry !== undefined && value.entry !== null) {
    if (!isRecord(value.entry)) return false;
    for (const key of ['maximum', 'stop', 'target', 'quantity', 'reward_risk']) {
      const field = value.entry[key];
      if (field !== undefined && (typeof field !== 'number' || !Number.isFinite(field))) return false;
    }
  }
  if (value.risk !== undefined && (typeof value.risk !== 'number' || !Number.isFinite(value.risk))) return false;
  if (value.metrics !== undefined && value.metrics !== null &&
      (!isRecord(value.metrics) || Object.values(value.metrics).some(field =>
        field !== null && (typeof field !== 'number' || !Number.isFinite(field))))) return false;
  if (value.rules !== undefined && value.rules !== null && (!isRecord(value.rules) ||
      Object.values(value.rules).some(rule => typeof rule !== 'boolean' &&
        (!isRecord(rule) || Object.values(rule).some(result => typeof result !== 'boolean'))))) return false;
  return true;
}

function ruleResults(signal: QepSignal | undefined) {
  if (!signal?.rules) return { side: signal?.side ?? null, rules: {} as Record<string, boolean> };
  const direct = Object.values(signal.rules).every(rule => typeof rule === 'boolean');
  if (direct) return { side: signal.side ?? null, rules: signal.rules as Record<string, boolean> };
  const options = signal.rules as Record<string, Record<string, boolean>>;
  const side = signal.side ?? (Object.entries(options)
    .map(([name, rules]) => [name, Object.values(rules).filter(Boolean).length] as const)
    .sort((left, right) => right[1] - left[1])[0]?.[0] as 'CE' | 'PE' | undefined) ?? null;
  return { side, rules: options[side ?? 'CE'] ?? {} };
}

function sideRuleResults(signal: QepSignal | undefined) {
  if (!signal?.rules || Object.values(signal.rules).every(rule => typeof rule === 'boolean')) return [];
  return (['CE', 'PE'] as const).flatMap(side => {
    const candidate = signal.rules?.[side];
    if (!isRecord(candidate)) return [];
    const entries = Object.entries(candidate);
    if (!entries.length || entries.some(([, passed]) => typeof passed !== 'boolean')) return [];
    const rules = candidate as Record<string, boolean>;
    const failed = entries.filter(([, passed]) => !passed).map(([name]) => ruleLabels[name] ?? name);
    return [{ side, rules, passed: entries.length - failed.length, total: entries.length, failed }];
  });
}

function quantEdgeErrorText(message: string | null | undefined) {
  if (!message) return null;
  if (/too many requests/i.test(message)) {
    return 'Zerodha temporarily rate-limited broker requests. Calls are now paced. Check Kite Orders and Positions before retrying; order submissions are never retried automatically.';
  }
  return message;
}

const money = (value: number | null | undefined) => value != null && Number.isFinite(value)
  ? `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
const number = (value: number | null | undefined) => value != null && Number.isFinite(value)
  ? value.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—';
const label = (symbol: string) => symbol === 'BANKNIFTY' ? 'BANK NIFTY' : symbol === 'NIFTY' ? 'NIFTY 50' : symbol;
const optionSideLabel = (side: 'CE' | 'PE') => side === 'CE' ? 'CALL (CE)' : 'PUT (PE)';
const optionSide = (value: string | undefined): 'CE' | 'PE' | null =>
  value === 'CE' || value?.endsWith('CE') ? 'CE' : value === 'PE' || value?.endsWith('PE') ? 'PE' : null;

const symbols = ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const;
const ruleLabels: Record<string, string> = {
  band_breakout: 'Bollinger breakout',
  directional_candle: 'Directional candle',
  strong_body: 'Strong candle body',
  close_position: 'Close position',
  range_expansion: 'ATR range expansion',
  volume_expansion: 'Volume expansion',
  rsi_confirmation: 'RSI confirmation',
};
const headers = () => ({
  'Content-Type': 'application/json',
  'X-Device-Id': getOrCreateVisitorId(),
  'X-AQTE-Intent': 'manual-live-control',
});

function isQepStatus(value: unknown): value is QepStatus {
  if (!isRecord(value)) return false;
  const status = value;
  const active = status.active;
  const activeValid = active === null || (isRecord(active) && typeof active.id === 'string' &&
    typeof active.symbol === 'string' && typeof active.state === 'string' && isRecord(active.contract) &&
    typeof active.contract.trading_symbol === 'string' && typeof active.stop === 'number' &&
    Number.isFinite(active.stop) && typeof active.target === 'number' && Number.isFinite(active.target) &&
    typeof active.filled === 'number' && Number.isInteger(active.filled) &&
    typeof active.quantity === 'number' && Number.isInteger(active.quantity) &&
    typeof active.entry_price === 'number' && Number.isFinite(active.entry_price));
  const signalsValid = isRecord(status.signals) && Object.values(status.signals).every(isQepSignal);
  if (status.hybrid_ai !== undefined && (!isRecord(status.hybrid_ai) ||
      typeof status.hybrid_ai.enabled !== 'boolean' ||
      typeof status.hybrid_ai.model !== 'string' ||
      typeof status.hybrid_ai.busy !== 'boolean' ||
      typeof status.hybrid_ai.pending !== 'number' ||
      typeof status.hybrid_ai.deduplicated !== 'number' ||
      (status.hybrid_ai.ai_slot !== null && typeof status.hybrid_ai.ai_slot !== 'string') ||
      (status.hybrid_ai.last_ai_at !== null && typeof status.hybrid_ai.last_ai_at !== 'number') ||
      (status.hybrid_ai.last_error !== null && typeof status.hybrid_ai.last_error !== 'string') ||
      typeof status.hybrid_ai.daily_calls !== 'number' ||
      typeof status.hybrid_ai.daily_cost_usd !== 'number')) return false;
  return typeof status.generated_at === 'number' && Number.isFinite(status.generated_at) &&
    typeof status.ready === 'boolean' &&
    typeof status.enabled === 'boolean' && typeof status.armed === 'boolean' &&
    typeof status.entry_window === 'boolean' &&
    typeof status.lots === 'number' && Number.isInteger(status.lots) &&
    typeof status.risk_per_trade === 'number' && Number.isFinite(status.risk_per_trade) &&
    typeof status.daily_loss_limit === 'number' && Number.isFinite(status.daily_loss_limit) &&
    typeof status.max_trades === 'number' && Number.isInteger(status.max_trades) &&
    typeof status.daily_trades === 'number' && Number.isInteger(status.daily_trades) &&
    typeof status.daily_pnl === 'number' && Number.isFinite(status.daily_pnl) &&
    activeValid && signalsValid &&
    (status.error === null || typeof status.error === 'string');
}

async function request(path: 'status' | 'config' | 'approval' | 'exit', body?: object, signal?: AbortSignal) {
  const sent = Date.now();
  const response = await fetch(API_CONFIG.endpoint(`/api/quantedge/${path}`), {
    method: body === undefined ? 'GET' : 'POST',
    headers: headers(),
    credentials: 'include',
    cache: 'no-store',
    signal,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const received = Date.now();
  const payload: unknown = await response.json();
  aqteObserveServerClock(response, payload, sent, received);
  if (!response.ok) {
    if (response.status === 401) notifyAppAccessExpired();
    const detail = payload && typeof payload === 'object' && 'detail' in payload ? payload.detail : null;
    throw new Error(typeof detail === 'string' ? detail : `QuantEdge Pro request failed (${response.status})`);
  }
  return payload;
}

export default function QuantEdgeProSection({ marketData, isConnected = false, vix }: {
  marketData?: MarketData;
  isConnected?: boolean;
  vix?: { value: number | null; changePercent: number | null };
}) {
  const [live, setLive] = useState<QepStatus | null>(null);
  const [statusStale, setStatusStale] = useState(true);
  const [lots, setLots] = useState(1);
  const [selectedSymbol, setSelectedSymbol] = useState('NIFTY');
  const [busy, setBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const initialized = useRef(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const value = await request('status', undefined, controller.signal);
        if (!isQepStatus(value)) throw new Error('Invalid QuantEdge Pro status response');
        const age = aqteServerNow() - value.generated_at;
        if (age < -1 || age > 10) throw new Error('QuantEdge Pro status is stale');
        if (active) {
          setLive(value);
          setStatusStale(false);
          setStatusError(null);
          if (!initialized.current) {
            initialized.current = true;
            setLots(value.lots);
          }
        }
      } catch (reason) {
        if (active && !controller.signal.aborted) {
          setStatusStale(true);
          setStatusError(reason instanceof Error ? reason.message : 'QuantEdge Pro status unavailable');
        }
      } finally {
        if (active) timer = setTimeout(poll, 5000);
      }
    };
    void poll();
    return () => {
      active = false;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, []);

  const act = async (path: 'config' | 'approval' | 'exit', body: object) => {
    setBusy(true);
    setOperationError(null);
    try {
      const value = await request(path, body);
      if (!isQepStatus(value)) throw new Error('Invalid QuantEdge Pro operation response');
      setLive(value);
      setStatusStale(false);
      setLots(value.lots);
      initialized.current = true;
    } catch (reason) {
      setOperationError(reason instanceof Error ? reason.message : 'QuantEdge Pro operation failed');
    } finally {
      setBusy(false);
    }
  };

  const setApproval = (enabled: boolean) => {
    if (!live || busy || (enabled && (statusStale || live.enabled || !!activeTrade)) ||
        (!enabled && !live.enabled)) return;
    void act('approval', {
      enabled,
      confirmation: enabled ? 'ENABLE QUANTEDGE PRO LIVE TRADING' : 'STOP QUANTEDGE PRO ENTRIES',
    });
  };

  const toggleApproval = () => {
    if (live) setApproval(!live.enabled);
  };

  const requestExit = () => {
    if (!live?.active || statusStale) return;
    if (!window.confirm(`Close only the QuantEdge Pro trade in ${live.active.contract.trading_symbol}?`)) return;
    void act('exit', { trade_id: live.active.id, confirmation: 'CLOSE QUANTEDGE PRO TRADE' });
  };

  const activeTrade = live?.active ?? null;
  const symbol = activeTrade?.symbol ?? selectedSymbol;
  const signal = live?.signals[symbol];
  const signalSide = signal?.decision === 'BUY CE' ? 'CE' : signal?.decision === 'BUY PE' ? 'PE' : null;
  const activeSide = activeTrade
    ? optionSide(activeTrade.contract.option_type) ?? optionSide(activeTrade.contract.trading_symbol)
    : null;
  const candidate = signalSide ? signal?.entry : undefined;
  const contract = activeTrade?.contract ?? (signalSide ? signal?.contract : undefined);
  const directionText = activeTrade
    ? activeSide ? `POSITION OPEN · BUY ${optionSideLabel(activeSide)}` : 'POSITION OPEN · OPTION SIDE UNAVAILABLE'
    : signalSide ? `ENTRY QUALIFIED · BUY ${optionSideLabel(signalSide)}` : 'WAIT · NO QUALIFIED ENTRY';
  const toneSide = activeTrade ? activeSide : signalSide;
  const directionTone = toneSide
    ? toneSide === 'PE' ? 'border-cyan-400 bg-cyan-950 text-cyan-100'
      : 'border-emerald-400 bg-emerald-950 text-emerald-100'
    : 'border-amber-400 bg-amber-950 text-amber-100';
  const tradeStatus = !live ? 'OFFLINE' : activeTrade ? activeTrade.state.replaceAll('_', ' ')
    : live.enabled ? live.armed && live.entry_window ? 'LIVE ENTRIES ON' : 'APPROVED · WAITING FOR SESSION'
      : live.ready && live.armed ? 'ARMED · WAITING' : 'PREPARATION REQUIRED';
  const entryPrice = activeTrade ? activeTrade.entry_price : candidate?.maximum;
  const stopPrice = activeTrade ? activeTrade.stop : candidate?.stop;
  const targetPrice = activeTrade ? activeTrade.target : candidate?.target;
  const quantity = activeTrade ? activeTrade.filled : candidate?.quantity;
  const maxLoss = activeTrade && entryPrice != null && stopPrice != null
    ? Math.max(0, entryPrice - stopPrice) * quantity! : signal?.risk;
  const grossReward = entryPrice != null && targetPrice != null && quantity != null
    ? Math.max(0, targetPrice - entryPrice) * quantity : null;
  const { side: ruleSide, rules } = ruleResults(signal);
  const ruleEntries = Object.entries(rules);
  const passedRules = ruleEntries.filter(([, passed]) => passed).length;
  const sideRules = sideRuleResults(signal);
  const waitingOnBothSides = signal?.decision === 'WAIT' && sideRules.length === 2;
  const executionChecksPending = sideRules.some(sideResult => sideResult.passed === sideResult.total);
  const displayedRuleCount = waitingOnBothSides
    ? sideRules.map(({ side, passed, total }) => `${side === 'CE' ? 'CALL (CE)' : 'PUT (PE)'} checks ${passed}/${total}`).join(' · ')
    : ruleEntries.length ? `${passedRules}/${ruleEntries.length} checks passed` : 'Rule checks unavailable';
  const qualificationDetail = activeTrade ? 'Broker position is open'
    : signalSide ? 'Entry rules and execution checks passed'
      : executionChecksPending ? 'Rules passed; execution checks are still pending'
        : 'No side has passed all 7 entry rules';
  const statusLabel = statusStale || !live ? 'OFFLINE'
    : live.enabled ? live.armed && live.entry_window ? 'LIVE' : 'ON · WAITING'
      : live.ready && live.armed ? 'ARMED' : 'OFF';
  return (
    <section className="aqte-theme aqx-shell qep-standalone-shell grid gap-4 rounded-2xl border p-4 sm:p-5"
      aria-label="QuantEdge Pro standalone trading engine">
      <header className="qep-header flex flex-wrap items-center gap-5 border-b px-1 pb-4">
        <div className="flex min-w-[250px] items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-xl border border-emerald-400/40 bg-emerald-950/50 text-emerald-300">
            <TrendingUp size={28} strokeWidth={2.5} />
          </span>
          <div>
            <h2 className="text-2xl font-extrabold tracking-wide text-white">QuantEdge Pro</h2>
            <p className="text-sm text-slate-300">AI Quant Trading</p>
          </div>
        </div>
        <div className="ml-auto flex min-w-0 flex-col items-end gap-2">
          <div className="flex flex-wrap items-center justify-end gap-1">
            <div className="flex flex-nowrap items-center gap-1">
              <button type="button" role="switch" aria-label="QuantEdge Pro trade approval"
                aria-checked={live?.enabled ?? false}
                disabled={!live || busy || (statusStale && !live.enabled) || (!live.enabled && !!activeTrade)}
                onClick={toggleApproval}
                className={`inline-flex min-h-11 w-28 shrink-0 items-center justify-center gap-2 rounded-full border px-2 text-sm font-extrabold disabled:cursor-not-allowed disabled:opacity-60 ${
                  live?.enabled ? 'border-emerald-500 bg-emerald-950 text-emerald-200' : 'border-slate-600 bg-slate-900 text-slate-300'
                }`}>
                TRADE <span className={`rounded-full px-2 py-0.5 text-xs font-black text-white ${
                  live?.enabled ? 'bg-emerald-700' : 'bg-slate-600'
                }`}>{live?.enabled ? 'ON' : 'OFF'}</span>
              </button>
              <div role="group" aria-label="QuantEdge Pro execution mode"
                className="flex shrink-0 rounded-lg border border-slate-700 bg-[#050d15] p-1">
                <button type="button" aria-pressed={live?.enabled ?? false}
                  disabled={!live || statusStale || busy || live.enabled || !!activeTrade}
                  onClick={() => setApproval(true)}
                  className={`min-h-9 w-20 rounded-md px-1 text-xs font-extrabold disabled:cursor-not-allowed disabled:opacity-50 ${
                    live?.enabled ? 'border border-emerald-500 bg-emerald-700/40 text-white' : 'text-cyan-100'
                  }`}>
                  Live (Auto)
                </button>
                <button type="button" aria-pressed={!live?.enabled}
                  disabled={!live || busy || !live.enabled}
                  onClick={() => setApproval(false)}
                  className={`min-h-9 w-16 rounded-md px-1 text-xs font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-50 ${
                    !live?.enabled ? 'border border-slate-500 bg-slate-700/60' : ''
                  }`}>
                  Manual
                </button>
              </div>
              </div>
              <span className="hidden items-center gap-1.5 text-xs text-slate-400 sm:inline-flex">
              <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-slate-600'}`} />
              {isConnected ? 'Market feed live' : 'Market feed offline'}
            </span>
            <span className={`flex h-9 w-32 shrink-0 items-center justify-center whitespace-nowrap rounded-full border px-2 text-sm font-bold ${
              statusLabel === 'LIVE' ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                : statusLabel === 'ARMED' ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200'
                  : 'border-slate-600 bg-slate-800/70 text-slate-300'
            }`}><span className="mr-1.5 text-emerald-400">●</span>{statusLabel}</span>
            <Zap aria-hidden="true" size={21} className="shrink-0 text-slate-300" />
          </div>
        </div>
      </header>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Live index prices">
        {symbols.map(item => {
          const tick = marketData?.[item];
          const hasPoints = tick != null && Number.isFinite(tick.change);
          const hasPercent = tick != null && Number.isFinite(tick.changePercent);
          const up = tick != null && tick.change >= 0;
          return (
            <button key={item} type="button" onClick={() => setSelectedSymbol(item)}
              className={`qep-market-card relative min-w-0 overflow-hidden rounded-xl border p-3 text-left transition-colors sm:p-4 ${
                selectedSymbol === item ? 'border-emerald-500/50' : 'border-slate-700/70 hover:border-slate-500'
              }`}>
              <div className="flex items-center justify-between gap-2">
                <b className="text-sm font-bold text-slate-200">{label(item)}</b>
                <span className={`h-2 w-2 rounded-full ${tick?.status === 'LIVE' ? 'bg-emerald-400' : 'bg-slate-600'}`} />
              </div>
              <div className="mt-1 text-xl font-extrabold tabular-nums text-white sm:text-2xl">{number(tick?.price)}</div>
              <div className={`mt-1 inline-flex flex-wrap items-center gap-x-1.5 text-xs font-bold sm:text-sm ${
                !hasPoints && !hasPercent ? 'text-slate-400' : up ? 'text-emerald-400' : 'text-rose-400'
              }`}>
                {!hasPoints && !hasPercent ? 'No live change data' : up ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
                {hasPoints && <span>{up ? '+' : ''}{number(tick.change)} pts</span>}
                {hasPoints && hasPercent && <span className="text-slate-500">·</span>}
                {hasPercent && <span>{tick.changePercent >= 0 ? '+' : ''}{tick.changePercent.toFixed(2)}%</span>}
              </div>
            </button>
          );
        })}
        <div className="qep-market-card min-w-0 rounded-xl border p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <b className="text-sm font-bold text-slate-200">INDIA VIX</b>
            <Activity size={19} className="text-cyan-300" />
          </div>
          <div className="mt-1 text-xl font-extrabold tabular-nums text-white sm:text-2xl">{number(vix?.value)}</div>
          <div className={`mt-1 text-xs font-bold sm:text-sm ${vix?.changePercent == null ? 'text-slate-400' : vix.changePercent >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
            {vix?.changePercent == null ? 'No VIX data available' : `${vix.changePercent >= 0 ? '+' : ''}${vix.changePercent.toFixed(2)}%`}
          </div>
        </div>
      </div>
      <div id="qep-trade" className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(290px,1fr)]">
        <section className="qep-trade-panel min-w-0 rounded-2xl border p-5 sm:p-6"
          aria-label="QuantEdge Pro trade setup">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <span role="status" aria-live="polite"
                className={`rounded-xl border px-4 py-2.5 text-base font-black leading-tight sm:text-lg ${directionTone}`}>
                {directionText}
              </span>
              <h3 className="truncate text-2xl font-extrabold text-white sm:text-3xl">
                {contract?.trading_symbol ?? `${label(symbol)} · ${signalSide ? 'Entry qualified' : 'Waiting for an entry'}`}
              </h3>
            </div>
            {waitingOnBothSides
              ? <div role="group" aria-label="Entry rule progress by option side" className="flex flex-wrap gap-2">
                {sideRules.map(({ side, passed, total }) => (
                  <span key={side} className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-200">
                    {optionSideLabel(side)} <b className="ml-1 tabular-nums">{passed}/{total}</b>
                  </span>
                ))}
              </div>
              : <span className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-200">
                {displayedRuleCount}
              </span>}
          </div>
          {activeTrade
            ? <p className="mt-2 text-base text-slate-300">Broker position · {activeTrade.state.replaceAll('_', ' ')}</p>
            : !waitingOnBothSides && (
              <p className="mt-2 text-base text-slate-300">
                {signal?.reason ?? 'Waiting for completed candles and live option data.'}
              </p>
            )}
          <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              { title: 'BUY PRICE', value: money(entryPrice), icon: <TrendingUp size={19} />, color: 'emerald' },
              { title: 'STOP LOSS', value: money(stopPrice), icon: <ShieldCheck size={19} />, color: 'rose' },
              { title: 'TRAILING SL', value: activeTrade?.trailing_active ? money(activeTrade.stop)
                : activeTrade ? `Initial ${money(activeTrade.stop)}` : 'Arms after fill', icon: <Activity size={19} />, color: 'amber' },
              { title: 'TARGET', value: money(targetPrice), icon: <BarChart3 size={19} />, color: 'emerald' },
            ].map(level => (
              <div key={level.title} className={`qep-level rounded-xl border p-4 sm:p-5 ${
                level.color === 'rose' ? 'border-rose-500/50 bg-rose-950/35' :
                  level.color === 'amber' ? 'border-amber-500/40 bg-amber-950/25' :
                    'border-emerald-500/50 bg-emerald-950/30'
              }`}>
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-300">{level.icon}{level.title}</div>
                <div className={`mt-2 truncate text-2xl font-extrabold tabular-nums sm:text-3xl ${
                  level.color === 'rose' ? 'text-rose-400' : level.color === 'amber' ? 'text-amber-300' : 'text-white'
                }`}>{level.value}</div>
              </div>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 border-b border-slate-700/70 pb-4 text-center sm:grid-cols-4">
            <div><p className="text-sm text-slate-400">Risk / Reward</p><b className="text-xl text-white">{candidate?.reward_risk != null ? `1 : ${candidate.reward_risk.toFixed(2)}` : '—'}</b></div>
            <div><p className="text-sm text-slate-400">Quantity</p><b className="text-xl text-white">{number(quantity)}</b></div>
            <div><p className="text-sm text-slate-400">Max Loss</p><b className="text-xl text-rose-300">{money(maxLoss)}</b></div>
            <div><p className="text-sm text-slate-400">Gross Reward at Target</p><b className="text-xl text-emerald-300">{money(grossReward)}</b></div>
          </div>
          {activeTrade && <div id="qep-active-position" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-950/20 p-3">
            <div>
              <b className="text-sm text-amber-200">Active QEP position · {activeTrade.contract.trading_symbol}</b>
              <p className="text-xs text-slate-300">{activeTrade.filled}/{activeTrade.quantity} filled · Entry {money(activeTrade.entry_price)}</p>
            </div>
            <button type="button" disabled={busy || statusStale} onClick={requestExit}
              className="rounded-lg border border-rose-500/50 px-4 py-2 text-sm font-bold text-rose-200 disabled:opacity-50">
              Exit QEP trade
            </button>
          </div>}
          <div id="qep-settings" className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-700/70 bg-slate-950/40 p-3">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              Lots
              <select aria-label="QuantEdge Pro lots" value={lots} disabled={!live?.ready || statusStale || live.enabled || !!activeTrade || busy}
                onChange={event => setLots(Number(event.target.value))}
                className="rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white">
                {[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <button type="button" disabled={!live?.ready || statusStale || live.enabled || !!activeTrade || busy || lots === live?.lots}
              onClick={() => void act('config', { lots })}
              className="rounded-md border border-cyan-500/50 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-50">
              Save lots
            </button>
            <span className="text-xs text-slate-400">
              Risk {money(live?.risk_per_trade)}/trade · Daily loss {money(live?.daily_loss_limit)} ·
              {` ${live?.daily_trades ?? 0}/${live?.max_trades ?? 0} trades`}
            </span>
            {live?.hybrid_ai && (
              <span className="text-xs text-slate-400">
                Hybrid AI: {live.hybrid_ai.enabled ? 'ON' : 'OFF'} ·
                {` ${live.hybrid_ai.pending} pending · ${live.hybrid_ai.daily_calls} calls today · `}
                <span className="text-cyan-300">${live.hybrid_ai.daily_cost_usd.toFixed(4)}</span>
                {live.hybrid_ai.last_error ? ` · ${live.hybrid_ai.last_error}` : ''}
              </span>
            )}
          </div>
          {(operationError || statusError || live?.error) && <p role="alert" className="mt-3 text-sm text-rose-300">
            {quantEdgeErrorText(operationError ?? statusError ?? live?.error)}
          </p>}
        </section>
        <aside id="qep-position" className="qep-status-panel rounded-2xl border p-5 sm:p-6" aria-label="QuantEdge Pro trade status">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-2xl font-extrabold text-white">Trade Status</h3>
            <span className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${
              live?.enabled ? 'border-emerald-500/50 text-emerald-300' : live?.ready && live.armed ? 'border-cyan-500/40 text-cyan-200' : 'border-slate-600 text-slate-300'
            }`}>{tradeStatus}</span>
          </div>
          <div role="status" aria-label="Entry qualification" className="my-4 rounded-xl border border-slate-700 bg-slate-950/50 p-4 text-center">
            <b className={`text-xl font-black ${signalSide ? 'text-emerald-300' : 'text-amber-200'}`}>
              {activeTrade ? 'POSITION OPEN' : signalSide ? `BUY ${optionSideLabel(signalSide)}` : 'WAIT · NO ENTRY'}
            </b>
            <p className="mt-1 text-sm text-slate-300">{qualificationDetail}</p>
          </div>
          <p id="qep-analytics" className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-400">
            {waitingOnBothSides ? 'CALL (CE) and PUT (PE) entry checks' :
              ruleSide ? `${optionSideLabel(ruleSide)} entry checks` : 'Strategy Rules'}
          </p>
          <ul className="space-y-1">
            {waitingOnBothSides
              ? sideRules.map(({ side, rules: sideResults, passed, total }) => (
                <li key={side} className="list-none rounded-lg border border-slate-700/70 bg-slate-950/30 p-3">
                  <p className="mb-1 text-sm font-bold text-slate-200">{optionSideLabel(side)} · {passed}/{total} checks</p>
                  <ul>
                    {Object.entries(ruleLabels).map(([key, title]) => {
                      const passedRule = sideResults[key];
                      return <li key={key} className="flex items-center gap-2 border-b border-slate-700/50 py-1.5 text-sm last:border-0">
                        <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                          passedRule ? 'bg-emerald-600 text-white' : 'bg-rose-950 text-rose-300'
                        }`}>{passedRule ? <Check size={11} /> : '×'}</span>
                        <span className={passedRule ? 'text-slate-200' : 'text-slate-400'}>{title}</span>
                      </li>;
                    })}
                  </ul>
                </li>
              ))
              : Object.entries(ruleLabels).map(([key, title]) => {
                const passed = rules[key];
                return <li key={key} className="flex items-center gap-2 border-b border-slate-700/50 py-2.5 text-base">
                  <span className={`grid h-6 w-6 place-items-center rounded-full ${
                    passed === true ? 'bg-emerald-600 text-white' : passed === false ? 'bg-rose-950 text-rose-300' : 'bg-slate-700 text-slate-300'
                  }`}>{passed === true ? <Check size={13} /> : '·'}</span>
                  <span className={passed === false ? 'text-slate-400' : 'text-slate-200'}>{title}</span>
                </li>;
              })}
          </ul>
        </aside>
      </div>
    </section>
  );
}
