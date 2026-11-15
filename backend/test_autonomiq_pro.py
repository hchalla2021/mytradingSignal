import json
import os
import sqlite3
import unittest
from datetime import datetime, time, timedelta
from unittest import mock

import httpx

from services.autonomiq_pro import agents, indicators as ind
from services.autonomiq_pro.ai_client import AIClient, AIUnavailable
from services.autonomiq_pro.config import AutonomiqConfig, load_config
from services.autonomiq_pro.market_data import IST, completed
from services.autonomiq_pro.live_risk import EntryRisk, Exposure, entry_rejections, trailing_stop
from services.autonomiq_pro.orchestrator import session_state
from services.autonomiq_pro.risk import build_plan, manage_position, validate
from services.autonomiq_pro.store import MIGRATIONS, Store

DAY = "2026-03-10"
NOW = IST.localize(datetime(2026, 3, 10, 11, 0))
CFG = AutonomiqConfig(ai_enabled=True, api_key="test-key", ai_max_retries=1)


def memory_store() -> Store:
    store = Store(":memory:")
    store.open()
    return store


def leg(symbol, ask=100.0, bid=99.5, delta=0.5, age=5.0):
    return {"tradingsymbol": symbol, "lot_size": 65, "ltp": ask, "bid": bid, "ask": ask,
            "spread_pct": round((ask - bid) * 100 / ask, 2), "trade_age_s": age, "iv": 14.0,
            "delta": delta, "gamma": 0.001, "theta": -5.0, "vega": 8.0, "oi": 1000, "volume": 500}


def chain(**ce_overrides):
    return {"atm": 22500.0, "expiry": "2026-03-12", "exchange": "NFO", "strikes": [
        {"strike": 22450.0, "CE": leg("NIFTY22450CE", ask=130, bid=129.5), "PE": leg("NIFTY22450PE", delta=-0.4)},
        {"strike": 22500.0, "CE": leg("NIFTY22500CE", **ce_overrides), "PE": leg("NIFTY22500PE", delta=-0.5)},
    ]}


def anthropic_reply(payload, usage=None):
    return httpx.Response(200, json={"content": [{"type": "text", "text": json.dumps(payload)}],
                                     "usage": usage or {"input_tokens": 1000, "output_tokens": 200},
                                     "stop_reason": "end_turn"})


class ConfigTests(unittest.TestCase):
    def test_risk_defaults_are_visible_and_used_by_loader(self):
        with mock.patch("services.autonomiq_pro.config.dotenv_values", return_value={}), \
                mock.patch.dict(os.environ, {}, clear=True):
            cfg = load_config()
        defaults = AutonomiqConfig()
        fields = ("max_risk_per_trade_rupees", "max_trades_per_day",
                  "max_open_positions", "daily_loss_limit_rupees")
        expected = (1000, 5, 3, 3000)
        self.assertEqual(tuple(getattr(defaults, field) for field in fields), expected)
        self.assertEqual(tuple(getattr(cfg, field) for field in fields), expected)
        self.assertEqual(tuple(cfg.public()[field] for field in fields), expected)

    def test_reads_owner_keys_and_routes_fable_to_events_only(self):
        env = {"AUTONOMIQ_PRO_LIVE_TRADE_ENABLED": "true", "AUTONOMIQ_PRO_DAILY_BUDGET_USD": "1.25",
               "AUTONOMIQ_PRO_MAX_OUTPUT_TOKENS": "500", "AUTONOMIQ_PRO_FABLE_EVENT_ONLY": "true",
               "AUTONOMIQ_PRO_ANTHROPIC_API_KEY": "secret-value"}
        with mock.patch("services.autonomiq_pro.config.dotenv_values", return_value={}), \
                mock.patch.dict(os.environ, env):
            cfg = load_config()
        self.assertTrue(cfg.live_trading)
        self.assertEqual((cfg.daily_budget_usd, cfg.max_output_tokens), (1.25, 500))
        self.assertEqual(cfg.model_for("EVENT"), "claude-fable-5-2")
        self.assertEqual(cfg.model_for("SCHEDULED"), "claude-sonnet-5-5")
        self.assertNotIn("secret-value", json.dumps(cfg.public()))


