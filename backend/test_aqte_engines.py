import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from services.aqte_engine import Contract, directional_checks, scalp_bias
from services.aqte_engines import (
    ENGINES, EngineConfig, _bs, evaluate, greeks, option_chain, orchestrate, rank_key, resample, veto_reason,
)
from services.aqte_service import VIX_INSTRUMENT, AQTEService
from test_aqte import NOW, START, ready_engine, scalp_info, tick

CE = Contract("NIFTY", 31, "NIFTY26NOV22000CE", "NFO", "CE", 22000, "2026-11-03", 75, 0.05)
PE = Contract("NIFTY", 32, "NIFTY26NOV22000PE", "NFO", "PE", 22000, "2026-11-03", 75, 0.05)


def ready_signal(**info):
    info = scalp_info(**info)
    side = scalp_bias(info)
    return dict(symbol="NIFTY", feed_ready=True, intelligence=info, reasons=[],
                rule_checks={"scalp": dict(side=side, checks=directional_checks(info, side, "scalp")),
                             "swing": dict(side=side, checks=directional_checks(info, side, "swing"))})


def bars(count=120, step=0.5):
    return [dict(at=START + i * 60, open=100 + i * step, high=101 + i * step, low=99 + i * step,
                 close=100.4 + i * step, volume=1000) for i in range(count)]


class GreeksTests(unittest.TestCase):
    def test_implied_volatility_round_trips_black_scholes_price(self):
        years = 7 / 365
        for call in (True, False):
            price = _bs(22000, 22100, years, 0.065, 0.18, call)[0]
            model = greeks(22000, 22100, years, 0.065, price, call)
            self.assertAlmostEqual(model["iv"], 18.0, places=1)
            self.assertGreater(model["gamma"], 0)
            self.assertGreater(model["vega"], 0)
            self.assertLess(model["theta"], 0)
            self.assertTrue(0 < model["delta"] < 1 if call else -1 < model["delta"] < 0)

    def test_premium_outside_arbitrage_bounds_is_unsolvable(self):
        self.assertIsNone(greeks(22000, 21000, 0.02, 0.065, 900, True))
        self.assertIsNone(greeks(22000, 22000, 0.02, 0.065, 0, True))
        self.assertIsNone(greeks(None, 22000, 0.02, 0.065, 100, True))


class ChainTests(unittest.TestCase):
    def test_pcr_atm_and_spread_come_from_live_quotes(self):
        chain = option_chain([(CE, tick("option", token=31, oi=1000)), (PE, tick("option", token=32, oi=1500))],
                             22010, NOW, 0.065)
        self.assertEqual(chain["pcr"], 1.5)
        self.assertEqual(set(chain["atm"]), {"CE", "PE"})
        self.assertAlmostEqual(chain["atm"]["CE"]["spread"], round(2 / 101, 4))
        self.assertIsNotNone(chain["atm"]["CE"]["iv"])

    def test_pcr_is_unavailable_without_reported_oi_on_both_sides(self):
        chain = option_chain([(CE, tick("option", token=31, oi=1000)), (PE, tick("option", token=32))], 22010, NOW, 0.065)
        self.assertIsNone(chain["pcr"])
        self.assertIsNone(option_chain([(CE, tick("option", token=31, oi=1000))], 22010, NOW, 0.065)["pcr"])

    def test_resample_drops_incomplete_tail_bucket(self):
        closes = resample(bars(17), 300)
        self.assertEqual(len(closes), 3)
        self.assertEqual(closes[-1], bars(17)[14]["close"])


