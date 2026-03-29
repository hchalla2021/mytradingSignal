/**
 * Trade Zones – Buy/Sell Signals
 * ─────────────────────────────────────────────────────────────────
 * Architecture: Live WebSocket tick → instant_analysis (backend) → here
 * Independent: No external hooks, pure props – works with any data source
 * Signals: STRONG BUY / BUY / NO TRADE / SELL / STRONG SELL
 * Timeframes: 5-min entry + 15-min trend (dual confirmation)
 * Confidence: multi-factor weighted score 30–95 %
 * Shows: factor breakdown + 5-min production status panel
 */

'use client';

import React, { useMemo, useRef, useEffect } from 'react';

interface TradeSupportResistanceProps {
  symbol: string;
  symbolName: string;
  data: any;       // Live WebSocket tick (price, high, low, open, volume, …)
  analysis: any;   // Backend analysis (indicators sub-dict)
  marketStatus?: 'LIVE' | 'CLOSED' | 'OFFLINE' | 'PRE_OPEN' | 'FREEZE';
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────
function fmt(n: number, d = 0) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
}

type Factor = { name: string; value: number; max: number; label: string; icon: string };

function scoreFactor(
  name: string, value: number, max: number, rawLabel: string, icon: string
): Factor {
  return { name, value: Math.max(-max, Math.min(max, value)), max, label: rawLabel || '—', icon };
}

// ─────────────────────────────────────────────────────────────────
// Static signal styles — module-level to avoid object recreation on every tick
// Extended with glowClass for ultra-fast highlighting
// ─────────────────────────────────────────────────────────────────
const SIGNAL_STYLES: Record<string, { bg: string; border: string; text: string; badge: string; bar: string; glowClass: string; badgePulse: string }> = {
  'STRONG BUY':  { bg: 'bg-emerald-500/20', border: 'border-emerald-400/80', text: 'text-emerald-300', badge: 'bg-emerald-500/30 text-emerald-100 border border-emerald-400/60', bar: 'from-emerald-500 to-green-400', glowClass: 'tz-strong-buy', badgePulse: 'tz-badge-strong-buy' },
  'BUY':         { bg: 'bg-green-500/12',   border: 'border-green-400/60',   text: 'text-green-300',   badge: 'bg-green-500/25 text-green-200 border border-green-400/40',    bar: 'from-green-600 to-green-400',  glowClass: 'tz-buy', badgePulse: '' },
  'STRONG SELL': { bg: 'bg-rose-500/20',    border: 'border-rose-400/80',    text: 'text-rose-300',    badge: 'bg-rose-500/30 text-rose-100 border border-rose-400/60',       bar: 'from-rose-500 to-red-400',     glowClass: 'tz-strong-sell', badgePulse: 'tz-badge-strong-sell' },
  'SELL':        { bg: 'bg-red-500/12',     border: 'border-red-400/60',     text: 'text-red-300',     badge: 'bg-red-500/25 text-red-200 border border-red-400/40',           bar: 'from-red-600 to-red-400',      glowClass: 'tz-sell', badgePulse: '' },
  'NO TRADE':    { bg: 'bg-amber-500/10',   border: 'border-amber-400/40',   text: 'text-amber-300',   badge: 'bg-amber-500/20 text-amber-200',    bar: 'from-amber-500 to-yellow-400', glowClass: '', badgePulse: '' },
  'SIDEWAYS':    { bg: 'bg-gray-500/10',    border: 'border-gray-500/30',    text: 'text-gray-300',    badge: 'bg-gray-500/20 text-gray-300',      bar: 'from-gray-500 to-gray-400',    glowClass: '', badgePulse: '' },
};

