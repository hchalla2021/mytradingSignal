"""AUTONOMIQ PRO orchestrator — scheduling, agent coordination and health.

Failure isolation: every loop iteration and analysis cycle is wrapped so AI, Kite or
database failures are logged and surfaced on the dashboard without affecting any other
engine, the live market feed, or existing risk protection. Paper trading is disabled.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time as clock
from datetime import datetime, timedelta
from typing import Any

from kiteconnect.exceptions import KiteException

from . import agents
from .ai_client import AIClient, AIUnavailable
from .config import ANALYSIS_END, ANALYSIS_INTERVAL_MINUTES, LIVE_EXECUTION_DISABLED_REASON, AutonomiqConfig, load_config
from .live_executor import OWN_TAG_PREFIX, TERMINAL_ORDERS, LiveExecutionBlocked, LiveOrderExecutor
from .market_data import IST, SYMBOLS, MarketDataCollector, parse_ts
from .risk import build_plan, hybrid_levels, manage_position, tick, validate
from .store import Store

logger = logging.getLogger(__name__)
LOOP_SECONDS = 1
BROKER_RECONCILE_SECONDS = 5
CYCLE_TIMEOUT_S = 240
QUANT_REFRESH_SECONDS = 30
# Let Kite publish the just-closed candle before analysing it.
CANDLE_SETTLE_S = 5
def slot_start(now: datetime, minutes: float) -> datetime:
    """Start of the current analysis slot, aligned to the trading-day clock (e.g. 09:20, 09:25)."""
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    size = minutes * 60
    return midnight + timedelta(seconds=((now - midnight).total_seconds() // size) * size)


def next_slot(now: datetime, minutes: float) -> datetime:
    return slot_start(now, minutes) + timedelta(minutes=minutes, seconds=CANDLE_SETTLE_S)


def slot_run_at(now: datetime, minutes: float) -> datetime:
    return slot_start(now, minutes) + timedelta(seconds=CANDLE_SETTLE_S)


def analysis_window_open(now: datetime, cfg: AutonomiqConfig, session: dict) -> bool:
    return (session["trading_day"] and session["phase"] in ("ACTIVE", "MANAGE_ONLY")
            and cfg.analysis_start <= now.time()
            and slot_start(now, ANALYSIS_INTERVAL_MINUTES).time() <= ANALYSIS_END)


def holidays() -> set[str]:
    try:
        from services.market_session_controller import NSE_HOLIDAYS
        return set(NSE_HOLIDAYS)
    except ImportError:
        return set()


def session_state(cfg: AutonomiqConfig, now: datetime) -> dict:
    day = now.strftime("%Y-%m-%d")
    if now.weekday() >= 5:
        return {"trading_day": False, "phase": "WEEKEND", "reason": "Weekend", "market_open": False}
    if day in holidays() | set(cfg.extra_holidays):
        return {"trading_day": False, "phase": "HOLIDAY", "reason": "Exchange holiday", "market_open": False}
    t = now.time()
    market_open = datetime.strptime("09:15", "%H:%M").time() <= t <= datetime.strptime("15:30", "%H:%M").time()
    if t < cfg.market_start:
        phase = "PRE_MARKET"
    elif t <= cfg.entry_cutoff:
        phase = "ACTIVE"
    elif t <= cfg.market_end:
        phase = "MANAGE_ONLY"
    else:
        phase = "CLOSED"
    return {"trading_day": True, "phase": phase, "reason": "Trading day", "market_open": market_open}


class AutonomiqOrchestrator:
    def __init__(self, store: Store | None = None, collector: MarketDataCollector | None = None,
                 ai: AIClient | None = None):
        self.store = store or Store()
        self.collector = collector or MarketDataCollector()
        self.live_executor = LiveOrderExecutor(self.store, self.collector)
        self.ai = ai or AIClient(self.store)
        self.cfg = load_config()
        self._task: asyncio.Task | None = None
        self._cycle_task: asyncio.Task | None = None
        self._cycle_lock = asyncio.Lock()
        self.next_run_at: datetime | None = None
        self.quant_refresh_next_at: datetime | None = None
        self.last_cycle_at: datetime | None = None
        self.last_cycle_spots: dict[str, float] = {}
        self.last_error: str | None = None
        self.last_loop_at: datetime | None = None
        self.started_at: datetime | None = None
        self.quote_failures = 0
        self._last_actions: dict[str, tuple[str, str, str]] = {}
        self._last_broker_management_at: float | None = None
        self._broker_update_pending = threading.Event()

    # ── lifecycle ────────────────────────────────────────────────────
    async def start(self) -> None:
        if self._task and not self._task.done():
            return
        await asyncio.to_thread(self.store.open)
        await asyncio.to_thread(self.store.set_state, "auto_paper_trading", False)
        await self.live_executor.deactivate(self.cfg)
        self.started_at = datetime.now(IST)
        self._last_broker_management_at = None
        self.store.audit("system", "engine_start", {
            "live_trading_enabled": False, "live_execution_allowed": self.cfg.live_execution_allowed,
            "config": self.cfg.public(),
        })
        self._task = asyncio.create_task(self._loop(), name="autonomiq-pro-loop")
        logger.info("AUTONOMIQ PRO started (live execution allowed=%s; owner approval OFF)",
                    self.cfg.live_execution_allowed)

    async def stop(self) -> None:
        for task in (self._cycle_task, self._task):
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):  # noqa: BLE001 — shutdown must not raise
                    pass
        await asyncio.to_thread(self.store.close)

    @property
    def running(self) -> bool:
        return bool(self._task and not self._task.done())

    def runtime(self) -> dict:
        return {
            "engine_enabled": bool(self.store.get_state("engine_enabled", True)),
            "auto_paper_trading": False,
            "kill_switch": bool(self.store.get_state("kill_switch", False)),
            "live_execution_allowed": self.cfg.live_execution_allowed,
            "live_trading_enabled": bool(self.store.get_state("live_trading_enabled", False)),
        }

    # ── main loop ────────────────────────────────────────────────────
    def broker_update(self, update: dict) -> None:
        if (str(update.get("tag") or "").startswith(OWN_TAG_PREFIX)
                and str(update.get("status") or "").upper() in TERMINAL_ORDERS):
            self._broker_update_pending.set()

    async def _loop(self) -> None:
        while True:
            started = clock.monotonic()
            try:
                await self._tick()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — isolate every failure
                self.last_error = f"loop: {type(exc).__name__}"
                logger.exception("AUTONOMIQ PRO loop iteration failed")
            await asyncio.sleep(max(0, LOOP_SECONDS - (clock.monotonic() - started)))

    async def _tick(self) -> None:
        self.cfg = load_config()
        now = datetime.now(IST)
        self.last_loop_at = now
        session = session_state(self.cfg, now)
        if self.cfg.live_execution_allowed:
            self.live_executor.mark_positions(self.cfg, now)
            management_at = clock.monotonic()
            update_due = (self._broker_update_pending.is_set()
                          and (self._last_broker_management_at is None
                               or management_at - self._last_broker_management_at >= LOOP_SECONDS))
            if (self._last_broker_management_at is None
                    or management_at - self._last_broker_management_at >= BROKER_RECONCILE_SECONDS
                    or update_due):
                self._broker_update_pending.clear()
                self._last_broker_management_at = management_at
                await self.live_executor.reconcile_and_manage(self.cfg, now, self.cfg.square_off)
                if not self.runtime()["live_trading_enabled"]:
                    await self.live_executor.cancel_pending_entries()
        if self.store.get_state("kill_switch", False):
            for trade in self.store.open_live_trades(limit=10000):
                if not trade.get("close_requested"):
                    self.store.update_live_trade(trade["id"], close_requested="KILL_SWITCH")
            return
        state = self.runtime()
        if not (self.cfg.enabled and state["engine_enabled"]):
            return
        if not analysis_window_open(now, self.cfg, session):
            self.next_run_at = None
            self.quant_refresh_next_at = None
            return
        if self.next_run_at is None:
            # At startup or after a restart, run the first check immediately when
            # the active entry window has already begun. The slot claim below
            # prevents repeated AI calls and a restart from overwriting the cycle.
            self.next_run_at = now if now.time() >= self.cfg.market_start else slot_run_at(now, ANALYSIS_INTERVAL_MINUTES)
        if now >= self.next_run_at:
            if self.store.get_state("ai_slot") == slot_start(now, ANALYSIS_INTERVAL_MINUTES).isoformat():
                self.next_run_at = next_slot(now, ANALYSIS_INTERVAL_MINUTES)
                logger.info("AUTONOMIQ PRO AI slot already claimed; next scheduled run %s", self.next_run_at.isoformat())
            else:
                self.trigger("SCHEDULED")

        if self.quant_refresh_next_at is None:
            self.quant_refresh_next_at = now + timedelta(seconds=QUANT_REFRESH_SECONDS)
        if now >= self.quant_refresh_next_at:
            self.quant_refresh_next_at = now + timedelta(seconds=QUANT_REFRESH_SECONDS)
            if not (self._cycle_task and not self._cycle_task.done()):
                self.trigger("QUANT_EVENT")

    def trigger(self, trigger: str) -> bool:
        if self._cycle_task and not self._cycle_task.done():
            return False
        if trigger == "SCHEDULED":
            self.next_run_at = next_slot(datetime.now(IST), ANALYSIS_INTERVAL_MINUTES)
        self._cycle_task = asyncio.create_task(self._guarded_cycle(trigger), name=f"autonomiq-cycle-{trigger}")
        return True

    async def _guarded_cycle(self, trigger: str) -> None:
        try:
            await asyncio.wait_for(self.run_cycle(trigger), timeout=CYCLE_TIMEOUT_S)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            self.last_error = f"cycle: {type(exc).__name__}"
            logger.exception("AUTONOMIQ PRO analysis cycle failed")

    async def _spot(self, symbol: str, now: datetime) -> dict:
        spot = await self.collector.spot(symbol, now)
        age = spot.get("age_s")
        # Exchange/receipt clocks may be up to 3 s ahead; never accept older than the configured limit.
        spot["fresh"] = age is not None and -3 <= age <= self.cfg.max_data_age_seconds
        return spot

    # ── analysis cycle ───────────────────────────────────────────────
    async def run_cycle(self, trigger: str) -> dict:
        async with self._cycle_lock:
            cfg, now = self.cfg, datetime.now(IST)
            day = now.strftime("%Y-%m-%d")
            session = session_state(cfg, now)
            cycle_id = self.store.start_cycle(trigger)
            try:
                payload = await self._analyze(cfg, now, day, session, trigger, cycle_id)
            except Exception as exc:
                self.store.finish_cycle(cycle_id, "FAILED", error=type(exc).__name__)
                raise
            self.store.finish_cycle(cycle_id, "OK", summary=payload["summary"], payload=payload)
            self.last_cycle_at = now
            if trigger == "SCHEDULED":
                self.last_cycle_spots = {s: c["spot"]["price"] for s, c in payload["indices"].items()
                                         if c["spot"]["price"]}
            self.last_error = None
            return payload

    async def _analyze(self, cfg: AutonomiqConfig, now: datetime, day: str, session: dict, trigger: str,
                       cycle_id: int) -> dict:
        if session["phase"] == "PRE_MARKET":
            return {
                "cycle_id": cycle_id,
                "trigger": trigger,
                "at": now.isoformat(),
                "session": session,
                "ai_state": "SKIPPED_PRE_OPEN",
                "model": None,
                "market_alert": {
                    "tone": "CAUTION",
                    "title": "Waiting for live market",
                    "detail": f"Pre-open data is not trade analysis. Analysis starts {cfg.market_start:%H:%M} IST.",
                },
                "summary": "Pre-open and auction matching; live intraday analysis is on hold.",
                "indices": {},
            }
        contexts: dict[str, dict] = {}
        for symbol in SYMBOLS:
            observed_at = datetime.now(IST)
            spot = await self._spot(symbol, observed_at)
            data = await asyncio.to_thread(self.collector.collect_sync, symbol, spot.get("price"), observed_at)
            collected_at = datetime.now(IST)
            analysis = agents.MarketAnalysisAgent().run(data, day)
            quant = agents.QuantResearchAgent().run(analysis, data)
            contexts[symbol] = {"spot": spot, "data": data, "analysis": analysis, "quant": quant,
                                "collected_at": collected_at, "options_pending": not spot.get("price")}
        for symbol, ctx in contexts.items():
            ctx["spot"] = await self._spot(symbol, datetime.now(IST))
            price = ctx["spot"].get("price")
            if ctx["options_pending"] and not ctx["data"].get("options") and ctx["spot"]["fresh"] and price:
                try:
                    ctx["data"]["options"] = await asyncio.to_thread(
                        self.collector.collect_options_sync, symbol, price, datetime.now(IST),
                    )
                except Exception as exc:  # noqa: BLE001 — broker failures leave this index in NO_TRADE
                    ctx["data"]["errors"].append(f"options: {type(exc).__name__}")
                    logger.warning("AUTONOMIQ PRO option-chain recovery failed for %s: %s", symbol, type(exc).__name__)
                else:
                    ctx["collected_at"] = datetime.now(IST)
                    ctx["quant"] = agents.QuantResearchAgent().run(ctx["analysis"], ctx["data"])

        ai_state = self.ai.status(cfg, day)
        big_move = trigger == "SCHEDULED" and self._big_move(contexts)
        model = cfg.model_for("EVENT" if big_move else trigger)
        skip, ai_contexts = self._ai_gate(cfg, now, day, session, trigger, contexts)
        live_rows = self.store.open_live_trades(limit=10000) if cfg.live_execution_allowed else []
        live_by_symbol = {
            trade["symbol"]: trade for trade in live_rows
            if int(trade.get("entry_filled") or 0) > int(trade.get("exit_filled") or 0)
        }
        live_positions = [{
            "symbol": trade["symbol"], "tradingsymbol": trade["tradingsymbol"],
            "option_type": trade["option_type"], "quantity": max(
                0, int(trade.get("entry_filled") or 0) - int(trade.get("exit_filled") or 0)),
            "entry": trade.get("entry_price") or trade["entry"], "stop_loss": trade["stop_loss"],
            "trailing_stop": trade["trailing_sl"], "target1": trade["target1"], "target2": trade["target2"],
            "last_price": trade.get("last_price"), "status": trade["status"],
        } for trade in live_by_symbol.values()]
        strategy: dict | None = None
        if ai_state == "ACTIVE" and ai_contexts:
            # Claim the slot before calling so no other path can spend tokens in the same slot.
            self.store.set_state("ai_slot", slot_start(now, ANALYSIS_INTERVAL_MINUTES).isoformat())
            try:
                raw_strategy = agents.normalize_strategy(await self.ai.complete_json(
                    cfg, day, "strategy", model, agents.STRATEGY_SYSTEM,
                    agents.strategy_payload(ai_contexts, {**session, "time": now.strftime("%H:%M"),
                                                          "trigger": "BIG_MOVE" if big_move else trigger},
                                            live_positions)))
                strategy, validation_issues = agents.validate_strategy(
                    raw_strategy, contexts, cfg.min_signal_score, live_positions)
                if validation_issues:
                    logger.warning("AUTONOMIQ PRO AI output cross-validation rejected: %s",
                                   "; ".join(validation_issues))
                    ai_state = "AI_OUTPUT_REJECTED"
                    strategy = None
            except AIUnavailable as exc:
                ai_state = str(exc)
        elif ai_state == "ACTIVE":
            ai_state = skip or "SKIPPED"

        validator = agents.SignalValidationAgent()
        state = self.runtime()
        indices: dict[str, Any] = {}
        for symbol, ctx in contexts.items():
            decision_at = datetime.now(IST)
            decision_session = session_state(cfg, decision_at)
            ctx["spot"] = await self._spot(symbol, decision_at)
            ai_sig = (strategy or {}).get("indices", {}).get(symbol) if strategy else None
            live_trade = next((
                trade for trade in self.store.open_live_trades(limit=10000)
                if trade["symbol"] == symbol
                and int(trade.get("entry_filled") or 0) > int(trade.get("exit_filled") or 0)
            ), None) if cfg.live_execution_allowed else None
            signal = validator.run(symbol, ctx, ai_sig, cfg.min_signal_score, cfg.require_ai_confirmation, ai_state,
                                   has_open_position=live_trade is not None)
            if signal["action"] == "HOLD" and live_trade and live_trade["status"] != "OPEN":
                signal.update(action="WAIT", reasoning=(
                    f"Current broker state: {live_trade['status'].replace('_', ' ')}. "
                    "Awaiting execution reconciliation; protection is not assumed."
                ))
            plan = None
            if signal["action"] in ("BUY_CE", "BUY_PE"):
                elapsed = max(0, (decision_at - ctx["collected_at"]).total_seconds())
                for strike in ctx["data"]["options"]["strikes"]:
                    for kind in ("CE", "PE"):
                        leg = strike.get(kind)
                        if leg and leg.get("trade_age_s") is not None:
                            leg["trade_age_s"] += elapsed
                plan = build_plan(symbol, signal["action"], ctx["data"]["options"], ctx["analysis"]["atr_5m"], cfg)
                if not plan.get("error") and cfg.live_execution_allowed:
                    try:
                        index_candles, option_candles = await asyncio.to_thread(
                            self.collector.execution_candles, symbol, plan["exchange"],
                            plan["tradingsymbol"], datetime.now(IST))
                        levels = hybrid_levels(
                            entry=plan["entry"], bid=plan["quote"]["bid"],
                            quantity=plan["lot_size"], delta=plan["quote"]["delta"],
                            option_type=plan["option_type"], index_candles=index_candles,
                            option_candles=option_candles, cfg=cfg)
                        plan.update(levels, risk_rupees=levels["risk"] * plan["lot_size"],
                                    trailing_sl=tick(plan["entry"] - levels["risk"] * .5),
                                    risk_reward=max(2, cfg.min_risk_reward))
                    except (KiteException, ValueError, KeyError) as exc:
                        logger.warning("AUTONOMIQ PRO hybrid plan unavailable for %s: %s", symbol, exc)
                        plan = {"error": f"Hybrid plan unavailable: {str(exc)[:240]}"}
                if plan.get("error"):
                    signal.update(action="WAIT", reasoning=f"{signal['reasoning']} No trade: {plan['error']}.")
                    plan = None
            if plan:
                signal["risk"] = validate(
                    plan, cfg=cfg, now=decision_at, session=decision_session, spot=ctx["spot"], state=state,
                    open_trades=self.store.open_live_trades(limit=10000),
                    day_stats=self.store.live_day_stats(decision_at.strftime("%Y-%m-%d")),
                    recent_trades=self.store.live_trades(limit=10000))
                signal["approval_status"] = "APPROVED" if signal["risk"]["approved"] else "RISK_BLOCKED"
            elif signal["action"] in ("BUY_CE", "BUY_PE") or signal.get("approval_status") == "PENDING_RISK":
                signal["approval_status"] = "RISK_BLOCKED"
            execution = {"status": "NOT_REQUESTED", "detail": ""}
            if signal["action"] in ("BUY_CE", "BUY_PE") and cfg.live_execution_allowed:
                execution = await self.live_executor.submit_entry(
                    cfg=cfg, session=decision_session, symbol=symbol, decision=signal,
                    plan=plan or {}, cycle_id=cycle_id, now=decision_at,
                )
            elif signal["action"] == "EXIT" and live_trade is not None:
                self.store.update_live_trade(live_trade["id"], close_requested="AI_EXIT")
                execution = {"status": "EXIT_REQUESTED", "detail": "AUTONOMIQ exit will be reconciled by the backend manager"}
            elif signal["action"] in ("BUY_CE", "BUY_PE"):
                execution = {"status": "LIVE_DISABLED", "detail": LIVE_EXECUTION_DISABLED_REASON}
            live_risk_checks = execution.pop("risk_checks", [])
            if live_risk_checks:
                if "risk" not in signal:
                    signal["risk"] = {"approved": False, "checks": []}
                signal["risk"]["checks"].extend(live_risk_checks)
                signal["risk"]["approved"] = all(check["passed"] for check in signal["risk"]["checks"])
                signal["approval_status"] = "APPROVED" if signal["risk"]["approved"] else "RISK_BLOCKED"
            quant_action, _ = agents.quant_action(ctx, cfg.min_signal_score)
            decision = {"symbol": symbol, **signal, "quant_action": quant_action,
                        "ai_action": ai_sig["action"] if ai_sig else None,
                        "plan": plan, "execution": execution,
                        "timestamp": decision_at.isoformat()}
            self.store.add_decision(cycle_id, day, decision)
            self._alert_on_change(symbol, decision)
            indices[symbol] = {
                "spot": ctx["spot"], "signal": decision, "analysis": ctx["analysis"], "quant": ctx["quant"],
                "futures": ctx["data"].get("futures"),
                "options": {k: v for k, v in (ctx["data"].get("options") or {}).items() if k != "strikes"} or None,
                "errors": ctx["data"]["errors"],
            }

        alert = (strategy or {}).get("market_alert") or _quant_alert(contexts)
        summary = (strategy or {}).get("summary") or _quant_summary(contexts, ai_state)
        return {"cycle_id": cycle_id, "trigger": trigger, "at": now.isoformat(), "session": session,
                "ai_state": ai_state, "model": model if strategy else None, "market_alert": alert,
                "summary": summary, "indices": indices}

    def _big_move(self, contexts: dict[str, dict]) -> bool:
        for symbol, before in self.last_cycle_spots.items():
            price = contexts.get(symbol, {}).get("spot", {}).get("price")
            if price and before and abs(price - before) * 100 / before >= self.cfg.event_move_pct:
                self.store.add_alert("info", f"{symbol} moved ≥{self.cfg.event_move_pct}% since last slot — "
                                             "advanced model for this slot", symbol)
                return True
        return False

    def _ai_gate(self, cfg: AutonomiqConfig, now: datetime, day: str, session: dict, trigger: str,
                 contexts: dict[str, dict]) -> tuple[str | None, dict[str, dict]]:
        """Decide whether this cycle may spend AI tokens.

        Run one AI market-analysis request per scheduled five-minute slot whenever the
        AI service is active. Include all collected index contexts so the model can report
        unavailable or stale inputs instead of silently skipping a cycle with no quant BUY.
        Entry limits block trade approval, not market analysis.
        """
        if trigger == "MANUAL":
            return "SKIPPED_MANUAL_QUANT_ONLY", {}
        if trigger == "QUANT_EVENT":
            if not analysis_window_open(now, cfg, session):
                return "SKIPPED_OUTSIDE_WINDOW", {}
            slot = slot_start(now, ANALYSIS_INTERVAL_MINUTES).isoformat()
            if self.store.get_state("ai_slot") == slot:
                return "SKIPPED_SLOT_ALREADY_ANALYZED", {}
            actionable = {}
            for symbol, ctx in contexts.items():
                if agents.data_problems(ctx):
                    continue
                quant_action, _ = agents.quant_action(ctx, cfg.min_signal_score)
                if quant_action in ("BUY_CE", "BUY_PE"):
                    actionable[symbol] = ctx
            if not actionable:
                return "SKIPPED_AUTOMATIC_NO_QUANT_SETUP", {}
            return None, actionable
        if not analysis_window_open(now, cfg, session):
            return "SKIPPED_OUTSIDE_WINDOW", {}
        slot = slot_start(now, ANALYSIS_INTERVAL_MINUTES).isoformat()
        if self.store.get_state("ai_slot") == slot:
            return "SKIPPED_SLOT_ALREADY_ANALYZED", {}
        return None, contexts

    def _alert_on_change(self, symbol: str, decision: dict) -> None:
        action = decision["action"]
        execution = decision.get("execution") or {}
        is_entry = action in ("BUY_CE", "BUY_PE")
        status = execution.get("status", "NOT_REQUESTED") if is_entry else ""
        detail = execution.get("detail", "") if is_entry else ""
        key = (action, status, detail)
        if self._last_actions.get(symbol) == key:
            return
        self._last_actions[symbol] = key
        level = "warning" if action == "WAIT" else "info"
        text = action.replace("_", " ")
        if is_entry:
            level = "error" if status == "ENTRY_UNKNOWN" else "info" if status == "ENTRY_PENDING" else "warning"
            text = f"{text} · {status.replace('_', ' ')}"
        self.store.add_alert(level, f"{symbol} – {text} ({decision.get('strength', 'Low')}): "
                                    f"{detail or (decision.get('reasoning') or '')[:110]}", symbol)

    # ── paper position management ────────────────────────────────────
    async def manage_positions(self, now: datetime, force_reason: str | None = None) -> None:
        trades = self.store.open_trades()
        if not trades:
            return
        keys = [f"{t['exchange']}:{t['tradingsymbol']}" for t in trades]
        try:
            quotes = await asyncio.to_thread(self.collector.quote_contracts, keys)
            self.quote_failures = 0
        except Exception as exc:  # noqa: BLE001
            self.quote_failures += 1
            if self.quote_failures in (1, 12):
                self.store.add_alert("error", f"Paper position quotes unavailable ({type(exc).__name__}); "
                                              "positions held, retrying")
            return
        for trade, key in zip(trades, keys):
            q = quotes.get(key) or {}
            bid = ((q.get("depth") or {}).get("buy") or [{}])[0].get("price") or 0
            price = float(bid or q.get("last_price") or 0)
            if price <= 0:
                continue
            updates = manage_position(trade, price, now.time(), self.cfg.square_off)
            quote_at = parse_ts(q.get("timestamp") if bid else q.get("last_trade_time"))
            updates["last_quote_at"] = quote_at.isoformat() if quote_at else None
            updates["last_price_source"] = "BID" if bid else "LAST_TRADE"
            if force_reason and updates.get("status") != "CLOSED":
                updates.update(status="CLOSED", exit_price=price, exit_reason=force_reason,
                               pnl=round((price - trade["entry"]) * trade["lot_size"] * trade["lots"], 2))
            if updates.get("status") == "CLOSED":
                updates["closed_at"] = now.isoformat(timespec="seconds")
                self.store.audit("engine", "paper_exit", {"trade_id": trade["id"], **updates})
                self.store.add_alert("success" if updates["pnl"] > 0 else "warning",
                                     f"PAPER EXIT {trade['tradingsymbol']} {updates['exit_reason']} "
                                     f"@ ₹{price:.2f} P&L ₹{updates['pnl']:,.0f}", trade["symbol"])
            self.store.update_paper_trade(trade["id"], **updates)

    # ── operator controls ────────────────────────────────────────────
    async def control(self, actor: str, changes: dict, confirm_live: str | None = None) -> dict:
        if changes.get("auto_paper_trading"):
            raise ValueError("Simulated trading has been disabled")
        live_enabled = changes.get("live_trading_enabled")
        if live_enabled is True:
            if changes.get("kill_switch") is True or changes.get("engine_enabled") is False:
                raise LiveExecutionBlocked("Live trading cannot be enabled while disabling the engine or engaging the kill switch")
            if not self.cfg.live_execution_allowed:
                raise LiveExecutionBlocked(LIVE_EXECUTION_DISABLED_REASON)
            if confirm_live != "ENABLE_AUTONOMIQ_LIVE_TRADING":
                raise LiveExecutionBlocked("Explicit live-trading confirmation is required")
            if self.runtime()["kill_switch"]:
                raise LiveExecutionBlocked("Release the AUTONOMIQ kill switch before enabling live entries")
            if not self.cfg.enabled or not self.cfg.ai_enabled or not self.cfg.ai_configured:
                raise LiveExecutionBlocked("AUTONOMIQ and its Anthropic strategy must be configured and enabled")
            ai_status = self.ai.status(self.cfg, datetime.now(IST).strftime("%Y-%m-%d"))
            if ai_status != "ACTIVE":
                raise LiveExecutionBlocked(f"AI is not ready for live decisions ({ai_status})")
            self.store.set_state("engine_enabled", True)
            await self.live_executor.activate(self.cfg)
        if (live_enabled is False or changes.get("engine_enabled") is False
                or changes.get("kill_switch") is True):
            await self.live_executor.deactivate(self.cfg)
        if changes.get("kill_switch"):
            self.store.set_state("kill_switch", True)
            for trade in self.store.open_live_trades(limit=10000):
                self.store.update_live_trade(trade["id"], close_requested="KILL_SWITCH")
        else:
            for key in ("engine_enabled", "kill_switch"):
                if key in changes and changes[key] is not None:
                    self.store.set_state(key, bool(changes[key]))
        self.store.audit(actor, "control", changes)
        if changes.get("kill_switch"):
            self.store.add_alert("error", "AUTONOMIQ KILL SWITCH engaged — new entries blocked; owned positions exiting")
            if self.cfg.live_execution_allowed:
                await self.live_executor.reconcile_and_manage(self.cfg, datetime.now(IST), self.cfg.square_off)
        return self.runtime()

    def quote_pins(self, catalog: list[dict]) -> dict:
        """Keep owned options on the shared quote feed, even after ATM rotation."""
        if self.store.conn is None or not self.cfg.live_execution_allowed:
            return {}
        from services.aqte_engine import Contract

        owned = {(t["exchange"], t["tradingsymbol"]) for t in self.store.open_live_trades(limit=10000)
                 if int(t.get("entry_filled") or 0) > int(t.get("exit_filled") or 0)}
        return {
            int(row["instrument_token"]): Contract(
                row["name"], int(row["instrument_token"]), row["tradingsymbol"], row["exchange"],
                row["instrument_type"], float(row["strike"]), str(row["expiry"])[:10],
                int(row["lot_size"]), float(row["tick_size"]),
            )
            for row in catalog if (row["exchange"], row["tradingsymbol"]) in owned
        }

    # ── snapshot / health ────────────────────────────────────────────
    async def snapshot(self) -> dict:
        now = datetime.now(IST)
        day = now.strftime("%Y-%m-%d")
        spots = {s: await self._spot(s, now) for s in SYMBOLS}
        last = self.store.last_cycle()
        scheduled = last if last and last["trigger"] == "SCHEDULED" else self.store.last_cycle(trigger="SCHEDULED")
        scheduled_payload = scheduled["payload"] if scheduled else None
        last_scheduled = None
        if scheduled_payload and scheduled_payload["at"][:10] == day:
            last_scheduled = {
                "at": scheduled_payload["at"], "ai_state": scheduled_payload["ai_state"],
                "signals": {
                    symbol: {key: data["signal"].get(key) for key in (
                        "action", "quant_action", "ai_action", "reasoning", "execution", "timestamp",
                    )}
                    for symbol, data in scheduled_payload["indices"].items()
                },
            }
        live_rows = self.store.live_trades(50) if self.cfg.live_execution_allowed else []
        for trade in live_rows:
            mark = self.live_executor.quote_mark(trade, self.cfg, now)
            if mark is not None:
                trade.update(mark)
        live_closed = [trade for trade in self.store.live_trades(10000)
                       if trade["status"] == "CLOSED"] if self.cfg.live_execution_allowed else []
        live_pnl = round(sum(float(trade.get("pnl") or 0) for trade in live_closed), 2)
        live_performance = {
            "trades": len(live_closed), "pnl": live_pnl,
            "wins": sum(1 for trade in live_closed if float(trade.get("pnl") or 0) > 0),
            "today": self.store.live_day_stats(day) if self.cfg.live_execution_allowed
            else {"trades": 0, "realized": 0, "wins": 0, "losses": 0},
        }
        public_live_trades = [{
            key: trade.get(key) for key in (
                "id", "created_at", "opened_at", "closed_at", "symbol", "exchange", "tradingsymbol",
                "option_type", "quantity", "entry", "entry_price", "stop_loss", "trailing_sl", "target1",
                "target2", "last_price", "exit_price", "exit_reason", "pnl", "risk_rupees", "status", "error",
                "entry_filled", "exit_filled", "last_quote_at", "last_broker_sync", "risk_model",
            )
        } for trade in live_rows]
        return {
            "generated_at": now.isoformat(), "config": self.cfg.public(), "runtime": self.runtime(),
            "session": session_state(self.cfg, now), "health": self.health(now),
            "spots": spots, "cycle": last["payload"] if last else None, "last_scheduled": last_scheduled,
            "alerts": self.store.alerts(30), "decisions": self.store.decisions(30),
            "trades": [], "open_trades": [], "live_trades": public_live_trades,
            "live_performance": live_performance,
            "performance": {
                "trades": live_performance["trades"], "pnl": live_performance["pnl"],
                "wins": live_performance["wins"],
                "win_rate": round(live_performance["wins"] * 100 / live_performance["trades"], 1)
                if live_performance["trades"] else None,
                "best": max((float(trade.get("pnl") or 0) for trade in live_closed), default=0),
                "worst": min((float(trade.get("pnl") or 0) for trade in live_closed), default=0),
                "today": live_performance["today"],
            },
            "ai_usage": {"today": self.store.ai_usage(day), "month": self.store.ai_usage(day[:7]),
                         "recent": self.store.ai_calls(10)},
        }

    def health(self, now: datetime | None = None) -> dict:
        now = now or datetime.now(IST)
        day = now.strftime("%Y-%m-%d")
        loop_age = (now - self.last_loop_at).total_seconds() if self.last_loop_at else None
        return {
            "running": self.running, "loop_age_s": round(loop_age, 1) if loop_age is not None else None,
            "healthy": self.running and loop_age is not None and loop_age < LOOP_SECONDS * 4,
            "ai_state": self.ai.status(self.cfg, day) if self.store.conn is not None else "OFFLINE",
            "ai_last_error": self.ai.last_error,
            "ai_consecutive_failures": self.ai.consecutive_failures,
            "last_cycle_at": self.last_cycle_at.isoformat() if self.last_cycle_at else None,
            "next_run_at": self.next_run_at.isoformat() if self.next_run_at else None,
            "quant_refresh_next_at": self.quant_refresh_next_at.isoformat() if self.quant_refresh_next_at else None,
            "cycle_running": bool(self._cycle_task and not self._cycle_task.done()),
            "last_error": self.last_error,
            "live_execution": "AVAILABLE" if self.cfg.live_execution_allowed else "DISABLED_BY_CONFIG",
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "uptime_s": round(clock.time() - self.started_at.timestamp()) if self.started_at else None,
        }


def _quant_alert(contexts: dict[str, dict]) -> dict:
    scores = [c["quant"]["score"] for c in contexts.values() if c["spot"].get("fresh")]
    if not scores:
        return {"tone": "CAUTION", "title": "Waiting for live data",
                "detail": "No fresh market ticks — signals are on hold."}
    avg = sum(scores) / len(scores)
    tone = "BULLISH" if avg >= 25 else "BEARISH" if avg <= -25 else "NEUTRAL"
    titles = {"BULLISH": "Bullish momentum", "BEARISH": "Bearish pressure", "NEUTRAL": "Mixed / range-bound"}
    return {"tone": tone, "title": titles[tone], "detail": f"Average quant score {avg:+.0f} across indices."}


def _quant_summary(contexts: dict[str, dict], ai_state: str) -> str:
    parts = [f"{s}: {c['quant']['bias'].lower()} ({c['quant']['score']:+.0f})" for s, c in contexts.items()]
    return f"Quant engine view — {', '.join(parts)}. AI layer: {ai_state.replace('_', ' ').lower()}."


_orchestrator: AutonomiqOrchestrator | None = None
_orchestrator_lock = threading.Lock()


def get_orchestrator() -> AutonomiqOrchestrator:
    global _orchestrator
    with _orchestrator_lock:
        if _orchestrator is None:
            _orchestrator = AutonomiqOrchestrator()
        return _orchestrator
