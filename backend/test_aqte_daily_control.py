import unittest

from pydantic import ValidationError

from services.aqte_daily_control import IndexControl, quality_reason

FLIP = {"BULLISH": "BEARISH", "BEARISH": "BULLISH", "HIGHER_HIGH": "LOWER_LOW", "LOWER_LOW": "HIGHER_HIGH",
        "RANGE": "RANGE"}


def mirror(info):
    """The same market reflected around 100: every bullish CE fact becomes its bearish PE twin."""
    return {**info, "ema": {k: 200 - v for k, v in info["ema"].items()}, "close": 200 - info["close"],
            "vwap": 200 - info["vwap"], "rsi": 100 - info["rsi"], "imbalance": -info["imbalance"],
            "sweep": -info["sweep"], "breakout": -info["breakout"], "supertrend": FLIP[info["supertrend"]],
            "structure": FLIP[info["structure"]], "live": {"price": 200 - info["live"]["price"]},
            "cpr": {"top": 200 - info["cpr"]["bottom"], "bottom": 200 - info["cpr"]["top"]}}


TREND = dict(ema={"9": 104, "20": 103, "50": 102, "100": 101, "200": 100}, close=105, vwap=101, atr=3, rsi=58,
             supertrend="BULLISH", cpr={"top": 102, "bottom": 99}, structure="RANGE", volume_ratio=1.0,
             imbalance=0.15, breakout=0, sweep=0, live={"price": 105})
REVERSAL = dict(ema={"9": 100, "20": 101, "50": 99, "100": 102, "200": 98}, close=100, vwap=99, atr=2, rsi=45,
                supertrend="BEARISH", cpr={"top": 101, "bottom": 99}, structure="RANGE", volume_ratio=1.5,
                imbalance=0.15, breakout=0, sweep=1, live={"price": 100})
MEAN = dict(ema=dict.fromkeys(("9", "20", "50", "100", "200"), 100), close=93, vwap=100, atr=3, rsi=25,
            supertrend="BEARISH", cpr={"top": 101, "bottom": 99}, structure="LOWER_LOW", volume_ratio=1.5,
            imbalance=0.15, breakout=-1, sweep=0, live={"price": 93.5})
SETUP_CASES = (
    ("trend_continuation", TREND, (("rsi", 49), ("close", 106.5), ("close", 103.5), ("structure", "LOWER_LOW"),
                                   ("volume_ratio", 0.99), ("imbalance", 0.14), ("supertrend", "BEARISH"))),
    ("liquidity_reversal", REVERSAL, (("sweep", 0), ("sweep", -1), ("rsi", 70), ("volume_ratio", 1.49),
                                      ("imbalance", 0.14), ("live", {"price": 99.95}),
                                      ("ema", {"9": 96, "20": 97, "50": 98, "100": 99, "200": 100}))),
    ("mean_reversion", MEAN, (("close", 95), ("rsi", 30), ("volume_ratio", 1.49), ("imbalance", 0.14),
                              ("live", {"price": 93}), ("ema", {"9": 99, "20": 100, "50": 101, "100": 102,
                                                                "200": 103}))),
)