class IndicatorTests(unittest.TestCase):
    def test_rsi_extremes_and_completed_candle_filter(self):
        self.assertEqual(ind.rsi([float(i) for i in range(30)]), 100.0)
        candles = [{"date": "2026-03-10T10:50:00+05:30", "open": 1, "high": 2, "low": 1, "close": 2},
                   {"date": "2026-03-10T10:55:00+05:30", "open": 2, "high": 3, "low": 2, "close": 3}]
        self.assertEqual([c["date"][11:16] for c in completed(candles, 5, NOW)], ["10:50", "10:55"])
        forming = IST.localize(datetime(2026, 3, 10, 10, 58))
        self.assertEqual(len(completed(candles, 5, forming)), 1)

    def test_implied_vol_round_trips_black_scholes(self):
        price = ind.bs_price(22500, 22500, 7 / 365, 0.065, 0.15, "CE")
        self.assertAlmostEqual(ind.implied_vol(price, 22500, 22500, 7 / 365, 0.065, "CE"), 0.15, places=3)


class SessionTests(unittest.TestCase):
    def test_weekend_holiday_and_entry_window(self):
        cfg = AutonomiqConfig(extra_holidays=frozenset({DAY}))
        self.assertEqual(session_state(cfg, NOW)["phase"], "HOLIDAY")
        self.assertEqual(session_state(CFG, IST.localize(datetime(2026, 3, 14, 11, 0)))["phase"], "WEEKEND")
        self.assertEqual(session_state(CFG, NOW)["phase"], "ACTIVE")
        self.assertEqual(session_state(CFG, IST.localize(datetime(2026, 3, 10, 15, 0)))["phase"], "MANAGE_ONLY")

    def test_configured_session_and_entry_boundaries(self):
        from services.autonomiq_pro.orchestrator import next_slot

        env = {"AUTONOMIQ_PRO_MARKET_START": "09:15", "AUTONOMIQ_PRO_ENTRY_CUTOFF": "15:00",
               "AUTONOMIQ_PRO_SQUARE_OFF": "15:15", "AUTONOMIQ_PRO_MARKET_END": "15:25"}
        with mock.patch("services.autonomiq_pro.config.dotenv_values", return_value=env), \
                mock.patch.dict(os.environ, {}, clear=True):
            cfg = load_config()
        self.assertEqual(cfg.square_off, time(15, 15))
        plan = build_plan("NIFTY", "BUY_CE", chain(), atr_5m=20.0, cfg=cfg)
        for at, phase, entry_allowed in [
            (time(9, 14, 59), "PRE_MARKET", False),
            (time(9, 15), "ACTIVE", True),
            (time(15, 0), "ACTIVE", True),
            (time(15, 0, 1), "MANAGE_ONLY", False),
            (time(15, 25), "MANAGE_ONLY", False),
            (time(15, 25, 1), "CLOSED", False),
        ]:
            now = IST.localize(datetime.combine(NOW.date(), at))
            session = session_state(cfg, now)
            self.assertEqual(session["phase"], phase)
            result = validate(plan, cfg=cfg, now=now, session=session, spot={"fresh": True, "age_s": 1},
                              state={"kill_switch": False, "engine_enabled": True}, open_trades=[],
                              day_stats={"trades": 0, "realized": 0}, recent_trades=[])
            self.assertEqual(next(c["passed"] for c in result["checks"] if c["name"] == "Entry window"),
                             entry_allowed)
        start = IST.localize(datetime(2026, 3, 10, 9, 15))
        self.assertEqual(next_slot(start, 5), IST.localize(datetime(2026, 3, 10, 9, 20, 5)))


