import unittest

from services.chart_intelligence_service import _previous_session_ohlc


class ChartWorkspaceLevelTests(unittest.TestCase):
    def test_selects_daily_session_before_displayed_candles(self):
        candles = [{"t": "2026-10-16T09:15:00+05:30"}]
        daily = [
            {"t": "2026-10-15", "h": 120, "l": 90, "c": 110},
            {"t": "2026-10-16", "h": 150, "l": 100, "c": 140},
        ]
        self.assertEqual(
            _previous_session_ohlc(candles, daily),
            {"date": "2026-10-15", "high": 120, "low": 90, "close": 110},
        )

    def test_weekend_snapshot_does_not_use_displayed_friday_as_previous(self):
        candles = [{"t": "2026-10-16T15:25:00+05:30"}]
        daily = [
            {"t": "2026-10-16", "h": 150, "l": 100, "c": 140},
            {"t": "2026-10-15", "h": 120, "l": 90, "c": 110},
        ]
        self.assertEqual(_previous_session_ohlc(candles, daily)["date"], "2026-10-15")

    def test_missing_or_invalid_previous_session_is_explicitly_unavailable(self):
        candles = [{"t": "2026-10-16T09:15:00+05:30"}]
        self.assertIsNone(_previous_session_ohlc(candles, []))
        self.assertIsNone(_previous_session_ohlc([], []))
        self.assertIsNone(_previous_session_ohlc(
            candles, [{"t": "2026-10-15", "h": 0, "l": 0, "c": 0}]
        ))


if __name__ == "__main__":
    unittest.main()
