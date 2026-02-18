'use client';

import React, { memo, useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { API_CONFIG } from '@/lib/api-config';

interface TrendBaseData {
  symbol: string;
  structure: {
    type: string;
    integrity_score: number;
    swing_points: {
      last_high: number;
      last_low: number;
      prev_high: number;
      prev_low: number;
      high_diff: number;
      low_diff: number;
    };
  };
  signal: string;
  confidence: number;
  trend: string;
  status: string;
  timestamp: string;
  data_status?: string;
  candles_analyzed?: number;
  _isCached?: boolean;
}

interface TrendBaseCardProps {
  symbol: string;
  name: string;
}

const TrendBaseCard = memo<TrendBaseCardProps>(({ symbol, name }) => {
  const [data, setData] = useState<TrendBaseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(
          API_CONFIG.endpoint(`/api/advanced/trend-base/${symbol}`),
          { signal: controller.signal }
        );
        clearTimeout(timeoutId);
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        
        if (!result || typeof result !== 'object') {
          setError('Invalid data');
          setData(null);
        } else if (result.status === 'TOKEN_EXPIRED' || result.status === 'ERROR') {
          setError(result.message || 'Login required');
          setData(null);
        } else if (result.status === 'NO_DATA') {
          setError('Market closed');
          setData(null);
        } else {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          setError('Timeout');
        } else {
          setError('Connection error');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    // 🔥 IMPROVED: Fetch every 5 seconds (was 15s) for responsive trend updates
    // Pre-open: 5s | Live trading: 5s | Post-market: 5s
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [symbol]);

  // Determine trading signal based on data
  const getTradingSignal = (): { signal: string; color: string; bgColor: string; icon: JSX.Element } => {
    if (!data || !data.structure) {
      return { signal: 'NO DATA', color: 'text-gray-400', bgColor: 'bg-gray-900/20', icon: <Minus className="w-8 h-8" /> };
    }

    const integrity = data.structure.integrity_score || 0;
    const trend = data.trend || 'SIDEWAYS';
    const baseSignal = data.signal || 'NEUTRAL';
    
    // STRONG BUY: High integrity + clear uptrend
    if (integrity >= 75 && trend === 'UPTREND' && baseSignal === 'BUY') {
      return { 
        signal: 'STRONG BUY', 
        color: 'text-emerald-300', 
        bgColor: 'from-emerald-500/20 to-green-500/10', 
        icon: <TrendingUp className="w-8 h-8" /> 
      };
    }
    
    // BUY: Moderate integrity + uptrend
    if (integrity >= 50 && (trend === 'UPTREND' || baseSignal === 'BUY')) {
      return { 
        signal: 'BUY', 
        color: 'text-green-300', 
        bgColor: 'from-green-500/15 to-green-600/8', 
        icon: <TrendingUp className="w-8 h-8" /> 
      };
    }
    
    // STRONG SELL: High integrity + clear downtrend
    if (integrity >= 75 && trend === 'DOWNTREND' && baseSignal === 'SELL') {
      return { 
        signal: 'STRONG SELL', 
        color: 'text-rose-300', 
        bgColor: 'from-rose-500/20 to-red-500/10', 
        icon: <TrendingDown className="w-8 h-8" /> 
      };
    }
    
    // SELL: Moderate integrity + downtrend
    if (integrity >= 50 && (trend === 'DOWNTREND' || baseSignal === 'SELL')) {
      return { 
        signal: 'SELL', 
        color: 'text-red-300', 
        bgColor: 'from-red-500/15 to-red-600/8', 
        icon: <TrendingDown className="w-8 h-8" /> 
      };
    }
    
    // SIDEWAYS/NO TRADE - Low confidence or unclear trend
    return { 
      signal: 'SIDEWAYS', 
      color: 'text-amber-300', 
      bgColor: 'from-amber-500/15 to-yellow-500/8', 
      icon: <Minus className="w-8 h-8" /> 
    };
  };

  // Calculate live market confidence (realistic 35-85% range)
  const getLiveConfidence = (): number => {
    if (!data) return 35;
    
    let confidence = 45; // Lower base
    const integrity = data.structure?.integrity_score || 0;
    const isLive = data.status === 'LIVE' || data.status === 'ACTIVE';
    
    // Market status impact (reduced)
    if (isLive) confidence += 12;
    else if (data.status === 'CACHED') confidence += 6;
    else confidence -= 10;
    
    // Pattern strength (reduced to prevent 100%)
    if (integrity >= 80) confidence += 18;
    else if (integrity >= 70) confidence += 14;
    else if (integrity >= 60) confidence += 10;
    else if (integrity >= 50) confidence += 6;
    else if (integrity < 30) confidence -= 15;
    
    // Signal clarity (reduced)
    if (data.signal === 'BUY' || data.signal === 'SELL') confidence += 8;
    else confidence -= 8;
    
    // Market hours bonus (reduced)
    const hour = new Date().getHours();
    if (isLive && hour >= 9 && hour <= 15) confidence += 5;
    
    // Cap at 85% - never show 100% (unrealistic)
    return Math.min(85, Math.max(35, Math.round(confidence)));
  };

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-slate-900/40 to-slate-950/20 border-2 border-slate-700/30 rounded-2xl p-6 animate-pulse">
        <div className="h-32 bg-slate-800/30 rounded-xl"></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-gradient-to-br from-slate-900/40 to-slate-950/20 border-2 border-rose-500/30 rounded-2xl p-6">
        <div className="text-center">
          <Minus className="w-12 h-12 mx-auto mb-3 text-rose-400/60" />
          <p className="text-lg font-bold text-rose-300 mb-1">{name}</p>
          <p className="text-sm text-rose-400/80">{error || 'Data unavailable'}</p>
        </div>
      </div>
    );
  }

  const tradingSignal = getTradingSignal();
  const liveConfidence = getLiveConfidence();
  const isLive = data.status === 'LIVE' || data.status === 'ACTIVE';

  return (
    <div className={`bg-gradient-to-br ${tradingSignal.bgColor} border-2 rounded-xl p-3 sm:p-4 transition-all duration-300 hover:scale-[1.01] shadow-xl ${
      tradingSignal.signal.includes('BUY') ? 'border-emerald-500/40 shadow-emerald-500/10' :
      tradingSignal.signal.includes('SELL') ? 'border-rose-500/40 shadow-rose-500/10' :
      'border-amber-500/30 shadow-amber-500/10'
    }`}>
      
      {/* Index Name & Confidence Badge */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-base sm:text-lg font-bold text-white/90">{name}</h3>
          {isLive && (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500/15 rounded-full border border-emerald-500/30">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse shadow-lg shadow-emerald-400/50"></span>
              <span className="text-[10px] font-bold text-emerald-300">LIVE</span>
            </div>
          )}
        </div>
        <div className={`text-center px-2.5 py-1 rounded-lg border-2 bg-black/30 ${
          liveConfidence >= 75 ? 'border-emerald-500/40' :
          liveConfidence >= 60 ? 'border-green-500/40' :
          liveConfidence >= 45 ? 'border-amber-500/40' :
          'border-rose-500/40'
        }`}>
          <div className="text-[10px] font-semibold text-white/60">Confidence</div>
          <div className="text-base font-bold text-white">{liveConfidence}%</div>
        </div>
      </div>

      {/* Main Trading Signal - Clear & Readable */}
      <div className="mb-4 text-center py-3 px-3 bg-black/20 rounded-xl border border-white/10">
        <div className="flex items-center justify-center mb-2">
          <div className={`${tradingSignal.color} drop-shadow-[0_0_10px_currentColor]`}>
            {tradingSignal.icon}
          </div>
        </div>
        <h2 className={`text-xl sm:text-2xl font-bold ${tradingSignal.color} mb-1 tracking-tight`}>
          {tradingSignal.signal}
        </h2>
        <p className="text-[10px] sm:text-xs text-white/60 font-medium">
          {tradingSignal.signal.includes('BUY') && '📈 Good time to consider buying'}
          {tradingSignal.signal.includes('SELL') && '📉 Consider selling or avoiding'}
          {tradingSignal.signal === 'SIDEWAYS' && '⚠️ Wait for clear trend'}
        </p>
      </div>

      {/* Live Confidence Meter */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-bold text-white/80">Signal Confidence</span>
          <span className={`text-lg font-bold ${
            liveConfidence >= 75 ? 'text-emerald-300' :
            liveConfidence >= 60 ? 'text-green-300' :
            liveConfidence >= 45 ? 'text-amber-300' :
            'text-rose-300'
          }`}>{liveConfidence}%</span>
        </div>
        <div className="relative w-full h-3 bg-black/30 rounded-full overflow-hidden border border-white/10">
          <div
            className={`absolute inset-y-0 left-0 transition-all duration-700 rounded-full ${
              liveConfidence >= 75 ? 'bg-gradient-to-r from-emerald-500 to-green-400 shadow-lg shadow-emerald-500/50' :
              liveConfidence >= 60 ? 'bg-gradient-to-r from-green-500 to-green-400 shadow-lg shadow-green-500/40' :
              liveConfidence >= 45 ? 'bg-gradient-to-r from-amber-500 to-yellow-400 shadow-lg shadow-amber-500/40' :
              'bg-gradient-to-r from-rose-500 to-red-400 shadow-lg shadow-rose-500/40'
            }`}
            style={{  width: `${liveConfidence}%` }}
          ></div>
        </div>
        <div className="flex justify-between mt-1 text-[9px] font-semibold text-white/40">
          <span>Low</span>
          <span>Medium</span>
          <span>High</span>
        </div>
      </div>

      {/* Quick Insight - What it means */}
      <div className={`p-3 rounded-lg border ${
        tradingSignal.signal.includes('STRONG BUY') ? 'bg-emerald-500/10 border-emerald-500/30' :
        tradingSignal.signal === 'BUY' ? 'bg-green-500/10 border-green-500/30' :
        tradingSignal.signal.includes('STRONG SELL') ? 'bg-rose-500/10 border-rose-500/30' :
        tradingSignal.signal === 'SELL' ? 'bg-red-500/10 border-red-500/30' :
        'bg-amber-500/10 border-amber-500/30'
      }`}>
        <p className="text-xs leading-relaxed text-white/90 font-medium">
          {tradingSignal.signal === 'STRONG BUY' && (
            <span>✅ <strong className="text-emerald-300">Very strong uptrend</strong> - Price making higher highs & higher lows consistently. Best time to buy.</span>
          )}
          {tradingSignal.signal === 'BUY' && (
            <span>✅ <strong className="text-green-300">Uptrend detected</strong> - Price moving up. Good opportunity to consider buying.</span>
          )}
          {tradingSignal.signal === 'STRONG SELL' && (
            <span>⚠️ <strong className="text-rose-300">Very strong downtrend</strong> - Price making lower lows consistently. Avoid buying, consider selling.</span>
          )}
          {tradingSignal.signal === 'SELL' && (
            <span>⚠️ <strong className="text-red-300">Downtrend detected</strong> - Price moving down. Be cautious with new positions.</span>
          )}
          {tradingSignal.signal === 'SIDEWAYS' && (
            <span>⏸️ <strong className="text-amber-300">No clear trend</strong> - Market is sideways. Wait for a clear direction before trading.</span>
          )}
        </p>
      </div>

      {/* Market Data Status Footer */}
      <div className="mt-3 pt-2 border-t border-white/10 flex items-center justify-between text-[10px]">
        <span className="text-white/50 font-medium">
          {isLive ? '📡 Live' : '📊 Cached'}
        </span>
        <span className="text-white/50 font-medium">
          {data.candles_analyzed && `${data.candles_analyzed} candles`}
        </span>
      </div>
    </div>
  );
});

TrendBaseCard.displayName = 'TrendBaseCard';

export default TrendBaseCard;
