'use client';

import React, { memo } from 'react';
import { TrendingUp, TrendingDown, Minus, Flame } from 'lucide-react';
import { useCandleIntentRealtime } from '@/hooks/useCandleIntentRealtime';

interface CandleIntentData {
  symbol: string;
  timestamp: string;
  current_candle: {
    open?: number;
    high?: number;
    low?: number;
    close: number;
    volume: number;
    range?: number;
    body_size?: number;
    upper_wick?: number;
    lower_wick?: number;
  };
  pattern: {
    type: string;
    intent: string;
    confidence: number;
    strength?: number;
    interpretation?: string;
  };
  wick_analysis: {
    upper_signal: string;
    lower_signal: string;
    dominant_wick: string;           // 'UPPER' | 'LOWER' | 'NEITHER'
    dominant_wick_note?: string;     // "Sellers in control" etc
    upper_wick_pct?: number;
    lower_wick_pct?: number;
    upper_strength?: number;
    lower_strength?: number;
    upper_interpretation?: string;
    lower_interpretation?: string;
  };
  body_analysis: {
    body_ratio_pct: number;
    is_bullish: boolean;
    strength: number;
    body_type?: string;
    color?: string;
    conviction?: string;
    interpretation?: string;
  };
  volume_analysis: {
    volume_ratio: number;
    efficiency: string;
    efficiency_interpretation?: string;
    volume_type?: string;
    volume_interpretation?: string;
    trap_detected?: boolean;
    trap_type?: string | null;
    trap_severity?: number;
    alert_level?: string;   // 'NORMAL'|'CAUTION'|'WARNING'|'DANGER'|'OPPORTUNITY'|'HIGHLIGHT'|'CRITICAL'
    volume?: number;
    avg_volume?: number;
  };
  near_zone: boolean;
  professional_signal: string;
  trap_status?: {
    is_trap: boolean;
    trap_type: string | null;
    severity: number;
    action_required: string;
  };
  visual_alert?: {
    icon: string;
    color: string;
    animation: string;
    priority: number;
    message: string;
  };
  status?: string;
  error?: string;
  data_status?: string;
  candles_analyzed?: number;
}

interface CandleIntentCardProps {
  symbol: string;
  name: string;
}

// Helper: Get trading signal based on candle analysis
const getCandleSignal = (data: CandleIntentData): string => {
  const { pattern, body_analysis, wick_analysis, volume_analysis, professional_signal } = data;
  
  // Use professional signal as base, but validate with pattern
  const profSignal = professional_signal || 'NEUTRAL';
  
  // Defensive checks for undefined data
  if (!body_analysis || !wick_analysis || !volume_analysis) {
    return profSignal === 'STRONG_BUY' ? 'STRONG BUY' : profSignal === 'STRONG_SELL' ? 'STRONG SELL' : 
           profSignal === 'BUY' ? 'BUY' : profSignal === 'SELL' ? 'SELL' : 'SIDEWAYS';
  }
  
  // Strong signals when all factors align
  if (profSignal === 'STRONG_BUY' && pattern.confidence >= 70 && body_analysis.is_bullish) {
    return 'STRONG BUY';
  }
  if (profSignal === 'STRONG_SELL' && pattern.confidence >= 70 && !body_analysis.is_bullish) {
    return 'STRONG SELL';
  }
  
  // Regular signals
  if (profSignal === 'BUY' || (body_analysis.is_bullish && body_analysis.strength >= 60)) {
    return 'BUY';
  }
  if (profSignal === 'SELL' || (!body_analysis.is_bullish && body_analysis.strength >= 60)) {
    return 'SELL';
  }
  
  // Check wick confirmation
  if (wick_analysis.lower_signal === 'BULLISH' && volume_analysis.volume_ratio >= 1.2) {
    return 'BUY';
  }
  if (wick_analysis.upper_signal === 'BEARISH' && volume_analysis.volume_ratio >= 1.2) {
    return 'SELL';
  }
  
  return 'SIDEWAYS';
};

