import asyncio
import json
import sqlite3
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, patch
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.paper_trading import IST, PaperTradingService


START = datetime(2026, 10, 19, 10, 0, tzinfo=IST).timestamp()
DAY = "2026-10-19"


def bar(t, **patches):
    return dict(t=t, end=t + 300, o=100, h=104, l=98, c=103, d=100,
                complete=True, closed=True, **patches)


def frame(now=START + 301, side="BUY", **patches):
    signal = dict(id=f"of-{int(START)}-{side}", time=START, side=side, entry=100,
                  stop=90 if side == "BUY" else 110, t1=110 if side == "BUY" else 90,
                  t2=120 if side == "BUY" else 80, confidence=75, reasons=["Recorded absorption"])
    value = dict(symbol="NIFTY", token=7, date=DAY, interval=5, available=True, lastTick=now,
                 contract={"tradingSymbol": "NIFTY26OCTFUT", "tickSize": 0.05},
                 signals=[signal], bars=[bar(START)])
    value.update(patches)
    return value


class ConfirmedOrderFlowPaperTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.service = PaperTradingService(Path(self.directory.name) / "paper.sqlite3")
        self.addCleanup(self.service.executor.shutdown)
        self.book = self.service.order_flow

    def rows(self):
        with self.service.connect() as db:
            return self.book.snapshot(db, DAY)["setups"]

    def tick(self, price, at, token=7, received=None):
        with self.service.connect(write=True) as db:
            self.book.tick(db, "NIFTY", token, price, at, received or at)

    def watch(self, side="BUY"):
        self.book.observe(frame(side=side), START + 301)
        return self.rows()[0]

    def confirm(self, side="BUY"):
        direction = 1 if side == "BUY" else -1
        confirmation = bar(START + 300)
        confirmation.update(c=100 + direction * 2, d=direction * 100)
        self.book.observe(frame(START + 601, side=side,
                               bars=[bar(START), confirmation]), START + 601)

    def test_waits_a_full_candle_then_next_tick_and_survives_restart_without_duplicates(self):
        self.watch()
        self.tick(101, START + 302)
        self.assertEqual(self.rows()[0]["status"], "WATCHING")
        self.book.observe(frame(), START + 302)
        self.assertEqual(len(self.rows()), 1)
        self.confirm()
        self.assertEqual(self.rows()[0]["status"], "ARMED")
        self.tick(102, START + 601)
        self.assertEqual(self.rows()[0]["status"], "ARMED", "Cannot fill against confirmation tick")
        self.tick(102, START + 602, token=8)
        self.assertEqual(self.rows()[0]["status"], "ARMED", "Cannot mix expiry quotes")
        self.tick(101, START + 602)
        opened = self.rows()[0]
        self.assertEqual(opened["status"], "OPEN")
        self.assertEqual(opened["entry_price"], 101.5)
        self.assertGreaterEqual((opened["target"] - opened["entry_price"]) /
                                (opened["entry_price"] - opened["stop"]), 1.5)
        restarted = PaperTradingService(self.service.db_path)
        self.addCleanup(restarted.executor.shutdown)
        with restarted.connect(write=True) as db:
            restarted.order_flow.tick(db, "NIFTY", 7, 121, START + 603, START + 603)
        closed = self.rows()[0]
        self.assertEqual((closed["status"], closed["exit_price"], closed["points"]), ("CLOSED", 120, 18.5))
        self.assertEqual([e["kind"] for e in self.service.events(opened["id"])],
                         ["WATCHING", "ARMED", "OPEN", "CLOSED"])
        self.book.observe(frame(START + 604), START + 604)
        self.assertEqual(len(self.rows()), 1)

    def test_sell_confirmation_and_adverse_gap_stop(self):
        self.watch("SELL")
        self.confirm("SELL")
        self.tick(99, START + 602)
        self.assertEqual(self.rows()[0]["entry_price"], 98.5)
        self.tick(112, START + 650)
        row = self.rows()[0]
        self.assertEqual((row["status"], row["exit_price"], row["points"]), ("CLOSED", 112.5, -14))
        self.assertEqual(row["reason"], "STOP_LOSS")
        self.assertEqual(row["data_gaps"], 1)

    def test_rejects_stop_and_first_target_touches_even_if_price_recovers(self):
        for price in (89, 111):
            with self.subTest(price=price):
                with self.service.connect(write=True) as db:
                    db.execute("DELETE FROM of_paper")
                self.watch()
                self.tick(price, START + 320)
                self.tick(102, START + 321)
                self.confirm()
                self.assertEqual(self.rows()[0]["status"], "REJECTED")
                self.assertIsNone(self.rows()[0]["entry_at"])

    def test_confirmation_requires_complete_directional_price_and_delta(self):
        for update in ({"complete": False}, {"closed": False}, {"c": 99}, {"d": -100}, {"h": 111}):
            with self.subTest(update=update):
                with self.service.connect(write=True) as db:
                    db.execute("DELETE FROM of_paper")
                self.watch()
                confirm = bar(START + 300)
                confirm.update(update)
                self.book.observe(frame(START + 601, bars=[bar(START), confirm]), START + 601)
                self.assertEqual(self.rows()[0]["status"], "REJECTED")

    def test_no_historical_adoption_stale_feed_or_low_confidence_entry(self):
        self.book.observe(frame(START + 601), START + 601)
        self.assertEqual(self.rows(), [])
        self.book.observe(frame(lastTick=START), START + 301)
        self.assertEqual(self.rows(), [])
        weak = frame()
        weak["signals"][0]["confidence"] = 59
        self.book.observe(weak, START + 301)
        self.assertEqual(self.rows()[0]["status"], "REJECTED")

    def test_no_chasing_or_late_entry_and_pending_expires(self):
        self.watch()
        self.confirm()
        self.tick(109, START + 602)
        self.assertEqual(self.rows()[0]["status"], "REJECTED")
        with self.service.connect(write=True) as db:
            db.execute("DELETE FROM of_paper")
        self.watch()
        self.book.observe(frame(START + 700, available=False), START + 700)
        self.assertEqual(self.rows()[0]["status"], "EXPIRED")

    def test_stale_ticks_cannot_enter_and_session_close_needs_real_same_token_quote(self):
        self.watch()
        self.confirm()
        self.tick(102, START + 602, received=START + 620)
        self.assertEqual(self.rows()[0]["status"], "ARMED")
        self.tick(101, START + 603)
        close = datetime(2026, 10, 19, 15, 25, tzinfo=IST).timestamp()
        self.tick(103, close, token=8)
        self.assertEqual(self.rows()[0]["status"], "OPEN")
        self.tick(103, close)
        self.assertEqual(self.rows()[0]["reason"], "SESSION_CLOSE")
        self.assertEqual(self.rows()[0]["exit_price"], 102.5)

    def test_contract_change_and_opposite_signal_cancel_watch(self):
        self.watch()
        self.book.observe(frame(START + 350, token=8), START + 350)
        self.assertEqual(self.rows()[0]["reason"], "Recorded futures contract changed")
        with self.service.connect(write=True) as db:
            db.execute("DELETE FROM of_paper")
        self.watch()
        self.book.observe(frame(START + 350, side="SELL"), START + 350)
        self.assertEqual(self.rows()[0]["reason"], "Opposite recorded order-flow signal")

    def test_snapshot_export_and_independent_paging_include_decisions_and_events(self):
        self.watch()
        self.confirm()
        self.tick(101, START + 602)
        with patch("services.paper_trading.now_ist", return_value=datetime(2026, 10, 19, 10, 11, tzinfo=IST)):
            snapshot = self.service.snapshot(DAY)
            self.assertEqual(snapshot["trades"], [], "Futures must never pollute cash-index accounting")
            self.assertEqual(snapshot["order_flow"]["counts"], {"OPEN": 1})
            self.assertEqual(self.service.snapshot(DAY, 100, 0, 100)["order_flow"]["setups"], [])
            report = self.service.export_day(DAY)
            self.assertEqual(len(report["order_flow"]["setups"]), 1)
            self.assertEqual([event["kind"] for event in report["events"]], ["WATCHING", "ARMED", "OPEN"])
            self.assertIn(DAY, snapshot["dates"])

    def test_same_signal_from_both_charts_is_one_book_and_no_overlapping_index_setups(self):
        self.watch()
        other = frame()
        other["signals"][0]["id"] = "another-plan"
        self.book.observe(other, START + 302)
        counts = {row["status"] for row in self.rows()}
        self.assertEqual(counts, {"WATCHING", "REJECTED"})
        self.assertEqual(len(self.rows()), 2)
        self.book.observe(other, START + 303)
        self.assertEqual(len(self.rows()), 2)

    def test_scanner_monitors_all_three_indices_without_chart_intake(self):
        async def snapshot(symbol, interval, token=None):
            return frame(symbol=symbol, token=token)
        with patch("routers.order_flow.build_snapshot", new_callable=AsyncMock, side_effect=snapshot) as build, \
                patch("services.order_flow_engine.order_flow_engine.current_token", return_value=7), \
                patch("services.paper_trading.now_ist", return_value=datetime.fromtimestamp(START + 301, IST)):
            asyncio.run(self.service._scan_order_flow())
        self.assertEqual([call.args for call in build.await_args_list],
                         [("NIFTY", 5), ("BANKNIFTY", 5), ("SENSEX", 5)])
        self.assertEqual({row["symbol"] for row in self.rows()}, {"NIFTY", "BANKNIFTY", "SENSEX"})
        self.assertIsNone(self.book.error)

    def test_lost_signal_level_after_confirmation_never_opens_a_trade(self):
        self.watch()
        self.confirm()
        self.tick(99, START + 602)
        self.assertEqual(self.rows()[0]["status"], "REJECTED")
        self.assertIn("lost the signal level", self.rows()[0]["reason"])

    def test_changed_price_in_same_exchange_second_still_triggers_stop(self):
        self.watch()
        self.confirm()
        self.tick(101, START + 602)
        self.tick(89, START + 602)
        self.assertEqual(self.rows()[0]["reason"], "STOP_LOSS")
        self.assertEqual(self.rows()[0]["exit_price"], 88.5)

    def test_futures_tick_intake_is_durable_and_batch_failures_retry_without_duplicate_fills(self):
        self.watch()
        self.confirm()
        at = datetime.fromtimestamp(START + 602, IST)
        with patch("services.paper_trading.now_ist", return_value=at):
            self.service.enqueue_futures_tick("NIFTY", {
                "instrument_token": 7, "last_price": 101, "exchange_timestamp": at,
            })
        original = self.book.tick
        def fail_after_write(*args):
            original(*args)
            raise sqlite3.OperationalError("test transient write failure")
        with patch.object(self.book, "tick", side_effect=fail_after_write):
            with self.assertRaises(sqlite3.OperationalError):
                self.book.drain()
        self.assertEqual(self.rows()[0]["status"], "ARMED", "Failed batch must roll back entirely")
        self.assertEqual(len(self.book.retry), 1)
        self.book.drain()
        self.book.drain()
        self.assertEqual(self.rows()[0]["status"], "OPEN")
        self.assertEqual(sum(event["kind"] == "OPEN" for event in self.service.events(self.rows()[0]["id"])), 1)

    def test_http_history_events_export_and_daily_report_include_separate_flow_book(self):
        from routers.paper_trading import router
        self.watch()
        self.confirm()
        self.tick(101, START + 602)
        app = FastAPI()
        app.include_router(router)
        with patch("routers.paper_trading.get_paper_trading_service", return_value=self.service):
            with TestClient(app) as client:
                history = client.get(f"/api/paper-trading/history?day={DAY}").json()
                self.assertEqual(history["order_flow"]["counts"], {"OPEN": 1})
                self.assertEqual(client.get(
                    f"/api/paper-trading/history?day={DAY}&flow_offset=100").json()["order_flow"]["setups"], [])
                key = self.rows()[0]["id"]
                events = client.get("/api/paper-trading/events", params={"trade_id": key}).json()
                self.assertEqual([event["kind"] for event in events], ["WATCHING", "ARMED", "OPEN"])
                report = client.get(f"/api/paper-trading/report?day={DAY}").json()
                self.assertEqual(report["report_status"], "AWAITING_EXIT_QUOTES")
                self.assertEqual(len(report["events"]), 3)
        self.service._finalize(datetime(2026, 10, 19, 16, 0, tzinfo=IST))
        with self.service.connect() as db:
            report = json.loads(db.execute("SELECT payload FROM reports WHERE day=?", (DAY,)).fetchone()[0])
        self.assertFalse(report["final"])
        self.assertEqual(report["order_flow"]["counts"], {"OPEN": 1})


if __name__ == "__main__":
    unittest.main()
