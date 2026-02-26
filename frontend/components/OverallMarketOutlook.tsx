'use client';

import React, { useState, useEffect } from 'react';

interface SignalData {
  name: string;
  confidence: number;
  signal: 'BUY' | 'SELL' | 'NEUTRAL' | 'WAIT';
  status: string;
}

interface MarketOutlookData {
  timestamp: string;
  overall_signal: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
  overall_confidence: number;
  bullish_signals: number;
  bearish_signals: number;
  neutral_signals: number;
  signals: {
    trend_base: SignalData;
    volume_pulse: SignalData;
    candle_intent: SignalData;
    pivot_points: SignalData;
    orb: SignalData;
    supertrend: SignalData;
    parabolic_sar: SignalData;
    rsi_60_40: SignalData;
    camarilla: SignalData;
    vwma_20: SignalData;
    high_volume_scanner: SignalData;
    smart_money_flow: SignalData;
    trade_zones: SignalData;
    oi_momentum: SignalData;
  };
  trend_percentage: number;
}

const OverallMarketOutlook: React.FC<{ symbol: string }> = ({ symbol }) => {
  const [data, setData] = useState<MarketOutlookData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMarketOutlook = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
        const response = await fetch(
          `${apiUrl}/api/analysis/market-outlook/${symbol}`,
          { cache: 'no-store' }
        );

        if (!response.ok) throw new Error(`API error: ${response.status}`);

        const result = await response.json();
        setData(result);
        setError(null);
      } catch (err) {
        setError((err as Error).message);
        console.error('Market outlook fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchMarketOutlook();
    const interval = setInterval(fetchMarketOutlook, 5000); // Update every 5 seconds
    return () => clearInterval(interval);
  }, [symbol]);

  const getConfidenceColor = (confidence: number): string => {
    if (confidence >= 80) return 'from-emerald-600 to-emerald-700';
    if (confidence >= 60) return 'from-blue-600 to-blue-700';
    if (confidence >= 40) return 'from-amber-600 to-amber-700';
    return 'from-red-600 to-red-700';
  };

  const getSignalColor = (signal: string): string => {
    switch (signal) {
      case 'BUY':
        return 'text-emerald-400';
      case 'SELL':
        return 'text-red-400';
      case 'NEUTRAL':
        return 'text-amber-400';
      default:
        return 'text-gray-400';
    }
  };

  const getSignalBg = (signal: string): string => {
    switch (signal) {
      case 'BUY':
        return 'bg-emerald-500/10 border-emerald-500/30';
      case 'SELL':
        return 'bg-red-500/10 border-red-500/30';
      case 'NEUTRAL':
        return 'bg-amber-500/10 border-amber-500/30';
      default:
        return 'bg-gray-500/10 border-gray-500/30';
    }
  };

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-lg p-6 border border-slate-700">
        <div className="animate-pulse">
          <div className="h-8 bg-slate-700 rounded w-1/3 mb-4"></div>
          <div className="grid grid-cols-3 gap-4">
            {[...Array(14)].map((_, i) => (
              <div key={i} className="h-20 bg-slate-700 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-lg p-6 border border-red-500/50">
        <p className="text-red-400">Failed to load market outlook: {error}</p>
      </div>
    );
  }

  const signals = [
    { name: 'Trend Base', key: 'trend_base', icon: '📊' },
    { name: 'Volume Pulse', key: 'volume_pulse', icon: '📈' },
    { name: 'Candle Intent', key: 'candle_intent', icon: '🕯️' },
    { name: 'Pivot Points', key: 'pivot_points', icon: '🎯' },
    { name: 'ORB', key: 'orb', icon: '📍' },
    { name: 'SuperTrend', key: 'supertrend', icon: '🚀' },
    { name: 'Parabolic SAR', key: 'parabolic_sar', icon: '⛓️' },
    { name: 'RSI 60/40', key: 'rsi_60_40', icon: '⚙️' },
    { name: 'Camarilla', key: 'camarilla', icon: '🔒' },
    { name: 'VWMA 20', key: 'vwma_20', icon: '🔌' },
    { name: 'High Volume', key: 'high_volume_scanner', icon: '💪' },
    { name: 'Smart Money', key: 'smart_money_flow', icon: '💰' },
    { name: 'Trade Zones', key: 'trade_zones', icon: '⚡' },
    { name: 'OI Momentum', key: 'oi_momentum', icon: '🔥' },
  ];

  return (
    <div className="space-y-6">
      {/* Main Overview Card */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-lg p-8 border border-slate-700 shadow-2xl">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Overall Signal */}
          <div className="flex flex-col items-center justify-center">
            <div className="text-sm text-gray-400 mb-2">OVERALL MARKET OUTLOOK</div>
            <div
              className={`text-4xl font-bold ${
                data.overall_signal === 'STRONG_BUY'
                  ? 'text-emerald-400'
                  : data.overall_signal === 'BUY'
                    ? 'text-emerald-300'
                    : data.overall_signal === 'STRONG_SELL'
                      ? 'text-red-400'
                      : data.overall_signal === 'SELL'
                        ? 'text-red-300'
                        : 'text-amber-400'
              }`}
            >
              {data.overall_signal}
            </div>
            <div className={`text-2xl font-bold mt-3 bg-gradient-to-r ${getConfidenceColor(data.overall_confidence)} bg-clip-text text-transparent`}>
              {data.overall_confidence}%
            </div>
            <div className="text-xs text-gray-500 mt-2">{new Date(data.timestamp).toLocaleTimeString()}</div>
          </div>

          {/* Signal Distribution */}
          <div className="flex flex-col justify-center">
            <div className="text-sm text-gray-400 mb-4">SIGNAL DISTRIBUTION</div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-emerald-400 text-sm">🟢 Bullish</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 bg-slate-700 rounded-full h-2">
                    <div
                      className="bg-emerald-500 h-2 rounded-full"
                      style={{
                        width: `${(data.bullish_signals / 14) * 100}%`,
                      }}
                    ></div>
                  </div>
                  <span className="text-white font-bold w-8 text-right">{data.bullish_signals}/14</span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-amber-400 text-sm">🟡 Neutral</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 bg-slate-700 rounded-full h-2">
                    <div
                      className="bg-amber-500 h-2 rounded-full"
                      style={{
                        width: `${(data.neutral_signals / 14) * 100}%`,
                      }}
                    ></div>
                  </div>
                  <span className="text-white font-bold w-8 text-right">{data.neutral_signals}/14</span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-red-400 text-sm">🔴 Bearish</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 bg-slate-700 rounded-full h-2">
                    <div
                      className="bg-red-500 h-2 rounded-full"
                      style={{
                        width: `${(data.bearish_signals / 14) * 100}%`,
                      }}
                    ></div>
                  </div>
                  <span className="text-white font-bold w-8 text-right">{data.bearish_signals}/14</span>
                </div>
              </div>
            </div>
          </div>

          {/* Trend Percentage */}
          <div className="flex flex-col items-center justify-center">
            <div className="text-sm text-gray-400 mb-2">TREND STRENGTH</div>
            <div className="relative w-32 h-32">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 120 120">
                {/* Background circle */}
                <circle
                  cx="60"
                  cy="60"
                  r="54"
                  fill="none"
                  stroke="#334155"
                  strokeWidth="8"
                />

                {/* Progress circle */}
                <circle
                  cx="60"
                  cy="60"
                  r="54"
                  fill="none"
                  stroke={
                    data.trend_percentage > 0
                      ? '#10b981'
                      : data.trend_percentage < 0
                        ? '#ef4444'
                        : '#f59e0b'
                  }
                  strokeWidth="8"
                  strokeDasharray={`${Math.abs(data.trend_percentage) * 3.39} 339`}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-bold text-white">
                  {Math.abs(data.trend_percentage)}%
                </span>
                <span className="text-xs text-gray-400">
                  {data.trend_percentage > 0 ? '📈 UP' : data.trend_percentage < 0 ? '📉 DOWN' : '➡️ FLAT'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 14 Signal Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {signals.map((signal) => {
          const signalData = data.signals[signal.key as keyof MarketOutlookData['signals']];
          if (!signalData) return null;

          return (
            <div
              key={signal.key}
              className={`rounded-lg p-4 border transition-all duration-300 hover:shadow-lg ${getSignalBg(signalData.signal)}`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{signal.icon}</span>
                  <span className="text-sm font-semibold text-gray-300">{signal.name}</span>
                </div>
              </div>

              <div className="space-y-2">
                {/* Confidence bar */}
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs text-gray-400">Confidence</span>
                  <span className={`font-bold text-sm ${getSignalColor(signalData.signal)}`}>
                    {signalData.confidence}%
                  </span>
                </div>

                <div className="w-full bg-slate-700/50 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full bg-gradient-to-r ${getConfidenceColor(signalData.confidence)}`}
                    style={{ width: `${signalData.confidence}%` }}
                  ></div>
                </div>

                {/* Signal badge */}
                <div className="flex justify-center mt-3">
                  <span className={`text-xs font-bold px-2 py-1 rounded ${getSignalColor(signalData.signal)}`}>
                    {signalData.signal}
                  </span>
                </div>

                {/* Status */}
                <div className="text-xs text-gray-400 text-center mt-2 truncate">
                  {signalData.status}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer Info */}
      <div className="text-xs text-gray-500 text-center">
        14 Signals • All Sections Integrated • Live Updates Every 5 seconds
      </div>
    </div>
  );
};

export default OverallMarketOutlook;
