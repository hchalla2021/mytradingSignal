'use client';

import React, { memo, useEffect, useState, useCallback, useRef } from 'react';
import { API_CONFIG } from '@/lib/api-config';

// ─────────────────────────────────────────────────────────────────────────────
// Types — matches /api/advanced/smart-money-flow/{symbol} response
// ─────────────────────────────────────────────────────────────────────────────
interface SmartMoneyFlowData {
  symbol: string;
  timestamp: string;
  current_price: number;
  buy_volume_pct: number;
  sell_volume_pct: number;
  order_flow_imbalance: number;
  flow_pattern: string;
  flow_description: string;
  flow_strength: number;
  vwap_value: number;
  vwap_position: string;
  vwap_deviation_pct: number;
  current_volume: number;
  avg_volume: number;
  volume_ratio: number;
  volume_strength: string;
  volume_above_threshold: boolean;
  smart_money_signal: string;
  smart_money_confidence: number;
  smart_money_strength: number;
  absorption_strength: number;
  absorption_pattern: string;
  absorption_description: string;
  wick_dominance: number;
  liquidity_pattern: string;
  liquidity_description: string;
  order_structure: string;
  structure_description: string;
  fvg_bullish: boolean;
  fvg_bearish: boolean;
  order_block_bullish: number | null;
  order_block_bearish: number | null;
  status: string;
  data_status?: string;
  candles_analyzed?: number;
  error?: string;
}

