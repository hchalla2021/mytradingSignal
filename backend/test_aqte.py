import asyncio
import math
import queue
import tempfile
import time
import unittest
from dataclasses import replace
from datetime import datetime
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.aqte_engine import (
    AQTEEngine, CandleBook, Contract, IST, Policy, Tick,
    intelligence, strategy,
)
from services.aqte_replay import replay, replay_database
from services.aqte_service import AQTEService, normalize

START = datetime(2026, 10, 30, 9, 15, tzinfo=IST).timestamp()
NOW = START + 202 * 60
CONTRACT = Contract("NIFTY", 30, "NIFTY26NOV22000CE", "NFO", "CE",
                    22000, "2026-11-03", 15, 0.05)


def tick(kind="future", at=NOW, **values):
    defaults = dict(symbol="NIFTY", kind=kind, token={"spot": 10, "future": 20, "option": 30}[kind],
                    price=22000, at=at, received=at, volume=100_000,
                    bid=21999, ask=22001, bid_quantity=100, ask_quantity=100,
                    buy_depth=200, sell_depth=100)
    if kind == "option":
        defaults.update(price=100, bid=99, ask=101)
    defaults.update(values)
    return Tick(**defaults)


def ready_engine(**policy):
    engine = AQTEEngine(Policy(**policy))
    engine.contracts[30] = CONTRACT
    for i in range(202):
        at = START + i * 60
        engine.ingest(tick("spot", at=at, price=22000 + i * 0.2))
        engine.ingest(tick("option", at=at))
        engine.ingest(tick(at=at, price=22000 + i * 0.2, volume=i * 1000))
    # A gentle trend within ATR of EMA20, with rising volume.
    bars = engine.book.closed[("future", 20, 60)]
    for bar in bars:
        bar.update(high=bar["close"] + 5, low=bar["close"] - 5)
    engine.ingest(tick("spot", at=NOW, price=22040))
    engine.ingest(tick("option", at=NOW))
    engine.ingest(tick(at=NOW, price=22040.4, volume=202_000))
    return engine


class CandleTests(unittest.TestCase):
    def test_all_intervals_and_incremental_volume_without_first_tick_volume_spike(self):
        book = CandleBook()
        book.add(tick(at=START, volume=1000))
        book.add(tick(at=START + 0.5, volume=1012, price=22002))
        book.add(tick(at=START + 301, volume=1020, price=21999))
        for interval in (1, 5, 15, 60, 180, 300):
            bar = book.closed[("future", 20, interval)][0]
            self.assertEqual(bar["volume"], 12)
            self.assertEqual((bar["open"], bar["high"], bar["low"], bar["close"]),
                             (22000, 22002, 22000, 22002))

    def test_same_exchange_second_can_update_price_depth_and_volume(self):
        book = CandleBook()
        self.assertTrue(book.add(tick(at=START, received=START + 0.1, volume=100)))
        self.assertTrue(book.add(tick(at=START, received=START + 0.2, volume=105, price=22003)))
        self.assertEqual(book.current[("future", 20, 1)]["volume"], 5)
        self.assertFalse(book.add(tick(at=START - 1, received=START + 0.3)))

    def test_missing_bars_not_fabricated_and_contracts_not_mixed(self):
        book = CandleBook()
        book.add(tick(at=START))
        book.add(tick(at=START + 300))
        book.add(tick(at=START + 301, token=21))
        self.assertEqual(len(book.closed[("future", 20, 60)]), 1)
        self.assertEqual(len(book.closed[("future", 21, 60)]), 0)

    def test_no_signal_until_201_contiguous_completed_candles(self):
        engine = ready_engine()
        bars = list(engine.book.closed[("future", 20, 60)])
        self.assertIsNone(intelligence(bars[:200], tick()))
        bars[-1] = {**bars[-1], "at": bars[-1]["at"] + 60}
        self.assertIsNone(intelligence(bars, tick()))

    def test_intelligence_and_all_strategy_families(self):
        engine = ready_engine()
        info = engine.signals["NIFTY"]["intelligence"]
        self.assertEqual(set(info["ema"]), {"9", "20", "50", "100", "200"})
        self.assertEqual(info["supertrend"], "BULLISH")
        self.assertGreater(info["atr"], 0)
        self.assertGreater(info["vwap"], 0)
        base = {**info, "breakout": 0, "sweep": 0, "close": info["ema"]["20"]}
        self.assertEqual(strategy(base)[0], "trend_continuation")
        self.assertEqual(strategy({**base, "breakout": 1, "volume_ratio": 2})[0], "momentum_breakout")
        self.assertEqual(strategy({**base, "sweep": -1, "imbalance": 0})[:2], ("liquidity_reversal", "PE"))
        mean = {**base, "ema": {str(n): 100 for n in (9, 20, 50, 100, 200)},
                "close": 60, "vwap": 100, "atr": 10, "rsi": 20, "imbalance": 0}
        self.assertEqual(strategy(mean)[:2], ("mean_reversion", "CE"))
        self.assertIsNone(strategy({**mean, "imbalance": -0.5}))


