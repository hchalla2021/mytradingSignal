import React, { useMemo } from 'react';
import { useHighVolumeCandleRealtime, useMemoizedHighVolumeAnalysis } from '@/hooks/useHighVolumeCandleRealtime';

// ═══════════════════════════════════════════════════════════════════════════════
// 🚀 HIGH VOLUME CANDLE SCANNER CARD
// ═══════════════════════════════════════════════════════════════════════════════
// Real-time volume spike detection and visualization
// Displays: Volume levels, spike magnitude, signal type, confidence score
// Performance: <200ms updates, <50ms render latency
// ═══════════════════════════════════════════════════════════════════════════════

interface HighVolumeCandleCardProps {
  symbol: string;
  price?: number;
  compact?: boolean;
}

export const HighVolumeCandleCard: React.FC<HighVolumeCandleCardProps> = ({
  symbol,
  price,
  compact = false,
}) => {
  const { data, loading, error, flash, refetch } = useHighVolumeCandleRealtime(symbol);
  const analysis = useMemoizedHighVolumeAnalysis(data);

  // Color scheme for signals
  const getSignalColor = (signal: string) => {
    switch (signal) {
      case 'CLIMAX_VOLUME':
        return { bg: 'bg-red-900/40', border: 'border-red-500', text: 'text-red-300', badge: 'bg-red-600' };
      case 'VOLUME_SPIKE':
        return { bg: 'bg-orange-900/40', border: 'border-orange-500', text: 'text-orange-300', badge: 'bg-orange-600' };
      case 'ABSORPTION':
        return { bg: 'bg-yellow-900/40', border: 'border-yellow-500', text: 'text-yellow-300', badge: 'bg-yellow-600' };
      default:
        return { bg: 'bg-slate-800/40', border: 'border-slate-600', text: 'text-slate-300', badge: 'bg-slate-600' };
    }
  };

  const signalColor = data ? getSignalColor(data.scanner_signal) : getSignalColor('NORMAL_VOLUME');

  // Volume strength indicator colors
  const getVolumeStrengthColor = (strength: string) => {
    switch (strength) {
      case 'STRONG_VOLUME':
        return 'text-green-400';
      case 'MODERATE_VOLUME':
        return 'text-yellow-400';
      case 'WEAK_VOLUME':
        return 'text-red-400';
      default:
        return 'text-slate-400';
    }
  };

  // Confidence bar color
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return 'bg-gradient-to-r from-green-600 to-green-500';
    if (confidence >= 65) return 'bg-gradient-to-r from-blue-600 to-blue-500';
    if (confidence >= 50) return 'bg-gradient-to-r from-yellow-600 to-yellow-500';
    return 'bg-gradient-to-r from-red-600 to-red-500';
  };

  // Format large numbers with commas and K/M suffix
  const formatVolume = (vol: number) => {
    if (vol >= 1000000) return (vol / 1000000).toFixed(1) + 'M';
    if (vol >= 1000) return (vol / 1000).toFixed(0) + 'K';
    return vol.toFixed(0);
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
        <div className="text-sm font-medium text-red-400 mb-2">📊 High Volume Scanner Error</div>
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
        <div className="text-sm text-slate-400">No volume data</div>
      </div>
    );
  }

  const volumeSpikePctAbs = Math.abs(data.volume_spike_pct);

  // Calculate visualization metrics
  const spikeMagnitude = Math.min(volumeSpikePctAbs / 100, 1); // Normalize to 0-1
  const spikeBarWidth = Math.max(10, Math.min(100, (volumeSpikePctAbs / 150) * 100)); // Clamp for display

  return (
    <div
      className={`${compact ? 'p-3' : 'p-4'} bg-slate-900/50 border ${signalColor.border} ${signalColor.bg} rounded-lg transition-all duration-300 ${
        flash ? 'ring-2 ring-offset-1 ring-offset-slate-900 ' + signalColor.border : ''
      }`}
    >
      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* HEADER: Symbol + Price + Live Badge */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="text-sm font-bold text-white">{symbol}</div>
          <span className={`text-xs px-2 py-1 rounded ${signalColor.badge} text-white font-medium`}>
            {data.scanner_signal.replace(/_/g, ' ')}
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
      {/* VOLUME METRICS */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="space-y-2 mb-3">
        {/* Current Price + Volume */}
        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-400">Price</div>
          <div className="font-mono text-sm font-semibold text-white">₹{data.current_price.toFixed(2)}</div>
        </div>

        {/* Volume Comparison */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Volume</span>
            <span className="font-mono text-white font-semibold">
              {formatVolume(data.current_volume)} / Avg: {formatVolume(data.avg_volume)}
            </span>
          </div>

          {/* Volume Ratio Bar */}
          <div className="bg-slate-900/80 rounded-full h-1.5 overflow-hidden border border-slate-700">
            <div
              className="h-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all duration-300"
              style={{ width: `${Math.min(data.volume_ratio * 20, 100)}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* SPIKE VISUALIZATION */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="space-y-2 mb-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">Volume Spike</span>
          <span className={`font-mono font-bold ${data.volume_spike_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {data.volume_spike_pct >= 0 ? '+' : ''}{data.volume_spike_pct.toFixed(1)}%
          </span>
        </div>

        {/* Spike Bar */}
        <div className="bg-slate-900/80 rounded-full h-2 overflow-hidden border border-slate-700">
          <div
            className={`h-full transition-all duration-300 ${
              data.volume_spike_pct >= 100
                ? 'bg-gradient-to-r from-red-600 to-red-500'
                : data.volume_spike_pct >= 50
                  ? 'bg-gradient-to-r from-orange-600 to-orange-500'
                  : data.volume_spike_pct >= 0
                    ? 'bg-gradient-to-r from-yellow-600 to-yellow-500'
                    : 'bg-gradient-to-r from-slate-600 to-slate-500'
            }`}
            style={{ width: `${spikeBarWidth}%` }}
          ></div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* VOLUME STRENGTH */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-slate-400">Strength</span>
        <span className={`text-xs font-bold ${getVolumeStrengthColor(data.volume_strength)}`}>
          {data.volume_strength.replace(/_/g, ' ')}
        </span>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* BUY/SELL VOLUME SPLIT */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="space-y-1 mb-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">Buy/Sell Volume</span>
          <span className="font-mono text-white">
            {data.buy_volume_pct.toFixed(0)}% / {data.sell_volume_pct.toFixed(0)}%
          </span>
        </div>

        {/* Buy/Sell Bar */}
        <div className="flex gap-1 h-1.5 rounded-full overflow-hidden bg-slate-900/80 border border-slate-700">
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
      {/* VOLUME TREND */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-slate-400">Volume Trend</span>
        <div className="flex items-center gap-1">
          <span className={`text-xs font-bold ${data.volume_trend === 'INCREASING' ? 'text-green-400' : 'text-red-400'}`}>
            {data.volume_trend === 'INCREASING' ? '📈' : '📉'} {data.volume_trend}
          </span>
          <span className={`text-xs font-mono ${data.volume_trend_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {data.volume_trend_pct >= 0 ? '+' : ''}{data.volume_trend_pct.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* ABSORPTION SIGNAL */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {data.is_absorption && (
        <div className="mb-3 p-2 bg-yellow-900/40 border border-yellow-600 rounded text-xs text-yellow-300">
          <div className="font-semibold">🛡️ Absorption Candle Detected</div>
          <div className="text-xs">Small body + high volume = Institutional consolidation</div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* SIGNAL DESCRIPTION */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="mb-3 p-2 bg-slate-800/50 rounded border border-slate-700">
        <div className="text-xs text-slate-300 leading-snug">{data.signal_description}</div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* CONFIDENCE SCORE */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">Confidence</span>
          <span className="font-mono font-bold text-white">{data.signal_confidence}%</span>
        </div>

        {/* Confidence Bar */}
        <div className="bg-slate-900/80 rounded-full h-2 overflow-hidden border border-slate-700">
          <div
            className={`h-full transition-all duration-300 ${getConfidenceColor(data.signal_confidence)}`}
            style={{ width: `${data.signal_confidence}%` }}
          ></div>
        </div>

        {/* Confidence Level Label */}
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
              ? '✅ VERY HIGH CONFIDENCE'
              : data.signal_confidence >= 65
                ? '✓ HIGH CONFIDENCE'
                : data.signal_confidence >= 50
                  ? '△ MEDIUM CONFIDENCE'
                  : '✗ LOW CONFIDENCE'}
          </span>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* METADATA */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="mt-3 pt-2 border-t border-slate-700 flex items-center justify-between text-xs text-slate-500">
        <span>📊 {data.candles_analyzed} candles analyzed</span>
        <span>{new Date(data.timestamp).toLocaleTimeString()}</span>
      </div>
    </div>
  );
};

export default HighVolumeCandleCard;
