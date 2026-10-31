'use client';

import { memo, useEffect, useState } from 'react';
import { API_CONFIG } from '@/lib/api-config';
import AQTELivePanel, { type LiveState } from '@/components/AQTELivePanel';
import AQTEAutomationSwitch from '@/components/AQTEAutomationSwitch';
import type { MarketData } from '@/hooks/useMarketSocket';
import AQTEDailyControl from '@/components/AQTEDailyControl';
import AQTETerminal from '@/components/AQTETerminal';
import type { AQTESignal } from '@/lib/aqte-display';
import { prefetchChartHistory } from '@/hooks/useChartHistory';

const SYMBOLS = ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const;
const LABELS = { NIFTY: 'NIFTY', BANKNIFTY: 'BANK NIFTY', SENSEX: 'SENSEX' };
const INDEX_STYLES = {
  NIFTY: { border: 'border-cyan-400/30', bar: 'bg-cyan-400', text: 'text-cyan-300' },
  BANKNIFTY: { border: 'border-indigo-400/30', bar: 'bg-indigo-400', text: 'text-indigo-300' },
  SENSEX: { border: 'border-violet-400/30', bar: 'bg-violet-400', text: 'text-violet-300' },
};
type SymbolName = typeof SYMBOLS[number];
type Snapshot = {
  mode: 'ANALYSIS_ONLY';
  generated_at: number;
  data: Record<SymbolName, AQTESignal>;
  risk: { realized_pnl: number; trades: number; max_trades: number; killed: boolean };
  subscription_error: string | null;
  fault: string | null;
  recording: boolean;
};

const number = (value: number) => value.toLocaleString('en-IN', { maximumFractionDigits: 2 });

function isSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<Snapshot>;
  return data.mode === 'ANALYSIS_ONLY' && typeof data.generated_at === 'number' &&
    !!data.risk && typeof data.risk.realized_pnl === 'number' && !!data.data &&
    SYMBOLS.every(symbol => {
      const signal = data.data?.[symbol];
      return !!signal && ['WAIT', 'BUY CE', 'BUY PE'].includes(signal.decision) &&
        Array.isArray(signal.reasons);
    });
}

