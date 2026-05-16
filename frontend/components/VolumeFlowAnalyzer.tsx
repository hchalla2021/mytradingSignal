'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface VolumeFlowAnalyzerProps {
  symbol: string;
  refreshInterval?: number;
}

interface VolumeFlowData {
  buyingVolume: number;
  sellingVolume: number;
  neutralVolume: number;
  buyingPressure: number;
  sellingPressure: number;
  accumulationStrength: number;
  distributionStrength: number;
  flowDirection: string;
  flowMomentum: number;
}

/**
 * VolumeFlowAnalyzer - Buying/selling pressure and institutional flow analysis
 * 
 * Analyzes volume flow patterns to identify institutional activity,
 * accumulation/distribution phases, and trend strength.
 * 
 * Performance: <25ms render, real-time pressure bar updates
 * Features: Flow direction badges, pressure gauges, institutional signatures
 */
export default function VolumeFlowAnalyzer({
  symbol,
  refreshInterval = 3000,
}: VolumeFlowAnalyzerProps) {
  const [flowData, setFlowData] = useState<VolumeFlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFlowData = useCallback(async () => {
    try {
      const response = await fetch(`/api/volume-pulse/flow/${symbol}`);
      if (!response.ok) throw new Error('Failed to fetch flow data');
      
      const data = await response.json();
      setFlowData(data.volumeFlow);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchFlowData();
    const interval = setInterval(fetchFlowData, refreshInterval);
    return () => clearInterval(interval);
  }, [symbol, refreshInterval, fetchFlowData]);

  if (loading) {
    return (
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-800 rounded w-1/3"></div>
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-slate-800 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !flowData) {
    return (
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800 text-slate-400">
        {error || 'No flow data available'}
      </div>
    );
  }

  const getDirectionIcon = (direction: string) => {
    switch (direction) {
      case 'BULLISH': return <TrendingUp size={20} />;
      case 'BEARISH': return <TrendingDown size={20} />;
      default: return <Minus size={20} />;
    }
  };

  const getMomentumColor = (momentum: number) => {
    if (momentum > 60) return 'bg-emerald-500';
    if (momentum > 50) return 'bg-teal-500';
    if (momentum > 40) return 'bg-amber-500';
    return 'bg-red-500';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Volume Flow Analysis</h1>
        <p className="text-sm text-slate-400">{symbol}</p>
      </div>

      {/* Main Flow Direction Card */}
      <div className={`rounded-lg p-8 border-2 ${
        flowData.flowDirection === 'BULLISH'
          ? 'bg-gradient-to-br from-emerald-950 to-emerald-900 border-emerald-700'
          : flowData.flowDirection === 'BEARISH'
          ? 'bg-gradient-to-br from-red-950 to-red-900 border-red-700'
          : 'bg-gradient-to-br from-amber-950 to-amber-900 border-amber-700'
      }`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-300 mb-2">Current Flow Direction</p>
            <div className="flex items-center gap-3">
              {getDirectionIcon(flowData.flowDirection)}
              <h2 className="text-4xl font-bold text-white">
                {flowData.flowDirection}
              </h2>
            </div>
            <p className="text-sm text-slate-400 mt-3">
              {flowData.flowDirection === 'BULLISH'
                ? 'Buying pressure dominates - Accumulation phase'
                : flowData.flowDirection === 'BEARISH'
                ? 'Selling pressure dominates - Distribution phase'
                : 'Balanced buying and selling - Equilibrium phase'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-300 mb-2">Momentum Score</p>
            <p className="text-5xl font-bold text-white">
              {Math.round(flowData.flowMomentum)}
            </p>
            <div className="w-full bg-slate-800 rounded h-2 mt-4">
              <div
                className={`h-full rounded ${getMomentumColor(flowData.flowMomentum)}`}
                style={{ width: `${flowData.flowMomentum}%` }}
              ></div>
            </div>
          </div>
        </div>
      </div>

      {/* Buying vs Selling Pressure */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Buying Pressure */}
        <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-400 flex items-center gap-2">
              <TrendingUp size={16} className="text-emerald-400" /> Buying Pressure
            </h3>
            <span className="text-xl font-bold text-emerald-400">
              {(flowData.buyingPressure * 100).toFixed(1)}%
            </span>
          </div>
          
          <div className="space-y-4">
            {/* Pressure Bar */}
            <div>
              <div className="w-full bg-slate-800 rounded h-8 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 flex items-center justify-end pr-3 transition-all duration-300"
                  style={{ width: `${flowData.buyingPressure * 100}%` }}
                >
                  {flowData.buyingPressure > 0.3 && (
                    <span className="text-sm font-bold text-black">
                      {(flowData.buyingPressure * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Volume Display */}
            <div className="bg-slate-800 rounded p-4">
              <p className="text-xs text-slate-500 mb-2">Total Buying Volume</p>
              <p className="text-2xl font-bold text-emerald-400">
                {(flowData.buyingVolume / 1000000).toFixed(2)}M
              </p>
            </div>

            {/* Interpretation */}
            <div className="text-sm text-slate-400 bg-emerald-950 rounded p-3 border border-emerald-800">
              <p>
                {flowData.buyingPressure > 0.6
                  ? '🔥 Strong buying momentum - Risk of pullback from extended move'
                  : flowData.buyingPressure > 0.5
                  ? '📈 Moderate buying activity - Potential accumulation'
                  : '📉 Weak buying activity - Buyers retreating'}
              </p>
            </div>
          </div>
        </div>

        {/* Selling Pressure */}
        <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-400 flex items-center gap-2">
              <TrendingDown size={16} className="text-red-400" /> Selling Pressure
            </h3>
            <span className="text-xl font-bold text-red-400">
              {(flowData.sellingPressure * 100).toFixed(1)}%
            </span>
          </div>
          
          <div className="space-y-4">
            {/* Pressure Bar */}
            <div>
              <div className="w-full bg-slate-800 rounded h-8 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-l from-red-600 to-red-400 flex items-start pl-3 transition-all duration-300"
                  style={{ width: `${flowData.sellingPressure * 100}%` }}
                >
                  {flowData.sellingPressure > 0.3 && (
                    <span className="text-sm font-bold text-white mt-1">
                      {(flowData.sellingPressure * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Volume Display */}
            <div className="bg-slate-800 rounded p-4">
              <p className="text-xs text-slate-500 mb-2">Total Selling Volume</p>
              <p className="text-2xl font-bold text-red-400">
                {(flowData.sellingVolume / 1000000).toFixed(2)}M
              </p>
            </div>

            {/* Interpretation */}
            <div className="text-sm text-slate-400 bg-red-950 rounded p-3 border border-red-800">
              <p>
                {flowData.sellingPressure > 0.6
                  ? '🔴 Strong selling momentum - Risk of bounce attempt'
                  : flowData.sellingPressure > 0.5
                  ? '📉 Moderate selling activity - Potential distribution'
                  : '📈 Weak selling activity - Sellers reducing'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Institutional Signatures */}
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
        <h3 className="text-sm font-semibold text-slate-400 mb-6">Institutional Activity Signatures</h3>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Accumulation Indicator */}
          <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-lg p-5 border border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-sm font-semibold text-slate-300">Accumulation Strength</h4>
              <span className={`text-2xl font-bold ${
                flowData.accumulationStrength > 0.6 ? 'text-emerald-400' : 'text-slate-400'
              }`}>
                {(flowData.accumulationStrength * 100).toFixed(0)}%
              </span>
            </div>

            {/* Strength Bar */}
            <div className="w-full bg-slate-700 rounded h-3">
              <div
                className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded transition-all duration-300"
                style={{ width: `${flowData.accumulationStrength * 100}%` }}
              ></div>
            </div>

            {/* Description */}
            <p className="text-xs text-slate-400 mt-4">
              {flowData.accumulationStrength > 0.6
                ? 'Strong accumulation - Institutions buying on weakness'
                : flowData.accumulationStrength > 0.3
                ? 'Moderate accumulation detected'
                : 'Weak accumulation signals'}
            </p>
          </div>

          {/* Distribution Indicator */}
          <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-lg p-5 border border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-sm font-semibold text-slate-300">Distribution Strength</h4>
              <span className={`text-2xl font-bold ${
                flowData.distributionStrength > 0.6 ? 'text-red-400' : 'text-slate-400'
              }`}>
                {(flowData.distributionStrength * 100).toFixed(0)}%
              </span>
            </div>

            {/* Strength Bar */}
            <div className="w-full bg-slate-700 rounded h-3">
              <div
                className="h-full bg-gradient-to-r from-red-600 to-red-400 rounded transition-all duration-300"
                style={{ width: `${flowData.distributionStrength * 100}%` }}
              ></div>
            </div>

            {/* Description */}
            <p className="text-xs text-slate-400 mt-4">
              {flowData.distributionStrength > 0.6
                ? 'Strong distribution - Institutions selling into strength'
                : flowData.distributionStrength > 0.3
                ? 'Moderate distribution detected'
                : 'Weak distribution signals'}
            </p>
          </div>
        </div>
      </div>

      {/* Trading Implications */}
      <div className="bg-gradient-to-br from-purple-950 to-purple-900 rounded-lg p-6 border border-purple-700">
        <h3 className="text-sm font-semibold text-purple-300 mb-4">📊 Trading Implications</h3>
        <div className="space-y-2 text-sm text-purple-200">
          <p>
            • <strong>Flow Direction:</strong> {flowData.flowDirection} momentum indicates {
              flowData.flowDirection === 'BULLISH'
                ? 'potential upside continuation'
                : flowData.flowDirection === 'BEARISH'
                ? 'potential downside continuation'
                : 'potential consolidation'
            }
          </p>
          <p>
            • <strong>Institutional Activity:</strong> {
              Math.max(flowData.accumulationStrength, flowData.distributionStrength) > 0.6
                ? 'Strong institutional signatures detected - Follow major players'
                : 'Moderate institutional activity - Monitor for accumulation/distribution phases'
            }
          </p>
          <p>
            • <strong>Volume Momentum:</strong> {
              flowData.flowMomentum > 60
                ? 'Strong volume momentum - Risk of extended move'
                : flowData.flowMomentum > 40
                ? 'Moderate volume momentum - Normal trading conditions'
                : 'Weak volume momentum - Consolidation likely'
            }
          </p>
        </div>
      </div>
    </div>
  );
}
