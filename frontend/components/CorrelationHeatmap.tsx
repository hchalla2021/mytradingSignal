'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Activity } from 'lucide-react';

interface Correlation {
  symbol1: string;
  symbol2: string;
  correlation: number;
  strength: string;
  timestamp: string;
}

interface CorrelationData {
  primary_symbol: string;
  correlations: Correlation[];
  count: number;
  timestamp: string;
}

interface CorrelationHeatmapProps {
  symbol: string;
  refreshInterval?: number;
}

/**
 * Correlation Heatmap - Multi-market correlation visualization
 * 
 * Shows:
 * - Correlation strength between symbols
 * - Heatmap visualization (red to green)
 * - Correlation classification
 * - Real-time correlation changes
 * 
 * Performance: <30ms render
 */
export default function CorrelationHeatmap({
  symbol = 'NIFTY',
  refreshInterval = 5000,
}: CorrelationHeatmapProps) {
  const [data, setData] = useState<CorrelationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCorrelations = useCallback(async () => {
    try {
      const response = await fetch(`/api/market-compass/correlation/${symbol}`);
      if (!response.ok) throw new Error('Failed to fetch correlations');
      
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
    fetchCorrelations();
    const interval = setInterval(fetchCorrelations, refreshInterval);
    return () => clearInterval(interval);
  }, [symbol, refreshInterval, fetchCorrelations]);

  const getCorrelationColor = (correlation: number) => {
    if (correlation > 0.7) return 'bg-emerald-600';
    if (correlation > 0.4) return 'bg-emerald-500';
    if (correlation > 0) return 'bg-emerald-400';
    if (correlation > -0.4) return 'bg-slate-500';
    if (correlation > -0.7) return 'bg-red-400';
    return 'bg-red-600';
  };

  const getCorrelationText = (correlation: number) => {
    const absCorr = Math.abs(correlation);
    if (absCorr > 0.8) return 'Very Strong';
    if (absCorr > 0.6) return 'Strong';
    if (absCorr > 0.4) return 'Moderate';
    if (absCorr > 0.2) return 'Weak';
    return 'Very Weak';
  };

  if (loading) {
    return (
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
        <div className="animate-pulse h-64 bg-slate-800 rounded"></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800 text-slate-400">
        {error || 'No correlation data'}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Activity size={20} className="text-teal-400" />
            Multi-Market Correlations
          </h3>
          <p className="text-xs text-slate-400">{symbol} correlation with other indices</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-slate-300">{data.count} Markets</p>
          <p className="text-xs text-slate-500">Tracked</p>
        </div>
      </div>

      {/* Heatmap */}
      <div className="bg-slate-900 rounded-lg p-4 border border-slate-800 space-y-3">
        {data.correlations.length > 0 ? (
          <>
            {data.correlations.map((corr, idx) => (
              <div key={idx} className="flex items-center gap-4">
                <div className="w-24">
                  <p className="text-sm font-semibold text-slate-300">{corr.symbol2}</p>
                </div>
                
                <div className="flex-1 flex items-center gap-2">
                  {/* Heatmap bar */}
                  <div className={`h-8 rounded flex items-center justify-center font-bold text-white transition ${getCorrelationColor(corr.correlation)}`}
                    style={{ width: `${Math.abs(corr.correlation) * 100}%` }}>
                    {corr.correlation > 0 ? '+' : ''}{corr.correlation.toFixed(2)}
                  </div>
                </div>
                
                <div className="w-32 text-right">
                  <p className={`text-xs font-semibold ${
                    corr.correlation > 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {getCorrelationText(corr.correlation)}
                  </p>
                  <p className="text-xs text-slate-500">{corr.strength}</p>
                </div>
              </div>
            ))}
          </>
        ) : (
          <p className="text-sm text-slate-500 py-8 text-center">No correlations detected yet</p>
        )}
      </div>

      {/* Legend */}
      <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
        <p className="text-xs text-slate-400 font-semibold mb-3">Correlation Scale</p>
        <div className="flex items-center gap-2 text-xs">
          <div className="w-8 h-4 bg-emerald-600 rounded"></div>
          <span className="text-slate-400">Strong Positive</span>
          
          <div className="w-8 h-4 bg-slate-500 rounded ml-4"></div>
          <span className="text-slate-400">Neutral</span>
          
          <div className="w-8 h-4 bg-red-600 rounded ml-4"></div>
          <span className="text-slate-400">Strong Negative</span>
        </div>
      </div>

      {/* Intelligence */}
      <div className="bg-indigo-950 rounded-lg p-4 border border-indigo-700">
        <p className="text-xs text-indigo-300 font-semibold mb-2">💡 Correlation Intelligence</p>
        <p className="text-xs text-indigo-200">
          High positive correlations indicate synchronized market moves. Use for diversification analysis.
        </p>
      </div>
    </div>
  );
}
