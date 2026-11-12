"""6 Algo Desk: six independent option-buying algos over completed shared Kite futures candles.

Every rule reads only live Kite-fed AQTE state: completed one-minute futures candles from the shared,
history-seeded CandleBook, the latest futures tick (depth, best bid/ask quantity, OI) and fresh
subscribed option quotes. A rule whose evidence is missing or stale is null (MONITORING) and can never
trade. Algos only propose; the shared AQTE live lane places, protects and exits every order.
"""

import math
import threading
from dataclasses import asdict
from statistics import fmean, pvariance

from services.aqte_engine import OPEN_MINUTE, day, minute_of_day, round_tick, session
from services.aqte_engines import expiry_years, greeks, rule, side_rule, status_of

ALGOS = (
    ("adaptive_vwap_pro", "Adaptive VWAP Pro", "Trend pullback to session VWAP"),
    ("order_flow_momentum", "Order Flow Momentum", "Depth imbalance with candle-volume pressure"),
    ("liquidity_sweep_bos", "Liquidity Sweep + BOS", "Stop run, then break of structure"),
    ("orb_retest", "ORB Retest Pro", "Opening-range breakout and retest"),
    ("failed_breakout_reversal", "Failed Breakout Reversal", "Trap reversal after a false break"),
    ("volatility_expansion", "Volatility Expansion Pro", "Bollinger squeeze release"),
)
ALGO_KEYS = tuple(key for key, _, _ in ALGOS)
RETIRED_ALGO_KEYS = frozenset({
    "multi_timeframe_momentum", "options_intelligence", "market_profile",
    "adaptive_mean_reversion", "realized_semivariance", "ai_regime_detection",
})
ALGO_NAMES = {key: name for key, name, _ in ALGOS}
SYMBOLS = ("NIFTY", "BANKNIFTY", "SENSEX")
# A trigger candle may be acted on only within this many seconds after it closed.
TRIGGER_MAX_AGE = 90
MIN_BARS = 60
PER_ALGO_MAX_TRADES = 2
TRAIL_START_R = 1.0
TARGET_R = 2.0
MIN_REWARD_RISK = 1.5
# Option stop distance as a fraction of premium: never tighter than 8%, never wider than 35%.
STOP_FLOOR, STOP_CAP = 0.08, 0.35
ATM_DELTA = 0.5
ORB_LAST_ENTRY_MINUTE = 750  # 12:30 IST


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def valid_bar(bar):
    try:
        values = [bar[field] for field in ("open", "high", "low", "close", "volume")]
    except (KeyError, TypeError):
        return False
    if not all(finite(value) for value in values):
        return False
    open_price, high, low, close, volume = values
    return volume >= 0 and 0 < low <= min(open_price, close) and high >= max(open_price, close)


def fmt(value, digits=2, suffix=""):
    return f"{value:.{digits}f}{suffix}" if finite(value) else None


def direction(value):
    return 0 if not finite(value) or value == 0 else 1 if value > 0 else -1


def side_name(sign):
    return "CE" if sign > 0 else "PE" if sign < 0 else None


def trend_label(sign):
    return None if sign is None else "BULLISH" if sign > 0 else "BEARISH" if sign < 0 else "NEUTRAL"


def ema_series(values, length):
    out = [None] * len(values)
    if len(values) < length:
        return out
    value = fmean(values[:length])
    out[length - 1] = value
    alpha = 2 / (length + 1)
    for index in range(length, len(values)):
        value += alpha * (values[index] - value)
        out[index] = value
    return out


def _rsi_value(gain, loss):
    if loss == 0:
        return 100.0 if gain > 0 else 50.0
    return 100 - 100 / (1 + gain / loss)


def rsi_series(closes, period=14):
    """Wilder RSI per close; None until `period` changes exist."""
    out = [None] * len(closes)
    if len(closes) <= period:
        return out
    changes = [right - left for left, right in zip(closes, closes[1:])]
    gain = fmean(max(change, 0.0) for change in changes[:period])
    loss = fmean(max(-change, 0.0) for change in changes[:period])
    out[period] = _rsi_value(gain, loss)
    for index in range(period, len(changes)):
        gain = (gain * (period - 1) + max(changes[index], 0.0)) / period
        loss = (loss * (period - 1) + max(-changes[index], 0.0)) / period
        out[index + 1] = _rsi_value(gain, loss)
    return out


def true_ranges(bars, days=None):
    """True range per bar; the first bar of each session uses its own range (no overnight gap)."""
    out = []
    for index, bar in enumerate(bars):
        previous = bars[index - 1] if index else None
        if previous is None or (days is not None and days[index - 1] != days[index]):
            out.append(bar["high"] - bar["low"])
        else:
            out.append(max(bar["high"] - bar["low"], abs(bar["high"] - previous["close"]),
                           abs(bar["low"] - previous["close"])))
    return out


def rolling_mean(values, length):
    out, total = [None] * len(values), 0.0
    for index, value in enumerate(values):
        total += value
        if index >= length:
            total -= values[index - length]
        if index >= length - 1:
            out[index] = total / length
    return out