class ExecutionTests(unittest.TestCase):
    def test_position_metrics_use_option_bid_depth_and_estimated_costs_without_mutation(self):
        engine = ready_engine()
        engine.ingest(tick("option", at=NOW + 1, bid=98, ask=99, price=99))
        order = engine.orders["NIFTY"]
        engine.ingest(tick("option", at=NOW + 2, bid=122, ask=123, price=123))
        metrics = engine.snapshot(NOW + 2)["data"]["NIFTY"]["position"]["metrics"]
        points = 122 - order["entry_price"]
        self.assertAlmostEqual(metrics["points"], round(points, 2))
        self.assertEqual(metrics["ltp"], 123)
        self.assertEqual(metrics["bid"], 122)
        self.assertEqual(metrics["quantity"], CONTRACT.lot_size)
        self.assertEqual(metrics["gross_pnl"], round(points * CONTRACT.lot_size, 2))
        self.assertEqual(metrics["net_pnl"], round(
            points * CONTRACT.lot_size - order["entry_cost"] - engine.costs(122, CONTRACT.lot_size), 2))
        self.assertGreater(metrics["peak_points"], 0)
        self.assertGreater(metrics["stop_points"], 0)
        self.assertNotIn("metrics", order)
        self.assertIsNone(engine.snapshot(NOW + 20)["data"]["NIFTY"]["position"]["metrics"]["net_pnl"])
        self.assertIsNone(engine.position_metrics(order, NOW + 2, healthy=False)["ltp"])
        engine.options[30] = tick("option", at=NOW + 2, bid=122, ask=123, bid_quantity=1)
        shallow = engine.position_metrics(order, NOW + 2)
        self.assertIsNone(shallow["points"])
        self.assertIsNone(shallow["net_pnl"])
        self.assertEqual(shallow["ltp"], 100)

    def test_pending_position_metrics_have_no_invented_entry_or_profit(self):
        engine = ready_engine()
        metrics = engine.snapshot(NOW)["data"]["NIFTY"]["position"]["metrics"]
        self.assertIsNone(metrics["points"])
        self.assertIsNone(metrics["net_pnl"])
        self.assertIsNone(metrics["peak_points"])

    def test_explainable_entry_one_lot_no_signal_tick_fill_and_no_duplicates(self):
        engine = ready_engine()
        signal = engine.signals["NIFTY"]
        self.assertEqual(signal["decision"], "BUY CE")
        self.assertFalse(signal["model_validated"])
        self.assertLess(signal["entry"]["maximum"], 101)
        self.assertEqual(signal["entry"]["quantity"], CONTRACT.lot_size)
        self.assertIsNone(engine.orders["NIFTY"]["entry_at"])
        engine.analyze("NIFTY", NOW)
        self.assertEqual(sum(e["kind"] == "LIMIT_CREATED" for e in engine.events), 1)
        engine.ingest(tick("option", at=NOW + 1, bid=98.8, ask=99.5, price=99.5))
        self.assertAlmostEqual(engine.orders["NIFTY"]["entry_price"], 99.55)
        self.assertGreater(engine.orders["NIFTY"]["entry_at"], NOW)

    def test_no_chasing_and_pending_order_expiry(self):
        engine = ready_engine()
        engine.ingest(tick("option", at=NOW + 1, bid=109, ask=110, price=110))
        self.assertIsNone(engine.orders["NIFTY"]["entry_at"])
        engine.manage(NOW + 31)
        self.assertNotIn("NIFTY", engine.orders)
        self.assertIn("LIMIT_CANCELLED", [e["kind"] for e in engine.events])

    def test_gap_below_planned_stop_cancels_instead_of_opening_invalid_risk(self):
        engine = ready_engine()
        engine.ingest(tick("option", at=NOW + 1, bid=69, ask=70, price=70))
        self.assertNotIn("NIFTY", engine.orders)
        self.assertEqual(len(engine.trades), 0)
        self.assertEqual(engine.events[-1]["kind"], "LIMIT_CANCELLED")

    def test_illiquid_stale_expired_and_unaffordable_contracts_are_wait(self):
        for change in (
            {"ask_quantity": 1}, {"ask": 110}, {"bid": 0}, {"volume": 0},
            {"at": NOW - 10, "received": NOW - 10},
        ):
            with self.subTest(change=change):
                engine = ready_engine()
                engine.orders.clear()
                engine.options[30] = replace(tick("option"), **change)
                engine.analyze("NIFTY", NOW)
                self.assertEqual(engine.signals["NIFTY"]["decision"], "WAIT")
        engine = ready_engine()
        engine.orders.clear()
        engine.contracts[30] = replace(CONTRACT, expiry="2026-10-29")
        engine.analyze("NIFTY", NOW)
        self.assertEqual(engine.signals["NIFTY"]["decision"], "WAIT")
        self.assertEqual(ready_engine(risk_fraction=0.0001).signals["NIFTY"]["decision"], "WAIT")

    def test_gap_stop_costs_and_trailing(self):
        engine = ready_engine()
        engine.ingest(tick("option", at=NOW + 1, bid=98, ask=99, price=99))
        opened = dict(engine.orders["NIFTY"])
        engine.ingest(tick("option", at=NOW + 2, bid=122, ask=123, price=122))
        self.assertGreater(engine.orders["NIFTY"]["stop"], opened["stop"])
        engine.ingest(tick("option", at=NOW + 3, bid=70, ask=71, price=70))
        trade = engine.trades[0]
        self.assertEqual(trade["exit_reason"], "STOP_LOSS")
        self.assertAlmostEqual(trade["exit_price"], 69.95)
        self.assertLess(trade["net_pnl"], (69.95 - opened["entry_price"]) * CONTRACT.lot_size)

    def test_target_cannot_receive_favourable_gap_improvement(self):
        engine = ready_engine()
        engine.ingest(tick("option", at=NOW + 1, bid=98, ask=99, price=99))
        target = engine.orders["NIFTY"]["target"]
        engine.ingest(tick("option", at=NOW + 2, bid=target + 10, ask=target + 11, price=target + 10))
        self.assertEqual(engine.trades[0]["exit_price"], target)

    def test_risk_limits_and_kill_wait_for_fresh_exit_quote(self):
        engine = ready_engine()
        engine.ingest(tick("option", at=NOW + 1, bid=98, ask=99, price=99))
        engine.killed = True
        engine.manage(NOW + 10)
        self.assertIn("NIFTY", engine.orders, "Never invent fills on a stale quote")
        engine.ingest(tick("option", at=NOW + 11, bid=90, ask=91, price=90))
        self.assertEqual(engine.trades[0]["exit_reason"], "KILL_SWITCH")
        self.assertTrue(any(e["kind"] == "OPTION_DATA_GAP" for e in engine.events))
        engine.killed = False
        engine.policy = replace(engine.policy, max_trades=1)
        self.assertEqual(engine.risk_reason(NOW + 11), "Maximum daily trades reached")
        engine.policy = replace(engine.policy, max_trades=5, max_losses=1)
        self.assertEqual(engine.risk_reason(NOW + 11), "Consecutive-loss limit reached")
        engine.policy = replace(engine.policy, max_losses=3, daily_loss=10)
        self.assertEqual(engine.risk_reason(NOW + 11), "Daily loss limit reached")

    def test_snapshot_never_displays_stale_buy_or_other_index_signal(self):
        engine = ready_engine()
        self.assertEqual(engine.snapshot(NOW)["data"]["NIFTY"]["decision"], "BUY CE")
        self.assertEqual(engine.snapshot(NOW)["data"]["BANKNIFTY"]["decision"], "WAIT")
        engine.options[30] = replace(engine.options[30], at=NOW - 10)
        self.assertEqual(engine.snapshot(NOW)["data"]["NIFTY"]["decision"], "WAIT")
        self.assertEqual(engine.snapshot(NOW + 10)["data"]["NIFTY"]["decision"], "WAIT")

    def test_daily_loss_uses_portfolio_not_just_one_position(self):
        engine = ready_engine()
        engine.ingest(tick("option", at=NOW + 1, bid=98, ask=99, price=99))
        order = engine.orders["NIFTY"]
        order["stop"] = 50
        second = {**order, "id": "second", "symbol": "BANKNIFTY", "token": 31,
                  "contract": {**order["contract"], "symbol": "BANKNIFTY", "token": 31}}
        engine.orders["BANKNIFTY"] = second
        engine.policy = replace(engine.policy, daily_loss=500)
        engine.options[30] = tick("option", at=NOW + 2, bid=80, ask=81, price=80)
        engine.ingest(tick("option", at=NOW + 2, symbol="BANKNIFTY", token=31, bid=80, ask=81, price=80))
        self.assertEqual(engine.trades[0]["exit_reason"], "DAILY_LOSS")
        # The second leg needs its own next quote; never exit against another contract's tick.
        self.assertIn("NIFTY", engine.orders)
        engine.ingest(tick("option", at=NOW + 3, bid=80, ask=81, price=80))
        self.assertEqual(engine.trades[1]["exit_reason"], "DAILY_LOSS")

    def test_invalid_future_dated_and_stale_ticks_do_not_create_candles(self):
        engine = AQTEEngine()
        for price in (math.nan, math.inf, 0):
            with self.assertRaises(ValueError):
                engine.ingest(tick(price=price))
        engine.ingest(tick(at=NOW + 1, received=NOW))
        engine.ingest(tick(at=NOW - 10, received=NOW))
        self.assertFalse(engine.future)

    def test_no_new_entries_after_cutoff_and_session_exit(self):
        engine = ready_engine()
        engine.ingest(tick("option", at=NOW + 1, bid=98, ask=99, price=99))
        cutoff = datetime(2026, 10, 30, 15, 15, tzinfo=IST).timestamp()
        self.assertEqual(engine.risk_reason(cutoff), "No new entries after 15:15 IST")
        engine.ingest(tick("option", at=cutoff + 600, bid=100, ask=101, price=100))
        self.assertEqual(engine.trades[0]["exit_reason"], "SESSION_EXIT")


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "aqte.sqlite3"
        self.service = AQTEService(self.path)
        self.service.initialize()

    def test_index_receipt_timestamp_and_derivative_exchange_timestamp(self):
        raw = dict(instrument_token=10, last_price=22000)
        self.assertEqual(normalize("NIFTY", "spot", raw, NOW).at, NOW)
        with self.assertRaises(ValueError):
            normalize("NIFTY", "future", raw, NOW)
        raw["exchange_timestamp"] = datetime(2026, 10, 30, 12, 37)
        self.assertEqual(normalize("NIFTY", "future", raw, NOW).at, NOW)

    def test_restart_restores_orders_costs_kill_and_audit(self):
        self.service.engine = ready_engine()
        self.service.engine.ingest(tick("option", at=NOW + 1, bid=98, ask=99, price=99))
        with self.service.connect() as db:
            self.service.persist(db, [tick("option")])
        self.service.engine.events.clear()
        self.service.kill()
        restored = AQTEService(self.path, paper_enabled=True)
        restored.initialize()
        self.assertTrue(restored.engine.killed)
        self.assertEqual(restored.engine.orders, self.service.engine.orders)
        self.assertEqual(restored.engine.contracts[30], CONTRACT)
        events = restored.history(100)["events"]
        self.assertIn("KILL_SWITCH", [e["kind"] for e in events])
        with restored.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM aqte_ticks").fetchone()[0], 1)

    def test_subscriptions_use_active_kite_metadata_and_pin_open_contract(self):
        self.service.started = True
        kite, socket = Mock(), Mock()
        kite.instruments.side_effect = lambda exchange: [
            dict(name="NIFTY", instrument_type=side, instrument_token=token,
                 tradingsymbol=f"NIFTY{strike}{side}", exchange="NFO", expiry="2026-11-03",
                 strike=strike, lot_size=65, tick_size=0.05)
            for side, token, strike in (("CE", 30, 22000), ("PE", 31, 22000), ("CE", 32, 22100))
        ] if exchange == "NFO" else []
        with patch("services.aqte_service.time.time", return_value=NOW):
            self.service.configure(kite, socket, {"NIFTY": 22000})
            self.assertEqual(self.service.engine.contracts[30].lot_size, 65)
            self.assertEqual(socket.set_mode.call_args[0][1], [30, 31, 32])
            self.service.configure(kite, socket, {"NIFTY": 22000})
        self.assertEqual(kite.instruments.call_count, 2, "Daily catalog must be reused")
        kite.place_order.assert_not_called()

    def test_recording_overflow_latches_fault_and_ui_waits(self):
        self.service.started = True
        self.service.queue = queue.Queue(maxsize=1)
        raw = dict(instrument_token=10, last_price=22000)
        self.service.enqueue("NIFTY", "spot", raw)
        self.service.enqueue("NIFTY", "spot", raw)
        self.assertTrue(self.service.failed.is_set())
        self.assertFalse(self.service.snapshot()["recording"])
        self.assertTrue(all(s["decision"] == "WAIT" for s in self.service.snapshot()["data"].values()))

    def test_authenticated_kill_and_bounded_journal(self):
        self.service.engine.paper_enabled = True
        from routers.aqte import router
        from services.auth import auth_service
        app = FastAPI()
        app.include_router(router)
        client = TestClient(app)
        with patch("routers.aqte.get_aqte_service", return_value=self.service):
            self.assertIn(client.post("/api/aqte/kill").status_code, (401, 403))
            refresh = auth_service.create_refresh_token({"sub": "operator"})
            self.assertEqual(client.post("/api/aqte/kill", headers={"Authorization": f"Bearer {refresh}"}).status_code, 401)
            access = auth_service.create_access_token({"sub": "operator"})
            self.assertEqual(client.post("/api/aqte/kill", headers={"Authorization": f"Bearer {access}"}).status_code, 200)
            malformed = auth_service.create_access_token({})
            self.assertEqual(client.post("/api/aqte/kill", headers={"Authorization": f"Bearer {malformed}"}).status_code, 401)
            self.assertEqual(client.get("/api/aqte/journal?limit=501").status_code, 422)
            result = client.get("/api/aqte/snapshot")
            self.assertEqual(result.json()["mode"], "PAPER_ONLY")
            self.assertEqual(result.headers["cache-control"], "no-store")

    def test_production_analysis_disables_paper_and_preserves_saved_state(self):
        paper = ready_engine()
        paper.killed = True
        self.service.engine = paper
        with self.service.connect() as db:
            self.service.persist(db)
            saved = db.execute("SELECT payload FROM aqte_state WHERE id=1").fetchone()["payload"]
        analysis = AQTEService(self.path)
        analysis.initialize()
        self.assertFalse(analysis.engine.paper_enabled)
        self.assertFalse(analysis.engine.killed, "Archived paper stops must not block live analysis")
        self.assertEqual(analysis.engine.orders, {})
        self.assertEqual(analysis.engine.trades, [])
        analysis.engine = ready_engine()
        analysis.engine.paper_enabled = False
        analysis.engine.orders.clear()
        analysis.engine.events.clear()
        analysis.engine.ingest(tick(at=NOW + 1, volume=203_000))
        analysis.engine.manage(NOW + 2, tick("option", at=NOW + 2, ask=99, bid=98))
        self.assertEqual(analysis.engine.signals["NIFTY"]["decision"], "BUY CE")
        self.assertEqual(analysis.engine.orders, {})
        self.assertFalse(any(event["kind"] in ("LIMIT_CREATED", "FILLED", "CLOSED")
                             for event in analysis.engine.events))
        with analysis.connect() as db:
            analysis.persist(db)
            self.assertEqual(db.execute("SELECT payload FROM aqte_state WHERE id=1").fetchone()["payload"], saved)
        self.assertEqual(analysis.snapshot()["mode"], "ANALYSIS_ONLY")

    def test_disabled_paper_kill_cannot_stop_real_analysis(self):
        from routers.aqte import router
        from services.auth import auth_service
        app = FastAPI()
        app.include_router(router)
        client = TestClient(app)
        access = auth_service.create_access_token({"sub": "operator"})
        with patch("routers.aqte.get_aqte_service", return_value=self.service):
            response = client.post("/api/aqte/kill", headers={"Authorization": f"Bearer {access}"})
        self.assertEqual(response.status_code, 410)
        self.assertFalse(self.service.engine.killed)


