/**
 * MarketIntelligenceObservatory — Bloomberg Terminal Aesthetic
 * ============================================================
 * Production-grade observability dashboard.
 * 4 tabs: Live Today · Heatmap · Rankings · Day Log
 */
'use client';

import { memo, useState, useMemo } from 'react';
import {
  useObservatory,
  type DailyReport,
} from '@/hooks/useObservatory';


// ── Static lookups (no dynamic Tailwind templates) ────────────────────────────

const SIGNAL_STYLES = {
  BULLISH: { bg: 'bg-emerald-500/15', border: 'border-emerald-500/30', text: 'text-emerald-400', dot: 'bg-emerald-400', bar: 'bg-emerald-500' },
  BEARISH: { bg: 'bg-red-500/15',     border: 'border-red-500/30',     text: 'text-red-400',     dot: 'bg-red-400',     bar: 'bg-red-500'     },
  NEUTRAL: { bg: 'bg-amber-500/15',   border: 'border-amber-500/30',   text: 'text-amber-400',   dot: 'bg-amber-400',   bar: 'bg-amber-500'   },
} as const;

const DIR_STYLES = {
  UP:   { text: 'text-emerald-400', icon: '▲', label: 'UP'   },
  DOWN: { text: 'text-red-400',     icon: '▼', label: 'DOWN' },
  FLAT: { text: 'text-amber-400',   icon: '→', label: 'FLAT' },
} as const;

const ACCURACY_STYLE = (pct: number) =>
  pct >= 75 ? { text: 'text-emerald-400', bar: 'bg-emerald-500' }
  : pct >= 55 ? { text: 'text-amber-400',   bar: 'bg-amber-500'   }
  :             { text: 'text-red-400',     bar: 'bg-red-500'     };

const STRATEGY_DISPLAY: Record<string, { name: string; icon: string }> = {
  // Core Trading Strategies
  overall_signal:        { name: 'Overall Consensus',   icon: '⚡' },
  market_regime:         { name: "Today's Market Regime", icon: '🌊' },
  liquidity_score:       { name: 'Market Liquidity',    icon: '💧' },
  market_edge:           { name: 'MarketEdge Intelligence', icon: '🔮' },
  candle_intelligence:   { name: 'Candle Intelligence Engine', icon: '🕯'  },
  trend_base:            { name: 'Trend Base (Higher-Low Structure)', icon: '📐' },
  volume_pulse:          { name: 'Volume Pulse (Candle Volume)', icon: '📊' },
  ict_smart_money:       { name: 'ICT Smart Money',     icon: '🏦' },
  ict_bias:              { name: 'ICT Bias',            icon: '🏛' },
  institutional_compass: { name: 'Institutional Market Compass', icon: '🧭' },
  institutional_confluence: { name: 'Institutional Confluence Engine', icon: '🏢' },
  pred_5m:               { name: '5-Min Prediction',    icon: '⏱'  },
  chart_intelligence:    { name: 'Real-Time Chart Intelligence', icon: '📈' },
  strike_intelligence:   { name: 'Strike Intelligence', icon: '⚔️'  },
  order_flow:            { name: 'Order Flow Analysis', icon: '🌊' },
  smart_money_order_logic: { name: 'Smart Money • Order Logic', icon: '🧠' },
  trade_zones:           { name: 'Trade Zones • Buy/Sell Signals', icon: '🎯' },
  market_liquidity:      { name: 'Market Liquidity',    icon: '💦' },
  quantum_fractal:       { name: 'Quantum Fractal Intelligence Engine', icon: '🧬' },
  crt_bts:               { name: 'CRT BTS Signal',      icon: '🔄' },
  
  // Market Context
  global_indices:        { name: 'Global Indices',      icon: '🌍' },
  global_news:           { name: 'Global News Events',  icon: '📰' },
  global_impact_radar:   { name: 'Global Impact Radar', icon: '🛰' },
  live_market_indices:   { name: 'Live Market Indices', icon: '📉' },
  global_risk:           { name: 'Global Risk',         icon: '⚠' },
};

const HIDDEN_STRATEGY_KEYS = new Set<string>([
  'expiry_explosion',
  'feed_health',
  'api_performance',
  'cache_status',
  'error_rate',
  'data_freshness',
]);

const isVisibleStrategy = (key: string): boolean => !HIDDEN_STRATEGY_KEYS.has(key);

