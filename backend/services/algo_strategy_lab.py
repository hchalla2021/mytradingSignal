"""
📚 Algo Strategy Lab — Proven Indian Index-Options Intraday Strategies
======================================================================
Eight battle-tested strategies that Indian intraday option buyers run on
NIFTY / BANKNIFTY / SENSEX, each continuously re-backtested on the live
5-minute candle stream so the strategy weights reflect what is actually
working *today* on *this* index — never a static assumption.

Strategies implemented (all widely known & backtested on NSE/BSE indices):
  ORB15       Opening Range Breakout (09:15–09:30 range, breakout after)
  VWAP_TREND  VWAP trend-hold (price above rising VWAP → CE, mirror → PE)
  EMA_CROSS   9/21 EMA crossover (classic option-scalper trend filter)
  SUPERTREND  Supertrend(10, 3) flip — most-used indicator in India
  RSI6040     RSI 60/40 momentum breakout (Indian variant of 70/30)
  BB_SQUEEZE  Bollinger squeeze → band breakout (volatility expansion)
  CPR_PIVot   Central Pivot Range / floor-pivot breakout (prev-day H/L/C)
  OI_BUILDUP  OI + price buildup (long buildup → CE, short buildup → PE)

Rolling backtest engine
-----------------------
Every REFRESH_SEC the lab replays the last ~200 five-minute candles
(≈2.5 trading days) per symbol. Each strategy is simulated with ATR-based
exits (SL = 1×ATR, target = 1.75×ATR — same risk model as QuantEdge) and
scored on win-rate, profit factor and net points. Those live scores become
the strategy's **voting weight** in the consensus.

Consensus contract ("aligned → BUY CE / BUY PE")
------------------------------------------------
  BUY CE fires when  bull-aligned strategies >= FIRE_ALIGN
                     AND weighted bull strength >= FIRE_STRENGTH
                     AND opposing strategies <= MAX_OPPOSITION
  BUY PE is the exact mirror.
The Smart AI Algo service fuses this consensus with its QuantEdge gates:
agreement boosts confidence; a fired consensus can promote WAIT → BUY/SELL.
"""

import json
import logging
import math
import time
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ── Tunables ─────────────────────────────────────────────────────────────────
REFRESH_SEC = 15.0            # full re-backtest cadence per symbol
MAX_CANDLES = 200             # candles pulled from cache (newest-first)
MIN_BARS = 30                 # minimum bars before strategies activate

ATR_PERIOD = 14
SL_ATR_MULT = 1.00            # backtest stop  = 1.00 × ATR  (QuantEdge parity)
TGT_ATR_MULT = 1.75           # backtest target = 1.75 × ATR

FIRE_ALIGN = 5                # strategies that must agree to fire consensus
FIRE_STRENGTH = 60.0          # weighted dominance (0-100) required to fire
MAX_OPPOSITION = 2            # max strategies allowed on the opposite side

STRATEGY_META: List[Tuple[str, str]] = [
    ("ORB15",      "Opening Range Breakout 15m"),
    ("VWAP_TREND", "VWAP Trend Hold"),
    ("EMA_CROSS",  "EMA 9/21 Crossover"),
    ("SUPERTREND", "Supertrend (10, 3)"),
    ("RSI6040",    "RSI 60/40 Momentum"),
    ("BB_SQUEEZE", "Bollinger Squeeze Breakout"),
    ("CPR_PIVOT",  "CPR / Floor Pivot"),
    ("OI_BUILDUP", "OI + Price Buildup"),
]


# ── Series helpers (chronological float lists) ───────────────────────────────

def _ema_series(vals: List[float], period: int) -> List[float]:
    out: List[float] = []
    if not vals:
        return out
    k = 2.0 / (period + 1)
    e = vals[0]
    for v in vals:
        e = v * k + e * (1 - k)
        out.append(e)
    return out


def _rsi_series(closes: List[float], period: int = 14) -> List[float]:
    n = len(closes)
    out = [50.0] * n
    if n < period + 1:
        return out
    gains = losses = 0.0
    for i in range(1, period + 1):
        d = closes[i] - closes[i - 1]
        gains += max(d, 0.0)
        losses += max(-d, 0.0)
    avg_g, avg_l = gains / period, losses / period
    out[period] = 100.0 if avg_l == 0 else 100.0 - 100.0 / (1.0 + avg_g / avg_l)
    for i in range(period + 1, n):
        d = closes[i] - closes[i - 1]
        avg_g = (avg_g * (period - 1) + max(d, 0.0)) / period
        avg_l = (avg_l * (period - 1) + max(-d, 0.0)) / period
        out[i] = 100.0 if avg_l == 0 else 100.0 - 100.0 / (1.0 + avg_g / avg_l)
    return out


