'use client';

/**
 * Overall Market Outlook – PROFESSIONAL MINIMAL DASHBOARD
 * Clean, fast, professional trading interface
 * - Real-time 14-signal aggregation
 * - Multi-symbol sentiment dashboard
 * - 5-minute prediction alerts
 * - Zero clutter, maximum clarity
 */

import React, { useState, useEffect, memo, useMemo, useCallback } from 'react';
import { useIndiaVIX } from '@/hooks/useIndiaVIX';
import IndiaVIXBadge from '@/components/IndiaVIXBadge';
import { API_CONFIG } from '@/lib/api-config';
import useOrderFlowRealtime from '@/hooks/useOrderFlowRealtime';

interface SymbolData {
  symbol: string;
  signal: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
  confidence: number;
  buy_signals: number;
  sell_signals: number;
  prediction_5m_direction: 'UP' | 'DOWN' | 'FLAT';
  prediction_5m_signal: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
  prediction_5m_confidence: number;
  order_flow_buy_pct?: number;
  order_flow_sell_pct?: number;
  timestamp: string;
}

interface MarketOutlookResponse {
  NIFTY: SymbolData;
  BANKNIFTY: SymbolData;
  SENSEX: SymbolData;
}

// Minimal color utilities - no complexity
const signalColor = {
  'STRONG_BUY': '#10b981',
  'BUY': '#6ee7b7',
  'NEUTRAL': '#fbbf24',
  'SELL': '#f87171',
  'STRONG_SELL': '#dc2626'
};