class StoreTests(unittest.TestCase):
    def test_migrates_and_rejects_duplicate_paper_signal(self):
        store = memory_store()
        self.addCleanup(store.close)
        self.assertEqual(store.migrate(), 2)
        trade = {"signal_key": "k1", "day": DAY, "symbol": "NIFTY", "exchange": "NFO", "tradingsymbol": "X",
                 "option_type": "CE", "lot_size": 65, "lots": 1, "entry": 100, "stop_loss": 85,
                 "trailing_sl": 85, "target1": 115, "target2": 130, "risk": 15}
        self.assertIsNotNone(store.open_paper_trade(trade))
        self.assertIsNone(store.open_paper_trade(trade))
        self.assertEqual(len(store.open_trades()), 1)

    def test_existing_trade_survives_quote_metadata_migration(self):
        store = Store(":memory:")
        store.conn = sqlite3.connect(":memory:", check_same_thread=False)
        store.conn.row_factory = sqlite3.Row
        self.addCleanup(store.close)
        store.conn.executescript(MIGRATIONS[0])
        store.conn.execute("PRAGMA user_version = 1")
        trade = {"signal_key": "old", "day": DAY, "symbol": "NIFTY", "exchange": "NFO", "tradingsymbol": "X",
                 "option_type": "CE", "lot_size": 65, "lots": 1, "entry": 100, "stop_loss": 85,
                 "trailing_sl": 90, "target1": 115, "target2": 130, "risk": 15}
        trade_id = store.open_paper_trade(trade)
        store.migrate()
        saved = store.open_trades()[0]
        self.assertEqual((saved["id"], saved["entry"], saved["trailing_sl"]), (trade_id, 100, 90))
        self.assertIsNone(saved["last_quote_at"])
        self.assertIsNone(saved["last_price_source"])

    def test_failed_migration_rolls_back_schema_and_version(self):
        store = Store(":memory:")
        store.conn = sqlite3.connect(":memory:", check_same_thread=False)
        store.conn.row_factory = sqlite3.Row
        self.addCleanup(store.close)
        store.conn.executescript(MIGRATIONS[0])
        store.conn.execute("PRAGMA user_version = 1")
        broken = ("ALTER TABLE paper_trades ADD COLUMN last_quote_at TEXT; "
                  "ALTER TABLE missing_table ADD COLUMN example TEXT;")
        with mock.patch("services.autonomiq_pro.store.MIGRATIONS", [MIGRATIONS[0], broken]):
            with self.assertRaises(sqlite3.OperationalError):
                store.migrate()
        columns = {row["name"] for row in store.conn.execute("PRAGMA table_info(paper_trades)")}
        self.assertNotIn("last_quote_at", columns)
        self.assertEqual(store.conn.execute("PRAGMA user_version").fetchone()[0], 1)


class AIClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_success_records_cost_including_prompt_cache(self):
        store = memory_store()
        transport = httpx.MockTransport(lambda request: anthropic_reply(
            {"ok": True}, {"input_tokens": 1000, "output_tokens": 100, "cache_read_input_tokens": 10_000}))
        result = await AIClient(store, transport).complete_json(CFG, DAY, "strategy", "claude-sonnet-5-5", "sys", {})
        self.assertEqual(result, {"ok": True})
        # (1000*2 + 10000*2*0.1 + 100*10) / 1e6
        self.assertAlmostEqual(store.ai_usage(DAY)["cost_usd"], 0.005, places=6)

    async def test_request_uses_server_key_cache_and_token_limit(self):
        seen = {}

        def handler(request):
            seen["key"] = request.headers["x-api-key"]
            seen["body"] = json.loads(request.content)
            return anthropic_reply({})
        await AIClient(memory_store(), httpx.MockTransport(handler)).complete_json(
            CFG, DAY, "strategy", "claude-fable-5-2", "sys", {"a": 1})
        self.assertEqual(seen["key"], "test-key")
        self.assertEqual(seen["body"]["max_tokens"], 500)
        self.assertEqual(seen["body"]["system"][0]["cache_control"], {"type": "ephemeral"})

    async def test_retries_overload_then_succeeds(self):
        responses = iter([httpx.Response(529, json={"error": {"type": "overloaded_error"}}), anthropic_reply({"x": 1})])
        with mock.patch("services.autonomiq_pro.ai_client.asyncio.sleep", new=mock.AsyncMock()):
            result = await AIClient(memory_store(), httpx.MockTransport(lambda r: next(responses))).complete_json(
                CFG, DAY, "strategy", "claude-sonnet-5-5", "sys", {})
        self.assertEqual(result, {"x": 1})

    async def test_auth_failure_opens_circuit_and_budget_blocks_calls(self):
        store = memory_store()
        client = AIClient(store, httpx.MockTransport(lambda r: httpx.Response(401, json={})))
        with self.assertRaises(AIUnavailable):
            await client.complete_json(CFG, DAY, "strategy", "claude-sonnet-5-5", "sys", {})
        self.assertEqual(client.status(CFG, DAY), "CIRCUIT_OPEN")

        store.record_ai_call(DAY, "strategy", "m", "OK", cost_usd=1.25)
        self.assertEqual(AIClient(store).status(CFG, DAY), "DAILY_BUDGET_EXHAUSTED")

    async def test_unparseable_output_is_bad_output(self):
        transport = httpx.MockTransport(lambda r: httpx.Response(200, json={
            "content": [{"type": "text", "text": "no json"}], "usage": {}}))
        with self.assertRaisesRegex(AIUnavailable, "BAD_OUTPUT"):
            await AIClient(memory_store(), transport).complete_json(CFG, DAY, "s", "claude-sonnet-5-5", "sys", {})


