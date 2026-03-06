'use client';

import React, { useMemo } from 'react';

/**
 * Advanced 5-Minute Prediction Display Component
 * 
 * Visualizes sophisticated micro-trend detection:
 * - Micro-momentum acceleration analysis
 * - Liquidity inflow/outflow flow
 * - Potential reversal signals
 * - Order flow imbalance
 * 
 * Designed to work within LiquidityIntelligence component
 */

interface MicroMomentum {
  trend: string;        // ACCELERATING_UP, ACCELERATING_DOWN, DECELERATING, STABLE
  strength: number;     // 0-100
  acceleration: number;
  volatility: number;
}

interface LiquidityFlowData {
  net_flow: number;
  inflow_pressure: number;    // 0-100
  outflow_pressure: number;   // 0-100
  shift_detected: boolean;
  shift_direction: string;    // INFLOW, OUTFLOW, NONE
}

interface ReversalAnalysis {
  likely: boolean;
  confidence: number;          // 0-100
  reason: string;
  type: string;               // MOMENTUM_DIVERGENCE, LIQUIDITY_SHIFT, EXHAUSTION, PCR_EXTREME
  current_direction: string;
  potential_reverse_to: string;
}

interface Advanced5mPrediction {
  prediction: string;         // STRONG_BUY, BUY, NEUTRAL, SELL, STRONG_SELL
  confidence: number;         // 40-92
  base_score: number;
  advanced_score: number;
  momentum_boost: number;
  reversal_penalty: number;
  flow_penalty: number;
  micro_signals: {
    oi_momentum: MicroMomentum;
    price_momentum: MicroMomentum;
    pcr_momentum: MicroMomentum;
  };
  liquidity_flow: LiquidityFlowData;
  reversal_analysis: ReversalAnalysis;
  timestamp: string;
}

