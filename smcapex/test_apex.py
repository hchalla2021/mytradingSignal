import hashlib
import hmac
import json
import struct
import threading
import time
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch

import httpx
from fastapi.testclient import TestClient
from kiteconnect import KiteTicker
from pydantic import ValidationError
from requests.exceptions import ConnectionError as RequestsConnectionError

from smcapex import main
from smcapex.config import IndexRisk
from smcapex.engine import Candle, IST, aggregate, bias, bucket, evaluate, fvgs
from smcapex.execution import Blocked, Executor, quote_prices
from smcapex.runtime import Runtime
from smcapex.store import Store

NOW = datetime(2026, 11, 24, 11, 20, tzinfo=IST)
RISK = IndexRisk(lots=1, risk_per_trade=10000, daily_loss=20000,
                 stop_percent=20, max_spread_percent=1)
CONTRACT = {"tradingsymbol": "TEST26CE", "exchange": "NFO", "lot_size": 50, "tick_size": .05,
            "expiry": NOW.date(), "instrument_token": 123}
SETUP = {"id": "5:fixture:CE", "side": "CE", "underlying_stop": 99}
PRICES = {"ask": 100, "bid": 99.5, "ltp": 100, "ask_quantity": 100, "bid_quantity": 100,
          "timestamp": NOW.isoformat()}


def gap_rows(side="CE"):
    start = NOW.replace(hour=9, minute=15)
    baseline = [Candle(start + timedelta(minutes=i * 5), 100, 101, 99, 100) for i in range(21)]
    baseline += [Candle(start + timedelta(minutes=105), 100, 104, 99.5, 103.5),
                 Candle(start + timedelta(minutes=110), 103, 105, 102, 104)]
    if side == "PE":
        baseline = [Candle(r.at, 200 - r.open, 200 - r.low, 200 - r.high, 200 - r.close) for r in baseline]
    return baseline


class FakeBroker:
    def __init__(self):
        self.book = []
        self.net = []
        self.submissions = []
        self.modifications = []
        self.cancellations = []
        self.uncertain = False
        self.cash = 1_000_000

    def orders(self):
        return self.book

    def positions(self):
        return {"net": self.net}

    def margins(self, segment):
        return {"available": {"cash": self.cash}}

    def place_order(self, **kwargs):
        self.submissions.append(kwargs)
        if self.uncertain:
            raise TimeoutError("Mock transport timeout")
        identity = str(len(self.book) + 1)
        buy = kwargs["transaction_type"] == "BUY"
        order = {**kwargs, "order_id": identity, "status": "COMPLETE" if buy else "TRIGGER PENDING",
                 "order_timestamp": NOW,
                 "filled_quantity": kwargs["quantity"] if buy else 0,
                 "average_price": kwargs["price"] if buy else 0}
        self.book.append(order)
        if buy:
            self.net.append({"exchange": kwargs["exchange"], "tradingsymbol": kwargs["tradingsymbol"],
                             "product": "MIS", "quantity": kwargs["quantity"]})
        return identity

    def cancel_order(self, **kwargs):
        self.cancellations.append(kwargs)

    def modify_order(self, **kwargs):
        self.modifications.append(kwargs)
        order = next(o for o in self.book if o["order_id"] == kwargs["order_id"])
        order.update(kwargs)


