"use client";

/**
 * MarketPositioningCard — Market Positioning Intelligence
 *
 * Premium gold-themed professional section for NIFTY, BANKNIFTY, SENSEX.
 * Displays:
 *   • OI classification matrix (Long Buildup / Short Covering / Short Buildup / Long Unwinding)
 *   • Confidence % with animated gauge
 *   • Direction signal (STRONG BUY / BUY / SELL / STRONG SELL)
 *   • Live Price · Volume · OI values with Δ change badges
 *   • 5-Minute predictive alert (trend velocity extrapolation)
 *
 * Isolated: uses useMarketPositioning hook only (no prop drilling, no WS coupling).
 * All config from .env. Zero impact on other components.
 */

import React, { memo, useMemo, useEffect, useRef } from "react";
import {
  useMarketPositioning,
  SymbolPositioning,
} from "@/hooks/useMarketPositioning";
import type { MarketTick } from "@/hooks/useMarketSocket";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  BarChart2,
  Zap,
  Clock,
  AlertTriangle,
  ChevronUp,
  ChevronDown,
} from "lucide-react";

// ─── Signal style map ────────────────────────────────────────────────────────

interface SignalStyle {
  bg: string;
  border: string;
  text: string;
  glow: string;
  label: string;
  icon: React.ReactNode;
}

function getSignalStyle(signal: string): SignalStyle {
  switch (signal?.toUpperCase()) {
    case "STRONG_BUY":
      return {
        bg:     "bg-emerald-950/60",
        border: "border-emerald-400",
        text:   "text-emerald-300",
        glow:   "shadow-emerald-500/30",
        label:  "STRONG BUY",
        icon:   <TrendingUp className="w-4 h-4" />,
      };
    case "BUY":
      return {
        bg:     "bg-green-950/50",
        border: "border-green-500",
        text:   "text-green-300",
        glow:   "shadow-green-500/20",
        label:  "BUY",
        icon:   <TrendingUp className="w-4 h-4" />,
      };
    case "SELL":
      return {
        bg:     "bg-rose-950/50",
        border: "border-rose-500",
        text:   "text-rose-300",
        glow:   "shadow-rose-500/20",
        label:  "SELL",
        icon:   <TrendingDown className="w-4 h-4" />,
      };
    case "STRONG_SELL":
      return {
        bg:     "bg-red-950/60",
        border: "border-red-400",
        text:   "text-red-300",
        glow:   "shadow-red-500/30",
        label:  "STRONG SELL",
        icon:   <TrendingDown className="w-4 h-4" />,
      };
    default:
      return {
        bg:     "bg-slate-900/60",
        border: "border-slate-600",
        text:   "text-slate-400",
        glow:   "shadow-slate-600/20",
        label:  "NEUTRAL",
        icon:   <Minus className="w-4 h-4" />,
      };
  }
}

// ─── Positioning type style map ───────────────────────────────────────────────

