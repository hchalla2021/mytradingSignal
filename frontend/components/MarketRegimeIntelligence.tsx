'use client';

import React, { memo, useMemo } from 'react';
import { useMarketRegime, type RegimeIndex, type RegimeType, type TradeApproach } from '@/hooks/useMarketRegime';
import type { MarketData } from '@/hooks/useMarketSocket';
import type { VIXData } from '@/hooks/useIndiaVIX';
import SectionTitle from '@/components/SectionTitle';
import StrikeIntelligence from '@/components/StrikeIntelligence';
import QuantumFractalSection from '@/components/QuantumFractalSection';

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
    label: 'STRONG BUY',
    shortLabel: 'STRONG BUY',
    color: 'text-emerald-300',
    bg: 'bg-emerald-500/20',
    border: 'border-emerald-400/60',
    glow: 'shadow-emerald-500/30',
    icon: '🟢',
    barColor: 'from-emerald-400 to-emerald-600',
  },
  TRENDING_BULLISH: {
    label: 'BUY',
    shortLabel: 'BUY',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-400/40',
    glow: 'shadow-emerald-500/15',
    icon: '📈',
    barColor: 'from-emerald-400 to-emerald-500',
  },
  STRONG_TRENDING_BEARISH: {
    label: 'STRONG SELL',
    shortLabel: 'STRONG SELL',
    color: 'text-red-300',
    bg: 'bg-red-500/20',
    border: 'border-red-400/60',
    glow: 'shadow-red-500/30',
    icon: '🔴',
    barColor: 'from-red-400 to-red-600',
  },
  TRENDING_BEARISH: {
    label: 'SELL',
    shortLabel: 'SELL',
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-400/40',
    glow: 'shadow-red-500/15',
    icon: '📉',
    barColor: 'from-red-400 to-red-500',
  },
  SIDEWAYS: {
    label: 'NEUTRAL',
    shortLabel: 'NEUTRAL',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-400/40',
    glow: 'shadow-amber-500/15',
    icon: '↔️',
    barColor: 'from-amber-400 to-amber-500',
  },
  NEUTRAL: {
    label: 'NEUTRAL',
    shortLabel: 'NEUTRAL',
    color: 'text-slate-400',
    bg: 'bg-slate-500/10',
    border: 'border-slate-400/40',
    glow: 'shadow-slate-500/15',
    icon: '⚖️',
    barColor: 'from-slate-400 to-slate-500',
  },
};

type RegimeSignal = 'STRONG BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG SELL';

function toRegimeSignal(regime: RegimeType): RegimeSignal {
  if (regime === 'STRONG_TRENDING_BULLISH') return 'STRONG BUY';
  if (regime === 'TRENDING_BULLISH') return 'BUY';
  if (regime === 'TRENDING_BEARISH') return 'SELL';
  if (regime === 'STRONG_TRENDING_BEARISH') return 'STRONG SELL';
  return 'NEUTRAL';
}

