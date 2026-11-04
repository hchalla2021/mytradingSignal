import unittest
import threading
from datetime import datetime
from unittest.mock import Mock, patch

from services.aqte_broker_positions import BrokerPositions
from services.aqte_engine import IST


class BrokerPositionTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 30, 14, 30, tzinfo=IST).timestamp()
        self.clock = patch("services.aqte_broker_positions.time.time", return_value=self.now)
        self.clock.start()
        self.addCleanup(self.clock.stop)
        self.client = Mock(api_key="test-key", access_token="test-token")
        self.client.positions.return_value = {"net": [
            dict(tradingsymbol="NIFTY26NOV22000CE", exchange="NFO", product="MIS",
                 quantity=15, average_price=100),
            dict(tradingsymbol="BANKNIFTY26NOV55000PE", exchange="NFO", product="NRML",
                 quantity=-30, average_price=200),
            dict(tradingsymbol="RELIANCE", exchange="NSE", product="CNC", quantity=1, average_price=100),
            dict(tradingsymbol="NIFTY26N0323650CE", exchange="NFO", product="MIS", quantity=0, average_price=0,
                 buy_quantity=65, sell_quantity=65, buy_price=120.3, sell_price=128, pnl=500.5),
            dict(tradingsymbol="NIFTY26N0323700CE", exchange="NFO", product="MIS", quantity=0, average_price=0,
                 buy_quantity=0, sell_quantity=0, buy_price=0, sell_price=0, pnl=0),
            dict(tradingsymbol="TCS", exchange="NSE", product="MIS", quantity=0, average_price=0,
                 buy_quantity=1, sell_quantity=1, buy_price=1, sell_price=2, pnl=1),
        ]}
        self.client.quote.return_value = {
            "NFO:NIFTY26NOV22000CE": self.quote(120),
            "NFO:BANKNIFTY26NOV55000PE": self.quote(180),
        }
        self.client.orders.return_value = [self.order(), self.order(product="NRML"),
                                           self.order(status="CANCELLED"), self.order(transaction_type="BUY")]
        self.market = Mock()
        self.market.lock = threading.RLock()
        self.market.started = True
        self.market.failed = threading.Event()
        self.market.engine.fresh.return_value = True
        self.service = BrokerPositions(lambda: self.client, lambda: self.market)

    def quote(self, price):
        return dict(instrument_token=30, last_price=price,
                    timestamp=datetime.fromtimestamp(self.now, IST), volume=100)

    def order(self, **overrides):
        return dict(dict(tradingsymbol="NIFTY26NOV22000CE", exchange="NFO", product="MIS",
                         transaction_type="SELL", order_type="SL", status="TRIGGER PENDING",
                         quantity=10, filled_quantity=0, price=79, trigger_price=80, order_id="stop-1"),
                    **overrides)

    def test_reads_actual_longs_shorts_and_matching_partial_protection_without_mutation(self):
        snapshot = self.service.snapshot()
        self.assertTrue(snapshot["read_only"])
        self.assertEqual(len(snapshot["positions"]), 2)
        long, short = snapshot["positions"]
        self.assertEqual((long["entry"], long["ltp"], long["points"], long["return_pct"], long["gross_pnl"]),
                         (100, 120, 20, 20, 300))
        self.assertEqual((short["points"], short["return_pct"], short["gross_pnl"]), (20, 10, 600))
        self.assertEqual(len(long["stops"]), 1)
        self.assertEqual(long["stops"][0]["quantity"], 10)
        self.assertEqual(short["stops"], [])
        self.client.place_order.assert_not_called()
        self.client.modify_order.assert_not_called()
        self.client.cancel_order.assert_not_called()

    def test_positions_squared_off_today_are_reported_as_closed_with_realised_pnl(self):
        self.client.orders.return_value = [
            self.order(tradingsymbol="NIFTY26N0323650CE", status="COMPLETE", tag="7bc6ee7c7e404573S"),
        ]
        snapshot = self.service.snapshot()
        self.assertEqual([p["trading_symbol"] for p in snapshot["positions"]],
                         ["NIFTY26NOV22000CE", "BANKNIFTY26NOV55000PE"], "Closed rows never appear as open")
        self.assertEqual(snapshot["closed"], [dict(
            symbol="NIFTY", trading_symbol="NIFTY26N0323650CE", exchange="NFO", product="MIS",
            quantity=65, buy_price=120.3, sell_price=128, gross_pnl=500.5, aqte=True)])
        self.client.orders.return_value = []
        self.service.cached = None
        self.assertFalse(self.service.snapshot()["closed"][0]["aqte"], "Untagged trades are manual")
        self.assertNotIn("NFO:NIFTY26N0323650CE", self.client.quote.call_args.args[0], "No quote for closed rows")

    def test_cache_is_bounded_and_credentials_rotation_cannot_return_previous_account(self):
        self.service.snapshot()
        self.service.snapshot()
        self.assertEqual(self.client.positions.call_count, 1)
        self.client.access_token = "new-token"
        self.service.snapshot()
        self.assertEqual(self.client.positions.call_count, 2)
        with patch("services.aqte_broker_positions.time.time", return_value=self.now + 4):
            self.service.snapshot()
        self.assertEqual(self.client.positions.call_count, 3)

    def test_missing_stale_quotes_suppress_profit_and_errors_are_not_empty_success(self):
        self.client.quote.return_value = {}
        self.assertIsNone(self.service.snapshot()["positions"][0]["gross_pnl"])
        self.service.cached = None
        self.client.quote.return_value = {"NFO:NIFTY26NOV22000CE": {
            **self.quote(120), "timestamp": datetime.fromtimestamp(self.now - 30, IST)}}
        self.assertIsNone(self.service.snapshot()["positions"][0]["ltp"])
        self.service.cached = None
        self.client.positions.side_effect = TimeoutError("Broker unavailable")
        with self.assertRaises(TimeoutError):
            self.service.snapshot()

    def test_closed_session_and_weekends_pause_without_any_broker_requests(self):
        for at in [datetime(2026, 10, 30, 9, 14, tzinfo=IST),
                   datetime(2026, 10, 30, 15, 30, tzinfo=IST),
                   datetime(2026, 10, 31, 10, 0, tzinfo=IST)]:
            with self.subTest(at=at), patch("services.aqte_broker_positions.time.time", return_value=at.timestamp()):
                result = self.service.snapshot()
                self.assertTrue(result["paused"])
                self.assertIn("Market closed", result["reason"])
                self.assertEqual(result["positions"], [])
        self.client.positions.assert_not_called()
        self.client.orders.assert_not_called()
        self.client.quote.assert_not_called()

    def test_lost_or_stale_feed_pauses_and_resume_reads_broker_again(self):
        self.service.snapshot()
        self.market.engine.fresh.return_value = False
        paused = self.service.snapshot()
        self.assertTrue(paused["paused"])
        self.assertIn("Waiting for live market feed", paused["reason"])
        self.assertIsNone(self.service.cached)
        self.assertEqual(self.client.positions.call_count, 1)
        self.market.engine.fresh.return_value = True
        self.market.failed.set()
        self.assertTrue(self.service.snapshot()["paused"])
        self.market.failed.clear()
        self.market.started = False
        self.assertTrue(self.service.snapshot()["paused"])
        self.market.started = True
        self.assertFalse(self.service.snapshot()["paused"])
        self.assertEqual(self.client.positions.call_count, 2)


if __name__ == "__main__":
    unittest.main()
