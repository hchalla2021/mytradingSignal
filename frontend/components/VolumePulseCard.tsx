/**
 * VolumePulseCard – Green vs Red Candle Volume Analysis
 * ─────────────────────────────────────────────────────────────────────────────
 * Architecture: Self-contained REST polling → /api/advanced/volume-pulse/{symbol}
 * Refresh:      Every 5 s via AbortController-guarded fetch
 * Signal:       Uses backend signal + confidence directly (no frontend re-derivation)
 * Metrics:      pulse_score (buying pressure), confidence (signal strength),
 *               pro_metrics.interpretation (institutional analysis text)
 */
'use client';

import React, { memo, useEffect, useState, useCallback, useRef } from 'react';
import { API_CONFIG } from '@/lib/api-config';

interface VolumePulseData {
  symbol:        string;
  volume_data: {
    green_candle_volume: number;
    red_candle_volume:   number;
    green_percentage:    number;
    red_percentage:      number;
    ratio:               number;
  };
  pulse_score:       number;  // 0-100: buying pressure score
  signal:            string;  // BUY | SELL | NEUTRAL
  confidence:        number;  // 0-95: actual signal confidence from backend
  trend:             string;  // BULLISH | BEARISH | NEUTRAL
  status:            string;
  timestamp:         string;
  candles_analyzed?: number;
  pro_metrics?: {
    participation:    number;
    aggression:       number;
    exhaustion:       number;
    volume_quality:   string;
    interpretation:   string;
  };
}

