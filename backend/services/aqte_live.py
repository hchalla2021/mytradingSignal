"""Explicitly armed AQTE automation. Unknown broker outcomes are never retried."""

import asyncio
import copy
import ipaddress
import json
import logging
import math
import os
import sqlite3
import threading
import time
from contextlib import closing
from datetime import datetime
from pathlib import Path
from uuid import uuid4

import requests
from kiteconnect import KiteConnect

from config import get_settings
from services.aqte_engine import Contract, IST, Policy, SYMBOLS, day, round_tick, session
from services.aqte_daily_control import IndexControl, counts, defaults, quality_reason

logger = logging.getLogger(__name__)
TERMINAL = {"COMPLETE", "CANCELLED", "REJECTED"}


class LiveBlocked(ValueError):
    pass


def outbound_ip():
    """Public-IP service receives no account data, keys, tokens or order payloads."""
    with requests.Session() as client:
        client.trust_env = False
        response = client.get("https://api.ipify.org", timeout=5)
        response.raise_for_status()
        return str(ipaddress.IPv4Address(response.text.strip()))


def broker_client():
    settings = get_settings()
    if not settings.zerodha_api_key or not settings.zerodha_access_token:
        raise LiveBlocked("Existing Kite access token is missing; sign in using the existing login")
    client = KiteConnect(api_key=settings.zerodha_api_key, timeout=5)
    client.set_access_token(settings.zerodha_access_token)
    return client


