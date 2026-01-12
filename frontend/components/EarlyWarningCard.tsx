"use client";

import React, { useEffect, useState } from 'react';
import { Timer, TrendingUp, TrendingDown, AlertTriangle, Volume2, Activity, Target, XCircle, CheckCircle } from 'lucide-react';

interface EarlyWarningData {
  symbol: string;
  timestamp: string;
  signal: 'EARLY_BUY' | 'EARLY_SELL' | 'WAIT';
  strength: number; // 0-100
  time_to_trigger: number; // minutes
  confidence: number; // 0-100%
  fake_signal_risk: 'LOW' | 'MEDIUM' | 'HIGH';
  momentum: {
    direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    strength: number;
    acceleration: number;
    consistency: number;
  };
  volume_buildup: {
    is_building: boolean;
    buildup_strength: number;
    candles_building: number;
  };
  price_compression: {
    is_compressed: boolean;
    compression_level: number;
    candles_compressed: number;
  };
  fake_signal_checks: {
    volume_confirmation: { pass: boolean; detail: string };
    momentum_consistency: { pass: boolean; detail: string };
    zone_proximity: { pass: boolean; detail: string };
    consolidation_duration: { pass: boolean; detail: string };
    direction_alignment: { pass: boolean; detail: string };
    pass_rate: number;
  };
  price_targets: {
    entry: number;
    stop_loss: number;
    target: number;
    risk_reward_ratio: number;
  };
  recommended_action: 'PREPARE_BUY' | 'PREPARE_SELL' | 'WAIT_FOR_CONFIRMATION' | 'CANCEL_ORDER';
  reasoning: string;
  status?: string;
  error?: string;
  token_valid?: boolean;
  data_source?: string;
}

interface EarlyWarningCardProps {
  symbol: string;
}