interface Advanced5mPredictionViewProps {
  data: Advanced5mPrediction | undefined;
  symbol: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────────

function getTrendIcon(trend: string): string {
  if (trend === 'ACCELERATING_UP') return '📈';
  if (trend === 'ACCELERATING_DOWN') return '📉';
  if (trend === 'DECELERATING') return '⏱️';
  if (trend === 'STABLE') return '➡️';
  return '⚪';
}

function getTrendColor(trend: string): string {
  if (trend === 'ACCELERATING_UP') return 'text-emerald-400';
  if (trend === 'ACCELERATING_DOWN') return 'text-red-400';
  if (trend === 'DECELERATING') return 'text-amber-400';
  return 'text-slate-400';
}

function getFlowColor(pressure: number): string {
  if (pressure > 70) return 'text-emerald-400';
  if (pressure > 55) return 'text-cyan-400';
  if (pressure < 30) return 'text-red-400';
  if (pressure < 45) return 'text-orange-400';
  return 'text-slate-400';
}

function getReversalTypeLabel(type: string): { icon: string; label: string; color: string } {
  switch (type) {
    case 'MOMENTUM_DIVERGENCE':
      return { icon: '⚠️', label: 'Momentum Divergence', color: 'text-amber-400' };
    case 'LIQUIDITY_SHIFT':
      return { icon: '💧', label: 'Liquidity Shift', color: 'text-cyan-400' };
    case 'EXHAUSTION':
      return { icon: '😴', label: 'Momentum Exhaustion', color: 'text-orange-400' };
    case 'PCR_EXTREME':
      return { icon: '🔝', label: 'PCR Extreme', color: 'text-rose-400' };
    default:
      return { icon: '❓', label: 'Unknown', color: 'text-slate-400' };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// SUBCOMPONENT: Micro-Momentum Card
// ──────────────────────────────────────────────────────────────────────────────

function MicroMomentumCard({
  label,
  data,
}: {
  label: string;
  data: MicroMomentum;
}) {
  return (
    <div className="rounded-lg bg-slate-800/40 border border-slate-700/30 px-2.5 py-2">
      <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1">
        {getTrendIcon(data.trend)} {label}
      </div>
      <div className="space-y-1">
        <div className="flex justify-between items-center">
          <span className={`text-[9px] font-semibold ${getTrendColor(data.trend)}`}>
            {data.trend.replace(/_/g, ' ')}
          </span>
          <span className="text-[9px] text-slate-500">{data.strength}% force</span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-700/50 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              data.trend.includes('UP')
                ? 'bg-emerald-400'
                : data.trend.includes('DOWN')
                  ? 'bg-red-400'
                  : 'bg-slate-500'
            }`}
            style={{ width: `${data.strength}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SUBCOMPONENT: Liquidity Flow Card
// ──────────────────────────────────────────────────────────────────────────────

function LiquidityFlowCard({ data }: { data: LiquidityFlowData }) {
  return (
    <div className="rounded-lg bg-slate-800/40 border border-slate-700/30 px-2.5 py-2">
      <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-2">
        💧 Liquidity Flow
      </div>

      {/* Inflow vs Outflow Pressure */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        {/* Inflow */}
        <div className="text-center">
          <div className="text-[8px] text-slate-500 mb-1">Inflow</div>
          <div className={`text-[11px] font-black ${getFlowColor(data.inflow_pressure)}`}>
            {data.inflow_pressure}%
          </div>
          <div className="h-1 rounded-full bg-slate-700/50 overflow-hidden mt-0.5">
            <div
              className="h-full bg-emerald-400/60 rounded-full"
              style={{ width: `${data.inflow_pressure}%` }}
            />
          </div>
        </div>

        {/* Outflow */}
        <div className="text-center">
          <div className="text-[8px] text-slate-500 mb-1">Outflow</div>
          <div className={`text-[11px] font-black ${getFlowColor(100 - data.outflow_pressure)}`}>
            {data.outflow_pressure}%
          </div>
          <div className="h-1 rounded-full bg-slate-700/50 overflow-hidden mt-0.5">
            <div
              className="h-full bg-red-400/60 rounded-full"
              style={{ width: `${data.outflow_pressure}%` }}
            />
          </div>
        </div>
      </div>

      {/* Shift Detection */}
      {data.shift_detected && (
        <div
          className={`text-[8px] font-bold px-1.5 py-1 rounded text-center ${
            data.shift_direction === 'INFLOW'
              ? 'bg-emerald-500/20 text-emerald-300'
              : 'bg-red-500/20 text-red-300'
          }`}
        >
          🔄 {data.shift_direction} DETECTED
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SUBCOMPONENT: Reversal Alert
// ──────────────────────────────────────────────────────────────────────────────

function ReversalAlertCard({ data }: { data: ReversalAnalysis }) {
  const typeInfo = getReversalTypeLabel(data.type);

  if (!data.likely && data.confidence < 40) {
    return (
      <div className="rounded-lg bg-slate-800/40 border border-slate-700/30 px-2.5 py-2">
        <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1">
          🛡️ Reversal Monitor
        </div>
        <div className="text-[9px] text-slate-500">
          No reversal signals · Trend is holding
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border px-2.5 py-2 ${
        data.confidence >= 70
          ? 'bg-rose-900/20 border-rose-500/40'
          : 'bg-amber-900/20 border-amber-500/40'
      }`}
    >
      <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
        {typeInfo.icon} {typeInfo.label}
      </div>

      <div className="space-y-1.5">
        {/* Confidence Bar */}
        <div className="flex items-center justify-between">
          <span className={`text-[9px] font-bold ${typeInfo.color}`}>
            {data.confidence}% Risk
          </span>
          <span className="text-[8px] text-slate-500">
            {data.potential_reverse_to === 'BEARISH' ? '↓ May turn DOWN' : '↑ May turn UP'}
          </span>
        </div>
        <div className="h-1 rounded-full bg-slate-700/50 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              data.confidence >= 70 ? 'bg-rose-400' : 'bg-amber-400'
            }`}
            style={{ width: `${data.confidence}%` }}
          />
        </div>

        {/* Reason */}
        <p className="text-[8px] text-slate-400 leading-tight pt-1">
          {data.reason}
        </p>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT: Advanced 5-Min Prediction View
// ──────────────────────────────────────────────────────────────────────────────

export function Advanced5mPredictionView({
  data,
  symbol,
}: Advanced5mPredictionViewProps) {
  const predictionColor = useMemo(() => {
    const pred = data?.prediction;
    if (pred === 'STRONG_BUY') return 'text-emerald-400';
    if (pred === 'BUY') return 'text-cyan-400';
    if (pred === 'STRONG_SELL') return 'text-red-400';
    if (pred === 'SELL') return 'text-orange-400';
    return 'text-slate-400';
  }, [data?.prediction]);

  const predictionBg = useMemo(() => {
    const pred = data?.prediction;
    if (pred === 'STRONG_BUY') return 'bg-emerald-900/15 border-emerald-500/30';
    if (pred === 'BUY') return 'bg-cyan-900/15 border-cyan-500/30';
    if (pred === 'STRONG_SELL') return 'bg-red-900/15 border-red-500/30';
    if (pred === 'SELL') return 'bg-orange-900/15 border-orange-500/30';
    return 'bg-slate-800/20 border-slate-600/30';
  }, [data?.prediction]);

  if (!data) {
    return (
      <div className="rounded-lg bg-slate-800/40 border border-slate-700/30 px-3 py-2">
        <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1">
          🔮 Advanced 5-Min Analysis
        </div>
        <p className="text-[9px] text-slate-600">Loading micro-trend data...</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Main Prediction Header */}
      <div className={`rounded-lg border px-3 py-2.5 ${predictionBg}`}>
        <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
          🔮 Advanced 5-Min Prediction
        </div>

        <div className="flex items-center justify-between gap-2">
          <div>
            <div className={`text-sm font-black ${predictionColor}`}>
              {data.prediction}
            </div>
            <p className="text-[8px] text-slate-500 mt-0.5">
              {data.confidence >= 70
                ? 'High conviction'
                : data.confidence >= 55
                  ? 'Moderate signal'
                  : 'Uncertain'}
            </p>
          </div>

          <div className="text-right">
            <div className={`text-2xl font-black ${predictionColor}`}>{data.confidence}%</div>
            <p className="text-[8px] text-slate-500 font-bold uppercase">Confidence</p>
          </div>
        </div>

        {/* Confidence Bar */}
        <div className="h-1 bg-slate-700/50 rounded-full overflow-hidden mt-1.5">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              data.prediction === 'STRONG_BUY' || data.prediction === 'STRONG_SELL'
                ? 'bg-gradient-to-r from-emerald-400 to-cyan-400'
                : data.prediction === 'BUY'
                  ? 'bg-cyan-400'
                  : data.prediction === 'SELL'
                    ? 'bg-orange-400'
                    : 'bg-slate-500'
            }`}
            style={{ width: `${data.confidence}%` }}
          />
        </div>
      </div>

      {/* Scoring Breakdown */}
      <div className="rounded-lg bg-slate-800/40 border border-slate-700/30 px-2.5 py-2">
        <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
          📊 Score Analysis
        </div>

        <div className="grid grid-cols-2 gap-1.5 text-[8px]">
          <div className="bg-slate-900/50 rounded px-1.5 py-1">
            <div className="text-slate-500 mb-0.5">Base Score</div>
            <div className="text-slate-300 font-bold">
              {(data.base_score * 100).toFixed(0)}
            </div>
          </div>

          <div className="bg-slate-900/50 rounded px-1.5 py-1">
            <div className="text-slate-500 mb-0.5">Advanced Score</div>
            <div className={data.advanced_score > data.base_score ? 'text-emerald-300' : 'text-orange-300'}>
              {(data.advanced_score * 100).toFixed(0)}
            </div>
          </div>

          {data.momentum_boost > 0 && (
            <div className="bg-emerald-900/20 rounded px-1.5 py-1">
              <div className="text-emerald-600 mb-0.5">Momentum +</div>
              <div className="text-emerald-300 font-bold">{(data.momentum_boost * 100).toFixed(0)}</div>
            </div>
          )}

          {data.reversal_penalty > 0 && (
            <div className="bg-red-900/20 rounded px-1.5 py-1">
              <div className="text-red-600 mb-0.5">Reversal -</div>
              <div className="text-red-300 font-bold">{(data.reversal_penalty * 100).toFixed(0)}</div>
            </div>
          )}

          {data.flow_penalty > 0 && (
            <div className="bg-orange-900/20 rounded px-1.5 py-1">
              <div className="text-orange-600 mb-0.5">Flow -</div>
              <div className="text-orange-300 font-bold">{(data.flow_penalty * 100).toFixed(0)}</div>
            </div>
          )}
        </div>
      </div>

      {/* Micro-Momentum Signals */}
      <div className="grid grid-cols-3 gap-1.5">
        <MicroMomentumCard label="OI Momentum" data={data.micro_signals.oi_momentum} />
        <MicroMomentumCard label="Price Momentum" data={data.micro_signals.price_momentum} />
        <MicroMomentumCard label="PCR Momentum" data={data.micro_signals.pcr_momentum} />
      </div>

      {/* Liquidity Flow Analysis */}
      <LiquidityFlowCard data={data.liquidity_flow} />

      {/* Reversal Analysis */}
      <ReversalAlertCard data={data.reversal_analysis} />

      {/* Updated Timestamp */}
      <div className="text-[8px] text-slate-600 text-center pt-1">
        Updated {new Date(data.timestamp).toLocaleTimeString()}
      </div>
    </div>
  );
}