def frames(bars, minutes):
    """Complete OHLCV buckets aligned to the 09:15 IST session open; a forming bucket is dropped."""
    buckets = {}
    for bar in bars:
        offset = (minute_of_day(bar["at"]) - OPEN_MINUTE) % minutes
        buckets.setdefault(bar["at"] - offset * 60, []).append(bar)
    out = []
    for start in sorted(buckets):
        rows = buckets[start]
        if [row["at"] for row in rows] != [start + 60 * index for index in range(minutes)]:
            continue
        out.append(dict(
            at=start, open=rows[0]["open"], high=max(row["high"] for row in rows),
            low=min(row["low"] for row in rows), close=rows[-1]["close"],
            volume=sum(row["volume"] for row in rows),
            oi=next((row.get("oi") for row in reversed(rows) if row.get("oi") is not None), None)))
    return out


def vwap_series(bars):
    """Session VWAP after each bar."""
    weighted = volume = 0.0
    out = []
    for bar in bars:
        typical = (bar["high"] + bar["low"] + bar["close"]) / 3
        weighted += typical * bar["volume"]
        volume += bar["volume"]
        if volume <= 0:
            out.append((None, None))
            continue
        mean = weighted / volume
        out.append(mean)
    return out


def efficiency(closes, length=30):
    if len(closes) <= length:
        return None
    window = closes[-length - 1:]
    path = sum(abs(right - left) for left, right in zip(window, window[1:]))
    return abs(window[-1] - window[0]) / path if path > 0 else 0.0


def frame_trend(frame, length=9):
    """+1 close above a rising EMA, -1 below a falling EMA, 0 otherwise; None without history."""
    closes = [bar["close"] for bar in frame]
    if len(closes) < length + 2:
        return None
    series = ema_series(closes, length)
    current, previous = series[-1], series[-2]
    if closes[-1] > current > previous:
        return 1
    if closes[-1] < current < previous:
        return -1
    return 0


def structure(frame, window=24):
    """+1 higher highs and higher lows, -1 lower highs and lower lows, 0 mixed (confirmed 3-bar pivots)."""
    frame = frame[-window:]
    highs, lows = [], []
    for index in range(1, len(frame) - 1):
        left, bar, right = frame[index - 1], frame[index], frame[index + 1]
        if bar["high"] > left["high"] and bar["high"] >= right["high"]:
            highs.append(bar["high"])
        if bar["low"] < left["low"] and bar["low"] <= right["low"]:
            lows.append(bar["low"])
    if len(highs) < 2 or len(lows) < 2:
        return None
    if highs[-1] > highs[-2] and lows[-1] > lows[-2]:
        return 1
    if highs[-1] < highs[-2] and lows[-1] < lows[-2]:
        return -1
    return 0


def relative_volume(bars, length=20):
    if len(bars) <= length:
        return None
    base = fmean(bar["volume"] for bar in bars[-length - 1:-1])
    return bars[-1]["volume"] / base if base > 0 else None


def build_features(bars, now):
    """Shared per-revision features over completed regular-session one-minute futures candles."""
    days = [day(bar["at"]) for bar in bars]
    today_key = day(now)
    today = [bar for bar, key in zip(bars, days) if key == today_key]
    closes = [bar["close"] for bar in bars]
    atr = rolling_mean(true_ranges(bars, days), 14)
    rsi = rsi_series(closes)
    vwap_values = vwap_series(today)
    m5, m15, m30 = frames(bars, 5), frames(bars, 15), frames(bars, 30)
    m5_closes = [bar["close"] for bar in m5]
    atr5 = rolling_mean(true_ranges(m5, [day(bar["at"]) for bar in m5]), 14) if len(m5) >= 14 else []
    recent_atr = [value for value in atr[-60:] if value is not None]
    current_atr = atr[-1] if atr else None
    atr_percentile = (sum(value <= current_atr for value in recent_atr) / len(recent_atr)
                      if current_atr is not None and len(recent_atr) >= 30 else None)
    er = efficiency(closes)
    regime = None if er is None else "TRENDING" if er >= 0.35 else "RANGING" if er <= 0.2 else "TRANSITIONAL"
    vwap = vwap_values[-1] if vwap_values else None
    return dict(
        bars=bars, today=today, today_minutes=[minute_of_day(bar["at"]) for bar in today],
        close=closes[-1], last=bars[-1], previous=bars[-2],
        atr1=current_atr, rsi1=rsi,
        vwap=vwap, er=er,
        rvol=relative_volume(bars), m5=m5,
        atr5=atr5[-1] if atr5 else None,
        ema20_5=ema_series(m5_closes, 20)[-1] if m5_closes else None,
        htf30=frame_trend(m30), structure15=structure(m15),
        regime=regime, volatile=atr_percentile is not None and atr_percentile >= 0.8,
    )


def floor_risk(features, risk):
    """Underlying stop distance, never tighter than half a one-minute ATR."""
    atr = features["atr1"]
    if not finite(risk) or risk <= 0:
        return 0.5 * atr if finite(atr) and atr > 0 else None
    return max(risk, 0.5 * atr) if finite(atr) else risk


def swing_risk(features, sign, count=5):
    bars = features["bars"][-count:]
    extreme = min(bar["low"] for bar in bars) if sign > 0 else max(bar["high"] for bar in bars)
    return floor_risk(features, (features["close"] - extreme) * sign)