def _atr_series(highs: List[float], lows: List[float], closes: List[float],
                period: int = ATR_PERIOD) -> List[float]:
    n = len(closes)
    if n == 0:
        return []
    trs = [highs[0] - lows[0]]
    for i in range(1, n):
        trs.append(max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        ))
    out = []
    a = trs[0]
    for i, tr in enumerate(trs):
        a = tr if i == 0 else (a * (period - 1) + tr) / period
        out.append(a)
    return out


def _session_vwap_series(dates: List[str], highs: List[float], lows: List[float],
                         closes: List[float], vols: List[float]) -> List[float]:
    """Session VWAP resetting each trading day. Falls back to the cumulative
    typical-price mean when volume is absent (index feeds report 0 volume)."""
    out: List[float] = []
    cum_pv = cum_v = cum_tp = 0.0
    bars = 0
    cur_day = ""
    for i in range(len(closes)):
        if dates[i] != cur_day:
            cur_day = dates[i]
            cum_pv = cum_v = cum_tp = 0.0
            bars = 0
        tp = (highs[i] + lows[i] + closes[i]) / 3.0
        v = max(0.0, vols[i])
        cum_pv += tp * v
        cum_v += v
        cum_tp += tp
        bars += 1
        out.append(cum_pv / cum_v if cum_v > 0 else cum_tp / bars)
    return out


def _bollinger_series(closes: List[float], window: int = 20, mult: float = 2.0):
    n = len(closes)
    mid = [closes[i] for i in range(n)]
    up = list(mid)
    lo = list(mid)
    width = [0.0] * n
    for i in range(n):
        seg = closes[max(0, i - window + 1): i + 1]
        m = sum(seg) / len(seg)
        var = sum((x - m) ** 2 for x in seg) / len(seg)
        sd = math.sqrt(var)
        mid[i] = m
        up[i] = m + mult * sd
        lo[i] = m - mult * sd
        width[i] = (up[i] - lo[i]) / m * 100.0 if m > 0 else 0.0
    return mid, up, lo, width


def _supertrend_series(highs: List[float], lows: List[float], closes: List[float],
                       period: int = 10, mult: float = 3.0) -> List[int]:
    """Returns per-bar trend: +1 (bullish) / -1 (bearish)."""
    n = len(closes)
    if n == 0:
        return []
    atr = _atr_series(highs, lows, closes, period)
    upper = [0.0] * n
    lower = [0.0] * n
    trend = [1] * n
    for i in range(n):
        hl2 = (highs[i] + lows[i]) / 2.0
        ub = hl2 + mult * atr[i]
        lb = hl2 - mult * atr[i]
        if i == 0:
            upper[i], lower[i] = ub, lb
            continue
        upper[i] = ub if (ub < upper[i - 1] or closes[i - 1] > upper[i - 1]) else upper[i - 1]
        lower[i] = lb if (lb > lower[i - 1] or closes[i - 1] < lower[i - 1]) else lower[i - 1]
        if trend[i - 1] == 1:
            trend[i] = -1 if closes[i] < lower[i] else 1
        else:
            trend[i] = 1 if closes[i] > upper[i] else -1
    return trend


# ── Candle context ───────────────────────────────────────────────────────────

