import os
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

from services.aqte_engine import IST
from services.quantumedge_institutional import (
    InstitutionalConfig,
    InstitutionalDecisionEngine,
    aggregate,
)


def bars(count=120, start=1795400000.0):
    result = []
    price = 25500.0
    for index in range(count):
        price += (-1 if index % 11 == 0 else 1)
        result.append({
            "at": start + index * 60,
            "open": price - 2,
            "high": price + 3,
            "low": price - 4,
            "close": price,
            "volume": 1000 + (500 if index % 5 == 0 else 0),
        })
    return result


class InstitutionalDecisionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.engine = InstitutionalDecisionEngine(
            Path(self.directory.name) / "institutional.sqlite3",
            InstitutionalConfig(mode="shadow", min_depth_quantity=1),
        )
        self.now = 1795400000.0 + 120 * 60
        self.sample_bars = bars(120, 1795400000.0)

    def candidate(self):
        return {
            "decision": "BUY CE",
            "side": "CE",
            "entry": {"maximum": 100.0, "stop": 80.0, "target": 140.0},
            "risk": 1300.0,
        }

    def quote(self, received=None, spread=0.01):
        age = self.now if received is None else received
        bid = 99.0
        ask = bid * (1 + spread)
        return SimpleNamespace(
            price=100.0, bid=bid, ask=ask,
            bid_quantity=65, ask_quantity=65, volume=1000,
            oi=100000, at=age - 0.5, received=age,
        )

    def run_evaluate(self, *, candidate=None, received=None, quote=None,
                     pcr=None, order_flow=None):
        return self.engine.evaluate(
            symbol="NIFTY",
            now=self.now,
            candidate=candidate or self.candidate(),
            bars_1m=self.sample_bars,
            spot=SimpleNamespace(price=25500.0, at=self.now, received=self.now),
            future=SimpleNamespace(price=25510.0, at=self.now, received=self.now),
            contract={"trading_symbol": "NIFTY26NOV25600CE", "side": "CE"},
            quote=quote or self.quote(received or self.now),
            pcr=pcr or {"pcr": 1.1, "sentiment": "bullish"},
            order_flow=order_flow or {
                "aggressor_side_is_estimated": True,
                "estimated_buy_aggressor_volume": 500,
                "estimated_sell_aggressor_volume": 300,
            },
        )

    def test_shadow_decision_never_contains_live_gate_permission_override(self):
        decision = self.run_evaluate()
        self.assertEqual(decision["mode"], "shadow")
        self.assertIn(decision["permission"], ("ALLOW", "NO_TRADE"))
        self.assertEqual(decision["symbol"], "NIFTY")
        self.assertLessEqual(len(decision["timeframes"]), 8)

    def test_stale_quote_and_missing_pcr_are_hard_vetoes(self):
        decision = self.run_evaluate(
            quote=self.quote(received=self.now - 10),
            pcr={"pcr": 0, "sentiment": "neutral"},
        )
        self.assertEqual(decision["permission"], "NO_TRADE")
        self.assertIn("STALE_OPTION_QUOTE", decision["vetoes"])
        self.assertIn("MISSING_PCR", decision["vetoes"])

    def test_spread_conflict_and_invalid_stop_are_hard_vetoes(self):
        decision = self.run_evaluate(quote=self.quote(spread=0.10))
        invalid = dict(self.candidate())
        invalid["entry"] = {"maximum": 100.0, "stop": 110.0, "target": 140.0}
        invalid_decision = self.run_evaluate(candidate=invalid)
        self.assertIn("EXCESSIVE_OR_MISSING_OPTION_SPREAD", decision["vetoes"])
        self.assertIn("INVALID_CE_STOP_TARGET_STRUCTURE", invalid_decision["vetoes"])

    def test_pcr_and_direction_conflict_is_a_hard_veto(self):
        decision = self.run_evaluate(pcr={"pcr": 1.4, "sentiment": "bullish"})
        candidate = dict(self.candidate(), side="PE", decision="BUY PE")
        pe = self.run_evaluate(candidate=candidate)
        self.assertNotIn("PCR_CONFLICTS_WITH_CE", decision["vetoes"])
        self.assertIn("PCR_CONFLICTS_WITH_PE",
                      pe["vetoes"])

    def test_persistence_survives_engine_reopen_and_outcomes_can_be_recorded(self):
        decision = self.run_evaluate()
        due = self.engine.due_outcomes(self.now + 1801)
        self.assertIn(decision["decision_id"], {item["id"] for item in due})
        self.engine.record_outcome(decision["decision_id"], self.now + 1801,
                                   {"status": "OBSERVED", "option_ltp": 101.0})
        reopened = InstitutionalDecisionEngine(
            self.engine.path,
            InstitutionalConfig(mode="shadow", min_depth_quantity=1),
        )
        self.assertEqual(reopened.due_outcomes(self.now + 1801), [])

    def test_incomplete_candle_history_is_not_treated_as_closed_setup(self):
        decision = self.run_evaluate()
        incomplete = bars(15, 1795400000.0)
        no_history = self.engine.evaluate(
            symbol="NIFTY", now=self.now, candidate=self.candidate(),
            bars_1m=incomplete,
            spot=SimpleNamespace(price=25500.0, at=self.now, received=self.now),
            future=SimpleNamespace(price=25510.0, at=self.now, received=self.now),
            contract={"trading_symbol": "NIFTY26NOV25600CE", "side": "CE"},
            quote=self.quote(),
            pcr={"pcr": 1.1, "sentiment": "bullish"},
            order_flow={"aggressor_side_is_estimated": True},
        )
        self.assertIn("INSUFFICIENT_COMPLETED_1M_CANDLES", no_history["vetoes"])
        self.assertNotIn("MISSING_CONFIRMED_DIRECTION", decision["vetoes"])

    def test_higher_aggregation_never_includes_forming_bucket(self):
        now = 1795400000.0 + 15 * 60
        current = [{"at": now - 30, "open": 100, "high": 101, "low": 99,
                    "close": 100, "volume": 100},
                   {"at": now, "open": 100, "high": 105, "low": 99,
                    "close": 104, "volume": 500}]
        result = aggregate(current, 300, now)
        self.assertTrue(all(item["at"] + 300 <= now for item in result))


if __name__ == "__main__":
    unittest.main()
