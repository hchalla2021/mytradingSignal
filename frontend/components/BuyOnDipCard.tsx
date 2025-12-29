/**
 * Buy-on-Dip Card Component
 * Displays Buy-on-Dip signal with visual indicators and animations
 */

'use client';

import React, { useMemo } from 'react';
import { BuyOnDipSignal } from '@/hooks/useBuyOnDip';

interface BuyOnDipCardProps {
  symbol: string;
  signal: BuyOnDipSignal | null;
  className?: string;
}

export const BuyOnDipCard: React.FC<BuyOnDipCardProps> = ({
  symbol,
  signal,
  className = '',
}) => {
  const isActive = signal?.signal === 'BUY-ON-DIP';
  const hasError = signal?.signal === 'ERROR';
  const confidence = signal?.percentage || 0;

  // Border styling based on signal state (light green theme for Buy-on-Dip)
  const borderClasses = useMemo(() => {
    const base = 'border-2 transition-all duration-200';
    if (hasError) {
      return `${base} border-bearish/40 shadow-lg shadow-bearish/10`;
    }
    if (isActive) {
      return `${base} border-emerald-500/50 shadow-lg shadow-emerald-500/20`;
    }
    return `${base} border-emerald-500/20 shadow-md shadow-emerald-500/5`;
  }, [isActive, hasError]);

  return (
    <div
      className={`
        bg-gradient-to-br from-emerald-950/30 via-dark-card/80 to-dark-elevated/60 
        backdrop-blur-sm rounded-xl ${borderClasses} p-3 sm:p-4 shadow-2xl
        ${className}
      `}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm sm:text-base font-bold text-dark-text mb-1 flex items-center gap-2">
            <div
              className={`
                w-2 h-2 rounded-full transition-all duration-500
                ${isActive ? 'bg-emerald-500 animate-pulse shadow-lg shadow-emerald-500/50' : hasError ? 'bg-bearish' : 'bg-emerald-600/40'}
              `}
            />
            <span className="text-xs sm:text-sm font-semibold text-emerald-400 uppercase tracking-wide">
              Buy-on-Dip
            </span>
          </h3>
          
          {/* Live Status Indicator */}
          {!hasError && (
            <div className="mt-2 mb-2 flex items-center gap-2 px-3 py-1.5 bg-emerald-950/40 rounded-lg border border-emerald-500/30 backdrop-blur-sm">
              <div className="relative">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping opacity-75" />
              </div>
              <span className="text-xs font-semibold text-emerald-400/90 tracking-wide">
                {isActive ? '✓ Signal Active' : 'Waiting for Dip...'}
              </span>
            </div>
          )}
          
          {isActive && (
            <div className="text-lg sm:text-xl font-bold mt-1 text-emerald-400">
              BUY ON DIP
            </div>
          )}
          {hasError && (
            <div className="text-lg sm:text-xl font-bold mt-1 text-bearish">
              ERROR
            </div>
          )}
        </div>
      </div>

      {/* Confidence Bar */}
      {signal && !hasError && (
        <div className="mb-3">
          <div className="flex justify-between text-xs text-dark-tertiary mb-1.5">
            <span className="font-semibold uppercase tracking-wide">Confidence</span>
            <span className="font-bold text-emerald-400">{confidence}%</span>
          </div>
          <div className="w-full bg-dark-surface rounded-full h-2.5 overflow-hidden border border-emerald-500/20">
            <div
              className={`
                h-full rounded-full transition-all duration-1000 ease-out
                ${isActive ? 'bg-gradient-to-r from-emerald-500 to-emerald-400 shadow-lg shadow-emerald-500/30' : 'bg-emerald-600/30'}
              `}
              style={{ width: `${confidence}%` }}
            />
          </div>
          <div className="text-xs text-emerald-500/70 mt-1.5">
            {signal.confidence}/{signal.max_score} points
          </div>
          {signal && (
            <div className="text-xs text-dark-muted mt-1">
              Updated {new Date(signal.timestamp).toLocaleTimeString()}
            </div>
          )}
        </div>
      )}

      {/* Price Info */}
      {signal && signal.price > 0 && (
        <div className="mb-3 p-2 bg-emerald-950/20 backdrop-blur-sm rounded-lg border border-emerald-500/20 shadow-sm">
          <div className="text-xs text-emerald-400/80 mb-1 font-semibold uppercase tracking-wide">Current Price</div>
          <div className="text-base sm:text-lg font-bold text-emerald-300 font-mono">
            ₹{signal.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      )}

      {/* Indicators */}
      {signal && signal.indicators && Object.keys(signal.indicators).length > 0 && (
        <div className="mb-3">
          <div className="border border-emerald-500/20 rounded-lg p-2 bg-emerald-950/20 backdrop-blur-sm shadow-sm">
            <h4 className="text-xs font-bold text-emerald-400 mb-2 uppercase tracking-wider">Technical Indicators</h4>
            <div className="grid grid-cols-2 gap-1.5">
              {signal.indicators.ema20 && (
                <div className="bg-emerald-950/30 rounded-lg px-2 py-1.5 border border-emerald-500/20">
                  <div className="text-xs text-emerald-400/70 font-semibold">EMA20</div>
                  <div className="text-sm font-mono text-emerald-300 font-bold">
                    {signal.indicators.ema20.toFixed(2)}
                  </div>
                </div>
              )}
              {signal.indicators.ema50 && (
                <div className="bg-emerald-950/30 rounded-lg px-2 py-1.5 border border-emerald-500/20">
                  <div className="text-xs text-emerald-400/70 font-semibold">EMA50</div>
                  <div className="text-sm font-mono text-emerald-300 font-bold">
                    {signal.indicators.ema50.toFixed(2)}
                  </div>
                </div>
              )}
              {signal.indicators.rsi && (
                <div className="bg-emerald-950/30 rounded-lg px-2 py-1.5 border border-emerald-500/20">
                  <div className="text-xs text-emerald-400/70 font-semibold">RSI</div>
                  <div className={`text-sm font-mono font-bold ${
                    signal.indicators.rsi > 70 ? 'text-bearish' : signal.indicators.rsi < 30 ? 'text-bullish' : 'text-emerald-300'
                  }`}>
                    {signal.indicators.rsi.toFixed(1)}
                  </div>
                </div>
              )}
              {signal.indicators.vwap && (
                <div className="bg-emerald-950/30 rounded-lg px-2 py-1.5 border border-emerald-500/20">
                  <div className="text-xs text-emerald-400/70 font-semibold">VWAP</div>
                  <div className="text-sm font-mono text-emerald-300 font-bold">
                    {signal.indicators.vwap.toFixed(2)}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reasons */}
      {signal && signal.reasons && signal.reasons.length > 0 && (
        <div className="mb-3">
          <div className="border border-emerald-500/20 rounded-lg p-2 bg-emerald-950/20 backdrop-blur-sm shadow-sm">
            <h4 className="text-xs font-bold text-emerald-400 mb-1.5 uppercase tracking-wider">Signal Reasons</h4>
            <div className="space-y-1">
              {signal.reasons.map((reason, index) => (
                <div
                  key={index}
                  className="text-xs text-emerald-400 bg-emerald-500/10 rounded-lg px-2 py-1 border border-emerald-500/20"
                >
                  {reason}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Warnings */}
      {signal && signal.warnings && signal.warnings.length > 0 && (
        <div className="mb-2">
          <div className="border border-neutral/20 rounded-lg p-2 bg-emerald-950/20 backdrop-blur-sm shadow-sm">
            <h4 className="text-xs font-bold text-emerald-400 mb-1.5 uppercase tracking-wider">Warnings</h4>
            <div className="space-y-1">
              {signal.warnings.slice(0, 3).map((warning, index) => (
                <div
                  key={index}
                  className="text-xs text-neutral bg-neutral/10 rounded-lg px-2 py-1 border border-neutral/20"
                >
                  {warning}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Error Message */}
      {hasError && signal?.error && (
        <div className="p-3 bg-bearish/10 border border-bearish/30 rounded-xl shadow-sm">
          <div className="text-xs text-bearish font-semibold">{signal.error}</div>
        </div>
      )}
    </div>
  );
};

// Compact version for inline display
export const BuyOnDipBadge: React.FC<BuyOnDipCardProps> = ({
  symbol,
  signal,
  className = '',
}) => {
  const isActive = signal?.signal === 'BUY-ON-DIP';
  const confidence = signal?.percentage || 0;

  return (
    <div
      className={`
        inline-flex items-center gap-2 px-3 py-2 rounded-lg border-2
        transition-all duration-300 shadow-md
        ${
          isActive
            ? 'bg-bullish/10 border-bullish/40 text-bullish'
            : 'bg-dark-card/30 border-dark-border/30 text-dark-muted'
        }
        ${className}
      `}
    >
      <div
        className={`
          w-2 h-2 rounded-full
          ${isActive ? 'bg-bullish animate-pulse' : 'bg-dark-border'}
        `}
      />
      <div className="text-xs font-bold uppercase tracking-wider">
        {isActive ? `BUY DIP ${confidence}%` : 'NO DIP'}
      </div>
    </div>
  );
};

export default BuyOnDipCard;
