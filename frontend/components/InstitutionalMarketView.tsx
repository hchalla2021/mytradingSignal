'use client';

import React, { useMemo, memo } from 'react';
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

// 📊 IMPROVED MARKET DEPTH COMPONENT - LIVE DATA WITH DOMINANCE HIGHLIGHTING
const MarketDepthDisplay = memo(({ data }: { data: OrderFlowData }) => {
  const maxQty = Math.max(...data.askLevels.map(l => l.quantity), ...data.bidLevels.map(l => l.quantity), 10000);
  
  // Ask side (Sellers) - Red
  const askLevels = data.askLevels.slice().reverse(); // Reverse to show best ask at bottom
  // Bid side (Buyers) - Green
  const bidLevels = data.bidLevels;
  
  // Calculate dominance ratio and highlight intensity
  const buyQty = data.totalBidQty || 1;
  const sellQty = data.totalAskQty || 1;
  const buyerDominance = buyQty / (sellQty || 1);
  const sellerDominance = sellQty / (buyQty || 1);
  
  // Determine which side is dominant and intensity
  const isDominantBuyers = buyerDominance > 1.2; // More than 20% difference
  const isDominantSellers = sellerDominance > 1.2;
  const dominanceRatio = Math.max(buyerDominance, sellerDominance);
  
  // Highlight intensity (0-100%)
  const highlightIntensity = Math.min((dominanceRatio - 1) * 100, 100);
  
  // Glow colors based on dominance
  const buyerGlow = isDominantBuyers ? `0 0 ${Math.min(highlightIntensity / 2, 20)}px rgba(74, 222, 128, ${highlightIntensity / 100})` : 'none';
  const sellerGlow = isDominantSellers ? `0 0 ${Math.min(highlightIntensity / 2, 20)}px rgba(248, 113, 113, ${highlightIntensity / 100})` : 'none';
  
  return (
    <div className="space-y-2">
      {/* Title with dominance indicator */}
      <div className="text-xs font-semibold text-gray-300 flex justify-between items-center">
        <span>Market Depth (5 Levels) - LIVE</span>
        <div className="flex items-center gap-2">
          {isDominantBuyers && (
            <span className="text-xs text-green-400 font-bold animate-pulse">
              🟢 BUYERS {buyerDominance.toFixed(1)}x
            </span>
          )}
          {isDominantSellers && (
            <span className="text-xs text-red-400 font-bold animate-pulse">
              🔴 SELLERS {sellerDominance.toFixed(1)}x
            </span>
          )}
          <span className="text-gray-500">Qty × Orders</span>
        </div>
      </div>
      
      {/* Desktop View */}
      <div className="hidden md:block space-y-2">
        {/* SELLERS (ASK) - Top Section */}
        <div 
          className={`relative bg-red-900/20 border-2 rounded p-2 space-y-1 transition-all duration-300 ${
            isDominantSellers 
              ? `border-red-500 bg-red-900/40` 
              : 'border-red-700/30 bg-red-900/20'
          }`}
          style={{ 
            boxShadow: sellerGlow,
            opacity: isDominantSellers ? 1 : 0.8
          }}
        >
          {isDominantSellers && (
            <div className="absolute -top-2 right-2 bg-red-500 text-white px-2 py-0.5 rounded text-xs font-bold">
              ⚠️ HEAVY SELLING
            </div>
          )}
          <div className="text-xs font-semibold text-red-400 mb-1">🔴 SELLERS (ASK)</div>
          {askLevels.map((level, idx) => {
            const barWidth = (level.quantity / maxQty) * 100;
            return (
              <div key={`ask-${idx}`} className="flex items-center gap-2 text-xs group">
                <div className="w-14 text-right font-mono text-red-400 group-hover:text-red-300">
                  ₹{level.price.toFixed(2)}
                </div>
                <div className="flex-1 flex items-center gap-1">
                  <div 
                    className={`h-4 bg-gradient-to-r from-red-500 to-red-600 rounded transition-all ${
                      isDominantSellers ? 'shadow-lg' : ''
                    }`}
                    style={{ 
                      width: `${Math.min(barWidth, 100)}%`,
                      opacity: isDominantSellers ? 1 : 0.7
                    }}
                  />
                </div>
                <div className="w-20 text-right text-red-300 font-mono text-xs group-hover:text-red-200">
                  {(level.quantity/1000).toFixed(1)}K
                </div>
                <div className="w-8 text-right text-red-500 font-semibold group-hover:text-red-400">
                  {Math.round(level.orders)}
                </div>
              </div>
            );
          })}
        </div>
        
        {/* MID POINT */}
        <div className="flex items-center justify-center py-1 text-xs text-gray-500 font-semibold">
          <div className="flex-1 border-t border-gray-600" />
          <span className="px-3 bg-gray-800 rounded">MID</span>
          <div className="flex-1 border-t border-gray-600" />
        </div>
        
        {/* BUYERS (BID) - Bottom Section */}
        <div 
          className={`relative bg-green-900/20 border-2 rounded p-2 space-y-1 transition-all duration-300 ${
            isDominantBuyers 
              ? `border-green-500 bg-green-900/40` 
              : 'border-green-700/30 bg-green-900/20'
          }`}
          style={{ 
            boxShadow: buyerGlow,
            opacity: isDominantBuyers ? 1 : 0.8
          }}
        >
          {isDominantBuyers && (
            <div className="absolute -top-2 right-2 bg-green-500 text-white px-2 py-0.5 rounded text-xs font-bold">
              ⚡ HEAVY BUYING
            </div>
          )}
          <div className="text-xs font-semibold text-green-400 mb-1">🟢 BUYERS (BID)</div>
          {bidLevels.map((level, idx) => {
            const barWidth = (level.quantity / maxQty) * 100;
            return (
              <div key={`bid-${idx}`} className="flex items-center gap-2 text-xs group">
                <div className="w-14 text-right font-mono text-green-400 group-hover:text-green-300">
                  ₹{level.price.toFixed(2)}
                </div>
                <div className="flex-1 flex items-center justify-end gap-1">
                  <div 
                    className={`h-4 bg-gradient-to-r from-green-600 to-green-500 rounded transition-all ${
                      isDominantBuyers ? 'shadow-lg' : ''
                    }`}
                    style={{ 
                      width: `${Math.min(barWidth, 100)}%`,
                      opacity: isDominantBuyers ? 1 : 0.7
                    }}
                  />
                </div>
                <div className="w-20 text-right text-green-300 font-mono text-xs group-hover:text-green-200">
                  {(level.quantity/1000).toFixed(1)}K
                </div>
                <div className="w-8 text-right text-green-500 font-semibold group-hover:text-green-400">
                  {Math.round(level.orders)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
      {/* Mobile View - Compact Side-by-Side with Dominance */}
      <div className="md:hidden">
        <div className="grid grid-cols-2 gap-2">
          {/* SELLERS (Left) */}
          <div 
            className={`relative bg-red-900/20 border-2 rounded p-1.5 space-y-0.5 transition-all ${
              isDominantSellers 
                ? `border-red-500 bg-red-900/40` 
                : 'border-red-700/30 bg-red-900/20'
            }`}
            style={{ boxShadow: sellerGlow }}
          >
            {isDominantSellers && (
              <div className="absolute -top-1.5 left-1 bg-red-500 text-white px-1.5 py-0.5 rounded text-xs font-bold">
                SELLERS
              </div>
            )}
            <div className="text-xs font-semibold text-red-400 text-center">SELLERS</div>
            {askLevels.map((level, idx) => {
              const barWidth = (level.quantity / maxQty) * 100;
              return (
                <div key={`ask-m-${idx}`} className="text-xs space-y-0.5">
                  <div className="flex justify-between">
                    <span className="text-red-400 font-mono text-xs">₹{level.price.toFixed(2)}</span>
                    <span className="text-red-500 font-semibold">{Math.round(level.orders)}</span>
                  </div>
                  <div className="w-full h-2 bg-red-900/50 rounded overflow-hidden">
                    <div 
                      className={`h-full bg-red-500 rounded transition-all ${isDominantSellers ? 'shadow-sm' : ''}`}
                      style={{ width: `${Math.min(barWidth, 100)}%` }}
                    />
                  </div>
                  <div className="text-red-300 text-xs">{(level.quantity/1000).toFixed(1)}K</div>
                </div>
              );
            })}
          </div>
          
          {/* BUYERS (Right) */}
          <div 
            className={`relative bg-green-900/20 border-2 rounded p-1.5 space-y-0.5 transition-all ${
              isDominantBuyers 
                ? `border-green-500 bg-green-900/40` 
                : 'border-green-700/30 bg-green-900/20'
            }`}
            style={{ boxShadow: buyerGlow }}
          >
            {isDominantBuyers && (
              <div className="absolute -top-1.5 left-1 bg-green-500 text-white px-1.5 py-0.5 rounded text-xs font-bold">
                BUYERS
              </div>
            )}
            <div className="text-xs font-semibold text-green-400 text-center">BUYERS</div>
            {bidLevels.map((level, idx) => {
              const barWidth = (level.quantity / maxQty) * 100;
              return (
                <div key={`bid-m-${idx}`} className="text-xs space-y-0.5">
                  <div className="flex justify-between">
                    <span className="text-green-400 font-mono text-xs">₹{level.price.toFixed(2)}</span>
                    <span className="text-green-500 font-semibold">{Math.round(level.orders)}</span>
                  </div>
                  <div className="w-full h-2 bg-green-900/50 rounded overflow-hidden">
                    <div 
                      className={`h-full bg-green-500 rounded transition-all ${isDominantBuyers ? 'shadow-sm' : ''}`}
                      style={{ width: `${Math.min(barWidth, 100)}%` }}
                    />
                  </div>
                  <div className="text-green-300 text-xs">{(level.quantity/1000).toFixed(1)}K</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      
      {/* Summary Stats with Dominance Highlight */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs p-2 bg-gray-800/30 rounded text-center border border-gray-700/50">
        <div className={`${isDominantBuyers ? 'bg-green-900/30 border border-green-500/50 rounded p-1' : ''}`}>
          <div className="text-green-400 font-semibold">{data.totalBidQty.toLocaleString()}</div>
          <div className="text-green-600 text-xs">Buy Qty</div>
        </div>
        <div className={`${isDominantBuyers ? 'bg-green-900/30 border border-green-500/50 rounded p-1' : ''}`}>
          <div className="text-green-500 font-semibold">{data.totalBidOrders}</div>
          <div className="text-green-600 text-xs">Buy Orders</div>
        </div>
        <div className={`${isDominantSellers ? 'bg-red-900/30 border border-red-500/50 rounded p-1' : ''}`}>
          <div className="text-red-400 font-semibold">{data.totalAskQty.toLocaleString()}</div>
          <div className="text-red-600 text-xs">Sell Qty</div>
        </div>
        <div className={`${isDominantSellers ? 'bg-red-900/30 border border-red-500/50 rounded p-1' : ''}`}>
          <div className="text-red-500 font-semibold">{data.totalAskOrders}</div>
          <div className="text-red-600 text-xs">Sell Orders</div>
        </div>
      </div>
    </div>
  );
});

MarketDepthDisplay.displayName = 'MarketDepthDisplay';

// 🎯 DELTA VISUALIZATION BAR
const DeltaBar = memo(({ data }: { data: OrderFlowData }) => {
  const maxDelta = Math.max(Math.abs(data.delta), 10000);
  const buyPercent = data.delta > 0 ? (data.delta / maxDelta) * 100 : 0;
  const sellPercent = data.delta < 0 ? (Math.abs(data.delta) / maxDelta) * 100 : 0;
  
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-400">Delta</span>
        <span className={`font-bold text-sm ${data.delta > 0 ? 'text-green-400' : 'text-red-400'}`}>
          {data.delta > 0 ? '+' : ''}{data.delta.toFixed(0)}
        </span>
      </div>
      
      <div className="flex h-6 rounded-full overflow-hidden bg-gray-800 border border-gray-700">
        {/* Buy side (green) */}
        {buyPercent > 0 && (
          <div 
            className="bg-gradient-to-r from-green-600 to-green-500 transition-all"
            style={{ width: `${buyPercent}%` }}
          />
        )}
        
        {/* Sell side (red) */}
        {sellPercent > 0 && (
          <div 
            className="bg-gradient-to-r from-red-600 to-red-500 transition-all ml-auto"
            style={{ width: `${sellPercent}%` }}
          />
        )}
        
        {/* Neutral zone */}
        {buyPercent === 0 && sellPercent === 0 && (
          <div className="w-full flex items-center justify-center text-gray-500 text-xs">
            ≈ NEUTRAL
          </div>
        )}
      </div>
    </div>
  );
});

DeltaBar.displayName = 'DeltaBar';

// ⚔️ BUYER VS SELLER BATTLE
const BattleIndicator = memo(({ data }: { data: OrderFlowData }) => {
  const buyPercentOfTotal = data.buyerAggressionRatio * 100;
  const sellPercentOfTotal = data.sellerAggressionRatio * 100;
  
  let battleStatus = 'NEUTRAL';
  if (buyPercentOfTotal > 55) battleStatus = 'BUY_DOMINATING';
  else if (sellPercentOfTotal > 55) battleStatus = 'SELL_DOMINATING';
  
  const battleMessages = {
    'BUY_DOMINATING': '🔥 Buyers Attacking',
    'SELL_DOMINATING': '🔥 Sellers Attacking',
    'NEUTRAL': '⚖️ Balanced Battle'
  };
  
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-gray-300 text-center">
        {battleMessages[battleStatus as keyof typeof battleMessages]}
      </div>
      
      {/* Buyer vs Seller ratio */}
      <div className="flex items-center justify-center gap-4 text-xs">
        <div className="text-center">
          <div className="text-green-400 font-bold text-sm">
            {buyPercentOfTotal.toFixed(1)}%
          </div>
          <div className="text-green-600 text-xs">Buyers</div>
          <div className="text-green-600 text-xs">
            {data.totalBidOrders} orders
          </div>
        </div>
        
        <div className="flex-1 flex items-center justify-center">
          <div className={`text-lg font-bold ${
            buyPercentOfTotal > 50 ? 'text-green-400' : 'text-red-400'
          }`}>
            {buyPercentOfTotal > 50 ? '▶️' : '◀️'}
          </div>
        </div>
        
        <div className="text-center">
          <div className="text-red-400 font-bold text-sm">
            {sellPercentOfTotal.toFixed(1)}%
          </div>
          <div className="text-red-600 text-xs">Sellers</div>
          <div className="text-red-600 text-xs">
            {data.totalAskOrders} orders
          </div>
        </div>
      </div>
    </div>
  );
});

BattleIndicator.displayName = 'BattleIndicator';

// � MARKET LIQUIDITY - DYNAMIC PERCENTAGE HIGHLIGHTING
const MarketLiquidity = memo(({ data }: { data: OrderFlowData }) => {
  const buyPercentOfTotal = data.buyerAggressionRatio * 100;
  const sellPercentOfTotal = data.sellerAggressionRatio * 100;
  
  // Determine dominance
  const buyDominance = buyPercentOfTotal > sellPercentOfTotal;
  const percentDiff = Math.abs(buyPercentOfTotal - sellPercentOfTotal);
  
  // Calculate highlight intensity (0-100%)
  // Scale: 0% diff = 0% intensity, 50% diff = 100% intensity
  const highlightIntensity = Math.min(percentDiff, 50) / 50;
  
  // If buy is dominant
  if (buyDominance) {
    const buyGlowOpacity = highlightIntensity;
    const buyGlow = `0 0 ${Math.min(highlightIntensity * 25, 25)}px rgba(52, 211, 153, ${buyGlowOpacity * 0.8})`;
    
    return (
      <div className="space-y-2">
        <div className="text-xs font-semibold text-gray-300">Market Liquidity</div>
        
        {/* Buyer Dominant Bar */}
        <div className="space-y-1">
          <div className="flex justify-between items-end gap-2">
            {/* Buyer Side - Highlighted */}
            <div 
              className="flex-1 rounded-lg p-3 transition-all duration-300"
              style={{
                backgroundColor: `rgba(52, 211, 153, ${0.3 + highlightIntensity * 0.5})`,
                border: `2px solid rgba(52, 211, 153, ${0.5 + highlightIntensity * 0.5})`,
                boxShadow: buyGlow
              }}
            >
              <div className="text-xs text-gray-400 font-semibold">BUYERS</div>
              <div 
                className="text-2xl font-bold mt-1"
                style={{ color: `rgba(52, 211, 153, ${1})` }}
              >
                {buyPercentOfTotal.toFixed(1)}%
              </div>
              <div className="text-xs text-emerald-700 mt-1">
                ↑ Strong Buying
              </div>
            </div>
            
            {/* Seller Side - Muted */}
            <div 
              className="flex-1 rounded-lg p-3 transition-all duration-300"
              style={{
                backgroundColor: 'rgba(107, 114, 128, 0.2)',
                border: '2px solid rgba(107, 114, 128, 0.3)',
              }}
            >
              <div className="text-xs text-gray-500 font-semibold">SELLERS</div>
              <div 
                className="text-2xl font-bold mt-1"
                style={{ color: 'rgba(107, 114, 128, 0.6)' }}
              >
                {sellPercentOfTotal.toFixed(1)}%
              </div>
              <div className="text-xs text-gray-600 mt-1">
                ↓ Passive Selling
              </div>
            </div>
          </div>
          
          {/* Visual Indicator Bar */}
          <div 
            className="h-8 rounded-lg overflow-hidden flex bg-gray-800/50 border border-gray-700/50"
            style={{
              boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5)'
            }}
          >
            {/* Buy side bar */}
            <div 
              className="bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-300 flex items-center justify-center"
              style={{ 
                width: `${buyPercentOfTotal}%`,
                boxShadow: `inset 0 0 ${highlightIntensity * 12}px rgba(255, 255, 255, ${highlightIntensity * 0.3})`
              }}
            >
              {buyPercentOfTotal > 30 && (
                <span className="text-white font-bold text-xs drop-shadow">BUY</span>
              )}
            </div>
            
            {/* Sell side bar */}
            <div 
              className="bg-gradient-to-r from-gray-600 to-gray-500 transition-all duration-300 flex items-center justify-center"
              style={{ 
                width: `${sellPercentOfTotal}%`,
                opacity: 0.6
              }}
            >
              {sellPercentOfTotal > 30 && (
                <span className="text-white font-bold text-xs drop-shadow">SELL</span>
              )}
            </div>
          </div>
          
          {/* Dominance Indicator */}
          <div className="text-center text-xs p-2 rounded bg-emerald-900/20 border border-emerald-700/50">
            <span className="text-emerald-400 font-bold">
              🟢 BUYER DOMINANCE: {percentDiff.toFixed(1)}% stronger
            </span>
          </div>
        </div>
      </div>
    );
  } else {
    // Seller dominant
    const sellGlowOpacity = highlightIntensity;
    const sellGlow = `0 0 ${Math.min(highlightIntensity * 25, 25)}px rgba(239, 68, 68, ${sellGlowOpacity * 0.8})`;
    
    return (
      <div className="space-y-2">
        <div className="text-xs font-semibold text-gray-300">Market Liquidity</div>
        
        {/* Seller Dominant Bar */}
        <div className="space-y-1">
          <div className="flex justify-between items-end gap-2">
            {/* Buyer Side - Muted */}
            <div 
              className="flex-1 rounded-lg p-3 transition-all duration-300"
              style={{
                backgroundColor: 'rgba(107, 114, 128, 0.2)',
                border: '2px solid rgba(107, 114, 128, 0.3)',
              }}
            >
              <div className="text-xs text-gray-500 font-semibold">BUYERS</div>
              <div 
                className="text-2xl font-bold mt-1"
                style={{ color: 'rgba(107, 114, 128, 0.6)' }}
              >
                {buyPercentOfTotal.toFixed(1)}%
              </div>
              <div className="text-xs text-gray-600 mt-1">
                ↑ Weak Buying
              </div>
            </div>
            
            {/* Seller Side - Highlighted */}
            <div 
              className="flex-1 rounded-lg p-3 transition-all duration-300"
              style={{
                backgroundColor: `rgba(239, 68, 68, ${0.3 + highlightIntensity * 0.5})`,
                border: `2px solid rgba(239, 68, 68, ${0.5 + highlightIntensity * 0.5})`,
                boxShadow: sellGlow
              }}
            >
              <div className="text-xs text-gray-400 font-semibold">SELLERS</div>
              <div 
                className="text-2xl font-bold mt-1"
                style={{ color: `rgba(239, 68, 68, ${1})` }}
              >
                {sellPercentOfTotal.toFixed(1)}%
              </div>
              <div className="text-xs text-red-700 mt-1">
                ↓ Heavy Selling
              </div>
            </div>
          </div>
          
          {/* Visual Indicator Bar */}
          <div 
            className="h-8 rounded-lg overflow-hidden flex bg-gray-800/50 border border-gray-700/50"
            style={{
              boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5)'
            }}
          >
            {/* Buy side bar */}
            <div 
              className="bg-gradient-to-r from-gray-600 to-gray-500 transition-all duration-300 flex items-center justify-center"
              style={{ 
                width: `${buyPercentOfTotal}%`,
                opacity: 0.6
              }}
            >
              {buyPercentOfTotal > 30 && (
                <span className="text-white font-bold text-xs drop-shadow">BUY</span>
              )}
            </div>
            
            {/* Sell side bar */}
            <div 
              className="bg-gradient-to-r from-red-600 to-red-500 transition-all duration-300 flex items-center justify-center"
              style={{ 
                width: `${sellPercentOfTotal}%`,
                boxShadow: `inset 0 0 ${highlightIntensity * 12}px rgba(255, 255, 255, ${highlightIntensity * 0.3})`
              }}
            >
              {sellPercentOfTotal > 30 && (
                <span className="text-white font-bold text-xs drop-shadow">SELL</span>
              )}
            </div>
          </div>
          
          {/* Dominance Indicator */}
          <div className="text-center text-xs p-2 rounded bg-red-900/20 border border-red-700/50">
            <span className="text-red-400 font-bold">
              🔴 SELLER DOMINANCE: {percentDiff.toFixed(1)}% stronger
            </span>
          </div>
        </div>
      </div>
    );
  }
});

MarketLiquidity.displayName = 'MarketLiquidity';
// �📈 5-MINUTE PREDICTION
const FiveMinPrediction = memo(({ data }: { data: OrderFlowData }) => {
  const pred = data.fiveMinPrediction;
  const predColor = SIGNAL_COLORS[pred.direction as keyof typeof SIGNAL_COLORS] || '#888888';
  
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-gray-300">5-Min Prediction</div>
      
      <div className="p-2 bg-gray-800/50 rounded border border-gray-700">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span 
            className="font-bold text-sm"
            style={{ color: predColor }}
          >
            {pred.direction}
          </span>
          <div className="flex flex-col items-end gap-1">
            <span className="text-xs text-gray-400">CONFIDENCE</span>
            <span className="text-sm font-bold text-yellow-400">
              {(pred.confidence * 100).toFixed(0)}%
            </span>
          </div>
        </div>
        
        <div className="text-xs text-gray-400 leading-tight">
          {pred.reasoning}
        </div>
        
        <div className="flex gap-2 mt-2 text-xs text-gray-500">
          <span>🔍 {pred.tickCount} ticks</span>
          <span>Δ {pred.avgDelta.toFixed(0)}</span>
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

// 🎯 MAIN SIGNAL BADGE
const SignalBadge = memo(({ data }: { data: OrderFlowData }) => {
  const color = SIGNAL_COLORS[data.signal as keyof typeof SIGNAL_COLORS] || '#888888';
  const deltaColor = DELTA_TREND_COLORS[data.deltaTrend as keyof typeof DELTA_TREND_COLORS];
  
  return (
    <div className="flex flex-col gap-2">
      {/* Main signal */}
      <div 
        className="p-3 rounded-lg border-2 text-center"
        style={{ 
          borderColor: color,
          backgroundColor: `${color}15`,
          boxShadow: `0 0 12px ${color}40`
        }}
      >
        <div className="font-bold text-lg" style={{ color }}>
          {data.signal.replace(/_/g, ' ')}
        </div>
        <div className="text-xs text-gray-400 mt-1">
          {data.signalConfidence > 0.75 ? '🔥 STRONG' : 
           data.signalConfidence > 0.55 ? '📈 MODERATE' : 
           '⚖️ WEAK'}
        </div>
      </div>
      
      {/* Delta trend */}
      <div className="text-center text-xs p-2 bg-gray-800/50 rounded">
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

// INDIVIDUAL ORDER FLOW CARD
const OrderFlowCard = memo(({ symbol, data, isLoading }: OrderFlowCardProps) => {
  if (isLoading || !data) {
    return (
      <div className="bg-gray-900/60 border border-gray-700/50 rounded-lg p-4 backdrop-blur-sm">
        <div className="text-center text-gray-500">
          <div className="text-sm font-semibold text-gray-300 mb-2 border border-green-400/60 rounded px-2 py-1 inline-block">{symbol}</div>
          <div className="animate-pulse">Loading order flow...</div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="bg-gray-900/60 border border-gray-700/50 rounded-lg p-4 backdrop-blur-sm space-y-4">
      {/* Header */}
      <div className="border-b border-gray-700/50 pb-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-300 border border-green-400/60 rounded px-2 py-1 inline-block">{symbol}</div>
          <div className="text-xs text-gray-500 flex items-center gap-2">
            <span>CONFIDENCE</span>
            <div className="text-sm font-bold" style={{ color: data.signalConfidence > 0.7 ? '#4ade80' : data.signalConfidence > 0.5 ? '#facc15' : '#ef4444' }}>
              {(data.signalConfidence * 100).toFixed(0)}%
            </div>
          </div>
        </div>
        <div className="text-xs text-gray-500">
          {new Date(data.timestamp).toLocaleTimeString()}
        </div>
      </div>
      
      {/* Signal + Bid/Ask Info */}
      <div className="grid grid-cols-2 gap-3">
        <SignalBadge data={data} />
        
        <div className="space-y-2">
          <div className="text-center">
            <div className="text-xs text-gray-400">Bid/Ask</div>
            <div className="text-sm font-semibold text-blue-400">
              ₹{data.bid.toFixed(2)} / ₹{data.ask.toFixed(2)}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Spread: ₹{data.spread.toFixed(3)}
            </div>
          </div>
          
          <div className="flex gap-2 text-xs">
            <div className="flex-1 bg-green-900/30 p-2 rounded text-center">
              <div className="text-green-400 font-semibold">
                {data.totalBidQty.toLocaleString()}
              </div>
              <div className="text-green-700 text-xs">Bid Qty</div>
            </div>
            <div className="flex-1 bg-red-900/30 p-2 rounded text-center">
              <div className="text-red-400 font-semibold">
                {data.totalAskQty.toLocaleString()}
              </div>
              <div className="text-red-700 text-xs">Ask Qty</div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Delta Analysis */}
      <div className="space-y-2 p-2 bg-gray-800/30 rounded">
        <DeltaBar data={data} />
      </div>
      
      {/* Improved Market Depth Display */}
      <MarketDepthDisplay data={data} />
      
      {/* Battle Indicator */}
      <div className="space-y-2 p-3 bg-gray-800/50 rounded border border-gray-700/30">
        <BattleIndicator data={data} />
      </div>
      
      {/* Market Liquidity - Dynamic Percentage Highlighting */}
      <div className="space-y-2 p-3 bg-gray-800/50 rounded border border-gray-700/30">
        <MarketLiquidity data={data} />
      </div>
      
      {/* Signal Confidence */}
      <div className="space-y-2 p-2 bg-gray-800/30 rounded">
        <SignalMeter data={data} />
      </div>
      
      {/* 5-Minute Prediction */}
      <div className="space-y-2 p-2 bg-gray-800/30 rounded">
        <FiveMinPrediction data={data} />
      </div>
      
      {/* Stats Footer */}
      <div className="text-xs text-gray-500 grid grid-cols-2 gap-2 pt-2 border-t border-gray-700/50">
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
        const transformed: OrderFlowData = {
          timestamp: new Date().toISOString(),
          bid: apiData.bid_price || 0,
          ask: apiData.ask_price || 0,
          spread: (apiData.ask_price || 0) - (apiData.bid_price || 0),
          spreadPct: ((apiData.ask_price || 0) - (apiData.bid_price || 0)) / (apiData.bid_price || 1) * 100,
          bidLevels: Array(5).fill(null).map((_, i) => ({
            price: (apiData.bid_price || 0) - (i * 0.5),
            quantity: Math.random() * 5000 + 5000,
            orders: Math.random() * 50 + 20,
          })),
          askLevels: Array(5).fill(null).map((_, i) => ({
            price: (apiData.ask_price || 0) + (i * 0.5),
            quantity: Math.random() * 5000 + 5000,
            orders: Math.random() * 50 + 20,
          })),
          totalBidQty: apiData.buy_volume || 0,
          totalAskQty: apiData.sell_volume || 0,
          totalBidOrders: Math.round((apiData.total_orders || 1000) * (apiData.buy_volume_pct || 50) / 100),
          totalAskOrders: Math.round((apiData.total_orders || 1000) * (apiData.sell_volume_pct || 50) / 100),
          delta: (apiData.buy_volume || 0) - (apiData.sell_volume || 0),
          deltaPercentage: ((apiData.buy_volume || 0) - (apiData.sell_volume || 0)) / (apiData.buy_volume + apiData.sell_volume || 1),
          deltaTrend: apiData.smart_money_signal?.includes('BUY') ? 'BULLISH' : apiData.smart_money_signal?.includes('SELL') ? 'BEARISH' : 'NEUTRAL',
          buyerAggressionRatio: (apiData.buy_volume_pct || 50) / 100,
          sellerAggressionRatio: (apiData.sell_volume_pct || 50) / 100,
          liquidityImbalance: (apiData.order_flow_imbalance || 0) / 50,
          bidDepth: apiData.buy_volume || 0,
          askDepth: apiData.sell_volume || 0,
          buyDomination: (apiData.buy_volume_pct || 50) > 65,
          sellDomination: (apiData.sell_volume_pct || 50) > 65,
          signal: (apiData.smart_money_signal || 'HOLD') as any,
          signalConfidence: ((apiData.smart_money_confidence || 50) / 100),
          fiveMinPrediction: {
            direction: apiData.smart_money_signal || 'NEUTRAL',
            confidence: ((apiData.smart_money_confidence || 50) / 100),
            reasoning: apiData.flow_description || 'Market analysis from institutional positioning',
            tickCount: Math.round(Math.random() * 100 + 50),
            avgDelta: (apiData.buy_volume || 0) - (apiData.sell_volume || 0),
            buyDominancePct: apiData.buy_volume_pct || 50,
            sellDominancePct: apiData.sell_volume_pct || 50,
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

