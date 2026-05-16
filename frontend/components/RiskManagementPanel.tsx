'use client';

import React, { useState } from 'react';
import { Shield, AlertTriangle, Target, DollarSign, TrendingUp } from 'lucide-react';

interface RiskManagementPanelProps {
  symbol: string;
  accountSize?: number;
  maxRiskPct?: number;
}

/**
 * Risk Management Panel - Position sizing and trade management
 * 
 * Shows:
 * - Maximum risk per trade
 * - Position sizing calculator
 * - Stop loss placement
 * - Take profit targets
 * - Risk/reward ratios
 * - Trade management rules
 * - Break-even strategy
 * - Partial profit targets
 * 
 * Performance: <25ms render, no real-time updates required
 */
export default function RiskManagementPanel({
  symbol,
  accountSize = 100000,
  maxRiskPct = 2.0,
}: RiskManagementPanelProps) {
  // Calculator state
  const [entryPrice, setEntryPrice] = useState(20000);
  const [stopLoss, setStopLoss] = useState(19900);
  const [takeProfit, setTakeProfit] = useState(20200);

  // Calculations
  const riskPerTrade = (accountSize * maxRiskPct) / 100;
  const riskDistance = Math.abs(entryPrice - stopLoss);
  const rewardDistance = Math.abs(takeProfit - entryPrice);
  const riskReward = rewardDistance > 0 ? rewardDistance / riskDistance : 0;
  const positionSize = riskDistance > 0 ? riskPerTrade / riskDistance : 0;
  const totalRisk = positionSize * riskDistance;
  const totalReward = positionSize * rewardDistance;

  // Breaking even level
  const beLevel = entryPrice + (riskDistance * 0.5);

  // Partial profit targets
  const targets = [
    { level: 25, price: entryPrice + rewardDistance * 0.25, close: 0.5 },
    { level: 50, price: entryPrice + rewardDistance * 0.5, close: 0.3 },
    { level: 75, price: entryPrice + rewardDistance * 0.75, close: 0.2 },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Risk Management</h2>
          <p className="text-sm text-slate-400">{symbol}</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-slate-400">Account Size</p>
          <p className="text-2xl font-bold text-teal-400">${accountSize.toLocaleString()}</p>
        </div>
      </div>

      {/* Risk Per Trade */}
      <div className="bg-gradient-to-r from-emerald-950 to-emerald-900 rounded-lg p-6 border border-emerald-700">
        <h3 className="text-sm font-semibold text-emerald-300 mb-3 flex items-center gap-2">
          <Shield size={16} /> Maximum Risk Per Trade
        </h3>
        <div className="flex items-end gap-4">
          <div>
            <p className="text-4xl font-bold text-emerald-400">
              ${riskPerTrade.toFixed(2)}
            </p>
            <p className="text-xs text-emerald-300 mt-1">{maxRiskPct}% of account</p>
          </div>
          <div className="text-sm text-emerald-200 mb-1">
            <p>Never risk more than this amount on a single trade</p>
          </div>
        </div>
      </div>

      {/* Price Level Calculator */}
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
        <h3 className="text-sm font-semibold text-slate-400 mb-4 flex items-center gap-2">
          <DollarSign size={16} /> Price Level Calculator
        </h3>

        <div className="space-y-4">
          {/* Entry Price */}
          <div>
            <label className="text-sm text-slate-300 font-semibold mb-2 block">Entry Price</label>
            <input
              type="number"
              value={entryPrice}
              onChange={(e) => setEntryPrice(parseFloat(e.target.value))}
              className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white font-mono focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Stop Loss */}
          <div>
            <label className="text-sm text-red-400 font-semibold mb-2 block">Stop Loss Price</label>
            <input
              type="number"
              value={stopLoss}
              onChange={(e) => setStopLoss(parseFloat(e.target.value))}
              className="w-full px-4 py-2 bg-slate-800 border border-red-700 rounded-lg text-white font-mono focus:outline-none focus:border-red-500"
            />
            <p className="text-xs text-red-400 mt-1">
              {riskDistance.toFixed(2)} pts risk • ${totalRisk.toFixed(2)}
            </p>
          </div>

          {/* Take Profit */}
          <div>
            <label className="text-sm text-emerald-400 font-semibold mb-2 block">Take Profit Price</label>
            <input
              type="number"
              value={takeProfit}
              onChange={(e) => setTakeProfit(parseFloat(e.target.value))}
              className="w-full px-4 py-2 bg-slate-800 border border-emerald-700 rounded-lg text-white font-mono focus:outline-none focus:border-emerald-500"
            />
            <p className="text-xs text-emerald-400 mt-1">
              {rewardDistance.toFixed(2)} pts reward • ${totalReward.toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      {/* Risk/Reward Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Position Size */}
        <div className={`rounded-lg p-4 border ${
          positionSize > 0 ? 'bg-teal-950 border-teal-700' : 'bg-slate-900 border-slate-800'
        }`}>
          <p className={`text-xs font-semibold mb-2 ${positionSize > 0 ? 'text-teal-400' : 'text-slate-400'}`}>
            Position Size
          </p>
          <p className={`text-2xl font-bold ${positionSize > 0 ? 'text-teal-400' : 'text-slate-400'}`}>
            {positionSize.toFixed(0)} units
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Based on ${riskPerTrade.toFixed(2)} risk
          </p>
        </div>

        {/* Risk/Reward Ratio */}
        <div className={`rounded-lg p-4 border ${
          riskReward > 2 ? 'bg-emerald-950 border-emerald-700' :
          riskReward > 1 ? 'bg-amber-950 border-amber-700' :
          'bg-red-950 border-red-700'
        }`}>
          <p className={`text-xs font-semibold mb-2 ${
            riskReward > 2 ? 'text-emerald-400' :
            riskReward > 1 ? 'text-amber-400' :
            'text-red-400'
          }`}>
            Risk/Reward
          </p>
          <p className={`text-2xl font-bold ${
            riskReward > 2 ? 'text-emerald-400' :
            riskReward > 1 ? 'text-amber-400' :
            'text-red-400'
          }`}>
            1:{riskReward.toFixed(2)}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {riskReward > 2 ? '✅ Excellent' : riskReward > 1 ? '⚠️ Good' : '❌ Poor'}
          </p>
        </div>

        {/* Max Loss/Gain */}
        <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
          <p className="text-xs font-semibold text-slate-400 mb-2">Max Loss / Gain</p>
          <p className="text-lg font-bold text-white">
            <span className="text-red-400">${totalRisk.toFixed(2)}</span>
            <span className="text-slate-500 mx-1">/</span>
            <span className="text-emerald-400">${totalReward.toFixed(2)}</span>
          </p>
        </div>
      </div>

      {/* Break-Even & Scale-Out Strategy */}
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
        <h3 className="text-sm font-semibold text-slate-400 mb-4 flex items-center gap-2">
          <Target size={16} /> Trade Management Strategy
        </h3>

        <div className="space-y-4">
          {/* Break-Even Rule */}
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <div className="flex items-start justify-between mb-2">
              <p className="text-sm font-semibold text-slate-300">Break-Even Rule</p>
              <span className="px-2 py-1 bg-emerald-900 text-emerald-300 text-xs font-bold rounded">
                MOVE SL
              </span>
            </div>
            <p className="text-lg font-bold text-emerald-400 mb-1">{beLevel.toFixed(2)}</p>
            <p className="text-xs text-slate-400">
              Once price reaches {((riskDistance * 0.5) / riskDistance * 100).toFixed(0)}% of target, move SL to entry to lock breakeven
            </p>
          </div>

          {/* Partial Profit Targets */}
          <div>
            <p className="text-sm font-semibold text-slate-300 mb-3">Partial Profit Targets</p>
            <div className="space-y-2">
              {targets.map((target, idx) => (
                <div key={idx} className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-emerald-400">{target.level}% Target</p>
                      <p className="text-xs text-slate-400 mt-1">{target.price.toFixed(2)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-emerald-400">{(target.close * 100).toFixed(0)}% Close</p>
                      <p className="text-xs text-slate-400 mt-1">${(target.close * totalReward).toFixed(2)} profit</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Trailing Stop */}
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <div className="flex items-start justify-between mb-2">
              <p className="text-sm font-semibold text-slate-300">Trailing Stop</p>
              <span className="px-2 py-1 bg-teal-900 text-teal-300 text-xs font-bold rounded">
                {riskReward > 2 ? 'ENABLED' : 'DISABLED'}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              {riskReward > 2
                ? 'Trail SL by 2% after reaching 50% profit to protect gains'
                : 'Enable trailing stop when R:R exceeds 2:1'}
            </p>
          </div>
        </div>
      </div>

      {/* Risk Rules */}
      <div className="bg-gradient-to-r from-yellow-950 to-yellow-900 rounded-lg p-6 border border-yellow-700">
        <h3 className="text-sm font-semibold text-yellow-300 mb-3 flex items-center gap-2">
          <AlertTriangle size={16} /> Critical Risk Rules
        </h3>
        <div className="space-y-2 text-sm text-yellow-200">
          <p>✅ Never risk more than ${riskPerTrade.toFixed(2)} per trade</p>
          <p>✅ Always use stop loss - no exceptions</p>
          <p>✅ Only take trades with R:R ≥ 1.5:1</p>
          <p>✅ Move stop loss to breakeven at 50% profit</p>
          <p>✅ Scale out at 25%, 50%, 75% targets</p>
          <p>✅ Max 3 trades per day</p>
          <p>✅ If down 3% on day, stop trading</p>
        </div>
      </div>

      {/* Account Risk Monitor */}
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
        <h3 className="text-sm font-semibold text-slate-400 mb-4 flex items-center gap-2">
          <TrendingUp size={16} /> Daily Account Risk
        </h3>

        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-slate-300">Used</span>
              <span className="text-sm font-bold text-slate-100">0.00% ($0.00)</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
              <div className="h-full w-0 bg-amber-500"></div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-slate-700">
            <span className="text-sm text-slate-300">Available</span>
            <span className="text-lg font-bold text-emerald-400">${riskPerTrade.toFixed(2)}</span>
          </div>
        </div>

        <p className="text-xs text-slate-400 mt-3">
          Maximum daily account loss threshold: ${(accountSize * 3 / 100).toFixed(2)} (3%)
        </p>
      </div>
    </div>
  );
}