def vwap_rule(features, sign):
    vwap, close = features["vwap"], features["close"]
    return side_rule("vwap_side", "VWAP side", sign, vwap is not None, lambda s: (close - vwap) * s > 0,
                     "Close on the trade side of session VWAP", fmt(close - vwap if vwap else None, 1, " pts"))


def oi_buildup(features, count=5):
    bars = features["today"]
    if len(bars) <= count:
        return None, None
    start, end = bars[-count - 1], bars[-1]
    if start.get("oi") is None or end.get("oi") is None:
        return None, None
    return end["oi"] - start["oi"], end["close"] - start["close"]


def oi_rule(features, sign):
    change, move = oi_buildup(features)
    return side_rule("oi_buildup", "Futures OI build-up", sign, change is not None,
                     lambda s: change > 0 and move * s > 0,
                     "Futures OI rising over 5 candles with price moving in the trade direction",
                     None if change is None else f"{change:+,} OI")


def adaptive_vwap_pro(features, live, context):
    trend, m5, atr5, vwap = features["htf30"], features["m5"], features["atr5"], features["vwap"]
    sign = trend or 0
    ready = len(m5) >= 5 and atr5 is not None and vwap is not None and features["ema20_5"] is not None
    last5, previous5 = (m5[-1], m5[-2]) if len(m5) >= 2 else (None, None)
    recent = m5[-4:-1]
    lines = (vwap, features["ema20_5"]) if ready else (0, 0)

    def pullback(s):
        if s > 0:
            return (any(bar["low"] <= max(lines) + 0.25 * atr5 for bar in recent) and
                    all(bar["close"] >= min(lines) - 0.25 * atr5 for bar in recent))
        return (any(bar["high"] >= min(lines) - 0.25 * atr5 for bar in recent) and
                all(bar["close"] <= max(lines) + 0.25 * atr5 for bar in recent))

    def confirmation(s):
        span = last5["high"] - last5["low"]
        return (last5["close"] - last5["open"]) * s > 0 and span > 0 and (
            abs(last5["close"] - last5["open"]) / span >= 0.5)

    rules = [
        rule("htf_30m", "30m trend", None if trend is None else trend != 0,
             "30m close beyond a rising (CE) / falling (PE) EMA9", trend_label(trend)),
        side_rule("structure_15m", "15m structure", sign, features["structure15"] is not None,
                  lambda s: features["structure15"] == s, "15m higher highs/lows (CE) or lower highs/lows (PE)",
                  trend_label(features["structure15"])),
        vwap_rule(features, sign),
        side_rule("pullback", "Pullback to value", sign, ready, pullback,
                  "A recent 5m candle tested VWAP/EMA20 within 0.25 ATR and held"),
        side_rule("confirmation", "Confirmation candle", sign, last5 is not None, confirmation,
                  "Last 5m candle closes in the trade direction with a body >= 50% of its range"),
        side_rule("trigger", "5m trigger", sign, previous5 is not None,
                  lambda s: last5["close"] > previous5["high"] if s > 0 else last5["close"] < previous5["low"],
                  "5m close beyond the previous 5m high (CE) / low (PE)"),
        rule("regime", "Trend efficiency", None if features["er"] is None else features["er"] >= 0.3,
             "30-candle efficiency ratio >= 0.30", fmt(features["er"])),
    ]
    risk = None
    if sign and last5 is not None and recent:
        window = [*recent, last5]
        extreme = min(bar["low"] for bar in window) if sign > 0 else max(bar["high"] for bar in window)
        risk = floor_risk(features, (features["close"] - extreme) * sign)
    return dict(sign=sign, rules=rules, trigger=last5, seconds=300, risk=risk,
                setup="Trend pullback to VWAP / EMA20 with a 5m continuation")


def order_flow_momentum(features, live, context):
    bars = features["today"]
    last5 = bars[-5:]
    total = sum(bar["volume"] for bar in last5)
    delta = (sum(bar["volume"] * direction(bar["close"] - bar["open"]) for bar in last5) / total
             if len(last5) == 5 and total > 0 else None)
    sign = direction(delta)
    depth = (live.buy_depth + live.sell_depth) if live else 0
    imbalance = (live.buy_depth - live.sell_depth) / depth if depth > 0 else None
    book = (live.bid_quantity + live.ask_quantity) if live else 0
    prior = bars[-6:-1]
    rvol = relative_volume(bars)
    rules = [
        rule("volume_delta", "Candle-volume pressure", None if delta is None else abs(delta) >= 0.3,
             "5-candle volume signed by candle direction >= 30% of total (a volume-pressure proxy)",
             fmt(None if delta is None else delta * 100, 0, "%")),
        side_rule("depth_imbalance", "Depth imbalance", sign, imbalance is not None,
                  lambda s: imbalance * s >= 0.15, "Live 5-level depth imbalance >= 15% toward the trade",
                  fmt(None if imbalance is None else imbalance * 100, 0, "%")),
        side_rule("top_of_book", "Top of book", sign, book > 0,
                  lambda s: (live.bid_quantity - live.ask_quantity) * s > 0,
                  "Best bid quantity exceeds best ask quantity (CE) or the reverse (PE)"),
        side_rule("breakout", "5-candle breakout", sign, len(prior) == 5,
                  lambda s: (features["close"] > max(bar["high"] for bar in prior) if s > 0
                             else features["close"] < min(bar["low"] for bar in prior)),
                  "Close beyond the prior 5-candle high (CE) / low (PE)"),
        rule("relative_volume", "Relative volume", None if rvol is None else rvol >= 1.3,
             "Trigger candle volume >= 1.3x the 20-candle average", fmt(rvol, 2, "x")),
        oi_rule(features, sign),
    ]
    return dict(sign=sign, rules=rules, trigger=features["last"], seconds=60,
                risk=swing_risk(features, sign, 3) if sign else None,
                setup="Aggressive order flow driving a 5-candle breakout")


