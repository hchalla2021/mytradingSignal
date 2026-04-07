'use client';

import React, { useMemo, memo, useRef } from 'react';
import useOrderFlowRealtime, { OrderFlowData } from '@/hooks/useOrderFlowRealtime';
import { getEnvironmentConfig } from '@/lib/env-detection';

// 🔥 SIGNAL COLORS FOR STRONG TRADING INDICATORS
const SIGNAL_COLORS = {
  'STRONG_BUY': '#00ff41',    // Bright green
  'BUY': '#66ff33',            // Light green
  'HOLD': '#ffff00',           // Yellow
  'SELL': '#ff9933',           // Orange
  'STRONG_SELL': '#ff0033',    // Red
};

const DELTA_TREND_COLORS = {
  'BULLISH': '#00ff41',
  'BEARISH': '#ff0033',
  'NEUTRAL': '#888888',
};

interface OrderFlowCardProps {
  symbol: string;
  data?: OrderFlowData;
  isLoading: boolean;
}

// 📊 IMPROVED MARKET DEPTH COMPONENT - FIXED LAYOUT, NO FLICKER
const MarketDepthDisplay = memo(({ data }: { data: OrderFlowData }) => {
  const maxQty = Math.max(...data.askLevels.map(l => l.quantity), ...data.bidLevels.map(l => l.quantity), 10000);
  
  const askLevels = data.askLevels.slice().reverse();
  const bidLevels = data.bidLevels;
  
  const buyQty = data.totalBidQty || 1;
  const sellQty = data.totalAskQty || 1;
  const buyerDominance = buyQty / (sellQty || 1);
  const sellerDominance = sellQty / (buyQty || 1);
  
  const isDominantBuyers = buyerDominance > 1.2;
  const isDominantSellers = sellerDominance > 1.2;
  
  // Always-present dominance label (text changes, element stays)
  const dominanceLabel = isDominantBuyers
    ? `🟢 BUYERS ${buyerDominance.toFixed(1)}x`
    : isDominantSellers
    ? `🔴 SELLERS ${sellerDominance.toFixed(1)}x`
    : '';
  
  return (
    <div className="space-y-2">
      {/* Title — fixed height, always present */}
      <div className="text-xs font-semibold text-gray-300 flex justify-between items-center h-5">
        <span>Market Depth (5 Levels) - LIVE</span>
        <div className="flex items-center gap-2">
          <span
            className="text-xs font-bold min-w-[100px] text-right"
            style={{
              color: isDominantBuyers ? '#4ade80' : isDominantSellers ? '#f87171' : 'transparent',
            }}
          >
            {dominanceLabel || '\u00A0'}
          </span>
          <span className="text-gray-500">Qty × Orders</span>
        </div>
      </div>
      
      {/* Desktop View — fixed structure */}
      <div className="hidden md:block space-y-2">
        {/* SELLERS (ASK) */}
        <div 
          className="relative bg-red-900/20 border-2 rounded p-2 space-y-1"
          style={{ 
            borderColor: isDominantSellers ? 'rgb(239 68 68)' : 'rgba(127, 29, 29, 0.3)',
            backgroundColor: isDominantSellers ? 'rgba(127, 29, 29, 0.4)' : 'rgba(127, 29, 29, 0.2)',
          }}
        >
          {/* Fixed-height badge slot — always occupies space */}
          <div className="h-5 flex items-center justify-end">
            <span
              className="text-xs font-bold px-2 py-0.5 rounded"
              style={{
                backgroundColor: isDominantSellers ? 'rgb(239 68 68)' : 'transparent',
                color: isDominantSellers ? 'white' : 'transparent',
              }}
            >
              {isDominantSellers ? '⚠️ HEAVY SELLING' : '\u00A0'}
            </span>
          </div>
          <div className="text-xs font-semibold text-red-400 mb-1">🔴 SELLERS (ASK)</div>
          {askLevels.map((level, idx) => {
            const barWidth = (level.quantity / maxQty) * 100;
            return (
              <div key={`ask-${idx}`} className="flex items-center gap-2 text-xs h-5">
                <div className="w-14 text-right font-mono text-red-400">
                  ₹{level.price.toFixed(2)}
                </div>
                <div className="flex-1 flex items-center gap-1">
                  <div 
                    className="h-4 bg-gradient-to-r from-red-500 to-red-600 rounded"
                    style={{ width: `${Math.min(barWidth, 100)}%` }}
                  />
                </div>
                <div className="w-20 text-right text-red-300 font-mono text-xs">
                  {(level.quantity/1000).toFixed(1)}K
                </div>
                <div className="w-8 text-right text-red-500 font-semibold">
                  {Math.round(level.orders)}
                </div>
              </div>
            );
          })}
        </div>
        
        {/* MID POINT */}
        <div className="flex items-center justify-center py-1 text-xs text-gray-500 font-semibold h-6">
          <div className="flex-1 border-t border-gray-600" />
          <span className="px-3 bg-gray-800 rounded">MID</span>
          <div className="flex-1 border-t border-gray-600" />
        </div>
        
        {/* BUYERS (BID) */}
        <div 
          className="relative bg-green-900/20 border-2 rounded p-2 space-y-1"
          style={{ 
            borderColor: isDominantBuyers ? 'rgb(34 197 94)' : 'rgba(20, 83, 45, 0.3)',
            backgroundColor: isDominantBuyers ? 'rgba(20, 83, 45, 0.4)' : 'rgba(20, 83, 45, 0.2)',
          }}
        >
          {/* Fixed-height badge slot */}
          <div className="h-5 flex items-center justify-end">
            <span
              className="text-xs font-bold px-2 py-0.5 rounded"
              style={{
                backgroundColor: isDominantBuyers ? 'rgb(34 197 94)' : 'transparent',
                color: isDominantBuyers ? 'white' : 'transparent',
              }}
            >
              {isDominantBuyers ? '⚡ HEAVY BUYING' : '\u00A0'}
            </span>
          </div>
          <div className="text-xs font-semibold text-green-400 mb-1">🟢 BUYERS (BID)</div>
          {bidLevels.map((level, idx) => {
            const barWidth = (level.quantity / maxQty) * 100;
            return (
              <div key={`bid-${idx}`} className="flex items-center gap-2 text-xs h-5">
                <div className="w-14 text-right font-mono text-green-400">
                  ₹{level.price.toFixed(2)}
                </div>
                <div className="flex-1 flex items-center justify-end gap-1">
                  <div 
                    className="h-4 bg-gradient-to-r from-green-600 to-green-500 rounded"
                    style={{ width: `${Math.min(barWidth, 100)}%` }}
                  />
                </div>
                <div className="w-20 text-right text-green-300 font-mono text-xs">
                  {(level.quantity/1000).toFixed(1)}K
                </div>
                <div className="w-8 text-right text-green-500 font-semibold">
                  {Math.round(level.orders)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
      {/* Mobile View — fixed grid layout */}
      <div className="md:hidden">
        <div className="grid grid-cols-2 gap-2">
          {/* SELLERS (Left) */}
          <div 
            className="bg-red-900/20 border-2 rounded p-1.5"
            style={{
              borderColor: isDominantSellers ? 'rgb(239 68 68)' : 'rgba(127, 29, 29, 0.3)',
            }}
          >
            <div className="text-xs font-semibold text-red-400 text-center h-4">SELLERS</div>
            {askLevels.map((level, idx) => {
              const barWidth = (level.quantity / maxQty) * 100;
              return (
                <div key={`ask-m-${idx}`} className="text-xs mb-0.5">
                  <div className="flex justify-between h-4">
                    <span className="text-red-400 font-mono text-xs">₹{level.price.toFixed(2)}</span>
                    <span className="text-red-500 font-semibold">{Math.round(level.orders)}</span>
                  </div>
                  <div className="w-full h-2 bg-red-900/50 rounded overflow-hidden">
                    <div className="h-full bg-red-500 rounded" style={{ width: `${Math.min(barWidth, 100)}%` }} />
                  </div>
                  <div className="text-red-300 text-xs h-4">{(level.quantity/1000).toFixed(1)}K</div>
                </div>
              );
            })}
          </div>
          
          {/* BUYERS (Right) */}
          <div 
            className="bg-green-900/20 border-2 rounded p-1.5"
            style={{
              borderColor: isDominantBuyers ? 'rgb(34 197 94)' : 'rgba(20, 83, 45, 0.3)',
            }}
          >
            <div className="text-xs font-semibold text-green-400 text-center h-4">BUYERS</div>
            {bidLevels.map((level, idx) => {
              const barWidth = (level.quantity / maxQty) * 100;
              return (
                <div key={`bid-m-${idx}`} className="text-xs mb-0.5">
                  <div className="flex justify-between h-4">
                    <span className="text-green-400 font-mono text-xs">₹{level.price.toFixed(2)}</span>
                    <span className="text-green-500 font-semibold">{Math.round(level.orders)}</span>
                  </div>
                  <div className="w-full h-2 bg-green-900/50 rounded overflow-hidden">
                    <div className="h-full bg-green-500 rounded" style={{ width: `${Math.min(barWidth, 100)}%` }} />
                  </div>
                  <div className="text-green-300 text-xs h-4">{(level.quantity/1000).toFixed(1)}K</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      
      {/* Summary Stats — fixed layout, no conditional sizing */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs p-2 bg-gray-800/30 rounded text-center border border-gray-700/50">
        <div className="p-1 rounded" style={{ backgroundColor: isDominantBuyers ? 'rgba(20, 83, 45, 0.3)' : 'transparent' }}>
          <div className="text-green-400 font-semibold">{data.totalBidQty.toLocaleString()}</div>
          <div className="text-green-600 text-xs">Buy Qty</div>
        </div>
        <div className="p-1 rounded" style={{ backgroundColor: isDominantBuyers ? 'rgba(20, 83, 45, 0.3)' : 'transparent' }}>
          <div className="text-green-500 font-semibold">{data.totalBidOrders}</div>
          <div className="text-green-600 text-xs">Buy Orders</div>
        </div>
        <div className="p-1 rounded" style={{ backgroundColor: isDominantSellers ? 'rgba(127, 29, 29, 0.3)' : 'transparent' }}>
          <div className="text-red-400 font-semibold">{data.totalAskQty.toLocaleString()}</div>
          <div className="text-red-600 text-xs">Sell Qty</div>
        </div>
        <div className="p-1 rounded" style={{ backgroundColor: isDominantSellers ? 'rgba(127, 29, 29, 0.3)' : 'transparent' }}>
          <div className="text-red-500 font-semibold">{data.totalAskOrders}</div>
          <div className="text-red-600 text-xs">Sell Orders</div>
        </div>
      </div>
    </div>
  );
});

MarketDepthDisplay.displayName = 'MarketDepthDisplay';

// 🎯 DELTA VISUALIZATION BAR — fixed height, no conditional DOM
const DeltaBar = memo(({ data }: { data: OrderFlowData }) => {
  const totalQty = data.totalBidQty + data.totalAskQty || 1;
  const buyPercent = (data.totalBidQty / totalQty) * 100;
  const sellPercent = (data.totalAskQty / totalQty) * 100;
  
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 h-5">
        <span className="text-xs text-gray-400">Delta</span>
        <span className={`font-bold text-sm ${data.delta > 0 ? 'text-green-400' : data.delta < 0 ? 'text-red-400' : 'text-gray-400'}`}>
          {data.delta > 0 ? '+' : ''}{data.delta.toFixed(0)}
        </span>
      </div>
      
      <div className="flex h-6 rounded-full overflow-hidden bg-gray-800 border border-gray-700">
        <div 
          className="bg-gradient-to-r from-green-600 to-green-500 h-full"
          style={{ width: `${buyPercent}%` }}
        />
        <div 
          className="bg-gradient-to-r from-red-600 to-red-500 h-full"
          style={{ width: `${sellPercent}%` }}
        />
      </div>
    </div>
  );
});

DeltaBar.displayName = 'DeltaBar';

// ⚡️ BUYER VS SELLER BATTLE — fixed layout with hysteresis
const BattleIndicator = memo(({ data, stableBuyDom }: { data: OrderFlowData; stableBuyDom: boolean }) => {
  const buyPercentOfTotal = data.buyerAggressionRatio * 100;
  const sellPercentOfTotal = data.sellerAggressionRatio * 100;
  
  const battleLabel = buyPercentOfTotal > 55
    ? '🔥 Buyers Attacking'
    : sellPercentOfTotal > 55
    ? '🔥 Sellers Attacking'
    : '⚖️ Balanced Battle';
  
  return (
    <div>
      {/* Fixed-height title */}
      <div className="text-xs font-semibold text-gray-300 text-center h-5 leading-5">
        {battleLabel}
      </div>
      
      {/* Fixed-width columns */}
      <div className="flex items-center justify-center gap-4 text-xs mt-1">
        <div className="text-center w-20">
          <div className="text-green-400 font-bold text-sm h-5 leading-5">
            {buyPercentOfTotal.toFixed(1)}%
          </div>
          <div className="text-green-600 text-xs h-4">Buyers</div>
          <div className="text-green-600 text-xs h-4">
            {data.totalBidOrders} orders
          </div>
        </div>
        
        <div className="w-8 text-center">
          <div className={`text-lg font-bold transition-colors duration-700 ${
            stableBuyDom ? 'text-green-400' : 'text-red-400'
          }`}>
            {stableBuyDom ? '▶️' : '◀️'}
          </div>
        </div>
        
        <div className="text-center w-20">
          <div className="text-red-400 font-bold text-sm h-5 leading-5">
            {sellPercentOfTotal.toFixed(1)}%
          </div>
          <div className="text-red-600 text-xs h-4">Sellers</div>
          <div className="text-red-600 text-xs h-4">
            {data.totalAskOrders} orders
          </div>
        </div>
      </div>
    </div>
  );
});

BattleIndicator.displayName = 'BattleIndicator';

// 💧 MARKET LIQUIDITY — SINGLE FIXED DOM STRUCTURE with hysteresis
const MarketLiquidity = memo(({ data, stableBuyDom }: { data: OrderFlowData; stableBuyDom: boolean }) => {
  const buyPct = data.buyerAggressionRatio * 100;
  const sellPct = data.sellerAggressionRatio * 100;
  // Use stable (hysteresis) dominance to prevent flicker
  const isBuyDom = stableBuyDom;
  const pctDiff = Math.abs(buyPct - sellPct);
  const intensity = Math.min(pctDiff, 50) / 50;

  // ── Inner-element highlight: criteria = gap≥10% AND dominant side >60% ──
  const liqCriteriaMet = pctDiff >= 10 && (isBuyDom ? buyPct > 60 : sellPct > 60);
  const liqHlClass = liqCriteriaMet
    ? (isBuyDom ? 'sm-section-hl-bull' : 'sm-section-hl-bear')
    : '';
  
  // Colors: highlighted side uses vivid bright colors, muted side uses clear gray
  const buyBg = isBuyDom ? `rgba(16, 185, 129, ${0.15 + intensity * 0.25})` : 'rgba(55, 65, 81, 0.4)';
  const buyBorder = isBuyDom ? `rgba(52, 211, 153, ${0.7 + intensity * 0.3})` : 'rgba(75, 85, 99, 0.5)';
  const buyColor = isBuyDom ? '#34d399' : 'rgba(156, 163, 175, 0.7)';
  const buyLabel = isBuyDom ? '↑ Strong Buying' : '↑ Weak Buying';
  const buyLabelColor = isBuyDom ? '#6ee7b7' : '#9ca3af';
  
  const sellBg = !isBuyDom ? `rgba(239, 68, 68, ${0.15 + intensity * 0.25})` : 'rgba(55, 65, 81, 0.4)';
  const sellBorder = !isBuyDom ? `rgba(248, 113, 113, ${0.7 + intensity * 0.3})` : 'rgba(75, 85, 99, 0.5)';
  const sellColor = !isBuyDom ? '#f87171' : 'rgba(156, 163, 175, 0.7)';
  const sellLabel = !isBuyDom ? '↓ Heavy Selling' : '↓ Passive Selling';
  const sellLabelColor = !isBuyDom ? '#fca5a5' : '#9ca3af';
  
  const barBuyBg = isBuyDom
    ? 'linear-gradient(to right, rgb(16 185 129), rgb(52 211 153))'
    : 'linear-gradient(to right, rgb(75 85 99), rgb(107 114 128))';
  const barSellBg = !isBuyDom
    ? 'linear-gradient(to right, rgb(220 38 38), rgb(239 68 68))'
    : 'linear-gradient(to right, rgb(75 85 99), rgb(107 114 128))';
  
  const domLabel = isBuyDom
    ? `🟢 BUYER DOMINANCE: ${pctDiff.toFixed(1)}% stronger`
    : `🔴 SELLER DOMINANCE: ${pctDiff.toFixed(1)}% stronger`;
  const domColor = isBuyDom ? '#34d399' : '#f87171';
  const domBg = isBuyDom ? 'rgba(6, 78, 59, 0.3)' : 'rgba(127, 29, 29, 0.3)';
  const domBorderColor = isBuyDom ? 'rgba(52, 211, 153, 0.4)' : 'rgba(248, 113, 113, 0.4)';
  
  return (
    <div>
      <div className="text-xs font-semibold text-gray-300 h-5 leading-5">Market Liquidity</div>
      
      {/* Buyer / Seller boxes — fixed equal height, no layout shift */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 mt-1">
        <div 
          className="rounded-lg p-2.5 sm:p-3 transition-all duration-700 min-h-[88px] flex flex-col justify-between"
          style={{ backgroundColor: buyBg, border: `2px solid ${buyBorder}` }}
        >
          <div className="text-[11px] sm:text-xs font-bold tracking-wide" style={{ color: isBuyDom ? '#d1d5db' : '#6b7280' }}>BUYERS</div>
          <div 
            className="text-xl sm:text-2xl font-bold h-8 leading-8 tabular-nums"
            style={{ color: buyColor, transition: 'color 0.7s', fontVariantNumeric: 'tabular-nums' }}
          >
            {buyPct.toFixed(1)}%
          </div>
          <div 
            className="text-[11px] sm:text-xs font-semibold h-4 leading-4 whitespace-nowrap"
            style={{ color: buyLabelColor, transition: 'color 0.7s' }}
          >
            {buyLabel}
          </div>
        </div>
        
        <div 
          className="rounded-lg p-2.5 sm:p-3 transition-all duration-700 min-h-[88px] flex flex-col justify-between"
          style={{ backgroundColor: sellBg, border: `2px solid ${sellBorder}` }}
        >
          <div className="text-[11px] sm:text-xs font-bold tracking-wide" style={{ color: !isBuyDom ? '#d1d5db' : '#6b7280' }}>SELLERS</div>
          <div 
            className="text-xl sm:text-2xl font-bold h-8 leading-8 tabular-nums"
            style={{ color: sellColor, transition: 'color 0.7s', fontVariantNumeric: 'tabular-nums' }}
          >
            {sellPct.toFixed(1)}%
          </div>
          <div 
            className="text-[11px] sm:text-xs font-semibold h-4 leading-4 whitespace-nowrap"
            style={{ color: sellLabelColor, transition: 'color 0.7s' }}
          >
            {sellLabel}
          </div>
        </div>
      </div>
      
      {/* Visual Indicator Bar — always present, fixed height */}
      <div 
        className="h-7 sm:h-8 rounded-lg overflow-hidden flex bg-gray-800/50 border border-gray-700/50 mt-2"
        style={{ boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5)' }}
      >
        <div 
          className="h-full flex items-center justify-center transition-all duration-700"
          style={{ width: `${buyPct}%`, background: barBuyBg }}
        >
          {buyPct > 30 && <span className="text-white font-bold text-[11px] sm:text-xs drop-shadow">BUY</span>}
        </div>
        <div 
          className="h-full flex items-center justify-center transition-all duration-700"
          style={{ width: `${sellPct}%`, background: barSellBg }}
        >
          {sellPct > 30 && <span className="text-white font-bold text-[11px] sm:text-xs drop-shadow">SELL</span>}
        </div>
      </div>
      
      {/* Dominance Indicator — fixed height, clear text */}
      <div 
        className="text-center text-xs sm:text-sm p-2 rounded-md mt-2 h-8 leading-4 transition-all duration-700"
        style={{ backgroundColor: domBg, border: `1px solid ${domBorderColor}` }}
      >
        <span className="font-bold tracking-wide" style={{ color: domColor }}>
          {domLabel}
        </span>
      </div>
    </div>
  );
});

MarketLiquidity.displayName = 'MarketLiquidity';
// 📈 5-MINUTE PREDICTION — fixed layout, never hides
const FiveMinPrediction = memo(({ data }: { data: OrderFlowData }) => {
  const pred = data.fiveMinPrediction;
  const predColor = pred ? (SIGNAL_COLORS[pred.direction as keyof typeof SIGNAL_COLORS] || '#888888') : '#888888';
  const confidencePct = ((pred?.confidence ?? 0) * 100);
  const buyDomPct = pred?.buyDominancePct ?? 50;
  const sellDomPct = pred?.sellDominancePct ?? 50;
  const isBullish = buyDomPct > sellDomPct;
  
  return (
    <div>
      <div className="text-xs font-semibold text-gray-300 h-5 leading-5">5-Min Prediction</div>
      
      <div className="p-2 bg-gray-800/50 rounded border border-gray-700 mt-1">
        {/* Direction + Confidence — fixed heights */}
        <div className="flex items-center justify-between gap-2 h-8">
          <span className="font-bold text-sm" style={{ color: predColor }}>
            {pred?.direction ?? 'NEUTRAL'}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">CONFIDENCE</span>
            <span className="text-sm font-bold text-yellow-400">
              {confidencePct.toFixed(0)}%
            </span>
          </div>
        </div>
        
        {/* Reasoning — fixed min-height */}
        <div className="text-xs text-gray-400 leading-tight min-h-[2rem]">
          {pred?.reasoning ?? 'Waiting for data...'}
        </div>
        
        {/* Buyer vs Seller Dominance Bar — always rendered */}
        <div className="mt-2">
          <div className="flex justify-between text-xs h-4">
            <span className={`font-semibold ${isBullish ? 'text-green-400' : 'text-gray-500'}`}>
              Buy {buyDomPct.toFixed(1)}%
            </span>
            <span className={`font-semibold ${!isBullish ? 'text-red-400' : 'text-gray-500'}`}>
              Sell {sellDomPct.toFixed(1)}%
            </span>
          </div>
          <div className="flex h-2 rounded-full overflow-hidden bg-gray-700 mt-0.5">
            <div className="bg-green-500" style={{ width: `${buyDomPct}%` }} />
            <div className="bg-red-500" style={{ width: `${sellDomPct}%` }} />
          </div>
        </div>
        
        {/* Stats — fixed height */}
        <div className="flex gap-2 mt-2 text-xs text-gray-500 h-4">
          <span>🔍 {pred?.tickCount ?? 0} ticks</span>
          <span>Δ {(pred?.avgDelta ?? 0).toFixed(0)}</span>
        </div>
      </div>
    </div>
  );
});

FiveMinPrediction.displayName = 'FiveMinPrediction';

// 📊 SIGNAL CONFIDENCE METER
const SignalMeter = memo(({ data }: { data: OrderFlowData }) => {
  const confidence = data.signalConfidence;
  const confidencePercent = confidence * 100;
  const meterColor = SIGNAL_COLORS[data.signal as keyof typeof SIGNAL_COLORS] || '#888888';
  
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-xs font-semibold text-gray-300">Signal Confidence</span>
        <span className="text-xs font-bold" style={{ color: meterColor }}>
          {confidencePercent.toFixed(0)}%
        </span>
      </div>
      
      <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
        <div 
          className="h-full rounded-full transition-all"
          style={{ 
            width: `${confidencePercent}%`,
            backgroundColor: meterColor,
            boxShadow: `0 0 8px ${meterColor}`
          }}
        />
      </div>
    </div>
  );
});

SignalMeter.displayName = 'SignalMeter';

// 🎯 MAIN SIGNAL BADGE — fixed size
const SignalBadge = memo(({ data }: { data: OrderFlowData }) => {
  const color = SIGNAL_COLORS[data.signal as keyof typeof SIGNAL_COLORS] || '#888888';
  const deltaColor = DELTA_TREND_COLORS[data.deltaTrend as keyof typeof DELTA_TREND_COLORS];
  
  const strengthLabel = data.signalConfidence > 0.75 ? '🔥 STRONG' : 
    data.signalConfidence > 0.55 ? '📈 MODERATE' : '⚖️ WEAK';
  
  return (
    <div className="flex flex-col gap-2">
      {/* Main signal — fixed height */}
      <div 
        className="p-3 rounded-lg border-2 text-center h-[76px] flex flex-col items-center justify-center"
        style={{ 
          borderColor: color,
          backgroundColor: `${color}15`,
        }}
      >
        <div className="font-bold text-lg leading-tight" style={{ color }}>
          {data.signal.replace(/_/g, ' ')}
        </div>
        <div className="text-xs text-gray-400 mt-1 h-4">
          {strengthLabel}
        </div>
      </div>
      
      {/* Delta trend — fixed height */}
      <div className="text-center text-xs p-2 bg-gray-800/50 rounded h-[52px] flex flex-col items-center justify-center">
        <div style={{ color: deltaColor }} className="font-semibold">
          {data.deltaTrend}
        </div>
        <div className="text-gray-500 mt-1">
          Spread: ₹{data.spread.toFixed(2)} ({data.spreadPct.toFixed(3)}%)
        </div>
      </div>
    </div>
  );
});

SignalBadge.displayName = 'SignalBadge';

// INDIVIDUAL ORDER FLOW CARD — STABLE LAYOUT
const OrderFlowCard = memo(({ symbol, data, isLoading }: OrderFlowCardProps) => {
  // ── Hysteresis for buyer/seller dominance ──
  // Prevents flickering when values oscillate near 50%.
  // Once a side is dominant, the OTHER side must exceed 52% to flip.
  const stableDomRef = useRef<boolean>(true); // true = buyer dominant
  if (data) {
    const buyPct = data.buyerAggressionRatio * 100;
    const sellPct = data.sellerAggressionRatio * 100;
    const HYSTERESIS = 2.0; // 2% dead-zone
    if (stableDomRef.current) {
      // Currently buyer-dominant — only flip if sellers clearly win
      if (sellPct > 50 + HYSTERESIS) stableDomRef.current = false;
    } else {
      // Currently seller-dominant — only flip if buyers clearly win
      if (buyPct > 50 + HYSTERESIS) stableDomRef.current = true;
    }
  }
  const stableBuyDom = stableDomRef.current;

  if (isLoading || !data) {
    return (
      <div className="bg-gray-900/60 border border-gray-700/50 rounded-lg p-4 backdrop-blur-sm min-h-[600px]">
        <div className="text-center text-gray-500">
          <div className="text-sm font-semibold text-gray-300 mb-2 border border-green-400/60 rounded px-2 py-1 inline-block">{symbol}</div>
          <div className="animate-pulse">Loading order flow...</div>
        </div>
      </div>
    );
  }

  // ── Smart Money Section Highlights ──
  const isBull = data.signal === 'STRONG_BUY' || data.signal === 'BUY';
  const isBear = data.signal === 'STRONG_SELL' || data.signal === 'SELL';
  const smBuyPct = data.buyerAggressionRatio * 100;
  const smSellPct = data.sellerAggressionRatio * 100;
  const smLiqDiff = Math.abs(smBuyPct - smSellPct);
  const smPred = data.fiveMinPrediction;

  // 1. Signal Badge: signal direction + confidence > 55%
  const signalHl = (isBull && data.signalConfidence > 0.55) ? 'sm-section-hl-bull'
    : (isBear && data.signalConfidence > 0.55) ? 'sm-section-hl-bear' : '';
  // 2. Market Liquidity: dominant side with 10%+ gap
  const liqHl = (stableBuyDom && smLiqDiff > 10) ? 'sm-section-hl-bull'
    : (!stableBuyDom && smLiqDiff > 10) ? 'sm-section-hl-bear' : '';
  // 3. 5-Min Prediction: direction + dominance > 55%
  const predBull = smPred && smPred.direction?.includes('BUY') && smPred.buyDominancePct > 55;
  const predBear = smPred && smPred.direction?.includes('SELL') && smPred.sellDominancePct > 55;
  const predHl = predBull ? 'sm-section-hl-bull' : predBear ? 'sm-section-hl-bear' : '';
  // 4. Battle Indicator: aggression > 60%
  const battleHl = (data.buyerAggressionRatio > 0.60) ? 'sm-section-hl-bull'
    : (data.sellerAggressionRatio > 0.60) ? 'sm-section-hl-bear' : '';
  // 5. Signal Confidence: > 75% with directional signal
  const confHl = (data.signalConfidence > 0.75 && isBull) ? 'sm-section-hl-bull'
    : (data.signalConfidence > 0.75 && isBear) ? 'sm-section-hl-bear' : '';

  return (
    <div className="bg-gray-900/60 border border-gray-700/50 rounded-lg p-4 backdrop-blur-sm overflow-hidden">
      {/* Header — fixed height */}
      <div className="border-b border-gray-700/50 pb-3 mb-4">
        <div className="flex items-center justify-between h-7">
          <div className="text-sm font-semibold text-gray-300 border border-green-400/60 rounded px-2 py-1">{symbol}</div>
          <div className="text-xs text-gray-500 flex items-center gap-2">
            <span>CONFIDENCE</span>
            <div className="text-sm font-bold" style={{ color: data.signalConfidence > 0.7 ? '#4ade80' : data.signalConfidence > 0.5 ? '#facc15' : '#ef4444' }}>
              {(data.signalConfidence * 100).toFixed(0)}%
            </div>
          </div>
        </div>
        <div className="text-xs text-gray-500 mt-1 h-4">
          {new Date(data.timestamp).toLocaleTimeString()}
        </div>
      </div>
      
      {/* Signal + Bid/Ask Info */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className={`rounded-lg ${signalHl}`}>
          <SignalBadge data={data} />
        </div>
        
        <div>
          <div className="text-center mb-2">
            <div className="text-xs text-gray-400 h-4">Bid/Ask</div>
            <div className="text-sm font-semibold text-blue-400 h-5">
              ₹{data.bid.toFixed(2)} / ₹{data.ask.toFixed(2)}
            </div>
            <div className="text-xs text-gray-500 mt-1 h-4">
              Spread: ₹{data.spread.toFixed(3)}
            </div>
          </div>
          
          <div className="flex gap-2 text-xs">
            <div className="flex-1 bg-green-900/30 p-2 rounded text-center">
              <div className="text-green-400 font-semibold h-5 leading-5">
                {data.totalBidQty.toLocaleString()}
              </div>
              <div className="text-green-700 text-xs h-4">Bid Qty</div>
            </div>
            <div className="flex-1 bg-red-900/30 p-2 rounded text-center">
              <div className="text-red-400 font-semibold h-5 leading-5">
                {data.totalAskQty.toLocaleString()}
              </div>
              <div className="text-red-700 text-xs h-4">Ask Qty</div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Delta Analysis */}
      <div className="p-2 bg-gray-800/30 rounded mb-4">
        <DeltaBar data={data} />
      </div>
      
      {/* Market Depth Display */}
      <div className="mb-4">
        <MarketDepthDisplay data={data} />
      </div>
      
      {/* Battle Indicator */}
      <div className={`p-3 bg-gray-800/50 rounded border border-gray-700/30 mb-4 ${battleHl}`}>
        <BattleIndicator data={data} stableBuyDom={stableBuyDom} />
      </div>
      
      {/* Market Liquidity */}
      <div className="p-3 bg-gray-800/50 rounded border border-gray-700/30 mb-4">
        <MarketLiquidity data={data} stableBuyDom={stableBuyDom} />
      </div>
      
      {/* Signal Confidence */}
      <div className={`p-2 bg-gray-800/30 rounded mb-4 ${confHl}`}>
        <SignalMeter data={data} />
      </div>
      
      {/* 5-Minute Prediction */}
      <div className={`p-2 bg-gray-800/30 rounded mb-4 ${predHl}`}>
        <FiveMinPrediction data={data} />
      </div>
      
      {/* Stats Footer — fixed height */}
      <div className="text-xs text-gray-500 grid grid-cols-2 gap-2 pt-2 border-t border-gray-700/50 h-6">
        <div>Imbalance: {(data.liquidityImbalance * 100).toFixed(2)}%</div>
        <div>Spread %: {data.spreadPct.toFixed(4)}%</div>
      </div>
    </div>
  );
});

OrderFlowCard.displayName = 'OrderFlowCard';

// 🔥 MAIN COMPONENT
export default function InstitutionalMarketView({ 
  symbol 
}: { 
  symbol: string 
}) {
  const { orderFlow, connectionStatus } = useOrderFlowRealtime();
  const wsData = orderFlow[symbol as keyof typeof orderFlow];
  const [restData, setRestData] = React.useState<OrderFlowData | null>(null);
  const [isLoadingRest, setIsLoadingRest] = React.useState(false);

  // Fetch from REST API as fallback when WebSocket data not available
  React.useEffect(() => {
    if (wsData) {
      // WebSocket has data, use that
      setRestData(null);
      return;
    }

    // WebSocket doesn't have data, try REST API
    const fetchRestData = async () => {
      try {
        setIsLoadingRest(true);
        const config = getEnvironmentConfig();
        const response = await fetch(
          `${config.apiUrl}/api/advanced/smart-money-flow/${symbol}`,
          { signal: AbortSignal.timeout(5000) }
        );
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const apiData = await response.json();
        
        // Transform REST API response to OrderFlowData format
        const currentPrice = apiData.current_price || 0;
        const halfSpread = currentPrice * 0.00025; // ~0.5pt spread for indices
        const bidPrice = currentPrice - halfSpread;
        const askPrice = currentPrice + halfSpread;
        const buyPct = apiData.buy_volume_pct || 50;
        const sellPct = apiData.sell_volume_pct || 50;
        const baseQty = 5000;
        const buyPressure = buyPct / 50;   // >1 when buyers dominate
        const sellPressure = sellPct / 50;
        
        const transformed: OrderFlowData = {
          timestamp: apiData.timestamp || new Date().toISOString(),
          bid: +bidPrice.toFixed(2),
          ask: +askPrice.toFixed(2),
          spread: +(askPrice - bidPrice).toFixed(2),
          spreadPct: currentPrice > 0 ? +((askPrice - bidPrice) / currentPrice * 100).toFixed(4) : 0,
          bidLevels: Array(5).fill(null).map((_, i) => ({
            price: +(bidPrice - i * halfSpread * 2).toFixed(2),
            quantity: Math.round(baseQty * buyPressure * (1 - i * 0.12)),
            orders: Math.round(baseQty * buyPressure * (1 - i * 0.12) / 150) + 5,
          })),
          askLevels: Array(5).fill(null).map((_, i) => ({
            price: +(askPrice + i * halfSpread * 2).toFixed(2),
            quantity: Math.round(baseQty * sellPressure * (1 - i * 0.12)),
            orders: Math.round(baseQty * sellPressure * (1 - i * 0.12) / 150) + 5,
          })),
          totalBidQty: apiData.buy_volume || Math.round(baseQty * 5 * buyPressure),
          totalAskQty: apiData.sell_volume || Math.round(baseQty * 5 * sellPressure),
          totalBidOrders: Math.round((apiData.total_orders || 300) * buyPct / 100),
          totalAskOrders: Math.round((apiData.total_orders || 300) * sellPct / 100),
          delta: (apiData.buy_volume || Math.round(baseQty * 5 * buyPressure)) - (apiData.sell_volume || Math.round(baseQty * 5 * sellPressure)),
          deltaPercentage: (buyPct - sellPct) / 100,
          deltaTrend: apiData.smart_money_signal?.includes('BUY') ? 'BULLISH' : apiData.smart_money_signal?.includes('SELL') ? 'BEARISH' : 'NEUTRAL',
          buyerAggressionRatio: buyPct / 100,
          sellerAggressionRatio: sellPct / 100,
          liquidityImbalance: (apiData.order_flow_imbalance || 0) / 50,
          bidDepth: apiData.buy_volume || Math.round(baseQty * 5 * buyPressure),
          askDepth: apiData.sell_volume || Math.round(baseQty * 5 * sellPressure),
          buyDomination: buyPct > 60,
          sellDomination: sellPct > 60,
          signal: (apiData.smart_money_signal || 'HOLD') as any,
          signalConfidence: ((apiData.smart_money_confidence || 50) / 100),
          fiveMinPrediction: {
            direction: apiData.smart_money_signal || 'NEUTRAL',
            confidence: ((apiData.smart_money_confidence || 50) / 100),
            reasoning: apiData.flow_description || 'Market analysis from institutional positioning',
            tickCount: apiData.candles_analyzed || 50,
            avgDelta: (apiData.buy_volume || 0) - (apiData.sell_volume || 0),
            buyDominancePct: buyPct,
            sellDominancePct: sellPct,
          },
        };
        
        setRestData(transformed);
      } catch (error) {
        // Silently fail, show loading state instead
      } finally {
        setIsLoadingRest(false);
      }
    };

    // Fetch immediately and then every 3 seconds when WebSocket unavailable
    fetchRestData();
    const interval = setInterval(fetchRestData, 3000);
    
    return () => clearInterval(interval);
  }, [wsData, symbol]);

  // Use WebSocket data if available, otherwise REST data
  const data = wsData || restData;
  const isLoading = connectionStatus !== 'connected' && !restData && isLoadingRest;
  
  return (
    <React.Fragment>
      <OrderFlowCard 
        symbol={symbol} 
        data={data} 
        isLoading={isLoading}
      />
    </React.Fragment>
  );
}

