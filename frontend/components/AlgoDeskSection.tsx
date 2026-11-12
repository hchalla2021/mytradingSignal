'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { Activity, BarChart3, Check, ChevronDown, Clock3, ShieldCheck, TrendingUp, Zap } from 'lucide-react';
import { API_CONFIG } from '@/lib/api-config';
import { notifyAppAccessExpired } from '@/lib/app-access-events';
import { getOrCreateVisitorId } from '@/lib/visitor-id';
import { aqteErrorText, aqteObserveServerClock, aqtePollLoop, aqteServerNow } from '@/lib/aqte-display';
import type { MarketData } from '@/hooks/useMarketSocket';

const Chart = dynamic(() => import('@/components/AQTEChart'), {
  ssr: false, loading: () => <div className="aqte-terminal-card aqte-chart-loading">Loading price chart…</div>,
});

type SymbolName = 'NIFTY' | 'BANKNIFTY' | 'SENSEX';
type Side = 'CE' | 'PE';
type Rule = { id: string; label: string; passed: boolean | null; requirement: string; value: string | number | null };
type Signal = {
  key: string;
  status: string;
  decision: string;
  side: Side | null;
  passed: number;
  total: number;
  rules: Rule[];
  context: {
    regime?: string | null; volatile?: boolean; htf_30m?: string | null; structure_15m?: string | null;
    price_vs_vwap?: string | null; setup?: string | null;
  };
  levels: { underlying_risk?: number | null; underlying_stop?: number | null };
  reason: string;
};
type Performance = {
  trades: number; wins: number; losses: number; win_rate: number | null; net_pnl: number;
  profit_factor: number | null; max_drawdown: number | null; avg_win: number | null; avg_loss: number | null;
};
type EntryRule = { label: string; passed: boolean | null; value?: string | number | null };
type Summary = { status: string; decision: string; side: Side | null; passed: number; total: number; fresh: boolean };
type Algo = {
  key: string; name: string; subtitle: string; enabled: boolean; entries_today: number; remaining_today: number;
  today: Performance; week: Performance; summary: Record<SymbolName, Summary>;
};
type Trade = {
  id: string; algo: string; symbol: string; entry_price: number | null; exit_price: number | null; filled: number;
  net_pnl: number | null; entry_at: number; exit_at: number | null; exit_reason: string | null;
  exit_requested: string | null; stop: number | null; target: number | null; initial_stop: number | null;
  trading_symbol: string | null; side: Side | null;
  entry_context?: { strategy_name?: string | null; reason?: string | null; rules?: EntryRule[] } | null;
};
type Active = {
  id: string; algo: string; name: string; symbol: string; state: string; contract: { trading_symbol: string; side?: Side };
  entry_price: number; initial_stop?: number; limit: number; stop: number; target: number; filled: number; quantity: number;
  trailing_active?: boolean; exit_requested: string | null; ltp: number | null; unrealized: number | null; entry_at: number;
};
type Opportunity = { key: string; algo: string; symbol: string; decision: string | null; state: string; reason: string; at: number };
type DeskStatus = {
  generated_at: number; ready: boolean; live_enabled: boolean; armed: boolean; entry_window: boolean;
  killed: boolean; flatten_pending: boolean; any_enabled: boolean;
  lane_owner: 'AQTE' | 'QUANTEDGE' | 'EXPIRYEDGE' | null; reason: string | null; error: string | null; symbol: SymbolName;
  signals: Record<string, Signal>; signals_by_symbol: Record<SymbolName, Record<string, Signal>>;
  algos: Algo[]; active: Active | null; trades: Trade[]; opportunities: Opportunity[];
  account: { trades_today: number; net_pnl_today: number; expiryedge_pnl_today: number };
  limits: {
    per_algo_max_trades: number; max_trades: number; max_losses: number; daily_loss: number; risk_per_trade: number;
    max_lots: number; trail_start_r: number; target_r: number; entry_window: string;
  };
};

// Display-only fallback so the desk keeps its layout before the authenticated status arrives.
const CATALOG: Array<[string, string, string]> = [
  ['adaptive_vwap_pro', 'Adaptive VWAP Pro', 'Trend pullback to session VWAP'],
  ['order_flow_momentum', 'Order Flow Momentum', 'Depth imbalance with candle-volume pressure'],
  ['liquidity_sweep_bos', 'Liquidity Sweep + BOS', 'Stop run, then break of structure'],
  ['orb_retest', 'ORB Retest Pro', 'Opening-range breakout and retest'],
  ['failed_breakout_reversal', 'Failed Breakout Reversal', 'Trap reversal after a false break'],
  ['volatility_expansion', 'Volatility Expansion Pro', 'Bollinger squeeze release'],
];
const ENABLE_PHRASE = 'ENABLE ALGO DESK LIVE TRADING';
const STOP_PHRASE = 'STOP ALGO DESK ENTRIES';
const EXIT_PHRASE = 'CLOSE ALGO DESK TRADE';
const SYMBOLS: SymbolName[] = ['NIFTY', 'BANKNIFTY', 'SENSEX'];
const INDEX_LABEL: Record<string, string> = { NIFTY: 'NIFTY', BANKNIFTY: 'BANK NIFTY', SENSEX: 'SENSEX' };
const EMPTY_MARKET_DATA: MarketData = { NIFTY: null, BANKNIFTY: null, SENSEX: null };

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const optionalNumber = (value: unknown) => value === null || value === undefined || finite(value);

function isPerformance(value: unknown): value is Performance {
  return isRecord(value) && Number.isInteger(value.trades) && finite(value.net_pnl) &&
    ['win_rate', 'profit_factor', 'max_drawdown', 'avg_win', 'avg_loss'].every(key => optionalNumber(value[key]));
}

function isSignal(value: unknown): value is Signal {
  return isRecord(value) && typeof value.decision === 'string' && typeof value.status === 'string' &&
    (value.side === null || value.side === 'CE' || value.side === 'PE') &&
    Number.isInteger(value.passed) && Number.isInteger(value.total) && typeof value.reason === 'string' &&
    isRecord(value.context) && isRecord(value.levels) && Array.isArray(value.rules) &&
    value.rules.every(rule => isRecord(rule) && typeof rule.label === 'string' &&
      (rule.passed === null || typeof rule.passed === 'boolean'));
}

function isAlgo(value: unknown): value is Algo {
  return isRecord(value) && typeof value.key === 'string' && typeof value.name === 'string' &&
    typeof value.subtitle === 'string' && typeof value.enabled === 'boolean' &&
    Number.isInteger(value.entries_today) && isPerformance(value.today) && isPerformance(value.week) &&
    isRecord(value.summary);
}

function isActive(value: unknown): value is Active {
  return isRecord(value) && typeof value.id === 'string' && typeof value.symbol === 'string' &&
    typeof value.state === 'string' && isRecord(value.contract) && typeof value.contract.trading_symbol === 'string' &&
    finite(value.stop) && finite(value.target) && finite(value.limit) && finite(value.entry_price) &&
    Number.isInteger(value.filled) && optionalNumber(value.initial_stop) &&
    optionalNumber(value.ltp) && optionalNumber(value.unrealized);
}

function isSignalsBySymbol(value: unknown): value is Record<SymbolName, Record<string, Signal>> {
  return isRecord(value) && SYMBOLS.every(symbol => {
    const signals = value[symbol];
    return isRecord(signals) && Object.values(signals).every(isSignal);
  });
}

