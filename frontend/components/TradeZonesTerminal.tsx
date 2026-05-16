'use client';

import React, { useMemo, useState } from 'react';
import { useTradeZonesMatrix, type TradeZoneSignal } from '@/hooks/useTradeZonesMatrix';

type SignalFilter = 'ALL' | 'BULLISH' | 'BEARISH' | 'NEUTRAL';
type SortBy = 'signal' | 'confidence' | 'rr' | 'symbol';

const SIGNAL_CLASS: Record<TradeZoneSignal, string> = {
  STRONG_BUY: 'text-emerald-300 bg-emerald-500/20 border-emerald-400/40',
  BUY: 'text-green-300 bg-green-500/20 border-green-400/40',
  NEUTRAL: 'text-amber-300 bg-amber-500/20 border-amber-400/40',
  SELL: 'text-red-300 bg-red-500/20 border-red-400/40',
  STRONG_SELL: 'text-rose-300 bg-rose-500/20 border-rose-400/40',
  UNKNOWN: 'text-slate-300 bg-slate-500/20 border-slate-400/40',
};

function normalizeSignal(signal: string): TradeZoneSignal {
  const v = signal.toUpperCase();
  if (v === 'STRONG_BUY' || v === 'BUY' || v === 'NEUTRAL' || v === 'SELL' || v === 'STRONG_SELL') {
    return v;
  }
  return 'UNKNOWN';
}

function signalScore(signal: string): number {
  const s = normalizeSignal(signal);
  if (s === 'STRONG_BUY') return 5;
  if (s === 'BUY') return 4;
  if (s === 'NEUTRAL') return 3;
  if (s === 'SELL') return 2;
  if (s === 'STRONG_SELL') return 1;
  return 0;
}

