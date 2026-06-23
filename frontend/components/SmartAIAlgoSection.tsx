'use client';

/**
 * SmartAIAlgoSection — Premium Institutional Algo Trading Panel
 * =============================================================
 * Bloomberg Terminal × Dark Glass aesthetic
 * Mobile-first responsive: 1-col (mobile) → 2-col (tablet) → 3-col (desktop)
 * Performance: React.memo, useMemo, CSS transitions only (no JS animation loops)
 */

import React, { useMemo, useCallback, useState, useRef, useEffect } from 'react';
import { useSmartAlgo, AlgoSignal, AlgoIndicators } from '@/hooks/useSmartAlgo';

// ─── formatters ───────────────────────────────────────────────────────────────

const fmt = (v: number, d = 2): string =>
  v == null || !isFinite(v) || v === 0 ? '—' : v.toFixed(d);

const fmtPct = (v: number): string =>
  v == null || !isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

// ─── design tokens ────────────────────────────────────────────────────────────

const SIG = {
  BUY: {
    outerBorder: 'border-emerald-500/60',
    innerGlow:   'shadow-[0_0_40px_rgba(16,185,129,0.25)]',
    headerBg:    'from-emerald-950/80 via-emerald-900/40 to-transparent',
    priceBg:     'bg-gradient-to-br from-emerald-500/15 to-teal-500/5 border-emerald-400/40',
    badgeBg:     'bg-gradient-to-r from-emerald-500/25 to-teal-500/15 text-emerald-100 border-emerald-400/60',
    badgeGlow:   'shadow-[0_0_16px_rgba(16,185,129,0.5)]',
    barBg:       'bg-gradient-to-r from-emerald-500 to-teal-500',
    dot:         'bg-emerald-400',
    icon:        '🟢',
    label:       'BUY',
    textColor:   'text-emerald-300',
    pillBorder:  'border-emerald-500/50',
    pillBg:      'bg-emerald-950/25',
  },
  SELL: {
    outerBorder: 'border-red-500/60',
    innerGlow:   'shadow-[0_0_40px_rgba(239,68,68,0.25)]',
    headerBg:    'from-red-950/80 via-red-900/40 to-transparent',
    priceBg:     'bg-gradient-to-br from-red-500/15 to-pink-500/5 border-red-400/40',
    badgeBg:     'bg-gradient-to-r from-red-500/25 to-pink-500/15 text-red-100 border-red-400/60',
    badgeGlow:   'shadow-[0_0_16px_rgba(239,68,68,0.5)]',
    barBg:       'bg-gradient-to-r from-red-500 to-pink-500',
    dot:         'bg-red-400',
    icon:        '🔴',
    label:       'SELL',
    textColor:   'text-red-300',
    pillBorder:  'border-red-500/50',
    pillBg:      'bg-red-950/25',
  },
  WAIT: {
    outerBorder: 'border-cyan-600/50',
    innerGlow:   'shadow-[0_0_30px_rgba(34,211,238,0.12)]',
    headerBg:    'from-slate-800/70 via-slate-900/50 to-cyan-900/20',
    priceBg:     'bg-gradient-to-br from-slate-700/20 to-cyan-500/5 border-cyan-600/30',
    badgeBg:     'bg-gradient-to-r from-amber-500/20 to-cyan-500/10 text-amber-100 border-amber-500/50',
    badgeGlow:   'shadow-[0_0_12px_rgba(251,191,36,0.3)]',
    barBg:       'bg-gradient-to-r from-amber-500 to-yellow-500',
    dot:         'bg-cyan-400',
    icon:        '⏳',
    label:       'WAIT',
    textColor:   'text-cyan-300',
    pillBorder:  'border-cyan-600/40',
    pillBg:      'bg-slate-800/40',
  },
} as const;

type SigKey = keyof typeof SIG;

const REGIME: Record<string, { icon: string; label: string; color: string }> = {
  TRENDING_UP:   { icon: '↑', label: 'Trending Up',   color: 'text-emerald-400' },
  TRENDING_DOWN: { icon: '↓', label: 'Trending Down', color: 'text-red-400'     },
  SIDEWAYS:      { icon: '↔', label: 'Sideways',      color: 'text-amber-400'   },
  VOLATILE:      { icon: '⚡', label: 'Volatile',      color: 'text-violet-400'  },
  UNKNOWN:       { icon: '·', label: 'Detecting…',    color: 'text-slate-500'   },
};

// ─── flash hook ───────────────────────────────────────────────────────────────

function useFlashClass(value: number): string {
  const prev = useRef(value);
  const [cls, setCls] = useState('');
  useEffect(() => {
    if (prev.current === value) return;
    const up = value > prev.current;
    prev.current = value;
    setCls(up ? 'animate-flash-green' : 'animate-flash-red');
    const t = setTimeout(() => setCls(''), 700);
    return () => clearTimeout(t);
  }, [value]);
  return cls;
}

// ─── ConfidenceRing ───────────────────────────────────────────────────────────

const ConfidenceRing = React.memo(function ConfidenceRing({
  value, signal,
}: { value: number; signal: SigKey }) {
  const r = 18;
  const circ = 2 * Math.PI * r;
  const dash = (value / 100) * circ;
  const color = signal === 'BUY' ? '#10b981' : signal === 'SELL' ? '#ef4444' : '#f59e0b';
  return (
    <div className="relative flex items-center justify-center w-12 h-12 shrink-0">
      <svg width="48" height="48" className="-rotate-90">
        <circle cx="24" cy="24" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3.5" />
        <circle
          cx="24" cy="24" r={r} fill="none"
          stroke={color} strokeWidth="3.5"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <span className="absolute text-[11px] font-black text-white">{value}</span>
    </div>
  );
});

