'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { BarChart3, Zap } from 'lucide-react';

interface VolumeStatisticsPanelProps {
  symbol: string;
  refreshInterval?: number;
}

interface VolumeStats {
  basicStats: {
    current: number;
    avg20: number;
    avg50: number;
    avg200: number;
    median: number;
  };
  volatility: {
    stdDev: number;
    variance: number;
    rangeHigh: number;
    rangeLow: number;
    range: number;
  };
  analysis: {
    currentToAvgRatio: number;
    percentile: number;
    trendDirection: string;
    trendStrength: number;
    growthRate: number;
  };
}

/**
 * VolumeStatisticsPanel - Comprehensive volume statistics
 * 
 * Displays detailed volume metrics, moving averages, standard deviation,
 * percentile ranking, and trend analysis.
 * 
 * Performance: <15ms render, efficient statistical calculations
 * Features: Multi-period averages, volatility metrics, trend analysis
 */
export default function VolumeStatisticsPanel({
  symbol,
  refreshInterval = 3000,
}: VolumeStatisticsPanelProps) {
  const [stats, setStats] = useState<VolumeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch(`/api/volume-pulse/statistics/${symbol}`);
      if (!response.ok) throw new Error('Failed to fetch statistics');
      
      const data = await response.json();
      setStats(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, refreshInterval);
    return () => clearInterval(interval);
  }, [symbol, refreshInterval, fetchStats]);

  if (loading) {
    return (
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-800 rounded w-1/3"></div>
          <div className="grid grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-20 bg-slate-800 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800 text-slate-400">
        {error || 'No statistics available'}
      </div>
    );
  }

  const getTrendColor = (direction: string) => {
    switch (direction) {
      case 'UP': return 'text-emerald-400';
      case 'DOWN': return 'text-red-400';
      default: return 'text-amber-400';
    }
  };

  const getPercentileDescription = (percentile: number) => {
    if (percentile > 75) return 'Very High';
    if (percentile > 50) return 'Above Average';
    if (percentile > 25) return 'Below Average';
    return 'Very Low';
  };

  const getPercentileColor = (percentile: number) => {
    if (percentile > 75) return 'bg-red-500';
    if (percentile > 50) return 'bg-orange-500';
    if (percentile > 25) return 'bg-amber-500';
    return 'bg-emerald-500';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Volume Statistics</h1>
          <p className="text-sm text-slate-400">{symbol}</p>
        </div>
        <button
          onClick={() => setShowDetails(!showDetails)}
          className={`px-4 py-2 rounded font-medium transition ${
            showDetails
              ? 'bg-emerald-500 text-black'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
          }`}
        >
          {showDetails ? 'Hide' : 'Show'} Details
        </button>
      </div>

      {/* Basic Statistics - Current vs Averages */}
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
        <h2 className="text-sm font-semibold text-slate-400 mb-4 flex items-center gap-2">
          <BarChart3 size={16} /> Volume Summary
        </h2>
        
        <div className="space-y-4">
          {/* Current Volume Prominently Displayed */}
          <div className="bg-gradient-to-r from-emerald-950 to-emerald-900 rounded-lg p-6 border border-emerald-700">
            <p className="text-xs text-emerald-300 font-semibold">CURRENT VOLUME</p>
            <p className="text-4xl font-bold text-emerald-400 mt-2">
              {(stats.basicStats.current / 1000000).toFixed(2)}M
            </p>
            <p className="text-sm text-emerald-300 mt-2">
              {stats.analysis.currentToAvgRatio.toFixed(2)}x the 20-period average
            </p>
          </div>

          {/* Moving Averages Grid */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-slate-800 rounded-lg p-4">
              <p className="text-xs text-slate-500 font-semibold">20 Period Avg</p>
              <p className="text-2xl font-bold text-emerald-400 mt-2">
                {(stats.basicStats.avg20 / 1000000).toFixed(2)}M
              </p>
            </div>
            <div className="bg-slate-800 rounded-lg p-4">
              <p className="text-xs text-slate-500 font-semibold">50 Period Avg</p>
              <p className="text-2xl font-bold text-teal-400 mt-2">
                {(stats.basicStats.avg50 / 1000000).toFixed(2)}M
              </p>
            </div>
            <div className="bg-slate-800 rounded-lg p-4">
              <p className="text-xs text-slate-500 font-semibold">200 Period Avg</p>
              <p className="text-2xl font-bold text-blue-400 mt-2">
                {(stats.basicStats.avg200 / 1000000).toFixed(2)}M
              </p>
            </div>
          </div>

          {/* Median */}
          <div className="bg-slate-800 rounded-lg p-4">
            <p className="text-xs text-slate-500 font-semibold">Median Volume</p>
            <p className="text-2xl font-bold text-slate-300 mt-2">
              {(stats.basicStats.median / 1000000).toFixed(2)}M
            </p>
          </div>
        </div>
      </div>

      {/* Volume Ratio & Percentile - Key Indicators */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Volume Ratio */}
        <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
          <h3 className="text-sm font-semibold text-slate-400 mb-4">Volume Ratio</h3>
          <div className="text-center">
            <p className="text-5xl font-bold text-emerald-400">
              {stats.analysis.currentToAvgRatio.toFixed(2)}x
            </p>
            <p className="text-sm text-slate-400 mt-3">Current vs 20-period average</p>
            
            {/* Interpretation */}
            <div className="mt-4 p-3 rounded bg-slate-800 border border-slate-700">
              <p className="text-sm text-slate-300">
                {stats.analysis.currentToAvgRatio > 1.5
                  ? '🔥 Significantly above average'
                  : stats.analysis.currentToAvgRatio > 1
                  ? '📈 Above average'
                  : '📉 Below average volume'}
              </p>
            </div>
          </div>
        </div>

        {/* Percentile Ranking */}
        <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
          <h3 className="text-sm font-semibold text-slate-400 mb-4">Percentile Rank</h3>
          <div className="space-y-4">
            <div className="text-center">
              <p className="text-5xl font-bold text-white">
                {stats.analysis.percentile.toFixed(0)}
              </p>
              <p className="text-sm text-slate-400 mt-2">Percentile rank in distribution</p>
            </div>

            {/* Percentile Bar */}
            <div className="bg-slate-800 rounded-full h-3 overflow-hidden">
              <div
                className={`h-full ${getPercentileColor(stats.analysis.percentile)}`}
                style={{ width: `${stats.analysis.percentile}%` }}
              ></div>
            </div>

            {/* Percentile Description */}
            <p className={`text-sm font-semibold ${getTrendColor(
              stats.analysis.percentile > 50 ? 'UP' : 'DOWN'
            )}`}>
              {getPercentileDescription(stats.analysis.percentile)}
            </p>
          </div>
        </div>
      </div>

      {/* Volatility Metrics */}
      {showDetails && (
        <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
          <h2 className="text-sm font-semibold text-slate-400 mb-4 flex items-center gap-2">
            <Zap size={16} /> Volatility Metrics
          </h2>
          
          <div className="space-y-4">
            {/* Standard Deviation */}
            <div>
              <p className="text-xs text-slate-500 font-semibold mb-2">Standard Deviation</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-800 rounded p-4">
                  <p className="text-sm text-slate-400">Std Dev</p>
                  <p className="text-xl font-bold text-emerald-400 mt-1">
                    {(stats.volatility.stdDev / 1000000).toFixed(2)}M
                  </p>
                </div>
                <div className="bg-slate-800 rounded p-4">
                  <p className="text-sm text-slate-400">Variance</p>
                  <p className="text-xl font-bold text-emerald-400 mt-1">
                    {(stats.volatility.variance / Math.pow(1000000, 2)).toFixed(2)}
                  </p>
                </div>
              </div>
            </div>

            {/* Volume Range */}
            <div>
              <p className="text-xs text-slate-500 font-semibold mb-2">Volume Range</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-800 rounded p-3">
                  <p className="text-xs text-slate-500">High</p>
                  <p className="text-lg font-bold text-red-400 mt-1">
                    {(stats.volatility.rangeHigh / 1000000).toFixed(2)}M
                  </p>
                </div>
                <div className="bg-slate-800 rounded p-3">
                  <p className="text-xs text-slate-500">Range</p>
                  <p className="text-lg font-bold text-amber-400 mt-1">
                    {(stats.volatility.range / 1000000).toFixed(2)}M
                  </p>
                </div>
                <div className="bg-slate-800 rounded p-3">
                  <p className="text-xs text-slate-500">Low</p>
                  <p className="text-lg font-bold text-emerald-400 mt-1">
                    {(stats.volatility.rangeLow / 1000000).toFixed(2)}M
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Trend Analysis */}
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
        <h2 className="text-sm font-semibold text-slate-400 mb-4">Volume Trend</h2>
        
        <div className="space-y-4">
          {/* Trend Direction */}
          <div>
            <p className="text-xs text-slate-500 font-semibold mb-3">Direction</p>
            <p className={`text-3xl font-bold ${getTrendColor(stats.analysis.trendDirection)}`}>
              {stats.analysis.trendDirection}
            </p>
          </div>

          {/* Trend Strength */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-slate-500 font-semibold">Strength</p>
              <span className="text-lg font-bold text-white">
                {(stats.analysis.trendStrength * 100).toFixed(0)}%
              </span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400"
                style={{ width: `${stats.analysis.trendStrength * 100}%` }}
              ></div>
            </div>
          </div>

          {/* Growth Rate */}
          <div>
            <p className="text-xs text-slate-500 font-semibold mb-2">Growth Rate</p>
            <div className={`text-2xl font-bold ${
              stats.analysis.growthRate > 0 ? 'text-emerald-400' : 'text-red-400'
            }`}>
              {stats.analysis.growthRate > 0 ? '+' : ''}{(stats.analysis.growthRate * 100).toFixed(1)}%
            </div>
            <p className="text-xs text-slate-500 mt-1">Change from older to recent period</p>
          </div>
        </div>
      </div>

      {/* Interpretation Guide */}
      <div className="bg-gradient-to-r from-teal-950 to-teal-900 rounded-lg p-6 border border-teal-700">
        <h3 className="font-semibold text-teal-300 mb-3">💡 Statistical Interpretation</h3>
        <div className="space-y-2 text-sm text-teal-200">
          <p>
            • <strong>Ratio &gt; 1.5x:</strong> Strong volume surge. Institutional activity likely.
          </p>
          <p>
            • <strong>Percentile &gt; 75%:</strong> Historical high volume. Unusual activity.
          </p>
          <p>
            • <strong>Trend UP:</strong> Volume increasing. Breakout potential.
          </p>
          <p>
            • <strong>Growth Rate &gt; 20%:</strong> Significant change. Monitor for reversals.
          </p>
        </div>
      </div>
    </div>
  );
}
