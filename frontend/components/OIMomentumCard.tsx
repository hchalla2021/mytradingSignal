"use client";

import { useOIMomentumLive } from "@/hooks/useOIMomentumLive";
import { useMemo, useState, useEffect } from "react";

interface OIMomentumCardProps {
  symbol: string;
  name: string;
  livePrice?: number;
  liveChangePct?: number;
  marketStatus?: "LIVE" | "CLOSED" | "OFFLINE" | "PRE_OPEN" | "FREEZE";
}

type Direction = "UP" | "DOWN" | "FLAT";

// ── Signal display config: one source of truth for every signal variant ──────
const SIGS: Record<string, {
  label: string; color: string; bg: string; border: string; bar: string; strength: number;
}> = {
  STRONG_BUY:  { label: "STRONG BUY",  color: "text-emerald-300", bg: "bg-emerald-900/25", border: "border-emerald-500", bar: "from-emerald-500 to-green-400",  strength:  2 },
  BUY:         { label: "BUY",         color: "text-emerald-400", bg: "bg-emerald-900/15", border: "border-emerald-600", bar: "from-emerald-600 to-teal-500",   strength:  1 },
  BULLISH:     { label: "BULLISH",     color: "text-green-400",   bg: "bg-green-900/15",   border: "border-green-600",   bar: "from-green-600 to-emerald-500",  strength:  1 },
  SELL:        { label: "SELL",        color: "text-red-400",     bg: "bg-red-900/15",     border: "border-red-600",     bar: "from-red-600 to-rose-500",       strength: -1 },
  STRONG_SELL: { label: "STRONG SELL", color: "text-rose-300",    bg: "bg-rose-900/25",    border: "border-rose-500",    bar: "from-rose-500 to-red-400",       strength: -2 },
  BEARISH:     { label: "BEARISH",     color: "text-red-400",     bg: "bg-red-900/15",     border: "border-red-600",     bar: "from-red-600 to-rose-500",       strength: -1 },
  NEUTRAL:     { label: "NEUTRAL",     color: "text-slate-400",   bg: "bg-slate-800/25",   border: "border-slate-600",   bar: "from-slate-600 to-slate-500",    strength:  0 },
  NO_SIGNAL:   { label: "NO SIGNAL",   color: "text-slate-500",   bg: "bg-slate-800/15",   border: "border-slate-700",   bar: "from-slate-700 to-slate-600",    strength:  0 },
};

const getSig = (s?: string | null) => SIGS[(s ?? "").toUpperCase()] ?? SIGS.NO_SIGNAL;

// ── Confidence: adjust raw API value for current market state ────────────────
function adjustConf(base: number, status: string): number {
  if (status === "LIVE") {
    if (base >= 80) return Math.min(98, base + 8);
    if (base >= 70) return Math.min(95, base + 5);
    if (base >= 60) return Math.min(90, base + 3);
    return base;
  }
  if (status === "PRE_OPEN" || status === "FREEZE") return Math.max(30, base - 15);
  return Math.max(20, base - 25); // CLOSED / OFFLINE
}

