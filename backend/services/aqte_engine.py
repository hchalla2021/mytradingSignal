"""Deterministic AQTE signals and paper simulation; no trained ML or broker calls."""

import math
from collections import defaultdict, deque
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Literal, NotRequired, TypedDict, TypeGuard
from uuid import uuid4

SYMBOLS = ("NIFTY", "BANKNIFTY", "SENSEX")
INTERVALS = (1, 5, 15, 60, 180, 300)
IST = timezone(timedelta(hours=5, minutes=30))
WARMUP_CANDLES = 201
# Opening range: VWAP/structure need 15 completed candles of today's session (first signal 09:30 IST).
SESSION_CANDLES = 15
OPEN_MINUTE, CLOSE_MINUTE = 555, 930
DEFAULT_SCALP_POINTS = {"NIFTY": (10, 20, 30), "BANKNIFTY": (20, 40, 60), "SENSEX": (30, 60, 90)}


def parse_scalp_points(text):
    """Parse 'NIFTY:10/20/30,BANKNIFTY:20/40/60'. Returns (points, errors); bad entries disable that index."""
    points, errors = {}, []
    for item in (text or "").split(","):
        if not item.strip():
            continue
        symbol, _, raw = item.partition(":")
        symbol = symbol.strip().upper()
        try:
            tiers = tuple(sorted({float(p) for p in raw.split("/") if p.strip()}))
            if symbol not in SYMBOLS or not tiers or not all(math.isfinite(p) and 0 < p <= 500 for p in tiers):
                raise ValueError
        except ValueError:
            errors.append(item.strip())
            continue
        points[symbol] = tiers
    return points, errors


def session(at: float) -> bool:
    dt = datetime.fromtimestamp(at, IST)
    return dt.weekday() < 5 and OPEN_MINUTE <= dt.hour * 60 + dt.minute < CLOSE_MINUTE


def minute_of_day(at: float) -> int:
    dt = datetime.fromtimestamp(at, IST)
    return dt.hour * 60 + dt.minute


def day(at: float) -> str:
    return datetime.fromtimestamp(at, IST).date().isoformat()


@dataclass(frozen=True)
class Tick:
    symbol: str
    kind: Literal["spot", "future", "option"]
    token: int
    price: float
    at: float
    received: float
    volume: int = 0
    bid: float = 0
    ask: float = 0
    bid_quantity: int = 0
    ask_quantity: int = 0
    buy_depth: int = 0
    sell_depth: int = 0
    oi: int | None = None

    def __post_init__(self):
        if self.oi is not None and (type(self.oi) is not int or self.oi < 0):
            raise ValueError("Invalid reported open interest")


@dataclass(frozen=True)
class Contract:
    symbol: str
    token: int
    trading_symbol: str
    exchange: str
    side: Literal["CE", "PE"]
    strike: float
    expiry: str
    lot_size: int
    tick_size: float

    def __post_init__(self):
        if self.symbol not in SYMBOLS or self.side not in ("CE", "PE") or (
            self.exchange not in ("NFO", "BFO") or self.token <= 0 or self.lot_size <= 0 or
            not math.isfinite(self.tick_size) or self.tick_size <= 0 or
            not math.isfinite(self.strike) or self.strike <= 0
        ):
            raise ValueError("Invalid option contract metadata")


@dataclass(frozen=True)
class Policy:
    capital: float = 100_000
    risk_fraction: float = 0.005
    daily_loss: float = 2_000
    max_trades: int = 5
    max_losses: int = 3
    stale_seconds: float = 5
    spread_fraction: float = 0.03
    order_lifetime: float = 30
    cooldown: float = 300
    # Conservative configurable simulation estimates, not a statutory tax quote.
    brokerage_per_order: float = 20
    turnover_cost_fraction: float = 0.0015
    slippage_ticks: int = 1
    # Quick-scalp targets in option premium points; stop = target x ratio.
    scalp_points: dict = field(default_factory=lambda: dict(DEFAULT_SCALP_POINTS))
    scalp_stop_ratio: float = 0.4
    # ATM option delta and the futures one-minute ATR multiple a target must be reachable within.
    scalp_delta: float = 0.5
    scalp_atr_reach: float = 4


class Candle(TypedDict):
    at: float
    open: float
    high: float
    low: float
    close: float
    volume: int
    oi: NotRequired[int | None]


class RuleCheck(TypedDict):
    id: str
    label: str
    passed: bool | None
    requirement: str
    reason: str


