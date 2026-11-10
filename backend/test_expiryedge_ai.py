import unittest
from datetime import date, datetime, time, timedelta
from threading import RLock
from types import SimpleNamespace

from services.aqte_engine import IST
from services.expiryedge_ai import (
    evaluate_nifty_opening_range, evaluate_opening_range, live_market_snapshot,
    live_market_snapshots,
)


def stamp(day, hour, minute):
    return datetime.combine(day, time(hour, minute), tzinfo=IST).timestamp()


def bar(at, open_price, high, low, close, volume=100):
    return {"at": at, "open": open_price, "high": high, "low": low,
            "close": close, "volume": volume}


class ExpiryEdgeOpeningRangeTests(unittest.TestCase):
    def setUp(self):
        self.today = date(2026, 11, 9)
        friday = self.today - timedelta(days=3)
        self.bars = [
            bar(stamp(friday, 15, minute), 22000, 22002, 21998, 22000, 100)
            for minute in range(10, 25)
        ]
        self.bars.extend([
            bar(stamp(self.today, 9, 15), 22000, 22002, 21999, 22001),
            bar(stamp(self.today, 9, 16), 22001, 22003, 22000, 22002),
            bar(stamp(self.today, 9, 17), 22002, 22004, 22001, 22003),
            bar(stamp(self.today, 9, 18), 22003, 22004, 22000, 22001),
            bar(stamp(self.today, 9, 19), 22001, 22003, 21999, 22002),
        ])

    def test_waits_until_all_opening_range_bars_are_complete(self):
        incomplete = [item for item in self.bars if item["at"] != stamp(self.today, 9, 18)]
        incomplete.append(bar(stamp(self.today, 9, 20), 22002, 22004, 22001, 22003))
        result = evaluate_nifty_opening_range(incomplete, stamp(self.today, 9, 21) + 20)
        self.assertEqual(result["decision"], "WAIT")
        self.assertIn("Opening-range candles are incomplete", result["reason"])

    def test_emits_call_signal_only_after_breakout_close_and_vwap_confirmation(self):
        self.bars.append(bar(stamp(self.today, 9, 20), 22002, 22012, 22001, 22010))
        result = evaluate_nifty_opening_range(self.bars, stamp(self.today, 9, 21) + 20)
        self.assertTrue(result["ready"])
        self.assertEqual(result["decision"], "BUY CE")
        self.assertEqual(result["side"], "CE")
        self.assertLess(result["underlying_stop"], result["last_close"])
        self.assertGreater(result["trail_distance"], 0)

    def test_emits_put_signal_only_after_downside_breakout_and_vwap_confirmation(self):
        self.bars.append(bar(stamp(self.today, 9, 20), 22001, 22002, 21990, 21992))
        result = evaluate_nifty_opening_range(self.bars, stamp(self.today, 9, 21) + 20)
        self.assertTrue(result["ready"])
        self.assertEqual(result["decision"], "BUY PE")
        self.assertEqual(result["side"], "PE")
        self.assertGreater(result["underlying_stop"], result["last_close"])

    def test_generic_signal_is_independent_for_all_three_indices(self):
        self.bars.append(bar(stamp(self.today, 9, 20), 22002, 22012, 22001, 22010))
        results = {
            symbol: evaluate_opening_range(symbol, self.bars, stamp(self.today, 9, 21) + 20)
            for symbol in ("NIFTY", "BANKNIFTY", "SENSEX")
        }
        self.assertTrue(all(result["ready"] for result in results.values()))
        self.assertEqual(
            {result["setup_key"].split(":", 1)[0] for result in results.values()},
            {"NIFTY", "BANKNIFTY", "SENSEX"},
        )
        self.assertFalse(evaluate_opening_range("UNKNOWN", self.bars, stamp(self.today, 9, 21))["ready"])

    def test_rejects_stale_latest_candle(self):
        self.bars.append(bar(stamp(self.today, 9, 20), 22002, 22012, 22001, 22010))
        result = evaluate_nifty_opening_range(self.bars, stamp(self.today, 9, 23))
        self.assertFalse(result["ready"])
        self.assertIn("stale", result["reason"])

    def test_live_snapshot_reads_the_shared_nifty_futures_feed(self):
        now = stamp(self.today, 9, 21) + 20
        self.bars.append(bar(stamp(self.today, 9, 20), 22002, 22012, 22001, 22010))
        future = SimpleNamespace(token=1, at=now)
        engine = SimpleNamespace(
            future={"NIFTY": future},
            book=SimpleNamespace(closed={("future", 1, 60): self.bars}),
            fresh=lambda tick, _: tick is not None,
        )
        market = SimpleNamespace(
            lock=RLock(), health_lock=RLock(), engine=engine, feed_connected=True,
        )
        result = live_market_snapshot(market, now)
        self.assertEqual(result["market_data"]["state"], "CONNECTED")
        self.assertEqual(result["signal"]["decision"], "BUY CE")

    def test_shared_dashboard_connection_alone_does_not_mark_expiryedge_connected(self):
        now = stamp(self.today, 9, 21) + 20
        future = SimpleNamespace(token=1, at=now)
        engine = SimpleNamespace(
            future={"NIFTY": future},
            book=SimpleNamespace(closed={("future", 1, 60): self.bars}),
            fresh=lambda tick, _: tick is not None,
        )
        market = SimpleNamespace(
            lock=RLock(), health_lock=RLock(), engine=engine, feed_connected=False,
        )
        result = live_market_snapshot(market, now)
        self.assertEqual(result["market_data"]["state"], "NOT_CONNECTED")

    def test_live_snapshots_read_each_index_feed_independently(self):
        now = stamp(self.today, 9, 21) + 20
        bars = self.bars + [bar(stamp(self.today, 9, 20), 22002, 22012, 22001, 22010)]
        futures = {symbol: SimpleNamespace(token=index, at=now)
                   for index, symbol in enumerate(("NIFTY", "BANKNIFTY", "SENSEX"), start=1)}
        closed = {("future", future.token, 60): bars for future in futures.values()}
        engine = SimpleNamespace(
            future=futures, book=SimpleNamespace(closed=closed),
            fresh=lambda tick, _: tick is not None,
        )
        market = SimpleNamespace(
            lock=RLock(), health_lock=RLock(), engine=engine, feed_connected=True,
        )
        snapshots = live_market_snapshots(market, now)
        self.assertEqual(set(snapshots), {"NIFTY", "BANKNIFTY", "SENSEX"})
        self.assertTrue(all(item["signal"]["ready"] for item in snapshots.values()))


if __name__ == "__main__":
    unittest.main()
