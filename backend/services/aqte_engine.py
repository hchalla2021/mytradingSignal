"""Deterministic AQTE signals and paper simulation; no trained ML or broker calls."""

import math
from collections import defaultdict, deque
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Literal
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


class CandleBook:
    def __init__(self):
        self.closed = defaultdict(lambda: deque(maxlen=600))
        self.current = {}
        self.previous = {}

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
                bar = dict(at=bucket, open=tick.price, high=tick.price,
                           low=tick.price, close=tick.price, volume=0)
                self.current[k] = bar
            bar.update(high=max(bar["high"], tick.price), low=min(bar["low"], tick.price),
                       close=tick.price, volume=bar["volume"] + volume)
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


def intelligence(bars, tick: Tick, previous_day=None):
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
    cpr = None
    if previous_day:
        pivot = sum(previous_day[k] for k in ("high", "low", "close")) / 3
        base = (previous_day["high"] + previous_day["low"]) / 2
        cpr = {"pivot": pivot, "bottom": min(base, 2 * pivot - base), "top": max(base, 2 * pivot - base)}
    return {
        "ema": averages, "rsi": 100 - 100 / (1 + gain / loss) if loss else (100 if gain else 50),
        "atr": atr, "vwap": vwap, "supertrend": "BULLISH" if trend == 1 else "BEARISH",
        "supertrend_price": lower if trend == 1 else upper, "cpr": cpr,
        "imbalance": imbalance, "volume_ratio": last["volume"] / avg_volume if avg_volume else 0,
        "breakout": 1 if last["close"] > high else (-1 if last["close"] < low else 0),
        "sweep": 1 if last["low"] < low < last["close"] else (
            -1 if last["high"] > high > last["close"] else 0),
        "structure": "HIGHER_HIGH" if last["close"] > high else (
            "LOWER_LOW" if last["close"] < low else "RANGE"),
        "close": last["close"], "at": last["at"],
    }


def strategy(info):
    e, price = info["ema"], info["close"]
    direction = 1 if e["9"] > e["20"] > e["50"] > e["200"] else (
        -1 if e["9"] < e["20"] < e["50"] < e["200"] else 0)
    candidates = []
    if info["sweep"]:
        candidates.append(("liquidity_reversal", info["sweep"], 70))
    if info["breakout"] and info["volume_ratio"] >= 1.2:
        candidates.append(("momentum_breakout", info["breakout"], 75))
    if direction and abs(price - e["20"]) <= info["atr"]:
        candidates.append(("trend_continuation", direction, 68))
    if not direction and info["vwap"] and abs(price - info["vwap"]) > 2 * info["atr"]:
        if info["rsi"] < 30:
            candidates.append(("mean_reversion", 1, 65))
        elif info["rsi"] > 70:
            candidates.append(("mean_reversion", -1, 65))
    if not candidates or info["imbalance"] is None or info["vwap"] is None or info["atr"] <= 0:
        return None
    candidates = [candidate for candidate in candidates if candidate[1] * info["imbalance"] >= -0.15]
    if not candidates:
        return None
    name, side, score = max(candidates, key=lambda x: x[2])
    score += 5 if side * info["imbalance"] > 0.15 else 0
    return name, "CE" if side > 0 else "PE", score


