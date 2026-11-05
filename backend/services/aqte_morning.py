"""Independent opening rules and bounded recorder; all orders remain in AQTELiveService."""

import asyncio
import copy
import hashlib
import json
import logging
import math
import queue
import threading
import time
from collections import defaultdict, deque
from dataclasses import asdict
from datetime import datetime
from uuid import uuid4
from typing import Any, Literal, NotRequired, TypedDict

from services.aqte_engine import (
    IST, SYMBOLS, WARMUP_CANDLES, Tick, day, minute_of_day, round_tick, session,
)
from services.aqte_engines import expiry_years, greeks
from services.aqte_morning_store import MorningStore, STORE_ERRORS
from services.aqte_runtime import Latencies

logger = logging.getLogger(__name__)
FRESH_SECONDS = 3
ENTRY_CUTOFF = 630


class MorningRule(TypedDict):
    id: str
    label: str
    passed: bool
    reason: str


class MorningSignal(TypedDict):
    source: Literal["morning"]
    decision: Literal["WAIT", "BUY CE", "BUY PE"]
    strategy: str | None
    confidence: float | None
    contract: dict[str, Any] | None
    entry: dict[str, float] | None
    reasons: list[str]
    at: float
    intelligence: dict[str, float]
    model_validated: bool
    rules: list[MorningRule]
    evidence: dict[str, Any]
    engines: list[dict[str, Any]]
    orchestration: dict[str, Any] | None
    options: NotRequired[dict[str, Any]]


def event(kind, at, payload, symbol=None):
    return dict(id=uuid4().hex, at=at, symbol=symbol, kind=kind, payload=payload)


def content_hash(payload):
    stable = {key: value for key, value in payload.items() if key != "at"}
    return hashlib.sha256(json.dumps(stable, sort_keys=True, allow_nan=False).encode()).hexdigest()


def fresh(tick, now):
    return tick is not None and 0 <= now - tick.at <= FRESH_SECONDS and (
        0 <= now - tick.received <= FRESH_SECONDS)


def option_levels(contract, quote, spot_price, atr, now, rate=0.065):
    years = expiry_years(contract.expiry, now)
    model = greeks(spot_price, contract.strike, years, rate,
                   (quote.bid + quote.ask) / 2, contract.side == "CE") if years else None
    maximum = round_tick(quote.ask, contract.tick_size, up=True)
    distance = max(maximum * 0.12, 2 * contract.tick_size,
                   atr * abs(model["delta"]) * 0.5 if model else 0)
    stop = round_tick(maximum - distance, contract.tick_size)
    target = round_tick(maximum + 3 * (maximum - stop), contract.tick_size, up=True)
    return dict(low=quote.bid, high=maximum, maximum=maximum, quantity=contract.lot_size,
                stop=stop, target=target, reward_risk=3, risk_distance=maximum - stop), model


