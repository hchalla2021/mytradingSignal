import unittest

from services.strike_intelligence_service import StrikeIntelligenceService


def _build_mock_strikes(bullish: bool = True):
    rows = []
    base_strike = 25000
    for i in range(-5, 6):
        strike = base_strike + i * 50
        ce_score = 36 - abs(i) * 3 if bullish else 8 - abs(i)
        pe_score = 8 - abs(i) if bullish else 36 - abs(i) * 3
        ce_change = 4.2 - abs(i) * 0.25 if bullish else -2.2 + abs(i) * 0.12
        pe_change = -2.1 + abs(i) * 0.15 if bullish else 4.0 - abs(i) * 0.22

        rows.append(
            {
                "strike": strike,
                "isATM": i == 0,
                "ce": {
                    "score": ce_score,
                    "volume": 150000 - abs(i) * 8000,
                    "oi": 130000 - abs(i) * 7000,
                    "price": 225 + i,
                    "change": ce_change,
                    "velocity": "HOT" if abs(i) <= 2 else "WARM",
                    "signals": {
                        "bos": "UP" if bullish else "DOWN",
                        "trap": False,
                    },
                },
                "pe": {
                    "score": pe_score,
                    "volume": 90000 - abs(i) * 5000,
                    "oi": 95000 - abs(i) * 4500,
                    "price": 175 - i,
                    "change": pe_change,
                    "velocity": "WARM",
                    "signals": {
                        "bos": "UP" if bullish else "DOWN",
                        "trap": abs(i) >= 4,
                    },
                },
            }
        )
    return rows


class QuantumFractalIntelligenceTests(unittest.TestCase):
    def test_quantum_fractal_contract_and_signal(self):
        svc = StrikeIntelligenceService()
        strikes = _build_mock_strikes(bullish=True)
        intelligence = {
            "score": 34.0,
            "agreementPct": 78,
            "signal": "BUY",
        }

        result = None
        for _ in range(32):
            result = svc._compute_quantum_fractal_intelligence(
                "NIFTY",
                strikes,
                intelligence,
                data_source="LIVE",
                option_age_sec=0.4,
            )

        self.assertIsNotNone(result)
        self.assertIn(result["signal"], {"STRONG_BUY", "BUY", "NEUTRAL", "SELL", "STRONG_SELL"})
        self.assertIn("title", result)
        self.assertIn("tags", result)
        self.assertGreaterEqual(len(result["tags"]), 1)
        self.assertIn("mtf", result)
        self.assertIn("components", result)
        self.assertIn("prediction", result)
        self.assertIn("alignmentPct", result["mtf"])
        self.assertIn(result["prediction"]["nextMove"], {"UP", "DOWN", "SIDEWAYS"})


if __name__ == "__main__":
    unittest.main()