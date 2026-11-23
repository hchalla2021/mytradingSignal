import unittest
from datetime import datetime

from services.aqte_engine import IST
from services.quantumedge_shadow_fvg import FVGConfig, detect_fvgs


START = datetime(2026, 11, 23, 9, 15, tzinfo=IST).timestamp()
CONFIG = FVGConfig(atr_period=2, min_gap_ticks=1, tick_size=0.1,
                   displacement_atr=0.75, displacement_body=0.6, max_age_bars=1)


def candle(index, op, high, low, close):
    return {"at": START + index * 300, "open": op, "high": high, "low": low, "close": close}


def bullish():
    return [
        candle(0, 100, 101, 99, 100),
        candle(1, 100, 101, 99, 100),
        candle(2, 100, 101, 99, 100),
        candle(3, 100, 105, 100, 104),
        candle(4, 104, 105, 103, 104),
    ]


def mirror(bars):
    return [{"at": b["at"], "open": 200 - b["open"], "high": 200 - b["low"],
             "low": 200 - b["high"], "close": 200 - b["close"]} for b in bars]


class ShadowFVGTests(unittest.TestCase):
    def test_both_directions_use_first_and_third_candle_and_closed_formation(self):
        for bars, side, low, high in ((bullish(), "BULLISH", 101, 103),
                                      (mirror(bullish()), "BEARISH", 97, 99)):
            self.assertFalse(detect_fvgs(bars, 300, START + 5 * 300 - 1, CONFIG)["history_ready"])
            result = detect_fvgs(bars, 300, START + 5 * 300, CONFIG)
            self.assertTrue(result["history_ready"])
            zones = result["zones"]
            self.assertEqual(len(zones), 1)
            self.assertEqual((zones[0]["side"], zones[0]["low"], zones[0]["high"]),
                             (side, low, high))
            self.assertEqual(zones[0]["formed_at"], START + 5 * 300)
            self.assertEqual(zones[0]["state"], "OPEN")

    def test_gap_cannot_span_missing_candle_or_session(self):
        bars = bullish()
        self.assertEqual(detect_fvgs(bars[:3] + bars[4:], 300, START + 5 * 300, CONFIG)["zones"], [])
        bars[4]["at"] += 86400
        self.assertEqual(detect_fvgs(bars, 300, START + 86400 + 5 * 300, CONFIG)["zones"], [])

    def test_wick_fill_and_invalidation_for_both_sides(self):
        bars = bullish() + [candle(5, 104, 104, 101, 102)]
        for sample in (bars, mirror(bars)):
            zone = detect_fvgs(sample, 300, START + 6 * 300, CONFIG)["zones"][0]
            self.assertEqual(zone["state"], "FILLED")
            self.assertEqual(zone["touched_at"], START + 5 * 300)
            self.assertEqual(zone["midpoint_at"], START + 5 * 300)
        bars[-1] = candle(5, 104, 104, 100, 100)
        for sample in (bars, mirror(bars)):
            self.assertEqual(detect_fvgs(sample, 300, START + 6 * 300, CONFIG)["zones"][0]["state"],
                             "INVALIDATED")

    def test_age_and_continuity_are_explicit(self):
        bars = bullish() + [candle(5, 104, 105, 104, 104), candle(6, 104, 105, 104, 104)]
        zone = detect_fvgs(bars, 300, START + 7 * 300, CONFIG)["zones"][0]
        self.assertTrue(zone["stale"])
        self.assertFalse(zone["continuity_lost"])
        zone = detect_fvgs(bars[:5] + [candle(7, 104, 105, 104, 104)],
                           300, START + 8 * 300, CONFIG)["zones"][0]
        self.assertTrue(zone["continuity_lost"])
        self.assertFalse(detect_fvgs(bars[:5], 300, START + 7 * 300, CONFIG)["history_ready"])

    def test_incomplete_candle_does_not_change_recorded_result(self):
        baseline = detect_fvgs(bullish(), 300, START + 5 * 300, CONFIG)
        incomplete = candle(5, 104, 104, 90, 90)
        self.assertEqual(detect_fvgs(bullish() + [incomplete], 300,
                                     START + 5 * 300, CONFIG), baseline)


if __name__ == "__main__":
    unittest.main()
