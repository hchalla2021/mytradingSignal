import asyncio
import math
import queue
import tempfile
import time
import unittest
from dataclasses import replace
from datetime import datetime
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.aqte_engine import (
    AQTEEngine, CandleBook, Contract, IST, Policy, Tick,
    intelligence, parse_scalp_points, scalp, strategy, warmup_count,
)
from services.aqte_replay import replay, replay_database
from services.aqte_service import AQTEService, normalize

START = datetime(2026, 10, 30, 9, 15, tzinfo=IST).timestamp()
NOW = START + 202 * 60
CONTRACT = Contract("NIFTY", 30, "NIFTY26NOV22000CE", "NFO", "CE",
                    22000, "2026-11-03", 15, 0.05)


def tick(kind="future", at=NOW, **values):
    defaults = dict(symbol="NIFTY", kind=kind, token={"spot": 10, "future": 20, "option": 30}[kind],
                    price=22000, at=at, received=at, volume=100_000,
                    bid=21999, ask=22001, bid_quantity=100, ask_quantity=100,
                    buy_depth=200, sell_depth=100)
    if kind == "option":
        defaults.update(price=100, bid=99, ask=101)
    defaults.update(values)
    return Tick(**defaults)


def ready_engine(contract=CONTRACT, paper_enabled=True, **policy):
    engine = AQTEEngine(Policy(**policy), paper_enabled=paper_enabled)
    engine.contracts[30] = contract
    for i in range(202):
        at = START + i * 60
        engine.ingest(tick("spot", at=at, price=22000 + i * 0.2))
        engine.ingest(tick("option", at=at))
        engine.ingest(tick(at=at, price=22000 + i * 0.2, volume=i * 1000))
    # A gentle trend within ATR of EMA20, with rising volume.
    bars = engine.book.closed[("future", 20, 60)]
    for bar in bars:
        bar.update(high=bar["close"] + 5, low=bar["close"] - 5)
    engine.ingest(tick("spot", at=NOW, price=22040))
    engine.ingest(tick("option", at=NOW))
    engine.ingest(tick(at=NOW, price=22040.4, volume=202_000))
    if not paper_enabled:
        # Live fixtures must pass the actual swing gate, not just form a candidate.
        engine.previous_day["NIFTY"] = dict(high=22005, low=21995, close=22000)
        for i, bar in enumerate(engine.book.closed[("future", 20, 60)]):
            close = 22000 + i * 0.2 + 2 * math.sin(i * 0.7)
            bar.update(open=close - 0.1, high=close + 5, low=close - 5, close=close)
        engine.analyze("NIFTY", NOW)
    return engine


def scalp_info(**values):
    info = dict(ema={"9": 105, "20": 104, "50": 103, "100": 102, "200": 101}, close=106, vwap=100,
                atr=10, supertrend="BULLISH", rsi=65, breakout=1, volume_ratio=1.6, imbalance=0.15,
                cpr={"pivot": 99, "bottom": 98, "top": 100}, structure="HIGHER_HIGH", at=NOW - 60)
    info.update(values)
    return info


THURSDAY = datetime(2026, 10, 29, 9, 15, tzinfo=IST).timestamp()