def scalp(info, points, delta=0.5, reach=4):
    """Quick-scalp rules: VWAP/EMA bias, fresh breakout with volume and order flow, not extended.

    Returns ({side, points, score}, None) where `points` are the eligible premium-point targets
    (ascending, capped by signal strength and by what the futures ATR can reach), or (None, reason).
    """
    try:
        e, price, atr, vwap = info["ema"], info["close"], info["atr"], info["vwap"]
        if vwap is None or info["imbalance"] is None or not atr or atr <= 0 or not points:
            return None, "Scalp needs VWAP, order-book depth and ATR"
        side = 1 if price > vwap and e["9"] > e["20"] else (-1 if price < vwap and e["9"] < e["20"] else 0)
        if not side:
            return None, "No scalp bias: price vs VWAP and EMA 9/20 disagree"
        checks = (
            (info["supertrend"] == ("BULLISH" if side > 0 else "BEARISH"), "SuperTrend not aligned"),
            (55 <= info["rsi"] <= 80 if side > 0 else 20 <= info["rsi"] <= 45, "RSI outside scalp momentum band"),
            (info["breakout"] == side, "No fresh 20-candle breakout"),
            (info["volume_ratio"] >= 1.5, "Breakout volume below 1.5x"),
            (side * info["imbalance"] >= 0.10, "Order-book imbalance does not confirm"),
            (abs(price - e["20"]) <= 2 * atr, "Price extended more than 2 ATR from EMA 20; no chasing"),
        )
        for passed, reason in checks:
            if not passed:
                return None, reason
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
    return dict(side="CE" if side > 0 else "PE", points=reachable, score=70 + 5 * (len(reachable) - 1)), None


def round_tick(price, tick_size, up=False):
    units = price / tick_size
    return round((math.ceil(units - 1e-8) if up else math.floor(units + 1e-8)) * tick_size, 8)


class AQTEEngine:
    def __init__(self, policy=None, *, paper_enabled=True):
        self.policy = policy or Policy()
        self.paper_enabled = paper_enabled
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

    def pick(self, symbol, side, now, spot):
        """Nearest-strike fresh, liquid, tight-spread option of the requested side."""
        candidates = []
        for contract in self.contracts.values():
            if contract.symbol != symbol or contract.side != side or contract.expiry < day(now):
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
        points = setup["points"][-1]
        stop = round_tick(limit - points * ratio, contract.tick_size)
        target = round_tick(limit + points, contract.tick_size, up=True)
        if not 0 < stop < limit < target:
            result["reasons"] = [f"Premium too small for a {points:g}-point scalp stop"]
            return result
        quantity = contract.lot_size
        risk = (limit - stop) * quantity + self.costs(limit, quantity) + self.costs(stop, quantity)
        reward = (target - limit) * quantity - self.costs(limit, quantity) - self.costs(target, quantity)
        if reward / risk < 1.5:
            result["reasons"] = [f"{points:g}-point scalp reward/risk after estimated costs is below 1.5"]
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
                      scalp=self.idle_scalp(reason))
        self.signals[symbol] = signal
        if reason:
            return
        signal["scalp"] = self.scalp_signal(symbol, info, now, spot)
        setup = strategy(info)
        if not setup:
            signal["reasons"] = ["No confirmed strategy with volume and order-book support"]
            return
        name, side, confidence = setup
        signal.update(strategy=name, confidence=confidence)
        picked = self.pick(symbol, side, now, spot)
        if picked is None:
            signal["reasons"] = ["No fresh liquid option contract with valid lot size and bid/ask depth"]
            return
        spread, contract, quote = picked
        # Paper simulates a resting midpoint limit; live sends an IOC limit that must be marketable,
        # so its price cap is the current ask (spread already <= 3%) and is never raised afterwards.
        limit = round_tick((quote.bid + quote.ask) / 2, contract.tick_size) if self.paper_enabled else (
            round_tick(quote.ask, contract.tick_size, up=True))
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
                               "Limit at or below midpoint; never chase the ask" if self.paper_enabled else
                               "IOC limit capped at the signal's ask; never chases a higher ask",
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
                scalp=self.idle_scalp("Waiting for live market data"))))
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
            order = self.orders.get(symbol)
            signal["position"] = {
                **order, "metrics": self.position_metrics(order, now, healthy=not self.fault),
            } if order else None
            signal["spot"] = self.spot[symbol].price if symbol in self.spot else None
            data[symbol] = signal
        return dict(mode="PAPER_ONLY" if self.paper_enabled else "ANALYSIS_ONLY",
                    live_enabled=False, model_status="UNVALIDATED_RULE_BASELINE",
                    generated_at=now, data=data, risk={**asdict(self.policy), **self.daily(now),
                    "killed": self.killed, "blocked_reason": risk,
                    "marked_equity_pnl": self.mark_to_market(now)}, fault=self.fault)
