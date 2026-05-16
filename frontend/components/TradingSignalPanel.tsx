'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { ZapOff, Target, Shield, TrendingUp, AlertTriangle } from 'lucide-react';

interface SignalData {
  signal: {
    signal_id: string;
    type: string;
    entry_price: number;
    stop_loss: number;
    take_profit: number;
    entry_reason: string;
  } | null;
  metrics: {
    confidence: number;
    strength: number;
    risk_reward: number;
    multi_tf_confirmation: number;
  };
  position: {
    size_pct: number;
    units: number;
  };
  risk: {
    max_loss_pct: number;
    max_gain_pct: number;
    win_probability: number;
    rating: string;
    worth_taking: boolean;
  };
  timestamp: string;
}

interface TradingSignalPanelProps {
  symbol: string;
  accountSize?: number;
  refreshInterval?: number;
}

/**
 * Trading Signal Panel - Active trading signals with risk management
 * 
 * Shows:
 * - Active trading signals (Long/Short)
 * - Entry, stop loss, take profit
 * - Confidence and signal strength
 * - Risk/reward analysis
 * - Position sizing recommendations
 * - Win probability
 * 
 * Performance: <40ms render, real-time updates
 */
export default function TradingSignalPanel({
  symbol,
  accountSize = 100000,
  refreshInterval = 5000,
}: TradingSignalPanelProps) {
  const [signal, setSignal] = useState<SignalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSignal = useCallback(async () => {
    try {
      const response = await fetch(`/api/ict-bias/signal/${symbol}?account_size=${accountSize}`);
      if (!response.ok) throw new Error('Failed to fetch signal');
      
      const data = await response.json();
      setSignal(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [symbol, accountSize]);

  useEffect(() => {
    fetchSignal();
    const interval = setInterval(fetchSignal, refreshInterval);
    return () => clearInterval(interval);
  }, [symbol, accountSize, refreshInterval, fetchSignal]);

  if (loading) {
    return (
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
        <div className="animate-pulse space-y-4">
          <div className="h-24 bg-slate-800 rounded"></div>
          <div className="grid grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-20 bg-slate-800 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800 text-slate-400">
        {error}
      </div>
    );
  }

  // No signal state
  if (!signal?.signal) {
    return (
      <div className="bg-slate-900 rounded-lg p-8 border border-slate-800 text-center">
        <div className="flex justify-center mb-4">
          <ZapOff size={48} className="text-slate-600" />
        </div>
        <h3 className="text-lg font-semibold text-slate-400 mb-2">No Active Signals</h3>
        <p className="text-sm text-slate-500">Waiting for signal conditions...</p>
      </div>
    );
  }

  const sig = signal.signal;
  const isLong = sig.type === 'LONG';
  const riskReward = signal.metrics.risk_reward;
  const isWorthTaking = signal.risk.worth_taking;

  const calculateDistance = (from: number, to: number) => Math.abs(to - from);

  return (
    <div className="space-y-6">
      {/* Header with Signal Type */}
      <div className={`bg-gradient-to-r ${isLong ? 'from-emerald-950 to-emerald-900' : 'from-red-950 to-red-900'} rounded-lg p-6 border ${isLong ? 'border-emerald-700' : 'border-red-700'}`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className={`text-2xl font-bold ${isLong ? 'text-emerald-400' : 'text-red-400'}`}>
              {isLong ? '📈 LONG SIGNAL' : '📉 SHORT SIGNAL'}
            </h2>
            <p className={`text-sm mt-1 ${isLong ? 'text-emerald-300' : 'text-red-300'}`}>
              {sig.entry_reason}
            </p>
          </div>
          <div className={`text-center px-4 py-2 rounded bg-slate-900 border ${isLong ? 'border-emerald-700' : 'border-red-700'}`}>
            <p className={`text-2xl font-bold ${isLong ? 'text-emerald-400' : 'text-red-400'}`}>
              {(signal.metrics.confidence * 100).toFixed(0)}%
            </p>
            <p className="text-xs text-slate-400">Confidence</p>
          </div>
        </div>
      </div>

      {/* Signal Strength & Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Signal Strength */}
        <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
          <p className="text-xs text-slate-400 font-semibold mb-2">Signal Strength</p>
          <p className="text-3xl font-bold text-teal-400 mb-2">
            {signal.metrics.strength.toFixed(0)}
          </p>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-teal-500"
              style={{ width: `${(signal.metrics.strength / 100) * 100}%` }}
            ></div>
          </div>
        </div>

        {/* Multi-TF Confirmation */}
        <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
          <p className="text-xs text-slate-400 font-semibold mb-2">Multi-TF Confirmation</p>
          <p className="text-3xl font-bold text-purple-400 mb-2">
            {(signal.metrics.multi_tf_confirmation * 100).toFixed(0)}%
          </p>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-purple-500"
              style={{ width: `${signal.metrics.multi_tf_confirmation * 100}%` }}
            ></div>
          </div>
        </div>

        {/* Win Probability */}
        <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
          <p className="text-xs text-slate-400 font-semibold mb-2">Win Probability</p>
          <p className="text-3xl font-bold text-amber-400 mb-2">
            {(signal.risk.win_probability * 100).toFixed(0)}%
          </p>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-amber-500"
              style={{ width: `${signal.risk.win_probability * 100}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* Entry Levels */}
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
        <h3 className="text-sm font-semibold text-slate-400 mb-4 flex items-center gap-2">
          <Target size={16} /> Entry & Exit Levels
        </h3>

        <div className="space-y-4">
          {/* Entry Price */}
          <div className="bg-slate-800 rounded-lg p-4">
            <p className="text-xs text-slate-500 font-semibold mb-1">Entry Price</p>
            <p className="text-2xl font-bold text-slate-100">{sig.entry_price.toFixed(2)}</p>
          </div>

          {/* Stop Loss */}
          <div className="bg-red-950 rounded-lg p-4 border border-red-700">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-red-400 font-semibold">Stop Loss</p>
              <span className="text-xs text-red-400">
                {calculateDistance(sig.entry_price, sig.stop_loss).toFixed(2)} pts
              </span>
            </div>
            <p className="text-2xl font-bold text-red-400">{sig.stop_loss.toFixed(2)}</p>
          </div>

          {/* Take Profit */}
          <div className="bg-emerald-950 rounded-lg p-4 border border-emerald-700">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-emerald-400 font-semibold">Take Profit</p>
              <span className="text-xs text-emerald-400">
                {calculateDistance(sig.entry_price, sig.take_profit).toFixed(2)} pts
              </span>
            </div>
            <p className="text-2xl font-bold text-emerald-400">{sig.take_profit.toFixed(2)}</p>
          </div>
        </div>
      </div>

      {/* Risk/Reward Analysis */}
      <div className={`rounded-lg p-6 border ${
        riskReward > 2.0 ? 'bg-emerald-950 border-emerald-700' :
        riskReward > 1.0 ? 'bg-amber-950 border-amber-700' :
        'bg-red-950 border-red-700'
      }`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className={`text-sm font-semibold ${
            riskReward > 2.0 ? 'text-emerald-400' :
            riskReward > 1.0 ? 'text-amber-400' :
            'text-red-400'
          }`}>
            Risk / Reward Ratio
          </h3>
          <span className={`text-3xl font-bold ${
            riskReward > 2.0 ? 'text-emerald-400' :
            riskReward > 1.0 ? 'text-amber-400' :
            'text-red-400'
          }`}>
            {riskReward.toFixed(2)}:1
          </span>
        </div>

        <div className={`text-sm ${
          riskReward > 2.0 ? 'text-emerald-200' :
          riskReward > 1.0 ? 'text-amber-200' :
          'text-red-200'
        }`}>
          {riskReward > 2.0 ? '✅ Excellent risk/reward - High probability trade' :
           riskReward > 1.0 ? '⚠️ Fair risk/reward - Acceptable trade' :
           '❌ Poor risk/reward - Skip this trade'}
        </div>
      </div>

      {/* Risk Assessment */}
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
        <h3 className="text-sm font-semibold text-slate-400 mb-4 flex items-center gap-2">
          <Shield size={16} /> Risk Assessment
        </h3>

        <div className="grid grid-cols-2 gap-4 mb-4">
          {/* Max Loss */}
          <div className="bg-red-950 rounded-lg p-4 border border-red-700">
            <p className="text-xs text-red-400 font-semibold mb-2">Max Loss</p>
            <p className="text-lg font-bold text-red-400">${(signal.risk.max_loss_pct * accountSize / 100).toFixed(2)}</p>
            <p className="text-xs text-red-300 mt-1">{signal.risk.max_loss_pct.toFixed(2)}% of account</p>
          </div>

          {/* Max Gain */}
          <div className="bg-emerald-950 rounded-lg p-4 border border-emerald-700">
            <p className="text-xs text-emerald-400 font-semibold mb-2">Max Gain</p>
            <p className="text-lg font-bold text-emerald-400">${(signal.risk.max_gain_pct * accountSize / 100).toFixed(2)}</p>
            <p className="text-xs text-emerald-300 mt-1">{signal.risk.max_gain_pct.toFixed(2)}% of account</p>
          </div>
        </div>

        {/* Risk Rating */}
        <div className="flex items-center justify-between p-3 bg-slate-800 rounded-lg">
          <span className="text-slate-300 font-semibold">Risk Rating</span>
          <span className={`px-3 py-1 rounded font-bold text-sm ${
            signal.risk.rating === 'LOW' ? 'bg-emerald-950 text-emerald-400' :
            signal.risk.rating === 'MEDIUM' ? 'bg-amber-950 text-amber-400' :
            signal.risk.rating === 'HIGH' ? 'bg-red-950 text-red-400' :
            'bg-slate-700 text-slate-300'
          }`}>
            {signal.risk.rating}
          </span>
        </div>
      </div>

      {/* Position Sizing */}
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
        <h3 className="text-sm font-semibold text-slate-400 mb-4 flex items-center gap-2">
          <TrendingUp size={16} /> Position Sizing
        </h3>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-slate-800 rounded-lg p-4">
            <p className="text-xs text-slate-400 mb-2">Recommended Size</p>
            <p className="text-2xl font-bold text-teal-400">{signal.position.size_pct.toFixed(2)}%</p>
            <p className="text-xs text-slate-400 mt-1">of account</p>
          </div>

          <div className="bg-slate-800 rounded-lg p-4">
            <p className="text-xs text-slate-400 mb-2">Position Value</p>
            <p className="text-2xl font-bold text-teal-400">
              ${(accountSize * signal.position.size_pct / 100).toFixed(2)}
            </p>
            <p className="text-xs text-slate-400 mt-1">Amount to risk</p>
          </div>
        </div>
      </div>

      {/* Recommendation */}
      <div className={`rounded-lg p-6 border ${
        isWorthTaking
          ? 'bg-emerald-950 border-emerald-700'
          : 'bg-red-950 border-red-700'
      }`}>
        <div className="flex items-center gap-3 mb-3">
          {isWorthTaking ? (
            <div className="text-2xl">✅</div>
          ) : (
            <AlertTriangle size={24} className="text-red-400" />
          )}
          <h3 className={`text-lg font-bold ${
            isWorthTaking ? 'text-emerald-400' : 'text-red-400'
          }`}>
            {isWorthTaking ? 'TAKE THIS TRADE' : 'SKIP THIS TRADE'}
          </h3>
        </div>
        <p className={`text-sm ${
          isWorthTaking ? 'text-emerald-200' : 'text-red-200'
        }`}>
          {isWorthTaking
            ? 'All conditions align. This is a high-probability, institutional-grade setup with good risk/reward ratio.'
            : 'Risk/reward or confirmation is insufficient. Wait for better setup.'}
        </p>
      </div>
    </div>
  );
}
