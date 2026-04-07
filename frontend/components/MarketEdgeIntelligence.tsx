'use client';

import React, { memo } from 'react';
import { useMarketEdge, type EdgeIndex, type EdgeAction, type OIProfile } from '@/hooks/useMarketEdge';
import SectionTitle from '@/components/SectionTitle';

// ── Helpers ──────────────────────────────────────────────────────────────────

const ACTION_CONFIG: Record<EdgeAction, { label: string; color: string; bg: string; border: string; glow: string; icon: string }> = {
  STRONG_BUY:  { label: 'STRONG BUY',  color: 'text-emerald-300', bg: 'bg-emerald-500/20', border: 'border-emerald-400/60', glow: 'shadow-emerald-500/30', icon: '🟢' },
  BUY:         { label: 'BUY',         color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-400/40', glow: 'shadow-emerald-500/15', icon: '🟢' },
  NEUTRAL:     { label: 'NEUTRAL',     color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-400/40',   glow: 'shadow-amber-500/15',   icon: '🟡' },
  SELL:        { label: 'SELL',        color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-400/40',     glow: 'shadow-red-500/15',     icon: '🔴' },
  STRONG_SELL: { label: 'STRONG SELL', color: 'text-red-300',     bg: 'bg-red-500/20',     border: 'border-red-400/60',     glow: 'shadow-red-500/30',     icon: '🔴' },
};

const PROFILE_CONFIG: Record<OIProfile, { label: string; color: string; bg: string; icon: string }> = {
  LONG_BUILDUP:    { label: 'LONG BUILDUP',    color: 'text-emerald-300', bg: 'bg-emerald-500/15', icon: '📈' },
  SHORT_COVERING:  { label: 'SHORT COVERING',  color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: '🔄' },
  SHORT_BUILDUP:   { label: 'SHORT BUILDUP',   color: 'text-red-300',     bg: 'bg-red-500/15',     icon: '📉' },
  LONG_UNWINDING:  { label: 'LONG UNWINDING',  color: 'text-red-400',     bg: 'bg-red-500/10',     icon: '🔄' },
  NEUTRAL:         { label: 'NEUTRAL',         color: 'text-slate-400',   bg: 'bg-slate-500/10',   icon: '➖' },
};

const SIGNAL_NAMES: Record<string, { label: string; icon: string }> = {
  oi_spurts:      { label: 'OI Spurts',         icon: '🔥' },
  iv_estimation:  { label: 'IV Level',          icon: '📊' },
  iv_rank:        { label: 'IV Rank',           icon: '📏' },
  futures_oi:     { label: 'Futures OI',        icon: '📈' },
  futures_basis:  { label: 'Futures Basis',     icon: '💰' },
};

function formatNumber(n: number | undefined | null): string {
  if (n == null) return '—';
  if (Math.abs(n) >= 10_000_000) return (n / 10_000_000).toFixed(2) + ' Cr';
  if (Math.abs(n) >= 100_000) return (n / 100_000).toFixed(2) + ' L';
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toFixed(0);
}

function formatPrice(n: number | undefined | null): string {
  if (n == null || n === 0) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

// ── Signal Bar ──────────────────────────────────────────────────────────────

const SignalBar = memo<{ name: string; score: number; signal: string; label: string; weight: number }>(
  ({ name, score, signal, label, weight }) => {
    const info = SIGNAL_NAMES[name] || { label: name, icon: '•' };
    const pct = Math.min(100, Math.abs(score) * 100);
    const isBull = score > 0;
    const barColor = score > 0.3 ? 'bg-emerald-500' : score > 0 ? 'bg-emerald-500/70' : score < -0.3 ? 'bg-red-500' : score < 0 ? 'bg-red-500/70' : 'bg-slate-500';
    const sigColor = signal === 'BULL' ? 'text-emerald-400' : signal === 'BEAR' ? 'text-red-400' : 'text-amber-400';

    return (
      <div className="py-1.5 border-b border-slate-700/30 last:border-b-0">
        <div className="flex items-center justify-between mb-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs">{info.icon}</span>
            <span className="text-[10px] sm:text-xs font-semibold text-slate-300 truncate">{info.label}</span>
            <span className="text-[9px] text-slate-500">({(weight * 100).toFixed(0)}%)</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`text-[10px] font-bold ${sigColor}`}>{signal}</span>
            <span className={`text-[10px] font-mono ${isBull ? 'text-emerald-400' : score < 0 ? 'text-red-400' : 'text-slate-400'}`}>
              {score > 0 ? '+' : ''}{score.toFixed(2)}
            </span>
          </div>
        </div>
        <div className="relative h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
          <div
            className={`absolute top-0 ${isBull ? 'left-1/2' : 'right-1/2'} h-full ${barColor} rounded-full`}
            style={{ width: `${pct / 2}%` }}
          />
          <div className="absolute top-0 left-1/2 w-px h-full bg-slate-500/60" />
        </div>
        <p className="text-[9px] text-slate-500 mt-0.5 truncate">{label}</p>
      </div>
    );
  }
);
SignalBar.displayName = 'SignalBar';

// ── IV Gauge ─────────────────────────────────────────────────────────────────

const IVGauge = memo<{ ivRank: number; ivPercentile: number; ivEst: number; vix: number }>(
  ({ ivRank, ivPercentile, ivEst, vix }) => {
    const rankColor = ivRank >= 80 ? 'text-red-400' : ivRank >= 60 ? 'text-orange-400' : ivRank >= 40 ? 'text-amber-400' : ivRank >= 20 ? 'text-emerald-400' : 'text-cyan-400';
    const rankBg = ivRank >= 80 ? 'from-red-500' : ivRank >= 60 ? 'from-orange-500' : ivRank >= 40 ? 'from-amber-500' : ivRank >= 20 ? 'from-emerald-500' : 'from-cyan-500';
    const rankLabel = ivRank >= 80 ? 'EXTREME' : ivRank >= 60 ? 'ELEVATED' : ivRank >= 40 ? 'FAIR' : ivRank >= 20 ? 'LOW' : 'VERY LOW';

    return (
      <div className="rounded-lg bg-gradient-to-br from-slate-800/60 to-slate-800/30 border border-slate-600/30 p-2.5">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-xs">📊</span>
          <span className="text-[10px] sm:text-xs font-bold text-white">IV + IV Rank</span>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div className="text-center">
            <span className="text-[9px] text-slate-500 block">IV Estimate</span>
            <span className="text-sm font-bold font-mono text-cyan-400">{ivEst > 0 ? `${ivEst.toFixed(1)}%` : '—'}</span>
          </div>
          <div className="text-center">
            <span className="text-[9px] text-slate-500 block">India VIX</span>
            <span className="text-sm font-bold font-mono text-purple-400">{vix > 0 ? vix.toFixed(2) : '—'}</span>
          </div>
        </div>
        {/* IV Rank Bar */}
        <div className="mb-1.5">
          <div className="flex justify-between items-center mb-1">
            <span className="text-[9px] text-slate-500">IV Rank</span>
            <div className="flex items-center gap-1.5">
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${ivRank >= 60 ? 'bg-red-500/20 text-red-300 border border-red-400/30' : ivRank <= 30 ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30' : 'bg-amber-500/20 text-amber-300 border border-amber-400/30'}`}>
                {rankLabel}
              </span>
              <span className={`text-xs font-bold font-mono ${rankColor}`}>{ivRank.toFixed(0)}</span>
            </div>
          </div>
          <div className="h-2 bg-slate-700/50 rounded-full overflow-hidden">
            <div
              className={`h-full bg-gradient-to-r ${rankBg} to-transparent rounded-full`}
              style={{ width: `${ivRank}%` }}
            />
          </div>
          <div className="flex justify-between text-[8px] text-slate-600 mt-0.5">
            <span>0 (Cheap)</span>
            <span>50</span>
            <span>100 (Expensive)</span>
          </div>
        </div>
        {/* IV Percentile */}
        <div className="flex justify-between items-center pt-1 border-t border-slate-700/30">
          <span className="text-[9px] text-slate-500">IV Percentile</span>
          <span className={`text-[10px] font-bold font-mono ${ivPercentile >= 70 ? 'text-red-400' : ivPercentile <= 30 ? 'text-emerald-400' : 'text-amber-400'}`}>
            {ivPercentile.toFixed(0)}%
          </span>
        </div>
      </div>
    );
  }
);
IVGauge.displayName = 'IVGauge';

// ── Edge Card (one per index) ───────────────────────────────────────────────

const EdgeCard = memo<{ data: EdgeIndex | null; name: string }>(({ data, name }) => {
  if (!data) {
    return (
      <div className="rounded-2xl border border-slate-700/50 bg-gradient-to-br from-slate-800/60 to-slate-900/60 p-4">
        <div className="h-5 w-32 bg-slate-700/60 rounded mb-3" />
        <div className="h-12 w-full bg-slate-700/40 rounded-xl mb-3" />
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <div key={i} className="h-3 bg-slate-700/30 rounded" />)}
        </div>
      </div>
    );
  }

  const actionCfg = ACTION_CONFIG[data.action] || ACTION_CONFIG.NEUTRAL;
  const profileCfg = PROFILE_CONFIG[data.oiProfile] || PROFILE_CONFIG.NEUTRAL;
  const isLive = data.dataSource === 'LIVE';
  const fut = data.futures;
  const m = data.metrics;

  const isStrongAction = (data.action === 'STRONG_BUY' || data.action === 'STRONG_SELL') && data.confidence >= 60;
  const hlBull = 'ring-1 ring-emerald-400/70 bg-emerald-500/15 shadow-sm shadow-emerald-500/30 px-1.5 py-0.5 rounded';
  const hlBear = 'ring-1 ring-red-400/70 bg-red-500/15 shadow-sm shadow-red-500/30 px-1.5 py-0.5 rounded';
  const dirHl = data.direction === 'BULLISH' ? hlBull : data.direction === 'BEARISH' ? hlBear : '';

  const cardBorder =
    data.action === 'STRONG_BUY' ? 'border-emerald-400/50 shadow-lg shadow-emerald-500/20' :
    data.action === 'BUY' ? 'border-emerald-500/30' :
    data.action === 'STRONG_SELL' ? 'border-red-400/50 shadow-lg shadow-red-500/20' :
    data.action === 'SELL' ? 'border-red-500/30' :
    'border-slate-600/40';

  const confColor = data.confidence >= 70 ? 'from-emerald-500 to-emerald-400' : data.confidence >= 40 ? 'from-amber-500 to-amber-400' : 'from-red-500 to-red-400';

  return (
    <div className={`rounded-2xl border ${cardBorder} bg-gradient-to-br from-slate-800/70 via-slate-900/70 to-slate-800/50 backdrop-blur-sm p-3 sm:p-4`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm sm:text-base font-bold text-white">{name}</h3>
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${isLive ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-600/30 text-slate-400 border border-slate-500/20'}`}>
            {isLive ? '● LIVE' : '○ CLOSED'}
          </span>
        </div>
        <span className={`inline-flex items-center px-2.5 py-1 rounded-lg border ${m.changePct >= 0 ? 'border-emerald-400/60 bg-emerald-500/10 shadow-sm shadow-emerald-500/20' : 'border-red-400/60 bg-red-500/10 shadow-sm shadow-red-500/20'}`}>
          <span className={`text-lg font-mono font-bold ${m.changePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            ₹{formatPrice(m.price)}
          </span>
        </span>
      </div>

      {/* Action Badge + Confidence */}
      <div className={`rounded-xl ${actionCfg.bg} border ${actionCfg.border} p-2.5 mb-3 ${actionCfg.glow}`}>
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <span className="text-base">{actionCfg.icon}</span>
            <span className={`text-sm sm:text-base font-extrabold ${actionCfg.color} tracking-tight ${isStrongAction ? dirHl : ''}`}>
              {actionCfg.label}
            </span>
          </div>
          <span className={`text-xs font-mono font-bold ${actionCfg.color} ${isStrongAction ? dirHl : ''}`}>
            {data.confidence}%
          </span>
        </div>
        <div className="h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
          <div className={`h-full bg-gradient-to-r ${confColor} rounded-full`} style={{ width: `${data.confidence}%` }} />
        </div>
      </div>

      {/* OI Profile Badge */}
      <div className={`flex items-center justify-between rounded-lg ${profileCfg.bg} border border-slate-700/30 px-2.5 py-1.5 mb-3`}>
        <div className="flex items-center gap-2">
          <span className="text-xs">{profileCfg.icon}</span>
          <span className={`text-[10px] sm:text-xs font-bold ${profileCfg.color} ${data.oiProfile === 'LONG_BUILDUP' || data.oiProfile === 'SHORT_BUILDUP' ? dirHl : ''}`}>
            {profileCfg.label}
          </span>
        </div>
        <span className={`text-[10px] font-mono ${m.changePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {m.changePct >= 0 ? '+' : ''}{m.changePct.toFixed(2)}%
        </span>
      </div>

      {/* OI Spurts Alert */}
      {data.signals.oi_spurts.extra && (data.signals.oi_spurts.extra as Record<string, number>).peakSpurt >= 1.5 && (
        <div className={`rounded-lg border p-2 mb-3 ${data.signals.oi_spurts.score > 0 ? 'bg-emerald-500/10 border-emerald-400/40' : data.signals.oi_spurts.score < 0 ? 'bg-red-500/10 border-red-400/40' : 'bg-amber-500/10 border-amber-400/40'}`}>
          <div className="flex items-center gap-1.5">
            <span className="text-sm">🔥</span>
            <span className={`text-[10px] sm:text-xs font-bold ${data.signals.oi_spurts.score > 0 ? 'text-emerald-300' : data.signals.oi_spurts.score < 0 ? 'text-red-300' : 'text-amber-300'}`}>
              OI SPURT DETECTED — {((data.signals.oi_spurts.extra as Record<string, number>).peakSpurt).toFixed(1)}x above average
            </span>
          </div>
          <p className="text-[9px] text-slate-400 mt-0.5 ml-6">{data.signals.oi_spurts.label}</p>
        </div>
      )}

      {/* IV + IV Rank Section */}
      <IVGauge ivRank={m.ivRank} ivPercentile={m.ivPercentile} ivEst={m.ivEstimate} vix={m.vix} />

      {/* Futures Section */}
      {fut.price > 0 && (
        <div className="rounded-lg bg-slate-800/50 border border-slate-600/30 p-2.5 mt-3">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-xs">📈</span>
            <span className="text-[10px] sm:text-xs font-bold text-white">Futures — {fut.contractName || 'Near Month'}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <div className="flex justify-between">
              <span className="text-[10px] text-slate-400">Price</span>
              <span className={`text-[10px] sm:text-xs font-mono font-bold ${fut.changePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                ₹{formatPrice(fut.price)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[10px] text-slate-400">Change</span>
              <span className={`text-[10px] sm:text-xs font-mono font-bold ${fut.changePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {fut.changePct >= 0 ? '+' : ''}{fut.changePct.toFixed(2)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[10px] text-slate-400">Basis</span>
              <span className={`text-[10px] sm:text-xs font-mono font-bold ${fut.basis >= 0 ? 'text-emerald-400' : 'text-red-400'} ${Math.abs(fut.basisPct) >= 0.2 ? dirHl : ''}`}>
                {fut.basis >= 0 ? '+' : ''}{fut.basis.toFixed(2)} ({fut.basisPct.toFixed(3)}%)
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[10px] text-slate-400">Fut OI</span>
              <span className="text-[10px] sm:text-xs font-mono font-bold text-cyan-400">{formatNumber(fut.oi)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[10px] text-slate-400">Fut Vol</span>
              <span className="text-[10px] sm:text-xs font-mono font-bold text-purple-400">{formatNumber(fut.volume)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-3 gap-1.5 mt-3 mb-3">
        <div className="rounded-lg bg-slate-800/40 border border-slate-700/20 p-1.5 text-center">
          <span className="text-[9px] text-slate-500 block">Total OI</span>
          <span className="text-xs font-bold font-mono text-cyan-400">{formatNumber(m.totalOI)}</span>
        </div>
        <div className="rounded-lg bg-slate-800/40 border border-slate-700/20 p-1.5 text-center">
          <span className="text-[9px] text-slate-500 block">Call OI</span>
          <span className="text-xs font-bold font-mono text-red-400">{formatNumber(m.callOI)}</span>
        </div>
        <div className="rounded-lg bg-slate-800/40 border border-slate-700/20 p-1.5 text-center">
          <span className="text-[9px] text-slate-500 block">Put OI</span>
          <span className="text-xs font-bold font-mono text-emerald-400">{formatNumber(m.putOI)}</span>
        </div>
      </div>

      {/* 5-Signal Breakdown */}
      <div className="rounded-lg bg-slate-800/30 border border-slate-700/20 p-2.5">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-xs">📡</span>
          <span className="text-[10px] sm:text-xs font-bold text-white">5-Signal Scoring Engine</span>
          <span className="text-[9px] text-slate-500 ml-auto font-mono">
            Score: <span className={data.rawScore > 0 ? 'text-emerald-400' : data.rawScore < 0 ? 'text-red-400' : 'text-amber-400'}>
              {data.rawScore > 0 ? '+' : ''}{data.rawScore.toFixed(3)}
            </span>
          </span>
        </div>
        {Object.entries(data.signals).map(([key, sig]) => (
          <SignalBar key={key} name={key} score={sig.score} signal={sig.signal} label={sig.label} weight={sig.weight} />
        ))}
      </div>
    </div>
  );
});
EdgeCard.displayName = 'EdgeCard';

// ── Main Component ──────────────────────────────────────────────────────────

const MarketEdgeIntelligence = memo(() => {
  const { edgeData, isConnected } = useMarketEdge();

  // Fixed section styling — no dynamic color swaps that cause flashing
  const sectionBorder = 'border-teal-500/30';
  const sectionBg = 'from-teal-950/20 via-dark-card/50 to-dark-elevated/40';
  const sectionGlow = 'shadow-md';

  return (
    <div className={`mt-6 sm:mt-6 border-2 ${sectionBorder} rounded-2xl p-3 sm:p-4 bg-gradient-to-br ${sectionBg} backdrop-blur-sm ${sectionGlow}`}>
      <div className="flex flex-col gap-1 mb-3 sm:mb-4">
        <SectionTitle
          title="MarketEdge Intelligence"
          subtitle="OI Spurts × IV + IV Rank × Futures OI × Futures Basis • 5-Factor Derivatives Engine"
          accentColor="teal"
          badge={
            <span className="relative inline-flex items-center px-2 py-0.5 text-[9px] font-bold bg-gradient-to-r from-teal-600/80 to-cyan-600/80 rounded-md shadow-lg border border-teal-400/30 whitespace-nowrap leading-none">
              <span className="relative z-10 inline-flex items-center gap-0.5">
                <span>📈</span>
                <span className="bg-gradient-to-r from-white via-teal-100 to-white bg-clip-text text-transparent font-extrabold">EDGE ENGINE</span>
              </span>
            </span>
          }
          rightContent={
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 shadow-sm shadow-emerald-500' : 'bg-red-500'}`} />
            </div>
          }
        />
      </div>

      {/* Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3 sm:gap-4">
        <EdgeCard data={edgeData.NIFTY} name="NIFTY 50" />
        <EdgeCard data={edgeData.BANKNIFTY} name="BANK NIFTY" />
        <EdgeCard data={edgeData.SENSEX} name="SENSEX" />
      </div>

      {/* Bottom Legend */}
      <div className="mt-3 pt-2 border-t border-slate-700/30">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[9px] text-slate-500">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500" /> Long Buildup
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500/60" /> Short Covering
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-500" /> Short Buildup
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-500/60" /> Long Unwinding
          </span>
          <span className="text-slate-600">|</span>
          <span>🔥 OI Spurts • 📊 IV • 📏 IV Rank • 📈 Fut OI • 💰 Basis</span>
        </div>
      </div>
    </div>
  );
});
MarketEdgeIntelligence.displayName = 'MarketEdgeIntelligence';

export default MarketEdgeIntelligence;
