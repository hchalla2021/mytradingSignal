import unittest
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

from services.aqte_live import AQTELiveService, LiveBlocked, algo_order, aqte_order
from services.quantedge_pro import evaluate_breakout


def candle(at, close, *, open_price=None, high=None, low=None, volume=100):
    open_price = close if open_price is None else open_price
    return {
        "at": at,
        "open": open_price,
        "high": max(open_price, close) + 1 if high is None else high,
        "low": min(open_price, close) - 1 if low is None else low,
        "close": close,
        "volume": volume,
    }


class QuantEdgeProStrategyTests(unittest.TestCase):
    def test_quantedge_tag_is_owned_without_claiming_manual_orders(self):
        self.assertTrue(algo_order({"tag": "QEP" + "a" * 13 + "E"}))
        self.assertTrue(algo_order({"tag": "QEP" + "a" * 13 + "S"}))
        self.assertFalse(algo_order({"tag": "QEP" + "a" * 13 + "X"}))
        self.assertFalse(aqte_order({"tag": "QEP" + "a" * 13 + "E"}))
        self.assertFalse(aqte_order({"tag": "MANUAL"}))
        self.assertTrue(aqte_order({"tag": "AQTEKILL"}))

    def test_shared_order_book_keeps_manual_position_out_of_quantedge_ownership(self):
        broker = Mock()
        broker.orders.return_value = [
            {"tag": "QEP" + "a" * 13 + "E", "filled_quantity": 50, "exchange": "NFO",
             "tradingsymbol": "QEP_CONTRACT", "product": "MIS", "transaction_type": "BUY",
             "status": "COMPLETE", "instrument_token": 11},
            {"tag": "", "filled_quantity": 25, "exchange": "NFO", "tradingsymbol": "MANUAL_CONTRACT",
             "product": "MIS", "transaction_type": "BUY", "status": "COMPLETE", "instrument_token": 22},
        ]
        broker.positions.return_value = {"net": [
            {"quantity": 50, "exchange": "NFO", "tradingsymbol": "QEP_CONTRACT", "product": "MIS",
             "instrument_token": 11},
            {"quantity": 25, "exchange": "NFO", "tradingsymbol": "MANUAL_CONTRACT", "product": "MIS",
             "instrument_token": 22},
        ]}
        book = AQTELiveService().book(broker)
        self.assertEqual([position["tradingsymbol"] for position in book["owned"]], ["QEP_CONTRACT"])
        self.assertIn(22, book["busy"])
        self.assertNotIn(11, book["busy"])

    def test_requires_completed_history(self):
        result = evaluate_breakout([candle(at, 100 + at) for at in range(20)])
        self.assertEqual(result["decision"], "WAIT")
        self.assertIn("21 completed", result["reason"])

    def test_does_not_trade_on_rsi_alone(self):
        bars = [candle(at, 100 + at * 0.1) for at in range(20)]
        bars.append(candle(20, 102, open_price=101.95, high=102.2, low=101.9, volume=1000))
        result = evaluate_breakout(bars)
        self.assertEqual(result["decision"], "WAIT")
        self.assertTrue(result["metrics"]["rsi"] >= 55)
        self.assertFalse(result["rules"]["CE"]["strong_body"])

    def test_ce_requires_and_accepts_all_seven_breakout_rules(self):
        bars = [candle(at, 100) for at in range(20)]
        bars.append(candle(20, 103, open_price=100, high=103.2, low=99.9, volume=200))

        result = evaluate_breakout(bars)

        self.assertEqual(result["decision"], "BUY CE")
        self.assertTrue(all(result["rules"].values()))

    def test_pe_requires_and_accepts_all_seven_breakout_rules(self):
        bars = [candle(at, 100) for at in range(20)]
        bars.append(candle(20, 97, open_price=100, high=100.1, low=96.8, volume=200))

        result = evaluate_breakout(bars)

        self.assertEqual(result["decision"], "BUY PE")
        self.assertTrue(all(result["rules"].values()))

    def test_rejects_nonfinite_completed_candle(self):
        bars = [candle(at, 100) for at in range(21)]
        bars[-1]["close"] = float("nan")
        result = evaluate_breakout(bars)
        self.assertEqual(result["decision"], "WAIT")
        self.assertIn("non-finite", result["reason"])

    def test_live_config_defaults_off_and_saves_lots_before_approval(self):
        with tempfile.TemporaryDirectory() as directory:
            config = SimpleNamespace(
                aqte_live_enabled=True,
                aqte_live_static_ip="8.8.8.8",
                aqte_live_allow_unvalidated_rules=False,
                aqte_live_risk_per_trade=500,
                aqte_live_daily_loss=2000,
                aqte_live_max_trades=5,
                aqte_live_max_losses=3,
            )
            live = AQTELiveService(Path(directory) / "live.sqlite3", settings=lambda: config)
            live.initialize()
            self.assertEqual(live.state["quantedge"], {"enabled": False, "lots": 1})
            self.assertEqual(live.set_quantedge_config(3)["lots"], 3)
            self.assertFalse(live.state["quantedge"]["enabled"])
            with self.assertRaises(LiveBlocked):
                live.set_quantedge_config(6)
            live.release_owner()
            restored = AQTELiveService(Path(directory) / "live.sqlite3", settings=lambda: config)
            restored.initialize()
            try:
                self.assertEqual(restored.state["quantedge"], {"enabled": False, "lots": 3})
            finally:
                restored.release_owner()


if __name__ == "__main__":
    unittest.main()