class OrchestratorTests(unittest.IsolatedAsyncioTestCase):
    async def test_stale_cycle_makes_no_ai_call_and_snapshot_serialises(self):
        from services.autonomiq_pro.orchestrator import AutonomiqOrchestrator

        class StaleCollector:
            async def spot(self, symbol, now):
                return {"price": 22500.0, "age_s": 300.0}

            def collect_sync(self, symbol, spot_price, now):
                return {"symbol": symbol, "errors": ["candles: TokenException"], "candles": {},
                        "futures": None, "options": None}

        store = memory_store()
        transport = httpx.MockTransport(lambda r: self.fail("AI must not be called on stale data"))
        engine = AutonomiqOrchestrator(store, StaleCollector(), AIClient(store, transport))
        engine.cfg = CFG
        payload = await engine.run_cycle("SCHEDULED")
        self.assertEqual({i["signal"]["action"] for i in payload["indices"].values()}, {"NO_TRADE"})
        self.assertEqual(store.ai_usage(DAY[:4])["calls"], 0)
        with mock.patch("services.autonomiq_pro.orchestrator.load_config", return_value=CFG):
            json.dumps(await engine.snapshot(), default=str)

    async def test_paper_marks_record_the_timestamp_and_source_of_the_price_used(self):
        from services.autonomiq_pro.orchestrator import AutonomiqOrchestrator

        class Collector:
            quote = {}

            def quote_contracts(self, keys):
                return {"NFO:X": self.quote}

        collector = Collector()
        store = memory_store()
        self.addCleanup(store.close)
        store.open_paper_trade(
            {"signal_key": "quote", "day": DAY, "symbol": "NIFTY", "exchange": "NFO", "tradingsymbol": "X",
             "option_type": "CE", "lot_size": 65, "lots": 1, "entry": 100, "stop_loss": 85,
             "trailing_sl": 85, "target1": 115, "target2": 130, "risk": 15})
        engine = AutonomiqOrchestrator(store, collector)
        engine.cfg = CFG

        bid_at = NOW - timedelta(seconds=2)
        trade_at = NOW - timedelta(seconds=20)
        collector.quote = {"depth": {"buy": [{"price": 110}]}, "last_price": 109,
                           "timestamp": bid_at, "last_trade_time": trade_at}
        await engine.manage_positions(NOW)
        saved = store.open_trades()[0]
        self.assertEqual((saved["last_price"], saved["last_quote_at"], saved["last_price_source"]),
                         (110, bid_at.isoformat(), "BID"))

        collector.quote = {"depth": {"buy": []}, "last_price": 112, "timestamp": bid_at,
                           "last_trade_time": trade_at}
        await engine.manage_positions(NOW)
        saved = store.open_trades()[0]
        self.assertEqual((saved["last_price"], saved["last_quote_at"], saved["last_price_source"]),
                         (112, trade_at.isoformat(), "LAST_TRADE"))

        collector.quote = {"depth": {"buy": [{"price": 113}]}, "last_price": 112}
        await engine.manage_positions(NOW)
        saved = store.open_trades()[0]
        self.assertEqual(saved["last_price"], 113)
        self.assertIsNone(saved["last_quote_at"])
        self.assertEqual(saved["last_price_source"], "BID")