class EngineTests(unittest.TestCase):
    def test_stale_feed_reports_all_twelve_engines_monitoring(self):
        result = evaluate(dict(symbol="NIFTY", feed_ready=False, intelligence=None, rule_checks=None,
                               reasons=["Futures feed stale"]), now=NOW)
        self.assertEqual([e["id"] for e in result["engines"]], list(range(1, 13)))
        self.assertTrue(all(e["status"] == "MONITORING" and e["reason"] == "Futures feed stale" for e in result["engines"]))
        self.assertEqual(result["orchestration"]["monitoring"], 12)
        self.assertIsNone(result["orchestration"]["consensus"])
        self.assertIsNone(result["market"]["regime"])

    def test_aligned_live_evidence_satisfies_directional_engines(self):
        signal = ready_signal()
        live = tick(price=107, buy_depth=300, sell_depth=100, bid_quantity=200, ask_quantity=50)
        result = evaluate(signal, live=live, spot=tick("spot", price=106.5), bars=bars(), now=NOW,
                          vix=dict(price=14, change_pct=1.2))
        engines = {e["key"]: e for e in result["engines"]}
        self.assertEqual(engines["scalping"]["status"], "SATISFIED")
        self.assertEqual(engines["scalping"]["side"], "CE")
        self.assertEqual(engines["momentum"]["status"], "SATISFIED")
        self.assertEqual(engines["breakout"]["side"], "CE")
        self.assertEqual(engines["ml"]["status"], "MONITORING")
        self.assertEqual(engines["ml"]["authority"], "SHADOW")
        # Option evidence is not subscribed here, so it is never invented.
        self.assertEqual(engines["options"]["status"], "MONITORING")
        self.assertEqual(result["orchestration"]["consensus"], "CE")
        self.assertEqual(result["orchestration"]["pe"], 0)
        self.assertEqual(result["market"]["regime"], "Trending Bullish")
        self.assertEqual(result["market"]["volatility"], "Moderate")
        for engine in result["engines"]:
            self.assertEqual(engine["total"], len(engine["rules"]))
            self.assertIn(engine["status"], ("SATISFIED", "PARTIAL", "MONITORING", "NOT_SATISFIED"))

    def test_missing_vix_keeps_volatility_breakout_monitoring(self):
        engines = {e["key"]: e for e in evaluate(ready_signal(), live=tick(price=107), bars=bars(), now=NOW)["engines"]}
        self.assertEqual(engines["volatility_breakout"]["status"], "MONITORING")
        vix_rule = next(r for r in engines["volatility_breakout"]["rules"] if r["id"] == "vix")
        self.assertIsNone(vix_rule["passed"])

    def test_no_direction_is_a_failure_not_missing_evidence(self):
        signal = ready_signal(breakout=0, sweep=0)
        engines = {e["key"]: e for e in evaluate(signal, live=tick(price=107), bars=bars(), now=NOW)["engines"]}
        self.assertIsNone(engines["breakout"]["side"])
        self.assertNotEqual(engines["breakout"]["status"], "MONITORING")
        self.assertIs(engines["breakout"]["rules"][0]["passed"], False)

    def test_shadow_ml_never_votes(self):
        cards = [dict(status="SATISFIED", side="PE", authority="SHADOW")] + \
            [dict(status="SATISFIED", side="CE", authority="ADVISORY")]
        result = orchestrate(cards)
        self.assertEqual((result["ce"], result["pe"], result["conflict"]), (1, 0, False))


class AuthorityTests(unittest.TestCase):
    def test_veto_blocks_only_clear_opposition(self):
        signal = dict(decision="BUY CE", orchestration=dict(ce=1, pe=3))
        self.assertIn("oppose CE", veto_reason(signal))
        self.assertIsNone(veto_reason({**signal, "decision": "BUY PE"}))
        self.assertIsNone(veto_reason({**signal, "orchestration": dict(ce=2, pe=2)}))
        self.assertIsNone(veto_reason({**signal, "orchestration": dict(ce=0, pe=1)}))
        self.assertIsNone(veto_reason(signal, EngineConfig(veto=False)))
        self.assertIsNone(veto_reason({**signal, "orchestration": None}))
        self.assertIsNone(veto_reason(dict(decision="WAIT", orchestration=dict(ce=0, pe=9))))

    def test_rank_prefers_actionable_then_aligned_engines_then_score(self):
        entry = dict(maximum=100)
        signals = {
            "A": dict(decision="BUY CE", entry=entry, confidence=95, orchestration=dict(ce=2, pe=0)),
            "B": dict(decision="BUY PE", entry=entry, confidence=70, orchestration=dict(ce=0, pe=5)),
            "C": dict(decision="WAIT", entry=None, confidence=99, orchestration=dict(ce=9, pe=0)),
        }
        self.assertEqual(sorted(signals, key=lambda s: rank_key(signals[s]), reverse=True), ["B", "A", "C"])


class ServiceTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.service = AQTEService(Path(directory.name) / "aqte.sqlite3")
        self.service.engine = ready_engine(paper_enabled=False)
        self.service.started = True

    def test_snapshot_carries_twelve_engines_per_index_and_advisory_policy(self):
        with patch("services.aqte_service.time.time", return_value=NOW + 0.5):
            snapshot = self.service.snapshot()
        self.assertEqual(snapshot["engine_policy"]["authority"], "ADVISORY_VETO")
        nifty = snapshot["data"]["NIFTY"]
        self.assertEqual(len(nifty["engines"]), len(ENGINES))
        self.assertTrue(nifty["feed_ready"])
        self.assertNotEqual(nifty["orchestration"]["monitoring"], 12)
        self.assertIsNotNone(nifty["options"])
        self.assertEqual(snapshot["data"]["SENSEX"]["orchestration"]["monitoring"], 12)

    def test_engine_failure_never_breaks_the_snapshot(self):
        with patch("services.aqte_service.time.time", return_value=NOW + 0.5), \
                patch("services.aqte_service.evaluate", side_effect=RuntimeError("boom")):
            snapshot = self.service.snapshot()
        self.assertIsNone(snapshot["data"]["NIFTY"]["engines"])
        self.assertIn(snapshot["data"]["NIFTY"]["decision"], ("WAIT", "BUY CE", "BUY PE"))
        self.assertIsNone(snapshot["engine_policy"])

    def test_vix_is_routed_and_aged_and_other_indices_never_reach_the_engine(self):
        kite = Mock()
        kite.ltp.return_value = {VIX_INSTRUMENT: {"instrument_token": 264969, "last_price": 15.5}}
        self.service.resolve_vix(kite)
        self.assertTrue(self.service.option_tick({"instrument_token": 264969, "last_price": 15.5,
                                                  "ohlc": {"close": 15.0}}))
        self.assertAlmostEqual(self.service.vix["change_pct"], 3.33)
        with patch("services.aqte_service.time.time", return_value=self.service.vix["received"] + 1):
            self.assertEqual(self.service.snapshot()["vix"]["price"], 15.5)
        with patch("services.aqte_service.time.time", return_value=self.service.vix["received"] + 60):
            self.assertIsNone(self.service.snapshot()["vix"])
        self.service.enqueue("INDIAVIX", "spot", {"instrument_token": 256170, "last_price": 15})
        self.assertTrue(self.service.queue.empty())

    def test_vix_lookup_failure_leaves_vix_unavailable(self):
        kite = Mock()
        kite.ltp.side_effect = ConnectionError("down")
        self.service.resolve_vix(kite)
        self.assertIsNone(self.service.vix_token)


class LiveAuthorityTests(unittest.TestCase):
    def test_live_controller_blocks_conflicting_entry_and_never_approves(self):
        from test_aqte_live import LiveTests

        case = LiveTests("test_same_contract_cooldown_and_nearly_identical_prices_are_rejected")
        case.setUp()
        self.addCleanup(case.doCleanups)
        signal = case.market.snapshot()["data"]["NIFTY"]
        self.assertIsNone(case.live.control_reason("NIFTY", signal))
        side = signal["decision"][-2:]
        opposite = "pe" if side == "CE" else "ce"
        signal["orchestration"] = {"ce": 0, "pe": 0, opposite: 3}
        self.assertIn("Engine conflict", case.live.control_reason("NIFTY", signal))
        signal["orchestration"] = {"ce": 0, "pe": 0, side.lower(): 12}
        self.assertIsNone(case.live.control_reason("NIFTY", signal))
        signal.update(decision="WAIT", entry=None)
        self.assertIsNotNone(case.live.control_reason("NIFTY", signal))


if __name__ == "__main__":
    unittest.main()
