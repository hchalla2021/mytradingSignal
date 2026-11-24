"""Single-position execution; no authority over orders outside the Apex journal."""

from __future__ import annotations

from datetime import datetime, time
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR
from math import isfinite
from threading import Lock
from typing import Callable
from uuid import uuid4

from .config import IndexRisk
from .engine import IST
from .store import Store

TERMINAL = {"COMPLETE", "CANCELLED", "REJECTED"}


class Blocked(Exception):
    pass


def rounded(value: float, tick: float, up: bool = False) -> float:
    if not isfinite(value) or value <= 0 or not isfinite(tick) or tick <= 0:
        raise Blocked("Invalid price or instrument tick size")
    units = (Decimal(str(value)) / Decimal(str(tick))).to_integral_value(
        rounding=ROUND_CEILING if up else ROUND_FLOOR)
    return float(units * Decimal(str(tick)))


def rest_timestamp(value: datetime) -> datetime:
    # Kite REST parses timezone-less exchange strings; ticker timestamps are local epoch conversions.
    return value.replace(tzinfo=IST) if value.tzinfo is None else value.astimezone(IST)


def quote_prices(quote: dict, now: datetime, max_spread: float) -> dict:
    stamp = quote.get("timestamp")
    if not isinstance(stamp, datetime):
        raise Blocked("Quote has no exchange timestamp")
    stamp = rest_timestamp(stamp)
    age = (now - stamp).total_seconds()
    if not -3 <= age <= 5:
        raise Blocked("Quote is stale or future dated")
    depth = quote.get("depth") or {}
    bids, asks = depth.get("buy") or [], depth.get("sell") or []
    if not bids or not asks:
        raise Blocked("Bid/ask depth unavailable")
    bid, ask = float(bids[0]["price"]), float(asks[0]["price"])
    ltp = float(quote.get("last_price") or 0)
    if not all(isfinite(x) and x > 0 for x in (bid, ask, ltp)) or ask < bid:
        raise Blocked("Crossed or invalid quote")
    if (ask - bid) / ask * 100 > max_spread:
        raise Blocked("Spread exceeds saved limit")
    if int(bids[0].get("quantity", 0)) <= 0 or int(asks[0].get("quantity", 0)) <= 0:
        raise Blocked("Empty top-of-book liquidity")
    return {"bid": bid, "ask": ask, "ltp": ltp,
            "bid_quantity": int(bids[0]["quantity"]), "ask_quantity": int(asks[0]["quantity"]),
            "timestamp": stamp.isoformat()}


