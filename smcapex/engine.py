"""Causal structure detection on exchange-aligned, completed candles."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, time, timedelta
from math import isfinite
from statistics import median
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")
SYMBOLS = ("NIFTY", "BANKNIFTY", "SENSEX")
FRAMES = (1, 3, 5, 15, 30, 60)
OPEN, CLOSE = time(9, 15), time(15, 30)


@dataclass(frozen=True)
class Candle:
    at: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float = 0

    def __post_init__(self):
        if self.at.tzinfo is None:
            raise ValueError("Candle timestamp must be timezone aware")
        object.__setattr__(self, "at", self.at.astimezone(IST))
        if not all(isfinite(x) for x in (self.open, self.high, self.low, self.close, self.volume)):
            raise ValueError("Non-finite candle")
        if self.low <= 0 or self.low > min(self.open, self.close) or self.high < max(self.open, self.close):
            raise ValueError("Invalid OHLC geometry")
        if self.volume < 0 or self.high < self.low:
            raise ValueError("Invalid candle range or volume")

    def json(self) -> dict:
        return {**asdict(self), "at": self.at.isoformat()}


def session_start(at: datetime) -> datetime:
    return at.astimezone(IST).replace(hour=9, minute=15, second=0, microsecond=0)


def session_open(at: datetime) -> bool:
    at = at.astimezone(IST)
    return at.weekday() < 5 and OPEN <= at.time() < CLOSE


def bucket(at: datetime, minutes: int) -> datetime:
    start = session_start(at)
    elapsed = int((at.astimezone(IST) - start).total_seconds() // 60)
    return start + timedelta(minutes=(elapsed // minutes) * minutes)


def aggregate(candles: list[Candle], minutes: int, now: datetime) -> list[Candle]:
    groups: dict[datetime, list[Candle]] = {}
    for candle in candles:
        if session_open(candle.at) and candle.at + timedelta(minutes=1) <= now:
            groups.setdefault(bucket(candle.at, minutes), []).append(candle)
    result = []
    for at, rows in sorted(groups.items()):
        end = min(at + timedelta(minutes=minutes), at.replace(hour=15, minute=30))
        rows.sort(key=lambda row: row.at)
        expected = int((end - at).total_seconds() // 60)
        # Never pad missing minutes, bridge sessions, or expose a forming bar.
        if end > now or len(rows) != expected:
            continue
        if any(row.at != at + timedelta(minutes=i) for i, row in enumerate(rows)):
            continue
        result.append(Candle(at, rows[0].open, max(r.high for r in rows),
                             min(r.low for r in rows), rows[-1].close,
                             sum(r.volume for r in rows)))
    return result


def pivots(rows: list[Candle], high: bool) -> list[tuple[int, float]]:
    values = [r.high if high else r.low for r in rows]
    return [(i, value) for i, value in enumerate(values[2:-2], 2)
            if all(value > x if high else value < x
                   for x in values[i - 2:i] + values[i + 1:i + 3])]


def bias(rows: list[Candle]) -> str:
    highs, lows = pivots(rows, True), pivots(rows, False)
    if len(highs) < 2 or len(lows) < 2:
        return "UNCONFIRMED"
    if highs[-1][1] > highs[-2][1] and lows[-1][1] > lows[-2][1]:
        return "CE"
    if highs[-1][1] < highs[-2][1] and lows[-1][1] < lows[-2][1]:
        return "PE"
    return "RANGE"


def atr(rows: list[Candle]) -> float:
    ranges = [max(b.high - b.low, abs(b.high - a.close), abs(b.low - a.close))
              for a, b in zip(rows[-21:-1], rows[-20:])]
    return median(ranges) if ranges else 0


def fvgs(rows: list[Candle], minutes: int) -> list[dict]:
    """A strict operational FVG definition, not a claim of predictive certainty."""
    found = []
    for i in range(22, len(rows)):
        a, b, c = rows[i - 2:i + 1]
        if minutes == 1440:
            def next_day(at: datetime) -> datetime:
                following = at + timedelta(days=1)
                while following.weekday() >= 5:
                    following += timedelta(days=1)
                return following
            if b.at.date() != next_day(a.at).date() or c.at.date() != next_day(b.at).date():
                continue
        elif b.at != a.at + timedelta(minutes=minutes) or c.at != b.at + timedelta(minutes=minutes):
            continue
        baseline = atr(rows[:i - 1])
        body, span = abs(b.close - b.open), b.high - b.low
        if baseline <= 0 or span <= 0 or body < baseline * 1.2 or body / span < .7:
            continue
        side = "CE" if b.close > b.open else "PE"
        lower, upper = (a.high, c.low) if side == "CE" else (c.high, a.low)
        if upper - lower < baseline * .1:
            continue
        # Reject open-gap-only formations: displacement must cross the first wick.
        if side == "CE" and not (b.open <= a.high < b.close):
            continue
        if side == "PE" and not (b.close < a.low <= b.open):
            continue
        later = rows[i + 1:]
        invalid = any(r.low <= lower if side == "CE" else r.high >= upper for r in later)
        touched = any(r.low < upper if side == "CE" else r.high > lower for r in later)
        found.append({"id": f"{minutes}:{c.at.isoformat()}:{side}", "side": side,
                      "lower": lower, "upper": upper, "created_at": c.at.isoformat(),
                      "confirmed_at": (c.at.replace(hour=15, minute=30) if minutes == 1440
                                       else c.at + timedelta(minutes=minutes)).isoformat(),
                      "index": i, "state": "INVALIDATED" if invalid else "MITIGATED" if touched else "FRESH",
                      "displacement_atr": round(body / baseline, 3)})
    return found


def evaluate(candles: list[Candle], daily: list[Candle], now: datetime) -> dict:
    now = now.astimezone(IST)
    frames = {m: aggregate(candles, m, now)[-256:] for m in FRAMES}
    gaps = {m: fvgs(rows, m) for m, rows in frames.items()}
    states = {str(m): {"candles": len(rows), "bias": bias(rows),
                       "fvgs": gaps[m][-3:],
                       "last_at": rows[-1].at.isoformat() if rows else None}
              for m, rows in frames.items()}
    result = {"decision": "WAIT", "reason": "Waiting for confirmed multi-timeframe confluence.",
              "timeframes": states, "checks": [], "score": 0, "setup": None,
              "fvgs": gaps[5][-12:]}
    if not session_open(now):
        result["reason"] = "Outside the regular NSE/BSE session."
        return result
    if any(not rows or rows[-1].at + timedelta(minutes=m) < now - timedelta(minutes=m + 1)
           for m, rows in frames.items()):
        result["reason"] = "Missing, stale or incomplete timeframe coverage."
        return result
    if len(frames[5]) < 30 or not daily:
        result["reason"] = "Insufficient confirmed history or previous-day context."
        return result
    previous = [d for d in daily if d.at.astimezone(IST).date() < now.astimezone(IST).date()]
    if not previous:
        result["reason"] = "Previous trading-day levels unavailable."
        return result
    pd = previous[-1]
    daily_gaps = fvgs(previous[-256:], 1440)[-3:]
    states["Daily"] = {"candles": len(previous), "bias": bias(previous),
                       "last_at": pd.at.isoformat(), "fvgs": daily_gaps}
    result["daily"] = {"previous_high": pd.high, "previous_low": pd.low,
                       "previous_close": pd.close, "at": pd.at.isoformat()}
    five, one, three = frames[5], frames[1], frames[3]
    for gap in reversed(result["fvgs"]):
        i, side = gap["index"], gap["side"]
        if gap["state"] == "INVALIDATED" or len(five) - i > 8:
            continue
        if datetime.fromisoformat(gap["confirmed_at"]).date() != now.date():
            continue
        prior = five[max(0, i - 14):i - 2]
        if len(prior) < 6:
            continue
        # The sweep precedes displacement. The pool exists before the sweep candle.
        sweep, pool = prior[-1], prior[:-1]
        swept = (sweep.low < min(r.low for r in pool) and sweep.close > min(r.low for r in pool)
                 if side == "CE" else
                 sweep.high > max(r.high for r in pool) and sweep.close < max(r.high for r in pool))
        boundary = max(r.high for r in pool) if side == "CE" else min(r.low for r in pool)
        bos = five[i - 1].close > boundary if side == "CE" else five[i - 1].close < boundary
        ob = next((r for r in reversed(prior) if
                   (r.close < r.open if side == "CE" else r.close > r.open)), None)
        ob_valid = ob is not None and not any(
            r.close < ob.low if side == "CE" else r.close > ob.high for r in five[i:])
        latest = one[-1]
        since = [r for r in one if r.at >= datetime.fromisoformat(gap["confirmed_at"])]
        intact = not any(r.low <= gap["lower"] if side == "CE" else r.high >= gap["upper"] for r in since)
        retest = latest.at >= datetime.fromisoformat(gap["confirmed_at"]) and (
            gap["lower"] < latest.low < gap["upper"] and latest.close > gap["upper"] and latest.close > latest.open
            if side == "CE" else
            gap["lower"] < latest.high < gap["upper"] and latest.close < gap["lower"] and latest.close < latest.open)
        retest = retest and not any(
            r.low < gap["upper"] if side == "CE" else r.high > gap["lower"] for r in since[:-1])
        micro = len(three) >= 3 and (
            three[-1].close > max(r.high for r in three[-3:-1]) if side == "CE"
            else three[-1].close < min(r.low for r in three[-3:-1]))
        aligned = all(states[str(m)]["bias"] == side for m in (15, 30, 60))
        entry = latest.close
        opposing_gap = any(g["side"] != side and g["state"] != "INVALIDATED"
                           and g["lower"] <= entry <= g["upper"]
                           for g in [*(g for m in (15, 30, 60) for g in gaps[m][-12:]), *daily_gaps])
        stop = min(sweep.low, ob.low) if side == "CE" and ob else max(sweep.high, ob.high) if ob else entry
        # Only already-observed, unbroken liquidity above/below entry can be a target.
        levels = ([p for _, p in pivots(five[:i - 2], True)] + [pd.high] if side == "CE"
                  else [p for _, p in pivots(five[:i - 2], False)] + [pd.low])
        unbroken = [p for p in levels if (p > entry and all(r.high < p for r in five[i:])
                                        if side == "CE" else
                                        p < entry and all(r.low > p for r in five[i:]))]
        target = min(unbroken) if side == "CE" and unbroken else max(unbroken) if unbroken else None
        risk = abs(entry - stop)
        rr = abs(target - entry) / risk if target is not None and risk > 0 else 0
        checks = [
            ("Valid 5m displacement FVG; intact 1m lower/upper bound", intact),
            ("Pre-displacement liquidity sweep and reclaim", swept),
            ("Confirmed structure break / liquidity run", bos),
            ("Causal opposite candle order block; not invalidated", ob_valid),
            ("1m first-entry rejection inside FVG", retest),
            ("3m microstructure confirmation", micro),
            ("15m / 30m / 1h confirmed swing alignment", aligned),
            ("No active opposing higher-timeframe/Daily FVG at entry", not opposing_gap),
            ("Known liquidity target; structural reward/risk >= 2", rr >= 2),
        ]
        result.update(checks=[{"label": label, "passed": bool(passed)} for label, passed in checks],
                      score=round(100 * sum(bool(p) for _, p in checks) / len(checks)))
        if not all(p for _, p in checks):
            result["reason"] = next(label for label, passed in checks if not passed)
            continue
        result.update(decision=f"BUY {side}", reason="Rules qualified; pending independent depth, AI and risk gates.",
                      setup={"id": gap["id"], "side": side, "fvg": gap,
                             "order_block": ob.json() if ob else None, "sweep": sweep.json(),
                             "underlying_entry": entry, "underlying_stop": stop,
                             "liquidity_target": target, "structural_rr": round(rr, 2),
                             "trigger_at": latest.at.isoformat()})
        return result
    return result