export function isDeskStatus(value: unknown): value is DeskStatus {
  if (!isRecord(value) || !finite(value.generated_at)) return false;
  const flags = ['ready', 'live_enabled', 'armed', 'entry_window', 'killed', 'flatten_pending', 'any_enabled'];
  return flags.every(flag => typeof value[flag] === 'boolean') &&
    (value.reason === null || typeof value.reason === 'string') &&
    (value.error === null || typeof value.error === 'string') &&
    (value.symbol === 'NIFTY' || value.symbol === 'BANKNIFTY' || value.symbol === 'SENSEX') &&
    isRecord(value.signals) && Object.values(value.signals).every(isSignal) &&
    isSignalsBySymbol(value.signals_by_symbol) &&
    Array.isArray(value.algos) && value.algos.length > 0 && value.algos.every(isAlgo) &&
    (value.active === null || isActive(value.active)) &&
    Array.isArray(value.trades) && value.trades.every(trade => isRecord(trade) && typeof trade.id === 'string' &&
      finite(trade.entry_at) && optionalNumber(trade.net_pnl)) &&
    Array.isArray(value.opportunities) && value.opportunities.every(item => isRecord(item) &&
      typeof item.state === 'string' && finite(item.at)) &&
    isRecord(value.account) && finite(value.account.trades_today) &&
    isRecord(value.limits) && finite(value.limits.risk_per_trade) && finite(value.limits.daily_loss) &&
    Number.isInteger(value.limits.per_algo_max_trades) && Number.isInteger(value.limits.max_trades);
}

async function request(path: string, body?: object, signal?: AbortSignal): Promise<unknown> {
  const sent = Date.now();
  const response = await fetch(API_CONFIG.endpoint(`/api/algo-desk/${path}`), {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Id': getOrCreateVisitorId(),
      'X-AQTE-Intent': 'manual-live-control',
    },
    credentials: 'include',
    cache: 'no-store',
    signal,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const received = Date.now();
  const payload: unknown = await response.json().catch(() => null);
  aqteObserveServerClock(response, payload, sent, received);
  if (!response.ok) {
    if (response.status === 401) notifyAppAccessExpired();
    const detail = isRecord(payload) ? payload.detail : null;
    throw new Error(typeof detail === 'string' ? detail : `6 Algo Desk request failed (${response.status})`);
  }
  return payload;
}

const RUPEE = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const PRICE = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CLOCK = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
const price = (value: number | null | undefined) => finite(value) && value > 0 ? PRICE.format(value) : '—';
const rupees = (value: number | null | undefined) => finite(value) ? `₹${RUPEE.format(Math.abs(value))}` : '—';
const signedRupees = (value: number | null | undefined) =>
  finite(value) ? `${value > 0 ? '+' : value < 0 ? '-' : ''}₹${RUPEE.format(Math.abs(value))}` : '—';
const signedPoints = (value: number | null) =>
  finite(value) ? `${value > 0 ? '+' : ''}${PRICE.format(value)}` : '—';
const signedPercent = (value: number | null) =>
  finite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(2)}%` : '—';
const tone = (value: number | null | undefined) =>
  !finite(value) || value === 0 ? 'text-slate-200' : value > 0 ? 'text-emerald-400' : 'text-rose-400';
const clock = (seconds: number | null | undefined) => finite(seconds) ? CLOCK.format(new Date(seconds * 1000)) : '—';
const words = (value: string | null | undefined) => value
  ? value.toLowerCase().replaceAll('_', ' ').replace(/^\w/, letter => letter.toUpperCase()) : '—';

function SignalBadge({ decision }: { decision: string | null | undefined }) {
  const style = decision === 'BUY CE' ? 'border-emerald-500/70 bg-emerald-600/20 text-emerald-300'
    : decision === 'BUY PE' ? 'border-rose-500/70 bg-rose-600/20 text-rose-300'
      : 'border-slate-600 bg-slate-800/60 text-slate-300';
  return <span className={`inline-flex min-w-[64px] justify-center rounded-md border px-2 py-0.5 text-xs font-extrabold ${style}`}>{decision || 'WAIT'}</span>;
}

function TradeDirection({ decision, side, active, activeSide }: {
  decision: string | null | undefined; side: Side | null | undefined; active: boolean; activeSide: Side | null;
}) {
  const signalSide = decision === 'BUY CE' ? 'CE' : decision === 'BUY PE' ? 'PE' : null;
  const toneSide = active ? activeSide : signalSide;
  const text = active
    ? activeSide ? `POSITION OPEN · BUY ${activeSide === 'CE' ? 'CALL (CE)' : 'PUT (PE)'}` : 'POSITION OPEN · OPTION SIDE UNAVAILABLE'
    : signalSide ? `ENTRY QUALIFIED · BUY ${signalSide === 'CE' ? 'CALL (CE)' : 'PUT (PE)'}`
      : side ? `WAIT · ${side === 'CE' ? 'CALL (CE)' : 'PUT (PE)'} SETUP · NOT QUALIFIED`
        : 'WAIT · NO QUALIFIED ENTRY';
  const tone = toneSide === 'CE' ? 'border-emerald-500 bg-emerald-950 text-emerald-100'
    : toneSide === 'PE' ? 'border-cyan-500 bg-cyan-950 text-cyan-100'
      : 'border-amber-500 bg-amber-950 text-amber-100';
  return (
    <span role="status" aria-live="polite"
      className={`inline-flex max-w-full items-center rounded-lg border px-3 py-1.5 text-xs font-black leading-tight sm:text-sm ${tone}`}>
      {text}
    </span>
  );
}

function Card({ title, icon, aside, children, className = '' }: {
  title: string; icon: ReactNode; aside?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <article className={`rounded-xl border border-slate-700/80 bg-[#071420] ${className}`}>
      <h4 className="flex min-h-11 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-800 px-3 py-2 text-sm font-extrabold text-slate-100">
        <span aria-hidden="true" className="text-cyan-400">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {aside && <span className="ml-auto max-w-full min-w-0 text-right">{aside}</span>}
      </h4>
      {children}
    </article>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3 text-[13px]">
      <dt className="text-slate-400">{label}</dt>
      <dd className="min-w-0 max-w-[65%] break-words text-right font-semibold tabular-nums text-slate-100">{children}</dd>
    </div>
  );
}

type TableRow = {
  id: string; at: number; symbol: string; signal: string | null; entry: number | null; stop: number | null;
  target: number | null; status: string; statusTone: string; pnl: number | null;
};

function tradeStatus(trade: Trade): [string, string] {
  if (trade.exit_requested === 'MANUAL_EXIT') return ['Manual exit', 'border-sky-600 bg-sky-950 text-sky-200'];
  if (trade.exit_reason === 'EMERGENCY_STOP' || trade.exit_requested === 'EMERGENCY_STOP') {
    return ['Emergency', 'border-rose-600 bg-rose-950 text-rose-200'];
  }
  if (finite(trade.exit_price) && finite(trade.target) && trade.exit_price >= trade.target) {
    return ['Target', 'border-emerald-600 bg-emerald-950 text-emerald-200'];
  }
  if (finite(trade.exit_price) && finite(trade.initial_stop) && trade.exit_price <= trade.initial_stop) {
    return ['SL Hit', 'border-rose-600 bg-rose-950 text-rose-200'];
  }
  return ['Closed', 'border-emerald-700 bg-emerald-950/60 text-emerald-200'];
}

const OPPORTUNITY_TONE: Record<string, string> = {
  ACCEPTED: 'border-cyan-600 bg-cyan-950 text-cyan-200',
  REJECTED: 'border-amber-600 bg-amber-950 text-amber-200',
  MISSED: 'border-amber-700 bg-amber-950/60 text-amber-200',
  EXPIRED: 'border-slate-600 bg-slate-800 text-slate-300',
};