class ReplayTests(unittest.TestCase):
    def test_replay_executes_same_strategy_without_looking_ahead(self):
        ticks = []
        for i in range(201):
            for offset, change in ((0, 0), (20, 5), (40, -5)):
                at = START + i * 60 + offset
                ticks.extend([tick("spot", at=at, price=22000 + i * 0.2),
                              tick("option", at=at),
                              tick(at=at, price=22000 + i * 0.2 + change,
                                   volume=i * 1000 + offset * 10)])
        at = START + 201 * 60
        ticks.extend([tick("spot", at=at), tick("option", at=at),
                      tick(at=at, price=22040.2, volume=201_000),
                      tick("option", at=at + 1, bid=98, ask=99, price=99),
                      tick("option", at=at + 2, bid=145, ask=146, price=145)])
        report = replay(ticks, [CONTRACT])
        self.assertEqual(report["closed"], 1)
        self.assertGreater(report["trades"][0]["entry_at"], at)
        self.assertEqual(report["trades"][0]["exit_reason"], "TARGET")
        stressed = replay(ticks, [CONTRACT], Policy(slippage_ticks=30))
        self.assertEqual(stressed["closed"], 0, "Higher slippage must not violate entry-price ceiling")

    def test_chronological_replay_and_no_forced_terminal_fills(self):
        with self.assertRaises(ValueError):
            replay([tick(at=NOW + 1), tick(at=NOW)], [CONTRACT])
        report = replay([tick("spot"), tick()], [CONTRACT])
        self.assertEqual((report["closed"], report["ticks"]), (0, 2))
        self.assertIsNone(report["win_rate"])
        self.assertIsNone(report["profit_factor"])

    def test_sqlite_replay_limits(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "aqte.sqlite3"
            service = AQTEService(path)
            service.initialize()
            with service.connect() as db:
                service.persist(db, [tick("spot"), tick()])
            self.assertEqual(replay_database(path, "2026-10-30")["ticks"], 2)
            with self.assertRaises(ValueError):
                replay_database(path, "2026-10-30", max_ticks=1)


class WorkerTests(unittest.IsolatedAsyncioTestCase):
    async def test_old_queued_quotes_are_recorded_but_not_executed(self):
        with tempfile.TemporaryDirectory() as directory:
            service = AQTEService(Path(directory) / "aqte.sqlite3")
            service.queue.put(tick("spot", at=time.time() - 60))
            await service.start()
            try:
                for _ in range(100):
                    events = await asyncio.to_thread(service.history, 10)
                    if events["events"]:
                        break
                    await asyncio.sleep(0.01)
                self.assertEqual(events["events"][0]["kind"], "PROCESSING_STALE_TICK")
                self.assertFalse(service.engine.spot)
            finally:
                await service.stop()
            with service.connect() as db:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM aqte_ticks").fetchone()[0], 1)

    async def test_background_recording_and_clean_shutdown(self):
        with tempfile.TemporaryDirectory() as directory:
            service = AQTEService(Path(directory) / "aqte.sqlite3")
            await service.start()
            try:
                self.assertTrue(service.worker.is_alive())
                service.enqueue("NIFTY", "spot", dict(instrument_token=10, last_price=22000))
                for _ in range(100):
                    result = await asyncio.to_thread(service.snapshot)
                    if result["data"]["NIFTY"]["spot"] == 22000:
                        break
                    await asyncio.sleep(0.01)
                self.assertEqual(result["data"]["NIFTY"]["spot"], 22000)
                self.assertTrue(result["recording"])
            finally:
                await service.stop()
            self.assertFalse(service.worker.is_alive())
            with service.connect() as db:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM aqte_ticks").fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main()