function signalTone(signal: RegimeSignal): { arrow: string; color: string; bg: string } {
  if (signal === 'STRONG BUY' || signal === 'BUY') {
    return { arrow: '▲', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' };
  }
  if (signal === 'STRONG SELL' || signal === 'SELL') {
    return { arrow: '▼', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30' };
  }
  return { arrow: '→', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' };
}

const APPROACH_CONFIG: Record<TradeApproach, { label: string; icon: string; color: string }> = {
  DIRECTIONAL_ONLY: { label: 'Directional Only — Ride the Trend', icon: '🎯', color: 'text-emerald-400' },
  DIRECTIONAL_BIAS: { label: 'Directional Bias — Favour Trend Side', icon: '📐', color: 'text-blue-400' },
  WAIT_AND_WATCH:   { label: 'Wait & Watch — No Clear Setup', icon: '👀', color: 'text-amber-400' },
  RANGE_TRADE:      { label: 'Range Trade — S/R Bounces Only', icon: '📊', color: 'text-purple-400' },
};

function formatTimeStamp(value: string | null): string {
  if (!value) return 'Waiting for live regime feed';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Waiting for live regime feed';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function getTopDrivers(data: RegimeIndex | null): Array<{ key: string; label: string; score: number; signal: string }> {
  if (!data?.factors) return [];
  return Object.entries(data.factors)
    .map(([key, factor]) => ({ key, label: factor.label, score: factor.score, signal: factor.signal }))
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .slice(0, 4);
}

function getTradeGateState(directionStrength: number | null | undefined, isTrendingDay: boolean): {
  strengthReady: boolean;
  trendingReady: boolean;
  tradeReady: boolean;
} {
  const strengthReady = (directionStrength ?? 0) >= 50;
  const trendingReady = isTrendingDay;
  return {
    strengthReady,
    trendingReady,
    tradeReady: strengthReady && trendingReady,
  };
}

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

  // Live context values for supporting metrics (price/open/high/low/PCR/VIX)
  const livePrice  = liveTick?.price  ?? data.context?.price;
  const liveOpen   = liveTick?.open   ?? data.context?.open;
  const liveHigh   = liveTick?.high   ?? data.context?.high;
  const liveLow    = liveTick?.low    ?? data.context?.low;
  const livePcr    = liveTick?.pcr    ?? data.context?.pcr;
  const vixVal     = liveVix?.value ?? liveVix?.price ?? liveVix?.ltp ?? data.context?.vix;
  const liveChgPct = (liveOpen && livePrice)
    ? ((livePrice - liveOpen) / liveOpen) * 100
    : data.context?.changePct;

  const displaySignal = toRegimeSignal(data.regime);
  const tone = signalTone(displaySignal);
  const drivers = getTopDrivers(data);
  const gate = getTradeGateState(data.directionStrength, data.isTrendingDay);

  return (
    <div className={`rounded-2xl border ${cfg.border} bg-gradient-to-br from-slate-800/60 via-slate-800/40 to-slate-900/60 p-3 sm:p-4 shadow-lg ${cfg.glow} transition-all duration-200`}>
      {/* Header: Symbol + Regime Badge */}
      <div className="flex items-center justify-between mb-2">
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

      {/* ── DIRECTION BANNER — aligned with regime engine ── */}
      <div className={`mb-3 px-3 py-2 rounded-xl border ${tone.bg} flex flex-wrap items-center justify-between gap-2 transition-all duration-150`}>
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-xl font-black leading-none ${tone.color}`}>{tone.arrow}</span>
          <div>
            <p className={`text-sm font-black tracking-wide ${tone.color}`}>{displaySignal}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {liveChgPct != null && (
            <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[10px] font-black tabular-nums ${liveChgPct >= 0 ? 'text-emerald-300 border-emerald-500/35 bg-emerald-500/10' : 'text-red-300 border-red-500/35 bg-red-500/10'}`}>
              Open {liveChgPct > 0 ? '+' : ''}{liveChgPct.toFixed(2)}%
            </span>
          )}
          <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[10px] font-black tabular-nums ${cfg.color} ${cfg.border} ${cfg.bg}`}>
            Score {data.regimeScore?.toFixed(0) ?? '—'}
          </span>
          {data.directionStrength != null && data.directionStrength > 0 && (
            <span
              className={`inline-flex items-center rounded-md border px-2 py-1 text-[10px] font-black tabular-nums transition-all duration-200 ${
                gate.strengthReady
                  ? 'text-emerald-200 border-emerald-400/70 bg-emerald-500/25 shadow-[0_0_14px_rgba(16,185,129,0.45)] ring-1 ring-emerald-400/45'
                  : `${tone.color} ${tone.bg}`
              }`}
            >
              Strength {data.directionStrength.toFixed(0)}%
            </span>
          )}
        </div>
      </div>

      {/* Trending Day Badge */}
      <div
        className={`mb-3 px-3 py-2 rounded-xl transition-all duration-200 ${
          gate.trendingReady
            ? 'bg-gradient-to-r from-emerald-900/40 to-emerald-800/25 border border-emerald-400/60 shadow-[0_0_16px_rgba(16,185,129,0.35)] ring-1 ring-emerald-400/35'
            : 'bg-gradient-to-r from-amber-900/20 to-amber-800/10 border border-amber-500/20'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg">{data.isTrendingDay ? '🔥' : '➖'}</span>
            <div>
              <p className={`text-xs font-black ${gate.trendingReady ? 'text-emerald-200' : 'text-amber-400'}`}>
                {data.isTrendingDay ? 'TRENDING DAY' : 'NON-TRENDING DAY'}
              </p>
              <p className="text-[9px] text-slate-400">
                Trend: <span className={`font-bold ${data.trendStrength === 'STRONG' ? 'text-emerald-400' : data.trendStrength === 'MODERATE' ? 'text-blue-400' : 'text-slate-400'}`}>{data.trendStrength}</span>
                {' '} · Stability: {data.scoreStability?.toFixed(0) ?? '—'}%
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={`px-2 py-1 rounded-lg ${tone.bg} border`}>
              <p className={`text-xs font-black ${tone.color}`}>{tone.arrow} {displaySignal}</p>
            </div>
            {gate.tradeReady && (
              <span className="inline-flex items-center rounded-md border border-emerald-300/75 bg-emerald-500/25 px-2 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-emerald-100 shadow-[0_0_14px_rgba(16,185,129,0.45)]">
                Trade Ready
              </span>
            )}
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

      {/* Context Bar — 6 metrics, live tick data for instant updates */}
      {(data.context || liveTick) && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 mb-3">
          <div className="text-center px-1.5 py-1 rounded bg-slate-800/50">
            <p className="text-[8px] text-slate-500">PRICE</p>
            <p className="text-[10px] font-bold text-white tabular-nums">{livePrice?.toLocaleString('en-IN') ?? '—'}</p>
          </div>
          <div className="text-center px-1.5 py-1 rounded bg-slate-800/50">
            <p className="text-[8px] text-slate-500">vs OPEN</p>
            <p className={`text-[10px] font-bold tabular-nums ${(liveChgPct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {liveChgPct != null ? `${liveChgPct > 0 ? '+' : ''}${liveChgPct.toFixed(2)}%` : '—'}
            </p>
          </div>
          <div className="text-center px-1.5 py-1 rounded bg-slate-800/50">
            <p className="text-[8px] text-emerald-600/80">HIGH</p>
            <p className="text-[10px] font-bold text-emerald-400 tabular-nums">{liveHigh?.toLocaleString('en-IN') ?? '—'}</p>
          </div>
          <div className="text-center px-1.5 py-1 rounded bg-slate-800/50">
            <p className="text-[8px] text-red-600/80">LOW</p>
            <p className="text-[10px] font-bold text-red-400 tabular-nums">{liveLow?.toLocaleString('en-IN') ?? '—'}</p>
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
      )}

      {drivers.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {drivers.map(driver => (
            <span
              key={`${name}-${driver.key}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700/40 bg-slate-950/50 px-2 py-1 text-[9px] font-bold text-slate-300 leading-none"
            >
              <span className={`${driver.signal.includes('Bear') || driver.signal.includes('SELL') ? 'text-red-400' : 'text-emerald-400'}`}>
                {driver.score >= 0 ? '+' : ''}{driver.score.toFixed(0)}
              </span>
              <span className="truncate max-w-[120px]">{driver.label}</span>
            </span>
          ))}
        </div>
      )}

    </div>
  );
});
RegimeCard.displayName = 'RegimeCard';

