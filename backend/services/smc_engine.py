"""
🏛️ Advanced SMC & Market Structure Engine
==========================================
Institutional-behavior-first analysis for intraday index options.

Reads the market the way big players build positions:
  1. Structure   — HTF(15m) + LTF(5m) swings, BOS / CHoCH / MSS, protected swings
  2. Liquidity   — equal highs/lows, PDH/PDL, session extremes, internal vs
                   external pools, sweeps/grabs, inducement, trap detection
  3. Zones       — order blocks (valid / mitigated / breaker), FVG / IFVG, BPR,
                   displacement legs
  4. Location    — dealing range, premium / discount, equilibrium, OTE
  5. Confluence  — VWAP, volume delta, OI buildup, PCR
  6. Behavior    — absorption, exhaustion, SMT divergence, session character
  7. Intent      — accumulation / manipulation / distribution phase read

NO-REPAINT GUARANTEE:
  • Only CLOSED candles are used for structure (live candle = price ref only).
  • A swing needs SWING_K closed bars on its right before it exists.
  • Events are detected in a single causal left→right walk — later data can
    never rewrite an earlier event.
  • Same input series ⇒ byte-identical output (pure functions, no globals).

Output is PROBABILISTIC by design: verdict + confidence + continuation /
reversal / chop probabilities. No certainty is ever claimed.
"""

from __future__ import annotations

import math
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

Candle = Dict[str, Any]

# ── Tunables ──────────────────────────────────────────────────────────────────

SWING_K            = 2      # bars each side to confirm a fractal swing
MAJOR_SWING_K      = 3      # stronger fractal for dealing-range anchors
DISPLACEMENT_ATR   = 1.35   # candle range ≥ k×ATR = displacement
DISPLACEMENT_BODY  = 0.55   # body must dominate the range
FVG_MIN_ATR        = 0.20   # min gap size relative to ATR
EQ_LEVEL_TOL_ATR   = 0.18   # equal high/low clustering tolerance (×ATR)
SWEEP_LOOKBACK     = 40     # candles scanned for liquidity sweeps
MAX_POOLS          = 6
MAX_ZONES          = 4
MAX_EVENTS         = 6

VERDICTS = ("STRONG_SELL", "SELL", "NEUTRAL", "BUY", "STRONG_BUY")

# Factor weights per market regime (each profile sums to 1.0)
REGIME_WEIGHTS: Dict[str, Dict[str, float]] = {
    "TRENDING": {
        "structure": 0.26, "liquidity": 0.10, "zones": 0.12, "location": 0.08,
        "momentum": 0.14, "confluence": 0.14, "smt": 0.06, "intent": 0.10,
    },
    "RANGING": {
        "structure": 0.14, "liquidity": 0.20, "zones": 0.14, "location": 0.16,
        "momentum": 0.08, "confluence": 0.12, "smt": 0.06, "intent": 0.10,
    },
    "VOLATILE": {
        "structure": 0.18, "liquidity": 0.20, "zones": 0.10, "location": 0.10,
        "momentum": 0.10, "confluence": 0.12, "smt": 0.08, "intent": 0.12,
    },
    "SQUEEZE": {
        "structure": 0.16, "liquidity": 0.18, "zones": 0.18, "location": 0.12,
        "momentum": 0.08, "confluence": 0.12, "smt": 0.06, "intent": 0.10,
    },
}


# ── Small numeric helpers ─────────────────────────────────────────────────────

