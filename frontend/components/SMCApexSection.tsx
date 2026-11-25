'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowUpRight, CheckCircle2, Circle, Crown, Cpu, Crosshair, Gauge, Settings2, ShieldCheck, TrendingUp, Zap } from 'lucide-react';
import { API_CONFIG } from '@/lib/api-config';
import { getOrCreateVisitorId } from '@/lib/visitor-id';

const SYMBOLS = ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const;
type SymbolName = typeof SYMBOLS[number];
type Risk = {
  lots: number; risk_per_trade: number; daily_loss: number; stop_percent: number;
  max_spread_percent: number; entry_start: string; entry_end: string;
};
type Draft = Record<keyof Risk, string>;
type Signal = {
  decision: string; reason: string; score: number; execution?: string;
  evaluation?: 'INCOMPLETE' | 'WAITING_FVG' | 'DIAGNOSTIC' | 'QUALIFIED';
  checks: { label: string; passed: boolean; status?: 'PASS' | 'FAIL' | 'WAIT'; detail?: string }[];
  timeframes: Record<string, { candles: number; bias: string; last_at: string | null;
    fvgs?: { side: string; lower: number; upper: number; state: string; confirmed_at: string }[] }>;
  fvgs: { id: string; side: string; lower: number; upper: number; state: string; confirmed_at: string }[];
  setup: { side: string; underlying_entry: number; underlying_stop: number; structural_rr: number; liquidity_target: number } | null;
  diagnostic?: { side: string; underlying_entry: number; underlying_stop: number;
    structural_rr: number; liquidity_target: number } | null;
  contract?: { symbol: string; strike: number; expiry: string; ask: number; bid: number; ltp: number; lot_size: number };
  ai?: { approved: boolean; reason: string; at: string };
  preopen_ai?: { status: string; session_date: string; at: string; bias?: 'CE' | 'PE' | 'NEUTRAL';
    summary?: string; risk_flags?: string[]; reason?: string };
  depth?: { displayed_bid_fraction: number; source: string };
};
type Trade = {
  id: string; symbol: SymbolName; contract: string; expiry: string; side: string; state: string;
  filled: number; quantity: number; entry?: number; ltp?: number; stop?: number;
  initial_stop?: number; peak?: number; gross_pnl?: number; pnl?: number; unrealized_pnl?: number;
  error?: string | null;
  strike?: number;
  setup?: { underlying_stop: number; liquidity_target?: number; structural_rr?: number };
};
type Status = {
  at: string; feed: string; live: boolean; error: string | null;
  connection_warnings?: string[];
  indices: Record<SymbolName, { price: number | null; change_percent: number | null; age: number | null; fresh: boolean;
    timestamp_source?: 'EXCHANGE' | 'RECEIPT' | null; data_warning?: string | null;
    last_close?: { price: number; session_date: string; change_percent: number | null } | null }>;
  signals: Partial<Record<SymbolName, Signal>>;
  config: Record<SymbolName, Risk | null>; daily: { daily_loss: number } | null;
  trades: Trade[]; daily_used: number; ai_calls: number; footprint: string; ml: string;
};
type LiveStatus = { live: boolean; at: string; block_reasons?: string[] };
const EMPTY: Draft = { lots: '', risk_per_trade: '', daily_loss: '', stop_percent: '20',
  max_spread_percent: '1', entry_start: '09:15', entry_end: '14:45' };
const number = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const fmt = (value: number | undefined | null) => value != null && Number.isFinite(value) ? number.format(value) : '--';
const panel = 'rounded-2xl border border-emerald-400/40 bg-gradient-to-br from-cyan-950/40 via-slate-950 to-emerald-950/30 shadow-[inset_0_1px_12px_#00e69015]';