def liquidity_sweep_bos(features, live, context):
    bars, atr = features["today"], features["atr1"]
    rvol = relative_volume(bars)
    found = None
    if len(bars) >= 32:
        for offset in range(2, 12):
            index = len(bars) - offset
            reference = bars[index - 20:index]
            low, high, bar = min(b["low"] for b in reference), max(b["high"] for b in reference), bars[index]
            if bar["low"] < low and bar["close"] > low:
                found = (1, index, bar["low"])
                break
            if bar["high"] > high and bar["close"] < high:
                found = (-1, index, bar["high"])
                break
    sign = found[0] if found else 0
    last = features["last"]
    span = last["high"] - last["low"]
    internal = bars[found[1]:-1] if found else []

    def displacement(s):
        return ((last["close"] - last["open"]) * s > 0 and span > 0 and
                abs(last["close"] - last["open"]) / span >= 0.6 and span >= atr)

    rules = [
        rule("sweep", "Liquidity sweep", None if len(bars) < 32 else found is not None,
             "Within 10 same-session candles, a wick through the prior 20 same-session candle extreme that closed back inside"),
        side_rule("bos", "Break of structure", sign, bool(internal) or not found,
                  lambda s: (last["close"] > max(b["high"] for b in internal) if s > 0
                             else last["close"] < min(b["low"] for b in internal)),
                  "Close beyond the internal high (CE) / low (PE) formed since the sweep"),
        side_rule("displacement", "Displacement", sign, atr is not None, displacement,
                  "Trigger body >= 60% of range and range >= 1 ATR"),
        rule("volume", "Volume", None if rvol is None else rvol >= 1.2,
             "Trigger volume >= 1.2x the prior 20 same-session candles", fmt(rvol, 2, "x")),
        side_rule("live_hold", "Live hold", sign, live is not None,
                  lambda s: (live.price - (last["high"] + last["low"]) / 2) * s > 0,
                  "Live futures price holds beyond the trigger candle midpoint",
                  fmt(live.price if live else None)),
    ]
    risk = floor_risk(features, (features["close"] - found[2]) * sign) if found else None
    return dict(sign=sign, rules=rules, trigger=last, seconds=60, risk=risk,
                setup="Stop-run sweep reclaimed, then structure broken")


def orb_retest(features, live, context):
    today, minutes, atr = features["today"], features["today_minutes"], features["atr1"]
    opening = [bar for bar, minute in zip(today, minutes) if OPEN_MINUTE <= minute < OPEN_MINUTE + 15]
    after = [bar for bar, minute in zip(today, minutes) if minute >= OPEN_MINUTE + 15]
    complete = len(opening) == 15
    high = max(bar["high"] for bar in opening) if complete else None
    low = min(bar["low"] for bar in opening) if complete else None
    width = (high - low) / ((high + low) / 2) * 100 if complete else None
    breakout = next(((index, 1 if bar["close"] > high else -1) for index, bar in enumerate(after)
                     if bar["close"] > high or bar["close"] < low), None) if complete else None
    sign = breakout[1] if breakout else 0
    retest = None
    if breakout and atr is not None:
        level = high if sign > 0 else low
        for index in range(breakout[0] + 1, len(after) - 1):
            bar = after[index]
            touched = bar["low"] <= level + 0.25 * atr if sign > 0 else bar["high"] >= level - 0.25 * atr
            held = bar["close"] > level if sign > 0 else bar["close"] < level
            if touched and held:
                retest = (index, bar)
                break
    last = features["last"]
    rules = [
        rule("opening_range", "Opening range", None if not complete else 0.15 <= width <= 1.0,
             "All 15 opening candles (09:15-09:29) with width 0.15%-1.0%", fmt(width, 2, "%")),
        rule("breakout", "Range breakout", None if not complete else breakout is not None,
             "A completed close beyond the opening range", side_name(sign)),
        side_rule("retest", "Retest held", sign, complete and atr is not None, lambda s: retest is not None,
                  "Price returned within 0.25 ATR of the broken level and closed beyond it"),
        side_rule("resumption", "Resumption", sign, complete, lambda s: retest is not None and (
            last["close"] > retest[1]["high"] if s > 0 else last["close"] < retest[1]["low"]),
            "Close beyond the retest candle high (CE) / low (PE)"),
        vwap_rule(features, sign),
        rule("time", "Time window", minute_of_day(last["at"] + 60) < ORB_LAST_ENTRY_MINUTE,
             "Signal completes before 12:30 IST"),
    ]
    risk = None
    if retest is not None:
        extreme = retest[1]["low"] if sign > 0 else retest[1]["high"]
        risk = floor_risk(features, (features["close"] - extreme) * sign)
    return dict(sign=sign, rules=rules, trigger=last, seconds=60, risk=risk,
                setup="Opening-range breakout, retest and resumption")


