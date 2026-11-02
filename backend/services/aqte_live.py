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
KILL_TAG = "AQTEKILL"
KILL_EXCHANGES = {"NFO", "BFO", "NSE", "BSE"}
KILL_MAX_REJECTS = 5
KILL_SETTLE_SECONDS = 4
# Marketable limit: fills at the best available price, bounded to stay inside exchange price bands.
KILL_SLIPPAGE = 0.05
# A standing ON request retries preflight/arming at most once per minute while it waits.
ACTIVATION_RETRY_SECONDS = 60
# A skipped automated entry (price moved, quote stale) is re-evaluated after this many seconds.
ENTRY_RETRY_SECONDS = 5
ENTRY_CUTOFF_MINUTE = 15 * 60 + 15
MARKET_WAIT = "Waiting for market: auto trade arms on weekdays 09:15 to 15:15 IST"


class LiveBlocked(ValueError):
    pass


class EntrySkipped(LiveBlocked):
    """Transient market condition: skip this entry attempt without disarming automation."""


def entry_window(at):
    dt = datetime.fromtimestamp(at, IST)
    return session(at) and dt.hour * 60 + dt.minute < ENTRY_CUTOFF_MINUTE


def kill_price(ltp, side):
    steps = ltp * (1 - KILL_SLIPPAGE if side == "SELL" else 1 + KILL_SLIPPAGE) / 0.05
    steps = math.floor(steps + 1e-9) if side == "SELL" else math.ceil(steps - 1e-9)
    return round(max(1, steps) * 0.05, 2)


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
        self.state = {"armed_day": None, "automation_on": False, "automation_wanted": False, "killed": False,
                      "account": None, "active": None, "trades": [], "used": [], "daily_controls": defaults(),
                      "daily_entries": []}
        self.proposals = {}
        self.check = None
        self.error = None
        self.waiting = None
        self.entry_note = None
        self.skip_until = {}
        self.next_activation = 0.0
        self.ready = False
        self.task = None
        self.stop_event = asyncio.Event()
        self.owner_file = None
        self.kill_sent = {}
        self.kill_seen = set()

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
        self.state.setdefault("flatten_pending", False)
        # Standing ON survives restarts; the monitor re-runs preflight before any new entry.
        self.state["automation_wanted"] = bool(self.state.get("automation_wanted")) and not self.state["killed"]
        if set(self.state["daily_controls"]) != set(SYMBOLS):
            raise LiveBlocked("Invalid saved daily-control index set; journal requires repair before trading")
        self.state["daily_controls"] = {
            symbol: IndexControl(**control).model_dump()
            for symbol, control in self.state["daily_controls"].items()
        }
        self.save("RESTART_DISARMED", automation_wanted=self.state["automation_wanted"])
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
            self.state["automation_wanted"] = False
            logger.exception("AQTE live journal failed; broker mutations blocked")
            raise

    def status(self):
        with self.lock:
            cfg = self.settings()
            now = time.time()
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
                        order, now, healthy=market.started and not market.failed.is_set())
            trades = self.state["trades"]
            visible_trades = [trade for trade in trades[:-20] if day(trade["exit_at"]) == day(now)] + trades[-20:]
            automation_on = bool(self.state.get("automation_on")) and \
                self.state["armed_day"] == day(now) and not self.state["killed"]
            wanted = bool(self.state.get("automation_wanted")) and not self.state["killed"]
            return {
                "generated_at": now, "daily_counts": counts(self.state, now),
                "enabled": cfg.aqte_live_enabled, "paper_validated": cfg.aqte_live_paper_validated,
                "unvalidated_rules": cfg.aqte_live_allow_unvalidated_rules,
                "expected_ip": cfg.aqte_live_static_ip, "preflight": copy.deepcopy(self.check),
                "armed": self.state["armed_day"] == day(now) and not self.state["killed"],
                "automation_on": automation_on, "automation_wanted": wanted,
                "automation_waiting": self.waiting_reason(now) if wanted and not automation_on else None,
                "entry_window": entry_window(now),
                "killed": self.state["killed"], "flatten_pending": bool(self.state.get("flatten_pending")),
                "active": active, "error": self.error, "entry_note": self.entry_note,
                "styles": {symbol: control.get("style", "scalp")
                           for symbol, control in self.state["daily_controls"].items()},
                "ready": self.ready, "trades": copy.deepcopy(visible_trades),
                "limits": {"risk_per_trade": cfg.aqte_live_risk_per_trade,
                           "daily_loss": cfg.aqte_live_daily_loss, "max_trades": cfg.aqte_live_max_trades,
                           "max_losses": cfg.aqte_live_max_losses, "max_lots": 1},
            }

    def pins(self):
        with self.lock:
            active = self.state["active"]
            return {active["contract"]["token"]: Contract(**active["contract"])} if active else {}

    def effective(self, symbol, signal):
        """Scalp style trades the engine's quick-scalp sub-signal; swing trades the main rule signal."""
        if self.state["daily_controls"][symbol].get("style", "scalp") != "scalp":
            return signal
        scalp = signal.get("scalp") or {}
        return {**signal, "decision": scalp.get("decision") or "WAIT", "strategy": scalp.get("strategy"),
                "confidence": scalp.get("confidence"), "contract": scalp.get("contract"),
                "entry": scalp.get("entry"), "reasons": scalp.get("reasons") or ["Waiting for a quick-scalp setup"]}

    @staticmethod
    def setup_key(symbol, signal):
        # One entry per strategy candle; scalp tier changes inside the candle are the same setup.
        strategy = str(signal.get("strategy"))
        strategy = "quick_scalp" if strategy.startswith("quick_scalp") else strategy
        return f'{symbol}:{strategy}:{signal["intelligence"]["at"]}:{signal["contract"]["token"]}'

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
        return quality_reason(signal, control, self.settings().aqte_live_allow_unvalidated_rules)

    def daily_controls(self):
        with self.lock:
            snapshot = self.service().snapshot()
            total = counts(self.state, time.time())
            result = {}
            for symbol, control in self.state["daily_controls"].items():
                signal = self.effective(symbol, snapshot["data"][symbol])
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
                                     strategy=signal.get("strategy"),
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

    def start_automation(self):
        """Standing ON: accepted any time; arms itself inside each weekday 09:15-15:15 IST window."""
        with self.lock:
            self.config_guard()
            if self.state["killed"]:
                raise LiveBlocked("Emergency stop is latched; operator review is required before restarting")
            if not self.state.get("automation_wanted"):
                self.state["automation_wanted"] = True
                self.save("AUTOMATION_REQUESTED", note="Stays ON until OFF or emergency stop")
            self.waiting = None
            self.next_activation = 0.0
            if entry_window(time.time()):
                self.try_activate()
            return self.status()

    def waiting_reason(self, now):
        if not entry_window(now):
            return MARKET_WAIT
        if self.state["active"]:
            return "Waiting for the open AQTE trade to finish before arming"
        return self.waiting or "Arming for today's session"

    def try_activate(self):
        now = time.time()
        try:
            if self.state["armed_day"] != day(now):
                self.preflight()
                self.arm()
            self.set_automation(True)
            self.waiting = None
            return True
        except Exception as exc:
            reason = str(exc) if isinstance(exc, LiveBlocked) else f"{type(exc).__name__}: {exc}"
            self.next_activation = now + ACTIVATION_RETRY_SECONDS
            if reason != self.waiting:
                self.waiting = reason
                logger.warning("AQTE auto trade ON is waiting: %s", reason)
                if self.ready:
                    try:
                        self.save("AUTOMATION_WAITING", reason=reason[:500])
                    except (sqlite3.Error, OSError, ValueError):
                        logger.exception("Could not persist automation waiting reason")
            return False

    def auto_activate(self):
        with self.lock:
            now = time.time()
            if (not self.state.get("automation_wanted") or self.state["killed"] or not self.ready or
                    self.state.get("flatten_pending") or self.state["active"] or
                    now < self.next_activation or not entry_window(now)):
                return
            if self.state.get("automation_on") and self.state["armed_day"] == day(now):
                return
            self.try_activate()

    def set_automation(self, enabled):
        with self.lock:
            if not enabled:
                self.state["automation_on"] = False
                self.state["automation_wanted"] = False
                self.waiting = None
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
            self.state["automation_wanted"] = True
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
            signals = {symbol: self.effective(symbol, signal) for symbol, signal in snapshot["data"].items()}
            for symbol in sorted(signals, key=lambda s: signals[s].get("confidence") or 0, reverse=True):
                signal = signals[symbol]
                if self.control_reason(symbol, signal):
                    continue
                if signal["decision"] not in ("BUY CE", "BUY PE") or not signal.get("entry"):
                    continue
                if self.setup_key(symbol, signal) in self.state["used"] or time.time() < self.skip_until.get(symbol, 0):
                    continue
                try:
                    proposal = self.proposal(symbol)
                    self.confirm(proposal["id"])
                except EntrySkipped as exc:
                    # Price/quote moved between signal and broker checks: retry shortly, stay armed.
                    self.skip_until[symbol] = time.time() + ENTRY_RETRY_SECONDS
                    note = f"{symbol}: {exc}"
                    if note != self.entry_note:
                        logger.info("AQTE automated entry skipped: %s", note)
                    self.entry_note = note
                    continue
                self.entry_note = None
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
            signal = self.effective(symbol, snapshot["data"][symbol])
            if not snapshot["recording"] or signal["decision"] not in ("BUY CE", "BUY PE") or not signal["entry"]:
                raise EntrySkipped("No fresh risk-checked AQTE setup for this index")
            reason = self.control_reason(symbol, signal)
            if reason:
                raise EntrySkipped(reason)
            with market.lock:
                quote = market.engine.options.get(signal["contract"]["token"])
                if not market.engine.fresh(quote, time.time()):
                    raise EntrySkipped("Option quote stale")
            now = time.time()
            contract = Contract(**signal["contract"])
            control = self.state["daily_controls"][symbol]
            entry = copy.deepcopy(signal["entry"])
            cap = self.settings().aqte_live_risk_per_trade
            if str(signal.get("strategy")).startswith("quick_scalp"):
                entry = self.scalp_levels(contract, entry, cap)
            else:
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
                raise EntrySkipped("Configured reward/risk after estimated costs is below 1.5")
            entry["reward_risk"] = round(reward / risk, 2)
            if risk > cap:
                raise EntrySkipped("One lot exceeds live per-trade risk limit")
            self.proposals = {key: value for key, value in self.proposals.items() if value["expires_at"] > now}
            key = uuid4().hex
            result = {"id": key, "symbol": symbol, "contract": signal["contract"],
                      "strategy": f'quick_scalp_{entry["points"]:g}' if "points" in entry else signal.get("strategy"),
                      "entry": entry, "risk": round(risk, 2), "signal_at": signal["at"],
                      "expires_at": now + 15, "setup_key": self.setup_key(symbol, signal)}
            self.proposals[key] = copy.deepcopy(result)
            return result

    def scalp_levels(self, contract, entry, cap):
        """Largest allowed scalp tier whose one-lot risk fits the cap with net reward/risk >= 1.5."""
        maximum, quantity, size = entry["maximum"], contract.lot_size, contract.tick_size
        for points in sorted(entry.get("points_allowed") or (), reverse=True):
            stop = round_tick(maximum - points * entry["stop_ratio"], size)
            target = round_tick(maximum + points, size, up=True)
            if not 0 < stop < maximum < target:
                continue
            risk = (maximum - stop) * quantity + self.costs(maximum, quantity) + self.costs(stop, quantity)
            reward = (target - maximum) * quantity - self.costs(maximum, quantity) - self.costs(target, quantity)
            if reward / risk >= 1.5 and risk <= cap:
                return {**entry, "stop": stop, "target": target, "points": points}
        raise EntrySkipped("No quick-scalp tier fits the live per-trade risk limit with reward/risk >= 1.5")

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
            # Same contract and strategy candle, and the price cap may only fall: never chase a higher ask.
            if current["contract"] != proposal["contract"] or current["setup_key"] != proposal["setup_key"] or (
                current["entry"]["maximum"] > proposal["entry"]["maximum"]
            ):
                raise EntrySkipped("Signal or entry levels changed; review a new proposal")
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
                raise EntrySkipped("Fresh broker ask/depth does not fit the approved no-chase limit")
            available = float(broker.margins("equity")["available"]["cash"])
            if not math.isfinite(available) or available < entry["maximum"] * c["lot_size"] + self.costs(entry["maximum"], c["lot_size"]):
                raise LiveBlocked("Insufficient broker cash for the one-lot premium")
            if time.time() >= proposal["expires_at"]:
                raise EntrySkipped("Approval expired during broker checks; review again")
            market = self.service()
            with market.lock:
                if not market.started or market.failed.is_set() or market.engine.killed or (
                    not market.engine.fresh(market.engine.options.get(c["token"]), time.time()) or
                    not market.engine.fresh(market.engine.spot.get(proposal["symbol"]), time.time()) or
                    not market.engine.fresh(market.engine.future.get(proposal["symbol"]), time.time())
                ):
                    raise EntrySkipped("Streaming quote became stale during broker checks")
            # Persist the unique intent BEFORE sending. A timeout is not a rejection.
            active = {
                "id": uuid4().hex[:16], "symbol": proposal["symbol"], "contract": c,
                "strategy": proposal.get("strategy"),
                "quantity": c["lot_size"], "limit": entry["maximum"], "stop": entry["stop"],
                "initial_stop": entry["stop"], "target": entry["target"], "peak": 0,
                "trailing_active": False,
                "trail_start_r": control["trail_start_r"], "daily_loss_limit": control["daily_loss"],
                "state": "ENTRY_UNKNOWN", "entry_id": None, "protect_id": None,
                "filled": 0, "entry_price": 0, "entry_at": now, "account": self.state["account"],
                "signal_at": proposal["signal_at"],
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
                active.update(entry_id=str(order_id), entry_ack_at=time.time(), state="ENTRY_PENDING")
                self.save("ENTRY_ACK", order_id=str(order_id))
            except Exception:
                logger.exception("AQTE live entry outcome uncertain; automatic resubmission prohibited")
                active["error"] = "Entry outcome uncertain; reconcile broker order book. Do not retry."
                self.state["armed_day"] = None
                self.save("ENTRY_UNCERTAIN")
            return self.status()

    def request_exit(self, trade_id):
        with self.lock:
            if not self.ready:
                raise LiveBlocked("Live journal is unavailable; manage the position in Kite")
            if self.state["killed"] or self.state.get("flatten_pending"):
                raise LiveBlocked("Account-wide emergency stop is active; monitor square-off in Kite")
            active = self.state["active"]
            if not active or active["id"] != trade_id:
                raise LiveBlocked("The selected AQTE trade is no longer active; refresh before acting")
            if active["entry_day"] != day(time.time()):
                raise LiveBlocked("Previous-session trade requires reconciliation in Kite")
            if active["filled"] <= active.get("exited", 0):
                raise LiveBlocked("No confirmed remaining fill to close; inspect the pending order in Kite")
            self.state["automation_on"] = False
            self.state["automation_wanted"] = False
            self.waiting = None
            self.proposals.clear()
            if not active["exit_requested"]:
                active.update(exit_requested="MANUAL_EXIT", exit_request_at=time.time())
            # The monitor reconciles identity/quantity, then modifies only this trade's existing sell order.
            self.save("MANUAL_EXIT_REQUESTED", trade_id=trade_id, scope="SELECTED_AQTE_TRADE")
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
            active["protection_confirmed"] = bool(
                protection and protection["status"] == "TRIGGER PENDING" and protection["order_type"] == "SL")
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
            if active["protection_confirmed"] and not active.get("protect_at"):
                active["protect_at"] = time.time()
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
                    active["trail_at"] = time.time()
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
                active.setdefault("exit_request_at", now)
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

    def audit(self, kind, **payload):
        # Emergency square-off must continue even when the journal cannot be written.
        try:
            self.save(kind, **payload)
        except (sqlite3.Error, OSError, ValueError):
            logger.exception("AQTE emergency audit write failed; continuing broker square-off")

    def stop_entries(self):
        with self.lock:
            self.state.update(armed_day=None, automation_on=False, automation_wanted=False,
                              killed=True, flatten_pending=True)
            self.waiting = None
            self.proposals.clear()
            self.kill_sent.clear()
            if self.state["active"]:
                self.state["active"]["exit_requested"] = "EMERGENCY_STOP"
            self.audit("EMERGENCY_STOP", scope="ALL_KITE_POSITIONS_AND_ORDERS")
            try:
                self.emergency_flatten()
            except Exception as exc:
                self.error = f"Emergency square-off retrying: {type(exc).__name__}: {exc}"
                logger.exception("AQTE emergency square-off attempt failed; monitor will retry")
            return self.status()

    def emergency_flatten(self):
        """Cancel every working order and close every open Kite position. Repeats until flat."""
        with self.lock:
            if not self.state.get("flatten_pending"):
                return
            broker = self.broker()
            orders = broker.orders()
            positions = [p for p in broker.positions()["net"] if int(p["quantity"])]
            working = [o for o in orders if o["status"] not in TERMINAL]
            now = time.time()
            keep, problems = set(), []
            complete = {str(o["order_id"]) for o in orders if o["status"] == "COMPLETE"}
            fresh_fills = complete - self.kill_seen
            self.kill_seen |= complete
            for position in positions:
                quantity = int(position["quantity"])
                side = "SELL" if quantity > 0 else "BUY"
                exchange, symbol = position["exchange"], position["tradingsymbol"]
                key = f'{exchange}:{symbol}:{position["product"]}'
                same = [o for o in orders if o["exchange"] == exchange and o["tradingsymbol"] == symbol]
                exits = [o for o in same if o["status"] not in TERMINAL and o["transaction_type"] == side]
                if exchange not in KILL_EXCHANGES:
                    problems.append(f"{symbol}: {exchange} not supported; square off in Kite")
                    keep.update(str(o["order_id"]) for o in exits)
                    continue
                rejects = [o for o in same if o.get("tag") == KILL_TAG and o["status"] == "REJECTED"]
                if len(rejects) >= KILL_MAX_REJECTS:
                    problems.append(f"{symbol}: exit rejected {len(rejects)} times "
                                    f"({rejects[-1].get('status_message') or 'no reason'}); square off in Kite")
                    keep.update(str(o["order_id"]) for o in exits)
                    continue
                ltp = float(position.get("last_price") or 0)
                if not math.isfinite(ltp) or ltp <= 0:
                    problems.append(f"{symbol}: broker price unavailable; retrying")
                    keep.update(str(o["order_id"]) for o in exits)
                    continue
                # Positions can lag a just-completed fill; wait rather than risk a reverse position.
                if any(str(o["order_id"]) in fresh_fills and o["transaction_type"] == side for o in same):
                    self.kill_sent[key] = now
                price = kill_price(ltp, side)
                settling = now - self.kill_sent.get(key, 0) < KILL_SETTLE_SECONDS
                remaining = [int(o["quantity"]) - int(o.get("filled_quantity") or 0) for o in exits]
                if len(exits) == 1 and remaining[0] == abs(quantity):
                    order = exits[0]
                    keep.add(str(order["order_id"]))
                    if settling or (order["order_type"] == "LIMIT" and abs(float(order.get("price") or 0) - price) < 0.025):
                        continue
                    self.audit("EMERGENCY_EXIT_REPRICE_INTENT", order_id=str(order["order_id"]), symbol=symbol, price=price)
                    try:
                        broker.modify_order(variety=order.get("variety") or "regular", order_id=order["order_id"],
                                            order_type="LIMIT", price=price, trigger_price=0)
                    except Exception as exc:
                        problems.append(f"{symbol}: reprice failed ({type(exc).__name__}); retrying")
                        logger.exception("AQTE emergency reprice failed for %s", symbol)
                    self.kill_sent[key] = now
                elif not exits and not settling:
                    self.audit("EMERGENCY_EXIT_INTENT", symbol=symbol, side=side, quantity=abs(quantity), price=price)
                    try:
                        broker.place_order(variety="regular", exchange=exchange, tradingsymbol=symbol,
                                           transaction_type=side, quantity=abs(quantity), product=position["product"],
                                           order_type="LIMIT", price=price, validity="DAY", tag=KILL_TAG)
                    except Exception as exc:
                        problems.append(f"{symbol}: exit order failed ({type(exc).__name__}); retrying")
                        logger.exception("AQTE emergency exit failed for %s", symbol)
                    self.kill_sent[key] = now
            for order in working:
                if str(order["order_id"]) in keep:
                    continue
                self.audit("EMERGENCY_CANCEL_INTENT", order_id=str(order["order_id"]), symbol=order["tradingsymbol"])
                try:
                    broker.cancel_order(variety=order.get("variety") or "regular", order_id=order["order_id"])
                except Exception as exc:
                    problems.append(f'{order["tradingsymbol"]}: cancel failed ({type(exc).__name__}); retrying')
                    logger.exception("AQTE emergency cancel failed for order %s", order["order_id"])
            if not positions and not working:
                self.finish_emergency(orders)
                return
            self.error = "; ".join(problems) or "Emergency square-off in progress; verify in Kite"

    def finish_emergency(self, orders):
        active = self.state["active"]
        if active:
            entry = next((o for o in orders if o.get("tag") == active["id"] + "E"), None)
            filled = int(entry["filled_quantity"]) if entry else int(active.get("filled") or 0)
            if filled:
                entry_price = float(entry["average_price"]) if entry and float(entry.get("average_price") or 0) > 0 \
                    else float(active.get("entry_price") or 0)
                sells = [o for o in orders if o["tradingsymbol"] == active["contract"]["trading_symbol"] and
                         o["transaction_type"] == "SELL" and int(o.get("filled_quantity") or 0) > 0 and
                         o.get("tag") in (active["id"] + "S", KILL_TAG)]
                sold = sum(int(o["filled_quantity"]) for o in sells)
                exit_price = round(sum(float(o["average_price"]) * int(o["filled_quantity"]) for o in sells) / sold, 2) \
                    if sold else None
                net = round((exit_price - entry_price) * filled - self.costs(entry_price, filled) -
                            self.costs(exit_price, filled), 2) if exit_price else 0.0
                self.state["trades"].append({**active, "filled": filled, "entry_price": entry_price,
                                             "exit_at": time.time(), "exit_price": exit_price,
                                             "exit_reason": "EMERGENCY_STOP", "net_pnl": net,
                                             "exit_unverified": exit_price is None})
            self.state["active"] = None
        self.state["flatten_pending"] = False
        self.kill_sent.clear()
        self.error = None
        self.audit("EMERGENCY_FLAT", note="Kite reports no open positions or working orders")

    def reset_emergency(self):
        with self.lock:
            if not self.ready:
                raise LiveBlocked("Live journal is unavailable")
            if not self.state["killed"]:
                raise LiveBlocked("Emergency stop is not latched")
            if self.state.get("flatten_pending") or self.state["active"]:
                raise LiveBlocked("Emergency square-off still in progress; wait until Kite shows no open positions or orders")
            self.state.update(killed=False, armed_day=None, automation_on=False, automation_wanted=False)
            self.error = None
            self.waiting = None
            self.save("EMERGENCY_RESET", note="Operator reviewed; automation remains OFF")
            return self.status()

    def fault_stop(self, message):
        with self.lock:
            # Monitor retries every ~2s; journal only new faults or an actual disarm.
            changed = message != self.error or self.state["armed_day"] is not None or bool(
                self.state.get("automation_on"))
            self.error = message
            self.state["armed_day"] = None
            self.state["automation_on"] = False
            # A standing ON request re-arms through a fresh preflight after the retry delay.
            self.next_activation = time.time() + ACTIVATION_RETRY_SECONDS
            if self.ready and changed:
                try:
                    self.save("AUTOMATION_FAULT_STOPPED", error=message[:500])
                except (sqlite3.Error, OSError, ValueError):
                    logger.exception("Could not persist automation fault stop")

    async def monitor(self):
        while True:
            try:
                if self.state.get("flatten_pending"):
                    await asyncio.to_thread(self.emergency_flatten)
                else:
                    await asyncio.to_thread(self.reconcile)
                    await asyncio.to_thread(self.auto_activate)
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