const SignalCard = memo(({ data }: { data: SymbolData }) => {
  // Calculate integrated confidence (average of index confidence and 5m prediction)
  const indexConfidence = data.confidence || 0;
  const predictionConfidence = data.prediction_5m_confidence || 0;
  const integratedConfidence = Math.round((indexConfidence + predictionConfidence) / 2);
  
  // Calculate confidence alignment (how well they agree)
  const confidenceDiff = Math.abs(indexConfidence - predictionConfidence);
  const alignmentScore = Math.max(0, 100 - confidenceDiff);
  const isAligned = confidenceDiff <= 15; // Within 15% = good alignment
  const isStrongAlignment = confidenceDiff <= 5; // Within 5% = strong alignment
  
  // Determine alignment indicator
  const alignmentLabel = isStrongAlignment ? 'STRONG ALIGNMENT' : isAligned ? 'ALIGNED' : 'DIVERGENT';
  const alignmentColor = isStrongAlignment ? '#10b981' : isAligned ? '#fbbf24' : '#ef4444';
  
  // Direction agreement between index and 5m prediction
  const indexBullish = data.signal === 'STRONG_BUY' || data.signal === 'BUY';
  const indexBearish = data.signal === 'STRONG_SELL' || data.signal === 'SELL';
  const predictionBullish = data.prediction_5m_signal === 'STRONG_BUY' || data.prediction_5m_signal === 'BUY';
  const predictionBearish = data.prediction_5m_signal === 'STRONG_SELL' || data.prediction_5m_signal === 'SELL';
  
  const directionsAlign = (indexBullish && predictionBullish) || (indexBearish && predictionBearish) || 
                         (data.signal === 'NEUTRAL' && data.prediction_5m_signal === 'NEUTRAL');
  
  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-6 backdrop-blur-sm hover:bg-slate-800/70 transition-colors">
      {/* Header: Symbol */}
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="text-2xl font-bold text-white">{data.symbol}</h3>
        <div className="text-xs font-bold px-2 py-1 rounded" style={{
          backgroundColor: alignmentColor + '20',
          color: alignmentColor
        }}>
          {alignmentLabel}
        </div>
      </div>

      {/* INTEGRATED CONFIDENCE DISPLAY - PROMINENT DUAL METERS */}
      <div className="mb-6 p-5 bg-gradient-to-br from-slate-900/80 to-slate-800/60 rounded-xl border-2 border-slate-700/50 shadow-lg">
        <div className="mb-4 pb-3 border-b border-slate-700/50">
          <h4 className="text-xs font-bold uppercase tracking-widest text-gray-300 mb-3">📊 Integration Analysis</h4>
          
          {/* DUAL CONFIDENCE SIDE-BY-SIDE */}
          <div className="grid grid-cols-2 gap-4">
            {/* INDEX CONFIDENCE (LEFT) */}
            <div className="bg-slate-800/50 rounded-lg p-3.5 border border-slate-700/40">
              <div className="text-center">
                <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-2">INDEX CONFIDENCE</div>
                <div className="text-4xl font-black mb-2" style={{ color: signalColor[data.signal] }}>
                  {indexConfidence}<span className="text-xl">%</span>
                </div>
                <div className="h-2 bg-slate-700/60 rounded-full overflow-hidden mb-2">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${indexConfidence}%`,
                      backgroundColor: signalColor[data.signal]
                    }}
                  />
                </div>
                <div className="text-[11px] font-semibold text-gray-300">{data.signal.replace(/_/g, ' ')}</div>
              </div>
            </div>

            {/* 5-MIN PREDICTION (RIGHT) */}
            <div className="bg-slate-800/50 rounded-lg p-3.5 border border-slate-700/40">
              <div className="text-center">
                <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-2">⚡ 5-MIN CONFIDENCE</div>
                <div className="text-4xl font-black mb-2" style={{ color: signalColor[data.prediction_5m_signal] }}>
                  {predictionConfidence}<span className="text-xl">%</span>
                </div>
                <div className="h-2 bg-slate-700/60 rounded-full overflow-hidden mb-2">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${predictionConfidence}%`,
                      backgroundColor: signalColor[data.prediction_5m_signal]
                    }}
                  />
                </div>
                <div className="text-[11px] font-semibold text-gray-300">{data.prediction_5m_signal.replace(/_/g, ' ')}</div>
              </div>
            </div>
          </div>
        </div>

        {/* INTEGRATED CONFIDENCE + ALIGNMENT METRICS */}
        <div className="space-y-3">
          {/* Integrated Score */}
          <div className="bg-slate-800/40 rounded-lg p-3 border border-slate-700/40">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">INTEGRATED CONFIDENCE</span>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black text-white">{integratedConfidence}%</span>
                <span className="text-[11px] font-bold px-3 py-1 rounded-full" style={{
                  backgroundColor: alignmentColor + '30',
                  color: alignmentColor
                }}>
                  {alignmentLabel}
                </span>
              </div>
            </div>
            <div className="h-2.5 bg-slate-700/60 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${integratedConfidence}%`,
                  backgroundColor: isStrongAlignment ? '#10b981' : isAligned ? '#fbbf24' : '#ef4444'
                }}
              />
            </div>
          </div>

          {/* Alignment & Direction Indicators */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-slate-800/40 rounded-lg p-2.5 text-center border border-slate-700/40">
              <div className="text-[8px] font-bold uppercase text-gray-500 mb-1">Diff</div>
              <div className="text-xl font-black text-amber-400">{confidenceDiff}%</div>
            </div>
            <div className="bg-slate-800/40 rounded-lg p-2.5 text-center border border-slate-700/40">
              <div className="text-[8px] font-bold uppercase text-gray-500 mb-1">Alignment</div>
              <div className="text-xl font-black" style={{ color: alignmentColor }}>{alignmentScore}%</div>
            </div>
            <div className="bg-slate-800/40 rounded-lg p-2.5 text-center border border-slate-700/40">
              <div className="text-[8px] font-bold uppercase text-gray-500 mb-1">Agreement</div>
              <div className="text-lg font-black" style={{ color: directionsAlign ? '#10b981' : '#ef4444' }}>
                {directionsAlign ? '✓' : '✗'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Signal - Bold */}
      <div className="mb-6 pb-4 border-b border-slate-700/50">
        <div className="text-sm text-gray-400 font-bold uppercase mb-2">Overall Signal</div>
        <div className="text-4xl font-black" style={{ color: signalColor[data.signal] }}>
          {data.signal.replace(/_/g, ' ')}
        </div>
      </div>

      {/* 14-Signal Consensus - Clean Bars */}
      <div className="mb-6 space-y-4">
        <h4 className="text-xs uppercase tracking-wide text-gray-400 font-bold">14 Signal Consensus</h4>
        
        {/* BUY Bar */}
        <div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-emerald-400 font-semibold">▲ BUY SIGNALS</span>
            <span className="text-white font-bold">{data.buy_signals}%</span>
          </div>
          <div className="h-2.5 bg-slate-700/50 rounded-full overflow-hidden border border-slate-600/30">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-500"
              style={{ width: `${data.buy_signals}%` }}
            />
          </div>
        </div>

        {/* SELL Bar */}
        <div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-red-400 font-semibold">▼ SELL SIGNALS</span>
            <span className="text-white font-bold">{data.sell_signals}%</span>
          </div>
          <div className="h-2.5 bg-slate-700/50 rounded-full overflow-hidden border border-slate-600/30">
            <div
              className="h-full bg-gradient-to-r from-red-500 to-red-400 rounded-full transition-all duration-500"
              style={{ width: `${data.sell_signals}%` }}
            />
          </div>
        </div>
      </div>

      {/* 5-Minute Prediction - PROMINENT SECTION - FULLY VISIBLE */}
      <div className="mt-6 pt-6 px-5 py-6 border-t-2 border-purple-500/40 bg-gradient-to-br from-purple-950/40 to-slate-900/30 rounded-lg">
        <div className="flex items-center justify-between mb-5">
          <h4 className="text-sm font-bold uppercase tracking-wider text-purple-300">⚡ 5-MIN PREDICTION ANALYSIS</h4>
          {directionsAlign && (
            <span className="text-[10px] font-bold px-3 py-1.5 rounded-full bg-emerald-500/30 text-emerald-300 border border-emerald-500/60">
              ✓ CONFIRMED
            </span>
          )}
          {!directionsAlign && (
            <span className="text-[10px] font-bold px-3 py-1.5 rounded-full bg-red-500/30 text-red-300 border border-red-500/60">
              ⚠ DIVERGENT
            </span>
          )}
        </div>
        
        {/* Direction & Signal Grid */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-slate-800/70 border border-purple-500/50 rounded-lg p-3">
            <div className="text-[8px] font-bold text-purple-400 mb-1">DIRECTION</div>
            <div className="text-3xl font-black mb-1" style={{ color: signalColor[data.prediction_5m_signal] }}>
              {data.prediction_5m_direction === 'UP' ? '▲' : data.prediction_5m_direction === 'DOWN' ? '▼' : '→'}
            </div>
            <div className="text-[11px] font-semibold text-gray-300">
              {data.prediction_5m_direction === 'UP' ? 'BULLISH' : data.prediction_5m_direction === 'DOWN' ? 'BEARISH' : 'NEUTRAL'}
            </div>
          </div>

          <div className="bg-slate-800/70 border border-purple-500/50 rounded-lg p-3">
            <div className="text-[8px] font-bold text-purple-400 mb-1">SIGNAL</div>
            <div className="text-lg font-black mb-1" style={{ color: signalColor[data.prediction_5m_signal] }}>
              {data.prediction_5m_signal.replace(/_/g, ' ')}
            </div>
            <div className="text-[11px] font-semibold text-gray-300">{predictionConfidence}%</div>
          </div>
        </div>

        {/* LARGE CONFIDENCE DISPLAY */}
        <div className="bg-slate-800/60 border-2 border-purple-500/50 rounded-lg p-4 mb-4">
          <div className="text-[9px] font-bold text-purple-400 mb-1 text-center">5-MIN CONFIDENCE</div>
          <div className="text-5xl font-black text-purple-300 text-center mb-2">{predictionConfidence}%</div>
          <div className="h-3 bg-slate-700/50 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-purple-600 to-purple-400 transition-all duration-500"
              style={{ width: `${Math.max(predictionConfidence, 2)}%` }}
            />
          </div>
        </div>

        {/* Momentum Distribution */}
        <div className="space-y-2 pt-3 border-t border-slate-700/40">
          <div className="text-[8px] font-bold text-gray-400 text-center mb-2">MOMENTUM</div>
          
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-emerald-400 font-semibold">▲ BULL</span>
              <span className="text-emerald-300 font-bold">{predictionConfidence}%</span>
            </div>
            <div className="h-2 bg-slate-700/50 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400"
                style={{ width: `${Math.max(predictionConfidence, 2)}%` }}
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-red-400 font-semibold">▼ BEAR</span>
              <span className="text-red-300 font-bold">{100 - predictionConfidence}%</span>
            </div>
            <div className="h-2 bg-slate-700/50 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-red-600 to-red-400"
                style={{ width: `${Math.max(100 - predictionConfidence, 2)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Sync Status */}
        <div className="text-center mt-3 pt-3 border-t border-slate-700/40">
          <div className="text-[10px] font-bold px-3 py-1 rounded-full inline-block" style={{
            backgroundColor: directionsAlign ? 'rgba(16, 185, 129, 0.15)' : 'rgba(251, 191, 36, 0.15)',
            color: directionsAlign ? '#a7f3d0' : '#fcd34d',
            border: `1px solid ${directionsAlign ? 'rgba(16, 185, 129, 0.4)' : 'rgba(251, 191, 36, 0.4)'}`
          }}>
            {directionsAlign ? '✓ SYNCED' : '⚠ VERIFY'}
          </div>
        </div>
      </div>

      {/* Footer: Last Update */}
      <div className="mt-4 pt-4 border-t border-slate-700/40 flex items-center justify-between text-xs text-gray-500">
        <span>Updated: {new Date(data.timestamp).toLocaleTimeString()}</span>
        <span className="text-[10px]" style={{ color: directionsAlign ? '#10b981' : '#fbbf24' }}>
          {directionsAlign ? '✓ Signals Aligned' : '⚠ Check Setup'}
        </span>
      </div>
    </div>
  );
}, (prev, next) => JSON.stringify(prev.data) === JSON.stringify(next.data));

SignalCard.displayName = 'SignalCard';

export default function OverallMarketOutlook() {
  const [data, setData] = useState<MarketOutlookResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { vixData, loading: vixLoading } = useIndiaVIX();

  // 🔥 LIVE ORDER FLOW: Subscribe to WebSocket for real-time 5-min prediction updates
  const niftyOF = useOrderFlowRealtime('NIFTY');
  const bankniftyOF = useOrderFlowRealtime('BANKNIFTY');
  const sensexOF = useOrderFlowRealtime('SENSEX');

  const fetchData = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(
        API_CONFIG.endpoint('/api/analysis/market-outlook-all'),
        { cache: 'no-store', signal: controller.signal }
      );

      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      if (result.NIFTY && result.BANKNIFTY && result.SENSEX) {
        setData(result as MarketOutlookResponse);
        setError(null);
      } else {
        setError('Incomplete data from server');
      }
      setLoading(false);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setError('Connection error');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Loading state
  if (loading) return (
    <div className="space-y-6">
      <h1 className="text-3xl font-black text-white">MARKET OUTLOOK</h1>
      <div className="bg-slate-900/60 border border-slate-700/40 rounded-xl p-12 animate-pulse flex flex-col items-center gap-3">
        <div className="h-6 bg-slate-800/70 rounded w-48" />
        <div className="h-4 bg-slate-800/50 rounded w-64" />
        <p className="text-sm text-gray-500 mt-2">Loading live market data...</p>
      </div>
    </div>
  );

  // Error state
  if (error || !data) return (
    <div className="space-y-6">
      <h1 className="text-3xl font-black text-white">MARKET OUTLOOK</h1>
      <div className="bg-slate-900/60 border-2 border-rose-500/30 rounded-xl p-12 flex flex-col items-center gap-3">
        <span className="text-3xl">⚠</span>
        <p className="text-sm font-bold text-rose-300">{error || 'No data available'}</p>
        <button onClick={fetchData} className="mt-2 text-xs px-4 py-1.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 transition-colors">
          Retry
        </button>
      </div>
    </div>
  );

  // 🔥 MERGE live WebSocket order flow data into REST data for real-time updates
  // When order flow prediction changes, overall values update INSTANTLY
  const mergeOrderFlow = (
    restData: SymbolData,
    ofData: ReturnType<typeof useOrderFlowRealtime>
  ): SymbolData => {
    if (!ofData?.data?.fiveMinPrediction) return restData;
    const pred = ofData.data.fiveMinPrediction;
    const buyPct = pred.buyDominancePct ?? 50;
    const sellPct = pred.sellDominancePct ?? 50;
    const ofConf = Math.round((pred.confidence ?? 0) * 100);
    const ofDir = pred.direction || 'NEUTRAL';

    // Map order flow direction to 5m signal
    let pred5mSignal: SymbolData['prediction_5m_signal'] = restData.prediction_5m_signal;
    if (ofDir === 'STRONG_BUY' || ofDir === 'BUY' || ofDir === 'STRONG_SELL' || ofDir === 'SELL') {
      pred5mSignal = ofDir as SymbolData['prediction_5m_signal'];
    }

    // Direction from buy/sell dominance
    let pred5mDir: SymbolData['prediction_5m_direction'] = 'FLAT';
    if (buyPct > 55) pred5mDir = 'UP';
    else if (sellPct > 55) pred5mDir = 'DOWN';

    // Confidence: blend order flow (60%) with index confidence (40%)
    const blendedConf = Math.round(0.6 * ofConf + 0.4 * restData.confidence);

    // Recalculate overall signal based on order flow agreement
    const ofBullish = ofDir === 'STRONG_BUY' || ofDir === 'BUY';
    const ofBearish = ofDir === 'STRONG_SELL' || ofDir === 'SELL';
    const restBullish = restData.signal === 'STRONG_BUY' || restData.signal === 'BUY';
    const restBearish = restData.signal === 'STRONG_SELL' || restData.signal === 'SELL';

    let mergedSignal = restData.signal;
    // Strengthen signal when both agree
    if (ofBullish && restBullish && ofConf > 55) {
      mergedSignal = 'STRONG_BUY';
    } else if (ofBearish && restBearish && ofConf > 55) {
      mergedSignal = 'STRONG_SELL';
    }
    // Weaken signal when they disagree
    else if (ofBearish && restBullish) {
      mergedSignal = 'NEUTRAL';
    } else if (ofBullish && restBearish) {
      mergedSignal = 'NEUTRAL';
    }

    return {
      ...restData,
      signal: mergedSignal,
      confidence: blendedConf,
      prediction_5m_direction: pred5mDir,
      prediction_5m_signal: pred5mSignal,
      prediction_5m_confidence: ofConf,
      order_flow_buy_pct: buyPct,
      order_flow_sell_pct: sellPct,
      timestamp: new Date().toISOString(),
    };
  };

  const liveData: MarketOutlookResponse = {
    NIFTY: mergeOrderFlow(data.NIFTY, niftyOF),
    BANKNIFTY: mergeOrderFlow(data.BANKNIFTY, bankniftyOF),
    SENSEX: mergeOrderFlow(data.SENSEX, sensexOF),
  };

  // Calculate integrated metrics across ALL symbols (using LIVE merged data)
  const allSymbols = ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const;
  const avgIndexConfidence = Math.round(
    allSymbols.reduce((sum, sym) => sum + (liveData[sym].confidence || 0), 0) / 3
  );
  const avg5minConfidence = Math.round(
    allSymbols.reduce((sum, sym) => sum + (liveData[sym].prediction_5m_confidence || 0), 0) / 3
  );
  const integratedConfidence = Math.round((avgIndexConfidence + avg5minConfidence) / 2);
  const confidenceDiff = Math.abs(avgIndexConfidence - avg5minConfidence);
  const alignmentScore = Math.max(0, 100 - confidenceDiff);

  // Count direction agreements
  const bullishCount = allSymbols.filter(sym => {
    const symbolData = liveData[sym];
    const indexBullish = symbolData.signal === 'STRONG_BUY' || symbolData.signal === 'BUY';
    const predictionBullish = symbolData.prediction_5m_signal === 'STRONG_BUY' || symbolData.prediction_5m_signal === 'BUY';
    return indexBullish && predictionBullish;
  }).length;
  
  const directionAgreement = Math.round((bullishCount / 3) * 100);

  return (
    <div className="space-y-6">
      {/* Clean Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white">MARKET OUTLOOK</h1>
          <p className="text-sm text-gray-400 mt-2">
            Integrated Analysis • 14-Signal Consensus • 5-Min Prediction Alignment
          </p>
        </div>
        <div className="text-right">
          <div className="flex items-center gap-2 text-sm text-gray-400 mb-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            LIVE DATA
          </div>
          <IndiaVIXBadge
            value={vixData.value}
            changePercent={vixData.changePercent}
            volatilityLevel={vixData.volatilityLevel}
            marketFearScore={vixData.marketFearScore}
            loading={vixLoading}
          />
        </div>
      </div>

      {/* ✨ INTEGRATION SUMMARY - TOP SECTION - ALWAYS VISIBLE */}
      <div className="bg-gradient-to-br from-slate-900/90 via-slate-800/80 to-slate-900/90 border-2 border-amber-500/30 rounded-xl p-8 backdrop-blur-lg shadow-2xl">
        <h2 className="text-sm font-bold uppercase tracking-widest text-amber-400 mb-6">📊 5-Minute Integration Summary</h2>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* LEFT: Confidence Comparison */}
          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-400">✓ INDEX CONFIDENCE (AVG)</span>
                <span className="text-3xl font-black text-blue-400">{avgIndexConfidence}%</span>
              </div>
              <div className="h-3 bg-slate-700/60 rounded-full overflow-hidden border border-blue-500/30">
                <div
                  className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full transition-all duration-500"
                  style={{ width: `${avgIndexConfidence}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-400">⚡ 5-MIN CONFIDENCE (AVG)</span>
                <span className="text-3xl font-black text-purple-400">{avg5minConfidence}%</span>
              </div>
              <div className="h-3 bg-slate-700/60 rounded-full overflow-hidden border border-purple-500/30">
                <div
                  className="h-full bg-gradient-to-r from-purple-600 to-purple-400 rounded-full transition-all duration-500"
                  style={{ width: `${avg5minConfidence}%` }}
                />
              </div>
            </div>

            <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Diff Between Both</span>
                <span className="text-2xl font-black text-amber-400">{confidenceDiff}%</span>
              </div>
            </div>
          </div>

          {/* RIGHT: Integrated Metrics */}
          <div className="space-y-6">
            {/* INTEGRATED CONFIDENCE - MAIN METRIC */}
            <div className="bg-slate-800/80 border-2 border-emerald-500/40 rounded-lg p-5">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">🎯 INTEGRATED CONFIDENCE</span>
                <span className="text-4xl font-black text-emerald-400">{integratedConfidence}%</span>
              </div>
              <div className="h-4 bg-slate-700/60 rounded-full overflow-hidden border border-emerald-500/30">
                <div
                  className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full transition-all duration-500 shadow-lg shadow-emerald-500/40"
                  style={{ width: `${integratedConfidence}%` }}
                />
              </div>
              <div className="text-[10px] text-gray-400 mt-2">= (INDEX + 5-MIN) ÷ 2</div>
            </div>

            {/* ALIGNMENT SCORE */}
            <div className="bg-slate-800/80 border-2 border-cyan-500/40 rounded-lg p-5">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-bold uppercase tracking-wider text-cyan-400">⚔ ALIGNMENT SCORE</span>
                <span className="text-4xl font-black text-cyan-400">{alignmentScore}%</span>
              </div>
              <div className="h-4 bg-slate-700/60 rounded-full overflow-hidden border border-cyan-500/30">
                <div
                  className="h-full bg-gradient-to-r from-cyan-600 to-cyan-400 rounded-full transition-all duration-500 shadow-lg shadow-cyan-500/40"
                  style={{ width: `${alignmentScore}%` }}
                />
              </div>
              <div className="text-[10px] text-gray-400 mt-2">100% = Perfect Match</div>
            </div>

            {/* DIRECTION AGREEMENT */}
            <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Both Agree</span>
                <span className="text-2xl font-black text-emerald-400">{directionAgreement}%</span>
              </div>
              <div className="text-[9px] text-gray-500 mt-1">Symbols: {bullishCount}/3 in same direction</div>
            </div>
          </div>
        </div>

        {/* Trader Decision Helper */}
        <div className="mt-6 pt-6 border-t border-slate-700/50">
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-[9px] font-bold uppercase text-gray-500 mb-2">Trade Confidence</div>
              <div className={`text-sm font-black px-3 py-2 rounded ${
                integratedConfidence >= 70 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50' :
                integratedConfidence >= 50 ? 'bg-amber-500/20 text-amber-400 border border-amber-500/50' :
                'bg-red-500/20 text-red-400 border border-red-500/50'
              }`}>
                {integratedConfidence >= 70 ? '✓ HIGH' : integratedConfidence >= 50 ? '⚠ MEDIUM' : '✗ LOW'}
              </div>
            </div>
            <div className="text-center">
              <div className="text-[9px] font-bold uppercase text-gray-500 mb-2">Agreement Quality</div>
              <div className={`text-sm font-black px-3 py-2 rounded ${
                alignmentScore >= 90 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50' :
                alignmentScore >= 75 ? 'bg-amber-500/20 text-amber-400 border border-amber-500/50' :
                'bg-red-500/20 text-red-400 border border-red-500/50'
              }`}>
                {alignmentScore >= 90 ? '✓ STRONG' : alignmentScore >= 75 ? '⚠ GOOD' : '✗ WEAK'}
              </div>
            </div>
            <div className="text-center">
              <div className="text-[9px] font-bold uppercase text-gray-500 mb-2">Direction Synced</div>
              <div className={`text-sm font-black px-3 py-2 rounded ${
                directionAgreement >= 67 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50' :
                'bg-amber-500/20 text-amber-400 border border-amber-500/50'
              }`}>
                {directionAgreement >= 67 ? '✓ YES' : '⚠ PARTIAL'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Three-Symbol Grid - ALWAYS VISIBLE */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {(['NIFTY', 'BANKNIFTY', 'SENSEX'] as const).map(symbol => (
          <SignalCard key={symbol} data={liveData[symbol]} />
        ))}
      </div>

      {/* Footer */}
      <div className="text-xs text-gray-500 text-center pt-4 border-t border-slate-700/30 mt-6 pt-6">
        <div className="space-y-1">
          <p>✓ INDEX CONFIDENCE • ⚡ 5-MIN PREDICTION • 🎯 INTEGRATED ALIGNMENT</p>
          <p>🟢 Real-time data flowing</p>
        </div>
      </div>
    </div>
  );
}
