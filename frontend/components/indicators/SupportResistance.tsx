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

  const formatPrice = (price: number | undefined) => {
    if (price == null || isNaN(price)) return '0.00';
    return price.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  };

  return (
    <div className="space-y-3">
      {/* Resistance */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-red-500 font-semibold">RESISTANCE</span>
        <span className="text-red-400 font-bold px-3 py-1.5 rounded-lg bg-red-950/30 border-2 border-red-500/40 shadow-md shadow-red-500/20">
          {formatPrice(resistance)}
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
        <span className="text-green-400 font-bold px-3 py-1.5 rounded-lg bg-green-950/30 border-2 border-green-500/40 shadow-md shadow-green-500/20">
          {formatPrice(support)}
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