function AQTESection({ marketData, isConnected = false }: { marketData?: MarketData; isConnected?: boolean }) {
  const [selectedSymbol, setSelectedSymbol] = useState<SymbolName>('NIFTY');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveState | null>(null);

  // Warm the chart bundle and every index's default 5m history so tab switches render from cache.
  useEffect(() => {
    void import('@/components/AQTEChart');
    SYMBOLS.forEach(symbol => void prefetchChartHistory(symbol, 5));
  }, []);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | null = null;
    const poll = async () => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 8000);
      try {
        const response = await fetch(API_CONFIG.endpoint('/api/aqte/snapshot'), {
          cache: 'no-store', signal: controller.signal,
        });
        if (!response.ok) throw new Error(`AQTE unavailable (${response.status})`);
        const payload: unknown = await response.json();
        if (!isSnapshot(payload)) throw new Error('Invalid AQTE response');
        if (Date.now() / 1000 - payload.generated_at > 10) throw new Error('AQTE response is stale');
        if (active) {
          setSnapshot(payload);
          setError(null);
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'AQTE connection unavailable');
      } finally {
        clearTimeout(timeout);
        if (active) timer = setTimeout(poll, 2000);
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
      controller?.abort();
    };
  }, []);

  const unavailable = !!error || !snapshot || !snapshot.recording || !!snapshot.fault;
  const now = Date.now();
  const ist = new Date(now + 330 * 60_000);
  const minute = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const marketHours = ist.getUTCDay() >= 1 && ist.getUTCDay() <= 5 && minute >= 555 && minute < 930;
  const liveFeed = marketHours && isConnected && SYMBOLS.some(symbol => {
    const tick = marketData?.[symbol];
    const age = tick ? (now - Date.parse(tick.timestamp)) / 1000 : Infinity;
    return tick?.status === 'LIVE' && Number.isFinite(tick.price) && tick.price > 0 && age >= -1 && age <= 5;
  });
  return (
    <section aria-labelledby="aqte-title" className="aqte-theme aqte-terminal-shell relative mb-5 w-full min-w-0 max-w-full break-words rounded-xl border border-slate-600/60 bg-[#060d18] shadow-lg shadow-black/15">
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/80 to-transparent" />
      <div className="aqte-shell-header flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/60 px-3 py-3 sm:px-4">
        <div className="aqte-heading flex min-w-0 items-center gap-3">
          <div aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-400/10 text-cyan-300 shadow-inner">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 17l5-6 4 3 8-10M15 4h5v5M3 21h18" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="min-w-0">
          <h2 id="aqte-title" className="text-sm font-semibold leading-relaxed text-slate-100 sm:text-base">
            <span className="font-bold tracking-widest text-cyan-200">AQTE</span>
            <span className="text-slate-400"> — Adaptive Quantitative Trading Engine</span>
            {' '}
            <span role="status" aria-label="AQTE view status" className={`aqte-view-status inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold tracking-wider ${
              liveFeed ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200' :
                'border-amber-400/40 bg-amber-400/10 text-amber-200'
            }`}>
              <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${liveFeed ? 'bg-emerald-300' : 'bg-amber-300'}`} />
              {liveFeed ? 'LIVE' : marketHours ? 'FEED OFF' : 'CLOSED'}
            </span>
          </h2>
          </div>
        </div>
        <AQTEAutomationSwitch />
      </div>
      <div className="p-2 sm:p-3">
      <h3 id="aqte-real-view" className="sr-only">Real Trade · Auto</h3>
      <div id="aqte-trading-panel" role="region" aria-labelledby="aqte-real-view" tabIndex={0} className="rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-300">
      <div role="tablist" aria-label="AQTE index" className="aqte-rich-tabs mb-4 grid grid-cols-3 gap-2 rounded-xl border border-slate-700/70 bg-slate-950/70 p-1.5">
        {SYMBOLS.map((symbol, index) => (
          <button key={symbol} type="button" role="tab" id={`aqte-index-tab-${symbol}`}
            aria-selected={selectedSymbol === symbol} aria-controls={`aqte-index-panel-${symbol}`}
            tabIndex={selectedSymbol === symbol ? 0 : -1}
            onClick={() => setSelectedSymbol(symbol)}
            onKeyDown={event => {
              let next: number;
              if (event.key === 'ArrowRight') next = (index + 1) % SYMBOLS.length;
              else if (event.key === 'ArrowLeft') next = (index + SYMBOLS.length - 1) % SYMBOLS.length;
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = SYMBOLS.length - 1;
              else return;
              event.preventDefault();
              setSelectedSymbol(SYMBOLS[next]);
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
            }}
            className={`aqte-rich-tab aqte-tab-${symbol} min-h-[44px] min-w-0 rounded-lg border px-1 py-2 text-xs font-bold tracking-wide transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 sm:px-2 sm:text-sm ${
              selectedSymbol === symbol ? `${INDEX_STYLES[symbol].border} ${INDEX_STYLES[symbol].text} bg-slate-800` :
                'border-transparent text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
            }`}>
            {LABELS[symbol]}
          </button>
        ))}
      </div>
      {(error || snapshot?.fault || snapshot?.subscription_error) && (
        <p role="status" className="mb-4 break-words rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">
          {error || snapshot?.fault || snapshot?.subscription_error}
        </p>
      )}
      <div>
        {SYMBOLS.map(symbol => {
          const signal = snapshot?.data[symbol];
          const decision = 'WAIT';
          const accent = INDEX_STYLES[symbol];
          const tick = marketData?.[symbol];
          const tickAt = tick ? Date.parse(tick.timestamp) / 1000 : NaN;
          const age = Date.now() / 1000 - tickAt;
          const streaming = isConnected && tick?.status === 'LIVE' &&
            Number.isFinite(tick.price) && tick.price > 0 && age >= -1 && age <= 5 &&
            tickAt >= (snapshot?.generated_at ?? 0) - 5;
          const price = streaming ? tick.price : signal?.spot;
          return (
            <div key={symbol} id={`aqte-index-panel-${symbol}`} role="tabpanel"
              aria-labelledby={`aqte-index-tab-${symbol}`} hidden={selectedSymbol !== symbol}
              tabIndex={selectedSymbol === symbol ? 0 : -1}
              className="rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300">
            <article className={`aqte-index-workspace relative flex min-w-0 flex-col rounded-lg border ${accent.border} bg-[#060e19]`}>
              <div className="flex items-center justify-between gap-2 px-3 pt-2">
                <h3 className={`text-xs font-bold tracking-widest ${accent.text}`}>{LABELS[symbol]}</h3>
                <span className={`rounded-md border px-2 py-1 text-[11px] font-bold tracking-wide ${
                  'border-slate-600/70 bg-slate-800/70 text-slate-300'
                }`}>{decision}</span>
              </div>
              <div className="aqte-underlying-strip mx-2 mb-2 mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-700/50 bg-slate-900/40 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-slate-300">Underlying index</p>
                    <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${streaming ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' : 'border-slate-600 text-slate-400'}`}>
                      {streaming ? 'LIVE FEED' : unavailable ? 'LAST SNAPSHOT' : 'AQTE SNAPSHOT'}
                    </span>
                  </div>
                  <p className="break-words text-xl font-semibold tracking-tight text-slate-100 tabular-nums">{price != null ? number(price) : 'No live quote'}</p>
                  {streaming && Number.isFinite(tick.change) && Number.isFinite(tick.changePercent) && (
                    <p className={`mt-1 text-xs font-medium tabular-nums ${tick.change > 0 ? 'text-emerald-300' : tick.change < 0 ? 'text-rose-300' : 'text-slate-300'}`}>
                      {tick.change > 0 ? '+' : ''}{number(tick.change)} pts · {tick.changePercent > 0 ? '+' : ''}{number(tick.changePercent)}% today
                    </p>
                  )}
                </div>
              </div>
              <AQTETerminal symbol={symbol} mode="real" signal={signal} unavailable={unavailable}
                liveStatus={liveStatus}
                active={selectedSymbol === symbol} tick={streaming ? tick : null}
                controls={selectedSymbol === symbol ? <AQTEDailyControl /> : undefined} execution={null} />
              <details className="mx-2 mb-2 mt-2 rounded-lg border border-slate-700/50 px-3">
              <summary className="cursor-pointer py-2 text-xs font-medium text-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Execution protection</summary>
              <p className="break-words pb-3 text-xs leading-relaxed text-slate-400">
                Automatic entries require daily arming and the header switch ON. OFF blocks new entries; protective exits continue.
              </p>
              </details>
            </article>
            </div>
          );
        })}
      </div>
      <div id="aqte-live-execution" className="mt-2"><AQTELivePanel selectedSymbol={selectedSymbol} onStatus={setLiveStatus} /></div>
      </div>
      </div>
    </section>
  );
}

export default memo(AQTESection);