// ─── PriceCell ────────────────────────────────────────────────────────────────

const PriceCell = React.memo(function PriceCell({
  label, value, color, sublabel,
}: { label: string; value: string; color: string; sublabel?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-3 px-2 rounded-lg bg-gradient-to-b from-slate-700/30 to-slate-800/50 border border-slate-600/50 shadow-[0_4px_12px_rgba(0,0,0,0.3)]">
      <span className="text-[9px] sm:text-[10px] md:text-xs font-bold text-slate-300 tracking-widest uppercase leading-none">
        {label}
      </span>
      <span className={`text-sm sm:text-base md:text-lg font-black font-mono leading-tight ${color}`}>
        {value}
      </span>
      {sublabel && <span className="text-[9px] sm:text-[10px] text-slate-400 font-medium">{sublabel}</span>}
    </div>
  );
});

// ─── IndicatorPill ────────────────────────────────────────────────────────────

const IndicatorPill = React.memo(function IndicatorPill({
  label, value, ok,
}: { label: string; value: string; ok?: boolean | null }) {
  const statusColor =
    ok === true  ? 'text-emerald-200 border-emerald-500/50 bg-gradient-to-r from-emerald-950/40 to-emerald-900/20 shadow-[0_0_8px_rgba(16,185,129,0.15)]' :
    ok === false ? 'text-red-200     border-red-500/50     bg-gradient-to-r from-red-950/40 to-red-900/20 shadow-[0_0_8px_rgba(239,68,68,0.15)]'     :
                   'text-slate-300   border-slate-700/50   bg-gradient-to-r from-slate-800/40 to-slate-700/30 shadow-[0_0_6px_rgba(0,0,0,0.2)]';
  const dot =
    ok === true  ? 'bg-emerald-400' :
    ok === false ? 'bg-red-400'     : 'bg-slate-500';

  return (
    <div className={`flex items-center justify-between px-3 py-2.5 rounded-lg border ${statusColor} gap-2 transition-all duration-200`}>
      <div className="flex items-center gap-2 min-w-0">
        <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
        <span className="text-[10px] sm:text-[11px] md:text-xs font-semibold text-slate-300 truncate leading-none">
          {label}
        </span>
      </div>
      <span className="text-[10px] sm:text-[11px] md:text-xs font-mono font-bold text-right shrink-0 leading-none">
        {value}
      </span>
    </div>
  );
});

// ─── Stepper ──────────────────────────────────────────────────────────────────

const Stepper = React.memo(function Stepper({
  label, icon, value, step, min, max, onChange, color,
}: {
  label: string; icon: string; value: number; step: number;
  min: number; max: number; onChange: (v: number) => void; color: string;
}) {
  return (
    <div className="flex items-center gap-2 flex-1 min-w-0">
      <span className="text-lg sm:text-xl leading-none shrink-0">{icon}</span>
      <span className={`text-[11px] sm:text-xs md:text-sm font-bold w-14 sm:w-16 shrink-0 truncate ${color}`}>{label}</span>
      <div className="flex items-center gap-1.5 flex-1">
        <button
          onClick={() => onChange(Math.max(min, value - step))}
          className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-slate-800/80 hover:bg-slate-700 active:scale-95
            border border-slate-600/50 text-slate-300 text-base font-bold
            flex items-center justify-center transition-all duration-100
            select-none touch-manipulation"
          aria-label={`Decrease ${label}`}
        >−</button>
        <span className="text-sm sm:text-base font-black text-white w-10 sm:w-12 text-center tabular-nums">{value}</span>
        <button
          onClick={() => onChange(Math.min(max, value + step))}
          className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-slate-800/80 hover:bg-slate-700 active:scale-95
            border border-slate-600/50 text-slate-300 text-base font-bold
            flex items-center justify-center transition-all duration-100
            select-none touch-manipulation"
          aria-label={`Increase ${label}`}
        >+</button>
      </div>
    </div>
  );
});

// ─── SymbolCard ───────────────────────────────────────────────────────────────

interface SymbolCardProps {
  algo: AlgoSignal;
  slPoints: number;
  targetPoints: number;
  lotCount: number;
  isLotDirty: boolean;
  algoEnabled: boolean;
  onSlChange: (v: number) => void;
  onTargetChange: (v: number) => void;
  onLotChange: (v: number) => void;
  onSaveLot: () => void;
}

