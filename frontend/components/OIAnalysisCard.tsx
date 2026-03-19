"use client";

import { useOIAnalysis, type OIAnalysisFactors } from "@/hooks/useOIAnalysis";
import { useMemo, useState, useEffect } from "react";

interface OIAnalysisCardProps {
  symbol: string;
  name: string;
  livePrice?: number;
  liveChangePct?: number;
  marketStatus?: "LIVE" | "CLOSED" | "OFFLINE" | "PRE_OPEN" | "FREEZE";
}

// ── Signal config ────────────────────────────────────────────────────────────
const SIGS: Record<string, {
  label: string; color: string; bg: string; border: string; bar: string; glow: string;
}> = {
  STRONG_BUY:  { label: "STRONG BUY",  color: "text-emerald-300", bg: "bg-emerald-900/25", border: "border-emerald-500/60", bar: "from-emerald-500 to-green-400",  glow: "shadow-emerald-500/20" },
  BUY:         { label: "BUY",         color: "text-emerald-400", bg: "bg-emerald-900/15", border: "border-emerald-600/50", bar: "from-emerald-600 to-teal-500",   glow: "shadow-emerald-600/10" },
  SELL:        { label: "SELL",        color: "text-red-400",     bg: "bg-red-900/15",     border: "border-red-600/50",     bar: "from-red-600 to-rose-500",       glow: "shadow-red-600/10" },
  STRONG_SELL: { label: "STRONG SELL", color: "text-rose-300",    bg: "bg-rose-900/25",    border: "border-rose-500/60",    bar: "from-rose-500 to-red-400",       glow: "shadow-rose-500/20" },
  NEUTRAL:     { label: "NEUTRAL",     color: "text-slate-400",   bg: "bg-slate-800/25",   border: "border-slate-600/40",   bar: "from-slate-600 to-slate-500",    glow: "" },
  NO_SIGNAL:   { label: "NO SIGNAL",   color: "text-slate-500",   bg: "bg-slate-800/15",   border: "border-slate-700/30",   bar: "from-slate-700 to-slate-600",    glow: "" },
};
const getSig = (s?: string | null) => SIGS[(s ?? "").toUpperCase()] ?? SIGS.NO_SIGNAL;

