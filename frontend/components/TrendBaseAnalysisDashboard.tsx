'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { TrendingUp, TrendingDown, Activity, AlertCircle, RefreshCw } from 'lucide-react';

/**
 * 📈 TREND BASE ANALYSIS DASHBOARD
 * Professional institutional-grade trend and structure analysis display
 * 
 * Features:
 * - Real-time trend detection (uptrend, downtrend, neutral)
 * - Higher highs/lows structure analysis
 * - Support and resistance levels
 * - Swing point visualization
 * - Pattern detection and display
 * - Mobile-first responsive design
 */

interface TrendData {
  trendType: 'UPTREND' | 'DOWNTREND' | 'NEUTRAL';
  strength: number;
  durationBars: number;
  startPrice: number;
  currentPrice: number;
  totalMove: number;
  movePercentage: number;
  higherHighsCount: number;
  higherLowsCount: number;
  lowerHighsCount: number;
  lowerLowsCount: number;
  supportLevels: number[];
  resistanceLevels: number[];
  breakoutProbability: number;
  reversalProbability: number;
  swingPoints: Array<{
    price: number;
    isHigh: boolean;
    strength: number;
    timestamp: string;
  }>;
}

interface SwingPoint {
  price: number;
  isHigh: boolean;
  strength: number;
  timestamp: string;
}

interface Pattern {
  patternType: string;
  confidence: number;
  description: string;
  nextTarget?: number;
  riskLevel?: number;
}

interface TrendBaseAnalysisDashboardProps {
  symbol: string;
}

