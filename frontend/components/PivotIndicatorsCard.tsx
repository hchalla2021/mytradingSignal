'use client';

import React, { memo, useEffect, useState, useCallback, useRef } from 'react';
import { 
  Target, TrendingUp, TrendingDown, Activity, 
  ChevronDown, ChevronUp, Zap, Shield, AlertTriangle,
  ArrowUpRight, ArrowDownRight, Minus, Clock, RefreshCw
} from 'lucide-react';
import { API_CONFIG } from '@/lib/api-config';

// ============================================================================
// TYPES
// ============================================================================
interface PivotData {
  symbol: string;
  status: 'LIVE' | 'CACHED' | 'OFFLINE' | 'CLOSED';
  reason?: string;
  current_price: number | null;
  prev_day?: { high: number; low: number; close: number; open: number; date: string };
  timestamp: string;
  ema: { ema20: number | null; ema50: number | null; ema9?: number | null; ema21?: number | null; trend: string; price_vs_ema20: string };
  classic_pivots: {
    pivot: number | null; r1: number | null; r2: number | null; r3: number | null;
    s1: number | null; s2: number | null; s3: number | null;
    bias: string; nearest_resistance: [string, number] | null; nearest_support: [string, number] | null;
  };
  camarilla_pivots: {
    h4: number | null; h3: number | null; h2: number | null; h1: number | null;
    l1: number | null; l2: number | null; l3: number | null; l4: number | null;
    zone: string;
  };
  supertrend_10_3: { value: number | null; trend: string; signal: string; distance: number; distance_pct: number };
  supertrend_7_3: { value: number | null; trend: string; signal: string; distance: number; distance_pct: number };
  overall_bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  bullish_signals: number;
  bearish_signals: number;
  _cached?: boolean;
  _lastUpdate?: string;
}

interface Props {
  symbol: string;
  name: string;
}

// ============================================================================
// CACHE HELPERS - INSTANT LOAD
// ============================================================================
const CACHE_KEY_PREFIX = 'pivot_data_';
const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

function getCachedData(symbol: string): PivotData | null {
  if (typeof window === 'undefined') return null;
  try {
    const cached = localStorage.getItem(`${CACHE_KEY_PREFIX}${symbol}`);
    if (!cached) return null;
    const parsed = JSON.parse(cached);
    // Check if cache is still valid (24 hours)
    if (parsed._cacheTime && Date.now() - parsed._cacheTime < CACHE_EXPIRY_MS) {
      return { ...parsed, _cached: true, status: parsed.status === 'LIVE' ? 'CLOSED' : parsed.status };
    }
    return null;
  } catch {
    return null;
  }
}

function setCachedData(symbol: string, data: PivotData): void {
  if (typeof window === 'undefined') return;
  try {
    const toCache = { ...data, _cacheTime: Date.now(), _lastUpdate: new Date().toLocaleTimeString('en-IN') };
    localStorage.setItem(`${CACHE_KEY_PREFIX}${symbol}`, JSON.stringify(toCache));
  } catch { /* ignore storage errors */ }
}