def complete_ohlcv(bars, seconds):
    """Aggregate only complete, contiguous minute candles; never include a forming bucket."""
    buckets = defaultdict(list)
    for bar in bars:
        bucket = int(bar["at"] // seconds) * seconds
        buckets[bucket].append(bar)
    result = []
    for bucket, rows in sorted(buckets.items()):
        rows.sort(key=lambda row: row["at"])
        if [row["at"] for row in rows] != [bucket + minute * 60 for minute in range(seconds // 60)]:
            continue
        result.append(dict(
            at=bucket, open=rows[0]["open"], high=max(row["high"] for row in rows),
            low=min(row["low"] for row in rows), close=rows[-1]["close"],
            volume=sum(row.get("volume", 0) for row in rows),
            oi=next((row["oi"] for row in reversed(rows) if row.get("oi") is not None), None),
            oi_open=next((row["oi"] for row in rows if row.get("oi") is not None), None)))
    return result


class MorningRules:
    def __init__(self):
        self.today = None
        self.latest = {}
        self.tapes = defaultdict(lambda: deque(maxlen=240))
        self.preopen = {}
        self.opening = {}
        self.vwap = {}
        self.rejected = defaultdict(int)
        self.accepted = defaultdict(int)

    def accept(self, tick: Tick, raw):
        if self.today != day(tick.received):
            self.__init__()
            self.today = day(tick.received)
        previous = self.latest.get((tick.kind, tick.token))
        if not fresh(tick, tick.received):
            self.rejected["timestamp"] += 1
            return "Stale/future source timestamp"
        if previous and (tick.at < previous.at or tick.received < previous.received):
            self.rejected["out_of_order"] += 1
            return "Out-of-order source timestamp"
        if previous and asdict(tick) | {"received": 0} == asdict(previous) | {"received": 0}:
            self.rejected["duplicate"] += 1
            return "Duplicate tick"
        self.latest[tick.kind, tick.token] = tick
        self.accepted[tick.kind] += 1
        minute = minute_of_day(tick.at)
        if 540 <= minute < 555:
            key = f"{tick.symbol}:{tick.kind}"
            if tick.kind != "option":
                observation = self.preopen.setdefault(key, dict(
                    first_at=tick.at, count=0, primary_count=0, verified_count=0,
                    high=None, low=None, primary_high=None, primary_low=None))
                observation.update(at=tick.at, price=tick.price, previous_close=(raw.get("ohlc") or {}).get("close"),
                                   buy_depth=tick.buy_depth or None, sell_depth=tick.sell_depth or None,
                                   volume=tick.volume or None, oi=tick.oi,
                                   time_basis="exchange" if raw.get("exchange_timestamp") else "receipt_only",
                                   indicative_auction_price=None)
                traded = raw.get("last_trade_time")
                traded_at = (traded.replace(tzinfo=IST) if traded.tzinfo is None else traded).timestamp() if (
                    isinstance(traded, datetime)) else None
                price_verified = traded_at is not None and day(traded_at) == day(tick.at) and (
                    540 <= minute_of_day(traded_at) < 555 and traded_at <= tick.at)
                observation.update(price_at=traded_at, price_time_verified=price_verified)
                observation["count"] += 1
                observation["primary_count"] += int(minute < 547)
                # Index packets lack exchange time. Never turn a received old close into an auction price.
                if raw.get("exchange_timestamp") and price_verified:
                    observation["verified_count"] += 1
                    for prefix in ("", "primary_") if minute < 547 else ("",):
                        observation[prefix + "high"] = max(observation[prefix + "high"] or tick.price, tick.price)
                        observation[prefix + "low"] = min(observation[prefix + "low"] or tick.price, tick.price)
            return None
        if not session(tick.at) or tick.kind == "option":
            return None
        key = (tick.symbol, tick.kind)
        tape = self.tapes[key]
        if tape and (tape[-1].token != tick.token or tick.at - tape[-1].at > FRESH_SECONDS or
                     (tick.kind == "future" and tick.volume < tape[-1].volume)):
            tape.clear()
            self.vwap.pop(tick.symbol, None)
        tape.append(tick)
        while tape and tick.at - tape[0].at > 30:
            tape.popleft()
        self.opening.setdefault(key, tick)
        if tick.kind == "future":
            weighted = self.vwap.setdefault(tick.symbol, dict(volume=0, turnover=0.0, last=tick.volume))
            delta = max(0, tick.volume - weighted["last"])
            weighted["last"] = tick.volume
            weighted["volume"] += delta
            weighted["turnover"] += tick.price * delta
        return None

    def evaluate(self, symbol, context, now) -> MorningSignal:
        signal: MorningSignal = dict(source="morning", decision="WAIT", strategy=None, confidence=None, contract=None,
                      entry=None, reasons=[], at=now, intelligence={"at": int(now // 60) * 60},
                      model_validated=False, rules=[], evidence={}, engines=[], orchestration=None)

        def check(identity, label, passed, reason):
            signal["rules"].append(dict(id=identity, label=label, passed=bool(passed), reason=reason))
            if not passed:
                signal["reasons"].append(reason)

        tape = list(self.tapes[symbol, "future"])
        spot_tape = list(self.tapes[symbol, "spot"])
        future, spot = (tape[-1] if tape else None), (spot_tape[-1] if spot_tape else None)
        features = context.get("features") or {}
        atr = features.get("atr")
        history_ready = context.get("completed") == WARMUP_CANDLES and isinstance(atr, (int, float)) and (
            math.isfinite(atr) and atr > 0)
        check("window", "Morning entry window", session(now) and minute_of_day(now) < ENTRY_CUTOFF,
              "New morning entries are allowed from 09:15 until 10:30 IST")
        check("preparation", "Verified shared preparation", not context.get("blocked") and history_ready
              and future is not None and future.token == context.get("future_token"),
              context.get("blocked") or "201 completed historical candles and ATR must be prepared")
        check("fresh", "Fresh spot and futures", fresh(future, now) and fresh(spot, now),
              "Fresh spot and exchange-timestamped futures ticks required (maximum age 3 seconds)")
        check("confirmation", "Opening tick confirmation",
              len({tick.at for tick in tape}) >= 3 and tape[-1].at - tape[0].at >= 2 and len(spot_tape) >= 2,
              "Need at least three distinct futures timestamps over two seconds and spot confirmation")
        if signal["reasons"]:
            return signal
        assert future is not None and spot is not None and atr is not None
        move = future.price - tape[0].price
        sign = 1 if move > 0 else -1
        travel = sum(abs(b.price - a.price) for a, b in zip(tape, tape[1:]))
        efficiency = abs(move) / travel if travel else 0
        depth = future.buy_depth + future.sell_depth
        imbalance = (future.buy_depth - future.sell_depth) / depth if depth else None
        weighted = self.vwap.get(symbol) or {}
        vwap = weighted.get("turnover", 0) / weighted["volume"] if weighted.get("volume") else None
        last_moves = [b.price - a.price for a, b in zip(tape[-3:], tape[-2:])]
        check("direction", "Directional movement, not sideways",
              abs(move) >= max(atr * 0.2, future.price * 0.0001) and efficiency >= 0.7
              and all(delta * sign > 0 for delta in last_moves),
              "Movement must exceed 0.2 ATR / 0.01% with >=70% path efficiency and two confirming changes")
        check("spot", "Spot confirms futures", (spot.price - spot_tape[0].price) * sign > 0,
              "Spot movement must confirm futures direction")
        check("depth", "Two-sided futures liquidity", 0 < future.bid <= future.ask
              and (future.ask - future.bid) / future.price <= 0.0005
              and imbalance is not None and imbalance * sign >= 0.1,
              "Need two-sided futures quotes, spread <=0.05% and >=10% aligned depth imbalance")
        check("volume", "Observed volume and VWAP", vwap is not None and (future.price - vwap) * sign > 0
              and sum(b.volume > a.volume for a, b in zip(tape, tape[1:])) >= 2,
              "Need two observed cumulative-volume increases and price on the directional side of observed tick VWAP")
        first = self.opening.get((symbol, "spot"))
        first_future = self.opening.get((symbol, "future"))
        previous_close = context.get("previous_close")
        opening_known = first is not None and minute_of_day(first.at) == 555 and (
            datetime.fromtimestamp(first.at, IST).second <= 5)
        gap = (first.price / previous_close - 1) if first is not None and opening_known and previous_close else None
        opening_price = first_future.price if first_future and minute_of_day(first_future.at) == 555 and (
            datetime.fromtimestamp(first_future.at, IST).second <= 5) else None
        orb = context.get("opening_bar")
        if orb and (day(orb["at"]) != day(now) or minute_of_day(orb["at"]) != 555 or orb["at"] + 60 > now):
            orb = None
        high, low = max(t.price for t in tape), min(t.price for t in tape)
        ema = features.get("ema") or {}
        preopen = self.preopen.get(f"{symbol}:future") or {}
        sweep_low, sweep_high = preopen.get("low"), preopen.get("high")
        setups = [
            ("liquidity_sweep", bool(sweep_low and sweep_high and (
                (sign > 0 and low < sweep_low - atr * 0.1 and future.price > sweep_low + atr * 0.1) or
                (sign < 0 and high > sweep_high + atr * 0.1 and future.price < sweep_high - atr * 0.1)))),
            ("gap_reversal", gap is not None and abs(gap) >= 0.0015 and gap * sign < 0
             and opening_price is not None and (future.price - opening_price) * sign >= atr * 0.3),
            ("gap_and_go", gap is not None and abs(gap) >= 0.0015 and gap * sign > 0
             and opening_price is not None and (future.price - opening_price) * sign >= atr * 0.2),
            ("orb", bool(opening_price is not None and orb and (
                future.price > orb["high"] + atr * 0.1 if sign > 0 else future.price < orb["low"] - atr * 0.1))),
            ("momentum", abs(move) >= atr * 0.5 and high - low >= atr * 0.6),
            ("trend_continuation", bool(ema.get("9") and ema.get("20") and
                (ema["9"] - ema["20"]) * sign > 0 and (future.price - ema["9"]) * sign > 0
                and abs(move) >= atr * 0.3)),
            ("scalp", high - low < atr * 0.5 and imbalance is not None
             and imbalance * sign >= 0.2 and efficiency >= 0.85),
        ]
        setup = next((name for name, passed in setups if passed), None)
        check("setup", "Confirmed morning setup", setup is not None,
              "No gap, sweep, ORB, momentum, trend-continuation or scalp setup confirmed")
        signal["evidence"] = dict(atr=atr, move=move, efficiency=efficiency, imbalance=imbalance,
                                  observed_tick_vwap=vwap, gap_pct=gap * 100 if gap is not None else None,
                                  preopen=copy.deepcopy(preopen), opening_price=opening_price,
                                  setup_checks=dict(setups), oi=future.oi,
                                  source_at=future.at, spot_at=spot.at,
                                  history_at=features.get("at"), completed_candles=context.get("completed"),
                                  ml="No validated morning model; deterministic rules only")
        if signal["reasons"]:
            return signal
        assert setup is not None and imbalance is not None
        side = "CE" if sign > 0 else "PE"
        candidates = []
        for contract, quote in context.get("options", []):
            if contract.side != side or contract.expiry < day(now) or not fresh(quote, now):
                continue
            if not 0 < quote.bid <= quote.ask or min(quote.bid_quantity, quote.ask_quantity) < contract.lot_size:
                continue
            if (quote.ask - quote.bid) / quote.ask > 0.03 or quote.volume <= 0:
                continue
            candidates.append((abs(contract.strike - spot.price), (quote.ask - quote.bid) / quote.ask,
                               -quote.oi if quote.oi is not None else float("inf"), -quote.volume, contract, quote))
        check("option", "Fresh one-lot option liquidity", bool(candidates),
              "No fresh option with both-side lot depth, traded volume and <=3% spread")
        if not candidates:
            return signal
        *_, contract, quote = min(candidates, key=lambda value: value[:4])
        entry, model = option_levels(contract, quote, spot.price, atr, now, context.get("risk_free_rate", 0.065))
        check("levels", "Positive stop and target", 0 < entry["stop"] < entry["maximum"] < entry["target"],
              "Option premium cannot support the ATR/premium-based stop")
        if signal["reasons"]:
            return signal
        score = min(95, 75 + 10 * (efficiency - 0.7) / 0.3 + 5 * min(abs(imbalance) / 0.6, 1)
                    + 5 * min(abs(move) / atr, 1))
        signal.update(decision="BUY CE" if side == "CE" else "BUY PE",
                      strategy=f"morning_{setup}", confidence=round(score, 2),
                      contract=asdict(contract), at=min(future.at, spot.at, quote.at),
                      entry=entry,
                      reasons=[f"Morning {setup.replace('_', ' ')}: {side}",
                               f"{abs(move):.2f}-point futures move; {efficiency:.0%} path efficiency",
                               f"{imbalance:.0%} depth imbalance; spot and observed-volume VWAP confirm",
                               "ATR/premium-based initial stop; existing one-lot net-risk gate still required"])
        signal["evidence"].update(option=asdict(quote), greeks=model, reference=opening_price)
        signal["options"] = {"rows": [dict(token=contract.token, spread=(quote.ask - quote.bid) / quote.ask,
                                          ask_quantity=quote.ask_quantity, oi=quote.oi, volume=quote.volume)]}
        return signal

    def exit_reason(self, active, now):
        tape = [t for t in self.tapes[active["symbol"], "future"] if t.at >= active["entry_at"]]
        spot = [t for t in self.tapes[active["symbol"], "spot"] if t.at >= active["entry_at"]]
        evidence = (active.get("execution_context") or {}).get("morning_evidence") or {}
        atr = evidence.get("atr")
        if not atr or len(tape) < 3 or len(spot) < 2 or not fresh(tape[-1], now) or not fresh(spot[-1], now):
            return None
        sign = 1 if active["contract"]["side"] == "CE" else -1
        reversal = (tape[-1].price - tape[-3].price) * sign <= -atr * 0.3 and (
            spot[-1].price - spot[-2].price) * sign < 0 and tape[-1].at - tape[-3].at >= 2
        if not reversal:
            return None
        reference = evidence.get("reference")
        if reference and (tape[-1].price - reference) * sign < -atr * 0.1:
            return "MORNING_FALSE_BREAKOUT"
        if active["peak"] >= active["entry_price"] + active["entry_price"] - active["initial_stop"]:
            return "MORNING_MOMENTUM_EXHAUSTION"
        return "MORNING_REVERSAL"


class MorningService:
    def __init__(self, market, cache, dsn="", *, store=None):
        self.market, self.cache = market, cache
        self.store = store if store is not None else MorningStore(dsn)
        self.rules = MorningRules()
        self.metrics = Latencies()
        self.queue = queue.Queue(maxsize=5000)
        self.lock = threading.RLock()
        self.signals: dict[str, MorningSignal] = {}
        self.transitions = {}
        self.lost_day = None
        self.error = self.store.error
        self.last_commit = None
        self.global_context = {}
        self.restored_day = None
        self.active_token = None
        self.candle_hashes = {}
        self.order_flow_at = {}
        self.task = None
        self.stopping = False

    def enqueue(self, symbol, kind, raw):
        now = time.time()
        if symbol not in SYMBOLS or not 540 <= minute_of_day(now) < 930:
            return
        if minute_of_day(now) >= ENTRY_CUTOFF and (
            self.active_token is None or (kind == "option" and raw.get("instrument_token") != self.active_token)
        ):
            return
        self.put(event("TICK", now, dict(kind=kind, raw=copy.deepcopy(raw)), symbol))

    def put(self, record):
        try:
            self.queue.put_nowait(record)
        except queue.Full:
            if self.lost_day != day(record["at"]):
                logger.error("Morning queue overflow; new morning entries blocked for this session")
            self.lost_day = day(record["at"])
            self.metrics.increment("queue_dropped")

    def audit(self, kind, payload, symbol=None):
        self.put(event(kind, time.time(), copy.deepcopy(payload), symbol))

    def collect_contexts(self, now):
        contexts = {}
        from services.order_flow_engine import order_flow_engine
        with self.market.lock, self.market.health_lock:
            market, engine = self.market, self.market.engine
            for symbol in SYMBOLS:
                future = engine.future.get(symbol)
                features = market.features.get(engine.book, future.token, now, engine.previous_day.get(symbol)) if future else {}
                bars = features.get("bars") or []
                futures_bars = [dict(bar) for bar in engine.book.closed.get(("future", future.token, 60), ())
                                if future] if future else []
                spot = engine.spot.get(symbol)
                spot_bars = [dict(bar) for bar in engine.book.closed.get(("spot", spot.token, 60), ())
                             if spot] if spot else []
                order_flow = order_flow_engine.live_summary(symbol)
                exchange = "BFO" if symbol == "SENSEX" else "NFO"
                blocked = None
                if not market.started or market.failed.is_set() or market.feed_connected is not True:
                    blocked = "Shared feed/recorder is not connected and healthy"
                elif any(gap["symbol"] == symbol for gap in market.gaps.values()):
                    blocked = "Shared futures/feed recovery is incomplete"
                elif market.configured_days.get(exchange) != day(now) or market.subscription_error:
                    blocked = "Today's shared instrument master/subscriptions are not ready"
                contexts[symbol] = dict(
                    blocked=blocked, features=copy.deepcopy(features.get("values") or {}),
                    future_token=future.token if future else None,
                    futures_bars=futures_bars, spot_bars=spot_bars, order_flow=order_flow,
                    completed=features.get("completed", 0),
                    previous_close=(engine.previous_day.get(symbol) or {}).get("close"),
                    opening_bar=next((dict(b) for b in bars if day(b["at"]) == day(now)
                                      and minute_of_day(b["at"]) == 555), None),
                    options=[(c, engine.options[token]) for token, c in engine.contracts.items()
                                 if c.symbol == symbol and token in engine.options and token in market.subscribed
                                 and fresh(engine.options[token], now)],
                    risk_free_rate=market.engine_config.risk_free_rate)
        return contexts

    def process(self, records):
        from services.aqte_service import normalize

        preopen_changed = False
        for record in records:
            if record["kind"] != "TICK":
                continue
            payload = record["payload"]
            try:
                json.dumps(payload["raw"], allow_nan=False, default=MorningStore.json_value)
            except (TypeError, ValueError):
                payload["analysis_rejection"] = "Malformed non-JSON tick payload"
                payload["raw_invalid"] = repr(payload["raw"])[:8192]
                payload["raw"] = None
                self.metrics.increment("invalid_ticks")
                continue
            try:
                tick = normalize(record["symbol"], payload["kind"], payload["raw"], record["at"])
                with self.lock:
                    reason = self.rules.accept(tick, payload["raw"])
                payload["analysis_rejection"] = reason
                preopen_changed = preopen_changed or (reason is None and 540 <= minute_of_day(tick.at) < 555)
            except (KeyError, TypeError, ValueError, OverflowError) as exc:
                payload["analysis_rejection"] = f"Invalid tick: {type(exc).__name__}"
                self.metrics.increment("invalid_ticks")
        now = time.time()
        if preopen_changed:
            records.append(event("PREOPEN_CONTEXT", now, copy.deepcopy(self.rules.preopen)))
        from services.global_indices_service import get_global_indices_service
        global_quotes = get_global_indices_service().get_snapshot()
        cues = {}
        for name, quote in global_quotes.items():
            try:
                json.dumps(quote, allow_nan=False)
            except (TypeError, ValueError):
                cues[name] = dict(status="UNAVAILABLE", reason="Invalid global quote payload", usable_realtime=False)
                self.metrics.increment("global_quotes_rejected")
                continue
            age = quote.get("quoteAgeSec")
            try:
                source_at = datetime.fromisoformat(quote["timestamp"]).timestamp()
            except (KeyError, TypeError, ValueError):
                source_at = None
            usable = source_at is not None and 0 <= now - source_at <= 600 and (
                isinstance(age, (int, float)) and 0 <= age <= 600 and
                isinstance(quote.get("price"), (int, float)) and quote["price"] > 0 and
                quote.get("status") == "LIVE" and quote.get("liveQuality") == "REALTIME")
            cues[name] = {**quote, "usable_realtime": usable}
        if cues != self.global_context:
            records.append(event("GLOBAL_CONTEXT", now, cues))
            self.global_context = cues
        contexts = self.collect_contexts(now)
        for symbol, context in contexts.items():
            candle_payload = dict(
                symbol=symbol, at=now, historical_candles_completed=context["completed"],
                history_source="existing_AQTE_Kite_historical_and_live_candle_book",
                futures_1m=context["futures_bars"][-WARMUP_CANDLES:],
                index_1m=context["spot_bars"][-WARMUP_CANDLES:],
                futures_5m=complete_ohlcv(context["futures_bars"], 300)[-WARMUP_CANDLES:],
                futures_15m=complete_ohlcv(context["futures_bars"], 900)[-WARMUP_CANDLES:],
                index_5m=complete_ohlcv(context["spot_bars"], 300)[-WARMUP_CANDLES:],
                index_15m=complete_ohlcv(context["spot_bars"], 900)[-WARMUP_CANDLES:],
                feature_snapshot=context["features"],
                previous_session_ohlc=copy.deepcopy(self.market.engine.previous_day.get(symbol)),
                history_block=context["blocked"])
            signature = content_hash(candle_payload)
            if self.candle_hashes.get(symbol) != signature:
                records.append(event("CHART_CANDLES", now, candle_payload, symbol))
                self.candle_hashes[symbol] = signature
            order_flow = context.get("order_flow")
            if order_flow:
                order_flow = {**order_flow, "age_seconds": round(max(0, now - order_flow["at"]), 3),
                              "fresh": 0 <= now - order_flow["at"] <= FRESH_SECONDS}
            if order_flow and now - self.order_flow_at.get(symbol, 0) >= 1:
                records.append(event("ORDER_FLOW", now, copy.deepcopy(order_flow), symbol))
                self.order_flow_at[symbol] = now
            option_rows = [{
                "symbol": contract.symbol, "token": contract.token, "exchange": contract.exchange,
                "trading_symbol": contract.trading_symbol, "expiry": contract.expiry,
                "strike": contract.strike, "side": contract.side, "lot_size": contract.lot_size,
                "ltp": quote.price, "bid": quote.bid or None, "ask": quote.ask or None,
                "bid_quantity": quote.bid_quantity, "ask_quantity": quote.ask_quantity,
                "spread_fraction": (quote.ask - quote.bid) / quote.ask if quote.ask and quote.bid else None,
                "volume": quote.volume or None, "oi": quote.oi, "exchange_at": quote.at,
            } for contract, quote in context["options"]]
            option_rows.sort(key=lambda row: (row["expiry"], row["strike"], row["side"], row["token"]))
            calls = [row for row in option_rows if row["side"] == "CE"]
            puts = [row for row in option_rows if row["side"] == "PE"]
            oi_complete = bool(calls and puts and all(row["oi"] is not None for row in option_rows))
            call_oi = sum(row["oi"] for row in calls) if oi_complete else None
            put_oi = sum(row["oi"] for row in puts) if oi_complete else None
            chain = dict(at=now, symbol=symbol, contracts=option_rows,
                         call_oi=call_oi, put_oi=put_oi,
                         pcr=round(put_oi / call_oi, 4) if call_oi else None,
                         oi_complete=oi_complete,
                         coverage="currently fresh subscribed options only; absent contracts are not inferred")
            chain_hash = content_hash(chain)
            if self.candle_hashes.get(f"{symbol}:options") != chain_hash:
                records.append(event("OPTION_CHAIN", now, chain, symbol))
                self.candle_hashes[f"{symbol}:options"] = chain_hash
        with self.lock, self.metrics.measure("morning.evaluate"):
            signals = {symbol: self.rules.evaluate(symbol, contexts[symbol], now) for symbol in SYMBOLS}
            for symbol, signal in signals.items():
                order_flow = contexts[symbol].get("order_flow")
                if order_flow:
                    signal["evidence"]["order_flow"] = {**order_flow, "age_seconds":
                        round(max(0, now - order_flow["at"]), 3),
                        "fresh": 0 <= now - order_flow["at"] <= FRESH_SECONDS}
                identity = (signal["decision"], signal["strategy"], signal["intelligence"]["at"],
                            (signal["contract"] or {}).get("token"), tuple(signal["reasons"]))
                if self.transitions.get(symbol) != identity:
                    records.append(event("DECISION", now, {**signal, "global_context": cues}, symbol))
                    self.transitions[symbol] = identity
                    self.metrics.increment("decisions")
            if self.lost_day == day(now):
                records.append(dict(id=f"DATA_LOSS:{self.lost_day}", at=now, symbol=None, kind="DATA_LOSS",
                                    payload={"reason": "Bounded queue overflow; session ineligible"}))
        return signals

    async def run(self):
        pending = None
        evaluated = None
        retry = 1
        try:
            while not self.stopping or not self.queue.empty() or pending:
                if not self.store.ready or self.error or self.restored_day != day(time.time()):
                    try:
                        await self.store.connect()
                        if self.restored_day != day(time.time()):
                            restored = await self.store.restore(time.time())
                            with self.lock:
                                if self.rules.today != day(time.time()):
                                    self.rules = MorningRules()
                                self.rules.today = day(time.time())
                                self.rules.preopen = restored["preopen"]
                                if restored["lost"]:
                                    self.lost_day = day(time.time())
                                self.restored_day = day(time.time())
                    except STORE_ERRORS as exc:
                        self.storage_failed(exc)
                        if self.stopping:
                            logger.error("Morning recorder stopped before pending data could be committed")
                            break
                        await asyncio.sleep(retry)
                        retry = min(30, retry * 2)
                        continue
                if pending is None:
                    try:
                        first = await asyncio.to_thread(self.queue.get, True, 0.25)
                    except queue.Empty:
                        continue
                    pending = [first]
                    while len(pending) < 200:
                        try:
                            pending.append(self.queue.get_nowait())
                        except queue.Empty:
                            break
                    self.metrics.observe("morning.queue_age", max(0, time.time() - first["at"]) * 1000)
                    evaluated = await asyncio.to_thread(self.process, pending)
                try:
                    with self.metrics.measure("morning.storage_commit"):
                        await self.store.write(pending)
                    self.last_commit = time.time()
                    self.error = None
                    retry = 1
                except STORE_ERRORS as exc:
                    self.storage_failed(exc)
                    if self.stopping:
                        logger.error("Morning shutdown has %d uncommitted records; existing execution journal is retained",
                                     len(pending) + self.queue.qsize())
                        break
                    await asyncio.sleep(retry)
                    retry = min(30, retry * 2)
                    continue
                with self.lock:
                    if evaluated is None:
                        raise RuntimeError("Morning batch has no evaluated result")
                    self.signals = evaluated
                await self.cache.set("aqte:morning", self.snapshot(), expire=120)
                pending = None
                self.market.notify()
        except asyncio.CancelledError:
            logger.warning("Morning recorder cancelled with pending data; morning entries remain blocked")
            raise
        except Exception as exc:
            # Isolate a failed recorder/evaluator from the 12 engines and broker protection.
            self.error = f"Morning worker failed ({type(exc).__name__})"
            logger.exception("Morning worker failed; morning entries blocked")
        finally:
            await self.store.close()

    def storage_failed(self, exc):
        message = f"Durable morning storage unavailable ({type(exc).__name__}); morning entries blocked"
        if self.error != message:
            logger.error("%s", message)
        self.error = message

    async def start(self):
        if self.task is None:
            logger.info("Morning recorder uses %s", self.store.backend)
            self.stopping = False
            self.task = asyncio.create_task(self.run(), name="aqte-morning")
            self.audit("STARTUP", dict(mode="DETERMINISTIC_RULES", morning_model_validated=False))

    async def stop(self):
        self.stopping = True
        if self.task:
            try:
                await asyncio.wait_for(asyncio.shield(self.task), 10)
            except TimeoutError:
                self.task.cancel()
                try:
                    await self.task
                except asyncio.CancelledError:
                    pass
            self.task = None

    def block_reason(self, now):
        if self.error:
            return self.error
        if not self.last_commit or not 0 <= now - self.last_commit <= FRESH_SECONDS:
            return "Morning durable-recording heartbeat is stale"
        if self.lost_day == day(now):
            return "Morning tick queue lost data; new morning entries blocked for this session"
        if not session(now) or minute_of_day(now) >= ENTRY_CUTOFF:
            return "Morning new-entry window is 09:15-10:30 IST"
        return None

    def quality_reason(self, symbol, signal, min_confidence, allow_unvalidated):
        now = time.time()
        reason = self.block_reason(now)
        if reason:
            return reason
        if not self.market.started or self.market.failed.is_set() or self.market.feed_connected is not True:
            return "Shared market feed/recorder is unavailable"
        with self.market.health_lock:
            if any(gap["symbol"] == symbol for gap in self.market.gaps.values()):
                return "Shared market data recovery is incomplete"
        if (signal.get("contract") or {}).get("token") not in self.market.subscribed:
            return "Morning option is no longer subscribed on the shared feed"
        if not allow_unvalidated:
            return "Morning rules are not paper-validated; existing unvalidated-rule opt-in is required"
        with self.lock:
            current = self.signals.get(symbol)
            if current is None:
                return "Morning signal unavailable"
            if current.get("decision") not in ("BUY CE", "BUY PE") or current.get("strategy") != signal.get("strategy") or (
                current.get("decision") != signal.get("decision") or current.get("intelligence") != signal.get("intelligence")
            ):
                return "Morning setup changed or is no longer qualified"
            if not 0 <= now - current.get("at", 0) <= FRESH_SECONDS:
                return "Morning opportunity is stale"
            if not current.get("rules") or not all(rule["passed"] for rule in current["rules"]):
                return "Morning directional rules are incomplete"
            score = current.get("confidence")
            if score is None or not math.isfinite(score) or score < min_confidence:
                return f"Morning rule score below {min_confidence}/100"
        return None

    def exit_reason(self, active, now):
        with self.lock:
            return self.rules.exit_reason(active, now)

    def snapshot(self):
        now = time.time()
        with self.lock:
            return dict(generated_at=now, error=self.error, block=self.block_reason(now),
                        storage_backend=self.store.backend, storage_configured=self.store.configured,
                        last_commit=self.last_commit,
                        queue_size=self.queue.qsize(), queue_capacity=self.queue.maxsize,
                        lost_day=self.lost_day, preopen=copy.deepcopy(self.rules.preopen),
                        global_context=copy.deepcopy(self.global_context),
                        captured_ticks=dict(self.rules.accepted),
                        signals=copy.deepcopy(self.signals), measurements=self.metrics.snapshot(),
                        rejected=dict(self.rules.rejected), model_validated=False)
