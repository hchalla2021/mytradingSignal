import unittest

from pydantic import ValidationError

from services.aqte_daily_control import IndexControl, quality_reason


class QualityTests(unittest.TestCase):
    def test_defaults_are_disabled_90_and_five_maximum(self):
        config = IndexControl()
        self.assertFalse(config.enabled)
        self.assertEqual((config.max_trades, config.min_confidence), (5, 90))
        for patch in (dict(max_trades=0), dict(max_trades=11), dict(min_confidence=89),
                      dict(enabled="yes"), dict(daily_loss=2001), dict(stop_percent=float("nan"))):
            with self.assertRaises(ValidationError):
                IndexControl(**patch)

    def test_short_entries_weak_scores_unvalidated_and_missing_evidence_block(self):
        config = IndexControl().model_dump()
        for decision in ("SELL CE", "SELL PE", "WAIT"):
            self.assertIn("LONG", quality_reason(dict(decision=decision, entry={}), config))
        signal = dict(decision="BUY CE", entry={"maximum": 100}, confidence=80)
        self.assertIn("90", quality_reason(signal, config))
        signal["confidence"] = 95
        self.assertIn("validation", quality_reason(signal, config))
        signal["model_validated"] = True
        self.assertIn("Incomplete", quality_reason(signal, config))
        signal["intelligence"] = dict(
            ema={"9": 110, "20": 108, "50": 106, "100": 104, "200": 102},
            close=111, vwap=105, rsi=60, cpr={"top": 107, "bottom": 103},
            supertrend="BULLISH", volume_ratio=2, imbalance=0.3,
            breakout=1, structure="HIGHER_HIGH",
        )
        self.assertIn("OI/PCR/Greeks", quality_reason(signal, config))
        signal["intelligence"]["breakout"] = 0
        self.assertIn("confirmation missing", quality_reason(signal, config))


if __name__ == "__main__":
    unittest.main()
