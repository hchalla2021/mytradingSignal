'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AlertCircle, CheckCircle, TrendingUp, TrendingDown, Zap } from 'lucide-react';

/**
 * 🚀 BREAKOUT ALERT PANEL
 * Real-time breakout signal detection and probability display
 * 
 * Features:
 * - Bullish/bearish breakout signals
 * - Breakout probability scoring
 * - Entry, target, and stop loss prices
 * - Risk/reward ratio calculation
 * - Volume and confluence confirmation
 * - Real-time signal updates
 */

interface BreakoutSignal {
  signalType: 'BULLISH_BREAKOUT' | 'BEARISH_BREAKOUT' | 'NEUTRAL';
  confidence: number;
  probability: number;
  entryPrice: number;
  targetPrice: number;
  stopLossPrice: number;
  riskRewardRatio: number;
  volumeConfirmation: number;
  confluenceStrength: number;
  timestamp: string;
}

interface BreakoutAlertPanelProps {
  symbol: string;
}

export const BreakoutAlertPanel: React.FC<BreakoutAlertPanelProps> = ({ symbol }) => {
  const [signal, setSignal] = useState<BreakoutSignal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [alertHistory, setAlertHistory] = useState<BreakoutSignal[]>([]);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchSignal = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch(`/api/trend-base/breakout-signal/${symbol}`);
      if (!response.ok) throw new Error('Failed to fetch breakout signal');
      const data = await response.json();
      setSignal(data.breakoutSignal);

      // Add to history if new signal is different from previous
      if (signal && data.breakoutSignal.signalType !== signal.signalType) {
        setAlertHistory((prev) => [data.breakoutSignal, ...prev.slice(0, 9)]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [symbol, signal]);

  useEffect(() => {
    Promise.resolve(fetchSignal()).then(() => setLoading(false));
    refreshIntervalRef.current = setInterval(fetchSignal, 3000);

    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    };
  }, [symbol, fetchSignal]);

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-lg border border-slate-700 p-6 animate-pulse">
        <div className="h-80 bg-slate-700 rounded"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-700 rounded-lg p-6 flex items-center gap-3">
        <AlertCircle className="w-5 h-5 text-red-400" />
        <div>
          <h3 className="font-semibold text-red-400">Error</h3>
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!signal) {
    return <div className="text-center text-slate-400 py-8">No breakout signal available</div>;
  }

  const getSignalColor = (type: string) => {
    switch (type) {
      case 'BULLISH_BREAKOUT':
        return { bg: 'emerald-900/30', border: 'emerald-700', text: 'emerald-400' };
      case 'BEARISH_BREAKOUT':
        return { bg: 'red-900/30', border: 'red-700', text: 'red-400' };
      default:
        return { bg: 'slate-900/30', border: 'slate-700', text: 'slate-400' };
    }
  };

  const colors = getSignalColor(signal.signalType);

  const profitTarget = Math.abs(signal.targetPrice - signal.entryPrice);
  const riskAmount = Math.abs(signal.entryPrice - signal.stopLossPrice);
  const profitPercentage = (profitTarget / signal.entryPrice) * 100;
  const riskPercentage = (riskAmount / signal.entryPrice) * 100;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-white mb-1">Breakout Signals</h2>
        <p className="text-slate-400 text-sm">{symbol} • Institutional Breakout Detection</p>
      </div>

      {/* Main Signal Card */}
      <div
        className={`bg-gradient-to-br ${colors.bg} border border-${colors.border} rounded-lg p-8`}
      >
        {/* Signal Header */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-4">
            {signal.signalType === 'BULLISH_BREAKOUT' ? (
              <TrendingUp className="w-8 h-8 text-emerald-400" />
            ) : signal.signalType === 'BEARISH_BREAKOUT' ? (
              <TrendingDown className="w-8 h-8 text-red-400" />
            ) : (
              <AlertCircle className="w-8 h-8 text-slate-400" />
            )}
            <div>
              <h3 className={`text-2xl font-bold text-${colors.text}`}>
                {signal.signalType.replace(/_/g, ' ')}
              </h3>
              <p className="text-slate-400 text-sm mt-1">
                {new Date(signal.timestamp).toLocaleTimeString()}
              </p>
            </div>
          </div>

          {/* Confidence Badge */}
          <div className="text-right bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <p className="text-slate-400 text-xs uppercase tracking-wide mb-2">Confidence</p>
            <p className={`text-3xl font-bold text-${colors.text}`}>
              {(signal.confidence * 100).toFixed(0)}%
            </p>
          </div>
        </div>

        {/* Probability Gauge */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-3">
            <p className="text-slate-400 text-sm uppercase tracking-wide">Breakout Probability</p>
            <span className={`text-lg font-bold text-${colors.text}`}>
              {(signal.probability * 100).toFixed(0)}%
            </span>
          </div>
          <div className="w-full bg-slate-700 rounded-full h-3">
            <div
              className={`bg-gradient-to-r ${
                signal.signalType === 'BULLISH_BREAKOUT'
                  ? 'from-emerald-500 to-teal-400'
                  : signal.signalType === 'BEARISH_BREAKOUT'
                  ? 'from-red-500 to-pink-400'
                  : 'from-slate-500 to-slate-400'
              } h-3 rounded-full transition-all duration-300`}
              style={{ width: `${signal.probability * 100}%` }}
            />
          </div>
        </div>

        {/* Price Levels Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* Entry */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <p className="text-slate-400 text-xs uppercase tracking-wide mb-2">Entry Price</p>
            <p className="text-2xl font-bold text-white mb-1">
              {signal.entryPrice.toFixed(2)}
            </p>
            <p className="text-xs text-slate-500">Current Price</p>
          </div>

          {/* Target */}
          <div
            className={`bg-${colors.text === 'emerald-400' ? 'emerald' : 'red'}-900/30 border border-${colors.border} rounded-lg p-4`}
          >
            <p className={`text-${colors.text} text-xs uppercase tracking-wide mb-2`}>Target Price</p>
            <p className="text-2xl font-bold text-white mb-1">
              {signal.targetPrice.toFixed(2)}
            </p>
            <p className={`text-xs text-${colors.text}`}>
              +{profitPercentage.toFixed(2)}%
            </p>
          </div>

          {/* Stop Loss */}
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-4">
            <p className="text-red-400 text-xs uppercase tracking-wide mb-2">Stop Loss</p>
            <p className="text-2xl font-bold text-white mb-1">
              {signal.stopLossPrice.toFixed(2)}
            </p>
            <p className="text-xs text-red-400">
              -{riskPercentage.toFixed(2)}%
            </p>
          </div>
        </div>

        {/* Risk/Reward and Confirmation */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {/* Risk/Reward */}
          <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-4">
            <p className="text-slate-400 text-xs uppercase tracking-wide mb-2">Risk/Reward</p>
            <p className="text-2xl font-bold text-white mb-1">
              1:{signal.riskRewardRatio.toFixed(2)}
            </p>
            <p className="text-xs text-slate-400">Ratio</p>
          </div>

          {/* Volume Confirmation */}
          <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-4">
            <p className="text-slate-400 text-xs uppercase tracking-wide mb-2">Volume</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-slate-700 rounded-full h-2">
                <div
                  className="bg-cyan-500 h-2 rounded-full"
                  style={{ width: `${signal.volumeConfirmation * 100}%` }}
                />
              </div>
              <span className="text-white font-semibold text-sm">
                {(signal.volumeConfirmation * 100).toFixed(0)}%
              </span>
            </div>
          </div>

          {/* Confluence Strength */}
          <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-4">
            <p className="text-slate-400 text-xs uppercase tracking-wide mb-2">Confluence</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-slate-700 rounded-full h-2">
                <div
                  className="bg-purple-500 h-2 rounded-full"
                  style={{ width: `${signal.confluenceStrength * 100}%` }}
                />
              </div>
              <span className="text-white font-semibold text-sm">
                {(signal.confluenceStrength * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Signal Assessment Card */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
        <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-emerald-400" />
          Signal Assessment
        </h3>

        <div className="space-y-3">
          {/* Signal Quality */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <p className="text-slate-400 text-sm">Signal Quality</p>
              <span className={`font-semibold ${
                signal.confidence > 0.7
                  ? 'text-emerald-400'
                  : signal.confidence > 0.5
                  ? 'text-amber-400'
                  : 'text-red-400'
              }`}>
                {signal.confidence > 0.7
                  ? '✓ Strong'
                  : signal.confidence > 0.5
                  ? '⚠ Moderate'
                  : '⚠ Weak'}
              </span>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-2">
              <div
                className={`h-2 rounded-full ${
                  signal.confidence > 0.7
                    ? 'bg-emerald-500'
                    : signal.confidence > 0.5
                    ? 'bg-amber-500'
                    : 'bg-red-500'
                }`}
                style={{ width: `${signal.confidence * 100}%` }}
              />
            </div>
          </div>

          {/* Probability Assessment */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <p className="text-slate-400 text-sm">Success Probability</p>
              <span className={`font-semibold ${
                signal.probability > 0.6
                  ? 'text-emerald-400'
                  : signal.probability > 0.4
                  ? 'text-amber-400'
                  : 'text-red-400'
              }`}>
                {signal.probability > 0.6
                  ? 'High'
                  : signal.probability > 0.4
                  ? 'Medium'
                  : 'Low'}
              </span>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-2">
              <div
                className={`h-2 rounded-full ${
                  signal.probability > 0.6
                    ? 'bg-emerald-500'
                    : signal.probability > 0.4
                    ? 'bg-amber-500'
                    : 'bg-red-500'
                }`}
                style={{ width: `${signal.probability * 100}%` }}
              />
            </div>
          </div>

          {/* Risk/Reward Assessment */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <p className="text-slate-400 text-sm">Risk/Reward Ratio</p>
              <span className={`font-semibold ${
                signal.riskRewardRatio > 2
                  ? 'text-emerald-400'
                  : signal.riskRewardRatio > 1
                  ? 'text-amber-400'
                  : 'text-red-400'
              }`}>
                {signal.riskRewardRatio > 2
                  ? 'Excellent'
                  : signal.riskRewardRatio > 1
                  ? 'Good'
                  : 'Poor'}
              </span>
            </div>
            <div className="text-xs text-slate-400 mt-1">
              For every 1 unit of risk, you can gain {signal.riskRewardRatio.toFixed(2)} units
            </div>
          </div>

          {/* Overall Signal Status */}
          <div className="pt-3 border-t border-slate-700 mt-3">
            <div className="flex items-center justify-between">
              <p className="text-slate-400 text-sm uppercase tracking-wide">Overall Signal Status</p>
              <div className={`flex items-center gap-2 px-4 py-2 rounded-lg bg-${colors.text === 'emerald-400' ? 'emerald' : colors.text === 'red-400' ? 'red' : 'slate'}-900/30 border border-${colors.border}`}>
                {signal.signalType !== 'NEUTRAL' ? (
                  <>
                    <Zap className={`w-4 h-4 text-${colors.text}`} />
                    <span className={`font-semibold text-${colors.text}`}>Active Signal</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-4 h-4 text-slate-400" />
                    <span className="font-semibold text-slate-400">No Active Signal</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Alert History */}
      {alertHistory.length > 0 && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
          <h3 className="text-white font-semibold mb-4">Recent Signals</h3>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {alertHistory.map((hist, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-lg border text-sm ${
                  hist.signalType === 'BULLISH_BREAKOUT'
                    ? 'bg-emerald-900/20 border-emerald-700'
                    : hist.signalType === 'BEARISH_BREAKOUT'
                    ? 'bg-red-900/20 border-red-700'
                    : 'bg-slate-700/30 border-slate-600'
                }`}
              >
                <div className="flex justify-between items-center">
                  <span className={`font-semibold ${
                    hist.signalType === 'BULLISH_BREAKOUT'
                      ? 'text-emerald-400'
                      : hist.signalType === 'BEARISH_BREAKOUT'
                      ? 'text-red-400'
                      : 'text-slate-400'
                  }`}>
                    {hist.signalType.replace(/_/g, ' ')}
                  </span>
                  <span className="text-slate-400 text-xs">
                    {new Date(hist.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default BreakoutAlertPanel;
