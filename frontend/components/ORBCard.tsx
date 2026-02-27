'use client';
import { memo, useEffect, useState, useRef } from 'react';
import { TrendingUp, TrendingDown, Minus, Clock } from 'lucide-react';
import { API_CONFIG } from '@/lib/api-config';

// Simplified ORB data interface - only essential fields for trader decision
interface ORBData {
  symbol: string;
  status: string;
  timestamp: string;
  current_price: number;
  orb_high: number;
  orb_low: number;
  orb_range: number;
  orb_position: 'ABOVE_HIGH' | 'BELOW_LOW' | 'INSIDE_RANGE';
  orb_strength: number;
  orb_confidence: number;
  change: number;
  changePercent: number;
  distance_to_orb_high?: number;
  distance_to_orb_low?: number;
}

interface ORBCardProps {
  symbol: string;
  timeframe?: string;
}

const ORBCard = memo(({ symbol, timeframe = '5m' }: ORBCardProps) => {
  const [data, setData] = useState<ORBData | null>(null);
  const [loading, setLoading] = useState(true);
  const isFirstFetch = useRef(true);
  const [error, setError] = useState<string | null>(null);

  // Get ORB signal - STRONG BUY/BUY/WAIT/SELL/STRONG SELL
  const getORBSignal = (orbData: ORBData): string => {
    if (!orbData) return 'WAIT';

    const { orb_position, orb_strength, change, changePercent } = orbData;

    // STRONG BUY - Above ORB High with strong momentum
    if (orb_position === 'ABOVE_HIGH') {
      if (orb_strength >= 75 && changePercent > 0.5) {
        return 'STRONG BUY';
      }
      return 'BUY';
    }

    // STRONG SELL - Below ORB Low with strong momentum
    if (orb_position === 'BELOW_LOW') {
      if (orb_strength >= 75 && changePercent < -0.5) {
        return 'STRONG SELL';
      }
      return 'SELL';
    }

    // WAIT - Inside ORB range
    return 'WAIT';
  };

  // Calculate confidence - 35-85% realistic range
  const calculateORBConfidence = (orbData: ORBData): number => {
    if (!orbData) return 40;

    let confidence = 50; // Base confidence

    const { 
      orb_position, 
      orb_strength, 
      orb_range, 
      current_price, 
      orb_high, 
      orb_low,
      distance_to_orb_high,
      distance_to_orb_low,
      change,
      changePercent,
      status
    } = orbData;

    // 1. Position factor (30% weight)
    if (orb_position === 'ABOVE_HIGH' || orb_position === 'BELOW_LOW') {
      // Clear breakout/breakdown
      const distPct = orb_position === 'ABOVE_HIGH' 
        ? ((current_price - orb_high) / orb_range) * 100
        : ((orb_low - current_price) / orb_range) * 100;
      
      if (distPct > 50) confidence += 20; // Far from ORB level
      else if (distPct > 20) confidence += 15;
      else if (distPct > 5) confidence += 10;
      else confidence += 5; // Just broke out
    } else {
      // Inside range - low confidence
      confidence -= 10;
    }

    // 2. Strength factor (25% weight)
    if (orb_strength >= 80) confidence += 18;
    else if (orb_strength >= 70) confidence += 15;
    else if (orb_strength >= 60) confidence += 10;
    else if (orb_strength >= 50) confidence += 5;
    else confidence -= 5;

    // 3. Momentum alignment (20% weight)
    if (orb_position === 'ABOVE_HIGH' && changePercent > 0) {
      if (changePercent > 1) confidence += 15;
      else if (changePercent > 0.5) confidence += 10;
      else confidence += 5;
    } else if (orb_position === 'BELOW_LOW' && changePercent < 0) {
      if (changePercent < -1) confidence += 15;
      else if (changePercent < -0.5) confidence += 10;
      else confidence += 5;
    } else if (orb_position !== 'INSIDE_RANGE' && Math.abs(changePercent) < 0.1) {
      // Breakout but no momentum
      confidence -= 10;
    }

    // 4. ORB range quality (15% weight)
    const rangeQuality = orb_range / current_price * 100; // % of price
    if (rangeQuality > 0.5) confidence += 10; // Good range size
    else if (rangeQuality > 0.3) confidence += 7;
    else if (rangeQuality > 0.1) confidence += 3;
    else confidence -= 5; // Too narrow range

    // 5. Market status (10% weight)
    if (status === 'LIVE') {
      confidence += 8;
    } else if (status === 'CACHED') {
      confidence += 3;
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
        if (isFirstFetch.current) setLoading(true);
        setError(null);
        
        controller = new AbortController();
        const timeoutId = setTimeout(() => controller?.abort(), 15000);

        const response = await fetch(
          API_CONFIG.endpoint(`/api/analysis/analyze/${symbol}`),
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

            const orbData: ORBData = {
              symbol,
              status: result.status || 'LIVE',
              timestamp: result.timestamp || new Date().toISOString(),
              current_price,
              orb_high: result.indicators.orb_high || 0,
              orb_low: result.indicators.orb_low || 0,
              orb_range: result.indicators.orb_range || 0,
              orb_position: result.indicators.orb_position || 'INSIDE_RANGE',
              orb_strength: result.indicators.orb_strength || 0,
              orb_confidence: result.indicators.orb_confidence || 45,
              change,
              changePercent,
              distance_to_orb_high: result.indicators.distance_to_orb_high,
              distance_to_orb_low: result.indicators.distance_to_orb_low,
            };
            setData(orbData);
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          setError('Failed to load');
        }
      } finally {
        if (isFirstFetch.current) {
          setLoading(false);
          isFirstFetch.current = false;
        }
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000);

    return () => {
      clearInterval(interval);
      controller?.abort();
    };
  }, [symbol, timeframe]);

  const formatPrice = (price: number) => price?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (loading && !data) {
    return (
      <div className="border-2 border-emerald-500/20 rounded-xl p-4 bg-dark-card/50">
        <div className="flex items-center gap-2 text-xs text-dark-secondary">
          <Clock className="w-3 h-3 animate-spin" />
          <span>Loading ORB data...</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="border-2 border-red-500/20 rounded-xl p-4 bg-dark-card/50">
        <div className="text-xs text-red-400">Error loading ORB</div>
      </div>
    );
  }

  const signal = getORBSignal(data);
  const confidence = calculateORBConfidence(data);
  const marketStatus = data.status || 'CLOSED';

  const getSignalColor = (sig: string) => {
    if (sig === 'STRONG BUY') return 'text-emerald-400';
    if (sig === 'BUY') return 'text-emerald-300';
    if (sig === 'WAIT') return 'text-amber-300';
    if (sig === 'SELL') return 'text-rose-300';
    if (sig === 'STRONG SELL') return 'text-rose-400';
    return 'text-gray-300';
  };

  const getSignalBg = (sig: string) => {
    if (sig === 'STRONG BUY') return 'bg-emerald-500/20 border-emerald-500/40';
    if (sig === 'BUY') return 'bg-emerald-500/15 border-emerald-500/30';
    if (sig === 'WAIT') return 'bg-amber-500/15 border-amber-500/30';
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
          <span className="text-[10px] text-dark-tertiary">{timeframe}</span>
        </div>
      </div>

      {/* Signal Display */}
      <div className={`border-2 ${getSignalBg(signal)} rounded-lg p-3 mb-3`}>
        <div className="flex items-center gap-3">
          <div className={getSignalColor(signal)}>{getSignalIcon(signal)}</div>
          <div className="flex-1">
            <div className={`text-2xl font-black ${getSignalColor(signal)}`}>{signal}</div>
            <div className="text-xs text-dark-secondary mt-0.5">
              {signal === 'STRONG BUY' && 'Strong breakout above ORB high'}
              {signal === 'BUY' && 'Price above ORB high'}
              {signal === 'WAIT' && 'Inside opening range'}
              {signal === 'SELL' && 'Price below ORB low'}
              {signal === 'STRONG SELL' && 'Strong breakdown below ORB low'}
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

      {/* ORB Levels */}
      <div className="grid grid-cols-2 gap-2 mb-2.5">
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-2">
          <div className="text-[10px] text-emerald-400/80 font-semibold">ORB HIGH</div>
          <div className="text-sm font-black text-emerald-300">₹{formatPrice(data.orb_high)}</div>
          {data.distance_to_orb_high !== undefined && (
            <div className="text-[9px] text-emerald-400/70 mt-0.5">
              {data.current_price > data.orb_high ? '+' : ''}
              ₹{data.distance_to_orb_high.toFixed(2)}
            </div>
          )}
        </div>
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-2">
          <div className="text-[10px] text-rose-400/80 font-semibold">ORB LOW</div>
          <div className="text-sm font-black text-rose-300">₹{formatPrice(data.orb_low)}</div>
          {data.distance_to_orb_low !== undefined && (
            <div className="text-[9px] text-rose-400/70 mt-0.5">
              {data.current_price < data.orb_low ? '-' : ''}
              ₹{data.distance_to_orb_low.toFixed(2)}
            </div>
          )}
        </div>
      </div>

      {/* ORB Range & Position */}
      <div className="bg-dark-surface/50 rounded-lg p-2">
        <div className="flex justify-between items-center text-xs">
          <span className="text-dark-secondary">Range Size</span>
          <span className="font-bold text-dark-text">₹{data.orb_range.toFixed(2)}</span>
        </div>
        <div className="flex justify-between items-center text-xs mt-1">
          <span className="text-dark-secondary">Position</span>
          <span className={`font-bold ${
            data.orb_position === 'ABOVE_HIGH' ? 'text-emerald-400' :
            data.orb_position === 'BELOW_LOW' ? 'text-rose-400' :
            'text-amber-400'
          }`}>
            {data.orb_position === 'ABOVE_HIGH' ? 'Above' :
             data.orb_position === 'BELOW_LOW' ? 'Below' :
             'Inside'}
          </span>
        </div>
      </div>
    </div>
  );
});

ORBCard.displayName = 'ORBCard';

export default ORBCard;
