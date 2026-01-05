/**
 * SupportResistance - Display support and resistance levels
 * Visual price levels with current price indicator
 */

import React from 'react';

interface SupportResistanceProps {
  currentPrice: number;
  support: number;
  resistance: number;
  prevDayHigh: number;
  prevDayLow: number;
  prevDayClose: number;
}

export const SupportResistance: React.FC<SupportResistanceProps> = ({
  currentPrice,
  support,
  resistance,
  prevDayHigh,
  prevDayLow,
  prevDayClose,
}) => {
  // Calculate position percentage for visual bar
  const range = resistance - support;
  const pricePosition = range > 0 ? ((currentPrice - support) / range) * 100 : 50;

  // Calculate absolute distance to support/resistance
  const distanceToResistance = Math.abs(currentPrice - resistance);
  const distanceToSupport = Math.abs(currentPrice - support);
  
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
    <div className="space-y-3">
      {/* Resistance */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-red-500 font-semibold">RESISTANCE</span>
        <span className={`text-red-400 font-bold px-3 py-1.5 rounded-lg border-2 shadow-md transition-all ${getResistanceStyle()}`}>
          {formatPrice(resistance)}
          {isTouchingResistance && <span className="ml-1 text-xs">🔥</span>}
          {isNearResistance && !isTouchingResistance && <span className="ml-1 text-xs">⚠️</span>}
        </span>
      </div>

      {/* Visual Price Bar */}
      <div className="relative h-16 bg-gradient-to-b from-red-950/20 via-gray-950/50 to-green-950/20 rounded-lg border border-gray-800">
        {/* Current Price Indicator */}
        <div
          className="absolute left-0 right-0 flex items-center justify-center"
          style={{ top: `${100 - pricePosition}%` }}
        >
          <div className="relative">
            <div className="absolute inset-0 bg-blue-600 blur-sm opacity-50"></div>
            <div className="relative bg-blue-900 text-blue-200 text-xs font-bold px-3 py-1 rounded-full shadow-lg border border-blue-800">
              ₹{formatPrice(currentPrice)}
            </div>
          </div>
        </div>

        {/* Previous Day Close Line */}
        {prevDayClose !== currentPrice && (
          <div
            className="absolute left-0 right-0 border-t-2 border-dashed border-yellow-800/50"
            style={{
              top: `${100 - ((prevDayClose - support) / range) * 100}%`,
            }}
          ></div>
        )}
      </div>

      {/* Support */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-green-500 font-semibold">SUPPORT</span>
        <span className={`text-green-400 font-bold px-3 py-1.5 rounded-lg border-2 shadow-md transition-all ${getSupportStyle()}`}>
          {formatPrice(support)}
          {isTouchingSupport && <span className="ml-1 text-xs">🔥</span>}
          {isNearSupport && !isTouchingSupport && <span className="ml-1 text-xs">⚠️</span>}
        </span>
      </div>

      {/* Previous Day Levels */}
      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-800">
        <div className="text-center">
          <div className="text-xs text-gray-600">PDH</div>
          <div className="text-xs text-gray-400 font-semibold">{formatPrice(prevDayHigh)}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-gray-600">PDC</div>
          <div className="text-xs text-yellow-600 font-semibold">{formatPrice(prevDayClose)}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-gray-600">PDL</div>
          <div className="text-xs text-gray-400 font-semibold">{formatPrice(prevDayLow)}</div>
        </div>
      </div>
    </div>
  );
};
