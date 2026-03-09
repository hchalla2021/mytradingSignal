'use client';

import React, { memo } from 'react';
import { useOpeningRangeRealtime } from '@/hooks/useOpeningRangeRealtime';

// ─── Signal config (module-level, never recreated) ──────────────────────────
const SIG: Record<string, { label: string; color: string; bg: string; border: string; bar: string; icon: string }> = {
  ORB_BUY_BREAKOUT:  { label: 'BREAKOUT BUY',   color: 'text-emerald-300', bg: 'bg-emerald-500/10', border: 'border-emerald-500/50',  bar: 'bg-emerald-500', icon: '▲▲' },
  ORB_SELL_BREAKDOWN:{ label: 'BREAKDOWN SELL',  color: 'text-red-300',     bg: 'bg-red-500/10',     border: 'border-red-500/50',      bar: 'bg-red-500',     icon: '▼▼' },
  ORB_NEUTRAL:       { label: 'INSIDE RANGE',    color: 'text-amber-300',   bg: 'bg-amber-500/8',    border: 'border-amber-500/40',    bar: 'bg-amber-500',   icon: '◆'  },
};

function sig(k?: string)  { return SIG[(k ?? 'ORB_NEUTRAL').toUpperCase()] ?? SIG.ORB_NEUTRAL; }
function fmt(n?: number)  { return (n ?? 0) > 0 ? (n!).toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—'; }

// ─── Component ──────────────────────────────────────────────────────────────
const ORBCard = memo<{ symbol: string; name: string }>(({ symbol, name }) => {
  const { data, loading, error, flash, refetch } = useOpeningRangeRealtime(symbol);

  // ── 5-Min Prediction (must be before any early return — hooks rule) ────
  const isBuy   = data?.orb_position === 'ABOVE_HIGH';
  const isSell  = data?.orb_position === 'BELOW_LOW';

  const pred5m = React.useMemo(() => {
    if (!data) return { isLong: false, isShort: false, adjConf: 35, confirms: [] as string[], score: 0 };

    const conf   = data.orb_confidence ?? 0;
    const str    = data.orb_strength ?? 0;
    const range  = data.orb_range || 1;
    const distH  = Math.abs(data.distance_to_orb_high ?? 0);
    const distL  = Math.abs(data.distance_to_orb_low ?? 0);
    const rr     = data.orb_reward_risk_ratio ?? 0;

    // 5-factor weighted score: signal(30) + strength(25) + confidence(20) + proximity(15) + R:R(10)
    let score = 0;
    score += isBuy ? 30 : isSell ? -30 : 0;
    score += (str / 90) * 25 * (isBuy ? 1 : isSell ? -1 : (str > 50 ? 0.3 : -0.1));
    score += ((conf - 45) / 40) * 20 * (isBuy ? 1 : isSell ? -1 : 0);
    const proxBias = (distH + distL) > 0 ? (distL - distH) / (distH + distL) : 0;
    score += proxBias * 15;
    score += Math.min(rr, 3) / 3 * 10 * (isBuy ? 1 : isSell ? -1 : 0);

    const isLong  = score > 8;
    const isShort = score < -8;
    const adjConf = Math.min(92, Math.max(35, Math.round(50 + Math.abs(score) * 0.85)));

    const confirms: string[] = [];
    if (str >= 60)   confirms.push('✓ Strong breakout');
    if (conf >= 70)  confirms.push('✓ High confidence');
    if (rr >= 2)     confirms.push('✓ Good R:R');
    if (range > 0 && (distH / range < 0.15 || distL / range < 0.15)) confirms.push('✓ Near level');
    if (isBuy && proxBias > 0.3)  confirms.push('✓ Bullish bias');
    if (isSell && proxBias < -0.3) confirms.push('✓ Bearish bias');

    return { isLong, isShort, adjConf, confirms, score };
  }, [data?.orb_confidence, data?.orb_strength, data?.orb_range, data?.distance_to_orb_high,
      data?.distance_to_orb_low, data?.orb_reward_risk_ratio, data, isBuy, isSell]);

  // ── Loading ─────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="bg-[#0b1120]/80 border border-slate-700/50 rounded-xl p-4 animate-pulse min-h-[280px]">
      <div className="flex justify-between mb-3"><div className="h-4 bg-slate-800/60 rounded w-20" /><div className="h-4 bg-slate-800/60 rounded w-16" /></div>
      <div className="h-10 bg-slate-800/40 rounded-lg mb-3" />
      <div className="h-1.5 bg-slate-800/40 rounded-full mb-4" />
      <div className="space-y-1.5">{[1,2,3,4].map(i => <div key={i} className="h-5 bg-slate-800/30 rounded" />)}</div>
    </div>
  );

  // ── Error ───────────────────────────────────────────────────────────────
  if (error || !data) return (
    <div className="bg-[#0b1120]/80 border border-rose-500/30 rounded-xl p-5 min-h-[180px] flex flex-col items-center justify-center gap-2">
      <p className="text-sm font-bold text-rose-300">{name}</p>
      <p className="text-xs text-rose-400/70">{error ?? 'No data'}</p>
      <button onClick={refetch} className="text-[10px] px-3 py-1 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25">Retry</button>
    </div>
  );

  // ── Derived ─────────────────────────────────────────────────────────────
  const s       = sig(data.orb_signal);
  const isLive  = data.status === 'LIVE' || data.status === 'ACTIVE';
  const posColor = isBuy ? 'text-emerald-400' : isSell ? 'text-red-400' : 'text-amber-400';
  const posLabel = isBuy ? 'Above High' : isSell ? 'Below Low' : 'Inside Range';
  const price   = data.current_price ?? 0;
  const rrr     = data.orb_reward_risk_ratio;

  return (
    <div className={`rounded-xl border ${s.border} bg-[#0b1120]/80 overflow-hidden ${flash ? 'ring-1 ring-white/20' : ''}`}>

      {/* ── HEADER ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-800/40 border-b border-slate-700/40">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-white">{name}</span>
          {isLive && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-[9px] font-bold text-emerald-400">LIVE</span>
            </span>
          )}
        </div>
        <span className="text-xs font-black text-white tabular-nums">
          {price > 0 ? `₹${fmt(price)}` : '—'}
        </span>
      </div>

      <div className="p-3 space-y-3">

        {/* ── SIGNAL + CONFIDENCE (single row) ─────────────────────── */}
        <div className="flex items-center gap-3">
          <div className={`flex-shrink-0 rounded-lg border ${s.border} ${s.bg} px-3 py-2 text-center min-w-[110px]`}>
            <div className={`text-base font-black ${s.color}`}>{s.icon} {s.label}</div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Confidence</span>
              <span className={`text-sm font-black tabular-nums ${s.color}`}>{data.orb_confidence}%</span>
            </div>
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${s.bar}`} style={{ width: `${data.orb_confidence}%` }} />
            </div>
          </div>
        </div>

        {/* ── ORB LEVELS (High / Low / Range compact) ──────────────── */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-lg px-2.5 py-2">
            <div className="text-[8px] text-emerald-400/70 font-bold uppercase tracking-wider mb-0.5">ORB High</div>
            <div className="text-[11px] font-bold text-emerald-400 tabular-nums">{data.orb_high > 0 ? `₹${fmt(data.orb_high)}` : '—'}</div>
          </div>
          <div className="bg-red-500/5 border border-red-500/15 rounded-lg px-2.5 py-2">
            <div className="text-[8px] text-red-400/70 font-bold uppercase tracking-wider mb-0.5">ORB Low</div>
            <div className="text-[11px] font-bold text-red-400 tabular-nums">{data.orb_low > 0 ? `₹${fmt(data.orb_low)}` : '—'}</div>
          </div>
          <div className="bg-slate-800/30 border border-slate-700/30 rounded-lg px-2.5 py-2">
            <div className="text-[8px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">Range</div>
            <div className="text-[11px] font-bold text-cyan-400 tabular-nums">{data.orb_range > 0 ? `₹${fmt(data.orb_range)}` : '—'}</div>
          </div>
        </div>

        {/* ── POSITION + STRENGTH + R/R (compact row) ─────────────── */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-slate-800/30 border border-slate-700/30 rounded-lg px-2.5 py-2">
            <div className="text-[8px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">Position</div>
            <div className={`text-[11px] font-bold ${posColor}`}>{posLabel}</div>
          </div>
          <div className="bg-slate-800/30 border border-slate-700/30 rounded-lg px-2.5 py-2">
            <div className="text-[8px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">Strength</div>
            <div className={`text-[11px] font-bold ${s.color}`}>{data.orb_strength}%</div>
          </div>
          <div className="bg-slate-800/30 border border-slate-700/30 rounded-lg px-2.5 py-2">
            <div className="text-[8px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">R/R Ratio</div>
            <div className={`text-[11px] font-bold ${(rrr ?? 0) >= 2 ? 'text-emerald-400' : (rrr ?? 0) >= 1 ? 'text-amber-400' : 'text-slate-500'}`}>
              {rrr ? `${rrr.toFixed(1)}:1` : '—'}
            </div>
          </div>
        </div>

        {/* ── DISTANCE TO LEVELS ───────────────────────────────────── */}
        <div className="bg-slate-800/20 border border-slate-700/30 rounded-lg p-2.5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Distance to Levels</span>
            <span className="text-[9px] text-slate-600">{data.orb_status}</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-slate-500 w-[50px]">To High</span>
              <div className="flex-1 h-[6px] bg-slate-900 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500/70 rounded-full" style={{ width: `${Math.min(100, Math.abs(data.distance_to_orb_high / (data.orb_range || 1)) * 50)}%` }} />
              </div>
              <span className={`text-[9px] font-bold tabular-nums w-[55px] text-right ${isBuy ? 'text-emerald-400' : 'text-slate-500'}`}>
                ₹{Math.abs(data.distance_to_orb_high).toFixed(0)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-slate-500 w-[50px]">To Low</span>
              <div className="flex-1 h-[6px] bg-slate-900 rounded-full overflow-hidden">
                <div className="h-full bg-red-500/70 rounded-full" style={{ width: `${Math.min(100, Math.abs(data.distance_to_orb_low / (data.orb_range || 1)) * 50)}%` }} />
              </div>
              <span className={`text-[9px] font-bold tabular-nums w-[55px] text-right ${isSell ? 'text-red-400' : 'text-slate-500'}`}>
                ₹{Math.abs(data.distance_to_orb_low).toFixed(0)}
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-700/30">
            <span className="text-[9px] text-slate-500">Risk per trade</span>
            <span className="text-[10px] font-bold text-orange-400 tabular-nums">₹{fmt(data.orb_risk)}</span>
          </div>
        </div>

        {/* ── 5-MIN PREDICTION ─────────────────────────────────────── */}
        {(() => {
          const { isLong, isShort, adjConf, confirms } = pred5m;
          const predDir  = isLong ? 'LONG' : isShort ? 'SHORT' : 'FLAT';
          const dirIcon  = isLong ? '▲' : isShort ? '▼' : '─';
          const dc       = isLong ? 'text-emerald-300' : isShort ? 'text-red-300' : 'text-amber-300';
          const db       = isLong ? 'border-emerald-500/30' : isShort ? 'border-red-500/30' : 'border-amber-500/25';
          const dbg      = isLong ? 'bg-emerald-500/[0.06]' : isShort ? 'bg-red-500/[0.06]' : 'bg-amber-500/[0.04]';
          const bar      = isLong ? 'bg-emerald-500' : isShort ? 'bg-red-500' : 'bg-amber-500';
          const bullPct  = isLong ? Math.round(adjConf * 1.05) : isShort ? Math.round(100 - adjConf * 1.05) : 50;
          const bearPct  = 100 - bullPct;

          return (
            <div className="rounded-lg border border-white/[0.06] bg-[#0d1117]/80 overflow-hidden">
              <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
              <div className="px-3 py-2.5 space-y-2.5">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">5 Min Prediction</span>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${dc} bg-black/40 border border-white/[0.05] tabular-nums`}>{adjConf}%</span>
                </div>

                {/* Direction + Confidence bar */}
                <div className={`rounded-lg border ${db} ${dbg} px-3 py-2`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={`text-sm font-black ${dc}`}>{dirIcon} {predDir}</span>
                    <span className="text-[9px] text-slate-500">
                      {isLong ? 'Breakout momentum' : isShort ? 'Breakdown pressure' : 'Waiting for break'}
                    </span>
                  </div>
                  <div className="h-[3px] bg-slate-800 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-500 ${bar}`} style={{ width: `${adjConf}%` }} />
                  </div>
                </div>

                {/* Probability bars */}
                <div className="flex items-center gap-1 h-5 bg-black/30 rounded overflow-hidden">
                  <div className="h-full rounded-l transition-all duration-500"
                       style={{ width: `${bullPct}%`, background: 'linear-gradient(to right, #059669, #10b981)', opacity: isLong ? 0.85 : 0.2 }} />
                  <div className="h-full rounded-r transition-all duration-500"
                       style={{ width: `${bearPct}%`, background: 'linear-gradient(to right, #dc2626, #ef4444)', opacity: isShort ? 0.85 : 0.2 }} />
                </div>
                <div className="flex justify-between text-[8px] font-bold tabular-nums">
                  <span className="text-emerald-400/80">Bull {bullPct}%</span>
                  <span className="text-red-400/80">Bear {bearPct}%</span>
                </div>

                {/* Confirmations */}
                {confirms.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {confirms.map((c, i) => (
                      <span key={i} className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${
                        isLong ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25' :
                        isShort ? 'bg-red-500/15 text-red-300 border border-red-500/25' :
                        'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                      }`}>{c}</span>
                    ))}
                  </div>
                )}

                {/* Early signal alert */}
                {adjConf >= 75 && (isLong || isShort) && (
                  <div className={`rounded px-2 py-1.5 border-t-2 ${db} text-center`}>
                    <span className={`text-[10px] font-bold ${dc}`}>
                      ⚡ {adjConf >= 85 ? 'STRONG' : 'CONFIRMED'} {predDir} Signal
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── FOOTER ────────────────────────────────────────────────── */}
      <div className="px-4 py-1.5 border-t border-slate-700/30 flex justify-between items-center">
        <span className="text-[9px] text-slate-600 tabular-nums">
          {data.timestamp ? new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
        </span>
        <span className={`text-[9px] font-bold ${isLive ? 'text-emerald-500' : 'text-slate-600'}`}>
          {isLive ? '● Live' : '○ Cached'}
        </span>
      </div>
    </div>
  );
});

ORBCard.displayName = 'ORBCard';
export default ORBCard;
