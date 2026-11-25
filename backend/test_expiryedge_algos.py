import copy
import json
import threading
import unittest
from dataclasses import asdict, replace
from datetime import datetime
from unittest.mock import AsyncMock, Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.aqte_live import (
    EXPIRYEDGE_MAX_FAILURES, AQTELiveService, EntrySkipped, LiveBlocked, algo_order, aqte_order, performance,
)
from services.aqte_engine import IST, day
from services.expiryedge_algos import (
    ALGO_KEYS, ALGOS, EVALUATORS, RETIRED_ALGO_KEYS, RULEBOOK, ExpiryEdgeDesk, build_features, idle_result,
    setup_key,
)
from test_aqte import CONTRACT, NOW, ready_engine
import test_aqte_live

settings = test_aqte_live.settings

ALGO = ALGO_KEYS[0]
OTHER = ALGO_KEYS[1]


def qualified(algo=ALGO, side="CE"):
    """A desk evaluation in which exactly one algo has a fresh, fully satisfied trigger."""
    result = idle_result(algo, "test")
    result.update(status="SATISFIED", decision=f"BUY {side}", side=side, passed=5, total=5, fresh=True,
                  trigger_at=NOW - 120, trigger_seconds=60, rules=[], levels={"underlying_risk": 20})
    algos = {key: idle_result(key, "Monitoring") for key in ALGO_KEYS}
    algos[algo] = result
    return {"symbol": "NIFTY", "ready": True, "reason": None, "context": {}, "algos": algos}


def idle_evaluation(symbol="NIFTY"):
    return {"symbol": symbol, "ready": False, "reason": "x", "context": {},
            "algos": {key: idle_result(key, "x") for key in ALGO_KEYS}}


def proposal_for(algo=ALGO, **overrides):
    value = {
        "id": "approved", "owner": "EXPIRYEDGE", "algo": algo, "symbol": "NIFTY",
        "contract": asdict(CONTRACT), "strategy": f"expiryedge_{algo}",
        "entry": {"maximum": 100, "stop": 80, "target": 140, "quantity": CONTRACT.lot_size, "reward_risk": 2},
        "risk": 400, "signal_at": NOW - 1, "expires_at": NOW + 15,
        "setup_key": f"EXPIRYEDGE:{algo}:NIFTY:{int(NOW - 120)}:CE",
        "execution_context": {"reason": "test trigger"},
    }
    value.update(overrides)
    return value


def desk_market(engine):
    market = Mock()
    market.lock = threading.RLock()
    market.engine = engine
    market.engine_config = None
    return market


class ExpiryEdgeOwnershipTests(unittest.TestCase):
    def test_xea_tag_is_algo_owned_but_never_aqte_owned(self):
        self.assertTrue(algo_order({"tag": "XEA" + "a" * 13 + "E"}))
        self.assertTrue(algo_order({"tag": "XEA" + "a" * 13 + "S"}))
        self.assertFalse(algo_order({"tag": "XEA" + "a" * 13 + "X"}))
        self.assertFalse(algo_order({"tag": "XEA" + "a" * 12 + "E"}))
        self.assertFalse(aqte_order({"tag": "XEA" + "a" * 13 + "E"}))
        self.assertFalse(algo_order({"tag": "MANUAL"}))

    def test_manual_position_stays_out_of_expiryedge_ownership(self):
        broker = Mock()
        broker.orders.return_value = [
            {"tag": "XEA" + "b" * 13 + "E", "filled_quantity": 75, "exchange": "NFO", "tradingsymbol": "XEA_CE",
             "product": "MIS", "transaction_type": "BUY", "status": "COMPLETE", "instrument_token": 11},
            {"tag": "", "filled_quantity": 25, "exchange": "NFO", "tradingsymbol": "MANUAL_CE",
             "product": "MIS", "transaction_type": "BUY", "status": "COMPLETE", "instrument_token": 22},
        ]
        broker.positions.return_value = {"net": [
            {"quantity": 75, "exchange": "NFO", "tradingsymbol": "XEA_CE", "product": "MIS", "instrument_token": 11},
            {"quantity": 25, "exchange": "NFO", "tradingsymbol": "MANUAL_CE", "product": "MIS",
             "instrument_token": 22},
        ]}
        book = AQTELiveService().book(broker)
        self.assertEqual([position["tradingsymbol"] for position in book["owned"]], ["XEA_CE"])
        self.assertEqual(book["busy"], {22})

    def test_performance_reports_none_instead_of_invented_ratios(self):
        empty = performance([])
        self.assertEqual((empty["trades"], empty["win_rate"], empty["profit_factor"]), (0, None, None))
        stats = performance([
            {"entry_at": 1, "exit_at": 2, "net_pnl": 300.0},
            {"entry_at": 3, "exit_at": 4, "net_pnl": -100.0},
            {"entry_at": 5, "exit_at": 6, "net_pnl": -50.0},
            {"entry_at": 7, "exit_at": 8, "net_pnl": 200.0},
        ])
        self.assertEqual(stats["trades"], 4)
        self.assertEqual(stats["win_rate"], 50.0)
        self.assertEqual(stats["net_pnl"], 350.0)
        self.assertEqual(stats["profit_factor"], round(500 / 150, 2))
        self.assertEqual(stats["max_drawdown"], 150.0)