class AICostGateTests(unittest.IsolatedAsyncioTestCase):
    def ctx(self, score=70.0, fresh=True):
        return {"spot": {"fresh": fresh, "price": 22500.0},
                "data": {"candles": {"5m": [1], "15m": [1]}, "options": {"atm": 1}},
                "quant": {"score": score, "bias": "BULLISH", "flags": []}}

    def engine(self):
        from services.autonomiq_pro.orchestrator import AutonomiqOrchestrator
        store = memory_store()
        self.addCleanup(store.close)
        engine = AutonomiqOrchestrator(store, object(), AIClient(store))
        engine.cfg = CFG
        return engine

    def gate(self, engine, contexts, trigger="SCHEDULED", now=NOW):
        return engine._ai_gate(CFG, now, DAY, session_state(CFG, now), trigger, contexts)

    def test_slots_align_to_candle_close(self):
        from services.autonomiq_pro.orchestrator import next_slot, slot_start
        at = IST.localize(datetime(2026, 3, 10, 9, 21, 30))
        self.assertEqual(slot_start(at, 5), IST.localize(datetime(2026, 3, 10, 9, 20)))
        self.assertEqual(next_slot(at, 5), IST.localize(datetime(2026, 3, 10, 9, 25, 5)))

    def test_ai_only_for_scheduled_fresh_enterable_quant_setups(self):
        engine = self.engine()
        setup = {"NIFTY": self.ctx(), "BANKNIFTY": self.ctx(score=10), "SENSEX": self.ctx(fresh=False)}
        self.assertEqual(self.gate(engine, setup, "MANUAL"), ("SKIPPED_MANUAL_QUANT_ONLY", {}))
        self.assertEqual(self.gate(engine, {"NIFTY": self.ctx(score=10)})[0], "SKIPPED_NO_QUANT_SETUP")
        self.assertEqual(self.gate(engine, {"NIFTY": self.ctx(fresh=False)})[0], "SKIPPED_STALE_DATA")
        self.assertEqual(list(self.gate(engine, setup)[1]), ["NIFTY"])

        engine.store.open_paper_trade(
            {"signal_key": "held", "day": DAY, "symbol": "NIFTY", "exchange": "NFO", "tradingsymbol": "X",
             "option_type": "CE", "lot_size": 65, "lots": 1, "entry": 100, "stop_loss": 85,
             "trailing_sl": 85, "target1": 115, "target2": 130, "risk": 15})
        self.assertEqual(self.gate(engine, setup)[0], "SKIPPED_NO_QUANT_SETUP")

    async def test_one_ai_call_per_slot_and_manual_refresh_spends_nothing(self):
        from services.autonomiq_pro.orchestrator import slot_start
        engine = self.engine()
        engine.store.set_state("ai_slot", slot_start(NOW, CFG.analysis_interval_minutes).isoformat())
        self.assertEqual(self.gate(engine, {"NIFTY": self.ctx()})[0], "SKIPPED_SLOT_ALREADY_ANALYZED")

        scheduled = NOW + timedelta(minutes=2)
        engine.next_run_at = scheduled
        with mock.patch.object(engine, "_guarded_cycle", new=mock.AsyncMock()):
            self.assertTrue(engine.trigger("MANUAL"))
            await engine._cycle_task
        self.assertEqual(engine.next_run_at, scheduled)

    async def test_approved_signal_spends_one_ai_call_without_opening_a_simulated_trade(self):
        class FreshCollector:
            async def spot(self, symbol, now):
                return {"price": 22500.0, "age_s": 1.0}

            def collect_sync(self, symbol, spot_price, now):
                return {"symbol": symbol, "errors": [], "candles": {"5m": [1], "15m": [1]},
                        "futures": None, "options": chain()}

        calls = []

        def handler(request):
            calls.append(json.loads(request.content))
            return anthropic_reply({"market_alert": {"tone": "BULLISH", "title": "t", "detail": "d"},
                                    "summary": "s", "indices": {"NIFTY": {"action": "BUY_CE", "conviction": 80,
                                                                          "reasoning": "r", "risks": []}}})

        def quant(analysis, data):
            score = 80.0 if data["symbol"] == "NIFTY" else 10.0
            return {"score": score, "bias": "BULLISH", "flags": [], "factors": [], "pcr": 1.0, "atm_iv": 14.0}

        from services.autonomiq_pro.orchestrator import AutonomiqOrchestrator
        store = memory_store()
        self.addCleanup(store.close)
        engine = AutonomiqOrchestrator(store, FreshCollector(), AIClient(store, httpx.MockTransport(handler)))
        engine.cfg = CFG
        store.set_state("auto_paper_trading", True)
        with mock.patch.object(agents.MarketAnalysisAgent, "run", return_value={"atr_5m": 20.0}), \
                mock.patch.object(agents.QuantResearchAgent, "run", side_effect=quant):
            payload = await engine._analyze(CFG, NOW, DAY, session_state(CFG, NOW), "SCHEDULED",
                                            store.start_cycle("SCHEDULED"))
            again = await engine._analyze(CFG, NOW, DAY, session_state(CFG, NOW), "SCHEDULED",
                                          store.start_cycle("SCHEDULED"))

        self.assertTrue(payload["indices"]["NIFTY"]["signal"]["risk"]["approved"])
        self.assertFalse(engine.runtime()["auto_paper_trading"])
        self.assertEqual(store.open_trades(), [])
        self.assertEqual(len(calls), 1)
        self.assertEqual(list(json.loads(calls[0]["messages"][0]["content"])["indices"]), ["NIFTY"])
        self.assertEqual(again["ai_state"], "SKIPPED_SLOT_ALREADY_ANALYZED")
        self.assertEqual(store.ai_usage(DAY)["calls"], 1)

    async def test_simulated_trading_cannot_be_reenabled(self):
        engine = self.engine()
        with self.assertRaisesRegex(ValueError, "disabled"):
            await engine.control("owner", {"engine_enabled": False, "auto_paper_trading": True})
        self.assertTrue(engine.runtime()["engine_enabled"])
        self.assertFalse(engine.runtime()["auto_paper_trading"])

    async def test_start_disables_persisted_simulated_trading_without_deleting_positions(self):
        engine = self.engine()
        engine.store.set_state("auto_paper_trading", True)
        engine.store.open_paper_trade(
            {"signal_key": "legacy", "day": DAY, "symbol": "NIFTY", "exchange": "NFO", "tradingsymbol": "X",
             "option_type": "CE", "lot_size": 65, "lots": 1, "entry": 100, "stop_loss": 85,
             "trailing_sl": 85, "target1": 115, "target2": 130, "risk": 15})
        await engine.start()
        try:
            self.assertFalse(engine.store.get_state("auto_paper_trading"))
            self.assertEqual(len(engine.store.open_trades()), 1)
        finally:
            await engine.stop()

    async def test_control_endpoint_rejects_enabling_simulated_trading(self):
        from fastapi import FastAPI
        from routers import autonomiq_pro

        app = FastAPI()
        app.include_router(autonomiq_pro.router)
        app.dependency_overrides[autonomiq_pro.owner] = lambda: "owner"
        with mock.patch.object(autonomiq_pro, "_service") as service:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                response = await client.post("/api/autonomiq-pro/control",
                                             json={"engine_enabled": False, "auto_paper_trading": True})
        self.assertEqual(response.status_code, 409)
        service.assert_not_called()


