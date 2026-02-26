"use client";

import { useOIMomentumLive } from "@/hooks/useOIMomentumLive";
import { useMemo, useState, useEffect } from "react";

interface OIMomentumCardProps {
  symbol: string;
  name: string;
  livePrice?: number; // Live price from WebSocket market data
  marketStatus?: 'LIVE' | 'CLOSED' | 'OFFLINE' | 'PRE_OPEN' | 'FREEZE'; // Market status for confidence adjustment
}

// ✅ SIGNAL STYLING
const getSignalStyle = (signal: string) => {
  const sig = signal?.toUpperCase() || "NEUTRAL";
  
  switch (sig) {
    case "STRONG_BUY":
      return {
        bg: "bg-green-900/30",
        border: "border-green-500",
        text: "text-green-300",
        icon: "🚀",
        label: "STRONG BUY",
        pulse: "animate-pulse"
      };
    case "BUY":
      return {
        bg: "bg-emerald-900/25",
        border: "border-emerald-500",
        text: "text-emerald-300",
        icon: "📈",
        label: "BUY",
        pulse: ""
      };
    case "BULLISH":
      return {
        bg: "bg-emerald-900/25",
        border: "border-emerald-500",
        text: "text-emerald-300",
        icon: "📈",
        label: "BULLISH",
        pulse: ""
      };
    case "SELL":
      return {
        bg: "bg-red-900/25",
        border: "border-red-500",
        text: "text-red-300",
        icon: "📉",
        label: "SELL",
        pulse: ""
      };
    case "STRONG_SELL":
      return {
        bg: "bg-rose-900/30",
        border: "border-rose-500",
        text: "text-rose-300",
        icon: "🔻",
        label: "STRONG SELL",
        pulse: "animate-pulse"
      };
    case "BEARISH":
      return {
        bg: "bg-red-900/25",
        border: "border-red-500",
        text: "text-red-300",
        icon: "📉",
        label: "BEARISH",
        pulse: ""
      };
    case "NEUTRAL":
      return {
        bg: "bg-slate-700/20",
        border: "border-slate-600",
        text: "text-slate-400",
        icon: "⏸️",
        label: "NEUTRAL",
        pulse: ""
      };
    default:
      return {
        bg: "bg-gray-700/15",
        border: "border-gray-600",
        text: "text-gray-500",
        icon: "⚠️",
        label: sig || "NO SIGNAL",
        pulse: ""
      };
  }
};

const getConfidenceGradient = (confidence: number) => {
  if (confidence >= 85) return "from-green-600 to-emerald-600";
  if (confidence >= 70) return "from-emerald-600 to-teal-600";
  if (confidence >= 55) return "from-yellow-600 to-amber-600";
  if (confidence >= 40) return "from-orange-600 to-red-600";
  return "from-slate-600 to-stone-600";
};