class QualityTests(unittest.TestCase):
    def test_each_swing_setup_needs_all_of_its_own_checks_and_its_controls_switch(self):
        from services.aqte_engine import SETUP_LABELS, setup_checks

        for name, info, weak_cases in SETUP_CASES:
            label = SETUP_LABELS[name]
            off = IndexControl(style="swing", setups={name: False}).model_dump()
            on = IndexControl(style="swing", setups={name: True}).model_dump()
            for side, facts in (("CE", info), ("PE", mirror(info))):
                signal = dict(decision=f"BUY {side}", strategy=name, entry={"maximum": 100}, confidence=75,
                              model_validated=False, intelligence=facts)
                with self.subTest(setup=name, side=side):
                    self.assertTrue(all(c["passed"] is True for c in setup_checks(facts, side, name)))
                    self.assertEqual(quality_reason(signal, off, True), f"{label} passed all its checks but is OFF in Controls")
                    self.assertIsNone(quality_reason(signal, on, True))
                    self.assertIn("validation", quality_reason(signal, on), "Strict mode still blocks")
                    self.assertIsNotNone(quality_reason({**signal, "strategy": None}, on, True),
                                         "The breakout gate alone can never pass this setup")
                    self.assertEqual(quality_reason({**signal, "strategy": "martingale"}, on, True),
                                     "Unknown swing setup; WAIT")
            signal = dict(decision="BUY CE", strategy=name, entry={"maximum": 100}, confidence=75,
                          model_validated=False, intelligence=info)
            for key, value in weak_cases:
                with self.subTest(setup=name, weak=key, value=value):
                    reason = quality_reason({**signal, "intelligence": {**info, key: value}}, on, True)
                    self.assertTrue(reason and reason.startswith(f"{label}: "), reason)

    def test_setup_switches_default_to_all_on_and_missing_unmigrated_switches_fail_closed(self):
        self.assertEqual(IndexControl().setups.model_dump(), dict(
            momentum_breakout=True, trend_continuation=True, liquidity_reversal=True, mean_reversion=True))
        for bad in ({"martingale": True}, {"trend_continuation": "yes"}, {"mean_reversion": 1}, ["trend"]):
            with self.assertRaises(ValidationError):
                IndexControl(setups=bad)
        legacy = {k: v for k, v in IndexControl(style="swing").model_dump().items() if k != "setups"}
        signal = dict(decision="BUY CE", strategy="trend_continuation", entry={"maximum": 100}, confidence=75,
                      model_validated=False, intelligence=TREND)
        self.assertIn("OFF in Controls", quality_reason(signal, legacy, True))

    def test_shared_swing_evidence_is_the_live_entry_gate(self):
        from services.aqte_engine import directional_checks

        config = IndexControl(style="swing").model_dump()
        for side, sign in (("CE", 1), ("PE", -1)):
            info = dict(ema={str(n): 100 + sign * (5 - i) for i, n in enumerate((9, 20, 50, 100, 200))},
                        close=100 + sign * 6, vwap=100, rsi=60 if sign > 0 else 40,
                        cpr={"top": 102, "bottom": 98}, supertrend="BULLISH" if sign > 0 else "BEARISH",
                        volume_ratio=1.5, imbalance=sign * 0.15, breakout=sign,
                        structure="HIGHER_HIGH" if sign > 0 else "LOWER_LOW")
            signal = dict(decision=f"BUY {side}", entry={"maximum": 100}, confidence=75, intelligence=info)
            checks = directional_checks(info, side, "swing")
            self.assertEqual(len(checks), 9)
            self.assertTrue(all(c["passed"] for c in checks))
            self.assertIsNone(quality_reason(signal, config, True))
            self.assertEqual(quality_reason(signal, IndexControl(style="swing", setups={
                "momentum_breakout": False}).model_dump(), True),
                "Momentum breakout passed all its checks but is OFF in Controls")
            for key, value in (("rsi", 50), ("volume_ratio", 1.49), ("breakout", 0), ("imbalance", 0)):
                weak = {**info, key: value}
                self.assertFalse(all(c["passed"] for c in directional_checks(weak, side, "swing")))
                self.assertIsNotNone(quality_reason({**signal, "intelligence": weak}, config, True))

    def test_defaults_select_all_indices_styles_and_setups_with_a_75_to_80_score_floor(self):
        from services.aqte_daily_control import defaults

        config = IndexControl()
        self.assertEqual((config.max_trades, config.min_confidence), (5, 75))
        for control in defaults().values():
            self.assertTrue(control["enabled"])
            self.assertEqual(control["style"], "both")
            self.assertTrue(all(control["setups"].values()))
        for minimum in range(75, 81):
            self.assertEqual(IndexControl(min_confidence=minimum).min_confidence, minimum)
        for patch in (dict(max_trades=0), dict(max_trades=11), dict(min_confidence=74),
                      dict(min_confidence=81), dict(min_confidence=90), dict(min_confidence=75.5),
                      dict(min_confidence=True), dict(min_confidence="75"),
                      dict(enabled="yes"), dict(daily_loss=2001), dict(stop_percent=float("nan"))):
            with self.assertRaises(ValidationError):
                IndexControl(**patch)

    def test_score_floor_is_enforced_for_each_style_even_when_unvalidated_rules_are_allowed(self):
        from test_aqte import scalp_info

        for strategy, facts in (("quick_scalp_20", scalp_info(volume_ratio=2, imbalance=0.2, sweep=0, live={"price": 106})),
                                ("trend_continuation", TREND)):
            for side, info in (("CE", facts), ("PE", mirror(facts))):
                signal = dict(decision=f"BUY {side}", strategy=strategy, confidence=75,
                              entry={"maximum": 100, "points_allowed": [10, 20]}, intelligence=info,
                              model_validated=False)
                for minimum in range(75, 81):
                    config = IndexControl(min_confidence=minimum).model_dump()
                    for score in (70, 74, 75, 77, 80, 85):
                        with self.subTest(strategy=strategy, side=side, minimum=minimum, score=score):
                            candidate = {**signal, "confidence": score}
                            reason = quality_reason(candidate, config, True)
                            if score < minimum:
                                self.assertIn(f"below {minimum}/100", reason)
                            else:
                                self.assertIsNone(reason)
                                self.assertIn("validation", quality_reason(candidate, config))

    def test_short_entries_weak_scores_unvalidated_and_missing_evidence_block(self):
        config = IndexControl().model_dump()
        for decision in ("SELL CE", "SELL PE", "WAIT"):
            self.assertIn("LONG", quality_reason(dict(decision=decision, entry={}), config))
        signal = dict(decision="BUY CE", entry={"maximum": 100}, confidence=74)
        self.assertIn("75", quality_reason(signal, config))
        signal["confidence"] = 80
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
        self.assertIn("validation", quality_reason(signal, config))
        self.assertIsNone(quality_reason(signal, config, allow_unvalidated_rules=True))
        for decision in ("SELL PE", "WAIT"):
            self.assertIn("LONG", quality_reason({**signal, "decision": decision}, config, True))
        for score in (None, float("nan"), float("inf"), "80", True, 74):
            self.assertIn("score", quality_reason({**signal, "confidence": score}, config, True))
        for key, value in (("rsi", 50), ("volume_ratio", 1.4), ("imbalance", -0.1), ("breakout", 0),
                           ("structure", "RANGE"), ("supertrend", "BULLISH"), ("vwap", None)):
            weak = {**signal, "intelligence": {**intelligence, key: value}}
            self.assertIn("confirmation missing", quality_reason(weak, config, True))
        unaligned = {**signal, "intelligence": {**intelligence, "ema": {**intelligence["ema"], "50": 91}}}
        self.assertIn("EMA", quality_reason(unaligned, config, True))
        self.assertIn("Incomplete", quality_reason({**signal, "intelligence": {}}, config, True))

    def test_both_styles_are_default_and_scalp_gate_rechecks_scalp_rules(self):
        self.assertEqual(IndexControl().style, "both")
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
        signal = dict(decision="BUY CE", strategy="quick_scalp_10", confidence=75, model_validated=False,
                      entry={"maximum": 100, "points_allowed": [10]}, intelligence=intelligence)
        self.assertIn("validation", quality_reason(signal, config))
        # The swing gate would reject unaligned EMA 50/100/200 and missing CPR; scalping needs only its rules.
        self.assertIsNone(quality_reason(signal, config, allow_unvalidated_rules=True))
        self.assertIn("OFF in Controls", quality_reason(signal, {**config, "style": "swing"}, True))
        self.assertIn("No entry style", quality_reason(signal, {**config, "style": "none"}, True))
        for key, value, reason in (("rsi", 85, "RSI"), ("breakout", 0, "breakout"),
                                   ("volume_ratio", 1.2, "volume"), ("imbalance", 0.0, "imbalance")):
            weak = {**signal, "intelligence": {**intelligence, key: value}}
            self.assertIn(reason, quality_reason(weak, config, True))
        self.assertIn("direction", quality_reason({**signal, "decision": "BUY PE"}, config, True))


if __name__ == "__main__":
    unittest.main()