// ── OI Flow state labels ─────────────────────────────────────────────────────
const OI_STATES: Record<string, { label: string; color: string; tag: string }> = {
  LONG_BUILDUP:   { label: "Long Buildup",    color: "text-emerald-400", tag: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300" },
  SHORT_BUILDUP:  { label: "Short Buildup",   color: "text-red-400",     tag: "bg-red-500/15 border-red-500/30 text-red-300" },
  SHORT_COVERING: { label: "Short Covering",   color: "text-teal-400",   tag: "bg-teal-500/15 border-teal-500/30 text-teal-300" },
  LONG_UNWINDING: { label: "Long Unwinding",   color: "text-orange-400", tag: "bg-orange-500/15 border-orange-500/30 text-orange-300" },
  NO_DATA:        { label: "Awaiting",          color: "text-slate-500",  tag: "bg-slate-700/20 border-slate-600/30 text-slate-500" },
};
const getOI = (t: string) => OI_STATES[t] ?? OI_STATES.NO_DATA;

function adjustConf(base: number, status: string): number {
  if (status === "LIVE") return Math.min(98, Math.round(base + Math.min(8, Math.max(0, (base - 50) / 5))));
  if (status === "PRE_OPEN" || status === "FREEZE") return Math.max(30, base - 15);
  return Math.max(20, base - 25);
}

export default function OIAnalysisCard({
  symbol, name, livePrice, liveChangePct, marketStatus = "OFFLINE",
}: OIAnalysisCardProps) {
  const { data, loading, error, isLive, refetch } = useOIAnalysis(symbol);
  const [prevPrice, setPrevPrice] = useState(0);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  const displayPrice = livePrice ?? data?.current_price ?? 0;
  const confidence = useMemo(() => data ? adjustConf(data.confidence ?? 50, marketStatus) : 0, [data, marketStatus]);
  const sig = useMemo(() => getSig(data?.signal), [data?.signal]);

  useEffect(() => {
    if (!displayPrice || displayPrice === prevPrice) return;
    setFlash(displayPrice > prevPrice ? "up" : "down");
    const t = setTimeout(() => setFlash(null), 700);
    setPrevPrice(displayPrice);
    return () => clearTimeout(t);
  }, [displayPrice, prevPrice]);

  // ── LOADING ───────────────────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <div className="bg-slate-900/50 border border-cyan-500/20 rounded-2xl p-4 animate-pulse min-h-[220px]">
        <div className="flex justify-between mb-3"><div className="h-5 bg-slate-800/70 rounded w-28" /><div className="h-5 bg-slate-800/70 rounded w-20" /></div>
        <div className="h-10 bg-slate-800/40 rounded-xl mb-2" />
        <div className="h-1.5 bg-slate-800/40 rounded-full mb-3" />
        <div className="grid grid-cols-4 gap-1.5 mb-2">{[1,2,3,4].map(i => <div key={i} className="h-14 bg-slate-800/30 rounded-lg" />)}</div>
        <div className="h-8 bg-slate-800/20 rounded-lg" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="bg-slate-900/50 border border-rose-500/30 rounded-2xl p-5 min-h-[180px] flex flex-col items-center justify-center gap-2">
        <span className="text-2xl">⚠</span>
        <p className="text-sm font-bold text-rose-300">{name}</p>
        <p className="text-xs text-rose-400/80">{error}</p>
        <button onClick={refetch} className="mt-1 text-[10px] px-3 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 transition-colors">Retry</button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-slate-900/50 border border-slate-700/40 rounded-2xl p-5 min-h-[180px] flex flex-col items-center justify-center gap-2">
        <span className="text-2xl">📊</span>
        <p className="text-sm font-bold text-slate-400">{name}</p>
        <p className="text-xs text-slate-500">No OI data available</p>
        <button onClick={refetch} className="mt-1 text-[10px] px-3 py-1 rounded-full bg-slate-700/40 text-slate-400 border border-slate-600/40 hover:bg-slate-700/60 transition-colors">Retry</button>
      </div>
    );
  }

  const f: OIAnalysisFactors = data.factors ?? {} as OIAnalysisFactors;

  // ── Derive dominant OI state (merge 5m + 15m into single verdict) ──────────
  const oiTrend5 = f.oi_trend_5m ?? "NO_DATA";
  const oiTrend15 = f.oi_trend_15m ?? "NO_DATA";
  // 15m is the dominant trend; 5m is the execution context
  const dominantTrend = oiTrend15 !== "NO_DATA" ? oiTrend15 : oiTrend5;
  const dt = getOI(dominantTrend);

  // ── OI change: pick the more significant one ──────────────────────────────
  const oiChg5 = f.oi_change_pct_5m ?? 0;
  const oiChg15 = f.oi_change_pct_15m ?? 0;
  const oiChg = Math.abs(oiChg15) >= Math.abs(oiChg5) ? oiChg15 : oiChg5;

  // ── Volume: pick peak ─────────────────────────────────────────────────────
  const volRatio = Math.max(f.volume_ratio_5m ?? 0, f.volume_ratio_15m ?? 0);
  const hasVolSpike = f.volume_spike_5m || f.volume_spike_15m;

  // ── Build 8-factor grid entries ───────────────────────────────────────────
  type Factor = { label: string; value: string; active: boolean; icon: string };
  const factors: Factor[] = [];

  // 1. OI Flow State
  factors.push({
    label: "OI Flow",
    value: dt.label,
    active: dominantTrend !== "NO_DATA",
    icon: dominantTrend === "LONG_BUILDUP" ? "📈" : dominantTrend === "SHORT_BUILDUP" ? "📉" : dominantTrend === "SHORT_COVERING" ? "🔄" : dominantTrend === "LONG_UNWINDING" ? "⚠" : "—",
  });

  // 2. OI Change
  factors.push({
    label: "OI Change",
    value: oiChg !== 0 ? `${oiChg > 0 ? "+" : ""}${oiChg.toFixed(1)}%` : "0%",
    active: Math.abs(oiChg) > 0.1,
    icon: oiChg > 0 ? "↑" : oiChg < 0 ? "↓" : "—",
  });

  // 3. Volume Pressure
  factors.push({
    label: "Volume",
    value: hasVolSpike ? `${volRatio.toFixed(1)}x` : volRatio > 0.01 ? `${volRatio.toFixed(1)}x` : "—",
    active: hasVolSpike === true || volRatio > 1.0,
    icon: hasVolSpike ? "🔥" : volRatio > 1.0 ? "📊" : "—",
  });

  // 4. Price Action
  const hasBrkOut = f.price_breakout_5m || f.price_breakout_15m;
  const hasBrkDn = f.price_breakdown_5m || f.price_breakdown_15m;
  factors.push({
    label: "Price Action",
    value: hasBrkOut ? "Breakout" : hasBrkDn ? "Breakdown" : "Range",
    active: hasBrkOut || hasBrkDn,
    icon: hasBrkOut ? "🚀" : hasBrkDn ? "🔻" : "▬",
  });

  // 5. Liquidity Sweep
  const liqBuy = f.liquidity_sweep_buy_5m || f.liquidity_sweep_buy_15m;
  const liqSell = f.liquidity_sweep_sell_5m || f.liquidity_sweep_sell_15m;
  factors.push({
    label: "Liquidity",
    value: liqBuy ? "Buy Sweep" : liqSell ? "Sell Sweep" : "No Sweep",
    active: liqBuy || liqSell,
    icon: liqBuy || liqSell ? "💎" : "—",
  });

  // 6. Institutional Flow
  const flow5 = f.institutional_flow_5m ?? "NO_DATA";
  const flow15 = f.institutional_flow_15m ?? "NO_DATA";
  const instFlow = flow15 !== "NEUTRAL" && flow15 !== "NO_DATA" ? flow15 : flow5;
  factors.push({
    label: "Inst. Flow",
    value: instFlow !== "NEUTRAL" && instFlow !== "NO_DATA"
      ? instFlow.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase())
      : "Neutral",
    active: instFlow !== "NEUTRAL" && instFlow !== "NO_DATA",
    icon: instFlow === "ACCUMULATION" || instFlow === "AGGRESSIVE_BUYING" ? "🏦" : instFlow === "DISTRIBUTION" || instFlow === "AGGRESSIVE_SELLING" ? "🏚" : "—",
  });

  // 7. OI Velocity + Acceleration
  const vel = f.oi_velocity_5m ?? 0;
  const accel = f.oi_acceleration_5m ?? 0;
  factors.push({
    label: "OI Velocity",
    value: Math.abs(vel) > 0.1 ? `${vel > 0 ? "+" : ""}${vel.toFixed(1)}%${Math.abs(accel) > 0.3 ? (accel > 0 ? " ↗" : " ↘") : ""}` : "Flat",
    active: Math.abs(vel) > 0.3 || Math.abs(accel) > 0.3,
    icon: Math.abs(vel) > 0.3 || Math.abs(accel) > 0.3 ? "⚡" : "—",
  });

  // 8. Trap Detection
  factors.push({
    label: "Trap Alert",
    value: f.trap_detected ? (f.trap_type ?? "").replace(/_/g, " ") : "None",
    active: f.trap_detected,
    icon: f.trap_detected ? "🪤" : "✓",
  });

  const activeCount = factors.filter(f => f.active).length;
  const confLevel = confidence >= 75 ? "HIGH" : confidence >= 55 ? "MID" : "LOW";
  const confLevelColor = confidence >= 75 ? "text-emerald-400" : confidence >= 55 ? "text-amber-400" : "text-slate-500";

  return (
    <div className={`rounded-2xl border ${sig.border} overflow-hidden transition-all duration-300 shadow-lg ${sig.glow}`}>

      {/* ─── HEADER: Name + Signal + Price ────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-950/40">
        <div className="flex items-center gap-2">
          <p className="text-xs font-black text-white">{name}</p>
          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border ${sig.border} ${sig.bg} ${sig.color}`}>
            {sig.label}
          </span>
          {isLive && marketStatus === "LIVE" && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          )}
        </div>
        <span
          className={`
            inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs font-black transition-all duration-300
            ${flash === "up" ? "text-emerald-300 border-emerald-500/40 bg-emerald-900/20"
              : flash === "down" ? "text-red-300 border-red-500/40 bg-red-900/20"
              : displayPrice > 0 ? "text-white border-slate-700/40 bg-slate-800/40"
              : "text-slate-500 border-slate-700/30 bg-slate-800/30"}
          `}
        >
          {displayPrice > 0 ? (
            <>
              ₹{displayPrice.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
              {liveChangePct != null && (
                <span className={`text-[9px] font-bold ${liveChangePct > 0 ? "text-emerald-400" : liveChangePct < 0 ? "text-red-400" : "text-slate-400"}`}>
                  {liveChangePct > 0 ? "+" : ""}{liveChangePct.toFixed(2)}%
                </span>
              )}
            </>
          ) : "—"}
        </span>
      </div>

      <div className="px-3 py-2.5 space-y-2">

        {/* ─── SIGNAL + CONFIDENCE (hero row) ────────────────────────── */}
        <div className="flex items-center gap-3">
          {/* Confidence ring */}
          <div className="relative flex-shrink-0 w-14 h-14">
            <svg viewBox="0 0 56 56" className="w-14 h-14 -rotate-90">
              <circle cx="28" cy="28" r="24" fill="none" strokeWidth="3" className="stroke-slate-800/60" />
              <circle
                cx="28" cy="28" r="24" fill="none" strokeWidth="3"
                strokeDasharray={`${confidence * 1.508} 150.8`}
                strokeLinecap="round"
                className={`transition-all duration-700 ${
                  ["STRONG_BUY", "BUY"].includes(data.signal?.toUpperCase?.() ?? "") ? "stroke-emerald-500"
                  : ["SELL", "STRONG_SELL"].includes(data.signal?.toUpperCase?.() ?? "") ? "stroke-red-500"
                  : "stroke-slate-500"
                }`}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-sm font-black leading-none ${sig.color}`}>{confidence}%</span>
            </div>
          </div>

          {/* OI Flow state + tags */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`text-[10px] font-black px-2 py-0.5 rounded-md border ${dt.tag}`}>
                {dt.label}
              </span>
              {oiChg !== 0 && (
                <span className={`text-[9px] font-bold ${oiChg > 0 ? "text-emerald-400" : "text-red-400"}`}>
                  OI {oiChg > 0 ? "+" : ""}{oiChg.toFixed(1)}%
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {hasVolSpike && (
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300">
                  VOL {volRatio.toFixed(1)}x
                </span>
              )}
              {(hasBrkOut || hasBrkDn) && (
                <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded border ${hasBrkOut ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300" : "bg-red-500/15 border-red-500/30 text-red-300"}`}>
                  {hasBrkOut ? "BREAKOUT" : "BREAKDOWN"}
                </span>
              )}
              {f.trap_detected && (
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-rose-500/15 border border-rose-500/30 text-rose-300">
                  🪤 {(f.trap_type ?? "").replace(/_/g, " ")}
                </span>
              )}
              {(liqBuy || liqSell) && (
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-purple-500/15 border border-purple-500/30 text-purple-300">
                  💎 {liqBuy ? "BUY SWEEP" : "SELL SWEEP"}
                </span>
              )}
            </div>
            <p className={`text-[9px] mt-1 ${confLevelColor} font-bold`}>
              {activeCount}/8 factors · {confLevel} conviction
            </p>
          </div>
        </div>

        {/* ─── 8-FACTOR GRID ─────────────────────────────────────────── */}
        <div className="grid grid-cols-4 gap-1">
          {factors.map((fac, i) => (
            <div
              key={i}
              className={`rounded-lg px-1.5 py-1.5 text-center border transition-all ${
                fac.active
                  ? "bg-slate-800/50 border-slate-600/40"
                  : "bg-slate-900/30 border-slate-800/20"
              }`}
            >
              <span className="text-[10px] leading-none block">{fac.icon}</span>
              <p className={`text-[8px] font-bold mt-0.5 leading-tight ${fac.active ? "text-slate-300" : "text-slate-600"}`}>
                {fac.label}
              </p>
              <p className={`text-[9px] font-black leading-tight mt-0.5 ${
                fac.active ? sig.color : "text-slate-600"
              }`}>
                {fac.value}
              </p>
            </div>
          ))}
        </div>

        {/* ─── REASONS (compact) ─────────────────────────────────────── */}
        {data.reasons && data.reasons.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {data.reasons.slice(1, 4).map((r, i) => (
              <span key={i} className="text-[8px] px-1.5 py-0.5 rounded bg-slate-800/40 border border-slate-700/30 text-slate-400">
                {r}
              </span>
            ))}
          </div>
        )}

      </div>

      {/* ─── FOOTER ──────────────────────────────────────────────────── */}
      <div className="px-3 py-1 border-t border-white/5 flex justify-between items-center bg-slate-950/30">
        <span className="text-[8px] text-slate-600">
          {data.timestamp ? new Date(data.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}
        </span>
        <div className="flex items-center gap-1.5">
          {loading && data && (
            <span className="text-[8px] text-cyan-500 animate-pulse">↻</span>
          )}
          <span className={`text-[8px] font-bold ${isLive ? "text-emerald-500" : "text-amber-500"}`}>
            {isLive ? "● LIVE" : "○ Stale"}
          </span>
        </div>
      </div>
    </div>
  );
}