interface VolumePulseCardProps {
  symbol: string;
  name:   string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Static config — module-level, never recreated per render
// ─────────────────────────────────────────────────────────────────────────────
const SIG_CFG: Record<string, {
  label: string; color: string; bg: string; border: string; bar: string; icon: string; subtext: string;
}> = {
  STRONG_BUY:  { label: 'STRONG BUY',  color: 'text-emerald-300', bg: 'bg-emerald-500/10', border: 'border-emerald-500',  bar: 'from-emerald-500 to-green-400',  icon: '▲▲', subtext: 'Strong buying volume dominant — buyers in full control.' },
  BUY:         { label: 'BUY',         color: 'text-green-300',   bg: 'bg-green-500/10',   border: 'border-green-500',    bar: 'from-green-500 to-emerald-400',  icon: '▲',  subtext: 'More volume on green candles — buyers active.' },
  NEUTRAL:     { label: 'NEUTRAL',     color: 'text-amber-300',   bg: 'bg-amber-500/8',    border: 'border-amber-500/60', bar: 'from-amber-500 to-yellow-400',   icon: '▬',  subtext: 'Balanced buy/sell volume — no clear direction.' },
  SELL:        { label: 'SELL',        color: 'text-red-300',     bg: 'bg-red-500/10',     border: 'border-red-500',      bar: 'from-red-500 to-rose-400',       icon: '▼',  subtext: 'More volume on red candles — sellers active.' },
  STRONG_SELL: { label: 'STRONG SELL', color: 'text-rose-300',    bg: 'bg-rose-500/10',    border: 'border-rose-500',     bar: 'from-rose-500 to-red-400',       icon: '▼▼', subtext: 'Strong selling volume dominant — sellers in full control.' },
};

function getSig(backendSignal: string, confidence: number) {
  const s = (backendSignal ?? 'NEUTRAL').toUpperCase();
  if (s === 'BUY'  && confidence >= 75) return SIG_CFG.STRONG_BUY;
  if (s === 'BUY')                       return SIG_CFG.BUY;
  if (s === 'SELL' && confidence >= 75) return SIG_CFG.STRONG_SELL;
  if (s === 'SELL')                      return SIG_CFG.SELL;
  return SIG_CFG.NEUTRAL;
}

function fmtVol(v: number): string {
  if (v >= 10_000_000) return `${(v / 10_000_000).toFixed(1)}Cr`;
  if (v >= 100_000)    return `${(v / 100_000).toFixed(1)}L`;
  if (v >= 1_000)      return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5-Min Prediction Engine
// Pure volume intelligence — no extra API call, derived from fetched data
// Factors (max ±11 pts total):
//   1. Volume Momentum (pulse_score)  ±3
//   2. Buy/Sell Ratio                 ±2
//   3. Volume Quality (institutional) ±3
//   4. Participation level            ±1
//   5. Aggression vs Exhaustion       ±2
// ─────────────────────────────────────────────────────────────────────────────
interface PredFactor { label: string; pts: number; note: string }
interface Prediction {
  score: number; label: string; color: string; border: string;
  bg: string; icon: string; upProb: number; downProb: number;
  confidence: number;   // 0-90: certainty of the predicted direction
  factors: PredFactor[];
}

function computePrediction(d: VolumePulseData): Prediction {
  const pulse    = d.pulse_score ?? 50;
  const ratio    = d.volume_data?.ratio ?? 1;
  const pm       = d.pro_metrics;
  const quality  = pm?.volume_quality ?? 'NEUTRAL';
  const partic   = pm?.participation  ?? 50;
  const aggr     = pm?.aggression     ?? 50;
  const exhaust  = pm?.exhaustion     ?? 0;
  const backConf = d.confidence ?? 0;

  let score = 0;
  const factors: PredFactor[] = [];

  // ── Factor 1: Volume Momentum (±3) ──
  if (pulse > 65)      { score += 3; factors.push({ label: 'Vol Momentum', pts:  3, note: `${pulse}% — strong buying` }); }
  else if (pulse > 55) { score += 2; factors.push({ label: 'Vol Momentum', pts:  2, note: `${pulse}% — moderate buying` }); }
  else if (pulse < 35) { score -= 3; factors.push({ label: 'Vol Momentum', pts: -3, note: `${pulse}% — heavy selling` }); }
  else if (pulse < 45) { score -= 2; factors.push({ label: 'Vol Momentum', pts: -2, note: `${pulse}% — selling bias` }); }
  else                 {             factors.push({ label: 'Vol Momentum', pts:  0, note: `${pulse}% — balanced` }); }

  // ── Factor 2: Buy/Sell Ratio (±2) ──
  const r = ratio === 999 ? 5 : ratio;
  if (r > 1.5)       { score += 2; factors.push({ label: 'B/S Ratio', pts:  2, note: `${r.toFixed(2)} — buyers dominant` }); }
  else if (r > 1.2)  { score += 1; factors.push({ label: 'B/S Ratio', pts:  1, note: `${r.toFixed(2)} — buyers ahead` }); }
  else if (r < 0.67) { score -= 2; factors.push({ label: 'B/S Ratio', pts: -2, note: `${r.toFixed(2)} — sellers dominant` }); }
  else if (r < 0.85) { score -= 1; factors.push({ label: 'B/S Ratio', pts: -1, note: `${r.toFixed(2)} — sellers ahead` }); }
  else               {             factors.push({ label: 'B/S Ratio', pts:  0, note: `${r.toFixed(2)} — balanced` }); }

  // ── Factor 3: Volume Quality (±3) ──
  const qMap: Record<string, { pts: number; note: string }> = {
    HEALTHY:           { pts:  2, note: 'Healthy — continuation likely' },
    COMPRESSION:       { pts:  2, note: 'Compression — breakout imminent' },
    ABSORPTION:        { pts:  0, note: 'Absorption — direction unclear' },
    EXHAUSTION:        { pts: -3, note: 'Exhaustion — reversal warning' },
    SELLER_EXHAUSTION: { pts:  2, note: 'Seller exhaustion — bounce likely' },
    FAKE_BREAKOUT:     { pts: -1, note: 'Fake breakout — avoid chase' },
    NEUTRAL:           { pts:  0, note: 'Neutral — mixed signals' },
  };
  const qm = qMap[quality] ?? { pts: 0, note: 'Mixed signals' };
  score += qm.pts;
  factors.push({ label: 'Vol Quality', pts: qm.pts, note: qm.note });

  // ── Factor 4: Participation (±1) ──
  if (partic > 70)      { score += 1; factors.push({ label: 'Participation', pts:  1, note: `${partic}% — high activity` }); }
  else if (partic < 30) { score -= 1; factors.push({ label: 'Participation', pts: -1, note: `${partic}% — low activity` }); }
  else                  {             factors.push({ label: 'Participation', pts:  0, note: `${partic}% — normal` }); }

  // ── Factor 5: Aggression vs Exhaustion (±2) ──
  if (exhaust > 70) {
    score -= 2;
    factors.push({ label: 'Exhaustion', pts: -2, note: `${exhaust}% — move may stall` });
  } else if (aggr > 70 && exhaust < 40) {
    const pts = score >= 0 ? 2 : -2; // follows current bias direction
    score += pts;
    factors.push({ label: 'Aggression', pts, note: `${aggr}% aggression — trend accelerating` });
  } else {
    factors.push({ label: 'Momentum', pts: 0, note: `Aggr ${aggr} / Exhaust ${exhaust}` });
  }

  // ── Derive label + probability ──
  let label: string, color: string, border: string, bg: string, icon: string, upProb: number;
  if      (score >= 6)  { label = 'STRONG UP';   color = 'text-emerald-300'; border = 'border-emerald-500';  bg = 'bg-emerald-500/10'; icon = '▲▲'; upProb = 86; }
  else if (score >= 3)  { label = 'LIKELY UP';   color = 'text-green-300';   border = 'border-green-500';    bg = 'bg-green-500/10';   icon = '▲';  upProb = 68; }
  else if (score <= -6) { label = 'STRONG DOWN'; color = 'text-rose-300';    border = 'border-rose-500';     bg = 'bg-rose-500/10';    icon = '▼▼'; upProb = 14; }
  else if (score <= -3) { label = 'LIKELY DOWN'; color = 'text-red-300';     border = 'border-red-500';      bg = 'bg-red-500/10';     icon = '▼';  upProb = 32; }
  else                  { label = 'CHOPPY';      color = 'text-amber-300';   border = 'border-amber-500/60'; bg = 'bg-amber-500/8';    icon = '▬';  upProb = 50; }

  // Nudge probability using backend signal confidence
  const boost = Math.round(backConf * 0.08); // max ~7
  if (upProb > 50) upProb = Math.min(93, upProb + boost);
  else if (upProb < 50) upProb = Math.max(7, upProb - boost);

  // ── Confidence: HOW CERTAIN we are about the direction ──
  // Separate from probability — measures signal quality, not direction bias.
  // Max raw score = 11 pts → maps base 0-35 additional pts
  let conf = 38;                                          // base (low info state)
  conf += (Math.abs(score) / 11) * 37;                   // conviction from score magnitude (+0…+37)
  if (quality === 'HEALTHY' || quality === 'COMPRESSION') conf += 9;   // strong institutional pattern
  if (quality === 'SELLER_EXHAUSTION')                    conf += 6;   // clear reversal signal
  if (quality === 'EXHAUSTION')                           conf -= 12;  // trend ending — very uncertain
  if (quality === 'FAKE_BREAKOUT')                        conf -= 7;   // deceptive move
  if (quality === 'ABSORPTION')                           conf -= 3;   // direction unclear
  if (partic > 70) conf += 5;   // high participation → reliable signal
  if (partic < 30) conf -= 6;   // low participation → noise
  if (exhaust > 70) conf -= 8;  // exhaustion kills confidence
  conf += backConf * 0.10;      // blend backend signal strength (max +9.5)
  const confidence = Math.round(Math.min(90, Math.max(35, conf)));

  return { score, label, color, border, bg, icon, upProb, downProb: 100 - upProb, confidence, factors };
}

const VolumePulseCard = memo<VolumePulseCardProps>(({ symbol, name }) => {
  const [data,    setData]    = useState<VolumePulseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [flash,   setFlash]   = useState(false);
  const prevSigRef = useRef<string>('');
  const abortRef   = useRef<AbortController | null>(null);

  // ── Fetch ────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch(
        API_CONFIG.endpoint(`/api/advanced/volume-pulse/${symbol}`),
        { signal: ctrl.signal, cache: 'no-store' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result: VolumePulseData = await res.json();
      if (!result.volume_data) { setError('No volume data'); setLoading(false); return; }
      if (prevSigRef.current && prevSigRef.current !== result.signal) {
        setFlash(true);
        setTimeout(() => setFlash(false), 700);
      }
      prevSigRef.current = result.signal;
      setData(result);
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

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) return (
    <div className="bg-slate-900/40 border-2 border-slate-700/40 rounded-2xl p-4 animate-pulse min-h-[300px]">
      <div className="flex justify-between mb-3">
        <div className="h-5 bg-slate-800/70 rounded w-24" />
        <div className="h-5 bg-slate-800/70 rounded w-16" />
      </div>
      <div className="h-14 bg-slate-800/50 rounded-xl mb-3" />
      <div className="h-2 bg-slate-800/50 rounded-full mb-3" />
      <div className="h-2 bg-slate-800/50 rounded-full mb-3" />
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="h-12 bg-slate-800/40 rounded-xl" />
        <div className="h-12 bg-slate-800/40 rounded-xl" />
      </div>
      <div className="h-10 bg-slate-800/30 rounded-xl" />
    </div>
  );

  // ── Error state ───────────────────────────────────────────────────────────
  if (error || !data) return (
    <div className="bg-slate-900/40 border-2 border-rose-500/30 rounded-2xl p-5 min-h-[160px] flex flex-col items-center justify-center gap-2">
      <span className="text-2xl">⚠</span>
      <p className="text-sm font-bold text-rose-300">{name}</p>
      <p className="text-xs text-rose-400/80">{error ?? 'No data available'}</p>
      <button onClick={fetchData} className="mt-2 text-[10px] px-3 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 transition-colors">
        Retry
      </button>
    </div>
  );

  // ── Derived values ────────────────────────────────────────────────────────
  const sig     = getSig(data.signal, data.confidence);
  const isLive  = data.status === 'LIVE' || data.status === 'ACTIVE';
  const vd      = data.volume_data;
  const total   = vd.green_candle_volume + vd.red_candle_volume;
  const isLowVol = total > 0 && total < 100_000;
  const pulse   = data.pulse_score ?? 50;         // 0-100 buying pressure
  const conf    = data.confidence  ?? 0;           // 0-95 signal confidence
  const trend   = (data.trend ?? 'NEUTRAL').toUpperCase();
  const interpretation = data.pro_metrics?.interpretation ?? sig.subtext;
  const quality = data.pro_metrics?.volume_quality ?? '';
  const pred    = computePrediction(data);

  return (
    <div
      suppressHydrationWarning
      className={`
        rounded-2xl border-2 ${sig.border} ${sig.bg} overflow-hidden
        shadow-lg transition-all duration-300
        ${flash ? 'ring-2 ring-white/25 scale-[1.004]' : ''}
      `}
    >
      {/* ─── HEADER ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-black text-white">{name}</span>
          {isLive && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[9px] font-bold text-emerald-400">LIVE</span>
            </span>
          )}
        </div>
        {/* Trend badge */}
        <span suppressHydrationWarning className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
          trend === 'BULLISH' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' :
          trend === 'BEARISH' ? 'border-red-500/40 bg-red-500/10 text-red-400' :
          'border-slate-600/40 bg-slate-800/40 text-slate-400'
        }`}>{trend}</span>
      </div>

      <div className="p-3 space-y-2.5">

        {/* ─── LOW VOLUME WARNING ──────────────────────────────────────── */}
        {isLowVol && (
          <div className="px-2.5 py-1.5 rounded-lg bg-amber-900/25 border border-amber-500/35 text-[10px] font-semibold text-amber-300 flex items-center gap-1.5">
            ⚠ Low Volume ({fmtVol(total)}) — wait for higher activity
          </div>
        )}

        {/* ─── MAIN SIGNAL ─────────────────────────────────────────────── */}
        <div className={`rounded-xl border ${sig.border} ${sig.bg} px-3 py-2.5 text-center`}>
          <div suppressHydrationWarning className={`text-xl font-black tracking-wide ${sig.color}`}>
            {sig.icon}&nbsp;{sig.label}
          </div>
          <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{sig.subtext}</p>
        </div>

        {/* ─── SIGNAL CONFIDENCE ───────────────────────────────────────── */}
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

        {/* ─── BUYING PRESSURE ─────────────────────────────────────────── */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-widest">Buying Pressure</span>
            <span suppressHydrationWarning className={`text-sm font-black ${
              pulse >= 65 ? 'text-emerald-300' : pulse >= 50 ? 'text-green-300' :
              pulse >= 35 ? 'text-amber-300' : 'text-red-300'
            }`}>{pulse}%</span>
          </div>
          <div className="relative h-2 bg-gradient-to-r from-rose-900/50 via-gray-800 to-emerald-900/50 rounded-full overflow-hidden border border-white/5">
            {/* Needle at pulse position */}
            <div
              suppressHydrationWarning
              className={`absolute top-0 h-full w-0.5 bg-white/80 transition-all duration-700`}
              style={{ left: `${pulse}%` }}
            />
            {/* Fill from center */}
            {pulse >= 50 ? (
              <div
                suppressHydrationWarning
                className="absolute top-0 h-full bg-emerald-500/60 transition-all duration-700"
                style={{ left: '50%', width: `${(pulse - 50) * 2}%` }}
              />
            ) : (
              <div
                suppressHydrationWarning
                className="absolute top-0 h-full bg-red-500/60 transition-all duration-700"
                style={{ right: '50%', width: `${(50 - pulse) * 2}%` }}
              />
            )}
          </div>
          <div className="flex justify-between text-[9px] text-gray-600 mt-0.5">
            <span>Selling</span><span>Neutral</span><span>Buying</span>
          </div>
        </div>

        {/* ─── VOLUME BREAKDOWN ────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-emerald-500/8 rounded-xl p-2.5 border border-emerald-500/25">
            <p className="text-[8px] text-emerald-400/70 font-bold uppercase mb-0.5">BUY VOLUME</p>
            <p suppressHydrationWarning className="text-sm font-black text-emerald-300">{fmtVol(vd.green_candle_volume)}</p>
            <p suppressHydrationWarning className="text-[9px] text-emerald-400/60">{vd.green_percentage.toFixed(0)}% of total</p>
            <div className="mt-1 h-1 bg-gray-900/50 rounded-full overflow-hidden">
              <div suppressHydrationWarning className="h-full bg-emerald-500 rounded-full" style={{ width: `${vd.green_percentage}%` }} />
            </div>
          </div>
          <div className="bg-rose-500/8 rounded-xl p-2.5 border border-rose-500/25">
            <p className="text-[8px] text-rose-400/70 font-bold uppercase mb-0.5">SELL VOLUME</p>
            <p suppressHydrationWarning className="text-sm font-black text-rose-300">{fmtVol(vd.red_candle_volume)}</p>
            <p suppressHydrationWarning className="text-[9px] text-rose-400/60">{vd.red_percentage.toFixed(0)}% of total</p>
            <div className="mt-1 h-1 bg-gray-900/50 rounded-full overflow-hidden">
              <div suppressHydrationWarning className="h-full bg-rose-500 rounded-full" style={{ width: `${vd.red_percentage}%` }} />
            </div>
          </div>
        </div>

        {/* ─── RATIO ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-900/50 border border-slate-700/30">
          <span className="text-[9px] text-gray-500 font-semibold uppercase tracking-wider">Buy/Sell Ratio</span>
          <span suppressHydrationWarning className={`text-[10px] font-bold ${
            vd.ratio > 1.2 ? 'text-emerald-400' : vd.ratio < 0.85 ? 'text-red-400' : 'text-amber-400'
          }`}>{vd.ratio === 999 ? '∞' : vd.ratio.toFixed(2)}</span>
        </div>

        {/* ─── INSTITUTIONAL INTERPRETATION ────────────────────────────── */}
        {quality && quality !== 'NEUTRAL' && (
          <div className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-medium ${
            quality === 'ABSORPTION'       ? 'bg-blue-500/8 border-blue-500/30 text-blue-300' :
            quality === 'COMPRESSION'      ? 'bg-purple-500/8 border-purple-500/30 text-purple-300' :
            quality === 'EXHAUSTION'       ? 'bg-orange-500/8 border-orange-500/30 text-orange-300' :
            quality === 'SELLER_EXHAUSTION'? 'bg-emerald-500/8 border-emerald-500/30 text-emerald-300' :
            quality === 'FAKE_BREAKOUT'    ? 'bg-rose-500/8 border-rose-500/30 text-rose-300' :
            quality === 'HEALTHY'          ? 'bg-emerald-500/8 border-emerald-500/30 text-emerald-300' :
            'bg-slate-800/40 border-slate-700/30 text-slate-400'
          }`}>
            {interpretation}
          </div>
        )}

