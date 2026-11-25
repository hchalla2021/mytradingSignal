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
RULE_LABELS = (
    "Valid 5m displacement FVG; intact 1m lower/upper bound",
    "Pre-displacement liquidity sweep and reclaim",
    "Confirmed structure break / liquidity run",
    "Causal opposite candle order block; not invalidated",
    "1m FVG retest/rejection or post-FVG continuation",
    "3m microstructure confirmation",
    "15m / 30m / 1h confirmed swing alignment",
    "No active opposing higher-timeframe/Daily FVG at entry",
    "Known liquidity target; structural reward/risk >= 1.5",
)


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


def gap_structure(five: list[Candle], gap: dict) -> dict | None:
    i, side = gap["index"], gap["side"]
    prior = five[max(0, i - 14):i - 2]
    if len(prior) < 6:
        return None
    sweep = prior[-1]
    swept = False
    sweep_index = len(prior) - 1
    for candidate_index in range(len(prior) - 1, 2, -1):
        pool = prior[max(0, candidate_index - 10):candidate_index]
        candidate = prior[candidate_index]
        liquidity = min(r.low for r in pool) if side == "CE" else max(r.high for r in pool)
        reclaimed = (candidate.low < liquidity and candidate.close > liquidity
                     if side == "CE" else
                     candidate.high > liquidity and candidate.close < liquidity)
        if reclaimed:
            sweep, sweep_index, swept = candidate, candidate_index, True
            break
    boundary = (max(r.high for r in prior[max(0, sweep_index - 10):sweep_index])
                if side == "CE" else min(r.low for r in prior[max(0, sweep_index - 10):sweep_index]))
    bos = five[i - 1].close > boundary if side == "CE" else five[i - 1].close < boundary
    causal = prior[sweep_index:]
    ob = next((r for r in reversed(causal) if
               (r.close < r.open if side == "CE" else r.close > r.open)), None)
    ob_valid = ob is not None and not any(
        r.close < ob.low if side == "CE" else r.close > ob.high for r in five[i:])
    return {"sweep": sweep, "swept": swept, "bos": bos, "ob": ob, "ob_valid": ob_valid}


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
              "evaluation": "INCOMPLETE", "diagnostic": None, "fvgs": gaps[5][-12:]}
    preopen = now.weekday() < 5 and time(9, 0) <= now.time() < OPEN
    if not preopen and not session_open(now):
        result["reason"] = "Outside the regular NSE/BSE session."
        return result
    previous = [d for d in daily if d.at.astimezone(IST).date() < now.astimezone(IST).date()]
    pd = previous[-1] if previous else None
    daily_gaps = fvgs(previous[-256:], 1440)[-3:]
    if pd is not None:
        states["Daily"] = {"candles": len(previous), "bias": bias(previous),
                           "last_at": pd.at.isoformat(), "fvgs": daily_gaps}
        result["daily"] = {"previous_high": pd.high, "previous_low": pd.low,
                           "previous_close": pd.close, "at": pd.at.isoformat()}
    if not preopen:
        missing = [m for m, rows in frames.items()
                   if not rows or rows[-1].at + timedelta(minutes=m) < now - timedelta(minutes=m + 1)]
        if missing:
            labels = " / ".join("1h" if m == 60 else f"{m}m" for m in missing)
            closes = [session_start(now) + timedelta(minutes=m) for m in missing]
            if all(now < close for close in closes):
                result["reason"] = (f"Waiting for first completed {labels} candles; "
                                    f"latest required close {max(closes):%H:%M} IST.")
            else:
                result["reason"] = f"Missing, stale or incomplete timeframe coverage: {labels}."
            return result
    if len(frames[5]) < 30 or not daily:
        result["reason"] = ("Pre-open analysis unavailable: insufficient confirmed history or previous-day context."
                            if preopen else "Insufficient confirmed history or previous-day context.")
        return result
    if pd is None:
        result["reason"] = "Previous trading-day levels unavailable."
        return result
    if preopen:
        structures = []
        for gap in result["fvgs"]:
            context = gap_structure(frames[5], gap)
            if context:
                structures.append({"fvg": gap, "sweep": context["sweep"].json(),
                                   "sweep_reclaimed": context["swept"], "structure_break": context["bos"],
                                   "order_block": context["ob"].json() if context["ob"] else None,
                                   "order_block_intact": context["ob_valid"]})
        result["historical_structures"] = structures
        result["reason"] = "Pre-open analysis: completed historical candles only; entries allowed from 09:15 IST."
        return result
    five, one, three = frames[5], frames[1], frames[3]
    same_day_gaps = [
        gap for gap in result["fvgs"]
        if datetime.fromisoformat(gap["confirmed_at"]).date() == now.date()
    ]
    if not same_day_gaps:
        latest_gap = result["fvgs"][-1] if result["fvgs"] else None
        if latest_gap:
            confirmed = datetime.fromisoformat(latest_gap["confirmed_at"])
            result["reason"] = (
                "No same-day 5m displacement FVG for the bullish or bearish setup. "
                f"Latest historical 5m FVG: {latest_gap['side']}, "
                f"{confirmed:%Y-%m-%d %H:%M} IST, {latest_gap['state']}."
            )
        else:
            result["reason"] = (
                "No same-day 5m displacement FVG; no completed FVG exists "
                "in the available confirmed history."
            )
    else:
        latest_gap = same_day_gaps[-1]
        confirmed = datetime.fromisoformat(latest_gap["confirmed_at"])
        result["reason"] = (
            "No eligible same-day intact 5m displacement FVG in the last 8 completed 5m bars. "
            f"Latest same-day 5m FVG: {latest_gap['side']}, "
            f"{confirmed:%Y-%m-%d %H:%M} IST, {latest_gap['state']}."
        )
    if not same_day_gaps:
        result["checks"] = [{"label": label, "passed": False, "status": "WAIT",
                             "detail": result["reason"] if index == 0 else "Awaiting a same-day 5m FVG."}
                            for index, label in enumerate(RULE_LABELS)]
        result["evaluation"] = "WAITING_FVG"
        return result
    best_diagnostic = None
    for gap in reversed(same_day_gaps):
        i, side = gap["index"], gap["side"]
        structure = gap_structure(five, gap)
        if not structure:
            pending = [{"label": label, "passed": False, "status": "WAIT",
                        "detail": "Insufficient confirmed pre-displacement structure."}
                       for label in RULE_LABELS]
            if best_diagnostic is None:
                best_diagnostic = {"checks": pending, "score": 0, "setup": None}
            continue
        sweep, swept, bos, ob, ob_valid = (structure["sweep"], structure["swept"], structure["bos"],
                                          structure["ob"], structure["ob_valid"])
        latest = one[-1]
        since = [r for r in one if r.at >= datetime.fromisoformat(gap["confirmed_at"])]
        intact = (gap["state"] != "INVALIDATED" and len(five) - i <= 8
                  and not any(r.low <= gap["lower"] if side == "CE" else r.high >= gap["upper"]
                              for r in since))
        retest = any(
            (gap["lower"] < row.high and row.low < gap["upper"]
             and row.close > gap["upper"] and row.close > row.open)
            if side == "CE" else
            (row.high > gap["lower"] and row.low < gap["upper"]
             and row.close < gap["lower"] and row.close < row.open)
            for row in since
        )
        continuation = len(since) >= 2 and all(
            row.close > gap["upper"] and row.close > row.open for row in since[-2:]
        ) if side == "CE" else len(since) >= 2 and all(
            row.close < gap["lower"] and row.close < row.open for row in since[-2:]
        )
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
        values = (intact, swept, bos, ob_valid, retest or continuation, micro,
                  aligned, not opposing_gap, rr >= 1.5)
        checks = [{"label": label, "passed": bool(passed),
                   "status": "PASS" if passed else "FAIL", "detail": ""}
                  for label, passed in zip(RULE_LABELS, values)]
        score = round(100 * sum(values) / len(values))
        diagnostic_setup = {"id": gap["id"], "side": side, "fvg": gap,
                            "order_block": ob.json() if ob else None, "sweep": sweep.json(),
                            "underlying_entry": entry, "underlying_stop": stop,
                            "liquidity_target": target, "structural_rr": round(rr, 2),
                            "trigger_at": latest.at.isoformat()}
        if best_diagnostic is None or score > best_diagnostic["score"]:
            best_diagnostic = {"checks": checks, "score": score, "setup": diagnostic_setup}
        required = (intact, swept, bos, ob_valid, retest or continuation or micro,
                    not opposing_gap, rr >= 1.5)
        if not all(required):
            continue
        result.update(checks=checks, score=score, evaluation="QUALIFIED",
                      diagnostic=diagnostic_setup,
                      decision=f"BUY {side}",
                      reason="Rules qualified; pending independent depth, AI and risk gates.",
                      setup=diagnostic_setup)
        return result
    if best_diagnostic:
        result.update(checks=best_diagnostic["checks"], score=best_diagnostic["score"],
                      evaluation="DIAGNOSTIC", diagnostic=best_diagnostic["setup"])
        failed = next((check["label"] for check in result["checks"] if not check["passed"]), None)
        result["reason"] = failed or result["reason"]
    return result
