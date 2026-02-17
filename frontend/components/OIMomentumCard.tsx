"use client";

import { useEffect, useState } from "react";

interface OIMomentumData {
  signal_5m: string;
  signal_15m: string;
  final_signal: string;
  confidence: number;
  reasons: string[];
  metrics: {
    liquidity_grab_5m: boolean;
    liquidity_grab_15m: boolean;
    oi_buildup_5m: boolean;
    oi_buildup_15m: boolean;
    volume_spike_5m: boolean;
    volume_spike_15m: boolean;
    price_breakout_5m: boolean;
    price_breakout_15m: boolean;
    oi_change_pct_5m: number;
    oi_change_pct_15m: number;
    volume_ratio_5m: number;
    volume_ratio_15m: number;
  };
  symbol_name: string;
  current_price: number;
  timestamp: string;
}

interface OIMomentumCardProps {
  symbol: string;
  name: string;
}

export default function OIMomentumCard({ symbol, name }: OIMomentumCardProps) {
  const [data, setData] = useState<OIMomentumData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch OI Momentum data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
        const response = await fetch(`${apiUrl}/api/analysis/oi-momentum/${symbol}`);
        if (!response.ok) throw new Error("Failed to fetch OI momentum");
        const result = await response.json();
        
        // Always set data (even if NO_SIGNAL or ERROR - we want to show the card)
        setData(result);
        setError(null);
      } catch (err) {
        console.error(`Error fetching OI momentum for ${symbol}:`, err);
        // On fetch error, show a placeholder card
        setData({
          signal_5m: "NO_SIGNAL",
          signal_15m: "NO_SIGNAL",
          final_signal: "NO_SIGNAL",
          confidence: 0,
          reasons: ["Waiting for market data..."],
          metrics: {
            liquidity_grab_5m: false,
            liquidity_grab_15m: false,
            oi_buildup_5m: false,
            oi_buildup_15m: false,
            volume_spike_5m: false,
            volume_spike_15m: false,
            price_breakout_5m: false,
            price_breakout_15m: false,
            oi_change_pct_5m: 0,
            oi_change_pct_15m: 0,
            volume_ratio_5m: 0,
            volume_ratio_15m: 0
          },
          symbol_name: name,
          current_price: 0,
          timestamp: new Date().toISOString()
        });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    
    return () => clearInterval(interval);
  }, [symbol, name]);

  // Signal styling
  const getSignalStyle = (signal: string) => {
    switch (signal) {
      case "STRONG_BUY":
        return {
          bg: "bg-gradient-to-r from-green-500/20 to-emerald-500/20",
          border: "border-green-500/50",
          text: "text-green-400",
          icon: "🚀",
          label: "STRONG BUY"
        };
      case "BUY":
        return {
          bg: "bg-gradient-to-r from-green-600/15 to-emerald-600/15",
          border: "border-green-600/40",
          text: "text-green-300",
          icon: "📈",
          label: "BUY"
        };
      case "SELL":
        return {
          bg: "bg-gradient-to-r from-red-600/15 to-rose-600/15",
          border: "border-red-600/40",
          text: "text-red-300",
          icon: "📉",
          label: "SELL"
        };
      case "STRONG_SELL":
        return {
          bg: "bg-gradient-to-r from-red-500/20 to-rose-500/20",
          border: "border-red-500/50",
          text: "text-red-400",
          icon: "🔻",
          label: "STRONG SELL"
        };
      case "NEUTRAL":
        return {
          bg: "bg-gradient-to-r from-slate-600/15 to-slate-700/15",
          border: "border-slate-600/40",
          text: "text-slate-300",
          icon: "⏸️",
          label: "NEUTRAL"
        };
      default:
        return {
          bg: "bg-gradient-to-r from-gray-600/10 to-gray-700/10",
          border: "border-gray-600/30",
          text: "text-gray-400",
          icon: "⚠️",
          label: "NO SIGNAL"
        };
    }
  };

  // Confidence color with more granular levels
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 85) return "text-green-400 font-extrabold";
    if (confidence >= 70) return "text-emerald-400 font-bold";
    if (confidence >= 55) return "text-yellow-400 font-bold";
    if (confidence >= 40) return "text-orange-400 font-semibold";
    if (confidence >= 25) return "text-red-400 font-semibold";
    return "text-gray-400 font-normal";
  };

  // Confidence background gradient
  const getConfidenceGradient = (confidence: number) => {
    if (confidence >= 85) return "from-green-500/30 to-emerald-500/30";
    if (confidence >= 70) return "from-emerald-500/25 to-green-500/25";
    if (confidence >= 55) return "from-yellow-500/25 to-amber-500/25";
    if (confidence >= 40) return "from-orange-500/25 to-yellow-500/25";
    if (confidence >= 25) return "from-red-500/20 to-orange-500/20";
    return "from-slate-600/15 to-slate-700/15";
  };

  // Confidence label
  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 85) return "VERY HIGH";
    if (confidence >= 70) return "HIGH";
    if (confidence >= 55) return "MODERATE";
    if (confidence >= 40) return "LOW";
    if (confidence >= 25) return "VERY LOW";
    return "NO CONFIDENCE";
  };

  // Don't show loading spinner or error messages - just hide until data is ready
  if (!data) return null;

  const style = getSignalStyle(data.final_signal);

  return (
    <div className={`${style.bg} rounded-xl border-2 ${style.border} p-4 transition-all duration-300 hover:shadow-lg`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">{style.icon}</span>
          <h3 className="font-bold text-white text-sm">{name}</h3>
        </div>
        <div className="text-xs text-slate-400">
          ₹{data.current_price?.toFixed(2) ?? '0.00'}
        </div>
      </div>

      {/* Signal Display */}
      <div className="mb-3">
        <div className="flex items-center justify-between gap-3">
          <div className={`text-2xl font-extrabold ${style.text} leading-tight`}>
            {style.label}
          </div>
          <div className={`flex-shrink-0 px-3 py-2 rounded-lg bg-gradient-to-br ${getConfidenceGradient(data.confidence)} border-2 ${data.confidence >= 70 ? 'border-emerald-500/40' : data.confidence >= 40 ? 'border-yellow-500/40' : 'border-slate-600/30'}`}>
            <div className="text-[9px] text-slate-300 uppercase tracking-wider mb-0.5 font-bold text-center">
              {getConfidenceLabel(data.confidence)}
            </div>
            <div className={`text-3xl ${getConfidenceColor(data.confidence)} text-center leading-none`}>
              {data.confidence}%
            </div>
          </div>
        </div>
      </div>

      {/* Confidence Progress Bar */}
      <div className="mb-3">
        <div className="w-full bg-slate-800/50 rounded-full h-2 overflow-hidden border border-slate-700/30">
          <div 
            className={`h-full rounded-full transition-all duration-500 ${
              data.confidence >= 70 
                ? 'bg-gradient-to-r from-emerald-500 to-green-500' 
                : data.confidence >= 40 
                ? 'bg-gradient-to-r from-yellow-500 to-amber-500'
                : 'bg-gradient-to-r from-red-500 to-orange-500'
            }`}
            style={{ width: `${data.confidence}%` }}
          ></div>
        </div>
      </div>

      {/* Timeframe Signals */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-slate-900/40 rounded-lg p-2 border border-slate-700/30">
          <div className="text-xs text-slate-400 mb-1">5m • Entry</div>
          <div className={`text-sm font-bold ${getSignalStyle(data.signal_5m).text}`}>
            {getSignalStyle(data.signal_5m).label}
          </div>
        </div>
        <div className="bg-slate-900/40 rounded-lg p-2 border border-slate-700/30">
          <div className="text-xs text-slate-400 mb-1">15m • Trend</div>
          <div className={`text-sm font-bold ${getSignalStyle(data.signal_15m).text}`}>
            {getSignalStyle(data.signal_15m).label}
          </div>
        </div>
      </div>

      {/* Reasons */}
      <div className="space-y-1.5">
        <div className="text-xs font-bold text-slate-300 mb-2 flex items-center justify-between">
          <span>Key Factors:</span>
          <span className="text-[9px] text-slate-500">Live Analysis</span>
        </div>
        {data.reasons.map((reason, idx) => (
          <div key={idx} className={`text-[11px] flex items-start gap-1.5 ${
            idx === 0 
              ? 'bg-slate-800/60 rounded-md p-1.5 border border-slate-700/40 text-slate-300 font-semibold' 
              : 'text-slate-400'
          }`}>
            {idx === 0 ? (
              <span className="text-emerald-400 text-xs">⚡</span>
            ) : (
              <span className={`text-xs ${
                reason.includes('💎') || reason.includes('📈') || reason.includes('📊') || reason.includes('🚀')
                  ? 'text-emerald-400'
                  : reason.includes('⚠️') || reason.includes('📉') || reason.includes('🔻')
                  ? 'text-red-400'
                  : 'text-slate-500'
              }`}>•</span>
            )}
            <span className="flex-1 leading-snug">{reason}</span>
          </div>
        ))}
      </div>

      {/* Metrics Summary - Enhanced with Tooltips */}
      <div className="mt-3 pt-3 border-t border-slate-700/30">
        <div className="text-[9px] text-slate-400 mb-2 text-center uppercase tracking-wider font-bold">
          Data Confirmation
        </div>
        <div className="grid grid-cols-4 gap-2">
          <div className={`text-center p-2 rounded-lg transition-all ${
            data.metrics.liquidity_grab_5m || data.metrics.liquidity_grab_15m 
              ? 'bg-green-500/20 border border-green-500/40 text-green-400' 
              : 'bg-slate-800/30 border border-slate-700/20 text-slate-600'
          }`}>
            <div className="text-base mb-0.5">💎</div>
            <div className="text-[9px] font-bold">Liquidity</div>
            {(data.metrics.liquidity_grab_5m || data.metrics.liquidity_grab_15m) && (
              <div className="text-[8px] text-green-300 mt-0.5">✓ Active</div>
            )}
          </div>
          <div className={`text-center p-2 rounded-lg transition-all ${
            data.metrics.oi_buildup_5m || data.metrics.oi_buildup_15m 
              ? 'bg-green-500/20 border border-green-500/40 text-green-400' 
              : 'bg-slate-800/30 border border-slate-700/20 text-slate-600'
          }`}>
            <div className="text-base mb-0.5">📈</div>
            <div className="text-[9px] font-bold">OI Build</div>
            {(data.metrics.oi_buildup_5m || data.metrics.oi_buildup_15m) && (
              <div className="text-[8px] text-green-300 mt-0.5">
                +{Math.max(data.metrics.oi_change_pct_5m ?? 0, data.metrics.oi_change_pct_15m ?? 0).toFixed(1)}%
              </div>
            )}
          </div>
          <div className={`text-center p-2 rounded-lg transition-all ${
            data.metrics.volume_spike_5m || data.metrics.volume_spike_15m 
              ? 'bg-green-500/20 border border-green-500/40 text-green-400' 
              : 'bg-slate-800/30 border border-slate-700/20 text-slate-600'
          }`}>
            <div className="text-base mb-0.5">📊</div>
            <div className="text-[9px] font-bold">Volume</div>
            {(data.metrics.volume_spike_5m || data.metrics.volume_spike_15m) && (
              <div className="text-[8px] text-green-300 mt-0.5">
                {Math.max(data.metrics.volume_ratio_5m ?? 0, data.metrics.volume_ratio_15m ?? 0).toFixed(1)}x
              </div>
            )}
          </div>
          <div className={`text-center p-2 rounded-lg transition-all ${
            data.metrics.price_breakout_5m || data.metrics.price_breakout_15m 
              ? 'bg-green-500/20 border border-green-500/40 text-green-400' 
              : 'bg-slate-800/30 border border-slate-700/20 text-slate-600'
          }`}>
            <div className="text-base mb-0.5">🚀</div>
            <div className="text-[9px] font-bold">Breakout</div>
            {(data.metrics.price_breakout_5m || data.metrics.price_breakout_15m) && (
              <div className="text-[8px] text-green-300 mt-0.5">✓ Confirmed</div>
            )}
          </div>
        </div>
      </div>

      {/* Timestamp */}
      <div className="mt-2 text-[9px] text-slate-500 text-center">
        Updated: {new Date(data.timestamp).toLocaleTimeString()}
      </div>
    </div>
  );
}