function getPositioningStyle(type: string, label?: string) {
  // Special case: Weak Short Buildup with light green border
  if (label === "Weak Short Buildup") {
    return { color: "text-red-400", bg: "bg-red-500/15", border: "border-lime-400/50", badge: "bg-red-500/20 text-red-300" };
  }

  switch (type) {
    case "STRONG_LONG_BUILDUP":
      return { color: "text-green-300",   bg: "bg-green-500/25",   border: "border-green-400/60",   badge: "bg-green-500/30 text-green-200" };
    case "LONG_BUILDUP":
      return { color: "text-emerald-400", bg: "bg-emerald-500/15", border: "border-emerald-500/40", badge: "bg-emerald-500/20 text-emerald-300" };
    case "SHORT_COVERING":
      return { color: "text-green-400",   bg: "bg-green-500/10",   border: "border-green-500/30",   badge: "bg-green-500/20 text-green-300" };
    case "STRONG_SHORT_BUILDUP":
      return { color: "text-rose-300",    bg: "bg-rose-600/25",    border: "border-rose-500/60",    badge: "bg-rose-500/30 text-rose-200" };
    case "SHORT_BUILDUP":
      return { color: "text-red-400",     bg: "bg-red-500/15",     border: "border-red-500/40",     badge: "bg-red-500/20 text-red-300" };
    case "LONG_UNWINDING":
      return { color: "text-rose-400",    bg: "bg-rose-500/10",    border: "border-rose-500/30",    badge: "bg-rose-500/20 text-rose-300" };
    default:
      return { color: "text-slate-400",   bg: "bg-slate-800/30",   border: "border-slate-600/30",   badge: "bg-slate-700/40 text-slate-400" };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 0) {
  if (n === 0 || !n) return "—";
  if (n >= 1_00_00_000) return `${(n / 1_00_00_000).toFixed(1)}Cr`;
  if (n >= 1_00_000)    return `${(n / 1_00_000).toFixed(1)}L`;
  if (n >= 1_000)       return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-IN", { maximumFractionDigits: decimals });
}

function fmtPrice(n: number) {
  return n > 0 ? `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}

// ─── Delta badges ──────────────────────────────────────────────────────────────────

/** Generic ±X.XX% badge */
function PctBadge({ value, sub }: { value: number; sub?: string }) {
  if (Math.abs(value) < 0.01) return (
    <span className="text-slate-500 text-[9px]">—</span>
  );
  const up = value > 0;
  return (
    <div className="flex flex-col gap-0">
      <span className={`inline-flex items-center gap-0.5 text-[9px] font-bold px-1 py-0.5 rounded ${
        up ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
      }`}>
        {up ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
        {Math.abs(value).toFixed(2)}%
      </span>
      {sub && <span className="text-[8px] text-slate-600 mt-0.5 leading-none">{sub}</span>}
    </div>
  );
}

/** ₹ pts velocity badge (tick-to-tick price change) */
function PtsBadge({ value, sub }: { value: number; sub?: string }) {
  if (Math.abs(value) < 0.01) return (
    <span className="text-slate-500 text-[9px]">—</span>
  );
  const up = value > 0;
  return (
    <div className="flex flex-col gap-0">
      <span className={`inline-flex items-center gap-0.5 text-[9px] font-bold px-1 py-0.5 rounded ${
        up ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
      }`}>
        {up ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
        {up ? "+" : ""}{value.toFixed(2)} pts
      </span>
      {sub && <span className="text-[8px] text-slate-600 mt-0.5 leading-none">{sub}</span>}
    </div>
  );
}

/** Tick-flow badge (0–100%, directional consistency) */
function FlowBadge({ value, sub }: { value: number; sub?: string }) {
  // 0 = fully random ticks, 100 = all ticks same direction
  if (value < 1) return <span className="text-slate-500 text-[9px]">—</span>;
  const strong = value >= 70;
  const color  = strong ? "bg-amber-500/15 text-amber-400" : "bg-slate-700/40 text-slate-400";
  return (
    <div className="flex flex-col gap-0">
      <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${color}`}>
        {value.toFixed(0)}% flow
      </span>
      {sub && <span className="text-[8px] text-slate-600 mt-0.5 leading-none">{sub}</span>}
    </div>
  );
}

// Keep as alias for any remaining usages
const DeltaBadge = ({ value }: { value: number }) => <PctBadge value={value} />;

/**
 * ConfidenceGauge — Signal-aware confidence visualization
 * Bar color matches signal direction (not just confidence level)
 * - BUY signals → green/emerald gradient
 * - SELL signals → red/rose gradient
 * - NEUTRAL → amber/slate neutral
 * Opacity/saturation increases with confidence ≥55%
 */
