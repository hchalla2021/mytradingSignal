'use client';

import { useEffect, useRef, useState } from 'react';
import { API_CONFIG } from '@/lib/api-config';
import { notifyAppAccessExpired } from '@/lib/app-access-events';
import { getOrCreateVisitorId } from '@/lib/visitor-id';
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
  lots: number;
  risk_per_trade: number;
  daily_loss_limit: number;
  max_trades: number;
  daily_trades: number;
  daily_pnl: number;
  active: QepTrade | null;
  error: string | null;
  signals: Record<string, QepSignal>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function isQepSignal(value: unknown): value is QepSignal {
  if (!isRecord(value) || typeof value.decision !== 'string') return false;
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

const money = (value: number | null | undefined) => value != null && Number.isFinite(value)
  ? `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
const number = (value: number | null | undefined) => value != null && Number.isFinite(value)
  ? value.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—';
const label = (symbol: string) => symbol === 'BANKNIFTY' ? 'BANK NIFTY' : symbol === 'NIFTY' ? 'NIFTY 50' : symbol;

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
  return typeof status.generated_at === 'number' && Number.isFinite(status.generated_at) &&
    typeof status.ready === 'boolean' &&
    typeof status.enabled === 'boolean' && typeof status.armed === 'boolean' &&
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
  const response = await fetch(API_CONFIG.endpoint(`/api/quantedge/${path}`), {
    method: body === undefined ? 'GET' : 'POST',
    headers: headers(),
    credentials: 'include',
    cache: 'no-store',
    signal,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload: unknown = await response.json();
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
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const value = await request('status', undefined, controller.signal);
        if (!isQepStatus(value)) throw new Error('Invalid QuantEdge Pro status response');
        const age = Date.now() / 1000 - value.generated_at;
        if (age < -1 || age > 10) throw new Error('QuantEdge Pro status is stale');
        if (active) {
          setLive(value);
          setStatusStale(false);
          setError(null);
          if (!initialized.current) {
            initialized.current = true;
            setLots(value.lots);
          }
        }
      } catch (reason) {
        if (active && !controller.signal.aborted) {
          setStatusStale(true);
          setError(reason instanceof Error ? reason.message : 'QuantEdge Pro status unavailable');
        }
      } finally {
        if (active) timer = setTimeout(poll, 2000);
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
    setError(null);
    try {
      const value = await request(path, body);
      if (!isQepStatus(value)) throw new Error('Invalid QuantEdge Pro operation response');
      setLive(value);
      setStatusStale(false);
      setLots(value.lots);
      initialized.current = true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'QuantEdge Pro operation failed');
    } finally {
      setBusy(false);
    }
  };

  const toggleApproval = () => {
    if (!live || statusStale) return;
    const enabled = !live.enabled;
    if (enabled && !window.confirm(
      'Enable QuantEdge Pro live trading? This permits real Zerodha orders after the existing broker preflight and session-arm gates pass.'
    )) return;
    void act('approval', {
      enabled,
      confirmation: enabled ? 'ENABLE QUANTEDGE PRO LIVE TRADING' : 'STOP QUANTEDGE PRO ENTRIES',
    });
  };

  const requestExit = () => {
    if (!live?.active || statusStale) return;
    if (!window.confirm(`Close only the QuantEdge Pro trade in ${live.active.contract.trading_symbol}?`)) return;
    void act('exit', { trade_id: live.active.id, confirmation: 'CLOSE QUANTEDGE PRO TRADE' });
  };

  const activeTrade = live?.active ?? null;
  const symbol = activeTrade?.symbol ?? selectedSymbol;
  const signal = live?.signals[symbol];
  const candidate = signal?.entry;
  const contract = activeTrade?.contract ?? signal?.contract;
  const tradeSide = activeTrade?.contract.option_type ?? signal?.side ??
    (signal?.decision.startsWith('BUY ') ? signal.decision.slice(4) : null);
  const tradeStatus = !live ? 'OFFLINE' : activeTrade ? activeTrade.state.replaceAll('_', ' ')
    : live.enabled ? 'LIVE ENTRIES ON' : live.armed ? 'READY' : 'PREPARATION REQUIRED';
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
  const rulePercent = ruleEntries.length ? Math.round(passedRules / ruleEntries.length * 100) : null;
  const statusLabel = statusStale || !live ? 'OFFLINE'
    : live.enabled ? 'LIVE' : live.ready && live.armed ? 'READY' : 'OFF';
  const startDisabledReason = busy ? 'A QuantEdge Pro request is still in progress.'
    : statusStale ? 'QuantEdge Pro status is stale; waiting for a fresh backend update.'
      : !live ? error ?? 'Waiting for authenticated QuantEdge Pro status.'
      : !live.ready ? 'The live execution controller is not ready; check backend status.'
        : !live.enabled && activeTrade ? 'An existing QuantEdge Pro position must be resolved before starting new entries.'
          : !live.enabled && !live.armed
            ? 'Pre-open data and analysis start at 09:00 IST. To trade live, run broker preflight and arm today’s session during market hours; live approval is available weekdays from 09:15 to 15:15 IST.'
            : null;
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
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden items-center gap-1.5 text-xs text-slate-400 sm:inline-flex">
            <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-slate-600'}`} />
            {isConnected ? 'Market feed live' : 'Market feed offline'}
          </span>
          <span className={`rounded-full border px-3 py-1.5 text-sm font-bold ${
            statusLabel === 'LIVE' ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
              : statusLabel === 'READY' ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200'
                : 'border-slate-600 bg-slate-800/70 text-slate-300'
          }`}><span className="mr-1.5 text-emerald-400">●</span>{statusLabel}</span>
          <Zap aria-hidden="true" size={21} className="text-slate-300" />
        </div>
      </header>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Live index prices">
        {symbols.map(item => {
          const tick = marketData?.[item];
          const hasPoints = tick != null && Number.isFinite(tick.change);
          const hasPercent = tick != null && Number.isFinite(tick.changePercent);
          const up = tick != null && tick.change >= 0;
          return (
            <button key={item} type="button" onClick={() => setSelectedSymbol(item)}
              className={`qep-market-card relative min-w-0 overflow-hidden rounded-xl border p-4 text-left transition-colors sm:p-5 ${
                selectedSymbol === item ? 'border-emerald-500/50' : 'border-slate-700/70 hover:border-slate-500'
              }`}>
              <div className="flex items-center justify-between gap-2">
                <b className="text-base font-bold text-slate-200">{label(item)}</b>
                <span className={`h-2 w-2 rounded-full ${tick?.status === 'LIVE' ? 'bg-emerald-400' : 'bg-slate-600'}`} />
              </div>
              <div className="mt-1 text-3xl font-extrabold tabular-nums text-white">{number(tick?.price)}</div>
              <div className={`mt-1 inline-flex flex-wrap items-center gap-x-1.5 text-base font-bold ${
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
        <div className="qep-market-card min-w-0 rounded-xl border p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <b className="text-base font-bold text-slate-200">INDIA VIX</b>
            <Activity size={19} className="text-cyan-300" />
          </div>
          <div className="mt-1 text-3xl font-extrabold tabular-nums text-white">{number(vix?.value)}</div>
          <div className={`mt-1 text-base font-bold ${vix?.changePercent == null ? 'text-slate-400' : vix.changePercent >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
            {vix?.changePercent == null ? 'No VIX data available' : `${vix.changePercent >= 0 ? '+' : ''}${vix.changePercent.toFixed(2)}%`}
          </div>
        </div>
      </div>
      <div id="qep-trade" className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(290px,1fr)]">
        <section className="qep-trade-panel min-w-0 rounded-2xl border p-5 sm:p-6"
          aria-label="QuantEdge Pro trade setup">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className={`rounded-xl px-5 py-2.5 text-xl font-extrabold ${
                tradeSide ? 'bg-emerald-500 text-emerald-950' : 'bg-slate-700 text-slate-200'
              }`}>{tradeSide ? `BUY ${tradeSide}` : 'WAIT'}</span>
              <h3 className="truncate text-2xl font-extrabold text-white sm:text-3xl">
                {contract?.trading_symbol ?? `${label(symbol)} · No qualified contract`}
              </h3>
            </div>
            <span className="rounded-lg border border-emerald-500/40 bg-emerald-950/50 px-3 py-2 text-base font-semibold text-emerald-200">
              {rulePercent == null ? 'Rule checks unavailable' : `${passedRules}/${ruleEntries.length} Rules Passed`}
            </span>
          </div>
          <p className="mt-2 text-base text-slate-300">
            {activeTrade ? `Broker position · ${activeTrade.state.replaceAll('_', ' ')}` :
              signal?.reason ?? 'Waiting for completed candles and live option data.'}
          </p>
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
          <button type="button" disabled={!live?.ready || statusStale || busy || (!live.enabled && (!live.armed || !!activeTrade))}
            onClick={toggleApproval}
            className={`mt-4 flex min-h-16 w-full items-center justify-center gap-3 rounded-xl border px-4 py-3 text-xl font-extrabold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:text-2xl ${
              live?.enabled ? 'border-rose-500/70 bg-rose-700/80 hover:bg-rose-600' : 'border-emerald-400/70 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500'
            }`}>
            <span aria-hidden="true">{live?.enabled ? '■' : '▷'}</span>
            {live?.enabled ? 'Stop New Entries' : 'Start Live Trade'}
          </button>
          <p className="mt-2 text-center text-sm text-slate-400">
            {live?.enabled ? 'New automatic entries are enabled; existing risk controls remain active.' :
              startDisabledReason ?? 'Enables automatic entries after broker preflight and session approval; does not place an immediate order.'}
          </p>
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
          </div>
          {live && !live.armed && !live.enabled && <p className="mt-2 text-xs text-amber-200/80">
            Complete the existing broker preflight and session arm before starting live entries.
          </p>}
          {(error || live?.error) && <p role="alert" className="mt-3 text-sm text-rose-300">{error ?? live?.error}</p>}
        </section>
        <aside id="qep-position" className="qep-status-panel rounded-2xl border p-5 sm:p-6" aria-label="QuantEdge Pro trade status">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-2xl font-extrabold text-white">Trade Status</h3>
            <span className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${
              live?.enabled ? 'border-emerald-500/50 text-emerald-300' : live?.ready && live.armed ? 'border-cyan-500/40 text-cyan-200' : 'border-slate-600 text-slate-300'
            }`}>{tradeStatus}</span>
          </div>
          <div className="mx-auto my-5 grid h-44 w-44 place-items-center rounded-full p-3"
            style={{ background: rulePercent == null ? '#1e293b' : `conic-gradient(#10b981 ${rulePercent * 3.6}deg, #1e293b 0deg)` }}>
            <div className="grid h-full w-full place-items-center rounded-full bg-slate-900 text-center">
              <div>
                <b className="text-3xl text-white">{rulePercent == null ? '—' : `${rulePercent}%`}</b>
                <p className="text-xs text-slate-300">Rule Checks</p>
              </div>
            </div>
          </div>
          <p id="qep-analytics" className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-400">
            {ruleSide ? `${ruleSide} Setup Rules` : 'Strategy Rules'}
          </p>
          <ul className="space-y-1">
            {Object.entries(ruleLabels).map(([key, title]) => {
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
