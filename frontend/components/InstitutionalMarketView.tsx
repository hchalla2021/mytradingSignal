'use client';

import React, { memo, useMemo, useEffect, useState } from 'react';

interface SmartMoneyData {
  symbol: string;
  symbol_name?: string;
  smart_money_signal: string;
  smart_money_confidence: number;
  order_flow_strength?: number;
  buy_volume_ratio?: number;
  sell_volume_ratio?: number;
  volume_imbalance?: number;
  fair_value_gap_bullish?: boolean;
  fair_value_gap_bearish?: boolean;
  order_block_bullish?: number;
  order_block_bearish?: number;
  market_imbalance?: string;
  current_price?: number;
  current_volume?: number;
  current_oi?: number;
  timestamp?: string;
}

interface InstitutionalMarketViewProps {
  symbol: string;
  marketStatus?: 'LIVE' | 'OFFLINE' | 'CLOSED' | 'PRE_OPEN' | 'FREEZE';
}

/**
 * Smart Money Flow • Order Structure Intelligence
 * LIVE Data version - Fetches real-time order flow, fair value gaps, order blocks, market imbalances
 * 
 * Shows: Order Flow + Institutional Positioning + FVG + Order Blocks + Market Imbalances
 */
const InstitutionalMarketView = memo<InstitutionalMarketViewProps>(({ symbol, marketStatus = 'CLOSED' }) => {
  const [data, setData] = useState<SmartMoneyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch LIVE smart money flow data
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
        const response = await fetch(`${apiUrl}/api/analysis/smart-money/${symbol}`);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        const result = await response.json();
        if (result && result.smart_money_signal !== undefined) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        console.error(`Error fetching smart money data for ${symbol}:`, err);
        setError('Unable to fetch smart money data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000); // 🔥 FIX: Reduced from 30s to 5s for live updates
    
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
        status: marketStatus || 'CLOSED',
        symbol: symbol || 'INDEX'
      };
    }

    const { smart_money_signal, smart_money_confidence } = data;
    const status = marketStatus || 'CLOSED';
    const symbolName = data.symbol_name || data.symbol || symbol;
    
    let signal = smart_money_signal || 'NEUTRAL';
    let confidence = Math.round((smart_money_confidence || 0) / 100 * 100) || Math.round(smart_money_confidence || 0);
    let badgeEmoji = '⚪';
    let signalColor = 'bg-amber-500/20 border-amber-500/40 text-amber-300';
    let textColor = 'text-amber-300';

    // Tier 1: Use backend smart money signal if strong
    if (signal === 'STRONG_BUY' || signal === 'STRONG BUY') {
      badgeEmoji = '🚀';
      signalColor = 'bg-green-500/20 border-green-500/50 text-green-300';
      textColor = 'text-green-300';
      confidence = Math.min(95, Math.max(confidence, 70));
    } else if (signal === 'BUY') {
      badgeEmoji = '📈';
      signalColor = 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300';
      textColor = 'text-emerald-300';
      confidence = Math.min(85, Math.max(confidence, 60));
    } else if (signal === 'STRONG_SELL' || signal === 'STRONG SELL') {
      badgeEmoji = '📉';
      signalColor = 'bg-red-500/20 border-red-500/50 text-red-300';
      textColor = 'text-red-300';
      confidence = Math.min(95, Math.max(confidence, 70));
    } else if (signal === 'SELL') {
      badgeEmoji = '📊';
      signalColor = 'bg-rose-500/20 border-rose-500/40 text-rose-300';
      textColor = 'text-rose-300';
      confidence = Math.min(85, Math.max(confidence, 60));
    }
    // Tier 2: Fallback to order flow if smart money is neutral
    else if (signal === 'NEUTRAL') {
      const orderFlowStrength = data.order_flow_strength || 50;
      if (orderFlowStrength > 60) {
        signal = 'BUY';
        badgeEmoji = '📈';
        signalColor = 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300';
        textColor = 'text-emerald-300';
        confidence = Math.min(75, 50 + (orderFlowStrength - 60));
      } else if (orderFlowStrength < 40) {
        signal = 'SELL';
        badgeEmoji = '📊';
        signalColor = 'bg-rose-500/20 border-rose-500/40 text-rose-300';
        textColor = 'text-rose-300';
        confidence = Math.min(75, 50 + (40 - orderFlowStrength));
      }
    }
    // Tier 3: Use volume imbalance direction
    if (signal === 'NEUTRAL' && Math.abs(data.volume_imbalance || 0) > 5) {
      const volumeImbalance = data.volume_imbalance || 0;
      if (volumeImbalance > 5) {
        signal = 'BUY';
        badgeEmoji = '📈';
        signalColor = 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300';
        textColor = 'text-emerald-300';
        confidence = Math.min(65, 45 + Math.abs(volumeImbalance) / 2);
      } else if (volumeImbalance < -5) {
        signal = 'SELL';
        badgeEmoji = '📊';
        signalColor = 'bg-rose-500/20 border-rose-500/40 text-rose-300';
        textColor = 'text-rose-300';
        confidence = Math.min(65, 45 + Math.abs(volumeImbalance) / 2);
      }
    }

    return { signal, badgeEmoji, signalColor, textColor, confidence, status, symbol: symbolName };
  }, [data, symbol, marketStatus]);

  // Loading state
  if (loading && !data) {
    return (
      <div className="border-2 border-purple-500/30 rounded-xl p-3 sm:p-4 transition-all duration-300 backdrop-blur-sm bg-gradient-to-br from-purple-900/10 via-purple-950/5 to-purple-900/5 animate-pulse">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h4 className="font-bold text-white text-base">Smart Money</h4>
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
    <div suppressHydrationWarning className="border-2 border-purple-500/30 rounded-xl p-3 sm:p-4 transition-all duration-300 backdrop-blur-sm bg-gradient-to-br from-purple-900/10 via-purple-950/5 to-purple-900/5 hover:border-purple-500/50 hover:shadow-purple-500/30 shadow-xl shadow-purple-500/15">
      
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
        <div suppressHydrationWarning className="text-lg sm:text-xl font-bold tracking-tight text-white drop-shadow-lg">
          {signal === 'STRONG_BUY' || signal === 'STRONG BUY' ? '🚀 STRONG BUY' :
           signal === 'BUY' ? '📈 BUY' :
           signal === 'STRONG_SELL' || signal === 'STRONG SELL' ? '📉 STRONG SELL' :
           signal === 'SELL' ? '📊 SELL' :
           '⚪ NEUTRAL'}
        </div>
        <p className="text-xs text-white/60 mt-0.5 font-medium">
          Smart Money • Order Structure Intelligence
        </p>
      </div>

      {/* Order Flow + Fair Value Gaps + Order Blocks + Market Imbalance Summary */}
      {data && (
        <div className="space-y-2 text-[11px]">
          
          {/* Order Flow (Buy/Sell Ratio) */}
          <div className="flex justify-between items-center p-2 rounded-lg border border-purple-500/30 bg-purple-500/5">
            <span className="text-white font-semibold flex items-center gap-1">
              📊 Order Flow
            </span>
            <span suppressHydrationWarning className={`font-bold ${
              (data.order_flow_strength || 50) > 60 ? 'text-green-300' : 
              (data.order_flow_strength || 50) < 40 ? 'text-red-300' : 
              'text-yellow-300'
            }`}>
              {data.buy_volume_ratio ? `${Math.round(data.buy_volume_ratio)}% Buy` : '50% Neutral'}
            </span>
          </div>

          {/* Fair Value Gaps (FVG) */}
          {(data.fair_value_gap_bullish || data.fair_value_gap_bearish) && (
            <div className="flex justify-between items-center p-2 rounded-lg border border-purple-500/30 bg-purple-500/5">
              <span className="text-white font-semibold flex items-center gap-1">
                💎 Fair Value Gap
              </span>
              <span suppressHydrationWarning className={`font-bold ${
                data.fair_value_gap_bullish ? 'text-green-300' : 'text-red-300'
              }`}>
                {data.fair_value_gap_bullish ? '🟢 Bullish' : '🔴 Bearish'}
              </span>
            </div>
          )}

          {/* Order Blocks */}
          {(data.order_block_bullish !== null || data.order_block_bearish !== null) && (
            <div className="flex justify-between items-center p-2 rounded-lg border border-purple-500/30 bg-purple-500/5">
              <span className="text-white font-semibold flex items-center gap-1">
                🧱 Order Block
              </span>
              <span suppressHydrationWarning className={`font-bold ${
                data.order_block_bullish !== null ? 'text-green-300' : 'text-red-300'
              }`}>
                {data.order_block_bullish ? `₹${data.order_block_bullish.toFixed(2)}` : 
                 data.order_block_bearish ? `₹${data.order_block_bearish.toFixed(2)}` : 
                 'N/A'}
              </span>
            </div>
          )}

          {/* Market Imbalance */}
          <div className="flex justify-between items-center p-2 rounded-lg border border-purple-500/30 bg-purple-500/5">
            <span className="text-white font-semibold flex items-center gap-1">
              ⚖️ Imbalance
            </span>
            <span suppressHydrationWarning className={`font-bold ${
              (data.market_imbalance || 'NEUTRAL').includes('BUY') ? 'text-green-300' : 
              (data.market_imbalance || 'NEUTRAL').includes('SELL') ? 'text-red-300' : 
              'text-yellow-300'
            }`}>
              {data.market_imbalance || 'NEUTRAL'}
            </span>
          </div>

          {/* Volume Imbalance Indicator */}
          {data.volume_imbalance !== undefined && (
            <div className="flex justify-between items-center p-2 rounded-lg border border-purple-500/30 bg-purple-500/5">
              <span className="text-white font-semibold flex items-center gap-1">
                📈 Vol Imbalance
              </span>
              <span suppressHydrationWarning className={`font-bold ${
                (data.volume_imbalance || 0) > 0 ? 'text-green-300' : 'text-red-300'
              }`}>
                {(data.volume_imbalance || 0) > 0 ? '🟢 Buy' : '🔴 Sell'} ({Math.abs(data.volume_imbalance || 0).toFixed(1)})
              </span>
            </div>
          )}

          {/* Current Price & Volume */}
          {data.current_price && (
            <div className="flex justify-between items-center p-2 rounded-lg border border-purple-500/30 bg-purple-500/5">
              <span className="text-white font-semibold">₹ Price</span>
              <span className="font-bold text-white">
                ₹{(data.current_price ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </span>
            </div>
          )}

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

InstitutionalMarketView.displayName = 'InstitutionalMarketView';

export { InstitutionalMarketView };
export default InstitutionalMarketView;