async function request<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(API_CONFIG.endpoint(`/api/smc-apex/${path}`), {
    method: body ? 'PUT' : 'GET', credentials: 'include', cache: 'no-store',
    signal: AbortSignal.timeout(path === 'trade-control' && !body ? 5000 : 15000),
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': getOrCreateVisitorId(),
      'X-Apex-Intent': path === 'trade-control' ? 'manual-live-control' : 'save-configuration' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { detail?: unknown } | null;
    if (Array.isArray(detail?.detail)) {
      const errors: unknown[] = detail.detail;
      const messages = errors.flatMap(item =>
        typeof item === 'object' && item !== null && 'msg' in item && typeof item.msg === 'string'
          ? [item.msg.replace(/^Value error, /, '')] : []);
      if (messages.length) throw new Error(messages.join(' '));
    }
    throw new Error(typeof detail?.detail === 'string' ? detail.detail :
      response.status === 422 ? 'Invalid risk settings. Check positive amounts, whole lots and entry hours.' :
        `SMC Apex request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

function Metric({ title, value, note, color = 'text-emerald-400' }:
  { title: string; value: string; note?: string; color?: string }) {
  return <div className={`${panel} p-3 xl:p-4`}>
    <div className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-200"><Crosshair size={19} />{title}</div>
    <div className={`text-xl font-black tabular-nums xl:text-2xl ${color}`}>{value}</div>
    <div className="mt-1 text-xs text-slate-400">{note || 'Awaiting actual trade data'}</div>
  </div>;
}

export default function SMCApexSection() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [pending, setPending] = useState(false);
  const [controlPending, setControlPending] = useState<boolean | null>(null);
  const [liveState, setLiveState] = useState<boolean | null>(null);
  const [liveError, setLiveError] = useState('');
  const [liveBlockers, setLiveBlockers] = useState<string[]>([]);
  const [symbol, setSymbol] = useState<SymbolName>('NIFTY');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<SymbolName, Draft>>({
    NIFTY: { ...EMPTY }, BANKNIFTY: { ...EMPTY }, SENSEX: { ...EMPTY },
  });
  const [daily, setDaily] = useState('');
  const [notice, setNotice] = useState('');
  const [saveError, setSaveError] = useState('');
  const [clock, setClock] = useState('');
  const refreshBusy = useRef(false);
  const controlBusy = useRef(false);
  const controlRefreshBusy = useRef(false);
  const controlVersion = useRef(0);
  const lastControlReceived = useRef(0);
  const lastReceived = useRef(0);
  const [stale, setStale] = useState(true);

  const refresh = useCallback(async () => {
    if (refreshBusy.current) return;
    refreshBusy.current = true;
    try {
      const next = await request<Status>('status');
      if (!controlBusy.current) setStatus(next);
      lastReceived.current = Date.now();
      setStale(false);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Apex status unavailable');
      setStale(true);
    } finally {
      refreshBusy.current = false;
    }
  }, []);

  const refreshControl = useCallback(async () => {
    if (controlRefreshBusy.current || controlBusy.current) return;
    controlRefreshBusy.current = true;
    const version = controlVersion.current;
    try {
      const next = await request<LiveStatus>('trade-control');
      if (version !== controlVersion.current || controlBusy.current) return;
      const age = Date.now() - Date.parse(next.at);
      if (typeof next.live !== 'boolean' || !Number.isFinite(age) || age < -3000 || age > 10000) {
        throw new Error('Live trading status could not be verified.');
      }
      setLiveState(next.live);
      setLiveBlockers(next.block_reasons?.filter(reason => typeof reason === 'string') || []);
      lastControlReceived.current = Date.now();
      setLiveError('');
    } catch (cause) {
      if (version === controlVersion.current && !controlBusy.current) {
        setLiveState(null);
        setLiveError(cause instanceof Error ? cause.message : 'Live control service unavailable.');
      }
    } finally {
      controlRefreshBusy.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshControl();
    const poll = setInterval(() => void refresh(), 3000);
    const controlPoll = setInterval(() => void refreshControl(), 2000);
    const timer = setInterval(() => {
      setClock(new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }));
      if (Date.now() - lastReceived.current > 10000) setStale(true);
      if (Date.now() - lastControlReceived.current > 10000 && !controlBusy.current) setLiveState(null);
    }, 1000);
    return () => { clearInterval(poll); clearInterval(controlPoll); clearInterval(timer); };
  }, [refresh, refreshControl]);

  const openSettings = () => {
    const makeDraft = (name: SymbolName): Draft => {
      const saved = status?.config[name];
      return saved ? { lots: String(saved.lots), risk_per_trade: String(saved.risk_per_trade),
        daily_loss: String(saved.daily_loss), stop_percent: String(saved.stop_percent),
        max_spread_percent: String(saved.max_spread_percent), entry_start: saved.entry_start,
        entry_end: saved.entry_end } : { ...EMPTY };
    };
    setDrafts({ NIFTY: makeDraft('NIFTY'), BANKNIFTY: makeDraft('BANKNIFTY'), SENSEX: makeDraft('SENSEX') });
    setDaily(status?.daily ? String(status.daily.daily_loss) : '');
    setNotice('');
    setSaveError('');
    setSettingsOpen(true);
  };

  const toggle = async (enabled: boolean) => {
    if (controlBusy.current) return;
    setControlPending(enabled); controlBusy.current = true; controlVersion.current += 1; setActionError('');
    try {
      const result = await request<{ live: boolean }>('trade-control', { enabled });
      if (result.live !== enabled) throw new Error('The service did not confirm the requested live state. Retry status before another change.');
      setLiveState(result.live);
      lastControlReceived.current = Date.now();
      setLiveError('');
      setStatus(current => current ? { ...current, live: result.live } : current);
    } catch (cause) {
      setLiveState(null);
      setActionError(cause instanceof Error ? cause.message : 'Live control failed');
    } finally {
      controlVersion.current += 1; controlBusy.current = false; setControlPending(null);
      await refreshControl();
      void refresh();
    }
  };

  const save = async () => {
    setPending(true); setActionError(''); setSaveError(''); setNotice('');
    try {
      const draft = drafts[symbol];
      const values: Risk = {
        lots: Number(draft.lots), risk_per_trade: Number(draft.risk_per_trade), daily_loss: Number(draft.daily_loss),
        stop_percent: Number(draft.stop_percent), max_spread_percent: Number(draft.max_spread_percent),
        entry_start: draft.entry_start, entry_end: draft.entry_end,
      };
      if (!Number.isInteger(values.lots) || values.lots < 1 ||
          [values.risk_per_trade, values.daily_loss, values.stop_percent, values.max_spread_percent, Number(daily)]
            .some(value => !Number.isFinite(value) || value <= 0)) {
        throw new Error('Enter whole positive lots and positive finite risk amounts.');
      }
      await request(`config/${symbol}`, values);
      setNotice(`${symbol} settings saved.`);
      await request('daily', { daily_loss: Number(daily) });
      setNotice(`${symbol} and Apex daily limits saved.`);
      await refresh();
      await refreshControl();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Saving settings failed');
    } finally { setPending(false); }
  };

  const signal = status?.signals[symbol];
  const active = status?.trades.find(t => t.symbol === symbol && !['CLOSED', 'NO_FILL'].includes(t.state));
  const contract = signal?.contract;
  const approved = !stale && signal?.ai?.approved === true &&
    Date.now() - Date.parse(signal.ai.at) <= 45000 && !!signal.setup;
  const entry = active?.entry;
  const initialRisk = entry != null && active?.initial_stop != null ? entry - active.initial_stop : null;
  const target = (multiple: number) => entry != null && initialRisk != null ? entry + multiple * initialRisk : null;
  const evaluated = !stale && signal?.evaluation === 'QUALIFIED' || !stale && signal?.evaluation === 'DIAGNOSTIC';
  const score = evaluated ? signal?.score || 0 : 0;
  const direction = active ? `BUY ${active.side}` : signal?.setup ? signal.decision : 'WAIT';
  const entryBlocker = liveState === true ? liveBlockers.join(' ') : '';
  const selectedQuote = status?.indices[symbol];
  const selectedLive = !!selectedQuote?.fresh && !stale;
  const selectedPrice = selectedLive ? selectedQuote?.price : selectedQuote?.last_close?.price ?? selectedQuote?.price;

  return <section aria-label="SMC Apex AI" className="mb-6 overflow-hidden rounded-3xl border border-cyan-500/40 bg-[#020e16] p-3 text-slate-100 shadow-[0_0_24px_#00d9a510] sm:p-5">
    <header className="mb-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
      <div className="min-w-0 max-w-full flex-[1_1_19rem]">
        <h2 className="flex items-center gap-2 text-2xl font-black tracking-tight sm:text-3xl">
          <Crown className="shrink-0 text-yellow-300" size={34} /><span>SMC <span className="text-green-400">Apex AI</span></span>
        </h2>
        <p className="mt-1 break-words text-[13px] font-semibold leading-relaxed text-emerald-100/80 sm:text-[14px]">
          Order Block + Liquidity Sweep + Liquidity Run + Advanced FVG
        </p>
      </div>
      <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:gap-3">
        <Zap className="text-lime-400" />
        <div className="text-xs font-bold">LIVE TRADE<div className="font-normal text-slate-400">Auto execution</div></div>
        <button type="button" aria-label="Toggle SMC Apex live entry"
          role={liveState === null ? 'button' : 'switch'} aria-checked={liveState === null ? undefined : liveState}
          title={liveState === null ? 'Live state unavailable. Click to request OFF.' : liveState ? 'Turn live entry OFF' : 'Turn live entry ON'}
          disabled={controlPending !== null || (pending && liveState === false)}
          onClick={() => void toggle(liveState === false)}
          className={`relative h-11 w-24 shrink-0 rounded-full border text-sm font-black transition-colors disabled:cursor-wait ${liveState === true ? 'border-green-400 bg-green-500/20 text-green-300 shadow-[0_0_14px_#00ff6655]' : 'border-slate-500 bg-slate-900 text-slate-200'}`}>
          <span className={`absolute top-1/2 -translate-y-1/2 ${liveState === true ? 'left-3' : 'right-3'}`}>
            {controlPending !== null || liveState === null ? '...' : liveState ? 'ON' : 'OFF'}
          </span>
          <span aria-hidden="true" className={`absolute left-1.5 top-1.5 h-[30px] w-[30px] rounded-full bg-white shadow transition-transform duration-150 ${liveState === true ? 'translate-x-12' : ''} ${controlPending !== null ? 'animate-pulse' : ''}`} />
        </button>
        <span className="hidden text-xs tabular-nums sm:inline">{clock} IST</span>
        <button aria-label={`Configure ${symbol} risk`} aria-expanded={settingsOpen} disabled={pending} onClick={() => { if (!settingsOpen) openSettings(); }}
          className="flex items-center gap-2 rounded-lg border border-cyan-500 px-3 py-2 text-xs font-bold text-cyan-100 disabled:opacity-50"><Settings2 size={19} />Risk settings</button>
      </div>
    </header>
    {(liveError || actionError || entryBlocker || error || status?.error) && <div role="alert" className="mb-3 rounded-xl border border-amber-500/50 bg-amber-950/40 p-3 text-sm text-amber-200">
      {actionError || liveError || entryBlocker || error || status?.error}
      {liveState === null && ' Connection retries automatically. Live state remains unknown until the service confirms it.'}
    </div>}

    {settingsOpen && <div role="region" aria-label={`${symbol} risk configuration`} className="mb-4 rounded-2xl border border-cyan-600 bg-slate-950 p-4">
      <h3 className="mb-2 flex items-center gap-2 font-bold"><Gauge />Risk settings</h3>
      <p className="mb-3 text-xs text-slate-300">Choose an index, enter its risk limits and save. Each index has separate settings.</p>
      <div className="mb-4 flex flex-wrap gap-2" aria-label="Select index risk settings">
        {SYMBOLS.map(name => <button key={name} type="button" disabled={pending} aria-pressed={symbol === name}
          onClick={() => { setSymbol(name); setNotice(''); setSaveError(''); }}
          className={`rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-50 ${symbol === name ? 'border-green-400 bg-green-900/50 text-green-200' : 'border-slate-600 text-slate-200'}`}>
          {name} <span className="font-normal">{status && !stale ? (status.config[name] ? '· Saved' : '· Not saved') : '· Status unavailable'}</span>
        </button>)}
      </div>
      <h4 className="mb-3 text-sm font-bold">{symbol} risk configuration</h4>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {([['lots', 'Lots (whole number)'], ['risk_per_trade', 'Per-trade maximum exposure (Rs)'], ['daily_loss', 'Index daily loss cap (Rs)'],
          ['stop_percent', 'Initial premium stop (%)'], ['max_spread_percent', 'Maximum option spread (%)'], ['entry_start', 'Entry start (IST HH:MM)'],
          ['entry_end', 'Entry end (IST HH:MM)']] as [keyof Risk, string][]).map(([key, label]) =>
          <label key={key} className="text-xs text-slate-300">{label}<input type="text" disabled={pending} value={drafts[symbol][key]} inputMode={key.startsWith('entry') ? 'text' : 'decimal'}
            onChange={e => setDrafts(current => ({ ...current, [symbol]: { ...current[symbol], [key]: e.target.value } }))}
            className="mt-1 block w-full rounded-lg border border-cyan-800 bg-slate-900 px-3 py-2 text-sm text-white" /></label>)}
        <label className="text-xs text-slate-300">Apex combined daily loss cap (Rs)<input type="text" disabled={pending} inputMode="decimal" value={daily} onChange={e => setDaily(e.target.value)} className="mt-1 block w-full rounded-lg border border-cyan-800 bg-slate-900 px-3 py-2 text-sm text-white" /></label>
      </div>
      <p className="mt-3 text-xs text-amber-200">Risk reserves the full premium debit + 1% + Rs 100 charge allowance. Both per-trade and daily caps apply independently; the smaller available budget can block an entry. Settings lock only while an Apex position or order is open. Manual trades never count.</p>
      {saveError && <div role="alert" className="mt-3 rounded-lg border border-rose-500/40 bg-rose-950/30 p-3 text-sm text-rose-200">{saveError}</div>}
      <div className="mt-3 flex flex-wrap items-center gap-3"><button disabled={pending || controlPending !== null} onClick={() => void save()} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-bold disabled:opacity-50">{pending ? 'Saving...' : `Save ${symbol} + daily limit`}</button><button disabled={pending} onClick={() => setSettingsOpen(false)} className="text-sm text-slate-400 disabled:opacity-50">Close</button><span role="status" className="text-xs text-green-400">{notice}</span></div>
    </div>}

    <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_1fr_1fr_2fr]">
      {SYMBOLS.map((name, i) => {
        const quote = status?.indices[name];
        const liveQuote = !!quote?.fresh && !stale;
        const lastClose = !liveQuote ? quote?.last_close : null;
        const price = liveQuote ? quote?.price : lastClose?.price ?? quote?.price;
        const change = liveQuote ? quote?.change_percent : lastClose?.change_percent;
        const points = price != null && Number.isFinite(price) && price > 0 &&
          change != null && Number.isFinite(change) && change > -100
          ? price * change / (100 + change) : null;
        const source = liveQuote ? (quote?.timestamp_source === 'RECEIPT'
          ? 'Live quote using WebSocket receipt time, not an exchange timestamp.'
          : 'Live quote using the exchange timestamp.')
          : lastClose ? `Last completed exchange close on ${lastClose.session_date}, not live. Change is versus the prior close.`
            : quote?.price != null ? 'Last received quote, not live.' : 'Quote unavailable.';
        return <button key={name} disabled={pending} title={source}
          aria-label={`${name}: ${fmt(price)}, ${points != null && change != null ? `${change < 0 ? 'down' : 'up'} ${fmt(Math.abs(points))} points, ${fmt(Math.abs(change))} percent` : 'change unavailable'}. ${source}`}
          onClick={() => { setSymbol(name); setSettingsOpen(false); }}
          className={`${panel} flex items-center justify-center gap-3 p-3 ${symbol === name ? 'ring-1 ring-green-400' : ''}`}>
          <Activity size={32} className={i === 1 ? 'text-fuchsia-400' : i === 2 ? 'text-cyan-300' : 'text-green-400'} />
          <div><div className="font-black">{name}</div><div className="flex flex-wrap items-baseline justify-center gap-x-2 tabular-nums">
            <span className="text-2xl font-black">{fmt(price)}</span>
            <span className={`text-xs font-bold ${change != null && change < 0 ? 'text-red-400' : 'text-green-400'}`}>{points != null && change != null ? `${change < 0 ? '▼' : '▲'} ${fmt(Math.abs(points))} (${fmt(Math.abs(change))}%)` : '--'}</span>
          </div>
          </div>
        </button>;
      })}
      <div className={`${panel} flex items-center justify-between gap-3 p-3`}>
        <Cpu size={38} className="shrink-0 text-orange-400" />
        <div><div className="font-bold">AI (Claude) Approval {approved ? <CheckCircle2 className="inline text-green-400" size={20} /> : null}</div>
          <div className="mt-1 text-xs text-slate-300">Execution: <span className="text-emerald-300">{stale ? 'UNVERIFIED' : active?.state || signal?.execution || 'WAITING'}</span></div></div>
        <div className="flex items-center gap-2 border-l border-slate-600 pl-3">
          <svg viewBox="0 0 80 80" className="h-14 w-14 -rotate-90" aria-hidden="true">
            <circle cx="40" cy="40" r="32" fill="none" stroke="#14352e" strokeWidth="9" />
            <circle cx="40" cy="40" r="32" fill="none" stroke="#00ed77" strokeWidth="9" strokeDasharray={`${score * 2.01} 201`} strokeLinecap="round" />
          </svg><div className="text-[10px] text-slate-300">Rule confluence<div className="text-xl font-black text-white">{evaluated ? score : '--'}/100</div><div>{evaluated ? 'Not win probability' : 'Not evaluated'}</div></div>
        </div>
      </div>
    </div>

    <div className={`${panel} mb-4 grid items-center gap-4 p-4 md:grid-cols-[1.6fr_2fr_1fr]`}>
      <div className="flex items-center gap-3"><TrendingUp size={70} className={direction === 'WAIT' ? 'text-slate-600' : 'text-green-400 drop-shadow-[0_0_10px_#00ff55]'} />
        <div><div className="text-sm font-bold">AI TRADE SIGNAL</div>
          <div className={`mt-1 flex items-center text-3xl font-black italic sm:text-4xl ${direction === 'WAIT' ? 'text-slate-400' : 'text-green-400'}`}>{direction}{direction !== 'WAIT' && <ArrowUpRight size={42} />}</div>
          <div className="text-xs text-slate-400">{symbol} · {liveState === null ? 'Live status unavailable' : liveState ? 'Entries require all gates' : 'Signals only; no new buys'}</div>
        </div></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[['Instrument', symbol], ['Option Type', active?.side || signal?.setup?.side || '--'],
          ['Strike Price', fmt(active?.strike ?? contract?.strike)], ['Expiry', active?.expiry || contract?.expiry || '--']].map(([label, value]) =>
          <div key={label}><div className="mb-1 text-center text-xs text-slate-400">{label}</div><div className="rounded-lg border border-cyan-700 bg-cyan-950/30 p-2 text-center text-sm font-black">{value}</div></div>)}
      </div>
      <div className={`rounded-xl border p-3 text-center ${approved ? 'border-green-400 bg-green-600/20 shadow-[inset_0_0_15px_#00ff5522]' : 'border-slate-700'}`}>
        <div className="text-xl font-black">{approved ? 'AI APPROVED' : 'NOT APPROVED'}</div><div className="text-xs text-slate-400">Claude (Anthropic) · veto only</div>
      </div>
    </div>
    <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7">
      <Metric title="Option LTP" value={`Rs ${fmt(active?.ltp ?? contract?.ltp)}`} note={active?.contract || contract?.symbol} />
      <Metric title="BUY ENTRY" value={`Rs ${fmt(entry)}`} note={entry ? 'Actual broker average fill' : `Candidate ask: ${fmt(contract?.ask)}; not a fill`} />
      <Metric title="STOP LOSS" value={`Rs ${fmt(active?.initial_stop)}`} color="text-red-400" note="Broker SL-limit; gaps can slip" />
      <Metric title="SMART TRAILING SL" value={`Rs ${fmt(active?.stop)}`} color="text-yellow-300" note={active?.state === 'OPEN' ? 'Monotonic, after +1R; protective order retained OFF' : 'Not active'} />
      <Metric title="PROFIT" value={`Rs ${fmt(active?.unrealized_pnl)}`}
        color={active?.unrealized_pnl != null && active.unrealized_pnl < 0 ? 'text-red-400' : 'text-emerald-400'}
        note={active?.unrealized_pnl != null && active.filled > 0 && active.entry ?
          `${fmt(active.unrealized_pnl / active.filled)} pts (${fmt(active.unrealized_pnl / active.filled / active.entry * 100)}%) · owned bid-mark P&L` : 'Apex-owned unrealized P&L only'} />
      <div className={`${panel} col-span-2 p-3`}><div className="mb-3 flex items-center gap-2 text-xs font-bold"><Crosshair size={19} />TARGETS (Premium risk multiples; not predictions)</div>
        <div className="grid grid-cols-3 gap-2">{[1, 2, 3].map(m => <div key={m} className="rounded-lg border border-green-500/50 bg-green-950/40 p-2 text-center text-sm font-bold">T{m}: Rs {fmt(target(m))}<div className="mt-1 text-xs text-slate-400">+{m}R {m === 3 ? 'exit' : 'milestone'}</div></div>)}</div>
      </div>
    </div>
    <div className="grid gap-3 xl:grid-cols-[1.15fr_1fr_1.15fr]">
      <div className={`${panel} p-4`}><h3 className="mb-3 flex items-center gap-2 font-black"><Cpu className="text-orange-400" />AI ANALYSIS (Claude)</h3>
        {signal?.checks.length ? signal.checks.map(check => <div key={check.label} className="mb-2 flex gap-2 text-xs"
          title={check.detail || undefined}>
          {check.passed ? <CheckCircle2 size={18} className="shrink-0 text-lime-400" /> : <Circle size={18}
            className={`shrink-0 ${check.status === 'WAIT' ? 'text-amber-500' : 'text-slate-600'}`} />}
          <span>{check.label}{check.status === 'WAIT' ? ' · waiting' : ''}</span>
        </div>) : <p className="text-sm text-slate-400">{signal?.reason || 'Collecting real, completed candles. No invented FVGs or approvals.'}</p>}
        <p className="mt-3 text-xs text-orange-200">{signal?.ai?.reason || 'Live setup AI is called only after deterministic rules and fresh depth qualify.'}</p>
        {signal?.preopen_ai && <div className="mt-3 rounded-lg border border-cyan-800 p-2 text-xs text-slate-300">
          <div className="font-bold text-cyan-200">Pre-open AI · {signal.preopen_ai.session_date} · {signal.preopen_ai.status}</div>
          <div>{signal.preopen_ai.summary || signal.preopen_ai.reason}</div>
          {!!signal.preopen_ai.risk_flags?.length && <div className="mt-1 text-amber-200">{signal.preopen_ai.risk_flags.join(' · ')}</div>}
          {signal.preopen_ai.status === 'COMPLETE' && <div className="mt-1 text-slate-400">Historical bias: {signal.preopen_ai.bias} · Not an entry approval</div>}
        </div>}
      </div>
      <div className={`${panel} p-4`}><h3 className="mb-3 flex items-center gap-2 font-black"><Activity />TRADE DETAILS</h3>
        <dl className="text-xs">{[
          [selectedLive ? 'Underlying (live)' : selectedQuote?.last_close ? 'Underlying (last close)' : 'Underlying (not live)',
            `${symbol} ${fmt(selectedPrice)}${!selectedLive && selectedQuote?.last_close ? ` · ${selectedQuote.last_close.session_date}` : ''}`],
          ['Option contract', active?.contract || contract?.symbol || '--'],
          ['Entry premium', fmt(entry)], ['Structural invalidation', fmt(active?.setup?.underlying_stop ?? signal?.setup?.underlying_stop ?? signal?.diagnostic?.underlying_stop)],
          ['Known liquidity target', fmt(active?.setup?.liquidity_target ?? signal?.setup?.liquidity_target ?? signal?.diagnostic?.liquidity_target)],
          ['Structural R:R', (active?.setup?.structural_rr ?? signal?.setup?.structural_rr ?? signal?.diagnostic?.structural_rr) != null ? `1 : ${active?.setup?.structural_rr ?? signal?.setup?.structural_rr ?? signal?.diagnostic?.structural_rr}` : '--'],
          ['Bid / Ask', `${fmt(contract?.bid)} / ${fmt(contract?.ask)}`],
          ['Futures displayed bid fraction', signal?.depth ? `${fmt(signal.depth.displayed_bid_fraction * 100)}%` : '--'],
          ['Owned quantity', active ? `${active.filled} / ${active.quantity}` : '--'],
        ].map(([label, value]) => <div key={label} className="grid grid-cols-2 border-b border-cyan-900/60 py-2"><dt className="text-slate-400">{label}</dt><dd className="break-words pl-2 font-semibold">{value}</dd></div>)}</dl>
      </div>
      <div className={`${panel} p-4`}><h3 className="mb-3 flex items-center gap-2 font-black"><ShieldCheck />EXECUTION STATUS</h3>
        <div className="grid grid-cols-4 gap-2 rounded-xl border border-emerald-500/40 p-3 text-center">
          {[['Rules', !!signal?.setup], ['AI', approved], ['Risk', !!active && !active.error], ['Execute', !!active?.filled]].map(([label, passed]) =>
            <div key={String(label)}>{passed && !stale ? <CheckCircle2 className="mx-auto mb-2 text-green-400" size={29} /> : <Circle className="mx-auto mb-2 text-slate-500" size={29} />}<span className="text-xs">{label}</span></div>)}
        </div>
        <div className="mt-3 rounded-xl border border-lime-500/50 bg-green-950/40 p-3 text-xs font-bold text-lime-300"><Zap className="mr-2 inline" size={20} />{stale ? 'Status unavailable; do not assume live trading is OFF.' : active?.error || signal?.reason || 'Waiting for validated market evidence.'}</div>
        <div className="mt-3 flex flex-wrap gap-1.5">{['1', '3', '5', '15', '30', '60'].map(m =>
          <span key={m} title={signal?.timeframes[m]?.last_at || 'No confirmed candles'} className="rounded border border-cyan-800 px-2 py-1 text-[10px]">{m === '60' ? '1h' : `${m}m`}: {signal?.timeframes[m]?.bias || 'WAIT'}</span>)}<span className="rounded border border-cyan-800 px-2 py-1 text-[10px]">Daily: {signal?.timeframes.Daily?.bias || 'WAIT'}</span></div>
        <div className="mt-3 text-[11px] text-slate-400">Feed: {status?.feed || 'UNAVAILABLE'} · AI calls: {status?.ai_calls ?? '--'}<br />Daily risk used/reserved: Rs {fmt(status?.daily_used)} / {fmt(status?.daily?.daily_loss)}</div>
        {selectedQuote?.data_warning && <div role="status" className="mt-2 text-xs text-amber-300">{selectedQuote.data_warning}</div>}
        {!!status?.connection_warnings?.length && <div role="status" className="mt-2 text-xs text-amber-300">{status.connection_warnings.join(' ')}</div>}
      </div>
    </div>

    <details className="mt-3 rounded-xl border border-cyan-900 p-3 text-xs"><summary className="cursor-pointer font-bold">Confirmed FVG audit and owned trade history</summary>
      <div className="mt-3 grid gap-3 lg:grid-cols-2"><div>
        {Object.entries(signal?.timeframes || {}).map(([frame, context]) =>
          <div key={frame} className="mb-2 text-slate-400">{frame === 'Daily' ? frame : `${frame}m`} zones: {context.fvgs?.length ? context.fvgs.map(g => `${g.side} ${fmt(g.lower)}-${fmt(g.upper)} ${g.state}`).join(' / ') : 'No valid displacement zone in lookback'}</div>)}
        {signal?.fvgs.length ? signal.fvgs.slice().reverse().map(gap => <div key={gap.id} className="border-b border-cyan-950 py-2">{gap.side} · {fmt(gap.lower)}-{fmt(gap.upper)} · {gap.state}<div className="text-slate-500">Confirmed: {gap.confirmed_at}</div></div>) : 'No qualifying completed 5m FVGs.'}
      </div><div>{status?.trades.length ? status.trades.slice().reverse().map(trade => <div key={trade.id} className="border-b border-cyan-950 py-2">{trade.symbol} · {trade.contract} · {trade.state}<div className="text-slate-400">Owned gross P&L: Rs {fmt(trade.gross_pnl)} · after charge reserve: Rs {fmt(trade.pnl)}</div>{trade.error && <div className="text-amber-300">{trade.error}</div>}</div>) : 'No Apex-owned order intents. Manual trades are excluded.'}</div></div>
    </details>
    <footer className="mt-3 text-[10px] leading-relaxed text-slate-500">{status?.footprint || 'Kite displayed depth is not a true bid/ask footprint.'} {status?.ml || 'No untrained ML model is given order authority.'} Experimental rules; not backtested or production-certified. FVG validity does not guarantee success. OFF blocks new entries, not protective exits. Keep manual positions on different contracts. SL-limit orders can remain unfilled during gaps; monitor Kite.</footer>
  </section>;
}
