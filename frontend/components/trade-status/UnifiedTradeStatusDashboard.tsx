'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import TradeStatusEngine from '@/components/trade-status/TradeStatusEngine';
import { TRADE_STATUS_PLUGINS } from '@/lib/trade-status/plugins';
import { publishTradeStatusEvent } from '@/lib/trade-status/eventBus';
import { useMarketSocket } from '@/hooks/useMarketSocket';
import type { TradeStatusTheme, TradeSymbol } from '@/types/trade-status';

const SYMBOLS: Array<{ label: string; value: TradeSymbol }> = [
  { label: 'Nifty 50', value: 'NIFTY' },
  { label: 'Bank Nifty', value: 'BANKNIFTY' },
  { label: 'Sensex', value: 'SENSEX' },
];

function formatSigned(value: number): string {
  if (!Number.isFinite(value)) return '0.00';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

function keyboardHint(theme: TradeStatusTheme): string {
  return theme === 'terminal-light'
    ? 'text-slate-700 border-slate-300 bg-slate-200/80'
    : 'text-slate-300 border-slate-600 bg-slate-800/70';
}

export default function UnifiedTradeStatusDashboard(): JSX.Element {
  const [symbol, setSymbol] = useState<TradeSymbol>('NIFTY');
  const [theme, setTheme] = useState<TradeStatusTheme>('terminal-dark');
  const { marketData, isConnected, connectionStatus } = useMarketSocket();

  const tick = marketData[symbol];
  const change = tick?.change ?? 0;
  const changePct = tick?.changePercent ?? 0;

  const trendTone = useMemo(() => {
    if (change > 0) return 'text-emerald-300';
    if (change < 0) return 'text-rose-300';
    return 'text-slate-300';
  }, [change]);

  useEffect(() => {
    publishTradeStatusEvent('symbol_changed', {
      symbol,
      timestamp: Date.now(),
    });
  }, [symbol]);

  useEffect(() => {
    publishTradeStatusEvent('heartbeat', {
      connected: isConnected,
      timestamp: Date.now(),
    });
  }, [isConnected, tick?.timestamp]);

  const switchSymbol = useCallback((nextIndex: number) => {
    const safeIndex = Math.max(0, Math.min(SYMBOLS.length - 1, nextIndex));
    setSymbol(SYMBOLS[safeIndex].value);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && event.key === '1') {
        event.preventDefault();
        switchSymbol(0);
      }
      if (event.altKey && event.key === '2') {
        event.preventDefault();
        switchSymbol(1);
      }
      if (event.altKey && event.key === '3') {
        event.preventDefault();
        switchSymbol(2);
      }
      if (event.altKey && event.key.toLowerCase() === 't') {
        event.preventDefault();
        setTheme((value) => (value === 'terminal-dark' ? 'terminal-light' : 'terminal-dark'));
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [switchSymbol]);

  return (
    <main
      className={`min-h-screen p-3 sm:p-4 lg:p-5 ${
        theme === 'terminal-light'
          ? 'bg-slate-100 text-slate-900'
          : 'bg-[radial-gradient(circle_at_18%_12%,rgba(6,182,212,0.14),transparent_42%),radial-gradient(circle_at_87%_18%,rgba(59,130,246,0.12),transparent_35%),linear-gradient(170deg,#060a14_0%,#091221_45%,#0b1628_100%)] text-slate-100'
      }`}
    >
      <div className="mx-auto w-full max-w-[1800px] space-y-4">
        <header className="sticky top-2 z-40 rounded-2xl border border-slate-700/60 bg-slate-950/75 p-3 backdrop-blur-md">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h1 className="text-lg font-semibold uppercase tracking-[0.16em] text-cyan-200">Trade Status Engine</h1>
              <p className="text-xs text-slate-400">
                Unified institutional dashboard for market context, risk, execution, and signal intelligence.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {SYMBOLS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setSymbol(item.value)}
                  className={`rounded-md border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
                    symbol === item.value
                      ? 'border-cyan-400/80 bg-cyan-500/20 text-cyan-200'
                      : 'border-slate-600/70 bg-slate-800/70 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  {item.label}
                </button>
              ))}

              <button
                type="button"
                onClick={() => setTheme((value) => (value === 'terminal-dark' ? 'terminal-light' : 'terminal-dark'))}
                className="rounded-md border border-slate-600/70 bg-slate-800/70 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-200"
              >
                {theme === 'terminal-dark' ? 'Light UI' : 'Dark UI'}
              </button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
            <Metric label="Symbol" value={symbol} tone="text-cyan-200" />
            <Metric label="LTP" value={tick?.price?.toFixed(2) ?? '---'} tone={trendTone} mono />
            <Metric
              label="Change"
              value={`${formatSigned(change)} (${formatSigned(changePct)}%)`}
              tone={trendTone}
              mono
            />
            <Metric label="Trend" value={tick?.trend?.toUpperCase() ?? 'NEUTRAL'} tone={trendTone} />
            <Metric label="Volume" value={tick?.volume?.toLocaleString('en-IN') ?? '---'} tone="text-slate-200" mono />
            <Metric label="PCR" value={tick?.pcr?.toFixed(2) ?? '---'} tone="text-slate-200" mono />
            <Metric label="Connection" value={connectionStatus.toUpperCase()} tone={isConnected ? 'text-emerald-300' : 'text-amber-300'} />
            <Metric label="Update" value={tick?.timestamp ? new Date(tick.timestamp).toLocaleTimeString() : '---'} tone="text-slate-300" />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
            <span className={`rounded border px-2 py-1 ${keyboardHint(theme)}`}>ALT+1 Nifty</span>
            <span className={`rounded border px-2 py-1 ${keyboardHint(theme)}`}>ALT+2 Bank Nifty</span>
            <span className={`rounded border px-2 py-1 ${keyboardHint(theme)}`}>ALT+3 Sensex</span>
            <span className={`rounded border px-2 py-1 ${keyboardHint(theme)}`}>ALT+T Theme</span>
          </div>
        </header>

        <TradeStatusEngine plugins={TRADE_STATUS_PLUGINS} symbol={symbol} theme={theme} />
      </div>
    </main>
  );
}

interface MetricProps {
  label: string;
  value: string;
  tone: string;
  mono?: boolean;
}

function Metric({ label, value, tone, mono = false }: MetricProps): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-900/55 px-2 py-2">
      <p className="text-[9px] uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className={`truncate text-xs font-semibold ${tone} ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}
