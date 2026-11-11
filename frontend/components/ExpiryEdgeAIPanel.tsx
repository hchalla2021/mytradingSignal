'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, CheckCircle2, Clock3, ShieldCheck } from 'lucide-react';
import { API_CONFIG } from '@/lib/api-config';
import { getOrCreateVisitorId } from '@/lib/visitor-id';
import type { MarketData } from '@/hooks/useMarketSocket';

const SYMBOLS = ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const;
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;
type SymbolName = typeof SYMBOLS[number];
type Weekday = typeof WEEKDAYS[number];
type Expiry = { expiry: string; listed_option_contracts: number; lot_sizes: number[] };
type Signal = {
  ready: boolean;
  decision: string;
  side: string | null;
  reason: string;
  setup_key: string | null;
  last_close?: number;
  opening_range_high?: number;
  opening_range_low?: number;
  vwap?: number;
  atr?: number;
  underlying_stop?: number;
  trail_distance?: number;
};
type Status = {
  market_data: { state: string; last_tick_at: string | null };
  signal: Signal;
  instruments: Record<SymbolName, {
    next_listed_expiry: Expiry | null;
    configured_weekday_matches: boolean | null;
    configured_weekday: string | null;
  }>;
  markets?: Record<SymbolName, {
    market_data: { state: string; last_tick_at: string | null };
    signal: Signal;
  }>;
  expiry_gates?: Record<SymbolName, {
    eligible: boolean;
    is_listed_expiry_day: boolean;
    is_configured_weekday: boolean;
    configured_weekday: string | null;
  }>;
  expiry_calendar: { state: string };
  live_orders_enabled: boolean;
  block_reasons: string[];
};
type Config = { schedules: Record<SymbolName, { weekday: Weekday | null; updated_at: string | null }> };
type LiveStatus = {
  enabled: boolean;
  live_enabled: boolean;
  can_enable: boolean;
  block_reasons: string[];
  armed: boolean;
  entry_window: boolean;
  reason: string;
  error: string | null;
  active: {
    id: string;
    symbol: SymbolName;
    contract: { side: string; trading_symbol: string };
    filled: number;
    exited: number;
    entry_price?: number;
    stop?: number;
    ltp?: number | null;
    unrealized?: number | null;
    state?: string;
  } | null;
  trades_today: number;
  entries_today: number;
  daily_pnl: number;
  daily_loss_limit: number;
  max_trades: number;
};