class EvidenceTests(unittest.TestCase):
    def test_live_swing_cannot_report_buy_when_its_own_setup_checks_fail(self):
        from test_aqte_daily_control import mirror

        mixed = scalp_info(ema={"9": 95, "20": 96, "50": 90, "100": 85, "200": 80},
                           close=94, vwap=93, rsi=41, supertrend="BEARISH", volume_ratio=1.77,
                           imbalance=-0.06, breakout=-1, sweep=0, structure="LOWER_LOW",
                           cpr={"top": 92, "bottom": 90}, live={"price": 94})
        for side, info in (("PE", mixed), ("CE", mirror(mixed))):
            with self.subTest(side=side):
                engine = ready_engine(contract=replace(CONTRACT, side=side), paper_enabled=False)
                with patch("services.aqte_engine.intelligence", return_value=info):
                    engine.analyze("NIFTY", NOW)
                signal = engine.snapshot(NOW)["data"]["NIFTY"]
                setup = signal["setups"][0]
                self.assertFalse(setup["passed"])
                self.assertEqual(signal["decision"], "WAIT")
                self.assertIsNone(signal["entry"])
                self.assertIsNone(signal["contract"])
                self.assertEqual(signal["strategy"], "momentum_breakout")
                failures = [check for check in setup["checks"] if check["passed"] is not True]
                self.assertEqual(len(signal["reasons"]), len(failures))
                for check, reason in zip(failures, signal["reasons"]):
                    self.assertIn(check["reason"], reason)
                self.assertFalse(engine.orders)

    def test_live_swing_still_uses_a_passing_alternative_to_a_failed_breakout(self):
        from test_aqte_daily_control import REVERSAL

        engine = ready_engine(paper_enabled=False)
        info = {**REVERSAL, "breakout": 1, "volume_ratio": 2, "imbalance": 0.3, "at": NOW - 60}
        with patch("services.aqte_engine.intelligence", return_value=info):
            engine.analyze("NIFTY", NOW)
        signal = engine.snapshot(NOW)["data"]["NIFTY"]
        self.assertEqual([(setup["name"], setup["passed"]) for setup in signal["setups"]],
                         [("momentum_breakout", False), ("liquidity_reversal", True)])
        self.assertEqual((signal["decision"], signal["strategy"]), ("BUY CE", "liquidity_reversal"))
        self.assertIsNotNone(signal["entry"])
        self.assertTrue(all(check["passed"] for check in signal["rule_checks"]["swing"]["checks"]))

    def test_kite_oi_is_preserved_and_missing_is_not_zero(self):
        raw = dict(instrument_token=20, last_price=22000,
                   exchange_timestamp=datetime.fromtimestamp(NOW, IST), oi=100_500)
        self.assertEqual(normalize("NIFTY", "future", raw, NOW).oi, 100_500)
        raw.pop("oi")
        self.assertIsNone(normalize("NIFTY", "future", raw, NOW).oi)
        for invalid in (-1, True, 1.5, float("nan"), "100"):
            with self.subTest(oi=invalid), self.assertRaises(ValueError):
                normalize("NIFTY", "future", {**raw, "oi": invalid}, NOW)

    def test_oi_change_uses_same_contract_previous_completed_minute_not_first_tick(self):
        engine = ready_engine(paper_enabled=False)
        bars = engine.book.closed[("future", 20, 60)]
        bars[-1]["oi"] = 100_000
        engine.ingest(tick(at=NOW + 1, oi=101_000, buy_depth=2708, sell_depth=7292))
        info = engine.snapshot(NOW + 1)["data"]["NIFTY"]["intelligence"]
        self.assertEqual(info["at"], NOW - 60)
        market = info["live"]
        self.assertEqual((market["at"], market["received"], market["token"]), (NOW + 1, NOW + 1, 20))
        self.assertEqual((market["oi"], market["oi_reference"], market["oi_reference_at"]),
                         (101_000, 100_000, NOW))
        self.assertEqual((market["oi_change"], market["oi_change_pct"]), (1000, 1.0))
        self.assertAlmostEqual(info["imbalance"], -0.4584)
        self.assertEqual((market["buy_depth"], market["sell_depth"]), (2708, 7292))
        engine.ingest(tick(at=NOW + 2, oi=102_000))
        self.assertEqual(engine.signals["NIFTY"]["intelligence"]["live"]["oi_change"], 2000)
        engine.ingest(tick(at=NOW + 3, token=21, oi=500))
        self.assertIsNone(engine.signals["NIFTY"]["intelligence"], "Never compare OI across a rollover")

    def test_oi_unknown_and_zero_reference_do_not_invent_percentage(self):
        engine = ready_engine(paper_enabled=False)
        bars = list(engine.book.closed[("future", 20, 60)])
        missing = intelligence(bars, tick(oi=100))["live"]
        self.assertIsNone(missing["oi_change"])
        self.assertIsNone(missing["oi_reference_at"])
        bars[-1]["oi"] = 0
        zero = intelligence(bars, tick(oi=100))["live"]
        self.assertEqual(zero["oi_change"], 100)
        self.assertIsNone(zero["oi_change_pct"])
        bars[-1]["oi"] = 100
        unchanged = intelligence(bars, tick(oi=100))["live"]
        self.assertEqual((unchanged["oi_change"], unchanged["oi_change_pct"]), (0, 0))
        missing = intelligence(bars, tick())["live"]
        self.assertIsNone(missing["oi"])
        self.assertIsNone(missing["oi_change"])

    def test_candles_keep_last_reported_oi_and_legacy_ticks_still_load(self):
        book = CandleBook()
        book.add(tick(at=START, oi=100))
        book.add(tick(at=START + 59, oi=120))
        book.add(tick(at=START + 60, oi=130))
        self.assertEqual(book.closed[("future", 20, 60)][0]["oi"], 120)
        self.assertEqual(book.current[("future", 20, 60)]["oi"], 130)
        legacy = dict(symbol="NIFTY", kind="future", token=20, price=100, at=NOW, received=NOW)
        self.assertIsNone(Tick(**legacy).oi)

    def test_zero_volume_baseline_is_unavailable_not_a_measured_zero_ratio(self):
        engine = ready_engine(paper_enabled=False)
        bars = list(engine.book.closed[("future", 20, 60)])
        for bar in bars[-21:]:
            bar["volume"] = 0
        info = intelligence(bars, tick())
        self.assertIsNone(info["volume_ratio"])
        self.assertIsNone(strategy(info))
        bars[-2]["volume"] = 100
        self.assertEqual(intelligence(bars, tick())["volume_ratio"], 0)

    def test_screenshot_mixed_indicators_are_not_a_bullish_all_clear(self):
        from services.aqte_engine import directional_checks, scalp_bias

        info = scalp_info(ema={"9": 95, "20": 96, "50": 97, "100": 98, "200": 99},
                          close=94, vwap=100, supertrend="BULLISH", rsi=49.03,
                          breakout=0, structure="RANGE", volume_ratio=1.84, imbalance=-0.4583)
        self.assertEqual(scalp_bias(info), "PE")
        checks = {c["id"]: c for c in directional_checks(info, "PE", "scalp")}
        for name in ("ema", "vwap", "volume", "imbalance", "extension"):
            self.assertIs(checks[name]["passed"], True, name)
        for name in ("supertrend", "rsi", "breakout"):
            self.assertIs(checks[name]["passed"], False, name)
        self.assertEqual(scalp(info, (10, 20, 30))[1], checks["supertrend"]["reason"])
        self.assertEqual(len(checks), 8)

    def test_shared_scalp_checks_match_execution_at_thresholds_for_both_sides(self):
        from services.aqte_engine import directional_checks

        for side in ("CE", "PE"):
            info = scalp_info(volume_ratio=1.5, imbalance=0.10, rsi=55)
            if side == "PE":
                info.update(ema={"9": 95, "20": 96, "50": 97, "100": 98, "200": 99},
                            close=94, supertrend="BEARISH", breakout=-1, imbalance=-0.10, rsi=45)
            self.assertTrue(all(c["passed"] for c in directional_checks(info, side, "scalp")))
            self.assertEqual(scalp(info, (10,))[0]["side"], side)
            for field, value in (("volume_ratio", 1.499), ("rsi", 50), ("breakout", 0), ("imbalance", 0)):
                weak = {**info, field: value}
                self.assertFalse(all(c["passed"] for c in directional_checks(weak, side, "scalp")))
                self.assertIsNone(scalp(weak, (10,))[0])
        for invalid in (None, float("nan"), float("inf")):
            checks = directional_checks(scalp_info(volume_ratio=invalid), "CE", "scalp")
            self.assertIsNone(next(c["passed"] for c in checks if c["id"] == "volume"))
            self.assertIsNone(scalp(scalp_info(volume_ratio=invalid), (10,))[0])

    def test_snapshot_publishes_exact_checks_and_clears_them_when_stale(self):
        from services.aqte_engine import directional_checks, scalp_bias, setup_checks, swing_setups

        engine = ready_engine(paper_enabled=False)
        signal = engine.snapshot(NOW)["data"]["NIFTY"]
        info = signal["intelligence"]
        evidence = signal["rule_checks"]
        self.assertEqual(evidence["scalp"], dict(side=scalp_bias(info),
                                                checks=directional_checks(info, scalp_bias(info), "scalp")))
        swing = evidence["swing"]
        self.assertEqual((swing["side"], swing["setup"]), ("CE", signal["strategy"]))
        self.assertEqual(swing["checks"], setup_checks(info, "CE", signal["strategy"]))
        self.assertEqual(signal["setups"], swing_setups(info))
        stale = engine.snapshot(NOW + 6)["data"]["NIFTY"]
        self.assertEqual((stale["rule_checks"], stale["setups"]), (None, []))
        self.assertIsNotNone(engine.signals["NIFTY"]["rule_checks"], "Snapshots must not mutate the engine")