class ExpiryEdgeDeskTests(unittest.TestCase):
    def test_catalog_has_six_unique_algos(self):
        self.assertEqual(len(ALGOS), 6)
        self.assertEqual(len(set(ALGO_KEYS)), 6)
        self.assertEqual(set(EVALUATORS), set(ALGO_KEYS))
        self.assertEqual(set(RULEBOOK), set(ALGO_KEYS))
        self.assertTrue(RETIRED_ALGO_KEYS.isdisjoint(ALGO_KEYS))

    def test_missing_feed_never_qualifies(self):
        engine = ready_engine()
        engine.future.clear()
        result = ExpiryEdgeDesk().evaluate(desk_market(engine), "NIFTY", NOW)
        self.assertFalse(result["ready"])
        self.assertEqual(set(result["algos"]), set(ALGO_KEYS))
        self.assertTrue(all(algo["decision"] == "WAIT" for algo in result["algos"].values()))

    def test_stale_spot_or_futures_ticks_never_show_actionable_signals(self):
        for kind, collection, reason in (
            ("futures", "future", "Waiting for a fresh live futures tick"),
            ("spot", "spot", "Waiting for a fresh live spot tick"),
        ):
            with self.subTest(kind=kind):
                engine = ready_engine()
                ticks = getattr(engine, collection)
                ticks["NIFTY"] = replace(ticks["NIFTY"], at=NOW - 10, received=NOW - 10)
                result = ExpiryEdgeDesk().evaluate(desk_market(engine), "NIFTY", NOW)
                self.assertFalse(result["ready"])
                self.assertEqual(result["reason"], reason)
                self.assertTrue(all(algo["decision"] == "WAIT" for algo in result["algos"].values()))

    def test_unresolved_futures_gap_never_shows_actionable_signals(self):
        market = desk_market(ready_engine())
        market.health_lock = threading.RLock()
        market.gaps = {20: dict(symbol="NIFTY", kind="future", minutes={NOW - 60}, resume_after=None)}

        result = ExpiryEdgeDesk().evaluate(market, "NIFTY", NOW)

        self.assertFalse(result["ready"])
        self.assertEqual(result["reason"], "Futures feed recovery in progress")
        self.assertTrue(all(algo["decision"] == "WAIT" for algo in result["algos"].values()))

    def test_orb_cutoff_checks_candle_close_time(self):
        def time_rule(at):
            features = dict(today=[], today_minutes=[], atr1=None, last={"at": at}, close=1.0, vwap=None)
            return EVALUATORS["orb_retest"](features, None, {})["rules"][-1]["passed"]

        before_cutoff = datetime.fromisoformat("2026-11-10T12:28:00").replace(tzinfo=IST).timestamp()
        at_cutoff = datetime.fromisoformat("2026-11-10T12:29:00").replace(tzinfo=IST).timestamp()
        self.assertTrue(time_rule(before_cutoff))
        self.assertFalse(time_rule(at_cutoff))

    def test_live_engine_evaluation_is_complete_and_json_safe(self):
        result = ExpiryEdgeDesk().evaluate(desk_market(ready_engine()), "NIFTY", NOW)
        self.assertEqual(set(result["algos"]), set(ALGO_KEYS))
        for algo in result["algos"].values():
            self.assertIn(algo["decision"], ("BUY CE", "BUY PE", "WAIT"))
            self.assertIn(algo["status"], ("SATISFIED", "PARTIAL", "NOT_SATISFIED", "MONITORING"))
            self.assertEqual(algo["passed"], sum(rule["passed"] is True for rule in algo["rules"]))
            self.assertFalse(algo["reason"].startswith("Rule evaluation unavailable:"))
            if algo["decision"] != "WAIT":
                self.assertEqual(algo["status"], "SATISFIED")
                self.assertTrue(algo["fresh"])
        json.dumps(result, allow_nan=False)

    def test_order_flow_waits_for_current_session_candles(self):
        previous_day = [
            dict(at=NOW - 86400 + index * 60, open=100, close=110, high=111, low=99,
                 volume=100_000, oi=100_000 + index)
            for index in range(25)
        ]
        today = [
            dict(at=NOW - 60, open=100, close=110, high=111, low=99, volume=10, oi=200_000),
            dict(at=NOW, open=110, close=120, high=121, low=109, volume=100_000, oi=200_100),
        ]
        features = dict(bars=previous_day + today, today=today, last=today[-1], close=today[-1]["close"],
                        rvol=1000)
        live = Mock(buy_depth=1_000, sell_depth=100, bid_quantity=100, ask_quantity=10)

        result = EVALUATORS["order_flow_momentum"](features, live, {})
        rules = {item["id"]: item for item in result["rules"]}

        self.assertIsNone(rules["volume_delta"]["passed"])
        self.assertIsNot(rules["breakout"]["passed"], True)
        self.assertIsNone(rules["relative_volume"]["passed"])
        self.assertIsNone(rules["oi_buildup"]["passed"])

    def test_liquidity_sweep_uses_current_session_for_sweep_and_volume(self):
        previous_day = [
            dict(at=NOW - 86400 + index * 60, open=100, close=100, high=101, low=99,
                 volume=100_000)
            for index in range(40)
        ]
        today = [
            dict(at=NOW - 25 * 60 + index * 60, open=100, close=100, high=101, low=99, volume=10)
            for index in range(25)
        ]
        today[-1].update(close=102, high=103, volume=100)
        features = dict(bars=previous_day + today, today=today, last=today[-1], close=today[-1]["close"],
                        atr1=1, rvol=0.001)
        live = Mock(price=104)

        result = EVALUATORS["liquidity_sweep_bos"](features, live, {})
        rules = {item["id"]: item for item in result["rules"]}

        self.assertIsNone(rules["sweep"]["passed"])
        self.assertTrue(rules["volume"]["passed"])

    def test_failed_breakout_cannot_confirm_from_previous_session(self):
        previous_day = [
            dict(at=NOW - 86400 + index * 60, open=95, close=95, high=100, low=90, volume=100)
            for index in range(40)
        ]
        previous_day[-1].update(high=110, low=100, close=105)
        today = [dict(at=NOW, open=99, close=98, high=100, low=97, volume=100)]
        features = dict(bars=previous_day + today, today=today, last=today[-1], close=today[-1]["close"],
                        rsi1=[65] * 40 + [58])
        live = Mock(price=99)

        result = EVALUATORS["failed_breakout_reversal"](features, live, {})
        rules = {item["id"]: item for item in result["rules"]}

        self.assertIsNone(rules["failed_break"]["passed"])
        self.assertTrue(all(item["passed"] is not True for item in rules.values()))

    def test_volatility_squeeze_uses_latest_pretrigger_five_minute_bar(self):
        closes = [90 if index % 2 == 0 else 110 for index in range(60)]
        closes.extend([100] * 19)
        closes.extend([150, 160])
        m5 = [
            dict(at=index * 300, open=close, high=close + 1, low=close - 1, close=close,
                 volume=100 if index == 80 else 10)
            for index, close in enumerate(closes)
        ]
        features = dict(m5=m5, atr5=1, ema20_5=100, close=160, atr1=1)

        result = EVALUATORS["volatility_expansion"](features, None, {})
        rules = {item["id"]: item for item in result["rules"]}

        self.assertFalse(rules["squeeze"]["passed"])
        self.assertTrue(rules["band_break"]["passed"])

    def test_each_index_uses_its_own_live_ticks_and_candles(self):
        engine = ready_engine()
        base_future = engine.future["NIFTY"]
        base_spot = engine.spot["NIFTY"]
        base_key = ("future", base_future.token, 60)
        base_bars = engine.book.closed[base_key]
        for offset, symbol in enumerate(("BANKNIFTY", "SENSEX"), start=1):
            token = base_future.token + offset
            price_offset = offset * 10_000
            engine.future[symbol] = replace(base_future, symbol=symbol, token=token,
                                            price=base_future.price + price_offset)
            engine.spot[symbol] = replace(base_spot, symbol=symbol, token=base_spot.token + offset,
                                          price=base_spot.price + price_offset)
            key = ("future", token, 60)
            engine.book.closed[key] = [
                {**bar, **{name: bar[name] + price_offset for name in ("open", "high", "low", "close")}}
                for bar in base_bars
            ]
            engine.book.revisions[key] = 1

        desk = ExpiryEdgeDesk()
        market = desk_market(engine)
        for symbol, offset in (("NIFTY", 0), ("BANKNIFTY", 10_000), ("SENSEX", 20_000)):
            with self.subTest(symbol=symbol):
                result = desk.evaluate(market, symbol, NOW)
                self.assertEqual(result["symbol"], symbol)
                self.assertTrue(result["ready"])
                self.assertEqual(set(result["algos"]), set(ALGO_KEYS))
                self.assertEqual(result["context"]["close"], base_bars[-1]["close"] + offset)

    def test_one_algo_evaluation_error_does_not_idle_the_other_algos(self):
        with patch.dict(EVALUATORS, {ALGO: Mock(side_effect=AttributeError("missing feature"))}):
            algos = ExpiryEdgeDesk().evaluate(desk_market(ready_engine()), "NIFTY", NOW)["algos"]

        self.assertEqual(algos[ALGO]["reason"], "Rule evaluation unavailable: AttributeError")
        for key in ALGO_KEYS:
            if key != ALGO:
                with self.subTest(algo=key):
                    self.assertNotEqual(algos[key]["reason"], "Rule evaluation unavailable: AttributeError")

    def test_five_minute_atr_resets_at_session_boundary(self):
        bars = []
        for date, price in (("2026-11-06", 100.0), ("2026-11-09", 200.0)):
            start = datetime.fromisoformat(f"{date}T09:15:00").replace(tzinfo=IST).timestamp()
            bars.extend({
                "at": start + index * 60, "open": price, "high": price + 1,
                "low": price - 1, "close": price, "volume": 100,
            } for index in range(60))

        features = build_features(bars, bars[-1]["at"] + 60)

        self.assertEqual(features["atr5"], 2.0)

    def test_rulebook_matches_each_live_evaluator(self):
        live = ExpiryEdgeDesk().evaluate(desk_market(ready_engine()), "NIFTY", NOW)["algos"]
        self.assertEqual(set(RULEBOOK), set(ALGO_KEYS))
        for key in ALGO_KEYS:
            with self.subTest(algo=key):
                setup, definitions = RULEBOOK[key]
                self.assertEqual(live[key]["context"]["setup"], setup)
                self.assertEqual([(r["id"], r["label"]) for r in live[key]["rules"]],
                                 [(rule_id, label) for rule_id, label, _ in definitions])
                for item, (rule_id, _, requirement) in zip(live[key]["rules"], definitions):
                    if rule_id == "stretch":  # threshold widens from 2.0 to 2.5 sigma when volatile
                        self.assertRegex(item["requirement"], r"^VWAP z-score beyond 2\.[05] sigma within 3 candles$")
                    else:
                        self.assertEqual(item["requirement"], requirement)

    def test_idle_algos_show_their_own_rules_and_never_qualify(self):
        engine = ready_engine()
        engine.future.clear()
        algos = ExpiryEdgeDesk().evaluate(desk_market(engine), "NIFTY", NOW)["algos"]
        rulesets = set()
        for key in ALGO_KEYS:
            algo = algos[key]
            self.assertEqual((algo["decision"], algo["status"], algo["side"], algo["passed"]),
                             ("WAIT", "MONITORING", None, 0))
            self.assertEqual(algo["context"]["setup"], RULEBOOK[key][0])
            self.assertEqual([r["id"] for r in algo["rules"]], [d[0] for d in RULEBOOK[key][1]])
            self.assertEqual(algo["total"], len(algo["rules"]))
            self.assertTrue(all(r["passed"] is None and r["value"] is None for r in algo["rules"]))
            self.assertEqual(algo["reason"], "Waiting for the live futures feed")
            rulesets.add(tuple(r["label"] for r in algo["rules"]))
        self.assertEqual(len(rulesets), len(ALGO_KEYS))

    def test_setup_key_is_unique_per_algo_trigger_and_side(self):
        evaluation = {"trigger_at": NOW - 60.4, "side": "PE"}
        self.assertEqual(setup_key(ALGO, "SENSEX", evaluation), f"EXPIRYEDGE:{ALGO}:SENSEX:{int(NOW - 60.4)}:PE")
        self.assertNotEqual(setup_key(ALGO, "SENSEX", evaluation), setup_key(OTHER, "SENSEX", evaluation))