function expiryEdgeFeedConnected(status: Status | null, symbol: SymbolName): boolean {
  const state = status?.markets?.[symbol]?.market_data.state ??
    (symbol === 'NIFTY' ? status?.market_data.state : undefined);
  return state === 'CONNECTED' || state === 'LIVE';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(API_CONFIG.endpoint(`/api/expiryedge/${path}`), {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Id': getOrCreateVisitorId(),
      'X-ExpiryEdge-Intent': 'manual-config',
      'X-AQTE-Intent': 'manual-live-control',
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(body?.detail || `Expiry Edge request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

const PRICE_FORMAT = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const EMPTY_MARKET_DATA: MarketData = { NIFTY: null, BANKNIFTY: null, SENSEX: null };

export default function ExpiryEdgeAIPanel({
  marketData = EMPTY_MARKET_DATA,
  isConnected = false,
}: {
  marketData?: MarketData;
  isConnected?: boolean;
}) {
  const [config, setConfig] = useState<Config | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<SymbolName>('NIFTY');
  const [selectedWeekday, setSelectedWeekday] = useState<Weekday | ''>('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<SymbolName | null>(null);
  const [approvalPending, setApprovalPending] = useState(false);
  const [exitPending, setExitPending] = useState(false);
  const strategyFeedConnected = expiryEdgeFeedConnected(status, selectedSymbol);
  const strategySignal = status?.markets?.[selectedSymbol]?.signal ??
    (selectedSymbol === 'NIFTY' ? status?.signal : undefined);
  const liveSignal = strategyFeedConnected ? strategySignal : undefined;
  const hasSignal = strategyFeedConnected && strategySignal?.ready === true &&
    (strategySignal.decision === 'BUY CE' || strategySignal.decision === 'BUY PE');
  const signalLevels: Array<[string, string, number | undefined]> = [
    ['Futures Signal Close', 'text-cyan-100', liveSignal?.last_close],
    ['Underlying Invalidation', 'text-rose-400', liveSignal?.underlying_stop],
    ['ATR Trail Distance', 'text-amber-300', liveSignal?.trail_distance],
  ];
  const signalReason = strategyFeedConnected
    ? strategySignal?.reason ?? 'ExpiryEdge signal status unavailable'
    : `Waiting for a connected, fresh ${selectedSymbol} futures feed`;
  const expiryGate = status?.expiry_gates?.[selectedSymbol];
  const readinessSteps = [
    {
      label: 'EXPIRY GATE',
      detail: expiryGate ? (expiryGate.eligible ? 'ELIGIBLE' : 'NOT ELIGIBLE') : 'WAITING FOR STATUS',
      complete: expiryGate?.eligible === true,
    },
    {
      label: 'VALIDATE FEED',
      detail: strategyFeedConnected ? 'LIVE FUTURES DATA' : 'FEED NOT CONNECTED',
      complete: strategyFeedConnected,
    },
    {
      label: 'QUALIFY SETUP',
      detail: hasSignal ? strategySignal.decision : 'WAIT · NO QUALIFIED SETUP',
      complete: hasSignal,
    },
  ];
  const refreshInProgress = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshInProgress.current) return;
    refreshInProgress.current = true;
    setError('');
    try {
      const [nextConfig, nextStatus, nextLiveStatus] = await Promise.all([
        request<Config>('config'),
        request<Status>('status'),
        request<LiveStatus>(`live/status?symbol=${selectedSymbol}`),
      ]);
      setConfig(nextConfig);
      setStatus(nextStatus);
      setLiveStatus(nextLiveStatus);
    } catch (reason) {
      setStatus(null);
      setLiveStatus(null);
      setError(reason instanceof Error ? reason.message : 'Unable to load Expiry Edge status');
    } finally {
      refreshInProgress.current = false;
    }
  }, [selectedSymbol]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh();
      if (active) timer = setTimeout(() => void poll(), 5000);
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [refresh]);
  useEffect(() => {
    setSelectedWeekday(config?.schedules[selectedSymbol]?.weekday ?? '');
  }, [config, selectedSymbol]);

  async function save() {
    if (!selectedWeekday) return;
    setSaving(selectedSymbol);
    setError('');
    try {
      await request('config', {
        method: 'PUT',
        body: JSON.stringify({ symbol: selectedSymbol, expiry_weekday: selectedWeekday }),
      });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save expiry weekday');
    } finally {
      setSaving(null);
    }
  }

  async function setLiveApproval(enabled: boolean) {
    if (approvalPending || !liveStatus || (enabled && !liveStatus.can_enable)) return;
    setApprovalPending(true);
    setError('');
    try {
      const next = await request<LiveStatus>('live/approval', {
        method: 'POST',
        body: JSON.stringify({
          enabled,
          confirmation: enabled
            ? 'ENABLE EXPIRYEDGE AI LIVE TRADING'
            : 'STOP EXPIRYEDGE AI ENTRIES',
          symbol: selectedSymbol,
        }),
      });
      setLiveStatus(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update ExpiryEdge AI live approval');
      setLiveStatus(null);
    } finally {
      setApprovalPending(false);
    }
  }

  async function exitLivePosition() {
    if (exitPending || !liveStatus?.active) return;
    setExitPending(true);
    setError('');
    try {
      setLiveStatus(await request<LiveStatus>('live/exit', {
        method: 'POST',
        body: JSON.stringify({
          trade_id: liveStatus.active.id,
          confirmation: 'CLOSE EXPIRYEDGE AI TRADE',
          symbol: selectedSymbol,
        }),
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to request ExpiryEdge AI exit');
      setLiveStatus(null);
    } finally {
      setExitPending(false);
    }
  }

  return (
    <section aria-label="Expiry Edge AI Algo" className="overflow-hidden rounded-xl border border-emerald-900 bg-[#020a11] text-slate-100 shadow-[0_12px_30px_rgba(0,0,0,.4)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/80 bg-[#030b12] px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-emerald-500/60 bg-emerald-500/10 shadow-[0_0_18px_rgba(34,197,94,.12)]">
            <Activity aria-hidden="true" className="h-6 w-6 text-emerald-400" />
          </div>
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
            <h2 className="text-lg font-black tracking-tight sm:text-xl">ExpiryEdge <span className="text-emerald-400">AI Algo</span></h2>
            <span className="text-xs text-slate-300 sm:text-sm">Expiry-session strategy monitor</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 text-xs font-bold sm:gap-3 sm:text-sm">
          <div role="group" aria-label="ExpiryEdge trade controls" className="flex flex-wrap items-center gap-2">
            <button type="button" role="switch" aria-checked={liveStatus?.enabled ?? false}
              onClick={() => void setLiveApproval(!liveStatus?.enabled)}
              disabled={approvalPending || !liveStatus || (!liveStatus.enabled && !liveStatus.can_enable)}
              title={liveStatus?.block_reasons.join('; ') || 'Toggle ExpiryEdge AI live entries'}
              className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-3 text-xs font-extrabold disabled:cursor-not-allowed disabled:opacity-60 ${
                liveStatus?.enabled ? 'border-emerald-500 bg-emerald-950 text-emerald-200' : 'border-slate-600 bg-slate-900 text-slate-300'
              }`}>
              TRADE <span className={`rounded-full px-2 py-0.5 text-xs font-black text-white ${liveStatus?.enabled ? 'bg-emerald-700' : 'bg-slate-600'}`}>
                {liveStatus?.enabled ? 'ON' : 'OFF'}
              </span>
            </button>
            <div role="group" aria-label="Execution mode" className="flex rounded-lg border border-slate-700 bg-[#050d15] p-1">
              <button type="button" aria-pressed={liveStatus?.enabled ?? false}
                onClick={() => void setLiveApproval(true)}
                disabled={approvalPending || !liveStatus || (!liveStatus.enabled && !liveStatus.can_enable)}
                title={liveStatus?.block_reasons.join('; ') || 'Enable automatic Zerodha execution'}
                className="min-h-9 rounded-md px-3 text-xs font-extrabold text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50">
                Live (Auto)
              </button>
              <button type="button" aria-pressed={!liveStatus?.enabled}
                onClick={() => void setLiveApproval(false)}
                disabled={approvalPending || !liveStatus || !liveStatus.enabled}
                className={`min-h-9 rounded-md px-3 text-xs font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-50 ${
                  !liveStatus?.enabled ? 'border border-slate-500 bg-slate-700/60' : ''
                }`}>
                Manual
              </button>
            </div>
            {liveStatus && !liveStatus.enabled && !liveStatus.can_enable && (
              <span role="status" className="max-w-full text-xs font-semibold text-amber-300 sm:max-w-72">
                ON blocked: {liveStatus.block_reasons.join('; ') || 'Live approval is unavailable'}
              </span>
            )}
          </div>
          <span className={`rounded-full border px-2.5 py-1 text-[11px] ${isConnected ? 'border-emerald-600 bg-emerald-950 text-emerald-300' : 'border-slate-700 bg-slate-900 text-slate-300'}`}>
            Dashboard quotes: {isConnected ? 'Connected' : 'Offline'}
          </span>
          <span className={strategyFeedConnected ? 'text-emerald-400' : 'text-amber-300'}>
            ExpiryEdge feed: {status ? (strategyFeedConnected ? 'Connected' : 'Not connected') : 'Status unavailable'}
          </span>
          <button type="button" onClick={() => void refresh()} className="min-h-9 rounded-lg border border-slate-700 px-2.5 hover:border-cyan-500" aria-label="Refresh Expiry Edge status">
            Refresh
          </button>
        </div>
      </header>

      <div className="grid gap-1.5 border-b border-slate-800 bg-[#07111a] p-2.5 sm:grid-cols-[minmax(190px,.9fr)_repeat(3,minmax(0,1fr))] sm:items-center sm:px-3">
        <div className="flex min-h-[52px] items-center gap-2.5 rounded-lg border border-slate-700 bg-[#0a1720] px-2.5 py-1.5">
          <Clock3 aria-hidden="true" className="h-6 w-6 shrink-0 text-lime-300" />
          <div>
            <p className="text-xs font-extrabold sm:text-sm">Expiry Session</p>
            <p className="text-xs text-slate-400">{liveStatus?.entry_window ? 'ENTRY WINDOW OPEN' : 'WAITING FOR ENTRY WINDOW'}</p>
          </div>
        </div>
        {readinessSteps.map(step => (
          <div key={step.label} className={`flex min-h-[52px] items-center gap-2.5 rounded-lg border px-2.5 py-1.5 ${
            step.complete ? 'border-emerald-700/80 bg-emerald-950/30' : 'border-slate-700 bg-[#0a1720]'
          }`}>
            <CheckCircle2 aria-hidden="true" className={`h-5 w-5 shrink-0 ${step.complete ? 'text-lime-300' : 'text-slate-600'}`} />
            <div className="min-w-0">
              <p className="text-[11px] text-slate-400">{step.label}</p>
              <p className={`truncate text-xs font-extrabold ${step.complete ? 'text-emerald-300' : 'text-slate-300'}`}>{step.detail}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2.5 p-2.5 sm:p-3">
        {error && <p role="alert" className="rounded-lg border border-rose-500/50 bg-rose-950/60 p-2.5 text-xs text-rose-200 sm:text-sm">{error}</p>}
        {liveStatus && <p role="status" className="rounded-lg border border-slate-800 bg-[#091722] p-2.5 text-xs leading-relaxed text-slate-200 sm:text-sm">
          {liveStatus.error || liveStatus.reason} · {liveStatus.trades_today}/{liveStatus.max_trades} trades today · daily P&amp;L ₹{PRICE_FORMAT.format(liveStatus.daily_pnl)}
          {liveStatus.block_reasons.length > 0 && ` · ${liveStatus.block_reasons.join('; ')}`}
        </p>}

        <div className="grid gap-2">
          <nav aria-label="Select index" className="grid grid-cols-3 gap-1.5 sm:gap-2">
            {SYMBOLS.map(symbol => (
              <button key={symbol} type="button" onClick={() => setSelectedSymbol(symbol)}
                aria-pressed={selectedSymbol === symbol}
                className={`flex min-h-[64px] flex-col items-center justify-center gap-0.5 rounded-lg border px-1.5 py-1.5 text-xs transition-colors sm:text-sm ${
                  selectedSymbol === symbol
                    ? 'border-emerald-400 bg-emerald-600/90 text-white shadow-[0_0_16px_rgba(16,185,129,.35)]'
                    : 'border-slate-700 bg-[#0b1c28] text-slate-200 hover:border-cyan-600'
                }`}>
                <span className="font-extrabold">{symbol === 'BANKNIFTY' ? 'BANK NIFTY' : symbol}</span>
                <span className="text-sm font-bold tabular-nums">
                  {typeof marketData[symbol]?.price === 'number' && Number.isFinite(marketData[symbol]?.price)
                    ? PRICE_FORMAT.format(marketData[symbol]!.price)
                    : '—'}
                </span>
                <span className={`text-xs font-semibold tabular-nums ${
                  (marketData[symbol]?.changePercent ?? 0) > 0 ? 'text-emerald-200'
                    : (marketData[symbol]?.changePercent ?? 0) < 0 ? 'text-rose-200' : 'text-slate-300'
                }`}>
                  {marketData[symbol] && Number.isFinite(marketData[symbol].change) && Number.isFinite(marketData[symbol].changePercent)
                    ? `${marketData[symbol].change > 0 ? '+' : ''}${PRICE_FORMAT.format(marketData[symbol].change)} (${marketData[symbol].changePercent > 0 ? '+' : ''}${marketData[symbol].changePercent.toFixed(2)}%)`
                    : 'Change —'}
                </span>
              </button>
            ))}
          </nav>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-[#091722] p-2 sm:justify-end">
            <label htmlFor="expiry-weekday" className="text-xs font-semibold text-slate-200 sm:text-sm">Expected expiry weekday</label>
            <select id="expiry-weekday" value={selectedWeekday}
              onChange={event => setSelectedWeekday(event.target.value as Weekday | '')}
              className="min-h-9 min-w-28 flex-1 rounded-md border border-slate-600 bg-[#07121c] px-2.5 text-xs sm:flex-none sm:text-sm">
              <option value="">Select day</option>
              {WEEKDAYS.map(day => <option key={day} value={day}>{day}</option>)}
            </select>
            <button type="button" onClick={() => void save()} disabled={!selectedWeekday || saving !== null}
              className="inline-flex min-h-9 items-center gap-2 rounded-md border border-emerald-400/70 bg-emerald-600 px-3 text-xs font-extrabold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">
              Save
            </button>
            <span className="basis-full border-t border-slate-800 pt-2 text-xs text-slate-300 sm:basis-auto sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0">
              {status?.instruments[selectedSymbol]?.next_listed_expiry
                ? `Next listed contract: ${status.instruments[selectedSymbol].next_listed_expiry?.expiry}`
                : 'Next listed contract: unavailable'}
              {status?.instruments[selectedSymbol]?.configured_weekday_matches === false ? ' · Weekday check required' : ''}
            </span>
          </div>
        </div>

        <div className="grid gap-2 lg:grid-cols-2">
          <article className="rounded-lg border border-cyan-900 bg-[#091722] p-2.5 sm:p-3">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Strategy Signal · ORB/VWAP</p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className={`rounded-md border px-3 py-1 text-base font-black ${
                hasSignal
                  ? 'border-cyan-700 bg-cyan-950/50 text-cyan-300'
                  : 'border-amber-700 bg-amber-950/50 text-amber-300'
              }`}>
                {hasSignal ? `CANDIDATE ${strategySignal.decision}` : 'WAIT'}
              </span>
              <span className="text-sm text-slate-400">{hasSignal ? 'Rule-based · not an order' : 'No qualified setup'}</span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {signalReason}
            </p>
          </article>
          <article className="rounded-lg border border-cyan-900 bg-[#091722] p-2.5 sm:p-3">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Today&apos;s P&amp;L</p>
            <p className={`mt-1.5 text-xl font-black sm:text-2xl ${
              (liveStatus?.daily_pnl ?? 0) > 0 ? 'text-emerald-400' : (liveStatus?.daily_pnl ?? 0) < 0 ? 'text-rose-400' : 'text-slate-300'
            }`}>₹{PRICE_FORMAT.format(liveStatus?.daily_pnl ?? 0)}</p>
            <p className="mt-1 text-sm text-slate-400">Today&apos;s ExpiryEdge risk-service P&amp;L</p>
          </article>
        </div>

        <section aria-label="Signal and trade levels" className="grid content-start gap-2 rounded-xl border-2 border-emerald-500 bg-[#04130e] p-2 shadow-[0_0_20px_rgba(16,185,129,.2)] lg:grid-cols-[minmax(205px,.8fr)_24px_minmax(0,1.75fr)_minmax(250px,1.15fr)]">
          <article className="rounded-xl border border-emerald-500 bg-[#062017] p-2.5 shadow-[inset_0_0_16px_rgba(16,185,129,.12)]">
            <h3 className="text-sm font-bold text-slate-100">Market Direction · ORB/VWAP</h3>
            <p className={`mt-1.5 text-xl font-black ${hasSignal ? 'text-cyan-300' : 'text-amber-300'}`}>
              {hasSignal ? strategySignal.decision : 'NO TRADE'}
            </p>
            <p className="mt-2 border-b border-emerald-900 pb-2 text-xs text-slate-300">
              Expiry gate: {expiryGate ? (expiryGate.eligible ? 'Eligible' : 'Blocked') : 'Unavailable'}
            </p>
            <ul className="mt-2 space-y-1 text-xs text-slate-300">
              {(status?.block_reasons.length ? status.block_reasons.slice(0, 4) : ['Market intelligence is not connected']).map(reason => (
                <li key={reason} className="flex gap-2"><span className="text-amber-400">●</span><span>{reason}</span></li>
              ))}
            </ul>
          </article>

          <div aria-hidden="true" className="hidden items-center justify-center text-3xl font-black text-emerald-400 lg:flex">»</div>

          <div className="grid content-start gap-2 self-start">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {signalLevels.map(([label, color, value]) => (
                <article key={label} className="flex min-h-[64px] flex-col items-center justify-center rounded-xl border border-slate-700 bg-[#091a25] p-1.5 text-center">
                  <h3 className="text-xs font-semibold text-slate-200 sm:text-sm">{label}</h3>
                  <p className={`mt-0.5 text-xl font-black ${color}`}>
                    {typeof value === 'number' && Number.isFinite(value) ? PRICE_FORMAT.format(value) : '—'}
                  </p>
                </article>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['Opening Range High', liveSignal?.opening_range_high],
                ['Opening Range Low', liveSignal?.opening_range_low],
              ].map(([label, value]) => (
                <article key={label} className="flex min-h-[58px] flex-col items-center justify-center rounded-xl border border-slate-700 bg-[#071a22] p-1.5 text-center">
                  <h3 className="text-[11px] font-semibold text-slate-300 sm:text-xs">{label}</h3>
                  <p className="mt-0.5 text-lg font-black text-emerald-400">
                    {typeof value === 'number' && Number.isFinite(value) ? PRICE_FORMAT.format(value) : '—'}
                  </p>
                </article>
              ))}
            </div>
          </div>

          <article className="rounded-xl border border-emerald-500 bg-[#062017] p-2.5 shadow-[inset_0_0_16px_rgba(16,185,129,.12)]">
            <h3 className="flex items-center gap-2 font-bold text-slate-100">
              <ShieldCheck aria-hidden="true" className="h-5 w-5 text-lime-300" /> Expiry Validation
            </h3>
            <div className="mt-2 space-y-2 rounded-lg border border-emerald-800 bg-[#071a14] p-2.5 text-xs sm:text-sm">
              <p className="flex justify-between gap-2"><span className="text-slate-300">Next listed contract</span>
                <span className="text-right font-bold text-emerald-300">{status?.instruments[selectedSymbol]?.next_listed_expiry?.expiry ?? 'Unavailable'}</span>
              </p>
              <p className="flex justify-between gap-2"><span className="text-slate-300">Configured weekday</span>
                <span className="font-bold text-slate-100">{config?.schedules[selectedSymbol]?.weekday ?? 'Not set'}</span>
              </p>
              <p className="flex justify-between gap-2 border-t border-emerald-900 pt-2"><span className="text-slate-300">Calendar</span>
                <span className="font-bold text-slate-100">{status?.expiry_calendar.state ?? 'Unavailable'}</span>
              </p>
            </div>
            <p className="mt-2 text-xs text-slate-400">No option target is shown until a validated execution plan is available.</p>
          </article>
        </section>

        <div className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-700/70 bg-[#071b18] p-2.5">
            <span className="text-xs font-extrabold sm:text-sm">Live Auto: <span className={liveStatus?.enabled ? 'text-emerald-300' : 'text-rose-300'}>{liveStatus?.enabled ? 'ON' : 'OFF'}</span></span>
            <span className="text-xs text-slate-400">
              {liveStatus?.active
                ? `Position protection is active · ${liveStatus.active.state ?? 'MANAGING'}`
                : liveStatus?.enabled ? liveStatus.reason : 'Manual mode: signals only; no new orders are submitted.'}
            </span>
          </div>
        </div>

        <div className="grid gap-2 lg:grid-cols-[1.45fr_1fr_.9fr]">
          <article className="overflow-hidden rounded-xl border border-slate-600 bg-[#06131d]">
            <h3 className="border-b border-slate-700 bg-[#0b202b] px-3 py-2.5 text-sm font-extrabold">Open Positions ({liveStatus?.active ? 1 : 0})</h3>
            {liveStatus?.active ? <div className="space-y-2 p-2.5">
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 sm:text-sm">
                <p><span className="text-slate-400">Contract</span><br />{liveStatus.active.contract.trading_symbol}</p>
                <p><span className="text-slate-400">Quantity</span><br />{Math.max(0, liveStatus.active.filled - liveStatus.active.exited)}</p>
                <p><span className="text-slate-400">Entry / Stop</span><br />
                  {liveStatus.active.entry_price ? PRICE_FORMAT.format(liveStatus.active.entry_price) : '—'} / {liveStatus.active.stop ? PRICE_FORMAT.format(liveStatus.active.stop) : '—'}
                </p>
                <p><span className="text-slate-400">LTP</span><br />{liveStatus.active.ltp ? PRICE_FORMAT.format(liveStatus.active.ltp) : '—'}</p>
                <p><span className="text-slate-400">Unrealized P&amp;L</span><br />
                  {liveStatus.active.unrealized == null ? '—' : `₹${PRICE_FORMAT.format(liveStatus.active.unrealized)}`}
                </p>
                <button type="button" onClick={() => void exitLivePosition()} disabled={exitPending}
                  className="min-h-10 rounded-md border border-rose-500 bg-rose-950 px-3 font-bold text-rose-200 disabled:opacity-50">
                  {exitPending ? 'Requesting exit…' : 'Exit ExpiryEdge AI position'}
                </button>
              </div>
            </div> : <p className="px-3 py-4 text-sm text-slate-400">No open ExpiryEdge AI position.</p>}
          </article>
          <article className="overflow-hidden rounded-xl border border-slate-600 bg-[#06131d]">
            <h3 className="border-b border-slate-700 bg-[#0b202b] px-3 py-2.5 text-sm font-extrabold">ExpiryEdge AI Status</h3>
            <p className="px-3 py-3 text-xs text-slate-300 sm:text-sm">{liveStatus?.reason ?? 'Status unavailable'}</p>
          </article>
          <article className="overflow-hidden rounded-xl border border-emerald-800/80 bg-[#06131d]">
            <h3 className="flex items-center gap-2 border-b border-slate-700 bg-[#0b202b] px-3 py-2.5 text-sm font-extrabold">
              <ShieldCheck aria-hidden="true" className="h-4 w-4 text-lime-300" /> Risk Guard
            </h3>
            <div className="space-y-1.5 p-2.5 text-xs">
              <p className="flex justify-between gap-2"><span className="text-slate-300">Daily Loss Limit</span><span>₹{PRICE_FORMAT.format(liveStatus?.daily_loss_limit ?? 0)}</span></p>
              <p className="flex justify-between gap-2"><span className="text-slate-300">Max Trades / Day</span><span>{liveStatus?.max_trades ?? '—'}</span></p>
              <p className="flex justify-between gap-2"><span className="text-slate-300">Max Open Positions</span><span>1 account-wide automated trade</span></p>
              <p className="flex justify-between gap-2 border-t border-slate-700 pt-2"><span className="text-slate-300">Entry permission</span><span className={`font-bold ${liveStatus?.can_enable ? 'text-emerald-300' : 'text-amber-300'}`}>{liveStatus?.can_enable ? 'READY' : 'BLOCKED'}</span></p>
              {liveStatus?.block_reasons.map(reason => <p key={reason} className="text-amber-300">{reason}</p>)}
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