export default function OIMomentumCard({ symbol, name, livePrice, marketStatus = 'OFFLINE' }: OIMomentumCardProps) {
  const { data, isLive } = useOIMomentumLive(symbol);
  const [prevPrice, setPrevPrice] = useState<number>(0);
  const [animatePrice, setAnimatePrice] = useState(false);

  // Use live price from WebSocket if available, otherwise use API price
  const displayPrice = livePrice ?? data?.current_price ?? 0;
  
  // 🔥 DYNAMIC CONFIDENCE: Adjust based on market status and signal strength
  const dynamicConfidence = useMemo(() => {
    if (!data) return 0;
    
    let baseConfidence = data.confidence || 50;
    
    // Boost confidence when market is LIVE
    if (marketStatus === 'LIVE') {
      // Strong signals get boosted more during live market
      if (baseConfidence >= 80) {
        baseConfidence = Math.min(98, baseConfidence + 8); // 88-98%
      } else if (baseConfidence >= 70) {
        baseConfidence = Math.min(95, baseConfidence + 5); // 75-95%
      } else if (baseConfidence >= 60) {
        baseConfidence = Math.min(90, baseConfidence + 3); // 63-90%
      }
    }
    // Reduce confidence when market is PRE_OPEN or FREEZE
    else if (marketStatus === 'PRE_OPEN' || marketStatus === 'FREEZE') {
      baseConfidence = Math.max(30, baseConfidence - 15); // 30-65%
    }
    // Reduce confidence significantly when CLOSED or OFFLINE
    else if (marketStatus === 'CLOSED' || marketStatus === 'OFFLINE') {
      baseConfidence = Math.max(20, baseConfidence - 25); // 20-50%
    }
    
    return Math.round(baseConfidence);
  }, [data, marketStatus]);

  // Track price changes for animation
  useEffect(() => {
    if (displayPrice && displayPrice !== prevPrice) {
      setAnimatePrice(true);
      setTimeout(() => setAnimatePrice(false), 800);
      setPrevPrice(displayPrice);
    }
  }, [displayPrice, prevPrice]);

  if (!data) {
    return (
      <div className="bg-slate-800/40 border border-slate-700 rounded-lg p-3 animate-pulse">
        <div className="h-20 bg-slate-700/20 rounded" />
      </div>
    );
  }

  const style = getSignalStyle(data.final_signal);
  const confidence = dynamicConfidence;
  
  const metrics = data.metrics || {};
  const reasons = data.reasons || [];

  return (
    <div className={`relative rounded-lg border-2 ${style.border} ${style.bg} p-3 pt-8 transition-all duration-300 overflow-hidden`}>
      {/* LIVE INDICATOR + Market Status */}
      <div className="absolute top-2 right-2 flex items-center gap-1.5">
        {isLive && marketStatus === 'LIVE' && (
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
            <span className="text-[10px] font-bold text-emerald-300">LIVE</span>
          </div>
        )}
        {marketStatus === 'LIVE' && (
          <span className="text-[9px] px-1.5 py-0.5 bg-emerald-600/40 border border-emerald-500/50 rounded-sm text-emerald-400 font-bold whitespace-nowrap">🔴 LIVE</span>
        )}
        {(marketStatus === 'PRE_OPEN' || marketStatus === 'FREEZE') && (
          <span className="text-[9px] px-1.5 py-0.5 bg-amber-600/40 border border-amber-500/50 rounded-sm text-amber-300 font-bold whitespace-nowrap">🟠 {marketStatus === 'FREEZE' ? 'FREEZE' : 'PRE-OPEN'}</span>
        )}
        {(marketStatus === 'CLOSED' || marketStatus === 'OFFLINE') && (
          <span className="text-[9px] px-1.5 py-0.5 bg-slate-600/40 border border-slate-500/50 rounded-sm text-slate-400 font-bold whitespace-nowrap">⚫ {marketStatus}</span>
        )}
      </div>

      {/* HEADER: Symbol + Price + Change */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl flex-shrink-0">{style.icon}</span>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white leading-tight truncate">{name}</h3>
            <p className="text-[10px] text-slate-400 font-medium">{symbol}</p>
          </div>
        </div>
        <div className={`text-right flex-shrink-0 transition-all duration-500 ${animatePrice ? 'scale-110' : 'scale-100'}`}>
          <div className="text-lg font-bold text-white">₹{displayPrice.toFixed(0)}</div>
          {livePrice && livePrice !== data?.current_price && (
            <div className="text-[9px] text-emerald-400 font-bold whitespace-nowrap">📡 Feed</div>
          )}
        </div>
      </div>

      {/* SIGNAL + CONFIDENCE */}
      <div className="mb-3 flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className={`text-xs font-bold uppercase tracking-wider ${style.text} mb-1`}>
            {style.label}
          </div>
          <div className="w-full bg-slate-900/50 rounded-full h-2 overflow-hidden border border-slate-700/50">
            <div
              className={`h-full rounded-full transition-all duration-1000 bg-gradient-to-r ${getConfidenceGradient(confidence)}`}
              style={{ width: `${confidence}%` }}
            />
          </div>
        </div>
        <div className={`flex-shrink-0 text-center px-2.5 py-1.5 rounded-md bg-slate-900/60 border border-slate-700/50 min-w-fit`}>
          <div className="text-[9px] text-slate-400 font-bold">CONF</div>
          <div className={`text-base font-bold ${style.text}`}>{confidence}%</div>
        </div>
      </div>

      {/* TIMEFRAME SIGNALS - Compact Grid */}
      <div className="mb-3 grid grid-cols-3 gap-1.5">
        {/* 5m Entry */}
        <div className="bg-slate-900/40 border border-slate-700/30 rounded-md p-2">
          <div className="text-[9px] font-bold text-slate-400 uppercase mb-1 whitespace-nowrap">5m Entry</div>
          <div className={`text-[11px] font-bold ${getSignalStyle(data.signal_5m).text} truncate`}>
            {getSignalStyle(data.signal_5m).icon} {getSignalStyle(data.signal_5m).label}
          </div>
        </div>

        {/* 15m Trend */}
        <div className="bg-slate-900/40 border border-slate-700/30 rounded-md p-2">
          <div className="text-[9px] font-bold text-slate-400 uppercase mb-1 whitespace-nowrap">15m Trend</div>
          <div className={`text-[11px] font-bold ${getSignalStyle(data.signal_15m).text} truncate`}>
            {getSignalStyle(data.signal_15m).icon} {getSignalStyle(data.signal_15m).label}
          </div>
        </div>

        {/* Final Signal */}
        <div className={`${style.bg} border ${style.border} rounded-md p-2`}>
          <div className="text-[9px] font-bold text-slate-300 uppercase mb-1 whitespace-nowrap">Final</div>
          <div className={`text-[11px] font-bold ${style.text} truncate`}>
            {style.label === "NO SIGNAL" ? "⏸️ Wait" : "✓ Active"}
          </div>
        </div>
      </div>

      {/* MARKET METRICS - Compact Boxes */}
      <div className="mb-3 grid grid-cols-4 gap-1">
        <MetricBox
          icon="💎"
          label="Liquidity"
          value={metrics.liquidity ? "✓" : "—"}
          active={!!metrics.liquidity}
        />
        <MetricBox
          icon="📈"
          label="OI Buildup"
          value={metrics.oi_buildup ? `${metrics.oi_buildup.toFixed(1)}%` : "0%"}
          active={!!(metrics.oi_buildup && metrics.oi_buildup > 1)}
        />
        <MetricBox
          icon="📊"
          label="Volume"
          value={metrics.volume_ratio ? `${metrics.volume_ratio.toFixed(1)}x` : "0x"}
          active={!!(metrics.volume_ratio && metrics.volume_ratio > 1)}
        />
        <MetricBox
          icon="🚀"
          label="Breakout"
          value={metrics.breakout ? "✓" : "—"}
          active={!!metrics.breakout}
        />
      </div>

      {/* KEY FACTORS - Scrollable List */}
      {reasons && reasons.length > 0 && (
        <div className="mb-3 bg-slate-900/30 border border-slate-700/30 rounded-md p-2">
          <div className="text-[9px] font-bold text-slate-400 uppercase mb-1.5 tracking-wide">Key Factors</div>
          <div className="space-y-1 max-h-20 overflow-y-auto text-[10px] text-slate-300 leading-relaxed">
            {reasons.slice(0, 4).map((reason, i) => (
              <div key={i} className="flex gap-1.5 items-start">
                <span className="text-slate-500 flex-shrink-0 mt-0.5">→</span>
                <span className="flex-1 break-words">{reason.length > 55 ? reason.substring(0, 52) + '...' : reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FOOTER: Timestamp + Status */}
      <div className="flex items-center justify-between text-[9px] text-slate-500 border-t border-slate-700/30 pt-2 mt-2">
        <div className="font-medium">
          {new Date(data.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
          })}
        </div>
        <div className={`font-bold ${isLive ? "text-emerald-400" : "text-slate-600"}`}>
          {isLive ? "🔴 Live" : "⏸ Cached"}
        </div>
      </div>
    </div>
  );
}

// ✅ METRIC BOX COMPONENT - Reusable metric display
function MetricBox({
  icon,
  label,
  value,
  active
}: {
  icon: string;
  label: string;
  value: string;
  active: boolean;
}) {
  return (
    <div
      className={`rounded-md border p-2 text-center transition-all duration-300 flex flex-col items-center justify-center min-h-[60px] ${
        active
          ? "bg-green-900/30 border-green-500/50"
          : "bg-slate-900/30 border-slate-700/30"
      }`}
    >
      <div className={`text-lg mb-0.5 ${active ? "text-green-300" : "text-slate-500"}`}>
        {icon}
      </div>
      <div className={`text-[8px] font-bold uppercase tracking-tight ${active ? "text-green-300" : "text-slate-500"}`}>
        {label}
      </div>
      <div className={`text-[10px] font-bold mt-0.5 ${active ? "text-green-200" : "text-slate-600"}`}>
        {value}
      </div>
    </div>
  );
}
