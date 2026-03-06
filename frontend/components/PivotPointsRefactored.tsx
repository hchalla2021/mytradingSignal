'use client';

import React, { memo } from 'react';
import { TrendingUp, TrendingDown, Activity, BarChart3 } from 'lucide-react';
import { usePivotPointsRealtimeMulti } from '@/hooks/usePivotPointsRealtime';

// ============================================================================
// TYPES - Enhanced Pivot Analysis
// ============================================================================
interface EnhancedPivotData {
  symbol: string;
  status: 'LIVE' | 'CACHED' | 'OFFLINE';
  
  // Price info
  current_price: number;
  
  // Pivot levels (stable - never change during market)
  classic_pivots: {
    s3: number;
    s2: number;
    s1: number;
    pivot: number;
    r1: number;
    r2: number;
    r3: number;
  };
  
  camarilla_pivots: {
    l4: number;
    l3: number;
    h3: number;
    h4: number;
  };
  
  // Market status (5-level)
  market_status: 'STRONG_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'STRONG_BEARISH';
  
  // Pivot confidence (0-100)
  pivot_confidence: number;
  pivot_confidence_reasons: string[];
  
  // Nearest levels
  nearest_resistance?: {
    name: string;
    value: number;
    distance: number;
    distance_pct: number;
  };
  nearest_support?: {
    name: string;
    value: number;
    distance: number;
    distance_pct: number;
  };
  
  // 5-minute prediction
  prediction_direction: 'UP' | 'DOWN' | 'SIDEWAYS';
  prediction_confidence: number;
  prediction_reasons: string[];
  