def failed_breakout_reversal(features, live, context):
    bars = features["today"]
    rsi = rsi_series([bar["close"] for bar in bars])
    last = features["last"]
    found = None
    if len(bars) >= 40:
        for offset in range(2, 5):
            index = len(bars) - offset
            reference = bars[index - 30:index]
            high, low, bar = max(b["high"] for b in reference), min(b["low"] for b in reference), bars[index]
            if bar["high"] > high and last["close"] < high:
                found = (-1, index, high)
                break
            if bar["low"] < low and last["close"] > low:
                found = (1, index, low)
                break
    sign = found[0] if found else 0
    breakout = bars[found[1]] if found else None
    base = fmean(b["volume"] for b in bars[found[1] - 20:found[1]]) if found else 0
    volume_ratio = breakout["volume"] / base if found and base > 0 else None
    window = [value for value in rsi[found[1] - 2:found[1] + 1] if value is not None] if found else []

    def rsi_turn(s):
        if s < 0:
            return max(window) >= 60 and rsi[-1] <= max(window) - 5
        return min(window) <= 40 and rsi[-1] >= min(window) + 5

    rules = [
        rule("failed_break", "Failed breakout", None if len(bars) < 40 else found is not None,
             "Break of the 30-candle same-session extreme within 3 same-session candles, then a close back inside"),
        side_rule("weak_volume", "Weak breakout volume", sign, volume_ratio is not None or not found,
                  lambda s: volume_ratio <= 1.2, "Breakout candle volume <= 1.2x its prior 20 same-session candle average",
                  fmt(volume_ratio, 2, "x")),
        side_rule("rsi_turn", "RSI exhaustion", sign, (bool(window) and rsi[-1] is not None) or not found, rsi_turn,
                  "Same-session RSI >= 60 then falling 5+ (PE); <= 40 then rising 5+ (CE)", fmt(rsi[-1], 1)),
        side_rule("confirmation", "Confirmation close", sign, True,
                  lambda s: last["close"] < breakout["low"] if s < 0 else last["close"] > breakout["high"],
                  "Close beyond the breakout candle's opposite extreme"),
        side_rule("live_hold", "Level rejected live", sign, live is not None,
                  lambda s: (live.price - found[2]) * s > 0,
                  "Live futures price stays back inside the failed level", fmt(live.price if live else None)),
    ]
    risk = None
    if found:
        extreme = breakout["high"] if sign < 0 else breakout["low"]
        risk = floor_risk(features, (features["close"] - extreme) * sign)
    return dict(sign=sign, rules=rules, trigger=last, seconds=60, risk=risk,
                setup="Trapped breakout reversed back into range")


def volatility_expansion(features, live, context):
    m5, atr5 = features["m5"], features["atr5"]
    closes = [bar["close"] for bar in m5]
    ready = len(m5) >= 80
    sign, squeeze, mid, upper, lower = 0, None, None, None, None
    if ready:
        widths = []
        for index in range(len(m5) - 61, len(m5) - 1):
            window = closes[index - 19:index + 1]
            mean = fmean(window)
            widths.append(4 * math.sqrt(pvariance(window)) / mean if mean > 0 else 0.0)
        squeeze = sum(width <= widths[-1] for width in widths) / len(widths)
        window = closes[-21:-1]
        mid = fmean(window)
        deviation = math.sqrt(pvariance(window))
        upper, lower = mid + 2 * deviation, mid - 2 * deviation
        sign = 1 if closes[-1] > upper else -1 if closes[-1] < lower else 0
    last5 = m5[-1] if m5 else None
    base = fmean(bar["volume"] for bar in m5[-21:-1]) if len(m5) >= 21 else 0
    volume_ratio = last5["volume"] / base if last5 and base > 0 else None
    ema20 = features["ema20_5"]
    rules = [
        rule("squeeze", "Squeeze", None if squeeze is None else squeeze <= 0.2,
             "Pre-trigger 5m Bollinger bandwidth in the lowest 20% of the last 60", fmt(
                 None if squeeze is None else squeeze * 100, 0, " pct")),
        rule("band_break", "Band breakout", None if not ready else sign != 0,
             "5m close outside the 20-period 2-sigma band", side_name(sign)),
        side_rule("range", "Range expansion", sign, atr5 is not None and last5 is not None,
                  lambda s: last5["high"] - last5["low"] >= 1.5 * atr5, "5m range >= 1.5 ATR(5m)"),
        side_rule("volume", "Volume expansion", sign, volume_ratio is not None, lambda s: volume_ratio >= 1.5,
                  "5m volume >= 1.5x the 20-bar average", fmt(volume_ratio, 2, "x")),
        side_rule("ema_side", "EMA20 side", sign, ema20 is not None and last5 is not None,
                  lambda s: (last5["close"] - ema20) * s > 0, "5m close on the trade side of the 5m EMA20"),
    ]
    risk = floor_risk(features, abs(features["close"] - mid)) if sign and mid is not None else None
    return dict(sign=sign, rules=rules, trigger=last5, seconds=300, risk=risk,
                setup="Volatility squeeze released with volume")


