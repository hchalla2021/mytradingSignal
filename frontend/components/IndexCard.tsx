'use client';

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus, Activity } from 'lucide-react';
import { MarketTick } from '@/hooks/useMarketSocket';
import AIAlertTooltip from './AIAlertTooltip';
import type { AIAlertTooltipData } from '@/types/ai';

interface SymbolOutlook {
  overallConfidence: number;
  overallSignal: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
  tradeRecommendation: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

interface IndexCardProps {
  symbol: string;
  name: string;
  data: MarketTick | null;
  isConnected: boolean;
  aiAlertData?: AIAlertTooltipData;
  outlookData?: SymbolOutlook | null;
}

// Reusable market analysis utilities
const MarketUtils = {
  formatPrice: (price: number): string => {
    return new Intl.NumberFormat('en-IN', {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(price);
  },

  formatChange: (change: number): string => {
    const sign = change >= 0 ? '+' : '';
    return `${sign}${MarketUtils.formatPrice(change)}`;
  },

  formatPercent: (percent: number): string => {
    const sign = percent >= 0 ? '+' : '';
    return `${sign}${percent.toFixed(2)}%`;
  },

  formatVolume: (vol: number): string => {
    if (vol >= 10000000) return `${(vol / 10000000).toFixed(2)} Cr`;
    if (vol >= 100000) return `${(vol / 100000).toFixed(2)} L`;
    if (vol >= 1000) return `${(vol / 1000).toFixed(1)} K`;
    return vol.toString();
  },

  formatOI: (oi: number): string => {
    if (oi >= 10000000) return `${(oi / 10000000).toFixed(2)} Cr`;
    if (oi >= 100000) return `${(oi / 100000).toFixed(2)} L`;
    if (oi >= 1000) return `${(oi / 1000).toFixed(1)} K`;
    return oi.toString();
  },

  // Calculate intraday range position (0-100%)
  getRangePosition: (price: number, low: number, high: number): number => {
    if (high === low) return 50;
    return Math.round(((price - low) / (high - low)) * 100);
  },

  // PCR Analysis - Put Call Ratio interpretation
  analyzePCR: (pcr: number) => {
    if (!pcr || pcr === 0) {
      return { label: 'N/A', sentiment: 'neutral', color: 'text-dark-muted', bg: 'bg-dark-border', emoji: '⏸️' };
    }
    
    // PCR interpretation (contrarian view - high PCR = bullish)
    if (pcr >= 1.5) return { label: 'Very Bullish', sentiment: 'bullish', color: 'text-bullish', bg: 'bg-bullish', emoji: '🚀' };
    if (pcr >= 1.2) return { label: 'Bullish', sentiment: 'bullish', color: 'text-bullish', bg: 'bg-bullish', emoji: '📈' };
    if (pcr >= 1.0) return { label: 'Mild Bullish', sentiment: 'bullish', color: 'text-bullish', bg: 'bg-bullish', emoji: '🟢' };
    if (pcr >= 0.8) return { label: 'Neutral', sentiment: 'neutral', color: 'text-neutral', bg: 'bg-neutral', emoji: '➖' };
    if (pcr >= 0.6) return { label: 'Mild Bearish', sentiment: 'bearish', color: 'text-bearish', bg: 'bg-bearish', emoji: '🔴' };
    if (pcr >= 0.4) return { label: 'Bearish', sentiment: 'bearish', color: 'text-bearish', bg: 'bg-bearish', emoji: '📉' };
    return { label: 'Very Bearish', sentiment: 'bearish', color: 'text-bearish', bg: 'bg-bearish', emoji: '💥' };
  },

  // Advanced trend analysis with proper market direction
  analyzeTrend: (data: MarketTick | null) => {
    if (!data) {
      return { 
        direction: 'neutral' as const, 
        strength: 0, 
        label: 'No Data', 
        emoji: '⏸️',
        color: 'text-dark-muted', 
        bg: 'bg-dark-border',
        bgLight: 'bg-dark-border/20'
      };
    }
    
    const pct = data.changePercent;
    const absPct = Math.abs(pct);
    const isBullish = pct > 0;
    const isBearish = pct < 0;
    
    // Strength calculation: 0-100 based on percentage move
    const strength = Math.min(absPct * 50, 100);
    
    // Determine trend label based on direction AND strength
    let label: string;
    let emoji: string;
    
    if (absPct < 0.05) {
      label = 'Flat'; emoji = '➖';
    } else if (isBullish) {
      if (absPct >= 2) { label = 'Rally'; emoji = '🚀'; }
      else if (absPct >= 1) { label = 'Strong Bullish'; emoji = '📈'; }
      else if (absPct >= 0.5) { label = 'Bullish'; emoji = '↗️'; }
      else if (absPct >= 0.2) { label = 'Mild Bullish'; emoji = '🟢'; }
      else { label = 'Slight Up'; emoji = '⬆️'; }
    } else {
      if (absPct >= 2) { label = 'Crash'; emoji = '💥'; }
      else if (absPct >= 1) { label = 'Strong Bearish'; emoji = '📉'; }
      else if (absPct >= 0.5) { label = 'Bearish'; emoji = '↘️'; }
      else if (absPct >= 0.2) { label = 'Mild Bearish'; emoji = '🔴'; }
      else { label = 'Slight Down'; emoji = '⬇️'; }
    }
    
    return {
      direction: isBullish ? 'bullish' as const : isBearish ? 'bearish' as const : 'neutral' as const,
      strength: Math.round(strength),
      label,
      emoji,
      color: isBullish ? 'text-bullish' : isBearish ? 'text-bearish' : 'text-neutral',
      bg: isBullish ? 'bg-bullish' : isBearish ? 'bg-bearish' : 'bg-neutral',
      bgLight: isBullish ? 'bg-bullish/20' : isBearish ? 'bg-bearish/20' : 'bg-neutral/20',
    };
  },
};

const IndexCard = ({ symbol, name, data, isConnected, aiAlertData, outlookData }: IndexCardProps) => {
  const [flash, setFlash] = useState<'green' | 'red' | null>(null);
  const [showAlert, setShowAlert] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const prevPriceRef = useRef<number | null>(null);

  // Update alert visibility when AI data changes
  useEffect(() => {
    if (aiAlertData?.showAlert) {
      setShowAlert(true);
    }
  }, [aiAlertData]);

  // Memoized calculations
  const analysis = useMemo(() => MarketUtils.analyzeTrend(data), [data]);
  const pcrAnalysis = useMemo(() => MarketUtils.analyzePCR(data?.pcr || 0), [data?.pcr]);
  const rangePos = useMemo(() => {
    return data ? MarketUtils.getRangePosition(data.price, data.low, data.high) : 50;
  }, [data]);
  const intradayChange = useMemo(() => {
    return data ? ((data.price - data.open) / data.open * 100) : 0;
  }, [data]);

  // Flash animation on price change
  useEffect(() => {
    console.log(`💳 IndexCard[${symbol}] render - price: ${data?.price}, status: ${data?.status}`);
    if (data?.price) {
      // Update timestamp on every data change
      setLastUpdate(new Date().toLocaleTimeString());
      
      if (prevPriceRef.current !== null) {
        if (data.price > prevPriceRef.current) {
          setFlash('green');
        } else if (data.price < prevPriceRef.current) {
          setFlash('red');
        }
        
        const timeout = setTimeout(() => setFlash(null), 500);
        return () => clearTimeout(timeout);
      }
      prevPriceRef.current = data.price;
    }
  }, [data?.price, data?.timestamp, symbol]);

  const getTrendIcon = (size = 5) => {
    const cls = `w-${size} h-${size}`;
    if (!data) return <Minus className={cls} />;
    if (data.trend === 'bullish') return <TrendingUp className={cls} />;
    if (data.trend === 'bearish') return <TrendingDown className={cls} />;
    return <Minus className={cls} />;
  };

  const getStatusBadge = () => {
    if (!isConnected) {
      return <span className="px-2 py-0.5 text-xs font-medium bg-bearish/20 text-bearish rounded-full">OFFLINE</span>;
    }
    if (data?.status === 'CLOSED' || data?.status === 'OFFLINE') {
      return <span className="px-2 py-0.5 text-xs font-medium bg-neutral/20 text-neutral rounded-full">CLOSED</span>;
    }
    if (data?.status === 'PRE_OPEN') {
      return (
        <div className="flex flex-col items-end gap-0.5">
          <span className="px-2 py-0.5 text-xs font-medium bg-yellow-500/20 text-yellow-400 rounded-full flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-pulse" />PRE-OPEN
          </span>
          {lastUpdate && (
            <span className="text-[8px] text-dark-muted font-mono">{lastUpdate}</span>
          )}
        </div>
      );
    }
    return (
      <div className="flex flex-col items-end gap-0.5">
        <span className="px-2 py-0.5 text-xs font-medium bg-bullish/20 text-bullish rounded-full flex items-center gap-1">
          <span className="w-1.5 h-1.5 bg-bullish rounded-full animate-pulse" />LIVE
        </span>
        {lastUpdate && (
          <span className="text-[8px] text-dark-muted font-mono">{lastUpdate}</span>
        )}
      </div>
    );
  };

  return (
    <div className={`
      relative overflow-hidden
      bg-dark-card
      rounded-lg sm:rounded-xl
      border-2 border-emerald-500/30
      p-3 sm:p-4 lg:p-5
      transition-all duration-200
      hover:border-emerald-500/50
      hover:shadow-lg hover:shadow-emerald-500/20
      shadow-md shadow-emerald-500/10
      ${flash === 'green' ? 'animate-flash-green' : ''}
      ${flash === 'red' ? 'animate-flash-red' : ''}
    `}>
      {/* AI Alert Tooltip - Fire Symbol for Crash/Strong Signals */}
      {aiAlertData && showAlert && (
        <AIAlertTooltip 
          data={aiAlertData} 
          onDismiss={() => setShowAlert(false)}
        />
      )}
      {/* Header */}
      <div className="flex items-center justify-between mb-3 sm:mb-4">
        <div className="flex items-center gap-2.5">
          <div className={`p-2 sm:p-2.5 rounded-lg ${analysis.color} border-2 border-green-500/40 bg-green-950/10 shadow-sm shadow-green-500/10`}>
            <Activity className={`w-4 h-4 sm:w-5 sm:h-5 ${analysis.color}`} />
          </div>
          <div>
            <h3 className="font-bold text-white text-sm sm:text-base tracking-tight">{name}</h3>
            <p className="text-[10px] sm:text-xs text-dark-muted font-medium">{symbol}</p>
          </div>
        </div>
        {getStatusBadge()}
      </div>

      {/* Overall Market Outlook - SUPER SIMPLE FOR TRADERS */}
      {outlookData && (
        <div className="mb-3 p-3 bg-gradient-to-br from-slate-900/60 to-slate-800/40 rounded-xl border-2 border-slate-600/40 shadow-lg">
          
          {/* 🎯 BIG DECISION BOX - CAN I TRADE? */}
          <div className={`mb-3 p-3 rounded-xl border-2 text-center ${
            (outlookData.overallSignal === 'STRONG_BUY' || outlookData.overallSignal === 'BUY') && outlookData.overallConfidence >= 60 && outlookData.riskLevel !== 'HIGH'
              ? 'bg-emerald-500/20 border-emerald-400'
              : outlookData.overallSignal === 'NEUTRAL' || outlookData.overallConfidence < 60 || (outlookData.overallSignal === 'BUY' && outlookData.riskLevel === 'HIGH')
              ? 'bg-amber-500/20 border-amber-400'
              : 'bg-rose-500/20 border-rose-400'
          }`}>
            <div className="text-2xl mb-1">
              {(outlookData.overallSignal === 'STRONG_BUY' || outlookData.overallSignal === 'BUY') && outlookData.overallConfidence >= 60 && outlookData.riskLevel !== 'HIGH'
                ? '✅'
                : outlookData.overallSignal === 'NEUTRAL' || outlookData.overallConfidence < 60 || (outlookData.overallSignal === 'BUY' && outlookData.riskLevel === 'HIGH')
                ? '⏸️'
                : '❌'}
            </div>
            <div className={`text-lg font-black tracking-wide ${
              (outlookData.overallSignal === 'STRONG_BUY' || outlookData.overallSignal === 'BUY') && outlookData.overallConfidence >= 60 && outlookData.riskLevel !== 'HIGH'
                ? 'text-emerald-200'
                : outlookData.overallSignal === 'NEUTRAL' || outlookData.overallConfidence < 60 || (outlookData.overallSignal === 'BUY' && outlookData.riskLevel === 'HIGH')
                ? 'text-amber-200'
                : 'text-rose-200'
            }`}>
              {(outlookData.overallSignal === 'STRONG_BUY' || outlookData.overallSignal === 'BUY') && outlookData.overallConfidence >= 60 && outlookData.riskLevel !== 'HIGH'
                ? 'YES - TAKE TRADE'
                : outlookData.overallSignal === 'NEUTRAL' || outlookData.overallConfidence < 60 || (outlookData.overallSignal === 'BUY' && outlookData.riskLevel === 'HIGH')
                ? 'WAIT - NOT SURE'
                : 'NO - DON\'T TRADE'}
            </div>
            <div className="text-[9px] text-slate-300 mt-1">
              {(outlookData.overallSignal === 'STRONG_BUY' || outlookData.overallSignal === 'BUY') && outlookData.overallConfidence >= 60 && outlookData.riskLevel !== 'HIGH'
                ? 'Good opportunity to enter'
                : outlookData.overallSignal === 'NEUTRAL' || outlookData.overallConfidence < 60
                ? 'Not enough signals to trade'
                : (outlookData.overallSignal === 'BUY' && outlookData.riskLevel === 'HIGH')
                ? 'Too risky to trade now'
                : 'Market going down - avoid'}
            </div>
          </div>

          {/* Signal Strength - Visual bars */}
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-600/30">
            <span className="text-[10px] text-slate-400">Signal Strength:</span>
            <div className="flex items-center gap-1">
              {/* Visual strength bars instead of percentage */}
              {[1, 2, 3, 4, 5].map((bar) => (
                <div
                  key={bar}
                  className={`w-1.5 h-4 rounded-sm ${
                    bar <= Math.ceil(outlookData.overallConfidence / 20)
                      ? outlookData.overallConfidence >= 70
                        ? 'bg-emerald-400'
                        : outlookData.overallConfidence >= 50
                        ? 'bg-amber-400'
                        : 'bg-rose-400'
                      : 'bg-slate-700'
                  }`}
                />
              ))}
              <span className="text-[10px] text-slate-300 ml-1 font-bold">
                {outlookData.overallConfidence >= 80 ? 'Very Strong' :
                 outlookData.overallConfidence >= 60 ? 'Strong' :
                 outlookData.overallConfidence >= 40 ? 'Weak' :
                 'Very Weak'}
              </span>
            </div>
          </div>

          {/* Market Direction - Simple icon + text */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-400">Market Direction:</span>
            <div className="flex items-center gap-1.5">
              <span className="text-lg">
                {outlookData.overallSignal === 'STRONG_BUY' ? '🚀' :
                 outlookData.overallSignal === 'BUY' ? '📈' :
                 outlookData.overallSignal === 'STRONG_SELL' ? '🔻' :
                 outlookData.overallSignal === 'SELL' ? '📉' :
                 '➡️'}
              </span>
              <span className={`text-[11px] font-bold ${
                outlookData.overallSignal === 'STRONG_BUY' ? 'text-emerald-300' :
                outlookData.overallSignal === 'BUY' ? 'text-emerald-400' :
                outlookData.overallSignal === 'STRONG_SELL' ? 'text-rose-300' :
                outlookData.overallSignal === 'SELL' ? 'text-rose-400' :
                'text-gray-400'
              }`}>
                {outlookData.overallSignal === 'STRONG_BUY' ? 'Going Up Fast' :
                 outlookData.overallSignal === 'BUY' ? 'Going Up' :
                 outlookData.overallSignal === 'STRONG_SELL' ? 'Going Down Fast' :
                 outlookData.overallSignal === 'SELL' ? 'Going Down' :
                 'Sideways'}
              </span>
              {/* Risk emoji only - no confusing text */}
              <span className="text-base ml-1">
                {outlookData.riskLevel === 'LOW' ? '🟢' :
                 outlookData.riskLevel === 'MEDIUM' ? '🟡' :
                 '🔴'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Price */}
      <div className="mb-3 sm:mb-4">
        <div className={`text-2xl sm:text-3xl font-mono font-bold border-2 rounded-xl px-4 py-2.5 shadow-lg inline-block transition-all duration-200 ${analysis.color} ${
          analysis.color === 'text-bullish' 
            ? 'border-bullish/60 bg-bullish/10 shadow-bullish/20' 
            : analysis.color === 'text-bearish'
            ? 'border-emerald-500/60 bg-emerald-500/10 shadow-emerald-500/20'
            : 'border-accent/30 bg-accent/5'
        }`}>
          ₹{data ? MarketUtils.formatPrice(data.price) : '—'}
        </div>
      </div>

      {/* Change */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 mb-3 sm:mb-4">
        <div className={`flex items-center gap-1.5 ${analysis.color} border-2 border-green-500/40 rounded-lg px-2.5 py-1 bg-green-950/10 shadow-sm shadow-green-500/10`}>
          {getTrendIcon()}
          <span className="font-bold text-xs sm:text-sm">{data ? MarketUtils.formatChange(data.change) : '—'}</span>
        </div>
        <div className={`px-2.5 py-1 rounded-lg text-[10px] sm:text-xs font-bold ${analysis.color} border-2 border-green-500/40 bg-green-950/10 shadow-sm shadow-green-500/10`}>
          {data ? MarketUtils.formatPercent(data.changePercent) : '—'}
        </div>
      </div>

      {/* OHLC Grid */}
      <div className="grid grid-cols-2 gap-1.5 text-[10px] sm:text-xs bg-dark-surface/60 rounded-lg p-2 sm:p-2.5 border-2 border-emerald-500/20">
        <div className="flex justify-between items-center py-1 px-1.5 bg-dark-bg/30 rounded">
          <span className="text-dark-muted font-medium">Open</span>
          <span className="text-white font-semibold">{data ? MarketUtils.formatPrice(data.open) : '—'}</span>
        </div>
        <div className="flex justify-between items-center py-1 px-1.5 bg-dark-bg/30 rounded">
          <span className="text-dark-muted font-medium">High</span>
          <span className="text-bullish font-semibold">{data ? MarketUtils.formatPrice(data.high) : '—'}</span>
        </div>
        <div className="flex justify-between items-center py-1 px-1.5 bg-dark-bg/30 rounded">
          <span className="text-dark-muted font-medium">Close</span>
          <span className="text-white font-semibold">{data ? MarketUtils.formatPrice(data.close) : '—'}</span>
        </div>
        <div className="flex justify-between items-center py-1 px-1.5 bg-dark-bg/30 rounded">
          <span className="text-dark-muted font-medium">Low</span>
          <span className="text-bearish font-semibold">{data ? MarketUtils.formatPrice(data.low) : '—'}</span>
        </div>
      </div>

      {/* Trend Section */}
      <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t-2 border-emerald-500/25 space-y-2 sm:space-y-2.5">
        {/* Trend Label */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] sm:text-xs text-dark-muted font-medium">Trend</span>
          <div className={`flex items-center gap-1.5 sm:gap-2 ${analysis.color}`}>
            <span className="text-sm sm:text-base">{analysis.emoji}</span>
            <span className="font-bold text-xs sm:text-sm">{analysis.label}</span>
            <span className={`text-[9px] sm:text-[10px] px-1.5 py-0.5 rounded-lg font-semibold ${analysis.color} border-2 border-green-500/40 bg-green-950/10 shadow-sm shadow-green-500/10`}>
              {analysis.strength}%
            </span>
          </div>
        </div>

        {/* Trend Bar */}
        <div className="relative h-1.5 sm:h-2 bg-dark-border/40 rounded-full overflow-hidden">
          <div 
            className={`absolute left-0 top-0 h-full ${analysis.bg} rounded-full transition-all duration-500 shadow-sm`}
            style={{ width: `${analysis.strength}%` }}
          />
        </div>

        {/* Day Range */}
        <div className="flex items-center justify-between text-[10px] sm:text-xs">
          <span className="text-dark-muted font-medium">Range</span>
          <div className="flex items-center gap-1.5">
            <span className="text-bearish font-semibold">{data ? MarketUtils.formatPrice(data.low) : '—'}</span>
            <div className="relative w-12 sm:w-14 h-1.5 bg-dark-border/40 rounded-full">
              <div 
                className={`absolute w-2.5 h-2.5 rounded-full ${analysis.bg} -top-0.5 transition-all duration-300 shadow-sm`}
                style={{ left: `calc(${rangePos}% - 5px)` }}
              />
            </div>
            <span className="text-bullish font-semibold">{data ? MarketUtils.formatPrice(data.high) : '—'}</span>
          </div>
        </div>

        {/* From Open */}
        <div className="flex items-center justify-between text-[10px] sm:text-xs">
          <span className="text-dark-muted font-medium">From Open</span>
          <span className={`font-bold ${intradayChange >= 0 ? 'text-bullish' : 'text-bearish'}`}>
            {data ? MarketUtils.formatPercent(intradayChange) : '—'}
          </span>
        </div>
      </div>

      {/* Volume & OI */}
      <div className="mt-2 sm:mt-3 pt-2 sm:pt-3 border-t-2 border-emerald-500/25">
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-dark-surface/60 rounded-lg p-2 text-center border-2 border-emerald-500/20">
            <p className="text-[9px] sm:text-[10px] text-dark-muted font-medium">Volume</p>
            <p className="text-xs sm:text-sm text-white font-bold">
              {data?.volume && data.volume > 0 
                ? MarketUtils.formatVolume(data.volume) 
                : <span className="text-gray-500 text-[10px]">Live Ticks</span>
              }
            </p>
          </div>
          <div className="bg-dark-surface/60 rounded-lg p-2 text-center border-2 border-emerald-500/20">
            <p className="text-[9px] sm:text-[10px] text-dark-muted font-medium">Total OI</p>
            <p className="text-xs sm:text-sm text-white font-bold">{data?.oi ? MarketUtils.formatOI(data.oi) : '—'}</p>
          </div>
        </div>
      </div>

      {/* PCR Section */}
      <div className="mt-2 sm:mt-3 pt-2 sm:pt-3 border-t-2 border-emerald-500/25 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] sm:text-xs text-dark-muted font-medium">PCR {data?.pcr ? <span className="text-bullish text-[8px]">●</span> : ''}</span>
          <div className={`flex items-center gap-1.5 ${pcrAnalysis.color}`}>
            <span className="text-sm">{pcrAnalysis.emoji}</span>
            <span className={`font-extrabold text-base sm:text-lg px-2.5 py-1 rounded-lg border-2 shadow-md ${
              pcrAnalysis.sentiment === 'bullish' 
                ? 'bg-green-950/30 border-green-500/40 shadow-green-500/20' 
                : pcrAnalysis.sentiment === 'bearish'
                ? 'bg-red-950/30 border-red-500/40 shadow-red-500/20'
                : 'bg-gray-950/30 border-gray-500/40 shadow-gray-500/20'
            }`}>
              {data?.pcr?.toFixed(2) || '—'}
            </span>
          </div>
        </div>
        
        {/* PCR Bar */}
        <div className="relative h-2 bg-dark-border/40 rounded-full overflow-hidden">
          <div className="absolute inset-0 flex">
            <div className="w-1/2 bg-bearish/25" />
            <div className="w-1/2 bg-bullish/25" />
          </div>
          {data?.pcr ? (
            <div 
              className={`absolute w-2.5 h-2.5 rounded-full ${pcrAnalysis.bg} -top-[1px] transition-all duration-500 shadow-sm`}
              style={{ left: `calc(${Math.min(Math.max((data.pcr / 2) * 100, 5), 95)}% - 5px)` }}
            />
          ) : null}
        </div>
        <div className="flex justify-between text-[9px] sm:text-[10px] text-dark-muted font-medium">
          <span>Bearish</span>
          <span className="text-white/70">1.0</span>
          <span>Bullish</span>
        </div>

        {/* PCR Signal */}
        <div className="flex items-center justify-between text-[10px] sm:text-xs">
          <span className="text-dark-muted font-medium">Signal</span>
          <span className={`font-bold ${pcrAnalysis.color}`}>{pcrAnalysis.label}</span>
        </div>

        {/* Call vs Put OI */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-dark-surface/60 rounded-lg p-1.5 text-center border-2 border-emerald-500/20">
            <p className="text-[9px] sm:text-[10px] text-dark-muted font-medium">Call OI</p>
            <p className="text-[10px] sm:text-xs text-bearish font-bold">{data?.callOI ? MarketUtils.formatOI(data.callOI) : '—'}</p>
          </div>
          <div className="bg-dark-surface/60 rounded-lg p-1.5 text-center border-2 border-emerald-500/20">
            <p className="text-[9px] sm:text-[10px] text-dark-muted font-medium">Put OI</p>
            <p className="text-[10px] sm:text-xs text-bullish font-bold">{data?.putOI ? MarketUtils.formatOI(data.putOI) : '—'}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

IndexCard.displayName = 'IndexCard';

// ❌ REMOVED React.memo() - it was preventing updates
// IndexCard needs to re-render whenever parent data changes
export default IndexCard;
