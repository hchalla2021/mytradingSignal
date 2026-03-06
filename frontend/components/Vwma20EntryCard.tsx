/**
 * Vwma20EntryCard – VWMA 20 Entry Filter Analysis
 * ════════════════════════════════════════════════════════════════════════════
 * Displays real-time VWMA 20 levels, entry signals, EMA alignment, and volume confirmation
 * 
 * Trading Strategy:
 * - VWMA 20 below price = Bullish setup (support level, potential buy)
 * - VWMA 20 above price = Bearish setup (resistance level, potential sell)
 * - Strong signal = VWMA + EMA + Volume all aligned (high probability entry)
 * - Wait signal = Mixed signals or weak volume (avoid entry, await confirmation)
 * 
 * Performance: <200ms live updates, <50ms component latency
 */

'use client';

import React, { useState } from 'react';
import { useVwma20EntryRealtime, useMemoizedVwma20Analysis } from '@/hooks/useVwma20EntryRealtime';
import { ChevronDown, RotateCcw, AlertTriangle, TrendingUp, TrendingDown, Zap } from 'lucide-react';

interface Vwma20EntryCardProps {
  symbol: string;
}

export function Vwma20EntryCard({ symbol }: Vwma20EntryCardProps) {
  const { data, loading, error, flash, refetch } = useVwma20EntryRealtime(symbol);
  const analysis = useMemoizedVwma20Analysis(data || null);
  const [expanded, setExpanded] = useState(true);

  const handleRetry = () => {
    refetch();
  };

  // ── Loading State ────────────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <div className="bg-gradient-to-b from-slate-900 to-slate-950 rounded-lg border border-slate-700 p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="h-5 w-24 bg-slate-700 rounded animate-pulse" />
          </div>
          <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
        <div className="space-y-2">
          <div className="h-4 w-32 bg-slate-700 rounded animate-pulse" />
          <div className="h-4 w-40 bg-slate-700 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  // ── Error State ──────────────────────────────────────────────────────────
  if (error && !data) {
    return (
      <div className="bg-gradient-to-b from-slate-900 to-slate-950 rounded-lg border border-red-800/30 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <span className="text-sm font-medium text-red-400">VWMA Error</span>
          </div>
          <button
            onClick={handleRetry}
            className="p-1 hover:bg-slate-800 rounded transition-colors"
          >
            <RotateCcw className="w-4 h-4 text-slate-400 hover:text-slate-300" />
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-2">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  // ── Signal Colors ────────────────────────────────────────────────────────
  const signalConfig = {
    STRONG_BUY: { color: 'from-emerald-600 to-emerald-700', bg: 'bg-emerald-900/20', badge: 'bg-emerald-500/20 text-emerald-400' },
    BUY: { color: 'from-green-600 to-green-700', bg: 'bg-green-900/20', badge: 'bg-green-500/20 text-green-400' },
    STRONG_SELL: { color: 'from-rose-600 to-rose-700', bg: 'bg-rose-900/20', badge: 'bg-rose-500/20 text-rose-400' },
    SELL: { color: 'from-red-600 to-red-700', bg: 'bg-red-900/20', badge: 'bg-red-500/20 text-red-400' },
    WAIT: { color: 'from-amber-600 to-amber-700', bg: 'bg-amber-900/20', badge: 'bg-amber-500/20 text-amber-400' },
  };

  const signal = data.entry_signal || 'WAIT';
  const config = signalConfig[signal as keyof typeof signalConfig] || signalConfig.WAIT;

  // ── Setup Direction Icons ────────────────────────────────────────────────
  const setupIcon = analysis.isBullishSetup ? (
    <TrendingUp className="w-4 h-4 text-emerald-400" />
  ) : (
    <TrendingDown className="w-4 h-4 text-rose-400" />
  );

  return (
    <div
      className={`bg-gradient-to-b ${config.color} from-opacity-5 to-opacity-5 rounded-lg border border-slate-700/50 overflow-hidden transition-all ${
        flash ? 'ring-2 ring-offset-2 ring-offset-slate-950 ring-amber-500' : ''
      }`}
    >
      {/* ── Header ──────────────────────────────────────────────────────────*/}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-3 flex items-center justify-between hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3 flex-1">
          <div className={`${config.badge} px-2 py-1 rounded text-xs font-semibold`}>
            {signal}
          </div>
          <span className="text-sm font-semibold text-slate-200">VWMA 20 Entry Filter</span>
          <span className="text-xs text-slate-400">Volume-Weighted MA</span>
        </div>
        <ChevronDown
          className={`w-5 h-5 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {/* ── Main Content ────────────────────────────────────────────────────*/}
      {expanded && (
        <div className={`${config.bg} border-t border-slate-700/30 p-3 space-y-3`}>
          
          {/* 🔥 Price & VWMA Display ────────────────────────────────────────*/}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-800/40 p-2 rounded border border-slate-700/30">
              <p className="text-xs text-slate-500 mb-1">Current Price</p>
              <p className="text-lg font-bold text-slate-100">
                ₹{data.current_price?.toFixed(2) || '0.00'}
              </p>
            </div>

            <div className="bg-slate-800/40 p-2 rounded border border-slate-700/30">
              <p className="text-xs text-slate-500 mb-1">VWMA 20</p>
              <p className={`text-lg font-bold ${analysis.isBullishSetup ? 'text-emerald-400' : 'text-rose-400'}`}>
                ₹{data.vwma_20?.toFixed(2) || '0.00'}
              </p>
            </div>
          </div>

          {/* Setup Type & VWMA Position ─────────────────────────────────────*/}
          <div className="grid grid-cols-2 gap-2">
            <div className={`flex items-center gap-2 bg-slate-800/40 p-2 rounded border border-slate-700/30`}>
              {setupIcon}
              <div>
                <p className="text-xs text-slate-500">Setup</p>
                <p className={`text-sm font-semibold ${analysis.isBullishSetup ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {analysis.isBullishSetup ? 'BULLISH' : 'BEARISH'}
                </p>
              </div>
            </div>

            <div className="bg-slate-800/40 p-2 rounded border border-slate-700/30">
              <p className="text-xs text-slate-500 mb-1">VWMA Position</p>
              <p className="text-sm font-semibold text-slate-100">
                {data.vwma_position || 'UNKNOWN'}
              </p>
            </div>
          </div>

          {/* Distance to VWMA ──────────────────────────────────────────────*/}
          <div className="bg-slate-800/40 p-2 rounded border border-slate-700/30">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-slate-500">Distance to VWMA</p>
              <p className="text-sm font-bold text-slate-100">
                ₹{data.distance_to_vwma?.toFixed(2) || '0.00'}
              </p>
            </div>
            <p className="text-xs text-slate-400 mb-2">
              {data.distance_to_vwma_pct?.toFixed(3)}% away
            </p>
            <div className="w-full h-1.5 bg-slate-700/40 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-300"
                style={{ width: `${Math.min((data.distance_to_vwma_pct / 2) * 100, 100)}%` }}
              />
            </div>
          </div>

          {/* Entry Signal Status ────────────────────────────────────────────*/}
          <div className="bg-slate-800/40 p-2 rounded border border-slate-700/30">
            <p className="text-xs text-slate-500 mb-1">Entry Signal</p>
            <p className={`text-sm font-semibold ${
              signal.includes('BUY') ? 'text-emerald-400' :
              signal.includes('SELL') ? 'text-rose-400' : 'text-amber-400'
            }`}>
              {signal}
            </p>
            <p className="text-xs text-slate-400 mt-2">
              {signal.includes('STRONG') ? '🔥 Strong signal - High probability entry' :
               signal.includes('BUY') ? '✓ Buy setup confirmed' :
               signal.includes('SELL') ? '✓ Sell setup confirmed' :
               '⏳ Awaiting confirmation conditions'}
            </p>
          </div>

          {/* EMA Alignment ──────────────────────────────────────────────────*/}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-800/40 p-2 rounded border border-slate-700/30">
              <p className="text-xs text-slate-500 mb-1">EMA 20</p>
              <p className="text-sm font-bold text-slate-100">
                ₹{data.ema_20?.toFixed(2) || '0.00'}
              </p>
            </div>

            <div className="bg-slate-800/40 p-2 rounded border border-slate-700/30">
              <p className="text-xs text-slate-500 mb-1">EMA 50</p>
              <p className="text-sm font-bold text-slate-100">
                ₹{data.ema_50?.toFixed(2) || '0.00'}
              </p>
            </div>
          </div>

          {/* EMA Alignment Status ───────────────────────────────────────────*/}
          <div className="bg-slate-800/40 p-2 rounded border border-slate-700/30">
            <p className="text-xs text-slate-500 mb-1">EMA Alignment</p>
            <p className={`text-sm font-semibold ${
              data.ema_alignment?.includes('BULLISH') ? 'text-emerald-400' :
              data.ema_alignment?.includes('BEARISH') ? 'text-rose-400' : 'text-slate-400'
            }`}>
              {data.ema_alignment || 'NEUTRAL'}
            </p>
          </div>

          {/* Volume Analysis ───────────────────────────────────────────────*/}
          <div className="bg-slate-800/40 p-2 rounded border border-slate-700/30">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-slate-500">Volume Status</p>
              <p className={`text-xs font-bold px-2 py-0.5 rounded ${
                data.volume_status === 'STRONG' ? 'bg-emerald-500/20 text-emerald-400' :
                data.volume_status === 'WEAK' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
              }`}>
                {data.volume_status}
              </p>
            </div>
            <p className="text-sm font-bold text-slate-100">
              {data.volume_ratio?.toFixed(2)}x average
            </p>
            <p className={`text-xs mt-1 ${data.volume_price_aligned ? 'text-emerald-400' : 'text-slate-400'}`}>
              {data.volume_price_aligned ? '✓ Volume aligned with price' : 'Volume divergence'}
            </p>
          </div>

          {/* Signal Confidence ─────────────────────────────────────────────*/}
          <div className="bg-slate-800/40 p-2 rounded border border-slate-700/30">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-slate-500">Signal Confidence</p>
              <p className="text-sm font-bold text-slate-100">{data.signal_confidence || 0}%</p>
            </div>
            <div className="w-full h-1.5 bg-slate-700/40 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  data.signal_confidence >= 80 ? 'bg-emerald-500' :
                  data.signal_confidence >= 60 ? 'bg-amber-500' : 'bg-slate-500'
                }`}
                style={{ width: `${data.signal_confidence || 0}%` }}
              />
            </div>
          </div>

          {/* Signal Strength Indicator ─────────────────────────────────────*/}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className={`${analysis.isStrongSignal ? 'bg-emerald-500/20' : 'bg-slate-800/40'} p-2 rounded border border-slate-700/30`}>
              <p className="text-slate-500 mb-1">Signal Strength</p>
              <p className={`font-semibold flex items-center gap-1 ${analysis.isStrongSignal ? 'text-emerald-400' : 'text-slate-400'}`}>
                {analysis.isStrongSignal && <Zap className="w-3 h-3" />}
                {analysis.isStrongSignal ? 'STRONG' : 'NORMAL'}
              </p>
            </div>

            <div className="bg-slate-800/40 p-2 rounded border border-slate-700/30">
              <p className="text-slate-500 mb-1">Candles</p>
              <p className="font-semibold text-slate-100">{data.candles_analyzed || 0}</p>
            </div>
          </div>

          {/* Data Status ────────────────────────────────────────────────────*/}
          <div className="text-xs text-slate-500 flex items-center justify-between pt-2 border-t border-slate-700/20">
            <span>
              {data.isLive ? (
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" /> Live
                </span>
              ) : (
                'Cached'
              )}
            </span>
            <span>{new Date(data.lastUpdateTime || Date.now()).toLocaleTimeString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Memoized export for performance ──────────────────────────────────────────
export const MemoizedVwma20EntryCard = React.memo(Vwma20EntryCard);
