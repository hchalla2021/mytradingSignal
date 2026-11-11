'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, BarChart3, CalendarDays, CheckCircle2, Clock3, Radio, ShieldCheck, TrendingUp, Zap } from 'lucide-react';
import { getOrCreateVisitorId } from '@/lib/visitor-id';

const SYMBOLS = ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const;
type SymbolName = typeof SYMBOLS[number];
type IndexQuote = {
  price: number;
  change: number | null;
  change_percent: number | null;
  status: string;
  timestamp: string | null;
  history?: number[];
};
type MorningStatus = {
  feed_enabled: boolean;
  feed_status: string;
  block_reasons: string[];
  session_stage: string;
  indices: Partial<Record<SymbolName, IndexQuote | null>>;
  preopen: { started_at: string | null; ended_at: string | null; complete: boolean; ticks: number };
  opening_range: Partial<Record<SymbolName, { high: number | null; low: number | null; complete: boolean }>>;
  signal: {
    decision: string;
    reason: string;
    symbol: SymbolName | null;
    contract: string | null;
    entry: number | null;
    stop: number | null;
    trailing_stop: number | null;
  };
  reason: string;
  error: string | null;
};

const price = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const displayPrice = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? price.format(value) : '—';

function sparkline(values: number[] = []): string {
  if (values.length < 2) return '';
  const min = Math.min(...values);
  const spread = Math.max(...values) - min || 1;
  return values.map((value, index) => {
    const x = (index / (values.length - 1)) * 120;
    const y = 35 - ((value - min) / spread) * 28;
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/morningedge/${path}`, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Id': getOrCreateVisitorId(),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(body?.detail || `MorningEdge request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

function formatSymbol(symbol: string): string {
  return symbol === 'BANKNIFTY' ? 'BANK NIFTY' : symbol;
}

export default function MorningEdgeSection() {
  const [status, setStatus] = useState<MorningStatus | null>(null);
  const [error, setError] = useState('');
  const [controlError, setControlError] = useState('');
  const [clock, setClock] = useState('');
  const [marketEnabled, setMarketEnabled] = useState(true);
  const [marketPending, setMarketPending] = useState(false);
  const refreshLock = useRef(false);
  const marketDesired = useRef(true);
  const marketActionId = useRef(0);
  const marketActionPending = useRef(false);
  const marketRequestQueue = useRef<Promise<void>>(Promise.resolve());

  const refresh = useCallback(async () => {
    if (refreshLock.current) return;
    refreshLock.current = true;
    try {
      const next = await request<MorningStatus>('api/status');
      setStatus(next);
      if (!marketActionPending.current) {
        marketDesired.current = next.feed_enabled;
        setMarketEnabled(next.feed_enabled);
      }
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Waiting for MorningEdge status');
    } finally {
      refreshLock.current = false;
    }
  }, []);

  const toggleMarket = async () => {
    const previous = marketDesired.current;
    const enabled = !previous;
    const actionId = ++marketActionId.current;
    marketDesired.current = enabled;
    marketActionPending.current = true;
    setMarketEnabled(enabled);
    setMarketPending(true);
    const action = marketRequestQueue.current.catch(() => undefined).then(async () => {
      const next = await request<{ feed_enabled: boolean; feed_status: string }>('api/feed/control', {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      });
      if (actionId === marketActionId.current) {
        marketDesired.current = next.feed_enabled;
        setMarketEnabled(next.feed_enabled);
        setControlError('');
        setStatus(current => current ? {
          ...current,
          feed_enabled: next.feed_enabled,
          feed_status: next.feed_status,
        } : current);
      }
    });
    marketRequestQueue.current = action;
    try {
      await action;
    } catch (reason) {
      if (actionId === marketActionId.current) {
        marketDesired.current = previous;
        setMarketEnabled(previous);
        setControlError(reason instanceof Error ? reason.message : 'Unable to change the MorningEdge market feed');
        void refresh();
      }
    } finally {
      if (actionId === marketActionId.current) {
        marketActionPending.current = false;
        setMarketPending(false);
      }
    }
  };

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
    const updateClock = () => setClock(new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date()));
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  const online = status?.indices && SYMBOLS.every(symbol => status.indices[symbol]?.status === 'LIVE');
  const stage = status?.session_stage?.replaceAll('_', ' ').toUpperCase() || 'Waiting for market data';
  const rangeSymbol = status?.signal.symbol || 'NIFTY';
  const openingRange = status?.opening_range[rangeSymbol];
  const engineReady = Boolean(
    online && status?.preopen.complete && openingRange?.complete &&
    status?.signal.decision?.toLowerCase() !== 'wait',
  );
  const steps = [
    { label: '09:00 – 09:08', title: 'PRE-OPEN DATA', done: status?.preopen.complete === true },
    { label: '09:15 – 09:20', title: 'VALIDATE RANGE', done: openingRange?.complete === true },
  ];

  return (
    <section aria-label="MorningEdge AI Algo" className="overflow-hidden rounded-xl border border-[#184052] bg-[#020a12] text-slate-100 shadow-[0_14px_36px_rgba(0,0,0,.48)]">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#203847] bg-[#030b12] px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-emerald-400/50 bg-emerald-400/10">
            <TrendingUp aria-hidden="true" className="h-8 w-8 text-[#28f20b]" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-black tracking-tight sm:text-2xl">MORNINGEDGE <span className="text-[#28f20b]">AI</span></h2>
            <p className="text-xs text-slate-300 sm:text-sm">Autonomous Morning Market Monitor</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 text-xs font-bold text-slate-200 sm:text-sm">
          <CalendarDays aria-hidden="true" className="h-4 w-4 text-slate-400" />
          <span>{clock || 'IST'}</span>
          <button type="button" role="switch" aria-label="MorningEdge market feed"
            aria-checked={marketEnabled} aria-busy={marketPending} onClick={() => void toggleMarket()}
            className={`min-h-10 rounded-full border px-4 py-2 text-sm font-black transition ${
              marketEnabled
                ? 'border-emerald-500 bg-emerald-950/60 text-emerald-200 hover:bg-emerald-900/70'
                : 'border-slate-600 bg-slate-900 text-slate-200 hover:bg-slate-800'
            }`}>
            TRADE <span className={`ml-1 rounded-full px-2 py-0.5 text-xs text-white ${
              marketEnabled ? 'bg-emerald-700' : 'bg-slate-600'
            }`}>{marketEnabled ? 'ON' : 'OFF'}</span>
          </button>
        </div>
      </header>

      <div className="grid gap-2 border-b border-[#203847] bg-[#05101a] p-3 md:grid-cols-[minmax(230px,1.15fr)_repeat(2,minmax(0,1fr))] md:items-center">
        <div className="flex min-h-[68px] items-center gap-3 rounded-xl border border-[#3b667b] bg-[#091722] px-4 py-2">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-lime-500/50 bg-lime-500/10">
            <Clock3 aria-hidden="true" className="h-7 w-7 text-lime-300" />
          </div>
          <div>
            <p className="text-base font-black">Morning Session</p>
            <p className={`text-sm font-semibold ${status ? 'text-slate-400' : 'text-amber-300'}`}>{stage}</p>
          </div>
        </div>
        {steps.map((step, index) => (
          <div key={step.label} className={`relative flex min-h-[68px] flex-col items-center justify-center rounded-xl border px-3 py-2 text-center ${
            step.done ? 'border-[#28f20b] bg-[#0b1c1c]' : 'border-[#35546a] bg-[#08141e]'
          }`}>
            <span className={`absolute -top-2 left-1/2 grid h-5 w-5 -translate-x-1/2 place-items-center rounded-full border bg-[#061018] ${
              step.done ? 'border-[#28f20b] text-[#28f20b]' : 'border-slate-500 text-slate-500'
            }`}><CheckCircle2 aria-hidden="true" className="h-4 w-4" /></span>
            <span className="text-xs text-slate-300">{step.label}</span>
            <span className={`mt-0.5 text-xs font-black sm:text-sm ${step.done ? 'text-[#28f20b]' : 'text-slate-100'}`}>{step.title}</span>
            {index < steps.length - 1 && <span aria-hidden="true" className={`absolute -right-2 top-1/2 z-10 hidden h-0.5 w-2 md:block ${step.done ? 'bg-[#28f20b]' : 'bg-slate-600'}`} />}
          </div>
        ))}
      </div>

      <div className="space-y-3 p-3 sm:p-4">
        {error && <p role="alert" className="rounded-lg border border-rose-500/50 bg-rose-950/60 p-3 text-sm text-rose-200">MorningEdge error: {error}</p>}
        {controlError && <p role="alert" className="rounded-lg border border-rose-500/50 bg-rose-950/60 p-3 text-sm text-rose-200">Market control error: {controlError}</p>}
        {status?.error && <p role="alert" className="rounded-lg border border-amber-700/60 bg-amber-950/30 p-3 text-sm text-amber-100">Feed error: {status.error}</p>}
        <div className="grid gap-2 md:grid-cols-3">
          {SYMBOLS.map(symbol => {
            const quote = status?.indices[symbol];
            const change = quote?.change;
            const changePercent = quote?.change_percent;
            const hasChange = typeof change === 'number' && typeof changePercent === 'number';
            const positive = (change ?? 0) >= 0;
            const chart = sparkline(quote?.history);
            return (
              <article key={symbol} className="relative min-h-[98px] overflow-hidden rounded-xl border border-[#3a6176] bg-[radial-gradient(ellipse_at_75%_35%,rgba(0,92,79,.24),transparent_58%),linear-gradient(115deg,#091722,#061018)] px-4 py-3">
                <div className="relative z-10 flex items-center justify-between gap-2">
                  <h3 className="text-base font-black sm:text-lg">{symbol === 'NIFTY' ? 'NIFTY 50' : formatSymbol(symbol)}</h3>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${
                    quote?.status === 'LIVE' ? 'border-[#28f20b] text-[#28f20b]' : 'border-slate-600 text-slate-400'
                  }`}>{quote?.status === 'LIVE' ? 'LIVE' : <span className="text-amber-300">WAIT</span>}</span>
                </div>
                <p className={`relative z-10 mt-0.5 text-2xl font-black tabular-nums sm:text-[27px] ${quote?.price == null ? 'text-slate-400' : ''}`}>{displayPrice(quote?.price)}</p>
                <p className={`relative z-10 text-sm font-extrabold tabular-nums ${!hasChange ? 'text-slate-400' : positive ? 'text-[#28f20b]' : 'text-rose-400'}`}>
                  {hasChange
                    ? `${change >= 0 ? '▲ +' : '▼ '}${displayPrice(change)} (${changePercent > 0 ? '+' : ''}${changePercent.toFixed(2)}%)`
                    : '—'}
                </p>
                {chart && <svg aria-label={`${formatSymbol(symbol)} actual market price history`} role="img" viewBox="0 0 120 40" preserveAspectRatio="none"
                  className="absolute bottom-3 right-3 h-10 w-[34%] opacity-90">
                  <defs><linearGradient id={`morning-${symbol}`} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#28f20b" stopOpacity=".42" /><stop offset="100%" stopColor="#28f20b" stopOpacity="0" />
                  </linearGradient></defs>
                  <path d={`${chart} L120,40 L0,40 Z`} fill={`url(#morning-${symbol})`} />
                  <path d={chart} fill="none" stroke="#28f20b" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
                </svg>}
              </article>
            );
          })}
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,2.1fr)_minmax(285px,.82fr)]">
          <section aria-label="MorningEdge AI outlook" className="overflow-hidden rounded-xl border border-[#28b64c] bg-[radial-gradient(ellipse_at_20%_0%,rgba(0,142,73,.17),transparent_48%),linear-gradient(135deg,#06150f,#07151b)] p-3 shadow-[0_0_18px_rgba(40,242,11,.12)] sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-800/80 pb-2">
              <h3 className="flex items-center gap-2 text-lg font-black sm:text-xl"><Zap aria-hidden="true" className="h-6 w-6 text-[#28f20b]" /> AI MORNING OUTLOOK</h3>
              <span className="rounded-full border border-emerald-700/70 bg-emerald-950/30 px-3 py-1 text-[11px] font-black text-emerald-200">LIVE MARKET SIGNAL</span>
            </div>
            <div className="grid gap-3 pt-3 md:grid-cols-[112px_minmax(0,1fr)_165px]">
              <div className="flex min-h-[170px] flex-col items-center justify-center rounded-xl border border-emerald-900/80 bg-[#06140f] p-3 text-center">
                <BarChart3 aria-hidden="true" className="h-12 w-12 text-[#28f20b] drop-shadow-[0_0_12px_rgba(40,242,11,.5)]" />
                <span className="mt-2 text-base font-black leading-tight">Morning<br />AI Scan</span>
                <span className={`mt-2 text-[10px] font-bold uppercase tracking-wider ${status ? 'text-slate-500' : 'text-amber-300'}`}>{status ? `${status.preopen.ticks} real ticks` : 'WAIT'}</span>
              </div>
              <div className="space-y-1.5">
                {[
                  ['Strategy Signal', status?.signal.decision?.toUpperCase() || 'WAIT', status?.signal.reason || 'Waiting for live market data.'],
                  ['Pre-open Capture', status?.preopen.complete ? 'COMPLETE' : 'WAIT', '09:00–09:08 IST · real ticks only'],
                  ['Opening Range', openingRange?.complete ? 'VALIDATED' : 'WAIT', `${formatSymbol(rangeSymbol)} · 09:15–09:20 IST`],
                  ['Range High / Low', openingRange ? `${displayPrice(openingRange.high)} / ${displayPrice(openingRange.low)}` : 'PENDING', 'Index points · selected signal index'],
                ].map(([label, value, note], index) => (
                  <div key={label} className="grid min-h-[42px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 rounded-lg border border-[#132a35] bg-[#091923] px-2.5 py-2 text-xs sm:text-sm md:grid-cols-[minmax(95px,.75fr)_minmax(90px,.8fr)_minmax(0,1.5fr)]">
                    <span className="flex min-w-0 items-center gap-1.5 font-semibold text-slate-200">
                      {index === 0 ? <TrendingUp className="h-3.5 w-3.5 text-slate-400" /> : index === 1 ? <Activity className="h-3.5 w-3.5 text-slate-400" /> : index === 2 ? <Radio className="h-3.5 w-3.5 text-slate-400" /> : <CheckCircle2 className="h-3.5 w-3.5 text-slate-400" />}
                      <span className="truncate">{label}</span>
                    </span>
                    <strong className={`text-right ${value === 'WAIT' || value === 'PENDING' || index === 0 && status?.signal.decision?.toLowerCase() === 'wait'
                      ? 'text-amber-300'
                      : index < 3 ? 'text-[#28f20b]' : 'text-amber-200'}`}>{value}</strong>
                    <span className="col-span-2 leading-snug text-slate-400 md:col-span-1 md:truncate">{note}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-col items-center justify-center rounded-xl border border-[#163b2b] bg-[#06140f] p-3 text-center">
                <p className="text-sm font-black uppercase tracking-wide text-slate-300">Signal Status</p>
                <div className="relative mt-2 h-[82px] w-[148px] overflow-hidden">
                  <svg viewBox="0 0 160 90" className="h-full w-full" aria-hidden="true">
                    <path d="M12 82 A68 68 0 0 1 148 82" fill="none" stroke="#263846" strokeWidth="15" strokeLinecap="round" />
                    {engineReady && <path d="M12 82 A68 68 0 0 1 148 82" fill="none" stroke="#28f20b" strokeWidth="15" strokeLinecap="round" />}
                  </svg>
                  <div className={`absolute inset-x-0 bottom-0 text-2xl font-black ${engineReady ? 'text-[#28f20b]' : 'text-amber-300'}`}>{engineReady ? 'READY' : 'WAIT'}</div>
                </div>
                {engineReady && <span className="mt-2 rounded-full border border-[#28f20b] px-3 py-1 text-[10px] font-black text-[#28f20b]">DATA CHECKS PASSED</span>}
                <p className="mt-2 text-[11px] leading-relaxed text-slate-400">Market data and signals only. Order execution is not configured.</p>
              </div>
            </div>
          </section>

          <section aria-label="MorningEdge safety status" className="rounded-xl border border-[#35586b] bg-[linear-gradient(145deg,#091722,#061018)] p-3 sm:p-4">
            <h3 className="flex items-center gap-2 border-b border-slate-700 pb-2 text-lg font-black"><ShieldCheck aria-hidden="true" className="h-6 w-6 text-[#28f20b]" /> EXECUTION &amp; RISK</h3>
            <div className="mt-2 space-y-2 text-xs sm:text-sm">
              <p className="flex justify-between gap-2"><span className="flex items-center gap-2 text-slate-300"><BarChart3 className="h-4 w-4 text-slate-400" /> Order placement</span><strong className="text-amber-300">Not configured</strong></p>
              <p className="rounded-lg border border-slate-700 bg-[#081620] p-2 text-xs text-slate-300">Live order execution is not configured. The signal is informational and cannot place or manage orders.</p>
              {status?.block_reasons.map((reason, index) => <p key={`${index}-${reason}`} className="rounded-lg border border-slate-700/70 bg-[#081620] px-2 py-1.5 text-xs text-slate-400">{reason}</p>)}
            </div>
          </section>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <section aria-label="MorningEdge feed events" className="overflow-hidden rounded-xl border border-[#35586b] bg-[#06131d]">
            <h3 className="flex items-center gap-2 border-b border-slate-700 bg-[#0a1a25] px-3 py-3 text-base font-black"><Radio aria-hidden="true" className="h-5 w-5 text-[#28f20b]" /> MARKET ENGINE EVENTS</h3>
            <div className="space-y-2 p-3">
              {SYMBOLS.map(symbol => {
                const quote = status?.indices[symbol];
                const time = quote?.timestamp ? new Intl.DateTimeFormat('en-IN', {
                  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
                }).format(new Date(quote.timestamp)) : 'WAIT';
                return <div key={symbol} className="flex items-start gap-2 text-xs">
                  <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${quote?.status === 'LIVE' ? 'bg-[#28f20b] shadow-[0_0_8px_#28f20b]' : 'border border-slate-500'}`} />
                  <span className={`w-[58px] shrink-0 font-mono ${time === 'WAIT' ? 'text-amber-300' : 'text-slate-400'}`}>{time}</span>
                  <span className={quote?.status === 'LIVE' ? 'text-slate-200' : 'text-amber-300'}>{quote?.status === 'LIVE' ? `${formatSymbol(symbol)} tick received` : `Waiting for ${formatSymbol(symbol)} tick`}</span>
                </div>;
              })}
              <div className="flex items-start gap-2 border-t border-slate-800 pt-2 text-xs">
                <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${status?.preopen.complete ? 'bg-[#28f20b]' : 'border border-slate-500'}`} />
                <span className="w-[58px] shrink-0 font-mono text-slate-400">09:00–09:08</span>
                <span className="text-slate-200">Pre-open capture · {status?.preopen.ticks ?? 0} real ticks</span>
              </div>
              <div className="flex items-start gap-2 border-t border-slate-800 pt-2 text-xs">
                <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${openingRange?.complete ? 'bg-[#28f20b]' : 'border border-slate-500'}`} />
                <span className="w-[58px] shrink-0 font-mono text-slate-400">09:15–09:20</span>
                <span className={openingRange?.complete ? 'text-slate-200' : 'text-amber-300'}>Opening range · {openingRange?.complete ? 'validated' : 'Waiting for range data'}</span>
              </div>
            </div>
          </section>

          <section aria-label="MorningEdge signal candidate" className="overflow-hidden rounded-xl border border-[#35586b] bg-[#06131d]">
            <h3 className="flex items-center gap-2 border-b border-slate-700 bg-[#0a1a25] px-3 py-3 text-base font-black"><BarChart3 aria-hidden="true" className="h-5 w-5 text-[#28f20b]" /> MARKET SIGNAL</h3>
            <div className="flex min-h-[145px] flex-col justify-center gap-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-amber-600/70 bg-amber-950/30 px-3 py-1 text-sm font-black text-amber-200">
                  {status?.signal.decision?.toLowerCase() === 'wait'
                    ? 'WAIT'
                    : status?.signal.decision?.toUpperCase() || 'WAIT'}
                </span>
                {status?.signal.symbol && <span className="text-xs font-bold text-slate-300">{formatSymbol(status.signal.symbol)}</span>}
              </div>
              <p className="text-sm leading-relaxed text-slate-300">{status?.signal.reason || 'Waiting for authenticated market status.'}</p>
              {status?.signal.contract && <p className="text-xs text-slate-300">Candidate: {status.signal.contract} · indicative entry {displayPrice(status.signal.entry)} · reference stop {displayPrice(status.signal.stop)}</p>}
              <p className="text-xs text-slate-500">Signal information only · order execution is not configured.</p>
            </div>
          </section>

        </div>
      </div>
    </section>
  );
}
