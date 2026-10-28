import tempfile
import asyncio
import threading
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.order_flow_analysis import aggregate, analyze, fill_fees, stacked_imbalances, value_area
from services.order_flow_engine import OrderFlowEngine, classify, new_minute

IST = 19_800
OPEN = int(datetime(2026, 10, 19, 9, 15, tzinfo=timezone.utc).timestamp()) - IST  # Monday 09:15 IST
AFTER_CLOSE = OPEN + 7 * 3600


def tick(when, price, volume, bid, ask, total_bid=100_000, total_ask=100_000, depth=None):
    return {
        "last_price": price, "volume_traded": volume, "exchange_timestamp": when,
        "total_buy_quantity": total_bid, "total_sell_quantity": total_ask,
        "depth": depth or {"buy": [{"price": bid, "quantity": 500}], "sell": [{"price": ask, "quantity": 500}]},
    }


def make_bar(start, o, h, l, c, b, s, levels=None, book=(1.0, 1.0)):
    minutes = []
    for k in range(5):
        m = new_minute(start + k * 60, c if k else o, True)
        m["gap"] = False
        if k == 0:
            m.update(o=o, h=h, l=l, c=c, v=b + s, b=b, s=s,
                     lv=levels or {round((h + l) / 2): [b, s]}, bk=[book[0], book[1], 1], sp=[0.1, 1])
        minutes.append(m)
    return minutes


class OrderFlowEngineTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.engine = OrderFlowEngine(Path(self.directory.name) / "flow.sqlite3")

    def test_classification_quote_mid_tick_rules(self):
        self.assertEqual(classify(101, 100, 101, None, 0), (1, 0))
        self.assertEqual(classify(100, 100, 101, None, 0), (-1, 0))
        self.assertEqual(classify(100.8, 100, 101, None, 0), (1, 1))
        self.assertEqual(classify(100.5, 100, 101, 100.4, 0), (1, 2))
        self.assertEqual(classify(100.5, None, None, 100.5, -1), (-1, 2))
        self.assertEqual(classify(100.5, None, None, None, 0), (0, 2))

    def test_ingest_uses_prior_quote_keeps_unattributable_volume_unclassified_and_persists(self):
        base = datetime(2026, 10, 19, 10, 0, 0)
        self.engine.ingest_futures("NIFTY", 7, tick(base, 25000, 1000, 24999.9, 25000))
        self.engine.ingest_futures("NIFTY", 7, tick(base.replace(second=1), 25000, 1065, 24999.9, 25000.1))
        self.engine.ingest_futures("NIFTY", 7, tick(base.replace(second=2), 24999.9, 1195, 24999.8, 25000))
        # 40s gap: volume traded meanwhile cannot be attributed to a side.
        self.engine.ingest_futures("NIFTY", 7, tick(base.replace(second=42), 25001, 1295, 25000.9, 25001.1))
        self.engine.ingest_futures("NIFTY", 7, tick(base.replace(minute=1), 25001, 1300, 25000.9, 25001.1))
        minutes = self.engine.session_minutes("NIFTY", "2026-10-19")
        first = minutes[0]
        self.assertEqual((first["b"], first["s"], first["n"]), (65, 130, 100))
        self.assertTrue(first["gap"])
        self.assertEqual(first["v"], first["b"] + first["s"] + first["n"])
        stored = self.engine.stored_minutes("NIFTY", OPEN, AFTER_CLOSE)
        self.assertEqual(len(stored), 1)
        self.assertEqual(stored[0]["lv"], {25000.0: [65.0, 130.0]})

    def test_ignores_ticks_outside_cash_session(self):
        self.engine.ingest_futures("NIFTY", 7, tick(datetime(2026, 10, 19, 9, 10), 25000, 10, 1, 2))
        self.assertIsNone(self.engine.current_token("NIFTY"))

    def test_persistent_large_depth_becomes_liquidity_zone(self):
        depth = {"buy": [{"price": 24990 - i, "quantity": 9000 if i == 2 else 300} for i in range(5)],
                 "sell": [{"price": 25000 + i, "quantity": 300} for i in range(5)]}
        for second in range(10):
            self.engine.ingest_futures("NIFTY", 7, tick(datetime(2026, 10, 19, 10, 0, second), 24995,
                                                        100 + second, 24990, 25000, depth=depth))
        zones = self.engine.zones("NIFTY")
        self.assertEqual([(z["side"], z["price"], z["status"]) for z in zones], [("bid", 24988.0, "active")])