  timestamp: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================
const fmt = (n: number | null | undefined): string => {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
};

const getStatusColor = (status: string) => {
  const baseClasses = 'px-3 py-1.5 rounded-lg font-semibold text-sm border';
  
  switch (status) {
    case 'STRONG_BULLISH':
      return `${baseClasses} bg-green-600/30 border-green-500/60 text-green-300`;
    case 'BULLISH':
      return `${baseClasses} bg-emerald-600/25 border-emerald-500/50 text-emerald-300`;
    case 'NEUTRAL':
      return `${baseClasses} bg-amber-600/25 border-amber-500/40 text-amber-300`;
    case 'BEARISH':
      return `${baseClasses} bg-red-600/25 border-red-500/50 text-red-300`;
    case 'STRONG_BEARISH':
      return `${baseClasses} bg-red-700/30 border-red-500/60 text-red-300`;
    default:
      return `${baseClasses} bg-slate-600/25 border-slate-500/40 text-slate-300`;
  }
};

const getPredictionIcon = (direction: string) => {
  switch (direction) {
    case 'UP':
      return <TrendingUp className="w-5 h-5 text-green-400" />;
    case 'DOWN':
      return <TrendingDown className="w-5 h-5 text-red-400" />;
    default:
      return <Activity className="w-5 h-5 text-amber-400" />;
  }
};

// ============================================================================
// REFACTORED PIVOT COMPONENT - STABLE TABLE LAYOUT
// ============================================================================
interface PivotRefactoredProps {
  updates?: number;
  analyses?: any;
  marketStatus?: string;
}

const PivotPointsRefactored = memo<PivotRefactoredProps>(({ updates = 0, analyses, marketStatus = 'LIVE' }) => {
  const symbolConfigs = [
    { symbol: 'NIFTY', name: 'NIFTY 50' },
    { symbol: 'BANKNIFTY', name: 'BANK NIFTY' },
    { symbol: 'SENSEX', name: 'SENSEX' },
  ];

  // 🔥 Use real-time hook for ultra-fast live updates
  const { pivotData, loading, error, lastUpdate, refetch } = usePivotPointsRealtimeMulti(symbolConfigs);

  if (loading) {
    return (
      <div className="rounded-lg p-6 bg-slate-800/30 border border-emerald-500/20 text-center">
        <p className="text-slate-400">Loading pivot data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg p-6 bg-red-900/20 border border-red-500/30 text-center">
        <p className="text-red-300">{error}</p>
        <button
          onClick={refetch}
          className="mt-2 text-[10px] px-3 py-1 rounded-full bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30 transition-colors"
        >Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header Info */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-emerald-400" />
          <h3 className="text-base font-semibold text-white">Pivot Analysis</h3>
        </div>
        {lastUpdate && (
          <span className="text-xs text-slate-500">
            Updated: {lastUpdate.toLocaleTimeString('en-IN')}
          </span>
        )}
      </div>

      {/* Main Grid - Professional Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {symbolConfigs.map((config) => {
          const data = pivotData[config.symbol];
          
          if (!data) {
            return (
              <div key={config.symbol} className="rounded-lg p-4 bg-slate-800/20 border border-slate-700/30">
                <p className="text-slate-500 text-sm text-center">{config.name}: No data</p>
              </div>
            );
          }

          return (
            <div key={config.symbol} className="rounded-xl overflow-hidden border border-slate-700/50 bg-slate-900/40 backdrop-blur">
              {/* Card Top Bar */}
              <div className="bg-gradient-to-r from-slate-800/50 to-slate-800/20 px-4 py-3 border-b border-slate-700/30">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-white">{config.name}</h4>
                    <p className="text-xs text-slate-400 mt-0.5">₹{fmt(data.current_price)}</p>
                  </div>
                  {data.status === 'LIVE' && (
                    <span className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/20 border border-emerald-500/40">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-xs text-emerald-300 font-semibold">LIVE</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Content */}
              <div className="p-4 space-y-4">
                
                {/* 1. Market Status - Prominent Display */}
                <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/30">
                  <p className="text-xs text-slate-500 font-semibold mb-2 uppercase tracking-wider">Market Status</p>
                  <div className="flex items-center gap-2">
                    <div className={getStatusColor(data.market_status)}>
                      {data.market_status.replace(/_/g, ' ')}
                    </div>
                  </div>
                </div>

                {/* 2. Pivot Confidence */}
                <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/30">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Pivot Confidence</p>
                    <p className="text-xl font-bold text-teal-300">{data.pivot_confidence}%</p>
                  </div>
                  <div className="w-full bg-slate-700/50 rounded-full h-2 overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-teal-500 to-teal-400 transition-all duration-500"
                      style={{ width: `${data.pivot_confidence}%` }}
                    />
                  </div>
                  <ul className="mt-2 space-y-1 text-xs text-slate-400">
                    {data.pivot_confidence_reasons.slice(0, 2).map((reason, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-teal-500">•</span>
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* 3. 5-Minute Prediction */}
                <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/30">
                  <p className="text-xs text-slate-500 font-semibold mb-2 uppercase tracking-wider">5-Min Prediction</p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {getPredictionIcon(data.prediction_direction)}
                      <span className="font-semibold text-white">
                        {data.prediction_direction === 'SIDEWAYS' ? 'Sideways' : 
                         data.prediction_direction === 'UP' ? 'Expected Up' : 'Expected Down'}
                      </span>
                    </div>
                    <p className="text-lg font-bold text-amber-300">{data.prediction_confidence}%</p>
                  </div>
                  <ul className="mt-2 space-y-1 text-xs text-slate-400">
                    {data.prediction_reasons.slice(0, 2).map((reason, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-amber-500">•</span>
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* 4. Pivot Levels Table - STABLE LAYOUT */}
                <div className="bg-slate-800/30 rounded-lg p-2 border border-slate-700/20 overflow-x-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {/* R3 */}
                      <tr className="border-b border-slate-700/20 hover:bg-slate-700/10">
                        <td className="px-2 py-1.5 font-semibold text-red-300">R3</td>
                        <td className="px-2 py-1.5 text-right font-mono text-slate-300">{fmt(data.classic_pivots.r3)}</td>
                      </tr>
                      
                      {/* R2 */}
                      <tr className="border-b border-slate-700/20 hover:bg-slate-700/10">
                        <td className="px-2 py-1.5 font-semibold text-orange-300">R2</td>
                        <td className="px-2 py-1.5 text-right font-mono text-slate-300">{fmt(data.classic_pivots.r2)}</td>
                      </tr>
                      
                      {/* R1 */}
                      <tr className="border-b border-slate-700/20 hover:bg-slate-700/10">
                        <td className="px-2 py-1.5 font-semibold text-amber-300">R1</td>
                        <td className="px-2 py-1.5 text-right font-mono text-slate-300">{fmt(data.classic_pivots.r1)}</td>
                      </tr>
                      
                      {/* Pivot */}
                      <tr className="border-b border-slate-700/30 bg-slate-700/20 hover:bg-slate-700/30">
                        <td className="px-2 py-1.5 font-bold text-white">Pivot</td>
                        <td className="px-2 py-1.5 text-right font-mono font-bold text-yellow-300">{fmt(data.classic_pivots.pivot)}</td>
                      </tr>
                      
                      {/* S1 */}
                      <tr className="border-b border-slate-700/20 hover:bg-slate-700/10">
                        <td className="px-2 py-1.5 font-semibold text-lime-300">S1</td>
                        <td className="px-2 py-1.5 text-right font-mono text-slate-300">{fmt(data.classic_pivots.s1)}</td>
                      </tr>
                      
                      {/* S2 */}
                      <tr className="border-b border-slate-700/20 hover:bg-slate-700/10">
                        <td className="px-2 py-1.5 font-semibold text-cyan-300">S2</td>
                        <td className="px-2 py-1.5 text-right font-mono text-slate-300">{fmt(data.classic_pivots.s2)}</td>
                      </tr>
                      
                      {/* S3 */}
                      <tr className="hover:bg-slate-700/10">
                        <td className="px-2 py-1.5 font-semibold text-blue-300">S3</td>
                        <td className="px-2 py-1.5 text-right font-mono text-slate-300">{fmt(data.classic_pivots.s3)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* 5. Nearest Levels Info */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {data.nearest_resistance && (
                    <div className="bg-red-900/20 rounded p-2 border border-red-500/20">
                      <p className="text-red-300 font-semibold mb-1">📈 Resistance</p>
                      <p className="text-slate-300 font-mono">{data.nearest_resistance.name}</p>
                      <p className="text-red-400 font-mono">₹{fmt(data.nearest_resistance.value)}</p>
                      <p className="text-slate-500 text-xs mt-0.5">{fmt(data.nearest_resistance.distance_pct)}% away</p>
                    </div>
                  )}
                  
                  {data.nearest_support && (
                    <div className="bg-green-900/20 rounded p-2 border border-green-500/20">
                      <p className="text-green-300 font-semibold mb-1">📉 Support</p>
                      <p className="text-slate-300 font-mono">{data.nearest_support.name}</p>
                      <p className="text-green-400 font-mono">₹{fmt(data.nearest_support.value)}</p>
                      <p className="text-slate-500 text-xs mt-0.5">{fmt(data.nearest_support.distance_pct)}% away</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

PivotPointsRefactored.displayName = 'PivotPointsRefactored';

export default PivotPointsRefactored;
