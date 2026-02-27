'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { TrendingUp, TrendingDown, Minus, Target, Layers, ChevronRight } from 'lucide-react';
import { API_CONFIG } from '@/lib/api-config';

// ─── Types ──────────────────────────────────────────────────────────────────────
type CamZone =
  | 'BREAKOUT_UP' | 'SELL_ZONE' | 'NEUTRAL_HIGH'
  | 'RANGE_BOUND'
  | 'NEUTRAL_LOW' | 'BUY_ZONE' | 'BREAKDOWN';
type CPRClass = 'NARROW' | 'WIDE';
type Bias     = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
type Signal   = 'STRONG BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG SELL';

interface CamarillaCPRData {
  symbol: string;
  status: 'LIVE' | 'CACHED' | 'OFFLINE';
  price: number;
  changePercent: number;
  // Camarilla key levels
  h4: number;
  h3: number;
  l3: number;
  l4: number;
  camZone: CamZone;
  // CPR levels (computed from classic pivot + prev-day high/low)
  cprPivot: number;
  cprTC: number;
  cprBC: number;
  cprWidth: number;
  cprWidthPct: number;
  cprClassification: CPRClass;
  // Bias & confirmations
  overallBias: Bias;
  emaTrend: string;
  bullishSignals: number;
  bearishSignals: number;
}

interface CamarillaCPRCardProps {
  symbol: string;
}

// ─── Zone plain-English labels ──────────────────────────────────────────────────
const ZONE_LABEL: Record<CamZone, { label: string; emoji: string; color: string }> = {
  BREAKOUT_UP:  { label: 'Breakout Zone — Above H4',   emoji: '🚀', color: 'text-emerald-300' },
  SELL_ZONE:    { label: 'Resistance Zone — H3 to H4', emoji: '🔴', color: 'text-red-300'     },
  NEUTRAL_HIGH: { label: 'Upper Range — H2 to H3',     emoji: '🟡', color: 'text-yellow-300'  },
  RANGE_BOUND:  { label: 'Inside Range — Core Zone',   emoji: '⚪', color: 'text-slate-300'   },
  NEUTRAL_LOW:  { label: 'Lower Range — L3 to L2',     emoji: '🟡', color: 'text-yellow-300'  },
  BUY_ZONE:     { label: 'Support Zone — L4 to L3',    emoji: '🟢', color: 'text-green-300'   },
  BREAKDOWN:    { label: 'Breakdown Zone — Below L4',  emoji: '💥', color: 'text-red-400'     },
};

// ─── Signal engine ──────────────────────────────────────────────────────────────
// Camarilla logic: narrow CPR = trend day (ride direction); wide CPR = range day (fade extremes)
function getSignal(d: CamarillaCPRData): Signal {
  const { camZone, cprClassification, overallBias, changePercent } = d;
  const isNarrow  = cprClassification === 'NARROW';
  const isBullish = overallBias === 'BULLISH';
  const isBearish = overallBias === 'BEARISH';

  if (camZone === 'BREAKOUT_UP')
    return isBullish || changePercent > 0.5 ? 'STRONG BUY' : 'BUY';
  if (camZone === 'BREAKDOWN')
    return isBearish || changePercent < -0.5 ? 'STRONG SELL' : 'SELL';

  if (isNarrow) {
    // Narrow CPR = trending day: price at H3/H4 = bullish, at L4/L3 = bearish
    if (camZone === 'SELL_ZONE')    return isBullish ? 'STRONG BUY' : 'BUY';
    if (camZone === 'NEUTRAL_HIGH') return isBullish ? 'BUY' : 'NEUTRAL';
    if (camZone === 'BUY_ZONE')     return isBearish ? 'STRONG SELL' : 'SELL';
    if (camZone === 'NEUTRAL_LOW')  return isBearish ? 'SELL' : 'NEUTRAL';
  } else {
    // Wide CPR = range day: fade the extremes (sell at resistance, buy at support)
    if (camZone === 'SELL_ZONE')    return 'SELL';
    if (camZone === 'BUY_ZONE')     return 'BUY';
    if (camZone === 'NEUTRAL_HIGH') return isBearish ? 'SELL' : 'NEUTRAL';
    if (camZone === 'NEUTRAL_LOW')  return isBullish ? 'BUY'  : 'NEUTRAL';
  }
  return 'NEUTRAL';
}

