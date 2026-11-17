import json
import os
import sqlite3
import threading
import unittest
from datetime import datetime, time, timedelta
from types import SimpleNamespace
from unittest import mock

import httpx
from kiteconnect.exceptions import NetworkException, PermissionException, TokenException

from services.autonomiq_pro import agents, indicators as ind
from services.autonomiq_pro.ai_client import AIClient, AIUnavailable
from services.autonomiq_pro.config import AutonomiqConfig, load_config
from services.autonomiq_pro.market_data import IST, MarketDataCollector, completed
from services.autonomiq_pro.live_risk import EntryRisk, Exposure, entry_rejections, trailing_stop
from services.autonomiq_pro.live_executor import LiveOrderExecutor
from services.autonomiq_pro.orchestrator import analysis_window_open, session_state
from services.autonomiq_pro.risk import build_plan, hybrid_levels, manage_position, validate
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


def execution_history(price=100, half_range=3.33):
    return [{"date": (NOW - timedelta(minutes=5 * (20 - i))).isoformat(),
             "open": price, "high": price + half_range, "low": price - half_range,
             "close": price, "volume": 1000} for i in range(20)]


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
                  "max_open_positions", "daily_loss_limit_rupees", "index_daily_loss_limit_rupees")
        expected = (1000, 5, 3, 3000, 1000)
        self.assertEqual(tuple(getattr(defaults, field) for field in fields), expected)
        self.assertEqual(tuple(getattr(cfg, field) for field in fields), expected)
        self.assertEqual(tuple(cfg.public()[field] for field in fields), expected)
        self.assertEqual(cfg.model_for("SCHEDULED"), "claude-fable-5-2")
        self.assertEqual(cfg.model_for("EVENT"), "claude-fable-5-2")
        self.assertFalse(cfg.fable_event_only)

    def test_deployment_mode_gates_live_execution_and_routes_fable_to_events_only(self):
        env = {"AUTONOMIQ_PRO_LIVE_TRADE_ENABLED": "true", "AUTONOMIQ_PRO_DEPLOYMENT_MODE": "local",
               "AUTONOMIQ_PRO_DAILY_BUDGET_USD": "1.25",
               "AUTONOMIQ_PRO_MAX_OUTPUT_TOKENS": "500", "AUTONOMIQ_PRO_FABLE_EVENT_ONLY": "true",
               "AUTONOMIQ_PRO_PRIMARY_MODEL": "claude-sonnet-5-5",
               "AUTONOMIQ_PRO_ANTHROPIC_API_KEY": "secret-value"}
        with mock.patch("services.autonomiq_pro.config.dotenv_values", return_value={}), \
                mock.patch.dict(os.environ, env):
            cfg = load_config()
        self.assertFalse(cfg.live_execution_allowed)
        self.assertEqual(cfg.deployment_mode, "local")
        self.assertEqual((cfg.daily_budget_usd, cfg.max_output_tokens), (1.25, 500))
        self.assertEqual(cfg.model_for("EVENT"), "claude-fable-5-2")
        self.assertEqual(cfg.model_for("SCHEDULED"), "claude-sonnet-5-5")
        self.assertNotIn("secret-value", json.dumps(cfg.public()))
        with mock.patch("services.autonomiq_pro.config.dotenv_values", return_value={}), \
                mock.patch.dict(os.environ, {"AUTONOMIQ_PRO_DEPLOYMENT_MODE": "production"}, clear=True):
            self.assertTrue(load_config().live_execution_allowed)

    def test_analysis_schedule_is_fixed_at_nine_every_five_minutes(self):
        env = {"AUTONOMIQ_PRO_ANALYSIS_START": "10:00", "AUTONOMIQ_PRO_ANALYSIS_INTERVAL": "1"}
        with mock.patch("services.autonomiq_pro.config.dotenv_values", return_value=env), \
                mock.patch.dict(os.environ, {}, clear=True):
            cfg = load_config()
        self.assertEqual(cfg.analysis_start, time(9, 0))
        self.assertEqual(cfg.analysis_interval_minutes, 5)
        self.assertEqual(cfg.public()["analysis_start"], "09:00")
        self.assertEqual(cfg.public()["analysis_end"], "15:20")

    def test_local_live_requires_explicit_opt_in_and_unknown_modes_stay_blocked(self):
        for mode, opt_in, expected in (
            ("local", None, False), ("local", "false", False), ("local", "true", True),
            ("local", "invalid", False), ("production", None, True), ("development", "true", False),
        ):
            with self.subTest(mode=mode, opt_in=opt_in):
                env = {"AUTONOMIQ_PRO_DEPLOYMENT_MODE": mode}
                if opt_in is not None:
                    env["AUTONOMIQ_PRO_ALLOW_LOCAL_LIVE"] = opt_in
                with mock.patch("services.autonomiq_pro.config.dotenv_values", return_value={}), \
                        mock.patch.dict(os.environ, env, clear=True):
                    cfg = load_config()
                self.assertEqual(cfg.live_execution_allowed, expected)
                self.assertEqual(cfg.public()["live_execution_allowed"], expected)

    def test_index_daily_budget_override_is_explicit_and_invalid_values_fail_closed(self):
        for mode, value, expected in (("local", "2000", 2000), ("production", None, 1000)):
            with self.subTest(mode=mode):
                env = {"AUTONOMIQ_PRO_DEPLOYMENT_MODE": mode, "AUTONOMIQ_PRO_MAX_RISK_PER_TRADE_RUPEES": "2000"}
                if value is not None:
                    env["AUTONOMIQ_PRO_INDEX_DAILY_LOSS_LIMIT_RUPEES"] = value
                with mock.patch("services.autonomiq_pro.config.dotenv_values", return_value=env), \
                        mock.patch.dict(os.environ, {}, clear=True):
                    cfg = load_config()
                self.assertEqual(cfg.index_daily_loss_limit_rupees, expected)
                self.assertEqual(cfg.public()["index_daily_loss_limit_rupees"], expected)
        for value in ("nan", "inf", "-1", "invalid"):
            with self.subTest(value=value), \
                    mock.patch("services.autonomiq_pro.config.dotenv_values", return_value={
                        "AUTONOMIQ_PRO_INDEX_DAILY_LOSS_LIMIT_RUPEES": value}), \
                    mock.patch.dict(os.environ, {}, clear=True):
                with self.assertRaisesRegex(ValueError, "INDEX_DAILY_LOSS_LIMIT_RUPEES"):
                    load_config()

    def test_analysis_runs_through_1520_but_entry_window_remains_separate(self):
        cfg = AutonomiqConfig()
        start = IST.localize(datetime.combine(NOW.date(), time(9, 0)))
        manage_only = IST.localize(datetime.combine(NOW.date(), time(15, 20)))
        after_end = IST.localize(datetime.combine(NOW.date(), time(15, 25)))
        self.assertTrue(analysis_window_open(start, cfg, session_state(cfg, start)))
        self.assertTrue(analysis_window_open(manage_only, cfg, session_state(cfg, manage_only)))
        self.assertFalse(analysis_window_open(after_end, cfg, session_state(cfg, after_end)))


class IndicatorTests(unittest.TestCase):
    def test_execution_history_caches_completed_bars_and_rejects_stale_or_invalid_history(self):
        gateway = mock.Mock()
        gateway.historical.return_value = [*execution_history(), {
            **execution_history()[-1], "date": NOW.isoformat(), "high": 9999,
        }]
        collector = MarketDataCollector(gateway)
        first = collector._execution_candles(11, NOW)
        self.assertEqual(len(first), 20)
        self.assertLess(max(c["high"] for c in first), 200)
        self.assertEqual(collector._execution_candles(11, NOW + timedelta(seconds=20)), first)
        self.assertEqual(gateway.historical.call_count, 1)
        with self.assertRaisesRegex(ValueError, "Latest completed"):
            collector._execution_candles(11, NOW + timedelta(minutes=10))
        gateway.historical.return_value = execution_history()
        gateway.historical.return_value[-1]["low"] = float("nan")
        with self.assertRaisesRegex(ValueError, "OHLC"):
            collector._execution_candles(12, NOW)

    def test_collector_supplies_enough_full_hourly_bars_for_ema50(self):
        def historical(token, start, end, interval):
            minutes = 15 if interval == "15minute" else 5
            candles = []
            day = start.replace(hour=9, minute=15, second=0, microsecond=0)
            while day <= end:
                if day.weekday() < 5:
                    for offset in range(0, 375, minutes):
                        at = day + timedelta(minutes=offset)
                        if start <= at and at + timedelta(minutes=minutes) <= end:
                            price = 22000 + len(candles)
                            candles.append({"date": at, "open": price, "high": price + 2,
                                            "low": price - 2, "close": price + 1, "volume": 1})
                day += timedelta(days=1)
            return candles

        gateway = mock.Mock()
        gateway.historical.side_effect = historical
        gateway.instruments.return_value = []
        data = MarketDataCollector(gateway).collect_sync("NIFTY", None, NOW)
        analysis = agents.MarketAnalysisAgent().run(data, DAY)
        self.assertIsNotNone(analysis["timeframes"]["60m"])
        self.assertEqual(analysis["timeframes"]["60m"]["trend"], "UP")

    def test_hourly_resample_does_not_promote_partial_previous_session(self):
        candles = [
            {"date": (start + timedelta(minutes=15 * i)).isoformat(),
             "open": 100, "high": 102, "low": 99, "close": 101, "volume": 1}
            for start, count in [(NOW.replace(day=9, hour=9, minute=15), 5),
                                 (NOW.replace(hour=9, minute=15), 4)]
            for i in range(count)
        ]
        self.assertEqual([c["volume"] for c in ind.resample(candles, 4)], [4, 4])

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


class StreamedOptionQuoteTests(unittest.TestCase):
    def test_only_the_matching_fresh_full_depth_option_is_used(self):
        from services.aqte_engine import Contract, Tick

        contract = Contract("NIFTY", 91, "HELDCE", "NFO", "CE", 22500, "2026-03-12", 65, .05)
        market = SimpleNamespace(lock=threading.Lock(), engine=SimpleNamespace(
            contracts={91: contract}, options={}))
        collector = MarketDataCollector(mock.Mock())
        with mock.patch("services.aqte_service.get_aqte_service", return_value=market):
            for exchange_age, receipt_age, bid_qty in ((1, .2, 65), (6, .2, 65), (1, 6, 65),
                                                       (-4, .2, 65), (1, .2, 0)):
                market.engine.options[91] = Tick(
                    "NIFTY", "option", 91, 112.5, NOW.timestamp() - exchange_age,
                    NOW.timestamp() - receipt_age, bid=112, ask=113, bid_quantity=bid_qty,
                    ask_quantity=65,
                )
                quote = collector.cached_option_quote("NFO", "HELDCE", NOW)
                if (exchange_age, receipt_age, bid_qty) == (1, .2, 65):
                    self.assertEqual(quote["depth"]["buy"][0]["price"], 112)
                    self.assertEqual(quote["timestamp"], NOW - timedelta(seconds=1))
                else:
                    self.assertIsNone(quote)
            self.assertIsNone(collector.cached_option_quote("BFO", "HELDCE", NOW))
            self.assertIsNone(collector.cached_option_quote("NFO", "OTHERCE", NOW))
        collector.gateway.quote.assert_not_called()


