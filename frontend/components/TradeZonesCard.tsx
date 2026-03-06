import React, { useMemo } from 'react';
import { useTradeZonesRealtime, useMemoizedTradeZoneAnalysis } from '@/hooks/useTradeZonesRealtime';

// ═══════════════════════════════════════════════════════════════════════════════
// 💰 TRADE ZONES CARD – BUY/SELL SIGNALS WITH SUPPORT/RESISTANCE
// ═══════════════════════════════════════════════════════════════════════════════
// Real-time zone detection and entry signal visualization
// Displays: Zone classification, EMA levels, distance to support, buy/sell signals
// Performance: <200ms updates, <50ms render latency
// ═══════════════════════════════════════════════════════════════════════════════

interface TradeZonesCardProps {
  symbol: string;
  price?: number;
  compact?: boolean;
}

export const TradeZonesCard: React.FC<TradeZonesCardProps> = ({ symbol, price, compact = false }) => {
  const { data, loading, error, flash, refetch } = useTradeZonesRealtime(symbol);
  const analysis = useMemoizedTradeZoneAnalysis(data);

  // Get color for zone classification
  const getZoneColor = (zone: string) => {
    switch (zone) {
      case 'BUY_ZONE':
        return { bg: 'bg-green-900/40', border: 'border-green-500', text: 'text-green-300', badge: 'bg-green-600' };
      case 'SELL_ZONE':
        return { bg: 'bg-red-900/40', border: 'border-red-500', text: 'text-red-300', badge: 'bg-red-600' };
      case 'SUPPORT':
        return { bg: 'bg-blue-900/40', border: 'border-blue-500', text: 'text-blue-300', badge: 'bg-blue-600' };
      case 'BUY_SETUP':
        return { bg: 'bg-yellow-900/40', border: 'border-yellow-500', text: 'text-yellow-300', badge: 'bg-yellow-600' };
      case 'PREMIUM_ZONE':
        return { bg: 'bg-purple-900/40', border: 'border-purple-500', text: 'text-purple-300', badge: 'bg-purple-600' };
      default:
        return { bg: 'bg-slate-800/40', border: 'border-slate-600', text: 'text-slate-300', badge: 'bg-slate-600' };
    }
  };

  const zoneColor = data ? getZoneColor(data.zone_classification) : getZoneColor('NEUTRAL');

  // Get signal color
  const getSignalColor = (signal: string) => {
    if (signal.includes('BUY')) return 'text-green-400';
    if (signal.includes('SELL')) return 'text-red-400';
    return 'text-slate-400';
  };

  // Get confidence color
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return 'bg-gradient-to-r from-green-600 to-green-500';
    if (confidence >= 65) return 'bg-gradient-to-r from-blue-600 to-blue-500';
    if (confidence >= 50) return 'bg-gradient-to-r from-yellow-600 to-yellow-500';
    return 'bg-gradient-to-r from-red-600 to-red-500';
  };

  // Calculate EMA positions on display
  const getEMADistance = (distance: number) => {
    // Clamp to display range
    return Math.max(5, Math.min(95, 50 + distance * 10));
  };

  if (loading && !data) {
    return (
      <div
        className={`${compact ? 'p-3' : 'p-4'} bg-slate-900/50 border border-slate-700 rounded-lg animate-pulse`}
      >
        <div className="h-4 bg-slate-700 rounded mb-2 w-full"></div>
        <div className="h-3 bg-slate-700 rounded w-3/4"></div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className={`${compact ? 'p-3' : 'p-4'} bg-red-900/30 border border-red-700 rounded-lg`}>
        <div className="text-sm font-medium text-red-400 mb-2">💰 Trade Zones Error</div>
        <div className="text-xs text-red-300 mb-3">{error}</div>
        <button
          onClick={refetch}
          className="text-xs bg-red-700 hover:bg-red-600 text-white px-2 py-1 rounded"
        >
          🔄 Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={`${compact ? 'p-3' : 'p-4'} bg-slate-900/50 border border-slate-700 rounded-lg`}>
        <div className="text-sm text-slate-400">No zone data</div>
      </div>
    );
  }

  return (
    <div
      className={`${compact ? 'p-3' : 'p-4'} bg-slate-900/50 border ${zoneColor.border} ${zoneColor.bg} rounded-lg transition-all duration-300 ${
        flash ? 'ring-2 ring-offset-1 ring-offset-slate-900 ' + zoneColor.border : ''
      }`}
    >
      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* HEADER: Symbol + Zone + Live Badge */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="text-sm font-bold text-white">{symbol}</div>
          <span className={`text-xs px-2 py-1 rounded ${zoneColor.badge} text-white font-medium`}>
            {data.zone_classification.replace(/_/g, ' ')}
          </span>
        </div>

        {/* Live/Cached Badge */}
        <span
          className={`text-xs px-2 py-1 rounded ${
            data.status === 'LIVE'
              ? 'bg-green-600/40 text-green-300 border border-green-500'
              : 'bg-slate-700/40 text-slate-300 border border-slate-600'
          }`}
        >
          {data.status === 'LIVE' ? '🟢 LIVE' : '⏱️ CACHED'}
        </span>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* PRICE + ZONE DESCRIPTION */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="mb-3">
        <div className="text-sm font-semibold text-white mb-1">₹{data.current_price.toFixed(2)}</div>
        <div className="text-xs text-slate-300 leading-snug">{data.zone_description}</div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* EMA LEVELS - SUPPORT/RESISTANCE ZONES */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="mb-3 p-2 bg-slate-800/50 rounded border border-slate-700">
        <div className="text-xs font-semibold text-slate-300 mb-2">📊 EMA Support/Resistance Levels</div>

        {/* EMA Display */}
        <div className="space-y-1 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">EMA-20 (Immediate)</span>
            <span className={`font-mono font-bold ${Math.abs(data.distance_to_ema20_pct) < 0.5 ? 'text-yellow-400' : 'text-slate-300'}`}>
              ₹{data.ema_20.toFixed(2)} ({data.distance_to_ema20_pct > 0 ? '+' : ''}{data.distance_to_ema20_pct.toFixed(2)}%)
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-slate-400">EMA-50 (Secondary)</span>
            <span className="font-mono text-slate-300">₹{data.ema_50.toFixed(2)} ({data.distance_to_ema50_pct > 0 ? '+' : ''}{data.distance_to_ema50_pct.toFixed(2)}%)</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-slate-400">EMA-100 (Major)</span>
            <span className="font-mono text-slate-300">₹{data.ema_100.toFixed(2)} ({data.distance_to_ema100_pct > 0 ? '+' : ''}{data.distance_to_ema100_pct.toFixed(2)}%)</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-slate-400">EMA-200 (Anchor)</span>
            <span className="font-mono text-slate-300">₹{data.ema_200.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* BUY SIGNAL */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="space-y-2 mb-3 p-2 bg-green-900/30 border border-green-700/50 rounded">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-green-300">Buy Signal</span>
          <span className={`font-mono font-bold ${getSignalColor(data.buy_signal)}`}>{data.buy_signal.replace(/_/g, ' ')}</span>
        </div>

        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">Confidence</span>
          <span className="font-mono font-bold text-white">{data.buy_confidence}%</span>
        </div>

        <div className="bg-slate-900/80 rounded-full h-1.5 overflow-hidden border border-slate-700">
          <div
            className="h-full bg-gradient-to-r from-green-600 to-green-500 transition-all duration-300"
            style={{ width: `${data.buy_confidence}%` }}
          ></div>
        </div>

        <div className="text-xs text-green-300">Buy Volume: {data.buy_volume_pct.toFixed(1)}%</div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* SELL SIGNAL */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="space-y-2 mb-3 p-2 bg-red-900/30 border border-red-700/50 rounded">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-red-300">Sell Signal</span>
          <span className={`font-mono font-bold ${getSignalColor(data.sell_signal)}`}>{data.sell_signal.replace(/_/g, ' ')}</span>
        </div>

        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">Confidence</span>
          <span className="font-mono font-bold text-white">{data.sell_confidence}%</span>
        </div>

        <div className="bg-slate-900/80 rounded-full h-1.5 overflow-hidden border border-slate-700">
          <div
            className="h-full bg-gradient-to-r from-red-600 to-red-500 transition-all duration-300"
            style={{ width: `${data.sell_confidence}%` }}
          ></div>
        </div>

        <div className="text-xs text-red-300">Sell Volume: {data.sell_volume_pct.toFixed(1)}%</div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* OVERALL SIGNAL + ENTRY QUALITY */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="space-y-2 mb-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">Overall Signal</span>
          <span className={`font-mono font-bold text-lg ${getSignalColor(data.overall_signal)}`}>
            {data.overall_signal.replace(/_/g, ' ')}
          </span>
        </div>

        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">Entry Quality</span>
          <span
            className={`font-semibold px-2 py-1 rounded ${
              data.entry_quality === 'PREMIUM'
                ? 'bg-green-600 text-white'
                : data.entry_quality === 'STANDARD'
                  ? 'bg-blue-600 text-white'
                  : data.entry_quality === 'ACCEPTABLE'
                    ? 'bg-yellow-600 text-white'
                    : 'bg-red-600 text-white'
            }`}
          >
            {data.entry_quality}
          </span>
        </div>

        <div className="text-xs text-slate-300 leading-snug">{data.entry_description}</div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* SIGNAL CONFIDENCE */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="space-y-1 mb-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">Signal Confidence</span>
          <span className="font-mono font-bold text-white">{data.signal_confidence}%</span>
        </div>

        <div className="bg-slate-900/80 rounded-full h-2 overflow-hidden border border-slate-700">
          <div
            className={`h-full transition-all duration-300 ${getConfidenceColor(data.signal_confidence)}`}
            style={{ width: `${data.signal_confidence}%` }}
          ></div>
        </div>

        <div className="text-xs text-right">
          <span
            className={`font-semibold ${
              data.signal_confidence >= 80
                ? 'text-green-400'
                : data.signal_confidence >= 65
                  ? 'text-blue-400'
                  : data.signal_confidence >= 50
                    ? 'text-yellow-400'
                    : 'text-red-400'
            }`}
          >
            {data.signal_confidence >= 80
              ? '✅ EXCELLENT'
              : data.signal_confidence >= 65
                ? '✓ STRONG'
                : data.signal_confidence >= 50
                  ? '△ MODERATE'
                  : '✗ WEAK'}
          </span>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* RISK/REWARD ANALYSIS */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="mb-3 p-2 bg-slate-800/50 rounded border border-slate-700">
        <div className="text-xs font-semibold text-slate-300 mb-2">💎 Risk/Reward Analysis</div>

        <div className="space-y-1 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Stop Loss</span>
            <span className="font-mono font-bold text-red-400">₹{data.stop_loss_price.toFixed(2)}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-slate-400">Upside Target</span>
            <span className="font-mono font-bold text-green-400">₹{data.target_upside.toFixed(2)}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-slate-400">Downside Target</span>
            <span className="font-mono font-bold text-yellow-400">₹{data.target_downside.toFixed(2)}</span>
          </div>

          <div className="flex items-center justify-between border-t border-slate-700 pt-1 mt-1">
            <span className="font-semibold text-slate-300">R:R Ratio</span>
            <span
              className={`font-mono font-bold text-lg ${data.risk_reward_ratio >= 1.5 ? 'text-green-400' : 'text-yellow-400'}`}
            >
              {data.risk_reward_ratio.toFixed(2)}:1
            </span>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* TREND + VOLUME */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="mb-3 space-y-1 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Trend</span>
          <span
            className={`font-semibold ${
              data.trend_structure === 'HIGHER_HIGHS_LOWS'
                ? 'text-green-400'
                : data.trend_structure === 'LOWER_HIGHS_LOWS'
                  ? 'text-red-400'
                  : 'text-yellow-400'
            }`}
          >
            {data.trend_structure.replace(/_/g, ' ')}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-slate-400">Volume</span>
          <span
            className={`font-semibold ${
              data.volume_strength === 'STRONG_VOLUME'
                ? 'text-green-400'
                : data.volume_strength === 'MODERATE_VOLUME'
                  ? 'text-yellow-400'
                  : 'text-red-400'
            }`}
          >
            {data.volume_strength.replace(/_/g, ' ')}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-slate-400">VWAP</span>
          <span className="font-mono">₹{data.vwap_price.toFixed(2)}</span>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* METADATA */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="mt-3 pt-2 border-t border-slate-700 flex items-center justify-between text-xs text-slate-500">
        <span>📊 {data.candles_analyzed} candles</span>
        <span>{new Date(data.timestamp).toLocaleTimeString()}</span>
      </div>
    </div>
  );
};

export default TradeZonesCard;
