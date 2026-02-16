'use client';
import { memo, useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Minus, Activity } from 'lucide-react';

// Simplified SuperTrend data interface - only essential fields
interface SuperTrendData {
  symbol: string;
  status: string;
  timestamp: string;
  current_price: number;
  supertrend_value: number;
  supertrend_trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  supertrend_signal: 'BUY' | 'SELL' | 'HOLD';
  distance_to_st: number;
  distance_to_st_pct: number;
  st_confidence: number;
  is_sideways: boolean;
  change: number;
  changePercent: number;
  atr_pct: number;
}

interface SuperTrendCardProps {
  symbol: string;
  timeframe?: string;
}

const SuperTrendCard = memo(({ symbol, timeframe = '5m' }: SuperTrendCardProps) => {
  const [data, setData] = useState<SuperTrendData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Get SuperTrend signal - STRONG BUY/BUY/SIDEWAYS/SELL/STRONG SELL
  const getSuperTrendSignal = (stData: SuperTrendData): string => {
    if (!stData) return 'SIDEWAYS';

    const { supertrend_trend, supertrend_signal, distance_to_st_pct, is_sideways, changePercent, atr_pct } = stData;

    // SIDEWAYS - Market is ranging/choppy
    if (is_sideways || supertrend_signal === 'HOLD') {
      return 'SIDEWAYS';
    }

    // STRONG BUY - Bullish with strong confirmation
    if (supertrend_trend === 'BULLISH' && supertrend_signal === 'BUY') {
      // Strong if: far from ST line + positive momentum + good volatility
      if (distance_to_st_pct > 1.5 && changePercent > 0.3 && atr_pct > 0.5) {
        return 'STRONG BUY';
      }
      return 'BUY';
    }

    // STRONG SELL - Bearish with strong confirmation
    if (supertrend_trend === 'BEARISH' && supertrend_signal === 'SELL') {
      // Strong if: far from ST line + negative momentum + good volatility
      if (distance_to_st_pct > 1.5 && changePercent < -0.3 && atr_pct > 0.5) {
        return 'STRONG SELL';
      }
      return 'SELL';
    }

    return 'SIDEWAYS';
  };

  // Calculate confidence - 35-85% realistic range
  const calculateSuperTrendConfidence = (stData: SuperTrendData): number => {
    if (!stData) return 40;

    let confidence = 50; // Base confidence

    const { 
      supertrend_trend,
      supertrend_signal,
      distance_to_st_pct,
      is_sideways,
      change,
      changePercent,
      atr_pct,
      st_confidence,
      status
    } = stData;

    // 1. Trend strength (30% weight)
    if (supertrend_trend === 'BULLISH' || supertrend_trend === 'BEARISH') {
      if (distance_to_st_pct > 2) confidence += 20; // Far from ST line
      else if (distance_to_st_pct > 1) confidence += 15;
      else if (distance_to_st_pct > 0.5) confidence += 10;
      else confidence += 5;
    } else {
      confidence -= 10; // Neutral trend
    }

    // 2. Signal clarity (25% weight)
    if (supertrend_signal === 'BUY' || supertrend_signal === 'SELL') {
      confidence += 18;
    } else if (supertrend_signal === 'HOLD') {
      confidence -= 15; // Hold = uncertain
    }

    // 3. Momentum alignment (20% weight)
    if (supertrend_trend === 'BULLISH' && changePercent > 0) {
      if (changePercent > 1) confidence += 15;
      else if (changePercent > 0.5) confidence += 12;
      else confidence += 8;
    } else if (supertrend_trend === 'BEARISH' && changePercent < 0) {
      if (changePercent < -1) confidence += 15;
      else if (changePercent < -0.5) confidence += 12;
      else confidence += 8;
    } else if ((supertrend_trend === 'BULLISH' && changePercent < 0) || 
               (supertrend_trend === 'BEARISH' && changePercent > 0)) {
      confidence -= 10; // Divergence
    }

    // 4. Volatility quality (15% weight)
    if (atr_pct > 0.8) confidence += 12; // Good volatility
    else if (atr_pct > 0.5) confidence += 8;
    else if (atr_pct > 0.3) confidence += 4;
    else confidence -= 8; // Too low volatility = choppy

    // 5. Market condition (10% weight)
    if (is_sideways) {
      confidence -= 15; // Sideways = unreliable
    } else {
      confidence += 8; // Trending = reliable
    }

    // 6. Market status (5% weight)
    if (status === 'LIVE') {
      confidence += 5;
    } else if (status === 'CACHED') {
      confidence += 2;
    } else {
      confidence -= 5;
    }

    // Clamp to 35-85% range
    return Math.max(35, Math.min(85, Math.round(confidence)));
  };

  useEffect(() => {
    let controller: AbortController | null = null;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        controller = new AbortController();
        const timeoutId = setTimeout(() => controller?.abort(), 15000);

        const response = await fetch(
          `http://localhost:8000/api/analysis/analyze/${symbol}`,
          { signal: controller.signal }
        );

        clearTimeout(timeoutId);

        if (response.ok) {
          const result = await response.json();
          if (result?.indicators) {
            // Calculate change if not provided
            const current_price = result.indicators.price || 0;
            const open_price = result.indicators.open || current_price;
            const change = current_price - open_price;
            const changePercent = open_price > 0 ? (change / open_price) * 100 : 0;

            const stData: SuperTrendData = {
              symbol,
              status: result.status || 'LIVE',
              timestamp: result.timestamp || new Date().toISOString(),
              current_price,
              supertrend_value: result.indicators.supertrend_10_2_value || 0,
              supertrend_trend: result.indicators.supertrend_10_2_trend || 'NEUTRAL',
              supertrend_signal: result.indicators.supertrend_10_2_signal || 'HOLD',
              distance_to_st: result.indicators.supertrend_10_2_distance || 0,
              distance_to_st_pct: result.indicators.supertrend_10_2_distance_pct || 0,
              st_confidence: result.indicators.supertrend_10_2_confidence || 50,
              is_sideways: result.indicators.is_sideways_market || false,
              change,
              changePercent,
              atr_pct: result.indicators.atr_estimated_pct || 0,
            };
            setData(stData);
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          setError('Failed to load');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 10000);

    return () => {
      clearInterval(interval);
      controller?.abort();
    };
  }, [symbol, timeframe]);

  const formatPrice = (price: number) => price?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (loading && !data) {
    return (
      <div className="border-2 border-cyan-500/20 rounded-xl p-4 bg-dark-card/50">
        <div className="flex items-center gap-2 text-xs text-dark-secondary">
          <Activity className="w-3 h-3 animate-spin" />
          <span>Loading SuperTrend...</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="border-2 border-red-500/20 rounded-xl p-4 bg-dark-card/50">
        <div className="text-xs text-red-400">Error loading SuperTrend</div>
      </div>
    );
  }

  const signal = getSuperTrendSignal(data);
  const confidence = calculateSuperTrendConfidence(data);
  const marketStatus = data.status || 'OFFLINE';

  const getSignalColor = (sig: string) => {
    if (sig === 'STRONG BUY') return 'text-emerald-400';
    if (sig === 'BUY') return 'text-emerald-300';
    if (sig === 'SIDEWAYS') return 'text-amber-300';
    if (sig === 'SELL') return 'text-rose-300';
    if (sig === 'STRONG SELL') return 'text-rose-400';
    return 'text-gray-300';
  };

  const getSignalBg = (sig: string) => {
    if (sig === 'STRONG BUY') return 'bg-emerald-500/20 border-emerald-500/40';
    if (sig === 'BUY') return 'bg-emerald-500/15 border-emerald-500/30';
    if (sig === 'SIDEWAYS') return 'bg-amber-500/15 border-amber-500/30';
    if (sig === 'SELL') return 'bg-rose-500/15 border-rose-500/30';
    if (sig === 'STRONG SELL') return 'bg-rose-500/20 border-rose-500/40';
    return 'bg-gray-500/15 border-gray-500/30';
  };

  const getSignalIcon = (sig: string) => {
    if (sig === 'STRONG BUY' || sig === 'BUY') return <TrendingUp className="w-6 h-6" />;
    if (sig === 'STRONG SELL' || sig === 'SELL') return <TrendingDown className="w-6 h-6" />;
    return <Minus className="w-6 h-6" />;
  };

  const getConfidenceLabel = (conf: number) => {
    if (conf >= 70) return 'High';
    if (conf >= 55) return 'Medium';
    return 'Low';
  };

  const getTrendLabel = (trend: string) => {
    if (trend === 'BULLISH') return 'Uptrend';
    if (trend === 'BEARISH') return 'Downtrend';
    return 'Ranging';
  };

  return (
    <div className={`border-2 ${getSignalBg(signal)} rounded-xl p-4 bg-gradient-to-br from-dark-card/80 to-dark-surface/60 backdrop-blur-sm transition-all duration-300`}>
      {/* Header with Symbol and Market Status */}
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-base font-bold text-dark-text">{symbol}</h4>
        <div className="flex items-center gap-2">
          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-md ${
            marketStatus === 'LIVE' ? 'bg-green-500/20 text-green-300' :
            marketStatus === 'CACHED' ? 'bg-amber-500/20 text-amber-300' :
            'bg-gray-500/20 text-gray-400'
          }`}>
            {marketStatus === 'LIVE' && <span className="inline-block w-1.5 h-1.5 bg-green-400 rounded-full mr-1 animate-pulse" />}
            {marketStatus}
          </span>
          <span className="text-[10px] text-dark-tertiary">ST 10,2</span>
        </div>
      </div>

      {/* Signal Display */}
      <div className={`border-2 ${getSignalBg(signal)} rounded-lg p-3 mb-3`}>
        <div className="flex items-center gap-3">
          <div className={getSignalColor(signal)}>{getSignalIcon(signal)}</div>
          <div className="flex-1">
            <div className={`text-2xl font-black ${getSignalColor(signal)}`}>{signal}</div>
            <div className="text-xs text-dark-secondary mt-0.5">
              {signal === 'STRONG BUY' && 'Strong uptrend with momentum'}
              {signal === 'BUY' && 'Price above SuperTrend line'}
              {signal === 'SIDEWAYS' && 'Market ranging, avoid trading'}
              {signal === 'SELL' && 'Price below SuperTrend line'}
              {signal === 'STRONG SELL' && 'Strong downtrend with momentum'}
            </div>
          </div>
        </div>
      </div>

      {/* Confidence Meter */}
      <div className="mb-3">
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-xs text-dark-secondary font-medium">Confidence</span>
          <span className="text-lg font-black text-dark-text">{confidence}%</span>
        </div>
        <div className="h-2 bg-dark-surface rounded-full overflow-hidden">
          <div 
            className={`h-full transition-all duration-500 ${
              confidence >= 70 ? 'bg-emerald-500' :
              confidence >= 55 ? 'bg-amber-500' :
              'bg-rose-500'
            }`}
            style={{ width: `${confidence}%` }}
          />
        </div>
        <div className="text-[10px] text-dark-tertiary text-right mt-0.5">{getConfidenceLabel(confidence)}</div>
      </div>

      {/* Current Price & Change */}
      <div className="bg-dark-surface/50 rounded-lg p-2.5 mb-2.5">
        <div className="flex justify-between items-center">
          <span className="text-xs text-dark-secondary">Current Price</span>
          <div className="text-right">
            <div className="text-xl font-black text-dark-text">₹{formatPrice(data.current_price)}</div>
            <div className={`text-xs font-semibold ${
              data.changePercent > 0 ? 'text-emerald-400' :
              data.changePercent < 0 ? 'text-rose-400' :
              'text-gray-400'
            }`}>
              {data.changePercent > 0 ? '+' : ''}{data.changePercent.toFixed(2)}%
            </div>
          </div>
        </div>
      </div>

      {/* SuperTrend Level & Trend */}
      <div className="grid grid-cols-2 gap-2 mb-2.5">
        <div className={`${
          data.supertrend_trend === 'BULLISH' ? 'bg-emerald-500/10 border border-emerald-500/30' :
          data.supertrend_trend === 'BEARISH' ? 'bg-rose-500/10 border border-rose-500/30' :
          'bg-amber-500/10 border border-amber-500/30'
        } rounded-lg p-2`}>
          <div className="text-[10px] text-dark-secondary font-semibold">ST LEVEL</div>
          <div className={`text-sm font-black ${
            data.supertrend_trend === 'BULLISH' ? 'text-emerald-300' :
            data.supertrend_trend === 'BEARISH' ? 'text-rose-300' :
            'text-amber-300'
          }`}>₹{formatPrice(data.supertrend_value)}</div>
          <div className="text-[9px] text-dark-tertiary mt-0.5">
            {data.distance_to_st_pct > 0 ? '+' : ''}{data.distance_to_st_pct.toFixed(2)}%
          </div>
        </div>
        <div className={`${
          data.supertrend_trend === 'BULLISH' ? 'bg-emerald-500/10 border border-emerald-500/30' :
          data.supertrend_trend === 'BEARISH' ? 'bg-rose-500/10 border border-rose-500/30' :
          'bg-amber-500/10 border border-amber-500/30'
        } rounded-lg p-2`}>
          <div className="text-[10px] text-dark-secondary font-semibold">TREND</div>
          <div className={`text-sm font-black ${
            data.supertrend_trend === 'BULLISH' ? 'text-emerald-300' :
            data.supertrend_trend === 'BEARISH' ? 'text-rose-300' :
            'text-amber-300'
          }`}>{getTrendLabel(data.supertrend_trend)}</div>
          <div className="text-[9px] text-dark-tertiary mt-0.5">
            {data.is_sideways ? 'Choppy' : 'Trending'}
          </div>
        </div>
      </div>

      {/* Distance & Volatility */}
      <div className="bg-dark-surface/50 rounded-lg p-2">
        <div className="flex justify-between items-center text-xs mb-1">
          <span className="text-dark-secondary">Distance</span>
          <span className="font-bold text-dark-text">₹{Math.abs(data.distance_to_st).toFixed(2)}</span>
        </div>
        <div className="flex justify-between items-center text-xs">
          <span className="text-dark-secondary">Volatility</span>
          <span className={`font-bold ${
            data.atr_pct > 0.8 ? 'text-emerald-400' :
            data.atr_pct > 0.5 ? 'text-amber-400' :
            'text-rose-400'
          }`}>
            {data.atr_pct.toFixed(2)}%
            <span className="text-[9px] ml-1">
              ({data.atr_pct > 0.8 ? 'High' : data.atr_pct > 0.5 ? 'Med' : 'Low'})
            </span>
          </span>
        </div>
      </div>
    </div>
  );
});

SuperTrendCard.displayName = 'SuperTrendCard';

export default SuperTrendCard;