class SignalValidationTests(unittest.TestCase):
    def ctx(self, score=70.0, fresh=True):
        return {"spot": {"fresh": fresh}, "data": {"candles": {"5m": [1], "15m": [1]}, "options": {"atm": 1}},
                "quant": {"score": score, "bias": "BULLISH", "flags": []}}

    def test_ai_cannot_override_quant_direction(self):
        ai = {"action": "BUY_PE", "conviction": 90, "reasoning": "x", "risks": []}
        signal = agents.SignalValidationAgent().run("NIFTY", self.ctx(), ai, 60, True, "ACTIVE")
        self.assertEqual(signal["action"], "WAIT")

    def test_stale_data_is_no_trade_and_missing_ai_waits(self):
        validator = agents.SignalValidationAgent()
        self.assertEqual(validator.run("NIFTY", self.ctx(fresh=False), None, 60, True, "X")["action"], "NO_TRADE")
        self.assertEqual(validator.run("NIFTY", self.ctx(), None, 60, True, "DISABLED")["action"], "WAIT")

    def test_malformed_ai_action_degrades_to_wait(self):
        out = agents.normalize_strategy({"indices": {"nifty": {"action": "SELL EVERYTHING", "conviction": "x"}}})
        self.assertEqual(out["indices"]["NIFTY"]["action"], "WAIT")


