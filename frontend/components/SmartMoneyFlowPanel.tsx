'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Zap, TrendingUp, TrendingDown, BarChart3 } from 'lucide-react';

interface SmartMoneyFlowData {
  phase: string;
  phase_strength: number;
  volume: {
    buying_ratio: number;
    selling_ratio: number;
    trend: string;
  };
  smart_money: {
    long_ratio: number;
    short_ratio: number;
  };
  entry_setup: {
    has_setup: boolean;
    probability: number;
    reason: string;
  };
  alignment: number;
  timestamp: string;
}

interface SmartMoneyFlowPanelProps {
  symbol: string;
  refreshInterval?: number;
}

/**
 * Smart Money Flow Panel - Institutional flow and order analysis
 * 
 * Shows:
 * - Buying vs selling pressure
 * - Institutional positioning (long/short ratio)
 * - Accumulation phase
 * - Entry setup confirmation
 * - Multi-timeframe alignment
 * 
 * Performance: <30ms render, real-time updates
 */
export default function SmartMoneyFlowPanel({
  symbol,
  refreshInterval = 3000,
}: SmartMoneyFlowPanelProps) {
  const [flow, setFlow] = useState<SmartMoneyFlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFlow = useCallback(async () => {
    try {
      const response = await fetch(`/api/ict-bias/flow/${symbol}`);
      if (!response.ok) throw new Error('Failed to fetch flow');
      
      const data = await response.json();
      setFlow(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchFlow();
    const interval = setInterval(fetchFlow, refreshInterval);
    return () => clearInterval(interval);
  }, [symbol, refreshInterval, fetchFlow]);

  if (loading) {
    return (
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-800 rounded w-1/3"></div>
          <div className="grid grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 bg-slate-800 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !flow) {
    return (
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800 text-slate-400">
        {error || 'No flow data available'}
      </div>
    );
  }

  const isBuying = flow.volume.buying_ratio > flow.volume.selling_ratio;
  const volumeDiff = Math.abs(flow.volume.buying_ratio - flow.volume.selling_ratio);

  const getPhaseColor = (phase: string) => {
    if (phase.includes('PHASE_1') || phase.includes('PHASE_2')) return 'emerald';
    if (phase.includes('PHASE_3')) return 'amber';
    if (phase.includes('MARKUP')) return 'emerald';
    return 'slate';
  };

  const getPhaseDescription = (phase: string) => {
    if (phase.includes('PHASE_1')) return 'Quiet Accumulation - Smart money quietly building position';
    if (phase.includes('PHASE_2')) return 'Shakeout Phase - Aggressive accumulation with volatility';
    if (phase.includes('PHASE_3')) return 'Ready for Markup - Building momentum for move';
    if (phase.includes('MARKUP')) return 'Impulsive Move - Price moving up strongly';
    if (phase.includes('DISTRIBUTION')) return 'Distribution Phase - Selling to retail traders';
    return 'Unknown Phase';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Smart Money Flow</h2>
          <p className="text-sm text-slate-400">{symbol}</p>
        </div>
        <div className={`px-4 py-2 rounded-lg bg-${getPhaseColor(flow.phase)}-950 border border-${getPhaseColor(flow.phase)}-700`}>
          <p className={`text-sm font-bold text-${getPhaseColor(flow.phase)}-400`}>{flow.phase}</p>
        </div>
      </div>

      {/* Phase Description */}
      <div className={`bg-${getPhaseColor(flow.phase)}-950 rounded-lg p-4 border border-${getPhaseColor(flow.phase)}-700`}>
        <p className={`text-${getPhaseColor(flow.phase)}-300 text-sm`}>{getPhaseDescription(flow.phase)}</p>
        <div className={`mt-3 w-full bg-slate-800 rounded-full h-2 overflow-hidden`}>
          <div
            className={`h-full bg-${getPhaseColor(flow.phase)}-500`}
            style={{ width: `${flow.phase_strength * 100}%` }}
          ></div>
        </div>
      </div>

      {/* Volume Flow - Buying vs Selling */}
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
        <h3 className="text-sm font-semibold text-slate-400 mb-6 flex items-center gap-2">
          <BarChart3 size={16} /> Institutional Volume Flow
        </h3>

        {/* Main Flow Direction Card */}
        <div className={`bg-gradient-to-r ${isBuying ? 'from-emerald-950 to-emerald-900' : 'from-red-950 to-red-900'} rounded-lg p-6 border ${isBuying ? 'border-emerald-700' : 'border-red-700'} mb-6`}>
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-sm font-semibold ${isBuying ? 'text-emerald-400' : 'text-red-400'}`}>
                {isBuying ? '📈 BUYING PRESSURE' : '📉 SELLING PRESSURE'}
              </p>
              <p className={`text-3xl font-bold mt-2 ${isBuying ? 'text-emerald-400' : 'text-red-400'}`}>
                {volumeDiff.toFixed(1)}%
              </p>
            </div>
            <div className={`text-5xl ${isBuying ? 'text-emerald-500' : 'text-red-500'} opacity-20`}>
              {isBuying ? <TrendingUp /> : <TrendingDown />}
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-3">
            {isBuying ? '💪 Institutional buyers in control' : '⚠️ Institutional sellers in control'}
          </p>
        </div>

        {/* Buying vs Selling Breakdown */}
        <div className="space-y-4">
          {/* Buying Pressure */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-emerald-400 font-semibold text-sm">Buying Pressure</span>
              <span className="text-emerald-400 font-bold">{flow.volume.buying_ratio.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-4 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400"
                style={{ width: `${flow.volume.buying_ratio}%` }}
              ></div>
            </div>
          </div>

          {/* Selling Pressure */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-red-400 font-semibold text-sm">Selling Pressure</span>
              <span className="text-red-400 font-bold">{flow.volume.selling_ratio.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-4 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-red-500 to-red-400"
                style={{ width: `${flow.volume.selling_ratio}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Volume Trend */}
        <div className="mt-6 pt-6 border-t border-slate-700">
          <div className="flex items-center justify-between">
            <span className="text-slate-300 font-semibold">Volume Trend</span>
            <span className={`px-3 py-1 rounded font-semibold text-xs ${
              flow.volume.trend === 'INCREASING' ? 'bg-emerald-950 text-emerald-400' :
              flow.volume.trend === 'DECREASING' ? 'bg-red-950 text-red-400' :
              'bg-slate-800 text-slate-400'
            }`}>
              {flow.volume.trend}
            </span>
          </div>
        </div>
      </div>

      {/* Smart Money Positioning */}
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
        <h3 className="text-sm font-semibold text-slate-400 mb-4 flex items-center gap-2">
          <Zap size={16} /> Smart Money Positioning
        </h3>

        <div className="grid grid-cols-2 gap-4">
          {/* Long Ratio */}
          <div className="bg-emerald-950 rounded-lg p-4 border border-emerald-700">
            <p className="text-xs text-emerald-400 font-semibold mb-2">LONG POSITIONING</p>
            <p className="text-3xl font-bold text-emerald-400">
              {(flow.smart_money.long_ratio * 100).toFixed(0)}%
            </p>
            <div className="mt-3 w-full bg-slate-800 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-emerald-500"
                style={{ width: `${flow.smart_money.long_ratio * 100}%` }}
              ></div>
            </div>
          </div>

          {/* Short Ratio */}
          <div className="bg-red-950 rounded-lg p-4 border border-red-700">
            <p className="text-xs text-red-400 font-semibold mb-2">SHORT POSITIONING</p>
            <p className="text-3xl font-bold text-red-400">
              {(flow.smart_money.short_ratio * 100).toFixed(0)}%
            </p>
            <div className="mt-3 w-full bg-slate-800 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-red-500"
                style={{ width: `${flow.smart_money.short_ratio * 100}%` }}
              ></div>
            </div>
          </div>
        </div>
      </div>

      {/* Entry Setup */}
      <div className={`rounded-lg p-6 border ${
        flow.entry_setup.has_setup 
          ? 'bg-emerald-950 border-emerald-700' 
          : 'bg-slate-900 border-slate-800'
      }`}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className={`text-sm font-semibold ${
              flow.entry_setup.has_setup ? 'text-emerald-400' : 'text-slate-400'
            } mb-2`}>
              Entry Setup Confirmation
            </h3>
            <p className={`text-sm ${
              flow.entry_setup.has_setup ? 'text-emerald-300' : 'text-slate-400'
            }`}>
              {flow.entry_setup.reason || 'No clear entry setup'}
            </p>
          </div>
          <div className={`text-3xl font-bold ${
            flow.entry_setup.has_setup ? 'text-emerald-400' : 'text-slate-500'
          }`}>
            {(flow.entry_setup.probability * 100).toFixed(0)}%
          </div>
        </div>
        <div className={`mt-3 w-full bg-slate-800 rounded-full h-2 overflow-hidden`}>
          <div
            className={`h-full ${flow.entry_setup.has_setup ? 'bg-emerald-500' : 'bg-slate-600'}`}
            style={{ width: `${flow.entry_setup.probability * 100}%` }}
          ></div>
        </div>
      </div>

      {/* Multi-Timeframe Alignment */}
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-400">Multi-Timeframe Alignment</h3>
          <span className="text-2xl font-bold text-teal-400">
            {(flow.alignment * 100).toFixed(0)}%
          </span>
        </div>
        <div className="mt-4 w-full bg-slate-800 rounded-full h-3 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-teal-500 to-teal-400"
            style={{ width: `${flow.alignment * 100}%` }}
          ></div>
        </div>
        <p className="text-xs text-slate-400 mt-3">
          {flow.alignment > 0.7 ? '✅ Strong alignment across timeframes' : '⚠️ Weak multi-timeframe confirmation'}
        </p>
      </div>

      {/* Intelligence Summary */}
      <div className="bg-gradient-to-r from-indigo-950 to-indigo-900 rounded-lg p-6 border border-indigo-700">
        <h3 className="text-sm font-semibold text-indigo-300 mb-3">💡 Smart Money Intelligence</h3>
        <div className="space-y-2 text-sm text-indigo-200">
          <p>
            • {isBuying ? '🟢 Buying pressure dominant' : '🔴 Selling pressure dominant'} - Institutional traders are {isBuying ? 'accumulating' : 'distributing'}
          </p>
          <p>
            • {flow.entry_setup.has_setup ? '✅ Valid entry setup detected' : '❌ No clear entry setup'} - {flow.entry_setup.probability > 0.5 ? 'High probability setup' : 'Low probability setup'}
          </p>
          <p>
            • 📊 {flow.volume.trend === 'INCREASING' ? 'Volume increasing' : flow.volume.trend === 'DECREASING' ? 'Volume decreasing' : 'Volume stable'} - Institutional activity is {flow.volume.trend === 'INCREASING' ? 'accelerating' : 'slowing'}
          </p>
        </div>
      </div>
    </div>
  );
}
