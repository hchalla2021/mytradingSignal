'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, Minus, Circle, Activity } from 'lucide-react';

// Simplified interface for Parabolic SAR data (layman perspective)
interface ParabolicSARData {
  symbol: string;
  status: 'LIVE' | 'CACHED' | 'OFFLINE' | 'CLOSED' | 'PRE_OPEN' | 'FREEZE';
  current_price: number;
  sar_value: number;
  sar_position: 'BELOW' | 'ABOVE' | 'NEUTRAL';
  sar_trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  sar_signal: string; // BUY_PSAR, SELL_PSAR, HOLD_BULLISH, HOLD_BEARISH, NEUTRAL
  sar_reversal: boolean;
  distance_to_sar: number;
  distance_to_sar_pct: number;
  sar_confidence: number; // Backend confidence 35-95%
  change: number;
  changePercent: number;
}

interface ParabolicSARCardProps {
  symbol: string;
  timeframe?: '5m' | '15m';
}

const ParabolicSARCard: React.FC<ParabolicSARCardProps> = ({ 
  symbol, 
  timeframe = '5m' 
}) => {
  const [data, setData] = useState<ParabolicSARData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Convert backend SAR data to simple 5-level signal
   * STRONG BUY: Fresh bullish reversal + strong volume + distance > 1%
   * BUY: Bullish trend continuation or weak reversal
   * SIDEWAYS: Neutral or unclear trend
   * SELL: Bearish trend continuation or weak reversal
   * STRONG SELL: Fresh bearish reversal + strong volume + distance > 1%
   */
  const getSARSignal = (data: ParabolicSARData): string => {
    const signal = data.sar_signal || 'NEUTRAL';
    const trend = data.sar_trend || 'NEUTRAL';
    const reversal = data.sar_reversal || false;
    const distancePct = data.distance_to_sar_pct || 0;
    const changePercent = data.changePercent || 0;
    const confidence = data.sar_confidence || 50;

    // STRONG BUY: Fresh bullish reversal with good distance and momentum
    if (signal === 'BUY_PSAR' && reversal && distancePct > 1.0 && changePercent > 0.3 && confidence >= 75) {
      return 'STRONG BUY';
    }
    
    // STRONG SELL: Fresh bearish reversal with good distance and momentum
    if (signal === 'SELL_PSAR' && reversal && distancePct > 1.0 && changePercent < -0.3 && confidence >= 75) {
      return 'STRONG SELL';
    }

    // BUY: Bullish trend or moderate reversal
    if (signal === 'BUY_PSAR' || signal === 'HOLD_BULLISH' || trend === 'BULLISH') {
      return 'BUY';
    }

    // SELL: Bearish trend or moderate reversal
    if (signal === 'SELL_PSAR' || signal === 'HOLD_BEARISH' || trend === 'BEARISH') {
      return 'SELL';
    }

    // SIDEWAYS: Neutral or unclear
    return 'SIDEWAYS';
  };

  /**
   * Calculate confidence % for the SAR signal (35-85% realistic range)
   * Factors:
   * 1. Reversal strength (30%): Fresh reversal vs continuation
   * 2. Distance quality (25%): Price distance from SAR
   * 3. Trend clarity (20%): Clear trend vs neutral
   * 4. Signal strength (15%): Strong vs weak signal from backend
   * 5. Momentum alignment (10%): Price change matches SAR position
   * 6. Market status (5%): LIVE vs CACHED vs OFFLINE
   */
  const calculateSARConfidence = (data: ParabolicSARData): number => {
    let confidence = 40; // Base confidence

    // Factor 1: Reversal strength (30% weight) - Reversals are key SAR signals
    const reversal = data.sar_reversal || false;
    const signal = data.sar_signal || 'NEUTRAL';
    if (reversal && (signal === 'BUY_PSAR' || signal === 'SELL_PSAR')) {
      confidence += 12; // Fresh reversal = +12%
    } else if (signal === 'HOLD_BULLISH' || signal === 'HOLD_BEARISH') {
      confidence += 6; // Trend continuation = +6%
    } else {
      confidence += 2; // Neutral/weak = +2%
    }

    // Factor 2: Distance quality (25% weight) - Farther from SAR = stronger trend
    const distancePct = data.distance_to_sar_pct || 0;
    if (distancePct > 1.5) {
      confidence += 10; // Strong distance > 1.5%
    } else if (distancePct > 0.8) {
      confidence += 6; // Moderate distance 0.8-1.5%
    } else if (distancePct > 0.3) {
      confidence += 3; // Weak distance 0.3-0.8%
    }
    // else: Too close to SAR = no bonus

    // Factor 3: Trend clarity (20% weight)
    const trend = data.sar_trend || 'NEUTRAL';
    if (trend === 'BULLISH' || trend === 'BEARISH') {
      confidence += 8; // Clear trend = +8%
    } else {
      confidence += 2; // Neutral trend = +2%
    }

    // Factor 4: Signal strength (15% weight) - Use backend confidence as reference
    const backendConf = data.sar_confidence || 50;
    if (backendConf >= 80) {
      confidence += 6; // High backend confidence
    } else if (backendConf >= 60) {
      confidence += 4; // Medium backend confidence
    } else {
      confidence += 2; // Low backend confidence
    }

    // Factor 5: Momentum alignment (10% weight)
    const changePercent = data.changePercent || 0;
    const position = data.sar_position || 'NEUTRAL';
    if ((position === 'BELOW' && changePercent > 0.2) || (position === 'ABOVE' && changePercent < -0.2)) {
      confidence += 4; // Momentum aligns with SAR position
    } else if ((position === 'BELOW' && changePercent < -0.2) || (position === 'ABOVE' && changePercent > 0.2)) {
      confidence -= 3; // Momentum diverges from SAR position
    }

    // Factor 6: Market status (5% weight)
    if (data.status === 'LIVE') {
      confidence += 2; // Live data = +2%
    } else if (data.status === 'CACHED') {
      confidence += 1; // Cached data = +1%
    }
    // OFFLINE = no bonus

    // Cap confidence at 35-85% (realistic range for Parabolic SAR)
    return Math.max(35, Math.min(85, Math.round(confidence)));
  };

  const fetchSARData = useCallback(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

    try {
      setError(null);
      const response = await fetch(
        `/api/analysis/analyze/${symbol}`,
        { signal: controller.signal }
      );
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      const result = await response.json();
      
      if (!result || result.error) {
        throw new Error(result?.error || 'Invalid response');
      }

      const indicators = result.indicators || {};
      const currentPrice = parseFloat(result.current_price || result.price || 0);
      const open = parseFloat(result.open || currentPrice);
      const change = currentPrice - open;
      const changePercent = open > 0 ? (change / open) * 100 : 0;

      const sarData: ParabolicSARData = {
        symbol: symbol,
        status: result.status || 'CLOSED',
        current_price: currentPrice,
        sar_value: parseFloat(indicators.sar_value || 0),
        sar_position: indicators.sar_position || 'NEUTRAL',
        sar_trend: indicators.sar_trend || 'NEUTRAL',
        sar_signal: indicators.sar_signal || 'NEUTRAL',
        sar_reversal: indicators.sar_reversal || false,
        distance_to_sar: parseFloat(indicators.distance_to_sar || 0),
        distance_to_sar_pct: parseFloat(indicators.distance_to_sar_pct || 0),
        sar_confidence: parseFloat(indicators.sar_signal_strength || 50),
        change: change,
        changePercent: changePercent,
      };

      setData(sarData);
      setLoading(false);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setError('Request timeout');
      } else {
        setError(err.message || 'Connection error');
      }
      setLoading(false);
    } finally {
      clearTimeout(timeoutId);
    }
  }, [symbol]);

  useEffect(() => {
    fetchSARData();
    const interval = setInterval(fetchSARData, 5000); // Refresh every 5s (live updates during market hours)
    return () => clearInterval(interval);
  }, [fetchSARData]);

  // Loading state
  if (loading) {
    return (
      <div className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-2 border-slate-700/40 rounded-xl p-4 animate-pulse">
        <div className="h-6 bg-slate-700/50 rounded w-32 mb-3"></div>
        <div className="h-20 bg-slate-700/50 rounded mb-3"></div>
        <div className="h-4 bg-slate-700/50 rounded w-24"></div>
      </div>
    );
  }

  // Error state
  if (error || !data) {
    return (
      <div className="bg-gradient-to-br from-red-900/20 to-slate-900/50 border-2 border-red-500/30 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Circle className="w-4 h-4 text-red-400" />
          <span className="text-sm font-bold text-red-300">{symbol}</span>
        </div>
        <div className="text-xs text-red-400 font-medium">
          {error || 'No data available'}
        </div>
        <button 
          onClick={fetchSARData}
          className="mt-2 text-xs text-red-300 hover:text-red-200 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  const signal = getSARSignal(data);
  const confidence = calculateSARConfidence(data);

  // Signal colors and icons
  const signalConfig = {
    'STRONG BUY': {
      bg: 'from-emerald-900/30 to-emerald-950/20',
      border: 'border-emerald-500/50',
      text: 'text-emerald-300',
      icon: TrendingUp,
      glow: 'shadow-emerald-500/20',
    },
    'BUY': {
      bg: 'from-green-900/25 to-green-950/15',
      border: 'border-green-500/40',
      text: 'text-green-300',
      icon: TrendingUp,
      glow: 'shadow-green-500/15',
    },
    'SIDEWAYS': {
      bg: 'from-slate-900/30 to-slate-950/20',
      border: 'border-slate-500/30',
      text: 'text-slate-300',
      icon: Minus,
      glow: 'shadow-slate-500/10',
    },
    'SELL': {
      bg: 'from-orange-900/25 to-orange-950/15',
      border: 'border-orange-500/40',
      text: 'text-orange-300',
      icon: TrendingDown,
      glow: 'shadow-orange-500/15',
    },
    'STRONG SELL': {
      bg: 'from-red-900/30 to-red-950/20',
      border: 'border-red-500/50',
      text: 'text-red-300',
      icon: TrendingDown,
      glow: 'shadow-red-500/20',
    },
  };

  const config = signalConfig[signal as keyof typeof signalConfig] || signalConfig['SIDEWAYS'];
  const SignalIcon = config.icon;

  // Confidence level label
  const confidenceLevel = confidence >= 70 ? 'High' : confidence >= 55 ? 'Medium' : 'Low';
  const confidenceColor = confidence >= 70 ? 'text-emerald-400' : confidence >= 55 ? 'text-yellow-400' : 'text-orange-400';

  return (
    <div className={`bg-gradient-to-br ${config.bg} border-2 ${config.border} rounded-xl p-4 shadow-lg ${config.glow} transition-all duration-300 hover:scale-[1.02]`}>
      {/* Header: Symbol + Status */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-bold text-slate-200">{symbol}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${
            data.status === 'LIVE' ? 'bg-emerald-400 animate-pulse' : 
            data.status === 'CACHED' ? 'bg-yellow-400' : 
            'bg-red-400'
          }`} />
          <span className="text-xs text-slate-400">{timeframe}</span>
        </div>
      </div>

      {/* Large Signal Display */}
      <div className="flex items-center gap-3 mb-4">
        <SignalIcon className={`w-10 h-10 ${config.text}`} strokeWidth={2.5} />
        <div>
          <div className={`text-2xl font-black ${config.text} tracking-tight`}>
            {signal}
          </div>
          {data.sar_reversal && (
            <div className="text-xs text-yellow-300 font-semibold mt-0.5 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-pulse" />
              Reversal Signal
            </div>
          )}
        </div>
      </div>

      {/* Confidence Meter */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-slate-400 font-medium">Confidence</span>
          <span className={`text-sm font-bold ${confidenceColor}`}>
            {confidence}% <span className="text-xs font-normal">({confidenceLevel})</span>
          </span>
        </div>
        <div className="w-full bg-slate-800/50 rounded-full h-2 overflow-hidden">
          <div 
            className={`h-full rounded-full transition-all duration-500 ${
              confidence >= 70 ? 'bg-gradient-to-r from-emerald-500 to-emerald-400' :
              confidence >= 55 ? 'bg-gradient-to-r from-yellow-500 to-yellow-400' :
              'bg-gradient-to-r from-orange-500 to-orange-400'
            }`}
            style={{ width: `${confidence}%` }}
          />
        </div>
        {/* Confidence scale labels */}
        <div className="flex justify-between text-[10px] text-slate-500 mt-0.5 px-0.5">
          <span>Low</span>
          <span>Medium</span>
          <span>High</span>
        </div>
      </div>

      {/* Key Metrics (Minimal) */}
      <div className="space-y-2">
        {/* Current Price + Change */}
        <div className="flex items-center justify-between py-1.5 px-2 bg-slate-900/40 rounded-lg">
          <span className="text-xs text-slate-400">Price</span>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-200">
              ₹{data.current_price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className={`text-xs font-semibold ${
              data.changePercent > 0 ? 'text-emerald-400' : 
              data.changePercent < 0 ? 'text-red-400' : 
              'text-slate-400'
            }`}>
              {data.changePercent > 0 ? '+' : ''}{data.changePercent.toFixed(2)}%
            </span>
          </div>
        </div>

        {/* SAR Level + Trend */}
        <div className="flex items-center justify-between py-1.5 px-2 bg-slate-900/40 rounded-lg">
          <span className="text-xs text-slate-400">SAR Level</span>
          <div className="text-right">
            <div className="text-sm font-bold text-slate-200">
              ₹{data.sar_value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className={`text-[10px] font-semibold ${
              data.sar_trend === 'BULLISH' ? 'text-emerald-400' :
              data.sar_trend === 'BEARISH' ? 'text-red-400' :
              'text-slate-400'
            }`}>
              {data.sar_trend === 'BULLISH' ? 'Uptrend' : 
               data.sar_trend === 'BEARISH' ? 'Downtrend' : 
               'Neutral'}
            </div>
          </div>
        </div>

        {/* Distance to SAR */}
        <div className="flex items-center justify-between py-1.5 px-2 bg-slate-900/40 rounded-lg">
          <span className="text-xs text-slate-400">Distance</span>
          <div className="text-right">
            <div className="text-xs font-semibold text-slate-300">
              ₹{data.distance_to_sar.toFixed(2)}
            </div>
            <div className={`text-[10px] font-medium ${
              data.distance_to_sar_pct > 1.5 ? 'text-emerald-400' :
              data.distance_to_sar_pct > 0.8 ? 'text-yellow-400' :
              'text-orange-400'
            }`}>
              {data.distance_to_sar_pct.toFixed(2)}%
            </div>
          </div>
        </div>
      </div>

      {/* Timeframe Info Footer */}
      <div className="mt-3 pt-2 border-t border-slate-700/40">
        <div className="text-[10px] text-slate-500 text-center">
          {timeframe === '5m' ? '5-min: Trade signals' : '15-min: Trend confirmation'}
        </div>
      </div>
    </div>
  );
};

export default ParabolicSARCard;