class ScalpTests(unittest.TestCase):
    def test_tier_follows_rule_strength_and_what_futures_atr_can_reach(self):
        points = (10, 20, 30)
        self.assertEqual(scalp(scalp_info(), points)[0], dict(side="CE", points=[10.0], score=70))
        strong = scalp_info(volume_ratio=2, imbalance=0.2)
        self.assertEqual(scalp(strong, points)[0]["points"], [10.0, 20.0])
        strongest = scalp_info(volume_ratio=2.5, imbalance=0.3)
        self.assertEqual(scalp(strongest, points)[0]["points"], [10.0, 20.0], "ATR 10 reaches only 20 points")
        self.assertEqual(scalp({**strongest, "atr": 20}, points)[0], dict(side="CE", points=[10.0, 20.0, 30.0], score=80))
        bearish = scalp_info(ema={"9": 95, "20": 96, "50": 97, "100": 98, "200": 99}, close=94, vwap=100,
                             supertrend="BEARISH", rsi=35, breakout=-1, imbalance=-0.15)
        self.assertEqual(scalp(bearish, points)[0]["side"], "PE")

    def test_scalp_waits_with_an_explainable_reason(self):
        for change, reason in (
            (dict(rsi=85), "RSI"), (dict(breakout=0), "breakout"), (dict(volume_ratio=1.4), "volume"),
            (dict(imbalance=0.05), "imbalance"), (dict(close=130), "no chasing"),
            (dict(supertrend="BEARISH"), "SuperTrend"), (dict(vwap=110), "bias"),
            (dict(atr=1), "too quiet"), (dict(vwap=None), "VWAP"), (dict(ema={}), "Incomplete"),
        ):
            with self.subTest(change=change):
                setup, why = scalp(scalp_info(**change), (10, 20, 30))
                self.assertIsNone(setup)
                self.assertIn(reason, why)
        self.assertIsNone(scalp(scalp_info(), ())[0], "Unconfigured index never scalps")

    def test_scalp_levels_pay_the_ask_use_stop_ratio_and_net_costs(self):
        engine = ready_engine(contract=replace(CONTRACT, lot_size=65), paper_enabled=False)
        spot = engine.spot["NIFTY"]
        result = engine.scalp_signal("NIFTY", scalp_info(volume_ratio=2, imbalance=0.2), NOW, spot)
        self.assertEqual((result["decision"], result["strategy"], result["confidence"]), ("BUY CE", "quick_scalp_20", 75))
        entry = result["entry"]
        self.assertEqual((entry["maximum"], entry["stop"], entry["target"]), (101, 93, 121))
        self.assertEqual((entry["points"], entry["points_allowed"], entry["stop_ratio"]), (20, [10.0, 20.0], 0.4))
        self.assertEqual((entry["quantity"], entry["reward_risk"]), (65, 2.14))
        self.assertEqual(result["contract"]["token"], CONTRACT.token)
        small = ready_engine(paper_enabled=False)
        weak = small.scalp_signal("NIFTY", scalp_info(), NOW, small.spot["NIFTY"])
        self.assertEqual(weak["decision"], "WAIT")
        self.assertIn("reward/risk", weak["reasons"][0], "15-lot 10-point scalp cannot cover ~Rs 45 costs")
        engine.options[30] = replace(tick("option"), ask_quantity=1)
        illiquid = engine.scalp_signal("NIFTY", scalp_info(volume_ratio=2, imbalance=0.2), NOW, spot)
        self.assertIn("liquid", illiquid["reasons"][0])

    def test_snapshot_keeps_fresh_scalp_and_drops_stale_one(self):
        engine = ready_engine(contract=replace(CONTRACT, lot_size=65), paper_enabled=False)
        signal = engine.signals["NIFTY"]
        self.assertEqual(signal["scalp"]["decision"], "WAIT")
        self.assertTrue(signal["scalp"]["reasons"])
        signal["scalp"] = engine.scalp_signal("NIFTY", scalp_info(volume_ratio=2, imbalance=0.2), NOW, engine.spot["NIFTY"])
        self.assertEqual(engine.snapshot(NOW)["data"]["NIFTY"]["scalp"]["decision"], "BUY CE")
        engine.spot["NIFTY"] = tick("spot", at=NOW + 6)
        engine.future["NIFTY"] = tick(at=NOW + 6)
        stale = engine.snapshot(NOW + 6)["data"]["NIFTY"]["scalp"]
        self.assertEqual((stale["decision"], stale["entry"], stale["reasons"]), ("WAIT", None, ["Option quote or signal stale"]))
        feed = engine.snapshot(NOW + 30)["data"]["NIFTY"]["scalp"]
        self.assertIn("Market data stale", feed["reasons"][0])
        self.assertEqual(engine.snapshot(NOW)["data"]["SENSEX"]["scalp"]["decision"], "WAIT")

    def test_live_analysis_prices_the_marketable_ask_while_paper_keeps_the_midpoint(self):
        paper = ready_engine().signals["NIFTY"]["entry"]
        live = ready_engine(contract=replace(CONTRACT, lot_size=65), paper_enabled=False).signals["NIFTY"]["entry"]
        self.assertEqual((paper["maximum"], live["maximum"]), (100, 101))
        self.assertLess(live["stop"], live["maximum"])

    def test_scalp_points_env_parser_fails_closed_per_index(self):
        points, errors = parse_scalp_points("NIFTY:10/20/30, banknifty:60/20/40,SENSEX:abc,FOO:5,NIFTY50:1")
        self.assertEqual(points, {"NIFTY": (10.0, 20.0, 30.0), "BANKNIFTY": (20.0, 40.0, 60.0)})
        self.assertEqual(errors, ["SENSEX:abc", "FOO:5", "NIFTY50:1"])
        self.assertEqual(parse_scalp_points("NIFTY:0/-5")[0], {})
        self.assertEqual(parse_scalp_points("")[0], {})

    def test_small_premium_uses_a_valid_lower_scalp_tier(self):
        engine = ready_engine(contract=replace(CONTRACT, lot_size=65), paper_enabled=False)
        engine.options[30] = tick("option", price=9, bid=8.95, ask=9)
        result = engine.scalp_signal("NIFTY", scalp_info(volume_ratio=2.5, imbalance=0.3, atr=20),
                                     NOW, engine.spot["NIFTY"])
        self.assertEqual(result["decision"], "BUY CE")
        self.assertEqual(result["entry"]["points"], 20)
        self.assertGreater(result["entry"]["stop"], 0)


class SessionWarmupTests(unittest.TestCase):
    def test_warmup_spans_previous_session_and_needs_fifteen_opening_candles(self):
        engine = AQTEEngine(paper_enabled=False)
        for i in range(375):
            at = THURSDAY + i * 60
            engine.ingest(tick("spot", at=at))
            engine.ingest(tick(at=at, price=22000 + i * 0.1, volume=i * 1000))
        preopen = START - 7 * 60
        engine.ingest(tick("spot", at=preopen))
        engine.ingest(tick(at=preopen, volume=500))
        for i in range(16):
            at = START + i * 60
            engine.ingest(tick("spot", at=at))
            engine.ingest(tick(at=at, price=22040 + i * 0.1, volume=1000 + i * 1000))
            signal = engine.signals["NIFTY"]
            self.assertEqual(signal["warmup"], {"completed": 201, "required": 201}, "Overnight gap is not missing data")
            self.assertEqual(signal["opening"], {"completed": i, "required": 15})
            if i < 15:
                self.assertIsNone(signal["intelligence"])
                self.assertIn("Opening range", signal["reasons"][0])
        self.assertIsNotNone(signal["intelligence"], "First signal evaluation at 09:30 IST")
        self.assertGreater(signal["intelligence"]["vwap"], 22039, "VWAP uses today's session only")

    def test_intraday_gap_still_resets_and_history_seed_heals_it(self):
        engine = AQTEEngine(paper_enabled=False)
        for minute in (0, 1, 4, 5, 6):
            engine.ingest(tick(at=START + minute * 60, price=22000 + minute))
        key = ("future", 20, 60)
        self.assertEqual(warmup_count(engine.book.closed[key], START + 6 * 60 + 10), 2)
        history = [dict(at=START + m * 60, open=1, high=2, low=0.5, close=1.5, volume=10) for m in range(-30, 8)]
        history += [dict(at=THURSDAY + m * 60, open=1, high=2, low=0.5, close=1.5, volume=10) for m in range(375)]
        self.assertEqual(engine.seed_bars(20, history, START + 6 * 60 + 10), 375 + 4)
        bars = {b["at"]: b for b in engine.book.closed[key]}
        self.assertEqual(bars[START + 4 * 60]["close"], 22004, "Latest live minutes stay authoritative")
        self.assertEqual(bars[START]["close"], 1.5, "Exchange history replaces older live-built bars")
        self.assertNotIn(START - 60, bars, "Pre-open history is ignored")
        self.assertNotIn(START + 6 * 60, bars, "Forming minute is never seeded")
        self.assertEqual(warmup_count(engine.book.closed[key], START + 6 * 60 + 10), 201)
        self.assertEqual(engine.seed_bars(20, history, START + 6 * 60 + 10), 0)
        engine.ingest(tick(at=START + 7 * 60, price=22007))
        self.assertEqual(engine.book.closed[key][-1]["at"], START + 6 * 60)
        self.assertEqual(warmup_count(engine.book.closed[key], START + 7 * 60 + 10), 201)


