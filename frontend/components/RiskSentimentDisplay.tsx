'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, TrendingUp, TrendingDown, Activity } from 'lucide-react';

interface RiskData {
  symbol: string;
  overall_risk: number;
  market_risk: number;
  volatility_risk: number;
  correlation_risk: number;
  liquidity_risk: number;
  gap_risk: number;
  concentration_risk: number;
  risk_rating: string;
  risk_level_change: string;
  primary_risks: string[];
  hedge_recommendations: string[];
  timestamp: string;
}

interface RiskSentimentDisplayProps {
  symbol: string;
  refreshInterval?: number;
}

/**
 * Risk & Sentiment Display - Comprehensive risk assessment and sentiment analysis
 * 
 * Shows:
 * - Overall risk score (0-100)
 * - Individual risk factors
 * - Risk rating classification
 * - Hedge recommendations
 * - Risk level change tracking
 * - Primary risk factors
 * 
 * Performance: <30ms render
 */
export default function RiskSentimentDisplay({
  symbol = 'NIFTY',
  refreshInterval = 3000,
}: RiskSentimentDisplayProps) {
  const [data, setData] = useState<RiskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [, setError] = useState<string | null>(null);

  const fetchRiskData = useCallback(async () => {
    try {
      const response = await fetch(`/api/market-compass/risk-score/${symbol}`);
      if (!response.ok) {
        if (response.status === 202) {
          setLoading(false);
          return;
        }
        throw new Error('Failed to fetch risk data');
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
    fetchRiskData();
    const interval = setInterval(fetchRiskData, refreshInterval);
    return () => clearInterval(interval);
  }, [symbol, refreshInterval, fetchRiskData]);

  if (loading || !data) {
    return (
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
        <div className="animate-pulse space-y-4">
          <div className="h-20 bg-slate-800 rounded"></div>
          <div className="grid grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-slate-800 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const getRiskColor = (rating: string) => {
    switch (rating) {
      case 'CRITICAL':
        return { bg: 'bg-red-950', border: 'border-red-700', text: 'text-red-400', badge: 'bg-red-900' };
      case 'HIGH':
        return { bg: 'bg-red-900', border: 'border-red-700', text: 'text-red-300', badge: 'bg-red-800' };
      case 'MEDIUM':
        return { bg: 'bg-amber-900', border: 'border-amber-700', text: 'text-amber-300', badge: 'bg-amber-800' };
      case 'LOW':
        return { bg: 'bg-emerald-900', border: 'border-emerald-700', text: 'text-emerald-300', badge: 'bg-emerald-800' };
      default:
        return { bg: 'bg-slate-800', border: 'border-slate-700', text: 'text-slate-300', badge: 'bg-slate-700' };
    }
  };

  const getRiskChangeIcon = (change: string) => {
    if (change === 'INCREASING') {
      return <TrendingUp size={16} className="text-red-400" />;
    } else if (change === 'DECREASING') {
      return <TrendingDown size={16} className="text-emerald-400" />;
    }
    return <Activity size={16} className="text-slate-400" />;
  };

  const colors = getRiskColor(data.risk_rating);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <AlertTriangle size={20} className="text-red-400" />
            Risk & Sentiment Assessment
          </h3>
          <p className="text-xs text-slate-400">{symbol} comprehensive risk analysis</p>
        </div>
      </div>

      {/* Overall Risk Card */}
      <div className={`rounded-lg p-6 border ${colors.bg} ${colors.border} shadow-lg`}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-xs opacity-80 mb-2">Overall Risk Score</p>
            <p className={`text-4xl font-bold ${colors.text}`}>
              {data.overall_risk.toFixed(0)}
            </p>
          </div>
          
          <div className="text-right">
            <span className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg font-bold text-sm ${colors.badge}`}>
              {getRiskChangeIcon(data.risk_level_change)}
              {data.risk_rating}
            </span>
          </div>
        </div>

        {/* Risk change */}
        <div className="pt-4 border-t border-white/10">
          <p className="text-xs opacity-75">
            Risk Level: {data.risk_level_change}
          </p>
        </div>
      </div>

      {/* Risk Factors Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {[
          { label: 'Market Risk', value: data.market_risk, key: 'market_risk' },
          { label: 'Volatility Risk', value: data.volatility_risk, key: 'volatility_risk' },
          { label: 'Correlation Risk', value: data.correlation_risk, key: 'correlation_risk' },
          { label: 'Liquidity Risk', value: data.liquidity_risk, key: 'liquidity_risk' },
          { label: 'Gap Risk', value: data.gap_risk, key: 'gap_risk' },
          { label: 'Concentration Risk', value: data.concentration_risk, key: 'concentration_risk' },
        ].map((risk) => (
          <div key={risk.key} className="bg-slate-800 rounded-lg p-3 border border-slate-700">
            <p className="text-xs text-slate-400 font-semibold mb-2">{risk.label}</p>
            <div className="relative">
              <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    risk.value > 70 ? 'bg-red-500' :
                    risk.value > 50 ? 'bg-amber-500' :
                    'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.min(risk.value, 100)}%` }}
                />
              </div>
              <p className="text-sm font-bold text-slate-200 mt-1">{risk.value.toFixed(0)}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Primary Risks */}
      {data.primary_risks && data.primary_risks.length > 0 && (
        <div className={`rounded-lg p-4 border ${colors.bg} ${colors.border}`}>
          <p className={`text-xs font-semibold mb-3 ${colors.text}`}>Primary Risk Factors</p>
          <div className="space-y-2">
            {data.primary_risks.map((risk, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <span className="text-red-400 mt-1">•</span>
                <p className="text-sm text-slate-200">{risk}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hedge Recommendations */}
      {data.hedge_recommendations && data.hedge_recommendations.length > 0 && (
        <div className="bg-emerald-950 rounded-lg p-4 border border-emerald-700">
          <p className="text-xs text-emerald-300 font-semibold mb-3">🛡️ Hedge Recommendations</p>
          <div className="space-y-2">
            {data.hedge_recommendations.map((rec, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <span className="text-emerald-400 mt-1">✓</span>
                <p className="text-sm text-emerald-200">{rec}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Risk Scale */}
      <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
        <p className="text-xs text-slate-400 font-semibold mb-2">Risk Scale</p>
        <div className="flex items-center justify-between text-xs">
          <div>
            <div className="w-6 h-4 bg-emerald-500 rounded mb-1"></div>
            <span className="text-slate-500">Low</span>
          </div>
          <div>
            <div className="w-6 h-4 bg-amber-500 rounded mb-1"></div>
            <span className="text-slate-500">Medium</span>
          </div>
          <div>
            <div className="w-6 h-4 bg-red-500 rounded mb-1"></div>
            <span className="text-slate-500">Critical</span>
          </div>
        </div>
      </div>
    </div>
  );
}
