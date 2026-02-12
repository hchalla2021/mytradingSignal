'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { MarketTick } from '@/hooks/useMarketSocket';

interface CandleQualityProps {
  symbol: string;
  name: string;
  data: MarketTick | null;
  analysis: any;
}

interface CandleMetrics {
  candleBody: {
    open: number;
    close: number;
    high: number;
    low: number;
    range: number;
    bodySize: number;
    bodyPercent: number;
    direction: 'BULLISH' | 'BEARISH' | 'DOJI';
  };
  volumeQuality: {
    currentVolume: number;
    last5Average: number;
    volumeRatio: number;
    meetsMinimum: boolean;
    meetsRatioThreshold: boolean;
    isFakeSpike: boolean;
  };
  candleStrength: {
    isVeryGoodVolume: boolean;
    bodyStrength: number;
    volumeStrength: number;
    closingQuality: number;
    overallQuality: number;
  };
  signals: {
    type: 'STRONG_BUY' | 'STRONG_SELL' | 'WEAK_BUY' | 'WEAK_SELL' | 'FAKE_SPIKE' | 'DOJI';
    confidence: number;
    description: string;
  }[];
  warnings: string[];
}

function analyzeCandleQuality(data: MarketTick | null, analysis: any): CandleMetrics {
  if (!data) {
    return {
      candleBody: { open: 0, close: 0, high: 0, low: 0, range: 0, bodySize: 0, bodyPercent: 0, direction: 'DOJI' },
      volumeQuality: { currentVolume: 0, last5Average: 0, volumeRatio: 0, meetsMinimum: false, meetsRatioThreshold: false, isFakeSpike: false },
      candleStrength: { isVeryGoodVolume: false, bodyStrength: 0, volumeStrength: 0, closingQuality: 0, overallQuality: 0 },
      signals: [],
      warnings: [],
    };
  }

  const open = data.open || data.price || 0;
  const close = data.price || data.close || 0;
  const high = data.high || 0;
  const low = data.low || 0;
  const range = high - low;

  const bodySize = Math.abs(close - open);
  const bodyPercent = range > 0 ? (bodySize / range) * 100 : 0;
  
  const direction: 'BULLISH' | 'BEARISH' | 'DOJI' = 
    close > open ? 'BULLISH' : close < open ? 'BEARISH' : 'DOJI';

  let closingQuality = 0;
  if (range > 0) {
    if (direction === 'BULLISH') {
      closingQuality = ((close - low) / range) * 100;
    } else if (direction === 'BEARISH') {
      closingQuality = ((high - close) / range) * 100;
    } else {
      closingQuality = 50;
    }
  }

  const currentVolume = data.volume || 0;
  const last5Average = analysis?.volume?.last_5_avg || (currentVolume * 0.78);
  const volumeRatio = last5Average > 0 ? currentVolume / last5Average : 1;

  const meetsMinimum = currentVolume > 50000;
  const meetsRatioThreshold = volumeRatio > 1.8;
  const meetsBodyStrength = bodyPercent > 60;

  const isVeryGoodVolume = meetsMinimum && meetsRatioThreshold && meetsBodyStrength;
  const isFakeSpike = currentVolume > (last5Average * 2.5) && bodyPercent < 40;

  let bodyStrength = Math.min(100, bodyPercent);

  let volumeStrength = 0;
  if (volumeRatio >= 2.0) {
    volumeStrength = Math.min(100, 70 + Math.abs(volumeRatio - 2.0) * 15);
  } else if (volumeRatio >= 1.8) {
    volumeStrength = 75;
  } else if (volumeRatio >= 1.5) {
    volumeStrength = 60;
  } else if (volumeRatio >= 1.0) {
    volumeStrength = 45;
  } else {
    volumeStrength = 20;
  }

  const overallQuality = (bodyStrength * 0.35 + volumeStrength * 0.35 + closingQuality * 0.30);

  const signals: any[] = [];

  if (isVeryGoodVolume) {
    if (direction === 'BULLISH') {
      signals.push({
        type: 'STRONG_BUY',
        confidence: Math.min(98, overallQuality + 15),
        description: '✅ VERY GOOD VOLUME - Strong bullish conviction detected'
      });
    } else if (direction === 'BEARISH') {
      signals.push({
        type: 'STRONG_SELL',
        confidence: Math.min(98, overallQuality + 15),
        description: '✅ VERY GOOD VOLUME - Strong bearish conviction detected'
      });
    }
  } else if (isFakeSpike) {
    signals.push({
      type: 'FAKE_SPIKE',
      confidence: 85,
      description: '🚨 FAKE SPIKE - High volume but weak body (no conviction)'
    });
  } else if (bodyPercent > 60) {
    if (direction === 'BULLISH') {
      signals.push({
        type: 'WEAK_BUY',
        confidence: Math.min(75, bodyStrength),
        description: '📈 Weak bullish - Strong body but low volume'
      });
    } else if (direction === 'BEARISH') {
      signals.push({
        type: 'WEAK_SELL',
        confidence: Math.min(75, bodyStrength),
        description: '📉 Weak bearish - Strong body but low volume'
      });
    }
  } else if (direction === 'DOJI') {
    signals.push({
      type: 'DOJI',
      confidence: 50,
      description: '⚖️ Indecision - DOJI candle (no body)'
    });
  }

  const warnings: string[] = [];

  if (isFakeSpike) {
    warnings.push('⚠️ VOLUME TRAP: High volume spike without strong body closing');
  }
  if (bodyPercent < 20 && currentVolume > last5Average * 2) {
    warnings.push('⚠️ WEAK CLOSE: Volume spike but candle closing in middle (indecision)');
  }
  if (volumeRatio > 3 && bodyPercent < 50) {
    warnings.push('🚨 EXTREME VOLUME WITH WEAK BODY: Likely liquidation or wick spike');
  }
  if (meetsMinimum && !meetsRatioThreshold && bodyPercent > 60) {
    warnings.push('📊 LOW PARTICIPATION: Good candle body but only 50k volume');
  }

  return {
    candleBody: { open, close, high, low, range, bodySize, bodyPercent, direction },
    volumeQuality: { currentVolume, last5Average, volumeRatio, meetsMinimum, meetsRatioThreshold, isFakeSpike },
    candleStrength: { isVeryGoodVolume, bodyStrength, volumeStrength, closingQuality, overallQuality },
    signals,
    warnings,
  };
}

