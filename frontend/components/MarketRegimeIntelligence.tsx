'use client';

import React, { memo } from 'react';
import { useMarketRegime, type RegimeIndex, type RegimeType, type TrendStrength, type TradeApproach } from '@/hooks/useMarketRegime';
import type { MarketData } from '@/hooks/useMarketSocket';
import type { VIXData } from '@/hooks/useIndiaVIX';
import SectionTitle from '@/components/SectionTitle';

// ── Regime visual config ────────────────────────────────────────────────────

const REGIME_CONFIG: Record<RegimeType, {
  label: string;
  shortLabel: string;
  color: string;
  bg: string;
  border: string;
  glow: string;
  icon: string;
  barColor: string;
}> = {
  STRONG_TRENDING_BULLISH: {
    label: 'STRONG TRENDING — BULLISH',
    shortLabel: 'STRONG BULL TREND',
    color: 'text-emerald-300',
    bg: 'bg-emerald-500/20',
    border: 'border-emerald-400/60',
    glow: 'shadow-emerald-500/30',
    icon: '🟢',
    barColor: 'from-emerald-400 to-emerald-600',
  },
  TRENDING_BULLISH: {
    label: 'TRENDING — BULLISH',
    shortLabel: 'BULL TREND',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-400/40',
    glow: 'shadow-emerald-500/15',
    icon: '📈',
    barColor: 'from-emerald-400 to-emerald-500',
  },
  STRONG_TRENDING_BEARISH: {
    label: 'STRONG TRENDING — BEARISH',
    shortLabel: 'STRONG BEAR TREND',
    color: 'text-red-300',
    bg: 'bg-red-500/20',
    border: 'border-red-400/60',
    glow: 'shadow-red-500/30',
    icon: '🔴',
    barColor: 'from-red-400 to-red-600',
  },
  TRENDING_BEARISH: {
    label: 'TRENDING — BEARISH',
    shortLabel: 'BEAR TREND',
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-400/40',
    glow: 'shadow-red-500/15',
    icon: '📉',
    barColor: 'from-red-400 to-red-500',
  },
  SIDEWAYS: {
    label: 'SIDEWAYS / RANGEBOUND',
    shortLabel: 'SIDEWAYS',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-400/40',
    glow: 'shadow-amber-500/15',
    icon: '↔️',
    barColor: 'from-amber-400 to-amber-500',
  },
  NEUTRAL: {
    label: 'NEUTRAL — NO CLEAR TREND',
    shortLabel: 'NEUTRAL',
    color: 'text-slate-400',
    bg: 'bg-slate-500/10',
    border: 'border-slate-400/40',
    glow: 'shadow-slate-500/15',
    icon: '⚖️',
    barColor: 'from-slate-400 to-slate-500',
  },
};

const APPROACH_CONFIG: Record<TradeApproach, { label: string; icon: string; color: string }> = {
  DIRECTIONAL_ONLY: { label: 'Directional Only — Ride the Trend', icon: '🎯', color: 'text-emerald-400' },
  DIRECTIONAL_BIAS: { label: 'Directional Bias — Favour Trend Side', icon: '📐', color: 'text-blue-400' },
  WAIT_AND_WATCH:   { label: 'Wait & Watch — No Clear Setup', icon: '👀', color: 'text-amber-400' },
  RANGE_TRADE:      { label: 'Range Trade — S/R Bounces Only', icon: '📊', color: 'text-purple-400' },
};

const FACTOR_NAMES: Record<string, { label: string; icon: string }> = {
  directional_move:   { label: 'Directional Move',    icon: '🎯' },
  ema_alignment:      { label: 'EMA Alignment',       icon: '📐' },
  candle_consistency: { label: 'Candle Consistency',   icon: '🕯️' },
  range_expansion:    { label: 'Range Expansion',      icon: '📏' },
  opening_range:      { label: 'Opening Range (ORB)',  icon: '🔓' },
  volume_trend:       { label: 'Volume Trend',         icon: '📊' },
  body_ratio:         { label: 'Body/Range Ratio',     icon: '🏗️' },
  vix_context:        { label: 'VIX Context',          icon: '⚡' },
  pcr_bias:           { label: 'PCR Bias',             icon: '⚖️' },
  oi_conviction:      { label: 'OI Conviction',        icon: '🔥' },
};

// ── Score Gauge ─────────────────────────────────────────────────────────────