class CandleBook:
    def __init__(self):
        self.closed: defaultdict[tuple[str, int, int], deque[Candle]] = defaultdict(lambda: deque(maxlen=600))
        self.current: dict[tuple[str, int, int], Candle] = {}
        self.previous: dict[tuple[str, int], Tick] = {}

    def add(self, tick: Tick):
        key = (tick.kind, tick.token)
        previous = self.previous.get(key)
        if previous and (tick.at < previous.at or tick.received <= previous.received):
            return False
        volume = max(0, tick.volume - previous.volume) if previous and day(previous.at) == day(tick.at) else 0
        self.previous[key] = tick
        for seconds in INTERVALS:
            bucket = int(tick.at // seconds) * seconds
            k = (*key, seconds)
            bar = self.current.get(k)
            if bar and bar["at"] != bucket:
                # Gaps are retained explicitly; never fabricate empty candles.
                # A minute already filled from exchange history is not appended twice.
                if not self.closed[k] or self.closed[k][-1]["at"] < bar["at"]:
                    self.closed[k].append(bar)
                bar = None
            if bar is None:
                bar = Candle(at=bucket, open=tick.price, high=tick.price,
                             low=tick.price, close=tick.price, volume=0)
                self.current[k] = bar
            bar.update(high=max(bar["high"], tick.price), low=min(bar["low"], tick.price),
                       close=tick.price, volume=bar["volume"] + volume, oi=tick.oi)
        return True


def ema(values, length):
    value = sum(values[:length]) / length
    for price in values[length:]:
        value += 2 / (length + 1) * (price - value)
    return value


def warmup_count(bars, at):
    """Contiguous completed regular-session candles ending one minute before `at`.

    The close-to-open gap between sessions is not missing data; an intraday missing minute is.
    """
    expected = int(at // 60) * 60 - 60
    completed = 0
    for bar in reversed(bars):
        if completed == WARMUP_CANDLES:
            break
        if not OPEN_MINUTE <= minute_of_day(bar["at"]) < CLOSE_MINUTE:
            continue
        if bar["at"] != expected and not (
            minute_of_day(expected) < OPEN_MINUTE and minute_of_day(bar["at"]) == CLOSE_MINUTE - 1
            and bar["at"] < expected and day(bar["at"]) < day(expected)
        ):
            break
        completed += 1
        expected = bar["at"] - 60
    return completed


def session_bars(bars, at):
    today = day(at)
    return [b for b in bars if day(b["at"]) == today and session(b["at"])]


def intelligence(bars: Sequence[Candle], tick: Tick, previous_day=None):
    """Use completed one-minute futures bars; indicators span sessions, VWAP is today's only."""
    today = session_bars(bars, tick.at)
    if warmup_count(bars, tick.at) < WARMUP_CANDLES or warmup_count(today, tick.at) < SESSION_CANDLES:
        return None
    session_volume = sum(b["volume"] for b in today)
    vwap = sum((b["high"] + b["low"] + b["close"]) / 3 * b["volume"] for b in today) / session_volume if session_volume else None
    bars = [b for b in bars if session(b["at"])][-WARMUP_CANDLES:]
    closes = [b["close"] for b in bars]
    averages = {str(n): ema(closes, n) for n in (9, 20, 50, 100, 200)}
    differences = [b - a for a, b in zip(closes, closes[1:])]
    gain = sum(max(0, d) for d in differences[:14]) / 14
    loss = sum(max(0, -d) for d in differences[:14]) / 14
    ranges = [max(b["high"] - b["low"], abs(b["high"] - a["close"]),
                  abs(b["low"] - a["close"])) for a, b in zip(bars, bars[1:])]
    atr = sum(ranges[:14]) / 14
    upper = lower = trend = None
    for i, (delta, tr) in enumerate(zip(differences, ranges)):
        if i >= 14:
            gain = (gain * 13 + max(0, delta)) / 14
            loss = (loss * 13 + max(0, -delta)) / 14
            atr = (atr * 13 + tr) / 14
        if i < 13:
            continue
        b, prior = bars[i + 1], bars[i]
        midpoint = (b["high"] + b["low"]) / 2
        raw_upper, raw_lower = midpoint + 3 * atr, midpoint - 3 * atr
        next_upper = raw_upper if upper is None or raw_upper < upper or prior["close"] > upper else upper
        next_lower = raw_lower if lower is None or raw_lower > lower or prior["close"] < lower else lower
        if trend is None:
            trend = 1 if b["close"] >= midpoint else -1
        elif trend == -1 and b["close"] > next_upper:
            trend = 1
        elif trend == 1 and b["close"] < next_lower:
            trend = -1
        upper, lower = next_upper, next_lower
    depth = tick.buy_depth + tick.sell_depth
    imbalance = (tick.buy_depth - tick.sell_depth) / depth if depth else None
    prior = bars[-21:-1]
    high, low = max(b["high"] for b in prior), min(b["low"] for b in prior)
    last = bars[-1]
    avg_volume = sum(b["volume"] for b in prior) / len(prior)
    oi_reference = last.get("oi") if day(last["at"]) == day(tick.at) else None
    oi_change = tick.oi - oi_reference if tick.oi is not None and oi_reference is not None else None
    cpr = None
    if previous_day:
        pivot = sum(previous_day[k] for k in ("high", "low", "close")) / 3
        base = (previous_day["high"] + previous_day["low"]) / 2
        cpr = {"pivot": pivot, "bottom": min(base, 2 * pivot - base), "top": max(base, 2 * pivot - base)}
    return {
        "ema": averages, "rsi": 100 - 100 / (1 + gain / loss) if loss else (100 if gain else 50),
        "atr": atr, "vwap": vwap, "supertrend": "BULLISH" if trend == 1 else "BEARISH",
        "supertrend_price": lower if trend == 1 else upper, "cpr": cpr,
        "imbalance": imbalance, "volume_ratio": last["volume"] / avg_volume if avg_volume else None,
        "volume": last["volume"], "average_volume": avg_volume,
        "breakout_high": high, "breakout_low": low,
        "breakout": 1 if last["close"] > high else (-1 if last["close"] < low else 0),
        "sweep": 1 if last["low"] < low < last["close"] else (
            -1 if last["high"] > high > last["close"] else 0),
        "structure": "HIGHER_HIGH" if last["close"] > high else (
            "LOWER_LOW" if last["close"] < low else "RANGE"),
        "close": last["close"], "at": last["at"],
        "live": {
            "token": tick.token, "at": tick.at, "received": tick.received, "price": tick.price,
            "buy_depth": tick.buy_depth, "sell_depth": tick.sell_depth, "oi": tick.oi,
            "oi_reference": oi_reference,
            "oi_reference_at": last["at"] + 60 if oi_reference is not None else None,
            "oi_change": oi_change,
            "oi_change_pct": oi_change / oi_reference * 100 if oi_change is not None and oi_reference else None,
        },
    }


def finite_number(value: object) -> TypeGuard[int | float]:
    return isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value)


def scalp_bias(info: Mapping[str, object]) -> Literal["CE", "PE"] | None:
    raw_ema = info.get("ema")
    e = raw_ema if isinstance(raw_ema, Mapping) else {}
    price, vwap, fast, slow = info.get("close"), info.get("vwap"), e.get("9"), e.get("20")
    if not (finite_number(price) and finite_number(vwap) and finite_number(fast) and finite_number(slow)):
        return None
    if min(price, vwap, fast, slow) <= 0:
        return None
    return "CE" if price > vwap and fast > slow else "PE" if price < vwap and fast < slow else None


def directional_checks(info: Mapping[str, object] | None, side: Literal["CE", "PE"] | None,
                       style: Literal["scalp", "swing"]) -> list[RuleCheck]:
    """One source for live entry gates and their display; null means evidence/direction unavailable."""
    if style not in ("scalp", "swing") or side not in ("CE", "PE", None):
        raise ValueError("Unknown rule style or direction")
    info = info or {}
    sign = 1 if side == "CE" else -1 if side == "PE" else 0
    scalping = style == "scalp"
    periods = (9, 20) if scalping else (9, 20, 50, 100, 200)
    raw_ema = info.get("ema")
    e = raw_ema if isinstance(raw_ema, Mapping) else {}
    raw_averages = [e.get(str(n)) for n in periods]
    averages = [value for value in raw_averages if finite_number(value) and value > 0]
    price, vwap, atr = (info.get(key) for key in ("close", "vwap", "atr"))
    rsi, volume, imbalance = (info.get(key) for key in ("rsi", "volume_ratio", "imbalance"))
    trend, breakout = info.get("supertrend"), info.get("breakout")
    checks: list[RuleCheck] = []

    def add(key: str, label: str, passed: bool | None, requirement: str, reason: str) -> None:
        checks.append(RuleCheck(id=key, label=label, passed=passed, requirement=requirement, reason=reason))

    ema_valid = len(averages) == len(periods)
    add("ema", "EMA " + "/".join(map(str, periods)),
        all(sign * (a - b) > 0 for a, b in zip(averages, averages[1:])) if sign and ema_valid else None,
        "Ascending for CE; descending for PE", "EMA " + "/".join(map(str, periods)) + " are not directionally aligned")
    add("vwap", "Session VWAP",
        sign * (price - vwap) > 0 if sign and finite_number(price) and price > 0 and finite_number(vwap) and vwap > 0 else None,
        "Closed candle above VWAP for CE; below for PE", "Price vs VWAP does not confirm")
    add("supertrend", "SuperTrend (14, 3)",
        trend == ("BULLISH" if sign > 0 else "BEARISH") if sign and trend in ("BULLISH", "BEARISH") else None,
        "Bullish for CE; bearish for PE", "SuperTrend not aligned")
    # Breakout and scalp use the momentum evaluator's band; exhaustion still blocks.
    lower, upper = (55, 80) if sign > 0 else (20, 45)
    add("rsi", "RSI (14)", lower <= rsi <= upper if sign and finite_number(rsi) and 0 <= rsi <= 100 else None,
        "CE 55-80; PE 20-45",
        "RSI outside scalp momentum band" if scalping else "RSI outside swing momentum band")
    if not scalping:
        raw_cpr = info.get("cpr")
        cpr = raw_cpr if isinstance(raw_cpr, Mapping) else {}
        level = cpr.get("top" if sign > 0 else "bottom")
        add("cpr", "Previous-day spot CPR",
            sign * (price - level) > 0 if sign and finite_number(price) and price > 0 and finite_number(level) and level > 0 else None,
            "Above spot CPR top for CE; below bottom for PE", "Contextual CPR does not confirm")
    if scalping:
        add("breakout", "20-candle breakout",
            breakout == sign if sign and finite_number(breakout) and breakout in (-1, 0, 1) else None,
            "Close above prior high for CE; below prior low for PE", "No fresh 20-candle breakout")
    add("volume", "Relative volume (20)", volume >= 1.5 if finite_number(volume) and volume >= 0 else None,
        "Completed minute / prior 20-minute average >= 1.5x", "Breakout volume below 1.5x")
    threshold = 0.10 if scalping else BOOK_CONFIRM
    add("imbalance", "Book imbalance (top 5)",
        sign * imbalance >= threshold if sign and finite_number(imbalance) and -1 <= imbalance <= 1 else None,
        f">= +{threshold:.0%} for CE; <= -{threshold:.0%} for PE", "Order-book imbalance does not confirm")
    if scalping:
        ema20 = e.get("20")
        add("extension", "EMA20 extension",
            abs(price - ema20) <= 2 * atr if finite_number(price) and price > 0 and finite_number(ema20) and ema20 > 0
            and finite_number(atr) and atr > 0 else None,
            "Within 2 ATR of EMA20; never chase", "Price extended more than 2 ATR from EMA 20; no chasing")
    else:
        add("breakout", "20-candle breakout",
            breakout == sign if sign and finite_number(breakout) and breakout in (-1, 0, 1) else None,
            "Close above prior high for CE; below prior low for PE", "No fresh 20-candle breakout")
        structure = info.get("structure")
        add("structure", "20-candle structure",
            structure == ("HIGHER_HIGH" if sign > 0 else "LOWER_LOW") if sign
            and structure in ("HIGHER_HIGH", "LOWER_LOW", "RANGE") else None,
            "Higher high for CE; lower low for PE", "Market structure does not confirm")
    return checks


SWING_SETUPS = ("momentum_breakout", "trend_continuation", "liquidity_reversal", "mean_reversion")
# Every passing swing gate earns the book bonus and can clear the default 75 floor.
SETUP_BASE_SCORES = {"momentum_breakout": 75, "liquidity_reversal": 72, "trend_continuation": 71,
                     "mean_reversion": 70}
BOOK_BONUS, BOOK_CONFIRM = 5, 0.15
# The basic passing scalp clears 75; only three reachable tiers score 80.
SCALP_TIER_SCORES = (75, 78, 80)
SETUP_LABELS = {"momentum_breakout": "Momentum breakout", "trend_continuation": "Trend continuation",
                "liquidity_reversal": "Liquidity-sweep reversal", "mean_reversion": "Mean reversion"}


def setup_checks(info: Mapping[str, object] | None, side: Literal["CE", "PE"] | None,
                 setup: str | None) -> list[RuleCheck]:
    """Live entry gate of one swing setup; every check must pass.

    A breakout keeps the full nine-check swing gate. The other setups need their own evidence because a
    pullback, a sweep-and-reclaim or a VWAP reversion can never also be a fresh trend-aligned breakout.
    """
    swing = directional_checks(info, side, "swing")
    if setup in (None, "momentum_breakout"):
        return swing
    if setup not in SWING_SETUPS:
        raise ValueError("Unknown swing setup")
    info = info or {}
    shared = {check["id"]: check for check in swing}
    sign = 1 if side == "CE" else -1 if side == "PE" else 0
    raw_ema = info.get("ema")
    e = raw_ema if isinstance(raw_ema, Mapping) else {}
    price, vwap, atr = (info.get(key) for key in ("close", "vwap", "atr"))
    rsi, volume, structure = info.get("rsi"), info.get("volume_ratio"), info.get("structure")
    raw_live = info.get("live")
    live = raw_live.get("price") if isinstance(raw_live, Mapping) else None
    rsi_ok = finite_number(rsi) and 0 <= rsi <= 100
    checks: list[RuleCheck] = []

    def positive(*values: object) -> bool:
        return all(finite_number(value) and value > 0 for value in values)

    def add(key: str, label: str, passed: bool | None, requirement: str, reason: str) -> None:
        checks.append(RuleCheck(id=key, label=label, passed=passed, requirement=requirement, reason=reason))

    def add_volume(minimum: float, label: str) -> None:
        add("volume", label, volume >= minimum if finite_number(volume) and volume >= 0 else None,
            f"Completed minute / prior 20-minute average >= {minimum:g}x", f"Volume below {minimum:g}x average")

    if setup == "trend_continuation":
        ema9, ema20 = e.get("9"), e.get("20")
        checks += [shared["ema"], shared["vwap"], shared["supertrend"]]
        add("rsi", "RSI (14)", (50 <= rsi <= 70 if sign > 0 else 30 <= rsi <= 50) if sign and rsi_ok else None,
            "CE 50-70; PE 30-50 (trend pullback band)", "RSI outside trend-pullback band")
        checks.append(shared["cpr"])
        add("pullback", "Pullback to EMA20", abs(price - ema20) <= atr if positive(price, ema20, atr) else None,
            "Closed within 1 ATR of EMA20", "Not a pullback: more than 1 ATR from EMA20")
        add("resume", "Pullback resuming", sign * (price - ema9) > 0 if sign and positive(price, ema9) else None,
            "Closed back above EMA9 for CE; below for PE", "Pullback not resuming past EMA9")
        add("structure", "20-candle structure",
            structure != ("LOWER_LOW" if sign > 0 else "HIGHER_HIGH")
            if sign and structure in ("HIGHER_HIGH", "LOWER_LOW", "RANGE") else None,
            "No opposite 20-candle extreme", "Opposite 20-candle extreme; trend broken")
        add_volume(1.0, "Resumption volume (20)")
        checks.append(shared["imbalance"])
    elif setup == "liquidity_reversal":
        sweep = info.get("sweep")
        stack = [e.get(str(n)) for n in (9, 20, 50, 100, 200)]
        add("sweep", "Liquidity sweep and reclaim",
            sweep == sign if sign and finite_number(sweep) and sweep in (-1, 0, 1) else None,
            "Wick through prior 20-candle low for CE (high for PE), close back inside",
            "No liquidity sweep in this direction")
        add("trend_filter", "No opposing EMA 9-200 stack",
            not all(-sign * (a - b) > 0 for a, b in zip(stack, stack[1:])) if sign and positive(*stack) else None,
            "Never fade a fully stacked opposite trend", "Fully stacked opposite trend; no reversal")
        add("rsi", "RSI (14)", (rsi < 70 if sign > 0 else rsi > 30) if sign and rsi_ok else None,
            "CE below 70; PE above 30 (not exhausted)", "RSI exhausted in the reversal direction")
        add_volume(1.5, "Sweep volume (20)")
        checks.append(shared["imbalance"])
        add("confirm", "Live reclaim holding", sign * (live - price) >= 0 if sign and positive(live, price) else None,
            "Live futures not giving back the reclaim", "Live futures gave back the reclaim")
    else:
        four = [e.get(str(n)) for n in (9, 20, 50, 200)]
        add("stretch", "Stretch from VWAP", sign * (vwap - price) > 2 * atr if sign and positive(price, vwap, atr) else None,
            "More than 2 ATR below VWAP for CE; above for PE", "Not stretched 2 ATR from VWAP")
        add("rsi", "RSI (14)", (rsi < 30 if sign > 0 else rsi > 70) if sign and rsi_ok else None,
            "CE below 30; PE above 70 (extreme)", "RSI not at an extreme")
        add("range", "Non-trending market",
            not any(all(d * (a - b) > 0 for a, b in zip(four, four[1:])) for d in (1, -1)) if positive(*four) else None,
            "No EMA 9/20/50/200 stack either way", "Trending market; no mean reversion")
        add_volume(1.5, "Climax volume (20)")
        checks.append(shared["imbalance"])
        add("turn", "Live turn toward VWAP", sign * (live - price) > 0 if sign and positive(live, price) else None,
            "Live futures moving back toward VWAP", "No live turn toward VWAP yet")
    return checks


def strategy_candidates(info):
    """Swing setups present on this closed candle as (name, side, score), highest base rule score first."""
    if not finite_number(info.get("volume_ratio")):
        return []
    e, price = info["ema"], info["close"]
    direction = 1 if e["9"] > e["20"] > e["50"] > e["200"] else (
        -1 if e["9"] < e["20"] < e["50"] < e["200"] else 0)
    candidates = []
    if info["sweep"]:
        candidates.append(("liquidity_reversal", info["sweep"]))
    if info["breakout"] and info["volume_ratio"] >= 1.2:
        candidates.append(("momentum_breakout", info["breakout"]))
    if direction and abs(price - e["20"]) <= info["atr"]:
        candidates.append(("trend_continuation", direction))
    if not direction and info["vwap"] and abs(price - info["vwap"]) > 2 * info["atr"]:
        if info["rsi"] < 30:
            candidates.append(("mean_reversion", 1))
        elif info["rsi"] > 70:
            candidates.append(("mean_reversion", -1))
    if not candidates or info["imbalance"] is None or info["vwap"] is None or info["atr"] <= 0:
        return []
    candidates = [(name, side) for name, side in candidates if side * info["imbalance"] >= -BOOK_CONFIRM]
    candidates.sort(key=lambda candidate: SETUP_BASE_SCORES[candidate[0]], reverse=True)
    return [(name, "CE" if side > 0 else "PE",
             SETUP_BASE_SCORES[name] + (BOOK_BONUS if side * info["imbalance"] >= BOOK_CONFIRM else 0))
            for name, side in candidates]


def swing_setups(info):
    """Every swing setup on this candle, best rule score first, with its own entry-gate checks and verdict."""
    setups = []
    for name, side, score in strategy_candidates(info):
        checks = setup_checks(info, side, name)
        setups.append(dict(name=name, side=side, score=score, checks=checks,
                           passed=all(check["passed"] is True for check in checks)))
    return setups


def best_setup(setups):
    """Highest-scored setup whose own gate passes; otherwise the highest-scored (blocked) one."""
    return next((setup for setup in setups if setup["passed"]), setups[0] if setups else None)


def strategy(info):
    best = best_setup(swing_setups(info))
    return (best["name"], best["side"], best["score"]) if best else None


def scalp(info, points, delta=0.5, reach=4):
    """Quick-scalp rules: VWAP/EMA bias, fresh breakout with volume and order flow, not extended.

    Returns ({side, points, score}, None) where `points` are the eligible premium-point targets
    (ascending, capped by signal strength and by what the futures ATR can reach), or (None, reason).
    """
    try:
        e, price, atr, vwap = info["ema"], info["close"], info["atr"], info["vwap"]
        if not finite_number(vwap) or not finite_number(info["imbalance"]) or not finite_number(atr) or atr <= 0 or not points:
            return None, "Scalp needs VWAP, order-book depth and ATR"
        if not all(finite_number(v) and v > 0 for v in (price, e["9"], e["20"])):
            return None, "Incomplete market intelligence"
        direction = scalp_bias(info)
        if not direction:
            return None, "No scalp bias: price vs VWAP and EMA 9/20 disagree"
        side = 1 if direction == "CE" else -1
        for check in directional_checks(info, direction, "scalp"):
            if check["passed"] is not True:
                return None, check["reason"] if check["passed"] is False else "Incomplete market intelligence"
        strength = 1
        if side * (e["20"] - e["50"]) > 0 and info["volume_ratio"] >= 2 and side * info["imbalance"] >= 0.2:
            strength = 2
            cpr = info["cpr"]
            if (side * (e["50"] - e["100"]) > 0 and side * (e["100"] - e["200"]) > 0 and info["volume_ratio"] >= 2.5
                    and cpr is not None and side * (price - cpr["top" if side > 0 else "bottom"]) > 0
                    and info["structure"] == ("HIGHER_HIGH" if side > 0 else "LOWER_LOW")):
                strength = 3
        ordered = sorted(float(p) for p in points)
        reachable = [p for p in ordered if p <= delta * atr * reach][:strength]
        if not reachable:
            return None, f"Market too quiet for a {ordered[0]:g}-point scalp (ATR {atr:.1f})"
    except (KeyError, TypeError, ValueError):
        return None, "Incomplete market intelligence"
    return dict(side="CE" if side > 0 else "PE", points=reachable, score=SCALP_TIER_SCORES[len(reachable) - 1]), None


def round_tick(price, tick_size, up=False):
    units = price / tick_size
    return round((math.ceil(units - 1e-8) if up else math.floor(units + 1e-8)) * tick_size, 8)


class AQTEEngine:
    def __init__(self, policy=None, *, paper_enabled=True, research_only=False):
        if research_only and paper_enabled:
            raise ValueError("Research signal-only mode requires paper_enabled=False")
        self.policy = policy or Policy()
        self.paper_enabled = paper_enabled
        self.research_only = research_only
        self.book = CandleBook()
        self.contracts: dict[int, Contract] = {}
        self.spot: dict[str, Tick] = {}
        self.future: dict[str, Tick] = {}
        self.options: dict[int, Tick] = {}
        self.previous_day = {}
        self.signals = {}
        self.orders = {}
        self.trades = []
        self.events = []
        self.last_setup = {}
        self.killed = False
        self.fault = None

    def event(self, kind, at, **payload):
        self.events.append(dict(id=uuid4().hex, kind=kind, at=at, **payload))

    def fresh(self, tick, now):
        return tick is not None and 0 <= now - tick.at <= self.policy.stale_seconds and (
            0 <= now - tick.received <= self.policy.stale_seconds)

    def feed_reason(self, symbol, now):
        stale = [f"{name} " + ("no ticks yet" if tick is None else f"last tick {max(0, now - tick.received):.0f}s ago")
                 for name, tick in (("futures", self.future.get(symbol)), ("spot", self.spot.get(symbol)))
                 if not self.fresh(tick, now)]
        return "Market data stale: " + "; ".join(stale) if stale else None

    def pick(self, symbol, side, now, spot, exclude=()):
        """Nearest-strike fresh, liquid, tight-spread option of the requested side."""
        candidates = []
        for contract in self.contracts.values():
            if contract.symbol != symbol or contract.side != side or contract.expiry < day(now) or (
                contract.token in exclude
            ):
                continue
            quote = self.options.get(contract.token)
            if not self.fresh(quote, now) or not 0 < quote.bid <= quote.ask or quote.ask_quantity < contract.lot_size:
                continue
            spread = quote.ask - quote.bid
            if spread / quote.ask > self.policy.spread_fraction or quote.volume <= 0:
                continue
            candidates.append((abs(contract.strike - spot.price), spread, contract, quote))
        if not candidates:
            return None
        _, spread, contract, quote = min(candidates, key=lambda x: x[:2])
        return spread, contract, quote

    @staticmethod
    def idle_scalp(reason):
        return dict(decision="WAIT", strategy=None, confidence=None, contract=None, entry=None,
                    reasons=[reason] if reason else [])

    def scalp_signal(self, symbol, info, now, spot):
        """Quick-scalp sub-signal with premium-point target/stop; never creates paper orders."""
        setup, reason = scalp(info, self.policy.scalp_points.get(symbol, ()),
                              self.policy.scalp_delta, self.policy.scalp_atr_reach)
        result = self.idle_scalp(reason)
        if setup is None:
            return result
        picked = self.pick(symbol, setup["side"], now, spot)
        if picked is None:
            result["reasons"] = ["No fresh liquid option contract with valid lot size and bid/ask depth"]
            return result
        _, contract, quote = picked
        ratio = self.policy.scalp_stop_ratio
        # A scalp must fill now: IOC limit at the current ask, never above it.
        limit = round_tick(quote.ask, contract.tick_size, up=True)
        quantity = contract.lot_size
        for points in reversed(setup["points"]):
            stop = round_tick(limit - points * ratio, contract.tick_size)
            target = round_tick(limit + points, contract.tick_size, up=True)
            if not 0 < stop < limit < target:
                result["reasons"] = [f"Premium too small for a {points:g}-point scalp stop"]
                continue
            risk = (limit - stop) * quantity + self.costs(limit, quantity) + self.costs(stop, quantity)
            reward = (target - limit) * quantity - self.costs(limit, quantity) - self.costs(target, quantity)
            if reward / risk >= 1.5:
                break
            result["reasons"] = [f"{points:g}-point scalp reward/risk after estimated costs is below 1.5"]
        else:
            return result
        result.update(
            decision=f'BUY {setup["side"]}', strategy=f"quick_scalp_{points:g}", confidence=setup["score"],
            contract=asdict(contract),
            entry=dict(low=round_tick(quote.bid, contract.tick_size), high=limit, maximum=limit, stop=stop,
                       target=target, quantity=quantity, reward_risk=round(reward / risk, 2), points=points,
                       points_allowed=setup["points"], stop_ratio=ratio),
            reasons=[f"Quick scalp: target +{points:g} / stop -{points * ratio:g} premium points",
                     f"RSI {info['rsi']:.1f}; volume {info['volume_ratio']:.2f}x; ATR {info['atr']:.1f}",
                     "IOC limit capped at the signal's ask; never chases a higher ask",
                     "Rule score is not a calibrated probability"])
        return result

    def costs(self, price, quantity):
        return self.policy.brokerage_per_order + price * quantity * self.policy.turnover_cost_fraction

    def position_metrics(self, order, now, healthy=True):
        quote = self.options.get(order["token"])
        quantity = order["quantity"]
        entered = order["entry_price"] is not None and order["entry_price"] > 0 and quantity > 0
        fresh = healthy and self.fresh(quote, now)
        marked = entered and fresh and 0 < quote.bid <= quote.ask and quote.bid_quantity >= quantity
        points = quote.bid - order["entry_price"] if marked else None
        gross = points * quantity if marked else None
        net = gross - order["entry_cost"] - self.costs(quote.bid, quantity) if marked else None
        return dict(
            quantity=quantity, quote_at=quote.at if quote else None, stale=not fresh,
            ltp=quote.price if fresh else None, bid=quote.bid if marked else None,
            points=round(points, 2) if marked else None,
            gross_pnl=round(gross, 2) if marked else None,
            net_pnl=round(net, 2) if marked else None,
            return_pct=round(points / order["entry_price"] * 100, 2) if marked else None,
            peak_points=round(max(0, order["peak"] - order["entry_price"]), 2) if entered else None,
            stop_points=round(order["stop"] - order["entry_price"], 2) if entered else None,
        )

    def daily(self, now):
        closed = [t for t in self.trades if day(t["exit_at"]) == day(now)]
        pnl = sum(t["net_pnl"] for t in closed)
        losses = 0
        for trade in reversed(closed):
            if trade["net_pnl"] >= 0:
                break
            losses += 1
        entries = sum(day(t["entry_at"]) == day(now) for t in self.trades)
        entries += sum(o["entry_at"] is not None and day(o["entry_at"]) == day(now) for o in self.orders.values())
        return dict(realized_pnl=round(pnl, 2), trades=entries, consecutive_losses=losses)

    def risk_reason(self, now):
        daily = self.daily(now)
        if self.fault:
            return self.fault
        if self.killed:
            return "Emergency kill switch active"
        if not session(now):
            return "Outside regular market session"
        if datetime.fromtimestamp(now, IST).hour * 60 + datetime.fromtimestamp(now, IST).minute >= 915:
            return "No new entries after 15:15 IST"
        equity = self.mark_to_market(now)
        if equity is None:
            return "Open position quote stale; new entries blocked"
        if equity <= -self.policy.daily_loss:
            return "Daily loss limit reached"
        if daily["trades"] >= self.policy.max_trades:
            return "Maximum daily trades reached"
        if daily["consecutive_losses"] >= self.policy.max_losses:
            return "Consecutive-loss limit reached"
        return None

    def mark_to_market(self, now):
        equity = self.daily(now)["realized_pnl"]
        for order in self.orders.values():
            if order["entry_at"] is not None:
                quote = self.options.get(order["token"])
                if not self.fresh(quote, now) or not 0 < quote.bid <= quote.ask:
                    return None
                equity += (quote.bid - order["entry_price"]) * order["quantity"] - order["entry_cost"]
                equity -= self.costs(quote.bid, order["quantity"])
        return equity

    def ingest(self, tick: Tick):
        numeric = (tick.price, tick.at, tick.received, tick.bid, tick.ask)
        if tick.symbol not in SYMBOLS or not all(math.isfinite(n) for n in numeric) or tick.price <= 0:
            raise ValueError("Invalid AQTE tick")
        if any(type(n) is not int or n < 0 for n in
               (tick.volume, tick.bid_quantity, tick.ask_quantity, tick.buy_depth, tick.sell_depth)):
            raise ValueError("Invalid AQTE volume or order-book quantity")
        if not self.fresh(tick, tick.received):
            self.event("REJECTED_TICK", tick.received, token=tick.token, reason="Stale/future exchange timestamp")
            return
        if not self.book.add(tick):
            return
        if tick.kind == "spot":
            self.spot[tick.symbol] = tick
        elif tick.kind == "future":
            old = self.future.get(tick.symbol)
            if old and old.token != tick.token:
                self.signals.pop(tick.symbol, None)
            self.future[tick.symbol] = tick
        else:
            previous = self.options.get(tick.token)
            if previous and tick.at - previous.at > self.policy.stale_seconds:
                self.event("OPTION_DATA_GAP", tick.received, token=tick.token,
                           seconds=tick.at - previous.at, reason="No simulated fills during the gap")
            self.options[tick.token] = tick
        self.manage(tick.received, tick if tick.kind == "option" else None)
        if tick.kind == "future":
            self.analyze(tick.symbol, tick.received)

    def analyze(self, symbol, now):
        live_rules = not self.paper_enabled and not self.research_only
        reason = self.risk_reason(now)
        future, spot = self.future.get(symbol), self.spot.get(symbol)
        if not self.fresh(future, now) or not self.fresh(spot, now):
            reason = reason or "Waiting for fresh spot and futures ticks"
        bars = list(self.book.closed[("future", future.token, 60)]) if future else []
        completed = warmup_count(bars, future.at) if future else 0
        opening = warmup_count(session_bars(bars, future.at), future.at) if future else 0
        info = intelligence(bars, future, self.previous_day.get(symbol)) if future else None
        if info is None:
            reason = reason or (
                f"Warming up: need {WARMUP_CANDLES} contiguous completed one-minute futures candles"
                if completed < WARMUP_CANDLES else
                f"Opening range: need {SESSION_CANDLES} completed one-minute candles from 09:15 IST")
        signal = dict(symbol=symbol, decision="WAIT", reasons=[reason] if reason else [],
                      confidence=None, intelligence=info, contract=None, entry=None, at=now,
                      model="explainable-rules-v1", model_validated=False,
                      warmup=dict(completed=completed, required=WARMUP_CANDLES),
                      opening=dict(completed=min(opening, SESSION_CANDLES), required=SESSION_CANDLES),
                      scalp=self.idle_scalp(reason), rule_checks=None, setups=[])
        self.signals[symbol] = signal
        setups = swing_setups(info) if info else []
        best = best_setup(setups)
        setup = (best["name"], best["side"], best["score"]) if best else None
        if info:
            scalp_side = scalp_bias(info)
            swing_side = ("CE" if setup[1] == "CE" else "PE") if setup else None
            swing_name = setup[0] if setup else None
            signal["rule_checks"] = {
                "scalp": dict(side=scalp_side, checks=directional_checks(info, scalp_side, "scalp")),
                "swing": dict(side=swing_side, setup=swing_name,
                              checks=best["checks"] if best else setup_checks(info, None, None)),
            }
            # Every setup on this candle with its own checks; the live controller (and the UI, mirroring it)
            # may trade an enabled same-side alternative.
            signal["setups"] = setups
        if reason:
            return
        signal["scalp"] = self.scalp_signal(symbol, info, now, spot)
        if not setup:
            signal["reasons"] = ["No confirmed strategy with volume and order-book support"]
            return
        name, side, confidence = setup
        signal.update(strategy=name, confidence=confidence)
        if live_rules and best["passed"] is not True:
            signal["reasons"] = [
                f'{SETUP_LABELS[name]}: {check["reason"]}'
                for check in best["checks"] if check["passed"] is not True
            ]
            return
        picked = self.pick(symbol, side, now, spot)
        if picked is None:
            signal["reasons"] = ["No fresh liquid option contract with valid lot size and bid/ask depth"]
            return
        spread, contract, quote = picked
        # Offline research/paper use a midpoint cap; live uses a marketable, no-chase ask cap.
        limit = round_tick(quote.ask, contract.tick_size, up=True) if live_rules else (
            round_tick((quote.bid + quote.ask) / 2, contract.tick_size))
        distance = max(limit * 0.2, spread * 3, contract.tick_size * 4)
        stop = round_tick(max(contract.tick_size, limit - distance), contract.tick_size)
        target = round_tick(limit + 2 * (limit - stop), contract.tick_size, up=True)
        if not 0 < stop < limit < target:
            signal["reasons"] = ["Premium too small for a valid tick-aligned entry and stop"]
            return
        quantity = contract.lot_size
        fees = self.costs(limit, quantity) + self.costs(stop, quantity)
        risk = (limit - stop) * quantity + fees
        daily = self.daily(now)
        capital = self.policy.capital + sum(t["net_pnl"] for t in self.trades)
        reserved = sum(o["limit"] * o["quantity"] + self.costs(o["limit"], o["quantity"]) for o in self.orders.values())
        remaining_loss = max(0, self.policy.daily_loss + daily["realized_pnl"])
        reserved_risk = sum(o["risk"] for o in self.orders.values())
        # The paper account budget only governs simulated orders; live sizing is re-checked by the live controller.
        if self.paper_enabled and (risk > min(capital * self.policy.risk_fraction, remaining_loss - reserved_risk) or (
            limit * quantity + self.costs(limit, quantity) + reserved > capital
        )):
            signal["reasons"] = ["One lot exceeds remaining risk budget or available paper capital"]
            return
        net_reward = (target - limit) * quantity - self.costs(limit, quantity) - self.costs(target, quantity)
        if net_reward / risk < 1.5:
            signal["reasons"] = ["Reward/risk after estimated costs is below 1.5"]
            return
        signal.update(decision=f"BUY {side}", contract=asdict(contract),
                      entry=dict(low=round_tick(quote.bid, contract.tick_size), high=limit,
                                 maximum=limit, stop=stop, target=target, quantity=quantity,
                                 reward_risk=round(net_reward / risk, 2)),
                      reasons=[name.replace("_", " "), f"RSI {info['rsi']:.1f}; volume {info['volume_ratio']:.2f}x",
                               "IOC limit capped at the signal's ask; never chases a higher ask" if live_rules else
                               "Limit at or below midpoint; never chase the ask",
                               "Rule score is not a calibrated probability"])
        key = (name, side, info["at"], contract.token)
        if not self.paper_enabled:
            return
        last = self.last_setup.get(symbol)
        if symbol in self.orders or (last and (last["key"] == key or now - last["at"] < self.policy.cooldown)):
            return
        # Reserve a daily trade slot for each pending order as well.
        if daily["trades"] + sum(o["entry_at"] is None for o in self.orders.values()) >= self.policy.max_trades:
            signal.update(decision="WAIT", reasons=["Daily trade slots reserved by pending orders"])
            return
        order = dict(id=uuid4().hex, symbol=symbol, token=contract.token, contract=asdict(contract),
                     strategy=name, created_at=now, expires_at=now + self.policy.order_lifetime,
                     limit=limit, stop=stop, initial_stop=stop, target=target, quantity=quantity,
                     risk=risk, entry_at=None, entry_price=None, entry_cost=0, peak=0)
        self.orders[symbol] = order
        self.last_setup[symbol] = {"key": key, "at": now}
        self.event("LIMIT_CREATED", now, order=dict(order))

    def manage(self, now, tick=None):
        if not self.paper_enabled:
            return
        for symbol, order in list(self.orders.items()):
            if order["entry_at"] is None:
                reason = self.risk_reason(now)
                spot, future = self.spot.get(symbol), self.future.get(symbol)
                if not self.fresh(spot, now) or not self.fresh(future, now):
                    reason = reason or "Underlying data stale"
                if now >= order["expires_at"] or reason:
                    del self.orders[symbol]
                    self.event("LIMIT_CANCELLED", now, order_id=order["id"], reason=reason or "Limit expired")
                    continue
            if tick is None or tick.token != order["token"] or not self.fresh(tick, now):
                continue
            size = order["contract"]["tick_size"]
            if order["entry_at"] is None:
                if tick.at <= order["created_at"] or tick.received <= order["created_at"]:
                    continue
                fill = round_tick(tick.ask + size * self.policy.slippage_ticks, size, up=True)
                if not 0 < tick.bid <= tick.ask or tick.ask_quantity < order["quantity"] or fill > order["limit"]:
                    continue
                if fill <= order["stop"]:
                    del self.orders[symbol]
                    self.event("LIMIT_CANCELLED", now, order_id=order["id"],
                               reason="Premium gapped below planned stop before entry")
                    continue
                order.update(entry_at=now, entry_price=fill, peak=fill,
                             entry_cost=self.costs(fill, order["quantity"]))
                self.event("FILLED", now, order=dict(order))
                continue
            if not 0 < tick.bid <= tick.ask or tick.bid_quantity < order["quantity"]:
                continue
            # Evaluate the previously resting stop before updating the trail.
            reason = "STOP_LOSS" if tick.bid <= order["stop"] else (
                "TARGET" if tick.bid >= order["target"] else None)
            dt = datetime.fromtimestamp(now, IST)
            if day(now) != day(order["entry_at"]) or dt.hour * 60 + dt.minute >= 925:
                reason = reason or "SESSION_EXIT"
            if self.killed:
                reason = "KILL_SWITCH"
            if self.fault:
                reason = "DATA_FAULT"
            equity = self.mark_to_market(now)
            if equity is not None and equity <= -self.policy.daily_loss:
                reason = reason or "DAILY_LOSS"
            if reason:
                price = order["target"] if reason == "TARGET" else max(size, round_tick(
                    tick.bid - size * self.policy.slippage_ticks, size))
                trade = {**order, "exit_at": now, "exit_price": price, "exit_reason": reason}
                trade["net_pnl"] = round((price - order["entry_price"]) * order["quantity"] -
                                         order["entry_cost"] - self.costs(price, order["quantity"]), 2)
                self.trades.append(trade)
                del self.orders[symbol]
                self.event("CLOSED", now, trade=trade)
            else:
                order["peak"] = max(order["peak"], tick.bid)
                distance = order["entry_price"] - order["initial_stop"]
                if order["peak"] >= order["entry_price"] + distance:
                    stop = max(order["stop"], round_tick(order["peak"] - distance, size))
                    if stop > order["stop"]:
                        order["stop"] = stop
                        self.event("TRAIL_UPDATED", now, order_id=order["id"], stop=stop)

    def seed_bars(self, token, bars, now):
        """Merge completed exchange 1-minute futures candles; returns minutes added or replaced.

        History fills gaps and replaces live-built bars older than two minutes (exchange data is
        authoritative); the in-progress minute and the latest live bars are never touched.
        """
        key = ("future", token, 60)
        live = {b["at"]: b for b in self.book.closed[key]}
        current = self.book.current.get(key)
        cutoff = min(int(now // 60) * 60, current["at"] if current else math.inf)
        changed = 0
        for bar in bars:
            at = bar["at"]
            if at >= cutoff or not session(at) or (at in live and at >= cutoff - 120) or live.get(at) == bar:
                continue
            live[at] = dict(at=at, open=bar["open"], high=bar["high"], low=bar["low"],
                            close=bar["close"], volume=bar["volume"])
            changed += 1
        if changed:
            self.book.closed[key] = deque(sorted(live.values(), key=lambda b: b["at"])[-600:], maxlen=600)
        return changed

    def snapshot(self, now):
        risk = self.risk_reason(now)
        data = {}
        for symbol in SYMBOLS:
            signal = dict(self.signals.get(symbol, dict(
                symbol=symbol, decision="WAIT", reasons=["Waiting for live market data"],
                confidence=None, at=None, contract=None, entry=None, intelligence=None,
                model="explainable-rules-v1", model_validated=False,
                warmup=dict(completed=0, required=WARMUP_CANDLES),
                opening=dict(completed=0, required=SESSION_CANDLES),
                scalp=self.idle_scalp("Waiting for live market data"), rule_checks=None, setups=[])))
            scalp_signal = dict(signal.get("scalp") or self.idle_scalp(None))
            if risk or not self.fresh(self.spot.get(symbol), now) or not self.fresh(self.future.get(symbol), now):
                reason = risk or self.feed_reason(symbol, now)
                signal.update(decision="WAIT", entry=None, reasons=[reason])
                scalp_signal = self.idle_scalp(reason)
            else:
                if signal.get("decision") != "WAIT" and (
                    not self.fresh(self.options.get(signal["contract"]["token"]), now) or
                    signal["at"] is None or now - signal["at"] > self.policy.stale_seconds
                ):
                    signal.update(decision="WAIT", entry=None, reasons=["Option quote or signal stale"])
                if scalp_signal["decision"] != "WAIT" and (
                    not self.fresh(self.options.get(scalp_signal["contract"]["token"]), now) or
                    signal["at"] is None or now - signal["at"] > self.policy.stale_seconds
                ):
                    scalp_signal = self.idle_scalp("Option quote or signal stale")
            signal["scalp"] = scalp_signal
            signal["feed_ready"] = self.fresh(self.spot.get(symbol), now) and self.fresh(self.future.get(symbol), now)
            if not signal["feed_ready"] or signal["at"] is None or not -1 <= now - signal["at"] <= self.policy.stale_seconds:
                signal.update(rule_checks=None, setups=[])
            order = self.orders.get(symbol)
            signal["position"] = {
                **order, "metrics": self.position_metrics(order, now, healthy=not self.fault),
            } if order else None
            signal["spot"] = self.spot[symbol].price if symbol in self.spot else None
            data[symbol] = signal
        return dict(mode="RESEARCH_ONLY" if self.research_only else "PAPER_ONLY" if self.paper_enabled else "ANALYSIS_ONLY",
                    live_enabled=False, model_status="UNVALIDATED_RULE_BASELINE",
                    generated_at=now, data=data, risk={**asdict(self.policy), **self.daily(now),
                    "killed": self.killed, "blocked_reason": risk,
                    "marked_equity_pnl": self.mark_to_market(now)}, fault=self.fault)
