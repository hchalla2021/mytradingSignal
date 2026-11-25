import json
import logging
import math
import threading
import time
import uuid
from datetime import datetime, time as dt_time

from openingedge.context import positive


logger = logging.getLogger("openingedge.execution")
TERMINAL = {"COMPLETE", "CANCELLED", "REJECTED"}
RISK_FRACTION = 0.20
REWARD_FRACTION = 0.40
# Real entries remain blocked until the execution lifecycle has been validated.
LIVE_EXECUTION_READY = False


def round_tick(value, tick, up=False):
    if not tick or tick <= 0:
        return round(value, 2)
    units = value / tick
    rounded = math.ceil(units) if up else math.floor(units)
    return round(rounded * tick, 2)


class Execution:
    def __init__(self, store, market, env_file):
        self.store = store
        self.market = market
        self.env_file = env_file
        self.lock = threading.RLock()
        self.broker = None
        self.automation_on = False
        self.generated_at = time.time()
        self.active = store.load_active_trade()
        self.error = None
        self.last_scan = 0
        self.last_modify = 0

    def _values(self):
        values = {}
        try:
            for line in self.env_file.read_text(encoding="utf-8").splitlines():
                name, sep, value = line.partition("=")
                if sep:
                    values[name.strip()] = value.strip().strip("\"'")
        except OSError:
            logger.warning("OpeningEdge live configuration is unavailable")
        return values

    def enabled(self):
        values = self._values()
        global_enabled = (values.get("LIVE_TRADE_ENABLED") or "false").lower() in {"1", "true", "yes", "on"}
        configured = values.get("OPENINGEDGE_LIVE_ENABLED", "inherit").lower()
        if configured == "inherit":
            return global_enabled
        return global_enabled and configured in {"1", "true", "yes", "on"}

    def set_broker(self, broker):
        with self.lock:
            self.broker = broker
            self.generated_at = time.time()

    def _save(self, active):
        self.active = active
        self.store.save_active_trade(active)
        self.generated_at = time.time()

    def set_automation(self, enabled, now=None):
        with self.lock:
            self.automation_on = bool(enabled)
            self.error = None
            self.generated_at = time.time()
            return self.status()

    def _preflight_new_entries(self, now):
        if not self.enabled():
            raise ValueError("OpeningEdge live execution is disabled by backend environment configuration")
        if self.broker is None or self.market.state != "connected":
            raise ValueError("Zerodha feed or live broker controller is not ready")
        config = self.store.read()
        missing = [symbol for symbol, value in config["indices"].items() if value["risk"] is None]
        if missing or config["daily_loss"] is None:
            raise ValueError("Save every index loss limit and the daily loss limit before enabling live trading")
        if self.active and self.active.get("state") not in ("CLOSED", "UNFILLED"):
            raise ValueError("An OpeningEdge trade is still being reconciled; verify it in Kite before enabling")

    def status(self):
        with self.lock:
            self.generated_at = time.time()
            active = dict(self.active) if self.active else None
            quote = self._active_quote(active) if active else None
            if quote and active.get("entry_price"):
                active["ltp"] = quote["last_price"]
                active["unrealized_pnl"] = round(
                    (quote["last_price"] - active["entry_price"]) * active["filled"], 2)
            return {
                "trade_enabled": self.enabled(),
                "automation_on": self.automation_on,
                "execution_status": "READY" if LIVE_EXECUTION_READY and self.enabled() and self.broker and self.market.state == "connected"
                    else "LOCKED",
                "execution_block_reason": (
                    "Live broker execution is not yet verified; no new orders can be placed."
                    if not LIVE_EXECUTION_READY else
                    "Live execution is disabled by backend configuration." if not self.enabled() else
                    "Zerodha feed or broker controller is not connected."
                    if not self.broker or self.market.state != "connected" else None
                ),
                "execution_error": self.error,
                "generated_at": self.generated_at,
                "active": active,
                "protective_exits_continue_when_off": LIVE_EXECUTION_READY,
            }

    def tick(self):
        now = time.time()
        if now - self.last_scan < 2:
            return
        self.last_scan = now
        try:
            with self.lock:
                if LIVE_EXECUTION_READY and not self.enabled() and self.automation_on:
                    self.automation_on = False
                    self.error = "Live enablement was removed; automation forced OFF"
                if self.active:
                    if LIVE_EXECUTION_READY:
                        self._reconcile()
                    else:
                        self.error = "Execution is locked; inspect and manage any existing trade in Kite"
                    return
                if not self.automation_on:
                    return
                if not LIVE_EXECUTION_READY:
                    return
                now_dt = self.market.clock()
                if now_dt.weekday() >= 5 or not dt_time(9, 15) <= now_dt.time() < dt_time(9, 20):
                    return
                if self.store.has_entry_today(now_dt.date().isoformat()):
                    self.error = "OpeningEdge daily entry limit reached (one live entry per day)"
                    return
                self._enter(now_dt)
        except Exception as exc:
            self.error = f"{type(exc).__name__}: {exc}"
            logger.exception("OpeningEdge execution tick failed")

    def _order_map(self):
        assert self.broker is not None
        owned = [order for order in self.broker.orders() if str(order.get("tag", "")).startswith("OE")]
        return {str(order.get("order_id")): order for order in owned}

    def _find_order(self, order_map, leg, active):
        order_id = active.get(f"{leg}_order_id")
        if order_id and order_id in order_map:
            return order_map[order_id]
        matches = [order for order in order_map.values() if order.get("tag") == active[f"{leg}_tag"]]
        return matches[0] if len(matches) == 1 else None

    def _enter(self, now):
        if not LIVE_EXECUTION_READY or not self.automation_on or not self.enabled() or self.broker is None or self.market.state != "connected":
            raise ValueError("Live entry preconditions changed; entry blocked")
        reviews = self.store.reviews(now.date().isoformat())
        config = self.store.read()
        with self.market.lock:
            spot_quotes = {symbol: quote for symbol, quote in self.market.quotes.items()
                           if -3 <= (now - quote["timestamp"]).total_seconds() <= 10
                           and self.market.day == now.date()}
        candidates = []
        blocked = []
        broker_orders = self.broker.orders()
        broker_positions = self.broker.positions().get("net", [])
        busy = {(item.get("exchange"), item.get("tradingsymbol"), item.get("product"))
                for item in broker_orders if item.get("status") not in TERMINAL}
        busy |= {(item.get("exchange"), item.get("tradingsymbol"), item.get("product"))
                 for item in broker_positions if abs(int(item.get("quantity") or 0)) > 0}
        for symbol in ("NIFTY", "BANKNIFTY", "SENSEX"):
            review = reviews.get(symbol)
            quote = spot_quotes.get(symbol)
            limits = config["indices"][symbol]
            if not review or review["state"] != "APPROVED" or review["action"] not in ("BUY_CE", "BUY_PE"):
                blocked.append(f"{symbol}: no approved AI direction")
                continue
            if not quote or limits["risk"] is None:
                blocked.append(f"{symbol}: fresh spot or saved risk unavailable")
                continue
            previous = quote.get("previous_close")
            direction_confirmed = positive(previous) and (
                (review["action"] == "BUY_CE" and quote["price"] > previous)
                or (review["action"] == "BUY_PE" and quote["price"] < previous)
            )
            if not direction_confirmed:
                blocked.append(f"{symbol}: live spot does not confirm the approved direction")
                continue
            try:
                option, option_quote = self._select_contract(
                    symbol, review["action"][-2:], quote["price"], limits["lots"], limits["risk"], busy, now)
                risk = (option_quote["ask"] - option_quote["stop"]) * option["lot_size"] * limits["lots"]
                candidates.append((review["confidence"] or 0, symbol, option, option_quote, risk))
            except ValueError as exc:
                blocked.append(f"{symbol}: {exc}")
        if not candidates:
            self.error = "; ".join(blocked)
            return
        confidence, symbol, option, quote, risk = max(candidates, key=lambda row: row[0])
        if confidence <= 0:
            self.error = "No positive-confidence review is eligible"
            return
        if not self._daily_loss_allows(config["daily_loss"], risk):
            self.error = "Planned stop risk breaches OpeningEdge daily loss limit"
            return
        trade_id = uuid.uuid4().hex[:15]
        entry_tag = "OE" + trade_id + "E"
        active = {
            "id": trade_id, "symbol": symbol, "day": now.date().isoformat(),
            "contract": option, "side": reviews[symbol]["action"],
            "entry_tag": entry_tag, "protect_tag": "OE" + trade_id + "S",
            "quantity": option["lot_size"] * config["indices"][symbol]["lots"],
            "lots": config["indices"][symbol]["lots"], "limit": quote["limit"],
            "stop": quote["stop"], "target": quote["target"], "peak": quote["ask"],
            "entry_order_id": None, "protect_order_id": None, "state": "ENTRY_SUBMITTING",
            "filled": 0, "entry_price": 0, "created_at": time.time(),
            "error": None, "review_confidence": confidence, "planned_risk": round(risk, 2),
            "daily_loss_limit": config["daily_loss"],
        }
        self._save(active)
        self.store.record_execution_intent(active)
        try:
            order_id = self.broker.place_order(
                variety="regular", exchange=option["exchange"], tradingsymbol=option["tradingsymbol"],
                transaction_type="BUY", quantity=active["quantity"], product="MIS",
                order_type="LIMIT", price=active["limit"], validity="IOC", tag=entry_tag)
            if not order_id:
                raise ValueError("Broker did not acknowledge the entry order")
            active.update(entry_order_id=str(order_id), state="ENTRY_PENDING")
            self._save(active)
        except Exception:
            active.update(error="Entry outcome unknown; no retry will be attempted; reconcile in Kite", state="ENTRY_UNKNOWN")
            self._save(active)
            raise

    def _select_contract(self, symbol, side, spot, lots, risk_cap, busy, now):
        with self.market.context.lock:
            rows = list(self.market.context.trade_options(symbol, side, spot, now))
        options = []
        for row in rows:
            identity = (row["exchange"], row["tradingsymbol"], "MIS")
            if identity in busy:
                continue
            key = f"{row['exchange']}:{row['tradingsymbol']}"
            quote = self.broker.quote([key]).get(key)
            if not quote:
                continue
            stamp = quote.get("timestamp")
            if not isinstance(stamp, datetime):
                continue
            stamp = stamp.replace(tzinfo=now.tzinfo) if stamp.tzinfo is None else stamp.astimezone(now.tzinfo)
            if not -3 <= (now - stamp).total_seconds() <= 10:
                continue
            depth = quote.get("depth") or {}
            buy = depth.get("buy") or []
            sell = depth.get("sell") or []
            bid = buy[0].get("price") if buy and isinstance(buy[0], dict) else None
            ask = sell[0].get("price") if sell and isinstance(sell[0], dict) else None
            ask_quantity = sell[0].get("quantity") if sell and isinstance(sell[0], dict) else 0
            if not positive(bid) or not positive(ask) or ask < bid:
                continue
            spread = (ask - bid) / ask
            quantity = int(row["lot_size"]) * lots
            if ask_quantity < quantity or spread > 0.08:
                continue
            limit = round_tick(ask, float(row["tick_size"]), up=True)
            stop = round_tick(max(float(row["tick_size"]), limit * (1 - RISK_FRACTION)),
                              float(row["tick_size"]))
            target = round_tick(limit * (1 + REWARD_FRACTION), float(row["tick_size"]))
            planned = (limit - stop) * quantity
            if planned <= risk_cap:
                options.append((abs(row["strike"] - spot), spread, row, {
                    "ask": limit, "limit": limit, "stop": stop, "target": target,
                    "last_price": quote.get("last_price", ask),
                }))
        if not options:
            raise ValueError("no fresh liquid nearby contract fits saved risk and avoids owner/manual positions")
        _, _, row, quote = min(options, key=lambda value: value[:2])
        contract = dict(row)
        if hasattr(contract.get("expiry"), "isoformat"):
            contract["expiry"] = contract["expiry"].isoformat()
        return contract, quote

    def _daily_loss_allows(self, daily_limit, planned_risk):
        realized = self.store.today_realized_pnl(self.market.clock().date().isoformat())
        return realized - planned_risk >= -daily_limit

    def _reconcile(self):
        if not LIVE_EXECUTION_READY:
            raise ValueError("Broker execution is locked; manage existing trades in Kite")
        active = self.active
        if not active or self.broker is None:
            return
        order_map = self._order_map()
        entry = self._find_order(order_map, "entry", active)
        if entry is None:
            if active["state"] not in ("ENTRY_UNKNOWN", "PROTECTION_UNKNOWN"):
                active["state"] = "ENTRY_UNKNOWN"
                active["error"] = "Owned entry order was not found; no retry is allowed"
                self._save(active)
            return
        active["entry_order_id"] = str(entry["order_id"])
        filled = int(entry.get("filled_quantity") or 0)
        if filled < 0 or filled > active["quantity"]:
            raise ValueError("Broker filled quantity is invalid")
        if entry["status"] not in TERMINAL:
            if not self.automation_on and not active.get("cancel_requested"):
                active["cancel_requested"] = True
                self.broker.cancel_order(variety="regular", order_id=active["entry_order_id"])
            active["state"] = "ENTRY_PENDING"
            self._save(active)
            return
        if filled == 0:
            active.update(state="UNFILLED", closed_at=time.time(), error=entry.get("status_message"))
            self.store.finish_active_trade(active)
            self._save(None)
            return
        entry_price = float(entry.get("average_price") or 0)
        if entry_price <= 0:
            raise ValueError("Broker entry fill price is unavailable")
        active.update(filled=filled, entry_price=entry_price)
        protect = self._find_order(order_map, "protect", active)
        if protect is None:
            if active.get("protect_order_id") or active.get("state") in (
                "PROTECTION_SUBMITTING", "PROTECTION_PENDING", "PROTECTION_UNKNOWN",
            ):
                active.update(state="PROTECTION_UNKNOWN",
                              error="Protective order outcome is unverified; no duplicate SELL will be sent")
                self._save(active)
                return
            active["state"] = "PROTECTION_SUBMITTING"
            self._save(active)
            try:
                protect_id = self.broker.place_order(
                    variety="regular", exchange=active["contract"]["exchange"],
                    tradingsymbol=active["contract"]["tradingsymbol"], transaction_type="SELL",
                    quantity=filled, product="MIS", order_type="SL",
                    trigger_price=active["stop"],
                    price=round_tick(max(active["contract"]["tick_size"],
                                        active["stop"] - max(0.05, active["stop"] * 0.01)),
                                    active["contract"]["tick_size"]),
                    validity="DAY", tag=active["protect_tag"])
            except Exception as exc:
                active.update(state="PROTECTION_UNKNOWN",
                              error=f"Protective stop outcome is unverified ({type(exc).__name__})")
                self._save(active)
                raise
            if not protect_id:
                active.update(state="PROTECTION_UNKNOWN",
                              error="Protective stop was not acknowledged; inspect Kite immediately")
                self._save(active)
                return
            active.update(protect_order_id=str(protect_id), state="PROTECTION_PENDING")
            self._save(active)
            return
        if protect["status"] == "COMPLETE":
            exit_price = float(protect.get("average_price") or 0)
            if exit_price <= 0:
                raise ValueError("Broker protective exit price is unavailable")
            active.update(state="CLOSED", exit_price=exit_price, closed_at=time.time(),
                          exit_reason="STOP_OR_TRAILING")
            active["net_pnl"] = round((exit_price - entry_price) * filled, 2)
            self.store.finish_active_trade(active)
            self._save(None)
            return
        if protect["status"] in ("CANCELLED", "REJECTED"):
            active.update(state="PROTECTION_UNKNOWN",
                          error=f"Protective order {protect['status']}; manage the owned position in Kite")
            self._save(active)
            return
        was_unverified = active.get("state") == "PROTECTION_UNKNOWN"
        active.update(protect_order_id=str(protect["order_id"]), state="PROTECTED")
        self._save(active)
        if was_unverified:
            active["state"] = "PROTECTION_UNKNOWN"
            self._save(active)
            return
        self._trail(active, protect)

    def _trail(self, active, protect):
        now = self.market.clock()
        if time.time() - self.last_modify < 3:
            return
        quote = self._active_quote(active)
        if not quote:
            return
        ltp = quote["last_price"]
        session_exit = dt_time(15, 15) <= now.time() < dt_time(15, 30)
        active["peak"] = max(active.get("peak") or ltp, ltp)
        risk = active["entry_price"] * RISK_FRACTION
        if not session_exit and active["peak"] <= active["entry_price"] + risk:
            return
        candidate = max(active["stop"], active["entry_price"], active["peak"] - risk * 0.5)
        candidate = round_tick(candidate, float(active["contract"]["tick_size"]))
        trigger = candidate
        if session_exit:
            trigger = round_tick(max(float(active["contract"]["tick_size"]), ltp),
                                 float(active["contract"]["tick_size"]))
            if protect.get("order_type") == "SL-M" and float(protect.get("trigger_price") or 0) >= ltp:
                return
        if not session_exit and candidate <= float(protect.get("trigger_price") or 0):
            return
        try:
            self.broker.modify_order(
                variety="regular", order_id=active["protect_order_id"], order_type="SL-M",
                quantity=active["filled"], trigger_price=trigger, validity="DAY")
        except Exception as exc:
            active.update(state="PROTECTION_UNKNOWN",
                          error=f"Protective order modification is unverified ({type(exc).__name__})")
            self._save(active)
            raise
        self.last_modify = time.time()
        active["stop"] = trigger
        self._save(active)

    def _active_quote(self, active):
        if not active or not self.broker:
            return None
        contract = active["contract"]
        key = f"{contract['exchange']}:{contract['tradingsymbol']}"
        try:
            result = self.broker.quote([key]).get(key)
            if not result or not positive(result.get("last_price")):
                return None
            stamp = result.get("timestamp")
            if isinstance(stamp, datetime):
                current = self.market.clock()
                stamp = stamp.replace(tzinfo=current.tzinfo) if stamp.tzinfo is None else stamp.astimezone(current.tzinfo)
                age = (current - stamp).total_seconds()
                if -3 <= age <= 10:
                    return result
        except Exception:
            return None
        return None