EVALUATORS = {
    "adaptive_vwap_pro": adaptive_vwap_pro,
    "order_flow_momentum": order_flow_momentum,
    "liquidity_sweep_bos": liquidity_sweep_bos,
    "orb_retest": orb_retest,
    "failed_breakout_reversal": failed_breakout_reversal,
    "volatility_expansion": volatility_expansion,
}


def _shared_context(features):
    vwap, close = features["vwap"], features["close"]
    return dict(
        regime=features["regime"], volatile=features["volatile"], htf_30m=trend_label(features["htf30"]),
        structure_15m=trend_label(features["structure15"]),
        price_vs_vwap=None if vwap is None else "ABOVE" if close > vwap else "BELOW" if close < vwap else "AT",
        close=close, vwap=vwap, atr=features["atr1"], efficiency=features["er"], relative_volume=features["rvol"],
        bar_at=features["last"]["at"])


_VWAP_SIDE = ("vwap_side", "VWAP side", "Close on the trade side of session VWAP")
_OI_BUILDUP = ("oi_buildup", "Futures OI build-up",
               "Futures OI rising over 5 candles with price moving in the trade direction")
_EFFICIENCY_030 = "30-candle efficiency ratio >= 0.30"

# Each algo's own setup and entry rules, shown while live evidence is unavailable (pre-open, warm-up,
# stale feed). Kept identical to the evaluators by test_expiryedge_algos.
RULEBOOK = {
    "adaptive_vwap_pro": ("Trend pullback to VWAP / EMA20 with a 5m continuation", (
        ("htf_30m", "30m trend", "30m close beyond a rising (CE) / falling (PE) EMA9"),
        ("structure_15m", "15m structure", "15m higher highs/lows (CE) or lower highs/lows (PE)"),
        _VWAP_SIDE,
        ("pullback", "Pullback to value", "A recent 5m candle tested VWAP/EMA20 within 0.25 ATR and held"),
        ("confirmation", "Confirmation candle",
         "Last 5m candle closes in the trade direction with a body >= 50% of its range"),
        ("trigger", "5m trigger", "5m close beyond the previous 5m high (CE) / low (PE)"),
        ("regime", "Trend efficiency", _EFFICIENCY_030),
    )),
    "order_flow_momentum": ("Aggressive order flow driving a 5-candle breakout", (
        ("volume_delta", "Candle-volume pressure",
         "5-candle volume signed by candle direction >= 30% of total (a volume-pressure proxy)"),
        ("depth_imbalance", "Depth imbalance", "Live 5-level depth imbalance >= 15% toward the trade"),
        ("top_of_book", "Top of book", "Best bid quantity exceeds best ask quantity (CE) or the reverse (PE)"),
        ("breakout", "5-candle breakout", "Close beyond the prior 5-candle high (CE) / low (PE)"),
        ("relative_volume", "Relative volume", "Trigger candle volume >= 1.3x the 20-candle average"),
        _OI_BUILDUP,
    )),
    "liquidity_sweep_bos": ("Stop-run sweep reclaimed, then structure broken", (
        ("sweep", "Liquidity sweep", "Within 10 same-session candles, a wick through the prior 20 same-session candle extreme that closed back inside"),
        ("bos", "Break of structure", "Close beyond the internal high (CE) / low (PE) formed since the sweep"),
        ("displacement", "Displacement", "Trigger body >= 60% of range and range >= 1 ATR"),
        ("volume", "Volume", "Trigger volume >= 1.2x the prior 20 same-session candles"),
        ("live_hold", "Live hold", "Live futures price holds beyond the trigger candle midpoint"),
    )),
    "orb_retest": ("Opening-range breakout, retest and resumption", (
        ("opening_range", "Opening range", "All 15 opening candles (09:15-09:29) with width 0.15%-1.0%"),
        ("breakout", "Range breakout", "A completed close beyond the opening range"),
        ("retest", "Retest held", "Price returned within 0.25 ATR of the broken level and closed beyond it"),
        ("resumption", "Resumption", "Close beyond the retest candle high (CE) / low (PE)"),
        _VWAP_SIDE,
        ("time", "Time window", "Signal completes before 12:30 IST"),
    )),
    "failed_breakout_reversal": ("Trapped breakout reversed back into range", (
        ("failed_break", "Failed breakout", "Break of the 30-candle same-session extreme within 3 same-session candles, then a close back inside"),
        ("weak_volume", "Weak breakout volume", "Breakout candle volume <= 1.2x its prior 20 same-session candle average"),
        ("rsi_turn", "RSI exhaustion", "Same-session RSI >= 60 then falling 5+ (PE); <= 40 then rising 5+ (CE)"),
        ("confirmation", "Confirmation close", "Close beyond the breakout candle's opposite extreme"),
        ("live_hold", "Level rejected live", "Live futures price stays back inside the failed level"),
    )),
    "volatility_expansion": ("Volatility squeeze released with volume", (
        ("squeeze", "Squeeze", "Pre-trigger 5m Bollinger bandwidth in the lowest 20% of the last 60"),
        ("band_break", "Band breakout", "5m close outside the 20-period 2-sigma band"),
        ("range", "Range expansion", "5m range >= 1.5 ATR(5m)"),
        ("volume", "Volume expansion", "5m volume >= 1.5x the 20-bar average"),
        ("ema_side", "EMA20 side", "5m close on the trade side of the 5m EMA20"),
    )),
}