// ── 5-min directional outlook — probability is INDEPENDENT of confidence ─────
// Confidence tells the trader "how reliable is the signal classification".
// Outlook probability tells "how likely is the predicted direction to play out".
// These are different — deriving one from the other would make them circular.
function fiveMinOutlook(
  data: { signal_5m: string; signal_15m: string; metrics?: Record<string, number | boolean> },
): { dir: Direction; prob: number; context: string } {
  const m   = (data.metrics ?? {}) as Record<string, number | boolean>;
  const s5  = SIGS[data.signal_5m?.toUpperCase()]?.strength  ?? 0;
  const s15 = SIGS[data.signal_15m?.toUpperCase()]?.strength ?? 0;
  const combo   = s15 * 0.6 + s5 * 0.4;
  const aligned = s5 !== 0 && Math.sign(s5) === Math.sign(s15);
  const dir: Direction = combo > 0.2 ? "UP" : combo < -0.2 ? "DOWN" : "FLAT";

  // Fresh factor scoring: 0–85 points → mapped to 20–95% probability
  let pts = 0;

  // 1. Signal agreement (0–35 pts) — the single biggest driver
  if (aligned && Math.abs(combo) >= 1.5)      pts += 35; // both STRONG same dir
  else if (aligned && Math.abs(combo) >= 0.8) pts += 25; // clearly aligned
  else if (aligned)                            pts += 15; // weakly aligned
  else if (s5 !== 0 && s15 !== 0)              pts -=  8; // direct conflict

  // 2. Volume confirmation (0–20 pts)
  if (m.volume_spike_5m  && m.volume_spike_15m)         pts += 20;
  else if (m.volume_spike_5m || m.volume_spike_15m)     pts += 10;

  // 3. OI confirmation — works for both buildup (BUY) and reduction (SELL) (0–15 pts)
  const oi5  = !!(m.oi_buildup_5m  || m.oi_reduction_5m);
  const oi15 = !!(m.oi_buildup_15m || m.oi_reduction_15m);
  if (oi5 && oi15) pts += 15;
  else if (oi5 || oi15) pts += 8;

  // 4. Liquidity grab either side (0–8 pts)
  const liq5  = !!(m.liquidity_grab_5m  || m.liquidity_grab_sell_5m);
  const liq15 = !!(m.liquidity_grab_15m || m.liquidity_grab_sell_15m);
  if (liq5 || liq15) pts += 8;

  // 5. Price structure confirmed (0–7 pts)
  const p5  = !!(m.price_breakout_5m  || m.price_breakdown_5m);
  const p15 = !!(m.price_breakout_15m || m.price_breakdown_15m);
  if (p5 && p15) pts += 7;
  else if (p5 || p15) pts += 4;

  // max pts = 85 → maps to 95%; base 40% when no factors fire
  const prob = Math.round(Math.min(95, Math.max(20, 40 + (Math.max(0, pts) / 85) * 55)));

  const CTXS: Record<Direction, Record<string, string>> = {
    UP: {
      aligned_vol: "Continuation likely · vol confirms",
      aligned:     "Upward bias · watching OI build",
      conflict:    "Bounce attempt · monitor for reversal",
      default:     "Mild bullish bias · wait for vol",
    },
    DOWN: {
      aligned_vol: "Downside continuation · selling pressure",
      aligned:     "Bearish continuation · OI shifting",
      conflict:    "Pullback · watch support levels",
      default:     "Mild bearish bias · low conviction",
    },
    FLAT: {
      aligned_vol: "Range-bound · breakout watch",
      aligned:     "Consolidating · direction unclear",
      conflict:    "Mixed signals · stay out",
      default:     "Range-bound · wait for breakout",
    },
  };

  const ctxKey =
    aligned && (m.volume_spike_5m || m.volume_spike_15m) ? "aligned_vol"
    : aligned                                             ? "aligned"
    : !aligned && s5 !== 0 && s15 !== 0                   ? "conflict"
    : "default";

  return { dir, prob, context: CTXS[dir][ctxKey] };
}

