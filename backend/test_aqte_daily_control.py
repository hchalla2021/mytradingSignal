import unittest

from pydantic import ValidationError

from services.aqte_daily_control import IndexControl, quality_reason


class QualityTests(unittest.TestCase):
    def test_shared_swing_evidence_is_the_live_entry_gate(self):
        from services.aqte_engine import directional_checks

        config = IndexControl(style="swing").model_dump()
        for side, sign in (("CE", 1), ("PE", -1)):
            info = dict(ema={str(n): 100 + sign * (5 - i) for i, n in enumerate((9, 20, 50, 100, 200))},
                        close=100 + sign * 6, vwap=100, rsi=60 if sign > 0 else 40,
                        cpr={"top": 102, "bottom": 98}, supertrend="BULLISH" if sign > 0 else "BEARISH",
                        volume_ratio=1.5, imbalance=sign * 0.15, breakout=sign,
                        structure="HIGHER_HIGH" if sign > 0 else "LOWER_LOW")
            signal = dict(decision=f"BUY {side}", entry={"maximum": 100}, confidence=73, intelligence=info)
            checks = directional_checks(info, side, "swing")
            self.assertEqual(len(checks), 9)
            self.assertTrue(all(c["passed"] for c in checks))
            self.assertIsNone(quality_reason(signal, config, True))
            for key, value in (("rsi", 50), ("volume_ratio", 1.49), ("breakout", 0), ("imbalance", 0)):
                weak = {**info, key: value}
                self.assertFalse(all(c["passed"] for c in directional_checks(weak, side, "swing")))
                self.assertIsNotNone(quality_reason({**signal, "intelligence": weak}, config, True))

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

    def test_unvalidated_rule_opt_in_still_requires_every_directional_check(self):
        config = IndexControl().model_dump()
        intelligence = dict(
            ema={"9": 90, "20": 92, "50": 94, "100": 96, "200": 98},
            close=89, vwap=95, rsi=40, cpr={"top": 97, "bottom": 93},
            supertrend="BEARISH", volume_ratio=2, imbalance=-0.3,
            breakout=-1, structure="LOWER_LOW",
        )
        signal = dict(decision="BUY PE", entry={"maximum": 100}, confidence=80,
                      model_validated=False, intelligence=intelligence)
        self.assertIn("90", quality_reason(signal, config))
        self.assertIsNone(quality_reason(signal, config, allow_unvalidated_rules=True))
        for decision in ("SELL PE", "WAIT"):
            self.assertIn("LONG", quality_reason({**signal, "decision": decision}, config, True))
        for score in (None, float("nan"), "80"):
            self.assertIn("score", quality_reason({**signal, "confidence": score}, config, True))
        for key, value in (("rsi", 50), ("volume_ratio", 1.4), ("imbalance", -0.1), ("breakout", 0),
                           ("structure", "RANGE"), ("supertrend", "BULLISH"), ("vwap", None)):
            weak = {**signal, "intelligence": {**intelligence, key: value}}
            self.assertIn("confirmation missing", quality_reason(weak, config, True))
        unaligned = {**signal, "intelligence": {**intelligence, "ema": {**intelligence["ema"], "50": 91}}}
        self.assertIn("EMA", quality_reason(unaligned, config, True))
        self.assertIn("Incomplete", quality_reason({**signal, "intelligence": {}}, config, True))

    def test_scalp_style_is_default_and_scalp_gate_rechecks_scalp_rules(self):
        self.assertEqual(IndexControl().style, "scalp")
        self.assertEqual(IndexControl(style="swing").style, "swing")
        with self.assertRaises(ValidationError):
            IndexControl(style="martingale")
        config = IndexControl().model_dump()
        intelligence = dict(
            ema={"9": 105, "20": 104, "50": 106, "100": 107, "200": 108},
            close=106, vwap=100, rsi=65, cpr=None, atr=10,
            supertrend="BULLISH", volume_ratio=1.6, imbalance=0.15,
            breakout=1, structure="RANGE",
        )
        signal = dict(decision="BUY CE", strategy="quick_scalp_10", confidence=70, model_validated=False,
                      entry={"maximum": 100, "points_allowed": [10]}, intelligence=intelligence)
        self.assertIn("90", quality_reason(signal, config))
        # The swing gate would reject unaligned EMA 50/100/200 and missing CPR; scalping needs only its rules.
        self.assertIsNone(quality_reason(signal, config, allow_unvalidated_rules=True))
        for key, value, reason in (("rsi", 85, "RSI"), ("breakout", 0, "breakout"),
                                   ("volume_ratio", 1.2, "volume"), ("imbalance", 0.0, "imbalance")):
            weak = {**signal, "intelligence": {**intelligence, key: value}}
            self.assertIn(reason, quality_reason(weak, config, True))
        self.assertIn("direction", quality_reason({**signal, "decision": "BUY PE"}, config, True))


if __name__ == "__main__":
    unittest.main()