export default function TradeZonesTerminal(): JSX.Element {
  const { rows, events, summary, loading, error, lastUpdate, refresh } = useTradeZonesMatrix(2000);
  const [query, setQuery] = useState('');
  const [signalFilter, setSignalFilter] = useState<SignalFilter>('ALL');
  const [sortBy, setSortBy] = useState<SortBy>('signal');

  const filteredRows = useMemo(() => {
    const q = query.trim().toUpperCase();
    const out = rows.filter((r) => {
      if (q && !r.symbol.includes(q)) {
        return false;
      }

      const signal = normalizeSignal(r.overall_signal);
      if (signalFilter === 'BULLISH') {
        return signal === 'BUY' || signal === 'STRONG_BUY';
      }
      if (signalFilter === 'BEARISH') {
        return signal === 'SELL' || signal === 'STRONG_SELL';
      }
      if (signalFilter === 'NEUTRAL') {
        return signal === 'NEUTRAL';
      }
      return true;
    });

    out.sort((a, b) => {
      if (sortBy === 'symbol') return a.symbol.localeCompare(b.symbol);
      if (sortBy === 'confidence') return b.signal_confidence - a.signal_confidence;
      if (sortBy === 'rr') return b.risk_reward_ratio - a.risk_reward_ratio;
      return signalScore(b.overall_signal) - signalScore(a.overall_signal);
    });

    return out;
  }, [rows, query, signalFilter, sortBy]);

  return (
    <div className="rounded-2xl border border-cyan-500/35 bg-gradient-to-br from-cyan-950/25 via-slate-900/70 to-slate-900/70 p-3 sm:p-4 shadow-xl shadow-cyan-500/10">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-sm sm:text-base font-bold tracking-wide text-cyan-200">Trade Zones Terminal</h3>
          <p className="text-[10px] sm:text-xs text-slate-400">Institutional buy/sell matrix • low-latency aggregated stream</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search symbol"
            className="h-8 w-36 rounded-md border border-slate-700 bg-slate-900/80 px-2 text-xs text-slate-200 outline-none focus:border-cyan-400"
            aria-label="Search symbol"
          />

          <select
            value={signalFilter}
            onChange={(e) => setSignalFilter(e.target.value as SignalFilter)}
            className="h-8 rounded-md border border-slate-700 bg-slate-900/80 px-2 text-xs text-slate-200"
            aria-label="Filter by signal"
          >
            <option value="ALL">All</option>
            <option value="BULLISH">Bullish</option>
            <option value="BEARISH">Bearish</option>
            <option value="NEUTRAL">Neutral</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="h-8 rounded-md border border-slate-700 bg-slate-900/80 px-2 text-xs text-slate-200"
            aria-label="Sort rows"
          >
            <option value="signal">Sort: Signal</option>
            <option value="confidence">Sort: Confidence</option>
            <option value="rr">Sort: R:R</option>
            <option value="symbol">Sort: Symbol</option>
          </select>

          <button
            type="button"
            onClick={refresh}
            className="h-8 rounded-md border border-cyan-500/40 bg-cyan-600/20 px-3 text-xs font-semibold text-cyan-200 hover:bg-cyan-600/30"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricTile label="Dominant" value={summary?.dominant_signal ?? 'N/A'} />
        <MetricTile label="Bullish" value={String(summary?.bullish_count ?? 0)} />
        <MetricTile label="Bearish" value={String(summary?.bearish_count ?? 0)} />
        <MetricTile label="Avg Conf" value={`${summary?.avg_confidence ?? 0}%`} />
      </div>

      {error ? (
        <div className="mt-3 rounded-md border border-red-500/40 bg-red-900/20 p-2 text-xs text-red-200">{error}</div>
      ) : null}

      <div className="mt-3 overflow-hidden rounded-lg border border-slate-700/60">
        <div className="max-h-72 overflow-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="sticky top-0 z-10 bg-slate-900/95 text-slate-300">
              <tr>
                <th className="px-2 py-2 text-left font-semibold">Symbol</th>
                <th className="px-2 py-2 text-right font-semibold">Price</th>
                <th className="px-2 py-2 text-left font-semibold">Zone</th>
                <th className="px-2 py-2 text-left font-semibold">Signal</th>
                <th className="px-2 py-2 text-right font-semibold">Confidence</th>
                <th className="px-2 py-2 text-right font-semibold">R:R</th>
                <th className="px-2 py-2 text-left font-semibold">Entry</th>
                <th className="px-2 py-2 text-left font-semibold">Trend</th>
              </tr>
            </thead>
            <tbody>
              {loading && filteredRows.length === 0 ? (
                <tr>
                  <td className="px-2 py-3 text-slate-400" colSpan={8}>Loading trade zones...</td>
                </tr>
              ) : null}

              {!loading && filteredRows.length === 0 ? (
                <tr>
                  <td className="px-2 py-3 text-slate-400" colSpan={8}>No symbols match current filters.</td>
                </tr>
              ) : null}

              {filteredRows.map((row) => {
                const sig = normalizeSignal(row.overall_signal);
                return (
                  <tr key={row.symbol} className="border-t border-slate-800/80 bg-slate-900/40 hover:bg-slate-800/50">
                    <td className="px-2 py-2 font-semibold text-slate-100">{row.symbol}</td>
                    <td className="px-2 py-2 text-right font-mono text-slate-200">{row.current_price.toFixed(2)}</td>
                    <td className="px-2 py-2 text-slate-300">{row.zone_classification}</td>
                    <td className="px-2 py-2">
                      <span className={`inline-flex rounded border px-2 py-0.5 font-semibold ${SIGNAL_CLASS[sig]}`}>
                        {sig.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span className="font-mono text-slate-200">{row.signal_confidence}%</span>
                        <span className="h-1.5 w-12 overflow-hidden rounded bg-slate-700">
                          <span className="block h-full bg-gradient-to-r from-cyan-500 to-emerald-400" style={{ width: `${Math.max(2, row.signal_confidence)}%` }} />
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-slate-300">{row.risk_reward_ratio.toFixed(2)}</td>
                    <td className="px-2 py-2 text-slate-300">{row.entry_quality}</td>
                    <td className="px-2 py-2 text-slate-300">{row.trend_structure.replaceAll('_', ' ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-slate-700/60 bg-slate-900/50 p-2">
        <div className="mb-2 text-[11px] font-semibold text-slate-300">Signal Event Feed</div>
        <div className="max-h-28 overflow-auto space-y-1">
          {events.length === 0 ? (
            <div className="text-[11px] text-slate-500">No signal transitions yet.</div>
          ) : (
            events.slice(0, 20).map((evt) => (
              <div key={evt.id} className="flex items-center justify-between rounded border border-slate-700/70 bg-slate-800/50 px-2 py-1 text-[11px]">
                <span className="text-slate-200">{evt.symbol}: {evt.fromSignal.replace('_', ' ')} → {evt.toSignal.replace('_', ' ')}</span>
                <span className="font-mono text-cyan-300">{evt.confidence}%</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="mt-2 text-[10px] text-slate-500">
        Last update: {lastUpdate ? new Date(lastUpdate).toLocaleTimeString() : 'N/A'}
      </div>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-md border border-slate-700/60 bg-slate-900/60 p-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-100">{value}</div>
    </div>
  );
}
