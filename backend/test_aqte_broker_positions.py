import unittest
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
        ]}
        self.client.quote.return_value = {
            "NFO:NIFTY26NOV22000CE": self.quote(120),
            "NFO:BANKNIFTY26NOV55000PE": self.quote(180),
        }
        self.client.orders.return_value = [self.order(), self.order(product="NRML"),
                                           self.order(status="CANCELLED"), self.order(transaction_type="BUY")]
        self.service = BrokerPositions(lambda: self.client)

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


if __name__ == "__main__":
    unittest.main()