def idle_result(key, reason, context=None):
    """The algo's own rules, all pending: without live evidence nothing can pass or trade."""
    _, name, subtitle = next(algo for algo in ALGOS if algo[0] == key)
    setup, definitions = RULEBOOK[key]
    rules = [rule(rule_id, label, None, requirement) for rule_id, label, requirement in definitions]
    return dict(key=key, name=name, subtitle=subtitle, status="MONITORING", decision="WAIT", side=None,
                passed=0, total=len(rules), rules=rules, context=dict(context or {}, setup=setup, signal="WAIT"),
                trigger_at=None, trigger_seconds=None, fresh=False, levels={}, reason=reason)


def finish(key, outcome, features, now):
    _, name, subtitle = next(algo for algo in ALGOS if algo[0] == key)
    rules, sign = outcome["rules"], outcome["sign"]
    status = status_of(rules)
    trigger, seconds = outcome["trigger"], outcome["seconds"]
    trigger_at = trigger["at"] if trigger else None
    age = now - (trigger_at + seconds) if trigger_at is not None else None
    fresh = age is not None and 0 <= age <= TRIGGER_MAX_AGE
    risk = outcome["risk"]
    side = side_name(sign)
    qualified = status == "SATISFIED" and side is not None and fresh and finite(risk) and risk > 0
    passed = sum(item["passed"] is True for item in rules)
    if qualified:
        reason = f"All {len(rules)} rules passed on the latest completed candle"
    elif status == "SATISFIED":
        reason = "Rules passed on an older candle; waiting for a fresh trigger"
    else:
        pending = [item["label"] for item in rules if item["passed"] is None]
        failed = [item["label"] for item in rules if item["passed"] is False]
        reason = ("Monitoring: " + ", ".join(pending)) if pending else "Waiting for: " + ", ".join(failed)
    decision = f"BUY {side}" if qualified else "WAIT"
    close = features["close"]
    return dict(
        key=key, name=name, subtitle=subtitle, status=status, decision=decision, side=side,
        passed=passed, total=len(rules), rules=rules,
        context=dict(_shared_context(features), setup=outcome["setup"], signal=decision),
        trigger_at=trigger_at, trigger_seconds=seconds, fresh=fresh,
        levels=dict(close=close, vwap=features["vwap"], atr=features["atr1"],
                    underlying_risk=round(risk, 2) if finite(risk) else None,
                    underlying_stop=round(close - risk * sign, 2) if finite(risk) and sign else None),
        reason=reason)


def setup_key(key, symbol, evaluation):
    """One submission per algo, index, trigger candle and side."""
    return f"EXPIRYEDGE:{key}:{symbol}:{int(evaluation['trigger_at'])}:{evaluation['side']}"