const QUALITY_COLORS = {
  STRONG_BUY: { bg: 'bg-emerald-900/20', border: 'border-emerald-500/40', text: 'text-emerald-400', badge: 'bg-emerald-500/20' },
  STRONG_SELL: { bg: 'bg-rose-900/20', border: 'border-rose-500/40', text: 'text-rose-400', badge: 'bg-rose-500/20' },
  WEAK_BUY: { bg: 'bg-blue-900/20', border: 'border-blue-500/40', text: 'text-blue-400', badge: 'bg-blue-500/20' },
  WEAK_SELL: { bg: 'bg-orange-900/20', border: 'border-orange-500/40', text: 'text-orange-400', badge: 'bg-orange-500/20' },
  FAKE_SPIKE: { bg: 'bg-red-900/20', border: 'border-red-500/40', text: 'text-red-400', badge: 'bg-red-500/20' },
  DOJI: { bg: 'bg-slate-900/20', border: 'border-slate-500/40', text: 'text-slate-400', badge: 'bg-slate-500/20' },
};

function getQualityColor(signalType: string) {
  return QUALITY_COLORS[signalType as keyof typeof QUALITY_COLORS] || QUALITY_COLORS.DOJI;
}

const CandleQualityAnalysis = ({ symbol, name, data, analysis }: CandleQualityProps) => {
  const [cachedData, setCachedData] = useState<MarketTick | null>(null);
  const [cacheLoaded, setCacheLoaded] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      setCacheLoaded(true);
      return;
    }

    try {
      const saved = localStorage.getItem('lastMarketData');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed[symbol]) {
          setCachedData(parsed[symbol]);
        }
      }
    } catch (e) {
      console.error(`[${symbol}] Candle cache error:`, e);
    } finally {
      setCacheLoaded(true);
    }
  }, [symbol]);

  const displayData = data || cachedData;
  const isLive = !!data;
  const hasData = !!displayData;

  const metrics = useMemo(() => analyzeCandleQuality(displayData, analysis), [displayData, analysis]);

  if (!cacheLoaded) {
    return (
      <div className="border-2 border-blue-600/30 rounded-xl p-4 bg-blue-900/20 text-blue-200 text-sm animate-pulse">
        <div className="flex items-center gap-2">
          <span className="text-xl">⏳</span>
          <span className="font-bold">Loading candle data for {symbol}...</span>
        </div>
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="border-2 border-blue-600/30 rounded-xl p-4 bg-blue-900/20 text-blue-200 text-sm">
        <div className="flex items-center justify-center py-8">
          <div className="text-center">
            <div className="text-3xl mb-2">🕯️</div>
            <div className="text-xs text-dark-tertiary">Waiting for data...</div>
          </div>
        </div>
      </div>
    );
  }

  const signalType = metrics.signals[0]?.type || 'DOJI';
  const signalColor = getQualityColor(signalType);
  const mainSignal = metrics.signals[0];

  return (
    <div className={`border-2 ${signalColor.border} rounded-xl p-4 transition-all duration-300 ${signalColor.bg} backdrop-blur-sm`}>
      <h4 className="font-bold text-dark-text text-lg mb-4 flex items-center gap-2 flex-wrap">
        <span className="text-2xl">🕯️</span>
        {name} • Candle Quality
        {isLive && <span className="text-[10px] px-2 py-1 rounded-full bg-green-500/20 text-green-400 border border-green-500/30">🟢 LIVE</span>}
        {!isLive && <span className="text-[10px] px-2 py-1 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">📋 CACHED</span>}
        <span className={`text-xs font-bold px-2 py-1 rounded-full ml-auto border ${signalColor.badge} ${signalColor.text}`}>
          {metrics.candleBody.direction}
        </span>
      </h4>

      <div className="space-y-4">
        {mainSignal && (
          <div className={`p-3 rounded-lg border-l-4 ${
            signalType === 'STRONG_BUY' ? 'bg-emerald-900/40 border-emerald-500 text-emerald-400' :
            signalType === 'STRONG_SELL' ? 'bg-rose-900/40 border-rose-500 text-rose-400' :
            signalType === 'WEAK_BUY' ? 'bg-blue-900/40 border-blue-500 text-blue-400' :
            signalType === 'WEAK_SELL' ? 'bg-orange-900/40 border-orange-500 text-orange-400' :
            signalType === 'FAKE_SPIKE' ? 'bg-red-900/40 border-red-500 text-red-400' :
            'bg-slate-900/40 border-slate-500 text-slate-400'
          }`}>
            <div className="font-bold text-sm mb-1">{mainSignal.description}</div>
            <div className="flex items-center justify-between text-xs">
              <span>Signal Confidence</span>
              <span className="font-bold">{mainSignal.confidence.toFixed(0)}%</span>
            </div>
            <div className="h-2 bg-gray-700 rounded-full mt-2 overflow-hidden">
              <div
                className={`h-full transition-all ${
                  signalType === 'STRONG_BUY' ? 'bg-emerald-500' :
                  signalType === 'STRONG_SELL' ? 'bg-rose-500' :
                  signalType === 'WEAK_BUY' ? 'bg-blue-500' :
                  signalType === 'WEAK_SELL' ? 'bg-orange-500' :
                  signalType === 'FAKE_SPIKE' ? 'bg-red-500' :
                  'bg-slate-500'
                }`}
                style={{ width: `${mainSignal.confidence}%` }}
              />
            </div>
          </div>
        )}

        <div className="bg-emerald-950/20 rounded-lg border border-emerald-500/30 p-3">
          <div className="text-xs text-dark-secondary font-bold mb-3 uppercase tracking-wider">Candle Body Strength</div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="text-center">
              <div className="text-xs text-dark-tertiary mb-1">Open</div>
              <div className="font-bold text-dark-text text-sm">{metrics.candleBody.open.toFixed(2)}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-dark-tertiary mb-1">Close</div>
              <div className={`font-bold text-sm ${metrics.candleBody.direction === 'BULLISH' ? 'text-green-400' : metrics.candleBody.direction === 'BEARISH' ? 'text-red-400' : 'text-slate-400'}`}>
                {metrics.candleBody.close.toFixed(2)}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-dark-tertiary mb-1">Range</div>
              <div className="font-bold text-dark-text text-sm">{metrics.candleBody.range.toFixed(2)}</div>
            </div>
          </div>
          <div className="mb-3">
            <div className="flex justify-between items-baseline mb-2">
              <span className="text-sm font-bold text-dark-text">Body Strength</span>
              <span className={`text-xs font-bold ${
                metrics.candleBody.bodyPercent > 60 ? 'text-green-400' :
                metrics.candleBody.bodyPercent > 40 ? 'text-yellow-400' :
                'text-slate-400'
              }`}>
                {metrics.candleBody.bodyPercent.toFixed(1)}% {metrics.candleBody.bodyPercent > 60 ? '✅ STRONG' : metrics.candleBody.bodyPercent > 40 ? '⚠️ MODERATE' : '❌ WEAK'}
              </span>
            </div>
            <div className="h-3 bg-dark-secondary/30 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  metrics.candleBody.bodyPercent > 60 ? 'bg-green-500' :
                  metrics.candleBody.bodyPercent > 40 ? 'bg-yellow-500' :
                  'bg-red-500'
                }`}
                style={{ width: `${Math.min(metrics.candleBody.bodyPercent, 100)}%` }}
              />
            </div>
            <div className="text-[10px] text-dark-tertiary mt-1">
              Body size: {metrics.candleBody.bodySize.toFixed(2)} pts
            </div>
          </div>
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-dark-secondary">Close Position</span>
              <span className="text-xs font-bold text-dark-text">{metrics.candleStrength.closingQuality.toFixed(0)}%</span>
            </div>
            <div className="h-2 bg-dark-secondary/30 rounded-full overflow-hidden">
              <div
                className="bg-gradient-to-r from-purple-500 to-pink-500 h-full transition-all"
                style={{ width: `${metrics.candleStrength.closingQuality}%` }}
              />
            </div>
            <div className="text-[10px] text-dark-tertiary mt-1">
              {metrics.candleStrength.closingQuality > 80 ? '💪 Excellent close' :
               metrics.candleStrength.closingQuality > 60 ? '✅ Good close' :
               metrics.candleStrength.closingQuality > 40 ? '➡️ Neutral close' :
               '⚠️ Weak close'}
            </div>
          </div>
        </div>

        <div className="bg-emerald-950/20 rounded-lg border border-emerald-500/30 p-3">
          <div className="text-xs text-dark-secondary font-bold mb-3 uppercase tracking-wider">Volume Quality Check</div>
          <div className="mb-3 pb-3 border-b border-emerald-500/20">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-dark-secondary">Condition 1: Min Volume</span>
              <span className={`text-xs font-bold px-2 py-1 rounded ${
                metrics.volumeQuality.meetsMinimum ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
              }`}>
                {metrics.volumeQuality.currentVolume > 50000 ? '✅' : '❌'} {metrics.volumeQuality.currentVolume.toFixed(0)} vol
              </span>
            </div>
            <div className="text-[10px] text-dark-tertiary">
              {metrics.volumeQuality.currentVolume > 50000 
                ? `✅ PASS: ${metrics.volumeQuality.currentVolume.toFixed(0)} &#62; 50,000` 
                : `❌ FAIL: ${metrics.volumeQuality.currentVolume.toFixed(0)} &#60; 50,000`}
            </div>
          </div>
          <div className="mb-3 pb-3 border-b border-emerald-500/20">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-dark-secondary">Condition 2: Volume Ratio</span>
              <span className={`text-xs font-bold px-2 py-1 rounded ${
                metrics.volumeQuality.meetsRatioThreshold ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
              }`}>
                {metrics.volumeQuality.volumeRatio.toFixed(2)}x
              </span>
            </div>
            <div className="flex justify-between text-[10px] text-dark-tertiary mb-2">
              <span>Current vs 5-candle avg</span>
              <span className="font-bold">{metrics.volumeQuality.meetsRatioThreshold ? '✅' : '⚠️'} {metrics.volumeQuality.volumeRatio > 1.8 ? 'PASS' : 'FAIL'}</span>
            </div>
            <div className="h-2 bg-dark-secondary/30 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${metrics.volumeQuality.meetsRatioThreshold ? 'bg-green-500' : 'bg-yellow-500'}`}
                style={{ width: `${Math.min((metrics.volumeQuality.volumeRatio / 3) * 100, 100)}%` }}
              />
            </div>
            <div className="text-[10px] text-dark-tertiary mt-1">
              Need: 1.8x | Have: {metrics.volumeQuality.volumeRatio.toFixed(2)}x | Avg: {metrics.volumeQuality.last5Average.toFixed(0)}
            </div>
          </div>
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-dark-secondary">Condition 3: Body {String.fromCharCode(62)} 60%</span>
              <span className={`text-xs font-bold px-2 py-1 rounded ${
                metrics.candleBody.bodyPercent > 60 ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
              }`}>
                {metrics.candleBody.bodyPercent > 60 ? '✅' : '❌'} {metrics.candleBody.bodyPercent.toFixed(1)}%
              </span>
            </div>
            <div className="text-[10px] text-dark-tertiary">
              {metrics.candleBody.bodyPercent > 60 
                ? `✅ PASS: ${metrics.candleBody.bodyPercent.toFixed(1)}% &#62; 60%` 
                : `❌ FAIL: ${metrics.candleBody.bodyPercent.toFixed(1)}% &#60; 60%`}
            </div>
          </div>
        </div>

        <div className={`p-3 rounded-lg border-2 ${
          metrics.candleStrength.isVeryGoodVolume
            ? 'border-emerald-500/40 bg-emerald-900/30'
            : metrics.candleStrength.overallQuality > 70
            ? 'border-yellow-500/40 bg-yellow-900/30'
            : 'border-slate-500/40 bg-slate-900/30'
        }`}>
          <div className="flex justify-between items-center mb-3">
            <div className="text-xs text-dark-secondary font-bold">Quality Score</div>
            <div className={`text-xl font-bold ${
              metrics.candleStrength.isVeryGoodVolume ? 'text-emerald-400' :
              metrics.candleStrength.overallQuality > 70 ? 'text-yellow-400' :
              'text-slate-400'
            }`}>
              {metrics.candleStrength.overallQuality.toFixed(0)}/100
            </div>
          </div>
          <div className="space-y-2">
            <div>
              <div className="flex justify-between text-[10px] mb-1">
                <span className="text-dark-tertiary">Body Strength</span>
                <span className="font-bold text-dark-text">{metrics.candleStrength.bodyStrength.toFixed(0)}%</span>
              </div>
              <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div className="bg-blue-500 h-full" style={{ width: `${metrics.candleStrength.bodyStrength}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-[10px] mb-1">
                <span className="text-dark-tertiary">Volume Strength</span>
                <span className="font-bold text-dark-text">{metrics.candleStrength.volumeStrength.toFixed(0)}%</span>
              </div>
              <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div className="bg-purple-500 h-full" style={{ width: `${metrics.candleStrength.volumeStrength}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-[10px] mb-1">
                <span className="text-dark-tertiary">Closing Quality</span>
                <span className="font-bold text-dark-text">{metrics.candleStrength.closingQuality.toFixed(0)}%</span>
              </div>
              <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div className="bg-pink-500 h-full" style={{ width: `${metrics.candleStrength.closingQuality}%` }} />
              </div>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-emerald-500/20">
            <div className={`text-xs font-bold text-center py-2 rounded px-2 ${
              metrics.candleStrength.isVeryGoodVolume
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-slate-500/20 text-slate-300'
            }`}>
              {metrics.candleStrength.isVeryGoodVolume 
                ? '✅ VERY GOOD VOLUME - All conditions met!' 
                : `⚠️ ${3 - ([
                    metrics.volumeQuality.meetsMinimum,
                    metrics.volumeQuality.meetsRatioThreshold,
                    metrics.candleBody.bodyPercent > 60
                  ].filter(Boolean).length)} conditions missing`}
            </div>
          </div>
        </div>

        {metrics.warnings.length > 0 && (
          <div className="border-t border-emerald-500/30 pt-3">
            <div className="text-xs text-dark-secondary font-bold mb-2 uppercase">⚠️ Warnings</div>
            <div className="space-y-1.5">
              {metrics.warnings.map((warning, i) => (
                <div
                  key={i}
                  className="text-xs p-2 rounded bg-red-900/20 border border-red-500/30 text-red-300 leading-relaxed"
                >
                  {warning}
                </div>
              ))}
            </div>
          </div>
        )}

        {metrics.signals.length > 1 && (
          <div className="border-t border-emerald-500/30 pt-3">
            <div className="text-xs text-dark-secondary font-bold mb-2 uppercase">Additional Signals</div>
            <div className="space-y-1.5">
              {metrics.signals.slice(1).map((signal, i) => (
                <div
                  key={i}
                  className="text-xs p-2 rounded bg-emerald-950/20 border border-emerald-500/25 text-dark-text leading-relaxed"
                >
                  {signal.description}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CandleQualityAnalysis;
