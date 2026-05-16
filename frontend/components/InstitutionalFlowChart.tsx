'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { BarChart3, TrendingUp, TrendingDown } from 'lucide-react';

interface ClusterData {
  centerPrice: number;
  totalVolume: number;
  intensity: number;
  direction: string;
  impactScore: number;
}

interface PositioningData {
  accumulatedBuyVolume: number;
  accumulatedSellVolume: number;
  netPosition: number;
  positionConfidence: number;
  accumulationZones: number[];
  distributionZones: number[];
}

/**
 * 📊 INSTITUTIONAL FLOW HEATMAP
 * 
 * Visual representation of:
 * - Order cluster intensity
 * - Buy/sell volume distribution
 * - Institutional positioning
 * - Market pressure zones
 */
export function InstitutionalFlowChart({ symbol }: { symbol: string }) {
  const [clusters, setClusters] = useState<ClusterData[]>([]);
  const [positioning, setPositioning] = useState<PositioningData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [clustersRes, positioningRes] = await Promise.all([
          fetch(`/api/smart-money/clusters/${symbol}?limit=15`),
          fetch(`/api/smart-money/positioning/${symbol}`)
        ]);

        if (clustersRes.ok) {
          const data = await clustersRes.json();
          setClusters(data.clusters || []);
        }

        if (positioningRes.ok) {
          const data = await positioningRes.json();
          setPositioning(data);
        }
      } catch (error) {
        console.error('Error fetching institutional flow data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [symbol]);

  // Calculate statistics
  const stats = useMemo(() => {
    if (!positioning) return null;

    const totalVolume = positioning.accumulatedBuyVolume + positioning.accumulatedSellVolume;
    const buyRatio = totalVolume > 0 ? positioning.accumulatedBuyVolume / totalVolume : 0.5;

    return {
      totalVolume,
      buyRatio,
      buyPercentage: buyRatio * 100,
      sellPercentage: (1 - buyRatio) * 100,
      netPosition: positioning.netPosition,
      confidence: positioning.positionConfidence
    };
  }, [positioning]);

  if (loading) {
    return (
      <div className="bg-dark-card rounded-lg p-6 animate-pulse">
        <div className="h-64 bg-dark-surface rounded"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <BarChart3 size={18} className="text-blue-400" />
        <h3 className="font-bold text-white">Institutional Flow Analysis</h3>
      </div>

      {/* Buy/Sell Ratio Display */}
      {stats && (
        <div className="bg-dark-card border border-white/10 rounded-lg p-6 space-y-4">
          {/* Ratio Bars */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <TrendingUp size={16} className="text-emerald-500" />
                <span className="text-gray-300">Institutional Buying</span>
              </div>
              <span className="font-bold text-emerald-400">{stats.buyPercentage.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-dark-surface rounded-full h-3 overflow-hidden border border-emerald-500/20">
              <div
                className="h-full bg-emerald-500/50 transition-all"
                style={{ width: `${stats.buyPercentage}%` }}
              ></div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <TrendingDown size={16} className="text-red-500" />
                <span className="text-gray-300">Institutional Selling</span>
              </div>
              <span className="font-bold text-red-400">{stats.sellPercentage.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-dark-surface rounded-full h-3 overflow-hidden border border-red-500/20">
              <div
                className="h-full bg-red-500/50 transition-all"
                style={{ width: `${stats.sellPercentage}%` }}
              ></div>
            </div>
          </div>

          {/* Net Position */}
          <div className="pt-4 border-t border-white/10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-400">Net Position</span>
              <span className={`font-bold ${stats.netPosition > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {stats.netPosition > 0 ? '+' : ''}{stats.netPosition.toFixed(0)}
              </span>
            </div>
            <div className="text-xs text-gray-500">
              Position Confidence: {(stats.confidence * 100).toFixed(0)}%
            </div>
          </div>

          {/* Accumulation Zones */}
          {positioning && positioning.accumulationZones.length > 0 && (
            <div className="pt-4 border-t border-white/10">
              <h4 className="text-xs font-semibold text-emerald-400 mb-2">Accumulation Zones</h4>
              <div className="grid grid-cols-2 gap-2">
                {positioning.accumulationZones.map((price, idx) => (
                  <div key={idx} className="bg-emerald-500/10 rounded p-2 text-xs border border-emerald-500/30">
                    <span className="text-emerald-400 font-semibold">₹{price.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Distribution Zones */}
          {positioning && positioning.distributionZones.length > 0 && (
            <div className="pt-4 border-t border-white/10">
              <h4 className="text-xs font-semibold text-red-400 mb-2">Distribution Zones</h4>
              <div className="grid grid-cols-2 gap-2">
                {positioning.distributionZones.map((price, idx) => (
                  <div key={idx} className="bg-red-500/10 rounded p-2 text-xs border border-red-500/30">
                    <span className="text-red-400 font-semibold">₹{price.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Cluster Intensity Chart */}
      {clusters.length > 0 && (
        <div className="bg-dark-card border border-white/10 rounded-lg p-6 space-y-4">
          <h4 className="text-sm font-semibold text-white">Order Cluster Intensity Map</h4>

          <div className="space-y-3 max-h-96 overflow-y-auto">
            {clusters.map((cluster, idx) => (
              <div key={idx} className="space-y-1.5">
                {/* Price Level */}
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${
                      cluster.direction === 'BUY' ? 'bg-emerald-500' : 'bg-red-500'
                    }`}></div>
                    <span className="font-mono text-white">₹{cluster.centerPrice.toFixed(2)}</span>
                  </div>
                  <span className="text-xs text-gray-400">
                    Vol: {(cluster.totalVolume / 1000).toFixed(0)}K
                  </span>
                </div>

                {/* Intensity Bar */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-dark-surface rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        cluster.direction === 'BUY' ? 'bg-emerald-500/60' : 'bg-red-500/60'
                      }`}
                      style={{ width: `${cluster.intensity * 100}%` }}
                    ></div>
                  </div>
                  <span className="text-xs text-gray-400 w-10 text-right">
                    {(cluster.intensity * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {clusters.length === 0 && (
        <div className="bg-dark-card border border-white/10 rounded-lg p-6 text-center text-gray-500 text-sm">
          No cluster activity detected
        </div>
      )}
    </div>
  );
}