// Helper: Calculate realistic confidence (35-85%)
const calculateCandleConfidence = (data: CandleIntentData): number => {
  let confidence = 50; // Base
  
  // Defensive check: if critical data is missing, return base confidence
  if (!data.body_analysis || !data.wick_analysis || !data.volume_analysis || !data.pattern) {
    return confidence;
  }
  
  // Pattern confidence (25% weight)
  const patternConf = data.pattern?.confidence ?? 0;
  if (patternConf >= 80) confidence += 18;
  else if (patternConf >= 65) confidence += 12;
  else if (patternConf >= 50) confidence += 6;
  else confidence -= 8;
  
  // Body strength (20% weight)
  const bodyStrength = data.body_analysis?.strength ?? 0;
  const bodyRatio = data.body_analysis?.body_ratio_pct ?? 0;
  if (bodyStrength >= 75 && bodyRatio >= 60) confidence += 15; // Decisive candle
  else if (bodyStrength >= 60) confidence += 8;
  else if (bodyRatio < 30) confidence -= 8; // Indecisive
  
  // Volume confirmation (20% weight) — skip penalty for spot indices (no traded volume)
  const volumeRatio = data.volume_analysis?.volume_ratio ?? 0;
  const volumeEff = data.volume_analysis?.efficiency ?? 0;
  const isSpotIndex = data.volume_analysis?.volume_type === 'SPOT_INDEX';
  if (!isSpotIndex) {
    if (volumeRatio >= 2.0 && volumeEff === 'ABSORPTION') confidence += 15;
    else if (volumeRatio >= 1.5) confidence += 10;
    else if (volumeRatio >= 1.2) confidence += 5;
    else if (volumeRatio < 0.8) confidence -= 10;
  } else {
    // Spot index: use efficiency-based bonus/penalty only
    if (volumeEff === 'HEALTHY') confidence += 8;
    else if (volumeEff === 'NEUTRAL') confidence += 0;
  }
  
  // Wick analysis (15% weight)
  const signal = getCandleSignal(data);
  const wickConfirms = 
    (signal === 'BUY' && data.wick_analysis?.lower_signal === 'BULLISH') ||
    (signal === 'SELL' && data.wick_analysis?.upper_signal === 'BEARISH');
  if (wickConfirms) confidence += 12;
  else if (data.wick_analysis?.dominant_wick === 'NEITHER') confidence -= 5;
  
  // Signal strength (10% weight)
  if (signal.includes('STRONG')) confidence += 8;
  else if (signal !== 'SIDEWAYS') confidence += 4;
  else confidence -= 5;
  
  // Near critical zone (5% weight)
  if (data.near_zone) confidence += 5;
  
  // Market status (5% weight)
  if (data.status === 'LIVE' || data.status === 'FRESH') confidence += 5;
  else if (data.status === 'CACHED') confidence -= 3;
  
  // Clamp to realistic range 35-85%
  return Math.min(85, Math.max(35, Math.round(confidence)));
};

// ─────────────────────────────────────────────────────────────────────────────
// 5-Min Prediction Engine
// Multi-factor weighted model — 7 inputs, single confidence output
// Max raw score = ±16 pts across all factors
// Confidence = how CERTAIN we are about direction (independent of direction itself)
// ─────────────────────────────────────────────────────────────────────────────
interface CandlePrediction {
  score: number;        // −16…+16
  label: string;        // STRONG UP | LIKELY UP | CHOPPY | LIKELY DOWN | STRONG DOWN
  color: string;
  confidence: number;   // 35–90%  — certainty of prediction
  upConf: number;       // directional % for bullish scenario
  downConf: number;     // directional % for bearish scenario
}