class LiveRiskCalculationTests(unittest.TestCase):
    zero_pnl = {"NIFTY": 0.0, "BANKNIFTY": 0.0, "SENSEX": 0.0}

    def candidate(self, **overrides):
        values = dict(symbol="NIFTY", entry=100.0, stop=94.0, quantity=50, lot_size=50,
                      estimated_round_trip_cost=50.0, estimated_exit_slippage=50.0)
        return EntryRisk(**{**values, **overrides})

    def rejections(self, candidate, **kwargs):
        return entry_rejections(candidate, cfg=CFG, **kwargs)

    def test_loss_includes_costs_and_exact_trade_limit(self):
        candidate = self.candidate(stop=82.0)
        self.assertEqual(candidate.estimated_loss(), 1000.0)
        self.assertEqual(self.rejections(candidate, realized_net=self.zero_pnl, exposures=[], pending=[], trades_today=0), [])
        reasons = self.rejections(self.candidate(stop=81.95), realized_net=self.zero_pnl, exposures=[],
                                  pending=[], trades_today=0)
        self.assertIn("Estimated per-trade loss exceeds ₹1,000", reasons)
        with self.assertRaisesRegex(ValueError, "one lot"):
            self.candidate(quantity=100).estimated_loss()

    def test_independent_and_global_loss_limits_include_pending_risk(self):
        candidate = self.candidate()
        reasons = self.rejections(candidate, realized_net={**self.zero_pnl, "NIFTY": -700},
                                  exposures=[], pending=[], trades_today=1)
        self.assertIn("Index daily loss budget exhausted or reserved", reasons)
        reasons = self.rejections(candidate, realized_net={**self.zero_pnl, "BANKNIFTY": -900, "SENSEX": -900},
                                  exposures=[Exposure("BANKNIFTY", -200, 300)],
                                  pending=[Exposure("SENSEX", 0, 400)], trades_today=2)
        self.assertIn("Global daily loss budget exhausted or reserved", reasons)
        self.assertNotIn("Index daily loss budget exhausted or reserved", reasons)

    def test_duplicate_position_and_pending_entries_block_limits(self):
        reasons = self.rejections(self.candidate(), realized_net=self.zero_pnl,
                                  exposures=[Exposure("NIFTY", 10, 100)],
                                  pending=[Exposure("BANKNIFTY", 0, 100), Exposure("SENSEX", 0, 100)],
                                  trades_today=3)
        self.assertIn("Global position limit reached", reasons)
        self.assertIn("Index already has an open position or pending entry", reasons)
        self.assertIn("Daily trade limit reached", reasons)

    def test_invalid_inputs_are_not_accepted(self):
        with self.assertRaises(ValueError):
            self.candidate(estimated_round_trip_cost=float("nan")).estimated_loss()
        with self.assertRaises(ValueError):
            self.rejections(self.candidate(), realized_net=self.zero_pnl, exposures=[Exposure("NIFTY", 0, -1)],
                            pending=[], trades_today=0)
        with self.assertRaisesRegex(ValueError, "every index"):
            self.rejections(self.candidate(), realized_net={}, exposures=[], pending=[], trades_today=0)

    def test_entry_checks_follow_configured_limits(self):
        cfg = AutonomiqConfig(max_risk_per_trade_rupees=300, max_open_positions=1,
                              max_trades_per_day=1, daily_loss_limit_rupees=500)
        reasons = entry_rejections(self.candidate(), cfg=cfg, realized_net=self.zero_pnl,
                                   exposures=[Exposure("SENSEX", -200, 0)], pending=[], trades_today=1)
        self.assertIn("Estimated per-trade loss exceeds ₹300", reasons)
        self.assertIn("Global daily loss budget exhausted or reserved", reasons)
        self.assertIn("Global position limit reached", reasons)
        self.assertIn("Daily trade limit reached", reasons)

    def test_trailing_starts_at_cost_inclusive_one_r_and_never_loosens(self):
        args = dict(entry=100.0, initial_stop=94.0, current_stop=94.0, highest_bid=107.95,
                    current_bid=107.95, option_atr=2.0, quantity=50, estimated_round_trip_cost=50.0,
                    estimated_exit_slippage=50.0, tick_size=0.05)
        before = trailing_stop(**args)
        self.assertFalse(before.activated)
        self.assertEqual(before.stop, 94.0)
        active = trailing_stop(**{**args, "highest_bid": 108.0, "current_bid": 108.0})
        self.assertTrue(active.activated)
        self.assertEqual(active.stop, 104.0)
        tightened = trailing_stop(**{**args, "highest_bid": 115.0, "current_bid": 114.0,
                                    "current_stop": 112.0})
        self.assertEqual(tightened.stop, 112.0)
        self.assertFalse(tightened.exit_required)

    def test_stop_crossing_requires_exit_instead_of_invalid_trigger(self):
        decision = trailing_stop(entry=100, initial_stop=94, current_stop=94, highest_bid=110,
                                 current_bid=101, option_atr=2, quantity=50,
                                 estimated_round_trip_cost=50, estimated_exit_slippage=50, tick_size=0.05)
        self.assertEqual(decision.stop, 106)
        self.assertTrue(decision.exit_required)


