import React, { useMemo } from 'react';
import { useSmartMoneyFlowRealtime, useMemoizedSmartMoneyAnalysis } from '@/hooks/useSmartMoneyFlowRealtime';

// ═══════════════════════════════════════════════════════════════════════════════
// 🧠 SMART MONEY FLOW CARD – INSTITUTIONAL ORDER STRUCTURE INTELLIGENCE
// ═══════════════════════════════════════════════════════════════════════════════
// Real-time order flow imbalance and institutional positioning visualization
// Displays: Buy/Sell split, order flow patterns, absorption, VWAP alignment
// Performance: <200ms updates, <50ms render latency
// ═══════════════════════════════════════════════════════════════════════════════

interface SmartMoneyFlowCardProps {
  symbol: string;
  price?: number;
  compact?: boolean;
}

export const SmartMoneyFlowCard: React.FC<SmartMoneyFlowCardProps> = ({
  symbol,
  price,
  compact = false,
}) => {
  const { data, loading, error, flash, refetch } = useSmartMoneyFlowRealtime(symbol);
  const analysis = useMemoizedSmartMoneyAnalysis(data);

  // Color scheme for signals
  const getSignalColor = (signal: string) => {
    switch (signal) {
      case 'STRONG_BUY':
        return { bg: 'bg-green-900/40', border: 'border-green-500', text: 'text-green-300', badge: 'bg-green-600' };
      case 'BUY':
        return { bg: 'bg-blue-900/40', border: 'border-blue-500', text: 'text-blue-300', badge: 'bg-blue-600' };
      case 'SELL':
        return { bg: 'bg-orange-900/40', border: 'border-orange-500', text: 'text-orange-300', badge: 'bg-orange-600' };
      case 'STRONG_SELL':
        return { bg: 'bg-red-900/40', border: 'border-red-500', text: 'text-red-300', badge: 'bg-red-600' };
      default:
        return { bg: 'bg-slate-800/40', border: 'border-slate-600', text: 'text-slate-300', badge: 'bg-slate-600' };
    }
  };

  const signalColor = data ? getSignalColor(data.smart_money_signal) : getSignalColor('NEUTRAL');

  // Confidence bar color
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return 'bg-gradient-to-r from-green-600 to-green-500';
    if (confidence >= 65) return 'bg-gradient-to-r from-blue-600 to-blue-500';
    if (confidence >= 50) return 'bg-gradient-to-r from-yellow-600 to-yellow-500';
    return 'bg-gradient-to-r from-red-600 to-red-500';
  };

  // VWAP alignment color
  const getVwapColor = (position: string) => {
    switch (position) {
      case 'ABOVE_VWAP':
        return 'text-green-400';
      case 'BELOW_VWAP':
        return 'text-red-400';
      case 'AT_VWAP':
        return 'text-yellow-400';
      default:
        return 'text-slate-400';
    }
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
        <div className="text-sm font-medium text-red-400 mb-2">🧠 Smart Money Flow Error</div>
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
        <div className="text-sm text-slate-400">No order flow data</div>
      </div>
    );
  }

  return (
    <div
      className={`${compact ? 'p-3' : 'p-4'} bg-slate-900/50 border ${signalColor.border} ${signalColor.bg} rounded-lg transition-all duration-300 ${
        flash ? 'ring-2 ring-offset-1 ring-offset-slate-900 ' + signalColor.border : ''
      }`}
    >
      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* HEADER: Symbol + Signal + Status */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="text-sm font-bold text-white">{symbol}</div>
          <span className={`text-xs px-2 py-1 rounded ${signalColor.badge} text-white font-medium`}>
            {data.smart_money_signal.replace(/_/g, ' ')}
          </span>
        </div>

        {/* Live/Cached Badge */}
        <div className="flex items-center gap-1">
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
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* PRICE + VWAP ALIGNMENT */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="space-y-2 mb-3">
        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-400">Price</div>
          <div className="font-mono text-sm font-semibold text-white">₹{data.current_price.toFixed(2)}</div>
        </div>

        {/* VWAP Position */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">VWAP Status</span>
            <div className="flex items-center gap-2">
              <span className={`font-mono font-bold ${getVwapColor(data.vwap_position)}`}>
                {data.vwap_position === 'ABOVE_VWAP'
                  ? '📈 ABOVE VWAP'
                  : data.vwap_position === 'BELOW_VWAP'
                    ? '📉 BELOW VWAP'
                    : '🎯 AT VWAP'}
              </span>
              <span className="text-xs text-slate-400">
                (₹{data.vwap_value.toFixed(2)}, {data.vwap_deviation_pct.toFixed(2)}% away)
              </span>
            </div>
          </div>

          {/* VWAP Distance Bar */}
          <div className="bg-slate-900/80 rounded-full h-1.5 overflow-hidden border border-slate-700">
            <div
              className={`h-full transition-all duration-300 ${
                data.vwap_position === 'ABOVE_VWAP'
                  ? 'bg-gradient-to-r from-green-600 to-green-500'
                  : data.vwap_position === 'BELOW_VWAP'
                    ? 'bg-gradient-to-r from-red-600 to-red-500'
                    : 'bg-gradient-to-r from-yellow-600 to-yellow-500'
              }`}
              style={{ width: `${Math.min(data.vwap_deviation_pct * 5, 100)}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* ORDER FLOW ANALYSIS - BUY/SELL SPLIT */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="space-y-2 mb-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">Order Flow</span>
          <span className="font-mono font-bold text-white">
            BUY: {data.buy_volume_pct.toFixed(1)}% | SELL: {data.sell_volume_pct.toFixed(1)}%
          </span>
        </div>

        {/* Buy/Sell Bar */}
        <div className="flex gap-1 h-3 rounded-full overflow-hidden bg-slate-900/80 border border-slate-700">
          <div
            className="bg-gradient-to-r from-green-600 to-green-500"
            style={{ flex: `${data.buy_volume_pct}%` }}
          ></div>
          <div
            className="bg-gradient-to-r from-red-600 to-red-500"
            style={{ flex: `${data.sell_volume_pct}%` }}
          ></div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* ORDER FLOW IMBALANCE */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="space-y-2 mb-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">Flow Imbalance</span>
          <span className={`font-mono font-bold ${data.order_flow_imbalance > 25 ? 'text-orange-400' : data.order_flow_imbalance > 15 ? 'text-yellow-400' : 'text-slate-400'}`}>
            {data.order_flow_imbalance.toFixed(1)} (0-50)
          </span>
        </div>

        {/* Imbalance Bar */}
        <div className="bg-slate-900/80 rounded-full h-2 overflow-hidden border border-slate-700">
          <div
            className={`h-full transition-all duration-300 ${
              data.order_flow_imbalance > 30
                ? 'bg-gradient-to-r from-red-600 to-red-500'
                : data.order_flow_imbalance > 15
                  ? 'bg-gradient-to-r from-orange-600 to-orange-500'
                  : 'bg-gradient-to-r from-blue-600 to-blue-500'
            }`}
            style={{ width: `${(data.order_flow_imbalance / 50) * 100}%` }}
          ></div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* FLOW PATTERN CLASSIFICATION */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="mb-3 p-2 bg-slate-800/50 rounded border border-slate-700">
        <div className="text-xs font-semibold text-white mb-1">{data.flow_pattern.replace(/_/g, ' ')}</div>
        <div className="text-xs text-slate-300 leading-snug">{data.flow_description}</div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* INSTITUTIONAL POSITIONING - ABSORPTION */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="space-y-2 mb-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">Absorption Pattern</span>
          <span
            className={`font-mono font-bold ${
              data.absorption_strength > 75
                ? 'text-red-400'
                : data.absorption_strength > 50
                  ? 'text-yellow-400'
                  : 'text-slate-400'
            }`}
          >
            {data.absorption_pattern.replace(/_/g, ' ')} ({data.absorption_strength.toFixed(0)}%)
          </span>
        </div>

        {/* Absorption Bar */}
        <div className="bg-slate-900/80 rounded-full h-2 overflow-hidden border border-slate-700">
          <div
            className={`h-full transition-all duration-300 ${
              data.absorption_strength > 75
                ? 'bg-gradient-to-r from-red-600 to-red-500'
                : data.absorption_strength > 50
                  ? 'bg-gradient-to-r from-yellow-600 to-yellow-500'
                  : 'bg-gradient-to-r from-slate-600 to-slate-500'
            }`}
            style={{ width: `${data.absorption_strength}%` }}
          ></div>
        </div>

        <div className="text-xs text-slate-300 leading-snug">{data.absorption_description}</div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* STOP HUNTING / LIQUIDITY GRABS - WICK DOMINANCE */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="space-y-2 mb-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">Liquidity Pattern</span>
          <span
            className={`font-mono font-bold ${
              data.wick_dominance > 75
                ? 'text-red-400'
                : data.wick_dominance > 50
                  ? 'text-orange-400'
                  : 'text-green-400'
            }`}
          >
            {data.liquidity_pattern.replace(/_/g, ' ')} ({data.wick_dominance.toFixed(0)}%)
          </span>
        </div>

        {/* Wick Dominance Bar */}
        <div className="bg-slate-900/80 rounded-full h-2 overflow-hidden border border-slate-700">
          <div
            className={`h-full transition-all duration-300 ${
              data.wick_dominance > 75
                ? 'bg-gradient-to-r from-red-600 to-red-500'
                : data.wick_dominance > 50
                  ? 'bg-gradient-to-r from-orange-600 to-orange-500'
                  : 'bg-gradient-to-r from-green-600 to-green-500'
            }`}
            style={{ width: `${data.wick_dominance}%` }}
          ></div>
        </div>

        <div className="text-xs text-slate-300 leading-snug">{data.liquidity_description}</div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* ORDER STRUCTURE SETUP */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="mb-3 p-2 bg-purple-900/40 border border-purple-600 rounded">
        <div className="text-xs font-semibold text-purple-300 mb-1">🔄 {data.order_structure}</div>
        <div className="text-xs text-purple-200 leading-snug">{data.structure_description}</div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* SMART MONEY STRENGTH + CONFIDENCE */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="space-y-2 mb-3">
        {/* Smart Money Strength */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">Smart Money Strength</span>
          <span className="font-mono font-bold text-white">{data.smart_money_strength.toFixed(1)}%</span>
        </div>

        <div className="bg-slate-900/80 rounded-full h-2 overflow-hidden border border-slate-700">
          <div
            className="h-full bg-gradient-to-r from-purple-600 to-purple-500 transition-all duration-300"
            style={{ width: `${data.smart_money_strength}%` }}
          ></div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* CONFIDENCE SCORE */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">Signal Confidence</span>
          <span className="font-mono font-bold text-white">{data.smart_money_confidence}%</span>
        </div>

        {/* Confidence Bar */}
        <div className="bg-slate-900/80 rounded-full h-2 overflow-hidden border border-slate-700">
          <div
            className={`h-full transition-all duration-300 ${getConfidenceColor(data.smart_money_confidence)}`}
            style={{ width: `${data.smart_money_confidence}%` }}
          ></div>
        </div>

        {/* Confidence Level Label */}
        <div className="text-xs text-right">
          <span
            className={`font-semibold ${
              data.smart_money_confidence >= 80
                ? 'text-green-400'
                : data.smart_money_confidence >= 65
                  ? 'text-blue-400'
                  : data.smart_money_confidence >= 50
                    ? 'text-yellow-400'
                    : 'text-red-400'
            }`}
          >
            {data.smart_money_confidence >= 80
              ? '✅ EXCELLENT CONFIDENCE'
              : data.smart_money_confidence >= 65
                ? '✓ STRONG CONFIDENCE'
                : data.smart_money_confidence >= 50
                  ? '△ MODERATE CONFIDENCE'
                  : '✗ WEAK CONFIDENCE'}
          </span>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* VOLUME METRICS */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="mt-3 pt-2 border-t border-slate-700 space-y-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Volume</span>
          <span className="font-mono text-slate-300">
            {(data.current_volume / 1000).toFixed(0)}K / Avg: {(data.avg_volume / 1000).toFixed(0)}K (Ratio: {data.volume_ratio.toFixed(2)}x)
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-slate-400">Strength</span>
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

        <div className="flex items-center justify-between text-slate-500">
          <span>📊 {data.candles_analyzed} candles</span>
          <span>{new Date(data.timestamp).toLocaleTimeString()}</span>
        </div>
      </div>
    </div>
  );
};

export default SmartMoneyFlowCard;