const SymbolCard = React.memo(function SymbolCard({
  algo, slPoints, targetPoints, lotCount, isLotDirty, algoEnabled, onSlChange, onTargetChange, onLotChange, onSaveLot,
}: SymbolCardProps) {
  const sig = (algo.signal in SIG ? algo.signal : 'WAIT') as SigKey;
  const s = SIG[sig];
  const r = REGIME[algo.regime] ?? REGIME.UNKNOWN;
  const ind: Partial<AlgoIndicators> = algo.indicators ?? {};
  const flashCls = useFlashClass(algo.entry_price);
  const isActive = sig !== 'WAIT';
  const hasSignalPrices = isActive && algo.entry_price > 0;

  const vwapOk = typeof ind.price === 'number' && typeof ind.vwap === 'number' && ind.vwap > 0
    ? ind.price > ind.vwap : null;
  const liqSweepLabel = ind.near_high ? '⚡ Near Day High' : ind.near_low ? '⚡ Near Day Low' : 'Clear';
  const liqSweepOk = sig === 'BUY' ? (ind.near_low ?? null) : sig === 'SELL' ? (ind.near_high ?? null) : null;
  const emaAlignLabel = ind.ema20_above_ema100 && ind.ema100_above_ema200
    ? '20 › 100 › 200' : ind.ema20_above_ema100 === false ? '20 ‹ 100' : '100 › 200';
  const pnlAmt = algo.option_unrealized_pnl_amount ?? 0;
  const pnlPts = algo.option_unrealized_pnl_points ?? 0;
  const pnlColor = pnlAmt > 0 ? 'text-emerald-300' : pnlAmt < 0 ? 'text-red-300' : 'text-slate-200';
  const autoReady = Boolean(algo.auto_buy_ready);
  const inferredSide = sig === 'BUY' ? 'CE' : sig === 'SELL' ? 'PE' : undefined;
  const autoSide = algo.recommended_option_side ?? algo.option_type ?? inferredSide ?? 'CE/PE';
  const autoBestBuy = [
    algo.option_best_buy_price,
    algo.option_best_ask_price,
    algo.option_ltp,
  ].find((v) => typeof v === 'number' && (v as number) > 0) ?? 0;
  const autoBestBuyLabel = autoBestBuy > 0 ? fmt(autoBestBuy) : 'Calculating...';
  const gatePassed = Boolean(algo.auto_buy_gate_passed);
  const aiPassed = Boolean(algo.auto_buy_ai_passed);
  const aiConf = algo.auto_buy_ai_confidence ?? 0;
  const autoReason =
    algo.auto_buy_block_reason ||
    algo.auto_buy_gate_reason ||
    algo.auto_buy_ai_reason ||
    (isActive ? 'Monitoring confluence and AI confirmation.' : 'Waiting for directional setup.');

  return (
    <div className={`
      relative flex flex-col rounded-2xl border overflow-hidden
      ${s.outerBorder} ${s.innerGlow}
      bg-gradient-to-br from-[#0f141f] via-[#0a0f1a] to-[#050810]
      shadow-[0_8px_32px_rgba(0,0,0,0.4)]
      transition-all duration-300
      ${!algoEnabled ? 'opacity-60 grayscale-[30%]' : ''}
    `}>
      {/* Header band */}
      <div className={`relative flex items-center justify-between px-4 sm:px-5 py-3 bg-gradient-to-r ${s.headerBg}`}>
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${s.dot} ${isActive ? 'animate-pulse' : ''}`} />
          <span className="text-base sm:text-lg md:text-xl font-black text-white tracking-tight leading-none">
            {algo.symbol}
          </span>
          {algo.ai_powered && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[8px] font-black
              bg-gradient-to-r from-violet-600/50 to-indigo-600/50 text-violet-200
              border border-violet-500/40 shadow-[0_0_8px_rgba(139,92,246,0.3)] leading-none">
              AI ✦
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`px-2.5 sm:px-3 py-1 rounded-lg text-[11px] sm:text-xs font-black border ${s.badgeBg} ${s.badgeGlow} tracking-wider`}>
            {s.label}
          </span>
          <span className={`hidden sm:flex items-center gap-0.5 text-[10px] font-semibold ${r.color}`}>
            <span>{r.icon}</span><span className="hidden md:inline">{r.label}</span>
          </span>
        </div>
      </div>

      {/* Thin divider */}
      <div className={`h-px mx-3 ${isActive ? `bg-gradient-to-r from-transparent via-current to-transparent ${s.textColor} opacity-25` : 'bg-slate-800/80'}`} />

      {/* Card body */}
      <div className="flex flex-col gap-4 p-4 sm:p-5">

        {/* Confidence row */}
        <div className="flex items-center gap-4">
          <ConfidenceRing value={algo.confidence} signal={sig} />
          <div className="flex flex-col gap-2 flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-[11px] sm:text-xs text-slate-400 font-bold tracking-wide">CONFIDENCE</span>
              <span className={`text-base sm:text-lg font-black ${s.textColor}`}>{algo.confidence}%</span>
            </div>
            <div className="h-2.5 bg-slate-800/80 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${s.barBg} transition-[width] duration-700 ease-out`}
                style={{ width: `${algo.confidence}%` }}
              />
            </div>
            <span className={`flex items-center gap-1.5 text-[10px] sm:text-[11px] font-bold ${r.color}`}>
              <span className="text-base">{r.icon}</span><span className="tracking-wider">{r.label}</span>
            </span>
          </div>
        </div>

        {/* Auto-buy preview directly under confidence */}
        <div className="rounded-lg border border-cyan-600/30 bg-gradient-to-r from-slate-900/45 to-cyan-900/15 px-3 py-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] sm:text-[11px] font-bold text-cyan-300 tracking-wide">AUTO BUY PREVIEW</span>
            <span className={`text-[10px] sm:text-[11px] font-black ${autoReady ? 'text-emerald-300' : 'text-amber-300'}`}>
              {autoReady ? 'READY' : 'WAITING'}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] sm:text-[11px]">
            <span className="text-slate-300 font-semibold">
              Side: <span className="text-white font-black">{autoSide}</span>
            </span>
            <span className="text-slate-300 font-semibold">
              Best Buy: <span className="text-emerald-300 font-black">{autoBestBuyLabel}</span>
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <span className={`px-2 py-1 rounded-md text-[9px] sm:text-[10px] font-bold text-center border ${gatePassed ? 'text-emerald-200 border-emerald-500/40 bg-emerald-900/20' : 'text-amber-200 border-amber-500/40 bg-amber-900/20'}`}>
              ALGO {gatePassed ? 'PASS' : 'CHECK'}
            </span>
            <span className={`px-2 py-1 rounded-md text-[9px] sm:text-[10px] font-bold text-center border ${aiPassed ? 'text-emerald-200 border-emerald-500/40 bg-emerald-900/20' : 'text-violet-200 border-violet-500/40 bg-violet-900/20'}`}>
              AI {aiPassed ? `PASS ${aiConf}%` : 'PENDING'}
            </span>
            <span className={`px-2 py-1 rounded-md text-[9px] sm:text-[10px] font-bold text-center border ${autoReady ? 'text-emerald-200 border-emerald-500/40 bg-emerald-900/20' : 'text-slate-200 border-slate-600/40 bg-slate-800/40'}`}>
              EXEC {autoReady ? 'ARMED' : 'HOLD'}
            </span>
          </div>
          <div className="text-[10px] sm:text-[11px] text-slate-300 leading-relaxed">
            {autoReason}
          </div>
        </div>

        {/* Price grid: always mounted to avoid flicker on state transitions */}
        <div className="space-y-2.5">
          <div className="grid grid-cols-4 gap-2.5">
            <div className={hasSignalPrices ? flashCls : ''}>
              <PriceCell label="ENTRY" value={hasSignalPrices ? fmt(algo.entry_price) : '—'} color="text-white font-black" />
            </div>
            <PriceCell
              label="SL"
              value={hasSignalPrices ? fmt(algo.stop_loss) : '—'}
              color="text-red-400"
              sublabel={`−${slPoints}pt`}
            />
            <PriceCell
              label="TARGET"
              value={hasSignalPrices ? fmt(algo.target) : '—'}
              color="text-emerald-400"
              sublabel={`+${targetPoints}pt`}
            />
            <PriceCell
              label="TSL"
              value={hasSignalPrices ? fmt(algo.trailing_stop_loss) : '—'}
              color="text-amber-300"
              sublabel="trailing"
            />
          </div>

          {(algo.option_tradingsymbol || (algo.option_best_buy_price ?? 0) > 0) && (
            <div className="rounded-lg border border-cyan-600/30 bg-gradient-to-r from-slate-900/40 to-cyan-900/10 p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] sm:text-[11px] font-bold text-cyan-300 tracking-wide">OPTION EXECUTION PRICE</span>
                <span className="text-[10px] sm:text-[11px] font-mono text-slate-300 truncate max-w-[60%] text-right">
                  {algo.option_tradingsymbol || '—'}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <PriceCell label="OPT LTP" value={fmt(algo.option_ltp ?? 0)} color="text-slate-100" />
                <PriceCell label="BEST BUY" value={fmt(algo.option_best_buy_price ?? 0)} color="text-emerald-300" sublabel="ask" />
                <PriceCell label="BID" value={fmt(algo.option_best_bid_price ?? 0)} color="text-cyan-300" />
                <PriceCell label="ASK" value={fmt(algo.option_best_ask_price ?? 0)} color="text-amber-300" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <PriceCell label="BOUGHT @" value={fmt(algo.option_entry_buy_price ?? 0)} color="text-white" />
                <PriceCell label="P/L PTS" value={fmt(pnlPts)} color={pnlColor} />
                <PriceCell label="P/L ₹" value={fmt(pnlAmt)} color={pnlColor} />
              </div>
              <div className="rounded-md border border-slate-600/40 bg-slate-900/40 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] sm:text-[11px] font-bold text-slate-200">AUTO-BUY (OPTIONS ONLY)</span>
                  <span className={`text-[10px] sm:text-[11px] font-black ${autoReady ? 'text-emerald-300' : 'text-amber-300'}`}>
                    {autoReady ? 'ALL MATCHED' : 'WAITING MATCH'}
                  </span>
                </div>
                <div className="mt-1 text-[10px] sm:text-[11px] text-slate-300 leading-relaxed">
                  {autoReady
                    ? `Ready to auto-buy ${algo.recommended_option_side ?? 'OPTION'} at best buy ${fmt(algo.option_best_buy_price ?? 0)}.`
                    : (algo.auto_buy_block_reason || algo.auto_buy_gate_reason || algo.auto_buy_ai_reason || 'Waiting for all parameters and AI confirmation.')}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Confluence status strip: always mounted to avoid appear/disappear flicker */}
        <div className={`flex items-center justify-center min-h-[44px] py-3 rounded-xl border shadow-[0_0_12px_rgba(34,211,238,0.08)] ${
          isActive
            ? 'border-emerald-600/25 bg-gradient-to-r from-emerald-900/15 to-teal-900/10'
            : 'border-cyan-600/25 bg-gradient-to-r from-slate-800/30 to-cyan-900/15'
        }`}>
          <span className={`text-[11px] font-medium ${isActive ? 'text-emerald-300' : 'text-slate-400'}`}>
            {isActive ? '✅ Confluence matched. Signal active.' : '⏳ Waiting for strong confluence…'}
          </span>
        </div>

        {/* SL / Target steppers */}
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${s.pillBorder} ${s.pillBg}`}>
          <Stepper label="Stop Loss" icon="🛑" value={slPoints}     step={5} min={5} max={200} onChange={onSlChange}   color="text-red-400" />
          <div className="w-px h-8 bg-slate-700/50 shrink-0" />
          <Stepper label="Target"    icon="🎯" value={targetPoints} step={5} min={5} max={500} onChange={onTargetChange} color="text-emerald-400" />
        </div>

        {/* Lot size controls with explicit save */}
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${s.pillBorder} ${s.pillBg}`}>
          <Stepper label="Lots" icon="📦" value={lotCount} step={1} min={1} max={50} onChange={onLotChange} color="text-cyan-300" />
          <button
            onClick={onSaveLot}
            className={`px-3 py-2 rounded-lg border text-[10px] sm:text-xs font-black tracking-wide transition-all duration-150 ${
              isLotDirty
                ? 'bg-gradient-to-r from-cyan-600/70 to-sky-600/70 text-white border-cyan-400/60 hover:brightness-110'
                : 'bg-slate-800/70 text-slate-300 border-slate-600/60'
            }`}
            aria-label={`Save ${algo.symbol} lot size`}
          >
            SAVE
          </button>
          <span className={`text-[10px] sm:text-[11px] font-semibold ${isLotDirty ? 'text-amber-300' : 'text-emerald-300'}`}>
            {isLotDirty ? 'Unsaved' : 'Saved'}
          </span>
        </div>

        {/* Indicators grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <IndicatorPill label="EMA 20"   value={fmt(ind.ema20 ?? 0)}   ok={ind.price_above_ema20} />
          <IndicatorPill label="EMA 100"  value={fmt(ind.ema100 ?? 0)}  ok={ind.price_above_ema100} />
          <IndicatorPill label="EMA 200"  value={fmt(ind.ema200 ?? 0)}  ok={ind.price_above_ema200} />
          <IndicatorPill label="RSI (14)" value={fmt(ind.rsi ?? 50, 1)}
            ok={typeof ind.rsi === 'number' ? ind.rsi > 50 : null} />
          <IndicatorPill label="VWAP"     value={fmt(ind.vwap ?? 0)}    ok={vwapOk} />
          <IndicatorPill label="PCR"
            value={`${fmt(ind.pcr ?? 1, 2)} · ${ind.pcr_bias?.charAt(0) ?? '—'}`}
            ok={ind.pcr_bias === 'BULLISH' ? true : ind.pcr_bias === 'BEARISH' ? false : null} />
          <IndicatorPill label="OI Trend"
            value={(ind.oi_trend ?? 'NEUTRAL').replace(/_/g, ' ')}
            ok={ind.oi_trend === 'LONG_BUILDUP' || ind.oi_trend === 'SHORT_COVERING' ? true :
                ind.oi_trend === 'SHORT_BUILDUP' || ind.oi_trend === 'LONG_UNWINDING' ? false : null} />
          <IndicatorPill label="EMA Stack" value={emaAlignLabel}
            ok={ind.ema20_above_ema100 === true && ind.ema100_above_ema200 === true} />
          <IndicatorPill label="Liq Sweep" value={liqSweepLabel} ok={liqSweepOk} />
          <IndicatorPill label="Change"    value={fmtPct(ind.change_pct ?? 0)}
            ok={typeof ind.change_pct === 'number' ? ind.change_pct > 0 : null} />
        </div>

        {/* AI reasoning */}
        <div className="flex items-start gap-2 px-2.5 py-2.5 rounded-lg border border-cyan-600/25 bg-gradient-to-r from-slate-900/50 to-cyan-900/10 shadow-[0_0_8px_rgba(34,211,238,0.1)]">
          <span className="text-[10px] shrink-0 mt-0.5">{algo.ai_powered ? '🤖' : '⚙️'}</span>
          <p className="text-[10px] sm:text-[11px] text-slate-300 leading-relaxed">
            {algo.reasoning || 'Analysing market structure…'}
          </p>
        </div>

        {/* ALGO OFF overlay banner */}
        {!algoEnabled && (
          <div className="flex items-center justify-center gap-2 py-2 rounded-xl
            bg-gradient-to-r from-slate-800/50 to-slate-700/30 border border-slate-700/50 shadow-[0_0_8px_rgba(0,0,0,0.2)]">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-600 animate-pulse" />
            <span className="text-[10px] font-bold text-slate-500 tracking-wider">ALGO PAUSED — Turn ON to activate</span>
          </div>
        )}
      </div>
    </div>
  );
});

