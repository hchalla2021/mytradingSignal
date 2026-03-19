'use client';

import React, { memo } from 'react';
import { Flame } from 'lucide-react';
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
  const { data, loading, error, refetch } = useCandleIntentRealtime(symbol);

  // ── Pre-compute everything outside JSX for speed ──
  const signal = data ? getCandleSignal(data) : 'SIDEWAYS';
  const confidence = data ? calculateCandleConfidence(data) : 50;
  const isLive = data?.status === 'LIVE' || data?.status === 'FRESH';
  const isBuy = signal === 'STRONG BUY' || signal === 'BUY';
  const isSell = signal === 'STRONG SELL' || signal === 'SELL';
  const isStrong = signal === 'STRONG BUY' || signal === 'STRONG SELL';

  // Direction palette — single source of truth
  const dir = isBuy ? 'buy' : isSell ? 'sell' : 'neutral';
  const palette = {
    buy:     { border: 'border-emerald-500/30', bg: 'from-emerald-950/20', bar: 'bg-emerald-500', text: 'text-emerald-400', muted: 'text-emerald-400/70', badge: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300', glow: 'shadow-emerald-500/10' },
    sell:    { border: 'border-red-500/25',     bg: 'from-red-950/20',     bar: 'bg-red-500',     text: 'text-red-400',     muted: 'text-red-400/70',     badge: 'bg-red-500/15 border-red-500/40 text-red-300',         glow: 'shadow-red-500/10' },
    neutral: { border: 'border-slate-600/30',   bg: 'from-slate-900/20',   bar: 'bg-amber-500',   text: 'text-amber-400',   muted: 'text-amber-400/70',   badge: 'bg-amber-500/15 border-amber-500/40 text-amber-300',   glow: 'shadow-slate-500/5' },
  }[dir];

  const pred = data ? computeCandlePrediction(data, confidence) : null;
  const predBuy  = pred?.label === 'STRONG UP' || pred?.label === 'LIKELY UP';
  const predSell = pred?.label === 'STRONG DOWN' || pred?.label === 'LIKELY DOWN';
  const predDir  = predBuy ? 'LONG' : predSell ? 'SHORT' : 'WAIT';

  // Confirmation factors (compact)
  const confirms: string[] = [];
  if (data) {
    const br = data.body_analysis?.body_ratio_pct ?? 0;
    const vr = data.volume_analysis?.volume_ratio ?? 0;
    if (br >= 55) confirms.push('Body');
    if (vr >= 1.3) confirms.push('Volume');
    if (isBuy && data.wick_analysis?.lower_signal === 'BULLISH') confirms.push('Wick');
    if (isSell && data.wick_analysis?.upper_signal === 'BEARISH') confirms.push('Wick');
    if ((data.pattern?.confidence ?? 0) >= 65) confirms.push('Pattern');
    if (data.near_zone) confirms.push('Zone');
  }

  const isTrap = data?.trap_status?.is_trap ?? false;

  if (loading) {
    return (
      <div className={`rounded-2xl border ${palette.border} bg-[#0b0f1a] animate-pulse`}>
        <div className="p-4 h-36" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-red-500/25 bg-[#0b0f1a] p-4">
        <div className="flex items-center gap-2 text-red-300 font-semibold text-sm">
          <Flame className="w-4 h-4" />
          <span>{name}</span>
        </div>
        <p className="text-xs text-white/40 mt-2">{error || 'No data'}</p>
        <button onClick={refetch} className="mt-2 text-[10px] px-3 py-1 rounded-full bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30 transition-colors">Retry</button>
      </div>
    );
  }

  return (
    <div className={`relative rounded-2xl border ${palette.border} bg-gradient-to-b ${palette.bg} to-[#0b0f1a] shadow-lg ${palette.glow} overflow-hidden`}>

      {/* ═══ ROW 1: Header — Symbol + Live + Signal Badge ═══ */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-1">
        <div className="flex items-center gap-2">
          <span className="rounded-lg border border-green-500/60 bg-green-950/30 px-2 py-1 text-sm font-bold text-white tracking-wide">{name}</span>
          {isLive && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/25">
              <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute h-full w-full rounded-full bg-emerald-400 opacity-75" /><span className="relative rounded-full h-1.5 w-1.5 bg-emerald-500" /></span>
              <span className="text-[9px] text-emerald-300 font-bold">LIVE</span>
            </span>
          )}
        </div>
        {/* Main signal badge — THE trade decision at a glance */}
        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-black tracking-wide ${palette.badge}`}>
          {isBuy ? '▲' : isSell ? '▼' : '◆'} {signal}
        </span>
      </div>

      {/* ═══ ROW 2: Confidence + 5m Prediction — side by side hero strip ═══ */}
      <div className="mx-3 mt-2 grid grid-cols-2 gap-2">
        {/* Signal Confidence */}
        <div className="rounded-xl bg-slate-900/60 border border-white/[0.06] px-3 py-2.5">
          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">Confidence</div>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span className={`text-2xl font-black tabular-nums ${palette.text}`}>{confidence}%</span>
            <span className={`text-[10px] font-semibold ${isStrong ? palette.text : 'text-slate-500'}`}>{isStrong ? 'STRONG' : confidence >= 65 ? 'GOOD' : 'MODERATE'}</span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-500 ${palette.bar}`} style={{ width: `${confidence}%` }} />
          </div>
        </div>
        {/* 5-Min Prediction */}
        <div className="rounded-xl bg-slate-900/60 border border-white/[0.06] px-3 py-2.5">
          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">5-Min Prediction</div>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span className={`text-2xl font-black tabular-nums ${predBuy ? 'text-emerald-400' : predSell ? 'text-red-400' : 'text-amber-400'}`}>
              {predBuy ? '▲' : predSell ? '▼' : '─'} {predDir}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-500 ${predBuy ? 'bg-emerald-500' : predSell ? 'bg-red-500' : 'bg-amber-500'}`} style={{ width: `${pred?.confidence ?? 40}%` }} />
          </div>
          <div className={`text-[9px] font-semibold mt-0.5 tabular-nums ${predBuy ? 'text-emerald-400/70' : predSell ? 'text-red-400/70' : 'text-amber-400/70'}`}>{pred?.confidence ?? 40}% certain</div>
        </div>
      </div>

      {/* ═══ ROW 3: Trap Warning (conditional) ═══ */}
      {isTrap && data.trap_status && (
        <div className="mx-3 mt-2 flex items-center justify-between px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30">
          <span className="text-[10px] text-red-300 font-bold">⚠ TRAP: {(data.trap_status.trap_type ?? '').replace(/_/g, ' ')}</span>
          <span className="text-[10px] text-red-300/70 font-bold">{data.trap_status.severity ?? 0}% severity</span>
        </div>
      )}

      {/* ═══ ROW 4: 4-Factor Analysis — compact horizontal strip ═══ */}
      <div className="mx-3 mt-2 grid grid-cols-4 gap-1.5">
        {/* Pattern */}
        <div className="bg-slate-900/50 rounded-lg px-2 py-2 text-center">
          <div className="text-[8px] text-slate-500 font-bold uppercase tracking-wider">Pattern</div>
          <div className={`text-[11px] font-bold mt-0.5 truncate ${
            data.pattern?.intent === 'BULLISH' ? 'text-emerald-400' :
            data.pattern?.intent === 'BEARISH' ? 'text-red-400' : 'text-amber-400'
          }`}>{data.pattern?.type || '—'}</div>
          <div className="text-[8px] text-slate-600 mt-0.5">{data.pattern?.confidence || 0}%</div>
        </div>
        {/* Body */}
        <div className="bg-slate-900/50 rounded-lg px-2 py-2 text-center">
          <div className="text-[8px] text-slate-500 font-bold uppercase tracking-wider">Body</div>
          <div className={`text-[11px] font-bold mt-0.5 ${data.body_analysis?.is_bullish ? 'text-emerald-400' : 'text-red-400'}`}>
            {(data.body_analysis?.body_ratio_pct ?? 0).toFixed(0)}%
          </div>
          <div className="text-[8px] text-slate-600 mt-0.5">{data.body_analysis?.is_bullish ? 'Bullish' : 'Bearish'}</div>
        </div>
        {/* Volume */}
        <div className="bg-slate-900/50 rounded-lg px-2 py-2 text-center">
          <div className="text-[8px] text-slate-500 font-bold uppercase tracking-wider">Volume</div>
          <div className={`text-[11px] font-bold mt-0.5 ${
            (data.volume_analysis?.volume_ratio ?? 0) >= 1.5 ? 'text-emerald-400' :
            (data.volume_analysis?.volume_ratio ?? 0) >= 1.0 ? 'text-amber-400' : 'text-red-400'
          }`}>{(data.volume_analysis?.volume_ratio ?? 0).toFixed(1)}x</div>
          <div className="text-[8px] text-slate-600 mt-0.5">{data.volume_analysis?.efficiency || '—'}</div>
        </div>
        {/* Wick */}
        <div className="bg-slate-900/50 rounded-lg px-2 py-2 text-center">
          <div className="text-[8px] text-slate-500 font-bold uppercase tracking-wider">Wick</div>
          <div className={`text-[11px] font-bold mt-0.5 ${
            data.wick_analysis?.dominant_wick === 'LOWER' ? 'text-emerald-400' :
            data.wick_analysis?.dominant_wick === 'UPPER' ? 'text-red-400' : 'text-slate-500'
          }`}>
            {data.wick_analysis?.dominant_wick === 'LOWER' ? '↓ Reject' :
             data.wick_analysis?.dominant_wick === 'UPPER' ? '↑ Reject' : '— None'}
          </div>
          <div className="text-[8px] text-slate-600 mt-0.5">
            {data.wick_analysis?.dominant_wick === 'LOWER' ? 'Bulls' :
             data.wick_analysis?.dominant_wick === 'UPPER' ? 'Bears' : 'Balanced'}
          </div>
        </div>
      </div>

      {/* ═══ ROW 5: Confirmation Tags + Trade Readiness ═══ */}
      <div className="mx-3 mt-2 mb-3 flex items-center gap-1.5 flex-wrap">
        {confirms.length > 0 ? confirms.map((c, i) => (
          <span key={i} className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
            isBuy ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
            isSell ? 'bg-red-500/10 border-red-500/30 text-red-400' :
            'bg-amber-500/10 border-amber-500/30 text-amber-400'
          }`}>✓ {c}</span>
        )) : (
          <span className="text-[9px] text-slate-600 italic">No confirmations yet</span>
        )}
        {/* Trade readiness indicator */}
        <span className="ml-auto text-[9px] font-bold">
          {confirms.length >= 3 && !isTrap ? (
            <span className={`px-2 py-0.5 rounded-md ${palette.badge}`}>
              ⚡ {confirms.length}/{5} Ready
            </span>
          ) : isTrap ? (
            <span className="px-2 py-0.5 rounded-md bg-red-500/15 border border-red-500/30 text-red-300">
              ⚠ Avoid
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700/50 text-slate-500">
              {confirms.length}/{5} Wait
            </span>
          )}
        </span>
      </div>

      {/* Near Zone strip */}
      {data.near_zone && (
        <div className="mx-3 mb-3 px-3 py-1 rounded-md bg-sky-500/8 border border-sky-500/20 text-center">
          <span className="text-[9px] text-sky-300 font-semibold">⚡ Near key support/resistance — expect sharp reaction</span>
        </div>
      )}
    </div>
  );
});

CandleIntentCard.displayName = 'CandleIntentCard';

export default CandleIntentCard;
