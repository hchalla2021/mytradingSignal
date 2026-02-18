'use client';

import React, { useEffect, useState, useMemo } from 'react';

interface RSIMomentumData {
  symbol: string;
  rsi_5m: number;
  rsi_15m: number;
  rsi_5m_signal: string;
  rsi_15m_signal: string;
  rsi_momentum_status: string;
  rsi_momentum_confidence: number;
  volume_ma_ratio: number;
  price_momentum: string;
  last_update: string;
}

interface RSIMomentumProps {
  symbol: string;
}

const RSI60_40MomentumCard: React.FC<RSIMomentumProps> = ({ symbol }) => {
  const [data, setData] = useState<RSIMomentumData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch live RSI data from backend
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
        const response = await fetch(`${apiUrl}/api/analysis/rsi-momentum/${symbol}`);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        const result = await response.json();
        if (result && result.rsi_5m !== undefined) {
          setData({
            symbol,
            rsi_5m: Number(result.rsi_5m || 50),
            rsi_15m: Number(result.rsi_15m || 50),
            rsi_5m_signal: result.rsi_5m_signal || 'NEUTRAL',
            rsi_15m_signal: result.rsi_15m_signal || 'NEUTRAL',
            rsi_momentum_status: result.rsi_momentum_status || 'NEUTRAL',
            rsi_momentum_confidence: Number(result.rsi_momentum_confidence || 50),
            volume_ma_ratio: Number(result.volume_ma_ratio || 1.0),
            price_momentum: result.price_momentum || 'FLAT',
            last_update: result.last_update || new Date().toLocaleTimeString()
          });
          setError(null);
        }
      } catch (err) {
        console.error(`Error fetching RSI data for ${symbol}:`, err);
        setError('Unable to fetch RSI data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000); // Refresh every 5 seconds (live updates)
    
    return () => clearInterval(interval);
  }, [symbol]);

  // Calculate signal strength based on RSI levels and timeframe alignment
  const signalAnalysis = useMemo(() => {
    if (!data) {
      return {
        primarySignal: 'LOADING',
        signalLabel: '⏳ Loading...',
        signalColor: 'bg-slate-500/20 border-slate-500/40 text-slate-300',
        badgeEmoji: '⏳',
        textColor: 'text-slate-300',
        bgGradient: 'from-slate-600/20 via-slate-500/10 to-slate-600/20',
        confidence: 0,
        rsi5m: 0,
        rsi15m: 0
      };
    }

    const rsi_5m = data.rsi_5m || 50;
    const rsi_15m = data.rsi_15m || 50;
    const rsi_5m_signal = data.rsi_5m_signal || 'NEUTRAL';
    const rsi_15m_signal = data.rsi_15m_signal || 'NEUTRAL';
    const confidence = Math.min(100, Math.max(25, data.rsi_momentum_confidence || 50));
    
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
  }, [data]);

  if (loading && !data) {
    return (
      <div className="border-2 border-slate-500/30 rounded-2xl p-4 bg-slate-900/20 backdrop-blur-sm animate-pulse">
        <div className="h-8 bg-slate-700 rounded w-24 mb-3"></div>
        <div className="h-12 bg-slate-700 rounded w-full mb-3"></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="h-6 bg-slate-700 rounded"></div>
          <div className="h-6 bg-slate-700 rounded"></div>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="border-2 border-red-500/30 rounded-2xl p-4 bg-red-900/10">
        <div className="text-red-300 text-sm font-semibold">{symbol}</div>
        <div className="text-red-400 text-xs mt-2">{error}</div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className={`relative border-2 rounded-2xl transition-all duration-300 backdrop-blur-sm shadow-xl
      ${signalAnalysis.signalColor} ${signalAnalysis.bgGradient}`}>
      
      {/* Main Card Container */}
      <div className="p-3 sm:p-4">
        
        {/* Symbol & Status Badge Row */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-white text-base sm:text-lg tracking-tight">
              {data.symbol}
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
              {data.rsi_5m_signal || 'NEUTRAL'}
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
              {data.rsi_15m_signal || 'NEUTRAL'}
            </div>
          </div>
        </div>

        {/* Status Info Row */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/10 text-[10px] text-white/50 font-medium">
          <span>Vol: {(data.volume_ma_ratio || 1.0).toFixed(2)}x</span>
          <span>{data.price_momentum || 'FLAT'}</span>
          <span className="text-[9px]">{data.last_update}</span>
        </div>
      </div>

      {/* Live Indicator */}
      <div className="absolute top-2 right-2">
        <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-lg shadow-green-500/50" />
      </div>
    </div>
  );
};

export default RSI60_40MomentumCard;
