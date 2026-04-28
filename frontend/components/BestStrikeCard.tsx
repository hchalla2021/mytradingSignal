'use client';

import React from 'react';
import { BestStrikeRecommendation } from '@/hooks/useStrikeIntelligence';
import { ArrowUp, ArrowDown, Zap } from 'lucide-react';

interface BestStrikeCardProps {
  recommendation: BestStrikeRecommendation | null | undefined;
  isLoading?: boolean;
}

/**
 * BestStrikeCard: AI Strike Recommender display component
 * 
 * Shows the **single best strike** to trade with:
 * - Strike price (large, bold)
 * - Direction: UP ↑ (emerald) or DOWN ↓ (red)
 * - Confidence % (color-coded: ≥75%=emerald, ≥50%=amber, <50%=red)
 * - Reason text (human-readable explanation)
 * - Greeks summary (σIV, Δ, Γ, Θ, ν)
 * - Glowing border animation (pulsing heat effect based on direction)
 */
export const BestStrikeCard: React.FC<BestStrikeCardProps> = ({
  recommendation,
  isLoading = false,
}) => {
  if (!recommendation) {
    return null;
  }

  const { strike, label, direction, side, score, confidence, reason, greeksSummary } =
    recommendation;

  // Direction-based styling — softer for eyes
  const isUp = direction === 'UP';
  const dirColor = isUp ? 'emerald' : 'red';
  const dirBgClass = isUp ? 'from-emerald-950/20 to-emerald-950/5' : 'from-red-950/20 to-red-950/5';
  const dirBorderClass = isUp
    ? 'border-emerald-600/30 shadow-[0_0_12px_3px_rgba(16,185,129,0.1)]'
    : 'border-red-600/30 shadow-[0_0_12px_3px_rgba(239,68,68,0.1)]';

  // Confidence color-coding
  let confColor = 'text-red-400';
  let confBgClass = 'bg-red-900/20';
  if (confidence >= 75) {
    confColor = 'text-emerald-400';
    confBgClass = 'bg-emerald-900/20';
  } else if (confidence >= 50) {
    confColor = 'text-amber-400';
    confBgClass = 'bg-amber-900/20';
  }

  // Subtle pulse for high confidence
  const pulseClass = '';

  return (
    <div
      className={`relative mb-3 overflow-hidden rounded-lg border ${dirBorderClass} 
        bg-gradient-to-br ${dirBgClass} p-3 sm:p-4 transition-all duration-300`}
    >
      {/* Subtle shimmer for high conviction */}
      {confidence >= 75 && (
        <div
          className={`absolute inset-0 rounded-lg opacity-10 ${
            isUp
              ? 'bg-gradient-to-r from-emerald-500/0 via-emerald-500/20 to-emerald-500/0'
              : 'bg-gradient-to-r from-red-500/0 via-red-500/20 to-red-500/0'
          }`}
          style={{
            animation: 'shimmer 3s infinite',
          }}
        />
      )}

      <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        {/* Left: Strike Price & Direction */}
        <div className="flex flex-col items-start gap-2">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex flex-col items-start">
              <span className="text-[10px] sm:text-sm font-semibold uppercase tracking-wider text-slate-500">
                Best Strike
              </span>
              <div className="flex items-baseline gap-2">
                <span className={`text-2xl sm:text-4xl font-bold text-${dirColor}-400`}>{strike}</span>
                <span className="text-[9px] sm:text-xs font-medium text-slate-400 uppercase">{label}</span>
              </div>
            </div>

            {/* Direction Arrow with animation */}
            {isUp ? (
              <div className="flex flex-col items-center gap-1">
                <ArrowUp
                  className={`h-6 sm:h-10 w-6 sm:w-10 text-emerald-500`}
                  strokeWidth={2}
                />
                <span className="text-[8px] sm:text-xs font-bold uppercase text-emerald-500">Up</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1">
                <ArrowDown
                  className={`h-6 sm:h-10 w-6 sm:w-10 text-red-500`}
                  strokeWidth={2}
                />
                <span className="text-[8px] sm:text-xs font-bold uppercase text-red-500">Down</span>
              </div>
            )}
          </div>

          {/* Reason text */}
          <p className="max-w-sm text-[9px] sm:text-xs leading-relaxed text-slate-400">{reason}</p>
        </div>

        {/* Right: Score & Confidence */}
        <div className="flex flex-row sm:flex-col items-center sm:items-end gap-3">
          {/* Confidence badge */}
          <div className={`rounded-full ${confBgClass} px-2 sm:px-3 py-0.5 sm:py-1`}>
            <div className="flex items-center gap-1 sm:gap-2">
              <Zap className={`h-3 sm:h-4 w-3 sm:w-4 ${confColor}`} />
              <span className={`text-[10px] sm:text-sm font-bold ${confColor}`}>{confidence}%</span>
            </div>
          </div>

          {/* Score */}
          <div className="text-center">
            <span className="text-lg sm:text-2xl font-bold text-amber-500">{score.toFixed(1)}</span>
            <p className="text-[7px] sm:text-xs uppercase tracking-wider text-slate-500">Score</p>
          </div>

          {/* Side badge */}
          <div
            className={`rounded px-1.5 sm:px-2 py-0.5 text-[8px] sm:text-xs font-bold uppercase tracking-wide ${
              side === 'CE'
                ? 'bg-emerald-950/40 text-emerald-400'
                : 'bg-red-950/40 text-red-400'
            }`}
          >
            {side}
          </div>
        </div>
      </div>

      {/* Bottom: Greeks Summary */}
      <div className="relative z-10 mt-2 sm:mt-3 border-t border-slate-700/30 pt-2 sm:pt-3">
        <p className="text-[8px] sm:text-xs font-mono text-cyan-400/70 break-words">{greeksSummary}</p>
      </div>

      {/* Loading state overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-400 border-t-white" />
            <span className="text-xs text-slate-300">Analyzing...</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default BestStrikeCard;
