'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { API_CONFIG } from '@/lib/api-config';
import { getOrCreateVisitorId } from '@/lib/visitor-id';
import type { MarketData } from '@/hooks/useMarketSocket';

const SYMBOLS = ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const;
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;
type SymbolName = typeof SYMBOLS[number];
type Weekday = typeof WEEKDAYS[number];
type Expiry = { expiry: string; listed_option_contracts: number; lot_sizes: number[] };
type Status = {
  market_data: { state: string; last_tick_at: string | null };
  instruments: Record<SymbolName, {
    next_listed_expiry: Expiry | null;
    configured_weekday_matches: boolean | null;
    configured_weekday: string | null;
  }>;
  expiry_calendar: { state: string };
  live_orders_enabled: boolean;
  block_reasons: string[];
};
type Config = { schedules: Record<SymbolName, { weekday: Weekday | null; updated_at: string | null }> };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(API_CONFIG.endpoint(`/api/expiryedge/${path}`), {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Id': getOrCreateVisitorId(),
      'X-ExpiryEdge-Intent': 'manual-config',
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
  const [selectedSymbol, setSelectedSymbol] = useState<SymbolName>('NIFTY');
  const [selectedWeekday, setSelectedWeekday] = useState<Weekday | ''>('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<SymbolName | null>(null);

  const refresh = useCallback(async () => {
    setError('');
    try {
      const [nextConfig, nextStatus] = await Promise.all([
        request<Config>('config'),
        request<Status>('status'),
      ]);
      setConfig(nextConfig);
      setStatus(nextStatus);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load Expiry Edge status');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
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

  return (
    <section aria-label="Expiry Edge AI Algo" className="overflow-hidden rounded-xl border border-cyan-900 bg-[#06111a] text-slate-100 shadow-[0_12px_30px_rgba(0,0,0,.4)]">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-700/80 bg-[#030b12] px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Activity aria-hidden="true" className="h-8 w-8 shrink-0 text-emerald-400" />
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
            <h2 className="text-xl font-black tracking-tight sm:text-2xl">ExpiryEdge <span className="text-emerald-400">AI Algo</span></h2>
            <span className="text-sm text-slate-300">Institutional Expiry Trading</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold sm:gap-4 sm:text-sm">
          <span className={`rounded-full border px-3 py-1.5 ${isConnected ? 'border-emerald-600 bg-emerald-950 text-emerald-300' : 'border-amber-700 bg-amber-950/50 text-amber-200'}`}>
            ● {isConnected ? 'LIVE' : 'OFFLINE'}
          </span>
          <span className={isConnected ? 'text-emerald-400' : 'text-amber-300'}>Market feed: {isConnected ? 'Connected' : 'Not connected'}</span>
          <button type="button" onClick={() => void refresh()} className="min-h-10 rounded-lg border border-slate-700 px-3 hover:border-cyan-500" aria-label="Refresh Expiry Edge status">
            Refresh
          </button>
        </div>
      </header>

      <div className="space-y-3 p-3 sm:p-4">
        {error && <p role="alert" className="rounded-lg border border-rose-500/50 bg-rose-950/60 p-3 text-sm text-rose-200">{error}</p>}

        <div className="grid gap-2 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,1.7fr)]">
          <nav aria-label="Select index" className="grid grid-cols-3 gap-2">
            {SYMBOLS.map(symbol => (
              <button key={symbol} type="button" onClick={() => setSelectedSymbol(symbol)}
                aria-pressed={selectedSymbol === symbol}
                className={`flex min-h-[76px] flex-col items-center justify-center gap-0.5 rounded-lg border px-2 py-2 text-sm transition-colors sm:text-base ${
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
            <label htmlFor="expiry-weekday" className="text-sm font-semibold text-slate-200">Expiry Day</label>
            <select id="expiry-weekday" value={selectedWeekday}
              onChange={event => setSelectedWeekday(event.target.value as Weekday | '')}
              className="min-h-10 min-w-32 flex-1 rounded-md border border-slate-600 bg-[#07121c] px-3 text-sm sm:flex-none">
              <option value="">Select day</option>
              {WEEKDAYS.map(day => <option key={day} value={day}>{day}</option>)}
            </select>
            <button type="button" onClick={() => void save()} disabled={!selectedWeekday || saving !== null}
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-emerald-400/70 bg-emerald-600 px-4 text-sm font-extrabold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">
              Save
            </button>
            <span className="basis-full border-t border-slate-800 pt-2 text-xs text-slate-300 sm:basis-auto sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0">
              {status?.instruments[selectedSymbol]?.next_listed_expiry
                ? `Next expiry: ${status.instruments[selectedSymbol].next_listed_expiry?.expiry}`
                : 'Next expiry: unavailable'}
              {status?.instruments[selectedSymbol]?.configured_weekday_matches === false ? ' · Weekday check required' : ''}
            </span>
          </div>
        </div>

        <div className="grid gap-2 lg:grid-cols-3">
          <article className="rounded-lg border border-cyan-900 bg-[#091722] p-3 sm:p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{selectedSymbol === 'BANKNIFTY' ? 'BANK NIFTY' : selectedSymbol}</p>
            <p className="mt-2 text-2xl font-black tabular-nums sm:text-3xl">
              {typeof marketData[selectedSymbol]?.price === 'number' && Number.isFinite(marketData[selectedSymbol]?.price)
                ? PRICE_FORMAT.format(marketData[selectedSymbol]!.price)
                : '—'}
            </p>
            <p className={`mt-1 text-sm font-semibold tabular-nums ${
              (marketData[selectedSymbol]?.changePercent ?? 0) > 0 ? 'text-emerald-400'
                : (marketData[selectedSymbol]?.changePercent ?? 0) < 0 ? 'text-rose-400' : 'text-slate-400'
            }`}>
              {marketData[selectedSymbol] && Number.isFinite(marketData[selectedSymbol].change) && Number.isFinite(marketData[selectedSymbol].changePercent)
                ? `${marketData[selectedSymbol].change > 0 ? '▲ +' : marketData[selectedSymbol].change < 0 ? '▼ ' : ''}${PRICE_FORMAT.format(marketData[selectedSymbol].change)} (${marketData[selectedSymbol].changePercent > 0 ? '+' : ''}${marketData[selectedSymbol].changePercent.toFixed(2)}%)`
                : 'Change —'}
            </p>
          </article>
          <article className="rounded-lg border border-cyan-900 bg-[#091722] p-3 sm:p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">AI Signal</p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="rounded-md border border-amber-700 bg-amber-950/50 px-4 py-1 text-lg font-black text-amber-300">NO SIGNAL</span>
              <span className="text-sm text-slate-400">Confidence —</span>
            </div>
            <p className="mt-2 text-xs text-slate-500">Signal engine is not connected</p>
          </article>
          <article className="rounded-lg border border-cyan-900 bg-[#091722] p-3 sm:p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Today&apos;s P&amp;L</p>
            <p className="mt-2 text-2xl font-black text-slate-300 sm:text-3xl">—</p>
            <p className="mt-1 text-sm text-slate-400">No ExpiryEdge trade ledger connected</p>
          </article>
        </div>

        <section aria-label="Signal and trade levels" className="grid gap-2 rounded-xl border-2 border-emerald-500 bg-[#04130e] p-2.5 shadow-[0_0_20px_rgba(16,185,129,.25)] lg:grid-cols-[minmax(220px,.8fr)_34px_minmax(0,1.75fr)_minmax(280px,1.15fr)]">
          <article className="rounded-xl border border-emerald-500 bg-[#062017] p-3 shadow-[inset_0_0_16px_rgba(16,185,129,.12)]">
            <h3 className="text-sm font-bold text-slate-100">Market Direction (AI)</h3>
            <p className="mt-2 text-2xl font-black text-amber-300">NO TRADE</p>
            <p className="mt-2 border-b border-emerald-900 pb-2 text-xs text-slate-300">Strength: Unavailable</p>
            <ul className="mt-2 space-y-1 text-xs text-slate-300">
              {(status?.block_reasons.length ? status.block_reasons.slice(0, 4) : ['Market intelligence is not connected']).map(reason => (
                <li key={reason} className="flex gap-2"><span className="text-amber-400">●</span><span>{reason}</span></li>
              ))}
            </ul>
          </article>

          <div aria-hidden="true" className="hidden items-center justify-center text-4xl font-black text-emerald-400 lg:flex">»</div>

          <div className="grid gap-2">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {[
                ['Entry Price', 'text-cyan-100'],
                ['Stop Loss', 'text-rose-400'],
                ['Trailing SL', 'text-amber-300'],
              ].map(([label, color]) => (
                <article key={label} className="flex min-h-[76px] flex-col items-center justify-center rounded-xl border border-slate-700 bg-[#091a25] p-2 text-center">
                  <h3 className="text-sm font-semibold text-slate-200">{label}</h3>
                  <p className={`mt-1 text-2xl font-black ${color}`}>—</p>
                </article>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <article className="grid min-h-[70px] grid-cols-2 divide-x divide-slate-700 rounded-xl border border-slate-700 bg-[#071a22] text-center">
                <div className="flex flex-col items-center justify-center px-2 py-2">
                  <h3 className="text-xs font-semibold text-slate-300 sm:text-sm">Profit (Points)</h3>
                  <p className="mt-1 text-xl font-black text-emerald-400">—</p>
                </div>
                <div className="flex flex-col items-center justify-center px-2 py-2">
                  <h3 className="text-xs font-semibold text-slate-300 sm:text-sm">Profit %</h3>
                  <p className="mt-1 text-xl font-black text-emerald-400">—</p>
                </div>
              </article>
              <article className="flex min-h-[70px] flex-col items-center justify-center rounded-xl border border-slate-700 bg-[#071a22] p-2 text-center">
                <h3 className="text-sm font-semibold text-slate-200">Risk : Reward</h3>
                <p className="mt-1 text-xl font-black text-amber-300">—</p>
              </article>
            </div>
          </div>

          <article className="rounded-xl border border-emerald-500 bg-[#062017] p-3 shadow-[inset_0_0_16px_rgba(16,185,129,.12)]">
            <h3 className="font-bold text-slate-100">Smart Targets <span className="text-emerald-400">(Market Direction: —)</span></h3>
            <div className="mt-3 grid grid-cols-2 divide-x divide-emerald-800 rounded-lg border border-emerald-500 bg-[#07301c] text-center">
              <div className="p-3">
                <p className="text-xs font-semibold text-slate-200">Target 1 (T1)</p>
                <p className="mt-2 text-xl font-black text-slate-300">—</p>
                <p className="mt-2 text-xs font-bold text-emerald-400">— pts&nbsp; (—)</p>
              </div>
              <div className="p-3">
                <p className="text-xs font-semibold text-slate-200">Target 2 (T2)</p>
                <p className="mt-2 text-xl font-black text-slate-300">—</p>
                <p className="mt-2 text-xs font-bold text-emerald-400">— pts&nbsp; (—)</p>
              </div>
            </div>
            <p className="mt-2 text-center text-xs text-slate-400">Targets require a validated signal.</p>
          </article>
        </section>

        <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_auto_auto]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-emerald-700/70 bg-[#071b18] p-3">
            <span className="text-sm font-extrabold">Auto Trading (Live)</span>
            <span className="rounded-full bg-slate-700 px-3 py-1 text-xs font-bold text-slate-200">DISABLED</span>
            <span className="hidden h-7 border-l border-slate-600 sm:block" />
            <span className="text-xs text-slate-400">Execution unavailable · Trailing SL unavailable · Smart Target unavailable</span>
          </div>
          <button type="button" disabled className="min-h-12 rounded-lg border border-slate-600 bg-[#102431] px-5 text-sm font-extrabold text-slate-500" title="Execution is not implemented">
            □ &nbsp; SQUARE OFF ALL
          </button>
          <button type="button" disabled className="min-h-12 rounded-lg border border-rose-700 bg-rose-950/70 px-5 text-sm font-extrabold text-rose-300/60" title="Emergency execution is not implemented">
            ⚡ &nbsp; EMERGENCY KILL SWITCH
          </button>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.45fr_1fr_.9fr]">
          <article className="overflow-hidden rounded-xl border border-slate-600 bg-[#06131d]">
            <h3 className="border-b border-slate-700 bg-[#0b202b] px-4 py-3 font-extrabold">Open Positions (0)</h3>
            <div className="grid grid-cols-6 gap-2 border-b border-slate-700 px-3 py-2 text-[10px] font-semibold text-slate-400 sm:text-xs">
              {['Symbol', 'Type', 'Qty', 'Entry', 'LTP', 'P&L'].map(label => <span key={label}>{label}</span>)}
            </div>
            <p className="px-3 py-4 text-sm text-slate-400">No ExpiryEdge position data is connected.</p>
          </article>
          <article className="overflow-hidden rounded-xl border border-slate-600 bg-[#06131d]">
            <h3 className="border-b border-slate-700 bg-[#0b202b] px-4 py-3 font-extrabold">Live Engine Events</h3>
            <p className="px-3 py-4 text-sm text-slate-400">Event stream is not connected.</p>
          </article>
          <article className="overflow-hidden rounded-xl border border-slate-600 bg-[#06131d]">
            <h3 className="border-b border-slate-700 bg-[#0b202b] px-4 py-3 font-extrabold">Risk Guard</h3>
            <div className="space-y-2 p-3 text-xs">
              <p className="flex justify-between gap-2"><span className="text-slate-300">Daily Loss Limit</span><span className="text-slate-500">Not configured</span></p>
              <p className="flex justify-between gap-2"><span className="text-slate-300">Max Trades / Day</span><span className="text-slate-500">Not configured</span></p>
              <p className="flex justify-between gap-2"><span className="text-slate-300">Max Open Positions</span><span className="text-slate-500">Not configured</span></p>
              <p className="flex justify-between gap-2 border-t border-slate-700 pt-2"><span className="text-slate-300">Status</span><span className="font-bold text-amber-300">BLOCKED</span></p>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
