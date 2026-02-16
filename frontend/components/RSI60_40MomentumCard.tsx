'use client';

import React, { useMemo } from 'react';

interface RSIMomentumProps {
  symbol: string;
  rsi_5m?: number;
  rsi_15m?: number;
  rsi_5m_signal?: string;
  rsi_15m_signal?: string;
  rsi_momentum_status?: string;
  rsi_momentum_confidence?: number;
  volume_ma_ratio?: number;
  price_momentum?: string;
  last_update?: string;
}

const RSI60_40MomentumCard: React.FC<RSIMomentumProps> = ({
  symbol = 'NIFTY',
  rsi_5m = 50,
  rsi_15m = 50,
  rsi_5m_signal = 'NEUTRAL',
  rsi_15m_signal = 'NEUTRAL',
  rsi_momentum_status = 'NEUTRAL',
  rsi_momentum_confidence = 50,
  volume_ma_ratio = 1.0,
  price_momentum = 'FLAT',
  last_update = new Date().toLocaleTimeString()
}) => {
  // Calculate signal strength based on RSI levels and timeframe alignment
  const signalAnalysis = useMemo(() => {
    const confidence = Math.min(100, Math.max(25, rsi_momentum_confidence || 50));
    
    // Determine the primary signal
    let primarySignal = 'NEUTRAL';
    let signalColor = 'bg-amber-500/20 border-amber-500/40 text-amber-300';
    let badgeEmoji = '⚪';
    let textColor = 'text-amber-300';
    let bgGradient = 'from-amber-600/20 via-amber-500/10 to-amber-600/20';
    
    // STRONG BUY: RSI 5m < 30 + RSI 15m < 40 + momentum aligned
    if (rsi_5m < 30 && rsi_15m < 40 && rsi_5m_signal === 'OVERSOLD' && rsi_15m_signal === 'OVERSOLD' && confidence >= 80) {
      primarySignal = 'STRONG_BUY';
      signalColor = 'bg-green-500/25 border-green-500/50 text-green-300';
      badgeEmoji = '🚀';
      textColor = 'text-green-300';
      bgGradient = 'from-green-600/25 via-green-500/15 to-green-600/25';
    }
    // BUY: RSI 5m < 40 + RSI 15m < 50 + aligned
    else if (((rsi_5m < 40 && rsi_15m < 50) || (rsi_5m < 35)) && (rsi_5m_signal === 'OVERSOLD' || rsi_5m_signal === 'WEAK') && confidence >= 65) {
      primarySignal = 'BUY';
      signalColor = 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300';
      badgeEmoji = '📈';
      textColor = 'text-emerald-300';
      bgGradient = 'from-emerald-600/20 via-emerald-500/10 to-emerald-600/20';
    }
    // STRONG SELL: RSI 5m > 70 + RSI 15m > 60 + momentum aligned
    else if (rsi_5m > 70 && rsi_15m > 60 && rsi_5m_signal === 'OVERBOUGHT' && rsi_15m_signal === 'OVERBOUGHT' && confidence >= 80) {
      primarySignal = 'STRONG_SELL';
      signalColor = 'bg-red-500/25 border-red-500/50 text-red-300';
      badgeEmoji = '📉';
      textColor = 'text-red-300';
      bgGradient = 'from-red-600/25 via-red-500/15 to-red-600/25';
    }
    // SELL: RSI 5m > 60 + RSI 15m > 50
    else if (((rsi_5m > 60 && rsi_15m > 50) || (rsi_5m > 65)) && (rsi_5m_signal === 'OVERBOUGHT' || rsi_5m_signal === 'STRONG') && confidence >= 65) {
      primarySignal = 'SELL';
      signalColor = 'bg-rose-500/20 border-rose-500/40 text-rose-300';
      badgeEmoji = '📊';
      textColor = 'text-rose-300';
      bgGradient = 'from-rose-600/20 via-rose-500/10 to-rose-600/20';
    }
    // NEUTRAL: RSI 40-60 range
    else {
      primarySignal = 'NEUTRAL';
      signalColor = 'bg-amber-500/20 border-amber-500/40 text-amber-300';
      badgeEmoji = '⚪';
      textColor = 'text-amber-300';
      bgGradient = 'from-amber-600/20 via-amber-500/10 to-amber-600/20';
    }

    // Determine signal label text
    let signalLabel = primarySignal;
    if (primarySignal === 'STRONG_BUY') signalLabel = '🚀 STRONG BUY';
    else if (primarySignal === 'BUY') signalLabel = '📈 BUY';
    else if (primarySignal === 'STRONG_SELL') signalLabel = '📉 STRONG SELL';
    else if (primarySignal === 'SELL') signalLabel = '📊 SELL';
    else signalLabel = '⚪ NEUTRAL/SIDEWAYS';

    return {
      primarySignal,
      signalLabel,
      signalColor,
      badgeEmoji,
      textColor,
      bgGradient,
      confidence: Math.round(confidence),
      rsi5m: Math.round(rsi_5m),
      rsi15m: Math.round(rsi_15m)
    };
  }, [rsi_5m, rsi_15m, rsi_5m_signal, rsi_15m_signal, rsi_momentum_confidence]);

  return (
    <div className={`relative border-2 rounded-2xl transition-all duration-300 backdrop-blur-sm shadow-xl
      ${signalAnalysis.signalColor} ${signalAnalysis.bgGradient}`}>
      
      {/* Main Card Container */}
      <div className="p-3 sm:p-4">
        
        {/* Symbol & Status Badge Row */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-white text-base sm:text-lg tracking-tight">
              {symbol}
            </h3>
            <span className="text-lg sm:text-xl">{signalAnalysis.badgeEmoji}</span>
          </div>
          <div className={`text-center px-2.5 py-1 rounded-lg border-2 bg-black/30 ${signalAnalysis.signalColor}`}>
            <div className="text-[10px] font-semibold text-white/60">Confidence</div>
            <div className="text-base font-bold text-white">{signalAnalysis.confidence}%</div>
          </div>
        </div>

        {/* PROMINENT SIGNAL */}
        <div className="mb-3 p-3 sm:p-3.5 rounded-lg bg-black/30 border border-white/20">
          <div className={`text-lg sm:text-xl font-bold tracking-tight ${signalAnalysis.textColor} drop-shadow-lg`}>
            {signalAnalysis.signalLabel}
          </div>
          <p className="text-xs text-white/60 mt-1 font-medium">
            RSI Momentum • Entry & Trend
          </p>
        </div>

        {/* RSI Values Comparison - Side by Side */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          {/* 5-Minute RSI */}
          <div className="p-2 rounded-lg bg-black/20 border border-white/10">
            <div className="text-[10px] font-bold text-white/60 mb-1">5-MIN</div>
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex-1">
                <div className="relative h-1 bg-gray-700/40 rounded-full overflow-hidden border border-white/10">
                  <div 
                    className={`absolute h-full transition-all ${
                      signalAnalysis.rsi5m < 30 ? 'bg-green-500' :
                      signalAnalysis.rsi5m < 40 ? 'bg-emerald-500' :
                      signalAnalysis.rsi5m < 60 ? 'bg-amber-500' :
                      signalAnalysis.rsi5m < 70 ? 'bg-rose-500' :
                      'bg-red-500'
                    }`}
                    style={{ width: `${(signalAnalysis.rsi5m / 100) * 100}%` }}
                  />
                </div>
              </div>
              <span className={`text-xs font-bold whitespace-nowrap ${
                signalAnalysis.rsi5m < 30 ? 'text-green-300' :
                signalAnalysis.rsi5m < 40 ? 'text-emerald-300' :
                signalAnalysis.rsi5m < 60 ? 'text-amber-300' :
                signalAnalysis.rsi5m < 70 ? 'text-rose-300' :
                'text-red-300'
              }`}>
                {signalAnalysis.rsi5m}
              </span>
            </div>
            <div className="text-[9px] text-white/40 mt-0.5 font-bold">
              {rsi_5m_signal || 'NEUTRAL'}
            </div>
          </div>

          {/* 15-Minute RSI */}
          <div className="p-2 rounded-lg bg-black/20 border border-white/10">
            <div className="text-[10px] font-bold text-white/60 mb-1">15-MIN</div>
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex-1">
                <div className="relative h-1 bg-gray-700/40 rounded-full overflow-hidden border border-white/10">
                  <div 
                    className={`absolute h-full transition-all ${
                      signalAnalysis.rsi15m < 30 ? 'bg-green-500' :
                      signalAnalysis.rsi15m < 40 ? 'bg-emerald-500' :
                      signalAnalysis.rsi15m < 60 ? 'bg-amber-500' :
                      signalAnalysis.rsi15m < 70 ? 'bg-rose-500' :
                      'bg-red-500'
                    }`}
                    style={{ width: `${(signalAnalysis.rsi15m / 100) * 100}%` }}
                  />
                </div>
              </div>
              <span className={`text-xs font-bold whitespace-nowrap ${
                signalAnalysis.rsi15m < 30 ? 'text-green-300' :
                signalAnalysis.rsi15m < 40 ? 'text-emerald-300' :
                signalAnalysis.rsi15m < 60 ? 'text-amber-300' :
                signalAnalysis.rsi15m < 70 ? 'text-rose-300' :
                'text-red-300'
              }`}>
                {signalAnalysis.rsi15m}
              </span>
            </div>
            <div className="text-[9px] text-white/40 mt-0.5 font-bold">
              {rsi_15m_signal || 'NEUTRAL'}
            </div>
          </div>
        </div>

        {/* Status Info Row */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/10 text-[10px] text-white/50 font-medium">
          <span>Vol: {(volume_ma_ratio || 1.0).toFixed(2)}x</span>
          <span>{price_momentum || 'FLAT'}</span>
          <span className="text-[9px]">{last_update}</span>
        </div>
      </div>

      {/* No Connection Error Indicator */}
      <div className="absolute top-2 right-2">
        <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-lg shadow-green-500/50" />
      </div>
    </div>
  );
};

export default RSI60_40MomentumCard;
