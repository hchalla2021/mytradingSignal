/**
 * SupportResistance - Advanced Support & Resistance with Institutional Levels
 * Professional-grade visualization with liquidity zones, order blocks, and volume profile
 */

import React, { useMemo } from 'react';
import { TrendingUp, TrendingDown, AlertTriangle, Target, Shield, Zap } from 'lucide-react';

interface SupportResistanceProps {
  currentPrice: number;
  support: number;
  resistance: number;
  prevDayHigh: number;
  prevDayLow: number;
  prevDayClose: number;
  // Optional advanced features
  volumeProfile?: { high: number; low: number; poc: number }; // Point of Control
  orderBlocks?: { bullish?: number; bearish?: number };
  liquidityZones?: { support: number[]; resistance: number[] };
  weeklyLevels?: { high: number; low: number };
  monthlyLevels?: { high: number; low: number };
}

export const SupportResistance: React.FC<SupportResistanceProps> = ({
  currentPrice,
  support,
  resistance,
  prevDayHigh,
  prevDayLow,
  prevDayClose,
  volumeProfile,
  orderBlocks,
  liquidityZones,
  weeklyLevels,
  monthlyLevels,
}) => {
  // Calculate position percentage for visual bar
  const range = resistance - support;
  const pricePosition = range > 0 ? ((currentPrice - support) / range) * 100 : 50;

  // Calculate absolute distance to support/resistance
  const distanceToResistance = Math.abs(currentPrice - resistance);
  const distanceToSupport = Math.abs(currentPrice - support);
  
  // Advanced zone analysis
  const zoneAnalysis = useMemo(() => {
    const supportStrength = distanceToSupport <= 2 ? 'CRITICAL' : distanceToSupport <= 5 ? 'STRONG' : distanceToSupport <= 10 ? 'MODERATE' : 'WEAK';
    const resistanceStrength = distanceToResistance <= 2 ? 'CRITICAL' : distanceToResistance <= 5 ? 'STRONG' : distanceToResistance <= 10 ? 'MODERATE' : 'WEAK';
    
    // Check if price is in a decision zone
    const inDecisionZone = distanceToSupport <= 5 || distanceToResistance <= 5;
    const nearLiquidity = liquidityZones && (
      liquidityZones.support.some(level => Math.abs(currentPrice - level) <= 3) ||
      liquidityZones.resistance.some(level => Math.abs(currentPrice - level) <= 3)
    );
    
    return { supportStrength, resistanceStrength, inDecisionZone, nearLiquidity };
  }, [currentPrice, support, resistance, distanceToSupport, distanceToResistance, liquidityZones]);
  
  // Graduated alert levels
  const isTouchingResistance = distanceToResistance <= 2; // Within 2 points = TOUCHING
  const isNearResistance = distanceToResistance <= 5 && distanceToResistance > 2; // 2-5 points = NEAR
  const isTouchingSupport = distanceToSupport <= 2; // Within 2 points = TOUCHING
  const isNearSupport = distanceToSupport <= 5 && distanceToSupport > 2; // 2-5 points = NEAR

  const formatPrice = (price: number | undefined) => {
    if (price == null || isNaN(price)) return '0.00';
    return price.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  };

  // Dynamic styling for resistance based on proximity
  const getResistanceStyle = () => {
    if (isTouchingResistance) {
      return 'border-red-500 shadow-red-500/60 animate-ping-fast bg-red-900/50';
    }
    if (isNearResistance) {
      return 'border-red-500/70 shadow-red-500/40 animate-pulse bg-red-950/40';
    }
    return 'border-red-500/40 shadow-red-500/20';
  };

  // Dynamic styling for support based on proximity
  const getSupportStyle = () => {
    if (isTouchingSupport) {
      return 'border-green-500 shadow-green-500/60 animate-ping-fast bg-green-900/50';
    }
    if (isNearSupport) {
      return 'border-green-500/70 shadow-green-500/40 animate-pulse bg-green-950/40';
    }
    return 'border-green-500/40 shadow-green-500/20';
  };

  return (
    <div className="space-y-4">
      {/* Title with Institutional Badge */}
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-bold text-purple-300 flex items-center gap-2">
          <Target className="w-4 h-4" />
          <span>Support/Resistance Zones</span>
        </h4>
        <div className="flex items-center gap-1">
          {zoneAnalysis.nearLiquidity && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40 animate-pulse">
              💧 Liquidity Zone
            </span>
          )}
          {zoneAnalysis.inDecisionZone && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
              ⚡ Decision Zone
            </span>
          )}
        </div>
      </div>

      {/* Resistance Zone - Enhanced */}
      <div className="relative">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <div className="flex items-center gap-2">
            <TrendingDown className="w-3.5 h-3.5 text-red-400" />
            <span className="text-red-400 font-bold">RESISTANCE</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${
              zoneAnalysis.resistanceStrength === 'CRITICAL' ? 'bg-red-500/30 text-red-200 border border-red-400/50' :
              zoneAnalysis.resistanceStrength === 'STRONG' ? 'bg-red-500/20 text-red-300 border border-red-500/40' :
              zoneAnalysis.resistanceStrength === 'MODERATE' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' :
              'bg-gray-500/20 text-gray-400 border border-gray-500/40'
            }`}>
              {zoneAnalysis.resistanceStrength}
            </span>
          </div>
          <span className={`text-red-300 font-bold px-3 py-1.5 rounded-lg border-2 shadow-lg transition-all ${getResistanceStyle()}`}>
            {formatPrice(resistance)}
            {isTouchingResistance && <span className="ml-1 text-xs">🔥</span>}
            {isNearResistance && !isTouchingResistance && <span className="ml-1 text-xs">⚠️</span>}
          </span>
        </div>
        
        {/* Order Block Bearish */}
        {orderBlocks?.bearish && (
          <div className="text-[10px] text-rose-400 bg-rose-500/10 rounded px-2 py-1 mb-1 border border-rose-500/30 flex items-center justify-between">
            <span className="flex items-center gap-1">
              <Shield className="w-3 h-3" />
              <span>Bearish Order Block</span>
            </span>
            <span className="font-bold">₹{orderBlocks.bearish.toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* Enhanced Visual Price Bar with Multi-Timeframe Levels */}
      <div className="relative h-24 bg-gradient-to-b from-red-950/20 via-gray-950/50 to-green-950/20 rounded-lg border border-gray-700/50 overflow-hidden">
        {/* Weekly High/Low Lines */}
        {weeklyLevels && (
          <>
            <div
              className="absolute left-0 right-0 border-t border-blue-400/30 border-dashed"
              style={{ top: `${100 - ((weeklyLevels.high - support) / range) * 100}%` }}
              title="Weekly High"
            >
              <span className="absolute right-1 -top-2 text-[8px] text-blue-400/70">WH</span>
            </div>
            <div
              className="absolute left-0 right-0 border-t border-blue-400/30 border-dashed"
              style={{ top: `${100 - ((weeklyLevels.low - support) / range) * 100}%` }}
              title="Weekly Low"
            >
              <span className="absolute right-1 -top-2 text-[8px] text-blue-400/70">WL</span>
            </div>
          </>
        )}

        {/* Monthly High/Low Lines */}
        {monthlyLevels && (
          <>
            <div
              className="absolute left-0 right-0 border-t border-purple-400/30 border-dotted"
              style={{ top: `${100 - ((monthlyLevels.high - support) / range) * 100}%` }}
              title="Monthly High"
            >
              <span className="absolute right-1 -top-2 text-[8px] text-purple-400/70">MH</span>
            </div>
            <div
              className="absolute left-0 right-0 border-t border-purple-400/30 border-dotted"
              style={{ top: `${100 - ((monthlyLevels.low - support) / range) * 100}%` }}
              title="Monthly Low"
            >
              <span className="absolute right-1 -top-2 text-[8px] text-purple-400/70">ML</span>
            </div>
          </>
        )}

        {/* Volume Profile POC (Point of Control) */}
        {volumeProfile?.poc && (
          <div
            className="absolute left-0 right-0 border-t-2 border-amber-500/50"
            style={{ top: `${100 - ((volumeProfile.poc - support) / range) * 100}%` }}
            title="Volume Point of Control"
          >
            <span className="absolute left-1 -top-2 text-[8px] text-amber-400 font-bold bg-amber-950/80 px-1 rounded">POC</span>
          </div>
        )}

        {/* Liquidity Zones */}
        {liquidityZones?.support.map((level, idx) => (
          <div
            key={`liq-sup-${idx}`}
            className="absolute left-0 right-0 h-1 bg-cyan-500/20 border-y border-cyan-500/40"
            style={{ top: `${100 - ((level - support) / range) * 100}%` }}
            title="Liquidity Support"
          />
        ))}
        {liquidityZones?.resistance.map((level, idx) => (
          <div
            key={`liq-res-${idx}`}
            className="absolute left-0 right-0 h-1 bg-rose-500/20 border-y border-rose-500/40"
            style={{ top: `${100 - ((level - support) / range) * 100}%` }}
            title="Liquidity Resistance"
          />
        ))}

        {/* Current Price Indicator - Enhanced */}
        <div
          className="absolute left-0 right-0 flex items-center justify-center z-10"
          style={{ top: `${100 - pricePosition}%` }}
        >
          <div className="relative">
            <div className="absolute inset-0 bg-cyan-500 blur-md opacity-60 animate-pulse"></div>
            <div className="relative bg-gradient-to-r from-cyan-600 to-blue-600 text-white text-xs font-black px-4 py-1.5 rounded-full shadow-2xl border-2 border-cyan-400/50 flex items-center gap-1.5">
              <Zap className="w-3 h-3" />
              <span>₹{formatPrice(currentPrice)}</span>
            </div>
          </div>
        </div>

        {/* Previous Day Close Line */}
        {prevDayClose !== currentPrice && (
          <div
            className="absolute left-0 right-0 border-t-2 border-dashed border-yellow-600/60"
            style={{
              top: `${100 - ((prevDayClose - support) / range) * 100}%`,
            }}
          >
            <span className="absolute left-1 -top-2 text-[8px] text-yellow-500/80 bg-yellow-950/80 px-1 rounded">PDC</span>
          </div>
        )}
      </div>

      {/* Support Zone - Enhanced */}
      <div className="relative">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-green-400" />
            <span className="text-green-400 font-bold">SUPPORT</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${
              zoneAnalysis.supportStrength === 'CRITICAL' ? 'bg-green-500/30 text-green-200 border border-green-400/50' :
              zoneAnalysis.supportStrength === 'STRONG' ? 'bg-green-500/20 text-green-300 border border-green-500/40' :
              zoneAnalysis.supportStrength === 'MODERATE' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' :
              'bg-gray-500/20 text-gray-400 border border-gray-500/40'
            }`}>
              {zoneAnalysis.supportStrength}
            </span>
          </div>
          <span className={`text-green-300 font-bold px-3 py-1.5 rounded-lg border-2 shadow-lg transition-all ${getSupportStyle()}`}>
            {formatPrice(support)}
            {isTouchingSupport && <span className="ml-1 text-xs">🔥</span>}
            {isNearSupport && !isTouchingSupport && <span className="ml-1 text-xs">⚠️</span>}
          </span>
        </div>
        
        {/* Order Block Bullish */}
        {orderBlocks?.bullish && (
          <div className="text-[10px] text-green-400 bg-green-500/10 rounded px-2 py-1 mt-1 border border-green-500/30 flex items-center justify-between">
            <span className="flex items-center gap-1">
              <Shield className="w-3 h-3" />
              <span>Bullish Order Block</span>
            </span>
            <span className="font-bold">₹{orderBlocks.bullish.toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* Key Levels Grid - Enhanced */}
      <div className="grid grid-cols-3 gap-2 pt-3 border-t border-gray-700/50">
        <div className="text-center bg-gradient-to-b from-red-500/10 to-transparent rounded-lg p-2 border border-red-500/20">
          <div className="text-[10px] text-red-400/80 font-semibold mb-1">PDH</div>
          <div className="text-xs text-red-300 font-bold">{formatPrice(prevDayHigh)}</div>
          <div className="text-[8px] text-red-400/60 mt-0.5">Prev Day High</div>
        </div>
        <div className="text-center bg-gradient-to-b from-yellow-500/10 to-transparent rounded-lg p-2 border border-yellow-500/30">
          <div className="text-[10px] text-yellow-400/80 font-semibold mb-1">PDC</div>
          <div className="text-xs text-yellow-300 font-bold">{formatPrice(prevDayClose)}</div>
          <div className="text-[8px] text-yellow-400/60 mt-0.5">Prev Day Close</div>
        </div>
        <div className="text-center bg-gradient-to-b from-green-500/10 to-transparent rounded-lg p-2 border border-green-500/20">
          <div className="text-[10px] text-green-400/80 font-semibold mb-1">PDL</div>
          <div className="text-xs text-green-300 font-bold">{formatPrice(prevDayLow)}</div>
          <div className="text-[8px] text-green-400/60 mt-0.5">Prev Day Low</div>
        </div>
      </div>

      {/* Zone Strength Indicator */}
      <div className="mt-3 flex items-center justify-between text-[10px] bg-gradient-to-r from-purple-500/10 to-transparent rounded-lg p-2 border border-purple-500/30">
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3 text-purple-400" />
          <span className="text-purple-300 font-semibold">Zone Health:</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5">
            {[...Array(5)].map((_, i) => {
              const threshold = (i + 1) * 2; // 2, 4, 6, 8, 10 points
              const isActive = distanceToSupport <= threshold || distanceToResistance <= threshold;
              return (
                <div
                  key={i}
                  className={`w-1 h-3 rounded-full transition-all ${
                    isActive ? 'bg-gradient-to-t from-green-500 to-emerald-400' : 'bg-gray-700/50'
                  }`}
                />
              );
            })}
          </div>
          <span className={`font-bold ${
            (distanceToSupport <= 2 || distanceToResistance <= 2) ? 'text-green-300' :
            (distanceToSupport <= 5 || distanceToResistance <= 5) ? 'text-amber-300' :
            'text-gray-400'
          }`}>
            {(distanceToSupport <= 2 || distanceToResistance <= 2) ? 'ACTIVE' :
             (distanceToSupport <= 5 || distanceToResistance <= 5) ? 'WATCHING' : 'NEUTRAL'}
          </span>
        </div>
      </div>
    </div>
  );
};
