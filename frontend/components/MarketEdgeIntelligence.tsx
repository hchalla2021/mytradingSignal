'use client';

import React, { memo, useState, useMemo } from 'react';
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

// ── INSTITUTIONAL METRICS TYPES ──────────────────────────────────────────────

type SentimentType = 'EXTREME_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'EXTREME_BEARISH';
type VolatilityRegimeType = 'COMPRESSION' | 'EXPANSION' | 'HIGH_VOLATILITY' | 'LOW_VOLATILITY';
type MarketRegimeType = 'STRONG_UPTREND' | 'UPTREND' | 'CONSOLIDATION' | 'DOWNTREND' | 'STRONG_DOWNTREND';

interface InstitutionalMetrics {
  sentimentScore: number; // -100 to +100
  sentimentType: SentimentType;
  volatilityRegime: VolatilityRegimeType;
  volatilityScore: number; // 0-100
  marketRegime: MarketRegimeType;
  regimeStrength: number; // 0-100
  institutionalFlow: number; // -100 to +100
  fiiAlignment: number; // -100 to +100
  diiAlignment: number; // -100 to +100
  liquidityEdge: number; // 0-100
  executionQuality: number; // 0-100
  riskRewardEdge: number; // 1.0 to 5.0+
}

interface RiskRewardOpportunity {
  symbol: string;
  type: 'REVERSAL' | 'CONTINUATION' | 'BREAKOUT' | 'VOLATILITY';
  timeframe: string;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  riskRewardRatio: number;
  probability: number; // 0-100
  confidence: number; // 0-100
  edgeScore: number; // 0-100
}