class StructureTests(unittest.TestCase):
    def test_fvg_requires_displacement_and_completed_three_candle_geometry(self):
        rows = gap_rows()
        self.assertEqual(fvgs(rows[:22], 5), [])
        gap = fvgs(rows, 5)[0]
        self.assertEqual((gap["lower"], gap["upper"], gap["state"]), (101, 102, "FRESH"))
        self.assertEqual(gap["confirmed_at"], (rows[-1].at + timedelta(minutes=5)).isoformat())
        bearish = fvgs(gap_rows("PE"), 5)[0]
        self.assertEqual((bearish["side"], bearish["lower"], bearish["upper"]), ("PE", 98, 99))

    def test_small_body_overlap_and_open_gap_are_rejected(self):
        rows = gap_rows()
        middle = rows[-2]
        for replacement in [
            Candle(middle.at, 103, 104, 99.5, 103.5),
            Candle(middle.at, 102, 106, 102, 105.5),
        ]:
            self.assertEqual(fvgs(rows[:-2] + [replacement, rows[-1]], 5), [])
        last = rows[-1]
        self.assertEqual(fvgs(rows[:-1] + [Candle(last.at, 101, 104, 100, 103)], 5), [])

    def test_gap_cannot_bridge_missing_minutes_or_sessions(self):
        rows = gap_rows()
        last = rows[-1]
        moved = Candle(last.at + timedelta(minutes=5), last.open, last.high, last.low, last.close)
        self.assertEqual(fvgs(rows[:-1] + [moved], 5), [])

    def test_daily_gap_requires_real_adjacent_weekdays_and_confirms_at_session_close(self):
        day = NOW.replace(day=23, hour=9, minute=15) - timedelta(days=32)
        days = []
        while len(days) < 23:
            if day.weekday() < 5:
                days.append(day)
            day += timedelta(days=1)
        prices = gap_rows()
        daily = [Candle(at, row.open, row.high, row.low, row.close) for at, row in zip(days, prices)]
        gap = fvgs(daily, 1440)[0]
        self.assertEqual(datetime.fromisoformat(gap["confirmed_at"]).time().isoformat(), "15:30:00")
        last = daily[-1]
        missing = Candle(last.at + timedelta(days=3), last.open, last.high, last.low, last.close)
        self.assertEqual(fvgs(daily[:-1] + [missing], 1440), [])

    def test_fvg_mitigation_and_far_boundary_invalidation_are_distinct(self):
        rows = gap_rows()
        at = rows[-1].at + timedelta(minutes=5)
        touched = Candle(at, 103, 104, 101.5, 103)
        self.assertEqual(fvgs(rows + [touched], 5)[0]["state"], "MITIGATED")
        invalid = Candle(at, 103, 104, 101, 103)
        self.assertEqual(fvgs(rows + [invalid], 5)[0]["state"], "INVALIDATED")

    def test_exchange_alignment_short_final_hour_and_no_forming_bar(self):
        start = NOW.replace(hour=9, minute=15)
        rows = [Candle(start + timedelta(minutes=i), 100, 101, 99, 100) for i in range(375)]
        noon = NOW.replace(hour=12, minute=15)
        bars = aggregate(rows, 60, noon)
        self.assertEqual([r.at.hour for r in bars], [9, 10, 11])
        self.assertEqual(bucket(NOW.replace(hour=10, minute=14), 60), start)
        closed = aggregate(rows, 60, NOW.replace(hour=15, minute=30))
        self.assertEqual(len(closed), 7)
        self.assertEqual(closed[-1].at.time().isoformat(), "15:15:00")

    def test_missing_or_duplicate_minutes_never_fabricate_a_candle(self):
        start = NOW.replace(hour=9, minute=15)
        rows = [Candle(start + timedelta(minutes=i), 100, 101, 99, 100) for i in range(5)]
        self.assertEqual(len(aggregate(rows, 5, NOW)), 1)
        self.assertEqual(aggregate(rows[:2] + rows[3:], 5, NOW), [])
        self.assertEqual(aggregate(rows[:4] + [rows[3]], 5, NOW), [])

    def test_future_data_does_not_change_completed_output(self):
        start = NOW.replace(hour=9, minute=15)
        rows = [Candle(start + timedelta(minutes=i), 100, 101, 99, 100) for i in range(10)]
        cutoff = start + timedelta(minutes=5)
        future = Candle(start + timedelta(minutes=8), 999, 1000, 998, 999)
        self.assertEqual(aggregate(rows, 5, cutoff), aggregate(rows + [future], 5, cutoff))

    def test_strict_swings_only_become_available_after_right_hand_confirmation(self):
        levels = [100, 101, 105, 101, 100, 99, 103, 106, 104, 103, 102, 104, 108, 106, 105]
        rows = [Candle(NOW + timedelta(minutes=i), p, p + 1, p - 1, p) for i, p in enumerate(levels)]
        self.assertEqual(bias(rows[:12]), "UNCONFIRMED")
        self.assertEqual(bias(rows), "CE")

    def test_incomplete_context_cannot_produce_a_buy(self):
        result = evaluate([], [], NOW)
        self.assertEqual(result["decision"], "WAIT")
        self.assertIsNone(result["setup"])

    def test_opening_hour_explains_warmup_and_keeps_completed_daily_context(self):
        prior = NOW.replace(day=23, hour=9, minute=15)
        start = NOW.replace(hour=9, minute=15)
        history = [Candle(prior + timedelta(minutes=i), 100, 101, 99, 100) for i in range(375)]
        current = [Candle(start + timedelta(minutes=i), 100, 101, 99, 100) for i in range(61)]
        daily = [Candle(prior, 100, 110, 90, 105)]
        result = evaluate(history + current, daily, NOW.replace(hour=9, minute=52))
        self.assertEqual(result["decision"], "WAIT")
        self.assertIsNone(result["setup"])
        self.assertIn("first completed 1h", result["reason"])
        self.assertIn("10:15 IST", result["reason"])
        self.assertEqual(result["timeframes"]["Daily"]["last_at"], prior.isoformat())
        self.assertEqual(result["daily"]["previous_close"], 105)
        missing = [r for r in current if r.at != start + timedelta(minutes=15)]
        result = evaluate(history + missing, daily, NOW.replace(hour=10, minute=16))
        self.assertIn("Missing, stale", result["reason"])
        self.assertIn("1h", result["reason"])
        self.assertNotIn("first completed", result["reason"])
        self.assertIsNone(result["setup"])

    def test_preopen_uses_completed_historical_context_without_a_trade_setup(self):
        start = NOW.replace(day=23, hour=9, minute=15)
        bars = [Candle(row.at - timedelta(days=1), row.open, row.high, row.low, row.close)
                for row in gap_rows()]
        bars += [Candle(start + timedelta(minutes=i * 5), 104, 105, 102.5, 104)
                 for i in range(23, 30)]
        candles = [candle for row in bars for candle in
                   [Candle(row.at, row.open, row.high, row.low, row.close)] +
                   [Candle(row.at + timedelta(minutes=i), row.close, row.close, row.close, row.close)
                    for i in range(1, 5)]]
        daily = [Candle(start, 100, 110, 90, 105),
                 Candle(NOW.replace(hour=0, minute=0), 200, 210, 190, 205)]
        for at in (NOW.replace(hour=9, minute=0), NOW.replace(hour=9, minute=14, second=59)):
            result = evaluate(candles, daily, at)
            self.assertEqual(result["decision"], "WAIT")
            self.assertIsNone(result["setup"])
            self.assertIn("Pre-open analysis", result["reason"])
            self.assertEqual(result["daily"]["previous_close"], 105)
            self.assertEqual(result["timeframes"]["5"]["candles"], 30)
            self.assertTrue(result["timeframes"]["5"]["last_at"].startswith("2026-11-23"))
            self.assertEqual((result["fvgs"][0]["lower"], result["fvgs"][0]["upper"]), (101, 102))
            self.assertEqual(result["historical_structures"][0]["fvg"]["id"], result["fvgs"][0]["id"])
            self.assertTrue(result["historical_structures"][0]["sweep"]["at"].startswith("2026-11-23"))
        self.assertIn("Outside", evaluate(candles, daily, NOW.replace(hour=8, minute=59))["reason"])
        self.assertIn("Outside", evaluate(candles, daily, NOW.replace(day=22, hour=9, minute=0))["reason"])
        self.assertIn("insufficient", evaluate([], [], NOW.replace(hour=9, minute=0))["reason"])
        self.assertIn("first completed", evaluate(candles, daily, NOW.replace(hour=9, minute=15))["reason"])

    def test_completed_context_explains_missing_or_invalidated_entry_fvg(self):
        prior = NOW.replace(day=23, hour=9, minute=15)
        start = NOW.replace(hour=9, minute=15)
        history = [Candle(prior + timedelta(minutes=i), 100, 101, 99, 100) for i in range(375)]
        current = [Candle(start + timedelta(minutes=i), 100, 101, 99, 100) for i in range(125)]
        daily = [Candle(prior, 100, 110, 90, 105)]
        result = evaluate(history + current, daily, NOW)
        self.assertIn("No same-day 5m displacement FVG", result["reason"])
        self.assertEqual(result["evaluation"], "WAITING_FVG")
        self.assertEqual(len(result["checks"]), 9)
        self.assertTrue(all(check["status"] == "WAIT" for check in result["checks"]))
        self.assertIsNone(result["setup"])

        bars = gap_rows()
        bars += [Candle(bars[-1].at + timedelta(minutes=5), 104, 105, 100, 104),
                 Candle(bars[-1].at + timedelta(minutes=10), 104, 105, 103, 104)]
        current = [minute for row in bars for minute in [
            row, *[Candle(row.at + timedelta(minutes=i), row.close, row.close, row.close, row.close)
                   for i in range(1, 5)],
        ]]
        result = evaluate(history + current, daily, NOW)
        self.assertEqual(result["fvgs"][-1]["state"], "INVALIDATED")
        self.assertIn("Valid 5m displacement FVG", result["reason"])
        self.assertEqual(result["decision"], "WAIT")
        self.assertEqual(result["evaluation"], "DIAGNOSTIC")
        self.assertEqual(len(result["checks"]), 9)
        self.assertFalse(result["checks"][0]["passed"])
        self.assertIsNotNone(result["diagnostic"])
        self.assertIsNone(result["setup"])

    def test_all_qualified_frame_evidence_produces_buy_and_invalidated_gap_does_not(self):
        five = gap_rows()
        sweep = five[19]
        five[19] = Candle(sweep.at, 100.5, 101, 98.5, 100)
        prefix = [Candle(NOW.replace(day=23, hour=14, minute=40) + timedelta(minutes=5 * i),
                         100, 101, 99, 100) for i in range(10)]
        five = prefix + five
        five += [Candle(NOW.replace(minute=10), 104, 106, 103, 104),
                 Candle(NOW.replace(minute=15), 104, 106, 101.5, 103)]
        one = [Candle(NOW.replace(minute=i), 104, 105, 103, 104) for i in range(10, 19)]
        one += [Candle(NOW.replace(minute=19), 102, 104, 101.5, 103)]
        three = [Candle(NOW.replace(minute=i), 104, 105, 103, 104) for i in (9, 12)]
        three += [Candle(NOW.replace(minute=15), 104, 107, 103, 106)]
        levels = [100, 101, 105, 101, 100, 99, 103, 106, 104, 103, 102, 104, 108, 106, 105]
        frames = {1: one, 3: three, 5: five}
        for minutes in (15, 30, 60):
            slots = []
            for day in (20, 23, 24):
                start = NOW.replace(day=day, hour=9, minute=15)
                for i in range(0, 375, minutes):
                    at = start + timedelta(minutes=i)
                    if at + timedelta(minutes=minutes) <= NOW:
                        slots.append(at)
            frames[minutes] = [Candle(at, p, p + 1, p - 1, p) for at, p in zip(slots[-15:], levels)]
        daily = [Candle(NOW.replace(day=23, hour=9, minute=15), 100, 140, 90, 100)]
        with patch("smcapex.engine.aggregate", side_effect=lambda rows, minutes, now: frames[minutes]):
            result = evaluate([], daily, NOW)
            self.assertEqual(result["decision"], "BUY CE", result["reason"])
            self.assertEqual(result["score"], 100)
            self.assertTrue(all(check["passed"] for check in result["checks"]))
            one[-1] = Candle(one[-1].at, 102, 104, 100.5, 103)
            invalid = evaluate([], daily, NOW)
            self.assertEqual(invalid["decision"], "WAIT")
            self.assertIsNone(invalid["setup"])

    def test_core_structure_and_retest_or_micro_can_qualify_without_perfect_confluence(self):
        five = gap_rows()
        sweep = five[19]
        five[19] = Candle(sweep.at, 100.5, 101, 98.5, 100)
        prefix = [Candle(NOW.replace(day=23, hour=14, minute=40) + timedelta(minutes=5 * i),
                         100, 101, 99, 100) for i in range(10)]
        five = prefix + five
        five += [Candle(NOW.replace(minute=10), 104, 106, 103, 104),
                 Candle(NOW.replace(minute=15), 104, 106, 101.5, 103)]
        one = [Candle(NOW.replace(minute=i), 104, 105, 103, 104) for i in range(10, 20)]
        three = [Candle(NOW.replace(minute=i), 104, 105, 103, 104) for i in (9, 12)]
        three += [Candle(NOW.replace(minute=15), 104, 107, 103, 106)]
        frames = {1: one, 3: three, 5: five}
        for minutes in (15, 30, 60):
            latest = {15: NOW.replace(hour=11, minute=0),
                      30: NOW.replace(hour=10, minute=45),
                      60: NOW.replace(hour=10, minute=15)}[minutes]
            levels = [100, 101, 100, 102, 101, 103, 102, 104, 103, 105, 104, 106, 105, 107, 106]
            frames[minutes] = [
                Candle(latest - timedelta(minutes=(14 - i) * minutes),
                       level, level + 1, level - 1, level)
                for i, level in enumerate(levels)
            ]
        daily = [Candle(NOW.replace(day=23, hour=9, minute=15), 100, 140, 90, 100)]
        with patch("smcapex.engine.aggregate", side_effect=lambda rows, minutes, now: frames[minutes]):
            result = evaluate([], daily, NOW)
        self.assertEqual(result["decision"], "BUY CE", result["reason"])
        self.assertFalse(result["checks"][4]["passed"])
        self.assertTrue(result["checks"][5]["passed"])
        self.assertFalse(result["checks"][6]["passed"])
        self.assertLess(result["score"], 100)
        self.assertEqual(result["evaluation"], "QUALIFIED")

    def test_two_candle_post_fvg_continuation_can_confirm_without_exact_retest(self):
        five = gap_rows()
        sweep = five[19]
        five[19] = Candle(sweep.at, 100.5, 101, 98.5, 100)
        prefix = [Candle(NOW.replace(day=23, hour=14, minute=40) + timedelta(minutes=5 * i),
                         100, 101, 99, 100) for i in range(10)]
        five = prefix + five
        five += [Candle(NOW.replace(minute=10), 104, 106, 103, 104),
                 Candle(NOW.replace(minute=15), 104, 106, 101.5, 103)]
        one = [Candle(NOW.replace(minute=i), 104, 105, 103, 104) for i in range(10, 18)]
        one += [Candle(NOW.replace(minute=18), 104, 106, 102.5, 105),
                Candle(NOW.replace(minute=19), 105, 106, 104, 105.5)]
        three = [Candle(NOW.replace(minute=i), 104, 105, 103, 104) for i in (9, 12, 15)]
        levels = [100, 101, 100, 102, 101, 103, 102, 104, 103, 105, 104, 106, 105, 107, 106]
        frames = {1: one, 3: three, 5: five}
        for minutes in (15, 30, 60):
            latest = NOW.replace(hour=11, minute=0)
            frames[minutes] = [
                Candle(latest - timedelta(minutes=(14 - i) * minutes),
                       level, level + 1, level - 1, level)
                for i, level in enumerate(levels)
            ]
        daily = [Candle(NOW.replace(day=23, hour=9, minute=15), 100, 140, 90, 100)]
        with patch("smcapex.engine.aggregate", side_effect=lambda rows, minutes, now: frames[minutes]):
            result = evaluate([], daily, NOW)
        self.assertEqual(result["decision"], "BUY CE")
        self.assertTrue(result["checks"][4]["passed"])
        self.assertFalse(result["checks"][5]["passed"])

    def test_rejects_nonfinite_invalid_geometry_and_naive_time(self):
        for args in [(NOW, 100, float("nan"), 99, 100), (NOW, 100, 99, 98, 100),
                     (NOW.replace(tzinfo=None), 100, 101, 99, 100)]:
            with self.assertRaises(ValueError):
                Candle(*args)
        utc = Candle(NOW.astimezone(timezone.utc), 100, 101, 99, 100)
        self.assertEqual(str(utc.at.tzinfo), "Asia/Kolkata")


class ExecutionTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(":memory:")
        self.executor = Executor(self.store, clock=lambda: NOW)
        self.broker = FakeBroker()
        self.executor.broker = self.broker

    def tearDown(self):
        self.store.db.close()

    def enter(self):
        self.executor.enter("NIFTY", SETUP, CONTRACT, PRICES, RISK, 25000, NOW)

    def open_trade(self):
        self.executor.enabled = True
        self.enter()
        self.executor.reconcile(NOW)
        self.executor.reconcile(NOW)
        return self.store.trades()[0]

    def test_off_produces_no_order_or_intent(self):
        with self.assertRaisesRegex(Blocked, "OFF"):
            self.enter()
        self.assertEqual(self.broker.submissions, [])
        self.assertEqual(self.store.trades(), [])

    def test_entry_starts_at_0915_not_during_preopen(self):
        self.executor.enabled = True
        cfg = RISK.model_copy(update={"entry_start": "09:15"})
        before = NOW.replace(hour=9, minute=14, second=59)
        with self.assertRaisesRegex(Blocked, "Outside regular entry session"):
            self.executor.enter("NIFTY", SETUP, CONTRACT, {**PRICES, "timestamp": before.isoformat()},
                                cfg, 25000, before)
        self.assertEqual(self.broker.submissions, [])
        opening = NOW.replace(hour=9, minute=15, second=0)
        self.executor.clock = lambda: opening
        self.executor.enter("NIFTY", SETUP, CONTRACT, {**PRICES, "timestamp": opening.isoformat()},
                            cfg, 25000, opening)
        self.assertEqual([order["transaction_type"] for order in self.broker.submissions], ["BUY"])

    def test_turning_off_during_preflight_prevents_broker_submission(self):
        self.executor.enabled = True
        def orders():
            self.executor.enabled = False
            return []
        self.broker.orders = orders
        with self.assertRaisesRegex(Blocked, "before broker submission"):
            self.enter()
        self.assertEqual(self.broker.submissions, [])
        self.assertEqual(self.store.trades()[0]["state"], "NO_FILL")

    def test_off_ack_waits_for_inflight_submission_and_disables_future_entries(self):
        self.executor.enabled = True
        started, finish, off_done = threading.Event(), threading.Event(), threading.Event()
        original = self.broker.place_order
        def delayed(**kwargs):
            started.set()
            finish.wait(2)
            return original(**kwargs)
        self.broker.place_order = delayed
        entry_thread = threading.Thread(target=self.enter)
        entry_thread.start()
        self.assertTrue(started.wait(1))
        def off():
            self.executor.disable()
            off_done.set()
        off_thread = threading.Thread(target=off)
        off_thread.start()
        self.assertFalse(off_done.wait(.05))
        finish.set()
        entry_thread.join(2)
        off_thread.join(2)
        self.assertTrue(off_done.is_set())
        self.assertFalse(self.executor.enabled)
        with self.assertRaises(Blocked):
            self.enter()
        self.assertEqual(len(self.broker.submissions), 1)

    def test_manual_contract_positions_and_orders_are_never_touched(self):
        self.executor.enabled = True
        self.broker.net = [{"exchange": "NFO", "tradingsymbol": CONTRACT["tradingsymbol"],
                            "product": "MIS", "quantity": 50}]
        with self.assertRaisesRegex(Blocked, "already has a broker position"):
            self.enter()
        self.broker.net = []
        self.broker.book = [{"exchange": "NFO", "tradingsymbol": CONTRACT["tradingsymbol"],
                             "status": "OPEN", "tag": "MANUAL"}]
        with self.assertRaisesRegex(Blocked, "already has an open order"):
            self.enter()
        self.assertEqual(self.broker.submissions + self.broker.modifications + self.broker.cancellations, [])

    def test_full_debit_risk_not_just_stop_distance_is_reserved(self):
        self.executor.enabled = True
        low = RISK.model_copy(update={"risk_per_trade": 5000})
        with self.assertRaisesRegex(Blocked, "Full premium exposure"):
            self.executor.enter("NIFTY", SETUP, CONTRACT, PRICES, low, 25000, NOW)
        self.assertEqual(self.broker.submissions, [])

    def test_cash_and_quote_are_rechecked_before_irreversible_submission(self):
        self.executor.enabled = True
        self.broker.cash = 5000
        with self.assertRaisesRegex(Blocked, "broker cash"):
            self.enter()
        self.broker.cash = 10000
        self.executor.clock = lambda: NOW + timedelta(seconds=6)
        with self.assertRaisesRegex(Blocked, "expired during broker preflight"):
            self.enter()
        self.assertEqual(self.broker.submissions, [])
        self.assertEqual(self.store.trades()[0]["state"], "NO_FILL")

    def test_tiny_premium_cannot_enter_without_valid_broker_stop_geometry(self):
        self.executor.enabled = True
        with self.assertRaises(Blocked):
            self.executor.enter("NIFTY", SETUP, CONTRACT, {**PRICES, "ask": .1, "bid": .1}, RISK, 25000, NOW)
        self.assertEqual(self.broker.submissions, [])

    def test_unknown_entry_is_persistent_off_and_never_retried(self):
        self.executor.enabled = True
        self.broker.uncertain = True
        self.enter()
        self.assertEqual(self.store.trades()[0]["state"], "ENTRY_UNKNOWN")
        self.assertFalse(self.executor.enabled)
        self.executor.reconcile(NOW)
        with self.assertRaises(Blocked):
            self.enter()
        self.assertEqual(len(self.broker.submissions), 1)
        self.assertIsNotNone(self.executor.halted)

    def test_off_retains_exact_owned_stop_and_trailing_never_sells_twice(self):
        trade = self.open_trade()
        self.executor.disable()
        self.executor.manage(trade, {**PRICES, "bid": 125}, 105, NOW)
        self.assertGreater(self.store.trades()[0]["stop"], 80)
        trade = self.store.trades()[0]
        self.executor.manage(trade, {**PRICES, "bid": 120}, 105, NOW)
        self.assertEqual(self.store.trades()[0]["stop"], trade["stop"])
        self.executor.manage(trade, {**PRICES, "bid": 120}, 98, NOW + timedelta(seconds=6))
        self.assertEqual(len(self.broker.submissions), 2)
        self.assertEqual(self.broker.submissions[1]["transaction_type"], "SELL")
        self.assertTrue(all(m["order_id"] == trade["stop_order"] for m in self.broker.modifications))
        self.assertEqual(self.broker.modifications[-1]["order_type"], "LIMIT")

    def test_manual_activity_after_entry_halts_without_touching_foreign_orders(self):
        self.open_trade()
        self.broker.net[0]["quantity"] += 50
        before = len(self.broker.submissions)
        self.executor.reconcile(NOW)
        self.assertIn("Manual/external", self.executor.halted)
        self.assertFalse(self.executor.enabled)
        self.assertEqual(len(self.broker.submissions), before)
        self.assertEqual(self.broker.modifications + self.broker.cancellations, [])

    def test_completed_manual_round_trip_cannot_hide_behind_unchanged_net_quantity(self):
        self.open_trade()
        self.broker.book.append({"exchange": "NFO", "tradingsymbol": CONTRACT["tradingsymbol"],
                                 "product": "MIS", "quantity": 50, "filled_quantity": 50,
                                 "status": "COMPLETE", "tag": "MANUAL", "order_timestamp": NOW})
        self.executor.reconcile(NOW)
        self.assertIn("filled contract activity", self.executor.halted)
        self.assertEqual(self.broker.modifications + self.broker.cancellations, [])

    def test_own_completed_fills_only_count_loss_with_charge_reserve(self):
        self.open_trade()
        stop = self.broker.book[1]
        stop.update(status="COMPLETE", filled_quantity=50, average_price=80)
        self.broker.net[0]["quantity"] = 0
        self.broker.book.append({"tag": "MANUAL", "status": "COMPLETE", "average_price": 1,
                                "exchange": "NFO", "tradingsymbol": "OTHER", "product": "MIS"})
        self.executor.reconcile(NOW)
        trade = self.store.trades()[0]
        self.assertEqual(trade["state"], "CLOSED")
        self.assertEqual(trade["gross_pnl"], -1000)
        self.assertEqual(self.executor.budget_used(NOW.date().isoformat()), 1150)
        self.assertEqual(self.executor.budget_used(NOW.date().isoformat(), "SENSEX"), 0)
        self.assertEqual(len(self.store.trades()), 1)

    def test_partial_entry_is_protected_only_for_final_filled_quantity(self):
        self.executor.enabled = True
        self.enter()
        self.broker.book[0].update(filled_quantity=25, status="CANCELLED")
        self.broker.net[0]["quantity"] = 25
        self.executor.reconcile(NOW)
        self.assertEqual(self.broker.submissions[-1]["quantity"], 25)
        self.assertEqual(len(self.broker.submissions), 2)

    def test_uncertain_stop_submission_never_duplicates_a_sell(self):
        self.executor.enabled = True
        self.enter()
        self.broker.uncertain = True
        self.executor.reconcile(NOW)
        self.executor.reconcile(NOW)
        self.assertEqual(self.store.trades()[0]["state"], "STOP_UNKNOWN")
        self.assertEqual(len(self.broker.submissions), 2)
        self.assertFalse(self.executor.enabled)

    def test_trailing_modification_budget_preserves_exit_capacity(self):
        trade = self.open_trade()
        trade["modifications"] = 18
        self.store.trade(trade)
        self.executor.manage(trade, {**PRICES, "bid": 125}, 105, NOW)
        self.assertEqual(self.broker.modifications, [])
        self.executor.manage(trade, {**PRICES, "bid": 125}, 98, NOW)
        self.assertEqual(len(self.broker.modifications), 1)
        self.assertEqual(self.store.trades()[0]["modifications"], 19)

    def test_stale_crossed_and_empty_depth_are_rejected(self):
        quote = {"timestamp": NOW, "last_price": 100,
                 "depth": {"buy": [{"price": 99.5, "quantity": 100}],
                           "sell": [{"price": 100, "quantity": 100}]}}
        self.assertEqual(quote_prices(quote, NOW, 1)["ask"], 100)
        rest = quote_prices({**quote, "timestamp": NOW.replace(tzinfo=None)}, NOW, 1)
        self.assertEqual(rest["timestamp"], NOW.isoformat())
        with self.assertRaisesRegex(Blocked, "stale"):
            quote_prices(quote, NOW + timedelta(seconds=6), 1)
        with self.assertRaisesRegex(Blocked, "Crossed"):
            quote_prices({**quote, "depth": {"buy": [{"price": 101}], "sell": [{"price": 100}]}}, NOW, 1)
        with self.assertRaises(Blocked):
            quote_prices({**quote, "depth": {}}, NOW, 1)


