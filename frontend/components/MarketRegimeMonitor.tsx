'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Gauge, TrendingUp, TrendingDown, Activity } from 'lucide-react';

interface RegimeData {
  symbol: string;
  regime: {
    type: string;
    sub_regime: string;
    strength: number;
    confidence: number;
    optimal_strategy: string;
  } | null;
  momentum: {
    direction: string;
    strength: number;
    acceleration: string;
    fatigue: number;
  } | null;
  liquidity: {
    level: string;
    bid_ask_spread: number;
    execution_difficulty: string;
  } | null;
  timestamp: string;
}

interface MarketRegimeMonitorProps {
  symbol: string;
  refreshInterval?: number;
}

/**
 * Market Regime Monitor - Market regime and momentum tracking
 * 
 * Shows:
 * - Current market regime (TRENDING, RANGING, VOLATILE)
 * - Sub-regime classification
 * - Momentum direction and strength
 * - Momentum acceleration
 * - Momentum fatigue level
 * - Liquidity conditions
 * - Optimal trading strategy
 * 
 * Performance: <25ms render
 */
export default function MarketRegimeMonitor({
  symbol = 'NIFTY',
  refreshInterval = 3000,
}: MarketRegimeMonitorProps) {
  const [data, setData] = useState<RegimeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [, setError] = useState<string | null>(null);

  const fetchRegimeData = useCallback(async () => {
    try {
      const response = await fetch(`/api/market-compass/market-regime/${symbol}`);
      if (!response.ok) {
        if (response.status === 202) {
          setLoading(false);
          return;
        }
        throw new Error('Failed to fetch regime data');
      }
      
      const data = await response.json();
      setData(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchRegimeData();
    const interval = setInterval(fetchRegimeData, refreshInterval);
    return () => clearInterval(interval);
  }, [symbol, refreshInterval, fetchRegimeData]);

  if (loading || !data) {
    return (
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
        <div className="animate-pulse space-y-4">
          <div className="h-20 bg-slate-800 rounded"></div>
          <div className="grid grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-16 bg-slate-800 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const regime = data.regime;
  const momentum = data.momentum;
  const liquidity = data.liquidity;

  const getRegimeColor = (type: string) => {
    switch (type) {
      case 'TRENDING':
        return 'from-blue-600 to-blue-700';
      case 'RANGING':
        return 'from-purple-600 to-purple-700';
      case 'VOLATILE':
        return 'from-red-600 to-red-700';
      default:
        return 'from-slate-600 to-slate-700';
    }
  };

  const getLiquidityColor = (level: string) => {
    switch (level) {
      case 'HIGH':
        return 'text-emerald-400 bg-emerald-950';
      case 'MEDIUM':
        return 'text-amber-400 bg-amber-950';
      case 'LOW':
        return 'text-red-400 bg-red-950';
      default:
        return 'text-slate-400 bg-slate-800';
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Gauge size={20} className="text-teal-400" />
            Market Regime Monitor
          </h3>
          <p className="text-xs text-slate-400">{symbol} market conditions and momentum</p>
        </div>
      </div>

      {/* Regime Card */}
      {regime && (
        <div className={`bg-gradient-to-br ${getRegimeColor(regime.type)} rounded-lg p-6 text-white shadow-lg`}>
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-xs opacity-80 mb-1">Market Regime</p>
              <p className="text-3xl font-bold">{regime.type}</p>
            </div>
            <div className="text-right">
              <p className="text-xs opacity-80 mb-1">Sub-Regime</p>
              <p className="text-sm font-semibold">{regime.sub_regime}</p>
            </div>
          </div>

          <div className="pt-4 border-t border-white/20 space-y-2">
            <p className="text-sm">
              Strategy: <span className="font-bold">{regime.optimal_strategy}</span>
            </p>
            <p className="text-xs opacity-75">
              Confidence: {(regime.confidence * 100).toFixed(0)}%
            </p>
          </div>
        </div>
      )}

      {/* Momentum Section */}
      {momentum && (
        <div className="bg-slate-900 rounded-lg p-4 border border-slate-800 space-y-3">
          <p className="text-xs text-slate-400 font-semibold flex items-center gap-2">
            <Activity size={16} className="text-teal-400" />
            Momentum Analysis
          </p>

          {/* Direction */}
          <div className="flex items-center justify-between bg-slate-800 rounded-lg p-3">
            <span className="text-sm text-slate-400">Direction</span>
            <div className="flex items-center gap-2">
              {momentum.direction === 'BULLISH' ? (
                <TrendingUp size={18} className="text-emerald-400" />
              ) : (
                <TrendingDown size={18} className="text-red-400" />
              )}
              <span className={`font-bold ${
                momentum.direction === 'BULLISH' ? 'text-emerald-400' : 'text-red-400'
              }`}>
                {momentum.direction}
              </span>
            </div>
          </div>

          {/* Strength */}
          <div className="bg-slate-800 rounded-lg p-3">
            <p className="text-xs text-slate-400 font-semibold mb-2">Momentum Strength</p>
            <div className="w-full bg-slate-700 rounded-full h-2.5 overflow-hidden">
              <div
                className={`h-full transition-all ${
                  momentum.strength > 75 ? 'bg-emerald-500' :
                  momentum.strength > 50 ? 'bg-emerald-400' :
                  momentum.strength > 25 ? 'bg-amber-400' :
                  'bg-red-400'
                }`}
                style={{ width: `${Math.min(momentum.strength, 100)}%` }}
              />
            </div>
            <p className="text-sm font-bold text-slate-200 mt-2">{momentum.strength.toFixed(1)}%</p>
          </div>

          {/* Acceleration & Fatigue */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-800 rounded-lg p-3">
              <p className="text-xs text-slate-400 font-semibold mb-1">Acceleration</p>
              <p className={`text-sm font-bold ${
                momentum.acceleration === 'ACCELERATING' ? 'text-emerald-400' :
                momentum.acceleration === 'DECELERATING' ? 'text-red-400' :
                'text-slate-400'
              }`}>
                {momentum.acceleration}
              </p>
            </div>

            <div className="bg-slate-800 rounded-lg p-3">
              <p className="text-xs text-slate-400 font-semibold mb-1">Fatigue Level</p>
              <p className="text-sm font-bold text-orange-400">
                {momentum.fatigue.toFixed(0)}%
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Liquidity Section */}
      {liquidity && (
        <div className="bg-slate-900 rounded-lg p-4 border border-slate-800 space-y-3">
          <p className="text-xs text-slate-400 font-semibold">Liquidity Conditions</p>

          <div className="grid grid-cols-2 gap-3">
            {/* Liquidity Level */}
            <div className={`rounded-lg p-3 border ${liquidity.level === 'HIGH' ? 'bg-emerald-950 border-emerald-700' : liquidity.level === 'MEDIUM' ? 'bg-amber-950 border-amber-700' : 'bg-red-950 border-red-700'}`}>
              <p className="text-xs text-slate-400 mb-1 font-semibold">Level</p>
              <p className={`font-bold ${getLiquidityColor(liquidity.level)}`}>
                {liquidity.level}
              </p>
            </div>

            {/* Execution Difficulty */}
            <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
              <p className="text-xs text-slate-400 mb-1 font-semibold">Execution</p>
              <p className={`font-bold ${
                liquidity.execution_difficulty === 'EASY' ? 'text-emerald-400' :
                liquidity.execution_difficulty === 'MODERATE' ? 'text-amber-400' :
                'text-red-400'
              }`}>
                {liquidity.execution_difficulty}
              </p>
            </div>
          </div>

          {/* Bid-Ask Spread */}
          <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
            <p className="text-xs text-slate-400 mb-1 font-semibold">Bid-Ask Spread</p>
            <p className="text-sm font-bold text-teal-400">{liquidity.bid_ask_spread.toFixed(4)}</p>
          </div>
        </div>
      )}

      {/* Strategy Recommendation */}
      {regime && (
        <div className="bg-indigo-950 rounded-lg p-4 border border-indigo-700">
          <p className="text-xs text-indigo-300 font-semibold mb-2">💡 Optimal Strategy</p>
          <p className="text-sm text-indigo-200">
            {regime.optimal_strategy === 'TREND_FOLLOWING' && 'Follow the trend with breakout/breakdown strategies. Use pullbacks as entry points.'}
            {regime.optimal_strategy === 'MEAN_REVERSION' && 'Markets are ranging. Sell highs, buy lows. Use support/resistance levels.'}
            {regime.optimal_strategy === 'SCALPING' && 'High volatility detected. Use tight stops and quick exits. Consider reduced position sizes.'}
            {regime.optimal_strategy === 'NEUTRAL' && 'Market is in transition. Wait for clearer signals before aggressive trading.'}
          </p>
        </div>
      )}
    </div>
  );
}