class OrderFlowAnalysisTests(unittest.TestCase):
    def test_live_ohlcv_requires_contiguous_minutes_from_bucket_open_without_gaps(self):
        minutes = make_bar(OPEN, 100, 102, 99, 101, 100, 100)
        forming = aggregate(minutes[:2], 5)[0]
        self.assertFalse(forming["complete"])
        self.assertTrue(forming["ohlcvComplete"])
        payload = analyze([forming], row=1.0, tick=0.05, now=OPEN + 61)
        self.assertTrue(payload["bars"][0]["ohlcvComplete"])
        self.assertFalse(payload["bars"][0]["closed"])
        self.assertFalse(aggregate(minutes[1:3], 5)[0]["ohlcvComplete"], "mid-bucket startup")
        self.assertFalse(aggregate([minutes[0], minutes[2]], 5)[0]["ohlcvComplete"], "missing minute")
        minutes[1]["gap"] = True
        self.assertFalse(aggregate(minutes[:2], 5)[0]["ohlcvComplete"], "feed gap or reset")

    def test_value_area_and_stacked_imbalance(self):
        profile = value_area({100.0: [10, 10], 101.0: [50, 50], 102.0: [20, 20], 103.0: [1, 1]}, 1.0)
        self.assertEqual(profile["poc"], 101.0)
        self.assertLessEqual(profile["val"], 101.0)
        self.assertGreaterEqual(profile["vah"], 101.0)
        zones = stacked_imbalances({100.0: [5, 10], 101.0: [40, 5], 102.0: [40, 5], 103.0: [40, 5]}, 1.0, 200)
        self.assertEqual(zones["buy"], [[101.0, 103.0]])

    def test_fees_follow_zerodha_futures_schedule(self):
        self.assertAlmostEqual(fill_fees(25000, 65, "BUY", "NFO"), 93.10775, places=4)
        self.assertAlmostEqual(fill_fees(25000, 65, "SELL", "NFO"), 873.10775, places=4)
        self.assertAlmostEqual(fill_fees(80000, 20, "BUY", "BFO"), 20 + 1.6 + 32 + 0.18 * 21.6, places=4)

    def session(self, signal_book=(1.3, 1.0)):
        minutes = []
        for i in range(8):  # balanced, high-volume value around 101-107
            minutes += make_bar(OPEN + i * 300, 106, 110, 100, 104, 2500, 2500,
                                {101.0 + k: [400, 400] for k in range(7)})
        # Absorption: heavy selling, negative delta, but the bar closes in its upper half.
        minutes += make_bar(OPEN + 8 * 300, 104, 109, 95, 108, 2500, 5000,
                            {95.0: [500, 2500], 100.0: [1000, 1500], 108.0: [1000, 1000]}, book=signal_book)
        minutes += make_bar(OPEN + 9 * 300, 108.5, 125, 107, 124, 3000, 1000)
        minutes += make_bar(OPEN + 10 * 300, 124, 140, 123, 139, 3000, 1000)
        return aggregate(minutes, 5)

    def test_absorption_buy_fills_next_open_and_replays_with_slippage_and_fees(self):
        result = analyze(self.session(), row=1.0, tick=0.05, now=AFTER_CLOSE, lot_size=65)
        self.assertIn("absorption_sellers", result["bars"][8]["flags"])
        signal = result["signals"][0]
        self.assertEqual((signal["side"], signal["time"], signal["entry"], signal["stop"]), ("BUY", OPEN + 2400, 108, 93.95))
        self.assertEqual(signal["fill"], 108.65)  # next bar open + spread + one tick
        self.assertEqual([e["reason"] for e in signal["exits"]], ["T1", "T2"])
        self.assertGreater(signal["pnl"]["fees"], 0)
        self.assertAlmostEqual(signal["pnl"]["net"], signal["pnl"]["gross"] - signal["pnl"]["fees"], places=2)
        self.assertEqual(result["replay"]["trades"], 1)
        self.assertEqual(result["guidance"]["action"], "WAIT")

    def test_live_signal_is_pending_until_next_bar(self):
        bars = self.session()[:9]
        result = analyze(bars, row=1.0, tick=0.05, now=OPEN + 9 * 300 + 1, lot_size=65, feed_age=1)
        self.assertEqual(result["guidance"]["action"], "BUY")
        self.assertEqual(result["guidance"]["status"], "pending")
        self.assertTrue(result["guidance"]["reasons"])

    def test_incomplete_or_stale_flow_never_signals(self):
        bars = self.session()
        bars[8]["complete"] = False
        result = analyze(bars, row=1.0, tick=0.05, now=AFTER_CLOSE, lot_size=65)
        self.assertEqual(result["signals"], [])
        stale = analyze(self.session()[:9], row=1.0, tick=0.05, now=OPEN + 9 * 300 + 1, feed_age=45)
        self.assertEqual(stale["guidance"]["action"], "WAIT")

    def test_cvd_accumulates_and_profile_is_reported(self):
        result = analyze(self.session(), row=1.0, tick=0.05, now=AFTER_CLOSE)
        self.assertEqual(result["bars"][-1]["cvd"], sum(b["d"] for b in result["bars"]))
        self.assertIsNotNone(result["profile"]["poc"])
        self.assertIn("points", result["replay"]["unit"])


