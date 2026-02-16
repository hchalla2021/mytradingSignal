'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, Minus, Target, Layers } from 'lucide-react';

// Simplified interface for Camarilla R3/S3 + CPR data (layman perspective)
interface CamarillaCPRData {
  symbol: string;
  status: 'LIVE' | 'CACHED' | 'OFFLINE';
  current_price: number;
  camarilla_h3: number; // R3 - Strong resistance (top gate)
  camarilla_l3: number; // S3 - Strong support (bottom gate)
  camarilla_h4: number; // H4 - Extreme resistance
  camarilla_l4: number; // L4 - Extreme support
  camarilla_zone: 'ABOVE_TC' | 'BELOW_BC' | 'INSIDE_CPR' | 'NEUTRAL';
  camarilla_signal: string; // R3_BREAKOUT_CONFIRMED, S3_BREAKDOWN_CONFIRMED, etc.
  camarilla_confidence: number; // Backend confidence 30-95%
  cpr_width: number; // Distance between TC and BC
  cpr_width_pct: number; // CPR width as % of price
  cpr_classification: 'NARROW' | 'WIDE'; // Trending vs Range day
  change: number;
  changePercent: number;
}

interface CamarillaCPRCardProps {
  symbol: string;
  timeframe?: '5m' | '15m';
}