// ── Main Section Component ──────────────────────────────────────────────────

const MarketRegimeIntelligence = memo<{
  marketData?: MarketData | null;
  vixData?: VIXData | null;
}>(({ marketData, vixData }) => {
  const { regimeData, isConnected, lastUpdate } = useMarketRegime();

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

  const sectionSummary = useMemo(() => {
    const all = [regimeData.NIFTY, regimeData.BANKNIFTY, regimeData.SENSEX].filter((v): v is RegimeIndex => Boolean(v));
    const lead = all.length > 0
      ? all
          .slice()
          .sort((a, b) => {
            const tA = parseTime(a.timestamp) ?? 0;
            const tB = parseTime(b.timestamp) ?? 0;
            if (tA !== tB) return tB - tA;
            const scoreA = Math.abs(a.directionStrength ?? 0) + (a.regimeScore ?? 0) * 0.3;
            const scoreB = Math.abs(b.directionStrength ?? 0) + (b.regimeScore ?? 0) * 0.3;
            return scoreB - scoreA;
          })[0]
      : null;
    const drivers = getTopDrivers(lead);
    const volatility = lead?.context?.vix ?? vixData?.value ?? null;
    const leadTs = parseTime(lead?.timestamp);
    const leadAgeSec = leadTs != null ? Math.max(0, (Date.now() - leadTs) / 1000) : null;

    let connectionLabel = 'RECOVERING';
    if (lead?.dataSource === 'MARKET_CLOSED') {
      connectionLabel = 'MARKET CLOSED';
    } else if (isConnected) {
      connectionLabel = leadAgeSec != null && leadAgeSec > 12 ? 'LIVE FEED DELAYED' : 'LIVE FEED';
    }

    return {
      lead,
      drivers,
      volatility,
      updatedAt: formatTimeStamp(lead?.timestamp ?? lastUpdate ?? null),
      connectionLabel,
      leadAgeSec,
    };
  }, [isConnected, lastUpdate, regimeData.BANKNIFTY, regimeData.NIFTY, regimeData.SENSEX, vixData?.value]);

  const leadGate = getTradeGateState(
    sectionSummary.lead?.directionStrength,
    sectionSummary.lead?.isTrendingDay ?? false
  );

  return (
    <section className={`mt-6 sm:mt-6 border-2 ${sectionBorder} rounded-2xl p-3 sm:p-4 bg-gradient-to-br ${sectionBg} backdrop-blur-sm shadow-xl overflow-hidden`}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
        <SectionTitle
          title="Today's Market Regime"
          accentColor={sectionAccent}
          subtitle="Multi-market regime detection, live volatility context, and institutional trade posture"
          rightContent={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-black tracking-[0.12em] ${isConnected ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/35 bg-amber-500/10 text-amber-300'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                {sectionSummary.connectionLabel}
              </span>
              <span className="inline-flex items-center rounded-full border border-slate-700/45 bg-slate-900/55 px-2 py-1 text-[9px] font-black tracking-[0.12em] text-slate-300">
                Updated {sectionSummary.updatedAt}
              </span>
            </div>
          }
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.95fr)]">
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
          <RegimeCard data={regimeData.NIFTY} name="NIFTY 50" liveTick={liveTickMap.NIFTY} liveVix={vixData} />
          <RegimeCard data={regimeData.BANKNIFTY} name="BANK NIFTY" liveTick={liveTickMap.BANKNIFTY} liveVix={vixData} />
          <RegimeCard data={regimeData.SENSEX} name="SENSEX" liveTick={liveTickMap.SENSEX} liveVix={vixData} />
        </div>

        <aside className="rounded-2xl border border-slate-700/45 bg-slate-950/55 p-3 sm:p-4 shadow-lg shadow-black/20">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500">Institutional Readout</p>
              <h3 className={`mt-1 text-base sm:text-lg font-extrabold tracking-tight ${sectionSummary.lead ? REGIME_CONFIG[sectionSummary.lead.regime].color : 'text-slate-300'}`}>
                {sectionSummary.lead ? sectionSummary.lead.actionSummary : 'Waiting for live regime snapshot'}
              </h3>
            </div>
            <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[9px] font-black uppercase tracking-[0.14em] ${sectionAccent === 'red' ? 'border-red-500/35 bg-red-500/10 text-red-300' : sectionAccent === 'emerald' ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300' : sectionAccent === 'amber' ? 'border-amber-500/35 bg-amber-500/10 text-amber-300' : 'border-blue-500/35 bg-blue-500/10 text-blue-300'}`}>
              {sectionSummary.lead ? sectionSummary.lead.trendStrength : 'NO DATA'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="rounded-xl border border-slate-800/55 bg-slate-900/55 p-2.5">
              <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-500">Regime Score</p>
              <p className={`mt-1 text-lg font-black ${sectionSummary.lead ? REGIME_CONFIG[sectionSummary.lead.regime].color : 'text-slate-300'}`}>
                {sectionSummary.lead?.regimeScore?.toFixed(0) ?? '—'}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800/55 bg-slate-900/55 p-2.5">
              <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-500">Direction</p>
              <p className="mt-1 text-lg font-black text-slate-100">
                {sectionSummary.lead?.direction ?? '—'}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800/55 bg-slate-900/55 p-2.5">
              <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-500">Strength</p>
              <p
                className={`mt-1 text-lg font-black transition-all duration-200 ${
                  leadGate.strengthReady
                    ? 'text-emerald-200 drop-shadow-[0_0_8px_rgba(16,185,129,0.55)]'
                    : 'text-cyan-300'
                }`}
              >
                {sectionSummary.lead?.directionStrength != null ? `${sectionSummary.lead.directionStrength.toFixed(0)}%` : '—'}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800/55 bg-slate-900/55 p-2.5">
              <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-500">Volatility</p>
              <p className="mt-1 text-lg font-black text-amber-300">
                {sectionSummary.volatility != null ? sectionSummary.volatility.toFixed(1) : '—'}
              </p>
            </div>
          </div>

          <div className="mb-3 rounded-xl border border-slate-800/55 bg-slate-900/55 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">Key Drivers</p>
              <p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Top factors</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {sectionSummary.drivers.length > 0 ? sectionSummary.drivers.map(driver => (
                <span key={driver.key} className="inline-flex items-center gap-1 rounded-full border border-slate-700/50 bg-slate-950/55 px-2 py-1 text-[9px] font-bold text-slate-200">
                  <span className={`${driver.score >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{driver.score >= 0 ? '+' : ''}{driver.score.toFixed(0)}</span>
                  <span className="max-w-[120px] truncate">{driver.label}</span>
                </span>
              )) : (
                <span className="text-[10px] text-slate-500">No factor snapshot available yet.</span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="rounded-xl border border-slate-800/55 bg-slate-900/55 p-2.5">
              <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-500">Playbook</p>
              <p className="mt-1 font-black text-slate-100">{sectionSummary.lead ? APPROACH_CONFIG[sectionSummary.lead.tradeApproach].label : 'Waiting for setup'}</p>
            </div>
            <div className="rounded-xl border border-slate-800/55 bg-slate-900/55 p-2.5">
              <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-500">Stability</p>
              <p className="mt-1 font-black text-slate-100">{sectionSummary.lead?.scoreStability != null ? `${sectionSummary.lead.scoreStability.toFixed(0)}%` : '—'}</p>
            </div>
            <div className="rounded-xl border border-slate-800/55 bg-slate-900/55 p-2.5">
              <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-500">Data Source</p>
              <p className="mt-1 font-black text-slate-100">
                {sectionSummary.lead?.dataSource ?? '—'}
                {sectionSummary.leadAgeSec != null && sectionSummary.lead?.dataSource === 'LIVE' ? ` · ${Math.round(sectionSummary.leadAgeSec)}s ago` : ''}
              </p>
            </div>
            <div
              className={`rounded-xl border p-2.5 transition-all duration-200 ${
                leadGate.trendingReady
                  ? 'border-emerald-400/60 bg-emerald-900/20 shadow-[0_0_12px_rgba(16,185,129,0.28)]'
                  : 'border-slate-800/55 bg-slate-900/55'
              }`}
            >
              <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-500">Trending Day</p>
              <p className={`mt-1 font-black ${leadGate.trendingReady ? 'text-emerald-200' : 'text-slate-100'}`}>
                {sectionSummary.lead ? (sectionSummary.lead.isTrendingDay ? 'YES' : 'NO') : '—'}
              </p>
            </div>
          </div>

          {leadGate.tradeReady && (
            <div className="mt-2 rounded-xl border border-emerald-300/70 bg-emerald-500/20 px-3 py-2 text-center shadow-[0_0_16px_rgba(16,185,129,0.35)]">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-100">
                Priority Match: Trending Day YES + Strength &gt;= 50%
              </p>
            </div>
          )}
        </aside>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <div className="xl:col-span-3">
          {/* 🎯 Strike Intelligence — ATM ± 5, CE/PE, Volume/OI/Liquidity Scoring */}
          <StrikeIntelligence />
        </div>

        <div className="xl:col-span-3">
          {/* � Quantum Fractal Intelligence Engine — Multi-timeframe fractal analysis */}
          <QuantumFractalSection />
        </div>
      </div>
    </section>
  );
});
MarketRegimeIntelligence.displayName = 'MarketRegimeIntelligence';

export default MarketRegimeIntelligence;