class ExpiryEdgeLaneTests(unittest.TestCase):
    setUp = test_aqte_live.LiveTests.setUp
    new_service = test_aqte_live.LiveTests.new_service
    place = test_aqte_live.LiveTests.place
    modify = test_aqte_live.LiveTests.modify

    def enable(self, algo=ALGO):
        return self.live.set_expiryedge_algo(algo, True)

    def test_defaults_off_and_manual_on_resets_off_after_restart(self):
        self.assertFalse(any(self.live.state["expiryedge"]["algos"].values()))
        self.assertEqual(set(self.live.state["expiryedge"]["algos"]), set(ALGO_KEYS))
        self.enable()
        self.live.release_owner()
        restored = self.new_service()
        restored.initialize()
        self.addCleanup(restored.release_owner)
        self.assertFalse(restored.state["expiryedge"]["algos"][ALGO])
        self.assertFalse(restored.state["expiryedge"]["algos"][OTHER])

    def test_invalid_saved_configuration_blocks_startup(self):
        self.live.state["expiryedge"]["algos"]["unknown"] = True
        self.live.save("TEST_CORRUPT")
        self.live.release_owner()
        restored = self.new_service()
        with self.assertRaisesRegex(LiveBlocked, "Invalid 6 Algo Desk configuration"):
            restored.initialize()
        restored.release_owner()

    def test_retired_algo_approvals_are_discarded_without_losing_trade_history(self):
        retired = "multi_timeframe_momentum"
        self.live.state["expiryedge"]["algos"][retired] = True
        self.live.state["trades"].append({"id": "historical-xea", "owner": "EXPIRYEDGE", "algo": retired})
        self.live.save("TEST_LEGACY_CATALOG")
        self.live.release_owner()
        restored = self.new_service()
        restored.initialize()
        self.addCleanup(restored.release_owner)
        self.assertEqual(set(restored.state["expiryedge"]["algos"]), set(ALGO_KEYS))
        self.assertFalse(any(restored.state["expiryedge"]["algos"].values()))
        self.assertEqual(restored.state["trades"][0]["id"], "historical-xea")

    def test_enable_validates_input_and_arms_through_broker_preflight(self):
        with self.assertRaisesRegex(LiveBlocked, "Unknown"):
            self.live.set_expiryedge_algo("nope", True)
        with self.assertRaisesRegex(LiveBlocked, "explicit boolean"):
            self.live.set_expiryedge_algo(ALGO, 1)
        status = self.enable()
        self.assertTrue(status["armed"])
        self.assertEqual(self.live.state["armed_day"], day(NOW))
        self.assertFalse(self.live.state["automation_on"])
        self.assertIsNone(status["lane_owner"])
        self.assertTrue(next(algo for algo in status["algos"] if algo["key"] == ALGO)["enabled"])
        self.broker.place_order.assert_not_called()
        json.dumps(status, allow_nan=False)
        self.assertEqual(status["symbol"], "NIFTY")
        self.assertEqual(self.live.set_expiryedge_algo(OTHER, False, "SENSEX")["symbol"], "SENSEX")

    def test_automation_approval_does_not_claim_slot_until_a_trade_is_open(self):
        self.enable()
        self.live.state["automation_on"] = True
        self.live.state["automation_wanted"] = True
        self.assertIsNone(self.live.expiryedge_status()["lane_owner"])
        self.assertIsNone(self.live.expiryedge_reason(NOW))

    def test_enable_refused_when_live_switch_is_off(self):
        self.cfg = settings(aqte_live_enabled=False)
        with self.assertRaisesRegex(LiveBlocked, "LIVE_TRADE_ENABLED"):
            self.enable()
        self.assertFalse(self.live.state["expiryedge"]["algos"][ALGO])

    def test_owners_can_be_enabled_independently_but_share_one_active_trade_slot(self):
        self.enable()
        self.assertTrue(self.live.start_automation()["automation_on"])
        self.assertTrue(self.live.set_quantedge_approval(True)["enabled"])
        self.assertTrue(self.live.set_expiryedge_algo(OTHER, True)["any_enabled"])

        self.live.state["active"] = {"owner": "AQTE"}
        self.live.automated_entry()
        self.live.automated_quantedge_entry()
        self.live.automated_expiryedge_entry()
        self.broker.place_order.assert_not_called()
        self.assertIn("Shared live trade slot is managing AQTE", self.live.expiryedge_reason(NOW))
        self.assertEqual(self.live.expiryedge_status()["lane_owner"], "AQTE")

    def test_confirm_places_one_lot_with_xea_tag_and_records_algo(self):
        self.enable()
        proposal = proposal_for()
        self.live.proposals[proposal["id"]] = copy.deepcopy(proposal)
        rechecks = [{**proposal, "id": "recheck-1"}, {**proposal, "id": "recheck-2"}]
        with patch.object(self.live, "expiryedge_proposal", side_effect=rechecks) as recheck:
            self.live.confirm(proposal["id"])
        recheck.assert_called_with("NIFTY", ALGO, set())
        params = self.broker.place_order.call_args.kwargs
        self.assertRegex(params["tag"], r"^XEA[0-9a-f]{13}E$")
        self.assertEqual((params["quantity"], params["validity"], params["order_type"]),
                         (CONTRACT.lot_size, "IOC", "LIMIT"))
        active = self.live.state["active"]
        self.assertEqual((active["owner"], active["algo"]), ("EXPIRYEDGE", ALGO))
        self.assertEqual(active["daily_loss_limit"], self.cfg.aqte_live_daily_loss)
        self.assertEqual(self.live.state["daily_entries"][-1]["algo"], ALGO)
        self.assertIn(proposal["setup_key"], self.live.state["used"])
        # AQTE's controller view never shows the 6 Algo Desk trade as its own.
        self.assertIsNone(self.live.status()["active"])
        self.assertEqual(self.live.expiryedge_status()["active"]["id"], active["id"])

    def test_manual_exit_turns_off_only_the_owning_algo(self):
        self.enable()
        self.enable(OTHER)
        proposal = proposal_for()
        self.live.proposals[proposal["id"]] = copy.deepcopy(proposal)
        with patch.object(self.live, "expiryedge_proposal",
                          side_effect=[{**proposal, "id": "a"}, {**proposal, "id": "b"}]):
            self.live.confirm(proposal["id"])
        active = self.live.state["active"]
        active.update(filled=CONTRACT.lot_size, entry_price=99)
        with self.assertRaisesRegex(LiveBlocked, "no longer active"):
            self.live.request_expiryedge_exit("XEA" + "0" * 13)
        self.live.request_expiryedge_exit(active["id"])
        self.assertEqual(active["exit_requested"], "MANUAL_EXIT")
        self.assertEqual(self.live.request_expiryedge_exit(active["id"], "BANKNIFTY")["symbol"], "BANKNIFTY")
        self.assertFalse(self.live.state["expiryedge"]["algos"][ALGO])
        self.assertTrue(self.live.state["expiryedge"]["algos"][OTHER])

    def test_status_journal_shows_real_side_exit_and_algo_performance(self):
        self.live.state["trades"].append(dict(
            id="XEA" + "c" * 13, owner="EXPIRYEDGE", algo=ALGO, symbol="NIFTY", contract=asdict(CONTRACT),
            entry_at=NOW - 600, exit_at=NOW - 300, entry_price=100.0, exit_price=140.0, filled=CONTRACT.lot_size,
            net_pnl=1150.0, exit_requested=None, stop=90.0, target=140.0, initial_stop=80.0,
            execution_context={"strategy_name": "Test Algo", "reason": "All rules passed",
                               "rules": [{"label": "Confirmation", "passed": True, "value": "close held"}]}))
        status = self.live.expiryedge_status("NIFTY")
        self.assertEqual(set(status["signals_by_symbol"]), {"NIFTY", "BANKNIFTY", "SENSEX"})
        self.assertEqual(status["signals"], status["signals_by_symbol"]["NIFTY"])
        for symbol in ("NIFTY", "BANKNIFTY", "SENSEX"):
            self.assertEqual(set(status["signals_by_symbol"][symbol]), set(ALGO_KEYS))
        row = status["trades"][0]
        self.assertEqual((row["side"], row["trading_symbol"], row["algo"]),
                         (CONTRACT.side, CONTRACT.trading_symbol, ALGO))
        self.assertEqual(row["entry_context"], {
            "strategy_name": "Test Algo", "reason": "All rules passed",
            "rules": [{"label": "Confirmation", "passed": True, "value": "close held"}],
        })
        algo = next(item for item in status["algos"] if item["key"] == ALGO)
        self.assertEqual((algo["today"]["trades"], algo["today"]["net_pnl"]), (1, 1150.0))
        self.assertEqual(next(item for item in status["algos"] if item["key"] == OTHER)["today"]["trades"], 0)
        self.assertEqual(status["account"]["expiryedge_pnl_today"], 1150.0)
        json.dumps(status, allow_nan=False)

    def test_prior_day_loss_remains_in_week_history_but_not_today_pnl(self):
        yesterday = datetime(2026, 10, 29, 10, 0, tzinfo=IST).timestamp()
        today = datetime(2026, 10, 30, 10, 0, tzinfo=IST).timestamp()
        for trade_id, entry_at, pnl in (("yesterday", yesterday, -984.0), ("today", today, 200.0)):
            self.live.state["trades"].append(dict(
                id=trade_id, owner="EXPIRYEDGE", algo=ALGO, symbol="NIFTY", contract=asdict(CONTRACT),
                entry_at=entry_at, exit_at=entry_at + 60, entry_price=100.0, exit_price=100.0,
                filled=CONTRACT.lot_size, net_pnl=pnl, exit_requested=None, stop=90.0, target=120.0,
                initial_stop=90.0, execution_context={},
            ))

        status = self.live.expiryedge_status("NIFTY")
        algo = next(item for item in status["algos"] if item["key"] == ALGO)
        self.assertEqual((algo["today"]["trades"], algo["today"]["net_pnl"]), (1, 200.0))
        self.assertEqual((algo["week"]["trades"], algo["week"]["net_pnl"]), (2, -784.0))
        self.assertEqual(status["account"]["expiryedge_pnl_today"], 200.0)
        self.assertEqual(len(status["trades"]), 2)

    def test_emergency_stop_turns_every_algo_off(self):
        self.enable()
        self.enable(OTHER)
        self.live.stop_entries()
        self.assertFalse(any(self.live.state["expiryedge"]["algos"].values()))
        with self.assertRaisesRegex(LiveBlocked, "Emergency stop"):
            self.enable()

    def test_per_algo_daily_limit_blocks_a_third_entry(self):
        self.enable()
        for index in range(2):
            self.live.state["daily_entries"].append(dict(id=f"x{index}", owner="EXPIRYEDGE", algo=ALGO,
                                                         symbol="NIFTY", at=NOW - 100, filled=True, pending=False))
        with self.assertRaisesRegex(EntrySkipped, "daily trade limit"):
            self.live.expiryedge_proposal("NIFTY", ALGO, set())

    def test_scan_submits_qualified_signal_through_confirm(self):
        self.enable()
        self.live.expiryedge.evaluate = Mock(side_effect=lambda market, symbol, now: (
            qualified() if symbol == "NIFTY" else idle_evaluation(symbol)))
        with patch.object(self.live, "expiryedge_proposal", return_value=proposal_for()) as propose, patch.object(
            self.live, "confirm"
        ) as confirm:
            self.live.scan_expiryedge()
        propose.assert_called_once_with("NIFTY", ALGO, set())
        confirm.assert_called_once_with("approved")
        record = self.live.opportunities[setup_key(ALGO, "NIFTY", qualified()["algos"][ALGO])]
        self.assertEqual((record["owner"], record["algo"], record["state"]), ("EXPIRYEDGE", ALGO, "ACCEPTED"))

    def test_scan_skip_records_rejection_and_cools_down(self):
        self.enable()
        self.live.expiryedge.evaluate = Mock(side_effect=lambda market, symbol, now: (
            qualified() if symbol == "NIFTY" else idle_evaluation(symbol)))
        with patch.object(self.live, "expiryedge_proposal", side_effect=EntrySkipped("Ask moved")) as propose:
            self.live.scan_expiryedge()
            self.live.expiryedge_scanned_at = 0.0
            self.live.scan_expiryedge()
        self.assertEqual(propose.call_count, 1)
        self.assertTrue(self.live.state["expiryedge"]["algos"][ALGO])
        record = self.live.opportunities[setup_key(ALGO, "NIFTY", qualified()["algos"][ALGO])]
        self.assertEqual((record["state"], record["reason"]), ("REJECTED", "Ask moved"))

    def test_scan_ignores_algos_that_are_off(self):
        self.enable(OTHER)
        self.live.expiryedge.evaluate = Mock(return_value=qualified(ALGO))
        with patch.object(self.live, "expiryedge_proposal") as propose:
            self.live.scan_expiryedge()
        propose.assert_not_called()

    def test_account_limit_idles_without_broker_reads(self):
        self.enable()
        self.live.state["trades"] = [{"entry_at": NOW - 100 * index, "net_pnl": 10.0, "symbol": "NIFTY"}
                                     for index in range(1, self.cfg.aqte_live_max_trades + 1)]
        self.live.expiryedge.evaluate = Mock(return_value=qualified())
        self.broker.orders.reset_mock()
        self.live.scan_expiryedge()
        self.broker.orders.assert_not_called()
        self.live.expiryedge.evaluate.assert_not_called()
        self.assertIn("daily live trade limit", self.live.expiryedge_reason(NOW))

    def test_guard_refusal_holds_entries_but_keeps_standing_on(self):
        self.enable()
        with patch.object(self.live, "automated_expiryedge_entry",
                          side_effect=LiveBlocked("Broker account identity changed")):
            self.live.scan_expiryedge()
        self.assertTrue(self.live.state["expiryedge"]["algos"][ALGO])
        self.assertGreater(self.live.expiryedge_hold_until, NOW)
        self.assertIn("Broker account identity changed", self.live.expiryedge_waiting)

    def test_repeated_unexpected_scan_errors_fail_safe_to_off(self):
        self.enable()
        with patch.object(self.live, "automated_expiryedge_entry", side_effect=RuntimeError("bug")), \
                self.assertLogs("services.aqte_live", "ERROR"):
            for _ in range(EXPIRYEDGE_MAX_FAILURES - 1):
                self.live.scan_expiryedge()
                self.assertTrue(self.live.state["expiryedge"]["algos"][ALGO])
            self.live.scan_expiryedge()
        self.assertFalse(any(self.live.state["expiryedge"]["algos"].values()))
        self.assertIn("RuntimeError", self.live.expiryedge_status()["error"])


