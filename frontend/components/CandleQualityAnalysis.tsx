'use client';

import React, { memo, useMemo, useEffect, useState } from 'react';

interface CandleQualityData {
  symbol: string;
  symbol_name?: string;
  candle_quality_signal: string;
  candle_quality_confidence: number;
  candle_direction: string;
  candle_strength: number;
  body_percent: number;
  volume_above_threshold: boolean;
  fake_spike_detected: boolean;
  conviction_move: boolean;
  momentum_score: number;
  current_price: number;
  current_volume: number;
  open_price: number;
  high_price: number;
  low_price: number;
  timestamp?: string;
}

interface CandleQualityAnalysisProps {
  symbol: string;
}

/**
 * High Volume Candle Scanner
 * LIVE Data version - Real-time Fake Spike Detection, Body Strength, Very Good Volume, Conviction Moves
 * 
 * Detects:
 * - Conviction Moves: High volume + strong body (>60%)
 * - Fake Spikes: Volume spike (>2.5x) but weak body (<40%)
 * - Body Strength: Candle body as % of range
 * - Very Good Volume: Exceptional volume above threshold
 */
const CandleQualityAnalysis = memo<CandleQualityAnalysisProps>(({ symbol }) => {
  const [data, setData] = useState<CandleQualityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch LIVE candle quality data
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
        const response = await fetch(`${apiUrl}/api/analysis/candle-quality/${symbol}`, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache'
          }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result && result.candle_quality_signal !== undefined) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        console.error(`[${symbol}] Error fetching candle quality data:`, err);
        setError('Unable to fetch candle data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 3000); // 🔥 FIX: Reduced to 3s for live updates during market hours
    
    return () => clearInterval(interval);
  }, [symbol]);

  const signalAnalysis = useMemo(() => {
    if (!data) {
      return {
        signal: 'NEUTRAL',
        badgeEmoji: '⚪',
        signalColor: 'bg-amber-500/20 border-amber-500/40 text-amber-300',
        textColor: 'text-amber-300',
        confidence: 30,
        symbol: symbol || 'INDEX'
      };
    }

    const { candle_quality_signal, candle_quality_confidence } = data;
    const signal = candle_quality_signal || 'NEUTRAL';
    // 🔥 FIX: Confidence comes from backend as 0-100 already
    const confidence = Math.round(
      typeof candle_quality_confidence === 'number' && candle_quality_confidence > 1 
        ? candle_quality_confidence 
        : (candle_quality_confidence * 100) || 30
    );
    const symbolName = data.symbol_name || data.symbol || symbol;

    let badgeEmoji = '⚪';
    let signalColor = 'bg-amber-500/20 border-amber-500/40 text-amber-300';
    let textColor = 'text-amber-300';

    // 🔥 Enhanced signal matching with all variants
    const normalizedSignal = String(signal || '').toUpperCase();
    
    if (normalizedSignal.includes('STRONG_BUY') || normalizedSignal === 'STRONG BUY') {
      badgeEmoji = '🚀';
      signalColor = 'bg-green-500/20 border-green-500/50 text-green-300';
      textColor = 'text-green-300';
    } else if (normalizedSignal === 'BUY' || normalizedSignal === 'BULLISH') {
      badgeEmoji = '📈';
      signalColor = 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300';
      textColor = 'text-emerald-300';
    } else if (normalizedSignal.includes('STRONG_SELL') || normalizedSignal === 'STRONG SELL') {
      badgeEmoji = '📉';
      signalColor = 'bg-red-500/20 border-red-500/50 text-red-300';
      textColor = 'text-red-300';
    } else if (normalizedSignal === 'SELL' || normalizedSignal === 'BEARISH') {
      badgeEmoji = '📊';
      signalColor = 'bg-rose-500/20 border-rose-500/40 text-rose-300';
      textColor = 'text-rose-300';
    } else if (normalizedSignal === 'WAIT') {
      badgeEmoji = '⏸️';
      signalColor = 'bg-orange-500/20 border-orange-500/40 text-orange-300';
      textColor = 'text-orange-300';
    }

    return { signal, badgeEmoji, signalColor, textColor, confidence, symbol: symbolName };
  }, [data, symbol]);

  // ── Derive direction flags from signalAnalysis (must be before early returns) ──
  const isBuy  = signalAnalysis.signal.includes('BUY')  || signalAnalysis.signal === 'BULLISH';
  const isSell = signalAnalysis.signal.includes('SELL') || signalAnalysis.signal === 'BEARISH';

  // ── 5-Min Prediction confidence (direction-aware, continuous) ──
  const volConfidence = useMemo(() => {
    if (!data) return 50;
    const bp  = data.body_percent    || 0;
    const mom = data.momentum_score  || 50;

    let base: number;
    if (bp >= 55)      base = 65 + (bp - 55) * (20 / 45);
    else if (bp >= 30) base = 52 + (bp - 30) * (13 / 25);
    else               base = Math.max(35, 35 + bp * (17 / 30));

    const momAdj = isBuy  ? ((mom - 50) / 50) * 8
                 : isSell ? ((50 - mom) / 50) * 8
                 : (Math.abs(mom - 50) / 50) * 8;
    base += momAdj;

    if (data.volume_above_threshold) base *= 1.08;
    if (data.conviction_move)        base *= 1.05;
    if (data.fake_spike_detected)    base *= 0.82;

    return Math.min(90, Math.max(35, Math.round(base)));
  }, [data, isBuy, isSell]);

  // ── Stable derived values (memoized to prevent flickering) ──
  const actualMarketConf = useMemo(() => {
    if (!data) return 50;
    const mult = data.conviction_move ? 1.05 : data.fake_spike_detected ? 0.85 : 1.0;
    return Math.min(95, Math.max(30, Math.round(volConfidence * mult)));
  }, [volConfidence, data]);

  const bullProb = useMemo(() => {
    if (isBuy)  return Math.max(5, Math.min(95, volConfidence));
    if (isSell) return Math.max(5, Math.min(95, 100 - volConfidence));
    return 50;
  }, [isBuy, isSell, volConfidence]);
  const bearProb = 100 - bullProb;

  // Loading state
  if (loading && !data) {
    return (
      <div className="relative rounded-2xl overflow-hidden border border-white/[0.07] bg-[#0b0f1a] backdrop-blur-xl p-4 animate-pulse">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
        <div className="flex items-center justify-between mb-3">
          <div className="space-y-1.5">
            <div className="h-2 w-28 bg-white/[0.06] rounded" />
            <div className="h-3 w-40 bg-white/[0.06] rounded" />
          </div>
          <div className="h-8 w-8 bg-white/[0.06] rounded-full" />
        </div>
        <div className="h-14 bg-white/[0.04] rounded-xl mb-2" />
        <div className="grid grid-cols-2 gap-1.5">
          <div className="h-10 bg-white/[0.03] rounded-lg" />
          <div className="h-10 bg-white/[0.03] rounded-lg" />
          <div className="h-10 bg-white/[0.03] rounded-lg" />
          <div className="h-10 bg-white/[0.03] rounded-lg" />
        </div>
      </div>
    );
  }

  // Error state
  if (error && !data) {
    return (
      <div className="relative rounded-2xl overflow-hidden border border-red-500/20 bg-[#0b0f1a] backdrop-blur-xl p-4">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-red-500/25 to-transparent" />
        <p className="text-[9px] text-slate-500 uppercase tracking-[0.15em] font-medium mb-1">High Volume Candle Scanner</p>
        <p className="text-red-400 text-sm font-semibold">{symbol} — Connection Error</p>
        <p className="text-red-500/50 text-xs mt-1">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const { signal, confidence, symbol: symbolName } = signalAnalysis;

  // ── Accent palette (signal-reactive, eye-friendly muted tones) ──
  const isWait = signal === 'WAIT';

  const accentBorder  = isBuy ? 'border-teal-500/30'   : isSell ? 'border-rose-500/25'  : isWait ? 'border-orange-500/25' : 'border-slate-600/30';
  const accentText    = isBuy ? 'text-teal-300'         : isSell ? 'text-rose-300'        : isWait ? 'text-orange-300'      : 'text-slate-400';
  const accentBarBg   = isBuy ? 'from-teal-500 to-teal-300' : isSell ? 'from-rose-600 to-rose-400' : isWait ? 'from-orange-500 to-orange-300' : 'from-slate-500 to-slate-400';
  const accentCorner  = isBuy ? 'bg-teal-500'           : isSell ? 'bg-rose-500'          : 'bg-slate-500';
  const panelBorder   = isBuy ? 'border-teal-500/25'    : isSell ? 'border-rose-500/20'   : 'border-slate-600/25';

  const signalLabel =
    signal === 'STRONG_BUY'  || signal === 'STRONG BUY'  ? '▲▲ STRONG BUY'  :
    signal === 'BUY'         || signal === 'BULLISH'      ? '▲ BUY'           :
    signal === 'STRONG_SELL' || signal === 'STRONG SELL' ? '▼▼ STRONG SELL' :
    signal === 'SELL'        || signal === 'BEARISH'      ? '▼ SELL'          :
    signal === 'WAIT'                                     ? '⏸ WAIT'          :
    '◆ NEUTRAL';

  // ── Derived pre-production intelligence ──
  const bodyRating   = data.body_percent > 55 ? 'STRONG' : data.body_percent > 30 ? 'MODERATE' : 'WEAK';
  const volStatus    = data.volume_above_threshold ? 'HIGH' : 'NORMAL';
  const convictionLv = data.conviction_move ? 'CONFIRMED' : data.momentum_score > 60 ? 'BUILDING' : 'LOW';

  // ── Derived 5-min prediction ──
  const predictedDir   = isBuy ? 'UPSIDE' : isSell ? 'DOWNSIDE' : 'SIDEWAYS';

  return (
    <div suppressHydrationWarning className={`relative rounded-2xl overflow-hidden border ${accentBorder} shadow-lg bg-[#0b0f1a] backdrop-blur-xl`}>

      {/* Top reflector shimmer */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />
      {/* Corner accent glow */}
      <div className={`absolute top-0 right-0 w-14 h-14 rounded-bl-full opacity-[8%] ${accentCorner} pointer-events-none`} />

      {/* ── HEADER ── */}
      <div className="relative px-4 py-3 flex items-center justify-between border-b border-white/[0.05]">
        <div>
          <p className="text-[9px] text-slate-500 uppercase tracking-[0.18em] font-medium">High Volume Candle Scanner</p>
          <p className="text-[10px] font-semibold text-slate-400 mt-0.5 tracking-wide">Fake Spike · Body Strength · Conviction</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-lg border border-green-500/60 bg-green-950/30 px-2.5 py-1.5 text-sm font-bold text-white">{symbolName}</span>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
            <span className="text-[10px] text-slate-400 font-medium">LIVE</span>
          </div>
        </div>
      </div>

      {/* ── REFLECTOR: Main Signal Panel ── */}
      <div className="relative mx-3 mt-3 rounded-xl overflow-hidden">
        <div className={`absolute inset-0 opacity-[5%] ${
          isBuy ? 'bg-gradient-to-b from-teal-400 to-transparent'
          : isSell ? 'bg-gradient-to-b from-rose-400 to-transparent'
          : 'bg-gradient-to-b from-slate-400 to-transparent'
        } pointer-events-none`} />
        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.03] via-transparent to-black/25 pointer-events-none" />

        <div className={`relative border rounded-xl p-3.5 bg-[#0d1117]/80 ${panelBorder}`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div suppressHydrationWarning className={`text-xl font-black tracking-tight ${accentText}`}>
                {signalLabel}
              </div>
              <p className="text-[9px] text-white/30 mt-0.5 uppercase tracking-wider font-medium">
                Volume · Candle Quality
              </p>
            </div>
            <div className="text-right shrink-0">
              <div className="text-2xl font-black text-white tabular-nums leading-none">{confidence}%</div>
              <p className="text-[9px] text-white/30 font-medium mt-0.5">Confidence</p>
            </div>
          </div>
          <div className="mt-2.5 h-[3px] bg-black/40 rounded-full overflow-hidden">
            <div
              suppressHydrationWarning
              className={`h-full rounded-full bg-gradient-to-r ${accentBarBg} transition-all duration-1000 ease-out`}
              style={{ width: `${confidence}%` }}
            />
          </div>
          {/* Alert badges inline (always rendered with fixed height to prevent layout shift) */}
          <div className="flex gap-2 mt-2.5 min-h-[22px]">
            <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-md tracking-wide transition-opacity duration-500 ${data.conviction_move ? 'bg-teal-500/10 border border-teal-500/20 text-teal-300 opacity-100' : 'opacity-0'}`}>
              CONVICTION MOVE
            </span>
            <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-md tracking-wide transition-opacity duration-500 ${data.fake_spike_detected ? 'bg-rose-500/10 border border-rose-500/20 text-rose-300 opacity-100' : 'opacity-0'}`}>
              FAKE SPIKE
            </span>
          </div>
        </div>
      </div>

      {/* ── CONFERENCE PANEL: Market Intelligence Grid 2×2 ── */}
      <div className="px-3 pt-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="h-px flex-1 bg-white/[0.05]" />
          <p className="text-[8px] text-slate-600 uppercase tracking-[0.18em] font-semibold">Candle Intelligence</p>
          <div className="h-px flex-1 bg-white/[0.05]" />
        </div>
        <div className="grid grid-cols-2 gap-1.5">

          {/* Direction */}
          <div className="p-2.5 rounded-lg bg-[#0d1117] border border-white/[0.06]">
            <p className="text-[8px] text-slate-600 uppercase tracking-wide mb-1">Direction</p>
            <p suppressHydrationWarning className={`text-[13px] font-bold ${
              data.candle_direction === 'UP' ? 'text-teal-300' :
              data.candle_direction === 'DOWN' ? 'text-rose-300' : 'text-slate-400'
            }`}>
              {data.candle_direction === 'UP' ? '▲ UP' : data.candle_direction === 'DOWN' ? '▼ DOWN' : '◆ DOJI'}
            </p>
          </div>

          {/* Body Strength */}
          <div className="p-2.5 rounded-lg bg-[#0d1117] border border-white/[0.06]">
            <p className="text-[8px] text-slate-600 uppercase tracking-wide mb-1">Body Strength</p>
            <p suppressHydrationWarning className={`text-[13px] font-bold ${
              data.body_percent > 55 ? 'text-teal-300' :
              data.body_percent > 30 ? 'text-amber-300' : 'text-rose-300'
            }`}>
              {data.body_percent?.toFixed(1) || '0'}%
            </p>
            <p className="text-[8px] text-slate-600 mt-0.5">{bodyRating}</p>
          </div>

          {/* Volume */}
          <div className="p-2.5 rounded-lg bg-[#0d1117] border border-white/[0.06]">
            <p className="text-[8px] text-slate-600 uppercase tracking-wide mb-1">Volume</p>
            <p suppressHydrationWarning className={`text-[13px] font-bold ${
              data.volume_above_threshold ? 'text-teal-300' : 'text-slate-400'
            }`}>
              {data.volume_above_threshold ? 'VERY GOOD' : 'NORMAL'}
            </p>
          </div>

          {/* Momentum */}
          <div className="p-2.5 rounded-lg bg-[#0d1117] border border-white/[0.06]">
            <p className="text-[8px] text-slate-600 uppercase tracking-wide mb-1">Momentum</p>
            <p suppressHydrationWarning className={`text-[13px] font-bold ${
              data.momentum_score > 60 ? 'text-teal-300' :
              data.momentum_score > 40 ? 'text-amber-300' : 'text-slate-400'
            }`}>
              {data.momentum_score}<span className="text-[10px] text-slate-600">/100</span>
            </p>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
          5 MIN PREDICTION
      ══════════════════════════════════════════════════════════ */}
      <div className="mx-3 mt-2 mb-3 rounded-xl overflow-hidden border border-white/[0.06] bg-[#0d1117]">
        <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

        <div className="p-4 space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">5 Min Prediction</span>
            <span suppressHydrationWarning className={`text-[10px] font-bold px-2 py-1 rounded ${
              isBuy ? 'bg-teal-500/25 text-teal-300' :
              isSell ? 'bg-rose-500/25 text-rose-300' :
              'bg-amber-500/15 text-amber-300'
            }`}>
              {volConfidence}% CONFIDENCE
            </span>
          </div>

          {/* Dual Confidence Display */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col bg-gray-900/50 rounded-lg px-2 py-1.5 border border-gray-700/30">
              <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wide">CONFIDENCE</span>
              <span className="text-[13px] font-black text-emerald-300 mt-0.5 tabular-nums">{volConfidence}%</span>
              <div className="w-full h-2 rounded-full bg-gray-800 overflow-hidden mt-1">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-700 rounded-full"
                  style={{ width: `${Math.min(100, volConfidence)}%` }}
                />
              </div>
            </div>

            <div className="flex flex-col bg-gray-900/50 rounded-lg px-2 py-1.5 border border-gray-700/30">
              <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wide">Actual Market</span>
              <span className="text-[13px] font-black text-teal-300 mt-0.5 tabular-nums">{actualMarketConf}%</span>
              <div className="w-full h-2 rounded-full bg-gray-800 overflow-hidden mt-1">
                <div
                  className="h-full bg-gradient-to-r from-teal-500 to-teal-400 transition-all duration-700 rounded-full"
                  style={{ width: `${Math.min(100, actualMarketConf)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Direction + Candle Quality Assessment */}
          <div className={`rounded-lg border ${
            isBuy ? 'border-teal-500/40 bg-teal-500/[0.08]' :
            isSell ? 'border-rose-500/40 bg-rose-500/[0.08]' :
            'border-amber-500/30 bg-amber-500/[0.05]'
          } px-3 py-2.5`}>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className={`text-sm font-black ${
                isBuy ? 'text-teal-400' : isSell ? 'text-rose-400' : 'text-amber-400'
              }`}>
                {isBuy ? '▲' : isSell ? '▼' : '─'} {predictedDir}
              </span>
              <span className="text-[9px] text-gray-400 flex-1">
                {bodyRating === 'STRONG' ? 'Strong body momentum' :
                 bodyRating === 'MODERATE' ? 'Moderate conviction' :
                 'Weak signal'}
                {data.fake_spike_detected ? ' ⚠ Spike detected' : ''}
              </span>
              <span className={`text-sm font-black tabular-nums ${
                isBuy ? 'text-teal-400' : isSell ? 'text-rose-400' : 'text-amber-400'
              }`}>
                {volConfidence}%
              </span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden border border-white/5">
              <div
                suppressHydrationWarning
                className={`h-full rounded-full bg-gradient-to-r ${accentBarBg} transition-all duration-700`}
                style={{ width: `${volConfidence}%` }}
              />
            </div>
          </div>

          {/* Candle Structure Momentum Indicators */}
          <div className="space-y-1.5 bg-gray-900/30 rounded-lg p-2.5 border border-gray-700/20">
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wide">Body Strength</span>
              <span suppressHydrationWarning className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                bodyRating === 'STRONG' ? 'bg-teal-500/25 text-teal-300' :
                bodyRating === 'MODERATE' ? 'bg-amber-500/25 text-amber-300' :
                'bg-rose-500/25 text-rose-300'
              }`}>
                {bodyRating === 'STRONG' ? '▲ STRONG' :
                 bodyRating === 'MODERATE' ? '◆ MODERATE' :
                 '▼ WEAK'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wide">Volume Status</span>
              <span suppressHydrationWarning className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                data.volume_above_threshold ? 'bg-teal-500/25 text-teal-300' :
                'bg-gray-700/40 text-gray-400'
              }`}>
                {data.volume_above_threshold ? '📊 HIGH' : 'Normal'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wide">Spike Detection</span>
              <span suppressHydrationWarning className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                data.fake_spike_detected ? 'bg-rose-500/25 text-rose-300' :
                'bg-teal-500/25 text-teal-300'
              }`}>
                {data.fake_spike_detected ? '⚠️ FAKE' : '✓ CLEAN'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wide">Conviction Level</span>
              <span suppressHydrationWarning className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                convictionLv === 'CONFIRMED' ? 'bg-teal-500/25 text-teal-300' :
                convictionLv === 'BUILDING' ? 'bg-amber-500/25 text-amber-300' :
                'bg-gray-700/40 text-gray-400'
              }`}>
                {convictionLv === 'CONFIRMED' ? '✓ CONFIRMED' :
                 convictionLv === 'BUILDING' ? '▲ BUILDING' :
                 '▼ WEAK'}
              </span>
            </div>
          </div>

          {/* Movement Probability Distribution */}
          <div className="space-y-2">
            <p className="text-[9px] font-bold text-gray-500 uppercase tracking-wide">Movement Probability</p>
            <div className="flex items-center h-6 rounded-md overflow-hidden bg-gray-950/50 border border-gray-700/30">
              <div
                className="h-full bg-gradient-to-r from-teal-600 to-teal-500 transition-all duration-700 flex items-center justify-center"
                style={{ width: `${bullProb}%` }}
              >
                {bullProb >= 15 && <span className="text-[8px] font-bold text-white tabular-nums">{bullProb}%↑</span>}
              </div>
              <div
                className="h-full bg-gradient-to-l from-rose-600 to-rose-500 transition-all duration-700 flex items-center justify-center"
                style={{ width: `${bearProb}%` }}
              >
                {bearProb >= 15 && <span className="text-[8px] font-bold text-white tabular-nums">{bearProb}%↓</span>}
              </div>
            </div>
          </div>

          {/* Early Signal Detection (always rendered, visibility toggled to prevent layout shift) */}
          <div className={`pt-2 border-t border-gray-700/20 min-h-[24px] ${(volConfidence >= 75 || (bodyRating === 'STRONG' && data.volume_above_threshold && !data.fake_spike_detected)) ? '' : 'invisible'}`}>
            <span className="text-[9px] font-bold text-amber-400 uppercase tracking-wide">
              ⚡ {volConfidence >= 85 ? 'STRONG' : 'CONFIRMED'} {predictedDir} Signal Formed
            </span>
          </div>

          {/* Summary line */}
          <div className={`text-center text-[10px] font-bold rounded-lg py-1.5 border tabular-nums ${
            isBuy ? 'bg-teal-500/10 border-teal-500/30 text-teal-300' :
            isSell ? 'bg-rose-500/10 border-rose-500/30 text-rose-300' :
            'bg-amber-500/10 border-amber-500/20 text-amber-300'
          }`}>
            {predictedDir} · {volConfidence}% Predicted · {data.body_percent.toFixed(0)}% Body
          </div>
        </div>

        <div className="h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
      </div>

      {/* ── FOOTER ── */}
      <div className="px-3 pb-3 flex items-center justify-between -mt-0.5">
        <div className="flex items-center gap-1">
          <div className="w-1 h-1 rounded-full bg-teal-500 animate-pulse" />
          <span className="text-[9px] text-slate-600">Live · 3s refresh</span>
        </div>
        <span suppressHydrationWarning className="text-[9px] text-slate-600 tabular-nums">
          {new Date(data.timestamp || '').toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      </div>

      {/* Bottom reflector shimmer */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/8 to-transparent pointer-events-none" />
    </div>
  );
});

CandleQualityAnalysis.displayName = 'CandleQualityAnalysis';

export default CandleQualityAnalysis;
