'use client';

import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { API_CONFIG } from '@/lib/api-config';

// ─── Types ─────────────────────────────────────────────────────────────────────
interface RSIMomentumData {
  symbol: string;
  rsi_5m: number;
  rsi_15m: number;
  rsi_5m_signal: string;   // OVERSOLD | WEAK | NEUTRAL | STRONG | OVERBOUGHT
  rsi_15m_signal: string;
  rsi_momentum_status: string; // STRONG_BUY | BUY | NEUTRAL | SELL | STRONG_SELL | WATCH | WAIT
  rsi_momentum_confidence: number;
  volume_ma_ratio: number;
  price_momentum: string;  // UP | DOWN | FLAT
  current_price: number;
  last_update: string;
}

// ─── Signal Configuration ───────────────────────────────────────────────────────
type SignalKey = 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL' | 'WATCH' | 'WAIT';

interface SignalConfig {
  label: string;
  emoji: string;
  cardBorder: string;
  badgeBg: string;
  textColor: string;
  barColor: string;
  description: string;
}

const SIGNAL_CONFIG: Record<SignalKey, SignalConfig> = {
  STRONG_BUY: {
    label: 'STRONG BUY',
    emoji: '🚀',
    cardBorder: 'border-green-400/60',
    badgeBg: 'bg-green-500/25 border-green-500/50',
    textColor: 'text-green-300',
    barColor: 'bg-green-500',
    description: 'Deep Oversold — High-Conviction Long Entry',
  },
  BUY: {
    label: 'BUY',
    emoji: '📈',
    cardBorder: 'border-emerald-400/50',
    badgeBg: 'bg-emerald-500/20 border-emerald-500/40',
    textColor: 'text-emerald-300',
    barColor: 'bg-emerald-500',
    description: 'Oversold Territory — Look for Long Setup',
  },
  NEUTRAL: {
    label: 'NEUTRAL',
    emoji: '➡️',
    cardBorder: 'border-amber-500/40',
    badgeBg: 'bg-amber-500/20 border-amber-500/40',
    textColor: 'text-amber-300',
    barColor: 'bg-amber-500',
    description: 'Mid-Range — Wait for Zone Breakout',
  },
  SELL: {
    label: 'SELL',
    emoji: '📉',
    cardBorder: 'border-rose-400/50',
    badgeBg: 'bg-rose-500/20 border-rose-500/40',
    textColor: 'text-rose-300',
    barColor: 'bg-rose-500',
    description: 'Overbought Territory — Look for Short Setup',
  },
  STRONG_SELL: {
    label: 'STRONG SELL',
    emoji: '⚠️',
    cardBorder: 'border-red-400/60',
    badgeBg: 'bg-red-500/25 border-red-500/50',
    textColor: 'text-red-300',
    barColor: 'bg-red-500',
    description: 'Extreme Overbought — High-Conviction Short Entry',
  },
  WATCH: {
    label: 'WATCH',
    emoji: '👁️',
    cardBorder: 'border-blue-400/40',
    badgeBg: 'bg-blue-500/20 border-blue-500/40',
    textColor: 'text-blue-300',
    barColor: 'bg-blue-500',
    description: '5m/15m Diverging — Wait for Timeframe Alignment',
  },
  WAIT: {
    label: 'WAIT',
    emoji: '⏳',
    cardBorder: 'border-slate-500/30',
    badgeBg: 'bg-slate-500/20 border-slate-500/40',
    textColor: 'text-slate-300',
    barColor: 'bg-slate-500',
    description: 'Market Closed or Insufficient Data',
  },
};