// ── Helpers ───────────────────────────────────────────────────────────────────

function sig(s: string): keyof typeof SIGNAL_STYLES {
  const u = s?.toUpperCase();
  return (u === 'BULLISH' || u === 'BEARISH') ? u : 'NEUTRAL';
}

function dir(d: string): keyof typeof DIR_STYLES {
  return (d === 'UP' || d === 'DOWN') ? d : 'FLAT';
}

function renderBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} className="text-white font-semibold">{part.slice(2, -2)}</strong>
      : <span key={i}>{part}</span>
  );
}

function ConfBar({ value, color, height = 'h-1' }: { value: number; color: string; height?: string }) {
  return (
    <div className={`w-full ${height} bg-slate-800/60 rounded-full overflow-hidden`}>
      <div className={`h-full ${color} transition-all duration-500`} style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }} />
    </div>
  );
}

// ── Tab: Live Today ───────────────────────────────────────────────────────────

const LiveToday = memo<{
  snapshot: ReturnType<typeof useObservatory>['todaySnapshot'];
  lastRefreshed: Date | null;
}>(({ snapshot, lastRefreshed }) => {
  const [activeSymbol, setActiveSymbol] = useState<'NIFTY' | 'BANKNIFTY' | 'SENSEX'>('NIFTY');

  if (!snapshot) {
    return (
      <div className="space-y-2 animate-pulse">
        <div className="h-9 bg-slate-800/40 rounded-xl" />
        <div className="h-14 bg-slate-800/30 rounded-xl" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {[...Array(10)].map((_, i) => <div key={i} className="h-20 bg-slate-800/20 rounded-lg" />)}
        </div>
      </div>
    );
  }

  const strategies = snapshot.current_strategies[activeSymbol] || {};
  const openPrice  = snapshot.open_prices[activeSymbol];
  const snapCount  = snapshot.snapshot_count[activeSymbol] || 0;
  const entries    = Object.keys(STRATEGY_DISPLAY)
    .filter(isVisibleStrategy)
    .map((key) => {
      const signal = strategies[key] || {
        signal: 'NEUTRAL',
        confidence: 0,
        detail: 'Awaiting live section inputs',
      };
      return [key, signal] as const;
    });

  const bullishN = entries.filter(([, v]) => sig(v.signal) === 'BULLISH').length;
  const bearishN = entries.filter(([, v]) => sig(v.signal) === 'BEARISH').length;
  const neutralN = entries.length - bullishN - bearishN;
  const total    = entries.length || 1;

  const consensusKey = bullishN > bearishN ? 'BULLISH' : bearishN > bullishN ? 'BEARISH' : 'NEUTRAL';
  const cs = SIGNAL_STYLES[consensusKey];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {(['NIFTY', 'BANKNIFTY', 'SENSEX'] as const).map(sym => (
            <button key={sym} onClick={() => setActiveSymbol(sym)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all ${
                activeSymbol === sym
                  ? 'bg-violet-500/20 border-violet-400/40 text-violet-200'
                  : 'bg-slate-800/50 border-slate-700/30 text-slate-500 hover:text-slate-300'
              }`}
            >{sym}</button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {snapshot.market_open && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> LIVE
            </span>
          )}
          {lastRefreshed && (
            <span className="text-[10px] text-slate-500 font-mono">
              {lastRefreshed.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })} IST
            </span>
          )}
          <span className="text-[10px] text-slate-600 font-mono">{snapCount} snap{snapCount !== 1 ? 's' : ''}</span>
        </div>
      </div>

      <div className={`rounded-xl border ${cs.border} ${cs.bg} p-3`}>
        <div className="flex flex-wrap items-center gap-3">
          <div className={`text-[14px] font-black px-3 py-1 rounded-lg border ${cs.border} ${cs.bg} ${cs.text}`}>
            {consensusKey === 'BULLISH' ? '▲' : consensusKey === 'BEARISH' ? '▼' : '◆'} {consensusKey}
          </div>
          {openPrice && (
            <span className="text-[11px] text-slate-400 font-mono">
              Open: <strong className="text-slate-200">{openPrice.toLocaleString('en-IN')}</strong>
            </span>
          )}
          <div className="flex-1 min-w-[140px]">
            <div className="flex h-2 rounded-full overflow-hidden">
              <div className="bg-emerald-500 transition-all" style={{ width: `${bullishN / total * 100}%` }} />
              <div className="bg-amber-500  transition-all" style={{ width: `${neutralN / total * 100}%` }} />
              <div className="bg-red-500    transition-all" style={{ width: `${bearishN / total * 100}%` }} />
            </div>
          </div>
          <div className="flex gap-3 text-[10px] font-bold">
            <span className="text-emerald-400">▲ {bullishN}</span>
            <span className="text-amber-400">◆ {neutralN}</span>
            <span className="text-red-400">▼ {bearishN}</span>
          </div>
        </div>
      </div>

      {entries.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
          {entries.map(([key, signal]) => {
            const s = sig(signal.signal);
            const st = SIGNAL_STYLES[s];
            const meta = STRATEGY_DISPLAY[key];
            return (
              <div key={key} className={`rounded-xl border ${st.border} ${st.bg} p-3 flex flex-col gap-1.5`}>
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px]">{meta?.icon ?? '📊'}</span>
                  <p className="text-[10px] font-bold text-slate-300 truncate leading-tight">{meta?.name ?? key}</p>
                </div>
                <div className="flex items-center justify-between gap-1">
                  <span className={`text-[11px] font-black ${st.text}`}>
                    {s === 'BULLISH' ? '▲' : s === 'BEARISH' ? '▼' : '◆'} {s}
                  </span>
                  <span className={`text-[11px] font-bold tabular-nums ${st.text}`}>{signal.confidence}%</span>
                </div>
                <ConfBar value={signal.confidence} color={st.bar} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-700/30 bg-slate-900/20 p-8 text-center">
          <p className="text-slate-400 text-sm">
            {snapshot.market_open ? 'Waiting for first snapshot at 9:30 AM IST…' : 'Market closed. Snapshots captured during 9:15–15:30 IST.'}
          </p>
        </div>
      )}
    </div>
  );
});
LiveToday.displayName = 'LiveToday';

// ── Tab: Heatmap ──────────────────────────────────────────────────────────────

const HeatmapTab = memo<{ reports: DailyReport[] }>(({ reports }) => {
  const [activeSymbol, setActiveSymbol] = useState<'NIFTY' | 'BANKNIFTY' | 'SENSEX'>('NIFTY');

  const allKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const rep of reports) {
      const sym = rep.symbols?.[activeSymbol];
      if (sym) Object.keys(sym.strategy_performance || {}).forEach(k => keys.add(k));
    }
    Object.keys(STRATEGY_DISPLAY).forEach(k => keys.add(k));
    return Array.from(keys).filter(isVisibleStrategy);
  }, [reports, activeSymbol]);

  if (reports.length === 0) {
    return (
      <div className="rounded-xl border border-slate-700/30 bg-slate-900/20 p-8 text-center">
        <p className="text-slate-500 text-sm">No historical reports yet. Heatmap builds after market-close reports are saved.</p>
      </div>
    );
  }

  const sorted = [...reports].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {(['NIFTY', 'BANKNIFTY', 'SENSEX'] as const).map(sym => (
            <button key={sym} onClick={() => setActiveSymbol(sym)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all ${
                activeSymbol === sym
                  ? 'bg-violet-500/20 border-violet-400/40 text-violet-200'
                  : 'bg-slate-800/50 border-slate-700/30 text-slate-500 hover:text-slate-300'
              }`}
            >{sym}</button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-[10px] font-bold">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500/70 inline-block" />Correct</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500/70 inline-block" />Wrong</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-slate-700/40 inline-block" />N/A</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-700/30">
        <table className="text-[10px] border-collapse">
          <thead>
            <tr className="bg-slate-800/60 border-b border-slate-700/30">
              <th className="text-left px-3 py-2 text-slate-400 font-bold whitespace-nowrap sticky left-0 bg-slate-800/80 z-10 min-w-[140px]">Strategy</th>
              {sorted.map(rep => (
                <th key={rep.date} className="text-center px-2 py-2 text-slate-400 font-mono whitespace-nowrap min-w-[52px]">
                  {new Date(rep.date).toLocaleDateString('en-IN', { month: '2-digit', day: '2-digit' })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allKeys.map(key => {
              const meta = STRATEGY_DISPLAY[key];
              return (
                <tr key={key} className="border-b border-slate-800/30 hover:bg-slate-800/10">
                  <td className="px-3 py-2 sticky left-0 bg-[#0a0e1a] z-10 border-r border-slate-800/40">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px]">{meta?.icon ?? '📊'}</span>
                      <span className="text-slate-300 font-medium whitespace-nowrap">{meta?.name ?? key}</span>
                    </div>
                  </td>
                  {sorted.map(rep => {
                    const perf = rep.symbols?.[activeSymbol]?.strategy_performance?.[key];
                    const correct = perf?.was_correct;
                    const cell = correct === true ? 'bg-emerald-500/25 text-emerald-300' : correct === false ? 'bg-red-500/20 text-red-400' : 'text-slate-700';
                    const icon = correct === true ? '✓' : correct === false ? '✗' : '·';
                    return (
                      <td key={rep.date} className={`text-center px-2 py-2 font-mono text-[12px] font-bold ${cell}`}>{icon}</td>
                    );
                  })}
                </tr>
              );
            })}
            <tr className="border-t-2 border-slate-700/50 bg-slate-800/20">
              <td className="px-3 py-2 sticky left-0 bg-slate-800/30 z-10 border-r border-slate-800/40">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Direction</span>
              </td>
              {sorted.map(rep => {
                const sym = rep.symbols?.[activeSymbol];
                const d = sym ? dir(sym.direction) : 'FLAT';
                const ds = DIR_STYLES[d];
                return (
                  <td key={rep.date} className={`text-center px-2 py-2 font-bold text-[11px] ${ds.text}`}>
                    <div>{ds.icon}</div>
                    <div className="text-[9px] tabular-nums mt-0.5">
                      {sym ? `${sym.change_pct > 0 ? '+' : ''}${sym.change_pct.toFixed(1)}%` : ''}
                    </div>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
});
HeatmapTab.displayName = 'HeatmapTab';

// ── Tab: Rankings ─────────────────────────────────────────────────────────────

const RankingsTab = memo<{
  rankings: ReturnType<typeof useObservatory>['rankings'];
}>(({ rankings }) => {
  if (!rankings) {
    return (
      <div className="rounded-xl border border-slate-700/30 bg-slate-900/20 p-8 text-center">
        <p className="text-slate-500 text-sm">Rankings appear after at least 3 days of observations.</p>
      </div>
    );
  }

  const { rankings: list, recommendation, days_analyzed } = rankings;
  const visibleList = list.filter(r => isVisibleStrategy(r.strategy_key));
  const MEDALS = ['🥇', '🥈', '🥉'];

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-amber-500/25 bg-gradient-to-br from-amber-950/20 via-slate-900/30 to-slate-900/20 p-4">
        <p className="text-[10px] font-bold text-amber-400/60 uppercase tracking-widest mb-2">
          AI Recommendation — {days_analyzed} Trading Day{days_analyzed !== 1 ? 's' : ''}
        </p>
        <p className="text-[13px] text-slate-200 leading-relaxed">{renderBold(recommendation)}</p>
      </div>

      {visibleList.length > 0 ? (
        <div className="space-y-1.5">
          {visibleList.map((r, idx) => {
            const w = r.weighted_accuracy ?? r.accuracy;
            const as_ = ACCURACY_STYLE(w);
            const meta = STRATEGY_DISPLAY[r.strategy_key];
            return (
              <div key={r.strategy_key} className="rounded-xl border border-slate-700/30 bg-slate-900/30 p-3 flex items-center gap-3 hover:bg-slate-800/30 transition-all">
                <span className="text-[18px] shrink-0 w-8 text-center">
                  {MEDALS[idx] ?? <span className="text-[13px] font-bold text-slate-500">#{idx + 1}</span>}
                </span>
                <span className="text-[16px] shrink-0">{meta?.icon ?? r.icon ?? '📊'}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[12px] font-bold text-slate-200 truncate">{r.strategy_name}</span>
                      {r.category && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700/50 border border-slate-600/30 text-slate-400 whitespace-nowrap">{r.category}</span>
                      )}
                      {(r.priority ?? 50) >= 90 && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/20 border border-violet-400/30 text-violet-300 whitespace-nowrap font-bold">⭐ HIGH</span>
                      )}
                      {(r.streak ?? 0) >= 3 && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/15 border border-orange-500/30 text-orange-400 whitespace-nowrap font-bold">🔥 {r.streak}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {r.avg_confidence != null && <span className="text-[10px] text-slate-500 tabular-nums">{r.avg_confidence.toFixed(0)}% avg</span>}
                      <span className="text-[10px] text-slate-500">{r.correct}/{r.total}</span>
                      <span className={`text-[14px] font-black tabular-nums ${as_.text}`}>{w.toFixed(0)}%</span>
                    </div>
                  </div>
                  <ConfBar value={w} color={as_.bar} height="h-1.5" />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-700/30 bg-slate-900/20 p-6 text-center">
          <p className="text-slate-500 text-sm">No data yet. Rankings populate after daily reports are generated.</p>
        </div>
      )}
    </div>
  );
});
RankingsTab.displayName = 'RankingsTab';

// ── Tab: Day Log ──────────────────────────────────────────────────────────────

const DayLogTab = memo<{
  reports: DailyReport[];
  reportDays: number;
  setReportDays: (d: number) => void;
}>(({ reports, reportDays, setReportDays }) => {
  const [activeSymbol, setActiveSymbol] = useState<'NIFTY' | 'BANKNIFTY' | 'SENSEX'>('NIFTY');

  if (reports.length === 0) {
    return (
      <div className="rounded-xl border border-slate-700/30 bg-slate-900/20 p-8 text-center">
        <p className="text-slate-500 text-sm">No reports yet. Generated automatically at 15:31 IST each trading day.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {(['NIFTY', 'BANKNIFTY', 'SENSEX'] as const).map(sym => (
            <button key={sym} onClick={() => setActiveSymbol(sym)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all ${
                activeSymbol === sym
                  ? 'bg-violet-500/20 border-violet-400/40 text-violet-200'
                  : 'bg-slate-800/50 border-slate-700/30 text-slate-500 hover:text-slate-300'
              }`}
            >{sym}</button>
          ))}
        </div>
        <div className="flex gap-1">
          {[7, 10, 20].map(d => (
            <button key={d} onClick={() => setReportDays(d)}
              className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${
                reportDays === d
                  ? 'bg-violet-500/20 border-violet-400/40 text-violet-300'
                  : 'bg-slate-800/40 border-slate-700/30 text-slate-500 hover:text-slate-300'
              }`}
            >{d}D</button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-700/30">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-slate-800/50 border-b border-slate-700/30">
              <th className="text-left px-3 py-2 text-slate-400 font-bold">Date</th>
              <th className="text-center px-2 py-2 text-slate-400 font-bold">Direction</th>
              <th className="text-center px-2 py-2 text-slate-400 font-bold">Chg%</th>
              <th className="text-center px-2 py-2 text-slate-400 font-bold hidden sm:table-cell">Day Type</th>
              <th className="text-center px-2 py-2 text-slate-400 font-bold">Accuracy</th>
              <th className="text-left px-2 py-2 text-slate-400 font-bold hidden md:table-cell">Best Strategies</th>
            </tr>
          </thead>
          <tbody>
            {reports.map(rep => {
              const sym = rep.symbols?.[activeSymbol];
              if (!sym) return null;
              const { direction: rawDir, change_pct, strategy_performance, day_classification } = sym;
              const d = dir(rawDir);
              const ds = DIR_STYLES[d];

              const perf = Object.entries(strategy_performance || {})
                .filter(([key]) => isVisibleStrategy(key))
                .map(([, value]) => value);
              const correct = perf.filter(p => p.was_correct === true).length;
              const total   = perf.filter(p => p.was_correct !== null).length;
              const acc     = total > 0 ? Math.round(correct / total * 100) : null;
              const as_     = acc != null ? ACCURACY_STYLE(acc) : null;

              const best = perf.filter(p => p.was_correct === true).slice(0, 3).map(p => p.strategy_name).filter(Boolean);

              return (
                <tr key={rep.date} className="border-b border-slate-800/40 hover:bg-slate-800/20 transition-colors">
                  <td className="px-3 py-2 font-mono text-slate-300 whitespace-nowrap">
                    {new Date(rep.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                  </td>
                  <td className={`px-2 py-2 text-center font-black text-[12px] ${ds.text}`}>{ds.icon} {ds.label}</td>
                  <td className={`px-2 py-2 text-center font-bold tabular-nums ${ds.text}`}>
                    {change_pct > 0 ? '+' : ''}{change_pct.toFixed(2)}%
                  </td>
                  <td className="px-2 py-2 text-center hidden sm:table-cell">
                    {day_classification
                      ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700/40 border border-slate-600/30 text-slate-300 whitespace-nowrap">{day_classification.replace(/_/g, ' ')}</span>
                      : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-2 py-2 text-center">
                    {acc != null && as_ ? (
                      <span className={`font-black text-[12px] ${as_.text}`}>
                        {acc}%<span className="text-[9px] font-normal text-slate-500 ml-1">({correct}/{total})</span>
                      </span>
                    ) : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-2 py-2 hidden md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {best.length > 0
                        ? best.map(s => <span key={s} className="text-[9px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded font-bold">{s}</span>)
                        : <span className="text-slate-600 text-[9px]">—</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
});
DayLogTab.displayName = 'DayLogTab';

// ── Tab: Date-Wise Priority Report ────────────────────────────────────────────

const DateWisePriorityTab = memo<{
  reports: DailyReport[];
  rankings: ReturnType<typeof useObservatory>['rankings'];
}>(({ reports, rankings }) => {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'priority' | 'accuracy' | 'streak'>('priority');

  if (reports.length === 0) {
    return (
      <div className="rounded-xl border border-slate-700/30 bg-slate-900/20 p-8 text-center">
        <p className="text-slate-500 text-sm">No historical reports yet. Date-wise reports generate daily at 15:31 IST.</p>
      </div>
    );
  }

  const uniqueDates = Array.from(new Set(reports.map(r => r.date))).sort().reverse();
  const activeDate = selectedDate || uniqueDates[0];
  const activeReport = reports.find(r => r.date === activeDate);

  return (
    <div className="space-y-4">
      {/* Date Selector */}
      <div className="rounded-xl border border-slate-700/30 bg-slate-900/30 p-3">
        <p className="text-[10px] font-bold text-slate-400/60 uppercase tracking-widest mb-2">Select Date</p>
        <div className="flex flex-wrap gap-1">
          {uniqueDates.map(date => (
            <button key={date}
              onClick={() => setSelectedDate(date)}
              className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                date === activeDate
                  ? 'bg-violet-500/30 border border-violet-400/60 text-violet-200'
                  : 'bg-slate-800/40 border border-slate-600/30 text-slate-400 hover:bg-slate-700/40'
              }`}>
              {new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </button>
          ))}
        </div>
      </div>

      {/* Sort Controls */}
      <div className="rounded-xl border border-slate-700/30 bg-slate-900/30 p-3">
        <p className="text-[10px] font-bold text-slate-400/60 uppercase tracking-widest mb-2">Sort By</p>
        <div className="flex gap-1">
          {(['priority', 'accuracy', 'streak'] as const).map(sort => (
            <button key={sort}
              onClick={() => setSortBy(sort)}
              className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                sort === sortBy
                  ? 'bg-violet-500/30 border border-violet-400/60 text-violet-200'
                  : 'bg-slate-800/40 border border-slate-600/30 text-slate-400 hover:bg-slate-700/40'
              }`}>
              {sort === 'priority' && '⭐ Priority'}
              {sort === 'accuracy' && '🎯 Accuracy'}
              {sort === 'streak' && '🔥 Streak'}
            </button>
          ))}
        </div>
      </div>

      {/* Strategy Performance for Selected Date */}
      {activeReport && rankings ? (
        <div className="space-y-2">
          {/* Overall Stats */}
          <div className="rounded-xl border border-slate-700/30 bg-slate-900/30 p-3">
            <p className="text-[10px] font-bold text-slate-400/60 uppercase tracking-widest mb-2">
              {new Date(activeDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} Overview
            </p>
            <div className="grid grid-cols-3 gap-2 text-center">
              {['NIFTY', 'BANKNIFTY', 'SENSEX'].map(sym => {
                const sym_data = activeReport.symbols?.[sym as 'NIFTY' | 'BANKNIFTY' | 'SENSEX'];
                const dir = sym_data?.direction === 'UP' ? '▲' : sym_data?.direction === 'DOWN' ? '▼' : '◆';
                const dsty = sym_data?.direction === 'UP' ? 'text-emerald-400' : sym_data?.direction === 'DOWN' ? 'text-red-400' : 'text-amber-400';
                const chg = sym_data?.change_pct ?? 0;
                return (
                  <div key={sym} className="rounded-lg bg-slate-800/40 border border-slate-700/30 p-2">
                    <p className="text-[10px] font-bold text-slate-400">{sym}</p>
                    <p className={`text-[14px] font-black ${dsty} mt-1`}>{dir}</p>
                    <p className="text-[10px] text-slate-500 mt-1">{chg > 0 ? '+' : ''}{chg.toFixed(2)}%</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* All Strategies with Priority Ranking */}
          <div className="rounded-xl border border-slate-700/30 bg-slate-900/30 p-3 space-y-2">
            <p className="text-[10px] font-bold text-slate-400/60 uppercase tracking-widest">All Strategies — Priority Sorted</p>
            {rankings.rankings.filter(strat => isVisibleStrategy(strat.strategy_key)).map((strat, idx) => {
              const meta = STRATEGY_DISPLAY[strat.strategy_key];
              const w = strat.weighted_accuracy ?? strat.accuracy;
              const as_ = ACCURACY_STYLE(w);
              const priority = strat.priority ?? 50;
              const isHighPriority = priority >= 90;

              return (
                <div key={strat.strategy_key} className={`rounded-lg border p-2 flex items-center justify-between ${
                  isHighPriority
                    ? 'bg-violet-500/10 border-violet-400/30'
                    : 'bg-slate-800/40 border-slate-700/30'
                }`}>
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-[12px] font-bold text-slate-500">#{idx + 1}</span>
                    <span className="text-[16px]">{meta?.icon ?? '📊'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-bold text-slate-200 truncate">{strat.strategy_name}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <ConfBar value={w} color={as_.bar} height="h-1" />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-right shrink-0 ml-2">
                    {isHighPriority && <span className="text-[9px] px-1 py-0.5 rounded bg-violet-500/20 border border-violet-400/30 text-violet-300 font-bold">⭐</span>}
                    <span className={`text-[11px] font-black tabular-nums ${as_.text}`}>{w.toFixed(0)}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-700/30 bg-slate-900/20 p-6 text-center">
          <p className="text-slate-500 text-sm">Report data not available.</p>
        </div>
      )}
    </div>
  );
});
DateWisePriorityTab.displayName = 'DateWisePriorityTab';

// ── Main Component ────────────────────────────────────────────────────────────

type Tab = 'live' | 'heatmap' | 'rankings' | 'daylog' | 'priority-report';

const TABS: Array<{ id: Tab; icon: string; label: string }> = [
  { id: 'live',            icon: '📡', label: 'Live Today'     },
  { id: 'heatmap',         icon: '🔥', label: 'Heatmap'        },
  { id: 'rankings',        icon: '🏆', label: 'Rankings'       },
  { id: 'priority-report', icon: '📊', label: 'Date & Priority' },
  { id: 'daylog',          icon: '📅', label: 'Day Log'        },
];

const MarketIntelligenceObservatory = memo(() => {
  const [activeTab, setActiveTab] = useState<Tab>('live');
  const [collapsedTabs, setCollapsedTabs] = useState<Record<Tab, boolean>>({
    live: true,
    heatmap: true,
    rankings: true,
    'priority-report': true,
    daylog: true,
  });
  const {
    todaySnapshot,
    historicalReports,
    rankings,
    loading,
    error,
    lastRefreshed,
    reportDays,
    setReportDays,
    refresh,
  } = useObservatory();

  const statsBar = useMemo(() => {
    const daysObserved = historicalReports.length;
    const totalStrategies = Object.keys(STRATEGY_DISPLAY).length;
    const best = rankings?.best_strategy;
    return { daysObserved, totalStrategies, best };
  }, [historicalReports, rankings]);

  const toggleActiveTabCollapse = () => {
    setCollapsedTabs((prev) => ({
      ...prev,
      [activeTab]: !prev[activeTab],
    }));
  };

  return (
    <div className="mt-6 border-2 border-violet-500/35 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-violet-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-violet-500/10">
      {/* Header */}
      <div className="relative rounded-xl bg-violet-500/[0.06] border border-violet-400/25 px-3 sm:px-4 py-2.5 sm:py-3 shadow-sm shadow-violet-500/20 mb-3">
        <div className="absolute top-0 left-4 right-4 h-[1px] bg-gradient-to-r from-transparent via-violet-500/30 to-transparent" />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="w-[3px] h-9 rounded-full bg-gradient-to-b from-violet-400 to-violet-600 shrink-0" />
            <div>
              <h2 className="text-[14px] sm:text-[18px] lg:text-[22px] font-extrabold text-white tracking-tight leading-snug">
                Market Intelligence Observatory
              </h2>
              <p className="text-[10px] text-violet-400/60 font-medium mt-0.5">
                Daily strategy observability · Auto-reports at 15:31 IST · Weekly performance summary
              </p>
            </div>
            <span className="shrink-0 px-2 py-0.5 text-[9px] font-extrabold bg-gradient-to-r from-violet-600/80 to-purple-600/80 rounded-md border border-violet-400/30 text-white whitespace-nowrap">
              🔭 OBSERVABILITY
            </span>
          </div>
          <button onClick={refresh} disabled={loading}
            className="shrink-0 px-2.5 py-1.5 rounded-lg border border-violet-400/30 bg-violet-500/10 text-violet-300 text-[10px] font-bold hover:bg-violet-500/20 transition-all disabled:opacity-40">
            {loading ? '⏳' : '↺'} Refresh
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="rounded-lg border border-slate-700/30 bg-slate-900/30 p-2.5 text-center">
          <p className="text-[18px] font-black text-violet-400">{statsBar.totalStrategies}</p>
          <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Strategies</p>
        </div>
        <div className="rounded-lg border border-slate-700/30 bg-slate-900/30 p-2.5 text-center">
          <p className="text-[18px] font-black text-violet-400">{statsBar.daysObserved}</p>
          <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Days Observed</p>
        </div>
        <div className="rounded-lg border border-slate-700/30 bg-slate-900/30 p-2.5 text-center">
          {statsBar.best ? (
            <>
              <p className="text-[11px] font-black text-emerald-400 truncate">{statsBar.best.strategy_name}</p>
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">
                Best · {(statsBar.best.weighted_accuracy ?? statsBar.best.accuracy).toFixed(0)}%
              </p>
            </>
          ) : (
            <>
              <p className="text-[18px] font-black text-slate-600">—</p>
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Best Strategy</p>
            </>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-3 flex-wrap">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold border transition-all ${
              activeTab === tab.id
                ? 'bg-violet-500/20 border-violet-400/40 text-violet-200 shadow-sm shadow-violet-500/10'
                : 'bg-slate-800/40 border-slate-700/30 text-slate-400 hover:text-slate-200 hover:border-slate-600/40'
            }`}>
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-900/10 p-3 mb-3 text-center">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between rounded-lg border border-slate-700/30 bg-slate-900/30 px-3 py-2">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          {TABS.find(t => t.id === activeTab)?.label} View
        </p>
        <button
          onClick={toggleActiveTabCollapse}
          className="px-2.5 py-1 rounded-md border border-violet-400/30 bg-violet-500/10 text-violet-300 text-[10px] font-bold hover:bg-violet-500/20 transition-all"
          aria-label={collapsedTabs[activeTab] ? 'Show tab details' : 'Hide tab details'}
        >
          {collapsedTabs[activeTab] ? '👁 Show' : '🙈 Hide'}
        </button>
      </div>

      {loading && !todaySnapshot && historicalReports.length === 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[...Array(8)].map((_, i) => <div key={i} className="h-20 bg-slate-800/30 rounded-lg animate-pulse" />)}
        </div>
      ) : collapsedTabs[activeTab] ? (
        null
      ) : (
        <>
          {activeTab === 'live'            && <LiveToday snapshot={todaySnapshot} lastRefreshed={lastRefreshed} />}
          {activeTab === 'heatmap'         && <HeatmapTab reports={historicalReports} />}
          {activeTab === 'rankings'        && <RankingsTab rankings={rankings} />}
          {activeTab === 'priority-report' && <DateWisePriorityTab reports={historicalReports} rankings={rankings} />}
          {activeTab === 'daylog'          && <DayLogTab reports={historicalReports} reportDays={reportDays} setReportDays={setReportDays} />}
        </>
      )}

      {/* Footer */}
      <div className="mt-4 px-3 py-2.5 rounded-lg border border-violet-500/15 bg-violet-500/[0.04] text-center">
        <p className="text-[10px] text-violet-400/50 font-medium">
          🔭 Stored in <code className="text-violet-400/70">backend/data/observatory/</code> ·
          Daily <code className="text-violet-400/70">YYYY-MM-DD.md</code> + JSON ·
          Auto <code className="text-violet-400/70">WEEKLY_SUMMARY.md</code>
        </p>
      </div>
    </div>
  );
});

MarketIntelligenceObservatory.displayName = 'MarketIntelligenceObservatory';
export default MarketIntelligenceObservatory;