'use client';

import React, { useMemo } from 'react';

interface InstitutionalMarketViewProps {
  symbol: string;
  name: string;
  analysis?: any;
  marketData?: any;
}

const InstitutionalMarketView = ({ 
  symbol = 'NIFTY', 
  name = 'NIFTY 50',
  analysis = null,
  marketData = null
}: InstitutionalMarketViewProps) => {
  
  const metrics = useMemo(() => {
    if (!analysis) return null;
    
    const indicators = analysis.indicators || analysis;

    const price = indicators.price || 0;
    const volume = indicators.volume || 0;
    const volume_ratio = indicators.volume_ratio || 1.0;
    const buy_volume_ratio = indicators.buy_volume_ratio || 50;
    const sell_volume_ratio = indicators.sell_volume_ratio || 50;

    const order_block_bullish = indicators.order_block_bullish;
    const order_block_bearish = indicators.order_block_bearish;
    const bos_bullish = indicators.bos_bullish === true;
    const bos_bearish = indicators.bos_bearish === true;
    const fvg_bullish = indicators.fvg_bullish === true;
    const fvg_bearish = indicators.fvg_bearish === true;
    const swing_high = indicators.swing_high || price;
    const swing_low = indicators.swing_low || price;
    const ordinal_imbalance = buy_volume_ratio - sell_volume_ratio;
    const atr_pct = indicators.atr_estimated_pct || 0.5;
    const volatility_trend = atr_pct > 1.0 ? 'EXPANDING' : atr_pct < 0.3 ? 'CONTRACTING' : 'STABLE';
    const smart_money_bullish = bos_bullish || (order_block_bullish && price > order_block_bullish);
    const smart_money_bearish = bos_bearish || (order_block_bearish && price < order_block_bearish);
    const high_volume_levels = indicators.high_volume_levels || [];

    // Advanced calculations
    const range = swing_high - swing_low;
    const priceInRange = range > 0 ? ((price - swing_low) / range) * 100 : 50;
    const inPremiumZone = priceInRange > 60; // Top 40% of range
    const inDiscountZone = priceInRange < 40; // Bottom 40% of range
    const inEquilibrium = !inPremiumZone && !inDiscountZone;
    
    // Smart money strength
    const smartMoneyStrength = Math.abs(ordinal_imbalance) + (bos_bullish || bos_bearish ? 20 : 0) + 
      ((order_block_bullish || order_block_bearish) ? 15 : 0);

    // Liquidity analysis
    const nearSwingHigh = Math.abs(price - swing_high) / price * 100 < 2;
    const nearSwingLow = Math.abs(price - swing_low) / price * 100 < 2;
    const liquiditySweepRisk = nearSwingHigh || nearSwingLow;

    return {
      price, volume, volume_ratio, buy_volume_ratio, sell_volume_ratio,
      ordinal_imbalance, order_block_bullish, order_block_bearish,
      bos_bullish, bos_bearish, fvg_bullish, fvg_bearish,
      swing_high, swing_low, volatility_trend, atr_pct, high_volume_levels,
      smart_money_bullish, smart_money_bearish, smartMoneyStrength,
      inPremiumZone, inDiscountZone, inEquilibrium, priceInRange,
      nearSwingHigh, nearSwingLow, liquiditySweepRisk,
    };
  }, [analysis]);

  if (!metrics || !analysis) {
    return (
      <div className="border-2 border-purple-500/40 rounded-xl p-3 bg-purple-900/20 backdrop-blur-sm">
        <div className="text-center text-dark-tertiary text-xs py-3">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header Card */}
      <div className="border-2 border-purple-500/40 rounded-xl p-3 bg-gradient-to-br from-purple-900/20 to-indigo-900/10 backdrop-blur-sm shadow-xl">
        <div className="flex items-center justify-between mb-2">
          <h3 className="flex items-center gap-2 text-base font-bold text-purple-300">
            <span className="text-xl drop-shadow-[0_0_8px_rgba(168,85,247,0.6)]">🏛️</span>
            {name}
          </h3>
          <div className="flex items-center gap-2">
            <div className="text-[10px] px-2 py-1 rounded-full bg-green-500/20 text-green-300 border border-green-500/30 flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></div>
              <span>🔴 LIVE</span>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div className="text-[10px] text-purple-300/70">Institutional view • Market structure</div>
          <div className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
            Smart Money: {Math.round(metrics.smartMoneyStrength)}%
          </div>
        </div>
      </div>

      {/* Premium/Discount Zone Indicator */}
      <div className="border-2 border-cyan-500/40 rounded-xl p-3 bg-gradient-to-br from-cyan-900/20 to-blue-900/10 backdrop-blur-sm">
        <h4 className="text-sm font-bold text-cyan-300 mb-2 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span>📊</span>
            <span>Price Position</span>
          </span>
          <span className={`text-[10px] px-2 py-1 rounded-full font-semibold ${
            metrics.inPremiumZone ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' :
            metrics.inDiscountZone ? 'bg-green-500/20 text-green-300 border border-green-500/40' :
            'bg-amber-500/20 text-amber-300 border border-amber-500/40'
          }`}>
            {metrics.inPremiumZone ? '📈 PREMIUM' : metrics.inDiscountZone ? '📉 DISCOUNT' : '⚖️ EQUILIBRIUM'}
          </span>
        </h4>
        <div className="relative h-8 bg-gradient-to-r from-green-500/20 via-amber-500/20 to-rose-500/20 rounded-lg overflow-hidden border border-cyan-500/30">
          <div className="absolute inset-0 flex">
            <div className="w-[40%] border-r border-cyan-500/40"></div>
            <div className="w-[20%] border-r border-cyan-500/40"></div>
            <div className="w-[40%]"></div>
          </div>
          <div 
            className="absolute top-0 bottom-0 w-1 bg-white shadow-lg shadow-white/50"
            style={{ left: `${metrics.priceInRange}%` }}
          >
            <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] text-white bg-cyan-600 px-2 py-0.5 rounded whitespace-nowrap">
              {metrics.priceInRange.toFixed(0)}%
            </div>
          </div>
        </div>
        <div className="flex justify-between text-[9px] text-cyan-300/70 mt-1">
          <span>🟢 BUY ZONE</span>
          <span>⚖️ FAIR VALUE</span>
          <span>🔴 SELL ZONE</span>
        </div>
        {metrics.inDiscountZone && (
          <div className="mt-2 text-[10px] text-green-300 bg-green-500/10 rounded px-2 py-1 border border-green-500/30">
            💡 Trading below fair value - Institutional buying opportunity
          </div>
        )}
        {metrics.inPremiumZone && (
          <div className="mt-2 text-[10px] text-rose-300 bg-rose-500/10 rounded px-2 py-1 border border-rose-500/30">
            ⚠️ Trading above fair value - Potential distribution zone
          </div>
        )}
      </div>

      {/* Liquidity Sweep Risk */}
      {metrics.liquiditySweepRisk && (
        <div className="border-2 border-amber-500/50 rounded-xl p-3 bg-gradient-to-br from-amber-900/30 to-orange-900/10 backdrop-blur-sm animate-pulse">
          <h4 className="text-sm font-bold text-amber-300 mb-1 flex items-center gap-2">
            <span>💧</span>
            <span>Liquidity Sweep Risk</span>
          </h4>
          <p className="text-[10px] text-amber-200/90">
            {metrics.nearSwingHigh && 'Price near swing high - Watch for stop hunt above before reversal'}
            {metrics.nearSwingLow && 'Price near swing low - Watch for stop hunt below before reversal'}
          </p>
        </div>
      )}

      <div className="border-2 border-blue-500/40 rounded-xl p-3 bg-gradient-to-br from-blue-900/20 to-cyan-900/10 backdrop-blur-sm">
        <h4 className="text-sm font-bold text-blue-300 mb-2 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span>📊</span>
            <span>Order Flow Analysis</span>
          </span>
          <span className="text-[10px] text-blue-300/70 font-normal px-2 py-1 bg-blue-500/10 rounded-full border border-blue-500/30">
            Confidence: {Math.round(Math.min(95, 50 + Math.abs(metrics.ordinal_imbalance) / 2))}%
          </span>
        </h4>
        <div className="space-y-2">
          <div>
            <div className="flex justify-between text-[10px] mb-1">
              <span className="text-blue-300">Buy</span>
              <span className="text-green-400">{metrics.buy_volume_ratio.toFixed(1)}%</span>
            </div>
            <div className="h-1.5 bg-dark-secondary/30 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 transition-all" style={{width: `${metrics.buy_volume_ratio}%`}} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-[10px] mb-1">
              <span className="text-blue-300">Sell</span>
              <span className="text-red-400">{metrics.sell_volume_ratio.toFixed(1)}%</span>
            </div>
            <div className="h-1.5 bg-dark-secondary/30 rounded-full overflow-hidden">
              <div className="h-full bg-red-500 transition-all" style={{width: `${metrics.sell_volume_ratio}%`}} />
            </div>
          </div>
        </div>
      </div>

      <div className="border-2 border-cyan-500/40 rounded-xl p-3 bg-cyan-900/20 backdrop-blur-sm">
        <h4 className="text-sm font-bold text-cyan-300 mb-2 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span>🎯</span>
            Market Structure
          </span>
          <span className="text-[10px] text-cyan-300/70 font-normal">
            Confidence: {((metrics.bos_bullish || metrics.bos_bearish) ? 85 : 65)}%
          </span>
        </h4>
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div className="bg-dark-surface/40 rounded p-2 border border-cyan-500/30">
            <div className="text-cyan-300 mb-1">Swing High</div>
            <div className="font-bold text-cyan-400">₹{metrics.swing_high?.toFixed(2)}</div>
          </div>
          <div className="bg-dark-surface/40 rounded p-2 border border-cyan-500/30">
            <div className="text-cyan-300 mb-1">Swing Low</div>
            <div className="font-bold text-cyan-400">₹{metrics.swing_low?.toFixed(2)}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          {metrics.bos_bullish && (
            <div className="bg-green-900/20 border border-green-500/40 rounded p-2 text-[10px] font-bold text-green-400">
              ✓ BOS Bull
            </div>
          )}
          {metrics.bos_bearish && (
            <div className="bg-red-900/20 border border-red-500/40 rounded p-2 text-[10px] font-bold text-red-400">
              ✓ BOS Bear
            </div>
          )}
        </div>
      </div>

      {(metrics.order_block_bullish || metrics.order_block_bearish) && (
        <div className="border-2 border-amber-500/40 rounded-xl p-3 bg-amber-900/20 backdrop-blur-sm">
          <h4 className="text-sm font-bold text-amber-300 mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span>🔒</span>
              Order Blocks
            </span>
            <span className="text-[10px] text-amber-300/70 font-normal">
              Confidence: {(metrics.order_block_bullish && metrics.order_block_bearish) ? 90 : 78}%
            </span>
          </h4>
          {metrics.order_block_bullish && (
            <div className="flex justify-between bg-green-900/20 border border-green-500/30 rounded p-2 text-[10px]">
              <span className="text-green-300">Support OB</span>
              <span className="font-bold text-green-400">₹{metrics.order_block_bullish?.toFixed(2)}</span>
            </div>
          )}
          {metrics.order_block_bearish && (
            <div className="flex justify-between bg-red-900/20 border border-red-500/30 rounded p-2 text-[10px] mt-1">
              <span className="text-red-300">Resist OB</span>
              <span className="font-bold text-red-400">₹{metrics.order_block_bearish?.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}

      {(metrics.fvg_bullish || metrics.fvg_bearish) && (
        <div className="border-2 border-pink-500/40 rounded-xl p-3 bg-pink-900/20 backdrop-blur-sm">
          <h4 className="text-sm font-bold text-pink-300 mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span>📈</span>
              Fair Value Gaps
            </span>
            <span className="text-[10px] text-pink-300/70 font-normal">
              Confidence: {(metrics.fvg_bullish && metrics.fvg_bearish) ? 72 : 88}%
            </span>
          </h4>
          {metrics.fvg_bullish && (
            <div className="bg-green-900/20 border border-green-500/30 rounded p-2 text-[10px] font-bold text-green-400">
              ✓ Bullish FVG
            </div>
          )}
          {metrics.fvg_bearish && (
            <div className="bg-red-900/20 border border-red-500/30 rounded p-2 text-[10px] font-bold text-red-400 mt-1">
              ✓ Bearish FVG
            </div>
          )}
        </div>
      )}

      {metrics.high_volume_levels.length > 0 && (
        <div className="border-2 border-orange-500/40 rounded-xl p-3 bg-orange-900/20 backdrop-blur-sm">
          <h4 className="text-sm font-bold text-orange-300 mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span>📊</span>
              High Volume
            </span>
            <span className="text-[10px] text-orange-300/70 font-normal">
              Confidence: {Math.min(95, 70 + (metrics.high_volume_levels.length * 8))}%
            </span>
          </h4>
          {metrics.high_volume_levels.map((level: number, idx: number) => (
            <div key={idx} className="text-[10px] text-orange-400 py-1">
              Level {idx + 1}: ₹{level?.toFixed(2)}
            </div>
          ))}
        </div>
      )}

      <div className="border-2 border-indigo-500/40 rounded-xl p-3 bg-gradient-to-br from-indigo-900/20 to-purple-900/10 backdrop-blur-sm shadow-lg">
        <h4 className="text-sm font-bold text-indigo-300 mb-2 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span>💡</span>
            <span>Smart Money Positioning</span>
          </span>
          <span className={`text-[10px] font-normal px-2 py-1 rounded-full border ${
            metrics.smartMoneyStrength >= 60 ? 'bg-green-500/20 text-green-300 border-green-500/40' :
            metrics.smartMoneyStrength >= 40 ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' :
            'bg-gray-500/20 text-gray-300 border-gray-500/40'
          }`}>
            Strength: {Math.round(metrics.smartMoneyStrength)}%
          </span>
        </h4>
        <div className="grid grid-cols-2 gap-2 text-[10px] mb-3">
          <div className={metrics.smart_money_bullish 
            ? 'bg-gradient-to-br from-green-500/30 to-emerald-500/10 border-2 border-green-500/50 rounded-lg p-2.5 font-bold text-green-300 text-center shadow-lg shadow-green-500/20' 
            : 'bg-dark-surface/40 border border-dark-border/40 rounded-lg p-2.5 font-bold text-dark-tertiary text-center'}>
            {metrics.smart_money_bullish ? '🟢 ACCUMULATION' : '○ No Accumulation'}
          </div>
          <div className={metrics.smart_money_bearish 
            ? 'bg-gradient-to-br from-red-500/30 to-rose-500/10 border-2 border-red-500/50 rounded-lg p-2.5 font-bold text-red-300 text-center shadow-lg shadow-red-500/20' 
            : 'bg-dark-surface/40 border border-dark-border/40 rounded-lg p-2.5 font-bold text-dark-tertiary text-center'}>
            {metrics.smart_money_bearish ? '🔴 DISTRIBUTION' : '○ No Distribution'}
          </div>
        </div>
        {(metrics.smart_money_bullish || metrics.smart_money_bearish) && (
          <div className="text-[10px] text-indigo-200/90 bg-indigo-500/10 rounded px-2 py-2 border border-indigo-500/30">
            {metrics.smart_money_bullish && '📈 Institutional buyers active - Look for long setups near support zones'}
            {metrics.smart_money_bearish && '📉 Institutional sellers active - Look for short setups near resistance zones'}
          </div>
        )}
      </div>

      <div className="border-2 border-teal-500/40 rounded-xl p-3 bg-teal-900/20 backdrop-blur-sm">
        <h4 className="text-sm font-bold text-teal-300 mb-2 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span>⚡</span>
            Volatility
          </span>
          <span className="text-[10px] text-teal-300/70 font-normal">
            Confidence: {Math.round(75 + (metrics.atr_pct * 10))}%
          </span>
        </h4>
        <div className="flex justify-between text-[10px] bg-dark-surface/40 rounded p-2">
          <span className="text-teal-300">ATR: {metrics.atr_pct?.toFixed(2)}%</span>
          <span className={
            metrics.volatility_trend === 'EXPANDING' ? 'text-red-400' : 
            metrics.volatility_trend === 'CONTRACTING' ? 'text-green-400' : 
            'text-amber-400'
          }>
            {metrics.volatility_trend}
          </span>
        </div>
      </div>

      <div className="border-2 border-sky-500/40 rounded-xl p-3 bg-sky-900/20 backdrop-blur-sm">
        <h4 className="text-sm font-bold text-sky-300 mb-2 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span>💪</span>
            Volume
          </span>
          <span className="text-[10px] text-sky-300/70 font-normal">
            Confidence: {Math.min(95, Math.round(60 + (metrics.volume_ratio * 20)))}%
          </span>
        </h4>
        <div className="text-center py-2">
          <div className="text-xl font-bold text-sky-400">
            {metrics.volume_ratio?.toFixed(2)}x
          </div>
          <div className="text-[10px] text-sky-300/70 mt-1">
            {metrics.volume_ratio > 1.3 ? '🟢 High' : 
             metrics.volume_ratio < 0.7 ? '🔴 Low' : '🟡 Normal'}
          </div>
        </div>
      </div>
    </div>
  );
};

export default InstitutionalMarketView;
