"""Owner-authorized Zerodha execution for AUTONOMIQ PRO."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import math
from datetime import datetime
from uuid import uuid4
from typing import Any

from kiteconnect.exceptions import KiteException, PermissionException, TokenException

from .config import LIVE_EXECUTION_DISABLED_REASON, AutonomiqConfig
from .live_risk import EntryRisk, Exposure, entry_rejections, trailing_stop
from .market_data import IST, parse_ts
from .risk import hybrid_levels, live_targets, measured_atr, price_structure
from .store import Store

logger = logging.getLogger(__name__)
OWN_TAG_PREFIX = "APRO"
TICK_SIZE = 0.05
TERMINAL_ORDERS = {"COMPLETE", "CANCELLED", "REJECTED"}
TERMINAL_TRADES = {"CLOSED", "UNFILLED", "REJECTED"}


class LiveExecutionBlocked(ValueError):
    """Raised when an owner request or an order fails a live safety gate."""


class LiveOrderExecutor:
    def __init__(self, store: Store, collector):
        self.store = store
        self.collector = collector
        self._lock = asyncio.Lock()
        self._account_id: str | None = None

    async def preflight(self, cfg: AutonomiqConfig) -> dict:
        if not cfg.live_execution_allowed:
            raise LiveExecutionBlocked(LIVE_EXECUTION_DISABLED_REASON)
        return await asyncio.to_thread(self._preflight_sync)

    async def activate(self, cfg: AutonomiqConfig) -> dict:
        async with self._lock:
            if not cfg.live_execution_allowed:
                raise LiveExecutionBlocked(LIVE_EXECUTION_DISABLED_REASON)
            account = await asyncio.to_thread(self._preflight_sync)
            self._account_id = account["account_id"]
            self.store.set_state("live_trading_enabled", True)
            self.store.audit("owner", "live_trading_enabled", {"account_id": account["account_id"]})
            return account

    async def deactivate(self, cfg: AutonomiqConfig) -> None:
        async with self._lock:
            self.store.set_state("live_trading_enabled", False)
            self._account_id = None
            self.store.audit("owner", "live_trading_disabled", {})
            if not cfg.live_execution_allowed:
                return
            try:
                await asyncio.to_thread(self._cancel_pending_entries_sync)
            except Exception:
                logger.exception("AUTONOMIQ PRO could not cancel all pending entry orders after OFF")
                self.store.add_alert("error", "Live entries are OFF; pending entry cancellation needs broker reconciliation")

    def _preflight_sync(self) -> dict:
        try:
            kite = self.collector.gateway.client()
            profile = kite.profile()
            account_id = str(profile.get("user_id") or "")
            if not account_id:
                raise LiveExecutionBlocked("Zerodha account identity is unavailable")
            kite.orders()
            kite.positions()
            kite.margins("equity")
        except TokenException as exc:
            logger.warning("AUTONOMIQ PRO broker preflight blocked: Zerodha session expired or invalid")
            raise LiveExecutionBlocked(
                "Zerodha session expired or invalid. Use the dashboard LOGIN to reconnect "
                "to Zerodha, then enable live trading again."
            ) from exc
        return {"account_id": account_id}

    async def submit_entry(
        self,
        *,
        cfg: AutonomiqConfig,
        session: dict,
        symbol: str,
        decision: dict,
        plan: dict,
        cycle_id: int,
        now: datetime,
    ) -> dict:
        async with self._lock:
            if not cfg.live_execution_allowed:
                return {"status": "BLOCKED", "detail": LIVE_EXECUTION_DISABLED_REASON}
            if not self.store.get_state("live_trading_enabled", False):
                return {"status": "OFF", "detail": "Owner live-trading switch is OFF"}
            if self.store.get_state("kill_switch", False) or not self.store.get_state("engine_enabled", True):
                return {"status": "BLOCKED", "detail": "Kill switch or analysis engine blocks entries"}
            now = datetime.now(IST)
            if (not session.get("trading_day") or session.get("phase") != "ACTIVE"
                    or not cfg.market_start <= now.time() <= cfg.entry_cutoff
                    or now.time() >= cfg.square_off):
                return {"status": "BLOCKED", "detail": "Outside the AUTONOMIQ entry session"}
            if decision.get("action") not in ("BUY_CE", "BUY_PE") or decision.get("source") != "ai+quant":
                return {"status": "BLOCKED", "detail": "A reconciled AI and quant BUY decision is required"}
            approval = decision.get("approval_status")
            if approval not in ("PENDING_RISK", "APPROVED") and not (decision.get("risk") or {}).get("approved"):
                failed = [f"{check['name']}: {check.get('detail') or 'Not passed'}"
                          for check in (decision.get("risk") or {}).get("checks", []) if not check["passed"]]
                return {"status": "BLOCKED", "detail": "; ".join(failed)
                        or "AUTONOMIQ risk validation did not approve this entry"}
            try:
                return await asyncio.to_thread(
                    self._submit_entry_sync, cfg, symbol, decision, plan, cycle_id, now,
                )
            except KiteException as exc:
                logger.exception("AUTONOMIQ PRO broker entry precheck failed for %s", symbol)
                return {"status": "BROKER_ERROR",
                        "detail": f"Zerodha entry precheck failed ({type(exc).__name__}): {str(exc)[:300]}"}

    def _submit_entry_sync(
        self, cfg: AutonomiqConfig, symbol: str, decision: dict, plan: dict, cycle_id: int, now: datetime,
    ) -> dict:
        now = datetime.now(IST)
        if not plan or plan.get("error") or plan.get("symbol") != symbol:
            return {"status": "BLOCKED", "detail": "Invalid AUTONOMIQ contract plan"}
        if plan.get("option_type") not in ("CE", "PE") or plan.get("exchange") not in ("NFO", "BFO"):
            return {"status": "BLOCKED", "detail": "Unsupported options contract"}
        if plan.get("action") != decision.get("action"):
            return {"status": "BLOCKED", "detail": "Signal and contract plan disagree"}
        live_rows = self.store.open_live_trades(limit=10000)
        if any(t["status"] in {
            "ENTRY_UNKNOWN", "PROTECTION_UNKNOWN", "PROTECTION_FAILED", "PROTECTION_SUBMITTING",
            "EXIT_UNKNOWN", "RECONCILIATION_REQUIRED",
        } for t in live_rows):
            return {"status": "BLOCKED", "detail": "An AUTONOMIQ execution needs broker reconciliation"}
        if any(t["symbol"] == symbol for t in live_rows):
            return {"status": "BLOCKED", "detail": "AUTONOMIQ already has an open or pending position for this index"}

        kite = self.collector.gateway.client()
        account_id = self._account_id
        if not account_id:
            profile = kite.profile()
            account_id = str(profile.get("user_id") or "")
            if not account_id:
                return {"status": "BLOCKED", "detail": "Zerodha account identity is unavailable"}
        orders, positions = kite.orders(), kite.positions()
        active_positions = [trade for trade in live_rows if int(trade.get("entry_filled") or 0)
                            > int(trade.get("exit_filled") or 0)]
        live_prices: dict[int, float] = {}
        if active_positions:
            keys = [f"{trade['exchange']}:{trade['tradingsymbol']}" for trade in active_positions]
            quotes = kite.quote(keys)
            for trade, key in zip(active_positions, keys):
                position = next((p for p in positions.get("net", [])
                                 if p.get("exchange") == trade["exchange"]
                                 and p.get("tradingsymbol") == trade["tradingsymbol"]), None)
                expected = int(trade["entry_filled"]) - int(trade.get("exit_filled") or 0)
                if int((position or {}).get("quantity") or 0) != expected:
                    return {"status": "BLOCKED", "detail": f"Broker position mismatch for {trade['tradingsymbol']}"}
                quote = quotes.get(key) or {}
                quote_at = parse_ts(quote.get("timestamp"))
                age = (datetime.now(IST) - quote_at).total_seconds() if quote_at else None
                bid = _best_price((quote.get("depth") or {}).get("buy"))
                if age is None or age < -3 or age > min(5, cfg.max_option_quote_age_seconds) or bid <= 0:
                    return {"status": "BLOCKED", "detail": f"Fresh broker quote unavailable for {trade['tradingsymbol']}"}
                live_prices[trade["id"]] = bid
        tracked_ids = {
            str(order_id) for trade in live_rows
            for order_id in (trade.get("entry_order_id"), trade.get("protection_order_id"), trade.get("exit_order_id"))
            if order_id is not None
        }
        if any(str(order.get("tag") or "").startswith(OWN_TAG_PREFIX)
               and order.get("status") not in TERMINAL_ORDERS
               and str(order.get("order_id")) not in tracked_ids for order in orders):
            return {"status": "BLOCKED", "detail": "An AUTONOMIQ broker order requires reconciliation"}

        exchange, tradingsymbol = plan["exchange"], plan["tradingsymbol"]
        if any(position.get("exchange") == exchange and position.get("tradingsymbol") == tradingsymbol
               and int(position.get("quantity") or 0) != 0
               for position in positions.get("net", [])):
            return {"status": "BLOCKED", "detail": "Broker already reports a position in this contract"}
        if any(order.get("exchange") == exchange and order.get("tradingsymbol") == tradingsymbol
               and order.get("status") not in TERMINAL_ORDERS
               and not str(order.get("tag") or "").startswith(OWN_TAG_PREFIX) for order in orders):
            return {"status": "BLOCKED", "detail": "A manual or external order is active in this contract"}

        contracts = self.collector.gateway.instruments(exchange, now.date().isoformat())
        contract = next((row for row in contracts if row.get("tradingsymbol") == tradingsymbol), None)
        if (not contract or contract.get("name") != symbol
                or contract.get("instrument_type") != plan["option_type"]
                or not contract.get("expiry") or contract.get("expiry") < now.date()):
            return {"status": "BLOCKED", "detail": "Contract is missing, expired, or mismatched in Zerodha's instrument master"}
        lot_size = int(contract.get("lot_size") or 0)
        if lot_size <= 0 or int(plan.get("lot_size") or 0) != lot_size:
            return {"status": "BLOCKED", "detail": "Zerodha lot-size metadata changed"}

        try:
            index_candles, option_candles = self.collector.execution_candles(
                symbol, exchange, tradingsymbol, datetime.now(IST))
        except (KiteException, ValueError, KeyError) as exc:
            logger.warning("AUTONOMIQ PRO hybrid entry history unavailable for %s: %s", symbol, exc)
            detail = f"Hybrid entry history unavailable: {str(exc)[:240]}"
            return {"status": "BLOCKED", "detail": detail, "risk_checks": [
                {"name": "Execution plan", "passed": False, "detail": detail},
            ]}
        quote_key = f"{exchange}:{tradingsymbol}"
        quote_now = datetime.now(IST)
        quote = self.collector.cached_option_quote(exchange, tradingsymbol, quote_now)
        streamed_at = parse_ts(quote.get("timestamp")) if isinstance(quote, dict) else None
        streamed_depth = quote.get("depth") if isinstance(quote, dict) else None
        streamed_age = (quote_now - streamed_at).total_seconds() if streamed_at else None
        if (not isinstance(quote, dict)
                or streamed_age is None or streamed_age < -3
                or streamed_age > min(5, cfg.max_option_quote_age_seconds)
                or _best_price((streamed_depth or {}).get("buy")) <= 0
                or _best_price((streamed_depth or {}).get("sell")) <= 0):
            quote = kite.quote([quote_key]).get(quote_key) or {}
        quote_at = parse_ts(quote.get("timestamp"))
        age = (datetime.now(IST) - quote_at).total_seconds() if quote_at else None
        depth = quote.get("depth") or {}
        bid = _best_price(depth.get("buy"))
        ask = _best_price(depth.get("sell"))
        if (age is None or age < -3 or age > min(5, cfg.max_option_quote_age_seconds)
                or bid <= 0 or ask <= 0 or ask < bid):
            return {"status": "BLOCKED", "detail": "Fresh two-sided broker quote unavailable"}
        spread_pct = (ask - bid) * 100 / ask
        if spread_pct > cfg.max_spread_pct:
            return {"status": "BLOCKED", "detail": f"Live spread {spread_pct:.2f}% exceeds the configured limit"}
        reference = float(plan["entry"])
        if ask > reference * (1 + cfg.max_entry_slippage_pct / 100):
            return {"status": "BLOCKED", "detail": "Fresh ask exceeds the approved entry slippage cap"}

        tick_size = float(contract.get("tick_size") or TICK_SIZE)
        if not math.isfinite(tick_size) or tick_size <= 0:
            return {"status": "BLOCKED", "detail": "Invalid broker tick-size metadata"}
        entry = _ceil_tick(ask, tick_size)
        if entry > reference * (1 + cfg.max_entry_slippage_pct / 100):
            return {"status": "BLOCKED", "detail": "Tick-rounded entry exceeds the approved slippage cap"}
        try:
            levels = hybrid_levels(
                entry=entry, bid=bid, quantity=lot_size, delta=float(plan["quote"]["delta"]),
                option_type=plan["option_type"], index_candles=index_candles,
                option_candles=option_candles, cfg=cfg, tick_size=tick_size)
        except (ValueError, KeyError, TypeError) as exc:
            logger.warning("AUTONOMIQ PRO hybrid entry blocked for %s: %s", symbol, exc)
            detail = f"Hybrid entry validation: {str(exc)[:240]}"
            return {"status": "BLOCKED", "detail": detail, "risk_checks": [
                {"name": "Execution plan", "passed": False, "detail": detail},
            ]}
        risk_points, stop = levels["risk"], levels["stop_loss"]
        target1, target2 = levels["target1"], levels["target2"]
        estimated_slippage = max((ask - bid) * lot_size, entry * lot_size * cfg.max_exit_slippage_pct / 100)
        risk = EntryRisk(
            symbol=symbol, entry=entry, stop=stop, quantity=lot_size, lot_size=lot_size,
            estimated_round_trip_cost=cfg.estimated_round_trip_cost_rupees,
            estimated_exit_slippage=estimated_slippage,
        )
        realized, exposures, pending, trades_today = self._risk_state(now.strftime("%Y-%m-%d"), live_prices)
        rejected = entry_rejections(risk, realized_net=realized, exposures=exposures, pending=pending,
                                    trades_today=trades_today, cfg=cfg)
        if rejected:
            detail = (
                f"Estimated loss ₹{risk.estimated_loss():,.2f} "
                f"(stop ₹{(entry - stop) * lot_size:,.2f} + costs "
                f"₹{cfg.estimated_round_trip_cost_rupees:,.2f} + exit slippage ₹{estimated_slippage:,.2f}). "
                + "; ".join(rejected)
            )
            return {"status": "BLOCKED", "detail": detail, "risk_checks": [
                {"name": "Live execution risk", "passed": False, "detail": detail},
            ]}
        passed_risk = [{
            "name": "Live execution risk", "passed": True,
            "detail": f"Estimated loss ₹{risk.estimated_loss():,.2f} within configured limits",
        }]
        if not self.store.get_state("live_trading_enabled", False):
            return {
                "status": "OFF", "detail": "Owner live-trading switch is OFF",
                "risk_checks": passed_risk,
            }

        try:
            available = float(kite.margins("equity")["available"]["cash"])
        except (KeyError, TypeError, ValueError):
            return {"status": "BLOCKED", "detail": "Available broker cash could not be verified"}
        if not math.isfinite(available) or available < entry * lot_size + cfg.estimated_round_trip_cost_rupees:
            return {"status": "BLOCKED", "detail": "Available broker cash is insufficient for this one-lot entry"}

        submitted_at = datetime.now(IST)
        if (submitted_at.date() != now.date()
                or not cfg.market_start <= submitted_at.time() <= cfg.entry_cutoff
                or submitted_at.time() >= cfg.square_off):
            return {"status": "BLOCKED", "detail": "Entry window closed during broker preflight"}
        if (quote_at is None or not -3 <= (submitted_at - quote_at).total_seconds()
                <= min(5, cfg.max_option_quote_age_seconds)):
            return {"status": "BLOCKED", "detail": "Broker quote expired during preflight"}
        slot = now.replace(minute=(now.minute // 5) * 5, second=0, microsecond=0).isoformat()
        signal_key = hashlib.sha256(
            f"{now.date()}:{slot}:{symbol}:{decision['action']}:{tradingsymbol}".encode()
        ).hexdigest()
        tag = OWN_TAG_PREFIX + uuid4().hex[:10]
        trade = {
            "signal_key": signal_key, "tag": tag, "day": now.strftime("%Y-%m-%d"), "symbol": symbol,
            "exchange": exchange, "tradingsymbol": tradingsymbol, "option_type": plan["option_type"],
            "account_id": account_id, "quantity": lot_size, "lot_size": lot_size, "lots": 1,
            "entry": entry, "stop_loss": stop, "trailing_sl": stop, "target1": target1, "target2": target2,
            "risk": risk_points, "risk_rupees": risk.estimated_loss(),
        }
        trade_id = self.store.create_live_trade(trade)
        if trade_id is None:
            return {"status": "DUPLICATE", "detail": "This signal already has an AUTONOMIQ execution record"}
        self.store.update_live_trade(trade_id, risk_model="HYBRID_V1")
        self.store.audit("autonomiq-pro", "live_entry_intent", {
            "trade_id": trade_id, "symbol": symbol, "contract": tradingsymbol, "quantity": lot_size,
            "reference_entry": reference, "limit": entry, "stop": stop, "risk_rupees": trade["risk_rupees"],
            "risk_model": "HYBRID_V1", "option_atr": levels["option_atr"],
        })
        try:
            order_id = kite.place_order(
                variety="regular", exchange=exchange, tradingsymbol=tradingsymbol, transaction_type="BUY",
                quantity=lot_size, product="MIS", order_type="LIMIT", price=entry, validity="IOC", tag=tag + "E",
            )
            if not order_id:
                raise RuntimeError("Broker did not return an order ID")
        except PermissionException as exc:
            return self._reject_entry(
                trade_id, symbol, f"Zerodha rejected entry (PermissionException): {str(exc)[:300]}",
                datetime.now(IST),
            )
        except Exception as exc:
            detail = f"{type(exc).__name__}: {str(exc)[:300]}" if isinstance(exc, KiteException) else type(exc).__name__
            message = f"Entry result uncertain ({detail}); reconcile before retry"
            self.store.update_live_trade(
                trade_id, status="ENTRY_UNKNOWN", error=message,
            )
            self.store.audit("autonomiq-pro", "live_entry_unknown", {"trade_id": trade_id, "error": type(exc).__name__})
            logger.exception("AUTONOMIQ PRO entry outcome uncertain; automatic resubmission prohibited")
            return {"status": "ENTRY_UNKNOWN", "trade_id": trade_id,
                    "detail": f"{message}; AUTONOMIQ will not resubmit automatically"}
        self.store.update_live_trade(trade_id, status="ENTRY_PENDING", entry_order_id=str(order_id),
                                     expected_order_type="LIMIT", expected_price=entry)
        self.store.audit("autonomiq-pro", "live_entry_submitted", {
            "trade_id": trade_id, "order_id": str(order_id), "tag": tag + "E",
        })
        return {
            "status": "ENTRY_PENDING", "trade_id": trade_id, "order_id": str(order_id),
            "detail": "One-lot marketable limit submitted; fill is not guaranteed",
            "risk_checks": passed_risk,
        }

    def _reject_entry(self, trade_id: int, symbol: str, detail: str, now: datetime) -> dict:
        self.store.update_live_trade(
            trade_id, status="REJECTED", error=detail, last_broker_sync=now.isoformat(),
        )
        self.store.audit("autonomiq-pro", "live_entry_rejected", {"trade_id": trade_id, "detail": detail})
        self.store.add_alert("warning", f"AUTONOMIQ {symbol} entry rejected: {detail}", symbol)
        logger.warning("AUTONOMIQ PRO %s entry rejected: %s", symbol, detail)
        return {"status": "REJECTED", "trade_id": trade_id, "detail": detail}

    def _risk_state(self, day: str, live_prices: dict[int, float] | None = None
                    ) -> tuple[dict[str, float], list[Exposure], list[Exposure], int]:
        realized = {"NIFTY": 0.0, "BANKNIFTY": 0.0, "SENSEX": 0.0}
        exposures: list[Exposure] = []
        pending: list[Exposure] = []
        trades_today = 0
        for trade in self.store.live_trades(limit=10000):
            if trade["day"] != day:
                continue
            status = trade["status"]
            if int(trade.get("entry_filled") or 0) > 0:
                trades_today += 1
            if status in TERMINAL_TRADES:
                if status == "CLOSED" and trade.get("symbol") in realized:
                    realized[trade["symbol"]] += float(trade.get("pnl") or 0)
                continue
            exited = int(trade.get("exit_filled") or 0)
            if exited and trade.get("symbol") in realized:
                realized[trade["symbol"]] += (
                    (float(trade.get("exit_price") or 0) - float(trade.get("entry_price") or trade["entry"]))
                    * exited - float(trade.get("fees") or 0)
                )
            if int(trade.get("entry_filled") or 0) > 0:
                remaining = max(0, int(trade["entry_filled"]) - int(trade.get("exit_filled") or 0))
                if remaining:
                    entry = float(trade.get("entry_price") or trade["entry"])
                    last = float((live_prices or {}).get(trade["id"]) or trade.get("last_price") or entry)
                    active_stop = float(trade.get("trailing_sl") or trade["stop_loss"])
                    fees = float(trade.get("fees") or 0)
                    exposures.append(Exposure(
                        trade["symbol"], (last - entry) * remaining - (fees if not exited else 0),
                        max(0, entry - active_stop) * remaining + (fees if not exited else 0),
                    ))
            else:
                pending.append(Exposure(trade["symbol"], 0, float(trade.get("risk_rupees") or 0)))
        return realized, exposures, pending, trades_today

    def _enforce_daily_loss(self, cfg: AutonomiqConfig, now: datetime) -> None:
        realized, exposures, _, trades_today = self._risk_state(now.strftime("%Y-%m-%d"))
        if not trades_today:
            return
        daily_pnl = sum(realized.values()) + sum(exposure.net_pnl for exposure in exposures)
        if daily_pnl > -cfg.daily_loss_limit_rupees:
            return
        trades = self.store.open_live_trades(limit=10000)
        day = now.strftime("%Y-%m-%d")
        trigger_key = f"daily_loss_limit:{day}"
        first_trigger = not self.store.get_state(trigger_key, False)
        if first_trigger:
            self.store.set_state(trigger_key, True)
        if self.store.get_state("live_trading_enabled", False):
            self.store.set_state("live_trading_enabled", False)
        active_positions = 0
        for trade in trades:
            if int(trade.get("entry_filled") or 0) > int(trade.get("exit_filled") or 0):
                active_positions += 1
            if (int(trade.get("entry_filled") or 0) > int(trade.get("exit_filled") or 0)
                    and trade.get("close_requested") not in ("KILL_SWITCH", "DAILY_LOSS_LIMIT")):
                self.store.update_live_trade(trade["id"], close_requested="DAILY_LOSS_LIMIT")
        if first_trigger:
            self.store.audit("autonomiq-pro", "daily_loss_limit_reached", {
                "day": day, "pnl": round(daily_pnl, 2),
                "limit": cfg.daily_loss_limit_rupees,
            })
            detail = "and owned positions exiting" if active_positions else "with no open owned positions"
            self.store.add_alert(
                "error", f"AUTONOMIQ daily loss threshold reached ({daily_pnl:,.0f} ₹); entries disabled {detail}",
            )

    async def reconcile_and_manage(self, cfg: AutonomiqConfig, now: datetime, square_off) -> None:
        async with self._lock:
            await asyncio.to_thread(self._manage_sync, cfg, now, square_off)

    def quote_mark(self, trade: dict, cfg: AutonomiqConfig, now: datetime) -> dict | None:
        if (trade["status"] in {"CLOSED", "UNFILLED", "REJECTED", "RECONCILIATION_REQUIRED"}
                or int(trade.get("entry_filled") or 0) <= int(trade.get("exit_filled") or 0)
                or float(trade.get("entry_price") or 0) <= 0):
            return None
        quote = self.collector.cached_option_quote(trade["exchange"], trade["tradingsymbol"], now)
        if quote is None:
            return None
        at = parse_ts(quote.get("timestamp"))
        bid = _best_price((quote.get("depth") or {}).get("buy"))
        if at is None or not -3 <= (now - at).total_seconds() <= min(5, cfg.max_option_quote_age_seconds) or bid <= 0:
            return None
        return _position_mark(trade, bid, at, cfg.estimated_round_trip_cost_rupees)

    def mark_positions(self, cfg: AutonomiqConfig, now: datetime) -> None:
        for trade in self.store.open_live_trades(limit=10000):
            mark = self.quote_mark(trade, cfg, now)
            if mark is not None:
                self.store.update_live_trade(trade["id"], **mark)

    def mark_trade_rows(self, trades: list[dict], cfg: AutonomiqConfig, now: datetime) -> list[dict]:
        for trade in trades:
            mark = self.quote_mark(trade, cfg, now)
            if mark is not None:
                trade.update(mark)
        return trades

    def _manage_sync(self, cfg: AutonomiqConfig, now: datetime, square_off) -> None:
        trades = self.store.open_live_trades(limit=10000)
        repair_rows = [
            trade for trade in self.store.live_trades(limit=100)
            if trade.get("status") in {"UNFILLED", "REJECTED"}
            and trade.get("day") == now.strftime("%Y-%m-%d")
            and trade.get("entry_order_id")
            and not trade.get("error")
        ]
        trades = [*trades, *repair_rows]
        if not trades:
            self._enforce_daily_loss(cfg, now)
            return
        kite = self.collector.gateway.client()
        try:
            account_id = str((kite.profile() or {}).get("user_id") or "")
            if not account_id or any(str(trade.get("account_id") or "") != account_id for trade in trades):
                message = "AUTONOMIQ trade account does not match the authenticated Zerodha account; no orders modified"
                for trade in trades:
                    if trade.get("error") != message:
                        self.store.update_live_trade(trade["id"], error=message, last_broker_sync=now.isoformat())
                        self.store.add_alert("error", message, trade["symbol"])
                return
            orders = kite.orders()
            positions = kite.positions().get("net", [])
        except Exception as exc:
            logger.exception("AUTONOMIQ PRO live reconciliation failed")
            self.store.add_alert("error", f"AUTONOMIQ live reconciliation unavailable ({type(exc).__name__})")
            return
        by_id = {str(order.get("order_id")): order for order in orders if order.get("order_id") is not None}
        for trade in trades:
            self._manage_trade(kite, trade, by_id, positions, cfg, now, square_off)
        self._enforce_daily_loss(cfg, now)

    def _manage_trade(self, kite, trade: dict, orders: dict, positions: list[dict],
                      cfg: AutonomiqConfig, now: datetime, square_off) -> None:
        now = datetime.now(IST)
        entry = _find_order(orders, trade.get("entry_order_id"), trade["tag"] + "E")
        denial = str(trade.get("error") or "")
        if (not entry and trade["status"] == "ENTRY_UNKNOWN"
                and trade["day"] == now.date().isoformat()
                and not trade.get("entry_order_id") and not int(trade.get("entry_filled") or 0)
                and not int(trade.get("exit_filled") or 0)
                and denial.startswith("Entry result uncertain (PermissionException: IP (")
                and "is not allowed to place orders for this app" in denial
                and not any(str(order.get("tag") or "").startswith(trade["tag"]) for order in orders.values())
                and not any(p.get("exchange") == trade["exchange"]
                            and p.get("tradingsymbol") == trade["tradingsymbol"]
                            and int(p.get("quantity") or 0) != 0 for p in positions)):
            detail = denial.removeprefix("Entry result uncertain (").removesuffix("); reconcile before retry")
            self._reject_entry(trade["id"], trade["symbol"], f"Reconciled Zerodha IP refusal: {detail}", now)
            return
        if entry:
            entry_id = str(entry["order_id"])
            filled = int(entry.get("filled_quantity") or 0)
            avg = float(entry.get("average_price") or trade.get("entry_price") or 0)
            status = _order_status(entry)
            if (trade["status"] in {"UNFILLED", "REJECTED"} and not filled
                    and not trade.get("error") and status in TERMINAL_ORDERS):
                detail = str(entry.get("status_message") or (
                    "IOC entry cancelled without a fill" if status == "CANCELLED"
                    else "Broker rejected the entry"
                ))[:300]
                self.store.update_live_trade(
                    trade["id"], error=detail, last_broker_sync=now.isoformat(),
                )
                self.store.audit("autonomiq-pro", "entry_terminal_reason_repaired", {
                    "trade_id": trade["id"], "order_id": entry_id, "status": trade["status"],
                    "detail": detail,
                })
                self.store.add_alert(
                    "warning", f"AUTONOMIQ {trade['tradingsymbol']} "
                    f"{trade['status']}: {detail}", trade["symbol"],
                )
                return
            if (entry_id != trade.get("entry_order_id")
                    or filled != int(trade.get("entry_filled") or 0)
                    or (status in TERMINAL_ORDERS and trade["status"] in {
                        "ENTRY_PENDING", "ENTRY_SUBMITTING", "ENTRY_UNKNOWN",
                    })):
                fields = {"entry_order_id": entry_id, "entry_filled": filled, "last_broker_sync": now.isoformat()}
                if avg > 0:
                    fields["entry_price"] = avg
                    fields["opened_at"] = str(entry.get("order_timestamp") or now.isoformat())
                    if trade.get("risk_model") == "HYBRID_V1" and filled and avg > float(trade["stop_loss"]):
                        fields["target1"], fields["target2"] = live_targets(
                            avg, float(trade["stop_loss"]), filled, cfg)
                if filled and status in TERMINAL_ORDERS:
                    fields["status"] = "PROTECTION_PENDING"
                elif filled and status not in TERMINAL_ORDERS:
                    fields["cancel_requested"] = True
                elif not filled and status == "REJECTED":
                    fields["status"] = "REJECTED"
                    fields["error"] = str(entry.get("status_message") or "Entry rejected")[:300]
                elif not filled and status == "CANCELLED":
                    fields["status"] = "UNFILLED"
                    fields["error"] = str(
                        entry.get("status_message") or "IOC entry cancelled without a fill"
                    )[:300]
                self.store.update_live_trade(trade["id"], **fields)
                trade.update(fields)
                if fields.get("status") in {"REJECTED", "UNFILLED"}:
                    detail = fields.get("error") or "IOC entry cancelled without a fill"
                    self.store.add_alert("warning", f"AUTONOMIQ {trade['tradingsymbol']} "
                                         f"{fields['status']}: {detail}", trade["symbol"])
                    self.store.audit("autonomiq-pro", "entry_reconciled_terminal", {
                        "trade_id": trade["id"], "symbol": trade["symbol"],
                        "status": fields["status"], "order_id": entry_id, "detail": detail,
                    })
                if filled and status not in TERMINAL_ORDERS:
                    try:
                        kite.cancel_order(variety=entry.get("variety") or "regular", order_id=entry["order_id"])
                    except Exception:
                        logger.exception("AUTONOMIQ PRO could not cancel the unfilled entry remainder")
                    return

        if trade["status"] in TERMINAL_TRADES or trade["status"] == "ENTRY_UNKNOWN":
            return
        if trade["status"] == "RECONCILIATION_REQUIRED":
            # Orders and positions are separate snapshots; reconcile proven owned fills without sending orders.
            for field, tag in (
                ("exit_order_id", _exit_tag(trade) if int(trade.get("exit_attempt") or 0) else _protection_tag(trade)),
                ("protection_order_id", _protection_tag(trade)),
            ):
                order_id = str(trade.get(field) or "")
                order = orders.get(order_id)
                if not order:
                    continue
                filled = int(order.get("filled_quantity") or 0)
                tracked = int(trade.get("exit_order_filled") or 0) if order_id == str(trade.get("exit_order_id") or "") else 0
                remaining = int(trade.get("entry_filled") or 0) - int(trade.get("exit_filled") or 0)
                if (order.get("tag") != tag or order.get("exchange") != trade["exchange"]
                        or order.get("tradingsymbol") != trade["tradingsymbol"]
                        or order.get("transaction_type") != "SELL"
                        or not 0 < filled <= int(order.get("quantity") or 0) <= int(trade["entry_filled"])
                        or not 0 < filled - tracked <= remaining
                        or float(order.get("average_price") or 0) <= 0):
                    continue
                self._record_exit(trade, order, now, cfg)
                if self.store.live_trade(trade["id"])["status"] != "CLOSED":
                    self.store.update_live_trade(
                        trade["id"], status="RECONCILIATION_REQUIRED", error=trade.get("error"))
                break
            return
        if trade["status"] in {"EXIT_SUBMITTING", "EXIT_UNKNOWN"}:
            exit_order = _find_order(orders, trade.get("exit_order_id"), _exit_tag(trade))
            if exit_order:
                self.store.update_live_trade(trade["id"], status="EXIT_PENDING",
                                             exit_order_id=str(exit_order["order_id"]), error=None)
                trade.update(status="EXIT_PENDING", exit_order_id=str(exit_order["order_id"]))
            else:
                return
        owned = max(0, int(trade.get("entry_filled") or 0) - int(trade.get("exit_filled") or 0))
        if not owned:
            return
        if trade["status"] == "EXIT_PENDING":
            exit_order = _find_order(
                orders, trade.get("exit_order_id"),
                _exit_tag(trade) if int(trade.get("exit_attempt") or 0) else _protection_tag(trade),
            )
            if not exit_order:
                self.store.update_live_trade(trade["id"], status="EXIT_UNKNOWN",
                                             error="Exit order is missing from broker order book")
                self.store.add_alert("error", f"AUTONOMIQ exit order could not be reconciled for {trade['tradingsymbol']}",
                                     trade["symbol"])
                return
            self._record_exit(trade, exit_order, now, cfg)
            if _order_status(exit_order) not in TERMINAL_ORDERS:
                qkey = f"{trade['exchange']}:{trade['tradingsymbol']}"
                quote = kite.quote([qkey]).get(qkey) or {}
                quote_at = parse_ts(quote.get("timestamp"))
                age = (datetime.now(IST) - quote_at).total_seconds() if quote_at else None
                bid = _best_price((quote.get("depth") or {}).get("buy"))
                if age is not None and -3 <= age <= min(5, cfg.max_option_quote_age_seconds) and bid > 0:
                    self._reprice_exit(kite, trade, exit_order, bid, cfg, now)
            return

        protective_tag = _protection_tag(trade)
        protective = _find_order(orders, trade.get("protection_order_id"), protective_tag)
        if protective and int(protective.get("filled_quantity") or 0) > 0:
            self._record_exit(trade, protective, now, cfg)
            return
        broker_position = next((p for p in positions if p.get("exchange") == trade["exchange"]
                                and p.get("tradingsymbol") == trade["tradingsymbol"]), None)
        net_quantity = int((broker_position or {}).get("quantity") or 0)
        if net_quantity != owned:
            message = f"Position mismatch for {trade['tradingsymbol']}; AUTONOMIQ will not touch the broker position"
            self.store.update_live_trade(trade["id"], status="RECONCILIATION_REQUIRED", error=message,
                                        last_broker_sync=now.isoformat())
            self.store.audit("autonomiq-pro", "position_mismatch", {"trade_id": trade["id"], "expected": owned,
                                                                     "broker": net_quantity})
            self.store.add_alert("error", message, trade["symbol"])
            return

        if trade["status"] == "OPEN" and (not protective or _order_status(protective) in TERMINAL_ORDERS):
            status = "PROTECTION_FAILED" if protective else "PROTECTION_UNKNOWN"
            message = "Protective order ended without closing the position" if protective else "Protective order missing; broker reconciliation required"
            self.store.update_live_trade(trade["id"], status=status, error=message)
            self.store.add_alert("error", f"AUTONOMIQ {trade['tradingsymbol']}: {message}", trade["symbol"])
            trade["status"] = status

        if trade["status"] == "PROTECTION_PENDING":
            if trade.get("risk_model") == "HYBRID_V1" and float(trade["stop_loss"]) >= float(trade["entry_price"]):
                self.store.update_live_trade(trade["id"], status="PROTECTION_FAILED",
                                            error="Fill is at or below structural stop; emergency exit required")
                self._submit_emergency_exit(kite, trade, cfg, now)
                return
            if protective and _order_status(protective) not in TERMINAL_ORDERS:
                self.store.update_live_trade(trade["id"], status="OPEN",
                                            protection_order_id=str(protective["order_id"]),
                                            expected_order_type=_order_type(protective),
                                            last_broker_sync=now.isoformat())
                trade.update(status="OPEN", protection_order_id=str(protective["order_id"]))
            elif protective:
                self.store.update_live_trade(trade["id"], status="PROTECTION_FAILED",
                                            protection_order_id=str(protective["order_id"]),
                                            error=str(protective.get("status_message") or "Protective order rejected")[:300])
                self.store.add_alert("error", f"AUTONOMIQ protection order failed for {trade['tradingsymbol']}",
                                     trade["symbol"])
                trade["status"] = "PROTECTION_FAILED"
                return
            else:
                trigger = float(trade.get("trailing_sl") or trade["stop_loss"])
                limit = max(TICK_SIZE, _floor_tick(trigger - 2 * TICK_SIZE, TICK_SIZE))
                attempt = int(trade.get("protection_attempt") or 0) + 1
                tag = _protection_tag({**trade, "protection_attempt": attempt})
                self.store.update_live_trade(trade["id"], status="PROTECTION_SUBMITTING",
                                             protection_attempt=attempt, last_broker_sync=now.isoformat())
                try:
                    order_id = kite.place_order(
                        variety="regular", exchange=trade["exchange"], tradingsymbol=trade["tradingsymbol"],
                        transaction_type="SELL", quantity=owned, product="MIS", order_type="SL",
                        price=limit, trigger_price=trigger, validity="DAY", tag=tag,
                    )
                    if not order_id:
                        raise RuntimeError("Broker did not return a protective order ID")
                except Exception as exc:
                    self.store.update_live_trade(
                        trade["id"], status="PROTECTION_UNKNOWN",
                        error=f"Protective order result uncertain ({type(exc).__name__}); manual broker check required",
                    )
                    self.store.audit("autonomiq-pro", "protection_unknown",
                                     {"trade_id": trade["id"], "error": type(exc).__name__})
                    logger.exception("AUTONOMIQ PRO protective order outcome uncertain")
                    return
                self.store.update_live_trade(
                    trade["id"], status="OPEN", protection_order_id=str(order_id),
                    expected_order_type="SL", expected_price=limit, expected_trigger=trigger,
                    error=None, last_broker_sync=now.isoformat(),
                )
                self.store.audit("autonomiq-pro", "protective_order_submitted",
                                 {"trade_id": trade["id"], "order_id": str(order_id), "trigger": trigger})
                trade.update(status="OPEN", protection_order_id=str(order_id), trailing_sl=trigger)
                return
        elif trade["status"] in {"PROTECTION_UNKNOWN", "PROTECTION_SUBMITTING"}:
            if protective:
                if _order_status(protective) in TERMINAL_ORDERS:
                    self.store.update_live_trade(
                        trade["id"], status="PROTECTION_FAILED",
                        protection_order_id=str(protective["order_id"]),
                        error=str(protective.get("status_message") or "Protective order rejected")[:300],
                    )
                    self.store.add_alert("error", f"AUTONOMIQ protection order failed for {trade['tradingsymbol']}",
                                         trade["symbol"])
                    return
                self.store.update_live_trade(trade["id"], status="OPEN",
                                            protection_order_id=str(protective["order_id"]), error=None)
                trade.update(status="OPEN", protection_order_id=str(protective["order_id"]))
            else:
                return
        elif trade["status"] == "PROTECTION_FAILED":
            self._submit_emergency_exit(kite, trade, cfg, now)
            return

        if trade["status"] == "PROTECTION_FAILED":
            return
        protective = _find_order(orders, trade.get("protection_order_id"), _protection_tag(trade))
        if not protective or _order_status(protective) in TERMINAL_ORDERS:
            return

        qkey = f"{trade['exchange']}:{trade['tradingsymbol']}"
        try:
            cached_mark = self.quote_mark(trade, cfg, datetime.now(IST))
            if cached_mark is None:
                quote = kite.quote([qkey]).get(qkey) or {}
                quote_at = parse_ts(quote.get("timestamp"))
                bid = _best_price((quote.get("depth") or {}).get("buy"))
            else:
                quote_at = parse_ts(cached_mark["last_quote_at"])
                bid = cached_mark["last_price"]
        except Exception as exc:
            message = f"Position quote failed ({type(exc).__name__}); existing protection remains active"
            self.store.update_live_trade(trade["id"], error=message)
            if trade.get("error") != message:
                self.store.add_alert("error", f"AUTONOMIQ position quote unavailable for {trade['tradingsymbol']}",
                                     trade["symbol"])
            logger.exception("AUTONOMIQ PRO position quote failed")
            return
        age = (datetime.now(IST) - quote_at).total_seconds() if quote_at else None
        if quote_at is None or age is None or age < -3 or age > min(5, cfg.max_option_quote_age_seconds) or bid <= 0:
            return
        self.store.update_live_trade(
            trade["id"], **_position_mark(trade, bid, quote_at, cfg.estimated_round_trip_cost_rupees),
            last_broker_sync=now.isoformat(),
        )
        entry_price = float(trade.get("entry_price") or trade["entry"])
        current_stop = float(trade.get("trailing_sl") or trade["stop_loss"])
        highest = max(float(trade.get("highest_bid") or bid), bid)
        target1, target2 = float(trade["target1"]), float(trade["target2"])
        close_reason = trade.get("close_requested")
        if not close_reason and now.time() >= square_off:
            close_reason = "SQUARE_OFF"
        if not close_reason and bid >= target2:
            close_reason = "TARGET2"
        if trade["status"] == "EXIT_PENDING":
            self._record_exit(trade, protective, now, cfg)
            if _order_status(protective) not in TERMINAL_ORDERS:
                self._reprice_exit(kite, trade, protective, bid, cfg, now)
            return
        if close_reason:
            self._convert_protection_to_exit(kite, trade, protective, bid, cfg, close_reason, now)
            return
        if trade.get("risk_model") == "HYBRID_V1" and bid <= current_stop:
            self._convert_protection_to_exit(kite, trade, protective, bid, cfg, "TRAILING_STOP", now)
            return

        option_atr = max(float(trade["risk"]) / 2, TICK_SIZE)
        structural_stop = current_stop
        if trade.get("risk_model") == "HYBRID_V1":
            try:
                _, candles = self.collector.execution_candles(
                    trade["symbol"], trade["exchange"], trade["tradingsymbol"], datetime.now(IST))
                option_atr = measured_atr(candles)
                structural_stop = _floor_tick(price_structure(candles)["support"] - .2 * option_atr, TICK_SIZE)
            except (KiteException, ValueError, KeyError) as exc:
                message = f"Hybrid trailing data unavailable; existing stop retained ({type(exc).__name__})"
                logger.warning("AUTONOMIQ PRO trailing history unavailable for %s: %s", trade["symbol"], exc)
                self.store.update_live_trade(trade["id"], error=message)
                if trade.get("error") != message:
                    self.store.add_alert("warning", message, trade["symbol"])
                return
        decision = trailing_stop(
            entry=entry_price, initial_stop=float(trade["stop_loss"]), current_stop=current_stop,
            highest_bid=highest, current_bid=bid, option_atr=option_atr,
            quantity=owned, estimated_round_trip_cost=cfg.estimated_round_trip_cost_rupees,
            estimated_exit_slippage=entry_price * owned * cfg.max_exit_slippage_pct / 100,
            tick_size=TICK_SIZE,
        )
        new_stop = decision.stop
        if decision.activated:
            new_stop = max(new_stop, structural_stop)
        if bid >= target1:
            slippage = entry_price * cfg.max_exit_slippage_pct / 100 if trade.get("risk_model") == "HYBRID_V1" else 0
            new_stop = max(new_stop, _ceil_tick(
                entry_price + cfg.estimated_round_trip_cost_rupees / owned + slippage, TICK_SIZE))
        if new_stop >= bid:
            self._convert_protection_to_exit(kite, trade, protective, bid, cfg, "TRAILING_STOP", now)
        elif new_stop > current_stop + TICK_SIZE / 2:
            limit = max(TICK_SIZE, _floor_tick(new_stop - 2 * TICK_SIZE, TICK_SIZE))
            try:
                kite.modify_order(
                    variety="regular", order_id=protective["order_id"], quantity=owned,
                    order_type="SL", price=limit, trigger_price=new_stop, validity="DAY",
                )
            except Exception as exc:
                self.store.update_live_trade(trade["id"], error=f"Stop update failed ({type(exc).__name__})")
                self.store.add_alert("error", f"AUTONOMIQ trailing-stop update failed for {trade['tradingsymbol']}",
                                     trade["symbol"])
                logger.exception("AUTONOMIQ PRO stop modification failed")
                return
            self.store.update_live_trade(
                trade["id"], trailing_sl=new_stop, expected_order_type="SL",
                expected_price=limit, expected_trigger=new_stop, modifications=int(trade.get("modifications") or 0) + 1,
                error=None,
            )
            self.store.audit("autonomiq-pro", "trailing_stop_modified",
                             {"trade_id": trade["id"], "trigger": new_stop, "order_id": str(protective["order_id"])})

    def _convert_protection_to_exit(self, kite, trade: dict, protective: dict, bid: float,
                                    cfg: AutonomiqConfig, reason: str, now: datetime) -> None:
        if _order_type(protective) == "LIMIT" and trade.get("exit_order_id") == str(protective["order_id"]):
            self._reprice_exit(kite, trade, protective, bid, cfg, now)
            return
        owned = max(0, int(trade.get("entry_filled") or 0) - int(trade.get("exit_filled") or 0))
        limit = max(TICK_SIZE, _floor_tick(bid * (1 - cfg.max_exit_slippage_pct / 100), TICK_SIZE))
        try:
            kite.modify_order(
                variety="regular", order_id=protective["order_id"], quantity=owned,
                order_type="LIMIT", price=limit, trigger_price=0, validity="DAY",
            )
        except Exception as exc:
            self.store.update_live_trade(trade["id"], error=f"Exit conversion failed ({type(exc).__name__}); protective order retained")
            self.store.add_alert("error", f"AUTONOMIQ exit order could not be submitted for {trade['tradingsymbol']}",
                                 trade["symbol"])
            logger.exception("AUTONOMIQ PRO exit conversion failed")
            return
        self.store.update_live_trade(
            trade["id"], status="EXIT_PENDING", exit_order_id=str(protective["order_id"]),
            close_requested=reason, expected_order_type="LIMIT", expected_price=limit, expected_trigger=None,
            exit_order_filled=0, exit_order_value=0,
            modifications=int(trade.get("modifications") or 0) + 1, error=None,
        )
        self.store.audit("autonomiq-pro", "live_exit_submitted", {
            "trade_id": trade["id"], "order_id": str(protective["order_id"]), "reason": reason, "limit": limit,
        })

    def _reprice_exit(self, kite, trade: dict, order: dict, bid: float, cfg: AutonomiqConfig, now: datetime) -> None:
        current = float(order.get("price") or 0)
        desired = max(TICK_SIZE, _floor_tick(bid * (1 - cfg.max_exit_slippage_pct / 100), TICK_SIZE))
        if current > 0 and desired >= current - TICK_SIZE / 2:
            return
        try:
            kite.modify_order(variety="regular", order_id=order["order_id"], price=desired,
                              order_type="LIMIT", trigger_price=0, validity="DAY")
        except Exception as exc:
            self.store.update_live_trade(trade["id"], error=f"Exit repricing failed ({type(exc).__name__})")
            logger.exception("AUTONOMIQ PRO exit repricing failed")
            return
        self.store.update_live_trade(trade["id"], expected_price=desired, last_broker_sync=now.isoformat(),
                                     modifications=int(trade.get("modifications") or 0) + 1, error=None)

    def _submit_emergency_exit(self, kite, trade: dict, cfg: AutonomiqConfig, now: datetime) -> None:
        key = f"{trade['exchange']}:{trade['tradingsymbol']}"
        try:
            quote = kite.quote([key]).get(key) or {}
            quote_at = parse_ts(quote.get("timestamp"))
            age = (datetime.now(IST) - quote_at).total_seconds() if quote_at else None
            bid = _best_price((quote.get("depth") or {}).get("buy"))
            if age is None or age < -3 or age > min(5, cfg.max_option_quote_age_seconds) or bid <= 0:
                self.store.update_live_trade(trade["id"], error="Fresh bid unavailable; protective order rejected")
                return
        except Exception as exc:
            self.store.update_live_trade(trade["id"], error=f"Emergency exit quote failed ({type(exc).__name__})")
            logger.exception("AUTONOMIQ PRO emergency exit quote failed")
            return
        quantity = max(0, int(trade.get("entry_filled") or 0) - int(trade.get("exit_filled") or 0))
        if quantity <= 0:
            return
        attempt = int(trade.get("exit_attempt") or 0) + 1
        tag = _exit_tag({**trade, "exit_attempt": attempt})
        limit = max(TICK_SIZE, _floor_tick(bid * (1 - cfg.max_exit_slippage_pct / 100), TICK_SIZE))
        self.store.update_live_trade(trade["id"], status="EXIT_SUBMITTING", exit_attempt=attempt,
                                     close_requested=trade.get("close_requested") or "PROTECTION_FAILED",
                                     last_quote_at=quote_at.isoformat())
        try:
            order_id = kite.place_order(
                variety="regular", exchange=trade["exchange"], tradingsymbol=trade["tradingsymbol"],
                transaction_type="SELL", quantity=quantity, product="MIS", order_type="LIMIT",
                price=limit, validity="DAY", tag=tag,
            )
            if not order_id:
                raise RuntimeError("Broker did not return an order ID")
        except Exception as exc:
            self.store.update_live_trade(trade["id"], status="EXIT_UNKNOWN",
                                         error=f"Emergency exit result uncertain ({type(exc).__name__}); reconcile in Kite")
            self.store.audit("autonomiq-pro", "emergency_exit_unknown",
                             {"trade_id": trade["id"], "tag": tag, "error": type(exc).__name__})
            logger.exception("AUTONOMIQ PRO emergency exit outcome uncertain")
            return
        self.store.update_live_trade(trade["id"], status="EXIT_PENDING", exit_order_id=str(order_id),
                                     expected_order_type="LIMIT", expected_price=limit, expected_trigger=None,
                                     exit_order_filled=0, exit_order_value=0, error=None)
        self.store.audit("autonomiq-pro", "emergency_exit_submitted", {
            "trade_id": trade["id"], "order_id": str(order_id), "tag": tag, "limit": limit,
        })

    def _record_exit(self, trade: dict, order: dict, now: datetime, cfg: AutonomiqConfig) -> None:
        order_id = str(order.get("order_id") or "")
        is_current_exit = order_id == str(trade.get("exit_order_id") or "")
        filled = int(order.get("filled_quantity") or 0)
        prior_order_filled = int(trade.get("exit_order_filled") or 0) if is_current_exit else 0
        prior_order_value = float(trade.get("exit_order_value") or 0) if is_current_exit else 0
        delta = max(0, filled - prior_order_filled)
        prior = int(trade.get("exit_filled") or 0)
        entry_filled = int(trade.get("entry_filled") or 0)
        exit_avg = float(order.get("average_price") or 0)
        if delta <= 0:
            if (_order_status(order) in TERMINAL_ORDERS and prior < entry_filled
                    and trade["status"] != "PROTECTION_PENDING"):
                self.store.update_live_trade(
                    trade["id"], status="PROTECTION_PENDING", protection_order_id=None,
                    protection_attempt=int(trade.get("protection_attempt") or 0) + 1,
                    error="Exit order ended before full fill; protective order must be restored",
                )
            return
        if exit_avg <= 0:
            return
        order_value = exit_avg * filled
        delta_value = max(0, order_value - prior_order_value)
        delta_avg = delta_value / delta if delta_value else exit_avg
        cumulative = prior + delta
        old_avg = float(trade.get("exit_price") or 0)
        new_avg = ((old_avg * prior) + (delta_avg * delta)) / cumulative
        realized = (new_avg - float(trade.get("entry_price") or trade["entry"])) * cumulative
        is_closed = cumulative >= entry_filled
        fields = {
            "exit_filled": cumulative, "exit_price": round(new_avg, 2), "pnl": round(realized - cfg.estimated_round_trip_cost_rupees, 2),
            "exit_order_filled": filled, "exit_order_value": order_value, "last_broker_sync": now.isoformat(),
        }
        if is_closed:
            fields.update(status="CLOSED", closed_at=now.isoformat(), error=None,
                          exit_reason=trade.get("close_requested") or
                          ("STOP_LOSS" if _order_type(order) == "SL"
                           or order_id == str(trade.get("protection_order_id") or "") else "EXIT"))
        else:
            if _order_status(order) in TERMINAL_ORDERS:
                fields.update(status="PROTECTION_PENDING", protection_order_id=None,
                              protection_attempt=int(trade.get("protection_attempt") or 0) + 1,
                              exit_order_id=order_id,
                              error="Exit order ended before full fill; protective order must be restored")
            else:
                fields.update(status="EXIT_PENDING", exit_order_id=order_id)
        self.store.update_live_trade(trade["id"], **fields)
        self.store.audit("autonomiq-pro", "live_exit_fill", {
            "trade_id": trade["id"], "order_id": str(order.get("order_id")), "filled_quantity": filled,
            "average_price": exit_avg, "pnl": fields["pnl"], "closed": is_closed,
        })

    async def cancel_pending_entries(self) -> None:
        async with self._lock:
            try:
                await asyncio.to_thread(self._cancel_pending_entries_sync)
            except Exception:
                logger.exception("AUTONOMIQ PRO could not reconcile pending entry cancellation")
                self.store.add_alert("error", "Live entries are OFF; pending entry cancellation needs broker reconciliation")

    def _cancel_pending_entries_sync(self) -> None:
        trades = [t for t in self.store.open_live_trades(limit=10000)
                  if t["status"] in {"ENTRY_PENDING", "ENTRY_SUBMITTING", "ENTRY_UNKNOWN"}]
        if not trades:
            return
        kite = self.collector.gateway.client()
        account_id = str((kite.profile() or {}).get("user_id") or "")
        if not account_id or any(str(trade.get("account_id") or "") != account_id for trade in trades):
            raise LiveExecutionBlocked("Pending AUTONOMIQ orders belong to a different Zerodha account; no cancellation sent")
        orders = kite.orders()
        for trade in trades:
            order = _find_order({str(o.get("order_id")): o for o in orders}, trade.get("entry_order_id"),
                                trade["tag"] + "E")
            if not order or _order_status(order) in TERMINAL_ORDERS:
                continue
            try:
                kite.cancel_order(variety=order.get("variety") or "regular", order_id=order["order_id"])
            except Exception as exc:
                self.store.update_live_trade(trade["id"], cancel_requested=True,
                                             error=f"Entry cancellation pending ({type(exc).__name__})")
                self.store.audit("autonomiq-pro", "entry_cancel_unknown",
                                 {"trade_id": trade["id"], "order_id": str(order["order_id"])})
                logger.exception("AUTONOMIQ PRO pending entry cancellation failed")
            else:
                self.store.update_live_trade(trade["id"], cancel_requested=True)
                self.store.audit("autonomiq-pro", "entry_cancel_requested",
                                 {"trade_id": trade["id"], "order_id": str(order["order_id"])})


def _position_mark(trade: dict, bid: float, at: datetime, fees: float) -> dict:
    entry = float(trade.get("entry_price") or trade["entry"])
    exited = int(trade.get("exit_filled") or 0)
    remaining = max(0, int(trade.get("entry_filled") or 0) - exited)
    pnl = ((float(trade.get("exit_price") or 0) - entry) * exited
           + (bid - entry) * remaining - fees)
    return {
        "last_price": bid, "last_quote_at": at.isoformat(),
        "highest_bid": max(float(trade.get("highest_bid") or bid), bid),
        "pnl": round(pnl, 2), "fees": fees,
    }


def _find_order(orders: dict[str, dict], order_id: Any, tag: str) -> dict | None:
    if order_id is not None and str(order_id) in orders:
        return orders[str(order_id)]
    return next((order for order in orders.values() if order.get("tag") == tag), None)


def _protection_tag(trade: dict) -> str:
    return f"{trade['tag']}S{int(trade.get('protection_attempt') or 0):04d}"


def _exit_tag(trade: dict) -> str:
    return f"{trade['tag']}X{int(trade.get('exit_attempt') or 0):04d}"


def _order_status(order: dict) -> str:
    return str(order.get("status") or "").upper()


def _order_type(order: dict) -> str:
    return str(order.get("order_type") or "").upper()


def _best_price(levels: Any) -> float:
    try:
        return float((levels or [{}])[0].get("price") or 0)
    except (AttributeError, TypeError, ValueError):
        return 0.0


def _ceil_tick(price: float, tick: float) -> float:
    return round(math.ceil(price / tick - 1e-10) * tick, 8)


def _floor_tick(price: float, tick: float) -> float:
    return round(math.floor(price / tick + 1e-10) * tick, 8)
