"""Explicitly armed AQTE automation. Unknown broker outcomes are never retried."""

import asyncio
import copy
import ipaddress
import json
import logging
import math
import os
import re
import sqlite3
import threading
import time
from collections import deque
from contextlib import closing
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from statistics import fmean
from uuid import uuid4

import requests
from kiteconnect import KiteConnect

from config import get_settings
from services.aqte_engine import Contract, IST, Policy, SYMBOLS, day, opportunity_key, round_tick, session
from services.aqte_daily_control import IndexControl, SwingSetups, counts, defaults, quality_reason
from services.aqte_engines import EngineConfig, rank_key, veto_reason
from services.aqte_runtime import Latencies
from services.aqte_execution_history import bootstrap_executions, capture_context, save_execution
from services.quantedge_pro import build_candidate
from services.expiryedge_algos import (
    ALGO_KEYS as EXPIRYEDGE_ALGOS, RETIRED_ALGO_KEYS as RETIRED_EXPIRYEDGE_ALGOS,
    ALGO_NAMES as EXPIRYEDGE_NAMES, ALGOS as EXPIRYEDGE_CATALOG,
    PER_ALGO_MAX_TRADES as EXPIRYEDGE_PER_ALGO_TRADES, TARGET_R as EXPIRYEDGE_TARGET_R,
    TRAIL_START_R as EXPIRYEDGE_TRAIL_START_R, ExpiryEdgeDesk, idle_result as expiryedge_idle,
    setup_key as expiryedge_setup_key,
)
from services.expiryedge import get_config as get_expiryedge_config
from services.expiryedge_ai import evaluate_opening_range

logger = logging.getLogger(__name__)
TERMINAL = {"COMPLETE", "CANCELLED", "REJECTED"}
KILL_TAG = "AQTEKILL"
# Every AQTE order carries its 16-hex trade id + E (entry) / S (stop); manual Kite orders never do.
AQTE_TAG = re.compile(r"[0-9a-f]{16}[ES]")
QUANTEDGE_TAG = re.compile(r"QEP[0-9a-f]{13}[ES]")
EXPIRYEDGE_TAG = re.compile(r"XEA[0-9a-f]{13}[ES]")
EXPIRYEDGE_AI_TAG = re.compile(r"EAI[0-9a-f]{13}[ES]")
KILL_EXCHANGES = {"NFO", "BFO", "NSE", "BSE"}
KILL_MAX_REJECTS = 5
KILL_SETTLE_SECONDS = 4
# Marketable limit: fills at the best available price, bounded to stay inside exchange price bands.
KILL_SLIPPAGE = 0.05
# A standing ON request retries preflight/arming at most once per minute while it waits.
ACTIVATION_RETRY_SECONDS = 60
# A skipped automated entry (price moved, quote stale) is re-evaluated after this many seconds.
ENTRY_RETRY_SECONDS = 5
ENTRY_SCAN_AUDIT_SECONDS = 60
DAILY_CONTROL_DEFAULTS_VERSION = 1
AUTOMATION_APPROVAL_VERSION = 1
SMART_AI_CONFIRMATION_MAX_AGE_SECONDS = 30
ENTRY_CUTOFF_MINUTE = 15 * 60 + 15
MARKET_WAIT = "Market data and pre-open analysis start at 09:00 IST; live auto-trading arms on weekdays from 09:15 to 15:15 IST"
# Kite rejects more than 25 modifications per order; trailing must leave headroom for the exit.
KITE_MAX_MODIFICATIONS = 25
EXIT_MODIFY_RESERVE = 5
OWNER_LABELS = {
    "QUANTEDGE": "QuantEdge Pro", "EXPIRYEDGE": "6 Algo Desk",
    "EXPIRYEDGE_AI": "ExpiryEdge AI Algo",
}
OWNER_SOURCES = {
    "QUANTEDGE": "quantedge_live", "EXPIRYEDGE": "expiryedge_live",
    "EXPIRYEDGE_AI": "expiryedge_ai_live",
}
# Owners with their own desks; AQTE's controller views exclude their trades and proposals.
SEPARATE_OWNERS = ("QUANTEDGE", "EXPIRYEDGE", "EXPIRYEDGE_AI")
EXPIRYEDGE_SCAN_SECONDS = 1.0
EXPIRYEDGE_AI_RISK_CAP = 3000.0
EXPIRYEDGE_AI_DAILY_LOSS_CAP = 3000.0
EXPIRYEDGE_AI_MAX_TRADES = 1
EXPIRYEDGE_AI_STOP_FRACTION = 0.20
EXPIRYEDGE_AI_TRAIL_GAP_R = 0.5
# Unexpected (non-guard) scan failures in a row before every 6 Algo Desk algo fails safe to OFF.
EXPIRYEDGE_MAX_FAILURES = 3


class LiveBlocked(ValueError):
    pass


class EntrySkipped(LiveBlocked):
    """Transient market condition: skip this entry attempt without disarming automation."""


def entry_window(at):
    dt = datetime.fromtimestamp(at, IST)
    return session(at) and dt.hour * 60 + dt.minute < ENTRY_CUTOFF_MINUTE


def aqte_order(order):
    tag = str(order.get("tag") or "")
    return tag == KILL_TAG or AQTE_TAG.fullmatch(tag) is not None


def algo_order(order):
    tag = str(order.get("tag") or "")
    return (
        aqte_order(order) or QUANTEDGE_TAG.fullmatch(tag) is not None
        or EXPIRYEDGE_TAG.fullmatch(tag) is not None
        or EXPIRYEDGE_AI_TAG.fullmatch(tag) is not None
    )


def performance(trades):
    """Broker-reconciled net P&L statistics; empty history reports None instead of invented ratios."""
    pnls = [trade["net_pnl"] for trade in sorted(trades, key=lambda trade: trade.get("exit_at") or trade["entry_at"])]
    wins = [pnl for pnl in pnls if pnl > 0]
    losses = [pnl for pnl in pnls if pnl < 0]
    equity = peak = drawdown = 0.0
    for pnl in pnls:
        equity += pnl
        peak = max(peak, equity)
        drawdown = max(drawdown, peak - equity)
    gross_loss = -sum(losses)
    return dict(
        trades=len(pnls), wins=len(wins), losses=len(losses),
        win_rate=round(100 * len(wins) / len(pnls), 1) if pnls else None,
        net_pnl=round(sum(pnls), 2),
        profit_factor=round(sum(wins) / gross_loss, 2) if gross_loss > 0 else None,
        max_drawdown=round(drawdown, 2),
        avg_win=round(fmean(wins), 2) if wins else None,
        avg_loss=round(fmean(losses), 2) if losses else None,
        expectancy=round(fmean(pnls), 2) if pnls else None,
    )


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


def strategy_lab_confirmation_reason(result, decision, now=None):
    if not isinstance(result, dict):
        return "AQTE 5-minute strategy confirmation is unavailable"
    if result.get("data_status") != "LIVE":
        return "AQTE confirmation market data is not live"
    tick_age = result.get("tick_age_seconds")
    if (type(tick_age) not in (int, float) or not math.isfinite(tick_age)
            or tick_age < 0 or tick_age > 10):
        return "AQTE confirmation market data is stale"

    lab = result.get("strategy_lab")
    if not isinstance(lab, dict):
        return "AQTE 5-minute Strategy Lab data is unavailable"
    updated = lab.get("updated")
    if type(updated) not in (int, float) or not math.isfinite(updated):
        return "AQTE 5-minute Strategy Lab timestamp is unavailable"
    age = (time.time() if now is None else now) - updated / 1000
    if age < 0 or age > SMART_AI_CONFIRMATION_MAX_AGE_SECONDS:
        return "AQTE 5-minute Strategy Lab data is stale"

    consensus = lab.get("consensus")
    if not isinstance(consensus, dict) or consensus.get("fired") is not True:
        return "AQTE 5-minute consensus is not fired"
    expected = {"BUY CE": "BUY_CE", "BUY PE": "BUY_PE"}.get(decision)
    if expected is None:
        return "AQTE entry direction is unavailable for Smart AI confirmation"
    actual = consensus.get("signal")
    if actual != expected:
        return f"AQTE 5-minute consensus {actual or 'NEUTRAL'} does not confirm {decision}"
    return None