// ─────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────
export const TradeSupportResistance: React.FC<TradeSupportResistanceProps> = ({
  symbol,
  symbolName,
  data,
  analysis,
  marketStatus = 'CLOSED',
}) => {

  // ── Core computation ─────────────────────────────────────────────
  const sig = useMemo(() => {
    const ind = analysis?.indicators ?? {};
    const price: number = data?.price ?? ind.price ?? 0;
    if (price === 0) return null;

    // ── Raw backend values ──────────────────────────────────────────
    const changePercent: number = ind.changePercent ?? data?.changePercent ?? 0;

    // rsi_5m is candle-based and falls to 50 when no candle cache exists.
    // ind.rsi is ALWAYS computed from live price momentum – use it as primary when rsi_5m = 50.
    const rsiMomentum: number = ind.rsi ?? 50;   // live-momentum RSI, always real
    const rsi5mRaw:    number = ind.rsi_5m ?? 50; // 0 if no candle cache
    const rsi15mRaw:   number = ind.rsi_15m ?? 50;
    // Use live RSI when the candle-based one is stuck at the 50 default
    const rsi5m:  number = (rsi5mRaw !== 50 || rsiMomentum === 50) ? rsi5mRaw : rsiMomentum;
    const rsi15m: number = (rsi15mRaw !== 50 || rsiMomentum === 50) ? rsi15mRaw : Math.round(rsiMomentum * 0.85 + 50 * 0.15);

    const rsiMomStatus: string  = (ind.rsi_momentum_status ?? '').toUpperCase();
    const rsiMomConf:   number  = ind.rsi_momentum_confidence ?? 50;
    const emaAlignment: string  = (ind.ema_alignment ?? 'NEUTRAL').toUpperCase();
    const vwapPos:      string  = (ind.vwap_position ?? 'AT_VWAP').toUpperCase();
    const stTrend:      string  = (ind.supertrend_10_2_trend ?? 'NEUTRAL').toUpperCase();
    const trendStruct:  string  = (ind.trend_structure ?? 'SIDEWAYS').toUpperCase();
    const candleQ:      string  = (ind.candle_quality_signal ?? 'NEUTRAL').toUpperCase();
    const smartMoney:   string  = (ind.smart_money_signal    ?? 'NEUTRAL').toUpperCase();
    const buySteup:     string  = (ind.buy_setup_status  ?? '').toUpperCase();
    const sellSetup:    string  = (ind.sell_setup_status ?? '').toUpperCase();
    const volumeStrength: string = (ind.volume_strength ?? '').toUpperCase();
    const ema200: number = ind.ema_200 ?? 0;
    const vwap:   number = ind.vwap    ?? 0;
    // VWAP distance % — positive = above, negative = below; used for scaled scoring and display
    const vwapDist: number = vwap > 0 ? ((price - vwap) / vwap * 100) : 0;
    const support:    number = ind.support    ?? data?.low  ?? 0;
    const resistance: number = ind.resistance ?? data?.high ?? 0;
    const momentum:   number = ind.momentum   ?? 50;

    // ── Backend-computed trend helpers (always live, never default to NEUTRAL) ──
    // ind.trend_color = 'BULLISH' | 'BEARISH' | 'NEUTRAL'  (from EMA + price position)
    // ind.trend       = 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' (mapped from raw tick trend)
    // ind.candle_direction = 'BULLISH' | 'BEARISH' | 'DOJI'
    const trendColor:    string = (ind.trend_color      ?? 'NEUTRAL').toUpperCase();
    const trendMapped:   string = (ind.trend            ?? 'SIDEWAYS').toUpperCase();
    const candleDir:     string = (ind.candle_direction ?? 'DOJI').toUpperCase();

    // ── Dual timeframe trends ─────────────────────────────────────────────
    // Priority: backend explicit key → live RSI → trend_color → momentum → changePercent
    const raw5minKey:  string = (ind.trend_5min  ?? '').toUpperCase();
    const raw15minKey: string = (ind.trend_15min ?? '').toUpperCase();

    const derive5min = (): 'UP' | 'DOWN' | 'NEUTRAL' => {
      if (raw5minKey === 'UP' || raw5minKey === 'DOWN') return raw5minKey as any;
      // SuperTrend is the most reliable 5-min signal
      if (stTrend === 'BULLISH') return 'UP';
      if (stTrend === 'BEARISH') return 'DOWN';
      // Live RSI (substituted with momentum RSI when candle cache missing)
      if (rsi5m >= 54) return 'UP';
      if (rsi5m <= 46) return 'DOWN';
      // Direct momentum-based RSI (always computed)
      if (rsiMomentum >= 58) return 'UP';
      if (rsiMomentum <= 42) return 'DOWN';
      // Momentum score (0-100 scale, 50=neutral)
      if (momentum >= 58) return 'UP';
      if (momentum <= 42) return 'DOWN';
      // Price change is the final arbiter
      if (changePercent > 0.15) return 'UP';
      if (changePercent < -0.15) return 'DOWN';
      return 'NEUTRAL';
    };

    const derive15min = (): 'UP' | 'DOWN' | 'NEUTRAL' => {
      if (raw15minKey === 'UP' || raw15minKey === 'DOWN') return raw15minKey as any;
      // EMA alignment is the classic 15-min structure filter
      if (emaAlignment.includes('BULLISH')) return 'UP';
      if (emaAlignment.includes('BEARISH')) return 'DOWN';
      // Trend structure (higher-highs / lower-lows)
      if (trendStruct === 'HIGHER_HIGHS_LOWS') return 'UP';
      if (trendStruct === 'LOWER_HIGHS_LOWS')  return 'DOWN';
      // Backend trend_color (computed from EMA spread + price position)
      if (trendColor === 'BULLISH') return 'UP';
      if (trendColor === 'BEARISH') return 'DOWN';
      // Mapped trend (from raw tick trend field, always live)
      if (trendMapped === 'UPTREND')   return 'UP';
      if (trendMapped === 'DOWNTREND') return 'DOWN';
      // SAR + change combo
      return 'NEUTRAL';
    };

    const trend5min  = derive5min();
    const trend15min = derive15min();

    // ── FACTOR VOTING (100 pts max) ────────────────────────────────
    const factors: Factor[] = [];

    // 1 · SuperTrend 10,2  (20 pts) – most reliable intraday trend indicator
    factors.push(scoreFactor(
      'SuperTrend', stTrend === 'BULLISH' ? 20 : stTrend === 'BEARISH' ? -20 : 0, 20,
      stTrend || 'NEUTRAL', stTrend === 'BULLISH' ? '▲' : stTrend === 'BEARISH' ? '▼' : '─',
    ));

    // 2 · RSI Dual TF (15 pts)
    // Backend labels: 'STRONG' | 'OVERBOUGHT' | 'NEUTRAL' | 'WEAK' | 'OVERSOLD' | 'DIVERGENCE'
    // These NEVER equal 'STRONG_BUY'/'SELL' – must use the actual label set
    const rsiVote = (() => {
      if (rsiMomStatus === 'STRONG')     return 15;   // sustained above 60 → bullish momentum
      if (rsiMomStatus === 'OVERBOUGHT') return 6;    // >70 – long but be cautious
      if (rsiMomStatus === 'WEAK')       return -15;  // sustained below 45 → bearish momentum
      if (rsiMomStatus === 'OVERSOLD')   return -8;   // <30 – still falling in short term
      // NEUTRAL or DIVERGENCE: use raw RSI values directly
      if (rsi5m >= 60 && rsi15m >= 55)   return 12;
      if (rsi5m >= 55)                   return 6;
      if (rsi5m <= 40 && rsi15m <= 45)   return -12;
      if (rsi5m <= 45)                   return -6;
      return (rsi5m - 50) * 0.25;        // small proportional for truly neutral
    })();
    const rsiLabel = rsiMomStatus && rsiMomStatus !== 'DIVERGENCE' && rsiMomStatus !== ''
      ? `${rsiMomStatus} (5m:${rsi5m.toFixed(0)})`
      : `5m ${rsi5m.toFixed(0)} | 15m ${rsi15m.toFixed(0)}`;
    factors.push(scoreFactor(
      'RSI Dual TF', rsiVote, 15, rsiLabel,
      rsiVote > 4 ? '▲' : rsiVote < -4 ? '▼' : '─',
    ));

    // 3 · EMA Alignment (15 pts)
    const emaVote =
      emaAlignment === 'ALL_BULLISH'      ? 15 : emaAlignment === 'PARTIAL_BULLISH' ?  8 :
      emaAlignment === 'ALL_BEARISH'      ? -15 : emaAlignment === 'PARTIAL_BEARISH' ? -8 : 0;
    factors.push(scoreFactor(
      'EMA Stack', emaVote, 15, emaAlignment || 'NEUTRAL',
      emaVote > 0 ? '▲' : emaVote < 0 ? '▼' : '─',
    ));

    // 4 · VWAP Position (15 pts) — distance-scaled conviction
    // AT_VWAP = decision point → 0 pts; farther = stronger bias
    // ±0.25% → ±3 pts | ±0.5% → ±6 | ±1.0% → ±12 | ±1.25%+ → ±15 (cap)
    const vwapVote = vwap > 0
      ? Math.max(-15, Math.min(15, Math.round(vwapDist * 12)))
      : (vwapPos === 'ABOVE_VWAP' ? 10 : vwapPos === 'BELOW_VWAP' ? -10 : 0);
    const vwapLabel = vwap > 0
      ? `${vwapPos === 'ABOVE_VWAP' ? 'ABOVE' : vwapPos === 'BELOW_VWAP' ? 'BELOW' : 'AT'} ${vwapDist >= 0 ? '+' : ''}${vwapDist.toFixed(2)}%`
      : vwapPos.replace('_VWAP', '');
    factors.push(scoreFactor(
      'VWAP', vwapVote, 15, vwapLabel,
      vwapVote > 0 ? '▲' : vwapVote < 0 ? '▼' : '─',
    ));

    // 5 · Daily Change % (12 pts) – direct price reality check
    // NIFTY/BANKNIFTY/SENSEX always above EMA200 – raw price change is far more honest
    const chgVote =
      changePercent <= -1.0 ? -12 :
      changePercent <= -0.5 ? -9  :
      changePercent <= -0.2 ? -5  :
      changePercent >= 1.0  ?  12 :
      changePercent >= 0.5  ?  9  :
      changePercent >= 0.2  ?  5  :
      changePercent * 4;            // proportional ±0–0.2%
    factors.push(scoreFactor(
      'Day Change', chgVote, 12,
      `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%`,
      chgVote > 0 ? '▲' : chgVote < 0 ? '▼' : '─',
    ));

    // 6 · EMA 200 (8 pts) – structural filter only; indices live above EMA200 almost always
    // Give NEGATIVE points only when price has broken below (real bearish signal)
    // Avoid inflating bullish score just because index is above its 200 EMA (always true)
    const ema200Vote =
      (ema200 > 0 && price < ema200 * 0.998) ? -8 :   // clearly below → strong bear
      (ema200 > 0 && price < ema200)          ? -4 :   // just below → mild bear
      (ema200 > 0 && price > ema200 * 1.01)   ?  4 :   // well above → mild bull boost
      0;                                                // just above: neutral (expected for indices)
    factors.push(scoreFactor(
      'EMA 200', ema200Vote, 8,
      ema200 > 0 ? (price > ema200 ? `ABOVE (${((price/ema200-1)*100).toFixed(1)}%)` : 'BELOW') : 'N/A',
      ema200Vote > 0 ? '▲' : ema200Vote < 0 ? '▼' : '─',
    ));

    // 8 · Smart Money Flow (8 pts)
    const smVote =
      smartMoney === 'STRONG_BUY' ? 8 : smartMoney === 'BUY' ? 5 :
      smartMoney === 'STRONG_SELL'? -8 : smartMoney === 'SELL' ? -5 : 0;
    factors.push(scoreFactor(
      'Smart Money', smVote, 8, smartMoney || 'NEUTRAL',
      smVote > 0 ? '▲' : smVote < 0 ? '▼' : '─',
    ));

    // 9 · Candle Quality (7 pts)
    const cqVote =
      candleQ === 'STRONG_BUY' ? 7 : candleQ === 'BUY' ? 4 :
      candleQ === 'STRONG_SELL'? -7 : candleQ === 'SELL' ? -4 : 0;
    factors.push(scoreFactor(
      'Candle Quality', cqVote, 7, candleQ || 'NEUTRAL',
      cqVote > 0 ? '▲' : cqVote < 0 ? '▼' : '─',
    ));

    // 10 · Volume Conviction (6 pts) — confirms direction when strong, questions it when weak
    // Professional logic: high volume on up-move = bullish conviction; high vol on down-move = bearish
    // Weak volume on ANY move = suspect (can fade); weak volume on sell-off = bears unconvinced → mild +
    const volIsStrong = volumeStrength.includes('STRONG') || volumeStrength.includes('HIGH') || volumeStrength.includes('VERY');
    const volIsAbove  = volumeStrength.includes('ABOVE');
    const volIsWeak   = volumeStrength.includes('WEAK') || volumeStrength.includes('LOW');
    const volVote = volIsStrong
      ? (changePercent >= 0 ? 6 : -6)   // strong vol confirms the direction
      : volIsAbove
      ? (changePercent >= 0 ? 3 : -3)
      : volIsWeak
      ? (changePercent >= 0 ? -2 : 2)   // low vol = no conviction in the move
      : 0;
    const volLabel = volumeStrength
      ? volumeStrength.replace('_VOLUME', '').replace(/_/g, ' ')
      : 'NORMAL';
    factors.push(scoreFactor(
      'Volume', volVote, 6, volLabel,
      volVote > 0 ? '▲' : volVote < 0 ? '▼' : '─',
    ));

    const totalScore = Math.round(factors.reduce((s, f) => s + f.value, 0)); // range ~−116 to +116

    // ── SIGNAL DETERMINATION ─────────────────────────────────────
    // Signal tier thresholds are unchanged.
    // CONFIDENCE: replaced per-tier formulas with a single unified function.
    //
    // OLD formula had a critical cliff: at score 47→48 (BUY→STRONG BUY),
    // confidence DROPPED from 83% to 68% — exactly backwards.
    // Root cause: each tier's formula re-started from its own base, so the
    // STRONG tier always opened lower than the top of the weaker tier.
    //
    // NEW formula: continuous, monotonically increasing at every boundary.
    //   abs=0  → 40%   (neutral, zero lean)
    //   abs=8  → 50%   (NO TRADE top — continuity with SIDEWAYS)
    //   abs=18 → 52%   (BUY / SELL entry — clean start)
    //   abs=48 → 72%   (STRONG entry — picks up exactly where BUY left off)
    //   abs≥95 → 95%   (asymptotic maximum)
    // Verified: each piece-value matches the adjacent piece at every boundary.
    const absScore = Math.abs(totalScore);
    const unifiedConf = (a: number): number => {
      if (a <= 8)  return Math.round(40 + a * 1.25);                        // 40 → 50  NO TRADE
      if (a < 18)  return Math.round(50 + (a - 8)  * 0.2);                 // 50 → 52  SIDEWAYS
      if (a < 48)  return Math.round(52 + (a - 18) * (20 / 30));           // 52 → 72  BUY / SELL
      return Math.min(95, Math.round(72 + (a - 48) * (23 / 48)));          // 72 → 95  STRONG
    };

    let action: string;
    let signalReason: string;

    if (totalScore >= 48) {
      action = 'STRONG BUY';
      signalReason = 'All major indicators aligned bullish';
    } else if (totalScore >= 18) {
      action = 'BUY';
      signalReason = 'Majority of signals confirm upside';
    } else if (totalScore <= -48) {
      action = 'STRONG SELL';
      signalReason = 'All major indicators aligned bearish';
    } else if (totalScore <= -18) {
      action = 'SELL';
      signalReason = 'Majority of signals confirm downside';
    } else if (Math.abs(totalScore) <= 8) {
      action = 'NO TRADE';
      signalReason = 'Balanced signals – wait for a clear break';
    } else {
      action = 'SIDEWAYS';
      signalReason = 'Mixed signals – no clean directional setup';
    }

    // Market-closed penalty: flat deduction preserves the same numeric feel.
    let confidence = unifiedConf(absScore);
    if (marketStatus !== 'LIVE') confidence = Math.max(30, confidence - 15);
    confidence = Math.round(confidence);

    // ── SUPPORT / RESISTANCE DISTANCE ────────────────────────────
    const distToSupport    = support > 0    ? ((price - support)    / price * 100) : 0;
    const distToResistance = resistance > 0 ? ((resistance - price) / price * 100) : 0;

    // ── STYLE MAPPING — uses module-level SIGNAL_STYLES (never recreated) ──────────
    const style = SIGNAL_STYLES[action] ?? SIGNAL_STYLES['SIDEWAYS'];

    return {
      action, confidence, signalReason,
      style, totalScore, factors,
      trend5min, trend15min,
      rsi5m, rsi15m, rsiMomStatus, rsi5mRaw, rsiMomentum,
      emaAlignment, vwapPos, stTrend, trendColor,
      price, changePercent, momentum,
      support, resistance, distToSupport, distToResistance,
      vwap, vwapDist, ema200, volumeStrength,
      buySteup, sellSetup, candleQ, smartMoney,
    };
  }, [data, analysis, marketStatus]);

  // ── Loading skeleton ──────────────────────────────────────────────
  if (!sig) {
    return (
      <div className="bg-dark-surface/60 rounded-2xl p-4 border-2 border-gray-700/40 animate-pulse">
        <div className="flex items-center justify-between mb-3">
          <div className="h-4 bg-gray-700/50 rounded w-24" />
          <div className="h-4 bg-gray-700/50 rounded w-12" />
        </div>
        <div className="h-8 bg-gray-700/50 rounded w-full mb-3" />
        <div className="grid grid-cols-2 gap-2">
          {[1,2,3,4].map(i => <div key={i} className="h-10 bg-gray-700/40 rounded" />)}
        </div>
        <div className="text-center text-xs text-gray-500 mt-3">{symbolName} — awaiting feed…</div>
      </div>
    );
  }

  const {
    action, confidence, signalReason, style, totalScore, factors,
    trend5min, trend15min, rsi5m, rsiMomStatus, rsi5mRaw, rsiMomentum,
    emaAlignment, vwapPos, stTrend, trendColor,
    changePercent, momentum, support, resistance,
    distToSupport, distToResistance, vwap, vwapDist, volumeStrength,
  } = sig;

  // ── Flash ONLY when signal status actually changes ──────────────
  const cardRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const trend5Ref = useRef<HTMLDivElement>(null);
  const trend15Ref = useRef<HTMLDivElement>(null);
  const prevAction = useRef(action);
  const prevTrend5 = useRef(trend5min);
  const prevTrend15 = useRef(trend15min);

  useEffect(() => {
    // Card flash — only when the BUY/SELL/STRONG action changes
    if (prevAction.current !== action && cardRef.current) {
      cardRef.current.classList.remove('tz-status-changed');
      void cardRef.current.offsetWidth;
      cardRef.current.classList.add('tz-status-changed');
    }
    // Badge flash — only when action changes
    if (prevAction.current !== action && badgeRef.current) {
      badgeRef.current.classList.remove('tz-badge-changed');
      void badgeRef.current.offsetWidth;
      badgeRef.current.classList.add('tz-badge-changed');
    }
    // 5min trend flash — only when trend direction changes
    if (prevTrend5.current !== trend5min && trend5Ref.current) {
      trend5Ref.current.classList.remove('tz-trend-changed');
      void trend5Ref.current.offsetWidth;
      trend5Ref.current.classList.add('tz-trend-changed');
    }
    // 15min trend flash — only when trend direction changes
    if (prevTrend15.current !== trend15min && trend15Ref.current) {
      trend15Ref.current.classList.remove('tz-trend-changed');
      void trend15Ref.current.offsetWidth;
      trend15Ref.current.classList.add('tz-trend-changed');
    }
    prevAction.current = action;
    prevTrend5.current = trend5min;
    prevTrend15.current = trend15min;
  }, [action, trend5min, trend15min]);

  const trendIcon  = (t: string) => t === 'UP' ? '▲' : t === 'DOWN' ? '▼' : '─';
  const trendClass = (t: string) =>
    t === 'UP'   ? 'text-emerald-400' :
    t === 'DOWN' ? 'text-red-400' :
    'text-gray-400';

  const changeSigned = changePercent >= 0 ? `+${changePercent.toFixed(2)}` : `${changePercent.toFixed(2)}`;
  const isLive = marketStatus === 'LIVE';

  // Factor icon colour
  const factorColor = (v: number) =>
    v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-gray-500';

  // ── Trend alignment check for highlighting ─────────────────────
  const bothAligned = trend5min !== 'NEUTRAL' && trend5min === trend15min;
  const alignedBullish = bothAligned && trend5min === 'UP';
  const alignedBearish = bothAligned && trend5min === 'DOWN';

  // ── Proximity alert for support/resistance ─────────────────────
  const nearSupport = distToSupport < 0.5 && distToSupport >= 0;
  const nearResistance = distToResistance < 0.5 && distToResistance >= 0;

  return (
    <div ref={cardRef} suppressHydrationWarning className={`${style.bg} rounded-2xl border-2 ${style.border} shadow-xl overflow-hidden ${style.glowClass} transition-[box-shadow,border-color] duration-150`}>

      {/* ── HEADER BAR ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div>
          <h3 className="text-sm font-bold text-white tracking-wide">{symbolName}</h3>
          <p className="text-[10px] text-gray-500 mt-0.5">5min Entry + 15min Trend</p>
        </div>
        <div className="flex items-center gap-2">
          {isLive && (
            <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/40">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              LIVE
            </span>
          )}
          <span suppressHydrationWarning className={`text-xs font-bold px-2 py-0.5 rounded-full ${style.badge}`}>
            {changeSigned}%
          </span>
        </div>
      </div>

      {/* ── DUAL TIMEFRAME ROW — Sharp highlighted when aligned ─── */}
      <div className={`grid grid-cols-2 gap-2 px-3 pb-2 ${bothAligned ? 'tz-aligned-box' : ''} ${alignedBullish ? 'tz-aligned-bullish' : ''} ${alignedBearish ? 'tz-aligned-bearish' : ''}`}>
        {/* 5 MIN */}
        <div className={`rounded-xl p-2.5 border transition-all duration-100 ${
          trend5min === 'UP' ? 'bg-emerald-950/40 border-emerald-500/60' :
          trend5min === 'DOWN' ? 'bg-red-950/40 border-red-500/60' :
          'bg-dark-bg/50 border-dark-border/40'
        }`}>
          <div className="text-[9px] text-gray-500 font-semibold uppercase tracking-widest mb-1">5 MIN ENTRY</div>
          <div className={`text-lg font-black ${trendClass(trend5min)} flex items-center gap-1.5 tz-instant ${
            trend5min === 'UP' ? 'tz-trend-up-active' : trend5min === 'DOWN' ? 'tz-trend-down-active' : ''
          }`} ref={trend5Ref}>
            <span suppressHydrationWarning className="text-xl">{trendIcon(trend5min)}</span>
            <span suppressHydrationWarning>{trend5min}</span>
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5 tz-instant">
            RSI{' '}
            <span suppressHydrationWarning className={`font-bold ${rsi5m >= 56 ? 'text-emerald-400' : rsi5m <= 44 ? 'text-red-400' : 'text-gray-400'}`}>
              {rsi5m.toFixed(0)}
            </span>
            {rsi5mRaw === 50 && rsiMomentum !== 50 && (
              <span className="text-[8px] text-gray-600 ml-1">(live:{rsiMomentum.toFixed(0)})</span>
            )}
          </div>
        </div>
        {/* 15 MIN */}
        <div className={`rounded-xl p-2.5 border transition-all duration-100 ${
          trend15min === 'UP' ? 'bg-emerald-950/40 border-emerald-500/60' :
          trend15min === 'DOWN' ? 'bg-red-950/40 border-red-500/60' :
          'bg-dark-bg/50 border-dark-border/40'
        }`}>
          <div className="text-[9px] text-gray-500 font-semibold uppercase tracking-widest mb-1">15 MIN TREND</div>
          <div className={`text-lg font-black ${trendClass(trend15min)} flex items-center gap-1.5 tz-instant ${
            trend15min === 'UP' ? 'tz-trend-up-active' : trend15min === 'DOWN' ? 'tz-trend-down-active' : ''
          }`} ref={trend15Ref}>
            <span suppressHydrationWarning className="text-xl">{trendIcon(trend15min)}</span>
            <span suppressHydrationWarning>{trend15min}</span>
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5 tz-instant">
            EMA{' '}
            <span suppressHydrationWarning className={`font-bold ${emaAlignment.includes('BULLISH') ? 'text-emerald-400' : emaAlignment.includes('BEARISH') ? 'text-red-400' : trendColor === 'BULLISH' ? 'text-emerald-400' : trendColor === 'BEARISH' ? 'text-red-400' : 'text-gray-400'}`}>
              {emaAlignment === 'NEUTRAL' && trendColor !== 'NEUTRAL'
                ? trendColor
                : emaAlignment.replace('ALL_', '').replace('PARTIAL_', 'PARTIAL ')}
            </span>
          </div>
        </div>
        {/* Alignment badge — shown when both timeframes match */}
        {bothAligned && (
          <div className={`col-span-2 text-center py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${
            alignedBullish ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/50' :
            'bg-red-500/20 text-red-300 border border-red-400/50'
          }`}>
            ⚡ BOTH TIMEFRAMES {alignedBullish ? 'BULLISH' : 'BEARISH'} — HIGH CONVICTION
          </div>
        )}
      </div>

      {/* ── BIG SIGNAL BADGE — Ultra-highlighted for STRONG signals ── */}
      <div className="px-3 pb-2">
        <div ref={badgeRef} suppressHydrationWarning className={`text-center rounded-xl py-3 ${style.bg} border-2 ${style.border} ${style.badgePulse} ${
          action === 'STRONG BUY' || action === 'STRONG SELL' ? 'shadow-lg' : ''
        }`}>
          <div suppressHydrationWarning className={`font-black tracking-wider tz-instant ${
            action === 'STRONG BUY' || action === 'STRONG SELL' ? 'text-2xl' : 'text-xl'
          } ${style.text}`}>
            {action === 'STRONG BUY' ? '🟢 ' : action === 'STRONG SELL' ? '🔴 ' : action === 'BUY' ? '▲ ' : action === 'SELL' ? '▼ ' : ''}
            {action}
            {action === 'STRONG BUY' ? ' 🟢' : action === 'STRONG SELL' ? ' 🔴' : ''}
          </div>
          <div className={`text-[10px] mt-1 font-semibold ${
            action.includes('STRONG') ? style.text : 'text-gray-500'
          }`}>{signalReason}</div>
        </div>
      </div>

      {/* ── CONFIDENCE BAR — Instant update ──────────────────────── */}
      <div className="px-3 pb-3">
        <div className="flex justify-between text-[10px] font-semibold mb-1">
          <span className="text-gray-500">Confidence</span>
          <span suppressHydrationWarning className={`tz-instant font-black ${style.text} ${confidence >= 80 ? 'text-sm' : ''}`}>{confidence}%</span>
        </div>
        <div className={`h-2.5 bg-gray-800/80 rounded-full overflow-hidden ${confidence >= 75 ? 'ring-1 ring-offset-1 ring-offset-transparent' : ''} ${
          confidence >= 75 && action.includes('BUY') ? 'ring-emerald-400/40' : confidence >= 75 && action.includes('SELL') ? 'ring-red-400/40' : ''
        }`}>
          <div
            suppressHydrationWarning
            className={`h-full bg-gradient-to-r ${style.bar} rounded-full tz-conf-bar`}
            style={{ width: `${confidence}%` }}
          />
        </div>
        <div className="flex justify-between text-[9px] text-gray-600 mt-0.5">
          <span>30</span><span>50</span><span className={confidence >= 70 ? 'text-amber-400 font-bold' : ''}>70</span><span className={confidence >= 90 ? 'text-emerald-400 font-bold' : ''}>95</span>
        </div>
      </div>

      {/* ── KEY INDICATORS GRID ─────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-1.5 px-3 pb-3">
        {[
          {
            label: 'VWAP',
            // Show actual distance % from VWAP — the real intraday reference
            value: vwapDist !== 0
              ? `${vwapPos === 'ABOVE_VWAP' ? '▲' : vwapPos === 'BELOW_VWAP' ? '▼' : '~'} ${vwapDist >= 0 ? '+' : ''}${vwapDist.toFixed(2)}%`
              : vwapPos.replace('_VWAP', ''),
            bull: vwapPos === 'ABOVE_VWAP',
            bear: vwapPos === 'BELOW_VWAP',
          },
          { label: 'SuperTrend', value: stTrend || '—', bull: stTrend === 'BULLISH', bear: stTrend === 'BEARISH' },
          {
            label: 'Support',
            value: support > 0 ? `₹${fmt(support)}  -${distToSupport.toFixed(1)}%` : '—',
            bull: distToSupport > 1.5,
            bear: distToSupport < 0.4,
            highlight: nearSupport,
          },
          {
            label: 'Resist',
            value: resistance > 0 ? `₹${fmt(resistance)}  +${distToResistance.toFixed(1)}%` : '—',
            bull: distToResistance > 1.5,
            bear: distToResistance < 0.4,
            highlight: nearResistance,
          },
          {
            label: 'Volume',
            value: volumeStrength ? volumeStrength.replace('_VOLUME', '').replace(/_/g, ' ') : '—',
            bull: volumeStrength.includes('STRONG') || volumeStrength.includes('HIGH'),
            bear: volumeStrength.includes('WEAK') || volumeStrength.includes('LOW'),
          },
          { label: 'Momentum', value: `${momentum.toFixed(0)}/100`, bull: momentum > 60, bear: momentum < 40 },
        ].map(({ label, value, bull, bear, highlight }: any) => (
          <div key={label} className={`bg-dark-bg/40 rounded-lg px-2.5 py-1.5 border flex items-center justify-between gap-1 transition-all duration-100 ${
            highlight ? 'tz-near-zone border-amber-400/60' : 'border-dark-border/30'
          }`}>
            <span className="text-[9px] text-gray-500 font-semibold truncate">{label}</span>
            <span suppressHydrationWarning className={`text-[10px] font-bold truncate tz-instant ${bull ? 'text-emerald-400' : bear ? 'text-red-400' : 'text-gray-300'}`}>{value}</span>
          </div>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════
          5 MIN PREDICTION
      ══════════════════════════════════════════════════════════ */}
      <div className="border-t border-dark-border/40 bg-dark-bg/30 px-4 py-3 space-y-3">

        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">5 Min Prediction</span>
          <span suppressHydrationWarning className={`text-[10px] font-bold px-2 py-1 rounded ${style.badge}`}>
            {confidence}% CONFIDENCE
          </span>
        </div>

        {/* Dual Confidence Display */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col bg-gray-900/50 rounded-lg px-2 py-1.5 border border-gray-700/30">
            <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wide">CONFIDENCE</span>
            <span suppressHydrationWarning className="text-[13px] font-black text-emerald-300 mt-0.5">{confidence}%</span>
            <div className="w-full h-2 rounded-full bg-gray-800 overflow-hidden mt-1">
              <div
                suppressHydrationWarning
                className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 tz-conf-bar rounded-full"
                style={{ width: `${Math.min(100, confidence)}%` }}
              />
            </div>
          </div>

          <div className="flex flex-col bg-gray-900/50 rounded-lg px-2 py-1.5 border border-gray-700/30">
            <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wide">Actual Market</span>
            <span suppressHydrationWarning className="text-[13px] font-black text-teal-300 mt-0.5">
              {Math.round(Math.abs(totalScore) * 2 + (confidence * 0.3))}%
            </span>
            <div className="w-full h-2 rounded-full bg-gray-800 overflow-hidden mt-1">
              <div
                suppressHydrationWarning
                className="h-full bg-gradient-to-r from-teal-500 to-teal-400 tz-conf-bar rounded-full"
                style={{ width: `${Math.min(100, Math.round(Math.abs(totalScore) * 2 + (confidence * 0.3)))}%` }}
              />
            </div>
          </div>
        </div>

        {/* Direction + Conflict Assessment */}
        {(() => {
          const predDir =
            (trend5min === trend15min && trend5min !== 'NEUTRAL') ? trend5min
            : trend5min !== 'NEUTRAL' ? trend5min
            : trend15min;
          const same5m15m = trend5min !== 'NEUTRAL' && trend5min === trend15min;
          const conflict  = trend5min !== 'NEUTRAL' && trend15min !== 'NEUTRAL' && trend5min !== trend15min;
          const dirColor  = predDir === 'UP'   ? 'text-emerald-400'
                          : predDir === 'DOWN' ? 'text-red-400'
                          : 'text-amber-400';
          const dirBorder = predDir === 'UP'   ? 'border-emerald-500/50'
                          : predDir === 'DOWN' ? 'border-red-500/50'
                          : 'border-amber-500/40';
          const dirBg     = predDir === 'UP'   ? 'bg-emerald-500/10'
                          : predDir === 'DOWN' ? 'bg-red-500/10'
                          : 'bg-amber-500/[0.08]';
          const dirIcon   = predDir === 'UP'   ? '▲' : predDir === 'DOWN' ? '▼' : '▬';
          
          const dispConf = Math.max(30, Math.min(90, Math.round(
            same5m15m ? confidence
            : conflict ? confidence * 0.75
            : confidence * 0.90
          )));
          
          const ctxNote = same5m15m ? '5m + 15m aligned — strong conviction'
                        : conflict   ? '⚠ 5m vs 15m conflict — use caution'
                        : trend5min !== 'NEUTRAL' ? '5m signal · 15m neutral'
                        : '15m trend · 5m forming';

          return (
            <>
              <div className={`rounded-lg border ${dirBorder} ${dirBg} px-3 py-2.5`}>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span suppressHydrationWarning className={`text-sm font-black ${dirColor}`}>
                    {dirIcon} {predDir === 'NEUTRAL' ? 'FLAT' : predDir}
                  </span>
                  <span className="text-[9px] text-gray-400 flex-1">{ctxNote}</span>
                  <span suppressHydrationWarning className={`text-sm font-black ${dirColor}`}>{dispConf}%</span>
                </div>
                <div className="h-2 bg-gray-800 rounded-full overflow-hidden border border-white/5">
                  <div
                    suppressHydrationWarning
                    className={`h-full rounded-full bg-gradient-to-r ${style.bar} tz-conf-bar`}
                    style={{ width: `${dispConf}%` }}
                  />
                </div>
              </div>

              {/* Timeframe Momentum Indicators */}
              <div className="space-y-1.5 bg-gray-900/30 rounded-lg p-2.5 border border-gray-700/20">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wide">5-Min Momentum</span>
                  <span suppressHydrationWarning className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    trend5min === 'UP' ? 'bg-emerald-500/25 text-emerald-300' :
                    trend5min === 'DOWN' ? 'bg-red-500/25 text-red-300' :
                    'bg-amber-500/15 text-amber-300'
                  }`}>
                    {trend5min === 'UP' ? '▲' : trend5min === 'DOWN' ? '▼' : '→'} {trend5min}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wide">15-Min Trend</span>
                  <span suppressHydrationWarning className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    trend15min === 'UP' ? 'bg-emerald-500/25 text-emerald-300' :
                    trend15min === 'DOWN' ? 'bg-red-500/25 text-red-300' :
                    'bg-amber-500/15 text-amber-300'
                  }`}>
                    {trend15min === 'UP' ? '▲' : trend15min === 'DOWN' ? '▼' : '→'} {trend15min}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wide">Alignment</span>
                  <span suppressHydrationWarning className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    same5m15m ? 'bg-emerald-500/25 text-emerald-300' :
                    conflict ? 'bg-red-500/25 text-red-300' :
                    'bg-amber-500/15 text-amber-300'
                  }`}>
                    {same5m15m ? '🔗 Aligned' : conflict ? '⚠️ Conflict' : '⏳ Forming'}
                  </span>
                </div>
              </div>

              {/* Movement Probability */}
              <div className="space-y-2">
                <p className="text-[9px] font-bold text-gray-500 uppercase tracking-wide">Movement Probability</p>
                <div className="flex items-center gap-0.5 h-7 rounded-md overflow-hidden bg-gray-950/50 border border-gray-700/30">
                  {/* Bullish */}
                  <div
                    suppressHydrationWarning
                    className="h-full bg-gradient-to-r from-emerald-600 to-emerald-500 flex items-center justify-center min-w-[2px] tz-conf-bar"
                    style={{
                      width: `${Math.max(5, Math.min(95, Math.round(
                        Math.max(0, totalScore + confidence / 10) * 0.8
                      )))}%`,
                    }}
                  >
                    <span className="text-[9px] font-black text-white px-1 truncate whitespace-nowrap tz-instant">
                      {Math.round(Math.max(0, totalScore + confidence / 10) * 0.8)}%↑
                    </span>
                  </div>
                  {/* Bearish */}
                  <div
                    suppressHydrationWarning
                    className="h-full bg-gradient-to-l from-red-600 to-red-500 flex items-center justify-center ml-auto min-w-[2px] tz-conf-bar"
                    style={{
                      width: `${Math.max(5, Math.min(95, Math.round(
                        Math.max(0, -totalScore + confidence / 10) * 0.8
                      )))}%`,
                    }}
                  >
                    <span className="text-[9px] font-black text-white px-1 truncate whitespace-nowrap tz-instant">
                      {Math.round(Math.max(0, -totalScore + confidence / 10) * 0.8)}%↓
                    </span>
                  </div>
                </div>
              </div>

              {/* Early Signal Detection - fixed height to prevent layout shift on mobile */}
              <div className={`pt-2 border-t min-h-[28px] ${
                (confidence >= 75 || same5m15m) 
                  ? (predDir === 'UP' ? 'border-emerald-500/30' : predDir === 'DOWN' ? 'border-red-500/30' : 'border-gray-700/20')
                  : 'border-gray-700/20'
              }`}>
                {(confidence >= 75 || same5m15m) && (
                  <span suppressHydrationWarning className={`text-[10px] font-black uppercase tracking-wide ${
                    predDir === 'UP' ? 'text-emerald-400' : predDir === 'DOWN' ? 'text-red-400' : 'text-amber-400'
                  }`}>
                    ⚡ {confidence >= 80 ? 'STRONG' : 'MODERATE'} {predDir === 'NEUTRAL' ? 'NEUTRAL' : predDir} SIGNAL DETECTED
                  </span>
                )}
              </div>
            </>
          );
        })()}

        {/* Factor rows */}
        <div className="space-y-1 border-t border-gray-700/20 pt-2">
          <p className="text-[9px] font-bold text-gray-600 uppercase tracking-wide">Factor Breakdown</p>
          {factors.map(f => {
            const pct = Math.abs(f.value) / f.max * 100;
            const isBull = f.value > 0;
            const isBear = f.value < 0;
            const isMaxed = pct >= 90;
            return (
              <div key={f.name} className={`flex items-center gap-1.5 ${isMaxed ? 'py-0.5' : ''}`}>
                <span className={`text-[9px] font-black w-3 text-center ${factorColor(f.value)} ${isMaxed ? 'text-[10px]' : ''}`}>{f.icon}</span>
                <span className={`text-[9px] w-20 truncate ${isMaxed ? 'font-bold text-gray-300' : 'text-gray-500'}`}>{f.name}</span>
                <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    suppressHydrationWarning
                    className={`h-full rounded-full tz-conf-bar ${isBull ? 'bg-emerald-500' : isBear ? 'bg-red-500' : 'bg-gray-600'} ${isMaxed ? 'shadow-[0_0_6px] shadow-current' : ''}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span suppressHydrationWarning className={`text-[9px] font-semibold w-16 text-right truncate tz-instant ${factorColor(f.value)}`}>{f.label}</span>
              </div>
            );
          })}
        </div>

        {/* Summary line */}
        <div suppressHydrationWarning className={`text-center text-[11px] font-black rounded-lg py-2 border-2 tz-instant ${
          action === 'STRONG BUY' ? 'bg-emerald-500/25 text-emerald-200 border-emerald-400/60 shadow-lg shadow-emerald-500/20' :
          action === 'STRONG SELL' ? 'bg-red-500/25 text-red-200 border-red-400/60 shadow-lg shadow-red-500/20' :
          style.badge
        }`}>
          {action} · {confidence}% Conf · Score {totalScore > 0 ? '+' : ''}{totalScore}
        </div>

        {/* Support / Resistance distance */}
        {(support > 0 || resistance > 0) && (
          <div className="flex justify-between mt-2 px-1">
            <span className={`text-[10px] font-bold ${
              nearSupport ? 'text-amber-400 tz-instant' : 'text-emerald-400/70'
            }`}>
              {nearSupport ? '⚠️ ' : ''}Support {distToSupport.toFixed(2)}% below
            </span>
            <span className={`text-[10px] font-bold ${
              nearResistance ? 'text-amber-400 tz-instant' : 'text-red-400/70'
            }`}>
              Resistance {distToResistance.toFixed(2)}% above{nearResistance ? ' ⚠️' : ''}
            </span>
          </div>
        )}
      </div>

    </div>
  );
};

export default TradeSupportResistance;