const ScoreGauge = memo<{ score: number; regime: RegimeType }>(({ score, regime }) => {
  const cfg = REGIME_CONFIG[regime] || REGIME_CONFIG.NEUTRAL;
  const pct = Math.min(100, Math.max(0, score));

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-slate-500 font-medium">SIDEWAYS</span>
        <span className={`text-sm font-black ${cfg.color}`}>{pct.toFixed(0)}</span>
        <span className="text-[10px] text-slate-500 font-medium">TRENDING</span>
      </div>
      <div className="relative h-3 bg-slate-700/60 rounded-full overflow-hidden">
        {/* Threshold markers */}
        <div className="absolute top-0 left-[25%] w-px h-full bg-slate-500/40 z-10" />
        <div className="absolute top-0 left-[45%] w-px h-full bg-slate-500/40 z-10" />
        <div className="absolute top-0 left-[70%] w-px h-full bg-slate-500/40 z-10" />
        {/* Fill */}
        <div
          className={`absolute top-0 left-0 h-full rounded-full bg-gradient-to-r ${cfg.barColor} transition-all duration-300 ease-out`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between mt-0.5">
        <span className="text-[8px] text-slate-600">0</span>
        <span className="text-[8px] text-slate-600">25</span>
        <span className="text-[8px] text-slate-600">45</span>
        <span className="text-[8px] text-slate-600">70</span>
        <span className="text-[8px] text-slate-600">100</span>
      </div>
    </div>
  );
});
ScoreGauge.displayName = 'ScoreGauge';

// ── Factor Row ──────────────────────────────────────────────────────────────