function ConfidenceGauge({ value, signal }: { value: number; signal?: string }) {
  const capped  = Math.min(100, Math.max(0, value));
  
  // Signal color determines base gradient direction — confidence controls saturation
  let bgColor = "from-slate-500 to-slate-400";      // neutral default
  let textColor = "text-slate-400";
  
  const signalType = signal?.toUpperCase();
  if (signalType?.includes("BUY")) {
    // BUY signal → green/emerald (bullish)
    bgColor = capped >= 70 
      ? "from-emerald-400 via-green-300 to-emerald-300"   // high confidence → bright
      : "from-green-500 to-emerald-400";                   // moderate confidence → muted
    textColor = capped >= 70 ? "text-emerald-300" : "text-green-400";
  } else if (signalType?.includes("SELL")) {
    // SELL signal → red/rose (bearish)
    bgColor = capped >= 70
      ? "from-red-400 via-rose-300 to-red-300"             // high confidence → bright
      : "from-rose-500 to-red-400";                        // moderate confidence → muted
    textColor = capped >= 70 ? "text-red-300" : "text-rose-400";
  } else {
    // NEUTRAL signal → amber (cautious)
    bgColor = capped >= 55
      ? "from-amber-400 to-yellow-400"
      : "from-slate-500 to-slate-400";
    textColor = capped >= 55 ? "text-amber-300" : "text-slate-400";
  }

  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-1">
        <span className="text-[10px] text-slate-400 font-medium">Confidence</span>
        <span className={`text-sm font-extrabold ${textColor}`}>
          {capped}%
        </span>
      </div>
      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r ${bgColor} rounded-full transition-all duration-700`}
          style={{ width: `${capped}%` }}
        />
      </div>
    </div>
  );
}

// ─── Single symbol card ───────────────────────────────────────────────────────

interface SymbolCardProps {
  data: SymbolPositioning;
  name: string;
  /** Live WebSocket tick — overrides price/change from the polling API */
  liveTick?: MarketTick | null;
}

const SymbolCard = memo(function SymbolCard({ data, name, liveTick }: SymbolCardProps) {
  const sig      = getSignalStyle(data.signal);
  const posStyle = getPositioningStyle(data.positioning?.type ?? "NEUTRAL", data.positioning?.label);
  const predSig  = getSignalStyle(data.prediction?.signal ?? "NEUTRAL");

  // Prefer live WebSocket price/change — falls back to polling API value
  const livePrice     = liveTick?.price         ?? data.price;
  const liveChangePct = liveTick?.changePercent ?? data.change_pct;
  const liveChange    = liveTick?.change;

  // ── Volume session EMA (client-side) ──────────────────────────────────────
  // QUOTE_VOLUMES in the cache barely changes tick-to-tick — so the backend
  // `changes.volume` is nearly always 0 (→ shows “—”). We track liveTick.volume
  // in a client-side exponential moving average (α=0.08, ~12-tick window ≈ 1 min)
  // to detect real session accumulation / distribution.
  const volEmaRef = useRef<number>(liveTick?.volume ?? data.volume ?? 0);

  useEffect(() => {
    const vol = liveTick?.volume;
    if (!vol || vol <= 0) return;
    // Initialise on first real tick
    if (volEmaRef.current <= 0) { volEmaRef.current = vol; return; }
    // EMA: smooth over ~12 ticks ≈ 1 min at 5s poll
    volEmaRef.current = volEmaRef.current * 0.92 + vol * 0.08;
  }, [liveTick?.volume]);

  const liveVolume = liveTick?.volume ?? data.volume;
  const volDevPct  = useMemo(() => {
    const ema = volEmaRef.current;
    if (!liveVolume || !ema || ema <= 0) return data.changes?.volume ?? 0;
    return ((liveVolume / ema) - 1) * 100;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveVolume, data.changes?.volume]);

  // ── OI delta: real if available, else tick-flow proxy ───────────────────────
  const oiPct       = data.changes?.oi       ?? 0;
  const tickFlow    = data.changes?.tick_flow ?? 0;
  const hasRealOI   = Math.abs(oiPct) >= 0.01;  // non-trivial OI change from PCR

  // Determine outer card border: highlight Long Buildup (green) and Short Buildup (red)
  const posType = data.positioning?.type ?? '';
  const isStrongLong   = posType === 'STRONG_LONG_BUILDUP';
  const isStrongShort  = posType === 'STRONG_SHORT_BUILDUP';
  const isLongBuildup  = posType === 'LONG_BUILDUP' || isStrongLong;
  const isShortBuildup = posType === 'SHORT_BUILDUP' || isStrongShort;

  const outerBorder = isStrongLong
    ? 'border-green-400/80'
    : isStrongShort
    ? 'border-rose-500/80'
    : isLongBuildup
    ? 'border-emerald-400/70'
    : isShortBuildup
    ? 'border-red-500/70'
    : data.positioning?.label === "Weak Short Buildup"
    ? posStyle.border
    : sig.border;

  const outerRing = isStrongLong
    ? 'ring-2 ring-green-400/70'
    : isStrongShort
    ? 'ring-2 ring-rose-500/70'
    : isLongBuildup
    ? 'ring-2 ring-emerald-400/60'
    : isShortBuildup
    ? 'ring-2 ring-red-500/60'
    : '';

  const outerGlow = isStrongLong
    ? 'shadow-[0_0_24px_rgba(34,197,94,0.50)]'
    : isStrongShort
    ? 'shadow-[0_0_24px_rgba(225,29,72,0.50)]'
    : isLongBuildup
    ? 'shadow-[0_0_18px_rgba(52,211,153,0.35)]'
    : isShortBuildup
    ? 'shadow-[0_0_18px_rgba(239,68,68,0.35)]'
    : `shadow-xl ${sig.glow}`;

  // For "Weak Short Buildup", use subtle background so lime border shows prominently
  const innerPosBackground = data.positioning?.label === "Weak Short Buildup"
    ? "bg-slate-800/20"
    : posStyle.bg;

  return (
    <div
      className={`
        relative flex flex-col gap-3 rounded-2xl p-4
        bg-gradient-to-br from-slate-900/90 via-slate-950/80 to-black/60
        border-2 ${outerBorder} ${outerRing} ${outerGlow}
        hover:shadow-2xl hover:scale-[1.01] transition-all duration-300
        backdrop-blur-sm overflow-hidden
      `}
    >
      {/* Gold shimmer strip */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-yellow-400/70 to-transparent" />

      {/* ─ Header ─ */}
      <div className="flex items-center justify-between">
        <div className="rounded-lg border border-green-500/60 bg-green-950/30 px-2.5 py-1.5">
          <span className="text-base font-extrabold text-white tracking-wide">{name}</span>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {/* Live price — updates every WebSocket tick */}
            <span className="text-lg font-bold text-white">{fmtPrice(livePrice)}</span>
            {liveChangePct != null && !isNaN(liveChangePct) && liveChangePct !== 0 && (
              <span className={`text-xs font-bold ${liveChangePct > 0 ? "text-emerald-400" : "text-red-400"}`}>
                {liveChange != null && !isNaN(liveChange) && liveChange !== 0
                  ? `${liveChange > 0 ? "+" : ""}${liveChange.toFixed(2)} `
                  : ""}
                ({liveChangePct > 0 ? "+" : ""}{liveChangePct.toFixed(2)}%)
              </span>
            )}
          </div>
        </div>

        {/* Signal badge */}
        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-extrabold text-xs ${sig.bg} ${sig.text} border ${sig.border} shadow-lg`}>
          {sig.icon}
          {sig.label}
        </div>
      </div>

      {/* ─ Confidence gauge ─ */}
      {/* Signal-aware: bar color matches direction (BUY=green, SELL=red) */}
      <ConfidenceGauge value={data.confidence} signal={data.signal} />

      {/* ─ Positioning type ─ */}
      <div className={`flex items-center justify-between rounded-xl px-3 py-2 border ${innerPosBackground} ${posStyle.border}`}>
        <div>
          <span className={`text-xs font-extrabold ${posStyle.color}`}>
            {data.positioning?.label ?? "—"}
          </span>
          <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">
            {data.positioning?.description ?? ""}
          </p>
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${posStyle.badge} whitespace-nowrap ml-2`}>
          {data.positioning?.trend ?? "—"}
        </span>
      </div>

      {/* ─ Price / Volume / OI matrix ─ */}
      <div className="grid grid-cols-3 gap-2">

        {/* Cell 1 — Price: live WebSocket price + ₹ tick velocity */}
        <div className="flex flex-col gap-0.5 bg-slate-800/40 rounded-lg p-2 border border-slate-700/30">
          <div className="flex items-center gap-1 text-slate-500">
            <TrendingUp className="w-3 h-3" />
            <span className="text-[9px] uppercase tracking-widest font-bold">Price</span>
          </div>
          <span className="text-white font-bold text-xs">{fmtPrice(livePrice)}</span>
          {/* ₹ tick velocity — how many pts moved since last 5s poll */}
          <PtsBadge value={data.changes?.price_tick ?? 0} sub="tick velocity" />
        </div>

        {/* Cell 2 — Volume: live tick volume + % vs session EMA */}
        <div className="flex flex-col gap-0.5 bg-slate-800/40 rounded-lg p-2 border border-slate-700/30">
          <div className="flex items-center gap-1 text-slate-500">
            <BarChart2 className="w-3 h-3" />
            <span className="text-[9px] uppercase tracking-widest font-bold">Volume</span>
          </div>
          <span className="text-white font-bold text-xs">{fmt(liveVolume)}</span>
          {/* % vs session rolling avg — positive = accumulation, negative = distribution */}
          <PctBadge value={volDevPct} sub="vs avg" />
        </div>

        {/* Cell 3 — OI: total F&O OI (PCR) + tick-to-tick change OR tick-flow fallback */}
        <div className="flex flex-col gap-0.5 bg-slate-800/40 rounded-lg p-2 border border-slate-700/30">
          <div className="flex items-center gap-1 text-slate-500">
            <Activity className="w-3 h-3" />
            <span className="text-[9px] uppercase tracking-widest font-bold">OI</span>
          </div>
          <span className="text-white font-bold text-xs">{fmt(data.oi)}</span>
          {/* Real OI change if PCR data available, else tick directional-flow% */}
          {hasRealOI
            ? <PctBadge value={oiPct} sub="OI chg" />
            : <FlowBadge value={tickFlow} sub="tick flow" />
          }
        </div>

      </div>

      {/* ─ 5-Minute Predictive Alert ─ */}
      <div className={`
        rounded-xl px-4 py-3 border space-y-3
        ${data.prediction?.confidence >= 60
          ? "bg-amber-950/30 border-amber-500/30"
          : "bg-slate-800/40 border-slate-700/30"
        }
      `}>
        <div className="flex items-center gap-1.5">
          <Clock className="w-4 h-4 text-amber-400" />
          <span className="text-[11px] font-bold text-amber-400 uppercase tracking-widest">
            5-Min Prediction
          </span>
          <span className={`ml-auto text-[10px] font-bold px-2 py-1 rounded ${predSig.text} ${predSig.bg}`}>
            {predSig.label}
          </span>
        </div>

        {(() => {
          // Fallback: derive prediction from available signals when backend data is absent
          const hasBackendPred = (data.prediction?.confidence ?? 0) > 0;
          const fallbackSignal = data.signal ?? 'NEUTRAL';
          const fallbackConf   = Math.min(90, Math.max(35, data.confidence ?? 40));
          const fallbackReason =
            data.positioning?.description
              ? `${data.positioning.label}: ${data.positioning.description}`
              : fallbackSignal !== 'NEUTRAL'
                ? `Signal ${fallbackSignal.replace('_', ' ')} — based on OI positioning`
                : 'Market neutral — no strong directional OI signal';
          const pred = hasBackendPred ? data.prediction : {
            signal:         fallbackSignal,
            confidence:     fallbackConf,
            reason:         fallbackReason,
            price_velocity: 0,
            vol_velocity:   0,
            tick_flow_pct:  0,
          };

          // Calculate actual market confidence from signals
          const actualMarketConf = Math.round(
            Math.abs(data.changes.price_tick * 2) * 20 +
            Math.abs(data.changes.oi) * 30 +
            Math.abs(data.changes.tick_flow) * 40 +
            Math.abs(data.changes.volume) * 10
          ) / 100;

          return pred.confidence > 0 ? (
          <>
            <p className="text-[10px] text-slate-300 leading-snug">
              {pred.reason}
            </p>

            {/* Micro-Movement Detection Subsection */}
            <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/20 space-y-2">
              {/* Predicted vs Actual Confidence */}
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col bg-slate-900/30 rounded px-2 py-1.5">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">CONFIDENCE</span>
                  <span className="text-[12px] font-black text-yellow-300 mt-0.5">{pred.confidence}%</span>
                  <div className="w-full h-2 rounded-full bg-slate-700/50 overflow-hidden mt-1">
                    <div
                      className="h-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all duration-300 rounded-full"
                      style={{ width: `${Math.min(100, pred.confidence)}%` }}
                    />
                  </div>
                </div>
                <div className="flex flex-col bg-slate-900/30 rounded px-2 py-1.5">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">Actual Market</span>
                  <span className="text-[12px] font-black text-emerald-300 mt-0.5">{Math.min(100, actualMarketConf)}%</span>
                  <div className="w-full h-2 rounded-full bg-slate-700/50 overflow-hidden mt-1">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-300 rounded-full"
                      style={{ width: `${Math.min(100, actualMarketConf)}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Price Momentum Indicator */}
              <div className="flex items-center justify-between bg-slate-900/30 rounded px-2 py-1.5">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">Price Momentum</span>
                <span className={`font-bold px-2 py-1 rounded text-[10px] ${
                  data.changes.price_tick > 0.5   ? 'bg-emerald-500/40 text-emerald-200' :
                  data.changes.price_tick > 0     ? 'bg-emerald-500/25 text-emerald-300' :
                  data.changes.price_tick < -0.5  ? 'bg-red-500/40 text-red-200' :
                  data.changes.price_tick < 0     ? 'bg-red-500/25 text-red-300' :
                                                    'bg-slate-600/25 text-slate-300'
                }`}>
                  {data.changes.price_tick > 0 ? '▲' : data.changes.price_tick < 0 ? '▼' : '→'} {Math.abs(data.changes.price_tick).toFixed(2)} pts
                </span>
              </div>

              {/* OI Momentum Indicator */}
              <div className="flex items-center justify-between bg-slate-900/30 rounded px-2 py-1.5">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">OI Momentum</span>
                <span className={`font-bold px-2 py-1 rounded text-[10px] ${
                  data.changes.oi > 0.3  ? 'bg-emerald-500/40 text-emerald-200' :
                  data.changes.oi > 0    ? 'bg-emerald-500/25 text-emerald-300' :
                  data.changes.oi < -0.3 ? 'bg-red-500/40 text-red-200' :
                  data.changes.oi < 0    ? 'bg-red-500/25 text-red-300' :
                                           'bg-slate-600/25 text-slate-300'
                }`}>
                  {data.changes.oi > 0 ? '📈' : data.changes.oi < 0 ? '📉' : '⚖️'} {Math.abs(data.changes.oi).toFixed(2)}%
                </span>
              </div>

              {/* Probability Distribution */}
              <div className="pt-2 border-t border-slate-700/20">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">Movement Probability</span>
                </div>
                <div className="flex items-center gap-0.5 h-7 rounded-md overflow-hidden bg-slate-950/50 border border-slate-700/30">
                  {/* Bullish prob */}
                  <div
                    className="h-full bg-gradient-to-r from-emerald-600 to-emerald-500 transition-all duration-300 flex items-center justify-center min-w-[2px]"
                    style={{
                      width: `${Math.max(5, Math.min(95, Math.round(
                        Math.max(0, data.changes.price_tick) * 20 +
                        Math.max(0, data.changes.oi) * 30 +
                        Math.max(0, data.changes.tick_flow) * 40
                      ) / 90 * 100))}%`,
                    }}
                  >
                    <span className="text-[9px] font-bold text-white px-2 truncate whitespace-nowrap">
                      {Math.round(
                        Math.max(0, data.changes.price_tick) * 20 +
                        Math.max(0, data.changes.oi) * 30 +
                        Math.max(0, data.changes.tick_flow) * 40
                      ) / 90 * 100}%↑
                    </span>
                  </div>
                  {/* Bearish prob */}
                  <div
                    className="h-full bg-gradient-to-l from-red-600 to-red-500 transition-all duration-300 flex items-center justify-center ml-auto min-w-[2px]"
                    style={{
                      width: `${Math.max(5, Math.min(95, Math.round(
                        Math.max(0, -data.changes.price_tick) * 20 +
                        Math.max(0, -data.changes.oi) * 30 +
                        Math.max(0, -data.changes.tick_flow) * 40
                      ) / 90 * 100))}%`,
                    }}
                  >
                    <span className="text-[9px] font-bold text-white px-2 truncate whitespace-nowrap">
                      {Math.round(
                        Math.max(0, -data.changes.price_tick) * 20 +
                        Math.max(0, -data.changes.oi) * 30 +
                        Math.max(0, -data.changes.tick_flow) * 40
                      ) / 90 * 100}%↓
                    </span>
                  </div>
                </div>
              </div>

              {/* Early Signal Detection - fixed height to prevent layout shift on mobile */}
              <div className="pt-2 border-t border-slate-700/20 min-h-[28px]">
                {(Math.abs(data.changes.price_tick) > 0.25 || Math.abs(data.changes.tick_flow) > 40) && (
                  <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wide">
                    ⚡ Early Signal Detected
                  </span>
                )}
              </div>
            </div>

            {/* ─ Legacy Velocity Pills (kept for reference, now secondary) ─ */}
            <div className="flex flex-wrap gap-1 items-center text-[9px]">

              {/* P: ₹ pts velocity across the tick window (e.g. +8.5 pts) */}
              {(() => {
                const pts = pred.price_velocity ?? 0;
                const up  = pts > 0;
                if (Math.abs(pts) < 0.01) return (
                  <span key="P" className="font-bold px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">
                    P —
                  </span>
                );
                return (
                  <span key="P" className={`font-bold px-1.5 py-0.5 rounded ${
                    up ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
                  }`}>
                    P {up ? "+" : ""}{pts.toFixed(1)} pts
                  </span>
                );
              })()}

              {/* V: % vs session EMA — use live client-side value, fall back to API */}
              {(() => {
                const v   = Math.abs(volDevPct) >= 0.05 ? volDevPct : (pred.vol_velocity ?? 0);
                const up  = v > 0;
                if (Math.abs(v) < 0.05) return (
                  <span key="V" className="font-bold px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">
                    Vol —
                  </span>
                );
                return (
                  <span key="V" className={`font-bold px-1.5 py-0.5 rounded ${
                    up ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
                  }`}>
                    Vol {up ? "+" : ""}{v.toFixed(1)}% vs avg
                  </span>
                );
              })()}

              {/* Flow: signed tick-directional flow −0 to +100% */}
              {(() => {
                const f  = pred.tick_flow_pct ?? 0;
                const up = f > 0;
                if (Math.abs(f) < 1) return (
                  <span key="F" className="font-bold px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">
                    Flow —
                  </span>
                );
                const strong = Math.abs(f) >= 66;
                return (
                  <span key="F" className={`font-bold px-1.5 py-0.5 rounded ${
                    strong
                      ? up ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"
                      : up ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
                  }`}>
                    Flow {up ? "+" : ""}{f.toFixed(0)}%
                  </span>
                );
              })()}
            </div>
          </>
          ) : (
          <p className="text-[10px] text-slate-500">Collecting market data…</p>
          );
        })()}
      </div>

      {/* Advanced 5m Prediction Analysis - DISABLED */}

      {/* Live indicator dot */}
      {data.is_live && (
        <div className="absolute top-3 right-3 flex items-center gap-1">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
        </div>
      )}
    </div>
  );
});