def _f(c: Candle, key: str) -> float:
    try:
        return float(c.get(key) or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _rnd(v: Optional[float], nd: int = 2) -> Optional[float]:
    if v is None:
        return None
    try:
        if math.isnan(v) or math.isinf(v):
            return None
        return round(float(v), nd)
    except (TypeError, ValueError):
        return None


def _median(vals: List[float]) -> float:
    if not vals:
        return 0.0
    s = sorted(vals)
    m = len(s) // 2
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2.0


def _linear_slope(values: List[float]) -> float:
    n = len(values)
    if n < 3:
        return 0.0
    x_mean = (n - 1) / 2.0
    y_mean = sum(values) / n
    num = sum((i - x_mean) * (v - y_mean) for i, v in enumerate(values))
    den = sum((i - x_mean) ** 2 for i in range(n))
    return num / den if den else 0.0


# ── Indicators ────────────────────────────────────────────────────────────────

def _atr(candles: List[Candle], period: int = 14) -> float:
    if len(candles) < 2:
        return 0.0
    trs: List[float] = []
    for i in range(1, len(candles)):
        h, l = _f(candles[i], "high"), _f(candles[i], "low")
        pc = _f(candles[i - 1], "close")
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    window = trs[-period:] if len(trs) >= period else trs
    return sum(window) / len(window) if window else 0.0


def _atr_series(candles: List[Candle], period: int = 14) -> List[float]:
    """Rolling ATR values (one per closed bar after warmup) for percentile rank."""
    out: List[float] = []
    trs: List[float] = []
    for i in range(1, len(candles)):
        h, l = _f(candles[i], "high"), _f(candles[i], "low")
        pc = _f(candles[i - 1], "close")
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
        if len(trs) >= period:
            out.append(sum(trs[-period:]) / period)
    return out


def _ema(series: List[float], period: int) -> Optional[float]:
    if len(series) < 3:
        return None
    k = 2.0 / (period + 1)
    if len(series) >= period:
        val = sum(series[:period]) / period
        rest = series[period:]
    else:
        val, rest = series[0], series[1:]
    for price in rest:
        val = price * k + val * (1.0 - k)
    return val


def ema_context(closes: List[float], price: float, atr: float) -> Dict[str, Any]:
    """Trend filter used for conviction, never as a standalone signal."""
    values = [v for v in closes if v > 0]
    ema20 = _ema(values, 20)
    ema50 = _ema(values, 50)
    ema200 = _ema(values, 200) if len(values) >= 200 else None
    if ema20 is None or ema50 is None:
        return {"status": "INSUFFICIENT_HISTORY", "ema20": _rnd(ema20),
                "ema50": _rnd(ema50), "ema200": _rnd(ema200),
                "direction": "NEUTRAL", "score": 0.0, "priceVs200": "UNAVAILABLE"}

    votes = 0
    votes += 1 if price > ema20 else -1
    votes += 1 if ema20 > ema50 else -1
    if ema200 is not None:
        votes += 1 if price > ema200 else -1
    score = votes / (3 if ema200 is not None else 2)
    distance = ((price - ema200) / atr) if ema200 is not None and atr > 0 else None
    return {
        "status": "READY" if ema200 is not None else "PARTIAL",
        "ema20": _rnd(ema20), "ema50": _rnd(ema50), "ema200": _rnd(ema200),
        "direction": "BULLISH" if score >= 0.34 else "BEARISH" if score <= -0.34 else "NEUTRAL",
        "score": _rnd(_clamp(score, -1.0, 1.0), 3),
        "priceVs200": ("ABOVE" if distance is not None and distance > 0.15
                       else "BELOW" if distance is not None and distance < -0.15
                       else "AT_OR_NEAR" if distance is not None else "UNAVAILABLE"),
        "distanceAtr": _rnd(distance, 2),
    }


def _rsi(closes: List[float], period: int = 14) -> Optional[float]:
    if len(closes) < period + 1:
        return None
    gains = losses = 0.0
    for i in range(1, period + 1):
        d = closes[i] - closes[i - 1]
        gains += max(d, 0.0)
        losses += max(-d, 0.0)
    avg_g, avg_l = gains / period, losses / period
    for i in range(period + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        avg_g = (avg_g * (period - 1) + max(d, 0.0)) / period
        avg_l = (avg_l * (period - 1) + max(-d, 0.0)) / period
    if avg_l == 0:
        return 100.0
    return 100.0 - 100.0 / (1.0 + avg_g / avg_l)


def _roc(closes: List[float], n: int = 10) -> float:
    if len(closes) <= n or closes[-1 - n] == 0:
        return 0.0
    return (closes[-1] - closes[-1 - n]) / closes[-1 - n] * 100.0


def _vwap(candles: List[Candle]) -> Optional[float]:
    pv = vol = 0.0
    for c in candles:
        v = _f(c, "volume")
        if v <= 0:
            continue
        tp = (_f(c, "high") + _f(c, "low") + _f(c, "close")) / 3.0
        pv += tp * v
        vol += v
    if vol > 0:
        return pv / vol
    tps = [(_f(c, "high") + _f(c, "low") + _f(c, "close")) / 3.0
           for c in candles if _f(c, "close") > 0]
    return sum(tps) / len(tps) if len(tps) >= 3 else None


# ── Swings & structure (causal, no repaint) ───────────────────────────────────

def detect_swings(candles: List[Candle], k: int = SWING_K) -> List[Dict[str, Any]]:
    """Fractal swings confirmed by k closed bars on each side."""
    swings: List[Dict[str, Any]] = []
    n = len(candles)
    for i in range(k, n - k):
        hi, lo = _f(candles[i], "high"), _f(candles[i], "low")
        left, right = candles[i - k:i], candles[i + 1:i + k + 1]
        if all(hi > _f(c, "high") for c in left) and all(hi >= _f(c, "high") for c in right):
            swings.append({"index": i, "kind": "HIGH", "price": hi,
                           "timestamp": candles[i].get("timestamp")})
        if all(lo < _f(c, "low") for c in left) and all(lo <= _f(c, "low") for c in right):
            swings.append({"index": i, "kind": "LOW", "price": lo,
                           "timestamp": candles[i].get("timestamp")})
    swings.sort(key=lambda s: s["index"])
    return swings


def label_swings(swings: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """HH / HL / LH / LL labels in swing order."""
    labels: List[Dict[str, Any]] = []
    prev_high: Optional[float] = None
    prev_low: Optional[float] = None
    for s in swings:
        if s["kind"] == "HIGH":
            lab = "H" if prev_high is None else ("HH" if s["price"] > prev_high else "LH")
            prev_high = s["price"]
        else:
            lab = "L" if prev_low is None else ("HL" if s["price"] > prev_low else "LL")
            prev_low = s["price"]
        labels.append({"label": lab, "price": _rnd(s["price"]),
                       "timestamp": s.get("timestamp")})
    return labels


def walk_structure(candles: List[Candle], swings: List[Dict[str, Any]],
                   atr: float) -> Dict[str, Any]:
    """
    Single causal pass: a swing becomes tradable only after its confirmation
    bar; a close through it fires BOS (with-trend) or CHoCH (counter-trend),
    upgraded to MSS when the breaking candle is a displacement candle.
    """
    pending = swings
    p = 0
    bias = "NEUTRAL"
    last_high: Optional[Dict[str, Any]] = None
    last_low: Optional[Dict[str, Any]] = None
    protected_low: Optional[Dict[str, Any]] = None
    protected_high: Optional[Dict[str, Any]] = None
    events: List[Dict[str, Any]] = []

    for i, c in enumerate(candles):
        while p < len(pending) and pending[p]["index"] + SWING_K <= i:
            s = pending[p]
            if s["kind"] == "HIGH":
                last_high = s
            else:
                last_low = s
            p += 1

        close = _f(c, "close")
        rng = _f(c, "high") - _f(c, "low")
        body = abs(close - _f(c, "open"))
        displaced = (atr > 0 and rng >= DISPLACEMENT_ATR * atr
                     and rng > 0 and body / rng >= DISPLACEMENT_BODY)

        if last_high is not None and close > last_high["price"]:
            etype = "BOS" if bias != "BEARISH" else "CHOCH"
            if etype == "CHOCH" and displaced:
                etype = "MSS"
            events.append({"type": etype, "direction": "BULLISH",
                           "level": _rnd(last_high["price"]),
                           "timestamp": c.get("timestamp"),
                           "displacement": displaced})
            bias = "BULLISH"
            protected_low = last_low
            last_high = None
        elif last_low is not None and close < last_low["price"]:
            etype = "BOS" if bias != "BULLISH" else "CHOCH"
            if etype == "CHOCH" and displaced:
                etype = "MSS"
            events.append({"type": etype, "direction": "BEARISH",
                           "level": _rnd(last_low["price"]),
                           "timestamp": c.get("timestamp"),
                           "displacement": displaced})
            bias = "BEARISH"
            protected_high = last_high
            last_low = None

    return {
        "bias": bias,
        "events": events[-MAX_EVENTS:],
        "lastEvent": events[-1] if events else None,
        "protectedLow": _rnd(protected_low["price"]) if protected_low else None,
        "protectedHigh": _rnd(protected_high["price"]) if protected_high else None,
        "unbrokenHigh": _rnd(last_high["price"]) if last_high else None,
        "unbrokenLow": _rnd(last_low["price"]) if last_low else None,
    }


def structure_score(struct: Dict[str, Any]) -> Tuple[float, str]:
    """Score −1..+1 from bias plus recency/strength of the last event."""
    bias = struct["bias"]
    last = struct.get("lastEvent")
    if bias == "NEUTRAL" or last is None:
        return 0.0, "Structure undecided — no confirmed break yet"
    base = 0.55 if bias == "BULLISH" else -0.55
    kind = last["type"]
    if kind == "MSS":
        base *= 1.35
    elif kind == "CHOCH":
        base *= 1.15
    if last.get("displacement"):
        base *= 1.1
    note = f"{bias.title()} — last {kind} {last['direction'].lower()} @ {last['level']}"
    return _clamp(base, -1.0, 1.0), note


# ── Liquidity: pools, sweeps, inducement ──────────────────────────────────────

def detect_liquidity_pools(candles: List[Candle], swings: List[Dict[str, Any]],
                           price: float, atr: float,
                           pdh: float, pdl: float,
                           day_high: float, day_low: float,
                           range_high: Optional[float],
                           range_low: Optional[float]) -> List[Dict[str, Any]]:
    """Resting-liquidity map: equal highs/lows, prior-day & session extremes."""
    tol = max(price * 0.0004, EQ_LEVEL_TOL_ATR * atr) if price > 0 else 0.0
    pools: List[Dict[str, Any]] = []

    def _cluster(kind: str) -> None:
        pts = [s for s in swings if s["kind"] == kind][-12:]
        used = [False] * len(pts)
        for i in range(len(pts)):
            if used[i]:
                continue
            group = [pts[i]]
            for j in range(i + 1, len(pts)):
                if not used[j] and abs(pts[j]["price"] - pts[i]["price"]) <= tol:
                    group.append(pts[j])
                    used[j] = True
            if len(group) >= 2:
                level = max(g["price"] for g in group) if kind == "HIGH" \
                    else min(g["price"] for g in group)
                pools.append({
                    "side": "BSL" if kind == "HIGH" else "SSL",
                    "kind": "EQH" if kind == "HIGH" else "EQL",
                    "level": level, "strength": min(3, len(group)),
                })

    _cluster("HIGH")
    _cluster("LOW")

    for lvl, kind, side in ((pdh, "PDH", "BSL"), (pdl, "PDL", "SSL"),
                            (day_high, "DAY_HIGH", "BSL"), (day_low, "DAY_LOW", "SSL")):
        if lvl and lvl > 0:
            pools.append({"side": side, "kind": kind, "level": float(lvl), "strength": 2})

    ext_hi = range_high if range_high else None
    ext_lo = range_low if range_low else None
    for pool in pools:
        lvl = pool["level"]
        external = ((ext_hi is not None and pool["side"] == "BSL" and lvl >= ext_hi - tol)
                    or (ext_lo is not None and pool["side"] == "SSL" and lvl <= ext_lo + tol)
                    or pool["kind"] in ("PDH", "PDL"))
        pool["scope"] = "EXTERNAL" if external else "INTERNAL"
        pool["distancePct"] = _rnd((lvl - price) / price * 100.0, 3) if price > 0 else None
        pool["level"] = _rnd(lvl)

    # de-dup near-identical levels, keep the strongest
    pools.sort(key=lambda pl: (-pl["strength"], abs(pl.get("distancePct") or 99)))
    dedup: List[Dict[str, Any]] = []
    for pool in pools:
        if all(abs((pool["level"] or 0) - (q["level"] or 0)) > tol for q in dedup):
            dedup.append(pool)
    dedup.sort(key=lambda pl: abs(pl.get("distancePct") or 99))
    return dedup[:MAX_POOLS]


def detect_sweeps(candles: List[Candle], pools: List[Dict[str, Any]],
                  atr: float) -> List[Dict[str, Any]]:
    """Wick through a pool with a close back inside = liquidity grab.
    Opposite displacement within 3 bars = confirmed trap / stop hunt."""
    sweeps: List[Dict[str, Any]] = []
    recent = candles[-SWEEP_LOOKBACK:]
    offset = len(candles) - len(recent)
    for pool in pools:
        lvl = pool.get("level")
        if not lvl:
            continue
        for i, c in enumerate(recent):
            hi, lo, close = _f(c, "high"), _f(c, "low"), _f(c, "close")
            grabbed = ((pool["side"] == "BSL" and hi > lvl and close < lvl)
                       or (pool["side"] == "SSL" and lo < lvl and close > lvl))
            if not grabbed:
                continue
            reversed_ = False
            for c2 in recent[i + 1:i + 4]:
                rng2 = _f(c2, "high") - _f(c2, "low")
                body2 = abs(_f(c2, "close") - _f(c2, "open"))
                if atr > 0 and rng2 >= DISPLACEMENT_ATR * atr and rng2 > 0 \
                        and body2 / rng2 >= DISPLACEMENT_BODY:
                    if pool["side"] == "BSL" and _f(c2, "close") < _f(c2, "open"):
                        reversed_ = True
                    if pool["side"] == "SSL" and _f(c2, "close") > _f(c2, "open"):
                        reversed_ = True
                    break
            sweeps.append({
                "poolKind": pool["kind"], "side": pool["side"],
                "level": pool["level"], "timestamp": c.get("timestamp"),
                "barsAgo": len(recent) - 1 - i,
                "trapConfirmed": reversed_,
                "read": ("Buy-side grabbed → sell program" if pool["side"] == "BSL"
                         else "Sell-side grabbed → buy program") if reversed_
                else "Liquidity taken — watching for displacement",
            })
            pool["swept"] = True
            break
    sweeps.sort(key=lambda s: s["barsAgo"])
    _ = offset
    return sweeps[:3]


def detect_inducement(swings: List[Dict[str, Any]], price: float,
                      bias: str, atr: float) -> Optional[Dict[str, Any]]:
    """Minor swing sitting between price and the with-bias POI — retail bait."""
    if bias == "NEUTRAL" or price <= 0 or atr <= 0:
        return None
    if bias == "BULLISH":
        cands = [s for s in swings[-10:] if s["kind"] == "LOW"
                 and 0 < price - s["price"] <= 1.6 * atr]
        if cands:
            s = max(cands, key=lambda x: x["price"])
            return {"side": "BELOW", "level": _rnd(s["price"]),
                    "note": "Minor low just below — likely inducement before the real OB"}
    else:
        cands = [s for s in swings[-10:] if s["kind"] == "HIGH"
                 and 0 < s["price"] - price <= 1.6 * atr]
        if cands:
            s = min(cands, key=lambda x: x["price"])
            return {"side": "ABOVE", "level": _rnd(s["price"]),
                    "note": "Minor high just above — likely inducement before the real OB"}
    return None


# ── Order blocks / FVG / BPR ──────────────────────────────────────────────────

def detect_order_blocks(candles: List[Candle], atr: float) -> List[Dict[str, Any]]:
    """Last opposite candle before a displacement leg. Lifecycle:
    VALID → MITIGATED (price re-entered) → BREAKER (closed through)."""
    if atr <= 0 or len(candles) < 6:
        return []
    obs: List[Dict[str, Any]] = []
    n = len(candles)
    for i in range(2, n):
        c = candles[i]
        rng = _f(c, "high") - _f(c, "low")
        body = abs(_f(c, "close") - _f(c, "open"))
        if rng < DISPLACEMENT_ATR * atr or rng <= 0 or body / rng < DISPLACEMENT_BODY:
            continue
        bullish_leg = _f(c, "close") > _f(c, "open")
        for j in range(i - 1, max(i - 4, -1), -1):
            oc = candles[j]
            opp = _f(oc, "close") < _f(oc, "open") if bullish_leg \
                else _f(oc, "close") > _f(oc, "open")
            if not opp:
                continue
            zone_lo, zone_hi = _f(oc, "low"), _f(oc, "high")
            state, flipped = "VALID", False
            for k in range(i + 1, n):
                fc = candles[k]
                if bullish_leg:
                    if _f(fc, "close") < zone_lo:
                        state, flipped = "BREAKER", True
                        break
                    if _f(fc, "low") <= zone_hi:
                        state = "MITIGATED"
                else:
                    if _f(fc, "close") > zone_hi:
                        state, flipped = "BREAKER", True
                        break
                    if _f(fc, "high") >= zone_lo:
                        state = "MITIGATED"
            side = "DEMAND" if bullish_leg else "SUPPLY"
            if flipped:
                side = "SUPPLY" if bullish_leg else "DEMAND"
            obs.append({
                "side": side, "state": state,
                "low": _rnd(zone_lo), "high": _rnd(zone_hi),
                "origin": "DISPLACEMENT",
                "timestamp": oc.get("timestamp"),
                "barsAgo": n - 1 - j,
            })
            break
    # newest first, prefer actionable states
    obs.sort(key=lambda o: (o["state"] == "BREAKER", o["barsAgo"]))
    seen: List[Dict[str, Any]] = []
    for o in obs:
        if all(not (abs((o["low"] or 0) - (s["low"] or 0)) < 0.2 * atr
                    and o["side"] == s["side"]) for s in seen):
            seen.append(o)
    return seen[:MAX_ZONES]


def detect_fvgs(candles: List[Candle], atr: float) -> List[Dict[str, Any]]:
    """3-candle imbalances with fill lifecycle: OPEN → PARTIAL → INVERTED."""
    if atr <= 0 or len(candles) < 4:
        return []
    out: List[Dict[str, Any]] = []
    n = len(candles)
    for i in range(2, n):
        a, c = candles[i - 2], candles[i]
        bull_gap = _f(c, "low") - _f(a, "high")
        bear_gap = _f(a, "low") - _f(c, "high")
        if bull_gap >= FVG_MIN_ATR * atr:
            lo, hi, side = _f(a, "high"), _f(c, "low"), "BULLISH"
        elif bear_gap >= FVG_MIN_ATR * atr:
            lo, hi, side = _f(c, "high"), _f(a, "low"), "BEARISH"
        else:
            continue
        state = "OPEN"
        for k in range(i + 1, n):
            fc = candles[k]
            if side == "BULLISH":
                if _f(fc, "close") < lo:
                    state = "INVERTED"
                    break
                if _f(fc, "low") <= (lo + hi) / 2:
                    state = "PARTIAL"
            else:
                if _f(fc, "close") > hi:
                    state = "INVERTED"
                    break
                if _f(fc, "high") >= (lo + hi) / 2:
                    state = "PARTIAL"
        eff_side = side if state != "INVERTED" else ("BEARISH" if side == "BULLISH" else "BULLISH")
        out.append({
            "side": eff_side, "state": state,
            "low": _rnd(lo), "high": _rnd(hi),
            "sizePts": _rnd(hi - lo),
            "timestamp": candles[i - 1].get("timestamp"),
            "barsAgo": n - 1 - i,
        })
    out.sort(key=lambda g: g["barsAgo"])
    return out[:MAX_ZONES]


def detect_bpr(fvgs: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Balanced Price Range = overlap of opposing FVGs — strong S/R block."""
    bulls = [g for g in fvgs if g["side"] == "BULLISH" and g["state"] != "INVERTED"]
    bears = [g for g in fvgs if g["side"] == "BEARISH" and g["state"] != "INVERTED"]
    for b in bulls:
        for s in bears:
            lo = max(b["low"] or 0, s["low"] or 0)
            hi = min(b["high"] or 0, s["high"] or 0)
            if hi > lo > 0:
                return {"low": _rnd(lo), "high": _rnd(hi),
                        "note": "Opposing FVGs overlap — expect strong reaction here"}
    return None


# ── Dealing range / premium-discount ─────────────────────────────────────────

def dealing_range(swings: List[Dict[str, Any]], price: float) -> Dict[str, Any]:
    """External range from major swings → equilibrium, premium/discount, OTE."""
    majors_h = [s["price"] for s in swings if s["kind"] == "HIGH"][-8:]
    majors_l = [s["price"] for s in swings if s["kind"] == "LOW"][-8:]
    if not majors_h or not majors_l or price <= 0:
        return {"high": None, "low": None, "equilibrium": None,
                "positionPct": None, "zone": "UNKNOWN", "ote": None}
    hi, lo = max(majors_h), min(majors_l)
    if hi <= lo:
        return {"high": _rnd(hi), "low": _rnd(lo), "equilibrium": None,
                "positionPct": None, "zone": "UNKNOWN", "ote": None}
    pos = (price - lo) / (hi - lo) * 100.0
    zone = "PREMIUM" if pos > 55 else ("DISCOUNT" if pos < 45 else "EQUILIBRIUM")
    return {
        "high": _rnd(hi), "low": _rnd(lo),
        "equilibrium": _rnd((hi + lo) / 2),
        "positionPct": _rnd(_clamp(pos, 0, 100), 1),
        "zone": zone,
        "ote": {
            "buyZone": [_rnd(lo + (hi - lo) * 0.21), _rnd(lo + (hi - lo) * 0.38)],
            "sellZone": [_rnd(lo + (hi - lo) * 0.62), _rnd(lo + (hi - lo) * 0.79)],
        },
    }


# ── SMT divergence ────────────────────────────────────────────────────────────

def smt_divergence(own_swings: List[Dict[str, Any]],
                   peer_swings: List[Dict[str, Any]],
                   peer_symbol: str) -> Dict[str, Any]:
    """Correlated index disagreement at swings = smart-money tell."""
    res = {"state": "IN_SYNC", "peer": peer_symbol, "score": 0.0, "note": "Indices moving together"}
    own_h = [s["price"] for s in own_swings if s["kind"] == "HIGH"][-2:]
    peer_h = [s["price"] for s in peer_swings if s["kind"] == "HIGH"][-2:]
    own_l = [s["price"] for s in own_swings if s["kind"] == "LOW"][-2:]
    peer_l = [s["price"] for s in peer_swings if s["kind"] == "LOW"][-2:]
    if len(own_h) == 2 and len(peer_h) == 2:
        if own_h[1] > own_h[0] and peer_h[1] < peer_h[0]:
            return {"state": "BEARISH_DIVERGENCE", "peer": peer_symbol, "score": -0.6,
                    "note": f"New high NOT confirmed by {peer_symbol} — distribution risk"}
        if own_h[1] < own_h[0] and peer_h[1] > peer_h[0]:
            return {"state": "RELATIVE_WEAKNESS", "peer": peer_symbol, "score": -0.25,
                    "note": f"{peer_symbol} made the high alone — this index lagging"}
    if len(own_l) == 2 and len(peer_l) == 2:
        if own_l[1] < own_l[0] and peer_l[1] > peer_l[0]:
            return {"state": "BULLISH_DIVERGENCE", "peer": peer_symbol, "score": 0.6,
                    "note": f"New low NOT confirmed by {peer_symbol} — accumulation risk for shorts"}
        if own_l[1] > own_l[0] and peer_l[1] < peer_l[0]:
            return {"state": "RELATIVE_STRENGTH", "peer": peer_symbol, "score": 0.25,
                    "note": f"{peer_symbol} broke low alone — this index holding stronger"}
    return res


# ── Session / regime / behavior ───────────────────────────────────────────────

def session_context(now_ist: datetime) -> Dict[str, Any]:
    mins = now_ist.hour * 60 + now_ist.minute
    table = (
        (555, 570, "OPENING_VOLATILITY", 0.85, "First 15m — ranges form, traps are common"),
        (570, 630, "OPENING_DRIVE", 1.00, "Institutional orders active — best trend window"),
        (630, 690, "TREND_CONTINUATION", 0.95, "Follow-through window for the morning drive"),
        (690, 810, "MIDDAY_CHOP", 0.75, "Lunch liquidity vacuum — fade edges, size down"),
        (810, 870, "AFTERNOON_POSITIONING", 0.90, "Positioning for the close begins"),
        (870, 915, "POWER_HOUR", 1.00, "Highest institutional urgency — strong moves resolve"),
        (915, 930, "CLOSE_AUCTION", 0.80, "Square-off flows dominate — noisy"),
    )
    if now_ist.weekday() < 5:
        for lo, hi, name, mod, note in table:
            if lo <= mins < hi:
                return {"name": name, "qualityMod": mod, "note": note}
    return {"name": "CLOSED", "qualityMod": 0.70, "note": "Market closed — analysis on last session data"}


def volatility_regime(candles: List[Candle], atr: float) -> Dict[str, Any]:
    series = _atr_series(candles)
    if not series or atr <= 0:
        return {"state": "UNKNOWN", "atr": _rnd(atr), "atrPctile": None}
    rank = sum(1 for v in series if v <= atr) / len(series) * 100.0
    state = ("SQUEEZE" if rank < 30 else "NORMAL" if rank < 70
             else "HIGH" if rank < 90 else "EXTREME")
    return {"state": state, "atr": _rnd(atr), "atrPctile": _rnd(rank, 1)}


def trend_strength(candles: List[Candle]) -> Dict[str, Any]:
    """0–100 composite: EMA stack, slope, directional-movement dominance."""
    closes = [_f(c, "close") for c in candles if _f(c, "close") > 0]
    if len(closes) < 12:
        return {"value": 0, "direction": "NEUTRAL"}
    e9, e21 = _ema(closes, 9), _ema(closes, 21)
    if e9 is None or e21 is None:
        return {"value": 0, "direction": "NEUTRAL"}
    stack = 40.0 if e9 > e21 else -40.0 if e9 < e21 else 0.0
    slope = _linear_slope(closes[-12:])
    slope_score = _clamp(slope / (closes[-1] * 0.0004) * 30.0, -30.0, 30.0) if closes[-1] else 0.0
    dm_up = dm_dn = 0.0
    for i in range(max(1, len(candles) - 14), len(candles)):
        up = _f(candles[i], "high") - _f(candles[i - 1], "high")
        dn = _f(candles[i - 1], "low") - _f(candles[i], "low")
        if up > dn and up > 0:
            dm_up += up
        elif dn > up and dn > 0:
            dm_dn += dn
    total_dm = dm_up + dm_dn
    dm_score = ((dm_up - dm_dn) / total_dm * 30.0) if total_dm > 0 else 0.0
    raw = stack + slope_score + dm_score
    return {"value": int(_clamp(abs(raw), 0, 100)),
            "direction": "BULLISH" if raw > 12 else "BEARISH" if raw < -12 else "NEUTRAL"}


def detect_absorption_exhaustion(candles: List[Candle], atr: float,
                                 day_high: float, day_low: float) -> Dict[str, Any]:
    """Absorption = heavy volume, tiny body at an extreme.
    Exhaustion = shrinking bodies + fading volume after an extended run."""
    out: Dict[str, Any] = {"absorption": None, "exhaustion": None}
    if len(candles) < 8 or atr <= 0:
        return out
    vols = [_f(c, "volume") for c in candles[-20:]]
    med_vol = _median([v for v in vols if v > 0])
    last = candles[-1]
    rng = _f(last, "high") - _f(last, "low")
    body = abs(_f(last, "close") - _f(last, "open"))
    if med_vol > 0 and _f(last, "volume") >= 1.5 * med_vol and rng > 0 and body / rng <= 0.35:
        near_low = day_low > 0 and _f(last, "low") - day_low <= 0.35 * atr
        near_high = day_high > 0 and day_high - _f(last, "high") <= 0.35 * atr
        if near_low:
            out["absorption"] = {"side": "BULLISH", "note": "Heavy volume absorbed at day low — passive buyer present"}
        elif near_high:
            out["absorption"] = {"side": "BEARISH", "note": "Heavy volume absorbed at day high — passive seller present"}
    dirs = [1 if _f(c, "close") > _f(c, "open") else -1 for c in candles[-5:]]
    if abs(sum(dirs)) >= 4:
        bodies = [abs(_f(c, "close") - _f(c, "open")) for c in candles[-4:]]
        if bodies[0] > bodies[1] > bodies[2] or (bodies[-1] < 0.5 * max(bodies)):
            side = "BEARISH" if sum(dirs) > 0 else "BULLISH"
            out["exhaustion"] = {"side": side,
                                 "note": f"Run of {abs(sum(dirs))}+ candles with shrinking bodies — {'rally' if side == 'BEARISH' else 'selloff'} losing fuel"}
    return out


# ── Confluence: VWAP / volume / OI / PCR ─────────────────────────────────────

def confluence_read(candles: List[Candle], price: float,
                    pcr: float, oi: float, prev_oi: float,
                    change_pct: float) -> Dict[str, Any]:
    vwap = _vwap(candles)
    vwap_score = 0.0
    vwap_note = "VWAP unavailable"
    if vwap and price > 0:
        dev = (price - vwap) / vwap * 100.0
        vwap_score = _clamp(dev / 0.25, -1.0, 1.0)
        vwap_note = f"Price {'above' if dev >= 0 else 'below'} VWAP by {abs(dev):.2f}%"

    vols = [_f(c, "volume") for c in candles[-12:]]
    med = _median([v for v in vols if v > 0])
    vol_score = 0.0
    vol_note = "Volume flat"
    if med > 0 and vols:
        ratio = vols[-1] / med
        last_dir = 1.0 if _f(candles[-1], "close") >= _f(candles[-1], "open") else -1.0
        if ratio >= 1.3:
            vol_score = _clamp(0.5 * last_dir * min(ratio / 2.0, 1.6), -1.0, 1.0)
            vol_note = f"Volume {ratio:.1f}× median behind the {'up' if last_dir > 0 else 'down'} candle"

    oi_score = 0.0
    oi_note = "OI unchanged"
    if oi > 0 and prev_oi > 0:
        oi_delta = (oi - prev_oi) / prev_oi * 100.0
        px_up = change_pct >= 0
        if abs(oi_delta) >= 0.05:
            if oi_delta > 0 and px_up:
                oi_score, oi_note = 0.6, "Long buildup — fresh money with price"
            elif oi_delta > 0 and not px_up:
                oi_score, oi_note = -0.6, "Short buildup — fresh money against price"
            elif oi_delta < 0 and px_up:
                oi_score, oi_note = 0.3, "Short covering — squeeze fuel, weaker trend"
            else:
                oi_score, oi_note = -0.3, "Long unwinding — longs exiting"

    pcr_score = 0.0
    pcr_note = "PCR unavailable"
    if pcr > 0:
        if pcr >= 1.6:
            pcr_score, pcr_note = 0.55, f"PCR {pcr:.2f} — extreme put wall (floor)"
        elif pcr >= 1.2:
            pcr_score, pcr_note = 0.4, f"PCR {pcr:.2f} — put writers defending"
        elif pcr >= 0.9:
            pcr_score, pcr_note = 0.0, f"PCR {pcr:.2f} — balanced"
        elif pcr >= 0.7:
            pcr_score, pcr_note = -0.4, f"PCR {pcr:.2f} — call writers capping"
        else:
            pcr_score, pcr_note = -0.35, f"PCR {pcr:.2f} — extreme; squeeze risk both ways"

    score = _clamp(0.30 * vwap_score + 0.25 * vol_score + 0.25 * oi_score + 0.20 * pcr_score, -1.0, 1.0)
    return {
        "score": _rnd(score, 3),
        "vwap": {"value": _rnd(vwap), "score": _rnd(vwap_score, 2), "note": vwap_note},
        "volume": {"score": _rnd(vol_score, 2), "note": vol_note},
        "oi": {"score": _rnd(oi_score, 2), "note": oi_note},
        "pcr": {"value": _rnd(pcr, 3) if pcr > 0 else None, "score": _rnd(pcr_score, 2), "note": pcr_note},
    }


# ── Institutional intent (Wyckoff-style phase read) ──────────────────────────

def institutional_intent(struct_bias: str, sweeps: List[Dict[str, Any]],
                         behavior: Dict[str, Any], conf: Dict[str, Any],
                         dr_zone: str) -> Dict[str, Any]:
    oi_note = conf["oi"]["note"]
    absorption = behavior.get("absorption")
    recent_trap = next((s for s in sweeps if s.get("trapConfirmed")), None)

    if recent_trap:
        phase = "MANIPULATION"
        direction = "BULLISH" if recent_trap["side"] == "SSL" else "BEARISH"
        note = (f"{recent_trap['poolKind']} swept & reversed — engineered liquidity, "
                f"smart money likely driving {'up' if direction == 'BULLISH' else 'down'} next")
        return {"phase": phase, "direction": direction, "note": note, "confidence": 72}

    if absorption and absorption["side"] == "BULLISH" and dr_zone == "DISCOUNT":
        return {"phase": "ACCUMULATION", "direction": "BULLISH",
                "note": "Passive buying in discount — building longs quietly", "confidence": 66}
    if absorption and absorption["side"] == "BEARISH" and dr_zone == "PREMIUM":
        return {"phase": "DISTRIBUTION", "direction": "BEARISH",
                "note": "Supply absorbed into premium — unloading into strength", "confidence": 66}

    if struct_bias == "BULLISH":
        if "Long buildup" in oi_note:
            return {"phase": "MARKUP", "direction": "BULLISH",
                    "note": "Trending up with fresh OI — institutions pressing longs", "confidence": 70}
        return {"phase": "MARKUP", "direction": "BULLISH",
                "note": "Bullish structure intact — dips into demand are being bought", "confidence": 58}
    if struct_bias == "BEARISH":
        if "Short buildup" in oi_note:
            return {"phase": "MARKDOWN", "direction": "BEARISH",
                    "note": "Trending down with fresh shorts — institutions pressing", "confidence": 70}
        return {"phase": "MARKDOWN", "direction": "BEARISH",
                "note": "Bearish structure intact — rallies into supply are being sold", "confidence": 58}
    return {"phase": "RANGING", "direction": "NEUTRAL",
            "note": "No dominant program — two-way auction, wait for the range to break", "confidence": 45}


# ── Master analysis ──────────────────────────────────────────────────────────

def _resample_15m(candles_5m: List[Candle]) -> List[Candle]:
    out: List[Candle] = []
    for i in range(0, len(candles_5m) - 2, 3):
        grp = candles_5m[i:i + 3]
        out.append({
            "timestamp": grp[0].get("timestamp"),
            "open": _f(grp[0], "open"),
            "high": max(_f(c, "high") for c in grp),
            "low": min(_f(c, "low") for c in grp),
            "close": _f(grp[-1], "close"),
            "volume": sum(_f(c, "volume") for c in grp),
            "oi": _f(grp[-1], "oi"),
        })
    return out


def _regime_key(vol_state: str, ts_dir: str) -> str:
    if vol_state == "EXTREME":
        return "VOLATILE"
    if vol_state == "SQUEEZE":
        return "SQUEEZE"
    return "TRENDING" if ts_dir != "NEUTRAL" else "RANGING"


# ── Predictive layer: anticipate the NEXT move before structure confirms ─────

def _liquidity_magnets(pools: List[Dict[str, Any]], price: float, atr: float,
                       bias: str) -> List[Dict[str, Any]]:
    """Rank unswept pools by 'pull': strength × scope × proximity × bias fit."""
    if price <= 0 or atr <= 0:
        return []
    ranked: List[Dict[str, Any]] = []
    for pl in pools:
        lvl = pl.get("level")
        if not lvl or pl.get("swept"):
            continue
        dist = abs(lvl - price)
        if dist <= 0:
            continue
        pull = float(pl.get("strength") or 1)
        pull *= 1.3 if pl.get("scope") == "EXTERNAL" else 1.0
        pull *= math.exp(-dist / (2.5 * atr))
        with_bias = (bias == "BULLISH" and pl["side"] == "BSL") or \
                    (bias == "BEARISH" and pl["side"] == "SSL")
        pull *= 1.25 if with_bias else (0.8 if bias != "NEUTRAL" else 1.0)
        ranked.append({"level": lvl, "kind": pl["kind"], "scope": pl["scope"],
                       "side": pl["side"], "distancePts": _rnd(dist, 1), "pull": pull})
    ranked.sort(key=lambda m: -m["pull"])
    total = sum(m["pull"] for m in ranked[:4]) or 1.0
    for m in ranked[:4]:
        m["probability"] = int(_clamp(m["pull"] / total * 100.0, 5, 90))
    return ranked[:4]


def _early_warnings(closed: List[Candle], price: float, atr: float,
                    vol_state: str, magnets: List[Dict[str, Any]],
                    now_ist: datetime) -> List[Dict[str, Any]]:
    """Leading signals that fire BEFORE a BOS/CHoCH prints."""
    warns: List[Dict[str, Any]] = []
    if len(closed) < 8 or atr <= 0:
        return warns

    # Compression → expansion imminent
    last5 = closed[-5:]
    rng_sum = sum(_f(c, "high") - _f(c, "low") for c in last5)
    if rng_sum < 3.2 * atr or vol_state == "SQUEEZE":
        target = magnets[0] if magnets else None
        dir_hint = ("upward" if target and target["side"] == "BSL"
                    else "downward" if target else "either direction")
        warns.append({"signal": "COMPRESSION_BREAK_IMMINENT",
                      "detail": f"5-bar range compressed — expansion {dir_hint} likely next",
                      "urgency": "HIGH" if vol_state == "SQUEEZE" else "MEDIUM"})

    # Failed push beyond recent extreme → trap forming before CHoCH confirms
    last = closed[-1]
    hi6 = max(_f(c, "high") for c in closed[-7:-1])
    lo6 = min(_f(c, "low") for c in closed[-7:-1])
    rng = _f(last, "high") - _f(last, "low")
    if rng > 0:
        up_wick = _f(last, "high") - max(_f(last, "close"), _f(last, "open"))
        dn_wick = min(_f(last, "close"), _f(last, "open")) - _f(last, "low")
        if _f(last, "high") > hi6 and _f(last, "close") < hi6 and up_wick / rng >= 0.55:
            warns.append({"signal": "TRAP_FORMING_ABOVE",
                          "detail": "Push above recent highs rejected — breakout buyers being trapped",
                          "urgency": "HIGH"})
        if _f(last, "low") < lo6 and _f(last, "close") > lo6 and dn_wick / rng >= 0.55:
            warns.append({"signal": "TRAP_FORMING_BELOW",
                          "detail": "Flush below recent lows reclaimed — breakdown sellers being trapped",
                          "urgency": "HIGH"})

    # Hidden pressure: one-sided wicks over last 8 bars
    up_w = sum(_f(c, "high") - max(_f(c, "close"), _f(c, "open")) for c in closed[-8:])
    dn_w = sum(min(_f(c, "close"), _f(c, "open")) - _f(c, "low") for c in closed[-8:])
    if dn_w > 0 and up_w / max(dn_w, 1e-9) >= 1.8:
        warns.append({"signal": "HIDDEN_SELLING",
                      "detail": "Repeated upper-wick rejections — sellers active above",
                      "urgency": "MEDIUM"})
    elif up_w > 0 and dn_w / max(up_w, 1e-9) >= 1.8:
        warns.append({"signal": "HIDDEN_BUYING",
                      "detail": "Repeated lower-wick defenses — buyers active below",
                      "urgency": "MEDIUM"})

    # Move losing fuel: same-direction closes on fading volume
    dirs = [1 if _f(c, "close") > _f(c, "open") else -1 for c in closed[-3:]]
    vols3 = [_f(c, "volume") for c in closed[-3:]]
    if abs(sum(dirs)) == 3 and all(v > 0 for v in vols3) and vols3[0] > vols3[1] > vols3[2]:
        warns.append({"signal": "MOVE_LOSING_FUEL",
                      "detail": f"3 {'up' if dirs[0] > 0 else 'down'} closes on fading volume — pause or snapback near",
                      "urgency": "MEDIUM"})

    # Volatility window approaching
    mins = now_ist.hour * 60 + now_ist.minute
    for start, label in ((570, "OPENING_DRIVE"), (870, "POWER_HOUR")):
        if 0 < start - mins <= 15:
            warns.append({"signal": "VOLATILITY_WINDOW_AHEAD",
                          "detail": f"{label} begins in {start - mins} min — expect resolution attempts",
                          "urgency": "LOW"})
            break
    return warns[:4]


def _institutional_map(symbol: str, price: float, htf: Dict[str, Any],
                       ltf: Dict[str, Any], aligned: bool,
                       intent: Dict[str, Any], dr: Dict[str, Any],
                       pools: List[Dict[str, Any]], obs: List[Dict[str, Any]],
                       fvgs: List[Dict[str, Any]], conf: Dict[str, Any],
                       regime: Dict[str, Any], decision: float) -> Dict[str, Any]:
    """Turn the raw SMC map into the few institutional facts traders verify."""
    above = sorted((p for p in pools if not p.get("swept") and (p.get("level") or 0) > price),
                   key=lambda p: p["level"])
    below = sorted((p for p in pools if not p.get("swept") and 0 < (p.get("level") or 0) < price),
                   key=lambda p: p["level"], reverse=True)
    active_obs = [o for o in obs if o["state"] != "BREAKER"]
    active_fvgs = [g for g in fvgs if g["state"] != "INVERTED"]
    poi = active_obs[0] if active_obs else active_fvgs[0] if active_fvgs else None
    side = "BUYERS" if decision > 0.10 else "SELLERS" if decision < -0.10 else "BALANCED"
    event = (ltf.get("lastEvent") or htf.get("lastEvent") or {}).get("type", "NO CONFIRMED BREAK")
    return {
        "exchange": "BSE" if symbol == "SENSEX" else "NSE",
        "control": side,
        "structureRead": f"15m {htf['bias']} / 5m {ltf['bias']} · {event}",
        "timeframeAlignment": aligned,
        "phase": intent["phase"],
        "phaseDirection": intent["direction"],
        "phaseConfidence": intent["confidence"],
        "dealingRange": dr.get("zone", "UNKNOWN"),
        "nearestBuySideLiquidity": ({"kind": above[0]["kind"], "level": above[0]["level"],
                                      "scope": above[0]["scope"]} if above else None),
        "nearestSellSideLiquidity": ({"kind": below[0]["kind"], "level": below[0]["level"],
                                       "scope": below[0]["scope"]} if below else None),
        "activePoi": ({"type": "OB" if poi in active_obs else "FVG", "side": poi["side"],
                       "state": poi["state"], "low": poi["low"], "high": poi["high"]}
                      if poi else None),
        "vwap": conf["vwap"]["value"],
        "pcr": conf["pcr"]["value"],
        "oiRead": conf["oi"]["note"],
        "regime": regime["market"],
    }


def forecast_next_move(closed: List[Candle], price: float, atr: float,
                       ltf: Dict[str, Any], pools: List[Dict[str, Any]],
                       sweeps: List[Dict[str, Any]],
                       inducement: Optional[Dict[str, Any]],
                       dr: Dict[str, Any], vol: Dict[str, Any],
                       session: Dict[str, Any], intent: Dict[str, Any],
                       behavior: Dict[str, Any], score: float,
                       regime_key: str, now_ist: datetime) -> Dict[str, Any]:
    """Deterministic next-move forecast: where price gets pulled, in what
    order, on what path — computed from closed bars only (no repaint)."""
    bias = ltf.get("bias", "NEUTRAL")
    magnets = _liquidity_magnets(pools, price, atr, bias)
    magnet = magnets[0] if magnets else None
    secondary = next((m for m in magnets[1:] if m["side"] == (magnet or {}).get("side")),
                     magnets[1] if len(magnets) > 1 else None)

    # Direction blend: factor score + magnet side + short-term drift
    closes = [_f(c, "close") for c in closed[-8:]]
    slope = _linear_slope(closes)
    drift_sign = _clamp(slope / (0.08 * atr), -1.0, 1.0) if atr > 0 else 0.0
    magnet_sign = 0.0
    if magnet:
        magnet_sign = (1.0 if magnet["side"] == "BSL" else -1.0) * (magnet["probability"] / 100.0)
    blend = _clamp(0.5 * score + 0.3 * magnet_sign + 0.2 * drift_sign, -1.0, 1.0)
    direction = "UP" if blend > 0.12 else "DOWN" if blend < -0.12 else "SIDEWAYS"

    conviction = 30 + 45 * abs(blend)
    if magnet and ((blend > 0) == (magnet["side"] == "BSL")):
        conviction += 8
    if session["name"] == "MIDDAY_CHOP":
        conviction -= 6
    if vol["state"] == "EXTREME":
        conviction -= 8
    if regime_key == "TRENDING":
        conviction += 5
    conviction = int(_clamp(conviction, 5, 92))

    # Path projection (damped drift, widening ATR band)
    damp = {"TRENDING": 1.0, "VOLATILE": 0.7, "RANGING": 0.5, "SQUEEZE": 0.35}[regime_key]
    per_bar = (0.6 * slope + 0.4 * blend * 0.15 * atr) * damp * session["qualityMod"]
    projection: Dict[str, Any] = {}
    for n, key in ((1, "m5"), (3, "m15"), (6, "m30")):
        decay = sum(0.85 ** i for i in range(n))
        exp_px = price + per_bar * decay
        band = 0.55 * atr * math.sqrt(n)
        projection[key] = {"expected": _rnd(exp_px, 1),
                           "high": _rnd(exp_px + band, 1), "low": _rnd(exp_px - band, 1)}

    # Expected event sequence (probability decays down the chain)
    sequence: List[Dict[str, Any]] = []
    p = float(max(conviction, 35))
    step = 1
    if inducement and direction != "SIDEWAYS":
        sequence.append({"step": step, "event": f"Sweep inducement @ {inducement['level']} first (retail bait)",
                         "probability": int(_clamp(p * 0.9, 5, 90))})
        step += 1
        p *= 0.82
    if magnet and direction != "SIDEWAYS":
        verb = "Run" if ((direction == "UP") == (magnet["side"] == "BSL")) else "Raid"
        sequence.append({"step": step, "event": f"{verb} {magnet['kind']} @ {magnet['level']} ({magnet['scope'].lower()} pool)",
                         "probability": int(_clamp(p, 5, 90))})
        step += 1
        p *= 0.78
        if secondary:
            sequence.append({"step": step, "event": f"Extend to {secondary['kind']} @ {secondary['level']}",
                             "probability": int(_clamp(p, 5, 85))})
            step += 1
            p *= 0.78
    zone = dr.get("zone")
    if zone == "PREMIUM" and direction == "UP":
        sequence.append({"step": step, "event": "Deep premium — expect rejection wicks near target, book partials",
                         "probability": int(_clamp(p, 5, 80))})
    elif zone == "DISCOUNT" and direction == "DOWN":
        sequence.append({"step": step, "event": "Deep discount — responsive buyers likely near target, book partials",
                         "probability": int(_clamp(p, 5, 80))})
    if not sequence:
        sequence.append({"step": 1, "event": "Two-way rotation inside the range — wait for a sweep of either edge",
                         "probability": max(conviction, 40)})

    # Trap risk read (before it happens)
    trap_level, trap_side, trap_note = 15, None, "No trap conditions active"
    exh = behavior.get("exhaustion")
    last_trap = next((s for s in sweeps if s.get("trapConfirmed") and s["barsAgo"] <= 5), None)
    if magnet and (magnet["distancePts"] or 0) <= 0.6 * atr and direction != "SIDEWAYS":
        chasing_up = direction == "UP" and magnet["side"] == "BSL"
        if chasing_up and (zone == "PREMIUM" or (exh and exh["side"] == "BEARISH")):
            trap_level, trap_side = 62, "BULL_TRAP"
            trap_note = f"Breakout above {magnet['level']} into premium/exhaustion — high stop-run risk"
        elif (not chasing_up) and magnet["side"] == "SSL" and (zone == "DISCOUNT" or (exh and exh["side"] == "BULLISH")):
            trap_level, trap_side = 62, "BEAR_TRAP"
            trap_note = f"Breakdown below {magnet['level']} into discount/absorption — high stop-run risk"
    if last_trap:
        trap_level = max(trap_level, 55)
        trap_note = f"Fresh confirmed trap at {last_trap['level']} — expect follow-through against trapped side"
        trap_side = trap_side or ("BULL_TRAP" if last_trap["side"] == "BSL" else "BEAR_TRAP")

    # Trader map: where resting orders cluster
    bsl_near = min((pl for pl in pools if pl["side"] == "BSL" and not pl.get("swept")
                    and (pl.get("level") or 0) > price),
                   key=lambda pl: pl["level"], default=None)
    ssl_near = max((pl for pl in pools if pl["side"] == "SSL" and not pl.get("swept")
                    and 0 < (pl.get("level") or 0) < price),
                   key=lambda pl: pl["level"], default=None)
    phase = intent.get("phase", "RANGING")
    play_map = {
        "MANIPULATION": "Stops already harvested — position WITH the post-sweep displacement",
        "ACCUMULATION": "Passive bids building below — expect a marked-up leg after the last shakeout",
        "DISTRIBUTION": "Supply parked above — rallies get sold; downside expansion favored",
        "MARKUP": "Trend program running — pullbacks into demand are entry fuel",
        "MARKDOWN": "Trend program running — bounces into supply are entry fuel",
        "RANGING": "Both edges hold resting stops — the first sweep sets the day's direction",
    }
    trader_map = {
        "buyStopsAbove": bsl_near["level"] if bsl_near else None,
        "sellStopsBelow": ssl_near["level"] if ssl_near else None,
        "note": play_map.get(phase, play_map["RANGING"]),
    }

    warnings = _early_warnings(closed, price, atr, vol["state"], magnets, now_ist)

    mins = now_ist.hour * 60 + now_ist.minute
    next_window = ("OPENING_DRIVE 09:30" if mins < 570
                   else "POWER_HOUR 14:30" if mins < 870
                   else "NEXT SESSION 09:15")
    timing = {"window": session["name"], "qualityMod": session["qualityMod"],
              "actNow": bool(session["qualityMod"] >= 0.95 and conviction >= 55),
              "nextWindow": next_window}

    if direction == "SIDEWAYS":
        note = "No dominant draw — rotation until one range edge is swept"
    elif magnet:
        pre = f"sweep {inducement['level']} first, then " if inducement else ""
        note = f"Draw on liquidity {'above' if direction == 'UP' else 'below'} — {pre}{magnet['kind']} @ {magnet['level']} is the primary target"
    else:
        note = f"Momentum drift {'up' if direction == 'UP' else 'down'} — no clean pool, trail on structure"

    return {
        "direction": direction,
        "conviction": conviction,
        "horizonMinutes": 30,
        "magnet": ({k: magnet[k] for k in ("level", "kind", "scope", "side", "distancePts", "probability")}
                   if magnet else None),
        "secondaryMagnet": ({k: secondary[k] for k in ("level", "kind", "scope", "side", "distancePts", "probability")}
                            if secondary else None),
        "projection": projection,
        "sequence": sequence[:4],
        "trapRisk": {"level": trap_level, "side": trap_side, "note": trap_note},
        "earlyWarnings": warnings,
        "traderMap": trader_map,
        "timing": timing,
        "note": note,
    }


def analyze_symbol(symbol: str,
                   candles_5m: List[Candle],
                   candles_15m: List[Candle],
                   spot: Dict[str, Any],
                   peer_candles_5m: List[Candle],
                   peer_symbol: str,
                   now_ist: datetime,
                   live_candle: Optional[Candle] = None) -> Optional[Dict[str, Any]]:
    """Full SMC read for one index. Candles must be CLOSED bars, oldest→newest."""
    closed = [c for c in candles_5m if not c.get("_live")]
    if len(closed) < 12:
        return None

    # Confirmed structure remains based on closed candles. The in-progress
    # candle only feeds fields that should react to each live tick.
    live_series = closed
    if live_candle and live_candle.get("_live"):
        live_series = [*closed, live_candle]

    price = float(spot.get("price") or 0)
    if price <= 0:
        price = _f(closed[-1], "close")
    if price <= 0:
        return None

    change_pct = float(spot.get("changePercent") or 0)
    pcr = float(spot.get("pcr") or 0)
    call_oi, put_oi = float(spot.get("callOI") or 0), float(spot.get("putOI") or 0)
    if pcr <= 0 and call_oi > 0 and put_oi > 0:
        pcr = put_oi / call_oi
    oi_now = _f(live_candle, "oi") if live_candle else _f(closed[-1], "oi")
    if oi_now <= 0:
        oi_now = _f(closed[-1], "oi")
    oi_prev = _f(closed[-1], "oi_prev") or (_f(closed[-2], "oi") if len(closed) >= 2 else 0.0)
    pdh = float(spot.get("prev_day_high") or 0)
    pdl = float(spot.get("prev_day_low") or 0)
    day_high = float(spot.get("high") or 0)
    day_low = float(spot.get("low") or 0)

    atr = _atr(closed)
    ema = ema_context([_f(c, "close") for c in closed], price, atr)

    # ── LTF structure ──────────────────────────────────────────────────────
    swings = detect_swings(closed)
    ltf = walk_structure(closed, swings, atr)
    ltf_score, ltf_note = structure_score(ltf)
    labels = label_swings(swings)[-MAX_EVENTS:]

    # ── HTF structure ──────────────────────────────────────────────────────
    htf_candles = [c for c in candles_15m if not c.get("_live")]
    if len(htf_candles) < 10:
        htf_candles = _resample_15m(closed)
    htf_swings = detect_swings(htf_candles)
    htf = walk_structure(htf_candles, htf_swings, _atr(htf_candles))
    htf_score, htf_note = structure_score(htf)
    four_hour_count = len(htf_candles) // 16
    aligned = htf["bias"] != "NEUTRAL" and htf["bias"] == ltf["bias"]
    struct_combined = _clamp(0.6 * htf_score + 0.4 * ltf_score, -1.0, 1.0)
    if aligned:
        struct_combined = _clamp(struct_combined * 1.2, -1.0, 1.0)

    # ── Location ───────────────────────────────────────────────────────────
    dr = dealing_range(swings if len(swings) >= 4 else htf_swings, price)
    loc_score = 0.0
    if dr["positionPct"] is not None:
        # +1 deep discount (long edge) … −1 deep premium (short edge)
        loc_score = _clamp((50.0 - dr["positionPct"]) / 50.0, -1.0, 1.0)

    # ── Liquidity ──────────────────────────────────────────────────────────
    pools = detect_liquidity_pools(closed, swings, price, atr, pdh, pdl,
                                   day_high, day_low, dr["high"], dr["low"])
    sweeps = detect_sweeps(closed, pools, atr)
    inducement = detect_inducement(swings, price, ltf["bias"], atr)
    liq_score = 0.0
    liq_notes: List[str] = []
    for s in sweeps:
        w = 0.55 if s["trapConfirmed"] else 0.25
        contrib = w if s["side"] == "SSL" else -w
        recency = max(0.3, 1.0 - s["barsAgo"] / SWEEP_LOOKBACK)
        liq_score += contrib * recency
        liq_notes.append(s["read"])
    bsl_near = [pl for pl in pools if pl["side"] == "BSL" and (pl.get("distancePct") or 0) > 0]
    ssl_near = [pl for pl in pools if pl["side"] == "SSL" and (pl.get("distancePct") or 0) < 0]
    if bsl_near and ssl_near:
        d_up = min(abs(pl["distancePct"]) for pl in bsl_near)
        d_dn = min(abs(pl["distancePct"]) for pl in ssl_near)
        # price gravitates toward the nearer untapped pool (draw on liquidity)
        if d_up < d_dn * 0.6:
            liq_score += 0.2
            liq_notes.append("Nearest untapped pool is ABOVE — draw on buy-side liquidity")
        elif d_dn < d_up * 0.6:
            liq_score -= 0.2
            liq_notes.append("Nearest untapped pool is BELOW — draw on sell-side liquidity")
    liq_score = _clamp(liq_score, -1.0, 1.0)

    # ── Zones ──────────────────────────────────────────────────────────────
    obs = detect_order_blocks(closed, atr)
    fvgs = detect_fvgs(closed, atr)
    bpr = detect_bpr(fvgs)
    zone_score = 0.0
    for o in obs:
        if o["state"] == "BREAKER":
            continue
        mid = ((o["low"] or 0) + (o["high"] or 0)) / 2
        dist = abs(price - mid)
        if dist <= 2.0 * atr:
            prox = max(0.0, 1.0 - dist / (2.0 * atr))
            zone_score += (0.4 if o["side"] == "DEMAND" else -0.4) * prox
    for g in fvgs:
        mid = ((g["low"] or 0) + (g["high"] or 0)) / 2
        dist = abs(price - mid)
        if dist <= 2.0 * atr:
            prox = max(0.0, 1.0 - dist / (2.0 * atr))
            zone_score += (0.25 if g["side"] == "BULLISH" else -0.25) * prox
    zone_score = _clamp(zone_score, -1.0, 1.0)

    # ── Momentum / trend / volatility / session / behavior ────────────────
    closes = [_f(c, "close") for c in live_series]
    rsi = _rsi(closes)
    roc5 = _roc(closes, 5)
    mom_score = 0.0
    if rsi is not None:
        mom_score += _clamp((rsi - 50.0) / 25.0, -0.7, 0.7)
    mom_score = _clamp(mom_score + _clamp(roc5 / 0.35, -0.3, 0.3), -1.0, 1.0)
    mom_state = ("STRONG_UP" if mom_score > 0.5 else "UP" if mom_score > 0.15
                 else "STRONG_DOWN" if mom_score < -0.5 else "DOWN" if mom_score < -0.15
                 else "FLAT")

    ts = trend_strength(closed)
    vol = volatility_regime(live_series, atr)
    session = session_context(now_ist)
    behavior = detect_absorption_exhaustion(live_series, atr, day_high, day_low)
    conf = confluence_read(live_series, price, pcr, oi_now, oi_prev, change_pct)
    smt = smt_divergence(swings, detect_swings([c for c in peer_candles_5m if not c.get("_live")]),
                         peer_symbol) if peer_candles_5m else \
        {"state": "NO_PEER_DATA", "peer": peer_symbol, "score": 0.0, "note": "Peer data unavailable"}

    behavior_adj = 0.0
    if behavior.get("absorption"):
        behavior_adj += 0.25 if behavior["absorption"]["side"] == "BULLISH" else -0.25
    if behavior.get("exhaustion"):
        behavior_adj += 0.30 if behavior["exhaustion"]["side"] == "BULLISH" else -0.30

    dr_zone = dr.get("zone", "UNKNOWN")
    intent = institutional_intent(ltf["bias"], sweeps, behavior, conf, dr_zone)
    intent_score = 0.0
    if intent["direction"] == "BULLISH":
        intent_score = intent["confidence"] / 100.0
    elif intent["direction"] == "BEARISH":
        intent_score = -intent["confidence"] / 100.0

    # ── Weighted fusion (regime-adaptive) ─────────────────────────────────
    regime_key = _regime_key(vol["state"], ts["direction"])
    weights = REGIME_WEIGHTS[regime_key]
    factors = {
        "structure": {"score": struct_combined, "note": f"HTF: {htf_note} | LTF: {ltf_note}"},
        "liquidity": {"score": liq_score, "note": "; ".join(liq_notes) or "No recent sweeps"},
        "zones": {"score": zone_score, "note": f"{len(obs)} OBs, {len(fvgs)} FVGs near price"},
        "location": {"score": loc_score, "note": f"{dr_zone} @ {dr['positionPct']}% of dealing range"},
        "momentum": {"score": _clamp(mom_score + behavior_adj * 0.5, -1.0, 1.0),
                     "note": f"RSI {rsi:.0f}, ROC5 {roc5:+.2f}%" if rsi is not None else "Momentum warming up"},
        "confluence": {"score": conf["score"] or 0.0, "note": conf["vwap"]["note"]},
        "smt": {"score": smt["score"], "note": smt["note"]},
        "intent": {"score": intent_score, "note": intent["note"]},
        "ema": {"score": ema["score"],
                "note": (f"EMA20 {ema['ema20']} / EMA50 {ema['ema50']} / EMA200 {ema['ema200']} · "
                         f"price {ema['priceVs200']}"
                         if ema["status"] != "INSUFFICIENT_HISTORY"
                         else "EMA stack warming up — need 200 closed 5m candles")},
    }
    score = sum(weights[k] * factors[k]["score"] for k in weights) * 0.90 + ema["score"] * 0.10
    score = _clamp(score * session["qualityMod"] / 1.0, -1.0, 1.0)
    for k in factors:
        factors[k]["weight"] = weights.get(k, 0.10 if k == "ema" else 0.0)
        factors[k]["score"] = _rnd(factors[k]["score"], 3)

    # ── Decisive action layer ─────────────────────────────────────────────
    # A professional never averages opposing factors into paralysis:
    # DIRECTION comes from the dominant narrative (structure, intent,
    # momentum, trend, confluence) — location/liquidity shape ENTRY & RISK.
    trend_sign = (1.0 if ts["direction"] == "BULLISH"
                  else -1.0 if ts["direction"] == "BEARISH" else 0.0)
    mom_full = float(factors["momentum"]["score"] or 0.0)
    narrative = _clamp(
        0.30 * struct_combined
        + 0.24 * intent_score
        + 0.18 * mom_full
        + 0.14 * trend_sign * (ts["value"] / 100.0)
        + 0.12 * (conf["score"] or 0.0)
        + 0.10 * ema["score"],
        -1.0, 1.0)
    decision = _clamp(0.55 * narrative + 0.45 * score, -1.0, 1.0)

    dir_signals = [struct_combined, intent_score, mom_full, trend_sign,
                   float(conf["score"] or 0.0), ema["score"]]
    active = [s for s in dir_signals if abs(s) > 0.10]
    aligned_votes = (sum(1 for s in active if (s > 0) == (decision > 0))
                     if active and decision != 0 else 0)
    # conviction bonus: near-unanimous directional checklist
    if decision != 0 and len(active) >= 3 and aligned_votes >= max(3, len(active) - 1):
        decision = _clamp(decision * 1.25, -1.0, 1.0)

    # Counter-evidence AGAINST the decision: traps, exhaustion, SMT, location
    counter = 0.0
    if behavior.get("exhaustion") and ((behavior["exhaustion"]["side"] == "BEARISH") == (decision > 0)):
        counter += 0.30
    trap_recent = next((s for s in sweeps if s["trapConfirmed"] and s["barsAgo"] <= 6), None)
    if trap_recent and ((trap_recent["side"] == "BSL") == (decision > 0)):
        counter += 0.35
    if abs(smt["score"]) > 0.3 and (smt["score"] > 0) != (decision > 0) and decision != 0:
        counter += 0.25
    if dr_zone == "PREMIUM" and decision > 0:
        counter += 0.15
    if dr_zone == "DISCOUNT" and decision < 0:
        counter += 0.15

    # ── Verdict, confidence, probabilities ────────────────────────────────
    mag = abs(decision)
    if mag >= 0.40:
        verdict = "STRONG_BUY" if decision > 0 else "STRONG_SELL"
    elif mag >= 0.14:
        verdict = "BUY" if decision > 0 else "SELL"
    else:
        verdict = "NEUTRAL"

    # Intraday tape override: on the 5m timeframe, LTF structure + intent +
    # trend/momentum all pointing one way IS the trade — HTF is only context.
    if verdict == "NEUTRAL" and ltf["bias"] != "NEUTRAL":
        tape_sign = 1.0 if ltf["bias"] == "BULLISH" else -1.0
        tape_votes = sum([
            intent["direction"] == ltf["bias"],
            ts["direction"] == ltf["bias"],
            (mom_full > 0.10) == (tape_sign > 0) and abs(mom_full) > 0.10,
            ((conf["score"] or 0.0) > 0.10) == (tape_sign > 0) and abs(conf["score"] or 0.0) > 0.10,
        ])
        opposing = decision != 0 and (decision > 0) != (tape_sign > 0) and abs(decision) > 0.08
        if tape_votes >= 2 and not opposing:
            verdict = "BUY" if tape_sign > 0 else "SELL"
            decision = tape_sign * max(mag, 0.18)
            mag = abs(decision)

    # heavy counter-evidence downgrades one notch (never flips direction)
    if counter >= 0.45 and verdict in ("STRONG_BUY", "STRONG_SELL"):
        verdict = "BUY" if decision > 0 else "SELL"

    agree = (aligned_votes / len(active)) if active and decision != 0 else 0.5
    confidence = 34 + 46 * mag + 16 * agree - 18 * counter
    if vol["state"] == "EXTREME":
        confidence -= 8
    if session["name"] == "MIDDAY_CHOP":
        confidence -= 5
    confidence = int(_clamp(confidence, 5, 95))
    alignment = {
        "alignedSignals": aligned_votes,
        "activeSignals": len(active),
        "ratio": _rnd(aligned_votes / len(active), 2) if active else 0.0,
        "status": "UNANIMOUS" if active and aligned_votes == len(active)
                  else "ALIGNED" if aligned_votes >= max(3, len(active) - 1)
                  else "MIXED",
    }

    trend_conf = mag * agree
    continuation = _clamp(38 + 45 * trend_conf - 25 * counter, 5, 92)
    reversal = _clamp(18 + 55 * counter + (8 if vol["state"] in ("HIGH", "EXTREME") else 0), 5, 88)
    chop = _clamp(100 - continuation - reversal, 3, 90)
    total = continuation + reversal + chop
    continuation, reversal, chop = (round(x / total * 100, 1) for x in (continuation, reversal, chop))

    # ── Trade plan ─────────────────────────────────────────────────────────
    bull = decision > 0
    plan: Dict[str, Any] = {"action": verdict, "entryZone": None, "entryNote": "Stand aside — no edge",
                            "stopLoss": None, "invalidation": None, "targets": [],
                            "liquidityTarget": None, "riskReward": None}
    risk_score = 30
    risk_score += {"SQUEEZE": 5, "NORMAL": 0, "HIGH": 12, "EXTREME": 25, "UNKNOWN": 8}[vol["state"]]
    if trap_recent:
        risk_score += 12
    if session["name"] == "MIDDAY_CHOP":
        risk_score += 10
    if inducement:
        risk_score += 6
    risk_score = int(_clamp(risk_score + (25 - confidence // 4), 5, 95))

    if verdict != "NEUTRAL":
        entry_zone = None
        for o in obs:
            if o["state"] == "BREAKER":
                continue
            if bull and o["side"] == "DEMAND" and (o["high"] or 0) <= price and price - (o["high"] or 0) <= 2.2 * atr:
                entry_zone = [o["low"], o["high"]]
                plan["entryNote"] = "Limit at demand OB below — let price come to you"
                break
            if not bull and o["side"] == "SUPPLY" and (o["low"] or 0) >= price and (o["low"] or 0) - price <= 2.2 * atr:
                entry_zone = [o["low"], o["high"]]
                plan["entryNote"] = "Limit at supply OB above — let price come to you"
                break
        if entry_zone is None:
            for g in fvgs:
                if g["state"] == "INVERTED":
                    continue
                if bull and g["side"] == "BULLISH" and (g["high"] or 0) <= price and price - (g["high"] or 0) <= 2.2 * atr:
                    entry_zone = [g["low"], g["high"]]
                    plan["entryNote"] = "Limit at bullish FVG below"
                    break
                if not bull and g["side"] == "BEARISH" and (g["low"] or 0) >= price and (g["low"] or 0) - price <= 2.2 * atr:
                    entry_zone = [g["low"], g["high"]]
                    plan["entryNote"] = "Limit at bearish FVG above"
                    break
        if entry_zone is None:
            edge = 0.35 * atr
            entry_zone = [_rnd(price - edge), _rnd(price)] if bull else [_rnd(price), _rnd(price + edge)]
            plan["entryNote"] = "No clean zone nearby — momentum entry only with tight risk"
        plan["entryZone"] = entry_zone

        invalidation = ltf["protectedLow"] if bull else ltf["protectedHigh"]
        if invalidation is None:
            invalidation = _rnd(price - 1.8 * atr) if bull else _rnd(price + 1.8 * atr)
        plan["invalidation"] = invalidation
        buf = 0.15 * atr
        plan["stopLoss"] = _rnd(invalidation - buf) if bull else _rnd(invalidation + buf)

        with_pools = [pl for pl in pools if not pl.get("swept")
                      and ((bull and pl["side"] == "BSL" and (pl.get("distancePct") or 0) > 0)
                           or (not bull and pl["side"] == "SSL" and (pl.get("distancePct") or 0) < 0))]
        with_pools.sort(key=lambda pl: abs(pl.get("distancePct") or 99))
        t1 = with_pools[0] if with_pools else None
        t2 = next((pl for pl in with_pools[1:] if pl["scope"] == "EXTERNAL"),
                  with_pools[1] if len(with_pools) > 1 else None)
        targets = []
        if t1:
            targets.append({"level": t1["level"], "label": f"{t1['kind']} ({t1['scope']})"})
            plan["liquidityTarget"] = {"level": t1["level"], "kind": t1["kind"], "scope": t1["scope"]}
        else:
            fallback = _rnd(price + 1.5 * atr) if bull else _rnd(price - 1.5 * atr)
            targets.append({"level": fallback, "label": "1.5×ATR projection"})
            plan["liquidityTarget"] = {"level": fallback, "kind": "ATR_PROJECTION", "scope": "INTERNAL"}
        if t2:
            targets.append({"level": t2["level"], "label": f"{t2['kind']} ({t2['scope']})"})
        plan["targets"] = targets

        entry_ref = (entry_zone[1] if bull else entry_zone[0]) or price
        sl = plan["stopLoss"]
        t1_level = targets[0]["level"]
        if sl is not None and t1_level is not None and entry_ref and abs(entry_ref - sl) > 0:
            plan["riskReward"] = _rnd(abs(t1_level - entry_ref) / abs(entry_ref - sl), 2)
    plan["riskScore"] = risk_score

    # ── Trader command: exact instruction to execute right now ────────────
    strong = verdict in ("STRONG_BUY", "STRONG_SELL")
    if verdict == "NEUTRAL":
        edge_hi = dr.get("high")
        edge_lo = dr.get("low")
        wait_note = (f"WAIT — no edge. Act only on a sweep of {edge_lo}–{edge_hi} range edges"
                     if edge_hi and edge_lo else "WAIT — no edge, two-way auction")
        action = {"call": "WAIT", "instrument": None, "urgency": "NONE",
                  "instruction": wait_note, "validity": "Until a range edge is swept"}
    else:
        instrument = "CE (Call)" if bull else "PE (Put)"
        call = f"BUY {'CE' if bull else 'PE'}"  # index options: direction expressed via CE/PE
        ez = plan.get("entryZone") or [None, None]
        ez_txt = (f"{ez[0]}–{ez[1]}" if ez[0] is not None and ez[1] is not None else "market")
        t1_lvl = plan["targets"][0]["level"] if plan.get("targets") else None
        urgency = ("NOW" if strong and session["qualityMod"] >= 0.9
                   else "HIGH" if strong else "ON_PULLBACK")
        entry_style = ("Enter NOW at market" if urgency == "NOW"
                       else f"Enter at zone {ez_txt}" if plan.get("entryZone")
                       else "Enter on first pullback")
        action = {
            "call": call,
            "instrument": f"{symbol} ATM {instrument}",
            "urgency": urgency,
            "instruction": (f"{entry_style} · SL {plan.get('stopLoss')} spot"
                            + (f" · Target {t1_lvl}" if t1_lvl is not None else "")
                            + f" · Exit if spot closes {'below' if bull else 'above'} {plan.get('invalidation')}"),
            "validity": f"{session['name'].replace('_', ' ').title()} window",
        }
    plan["traderAction"] = action

    institutional = _institutional_map(
        symbol, price, htf, ltf, aligned, intent, dr, pools, obs, fvgs, conf,
        {"market": regime_key}, decision,
    )

    # ── Predictive layer ───────────────────────────────────────────────────
    prediction = forecast_next_move(live_series, price, atr, ltf, pools, sweeps,
                                    inducement, dr, vol, session, intent,
                                    behavior, decision, regime_key, now_ist)

    # ── Reasoning ──────────────────────────────────────────────────────────
    reasoning: List[str] = []
    if verdict != "NEUTRAL":
        reasoning.append(
            f"DECISION: {verdict.replace('_', ' ')} — {aligned_votes}/{len(active) or 1} directional "
            f"signals aligned {'bullish' if decision > 0 else 'bearish'}"
            + (f"; counter-evidence {int(counter * 100)}% respected in sizing" if counter >= 0.3 else ""))
    reasoning.append(f"HTF(15m) {htf['bias'].lower()}, LTF(5m) {ltf['bias'].lower()}"
                     + (" — timeframes ALIGNED" if aligned else " — timeframes split, lower conviction"))
    if ltf.get("lastEvent"):
        ev = ltf["lastEvent"]
        reasoning.append(f"Last structure event: {ev['type']} {ev['direction'].lower()} @ {ev['level']}"
                         + (" with displacement" if ev.get("displacement") else ""))
    if dr["positionPct"] is not None:
        reasoning.append(f"Price in {dr_zone} ({dr['positionPct']}% of dealing range {dr['low']}–{dr['high']})")
    for s in sweeps[:2]:
        reasoning.append(f"{s['poolKind']} {s['side']} swept {s['barsAgo']} bars ago — {s['read']}")
    if inducement:
        reasoning.append(inducement["note"])
    if behavior.get("absorption"):
        reasoning.append(behavior["absorption"]["note"])
    if behavior.get("exhaustion"):
        reasoning.append(behavior["exhaustion"]["note"])
    if abs(smt["score"]) > 0.2:
        reasoning.append(f"SMT vs {smt['peer']}: {smt['note']}")
    reasoning.append(conf["oi"]["note"] + "; " + conf["pcr"]["note"])
    reasoning.append(f"Regime {regime_key} · vol {vol['state']} · session {session['name']} — {session['note']}")
    reasoning.append(intent["note"])

    return {
        "symbol": symbol,
        "verdict": verdict,
        "confidence": confidence,
        "score": _rnd(decision, 4),
        "factorScore": _rnd(score, 4),
        "probabilities": {"continuation": continuation, "reversal": reversal, "chop": chop},
        "alignment": alignment,
        "structure": {
            "htf": {"bias": htf["bias"], "lastEvent": htf.get("lastEvent"),
                    "protectedHigh": htf.get("protectedHigh"), "protectedLow": htf.get("protectedLow")},
            "ltf": {"bias": ltf["bias"], "lastEvent": ltf.get("lastEvent"),
                    "events": ltf["events"], "labels": labels,
                    "protectedHigh": ltf.get("protectedHigh"), "protectedLow": ltf.get("protectedLow")},
            "aligned": aligned,
        },
        "dealingRange": dr,
        "liquidity": {"pools": pools, "sweeps": sweeps, "inducement": inducement},
        "zones": {"orderBlocks": obs, "fvgs": fvgs, "bpr": bpr},
        "smt": smt,
        "confluence": conf,
        "regime": {"market": regime_key, "volatility": vol["state"],
                   "atr": vol["atr"], "atrPctile": vol["atrPctile"],
                   "trendStrength": ts["value"], "trendDirection": ts["direction"]},
        "momentum": {"rsi": _rnd(rsi, 1), "roc5": _rnd(roc5, 3), "state": mom_state},
        "session": session,
        "behavior": behavior,
        "intent": intent,
        "technical": {"ema": ema, "previousDay": {"high": _rnd(pdh) or None,
                                                     "low": _rnd(pdl) or None},
                      "fourHour": {"status": "READY" if four_hour_count >= 20 else "INSUFFICIENT_HISTORY",
                                    "closedCandles": four_hour_count,
                                    "direction": htf["bias"] if four_hour_count >= 4 else "UNAVAILABLE"}},
        "institutionalMap": institutional,
        "tradePlan": plan,
        "prediction": prediction,
        "factors": factors,
        "reasoning": reasoning[:10],
        "metrics": {"price": _rnd(price), "changePct": _rnd(change_pct),
                    "vwap": conf["vwap"]["value"], "pdh": _rnd(pdh) or None,
                    "pdl": _rnd(pdl) or None, "dayHigh": _rnd(day_high) or None,
                    "dayLow": _rnd(day_low) or None,
                    "tickTimestamp": spot.get("timestamp"),
                    "feedStatus": spot.get("status", "UNKNOWN")},
        "candlesUsed": {"ltf": len(closed), "htf": len(htf_candles)},
    }