export default function AlgoDeskSection({ marketData = EMPTY_MARKET_DATA }: {
  marketData?: MarketData; isConnected?: boolean;
}) {
  const [symbol, setSymbol] = useState<SymbolName>('NIFTY');
  const [algoSymbols, setAlgoSymbols] = useState<Partial<Record<string, SymbolName>>>({});
  const [status, setStatus] = useState<DeskStatus | null>(null);
  const [stale, setStale] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(CATALOG[0][0]);
  const [chartExpanded, setChartExpanded] = useState(false);
  const commandAt = useRef(0);
  const viewed = useRef(symbol);
  viewed.current = symbol;

  const chooseSymbol = (next: SymbolName) => {
    viewed.current = next;
    setSymbol(next);
  };
  const chooseAlgoSymbol = (key: string, next: SymbolName) => {
    setAlgoSymbols(current => current[key] === next ? current : { ...current, [key]: next });
  };

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const stop = aqtePollLoop(async () => {
      const started = Date.now();
      try {
        const value = await request(`status?symbol=${symbol}`, undefined, controller.signal);
        if (!isDeskStatus(value)) throw new Error('Invalid 6 Algo Desk status response');
        const age = aqteServerNow() - value.generated_at;
        if (age < -1 || age > 10) throw new Error('6 Algo Desk status is stale');
        // A poll that began before an ON/OFF/exit command must not overwrite that command's newer result.
        if (!active || started < commandAt.current) return;
        setStatus(value);
        setStale(false);
        setError(null);
      } catch (cause) {
        if (!active || controller.signal.aborted) return;
        setStale(true);
        setError(aqteErrorText(cause, '6 Algo Desk status unavailable'));
      }
    });
    return () => {
      active = false;
      controller.abort();
      stop();
    };
  }, [symbol]);

  const act = async (path: 'approval' | 'exit', body: object) => {
    setBusy(true);
    setError(null);
    commandAt.current = Date.now();
    try {
      const value = await request(path, body);
      if (!isDeskStatus(value)) throw new Error('Invalid 6 Algo Desk response');
      commandAt.current = Date.now();
      setStatus(value);
      setStale(false);
    } catch (cause) {
      setError(aqteErrorText(cause, '6 Algo Desk command failed'));
    } finally {
      setBusy(false);
    }
  };

  const fallback = CATALOG.find(([key]) => key === selected) ?? CATALOG[0];
  const algo = status?.algos.find(item => item.key === selected) ?? null;
  const name = algo?.name ?? fallback[1];
  const enabled = algo?.enabled ?? false;
  const signal = status && status.symbol === symbol ? status.signals[selected] : undefined;
  const limits = status?.limits;
  const active = status?.active ?? null;
  const owned = active && active.algo === selected ? active : null;

  const onBlocked = busy ? 'A request is still in progress'
    : !status || stale ? 'Waiting for a fresh 6 Algo Desk status from the server'
      : !status.ready ? 'Live journal unavailable on the server'
        : !status.live_enabled ? 'Live trading is switched off on the server (AQTE_LIVE_ENABLED)'
          : status.killed || status.flatten_pending ? 'Emergency stop is latched; reset it in AQTE first'
            : null;
  const offBlocked = busy ? 'A request is still in progress' : !status ? 'Waiting for 6 Algo Desk status' : null;

  const setTrade = (next: boolean) => {
    if (!algo || next === enabled || (next ? onBlocked : offBlocked)) return;
    void act('approval', { algo: algo.key, enabled: next, confirmation: next ? ENABLE_PHRASE : STOP_PHRASE });
  };

  const setAlgoTrade = (item: Algo | undefined, next: boolean, targetSymbol: SymbolName) => {
    if (!item || next === item.enabled || (next ? onBlocked : offBlocked)) return;
    void act('approval', { algo: item.key, enabled: next, symbol: targetSymbol,
      confirmation: next ? ENABLE_PHRASE : STOP_PHRASE });
  };

  const exitAlgoTrade = (trade: Active | null) => {
    if (!trade || busy || trade.exit_requested) return;
    if (!window.confirm(`Close only the ${trade.name} trade in ${trade.contract.trading_symbol}? ${trade.name} switches to Manual.`)) return;
    void act('exit', { trade_id: trade.id, symbol: trade.symbol, confirmation: EXIT_PHRASE });
  };

  const exitTrade = () => exitAlgoTrade(owned);

  const rows: TableRow[] = [];
  if (owned) {
    rows.push({
      id: owned.id, at: owned.entry_at, symbol: owned.symbol, signal: owned.contract.side ? `BUY ${owned.contract.side}` : null,
      entry: owned.entry_price || owned.limit, stop: owned.stop, target: owned.target,
      status: owned.exit_requested ? 'Exiting' : owned.filled ? 'Open' : words(owned.state),
      statusTone: 'border-sky-600 bg-sky-950 text-sky-200', pnl: owned.unrealized,
    });
  }
  for (const trade of status?.trades ?? []) {
    if (trade.algo !== selected) continue;
    const [label, style] = tradeStatus(trade);
    rows.push({
      id: trade.id, at: trade.entry_at, symbol: trade.symbol, signal: trade.side ? `BUY ${trade.side}` : null,
      entry: trade.entry_price, stop: trade.initial_stop ?? trade.stop, target: trade.target,
      status: label, statusTone: style, pnl: trade.net_pnl,
    });
  }
  for (const item of status?.opportunities ?? []) {
    if (item.algo !== selected || item.state === 'ACCEPTED') continue;
    rows.push({
      id: item.key, at: item.at, symbol: item.symbol, signal: item.decision, entry: null, stop: null, target: null,
      status: words(item.state), statusTone: OPPORTUNITY_TONE[item.state] ?? OPPORTUNITY_TONE.EXPIRED, pnl: null,
    });
  }
  rows.sort((left, right) => right.at - left.at);

  const today = algo?.today;
  const week = algo?.week;
  const modeLabel = !algo ? 'Loading' : !enabled ? 'Manual'
    : status?.armed && status.entry_window ? 'Active' : 'ON · waiting';
  const modeTone = !enabled ? 'text-slate-300' : modeLabel === 'Active' ? 'text-emerald-400' : 'text-amber-300';
  const line = error ?? (status?.error && !status.any_enabled ? `Switched OFF: ${status.error}` : status?.reason) ?? 'Connecting to the 6 Algo Desk…';
  const conditionsTitle = signal?.side ? `Entry Conditions (BUY ${signal.side})` : 'Entry Conditions';
  const choices = status?.algos.map(item => [item.key, item.name] as const) ?? CATALOG.map(([key, label]) => [key, label] as const);
  const latestTradeByAlgo = new Map<string, Trade>();
  for (const trade of status?.trades ?? []) {
    const tradeKey = `${trade.algo}:${trade.symbol}`;
    const previous = latestTradeByAlgo.get(tradeKey);
    if (!previous || trade.entry_at > previous.entry_at) latestTradeByAlgo.set(tradeKey, trade);
  }
  const tick = marketData[symbol];
  const change = tick && finite(tick.change) && finite(tick.changePercent) ? tick : null;
  const changeText = change
    ? `${change.change > 0 ? '+' : ''}${PRICE.format(change.change)} (${change.changePercent > 0 ? '+' : ''}${change.changePercent.toFixed(2)}%)`
    : 'Change —';

  return (
    <section aria-label="6 Algo Desk" className="overflow-hidden rounded-2xl border border-[#245646] bg-[linear-gradient(150deg,#071a19_0%,#09131c_58%,#07111a_100%)] text-slate-100 shadow-[0_16px_40px_rgba(0,0,0,.32),inset_0_1px_rgba(148,190,170,.05)]">
      <header className="flex items-center gap-3 border-b border-slate-700/80 bg-[#030b12] px-4 py-3 sm:px-5">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-emerald-400/40 bg-emerald-950/50 text-emerald-300">
          <BarChart3 aria-hidden="true" className="h-6 w-6" />
        </span>
      </header>
      <div className="grid min-w-0 grid-cols-1 gap-2 p-3 sm:p-4">
        {choices.map(([key, label], index) => {
          const item = status?.algos.find(entry => entry.key === key);
          const cardSymbol = algoSymbols[key] ?? 'NIFTY';
          const cardSignal = status?.signals_by_symbol[cardSymbol]?.[key];
          const live = item?.summary[cardSymbol];
          const cardEnabled = item?.enabled ?? false;
          const cardActive = status?.active?.algo === key && status.active.symbol === cardSymbol ? status.active : null;
          const cardTrade = latestTradeByAlgo.get(`${key}:${cardSymbol}`);
          const cardTick = marketData[cardSymbol];
          const cardChange = cardTick && finite(cardTick.change) && finite(cardTick.changePercent) ? cardTick : null;
          const cardChangeText = cardChange
            ? `${cardChange.change > 0 ? '+' : ''}${PRICE.format(cardChange.change)} (${cardChange.changePercent > 0 ? '+' : ''}${cardChange.changePercent.toFixed(2)}%)`
            : 'Change —';
          const activeFilled = Boolean(cardActive && cardActive.filled > 0 && cardActive.entry_price > 0);
          const entry = cardActive ? activeFilled ? cardActive.entry_price : cardActive.limit : cardTrade?.entry_price;
          const initialStop = cardActive ? cardActive.initial_stop ?? cardActive.stop
            : cardTrade?.initial_stop ?? cardTrade?.stop;
          const target = cardActive ? cardActive.target : cardTrade?.target;
          const tradePnl = cardActive ? cardActive.unrealized : cardTrade?.net_pnl ?? null;
          const pnlMark = cardActive ? cardActive.ltp : cardTrade?.exit_price ?? null;
          const pnlEntry = cardActive?.entry_price ?? cardTrade?.entry_price ?? null;
          const premiumPoints = finite(pnlMark) && finite(pnlEntry) ? pnlMark - pnlEntry : null;
          const premiumPercent = premiumPoints !== null && finite(pnlEntry) && pnlEntry > 0
            ? premiumPoints / pnlEntry * 100 : null;
          const cardDecision = cardSignal?.decision ?? live?.decision;
          const actionable = cardDecision === 'BUY CE' || cardDecision === 'BUY PE';
          const activeSide = cardActive?.contract.side ??
            (cardActive?.contract.trading_symbol.endsWith('CE') ? 'CE'
              : cardActive?.contract.trading_symbol.endsWith('PE') ? 'PE' : null);
          const rulePercent = cardSignal && cardSignal.total > 0
            ? Math.round(cardSignal.passed / cardSignal.total * 100) : null;
          const waitingRules = cardSignal?.rules.filter(rule => rule.passed !== true).map(rule => rule.label) ?? [];
          const autoScanning = cardEnabled && status?.armed && status.entry_window;
          const entryExplanation = cardDecision === 'WAIT' && cardSignal?.side
            ? `Waiting: ${cardSignal.side === 'CE' ? 'CALL (CE)' : 'PUT (PE)'} setup is not qualified` +
              `${waitingRules.length ? `; still needs ${waitingRules.join(', ')} (${cardSignal.reason})` : `; ${cardSignal.reason}`}. ` +
              `${autoScanning ? `Auto-scanning will buy ${cardSignal.side === 'CE' ? 'CALL (CE)' : 'PUT (PE)'} only after all ${cardSignal.total} checks and live execution gates pass`
                : cardEnabled ? 'Auto approval is ON but waiting for the session or broker preflight'
                  : 'Auto trade is OFF; no order will be sent'}. No order has been placed.`
            : cardSignal?.reason ?? status?.reason ?? 'Waiting for fresh market data.';
          const cardMode = !item ? 'LOADING'
            : cardEnabled ? status?.armed && status.entry_window ? 'AUTO · SCANNING' : 'ON · WAITING' : 'MANUAL';
          const trailingLabel = cardActive
            ? cardActive.trailing_active ? price(cardActive.stop)
              : `Waiting · +${limits?.trail_start_r ?? 1}R`
            : cardTrade ? 'Closed' : `Starts at +${limits?.trail_start_r ?? 1}R`;
          const trailingDetail = cardActive?.trailing_active ? 'Current trailing stop'
            : cardActive ? 'Initial stop remains active' : cardTrade ? 'No open trailing stop' : 'After entry moves in profit';
          return (
            <article key={key} className={`min-w-0 overflow-hidden rounded-2xl border bg-[#09151f] transition-colors ${
              selected === key ? 'border-emerald-500/70 shadow-[0_0_24px_rgba(16,185,129,.08)]' : 'border-slate-700/80 hover:border-slate-500'}`}>
              <header className="flex flex-wrap items-center gap-3 border-b border-slate-700/80 bg-[#030b12] px-4 py-3 sm:px-5">
                <button type="button" onClick={() => setSelected(key)} aria-pressed={selected === key}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-emerald-500/40 bg-emerald-950/50 text-sm font-black text-emerald-200">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-base font-extrabold text-white">{item?.name ?? label}</span>
                    <span className="block truncate text-xs text-slate-400">{item?.subtitle ?? CATALOG[index]?.[2]}</span>
                  </span>
                </button>
                <div role="tablist" aria-label={`${label} index`} className="flex shrink-0 rounded-lg border border-slate-700 bg-[#050d15] p-1">
                  {SYMBOLS.map(item => (
                    <button key={item} type="button" role="tab" aria-selected={cardSymbol === item}
                      onClick={() => chooseAlgoSymbol(key, item)}
                      className={`min-h-8 rounded-md px-2 text-[10px] font-extrabold sm:px-2.5 sm:text-xs ${cardSymbol === item
                        ? 'border border-emerald-500 bg-emerald-700/40 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                      {INDEX_LABEL[item]}
                    </button>
                  ))}
                </div>
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                  <button type="button" role="switch" aria-label={`${label} trade approval`} aria-checked={cardEnabled}
                    onClick={() => setAlgoTrade(item, !cardEnabled, cardSymbol)}
                    disabled={!item || Boolean(cardEnabled ? offBlocked : onBlocked)}
                    title={(cardEnabled ? offBlocked : onBlocked) ?? 'Trade approval applies to this strategy across all indices'}
                    className={`inline-flex min-h-10 w-28 shrink-0 items-center justify-center gap-2 rounded-full border px-2 text-xs font-extrabold disabled:cursor-not-allowed disabled:opacity-60 ${
                      cardEnabled ? 'border-emerald-500 bg-emerald-950 text-emerald-200' : 'border-slate-600 bg-slate-900 text-slate-300'}`}>
                    TRADE <span className={`rounded-full px-2 py-0.5 text-[11px] font-black text-white ${cardEnabled ? 'bg-emerald-700' : 'bg-slate-600'}`}>
                      {cardEnabled ? 'ON' : 'OFF'}
                    </span>
                  </button>
                  <div role="group" aria-label={`${label} execution mode`} className="flex shrink-0 rounded-lg border border-slate-700 bg-[#050d15] p-1">
                    <button type="button" aria-pressed={cardEnabled} onClick={() => setAlgoTrade(item, true, cardSymbol)}
                      disabled={!item || (!cardEnabled && Boolean(onBlocked))}
                      className={`min-h-9 w-20 rounded-md px-1 text-xs font-extrabold disabled:cursor-not-allowed disabled:opacity-50 ${
                        cardEnabled ? 'border border-emerald-500 bg-emerald-700/40 text-white' : 'text-cyan-100'}`}>
                      Live (Auto)
                    </button>
                    <button type="button" aria-pressed={!cardEnabled} onClick={() => setAlgoTrade(item, false, cardSymbol)}
                      disabled={!item || (cardEnabled && Boolean(offBlocked))}
                      className={`min-h-9 w-16 rounded-md px-1 text-xs font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-50 ${
                        !cardEnabled ? 'border border-slate-500 bg-slate-700/60' : ''}`}>
                      Manual
                    </button>
                  </div>
                  <span className={`flex h-9 min-w-28 items-center justify-center whitespace-nowrap rounded-full border px-3 text-xs font-bold ${
                    cardMode === 'AUTO · SCANNING' ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                      : cardMode === 'ON · WAITING' ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200'
                        : 'border-slate-600 bg-slate-800/70 text-slate-300'}`}>
                    <span className="mr-1.5 text-emerald-400">●</span>{cardMode}
                  </span>
                </div>
              </header>

              <div className="grid min-w-0 grid-cols-1 gap-3 p-3 sm:p-4 xl:grid-cols-[minmax(0,3fr)_minmax(280px,1fr)]">
                <section className="qep-trade-panel min-w-0 rounded-2xl border border-emerald-700/60 bg-[linear-gradient(145deg,#08251d,#0a1a22_75%,#08141c)] p-4 sm:p-5"
                  aria-label={`${label} trade setup`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
                      <TradeDirection decision={cardDecision} side={cardSignal?.side ?? live?.side}
                        active={cardActive !== null} activeSide={activeSide} />
                      {(cardActive || actionable || cardTrade?.trading_symbol) && (
                        <h3 className="min-w-0 truncate text-base font-extrabold text-white sm:text-lg">
                          {cardActive?.contract.trading_symbol
                            ?? (actionable ? `${INDEX_LABEL[cardSymbol]} · Entry qualified`
                              : `Last trade · ${cardTrade?.trading_symbol}`)}
                        </h3>
                      )}
                    </div>
                    <span aria-label="Current setup rule results" className="rounded-lg border border-emerald-500/40 bg-emerald-950/50 px-3 py-1.5 text-xs font-bold text-emerald-200">
                      ENTRY CHECKS ·{' '}
                      {cardSignal ? `${cardSignal.passed} / ${cardSignal.total} PASSED` : 'UNAVAILABLE'}
                    </span>
                  </div>
                  <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-slate-300">
                    <span>{entryExplanation}</span>
                    <span className="font-bold tabular-nums text-slate-100">{INDEX_LABEL[cardSymbol]} {price(cardTick?.price)}</span>
                    <span className={`text-xs font-bold ${tone(cardChange?.change)}`}>{cardChangeText}</span>
                  </p>
                  <div className="mt-4 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5"
                    aria-label="Trade prices and profit">
                    {([
                      {
                        title: cardActive ? activeFilled ? 'ENTRY PRICE' : 'ENTRY LIMIT' : cardTrade ? 'LAST ENTRY PRICE' : 'ENTRY PRICE',
                        value: price(entry), detail: activeFilled ? `${cardActive?.filled} units filled`
                          : cardActive ? 'Awaiting fill' : cardTrade ? 'Closed trade' : 'Awaiting entry',
                        color: 'emerald', icon: <TrendingUp size={16} />,
                      },
                      {
                        title: cardTrade && !cardActive ? 'LAST STOP LOSS' : 'STOP LOSS', value: price(initialStop),
                        detail: cardActive?.trailing_active ? 'Initial risk level' : 'Initial protective stop',
                        color: 'rose', icon: <ShieldCheck size={16} />,
                      },
                      {
                        title: 'TRAILING STOP', value: trailingLabel, detail: trailingDetail,
                        color: 'amber', icon: <Activity size={16} />,
                      },
                      {
                        title: 'TARGET PRICE', value: price(target), detail: 'Planned exit level',
                        color: 'emerald', icon: <BarChart3 size={16} />,
                      },
                      {
                        title: cardActive ? 'OPEN P&L' : cardTrade ? 'LAST CLOSED P&L' : 'TRADE P&L',
                        value: signedRupees(tradePnl),
                        detail: `${signedPoints(premiumPoints)} premium pts · ${signedPercent(premiumPercent)} from entry`,
                        caption: cardActive ? `LTP ${price(cardActive.ltp)}` : cardTrade ? `Exit ${price(cardTrade.exit_price)}` : 'No filled trade',
                        color: finite(tradePnl) && tradePnl > 0 ? 'emerald'
                          : finite(tradePnl) && tradePnl < 0 ? 'rose' : 'slate',
                        icon: <BarChart3 size={16} />,
                      },
                    ] as const).map(level => (
                      <div key={level.title} className={`min-w-0 rounded-xl border p-3 sm:p-4 ${
                        level.color === 'rose' ? 'border-rose-500/50 bg-rose-950/35'
                          : level.color === 'amber' ? 'border-amber-500/40 bg-amber-950/25'
                            : level.color === 'slate' ? 'border-slate-600/70 bg-slate-900/60'
                              : 'border-emerald-500/50 bg-emerald-950/30'}`}>
                        <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-300 sm:text-xs">
                          <span className="shrink-0">{level.icon}</span>{level.title}
                        </div>
                        <div className={`mt-2 break-words text-base font-extrabold tabular-nums sm:text-lg ${
                          level.color === 'rose' ? 'text-rose-400' : level.color === 'amber' ? 'text-amber-300'
                            : level.color === 'slate' ? 'text-slate-200' : 'text-white'}`}>
                          {level.value}
                        </div>
                        <p className="mt-1 break-words text-[10px] leading-snug text-slate-400">{level.detail}</p>
                        {'caption' in level && <p className="mt-1 break-words text-[10px] leading-snug text-slate-400">{level.caption}</p>}
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 border-b border-slate-700/70 pb-4 text-center sm:grid-cols-3">
                    <div><p className="text-xs text-slate-400">Target Plan</p><b className="text-base text-white">{limits ? `${limits.target_r}R` : '—'}</b></div>
                    <div><p className="text-xs text-slate-400">Quantity</p><b className="text-base text-white">{cardActive ? cardActive.filled || cardActive.quantity : cardTrade?.filled || '—'}</b></div>
                    <div><p className="text-xs text-slate-400">Risk cap / trade</p><b className="text-base text-rose-300">{limits ? rupees(limits.risk_per_trade) : '—'}</b></div>
                  </div>
                  <p className="mt-2 text-xs text-amber-200/90">
                    Risk cap is a plan, not a guaranteed maximum; gaps and slippage can increase losses.
                  </p>
                  <p className="mt-2 text-xs text-slate-400">
                    Today&apos;s realized P&amp;L resets by IST date. Week P&amp;L and last closed trade retain earlier results as history.
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {([
                      ['Trades today', item ? `${item.today.trades} / ${limits?.per_algo_max_trades ?? '—'}` : '—'],
                      ['Win rate', finite(item?.today.win_rate) ? `${item.today.win_rate.toFixed(1)}%` : '—'],
                    ['Today P&L (IST)', item ? signedRupees(item.today.net_pnl) : '—'],
                    ['This week P&L', item ? signedRupees(item.week.net_pnl) : '—'],
                    ] as const).map(([title, value]) => (
                      <div key={title} className="min-w-0 rounded-lg border border-slate-700/60 bg-slate-950/35 px-2.5 py-2">
                        <span className="block truncate text-[11px] text-slate-400">{title}</span>
                        <span className="mt-1 block truncate text-sm font-bold tabular-nums text-slate-100">{value}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-700/70 bg-slate-950/35 p-3">
                    <div className="min-w-0">
                      <b className="block truncate text-sm text-slate-200">
                        {cardActive ? `Active position · ${cardActive.contract.trading_symbol}`
                          : cardTrade ? `Last trade · ${INDEX_LABEL[cardTrade.symbol] ?? cardTrade.symbol} · ${tradeStatus(cardTrade)[0]}`
                            : 'No trade recorded for this strategy'}
                      </b>
                      {cardActive && <span className="text-xs text-slate-400">{cardActive.filled}/{cardActive.quantity} filled · Entry {price(cardActive.entry_price)}</span>}
                      {!cardActive && cardTrade && (
                        <span className="text-xs text-slate-400">
                          Filled {cardTrade.filled} · Entry {price(cardTrade.entry_price)} · Exit {price(cardTrade.exit_price)}
                        </span>
                      )}
                    </div>
                    {cardActive && (
                      <button type="button" onClick={() => exitAlgoTrade(cardActive)} disabled={busy || Boolean(cardActive.exit_requested)}
                        className="min-h-9 rounded-lg border border-rose-500/50 px-3 text-xs font-bold text-rose-200 disabled:cursor-not-allowed disabled:opacity-50">
                        {cardActive.exit_requested ? 'Exit requested' : 'Exit this trade'}
                      </button>
                    )}
                  </div>
                  {!cardActive && cardTrade && (
                    <details className="mt-3 rounded-lg border border-slate-700/70 bg-slate-950/35 p-3">
                      <summary className="cursor-pointer text-xs font-bold text-cyan-200">Entry-time signal checks</summary>
                      {cardTrade.entry_context?.rules?.length ? (
                        <div className="mt-2">
                          <p className="text-xs text-slate-300">
                            {cardTrade.entry_context.strategy_name ?? 'Last trade'} ·{' '}
                            {cardTrade.entry_context.rules.filter(rule => rule.passed === true).length}/
                            {cardTrade.entry_context.rules.length} rules passed at entry
                          </p>
                          <ul className="mt-2 space-y-1">
                            {cardTrade.entry_context.rules.map((rule, ruleIndex) => (
                              <li key={`${rule.label}-${ruleIndex}`} className="flex flex-wrap justify-between gap-x-3 text-xs">
                                <span className="text-slate-300">{rule.label}</span>
                                <span className={rule.passed === true ? 'text-emerald-300' : rule.passed === false ? 'text-rose-300' : 'text-amber-300'}>
                                  {rule.passed === true ? 'PASS' : rule.passed === false ? 'FAIL' : 'WAIT'}
                                  {rule.value == null ? '' : ` · ${rule.value}`}
                                </span>
                              </li>
                            ))}
                          </ul>
                          {cardTrade.entry_context.reason && (
                            <p className="mt-2 text-xs text-slate-400">{cardTrade.entry_context.reason}</p>
                          )}
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-slate-400">Entry-time rule details were not saved for this trade.</p>
                      )}
                    </details>
                  )}
                </section>

                <aside className="min-w-0 rounded-2xl border border-slate-700/80 bg-[#101b29] p-4 sm:p-5" aria-label={`${label} trade status`}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-lg font-extrabold text-white">Trade Status</h3>
                    <span className={`rounded-lg border px-2.5 py-1 text-[10px] font-bold ${
                      cardEnabled ? 'border-emerald-500/50 text-emerald-300' : 'border-slate-600 text-slate-300'}`}>
                      {cardMode}
                    </span>
                  </div>
                  <div className="mx-auto my-4 grid h-28 w-28 place-items-center rounded-full p-2"
                    style={{ background: rulePercent == null ? '#1e293b' : `conic-gradient(#10b981 ${rulePercent * 3.6}deg, #1e293b 0deg)` }}>
                    <div className="grid h-full w-full place-items-center rounded-full bg-slate-900 text-center">
                      <div>
                        <b className="text-2xl text-white">{cardSignal ? `${cardSignal.passed}/${cardSignal.total}` : '—'}</b>
                        <p className="text-[11px] text-slate-300">Checks passed · not probability</p>
                      </div>
                    </div>
                  </div>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                    {cardSignal?.decision === 'BUY CE' || cardSignal?.decision === 'BUY PE'
                      ? `${cardSignal.side === 'CE' ? 'CALL (CE)' : 'PUT (PE)'} entry checks` : cardSignal?.side
                        ? `${cardSignal.side === 'CE' ? 'CALL (CE)' : 'PUT (PE)'} setup checks` : 'Strategy Rules'}
                  </p>
                  <ul className="space-y-0.5">
                    {(cardSignal?.rules ?? []).map(rule => (
                      <li key={rule.id || rule.label} title={rule.requirement}
                        className="flex min-w-0 items-start gap-2 border-b border-slate-700/50 py-2 text-xs last:border-0">
                        <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] ${
                          rule.passed === true ? 'bg-emerald-600 text-white'
                            : rule.passed === false ? 'bg-rose-950 text-rose-300' : 'bg-slate-700 text-slate-300'}`}>
                          {rule.passed === true ? <Check size={12} /> : rule.passed === false ? '×' : '·'}
                        </span>
                        <span className="min-w-0">
                          <span className={`block ${rule.passed === false ? 'text-slate-400' : 'text-slate-200'}`}>{rule.label}</span>
                          <span className="block text-[11px] leading-snug text-slate-500">{rule.requirement}</span>
                        </span>
                      </li>
                    ))}
                    {!cardSignal?.rules.length && <li className="py-2 text-xs text-slate-400">Strategy rules load with the next status update.</li>}
                  </ul>
                </aside>
              </div>
            </article>
          );
        })}
      </div>

      <details hidden className="group mx-3 mb-3 rounded-xl border border-slate-700/80 bg-[#071420] sm:mx-4 sm:mb-4">
        <summary aria-label={`Toggle detailed analytics for ${name}`}
          className="flex min-h-10 cursor-pointer list-none items-center justify-end gap-2 px-3 py-1 text-slate-400 hover:text-emerald-200 [&::-webkit-details-marker]:hidden">
          <BarChart3 aria-hidden="true" className="h-4 w-4" />
          <span className="sr-only">Toggle detailed analytics for {name}</span>
          <ChevronDown aria-hidden="true" className="h-4 w-4 transition-transform group-open:rotate-180" />
        </summary>
      <div className="grid min-w-0 grid-cols-1 items-start gap-3 border-t border-slate-800 p-3 sm:p-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-3">
          <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700/80 bg-[#071420] px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <TrendingUp aria-hidden="true" className="h-8 w-8 shrink-0 text-emerald-400" />
              <div className="min-w-0">
                <h3 className="truncate text-xl font-black tracking-tight">{name}</h3>
                <p className="truncate text-sm text-slate-300">{algo?.subtitle ?? fallback[2]}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" role="switch" aria-checked={enabled} onClick={() => setTrade(!enabled)}
                disabled={!algo || Boolean(enabled ? offBlocked : onBlocked)} title={(enabled ? offBlocked : onBlocked) ?? undefined}
                className={`inline-flex min-h-11 items-center gap-3 rounded-full border px-4 text-sm font-extrabold disabled:cursor-not-allowed disabled:opacity-60 ${
                  enabled ? 'border-emerald-500 bg-emerald-950 text-emerald-300' : 'border-slate-600 bg-slate-900 text-slate-300'}`}>
                {enabled ? 'Trade ON' : 'Trade OFF'}
                <span aria-hidden="true" className={`relative h-6 w-11 rounded-full transition-colors ${enabled ? 'bg-emerald-500' : 'bg-slate-600'}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${enabled ? 'left-[22px]' : 'left-0.5'}`} />
                </span>
              </button>
              <div role="group" aria-label="Execution mode" className="flex rounded-lg border border-slate-700 bg-[#050d15] p-1">
                <button type="button" aria-pressed={enabled} onClick={() => setTrade(true)}
                  disabled={!algo || (!enabled && Boolean(onBlocked))} title={!enabled ? onBlocked ?? undefined : undefined}
                  className={`min-h-9 rounded-md px-4 text-sm font-extrabold disabled:cursor-not-allowed ${
                    enabled ? 'border border-emerald-500 bg-emerald-700/40 text-white' : 'text-slate-400 hover:text-slate-200 disabled:opacity-60'}`}>
                  Live (Auto)
                </button>
                <button type="button" aria-pressed={!enabled} onClick={() => setTrade(false)}
                  disabled={!algo || (enabled && Boolean(offBlocked))}
                  className={`min-h-9 rounded-md px-4 text-sm font-extrabold disabled:cursor-not-allowed ${
                    !enabled ? 'border border-slate-500 bg-slate-700/60 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                  Manual
                </button>
              </div>
            </div>
            <p role={error ? 'alert' : 'status'} title={line}
              className={`basis-full truncate border-t border-slate-800 pt-2 text-xs ${error ? 'text-amber-300' : 'text-slate-400'}`}>
              <Clock3 aria-hidden="true" className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />{line}
            </p>
          </header>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-700/80 bg-[#071420] p-2">
            <div role="tablist" aria-label="Select index" className="flex rounded-lg border border-slate-700 bg-[#050d15] p-1">
              {SYMBOLS.map(item => (
                <button key={item} type="button" role="tab" aria-selected={symbol === item} onClick={() => chooseSymbol(item)}
                  className={`min-h-9 rounded-md px-3 text-sm font-extrabold sm:px-4 ${symbol === item
                    ? 'border border-emerald-500 bg-emerald-700/40 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                  {INDEX_LABEL[item]}
                </button>
              ))}
            </div>
            <p className="flex min-w-0 flex-wrap items-baseline justify-end gap-x-2 px-2 tabular-nums">
              <span className="text-sm font-bold text-slate-300">{INDEX_LABEL[symbol]}</span>
              <span className="min-w-0 text-right text-lg font-black text-slate-100">{price(tick?.price)}</span>
              <span className={`min-w-0 text-right text-sm font-bold ${tone(change?.change)}`}>{changeText}</span>
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-700/70 bg-[#071420] px-3 py-2">
            <span className="text-sm font-bold text-slate-200">Price Chart</span>
            <button type="button" aria-expanded={chartExpanded} aria-controls="algo-desk-chart-panel"
              onClick={() => setChartExpanded(expanded => !expanded)}
              className="inline-flex min-h-9 items-center gap-2 rounded-md border border-slate-600/80 px-3 text-xs font-bold text-slate-300 transition-colors hover:border-emerald-500/60 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300">
              {chartExpanded ? 'Collapse' : 'Expand'}
              <ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform ${chartExpanded ? 'rotate-180' : ''}`} />
            </button>
          </div>
          <div id="algo-desk-chart-panel" hidden={!chartExpanded} className="aqte-theme algo-desk-chart min-w-0">
            {chartExpanded && <Chart symbol={symbol} tick={tick} />}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {([
              ["Today's Trades", today ? `${today.trades} / ${limits?.per_algo_max_trades ?? '—'}` : '—', 'text-slate-100'],
              ['Win Rate', finite(today?.win_rate) ? `${today.win_rate.toFixed(1)}%` : '—', 'text-slate-100'],
              ['Net P&L', today ? signedRupees(today.net_pnl) : '—', tone(today?.net_pnl)],
              ['Profit Factor', finite(today?.profit_factor) ? today.profit_factor.toFixed(2) : '—', 'text-slate-100'],
              ['Max Drawdown', finite(today?.max_drawdown) && today.max_drawdown > 0 ? `-${rupees(today.max_drawdown)}` : today ? '₹0' : '—',
                finite(today?.max_drawdown) && today.max_drawdown > 0 ? 'text-rose-400' : 'text-slate-100'],
            ] as const).map(([title, value, color]) => (
              <article key={title} className="rounded-xl border border-slate-700/80 bg-[#071420] px-3 py-2">
                <h4 className="text-xs font-semibold text-slate-400">{title}</h4>
                <p className={`mt-1 text-xl font-black tabular-nums ${color}`}>{value}</p>
              </article>
            ))}
          </div>

          <Card title="Open Position" icon={<Zap className="h-4 w-4" />}
            aside={owned && (
              <button type="button" onClick={exitTrade} disabled={busy || Boolean(owned.exit_requested)}
                className="min-h-9 rounded-md border border-rose-600 bg-rose-950 px-3 text-xs font-extrabold text-rose-200 hover:bg-rose-900 disabled:opacity-50">
                {owned.exit_requested ? 'Exit requested' : 'Exit trade'}
              </button>
            )}>
            {owned ? (
              <dl className="grid grid-cols-2 gap-x-4 px-3 py-2 sm:grid-cols-4">
                <Row label="Contract">{owned.contract.trading_symbol}</Row>
                <Row label="Qty">{owned.filled || owned.quantity}</Row>
                <Row label="Entry">{price(owned.entry_price || owned.limit)}</Row>
                <Row label="LTP">{price(owned.ltp)}</Row>
                <Row label={owned.trailing_active ? 'Trailing SL' : 'Stop Loss'}><span className="text-rose-300">{price(owned.stop)}</span></Row>
                <Row label="Target"><span className="text-emerald-300">{price(owned.target)}</span></Row>
                <Row label="State">{words(owned.state)}</Row>
                <Row label="P&L"><span className={tone(owned.unrealized)}>{signedRupees(owned.unrealized)}</span></Row>
              </dl>
            ) : (
              <p className="flex min-h-[64px] items-center px-3 text-sm text-slate-400">
                {active ? `Shared lane busy: ${active.name} holds ${active.contract.trading_symbol}. One live trade at a time.`
                  : `No open ${name} trade.`}
              </p>
            )}
          </Card>

          <Card title="Live Signals" icon={<Activity className="h-4 w-4" />}
            aside={<span className="text-xs font-semibold text-slate-400">{name}</span>}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[13px] tabular-nums">
                <thead className="text-xs text-slate-400">
                  <tr>{['Time', 'Index', 'Signal', 'Entry', 'SL', 'Target', 'Status', 'P&L'].map(head => (
                    <th key={head} scope="col" className="px-3 py-2 font-semibold">{head}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {rows.slice(0, 8).map(row => (
                    <tr key={row.id} className="border-t border-slate-800">
                      <td className="px-3 py-1.5">{clock(row.at)}</td>
                      <td className="px-3 py-1.5">{INDEX_LABEL[row.symbol] ?? row.symbol}</td>
                      <td className="px-3 py-1.5"><SignalBadge decision={row.signal} /></td>
                      <td className="px-3 py-1.5">{price(row.entry)}</td>
                      <td className="px-3 py-1.5 text-rose-300">{price(row.stop)}</td>
                      <td className="px-3 py-1.5 text-emerald-300">{price(row.target)}</td>
                      <td className="px-3 py-1.5">
                        <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-bold ${row.statusTone}`}>{row.status}</span>
                      </td>
                      <td className={`px-3 py-1.5 font-bold ${tone(row.pnl)}`}>{signedRupees(row.pnl)}</td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr className="border-t border-slate-800">
                      <td colSpan={8} className="px-3 py-4 text-sm text-slate-400">
                        No {name} signals or trades yet. Qualified entries, rejections and closed trades appear here.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Performance (This Week)" icon={<BarChart3 className="h-4 w-4" />}>
            <dl className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-3">
              <div className="min-w-0 rounded-lg border border-slate-700/70 bg-slate-900/40 px-2.5 py-2">
                <dt className="truncate text-[11px] leading-tight text-slate-400">Total Trades</dt>
                <dd className="mt-1 truncate text-sm font-black tabular-nums text-slate-100">{week ? week.trades : '—'}</dd>
              </div>
              <div className="min-w-0 rounded-lg border border-slate-700/70 bg-slate-900/40 px-2.5 py-2">
                <dt className="truncate text-[11px] leading-tight text-slate-400">Win Rate</dt>
                <dd className="mt-1 truncate text-sm font-black tabular-nums text-slate-100">{finite(week?.win_rate) ? `${week.win_rate.toFixed(1)}%` : '—'}</dd>
              </div>
              <div className="min-w-0 rounded-lg border border-slate-700/70 bg-slate-900/40 px-2.5 py-2">
                <dt className="truncate text-[11px] leading-tight text-slate-400">Net P&amp;L</dt>
                <dd className={`mt-1 truncate text-sm font-black tabular-nums ${tone(week?.net_pnl)}`}>{week ? signedRupees(week.net_pnl) : '—'}</dd>
              </div>
              <div className="min-w-0 rounded-lg border border-slate-700/70 bg-slate-900/40 px-2.5 py-2">
                <dt className="truncate text-[11px] leading-tight text-slate-400">Profit Factor</dt>
                <dd className="mt-1 truncate text-sm font-black tabular-nums text-slate-100">{finite(week?.profit_factor) ? week.profit_factor.toFixed(2) : '—'}</dd>
              </div>
              <div className="min-w-0 rounded-lg border border-slate-700/70 bg-slate-900/40 px-2.5 py-2">
                <dt className="truncate text-[11px] leading-tight text-slate-400">Avg. Win</dt>
                <dd className="mt-1 truncate text-sm font-black tabular-nums text-emerald-300">{rupees(week?.avg_win)}</dd>
              </div>
              <div className="min-w-0 rounded-lg border border-slate-700/70 bg-slate-900/40 px-2.5 py-2">
                <dt className="truncate text-[11px] leading-tight text-slate-400">Avg. Loss</dt>
                <dd className="mt-1 truncate text-sm font-black tabular-nums text-rose-300">{finite(week?.avg_loss) ? `-${rupees(week.avg_loss)}` : '—'}</dd>
              </div>
            </dl>
          </Card>

        </div>

        <div className="grid min-w-0 grid-cols-1 content-start gap-3">
          <Card title="Strategy Status" icon={<Activity className="h-4 w-4" />}
            aside={<span className={`text-sm font-extrabold ${modeTone}`}>● {modeLabel}</span>}>
            <dl className="px-3 py-2">
              <Row label="Market Regime">
                {signal?.context.regime ? (
                  <span className="rounded-md bg-emerald-900/50 px-2 py-0.5 text-emerald-200">
                    {words(signal.context.regime)}{signal.context.volatile ? ' · Volatile' : ''}
                  </span>
                ) : '—'}
              </Row>
              <Row label="Higher TF (30m)">{words(signal?.context.htf_30m)}</Row>
              <Row label="Structure (15m)">{words(signal?.context.structure_15m)}</Row>
              <Row label="Price vs VWAP">{signal?.context.price_vs_vwap ? `${words(signal.context.price_vs_vwap)} VWAP` : '—'}</Row>
              <Row label="Setup">{signal?.context.setup ?? '—'}</Row>
              <Row label="Rules passed">{signal ? `${signal.passed} / ${signal.total}` : '—'}</Row>
              <Row label="Signal"><SignalBadge decision={signal?.decision} /></Row>
            </dl>
          </Card>

          <Card title={conditionsTitle} icon={<Check className="h-4 w-4" />}>
            <ul className="min-h-[120px] px-3 py-2">
              {(signal?.rules ?? []).map(rule => (
                <li key={rule.id || rule.label} title={rule.requirement}
                  className="flex items-start justify-between gap-3 py-1 text-[13px]">
                  <span className="min-w-0">
                    <span className="block truncate text-slate-200">
                      • {rule.label}
                      {rule.value !== null && rule.value !== undefined && rule.value !== '' &&
                        <span className="ml-1 text-slate-500">({String(rule.value)})</span>}
                    </span>
                    {typeof rule.requirement === 'string' && rule.requirement !== '' &&
                      <span className="block pl-3 text-[11px] leading-snug text-slate-500">{rule.requirement}</span>}
                  </span>
                  <span aria-label={rule.passed === true ? 'passed' : rule.passed === false ? 'failed' : 'waiting'}
                    className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                      rule.passed === true ? 'bg-emerald-500 text-[#04130e]' : rule.passed === false ? 'bg-rose-600/80 text-white' : 'bg-slate-700 text-slate-300'}`}>
                    {rule.passed === true ? '✓' : rule.passed === false ? '✕' : '…'}
                  </span>
                </li>
              ))}
              {!signal && <li className="py-2 text-sm text-slate-400">Live rules load with the next status update.</li>}
            </ul>
            {signal && <p className="border-t border-slate-800 px-3 py-2 text-xs text-slate-400">{signal.reason}</p>}
          </Card>

          <Card title="Risk & Execution" icon={<ShieldCheck className="h-4 w-4" />}>
            <dl className="px-3 py-2">
              <Row label="Execution">{enabled ? <span className="text-emerald-300">Live (Auto)</span> : 'Manual · signals only'}</Row>
              <Row label="SL (Index points)">{finite(signal?.levels.underlying_risk) ? PRICE.format(signal.levels.underlying_risk) : '—'}</Row>
              <Row label="Target">{limits ? `${limits.target_r}R on premium` : '—'}</Row>
              <Row label="Trailing SL">
                <span className="rounded-md bg-emerald-600 px-2 py-0.5 text-xs font-black text-white">ON</span>
                <span className="ml-1 text-slate-400">{limits ? `from ${limits.trail_start_r}R` : ''}</span>
              </Row>
              <Row label="Position Size">{limits ? `${limits.max_lots} lot · risk ≤ ${rupees(limits.risk_per_trade)}` : '—'}</Row>
              <Row label="Algo trades today">{algo && limits ? `${algo.entries_today} / ${limits.per_algo_max_trades}` : '—'}</Row>
              <Row label="Account trades today">{status && limits ? `${status.account.trades_today} / ${limits.max_trades}` : '—'}</Row>
              <Row label="Daily loss limit">{limits ? rupees(limits.daily_loss) : '—'}</Row>
              <Row label="Entry window">{limits?.entry_window ?? '—'}</Row>
            </dl>
          </Card>
        </div>
      </div>
      </details>
    </section>
  );
}
