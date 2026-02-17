'use client';

import React, { useState, useEffect } from 'react';
import { API_CONFIG } from '@/lib/api-config';

interface PivotData {
  symbol: string;
  status: string;
  current_price: number;
  change: number;
  change_percent: number;
  overall_bias: string;
  classic_pivots?: {
    r2?: number;
    r1?: number;
    pivot?: number;
    s1?: number;
    s2?: number;
  };
  camarilla_pivots?: {
    h3?: number;
    h4?: number;
    l3?: number;
    l4?: number;
  };
  supertrend_10_3?: {
    signal?: string;
    value?: number;
    trend?: string;
  };
  nearest_support?: number;
  nearest_resistance?: number;
  timestamp?: string;
}

interface PivotDisplayProps {
  symbol: string;
}

const PivotDetailedDisplay: React.FC<PivotDisplayProps> = ({ symbol }) => {
  const [pivotData, setPivotData] = useState<PivotData | null>(null);
  const [hasAttemptedLoad, setHasAttemptedLoad] = useState(false);

  useEffect(() => {
    // First, try to load from cache immediately (instant display)
    try {
      const cached = localStorage.getItem(`pivot_${symbol}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        setPivotData(parsed);
        setHasAttemptedLoad(true);
      }
    } catch (e) {
      // Silent fallback
    }

    // Then fetch fresh data in background
    const fetchPivotData = async () => {
      try {
        const response = await fetch(`${API_CONFIG.baseUrl}/api/advanced/pivot-indicators`);
        if (response.ok) {
          const data = await response.json();
          const symbolData = data[symbol];
          if (symbolData && symbolData.status !== 'CLOSED') {
            setPivotData(symbolData);
            // Cache it
            try {
              localStorage.setItem(`pivot_${symbol}`, JSON.stringify(symbolData));
            } catch (e) {
              // Cache full, silent ignore
            }
          }
        }
      } catch (err) {
        // Silent fail - use cache or nothing
      } finally {
        setHasAttemptedLoad(true);
      }
    };

    fetchPivotData();
    const interval = setInterval(fetchPivotData, 30000); // Update every 30s
    
    return () => clearInterval(interval);
  }, [symbol]);

  // Don't render if no data available
  if (!pivotData || pivotData.status === 'CLOSED' || !pivotData.current_price) {
    return null;
  }

  const price = pivotData.current_price || 0;
  const change = pivotData.change_percent || 0;
  const bias = pivotData.overall_bias || 'NEUTRAL';
  const lastUpdate = '(Cached)'; // Cached from previous session
  const classic = pivotData.classic_pivots || {};
  const camarilla = pivotData.camarilla_pivots || {};
  const st10 = pivotData.supertrend_10_3 || {};
  const nearestR = pivotData.nearest_resistance || 0;
  const nearestS = pivotData.nearest_support || 0;

  // Determine position relative to pivot
  const pivot = (classic as any)?.pivot || 0;
  let positionStatus = '';
  if (price > pivot) {
    positionStatus = '📈 Above';
  } else if (price < pivot) {
    positionStatus = '📉 Below';
  } else {
    positionStatus = '➡️ At';
  }

  // Distance to nearest level (%)
  const getDistancePercent = (level: number) => {
    if (!level || level === 0) return 0;
    return Math.abs((price - level) / level * 100).toFixed(2);
  };

  // Determine Camarilla status
  const getCaramellaStatus = () => {
    if (!(camarilla as any)?.h4 && !(camarilla as any)?.l4) return 'NEUTRAL';
    const nearH4 = Math.abs((price - ((camarilla as any)?.h4 || 0)) / ((camarilla as any)?.h4 || 1)) < 0.01;
    const nearL4 = Math.abs((price - ((camarilla as any)?.l4 || 0)) / ((camarilla as any)?.l4 || 1)) < 0.01;
    if (nearH4) return 'RESISTANCE ⚠️';
    if (nearL4) return 'SUPPORT ⚠️';
    return 'NEUTRAL';
  };

  const caramellaStatus = getCaramellaStatus();

  // Supertrend distance %
  const stDistance = (st10 as any)?.value ? getDistancePercent((st10 as any)?.value) : '0.0';

  return (
    <div className="bg-dark-surface/40 rounded-lg p-4 border border-slate-700/40 shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-700/30">
        <div>
          <div className="text-xs text-slate-500">📊 Cached Data • Last session</div>
          <div className="text-sm font-bold text-slate-300">{symbol}</div>
        </div>
        <div className="text-right">
          <div className={`text-lg font-bold ${bias === 'BULLISH' ? 'text-green-400' : bias === 'BEARISH' ? 'text-red-400' : 'text-yellow-400'}`}>
            {bias}
          </div>
          <div className="text-xs text-slate-400">{lastUpdate}</div>
        </div>
      </div>

      {/* Price and Change */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-slate-900/30 rounded p-2 border border-slate-700/20">
          <div className="text-xs text-slate-500">PRICE</div>
          <div className="text-lg font-bold text-slate-300">{price.toFixed(2)}</div>
        </div>
        <div className={`bg-slate-900/30 rounded p-2 border border-slate-700/20 ${change >= 0 ? 'border-green-500/30' : 'border-red-500/30'}`}>
          <div className="text-xs text-slate-500">CHANGE</div>
          <div className={`text-lg font-bold ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {change >= 0 ? '↑' : '↓'} {Math.abs(change).toFixed(2)}%
          </div>
        </div>
      </div>

      {/* 3-Column Layout */}
      <div className="grid grid-cols-3 gap-3 text-[10px]">
        {/* PIVOT LEVELS Column */}
        <div className="bg-slate-900/30 rounded p-2 border border-yellow-500/20">
          <div className="font-bold text-yellow-400 mb-2">PIVOT LEVELS</div>
          <div className="text-slate-400 text-[9px] mb-1">| {positionStatus}</div>
          <div className="space-y-0.5 font-mono text-[9px]">
            <div className="text-red-400/80 font-bold">S3 {(classic as any)?.s3 ? (classic as any).s3.toFixed(0) : '-'}</div>
            <div className="text-slate-300 font-bold border-y border-slate-700/50 py-0.5">P {(classic as any)?.pivot ? (classic as any).pivot.toFixed(0) : '-'}</div>
            <div className="text-green-400/80 font-bold">R3 {(classic as any)?.r3 ? (classic as any).r3.toFixed(0) : '-'}</div>
          </div>
        </div>

        {/* SUPERTREND Column */}
        <div className={`bg-slate-900/30 rounded p-2 border ${(st10 as any)?.signal === 'BUY' ? 'border-green-500/20' : 'border-red-500/20'}`}>
          <div className={`font-bold mb-2 ${(st10 as any)?.signal === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
            SUPERTREND
          </div>
          <div className={`text-xs font-bold mb-1 px-1 py-0.5 rounded text-center ${(st10 as any)?.signal === 'BUY' ? 'bg-green-900/40 text-green-300' : 'bg-red-900/40 text-red-300'}`}>
            {(st10 as any)?.signal || 'NEUTRAL'}
          </div>
          <div className="text-slate-400 text-[9px] mb-2">{stDistance}% ⚠️ NEAR</div>
          <div className="text-slate-500 text-[9px]">Trend</div>
          <div className="text-slate-300 font-bold text-[10px]">{(st10 as any)?.trend || 'NEUTRAL'}</div>
        </div>

        {/* CAMARILLA Column */}
        <div className={`bg-slate-900/30 rounded p-2 border ${caramellaStatus.includes('RESISTANCE') ? 'border-red-500/20' : caramellaStatus.includes('SUPPORT') ? 'border-green-500/20' : 'border-slate-700/20'}`}>
          <div className="font-bold text-amber-400 mb-2">CAMARILLA</div>
          <div className={`text-xs font-bold mb-1 px-1 py-0.5 rounded text-center ${caramellaStatus.includes('BREAKDOWN') ? 'bg-red-900/40 text-red-300' : caramellaStatus.includes('SUPPORT') ? 'bg-green-900/40 text-green-300' : 'bg-slate-900/40 text-slate-300'}`}>
            {caramellaStatus}
          </div>
          <div className="text-slate-500 text-[9px] mt-2">Zones</div>
          <div className="text-red-400/80 text-[9px]">R3: {(camarilla as any)?.h4 ? (camarilla as any).h4.toFixed(0) : '-'} ⚠️</div>
          <div className="text-green-400/80 text-[9px]">S3: {(camarilla as any)?.l4 ? (camarilla as any).l4.toFixed(0) : '-'}</div>
        </div>
      </div>

      {/* Nearest Levels */}
      <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-700/30">
        <div className="bg-slate-900/20 rounded p-1.5 text-[9px]">
          <div className="text-slate-500 mb-1">NEAREST</div>
          <div className="text-emerald-400 font-bold">↑ R2</div>
          <div className="text-slate-300">{nearestR ? nearestR.toFixed(0) : '-'}</div>
        </div>
        <div className="bg-slate-900/20 rounded p-1.5 text-[9px]">
          <div className="text-slate-500 mb-1">NEAREST</div>
          <div className="text-red-400 font-bold">↓ S2</div>
          <div className="text-slate-300">{nearestS ? nearestS.toFixed(0) : '-'}</div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-[8px] text-slate-500 mt-3 text-center">
        🔄 Auto-updates when market opens at 9:00 AM
      </div>
    </div>
  );
};

export default PivotDetailedDisplay;