// ─── AlgoToggle ──────────────────────────────────────────────────────────────

const AlgoToggle = React.memo(function AlgoToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      aria-label={enabled ? 'Turn algo OFF' : 'Turn algo ON'}
      className={`
        relative flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl
        font-black text-xs sm:text-sm tracking-wider
        border transition-all duration-300 select-none touch-manipulation
        focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1
        active:scale-95
        ${
          enabled
            ? 'bg-gradient-to-r from-emerald-600 to-teal-600 border-emerald-400/60 text-white shadow-[0_0_20px_rgba(16,185,129,0.45)] hover:shadow-[0_0_28px_rgba(16,185,129,0.6)] focus-visible:ring-emerald-400'
            : 'bg-gradient-to-r from-slate-800 to-slate-700 border-slate-600/60 text-slate-400 shadow-[0_2px_8px_rgba(0,0,0,0.4)] hover:border-slate-500 hover:text-slate-300 focus-visible:ring-slate-500'
        }
      `}
    >
      {/* Track */}
      <span
        className={`
          relative flex items-center w-8 h-4 rounded-full border transition-colors duration-300 shrink-0
          ${
            enabled
              ? 'bg-emerald-400/30 border-emerald-300/50'
              : 'bg-slate-700/80 border-slate-600/50'
          }
        `}
      >
        {/* Knob */}
        <span
          className={`
            absolute w-3 h-3 rounded-full shadow-md transition-all duration-300
            ${
              enabled
                ? 'translate-x-4 bg-white shadow-[0_0_6px_rgba(16,185,129,0.8)]'
                : 'translate-x-0.5 bg-slate-400'
            }
          `}
        />
        {/* Ping when ON */}
        {enabled && (
          <span className="absolute right-0.5 w-3 h-3 rounded-full bg-emerald-300/50 animate-ping" />
        )}
      </span>

      {/* Label */}
      <span className="leading-none">
        {enabled ? 'ALGO ON' : 'ALGO OFF'}
      </span>

      {/* Active glow pulse ring */}
      {enabled && (
        <span className="absolute -inset-px rounded-xl border border-emerald-400/40 animate-pulse pointer-events-none" />
      )}
    </button>
  );
});