class PersistenceAndAPITests(unittest.TestCase):
    def setUp(self):
        self.runtime = Runtime(":memory:")
        self.client = TestClient(main.app)
        self.runtime_patch = patch.object(main, "runtime", self.runtime)
        self.runtime_patch.start()
        self.secret = "x" * 48
        self.cfg_patch = patch.object(main, "credentials", return_value={"JWT_SECRET": self.secret})
        self.cfg_patch.start()

    def tearDown(self):
        self.runtime_patch.stop()
        self.cfg_patch.stop()
        self.runtime.store.db.close()

    def headers(self, method, path, body=b"", stamp=None):
        stamp = str(time.time() if stamp is None else stamp)
        message = f"{stamp}\n{method}\n{path}\n".encode() + body
        return {"X-Apex-Time": stamp, "X-Apex-Signature": hmac.new(
            self.secret.encode(), message, hashlib.sha256).hexdigest(), "Content-Type": "application/json"}

    def put(self, path, value):
        body = json.dumps(value).encode()
        return self.client.put(path, content=body, headers=self.headers("PUT", path, body))

    def test_unsigned_expired_and_body_tampered_controls_are_rejected(self):
        self.assertEqual(self.client.put("/api/trade-control", json={"enabled": True}).status_code, 403)
        headers = self.headers("PUT", "/api/trade-control", b'{"enabled":false}', stamp=time.time() - 31)
        self.assertEqual(self.client.put("/api/trade-control", content=b'{"enabled":false}', headers=headers).status_code, 403)
        headers = self.headers("PUT", "/api/trade-control", b'{"enabled":false}')
        self.assertEqual(self.client.put("/api/trade-control", content=b'{"enabled":true}', headers=headers).status_code, 403)

    def test_save_validated_free_text_settings_and_off_without_ready_feed(self):
        saved = self.put("/api/config/NIFTY", RISK.model_dump())
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(self.runtime.store.get("NIFTY")["lots"], 1)
        self.assertEqual(self.put("/api/daily", {"daily_loss": 25000}).status_code, 200)
        self.assertEqual(self.put("/api/trade-control", {"enabled": True}).status_code, 200)
        self.assertTrue(self.runtime.executor.enabled)
        self.runtime.executor.enabled = True
        self.assertEqual(self.put("/api/trade-control", {"enabled": False}).status_code, 200)
        self.assertFalse(self.runtime.executor.enabled)

    def test_on_records_intent_without_broker_calls_and_exposes_entry_blockers(self):
        self.runtime.kite = Mock()
        self.runtime.executor.broker = self.runtime.kite
        result = self.put("/api/trade-control", {"enabled": True})
        self.assertEqual(result.status_code, 200)
        self.assertTrue(result.json()["live"])
        self.runtime.kite.profile.assert_not_called()
        self.runtime.kite.orders.assert_not_called()
        self.runtime.kite.place_order.assert_not_called()
        response = self.client.get("/api/trade-control", headers=self.headers("GET", "/api/trade-control"))
        self.assertTrue(response.json()["live"])
        self.assertTrue(any("SMCAPEX_LIVE_ENABLED" in reason for reason in response.json()["block_reasons"]))
        self.runtime.executor.halted = "Unresolved owned order"
        self.assertEqual(self.put("/api/trade-control", {"enabled": True}).status_code, 409)

    def test_lightweight_control_status_does_not_wait_for_candle_worker_lock(self):
        locked, release = threading.Event(), threading.Event()
        def hold_market_lock():
            with self.runtime.lock:
                locked.set()
                release.wait(2)
        worker = threading.Thread(target=hold_market_lock)
        worker.start()
        self.assertTrue(locked.wait(1))
        self.runtime.executor.enabled = True
        started = time.monotonic()
        try:
            response = self.client.get("/api/trade-control",
                                       headers=self.headers("GET", "/api/trade-control"))
            self.assertLess(time.monotonic() - started, 1)
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()["live"])
            self.assertIn("at", response.json())
        finally:
            release.set()
            worker.join(2)

    def test_risk_settings_reject_invalid_lots_nan_and_windows(self):
        for changes in [{"lots": 1.5}, {"daily_loss": -1}, {"entry_start": "08:00"},
                        {"entry_end": "15:29"}, {"risk_per_trade": float("inf")}]:
            with self.assertRaises(ValidationError):
                IndexRisk(**{**RISK.model_dump(), **changes})
        self.assertEqual(self.put("/api/config/UNKNOWN", RISK.model_dump()).status_code, 404)
        self.runtime.executor.enabled = True
        self.assertEqual(self.put("/api/config/NIFTY", RISK.model_dump()).status_code, 200)
        self.runtime.store.trade({"id": "busy", "state": "OPEN"})
        self.assertEqual(self.put("/api/config/NIFTY", RISK.model_dump()).status_code, 409)

    def test_smaller_daily_cap_saves_independently_while_on_without_an_open_order(self):
        self.runtime.executor.enabled = True
        risk = {**RISK.model_dump(), "risk_per_trade": 2500, "daily_loss": 200}
        result = self.put("/api/config/NIFTY", risk)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(self.runtime.store.get("NIFTY")["daily_loss"], 200)
        self.assertEqual(self.put("/api/daily", {"daily_loss": 3000}).status_code, 200)
        self.assertTrue(self.runtime.executor.enabled)

    def test_stale_connected_feed_identifies_each_missing_stream_without_using_off_as_feed_control(self):
        self.runtime.feed = "CONNECTED"
        self.runtime.feed_connected_at = 0
        self.runtime.history_loaded = True
        self.runtime.ticks = {
            (symbol, kind): {"received": NOW - timedelta(seconds=2), "at": NOW - timedelta(seconds=2)}
            for symbol in ("NIFTY", "BANKNIFTY", "SENSEX") for kind in ("spot", "future")
        }
        self.runtime.executor.enabled = False
        self.runtime.ticks[("NIFTY", "future")]["received"] = NOW - timedelta(seconds=11)
        with patch("smcapex.runtime.monotonic", return_value=30):
            stale = self.runtime.stale_feed_streams(NOW)
        self.assertEqual(stale, ["NIFTY future"])
        self.assertFalse(self.runtime.executor.enabled)

    def test_candle_memory_persists_and_live_intent_is_not_a_saved_setting(self):
        rows = gap_rows()
        self.runtime.store.candles("NIFTY", "1", rows)
        self.runtime.store.candles("NIFTY", "1", rows)
        self.assertEqual(self.runtime.store.history("NIFTY", "1"), rows)
        restarted = Executor(self.runtime.store)
        self.runtime.executor.enabled = True
        self.assertFalse(restarted.enabled)

    def test_last_completed_close_uses_historical_sessions_without_making_a_quote_fresh(self):
        days = [
            Candle(NOW.replace(day=20, hour=0, minute=0), 100, 101, 99, 100),
            Candle(NOW.replace(day=23, hour=0, minute=0), 110, 111, 109, 110),
            Candle(NOW.replace(day=24, hour=0, minute=0), 120, 121, 119, 120),
            Candle(NOW.replace(day=25, hour=0, minute=0), 130, 131, 129, 130),
        ]
        self.runtime.store.candles("NIFTY", "D", days)
        self.runtime.ticks[("NIFTY", "spot")] = {
            "at": NOW - timedelta(minutes=5), "received": NOW - timedelta(minutes=5),
            "price": 111, "ohlc": {"close": 111}, "timestamp_source": "RECEIPT",
        }

        class Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                return NOW

        with patch("smcapex.runtime.datetime", Clock):
            indices = self.runtime.status()["indices"]
        self.assertFalse(indices["NIFTY"]["fresh"])
        self.assertEqual(indices["NIFTY"]["price"], 111)
        self.assertEqual(indices["NIFTY"]["last_close"]["price"], 110)
        self.assertEqual(indices["NIFTY"]["last_close"]["session_date"], "2026-11-23")
        self.assertAlmostEqual(indices["NIFTY"]["last_close"]["change_percent"], 10)
        self.assertIsNone(indices["BANKNIFTY"]["last_close"])
        with self.assertRaises(Blocked):
            self.runtime.fresh("NIFTY", "spot", NOW)

    def test_daily_history_includes_today_only_after_close_and_if_exchange_provides_it(self):
        self.runtime.tokens = {1: ("NIFTY", "spot")}
        past = NOW.replace(day=23, hour=0, minute=0)
        today = NOW.replace(hour=0, minute=0)
        rows = [{"date": at, "open": 100, "high": 101, "low": 99, "close": 100} for at in (past, today)]
        self.runtime.kite = Mock()
        self.runtime.kite.historical_data.side_effect = lambda token, start, end, frame: rows if frame == "day" else []
        with patch.object(self.runtime.stop_event, "wait", return_value=False):
            self.runtime.history(NOW)
            self.assertEqual([r.at.date().isoformat() for r in self.runtime.store.history("NIFTY", "D")], ["2026-11-23"])
            self.runtime.history(NOW.replace(hour=15, minute=32))
        self.assertEqual([r.at.date().isoformat() for r in self.runtime.store.history("NIFTY", "D")],
                         ["2026-11-23", "2026-11-24"])
        self.assertEqual(self.runtime.last_close_refresh, NOW.date())

    def test_incomplete_live_candles_are_discarded_not_padded(self):
        token = 123
        self.runtime.tokens[token] = ("NIFTY", "spot")
        start = NOW.replace(second=0)
        for seconds in (10, 20, 50):
            at = start + timedelta(seconds=seconds)
            self.runtime.ingest(at, [{"instrument_token": token, "exchange_timestamp": at, "last_price": 100}])
        row = self.runtime.building["NIFTY"]
        self.runtime.finish_candle("NIFTY", row)
        self.assertEqual(self.runtime.store.history("NIFTY", "1"), [])
        self.assertIsNone(self.runtime.error)
        self.assertIn("rejected", self.runtime.status()["indices"]["NIFTY"]["data_warning"])
        self.assertIsNone(self.runtime.status()["indices"]["BANKNIFTY"]["data_warning"])

    def test_minute_boundary_waits_for_delayed_valid_exchange_ticks(self):
        start = NOW.replace(second=0) - timedelta(minutes=1)
        wall = start + timedelta(minutes=1, seconds=1)
        self.runtime.tokens = {1: ("NIFTY", "spot")}
        self.runtime.building["NIFTY"] = {
            "at": start, "open": 100, "high": 101, "low": 99, "close": 100,
            "first": start, "last": start + timedelta(seconds=54), "gap": 2,
        }
        self.runtime.feed = "CONNECTED"
        self.runtime.current_credentials = ("key", "token")
        self.runtime.last_history = time.monotonic()
        self.runtime.last_analysis = wall.replace(second=0, microsecond=0)

        class Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                return wall

        with patch("smcapex.runtime.datetime", Clock), patch("smcapex.runtime.credentials",
                return_value={"ZERODHA_API_KEY": "key", "ZERODHA_ACCESS_TOKEN": "token"}), \
                patch.object(self.runtime.stop_event, "is_set", side_effect=[False, True]), \
                patch.object(self.runtime.stop_event, "wait"):
            self.runtime.run()
        self.assertIn("NIFTY", self.runtime.building)
        self.assertEqual(self.runtime.candle_errors, {})
        self.runtime.ingest(wall + timedelta(seconds=1), [{
            "instrument_token": 1, "exchange_timestamp": start + timedelta(seconds=59), "last_price": 102,
        }])
        self.runtime.ingest(wall + timedelta(seconds=2), [{
            "instrument_token": 1, "exchange_timestamp": start + timedelta(minutes=1, seconds=1), "last_price": 103,
        }])
        self.assertEqual(self.runtime.store.history("NIFTY", "1")[0].close, 102)
        self.assertEqual(self.runtime.candle_errors, {})

    def test_analysis_waits_until_the_previous_live_minute_can_be_finalized(self):
        start = NOW.replace(second=0) - timedelta(minutes=1)
        wall = start + timedelta(minutes=1, seconds=1)
        self.runtime.building["NIFTY"] = {
            "at": start, "open": 100, "high": 101, "low": 99, "close": 100,
            "first": start, "last": start + timedelta(seconds=59), "gap": 2,
        }
        self.runtime.feed = "CONNECTED"
        self.runtime.current_credentials = ("key", "token")
        self.runtime.last_history = time.monotonic()
        self.runtime.last_analysis = start
        observations = []

        class Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                return wall

        def analyse(now, cfg):
            observations.append((now, self.runtime.store.history("NIFTY", "1")))

        def advance(_seconds):
            nonlocal wall
            wall = start + timedelta(minutes=1, seconds=6)

        with patch("smcapex.runtime.datetime", Clock), patch("smcapex.runtime.credentials",
                return_value={"ZERODHA_API_KEY": "key", "ZERODHA_ACCESS_TOKEN": "token"}), \
                patch.object(self.runtime.stop_event, "is_set", side_effect=[False, False, True]), \
                patch.object(self.runtime.stop_event, "wait", side_effect=advance), \
                patch.object(self.runtime, "analyse", side_effect=analyse):
            self.runtime.run()
        self.assertEqual(len(observations), 1)
        self.assertEqual(observations[0][0], start + timedelta(minutes=1, seconds=6))
        self.assertEqual(observations[0][1][0].at, start)

    def test_candle_warning_clears_only_when_exchange_history_covers_rejected_bar(self):
        at = NOW.replace(second=0) - timedelta(minutes=2)
        self.runtime.tokens = {1: ("NIFTY", "spot")}
        self.runtime.finish_candle("NIFTY", {
            "at": at, "first": at + timedelta(seconds=10), "last": at + timedelta(seconds=50), "gap": 0,
        })
        self.runtime.error = "Protective order requires operator attention"
        self.runtime.kite = Mock()
        self.runtime.kite.historical_data.return_value = []
        with patch.object(self.runtime.stop_event, "wait", return_value=False):
            self.runtime.history(NOW)
            self.assertIn("awaiting exchange history", self.runtime.status()["indices"]["NIFTY"]["data_warning"])
            self.runtime.kite.historical_data.side_effect = lambda token, start, end, frame: [{
                "date": at, "open": 100, "high": 101, "low": 99, "close": 100,
            }] if frame == "minute" else []
            self.runtime.history(NOW)
        self.assertIsNone(self.runtime.status()["indices"]["NIFTY"]["data_warning"])
        self.assertEqual(self.runtime.error, "Protective order requires operator attention")
        self.assertEqual(self.runtime.store.history("NIFTY", "1")[0].at, at)

    def test_zero_timestamp_index_packet_uses_receipt_without_inventing_candles(self):
        token = 256265
        packet = struct.pack(">8I", token, 10000, 10100, 9900, 10000, 10000, 0, 0)
        ticks = KiteTicker("mock", "mock")._parse_binary(struct.pack(">HH", 1, len(packet)) + packet)
        self.runtime.tokens[token] = ("NIFTY", "spot")
        self.runtime.ingest(NOW, ticks)
        quote = self.runtime.fresh("NIFTY", "spot", NOW)
        self.assertEqual(quote["timestamp_source"], "RECEIPT")
        self.assertEqual(quote["price"], 100)
        self.assertFalse(self.runtime.executor.enabled)
        self.assertIsNone(self.runtime.error)
        self.assertEqual(self.runtime.building, {})
        self.assertEqual(self.runtime.store.history("NIFTY", "1"), [])
        with self.assertRaises(Blocked):
            self.runtime.fresh("NIFTY", "spot", NOW + timedelta(seconds=6))
        self.runtime.tokens[token] = ("NIFTY", "future")
        self.runtime.ingest(NOW, [{**ticks[0], "exchange_timestamp": NOW}])
        self.assertEqual(self.runtime.fresh("NIFTY", "future", NOW)["timestamp_source"], "EXCHANGE")
        self.runtime.ingest(NOW, ticks)
        with self.assertRaises(Blocked):
            self.runtime.fresh("NIFTY", "future", NOW)

    def test_missing_spot_timestamp_is_receipt_only_and_bad_timestamp_does_not_abort_batch(self):
        class InvalidTimestamp(datetime):
            def astimezone(self, tz=None):
                raise OSError(22, "Invalid argument")
        self.runtime.tokens = {1: ("NIFTY", "future"), 2: ("NIFTY", "spot")}
        self.runtime.ingest(NOW, [
            {"instrument_token": 1, "last_price": 100, "exchange_timestamp": InvalidTimestamp(2026, 11, 24)},
            {"instrument_token": 2, "last_price": 100},
        ])
        self.assertEqual(self.runtime.fresh("NIFTY", "spot", NOW)["timestamp_source"], "RECEIPT")
        self.assertNotIn(("NIFTY", "future"), self.runtime.ticks)
        self.assertIsNone(self.runtime.error)
        self.assertIn("invalid exchange timestamp", self.runtime.status()["indices"]["NIFTY"]["data_warning"])
        self.runtime.ingest(NOW, [
            {"instrument_token": 1, "last_price": 100, "exchange_timestamp": NOW},
        ])
        self.assertIsNone(self.runtime.status()["indices"]["NIFTY"]["data_warning"])

    def test_history_connection_failure_while_off_recovers_without_erasing_other_errors(self):
        self.runtime.feed = "CONNECTED"
        self.runtime.current_credentials = ("key", "token")
        self.runtime.last_analysis = NOW.replace(second=0, microsecond=0)
        self.runtime.error = "Protective order requires operator attention"
        calls = []

        def history(_now):
            calls.append(1)
            if len(calls) == 1:
                raise RequestsConnectionError("test-only connection failure")
            state = self.runtime.status()
            self.assertFalse(state["live"])
            self.assertEqual(state["error"], "Protective order requires operator attention")
            self.assertIn("candle history connection unavailable", state["connection_warnings"][0])

        class Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                return NOW

        with patch("smcapex.runtime.datetime", Clock), patch("smcapex.runtime.credentials",
                return_value={"ZERODHA_API_KEY": "key", "ZERODHA_ACCESS_TOKEN": "token"}), \
                patch.object(self.runtime.stop_event, "is_set", side_effect=[False, False, True]), \
                patch.object(self.runtime.stop_event, "wait"), patch.object(self.runtime, "history", side_effect=history):
            self.runtime.run()
        state = self.runtime.status()
        self.assertEqual(len(calls), 2)
        self.assertFalse(state["live"])
        self.assertEqual(state["connection_warnings"], [])
        self.assertEqual(state["error"], "Protective order requires operator attention")

    def test_ai_strict_matching_response_cached_once_and_no_model_fails_closed(self):
        signal = {"setup": {**SETUP, "id": "fixture"}, "checks": [], "daily": {}, "contract": {"symbol": "TEST26CE"}}
        cfg = {"SMCAPEX_ANTHROPIC_API_KEY": "mock-only", "SMCAPEX_AI_MODEL": "mock-model"}
        requests = []
        def respond(req):
            requests.append(req)
            return httpx.Response(200, json={"stop_reason": "end_turn", "content": [{"type": "text",
                "text": json.dumps({"approved": True, "setup_id": "fixture", "side": "CE",
                                    "contract": "TEST26CE", "reason": "Evidence consistent"})}],
                "usage": {"input_tokens": 10, "output_tokens": 10}})
        original = httpx.Client
        with patch("smcapex.runtime.httpx.Client", side_effect=lambda **kwargs: original(
                **kwargs, transport=httpx.MockTransport(respond))):
            verdict = self.runtime.ai("NIFTY", signal, {}, cfg, NOW)
            cached = self.runtime.ai("NIFTY", signal, {}, cfg, NOW + timedelta(seconds=1))
        self.assertTrue(verdict["approved"])
        self.assertEqual(cached, verdict)
        self.assertEqual(len(requests), 1)
        with self.assertRaisesRegex(Blocked, "different option"):
            self.runtime.ai("NIFTY", {**signal, "contract": {"symbol": "OTHER"}}, {}, cfg, NOW)
        with self.assertRaisesRegex(Blocked, "not configured"):
            self.runtime.ai("BANKNIFTY", signal, {}, {}, NOW + timedelta(minutes=6))

    def test_ai_uses_existing_quantumedge_key_before_autonomiq_fallback(self):
        from smcapex.config import credentials

        values = {"QUANTUMEDGE_AI_ANTHROPIC_API_KEY": "mock-quantum",
                  "AUTONOMIQ_PRO_ANTHROPIC_API_KEY": "mock-autonomiq",
                  "SMCAPEX_AI_MODEL": "mock-model"}
        with patch("smcapex.config.ENV_FILE") as env_file, \
                patch("smcapex.config.dotenv_values", return_value=values), \
                patch.dict("os.environ", {}, clear=True):
            env_file.is_file.return_value = True
            cfg = credentials()
        self.assertEqual(cfg.get("QUANTUMEDGE_AI_ANTHROPIC_API_KEY"), "mock-quantum")
        _, key, model = self.runtime.reserve_ai("quantum-fallback", cfg, NOW, {"status": "PENDING"})
        self.assertEqual((key, model), ("mock-quantum", "mock-model"))
        cfg["SMCAPEX_ANTHROPIC_API_KEY"] = "mock-dedicated"
        _, key, _ = self.runtime.reserve_ai(
            "dedicated", cfg, NOW + timedelta(minutes=6), {"status": "PENDING"})
        self.assertEqual(key, "mock-dedicated")

    def test_ai_string_boolean_mismatched_id_and_truncation_never_approve(self):
        original = httpx.Client
        cases = [("end_turn", {"approved": "true", "setup_id": "fixture", "side": "CE", "reason": "bad"}),
                 ("end_turn", {"approved": True, "setup_id": "other", "side": "CE", "reason": "bad"}),
                 ("max_tokens", {"approved": True, "setup_id": "fixture", "side": "CE", "reason": "bad"})]
        for index, (stop, verdict) in enumerate(cases):
            now = NOW + timedelta(minutes=6 * index)
            signal = {"setup": {**SETUP, "id": f"fixture{index}"}, "checks": [], "daily": {},
                      "contract": {"symbol": "TEST26CE"}}
            verdict["contract"] = "TEST26CE"
            transport = httpx.MockTransport(lambda request, stop=stop, verdict=verdict: httpx.Response(
                200, json={"stop_reason": stop, "content": [{"type": "text", "text": json.dumps(verdict)}]}))
            with patch("smcapex.runtime.httpx.Client", side_effect=lambda **kwargs: original(**kwargs, transport=transport)):
                result = self.runtime.ai("NIFTY", signal, {}, {"SMCAPEX_ANTHROPIC_API_KEY": "mock",
                    "SMCAPEX_AI_MODEL": "mock"}, now)
            self.assertFalse(result["approved"])


class RuntimeIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.runtime = Runtime(":memory:")
        self.runtime.executor.clock = lambda: NOW
        self.broker = FakeBroker()
        raw = {"timestamp": NOW, "last_price": 100, "depth": {
            "buy": [{"price": 99.5, "quantity": 100}], "sell": [{"price": 100, "quantity": 100}]}}
        self.broker.quote = Mock(return_value={"NFO:TEST26CE": raw})
        self.runtime.kite = self.runtime.executor.broker = self.broker
        self.runtime.socket = Mock()
        self.runtime.catalog = [{**CONTRACT, "name": "NIFTY", "instrument_type": "CE", "strike": 100}]
        self.runtime.ticks[("NIFTY", "spot")] = {"at": NOW, "received": NOW, "price": 100, "ohlc": {}}
        self.runtime.ticks[("NIFTY", "future")] = {"at": NOW, "received": NOW, "price": 100, "depth": {
            "buy": [{"price": 99.95, "quantity": 600}], "sell": [{"price": 100, "quantity": 400}]}}
        self.runtime.store.save("NIFTY", RISK.model_dump())
        self.runtime.store.save("daily", {"daily_loss": 25000})
        self.signal = {"decision": "BUY CE", "reason": "Qualified fixture", "checks": [{"label": "fixture", "passed": True}],
                       "score": 100, "daily": {}, "timeframes": {}, "fvgs": [],
                       "setup": {**SETUP, "underlying_entry": 100, "liquidity_target": 104, "structural_rr": 4,
                                 "trigger_at": (NOW - timedelta(minutes=1)).isoformat(),
                                 "fvg": {"lower": 99, "upper": 99.8}}}
        self.verdict = {"approved": True, "reason": "Mock approval", "at": NOW.isoformat(),
                        "setup_id": SETUP["id"], "side": "CE", "contract": CONTRACT["tradingsymbol"]}
        self.cfg = {"SMCAPEX_LIVE_ENABLED": "true"}

    def tearDown(self):
        self.runtime.store.db.close()

    def run_analysis(self, enabled, ai_side_effect=None):
        self.runtime.executor.enabled = enabled
        calls = 0
        def evaluate_fixture(*args):
            nonlocal calls
            calls += 1
            return json.loads(json.dumps(self.signal)) if calls == 1 or calls == 2 and self.runtime.executor.enabled else {
                "decision": "WAIT", "reason": "No fixture for this index", "setup": None, "timeframes": {},
                "checks": [], "score": 0, "fvgs": []}
        class Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                return NOW
        with patch("smcapex.runtime.datetime", Clock), patch("smcapex.runtime.evaluate", side_effect=evaluate_fixture), patch.object(
                self.runtime, "ai", return_value=self.verdict, side_effect=ai_side_effect):
            self.runtime.analyse(NOW, self.cfg)

    def test_approved_signal_with_switch_off_never_submits(self):
        self.run_analysis(False)
        self.assertTrue(self.runtime.signals["NIFTY"]["ai"]["approved"])
        self.assertEqual(self.runtime.signals["NIFTY"]["execution"], "SIGNAL_ONLY")
        self.assertEqual(self.broker.submissions, [])

    def test_preopen_never_calls_live_approval_or_submits_orders_even_when_enabled(self):
        start = NOW.replace(day=23, hour=9, minute=15)
        candles = [Candle(start + timedelta(minutes=i), 100, 101, 99, 100) for i in range(150)]
        self.runtime.store.candles("NIFTY", "1", candles)
        self.runtime.store.candles("NIFTY", "D", [Candle(start, 100, 110, 90, 105)])
        self.runtime.executor.enabled = True
        with patch.object(self.runtime, "ai") as ai:
            self.runtime.analyse(NOW.replace(hour=9, minute=10), self.cfg)
        ai.assert_not_called()
        self.assertEqual(self.broker.submissions, [])
        self.assertIn("Pre-open analysis", self.runtime.signals["NIFTY"]["reason"])

    def test_preopen_ai_is_journaled_once_per_index_and_shared_cooldown_is_respected(self):
        start = NOW.replace(day=23, hour=9, minute=15)
        candles = [Candle(start + timedelta(minutes=i), 100, 101, 99, 100) for i in range(150)]
        for symbol in ("NIFTY", "BANKNIFTY", "SENSEX"):
            self.runtime.store.candles(symbol, "1", candles)
            self.runtime.store.candles(symbol, "D", [Candle(start, 100, 110, 90, 105)])
        self.runtime.executor.enabled = True
        cfg = {"SMCAPEX_ANTHROPIC_API_KEY": "mock", "SMCAPEX_AI_MODEL": "mock"}
        requests = []
        def respond(request):
            payload = json.loads(json.loads(request.content)["messages"][0]["content"])
            requests.append(payload)
            return httpx.Response(200, json={"stop_reason": "end_turn", "content": [{"type": "text",
                "text": json.dumps({"bias": "NEUTRAL", "summary": "Historical context only",
                                    "risk_flags": ["Await the open"]})}]})
        original = httpx.Client
        with patch("smcapex.runtime.httpx.Client", side_effect=lambda **kwargs: original(
                **kwargs, transport=httpx.MockTransport(respond))):
            for minute in (0, 4, 5, 10, 14):
                self.runtime.analyse(NOW.replace(hour=9, minute=minute), cfg)
            self.runtime.analyse(NOW.replace(hour=9, minute=14, second=30), cfg)
        self.assertEqual([item["index"] for item in requests], ["NIFTY", "BANKNIFTY", "SENSEX"])
        self.assertTrue(all(item["daily"]["previous_close"] == 105 for item in requests))
        self.assertEqual(self.runtime.store.ai_calls(NOW.date().isoformat()), 3)
        self.assertEqual(self.runtime.store.approval("preopen:2026-11-24:NIFTY")["evidence"]["index"], "NIFTY")
        self.assertEqual(self.runtime.signals["SENSEX"]["preopen_ai"]["status"], "COMPLETE")
        self.assertNotIn("evidence", self.runtime.signals["SENSEX"]["preopen_ai"])
        self.assertEqual(self.broker.submissions, [])

    def test_preopen_failed_or_interrupted_attempt_is_not_retried_and_live_checks_continue(self):
        start = NOW.replace(day=23, hour=9, minute=15)
        candles = [Candle(start + timedelta(minutes=i), 100, 101, 99, 100) for i in range(150)]
        self.runtime.store.candles("NIFTY", "1", candles)
        self.runtime.store.candles("NIFTY", "D", [Candle(start, 100, 110, 90, 105)])
        cfg = {"SMCAPEX_ANTHROPIC_API_KEY": "mock", "SMCAPEX_AI_MODEL": "mock"}
        requests = []
        def respond(request):
            requests.append(request)
            return httpx.Response(503)
        original = httpx.Client
        with patch("smcapex.runtime.httpx.Client", side_effect=lambda **kwargs: original(
                **kwargs, transport=httpx.MockTransport(respond))):
            at = NOW.replace(hour=9, minute=0)
            self.runtime.analyse(at, cfg)
            self.runtime.analyse(at + timedelta(minutes=6), cfg)
        self.assertEqual(len(requests), 1)
        self.assertEqual(self.runtime.store.approval("preopen:2026-11-24:NIFTY")["status"], "FAILED")
        self.run_analysis(True)
        self.assertEqual(self.runtime.signals["NIFTY"]["preopen_ai"]["status"], "FAILED")
        self.assertEqual([order["transaction_type"] for order in self.broker.submissions], ["BUY", "SELL"])

    def test_interrupted_preopen_attempt_is_not_retried(self):
        start = NOW.replace(day=23, hour=9, minute=15)
        candles = [Candle(start + timedelta(minutes=i), 100, 101, 99, 100) for i in range(150)]
        self.runtime.store.candles("NIFTY", "1", candles)
        self.runtime.store.candles("NIFTY", "D", [Candle(start, 100, 110, 90, 105)])
        self.runtime.store.approve("preopen:2026-11-24:NIFTY", "2026-11-24", {
            "status": "PENDING", "at": NOW.replace(hour=9, minute=0).isoformat(),
            "session_date": "2026-11-24", "reason": "Pre-open AI request pending or interrupted."})
        with patch("smcapex.runtime.httpx.Client") as client:
            self.runtime.analyse(NOW.replace(hour=9, minute=10), {
                "SMCAPEX_ANTHROPIC_API_KEY": "mock", "SMCAPEX_AI_MODEL": "mock"})
        client.assert_not_called()
        self.assertEqual(self.runtime.signals["NIFTY"]["preopen_ai"]["status"], "PENDING")

    def test_live_ai_receives_only_same_day_completed_preopen_context(self):
        cfg = {"SMCAPEX_ANTHROPIC_API_KEY": "mock", "SMCAPEX_AI_MODEL": "mock"}
        self.runtime.store.approve("preopen:2026-11-24:NIFTY", NOW.date().isoformat(), {
            "status": "COMPLETE", "session_date": NOW.date().isoformat(), "at": NOW.replace(hour=9, minute=0).isoformat(),
            "bias": "NEUTRAL", "summary": "Historical context", "risk_flags": ["Await fresh candles"],
            "evidence": {"not_for_live_prompt": True}})
        signal = {**self.signal, "contract": {"symbol": "TEST26CE"},
                  "preopen_ai": self.runtime.store.approval("preopen:2026-11-24:NIFTY")}
        requests = []
        def respond(request):
            requests.append(json.loads(json.loads(request.content)["messages"][0]["content"]))
            return httpx.Response(200, json={"stop_reason": "end_turn", "content": [{"type": "text",
                "text": json.dumps({"approved": True, "setup_id": SETUP["id"], "side": "CE",
                                    "contract": "TEST26CE", "reason": "Live evidence confirmed"})}]})
        original = httpx.Client
        with patch("smcapex.runtime.httpx.Client", side_effect=lambda **kwargs: original(
                **kwargs, transport=httpx.MockTransport(respond))):
            self.assertTrue(self.runtime.ai("NIFTY", signal, {}, cfg, NOW)["approved"])
            signal["setup"] = {**signal["setup"], "id": "next-day-fixture"}
            self.runtime.ai("NIFTY", signal, {}, cfg, NOW + timedelta(days=1))
        self.assertEqual(requests[0]["preopen_context"]["summary"], "Historical context")
        self.assertNotIn("evidence", requests[0]["preopen_context"])
        self.assertNotIn("preopen_context", requests[1])

    def test_receipt_only_spot_cannot_enter_without_fresh_exchange_timed_futures(self):
        self.runtime.ticks[("NIFTY", "spot")]["timestamp_source"] = "RECEIPT"
        self.runtime.ticks[("NIFTY", "future")]["at"] = NOW - timedelta(seconds=6)
        self.run_analysis(True)
        self.assertEqual(self.broker.submissions, [])
        self.assertIn("future feed missing or stale", self.runtime.signals["NIFTY"]["reason"])
        self.runtime.ticks[("NIFTY", "future")]["at"] = NOW
        self.run_analysis(True)
        self.assertEqual([o["transaction_type"] for o in self.broker.submissions], ["BUY", "SELL"])

    def test_connection_warning_blocks_buy_even_if_owner_reenables(self):
        self.runtime.connection_failure("history", "History connection unavailable; retrying.")
        self.run_analysis(True)
        self.assertEqual(self.broker.submissions, [])
        self.assertIn("Connection recovery pending", self.runtime.signals["NIFTY"]["reason"])
        self.runtime.connection_recovered("history")
        self.run_analysis(True)
        self.assertEqual([o["transaction_type"] for o in self.broker.submissions], ["BUY", "SELL"])

    def test_all_runtime_gates_on_submit_exactly_one_buy_and_owned_protection(self):
        self.run_analysis(True)
        self.assertEqual([o["transaction_type"] for o in self.broker.submissions], ["BUY", "SELL"])
        self.assertEqual(self.runtime.signals["NIFTY"]["execution"], "ORDER_INTENT_RECORDED")
        trade = self.runtime.store.trades()[0]
        self.assertEqual(trade["setup"]["ai"]["contract"], CONTRACT["tradingsymbol"])
        self.assertTrue(trade["stop_order"])

    def test_off_during_ai_and_fvg_invalidation_prevent_buy(self):
        def approval(*args):
            self.runtime.executor.disable()
            return self.verdict
        self.run_analysis(True, approval)
        self.assertEqual(self.broker.submissions, [])
        self.runtime.ticks[("NIFTY", "spot")]["price"] = 98.9
        self.run_analysis(True)
        self.assertEqual(self.broker.submissions, [])
        self.assertIn("invalidated", self.runtime.signals["NIFTY"]["reason"])

    def test_ticks_received_during_ai_are_drained_before_submission_revalidation(self):
        def ingest(received, ticks):
            self.runtime.ticks[("NIFTY", "spot")].update(at=received, received=received, price=100)
            self.runtime.ticks[("NIFTY", "future")].update(at=received, received=received)
        self.runtime.ingest = Mock(side_effect=ingest)
        def approval(*args):
            for kind in ("spot", "future"):
                self.runtime.ticks[("NIFTY", kind)]["at"] = NOW - timedelta(seconds=10)
            self.runtime.events.put_nowait((NOW, []))
            return self.verdict
        self.run_analysis(True, approval)
        self.assertEqual(self.runtime.ingest.call_count, 1)
        self.assertEqual([o["transaction_type"] for o in self.broker.submissions], ["BUY", "SELL"])

    def test_risk_updated_during_ai_is_rechecked_before_buy(self):
        def approval(*args):
            self.runtime.store.save("NIFTY", {**RISK.model_dump(), "risk_per_trade": 200, "daily_loss": 200})
            return self.verdict
        self.run_analysis(True, approval)
        self.assertEqual(self.broker.submissions, [])
        self.assertIn("Full premium exposure", self.runtime.signals["NIFTY"]["reason"])


if __name__ == "__main__":
    unittest.main()