// ─── Skeleton placeholder ─────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-2xl p-4 bg-slate-900/70 border border-yellow-500/20 animate-pulse">
      <div className="h-5 bg-slate-800 rounded w-1/3 mb-3" />
      <div className="h-2 bg-slate-800 rounded w-full mb-2" />
      <div className="h-12 bg-slate-800 rounded mb-2" />
      <div className="grid grid-cols-3 gap-2">
        {[1, 2, 3].map(i => <div key={i} className="h-14 bg-slate-800 rounded-lg" />)}
      </div>
      <div className="h-16 bg-slate-800 rounded-xl mt-2" />
    </div>
  );
}

// ─── Main exported section ────────────────────────────────────────────────────

const SYMBOL_NAMES: Record<string, string> = {
  NIFTY:      "NIFTY 50",
  BANKNIFTY:  "BANK NIFTY",
  SENSEX:     "SENSEX",
};

interface LiveData {
  NIFTY:      MarketTick | null;
  BANKNIFTY:  MarketTick | null;
  SENSEX:     MarketTick | null;
}

interface MarketPositioningCardProps {
  /** Pass marketData from useMarketSocket so price/change show live WebSocket values */
  liveData?: LiveData;
}

export const MarketPositioningCard = memo(function MarketPositioningCard({ liveData }: MarketPositioningCardProps) {
  const { data, loading } = useMarketPositioning();

  return (
    <section
      aria-label="Market Positioning Intelligence"
      className="mt-4 sm:mt-6 rounded-2xl p-3 sm:p-4
        border-2 border-yellow-500/40
        bg-gradient-to-br from-yellow-950/20 via-amber-950/15 to-slate-950/50
        backdrop-blur-sm shadow-xl shadow-yellow-500/10"
    >
      {/* ── Section header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        <div className="flex items-start gap-3">
          <span className="w-1.5 h-7 bg-gradient-to-b from-yellow-400 to-amber-500 rounded-full shadow-lg shadow-yellow-500/50 flex-shrink-0 mt-0.5" />
          <div>
            <h2 className="text-base sm:text-xl lg:text-2xl font-extrabold text-white tracking-tight leading-tight">
              Market Positioning Intelligence
            </h2>
            <p className="text-[10px] sm:text-xs text-amber-400/70 font-medium mt-0.5">
              OI · Volume · Price Analysis  •  Positioning Matrix  •  5-Min Predictive Alert
            </p>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-1.5 ml-4 sm:ml-0">
          {[
            { label: "Long Buildup",   color: "text-emerald-400 bg-emerald-500/15 border-emerald-500/30" },
            { label: "Short Covering", color: "text-green-400   bg-green-500/10   border-green-500/20" },
            { label: "Short Buildup",  color: "text-red-400     bg-red-500/15     border-red-500/30" },
            { label: "Long Unwinding", color: "text-rose-400    bg-rose-500/10    border-rose-500/20" },
          ].map(({ label, color }) => (
            <span key={label} className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${color}`}>
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* ── Matrix description bar ── */}
      <div className="flex flex-wrap gap-1.5 mb-3 ml-4 sm:ml-5">
        {[
          { arrows: "P↑ V↑ OI↑", label: "Strong Up",   color: "text-emerald-300 bg-emerald-900/30 border-emerald-700/40" },
          { arrows: "P↑ V↓ OI↓", label: "Weak Up",     color: "text-green-300   bg-green-900/20   border-green-700/30" },
          { arrows: "P↓ V↑ OI↑", label: "Strong Down", color: "text-red-300     bg-red-900/30     border-red-700/40" },
          { arrows: "P↓ V↓ OI↓", label: "Weak Down",   color: "text-rose-300    bg-rose-900/20    border-rose-700/30" },
        ].map(({ arrows, label, color }) => (
          <span key={arrows} className={`text-[9px] sm:text-[10px] font-bold px-2 py-0.5 rounded-md border ${color}`}>
            {arrows} → {label}
          </span>
        ))}
      </div>

      {/* ── Cards grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
        {(["NIFTY", "BANKNIFTY", "SENSEX"] as const).map(symbol => {
          const symbolData = data[symbol];
          if (loading && !symbolData) return <SkeletonCard key={symbol} />;
          if (!symbolData) return <SkeletonCard key={symbol} />;
          return (
            <SymbolCard
              key={symbol}
              name={SYMBOL_NAMES[symbol]}
              data={symbolData}
              liveTick={liveData?.[symbol]}
            />
          );
        })}
      </div>

      {/* ── Footer note ── */}
      <p className="text-[9px] sm:text-[10px] text-slate-500 mt-3 ml-1">
        ⚡ Updates every 5s  •  OI velocity extrapolation for 5-min prediction  •  Confidence based on signal strength × magnitude
      </p>
    </section>
  );
});

export default MarketPositioningCard;
