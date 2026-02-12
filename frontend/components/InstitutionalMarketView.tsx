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

    return {
      price, volume, volume_ratio, buy_volume_ratio, sell_volume_ratio,
      ordinal_imbalance, order_block_bullish, order_block_bearish,
      bos_bullish, bos_bearish, fvg_bullish, fvg_bearish,
      swing_high, swing_low, volatility_trend, atr_pct, high_volume_levels,
      smart_money_bullish, smart_money_bearish,
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
      <div className="border-2 border-purple-500/40 rounded-xl p-3 bg-purple-900/20 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-2">
          <h3 className="flex items-center gap-2 text-base font-bold text-purple-300">
            <span className="text-xl">🏛️</span>
            {name}
          </h3>
          <div className="text-[10px] px-2 py-1 rounded-full bg-green-500/20 text-green-300 border border-green-500/30">
            🔴 LIVE
          </div>
        </div>
        <div className="text-[10px] text-purple-300/70">Institutional view • Market structure</div>
      </div>

      <div className="border-2 border-blue-500/40 rounded-xl p-3 bg-blue-900/20 backdrop-blur-sm">
        <h4 className="text-sm font-bold text-blue-300 mb-2 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span>📊</span>
            Order Flow
          </span>
          <span className="text-[10px] text-blue-300/70 font-normal">
            Confidence: {Math.round(Math.abs(metrics.ordinal_imbalance))}%
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

      <div className="border-2 border-indigo-500/40 rounded-xl p-3 bg-indigo-900/20 backdrop-blur-sm">
        <h4 className="text-sm font-bold text-indigo-300 mb-2 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span>💡</span>
            Smart Money
          </span>
          <span className="text-[10px] text-indigo-300/70 font-normal">
            Confidence: {(metrics.smart_money_bullish || metrics.smart_money_bearish) ? 82 : 55}%
          </span>
        </h4>
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div className={metrics.smart_money_bullish 
            ? 'bg-green-900/20 border border-green-500/40 rounded p-2 font-bold text-green-400 text-center' 
            : 'bg-dark-surface/40 border border-dark-border/40 rounded p-2 font-bold text-dark-tertiary text-center'}>
            {metrics.smart_money_bullish ? '🟢 Accum' : '○ Neutral'}
          </div>
          <div className={metrics.smart_money_bearish 
            ? 'bg-red-900/20 border border-red-500/40 rounded p-2 font-bold text-red-400 text-center' 
            : 'bg-dark-surface/40 border border-dark-border/40 rounded p-2 font-bold text-dark-tertiary text-center'}>
            {metrics.smart_money_bearish ? '🔴 Dist' : '○ Neutral'}
          </div>
        </div>
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