export const TrendBaseAnalysisDashboard: React.FC<TrendBaseAnalysisDashboardProps> = ({ symbol }) => {
  const [trendData, setTrendData] = useState<TrendData | null>(null);
  const [swingPoints, setSwingPoints] = useState<SwingPoint[]>([]);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'trend' | 'structure' | 'swings' | 'patterns'>('trend');
  const [refreshing, setRefreshing] = useState(false);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchTrendData = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch(`/api/trend-base/current/${symbol}`);
      if (!response.ok) throw new Error('Failed to fetch trend data');
      const data = await response.json();
      setTrendData(data.trend);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [symbol]);

  const fetchSwingPoints = useCallback(async () => {
    try {
      const response = await fetch(`/api/trend-base/swing-points/${symbol}?limit=20`);
      if (!response.ok) throw new Error('Failed to fetch swing points');
      const data = await response.json();
      setSwingPoints(data.swingPoints);
    } catch (err) {
      console.error('Error fetching swing points:', err);
    }
  }, [symbol]);

  const fetchPatterns = useCallback(async () => {
    try {
      const response = await fetch(`/api/trend-base/patterns/${symbol}?limit=10`);
      if (!response.ok) throw new Error('Failed to fetch patterns');
      const data = await response.json();
      setPatterns(data.patterns);
    } catch (err) {
      console.error('Error fetching patterns:', err);
    }
  }, [symbol]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchTrendData(), fetchSwingPoints(), fetchPatterns()]);
    setRefreshing(false);
  };

  useEffect(() => {
    // Initial load
    Promise.all([fetchTrendData(), fetchSwingPoints(), fetchPatterns()])
      .then(() => setLoading(false));

    // Auto-refresh every 3 seconds
    refreshIntervalRef.current = setInterval(handleRefresh, 3000);

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [symbol, fetchTrendData, fetchSwingPoints, fetchPatterns]);

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-lg border border-slate-700 p-6 animate-pulse">
        <div className="h-64 bg-slate-700 rounded"></div>
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

  if (!trendData) {
    return (
      <div className="text-center text-slate-400 py-8">
        No trend data available
      </div>
    );
  }

  const getTrendColor = (type: string) => {
    switch (type) {
      case 'UPTREND': return 'emerald';
      case 'DOWNTREND': return 'red';
      default: return 'amber';
    }
  };

  const color = getTrendColor(trendData.trendType);
  const bgClass = `from-${color}-900/30 to-${color}-800/20`;
  const textClass = `text-${color}-400`;
  const borderClass = `border-${color}-700`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1">Trend Base Analysis</h2>
          <p className="text-slate-400 text-sm">{symbol} • Real-time Market Structure</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Trend Status Card */}
      <div className={`bg-gradient-to-br ${bgClass} border ${borderClass} rounded-lg p-6`}>
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              {trendData.trendType === 'UPTREND' ? (
                <TrendingUp className="w-6 h-6 text-emerald-400" />
              ) : trendData.trendType === 'DOWNTREND' ? (
                <TrendingDown className="w-6 h-6 text-red-400" />
              ) : (
                <Activity className="w-6 h-6 text-amber-400" />
              )}
              <h3 className={`text-2xl font-bold ${textClass}`}>
                {trendData.trendType}
              </h3>
            </div>
            <p className="text-slate-400 text-sm">Market Structure Status</p>
          </div>
          <div className="text-right">
            <div className={`text-3xl font-bold ${textClass} mb-1`}>
              {(trendData.strength * 100).toFixed(0)}%
            </div>
            <p className="text-slate-400 text-xs">Trend Strength</p>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
            <div className="text-2xl font-bold text-white mb-1">
              {trendData.movePercentage.toFixed(2)}%
            </div>
            <p className="text-slate-400 text-xs">Price Move</p>
          </div>

          <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
            <div className="text-2xl font-bold text-white mb-1">
              {trendData.durationBars}
            </div>
            <p className="text-slate-400 text-xs">Duration (Bars)</p>
          </div>

          <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
            <div className="text-2xl font-bold text-emerald-400 mb-1">
              {trendData.higherHighsCount}
            </div>
            <p className="text-slate-400 text-xs">Higher Highs</p>
          </div>

          <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
            <div className="text-2xl font-bold text-emerald-400 mb-1">
              {trendData.higherLowsCount}
            </div>
            <p className="text-slate-400 text-xs">Higher Lows</p>
          </div>
        </div>

        {/* Support/Resistance */}
        <div className="mt-6 grid grid-cols-2 gap-4">
          <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-600">
            <p className="text-slate-400 text-xs uppercase tracking-wide mb-3">Support Levels</p>
            <div className="space-y-1">
              {trendData.supportLevels.slice(0, 3).map((level, idx) => (
                <div key={idx} className="flex justify-between items-center">
                  <span className="text-slate-300 text-sm">S{idx + 1}</span>
                  <span className="text-white font-semibold">{level.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-600">
            <p className="text-slate-400 text-xs uppercase tracking-wide mb-3">Resistance Levels</p>
            <div className="space-y-1">
              {trendData.resistanceLevels.slice(0, 3).map((level, idx) => (
                <div key={idx} className="flex justify-between items-center">
                  <span className="text-slate-300 text-sm">R{idx + 1}</span>
                  <span className="text-white font-semibold">{level.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Probability Indicators */}
        <div className="mt-6 grid grid-cols-2 gap-4">
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-slate-400 text-sm">Breakout Probability</span>
              <span className="text-white font-semibold">{(trendData.breakoutProbability * 100).toFixed(0)}%</span>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-2">
              <div
                className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${trendData.breakoutProbability * 100}%` }}
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-slate-400 text-sm">Reversal Probability</span>
              <span className="text-white font-semibold">{(trendData.reversalProbability * 100).toFixed(0)}%</span>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-2">
              <div
                className="bg-red-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${trendData.reversalProbability * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-slate-700">
        {(['trend', 'structure', 'swings', 'patterns'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-3 font-medium text-sm uppercase tracking-wide transition border-b-2 ${
              activeTab === tab
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-300'
            }`}
          >
            {tab === 'trend' && 'Trend Analysis'}
            {tab === 'structure' && 'Structure'}
            {tab === 'swings' && 'Swing Points'}
            {tab === 'patterns' && 'Patterns'}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
        {activeTab === 'trend' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
                <p className="text-slate-400 text-xs uppercase tracking-wide mb-2">Trend Type</p>
                <p className={`text-lg font-bold ${textClass}`}>{trendData.trendType}</p>
              </div>
              <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
                <p className="text-slate-400 text-xs uppercase tracking-wide mb-2">Start Price</p>
                <p className="text-lg font-bold text-white">{trendData.startPrice.toFixed(2)}</p>
              </div>
              <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
                <p className="text-slate-400 text-xs uppercase tracking-wide mb-2">Current Price</p>
                <p className="text-lg font-bold text-white">{trendData.currentPrice.toFixed(2)}</p>
              </div>
              <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
                <p className="text-slate-400 text-xs uppercase tracking-wide mb-2">Total Move</p>
                <p className="text-lg font-bold text-white">{trendData.totalMove.toFixed(2)}</p>
              </div>
              <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
                <p className="text-slate-400 text-xs uppercase tracking-wide mb-2">Lower Highs</p>
                <p className="text-lg font-bold text-red-400">{trendData.lowerHighsCount}</p>
              </div>
              <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
                <p className="text-slate-400 text-xs uppercase tracking-wide mb-2">Lower Lows</p>
                <p className="text-lg font-bold text-red-400">{trendData.lowerLowsCount}</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'swings' && (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {swingPoints.length > 0 ? (
              swingPoints.map((swing, idx) => (
                <div key={idx} className="bg-slate-700/50 rounded-lg p-4 border border-slate-600 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      {swing.isHigh ? (
                        <TrendingUp className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <TrendingDown className="w-4 h-4 text-red-400" />
                      )}
                      <span className="text-white font-semibold">{swing.price.toFixed(2)}</span>
                      <span className="text-xs text-slate-400">
                        {swing.isHigh ? 'Swing High' : 'Swing Low'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">{new Date(swing.timestamp).toLocaleTimeString()}</p>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-2">
                      <div className="w-12 bg-slate-700 rounded-full h-2">
                        <div
                          className={`${swing.isHigh ? 'bg-emerald-500' : 'bg-red-500'} h-2 rounded-full`}
                          style={{ width: `${swing.strength * 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-400">{(swing.strength * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-center text-slate-400 py-8">No swing points detected</p>
            )}
          </div>
        )}

        {activeTab === 'patterns' && (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {patterns.length > 0 ? (
              patterns.map((pattern, idx) => (
                <div key={idx} className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h4 className="text-white font-semibold">{pattern.patternType}</h4>
                      <p className="text-slate-400 text-sm mt-1">{pattern.description}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-emerald-400">
                        {(pattern.confidence * 100).toFixed(0)}%
                      </div>
                      <p className="text-xs text-slate-400">Confidence</p>
                    </div>
                  </div>
                  {(pattern.nextTarget || pattern.riskLevel) && (
                    <div className="flex gap-4 mt-3 pt-3 border-t border-slate-600">
                      {pattern.nextTarget && (
                        <div>
                          <p className="text-xs text-slate-400 uppercase tracking-wide">Target</p>
                          <p className="text-white font-semibold">{pattern.nextTarget.toFixed(2)}</p>
                        </div>
                      )}
                      {pattern.riskLevel && (
                        <div>
                          <p className="text-xs text-slate-400 uppercase tracking-wide">Risk</p>
                          <p className="text-red-400 font-semibold">{pattern.riskLevel.toFixed(2)}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <p className="text-center text-slate-400 py-8">No patterns detected</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TrendBaseAnalysisDashboard;