function computeCandlePrediction(data: CandleIntentData, overallConf: number): CandlePrediction {
  const body   = data.body_analysis;
  const wick   = data.wick_analysis;
  const vol    = data.volume_analysis;
  const pat    = data.pattern;
  const prof   = (data.professional_signal ?? 'NEUTRAL').toUpperCase();
  const isTrap = data.trap_status?.is_trap ?? false;

  // Defensive: if critical data is missing, return neutral prediction
  if (!body || !wick || !vol || !pat) {
    return {
      score: 0,
      label: 'INSUFFICIENT DATA',
      color: 'text-white/50',
      confidence: 35,
      upConf: 35,
      downConf: 35,
    };
  }

  let score = 0;

  // Factor 1: Body direction + strength  (max ±4)
  if (body.is_bullish) {
    score += body.strength >= 75 ? 4 : body.strength >= 55 ? 3 : body.body_ratio_pct >= 40 ? 2 : 1;
  } else {
    score -= body.strength >= 75 ? 4 : body.strength >= 55 ? 3 : body.body_ratio_pct >= 40 ? 2 : 1;
  }

  // Factor 2: Volume confirmation  (max ±3) — neutral for spot indices
  const vr = vol.volume_ratio;
  const isSpot = vol.volume_type === 'SPOT_INDEX';
  if (!isSpot) {
    if (body.is_bullish)  score += vr >= 2.0 ? 3 : vr >= 1.5 ? 2 : vr >= 1.2 ? 1 : vr < 0.8 ? -1 : 0;
    else                  score -= vr >= 2.0 ? 3 : vr >= 1.5 ? 2 : vr >= 1.2 ? 1 : vr < 0.8 ? -1 : 0;
  }

  // Factor 3: Wick rejection alignment  (max ±3)
  if (score > 0 && wick.lower_signal === 'BULLISH') score += wick.lower_strength && wick.lower_strength >= 70 ? 3 : 2;
  else if (score < 0 && wick.upper_signal === 'BEARISH') score -= wick.upper_strength && wick.upper_strength >= 70 ? 3 : 2;
  else if (wick.dominant_wick === 'NEITHER') score += 0; // no wick info

  // Factor 4: Pattern confidence  (max ±3)
  if (pat.confidence >= 80)       score += pat.intent === 'BULLISH' ? 3 : pat.intent === 'BEARISH' ? -3 : 0;
  else if (pat.confidence >= 65)  score += pat.intent === 'BULLISH' ? 2 : pat.intent === 'BEARISH' ? -2 : 0;
  else if (pat.confidence >= 50)  score += pat.intent === 'BULLISH' ? 1 : pat.intent === 'BEARISH' ? -1 : 0;

  // Factor 5: Professional signal alignment  (max ±2)
  if (prof === 'STRONG_BUY' || prof === 'BUY')   score += 2;
  else if (prof === 'STRONG_SELL' || prof === 'SELL') score -= 2;

  // Factor 6: Trap penalty  (−5 — kills signal reliability)
  if (isTrap) score = Math.sign(score) * Math.max(0, Math.abs(score) - 5);

  // Factor 7: Near key zone bonus  (+1 certainty of reaction)
  if (data.near_zone) score += score >= 0 ? 1 : -1;

  // ── Direction label (score ±16) ──
  let label: string, color: string;
  if      (score >= 8)  { label = 'STRONG UP';   color = 'text-teal-300'; }
  else if (score >= 4)  { label = 'LIKELY UP';   color = 'text-teal-400'; }
  else if (score <= -8) { label = 'STRONG DOWN'; color = 'text-rose-300'; }
  else if (score <= -4) { label = 'LIKELY DOWN'; color = 'text-rose-400'; }
  else                  { label = 'CHOPPY';       color = 'text-amber-300'; }

  // ── Confidence calculation ──
  // Measures HOW CERTAIN we are — separate from direction
  let conf = 38; // Base: no info = 38%

  // Score magnitude (+0…+34): higher divergence = more certainty
  conf += (Math.abs(score) / 16) * 34;

  // Body conviction
  if (body.body_ratio_pct >= 60 && body.strength >= 70) conf += 9;  // decisive candle
  else if (body.body_ratio_pct < 25) conf -= 10;                     // doji / spinning top

  // Volume quality — neutral for spot indices
  if (!isSpot) {
    if (vr >= 2.0) conf += 9;
    else if (vr >= 1.5) conf += 6;
    else if (vr >= 1.2) conf += 3;
    else if (vr < 0.8) conf -= 8;
  } else if (vol.efficiency === 'HEALTHY') {
    conf += 5; // structure-based healthy move bonus
  }

  // Pattern quality
  if (pat.confidence >= 80) conf += 6;
  else if (pat.confidence < 50) conf -= 5;

  // Wick confirms direction
  if (body.is_bullish  && wick.lower_signal === 'BULLISH') conf += 5;
  if (!body.is_bullish && wick.upper_signal === 'BEARISH') conf += 5;

  // Trap kills confidence
  if (isTrap) conf -= 14;

  // Live data
  if (data.status === 'LIVE' || data.status === 'FRESH') conf += 5;
  else if (data.status === 'CACHED') conf -= 4;

  const confidence = Math.round(Math.min(90, Math.max(35, conf)));

  // ── Directional confidence split ──
  const upConf   = score >= 0 ? confidence : Math.round(confidence * 0.35);
  const downConf = score <  0 ? confidence : Math.round(confidence * 0.35);

  return { score, label, color, confidence, upConf, downConf };
}

