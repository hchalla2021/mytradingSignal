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

import React, { useMemo } from 'react';

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
// ─────────────────────────────────────────────────────────────────
const SIGNAL_STYLES: Record<string, { bg: string; border: string; text: string; badge: string; bar: string }> = {
  'STRONG BUY':  { bg: 'bg-emerald-500/15', border: 'border-emerald-400/70', text: 'text-emerald-300', badge: 'bg-emerald-500/25 text-emerald-200', bar: 'from-emerald-500 to-green-400' },
  'BUY':         { bg: 'bg-green-500/10',   border: 'border-green-400/50',   text: 'text-green-300',   badge: 'bg-green-500/20 text-green-200',    bar: 'from-green-600 to-green-400'   },
  'STRONG SELL': { bg: 'bg-rose-500/15',    border: 'border-rose-400/70',    text: 'text-rose-300',    badge: 'bg-rose-500/25 text-rose-200',      bar: 'from-rose-500 to-red-400'      },
  'SELL':        { bg: 'bg-red-500/10',     border: 'border-red-400/50',     text: 'text-red-300',     badge: 'bg-red-500/20 text-red-200',        bar: 'from-red-600 to-red-400'       },
  'NO TRADE':    { bg: 'bg-amber-500/10',   border: 'border-amber-400/40',   text: 'text-amber-300',   badge: 'bg-amber-500/20 text-amber-200',    bar: 'from-amber-500 to-yellow-400'  },
  'SIDEWAYS':    { bg: 'bg-gray-500/10',    border: 'border-gray-500/30',    text: 'text-gray-300',    badge: 'bg-gray-500/20 text-gray-300',      bar: 'from-gray-500 to-gray-400'     },
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
    const sarTrend:     string  = (ind.sar_trend  ?? 'NEUTRAL').toUpperCase();
    const trendStruct:  string  = (ind.trend_structure ?? 'SIDEWAYS').toUpperCase();
    const candleQ:      string  = (ind.candle_quality_signal ?? 'NEUTRAL').toUpperCase();
    const smartMoney:   string  = (ind.smart_money_signal    ?? 'NEUTRAL').toUpperCase();
    const vwmaEma:      string  = (ind.vwma_ema_signal ?? 'WAIT').toUpperCase();
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
      if (sarTrend === 'BEARISH' && changePercent < -0.3) return 'DOWN';
      if (sarTrend === 'BULLISH' && changePercent > 0.3)  return 'UP';
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

    // 7 · Parabolic SAR (10 pts)
    const sarVote = sarTrend === 'BULLISH' ? 10 : sarTrend === 'BEARISH' ? -10 : 0;
    factors.push(scoreFactor(
      'Parabolic SAR', sarVote, 10, sarTrend || 'NEUTRAL',
      sarVote > 0 ? '▲' : sarVote < 0 ? '▼' : '─',
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
    // Thresholds calibrated so a moderate bearish day (-0.5%) scores ~ -35 → SELL
    let action: string;
    let confidence: number;
    let signalReason: string;

    if (totalScore >= 48) {
      action = 'STRONG BUY';
      confidence = Math.min(95, 68 + (totalScore - 48) * 0.54);
      signalReason = 'All major indicators aligned bullish';
    } else if (totalScore >= 18) {
      action = 'BUY';
      confidence = Math.min(84, 52 + (totalScore - 18) * 1.07);
      signalReason = 'Majority of signals confirm upside';
    } else if (totalScore <= -48) {
      action = 'STRONG SELL';
      confidence = Math.min(95, 68 + (-totalScore - 48) * 0.54);
      signalReason = 'All major indicators aligned bearish';
    } else if (totalScore <= -18) {
      action = 'SELL';
      confidence = Math.min(84, 52 + (-totalScore - 18) * 1.07);
      signalReason = 'Majority of signals confirm downside';
    } else if (Math.abs(totalScore) <= 8) {
      action = 'NO TRADE';
      confidence = 50;
      signalReason = 'Balanced signals – wait for a clear break';
    } else {
      action = 'SIDEWAYS';
      confidence = 42 + Math.abs(totalScore) * 0.5;
      signalReason = 'Mixed signals – no clean directional setup';
    }

    // Market-closed penalty
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
      emaAlignment, vwapPos, stTrend, sarTrend, trendColor,
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

  return (
    <div suppressHydrationWarning className={`${style.bg} rounded-2xl border-2 ${style.border} shadow-xl transition-all duration-300 overflow-hidden`}>

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

      {/* ── DUAL TIMEFRAME ROW ──────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 px-3 pb-2">
        {/* 5 MIN */}
        <div className="bg-dark-bg/50 rounded-xl p-2.5 border border-dark-border/40">
          <div className="text-[9px] text-gray-500 font-semibold uppercase tracking-widest mb-1">5 MIN ENTRY</div>
          <div className={`text-base font-bold ${trendClass(trend5min)} flex items-center gap-1`}>
            <span suppressHydrationWarning>{trendIcon(trend5min)}</span>
            <span suppressHydrationWarning>{trend5min}</span>
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5">
            RSI{' '}
            <span suppressHydrationWarning className={rsi5m >= 56 ? 'text-emerald-400' : rsi5m <= 44 ? 'text-red-400' : 'text-gray-400'}>
              {rsi5m.toFixed(0)}
            </span>
            {rsi5mRaw === 50 && rsiMomentum !== 50 && (
              <span className="text-[8px] text-gray-600 ml-1">(live:{rsiMomentum.toFixed(0)})</span>
            )}
          </div>
        </div>
        {/* 15 MIN */}
        <div className="bg-dark-bg/50 rounded-xl p-2.5 border border-dark-border/40">
          <div className="text-[9px] text-gray-500 font-semibold uppercase tracking-widest mb-1">15 MIN TREND</div>
          <div className={`text-base font-bold ${trendClass(trend15min)} flex items-center gap-1`}>
            <span suppressHydrationWarning>{trendIcon(trend15min)}</span>
            <span suppressHydrationWarning>{trend15min}</span>
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5">
            EMA{' '}
            <span suppressHydrationWarning className={emaAlignment.includes('BULLISH') ? 'text-emerald-400' : emaAlignment.includes('BEARISH') ? 'text-red-400' : trendColor === 'BULLISH' ? 'text-emerald-400' : trendColor === 'BEARISH' ? 'text-red-400' : 'text-gray-400'}>
              {emaAlignment === 'NEUTRAL' && trendColor !== 'NEUTRAL'
                ? trendColor
                : emaAlignment.replace('ALL_', '').replace('PARTIAL_', 'PARTIAL ')}
            </span>
          </div>
        </div>
      </div>

      {/* ── BIG SIGNAL BADGE ────────────────────────────────────── */}
      <div className="px-3 pb-2">
        <div suppressHydrationWarning className={`text-center rounded-xl py-2 ${style.bg} border ${style.border}`}>
          <div suppressHydrationWarning className={`text-xl font-black tracking-wider ${style.text}`}>{action}</div>
          <div className="text-[10px] text-gray-500 mt-0.5">{signalReason}</div>
        </div>
      </div>

      {/* ── CONFIDENCE BAR ──────────────────────────────────────── */}
      <div className="px-3 pb-3">
        <div className="flex justify-between text-[10px] font-semibold mb-1">
          <span className="text-gray-500">Confidence</span>
          <span suppressHydrationWarning className={style.text}>{confidence}%</span>
        </div>
        <div className="h-2 bg-gray-800/80 rounded-full overflow-hidden">
          <div
            suppressHydrationWarning
            className={`h-full bg-gradient-to-r ${style.bar} rounded-full transition-all duration-700`}
            style={{ width: `${confidence}%` }}
          />
        </div>
        <div className="flex justify-between text-[9px] text-gray-600 mt-0.5">
          <span>30</span><span>50</span><span>70</span><span>95</span>
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
            // Green = safe buffer (far from support), Red = danger (price near support, could break)
            bull: distToSupport > 1.5,
            bear: distToSupport < 0.4,
          },
          {
            label: 'Resist',
            value: resistance > 0 ? `₹${fmt(resistance)}  +${distToResistance.toFixed(1)}%` : '—',
            // Green = room to rally (far from resistance), Red = capped (near resistance)
            bull: distToResistance > 1.5,
            bear: distToResistance < 0.4,
          },
          {
            label: 'Volume',
            value: volumeStrength ? volumeStrength.replace('_VOLUME', '').replace(/_/g, ' ') : '—',
            bull: volumeStrength.includes('STRONG') || volumeStrength.includes('HIGH'),
            bear: volumeStrength.includes('WEAK') || volumeStrength.includes('LOW'),
          },
          { label: 'Momentum', value: `${momentum.toFixed(0)}/100`, bull: momentum > 60, bear: momentum < 40 },
        ].map(({ label, value, bull, bear }) => (
          <div key={label} className="bg-dark-bg/40 rounded-lg px-2.5 py-1.5 border border-dark-border/30 flex items-center justify-between gap-1">
            <span className="text-[9px] text-gray-500 font-semibold truncate">{label}</span>
            <span suppressHydrationWarning className={`text-[10px] font-bold truncate ${bull ? 'text-emerald-400' : bear ? 'text-red-400' : 'text-gray-300'}`}>{value}</span>
          </div>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════
          5 MIN PREDICTION
      ══════════════════════════════════════════════════════════ */}
      <div className="border-t border-dark-border/40 bg-dark-bg/30 px-3 py-2.5">

        {/* Header: label + confidence pill */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">5 Min Prediction</span>
          <span suppressHydrationWarning className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${style.badge}`}>
            {confidence}% Confidence
          </span>
        </div>

        {/* Direction pill + confidence bar: combined 5m + 15m → signal */}
        {(() => {
          // Combined direction: both agree → use that; else 5m leads (faster), else 15m
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
          // Confidence modifier: full confidence when aligned, reduced when 5m only, penalised when conflicting
          const dispConf = same5m15m ? confidence
                         : conflict   ? Math.max(30, confidence - 12)
                         : Math.max(30, confidence - 6);
          const ctxNote = same5m15m ? '5m + 15m aligned'
                        : conflict   ? '⚠ 5m vs 15m conflict'
                        : trend5min !== 'NEUTRAL' ? '5m signal · 15m neutral'
                        : '15m trend · 5m forming';
          return (
            <div className={`rounded-xl border ${dirBorder} ${dirBg} px-2.5 py-2 mb-2`}>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className={`text-xs font-black ${dirColor}`}>
                  {dirIcon} {predDir === 'NEUTRAL' ? 'FLAT' : predDir}
                </span>
                <span className="text-[9px] text-gray-500">{ctxNote}</span>
                <span suppressHydrationWarning className={`text-xs font-black ${dirColor}`}>{dispConf}%</span>
              </div>
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden border border-white/5">
                <div
                  suppressHydrationWarning
                  className={`h-full rounded-full bg-gradient-to-r ${style.bar} transition-all duration-700`}
                  style={{ width: `${dispConf}%` }}
                />
              </div>
            </div>
          );
        })()}

        {/* Factor rows */}
        <div className="space-y-1">
          {factors.map(f => {
            const pct = Math.abs(f.value) / f.max * 100;
            const isBull = f.value > 0;
            const isBear = f.value < 0;
            return (
              <div key={f.name} className="flex items-center gap-1.5">
                <span className={`text-[9px] font-bold w-3 text-center ${factorColor(f.value)}`}>{f.icon}</span>
                <span className="text-[9px] text-gray-500 w-24 truncate">{f.name}</span>
                {/* Mini bar */}
                <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    suppressHydrationWarning
                    className={`h-full rounded-full transition-all duration-500 ${isBull ? 'bg-emerald-500' : isBear ? 'bg-red-500' : 'bg-gray-600'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span suppressHydrationWarning className={`text-[9px] font-semibold w-16 text-right truncate ${factorColor(f.value)}`}>{f.label}</span>
              </div>
            );
          })}
        </div>

        {/* Summary line */}
        <div suppressHydrationWarning className={`mt-2 text-center text-[10px] font-bold rounded-lg py-1 ${style.badge}`}>
          {action} · {confidence}% Confidence · Score {totalScore > 0 ? '+' : ''}{totalScore}
        </div>

        {/* Support / Resistance distance */}
        {(support > 0 || resistance > 0) && (
          <div className="flex justify-between mt-1.5">
            <span className="text-[9px] text-emerald-400/70">
              Support {distToSupport.toFixed(2)}% below
            </span>
            <span className="text-[9px] text-red-400/70">
              Resistance {distToResistance.toFixed(2)}% above
            </span>
          </div>
        )}
      </div>

    </div>
  );
};

export default TradeSupportResistance;