class SessionTests(unittest.TestCase):
    def test_weekend_holiday_and_entry_window(self):
        cfg = AutonomiqConfig(extra_holidays=frozenset({DAY}))
        self.assertEqual(session_state(cfg, NOW)["phase"], "HOLIDAY")
        self.assertEqual(session_state(CFG, IST.localize(datetime(2026, 3, 14, 11, 0)))["phase"], "WEEKEND")
        self.assertEqual(session_state(CFG, NOW)["phase"], "ACTIVE")
        self.assertEqual(session_state(CFG, IST.localize(datetime(2026, 3, 10, 15, 0)))["phase"], "MANAGE_ONLY")

    def test_configured_session_and_entry_boundaries(self):
        from services.autonomiq_pro.orchestrator import next_slot

        env = {"AUTONOMIQ_PRO_MARKET_START": "09:20", "AUTONOMIQ_PRO_ENTRY_CUTOFF": "14:45",
               "AUTONOMIQ_PRO_SQUARE_OFF": "15:15", "AUTONOMIQ_PRO_MARKET_END": "15:25"}
        with mock.patch("services.autonomiq_pro.config.dotenv_values", return_value=env), \
                mock.patch.dict(os.environ, {}, clear=True):
            cfg = load_config()
        self.assertEqual(cfg.market_start, time(9, 20))
        self.assertEqual(cfg.entry_cutoff, time(14, 45))
        self.assertEqual(cfg.square_off, time(15, 15))
        plan = build_plan("NIFTY", "BUY_CE", chain(), atr_5m=20.0, cfg=cfg)
        for at, phase, entry_allowed in [
            (time(9, 19, 59), "PRE_MARKET", False),
            (time(9, 20), "ACTIVE", True),
            (time(14, 45), "ACTIVE", True),
            (time(14, 45, 1), "MANAGE_ONLY", False),
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
        preopen = IST.localize(datetime.combine(NOW.date(), time(9, 5)))
        preopen_plan = build_plan("NIFTY", "BUY_CE", chain(), atr_5m=20.0, cfg=AutonomiqConfig())
        preopen_result = validate(preopen_plan, cfg=AutonomiqConfig(), now=preopen,
                                  session=session_state(AutonomiqConfig(), preopen),
                                  spot={"fresh": True, "age_s": 1},
                                  state={"kill_switch": False, "engine_enabled": True}, open_trades=[],
                                  day_stats={"trades": 0, "realized": 0}, recent_trades=[])
        self.assertFalse(next(c["passed"] for c in preopen_result["checks"] if c["name"] == "Entry window"))
        start = IST.localize(datetime(2026, 3, 10, 9, 20))
        self.assertEqual(next_slot(start, 5), IST.localize(datetime(2026, 3, 10, 9, 25, 5)))


class StoreTests(unittest.TestCase):
    def test_scheduled_lookup_survives_manual_failed_and_running_cycles(self):
        store = memory_store()
        self.addCleanup(store.close)
        scheduled_id = store.start_cycle("SCHEDULED")
        store.finish_cycle(scheduled_id, "OK", payload={"at": NOW.isoformat()})
        manual_id = store.start_cycle("MANUAL")
        store.finish_cycle(manual_id, "OK", payload={"at": NOW.isoformat()})
        store.finish_cycle(store.start_cycle("SCHEDULED"), "FAILED", error="TokenException")
        running_id = store.start_cycle("SCHEDULED")
        self.assertEqual(store.last_cycle()["id"], manual_id)
        self.assertEqual(store.last_cycle(trigger="SCHEDULED")["id"], scheduled_id)
        self.assertEqual(store.last_cycle(False, trigger="SCHEDULED")["id"], running_id)

    def test_migrates_and_rejects_duplicate_paper_signal(self):
        store = memory_store()
        self.addCleanup(store.close)
        self.assertEqual(store.migrate(), len(MIGRATIONS))
        trade = {"signal_key": "k1", "day": DAY, "symbol": "NIFTY", "exchange": "NFO", "tradingsymbol": "X",
                 "option_type": "CE", "lot_size": 65, "lots": 1, "entry": 100, "stop_loss": 85,
                 "trailing_sl": 85, "target1": 115, "target2": 130, "risk": 15}
        self.assertIsNotNone(store.open_paper_trade(trade))
        self.assertIsNone(store.open_paper_trade(trade))
        self.assertEqual(len(store.open_trades()), 1)

    def test_version4_tracking_repair_preserves_filled_trade_and_existing_columns(self):
        tracking = (
            ("protection_attempt", "INTEGER NOT NULL DEFAULT 0"),
            ("exit_order_filled", "INTEGER NOT NULL DEFAULT 0"),
            ("exit_order_value", "REAL NOT NULL DEFAULT 0"),
            ("exit_attempt", "INTEGER NOT NULL DEFAULT 0"),
        )
        for already_present in (0, 2, 4):
            with self.subTest(already_present=already_present):
                store = Store(":memory:")
                self.addCleanup(store.close)
                store.conn = sqlite3.connect(":memory:")
                store.conn.row_factory = sqlite3.Row
                for migration in MIGRATIONS[:4]:
                    store.conn.executescript(migration)
                store.conn.execute("PRAGMA user_version = 4")
                for name, definition in tracking[:already_present]:
                    store.conn.execute(f"ALTER TABLE live_trades ADD COLUMN {name} {definition}")
                trade_id = store.create_live_trade({
                    "signal_key": "existing-fill", "tag": "APRO1234567890", "day": DAY, "symbol": "SENSEX",
                    "exchange": "BFO", "tradingsymbol": "SENSEXTESTCE", "option_type": "CE",
                    "account_id": "owner", "quantity": 20, "lot_size": 20, "lots": 1,
                    "entry": 100, "stop_loss": 90, "trailing_sl": 90, "target1": 110,
                    "target2": 120, "risk": 10, "risk_rupees": 200,
                })
                store.update_live_trade(
                    trade_id, status="PROTECTION_PENDING", entry_order_id="existing-entry",
                    entry_filled=20, entry_price=99.5)
                if already_present:
                    store.update_live_trade(trade_id, protection_attempt=2)
                self.assertEqual(store.migrate(), len(MIGRATIONS))
                self.assertEqual(store.migrate(), len(MIGRATIONS))
                trade = store.live_trade(trade_id)
                self.assertEqual((trade["status"], trade["entry_filled"], trade["entry_price"]),
                                 ("PROTECTION_PENDING", 20, 99.5))
                self.assertEqual(trade["entry_order_id"], "existing-entry")
                self.assertIsNone(trade["risk_model"])
                self.assertEqual(trade["protection_attempt"], 2 if already_present else 0)
                self.assertTrue(all(name in trade for name, _ in tracking))
                store.update_live_trade(trade_id, protection_attempt=3, exit_order_filled=0,
                                        exit_order_value=0, exit_attempt=1)
                self.assertEqual(store.live_trade(trade_id)["exit_attempt"], 1)

    def test_partial_protective_fill_is_recorded_once_across_reconciliation(self):
        store = memory_store()
        self.addCleanup(store.close)
        executor = LiveOrderExecutor(store, collector=None)
        trade_id = store.create_live_trade({
            "signal_key": "live-1", "tag": "APRO1234567890", "day": DAY, "symbol": "NIFTY",
            "exchange": "NFO", "tradingsymbol": "NIFTYTESTCE", "option_type": "CE",
            "account_id": "owner", "quantity": 2, "lot_size": 2, "lots": 1,
            "entry": 100, "stop_loss": 90, "trailing_sl": 90, "target1": 110,
            "target2": 120, "risk": 10, "risk_rupees": 20,
        })
        store.update_live_trade(
            trade_id, status="OPEN", entry_filled=2, entry_price=100,
            protection_order_id="stop-1", protection_attempt=1,
        )
        order = {"order_id": "stop-1", "filled_quantity": 1, "average_price": 90,
                 "status": "CANCELLED", "order_type": "SL"}
        executor._record_exit(store.live_trade(trade_id), order, NOW, AutonomiqConfig())
        first = store.live_trade(trade_id)
        self.assertEqual((first["exit_filled"], first["status"], first["protection_attempt"]), (1, "PROTECTION_PENDING", 2))
        executor._record_exit(first, order, NOW, AutonomiqConfig())
        second = store.live_trade(trade_id)
        self.assertEqual((second["exit_filled"], second["status"], second["protection_attempt"]), (1, "PROTECTION_PENDING", 2))

    def test_daily_live_risk_counts_filled_entries_and_realizes_closed_pnl(self):
        store = memory_store()
        self.addCleanup(store.close)
        executor = LiveOrderExecutor(store, collector=None)
        trade_template = {
            "tag": "APRO1234567890", "day": DAY, "exchange": "NFO", "option_type": "CE",
            "account_id": "owner", "quantity": 1, "lot_size": 1, "lots": 1, "entry": 100,
            "stop_loss": 90, "trailing_sl": 90, "target1": 110, "target2": 120, "risk": 10,
            "risk_rupees": 10,
        }
        closed_id = store.create_live_trade({
            **trade_template, "signal_key": "closed", "symbol": "NIFTY", "tradingsymbol": "CLOSED",
        })
        store.update_live_trade(closed_id, status="CLOSED", entry_filled=1, entry_price=100, pnl=200)
        open_id = store.create_live_trade({
            **trade_template, "tag": "APRO2234567890", "signal_key": "open", "symbol": "BANKNIFTY",
            "tradingsymbol": "OPEN",
        })
        store.update_live_trade(open_id, status="OPEN", entry_filled=1, entry_price=100, last_price=95)
        store.create_live_trade({
            **trade_template, "tag": "APRO3234567890", "signal_key": "pending", "symbol": "SENSEX",
            "tradingsymbol": "PENDING",
        })

        stats = store.live_day_stats(DAY)
        realized, exposures, pending, trades_today = executor._risk_state(DAY)
        self.assertEqual((stats["trades"], stats["realized"], stats["wins"], stats["losses"]), (2, 200, 1, 0))
        self.assertEqual((trades_today, realized["NIFTY"], len(exposures), len(pending)), (2, 200, 1, 1))

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


class LiveExecutorSafetyTests(unittest.IsolatedAsyncioTestCase):
    async def test_tick_rounding_cannot_exceed_entry_slippage_cap(self):
        executor, kite, plan = self.entry_fixture()
        plan["entry"] = 100.01
        kite.quote.return_value = {f"NFO:{plan['tradingsymbol']}": {
            "timestamp": NOW, "depth": {"buy": [{"price": 100}], "sell": [{"price": 100.51}]},
        }}
        with mock.patch("services.autonomiq_pro.live_executor.datetime", wraps=datetime) as dt:
            dt.now.return_value = NOW
            result = await executor.submit_entry(
                cfg=AutonomiqConfig(live_execution_allowed=True), session=session_state(CFG, NOW),
                symbol="NIFTY", decision={"action": "BUY_CE", "source": "ai+quant", "risk": {"approved": True}},
                plan=plan, cycle_id=1, now=NOW)
        self.assertIn("Tick-rounded entry", result["detail"])
        kite.place_order.assert_not_called()

    def test_missing_protective_order_id_never_claims_an_open_protected_position(self):
        executor, kite, trade_id, orders, positions = self.open_position_fixture()
        executor.store.update_live_trade(trade_id, status="PROTECTION_PENDING", protection_order_id=None)
        orders.pop("stop-1")
        kite.place_order.return_value = None
        with mock.patch("services.autonomiq_pro.live_executor.datetime", wraps=datetime) as dt:
            dt.now.return_value = NOW
            executor._manage_trade(kite, executor.store.live_trade(trade_id), orders, positions, CFG, NOW, CFG.square_off)
        saved = executor.store.live_trade(trade_id)
        self.assertEqual(saved["status"], "PROTECTION_UNKNOWN")
        self.assertIsNone(saved["protection_order_id"])
        self.assertIn("uncertain", saved["error"])

    async def test_hybrid_entry_blocks_missing_history_and_never_shrinks_an_unaffordable_stop(self):
        for unavailable in (True, False):
            with self.subTest(unavailable=unavailable):
                executor, kite, plan = self.entry_fixture()
                if unavailable:
                    executor.collector.execution_candles.side_effect = ValueError("Latest completed history missing")
                else:
                    executor.collector.execution_candles.return_value = (
                        execution_history(22500, 5), execution_history(100, 25))
                kite.quote.return_value = {f"NFO:{plan['tradingsymbol']}": {
                    "timestamp": NOW, "depth": {"buy": [{"price": 99.5}], "sell": [{"price": 100}]},
                }}
                with mock.patch("services.autonomiq_pro.live_executor.datetime", wraps=datetime) as dt:
                    dt.now.return_value = NOW
                    result = await executor.submit_entry(
                        cfg=AutonomiqConfig(live_execution_allowed=True), session=session_state(CFG, NOW),
                        symbol="NIFTY", decision={"action": "BUY_CE", "source": "ai+quant",
                                                 "risk": {"approved": True}}, plan=plan, cycle_id=1, now=NOW)
                self.assertEqual(result["status"], "BLOCKED", result)
                self.assertIn("history" if unavailable else "Estimated loss", result["detail"])
                self.assertEqual(executor.store.open_live_trades(), [])
                kite.place_order.assert_not_called()

    def test_hybrid_trailing_uses_actual_atr_preserves_stop_on_missing_data_and_honours_exit(self):
        executor, kite, trade_id, orders, positions = self.open_position_fixture()
        executor.store.update_live_trade(trade_id, risk_model="HYBRID_V1", highest_bid=119, target2=150)
        executor.collector.execution_candles.return_value = (execution_history(22500, 5), execution_history(100, 1))
        key = f"NFO:{positions[0]['tradingsymbol']}"
        kite.quote.return_value = {key: {"timestamp": NOW, "depth": {"buy": [{"price": 118}]}}}
        with mock.patch("services.autonomiq_pro.live_executor.datetime", wraps=datetime) as dt:
            dt.now.return_value = NOW
            executor._manage_trade(kite, executor.store.live_trade(trade_id), orders, positions, CFG, NOW, CFG.square_off)
            self.assertEqual(kite.modify_order.call_args.kwargs["trigger_price"], 115)
            self.assertEqual(executor.store.live_trade(trade_id)["trailing_sl"], 115)
            orders["stop-1"]["trigger_price"] = 115
            kite.modify_order.reset_mock()
            executor.collector.execution_candles.side_effect = ValueError("Stale history")
            executor._manage_trade(kite, executor.store.live_trade(trade_id), orders, positions, CFG, NOW, CFG.square_off)
            self.assertEqual(executor.store.live_trade(trade_id)["trailing_sl"], 115)
            self.assertIn("existing stop retained", executor.store.live_trade(trade_id)["error"])
            kite.modify_order.assert_not_called()
            kite.quote.return_value[key]["depth"]["buy"][0]["price"] = 114
            executor._manage_trade(kite, executor.store.live_trade(trade_id), orders, positions, CFG, NOW, CFG.square_off)
            self.assertEqual(kite.modify_order.call_args.kwargs["order_type"], "LIMIT")
            self.assertEqual(executor.store.live_trade(trade_id)["status"], "EXIT_PENDING")
        kite.place_order.assert_not_called()

    def test_hybrid_targets_use_confirmed_fill_without_widening_structural_stop(self):
        executor, kite, trade_id, orders, positions = self.open_position_fixture()
        executor.store.update_live_trade(trade_id, risk_model="HYBRID_V1", status="ENTRY_PENDING",
                                        entry_filled=0, entry_price=None, protection_order_id=None)
        orders["entry-1"]["average_price"] = 98
        orders.pop("stop-1")
        kite.place_order.return_value = "new-stop"
        with mock.patch("services.autonomiq_pro.live_executor.datetime", wraps=datetime) as dt:
            dt.now.return_value = NOW
            executor._manage_trade(kite, executor.store.live_trade(trade_id), orders, positions, CFG, NOW, CFG.square_off)
        saved = executor.store.live_trade(trade_id)
        self.assertEqual((saved["entry_price"], saved["stop_loss"], saved["trailing_sl"]), (98, 90, 90))
        self.assertEqual((saved["target1"], saved["target2"]), (112.6, 123.9))
        self.assertEqual(kite.place_order.call_args.kwargs["trigger_price"], 90)

    async def test_banknifty_position_allows_separate_nifty_and_sensex_orders_with_reserved_risk(self):
        executor, kite, _ = self.entry_fixture()
        plans = {}
        for symbol, quantity in (("NIFTY", 65), ("BANKNIFTY", 30), ("SENSEX", 20)):
            option = leg(f"{symbol}TESTCE")
            option["lot_size"] = quantity
            plans[symbol] = build_plan(symbol, "BUY_CE", {
                "atm": 22500, "expiry": "2026-03-12", "exchange": "BFO" if symbol == "SENSEX" else "NFO",
                "strikes": [{"strike": 22500, "CE": option}],
            }, atr_5m=5, cfg=CFG)
        bank = plans["BANKNIFTY"]
        bank_id = executor.store.create_live_trade({
            **bank, "quantity": 30, "day": DAY, "account_id": "owner",
            "signal_key": "held-bank", "tag": "APRO1234567890",
        })
        executor.store.update_live_trade(
            bank_id, status="OPEN", entry_filled=30, entry_price=100, last_price=99.5,
            entry_order_id="bank-entry", protection_order_id="bank-stop", trailing_sl=90,
        )
        kite.orders.return_value = [{
            "order_id": "bank-stop", "tag": "APRO1234567890S0000", "status": "TRIGGER PENDING",
        }]
        kite.positions.return_value = {"net": [{
            "exchange": bank["exchange"], "tradingsymbol": bank["tradingsymbol"], "quantity": 30,
        }]}
        kite.quote.side_effect = lambda keys: {key: {
            "timestamp": NOW, "depth": {"buy": [{"price": 99.5}], "sell": [{"price": 100}]},
        } for key in keys}
        executor.collector.gateway.instruments.side_effect = lambda exchange, today: [{
            "name": symbol, "tradingsymbol": plan["tradingsymbol"], "instrument_type": "CE",
            "expiry": NOW.date() + timedelta(days=2), "lot_size": plan["lot_size"], "tick_size": .05,
        } for symbol, plan in plans.items() if plan["exchange"] == exchange]
        kite.place_order.side_effect = ["nifty-entry", "sensex-entry"]
        cfg = AutonomiqConfig(deployment_mode="production", live_execution_allowed=True)
        with mock.patch("services.autonomiq_pro.live_executor.datetime", wraps=datetime) as dt:
            dt.now.return_value = NOW
            for symbol in ("NIFTY", "SENSEX"):
                result = await executor.submit_entry(
                    cfg=cfg, session=session_state(cfg, NOW), symbol=symbol,
                    decision={"action": "BUY_CE", "source": "ai+quant", "risk": {"approved": True}},
                    plan=plans[symbol], cycle_id=1, now=NOW)
                self.assertEqual(result["status"], "ENTRY_PENDING", result)
        self.assertEqual({t["symbol"] for t in executor.store.open_live_trades()},
                         {"NIFTY", "BANKNIFTY", "SENSEX"})
        self.assertEqual(executor.store.live_trade(bank_id)["status"], "OPEN")
        self.assertEqual([(c.kwargs["exchange"], c.kwargs["quantity"])
                          for c in kite.place_order.call_args_list], [("NFO", 65), ("BFO", 20)])
        kite.modify_order.assert_not_called()
        kite.cancel_order.assert_not_called()

    async def test_position_closed_during_ai_reply_cannot_produce_a_phantom_hold_or_exit(self):
        from services.autonomiq_pro.orchestrator import AutonomiqOrchestrator

        for status, action in (("CLOSED", "HOLD"), ("CLOSED", "EXIT"),
                               ("RECONCILIATION_REQUIRED", "HOLD"), ("OPEN", "HOLD")):
            with self.subTest(status=status, action=action):
                executor, kite, trade_id, _, _ = self.open_position_fixture()
                collector = executor.collector
                collector.spot = mock.AsyncMock(return_value={"price": 22500, "age_s": 1})
                collector.collect_sync.side_effect = lambda symbol, *args: {
                    "symbol": symbol, "errors": [], "candles": {"5m": [1], "15m": [1]},
                    "options": chain(), "futures": None,
                }

                async def reply(*args):
                    self.assertEqual(len(args[-1]["autonomiq_live_positions"]), 1)
                    executor.store.update_live_trade(trade_id, status=status,
                                                     exit_filled=65 if status == "CLOSED" else 0)
                    return {"indices": {"NIFTY": {"action": action, "conviction": 80, "reasoning": "Manage"}}}

                ai = mock.Mock()
                ai.status.return_value = "ACTIVE"
                ai.complete_json = mock.AsyncMock(side_effect=reply)
                engine = AutonomiqOrchestrator(executor.store, collector, ai)
                engine.cfg = AutonomiqConfig(ai_enabled=True, live_execution_allowed=True)
                with mock.patch("services.autonomiq_pro.orchestrator.datetime", wraps=datetime) as dt, \
                        mock.patch.object(agents.MarketAnalysisAgent, "run", return_value={"atr_5m": 5}), \
                        mock.patch.object(agents.QuantResearchAgent, "run", return_value={
                            "score": 80, "bias": "BULLISH", "flags": [], "factors": [], "pcr": 1, "atm_iv": 14,
                        }):
                    dt.now.return_value = NOW
                    payload = await engine.run_cycle("SCHEDULED")
                signal = payload["indices"]["NIFTY"]["signal"]
                self.assertEqual(signal["action"], "HOLD" if status == "OPEN" else "WAIT")
                if status == "RECONCILIATION_REQUIRED":
                    self.assertIn("protection is not assumed", signal["reasoning"])
                self.assertIsNone(executor.store.live_trade(trade_id)["close_requested"])
                ai.complete_json.assert_awaited_once()
                self.assertEqual(kite.method_calls, [])

    def test_stricter_quote_age_falls_back_to_rest_instead_of_skipping_position_management(self):
        executor, kite, trade_id, orders, positions = self.open_position_fixture()
        executor.collector.cached_option_quote.return_value = {
            "timestamp": NOW - timedelta(seconds=2), "depth": {"buy": [{"price": 119}]},
        }
        trade = executor.store.live_trade(trade_id)
        kite.quote.return_value = {
            f"NFO:{trade['tradingsymbol']}": {"timestamp": NOW, "depth": {"buy": [{"price": 112}]}},
        }
        cfg = AutonomiqConfig(max_option_quote_age_seconds=1)
        with mock.patch("services.autonomiq_pro.live_executor.datetime", wraps=datetime) as dt:
            dt.now.return_value = NOW
            executor._manage_trade(kite, trade, orders, positions, cfg, NOW, cfg.square_off)
        kite.quote.assert_called_once()
        self.assertEqual(executor.store.live_trade(trade_id)["last_price"], 112)

    def test_completed_owned_stop_recovers_a_transient_order_position_mismatch_without_orders(self):
        for filled, tag in ((65, "APRO1234567890S0000"), (15, "APRO1234567890S0000"), (65, "MANUAL")):
            with self.subTest(filled=filled, tag=tag):
                executor, kite, trade_id, orders, _ = self.open_position_fixture()
                with mock.patch("services.autonomiq_pro.live_executor.datetime", wraps=datetime) as dt:
                    dt.now.return_value = NOW
                    executor._manage_trade(
                        kite, executor.store.live_trade(trade_id), orders, [], CFG, NOW, CFG.square_off)
                    self.assertEqual(executor.store.live_trade(trade_id)["status"], "RECONCILIATION_REQUIRED")
                    orders["stop-1"].update({
                        "tag": tag, "exchange": "NFO", "tradingsymbol": executor.store.live_trade(trade_id)["tradingsymbol"],
                        "transaction_type": "SELL", "quantity": 65, "filled_quantity": filled,
                        "average_price": 89.9, "order_type": "LIMIT",
                        "status": "COMPLETE" if filled == 65 else "OPEN",
                    })
                    executor._manage_trade(
                        kite, executor.store.live_trade(trade_id), orders, [], CFG, NOW, CFG.square_off)
                    saved = executor.store.live_trade(trade_id)
                    if tag == "MANUAL":
                        self.assertEqual((saved["status"], saved["exit_filled"]), ("RECONCILIATION_REQUIRED", 0))
                    elif filled == 65:
                        self.assertEqual((saved["status"], saved["exit_filled"], saved["exit_price"]),
                                         ("CLOSED", 65, 89.9))
                        self.assertEqual(saved["exit_reason"], "STOP_LOSS")
                        self.assertIsNone(saved["error"])
                    else:
                        self.assertEqual((saved["status"], saved["exit_filled"]), ("RECONCILIATION_REQUIRED", 15))
                    executor._manage_trade(kite, saved, orders, [], CFG, NOW, CFG.square_off)
                    self.assertEqual(executor.store.live_trade(trade_id)["exit_filled"], saved["exit_filled"])
                self.assertEqual(kite.method_calls, [])

    async def test_streamed_marks_use_actual_partial_fills_without_mutating_snapshot_or_stops(self):
        from services.autonomiq_pro.orchestrator import AutonomiqOrchestrator

        executor, kite, trade_id, _, _ = self.open_position_fixture()
        executor.store.update_live_trade(
            trade_id, entry_price=98, exit_filled=15, exit_price=110, last_price=105, pnl=49,
        )
        collector = executor.collector
        collector.spot = mock.AsyncMock(return_value={"price": 22500, "age_s": .1})
        collector.cached_option_quote.return_value = {
            "timestamp": NOW, "depth": {"buy": [{"price": 112}]},
        }
        ai = mock.Mock()
        ai.status.return_value = "ACTIVE"
        engine = AutonomiqOrchestrator(executor.store, collector, ai)
        engine.cfg = AutonomiqConfig(deployment_mode="production", live_execution_allowed=True)
        with mock.patch("services.autonomiq_pro.orchestrator.datetime", wraps=datetime) as dt:
            dt.now.return_value = NOW
            public = (await engine.snapshot())["live_trades"][0]
        self.assertEqual((public["entry_price"], public["last_price"], public["pnl"]), (98, 112, 730))
        self.assertEqual(executor.store.live_trade(trade_id)["last_price"], 105)
        executor.mark_positions(engine.cfg, NOW)
        saved = executor.store.live_trade(trade_id)
        self.assertEqual((saved["last_price"], saved["pnl"], saved["trailing_sl"]), (112, 730, 90))
        for timestamp in (NOW - timedelta(seconds=6), NOW + timedelta(seconds=4)):
            collector.cached_option_quote.return_value["timestamp"] = timestamp
            self.assertIsNone(executor.quote_mark(saved, engine.cfg, NOW))
        self.assertEqual(kite.method_calls, [])

    def test_streamed_peak_between_broker_passes_drives_only_acknowledged_trailing(self):
        executor, kite, trade_id, orders, positions = self.open_position_fixture()
        for bid in (119, 112):
            executor.collector.cached_option_quote.return_value = {
                "timestamp": NOW, "depth": {"buy": [{"price": bid}]},
            }
            executor.mark_positions(CFG, NOW)
        trade = executor.store.live_trade(trade_id)
        self.assertEqual((trade["highest_bid"], trade["trailing_sl"]), (119, 90))
        kite.modify_order.assert_not_called()
        with mock.patch("services.autonomiq_pro.live_executor.datetime", wraps=datetime) as dt:
            dt.now.return_value = NOW
            executor._manage_trade(kite, trade, orders, positions, CFG, NOW, CFG.square_off)
        self.assertEqual(kite.modify_order.call_args.kwargs["trigger_price"], 109)
        self.assertEqual(executor.store.live_trade(trade_id)["trailing_sl"], 109)
        kite.quote.assert_not_called()

    def open_position_fixture(self):
        executor, kite, plan = self.entry_fixture()
        trade_id = executor.store.create_live_trade({
            "signal_key": "trailing", "tag": "APRO1234567890", "day": DAY, "account_id": "owner",
            **plan, "quantity": plan["lot_size"],
        })
        executor.store.update_live_trade(
            trade_id, status="OPEN", entry_order_id="entry-1", entry_filled=65,
            entry_price=100, trailing_sl=90, protection_order_id="stop-1")
        orders = {
            "entry-1": {"order_id": "entry-1", "status": "COMPLETE", "filled_quantity": 65, "average_price": 100},
            "stop-1": {"order_id": "stop-1", "status": "TRIGGER PENDING", "order_type": "SL",
                       "filled_quantity": 0, "trigger_price": 90},
        }
        positions = [{"exchange": "NFO", "tradingsymbol": plan["tradingsymbol"], "quantity": 65}]
        return executor, kite, trade_id, orders, positions

    def test_broker_trigger_keeps_trailing_above_t1_and_never_loosens(self):
        executor, kite, trade_id, orders, positions = self.open_position_fixture()
        stops = []
        with mock.patch("services.autonomiq_pro.live_executor.datetime", wraps=datetime) as dt:
            dt.now.return_value = NOW
            for bid in (112, 118, 116):
                trade = executor.store.live_trade(trade_id)
                kite.quote.return_value = {f"NFO:{trade['tradingsymbol']}": {
                    "timestamp": NOW, "depth": {"buy": [{"price": bid}]},
                }}
                executor._manage_trade(kite, trade, orders, positions, CFG, NOW, CFG.square_off)
                stops.append(executor.store.live_trade(trade_id)["trailing_sl"])
                orders["stop-1"]["trigger_price"] = stops[-1]
        self.assertGreater(stops[0], 100)
        self.assertEqual(stops[1:], [108, 108])
        self.assertEqual(kite.modify_order.call_count, 2)
        last = kite.modify_order.call_args.kwargs
        self.assertEqual((last["order_id"], last["order_type"], last["trigger_price"]), ("stop-1", "SL", 108))
        self.assertLess(last["price"], last["trigger_price"])
        kite.place_order.assert_not_called()

    def test_failed_trailing_modification_preserves_last_broker_stop(self):
        executor, kite, trade_id, orders, positions = self.open_position_fixture()
        trade = executor.store.live_trade(trade_id)
        kite.quote.return_value = {f"NFO:{trade['tradingsymbol']}": {
            "timestamp": NOW, "depth": {"buy": [{"price": 118}]},
        }}
        kite.modify_order.side_effect = PermissionException("Stop modification rejected")
        with mock.patch("services.autonomiq_pro.live_executor.datetime", wraps=datetime) as dt:
            dt.now.return_value = NOW
            executor._manage_trade(kite, trade, orders, positions, CFG, NOW, CFG.square_off)
        saved = executor.store.live_trade(trade_id)
        self.assertEqual(saved["trailing_sl"], 90)
        self.assertEqual(saved["protection_order_id"], "stop-1")
        self.assertIn("Stop update failed", saved["error"])
        kite.place_order.assert_not_called()
        kite.cancel_order.assert_not_called()

    def test_acknowledged_unfilled_terminal_entry_is_reconciled(self):
        for status, expected in (("REJECTED", "REJECTED"), ("CANCELLED", "UNFILLED")):
            with self.subTest(status=status):
                executor, kite, plan = self.entry_fixture()
                trade_id = executor.store.create_live_trade({
                    "signal_key": status, "tag": "APRO1234567890", "day": DAY, "account_id": "owner",
                    **plan, "quantity": plan["lot_size"],
                })
                executor.store.update_live_trade(trade_id, status="ENTRY_PENDING", entry_order_id="entry-1")
                order = {"order_id": "entry-1", "status": status, "filled_quantity": 0,
                         "status_message": "Order not permitted from this IP"}
                executor._manage_trade(kite, executor.store.live_trade(trade_id), {"entry-1": order},
                                       [], CFG, NOW, CFG.square_off)
                self.assertEqual(executor.store.live_trade(trade_id)["status"], expected)
                self.assertEqual(executor.store.open_live_trades(), [])
                if status == "REJECTED":
                    self.assertIn("this IP", executor.store.live_trade(trade_id)["error"])
                    self.assertIn("this IP", executor.store.alerts(1)[0]["message"])
                executor._manage_trade(kite, executor.store.live_trade(trade_id), {"entry-1": order},
                                       [], CFG, NOW, CFG.square_off)
                self.assertEqual(len(executor.store.alerts()), 1)
                kite.place_order.assert_not_called()

    def test_submit_error_keeps_broker_reason_without_retrying_uncertain_entry(self):
        executor, kite, plan = self.entry_fixture()
        kite.quote.return_value = {f"NFO:{plan['tradingsymbol']}": {
            "timestamp": NOW, "depth": {"buy": [{"price": 99.5}], "sell": [{"price": 100}]},
        }}
        kite.place_order.side_effect = NetworkException("Connection reset before acknowledgement")
        with mock.patch("services.autonomiq_pro.live_executor.datetime", wraps=datetime) as dt:
            dt.now.return_value = NOW
            result = executor._submit_entry_sync(CFG, "NIFTY", {"action": "BUY_CE"}, plan, 1, NOW)
            retry = executor._submit_entry_sync(CFG, "NIFTY", {"action": "BUY_CE"}, plan, 1, NOW)
        self.assertEqual(result["status"], "ENTRY_UNKNOWN")
        self.assertIn("Connection reset", result["detail"])
        self.assertIn("Connection reset", executor.store.open_live_trades()[0]["error"])
        self.assertEqual(retry["status"], "BLOCKED")
        kite.place_order.assert_called_once()

    def test_explicit_permission_denial_is_rejected_without_retry_or_reserved_budget(self):
        executor, kite, plan = self.entry_fixture()
        kite.quote.return_value = {f"NFO:{plan['tradingsymbol']}": {
            "timestamp": NOW, "depth": {"buy": [{"price": 99.5}], "sell": [{"price": 100}]},
        }}
        kite.place_order.side_effect = PermissionException("IP is not allowed to place orders for this app")
        with mock.patch("services.autonomiq_pro.live_executor.datetime", wraps=datetime) as dt:
            dt.now.return_value = NOW
            result = executor._submit_entry_sync(CFG, "NIFTY", {"action": "BUY_CE"}, plan, 1, NOW)
            retry = executor._submit_entry_sync(CFG, "NIFTY", {"action": "BUY_CE"}, plan, 1, NOW)
        self.assertEqual(result["status"], "REJECTED")
        self.assertIn("not allowed", result["detail"])
        self.assertEqual(executor.store.live_trade(result["trade_id"])["status"], "REJECTED")
        self.assertEqual(executor.store.open_live_trades(), [])
        self.assertEqual(executor._risk_state(DAY)[1:], ([], [], 0))
        self.assertEqual(retry["status"], "DUPLICATE")
        kite.place_order.assert_called_once()

    def test_legacy_ip_denial_requires_same_day_empty_broker_evidence(self):
        for case in ("refused", "network", "position", "older", "order", "filled"):
            with self.subTest(case=case):
                executor, kite, plan = self.entry_fixture()
                day = (NOW.date() - timedelta(days=1)).isoformat() if case == "older" else DAY
                trade_id = executor.store.create_live_trade({
                    "signal_key": case, "tag": "APRO1234567890", "day": day, "account_id": "owner",
                    **plan, "quantity": plan["lot_size"],
                })
                denial = ("Entry result uncertain (PermissionException: IP (203.0.113.10) "
                          "is not allowed to place orders for this app); reconcile before retry")
                if case == "network":
                    denial = "Entry result uncertain (NetworkException: timeout); reconcile before retry"
                executor.store.update_live_trade(
                    trade_id, status="ENTRY_UNKNOWN", error=denial, entry_filled=1 if case == "filled" else 0)
                positions = [{"exchange": "NFO", "tradingsymbol": plan["tradingsymbol"], "quantity": 65}] \
                    if case == "position" else []
                orders = {"existing": {
                    "order_id": "existing", "tag": "APRO1234567890E", "status": "OPEN", "filled_quantity": 0,
                }} if case == "order" else {}
                with mock.patch("services.autonomiq_pro.live_executor.datetime", wraps=datetime) as dt:
                    dt.now.return_value = NOW
                    executor._manage_trade(
                        kite, executor.store.live_trade(trade_id), orders, positions, CFG, NOW, CFG.square_off)
                expected = "REJECTED" if case == "refused" else "ENTRY_UNKNOWN"
                self.assertEqual(executor.store.live_trade(trade_id)["status"], expected)
                if case == "refused":
                    self.assertEqual(executor.store.open_live_trades(), [])
                    self.assertEqual(executor.store.audit_entries()[0]["action"], "live_entry_rejected")
                kite.place_order.assert_not_called()
                kite.modify_order.assert_not_called()
                kite.cancel_order.assert_not_called()

    async def test_unfilled_intent_is_not_sent_to_ai_as_a_held_position(self):
        from services.autonomiq_pro.orchestrator import AutonomiqOrchestrator

        executor, kite, plan = self.entry_fixture()
        trade_id = executor.store.create_live_trade({
            "signal_key": "unknown", "tag": "APRO1234567890", "day": DAY, "account_id": "owner",
            **plan, "quantity": plan["lot_size"],
        })
        executor.store.update_live_trade(trade_id, status="ENTRY_UNKNOWN")
        collector = executor.collector
        collector.spot = mock.AsyncMock(return_value={"price": 22500, "age_s": 1})
        collector.collect_sync.side_effect = lambda symbol, *args: {
            "symbol": symbol, "errors": [], "candles": {"5m": [1], "15m": [1]},
            "options": chain(), "futures": None,
        }
        ai = mock.Mock()
        ai.status.return_value = "ACTIVE"
        ai.complete_json = mock.AsyncMock(return_value={
            "indices": {"NIFTY": {"action": "HOLD", "conviction": 80, "reasoning": "Manage position"}}})
        engine = AutonomiqOrchestrator(executor.store, collector, ai)
        engine.cfg = AutonomiqConfig(ai_enabled=True, api_key="test-key", live_execution_allowed=True)
        with mock.patch("services.autonomiq_pro.orchestrator.datetime", wraps=datetime) as dt, \
                mock.patch.object(agents.MarketAnalysisAgent, "run", return_value={"atr_5m": 5}), \
                mock.patch.object(agents.QuantResearchAgent, "run", return_value={
                    "score": 80, "bias": "BULLISH", "flags": [], "factors": [], "pcr": 1, "atm_iv": 14,
                }):
            dt.now.return_value = NOW
            payload = await engine.run_cycle("SCHEDULED")
        self.assertEqual(ai.complete_json.call_args.args[-1]["autonomiq_live_positions"], [])
        self.assertEqual(payload["indices"]["NIFTY"]["signal"]["action"], "WAIT")
        self.assertEqual(executor.store.live_trade(trade_id)["status"], "ENTRY_UNKNOWN")
        kite.place_order.assert_not_called()

    async def test_risk_rejection_reports_failed_check_without_broker_access(self):
        executor, kite, plan = self.entry_fixture()
        with mock.patch("services.autonomiq_pro.live_executor.datetime", wraps=datetime) as dt:
            dt.now.return_value = NOW
            result = await executor.submit_entry(
                cfg=AutonomiqConfig(live_execution_allowed=True), session=session_state(CFG, NOW),
                symbol="NIFTY", decision={"action": "BUY_CE", "source": "ai+quant", "risk": {
                    "approved": False, "checks": [
                        {"name": "Risk per trade", "passed": False, "detail": "1282 > 1000"},
                        {"name": "Spot fresh", "passed": True, "detail": "1s"},
                    ]}}, plan=plan, cycle_id=1, now=NOW)
        self.assertEqual(result["status"], "BLOCKED")
        self.assertEqual(result["detail"], "Risk per trade: 1282 > 1000")
        kite.profile.assert_not_called()
        kite.place_order.assert_not_called()

    async def test_broker_precheck_failure_is_an_explicit_entry_result(self):
        executor, kite, plan = self.entry_fixture()
        kite.profile.side_effect = PermissionException("Order access not permitted from this IP")
        with mock.patch("services.autonomiq_pro.live_executor.datetime", wraps=datetime) as dt:
            dt.now.return_value = NOW
            result = await executor.submit_entry(
                cfg=AutonomiqConfig(live_execution_allowed=True), session=session_state(CFG, NOW),
                symbol="NIFTY", decision={"action": "BUY_CE", "source": "ai+quant", "risk": {"approved": True}},
                plan=plan, cycle_id=1, now=NOW)
        self.assertEqual(result["status"], "BROKER_ERROR")
        self.assertIn("this IP", result["detail"])
        self.assertEqual(executor.store.open_live_trades(), [])
        kite.place_order.assert_not_called()

    async def test_scheduled_approved_buy_submits_entry_then_broker_stop_trigger(self):
        from services.autonomiq_pro.orchestrator import AutonomiqOrchestrator

        executor, kite, plan = self.entry_fixture()
        collector = executor.collector
        collector.spot = mock.AsyncMock(return_value={"price": 22500, "age_s": 1})
        collector.collect_sync.side_effect = lambda symbol, *args: {
            "symbol": symbol, "errors": [], "candles": {"5m": [1], "15m": [1]},
            "options": chain(), "futures": None,
        }
        kite.quote.return_value = {f"NFO:{plan['tradingsymbol']}": {
            "timestamp": NOW, "depth": {"buy": [{"price": 99.5}], "sell": [{"price": 100}]},
        }}
        ai = mock.Mock()
        ai.status.return_value = "ACTIVE"
        ai.complete_json = mock.AsyncMock(return_value={
            "indices": {"NIFTY": {"action": "BUY_CE", "conviction": 80, "reasoning": "Aligned"}}})
        engine = AutonomiqOrchestrator(executor.store, collector, ai)
        with mock.patch("services.autonomiq_pro.config.dotenv_values", return_value={}), \
                mock.patch.dict(os.environ, {
                    "AUTONOMIQ_PRO_DEPLOYMENT_MODE": "local", "AUTONOMIQ_PRO_ALLOW_LOCAL_LIVE": "true",
                    "AUTONOMIQ_PRO_AI_ENABLED": "true", "AUTONOMIQ_PRO_ANTHROPIC_API_KEY": "test-key",
                }, clear=True):
            engine.cfg = load_config()
        self.assertTrue(engine.cfg.live_execution_allowed)
        with mock.patch("services.autonomiq_pro.orchestrator.datetime", wraps=datetime) as odt, \
                mock.patch("services.autonomiq_pro.live_executor.datetime", wraps=datetime) as edt, \
                mock.patch.object(agents.MarketAnalysisAgent, "run", return_value={"atr_5m": 5}), \
                mock.patch.object(agents.QuantResearchAgent, "run", side_effect=lambda analysis, data: {
                    "score": 80 if data["symbol"] == "NIFTY" else 10, "bias": "BULLISH",
                    "flags": [], "factors": [], "pcr": 1, "atm_iv": 14,
                }):
            odt.now.return_value = edt.now.return_value = NOW
            payload = await engine.run_cycle("SCHEDULED")
            signal = payload["indices"]["NIFTY"]["signal"]
            self.assertTrue(signal["risk"]["approved"])
            self.assertEqual(signal["execution"]["status"], "ENTRY_PENDING")
            entry_args = kite.place_order.call_args.kwargs
            self.assertEqual((entry_args["transaction_type"], entry_args["order_type"], entry_args["validity"]),
                             ("BUY", "LIMIT", "IOC"))
            self.assertEqual((entry_args["quantity"], entry_args["price"]), (65, 100))
            kite.orders.return_value = [{
                "order_id": "entry-1", "status": "COMPLETE", "filled_quantity": 65, "average_price": 100,
                "tag": entry_args["tag"],
            }]
            kite.positions.return_value = {"net": [{
                "exchange": "NFO", "tradingsymbol": plan["tradingsymbol"], "quantity": 65,
            }]}
            kite.place_order.return_value = "stop-1"
            await engine.live_executor.reconcile_and_manage(engine.cfg, NOW, engine.cfg.square_off)
            snapshot = await engine.snapshot()
            self.assertEqual(snapshot["live_trades"][0]["entry_filled"], 65)
            self.assertEqual(snapshot["live_trades"][0]["exit_filled"], 0)
            self.assertIn("last_quote_at", snapshot["live_trades"][0])
        self.assertEqual(ai.complete_json.await_count, 1)
        self.assertEqual(kite.place_order.call_count, 2)
        stop_args = kite.place_order.call_args.kwargs
        self.assertEqual((stop_args["transaction_type"], stop_args["order_type"]), ("SELL", "SL"))
        self.assertEqual((stop_args["quantity"], stop_args["trigger_price"]), (65, 90))
        self.assertLess(stop_args["price"], stop_args["trigger_price"])
        self.assertEqual(executor.store.open_live_trades()[0]["protection_order_id"], "stop-1")

    async def test_cost_aware_rejection_updates_signal_risk_without_submitting(self):
        from services.autonomiq_pro.orchestrator import AutonomiqOrchestrator

        executor, kite, plan = self.entry_fixture()
        collector = executor.collector
        collector.spot = mock.AsyncMock(return_value={"price": 22500, "age_s": 1})
        collector.collect_sync.side_effect = lambda symbol, *args: {
            "symbol": symbol, "errors": [], "candles": {"5m": [1], "15m": [1]},
            "options": chain(), "futures": None,
        }
        kite.quote.return_value = {f"NFO:{plan['tradingsymbol']}": {
            "timestamp": NOW, "depth": {"buy": [{"price": 99.5}], "sell": [{"price": 100}]},
        }}
        ai = mock.Mock()
        ai.status.return_value = "ACTIVE"
        ai.complete_json = mock.AsyncMock(return_value={
            "indices": {"NIFTY": {"action": "BUY_CE", "conviction": 80, "reasoning": "Aligned"}}})
        engine = AutonomiqOrchestrator(executor.store, collector, ai)
        engine.cfg = AutonomiqConfig(
            ai_enabled=True, api_key="test-key", live_execution_allowed=True,
            max_risk_per_trade_rupees=2000, estimated_round_trip_cost_rupees=300)
        with mock.patch("services.autonomiq_pro.orchestrator.datetime", wraps=datetime) as odt, \
                mock.patch("services.autonomiq_pro.live_executor.datetime", wraps=datetime) as edt, \
                mock.patch.object(agents.MarketAnalysisAgent, "run", return_value={"atr_5m": 5}), \
                mock.patch.object(agents.QuantResearchAgent, "run", return_value={
                    "score": 80, "bias": "BULLISH", "flags": [], "factors": [], "pcr": 1, "atm_iv": 14,
                }):
            odt.now.return_value = edt.now.return_value = NOW
            payload = await engine.run_cycle("SCHEDULED")
        signal = payload["indices"]["NIFTY"]["signal"]
        self.assertEqual(signal["execution"]["status"], "BLOCKED")
        self.assertFalse(signal["risk"]["approved"])
        failed = [check for check in signal["risk"]["checks"] if not check["passed"]]
        self.assertEqual(len(failed), 1)
        self.assertIn("1,015.00", failed[0]["detail"])
        self.assertIn("1,000.00", failed[0]["detail"])
        self.assertNotIn("risk_checks", signal["execution"])
        self.assertEqual(executor.store.open_live_trades(), [])
        kite.place_order.assert_not_called()
        saved = next(d for d in executor.store.decisions() if d["symbol"] == "NIFTY")
        self.assertFalse(saved["approved"])
        self.assertEqual(executor.store.last_cycle()["payload"]["indices"]["NIFTY"]["signal"]["risk"],
                         signal["risk"])

    async def test_expired_broker_session_returns_reconnect_error_and_keeps_live_off(self):
        from fastapi import FastAPI
        from routers import autonomiq_pro
        from services.autonomiq_pro.orchestrator import AutonomiqOrchestrator

        executor, kite, _ = self.entry_fixture()
        executor.store.set_state("live_trading_enabled", False)
        ai = mock.Mock()
        ai.status.return_value = "ACTIVE"
        engine = AutonomiqOrchestrator(executor.store, executor.collector, ai)
        engine.live_executor = executor
        engine.cfg = AutonomiqConfig(ai_enabled=True, api_key="test-key", live_execution_allowed=True)
        app = FastAPI()
        app.include_router(autonomiq_pro.router)
        app.dependency_overrides[autonomiq_pro.owner] = lambda: "owner"
        for stage in ("profile", "orders"):
            with self.subTest(stage=stage):
                kite.profile.side_effect = TokenException("Expired token") if stage == "profile" else None
                kite.orders.side_effect = TokenException("Expired token") if stage == "orders" else None
                with mock.patch.object(autonomiq_pro, "_service", return_value=engine):
                    async with httpx.AsyncClient(
                        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test",
                    ) as client:
                        response = await client.post("/api/autonomiq-pro/control", json={
                            "live_trading_enabled": True, "confirm_live": "ENABLE_AUTONOMIQ_LIVE_TRADING",
                        })
                self.assertEqual(response.status_code, 409)
                self.assertIn("Zerodha session expired", response.json()["detail"])
                self.assertFalse(executor.store.get_state("live_trading_enabled", False))
                kite.place_order.assert_not_called()

    async def test_local_live_control_requires_opt_in_confirmation_and_broker_preflight(self):
        from fastapi import FastAPI
        from routers import autonomiq_pro
        from services.autonomiq_pro.orchestrator import AutonomiqOrchestrator

        executor, kite, _ = self.entry_fixture()
        executor.store.set_state("live_trading_enabled", False)
        ai = mock.Mock()
        ai.status.return_value = "ACTIVE"
        engine = AutonomiqOrchestrator(executor.store, executor.collector, ai)
        engine.live_executor = executor
        app = FastAPI()
        app.include_router(autonomiq_pro.router)
        app.dependency_overrides[autonomiq_pro.owner] = lambda: "owner"
        for opt_in in ("false", "true"):
            with self.subTest(opt_in=opt_in):
                with mock.patch("services.autonomiq_pro.config.dotenv_values", return_value={}), \
                        mock.patch.dict(os.environ, {
                            "AUTONOMIQ_PRO_DEPLOYMENT_MODE": "local",
                            "AUTONOMIQ_PRO_ALLOW_LOCAL_LIVE": opt_in, "AUTONOMIQ_PRO_AI_ENABLED": "true",
                            "AUTONOMIQ_PRO_ANTHROPIC_API_KEY": "test-key",
                        }, clear=True):
                    engine.cfg = load_config()
                with mock.patch.object(autonomiq_pro, "_service", return_value=engine):
                    async with httpx.AsyncClient(
                        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test",
                    ) as client:
                        unconfirmed = await client.post("/api/autonomiq-pro/control",
                                                        json={"live_trading_enabled": True})
                        self.assertEqual(unconfirmed.status_code, 409)
                        self.assertFalse(executor.store.get_state("live_trading_enabled"))
                        kite.profile.assert_not_called()
                        response = await client.post("/api/autonomiq-pro/control", json={
                            "live_trading_enabled": True, "confirm_live": "ENABLE_AUTONOMIQ_LIVE_TRADING",
                        })
                self.assertEqual(response.status_code, 200 if opt_in == "true" else 409)
                self.assertEqual(executor.store.get_state("live_trading_enabled"), opt_in == "true")
                if opt_in == "true":
                    kite.profile.assert_called_once()
                    kite.orders.assert_called_once()
                    kite.positions.assert_called_once()
                    kite.margins.assert_called_once_with("equity")
                else:
                    self.assertIn("AUTONOMIQ_PRO_ALLOW_LOCAL_LIVE", response.json()["detail"])
                    kite.profile.assert_not_called()
                kite.place_order.assert_not_called()

    def entry_fixture(self):
        store = memory_store()
        self.addCleanup(store.close)
        kite = mock.Mock()
        kite.profile.return_value = {"user_id": "owner"}
        kite.orders.return_value = []
        kite.positions.return_value = {"net": []}
        kite.margins.return_value = {"available": {"cash": 100000}}
        kite.place_order.return_value = "entry-1"
        collector = mock.Mock()
        collector.cached_option_quote.return_value = None
        collector.execution_candles.return_value = (execution_history(22500, 5), execution_history())
        collector.gateway.client.return_value = kite
        plan = build_plan("NIFTY", "BUY_CE", chain(), atr_5m=5.0, cfg=CFG)
        collector.gateway.instruments.return_value = [{
            "tradingsymbol": plan["tradingsymbol"], "name": "NIFTY", "instrument_type": "CE",
            "expiry": NOW.date() + timedelta(days=2), "lot_size": plan["lot_size"], "tick_size": 0.05,
        }]
        store.set_state("live_trading_enabled", True)
        return LiveOrderExecutor(store, collector), kite, plan

    def test_entry_checks_quote_against_current_time_not_cycle_start(self):
        executor, kite, plan = self.entry_fixture()
        current = NOW + timedelta(seconds=30)
        kite.quote.return_value = {f"NFO:{plan['tradingsymbol']}": {
            "timestamp": current, "depth": {"buy": [{"price": 99.5}], "sell": [{"price": 100}]},
        }}
        with mock.patch("services.autonomiq_pro.live_executor.datetime", wraps=datetime) as dt:
            dt.now.return_value = current
            result = executor._submit_entry_sync(
                CFG, "NIFTY", {"action": "BUY_CE"}, plan, 1, NOW)
        self.assertEqual(result["status"], "ENTRY_PENDING", result)
        kite.place_order.assert_called_once()

    async def test_slow_analysis_cannot_submit_after_entry_cutoff(self):
        executor, kite, plan = self.entry_fixture()
        before = NOW.replace(hour=14, minute=44, second=59)
        after = NOW.replace(hour=14, minute=45, second=20)
        with mock.patch("services.autonomiq_pro.live_executor.datetime", wraps=datetime) as dt, \
                mock.patch.object(executor, "_submit_entry_sync", return_value={"status": "ENTRY_PENDING"}) as submit:
            dt.now.return_value = after
            result = await executor.submit_entry(
                cfg=AutonomiqConfig(live_execution_allowed=True), session=session_state(CFG, before),
                symbol="NIFTY", decision={"action": "BUY_CE", "source": "ai+quant", "risk": {"approved": True}},
                plan=plan, cycle_id=1, now=before)
        self.assertEqual(result["status"], "BLOCKED")
        submit.assert_not_called()
        kite.place_order.assert_not_called()

    def test_completed_entry_does_not_reset_exit_or_failed_protection(self):
        executor, kite, plan = self.entry_fixture()
        trade_id = executor.store.create_live_trade({
            "signal_key": "recovery", "tag": "APRO1234567890", "day": DAY, "account_id": "owner",
            **plan, "quantity": plan["lot_size"],
        })
        executor.store.update_live_trade(
            trade_id, entry_order_id="entry-1", entry_filled=65, entry_price=100, status="EXIT_UNKNOWN")
        entry = {"order_id": "entry-1", "status": "COMPLETE", "filled_quantity": 65, "average_price": 100}
        position = {"exchange": "NFO", "tradingsymbol": plan["tradingsymbol"], "quantity": 65}
        with mock.patch.object(executor, "_submit_emergency_exit") as emergency:
            executor._manage_trade(kite, executor.store.live_trade(trade_id), {"entry-1": entry},
                                   [position], CFG, NOW, CFG.square_off)
            self.assertEqual(executor.store.live_trade(trade_id)["status"], "EXIT_UNKNOWN")
            executor.store.update_live_trade(trade_id, status="PROTECTION_FAILED")
            executor._manage_trade(kite, executor.store.live_trade(trade_id), {"entry-1": entry},
                                   [position], CFG, NOW, CFG.square_off)
            emergency.assert_called_once()
        kite.place_order.assert_not_called()

    def test_rejected_protection_on_open_trade_reaches_emergency_exit(self):
        executor, kite, plan = self.entry_fixture()
        trade_id = executor.store.create_live_trade({
            "signal_key": "rejected-stop", "tag": "APRO1234567890", "day": DAY, "account_id": "owner",
            **plan, "quantity": plan["lot_size"],
        })
        executor.store.update_live_trade(
            trade_id, status="OPEN", entry_order_id="entry-1", entry_filled=65,
            entry_price=100, protection_order_id="stop-1")
        orders = {
            "entry-1": {"order_id": "entry-1", "status": "COMPLETE", "filled_quantity": 65, "average_price": 100},
            "stop-1": {"order_id": "stop-1", "status": "REJECTED", "filled_quantity": 0},
        }
        position = {"exchange": "NFO", "tradingsymbol": plan["tradingsymbol"], "quantity": 65}
        with mock.patch.object(executor, "_submit_emergency_exit") as emergency:
            executor._manage_trade(kite, executor.store.live_trade(trade_id), orders, [position],
                                   CFG, NOW, CFG.square_off)
            emergency.assert_called_once()
        self.assertEqual(executor.store.live_trade(trade_id)["status"], "PROTECTION_FAILED")
        kite.place_order.assert_not_called()

    def test_quote_expiring_during_margin_check_blocks_submission(self):
        executor, kite, plan = self.entry_fixture()
        current = NOW
        kite.quote.return_value = {f"NFO:{plan['tradingsymbol']}": {
            "timestamp": NOW, "depth": {"buy": [{"price": 99.5}], "sell": [{"price": 100}]},
        }}

        def delayed_margin(*args):
            nonlocal current
            current += timedelta(seconds=6)
            return {"available": {"cash": 100000}}

        kite.margins.side_effect = delayed_margin
        with mock.patch("services.autonomiq_pro.live_executor.datetime", wraps=datetime) as dt:
            dt.now.side_effect = lambda *args: current
            result = executor._submit_entry_sync(CFG, "NIFTY", {"action": "BUY_CE"}, plan, 1, NOW)
        self.assertEqual(result["status"], "BLOCKED")
        self.assertIn("quote expired", result["detail"])
        kite.place_order.assert_not_called()

    async def test_owner_off_blocks_entry_before_broker_access(self):
        store = memory_store()
        self.addCleanup(store.close)
        executor = LiveOrderExecutor(store, collector=None)
        result = await executor.submit_entry(
            cfg=AutonomiqConfig(live_execution_allowed=True),
            session={"trading_day": True, "phase": "ACTIVE"},
            symbol="NIFTY", decision={"action": "BUY_CE", "source": "ai+quant", "risk": {"approved": True}},
            plan={}, cycle_id=1, now=NOW,
        )
        self.assertEqual(result["status"], "OFF")

    def test_daily_loss_threshold_disables_entries_and_requests_owned_exit(self):
        store = memory_store()
        self.addCleanup(store.close)
        executor = LiveOrderExecutor(store, collector=None)
        trade_id = store.create_live_trade({
            "signal_key": "loss-1", "tag": "APRO1234567890", "day": DAY, "symbol": "NIFTY",
            "exchange": "NFO", "tradingsymbol": "NIFTYTESTCE", "option_type": "CE",
            "account_id": "owner", "quantity": 1, "lot_size": 1, "lots": 1,
            "entry": 100, "stop_loss": 90, "trailing_sl": 90, "target1": 110,
            "target2": 120, "risk": 10, "risk_rupees": 10,
        })
        store.update_live_trade(trade_id, status="OPEN", entry_filled=1, entry_price=100, last_price=80)
        store.set_state("live_trading_enabled", True)

        executor._enforce_daily_loss(AutonomiqConfig(daily_loss_limit_rupees=10), NOW)
        executor._enforce_daily_loss(AutonomiqConfig(daily_loss_limit_rupees=10), NOW)

        self.assertFalse(store.get_state("live_trading_enabled", False))
        self.assertEqual(store.live_trade(trade_id)["close_requested"], "DAILY_LOSS_LIMIT")
        self.assertEqual(len(store.alerts(10)), 1)


class AIClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_next_request_is_blocked_before_total_spend_reaches_daily_cap(self):
        store = memory_store()
        self.addCleanup(store.close)
        store.record_ai_call(DAY, "strategy", CFG.primary_model, "OK", cost_usd=1.2226)
        requests = []
        client = AIClient(store, httpx.MockTransport(lambda request: requests.append(request)))
        self.assertEqual(client.status(CFG, DAY), "ACTIVE")
        with self.assertRaisesRegex(AIUnavailable, "DAILY_BUDGET_INSUFFICIENT"):
            await client.complete_json(CFG, DAY, "strategy", CFG.primary_model, "sys", {"data": "x" * 6000})
        self.assertEqual(requests, [])
        self.assertEqual(store.ai_usage(DAY)["calls"], 1)

    async def test_truncated_response_records_charge_without_retry_or_decision(self):
        store = memory_store()
        self.addCleanup(store.close)
        requests = []

        def handler(request):
            requests.append(request)
            return httpx.Response(200, json={
                "stop_reason": "max_tokens", "content": [{"type": "text", "text": '{"indices":{}}'}],
                "usage": {"input_tokens": 2500, "output_tokens": 500},
            })

        client = AIClient(store, httpx.MockTransport(handler))
        with self.assertRaisesRegex(AIUnavailable, "OUTPUT_TOKEN_LIMIT"):
            await client.complete_json(CFG, DAY, "strategy", CFG.primary_model, "sys", {})
        self.assertEqual(len(requests), 1)
        self.assertEqual(store.ai_calls(1)[0]["status"], "OUTPUT_TOKEN_LIMIT")
        self.assertGreater(store.ai_usage(DAY)["cost_usd"], 0)
        self.assertEqual(client.last_error, "OUTPUT_TOKEN_LIMIT")

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
    def test_startup_and_socket_threads_share_a_single_executor_instance(self):
        import time as clock
        from concurrent.futures import ThreadPoolExecutor
        from services.autonomiq_pro import orchestrator

        instance = object()

        def construct():
            clock.sleep(.02)
            return instance

        with mock.patch.object(orchestrator, "_orchestrator", None), \
                mock.patch.object(orchestrator, "AutonomiqOrchestrator", side_effect=construct) as factory, \
                ThreadPoolExecutor(max_workers=2) as workers:
            results = list(workers.map(lambda _: orchestrator.get_orchestrator(), range(2)))
        self.assertTrue(all(result is instance for result in results))
        factory.assert_called_once()

    def test_existing_kite_order_callback_notifies_both_engines(self):
        from services.market_feed import MarketFeedService

        update = {"tag": "APRO1234567890E", "status": "COMPLETE"}
        with mock.patch("services.aqte_live.get_live_service") as aqte, \
                mock.patch("services.autonomiq_pro.orchestrator.get_orchestrator") as autonomiq:
            MarketFeedService._on_order_update(mock.Mock(), None, update)
        aqte.return_value.broker_update.assert_called_once_with(update)
        autonomiq.return_value.broker_update.assert_called_once_with(update)

    async def test_owned_terminal_events_accelerate_reconciliation_without_flooding_or_ai_calls(self):
        from services.autonomiq_pro.orchestrator import AutonomiqOrchestrator

        store = memory_store()
        self.addCleanup(store.close)
        engine = AutonomiqOrchestrator(store, mock.Mock(), mock.Mock())
        engine.live_executor = mock.Mock()
        engine.live_executor.cancel_pending_entries = mock.AsyncMock()
        update = {"tag": "APRO1234567890E", "status": "COMPLETE"}
        calls = 0

        async def reconcile(*args):
            nonlocal calls
            calls += 1
            if calls == 1:
                engine.broker_update(update)

        engine.live_executor.reconcile_and_manage = mock.AsyncMock(side_effect=reconcile)
        engine._last_broker_management_at = 10
        cfg = AutonomiqConfig(live_execution_allowed=True, enabled=False)
        with mock.patch("services.autonomiq_pro.orchestrator.load_config", return_value=cfg), \
                mock.patch("services.autonomiq_pro.orchestrator.clock.monotonic",
                           side_effect=[10.1, 10.2, 11, 11.3, 12]):
            engine.broker_update({"tag": "MANUAL", "status": "COMPLETE"})
            engine.broker_update({"tag": update["tag"], "status": "TRIGGER PENDING"})
            await engine._tick()
            self.assertEqual(calls, 0)
            engine.broker_update(update)
            await engine._tick()
            self.assertEqual(calls, 0)
            await engine._tick()
            self.assertEqual(calls, 1)
            self.assertTrue(engine._broker_update_pending.is_set(), "Update during broker I/O must not be lost")
            await engine._tick()
            self.assertEqual(calls, 1)
            await engine._tick()
            self.assertEqual(calls, 2)
        self.assertFalse(engine._broker_update_pending.is_set())
        engine.ai.complete_json.assert_not_called()

    async def test_fast_quote_marks_do_not_increase_broker_reconciliation_or_ai_calls(self):
        from services.autonomiq_pro.orchestrator import AutonomiqOrchestrator

        store = memory_store()
        self.addCleanup(store.close)
        engine = AutonomiqOrchestrator(store, mock.Mock(), mock.Mock())
        engine.live_executor = mock.Mock()
        engine.live_executor.reconcile_and_manage = mock.AsyncMock()
        engine.live_executor.cancel_pending_entries = mock.AsyncMock()
        cfg = AutonomiqConfig(deployment_mode="production", live_execution_allowed=True, enabled=False)
        with mock.patch("services.autonomiq_pro.orchestrator.load_config", return_value=cfg), \
                mock.patch("services.autonomiq_pro.orchestrator.clock.monotonic", side_effect=[0, 1, 2, 5]):
            for _ in range(4):
                await engine._tick()
        self.assertEqual(engine.live_executor.mark_positions.call_count, 4)
        self.assertEqual(engine.live_executor.reconcile_and_manage.await_count, 2)
        self.assertEqual(engine.live_executor.cancel_pending_entries.await_count, 2)
        engine.ai.complete_json.assert_not_called()

    def test_shared_subscription_pins_only_owned_filled_contracts_after_atm_rotation(self):
        from services.autonomiq_pro.orchestrator import AutonomiqOrchestrator

        store = memory_store()
        self.addCleanup(store.close)
        engine = AutonomiqOrchestrator(store, mock.Mock(), mock.Mock())
        engine.cfg = AutonomiqConfig(deployment_mode="production", live_execution_allowed=True)
        plan = build_plan("NIFTY", "BUY_CE", chain(), atr_5m=5, cfg=CFG)
        trade_id = store.create_live_trade({
            **plan, "signal_key": "held", "tag": "APRO1234567890", "account_id": "owner",
            "day": DAY, "quantity": 65,
        })
        catalog = [{
            "instrument_token": 91, "name": "NIFTY", "tradingsymbol": plan["tradingsymbol"],
            "exchange": "NFO", "instrument_type": "CE", "strike": 22500, "expiry": "2026-03-12",
            "lot_size": 65, "tick_size": .05,
        }, {
            "instrument_token": 92, "name": "NIFTY", "tradingsymbol": "UNOWNED",
            "exchange": "NFO", "instrument_type": "CE", "strike": 23000, "expiry": "2026-03-12",
            "lot_size": 65, "tick_size": .05,
        }]
        self.assertEqual(engine.quote_pins(catalog), {})
        store.update_live_trade(trade_id, status="OPEN", entry_filled=65, entry_price=100)
        pins = engine.quote_pins(catalog)
        self.assertEqual(set(pins), {91})
        self.assertEqual(pins[91].trading_symbol, plan["tradingsymbol"])
        store.update_live_trade(trade_id, status="CLOSED", exit_filled=65)
        self.assertEqual(engine.quote_pins(catalog), {})

    async def test_option_chains_skipped_before_first_tick_recover_without_refetching_candles(self):
        from services.autonomiq_pro.orchestrator import AutonomiqOrchestrator

        for recovery_fails in (False, True):
            with self.subTest(recovery_fails=recovery_fails):
                store = memory_store()
                self.addCleanup(store.close)
                collector = mock.Mock()
                reads = {}

                async def spot(symbol, now):
                    count = reads.get(symbol, 0)
                    reads[symbol] = count + 1
                    if count == 0 and symbol in ("NIFTY", "BANKNIFTY"):
                        return {"price": None, "age_s": None}
                    return {"price": 22500, "age_s": 1}

                collector.spot = mock.AsyncMock(side_effect=spot)
                collector.collect_sync.side_effect = lambda symbol, price, now: {
                    "symbol": symbol, "errors": [], "candles": {"5m": [1], "15m": [1]},
                    "futures": None, "options": chain() if price else None,
                }
                collector.collect_options_sync.return_value = chain()
                if recovery_fails:
                    collector.collect_options_sync.side_effect = RuntimeError("No quotes")
                ai = mock.Mock()
                ai.status.return_value = "ACTIVE"
                ai.complete_json = mock.AsyncMock(return_value={"indices": {
                    s: {"action": "WAIT", "conviction": 40, "reasoning": "Review"}
                    for s in ("NIFTY", "BANKNIFTY", "SENSEX")
                }})
                engine = AutonomiqOrchestrator(store, collector, ai)
                engine.cfg = CFG
                quant = {"score": 70, "bias": "BULLISH", "flags": [], "factors": [], "pcr": 1.0, "atm_iv": 14.0}
                with mock.patch("services.autonomiq_pro.orchestrator.datetime", wraps=datetime) as dt, \
                        mock.patch.object(agents.MarketAnalysisAgent, "run", return_value={"atr_5m": 5}), \
                        mock.patch.object(agents.QuantResearchAgent, "run", return_value=quant):
                    dt.now.return_value = NOW
                    payload = await engine.run_cycle("SCHEDULED")
                self.assertEqual(collector.collect_sync.call_count, 3)
                self.assertEqual(collector.collect_options_sync.call_count, 2)
                self.assertEqual(ai.complete_json.await_count, 1)
                for symbol in ("NIFTY", "BANKNIFTY"):
                    index = payload["indices"][symbol]
                    if recovery_fails:
                        self.assertEqual(index["signal"]["action"], "NO_TRADE")
                        self.assertIn("options: RuntimeError", index["errors"])
                    else:
                        self.assertIsNotNone(index["options"])
                        self.assertEqual(index["errors"], [])
                        self.assertNotEqual(index["signal"]["source"], "validation")

    async def test_manual_snapshot_retains_only_todays_scheduled_decisions_without_active_plan(self):
        from services.autonomiq_pro.orchestrator import AutonomiqOrchestrator

        store = memory_store()
        self.addCleanup(store.close)
        collector = mock.Mock()
        collector.spot = mock.AsyncMock(return_value={"price": 22500, "age_s": 1})
        engine = AutonomiqOrchestrator(store, collector)
        engine.cfg = CFG
        for at in (NOW - timedelta(days=1), NOW):
            with self.subTest(at=at):
                scheduled = {"at": at.isoformat(), "ai_state": "ACTIVE", "indices": {
                    "NIFTY": {"signal": {"action": "WAIT", "ai_action": "WAIT", "quant_action": "BUY_CE",
                                        "reasoning": "Await a pullback", "timestamp": at.isoformat(),
                                        "execution": {"status": "NOT_REQUESTED", "detail": ""},
                                        "plan": {"entry": 100}}}}}
                store.finish_cycle(store.start_cycle("SCHEDULED"), "OK", payload=scheduled)
                manual = {"at": NOW.isoformat(), "trigger": "MANUAL", "ai_state": "SKIPPED_MANUAL_QUANT_ONLY"}
                store.finish_cycle(store.start_cycle("MANUAL"), "OK", payload=manual)
                with mock.patch("services.autonomiq_pro.orchestrator.datetime", wraps=datetime) as dt:
                    dt.now.return_value = NOW
                    snapshot = await engine.snapshot()
                self.assertEqual(snapshot["cycle"], manual)
                if at.date() != NOW.date():
                    self.assertIsNone(snapshot["last_scheduled"])
                else:
                    prior = snapshot["last_scheduled"]["signals"]["NIFTY"]
                    self.assertEqual(prior["action"], "WAIT")
                    self.assertEqual(prior["ai_action"], "WAIT")
                    self.assertEqual(prior["reasoning"], "Await a pullback")
                    self.assertNotIn("plan", prior)
        collector.gateway.client.assert_not_called()
        self.assertEqual(store.ai_usage(DAY)["calls"], 0)

    def test_buy_alerts_and_history_distinguish_blocked_candidates_from_submissions(self):
        from services.autonomiq_pro.orchestrator import AutonomiqOrchestrator

        store = memory_store()
        self.addCleanup(store.close)
        engine = AutonomiqOrchestrator(store, collector=mock.Mock())
        decision = {"symbol": "SENSEX", "action": "BUY_CE", "reasoning": "Aligned trend",
                    "risk": {"approved": False}, "execution": {
                        "status": "BLOCKED", "detail": "Risk per trade: 1282 > 1000"}}
        engine._alert_on_change("SENSEX", decision)
        engine._alert_on_change("SENSEX", decision)
        self.assertEqual(len(store.alerts()), 1)
        self.assertEqual(store.alerts(1)[0]["level"], "warning")
        self.assertIn("BUY CE · BLOCKED", store.alerts(1)[0]["message"])
        self.assertIn("1282 > 1000", store.alerts(1)[0]["message"])
        store.add_decision(store.start_cycle("SCHEDULED"), DAY, decision)
        self.assertEqual(store.decisions(1)[0]["execution"], decision["execution"])
        decision["execution"] = {"status": "ENTRY_PENDING", "detail": "Fill is not confirmed"}
        engine._alert_on_change("SENSEX", decision)
        self.assertEqual(len(store.alerts()), 2)
        self.assertEqual(store.alerts(1)[0]["level"], "info")
        self.assertIn("ENTRY PENDING", store.alerts(1)[0]["message"])

    async def test_risk_validation_uses_live_losses_trade_count_and_cooldown(self):
        from services.autonomiq_pro.orchestrator import AutonomiqOrchestrator

        store = memory_store()
        self.addCleanup(store.close)
        plan = build_plan("NIFTY", "BUY_CE", chain(), atr_5m=5, cfg=CFG)
        trade_id = store.create_live_trade({
            "signal_key": "prior-loss", "tag": "APRO1234567890", "account_id": "owner", "day": DAY,
            **plan, "quantity": plan["lot_size"],
        })
        store.update_live_trade(trade_id, status="CLOSED", entry_filled=65, exit_filled=65,
                                pnl=-3000, closed_at=(NOW - timedelta(minutes=5)).isoformat())
        collector = mock.Mock()
        collector.spot = mock.AsyncMock(return_value={"price": 22500, "age_s": 1})
        collector.collect_sync.return_value = {
            "errors": [], "candles": {"5m": [1], "15m": [1]}, "options": chain(), "futures": None,
        }
        collector.execution_candles.return_value = (execution_history(22500, 5), execution_history())
        ai = mock.Mock()
        ai.status.return_value = "ACTIVE"
        ai.complete_json = mock.AsyncMock(return_value={
            "indices": {"NIFTY": {"action": "BUY_CE", "conviction": 80, "reasoning": "Aligned"}}})
        cfg = AutonomiqConfig(ai_enabled=True, live_execution_allowed=True, max_trades_per_day=1)
        engine = AutonomiqOrchestrator(store, collector, ai)
        engine.cfg = cfg
        quant = {"score": 80, "bias": "BULLISH", "flags": [], "factors": [], "pcr": 1, "atm_iv": 14}
        with mock.patch("services.autonomiq_pro.orchestrator.datetime", wraps=datetime) as dt, \
                mock.patch.object(agents.MarketAnalysisAgent, "run", return_value={"atr_5m": 5}), \
                mock.patch.object(agents.QuantResearchAgent, "run", return_value=quant):
            dt.now.return_value = NOW
            payload = await engine._analyze(cfg, NOW, DAY, session_state(cfg, NOW), "SCHEDULED",
                                            store.start_cycle("SCHEDULED"))
        signal = payload["indices"]["NIFTY"]["signal"]
        self.assertFalse(signal["risk"]["approved"])
        failures = {check["name"] for check in signal["risk"]["checks"] if not check["passed"]}
        self.assertTrue({"Daily trade limit", "Daily loss limit", "Re-entry cooldown"} <= failures)
        self.assertEqual(signal["execution"]["status"], "OFF")

    async def test_each_index_uses_current_clock_and_revalidates_spot_after_ai(self):
        from services.autonomiq_pro.orchestrator import AutonomiqOrchestrator

        current = NOW

        class Collector:
            async def spot(self, symbol, now):
                return {"price": 22500.0, "age_s": (now - current).total_seconds() + 1}

            def execution_candles(self, symbol, exchange, trading_symbol, now):
                return execution_history(22500, 5), execution_history()

            def collect_sync(self, symbol, spot_price, now):
                nonlocal current
                current += timedelta(seconds=8)
                return {"symbol": symbol, "errors": [], "candles": {"5m": [1], "15m": [1]},
                        "futures": None, "options": chain()}

        async def strategy(*args):
            nonlocal current
            self.assertTrue(all(ctx["spot"]["fresh"] for ctx in args[-1]["indices"].values()))
            current += timedelta(seconds=20)
            return {"indices": {s: {"action": "BUY_CE", "conviction": 80, "reasoning": "Aligned"}
                                for s in ("NIFTY", "BANKNIFTY", "SENSEX")}}

        store = memory_store()
        self.addCleanup(store.close)
        ai = mock.Mock()
        ai.status.return_value = "ACTIVE"
        ai.complete_json = mock.AsyncMock(side_effect=strategy)
        engine = AutonomiqOrchestrator(store, Collector(), ai)
        cfg = AutonomiqConfig(ai_enabled=True, live_execution_allowed=True)
        engine.cfg = cfg
        quant = {"score": 80, "bias": "BULLISH", "flags": [], "factors": [], "pcr": 1, "atm_iv": 14}
        with mock.patch("services.autonomiq_pro.orchestrator.datetime", wraps=datetime) as dt, \
                mock.patch.object(agents.MarketAnalysisAgent, "run", return_value={"atr_5m": 5}), \
                mock.patch.object(agents.QuantResearchAgent, "run", return_value=quant), \
                mock.patch.object(engine.live_executor, "submit_entry", new=mock.AsyncMock(
                    return_value={"status": "OFF", "detail": "Owner switch OFF"})) as submit:
            dt.now.side_effect = lambda *args: current
            payload = await engine._analyze(cfg, NOW, DAY, session_state(cfg, NOW), "SCHEDULED",
                                            store.start_cycle("SCHEDULED"))
        for index in payload["indices"].values():
            self.assertEqual(index["signal"]["action"], "BUY_CE", index["signal"])
            self.assertEqual(index["spot"]["age_s"], 1)
            self.assertEqual(index["signal"]["timestamp"], current.isoformat())
        self.assertEqual(submit.await_count, 3)
        self.assertTrue(all(call.kwargs["now"] == current for call in submit.await_args_list))

    async def test_stale_cycle_runs_ai_but_remains_no_trade_and_snapshot_serialises(self):
        from services.autonomiq_pro.orchestrator import AutonomiqOrchestrator

        class StaleCollector:
            async def spot(self, symbol, now):
                return {"price": 22500.0, "age_s": 300.0}

            def collect_sync(self, symbol, spot_price, now):
                return {"symbol": symbol, "errors": ["candles: TokenException"], "candles": {},
                        "futures": None, "options": None}

        store = memory_store()
        calls = []

        def handler(request):
            calls.append(json.loads(request.content))
            return anthropic_reply({"market_alert": {"tone": "CAUTION", "title": "Stale", "detail": "No trade"},
                                    "summary": "Inputs are stale.", "indices": {
                                        symbol: {"action": "WAIT", "conviction": 0, "reasoning": "Stale inputs",
                                                 "risks": []}
                                        for symbol in ("NIFTY", "BANKNIFTY", "SENSEX")
                                    }})

        transport = httpx.MockTransport(handler)
        engine = AutonomiqOrchestrator(store, StaleCollector(), AIClient(store, transport))
        engine.cfg = CFG
        with mock.patch("services.autonomiq_pro.orchestrator.datetime", wraps=datetime) as dt:
            dt.now.return_value = NOW
            payload = await engine.run_cycle("SCHEDULED")
        self.assertEqual({i["signal"]["action"] for i in payload["indices"].values()}, {"NO_TRADE"})
        self.assertEqual(len(calls), 1)
        self.assertEqual(list(json.loads(calls[0]["messages"][0]["content"])["indices"]),
                         ["NIFTY", "BANKNIFTY", "SENSEX"])
        self.assertEqual(store.ai_usage(payload["at"][:10])["calls"], 1)
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
        from services.autonomiq_pro.orchestrator import next_slot, slot_run_at, slot_start
        start = IST.localize(datetime(2026, 3, 10, 9, 0))
        self.assertEqual(slot_run_at(start, 5), IST.localize(datetime(2026, 3, 10, 9, 0, 5)))
        self.assertEqual(next_slot(start, 5), IST.localize(datetime(2026, 3, 10, 9, 5, 5)))
        at = IST.localize(datetime(2026, 3, 10, 9, 21, 30))
        self.assertEqual(slot_start(at, 5), IST.localize(datetime(2026, 3, 10, 9, 20)))
        self.assertEqual(next_slot(at, 5), IST.localize(datetime(2026, 3, 10, 9, 25, 5)))

    async def test_restart_does_not_replay_a_claimed_slot_and_overwrite_the_scheduled_result(self):
        from services.autonomiq_pro.orchestrator import slot_start

        engine = self.engine()
        engine.store.set_state("ai_slot", slot_start(NOW, 5).isoformat())
        payload = {"at": NOW.isoformat(), "ai_state": "ACTIVE", "indices": {}}
        engine.store.finish_cycle(engine.store.start_cycle("SCHEDULED"), "OK", payload=payload)
        with mock.patch("services.autonomiq_pro.orchestrator.datetime", wraps=datetime) as dt, \
                mock.patch("services.autonomiq_pro.orchestrator.load_config", return_value=CFG), \
                mock.patch.object(engine, "_guarded_cycle", new=mock.AsyncMock()) as cycle:
            dt.now.return_value = NOW + timedelta(minutes=2)
            await engine._tick()
            if engine._cycle_task:
                await engine._cycle_task
            cycle.assert_not_awaited()
            self.assertEqual(engine.next_run_at, NOW + timedelta(minutes=5, seconds=5))
            self.assertEqual(engine.store.last_cycle()["payload"], payload)
            dt.now.return_value = NOW + timedelta(minutes=5, seconds=5)
            await engine._tick()
            await engine._cycle_task
            cycle.assert_awaited_once_with("SCHEDULED")

    async def test_scheduler_starts_at_nine_and_repeats_every_five_minutes(self):
        class FixedDateTime(datetime):
            current = None

            @classmethod
            def now(cls, tz=None):
                return cls.current

        engine = self.engine()
        with mock.patch("services.autonomiq_pro.orchestrator.datetime", FixedDateTime), \
                mock.patch.object(engine, "_guarded_cycle", new=mock.AsyncMock()) as cycle:
            FixedDateTime.current = IST.localize(datetime(2026, 3, 10, 9, 0))
            await engine._tick()
            self.assertEqual(engine.next_run_at, IST.localize(datetime(2026, 3, 10, 9, 0, 5)))
            cycle.assert_not_awaited()

            FixedDateTime.current = IST.localize(datetime(2026, 3, 10, 9, 0, 5))
            await engine._tick()
            await engine._cycle_task
            self.assertEqual(engine.next_run_at, IST.localize(datetime(2026, 3, 10, 9, 5, 5)))

            FixedDateTime.current = IST.localize(datetime(2026, 3, 10, 9, 5, 5))
            await engine._tick()
            await engine._cycle_task
            self.assertEqual(engine.next_run_at, IST.localize(datetime(2026, 3, 10, 9, 10, 5)))

            engine.next_run_at = None
            FixedDateTime.current = IST.localize(datetime(2026, 3, 10, 9, 7))
            await engine._tick()
            await engine._cycle_task
            self.assertEqual(engine.next_run_at, IST.localize(datetime(2026, 3, 10, 9, 10, 5)))
            self.assertEqual(cycle.await_count, 3)

            engine.next_run_at = IST.localize(datetime(2026, 3, 10, 15, 20, 5))
            FixedDateTime.current = engine.next_run_at
            await engine._tick()
            await engine._cycle_task
            self.assertEqual(cycle.await_count, 4)

    def test_scheduled_ai_runs_without_quant_setup_and_reports_stale_inputs(self):
        engine = self.engine()
        setup = {"NIFTY": self.ctx(), "BANKNIFTY": self.ctx(score=10), "SENSEX": self.ctx(fresh=False)}
        self.assertEqual(self.gate(engine, setup, "MANUAL"), ("SKIPPED_MANUAL_QUANT_ONLY", {}))
        self.assertEqual(list(self.gate(engine, {"NIFTY": self.ctx(score=10)})[1]), ["NIFTY"])
        self.assertEqual(list(self.gate(engine, {"NIFTY": self.ctx(fresh=False)})[1]), ["NIFTY"])
        self.assertEqual(list(self.gate(engine, setup)[1]), ["NIFTY", "BANKNIFTY", "SENSEX"])
        preopen = IST.localize(datetime(2026, 3, 10, 9, 5))
        self.assertEqual(session_state(CFG, preopen)["phase"], "PRE_MARKET")
        self.assertEqual(list(self.gate(engine, setup, now=preopen)[1]), ["NIFTY", "BANKNIFTY", "SENSEX"])
        before_start = IST.localize(datetime(2026, 3, 10, 8, 59))
        self.assertEqual(self.gate(engine, setup, now=before_start)[0], "SKIPPED_OUTSIDE_WINDOW")

        engine.store.open_paper_trade(
            {"signal_key": "held", "day": DAY, "symbol": "NIFTY", "exchange": "NFO", "tradingsymbol": "X",
             "option_type": "CE", "lot_size": 65, "lots": 1, "entry": 100, "stop_loss": 85,
             "trailing_sl": 85, "target1": 115, "target2": 130, "risk": 15})
        self.assertEqual(list(self.gate(engine, setup)[1]), ["NIFTY", "BANKNIFTY", "SENSEX"])

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
        with mock.patch("services.autonomiq_pro.orchestrator.datetime", wraps=datetime) as dt, \
                mock.patch.object(agents.MarketAnalysisAgent, "run", return_value={"atr_5m": 20.0}), \
                mock.patch.object(agents.QuantResearchAgent, "run", side_effect=quant):
            dt.now.return_value = NOW
            payload = await engine._analyze(CFG, NOW, DAY, session_state(CFG, NOW), "SCHEDULED",
                                            store.start_cycle("SCHEDULED"))
            again = await engine._analyze(CFG, NOW, DAY, session_state(CFG, NOW), "SCHEDULED",
                                          store.start_cycle("SCHEDULED"))

        self.assertTrue(payload["indices"]["NIFTY"]["signal"]["risk"]["approved"])
        self.assertEqual(payload["indices"]["NIFTY"]["signal"]["quant_action"], "BUY_CE")
        self.assertEqual(payload["indices"]["NIFTY"]["signal"]["ai_action"], "BUY_CE")
        self.assertFalse(engine.runtime()["auto_paper_trading"])
        self.assertEqual(store.open_trades(), [])
        self.assertEqual(len(calls), 1)
        self.assertEqual(list(json.loads(calls[0]["messages"][0]["content"])["indices"]),
                         ["NIFTY", "BANKNIFTY", "SENSEX"])
        self.assertEqual(again["ai_state"], "SKIPPED_SLOT_ALREADY_ANALYZED")
        self.assertIsNone(again["indices"]["NIFTY"]["signal"]["ai_action"])
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

    def test_neutral_quant_does_not_hide_unavailable_ai(self):
        for state in ("DAILY_BUDGET_INSUFFICIENT", "OUTPUT_TOKEN_LIMIT", "SKIPPED_MANUAL_QUANT_ONLY"):
            with self.subTest(state=state):
                signal = agents.SignalValidationAgent().run("NIFTY", self.ctx(score=0), None, 60, True, state)
                self.assertEqual(signal["action"], "WAIT")
                self.assertIn(state, signal["reasoning"])
                self.assertEqual(signal["source"], "quant")

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
        self.assertIn("Estimated per-trade loss ₹1,002.50 exceeds ₹1,000.00", reasons)
        with self.assertRaisesRegex(ValueError, "one lot"):
            self.candidate(quantity=100).estimated_loss()

    def test_independent_and_global_loss_limits_include_pending_risk(self):
        candidate = self.candidate()
        reasons = self.rejections(candidate, realized_net={**self.zero_pnl, "NIFTY": -700},
                                  exposures=[], pending=[], trades_today=1)
        self.assertTrue(any("Index daily loss budget exceeded" in reason for reason in reasons))
        reasons = self.rejections(candidate, realized_net={**self.zero_pnl, "BANKNIFTY": -900, "SENSEX": -900},
                                  exposures=[Exposure("BANKNIFTY", -200, 300)],
                                  pending=[Exposure("SENSEX", 0, 400)], trades_today=2)
        self.assertTrue(any("Global daily loss budget exceeded" in reason for reason in reasons))
        self.assertFalse(any("Index daily loss budget exceeded" in reason for reason in reasons))

    def test_configured_index_budget_includes_costs_pending_risk_and_global_limit(self):
        candidate = self.candidate(
            symbol="BANKNIFTY", entry=490.2, stop=435.75, quantity=30, lot_size=30,
            estimated_round_trip_cost=150, estimated_exit_slippage=147.06)
        loss = candidate.estimated_loss()
        self.assertAlmostEqual(loss, 1930.56)
        state = dict(realized_net=self.zero_pnl, exposures=[], pending=[], trades_today=0)
        for limit, blocked in ((1000, True), (loss, False), (loss - 0.01, True), (2000, False)):
            with self.subTest(limit=limit):
                cfg = AutonomiqConfig(max_risk_per_trade_rupees=2000, index_daily_loss_limit_rupees=limit,
                                      daily_loss_limit_rupees=3500)
                reasons = entry_rejections(candidate, cfg=cfg, **state)
                self.assertEqual(bool(reasons), blocked)
                if limit == 1000:
                    self.assertIn("₹1,930.56 exceeds available ₹1,000.00", reasons[0])
                    self.assertIn("reserved ₹0.00", reasons[0])
        cfg = AutonomiqConfig(max_risk_per_trade_rupees=2000, index_daily_loss_limit_rupees=2000,
                              daily_loss_limit_rupees=3500)
        reasons = entry_rejections(candidate, cfg=cfg, **{
            **state, "pending": [Exposure("BANKNIFTY", 0, 100)]})
        self.assertTrue(any("available ₹1,900.00" in reason and "reserved ₹100.00" in reason for reason in reasons))
        reasons = entry_rejections(candidate, cfg=cfg, **{
            **state, "realized_net": {**self.zero_pnl, "NIFTY": -1700}})
        self.assertTrue(any("Global daily loss budget exceeded" in reason for reason in reasons))
        self.assertFalse(any("Index daily loss budget exceeded" in reason for reason in reasons))
        with self.assertRaisesRegex(ValueError, "index daily loss limit"):
            entry_rejections(candidate, cfg=AutonomiqConfig(index_daily_loss_limit_rupees=float("nan")), **state)

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
        self.assertIn("Estimated per-trade loss ₹400.00 exceeds ₹300.00", reasons)
        self.assertTrue(any("Global daily loss budget exceeded" in reason for reason in reasons))
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
    def test_hybrid_stop_respects_candle_low_and_targets_include_costs(self):
        candles = execution_history()
        candles[-1]["low"] = 85
        levels = hybrid_levels(entry=100, bid=99.5, quantity=65, delta=.5, option_type="CE",
                               index_candles=execution_history(22500, 5), option_candles=candles, cfg=CFG)
        self.assertLess(levels["stop_loss"], 85)
        costs = CFG.estimated_round_trip_cost_rupees / 65 + 1
        loss = 100 - levels["stop_loss"] + costs
        self.assertGreaterEqual(levels["target1"] - 100 - costs, loss)
        self.assertGreaterEqual(levels["target2"] - 100 - costs, 2 * loss)

    def test_hybrid_support_resistance_is_directional_and_blocks_poor_room(self):
        for kind, delta in (("CE", .5), ("PE", -.5)):
            with self.subTest(kind=kind):
                candles = execution_history(22500, 5)
                candles[8]["high" if kind == "CE" else "low"] += 5 if kind == "CE" else -5
                with self.assertRaisesRegex(ValueError, "Insufficient room"):
                    hybrid_levels(entry=100, bid=99.5, quantity=65, delta=delta, option_type=kind,
                                  index_candles=candles, option_candles=execution_history(), cfg=CFG)

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

    def test_one_lot_banknifty_risk_rejection_explains_actual_stop_cost(self):
        option = leg("BANKNIFTYTESTCE", ask=506.7, bid=505.15, delta=0.5249)
        option["lot_size"] = 30
        option_chain = {"atm": 62400.0, "expiry": "2026-03-12", "exchange": "NFO",
                        "strikes": [{"strike": 62400.0, "CE": option}]}
        plan = build_plan("BANKNIFTY", "BUY_CE", option_chain, atr_5m=63.73, cfg=CFG)
        self.assertAlmostEqual(plan["risk_rupees"], 1519.50)
        self.assertEqual((plan["lot_size"], plan["lots"]), (30, 1))
        result = self.evaluate(plan)
        check = next(check for check in result["checks"] if check["name"] == "Risk per trade")
        self.assertFalse(check["passed"])
        self.assertIn("₹1,519.50 exceeds ₹1,000.00", check["detail"])
        self.assertIn("30 units x 50.65", check["detail"])
        self.assertIn("before fees/slippage", check["detail"])
        self.assertFalse(result["approved"])

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