// ─── Confidence engine ──────────────────────────────────────────────────────────
const BULLISH_ZONES: CamZone[] = ['BREAKOUT_UP', 'SELL_ZONE', 'NEUTRAL_HIGH'];
const BEARISH_ZONES: CamZone[] = ['BREAKDOWN',   'BUY_ZONE',  'NEUTRAL_LOW'];

function getConfidence(d: CamarillaCPRData): number {
  let conf = 35;

  // Zone clarity (0–20)
  const zoneBonus: Partial<Record<CamZone, number>> = {
    BREAKOUT_UP: 20, BREAKDOWN: 20,
    SELL_ZONE: 12,   BUY_ZONE: 12,
    NEUTRAL_HIGH: 6, NEUTRAL_LOW: 6,
    RANGE_BOUND: 3,
  };
  conf += zoneBonus[d.camZone] ?? 3;

  // CPR type (0–10)
  conf += d.cprClassification === 'NARROW' ? 10 : 3;

  // Bias alignment (−4 to +8)
  if (BULLISH_ZONES.includes(d.camZone) && d.overallBias === 'BULLISH') conf += 8;
  else if (BEARISH_ZONES.includes(d.camZone) && d.overallBias === 'BEARISH') conf += 8;
  else if (d.overallBias !== 'NEUTRAL') conf += 2;
  else if (BULLISH_ZONES.includes(d.camZone) && d.overallBias === 'BEARISH') conf -= 4;
  else if (BEARISH_ZONES.includes(d.camZone) && d.overallBias === 'BULLISH') conf -= 4;

  // Momentum alignment (−4 to +5)
  const zoneBull = BULLISH_ZONES.includes(d.camZone);
  const zoneBear = BEARISH_ZONES.includes(d.camZone);
  if ((zoneBull && d.changePercent > 0.3) || (zoneBear && d.changePercent < -0.3)) conf += 5;
  else if ((zoneBull && d.changePercent < -0.3) || (zoneBear && d.changePercent > 0.3)) conf -= 4;

  // Live status bonus
  if (d.status === 'LIVE') conf += 2;

  return Math.max(35, Math.min(85, Math.round(conf)));
}

// ─── 5-Min Prediction engine ────────────────────────────────────────────────────
type PredLabel = 'STRONG UP' | 'LIKELY UP' | 'NEUTRAL' | 'LIKELY DOWN' | 'STRONG DOWN';

function computePrediction(d: CamarillaCPRData) {
  let score = 0;

  // Factor 1: Camarilla zone position (±3)
  const zoneScores: Partial<Record<CamZone, number>> = {
    BREAKOUT_UP: 3, SELL_ZONE: 2, NEUTRAL_HIGH: 1,
    RANGE_BOUND: 0, NEUTRAL_LOW: -1, BUY_ZONE: -2, BREAKDOWN: -3,
  };
  score += zoneScores[d.camZone] ?? 0;

  // Factor 2: CPR type amplifies signal (±2)
  const isZoneBull = BULLISH_ZONES.includes(d.camZone);
  const isZoneBear = BEARISH_ZONES.includes(d.camZone);
  if (d.cprClassification === 'NARROW') score += isZoneBull ? 2 : isZoneBear ? -2 : 0;

  // Factor 3: Overall market bias (±2)
  if (d.overallBias === 'BULLISH') score += 2;
  else if (d.overallBias === 'BEARISH') score -= 2;

  // Factor 4: EMA trend alignment (±2)
  if (d.emaTrend === 'BULLISH') score += 2;
  else if (d.emaTrend === 'BEARISH') score -= 2;

  // Factor 5: Price momentum change% (±2)
  if      (d.changePercent >  0.5) score += 2;
  else if (d.changePercent >  0.1) score += 1;
  else if (d.changePercent < -0.5) score -= 2;
  else if (d.changePercent < -0.1) score -= 1;

  // Normalize: max = 3+2+2+2+2 = 11
  const MAX = 11;
  const upPct   = Math.round(Math.max(5, Math.min(95, ((score + MAX) / (2 * MAX)) * 100)));
  const downPct = 100 - upPct;

  let label: PredLabel;
  let color: string;
  if      (score >=  7) { label = 'STRONG UP';   color = 'text-emerald-300'; }
  else if (score >=  3) { label = 'LIKELY UP';   color = 'text-green-300';   }
  else if (score >= -2) { label = 'NEUTRAL';     color = 'text-yellow-300';  }
  else if (score >= -6) { label = 'LIKELY DOWN'; color = 'text-orange-300';  }
  else                  { label = 'STRONG DOWN'; color = 'text-red-300';     }

  return { label, color, upPct, downPct, score };
}

