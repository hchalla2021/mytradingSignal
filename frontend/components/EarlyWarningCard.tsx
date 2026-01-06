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
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  // ✅ WEBSOCKET for live price updates
  useEffect(() => {
    const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://127.0.0.1:8000/ws/market';
    let ws: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;

    const connect = () => {
      try {
        ws = new WebSocket(WS_URL);

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            
            // Handle tick updates for live price
            if (message.type === 'tick' && message.data?.symbol === symbol) {
              setLivePrice(message.data.price);
              setLastUpdate(new Date());
              console.log(`[EarlyWarning-WS] 🔴 LIVE price for ${symbol}: ₹${message.data.price}`);
            }
            
            // Handle snapshot data
            if (message.type === 'snapshot' && message.data?.[symbol]) {
              setLivePrice(message.data[symbol].price);
              setLastUpdate(new Date());
              console.log(`[EarlyWarning-WS] 📸 Snapshot price for ${symbol}: ₹${message.data[symbol].price}`);
            }
          } catch (err) {
            console.error(`[EarlyWarning-WS] Parse error:`, err);
          }
        };

        ws.onerror = () => {
          console.error(`[EarlyWarning-WS] Connection error`);
        };

        ws.onclose = () => {
          console.log(`[EarlyWarning-WS] Connection closed, reconnecting...`);
          reconnectTimeout = setTimeout(connect, 3000);
        };

      } catch (err) {
        console.error(`[EarlyWarning-WS] Failed to connect:`, err);
        reconnectTimeout = setTimeout(connect, 3000);
      }
    };

    connect();

    return () => {
      if (ws) {
        ws.close();
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
    };
  }, [symbol]);

  // ✅ REST API POLLING for analysis data
  useEffect(() => {
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
    let interval: NodeJS.Timeout | null = null;

    const fetchData = async () => {
      try {
        const response = await fetch(`${API_URL}/api/advanced/early-warning/${symbol}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        setData(result);
        setError(null);
        
        // 🔍 DETAILED LOGGING for debugging
        console.log(`[EarlyWarning-API] ✅ Analysis updated for ${symbol}:`, {
          signal: result.signal,
          strength: result.strength,
          confidence: result.confidence,
          status: result.status,
          timestamp: result.timestamp,
          momentum: result.momentum,
          volume_buildup: result.volume_buildup,
          price_compression: result.price_compression,
          fake_signal_checks: result.fake_signal_checks?.pass_rate
        });
        
        // 🚨 ALERT if 0% confidence/strength
        if (result.confidence === 0 || result.strength === 0) {
          console.warn(`[EarlyWarning-API] ⚠️ ${symbol} has ZERO confidence/strength:`, {
            reasoning: result.reasoning,
            status: result.status,
            token_valid: result.token_valid
          });
        }
      } catch (err) {
        console.error(`[EarlyWarning-API] Error fetching ${symbol}:`, err);
        setError(err instanceof Error ? err.message : 'Failed to fetch data');
      } finally {
        setLoading(false);
      }
    };

    // Initial fetch + Fast polling (every 5 seconds)
    fetchData();
    const refreshInterval = parseInt(process.env.NEXT_PUBLIC_REFRESH_INTERVAL || '5000', 10);
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
      
      {/* Data Quality Banner */}
      {data.status && (
        <div className={`mb-3 px-3 py-2 rounded-lg border text-xs font-semibold flex items-center gap-2 ${
          data.status === 'FRESH' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
          data.status === 'CACHED' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' :
          data.status === 'NO_DATA' ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' :
          'bg-gray-500/10 border-gray-500/30 text-gray-400'
        }`}>
          <span className="w-2 h-2 rounded-full animate-pulse" style={{
            backgroundColor: data.status === 'FRESH' ? 'rgb(52, 211, 153)' : 
                          data.status === 'CACHED' ? 'rgb(251, 191, 36)' : 
                          'rgb(248, 113, 113)'
          }}></span>
          <span>
            {data.status === 'FRESH' && '🟢 LIVE DATA - Analysis from fresh market feed'}
            {data.status === 'CACHED' && '🟡 CACHED DATA - Using last successful analysis'}
            {data.status === 'NO_DATA' && '🔴 NO DATA - Market closed or token expired'}
            {!['FRESH', 'CACHED', 'NO_DATA'].includes(data.status) && `Status: ${data.status}`}
          </span>
          {data.token_valid === false && (
            <span className="ml-auto text-rose-400 font-bold">🔒 TOKEN EXPIRED</span>
          )}
        </div>
      )}
      
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/30">
            <Timer className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="flex flex-col">
            <h3 className="text-xl font-bold text-white">{symbol}</h3>
            {livePrice && (
              <div className="flex items-center gap-1">
                <span className="text-xs text-emerald-400 font-semibold">
                  ₹{livePrice.toFixed(2)}
                </span>
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></span>
                <span className="text-[9px] text-gray-500">
                  LIVE
                </span>
              </div>
            )}
          </div>
          <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 text-[10px] font-bold rounded-full border border-emerald-500/50">
            5s Analysis
          </span>
          <span className="px-2 py-0.5 bg-cyan-500/20 text-cyan-300 text-[10px] font-bold rounded-full border border-cyan-500/50">
            WS Price
          </span>
        </div>
        
        {/* Fake Signal Risk Badge */}
        <div className={`px-3 py-1 rounded-lg text-xs font-bold border-2 shadow-lg ${getRiskColor()}`}>
          {data.fake_signal_risk} RISK
        </div>
      </div>

      {/* Main Signal Card */}
      <div className={`rounded-xl p-5 mb-4 border-2 backdrop-blur-sm border-emerald-400/25 ${getSignalBg()}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
              <span>PREDICTIVE SIGNAL</span>
              {data.status && (
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                  data.status === 'FRESH' ? 'bg-emerald-500/20 text-emerald-400' :
                  data.status === 'CACHED' ? 'bg-amber-500/20 text-amber-400' :
                  'bg-gray-500/20 text-gray-400'
                }`}>
                  {data.status}
                </span>
              )}
            </div>
            <div className={`px-3 py-1.5 rounded-lg text-sm font-bold border-2 inline-block ${getSignalBorderStyle()}`}>
              {(data.signal || 'WAIT').replace('_', ' ')}
            </div>
          </div>
          
          {/* Countdown Timer */}
          <div className="text-right">
            <div className="text-xs text-gray-400 mb-1">TIME TO TRIGGER</div>
            <div className="text-3xl font-bold text-emerald-400">
              {data.time_to_trigger ?? 0}m
            </div>
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

      {/* Price Targets */}
      {data.signal !== 'WAIT' && data.price_targets && (
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
      )}

      {/* Recommended Action Button */}
      <button 
        className={`w-full py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all transform hover:scale-[1.02] active:scale-[0.98] ${getActionColor()}`}
      >
        {getActionIcon()}
        {data.recommended_action.replace(/_/g, ' ')}
      </button>

      {/* Reasoning */}
      <div className="mt-3 p-3 bg-emerald-500/5 border border-emerald-400/25 rounded-lg backdrop-blur-sm">
        <div className="text-xs text-emerald-400 mb-1 font-bold flex items-center gap-1">
          <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></span>
          ANALYSIS
        </div>
        <p className="text-xs text-gray-300 leading-relaxed">{data.reasoning || 'No analysis available'}</p>
      </div>

      {/* Timestamp */}
      <div className="mt-3 text-xs text-gray-500 text-center space-y-1">
        <div className="flex items-center justify-center gap-3">
          <span>Analysis: {data.timestamp ? new Date(data.timestamp).toLocaleTimeString() : 'N/A'}</span>
          {livePrice && (
            <>
              <span>•</span>
              <span className="flex items-center gap-1">
                Price: {lastUpdate.toLocaleTimeString()}
                <span className="w-1 h-1 bg-emerald-400 rounded-full animate-pulse"></span>
              </span>
            </>
          )}
        </div>
        {data.data_source && (
          <div className="text-[10px] text-cyan-400 flex items-center justify-center gap-1">
            <span className="w-1 h-1 bg-cyan-400 rounded-full animate-pulse"></span>
            Data: {data.data_source.replace('_', ' ')}
          </div>
        )}
      </div>
    </div>
  );
};

export default EarlyWarningCard;
