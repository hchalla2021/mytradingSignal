'use client';

import { useState, type ReactNode } from 'react';

const INDICES = [
  { symbol: 'NIFTY', name: 'NIFTY 50' },
  { symbol: 'BANKNIFTY', name: 'BANK NIFTY' },
  { symbol: 'SENSEX', name: 'SENSEX' },
] as const;

type IndexSymbol = typeof INDICES[number]['symbol'];
export type { IndexSymbol };

interface IndexTabsProps {
  idPrefix: string;
  label: string;
  children: (symbol: IndexSymbol, name: string) => ReactNode;
}

export default function IndexTabs({ idPrefix, label, children }: IndexTabsProps) {
  const [activeSymbol, setActiveSymbol] = useState<IndexSymbol>('NIFTY');

  return (
    <div className="min-w-0">
      <IndexTabList idPrefix={idPrefix} label={label} activeSymbol={activeSymbol} onSelect={setActiveSymbol} />
      {/* Keep each card mounted so tick-based analysis and alert state survive tab switches. */}
      {INDICES.map(({ symbol, name }) => (
        <div
          key={symbol}
          id={`${idPrefix}-panel-${symbol}`}
          role="tabpanel"
          aria-labelledby={`${idPrefix}-tab-${symbol}`}
          hidden={activeSymbol !== symbol}
          tabIndex={0}
          className="min-w-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          {children(symbol, name)}
        </div>
      ))}
    </div>
  );
}

export function IndexTabList({ idPrefix, label, activeSymbol, onSelect, panelId }: {
  idPrefix: string;
  label: string;
  activeSymbol: IndexSymbol;
  onSelect: (symbol: IndexSymbol) => void;
  panelId?: string;
}) {
  return (
      <div
        role="tablist"
        aria-label={label}
        className="isolate grid grid-cols-3 gap-1 sm:gap-2 rounded-2xl border border-slate-700/60 bg-gradient-to-b from-slate-800/70 to-slate-950/80 p-1.5 sm:p-2 mb-3 sm:mb-4 shadow-inner"
      >
        {INDICES.map(({ symbol }, index) => (
          <button
            key={symbol}
            type="button"
            id={`${idPrefix}-tab-${symbol}`}
            role="tab"
            aria-label={symbol}
            aria-selected={activeSymbol === symbol}
            aria-controls={panelId ?? `${idPrefix}-panel-${symbol}`}
            tabIndex={activeSymbol === symbol ? 0 : -1}
            onClick={() => onSelect(symbol)}
            onKeyDown={event => {
              let nextIndex: number;
              switch (event.key) {
                case 'ArrowRight': nextIndex = (index + 1) % INDICES.length; break;
                case 'ArrowLeft': nextIndex = (index + INDICES.length - 1) % INDICES.length; break;
                case 'Home': nextIndex = 0; break;
                case 'End': nextIndex = INDICES.length - 1; break;
                default: return;
              }
              event.preventDefault();
              const nextSymbol = INDICES[nextIndex].symbol;
              onSelect(nextSymbol);
              document.getElementById(`${idPrefix}-tab-${nextSymbol}`)?.focus();
            }}
            className={`relative flex min-h-[44px] min-w-0 touch-manipulation items-center justify-center gap-1.5 sm:gap-2.5 rounded-xl border px-1.5 py-3 sm:px-4 sm:py-3.5 text-[11px] xs:text-xs sm:text-sm font-bold tracking-wide transition-colors duration-200 motion-reduce:transition-none focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${
              activeSymbol === symbol
                ? 'border-emerald-400/40 bg-gradient-to-br from-emerald-500/25 via-emerald-500/10 to-teal-500/15 text-emerald-200 shadow-[0_2px_12px_rgba(16,185,129,0.12)]'
                : 'border-transparent text-slate-400 hover:border-slate-600/50 hover:bg-slate-800/70 hover:text-slate-100'
            }`}
          >
            <span
              aria-hidden="true"
              className={`hidden xs:block h-1.5 w-1.5 shrink-0 rounded-full ${
                activeSymbol === symbol ? 'bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.6)]' : 'bg-slate-600'
              }`}
            />
            <span className="whitespace-nowrap">{symbol}</span>
            <span aria-hidden="true" className={`hidden sm:inline-flex rounded-md border px-1.5 py-0.5 text-[9px] font-semibold tracking-wider ${
              activeSymbol === symbol ? 'border-emerald-400/20 text-emerald-300/80' : 'border-slate-700 text-slate-500'
            }`}>
              {symbol === 'SENSEX' ? 'BSE' : 'NSE'}
            </span>
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute bottom-0 inset-x-4 sm:inset-x-8 h-0.5 rounded-full ${
                activeSymbol === symbol ? 'bg-gradient-to-r from-transparent via-emerald-300 to-transparent' : 'bg-transparent'
              }`}
            />
          </button>
        ))}
      </div>
  );
}