interface Props {
  symbol: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Signal config
// ─────────────────────────────────────────────────────────────────────────────
const SIG: Record<string, {
  label: string; icon: string; color: string; bg: string; border: string; bar: string;
}> = {
  STRONG_BUY:  { label: 'STRONG BUY',  icon: '\u25B2\u25B2', color: 'text-emerald-300', bg: 'bg-emerald-500/10', border: 'border-emerald-500',   bar: 'from-emerald-500 to-green-400' },
  BUY:         { label: 'BUY',         icon: '\u25B2',       color: 'text-green-300',   bg: 'bg-green-500/10',   border: 'border-green-500',     bar: 'from-green-500 to-emerald-400' },
  NEUTRAL:     { label: 'NEUTRAL',     icon: '\u25C6',       color: 'text-amber-300',   bg: 'bg-amber-500/8',    border: 'border-amber-500/60',  bar: 'from-amber-500 to-yellow-400' },
  SELL:        { label: 'SELL',        icon: '\u25BC',       color: 'text-red-300',     bg: 'bg-red-500/10',     border: 'border-red-500',       bar: 'from-red-500 to-rose-400' },
  STRONG_SELL: { label: 'STRONG SELL', icon: '\u25BC\u25BC', color: 'text-rose-300',    bg: 'bg-rose-500/10',    border: 'border-rose-500',      bar: 'from-rose-500 to-red-400' },
};

function getSig(signal: string, conf: number) {
  const s = (signal ?? 'NEUTRAL').toUpperCase().replace(' ', '_');
  if (s === 'BUY'  && conf >= 80) return SIG.STRONG_BUY;
  if (s === 'SELL' && conf >= 80) return SIG.STRONG_SELL;
  return SIG[s] || SIG.NEUTRAL;
}

function fmtPrice(v: number): string {
  if (!v) return '--';
  return '\u20B9' + v.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

function fmtVol(v: number): string {
  if (!v) return '0';
  if (v >= 10_000_000) return `${(v / 10_000_000).toFixed(1)}Cr`;
  if (v >= 100_000)    return `${(v / 100_000).toFixed(1)}L`;
  if (v >= 1_000)      return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
const InstitutionalMarketView = memo<Props>(({ symbol }) => {
  const [data, setData]       = useState<SmartMoneyFlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [flash, setFlash]     = useState(false);
  const prevSigRef = useRef<string>('');
  const abortRef   = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch(
        API_CONFIG.endpoint(`/api/advanced/smart-money-flow/${symbol}`),
        { signal: ctrl.signal, cache: 'no-store' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d: SmartMoneyFlowData = await res.json();
      if (d.status === 'ERROR' || d.status === 'NO_DATA' || d.status === 'TOKEN_EXPIRED') {
        setError(d.error || d.status);
        setLoading(false);
        return;
      }
      if (prevSigRef.current && prevSigRef.current !== d.smart_money_signal) {
        setFlash(true);
        setTimeout(() => setFlash(false), 700);
      }
      prevSigRef.current = d.smart_money_signal;
      setData(d);
      setError(null);
      setLoading(false);
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setError('Connection error');
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 5000);
    return () => { clearInterval(id); abortRef.current?.abort(); };
  }, [symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="bg-slate-900/40 border-2 border-slate-700/40 rounded-2xl p-4 animate-pulse min-h-[340px]">
      <div className="flex justify-between mb-3">
        <div className="h-5 bg-slate-800/70 rounded w-24" />
        <div className="h-5 bg-slate-800/70 rounded w-16" />
      </div>
      <div className="h-14 bg-slate-800/50 rounded-xl mb-3" />
      <div className="h-2 bg-slate-800/50 rounded-full mb-3" />
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="h-14 bg-slate-800/40 rounded-xl" />
        <div className="h-14 bg-slate-800/40 rounded-xl" />
        <div className="h-14 bg-slate-800/40 rounded-xl" />
        <div className="h-14 bg-slate-800/40 rounded-xl" />
      </div>
      <div className="h-10 bg-slate-800/30 rounded-xl" />
    </div>
  );

  // ── Error ────────────────────────────────────────────────────────────────
  if (error || !data) return (
    <div className="bg-slate-900/40 border-2 border-rose-500/30 rounded-2xl p-5 min-h-[160px] flex flex-col items-center justify-center gap-2">
      <span className="text-2xl">{'\u26A0'}</span>
      <p className="text-sm font-bold text-rose-300">{symbol}</p>
      <p className="text-xs text-rose-400/80">{error ?? 'No data available'}</p>
      <button onClick={fetchData} className="mt-2 text-[10px] px-3 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 transition-colors">
        Retry
      </button>
    </div>
  );

  // ── Derived ──────────────────────────────────────────────────────────────
  const sig  = getSig(data.smart_money_signal, data.smart_money_confidence);
  const conf = data.smart_money_confidence;
  const buyPct  = data.buy_volume_pct;
  const sellPct = data.sell_volume_pct;
  const isBull  = data.smart_money_signal.includes('BUY');
  const isBear  = data.smart_money_signal.includes('SELL');
  const isLive  = data.status === 'LIVE';

  // 5-min prediction derived from confirmations
  const flowAligns  = (isBull && buyPct > 55) || (isBear && sellPct > 55);
  const fvgConfirms = (isBull && data.fvg_bullish) || (isBear && data.fvg_bearish);
  const obConfirms  = (isBull && !!data.order_block_bullish) || (isBear && !!data.order_block_bearish);
  const vwapConfirms = (isBull && data.vwap_position === 'ABOVE_VWAP') || (isBear && data.vwap_position === 'BELOW_VWAP');
  const absConfirms = data.absorption_strength > 60;
  const confirms = [
    flowAligns   && 'Order Flow',
    fvgConfirms  && 'FVG',
    obConfirms   && 'Order Block',
    vwapConfirms && 'VWAP',
    absConfirms  && 'Absorption',
  ].filter(Boolean) as string[];
  const confirmCount = confirms.length;
  const predDir  = isBull ? 'LONG' : isBear ? 'SHORT' : 'FLAT';
  const predIcon = isBull ? '\u25B2' : isBear ? '\u25BC' : '\u2500';
  let adjConf = conf;
  if (confirmCount >= 4) adjConf = Math.min(95, Math.round(conf * 1.10));
  else if (confirmCount >= 3) adjConf = Math.min(95, Math.round(conf * 1.06));
  else if (confirmCount >= 2) adjConf = Math.min(95, Math.round(conf * 1.03));
  const flowOpp = (isBull && sellPct > 55) || (isBear && buyPct > 55);
  if (flowOpp) adjConf = Math.round(conf * 0.82);
  adjConf = Math.max(30, Math.min(95, adjConf));

  return (
    <div
      suppressHydrationWarning
      className={`
        rounded-2xl border-2 ${sig.border} ${sig.bg} overflow-hidden
        shadow-lg transition-all duration-300
        ${flash ? 'ring-2 ring-white/25 scale-[1.004]' : ''}
      `}
    >
      {/* ─── HEADER ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="rounded-lg border border-purple-500/60 bg-purple-950/30 px-2.5 py-1.5 text-sm font-bold text-white">{symbol}</span>
          {isLive && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[9px] font-bold text-emerald-400">LIVE</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {data.current_price > 0 && (
            <span suppressHydrationWarning className="text-[11px] font-bold text-white/70 tabular-nums">
              {fmtPrice(data.current_price)}
            </span>
          )}
          <span suppressHydrationWarning className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
            data.order_structure.includes('ACCUMULATION') ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' :
            data.order_structure.includes('DISTRIBUTION') ? 'border-red-500/40 bg-red-500/10 text-red-400' :
            data.order_structure.includes('ABSORPTION')   ? 'border-blue-500/40 bg-blue-500/10 text-blue-400' :
            data.order_structure.includes('LIQUIDITY')    ? 'border-orange-500/40 bg-orange-500/10 text-orange-400' :
            'border-slate-600/40 bg-slate-800/40 text-slate-400'
          }`}>
            {data.order_structure.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      <div className="px-3 py-1.5 space-y-2">

        {/* ─── MAIN SIGNAL ─────────────────────────────────────────── */}
        <div className={`rounded-xl border ${sig.border} ${sig.bg} px-3 py-2.5 text-center`}>
          <div suppressHydrationWarning className={`text-xl font-black tracking-wide ${sig.color}`}>
            {sig.icon}&nbsp;{sig.label}
          </div>
          <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{data.structure_description}</p>
        </div>

        {/* ─── CONFIDENCE ──────────────────────────────────────────── */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-widest">Signal Confidence</span>
            <span suppressHydrationWarning className={`text-sm font-black ${sig.color}`}>{conf}%</span>
          </div>
          <div className="h-2 bg-gray-900 rounded-full overflow-hidden border border-white/5">
            <div
              suppressHydrationWarning
              className={`h-full rounded-full bg-gradient-to-r ${sig.bar} transition-all duration-700`}
              style={{ width: `${conf}%` }}
            />
          </div>
          <div className="flex justify-between text-[9px] text-gray-700 mt-0.5">
            <span>0</span><span>25</span><span>50</span><span>75</span><span>95</span>
          </div>
        </div>

        {/* ─── ORDER FLOW BAR ──────────────────────────────────────── */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-widest">Order Flow</span>
            <span suppressHydrationWarning className={`text-[10px] font-bold ${
              data.flow_pattern === 'STRONG_DIRECTIONAL' ? 'text-emerald-400' :
              data.flow_pattern === 'MODERATE_IMBALANCE' ? 'text-green-400' :
              data.flow_pattern === 'SLIGHT_BIAS'        ? 'text-amber-400' :
              'text-slate-400'
            }`}>{data.flow_pattern.replace(/_/g, ' ')}</span>
          </div>
          <div className="flex items-center gap-0.5 h-5 rounded-md overflow-hidden bg-gray-950/50 border border-white/[0.08]">
            <div
              suppressHydrationWarning
              className="h-full bg-gradient-to-r from-emerald-600 to-emerald-500 transition-all duration-500 flex items-center justify-center min-w-[2px]"
              style={{ width: `${Math.max(5, Math.min(95, buyPct))}%` }}
            >
              <span className="text-[8px] font-bold text-white px-1 whitespace-nowrap">{buyPct.toFixed(0)}% Buy</span>
            </div>
            <div
              suppressHydrationWarning
              className="h-full bg-gradient-to-l from-red-600 to-red-500 transition-all duration-500 flex items-center justify-center ml-auto min-w-[2px]"
              style={{ width: `${Math.max(5, Math.min(95, sellPct))}%` }}
            >
              <span className="text-[8px] font-bold text-white px-1 whitespace-nowrap">{sellPct.toFixed(0)}% Sell</span>
            </div>
          </div>
          <p suppressHydrationWarning className="text-[9px] text-gray-600 mt-0.5">{data.flow_description}</p>
        </div>

        {/* ─── MARKET INTELLIGENCE GRID (2x3) ──────────────────────── */}
        <div className="grid grid-cols-2 gap-1.5">
          {/* VWAP Position */}
          <div className="p-2 rounded-lg bg-[#0d1117] border border-white/[0.06]">
            <p className="text-[8px] text-slate-600 uppercase tracking-wide mb-0.5">VWAP Position</p>
            <p suppressHydrationWarning className={`text-[12px] font-bold ${
              data.vwap_position === 'ABOVE_VWAP' ? 'text-emerald-400' :
              data.vwap_position === 'BELOW_VWAP' ? 'text-red-400' :
              'text-amber-400'
            }`}>
              {data.vwap_position === 'ABOVE_VWAP' ? 'ABOVE' :
               data.vwap_position === 'BELOW_VWAP' ? 'BELOW' : 'AT VWAP'}
            </p>
            <p suppressHydrationWarning className="text-[8px] text-slate-600">{fmtPrice(data.vwap_value)} ({data.vwap_deviation_pct.toFixed(2)}%)</p>
          </div>

          {/* Fair Value Gap */}
          <div className="p-2 rounded-lg bg-[#0d1117] border border-white/[0.06]">
            <p className="text-[8px] text-slate-600 uppercase tracking-wide mb-0.5">Fair Value Gap</p>
            <p suppressHydrationWarning className={`text-[12px] font-bold ${
              data.fvg_bullish ? 'text-emerald-400' :
              data.fvg_bearish ? 'text-red-400' :
              'text-slate-500'
            }`}>
              {data.fvg_bullish ? 'BULLISH GAP' : data.fvg_bearish ? 'BEARISH GAP' : 'CLOSED'}
            </p>
            <p className="text-[8px] text-slate-600">
              {data.fvg_bullish ? 'Buyers in control' :
               data.fvg_bearish ? 'Sellers in control' :
               'No unfilled gap'}
            </p>
          </div>

          {/* Absorption */}
          <div className="p-2 rounded-lg bg-[#0d1117] border border-white/[0.06]">
            <p className="text-[8px] text-slate-600 uppercase tracking-wide mb-0.5">Absorption</p>
            <div className="flex items-center gap-1.5">
              <p suppressHydrationWarning className={`text-[12px] font-bold ${
                data.absorption_strength > 70 ? 'text-blue-400' :
                data.absorption_strength > 50 ? 'text-blue-300' :
                'text-slate-500'
              }`}>{data.absorption_strength.toFixed(0)}%</p>
              <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  suppressHydrationWarning
                  className={`h-full rounded-full transition-all duration-500 ${
                    data.absorption_strength > 70 ? 'bg-blue-500' :
                    data.absorption_strength > 50 ? 'bg-blue-400' :
                    'bg-gray-600'
                  }`}
                  style={{ width: `${data.absorption_strength}%` }}
                />
              </div>
            </div>
            <p className="text-[8px] text-slate-600">{data.absorption_pattern.replace(/_/g, ' ')}</p>
          </div>

          {/* Wick Dominance / Liquidity */}
          <div className="p-2 rounded-lg bg-[#0d1117] border border-white/[0.06]">
            <p className="text-[8px] text-slate-600 uppercase tracking-wide mb-0.5">Liquidity Hunting</p>
            <div className="flex items-center gap-1.5">
              <p suppressHydrationWarning className={`text-[12px] font-bold ${
                data.wick_dominance > 70 ? 'text-orange-400' :
                data.wick_dominance > 50 ? 'text-amber-400' :
                'text-slate-500'
              }`}>{data.wick_dominance.toFixed(0)}%</p>
              <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  suppressHydrationWarning
                  className={`h-full rounded-full transition-all duration-500 ${
                    data.wick_dominance > 70 ? 'bg-orange-500' :
                    data.wick_dominance > 50 ? 'bg-amber-500' :
                    'bg-gray-600'
                  }`}
                  style={{ width: `${data.wick_dominance}%` }}
                />
              </div>
            </div>
            <p className="text-[8px] text-slate-600">{data.liquidity_pattern.replace(/_/g, ' ')}</p>
          </div>

          {/* Order Block - Bullish */}
          <div className="p-2 rounded-lg bg-[#0d1117] border border-white/[0.06]">
            <p className="text-[8px] text-slate-600 uppercase tracking-wide mb-0.5">Bullish OB</p>
            <p suppressHydrationWarning className={`text-[12px] font-bold ${data.order_block_bullish ? 'text-emerald-400' : 'text-slate-500'}`}>
              {data.order_block_bullish ? fmtPrice(data.order_block_bullish) : 'N/A'}
            </p>
            <p className="text-[8px] text-slate-600">
              {data.order_block_bullish ? 'Demand zone' : 'No demand block'}
            </p>
          </div>

          {/* Order Block - Bearish */}
          <div className="p-2 rounded-lg bg-[#0d1117] border border-white/[0.06]">
            <p className="text-[8px] text-slate-600 uppercase tracking-wide mb-0.5">Bearish OB</p>
            <p suppressHydrationWarning className={`text-[12px] font-bold ${data.order_block_bearish ? 'text-red-400' : 'text-slate-500'}`}>
              {data.order_block_bearish ? fmtPrice(data.order_block_bearish) : 'N/A'}
            </p>
            <p className="text-[8px] text-slate-600">
              {data.order_block_bearish ? 'Supply zone' : 'No supply block'}
            </p>
          </div>
        </div>

        {/* ─── VOLUME + STRENGTH STRIP ─────────────────────────────── */}
        <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-900/50 border border-slate-700/30 gap-2">
          <div className="flex items-center gap-3">
            <div>
              <span className="text-[9px] text-gray-500 font-semibold uppercase tracking-wider">Vol</span>
              <p suppressHydrationWarning className="text-[10px] font-bold text-white/80">{fmtVol(data.avg_volume)}</p>
            </div>
            <div>
              <span className="text-[9px] text-gray-500 font-semibold uppercase tracking-wider">Ratio</span>
              <p suppressHydrationWarning className={`text-[10px] font-bold ${
                data.volume_ratio > 1.3 ? 'text-emerald-400' :
                data.volume_ratio > 0.7 ? 'text-amber-400' :
                'text-red-400'
              }`}>{data.volume_ratio.toFixed(2)}x</p>
            </div>
          </div>
          <span suppressHydrationWarning className={`text-[9px] font-bold px-2 py-0.5 rounded-md border ${
            data.volume_strength === 'VERY_STRONG' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' :
            data.volume_strength === 'STRONG'      ? 'border-green-500/40 bg-green-500/10 text-green-400' :
            data.volume_strength === 'NORMAL'      ? 'border-amber-500/40 bg-amber-500/10 text-amber-400' :
            'border-slate-600/40 bg-slate-800/40 text-slate-400'
          }`}>{data.volume_strength.replace(/_/g, ' ')}</span>
          <span suppressHydrationWarning className="text-[9px] text-gray-600">{data.candles_analyzed ?? 0} candles</span>
        </div>

        {/* ─── 5-MIN PREDICTION ────────────────────────────────────── */}
        <div className="rounded-xl border border-white/[0.06] bg-[#0d1117] overflow-hidden">
          <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          <div className="px-3 pt-2.5 pb-2.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-white/50 font-bold uppercase tracking-widest">5-Min Prediction</span>
              <span suppressHydrationWarning className={`text-sm font-bold ${
                isBull ? 'text-emerald-400' : isBear ? 'text-red-400' : 'text-amber-400'
              }`}>{predIcon} {predDir}</span>
            </div>

            {/* Confidence bars */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col bg-black/30 border border-purple-500/30 rounded-lg px-2 py-1.5">
                <span className="text-[10px] text-white/40 font-bold uppercase tracking-wide">Confidence</span>
                <span suppressHydrationWarning className="text-[13px] font-black text-purple-300 mt-0.5">{adjConf}%</span>
                <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden mt-1">
                  <div
                    suppressHydrationWarning
                    className="h-full bg-gradient-to-r from-purple-500 to-purple-400 transition-all duration-300 rounded-full"
                    style={{ width: `${Math.min(100, adjConf)}%` }}
                  />
                </div>
              </div>
              <div className="flex flex-col bg-black/30 border border-emerald-500/30 rounded-lg px-2 py-1.5">
                <span className="text-[10px] text-white/40 font-bold uppercase tracking-wide">Strength</span>
                <span suppressHydrationWarning className="text-[13px] font-black text-emerald-300 mt-0.5">{data.smart_money_strength.toFixed(0)}%</span>
                <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden mt-1">
                  <div
                    suppressHydrationWarning
                    className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-300 rounded-full"
                    style={{ width: `${Math.min(100, data.smart_money_strength)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Confirmation tags */}
            <div className="rounded-lg bg-gray-900/20 px-2.5 py-2 border border-gray-700/20">
              <p className="text-[9px] text-gray-500 font-bold uppercase tracking-wide mb-1">Confirmations ({confirmCount}/5)</p>
              <div className="flex flex-wrap gap-1">
                {confirms.length > 0 ? confirms.map((c) => (
                  <span key={c} className="text-[8px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded font-medium">
                    {c}
                  </span>
                )) : (
                  <span className="text-[8px] text-gray-500">Awaiting structure formation...</span>
                )}
              </div>
            </div>

            {/* Context note */}
            <div suppressHydrationWarning className={`text-center text-[10px] font-bold rounded-lg py-1.5 border ${
              isBull ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' :
              isBear ? 'bg-red-500/10 border-red-500/30 text-red-300' :
              'bg-amber-500/10 border-amber-500/20 text-amber-300'
            }`}>
              {predDir} {predIcon} {adjConf}% Pred {confirmCount > 0 ? `- ${confirms.join(' + ')}` : '- Monitoring...'}
            </div>
          </div>
        </div>
      </div>

      {/* ─── FOOTER ─────────────────────────────────────────────────── */}
      <div className="px-3 pb-2 pt-0.5 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <div className={`w-1 h-1 rounded-full ${isLive ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`} />
          <span className="text-[9px] text-slate-600">{isLive ? 'Live' : data.status}</span>
        </div>
        <span suppressHydrationWarning className="text-[9px] text-slate-600 tabular-nums">
          {data.timestamp ? new Date(data.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--'}
        </span>
      </div>
    </div>
  );
});

InstitutionalMarketView.displayName = 'InstitutionalMarketView';
export { InstitutionalMarketView };
export default InstitutionalMarketView;

