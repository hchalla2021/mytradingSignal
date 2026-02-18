'use client';

import React, { memo, useMemo, useEffect, useState } from 'react';

interface CandleQualityData {
  symbol: string;
  symbol_name?: string;
  candle_quality_signal: string;
  candle_quality_confidence: number;
  candle_direction: string;
  candle_strength: number;
  body_percent: number;
  volume_above_threshold: boolean;
  fake_spike_detected: boolean;
  conviction_move: boolean;
  momentum_score: number;
  current_price: number;
  current_volume: number;
  open_price: number;
  high_price: number;
  low_price: number;
  timestamp?: string;
}

interface CandleQualityAnalysisProps {
  symbol: string;
}

/**
 * High Volume Candle Scanner
 * LIVE Data version - Real-time Fake Spike Detection, Body Strength, Very Good Volume, Conviction Moves
 * 
 * Detects:
 * - Conviction Moves: High volume + strong body (>60%)
 * - Fake Spikes: Volume spike (>2.5x) but weak body (<40%)
 * - Body Strength: Candle body as % of range
 * - Very Good Volume: Exceptional volume above threshold
 */
const CandleQualityAnalysis = memo<CandleQualityAnalysisProps>(({ symbol }) => {
  const [data, setData] = useState<CandleQualityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch LIVE candle quality data
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
        const response = await fetch(`${apiUrl}/api/analysis/candle-quality/${symbol}`);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        const result = await response.json();
        if (result && result.candle_quality_signal !== undefined) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        console.error(`Error fetching candle quality data for ${symbol}:`, err);
        setError('Unable to fetch candle data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000); // 🔥 FIX: Reduced from 15s to 5s for live updates
    
    return () => clearInterval(interval);
  }, [symbol]);

  const signalAnalysis = useMemo(() => {
    if (!data) {
      return {
        signal: 'NEUTRAL',
        badgeEmoji: '⚪',
        signalColor: 'bg-amber-500/20 border-amber-500/40 text-amber-300',
        textColor: 'text-amber-300',
        confidence: 30,
        symbol: symbol || 'INDEX'
      };
    }

    const { candle_quality_signal, candle_quality_confidence } = data;
    const signal = candle_quality_signal || 'NEUTRAL';
    const confidence = Math.round(candle_quality_confidence) || Math.round(candle_quality_confidence * 100) || 30;
    const symbolName = data.symbol_name || data.symbol || symbol;

    let badgeEmoji = '⚪';
    let signalColor = 'bg-amber-500/20 border-amber-500/40 text-amber-300';
    let textColor = 'text-amber-300';

    if (signal === 'STRONG_BUY' || signal === 'STRONG BUY') {
      badgeEmoji = '🚀';
      signalColor = 'bg-green-500/20 border-green-500/50 text-green-300';
      textColor = 'text-green-300';
    } else if (signal === 'BUY') {
      badgeEmoji = '📈';
      signalColor = 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300';
      textColor = 'text-emerald-300';
    } else if (signal === 'STRONG_SELL' || signal === 'STRONG SELL') {
      badgeEmoji = '📉';
      signalColor = 'bg-red-500/20 border-red-500/50 text-red-300';
      textColor = 'text-red-300';
    } else if (signal === 'SELL') {
      badgeEmoji = '📊';
      signalColor = 'bg-rose-500/20 border-rose-500/40 text-rose-300';
      textColor = 'text-rose-300';
    }

    return { signal, badgeEmoji, signalColor, textColor, confidence, symbol: symbolName };
  }, [data, symbol]);

  // Loading state
  if (loading && !data) {
    return (
      <div className="border-2 border-emerald-500/30 rounded-xl p-3 sm:p-4 transition-all duration-300 backdrop-blur-sm bg-gradient-to-br from-emerald-900/10 via-emerald-950/5 to-emerald-900/5 animate-pulse">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h4 className="font-bold text-white text-base">Candle Scanner</h4>
          <div className="text-[10px] font-semibold text-white/60">Loading...</div>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !data) {
    return (
      <div className="border-2 border-red-500/30 rounded-xl p-3 sm:p-4 transition-all duration-300 backdrop-blur-sm bg-red-900/10">
        <div className="text-red-300 text-sm font-semibold">{symbol}</div>
        <div className="text-red-400 text-xs mt-2">{error}</div>
      </div>
    );
  }

  if (!data) return null;

  const { signal, badgeEmoji, signalColor, textColor, confidence, symbol: symbolName } = signalAnalysis;

  return (
    <div className="border-2 border-emerald-500/30 rounded-xl p-3 sm:p-4 transition-all duration-300 backdrop-blur-sm bg-gradient-to-br from-emerald-900/10 via-emerald-950/5 to-emerald-900/5 hover:border-emerald-500/50 hover:shadow-emerald-500/30 shadow-xl shadow-emerald-500/15">
      
      {/* Symbol & Confidence Header */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <h4 className="font-bold text-white text-base sm:text-lg tracking-tight">
            {symbolName}
          </h4>
          <span className="text-lg sm:text-xl">{badgeEmoji}</span>
        </div>
        <div suppressHydrationWarning className={`text-center px-2.5 py-1 rounded-lg border-2 bg-black/30 ${signalColor}`}>
          <div className="text-[10px] font-semibold text-white/60">Confidence</div>
          <div suppressHydrationWarning className="text-base font-bold text-white">{confidence}%</div>
        </div>
      </div>

      {/* PROMINENT SIGNAL */}
      <div suppressHydrationWarning className={`mb-3 p-3 rounded-lg border-2 ${signalColor}`}>
        <div suppressHydrationWarning className="text-base sm:text-lg font-bold tracking-tight text-white drop-shadow-lg">
          {signal === 'STRONG_BUY' || signal === 'STRONG BUY' ? '🚀 STRONG BUY' :
           signal === 'BUY' ? '📈 BUY' :
           signal === 'STRONG_SELL' || signal === 'STRONG SELL' ? '📉 STRONG SELL' :
           signal === 'SELL' ? '📊 SELL' :
           '⚪ NEUTRAL'}
        </div>
        <p className="text-xs text-white/60 mt-0.5 font-medium">
          Candle Quality • Volume & Body Analysis
        </p>
      </div>

      {/* High Volume Scanner Details */}
      {data && (
        <div className="space-y-2 text-[11px]">
          
          {/* Candle Direction */}
          <div className="flex justify-between items-center p-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
            <span className="text-white font-semibold">📊 Direction</span>
            <span suppressHydrationWarning className={`font-bold ${
              data.candle_direction === 'BULLISH' ? 'text-green-300' :
              data.candle_direction === 'BEARISH' ? 'text-red-300' :
              'text-yellow-300'
            }`}>
              {data.candle_direction === 'BULLISH' ? '📈 Bullish' :
               data.candle_direction === 'BEARISH' ? '📉 Bearish' :
               '⚖️ Doji'}
            </span>
          </div>

          {/* Body Strength */}
          <div className="flex justify-between items-center p-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
            <span className="text-white font-semibold">💪 Body Strength</span>
            <span suppressHydrationWarning className={`font-bold ${
              data.body_percent > 60 ? 'text-green-300' :
              data.body_percent > 30 ? 'text-yellow-300' :
              'text-red-300'
            }`}>
              {data.body_percent.toFixed(1)}%
            </span>
          </div>

          {/* Volume Status - Very Good Volume Indicator */}
          <div className="flex justify-between items-center p-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
            <span className="text-white font-semibold">📈 Volume</span>
            <span suppressHydrationWarning className={`font-bold ${
              data.volume_above_threshold ? 'text-green-300' : 'text-gray-400'
            }`}>
              {data.volume_above_threshold ? `🟢 Very Good (${data.current_volume})` : `⚪ Normal (${data.current_volume})`}
            </span>
          </div>

          {/* Conviction Move Detection */}
          {data.conviction_move && (
            <div className="flex justify-between items-center p-2 rounded-lg border border-green-500/40 bg-green-500/10">
              <span className="text-white font-semibold flex items-center gap-1">
                ⚡ Conviction Move
              </span>
              <span className="font-bold text-green-300 text-[10px]">✅ Detected</span>
            </div>
          )}

          {/* Fake Spike Detection */}
          {data.fake_spike_detected && (
            <div className="flex justify-between items-center p-2 rounded-lg border border-red-500/40 bg-red-500/10">
              <span className="text-white font-semibold flex items-center gap-1">
                ⚠️ Fake Spike
              </span>
              <span className="font-bold text-red-300 text-[10px]">🔴 Alert</span>
            </div>
          )}

          {/* Momentum Score */}
          <div className="flex justify-between items-center p-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
            <span className="text-white font-semibold">🎯 Momentum</span>
            <span suppressHydrationWarning className={`font-bold ${
              data.momentum_score > 60 ? 'text-green-300' :
              data.momentum_score > 40 ? 'text-yellow-300' :
              'text-red-300'
            }`}>
              {data.momentum_score}/100
            </span>
          </div>

          {/* Price Details */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div className="flex flex-col p-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
              <span className="text-[9px] text-white/60 font-semibold">Current</span>
              <span className="font-bold text-white text-xs">₹{(data.current_price ?? 0).toFixed(2)}</span>
            </div>
            <div className="flex flex-col p-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
              <span className="text-[9px] text-white/60 font-semibold">Range</span>
              <span className="font-bold text-white text-xs">H: ₹{(data.high_price ?? data.current_price ?? 0).toFixed(2)}</span>
              <span className="font-bold text-white text-xs">L: ₹{(data.low_price ?? data.current_price ?? 0).toFixed(2)}</span>
            </div>
          </div>

          {/* Live Indicator */}
          <div className="text-[9px] text-slate-400 text-center pt-1 flex items-center justify-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Live • {new Date(data.timestamp || '').toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
});

CandleQualityAnalysis.displayName = 'CandleQualityAnalysis';

export default CandleQualityAnalysis;
