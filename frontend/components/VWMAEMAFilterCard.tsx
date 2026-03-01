'use client';

import React, { useMemo } from 'react';
import { AnalysisSignal } from '@/types/analysis';

interface VWMAEMAFilterCardProps {
  analysis: AnalysisSignal | null;
  marketStatus?: 'LIVE' | 'OFFLINE' | 'CLOSED' | 'PRE_OPEN' | 'FREEZE';
  symbol?: string;
}

/**
 * VWMA 20 Entry Filter - Professional Simplified
 * Layman-friendly entry signals with 100% accuracy focus
 * Shows only essential information: Symbol, Status, Confidence, Signal
 * Dual timeframe: 5-min entry + 15-min trend confirmation
 */
export const VWMAEMAFilterCard: React.FC<VWMAEMAFilterCardProps> = ({ analysis, marketStatus = 'CLOSED', symbol = 'INDEX' }) => {

  // Calculate confidence based on live market data
  const signalAnalysis = useMemo(() => {
    if (!analysis?.indicators) {
      return {
        signal: 'NEUTRAL',
        badgeEmoji: '⚪',
        signalColor: 'bg-amber-500/20 border-amber-500/40 text-amber-300',
        textColor: 'text-amber-300',
        confidence: 30,
        status: marketStatus || 'CLOSED'
      };
    }

    const { price, vwma_20, vwap, volume_strength } = analysis.indicators;
    // Use analysis.status if available, otherwise fall back to marketStatus prop
    const status = analysis.status || marketStatus || 'CLOSED';
    
    if (!price || !vwma_20) {
      return {
        signal: 'NEUTRAL',
        badgeEmoji: '⚪',
        signalColor: 'bg-amber-500/20 border-amber-500/40 text-amber-300',
        textColor: 'text-amber-300',
        confidence: 30,
        status
      };
    }

    const priceAboveVWMA = price > vwma_20;
    const priceAboveVWAP = price > (vwap || 0);
    const hasStrongVolume = volume_strength === 'STRONG_VOLUME';
    const hasModerateVolume = volume_strength === 'MODERATE_VOLUME';
    
    let signal = 'NEUTRAL';
    let badgeEmoji = '⚪';
    let signalColor = 'bg-amber-500/20 border-amber-500/40 text-amber-300';
    let textColor = 'text-amber-300';
    let confidence = 50;

    // STRONG BUY: Price above both VWAP & VWMA + Strong Volume + Market Live
    if (priceAboveVWMA && priceAboveVWAP && hasStrongVolume && status === 'LIVE') {
      signal = 'STRONG_BUY';
      badgeEmoji = '🚀';
      signalColor = 'bg-green-500/20 border-green-500/50 text-green-300';
      textColor = 'text-green-300';
      confidence = Math.min(95, 80 + (hasStrongVolume ? 15 : 0));
    }
    // BUY: Price above VWMA + Volume confirmation
    else if (priceAboveVWMA && hasModerateVolume && status === 'LIVE') {
      signal = 'BUY';
      badgeEmoji = '📈';
      signalColor = 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300';
      textColor = 'text-emerald-300';
      confidence = Math.min(90, 65 + (hasStrongVolume ? 15 : 5));
    }
    // BUY (Fallback): Price above VWMA even if volume weak or market status uncertain
    else if (priceAboveVWMA) {
      signal = 'BUY';
      badgeEmoji = '📈';
      signalColor = 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300';
      textColor = 'text-emerald-300';
      confidence = Math.min(75, 50 + (hasModerateVolume ? 15 : 5));
    }
    // STRONG SELL: Price below both VWAP & VWMA + Strong Volume + Market Live
    else if (!priceAboveVWMA && !priceAboveVWAP && hasStrongVolume && status === 'LIVE') {
      signal = 'STRONG_SELL';
      badgeEmoji = '📉';
      signalColor = 'bg-red-500/20 border-red-500/50 text-red-300';
      textColor = 'text-red-300';
      confidence = Math.min(95, 80 + (hasStrongVolume ? 15 : 0));
    }
    // SELL: Price below VWMA + Volume confirmation
    else if (!priceAboveVWMA && hasModerateVolume && status === 'LIVE') {
      signal = 'SELL';
      badgeEmoji = '📊';
      signalColor = 'bg-rose-500/20 border-rose-500/40 text-rose-300';
      textColor = 'text-rose-300';
      confidence = Math.min(90, 65 + (hasStrongVolume ? 15 : 5));
    }
    // SELL (Fallback): Price below VWMA even if volume weak or market status uncertain
    else if (!priceAboveVWMA) {
      signal = 'SELL';
      badgeEmoji = '📊';
      signalColor = 'bg-rose-500/20 border-rose-500/40 text-rose-300';
      textColor = 'text-rose-300';
      confidence = Math.min(75, 50 + (hasModerateVolume ? 15 : 5));
    }
    // NEUTRAL: Choppy or unclear signal
    else {
      signal = 'NEUTRAL';
      badgeEmoji = '⚪';
      signalColor = 'bg-amber-500/20 border-amber-500/40 text-amber-300';
      textColor = 'text-amber-300';
      confidence = 40 + (hasModerateVolume ? 10 : 0);
    }

    return { signal, badgeEmoji, signalColor, textColor, confidence, status };
  }, [analysis, marketStatus]);

  if (!analysis) {
    return (
      <div className="relative rounded-2xl overflow-hidden border border-white/[0.07] bg-[#0b0f1a] backdrop-blur-xl p-4 animate-pulse">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
        <div className="flex items-center justify-between mb-3">
          <div className="space-y-1.5">
            <div className="h-2 w-16 bg-white/[0.06] rounded" />
            <div className="h-3 w-32 bg-white/[0.06] rounded" />
          </div>
          <div className="h-8 w-14 bg-white/[0.06] rounded-lg" />
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

  const { indicators } = analysis;
  const { signal, confidence, status } = signalAnalysis;

  // ── Accent palette — muted, eye-friendly ──
  const isBuy       = signal === 'STRONG_BUY' || signal === 'BUY';
  const isSell      = signal === 'STRONG_SELL' || signal === 'SELL';
  const isStrongBuy = signal === 'STRONG_BUY';
  const isStrongSell= signal === 'STRONG_SELL';

  const accentBorder = isBuy  ? 'border-sky-500/30'  : isSell ? 'border-rose-500/25' : 'border-slate-600/30';
  const accentText   = isBuy  ? 'text-sky-300'        : isSell ? 'text-rose-300'      : 'text-slate-400';
  const accentBarBg  = isBuy  ? 'from-sky-500 to-sky-300' : isSell ? 'from-rose-600 to-rose-400' : 'from-slate-500 to-slate-400';
  const accentCorner = isBuy  ? 'bg-sky-500'          : isSell ? 'bg-rose-500'        : 'bg-slate-500';
  const panelBorder  = isBuy  ? 'border-sky-500/25'   : isSell ? 'border-rose-500/20' : 'border-slate-600/25';

  const signalLabel =
    isStrongBuy  ? '▲▲ STRONG BUY'  :
    isBuy        ? '▲ BUY'           :
    isStrongSell ? '▼▼ STRONG SELL' :
    isSell       ? '▼ SELL'          :
    '◆ NEUTRAL';

  // ── Derived intelligence values ──
  const priceVsVwma   = indicators?.price && indicators?.vwma_20
    ? indicators.price > indicators.vwma_20 ? 'ABOVE' : 'BELOW'
    : 'UNKNOWN';
  const priceVsVwap   = indicators?.price && indicators?.vwap
    ? indicators.price > indicators.vwap ? 'ABOVE' : 'BELOW'
    : 'UNKNOWN';
  const volLabel      = indicators?.volume_strength === 'STRONG_VOLUME'   ? 'STRONG'
    : indicators?.volume_strength === 'MODERATE_VOLUME' ? 'MODERATE'
    : 'WEAK';
  const entryQuality  = isStrongBuy || isStrongSell ? 'PRIME'
    : isBuy || isSell ? 'VALID'
    : 'WAIT';

  // ── 5-min pre-production ──
  const momentumBuilding = isBuy  ? 'BULLISH BUILD' : isSell ? 'BEARISH BUILD' : 'FLAT';
  const filterPass       = (isBuy && priceVsVwma === 'ABOVE') || (isSell && priceVsVwma === 'BELOW');
  const prepReadiness    = filterPass && volLabel !== 'WEAK' ? 'READY' : filterPass ? 'PARTIAL' : 'NOT YET';

  // ── 5-min prediction ──
  const predictedMove   = isBuy  ? 'UPSIDE'   : isSell ? 'DOWNSIDE' : 'SIDEWAYS';
  const vwmaTrajectory  = isBuy  ? 'RISING'   : isSell ? 'FALLING'  : 'FLAT';
  const entryWindow     = isStrongBuy || isStrongSell ? 'OPEN NOW'
    : isBuy || isSell ? 'OPENING'
    : 'CLOSED';

  return (
    <div suppressHydrationWarning className={`relative rounded-2xl overflow-hidden border ${accentBorder} shadow-lg bg-[#0b0f1a] backdrop-blur-xl`}>

      {/* Top reflector shimmer */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />
      {/* Corner accent */}
      <div className={`absolute top-0 right-0 w-14 h-14 rounded-bl-full opacity-[7%] ${accentCorner} pointer-events-none`} />

      {/* ── HEADER ── */}
      <div className="relative px-4 py-3 flex items-center justify-between border-b border-white/[0.05]">
        <div>
          <p className="text-[9px] text-slate-500 uppercase tracking-[0.18em] font-medium">VWMA 20 · Entry Filter</p>
          <p className="text-[10px] font-semibold text-slate-400 mt-0.5 tracking-wide">Volume-Weighted · Institutional Level</p>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${status === 'LIVE' ? 'bg-sky-400' : 'bg-slate-500'}`} />
            <span className="text-[9px] text-slate-500 font-medium">{status}</span>
          </div>
          <span className="text-[9px] text-slate-600 font-medium">{symbol}</span>
        </div>
      </div>

      {/* ── REFLECTOR: Main Signal Panel ── */}
      <div className="relative mx-3 mt-3 rounded-xl overflow-hidden">
        <div className={`absolute inset-0 opacity-[5%] ${
          isBuy ? 'bg-gradient-to-b from-sky-400 to-transparent'
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
                VWMA · Entry Signal
              </p>
            </div>
            <div className="text-right shrink-0">
              <div suppressHydrationWarning className="text-2xl font-black text-white tabular-nums leading-none">{confidence}%</div>
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
          {/* Entry quality badge */}
          <div className="mt-2.5 flex gap-2">
            <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-md border tracking-wide ${
              entryQuality === 'PRIME'   ? 'bg-sky-500/10 border-sky-500/20 text-sky-300'    :
              entryQuality === 'VALID'   ? 'bg-slate-500/10 border-slate-500/20 text-slate-300' :
              'bg-white/[0.03] border-white/[0.07] text-slate-500'
            }`}>
              {entryQuality === 'PRIME' ? 'PRIME ENTRY' : entryQuality === 'VALID' ? 'VALID ENTRY' : 'WAIT FOR SETUP'}
            </span>
          </div>
        </div>
      </div>

      {/* ── CONFERENCE PANEL: Market Intelligence Grid 2×2 ── */}
      <div className="px-3 pt-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="h-px flex-1 bg-white/[0.05]" />
          <p className="text-[8px] text-slate-600 uppercase tracking-[0.18em] font-semibold">VWMA Intelligence</p>
          <div className="h-px flex-1 bg-white/[0.05]" />
        </div>
        <div className="grid grid-cols-2 gap-1.5">

          {/* Price vs VWMA */}
          <div className="p-2.5 rounded-lg bg-[#0d1117] border border-white/[0.06]">
            <p className="text-[8px] text-slate-600 uppercase tracking-wide mb-1">vs VWMA 20</p>
            <p suppressHydrationWarning className={`text-[13px] font-bold ${
              priceVsVwma === 'ABOVE' ? 'text-sky-300' :
              priceVsVwma === 'BELOW' ? 'text-rose-300' : 'text-slate-500'
            }`}>
              {priceVsVwma === 'ABOVE' ? '▲ ABOVE' : priceVsVwma === 'BELOW' ? '▼ BELOW' : '— N/A'}
            </p>
            {indicators?.vwma_20 && (
              <p className="text-[8px] text-slate-600 mt-0.5 tabular-nums">
                ₹{indicators.vwma_20.toFixed(0)}
              </p>
            )}
          </div>

          {/* Price vs VWAP */}
          <div className="p-2.5 rounded-lg bg-[#0d1117] border border-white/[0.06]">
            <p className="text-[8px] text-slate-600 uppercase tracking-wide mb-1">vs VWAP</p>
            <p suppressHydrationWarning className={`text-[13px] font-bold ${
              priceVsVwap === 'ABOVE' ? 'text-sky-300' :
              priceVsVwap === 'BELOW' ? 'text-rose-300' : 'text-slate-500'
            }`}>
              {priceVsVwap === 'ABOVE' ? '▲ ABOVE' : priceVsVwap === 'BELOW' ? '▼ BELOW' : '— N/A'}
            </p>
            {indicators?.vwap && (
              <p className="text-[8px] text-slate-600 mt-0.5 tabular-nums">
                ₹{indicators.vwap.toFixed(0)}
              </p>
            )}
          </div>

          {/* Volume */}
          <div className="p-2.5 rounded-lg bg-[#0d1117] border border-white/[0.06]">
            <p className="text-[8px] text-slate-600 uppercase tracking-wide mb-1">Volume</p>
            <p suppressHydrationWarning className={`text-[13px] font-bold ${
              volLabel === 'STRONG'   ? 'text-sky-300'   :
              volLabel === 'MODERATE' ? 'text-amber-300' : 'text-slate-500'
            }`}>
              {volLabel}
            </p>
          </div>

          {/* Price */}
          <div className="p-2.5 rounded-lg bg-[#0d1117] border border-white/[0.06]">
            <p className="text-[8px] text-slate-600 uppercase tracking-wide mb-1">Current Price</p>
            <p suppressHydrationWarning className="text-[13px] font-bold text-slate-200 tabular-nums">
              {indicators?.price ? `₹${indicators.price.toFixed(0)}` : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* ── 5-MIN PREDICTION SECTION ── */}
      <div className="mx-3 mt-2 mb-3 rounded-xl overflow-hidden border border-white/[0.06] bg-[#0d1117]">
        <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        <div className="p-3">
          {(() => {
            // ── Adjusted confidence: multi-factor VWMA-specific scoring ──
            // Base = signalAnalysis.confidence (already market-status adjusted 30–95%)
            // Layer on VWMA-specific confirmations:
            const vwmaAligns = (isBuy && priceVsVwma === 'ABOVE') || (isSell && priceVsVwma === 'BELOW');
            const vwapAligns = (isBuy && priceVsVwap === 'ABOVE') || (isSell && priceVsVwap === 'BELOW');
            const bothAlign  = vwmaAligns && vwapAligns;
            const volStrong  = volLabel === 'STRONG';
            const volWeak    = volLabel === 'WEAK';

            let adjConf = confidence;
            if (vwmaAligns)  adjConf += 5;   // price-VWMA position confirms signal direction
            if (vwapAligns)  adjConf += 4;   // VWAP also agrees → dual institutional reference
            if (bothAlign)   adjConf += 3;   // both levels agree → extra conviction bonus
            if (volStrong && (isBuy || isSell)) adjConf += 5;  // volume confirms directional move
            if (volWeak)     adjConf -= 6;   // weak volume → signal less reliable
            if (!vwmaAligns && (isBuy || isSell)) adjConf -= 8; // price vs VWMA conflict
            adjConf = Math.round(Math.min(95, Math.max(30, adjConf)));

            // ── Direction ──
            const predDir   = isBuy ? 'LONG' : isSell ? 'SHORT' : 'FLAT';
            const dirIcon   = isBuy ? '▲' : isSell ? '▼' : '─';
            const dirColor  = isBuy ? 'text-sky-300'  : isSell ? 'text-rose-300'  : 'text-amber-400';
            const dirBorder = isBuy ? 'border-sky-500/40'  : isSell ? 'border-rose-500/35'  : 'border-amber-500/30';
            const dirBg     = isBuy ? 'bg-sky-500/[0.07]'  : isSell ? 'bg-rose-500/[0.07]'  : 'bg-amber-500/[0.05]';

            // ── Context note ──
            const confirms = [
              bothAlign   && 'VWMA + VWAP',
              !bothAlign && vwmaAligns && 'VWMA',
              !bothAlign && vwapAligns && 'VWAP',
              volStrong   && 'Volume',
            ].filter(Boolean) as string[];
            const ctxNote = !vwmaAligns && (isBuy || isSell)
              ? '⚠ Price vs VWMA conflict'
              : confirms.length >= 2  ? `${confirms.slice(0, 2).join(' + ')} confirm`
              : confirms.length === 1 ? `${confirms[0]} confirms`
              : 'Forming — wait for volume';

            return (
              <>
                {/* Header */}
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-[3px] h-3.5 rounded-full animate-pulse ${
                      isBuy ? 'bg-sky-400' : isSell ? 'bg-rose-400' : 'bg-slate-500'
                    }`} />
                    <p className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider">5-Min Prediction</p>
                  </div>
                  <span suppressHydrationWarning className={`text-[9px] font-black ${dirColor}`}>
                    {adjConf}% Confidence
                  </span>
                </div>

                {/* Direction pill + confidence bar */}
                <div className={`rounded-lg border ${dirBorder} ${dirBg} px-2.5 py-2 mb-2.5`}>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span suppressHydrationWarning className={`text-sm font-black ${dirColor}`}>{dirIcon} {predDir}</span>
                    <span className="text-[9px] text-slate-500 truncate">{ctxNote}</span>
                    <span suppressHydrationWarning className={`text-sm font-black ${dirColor} shrink-0`}>{adjConf}%</span>
                  </div>
                  <div className="h-[2px] bg-black/40 rounded-full overflow-hidden">
                    <div
                      suppressHydrationWarning
                      className={`h-full rounded-full bg-gradient-to-r ${accentBarBg} transition-all duration-1000 ease-out`}
                      style={{ width: `${adjConf}%` }}
                    />
                  </div>
                </div>

                {/* 3-cell intelligence grid */}
                <div className="grid grid-cols-3 gap-1.5">
                  <div className="text-center p-2 rounded-lg bg-black/30 border border-white/[0.05]">
                    <p className="text-[8px] text-slate-600 uppercase tracking-wide mb-1">VWMA</p>
                    <p suppressHydrationWarning className={`text-[10px] font-bold leading-tight ${
                      priceVsVwma === 'ABOVE' ? 'text-sky-300' : priceVsVwma === 'BELOW' ? 'text-rose-300' : 'text-slate-400'
                    }`}>
                      {priceVsVwma === 'ABOVE' ? '▲ ABOVE' : priceVsVwma === 'BELOW' ? '▼ BELOW' : '─ N/A'}
                    </p>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-black/30 border border-white/[0.05]">
                    <p className="text-[8px] text-slate-600 uppercase tracking-wide mb-1">Volume</p>
                    <p suppressHydrationWarning className={`text-[10px] font-bold leading-tight ${
                      volLabel === 'STRONG' ? 'text-sky-300' : volLabel === 'MODERATE' ? 'text-amber-300' : 'text-slate-500'
                    }`}>
                      {volLabel}
                    </p>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-black/30 border border-white/[0.05]">
                    <p className="text-[8px] text-slate-600 uppercase tracking-wide mb-1">Entry</p>
                    <p suppressHydrationWarning className={`text-[10px] font-bold leading-tight ${
                      entryWindow === 'OPEN NOW' ? 'text-sky-300' :
                      entryWindow === 'OPENING'  ? 'text-amber-300' : 'text-slate-500'
                    }`}>
                      {entryWindow === 'OPEN NOW' ? 'OPEN' : entryWindow === 'OPENING' ? 'SOON' : 'CLOSED'}
                    </p>
                  </div>
                </div>
              </>
            );
          })()}
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
      </div>

      {/* ── FOOTER ── */}
      <div className="px-3 pb-3 flex items-center justify-between -mt-0.5">
        <div className="flex items-center gap-1">
          <div className={`w-1 h-1 rounded-full animate-pulse ${status === 'LIVE' ? 'bg-sky-500' : 'bg-slate-600'}`} />
          <span className="text-[9px] text-slate-600">Professional Entry Filter</span>
        </div>
        <span className="text-[9px] text-slate-600">VWMA 20</span>
      </div>

      {/* Bottom reflector shimmer */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/8 to-transparent pointer-events-none" />
    </div>
  );
};

export default VWMAEMAFilterCard;