const EarlyWarningCard: React.FC<EarlyWarningCardProps> = ({ symbol }) => {
  const [data, setData] = useState<EarlyWarningData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ✅ REMOVED: Duplicate WebSocket connection - Use central useMarketSocket hook instead
  // Live price is now handled by the main page's WebSocket connection

  // ✅ REST API POLLING for analysis data
  useEffect(() => {
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://mydailytradesignals.com';
    let interval: NodeJS.Timeout | null = null;

    const fetchData = async () => {
      try {
        const response = await fetch(`${API_URL}/api/advanced/early-warning/${symbol}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        setData(result);
        setError(null);
        // Debug logs removed for production performance
      } catch (err) {
        // Only log errors, not every successful fetch
        if (process.env.NODE_ENV === 'development') {
          console.error(`[EarlyWarning-API] Error fetching ${symbol}:`, err);
        }
        setError(err instanceof Error ? err.message : 'Failed to fetch data');
      } finally {
        setLoading(false);
      }
    };

    // Initial fetch + Optimized polling (every 10 seconds to reduce API load)
    fetchData();
    const refreshInterval = parseInt(process.env.NEXT_PUBLIC_REFRESH_INTERVAL || '10000', 10);
    interval = setInterval(fetchData, refreshInterval);

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [symbol]);

  if (loading) {
    return (
      <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 animate-pulse">
        <div className="h-6 bg-gray-800 rounded w-1/3 mb-4"></div>
        <div className="h-16 bg-gray-800 rounded mb-4"></div>
        <div className="h-8 bg-gray-800 rounded"></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-gray-900 rounded-xl p-6 border border-red-900/50">
        <div className="flex items-center gap-2 text-red-500 mb-2">
          <XCircle className="w-5 h-5" />
          <h3 className="font-semibold">{symbol}</h3>
        </div>
        <p className="text-sm text-gray-400">{error || 'No data available'}</p>
      </div>
    );
  }

  // Color coding
  const getSignalColor = () => {
    if (data.signal === 'EARLY_BUY') return 'text-emerald-400';
    if (data.signal === 'EARLY_SELL') return 'text-red-400';
    return 'text-gray-400';
  };

  const getSignalBg = () => {
    if (data.signal === 'EARLY_BUY') return 'bg-gradient-to-br from-emerald-500/10 to-green-500/5';
    if (data.signal === 'EARLY_SELL') return 'bg-gradient-to-br from-red-500/10 to-rose-500/5';
    return 'bg-gradient-to-br from-gray-800/40 to-gray-800/20';
  };

  const getRiskColor = () => {
    if (data.fake_signal_risk === 'LOW') return 'text-emerald-400 bg-emerald-500/15 border-emerald-500/50 shadow-emerald-500/30';
    if (data.fake_signal_risk === 'MEDIUM') return 'text-amber-400 bg-amber-500/15 border-amber-500/50 shadow-amber-500/30';
    return 'text-rose-400 bg-rose-500/15 border-rose-500/50 shadow-rose-500/30';
  };

  const getSignalBorderStyle = () => {
    if (data.signal === 'EARLY_BUY') return 'text-emerald-400 bg-emerald-500/15 border-emerald-500/60 shadow-lg shadow-emerald-500/30';
    if (data.signal === 'EARLY_SELL') return 'text-red-400 bg-red-500/15 border-red-500/60 shadow-lg shadow-red-500/30';
    return 'text-gray-400 bg-gray-500/10 border-gray-500/40 shadow-lg shadow-gray-500/20';
  };

  const getActionColor = () => {
    if (data.recommended_action === 'PREPARE_BUY') return 'bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white shadow-lg shadow-emerald-500/30 border-2 border-emerald-500/50';
    if (data.recommended_action === 'PREPARE_SELL') return 'bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white shadow-lg shadow-red-500/30 border-2 border-red-500/50';
    if (data.recommended_action === 'CANCEL_ORDER') return 'bg-gradient-to-r from-rose-900 to-red-900 hover:from-rose-800 hover:to-red-800 text-white shadow-lg shadow-rose-500/30 border-2 border-rose-500/50';
    return 'bg-gradient-to-r from-gray-700 to-gray-600 hover:from-gray-600 hover:to-gray-500 text-gray-200 shadow-lg shadow-gray-500/20 border-2 border-gray-500/40';
  };

  const getActionIcon = () => {
    if (data.recommended_action === 'PREPARE_BUY') return <TrendingUp className="w-5 h-5" />;
    if (data.recommended_action === 'PREPARE_SELL') return <TrendingDown className="w-5 h-5" />;
    if (data.recommended_action === 'CANCEL_ORDER') return <XCircle className="w-5 h-5" />;
    return <Timer className="w-5 h-5" />;
  };

  return (
    <div className="bg-gradient-to-br from-gray-900 via-emerald-950/10 to-gray-900 rounded-xl p-6 border-2 border-emerald-500/40 hover:border-emerald-400/60 transition-all shadow-xl shadow-emerald-500/10 hover:shadow-emerald-500/20">
      
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/30">
            <Timer className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="flex flex-col">
            <h3 className="text-xl font-bold text-white">{symbol}</h3>
          </div>
        </div>
        
        {/* Fake Signal Risk Badge */}
        <div className={`px-3 py-1 rounded-lg text-xs font-bold border-2 shadow-lg ${getRiskColor()}`}>
          {data.fake_signal_risk} RISK
        </div>
      </div>

      {/* Main Signal Card */}
      <div className={`rounded-xl p-5 mb-4 border-2 backdrop-blur-sm ${
        data.signal === 'WAIT' 
          ? 'border-amber-400/30 bg-gradient-to-br from-amber-900/10 to-gray-800/20' 
          : 'border-emerald-400/25 ' + getSignalBg()
      }`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-400 mb-1">
              PREDICTIVE SIGNAL
            </div>
            <div className={`px-3 py-1.5 rounded-lg text-sm font-bold border-2 inline-block ${getSignalBorderStyle()}`}>
              {(data.signal || 'WAIT').replace('_', ' ')}
            </div>
            {data.signal === 'WAIT' && (
              <div className="text-[9px] text-amber-400 mt-1 flex items-center gap-1">
                <span className="w-1 h-1 bg-amber-400 rounded-full animate-pulse"></span>
                Monitoring for setup conditions
              </div>
            )}
          </div>
          
          {/* Countdown Timer OR Waiting Status */}
          <div className="text-right">
            {data.signal !== 'WAIT' ? (
              <>
                <div className="text-xs text-gray-400 mb-1">TIME TO TRIGGER</div>
                <div className="text-3xl font-bold text-emerald-400">
                  {data.time_to_trigger ?? 0}m
                </div>
              </>
            ) : (
              <>
                <div className="text-xs text-amber-400 mb-1">STATUS</div>
                <div className="text-lg font-bold text-amber-300 flex items-center gap-1">
                  <Timer className="w-4 h-4" />
                  Scanning
                </div>
              </>
            )}
          </div>
        </div>

        {/* Confidence & Strength */}
        <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-emerald-400/15">
          <div>
            <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
              <span>CONFIDENCE</span>
              {(data.confidence ?? 0) === 0 && (
                <span className="text-[9px] text-rose-400">⚠ NO SIGNAL</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-gray-800/30 rounded-full h-2.5 border border-emerald-400/20">
                <div 
                  className={`h-2.5 rounded-full transition-all ${
                    (data.confidence ?? 0) > 0 
                      ? 'bg-gradient-to-r from-emerald-500/80 to-green-400/70' 
                      : 'bg-gray-700/50'
                  }`}
                  style={{ width: `${data.confidence ?? 0}%` }}
                />
              </div>
              <span className={`text-sm font-bold ${
                (data.confidence ?? 0) > 0 ? 'text-emerald-400' : 'text-gray-500'
              }`}>{data.confidence ?? 0}%</span>
            </div>
          </div>
          
          <div>
            <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
              <span>STRENGTH</span>
              {(data.strength ?? 0) === 0 && (
                <span className="text-[9px] text-rose-400">⚠ WEAK</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-gray-800/30 rounded-full h-2.5 border border-emerald-400/20">
                <div 
                  className={`h-2.5 rounded-full transition-all ${
                    (data.strength ?? 0) > 0 
                      ? 'bg-gradient-to-r from-cyan-500/80 to-blue-400/70' 
                      : 'bg-gray-700/50'
                  }`}
                  style={{ width: `${data.strength ?? 0}%` }}
                />
              </div>
              <span className={`text-sm font-bold ${
                (data.strength ?? 0) > 0 ? 'text-cyan-400' : 'text-gray-500'
              }`}>{data.strength ?? 0}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Momentum Gauge */}
      <div className="bg-gray-800/20 rounded-lg p-3 mb-3 border border-emerald-400/25 hover:border-emerald-400/35 transition-all">
        <div className="flex items-center gap-2 mb-2">
          <Activity className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-semibold text-emerald-300">MOMENTUM</span>
          {data.momentum && (
            <span className="ml-auto text-[9px] text-emerald-400 flex items-center gap-1">
              <span className="w-1 h-1 bg-emerald-400 rounded-full animate-pulse"></span>
              LIVE
            </span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <div className="text-gray-500">Direction</div>
            <div className={`font-semibold flex items-center gap-1 ${
              data.momentum?.direction === 'BULLISH' ? 'text-green-500' : 
              data.momentum?.direction === 'BEARISH' ? 'text-red-500' : 
              'text-gray-400'
            }`}>
              {data.momentum?.direction === 'BULLISH' && '↗'}
              {data.momentum?.direction === 'BEARISH' && '↘'}
              {data.momentum?.direction || 'NEUTRAL'}
            </div>
          </div>
          <div>
            <div className="text-gray-500">Acceleration</div>
            <div className={`font-semibold ${
              Math.abs(data.momentum?.acceleration ?? 0) > 0 ? 'text-cyan-400' : 'text-gray-500'
            }`}>{(data.momentum?.acceleration ?? 0).toFixed(2)}%</div>
          </div>
          <div>
            <div className="text-gray-500">Consistency</div>
            <div className={`font-semibold ${
              (data.momentum?.consistency ?? 0) >= 66 ? 'text-emerald-400' :
              (data.momentum?.consistency ?? 0) >= 33 ? 'text-amber-400' : 'text-rose-400'
            }`}>{data.momentum?.consistency ?? 0}%</div>
          </div>
        </div>
      </div>

      {/* Volume Buildup - Modern Card */}
      <div className="bg-gradient-to-br from-gray-800/30 to-emerald-900/10 rounded-xl p-4 mb-3 border-2 border-emerald-400/30 hover:border-emerald-400/50 transition-all shadow-lg">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-emerald-500/15 rounded-lg border border-emerald-500/30">
              <Volume2 className="w-4 h-4 text-emerald-400" />
            </div>
            <span className="text-xs font-bold text-emerald-300">VOLUME BUILDUP</span>
          </div>
          {data.volume_buildup?.is_building ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/20 rounded-lg border-2 border-emerald-400/50 shadow-md shadow-emerald-500/20">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
              <span className="text-xs text-emerald-300 font-bold">ACTIVE</span>
            </div>
          ) : (
            <span className="px-2.5 py-1 bg-gray-700/30 rounded-lg border border-gray-600/40 text-xs text-gray-400 font-bold">INACTIVE</span>
          )}
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-gray-900/60 rounded-full h-3 border-2 border-emerald-400/25 overflow-hidden">
              <div 
                className={`h-full transition-all duration-500 ${
                  data.volume_buildup?.is_building 
                    ? 'bg-gradient-to-r from-emerald-500 to-green-400' 
                    : 'bg-gray-700/60'
                }`}
                style={{ width: `${data.volume_buildup?.buildup_strength ?? 0}%` }}
              />
            </div>
            <span className={`text-xs font-bold min-w-[45px] text-right ${
              (data.volume_buildup?.buildup_strength ?? 0) > 0 ? 'text-emerald-400' : 'text-gray-500'
            }`}>
              {data.volume_buildup?.buildup_strength ?? 0}%
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-gray-400">Building Candles:</span>
            <span className={`font-bold px-2 py-0.5 rounded ${
              (data.volume_buildup?.candles_building ?? 0) > 0 
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' 
                : 'text-gray-500'
            }`}>
              {data.volume_buildup?.candles_building ?? 0} candles
            </span>
          </div>
        </div>
      </div>

      {/* Price Compression - Modern Card */}
      <div className="bg-gradient-to-br from-gray-800/30 to-cyan-900/10 rounded-xl p-4 mb-4 border-2 border-cyan-400/30 hover:border-cyan-400/50 transition-all shadow-lg">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-cyan-500/15 rounded-lg border border-cyan-500/30">
              <Target className="w-4 h-4 text-cyan-400" />
            </div>
            <span className="text-xs font-bold text-cyan-300">PRICE COMPRESSION</span>
          </div>
          {data.price_compression?.is_compressed ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-cyan-500/20 rounded-lg border-2 border-cyan-400/50 shadow-md shadow-cyan-500/20">
              <span className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse"></span>
              <span className="text-xs text-cyan-300 font-bold">DETECTED</span>
            </div>
          ) : (
            <span className="px-2.5 py-1 bg-gray-700/30 rounded-lg border border-gray-600/40 text-xs text-gray-400 font-bold">NONE</span>
          )}
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-gray-900/60 rounded-full h-3 border-2 border-cyan-400/25 overflow-hidden">
              <div 
                className={`h-full transition-all duration-500 ${
                  data.price_compression?.is_compressed 
                    ? 'bg-gradient-to-r from-cyan-500 to-emerald-400' 
                    : 'bg-gray-700/60'
                }`}
                style={{ width: `${data.price_compression?.compression_level ?? 0}%` }}
              />
            </div>
            <span className={`text-xs font-bold min-w-[45px] text-right ${
              (data.price_compression?.compression_level ?? 0) > 0 ? 'text-cyan-400' : 'text-gray-500'
            }`}>
              {data.price_compression?.compression_level ?? 0}%
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-gray-400">Compressed Candles:</span>
            <span className={`font-bold px-2 py-0.5 rounded ${
              (data.price_compression?.candles_compressed ?? 0) > 0 
                ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30' 
                : 'text-gray-500'
            }`}>
              {data.price_compression?.candles_compressed ?? 0} candles
            </span>
          </div>
        </div>
      </div>

      {/* Signal Validation - Modern Grid Layout */}
      {data.fake_signal_checks && (
        <div className="bg-gradient-to-br from-gray-800/30 to-emerald-900/10 rounded-xl p-4 mb-4 border-2 border-emerald-400/30 hover:border-emerald-400/50 transition-all shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-emerald-500/15 rounded-lg border border-emerald-500/30">
                <AlertTriangle className="w-4 h-4 text-emerald-400" />
              </div>
              <span className="text-xs font-bold text-emerald-300">SIGNAL VALIDATION</span>
              <span className="text-[9px] text-emerald-400 flex items-center gap-1 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/30">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></span>
                LIVE
              </span>
            </div>
            <div className={`px-3 py-1 rounded-lg text-xs font-bold border-2 shadow-md ${
              (data.fake_signal_checks.pass_rate ?? 0) >= 80 ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50 shadow-emerald-500/20' :
              (data.fake_signal_checks.pass_rate ?? 0) >= 60 ? 'bg-amber-500/20 text-amber-300 border-amber-400/50 shadow-amber-500/20' :
              'bg-rose-500/20 text-rose-300 border-rose-400/50 shadow-rose-500/20'
            }`}>
              {data.fake_signal_checks.pass_rate ?? 0}% Pass
            </div>
          </div>
          
          {/* Grid Layout for Filters */}
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(data.fake_signal_checks).map(([key, value]) => {
              if (key === 'pass_rate') return null;
              const check = value as { pass: boolean; detail: string };
              return (
                <div 
                  key={key} 
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition-all ${
                    check.pass 
                      ? 'bg-emerald-500/10 border-emerald-500/40 hover:bg-emerald-500/15' 
                      : 'bg-rose-500/10 border-rose-500/40 hover:bg-rose-500/15'
                  }`}
                >
                  {check.pass ? (
                    <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                  )}
                  <span className={`text-[10px] font-bold ${check.pass ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {key.replace(/_/g, ' ').toUpperCase()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Price Targets OR Waiting Explanation */}
      {data.signal !== 'WAIT' ? (
        /* Show Price Targets when signal is BUY/SELL */
        data.price_targets && (
          <div className="bg-gray-800/20 rounded-lg p-3 mb-4 border border-emerald-400/25 hover:border-emerald-400/35 transition-all">
            <div className="text-xs font-semibold text-emerald-300 mb-2">PRICE TARGETS</div>
            <div className="grid grid-cols-4 gap-2 text-xs">
              <div>
                <div className="text-gray-500">Entry</div>
                <div className="text-white font-bold">₹{(data.price_targets.entry ?? 0).toFixed(2)}</div>
              </div>
              <div>
                <div className="text-gray-500">Stop Loss</div>
                <div className="text-rose-400 font-bold">₹{(data.price_targets.stop_loss ?? 0).toFixed(2)}</div>
              </div>
              <div>
                <div className="text-gray-500">Target</div>
                <div className="text-emerald-400 font-bold">₹{(data.price_targets.target ?? 0).toFixed(2)}</div>
              </div>
              <div>
                <div className="text-gray-500">R:R</div>
                <div className="text-cyan-400 font-bold">1:{(data.price_targets.risk_reward_ratio ?? 2).toFixed(1)}</div>
              </div>
            </div>
          </div>
        )
      ) : (
        /* Show WHAT TO WAIT FOR when signal is WAIT */
        <div className="bg-gradient-to-br from-amber-900/20 to-gray-800/30 rounded-xl p-4 mb-4 border-2 border-amber-400/40 hover:border-amber-400/60 transition-all shadow-lg">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 bg-amber-500/20 rounded-lg border border-amber-500/40">
              <Timer className="w-4 h-4 text-amber-400" />
            </div>
            <span className="text-xs font-bold text-amber-300">WAITING FOR CONDITIONS</span>
          </div>
          
          <div className="space-y-2 text-xs">
            {/* Show what conditions are missing */}
            <div className="flex items-start gap-2">
              <div className={`mt-0.5 w-2 h-2 rounded-full ${
                data.momentum?.direction !== 'NEUTRAL' ? 'bg-emerald-400' : 'bg-gray-600'
              }`}></div>
              <div className="flex-1">
                <div className="text-gray-300 font-semibold">Clear Momentum Direction</div>
                <div className={`text-[10px] ${
                  data.momentum?.direction !== 'NEUTRAL' ? 'text-emerald-400' : 'text-gray-500'
                }`}>
                  {data.momentum?.direction !== 'NEUTRAL' 
                    ? `✓ ${data.momentum?.direction} momentum detected` 
                    : '○ Waiting for bullish/bearish momentum'}
                </div>
              </div>
            </div>
            
            <div className="flex items-start gap-2">
              <div className={`mt-0.5 w-2 h-2 rounded-full ${
                data.volume_buildup?.is_building ? 'bg-emerald-400' : 'bg-gray-600'
              }`}></div>
              <div className="flex-1">
                <div className="text-gray-300 font-semibold">Volume Buildup</div>
                <div className={`text-[10px] ${
                  data.volume_buildup?.is_building ? 'text-emerald-400' : 'text-gray-500'
                }`}>
                  {data.volume_buildup?.is_building 
                    ? `✓ Volume building (${data.volume_buildup.buildup_strength}% strength)` 
                    : '○ Waiting for volume accumulation'}
                </div>
              </div>
            </div>
            
            <div className="flex items-start gap-2">
              <div className={`mt-0.5 w-2 h-2 rounded-full ${
                (data.confidence ?? 0) >= 50 ? 'bg-emerald-400' : 'bg-gray-600'
              }`}></div>
              <div className="flex-1">
                <div className="text-gray-300 font-semibold">Signal Confidence ≥50%</div>
                <div className={`text-[10px] ${
                  (data.confidence ?? 0) >= 50 ? 'text-emerald-400' : 'text-gray-500'
                }`}>
                  {(data.confidence ?? 0) >= 50 
                    ? `✓ Confidence at ${data.confidence}%` 
                    : `○ Current confidence: ${data.confidence}% (need ≥50%)`}
                </div>
              </div>
            </div>
            
            <div className="flex items-start gap-2">
              <div className={`mt-0.5 w-2 h-2 rounded-full ${
                data.fake_signal_risk === 'LOW' ? 'bg-emerald-400' : 'bg-gray-600'
              }`}></div>
              <div className="flex-1">
                <div className="text-gray-300 font-semibold">Low Fake Signal Risk</div>
                <div className={`text-[10px] ${
                  data.fake_signal_risk === 'LOW' ? 'text-emerald-400' : 'text-amber-400'
                }`}>
                  {data.fake_signal_risk === 'LOW' 
                    ? '✓ Risk is LOW' 
                    : `○ Risk is ${data.fake_signal_risk} (${data.fake_signal_checks?.pass_rate ?? 0}% validation)`}
                </div>
              </div>
            </div>
          </div>
          
          <div className="mt-3 pt-3 border-t border-amber-400/20">
            <div className="text-[10px] text-amber-300 font-semibold">
              💡 What This Means:
            </div>
            <div className="text-[10px] text-gray-400 mt-1 leading-relaxed">
              Market is in <span className="text-amber-400 font-semibold">neutral/sideways mode</span>. 
              Early Warning needs <span className="text-white font-semibold">clear directional momentum + volume buildup</span> to 
              predict breakouts 1-3 minutes ahead. Keep monitoring - conditions can change quickly!
            </div>
          </div>
        </div>
      )}

      {/* Recommended Action Button OR Status Badge */}
      {data.signal !== 'WAIT' ? (
        /* Show Action Button when signal is BUY/SELL */
        <button 
          className={`w-full py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all transform hover:scale-[1.02] active:scale-[0.98] ${getActionColor()}`}
        >
          {getActionIcon()}
          {data.recommended_action.replace(/_/g, ' ')}
        </button>
      ) : (
        /* Show Status Badge when signal is WAIT - Not a button! */
        <div className="w-full py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 bg-gradient-to-r from-gray-700/50 to-gray-600/50 border-2 border-gray-500/40 text-gray-300 shadow-lg">
          <Timer className="w-5 h-5 text-amber-400 animate-pulse" />
          <span>MONITORING MARKET CONDITIONS</span>
        </div>
      )}

      {/* Reasoning */}
      <div className={`mt-3 p-3 rounded-lg backdrop-blur-sm border ${
        data.signal === 'WAIT' 
          ? 'bg-amber-500/5 border-amber-400/25' 
          : 'bg-emerald-500/5 border-emerald-400/25'
      }`}>
        <div className={`text-xs mb-1 font-bold flex items-center gap-1 ${
          data.signal === 'WAIT' ? 'text-amber-400' : 'text-emerald-400'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${
            data.signal === 'WAIT' ? 'bg-amber-400' : 'bg-emerald-400'
          }`}></span>
          {data.signal === 'WAIT' ? 'MARKET STATUS' : 'ANALYSIS'}
        </div>
        <p className="text-xs text-gray-300 leading-relaxed">{data.reasoning || 'No analysis available'}</p>
      </div>
    </div>
  );
};

export default EarlyWarningCard;