class Executor:
    def __init__(self, store: Store, clock: Callable[[], datetime] | None = None):
        self.store = store
        self.enabled = False
        self.halted: str | None = None
        self.broker = None
        self.submission_lock = Lock()
        self.clock = clock or (lambda: datetime.now(IST))

    def disable(self):
        self.enabled = False
        # OFF acknowledgement cannot race an already-started broker submission.
        with self.submission_lock:
            self.enabled = False

    def active(self) -> list[dict]:
        return [t for t in self.store.trades() if t["state"] not in {"CLOSED", "NO_FILL"}]

    def budget_used(self, day: str, symbol: str | None = None) -> float:
        rows = [t for t in self.store.trades() if (symbol is None or t["symbol"] == symbol)]
        losses = sum(max(0, -float(t.get("pnl", 0))) for t in rows
                     if t["state"] == "CLOSED" and t.get("closed_day") == day)
        reserved = sum(float(t["reserved"]) for t in rows if t["state"] not in {"CLOSED", "NO_FILL"})
        return losses + reserved

    def risk_check(self, symbol: str, cfg: IndexRisk, daily: float, exposure: float, now: datetime):
        day = now.astimezone(IST).date().isoformat()
        if self.halted or self.active():
            raise Blocked(self.halted or "One Apex position or unresolved intent is already active")
        if not time.fromisoformat(cfg.entry_start) <= now.astimezone(IST).time() < time.fromisoformat(cfg.entry_end):
            raise Blocked("Outside saved entry hours")
        # Reserve full debit plus a conservative charge allowance, not just planned SL loss.
        if exposure > cfg.risk_per_trade:
            raise Blocked("Full premium exposure exceeds per-trade risk; reduce lots or increase saved limit")
        if self.budget_used(day, symbol) + exposure > cfg.daily_loss:
            raise Blocked("Per-index daily loss budget exhausted")
        if self.budget_used(day) + exposure > daily:
            raise Blocked("Apex daily loss budget exhausted")

    def contract_clear(self, contract: dict, orders: list[dict], positions: list[dict]):
        exchange, symbol = contract["exchange"], contract["tradingsymbol"]
        if any(p["exchange"] == exchange and p["tradingsymbol"] == symbol and int(p["quantity"]) != 0
               for p in positions):
            raise Blocked("Contract already has a broker position; manual/other strategy ownership is protected")
        if any(o["exchange"] == exchange and o["tradingsymbol"] == symbol and o["status"] not in TERMINAL
               for o in orders):
            raise Blocked("Contract already has an open order; choose another setup")

    def enter(self, symbol: str, setup: dict, contract: dict, prices: dict,
              cfg: IndexRisk, daily: float, now: datetime):
        if not self.enabled or self.broker is None:
            raise Blocked("Live entry is OFF or broker unavailable")
        if now.weekday() >= 5 or not time(9, 15) <= now.time() < time(15, 0):
            raise Blocked("Outside regular entry session")
        quantity = cfg.lots * int(contract["lot_size"])
        if quantity <= 0 or prices["ask_quantity"] < quantity:
            raise Blocked("Insufficient ask liquidity for configured quantity")
        tick = float(contract["tick_size"])
        entry = rounded(prices["ask"], tick, up=True)
        planned_stop = rounded(entry * (1 - cfg.stop_percent / 100), tick)
        planned_limit = rounded(planned_stop * .97, tick)
        if planned_limit <= 0 or planned_limit >= planned_stop:
            raise Blocked("Premium/tick geometry cannot support the configured protective stop")
        reserved = entry * quantity * 1.01 + 100
        self.risk_check(symbol, cfg, daily, reserved, now)
        self.contract_clear(contract, self.broker.orders(), self.broker.positions()["net"])
        try:
            cash = float(self.broker.margins("equity")["available"]["cash"])
        except (KeyError, TypeError, ValueError) as exc:
            raise Blocked("Available broker cash could not be verified") from exc
        if not isfinite(cash) or cash < reserved:
            raise Blocked("Insufficient verified broker cash for full premium and charge reserve")
        if any(t["setup_id"] == f"{symbol}:{setup['id']}" for t in self.store.trades()):
            raise Blocked("This FVG setup has already had an order intent")
        identity = "AX" + uuid4().hex[:14]
        trade = {"id": identity, "setup_id": f"{symbol}:{setup['id']}", "symbol": symbol,
                 "contract": contract["tradingsymbol"], "exchange": contract["exchange"],
                 "token": contract["instrument_token"], "expiry": str(contract["expiry"]),
                 "strike": contract.get("strike"), "setup": setup,
                 "side": setup["side"], "quantity": quantity, "tick_size": tick,
                 "state": "ENTRY_INTENT", "entry_tag": identity + "E", "stop_tag": identity + "S",
                 "entry_order": None, "stop_order": None, "reserved": reserved,
                 "limit": entry, "stop_percent": cfg.stop_percent, "filled": 0,
                 "underlying_stop": setup["underlying_stop"], "created_at": now.isoformat(),
                 "peak": None, "stop": None, "error": None}
        self.store.trade(trade)
        # The intent is committed before any side effect. A timeout is NEVER retried.
        with self.submission_lock:
            try:
                if not self.enabled:
                    raise Blocked("Live entry switched OFF before broker submission")
                submitted = self.clock().astimezone(IST)
                if submitted.date() != now.date() or not (
                        time.fromisoformat(cfg.entry_start) <= submitted.time() < time.fromisoformat(cfg.entry_end)):
                    raise Blocked("Saved entry window expired during broker preflight")
                stamp = prices.get("timestamp")
                if not isinstance(stamp, str):
                    raise Blocked("Option quote timestamp missing before submission")
                quote_at = datetime.fromisoformat(stamp)
                if quote_at.tzinfo is None or not -3 <= (submitted - quote_at).total_seconds() <= 5:
                    raise Blocked("Option quote expired during broker preflight")
            except (Blocked, ValueError) as exc:
                trade["state"] = "NO_FILL"
                trade["error"] = str(exc)
                self.store.trade(trade)
                raise Blocked(trade["error"]) from exc
            try:
                trade["entry_order"] = self.broker.place_order(
                    variety="regular", exchange=trade["exchange"], tradingsymbol=trade["contract"],
                    transaction_type="BUY", quantity=quantity, product="MIS", order_type="LIMIT",
                    price=entry, validity="IOC", tag=trade["entry_tag"])
            except Exception as exc:
                trade["state"], trade["error"] = "ENTRY_UNKNOWN", f"Entry submission uncertain: {type(exc).__name__}"
                self.halted = trade["error"]
                self.enabled = False
        self.store.trade(trade)

    def _find(self, trade: dict, orders: list[dict], kind: str) -> dict | None:
        tag, identity = trade[f"{kind}_tag"], trade[f"{kind}_order"]
        matches = [o for o in orders if o.get("tag") == tag]
        if identity:
            matches = [o for o in matches if str(o["order_id"]) == str(identity)]
        if len(matches) > 1:
            raise Blocked("Duplicate owned order tag; operator reconciliation required")
        if not matches:
            return None
        order = matches[0]
        expected_side = "BUY" if kind == "entry" else "SELL"
        if (order["exchange"] != trade["exchange"] or order["tradingsymbol"] != trade["contract"]
                or order["transaction_type"] != expected_side or order["product"] != "MIS"
                or int(order["quantity"]) != (trade["quantity"] if kind == "entry" else trade["filled"])):
            raise Blocked("Journal/order mismatch; no authority to modify this order")
        trade[f"{kind}_order"] = order["order_id"]
        return order

    def reconcile(self, now: datetime):
        if not self.active() or self.broker is None:
            return
        orders = self.broker.orders()
        positions = self.broker.positions()["net"]
        for trade in self.active():
            try:
                entry = self._find(trade, orders, "entry")
                if entry is None:
                    raise Blocked("Entry intent is not in today's broker order book; never resubmit")
                trade["filled"] = int(entry.get("filled_quantity") or 0)
                if not 0 <= trade["filled"] <= trade["quantity"]:
                    raise Blocked("Broker entry fill quantity is inconsistent with the journal")
                if entry["status"] not in TERMINAL:
                    # Cancel only the exact journaled entry before protecting the final filled quantity.
                    self.broker.cancel_order(variety="regular", order_id=entry["order_id"])
                    trade["state"] = "ENTRY_CANCELLING"
                    self.store.trade(trade)
                    continue
                if not trade["filled"]:
                    trade["state"] = "NO_FILL"
                    trade["error"] = entry.get("status_message") or (
                        "Entry rejected by broker" if entry["status"] == "REJECTED" else "IOC entry had no fill")
                    self.store.trade(trade)
                    self.halted = None
                    continue
                average = float(entry.get("average_price") or 0)
                if not isfinite(average) or average <= 0:
                    raise Blocked("Filled entry has no valid average price")
                trade["entry"] = average
                stop = self._find(trade, orders, "stop")
                sold = int(stop.get("filled_quantity") or 0) if stop else 0
                if not 0 <= sold <= trade["filled"]:
                    raise Blocked("Broker exit fill quantity is inconsistent with the journal")
                net = sum(int(p["quantity"]) for p in positions
                          if p["exchange"] == trade["exchange"] and p["tradingsymbol"] == trade["contract"]
                          and p["product"] == "MIS")
                foreign_orders = [o for o in orders if o["exchange"] == trade["exchange"]
                                  and o["tradingsymbol"] == trade["contract"]
                                  and o["status"] not in TERMINAL
                                  and o.get("tag") not in {trade["entry_tag"], trade["stop_tag"]}]
                created = datetime.fromisoformat(trade["created_at"]).replace(microsecond=0)
                foreign_fills = [o for o in orders if o["exchange"] == trade["exchange"]
                                 and o["tradingsymbol"] == trade["contract"] and int(o.get("filled_quantity") or 0) > 0
                                 and o.get("tag") not in {trade["entry_tag"], trade["stop_tag"]}]
                for foreign in foreign_fills:
                    stamp = foreign.get("order_timestamp")
                    if not isinstance(stamp, datetime) or rest_timestamp(stamp) >= created:
                        raise Blocked("Manual/external filled contract activity detected; operator reconciliation required")
                other_product = any(p["exchange"] == trade["exchange"] and p["tradingsymbol"] == trade["contract"]
                                    and p["product"] != "MIS" and int(p["quantity"]) != 0 for p in positions)
                if net != trade["filled"] - sold or foreign_orders or other_product:
                    raise Blocked("Manual/external contract activity detected; operator reconciliation required")
                if stop and stop["status"] == "COMPLETE" and sold == trade["filled"]:
                    exit_price = float(stop["average_price"])
                    if not isfinite(exit_price) or exit_price <= 0:
                        raise Blocked("Owned exit has no valid average fill price")
                    trade.update(state="CLOSED", exit=exit_price, closed_day=now.date().isoformat(),
                                 gross_pnl=(exit_price - average) * sold,
                                 charge_reserve=average * sold * .01 + 100,
                                 pnl=(exit_price - average) * sold - average * sold * .01 - 100)
                    self.store.trade(trade)
                    self.halted = None
                    continue
                if sold:
                    raise Blocked("Partially filled exit remains broker-managed; no duplicate sell permitted")
                if stop and stop["status"] in {"CANCELLED", "REJECTED"}:
                    raise Blocked("Protective exit cancelled/rejected; immediate broker-side operator action required")
                if stop:
                    trade["state"] = "EXIT_WORKING" if stop["order_type"] == "LIMIT" else "OPEN"
                    trade["stop"] = float(stop.get("trigger_price") or trade["stop"])
                    trade["error"] = None
                    self.store.trade(trade)
                    self.halted = None
                    continue
                if trade["state"] in {"STOP_INTENT", "STOP_UNKNOWN"}:
                    raise Blocked("Protective submission unresolved; never duplicate a sell")
                trigger = rounded(average * (1 - trade["stop_percent"] / 100), trade["tick_size"])
                limit = rounded(trigger * .97, trade["tick_size"])
                if limit >= trigger or limit <= 0:
                    raise Blocked("Protective stop has invalid tick geometry")
                trade.update(state="STOP_INTENT", stop=trigger, initial_stop=trigger, peak=average)
                self.store.trade(trade)
                try:
                    trade["stop_order"] = self.broker.place_order(
                        variety="regular", exchange=trade["exchange"], tradingsymbol=trade["contract"],
                        transaction_type="SELL", quantity=trade["filled"], product="MIS",
                        order_type="SL", trigger_price=trigger, price=limit, validity="DAY",
                        tag=trade["stop_tag"])
                except Exception as exc:
                    trade.update(state="STOP_UNKNOWN", error=f"Protective submission uncertain: {type(exc).__name__}")
                    self.halted = trade["error"]
                    self.enabled = False
                self.store.trade(trade)
            except Blocked as exc:
                self.halted = trade["error"] = str(exc)
                self.enabled = False
                self.store.trade(trade)

    def manage(self, trade: dict, prices: dict, spot: float | None, now: datetime):
        if self.broker is None or trade["state"] not in {"OPEN", "EXIT_WORKING"} or self.halted:
            return
        # Re-fetch the exact stop. Modify it rather than send a competing SELL.
        order = self._find(trade, self.broker.orders(), "stop")
        if not order or order["status"] not in {"TRIGGER PENDING", "OPEN"}:
            return
        if int(order.get("filled_quantity") or 0):
            return
        peak = max(float(trade["peak"]), prices["bid"])
        risk = trade["entry"] - trade["initial_stop"]
        underlying_broken = spot is not None and (
            spot <= trade["underlying_stop"] if trade["side"] == "CE" else spot >= trade["underlying_stop"])
        force_exit = (trade["state"] == "EXIT_WORKING" or underlying_broken or now.time() >= time(15, 15)
                      or prices["bid"] >= trade["entry"] + 3 * risk)
        if force_exit:
            limit = rounded(prices["bid"] * .97, trade["tick_size"])
            if order["order_type"] == "LIMIT" and float(order["price"]) == limit:
                return
            if not self._reserve_modification(trade, now, exit_order=True):
                return
            self.broker.modify_order(variety="regular", order_id=order["order_id"],
                                     order_type="LIMIT", price=limit)
            trade["exit_reason"] = "STRUCTURE" if underlying_broken else "SESSION" if now.time() >= time(15, 15) else "T3"
            trade["state"] = "EXIT_WORKING"
        elif order["status"] == "TRIGGER PENDING" and peak >= trade["entry"] + risk:
            stop = rounded(max(trade["stop"], trade["entry"] + (peak - trade["entry"] - risk) * .5),
                           trade["tick_size"])
            if trade["stop"] < stop < prices["bid"]:
                if trade.get("modifications", 0) >= 18:
                    trade["trailing_status"] = "MODIFICATION_BUDGET_RESERVED_FOR_EXITS"
                    self.store.trade(trade)
                    return
                if not self._reserve_modification(trade, now, exit_order=False):
                    return
                self.broker.modify_order(variety="regular", order_id=order["order_id"],
                                         trigger_price=stop, price=rounded(stop * .97, trade["tick_size"]))
                trade["stop"] = stop
        trade["peak"] = peak
        trade["ltp"] = prices["ltp"]
        trade["unrealized_pnl"] = (prices["bid"] - trade["entry"]) * trade["filled"]
        self.store.trade(trade)

    def _reserve_modification(self, trade: dict, now: datetime, exit_order: bool) -> bool:
        count = int(trade.get("modifications", 0))
        if count >= 24:
            self.enabled = False
            trade["error"] = "Protective order modification budget exhausted; manage the exact order in Kite"
            self.store.trade(trade)
            raise Blocked(trade["error"])
        last = trade.get("last_modify_at")
        if last and (not exit_order or trade["state"] == "EXIT_WORKING") and (
                now - datetime.fromisoformat(last)).total_seconds() < (5 if exit_order else 2):
            trade["trailing_status"] = "PACING; EXISTING BROKER ORDER RETAINED"
            self.store.trade(trade)
            return False
        trade["modifications"] = count + 1
        trade["last_modify_at"] = now.isoformat()
        self.store.trade(trade)
        return True