class CandleTests(unittest.TestCase):
    def test_all_intervals_and_incremental_volume_without_first_tick_volume_spike(self):
        book = CandleBook()
        book.add(tick(at=START, volume=1000))
        book.add(tick(at=START + 0.5, volume=1012, price=22002))
        book.add(tick(at=START + 301, volume=1020, price=21999))
        for interval in (1, 5, 15, 60, 180, 300):
            bar = book.closed[("future", 20, interval)][0]
            self.assertEqual(bar["volume"], 12)
            self.assertEqual((bar["open"], bar["high"], bar["low"], bar["close"]),
                             (22000, 22002, 22000, 22002))

    def test_same_exchange_second_can_update_price_depth_and_volume(self):
        book = CandleBook()
        self.assertTrue(book.add(tick(at=START, received=START + 0.1, volume=100)))
        self.assertTrue(book.add(tick(at=START, received=START + 0.2, volume=105, price=22003)))
        self.assertEqual(book.current[("future", 20, 1)]["volume"], 5)
        self.assertFalse(book.add(tick(at=START - 1, received=START + 0.3)))

    def test_missing_bars_not_fabricated_and_contracts_not_mixed(self):
        book = CandleBook()
        book.add(tick(at=START))
        book.add(tick(at=START + 300))
        book.add(tick(at=START + 301, token=21))
        self.assertEqual(len(book.closed[("future", 20, 60)]), 1)
        self.assertEqual(len(book.closed[("future", 21, 60)]), 0)

    def test_no_signal_until_201_contiguous_completed_candles(self):
        engine = ready_engine()
        bars = list(engine.book.closed[("future", 20, 60)])
        self.assertIsNone(intelligence(bars[:200], tick()))
        bars[-1] = {**bars[-1], "at": bars[-1]["at"] + 60}
        self.assertIsNone(intelligence(bars, tick()))

    def test_contiguous_but_old_candles_cannot_drive_a_fresh_tick_after_a_gap(self):
        engine = ready_engine()
        bars = list(engine.book.closed[("future", 20, 60)])
        self.assertIsNotNone(intelligence(bars, tick()))
        self.assertIsNone(intelligence(bars, tick(at=NOW + 10 * 60)))

    def test_first_resumed_minute_after_feed_gap_cannot_reuse_old_strategy(self):
        engine = ready_engine()
        engine.paper_enabled = False
        engine.orders.clear()
        resumed = NOW + 10 * 60
        engine.ingest(tick("spot", at=resumed))
        engine.ingest(tick("option", at=resumed))
        engine.ingest(tick(at=resumed))
        signal = engine.snapshot(resumed)["data"]["NIFTY"]
        self.assertEqual(signal["decision"], "WAIT")
        self.assertIsNone(signal["intelligence"])
        self.assertIn("201 contiguous", signal["reasons"][0])

    def test_warmup_counts_only_completed_current_session_candles_and_caps_at_201(self):
        book = CandleBook()
        for index in range(205):
            at = START + index * 60
            book.add(tick(at=at))
            self.assertEqual(warmup_count(book.closed[("future", 20, 60)], at), min(index, 201))
        resumed = at + 10 * 60
        book.add(tick(at=resumed))
        self.assertEqual(warmup_count(book.closed[("future", 20, 60)], resumed), 0)
        book.add(tick(at=resumed + 60))
        self.assertEqual(warmup_count(book.closed[("future", 20, 60)], resumed + 60), 1)
        self.assertEqual(warmup_count(book.closed[("future", 20, 60)], START + 86400), 0)
        self.assertEqual(warmup_count(book.closed[("future", 21, 60)], resumed + 60), 0)

    def test_signal_reports_actual_warmup_without_claiming_ml_validation(self):
        engine = AQTEEngine(paper_enabled=False)
        initial = engine.snapshot(START)["data"]["NIFTY"]
        self.assertEqual(initial["warmup"], {"completed": 0, "required": 201})
        for index in range(87):
            engine.ingest(tick(at=START + index * 60))
        signal = engine.signals["NIFTY"]
        self.assertEqual(signal["warmup"], {"completed": 86, "required": 201})
        self.assertEqual(signal["model"], "explainable-rules-v1")
        self.assertFalse(signal["model_validated"])
        self.assertEqual(signal["decision"], "WAIT")
        self.assertIsNone(signal["intelligence"])
        self.assertIsNone(signal["entry"])
        ready = ready_engine().signals["NIFTY"]
        self.assertEqual(ready["warmup"], {"completed": 201, "required": 201})
        self.assertFalse(ready["model_validated"], "Warm indicators are not a validated predictive model")

    def test_intelligence_and_all_strategy_families(self):
        engine = ready_engine()
        info = engine.signals["NIFTY"]["intelligence"]
        self.assertEqual(set(info["ema"]), {"9", "20", "50", "100", "200"})
        self.assertEqual(info["supertrend"], "BULLISH")
        self.assertGreater(info["atr"], 0)
        self.assertGreater(info["vwap"], 0)
        base = {**info, "breakout": 0, "sweep": 0, "close": info["ema"]["20"]}
        self.assertEqual(strategy(base)[0], "trend_continuation")
        self.assertEqual(strategy({**base, "breakout": 1, "volume_ratio": 2})[0], "momentum_breakout")
        self.assertEqual(strategy({**base, "sweep": -1, "imbalance": 0})[:2], ("liquidity_reversal", "PE"))
        mean = {**base, "ema": {str(n): 100 for n in (9, 20, 50, 100, 200)},
                "close": 60, "vwap": 100, "atr": 10, "rsi": 20, "imbalance": 0}
        self.assertEqual(strategy(mean)[:2], ("mean_reversion", "CE"))
        self.assertIsNone(strategy({**mean, "imbalance": -0.5}))

    def test_each_setup_has_its_own_gate_and_a_passing_setup_beats_a_blocked_higher_score(self):
        from services.aqte_engine import SWING_SETUPS, best_setup, setup_checks, swing_setups

        with self.assertRaises(ValueError):
            setup_checks({}, "CE", "martingale")
        for name in SWING_SETUPS:
            self.assertTrue(all(c["passed"] is None for c in setup_checks({}, "CE", name)), "Missing data never passes")
            self.assertFalse(all(c["passed"] is True for c in setup_checks(scalp_info(), None, name)),
                             "Without a direction no setup gate can pass")
        reversal = dict(ema={"9": 100, "20": 101, "50": 99, "100": 102, "200": 98}, close=100, vwap=99, atr=2,
                        rsi=45, volume_ratio=2, imbalance=0.3, supertrend="BEARISH", sweep=1, breakout=0,
                        structure="RANGE", cpr={"top": 101, "bottom": 99}, live={"price": 100.5})
        reversal_setups = swing_setups(reversal)
        self.assertEqual([{k: v for k, v in s.items() if k != "checks"} for s in reversal_setups],
                         [dict(name="liquidity_reversal", side="CE", score=75, passed=True)])
        self.assertEqual(reversal_setups[0]["checks"], setup_checks(reversal, "CE", "liquidity_reversal"),
                         "Each setup carries its own gate so the UI can show the setup the controller trades")
        # A wide candle can also break out; the breakout gate fails (no EMA stack) but must not hide the reversal.
        both = {**reversal, "breakout": 1}
        self.assertEqual([(s["name"], s["passed"]) for s in swing_setups(both)],
                         [("momentum_breakout", False), ("liquidity_reversal", True)])
        self.assertEqual(strategy(both), ("liquidity_reversal", "CE", 75))
        self.assertEqual(strategy({**both, "live": {"price": 99.5}})[0], "momentum_breakout",
                         "With no passing setup the top (blocked) one is reported")
        blocked, ready = dict(name="a", passed=False), dict(name="b", passed=True)
        self.assertIs(best_setup([blocked, ready]), ready)
        self.assertIs(best_setup([blocked]), blocked)
        self.assertIsNone(best_setup([]))


