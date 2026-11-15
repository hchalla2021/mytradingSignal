"""AUTONOMIQ PRO orchestrator — scheduling, agent coordination and health.

Failure isolation: every loop iteration and analysis cycle is wrapped so AI, Kite or
database failures are logged and surfaced on the dashboard without affecting any other
engine, the live market feed, or existing risk protection. New simulated entries are
disabled; legacy simulated positions remain managed and can still affect risk gates.
"""

from __future__ import annotations

import asyncio
import logging
import time as clock
from datetime import datetime, timedelta
from typing import Any

from . import agents
from .ai_client import AIClient, AIUnavailable
from .config import AutonomiqConfig, load_config
from .market_data import IST, SYMBOLS, MarketDataCollector, parse_ts
from .risk import build_plan, manage_position, validate
from .store import Store

logger = logging.getLogger(__name__)
LOOP_SECONDS = 5
CYCLE_TIMEOUT_S = 240
# Let Kite publish the just-closed candle before analysing it.
CANDLE_SETTLE_S = 5
BUY_ACTIONS = ("BUY_CE", "BUY_PE")


def slot_start(now: datetime, minutes: float) -> datetime:
    """Start of the current analysis slot, aligned to the trading-day clock (e.g. 09:20, 09:25)."""
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    size = minutes * 60
    return midnight + timedelta(seconds=((now - midnight).total_seconds() // size) * size)


def next_slot(now: datetime, minutes: float) -> datetime:
    return slot_start(now, minutes) + timedelta(minutes=minutes, seconds=CANDLE_SETTLE_S)


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
        self.ai = ai or AIClient(self.store)
        self.cfg = load_config()
        self._task: asyncio.Task | None = None
        self._cycle_task: asyncio.Task | None = None
        self._cycle_lock = asyncio.Lock()
        self.next_run_at: datetime | None = None
        self.last_cycle_at: datetime | None = None
        self.last_cycle_spots: dict[str, float] = {}
        self.last_error: str | None = None
        self.last_loop_at: datetime | None = None
        self.started_at: datetime | None = None
        self.quote_failures = 0
        self._last_actions: dict[str, str] = {}

    # ── lifecycle ────────────────────────────────────────────────────
    async def start(self) -> None:
        if self._task and not self._task.done():
            return
        await asyncio.to_thread(self.store.open)
        await asyncio.to_thread(self.store.set_state, "auto_paper_trading", False)
        self.started_at = datetime.now(IST)
        self.store.audit("system", "engine_start", {"live_trading": False, "config": self.cfg.public()})
        self._task = asyncio.create_task(self._loop(), name="autonomiq-pro-loop")
        logger.info("AUTONOMIQ PRO started (analysis only; live execution locked)")

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
        }

    # ── main loop ────────────────────────────────────────────────────
    async def _loop(self) -> None:
        while True:
            try:
                await self._tick()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — isolate every failure
                self.last_error = f"loop: {type(exc).__name__}"
                logger.exception("AUTONOMIQ PRO loop iteration failed")
            await asyncio.sleep(LOOP_SECONDS)

    async def _tick(self) -> None:
        self.cfg = load_config()
        now = datetime.now(IST)
        self.last_loop_at = now
        session = session_state(self.cfg, now)
        if self.store.open_trades():
            await self.manage_positions(now)
        state = self.runtime()
        if not (self.cfg.enabled and state["engine_enabled"]) or state["kill_switch"]:
            return
        if session["phase"] != "ACTIVE":
            self.next_run_at = None
            return
        if self.next_run_at is None:
            # Never spend a run on startup; wait for the next completed candle.
            self.next_run_at = next_slot(now, self.cfg.analysis_interval_minutes)
        elif now >= self.next_run_at:
            self.trigger("SCHEDULED")

    def trigger(self, trigger: str) -> bool:
        if self._cycle_task and not self._cycle_task.done():
            return False
        if trigger == "SCHEDULED":
            self.next_run_at = next_slot(datetime.now(IST), self.cfg.analysis_interval_minutes)
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
        contexts: dict[str, dict] = {}
        for symbol in SYMBOLS:
            spot = await self._spot(symbol, now)
            data = await asyncio.to_thread(self.collector.collect_sync, symbol, spot.get("price"), now)
            analysis = agents.MarketAnalysisAgent().run(data, day)
            quant = agents.QuantResearchAgent().run(analysis, data)
            contexts[symbol] = {"spot": spot, "data": data, "analysis": analysis, "quant": quant}

        ai_state = self.ai.status(cfg, day)
        big_move = trigger == "SCHEDULED" and self._big_move(contexts)
        model = cfg.model_for("EVENT" if big_move else trigger)
        skip, candidates = self._ai_gate(cfg, now, day, session, trigger, contexts)
        strategy: dict | None = None
        if ai_state == "ACTIVE" and candidates:
            # Claim the slot before calling so no other path can spend tokens in the same slot.
            self.store.set_state("ai_slot", slot_start(now, cfg.analysis_interval_minutes).isoformat())
            try:
                strategy = agents.normalize_strategy(await self.ai.complete_json(
                    cfg, day, "strategy", model, agents.STRATEGY_SYSTEM,
                    agents.strategy_payload(candidates, {**session, "time": now.strftime("%H:%M"),
                                                         "trigger": "BIG_MOVE" if big_move else trigger})))
            except AIUnavailable as exc:
                ai_state = str(exc)
        elif ai_state == "ACTIVE":
            ai_state = skip or "SKIPPED"

        validator = agents.SignalValidationAgent()
        signals: dict[str, dict] = {}
        plans: dict[str, dict] = {}
        for symbol, ctx in contexts.items():
            ai_sig = (strategy or {}).get("indices", {}).get(symbol) if strategy else None
            signal = validator.run(symbol, ctx, ai_sig, cfg.min_signal_score, cfg.require_ai_confirmation, ai_state)
            if signal["action"] in ("BUY_CE", "BUY_PE"):
                plan = build_plan(symbol, signal["action"], ctx["data"]["options"], ctx["analysis"]["atr_5m"], cfg)
                if plan.get("error"):
                    signal.update(action="WAIT", reasoning=f"{signal['reasoning']} No trade: {plan['error']}.")
                else:
                    plans[symbol] = plan
            signals[symbol] = signal

        # The strategy call above is the only AI call per slot; entries are approved by the Python risk engine.
        state = self.runtime()
        indices: dict[str, Any] = {}
        for symbol, ctx in contexts.items():
            signal, plan = signals[symbol], plans.get(symbol)
            risk_result = None
            if plan:
                risk_result = validate(
                    plan, cfg=cfg, now=now, session=session, spot=ctx["spot"], state=state,
                    open_trades=self.store.open_trades(), day_stats=self.store.day_stats(day),
                    recent_trades=self.store.trades(20))
                signal["risk"] = risk_result
            decision = {"symbol": symbol, **signal, "plan": plan, "timestamp": now.isoformat()}
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

        The AI can only confirm a quant BUY or downgrade it to WAIT, so a call is worthwhile only when
        a fresh quant setup exists on an index that could actually be entered. Returns
        (skip_reason, candidates); candidates is non-empty only when a call is justified.
        """
        if trigger != "SCHEDULED":
            return "SKIPPED_MANUAL_QUANT_ONLY", {}
        if session["phase"] != "ACTIVE":
            return "SKIPPED_OUTSIDE_WINDOW", {}
        slot = slot_start(now, cfg.analysis_interval_minutes).isoformat()
        if self.store.get_state("ai_slot") == slot:
            return "SKIPPED_SLOT_ALREADY_ANALYZED", {}
        open_trades = self.store.open_trades()
        stats = self.store.day_stats(day)
        if (len(open_trades) >= cfg.max_open_positions or stats["trades"] >= cfg.max_trades_per_day
                or stats["realized"] <= -cfg.daily_loss_limit_rupees):
            return "SKIPPED_ENTRY_LIMIT_REACHED", {}
        held = {t["symbol"] for t in open_trades}
        fresh = {s: c for s, c in contexts.items() if not agents.data_problems(c)}
        if not fresh:
            return "SKIPPED_STALE_DATA", {}
        candidates = {s: c for s, c in fresh.items() if s not in held
                      and agents.quant_action(c, cfg.min_signal_score)[0] in BUY_ACTIONS}
        if not candidates:
            return "SKIPPED_NO_QUANT_SETUP", {}
        return None, candidates

    def _alert_on_change(self, symbol: str, decision: dict) -> None:
        action = decision["action"]
        if self._last_actions.get(symbol) == action:
            return
        self._last_actions[symbol] = action
        level = "success" if action in ("BUY_CE", "BUY_PE") else "warning" if action == "WAIT" else "info"
        text = action.replace("_", " ")
        self.store.add_alert(level, f"{symbol} – {text} ({decision.get('strength', 'Low')}): "
                                    f"{(decision.get('reasoning') or '')[:110]}", symbol)

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
    async def control(self, actor: str, changes: dict) -> dict:
        if changes.get("auto_paper_trading"):
            raise ValueError("Simulated trading has been disabled")
        for key in ("engine_enabled", "auto_paper_trading", "kill_switch"):
            if key in changes and changes[key] is not None:
                self.store.set_state(key, bool(changes[key]))
        self.store.audit(actor, "control", changes)
        if changes.get("kill_switch"):
            self.store.add_alert("error", "KILL SWITCH engaged — entries blocked")
            await self.manage_positions(datetime.now(IST), force_reason="KILL_SWITCH")
        return self.runtime()

    # ── snapshot / health ────────────────────────────────────────────
    async def snapshot(self) -> dict:
        now = datetime.now(IST)
        day = now.strftime("%Y-%m-%d")
        spots = {s: await self._spot(s, now) for s in SYMBOLS}
        last = self.store.last_cycle()
        return {
            "generated_at": now.isoformat(), "config": self.cfg.public(), "runtime": self.runtime(),
            "session": session_state(self.cfg, now), "health": self.health(now),
            "spots": spots, "cycle": last["payload"] if last else None,
            "alerts": self.store.alerts(30), "decisions": self.store.decisions(30),
            "trades": self.store.trades(50), "open_trades": self.store.open_trades(),
            "performance": {**self.store.performance(), "today": self.store.day_stats(day)},
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
            "cycle_running": bool(self._cycle_task and not self._cycle_task.done()),
            "last_error": self.last_error, "live_execution": "LOCKED",
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


def get_orchestrator() -> AutonomiqOrchestrator:
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = AutonomiqOrchestrator()
    return _orchestrator