const FactorRow = memo<{ name: string; score: number; label: string; signal: string; weight: number }>(
  ({ name, score, label, signal, weight }) => {
    const info = FACTOR_NAMES[name] || { label: name, icon: '•' };
    const pct = Math.min(100, Math.max(0, score));
    const barColor =
      score >= 70 ? 'bg-emerald-500' :
      score >= 45 ? 'bg-blue-500' :
      score >= 25 ? 'bg-amber-500' :
      'bg-slate-500';
    const scoreColor =
      score >= 70 ? 'text-emerald-400' :
      score >= 45 ? 'text-blue-400' :
      score >= 25 ? 'text-amber-400' :
      'text-slate-400';

    return (
      <div className="py-1.5 border-b border-slate-700/30 last:border-b-0">
        <div className="flex items-center justify-between mb-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[10px]">{info.icon}</span>
            <span className="text-[10px] sm:text-xs font-semibold text-slate-300 truncate">{info.label}</span>
            <span className="text-[9px] text-slate-500">({weight}%)</span>
          </div>
          <span className={`text-[10px] sm:text-xs font-bold tabular-nums ${scoreColor}`}>{score.toFixed(0)}</span>
        </div>
        <div className="relative h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
          <div
            className={`absolute top-0 left-0 h-full ${barColor} rounded-full transition-all duration-200`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-[9px] text-slate-500 mt-0.5 truncate">{label}</p>
      </div>
    );
  }
);
FactorRow.displayName = 'FactorRow';

// ── Live market data types (from main WebSocket feed) ────────────────────────

export interface LiveMarketTick {
  price?: number;
  change?: number;
  changePercent?: number;
  high?: number;
  low?: number;
  open?: number;
  pcr?: number;
  oi?: number;
}

export interface LiveVixData {
  value?: number | null;
  price?: number;
  ltp?: number;
}

// ── Single Index Card ───────────────────────────────────────────────────────

const RegimeCard = memo<{
  data: RegimeIndex | null;
  name: string;
  liveTick?: LiveMarketTick | null;
  liveVix?: LiveVixData | null;
}>(({ data, name, liveTick, liveVix }) => {
  if (!data) {
    return (
      <div className="rounded-2xl border border-slate-700/40 bg-slate-800/40 p-4 animate-pulse">
        <div className="h-5 w-32 bg-slate-700 rounded mb-3" />
        <div className="h-20 bg-slate-700/30 rounded-xl" />
      </div>
    );
  }

  const cfg = REGIME_CONFIG[data.regime] || REGIME_CONFIG.NEUTRAL;
  const approach = APPROACH_CONFIG[data.tradeApproach] || APPROACH_CONFIG.WAIT_AND_WATCH;

  const factors = data.factors ? Object.entries(data.factors) : [];
  // Sort by weight descending
  factors.sort((a, b) => (b[1].weight || 0) - (a[1].weight || 0));

  return (
    <div className={`rounded-2xl border ${cfg.border} bg-gradient-to-br from-slate-800/60 via-slate-800/40 to-slate-900/60 p-3 sm:p-4 shadow-lg ${cfg.glow} transition-all duration-200`}>
      {/* Header: Symbol + Regime Badge */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-base sm:text-lg font-black text-white tracking-tight">{name}</span>
          {data.dataSource === 'LIVE' && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
          )}
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${cfg.bg} border ${cfg.border}`}>
          <span className="text-sm">{cfg.icon}</span>
          <span className={`text-[10px] sm:text-xs font-black ${cfg.color} tracking-wide`}>{cfg.shortLabel}</span>
        </div>
      </div>

      {/* Trending Day Badge */}
      <div className={`mb-3 px-3 py-2 rounded-xl ${data.isTrendingDay ? 'bg-gradient-to-r from-emerald-900/30 to-emerald-800/20 border border-emerald-500/30' : 'bg-gradient-to-r from-amber-900/20 to-amber-800/10 border border-amber-500/20'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">{data.isTrendingDay ? '🔥' : '➖'}</span>
            <div>
              <p className={`text-xs font-black ${data.isTrendingDay ? 'text-emerald-300' : 'text-amber-400'}`}>
                {data.isTrendingDay ? 'TRENDING DAY' : 'NON-TRENDING DAY'}
              </p>
              <p className="text-[9px] text-slate-400">
                Strength: <span className={`font-bold ${data.trendStrength === 'STRONG' ? 'text-emerald-400' : data.trendStrength === 'MODERATE' ? 'text-blue-400' : 'text-slate-400'}`}>{data.trendStrength}</span>
                {' '} · Stability: {data.scoreStability?.toFixed(0) ?? '—'}%
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className={`text-xl font-black tabular-nums ${cfg.color}`}>{data.regimeScore?.toFixed(0) ?? '—'}</p>
            <p className="text-[8px] text-slate-500 uppercase tracking-wider">Score</p>
          </div>
        </div>
      </div>

      {/* Score Gauge */}
      <div className="mb-3">
        <ScoreGauge score={data.regimeScore} regime={data.regime} />
      </div>

      {/* Trade Approach */}
      <div className="mb-3 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/40">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm">{approach.icon}</span>
          <span className={`text-[10px] sm:text-xs font-bold ${approach.color}`}>{approach.label}</span>
        </div>
        <p className="text-[10px] sm:text-xs text-slate-400 leading-relaxed">{data.actionSummary}</p>
      </div>

      {/* Context Bar — uses live tick data when available for instant updates */}
      {(data.context || liveTick) && (() => {
        // Prefer live tick data (updates every tick) over regime snapshot (updates every 2s)
        const livePrice = liveTick?.price ?? data.context?.price;
        const liveOpen = liveTick?.open ?? data.context?.open;
        const liveChgPct = liveOpen && livePrice
          ? ((livePrice - liveOpen) / liveOpen) * 100
          : data.context?.changePct;
        const livePcr = liveTick?.pcr ?? data.context?.pcr;
        const vixVal = liveVix?.value ?? liveVix?.price ?? liveVix?.ltp ?? data.context?.vix;

        return (
        <div className="grid grid-cols-4 gap-1.5 mb-3">
          <div className="text-center px-1.5 py-1 rounded bg-slate-800/50">
            <p className="text-[8px] text-slate-500">PRICE</p>
            <p className="text-[10px] font-bold text-white tabular-nums">{livePrice?.toLocaleString('en-IN') ?? '—'}</p>
          </div>
          <div className="text-center px-1.5 py-1 rounded bg-slate-800/50">
            <p className="text-[8px] text-slate-500">CHG%</p>
            <p className={`text-[10px] font-bold tabular-nums ${(liveChgPct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {liveChgPct != null ? `${liveChgPct > 0 ? '+' : ''}${liveChgPct.toFixed(2)}%` : '—'}
            </p>
          </div>
          <div className="text-center px-1.5 py-1 rounded bg-slate-800/50">
            <p className="text-[8px] text-slate-500">VIX</p>
            <p className="text-[10px] font-bold text-white tabular-nums">{vixVal != null ? vixVal.toFixed(1) : '—'}</p>
          </div>
          <div className="text-center px-1.5 py-1 rounded bg-slate-800/50">
            <p className="text-[8px] text-slate-500">PCR</p>
            <p className="text-[10px] font-bold text-white tabular-nums">{livePcr ? livePcr.toFixed(2) : '—'}</p>
          </div>
        </div>
        );
      })()}

      {/* Factor Breakdown — collapsed by default */}
      <div className="rounded-xl bg-slate-800/40 border border-slate-700/30 p-2.5">
        <button
          type="button"
          onClick={() => {
            const el = document.getElementById(`factors-${data.symbol}`);
            if (el) el.classList.toggle('hidden');
            const chevron = document.getElementById(`chevron-${data.symbol}`);
            if (chevron) chevron.classList.toggle('rotate-90');
          }}
          className="flex items-center gap-1.5 w-full text-left cursor-pointer hover:opacity-80 transition-opacity"
        >
          <span className="text-xs">🔍</span>
          <span className="text-[10px] sm:text-xs font-bold text-slate-300">Factor Breakdown (10 Signals)</span>
          <svg id={`chevron-${data.symbol}`} className="w-3 h-3 text-slate-400 ml-auto transition-transform duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </button>
        <div id={`factors-${data.symbol}`} className="hidden mt-2">
          {factors.map(([name, f]) => (
            <FactorRow
              key={name}
              name={name}
              score={f.score}
              label={f.label}
              signal={f.signal}
              weight={f.weight}
            />
          ))}
        </div>
      </div>
    </div>
  );
});
RegimeCard.displayName = 'RegimeCard';

// ── Main Section Component ──────────────────────────────────────────────────

const MarketRegimeIntelligence = memo<{
  marketData?: MarketData | null;
  vixData?: VIXData | null;
}>(({ marketData, vixData }) => {
  const { regimeData } = useMarketRegime();

  // Determine section accent color from NIFTY regime
  const niftyRegime = regimeData.NIFTY?.regime;
  const sectionAccent: 'emerald' | 'red' | 'amber' | 'blue' =
    niftyRegime?.includes('BULLISH') ? 'emerald' :
    niftyRegime?.includes('BEARISH') ? 'red' :
    niftyRegime === 'SIDEWAYS' ? 'amber' : 'blue';

  const sectionBorder =
    sectionAccent === 'emerald' ? 'border-emerald-500/40' :
    sectionAccent === 'red' ? 'border-red-500/40' :
    sectionAccent === 'amber' ? 'border-amber-500/40' :
    'border-blue-500/40';

  const sectionBg =
    sectionAccent === 'emerald' ? 'from-emerald-950/20 via-dark-card/50 to-dark-elevated/40' :
    sectionAccent === 'red' ? 'from-red-950/20 via-dark-card/50 to-dark-elevated/40' :
    sectionAccent === 'amber' ? 'from-amber-950/20 via-dark-card/50 to-dark-elevated/40' :
    'from-blue-950/20 via-dark-card/50 to-dark-elevated/40';

  // Map symbol keys to live tick data
  const liveTickMap: Record<string, LiveMarketTick | null> = {
    NIFTY: marketData?.NIFTY ?? null,
    BANKNIFTY: marketData?.BANKNIFTY ?? null,
    SENSEX: marketData?.SENSEX ?? null,
  };

  return (
    <div className={`mt-6 sm:mt-6 border-2 ${sectionBorder} rounded-2xl p-3 sm:p-4 bg-gradient-to-br ${sectionBg} backdrop-blur-sm shadow-xl`}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
        <SectionTitle
          title="Today's Market Regime"
          subtitle="10-Factor Regime Engine · Trending vs Sideways · Trade Approach · Real-time Scoring"
          accentColor={sectionAccent}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
        <RegimeCard data={regimeData.NIFTY} name="NIFTY 50" liveTick={liveTickMap.NIFTY} liveVix={vixData} />
        <RegimeCard data={regimeData.BANKNIFTY} name="BANK NIFTY" liveTick={liveTickMap.BANKNIFTY} liveVix={vixData} />
        <RegimeCard data={regimeData.SENSEX} name="SENSEX" liveTick={liveTickMap.SENSEX} liveVix={vixData} />
      </div>
    </div>
  );
});
MarketRegimeIntelligence.displayName = 'MarketRegimeIntelligence';

export default MarketRegimeIntelligence;