class ExecutionTests(unittest.TestCase):
    def test_position_metrics_use_option_bid_depth_and_estimated_costs_without_mutation(self):
        engine = ready_engine()
        engine.ingest(tick("option", at=NOW + 1, bid=98, ask=99, price=99))
        order = engine.orders["NIFTY"]
        engine.ingest(tick("option", at=NOW + 2, bid=122, ask=123, price=123))
        metrics = engine.snapshot(NOW + 2)["data"]["NIFTY"]["position"]["metrics"]
        points = 122 - order["entry_price"]
        self.assertAlmostEqual(metrics["points"], round(points, 2))
        self.assertEqual(metrics["ltp"], 123)
        self.assertEqual(metrics["bid"], 122)
        self.assertEqual(metrics["quantity"], CONTRACT.lot_size)
        self.assertEqual(metrics["gross_pnl"], round(points * CONTRACT.lot_size, 2))
        self.assertEqual(metrics["net_pnl"], round(
            points * CONTRACT.lot_size - order["entry_cost"] - engine.costs(122, CONTRACT.lot_size), 2))
        self.assertGreater(metrics["peak_points"], 0)
        self.assertGreater(metrics["stop_points"], 0)
        self.assertNotIn("metrics", order)
        self.assertIsNone(engine.snapshot(NOW + 20)["data"]["NIFTY"]["position"]["metrics"]["net_pnl"])
        self.assertIsNone(engine.position_metrics(order, NOW + 2, healthy=False)["ltp"])
        engine.options[30] = tick("option", at=NOW + 2, bid=122, ask=123, bid_quantity=1)
        shallow = engine.position_metrics(order, NOW + 2)
        self.assertIsNone(shallow["points"])
        self.assertIsNone(shallow["net_pnl"])
        self.assertEqual(shallow["ltp"], 100)

    def test_pending_position_metrics_have_no_invented_entry_or_profit(self):
        engine = ready_engine()
        metrics = engine.snapshot(NOW)["data"]["NIFTY"]["position"]["metrics"]
        self.assertIsNone(metrics["points"])
        self.assertIsNone(metrics["net_pnl"])
        self.assertIsNone(metrics["peak_points"])

    def test_explainable_entry_one_lot_no_signal_tick_fill_and_no_duplicates(self):
        engine = ready_engine()
        signal = engine.signals["NIFTY"]
        self.assertEqual(signal["decision"], "BUY CE")
        self.assertFalse(signal["model_validated"])
        self.assertLess(signal["entry"]["maximum"], 101)
        self.assertEqual(signal["entry"]["quantity"], CONTRACT.lot_size)
        self.assertIsNone(engine.orders["NIFTY"]["entry_at"])
        engine.analyze("NIFTY", NOW)
        self.assertEqual(sum(e["kind"] == "LIMIT_CREATED" for e in engine.events), 1)
        engine.ingest(tick("option", at=NOW + 1, bid=98.8, ask=99.5, price=99.5))
        self.assertAlmostEqual(engine.orders["NIFTY"]["entry_price"], 99.55)
        self.assertGreater(engine.orders["NIFTY"]["entry_at"], NOW)

    def test_no_chasing_and_pending_order_expiry(self):
        engine = ready_engine()
        engine.ingest(tick("option", at=NOW + 1, bid=109, ask=110, price=110))
        self.assertIsNone(engine.orders["NIFTY"]["entry_at"])
        engine.manage(NOW + 31)
        self.assertNotIn("NIFTY", engine.orders)
        self.assertIn("LIMIT_CANCELLED", [e["kind"] for e in engine.events])

    def test_gap_below_planned_stop_cancels_instead_of_opening_invalid_risk(self):
        engine = ready_engine()
        engine.ingest(tick("option", at=NOW + 1, bid=69, ask=70, price=70))
        self.assertNotIn("NIFTY", engine.orders)
        self.assertEqual(len(engine.trades), 0)
        self.assertEqual(engine.events[-1]["kind"], "LIMIT_CANCELLED")

    def test_illiquid_stale_expired_and_unaffordable_contracts_are_wait(self):
        for change in (
            {"ask_quantity": 1}, {"ask": 110}, {"bid": 0}, {"volume": 0},
            {"at": NOW - 10, "received": NOW - 10},
        ):
            with self.subTest(change=change):
                engine = ready_engine()
                engine.orders.clear()
                engine.options[30] = replace(tick("option"), **change)
                engine.analyze("NIFTY", NOW)
                self.assertEqual(engine.signals["NIFTY"]["decision"], "WAIT")
        engine = ready_engine()
        engine.orders.clear()
        engine.contracts[30] = replace(CONTRACT, expiry="2026-10-29")
        engine.analyze("NIFTY", NOW)
        self.assertEqual(engine.signals["NIFTY"]["decision"], "WAIT")
        self.assertEqual(ready_engine(risk_fraction=0.0001).signals["NIFTY"]["decision"], "WAIT")

    def test_paper_budget_gates_only_paper_mode_not_live_analysis(self):
        real_lot = replace(CONTRACT, lot_size=65)
        paper = ready_engine(contract=real_lot)
        self.assertEqual(paper.signals["NIFTY"]["decision"], "WAIT")
        self.assertIn("paper capital", paper.signals["NIFTY"]["reasons"][0])
        self.assertNotIn("NIFTY", paper.orders)
        analysis = ready_engine(contract=real_lot, paper_enabled=False)
        signal = analysis.signals["NIFTY"]
        self.assertEqual(signal["decision"], "BUY CE")
        self.assertEqual(signal["entry"]["quantity"], 65)
        self.assertGreaterEqual(signal["entry"]["reward_risk"], 1.5)
        self.assertEqual(analysis.orders, {})

    def test_gap_stop_costs_and_trailing(self):
        engine = ready_engine()
        engine.ingest(tick("option", at=NOW + 1, bid=98, ask=99, price=99))
        opened = dict(engine.orders["NIFTY"])
        engine.ingest(tick("option", at=NOW + 2, bid=122, ask=123, price=122))
        self.assertGreater(engine.orders["NIFTY"]["stop"], opened["stop"])
        engine.ingest(tick("option", at=NOW + 3, bid=70, ask=71, price=70))
        trade = engine.trades[0]
        self.assertEqual(trade["exit_reason"], "STOP_LOSS")
        self.assertAlmostEqual(trade["exit_price"], 69.95)
        self.assertLess(trade["net_pnl"], (69.95 - opened["entry_price"]) * CONTRACT.lot_size)

    def test_target_cannot_receive_favourable_gap_improvement(self):
        engine = ready_engine()
        engine.ingest(tick("option", at=NOW + 1, bid=98, ask=99, price=99))
        target = engine.orders["NIFTY"]["target"]
        engine.ingest(tick("option", at=NOW + 2, bid=target + 10, ask=target + 11, price=target + 10))
        self.assertEqual(engine.trades[0]["exit_price"], target)

    def test_risk_limits_and_kill_wait_for_fresh_exit_quote(self):
        engine = ready_engine()
        engine.ingest(tick("option", at=NOW + 1, bid=98, ask=99, price=99))
        engine.killed = True
        engine.manage(NOW + 10)
        self.assertIn("NIFTY", engine.orders, "Never invent fills on a stale quote")
        engine.ingest(tick("option", at=NOW + 11, bid=90, ask=91, price=90))
        self.assertEqual(engine.trades[0]["exit_reason"], "KILL_SWITCH")
        self.assertTrue(any(e["kind"] == "OPTION_DATA_GAP" for e in engine.events))
        engine.killed = False
        engine.policy = replace(engine.policy, max_trades=1)
        self.assertEqual(engine.risk_reason(NOW + 11), "Maximum daily trades reached")
        engine.policy = replace(engine.policy, max_trades=5, max_losses=1)
        self.assertEqual(engine.risk_reason(NOW + 11), "Consecutive-loss limit reached")
        engine.policy = replace(engine.policy, max_losses=3, daily_loss=10)
        self.assertEqual(engine.risk_reason(NOW + 11), "Daily loss limit reached")

    def test_snapshot_never_displays_stale_buy_or_other_index_signal(self):
        engine = ready_engine()
        self.assertEqual(engine.snapshot(NOW)["data"]["NIFTY"]["decision"], "BUY CE")
        self.assertEqual(engine.snapshot(NOW)["data"]["BANKNIFTY"]["decision"], "WAIT")
        engine.options[30] = replace(engine.options[30], at=NOW - 10)
        self.assertEqual(engine.snapshot(NOW)["data"]["NIFTY"]["decision"], "WAIT")
        self.assertEqual(engine.snapshot(NOW + 10)["data"]["NIFTY"]["decision"], "WAIT")

    def test_stale_snapshot_names_the_starved_feed_and_its_age(self):
        engine = ready_engine(paper_enabled=False)
        engine.ingest(tick("spot", at=NOW + 300, price=22041))
        reasons = engine.snapshot(NOW + 302)["data"]["NIFTY"]["reasons"]
        self.assertEqual(reasons, ["Market data stale: futures last tick 302s ago"])
        self.assertEqual(engine.snapshot(NOW + 302)["data"]["SENSEX"]["reasons"],
                         ["Market data stale: futures no ticks yet; spot no ticks yet"])

    def test_daily_loss_uses_portfolio_not_just_one_position(self):
        engine = ready_engine()
        engine.ingest(tick("option", at=NOW + 1, bid=98, ask=99, price=99))
        order = engine.orders["NIFTY"]
        order["stop"] = 50
        second = {**order, "id": "second", "symbol": "BANKNIFTY", "token": 31,
                  "contract": {**order["contract"], "symbol": "BANKNIFTY", "token": 31}}
        engine.orders["BANKNIFTY"] = second
        engine.policy = replace(engine.policy, daily_loss=500)
        engine.options[30] = tick("option", at=NOW + 2, bid=80, ask=81, price=80)
        engine.ingest(tick("option", at=NOW + 2, symbol="BANKNIFTY", token=31, bid=80, ask=81, price=80))
        self.assertEqual(engine.trades[0]["exit_reason"], "DAILY_LOSS")
        # The second leg needs its own next quote; never exit against another contract's tick.
        self.assertIn("NIFTY", engine.orders)
        engine.ingest(tick("option", at=NOW + 3, bid=80, ask=81, price=80))
        self.assertEqual(engine.trades[1]["exit_reason"], "DAILY_LOSS")

    def test_invalid_future_dated_and_stale_ticks_do_not_create_candles(self):
        engine = AQTEEngine()
        for price in (math.nan, math.inf, 0):
            with self.assertRaises(ValueError):
                engine.ingest(tick(price=price))
        engine.ingest(tick(at=NOW + 1, received=NOW))
        engine.ingest(tick(at=NOW - 10, received=NOW))
        self.assertFalse(engine.future)

    def test_no_new_entries_after_cutoff_and_session_exit(self):
        engine = ready_engine()
        engine.ingest(tick("option", at=NOW + 1, bid=98, ask=99, price=99))
        cutoff = datetime(2026, 10, 30, 15, 15, tzinfo=IST).timestamp()
        self.assertEqual(engine.risk_reason(cutoff), "No new entries after 15:15 IST")
        engine.ingest(tick("option", at=cutoff + 600, bid=100, ask=101, price=100))
        self.assertEqual(engine.trades[0]["exit_reason"], "SESSION_EXIT")


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "aqte.sqlite3"
        self.service = AQTEService(self.path)
        self.service.initialize()

    def test_index_receipt_timestamp_and_derivative_exchange_timestamp(self):
        raw = dict(instrument_token=10, last_price=22000)
        self.assertEqual(normalize("NIFTY", "spot", raw, NOW).at, NOW)
        with self.assertRaises(ValueError):
            normalize("NIFTY", "future", raw, NOW)
        raw["exchange_timestamp"] = datetime(2026, 10, 30, 12, 37)
        self.assertEqual(normalize("NIFTY", "future", raw, NOW).at, NOW)

    def test_restart_restores_orders_costs_kill_and_audit(self):
        self.service.engine = ready_engine()
        self.service.engine.ingest(tick("option", at=NOW + 1, bid=98, ask=99, price=99))
        with self.service.connect() as db:
            self.service.persist(db, [tick("option")])
        self.service.engine.events.clear()
        self.service.kill()
        restored = AQTEService(self.path, paper_enabled=True)
        restored.initialize()
        self.assertTrue(restored.engine.killed)
        self.assertEqual(restored.engine.orders, self.service.engine.orders)
        self.assertEqual(restored.engine.contracts[30], CONTRACT)
        events = restored.history(100)["events"]
        self.assertIn("KILL_SWITCH", [e["kind"] for e in events])
        with restored.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM aqte_ticks").fetchone()[0], 1)

    def test_restart_recovers_same_day_warmup_without_replaying_trades(self):
        recorded = [tick(at=START + index * 60, price=22000 + index, volume=index * 1000)
                    for index in range(203)]
        with self.service.connect() as db:
            self.service.persist(db, recorded)
        restored = AQTEService(self.path)
        with patch("services.aqte_service.datetime") as clock:
            clock.now.return_value = datetime.fromtimestamp(NOW, IST)
            restored.initialize()
        self.assertEqual(warmup_count(restored.engine.book.closed[("future", 20, 60)], NOW), 201)
        self.assertFalse(restored.engine.orders)
        self.assertFalse(restored.engine.trades)
        self.assertFalse(restored.engine.signals, "Recovery rebuilds candles, not historical entry signals")
        restored.engine.ingest(tick("spot", at=NOW + 1))
        restored.engine.ingest(tick(at=NOW + 1, volume=203_000))
        self.assertEqual(restored.engine.signals["NIFTY"]["warmup"], {"completed": 201, "required": 201})
        self.assertFalse(restored.engine.orders)

    def test_restart_replays_only_previous_session_tail_for_cross_session_warmup(self):
        recorded = [tick(at=THURSDAY + i * 60, price=22000 + i * 0.1, volume=i * 1000) for i in range(375)]
        recorded += [tick(at=START + i * 60, price=22040 + i, volume=i * 1000) for i in range(6)]
        with self.service.connect() as db:
            self.service.persist(db, recorded)
        restored = AQTEService(self.path)
        with patch("services.aqte_service.datetime") as clock:
            clock.now.return_value = datetime.fromtimestamp(START + 6 * 60, IST)
            restored.initialize()
        bars = restored.engine.book.closed[("future", 20, 60)]
        self.assertGreaterEqual(bars[0]["at"], datetime(2026, 10, 29, 11, 0, tzinfo=IST).timestamp(),
                                "Restart replays a bounded tail, not the whole previous session")
        self.assertEqual(warmup_count(bars, START + 5 * 60 + 30), 201)

    def test_kite_history_backfill_heals_warmup_and_backs_off_when_unavailable(self):
        for minute in (0, 1, 4, 5, 6):
            self.service.engine.ingest(tick(at=START + minute * 60, price=22000 + minute))
        now = START + 6 * 60 + 10
        rows = [dict(date=datetime.fromtimestamp(at, IST), open=22000, high=22002, low=21998, close=22001, volume=50)
                for at in [THURSDAY + i * 60 for i in range(375)] + [START + i * 60 for i in range(7)]]
        rows.append(dict(date=datetime.fromtimestamp(THURSDAY + 60, IST), open=1, high=0.5, low=2, close=1, volume=1))
        kite = Mock()
        kite.historical_data.return_value = rows
        self.assertEqual(self.service.backfill(kite, {20: "NIFTY"}, now), 375 + 4)
        token, start, end, interval = kite.historical_data.call_args.args
        self.assertEqual((token, interval), (20, "minute"))
        self.assertLess(start, end)
        self.assertEqual(warmup_count(self.service.engine.book.closed[("future", 20, 60)], now), 201)
        self.assertEqual(self.service.backfill_after, now + 60)
        self.service.backfill_after = 0
        self.assertEqual(self.service.backfill(kite, {20: "NIFTY"}, now), 0)
        self.assertEqual(kite.historical_data.call_count, 1, "Complete warm-up needs no history calls")
        kite.place_order.assert_not_called()

        cold = AQTEService(Path(self.directory.name) / "cold.sqlite3")
        failing = Mock()
        failing.historical_data.side_effect = RuntimeError("Historical API not subscribed")
        self.assertEqual(cold.backfill(failing, {20: "NIFTY"}, now), 0)
        self.assertEqual(cold.backfill(failing, {20: "NIFTY"}, now + 60), 0)
        self.assertEqual(failing.historical_data.call_count, 1, "Failures back off for five minutes")
        saturday = datetime(2026, 10, 31, 10, 0, tzinfo=IST).timestamp()
        self.assertEqual(AQTEService(self.path).backfill(failing, {20: "NIFTY"}, saturday), 0)
        self.assertEqual(failing.historical_data.call_count, 1)

    def test_subscriptions_use_active_kite_metadata_and_pin_open_contract(self):
        self.service.started = True
        kite, socket = Mock(), Mock()
        kite.instruments.side_effect = lambda exchange: [
            dict(name="NIFTY", instrument_type=side, instrument_token=token,
                 tradingsymbol=f"NIFTY{strike}{side}", exchange="NFO", expiry="2026-11-03",
                 strike=strike, lot_size=65, tick_size=0.05)
            for side, token, strike in (("CE", 30, 22000), ("PE", 31, 22000), ("CE", 32, 22100))
        ] if exchange == "NFO" else []
        with patch("services.aqte_service.time.time", return_value=NOW):
            self.service.configure(kite, socket, {"NIFTY": 22000})
            self.assertEqual(self.service.engine.contracts[30].lot_size, 65)
            self.assertEqual(socket.set_mode.call_args[0][1], [30, 31, 32])
            self.service.configure(kite, socket, {"NIFTY": 22000})
        self.assertEqual(kite.instruments.call_count, 2, "Daily catalog must be reused")
        kite.place_order.assert_not_called()

    def test_recording_overflow_latches_fault_and_ui_waits(self):
        self.service.started = True
        self.service.queue = queue.Queue(maxsize=1)
        raw = dict(instrument_token=10, last_price=22000)
        self.service.enqueue("NIFTY", "spot", raw)
        self.service.enqueue("NIFTY", "spot", raw)
        self.assertTrue(self.service.failed.is_set())
        self.assertFalse(self.service.snapshot()["recording"])
        self.assertTrue(all(s["decision"] == "WAIT" for s in self.service.snapshot()["data"].values()))

    def test_authenticated_kill_and_bounded_journal(self):
        self.service.engine.paper_enabled = True
        from routers.aqte import router
        from services.auth import auth_service
        app = FastAPI()
        app.include_router(router)
        client = TestClient(app)
        with patch("routers.aqte.get_aqte_service", return_value=self.service):
            self.assertIn(client.post("/api/aqte/kill").status_code, (401, 403))
            refresh = auth_service.create_refresh_token({"sub": "operator"})
            self.assertEqual(client.post("/api/aqte/kill", headers={"Authorization": f"Bearer {refresh}"}).status_code, 401)
            access = auth_service.create_access_token({"sub": "operator"})
            self.assertEqual(client.post("/api/aqte/kill", headers={"Authorization": f"Bearer {access}"}).status_code, 200)
            malformed = auth_service.create_access_token({})
            self.assertEqual(client.post("/api/aqte/kill", headers={"Authorization": f"Bearer {malformed}"}).status_code, 401)
            self.assertEqual(client.get("/api/aqte/journal?limit=501").status_code, 422)
            result = client.get("/api/aqte/snapshot")
            self.assertEqual(result.json()["mode"], "PAPER_ONLY")
            self.assertEqual(result.headers["cache-control"], "no-store")

    def test_production_analysis_disables_paper_and_preserves_saved_state(self):
        paper = ready_engine()
        paper.killed = True
        self.service.engine = paper
        with self.service.connect() as db:
            self.service.persist(db)
            saved = db.execute("SELECT payload FROM aqte_state WHERE id=1").fetchone()["payload"]
        analysis = AQTEService(self.path)
        analysis.initialize()
        self.assertFalse(analysis.engine.paper_enabled)
        self.assertFalse(analysis.engine.killed, "Archived paper stops must not block live analysis")
        self.assertEqual(analysis.engine.orders, {})
        self.assertEqual(analysis.engine.trades, [])
        analysis.engine = ready_engine()
        analysis.engine.paper_enabled = False
        analysis.engine.orders.clear()
        analysis.engine.events.clear()
        analysis.engine.ingest(tick(at=NOW + 1, volume=203_000))
        analysis.engine.manage(NOW + 2, tick("option", at=NOW + 2, ask=99, bid=98))
        self.assertEqual(analysis.engine.signals["NIFTY"]["decision"], "WAIT",
                         "A legacy paper candidate cannot bypass the live setup gate")
        self.assertTrue(analysis.engine.signals["NIFTY"]["reasons"])
        self.assertEqual(analysis.engine.orders, {})
        self.assertFalse(any(event["kind"] in ("LIMIT_CREATED", "FILLED", "CLOSED")
                             for event in analysis.engine.events))
        with analysis.connect() as db:
            analysis.persist(db)
            self.assertEqual(db.execute("SELECT payload FROM aqte_state WHERE id=1").fetchone()["payload"], saved)
        self.assertEqual(analysis.snapshot()["mode"], "ANALYSIS_ONLY")

    def test_disabled_paper_kill_cannot_stop_real_analysis(self):
        from routers.aqte import router
        from services.auth import auth_service
        app = FastAPI()
        app.include_router(router)
        client = TestClient(app)
        access = auth_service.create_access_token({"sub": "operator"})
        with patch("routers.aqte.get_aqte_service", return_value=self.service):
            response = client.post("/api/aqte/kill", headers={"Authorization": f"Bearer {access}"})
        self.assertEqual(response.status_code, 410)
        self.assertFalse(self.service.engine.killed)