class AlgoDeskRouterTests(unittest.TestCase):
    def setUp(self):
        from routers.algo_desk import router
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)
        self.headers = {"Origin": "http://localhost:3000", "X-Device-Id": "test-device",
                        "X-AQTE-Intent": "manual-live-control"}

    def call(self, method, path, **kwargs):
        controller = Mock()
        controller.expiryedge_status.return_value = {"ok": True}
        controller.set_expiryedge_algo.return_value = {"ok": True}
        controller.request_expiryedge_exit.return_value = {"ok": True}
        with patch("routers.algo_desk.get_live_service", return_value=controller), patch(
            "routers.aqte.get_settings", return_value=settings()
        ), patch("routers.aqte.app_access_service.validate_session", new_callable=AsyncMock) as session:
            session.return_value = {"authenticated": True, "username": "admin"}
            response = getattr(self.client, method)(path, **kwargs)
        return response, controller

    def test_desk_api_is_separate_from_expiryedge(self):
        from routers.expiryedge import router as expiryedge_router
        self.assertFalse([route.path for route in expiryedge_router.routes if "/algos" in route.path])
        self.assertEqual(self.call("get", "/api/expiryedge/algos/status", headers=self.headers)[0].status_code, 404)

    def test_status_requires_live_intent_and_is_not_cached(self):
        response, _ = self.call("get", "/api/algo-desk/status")
        self.assertEqual(response.status_code, 403)
        response, controller = self.call("get", "/api/algo-desk/status?symbol=SENSEX", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "no-store")
        controller.expiryedge_status.assert_called_once_with("SENSEX")

    def test_approval_requires_matching_typed_confirmation(self):
        body = {"algo": ALGO, "enabled": True, "confirmation": "STOP ALGO DESK ENTRIES"}
        response, controller = self.call("post", "/api/algo-desk/approval", headers=self.headers, json=body)
        self.assertEqual(response.status_code, 422)
        controller.set_expiryedge_algo.assert_not_called()
        for bad in ({**body, "algo": "unknown"}, {**body, "enabled": "true"}, {**body, "extra": 1}):
            response, controller = self.call("post", "/api/algo-desk/approval", headers=self.headers, json=bad)
            self.assertEqual(response.status_code, 422)
            controller.set_expiryedge_algo.assert_not_called()
        body["confirmation"] = "ENABLE ALGO DESK LIVE TRADING"
        response, controller = self.call("post", "/api/algo-desk/approval", headers=self.headers, json=body)
        self.assertEqual(response.status_code, 200)
        controller.set_expiryedge_algo.assert_called_once_with(ALGO, True, "NIFTY")
        response, controller = self.call("post", "/api/algo-desk/approval", headers=self.headers,
                                         json={**body, "symbol": "SENSEX"})
        self.assertEqual(response.status_code, 200)
        controller.set_expiryedge_algo.assert_called_once_with(ALGO, True, "SENSEX")
        response, controller = self.call("post", "/api/algo-desk/approval", headers=self.headers,
                                         json={**body, "symbol": "FINNIFTY"})
        self.assertEqual(response.status_code, 422)
        controller.set_expiryedge_algo.assert_not_called()

    def test_exit_accepts_only_xea_trade_ids(self):
        body = {"trade_id": "QEP" + "a" * 13, "confirmation": "CLOSE ALGO DESK TRADE"}
        response, controller = self.call("post", "/api/algo-desk/exit", headers=self.headers, json=body)
        self.assertEqual(response.status_code, 422)
        controller.request_expiryedge_exit.assert_not_called()
        body["trade_id"] = "XEA" + "a" * 13
        response, controller = self.call("post", "/api/algo-desk/exit", headers=self.headers, json=body)
        self.assertEqual(response.status_code, 200)
        controller.request_expiryedge_exit.assert_called_once_with(body["trade_id"], None)
        response, controller = self.call("post", "/api/algo-desk/exit", headers=self.headers,
                                         json={**body, "symbol": "BANKNIFTY"})
        self.assertEqual(response.status_code, 200)
        controller.request_expiryedge_exit.assert_called_once_with(body["trade_id"], "BANKNIFTY")


if __name__ == "__main__":
    unittest.main()