class AQTELiveService:
    def __init__(self, path=None, market=None, settings=None, broker=None, ip_check=None):
        self.path = Path(path or Path(__file__).resolve().parent.parent / "data" / "aqte" / "live.sqlite3")
        self.market = market
        self.settings = settings or get_settings
        self.broker = broker or broker_client
        self.ip_check = ip_check or outbound_ip
        self.lock = threading.RLock()
        self.state = {"armed_day": None, "automation_on": False, "killed": False, "account": None,
                      "active": None, "trades": [], "used": [], "daily_controls": defaults(), "daily_entries": []}
        self.proposals = {}
        self.check = None
        self.error = None
        self.ready = False
        self.task = None
        self.stop_event = asyncio.Event()
        self.owner_file = None

    def acquire_owner(self):
        self.owner_file = open(str(self.path) + ".lock", "a+b")
        try:
            if os.name == "nt":
                import msvcrt
                self.owner_file.write(b"0")
                self.owner_file.flush()
                self.owner_file.seek(0)
                msvcrt.locking(self.owner_file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.owner_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            self.owner_file.close()
            self.owner_file = None
            raise LiveBlocked("Another AQTE live process owns this journal; use a single backend worker") from exc

    def release_owner(self):
        if self.owner_file:
            self.owner_file.close()
            self.owner_file = None

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.acquire_owner()
        with closing(sqlite3.connect(str(self.path), timeout=10)) as db, db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS live_state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS live_audit (
                    id INTEGER PRIMARY KEY, at REAL NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL);
            """)
            row = db.execute("SELECT payload FROM live_state WHERE id=1").fetchone()
            if row:
                self.state = json.loads(row[0])
        self.state["armed_day"] = None
        self.state["automation_on"] = False
        self.state.setdefault("daily_controls", defaults())
        self.state.setdefault("daily_entries", [])
        if set(self.state["daily_controls"]) != set(SYMBOLS):
            raise LiveBlocked("Invalid saved daily-control index set; journal requires repair before trading")
        self.state["daily_controls"] = {
            symbol: IndexControl(**control).model_dump()
            for symbol, control in self.state["daily_controls"].items()
        }
        self.save("RESTART_DISARMED")
        self.ready = True

    def save(self, kind, **payload):
        try:
            with closing(sqlite3.connect(str(self.path), timeout=10)) as db, db:
                db.execute("INSERT INTO live_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
                           (json.dumps(self.state, allow_nan=False),))
                db.execute("INSERT INTO live_audit(at,kind,payload) VALUES(?,?,?)",
                           (time.time(), kind, json.dumps(payload, allow_nan=False)))
        except (sqlite3.Error, OSError, ValueError):
            self.ready = False
            self.state["armed_day"] = None
            self.state["automation_on"] = False
            logger.exception("AQTE live journal failed; broker mutations blocked")
            raise

    def status(self):
        with self.lock:
            cfg = self.settings()
            active = copy.deepcopy(self.state["active"])
            if active:
                market = self.service()
                with market.lock:
                    quantity = max(0, active["filled"] - active.get("exited", 0))
                    order = {
                        **active, "token": active["contract"]["token"], "quantity": quantity,
                        "entry_cost": self.costs(active["entry_price"], active["filled"]) *
                            quantity / active["filled"] if active["filled"] else 0,
                    }
                    active["metrics"] = market.engine.position_metrics(
                        order, time.time(), healthy=market.started and not market.failed.is_set())
            return {
                "enabled": cfg.aqte_live_enabled, "paper_validated": cfg.aqte_live_paper_validated,
                "expected_ip": cfg.aqte_live_static_ip, "preflight": copy.deepcopy(self.check),
                "armed": self.state["armed_day"] == day(time.time()) and not self.state["killed"],
                "automation_on": bool(self.state.get("automation_on")) and
                    self.state["armed_day"] == day(time.time()) and not self.state["killed"],
                "killed": self.state["killed"], "active": active, "error": self.error,
                "ready": self.ready, "trades": copy.deepcopy(self.state["trades"][-20:]),
                "limits": {"risk_per_trade": cfg.aqte_live_risk_per_trade,
                           "daily_loss": cfg.aqte_live_daily_loss, "max_trades": cfg.aqte_live_max_trades,
                           "max_losses": cfg.aqte_live_max_losses, "max_lots": 1},
            }

    def pins(self):
        with self.lock:
            active = self.state["active"]
            return {active["contract"]["token"]: Contract(**active["contract"])} if active else {}

    def control_reason(self, symbol, signal):
        control = self.state["daily_controls"][symbol]
        if not control["enabled"]:
            return "Index auto trading disabled"
        count = counts(self.state, time.time(), symbol)
        if count["executed"] + count["reserved"] >= control["max_trades"]:
            return "Daily index trade limit reached"
        total = counts(self.state, time.time())
        if total["executed"] + total["reserved"] >= self.settings().aqte_live_max_trades:
            return "Account-wide daily trade cap reached"
        pnl = sum(t["net_pnl"] for t in self.state["trades"]
                  if t["symbol"] == symbol and day(t["entry_at"]) == day(time.time()))
        if pnl <= -min(control["daily_loss"], self.settings().aqte_live_daily_loss):
            return "Daily index loss limit reached"
        for entry in self.state["daily_entries"]:
            if entry["symbol"] == symbol and day(entry["at"]) == day(time.time()) and (
                entry.get("filled") or entry.get("pending")
            ) and entry.get("token") == (signal.get("contract") or {}).get("token"):
                price = (signal.get("entry") or {}).get("maximum")
                if price and (time.time() - entry["at"] < 300 or abs(price - entry["price"]) / entry["price"] < 0.01):
                    return "Duplicate/near-identical contract entry blocked"
        return quality_reason(signal, control)

    def daily_controls(self):
        with self.lock:
            snapshot = self.service().snapshot()
            total = counts(self.state, time.time())
            result = {}
            for symbol, control in self.state["daily_controls"].items():
                signal = snapshot["data"][symbol]
                count = counts(self.state, time.time(), symbol)
                reason = self.control_reason(symbol, signal)
                if not snapshot["recording"] or snapshot.get("fault"):
                    reason = "Market recorder unavailable"
                reached = "limit reached" in (reason or "").lower() or "cap reached" in (reason or "").lower()
                live = self.state.get("automation_on") and self.state["armed_day"] == day(time.time()) and not self.state["killed"]
                result[symbol] = dict(
                    config=control, **count,
                    remaining=max(0, control["max_trades"] - count["executed"] - count["reserved"]),
                    status="LIMIT REACHED" if reached else "ACTIVE" if live and not reason else "WAITING",
                    reason=reason or ("Ready; automation OFF or not armed" if not live else "Risk/broker checks required before entry"),
                    direction=(signal.get("intelligence") or {}).get("supertrend") or "UNKNOWN",
                    opportunity=dict(decision=signal["decision"], confidence=signal.get("confidence"),
                                     entry=signal.get("entry"), contract=signal.get("contract"),
                                     reasons=signal.get("reasons", [])),
                )
            cap = self.settings().aqte_live_max_trades
            return dict(data=result, account=dict(max_trades=cap, **total,
                        remaining=max(0, cap - total["executed"] - total["reserved"])),
                        editable=self.ready and not self.state.get("automation_on"),
                        limits_editable=self.ready, long_only=True)

    def update_control(self, symbol, config):
        with self.lock:
            if not self.ready:
                raise LiveBlocked("Live journal unavailable; preferences not saved")
            if self.state.get("automation_on"):
                raise LiveBlocked("Switch automation OFF before changing daily controls")
            if symbol not in SYMBOLS:
                raise LiveBlocked("Unsupported daily-control index")
            self.state["daily_controls"][symbol] = IndexControl(**config).model_dump()
            self.proposals.clear()
            self.save("DAILY_CONTROL_SAVED", symbol=symbol, config=self.state["daily_controls"][symbol])
            return self.daily_controls()

    def update_limit(self, symbol, maximum):
        with self.lock:
            if not self.ready:
                raise LiveBlocked("Live journal unavailable; limit not saved")
            if symbol not in SYMBOLS:
                raise LiveBlocked("Unsupported daily-control index")
            control = IndexControl(**{**self.state["daily_controls"][symbol], "max_trades": maximum})
            self.state["daily_controls"][symbol] = control.model_dump()
            self.proposals.clear()
            self.save("DAILY_LIMIT_SAVED", symbol=symbol, max_trades=maximum)
            return self.daily_controls()

    def service(self):
        if self.market is not None:
            return self.market
        from services.aqte_service import get_aqte_service
        return get_aqte_service()

    def config_guard(self):
        cfg = self.settings()
        if not self.ready:
            raise LiveBlocked("Live journal is unavailable")
        if not cfg.aqte_live_enabled:
            raise LiveBlocked("AQTE_LIVE_ENABLED is false in centralized backend settings")
        if not cfg.aqte_live_paper_validated:
            raise LiveBlocked("Paper validation not approved: AQTE_LIVE_PAPER_VALIDATED is false")
        if not cfg.force_outbound_ipv4:
            raise LiveBlocked("FORCE_OUTBOUND_IPV4 must be enabled")
        if cfg.algo_auto_trade_enabled and cfg.algo_auto_trade_mode.strip().lower() == "live":
            raise LiveBlocked("Disable other live algo execution before using the one-lot AQTE pilot")
        if any(os.getenv(name) for name in ("HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY",
                                            "https_proxy", "http_proxy", "all_proxy")):
            raise LiveBlocked("Proxy routing must be removed before verifying direct broker egress")
        expected = ipaddress.IPv4Address(cfg.aqte_live_static_ip)
        if not expected.is_global:
            raise LiveBlocked("Configured static IP must be a public IPv4 address")
        return cfg

    def account_clear(self, broker, token=None):
        positions = broker.positions()
        for position in positions["net"]:
            if position["quantity"] and (token is None or int(position["instrument_token"]) == token):
                raise LiveBlocked("Broker account/instrument already has exposure; reconcile it in Kite first")
        for order in broker.orders():
            if order["status"] not in TERMINAL and (
                token is None or int(order["instrument_token"]) == token
            ):
                raise LiveBlocked("Broker account/instrument already has a working order")

    def preflight(self):
        with self.lock:
            self.check = None
            cfg = self.config_guard()
            if self.state["active"]:
                raise LiveBlocked("Reconcile active live trade before running entry preflight")
            ip = self.ip_check()
            if ip != cfg.aqte_live_static_ip:
                raise LiveBlocked(f"Outbound IP {ip} does not match allowlisted IP {cfg.aqte_live_static_ip}")
            broker = self.broker()
            account = broker.profile()["user_id"]
            if not account:
                raise LiveBlocked("Broker account identity unavailable")
            self.account_clear(broker)
            self.check = {"ip": ip, "at": time.time(), "account": account,
                          "note": "Public IPv4 matched; Kite remains authoritative for broker IP permissions"}
            self.error = None
            self.save("PREFLIGHT_OK", ip=ip, account=account)
            return self.status()

    def arm(self):
        with self.lock:
            self.config_guard()
            if self.state["killed"]:
                raise LiveBlocked("Emergency stop is latched; operator review is required before rearming")
            if not self.check or not 0 <= time.time() - self.check["at"] <= 60:
                raise LiveBlocked("Run a successful preflight within 60 seconds before arming")
            if not session(time.time()):
                raise LiveBlocked("Arming is only permitted in the regular market session")
            self.state.update(armed_day=day(time.time()), automation_on=False, account=self.check["account"])
            self.save("ARMED", account=self.state["account"])
            return self.status()

    def entry_guard(self, broker):
        cfg = self.config_guard()
        now = time.time()
        if not self.state.get("automation_on"):
            raise LiveBlocked("Automated real trading is OFF; no new entry orders permitted")
        if self.state["killed"] or self.state["armed_day"] != day(now):
            raise LiveBlocked("Live trading is not armed for this session")
        if not session(now) or datetime.fromtimestamp(now, IST).hour * 60 + datetime.fromtimestamp(now, IST).minute >= 915:
            raise LiveBlocked("Live entries permitted only from 09:15 until 15:15 IST")
        if self.state["active"]:
            raise LiveBlocked("Only one live trade may be pending/open across all indices")
        if self.ip_check() != cfg.aqte_live_static_ip:
            self.state["armed_day"] = None
            self.state["automation_on"] = False
            self.save("IP_MISMATCH_DISARMED")
            raise LiveBlocked("Backend outbound IP changed; live session disarmed")
        if broker.profile()["user_id"] != self.state["account"]:
            raise LiveBlocked("Broker account identity changed")
        self.account_clear(broker)
        trades = [t for t in self.state["trades"] if day(t["entry_at"]) == day(now)]
        if len(trades) >= cfg.aqte_live_max_trades:
            raise LiveBlocked("Maximum daily live trades reached")
        losses = 0
        for trade in reversed(trades):
            if trade["net_pnl"] >= 0:
                break
            losses += 1
        if losses >= cfg.aqte_live_max_losses:
            raise LiveBlocked("Consecutive live loss limit reached")
        pnl = sum(t["net_pnl"] for t in trades)
        if pnl <= -cfg.aqte_live_daily_loss:
            raise LiveBlocked("Daily live loss limit reached")
        return cfg, pnl

    def set_automation(self, enabled):
        with self.lock:
            if not enabled:
                self.state["automation_on"] = False
                self.proposals.clear()
                self.save("AUTOMATION_OFF", note="New entries blocked; existing protection and exits continue")
                return self.status()
            self.config_guard()
            if self.state["killed"] or self.state["armed_day"] != day(time.time()):
                raise LiveBlocked("Complete IP preflight and explicitly arm today's live session before switching ON")
            if not session(time.time()):
                raise LiveBlocked("Automation can only start during the regular market session")
            dt = datetime.fromtimestamp(time.time(), IST)
            if dt.hour * 60 + dt.minute >= 915:
                raise LiveBlocked("No new automated entries after 15:15 IST")
            self.state["automation_on"] = True
            self.error = None
            self.save("AUTOMATION_ON", account=self.state["account"])
            return self.status()

    def automated_entry(self):
        with self.lock:
            if not self.state.get("automation_on"):
                return
            if self.state["armed_day"] != day(time.time()) or self.state["killed"]:
                self.state["automation_on"] = False
                self.save("AUTOMATION_SESSION_ENDED")
                return
            dt = datetime.fromtimestamp(time.time(), IST)
            if not session(time.time()) or dt.hour * 60 + dt.minute >= 915:
                self.state["automation_on"] = False
                self.save("AUTOMATION_ENTRY_CUTOFF")
                return
            if self.state["active"]:
                return
            snapshot = self.service().snapshot()
            if not snapshot["recording"] or snapshot.get("fault") or snapshot["risk"].get("killed"):
                raise LiveBlocked("Market recorder/risk state unavailable; automation stopped")
            for symbol in sorted(snapshot["data"], key=lambda s: snapshot["data"][s].get("confidence") or 0, reverse=True):
                signal = snapshot["data"][symbol]
                if self.control_reason(symbol, signal):
                    continue
                if signal["decision"] not in ("BUY CE", "BUY PE") or not signal.get("entry"):
                    continue
                key = f'{symbol}:{signal.get("strategy")}:{signal["intelligence"]["at"]}:{signal["contract"]["token"]}'
                if key in self.state["used"]:
                    continue
                proposal = self.proposal(symbol)
                self.confirm(proposal["id"])
                return

    def proposal(self, symbol):
        with self.lock:
            self.config_guard()
            if not self.state.get("automation_on"):
                raise LiveBlocked("Automated real trading is OFF")
            if self.state["armed_day"] != day(time.time()) or self.state["killed"]:
                raise LiveBlocked("Arm the live session first")
            market = self.service()
            snapshot = market.snapshot()
            signal = snapshot["data"][symbol]
            if not snapshot["recording"] or signal["decision"] not in ("BUY CE", "BUY PE") or not signal["entry"]:
                raise LiveBlocked("No fresh risk-checked AQTE setup for this index")
            reason = self.control_reason(symbol, signal)
            if reason:
                raise LiveBlocked(reason)
            with market.lock:
                quote = market.engine.options.get(signal["contract"]["token"])
                if not market.engine.fresh(quote, time.time()):
                    raise LiveBlocked("Option quote stale")
            now = time.time()
            contract = Contract(**signal["contract"])
            control = self.state["daily_controls"][symbol]
            entry = copy.deepcopy(signal["entry"])
            distance = entry["maximum"] * control["stop_percent"] / 100
            entry["stop"] = round_tick(max(contract.tick_size, entry["maximum"] - distance), contract.tick_size)
            entry["target"] = round_tick(entry["maximum"] + (entry["maximum"] - entry["stop"]) * control["target_rr"],
                                         contract.tick_size, up=True)
            if entry["quantity"] != contract.lot_size:
                raise LiveBlocked("Live pilot permits exactly one lot")
            if not 0 < entry["stop"] < entry["maximum"] < entry["target"]:
                raise LiveBlocked("Invalid live entry levels")
            risk = (entry["maximum"] - entry["stop"]) * contract.lot_size + self.costs(
                entry["maximum"], contract.lot_size) + self.costs(entry["stop"], contract.lot_size)
            reward = (entry["target"] - entry["maximum"]) * contract.lot_size - self.costs(
                entry["maximum"], contract.lot_size) - self.costs(entry["target"], contract.lot_size)
            if reward / risk < 1.5:
                raise LiveBlocked("Configured reward/risk after estimated costs is below 1.5")
            entry["reward_risk"] = round(reward / risk, 2)
            if risk > self.settings().aqte_live_risk_per_trade:
                raise LiveBlocked("One lot exceeds live per-trade risk limit")
            self.proposals = {key: value for key, value in self.proposals.items() if value["expires_at"] > now}
            key = uuid4().hex
            result = {"id": key, "symbol": symbol, "contract": signal["contract"],
                      "entry": entry, "risk": round(risk, 2), "signal_at": signal["at"],
                      "expires_at": now + 15,
                      "setup_key": f'{symbol}:{signal.get("strategy")}:{signal["intelligence"]["at"]}:{contract.token}'}
            self.proposals[key] = copy.deepcopy(result)
            return result

    def costs(self, price, quantity):
        policy = Policy()
        return policy.brokerage_per_order + price * quantity * policy.turnover_cost_fraction

    def confirm(self, proposal_id):
        with self.lock:
            proposal = self.proposals.pop(proposal_id, None)
            if proposal is None or time.time() >= proposal["expires_at"]:
                raise LiveBlocked("Order approval expired or already used; review a new proposal")
            broker = self.broker()
            cfg, pnl = self.entry_guard(broker)
            if proposal["setup_key"] in self.state["used"]:
                raise LiveBlocked("This strategy candle was already submitted")
            # Re-evaluate the backend setup; never trust browser prices or quantity.
            current = self.proposal(proposal["symbol"])
            self.proposals.pop(current["id"], None)
            if current["contract"] != proposal["contract"] or current["entry"] != proposal["entry"]:
                raise LiveBlocked("Signal or entry levels changed; review a new proposal")
            if proposal["risk"] > cfg.aqte_live_daily_loss + pnl:
                raise LiveBlocked("Trade exceeds remaining daily live loss budget")
            control = self.state["daily_controls"][proposal["symbol"]]
            index_pnl = sum(t["net_pnl"] for t in self.state["trades"]
                            if t["symbol"] == proposal["symbol"] and day(t["entry_at"]) == day(time.time()))
            if proposal["risk"] > min(control["daily_loss"], cfg.aqte_live_daily_loss) + index_pnl:
                raise LiveBlocked("Trade exceeds remaining daily index loss budget")
            c, entry = proposal["contract"], proposal["entry"]
            key = f'{c["exchange"]}:{c["trading_symbol"]}'
            raw = broker.quote([key])[key]
            from services.aqte_service import normalize
            quote = normalize(proposal["symbol"], "option", {
                **raw, "exchange_timestamp": raw.get("timestamp"), "volume_traded": raw.get("volume"),
            }, time.time())
            now = time.time()
            if not 0 <= now - quote.at <= 5 or not 0 < quote.bid <= quote.ask or (
                quote.ask_quantity < c["lot_size"] or quote.ask > entry["maximum"] or
                quote.ask <= entry["stop"] or (quote.ask - quote.bid) / quote.ask > 0.03
            ):
                raise LiveBlocked("Fresh broker ask/depth does not fit the approved no-chase limit")
            available = float(broker.margins("equity")["available"]["cash"])
            if not math.isfinite(available) or available < entry["maximum"] * c["lot_size"] + self.costs(entry["maximum"], c["lot_size"]):
                raise LiveBlocked("Insufficient broker cash for the one-lot premium")
            if time.time() >= proposal["expires_at"]:
                raise LiveBlocked("Approval expired during broker checks; review again")
            market = self.service()
            with market.lock:
                if not market.started or market.failed.is_set() or market.engine.killed or (
                    not market.engine.fresh(market.engine.options.get(c["token"]), time.time()) or
                    not market.engine.fresh(market.engine.spot.get(proposal["symbol"]), time.time()) or
                    not market.engine.fresh(market.engine.future.get(proposal["symbol"]), time.time())
                ):
                    raise LiveBlocked("Streaming quote became stale during broker checks")
            # Persist the unique intent BEFORE sending. A timeout is not a rejection.
            active = {
                "id": uuid4().hex[:16], "symbol": proposal["symbol"], "contract": c,
                "quantity": c["lot_size"], "limit": entry["maximum"], "stop": entry["stop"],
                "initial_stop": entry["stop"], "target": entry["target"], "peak": 0,
                "trailing_active": False,
                "trail_start_r": control["trail_start_r"], "daily_loss_limit": control["daily_loss"],
                "state": "ENTRY_UNKNOWN", "entry_id": None, "protect_id": None,
                "filled": 0, "entry_price": 0, "entry_at": now, "account": self.state["account"],
                "entry_day": day(now), "exit_requested": None, "error": None,
            }
            self.state["active"] = active
            self.state["daily_entries"].append(dict(id=active["id"], symbol=active["symbol"], at=now,
                                                   filled=False, pending=True, token=c["token"], price=entry["maximum"]))
            self.state["used"].append(proposal["setup_key"])
            self.save("ENTRY_INTENT", proposal=proposal, tag=active["id"] + "E")
            try:
                order_id = broker.place_order(
                    variety="regular", exchange=c["exchange"], tradingsymbol=c["trading_symbol"],
                    transaction_type="BUY", quantity=c["lot_size"], product="MIS",
                    order_type="LIMIT", price=entry["maximum"], validity="IOC", tag=active["id"] + "E")
                if not order_id:
                    raise ValueError("Broker did not return an order ID")
                active.update(entry_id=str(order_id), state="ENTRY_PENDING")
                self.save("ENTRY_ACK", order_id=str(order_id))
            except Exception:
                logger.exception("AQTE live entry outcome uncertain; automatic resubmission prohibited")
                active["error"] = "Entry outcome uncertain; reconcile broker order book. Do not retry."
                self.state["armed_day"] = None
                self.save("ENTRY_UNCERTAIN")
            return self.status()

    def find_order(self, orders, active, leg):
        field = "entry_id" if leg == "E" else "protect_id"
        order_id = active[field]
        found = [o for o in orders if (str(o["order_id"]) == order_id if order_id else o.get("tag") == active["id"] + leg)]
        if len(found) > 1:
            raise LiveBlocked("Duplicate tagged broker orders; manual intervention required")
        if not found:
            return None
        order = found[0]
        c = active["contract"]
        if order["exchange"] != c["exchange"] or order["tradingsymbol"] != c["trading_symbol"] or (
            order["transaction_type"] != ("BUY" if leg == "E" else "SELL") or order["product"] != "MIS" or
            int(order["quantity"]) != (active["quantity"] if leg == "E" else active["filled"])
        ):
            raise LiveBlocked("Broker order identity mismatch")
        active[field] = str(order["order_id"])
        return order

    def mutation(self, kind, broker, active, method, **kwargs):
        self.save(kind + "_INTENT", trade_id=active["id"], **kwargs)
        try:
            return getattr(broker, method)(**kwargs)
        except Exception:
            active["error"] = f"{kind} outcome uncertain; reconciliation required"
            self.state["armed_day"] = None
            self.save(kind + "_UNCERTAIN")
            logger.exception("AQTE live %s failed; preserving existing protection", kind)
            raise

    def reconcile(self):
        with self.lock:
            active = self.state["active"]
            if not active or not self.ready:
                return
            broker = self.broker()
            if broker.profile()["user_id"] != active["account"]:
                raise LiveBlocked("Active live position belongs to a different Kite account")
            if active["entry_day"] != day(time.time()):
                raise LiveBlocked("Previous-session live trade requires reconciliation in Kite before any further orders")
            orders = broker.orders()
            entry = self.find_order(orders, active, "E")
            if entry is None:
                raise LiveBlocked("Entry outcome unknown: no tagged order in broker book; no retry will be sent")
            filled = int(entry["filled_quantity"])
            if not 0 <= filled <= active["quantity"]:
                raise LiveBlocked("Unexpected broker filled quantity")
            for intent in self.state["daily_entries"]:
                if intent["id"] == active["id"]:
                    observed = dict(filled=filled > 0, pending=entry["status"] not in TERMINAL)
                    if any(intent[key] != value for key, value in observed.items()):
                        intent.update(observed)
                        self.save("DAILY_ENTRY_RECONCILED", order_id=entry["order_id"], **observed)
            if entry["status"] not in TERMINAL:
                # IOC should terminate promptly. Cancel remaining quantity, then await broker confirmation.
                if (filled or time.time() - active["entry_at"] > 10) and not active.get("cancel_requested"):
                    active["cancel_requested"] = True
                    self.mutation("ENTRY_CANCEL", broker, active, "cancel_order",
                                  variety="regular", order_id=active["entry_id"])
                    self.save("ENTRY_CANCEL_ACK")
                return
            if filled == 0:
                self.save("ENTRY_UNFILLED", status=entry["status"], reason=entry.get("status_message"))
                self.state["active"] = None
                self.save("ENTRY_FINISHED")
                return
            active["filled"], active["entry_price"] = filled, float(entry["average_price"])
            if not math.isfinite(active["entry_price"]) or active["entry_price"] <= 0:
                raise LiveBlocked("Broker fill price unavailable")
            if not active.get("fill_at"):
                active["fill_at"] = time.time()
            positions = broker.positions()["net"]
            matches = [p for p in positions if int(p["instrument_token"]) == active["contract"]["token"] and p["product"] == "MIS"]
            quantity = sum(int(p["quantity"]) for p in matches)
            protection = self.find_order(orders, active, "S")
            exited = int(protection["filled_quantity"]) if protection else 0
            if quantity != filled - exited:
                raise LiveBlocked("Live quantity differs from AQTE fills; possible manual intervention. Manage in Kite.")
            active["exited"] = exited
            if protection is None:
                if active["protect_id"] or active["state"] in ("PROTECTION_UNKNOWN", "PROTECTION_PENDING"):
                    raise LiveBlocked("Protective order outcome unknown; inspect Kite immediately. No duplicate SELL will be sent.")
                active.update(state="PROTECTION_UNKNOWN")
                c = active["contract"]
                stop = active["stop"]
                limit = round_tick(max(c["tick_size"], stop - max(2 * c["tick_size"], stop * 0.01)), c["tick_size"])
                order_id = self.mutation(
                    "PROTECTION", broker, active, "place_order", variety="regular",
                    exchange=c["exchange"], tradingsymbol=c["trading_symbol"], transaction_type="SELL",
                    quantity=filled, product="MIS", order_type="SL", trigger_price=stop,
                    price=limit, validity="DAY", tag=active["id"] + "S")
                if not order_id:
                    raise LiveBlocked("Protection acknowledgement missing; inspect Kite immediately")
                active.update(protect_id=str(order_id), state="PROTECTION_PENDING")
                self.save("PROTECTION_ACK", order_id=str(order_id), filled=filled)
                return
            if protection["status"] == "COMPLETE":
                exit_price = float(protection["average_price"])
                if exited != filled or not math.isfinite(exit_price) or exit_price <= 0:
                    raise LiveBlocked("Unexpected protective exit fill")
                trade = {**active, "exit_at": time.time(), "exit_price": exit_price,
                         "net_pnl": round((exit_price - active["entry_price"]) * filled -
                                          self.costs(active["entry_price"], filled) - self.costs(exit_price, filled), 2)}
                self.state["trades"].append(trade)
                self.state["active"] = None
                self.save("LIVE_CLOSED", trade=trade)
                return
            if protection["status"] in ("CANCELLED", "REJECTED"):
                raise LiveBlocked(f"Protective stop {protection['status']}: {protection.get('status_message')}; manage in Kite immediately")
            if protection["status"] not in ("TRIGGER PENDING", "OPEN"):
                active["state"] = "PROTECTION_PENDING"
                return
            active["protection_confirmed"] = True
            active["state"] = "PROTECTED" if protection["status"] == "TRIGGER PENDING" else "EXIT_PENDING"
            # Acknowledged modify/cancel must settle before another mutation is considered.
            if active.get("modify"):
                expected = active["modify"]
                if protection["order_type"] != expected["order_type"] or abs(float(protection["price"]) - expected["price"]) > 1e-6 or (
                    expected["order_type"] == "SL" and abs(float(protection["trigger_price"]) - expected["trigger_price"]) > 1e-6
                ):
                    raise LiveBlocked("Order modification outcome unresolved; no further mutation will be sent")
                active.pop("modify")
            if protection["order_type"] == "SL" and protection["status"] == "TRIGGER PENDING":
                broker_stop = float(protection["trigger_price"])
                if not math.isfinite(broker_stop) or broker_stop < active["stop"] - 1e-6:
                    raise LiveBlocked("Broker protective trigger is below the last confirmed stop; inspect Kite")
                if broker_stop > active["stop"]:
                    active["stop"] = broker_stop
                    active["trailing_active"] = True
                    self.save("TRAIL_CONFIRMED", stop=broker_stop, order_id=active["protect_id"])
            market = self.service()
            with market.lock:
                quote = market.engine.options.get(active["contract"]["token"])
                fresh = market.engine.fresh(quote, time.time())
                healthy = market.started and not market.failed.is_set()
            now = time.time()
            minute = datetime.fromtimestamp(now, IST).hour * 60 + datetime.fromtimestamp(now, IST).minute
            reason = active["exit_requested"]
            if self.state["killed"]:
                reason = "EMERGENCY_STOP"
            if minute >= 925:
                reason = reason or "SESSION_EXIT"
            if not healthy or not fresh:
                active["error"] = "Quote/recorder unavailable. Broker stop remains in place; monitor in Kite."
                self.state["armed_day"] = None
                self.save("STALE_PROTECTED")
                return
            if not 0 < quote.bid <= quote.ask:
                raise LiveBlocked("Live bid/ask invalid; retaining broker stop")
            daily_pnl = sum(t["net_pnl"] for t in self.state["trades"] if day(t["entry_at"]) == day(now))
            marked_pnl = daily_pnl + (quote.bid - active["entry_price"]) * filled - self.costs(
                active["entry_price"], filled) - self.costs(quote.bid, filled)
            index_pnl = sum(t["net_pnl"] for t in self.state["trades"]
                            if t["symbol"] == active["symbol"] and day(t["entry_at"]) == day(now))
            open_pnl = marked_pnl - daily_pnl
            if marked_pnl <= -self.settings().aqte_live_daily_loss or (
                index_pnl + open_pnl <= -active.get("daily_loss_limit", self.settings().aqte_live_daily_loss)
            ):
                reason = reason or "DAILY_LOSS"
            if quote.bid >= active["target"]:
                reason = reason or "TARGET"
            if active["entry_price"] <= active["initial_stop"]:
                reason = reason or "FILL_BELOW_STOP"
            if quote.bid <= active["stop"]:
                reason = reason or "STOP_CROSSED"
            # Modify the SAME sell order, never create a competing target/exit order.
            c = active["contract"]
            if reason or protection["status"] == "OPEN":
                price = round_tick(max(c["tick_size"], quote.bid - c["tick_size"] * 2), c["tick_size"])
                expected = {"order_type": "LIMIT", "price": price, "trigger_price": 0}
                if protection["order_type"] == "LIMIT" and abs(float(protection["price"]) - price) < 1e-6:
                    return
                active.update(exit_requested=reason or "STOP_TRIGGERED", modify=expected)
                self.mutation("EXIT_REPRICE", broker, active, "modify_order", variety="regular",
                              order_id=active["protect_id"], **expected)
                self.save("EXIT_REPRICE_ACK")
            else:
                active["peak"] = max(active["peak"], quote.bid)
                distance = active["entry_price"] - active["initial_stop"]
                if distance > 0 and active["peak"] >= active["entry_price"] + distance * active.get("trail_start_r", 1):
                    stop = round_tick(active["peak"] - distance, c["tick_size"])
                    if stop > active["stop"] + c["tick_size"] / 2:
                        price = round_tick(max(c["tick_size"], stop - max(2 * c["tick_size"], stop * 0.01)), c["tick_size"])
                        expected = {"order_type": "SL", "price": price, "trigger_price": stop}
                        # The UI must report the broker-confirmed stop, not an unacknowledged request.
                        active.update(modify=expected)
                        self.mutation("TRAIL", broker, active, "modify_order", variety="regular",
                                      order_id=active["protect_id"], **expected)
                        self.save("TRAIL_ACK")
            active["error"] = None
            self.error = None
            self.save("RECONCILED")

    def stop_entries(self):
        with self.lock:
            self.state.update(armed_day=None, automation_on=False, killed=True)
            self.proposals.clear()
            if self.state["active"]:
                self.state["active"]["exit_requested"] = "EMERGENCY_STOP"
            self.save("EMERGENCY_STOP")
            return self.status()

    def fault_stop(self, message):
        with self.lock:
            self.error = message
            self.state["armed_day"] = None
            self.state["automation_on"] = False
            if self.ready:
                try:
                    self.save("AUTOMATION_FAULT_STOPPED")
                except (sqlite3.Error, OSError, ValueError):
                    logger.exception("Could not persist automation fault stop")

    async def monitor(self):
        while True:
            try:
                await asyncio.to_thread(self.reconcile)
                await asyncio.to_thread(self.automated_entry)
            except Exception as exc:
                logger.exception("AQTE live reconciliation requires attention; inspect broker terminal")
                await asyncio.to_thread(self.fault_stop, f"{type(exc).__name__}: {exc}")
            try:
                await asyncio.wait_for(self.stop_event.wait(), timeout=2)
                return
            except asyncio.TimeoutError:
                pass

    async def start(self):
        await asyncio.to_thread(self.initialize)
        self.stop_event.clear()
        self.task = asyncio.create_task(self.monitor(), name="aqte-live-reconciliation")

    def disarm_shutdown(self):
        with self.lock:
            self.state["armed_day"] = None
            self.state["automation_on"] = False
            if self.ready:
                self.save("SHUTDOWN_DISARMED")

    async def stop(self):
        self.stop_event.set()
        if self.task:
            await self.task
        try:
            await asyncio.to_thread(self.disarm_shutdown)
        finally:
            self.release_owner()


_live = None


def get_live_service():
    global _live
    if _live is None:
        _live = AQTELiveService()
    return _live