// ─── RSI Zone helpers ──────────────────────────────────────────────────────────
function getRsiZone(rsi: number) {
  if (rsi < 20) return { label: 'EXTREME OS', textColor: 'text-green-200', bg: 'bg-green-600' };
  if (rsi < 30) return { label: 'OVERSOLD',   textColor: 'text-green-300', bg: 'bg-green-500' };
  if (rsi < 40) return { label: 'WEAK',        textColor: 'text-emerald-300', bg: 'bg-emerald-500' };
  if (rsi < 60) return { label: 'NEUTRAL',     textColor: 'text-amber-300', bg: 'bg-amber-500' };
  if (rsi < 70) return { label: 'STRONG',      textColor: 'text-rose-300', bg: 'bg-rose-500' };
  if (rsi < 80) return { label: 'OVERBOUGHT',  textColor: 'text-red-300', bg: 'bg-red-500' };
  return          { label: 'EXTREME OB',  textColor: 'text-red-200', bg: 'bg-red-600' };
}

// ─── RSI Gauge ─────────────────────────────────────────────────────────────────
const RsiGauge = React.memo(({ rsi, label }: { rsi: number; label: string }) => {
  const pct   = Math.max(0, Math.min(100, rsi));
  const zone  = getRsiZone(rsi);
  const value = Math.round(rsi);

  return (
    <div className="p-2 rounded-xl bg-black/30 border border-white/10 space-y-1.5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-white/50 uppercase tracking-widest">{label}</span>
        <div className="flex items-center gap-1.5">
          <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${zone.bg}/50 ${zone.textColor}`}>
            {zone.label}
          </span>
          <span className="text-sm font-extrabold text-white tabular-nums">{value}</span>
        </div>
      </div>

      {/* Gauge bar with zone backgrounds */}
      <div className="relative h-3 rounded-full overflow-hidden">
        {/* Zone backgrounds */}
        <div className="absolute inset-0 flex rounded-full overflow-hidden">
          <div className="w-[30%] bg-green-900/70" title="Oversold 0–30" />
          <div className="w-[10%] bg-emerald-900/50" title="Weak 30–40" />
          <div className="w-[20%] bg-gray-800/60" title="Neutral 40–60" />
          <div className="w-[10%] bg-rose-900/50" title="Strong 60–70" />
          <div className="w-[30%] bg-red-900/70" title="Overbought 70–100" />
        </div>
        {/* Active fill */}
        <div
          className={`absolute left-0 top-0 h-full rounded-r-full transition-all duration-500 opacity-80 ${zone.bg}`}
          style={{ width: `${pct}%` }}
        />
        {/* Zone separator lines at 30, 40, 60, 70 */}
        {[30, 40, 60, 70].map(lvl => (
          <div key={lvl} className="absolute top-0 h-full w-px bg-white/20" style={{ left: `${lvl}%` }} />
        ))}
        {/* Needle */}
        <div
          className="absolute top-0 h-full w-0.5 bg-white shadow-sm transition-all duration-500"
          style={{ left: `${pct}%` }}
        />
      </div>

      {/* Zone tick labels */}
      <div className="relative h-2.5">
        {[30, 40, 60, 70].map(lvl => (
          <span
            key={lvl}
            className="absolute text-[8px] text-white/30 -translate-x-1/2 font-mono"
            style={{ left: `${lvl}%` }}
          >
            {lvl}
          </span>
        ))}
      </div>
    </div>
  );
});
RsiGauge.displayName = 'RsiGauge';

// ─── Main Component ─────────────────────────────────────────────────────────────
interface RSIMomentumProps {
  symbol: string;
}

const RSI60_40MomentumCard: React.FC<RSIMomentumProps> = ({ symbol }) => {
  const [data, setData]           = useState<RSIMomentumData | null>(null);
  const [isFirstFetch, setIsFirstFetch] = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const abortRef                  = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      const res = await fetch(
        API_CONFIG.endpoint(`/api/analysis/rsi-momentum/${symbol}`),
        { signal: abortRef.current.signal }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      if (result?.rsi_5m !== undefined) {
        setData({
          symbol,
          rsi_5m:                  Number(result.rsi_5m   ?? 50),
          rsi_15m:                 Number(result.rsi_15m  ?? 50),
          rsi_5m_signal:           String(result.rsi_5m_signal          || 'NEUTRAL').toUpperCase(),
          rsi_15m_signal:          String(result.rsi_15m_signal         || 'NEUTRAL').toUpperCase(),
          rsi_momentum_status:     String(result.rsi_momentum_status    || 'WAIT').toUpperCase(),
          rsi_momentum_confidence: Number(result.rsi_momentum_confidence ?? 0),
          volume_ma_ratio:         Number(result.volume_ma_ratio         ?? 1.0),
          price_momentum:          String(result.price_momentum          || 'FLAT').toUpperCase(),
          current_price:           Number(result.current_price           ?? 0),
          last_update:             String(result.last_update             || new Date().toISOString()),
        });
        setError(null);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError('Live data unavailable');
    } finally {
      setIsFirstFetch(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 5000);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [fetchData]);

  // ── Signal resolution ──────────────────────────────────────────────────────
  // Primary: trust backend status; fallback: derive from raw RSI values
  const signalKey = useMemo((): SignalKey => {
    if (!data) return 'WAIT';
    const status = data.rsi_momentum_status;
    if (status in SIGNAL_CONFIG) return status as SignalKey;
    // Derive from raw values when backend returns unknown / WAIT / ERROR
    const r5  = data.rsi_5m;
    const r15 = data.rsi_15m;
    if (r5 < 30 && r15 < 40)       return 'STRONG_BUY';
    if (r5 < 40 && r15 < 50)       return 'BUY';
    if (r5 > 70 && r15 > 60)       return 'STRONG_SELL';
    if (r5 > 60 && r15 > 50)       return 'SELL';
    if (Math.abs(r5 - r15) > 15)   return 'WATCH';
    return 'NEUTRAL';
  }, [data]);

  const cfg        = SIGNAL_CONFIG[signalKey];
  const confidence = data?.rsi_momentum_confidence ?? 0;
  const confLabel  =
    confidence >= 85 ? 'Very High' :
    confidence >= 70 ? 'High'      :
    confidence >= 55 ? 'Moderate'  :
    confidence >= 40 ? 'Low'       : 'Very Low';

  const momentumIcon  =
    data?.price_momentum === 'UP'   ? '↑' :
    data?.price_momentum === 'DOWN' ? '↓' : '→';
  const momentumColor =
    data?.price_momentum === 'UP'   ? 'text-green-400' :
    data?.price_momentum === 'DOWN' ? 'text-red-400'   : 'text-amber-400';

  // ── 5-min Prediction ────────────────────────────────────────────────────────
  const prediction5m = useMemo(() => {
    if (!data) return { label: '—', color: 'text-slate-400', sub: '—' };
    const r5  = data.rsi_5m;
    const r15 = data.rsi_15m;
    const vol = data.volume_ma_ratio;
    const aligned = Math.abs(r5 - r15) < 10;

    if (r5 < 30) return {
      label: 'Bounce Entry',
      color: 'text-green-300',
      sub: `RSI extreme OS ${Math.round(r5)} — scalp long${vol > 1.3 ? ' + high vol' : ''}`,
    };
    if (r5 < 40 && aligned) return {
      label: 'Long Setup',
      color: 'text-emerald-300',
      sub: `Timeframes aligned oversold — entry on breakout`,
    };
    if (r5 > 70) return {
      label: 'Reversal Short',
      color: 'text-red-300',
      sub: `RSI extreme OB ${Math.round(r5)} — scalp short${vol > 1.3 ? ' + high vol' : ''}`,
    };
    if (r5 > 60 && aligned) return {
      label: 'Short Setup',
      color: 'text-rose-300',
      sub: `Timeframes aligned overbought — entry on breakdown`,
    };
    if (!aligned) return {
      label: 'Wait for Alignment',
      color: 'text-blue-300',
      sub: `5m: ${Math.round(r5)} vs 15m: ${Math.round(r15)} — diverging`,
    };
    return {
      label: 'Sideways / Range',
      color: 'text-amber-300',
      sub: `RSI ${Math.round(r5)} in neutral zone — no clear edge`,
    };
  }, [data]);

  // ── Skeleton ─────────────────────────────────────────────────────────────────
  if (isFirstFetch) {
    return (
      <div className="border-2 border-slate-500/30 rounded-2xl p-4 bg-slate-900/20 backdrop-blur-sm animate-pulse">
        <div className="h-4 bg-slate-700 rounded w-24 mb-3" />
        <div className="h-10 bg-slate-700 rounded w-full mb-3" />
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="h-16 bg-slate-700 rounded" />
          <div className="h-16 bg-slate-700 rounded" />
        </div>
        <div className="h-6 bg-slate-700 rounded w-full" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="border-2 border-red-500/30 rounded-2xl p-4 bg-red-900/10">
        <p className="text-red-300 text-xs font-bold">{symbol} — {error}</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className={`relative border-2 rounded-2xl backdrop-blur-sm shadow-xl transition-colors duration-300
      ${cfg.cardBorder} bg-gradient-to-br from-gray-900/80 via-gray-950/90 to-black/80`}>

      <div className="p-3 sm:p-4 space-y-3">

        {/* ── Header: Symbol + Signal Badge ── */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-white text-base sm:text-lg tracking-tight">{symbol}</h3>
            <span className="text-lg leading-none">{cfg.emoji}</span>
          </div>
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border ${cfg.badgeBg}`}>
            <span className={`text-xs font-extrabold tracking-wide ${cfg.textColor}`}>{cfg.label}</span>
          </div>
        </div>

        {/* ── Signal Description ── */}
        <div className="p-2.5 rounded-xl bg-black/35 border border-white/10">
          <p className={`text-xs font-semibold leading-snug ${cfg.textColor}`}>{cfg.description}</p>
          <p className="text-[10px] text-white/40 mt-0.5">RSI 60/40 Momentum • Dual-Timeframe Signal</p>
        </div>

        {/* ── RSI Gauges side by side ── */}
        <div className="grid grid-cols-2 gap-2">
          <RsiGauge rsi={data.rsi_5m}  label="5-Min Entry" />
          <RsiGauge rsi={data.rsi_15m} label="15-Min Trend" />
        </div>

        {/* ── 5-Min Prediction Panel ── */}
        <div className="p-2.5 rounded-xl bg-black/30 border border-white/10">
          <div className="text-[10px] font-bold text-white/45 uppercase tracking-widest mb-1.5">
            5-Min Prediction
          </div>
          <div className={`text-xs font-bold ${prediction5m.color}`}>{prediction5m.label}</div>
          <div className="text-[10px] text-white/40 mt-0.5 leading-tight">{prediction5m.sub}</div>
        </div>

        {/* ── Confidence Bar ── */}
        <div className="p-2 rounded-xl bg-black/25 border border-white/10">
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-[10px] font-bold text-white/50 uppercase tracking-widest">Confidence</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-white/40">{confLabel}</span>
              <span className={`text-sm font-extrabold tabular-nums ${cfg.textColor}`}>{confidence}%</span>
            </div>
          </div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden border border-white/5">
            <div
              className={`h-full rounded-full transition-all duration-700 ${cfg.barColor}`}
              style={{ width: `${confidence}%` }}
            />
          </div>
        </div>

        {/* ── Footer: Volume · Momentum · Timestamp ── */}
        <div className="flex items-center justify-between text-[10px] font-medium text-white/40 pt-1 border-t border-white/10">
          <span>Vol <span className="text-white/65 font-bold">{data.volume_ma_ratio.toFixed(2)}x</span></span>
          <span className={`font-bold ${momentumColor}`}>{momentumIcon} Price</span>
          <span className="text-white/30">
            {(() => { try { return new Date(data.last_update).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { return '--:--'; } })()}
          </span>
        </div>
      </div>

      {/* Live dot */}
      <div className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-green-400 animate-pulse shadow-md shadow-green-500/50" />
    </div>
  );
};

export default RSI60_40MomentumCard;