// ============================================================================
// COMPONENT
// ============================================================================
const PivotIndicatorsCard = memo<Props>(({ symbol, name }) => {
  // 🔥 INSTANT LOAD: Initialize with cached data if available
  const [data, setData] = useState<PivotData | null>(() => getCachedData(symbol));
  const [loading, setLoading] = useState(() => !getCachedData(symbol)); // Only show loading if no cache
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'levels' | 'supertrend' | 'guide'>('levels');
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const [isFetching, setIsFetching] = useState(false);
  const retryCountRef = useRef(0);

  const fetchData = useCallback(async (isBackground = false) => {
    if (isFetching) return; // Prevent duplicate fetches
    
    if (!isBackground) setIsFetching(true);
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // Faster timeout
      
      const response = await fetch(
        API_CONFIG.endpoint(`/api/advanced/pivot-indicators/${symbol}`),
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);
      
      if (!response.ok) throw new Error('API Error');
      const result = await response.json();
      
      // Only update if we got valid data
      if (result && result.current_price !== null && result.current_price !== undefined) {
        const enrichedResult = {
          ...result,
          _lastUpdate: new Date().toLocaleTimeString('en-IN'),
          _cached: false
        };
        setData(enrichedResult);
        setCachedData(symbol, enrichedResult); // Save to localStorage
        setLastUpdate(new Date().toLocaleTimeString('en-IN'));
        setError(null);
        retryCountRef.current = 0;
      } else if (result.status === 'OFFLINE' && data) {
        // Keep existing data, just mark as closed
        setData(prev => prev ? { ...prev, status: 'CLOSED', _cached: true } : prev);
      }
    } catch (err) {
      // On error, keep showing cached data with CLOSED status
      if (data) {
        setData(prev => prev ? { ...prev, status: 'CLOSED', _cached: true } : prev);
      } else {
        // Try to load from cache one more time
        const cached = getCachedData(symbol);
        if (cached) {
          setData(cached);
        } else {
          retryCountRef.current++;
          if (retryCountRef.current >= 3) {
            setError('Unable to load');
          }
        }
      }
    } finally {
      setLoading(false);
      setIsFetching(false);
    }
  }, [symbol, data, isFetching]);

  // 🔥 INSTANT: Load cached data on mount, then fetch fresh data
  useEffect(() => {
    // If we already have cached data, just fetch in background
    const cached = getCachedData(symbol);
    if (cached && !data) {
      setData(cached);
      setLoading(false);
    }
    
    // Fetch fresh data
    fetchData(!!cached);
    
    // Refresh every 15 seconds
    const interval = setInterval(() => fetchData(true), 15000);
    return () => clearInterval(interval);
  }, [symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  // ============================================================================
  // HELPERS
  // ============================================================================
  const fmt = (n: number | null | undefined): string => {
    if (n === null || n === undefined) return '—';
    return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  };

  const getBiasStyle = (bias: string) => {
    if (bias === 'BULLISH' || bias === 'ABOVE' || bias === 'BUY') 
      return { bg: 'bg-emerald-500/20', border: 'border-emerald-500/50', text: 'text-emerald-400', icon: <TrendingUp className="w-4 h-4" /> };
    if (bias === 'BEARISH' || bias === 'BELOW' || bias === 'SELL') 
      return { bg: 'bg-rose-500/20', border: 'border-rose-500/50', text: 'text-rose-400', icon: <TrendingDown className="w-4 h-4" /> };
    return { bg: 'bg-slate-500/20', border: 'border-slate-500/50', text: 'text-slate-400', icon: <Activity className="w-4 h-4" /> };
  };

  const getZoneEmoji = (zone: string): string => {
    if (zone.includes('BREAKOUT') || zone.includes('UP')) return '🚀';
    if (zone.includes('SELL')) return '🔻';
    if (zone.includes('BUY')) return '🟢';
    if (zone.includes('BREAKDOWN')) return '💥';
    return '⚖️';
  };

  // ============================================================================
  // LOADING - Only shows if NO cached data available
  // ============================================================================
  if (loading && !data) {
    return (
      <div className="bg-gradient-to-br from-slate-900/80 to-slate-800/80 border border-cyan-500/30 rounded-xl p-4 shadow-xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-cyan-500/20 rounded-lg animate-pulse" />
          <div className="h-6 w-32 bg-slate-700/50 rounded animate-pulse" />
        </div>
        <div className="space-y-3">
          <div className="h-16 bg-slate-700/30 rounded-lg animate-pulse" />
          <div className="grid grid-cols-3 gap-2">
            {[1,2,3].map(i => <div key={i} className="h-12 bg-slate-700/30 rounded-lg animate-pulse" />)}
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // OFFLINE STATE - Only if NO data at all (not even cached)
  // ============================================================================
  if (!data || (data.status === 'OFFLINE' && !data.current_price) || error) {
    return (
      <div className="bg-gradient-to-br from-slate-900/80 to-slate-800/80 border border-slate-600/50 rounded-xl p-4 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-slate-700/50 rounded-lg">
              <Target className="w-5 h-5 text-slate-400" />
            </div>
            <h3 className="font-bold text-slate-200">{name}</h3>
          </div>
          <span className="px-2 py-1 text-[10px] font-bold rounded bg-amber-900/40 text-amber-300 border border-amber-600/40">
            OFFLINE
          </span>
        </div>
        
        <div className="text-center py-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-800/50 border-2 border-dashed border-slate-600 flex items-center justify-center">
            <Clock className="w-8 h-8 text-slate-500" />
          </div>
          <p className="text-slate-400 text-sm mb-2">Market data not available</p>
          <p className="text-slate-500 text-xs mb-4">
            {data?.reason === 'NO_TOKEN' ? 'Zerodha login required' : 
             data?.reason === 'TIMEOUT' ? 'Connection timed out' : 
             'Start backend server to load data'}
          </p>
          <button 
            onClick={() => fetchData(false)}
            disabled={isFetching}
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-700/50 hover:bg-slate-600/50 rounded-lg text-sm text-slate-300 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
            {isFetching ? 'Loading...' : 'Retry'}
          </button>
        </div>
      </div>
    );
  }

  const { current_price, classic_pivots, camarilla_pivots, ema, supertrend_10_3, supertrend_7_3, overall_bias } = data;
  const biasStyle = getBiasStyle(overall_bias);
  const isClosed = data.status === 'CLOSED' || data.status === 'CACHED' || data._cached;

  // ============================================================================
  // MAIN RENDER
  // ============================================================================
  return (
    <div className="bg-gradient-to-br from-slate-900/90 to-slate-800/90 border border-cyan-500/40 rounded-xl overflow-hidden shadow-xl shadow-cyan-900/20 hover:shadow-cyan-800/30 transition-all duration-300">
      
      {/* ===== HEADER ===== */}
      <div className="bg-gradient-to-r from-cyan-900/30 to-slate-800/50 px-4 py-3 border-b border-cyan-500/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${biasStyle.bg} border ${biasStyle.border}`}>
              <Target className={`w-5 h-5 ${biasStyle.text}`} />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm sm:text-base">{name}</h3>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`w-1.5 h-1.5 rounded-full ${
                  data.status === 'LIVE' ? 'bg-emerald-400 animate-pulse' : 
                  isClosed ? 'bg-amber-400' : 'bg-blue-400'
                }`} />
                <span className="text-[10px] text-slate-400 font-medium">
                  {data.status === 'LIVE' ? 'Live Data' : isClosed ? 'Last Session' : 'Cached'}
                </span>
                {(lastUpdate || data._lastUpdate) && (
                  <span className="text-[9px] text-slate-500">
                    • {lastUpdate || data._lastUpdate}
                  </span>
                )}
                {isFetching && (
                  <RefreshCw className="w-3 h-3 text-cyan-400 animate-spin" />
                )}
              </div>
            </div>
          </div>
          
          {/* Overall Bias Badge */}
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg ${biasStyle.bg} border ${biasStyle.border}`}>
            {biasStyle.icon}
            <span className={`text-sm font-bold ${biasStyle.text}`}>{overall_bias}</span>
          </div>
        </div>
      </div>

      {/* ===== PRICE & QUICK STATS ===== */}
      <div className="px-4 py-3 bg-slate-800/30 border-b border-slate-700/50">
        {/* Last Session Banner - Shows when market is closed */}
        {isClosed && (
          <div className="mb-3 px-3 py-1.5 bg-amber-900/20 border border-amber-500/30 rounded-lg flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[10px] text-amber-300 font-medium">
              Last session data • Pivot levels ready for next trading day
            </span>
          </div>
        )}
        
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] text-slate-500 font-medium mb-0.5">CURRENT PRICE</p>
            <p className="text-2xl font-bold text-white tracking-tight">{fmt(current_price)}</p>
          </div>
          
          <div className="grid grid-cols-2 gap-4 text-right">
            <div>
              <p className="text-[10px] text-slate-500 mb-0.5">EMA 20</p>
              <p className={`text-sm font-bold ${ema.price_vs_ema20 === 'ABOVE' ? 'text-emerald-400' : 'text-rose-400'}`}>
                {fmt(ema.ema20)}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 mb-0.5">PIVOT</p>
              <p className={`text-sm font-bold ${classic_pivots.bias === 'BULLISH' ? 'text-emerald-400' : 'text-rose-400'}`}>
                {fmt(classic_pivots.pivot)}
              </p>
            </div>
          </div>
        </div>
        
        {/* Bias Explanation */}
        <div className={`mt-3 p-2 rounded-lg ${biasStyle.bg} border ${biasStyle.border}`}>
          <p className="text-[11px] text-slate-200">
            {overall_bias === 'BULLISH' ? (
              <>💡 <span className="text-emerald-300 font-semibold">Price above Pivot = Bullish.</span> Look for BUY entries near support levels. R1/R2 are profit targets.</>
            ) : overall_bias === 'BEARISH' ? (
              <>💡 <span className="text-rose-300 font-semibold">Price below Pivot = Bearish.</span> Look for SELL entries near resistance. S1/S2 are profit targets.</>
            ) : (
              <>💡 <span className="text-slate-300 font-semibold">Price near Pivot = Neutral.</span> Wait for clear direction before trading.</>
            )}
          </p>
        </div>
      </div>

      {/* ===== TAB NAVIGATION ===== */}
      <div className="flex border-b border-slate-700/50">
        {[
          { id: 'levels', label: '📊 Pivot Levels', icon: Target },
          { id: 'supertrend', label: '⚡ Supertrend', icon: Zap },
          { id: 'guide', label: '📚 How to Use', icon: Shield },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${
              activeTab === tab.id
                ? 'bg-cyan-900/30 text-cyan-300 border-b-2 border-cyan-400'
                : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800/50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ===== TAB CONTENT ===== */}
      <div className="p-4">
        
        {/* LEVELS TAB */}
        {activeTab === 'levels' && (
          <div className="space-y-4">
            {/* Classic Pivot Levels - Visual Chart */}
            <div>
              <h4 className="text-xs font-semibold text-slate-300 mb-3 flex items-center gap-2">
                <span className="w-2 h-2 bg-cyan-400 rounded-full"></span>
                CLASSIC PIVOT LEVELS
              </h4>
              
              {/* Visual Level Display */}
              <div className="relative bg-slate-800/50 rounded-xl p-3 border border-slate-700/50">
                {/* Resistance Levels */}
                <div className="space-y-2 mb-4">
                  <p className="text-[9px] text-cyan-400 font-extrabold mb-2">RESISTANCE LEVELS</p>
                  {[
                    { label: 'R3', value: classic_pivots.r3, color: 'rose', intensity: 'high' },
                    { label: 'R2', value: classic_pivots.r2, color: 'rose', intensity: 'medium' },
                    { label: 'R1', value: classic_pivots.r1, color: 'rose', intensity: 'low' },
                  ].map(level => (
                    <div key={level.label} className="flex items-center gap-2">
                      <span className={`w-8 text-[10px] font-bold text-${level.color}-400`}>{level.label}</span>
                      <div className="flex-1 h-6 bg-gradient-to-r from-rose-900/30 to-transparent rounded relative overflow-hidden">
                        <div 
                          className={`absolute inset-y-0 left-0 bg-gradient-to-r from-rose-500/${level.intensity === 'high' ? '40' : level.intensity === 'medium' ? '30' : '20'} to-transparent`}
                          style={{ width: '60%' }}
                        />
                        {current_price && level.value && current_price >= level.value && (
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-emerald-400 font-bold">✓ CROSSED</span>
                        )}
                      </div>
                      <span className="w-20 text-right text-sm font-bold text-white">{fmt(level.value)}</span>
                      <span className={`text-[9px] w-16 text-right ${current_price && level.value ? (level.value > current_price ? 'text-rose-400' : 'text-emerald-400') : 'text-slate-500'}`}>
                        {current_price && level.value ? (level.value > current_price ? `↑${fmt(level.value - current_price)}` : `↓${fmt(current_price - level.value)}`) : '—'}
                      </span>
                    </div>
                  ))}
                </div>
                
                {/* Pivot Line */}
                <div className="flex items-center gap-2 py-2 border-y border-cyan-500/30 bg-cyan-900/20 rounded-lg px-2 my-3">
                  <span className="text-[11px] font-extrabold text-cyan-300">PIVOT</span>
                  <div className="flex-1 h-1 bg-cyan-500/50 rounded" />
                  <span className="text-lg font-bold text-cyan-300">{fmt(classic_pivots.pivot)}</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${classic_pivots.bias === 'BULLISH' ? 'bg-emerald-900/40 text-emerald-400' : 'bg-rose-900/40 text-rose-400'}`}>
                    {classic_pivots.bias === 'BULLISH' ? '📈 ABOVE' : '📉 BELOW'}
                  </span>
                </div>
                
                {/* Support Levels */}
                <div className="space-y-2 mt-4">
                  <p className="text-[9px] text-emerald-400 font-extrabold mb-2">SUPPORT LEVELS</p>
                  {[
                    { label: 'S1', value: classic_pivots.s1, color: 'emerald', intensity: 'low' },
                    { label: 'S2', value: classic_pivots.s2, color: 'emerald', intensity: 'medium' },
                    { label: 'S3', value: classic_pivots.s3, color: 'emerald', intensity: 'high' },
                  ].map(level => (
                    <div key={level.label} className="flex items-center gap-2">
                      <span className={`w-8 text-[10px] font-bold text-${level.color}-400`}>{level.label}</span>
                      <div className="flex-1 h-6 bg-gradient-to-r from-emerald-900/30 to-transparent rounded relative overflow-hidden">
                        <div 
                          className={`absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500/${level.intensity === 'high' ? '40' : level.intensity === 'medium' ? '30' : '20'} to-transparent`}
                          style={{ width: '60%' }}
                        />
                        {current_price && level.value && current_price <= level.value && (
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-rose-400 font-bold">✓ CROSSED</span>
                        )}
                      </div>
                      <span className="w-20 text-right text-sm font-bold text-white">{fmt(level.value)}</span>
                      <span className={`text-[9px] w-16 text-right ${current_price && level.value ? (level.value < current_price ? 'text-emerald-400' : 'text-rose-400') : 'text-slate-500'}`}>
                        {current_price && level.value ? (level.value < current_price ? `↓${fmt(current_price - level.value)}` : `↑${fmt(level.value - current_price)}`) : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            
            {/* Camarilla Quick View */}
            <div>
              <h4 className="text-xs font-semibold text-slate-300 mb-2 flex items-center gap-2">
                <span className="w-2 h-2 bg-purple-400 rounded-full"></span>
                CAMARILLA ZONES
                <span className="text-[9px] text-slate-500 font-normal">(Intraday Reversals)</span>
              </h4>
              
              <div className="bg-slate-800/40 rounded-lg p-3 border border-purple-500/20">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-slate-400">Current Zone:</span>
                  <span className={`text-sm font-bold px-2 py-0.5 rounded ${
                    camarilla_pivots.zone.includes('BUY') ? 'bg-emerald-900/40 text-emerald-300' :
                    camarilla_pivots.zone.includes('SELL') ? 'bg-rose-900/40 text-rose-300' :
                    camarilla_pivots.zone.includes('BREAK') ? 'bg-orange-900/40 text-orange-300' :
                    'bg-slate-700/50 text-slate-300'
                  }`}>
                    {getZoneEmoji(camarilla_pivots.zone)} {camarilla_pivots.zone.replace(/_/g, ' ')}
                  </span>
                </div>
                
                <div className="grid grid-cols-4 gap-1.5 text-center">
                  <div className="bg-rose-900/20 rounded p-1.5 border border-rose-500/20">
                    <p className="text-[9px] text-rose-400 font-bold">H3</p>
                    <p className="text-[11px] text-white font-semibold">{fmt(camarilla_pivots.h3)}</p>
                  </div>
                  <div className="bg-rose-900/30 rounded p-1.5 border border-rose-500/30">
                    <p className="text-[9px] text-rose-400 font-bold">H4</p>
                    <p className="text-[11px] text-white font-semibold">{fmt(camarilla_pivots.h4)}</p>
                  </div>
                  <div className="bg-emerald-900/20 rounded p-1.5 border border-emerald-500/20">
                    <p className="text-[9px] text-emerald-400 font-bold">L3</p>
                    <p className="text-[11px] text-white font-semibold">{fmt(camarilla_pivots.l3)}</p>
                  </div>
                  <div className="bg-emerald-900/30 rounded p-1.5 border border-emerald-500/30">
                    <p className="text-[9px] text-emerald-400 font-bold">L4</p>
                    <p className="text-[11px] text-white font-semibold">{fmt(camarilla_pivots.l4)}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SUPERTREND TAB */}
        {activeTab === 'supertrend' && (
          <div className="space-y-4">
            {/* Supertrend Cards */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Supertrend (10,3)', data: supertrend_10_3, desc: 'More reliable signals' },
                { label: 'Supertrend (7,3)', data: supertrend_7_3, desc: 'Faster but more noise' },
              ].map(st => {
                const style = getBiasStyle(st.data.trend);
                return (
                  <div key={st.label} className={`rounded-xl p-3 border ${style.border} ${style.bg}`}>
                    <p className="text-[10px] text-slate-400 font-medium mb-1">{st.label}</p>
                    <p className="text-xl font-bold text-white mb-1">{fmt(st.data.value)}</p>
                    
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                        st.data.trend === 'BULLISH' ? 'bg-emerald-800/50 text-emerald-300' : 'bg-rose-800/50 text-rose-300'
                      }`}>
                        {st.data.trend === 'BULLISH' ? '📈' : '📉'} {st.data.trend}
                      </span>
                    </div>
                    
                    <div className="pt-2 border-t border-slate-600/30">
                      <p className="text-[9px] text-slate-400"><span className="text-cyan-300 font-extrabold">Distance:</span> <span className="text-white font-semibold">{st.data.distance_pct}%</span></p>
                      {st.data.signal !== 'HOLD' && (
                        <p className={`text-[10px] font-bold mt-1 ${st.data.signal === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {st.data.signal === 'BUY' ? '🚀 FRESH BUY SIGNAL!' : '⚠️ FRESH SELL SIGNAL!'}
                        </p>
                      )}
                    </div>
                    
                    <p className="text-[9px] text-slate-500 mt-2 italic">{st.desc}</p>
                  </div>
                );
              })}
            </div>
            
            {/* Combined Signal */}
            <div className={`p-3 rounded-xl border ${
              supertrend_10_3.trend === supertrend_7_3.trend
                ? supertrend_10_3.trend === 'BULLISH' 
                  ? 'bg-emerald-900/20 border-emerald-500/30' 
                  : 'bg-rose-900/20 border-rose-500/30'
                : 'bg-amber-900/20 border-amber-500/30'
            }`}>
              <h4 className="text-xs font-bold text-white mb-2">
                {supertrend_10_3.trend === supertrend_7_3.trend ? '✅ ALIGNED SIGNALS' : '⚠️ CONFLICTING SIGNALS'}
              </h4>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                {supertrend_10_3.trend === supertrend_7_3.trend ? (
                  supertrend_10_3.trend === 'BULLISH' ? (
                    <>Both Supertrends show <span className="text-emerald-400 font-bold">BULLISH</span> trend. Price is above the Supertrend line - this is a good zone for BUY trades.</>
                  ) : (
                    <>Both Supertrends show <span className="text-rose-400 font-bold">BEARISH</span> trend. Price is below the Supertrend line - this is a good zone for SELL trades.</>
                  )
                ) : (
                  <>Supertrends are giving <span className="text-amber-400 font-bold">MIXED</span> signals. Wait for both to align before taking trades for higher probability.</>
                )}
              </p>
            </div>
            
            {/* EMA Trend */}
            <div className="bg-slate-800/40 rounded-lg p-3 border border-slate-600/30">
              <h4 className="text-xs font-bold text-slate-300 mb-2">📊 EMA TREND</h4>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div>
                    <p className="text-[9px] text-slate-500">EMA 20</p>
                    <p className="text-sm font-bold text-white">{fmt(ema.ema20)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-slate-500">EMA 50</p>
                    <p className="text-sm font-bold text-white">{fmt(ema.ema50)}</p>
                  </div>
                </div>
                <span className={`text-xs font-bold px-2 py-1 rounded ${
                  ema.trend === 'BULLISH' ? 'bg-emerald-900/40 text-emerald-400' : 
                  ema.trend === 'BEARISH' ? 'bg-rose-900/40 text-rose-400' : 
                  'bg-slate-700/50 text-slate-400'
                }`}>
                  {ema.trend === 'BULLISH' ? '📈 EMA20 > EMA50' : ema.trend === 'BEARISH' ? '📉 EMA20 < EMA50' : 'NEUTRAL'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* GUIDE TAB */}
        {activeTab === 'guide' && (
          <div className="space-y-4">
            {/* Beginner Guide */}
            <div className="bg-gradient-to-br from-cyan-900/20 to-slate-800/30 rounded-xl p-4 border border-cyan-500/20">
              <h4 className="text-sm font-semibold text-cyan-300 mb-3">🎯 How to Trade with Pivot Points</h4>
              
              <div className="space-y-3 text-[11px] text-slate-300">
                <div className="flex gap-2">
                  <span className="text-emerald-400 font-bold shrink-0">1.</span>
                  <p><span className="font-bold text-white">Check Bias:</span> Price ABOVE <span className="font-extrabold text-cyan-300">PIVOT</span> = Bullish (buy dips). Price BELOW <span className="font-extrabold text-cyan-300">PIVOT</span> = Bearish (sell rallies).</p>
                </div>
                <div className="flex gap-2">
                  <span className="text-emerald-400 font-bold shrink-0">2.</span>
                  <p><span className="font-bold text-white">Entry Points:</span> In uptrend, buy near S1/<span className="font-extrabold text-cyan-300">PIVOT</span>. In downtrend, sell near R1/<span className="font-extrabold text-cyan-300">PIVOT</span>.</p>
                </div>
                <div className="flex gap-2">
                  <span className="text-emerald-400 font-bold shrink-0">3.</span>
                  <p><span className="font-bold text-white">Targets:</span> Bullish = R1, R2 are targets. Bearish = S1, S2 are targets.</p>
                </div>
                <div className="flex gap-2">
                  <span className="text-emerald-400 font-bold shrink-0">4.</span>
                  <p><span className="font-bold text-white">Stop Loss:</span> Place below the previous <span className="font-extrabold text-emerald-300">SUPPORT</span> (for buys) or above <span className="font-extrabold text-rose-300">RESISTANCE</span> (for sells).</p>
                </div>
              </div>
            </div>
            
            <div className="bg-gradient-to-br from-purple-900/20 to-slate-800/30 rounded-xl p-4 border border-purple-500/20">
              <h4 className="text-sm font-semibold text-purple-300 mb-3">⚡ Supertrend Trading</h4>
              
              <div className="space-y-2 text-[11px] text-slate-300">
                <p>• <span className="text-emerald-400 font-semibold">Green/Bullish:</span> Price is ABOVE Supertrend = Uptrend. Only take LONG trades.</p>
                <p>• <span className="text-rose-400 font-semibold">Red/Bearish:</span> Price is BELOW Supertrend = Downtrend. Only take SHORT trades.</p>
                <p>• <span className="text-amber-400 font-semibold">Signal Change:</span> When color flips = potential trend reversal. Watch for confirmation.</p>
              </div>
            </div>
            
            <div className="bg-slate-800/40 rounded-lg p-3 border border-slate-600/30">
              <p className="text-[10px] text-slate-400 text-center">
                💡 <span className="text-white font-semibold">Pro Tip:</span> Combine pivot levels with Supertrend. Trade in the direction of Supertrend, using pivots for entry/exit points.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

PivotIndicatorsCard.displayName = 'PivotIndicatorsCard';

export default PivotIndicatorsCard;