class OrderFlowSnapshotConcurrencyTests(unittest.IsolatedAsyncioTestCase):
    async def test_parallel_subscribers_share_analytics_off_the_event_loop(self):
        from routers import order_flow
        loop_thread = threading.get_ident()

        def analytics(*args, **kwargs):
            self.assertNotEqual(threading.get_ident(), loop_thread)
            return {"bars": []}

        with patch.object(order_flow, "_cache", {}), \
             patch.object(order_flow, "_snapshot_locks", {}), \
             patch.object(order_flow, "_contract", AsyncMock(return_value=None)), \
             patch.object(order_flow.order_flow_engine, "current_token", return_value=None), \
             patch.object(order_flow.order_flow_engine, "session_minutes", return_value=[]) as read, \
             patch.object(order_flow.order_flow_engine, "last_tick", return_value=None), \
             patch.object(order_flow.order_flow_engine, "zones", return_value=[]), \
             patch.object(order_flow, "analyze", side_effect=analytics) as analyze_once:
            results = await asyncio.gather(*[
                order_flow.build_snapshot("NIFTY", 5) for _ in range(5)
            ])
            self.assertTrue(all(result is results[0] for result in results))
            read.assert_called_once()
            analyze_once.assert_called_once()


class OrderFlowApiTests(unittest.TestCase):
    def test_websocket_delivers_verified_forming_ohlcv_and_incremental_same_contract_ticks(self):
        from routers import order_flow
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        engine = OrderFlowEngine(Path(directory.name) / "flow.sqlite3")
        engine.ingest_futures("NIFTY", 7, tick(datetime(2026, 10, 19, 9, 19, 59), 100, 1000, 99, 100))
        engine.ingest_futures("NIFTY", 7, tick(datetime(2026, 10, 19, 9, 20, 0), 101, 1050, 100, 101))
        app = FastAPI()
        app.include_router(order_flow.ws_router, prefix="/ws")
        with patch.object(order_flow, "order_flow_engine", engine), \
                patch.object(order_flow, "_contract", return_value=None), \
                patch.object(order_flow, "_today", return_value="2026-10-19"):
            order_flow._cache.clear()
            with TestClient(app) as client:
                with client.websocket_connect("/ws/order-flow?symbol=NIFTY&interval=5&token=7") as ws:
                    initial = ws.receive_json()
                    self.assertEqual(initial["type"], "snapshot")
                    forming = initial["data"]["bars"][-1]
                    self.assertTrue(forming["ohlcvComplete"])
                    self.assertFalse(forming["complete"])
                    self.assertEqual((forming["c"], forming["v"]), (101, 50))
                    engine.ingest_futures("NIFTY", 7, tick(
                        datetime(2026, 10, 19, 9, 20, 1), 102, 1100, 101, 102))
                    order_flow._cache.clear()
                    update = ws.receive_json()
                    self.assertEqual(update["type"], "update")
                    self.assertEqual(update["data"]["token"], 7)
                    self.assertTrue(update["data"]["bars"][-1]["ohlcvComplete"])
                    self.assertEqual((update["data"]["bars"][-1]["c"], update["data"]["bars"][-1]["v"]), (102, 100))
                with client.websocket_connect("/ws/order-flow?symbol=NIFTY&interval=5&token=8") as ws:
                    unavailable = ws.receive_json()["data"]
                    self.assertFalse(unavailable["available"])
                    self.assertEqual(unavailable["recordedToken"], 7)
            order_flow._cache.clear()

    def test_snapshot_reports_unavailable_then_recorded_flow(self):
        from routers import order_flow
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        engine = OrderFlowEngine(Path(directory.name) / "flow.sqlite3")
        app = FastAPI()
        app.include_router(order_flow.http_router, prefix="/api")
        with patch.object(order_flow, "order_flow_engine", engine), \
                patch.object(order_flow, "_contract", return_value=None):
            order_flow._cache.clear()
            client = TestClient(app)
            empty = client.get("/api/order-flow/snapshot?symbol=NIFTY&interval=5&date=2026-10-19").json()
            self.assertFalse(empty["available"])
            self.assertIn("No order flow recorded", empty["reason"])
            for second in range(3):
                engine.ingest_futures("NIFTY", 7, tick(datetime(2026, 10, 19, 10, 0, second), 25000 + second,
                                                       1000 + second * 50, 24999 + second, 25000 + second))
            order_flow._cache.clear()
            data = client.get("/api/order-flow/snapshot?symbol=NIFTY&interval=5&date=2026-10-19").json()
            self.assertTrue(data["available"])
            self.assertEqual(data["bars"][0]["b"], 100)
            self.assertEqual(client.get("/api/order-flow/snapshot?symbol=FOO").status_code, 400)


if __name__ == "__main__":
    unittest.main()