// ─── LiveStatusDot ────────────────────────────────────────────────────────────

const LiveStatusDot = React.memo(function LiveStatusDot({ connected }: { connected: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        {connected && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
        )}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-amber-400'}`} />
      </span>
      <span className={`text-[11px] sm:text-xs font-bold tracking-widest ${connected ? 'text-emerald-400' : 'text-amber-400'}`}>
        {connected ? 'LIVE' : 'CONNECTING'}
      </span>
    </span>
  );
});

// ─── SummaryBar ───────────────────────────────────────────────────────────────

const SummaryBar = React.memo(function SummaryBar({
  data, isConnected,
}: { data: Record<string, AlgoSignal>; isConnected: boolean }) {
  const stats = useMemo(() => {
    const vals = Object.values(data);
    const buys  = vals.filter(v => v.signal === 'BUY').length;
    const sells = vals.filter(v => v.signal === 'SELL').length;
    const waits = vals.filter(v => v.signal === 'WAIT').length;
    const avgConf = vals.length
      ? Math.round(vals.reduce((a, b) => a + b.confidence, 0) / vals.length) : 0;
    const aiCount = vals.filter(v => v.ai_powered).length;
    return { buys, sells, waits, avgConf, aiCount };
  }, [data]);

  return (
    <div className="flex flex-wrap items-center gap-2.5 sm:gap-4 px-4 py-2.5 rounded-xl
      bg-gradient-to-r from-slate-800/50 to-slate-700/40 border border-cyan-600/30 shadow-[0_4px_12px_rgba(0,0,0,0.2)]">
      <LiveStatusDot connected={isConnected} />
      <span className="w-px h-5 bg-slate-700/60 hidden sm:block" />
      <div className="flex items-center gap-1.5 flex-wrap">
        {stats.buys > 0 && (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md
            bg-gradient-to-r from-emerald-950/50 to-teal-900/30 border border-emerald-500/50 text-emerald-300 text-[11px] sm:text-xs font-bold shadow-[0_0_8px_rgba(16,185,129,0.15)]">
            ▲ {stats.buys} BUY
          </span>
        )}
        {stats.sells > 0 && (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md
            bg-gradient-to-r from-red-950/50 to-pink-900/30 border border-red-500/50 text-red-300 text-[11px] sm:text-xs font-bold shadow-[0_0_8px_rgba(239,68,68,0.15)]">
            ▼ {stats.sells} SELL
          </span>
        )}
        {stats.waits > 0 && (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md
            bg-gradient-to-r from-slate-700/40 to-cyan-900/20 border border-cyan-600/40 text-slate-300 text-[11px] sm:text-xs font-medium shadow-[0_0_6px_rgba(34,211,238,0.1)]">
            ⏳ {stats.waits} WAIT
          </span>
        )}
      </div>
      <span className="w-px h-5 bg-slate-700/60 hidden sm:block" />
      <span className="text-[11px] sm:text-xs text-slate-400 font-bold tracking-wide">Conf: <span className="text-white text-sm sm:text-base">{stats.avgConf}%</span></span>
      {stats.aiCount > 0 && (
        <span className="ml-auto flex items-center gap-2 text-[11px] sm:text-xs text-violet-300 font-bold">
          <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
          AI {stats.aiCount}/3
        </span>
      )}
    </div>
  );
});

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function SmartAIAlgoSection() {
  const { data, isConnected, aiEnabled, adjustSLTarget, toggleAlgo } = useSmartAlgo();
  const defaultLots = 1;
  const LOTS_STORAGE_KEY = 'smart_ai_algo_lots_v1';

  // algoEnabled is fully server-driven via useSmartAlgo — no local duplicate state
  const algoEnabled = aiEnabled;
  const [sl,  setSl]  = useState<Record<string, number>>({ NIFTY: 10, BANKNIFTY: 10, SENSEX: 10 });
  const [tgt, setTgt] = useState<Record<string, number>>({ NIFTY: 15, BANKNIFTY: 15, SENSEX: 15 });
  const [lots, setLots] = useState<Record<string, number>>({ NIFTY: defaultLots, BANKNIFTY: defaultLots, SENSEX: defaultLots });
  const [savedLots, setSavedLots] = useState<Record<string, number>>({ NIFTY: defaultLots, BANKNIFTY: defaultLots, SENSEX: defaultLots });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOTS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Record<'NIFTY' | 'BANKNIFTY' | 'SENSEX', number>>;
      const restored = {
        NIFTY: Math.max(1, Number(parsed.NIFTY ?? defaultLots)),
        BANKNIFTY: Math.max(1, Number(parsed.BANKNIFTY ?? defaultLots)),
        SENSEX: Math.max(1, Number(parsed.SENSEX ?? defaultLots)),
      };
      setLots(restored);
      setSavedLots(restored);
    } catch {
      // Keep defaults if local storage is unavailable or corrupted.
    }
  }, [LOTS_STORAGE_KEY, defaultLots]);

  const handleSl = useCallback((symbol: string, val: number) => {
    setSl(p => ({ ...p, [symbol]: val }));
    setTgt(prev => { adjustSLTarget(symbol, val, prev[symbol] ?? 15); return prev; });
  }, [adjustSLTarget]);

  const handleTgt = useCallback((symbol: string, val: number) => {
    setTgt(p => ({ ...p, [symbol]: val }));
    setSl(prev => { adjustSLTarget(symbol, prev[symbol] ?? 10, val); return prev; });
  }, [adjustSLTarget]);

  const handleLot = useCallback((symbol: string, val: number) => {
    setLots(prev => ({ ...prev, [symbol]: Math.max(1, val) }));
  }, []);

  const handleSaveLot = useCallback((symbol: string) => {
    setSavedLots(prev => {
      const next = { ...prev, [symbol]: Math.max(1, lots[symbol] ?? defaultLots) };
      try {
        localStorage.setItem(LOTS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage write errors and keep in-memory state.
      }
      return next;
    });
  }, [LOTS_STORAGE_KEY, defaultLots, lots]);

  const SYMBOLS = ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const;

  const emptyAlgo = useCallback((sym: string): AlgoSignal => ({
    symbol: sym, signal: 'WAIT', entry_price: 0, stop_loss: 0,
    target: 0, trailing_stop_loss: 0, confidence: 0,
    sl_points: sl[sym] ?? 10, target_points: tgt[sym] ?? 15,
    regime: 'UNKNOWN', strength: 0,
    reasoning: 'Connecting to market feed…',
    indicators: {} as AlgoIndicators,
    ai_powered: false, last_updated: 0, market_status: 'CLOSED',
  }), [sl, tgt]);

  return (
    <section className="mt-6 sm:mt-8">

      {/* Section header */}
      <div className="flex flex-col gap-3 mb-4 sm:mb-6 px-4 sm:px-5 py-4 sm:py-5 rounded-2xl
        bg-gradient-to-br from-slate-900/60 via-slate-800/40 to-slate-900/50
        border border-cyan-600/30 border-l-cyan-500/50
        shadow-[0_0_40px_rgba(34,211,238,0.1),0_8px_24px_rgba(0,0,0,0.3)]
        backdrop-blur-sm">

        {/* Title row */}
        <div className="flex items-start sm:items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="relative w-11 h-11 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center
              bg-gradient-to-br from-violet-600/30 to-indigo-600/30
              border border-violet-500/30 shadow-[0_0_16px_rgba(139,92,246,0.2)] shrink-0">
              <span className="text-2xl sm:text-3xl">🤖</span>
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight leading-none">
                  Smart AI Algo
                </h2>
                <AlgoToggle enabled={algoEnabled} onToggle={() => toggleAlgo(!algoEnabled)} />
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="px-2.5 py-1 rounded-md text-[9px] sm:text-[10px] md:text-xs font-black
                    bg-gradient-to-r from-violet-600/70 to-indigo-600/70
                    text-white border border-violet-500/40
                    shadow-[0_0_8px_rgba(139,92,246,0.3)] leading-none tracking-wider">
                    AI POWERED
                  </span>
                  <span className="px-2.5 py-1 rounded-md text-[9px] sm:text-[10px] md:text-xs font-black
                    bg-gradient-to-r from-sky-700/60 to-blue-700/60
                    text-sky-100 border border-sky-600/40 leading-none tracking-wider">
                    ZERODHA LIVE
                  </span>
                  <span className="px-2.5 py-1 rounded-md text-[9px] sm:text-[10px] md:text-xs font-black
                    bg-gradient-to-r from-emerald-700/60 to-teal-700/60
                    text-emerald-100 border border-emerald-500/40 leading-none tracking-wider">
                    DEFAULT QTY: {defaultLots} LOT
                  </span>
                </div>
              </div>
              <p className="text-[10px] sm:text-[11px] md:text-xs text-slate-400 mt-2 leading-relaxed tracking-wide">
                EMA 20/100/200 · RSI · PCR · OI · VWAP · Liq Sweep · SMC · GPT-4o-mini
              </p>
            </div>
          </div>

          {/* Parameter pills — desktop only */}
          <div className="hidden lg:flex items-center gap-2 flex-wrap">
            {['EMA Stack', 'RSI 14', 'PCR', 'OI Trend', 'VWAP', 'Liq Sweep', 'SMC'].map(p => (
              <span key={p} className="px-2.5 py-1 rounded-full text-[9px] font-semibold
                text-slate-400 border border-slate-700/50 bg-slate-800/40 leading-none tracking-wide">{p}</span>
            ))}
          </div>
        </div>

        {/* Summary bar */}
        <SummaryBar data={data} isConnected={isConnected} />

        {/* Disclaimer */}
        <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-lg
          bg-amber-900/15 border border-amber-600/25 text-[10px] sm:text-[11px] text-amber-300/80">
          <span className="shrink-0 mt-px text-lg">⚠</span>
          <span className="leading-relaxed">
            Signals are informational only. Verify with your own analysis before trading.
            SL / Target values are in <strong className="text-amber-400 font-bold">index points</strong>.
            Trailing SL activates at 50% of target distance.
          </span>
        </div>
      </div>

      {/* ALGO OFF global banner */}
      {!algoEnabled && (
        <div className="mb-4 flex items-center gap-4 px-5 py-4 rounded-2xl
          bg-gradient-to-r from-slate-900/80 via-slate-800/60 to-cyan-900/20
          border border-slate-700/60 shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
          <div className="flex items-center justify-center w-8 h-8 rounded-xl
            bg-slate-800/80 border border-slate-700/50 shrink-0">
            <span className="text-base">⏸</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-slate-400">Algo is currently OFF</p>
            <p className="text-[10px] text-slate-600 mt-0.5">
              Signals are displayed in read-only mode. Flip the toggle to activate auto-buy.
            </p>
          </div>
          <AlgoToggle enabled={algoEnabled} onToggle={() => toggleAlgo(!algoEnabled)} />
        </div>
      )}

      {/* ALGO ON active banner */}
      {algoEnabled && (
        <div className="mb-3 flex items-center gap-3 px-4 py-3 rounded-2xl
          bg-gradient-to-r from-emerald-950/60 via-emerald-900/40 to-teal-950/50
          border border-emerald-500/50 border-l-emerald-400/70
          shadow-[0_0_32px_rgba(16,185,129,0.2),0_4px_16px_rgba(0,0,0,0.2)]">
          <div className="flex items-center justify-center w-8 h-8 rounded-xl
            bg-emerald-500/20 border border-emerald-400/40 shrink-0">
            <span className="text-base">⚡</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-black text-emerald-300">Algo is ACTIVE</p>
            <p className="text-[10px] text-emerald-600 mt-0.5">
              Monitoring for strong confluence · Auto-buy triggers on BUY signal with SL + Target + TSL
            </p>
          </div>
          <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            RUNNING
          </span>
        </div>
      )}

      {/* Cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
        {SYMBOLS.map(sym => (
          <SymbolCard
            key={sym}
            algo={data[sym] ?? emptyAlgo(sym)}
            slPoints={sl[sym] ?? 10}
            targetPoints={tgt[sym] ?? 15}
            lotCount={lots[sym] ?? defaultLots}
            isLotDirty={(lots[sym] ?? defaultLots) !== (savedLots[sym] ?? defaultLots)}
            algoEnabled={algoEnabled}
            onSlChange={v => handleSl(sym, v)}
            onTargetChange={v => handleTgt(sym, v)}
            onLotChange={v => handleLot(sym, v)}
            onSaveLot={() => handleSaveLot(sym)}
          />
        ))}
      </div>

      {/* Collapsible legend */}
      <details className="mt-4 sm:mt-6 group">
        <summary className="flex items-center gap-2.5 cursor-pointer px-4 py-3 rounded-xl
          bg-gradient-to-r from-slate-800/40 to-slate-700/30 border border-cyan-600/25 hover:border-cyan-500/40 hover:bg-slate-800/50
          transition-all duration-150 select-none list-none shadow-[0_0_8px_rgba(34,211,238,0.05)]">
          <span className="text-slate-500 group-open:rotate-90 transition-transform duration-200 text-base">▶</span>
          <span className="text-[11px] sm:text-xs text-slate-400 hover:text-cyan-300 transition-colors font-bold tracking-wide">
            Parameter Reference
          </span>
        </summary>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2
          px-3 py-3 rounded-xl bg-gradient-to-br from-slate-800/30 to-slate-700/20 border border-cyan-600/20 shadow-[0_0_16px_rgba(34,211,238,0.08)]" >
          {([
            ['EMA 20',    'Short momentum. Price above = bullish bias.'],
            ['EMA 100',   'Medium trend. Cross = trend change.'],
            ['EMA 200',   'Long-term institutional level.'],
            ['RSI 14',    '>55 bull · <45 bear · >70 overbought.'],
            ['VWAP',      'Intraday institutional average price.'],
            ['PCR',       '>1.2 bullish · <0.8 bearish sentiment.'],
            ['OI Trend',  'Long Buildup = smart longs entering.'],
            ['Liq Sweep', 'Price near H/L = SMC reversal zone.'],
            ['EMA Stack', '20>100>200 = strong bull alignment.'],
            ['TSL',       'Auto-trails SL as price moves in favour.'],
            ['AI ✦',      'GPT-4o-mini confirms rule signal.'],
            ['Regime',    'Trending / Sideways / Volatile state.'],
          ] as [string, string][]).map(([k, v]) => (
            <div key={k} className="flex flex-col gap-0.5 py-0.5">
              <span className="text-[9px] font-bold text-slate-300">{k}</span>
              <span className="text-[8px] text-slate-500 leading-relaxed">{v}</span>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