class RiskTests(unittest.TestCase):
    def evaluate(self, plan, **overrides):
        args = dict(cfg=CFG, now=NOW, session=session_state(CFG, NOW), spot={"fresh": True, "age_s": 1},
                    state={"kill_switch": False, "engine_enabled": True}, open_trades=[],
                    day_stats={"trades": 0, "realized": 0}, recent_trades=[])
        args.update(overrides)
        return validate(plan, **args)

    def test_plan_uses_live_ask_and_passes_risk_engine(self):
        plan = build_plan("NIFTY", "BUY_CE", chain(), atr_5m=20.0, cfg=CFG)
        self.assertEqual(plan["tradingsymbol"], "NIFTY22500CE")
        self.assertEqual((plan["entry"], plan["stop_loss"], plan["target1"], plan["target2"]), (100, 85, 115, 130))
        self.assertTrue(self.evaluate(plan)["approved"])

    def test_wide_spread_falls_back_to_itm_and_stale_quotes_reject(self):
        plan = build_plan("NIFTY", "BUY_CE", chain(bid=90.0), atr_5m=20.0, cfg=CFG)
        self.assertEqual(plan["tradingsymbol"], "NIFTY22450CE")
        stale = {"atm": 22500.0, "expiry": "x", "exchange": "NFO",
                 "strikes": [{"strike": 22500.0, "CE": leg("A", age=999)}]}
        self.assertIn("error", build_plan("NIFTY", "BUY_CE", stale, 20.0, CFG))

    def test_blocks_kill_switch_duplicates_and_loss_limit(self):
        plan = build_plan("NIFTY", "BUY_CE", chain(), atr_5m=20.0, cfg=CFG)
        failed = lambda result: {c["name"] for c in result["checks"] if not c["passed"]}
        self.assertIn("Kill switch off", failed(self.evaluate(plan, state={"kill_switch": True})))
        open_trade = {"symbol": "NIFTY", "entry": 100, "last_price": 100, "lot_size": 65, "lots": 1}
        self.assertIn("No duplicate position", failed(self.evaluate(plan, open_trades=[open_trade])))
        self.assertIn("Daily loss limit", failed(self.evaluate(plan, day_stats={"trades": 1, "realized": -6000})))
        late = IST.localize(datetime(2026, 3, 10, 15, 0))
        self.assertIn("Entry window", failed(self.evaluate(plan, now=late)))

    def test_analysis_enforces_requested_limits_at_boundaries(self):
        plan = build_plan("NIFTY", "BUY_CE", chain(), atr_5m=20.0, cfg=CFG)

        def passes(result, name):
            return next(check["passed"] for check in result["checks"] if check["name"] == name)

        self.assertTrue(passes(self.evaluate({**plan, "risk_rupees": 1000}), "Risk per trade"))
        self.assertFalse(passes(self.evaluate({**plan, "risk_rupees": 1000.01}), "Risk per trade"))
        self.assertTrue(passes(self.evaluate(plan, day_stats={"trades": 4, "realized": -2999}), "Daily trade limit"))
        self.assertFalse(passes(self.evaluate(plan, day_stats={"trades": 5, "realized": 0}), "Daily trade limit"))
        self.assertFalse(passes(self.evaluate(plan, day_stats={"trades": 0, "realized": -3000}), "Daily loss limit"))
        held = [{"symbol": symbol, "entry": 100, "last_price": 100, "lot_size": 1, "lots": 1}
                for symbol in ("BANKNIFTY", "SENSEX")]
        self.assertTrue(passes(self.evaluate(plan, open_trades=held), "Position limit"))
        self.assertFalse(passes(self.evaluate(plan, open_trades=held + [dict(held[0])]), "Position limit"))
        self.assertFalse(passes(self.evaluate(plan, open_trades=[{**held[0], "symbol": "NIFTY"}]),
                                "No duplicate position"))


class PaperPositionTests(unittest.TestCase):
    trade = {"entry": 100.0, "risk": 15.0, "stop_loss": 85.0, "trailing_sl": 85.0, "target1": 115.0,
             "target2": 130.0, "lot_size": 65, "lots": 1}

    def test_trails_to_breakeven_then_exits_on_trailing_stop(self):
        at_t1 = manage_position(self.trade, 116.0, time(11), time(15, 15))
        self.assertNotIn("status", at_t1)
        self.assertEqual(at_t1["trailing_sl"], 101.0)
        exit_ = manage_position({**self.trade, "trailing_sl": at_t1["trailing_sl"]}, 100.5, time(11), time(15, 15))
        self.assertEqual((exit_["exit_reason"], exit_["pnl"]), ("TRAILING_SL", 32.5))

    def test_stop_target_and_square_off(self):
        self.assertEqual(manage_position(self.trade, 84.0, time(11), time(15, 15))["exit_reason"], "STOP_LOSS")
        self.assertEqual(manage_position(self.trade, 131.0, time(11), time(15, 15))["exit_reason"], "TARGET2")
        self.assertEqual(manage_position(self.trade, 101.0, time(15, 16), time(15, 15))["exit_reason"], "SQUARE_OFF")


if __name__ == "__main__":
    unittest.main()
