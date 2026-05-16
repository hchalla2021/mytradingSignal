'use client';

import React, { useState, useEffect } from 'react';
import { Activity, Zap, TrendingUp, BarChart2 } from 'lucide-react';

interface PerformanceMetrics {
  totalTicksProcessed: number;
  avgProcessingLatencyMs: number;
  peakLatencyMs: number;
  minLatencyMs: number;
  throughputTicksPerSec: number;
  cacheHitRate: number;
  analysisQueueDepth: number;
}

interface VolumeProfile {
  levelCount: number;
  profiles: Array<{
    price: number;
    touches: number;
    totalVolume: number;
    orderCount: number;
    largeOrderCount: number;
  }>;
}

/**
 * 📊 ORDER FLOW METRICS PANEL
 * 
 * Real-time system performance and order flow metrics:
 * - Processing latency
 * - Throughput metrics
 * - Cache efficiency
 * - Volume profiles
 */
export function OrderFlowMetricsPanel({ symbol }: { symbol: string }) {
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [volumeProfile, setVolumeProfile] = useState<VolumeProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'performance' | 'volume'>('performance');

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [metricsRes, profileRes] = await Promise.all([
          fetch(`/api/smart-money/performance/${symbol}`),
          fetch(`/api/smart-money/volume-profile/${symbol}`)
        ]);

        if (metricsRes.ok) {
          const data = await metricsRes.json();
          setMetrics(data);
        }

        if (profileRes.ok) {
          const data = await profileRes.json();
          setVolumeProfile(data);
        }
      } catch (error) {
        console.error('Error fetching metrics:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, [symbol]);

  if (loading && !metrics) {
    return (
      <div className="bg-dark-card rounded-lg p-6 animate-pulse">
        <div className="h-40 bg-dark-surface rounded"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap size={18} className="text-blue-400" />
          <h3 className="font-bold text-white">Order Flow Metrics</h3>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('performance')}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              activeTab === 'performance'
                ? 'bg-blue-500/20 text-blue-400'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Performance
          </button>
          <button
            onClick={() => setActiveTab('volume')}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              activeTab === 'volume'
                ? 'bg-blue-500/20 text-blue-400'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Volume
          </button>
        </div>
      </div>

      {/* Performance Tab */}
      {activeTab === 'performance' && metrics && (
        <div className="bg-dark-card border border-white/10 rounded-lg p-6 space-y-4">
          {/* Latency Metrics */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Activity size={14} />
                Avg Latency
              </div>
              <div className="text-xl font-bold text-blue-400">
                {metrics.avgProcessingLatencyMs.toFixed(1)}ms
              </div>
              <div className="text-xs text-gray-500">
                Min: {metrics.minLatencyMs.toFixed(1)}ms
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <TrendingUp size={14} />
                Peak Latency
              </div>
              <div className="text-xl font-bold text-orange-400">
                {metrics.peakLatencyMs.toFixed(1)}ms
              </div>
              <div className="text-xs text-gray-500">
                Worst case spike
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Zap size={14} />
                Throughput
              </div>
              <div className="text-xl font-bold text-emerald-400">
                {metrics.throughputTicksPerSec.toFixed(0)}
              </div>
              <div className="text-xs text-gray-500">
                Ticks/second
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <BarChart2 size={14} />
                Cache Hit Rate
              </div>
              <div className={`text-xl font-bold ${
                metrics.cacheHitRate > 0.7 ? 'text-emerald-400' : 'text-amber-400'
              }`}>
                {(metrics.cacheHitRate * 100).toFixed(1)}%
              </div>
              <div className="text-xs text-gray-500">
                Cache efficiency
              </div>
            </div>
          </div>

          {/* Detailed Progress Bars */}
          <div className="pt-4 border-t border-white/10 space-y-3">
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-gray-400">Queue Depth</span>
                <span className="font-bold text-white">{metrics.analysisQueueDepth} ticks</span>
              </div>
              <div className="w-full bg-dark-surface rounded-full h-2">
                <div
                  className={`h-full rounded-full transition-all ${
                    metrics.analysisQueueDepth < 5 ? 'bg-emerald-500' :
                    metrics.analysisQueueDepth < 15 ? 'bg-amber-500' :
                    'bg-red-500'
                  }`}
                  style={{ width: `${Math.min(metrics.analysisQueueDepth / 30 * 100, 100)}%` }}
                ></div>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-gray-400">Total Ticks Processed</span>
                <span className="font-bold text-white">{metrics.totalTicksProcessed.toLocaleString()}</span>
              </div>
              <div className="text-xs text-gray-500">
                Processing capacity: {(metrics.totalTicksProcessed / 1000).toFixed(1)}K
              </div>
            </div>
          </div>

          {/* Health Status */}
          <div className="pt-4 border-t border-white/10">
            <h4 className="text-xs font-semibold text-gray-300 mb-2">System Health</h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className={`flex items-center gap-2 px-2 py-1 rounded ${
                metrics.avgProcessingLatencyMs < 50
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : 'bg-amber-500/10 text-amber-400'
              }`}>
                <div className="w-2 h-2 rounded-full bg-current"></div>
                Latency: {metrics.avgProcessingLatencyMs < 50 ? 'Optimal' : 'Monitor'}
              </div>
              <div className={`flex items-center gap-2 px-2 py-1 rounded ${
                metrics.cacheHitRate > 0.5
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : 'bg-amber-500/10 text-amber-400'
              }`}>
                <div className="w-2 h-2 rounded-full bg-current"></div>
                Cache: {metrics.cacheHitRate > 0.5 ? 'Efficient' : 'Improve'}
              </div>
              <div className={`flex items-center gap-2 px-2 py-1 rounded ${
                metrics.analysisQueueDepth < 10
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : 'bg-amber-500/10 text-amber-400'
              }`}>
                <div className="w-2 h-2 rounded-full bg-current"></div>
                Queue: {metrics.analysisQueueDepth < 10 ? 'Normal' : 'Backlog'}
              </div>
              <div className={`flex items-center gap-2 px-2 py-1 rounded ${
                metrics.throughputTicksPerSec > 100
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : 'bg-amber-500/10 text-amber-400'
              }`}>
                <div className="w-2 h-2 rounded-full bg-current"></div>
                Throughput: {metrics.throughputTicksPerSec > 100 ? 'High' : 'Normal'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Volume Profile Tab */}
      {activeTab === 'volume' && volumeProfile && (
        <div className="bg-dark-card border border-white/10 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between text-sm">
            <h4 className="font-semibold text-white">Volume Distribution</h4>
            <span className="text-xs text-gray-400">{volumeProfile.levelCount} levels</span>
          </div>

          <div className="space-y-2 max-h-72 overflow-y-auto">
            {volumeProfile.profiles.map((level, idx) => {
              const maxVolume = Math.max(...volumeProfile.profiles.map(p => p.totalVolume));
              const volumePercent = maxVolume > 0 ? (level.totalVolume / maxVolume) * 100 : 0;

              return (
                <div key={idx} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono text-white">₹{level.price.toFixed(2)}</span>
                    <span className="text-gray-400">
                      Vol: {(level.totalVolume / 1000).toFixed(0)}K | Orders: {level.orderCount}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1 bg-dark-surface rounded h-6 overflow-hidden relative">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-blue-400/60 transition-all"
                        style={{ width: `${volumePercent}%` }}
                      ></div>
                    </div>
                    {level.largeOrderCount > 0 && (
                      <div className="w-8 h-6 bg-red-500/20 rounded border border-red-500/40 flex items-center justify-center">
                        <span className="text-xs font-bold text-red-400">{level.largeOrderCount}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {volumeProfile.profiles.length === 0 && (
            <p className="text-gray-500 text-sm text-center py-8">No volume data available</p>
          )}
        </div>
      )}
    </div>
  );
}