class ExpiryEdgeDesk:
    """Evaluates the six active algos per symbol using shared completed-candle features."""

    def __init__(self):
        self.lock = threading.RLock()
        self.cached_features = {}
        self.results = {}

    def snapshot(self, market, symbol, now):
        today = day(now)
        with market.lock:
            engine = market.engine
            future = engine.future.get(symbol)
            if future is None:
                return None
            key = ("future", future.token, 60)
            version = (future.token, engine.book.revisions.get(key, 0), today)
            cached = self.cached_features.get(symbol)
            bars = None if cached and cached["version"] == version else list(engine.book.closed.get(key, ()))
            spot = engine.spot.get(symbol)
            recovering = False
            gaps = getattr(market, "gaps", None)
            health_lock = getattr(market, "health_lock", None)
            if isinstance(gaps, dict):
                if health_lock is None:
                    recovering = any(
                        gap.get("kind") == "future" and gap.get("symbol") == symbol and
                        (gap.get("minutes") or gap.get("resume_after") is not None)
                        for gap in gaps.values()
                    )
                else:
                    with health_lock:
                        recovering = any(
                            gap.get("kind") == "future" and gap.get("symbol") == symbol and
                            (gap.get("minutes") or gap.get("resume_after") is not None)
                            for gap in gaps.values()
                        )
            return dict(version=version, bars=bars, future=future if engine.fresh(future, now) else None,
                        spot=spot if engine.fresh(spot, now) else None, recovering=recovering)

    def features(self, symbol, snap, now):
        cached = self.cached_features.get(symbol)
        if snap["bars"] is not None or cached is None:
            bars = sorted((bar for bar in snap["bars"] or () if session(bar["at"]) and bar["at"] + 60 <= now
                           and valid_bar(bar)), key=lambda bar: bar["at"])
            features = build_features(bars, now) if len(bars) >= MIN_BARS else None
            cached = dict(version=snap["version"], features=features, count=len(bars))
            self.cached_features[symbol] = cached
        return cached

    @staticmethod
    def rate(market):
        value = getattr(getattr(market, "engine_config", None), "risk_free_rate", None)
        return value if finite(value) else 0.065

    def evaluate(self, market, symbol, now):
        """All six active algo results for one symbol; missing or stale evidence never qualifies."""
        with self.lock:
            return self._evaluate(market, symbol, now)

    def _evaluate(self, market, symbol, now):
        snap = self.snapshot(market, symbol, now)
        if snap is None:
            reason = "Waiting for the live futures feed"
            return dict(symbol=symbol, ready=False, reason=reason, context={},
                        algos={key: idle_result(key, reason) for key in ALGO_KEYS})
        cache_key = (symbol, snap["version"], int(now), snap["future"] is not None,
                     snap["spot"] is not None, snap["recovering"])
        if cache_key in self.results:
            return self.results[cache_key]
        cached = self.features(symbol, snap, now)
        features = cached["features"]
        reason = None
        if features is None:
            reason = f"Warming up: {cached['count']}/{MIN_BARS} completed one-minute futures candles"
        elif snap["recovering"]:
            reason = "Futures feed recovery in progress"
        elif day(features["last"]["at"]) != day(now) or not 0 <= now - (features["last"]["at"] + 60) <= TRIGGER_MAX_AGE:
            reason = "Awaiting a fresh completed one-minute futures candle"
        elif snap["future"] is None:
            reason = "Waiting for a fresh live futures tick"
        elif snap["spot"] is None:
            reason = "Waiting for a fresh live spot tick"
        if reason:
            context = _shared_context(features) if features else {}
            result = dict(symbol=symbol, ready=False, reason=reason, context=context,
                          algos={key: idle_result(key, reason, context) for key in ALGO_KEYS})
        else:
            context = {}
            algos = {}
            for key in ALGO_KEYS:
                try:
                    algos[key] = finish(key, EVALUATORS[key](features, snap["future"], context), features, now)
                except (ArithmeticError, AttributeError, IndexError, KeyError, TypeError, ValueError) as error:
                    algos[key] = idle_result(key, f"Rule evaluation unavailable: {type(error).__name__}",
                                             _shared_context(features))
            result = dict(symbol=symbol, ready=True, reason=None, context=_shared_context(features), algos=algos)
        self.results = {k: v for k, v in self.results.items() if k[0] != symbol}
        self.results[cache_key] = result
        return result

    def candidate(self, market, symbol, key, now, busy, costs, max_risk):
        """One-lot live option plan for a qualified algo signal; WAIT with a reason otherwise."""
        evaluation = self.evaluate(market, symbol, now)["algos"][key]
        if evaluation["decision"] not in ("BUY CE", "BUY PE"):
            return evaluation
        side = evaluation["side"]
        signal_at = evaluation["trigger_at"] + evaluation["trigger_seconds"]
        base = {**evaluation, "algo": key, "symbol": symbol, "signal_at": signal_at,
                "setup_key": setup_key(key, symbol, evaluation)}

        def wait(reason, **extra):
            return {**base, **extra, "decision": "WAIT", "reason": reason}

        with market.lock:
            engine = market.engine
            spot, future = engine.spot.get(symbol), engine.future.get(symbol)
            if not engine.fresh(spot, now) or not engine.fresh(future, now):
                return wait("Fresh spot and futures ticks are required")
            picked = engine.pick(symbol, side, now, spot, exclude=busy)
            spot_price = spot.price
        if picked is None:
            return wait(f"No fresh liquid {side} option contract is available")
        _, contract, quote = picked
        quantity = contract.lot_size
        if quote.ask_quantity < quantity:
            return wait("Option ask depth is below one lot")
        tick = contract.tick_size
        maximum = round_tick(quote.ask, tick, up=True)
        years = expiry_years(contract.expiry, now)
        model = greeks(spot_price, contract.strike, years, self.rate(market),
                       (quote.bid + quote.ask) / 2, side == "CE") if years else None
        delta = abs(model["delta"]) if model and finite(model.get("delta")) and model["delta"] != 0 else None
        delta_source = "black_scholes" if delta is not None else "atm_approximation"
        delta = delta if delta is not None else ATM_DELTA
        distance = evaluation["levels"]["underlying_risk"] * delta
        distance = min(max(distance, maximum * STOP_FLOOR), maximum * STOP_CAP)
        stop = round_tick(max(tick, maximum - distance), tick)
        target = round_tick(maximum + TARGET_R * (maximum - stop), tick, up=True)
        if not 0 < stop < maximum < target:
            return wait("Option premium cannot form valid stop/target levels")
        risk = (maximum - stop) * quantity + costs(maximum, quantity) + costs(stop, quantity)
        reward = (target - maximum) * quantity - costs(maximum, quantity) - costs(target, quantity)
        if risk > max_risk:
            return wait(f"One lot risks INR {risk:,.0f}, above the INR {max_risk:,.0f} per-trade cap",
                        estimated_risk=round(risk, 2))
        if risk <= 0 or reward / risk < MIN_REWARD_RISK:
            return wait(f"Net reward/risk after estimated costs is below {MIN_REWARD_RISK}")
        return {
            **base,
            "contract": asdict(contract),
            "entry": {"low": round_tick(quote.bid, tick), "high": maximum, "maximum": maximum, "stop": stop,
                      "target": target, "quantity": quantity, "reward_risk": round(reward / risk, 2)},
            "risk": round(risk, 2),
            "delta": round(delta, 4),
            "delta_source": delta_source,
        }