        {/* ─── PRO METRICS ─────────────────────────────────────────────── */}
        {data.pro_metrics && (
          <div className="border border-slate-700/40 rounded-xl bg-slate-900/40 px-3 py-2">
            <div className="text-[8px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Volume Quality</div>
            <div className="space-y-1">
              {[
                { label: 'Participation', val: data.pro_metrics.participation },
                { label: 'Aggression',    val: data.pro_metrics.aggression    },
                { label: 'Exhaustion',    val: data.pro_metrics.exhaustion     },
              ].map(({ label, val }) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="text-[9px] text-gray-500 w-[72px] flex-shrink-0">{label}</span>
                  <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      suppressHydrationWarning
                      className={`h-full rounded-full transition-all duration-500 ${
                        label === 'Exhaustion'
                          ? val >= 70 ? 'bg-orange-500' : val >= 40 ? 'bg-amber-500' : 'bg-gray-600'
                          : val >= 70 ? 'bg-emerald-500' : val >= 40 ? 'bg-amber-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${val}%` }}
                    />
                  </div>
                  <span suppressHydrationWarning className="text-[9px] text-gray-500 w-7 text-right flex-shrink-0">{val}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════
            5-MIN PREDICTION
            Pure volume intelligence — 5 weighted factors, no extra fetch
        ════════════════════════════════════════════════════════════════ */}
        <div className="rounded-xl border border-white/[0.06] bg-[#0d1117] overflow-hidden">
          <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          {(() => {
            const isBuyVol  = pred.label === 'STRONG UP'   || pred.label === 'LIKELY UP';
            const isSellVol = pred.label === 'STRONG DOWN' || pred.label === 'LIKELY DOWN';
            const adjConf   = pred.confidence; // 35–90%, 5-factor weighted (momentum, ratio, quality, participation, aggression)
            const predDir   = isBuyVol ? 'LONG' : isSellVol ? 'SHORT' : 'FLAT';
            const dirIcon   = isBuyVol ? '▲' : isSellVol ? '▼' : '─';
            const dirColor  = isBuyVol ? 'text-teal-300'       : isSellVol ? 'text-rose-300'       : 'text-amber-300';
            const dirBorder = isBuyVol ? 'border-teal-500/40'  : isSellVol ? 'border-rose-500/35'  : 'border-amber-500/30';
            const dirBg     = isBuyVol ? 'bg-teal-500/[0.07]'  : isSellVol ? 'bg-rose-500/[0.07]'  : 'bg-amber-500/[0.05]';
            const barColor  = isBuyVol ? 'bg-teal-500'         : isSellVol ? 'bg-rose-500'         : 'bg-amber-500';
            const q = data.pro_metrics?.volume_quality ?? 'NEUTRAL';
            const ctxNote =
              q === 'EXHAUSTION'          ? '⚠ Volume exhaustion — reversal risk'
              : q === 'FAKE_BREAKOUT'     ? '⚠ Fake breakout — avoid chase'
              : q === 'COMPRESSION'       ? 'Compression — breakout imminent'
              : q === 'SELLER_EXHAUSTION' ? 'Seller exhaustion — bounce likely'
              : q === 'ABSORPTION'        ? 'Absorption — direction unclear'
              : (pred.label === 'STRONG UP' || pred.label === 'STRONG DOWN') ? 'Strong vol dominance confirmed'
              : isBuyVol  ? 'Buying pressure active'
              : isSellVol ? 'Selling pressure active'
              : 'Balanced — await breakout';
            return (
              <div className="px-3 pt-2.5 pb-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] text-white/40 font-bold uppercase tracking-widest">5-Min Prediction</span>
                  <span className={`text-[9px] font-black ${dirColor}`}>{adjConf}% Confidence</span>
                </div>
                <div className={`rounded-lg border ${dirBorder} ${dirBg} px-2.5 py-2 mb-2`}>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className={`text-sm font-black ${dirColor}`}>{dirIcon} {predDir}</span>
                    <span className="text-[9px] text-white/30 truncate">{ctxNote}</span>
                    <span className={`text-sm font-black ${dirColor} shrink-0`}>{adjConf}%</span>
                  </div>
                  <div className="h-[2px] bg-white/[0.06] rounded-full overflow-hidden">
                    <div suppressHydrationWarning className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${adjConf}%` }} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <div className="text-center bg-black/30 border border-white/[0.05] rounded-lg p-2">
                    <div className="text-[8px] text-white/30 mb-0.5">Buy Vol</div>
                    <div className={`text-[10px] font-bold ${vd.green_percentage >= 55 ? 'text-teal-300' : 'text-amber-300'}`}>
                      {vd.green_percentage.toFixed(0)}%
                    </div>
                  </div>
                  <div className="text-center bg-black/30 border border-white/[0.05] rounded-lg p-2">
                    <div className="text-[8px] text-white/30 mb-0.5">Sell Vol</div>
                    <div className={`text-[10px] font-bold ${vd.red_percentage >= 55 ? 'text-rose-300' : 'text-amber-300'}`}>
                      {vd.red_percentage.toFixed(0)}%
                    </div>
                  </div>
                  <div className="text-center bg-black/30 border border-white/[0.05] rounded-lg p-2">
                    <div className="text-[8px] text-white/30 mb-0.5">Quality</div>
                    <div className={`text-[10px] font-bold ${
                      q === 'HEALTHY' || q === 'COMPRESSION' || q === 'SELLER_EXHAUSTION' ? 'text-teal-300'
                      : q === 'EXHAUSTION' || q === 'FAKE_BREAKOUT' ? 'text-rose-300'
                      : 'text-amber-300'
                    }`}>{q === 'NEUTRAL' ? '—' : q.replace('_', ' ')}</div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

      </div>

      {/* ─── FOOTER ──────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-t border-white/5 flex justify-between items-center bg-white/[0.015]">
        <div className="flex items-center gap-2">
          <span suppressHydrationWarning className={`w-2 h-2 rounded-full flex-shrink-0 ${isLive ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600'}`} />
          <div className="flex flex-col">
            <span className={`text-[10px] font-bold ${isLive ? 'text-emerald-400' : 'text-gray-500'}`}>
              {isLive ? 'Live Feed' : 'Cached'}
            </span>
            <span suppressHydrationWarning className="text-[9px] text-gray-600">
              {data.timestamp
                ? new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : '—'}
            </span>
          </div>
        </div>
        {(data.candles_analyzed ?? 0) > 0 && (
          <div className="flex flex-col items-end">
            <span className="text-[10px] font-bold text-white/50">{data.candles_analyzed}</span>
            <span className="text-[9px] text-gray-600">candles</span>
          </div>
        )}
      </div>
    </div>
  );
});

VolumePulseCard.displayName = 'VolumePulseCard';
export default VolumePulseCard;
