'use client';

import React, { memo, useEffect, useState } from 'react';
import { Activity, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';

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
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
        const response = await fetch(`${apiUrl}/api/advanced/volume-pulse/${symbol}`);
        if (!response.ok) throw new Error('Failed to fetch');
        const result = await response.json();
        setData(result);
        setError(null);
      } catch (err) {
        setError('Data unavailable');
        console.error(`[VOLUME-PULSE] Error fetching ${symbol}:`, err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const refreshInterval = parseInt(process.env.NEXT_PUBLIC_REFRESH_INTERVAL || '5000', 10);
    const interval = setInterval(fetchData, refreshInterval);

    return () => clearInterval(interval);
  }, [symbol]);

  const getSignalColor = (signal: string) => {
    if (signal === 'BUY') return 'text-bullish';
    if (signal === 'SELL') return 'text-bearish';
    return 'text-neutral';
  };

  const getSignalBg = (signal: string) => {
    if (signal === 'BUY') return 'bg-bullish/10';
    if (signal === 'SELL') return 'bg-bearish/10';
    return 'bg-neutral/10';
  };

  const getSignalIcon = (signal: string) => {
    if (signal === 'BUY') return <TrendingUp className="w-4 h-4" />;
    if (signal === 'SELL') return <TrendingDown className="w-4 h-4" />;
    return <Activity className="w-4 h-4" />;
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return 'text-emerald-400 bg-emerald-950/30 border-emerald-500/50';
    if (confidence >= 60) return 'text-green-400 bg-green-950/30 border-green-500/40';
    if (confidence >= 40) return 'text-yellow-400 bg-yellow-950/30 border-yellow-500/40';
    if (confidence >= 20) return 'text-orange-400 bg-orange-950/30 border-orange-500/40';
    return 'text-red-400 bg-red-950/30 border-red-500/40';
  };

  const getSignalColorEnhanced = (signal: string) => {
    const upperSignal = signal.toUpperCase();
    // EXTREME BUY - Brightest Green
    if (upperSignal.includes('EXTREME') && (upperSignal.includes('BUY') || upperSignal.includes('BULLISH'))) {
      return 'bg-green-900/40 text-green-300 border-green-400/70 shadow-lg shadow-green-500/20';
    }
    // STRONG BUY - Strong Green
    if (upperSignal.includes('STRONG') && (upperSignal.includes('BUY') || upperSignal.includes('BULLISH'))) {
      return 'bg-emerald-950/35 text-emerald-300 border-emerald-500/60';
    }
    // BUY - Standard Green
    if (upperSignal.includes('BUY') || upperSignal === 'BULLISH') {
      return 'bg-emerald-950/30 text-emerald-400 border-emerald-500/50';
    }
    // EXTREME SELL - Brightest Red
    if (upperSignal.includes('EXTREME') && (upperSignal.includes('SELL') || upperSignal.includes('BEARISH'))) {
      return 'bg-red-900/40 text-red-300 border-red-400/70 shadow-lg shadow-red-500/20';
    }
    // STRONG SELL - Strong Red
    if (upperSignal.includes('STRONG') && (upperSignal.includes('SELL') || upperSignal.includes('BEARISH'))) {
      return 'bg-rose-950/35 text-rose-300 border-rose-500/60';
    }
    // SELL - Standard Red
    if (upperSignal.includes('SELL') || upperSignal === 'BEARISH') {
      return 'bg-rose-950/30 text-rose-400 border-rose-500/50';
    }
    // NEUTRAL/WAIT - Gray
    if (upperSignal === 'NEUTRAL' || upperSignal === 'WAIT' || upperSignal === 'NO_TRADE') {
      return 'bg-gray-950/30 text-gray-400 border-gray-500/40';
    }
    // Other - Amber
    return 'bg-amber-950/30 text-amber-400 border-amber-500/40';
  };

  const formatVolume = (vol: number): string => {
    if (vol >= 10000000) return `${(vol / 10000000).toFixed(2)} Cr`;
    if (vol >= 100000) return `${(vol / 100000).toFixed(2)} L`;
    if (vol >= 1000) return `${(vol / 1000).toFixed(1)} K`;
    return vol.toString();
  };

  if (loading) {
    return (
      <div className="bg-dark-card border border-dark-border rounded-lg p-3 sm:p-4 animate-pulse">
        <div className="h-24 bg-dark-border rounded"></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-dark-card border border-dark-border rounded-lg p-3 sm:p-4">
        <div className="flex items-center gap-2 text-dark-muted text-sm">
          <AlertTriangle className="w-4 h-4" />
          <span>{name} - {error}</span>
        </div>
      </div>
    );
  }

  const { volume_data, pulse_score, signal, confidence, trend } = data;

  return (
    <div className="bg-dark-card border border-dark-border rounded-lg p-3 sm:p-4 hover:border-dark-muted/50 transition-all">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-accent" />
          <h3 className="text-sm sm:text-base font-bold text-white">{name}</h3>
        </div>
        <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-bold ${getSignalBg(signal)} ${getSignalColor(signal)}`}>
          {getSignalIcon(signal)}
          <span>{signal}</span>
        </div>
      </div>

      {/* Pulse Score - Main Metric */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-dark-muted font-bold">PULSE SCORE</span>
          <span className="text-sm font-bold text-white">{pulse_score}%</span>
        </div>
        <div className="w-full bg-dark-border rounded-full h-2 overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${
              pulse_score >= 70 ? 'bg-bullish' : pulse_score >= 50 ? 'bg-accent' : 'bg-bearish'
            }`}
            style={{ width: `${pulse_score}%` }}
          ></div>
        </div>
        <div className="flex justify-between text-[10px] text-dark-muted font-semibold mt-1">
          <span>Bearish</span>
          <span>Neutral</span>
          <span>Bullish</span>
        </div>
      </div>

      {/* Volume Breakdown */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        {/* Green Candle Volume */}
        <div className="bg-dark-bg rounded-lg p-2 border-2 border-emerald-500/30 shadow-sm shadow-emerald-500/10">
          <p className="text-[9px] sm:text-[10px] text-dark-muted font-bold mb-1">🟢 GREEN VOL</p>
          <p className="text-xs sm:text-sm font-bold text-green-400 px-2 py-1 rounded-lg bg-green-950/30 border-2 border-green-500/40 shadow-md shadow-green-500/20 inline-block">
            {formatVolume(volume_data.green_candle_volume)}
          </p>
          <p className="text-[9px] text-dark-muted mt-1">{volume_data.green_percentage.toFixed(1)}%</p>
        </div>

        {/* Red Candle Volume */}
        <div className="bg-dark-bg rounded-lg p-2 border-2 border-emerald-500/30 shadow-sm shadow-emerald-500/10">
          <p className="text-[9px] sm:text-[10px] text-dark-muted font-bold mb-1">🔴 RED VOL</p>
          <p className="text-xs sm:text-sm font-bold text-red-400 px-2 py-1 rounded-lg bg-red-950/30 border-2 border-red-500/40 shadow-md shadow-red-500/20 inline-block">
            {formatVolume(volume_data.red_candle_volume)}
          </p>
          <p className="text-[9px] text-dark-muted mt-1">{volume_data.red_percentage.toFixed(1)}%</p>
        </div>
      </div>

      {/* Bottom Stats */}
      <div className="flex items-center justify-between pt-2 border-t border-dark-border">
        <div>
          <p className="text-[9px] text-dark-muted font-bold">RATIO</p>
          <p className="text-xs font-bold text-white">{volume_data.ratio.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-[9px] text-dark-muted font-bold">CONFIDENCE</p>
          <p className="text-xs font-bold text-accent">{confidence}%</p>
        </div>
        <div>
          <p className="text-[9px] text-dark-muted font-bold">TREND</p>
          <p className={`text-xs font-bold ${
            trend === 'BULLISH' ? 'text-bullish' : trend === 'BEARISH' ? 'text-bearish' : 'text-neutral'
          }`}>
            {trend}
          </p>
        </div>
      </div>
    </div>
  );
});

VolumePulseCard.displayName = 'VolumePulseCard';

export default VolumePulseCard;