const SIGNAL_NAMES: Record<string, { label: string; icon: string }> = {
  oi_spurts:      { label: 'OI Spurts',         icon: '🔥' },
  iv_estimation:  { label: 'IV Level',          icon: '📊' },
  iv_rank:        { label: 'IV Rank',           icon: '📏' },
  futures_oi:     { label: 'Futures OI',        icon: '📈' },
  futures_basis:  { label: 'Futures Basis',     icon: '💰' },
  live_price_momentum: { label: 'Live Momentum', icon: '⚡' },
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

// ── INSTITUTIONAL METRICS COMPUTATION ────────────────────────────────────────

const computeInstitutionalMetrics = (
  edgeData: EdgeIndex | null,
): InstitutionalMetrics => {
  if (!edgeData) {
    return {
      sentimentScore: 0,
      sentimentType: 'NEUTRAL',
      volatilityRegime: 'LOW_VOLATILITY',
      volatilityScore: 50,
      marketRegime: 'CONSOLIDATION',
      regimeStrength: 50,
      institutionalFlow: 0,
      fiiAlignment: 0,
      diiAlignment: 0,
      liquidityEdge: 50,
      executionQuality: 50,
      riskRewardEdge: 1.5,
    };
  }

  // Sentiment analysis from raw score
  const rawScore = edgeData.rawScore;
  const sentimentScore = Math.max(-100, Math.min(100, rawScore * 100));
  const sentimentType: SentimentType =
    sentimentScore >= 60 ? 'EXTREME_BULLISH'
    : sentimentScore >= 20 ? 'BULLISH'
    : sentimentScore > -20 ? 'NEUTRAL'
    : sentimentScore > -60 ? 'BEARISH'
    : 'EXTREME_BEARISH';

  // Volatility regime from IV Rank
  const ivRank = edgeData.metrics.ivRank;
  const volatilityScore = Math.max(0, Math.min(100, ivRank));
  const volatilityRegime: VolatilityRegimeType =
    ivRank >= 75 ? 'HIGH_VOLATILITY'
    : ivRank >= 60 ? 'EXPANSION'
    : ivRank <= 25 ? 'COMPRESSION'
    : 'LOW_VOLATILITY';

  // Market regime from direction + confidence
  const confidence = edgeData.confidence;
  const direction = edgeData.direction;
  const marketRegime: MarketRegimeType =
    direction === 'BULLISH' && confidence >= 70 ? 'STRONG_UPTREND'
    : direction === 'BULLISH' ? 'UPTREND'
    : direction === 'BEARISH' && confidence >= 70 ? 'STRONG_DOWNTREND'
    : direction === 'BEARISH' ? 'DOWNTREND'
    : 'CONSOLIDATION';

  // Institutional flow from OI profile
  const profileFlow: Record<OIProfile, number> = {
    LONG_BUILDUP: 70,
    SHORT_COVERING: 50,
    SHORT_BUILDUP: -70,
    LONG_UNWINDING: -50,
    NEUTRAL: 0,
  };
  const institutionalFlow = profileFlow[edgeData.oiProfile] || 0;

  // FII/DII alignment (simulated from action signal)
  const actionAlignment: Record<EdgeAction, number> = {
    STRONG_BUY: 80,
    BUY: 50,
    NEUTRAL: 0,
    SELL: -50,
    STRONG_SELL: -80,
  };
  const fiiAlignment = actionAlignment[edgeData.action] || 0;
  const diiAlignment = Math.random() * 100 - 50; // Simulated DII

  // Liquidity edge from OI metrics
  const oiTotal = (edgeData.metrics.callOI || 0) + (edgeData.metrics.putOI || 0);
  const liquidityEdge = Math.max(0, Math.min(100, (oiTotal > 0 ? 60 : 40) + (confidence / 2)));

  // Execution quality from basis + futures
  const basisPct = Math.abs(edgeData.futures?.basisPct || 0);
  const executionQuality = Math.max(0, Math.min(100, 75 - (basisPct * 100)));

  // Risk/Reward edge calculation
  const riskRewardEdge = 1.5 + (Math.abs(sentimentScore) / 50) + (confidence / 100);

  return {
    sentimentScore,
    sentimentType,
    volatilityRegime,
    volatilityScore,
    marketRegime,
    regimeStrength: confidence,
    institutionalFlow,
    fiiAlignment,
    diiAlignment,
    liquidityEdge,
    executionQuality,
    riskRewardEdge,
  };
};

const generateRiskRewardOpportunities = (
  symbol: string,
  edgeData: EdgeIndex | null,
  metrics: InstitutionalMetrics,
): RiskRewardOpportunity[] => {
  if (!edgeData) return [];

  const opportunities: RiskRewardOpportunity[] = [];
  const currentPrice = edgeData.metrics.price;

  // Reversal opportunity
  if (Math.abs(metrics.sentimentScore) > 50 && edgeData.confidence >= 65) {
    const moveSize = currentPrice * 0.02;
    opportunities.push({
      symbol,
      type: 'REVERSAL',
      timeframe: '15m',
      entryPrice: currentPrice,
      targetPrice: metrics.sentimentScore > 0 ? currentPrice - moveSize : currentPrice + moveSize,
      stopLoss: metrics.sentimentScore > 0 ? currentPrice + (moveSize * 0.5) : currentPrice - (moveSize * 0.5),
      riskRewardRatio: 2.5,
      probability: Math.min(95, 60 + Math.abs(metrics.sentimentScore) / 2),
      confidence: edgeData.confidence,
      edgeScore: Math.min(100, edgeData.confidence + (Math.abs(metrics.sentimentScore) / 2)),
    });
  }

  // Continuation opportunity
  if (metrics.marketRegime.includes('TREND') && metrics.regimeStrength >= 60) {
    const moveSize = currentPrice * 0.025;
    opportunities.push({
      symbol,
      type: 'CONTINUATION',
      timeframe: '5m',
      entryPrice: currentPrice,
      targetPrice: metrics.marketRegime.includes('UP') ? currentPrice + moveSize : currentPrice - moveSize,
      stopLoss: metrics.marketRegime.includes('UP') ? currentPrice - (moveSize * 0.4) : currentPrice + (moveSize * 0.4),
      riskRewardRatio: 1.8,
      probability: Math.min(90, 65 + (metrics.regimeStrength / 3)),
      confidence: metrics.regimeStrength,
      edgeScore: Math.min(100, metrics.regimeStrength + metrics.liquidityEdge / 2),
    });
  }

  // Volatility breakout opportunity
  if (metrics.volatilityRegime === 'EXPANSION' && edgeData.confidence >= 70) {
    const moveSize = currentPrice * 0.03;
    opportunities.push({
      symbol,
      type: 'BREAKOUT',
      timeframe: '1h',
      entryPrice: currentPrice,
      targetPrice: metrics.sentimentScore > 0 ? currentPrice + moveSize : currentPrice - moveSize,
      stopLoss: currentPrice * 0.97,
      riskRewardRatio: 3.0,
      probability: Math.min(85, 50 + metrics.volatilityScore / 2),
      confidence: Math.min(100, edgeData.confidence + (metrics.volatilityScore / 4)),
      edgeScore: Math.min(100, (edgeData.confidence + metrics.volatilityScore) / 2),
    });
  }

  return opportunities;
};

// ── INSTITUTIONAL SENTIMENT GAUGE ──────────────────────────────────────────────

const InstitutionalSentimentGauge = memo<{ metrics: InstitutionalMetrics }>(
  ({ metrics }) => {
    const getSentimentColor = (type: SentimentType) => {
      switch (type) {
        case 'EXTREME_BULLISH': return 'from-emerald-500 to-cyan-500';
        case 'BULLISH': return 'from-emerald-400 to-teal-400';
        case 'NEUTRAL': return 'from-slate-400 to-slate-500';
        case 'BEARISH': return 'from-amber-400 to-orange-400';
        case 'EXTREME_BEARISH': return 'from-rose-500 to-red-500';
      }
    };

    const barWidth = Math.max(0, Math.min(100, (metrics.sentimentScore + 100) / 2));
    
    return (
      <div className="bg-slate-900/40 rounded-lg border border-slate-700/30 p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Market Sentiment</p>
          <p className="text-[11px] font-mono font-semibold text-slate-200">{metrics.sentimentScore >= 0 ? '+' : ''}{metrics.sentimentScore.toFixed(0)}</p>
        </div>
        <div className="relative h-2.5 rounded-full bg-slate-800/50 overflow-hidden mb-2">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${getSentimentColor(metrics.sentimentType)} shadow-lg transition-all duration-300`}
            style={{ width: `${barWidth}%` }}
          />
        </div>
        <div className="flex justify-between text-[9px] text-slate-500">
          <span>Bearish</span>
          <span>Neutral</span>
          <span>Bullish</span>
        </div>
        <p className="text-[10px] font-bold text-slate-300 mt-2 text-center">{metrics.sentimentType.replace(/_/g, ' ')}</p>
      </div>
    );
  }
);
InstitutionalSentimentGauge.displayName = 'InstitutionalSentimentGauge';

// ── VOLATILITY REGIME INDICATOR ────────────────────────────────────────────────

const VolatilityRegimeIndicator = memo<{ metrics: InstitutionalMetrics }>(
  ({ metrics }) => {
    const regimeLabel = {
      COMPRESSION: 'Compression Phase',
      EXPANSION: 'Expansion Phase',
      HIGH_VOLATILITY: 'Extreme Volatility',
      LOW_VOLATILITY: 'Low Volatility',
    }[metrics.volatilityRegime] || 'Unknown';

    return (
      <div className="bg-slate-900/40 rounded-lg border border-slate-700/30 p-3">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Volatility Regime</p>
        <div className="h-8 rounded-lg bg-gradient-to-r {regimeColor} flex items-center justify-center mb-2" style={{ backgroundImage: `linear-gradient(to right, var(--tw-gradient-stops))` }}>
          <p className="text-[11px] font-bold text-white">{metrics.volatilityScore.toFixed(0)}</p>
        </div>
        <p className="text-[10px] font-bold text-slate-300 text-center">{regimeLabel}</p>
      </div>
    );
  }
);
VolatilityRegimeIndicator.displayName = 'VolatilityRegimeIndicator';

// ── RISK/REWARD OPPORTUNITY CARD ───────────────────────────────────────────────

const RiskRewardCard = memo<{ opportunity: RiskRewardOpportunity }>(
  ({ opportunity }) => {
    const typeColor = {
      REVERSAL: 'from-amber-500 to-orange-500',
      CONTINUATION: 'from-emerald-500 to-cyan-500',
      BREAKOUT: 'from-indigo-500 to-purple-500',
      VOLATILITY: 'from-rose-500 to-red-500',
    }[opportunity.type] || 'from-slate-500 to-slate-600';

    const typeLabel = opportunity.type.replace(/_/g, ' ');
    const risk = opportunity.entryPrice - opportunity.stopLoss;
    const reward = Math.abs(opportunity.targetPrice - opportunity.entryPrice);

    return (
      <div className="bg-slate-900/60 rounded-lg border border-slate-700/30 p-3 hover:border-slate-700/60 transition-all duration-300">
        <div className="flex items-start justify-between mb-2">
          <div className={`inline-block px-2 py-1 rounded-sm bg-gradient-to-r ${typeColor} bg-opacity-20`}>
            <p className="text-[9px] font-bold uppercase tracking-wider text-white">{typeLabel}</p>
          </div>
          <p className="text-[10px] font-mono font-semibold text-slate-300">{opportunity.timeframe}</p>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-2 text-[9px]">
          <div>
            <p className="text-slate-500 uppercase tracking-wider mb-0.5">Entry</p>
            <p className="font-mono font-semibold text-slate-200">₹{formatPrice(opportunity.entryPrice)}</p>
          </div>
          <div>
            <p className="text-slate-500 uppercase tracking-wider mb-0.5">Target</p>
            <p className="font-mono font-semibold text-emerald-400">₹{formatPrice(opportunity.targetPrice)}</p>
          </div>
          <div>
            <p className="text-slate-500 uppercase tracking-wider mb-0.5">Risk</p>
            <p className="font-mono font-semibold text-rose-400">₹{risk.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-slate-500 uppercase tracking-wider mb-0.5">Reward</p>
            <p className="font-mono font-semibold text-emerald-400">₹{reward.toFixed(2)}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-700/30">
          <div className="text-center text-[8px]">
            <p className="text-slate-500 uppercase tracking-wider">Probability</p>
            <p className="font-mono font-bold text-indigo-300">{opportunity.probability.toFixed(0)}%</p>
          </div>
          <div className="text-center text-[8px]">
            <p className="text-slate-500 uppercase tracking-wider">R:R</p>
            <p className="font-mono font-bold text-cyan-300">1:{opportunity.riskRewardRatio.toFixed(1)}</p>
          </div>
          <div className="text-center text-[8px]">
            <p className="text-slate-500 uppercase tracking-wider">Edge</p>
            <p className="font-mono font-bold text-emerald-300">{opportunity.edgeScore.toFixed(0)}</p>
          </div>
        </div>
      </div>
    );
  }
);
RiskRewardCard.displayName = 'RiskRewardCard';

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
  const [isExpanded, setIsExpanded] = useState(false);
  const [showScoringEngine, setShowScoringEngine] = useState(false);
  
  const metrics = useMemo(() => computeInstitutionalMetrics(data), [data]);
  const opportunities = useMemo(() => generateRiskRewardOpportunities(name, data, metrics), [data, metrics, name]);

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

  const signalKeys = Object.keys(data.signals) as Array<keyof typeof data.signals>;
  const totalSignals = signalKeys.length || 1;
  const bullCount = signalKeys.filter((k) => data.signals[k].signal === 'BULL').length;
  const bearCount = signalKeys.filter((k) => data.signals[k].signal === 'BEAR').length;
  const neutralCount = totalSignals - bullCount - bearCount;
  const dominantCount = Math.max(bullCount, bearCount);
  const confluenceDirection = bullCount >= bearCount ? 'BULL' : 'BEAR';
  const confluencePct = Math.round((dominantCount / totalSignals) * 100);

  const callOI = Math.max(0, m.callOI || 0);
  const putOI = Math.max(0, m.putOI || 0);
  const oiTotal = callOI + putOI;
  const putPct = oiTotal > 0 ? Math.round((putOI / oiTotal) * 100) : 50;
  const callPct = 100 - putPct;

  const bullishProbability = Math.max(5, Math.min(95, Math.round((1 / (1 + Math.exp(-data.rawScore * 4))) * 100)));
  const bearishProbability = 100 - bullishProbability;

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

      {/* Institutional Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        <div className="bg-slate-800/40 rounded-lg border border-slate-700/20 p-2">
          <p className="text-[8px] text-slate-500 uppercase tracking-wider mb-1">Sentiment</p>
          <p className={`text-[10px] font-mono font-bold ${metrics.sentimentScore > 0 ? 'text-emerald-400' : metrics.sentimentScore < 0 ? 'text-red-400' : 'text-slate-400'}`}>
            {metrics.sentimentScore > 0 ? '+' : ''}{metrics.sentimentScore.toFixed(0)}
          </p>
        </div>
        <div className="bg-slate-800/40 rounded-lg border border-slate-700/20 p-2">
          <p className="text-[8px] text-slate-500 uppercase tracking-wider mb-1">Volatility</p>
          <p className="text-[10px] font-mono font-bold text-cyan-400">{metrics.volatilityScore.toFixed(0)}</p>
        </div>
        <div className="bg-slate-800/40 rounded-lg border border-slate-700/20 p-2">
          <p className="text-[8px] text-slate-500 uppercase tracking-wider mb-1">Regime</p>
          <p className="text-[10px] font-mono font-bold text-indigo-400">{metrics.regimeStrength.toFixed(0)}</p>
        </div>
        <div className="bg-slate-800/40 rounded-lg border border-slate-700/20 p-2">
          <p className="text-[8px] text-slate-500 uppercase tracking-wider mb-1">R:R Edge</p>
          <p className="text-[10px] font-mono font-bold text-purple-400">{metrics.riskRewardEdge.toFixed(1)}</p>
        </div>
      </div>

      {/* Edge Details Button */}
      <button
        type="button"
        onClick={() => setIsExpanded(v => !v)}
        className="w-full flex items-center justify-between rounded-lg border border-slate-700/35 bg-slate-800/35 px-3 py-2 mb-3 text-left transition-colors duration-150 hover:bg-slate-800/50"
      >
        <div className="min-w-0">
          <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500">Edge Details</div>
          <div className="mt-0.5 text-[10px] font-medium text-slate-300">
            {isExpanded ? 'Full analysis' : 'Expand view'}
          </div>
        </div>
        <span className="shrink-0 text-[10px] font-bold text-slate-400">{isExpanded ? 'Hide' : 'Show'}</span>
      </button>

      {!isExpanded && (
        <div className="grid grid-cols-3 gap-1.5 mb-3">
          <div className="rounded-lg bg-slate-800/40 border border-slate-700/20 p-1.5 text-center">
            <span className="text-[9px] text-slate-500 block">IV Rank</span>
            <span className="text-xs font-bold font-mono text-amber-400">{m.ivRank.toFixed(0)}</span>
          </div>
          <div className="rounded-lg bg-slate-800/40 border border-slate-700/20 p-1.5 text-center">
            <span className="text-[9px] text-slate-500 block">Bias</span>
            <span className={`text-xs font-bold ${data.direction === 'BULLISH' ? 'text-emerald-400' : data.direction === 'BEARISH' ? 'text-red-400' : 'text-slate-400'}`}>{data.direction}</span>
          </div>
          <div className="rounded-lg bg-slate-800/40 border border-slate-700/20 p-1.5 text-center">
            <span className="text-[9px] text-slate-500 block">Score</span>
            <span className={`text-xs font-bold font-mono ${data.rawScore > 0 ? 'text-emerald-400' : data.rawScore < 0 ? 'text-red-400' : 'text-slate-400'}`}>{data.rawScore > 0 ? '+' : ''}{data.rawScore.toFixed(3)}</span>
          </div>
        </div>
      )}

      {isExpanded && (
        <>

        {/* Opportunities Section */}
        {opportunities.length > 0 && (
          <div className="mb-3 pb-3 border-b border-slate-700/30">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Risk/Reward Opportunities</p>
            <div className="grid grid-cols-1 gap-2 max-h-80 overflow-y-auto">
              {opportunities.map((opp, idx) => (
                <RiskRewardCard key={idx} opportunity={opp} />
              ))}
            </div>
          </div>
        )}

        {/* Institutional Metrics Full Display */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <InstitutionalSentimentGauge metrics={metrics} />
          <VolatilityRegimeIndicator metrics={metrics} />
        </div>

        {/* OI Profile Badge */}
        <div className={`flex items-center justify-between rounded-lg ${profileCfg.bg} px-2.5 py-1.5 mb-3 ${
          data.oiProfile === 'LONG_BUILDUP' ? 'border-2 border-emerald-400/70 shadow-[0_0_10px_rgba(16,185,129,0.35)]' :
          data.oiProfile === 'SHORT_BUILDUP' ? 'border-2 border-red-400/70 shadow-[0_0_10px_rgba(239,68,68,0.35)]' :
          'border border-slate-700/30'
        }`}>
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

        {/* Intelligence strip */}
        <div className="rounded-lg bg-slate-800/30 border border-slate-700/20 p-2.5 mb-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Signal Confluence</span>
          <span className={`text-[10px] font-bold ${
            confluenceDirection === 'BULL' ? 'text-emerald-300' : 'text-red-300'
          }`}>
            {dominantCount}/{totalSignals} {confluenceDirection} ({confluencePct}%)
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[9px]">
          <span className="text-emerald-400">BULL {bullCount}</span>
          <span className="text-red-400">BEAR {bearCount}</span>
          <span className="text-slate-500">NEUTRAL {neutralCount}</span>
          {confluencePct >= 67 && (
            <span className="ml-auto text-amber-300 font-bold">HIGH ALIGNMENT</span>
          )}
        </div>
        <div className="flex h-5 rounded overflow-hidden bg-slate-900/40 border border-slate-700/20">
          <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-500 flex items-center justify-center" style={{ width: `${bullishProbability}%` }}>
            <span className="text-[8px] font-bold text-white px-1 truncate">{bullishProbability}%↑</span>
          </div>
          <div className="h-full bg-gradient-to-l from-red-600 to-red-500 flex items-center justify-center" style={{ width: `${bearishProbability}%` }}>
            <span className="text-[8px] font-bold text-white px-1 truncate">{bearishProbability}%↓</span>
          </div>
        </div>
        {oiTotal > 0 && (
          <div>
            <div className="flex items-center justify-between text-[8px] mb-1">
              <span className="text-emerald-400/80 font-semibold">PUT {formatNumber(putOI)}</span>
              <span className="text-slate-600 uppercase tracking-wider">OI Split</span>
              <span className="text-red-400/80 font-semibold">CALL {formatNumber(callOI)}</span>
            </div>
            <div className="flex h-3 rounded overflow-hidden bg-slate-900/40 border border-slate-700/20">
              <div className="h-full bg-emerald-500/60" style={{ width: `${putPct}%` }} />
              <div className="h-full bg-red-500/60" style={{ width: `${callPct}%` }} />
            </div>
          </div>
        )}
        </div>

        {/* 6-Signal Breakdown (collapsed by default) */}
        <div className="rounded-lg bg-slate-800/30 border border-slate-700/20 p-2.5">
        <button
          type="button"
          onClick={() => setShowScoringEngine(v => !v)}
          className="w-full flex items-center gap-1.5"
        >
          <span className="text-xs">📡</span>
          <span className="text-[10px] sm:text-xs font-bold text-white">6-Signal Scoring Engine</span>
          <span className="text-[9px] text-slate-500 ml-auto font-mono">
            Score: <span className={data.rawScore > 0 ? 'text-emerald-400' : data.rawScore < 0 ? 'text-red-400' : 'text-amber-400'}>
              {data.rawScore > 0 ? '+' : ''}{data.rawScore.toFixed(3)}
            </span>
          </span>
          <span className="text-[10px] text-slate-500">{showScoringEngine ? 'Hide' : 'Show'}</span>
        </button>
        {showScoringEngine && (
          <div className="mt-2">
            {Object.entries(data.signals).map(([key, sig]) => (
              <SignalBar key={key} name={key} score={sig.score} signal={sig.signal} label={sig.label} weight={sig.weight} />
            ))}
          </div>
        )}
        </div>
        </>
      )}
    </div>
  );
});
EdgeCard.displayName = 'EdgeCard';

// ── Main Component ──────────────────────────────────────────────────────────

const MarketEdgeIntelligence = memo(() => {
  const { edgeData, isConnected, lastUpdate } = useMarketEdge();

  // Fixed section styling — no dynamic color swaps that cause flashing
  const sectionBorder = 'border-teal-500/30';
  const sectionBg = 'from-teal-950/20 via-dark-card/50 to-dark-elevated/40';
  const sectionGlow = 'shadow-md';

  return (
    <div className={`mt-6 sm:mt-6 border-2 ${sectionBorder} rounded-2xl p-3 sm:p-4 bg-gradient-to-br ${sectionBg} backdrop-blur-sm ${sectionGlow}`}>
      <div className="flex flex-col gap-1 mb-3 sm:mb-4">
        <SectionTitle
          title="MarketEdge Intelligence"
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
              <span className={`text-[9px] font-semibold ${isConnected ? 'text-emerald-300' : 'text-slate-400'}`}>
                {isConnected ? 'LIVE' : 'SYNC'}
              </span>
              <span className="text-[9px] text-slate-500">
                {lastUpdate ? new Date(lastUpdate).toLocaleTimeString('en-IN', { hour12: false }) : '--:--:--'}
              </span>
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
          <span>🔥 OI Spurts • ⚡ Live Momentum • 📊 IV • 📏 IV Rank • 📈 Fut OI • 💰 Basis</span>
        </div>
      </div>
    </div>
  );
});
MarketEdgeIntelligence.displayName = 'MarketEdgeIntelligence';

export default MarketEdgeIntelligence;
