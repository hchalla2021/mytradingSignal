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
      <div className="relative rounded-2xl overflow-hidden border border-white/8 bg-gradient-to-br from-[#0d1117]/98 via-[#161b22]/90 to-[#0d1117]/98 backdrop-blur-xl p-4 animate-pulse">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        <div className="flex items-center justify-between mb-3">
          <div className="space-y-1.5">
            <div className="h-2 w-24 bg-white/8 rounded" />
            <div className="h-3 w-36 bg-white/8 rounded" />
          </div>
          <div className="h-8 w-8 bg-white/8 rounded-full" />
        </div>
        <div className="h-16 bg-white/5 rounded-xl mb-2" />
        <div className="grid grid-cols-2 gap-1.5">
          <div className="h-10 bg-white/4 rounded-lg" />
          <div className="h-10 bg-white/4 rounded-lg" />
          <div className="h-10 bg-white/4 rounded-lg" />
          <div className="h-10 bg-white/4 rounded-lg" />
        </div>
      </div>
    );
  }

  // Error state
  if (hasError) {
    return (
      <div className="relative rounded-2xl overflow-hidden border border-red-500/20 bg-gradient-to-br from-red-950/30 via-[#0d1117]/90 to-[#0d1117]/98 backdrop-blur-xl p-4">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-red-500/30 to-transparent" />
        <p className="text-[9px] text-slate-500 uppercase tracking-[0.15em] font-medium mb-1">Smart Money Flow</p>
        <p className="text-red-400 text-sm font-semibold">{symbol} — Connection Error</p>
        <p className="text-red-500/60 text-xs mt-1">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const { signal, signalColor, confidence, symbol: symbolName } = signalAnalysis;

  // Derived display values
  const buyRatio = Math.round(data.order_flow_strength || 50);
  const sellRatio = 100 - buyRatio;
  const imbalanceType = data.market_imbalance || 'NEUTRAL';
  const orderBlockLevel = data.order_block_bullish || data.order_block_bearish || null;

  // 5-min pre-production intelligence
  const volBuild = buyRatio > 55 ? 'BULLISH' : buyRatio < 45 ? 'BEARISH' : 'NEUTRAL';
  const signalForming = imbalanceType.includes('BUY') ? 'BUY' : imbalanceType.includes('SELL') ? 'SELL' : 'WAIT';
  const convictionLevel = confidence >= 75 ? 'HIGH' : confidence >= 55 ? 'MODERATE' : 'LOW';

  // Signal accent colors (border + glow)
  const accentBorder = signal.includes('BUY') ? 'border-emerald-500/35' : signal.includes('SELL') ? 'border-red-500/35' : 'border-amber-500/30';
  const accentGlow = signal.includes('BUY') ? 'shadow-emerald-500/10' : signal.includes('SELL') ? 'shadow-red-500/10' : 'shadow-amber-500/8';
  const accentCorner = signal.includes('BUY') ? 'bg-emerald-500' : signal.includes('SELL') ? 'bg-red-500' : 'bg-amber-500';
  const accentText = signal.includes('BUY') ? 'text-emerald-300' : signal.includes('SELL') ? 'text-red-300' : 'text-amber-300';
  const accentBarBg = signal.includes('BUY') ? 'from-emerald-500 to-emerald-300' : signal.includes('SELL') ? 'from-red-600 to-red-400' : 'from-amber-500 to-amber-300';
  const signalLabel = signal === 'STRONG_BUY' || signal === 'STRONG BUY' ? '▲▲ STRONG BUY'
    : signal === 'BUY' || signal === 'BULLISH' ? '▲ BUY'
    : signal === 'STRONG_SELL' || signal === 'STRONG SELL' ? '▼▼ STRONG SELL'
    : signal === 'SELL' || signal === 'BEARISH' ? '▼ SELL'
    : '◆ NEUTRAL';

  return (
    <div suppressHydrationWarning className={`relative rounded-2xl overflow-hidden border ${accentBorder} shadow-lg ${accentGlow} backdrop-blur-xl bg-[#0b0f1a]`}>

      {/* Top reflector shimmer */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent pointer-events-none" />
      {/* Corner accent glow */}
      <div className={`absolute top-0 right-0 w-16 h-16 rounded-bl-full opacity-10 ${accentCorner} pointer-events-none`} />

      {/* ── HEADER BAR ── */}
      <div className="relative px-4 py-3 flex items-center justify-between border-b border-white/[0.05]">
        <div>
          <p className="text-[9px] text-slate-500 uppercase tracking-[0.18em] font-medium">Smart Money Flow</p>
          <p className="text-[11px] font-semibold text-slate-300 mt-0.5 tracking-wide">Order Structure Intelligence</p>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-[9px] text-slate-400 font-medium">{marketStatus}</span>
          </div>
          <span className="text-[9px] text-slate-600 font-medium">{symbolName}</span>
        </div>
      </div>

      {/* ── REFLECTOR: Main Signal Panel ── */}
      <div className="relative mx-3 mt-3 rounded-xl overflow-hidden">
        {/* Reflective tinted background — very subtle, dark */}
        <div className={`absolute inset-0 opacity-[6%] ${
          signal.includes('BUY') ? 'bg-gradient-to-b from-emerald-400 to-transparent'
          : signal.includes('SELL') ? 'bg-gradient-to-b from-red-400 to-transparent'
          : 'bg-gradient-to-b from-slate-400 to-transparent'
        } pointer-events-none`} />
        {/* Reflection overlay — top micro-shine + bottom depth */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.03] via-transparent to-black/30 pointer-events-none" />

        <div className={`relative border rounded-xl p-3.5 bg-[#0d1117]/80 ${accentBorder}`}>
          {/* Signal label + confidence value */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <div suppressHydrationWarning className={`text-xl font-black tracking-tight ${accentText}`}>
                {signalLabel}
              </div>
              <p className="text-[9px] text-white/35 mt-0.5 uppercase tracking-wider font-medium">
                Institutional · Order Flow
              </p>
            </div>
            <div className="text-right shrink-0">
              <div suppressHydrationWarning className="text-2xl font-black text-white tabular-nums leading-none">{confidence}%</div>
              <p className="text-[9px] text-white/35 font-medium mt-0.5">Confidence</p>
            </div>
          </div>

          {/* Confidence progress bar */}
          <div className="mt-2.5 h-[3px] bg-black/40 rounded-full overflow-hidden">
            <div
              suppressHydrationWarning
              className={`h-full rounded-full bg-gradient-to-r ${accentBarBg} transition-all duration-1000 ease-out`}
              style={{ width: `${confidence}%` }}
            />
          </div>
        </div>
      </div>

      {/* ── CONFERENCE PANEL: Market Intelligence Grid (2×2) ── */}
      <div className="px-3 pt-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="h-px flex-1 bg-white/[0.05]" />
          <p className="text-[8px] text-slate-600 uppercase tracking-[0.18em] font-semibold">Market Intelligence</p>
          <div className="h-px flex-1 bg-white/[0.05]" />
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {/* Order Flow */}
          <div className="p-2.5 rounded-lg bg-[#0d1117] border border-white/[0.06]">
            <p className="text-[8px] text-slate-600 uppercase tracking-wide mb-1">Order Flow</p>
            <p suppressHydrationWarning className={`text-[13px] font-bold ${
              buyRatio > 60 ? 'text-emerald-400' : buyRatio < 40 ? 'text-red-400' : 'text-amber-400'
            }`}>
              {buyRatio}% Buy
            </p>
            <p className="text-[8px] text-slate-600 mt-0.5">{sellRatio}% Sell</p>
          </div>

          {/* Market Imbalance */}
          <div className="p-2.5 rounded-lg bg-[#0d1117] border border-white/[0.06]">
            <p className="text-[8px] text-slate-600 uppercase tracking-wide mb-1">Imbalance</p>
            <p suppressHydrationWarning className={`text-[13px] font-bold ${
              imbalanceType.includes('BUY') ? 'text-emerald-400'
              : imbalanceType.includes('SELL') ? 'text-red-400'
              : 'text-amber-400'
            }`}>
              {imbalanceType.includes('BUY') ? 'BUY ZONE'
               : imbalanceType.includes('SELL') ? 'SELL ZONE'
               : 'NEUTRAL'}
            </p>
          </div>

          {/* Fair Value Gap */}
          <div className="p-2.5 rounded-lg bg-[#0d1117] border border-white/[0.06]">
            <p className="text-[8px] text-slate-600 uppercase tracking-wide mb-1">Fair Value Gap</p>
            <p suppressHydrationWarning className={`text-[13px] font-bold ${
              data.fair_value_gap_bullish ? 'text-emerald-400'
              : data.fair_value_gap_bearish ? 'text-red-400'
              : 'text-slate-500'
            }`}>
              {data.fair_value_gap_bullish ? 'BULLISH' : data.fair_value_gap_bearish ? 'BEARISH' : 'CLOSED'}
            </p>
          </div>

          {/* Order Block */}
          <div className="p-2.5 rounded-lg bg-[#0d1117] border border-white/[0.06]">
            <p className="text-[8px] text-slate-600 uppercase tracking-wide mb-1">Order Block</p>
            <p suppressHydrationWarning className={`text-[13px] font-bold ${
              data.order_block_bullish ? 'text-emerald-400'
              : data.order_block_bearish ? 'text-red-400'
              : 'text-slate-500'
            }`}>
              {orderBlockLevel ? `₹${orderBlockLevel.toFixed(0)}` : 'N/A'}
            </p>
          </div>
        </div>
      </div>

      {/* ── 5-MIN PREDICTION SECTION ── */}
      <div className="mx-3 mt-2.5 mb-3 rounded-xl overflow-hidden border border-white/[0.06] bg-[#0d1117]">
        <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

        <div className="p-3">
          {(() => {
            // Direction from signal
            const isBull = signal.includes('BUY') || signal === 'BULLISH';
            const isBear = signal.includes('SELL') || signal === 'BEARISH';
            const predDir = isBull ? 'LONG' : isBear ? 'SHORT' : 'FLAT';
            const dirIcon = isBull ? '▲' : isBear ? '▼' : '─';
            const dirColor  = isBull ? 'text-emerald-400' : isBear ? 'text-red-400' : 'text-amber-400';
            const dirBorder = isBull ? 'border-emerald-500/40' : isBear ? 'border-red-500/40' : 'border-amber-500/30';
            const dirBg     = isBull ? 'bg-emerald-500/[0.08]' : isBear ? 'bg-red-500/[0.08]' : 'bg-amber-500/[0.05]';

            // Confidence adjustment: OI flow, imbalance, FVG, order-block confirmation
            const flowAligns  = (isBull && volBuild === 'BULLISH') || (isBear && volBuild === 'BEARISH');
            const flowOpp     = (isBull && volBuild === 'BEARISH') || (isBear && volBuild === 'BULLISH');
            const fvgConfirms = (isBull && !!data.fair_value_gap_bullish) || (isBear && !!data.fair_value_gap_bearish);
            const obConfirms  = (isBull && !!data.order_block_bullish)    || (isBear && !!data.order_block_bearish);
            const imbAligns   = (isBull && signalForming === 'BUY') || (isBear && signalForming === 'SELL');

            let adjConf = confidence;
            if (flowAligns)  adjConf += 5;
            if (imbAligns)   adjConf += 4;
            if (fvgConfirms) adjConf += 4;
            if (obConfirms)  adjConf += 3;
            if (flowOpp)     adjConf -= 10;
            adjConf = Math.round(Math.min(95, Math.max(30, adjConf)));

            // Context note
            const confirms = [
              flowAligns  && 'Order Flow',
              imbAligns   && 'Imbalance',
              fvgConfirms && 'FVG',
              obConfirms  && 'Order Block',
            ].filter(Boolean) as string[];
            const ctxNote = flowOpp
              ? '⚠ Flow vs Signal conflict'
              : confirms.length >= 2 ? `${confirms.slice(0,2).join(' + ')} confirm`
              : confirms.length === 1 ? `${confirms[0]} confirms`
              : 'Monitoring structure…';

            return (
              <>
                {/* Header */}
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-[3px] h-3.5 rounded-full ${isBull ? 'bg-emerald-400' : isBear ? 'bg-red-400' : 'bg-amber-400'} animate-pulse`} />
                    <p className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider">5-Min Prediction</p>
                  </div>
                  <span suppressHydrationWarning className={`text-[9px] font-black ${dirColor}`}>{adjConf}% Confidence</span>
                </div>

                {/* Direction pill + confidence bar */}
                <div className={`rounded-lg border ${dirBorder} ${dirBg} px-2.5 py-2 mb-2.5`}>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span suppressHydrationWarning className={`text-sm font-black ${dirColor}`}>{dirIcon} {predDir}</span>
                    <span className="text-[9px] text-slate-500 truncate">{ctxNote}</span>
                    <span suppressHydrationWarning className={`text-sm font-black ${dirColor} shrink-0`}>{adjConf}%</span>
                  </div>
                  <div className="h-[2px] bg-black/40 rounded-full overflow-hidden">
                    <div
                      suppressHydrationWarning
                      className={`h-full rounded-full bg-gradient-to-r ${accentBarBg} transition-all duration-1000 ease-out`}
                      style={{ width: `${adjConf}%` }}
                    />
                  </div>
                </div>

                {/* 3-column intelligence cells */}
                <div className="grid grid-cols-3 gap-1.5">
                  <div className="text-center p-2 rounded-lg bg-black/30 border border-white/[0.05]">
                    <p className="text-[8px] text-slate-600 uppercase tracking-wide mb-1">Order Flow</p>
                    <p suppressHydrationWarning className={`text-[11px] font-bold ${buyRatio > 55 ? 'text-emerald-400' : buyRatio < 45 ? 'text-red-400' : 'text-amber-400'}`}>
                      {buyRatio}% Buy
                    </p>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-black/30 border border-white/[0.05]">
                    <p className="text-[8px] text-slate-600 uppercase tracking-wide mb-1">FVG</p>
                    <p suppressHydrationWarning className={`text-[11px] font-bold ${data.fair_value_gap_bullish ? 'text-emerald-400' : data.fair_value_gap_bearish ? 'text-red-400' : 'text-slate-500'}`}>
                      {data.fair_value_gap_bullish ? '▲ BULL' : data.fair_value_gap_bearish ? '▼ BEAR' : 'CLOSED'}
                    </p>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-black/30 border border-white/[0.05]">
                    <p className="text-[8px] text-slate-600 uppercase tracking-wide mb-1">Conviction</p>
                    <p suppressHydrationWarning className={`text-[11px] font-bold ${convictionLevel === 'HIGH' ? 'text-emerald-400' : convictionLevel === 'MODERATE' ? 'text-amber-400' : 'text-slate-500'}`}>
                      {convictionLevel}
                    </p>
                  </div>
                </div>
              </>
            );
          })()}
        </div>

        <div className="h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
      </div>

      {/* ── FOOTER ── */}
      <div className="px-3 pb-3 flex items-center justify-between -mt-0.5">
        <div className="flex items-center gap-1">
          <div className="w-1 h-1 rounded-full bg-green-500 animate-pulse" />
          <span className="text-[9px] text-slate-600">Live</span>
        </div>
        <span suppressHydrationWarning className="text-[9px] text-slate-600 tabular-nums">
          {new Date(data.timestamp || '').toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      </div>

      {/* Bottom reflector shimmer */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent pointer-events-none" />
    </div>
  );
});

InstitutionalMarketView.displayName = 'InstitutionalMarketView';

export { InstitutionalMarketView };
export default InstitutionalMarketView;