export default function OIMomentumCard({
  symbol,
  name,
  livePrice,
  liveChangePct,
  marketStatus = "OFFLINE",
}: OIMomentumCardProps) {
  const { data, isLive } = useOIMomentumLive(symbol);
  const [prevPrice, setPrevPrice] = useState(0);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  const displayPrice = livePrice ?? data?.current_price ?? 0;

  const confidence = useMemo(
    () => (data ? adjustConf(data.confidence ?? 50, marketStatus) : 0),
    [data, marketStatus]
  );

  // ── All hooks must run before any conditional return ─────────────────────
  const confLabel =
    confidence >= 80 ? "High reliability" :
    confidence >= 60 ? "Medium reliability" : "Low reliability";

  // Derive signal strengths safely (0 when data is null)
  const _s5strength  = data ? (SIGS[data.signal_5m?.toUpperCase()]?.strength  ?? 0) : 0;
  const _s15strength = data ? (SIGS[data.signal_15m?.toUpperCase()]?.strength ?? 0) : 0;
  const _m = (data?.metrics ?? {}) as Record<string, number | boolean>;

  const confSubtitle = useMemo(() => {
    const bothActive  = _s5strength !== 0 && _s15strength !== 0;
    const bothAligned = bothActive && Math.sign(_s5strength) === Math.sign(_s15strength);
    const strongVol   = !!(_m.volume_spike_5m || _m.volume_spike_15m);
    if (bothAligned && strongVol)   return `5m + 15m aligned · vol spike · ${confLabel}`;
    if (bothAligned)                return `5m + 15m aligned · ${confLabel}`;
    if (_s15strength !== 0 && _s5strength === 0) return `15m trend active · 5m neutral · ${confLabel}`;
    if (_s5strength !== 0 && _s15strength === 0) return `5m signal · 15m waiting · ${confLabel}`;
    if (bothActive && !bothAligned) return `⚠ 5m vs 15m conflict · ${confLabel}`;
    return `Signals forming · ${confLabel}`;
  }, [_s5strength, _s15strength, _m.volume_spike_5m, _m.volume_spike_15m, confLabel]);

  // Flash price green/red on change
  useEffect(() => {
    if (!displayPrice || displayPrice === prevPrice) return;
    setFlash(displayPrice > prevPrice ? "up" : "down");
    const t = setTimeout(() => setFlash(null), 700);
    setPrevPrice(displayPrice);
    return () => clearTimeout(t);
  }, [displayPrice, prevPrice]);

  if (!data) {
    return (
      <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-4 animate-pulse min-h-[220px]" />
    );
  }

  const final   = getSig(data.final_signal);
  const s5      = getSig(data.signal_5m);
  const s15     = getSig(data.signal_15m);
  const m       = data.metrics ?? {};
  const outlook = fiveMinOutlook(data);
  // Adjust outlook probability for market status (same logic as signal confidence)
  const outlookConf = adjustConf(outlook.prob, marketStatus);

  // ── Signal drivers: buy-side AND sell-side ────────────────────────────────
  const isBearish = s5.strength < 0 || s15.strength < 0;
  const drivers: Array<{ label: string; value: string; active: boolean }> = [];

  // Liquidity grab (buy-side or sell-side)
  const liqBuy  = !!(m.liquidity_grab_5m  || m.liquidity_grab_15m);
  const liqSell = !!(m.liquidity_grab_sell_5m || m.liquidity_grab_sell_15m);
  if (liqBuy || liqSell) {
    const tf = (liqBuy && liqSell)
      ? "Both TFs" : (m.liquidity_grab_5m || m.liquidity_grab_sell_5m) ? "5m" : "15m";
    drivers.push({ label: isBearish ? "Dist. Zone Grab" : "Liquidity Grab", value: tf, active: true });
  }

  // OI activity (buildup for BUY, reduction for SELL)
  const oiBuy  = !!(m.oi_buildup_5m  || m.oi_buildup_15m);
  const oiSell = !!(m.oi_reduction_5m || m.oi_reduction_15m);
  if (oiBuy || oiSell) {
    const pct = Math.max(
      (m.oi_change_pct_5m as number | undefined) ?? 0,
      (m.oi_change_pct_15m as number | undefined) ?? 0
    );
    drivers.push({
      label: oiSell && !oiBuy ? "OI Reduction" : "OI Build-up",
      value: `${oiSell && !oiBuy ? "" : "+"}${pct.toFixed(1)}%`,
      active: true,
    });
  }

  // Volume spike
  if (m.volume_spike_5m || m.volume_spike_15m) {
    const r = Math.max(
      (m.volume_ratio_5m  as number | undefined) ?? 0,
      (m.volume_ratio_15m as number | undefined) ?? 0
    );
    drivers.push({ label: "Volume Spike", value: `${r.toFixed(1)}x avg`, active: true });
  }

  // Price structure (breakout for BUY, breakdown for SELL)
  if (drivers.length < 3) {
    const pb5  = !!(m.price_breakout_5m  || m.price_breakdown_5m);
    const pb15 = !!(m.price_breakout_15m || m.price_breakdown_15m);
    if (pb5 || pb15) {
      const isBd = !!(m.price_breakdown_5m || m.price_breakdown_15m);
      drivers.push({ label: isBd ? "Price Breakdown" : "Price Breakout", value: "Confirmed", active: true });
    }
  }

  while (drivers.length < 2) {
    drivers.push({ label: "No factor active", value: "—", active: false });
  }

  // Outlook color / bg helpers
  const outlookColor =
    outlook.dir === "UP"   ? "text-emerald-400" :
    outlook.dir === "DOWN" ? "text-red-400"      : "text-slate-400";
  // Split bg and border so sub-section border colors are independently vivid
  const outlookBgOnly =
    outlook.dir === "UP"   ? "bg-emerald-900/15" :
    outlook.dir === "DOWN" ? "bg-red-900/15"      : "bg-slate-800/20";
  const outlookBorder =
    outlook.dir === "UP"   ? "border-emerald-500" :
    outlook.dir === "DOWN" ? "border-red-500"      : "border-slate-600";

  return (
    <div className={`rounded-xl border-2 ${final.border} ${final.bg} overflow-hidden`}>

      {/* ─── HEADER: name · price · live status ─────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <div>
          <p className="text-[11px] font-black text-white leading-tight">{name}</p>
          <p className="text-[9px] text-slate-500 font-mono">{symbol}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isLive && marketStatus === "LIVE" && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[9px] font-bold text-emerald-400">LIVE</span>
            </span>
          )}
          {(marketStatus === "PRE_OPEN" || marketStatus === "FREEZE") && (
            <span className="text-[9px] font-bold text-amber-400">
              {marketStatus === "FREEZE" ? "FREEZE" : "PRE-OPEN"}
            </span>
          )}
          <span
            className={`
              inline-flex items-center gap-1.5
              px-2 py-0.5 rounded-md border whitespace-nowrap
              text-sm font-black transition-all duration-300
              ${flash === "up"
                ? "text-emerald-300 border-emerald-400 bg-emerald-900/20"
                : flash === "down"
                ? "text-red-300 border-red-400 bg-red-900/20"
                : displayPrice > 0
                ? `text-white ${final.border} bg-slate-800/40`
                : "text-slate-500 border-slate-700 bg-slate-800/30"}
            `}
          >
            {displayPrice > 0
              ? (
                <>
                  <span>₹{displayPrice.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
                  {liveChangePct != null && (
                    <span
                      className={`text-[10px] font-bold ${
                        liveChangePct > 0 ? "text-emerald-400" :
                        liveChangePct < 0 ? "text-red-400" : "text-slate-400"
                      }`}
                    >
                      {liveChangePct > 0 ? "▲" : liveChangePct < 0 ? "▼" : ""}
                      {liveChangePct > 0 ? "+" : ""}{liveChangePct.toFixed(2)}%
                    </span>
                  )}
                </>
              )
              : "₹ —"}
          </span>
        </div>
      </div>

      <div className="p-3 space-y-2.5">

        {/* ─── FINAL SIGNAL + CONFIDENCE BAR ──────────────────────────────── */}
        <div className="flex items-center gap-3">
          {/* Left: label + bar */}
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-black tracking-wide ${final.color}`}>{final.label}</p>
            <div className="mt-1.5 h-1.5 bg-slate-900/60 rounded-full overflow-hidden border border-white/5">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${final.bar} transition-all duration-700`}
                style={{ width: `${confidence}%` }}
              />
            </div>
            <p className="text-[9px] text-slate-500 mt-0.5">{confSubtitle}</p>
          </div>
          {/* Right: % number */}
          <div className="flex-shrink-0 text-right">
            <p className={`text-2xl font-black leading-none ${final.color}`}>{confidence}%</p>
            <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wide">Confidence</p>
          </div>
        </div>

        {/* ─── 5m ENTRY TIMING  /  15m TREND DIRECTION ────────────────────── */}
        <div className="grid grid-cols-2 gap-2">

          {/* 5m */}
          <div className={`bg-slate-900/50 border rounded-lg p-2.5 ${s5.border}`}>
            <p className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1">
              5m Entry Timing
            </p>
            <p className={`text-[11px] font-black mb-2 ${s5.color}`}>{s5.label}</p>
            <div className="space-y-0.5">
              <div className="flex justify-between text-[9px]">
                <span className="text-slate-600">Volume</span>
                <span className={(m.volume_spike_5m as boolean) ? "text-emerald-400 font-bold" : "text-slate-600"}>
                  {((m.volume_ratio_5m as number) ?? 0) > 0 ? `${((m.volume_ratio_5m as number) ?? 0).toFixed(1)}x` : "—"}
                </span>
              </div>
              <div className="flex justify-between text-[9px]">
                <span className="text-slate-600">OI Δ</span>
                <span className={(m.oi_buildup_5m as boolean) ? "text-emerald-400 font-bold" : "text-slate-600"}>
                  {((m.oi_change_pct_5m as number) ?? 0) !== 0
                    ? `${((m.oi_change_pct_5m as number) ?? 0) > 0 ? "+" : ""}${((m.oi_change_pct_5m as number) ?? 0).toFixed(1)}%`
                    : "—"}
                </span>
              </div>
            </div>
          </div>

          {/* 15m */}
          <div className={`bg-slate-900/50 border rounded-lg p-2.5 ${s15.border}`}>
            <p className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1">
              15m Trend Direction
            </p>
            <p className={`text-[11px] font-black mb-2 ${s15.color}`}>{s15.label}</p>
            <div className="space-y-0.5">
              <div className="flex justify-between text-[9px]">
                <span className="text-slate-600">Volume</span>
                <span className={(m.volume_spike_15m as boolean) ? "text-emerald-400 font-bold" : "text-slate-600"}>
                  {((m.volume_ratio_15m as number) ?? 0) > 0 ? `${((m.volume_ratio_15m as number) ?? 0).toFixed(1)}x` : "—"}
                </span>
              </div>
              <div className="flex justify-between text-[9px]">
                <span className="text-slate-600">OI Δ</span>
                <span className={(m.oi_buildup_15m as boolean) ? "text-emerald-400 font-bold" : "text-slate-600"}>
                  {((m.oi_change_pct_15m as number) ?? 0) !== 0
                    ? `${((m.oi_change_pct_15m as number) ?? 0) > 0 ? "+" : ""}${((m.oi_change_pct_15m as number) ?? 0).toFixed(1)}%`
                    : "—"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ─── SIGNAL DRIVERS ──────────────────────────────────────────────── */}
        <div className={`bg-slate-900/40 border rounded-lg px-2.5 py-2 ${final.border}`}>
          <p className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
            Signal Drivers
          </p>
          <div className="space-y-1">
            {drivers.slice(0, 3).map((d, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`w-1 h-1 rounded-full flex-shrink-0 ${
                      d.active ? "bg-emerald-400" : "bg-slate-700"
                    }`}
                  />
                  <span className={`text-[10px] ${d.active ? "text-slate-300" : "text-slate-600"}`}>
                    {d.label}
                  </span>
                </div>
                <span className={`text-[10px] font-bold ${d.active ? final.color : "text-slate-600"}`}>
                  {d.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ─── 5-MIN PREDICTION ─────────────────────────────────────────────── */}
        <div className={`rounded-lg border px-2.5 py-2 ${outlookBgOnly} ${outlookBorder}`}>
          <p className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
            5-Min Prediction
          </p>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className={`flex items-center gap-1 ${outlookColor}`}>
                <span className="text-base font-black leading-none">
                  {outlook.dir === "UP" ? "▲" : outlook.dir === "DOWN" ? "▼" : "▬"}
                </span>
                <span className="text-xs font-black">{outlook.dir}</span>
              </div>
              <p className="text-[9px] text-slate-500 mt-0.5 leading-tight">{outlook.context}</p>
            </div>
            <div className="flex-shrink-0 text-right">
              <p className={`text-2xl font-black leading-none ${outlookColor}`}>{outlookConf}%</p>
              <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wide">Confidence</p>
            </div>
          </div>
        </div>

      </div>

      {/* ─── FOOTER: timestamp + live/cached ────────────────────────────── */}
      <div className="px-3 py-1.5 border-t border-white/5 flex justify-between items-center">
        <span className="text-[9px] text-slate-600">
          {new Date(data.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </span>
        <span className={`text-[9px] font-bold ${isLive ? "text-emerald-500" : "text-slate-600"}`}>
          {isLive ? "● Live" : "○ Cached"}
        </span>
      </div>
    </div>
  );
}