const CandleIntentCard = memo<CandleIntentCardProps>(({ symbol, name }) => {
  // 🔥 Use real-time hook for ultra-fast live updates
  const { data, loading, error, refetch } = useCandleIntentRealtime(symbol);

  const formatVolume = (vol: number): string => {
    if (vol >= 1000000) return `${(vol / 1000000).toFixed(2)}M`;
    if (vol >= 1000) return `${(vol / 1000).toFixed(2)}K`;
    return vol.toFixed(0);
  };

  const signal = data ? getCandleSignal(data) : 'SIDEWAYS';
  const confidence = data ? calculateCandleConfidence(data) : 50;
  const isLive = data?.status === 'LIVE' || data?.status === 'FRESH';
  const isBuy = signal === 'STRONG BUY' || signal === 'BUY';
  const isSell = signal === 'STRONG SELL' || signal === 'SELL';
  const accentBorder = isBuy ? 'border-teal-500/30' : isSell ? 'border-rose-500/25' : 'border-amber-500/25';
  const accentCorner = isBuy ? 'bg-teal-500' : isSell ? 'bg-rose-500' : 'bg-amber-500';
  const accentText = isBuy ? 'text-teal-300' : isSell ? 'text-rose-300' : 'text-amber-300';
  const accentBarBg = isBuy ? 'bg-teal-500' : isSell ? 'bg-rose-500' : 'bg-amber-500';
  const signalLabel = isBuy ? (signal === 'STRONG BUY' ? '▲ STRONG BUY' : '▲ BUY') : isSell ? (signal === 'STRONG SELL' ? '▼ STRONG SELL' : '▼ SELL') : '◆ SIDEWAYS';

  if (loading) {
    return (
      <div className={`relative rounded-2xl overflow-hidden border ${accentBorder} bg-[#0b0f1a] animate-pulse`}>
        <div className="p-4 h-40" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={`relative rounded-2xl overflow-hidden border border-rose-500/25 bg-[#0b0f1a] p-4`}>
        <div className="flex items-center gap-2 text-rose-300 font-semibold text-sm">
          <Flame className="w-4 h-4" />
          <span>{name}</span>
        </div>
        <p className="text-xs text-white/40 mt-2">{error || 'No data'}</p>
        <button
          onClick={refetch}
          className="mt-2 text-[10px] px-3 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 transition-colors"
        >Retry</button>
      </div>
    );
  }

  const isTrap = data.trap_status?.is_trap ?? false;
  const pred   = computeCandlePrediction(data, confidence);

  return (
    <div className={`relative rounded-2xl overflow-hidden border ${accentBorder} shadow-lg bg-[#0b0f1a] backdrop-blur-xl`}>
      {/* Top shimmer */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />
      {/* Corner glow */}
      <div className={`absolute top-0 right-0 w-14 h-14 rounded-bl-full opacity-[7%] ${accentCorner} pointer-events-none`} />

      {/* HEADER */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 text-white/40" />
          <span className="rounded-lg border border-green-500/60 bg-green-950/30 px-2.5 py-1.5 text-sm font-bold text-white">{name}</span>
          {isLive && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-teal-500/10 border border-teal-500/25">
              <span className="w-1 h-1 rounded-full bg-teal-400 animate-pulse" />
              <span className="text-[9px] text-teal-300 font-bold">LIVE</span>
            </span>
          )}
        </div>
        <span className="text-[10px] text-white/30 font-medium">CANDLE STRUCTURE</span>
      </div>

      {/* REFLECTOR SIGNAL PANEL */}
      <div className="mx-3 mb-3 rounded-xl bg-[#0d1117]/80 border border-white/[0.05] overflow-hidden">
        <div className={`h-px opacity-[5%] ${accentBarBg}`} />
        <div className="absolute top-[3.5rem] left-0 right-0 h-16 opacity-[5%] pointer-events-none"
          style={{ background: `linear-gradient(to bottom, var(--tw-gradient-from), transparent)` }} />
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <div className={`text-xl font-black tracking-tight ${accentText}`}>{signalLabel}</div>
            <div className="text-[10px] text-white/40 mt-0.5">
              {isBuy ? 'Bullish candle structure' : isSell ? 'Bearish candle structure' : 'Indecisive — wait for confirm'}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-white/40 mb-0.5">CONFIDENCE</div>
            <div className={`text-2xl font-black ${accentText}`}>{confidence}%</div>
          </div>
        </div>
        {/* Confidence bar */}
        <div className="mx-4 mb-3 h-1 rounded-full bg-white/[0.05] overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-700 ${accentBarBg}`} style={{ width: `${confidence}%` }} />
        </div>
        {/* Trap badge */}
        {isTrap && data.trap_status && (
          <div className="mx-4 mb-3 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/25 flex items-center justify-between">
            <span className="text-[10px] text-rose-300 font-bold">⚠ TRAP: {(data.trap_status?.trap_type ?? '').replace(/_/g, ' ')}</span>
            <span className="text-[10px] text-rose-300 font-bold">{data.trap_status?.severity ?? 0}%</span>
          </div>
        )}
      </div>

      {/* CONFERENCE GRID — 2×2 */}
      <div className="mx-3 mb-3 grid grid-cols-2 gap-2">
        {/* Pattern */}
        <div className="bg-[#0d1117] border border-white/[0.06] p-2.5 rounded-lg">
          <div className="text-[9px] text-white/35 uppercase tracking-widest mb-1">Pattern</div>
          <div className={`text-sm font-bold truncate ${
            data.pattern?.intent === 'BULLISH' ? 'text-teal-300' :
            data.pattern?.intent === 'BEARISH' ? 'text-rose-300' : 'text-amber-300'
          }`}>{data.pattern?.type || 'UNKNOWN'}</div>
          <div className="text-[9px] text-white/35 mt-0.5">{data.pattern?.confidence || 0}% conf</div>
        </div>
        {/* Body */}
        <div className="bg-[#0d1117] border border-white/[0.06] p-2.5 rounded-lg">
          <div className="text-[9px] text-white/35 uppercase tracking-widest mb-1">Body</div>
          <div className={`text-sm font-bold ${data.body_analysis?.is_bullish ? 'text-teal-300' : 'text-rose-300'}`}>
            {data.body_analysis?.is_bullish ? 'Bullish' : 'Bearish'}
          </div>
          <div className="text-[9px] text-white/35 mt-0.5">{(data.body_analysis?.body_ratio_pct ?? 0).toFixed(0)}% ratio</div>
        </div>
        {/* Volume */}
        <div className="bg-[#0d1117] border border-white/[0.06] p-2.5 rounded-lg">
          <div className="text-[9px] text-white/35 uppercase tracking-widest mb-1">Volume</div>
          <div className={`text-sm font-bold ${
            (data.volume_analysis?.volume_ratio ?? 0) >= 1.5 ? 'text-teal-300' :
            (data.volume_analysis?.volume_ratio ?? 0) >= 1.0 ? 'text-amber-300' : 'text-rose-300'
          }`}>{(data.volume_analysis?.volume_ratio ?? 0).toFixed(2)}x</div>
          <div className="text-[9px] text-white/35 mt-0.5">{formatVolume(data.current_candle?.volume || 0)}</div>
        </div>
        {/* Wick */}
        <div className="bg-[#0d1117] border border-white/[0.06] p-2.5 rounded-lg">
          <div className="text-[9px] text-white/35 uppercase tracking-widest mb-1">Wick</div>
          <div className={`text-sm font-bold ${
            data.wick_analysis?.dominant_wick === 'LOWER' ? 'text-teal-300' :
            data.wick_analysis?.dominant_wick === 'UPPER' ? 'text-rose-300' : 'text-white/50'
          }`}>
            {data.wick_analysis?.dominant_wick === 'LOWER' ? 'Lower' :
             data.wick_analysis?.dominant_wick === 'UPPER' ? 'Upper' : 'Balanced'}
          </div>
          <div className="text-[9px] text-white/35 mt-0.5">
            {data.wick_analysis?.dominant_wick === 'LOWER' ? 'Bulls rejecting' :
             data.wick_analysis?.dominant_wick === 'UPPER' ? 'Bears rejecting' : 'No rejection'}
          </div>
        </div>
      </div>

      {/* 5-MIN PREDICTION */}
      <div className="mx-3 mb-3 rounded-xl border border-white/[0.06] bg-[#0d1117] overflow-hidden">
        <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        {(() => {
          const isBuyCandle  = pred.label === 'STRONG UP'   || pred.label === 'LIKELY UP';
          const isSellCandle = pred.label === 'STRONG DOWN' || pred.label === 'LIKELY DOWN';
          const adjConf  = pred.confidence; // 35–90%, 7-factor weighted (body, vol, wick, pattern, signal, trap, zone)
          const predDir  = isBuyCandle ? 'LONG' : isSellCandle ? 'SHORT' : 'FLAT';
          const dirIcon  = isBuyCandle ? '▲' : isSellCandle ? '▼' : '─';
          const dirColor  = isBuyCandle ? 'text-teal-300'  : isSellCandle ? 'text-rose-300'  : 'text-amber-300';
          const dirBorder = isBuyCandle ? 'border-teal-500/40' : isSellCandle ? 'border-rose-500/35' : 'border-amber-500/30';
          const dirBg     = isBuyCandle ? 'bg-teal-500/[0.07]' : isSellCandle ? 'bg-rose-500/[0.07]' : 'bg-amber-500/[0.05]';
          const barColor  = isBuyCandle ? 'bg-teal-500'    : isSellCandle ? 'bg-rose-500'    : 'bg-amber-500';

          const isTrap = data.trap_status?.is_trap ?? false;
          const vr = data.volume_analysis?.volume_ratio ?? 0;
          const bodyRatio = data.body_analysis?.body_ratio_pct ?? 0;
          const bodyStrength = data.body_analysis?.strength ?? 0;
          const patConf = data.pattern?.confidence ?? 0;
          const volEff = data.volume_analysis?.efficiency ?? 0;
          
          // Candle-specific momentum indicators (4-row grid)
          const patternQuality = patConf >= 80 ? 'Very High' : patConf >= 65 ? 'High' : patConf >= 50 ? 'Moderate' : 'Low';
          const patternQualityColor = patConf >= 80 ? 'text-teal-300' : patConf >= 65 ? 'text-teal-400' : 'text-amber-300';
          
          const bodyType = bodyRatio >= 70 ? 'Very Decisive' : bodyRatio >= 50 ? 'Decisive' : bodyRatio >= 30 ? 'Moderate' : 'Indecisive';
          const bodyTypeColor = bodyRatio >= 70 ? 'text-teal-300' : bodyRatio >= 50 ? 'text-teal-400' : bodyRatio >= 30 ? 'text-amber-300' : 'text-rose-300';
          
          const volumeQuality = vr >= 2.0 ? 'Strong' : vr >= 1.5 ? 'Good' : vr >= 1.0 ? 'Fair' : 'Weak';
          const volumeQualityColor = vr >= 2.0 ? 'text-teal-300' : vr >= 1.5 ? 'text-teal-400' : vr >= 1.0 ? 'text-amber-300' : 'text-rose-300';
          
          const wickType = data.wick_analysis?.dominant_wick === 'LOWER' ? 'Lower Wick' : data.wick_analysis?.dominant_wick === 'UPPER' ? 'Upper Wick' : 'Balanced';
          const wickTypeColor = data.wick_analysis?.dominant_wick === 'LOWER' ? 'text-teal-300' : data.wick_analysis?.dominant_wick === 'UPPER' ? 'text-rose-300' : 'text-white/50';
          
          // Actual Market Confidence (independent from predicted)
          let actualMarketConf = 50;
          if (isBuyCandle) {
            actualMarketConf = Math.min(95, Math.max(30, 
              (bodyRatio >= 60 && bodyStrength >= 70 ? 35 : bodyRatio >= 45 ? 25 : 15) +
              (vr >= 1.8 ? 25 : vr >= 1.2 ? 15 : 5) +
              (data.wick_analysis?.lower_signal === 'BULLISH' ? 20 : 10) +
              (patConf >= 75 ? 15 : 0)
            ));
          } else if (isSellCandle) {
            actualMarketConf = Math.min(95, Math.max(30, 
              (bodyRatio >= 60 && bodyStrength >= 70 ? 35 : bodyRatio >= 45 ? 25 : 15) +
              (vr >= 1.8 ? 25 : vr >= 1.2 ? 15 : 5) +
              (data.wick_analysis?.upper_signal === 'BEARISH' ? 20 : 10) +
              (patConf >= 75 ? 15 : 0)
            ));
          } else {
            actualMarketConf = 33;
          }
          
          // Building confirmation list (for 5m prediction context)
          const confirms = [];
          if (bodyRatio >= 60) confirms.push('✓ Decisive body');
          if (vr >= 1.5) confirms.push('✓ Volume confirms');
          if (data.wick_analysis?.lower_signal === 'BULLISH' && isBuyCandle) confirms.push('✓ Lower wick bulls');
          if (data.wick_analysis?.upper_signal === 'BEARISH' && isSellCandle) confirms.push('✓ Upper wick bears');
          if (!isTrap && patConf >= 70) confirms.push('✓ Pattern clear');
          if (data.near_zone) confirms.push('✓ Near key zone');
          
          // Early signal detection
          const showEarlySignal = (adjConf >= 75) || (confirms.length >= 2);
          
          const ctxNote = isTrap
            ? '⚠ Trap detected — avoid'
            : (pred.label === 'STRONG UP' || pred.label === 'STRONG DOWN')
            ? 'Strong body + volume confirm'
            : data.near_zone ? 'Near key zone — sharp move'
            : (isBuyCandle && data.wick_analysis?.lower_signal === 'BULLISH') ? 'Body + lower wick confirm'
            : (isSellCandle && data.wick_analysis?.upper_signal === 'BEARISH') ? 'Body + upper wick confirm'
            : 'Watching candle structure…';

          return (
            <div className="px-4 py-3 space-y-3">
              {/* Header */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-gray-400 uppercase">5-Min Prediction</span>
                <span className={`text-[10px] font-bold px-2 py-1 rounded ${dirColor} bg-black/40 border border-white/[0.05]`}>{adjConf}% CONFIDENCE</span>
              </div>
              
              {/* Dual Confidence Display */}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-black/40 border border-white/[0.05] rounded-lg p-2.5">
                  <div className="text-[9px] text-white/40 mb-1">CONFIDENCE</div>
                  <div className={`text-[13px] font-bold ${dirColor} mb-1.5`}>{adjConf}%</div>
                  <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                    <div suppressHydrationWarning className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${adjConf}%` }} />
                  </div>
                </div>
                <div className="bg-black/40 border border-white/[0.05] rounded-lg p-2.5">
                  <div className="text-[9px] text-white/40 mb-1">Market</div>
                  <div className={`text-[13px] font-bold ${dirColor} mb-1.5`}>{actualMarketConf}%</div>
                  <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                    <div suppressHydrationWarning className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${actualMarketConf}%` }} />
                  </div>
                </div>
              </div>
              
              {/* Direction + Status */}
              <div className={`rounded-lg border ${dirBorder} ${dirBg} px-3 py-2.5`}>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className={`text-sm font-black ${dirColor}`}>{dirIcon} {predDir}</span>
                  <span className="text-[9px] text-white/30 truncate flex-1">{ctxNote}</span>
                </div>
                <div className="h-[2px] bg-white/[0.06] rounded-full overflow-hidden">
                  <div suppressHydrationWarning className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${adjConf}%` }} />
                </div>
              </div>
              
              {/* Candle Momentum Indicators (4-row grid) */}
              <div className="space-y-1.5 bg-gray-900/30 rounded-lg p-2.5">
                <div className="flex items-center justify-between text-[9px]">
                  <span className="text-white/40">Pattern Quality</span>
                  <span className={`font-bold ${patternQualityColor}`}>{patternQuality} ({patConf}%)</span>
                </div>
                <div className="flex items-center justify-between text-[9px]">
                  <span className="text-white/40">Body Conviction</span>
                  <span className={`font-bold ${bodyTypeColor}`}>{bodyType} ({bodyRatio.toFixed(0)}%)</span>
                </div>
                <div className="flex items-center justify-between text-[9px]">
                  <span className="text-white/40">Volume Quality</span>
                  <span className={`font-bold ${volumeQualityColor}`}>{volumeQuality} ({vr.toFixed(1)}x)</span>
                </div>
                <div className="flex items-center justify-between text-[9px]">
                  <span className="text-white/40">Wick Analysis</span>
                  <span className={`font-bold ${wickTypeColor}`}>{wickType}</span>
                </div>
              </div>
              
              {/* Movement Probability Distribution */}
              <div className="flex items-center gap-0.5 h-6 bg-black/30 rounded-lg p-1">
                <div className="flex-1 h-full rounded" style={{
                  background: isBuyCandle ? 'linear-gradient(to right, #0d9488, #14b8a6)' : 'transparent',
                  opacity: isBuyCandle ? 0.8 : 0.2,
                }} />
                <div className="flex-1 h-full rounded" style={{
                  background: isSellCandle ? 'linear-gradient(to right, #be123c, #e11d48)' : 'transparent',
                  opacity: isSellCandle ? 0.8 : 0.2,
                }} />
              </div>
              {isBuyCandle && (
                <div className="text-[8px] text-center text-teal-300 font-bold">Bullish {Math.round((adjConf / 95) * 100)}% | Bearish {Math.round((100 - (adjConf / 95) * 100))}%</div>
              )}
              {isSellCandle && (
                <div className="text-[8px] text-center text-rose-300 font-bold">Bullish {Math.round((100 - (adjConf / 95) * 100))}% | Bearish {Math.round((adjConf / 95) * 100)}%</div>
              )}
              {!isBuyCandle && !isSellCandle && (
                <div className="text-[8px] text-center text-amber-300 font-bold">Uncertain — Balanced</div>
              )}
              
              {/* Early Signal Detection */}
              {showEarlySignal && (
                <div className={`rounded-lg px-3 py-2 border-t-2 ${dirBorder}`}>
                  <div className={`text-[11px] font-bold ${dirColor} text-center`}>
                    ⚡ {adjConf >= 85 ? 'STRONG' : 'CONFIRMED'} {predDir} Signal Ready
                  </div>
                </div>
              )}
              
              {/* Confirmation Summary */}
              {confirms.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {confirms.map((conf, idx) => (
                    <span key={idx} className="text-[9px] font-bold px-2 py-1 rounded bg-teal-500/30 text-teal-300 border border-teal-500/40">
                      {conf}
                    </span>
                  ))}
                </div>
              )}
              
              {/* Summary Line */}
              <div className={`text-center text-[10px] font-bold px-3 py-1.5 rounded-lg border ${dirBorder} ${dirBg} ${dirColor}`}>
                {predDir} · {adjConf}% Pred · {actualMarketConf}% Market · {confirms.length} Confirms
              </div>
            </div>
          );
        })()}
      </div>

      {/* Near Zone Alert */}
      {data.near_zone && (
        <div className="mx-3 mb-3 px-3 py-1.5 rounded-lg bg-sky-500/10 border border-sky-500/20">
          <span className="text-[10px] text-sky-300 font-medium">⚡ Near key support/resistance zone</span>
        </div>
      )}

      {/* Bottom shimmer */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/8 to-transparent pointer-events-none" />
    </div>
  );
});

CandleIntentCard.displayName = 'CandleIntentCard';

export default CandleIntentCard;