class _Ctx:
    """Pre-computed indicator arrays shared by every strategy (chronological)."""

    def __init__(self, candles: List[Dict[str, Any]], tick: Dict[str, Any]):
        self.n = len(candles)
        self.ts = [str(c.get("timestamp", "") or "") for c in candles]
        self.dates = [t[:10] for t in self.ts]
        self.times = [t[11:16] if len(t) >= 16 else "" for t in self.ts]
        self.opens = [float(c.get("open", 0) or 0) for c in candles]
        self.highs = [float(c.get("high", 0) or 0) for c in candles]
        self.lows = [float(c.get("low", 0) or 0) for c in candles]
        self.closes = [float(c.get("close", 0) or 0) for c in candles]
        self.vols = [float(c.get("volume", 0) or 0) for c in candles]
        self.ois = [float(c.get("oi", 0) or 0) for c in candles]
        self.oi_prevs = [float(c.get("oi_prev", 0) or 0) for c in candles]

        self.ema9 = _ema_series(self.closes, 9)
        self.ema21 = _ema_series(self.closes, 21)
        self.rsi = _rsi_series(self.closes, 14)
        self.atr = _atr_series(self.highs, self.lows, self.closes)
        self.vwap = _session_vwap_series(self.dates, self.highs, self.lows, self.closes, self.vols)
        self.bb_mid, self.bb_up, self.bb_lo, self.bb_width = _bollinger_series(self.closes)
        self.supertrend = _supertrend_series(self.highs, self.lows, self.closes)

        # Per-day opening range (09:15 ≤ time < 09:30)
        self.or_high: Dict[str, float] = {}
        self.or_low: Dict[str, float] = {}
        for i in range(self.n):
            t = self.times[i]
            if "09:15" <= t < "09:30":
                d = self.dates[i]
                self.or_high[d] = max(self.or_high.get(d, 0.0), self.highs[i])
                self.or_low[d] = min(self.or_low.get(d, 1e12), self.lows[i])

        # Per-day previous-day H/L/C for CPR pivots
        day_hlc: Dict[str, List[float]] = {}
        for i in range(self.n):
            d = self.dates[i]
            agg = day_hlc.setdefault(d, [0.0, 1e12, 0.0])
            agg[0] = max(agg[0], self.highs[i])
            agg[1] = min(agg[1], self.lows[i])
            agg[2] = self.closes[i]
        ordered_days = sorted(day_hlc.keys())
        self.cpr: Dict[str, Dict[str, float]] = {}
        for j, d in enumerate(ordered_days):
            if j > 0:
                h, l, c = day_hlc[ordered_days[j - 1]]
            else:
                # First day in history — fall back to the live tick's prev-day levels
                h = float((tick or {}).get("prev_day_high", 0) or 0)
                l = float((tick or {}).get("prev_day_low", 0) or 0)
                c = float((tick or {}).get("prev_day_close", 0) or 0)
            if h <= 0 or l >= 1e12 or l <= 0 or c <= 0:
                continue
            pivot = (h + l + c) / 3.0
            bc = (h + l) / 2.0
            tc = 2.0 * pivot - bc
            self.cpr[d] = {"pivot": pivot, "tc": max(tc, bc), "bc": min(tc, bc)}


# ── Strategy signal series (each returns list[int] of −1/0/+1 per bar) ───────

def _sig_orb15(ctx: _Ctx) -> List[int]:
    out = [0] * ctx.n
    for i in range(ctx.n):
        d = ctx.dates[i]
        if ctx.times[i] < "09:30":
            continue
        orh = ctx.or_high.get(d, 0.0)
        orl = ctx.or_low.get(d, 0.0)
        if orh <= 0 or orl <= 0 or orl >= 1e12:
            continue
        if ctx.closes[i] > orh:
            out[i] = 1
        elif ctx.closes[i] < orl:
            out[i] = -1
    return out


def _sig_vwap_trend(ctx: _Ctx) -> List[int]:
    out = [0] * ctx.n
    for i in range(3, ctx.n):
        vw, c = ctx.vwap[i], ctx.closes[i]
        if vw <= 0:
            continue
        rising = ctx.vwap[i] >= ctx.vwap[i - 3]
        dist = (c - vw) / vw * 100.0
        if dist > 0.05 and rising:
            out[i] = 1
        elif dist < -0.05 and not rising:
            out[i] = -1
    return out


def _sig_ema_cross(ctx: _Ctx) -> List[int]:
    out = [0] * ctx.n
    for i in range(ctx.n):
        e9, e21, c = ctx.ema9[i], ctx.ema21[i], ctx.closes[i]
        if c <= 0:
            continue
        sep = abs(e9 - e21) / c * 100.0
        if sep < 0.02:               # too tight — churn zone
            continue
        out[i] = 1 if e9 > e21 else -1
    return out


def _sig_supertrend(ctx: _Ctx) -> List[int]:
    return list(ctx.supertrend)


def _sig_rsi6040(ctx: _Ctx) -> List[int]:
    out = [0] * ctx.n
    for i in range(ctx.n):
        r = ctx.rsi[i]
        if r >= 60:
            out[i] = 1
        elif r <= 40:
            out[i] = -1
    return out


