"""Deterministic, paper-only AQTE core. No broker or network dependencies."""

import math
from collections import defaultdict, deque
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import uuid4

SYMBOLS = ("NIFTY", "BANKNIFTY", "SENSEX")
INTERVALS = (1, 5, 15, 60, 180, 300)
IST = timezone(timedelta(hours=5, minutes=30))


def session(at: float) -> bool:
    dt = datetime.fromtimestamp(at, IST)
    return dt.weekday() < 5 and 555 <= dt.hour * 60 + dt.minute < 930


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


def intelligence(bars, tick: Tick, previous_day=None):
    """Use completed, contiguous one-minute futures bars only."""
    bars = [b for b in bars if day(b["at"]) == day(tick.at)]
    if len(bars) < 201:
        return None
    session_volume = sum(b["volume"] for b in bars)
    vwap = sum((b["high"] + b["low"] + b["close"]) / 3 * b["volume"] for b in bars) / session_volume if session_volume else None
    bars = bars[-201:]
    if any(b["at"] - a["at"] != 60 for a, b in zip(bars, bars[1:])):
        return None
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
        info = intelligence(list(self.book.closed[("future", future.token, 60)]), future,
                            self.previous_day.get(symbol)) if future else None
        if info is None:
            reason = reason or "Warming up: need 201 contiguous completed one-minute futures candles"
        signal = dict(symbol=symbol, decision="WAIT", reasons=[reason] if reason else [],
                      confidence=None, intelligence=info, contract=None, entry=None, at=now,
                      model="explainable-rules-v1", model_validated=False)
        self.signals[symbol] = signal
        if reason:
            return
        setup = strategy(info)
        if not setup:
            signal["reasons"] = ["No confirmed strategy with volume and order-book support"]
            return
        name, side, confidence = setup
        signal.update(strategy=name, confidence=confidence)
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
            signal["reasons"] = ["No fresh liquid option contract with valid lot size and bid/ask depth"]
            return
        _, spread, contract, quote = min(candidates, key=lambda x: x[:2])
        limit = round_tick((quote.bid + quote.ask) / 2, contract.tick_size)
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
        if risk > min(capital * self.policy.risk_fraction, remaining_loss - reserved_risk) or (
            limit * quantity + self.costs(limit, quantity) + reserved > capital
        ):
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
                               "Limit at or below midpoint; never chase the ask",
                               "Rule score is not a calibrated probability; paper only"])
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

    def snapshot(self, now):
        risk = self.risk_reason(now)
        data = {}
        for symbol in SYMBOLS:
            signal = dict(self.signals.get(symbol, dict(
                symbol=symbol, decision="WAIT", reasons=["Waiting for live market data"],
                confidence=None, at=None, contract=None, entry=None, intelligence=None)))
            if risk or not self.fresh(self.spot.get(symbol), now) or not self.fresh(self.future.get(symbol), now):
                signal.update(decision="WAIT", entry=None, reasons=[risk or "Market data stale"])
            elif signal.get("decision") != "WAIT" and (
                not self.fresh(self.options.get(signal["contract"]["token"]), now) or
                signal["at"] is None or now - signal["at"] > self.policy.stale_seconds
            ):
                signal.update(decision="WAIT", entry=None, reasons=["Option quote or signal stale"])
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