def aqte_confirmation_reason(symbol, decision):
    try:
        from services.aqte_confirmation_service import get_aqte_confirmation_service

        result = get_aqte_confirmation_service().get_result(symbol)
    except ImportError:
        logger.exception("AQTE could not import its 5-minute confirmation service for %s", symbol)
        return "AQTE 5-minute strategy confirmation is unavailable"
    return strategy_lab_confirmation_reason(result, decision)


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
                      "daily_entries": [], "daily_controls_version": DAILY_CONTROL_DEFAULTS_VERSION,
                      "automation_approval_version": AUTOMATION_APPROVAL_VERSION,
                      "quantedge": {"enabled": False, "lots": 1},
                      "expiryedge": {"algos": {key: False for key in EXPIRYEDGE_ALGOS}},
                      "expiryedge_ai": {"enabled": False, "error": None}}
        self.expiryedge = ExpiryEdgeDesk()
        self.expiryedge_waiting = None
        self.expiryedge_error = None
        self.expiryedge_failures = 0
        self.expiryedge_hold_until = 0.0
        self.expiryedge_skip_until = {}
        self.expiryedge_scanned_at = 0.0
        self.expiryedge_ai_scanned_at = 0.0
        self.expiryedge_ai_failures = 0
        self.expiryedge_ai_next_activation = 0.0
        self.quantedge_next_activation = 0.0
        self.proposals = {}
        self.check = None
        self.error = None
        self.waiting = None
        self.entry_note = None
        self.skip_until = {}
        self.skip_reasons = {}
        self.entry_scan = None
        self.next_scan_audit = 0.0
        self.next_activation = 0.0
        self.ready = False
        self.task = None
        self.stop_event = asyncio.Event()
        self.owner_file = None
        self.kill_sent = {}
        self.kill_seen = set()
        self.metrics = Latencies()
        self.loop = None
        self.wake_event = asyncio.Event()
        self.order_dirty = threading.Event()
        self.update_lock = threading.Lock()
        self.broker_updates = deque(maxlen=50)
        self.opportunities = {}
        self.prepared_day = None
        self.prepare_after = 0.0
        self.prepare_error = None

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
            history_exists = db.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='live_executions'").fetchone() is not None
            db.executescript("""
                CREATE TABLE IF NOT EXISTS live_state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS live_audit (
                    id INTEGER PRIMARY KEY, at REAL NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS live_opportunities (
                    opportunity_key TEXT PRIMARY KEY, at REAL NOT NULL, payload TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS live_opportunity_time ON live_opportunities(at);
                CREATE TABLE IF NOT EXISTS live_executions (
                    id TEXT PRIMARY KEY, at REAL NOT NULL, payload TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS live_execution_time ON live_executions(at,id);
            """)
            row = db.execute("SELECT payload FROM live_state WHERE id=1").fetchone()
            if row:
                self.state = json.loads(row[0])
            bootstrap_executions(db, self.state, force=not history_exists)
            self.opportunities = {key: json.loads(payload) for key, payload in reversed(db.execute(
                "SELECT opportunity_key,payload FROM live_opportunities ORDER BY at DESC LIMIT 512").fetchall())}
        self.state["armed_day"] = None
        self.state["automation_on"] = False
        self.state.setdefault("daily_controls", defaults())
        self.state.setdefault("daily_entries", [])
        self.state.setdefault("quantedge", {"enabled": False, "lots": 1})
        if (not isinstance(self.state["quantedge"], dict) or
                type(self.state["quantedge"].get("enabled")) is not bool or
                type(self.state["quantedge"].get("lots")) is not int or
                not 1 <= self.state["quantedge"]["lots"] <= 5):
            raise LiveBlocked("Invalid QuantEdge Pro configuration; journal requires repair before trading")
        self.state["quantedge"]["enabled"] = False
        expiryedge = self.state.setdefault("expiryedge", {"algos": {key: False for key in EXPIRYEDGE_ALGOS}})
        algos = expiryedge.get("algos") if isinstance(expiryedge, dict) else None
        if (not isinstance(algos, dict) or
                not set(algos) <= set(EXPIRYEDGE_ALGOS) | RETIRED_EXPIRYEDGE_ALGOS or
                any(type(value) is not bool for value in algos.values())):
            raise LiveBlocked("Invalid 6 Algo Desk configuration; journal requires repair before trading")
        # Every live-entry approval requires a fresh manual ON after backend startup.
        expiryedge["algos"] = {key: False for key in EXPIRYEDGE_ALGOS}
        expiryedge_ai = self.state.setdefault("expiryedge_ai", {"enabled": False, "error": None})
        if (not isinstance(expiryedge_ai, dict) or type(expiryedge_ai.get("enabled")) is not bool or
                (expiryedge_ai.get("error") is not None and not isinstance(expiryedge_ai["error"], str))):
            raise LiveBlocked("Invalid standalone ExpiryEdge AI configuration; journal requires repair before trading")
        expiryedge_ai["enabled"] = False
        self.state.setdefault("flatten_pending", False)
        self.state["automation_wanted"] = False
        if set(self.state["daily_controls"]) != set(SYMBOLS):
            raise LiveBlocked("Invalid saved daily-control index set; journal requires repair before trading")
        version = self.state.get("daily_controls_version", 0)
        if version not in (0, DAILY_CONTROL_DEFAULTS_VERSION):
            raise LiveBlocked("Unsupported daily-control defaults version; journal requires repair before trading")
        migrated = version == 0
        controls = {}
        for symbol, control in self.state["daily_controls"].items():
            score = control.get("min_confidence", 75)
            if migrated and type(score) is int and 90 <= score <= 100:
                score = 75
            restored = IndexControl(**{**control, "min_confidence": score})
            if migrated:
                restored.enabled = True
                restored.style = "both"
                restored.setups = SwingSetups()
            controls[symbol] = restored.model_dump()
        self.state["daily_controls"] = controls
        self.state["daily_controls_version"] = DAILY_CONTROL_DEFAULTS_VERSION
        if migrated:
            # Broader entry permissions require a fresh owner approval, never a standing ON request.
            self.state["automation_wanted"] = False
            logger.warning("AQTE controls migrated: all indices/styles/setups selected, score floor 75-80; "
                           "Auto Trade is OFF pending fresh approval")
        approval_version = self.state.get("automation_approval_version", 0)
        if type(approval_version) is not int or approval_version not in (0, AUTOMATION_APPROVAL_VERSION):
            raise LiveBlocked("Unsupported automation approval version; journal requires repair before trading")
        approval_migrated = approval_version == 0
        self.state["automation_approval_version"] = AUTOMATION_APPROVAL_VERSION
        if approval_migrated:
            # Removing an entry gate must not activate a previously saved ON request.
            self.state["automation_wanted"] = False
            logger.warning("AQTE paper-approval gate removed; Auto Trade is OFF pending fresh approval")
        self.save("RESTART_DISARMED", automation_wanted=self.state["automation_wanted"],
                  daily_controls_migrated=migrated, automation_approval_migrated=approval_migrated)
        self.ready = True

    def _publish_live_event(self, kind, payload, execution):
        from services.engine_events import get_engine_event_service

        execution = execution or payload.get("execution") or payload.get("trade") or self.state.get("active") or {}
        opportunity = payload.get("record") or {}
        owner = (execution.get("owner") or (payload.get("proposal") or {}).get("owner") or
                 opportunity.get("owner") or "AQTE")
        label = OWNER_LABELS.get(owner, "AQTE")
        trade_key = ((execution or {}).get("id") or payload.get("order_id") or
                     (payload.get("record") or {}).get("key") or "controller")
        instrument = ((execution or {}).get("contract") or {}).get("trading_symbol")

        def publish(event_type, message, severity="info", suffix="", instrument_override=None):
            get_engine_event_service().publish_threadsafe(
                event_type, message, instrument=instrument_override or instrument or (execution or {}).get("symbol"),
                severity=severity, source=OWNER_SOURCES.get(owner, "aqte_live"),
                idempotency_key=f"{owner.lower()}-live:{trade_key}:{kind}:{suffix or kind}",
            )

        if kind == "OPPORTUNITY":
            record = payload.get("record") or {}
            state = record.get("state")
            event_type = {
                "REJECTED": "SIGNAL_REJECTED",
                "MISSED": "OPPORTUNITY_MISSED",
                "EXPIRED": "OPPORTUNITY_EXPIRED",
                "ACCEPTED": "OPPORTUNITY_ACCEPTED",
            }.get(state)
            if event_type:
                reason = record.get("reason")
                label = OWNER_LABELS.get(record.get("owner")) or record.get("symbol", "AQTE")
                message = f"{label} {record.get('style', 'trade')} opportunity {str(state).lower()}"
                if reason:
                    message += f": {reason}"
                publish(event_type, message, "warning" if state in ("REJECTED", "MISSED") else "info",
                        f"{state}:{int(record.get('at', time.time()) * 1000)}", record.get("symbol"))
                if state == "REJECTED" and isinstance(reason, str) and (
                    "daily" in reason.lower() or "loss limit" in reason.lower()
                ):
                    publish("DAILY_RISK_LIMIT_TRIGGERED", f"{label} risk gate: {reason}", "warning",
                            f"risk:{int(record.get('at', time.time()) * 1000)}", record.get("symbol"))
        elif kind == "ENTRY_INTENT":
            publish("RISK_VALIDATION_PASSED", f"{label} entry passed controller risk validation", "success", "risk")
            publish("TRADE_EXECUTION_INITIATED", f"{label} initiated the broker order-submission workflow", "info", "intent")
        elif kind == "ENTRY_ACK":
            publish("ZERODHA_ORDER_SUBMITTED", f"{label} entry order submitted to Zerodha", "info")
        elif kind == "ENTRY_UNCERTAIN":
            publish("ORDER_STATUS_UNCERTAIN", "Entry submission outcome is uncertain; broker reconciliation is required",
                    "warning")
        elif kind == "ENTRY_UNFILLED":
            publish("ORDER_UNFILLED", f"{label} entry order was not filled", "warning")
        elif kind == "ENTRY_CANCEL_ACK":
            publish("ORDER_CANCEL_REQUESTED", f"{label} requested entry-order cancellation", "warning")
        elif kind == "PROTECTION_ACK":
            publish("STOP_LOSS_SUBMITTED", f"{label} protective stop order submitted to Zerodha", "info")
        elif kind == "TRAIL_ACK":
            publish("TRAILING_STOP_ADJUSTMENT_SUBMITTED", f"{label} submitted a trailing stop adjustment", "info",
                    f"stop:{execution.get('stop')}:{execution.get('trail_at')}")
        elif kind == "TRAIL_CONFIRMED":
            stop = payload.get("stop")
            message = f"{label} trailing stop-loss confirmed"
            if isinstance(stop, (int, float)) and math.isfinite(stop):
                message += f" at {stop:.2f}"
            publish("TRAILING_STOP_UPDATED", message, "success", f"stop:{stop}")
        elif kind == "EXIT_REPRICE_ACK":
            publish("POSITION_EXIT_INITIATED", f"{label} submitted a protective exit-order update", "warning")
        elif kind == "LIVE_CLOSED":
            trade = payload.get("trade") or {}
            reason = trade.get("exit_reason") or "broker-reconciled exit"
            if reason == "TARGET":
                publish("TARGET_REACHED", f"{label} target exit was broker-reconciled", "success", "target")
            publish("POSITION_EXITED", f"{label} position exited: {reason}", "success", f"exit:{reason}")
        elif kind == "PREPARATION_BLOCKED":
            publish("PREMARKET_PREPARATION_BLOCKED", "AQTE broker preparation was blocked", "warning")
        elif kind in ("AUTOMATION_FAULT_STOPPED", "KILL_SWITCH"):
            publish("AUTOMATION_STOPPED", f"{label} automation stopped by a safety control", "error")
        elif kind == "QUANTEDGE_SCAN_BLOCKED":
            publish("ENGINE_ERROR", "QuantEdge Pro scan was disarmed; inspect its status for the exact reason", "error")
        elif kind == "EXPIRYEDGE_SCAN_BLOCKED":
            publish("ENGINE_ERROR", "6 Algo Desk algos were switched OFF; inspect the desk for the exact reason",
                    "error")

    def save(self, kind, **payload):
        try:
            with closing(sqlite3.connect(str(self.path), timeout=10)) as db, db:
                db.execute("INSERT INTO live_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
                           (json.dumps(self.state, allow_nan=False),))
                db.execute("INSERT INTO live_audit(at,kind,payload) VALUES(?,?,?)",
                           (time.time(), kind, json.dumps(payload, allow_nan=False)))
                execution = payload.get("execution") or payload.get("trade") or self.state.get("active")
                if execution:
                    save_execution(db, execution, time.time())
                if kind == "OPPORTUNITY":
                    record = payload["record"]
                    db.execute("INSERT INTO live_opportunities VALUES(?,?,?) ON CONFLICT(opportunity_key) "
                               "DO UPDATE SET at=excluded.at,payload=excluded.payload",
                               (record["key"], record["at"], json.dumps(record, allow_nan=False)))
        except (sqlite3.Error, OSError, ValueError):
            self.ready = False
            self.state["armed_day"] = None
            self.state["automation_on"] = False
            self.state["automation_wanted"] = False
            self.state["quantedge"]["enabled"] = False
            self.state["expiryedge_ai"]["enabled"] = False
            self.expiryedge_off()
            logger.exception("AQTE live journal failed; broker mutations blocked")
            raise
        self._publish_live_event(kind, payload, execution)
        morning = self.morning_service()
        if morning is not None:
            active = self.state.get("active")
            morning.active_token = active["contract"]["token"] if active and str(
                active.get("strategy", "")).startswith("morning_") else None
        if morning is not None and kind == "OPPORTUNITY" and payload["record"].get("style") == "morning":
            morning.audit("OPPORTUNITY", payload["record"], payload["record"]["symbol"])
        if morning is not None and execution and str(execution.get("strategy", "")).startswith("morning_"):
            from services.aqte_execution_history import execution_record
            morning.audit("EXECUTION_" + kind, execution_record(execution, time.time()), execution.get("symbol"))

    def status(self):
        with self.lock:
            cfg = self.settings()
            now = time.time()
            active_record = self.state["active"]
            active = (copy.deepcopy(active_record) if not active_record or
                      active_record.get("owner") not in SEPARATE_OWNERS else None)
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
            trades = [trade for trade in self.state["trades"] if trade.get("owner") not in SEPARATE_OWNERS]
            visible_trades = [trade for trade in trades[:-20] if day(trade["exit_at"]) == day(now)] + trades[-20:]
            automation_on = bool(self.state.get("automation_on")) and \
                self.state["armed_day"] == day(now) and not self.state["killed"]
            wanted = bool(self.state.get("automation_wanted")) and not self.state["killed"]
            snapshot = self.service().snapshot()
            selections = {symbol: self.select_entry(symbol, signal)
                          for symbol, signal in snapshot["data"].items()}
            return {
                "generated_at": now, "daily_counts": counts(self.state, now),
                "enabled": cfg.aqte_live_enabled,
                "unvalidated_rules": cfg.aqte_live_allow_unvalidated_rules,
                "expected_ip": cfg.aqte_live_static_ip, "preflight": copy.deepcopy(self.check),
                "armed": self.state["armed_day"] == day(now) and not self.state["killed"],
                "automation_on": automation_on, "automation_wanted": wanted,
                "automation_waiting": self.waiting_reason(now) if wanted and not automation_on else None,
                "entry_window": entry_window(now),
                "killed": self.state["killed"], "flatten_pending": bool(self.state.get("flatten_pending")),
                "active": active, "error": self.error, "entry_note": self.entry_note,
                "entry_scan": copy.deepcopy(self.entry_scan),
                "styles": {symbol: selected["style"] for symbol, selected in selections.items()},
                "style_checks": {symbol: selected["style_checks"] for symbol, selected in selections.items()},
                "trail_starts": {symbol: control["trail_start_r"]
                                 for symbol, control in self.state["daily_controls"].items()},
                # Lets the UI mirror enabled_setup() and show the setup the controller would actually trade.
                "swing_setups": {symbol: dict(control["setups"])
                                 for symbol, control in self.state["daily_controls"].items()
                                 if isinstance(control.get("setups"), dict)},
                "entry_blocks": {symbol: selected["check"][0] for symbol, selected in selections.items()},
                "entry_plans": {symbol: selected["check"][1] for symbol, selected in selections.items()},
                "ranking": sorted(snapshot["data"], key=lambda symbol: rank_key(
                    selections[symbol]["signal"]), reverse=True),
                "ready": self.ready, "trades": copy.deepcopy(visible_trades),
                "morning": {**self.morning_service().snapshot(),
                            "enabled": self.state.get("morning_enabled") is True}
                           if self.morning_service() is not None else None,
                "limits": {"risk_per_trade": cfg.aqte_live_risk_per_trade,
                           "daily_loss": cfg.aqte_live_daily_loss, "max_trades": cfg.aqte_live_max_trades,
                           "max_losses": cfg.aqte_live_max_losses, "max_lots": 1},
            }

    def pins(self):
        with self.lock:
            active = self.state["active"]
            return {active["contract"]["token"]: Contract(**active["contract"])} if active else {}

    def effective(self, symbol, signal):
        return self.select_entry(symbol, signal)["signal"]

    def select_entry(self, symbol, signal):
        """Pick one allowed, risk-cleared style before ranking; this never calls the broker."""
        control = self.state["daily_controls"][symbol]
        allowed = control.get("style", "swing")
        scalp = signal.get("scalp") or {}
        candidates = []
        if allowed in ("scalp", "both"):
            candidates.append(("scalp", {
                **signal, "decision": scalp.get("decision") or "WAIT", "strategy": scalp.get("strategy"),
                "confidence": scalp.get("confidence"), "contract": scalp.get("contract"),
                "entry": scalp.get("entry"), "reasons": scalp.get("reasons") or ["Waiting for a quick-scalp setup"]}))
        if allowed in ("swing", "both"):
            candidates.append(("swing", self.enabled_setup(control, signal)))
        if self.state.get("morning_enabled") is True and isinstance(signal.get("morning"), dict):
            morning = signal["morning"]
            candidates.append(("morning", {**morning, "engines": signal.get("engines") or [],
                                           "orchestration": signal.get("orchestration")}))
        if not candidates:
            waiting = {**signal, "decision": "WAIT", "strategy": None, "confidence": None,
                       "contract": None, "entry": None, "reasons": ["No entry style selected in Controls"]}
            return dict(style=None, signal=waiting, check=self.entry_check(symbol, waiting), style_checks={})
        evaluated = [dict(style=style, signal=candidate, check=self.entry_check(symbol, candidate))
                     for style, candidate in candidates]
        selected = max(evaluated, key=lambda candidate: (
            candidate["check"][0] is None, *rank_key(candidate["signal"])))
        return {**selected, "style_checks": {item["style"]: item["check"][0] for item in evaluated}}

    @staticmethod
    def enabled_setup(control, signal):
        """When the engine's best swing setup is OFF, use the best ON same-side setup that passed its own gate.

        Same side means the same option contract and entry price; quality_reason still re-derives the gate.
        """
        enabled = control.get("setups") or {}
        if signal.get("decision") not in ("BUY CE", "BUY PE") or enabled.get(signal.get("strategy")):
            return signal
        side = signal["decision"][-2:]
        for setup in signal.get("setups") or ():
            if setup.get("passed") is True and setup.get("side") == side and enabled.get(setup.get("name")):
                return {**signal, "strategy": setup["name"], "confidence": setup["score"],
                        "reasons": [setup["name"].replace("_", " "), *(signal.get("reasons") or [])[1:]]}
        return signal

    @staticmethod
    def setup_key(symbol, signal):
        # One entry per strategy candle; scalp tier changes inside the candle are the same setup.
        if signal.get("source") == "morning":
            return f'{symbol}:morning:{signal["intelligence"]["at"]}:{signal["decision"][-2:]}'
        return opportunity_key(symbol, signal)

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
        if signal.get("decision") not in ("BUY CE", "BUY PE") or not signal.get("entry"):
            return "; ".join(signal.get("reasons") or ["No confirmed LONG CE/PE opportunity"])
        if signal.get("source") == "morning":
            morning = self.morning_service()
            if self.state.get("morning_enabled") is not True or morning is None:
                return "Separate owner approval for Morning Trade Engine is OFF"
            reason = morning.quality_reason(symbol, signal, control["min_confidence"],
                                            self.settings().aqte_live_allow_unvalidated_rules)
        else:
            reason = quality_reason(signal, control, self.settings().aqte_live_allow_unvalidated_rules)
        if reason:
            return reason
        # The 12 engines never approve an entry; they can only block one they clearly oppose.
        config = getattr(self.service(), "engine_config", None)
        reason = veto_reason(signal, config if isinstance(config, EngineConfig) else EngineConfig())
        if reason:
            return reason
        if signal.get("source") != "morning":
            return aqte_confirmation_reason(symbol, signal["decision"])
        return None

    def morning_service(self):
        from services.aqte_morning import MorningService
        service = getattr(self.service(), "morning", None)
        return service if isinstance(service, MorningService) else None

    def set_morning(self, enabled):
        with self.lock:
            if not self.ready:
                raise LiveBlocked("Live journal unavailable; morning approval was not saved")
            morning = self.morning_service()
            if enabled:
                self.config_guard()
                if self.state["killed"]:
                    raise LiveBlocked("Emergency stop is latched; morning approval was not changed")
                if morning is None or not morning.store.configured:
                    raise LiveBlocked("Morning durable market-data storage is unavailable")
                if not self.settings().aqte_live_allow_unvalidated_rules:
                    raise LiveBlocked("Morning rules are not validated; existing unvalidated-rule opt-in is required")
            self.state["morning_enabled"] = bool(enabled)
            self.proposals.clear()
            self.save("MORNING_APPROVAL", enabled=bool(enabled))
            self.wake()
            return self.status()

    def entry_reason(self, symbol, signal):
        """Read-only rule/risk checks shared by status and Controls; never calls the broker."""
        return self.entry_check(symbol, signal)[0]

    def entry_check(self, symbol, signal):
        """(block reason, planned levels): the exact limit/stop/target the controller would send for this signal."""
        reason = self.control_reason(symbol, signal)
        if reason:
            return reason, None
        try:
            self.config_guard()
            entry, risk = self.entry_levels(symbol, signal)
        except LiveBlocked as exc:
            return str(exc), None
        plan = {key: entry[key] for key in ("maximum", "stop", "target", "reward_risk", "quantity")}
        plan.update(risk=round(risk, 2), points=entry.get("points"))
        if self.setup_key(symbol, signal) in self.state["used"]:
            return "This strategy candle was already submitted", plan
        if time.time() < self.skip_until.get(symbol, 0):
            return "Entry retry cooldown after a transient price/quote check", plan
        return None, plan

    def loss_budget_reason(self, symbol: str, risk: float) -> str | None:
        today = day(time.time())
        trades = [trade for trade in self.state["trades"] if day(trade["entry_at"]) == today]
        cfg = self.settings()
        if risk > cfg.aqte_live_daily_loss + sum(trade["net_pnl"] for trade in trades):
            return "Trade exceeds remaining daily live loss budget"
        index_pnl = sum(trade["net_pnl"] for trade in trades if trade["symbol"] == symbol)
        budget = min(self.state["daily_controls"][symbol]["daily_loss"], cfg.aqte_live_daily_loss)
        if risk > budget + index_pnl:
            return "Trade exceeds remaining daily index loss budget"
        return None

    def record_entry_scan(self, blocks: dict[str, str], styles: dict[str, str | None]) -> None:
        now = time.time()
        self.entry_scan = dict(at=now, blocks=blocks, styles=styles)
        if now >= self.next_scan_audit:
            self.save("ENTRY_SCAN", **self.entry_scan)
            self.next_scan_audit = now + ENTRY_SCAN_AUDIT_SECONDS

    def daily_controls(self):
        with self.lock:
            snapshot = self.service().snapshot()
            aqte_state = {
                **self.state,
                "trades": [trade for trade in self.state["trades"] if trade.get("owner") not in SEPARATE_OWNERS],
                "daily_entries": [entry for entry in self.state["daily_entries"]
                                  if entry.get("owner") not in SEPARATE_OWNERS],
            }
            total = counts(self.state, time.time())
            result = {}
            for symbol, control in self.state["daily_controls"].items():
                selected = self.select_entry(symbol, snapshot["data"][symbol])
                signal = selected["signal"]
                entry = selected["check"][1] or signal.get("entry")
                count = counts(aqte_state, time.time(), symbol)
                reason = selected["check"][0]
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
                                     strategy=f'quick_scalp_{entry["points"]:g}' if entry and entry.get("points") else signal.get("strategy"),
                                     style=selected["style"],
                                     style_checks=selected["style_checks"],
                                     entry=entry, contract=signal.get("contract"),
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
        if not cfg.force_outbound_ipv4:
            raise LiveBlocked("FORCE_OUTBOUND_IPV4 must be enabled")
        if any(os.getenv(name) for name in ("HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY",
                                            "https_proxy", "http_proxy", "all_proxy")):
            raise LiveBlocked("Proxy routing must be removed before verifying direct broker egress")
        try:
            expected = ipaddress.IPv4Address(cfg.aqte_live_static_ip)
        except ipaddress.AddressValueError as exc:
            raise LiveBlocked("AQTE_LIVE_STATIC_IP must be a valid public IPv4 address") from exc
        if not expected.is_global:
            raise LiveBlocked("Configured static IP must be a public IPv4 address")
        return cfg

    def checked_outbound_ip(self):
        try:
            return self.ip_check()
        except requests.RequestException as exc:
            raise LiveBlocked(
                f"Backend outbound IP verification unavailable ({type(exc).__name__}); live entries remain blocked"
            ) from exc

    def book(self, broker):
        """Split Kite's account into AQTE-owned exposure/orders and the owner's own trades.

        AQTE only buys with its E tag, so its share of a position is its tagged net fills, capped by
        what Kite still holds. Everything else (manual or other-app trades) is the owner's and only
        marks that contract busy: AQTE never cancels, modifies, exits or adds to it.
        """
        orders = broker.orders()
        positions = [p for p in broker.positions()["net"] if int(p["quantity"])]
        held = {}
        for order in orders:
            filled = int(order.get("filled_quantity") or 0)
            if not filled or not algo_order(order):
                continue
            key = (order["exchange"], order["tradingsymbol"], order["product"])
            if order["transaction_type"] == "SELL":
                held[key] = held.get(key, 0) - filled
            elif str(order.get("tag")).endswith("E"):
                held[key] = held.get(key, 0) + filled
        owned, busy = [], set()
        for position in positions:
            quantity = int(position["quantity"])
            mine = max(0, min(quantity, held.get(
                (position.get("exchange"), position.get("tradingsymbol"), position.get("product")), 0)))
            if mine:
                owned.append({**position, "quantity": mine})
            if quantity != mine:
                busy.add(int(position["instrument_token"]))
        working = []
        for order in orders:
            if order["status"] in TERMINAL:
                continue
            if algo_order(order):
                working.append(order)
            elif order.get("instrument_token") is not None:
                busy.add(int(order["instrument_token"]))
        return dict(orders=orders, owned=owned, working=working, busy=busy)

    @staticmethod
    def own_clear(book):
        """Without an active trade, only AQTE's own untracked exposure/orders block; owner trades never do."""
        if book["owned"]:
            names = ", ".join(sorted({p["tradingsymbol"] for p in book["owned"]}))
            raise LiveBlocked(f"Untracked AQTE position in {names}; close it in Kite before new AQTE entries")
        if book["working"]:
            names = ", ".join(sorted({str(o.get("tradingsymbol")) for o in book["working"]}))
            raise LiveBlocked(f"AQTE order still working for {names}; wait for Kite to settle it")

    def preflight(self):
        with self.lock:
            self.check = None
            cfg = self.config_guard()
            if self.state["active"]:
                raise LiveBlocked("Reconcile active live trade before running entry preflight")
            ip = self.checked_outbound_ip()
            if ip != cfg.aqte_live_static_ip:
                raise LiveBlocked(f"Outbound IP {ip} does not match allowlisted IP {cfg.aqte_live_static_ip}")
            broker = self.broker()
            account = broker.profile()["user_id"]
            if not account:
                raise LiveBlocked("Broker account identity unavailable")
            self.own_clear(self.book(broker))
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

    def entry_guard(self, broker, owner="AQTE"):
        cfg = self.config_guard()
        now = time.time()
        if owner == "QUANTEDGE":
            if not self.state.get("quantedge", {}).get("enabled"):
                raise LiveBlocked("QuantEdge Pro live approval is OFF; no new entry orders permitted")
        elif owner == "EXPIRYEDGE":
            if not self.expiryedge_enabled():
                raise LiveBlocked("Every 6 Algo Desk algo is OFF; no new entry orders permitted")
        elif owner == "EXPIRYEDGE_AI":
            if not getattr(cfg, "expiryedge_ai_live_enabled", False):
                raise LiveBlocked("ExpiryEdge AI live execution is disabled by EXPIRYEDGE_AI_LIVE_ENABLED")
            if not self.expiryedge_ai_enabled():
                raise LiveBlocked("ExpiryEdge AI live approval is OFF; no new entry orders permitted")
        elif not self.state.get("automation_on"):
            raise LiveBlocked("Automated real trading is OFF; no new entry orders permitted")
        if self.state["killed"] or self.state["armed_day"] != day(now):
            raise LiveBlocked("Live trading is not armed for this session")
        if not session(now) or datetime.fromtimestamp(now, IST).hour * 60 + datetime.fromtimestamp(now, IST).minute >= 915:
            raise LiveBlocked("Live entries permitted only from 09:15 until 15:15 IST")
        if self.state["active"]:
            raise LiveBlocked("Only one live trade may be pending/open across all indices")
        if self.checked_outbound_ip() != cfg.aqte_live_static_ip:
            self.state["armed_day"] = None
            self.state["automation_on"] = False
            self.save("IP_MISMATCH_DISARMED")
            raise LiveBlocked("Backend outbound IP changed; live session disarmed")
        if broker.profile()["user_id"] != self.state["account"]:
            raise LiveBlocked("Broker account identity changed")
        book = self.book(broker)
        self.own_clear(book)
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
        return book

    def free_contract(self, symbol, signal, busy):
        """Never add AQTE to a contract the owner holds or has an order in: use the next liquid strike."""
        held = signal["contract"]
        if held["token"] not in busy:
            return signal
        market, side, tried = self.service(), signal["decision"][-2:], set(busy)
        while True:
            with market.lock:
                spot = market.engine.spot.get(symbol)
                picked = market.engine.pick(symbol, side, time.time(), spot, exclude=tried) if spot else None
            if picked is None:
                break
            _, contract, quote = picked
            tried.add(contract.token)
            limit = round_tick(quote.ask, contract.tick_size, up=True)
            candidate = {**signal, "contract": asdict(contract), "avoided": held["trading_symbol"], "entry": {
                **signal["entry"], "low": round_tick(quote.bid, contract.tick_size), "high": limit,
                "maximum": limit, "quantity": contract.lot_size}}
            if signal.get("source") == "morning":
                from services.aqte_morning import option_levels
                if quote.bid_quantity < contract.lot_size:
                    continue
                candidate["entry"], model = option_levels(
                    contract, quote, spot.price, signal["evidence"]["atr"], time.time(),
                    market.engine_config.risk_free_rate)
                candidate["evidence"] = {**signal["evidence"], "option": asdict(quote), "greeks": model}
            if self.control_reason(symbol, candidate):
                continue
            try:
                self.entry_levels(symbol, candidate)
            except EntrySkipped:
                continue
            return candidate
        raise EntrySkipped(f"You already hold {held['trading_symbol']} in Kite; no other liquid {side} strike fits. "
                           "Leaving your trade untouched and waiting for the next opportunity")

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
            if (self.state.get("automation_wanted") and not self.state["active"]
                    and not self.state.get("flatten_pending") and not self.state["killed"]):
                self.error = None
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
            selections = {symbol: self.select_entry(symbol, signal) for symbol, signal in snapshot["data"].items()}
            signals = {symbol: selected["signal"] for symbol, selected in selections.items()}
            blocks: dict[str, str] = {}
            scan: dict[str, set] = {}

            def busy():
                # One Kite book read per scan, and only once a candidate passes every local check.
                if "busy" not in scan:
                    scan["busy"] = self.book(self.broker())["busy"]
                return scan["busy"]

            for symbol in sorted(signals, key=lambda s: rank_key(signals[s]), reverse=True):
                signal = signals[symbol]
                reason = self.control_reason(symbol, signal)
                if reason:
                    blocks[symbol] = reason
                    continue
                if signal["decision"] not in ("BUY CE", "BUY PE") or not signal.get("entry"):
                    blocks[symbol] = "No confirmed LONG CE/PE opportunity"
                    continue
                if self.setup_key(symbol, signal) in self.state["used"]:
                    blocks[symbol] = "This strategy candle was already submitted"
                    continue
                if time.time() < self.skip_until.get(symbol, 0):
                    blocks[symbol] = "Entry retry cooldown: " + self.skip_reasons.get(symbol, "Transient price/quote check")
                    continue
                try:
                    proposal = self.proposal(symbol, busy)
                    self.confirm(proposal["id"])
                except EntrySkipped as exc:
                    # Price/quote moved between signal and broker checks: retry shortly, stay armed.
                    self.skip_until[symbol] = time.time() + ENTRY_RETRY_SECONDS
                    self.skip_reasons[symbol] = str(exc)
                    note = f"{symbol}: {exc}"
                    if note != self.entry_note:
                        logger.info("AQTE automated entry skipped: %s", note)
                    self.entry_note = note
                    blocks[symbol] = str(exc)
                    continue
                self.entry_note = None
                blocks[symbol] = "Entry submitted"
                for other in signals.keys() - blocks.keys():
                    blocks[other] = "Not attempted: one entry already submitted"
                break
            self.record_entry_scan(blocks, {symbol: selected["style"] for symbol, selected in selections.items()})

    def proposal(self, symbol, busy=None):
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
            # The strategy candle stays the engine's setup even if the owner's trade moves AQTE to another strike.
            setup_key = self.setup_key(symbol, signal)
            # Known premium/risk/budget skips must not spend a broker request.
            self.entry_levels(symbol, signal)
            if busy is None:
                busy = self.book(self.broker())["busy"]
            elif callable(busy):
                busy = busy()
            signal = self.free_contract(symbol, signal, busy)
            with market.lock:
                quote = market.engine.options.get(signal["contract"]["token"])
                if not market.engine.fresh(quote, time.time()):
                    raise EntrySkipped("Option quote stale")
            now = time.time()
            entry, risk = self.entry_levels(symbol, signal)
            self.proposals = {key: value for key, value in self.proposals.items() if value["expires_at"] > now}
            key = uuid4().hex
            result = {"id": key, "symbol": symbol, "contract": signal["contract"],
                      "strategy": f'quick_scalp_{entry["points"]:g}' if "points" in entry else signal.get("strategy"),
                      "entry": entry, "risk": round(risk, 2), "signal_at": signal["at"], "owner": "AQTE",
                      "expires_at": now + 15, "setup_key": setup_key}
            result["execution_context"] = capture_context(signal, result["strategy"], entry)
            if signal.get("avoided"):
                result["avoided"] = signal["avoided"]
            self.proposals[key] = copy.deepcopy(result)
            return result

    def quantedge_candidate(self, symbol, busy=None):
        if busy is None:
            busy = self.book(self.broker())["busy"]
        elif callable(busy):
            busy = busy()
        return build_candidate(self.service(), symbol, time.time(), self.state["quantedge"]["lots"],
                              busy, self.costs, max_risk=500)

    def quantedge_proposal(self, symbol, busy=None):
        with self.lock:
            self.config_guard()
            qep = self.state["quantedge"]
            if not qep["enabled"]:
                raise LiveBlocked("QuantEdge Pro separate live approval is OFF")
            if self.state["armed_day"] != day(time.time()) or self.state["killed"]:
                raise LiveBlocked("Complete existing broker preflight and arm the live session first")
            if self.state["active"]:
                raise EntrySkipped("The shared execution manager already has an active trade")
            entries = [entry for entry in self.state["daily_entries"]
                       if entry.get("owner") == "QUANTEDGE" and day(entry["at"]) == day(time.time())]
            trades = [trade for trade in self.state["trades"]
                      if trade.get("owner") == "QUANTEDGE" and day(trade["entry_at"]) == day(time.time())]
            if len(entries) >= 5:
                raise EntrySkipped("QuantEdge Pro daily trade limit reached (5)")
            if sum(trade["net_pnl"] for trade in trades) <= -1500:
                raise EntrySkipped("QuantEdge Pro daily loss limit reached (INR 1500)")
            signal = self.quantedge_candidate(symbol, busy)
            if signal.get("decision") not in ("BUY CE", "BUY PE") or not signal.get("entry"):
                raise EntrySkipped(signal.get("reason") or "No qualified QuantEdge Pro breakout")
            if signal["setup_key"] in self.state["used"]:
                raise EntrySkipped("This QuantEdge Pro candle was already submitted")
            now = time.time()
            self.proposals = {key: value for key, value in self.proposals.items() if value["expires_at"] > now}
            result = {
                "id": uuid4().hex,
                "owner": "QUANTEDGE",
                "symbol": symbol,
                "contract": signal["contract"],
                "strategy": signal["strategy"],
                "entry": signal["entry"],
                "risk": signal["risk"],
                "signal_at": signal["signal_at"],
                "expires_at": now + 15,
                "setup_key": signal["setup_key"],
                "execution_context": {
                    "strategy_name": "Super Candle + Bollinger Breakout",
                    "entry_engine": "QuantEdge Pro Independent Rules",
                    "reason": signal["reason"],
                    "supporting_engines": [],
                    "confidence": None,
                    "captured_at": now,
                },
            }
            self.proposals[result["id"]] = copy.deepcopy(result)
            return result

    def quantedge_loss_budget_reason(self, risk):
        trades = [trade for trade in self.state["trades"]
                  if trade.get("owner") == "QUANTEDGE" and day(trade["entry_at"]) == day(time.time())]
        pnl = sum(trade["net_pnl"] for trade in trades)
        if pnl <= -1500:
            return "QuantEdge Pro daily loss limit reached (INR 1500)"
        if pnl - risk <= -1500:
            return "QuantEdge Pro planned stop risk would breach its INR 1500 daily loss limit"
        return None

    def quantedge_status(self):
        with self.lock:
            qep = self.state["quantedge"]
            now = time.time()
            entries = [entry for entry in self.state["daily_entries"]
                       if entry.get("owner") == "QUANTEDGE" and day(entry["at"]) == day(now)]
            trades = [trade for trade in self.state["trades"]
                      if trade.get("owner") == "QUANTEDGE" and day(trade["entry_at"]) == day(now)]
            signals = {}
            for symbol in SYMBOLS:
                try:
                    signals[symbol] = self.quantedge_candidate(symbol, set())
                except (KeyError, TypeError, ValueError) as exc:
                    signals[symbol] = {"decision": "WAIT", "reason": f"Signal unavailable ({type(exc).__name__})"}
            active = self.state.get("active")
            return {
                "generated_at": now,
                "ready": self.ready,
                "enabled": qep["enabled"],
                "armed": self.state["armed_day"] == day(now) and not self.state["killed"],
                "entry_window": entry_window(now),
                "lots": qep["lots"],
                "risk_per_trade": 500,
                "daily_loss_limit": 1500,
                "max_trades": 5,
                "daily_trades": len(entries),
                "daily_pnl": round(sum(trade["net_pnl"] for trade in trades), 2),
                "active": copy.deepcopy(active) if active and active.get("owner") == "QUANTEDGE" else None,
                "error": qep.get("error"),
                "signals": signals,
            }

    def set_quantedge_config(self, lots):
        with self.lock:
            if not self.ready:
                raise LiveBlocked("Live journal unavailable; QuantEdge Pro settings were not saved")
            if type(lots) is not int or not 1 <= lots <= 5:
                raise LiveBlocked("QuantEdge Pro lots must be an integer from 1 through 5")
            if self.state["quantedge"]["enabled"] or self.state.get("automation_on") or self.state["active"]:
                raise LiveBlocked("Stop automated entries and wait for the active trade to finish before changing lots")
            self.state["quantedge"]["lots"] = lots
            self.proposals = {key: value for key, value in self.proposals.items()
                              if value.get("owner") != "QUANTEDGE"}
            self.save("QUANTEDGE_CONFIG_SAVED", lots=lots)
            return self.quantedge_status()

    def set_quantedge_approval(self, enabled):
        with self.lock:
            if type(enabled) is not bool:
                raise LiveBlocked("QuantEdge Pro approval must be an explicit boolean")
            if not self.ready:
                raise LiveBlocked("Live journal unavailable; QuantEdge Pro approval was not changed")
            if enabled:
                self.config_guard()
                if self.state["killed"] or self.state.get("flatten_pending"):
                    raise LiveBlocked("Resolve the emergency stop before enabling QuantEdge Pro")
            self.state["quantedge"]["enabled"] = enabled
            if enabled:
                self.state["quantedge"].pop("error", None)
                self.quantedge_next_activation = 0.0
            else:
                self.state["quantedge"]["error"] = None
                self.quantedge_next_activation = 0.0
            self.proposals = {key: value for key, value in self.proposals.items()
                              if value.get("owner") != "QUANTEDGE"}
            self.save("QUANTEDGE_APPROVAL_ON" if enabled else "QUANTEDGE_APPROVAL_OFF",
                      lots=self.state["quantedge"]["lots"])
            return self.quantedge_status()

    def quantedge_activate(self, now):
        if self.state["armed_day"] == day(now) and not self.state["killed"]:
            return True
        if (self.state["killed"] or self.state.get("flatten_pending") or self.state["active"] or
                not entry_window(now) or now < self.quantedge_next_activation):
            return False
        try:
            self.preflight()
            self.arm()
        except LiveBlocked as exc:
            reason = str(exc)
            self.quantedge_next_activation = now + ACTIVATION_RETRY_SECONDS
            if reason != self.state["quantedge"].get("error"):
                self.state["quantedge"]["error"] = reason
                self.save("QUANTEDGE_WAITING", reason=reason[:500])
            return False
        self.quantedge_next_activation = 0.0
        if self.state["quantedge"].pop("error", None) is not None:
            self.save("QUANTEDGE_READY")
        return True

    def request_quantedge_exit(self, trade_id):
        with self.lock:
            active = self.state.get("active")
            if not active or active.get("owner") != "QUANTEDGE" or active["id"] != trade_id:
                raise LiveBlocked("The selected QuantEdge Pro trade is no longer active")
            self.request_exit(trade_id)
            return self.quantedge_status()

    def automated_quantedge_entry(self):
        with self.lock:
            now = time.time()
            if not self.state["quantedge"]["enabled"] or self.state["active"] or not entry_window(now):
                return
            qualified = []
            present = set()
            for symbol in SYMBOLS:
                candidate = self.quantedge_candidate(symbol, set())
                setup_key = candidate.get("setup_key")
                if candidate.get("side") in ("CE", "PE") and setup_key:
                    present.add(setup_key)
                    if setup_key in self.state["used"]:
                        continue
                    if candidate.get("decision") == "WAIT":
                        self.record_quantedge_opportunity(candidate, "REJECTED", candidate.get("reason") or
                                                          "Live option or risk checks did not pass")
                        continue
                if candidate.get("decision") not in ("BUY CE", "BUY PE"):
                    continue
                metrics = candidate["metrics"]
                rank = (candidate["signal_at"], metrics["volume_ratio"], metrics["body_ratio"],
                        -candidate["spread_fraction"], -candidate["risk"])
                qualified.append((rank, symbol, candidate))
            for key, previous in list(self.opportunities.items()):
                if previous.get("owner") == "QUANTEDGE" and key not in present and previous.get("state") in (
                    "REJECTED", "MISSED"
                ):
                    record = {**previous, "state": "EXPIRED", "at": time.time(),
                              "reason": f"QuantEdge Pro candle is no longer eligible; last decision: {previous['reason']}"}
                    self.save("OPPORTUNITY", record=record)
                    self.opportunities[key] = record
            if not qualified:
                return
            if not self.quantedge_activate(now):
                return
            busy = self.book(self.broker())["busy"]
            for _, symbol, candidate in sorted(qualified, key=lambda item: item[0], reverse=True):
                setup_key = candidate["setup_key"]
                self.publish_quantedge_event(
                    "SIGNAL_GENERATED",
                    f'{symbol} {candidate["decision"]} breakout qualified; checking live execution gates',
                    "success", setup_key, symbol,
                )
                try:
                    proposal = self.quantedge_proposal(symbol, busy)
                    self.confirm(proposal["id"])
                    self.record_quantedge_opportunity(
                        candidate, "ACCEPTED", "Entry intent persisted; broker fills are reconciled separately"
                    )
                    return
                except EntrySkipped as exc:
                    self.record_quantedge_opportunity(candidate, "REJECTED", str(exc))
                    continue
                except LiveBlocked as exc:
                    self.record_quantedge_opportunity(candidate, "REJECTED", str(exc))
                    raise

    def record_quantedge_opportunity(self, candidate, state, reason):
        key = candidate["setup_key"]
        previous = self.opportunities.get(key)
        if previous and (previous.get("state"), previous.get("reason")) == (state, reason):
            return
        active = self.state.get("active") or {}
        record = {
            "key": key,
            "owner": "QUANTEDGE",
            "symbol": candidate["symbol"],
            "style": "quantedge",
            "strategy": candidate.get("strategy") or "super_candle_bollinger_breakout_v1",
            "state": state,
            "reason": reason,
            "at": time.time(),
            "first_at": previous["first_at"] if previous else time.time(),
            "signal_at": candidate.get("signal_at"),
            "score": (candidate.get("metrics") or {}).get("volume_ratio"),
            "reward_risk": (candidate.get("entry") or {}).get("reward_risk"),
            "expected_value": None,
            "expected_value_reason": "No validated/calibrated probability model",
            "broker_order_id": active.get("entry_id") if active.get("setup_key") == key else None,
        }
        self.save("OPPORTUNITY", record=record)
        self.opportunities[key] = record
        self.metrics.increment(f"quantedge.opportunities.{state.lower()}")

    @staticmethod
    def publish_quantedge_event(event_type, message, severity, key, instrument):
        from services.engine_events import get_engine_event_service

        get_engine_event_service().publish_threadsafe(
            event_type, message, instrument=instrument, severity=severity, source="quantedge_pro",
            idempotency_key=f"quantedge-pro:{event_type}:{key}",
        )

    def scan_quantedge(self):
        try:
            self.automated_quantedge_entry()
        except Exception as exc:
            reason = f"{type(exc).__name__}: {exc}"
            with self.lock:
                self.state["quantedge"]["enabled"] = False
                self.state["quantedge"]["error"] = reason
                self.proposals = {key: value for key, value in self.proposals.items()
                                  if value.get("owner") != "QUANTEDGE"}
                self.save("QUANTEDGE_SCAN_BLOCKED", reason=reason[:500])
            logger.exception("QuantEdge Pro entry scan disarmed; AQTE execution remains separate")

    def expiryedge_ai_enabled(self):
        return bool(self.state.get("expiryedge_ai", {}).get("enabled"))

    def set_expiryedge_ai_enabled(self, enabled, symbol=None):
        with self.lock:
            if type(enabled) is not bool:
                raise LiveBlocked("ExpiryEdge AI approval must be an explicit boolean")
            if not self.ready:
                raise LiveBlocked("Live journal unavailable; ExpiryEdge AI approval was not changed")
            if enabled:
                self.config_guard()
                if not getattr(self.settings(), "expiryedge_ai_live_enabled", False):
                    raise LiveBlocked("ExpiryEdge AI live execution is disabled by EXPIRYEDGE_AI_LIVE_ENABLED")
                if self.state["killed"] or self.state.get("flatten_pending"):
                    raise LiveBlocked("Emergency stop is active; operator review is required before enabling ExpiryEdge AI")
                schedules = get_expiryedge_config()["schedules"]
                if any(not schedules[index]["weekday"] for index in SYMBOLS):
                    raise LiveBlocked("Save an expiry weekday for NIFTY, BANKNIFTY, and SENSEX before enabling")
            self.state["expiryedge_ai"]["enabled"] = enabled
            self.state["expiryedge_ai"]["error"] = None
            self.state["expiryedge_ai"]["waiting"] = None
            self.proposals = {key: value for key, value in self.proposals.items()
                              if value.get("owner") != "EXPIRYEDGE_AI"}
            self.save("EXPIRYEDGE_AI_ON" if enabled else "EXPIRYEDGE_AI_OFF")
            if enabled:
                self.expiryedge_ai_failures = 0
                self.expiryedge_ai_next_activation = 0.0
                now = time.time()
                if entry_window(now) and not self.state["active"]:
                    self.expiryedge_ai_activate(now)
            self.wake()
            return self.expiryedge_ai_status(symbol)

    def expiryedge_ai_note(self, reason):
        owner_state = self.state["expiryedge_ai"]
        if reason == owner_state.get("waiting"):
            return
        owner_state["waiting"] = reason
        if self.ready:
            self.save("EXPIRYEDGE_AI_WAITING", reason=reason[:500] if reason else None)

    def expiryedge_ai_activate(self, now):
        if self.state["armed_day"] == day(now) and not self.state["killed"]:
            return True
        if (self.state["killed"] or self.state.get("flatten_pending") or self.state["active"] or
                not entry_window(now) or now < self.expiryedge_ai_next_activation):
            return False
        try:
            self.preflight()
            self.arm()
            self.expiryedge_ai_note(None)
            return True
        except LiveBlocked as exc:
            reason = str(exc)
        except Exception as exc:
            logger.exception("ExpiryEdge AI broker preflight failed; retrying in %ss", ACTIVATION_RETRY_SECONDS)
            reason = f"Broker preflight failed ({type(exc).__name__}: {exc})"
        self.expiryedge_ai_next_activation = now + ACTIVATION_RETRY_SECONDS
        self.expiryedge_ai_note(f"Arming retry in {ACTIVATION_RETRY_SECONDS}s: {reason}")
        return False

    def expiryedge_ai_evaluate(self, symbol, now):
        schedules = get_expiryedge_config()["schedules"]
        weekday = schedules[symbol]["weekday"]
        if not weekday:
            raise EntrySkipped(f"Save the {symbol} expiry weekday before live evaluation")
        now_dt = datetime.fromtimestamp(now, IST)
        if weekday != now_dt.strftime("%A"):
            raise EntrySkipped(f"Waiting for the configured {weekday} expiry weekday")

        market = self.service()
        with market.lock, market.health_lock:
            engine = market.engine
            future = engine.future.get(symbol)
            spot = engine.spot.get(symbol)
            if (not market.started or market.failed.is_set() or market.feed_connected is not True or
                    engine.killed or future is None or spot is None or
                    not engine.fresh(future, now) or not engine.fresh(spot, now) or
                    any(gap["symbol"] == symbol for gap in market.gaps.values())):
                raise EntrySkipped(f"{symbol} futures/spot feed is not fresh and healthy")
            contracts = [
                contract for contract in engine.contracts.values()
                if contract.symbol == symbol and contract.side in ("CE", "PE") and contract.expiry >= day(now)
            ]
            if not contracts:
                raise EntrySkipped(f"No current Zerodha option contracts are subscribed for {symbol}")
            nearest_expiry = min(contract.expiry for contract in contracts)
            if nearest_expiry != day(now):
                raise EntrySkipped(f"Today is not the nearest listed {symbol} option expiry")
            bars = list(engine.book.closed.get(("future", future.token, 60), ()))
        signal = evaluate_opening_range(symbol, bars, now)
        if not signal["ready"]:
            raise EntrySkipped(signal["reason"])
        return {**signal, "option_expiry": nearest_expiry}

    def expiryedge_ai_loss_budget_reason(self, risk):
        today = day(time.time())
        trades = [trade for trade in self.state["trades"]
                  if trade.get("owner") == "EXPIRYEDGE_AI" and day(trade["entry_at"]) == today]
        pnl = sum(trade["net_pnl"] for trade in trades)
        if pnl <= -EXPIRYEDGE_AI_DAILY_LOSS_CAP:
            return f"ExpiryEdge AI daily loss limit reached (INR {EXPIRYEDGE_AI_DAILY_LOSS_CAP:,.0f})"
        if pnl - risk < -EXPIRYEDGE_AI_DAILY_LOSS_CAP:
            return "Planned stop risk would breach the ExpiryEdge AI INR 3,000 daily loss limit"
        return None

    def expiryedge_ai_entries(self, now):
        return sum(1 for entry in self.state["daily_entries"]
                   if entry.get("owner") == "EXPIRYEDGE_AI" and day(entry["at"]) == day(now))

    def expiryedge_ai_proposal(self, symbol, busy=None):
        with self.lock:
            if not self.expiryedge_ai_enabled():
                raise LiveBlocked("ExpiryEdge AI live approval is OFF")
            if not getattr(self.settings(), "expiryedge_ai_live_enabled", False):
                raise LiveBlocked("ExpiryEdge AI live execution is disabled by EXPIRYEDGE_AI_LIVE_ENABLED")
            now = time.time()
            if self.state["killed"] or self.state.get("flatten_pending"):
                raise LiveBlocked("Emergency stop is active")
            if self.state["armed_day"] != day(now):
                raise LiveBlocked("ExpiryEdge AI live session is not armed")
            if self.state["active"]:
                raise EntrySkipped("The account-wide automated trade slot is occupied")
            if not entry_window(now):
                raise EntrySkipped("ExpiryEdge AI entries are allowed only from 09:20 until 15:15 IST")
            if self.expiryedge_ai_entries(now) >= EXPIRYEDGE_AI_MAX_TRADES:
                raise EntrySkipped("ExpiryEdge AI daily trade limit reached (1)")

            signal = self.expiryedge_ai_evaluate(symbol, now)
            if signal["setup_key"] in self.state["used"]:
                raise EntrySkipped("This ExpiryEdge AI candle was already submitted")
            if busy is None:
                busy = self.book(self.broker())["busy"]

            market = self.service()
            with market.lock:
                engine = market.engine
                spot = engine.spot.get(symbol)
                if not engine.fresh(spot, now):
                    raise EntrySkipped("Underlying spot price became stale during option selection")
                candidates = []
                for contract in engine.contracts.values():
                    if (contract.symbol != symbol or contract.side != signal["side"] or
                            contract.expiry != signal["option_expiry"] or contract.token in busy):
                        continue
                    quote = engine.options.get(contract.token)
                    if (not engine.fresh(quote, now) or not 0 < quote.bid <= quote.ask or
                            quote.ask_quantity < contract.lot_size or quote.volume <= 0):
                        continue
                    spread = quote.ask - quote.bid
                    if spread / quote.ask > engine.policy.spread_fraction:
                        continue
                    candidates.append((abs(contract.strike - spot.price), spread, contract, quote))
                if not candidates:
                    raise EntrySkipped("No fresh, liquid Zerodha ATM option is available for this expiry")
                _, _, contract, quote = min(candidates, key=lambda item: item[:2])
            limit = round_tick(quote.ask, contract.tick_size, up=True)
            proposal_signal = {
                **signal,
                "source": "expiryedge_ai",
                "decision": f"BUY {signal['side']}",
                "strategy": "expiryedge_ai_orb_vwap",
                "contract": asdict(contract),
                "entry": {
                    "low": round_tick(quote.bid, contract.tick_size),
                    "high": limit,
                    "maximum": limit,
                    "quantity": contract.lot_size,
                },
            }
            entry, risk = self.entry_levels(symbol, proposal_signal)
            self.proposals = {key: value for key, value in self.proposals.items() if value["expires_at"] > now}
            result = {
                "id": uuid4().hex,
                "owner": "EXPIRYEDGE_AI",
                "symbol": symbol,
                "contract": proposal_signal["contract"],
                "strategy": proposal_signal["strategy"],
                "entry": entry,
                "risk": round(risk, 2),
                "signal_at": signal["signal_at"],
                "expires_at": now + 15,
                "setup_key": signal["setup_key"],
                "execution_context": {
                    "strategy_name": "ExpiryEdge AI ORB/VWAP",
                    "entry_engine": "ExpiryEdge AI standalone opening-range breakout",
                    "reason": signal["reason"],
                    "supporting_engines": [],
                    "confidence": None,
                    "underlying_stop": signal["underlying_stop"],
                    "captured_at": now,
                },
            }
            self.proposals[result["id"]] = copy.deepcopy(result)
            return result

    def automated_expiryedge_ai_entry(self):
        with self.lock:
            now = time.time()
            if (not self.ready or not self.expiryedge_ai_enabled() or
                    now - self.expiryedge_ai_scanned_at < EXPIRYEDGE_SCAN_SECONDS):
                return
            self.expiryedge_ai_scanned_at = now
            if (self.state["killed"] or self.state.get("flatten_pending") or self.state["active"] or
                    not entry_window(now)):
                return
            if not self.expiryedge_ai_activate(now):
                return
            reason = self.expiryedge_account_reason(now)
            if reason:
                self.expiryedge_ai_note(reason)
                return
            if self.expiryedge_ai_entries(now) >= EXPIRYEDGE_AI_MAX_TRADES:
                self.expiryedge_ai_note("ExpiryEdge AI daily trade limit reached (1)")
                return

            candidates = []
            skipped = []
            for symbol in SYMBOLS:
                try:
                    signal = self.expiryedge_ai_evaluate(symbol, now)
                    distance = (
                        signal["last_close"] - signal["opening_range_high"]
                        if signal["side"] == "CE"
                        else signal["opening_range_low"] - signal["last_close"]
                    )
                    candidates.append((distance / signal["atr"], symbol, signal["setup_key"]))
                except EntrySkipped as exc:
                    skipped.append(f"{symbol}: {exc}")
            if not candidates:
                self.expiryedge_ai_note("; ".join(skipped) or "Waiting for a qualified expiry-day setup")
                return

            busy = self.book(self.broker())["busy"]
            for _, symbol, setup_key in sorted(candidates, reverse=True):
                try:
                    proposal = self.expiryedge_ai_proposal(symbol, busy)
                    if proposal["setup_key"] != setup_key:
                        self.proposals.pop(proposal["id"], None)
                        raise EntrySkipped("Signal changed during live Zerodha option checks")
                    self.confirm(proposal["id"])
                    self.expiryedge_ai_note("Order intent submitted; waiting for Zerodha fill confirmation")
                    return
                except EntrySkipped as exc:
                    skipped.append(f"{symbol}: {exc}")
            self.expiryedge_ai_note("; ".join(skipped) or "No live order qualified after final broker checks")

    def scan_expiryedge_ai(self):
        try:
            self.automated_expiryedge_ai_entry()
            self.expiryedge_ai_failures = 0
        except LiveBlocked as exc:
            with self.lock:
                self.expiryedge_ai_note(f"Entries paused: {exc}")
        except Exception as exc:
            reason = f"{type(exc).__name__}: {exc}"
            logger.exception("ExpiryEdge AI entry scan failed")
            with self.lock:
                self.expiryedge_ai_failures += 1
                if self.expiryedge_ai_failures < EXPIRYEDGE_MAX_FAILURES:
                    self.expiryedge_ai_note(f"Scan retry after error: {reason}")
                    return
                self.state["expiryedge_ai"]["enabled"] = False
                self.state["expiryedge_ai"]["error"] = reason
                self.proposals = {key: value for key, value in self.proposals.items()
                                  if value.get("owner") != "EXPIRYEDGE_AI"}
                if self.ready:
                    self.save("EXPIRYEDGE_AI_SCAN_BLOCKED", reason=reason[:500])

    def expiryedge_ai_active(self):
        active = self.state.get("active")
        if not active or active.get("owner") != "EXPIRYEDGE_AI":
            return None
        result = copy.deepcopy(active)
        market = self.service()
        with market.lock:
            tick = market.engine.options.get(active["contract"]["token"])
            fresh = market.engine.fresh(tick, time.time())
            ltp = tick.price if tick is not None and fresh else None
        open_quantity = max(0, active.get("filled", 0) - active.get("exited", 0))
        result["ltp"] = ltp
        result["unrealized"] = (round((ltp - active["entry_price"]) * open_quantity, 2)
                                if ltp is not None and open_quantity and active.get("entry_price") else None)
        return result

    def expiryedge_ai_status(self, symbol=None):
        with self.lock:
            now = time.time()
            state = self.state["expiryedge_ai"]
            cfg = self.settings()
            today = day(now)
            trades = [trade for trade in self.state["trades"]
                      if trade.get("owner") == "EXPIRYEDGE_AI" and day(trade["entry_at"]) == today]
            entries = self.expiryedge_ai_entries(now)
            blocks = []
            try:
                self.config_guard()
            except LiveBlocked as exc:
                blocks.append(str(exc))
            schedules = get_expiryedge_config()["schedules"]
            if any(not schedules[index]["weekday"] for index in SYMBOLS):
                blocks.append("Save an expiry weekday for NIFTY, BANKNIFTY, and SENSEX")
            if self.state["killed"] or self.state.get("flatten_pending"):
                blocks.append("Emergency stop is active")
            if not getattr(cfg, "expiryedge_ai_live_enabled", False):
                blocks.append("ExpiryEdge AI live execution is disabled by EXPIRYEDGE_AI_LIVE_ENABLED")
            active = self.state.get("active")
            if active and active.get("owner") != "EXPIRYEDGE_AI":
                blocks.append(f"Shared automated trade slot is occupied by {OWNER_LABELS.get(active.get('owner'), 'another strategy')}")
            reason = (state.get("error") or state.get("waiting") or
                      ("Manual mode: signals only; no orders" if not state["enabled"] else
                       "Standing ON; waiting for a qualified expiry-day setup"))
            return {
                "enabled": bool(state["enabled"] and
                                getattr(cfg, "expiryedge_ai_live_enabled", False)),
                "live_enabled": bool(cfg.aqte_live_enabled and
                                     getattr(cfg, "expiryedge_ai_live_enabled", False)),
                "can_enable": not blocks,
                "block_reasons": blocks,
                "armed": self.state["armed_day"] == today and not self.state["killed"],
                "entry_window": entry_window(now),
                "killed": bool(self.state["killed"]),
                "reason": reason,
                "error": state.get("error"),
                "active": self.expiryedge_ai_active(),
                "trades_today": len(trades),
                "entries_today": entries,
                "daily_pnl": round(sum(trade["net_pnl"] for trade in trades), 2),
                "daily_loss_limit": EXPIRYEDGE_AI_DAILY_LOSS_CAP,
                "max_trades": EXPIRYEDGE_AI_MAX_TRADES,
                "risk_per_trade": EXPIRYEDGE_AI_RISK_CAP,
                "symbol": symbol if symbol in SYMBOLS else SYMBOLS[0],
            }

    # ---- 6 Algo Desk: six independent algos on this audited execution lane (tags XEA…E/S) ----

    def expiryedge_enabled(self):
        return any(self.state.get("expiryedge", {}).get("algos", {}).values())

    def expiryedge_off(self, reason=None):
        """Every algo OFF; an open 6 Algo Desk trade stays protected and is still exited by the monitor."""
        self.state.setdefault("expiryedge", {})["algos"] = {key: False for key in EXPIRYEDGE_ALGOS}
        if reason:
            self.expiryedge_error = reason
        self.expiryedge_waiting = None
        self.proposals = {key: value for key, value in self.proposals.items() if value.get("owner") != "EXPIRYEDGE"}

    def owner_proposal(self, owner, proposal, busy):
        if owner == "QUANTEDGE":
            return self.quantedge_proposal(proposal["symbol"], busy)
        if owner == "EXPIRYEDGE":
            return self.expiryedge_proposal(proposal["symbol"], proposal["algo"], busy)
        if owner == "EXPIRYEDGE_AI":
            return self.expiryedge_ai_proposal(proposal["symbol"], busy)
        return self.proposal(proposal["symbol"], busy)

    def expiryedge_entries(self, algo, now):
        return sum(1 for entry in self.state["daily_entries"] if entry.get("owner") == "EXPIRYEDGE" and
                   entry.get("algo") == algo and day(entry["at"]) == day(now))

    def expiryedge_account_reason(self, now):
        """Account-wide limits shared with AQTE; checked before any broker call so a full day just idles."""
        cfg = self.settings()
        trades = [trade for trade in self.state["trades"] if day(trade["entry_at"]) == day(now)]
        if len(trades) >= cfg.aqte_live_max_trades:
            return f"Account daily live trade limit reached ({cfg.aqte_live_max_trades})"
        losses = 0
        for trade in reversed(trades):
            if trade["net_pnl"] >= 0:
                break
            losses += 1
        if losses >= cfg.aqte_live_max_losses:
            return f"Consecutive live loss limit reached ({cfg.aqte_live_max_losses})"
        if sum(trade["net_pnl"] for trade in trades) <= -cfg.aqte_live_daily_loss:
            return f"Account daily live loss limit reached (INR {cfg.aqte_live_daily_loss:,.0f})"
        return None

    def expiryedge_loss_budget_reason(self, risk):
        today = day(time.time())
        pnl = sum(trade["net_pnl"] for trade in self.state["trades"] if day(trade["entry_at"]) == today)
        if risk > self.settings().aqte_live_daily_loss + pnl:
            return "Planned stop risk exceeds the remaining account daily live loss budget"
        return None

    def expiryedge_note(self, reason):
        """Waiting reasons are journaled only when they change, so a quiet retry loop stays quiet."""
        if reason == self.expiryedge_waiting:
            return
        self.expiryedge_waiting = reason
        if reason and self.ready:
            try:
                self.save("EXPIRYEDGE_WAITING", reason=reason[:500])
            except (sqlite3.Error, OSError, ValueError):
                logger.exception("Could not persist 6 Algo Desk waiting reason")

    def expiryedge_activate(self, now):
        """Standing ON shares AQTE's broker/IP preflight and session arm, retried each minute."""
        if self.state["armed_day"] == day(now) and not self.state["killed"]:
            return True
        if (self.state["killed"] or self.state.get("flatten_pending") or self.state["active"] or
                not entry_window(now) or now < self.next_activation):
            return False
        try:
            self.preflight()
            self.arm()
            self.expiryedge_note(None)
            return True
        except LiveBlocked as exc:
            reason = str(exc)
        except Exception as exc:
            logger.exception("6 Algo Desk broker preflight failed; retrying in %ss", ACTIVATION_RETRY_SECONDS)
            reason = f"Broker preflight failed ({type(exc).__name__}: {exc})"
        self.next_activation = now + ACTIVATION_RETRY_SECONDS
        self.expiryedge_note(f"Arming retry in {ACTIVATION_RETRY_SECONDS}s: {reason}")
        return False

    def set_expiryedge_algo(self, algo, enabled, symbol=None):
        with self.lock:
            if algo not in EXPIRYEDGE_ALGOS:
                raise LiveBlocked("Unknown 6 Algo Desk algo")
            if type(enabled) is not bool:
                raise LiveBlocked("6 Algo Desk approval must be an explicit boolean")
            if not self.ready:
                raise LiveBlocked("Live journal unavailable; 6 Algo Desk approval was not changed")
            if enabled:
                self.config_guard()
                if self.state["killed"] or self.state.get("flatten_pending"):
                    raise LiveBlocked("Emergency stop is latched; operator review is required before enabling 6 Algo Desk")
            self.state["expiryedge"]["algos"][algo] = enabled
            self.proposals = {key: value for key, value in self.proposals.items()
                              if not (value.get("owner") == "EXPIRYEDGE" and value.get("algo") == algo)}
            if enabled:
                self.expiryedge_error = None
                self.expiryedge_failures = 0
                self.expiryedge_hold_until = 0.0
            elif not self.expiryedge_enabled():
                self.expiryedge_waiting = None
            self.save("EXPIRYEDGE_ALGO_ON" if enabled else "EXPIRYEDGE_ALGO_OFF",
                      algo=algo, name=EXPIRYEDGE_NAMES[algo])
            now = time.time()
            if enabled and entry_window(now) and not self.state["active"]:
                self.next_activation = 0.0
                self.expiryedge_activate(now)
            self.wake()
            return self.expiryedge_status(symbol)

    def expiryedge_proposal(self, symbol, algo, busy=None):
        with self.lock:
            self.config_guard()
            name = EXPIRYEDGE_NAMES.get(algo, algo)
            if algo not in EXPIRYEDGE_ALGOS or not self.state["expiryedge"]["algos"].get(algo):
                raise LiveBlocked(f"6 Algo Desk {name} is OFF")
            now = time.time()
            if self.state["armed_day"] != day(now) or self.state["killed"]:
                raise LiveBlocked("The shared live session is not armed; broker preflight is required first")
            if self.state["active"]:
                raise EntrySkipped("The shared execution manager already has an active trade")
            if self.expiryedge_entries(algo, now) >= EXPIRYEDGE_PER_ALGO_TRADES:
                raise EntrySkipped(f"{name} daily trade limit reached ({EXPIRYEDGE_PER_ALGO_TRADES})")
            if busy is None:
                busy = self.book(self.broker())["busy"]
            signal = self.expiryedge.candidate(self.service(), symbol, algo, now, busy, self.costs,
                                               self.settings().aqte_live_risk_per_trade)
            if signal.get("decision") not in ("BUY CE", "BUY PE") or not signal.get("entry"):
                raise EntrySkipped(signal.get("reason") or f"No qualified {name} signal")
            if signal["setup_key"] in self.state["used"]:
                raise EntrySkipped(f"This {name} candle was already submitted")
            self.proposals = {key: value for key, value in self.proposals.items() if value["expires_at"] > now}
            result = {
                "id": uuid4().hex,
                "owner": "EXPIRYEDGE",
                "algo": algo,
                "symbol": symbol,
                "contract": signal["contract"],
                "strategy": f"expiryedge_{algo}",
                "entry": signal["entry"],
                "risk": signal["risk"],
                "signal_at": signal["signal_at"],
                "expires_at": now + 15,
                "setup_key": signal["setup_key"],
                "execution_context": {
                    "strategy_name": name,
                    "entry_engine": f"6 Algo Desk · {name}",
                    "reason": signal["reason"],
                    "supporting_engines": [],
                    "confidence": None,
                    "rules": [{"label": item["label"], "passed": item["passed"], "value": item.get("value")}
                              for item in signal.get("rules", [])],
                    "delta": signal.get("delta"),
                    "delta_source": signal.get("delta_source"),
                    "captured_at": now,
                },
            }
            self.proposals[result["id"]] = copy.deepcopy(result)
            return result

    def record_expiryedge_opportunity(self, candidate, state, reason):
        key = candidate["setup_key"]
        previous = self.opportunities.get(key)
        now = time.time()
        if previous and previous.get("state") == state and (
            previous.get("reason") == reason or now - previous.get("at", 0) < 30
        ):
            return
        active = self.state.get("active") or {}
        record = {
            "key": key,
            "owner": "EXPIRYEDGE",
            "algo": candidate["algo"],
            "symbol": candidate["symbol"],
            "style": "expiryedge",
            "strategy": f"expiryedge_{candidate['algo']}",
            "decision": candidate.get("decision"),
            "state": state,
            "reason": reason,
            "at": now,
            "first_at": previous["first_at"] if previous else now,
            "signal_at": candidate.get("signal_at"),
            "score": None,
            "reward_risk": (candidate.get("entry") or {}).get("reward_risk"),
            "expected_value": None,
            "expected_value_reason": "No validated/calibrated probability model",
            "broker_order_id": active.get("entry_id") if active.get("setup_key") == key else None,
        }
        self.save("OPPORTUNITY", record=record)
        self.opportunities[key] = record
        self.metrics.increment(f"expiryedge.opportunities.{state.lower()}")

    def automated_expiryedge_entry(self):
        with self.lock:
            now = time.time()
            if (not self.ready or not self.expiryedge_enabled() or now < self.expiryedge_hold_until or
                    now - self.expiryedge_scanned_at < EXPIRYEDGE_SCAN_SECONDS):
                return
            self.expiryedge_scanned_at = now
            self.expiryedge_skip_until = {key: until for key, until in self.expiryedge_skip_until.items() if until > now}
            if self.state["killed"] or self.state.get("flatten_pending") or self.state["active"] or not entry_window(now):
                return
            if not self.expiryedge_activate(now):
                return
            reason = self.expiryedge_account_reason(now)
            if reason:
                self.expiryedge_note(reason)
                return
            self.expiryedge_note(None)
            market = self.service()
            enabled = [key for key in EXPIRYEDGE_ALGOS if self.state["expiryedge"]["algos"].get(key)]
            qualified, present = [], set()
            for symbol in SYMBOLS:
                evaluation = self.expiryedge.evaluate(market, symbol, now)
                for algo in enabled:
                    result = evaluation["algos"][algo]
                    if result["decision"] not in ("BUY CE", "BUY PE"):
                        continue
                    key = expiryedge_setup_key(algo, symbol, result)
                    present.add(key)
                    candidate = {**result, "algo": algo, "symbol": symbol, "setup_key": key,
                                 "signal_at": result["trigger_at"] + result["trigger_seconds"]}
                    if key in self.state["used"] or now < self.expiryedge_skip_until.get(key, 0):
                        continue
                    if self.expiryedge_entries(algo, now) >= EXPIRYEDGE_PER_ALGO_TRADES:
                        self.record_expiryedge_opportunity(
                            candidate, "MISSED",
                            f"{EXPIRYEDGE_NAMES[algo]} daily trade limit reached ({EXPIRYEDGE_PER_ALGO_TRADES})")
                        continue
                    qualified.append(((candidate["signal_at"], result["passed"]), symbol, algo, candidate))
            for key, previous in list(self.opportunities.items()):
                if previous.get("owner") == "EXPIRYEDGE" and key not in present and previous.get("state") in (
                    "REJECTED", "MISSED"
                ):
                    record = {**previous, "state": "EXPIRED", "at": now,
                              "reason": f"Signal is no longer fresh; last decision: {previous['reason']}"}
                    self.save("OPPORTUNITY", record=record)
                    self.opportunities[key] = record
            if not qualified:
                return
            # One broker read per qualified scan; confirm() re-reads Kite before any order.
            busy = self.book(self.broker())["busy"]
            for _, symbol, algo, candidate in sorted(qualified, key=lambda item: item[0], reverse=True):
                key = candidate["setup_key"]
                try:
                    proposal = self.expiryedge_proposal(symbol, algo, busy)
                    if proposal["setup_key"] != key:
                        self.proposals.pop(proposal["id"], None)
                        raise EntrySkipped("Signal changed during live option checks")
                    self.confirm(proposal["id"])
                except EntrySkipped as exc:
                    self.expiryedge_skip_until[key] = time.time() + ENTRY_RETRY_SECONDS
                    self.record_expiryedge_opportunity(candidate, "REJECTED", str(exc))
                    continue
                except LiveBlocked as exc:
                    self.record_expiryedge_opportunity(candidate, "REJECTED", str(exc))
                    raise
                self.record_expiryedge_opportunity(
                    candidate, "ACCEPTED", "Entry intent persisted; broker fills are reconciled separately")
                return

    def scan_expiryedge(self):
        try:
            self.automated_expiryedge_entry()
            self.expiryedge_failures = 0
        except LiveBlocked as exc:
            # Guard refusals (IP, account, untracked exposure) hold entries and retry; they never place orders.
            with self.lock:
                self.expiryedge_hold_until = time.time() + ACTIVATION_RETRY_SECONDS
                self.expiryedge_note(f"Entries paused {ACTIVATION_RETRY_SECONDS}s: {exc}")
        except Exception as exc:
            reason = f"{type(exc).__name__}: {exc}"
            logger.exception("6 Algo Desk entry scan failed")
            with self.lock:
                self.expiryedge_failures += 1
                if self.expiryedge_failures < EXPIRYEDGE_MAX_FAILURES:
                    self.expiryedge_hold_until = time.time() + ENTRY_RETRY_SECONDS
                    self.expiryedge_note(f"Scan retry after error: {reason}")
                    return
                self.expiryedge_off(reason)
                if self.ready:
                    try:
                        self.save("EXPIRYEDGE_SCAN_BLOCKED", reason=reason[:500])
                    except (sqlite3.Error, OSError, ValueError):
                        logger.exception("Could not persist 6 Algo Desk scan block")

    def expiryedge_reason(self, now):
        """Single operator-facing line explaining why entries are or are not being placed right now."""
        active = self.state.get("active")
        if not self.ready:
            return "Live journal unavailable; entries blocked"
        if self.state["killed"] or self.state.get("flatten_pending"):
            return "Emergency stop latched; every 6 Algo Desk algo is OFF"
        if self.expiryedge_error and not self.expiryedge_enabled():
            return f"Switched OFF after repeated scan errors: {self.expiryedge_error}"
        if active:
            owner = OWNER_LABELS.get(active.get("owner"), "AQTE")
            return f"Shared live trade slot is managing {owner}; enabled strategies wait for it to clear"
        if not self.expiryedge_enabled():
            return "Every algo is in Manual (TRADE OFF): live signals only, no orders"
        if not entry_window(now):
            return "Entries run 09:15-15:15 IST on trading days; standing ON re-arms automatically"
        if active:
            return "Managing the open 6 Algo Desk trade; one live trade at a time"
        return self.expiryedge_waiting or self.expiryedge_account_reason(now)

    def expiryedge_active(self):
        active = self.state.get("active")
        if not active or active.get("owner") != "EXPIRYEDGE":
            return None
        result = copy.deepcopy(active)
        market = self.service()
        try:
            with market.lock:
                tick = market.engine.options.get(active["contract"]["token"])
                fresh = market.engine.fresh(tick, time.time())
                ltp = tick.price if tick is not None and fresh else None
        except (AttributeError, KeyError, TypeError):
            ltp = None
        open_quantity = max(0, active.get("filled", 0) - active.get("exited", 0))
        result["ltp"] = ltp
        result["unrealized"] = (round((ltp - active["entry_price"]) * open_quantity, 2)
                                if ltp is not None and open_quantity and active.get("entry_price") else None)
        result["name"] = EXPIRYEDGE_NAMES.get(active.get("algo"), active.get("algo"))
        return result

    def expiryedge_status(self, symbol=None):
        with self.lock:
            now = time.time()
            symbol = symbol if symbol in SYMBOLS else SYMBOLS[0]
            cfg = self.settings()
            switches = self.state["expiryedge"]["algos"]
            market = self.service()
            evaluations = {}
            for name in SYMBOLS:
                try:
                    evaluations[name] = self.expiryedge.evaluate(market, name, now)
                except (ArithmeticError, AttributeError, KeyError, TypeError, ValueError) as exc:
                    reason = f"Signals unavailable ({type(exc).__name__})"
                    evaluations[name] = dict(symbol=name, ready=False, reason=reason, context={},
                                             algos={key: expiryedge_idle(key, reason) for key in EXPIRYEDGE_ALGOS})
            history = [trade for trade in self.state["trades"] if trade.get("owner") == "EXPIRYEDGE"]
            today = day(now)
            week = datetime.fromtimestamp(now, IST).isocalendar()[:2]
            algos = []
            for key, name, subtitle in EXPIRYEDGE_CATALOG:
                mine = [trade for trade in history if trade.get("algo") == key]
                entries = self.expiryedge_entries(key, now)
                algos.append(dict(
                    key=key, name=name, subtitle=subtitle, enabled=switches.get(key, False),
                    entries_today=entries, remaining_today=max(0, EXPIRYEDGE_PER_ALGO_TRADES - entries),
                    today=performance([trade for trade in mine if day(trade["entry_at"]) == today]),
                    week=performance([trade for trade in mine if datetime.fromtimestamp(
                        trade["entry_at"], IST).isocalendar()[:2] == week]),
                    summary={index: {field: evaluations[index]["algos"][key].get(field)
                                     for field in ("status", "decision", "side", "passed", "total", "fresh")}
                             for index in SYMBOLS},
                ))
            account_trades = [trade for trade in self.state["trades"] if day(trade["entry_at"]) == today]
            trades = sorted(history, key=lambda trade: trade.get("exit_at") or trade["entry_at"], reverse=True)[:25]
            fields = ("id", "algo", "symbol", "entry_price", "exit_price", "filled", "net_pnl", "entry_at",
                      "exit_at", "exit_reason", "exit_requested", "stop", "target", "initial_stop")
            trade_rows = []
            for trade in trades:
                context = trade.get("execution_context")
                entry_context = None
                if isinstance(context, dict):
                    rules = context.get("rules")
                    entry_context = {
                        "strategy_name": context.get("strategy_name"),
                        "reason": context.get("reason"),
                        "rules": [
                            {key: item.get(key) for key in ("label", "passed", "value")}
                            for item in rules if isinstance(item, dict)
                        ] if isinstance(rules, list) else [],
                    }
                trade_rows.append({
                    **{key: trade.get(key) for key in fields},
                    "trading_symbol": (trade.get("contract") or {}).get("trading_symbol"),
                    "side": (trade.get("contract") or {}).get("side"),
                    "entry_context": entry_context,
                })
            selected = evaluations[symbol]
            return {
                "generated_at": now,
                "ready": self.ready,
                "live_enabled": bool(cfg.aqte_live_enabled),
                "armed": self.state["armed_day"] == today and not self.state["killed"],
                "entry_window": entry_window(now),
                "killed": bool(self.state["killed"]),
                "flatten_pending": bool(self.state.get("flatten_pending")),
                "any_enabled": self.expiryedge_enabled(),
                "lane_owner": self.state["active"].get("owner") if self.state.get("active") else None,
                "reason": self.expiryedge_reason(now),
                "error": self.expiryedge_error,
                "symbol": symbol,
                "market": {name: {"ready": evaluations[name]["ready"], "reason": evaluations[name]["reason"],
                                  "context": evaluations[name]["context"]} for name in SYMBOLS},
                "signals": selected["algos"],
                "signals_by_symbol": {name: evaluations[name]["algos"] for name in SYMBOLS},
                "algos": algos,
                "active": self.expiryedge_active(),
                "trades": trade_rows,
                "opportunities": sorted((record for record in self.opportunities.values()
                                         if record.get("owner") == "EXPIRYEDGE"),
                                        key=lambda record: record["at"], reverse=True)[:25],
                "account": {
                    "trades_today": len(account_trades),
                    "net_pnl_today": round(sum(trade["net_pnl"] for trade in account_trades), 2),
                    "expiryedge_pnl_today": round(sum(trade["net_pnl"] for trade in history
                                                      if day(trade["entry_at"]) == today), 2),
                },
                "limits": {
                    "per_algo_max_trades": EXPIRYEDGE_PER_ALGO_TRADES,
                    "max_trades": cfg.aqte_live_max_trades,
                    "max_losses": cfg.aqte_live_max_losses,
                    "daily_loss": cfg.aqte_live_daily_loss,
                    "risk_per_trade": cfg.aqte_live_risk_per_trade,
                    "max_lots": 1,
                    "trail_start_r": EXPIRYEDGE_TRAIL_START_R,
                    "target_r": EXPIRYEDGE_TARGET_R,
                    "entry_window": "09:15-15:15 IST",
                },
            }

    def request_expiryedge_exit(self, trade_id, symbol=None):
        with self.lock:
            active = self.state.get("active")
            if not active or active.get("owner") != "EXPIRYEDGE" or active["id"] != trade_id:
                raise LiveBlocked("The selected 6 Algo Desk trade is no longer active")
            self.request_exit(trade_id)
            return self.expiryedge_status(symbol or active["symbol"])

    def request_expiryedge_ai_exit(self, trade_id, symbol=None):
        with self.lock:
            active = self.state.get("active")
            if not active or active.get("owner") != "EXPIRYEDGE_AI" or active["id"] != trade_id:
                raise LiveBlocked("The selected ExpiryEdge AI trade is no longer active")
            self.request_exit(trade_id)
            return self.expiryedge_ai_status(symbol or active["symbol"])

    def entry_levels(self, symbol, signal):
        contract = Contract(**signal["contract"])
        control = self.state["daily_controls"][symbol]
        entry = copy.deepcopy(signal["entry"])
        cap = self.settings().aqte_live_risk_per_trade
        if signal.get("source") == "expiryedge_ai":
            cap = EXPIRYEDGE_AI_RISK_CAP
            entry["stop"] = round_tick(
                entry["maximum"] * (1 - EXPIRYEDGE_AI_STOP_FRACTION),
                contract.tick_size,
                up=True,
            )
            entry["target"] = None
        elif signal.get("source") == "morning":
            distance = entry.get("risk_distance")
            if not isinstance(distance, (int, float)) or not math.isfinite(distance) or distance <= 0:
                raise EntrySkipped("Morning ATR/premium-based risk distance is unavailable")
            entry["stop"] = round_tick(entry["maximum"] - distance, contract.tick_size)
            entry["target"] = round_tick(entry["maximum"] + distance * 3, contract.tick_size, up=True)
        elif str(signal.get("strategy")).startswith("quick_scalp"):
            entry = self.scalp_levels(contract, entry, cap)
        else:
            distance = entry["maximum"] * control["stop_percent"] / 100
            entry["stop"] = round_tick(max(contract.tick_size, entry["maximum"] - distance), contract.tick_size)
            entry["target"] = round_tick(entry["maximum"] + (entry["maximum"] - entry["stop"]) * control["target_rr"],
                                         contract.tick_size, up=True)
        if entry["quantity"] != contract.lot_size:
            raise LiveBlocked("Live pilot permits exactly one lot")
        valid_levels = (0 < entry["stop"] < entry["maximum"] if signal.get("source") == "expiryedge_ai"
                        else 0 < entry["stop"] < entry["maximum"] < entry["target"])
        if not valid_levels:
            # Signal-specific (e.g. a one-tick premium): skip this index without fault-stopping automation.
            raise EntrySkipped("Premium too small for valid live entry, stop and target levels")
        risk = (entry["maximum"] - entry["stop"]) * contract.lot_size + self.costs(
            entry["maximum"], contract.lot_size) + self.costs(entry["stop"], contract.lot_size)
        if signal.get("source") == "expiryedge_ai":
            if risk > cap:
                raise EntrySkipped("One Zerodha lot exceeds the INR 3,000 ExpiryEdge AI per-trade risk limit")
            reason = self.expiryedge_ai_loss_budget_reason(risk)
            if reason:
                raise EntrySkipped(reason)
            return entry, risk
        reward = (entry["target"] - entry["maximum"]) * contract.lot_size - self.costs(
            entry["maximum"], contract.lot_size) - self.costs(entry["target"], contract.lot_size)
        if reward / risk < 1.5:
            raise EntrySkipped("Configured reward/risk after estimated costs is below 1.5")
        entry["reward_risk"] = round(reward / risk, 2)
        if risk > cap:
            raise EntrySkipped("One lot exceeds live per-trade risk limit")
        reason = self.loss_budget_reason(symbol, risk)
        if reason:
            raise EntrySkipped(reason)
        return entry, risk

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
            owner = proposal.get("owner", "AQTE")
            with self.metrics.measure("execution.risk_guard"):
                book = self.entry_guard(broker, owner)
            if proposal["setup_key"] in self.state["used"]:
                raise LiveBlocked("This strategy candle was already submitted")
            # Re-evaluate the backend setup; never trust browser prices or quantity.
            current = self.owner_proposal(owner, proposal, book["busy"])
            self.proposals.pop(current["id"], None)
            # Same contract and strategy candle, and the price cap may only fall: never chase a higher ask.
            if current["contract"] != proposal["contract"] or current["setup_key"] != proposal["setup_key"] or (
                current["entry"]["maximum"] > proposal["entry"]["maximum"]
            ):
                raise EntrySkipped("Signal or entry levels changed; review a new proposal")
            if current["risk"] > proposal["risk"]:
                raise EntrySkipped("Rechecked risk exceeds the approved risk; review a new proposal")
            # Use the rechecked tier/stop/target, not an obsolete higher-risk plan.
            proposal = {**current, "expires_at": proposal["expires_at"]}
            reason = (self.quantedge_loss_budget_reason(proposal["risk"]) if owner == "QUANTEDGE"
                      else self.expiryedge_loss_budget_reason(proposal["risk"]) if owner == "EXPIRYEDGE"
                      else self.expiryedge_ai_loss_budget_reason(proposal["risk"]) if owner == "EXPIRYEDGE_AI"
                      else self.loss_budget_reason(proposal["symbol"], proposal["risk"]))
            if reason:
                raise EntrySkipped(reason)
            control = ({"trail_start_r": 1.0, "daily_loss": 1500} if owner == "QUANTEDGE"
                       else {"trail_start_r": EXPIRYEDGE_TRAIL_START_R, "daily_loss": self.settings().aqte_live_daily_loss}
                       if owner == "EXPIRYEDGE"                        else {
                           "trail_start_r": 1.0, "trail_gap_r": EXPIRYEDGE_AI_TRAIL_GAP_R,
                           "breakeven_on_start": True, "daily_loss": EXPIRYEDGE_AI_DAILY_LOSS_CAP,
                       } if owner == "EXPIRYEDGE_AI" else self.state["daily_controls"][proposal["symbol"]])
            c, entry = proposal["contract"], proposal["entry"]
            verified = Contract(**c)
            if verified.symbol != proposal["symbol"] or verified.exchange != (
                "BFO" if verified.symbol == "SENSEX" else "NFO"
            ) or datetime.fromisoformat(verified.expiry).date() < datetime.fromtimestamp(time.time(), IST).date():
                raise LiveBlocked("Contract exchange, underlying or expiry does not match the approved option")
            key = f'{c["exchange"]}:{c["trading_symbol"]}'
            with self.metrics.measure("broker.quote"):
                raw = broker.quote([key])[key]
            from services.aqte_service import normalize
            quote = normalize(proposal["symbol"], "option", {
                **raw, "exchange_timestamp": raw.get("timestamp"), "volume_traded": raw.get("volume"),
            }, time.time())
            now = time.time()
            if quote.token != c["token"]:
                raise LiveBlocked("Broker quote token does not match the approved option contract")
            if not 0 <= now - quote.at <= 5 or not 0 < quote.bid <= quote.ask or (
                quote.ask_quantity < entry["quantity"] or quote.ask > entry["maximum"] or
                quote.ask <= entry["stop"] or (quote.ask - quote.bid) / quote.ask > 0.03
            ):
                raise EntrySkipped("Fresh broker ask/depth does not fit the approved no-chase limit")
            with self.metrics.measure("broker.margins"):
                available = float(broker.margins("equity")["available"]["cash"])
            if not math.isfinite(available) or available < entry["maximum"] * entry["quantity"] + self.costs(
                entry["maximum"], entry["quantity"]
            ):
                # Owner trades can tie up margin for a while; retry instead of disarming automation.
                raise EntrySkipped("Insufficient broker cash for the approved quantity; retrying")
            if time.time() >= proposal["expires_at"]:
                raise EntrySkipped("Approval expired during broker checks; review again")
            market = self.service()
            with market.lock, market.health_lock:
                if market.engine.contracts.get(c["token"]) != verified:
                    raise EntrySkipped("Contract metadata changed during broker checks; review a fresh proposal")
                if not market.started or market.failed.is_set() or market.engine.killed or (
                    market.feed_connected is False or
                    any(gap["symbol"] == proposal["symbol"] for gap in market.gaps.values()) or
                    (market.evaluators is not None and (
                        market.configured_days.get(c["exchange"]) != day(time.time()) or market.subscription_error)) or
                    not market.engine.fresh(market.engine.options.get(c["token"]), time.time()) or
                    not market.engine.fresh(market.engine.spot.get(proposal["symbol"]), time.time()) or
                    not market.engine.fresh(market.engine.future.get(proposal["symbol"]), time.time())
                ):
                    raise EntrySkipped("Streaming quote became stale during broker checks")
                latest = self.owner_proposal(owner, proposal, book["busy"])
                self.proposals.pop(latest["id"], None)
                if latest["contract"] != c or latest["setup_key"] != proposal["setup_key"] or (
                    latest["risk"] > proposal["risk"] or latest["entry"]["maximum"] > entry["maximum"] or
                    quote.ask > latest["entry"]["maximum"] or quote.ask <= latest["entry"]["stop"]
                ):
                    raise EntrySkipped("Latest signal/risk no longer fits the approved broker quote")
                if time.time() >= proposal["expires_at"]:
                    raise EntrySkipped("Approval expired during final signal checks")
                proposal = {**latest, "expires_at": proposal["expires_at"]}
                entry, now = proposal["entry"], time.time()
            # Persist the unique intent BEFORE sending. A timeout is not a rejection.
            active = {
                "id": ("QEP" + uuid4().hex[:13]) if owner == "QUANTEDGE" else (
                    "XEA" + uuid4().hex[:13]) if owner == "EXPIRYEDGE" else (
                    "EAI" + uuid4().hex[:13]) if owner == "EXPIRYEDGE_AI" else uuid4().hex[:16],
                "owner": owner, "symbol": proposal["symbol"], "contract": c,
                "strategy": proposal.get("strategy"),
                "execution_context": copy.deepcopy(proposal["execution_context"]),
                "quantity": entry["quantity"], "limit": entry["maximum"], "stop": entry["stop"],
                "initial_stop": entry["stop"], "target": entry["target"], "peak": 0,
                "trailing_active": False,
                "trail_start_r": control["trail_start_r"], "daily_loss_limit": control["daily_loss"],
                "trail_gap_r": control.get("trail_gap_r", 1.0),
                "breakeven_on_start": control.get("breakeven_on_start", False),
                "state": "ENTRY_UNKNOWN", "entry_id": None, "protect_id": None,
                "filled": 0, "entry_price": 0, "entry_at": now, "account": self.state["account"],
                "signal_at": proposal["signal_at"],
                "setup_key": proposal["setup_key"],
                "entry_day": day(now), "exit_requested": None, "error": None,
            }
            if owner == "EXPIRYEDGE":
                active["algo"] = proposal["algo"]
            self.state["active"] = active
            self.state["daily_entries"].append(dict(id=active["id"], owner=owner, symbol=active["symbol"], at=now,
                                                   filled=False, pending=True, token=c["token"], price=entry["maximum"]))
            if owner == "EXPIRYEDGE":
                self.state["daily_entries"][-1]["algo"] = proposal["algo"]
            self.state["used"].append(proposal["setup_key"])
            self.save("ENTRY_INTENT", proposal=proposal, tag=active["id"] + "E")
            self.metrics.observe("execution.signal_to_intent", max(0, now - proposal["signal_at"]) * 1000)
            self.metrics.increment("orders_submitted")
            try:
                with self.metrics.measure("broker.entry_submission"):
                    order_id = broker.place_order(
                        variety="regular", exchange=c["exchange"], tradingsymbol=c["trading_symbol"],
                        transaction_type="BUY", quantity=entry["quantity"], product="MIS",
                        order_type="LIMIT", price=entry["maximum"], validity="IOC", tag=active["id"] + "E")
                if not order_id:
                    raise ValueError("Broker did not return an order ID")
                active.update(entry_id=str(order_id), entry_ack_at=time.time(), state="ENTRY_PENDING")
                self.save("ENTRY_ACK", order_id=str(order_id))
                self.metrics.increment("orders_acknowledged")
            except Exception:
                logger.exception("AQTE live entry outcome uncertain; automatic resubmission prohibited")
                active["error"] = "Entry outcome uncertain; reconcile broker order book. Do not retry."
                self.state["armed_day"] = None
                self.save("ENTRY_UNCERTAIN")
                self.metrics.increment("orders_unknown")
            return self.status()

    def request_exit(self, trade_id):
        with self.lock:
            if not self.ready:
                raise LiveBlocked("Live journal is unavailable; manage the position in Kite")
            active = self.state["active"]
            owner = (active or {}).get("owner", "AQTE")
            label = OWNER_LABELS.get(owner, "AQTE")
            if self.state["killed"] or self.state.get("flatten_pending"):
                raise LiveBlocked(f"{label} emergency stop is active; monitor the algorithm square-off in Kite")
            if not active or active["id"] != trade_id:
                raise LiveBlocked("The selected algorithm trade is no longer active; refresh before acting")
            if active["entry_day"] != day(time.time()):
                raise LiveBlocked("Previous-session trade requires reconciliation in Kite")
            if active["filled"] <= active.get("exited", 0):
                raise LiveBlocked("No confirmed remaining fill to close; inspect the pending order in Kite")
            if owner == "QUANTEDGE":
                self.state["quantedge"]["enabled"] = False
                self.proposals = {key: value for key, value in self.proposals.items()
                                  if value.get("owner") != "QUANTEDGE"}
            elif owner == "EXPIRYEDGE":
                algos = self.state["expiryedge"]["algos"]
                if active.get("algo") in algos:
                    algos[active["algo"]] = False
                self.proposals = {key: value for key, value in self.proposals.items()
                                  if value.get("owner") != "EXPIRYEDGE"}
            elif owner == "EXPIRYEDGE_AI":
                self.state["expiryedge_ai"]["enabled"] = False
                self.proposals = {key: value for key, value in self.proposals.items()
                                  if value.get("owner") != "EXPIRYEDGE_AI"}
            else:
                self.state["automation_on"] = False
                self.state["automation_wanted"] = False
                self.waiting = None
                self.proposals = {key: value for key, value in self.proposals.items()
                                  if value.get("owner", "AQTE") != "AQTE"}
            if not active["exit_requested"]:
                active.update(exit_requested="MANUAL_EXIT", exit_request_at=time.time())
            # The monitor reconciles identity/quantity, then modifies only this trade's existing sell order.
            self.save("MANUAL_EXIT_REQUESTED", trade_id=trade_id, scope=f"SELECTED_{owner}_TRADE",
                      **({"algo": active["algo"]} if active.get("algo") else {}))
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
        if method == "modify_order":
            # Count attempts: a timed-out modify may still have been applied by Kite.
            active["modifications"] = active.get("modifications", 0) + 1
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
            active["broker_status"] = ("PARTIALLY_FILLED" if 0 < filled < active["quantity"]
                                       and entry["status"] not in TERMINAL else entry["status"])
            active["broker_filled_quantity"] = filled
            active["status_message"] = entry.get("status_message")
            previous = self.opportunities.get(active.get("setup_key"))
            if previous and (previous.get("broker_status"), previous.get("broker_filled_quantity")) != (
                active["broker_status"], filled
            ):
                record = {**previous, "state": "ACCEPTED", "at": time.time(),
                          "reason": "Broker submission reconciled; fills and protection remain authoritative",
                          "broker_order_id": active["entry_id"], "broker_status": active["broker_status"],
                          "broker_filled_quantity": filled}
                self.save("OPPORTUNITY", record=record)
                self.opportunities[record["key"]] = record
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
                self.metrics.observe("execution.intent_to_confirmed_fill", max(0, active["fill_at"] - active["entry_at"]) * 1000)
                self.metrics.increment("orders_filled")
            positions = broker.positions()["net"]
            matches = [p for p in positions if int(p["instrument_token"]) == active["contract"]["token"] and p["product"] == "MIS"]
            quantity = sum(int(p["quantity"]) for p in matches)
            protection = self.find_order(orders, active, "S")
            active["protection_confirmed"] = bool(
                protection and protection["status"] == "TRIGGER PENDING" and protection["order_type"] == "SL")
            exited = int(protection["filled_quantity"]) if protection else 0
            # Owner trades in the same contract may add quantity; less than AQTE's remainder means its lots were sold.
            if quantity < filled - exited:
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
                            if t["symbol"] == active["symbol"] and day(t["entry_at"]) == day(now) and (
                                active.get("owner") not in ("QUANTEDGE", "EXPIRYEDGE_AI") or
                                t.get("owner") == active.get("owner")
                            ))
            open_pnl = marked_pnl - daily_pnl
            if marked_pnl <= -self.settings().aqte_live_daily_loss or (
                index_pnl + open_pnl <= -active.get("daily_loss_limit", self.settings().aqte_live_daily_loss)
            ):
                reason = reason or "DAILY_LOSS"
            if active.get("target") is not None and quote.bid >= active["target"]:
                reason = reason or "TARGET"
            if active["entry_price"] <= active["initial_stop"]:
                reason = reason or "FILL_BELOW_STOP"
            if quote.bid <= active["stop"]:
                reason = reason or "STOP_CROSSED"
            if str(active.get("strategy", "")).startswith("morning_"):
                morning = self.morning_service()
                if morning is not None:
                    reason = reason or morning.exit_reason(active, now)
            # Modify the SAME sell order, never create a competing target/exit order.
            c = active["contract"]
            if reason or protection["status"] == "OPEN":
                price = round_tick(max(c["tick_size"], quote.bid - c["tick_size"] * 2), c["tick_size"])
                expected = {"order_type": "LIMIT", "price": price, "trigger_price": 0}
                # A resting SELL limit at or below the new price is still marketable; re-modifying burns Kite's budget.
                if protection["order_type"] == "LIMIT" and float(protection["price"]) <= price + 1e-6:
                    return
                if active.get("modifications", 0) >= KITE_MAX_MODIFICATIONS:
                    raise LiveBlocked("Kite 25-modification limit reached on the exit order; exit manually in Kite")
                active.update(exit_requested=reason or "STOP_TRIGGERED", modify=expected)
                active.setdefault("exit_request_at", now)
                self.mutation("EXIT_REPRICE", broker, active, "modify_order", variety="regular",
                              order_id=active["protect_id"], **expected)
                self.save("EXIT_REPRICE_ACK")
            else:
                active["peak"] = max(active["peak"], quote.bid)
                distance = active["entry_price"] - active["initial_stop"]
                remaining = KITE_MAX_MODIFICATIONS - EXIT_MODIFY_RESERVE - active.get("modifications", 0)
                trail_gap = distance * active.get("trail_gap_r", 1.0)
                trail_start = distance * active.get("trail_start_r", 1.0)
                if distance > 0 and remaining > 0 and active["peak"] >= active["entry_price"] + trail_start:
                    if active.get("breakeven_on_start"):
                        trail_gap_threshold = active["entry_price"] + trail_start + trail_gap
                        stop_candidate = (active["entry_price"] if active["peak"] < trail_gap_threshold
                                          else active["peak"] - trail_gap)
                    else:
                        stop_candidate = active["peak"] - trail_gap
                    stop = round_tick(stop_candidate, c["tick_size"], up=True)
                    step = (max(c["tick_size"], (active["target"] - distance - active["stop"]) / remaining)
                            if active.get("target") is not None else
                            max(c["tick_size"], trail_gap / 2))
                    if stop > active["stop"] + c["tick_size"] / 2 and stop - active["stop"] >= step - 1e-6:
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
            self.state["quantedge"]["enabled"] = False
            self.state["expiryedge_ai"]["enabled"] = False
            self.expiryedge_off()
            self.waiting = None
            self.proposals.clear()
            self.kill_sent.clear()
            if self.state["active"]:
                self.state["active"]["exit_requested"] = "EMERGENCY_STOP"
            self.audit("EMERGENCY_STOP", scope="TAGGED_ALGORITHM_POSITIONS_AND_ORDERS")
            try:
                self.emergency_flatten()
            except Exception as exc:
                self.error = f"Emergency square-off retrying: {type(exc).__name__}: {exc}"
                logger.exception("Tagged algorithm emergency square-off attempt failed; monitor will retry")
            return self.status()

    def emergency_flatten(self):
        """Cancel tagged algorithm orders and close only algorithm-owned quantity until flat.

        The owner's manual or other-app positions and orders are never cancelled, modified or exited.
        """
        with self.lock:
            if not self.state.get("flatten_pending"):
                return
            broker = self.broker()
            book = self.book(broker)
            orders = [o for o in book["orders"] if algo_order(o)]
            positions, working = book["owned"], book["working"]
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
        execution = None
        if active:
            entry = next((o for o in orders if o.get("tag") == active["id"] + "E"), None)
            if entry and entry.get("order_id") is not None:
                active["entry_id"] = str(entry["order_id"])
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
                execution = self.state["trades"][-1]
            else:
                execution = {**active, "state": "UNVERIFIED",
                             "broker_status": entry["status"] if entry else None,
                             "status_message": entry.get("status_message") if entry else "Broker outcome not recorded"}
            self.state["active"] = None
        self.state["flatten_pending"] = False
        self.kill_sent.clear()
        self.error = None
        self.audit("EMERGENCY_FLAT", note="Kite reports no open AQTE positions or AQTE orders; owner trades untouched",
                   execution=execution)

    def reset_emergency(self):
        with self.lock:
            if not self.ready:
                raise LiveBlocked("Live journal is unavailable")
            if not self.state["killed"]:
                raise LiveBlocked("Emergency stop is not latched")
            if self.state.get("flatten_pending") or self.state["active"]:
                raise LiveBlocked("Emergency square-off still in progress; wait until Kite shows no open AQTE positions or AQTE orders")
            self.state.update(killed=False, armed_day=None, automation_on=False, automation_wanted=False)
            self.state["quantedge"]["enabled"] = False
            self.expiryedge_off()
            self.expiryedge_error = None
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
            self.state["quantedge"]["enabled"] = False
            self.state["expiryedge_ai"]["enabled"] = False
            # A standing ON request re-arms through a fresh preflight after the retry delay.
            self.next_activation = time.time() + ACTIVATION_RETRY_SECONDS
            if self.ready and changed:
                try:
                    self.save("AUTOMATION_FAULT_STOPPED", error=message[:500])
                except (sqlite3.Error, OSError, ValueError):
                    logger.exception("Could not persist automation fault stop")

    def wake(self):
        loop = self.loop
        if loop is not None and not loop.is_closed():
            loop.call_soon_threadsafe(self.wake_event.set)

    def broker_update(self, update):
        active = self.state.get("active") or {}
        order_id = str(update.get("order_id") or "")
        if not algo_order(update) and order_id not in (active.get("entry_id"), active.get("protect_id")):
            return
        if not order_id:
            logger.warning("AQTE ignored broker order update without an order ID")
            self.metrics.increment("broker_updates_invalid")
            return
        status = str(update.get("status") or "UNKNOWN").strip().upper()
        active_contract = active.get("contract") or {}
        from services.engine_events import get_engine_event_service
        get_engine_event_service().publish_threadsafe(
            "ZERODHA_ORDER_STATUS",
            f"AQTE Zerodha order status: {status.replace('_', ' ').lower()}",
            instrument=update.get("tradingsymbol") or active_contract.get("trading_symbol") or active.get("symbol"),
            severity="success" if status == "COMPLETE" else "warning" if status in ("CANCELLED", "REJECTED") else "info",
            source="aqte_live",
            idempotency_key=(
                f"aqte-order:{order_id}:{status}:{update.get('filled_quantity')}:"
                f"{update.get('pending_quantity')}:{update.get('average_price')}"
            ),
        )
        record = {key: update.get(key) for key in ("status", "filled_quantity", "pending_quantity", "average_price")}
        record.update(order_id=order_id, received_at=time.time())
        with self.update_lock:
            self.broker_updates.append(record)
        self.metrics.increment("broker_order_updates")
        self.order_dirty.set()
        self.wake()

    def prepare_session(self):
        now = time.time()
        dt = datetime.fromtimestamp(now, IST)
        from config.nse_holidays import is_holiday
        if not self.ready or self.state["active"] or self.state["killed"] or not self.settings().aqte_live_enabled or (
            self.prepared_day == day(now) or now < self.prepare_after or dt.weekday() >= 5 or
            is_holiday(day(now)) or not 8 * 60 + 45 <= dt.hour * 60 + dt.minute < 9 * 60 + 15
        ):
            return
        self.prepare_after = now + 300
        try:
            with self.metrics.measure("preparation.broker_preflight"):
                self.preflight()
            self.prepared_day, self.prepare_error = day(now), None
        except LiveBlocked as exc:
            self.prepare_error = str(exc)
            logger.warning("AQTE pre-market broker preparation blocked: %s", exc)
            self.save("PREPARATION_BLOCKED", reason=str(exc))

    def record_opportunities(self, snapshot, failure=None):
        now = time.time()
        present = set()
        blocks = (self.entry_scan or {}).get("blocks", {})
        for symbol, original in snapshot["data"].items():
            candidates = [("swing", self.enabled_setup(self.state["daily_controls"][symbol], original))]
            scalp = original.get("scalp")
            if scalp:
                candidates.append(("scalp", {**original, **scalp}))
            if isinstance(original.get("morning"), dict):
                candidates.append(("morning", {**original["morning"], "engines": original.get("engines") or [],
                                               "orchestration": original.get("orchestration")}))
            for style, signal in candidates:
                if signal.get("decision") not in ("BUY CE", "BUY PE") or not signal.get("entry"):
                    continue
                key = self.setup_key(symbol, signal)
                present.add(key)
                active = self.state.get("active") or {}
                if key in self.state["used"]:
                    state = "SUBMISSION_UNKNOWN" if active.get("setup_key") == key and (
                        active.get("state") == "ENTRY_UNKNOWN") else "ACCEPTED"
                    reason = "Persisted submission intent; broker fills are reconciled separately"
                else:
                    control = self.state["daily_controls"][symbol]
                    reason = failure or self.waiting or self.error
                    if not reason and not self.state.get("automation_on"):
                        reason = "Owner automation OFF or session not armed"
                    if not reason and self.state.get("active"):
                        reason = "One AQTE order/position already active"
                    if not reason and style != "morning" and control["style"] not in (style, "both"):
                        reason = f"{style} style is not enabled"
                    if not reason:
                        reason = self.entry_check(symbol, signal)[0]
                    if not reason:
                        reason = blocks.get(symbol) or "Another opportunity ranked higher"
                    state = "MISSED" if reason.startswith(("Not attempted:", "Another opportunity")) else "REJECTED"
                previous = self.opportunities.get(key)
                if previous and (previous["state"], previous["reason"]) == (state, reason):
                    continue
                if previous and previous["state"] == "ACCEPTED" and state == "ACCEPTED":
                    continue
                record = dict(key=key, symbol=symbol, style=style, strategy=signal.get("strategy"),
                              state=state, reason=reason, at=now, first_at=previous["first_at"] if previous else now,
                              signal_at=signal.get("at"), score=signal.get("confidence"),
                              reward_risk=signal["entry"].get("reward_risk"), expected_value=None,
                              expected_value_reason="No validated/calibrated probability model",
                              broker_order_id=active.get("entry_id") if active.get("setup_key") == key else None)
                self.save("OPPORTUNITY", record=record)
                self.opportunities[key] = record
                self.metrics.increment(f"opportunities.{state.lower()}")
        for key, previous in list(self.opportunities.items()):
            if key not in present and previous["state"] in ("REJECTED", "MISSED"):
                record = {**previous, "state": "EXPIRED", "at": now,
                          "reason": f"Signal expired or no longer qualified; last decision: {previous['reason']}"}
                self.save("OPPORTUNITY", record=record)
                self.opportunities[key] = record
                self.metrics.increment("opportunities.expired")
        while len(self.opportunities) > 512:
            self.opportunities.pop(next(iter(self.opportunities)))

    def scan_entries(self):
        with self.lock:
            snapshot = self.service().snapshot()
            try:
                self.automated_entry()
            except LiveBlocked as exc:
                self.record_opportunities(snapshot, str(exc))
                raise
            self.record_opportunities(snapshot)

    def diagnostics(self):
        with self.lock, self.update_lock:
            status = self.status()
            active = self.state.get("active")
            fields = ("id", "symbol", "state", "entry_id", "protect_id", "quantity", "filled", "entry_price",
                      "entry_at", "entry_ack_at", "signal_at", "stop", "target", "error",
                      "broker_status", "broker_filled_quantity")
            return dict(
                ready=self.ready, armed_day=self.state["armed_day"], automation_on=self.state["automation_on"],
                automation_wanted=self.state["automation_wanted"], waiting=self.waiting, error=self.error,
                prepared_day=self.prepared_day, preparation_error=self.prepare_error,
                ranking=status["ranking"], entry_blocks=status["entry_blocks"],
                entry_plans=status["entry_plans"], limits=status["limits"],
                daily_counts=status["daily_counts"], daily_controls=copy.deepcopy(self.state["daily_controls"]),
                preflight_at=self.check["at"] if self.check else None,
                broker_write_permissions="Broker validates permissions at submission; not inferred from login",
                active={key: active.get(key) for key in fields} if active else None,
                broker_updates=list(self.broker_updates),
                opportunities=sorted(self.opportunities.values(), key=lambda row: row["at"], reverse=True)[:100],
                measurements=self.metrics.snapshot())

    def measured(self, stage, method):
        with self.metrics.measure(stage):
            return method()

    async def monitor(self):
        next_reconcile = 0.0
        while not self.stop_event.is_set():
            self.wake_event.clear()
            try:
                if self.state.get("flatten_pending"):
                    await asyncio.to_thread(self.emergency_flatten)
                    next_reconcile = time.monotonic() + 2
                else:
                    if self.order_dirty.is_set() or time.monotonic() >= next_reconcile:
                        self.order_dirty.clear()
                        await asyncio.to_thread(self.measured, "execution.reconcile", self.reconcile)
                        next_reconcile = time.monotonic() + 2
                    await asyncio.to_thread(self.prepare_session)
                    await asyncio.to_thread(self.auto_activate)
                    await asyncio.to_thread(self.measured, "quantedge.scan", self.scan_quantedge)
                    await asyncio.to_thread(self.measured, "expiryedge.scan", self.scan_expiryedge)
                    await asyncio.to_thread(self.measured, "expiryedge_ai.scan", self.scan_expiryedge_ai)
                    await asyncio.to_thread(self.measured, "execution.scan", self.scan_entries)
            except Exception as exc:
                logger.exception("AQTE live reconciliation requires attention; inspect broker terminal")
                await asyncio.to_thread(self.fault_stop, f"{type(exc).__name__}: {exc}")
            try:
                await asyncio.wait_for(self.wake_event.wait(), timeout=max(.01, next_reconcile - time.monotonic()))
            except asyncio.TimeoutError:
                pass

    async def start(self):
        await asyncio.to_thread(self.initialize)
        self.stop_event.clear()
        self.loop = asyncio.get_running_loop()
        self.service().listener = self.wake
        self.task = asyncio.create_task(self.monitor(), name="aqte-live-reconciliation")

    def disarm_shutdown(self):
        with self.lock:
            self.state["armed_day"] = None
            self.state["automation_on"] = False
            self.state["quantedge"]["enabled"] = False
            if self.ready:
                self.save("SHUTDOWN_DISARMED")

    async def stop(self):
        self.stop_event.set()
        self.wake_event.set()
        self.service().listener = None
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