class ReplayTests(unittest.TestCase):
    def test_replay_executes_same_strategy_without_looking_ahead(self):
        ticks = []
        for i in range(201):
            for offset, change in ((0, 0), (20, 5), (40, -5)):
                at = START + i * 60 + offset
                ticks.extend([tick("spot", at=at, price=22000 + i * 0.2),
                              tick("option", at=at),
                              tick(at=at, price=22000 + i * 0.2 + change,
                                   volume=i * 1000 + offset * 10)])
        at = START + 201 * 60
        ticks.extend([tick("spot", at=at), tick("option", at=at),
                      tick(at=at, price=22040.2, volume=201_000),
                      tick("option", at=at + 1, bid=98, ask=99, price=99),
                      tick("option", at=at + 2, bid=145, ask=146, price=145)])
        report = replay(ticks, [CONTRACT])
        self.assertEqual(report["closed"], 1)
        self.assertGreater(report["trades"][0]["entry_at"], at)
        self.assertEqual(report["trades"][0]["exit_reason"], "TARGET")
        stressed = replay(ticks, [CONTRACT], Policy(slippage_ticks=30))
        self.assertEqual(stressed["closed"], 0, "Higher slippage must not violate entry-price ceiling")

    def test_chronological_replay_and_no_forced_terminal_fills(self):
        with self.assertRaises(ValueError):
            replay([tick(at=NOW + 1), tick(at=NOW)], [CONTRACT])
        report = replay([tick("spot"), tick()], [CONTRACT])
        self.assertEqual((report["closed"], report["ticks"]), (0, 2))
        self.assertIsNone(report["win_rate"])
        self.assertIsNone(report["profit_factor"])

    def test_sqlite_replay_limits(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "aqte.sqlite3"
            service = AQTEService(path)
            service.initialize()
            with service.connect() as db:
                service.persist(db, [tick("spot"), tick()])
            self.assertEqual(replay_database(path, "2026-10-30")["ticks"], 2)
            with self.assertRaises(ValueError):
                replay_database(path, "2026-10-30", max_ticks=1)


class WorkerTests(unittest.IsolatedAsyncioTestCase):
    async def test_old_queued_quotes_are_recorded_but_not_executed(self):
        with tempfile.TemporaryDirectory() as directory:
            service = AQTEService(Path(directory) / "aqte.sqlite3")
            service.queue.put(tick("spot", at=time.time() - 60))
            await service.start()
            try:
                for _ in range(100):
                    events = await asyncio.to_thread(service.history, 10)
                    if events["events"]:
                        break
                    await asyncio.sleep(0.01)
                self.assertEqual(events["events"][0]["kind"], "PROCESSING_STALE_TICK")
                self.assertFalse(service.engine.spot)
            finally:
                await service.stop()
            with service.connect() as db:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM aqte_ticks").fetchone()[0], 1)

    async def test_background_recording_and_clean_shutdown(self):
        with tempfile.TemporaryDirectory() as directory:
            service = AQTEService(Path(directory) / "aqte.sqlite3")
            await service.start()
            try:
                self.assertTrue(service.worker.is_alive())
                service.enqueue("NIFTY", "spot", dict(instrument_token=10, last_price=22000))
                for _ in range(100):
                    result = await asyncio.to_thread(service.snapshot)
                    if result["data"]["NIFTY"]["spot"] == 22000:
                        break
                    await asyncio.sleep(0.01)
                self.assertEqual(result["data"]["NIFTY"]["spot"], 22000)
                self.assertTrue(result["recording"])
            finally:
                await service.stop()
            self.assertFalse(service.worker.is_alive())
            with service.connect() as db:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM aqte_ticks").fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main()