// ─── Signal visual config ───────────────────────────────────────────────────────
type IconComp = React.ComponentType<{ className?: string; strokeWidth?: number }>;
const SIGNAL_CONFIG: Record<Signal, { bg: string; border: string; text: string; glow: string; icon: IconComp }> = {
  'STRONG BUY':  { bg: 'from-emerald-900/30 to-emerald-950/20', border: 'border-emerald-500/50', text: 'text-emerald-300', glow: 'shadow-emerald-500/20', icon: TrendingUp   },
  'BUY':         { bg: 'from-green-900/25 to-green-950/15',     border: 'border-green-500/40',   text: 'text-green-300',   glow: 'shadow-green-500/15',   icon: TrendingUp   },
  'NEUTRAL':     { bg: 'from-slate-900/30 to-slate-950/20',     border: 'border-slate-500/30',   text: 'text-slate-300',   glow: 'shadow-slate-500/10',   icon: Minus        },
  'SELL':        { bg: 'from-orange-900/25 to-orange-950/15',   border: 'border-orange-500/40',  text: 'text-orange-300',  glow: 'shadow-orange-500/15',  icon: TrendingDown },
  'STRONG SELL': { bg: 'from-red-900/30 to-red-950/20',         border: 'border-red-500/50',     text: 'text-red-300',     glow: 'shadow-red-500/20',     icon: TrendingDown },
};

