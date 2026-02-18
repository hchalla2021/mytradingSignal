'use client';

import React, { memo, useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { API_CONFIG } from '@/lib/api-config';

interface VolumePulseData {
  symbol: string;
  volume_data: {
    green_candle_volume: number;
    red_candle_volume: number;
    green_percentage: number;
    red_percentage: number;
    ratio: number;
  };
  pulse_score: number;
  signal: string;
  confidence: number;
  trend: string;
  status: string;
  timestamp: string;
  candles_analyzed?: number;
}

interface VolumePulseCardProps {
  symbol: string;
  name: string;
}

const VolumePulseCard = memo<VolumePulseCardProps>(({ symbol, name }) => {
  const [data, setData] = useState<VolumePulseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(
          API_CONFIG.endpoint(`/api/advanced/volume-pulse/${symbol}`),
          { 
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json' }
          }
        );

        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const result = await response.json();
        
        if (result.status === 'ERROR' || !result.volume_data) {
          setError(result.message || 'No volume data');
          setData(null);
        } else {
          setData(result);
          setError(null);
        }
      } catch (err: unknown) {
        if ((err as Error).name === 'AbortError') {
          setError('Request timeout');
        } else {
          setError('Data unavailable');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    // 🔥 IMPROVED: Fetch every 5 seconds (was 15s) for responsive volume updates
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [symbol]);

  // Determine trading signal based on volume analysis
  const getVolumeSignal = (): { signal: string; color: string; bgColor: string; icon: JSX.Element } => {
    if (!data || !data.volume_data) {
      return { signal: 'NO DATA', color: 'text-gray-400', bgColor: 'bg-gray-900/20', icon: <Minus className="w-8 h-8" /> };
    }

    const pulseScore = data.pulse_score || 50;
    const volumeStrength = calculateVolumeStrength();
    const baseSignal = data.signal || 'NEUTRAL';
    
    // STRONG BUY: High pulse + high volume strength
    if (pulseScore >= 70 && volumeStrength >= 75 && baseSignal === 'BUY') {
      return {
        signal: 'STRONG BUY',
        color: 'text-emerald-300',
        bgColor: 'from-emerald-500/20 to-green-500/10',
        icon: <TrendingUp className="w-8 h-8" />
      };
    }
    
    // BUY: Moderate pulse + good volume
    if (pulseScore >= 55 && volumeStrength >= 50) {
      return {
        signal: 'BUY',
        color: 'text-green-300',
        bgColor: 'from-green-500/15 to-green-600/8',
        icon: <TrendingUp className="w-8 h-8" />
      };
    }
    
    // STRONG SELL: Low pulse + high volume strength
    if (pulseScore <= 30 && volumeStrength >= 75 && baseSignal === 'SELL') {
      return {
        signal: 'STRONG SELL',
        color: 'text-rose-300',
        bgColor: 'from-rose-500/20 to-red-500/10',
        icon: <TrendingDown className="w-8 h-8" />
      };
    }
    
    // SELL: Low-moderate pulse + selling pressure
    if (pulseScore <= 45 && volumeStrength >= 50) {
      return {
        signal: 'SELL',
        color: 'text-red-300',
        bgColor: 'from-red-500/15 to-red-600/8',
        icon: <TrendingDown className="w-8 h-8" />
      };
    }
    
    // SIDEWAYS/NO TRADE - Low confidence or unclear
    return {
      signal: 'SIDEWAYS',
      color: 'text-amber-300',
      bgColor: 'from-amber-500/15 to-yellow-500/8',
      icon: <Minus className="w-8 h-8" />
    };
  };

  // Calculate volume strength (realistic 40-85% range)
  const calculateVolumeStrength = (): number => {
    if (!data || !data.volume_data) return 40;
    
    const totalVolume = data.volume_data.green_candle_volume + data.volume_data.red_candle_volume;
    if (totalVolume === 0) return 40;
    
    let strength = 50;
    
    // Volume magnitude (most important)
    if (totalVolume >= 10000000) strength += 18;
    else if (totalVolume >= 5000000) strength += 14;
    else if (totalVolume >= 2000000) strength += 10;
    else if (totalVolume >= 1000000) strength += 6;
    else if (totalVolume < 100000) strength -= 20;
    
    // Pulse score strength
    const pulse = data.pulse_score || 50;
    const pulseDeviation = Math.abs(pulse - 50);
    if (pulseDeviation >= 30) strength += 12;
    else if (pulseDeviation >= 20) strength += 8;
    else if (pulseDeviation < 5) strength -= 10;
    
    // Market status
    if (data.status === 'LIVE') strength += 8;
    else if (data.status === 'CACHED') strength += 3;
    
    return Math.min(85, Math.max(40, Math.round(strength)));
  };

  // Format volume for display
  const formatVolume = (vol: number): string => {
    if (vol >= 10000000) return `${(vol / 10000000).toFixed(1)}Cr`;
    if (vol >= 100000) return `${(vol / 100000).toFixed(1)}L`;
    if (vol >= 1000) return `${(vol / 1000).toFixed(0)}K`;
    return vol.toString();
  };

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-slate-900/40 to-slate-950/20 border-2 border-slate-700/30 rounded-xl p-4 animate-pulse">
        <div className="h-28 bg-slate-800/30 rounded-lg"></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-gradient-to-br from-slate-900/40 to-slate-950/20 border-2 border-rose-500/30 rounded-xl p-4">
        <div className="text-center">
          <Minus className="w-10 h-10 mx-auto mb-2 text-rose-400/60" />
          <p className="text-base font-bold text-rose-300 mb-1">{name}</p>
          <p className="text-xs text-rose-400/80">{error || 'Data unavailable'}</p>
        </div>
      </div>
    );
  }

  const volumeSignal = getVolumeSignal();
  const volumeStrength = calculateVolumeStrength();
  const isLive = data.status === 'LIVE' || data.status === 'ACTIVE';
  const totalVolume = data.volume_data.green_candle_volume + data.volume_data.red_candle_volume;
  const isLowVolume = totalVolume < 100000;

  return (
    <div className={`bg-gradient-to-br ${volumeSignal.bgColor} border-2 rounded-xl p-3 sm:p-4 transition-all duration-300 hover:scale-[1.01] shadow-xl ${
      volumeSignal.signal.includes('BUY') ? 'border-emerald-500/40 shadow-emerald-500/10' :
      volumeSignal.signal.includes('SELL') ? 'border-rose-500/40 shadow-rose-500/10' :
      'border-amber-500/30 shadow-amber-500/10'
    }`}>
      
      {/* Index Name & Confidence Badge */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-base sm:text-lg font-bold text-white/90">{name}</h3>
          {isLive && (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500/15 rounded-full border border-emerald-500/30">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse shadow-lg shadow-emerald-400/50"></span>
              <span className="text-[10px] font-bold text-emerald-300">LIVE</span>
            </div>
          )}
        </div>
        <div className={`text-center px-2.5 py-1 rounded-lg border-2 bg-black/30 ${
          volumeStrength >= 75 ? 'border-emerald-500/40' :
          volumeStrength >= 60 ? 'border-green-500/40' :
          volumeStrength >= 50 ? 'border-amber-500/40' :
          'border-rose-500/40'
        }`}>
          <div className="text-[10px] font-semibold text-white/60">Confidence</div>
          <div className="text-base font-bold text-white">{volumeStrength}%</div>
        </div>
      </div>

      {/* Low Volume Warning */}
      {totalVolume > 0 && isLowVolume && (
        <div className="mb-2 px-2 py-1 rounded-lg bg-amber-900/30 text-amber-200 border border-amber-500/40 text-[10px] font-semibold flex items-center gap-1.5">
          ⚠️ Low Volume ({formatVolume(totalVolume)}) - Wait for higher activity
        </div>
      )}

      {/* Main Volume Signal - Clear & Readable */}
      <div className="mb-3 text-center py-3 px-3 bg-black/20 rounded-xl border border-white/10">
        <div className="flex items-center justify-center mb-2">
          <div className={`${volumeSignal.color} drop-shadow-[0_0_10px_currentColor]`}>
            {volumeSignal.icon}
          </div>
        </div>
        <h2 className={`text-xl sm:text-2xl font-bold ${volumeSignal.color} mb-1 tracking-tight`}>
          {volumeSignal.signal}
        </h2>
        <p className="text-[10px] sm:text-xs text-white/60 font-medium">
          {volumeSignal.signal.includes('BUY') && '📈 Strong buying volume detected'}
          {volumeSignal.signal.includes('SELL') && '📉 Strong selling volume detected'}
          {volumeSignal.signal === 'SIDEWAYS' && '⚠️ Balanced volume - No clear direction'}
        </p>
      </div>

      {/* Volume Strength Meter */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-bold text-white/80">Volume Strength</span>
          <span className={`text-lg font-bold ${
            volumeStrength >= 75 ? 'text-emerald-300' :
            volumeStrength >= 60 ? 'text-green-300' :
            volumeStrength >= 50 ? 'text-amber-300' :
            'text-rose-300'
          }`}>{volumeStrength}%</span>
        </div>
        <div className="relative w-full h-3 bg-black/30 rounded-full overflow-hidden border border-white/10">
          <div
            className={`absolute inset-y-0 left-0 transition-all duration-700 rounded-full ${
              volumeStrength >= 75 ? 'bg-gradient-to-r from-emerald-500 to-green-400 shadow-lg shadow-emerald-500/50' :
              volumeStrength >= 60 ? 'bg-gradient-to-r from-green-500 to-green-400 shadow-lg shadow-green-500/40' :
              volumeStrength >= 50 ? 'bg-gradient-to-r from-amber-500 to-yellow-400 shadow-lg shadow-amber-500/40' :
              'bg-gradient-to-r from-rose-500 to-red-400 shadow-lg shadow-rose-500/40'
            }`}
            style={{ width: `${volumeStrength}%` }}
          ></div>
        </div>
        <div className="flex justify-between mt-1 text-[9px] font-semibold text-white/40">
          <span>Weak</span>
          <span>Moderate</span>
          <span>Strong</span>
        </div>
      </div>

      {/* Buying vs Selling Pressure */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-bold text-white/80">Buying Pressure</span>
          <span className={`text-lg font-bold ${
            data.pulse_score >= 65 ? 'text-emerald-300' :
            data.pulse_score >= 50 ? 'text-green-300' :
            data.pulse_score >= 35 ? 'text-amber-300' :
            'text-rose-300'
          }`}>{data.pulse_score}%</span>
        </div>
        <div className="relative w-full h-3 bg-gradient-to-r from-rose-900/40 via-gray-700/50 to-emerald-900/40 rounded-full overflow-hidden border border-white/10">
          <div
            className="absolute inset-y-0 left-0 h-full bg-gradient-to-r from-emerald-500 to-green-400 shadow-lg shadow-emerald-500/50 transition-all duration-700"
            style={{ width: `${data.pulse_score}%` }}
          ></div>
        </div>
        <div className="flex justify-between mt-1 text-[9px] font-semibold text-white/40">
          <span>🔴 Selling</span>
          <span>Neutral</span>
          <span>🟢 Buying</span>
        </div>
      </div>

      {/* Volume Breakdown - Compact */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-emerald-500/10 rounded-lg p-2 border border-emerald-500/30">
          <p className="text-[9px] text-emerald-200 font-bold mb-0.5">BUY VOLUME</p>
          <p className="text-sm font-bold text-emerald-300">{formatVolume(data.volume_data.green_candle_volume)}</p>
          <p className="text-[9px] text-emerald-300/70">{data.volume_data.green_percentage.toFixed(0)}%</p>
        </div>
        <div className="bg-rose-500/10 rounded-lg p-2 border border-rose-500/30">
          <p className="text-[9px] text-rose-200 font-bold mb-0.5">SELL VOLUME</p>
          <p className="text-sm font-bold text-rose-300">{formatVolume(data.volume_data.red_candle_volume)}</p>
          <p className="text-[9px] text-rose-300/70">{data.volume_data.red_percentage.toFixed(0)}%</p>
        </div>
      </div>

      {/* Quick Explanation */}
      <div className={`p-2.5 rounded-lg border ${
        volumeSignal.signal.includes('STRONG BUY') ? 'bg-emerald-500/10 border-emerald-500/30' :
        volumeSignal.signal === 'BUY' ? 'bg-green-500/10 border-green-500/30' :
        volumeSignal.signal.includes('STRONG SELL') ? 'bg-rose-500/10 border-rose-500/30' :
        volumeSignal.signal === 'SELL' ? 'bg-red-500/10 border-red-500/30' :
        'bg-amber-500/10 border-amber-500/30'
      }`}>
        <p className="text-xs leading-relaxed text-white/90 font-medium">
          {volumeSignal.signal === 'STRONG BUY' && (
            <span>✅ <strong className="text-emerald-300">Very strong buying</strong> - Green candles have much higher volume. Buyers dominating.</span>
          )}
          {volumeSignal.signal === 'BUY' && (
            <span>✅ <strong className="text-green-300">Good buying activity</strong> - More volume on green candles. Buyers active.</span>
          )}
          {volumeSignal.signal === 'STRONG SELL' && (
            <span>⚠️ <strong className="text-rose-300">Very strong selling</strong> - Red candles have much higher volume. Sellers dominating.</span>
          )}
          {volumeSignal.signal === 'SELL' && (
            <span>⚠️ <strong className="text-red-300">Selling pressure</strong> - More volume on red candles. Be cautious.</span>
          )}
          {volumeSignal.signal === 'SIDEWAYS' && (
            <span>⏸️ <strong className="text-amber-300">Balanced volume</strong> - No clear winner. Wait for trend confirmation.</span>
          )}
        </p>
      </div>

      {/* Footer Info */}
      <div className="mt-3 pt-2 border-t border-white/10 flex items-center justify-between text-[10px]">
        <span className="text-white/50 font-medium">
          {isLive ? '📡 Live' : '📊 Cached'}
        </span>
        <span className="text-white/50 font-medium">
          {data.candles_analyzed && `${data.candles_analyzed} candles`}
        </span>
      </div>
    </div>
  );
});

VolumePulseCard.displayName = 'VolumePulseCard';


export default VolumePulseCard;
