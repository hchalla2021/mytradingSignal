'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, AlertCircle, Zap } from 'lucide-react';

interface BiasData {
  bias: {
    direction: string;
    strength: number;
    confidence: number;
    structure: string;
    clarity: number;
    momentum: number;
    volatility: string;
  };
  institutional: {
    accumulation: number;
    distribution: number;
    smart_money_bias: string;
  };
  zones: {
    bullish_count: number;
    bearish_count: number;
    nearest_support: number;
    nearest_resistance: number;
  };
  risk_reward: number;
  price_position: string;
  timestamp: string;
}

interface ICTBiasDashboardProps {
  symbol: string;
  refreshInterval?: number;
}

/**
 * ICT Bias Dashboard - Main institutional bias analysis interface
 * 
 * Shows:
 * - Current bias direction (Bullish/Bearish)
 * - Bias strength and confidence
 * - Market structure analysis
 * - Institutional positioning
 * - Risk/reward metrics
 * 
 * Performance: <50ms render, real-time updates
 */
export default function ICTBiasDashboard({
  symbol,
  refreshInterval = 3000,
}: ICTBiasDashboardProps) {
  const [bias, setBias] = useState<BiasData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'bias' | 'structure' | 'institutional'>('bias');

  const fetchBias = useCallback(async () => {
    try {
      const response = await fetch(`/api/ict-bias/current/${symbol}`);
      if (!response.ok) throw new Error('Failed to fetch bias');
      
      const data = await response.json();
      setBias(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchBias();
    const interval = setInterval(fetchBias, refreshInterval);
    return () => clearInterval(interval);
  }, [symbol, refreshInterval, fetchBias]);

  if (loading) {
    return (
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
        <div className="animate-pulse space-y-4">
          <div className="h-20 bg-slate-800 rounded"></div>
          <div className="grid grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-24 bg-slate-800 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !bias) {
    return (
      <div className="bg-slate-900 rounded-lg p-6 border border-red-800">
        <div className="flex items-center gap-3 text-red-400">
          <AlertCircle size={20} />
          <span>{error || 'No bias data available'}</span>
        </div>
      </div>
    );
  }

  const isBullish = bias.bias.direction.includes('BULLISH');
  const biasColor = isBullish ? 'emerald' : 'red';
  const directionIcon = isBullish ? <TrendingUp /> : <TrendingDown />;

  const getStrengthLabel = (strength: number) => {
    if (strength > 0.8) return 'EXTREME';
    if (strength > 0.65) return 'STRONG';
    if (strength > 0.5) return 'MODERATE';
    if (strength > 0.35) return 'WEAK';
    return 'NONE';
  };

  const getStructureLabel = (structure: string) => {
    if (structure.includes('HIGHER')) return 'Impulsive (HH/HL)';
    if (structure.includes('LOWER')) return 'Corrective (LH/LL)';
    return 'Consolidating';
  };

  return (
    <div className="space-y-6">
      {/* Header with Bias Direction */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-lg p-8 border border-slate-700">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">ICT Bias Analysis</h1>
            <p className="text-slate-400">{symbol}</p>
          </div>
          <div className={`flex items-center gap-3 px-6 py-4 rounded-lg bg-${biasColor}-950 border border-${biasColor}-700`}>
            <div className={`text-${biasColor}-400`}>{directionIcon}</div>
            <div>
              <p className={`text-xl font-bold text-${biasColor}-400`}>
                {bias.bias.direction}
              </p>
              <p className="text-xs text-slate-400">Current Bias</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Bias Metrics - Large Display */}
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
        <h2 className="text-sm font-semibold text-slate-400 mb-4 flex items-center gap-2">
          <Zap size={16} /> Bias Strength & Confidence
        </h2>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Bias Strength Gauge */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-slate-300 font-semibold">Bias Strength</span>
              <span className={`text-2xl font-bold text-${biasColor}-400`}>
                {(bias.bias.strength * 100).toFixed(0)}%
              </span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-4 overflow-hidden">
              <div
                className={`h-full bg-gradient-to-r from-${biasColor}-500 to-${biasColor}-400`}
                style={{ width: `${bias.bias.strength * 100}%` }}
              ></div>
            </div>
            <p className="text-xs text-slate-400">
              {getStrengthLabel(bias.bias.strength)} BIAS
            </p>
          </div>

          {/* Confidence Gauge */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-slate-300 font-semibold">Confidence</span>
              <span className="text-2xl font-bold text-teal-400">
                {(bias.bias.confidence * 100).toFixed(0)}%
              </span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-4 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-teal-500 to-teal-400"
                style={{ width: `${bias.bias.confidence * 100}%` }}
              ></div>
            </div>
            <p className="text-xs text-slate-400">Analysis Confidence</p>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-slate-700">
        {(['bias', 'structure', 'institutional'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 font-semibold transition text-sm ${
              activeTab === tab
                ? `border-b-2 border-emerald-500 text-emerald-400`
                : `text-slate-400 hover:text-slate-300`
            }`}
          >
            {tab === 'bias' && '📊 Bias'}
            {tab === 'structure' && '🏗️ Structure'}
            {tab === 'institutional' && '💼 Institutional'}
          </button>
        ))}
      </div>

      {/* Tab Content - Bias Tab */}
      {activeTab === 'bias' && (
        <div className="space-y-4">
          {/* Momentum */}
          <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-300 font-semibold">Volume Momentum</span>
              <span className={`font-bold ${bias.bias.momentum > 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                {bias.bias.momentum.toFixed(1)}
              </span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden">
              <div
                className={`h-full ${bias.bias.momentum > 50 ? 'bg-emerald-500' : 'bg-red-500'}`}
                style={{ width: `${bias.bias.momentum}%` }}
              ></div>
            </div>
            <p className="text-xs text-slate-400 mt-2">
              {bias.bias.momentum > 60 ? '🔥 Bullish momentum' : bias.bias.momentum < 40 ? '📉 Bearish momentum' : '⚖️ Neutral momentum'}
            </p>
          </div>

          {/* Volatility */}
          <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-slate-300 font-semibold">Volatility Level</span>
              <span className={`px-3 py-1 rounded font-semibold text-sm ${
                bias.bias.volatility === 'HIGH' ? 'bg-red-950 text-red-400' :
                bias.bias.volatility === 'MEDIUM' ? 'bg-amber-950 text-amber-400' :
                'bg-emerald-950 text-emerald-400'
              }`}>
                {bias.bias.volatility}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Tab Content - Structure Tab */}
      {activeTab === 'structure' && (
        <div className="space-y-4">
          <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
            <p className="text-sm text-slate-400 mb-3">Market Structure</p>
            <p className="text-xl font-bold text-slate-100 mb-2">
              {getStructureLabel(bias.bias.structure)}
            </p>
            <p className="text-xs text-slate-400">{bias.bias.structure}</p>
          </div>

          <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-slate-300 font-semibold">Structure Clarity</span>
              <span className="text-2xl font-bold text-teal-400">
                {(bias.bias.clarity * 100).toFixed(0)}%
              </span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2 mt-3 overflow-hidden">
              <div
                className="h-full bg-teal-500"
                style={{ width: `${bias.bias.clarity * 100}%` }}
              ></div>
            </div>
            <p className="text-xs text-slate-400 mt-2">
              {bias.bias.clarity > 0.7 ? '✅ Clear structure' : '⚠️ Unclear structure'}
            </p>
          </div>
        </div>
      )}

      {/* Tab Content - Institutional Tab */}
      {activeTab === 'institutional' && (
        <div className="space-y-4">
          {/* Accumulation vs Distribution */}
          <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
            <p className="text-sm text-slate-400 mb-4">Smart Money Positioning</p>
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-emerald-400">Accumulation</span>
                  <span className="font-bold text-emerald-400">{(bias.institutional.accumulation * 100).toFixed(0)}%</span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500"
                    style={{ width: `${bias.institutional.accumulation * 100}%` }}
                  ></div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-red-400">Distribution</span>
                  <span className="font-bold text-red-400">{(bias.institutional.distribution * 100).toFixed(0)}%</span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full bg-red-500"
                    style={{ width: `${bias.institutional.distribution * 100}%` }}
                  ></div>
                </div>
              </div>
            </div>
          </div>

          {/* Smart Money Bias */}
          <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-slate-300 font-semibold">Smart Money Bias</span>
              <span className={`px-4 py-2 rounded font-bold ${
                bias.institutional.smart_money_bias === 'LONG' ? 'bg-emerald-950 text-emerald-400' :
                bias.institutional.smart_money_bias === 'SHORT' ? 'bg-red-950 text-red-400' :
                'bg-slate-800 text-slate-400'
              }`}>
                {bias.institutional.smart_money_bias}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Key Price Levels */}
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
        <h3 className="text-sm font-semibold text-slate-400 mb-4">Key Price Levels</h3>
        
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-emerald-950 rounded-lg p-4 border border-emerald-700">
            <p className="text-xs text-emerald-400 font-semibold">Nearest Support</p>
            <p className="text-2xl font-bold text-emerald-400 mt-2">
              {bias.zones.nearest_support.toFixed(2)}
            </p>
            <p className="text-xs text-slate-400 mt-1">({bias.zones.bullish_count} zones)</p>
          </div>

          <div className="bg-red-950 rounded-lg p-4 border border-red-700">
            <p className="text-xs text-red-400 font-semibold">Nearest Resistance</p>
            <p className="text-2xl font-bold text-red-400 mt-2">
              {bias.zones.nearest_resistance.toFixed(2)}
            </p>
            <p className="text-xs text-slate-400 mt-1">({bias.zones.bearish_count} zones)</p>
          </div>
        </div>
      </div>

      {/* Risk/Reward */}
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
        <div className="flex items-center justify-between">
          <span className="text-slate-300 font-semibold">Risk/Reward Ratio</span>
          <span className={`text-3xl font-bold ${bias.risk_reward > 2 ? 'text-emerald-400' : bias.risk_reward > 1 ? 'text-amber-400' : 'text-red-400'}`}>
            {bias.risk_reward.toFixed(2)}:1
          </span>
        </div>
        <p className="text-xs text-slate-400 mt-2">
          {bias.risk_reward > 2 ? '✅ Excellent risk/reward' : bias.risk_reward > 1 ? '⚠️ Fair risk/reward' : '❌ Poor risk/reward'}
        </p>
      </div>
    </div>
  );
}
