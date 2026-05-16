'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Gauge, TrendingUp, TrendingDown, AlertCircle, Zap } from 'lucide-react';

/**
 * 💪 MOMENTUM METER PANEL
 * Real-time momentum and trend strength visualization
 * 
 * Features:
 * - Momentum score gauge (0-100)
 * - Trend velocity and acceleration metrics
 * - RSI, MACD, ATR indicators
 * - Momentum direction indicator
 * - Multi-indicator confluence display
 * - Interactive visualization
 */

interface MomentumMetrics {
  trendVelocity: number;
  trendAcceleration: number;
  momentumScore: number;
  rsi: number;
  macdHistogram: number;
  atr: number;
  atrPercentage: number;
  momentumDirection: 'UP' | 'DOWN' | 'NEUTRAL';
  momentumStrength: number;
}

interface MomentumMeterPanelProps {
  symbol: string;
}

export const MomentumMeterPanel: React.FC<MomentumMeterPanelProps> = ({ symbol }) => {
  const [momentum, setMomentum] = useState<MomentumMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchMomentum = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch(`/api/trend-base/momentum/${symbol}`);
      if (!response.ok) throw new Error('Failed to fetch momentum');
      const data = await response.json();
      setMomentum(data.momentum);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [symbol]);

  useEffect(() => {
    Promise.resolve(fetchMomentum()).then(() => setLoading(false));
    refreshIntervalRef.current = setInterval(fetchMomentum, 3000);

    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    };
  }, [symbol, fetchMomentum]);

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

  if (!momentum) {
    return <div className="text-center text-slate-400 py-8">No momentum data available</div>;
  }

  const getMomentumColor = (score: number) => {
    if (score > 70) return 'emerald';
    if (score > 60) return 'teal';
    if (score > 50) return 'amber';
    if (score > 40) return 'orange';
    return 'red';
  };

  const getDirectionIcon = (direction: string) => {
    switch (direction) {
      case 'UP':
        return <TrendingUp className="w-6 h-6 text-emerald-400" />;
      case 'DOWN':
        return <TrendingDown className="w-6 h-6 text-red-400" />;
      default:
        return <Gauge className="w-6 h-6 text-amber-400" />;
    }
  };

  const color = getMomentumColor(momentum.momentumScore);
  const colorClass = `text-${color}-400`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-white mb-1">Momentum Meter</h2>
        <p className="text-slate-400 text-sm">{symbol} • Trend Strength & Velocity</p>
      </div>

      {/* Main Gauge Card */}
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-lg p-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Left: Momentum Gauge */}
          <div className="flex flex-col items-center justify-center">
            {/* Circular Gauge */}
            <div className="relative w-48 h-48 mb-6">
              {/* Background circle */}
              <svg className="w-full h-full" viewBox="0 0 200 200">
                {/* Gradient background */}
                <defs>
                  <linearGradient id={`gauge-gradient-${symbol}`} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#059669" />
                    <stop offset="50%" stopColor="#f59e0b" />
                    <stop offset="100%" stopColor="#dc2626" />
                  </linearGradient>
                </defs>

                {/* Background circle */}
                <circle cx="100" cy="100" r="90" fill="none" stroke="#1e293b" strokeWidth="4" />

                {/* Progress circle */}
                <circle
                  cx="100"
                  cy="100"
                  r="90"
                  fill="none"
                  stroke={`url(#gauge-gradient-${symbol})`}
                  strokeWidth="4"
                  strokeDasharray={`${(momentum.momentumScore / 100) * 565.48} 565.48`}
                  strokeLinecap="round"
                  transform="rotate(-90 100 100)"
                  style={{ transition: 'stroke-dasharray 0.3s ease' }}
                />

                {/* Center text */}
                <text x="100" y="90" textAnchor="middle" className="text-3xl font-bold fill-white">
                  {momentum.momentumScore.toFixed(0)}
                </text>
                <text x="100" y="115" textAnchor="middle" className="text-xs fill-slate-400">
                  Momentum
                </text>
              </svg>

              {/* Absolute center icon */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-4xl font-bold text-white mb-1">
                    {momentum.momentumScore.toFixed(0)}
                  </div>
                </div>
              </div>
            </div>

            {/* Direction Badge */}
            <div className={`flex items-center gap-2 px-4 py-2 rounded-lg bg-${color}-900/30 border border-${color}-700`}>
              {getDirectionIcon(momentum.momentumDirection)}
              <span className={`font-semibold ${colorClass}`}>
                {momentum.momentumDirection}
              </span>
            </div>
          </div>

          {/* Right: Key Metrics */}
          <div className="space-y-4">
            {/* Momentum Strength */}
            <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
              <div className="flex justify-between items-center mb-3">
                <p className="text-slate-400 text-sm uppercase tracking-wide">Strength</p>
                <span className="text-white font-semibold">
                  {(momentum.momentumStrength * 100).toFixed(0)}%
                </span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-3">
                <div
                  className="bg-gradient-to-r from-emerald-500 to-emerald-400 h-3 rounded-full transition-all duration-300"
                  style={{ width: `${momentum.momentumStrength * 100}%` }}
                />
              </div>
            </div>

            {/* Velocity */}
            <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
              <div className="flex justify-between items-center">
                <p className="text-slate-400 text-sm uppercase tracking-wide">Velocity</p>
                <div className="text-right">
                  <p className="text-white font-semibold">{momentum.trendVelocity.toFixed(4)}</p>
                  <p className="text-xs text-slate-400">Price/Bar</p>
                </div>
              </div>
            </div>

            {/* Acceleration */}
            <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
              <div className="flex justify-between items-center">
                <p className="text-slate-400 text-sm uppercase tracking-wide">Acceleration</p>
                <div className="text-right">
                  <p className="text-white font-semibold">{momentum.trendAcceleration.toFixed(4)}</p>
                  <p className="text-xs text-slate-400">Change/Bar</p>
                </div>
              </div>
            </div>

            {/* ATR */}
            <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
              <div className="flex justify-between items-center">
                <p className="text-slate-400 text-sm uppercase tracking-wide">ATR Volatility</p>
                <div className="text-right">
                  <p className="text-white font-semibold">{momentum.atr.toFixed(2)}</p>
                  <p className="text-xs text-slate-400">{momentum.atrPercentage.toFixed(2)}%</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Detailed Indicators Section */}
        {showDetails && (
          <div className="mt-8 pt-8 border-t border-slate-700">
            <h4 className="text-white font-semibold mb-4">Indicator Details</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* RSI */}
              <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
                <p className="text-slate-400 text-sm uppercase tracking-wide mb-3">RSI (14)</p>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-white font-bold text-2xl">{momentum.rsi.toFixed(0)}</span>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${
                        momentum.rsi > 70 ? 'bg-red-500' : momentum.rsi > 50 ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${momentum.rsi}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Oversold (30)</span>
                    <span>Overbought (70)</span>
                  </div>
                  <div className="pt-2 border-t border-slate-600 text-xs text-slate-400">
                    {momentum.rsi > 70
                      ? '⚠️ Overbought'
                      : momentum.rsi < 30
                      ? '⚠️ Oversold'
                      : '✓ Neutral'}
                  </div>
                </div>
              </div>

              {/* MACD */}
              <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
                <p className="text-slate-400 text-sm uppercase tracking-wide mb-3">MACD</p>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-white font-bold text-2xl">
                      {momentum.macdHistogram.toFixed(4)}
                    </span>
                  </div>
                  <div className={`text-center py-3 rounded ${
                    momentum.macdHistogram > 0
                      ? 'bg-emerald-900/30 border border-emerald-700'
                      : 'bg-red-900/30 border border-red-700'
                  }`}>
                    <p className={`text-sm font-semibold ${
                      momentum.macdHistogram > 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      {momentum.macdHistogram > 0 ? '📈 Bullish' : '📉 Bearish'}
                    </p>
                  </div>
                  <p className="text-xs text-slate-400 text-center">Momentum Indicator</p>
                </div>
              </div>

              {/* Momentum Classification */}
              <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
                <p className="text-slate-400 text-sm uppercase tracking-wide mb-3">Classification</p>
                <div className="space-y-2">
                  <div className={`px-3 py-2 rounded text-center font-semibold ${
                    momentum.momentumScore > 60
                      ? 'bg-emerald-900/30 text-emerald-400'
                      : momentum.momentumScore > 40
                      ? 'bg-amber-900/30 text-amber-400'
                      : 'bg-red-900/30 text-red-400'
                  }`}>
                    {momentum.momentumScore > 60
                      ? 'Strong'
                      : momentum.momentumScore > 40
                      ? 'Moderate'
                      : 'Weak'}
                  </div>
                  <p className="text-xs text-slate-400 text-center">
                    {momentum.momentumDirection === 'UP'
                      ? '⬆️ Moving Up'
                      : momentum.momentumDirection === 'DOWN'
                      ? '⬇️ Moving Down'
                      : '➡️ Consolidating'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Toggle Details Button */}
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="mt-6 w-full text-center text-slate-400 hover:text-slate-300 text-sm uppercase tracking-wide transition"
        >
          {showDetails ? 'Hide Details' : 'Show Indicator Details'}
        </button>
      </div>

      {/* Momentum Strength Levels */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
        <h3 className="text-white font-semibold mb-4">Momentum Levels</h3>
        <div className="space-y-3">
          {[
            { label: 'Very Strong', min: 80, max: 100, color: 'emerald' },
            { label: 'Strong', min: 60, max: 80, color: 'teal' },
            { label: 'Moderate', min: 50, max: 60, color: 'amber' },
            { label: 'Weak', min: 40, max: 50, color: 'orange' },
            { label: 'Very Weak', min: 0, max: 40, color: 'red' },
          ].map((level, idx) => {
            const isActive = momentum.momentumScore >= level.min && momentum.momentumScore < level.max;
            return (
              <div
                key={idx}
                className={`flex items-center gap-3 p-3 rounded-lg border ${
                  isActive
                    ? `bg-${level.color}-900/30 border-${level.color}-700`
                    : 'bg-slate-700/30 border-slate-600'
                }`}
              >
                <div
                  className={`w-3 h-3 rounded-full ${isActive ? `bg-${level.color}-400` : 'bg-slate-600'}`}
                />
                <div className="flex-1">
                  <p className={`font-semibold ${isActive ? `text-${level.color}-400` : 'text-slate-400'}`}>
                    {level.label}
                  </p>
                  <p className="text-xs text-slate-500">{level.min}-{level.max}</p>
                </div>
                {isActive && <Zap className="w-4 h-4 text-amber-400" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default MomentumMeterPanel;
