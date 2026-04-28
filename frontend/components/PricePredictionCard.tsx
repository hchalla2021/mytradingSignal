'use client';

import React from 'react';
import { PricePredictions } from '@/hooks/useStrikeIntelligence';
import { ArrowUp, ArrowDown, TrendingUp } from 'lucide-react';

interface PricePredictionCardProps {
  predictions: PricePredictions | undefined;
  isLoading?: boolean;
}

/**
 * PricePredictionCard: Shows lowest prices for ITM/OTM strikes with UP/DOWN predictions
 * 
 * Displays:
 * - Lowest ITM CE Price with direction (UP/DOWN)
 * - Lowest OTM CE Price with direction (UP/DOWN)
 * - Lowest ITM PE Price with direction (UP/DOWN)
 * - Lowest OTM PE Price with direction (UP/DOWN)
 */
export const PricePredictionCard: React.FC<PricePredictionCardProps> = ({
  predictions,
  isLoading = false,
}) => {
  if (!predictions) {
    return null;
  }

  const { lowestItmCe, lowestOtmCe, lowestItmPe, lowestOtmPe } = predictions;

  // Check if any predictions exist
  const hasAnyPrediction = 
    Object.keys(lowestItmCe).length > 0 ||
    Object.keys(lowestOtmCe).length > 0 ||
    Object.keys(lowestItmPe).length > 0 ||
    Object.keys(lowestOtmPe).length > 0;

  if (!hasAnyPrediction) {
    return null;
  }

  // Component for each price prediction
  const PredictionItem: React.FC<{
    label: string;
    prediction: any;
    bgColor: string;
    borderColor: string;
    textColor: string;
  }> = ({ label, prediction, bgColor, borderColor }) => {
    if (!prediction || Object.keys(prediction).length === 0) {
      return null;
    }

    const { price, strike, direction, confidence, signal, velocity } = prediction;
    const isUp = direction === 'UP';
    
    // Confidence color indicator
    const confBg = confidence >= 70 ? 'bg-emerald-500/15' : confidence >= 50 ? 'bg-amber-500/15' : 'bg-slate-500/10';
    const confBorder = confidence >= 70 ? 'border-emerald-500/30' : confidence >= 50 ? 'border-amber-500/30' : 'border-slate-500/20';
    
    // Direction-based styling for price glow
    const priceGlowColor = isUp 
      ? 'shadow-[0_0_20px_6px_rgba(34,197,94,0.4),0_0_40px_12px_rgba(34,197,94,0.15)]'
      : 'shadow-[0_0_20px_6px_rgba(239,68,68,0.4),0_0_40px_12px_rgba(239,68,68,0.15)]';
    
    const priceBgGradient = isUp 
      ? 'bg-gradient-to-br from-emerald-950/30 to-emerald-950/10 border-emerald-500/50'
      : 'bg-gradient-to-br from-red-950/30 to-red-950/10 border-red-500/50';
    
    const directionBadgeStyle = isUp
      ? 'bg-gradient-to-r from-emerald-600/30 to-emerald-500/20 border-emerald-500/50 text-emerald-200'
      : 'bg-gradient-to-r from-red-600/30 to-red-500/20 border-red-500/50 text-red-200';

    return (
      <div className={`flex flex-col gap-3 p-4 sm:p-5 rounded-xl ${bgColor} border-2 ${borderColor} transition-all duration-300 hover:shadow-[0_0_16px_3px_rgba(0,0,0,0.3)]`}>
        {/* Label + Direction Indicator */}
        <div className="flex items-center justify-between">
          <span className="text-[7px] sm:text-[7.5px] font-bold uppercase tracking-widest text-slate-400">{label}</span>
          {/* Direction badge - Bold indicator */}
          <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full border-2 ${directionBadgeStyle} font-bold text-[6.5px] sm:text-[7px] uppercase tracking-tight`}>
            {isUp ? (
              <>
                <ArrowUp className={`h-3 sm:h-3.5 w-3 sm:w-3.5 text-emerald-300`} strokeWidth={3.5} />
                <span>UP</span>
              </>
            ) : (
              <>
                <ArrowDown className={`h-3 sm:h-3.5 w-3 sm:w-3.5 text-red-300`} strokeWidth={3.5} />
                <span>DOWN</span>
              </>
            )}
          </div>
        </div>

        {/* Price - With Glow Effect */}
        <div className={`flex items-baseline gap-2 px-2.5 py-2.5 sm:py-3 rounded-lg border-2 ${priceBgGradient} ${priceGlowColor}`}>
          <span className={`text-2xl sm:text-3xl font-black tabular-nums ${isUp ? 'text-emerald-200' : 'text-red-200'}`}>
            ₹{price?.toFixed(1) ?? '--'}
          </span>
          <span className={`text-[6.5px] sm:text-[7px] font-bold uppercase tracking-tight ${isUp ? 'text-emerald-500' : 'text-red-500'}`}>
            Strike {strike}
          </span>
        </div>

        {/* Confidence Score - Large and Prominent */}
        <div className={`inline-flex items-center justify-between gap-2.5 w-full px-2.5 py-1.5 rounded-lg ${confBg} border-2 ${confBorder}`}>
          <span className={`text-[6.5px] sm:text-[7px] font-bold uppercase tracking-tight ${confidence >= 70 ? 'text-emerald-300' : confidence >= 50 ? 'text-amber-300' : 'text-slate-400'}`}>
            Confidence
          </span>
          <span className={`text-[11px] sm:text-[12px] font-black tabular-nums ${confidence >= 70 ? 'text-emerald-300' : confidence >= 50 ? 'text-amber-300' : 'text-slate-400'}`}>
            {confidence}%
          </span>
        </div>

        {/* Signal & Velocity - Prominent Badges */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Signal Badge */}
          <span className={`px-2 py-1 rounded-lg text-[6px] sm:text-[6.5px] font-bold uppercase tracking-tight border-2 ${
            signal === 'STRONG_BUY' ? 'bg-emerald-950/50 text-emerald-200 border-emerald-500/60' :
            signal === 'BUY' ? 'bg-emerald-950/40 text-emerald-300 border-emerald-500/50' :
            signal === 'STRONG_SELL' ? 'bg-red-950/50 text-red-200 border-red-500/60' :
            signal === 'SELL' ? 'bg-red-950/40 text-red-300 border-red-500/50' :
            'bg-slate-800/50 text-slate-300 border-slate-600/30'
          }`}>
            {signal}
          </span>
          
          {/* Velocity Badge */}
          {velocity && velocity !== 'COLD' && (
            <span className={`px-2 py-1 rounded-lg text-[6px] sm:text-[6.5px] font-bold uppercase tracking-tight border-2 ${
              velocity === 'EXTREME' ? 'bg-red-950/50 text-red-200 border-red-500/60 animate-pulse' :
              velocity === 'HOT' ? 'bg-orange-950/50 text-orange-200 border-orange-500/60' :
              'bg-blue-950/40 text-blue-300 border-blue-500/40'
            }`}>
              ⚡ {velocity}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="mb-4 rounded-xl border-2 border-cyan-500/40 bg-gradient-to-br from-slate-900/60 via-slate-900/50 to-slate-800/40 p-5 sm:p-6 overflow-hidden shadow-xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5 pb-4 border-b-2 border-cyan-500/30">
        <div className="p-2.5 rounded-lg bg-gradient-to-br from-cyan-500/25 to-blue-500/15 border-2 border-cyan-500/40">
          <TrendingUp className="h-5 w-5 sm:h-6 sm:w-6 text-cyan-300" />
        </div>
        <div>
          <h3 className="text-sm sm:text-base font-black text-white tracking-tight">Price Direction Predictions</h3>
          <p className="text-[5px] sm:text-[5.5px] text-cyan-400 uppercase tracking-widest font-bold">Which will GO UP ⬆ and GO DOWN ⬇</p>
        </div>
      </div>

      {/* Grid of 4 predictions — responsive */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
        {/* CE Column */}
        <div className="flex flex-col gap-4">
          {/* ITM CE */}
          <PredictionItem
            label="ITM Call"
            prediction={lowestItmCe}
            bgColor="bg-emerald-950/25"
            borderColor="border-emerald-500/40"
            textColor="text-emerald-300"
          />
          
          {/* OTM CE */}
          <PredictionItem
            label="OTM Call"
            prediction={lowestOtmCe}
            bgColor="bg-emerald-950/15"
            borderColor="border-emerald-500/25"
            textColor="text-emerald-400"
          />
        </div>

        {/* PE Column */}
        <div className="flex flex-col gap-4">
          {/* ITM PE */}
          <PredictionItem
            label="ITM Put"
            prediction={lowestItmPe}
            bgColor="bg-red-950/25"
            borderColor="border-red-500/40"
            textColor="text-red-300"
          />
          
          {/* OTM PE */}
          <PredictionItem
            label="OTM Put"
            prediction={lowestOtmPe}
            bgColor="bg-red-950/15"
            borderColor="border-red-500/25"
            textColor="text-red-400"
          />
        </div>
      </div>

      {/* Direction Legend */}
      <div className="mt-3 pt-3 border-t-2 border-slate-700/40 flex flex-col gap-1.5 text-[6px] sm:text-[6.5px]">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-gradient-to-r from-emerald-600/30 to-emerald-500/20 border border-emerald-500/50">
            <ArrowUp className="h-3 w-3 text-emerald-300" strokeWidth={3.5} />
            <span className="font-bold uppercase text-emerald-200">UP = Increase</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-gradient-to-r from-red-600/30 to-red-500/20 border border-red-500/50">
            <ArrowDown className="h-3 w-3 text-red-300" strokeWidth={3.5} />
            <span className="font-bold uppercase text-red-200">DOWN = Decrease</span>
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm rounded-xl">
          <div className="flex flex-col items-center gap-3">
            <div className="h-6 w-6 animate-spin rounded-full border-3 border-slate-400 border-t-cyan-400" />
            <span className="text-[9px] text-slate-300 font-bold">Analyzing Price Movements...</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default PricePredictionCard;
