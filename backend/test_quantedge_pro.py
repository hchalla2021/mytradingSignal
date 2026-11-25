import unittest
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
from unittest.mock import patch
import httpx
import os

from services.aqte_live import AQTELiveService, LiveBlocked, algo_order, aqte_order
from services.quantedge_pro import evaluate_breakout
from services.quantedge_hybrid import QuantEdgeHybridOrchestrator


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
    def candidate(self, key="qep-test", side="CE"):
        return {
            "decision": f"BUY {side}",
            "side": side,
            "symbol": "NIFTY",
            "strategy": "super_candle_bollinger_breakout_v1",
            "setup_key": key,
            "signal_at": 1700000000,
            "candle_at": 1700000000,
            "risk": 100,
            "spread_fraction": 0.01,
            "metrics": {"volume_ratio": 2.0, "body_ratio": 0.8, "rsi": 60},
            "entry": {"maximum": 100, "stop": 80, "target": 140, "reward_risk": 2.0},
        }

    def test_hybrid_deduplicates_and_prioritizes_unique_buy_signals(self):
        orchestrator = QuantEdgeHybridOrchestrator()
        candidate = self.candidate()
        now = candidate["signal_at"] + 1
        with patch.object(orchestrator, "approve_next", return_value={
            "approved": False, "reason": "AI pending", "state": "PENDING",
        }):
            first = orchestrator.submit(candidate, now, lambda fresh, at: fresh)
            duplicate = orchestrator.submit(candidate, now, lambda fresh, at: fresh)
        self.assertEqual(first["state"], "PENDING")
        self.assertEqual(duplicate["state"], "PENDING")
        self.assertEqual(len(orchestrator.pending), 1)

    def test_hybrid_ai_only_accepts_matching_quant_direction(self):
        orchestrator = QuantEdgeHybridOrchestrator()
        candidate = self.candidate()
        now = candidate["signal_at"] + 1
        response = httpx.Response(200, json={
            "content": [{"type": "text", "text": '{"action":"BUY_PE","confidence":90,"reason":"wrong direction"}'}],
            "usage": {"input_tokens": 100, "output_tokens": 20},
        })
        with patch.dict(os.environ, {"AI_ENABLED": "true",
                                     "ANTHROPIC_API_KEY": "test-key"}, clear=False), \
                patch("services.quantedge_hybrid.httpx.post", return_value=response):
            result = orchestrator.submit(candidate, now, lambda fresh, at: fresh)
        self.assertFalse(result["approved"])
        self.assertEqual(result["state"], "REJECTED")
        self.assertIn(candidate["setup_key"], orchestrator.used)

    def test_hybrid_rejects_stale_candidate_and_does_not_queue(self):
        orchestrator = QuantEdgeHybridOrchestrator()
        candidate = self.candidate()
        now = candidate["signal_at"] + 181
        result = orchestrator.submit(candidate, now, lambda fresh, at: fresh)
        self.assertFalse(result["approved"])
        self.assertEqual(result["state"], "STALE")
        self.assertEqual(len(orchestrator.pending), 0)
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
