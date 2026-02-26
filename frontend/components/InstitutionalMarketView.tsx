'use client';

import React, { memo, useMemo, useEffect, useState, useCallback } from 'react';
import { API_CONFIG } from '@/lib/api-config';

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
  livePrice?: number; // Live price from WebSocket
}

/**
 * Smart Money Flow • Order Structure Intelligence
 * LIVE Data version - Fetches real-time order flow, fair value gaps, order blocks, market imbalances
 * 
 * Shows: Order Flow + Institutional Positioning + FVG + Order Blocks + Market Imbalances
 */
const InstitutionalMarketView = memo<InstitutionalMarketViewProps>(({ symbol, marketStatus = 'CLOSED', livePrice }) => {
  const [data, setData] = useState<SmartMoneyData | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Fetch data directly for this symbol
  const fetchData = useCallback(async () => {
    try {
      const apiUrl = API_CONFIG.baseUrl;
      if (!apiUrl) {
        setError('API URL not configured');
        return;
      }
      
      const url = `${apiUrl}/api/analysis/analyze/${symbol}`;
      console.log(`[${symbol}] Fetching from: ${url}`);
      
      const response = await fetch(url, {
        cache: 'no-store',
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const analysisData = await response.json();
      console.log(`[${symbol}] Got data:`, analysisData);
      
      setIsConnected(true);
      setError(null);
      
      // Transform backend data to SmartMoneyData
      if (analysisData) {
        const indicators = analysisData.indicators || {};
        
        // Calculate buy volume ratio from volume data
        const volumeRatio = indicators.volume_ratio || 0.5;
        // 🔥 FIX: Check if volume_ratio is already 0-100 or 0-1
        const buyVolumeRatio = volumeRatio > 1 ? 
          Math.round(volumeRatio) :  // Already percentage (0-100)
          Math.round(volumeRatio * 100);  // Need to convert from 0-1
        
        console.log(`[${symbol}] Volume Ratio Check:`, {
          raw_volume_ratio: volumeRatio,
          is_percentage: volumeRatio > 1,
          buyVolumeRatio
        });
        
        // 🔥 DERIVE MARKET IMBALANCE from multiple sources
        // Priority: EMA alignment → Volume ratio → Candle strength → Trend
        let marketImbalance = "NEUTRAL";
        
        // Check EMA alignment first
        const emasAlignment = String(indicators.ema_alignment || '').toUpperCase();
        if (emasAlignment.includes('BULLISH')) {
          marketImbalance = "BUY_IMBALANCE";
        } else if (emasAlignment.includes('BEARISH')) {
          marketImbalance = "SELL_IMBALANCE";
        }
        // Fallback: Check volume ratio (>55% buy = imbalance)
        else if (buyVolumeRatio > 60) {
          marketImbalance = "BUY_IMBALANCE";
        } else if (buyVolumeRatio < 40) {
          marketImbalance = "SELL_IMBALANCE";
        }
        // Fallback: Check candle strength with volume-price alignment
        else if (indicators.volume_price_alignment && indicators.candle_strength > 6) {
          const trendStr = String(indicators.trend || '').toUpperCase();
          if (trendStr.includes('UP') || trendStr.includes('BULL')) {
            marketImbalance = "BUY_IMBALANCE";
          } else if (trendStr.includes('DOWN') || trendStr.includes('BEAR')) {
            marketImbalance = "SELL_IMBALANCE";
          }
        }
        
        console.log(`[${symbol}] Market Imbalance Data:`, {
          emasAlignment,
          buyVolumeRatio,
          marketImbalance,
          volumePrice: indicators.volume_price_alignment,
          candleStrength: indicators.candle_strength,
          trend: indicators.trend
        });
        
        // Calculate volume imbalance
        const volumeImbalance = indicators.volume_price_alignment ? 
          (indicators.candle_strength || 0) / 10 : 0;
        
        // 🔥 DERIVE FAIR VALUE GAPS from VWAP and price position
        const vwapPos = String(indicators.vwap_position || '').toUpperCase();
        // FVG Bullish: Price above VWAP AND bullish EMA OR high buy volume
        const fvgBullish = (vwapPos.includes('ABOVE') && emasAlignment.includes('BULL')) || 
                          (buyVolumeRatio > 65 && emasAlignment.includes('BULL'));
        // FVG Bearish: Price below VWAP AND bearish EMA OR low buy volume
        const fvgBearish = (vwapPos.includes('BELOW') && emasAlignment.includes('BEAR')) || 
                          (buyVolumeRatio < 35 && emasAlignment.includes('BEAR'));
        
        console.log(`[${symbol}] FVG Data:`, {
          vwapPosition: indicators.vwap_position,
          derived_fvg_bullish: fvgBullish,
          derived_fvg_bearish: fvgBearish,
          price: indicators.price,
          vwap: indicators.vwap
        });
        
        console.log(`[${symbol}] Order Blocks:`, {
          support: indicators.support,
          resistance: indicators.resistance,
          prev_day_high: indicators.prev_day_high,
          prev_day_low: indicators.prev_day_low
        });
        
        // 🔥 EXPERT-GRADE SIGNAL DERIVATION - Based on Market Imbalance + Order Flow Conviction
        // Priority: Market Structure >> Order Flow >> Technical Indicators
        let finalSignal = analysisData.signal || "NEUTRAL";
        let finalConfidence = (analysisData.confidence || 0) * 100;
        
        console.log(`[${symbol}] 🎯 SIGNAL ANALYSIS START`, {
          backend_signal: finalSignal,
          backend_confidence: finalConfidence,
          market_imbalance: marketImbalance,
          buy_volume_ratio: buyVolumeRatio + '%',
          order_flow_strength: buyVolumeRatio
        });
        
        // Normalize signal to uppercase for comparison
        const normalizedSignal = String(finalSignal || '').toUpperCase();
        const normalizedEMA = String(indicators.ema_alignment || '').toUpperCase();
        
        // 🔴 TIER 1: MARKET IMBALANCE (Strongest Signal Source)
        // Market structure ALWAYS takes priority over other indicators
        if (marketImbalance === 'SELL_IMBALANCE') {
          // SELL_IMBALANCE = More sellers than buyers
          // Confidence = How extreme the order flow is
          finalSignal = "SELL";
          // If extreme imbalance (< 40% buy), very high confidence
          if (buyVolumeRatio < 40) {
            finalConfidence = Math.min(99, 100 - buyVolumeRatio); // 1% buy = 99% confidence
            console.log(`[${symbol}] 🔴 TIER 1: EXTREME SELL_IMBALANCE - Very low buy ratio (${buyVolumeRatio}%)`);
          } else {
            finalConfidence = Math.min(85, 70 + (50 - buyVolumeRatio)); // Scale from 70-85%
            console.log(`[${symbol}] 🔴 TIER 1: SELL_IMBALANCE at ${buyVolumeRatio}% buy`);
          }
        } 
        else if (marketImbalance === 'BUY_IMBALANCE') {
          // BUY_IMBALANCE = More buyers than sellers
          // Confidence = How extreme the order flow is
          finalSignal = "BUY";
          // If extreme imbalance (> 60% buy), very high confidence
          if (buyVolumeRatio > 60) {
            finalConfidence = Math.min(99, buyVolumeRatio); // 99% buy = 99% confidence
            console.log(`[${symbol}] 🟢 TIER 1: EXTREME BUY_IMBALANCE - Very high buy ratio (${buyVolumeRatio}%)`);
          } else {
            finalConfidence = Math.min(85, 70 + (buyVolumeRatio - 50)); // Scale from 70-85%
            console.log(`[${symbol}] 🟢 TIER 1: BUY_IMBALANCE at ${buyVolumeRatio}% buy`);
          }
        }
        // 🟡 TIER 2: EXTREME ORDER FLOW (If imbalance is NEUTRAL but order flow is extreme)
        else if (normalizedSignal === 'NEUTRAL' || normalizedSignal === 'WAIT' || finalConfidence < 50) {
          console.log(`[${symbol}] 📊 TIER 2: Checking order flow (imbalance is ${marketImbalance})...`);
          
          // If order flow is extreme (< 35% or > 65%), use it as primary signal
          if (buyVolumeRatio < 35) {
            finalSignal = "SELL";
            finalConfidence = Math.min(90, 100 - buyVolumeRatio); // 20% buy = 80% confidence
            console.log(`[${symbol}] 🔴 TIER 2: EXTREME SELL from order flow (${buyVolumeRatio}% buy)`);
          } else if (buyVolumeRatio > 65) {
            finalSignal = "BUY";
            finalConfidence = Math.min(90, buyVolumeRatio); // 80% buy = 80% confidence
            console.log(`[${symbol}] 🟢 TIER 2: EXTREME BUY from order flow (${buyVolumeRatio}% buy)`);
          }
          // 🟠 TIER 3: EMA Alignment + Candle Strength
          else if (normalizedEMA.includes('BULL') && (indicators.ema_alignment_confidence || 0) > 30) {
            finalSignal = "BUY";
            finalConfidence = Math.max(finalConfidence, (indicators.ema_alignment_confidence || 0) * 100);
            console.log(`[${symbol}] 🟢 TIER 3: BUY from EMA alignment (${(indicators.ema_alignment_confidence || 0) * 100}%)`);
          } else if (normalizedEMA.includes('BEAR') && (indicators.ema_alignment_confidence || 0) > 30) {
            finalSignal = "SELL";
            finalConfidence = Math.max(finalConfidence, (indicators.ema_alignment_confidence || 0) * 100);
            console.log(`[${symbol}] 🔴 TIER 3: SELL from EMA alignment (${(indicators.ema_alignment_confidence || 0) * 100}%)`);
          }
          // 🟠 TIER 4: Moderate order flow ratios (45-55% = undecided)
          else if (buyVolumeRatio > 55) {
            finalSignal = "BUY";
            finalConfidence = Math.max(finalConfidence, buyVolumeRatio - 10);
            console.log(`[${symbol}] 🟢 TIER 4: MODERATE BUY from order flow (${buyVolumeRatio}%)`);
          } else if (buyVolumeRatio < 45) {
            finalSignal = "SELL";
            finalConfidence = Math.max(finalConfidence, 100 - buyVolumeRatio - 10);
            console.log(`[${symbol}] 🔴 TIER 4: MODERATE SELL from order flow (${buyVolumeRatio}%)`);
          }
        }
        
        // 📈 MARKET STATUS ADJUSTMENT
        // During LIVE trading: boost confidence
        // During CLOSED/PRE_OPEN: reduce confidence
        if (marketStatus === 'LIVE') {
          finalConfidence = Math.min(99, finalConfidence + 5); // +5% boost during live
          console.log(`[${symbol}] 📈 Market LIVE: +5% to confidence → ${Math.round(finalConfidence)}%`);
        } else if (marketStatus === 'CLOSED' || marketStatus === 'OFFLINE') {
          finalConfidence = Math.max(30, finalConfidence - 15); // -15% penalty when closed
          console.log(`[${symbol}] 📊 Market CLOSED: -15% penalty → ${Math.round(finalConfidence)}%`);
        }
        
        // Ensure confidence is in valid range (0-100)
        finalConfidence = Math.max(0, Math.min(100, finalConfidence));
        
        console.log(`[${symbol}] Final Signal After Derivation:`, {
          finalSignal,
          finalConfidence: Math.round(finalConfidence),
          buyVolumeRatio,
          marketImbalance,
          emasAlignment: normalizedEMA,
          marketStatus
        });
        
        // 🔥 COMPREHENSIVE DEBUG: Show all sources together
        console.group(`[${symbol}] 🎯 EXPERT SIGNAL ANALYSIS COMPLETE`);
        console.log('🚨 FINAL SIGNAL:', {
          signal: finalSignal,
          confidence: Math.round(finalConfidence) + '%',
          market_status: marketStatus
        });
        console.log('💼 MARKET STRUCTURE:', {
          market_imbalance: marketImbalance,
          buy_volume_percentage: buyVolumeRatio + '%',
          sell_volume_percentage: (100 - buyVolumeRatio) + '%',
          order_flow_conviction: buyVolumeRatio < 35 ? 'EXTREME SELL' : 
                                 buyVolumeRatio > 65 ? 'EXTREME BUY' : 
                                 'MODERATE'
        });
        console.log('📈 TECHNICAL INDICATORS:', {
          ema_alignment: indicators.ema_alignment,
          ema_alignment_confidence: (indicators.ema_alignment_confidence || 0) * 100 + '%',
          candle_strength: (indicators.candle_strength || 0).toFixed(2),
          volume_price_alignment: indicators.volume_price_alignment,
          trend: indicators.trend
        });
        console.log('📊 PRICE & SUPPORT:', {
          current_price: indicators.price,
          support: indicators.support,
          resistance: indicators.resistance,
          vwap: indicators.vwap,
          vwap_position: indicators.vwap_position
        });
        console.log('⏱️ TIMESTAMP:', new Date().toLocaleTimeString('en-IN'));
        console.groupEnd();
        
        
        const smartMoneyData: SmartMoneyData = {
          symbol: symbol,
          symbol_name: analysisData.symbol_name || symbol,
          smart_money_signal: finalSignal,
          smart_money_confidence: finalConfidence,
          order_flow_strength: buyVolumeRatio,
          buy_volume_ratio: buyVolumeRatio,
          sell_volume_ratio: (100 - buyVolumeRatio),
          volume_imbalance: volumeImbalance,
          fair_value_gap_bullish: fvgBullish,
          fair_value_gap_bearish: fvgBearish,
          order_block_bullish: indicators.support || null,
          order_block_bearish: indicators.resistance || null,
          market_imbalance: marketImbalance,
          current_price: livePrice || indicators.price || 0,
          current_volume: indicators.volume || 0,
          current_oi: indicators.oi || 0,
          timestamp: new Date().toISOString()
        };
        
        setData(smartMoneyData);
      }
    } catch (err) {
      console.error(`[${symbol}] Fetch error:`, err);
      setIsConnected(false);
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    }
  }, [symbol, livePrice]);

  // Poll for data every 3 seconds
  useEffect(() => {
    // Fetch immediately
    fetchData();
    
    // Set up interval for polling
    const interval = setInterval(() => {
      fetchData();
    }, 3000);
    
    return () => clearInterval(interval);
  }, [fetchData]);

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

    const { smart_money_signal, smart_money_confidence } = data;
    const symbolName = data.symbol_name || data.symbol || symbol;
    
    let signal = smart_money_signal || 'NEUTRAL';
    // 🔥 FIX: Don't re-cap the confidence, it's already been calculated properly
    let confidence = Math.round(smart_money_confidence || 0);
    
    // Ensure confidence stays in valid range
    confidence = Math.max(0, Math.min(100, confidence));
    
    let badgeEmoji = '⚪';
    let signalColor = 'bg-amber-500/20 border-amber-500/40 text-amber-300';
    let textColor = 'text-amber-300';

    // Determine colors and emoji based on signal
    if (signal === 'STRONG_BUY' || signal === 'STRONG BUY') {
      badgeEmoji = '🚀';
      signalColor = 'bg-green-500/20 border-green-500/50 text-green-300';
      textColor = 'text-green-300';
    } else if (signal === 'BUY' || signal === 'BULLISH') {
      badgeEmoji = '📈';
      signalColor = 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300';
      textColor = 'text-emerald-300';
    } else if (signal === 'STRONG_SELL' || signal === 'STRONG SELL') {
      badgeEmoji = '📉';
      signalColor = 'bg-red-500/20 border-red-500/50 text-red-300';
      textColor = 'text-red-300';
    } else if (signal === 'SELL' || signal === 'BEARISH') {
      badgeEmoji = '📊';
      signalColor = 'bg-rose-500/20 border-rose-500/40 text-rose-300';
      textColor = 'text-rose-300';
    }

    return { signal, badgeEmoji, signalColor, textColor, confidence, symbol: symbolName };
  }, [data, marketStatus]);

  // Loading state
  const loading = !data && !isConnected;
  const hasError = error && !data;

  if (loading) {
    return (
      <div className="border-2 border-purple-500/30 rounded-xl p-3 sm:p-4 transition-all duration-300 backdrop-blur-sm bg-gradient-to-br from-purple-900/10 via-purple-950/5 to-purple-900/5 animate-pulse">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h4 className="font-bold text-white text-base">Smart Money</h4>
          <div className="text-[10px] font-semibold text-white/60">
            {isConnected ? 'Fetching data...' : 'Connecting...'}
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (hasError) {
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
              {data.order_flow_strength ? `${Math.round(data.order_flow_strength)}% Buy` : '50% Neutral'}
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
              {(data.market_imbalance || 'NEUTRAL').includes('BUY') ? '🟢 BUY' :
               (data.market_imbalance || 'NEUTRAL').includes('SELL') ? '🔴 SELL' :
               '⚪ NEUTRAL'} • {data.market_imbalance || 'NEUTRAL'}
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