// ─── Component ─────────────────────────────────────────────────────────────────
const CamarillaCPRCard: React.FC<CamarillaCPRCardProps> = ({ symbol }) => {
  const [data, setData]       = useState<CamarillaCPRData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const abortRef              = useRef<AbortController | null>(null);
  const isFirstFetch          = useRef(true);

  const fetchData = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setError(null);
      const res = await fetch(
        API_CONFIG.endpoint(`/api/advanced/pivot-indicators/${symbol}`),
        { signal: controller.signal }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const raw = await res.json();
      if (raw.status === 'ERROR' || raw.status === 'OFFLINE') {
        throw new Error(raw.reason || 'Service offline');
      }

      const cam  = raw.camarilla_pivots ?? {};
      const cls  = raw.classic_pivots  ?? {};
      const ema  = raw.ema             ?? {};
      const prev = raw.prev_day        ?? {};

      // Compute CPR: TC = (Pivot + prevHigh)/2, BC = (Pivot + prevLow)/2
      const cprPivot    = Number(cls.pivot ?? 0);
      const cprTC       = cprPivot > 0 ? (cprPivot + Number(prev.high ?? cprPivot)) / 2 : 0;
      const cprBC       = cprPivot > 0 ? (cprPivot + Number(prev.low  ?? cprPivot)) / 2 : 0;
      const cprWidth    = parseFloat((cprTC - cprBC).toFixed(2));
      const cprWidthPct = cprPivot > 0 ? parseFloat(((cprWidth / cprPivot) * 100).toFixed(3)) : 0;
      // NARROW = tight CPR ↔ trending day; WIDE = loose ↔ range day
      const cprClassification: CPRClass = cprWidthPct < 0.3 ? 'NARROW' : 'WIDE';

      setData({
        symbol,
        status:         raw.status      ?? 'CACHED',
        price:          Number(raw.current_price  ?? 0),
        changePercent:  Number(raw.change_percent ?? 0),
        h4: Number(cam.h4 ?? 0),
        h3: Number(cam.h3 ?? 0),
        l3: Number(cam.l3 ?? 0),
        l4: Number(cam.l4 ?? 0),
        camZone: (cam.zone as CamZone) ?? 'RANGE_BOUND',
        cprPivot, cprTC, cprBC, cprWidth, cprWidthPct, cprClassification,
        overallBias:    (raw.overall_bias   as Bias) ?? 'NEUTRAL',
        emaTrend:       ema.trend ?? 'MIXED',
        bullishSignals: Number(raw.bullish_signals ?? 0),
        bearishSignals: Number(raw.bearish_signals ?? 0),
      });

      if (isFirstFetch.current) {
        setLoading(false);
        isFirstFetch.current = false;
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : 'Connection error';
      setError(msg);
      if (isFirstFetch.current) {
        setLoading(false);
        isFirstFetch.current = false;
      }
    }
  }, [symbol]);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 5000);
    return () => { clearInterval(iv); abortRef.current?.abort(); };
  }, [fetchData]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-2 border-slate-700/40 rounded-xl p-4 animate-pulse">
        <div className="h-5 bg-slate-700/50 rounded w-28 mb-3" />
        <div className="h-14 bg-slate-700/50 rounded mb-3" />
        <div className="h-4 bg-slate-700/50 rounded w-20 mb-2" />
        <div className="h-28 bg-slate-700/50 rounded" />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error || !data) {
    return (
      <div className="bg-gradient-to-br from-red-900/20 to-slate-900/50 border-2 border-red-500/30 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Target className="w-4 h-4 text-red-400" />
          <span className="text-sm font-bold text-red-300">{symbol} — CPR / Camarilla</span>
        </div>
        <p className="text-xs text-red-400 mb-2">{error ?? 'No data available'}</p>
        <button onClick={fetchData} className="text-xs text-red-300 hover:text-red-200 underline">
          Retry
        </button>
      </div>
    );
  }

  // ── Derived values ─────────────────────────────────────────────────────────
  const signal     = getSignal(data);
  const confidence = getConfidence(data);
  const prediction = computePrediction(data);
  const zoneInfo   = ZONE_LABEL[data.camZone];
  const cfg        = SIGNAL_CONFIG[signal];
  const SignalIcon = cfg.icon;

  const fmt       = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const confLevel = confidence >= 70 ? 'High' : confidence >= 55 ? 'Med' : 'Low';
  const confColor = confidence >= 70 ? 'text-emerald-400' : confidence >= 55 ? 'text-yellow-400' : 'text-orange-400';

  // Price-vs-H3/L3 gauge position (0–100%)
  const gaugeRange = data.h3 - data.l3;
  const gaugePct   = gaugeRange > 0
    ? Math.max(2, Math.min(98, ((data.price - data.l3) / gaugeRange) * 100))
    : 50;
  const dotColor = BULLISH_ZONES.includes(data.camZone) ? 'bg-emerald-400'
                 : BEARISH_ZONES.includes(data.camZone) ? 'bg-red-400'
                 : 'bg-yellow-400';

  return (
    <div className={`bg-gradient-to-br ${cfg.bg} border-2 ${cfg.border} rounded-xl p-3 shadow-lg ${cfg.glow} transition-all duration-300`}>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <Target className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-sm font-bold text-slate-200">{symbol}</span>
          <span className="text-[10px] text-slate-500 font-medium">Camarilla · CPR</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${
            data.status === 'LIVE' ? 'bg-emerald-400 animate-pulse' :
            data.status === 'CACHED' ? 'bg-yellow-400' : 'bg-red-400'
          }`} />
          <span className="text-[10px] text-slate-400">{data.status}</span>
        </div>
      </div>

      {/* ── Price + Zone ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-2.5 px-2 py-1.5 bg-slate-900/40 rounded-lg">
        <div>
          <span className="text-lg font-black text-slate-100" suppressHydrationWarning>
            ₹{fmt(data.price)}
          </span>
          <span
            className={`ml-2 text-xs font-semibold ${data.changePercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
            suppressHydrationWarning
          >
            {data.changePercent >= 0 ? '+' : ''}{data.changePercent.toFixed(2)}%
          </span>
        </div>
        <div className={`text-[10px] font-semibold ${zoneInfo.color}`}>
          {zoneInfo.emoji} {data.camZone.replace(/_/g, ' ')}
        </div>
      </div>

      {/* ── Signal badge ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 mb-2">
        <SignalIcon className={`w-8 h-8 flex-shrink-0 ${cfg.text}`} strokeWidth={2.5} />
        <div className="flex-1 min-w-0">
          <div className={`text-xl font-black ${cfg.text} leading-none mb-0.5`}>{signal}</div>
          <div className={`text-[10px] ${zoneInfo.color} truncate`}>{zoneInfo.label}</div>
        </div>
      </div>

      {/* ── Confidence bar ───────────────────────────────────────────────── */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-slate-400">Signal Confidence</span>
          <span className={`text-xs font-bold ${confColor}`} suppressHydrationWarning>
            {confidence}% <span className="text-[10px] font-normal">({confLevel})</span>
          </span>
        </div>
        <div className="w-full bg-slate-800/50 rounded-full h-1.5 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              confidence >= 70 ? 'bg-gradient-to-r from-emerald-500 to-emerald-400' :
              confidence >= 55 ? 'bg-gradient-to-r from-yellow-500 to-yellow-400' :
              'bg-gradient-to-r from-orange-500 to-orange-400'
            }`}
            style={{ width: `${confidence}%` }}
          />
        </div>
      </div>

      {/* ── CPR Zone (Central Pivot Range) ───────────────────────────────── */}
      <div className="mb-2.5">
        <div className="flex items-center gap-1 mb-1.5">
          <Layers className="w-3 h-3 text-slate-400" />
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
            Central Pivot Range
          </span>
          <span className={`ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded ${
            data.cprClassification === 'NARROW'
              ? 'bg-emerald-900/50 text-emerald-300'
              : 'bg-orange-900/50 text-orange-300'
          }`}>
            {data.cprClassification === 'NARROW' ? '📈 TREND DAY' : '📊 RANGE DAY'}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-1">
          <div className="bg-slate-900/50 rounded-lg p-1.5 text-center">
            <div className="text-[9px] text-red-400 mb-0.5">TC · Top</div>
            <div className="text-xs font-bold text-red-300" suppressHydrationWarning>
              ₹{fmt(data.cprTC)}
            </div>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-1.5 text-center border border-slate-600/30">
            <div className="text-[9px] text-slate-400 mb-0.5">Pivot</div>
            <div className="text-xs font-bold text-slate-200" suppressHydrationWarning>
              ₹{fmt(data.cprPivot)}
            </div>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-1.5 text-center">
            <div className="text-[9px] text-emerald-400 mb-0.5">BC · Bottom</div>
            <div className="text-xs font-bold text-emerald-300" suppressHydrationWarning>
              ₹{fmt(data.cprBC)}
            </div>
          </div>
        </div>

        <div className="mt-1 text-center text-[10px] text-slate-500" suppressHydrationWarning>
          Width: ₹{data.cprWidth.toFixed(2)}{' '}
          <span className="text-slate-600">({data.cprWidthPct.toFixed(3)}%)</span>
        </div>
      </div>

      {/* ── Key Levels ───────────────────────────────────────────────────── */}
      <div className="mb-2.5">
        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
          Key Camarilla Levels
        </div>
        <div className="grid grid-cols-2 gap-1">
          <div className="bg-red-950/30 border border-red-700/20 rounded-lg px-2 py-1.5">
            <div className="text-[9px] text-red-400 mb-0.5">H4 · Extreme Top</div>
            <div className="text-xs font-bold text-red-300" suppressHydrationWarning>
              ₹{fmt(data.h4)}
            </div>
          </div>
          <div className="bg-orange-950/30 border border-orange-600/20 rounded-lg px-2 py-1.5">
            <div className="text-[9px] text-orange-400 mb-0.5">H3 · R3 Resistance</div>
            <div className="text-xs font-bold text-orange-300" suppressHydrationWarning>
              ₹{fmt(data.h3)}
            </div>
          </div>
          <div className="bg-green-950/30 border border-green-600/20 rounded-lg px-2 py-1.5">
            <div className="text-[9px] text-green-400 mb-0.5">L3 · S3 Support</div>
            <div className="text-xs font-bold text-green-300" suppressHydrationWarning>
              ₹{fmt(data.l3)}
            </div>
          </div>
          <div className="bg-emerald-950/30 border border-emerald-700/20 rounded-lg px-2 py-1.5">
            <div className="text-[9px] text-emerald-400 mb-0.5">L4 · Extreme Bottom</div>
            <div className="text-xs font-bold text-emerald-300" suppressHydrationWarning>
              ₹{fmt(data.l4)}
            </div>
          </div>
        </div>
      </div>

      {/* ── Price position gauge (L3 → H3) ──────────────────────────────── */}
      {data.h3 > 0 && data.l3 > 0 && data.price > 0 && (
        <div className="mb-2.5">
          <div className="flex justify-between text-[9px] text-slate-500 mb-0.5">
            <span>S3 ₹{fmt(data.l3)}</span>
            <span>R3 ₹{fmt(data.h3)}</span>
          </div>
          <div className="relative w-full h-3 bg-slate-800/60 rounded-full overflow-hidden">
            <div className="absolute inset-0 flex">
              <div className="flex-1 bg-emerald-900/20" />
              <div className="flex-1 bg-slate-800/10" />
              <div className="flex-1 bg-red-900/20" />
            </div>
            <div
              className={`absolute top-0.5 w-2.5 h-2 rounded-full -translate-x-1/2 ${dotColor}`}
              style={{ left: `${gaugePct}%` }}
            />
          </div>
          <div className="flex justify-between text-[9px] text-slate-500 mt-0.5" suppressHydrationWarning>
            <span>+{(data.price - data.l3).toFixed(0)} pts above S3</span>
            <span>{(data.h3 - data.price).toFixed(0)} pts to R3</span>
          </div>
        </div>
      )}

      {/* ── 5-Min Prediction panel ───────────────────────────────────────── */}
      <div className="border border-slate-600/30 bg-slate-900/40 rounded-lg p-2.5">
        <div className="flex items-center gap-1 mb-1.5">
          <ChevronRight className="w-3 h-3 text-purple-400" />
          <span className="text-[10px] font-bold text-purple-300 tracking-wide uppercase">
            5-Min Prediction
          </span>
          <span className="ml-auto text-[10px] text-slate-500" suppressHydrationWarning>
            Score {prediction.score > 0 ? '+' : ''}{prediction.score} / 11
          </span>
        </div>

        <div className={`text-sm font-black ${prediction.color} mb-1.5`}>
          {prediction.label}
        </div>

        {/* Up / Down probability bar */}
        <div className="w-full h-2.5 bg-slate-800/50 rounded-full overflow-hidden flex mb-1" suppressHydrationWarning>
          <div
            className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-500"
            style={{ width: `${prediction.upPct}%` }}
          />
          <div
            className="h-full bg-gradient-to-r from-red-400 to-red-600 transition-all duration-500"
            style={{ width: `${prediction.downPct}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] font-semibold" suppressHydrationWarning>
          <span className="text-emerald-400">▲ UP {prediction.upPct}%</span>
          <span className="text-red-400">▼ DOWN {prediction.downPct}%</span>
        </div>

        {/* Factors summary */}
        <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5">
          {[
            { label: 'Zone',    value: data.camZone.replace(/_/g, ' ')          },
            { label: 'CPR Day', value: data.cprClassification === 'NARROW' ? 'TREND' : 'RANGE' },
            { label: 'Bias',    value: data.overallBias                          },
            { label: 'EMA',     value: data.emaTrend                             },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between text-[9px]">
              <span className="text-slate-500">{label}:</span>
              <span className="text-slate-300 font-medium">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <div className="mt-2 flex justify-between items-center">
        <div className="text-[9px] text-slate-500" suppressHydrationWarning>
          Signals: <span className="text-emerald-500">{data.bullishSignals}↑</span>{' '}
          / <span className="text-red-500">{data.bearishSignals}↓</span>
        </div>
        <div className="text-[9px] text-slate-500">Live · 5s refresh</div>
      </div>
    </div>
  );
};

export default CamarillaCPRCard;

