import asyncio
import json
import sqlite3
import tempfile
import threading
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers.paper_trading import router
from services.paper_trading import IST, PaperTradingService


class PaperTradingTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "paper.sqlite3"
        self.service = PaperTradingService(self.path)
        self.at = datetime(2026, 10, 19, 10, 5, 1, tzinfo=IST)

    def tearDown(self):
        self.directory.cleanup()

    def frame(self, side="BUY", strategy="EMA 9/20 cross", candle=None, symbol="NIFTY"):
        return {
            "source": "observatory-chart", "symbol": symbol, "timeframe": 5,
            "candle_at": (candle or self.at.replace(minute=0, second=0)).isoformat(),
            "setup": {"ema": {"ema9": 101, "ema20": 100}, "volume": {"status": "UNAVAILABLE"}},
            "signals": [{"side": side, "strategy": strategy, "signal_price": 100,
                         "rationale": ["Closed chart candle cross"], "tags": ["EMA 9", "EMA 20"]}],
        }

    def tick(self, price, seconds=1, service=None):
        (service or self.service).process_tick("NIFTY", price, self.at + timedelta(seconds=seconds))

    def trades(self):
        return self.service.snapshot(self.at.date().isoformat())["trades"]

    def enter(self, side="BUY"):
        self.service.submit(self.frame(side), self.at)
        self.tick(100)
        return self.trades()[0]

    def test_fill_is_next_tick_not_backdated_signal_price_and_default_stop_is_exact(self):
        self.service.submit(self.frame(), self.at)
        self.service.process_tick("NIFTY", 90, self.at - timedelta(seconds=1))
        self.assertEqual(self.trades(), [])
        self.tick(105)
        trade = self.trades()[0]
        self.assertEqual(trade["entry_price"], 105.5)
        self.assertEqual(trade["trigger_price"], 105)
        self.assertEqual(trade["signal_price"], 100)
        self.assertEqual(trade["entry_price"] - trade["stop"], 10)
        self.assertEqual(trade["target"] - trade["entry_price"], 20)

    def test_buy_and_sell_stop_gaps_and_target_limits_are_symmetric(self):
        for side in ("BUY", "SELL"):
            with self.subTest(side=side), tempfile.TemporaryDirectory() as directory:
                service = PaperTradingService(Path(directory) / "paper.sqlite3")
                service.submit(self.frame(side), self.at)
                service.process_tick("NIFTY", 100, self.at + timedelta(seconds=1))
                sign = 1 if side == "BUY" else -1
                service.process_tick("NIFTY", 100 - sign * 15, self.at + timedelta(seconds=2))
                trade = service.snapshot(self.at.date().isoformat())["trades"][0]
                self.assertEqual(trade["exit_reason"], "STOP_LOSS")
                self.assertEqual(trade["points"], -16)
                self.assertEqual(trade["pnl"], -16)
                self.assertFalse(trade["target_achieved"])
                service.submit(self.frame(side, strategy="Second book"), self.at + timedelta(seconds=3))
                service.process_tick("NIFTY", 100, self.at + timedelta(seconds=4))
                service.process_tick("NIFTY", 100 + sign * 30, self.at + timedelta(seconds=5))
                winner = next(t for t in service.snapshot(self.at.date().isoformat())["trades"] if t["strategy"] == "Second book")
                self.assertEqual(winner["exit_reason"], "TARGET")
                self.assertEqual(winner["exit_price"], winner["target"])
                self.assertEqual(winner["points"], 20)

    def test_reversal_closes_same_strategy_only_and_opens_opposite_book(self):
        self.enter()
        self.service.submit(self.frame(strategy="Other strategy"), self.at)
        self.tick(101, 2)
        next_at = self.at + timedelta(minutes=5)
        self.service.submit(self.frame("SELL", candle=self.at.replace(minute=5, second=0)), next_at)
        self.service.process_tick("NIFTY", 102, next_at + timedelta(seconds=1))
        trades = self.trades()
        old = next(t for t in trades if t["side"] == "BUY" and t["strategy"] == "EMA 9/20 cross")
        self.assertEqual(old["exit_reason"], "REVERSAL")
        self.assertEqual(old["points"], 1)
        self.assertEqual(len([t for t in trades if not t["exit_at"]]), 2)
        self.assertTrue(any(t["side"] == "SELL" and not t["exit_at"] for t in trades))

    def test_duplicate_submission_restart_and_same_direction_signal_do_not_duplicate_trades(self):
        frame = self.frame()
        self.assertEqual(self.service.submit(frame, self.at)["accepted"], 1)
        restarted = PaperTradingService(self.path)
        self.assertEqual(restarted.submit(frame, self.at)["duplicates"], 1)
        self.tick(100, service=restarted)
        self.tick(100, 2, service=restarted)
        next_at = self.at + timedelta(minutes=5)
        restarted.submit(self.frame(candle=self.at.replace(minute=5, second=0)), next_at)
        restarted.process_tick("NIFTY", 102, next_at + timedelta(seconds=1))
        snapshot = restarted.snapshot(self.at.date().isoformat())
        self.assertEqual(len(snapshot["trades"]), 1)
        self.assertEqual(snapshot["signals"]["ALREADY_OPEN"], 1)
        self.assertEqual(snapshot["trades"][0]["setup"]["volume"]["status"], "UNAVAILABLE")

    def test_near_events_excursions_missed_target_and_post_exit_target_are_recorded(self):
        trade = self.enter()
        self.tick(119, 2)
        self.tick(119, 3)
        self.tick(92, 4)
        self.tick(89, 5)
        self.tick(125, 6)
        result = self.trades()[0]
        self.assertEqual(result["mfe"], 18.5)
        self.assertEqual(result["mae"], 11.5)
        self.assertTrue(result["missed_target"])
        self.assertTrue(result["target_after_exit"])
        events = self.service.events(trade["id"])
        kinds = [event["kind"] for event in events]
        self.assertEqual(kinds.count("NEAR_TARGET"), 1)
        self.assertEqual(kinds.count("NEAR_STOP"), 1)
        self.assertEqual(kinds.count("EXIT"), 1)
        self.assertIn("MISSED_TARGET_AFTER_EXIT", kinds)
        self.assertTrue(all(event["at"].endswith("+05:30") for event in events))

    def test_stale_future_out_of_order_and_invalid_ticks_cannot_fill(self):
        self.service.submit(self.frame(), self.at)
        self.service.process_tick("NIFTY", 100, self.at, self.at + timedelta(seconds=31))
        self.service.process_tick("NIFTY", 100, self.at + timedelta(seconds=4), self.at)
        self.assertEqual(self.trades(), [])
        with self.assertRaises(ValueError):
            self.tick(float("nan"))
        self.tick(100, 2)
        self.tick(70, 1)
        self.assertIsNone(self.trades()[0]["exit_at"])

    def test_expired_and_historical_signals_cannot_open(self):
        self.service.submit(self.frame(), self.at)
        self.service._finalize(self.at + timedelta(minutes=5))
        self.tick(100, 301)
        self.assertEqual(self.trades(), [])
        for candle in (self.at - timedelta(days=1), self.at + timedelta(minutes=1)):
            with self.assertRaises(ValueError):
                self.service.submit(self.frame(candle=candle), self.at)

    def test_session_close_never_invents_a_fill_and_reports_pending_quote(self):
        self.enter()
        close = self.at.replace(hour=15, minute=31)
        self.service._finalize(close)
        self.assertIsNone(self.trades()[0]["exit_at"])
        with self.service.connect() as db:
            report = json.loads(db.execute("SELECT payload FROM reports").fetchone()[0])
        self.assertFalse(report["final"])
        self.service.process_tick("NIFTY", 102, close)
        self.assertEqual(self.trades()[0]["exit_reason"], "SESSION_CLOSE")
        self.service._finalize(close)
        with self.service.connect() as db:
            report = json.loads(db.execute("SELECT payload FROM reports").fetchone()[0])
        self.assertTrue(report["final"])
        self.assertEqual(report["summary"]["closed"], 1)

    def test_delayed_square_off_is_not_misreported_as_next_day_target_hit(self):
        self.enter()
        self.service.process_tick("NIFTY", 130, self.at + timedelta(days=1))
        trade = self.trades()[0]
        self.assertEqual(trade["exit_reason"], "SESSION_CLOSE_DELAYED")
        self.assertFalse(trade["target_achieved"])

    def test_day_history_rankings_metrics_and_pagination_preserve_losing_trades(self):
        self.enter()
        self.tick(121, 2)
        self.service.submit(self.frame(strategy="Losing strategy"), self.at + timedelta(seconds=3))
        self.tick(100, 4)
        self.tick(89, 5)
        data = self.service.snapshot(self.at.date().isoformat(), 1)
        self.assertEqual(data["total"], 2)
        self.assertEqual(len(data["trades"]), 1)
        self.assertEqual(data["summary"]["wins"], 1)
        self.assertEqual(data["summary"]["losses"], 1)
        self.assertEqual(data["summary"]["target_hits"], 1)
        self.assertEqual(data["summary"]["stop_hits"], 1)
        self.assertEqual(data["summary"]["net_points"], 8)
        self.assertEqual(data["summary"]["win_rate"], 50)
        self.assertEqual(data["summary"]["expectancy"], 4)
        self.assertAlmostEqual(data["summary"]["realized_risk_reward"], 20 / 12, places=4)
        self.assertIn("EMA 9/20", data["summary"]["best_strategy"]["name"])
        self.assertIn("Losing strategy", data["summary"]["worst_strategy"]["name"])
        self.assertNotEqual(data["trades"][0]["id"],
                            self.service.snapshot(self.at.date().isoformat(), 1, 1)["trades"][0]["id"])

    def test_worker_retries_failed_transaction_before_later_ticks(self):
        self.enter()
        first = ("NIFTY", 90, self.at + timedelta(seconds=2))
        self.service.queue.put(first)
        self.service.queue.put(("NIFTY", 120, self.at + timedelta(seconds=3)))
        with patch.object(self.service, "_process_tick", side_effect=sqlite3.OperationalError("locked")):
            with self.assertRaises(sqlite3.OperationalError):
                self.service._drain()
        self.assertEqual(self.service._retry_batch[0], first)
        self.assertEqual(len(self.service._retry_batch), 2)
        self.service._drain()
        self.assertEqual(self.trades()[0]["exit_reason"], "STOP_LOSS")
        self.assertEqual(self.service._retry_batch, [])

    def test_readers_do_not_wait_for_the_tick_writer_lock(self):
        self.enter()
        done = threading.Event()
        def read():
            self.service.chart_snapshot("NIFTY", 5, self.at.date().isoformat())
            done.set()
        with self.service.lock:
            threading.Thread(target=read, daemon=True).start()
            self.assertTrue(done.wait(5), "chart reads must not queue behind tick processing")

    def test_export_is_complete_with_events_and_trade_order_is_stable_on_quote_updates(self):
        self.enter()
        self.service.submit(self.frame(strategy="Second strategy"), self.at + timedelta(seconds=2))
        self.tick(101, 3)
        first_order = [t["id"] for t in self.trades()]
        self.tick(102, 4)
        self.assertEqual([t["id"] for t in self.trades()], first_order)
        exported = self.service.export_day(self.at.date().isoformat())
        self.assertEqual(len(exported["trades"]), 2)
        self.assertEqual(len([event for event in exported["events"] if event["kind"] == "ENTRY"]), 2)
        restarted = PaperTradingService(self.path)
        self.assertEqual(restarted.export_day(self.at.date().isoformat())["events"], exported["events"])

    def test_quote_gaps_are_explicit_in_audit_trail(self):
        trade = self.enter()
        self.tick(101, 45)
        self.assertEqual(self.trades()[0]["data_gaps"], 1)
        self.assertIn("DATA_GAP", [event["kind"] for event in self.service.events(trade["id"])])

    def test_lifecycle_drains_ticks_and_does_not_start_duplicate_workers(self):
        async def lifecycle():
            await self.service.start()
            task = self.service.task
            await self.service.start()
            self.assertIs(task, self.service.task)
            self.service.queue.put(("NIFTY", 100, self.at + timedelta(seconds=1)))
            await self.service.stop()
            self.assertIsNone(self.service.task)
        self.service.submit(self.frame(), self.at)
        asyncio.run(lifecycle())
        self.assertEqual(len(self.trades()), 1)

    def test_api_validates_and_returns_real_persisted_history(self):
        app = FastAPI()
        app.include_router(router)
        client = TestClient(app)
        with patch("routers.paper_trading.get_paper_trading_service", return_value=self.service), \
                patch("services.paper_trading.now_ist", return_value=self.at):
            response = client.post("/api/paper-trading/signals", json=self.frame())
            self.assertEqual(response.status_code, 200, response.text)
            self.tick(100)
            history = client.get(f"/api/paper-trading/history?day={self.at.date()}")
            self.assertEqual(history.status_code, 200)
            self.assertEqual(history.json()["summary"]["open"], 1)
            report = client.get(f"/api/paper-trading/report?day={self.at.date()}")
            self.assertEqual(report.status_code, 200)
            self.assertEqual(report.json()["events"][0]["kind"], "ENTRY")
            chart = client.get(f"/api/paper-trading/chart?symbol=NIFTY&timeframe=5&day={self.at.date()}")
            self.assertEqual(chart.status_code, 200, chart.text)
            self.assertEqual(len(chart.json()["trades"]), 1)
            self.assertEqual(client.get("/api/paper-trading/chart?symbol=NIFTY&timeframe=7").status_code, 422)
            self.assertEqual(client.get("/api/paper-trading/history?day=invalid").status_code, 422)
            self.assertEqual(client.get("/api/paper-trading/history?limit=0").status_code, 422)
            bad = self.frame()
            bad["source"] = "other-dashboard"
            self.assertEqual(client.post("/api/paper-trading/signals", json=bad).status_code, 422)
            bad = self.frame()
            bad["signals"][0]["side"] = "REAL_ORDER"
            self.assertEqual(client.post("/api/paper-trading/signals", json=bad).status_code, 422)


if __name__ == "__main__":
    unittest.main()
