/**
 * CamarillaCprCard – Camarilla R3/S3 CPR Zone Analysis
 * ════════════════════════════════════════════════════════════════════════════
 * Displays real-time Camarilla pivot levels, CPR zones, breakout signals, and confidence
 * 
 * Trading Strategy:
 * - R3 above TC = Strongest bullish breakout zone (price > R3 = confirmed bull)
 * - S3 below BC = Strongest bearish breakdown zone (price < S3 = confirmed bear)
 * - Inside CPR = Chop zone (avoid entries, await break for directional trade)
 * - CPR width narrow = Trending day (setup for big breakout)
 * 
 * Performance: <200ms live updates, <50ms component latency
 */

'use client';

import React, { useState } from 'react';
import { useCamarillaCprRealtime, useMemoizedCamarillaCprAnalysis } from '@/hooks/useCamarillaCprRealtime';
import { ChevronDown, RotateCcw, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';

interface CamarillaCprCardProps {
  symbol: string;
}

export function CamarillaCprCard({ symbol }: CamarillaCprCardProps) {
  const { data, loading, error, flash, refetch } = useCamarillaCprRealtime(symbol);
  const analysis = useMemoizedCamarillaCprAnalysis(data || null);
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
            <span className="text-sm font-medium text-red-400">CPR Error</span>
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
    R3: { color: 'from-emerald-600 to-emerald-700', bg: 'bg-emerald-900/20', badge: 'bg-emerald-500/20 text-emerald-400' },
    S3: { color: 'from-rose-600 to-rose-700', bg: 'bg-rose-900/20', badge: 'bg-rose-500/20 text-rose-400' },
    CPR: { color: 'from-amber-600 to-amber-700', bg: 'bg-amber-900/20', badge: 'bg-amber-500/20 text-amber-400' },
    ABOVE: { color: 'from-cyan-600 to-cyan-700', bg: 'bg-cyan-900/20', badge: 'bg-cyan-500/20 text-cyan-400' },
    BELOW: { color: 'from-purple-600 to-purple-700', bg: 'bg-purple-900/20', badge: 'bg-purple-500/20 text-purple-400' },
  };

  const signalType = data.camarilla_signal?.split('_')[0] || 'CPR';
  const config = signalConfig[signalType as keyof typeof signalConfig] || signalConfig.CPR;

  // ── Zone Color Mapping ───────────────────────────────────────────────────
  const zoneColors = {
    ABOVE_TC: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', icon: TrendingUp },
    INSIDE_CPR: { bg: 'bg-amber-500/20', text: 'text-amber-400', icon: AlertTriangle },
    BELOW_BC: { bg: 'bg-rose-500/20', text: 'text-rose-400', icon: TrendingDown },
  };

  const zoneConfig = zoneColors[data.camarilla_zone as keyof typeof zoneColors] || zoneColors.INSIDE_CPR;
  const ZoneIcon = zoneConfig.icon;

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
            {signalType}
          </div>
          <span className="text-sm font-semibold text-slate-200">Camarilla R3/S3 CPR</span>
          <span className="text-xs text-slate-400">Pivot Zones</span>
        </div>
        <ChevronDown
          className={`w-5 h-5 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {/* ── Main Content ────────────────────────────────────────────────────*/}
      {expanded && (
        <div className={`${config.bg} border-t border-slate-700/30 p-3 space-y-3`}>
          
          {/* 🔥 Current Price & Zone ────────────────────────────────────────*/}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-800/40 p-2 rounded border border-slate-700/30">
              <p className="text-xs text-slate-500 mb-1">Current Price</p>
              <p className="text-lg font-bold text-slate-100">
                ₹{data.current_price?.toFixed(2) || '0.00'}
              </p>
            </div>

            <div className={`flex items-center gap-2 ${zoneConfig.bg} p-2 rounded border border-slate-700/30`}>
              <ZoneIcon className={`w-4 h-4 ${zoneConfig.text}`} />
              <div>
                <p className="text-xs text-slate-500">Zone</p>
                <p className={`text-sm font-semibold ${zoneConfig.text}`}>
                  {data.camarilla_zone === 'ABOVE_TC' ? 'ABOVE CPR' :
                   data.camarilla_zone === 'BELOW_BC' ? 'BELOW CPR' : 'IN CPR'}
                </p>
              </div>
            </div>
          </div>

          {/* Camarilla Gate Levels (R3 & S3) ────────────────────────────────*/}
          <div className="space-y-2">
            {/* R3 Resistance Gate ─────────────────────────────────────────*/}
            <div className="bg-slate-800/40 p-2 rounded border border-emerald-700/30">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-slate-500">🎯 R3 Resistance Gate</p>
                <span className="text-xs px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded font-semibold">
                  {data.distance_to_r3_pct?.toFixed(2)}%
                </span>
              </div>
              <p className="text-lg font-bold text-emerald-400">
                ₹{data.r3?.toFixed(2) || '0.00'}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Distance: ₹{data.distance_to_r3?.toFixed(2) || '0.00'}
              </p>
            </div>

            {/* S3 Support Gate ────────────────────────────────────────────*/}
            <div className="bg-slate-800/40 p-2 rounded border border-rose-700/30">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-slate-500">🎯 S3 Support Gate</p>
                <span className="text-xs px-2 py-0.5 bg-rose-500/20 text-rose-400 rounded font-semibold">
                  {data.distance_to_s3_pct?.toFixed(2)}%
                </span>
              </div>
              <p className="text-lg font-bold text-rose-400">
                ₹{data.s3?.toFixed(2) || '0.00'}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Distance: ₹{data.distance_to_s3?.toFixed(2) || '0.00'}
              </p>
            </div>
          </div>

          {/* CPR Central Pivot Range ────────────────────────────────────────*/}
          <div className="bg-slate-800/40 p-2 rounded border border-slate-700/30">
            <p className="text-xs text-slate-500 mb-2">📊 CPR (Central Pivot Range)</p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <p className="text-xs text-slate-500 mb-1">Top (TC)</p>
                <p className="text-sm font-bold text-slate-300">₹{data.tc?.toFixed(2) || '0.00'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Pivot</p>
                <p className="text-sm font-bold text-slate-300">₹{data.pivot?.toFixed(2) || '0.00'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Bottom (BC)</p>
                <p className="text-sm font-bold text-slate-300">₹{data.bc?.toFixed(2) || '0.00'}</p>
              </div>
            </div>
          </div>

          {/* CPR Width Analysis ─────────────────────────────────────────────*/}
          <div className="bg-slate-800/40 p-2 rounded border border-slate-700/30">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-slate-500">CPR Width</p>
              <p className={`text-sm font-bold px-2 py-0.5 rounded ${
                data.cpr_width_pct < 0.5 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
              }`}>
                {data.cpr_classification}
              </p>
            </div>
            <p className="text-lg font-bold text-slate-100 mb-1">
              ₹{data.cpr_width?.toFixed(2) || '0.00'} ({data.cpr_width_pct?.toFixed(3)}%)
            </p>
            <p className="text-xs text-slate-400">
              {data.cpr_description}
            </p>
          </div>

          {/* Signal Status ──────────────────────────────────────────────────*/}
          <div className="bg-slate-800/40 p-2 rounded border border-slate-700/30">
            <p className="text-xs text-slate-500 mb-1">Signal</p>
            <p className="text-sm font-semibold text-slate-200">
              {data.camarilla_signal || 'ANALYZING'}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {data.zone_status || 'Waiting for data...'}
            </p>
          </div>

          {/* Confidence Score ──────────────────────────────────────────────*/}
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

          {/* Trend Day Indicator ────────────────────────────────────────────*/}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className={`${analysis.trendingDay ? 'bg-emerald-500/20' : 'bg-slate-800/40'} p-2 rounded border border-slate-700/30`}>
              <p className="text-slate-500 mb-1">Trend Day?</p>
              <p className={`font-semibold ${analysis.trendingDay ? 'text-emerald-400' : 'text-slate-400'}`}>
                {analysis.trendingDay ? '✓ YES' : 'No'}
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
export const MemoizedCamarillaCprCard = React.memo(CamarillaCprCard);
