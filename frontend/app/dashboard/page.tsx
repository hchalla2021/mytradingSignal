'use client';

import React, { useState } from 'react';
import OverallMarketOutlook from '@/components/OverallMarketOutlook';
import { useMarketSocket } from '@/hooks/useMarketSocket';

type SymbolType = 'NIFTY' | 'BANKNIFTY' | 'SENSEX';

interface SymbolOption {
  label: string;
  value: SymbolType;
}

const fmtPrice = (v: number) =>
  v >= 10000 ? v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : v.toFixed(2);

const fmtVol = (v: number) =>
  v >= 1_00_00_000 ? `${(v / 1_00_00_000).toFixed(2)}Cr`
  : v >= 1_00_000 ? `${(v / 1_00_000).toFixed(2)}L`
  : v.toLocaleString('en-IN');

export default function DashboardPage(): JSX.Element {
  const [selectedSymbol, setSelectedSymbol] = useState<SymbolType>('NIFTY');
  const { marketData } = useMarketSocket();

  const symbols: SymbolOption[] = [
    { label: 'NIFTY 50',   value: 'NIFTY'     },
    { label: 'BANK NIFTY', value: 'BANKNIFTY' },
    { label: 'SENSEX',     value: 'SENSEX'    },
  ];

  const tick = marketData[selectedSymbol];
  const change    = tick?.change        ?? 0;
  const changePct = tick?.changePercent ?? 0;
  const priceColor = change > 0 ? 'text-emerald-400' : change < 0 ? 'text-red-400' : 'text-slate-300';
  const trendColor = tick?.trend === 'bullish' ? 'text-emerald-400' : tick?.trend === 'bearish' ? 'text-red-400' : 'text-slate-400';

  return (
    <div className="min-h-screen bg-dark-bg p-4 sm:p-6">
      <div className="max-w-full">

        {/* ─── Page Header ─────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-1 h-6 rounded-full bg-gradient-to-b from-indigo-400 to-purple-500 shrink-0" />
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                Trading Dashboard
              </h1>
            </div>
            <p className="mt-0.5 ml-3 text-[11px] text-slate-500 tracking-wider uppercase">
              14 Integrated Signals · Live Confidence Analysis · Real-Time Outlook
            </p>
          </div>
          {/* Symbol Selector */}
          <div className="flex rounded-lg overflow-hidden border border-slate-700/50 shrink-0 self-start sm:self-auto">
            {symbols.map((s, idx) => (
              <button
                key={s.value}
                onClick={() => setSelectedSymbol(s.value)}
                type="button"
                className={`px-3 sm:px-4 py-1.5 text-[11px] font-bold transition-colors
                  ${idx < symbols.length - 1 ? 'border-r border-slate-700/50' : ''}
                  ${selectedSymbol === s.value
                    ? 'bg-indigo-500/20 text-indigo-300'
                    : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
                  }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* ─── Live Snapshot ────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-6">
          {[
            { label: 'LTP',    value: tick?.price     ? fmtPrice(tick.price)                         : '—', color: priceColor },
            { label: 'CHG',    value: tick            ? `${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)` : '—', color: priceColor },
            { label: 'HIGH',   value: tick?.high      ? fmtPrice(tick.high)                          : '—', color: 'text-emerald-400' },
            { label: 'LOW',    value: tick?.low       ? fmtPrice(tick.low)                           : '—', color: 'text-red-400' },
            { label: 'VOLUME', value: tick?.volume    ? fmtVol(tick.volume)                          : '—', color: 'text-slate-300' },
            { label: 'TREND',  value: tick?.trend     ? tick.trend.toUpperCase()                     : '—', color: trendColor },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-dark-card/60 rounded-lg border border-slate-700/30 px-3 py-2">
              <p className="text-[8px] font-bold text-slate-500 tracking-[0.12em] uppercase mb-0.5">{label}</p>
              <p className={`text-[11px] sm:text-[13px] font-mono font-semibold tabular-nums leading-tight ${color}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* ─── OI Summary ──────────────────────────────── */}
        {tick && (tick.callOI > 0 || tick.putOI > 0) && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
            {[
              { label: 'CALL OI',  value: fmtVol(tick.callOI), color: 'text-red-400'     },
              { label: 'PUT OI',   value: fmtVol(tick.putOI),  color: 'text-emerald-400' },
              { label: 'TOTAL OI', value: fmtVol(tick.oi),     color: 'text-slate-300'   },
              { label: 'PCR',      value: tick.pcr > 0 ? tick.pcr.toFixed(2) : '—', color: tick.pcr > 1 ? 'text-emerald-400' : tick.pcr < 0.8 ? 'text-red-400' : 'text-slate-300' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-dark-card/60 rounded-lg border border-slate-700/30 px-3 py-2">
                <p className="text-[8px] font-bold text-slate-500 tracking-[0.12em] uppercase mb-0.5">{label}</p>
                <p className={`text-[13px] font-mono font-semibold tabular-nums ${color}`}>{value}</p>
              </div>
            ))}
          </div>
        )}

        {/* ─── Main Content ─────────────────────────────── */}
        <div className="grid grid-cols-1 gap-6">

          {/* Overall Market Outlook — 14 Signals */}
          <OverallMarketOutlook />

          {/* Signal Reference */}
          <div className="bg-dark-card/40 border border-slate-700/30 rounded-xl p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-[3px] h-4 rounded-full bg-gradient-to-b from-indigo-400 to-purple-500 shrink-0" />
              <h3 className="text-[13px] font-bold text-white">Signal Reference</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Technical Indicators</p>
                <ul className="space-y-1.5">
                  {[
                    ['Trend Base',    'Higher-Low structure analysis across timeframes'],
                    ['Volume Pulse',  'Candle volume relative to recent average'],
                    ['Candle Intent', 'Bullish/bearish candle body/wick structure'],
                  ].map(([name, desc]) => (
                    <li key={name} className="flex items-start gap-2 text-[11px]">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0 mt-1" />
                      <span><span className="font-semibold text-slate-200">{name}:</span>
                        <span className="text-slate-500 ml-1">{desc}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Advanced Signals</p>
                <ul className="space-y-1.5">
                  {[
                    ['Smart Money', 'Order block & FVG-based institutional flow'],
                    ['Trade Zones', 'Confluence zone buy/sell signal detection'],
                    ['OI Momentum', 'Open Interest directional momentum analysis'],
                  ].map(([name, desc]) => (
                    <li key={name} className="flex items-start gap-2 text-[11px]">
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0 mt-1" />
                      <span><span className="font-semibold text-slate-200">{name}:</span>
                        <span className="text-slate-500 ml-1">{desc}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