def _sig_bb_squeeze(ctx: _Ctx) -> List[int]:
    out = [0] * ctx.n
    cur = 0
    for i in range(1, ctx.n):
        # squeeze = width in the lowest quartile of the trailing 60 bars
        seg = ctx.bb_width[max(0, i - 60): i]
        if len(seg) < 10:
            out[i] = 0
            continue
        sorted_seg = sorted(seg)
        q25 = sorted_seg[max(0, len(sorted_seg) // 4 - 1)]
        squeeze_prev = ctx.bb_width[i - 1] <= q25
        c = ctx.closes[i]
        if squeeze_prev and c > ctx.bb_up[i]:
            cur = 1
        elif squeeze_prev and c < ctx.bb_lo[i]:
            cur = -1
        elif cur == 1 and c < ctx.bb_mid[i]:
            cur = 0
        elif cur == -1 and c > ctx.bb_mid[i]:
            cur = 0
        out[i] = cur
    return out


def _sig_cpr_pivot(ctx: _Ctx) -> List[int]:
    out = [0] * ctx.n
    for i in range(ctx.n):
        cpr = ctx.cpr.get(ctx.dates[i])
        if not cpr:
            continue
        c = ctx.closes[i]
        if c > cpr["tc"]:
            out[i] = 1
        elif c < cpr["bc"]:
            out[i] = -1
    return out


def _sig_oi_buildup(ctx: _Ctx) -> List[int]:
    out = [0] * ctx.n
    for i in range(1, ctx.n):
        c_now, c_prev = ctx.closes[i], ctx.closes[i - 1]
        oi_now, oi_open = ctx.ois[i], ctx.oi_prevs[i]
        if c_prev <= 0 or oi_now <= 0 or oi_open <= 0:
            continue
        px_chg = (c_now - c_prev) / c_prev * 100.0
        oi_chg = (oi_now - oi_open) / oi_open * 100.0
        if px_chg > 0.05 and oi_chg > 0.05:
            out[i] = 1        # long buildup
        elif px_chg < -0.05 and oi_chg > 0.05:
            out[i] = -1       # short buildup
        elif px_chg > 0.05 and oi_chg < -0.05:
            out[i] = 1        # short covering (bullish)
        elif px_chg < -0.05 and oi_chg < -0.05:
            out[i] = -1       # long unwinding (bearish)
    return out


_SIGNAL_FNS = {
    "ORB15": _sig_orb15,
    "VWAP_TREND": _sig_vwap_trend,
    "EMA_CROSS": _sig_ema_cross,
    "SUPERTREND": _sig_supertrend,
    "RSI6040": _sig_rsi6040,
    "BB_SQUEEZE": _sig_bb_squeeze,
    "CPR_PIVOT": _sig_cpr_pivot,
    "OI_BUILDUP": _sig_oi_buildup,
}


# ── Backtest engine ──────────────────────────────────────────────────────────

def _backtest(ctx: _Ctx, sig: List[int]) -> Dict[str, Any]:
    """Replay the signal series with ATR exits. Long-only + short-only combined
    (option buyers trade both sides: CE on +1, PE on −1)."""
    trades = wins = 0
    gross_p = gross_l = 0.0
    pos = 0          # +1 long / −1 short / 0 flat
    entry = sl = tgt = 0.0

    for i in range(1, ctx.n):
        c, h, l = ctx.closes[i], ctx.highs[i], ctx.lows[i]
        if c <= 0:
            continue

        if pos != 0:
            # SL checked before target (conservative when both hit in one bar)
            exited = False
            pnl = 0.0
            if pos == 1:
                if l <= sl:
                    pnl, exited = sl - entry, True
                elif h >= tgt:
                    pnl, exited = tgt - entry, True
                elif sig[i] == -1:
                    pnl, exited = c - entry, True
            else:
                if h >= sl:
                    pnl, exited = entry - sl, True
                elif l <= tgt:
                    pnl, exited = entry - tgt, True
                elif sig[i] == 1:
                    pnl, exited = entry - c, True
            if exited:
                trades += 1
                if pnl > 0:
                    wins += 1
                    gross_p += pnl
                else:
                    gross_l += -pnl
                pos = 0

        if pos == 0 and sig[i] != 0 and sig[i - 1] != sig[i]:
            atr = max(ctx.atr[i], c * 0.0005)
            pos = sig[i]
            entry = c
            if pos == 1:
                sl, tgt = entry - atr * SL_ATR_MULT, entry + atr * TGT_ATR_MULT
            else:
                sl, tgt = entry + atr * SL_ATR_MULT, entry - atr * TGT_ATR_MULT

    # Close any open position at the last close (mark-to-market)
    if pos != 0 and ctx.n > 0 and ctx.closes[-1] > 0:
        pnl = (ctx.closes[-1] - entry) if pos == 1 else (entry - ctx.closes[-1])
        trades += 1
        if pnl > 0:
            wins += 1
            gross_p += pnl
        else:
            gross_l += -pnl

    net = gross_p - gross_l
    win_rate = (wins / trades * 100.0) if trades else 0.0
    pf = (gross_p / gross_l) if gross_l > 0 else (2.5 if gross_p > 0 else 0.0)
    return {
        "trades": trades,
        "win_rate": round(win_rate, 1),
        "profit_factor": round(min(pf, 9.99), 2),
        "net_points": round(net, 1),
        "avg_points": round(net / trades, 1) if trades else 0.0,
    }


def _strategy_weight(bt: Dict[str, Any]) -> float:
    """Voting weight from live backtest: better win-rate & PF ⇒ louder vote."""
    trades = int(bt.get("trades", 0) or 0)
    if trades < 3:
        return 0.6                      # untested on this tape — muted default
    wr = float(bt.get("win_rate", 0.0)) / 100.0
    pf = float(bt.get("profit_factor", 0.0))
    w = max(0.2, min(0.9, wr)) * max(0.5, min(2.5, pf))
    return round(max(0.2, min(2.25, w)), 2)


# ── Live notes per strategy (plain-English "why") ────────────────────────────

def _live_note(sid: str, ctx: _Ctx, live: int) -> str:
    i = ctx.n - 1
    if i < 0:
        return ""
    c = ctx.closes[i]
    if sid == "ORB15":
        d = ctx.dates[i]
        orh, orl = ctx.or_high.get(d, 0.0), ctx.or_low.get(d, 0.0)
        if orh > 0 and orl > 0 and orl < 1e12:
            if live == 1:
                return f"Above OR high {orh:.0f}"
            if live == -1:
                return f"Below OR low {orl:.0f}"
            return f"Inside range {orl:.0f}–{orh:.0f}"
        return "Opening range not formed"
    if sid == "VWAP_TREND":
        vw = ctx.vwap[i]
        return f"Px {'above' if c >= vw else 'below'} VWAP {vw:.0f}"
    if sid == "EMA_CROSS":
        return f"EMA9 {ctx.ema9[i]:.0f} {'>' if ctx.ema9[i] > ctx.ema21[i] else '<'} EMA21 {ctx.ema21[i]:.0f}"
    if sid == "SUPERTREND":
        return "Trend UP" if live == 1 else ("Trend DOWN" if live == -1 else "Flat")
    if sid == "RSI6040":
        return f"RSI {ctx.rsi[i]:.0f} ({'≥60 bull' if live == 1 else '≤40 bear' if live == -1 else '40–60 neutral'})"
    if sid == "BB_SQUEEZE":
        return "Breakout up" if live == 1 else ("Breakout down" if live == -1 else f"Width {ctx.bb_width[i]:.2f}%")
    if sid == "CPR_PIVOT":
        cpr = ctx.cpr.get(ctx.dates[i])
        if cpr:
            if live == 1:
                return f"Above TC {cpr['tc']:.0f}"
            if live == -1:
                return f"Below BC {cpr['bc']:.0f}"
            return f"Inside CPR {cpr['bc']:.0f}–{cpr['tc']:.0f}"
        return "No prev-day pivots"
    if sid == "OI_BUILDUP":
        return "Long buildup" if live == 1 else ("Short buildup" if live == -1 else "No OI edge")
    return ""


# ── Market direction meter (crash / rally detector) ─────────────────────────

def _market_direction(ctx: Optional[_Ctx], ind: Dict[str, Any],
                      live_price: float = 0.0) -> Dict[str, Any]:
    score = 0.0
    detail: List[str] = []
    velocity = 0.0
    atr_spike = False

    if ctx and ctx.n >= 12:
        # Live tick price (when available) replaces the last candle close so the
        # meter reacts tick-by-tick instead of waiting for the 5m bar to close.
        c = live_price if live_price > 0 else ctx.closes[-1]
        c3 = ctx.closes[-4]
        c10 = ctx.closes[-11]
        roc3 = (c - c3) / c3 * 100.0 if c3 > 0 else 0.0
        roc10 = (c - c10) / c10 * 100.0 if c10 > 0 else 0.0
        velocity = round(roc3 / 15.0, 4)          # 3 bars × 5 min
        score += 40.0 * math.tanh(roc3 / 0.15)
        score += 20.0 * math.tanh(roc10 / 0.30)
        # EMA posture
        if ctx.ema9[-1] > ctx.ema21[-1]:
            score += 10.0
            detail.append("EMA9>21")
        else:
            score -= 10.0
            detail.append("EMA9<21")
        # VWAP side
        vw = ctx.vwap[-1]
        if vw > 0:
            score += 15.0 * math.tanh((c - vw) / vw * 100.0 / 0.10)
            detail.append("Above VWAP" if c >= vw else "Below VWAP")
        # Consecutive candle pressure
        consec = 0
        for j in range(ctx.n - 1, max(0, ctx.n - 7), -1):
            d = ctx.closes[j] - ctx.opens[j]
            if consec == 0:
                consec = 1 if d > 0 else (-1 if d < 0 else 0)
            elif (consec > 0 and d > 0) or (consec < 0 and d < 0):
                consec += 1 if consec > 0 else -1
            else:
                break
        score += max(-15.0, min(15.0, consec * 4.0))
        if abs(consec) >= 3:
            detail.append(f"{abs(consec)} {'green' if consec > 0 else 'red'} bars")
        # ATR spike = volatility event
        if len(ctx.atr) >= 20:
            recent_tr = ctx.atr[-1]
            base = sum(ctx.atr[-20:-5]) / 15.0 if len(ctx.atr) >= 20 else recent_tr
            atr_spike = base > 0 and recent_tr / base >= 1.8
            if atr_spike:
                detail.append("ATR spike")
    else:
        # Fallback to tick indicators when candles are thin
        score += 30.0 * math.tanh(float(ind.get("roc5", 0.0)) / 0.15)
        score += 20.0 * math.tanh(float(ind.get("change_pct", 0.0)) / 0.5)
        score += 15.0 * math.tanh(float(ind.get("vwap_dist_pct", 0.0)) / 0.10)

    score = max(-100.0, min(100.0, score))
    if score >= 70:
        label, arrow = "SURGING", "⇈"
    elif score >= 40:
        label, arrow = "RISING", "↑"
    elif score >= 15:
        label, arrow = "DRIFT UP", "↗"
    elif score > -15:
        label, arrow = "SIDEWAYS", "→"
    elif score > -40:
        label, arrow = "DRIFT DOWN", "↘"
    elif score > -70:
        label, arrow = "FALLING", "↓"
    else:
        label, arrow = "CRASHING", "⇊"

    crash_alert = score <= -70 or (score <= -40 and atr_spike)
    surge_alert = score >= 70 or (score >= 40 and atr_spike)

    return {
        "score": round(score, 1),
        "label": label,
        "arrow": arrow,
        "crash_alert": crash_alert,
        "surge_alert": surge_alert,
        "velocity_pct_per_min": velocity,
        "detail": " · ".join(detail) if detail else "—",
    }


# ── Early-warning engine (anticipatory turn detection) ──────────────────────
# Detects a move BEFORE it fully forms, using five leading (not lagging)
# concepts institutional desks watch:
#   1. RSI momentum divergence   (price HH + RSI LH → exhaustion; mirror for lows)
#   2. Velocity + acceleration   (2nd derivative — momentum fading/building)
#   3. Volatility squeeze rank   (BB width in bottom quartile → breakout imminent)
#   4. VWAP reclaim/breakdown-in-progress (crossing flows, not crossed)
#   5. OI flow + PCR extremes    (short-covering fuel / put-base support)

def _early_warning(ctx: Optional[_Ctx], ind: Dict[str, Any],
                   live_price: float = 0.0) -> Dict[str, Any]:
    if not ctx or ctx.n < 30:
        return {
            "state": "NONE", "confidence": 0, "up_score": 0, "down_score": 0,
            "signals": [], "message": "Warming up — need more candle history",
        }

    closes = ctx.closes
    c = live_price if live_price > 0 else closes[-1]
    signals: List[str] = []
    up = down = 0.0

    # 1. RSI divergence over the last ~24 bars (two halves compared)
    win = min(24, ctx.n - 1)
    seg_c = closes[-win:]
    seg_r = ctx.rsi[-win:]
    half = win // 2
    if half >= 4:
        price_hh = max(seg_c[half:]) >= max(seg_c[:half]) * 0.9995
        rsi_lh = max(seg_r[half:]) < max(seg_r[:half]) - 1.5
        price_ll = min(seg_c[half:]) <= min(seg_c[:half]) * 1.0005
        rsi_hl = min(seg_r[half:]) > min(seg_r[:half]) + 1.5
        if price_hh and rsi_lh:
            down += 30
            signals.append("Bearish RSI divergence — rally losing internal strength")
        if price_ll and rsi_hl:
            up += 30
            signals.append("Bullish RSI divergence — selling losing force")

    # 2. Velocity + acceleration over 5-bar windows (includes live price)
    atr = max(ctx.atr[-1], c * 0.0003)
    v_now = c - closes[-6]
    v_prev = closes[-6] - closes[-11]
    accel = v_now - v_prev
    if v_now > 0 and accel < -1.0 * atr:
        down += 25
        signals.append("Up-move decelerating — momentum fading")
    elif v_now < 0 and accel > 1.0 * atr:
        up += 25
        signals.append("Down-move decelerating — selling drying up")
    elif v_now > 1.2 * atr and accel > 0:
        up += 15
        signals.append("Upward acceleration building")
    elif v_now < -1.2 * atr and accel < 0:
        down += 15
        signals.append("Downward acceleration building")

    # 2b. Stall at extremes — price pinned at session high/low but no longer
    # advancing = classic distribution/accumulation footprint before the turn.
    # ATR-relative proximity (not %) so narrow-range tapes can't mislabel sides.
    hi24 = max(seg_c) if seg_c else c
    lo24 = min(seg_c) if seg_c else c
    net5 = abs(c - closes[-6])
    range24 = hi24 - lo24
    if range24 >= 2.0 * atr:
        if c >= hi24 - 0.5 * atr and net5 < 0.6 * atr:
            down += 18
            signals.append("Stalling at highs — buyers exhausting")
        elif c <= lo24 + 0.5 * atr and net5 < 0.6 * atr:
            up += 18
            signals.append("Basing at lows — sellers exhausting")

    # 3. Volatility squeeze percentile → breakout imminent
    seg_w = ctx.bb_width[max(0, ctx.n - 60):]
    squeezing = False
    if len(seg_w) >= 12:
        q25 = sorted(seg_w)[max(0, len(seg_w) // 4 - 1)]
        squeezing = q25 > 0 and ctx.bb_width[-1] <= q25
        if squeezing:
            if c >= ctx.vwap[-1]:
                up += 15
                signals.append("Volatility squeeze — coiling ABOVE VWAP")
            else:
                down += 15
                signals.append("Volatility squeeze — coiling BELOW VWAP")

    # 4. VWAP reclaim / breakdown IN PROGRESS (crossing, not crossed)
    vw = ctx.vwap[-1]
    vw3 = ctx.vwap[-3] if ctx.n >= 3 else vw
    if vw > 0 and vw3 > 0:
        dist = (c - vw) / vw * 100.0
        prev_dist = (closes[-3] - vw3) / vw3 * 100.0
        if prev_dist < -0.05 and dist > -0.02:
            up += 20
            signals.append("VWAP reclaim in progress")
        elif prev_dist > 0.05 and dist < 0.02:
            down += 20
            signals.append("VWAP breakdown in progress")

    # 5. OI flow + PCR extremes (live option-market internals)
    oi_trend = str(ind.get("oi_trend", "") or "")
    if oi_trend == "SHORT_COVERING":
        up += 10
        signals.append("Short-covering fuel in OI")
    elif oi_trend == "LONG_UNWINDING":
        down += 10
        signals.append("Longs unwinding in OI")
    pcr = float(ind.get("pcr", 0) or 0)
    if pcr >= 1.35:
        up += 8
        signals.append(f"PCR {pcr:.2f} — heavy put base acts as support")
    elif 0 < pcr <= 0.65:
        down += 8
        signals.append(f"PCR {pcr:.2f} — heavy call wall acts as resistance")

    dominant = max(up, down)
    conf = int(min(95, dominant))
    if dominant < 30:
        state, message = "NONE", "No early turn signal — order flow balanced"
    elif squeezing and dominant < 45:
        state = "BREAKOUT_SOON"
        lean = "upside" if up >= down else "downside"
        message = f"Volatility compressed — breakout imminent, leaning {lean}"
    elif up >= down:
        state = "TURNING_UP"
        message = "Early signs of turning UP — CE setup may arm shortly"
    else:
        state = "TURNING_DOWN"
        message = "Early signs of turning DOWN — PE setup may arm shortly"

    return {
        "state": state,
        "confidence": conf,
        "up_score": round(up),
        "down_score": round(down),
        "signals": signals[:4],
        "message": message,
    }


# ── Strategy Lab service ─────────────────────────────────────────────────────

class StrategyLab:
    """Evaluates all strategies + rolling backtest per symbol with caching."""

    def __init__(self, cache):
        self._cache = cache
        self._payload: Dict[str, Dict[str, Any]] = {}
        self._payload_ts: Dict[str, float] = {}
        # Last computed candle context per symbol — lets the market-direction
        # meter refresh on EVERY tick while the heavy backtest stays on its
        # 15s cadence.
        self._ctx_cache: Dict[str, _Ctx] = {}

    async def evaluate(self, symbol: str, tick: Dict[str, Any],
                       ind: Dict[str, Any]) -> Dict[str, Any]:
        now = time.time()
        live_price = float((tick or {}).get("price", 0) or 0)
        cached = self._payload.get(symbol)
        if cached and now - self._payload_ts.get(symbol, 0.0) < REFRESH_SEC:
            # Serve cached backtest but recompute direction with the live tick
            # so the crash/rally meter never lags behind the tape.
            fresh = dict(cached)
            ctx = self._ctx_cache.get(symbol)
            fresh["market_direction"] = _market_direction(ctx, ind, live_price)
            fresh["early_warning"] = _early_warning(ctx, ind, live_price)
            return fresh

        candles = await self._load_candles(symbol)
        payload = self._compute(symbol, candles, tick, ind, live_price)
        self._payload[symbol] = payload
        self._payload_ts[symbol] = now
        return payload

    async def _load_candles(self, symbol: str) -> List[Dict[str, Any]]:
        try:
            raw = await self._cache.lrange(f"analysis_candles:{symbol}", 0, MAX_CANDLES - 1)
        except Exception:
            raw = []
        out: List[Dict[str, Any]] = []
        for item in raw:
            try:
                c = item if isinstance(item, dict) else json.loads(item)
            except Exception:
                continue
            if float(c.get("close", 0) or 0) > 0:
                out.append(c)
        out.reverse()                     # cache is newest-first → chronological
        return out

    def _compute(self, symbol: str, candles: List[Dict[str, Any]],
                 tick: Dict[str, Any], ind: Dict[str, Any],
                 live_price: float = 0.0) -> Dict[str, Any]:
        n = len(candles)
        if n < MIN_BARS:
            self._ctx_cache.pop(symbol, None)
            return {
                "strategy_lab": {
                    "updated": int(time.time() * 1000),
                    "bars_tested": n,
                    "window_label": f"{n} bars (warming up, need {MIN_BARS})",
                    "consensus": _empty_consensus(),
                    "strategies": [
                        {"id": sid, "name": name, "signal": "FLAT", "win_rate": 0.0,
                         "profit_factor": 0.0, "trades": 0, "net_points": 0.0,
                         "avg_points": 0.0, "weight": 0.0, "note": "Awaiting candle history"}
                        for sid, name in STRATEGY_META
                    ],
                },
                "market_direction": _market_direction(None, ind, live_price),
                "early_warning": _early_warning(None, ind, live_price),
            }

        ctx = _Ctx(candles, tick)
        self._ctx_cache[symbol] = ctx
        rows: List[Dict[str, Any]] = []
        bull_w = bear_w = total_w = 0.0
        bull_n = bear_n = 0
        leaders: List[Tuple[float, str]] = []

        for sid, name in STRATEGY_META:
            sig_series = _SIGNAL_FNS[sid](ctx)
            bt = _backtest(ctx, sig_series)
            live = sig_series[-1] if sig_series else 0

            # Live overlay for the OI strategy — trust real-time PCR/OI over candles
            if sid == "OI_BUILDUP":
                oi_trend = str(ind.get("oi_trend", "") or "")
                if oi_trend in ("LONG_BUILDUP", "SHORT_COVERING"):
                    live = 1
                elif oi_trend in ("SHORT_BUILDUP", "LONG_UNWINDING"):
                    live = -1

            w = _strategy_weight(bt)
            total_w += w
            if live == 1:
                bull_w += w
                bull_n += 1
                leaders.append((w, sid))
            elif live == -1:
                bear_w += w
                bear_n += 1
                leaders.append((w, sid))

            rows.append({
                "id": sid,
                "name": name,
                "signal": "CE" if live == 1 else ("PE" if live == -1 else "FLAT"),
                "win_rate": bt["win_rate"],
                "profit_factor": bt["profit_factor"],
                "trades": bt["trades"],
                "net_points": bt["net_points"],
                "avg_points": bt["avg_points"],
                "weight": w,
                "note": _live_note(sid, ctx, live),
            })

        # Consensus
        aligned = max(bull_n, bear_n)
        dom_w = max(bull_w, bear_w)
        strength = round(dom_w / total_w * 100.0, 1) if total_w > 0 else 0.0
        direction = 1 if bull_w >= bear_w else -1
        opposition = bear_n if direction == 1 else bull_n

        fired = (
            aligned >= FIRE_ALIGN
            and strength >= FIRE_STRENGTH
            and opposition <= MAX_OPPOSITION
        )
        if fired:
            consensus_signal = "BUY_CE" if direction == 1 else "BUY_PE"
        elif aligned >= 3 and strength >= 45:
            consensus_signal = "LEAN_CE" if direction == 1 else "LEAN_PE"
        else:
            consensus_signal = "NEUTRAL"

        leaders.sort(reverse=True)
        top_leaders = [sid for _, sid in leaders[:3]]

        days = len({d for d in ctx.dates if d})
        return {
            "strategy_lab": {
                "updated": int(time.time() * 1000),
                "bars_tested": n,
                "window_label": f"{n} × 5m bars · {days} session(s)",
                "consensus": {
                    "signal": consensus_signal,
                    "fired": fired,
                    "aligned": aligned,
                    "total": len(STRATEGY_META),
                    "bull_count": bull_n,
                    "bear_count": bear_n,
                    "strength": strength,
                    "needed": FIRE_ALIGN,
                    "leaders": top_leaders,
                },
                "strategies": rows,
            },
            "market_direction": _market_direction(ctx, ind, live_price),
            "early_warning": _early_warning(ctx, ind, live_price),
        }


def _empty_consensus() -> Dict[str, Any]:
    return {
        "signal": "NEUTRAL", "fired": False, "aligned": 0,
        "total": len(STRATEGY_META), "bull_count": 0, "bear_count": 0,
        "strength": 0.0, "needed": FIRE_ALIGN, "leaders": [],
    }