const CamarillaCPRCard: React.FC<CamarillaCPRCardProps> = ({ 
  symbol, 
  timeframe = '5m' 
}) => {
  const [data, setData] = useState<CamarillaCPRData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Convert Camarilla + CPR data to simple 5-level signal
   * STRONG BUY: R3 breakout confirmed + narrow CPR + above TC
   * BUY: Above CPR but below R3, or L3 support bounce
   * SIDEWAYS: Inside CPR chop zone or wide CPR
   * SELL: Below CPR but above S3, or H3 resistance rejection
   * STRONG SELL: S3 breakdown confirmed + narrow CPR + below BC
   */
  const getCamarillaCPRSignal = (data: CamarillaCPRData): string => {
    const signal = data.camarilla_signal || 'NEUTRAL';
    const zone = data.camarilla_zone || 'NEUTRAL';
    const cprType = data.cpr_classification || 'WIDE';
    const changePercent = data.changePercent || 0;
    const confidence = data.camarilla_confidence || 50;

    // STRONG BUY: R3 breakout confirmed (trend day bullish)
    if (signal === 'R3_BREAKOUT_CONFIRMED' && zone === 'ABOVE_TC' && cprType === 'NARROW' && confidence >= 75) {
      return 'STRONG BUY';
    }

    // STRONG SELL: S3 breakdown confirmed (trend day bearish)
    if (signal === 'S3_BREAKDOWN_CONFIRMED' && zone === 'BELOW_BC' && cprType === 'NARROW' && confidence >= 75) {
      return 'STRONG SELL';
    }

    // BUY: Above CPR territory or touching R3 (awaiting confirmation)
    if (zone === 'ABOVE_TC' || signal === 'ABOVE_CPR_HOLD' || signal === 'R3_BREAKOUT_TOUCH') {
      return 'BUY';
    }

    // SELL: Below CPR territory or touching S3 (awaiting confirmation)
    if (zone === 'BELOW_BC' || signal === 'BELOW_CPR_HOLD' || signal === 'S3_BREAKDOWN_TOUCH') {
      return 'SELL';
    }

    // SIDEWAYS: Inside CPR chop zone or wide CPR (range-bound)
    if (zone === 'INSIDE_CPR' || signal === 'CPR_CHOP_ZONE' || cprType === 'WIDE') {
      return 'SIDEWAYS';
    }

    // Default: Neutral
    return 'SIDEWAYS';
  };

  /**
   * Calculate confidence % for Camarilla/CPR signal (35-85% realistic range)
   * Factors:
   * 1. Signal strength (30%): Confirmed breakout vs touch vs hold
   * 2. Zone position (25%): Clear zone (ABOVE_TC/BELOW_BC) vs inside CPR
   * 3. CPR type (20%): Narrow (trending) vs Wide (range)
   * 4. Distance from gate (15%): Distance from R3/S3 levels
   * 5. Momentum alignment (10%): Price change direction matches position
   * 6. Market status (5%): LIVE vs CACHED vs OFFLINE
   */
  const calculateCamarillaCPRConfidence = (data: CamarillaCPRData): number => {
    let confidence = 40; // Base confidence

    // Factor 1: Signal strength (30% weight) - Key for Camarilla
    const signal = data.camarilla_signal || 'NEUTRAL';
    if (signal.includes('CONFIRMED')) {
      confidence += 12; // Strong confirmation = +12%
    } else if (signal.includes('BREAKOUT') || signal.includes('BREAKDOWN')) {
      confidence += 8; // Breakout/breakdown signal = +8%
    } else if (signal.includes('HOLD')) {
      confidence += 6; // Hold position = +6%
    } else if (signal.includes('CHOP')) {
      confidence += 2; // Chop zone = +2% (low confidence)
    } else {
      confidence += 3; // Other signals = +3%
    }

    // Factor 2: Zone position (25% weight)
    const zone = data.camarilla_zone || 'NEUTRAL';
    if (zone === 'ABOVE_TC' || zone === 'BELOW_BC') {
      confidence += 10; // Clear directional zone = +10%
    } else if (zone === 'INSIDE_CPR') {
      confidence += 3; // Inside CPR = +3% (low confidence, chop zone)
    } else {
      confidence += 5; // Neutral zone = +5%
    }

    // Factor 3: CPR type (20% weight) - Narrow CPR = trending day
    const cprType = data.cpr_classification || 'WIDE';
    if (cprType === 'NARROW') {
      confidence += 8; // Narrow CPR (trending day) = +8%
    } else {
      confidence += 3; // Wide CPR (range day) = +3%
    }

    // Factor 4: Distance from gate levels (15% weight)
    const price = data.current_price || 0;
    const h3 = data.camarilla_h3 || price;
    const l3 = data.camarilla_l3 || price;
    const distanceToH3 = Math.abs(price - h3);
    const distanceToL3 = Math.abs(price - l3);
    const minDistance = Math.min(distanceToH3, distanceToL3);
    const distancePct = price > 0 ? (minDistance / price) * 100 : 0;

    if (distancePct > 1.5) {
      confidence += 6; // Far from gate = +6% (clear zone)
    } else if (distancePct > 0.8) {
      confidence += 4; // Moderate distance = +4%
    } else if (distancePct > 0.3) {
      confidence += 2; // Near gate = +2%
    }
    // else: Too close to gate = no bonus (awaiting breakout)

    // Factor 5: Momentum alignment (10% weight)
    const changePercent = data.changePercent || 0;
    if ((zone === 'ABOVE_TC' && changePercent > 0.2) || (zone === 'BELOW_BC' && changePercent < -0.2)) {
      confidence += 4; // Momentum aligns with zone
    } else if ((zone === 'ABOVE_TC' && changePercent < -0.2) || (zone === 'BELOW_BC' && changePercent > 0.2)) {
      confidence -= 3; // Momentum diverges from zone
    }

    // Factor 6: Market status (5% weight)
    if (data.status === 'LIVE') {
      confidence += 2; // Live data = +2%
    } else if (data.status === 'CACHED') {
      confidence += 1; // Cached data = +1%
    }
    // OFFLINE = no bonus

    // Cap confidence at 35-85% (realistic range for Camarilla/CPR)
    return Math.max(35, Math.min(85, Math.round(confidence)));
  };

  const fetchCamarillaCPRData = useCallback(async () => {
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

      const camarillaData: CamarillaCPRData = {
        symbol: symbol,
        status: result.status || 'OFFLINE',
        current_price: currentPrice,
        camarilla_h3: parseFloat(indicators.camarilla_h3 || 0),
        camarilla_l3: parseFloat(indicators.camarilla_l3 || 0),
        camarilla_h4: parseFloat(indicators.camarilla_h4 || 0),
        camarilla_l4: parseFloat(indicators.camarilla_l4 || 0),
        camarilla_zone: indicators.camarilla_zone || 'NEUTRAL',
        camarilla_signal: indicators.camarilla_signal || 'NEUTRAL',
        camarilla_confidence: parseFloat(indicators.camarilla_confidence || 50),
        cpr_width: parseFloat(indicators.cpr_width || 0),
        cpr_width_pct: parseFloat(indicators.cpr_width_pct || 0),
        cpr_classification: indicators.cpr_classification || 'WIDE',
        change: change,
        changePercent: changePercent,
      };

      setData(camarillaData);
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
    fetchCamarillaCPRData();
    const interval = setInterval(fetchCamarillaCPRData, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, [fetchCamarillaCPRData]);

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
          <Target className="w-4 h-4 text-red-400" />
          <span className="text-sm font-bold text-red-300">{symbol}</span>
        </div>
        <div className="text-xs text-red-400 font-medium">
          {error || 'No data available'}
        </div>
        <button 
          onClick={fetchCamarillaCPRData}
          className="mt-2 text-xs text-red-300 hover:text-red-200 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  const signal = getCamarillaCPRSignal(data);
  const confidence = calculateCamarillaCPRConfidence(data);

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

  // Zone badge
  const zoneBadge = data.camarilla_zone === 'ABOVE_TC' ? '🟢 Above R3' :
                    data.camarilla_zone === 'BELOW_BC' ? '🔴 Below S3' :
                    data.camarilla_zone === 'INSIDE_CPR' ? '🟡 Inside CPR' : '⚪ Neutral';

  return (
    <div className={`bg-gradient-to-br ${config.bg} border-2 ${config.border} rounded-xl p-4 shadow-lg ${config.glow} transition-all duration-300 hover:scale-[1.02]`}>
      {/* Header: Symbol + Status */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-slate-400" />
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
          {/* Zone Badge */}
          <div className="text-xs text-slate-300 font-semibold mt-0.5">
            {zoneBadge}
          </div>
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

        {/* R3 (H3) Level */}
        <div className="flex items-center justify-between py-1.5 px-2 bg-slate-900/40 rounded-lg">
          <span className="text-xs text-slate-400">R3 (H3)</span>
          <div className="text-right">
            <div className="text-sm font-bold text-red-300">
              ₹{data.camarilla_h3.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-slate-500">Strong Resistance</div>
          </div>
        </div>

        {/* S3 (L3) Level */}
        <div className="flex items-center justify-between py-1.5 px-2 bg-slate-900/40 rounded-lg">
          <span className="text-xs text-slate-400">S3 (L3)</span>
          <div className="text-right">
            <div className="text-sm font-bold text-emerald-300">
              ₹{data.camarilla_l3.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-slate-500">Strong Support</div>
          </div>
        </div>

        {/* CPR Width + Type */}
        <div className="flex items-center justify-between py-1.5 px-2 bg-slate-900/40 rounded-lg">
          <span className="text-xs text-slate-400">CPR Width</span>
          <div className="text-right">
            <div className="text-xs font-semibold text-slate-300">
              ₹{data.cpr_width.toFixed(2)} ({data.cpr_width_pct.toFixed(2)}%)
            </div>
            <div className={`text-[10px] font-medium flex items-center justify-end gap-1 ${
              data.cpr_classification === 'NARROW' ? 'text-emerald-400' : 'text-orange-400'
            }`}>
              <Layers className="w-3 h-3" />
              {data.cpr_classification === 'NARROW' ? 'Trending Day' : 'Range Day'}
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

export default CamarillaCPRCard;
