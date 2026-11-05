import copy
import json
import math
import os
import sqlite3
import tempfile
import threading
import unittest
from contextlib import closing
from dataclasses import replace
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.aqte_live import ENTRY_RETRY_SECONDS, MARKET_WAIT, AQTELiveService, LiveBlocked
from services.aqte_engine import AQTEEngine, Policy
from test_aqte import CONTRACT, IST, NOW, START, ready_engine, scalp_info, tick


def settings(**overrides):
    values = dict(aqte_live_enabled=True, aqte_live_paper_validated=True,
                  aqte_live_static_ip="122.177.245.101", aqte_live_allow_unvalidated_rules=False,
                  aqte_live_risk_per_trade=500,
                  aqte_live_daily_loss=2000, aqte_live_max_trades=5, aqte_live_max_losses=3,
                  force_outbound_ipv4=True, algo_auto_trade_enabled=False, algo_auto_trade_mode="paper",
                  frontend_url="http://localhost:3000", cors_origins="http://localhost:3000",
                  app_access_username="admin")
    values.update(overrides)
    return SimpleNamespace(**values)


class LiveTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "live.sqlite3"
        self.clock = patch("services.aqte_live.time.time", return_value=NOW)
        self.clock.start()
        self.addCleanup(self.clock.stop)
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.cfg = settings()
        self.orders = []
        self.positions = []
        self.broker = Mock()
        self.broker.profile.return_value = {"user_id": "TEST_ACCOUNT"}
        self.broker.orders.side_effect = lambda: copy.deepcopy(self.orders)
        self.broker.positions.side_effect = lambda: {"net": copy.deepcopy(self.positions)}
        self.broker.margins.return_value = {"available": {"cash": 100_000}}
        self.broker.quote.side_effect = lambda keys: {
            keys[0]: {"instrument_token": CONTRACT.token, "last_price": 99,
                      "timestamp": datetime.fromtimestamp(NOW, IST), "volume": 100_000,
                      "depth": {"buy": [{"price": 98, "quantity": 100}],
                                "sell": [{"price": 99, "quantity": 100}]}}}
        self.market = Mock()
        self.market.lock = threading.RLock()
        self.market.engine = ready_engine()
        self.market.snapshot.side_effect = lambda: self.market.engine.snapshot(NOW) | {"recording": True}
        self.market.started = True
        self.market.failed = threading.Event()
        self.ip = Mock(return_value="122.177.245.101")
        self.live = self.new_service()
        self.live.initialize()
        # Execution tests isolate broker mechanics from the new quality policy.
        for control in self.live.state["daily_controls"].values():
            control["enabled"] = True
            control["style"] = "swing"
        self.quality = patch("services.aqte_live.quality_reason", return_value=None)
        self.quality.start()
        self.addCleanup(self.quality.stop)
        self.addCleanup(self.live.release_owner)
        self.broker.place_order.side_effect = self.place
        self.broker.modify_order.side_effect = self.modify

    def new_service(self):
        return AQTELiveService(self.path, self.market, lambda: self.cfg,
                               lambda: self.broker, self.ip)

    def place(self, **params):
        order_id = str(len(self.orders) + 1)
        self.orders.append({
            **params, "order_id": order_id, "status": "OPEN", "filled_quantity": 0,
            "average_price": 0, "instrument_token": CONTRACT.token, "status_message": None,
        })
        return order_id

    def modify(self, **params):
        for order in self.orders:
            if order["order_id"] == params["order_id"]:
                order.update(params)
                return params["order_id"]
        raise ValueError("Missing test order")

    def armed(self):
        self.live.preflight()
        self.live.arm()
        self.live.set_automation(True)

    def enter(self, filled=None, price=99):
        self.armed()
        proposal = self.live.proposal("NIFTY")
        self.live.confirm(proposal["id"])
        filled = CONTRACT.lot_size if filled is None else filled
        self.orders[0].update(status="COMPLETE" if filled == CONTRACT.lot_size else "CANCELLED",
                              filled_quantity=filled, average_price=price)
        self.positions = [{"instrument_token": CONTRACT.token, "product": "MIS", "quantity": filled,
                           "exchange": CONTRACT.exchange, "tradingsymbol": CONTRACT.trading_symbol, "last_price": 99}]
        return proposal

    def protect(self, filled=None):
        self.enter(filled=filled)
        self.live.reconcile()
        self.orders[1].update(status="TRIGGER PENDING")
        self.live.reconcile()

    def test_default_configuration_blocks_live_before_network(self):
        self.cfg.aqte_live_enabled = False
        with self.assertRaisesRegex(LiveBlocked, "AQTE_LIVE_ENABLED"):
            self.live.preflight()
        self.ip.assert_not_called()
        self.broker.place_order.assert_not_called()
        self.cfg.aqte_live_enabled = True
        self.cfg.aqte_live_paper_validated = False
        with self.assertRaisesRegex(LiveBlocked, "Paper validation"):
            self.live.preflight()

    def test_analysis_signal_with_real_lot_still_obeys_live_risk_cap(self):
        self.market.engine = ready_engine(contract=replace(CONTRACT, lot_size=65), paper_enabled=False)
        self.assertEqual(self.market.engine.signals["NIFTY"]["decision"], "BUY CE")
        self.armed()
        with self.assertRaisesRegex(LiveBlocked, "per-trade risk limit"):
            self.live.proposal("NIFTY")
        self.broker.place_order.assert_not_called()
        self.live.state["daily_controls"]["NIFTY"]["stop_percent"] = 5
        proposal = self.live.proposal("NIFTY")
        self.assertLessEqual(proposal["risk"], self.cfg.aqte_live_risk_per_trade)
        self.assertEqual(proposal["entry"]["quantity"], 65)

    def scalping(self):
        engine = ready_engine(contract=replace(CONTRACT, lot_size=65), paper_enabled=False)
        info = scalp_info(volume_ratio=2.5, imbalance=0.3, atr=20)
        engine.signals["NIFTY"]["scalp"] = engine.scalp_signal("NIFTY", info, NOW, engine.spot["NIFTY"])
        self.assertEqual(engine.signals["NIFTY"]["scalp"]["strategy"], "quick_scalp_30")
        self.market.engine = engine
        self.live.state["daily_controls"]["NIFTY"]["style"] = "scalp"

    def both_styles(self):
        self.quality.stop()
        self.scalping()
        self.cfg.aqte_live_allow_unvalidated_rules = True
        self.cfg.aqte_live_risk_per_trade = 1000
        control = self.live.state["daily_controls"]["NIFTY"]
        control.update(style="both", stop_percent=5)
        signal = self.market.engine.signals["NIFTY"]
        signal.update(strategy="momentum_breakout", confidence=85,
                      intelligence=scalp_info(volume_ratio=2.5, imbalance=0.3, atr=20, sweep=0, live={"price": 106}))
        return signal

    def test_both_styles_select_the_best_qualified_entry_for_every_index_and_side_without_broker_calls(self):
        from test_aqte_daily_control import mirror

        base = self.both_styles()
        before = copy.deepcopy(base)
        for symbol in ("NIFTY", "BANKNIFTY", "SENSEX"):
            self.live.state["daily_controls"][symbol].update(style="both", stop_percent=5)
            for side in ("CE", "PE"):
                signal = copy.deepcopy(base)
                signal["symbol"] = symbol
                signal["decision"] = signal["scalp"]["decision"] = f"BUY {side}"
                signal["contract"].update(symbol=symbol, side=side)
                signal["scalp"]["contract"].update(symbol=symbol, side=side)
                if side == "PE":
                    signal["intelligence"] = mirror(signal["intelligence"])
                with self.subTest(symbol=symbol, side=side):
                    selected = self.live.select_entry(symbol, signal)
                    self.assertEqual(selected["style_checks"], {"scalp": None, "swing": None})
                    self.assertEqual(selected["style"], "swing", "Higher-scored qualified swing wins")
                    signal["scalp"]["confidence"] = 90
                    selected = self.live.select_entry(symbol, signal)
                    self.assertEqual(selected["style"], "scalp")
                    self.assertEqual(selected["signal"]["contract"]["side"], side)
                    self.assertLessEqual(selected["check"][1]["risk"], 1000)
                    self.assertGreaterEqual(selected["check"][1]["reward_risk"], 1.5)
        self.assertEqual(base, before, "Selection never mutates the engine's signals")
        self.assertFalse(self.broker.mock_calls)

    def test_both_styles_fall_back_when_the_higher_score_fails_rules_risk_or_setup_switch(self):
        signal = self.both_styles()
        control = self.live.state["daily_controls"]["NIFTY"]
        for patch_control, patch_signal, expected in (
            ({"stop_percent": 20}, {}, "per-trade risk"),
            ({}, {"intelligence": {**signal["intelligence"], "cpr": None}}, "CPR"),
            ({"setups": dict.fromkeys(control["setups"], False)}, {}, "OFF in Controls"),
        ):
            saved = copy.deepcopy(control)
            control.update(patch_control)
            selected = self.live.select_entry("NIFTY", {**signal, **patch_signal})
            self.assertEqual(selected["style"], "scalp")
            self.assertIsNone(selected["style_checks"]["scalp"])
            self.assertIn(expected, selected["style_checks"]["swing"])
            control.update(saved)
        weak_scalp = {**signal, "scalp": {**signal["scalp"], "confidence": 95,
                      "entry": {**signal["scalp"]["entry"], "points_allowed": [1000]}}}
        selected = self.live.select_entry("NIFTY", weak_scalp)
        self.assertEqual(selected["style"], "swing", "A failing higher-scored scalp must not hide a valid swing")
        self.assertIsNotNone(selected["style_checks"]["scalp"])
        self.assertIsNone(selected["style_checks"]["swing"])
        self.assertFalse(self.broker.mock_calls)

    def test_both_style_status_controls_proposal_and_order_agree_and_never_enter_twice(self):
        self.both_styles()
        self.armed()
        for style, score in (("swing", 85), ("scalp", 65)):
            self.market.engine.signals["NIFTY"]["confidence"] = score
            status = self.live.status()
            controls = self.live.daily_controls()["data"]["NIFTY"]
            proposal = self.live.proposal("NIFTY")
            self.assertEqual(status["styles"]["NIFTY"], style)
            self.assertEqual(controls["opportunity"]["style"], style)
            self.assertEqual(status["style_checks"]["NIFTY"], {
                "scalp": None, "swing": None if style == "swing" else "Rule score below 75/100; do not trade"})
            plan = status["entry_plans"]["NIFTY"]
            self.assertEqual(controls["opportunity"]["entry"], plan)
            self.assertEqual((plan["maximum"], plan["stop"], plan["target"]),
                             tuple(proposal["entry"][key] for key in ("maximum", "stop", "target")))
            self.assertEqual(proposal["strategy"].startswith("quick_scalp"), style == "scalp")
        self.live.automated_entry()
        self.live.automated_entry()
        self.assertEqual(self.broker.place_order.call_count, 1)
        self.assertEqual(self.live.state["active"]["strategy"], "quick_scalp_30")
        self.assertEqual(self.live.status()["entry_scan"]["styles"]["NIFTY"], "scalp")

    def test_confirmation_does_not_send_an_obsolete_style_when_the_best_candidate_changes(self):
        self.both_styles()
        self.armed()
        proposal = self.live.proposal("NIFTY")
        self.market.engine.signals["NIFTY"]["confidence"] = 65
        with self.assertRaisesRegex(LiveBlocked, "Signal or entry levels changed"):
            self.live.confirm(proposal["id"])
        self.broker.place_order.assert_not_called()

    def test_both_styles_never_bypass_shared_limits_switches_or_engine_veto(self):
        signal = self.both_styles()
        control = self.live.state["daily_controls"]["NIFTY"]
        for enabled, maximum, veto, expected in (
            (False, 5, False, "disabled"), (True, 1, False, "trade limit"),
            (True, 5, True, "Engine conflict"),
        ):
            control.update(enabled=enabled, max_trades=maximum)
            self.live.state["daily_entries"] = [dict(id="prior", symbol="NIFTY", at=NOW - 600, filled=True)]
            value = {**signal, "orchestration": {"ce": 1, "pe": 5} if veto else None}
            selected = self.live.select_entry("NIFTY", value)
            self.assertTrue(all(expected in reason for reason in selected["style_checks"].values()))
            self.assertIsNotNone(selected["check"][0])
        self.assertFalse(self.broker.mock_calls)

    def test_unchecked_styles_block_entries_and_saved_choices_survive_restart(self):
        self.both_styles()
        control = copy.deepcopy(self.live.state["daily_controls"]["NIFTY"])
        self.live.update_control("NIFTY", {**control, "style": "none"})
        status = self.live.status()
        self.assertIsNone(status["styles"]["NIFTY"])
        self.assertIsNone(status["entry_plans"]["NIFTY"])
        self.assertIn("No entry style", status["entry_blocks"]["NIFTY"])
        self.assertEqual(status["style_checks"]["NIFTY"], {})
        self.assertEqual(self.live.effective("NIFTY", self.market.engine.signals["NIFTY"])["decision"], "WAIT")
        self.live.update_control("BANKNIFTY", {**control, "style": "both"})
        self.live.release_owner()
        restored = self.new_service()
        restored.initialize()
        self.addCleanup(restored.release_owner)
        self.assertEqual(restored.state["daily_controls"]["NIFTY"]["style"], "none")
        self.assertEqual(restored.state["daily_controls"]["BANKNIFTY"]["style"], "both")
        self.assertTrue(all(restored.state["daily_controls"]["BANKNIFTY"]["setups"].values()))
        self.broker.place_order.assert_not_called()

    def test_status_entry_plan_matches_the_levels_the_controller_sends(self):
        self.scalping()
        self.armed()
        signal = self.market.engine.signals["NIFTY"]["scalp"]
        self.assertEqual(signal["entry"]["points"], 30, "raw engine signal shows the uncapped 30-point tier")
        plan = self.live.status()["entry_plans"]["NIFTY"]
        sent = self.live.proposal("NIFTY")
        self.assertEqual((plan["maximum"], plan["stop"], plan["target"], plan["points"]), (
            sent["entry"]["maximum"], sent["entry"]["stop"], sent["entry"]["target"], 10))
        self.assertEqual(plan["risk"], sent["risk"])
        self.live.state["daily_controls"]["NIFTY"]["enabled"] = False
        self.assertIsNone(self.live.status()["entry_plans"]["NIFTY"])

    def test_scalp_style_downsizes_target_tier_to_risk_cap_and_buys_ioc_at_the_ask(self):
        self.scalping()
        self.armed()
        small = self.live.proposal("NIFTY")
        self.assertEqual((small["strategy"], small["entry"]["stop"], small["entry"]["target"]), ("quick_scalp_10", 97, 111))
        self.assertLessEqual(small["risk"], 500)
        self.cfg.aqte_live_risk_per_trade = 1000
        self.live.automated_entry()
        params = self.broker.place_order.call_args.kwargs
        self.assertEqual((params["order_type"], params["validity"], params["price"], params["quantity"]),
                         ("LIMIT", "IOC", 101, 65))
        active = self.live.state["active"]
        self.assertEqual((active["strategy"], active["stop"], active["target"]), ("quick_scalp_30", 89, 131))
        self.assertTrue(self.live.state["used"][-1].startswith("NIFTY:quick_scalp:"))
        self.assertIsNone(self.live.status()["entry_note"])
        self.assertEqual(self.live.status()["styles"], {"NIFTY": "scalp", "BANKNIFTY": "swing", "SENSEX": "swing"})

    def test_scalp_waits_when_no_tier_fits_the_risk_cap(self):
        self.scalping()
        self.cfg.aqte_live_risk_per_trade = 300
        self.armed()
        self.live.automated_entry()
        self.broker.place_order.assert_not_called()
        self.assertTrue(self.live.status()["automation_on"])
        self.assertIn("No quick-scalp tier", self.live.status()["entry_note"])

    def test_confirm_uses_rechecked_tier_when_risk_cap_falls(self):
        self.scalping()
        self.cfg.aqte_live_risk_per_trade = 1000
        self.armed()
        proposal = self.live.proposal("NIFTY")
        self.assertEqual(proposal["entry"]["points"], 30)
        self.cfg.aqte_live_risk_per_trade = 500
        self.live.confirm(proposal["id"])
        active = self.live.state["active"]
        self.assertEqual((active["strategy"], active["stop"], active["target"]),
                         ("quick_scalp_10", 97, 111))
        risk = (active["limit"] - active["stop"]) * active["quantity"] + self.live.costs(
            active["limit"], active["quantity"]) + self.live.costs(active["stop"], active["quantity"])
        self.assertLessEqual(risk, 500)

    def test_confirm_never_increases_previously_approved_risk(self):
        self.scalping()
        self.armed()
        proposal = self.live.proposal("NIFTY")
        self.cfg.aqte_live_risk_per_trade = 1000
        with self.assertRaisesRegex(LiveBlocked, "risk"):
            self.live.confirm(proposal["id"])
        self.broker.place_order.assert_not_called()

    def test_legacy_controls_select_everything_once_preserving_risk_and_positions_but_requiring_new_approval(self):
        self.enter()
        active = copy.deepcopy(self.live.state["active"])
        entries = copy.deepcopy(self.live.state["daily_entries"])
        self.live.state.pop("daily_controls_version")
        for i, control in enumerate(self.live.state["daily_controls"].values()):
            control.update(enabled=False, style="scalp", min_confidence=90 + i * 5, max_trades=3 + i,
                           stop_percent=10, target_rr=3, daily_loss=1500)
            control["setups"] = dict.fromkeys(control["setups"], False)
        self.live.save("LEGACY_TEST_STATE")
        self.live.release_owner()
        self.broker.reset_mock()
        restored = self.new_service()
        restored.initialize()
        self.addCleanup(restored.release_owner)
        for i, control in enumerate(restored.state["daily_controls"].values()):
            self.assertTrue(control["enabled"])
            self.assertEqual(control["style"], "both")
            self.assertTrue(all(control["setups"].values()))
            self.assertEqual(control["min_confidence"], 75)
            self.assertEqual((control["max_trades"], control["stop_percent"], control["target_rr"],
                              control["daily_loss"]), (3 + i, 10, 3, 1500))
        self.assertIsNone(restored.state["armed_day"])
        self.assertFalse(restored.state["automation_on"])
        self.assertFalse(restored.state["automation_wanted"])
        self.assertEqual(restored.state["active"], active)
        self.assertEqual(restored.state["daily_entries"], entries)
        self.assertEqual(restored.state["daily_controls_version"], 1)
        with closing(sqlite3.connect(str(self.path))) as db:
            row = db.execute("SELECT payload FROM live_audit WHERE kind='RESTART_DISARMED' ORDER BY id DESC").fetchone()
            self.assertTrue(json.loads(row[0])["daily_controls_migrated"])
        self.assertFalse(self.broker.mock_calls)

    def test_legacy_controls_missing_style_or_setups_gain_all_choices_and_keep_75_to_80_scores(self):
        self.live.state.pop("daily_controls_version")
        for i, control in enumerate(self.live.state["daily_controls"].values()):
            control["min_confidence"] = 75 + i * 2
            control.pop("style")
            control.pop("setups")
        self.live.save("LEGACY_TEST_STATE")
        self.live.release_owner()
        restored = self.new_service()
        restored.initialize()
        self.addCleanup(restored.release_owner)
        for i, control in enumerate(restored.state["daily_controls"].values()):
            self.assertTrue(control["enabled"])
            self.assertEqual(control["style"], "both")
            self.assertTrue(all(control["setups"].values()))
            self.assertEqual(control["min_confidence"], 75 + i * 2)

    def test_swing_trades_the_best_enabled_same_side_setup_when_the_engine_pick_is_off(self):
        setups = [dict(name="trend_continuation", side="CE", score=73, passed=True),
                  dict(name="liquidity_reversal", side="PE", score=75, passed=True),
                  dict(name="mean_reversion", side="CE", score=72, passed=False),
                  dict(name="momentum_breakout", side="CE", score=70, passed=True)]
        signal = dict(decision="BUY CE", strategy="trend_continuation", confidence=73,
                      reasons=["trend continuation", "EMA aligned"], setups=setups, scalp={})
        control = self.live.state["daily_controls"]["NIFTY"]
        control["setups"] = dict(momentum_breakout=True, trend_continuation=False,
                                 liquidity_reversal=True, mean_reversion=True)
        swapped = self.live.effective("NIFTY", signal)
        self.assertEqual((swapped["strategy"], swapped["confidence"], swapped["reasons"]),
                         ("momentum_breakout", 70, ["momentum breakout", "EMA aligned"]))
        self.assertEqual(signal["strategy"], "trend_continuation", "The engine signal is never mutated")
        control["setups"]["momentum_breakout"] = False
        self.assertIs(self.live.effective("NIFTY", signal), signal, "Opposite-side or failing setups never swap in")
        control["setups"]["trend_continuation"] = True
        self.assertIs(self.live.effective("NIFTY", signal), signal)
        self.assertEqual(self.live.effective("NIFTY", {**signal, "decision": "WAIT"})["decision"], "WAIT")
        control["style"] = "scalp"
        self.assertEqual(self.live.effective("NIFTY", signal)["decision"], "WAIT", "Scalp ignores swing setups")

    def test_status_reports_configured_trail_start_per_index(self):
        self.live.state["daily_controls"]["BANKNIFTY"]["trail_start_r"] = 1.5
        self.assertEqual(self.live.status()["trail_starts"], {"NIFTY": 1, "BANKNIFTY": 1.5, "SENSEX": 1})

    def test_status_publishes_swing_setup_switches_for_the_ui_mirror(self):
        self.live.state["daily_controls"]["SENSEX"]["setups"]["mean_reversion"] = True
        published = self.live.status()["swing_setups"]
        self.assertEqual(published["NIFTY"], dict(momentum_breakout=True, trend_continuation=True,
                                                  liquidity_reversal=True, mean_reversion=True))
        self.assertTrue(published["SENSEX"]["mean_reversion"])
        published["NIFTY"]["trend_continuation"] = False
        self.assertTrue(self.live.state["daily_controls"]["NIFTY"]["setups"]["trend_continuation"],
                         "Status is a copy; it never changes the controls")

    def test_status_reports_entry_blockers_without_broker_requests(self):
        self.scalping()
        self.armed()
        self.cfg.aqte_live_risk_per_trade = 300
        self.broker.reset_mock()
        self.assertIn("No quick-scalp tier", self.live.status()["entry_blocks"]["NIFTY"])
        self.assertIn("No quick-scalp tier", self.live.daily_controls()["data"]["NIFTY"]["reason"])
        self.assertEqual(self.broker.mock_calls, [])
        self.cfg.aqte_live_risk_per_trade = 1000
        self.live.state["daily_controls"]["NIFTY"]["enabled"] = False
        self.assertEqual(self.live.status()["entry_blocks"]["NIFTY"], "Index auto trading disabled")
        self.live.state["daily_controls"]["NIFTY"]["enabled"] = True
        self.cfg.aqte_live_static_ip = "invalid"
        self.assertIn("AQTE_LIVE_STATIC_IP", self.live.status()["entry_blocks"]["NIFTY"])
        self.assertEqual(self.broker.mock_calls, [])

    def test_real_indicators_through_live_entry_protection_and_target_for_each_scalp_tier(self):
        self.quality.stop()
        self.cfg.aqte_live_allow_unvalidated_rules = True
        self.cfg.aqte_live_risk_per_trade = 1000
        for points in (10, 20, 30):
            for side, direction in (("CE", 1), ("PE", -1)):
                with self.subTest(points=points, side=side):
                    self.live.release_owner()
                    self.path = Path(self.directory.name) / f"flow-{points}-{side}.sqlite3"
                    self.live = self.new_service()
                    self.live.initialize()
                    self.addCleanup(self.live.release_owner)
                    self.live.state["daily_controls"]["NIFTY"]["enabled"] = True
                    self.orders.clear()
                    self.positions.clear()
                    engine = AQTEEngine(Policy(scalp_points={"NIFTY": (points / 2, points)}), paper_enabled=False)
                    engine.contracts[30] = replace(CONTRACT, lot_size=65, side=side,
                                                   trading_symbol=f"NIFTY_TEST_{side}")
                    bars = []
                    for i in range(202):
                        close = 22000 + i * 0.2 + 30 * math.sin(i * 0.7)
                        bars.append(dict(at=START + i * 60, open=close - 1, high=close + 4,
                                         low=close - 4, close=close, volume=1000))
                    bars[-1].update(close=max(b["high"] for b in bars[-21:-1]) + 1, volume=3000)
                    bars[-1]["high"] = bars[-1]["close"] + 1
                    if direction < 0:
                        bars = [{**b, "open": 44000 - b["open"], "close": 44000 - b["close"],
                                 "high": 44000 - b["low"], "low": 44000 - b["high"]} for b in bars]
                    engine.seed_bars(20, bars, NOW)
                    engine.ingest(tick("spot", price=bars[-1]["close"]))
                    engine.ingest(tick("option"))
                    engine.ingest(tick(price=bars[-1]["close"],
                                       buy_depth=700 if direction > 0 else 300,
                                       sell_depth=300 if direction > 0 else 700))
                    self.market.engine = engine
                    signal = engine.signals["NIFTY"]["scalp"]
                    self.assertEqual(signal["decision"], f"BUY {side}", signal["reasons"])
                    self.assertGreaterEqual(signal["confidence"], 75)
                    self.assertEqual(signal["entry"]["points"], points)
                    self.assertFalse(engine.orders, "No paper execution participates in the live path")
                    self.armed()
                    self.live.automated_entry()
                    self.assertEqual(len(self.orders), 1)
                    self.assertEqual((self.orders[0]["price"], self.orders[0]["validity"]), (101, "IOC"))
                    self.orders[0].update(status="COMPLETE", filled_quantity=65, average_price=101)
                    self.positions = [{"instrument_token": 30, "product": "MIS", "quantity": 65}]
                    self.live.reconcile()
                    self.assertEqual(self.orders[1]["order_type"], "SL")
                    self.orders[1].update(status="TRIGGER PENDING")
                    self.live.reconcile()
                    target = 101 + points
                    engine.options[30] = tick("option", price=target, bid=target, ask=target + 0.05)
                    self.live.reconcile()
                    self.assertEqual(self.live.state["active"]["exit_requested"], "TARGET")
                    self.orders[1].update(status="COMPLETE", filled_quantity=65, average_price=target)
                    self.positions[0]["quantity"] = 0
                    self.live.reconcile()
                    self.assertIsNone(self.live.state["active"])
                    self.assertEqual(len(self.orders), 2, "Exit modifies the existing stop, not a second SELL")
                    self.assertGreater(self.live.state["trades"][0]["net_pnl"], 0)

    def test_transient_no_chase_skip_keeps_automation_on_and_retries_after_backoff(self):
        self.scalping()
        self.cfg.aqte_live_risk_per_trade = 1000
        self.armed()
        normal = self.broker.quote.side_effect
        raw = normal(["test"])["test"]
        raw["depth"]["sell"][0]["price"] = 110
        self.broker.quote.side_effect = lambda keys: {keys[0]: raw}
        self.live.automated_entry()
        self.broker.place_order.assert_not_called()
        status = self.live.status()
        self.assertTrue(status["automation_on"])
        self.assertTrue(status["armed"])
        self.assertIn("NIFTY: Fresh broker ask", status["entry_note"])
        self.assertFalse(self.live.state["used"], "A skipped entry never consumes the setup")
        self.broker.quote.side_effect = normal
        calls = self.broker.quote.call_count
        self.live.automated_entry()
        self.assertEqual(self.broker.quote.call_count, calls, "Backoff avoids hammering the broker")
        with patch("services.aqte_live.time.time", return_value=NOW + ENTRY_RETRY_SECONDS):
            self.live.automated_entry()
        self.assertEqual(self.broker.place_order.call_args.kwargs["price"], 101)
        self.assertIsNone(self.live.status()["entry_note"])

    def test_daily_controls_save_only_while_off_persist_and_never_arm(self):
        config = {**self.live.state["daily_controls"]["NIFTY"], "max_trades": 3, "min_confidence": 78}
        result = self.live.update_control("NIFTY", config)
        self.assertEqual(result["data"]["NIFTY"]["config"]["max_trades"], 3)
        self.assertFalse(self.live.status()["automation_on"])
        self.broker.place_order.assert_not_called()
        self.armed()
        with self.assertRaisesRegex(LiveBlocked, "OFF"):
            self.live.update_control("NIFTY", config)
        self.live.set_automation(False)
        self.live.release_owner()
        restored = self.new_service()
        restored.initialize()
        self.addCleanup(restored.release_owner)
        self.assertEqual(restored.state["daily_controls"]["NIFTY"]["min_confidence"], 78)
        self.assertFalse(restored.status()["automation_on"])

    def test_limits_reserve_uncertain_entries_count_partial_once_and_reset_by_ist_day(self):
        from services.aqte_daily_control import counts
        self.live.state["daily_controls"]["NIFTY"]["max_trades"] = 1
        self.enter(filled=5)
        self.assertEqual(counts(self.live.state, NOW, "NIFTY"), {"executed": 0, "reserved": 1})
        self.live.reconcile()
        self.assertEqual(counts(self.live.state, NOW, "NIFTY"), {"executed": 1, "reserved": 0})
        self.assertIn("limit reached", self.live.control_reason("NIFTY", {}))
        self.assertEqual(counts(self.live.state, NOW + 86400, "NIFTY"), {"executed": 0, "reserved": 0})

    def test_confirmed_unfilled_cancel_releases_reserved_slot_without_executed_trade(self):
        from services.aqte_daily_control import counts
        self.enter(filled=0)
        self.live.reconcile()
        self.assertIsNone(self.live.state["active"])
        self.assertEqual(counts(self.live.state, NOW), {"executed": 0, "reserved": 0})

    def test_unknown_entry_reservation_survives_restart_and_indices_have_independent_counts(self):
        from services.aqte_daily_control import counts
        self.armed()
        proposal = self.live.proposal("NIFTY")
        self.broker.place_order.side_effect = TimeoutError("Unknown broker outcome")
        self.live.confirm(proposal["id"])
        self.live.release_owner()
        restored = self.new_service()
        restored.initialize()
        self.addCleanup(restored.release_owner)
        self.assertEqual(counts(restored.state, NOW, "NIFTY"), {"executed": 0, "reserved": 1})
        self.assertEqual(counts(restored.state, NOW, "BANKNIFTY"), {"executed": 0, "reserved": 0})
        self.assertFalse(restored.status()["automation_on"])

    def test_index_disabled_quality_gate_and_global_cap_do_not_force_quota(self):
        self.armed()
        self.live.state["daily_controls"]["NIFTY"]["enabled"] = False
        self.live.automated_entry()
        self.broker.place_order.assert_not_called()
        self.live.state["daily_controls"]["NIFTY"]["enabled"] = True
        self.quality.stop()
        self.live.automated_entry()
        self.broker.place_order.assert_not_called()
        self.assertIn("below 75/100", self.live.control_reason("NIFTY", self.market.snapshot()["data"]["NIFTY"]))
        self.live.state["daily_entries"] = [
            dict(id=str(i), symbol="BANKNIFTY", at=NOW, filled=True, pending=False) for i in range(5)]
        self.assertIn("Account-wide", self.live.control_reason("NIFTY", {}))

    def test_strongest_eligible_index_is_selected_first_and_disabled_index_is_skipped(self):
        self.armed()
        snapshot = self.market.snapshot()
        base = snapshot["data"]["NIFTY"]
        snapshot["data"] = {
            symbol: {**base, "confidence": score} for symbol, score in
            (("NIFTY", 91), ("BANKNIFTY", 98), ("SENSEX", 95))}
        self.market.snapshot.side_effect = lambda: snapshot
        self.live.state["daily_controls"]["BANKNIFTY"]["enabled"] = False
        with patch.object(self.live, "proposal", return_value={"id": "test"}) as proposal, patch.object(
            self.live, "confirm"
        ) as confirm:
            self.live.automated_entry()
            proposal.assert_called_once_with("SENSEX")
            confirm.assert_called_once_with("test")
        self.broker.place_order.assert_not_called()

    def test_same_contract_cooldown_and_nearly_identical_prices_are_rejected(self):
        signal = self.market.snapshot()["data"]["NIFTY"]
        self.live.state["daily_entries"] = [
            dict(id="old", symbol="NIFTY", at=NOW - 301, filled=True, pending=False,
                 token=CONTRACT.token, price=signal["entry"]["maximum"])]
        self.assertIn("near-identical", self.live.control_reason("NIFTY", signal))
        signal["entry"]["maximum"] *= 1.02
        self.assertIsNone(self.live.control_reason("NIFTY", signal))
        self.live.state["daily_entries"][0]["at"] = NOW - 299
        self.assertIn("Duplicate", self.live.control_reason("NIFTY", signal))

    def test_remaining_index_budget_skips_candidate_and_checks_next_index(self):
        self.armed()
        snapshot = self.market.snapshot()
        base = snapshot["data"]["NIFTY"]
        snapshot["data"] = {
            symbol: {**base, "symbol": symbol, "confidence": score}
            for symbol, score in (("NIFTY", 98), ("BANKNIFTY", 95))}
        self.market.snapshot.side_effect = lambda: snapshot
        self.live.state["daily_controls"]["NIFTY"]["daily_loss"] = 100
        self.broker.reset_mock()
        with patch.object(self.live, "confirm") as confirm:
            self.live.automated_entry()
        confirm.assert_called_once()
        proposal = self.live.proposals[confirm.call_args.args[0]]
        self.assertEqual(proposal["symbol"], "BANKNIFTY")
        status = self.live.status()
        self.assertIn("remaining daily index loss budget", status["entry_blocks"]["NIFTY"])
        self.assertTrue(status["armed"])
        self.assertTrue(status["automation_on"])
        self.broker.place_order.assert_not_called()

    def test_invalid_one_tick_levels_skip_index_without_fault_stopping_automation(self):
        self.armed()
        snapshot = self.market.snapshot()
        base = snapshot["data"]["NIFTY"]
        tiny = copy.deepcopy(base)
        tiny["entry"].update(maximum=0.05, high=0.05, low=0.05)
        snapshot["data"] = {"NIFTY": {**tiny, "confidence": 98},
                            "BANKNIFTY": {**copy.deepcopy(base), "symbol": "BANKNIFTY", "confidence": 95}}
        self.market.snapshot.side_effect = lambda: snapshot
        for symbol in ("NIFTY", "BANKNIFTY"):
            self.live.state["daily_controls"][symbol]["style"] = "swing"
        with patch.object(self.live, "confirm") as confirm:
            self.live.automated_entry()
        self.assertEqual(self.live.proposals[confirm.call_args.args[0]]["symbol"], "BANKNIFTY")
        status = self.live.status()
        self.assertIn("Premium too small", status["entry_blocks"]["NIFTY"])
        self.assertTrue(status["automation_on"])

    def test_remaining_account_budget_is_visible_before_broker_checks(self):
        self.armed()
        self.live.state["trades"] = [
            dict(id="loss", symbol="SENSEX", entry_at=NOW - 600, exit_at=NOW - 300, net_pnl=-1900)]
        self.broker.reset_mock()
        self.live.automated_entry()
        status = self.live.status()
        self.assertIn("remaining daily live loss budget", status["entry_blocks"]["NIFTY"])
        self.assertTrue(status["automation_on"])
        self.assertFalse(self.broker.mock_calls, "Known budget failures must not spend broker requests")

    def test_status_explains_consumed_setups_and_transient_retry_without_broker_calls(self):
        self.armed()
        signal = self.market.snapshot()["data"]["NIFTY"]
        self.live.state["used"].append(self.live.setup_key("NIFTY", signal))
        self.broker.reset_mock()
        self.assertIn("already submitted", self.live.status()["entry_blocks"]["NIFTY"])
        self.live.state["used"].clear()
        self.live.skip_until["NIFTY"] = NOW + ENTRY_RETRY_SECONDS
        self.assertIn("retry cooldown", self.live.status()["entry_blocks"]["NIFTY"])
        with patch("services.aqte_live.time.time", return_value=NOW + ENTRY_RETRY_SECONDS):
            self.assertIsNone(self.live.status()["entry_blocks"]["NIFTY"])
        self.assertFalse(self.broker.mock_calls)

    def test_entry_scans_audit_index_blockers_at_most_once_per_minute(self):
        self.armed()
        for control in self.live.state["daily_controls"].values():
            control["enabled"] = False
        self.broker.reset_mock()
        self.live.automated_entry()
        scan = self.live.status()["entry_scan"]
        self.assertEqual(scan["at"], NOW)
        self.assertEqual(scan["blocks"]["NIFTY"], "Index auto trading disabled")
        self.assertEqual(scan["styles"]["NIFTY"], "swing")
        with patch("services.aqte_live.time.time", return_value=NOW + 59):
            self.live.automated_entry()
        self.assertEqual(self.live.status()["entry_scan"]["at"], NOW + 59)
        with closing(sqlite3.connect(str(self.path))) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM live_audit WHERE kind='ENTRY_SCAN'").fetchone()[0], 1)
        with patch("services.aqte_live.time.time", return_value=NOW + 60):
            self.live.automated_entry()
        with closing(sqlite3.connect(str(self.path))) as db:
            rows = db.execute("SELECT payload FROM live_audit WHERE kind='ENTRY_SCAN' ORDER BY id").fetchall()
        self.assertEqual(len(rows), 2)
        self.assertEqual(json.loads(rows[0][0])["blocks"], scan["blocks"])
        self.assertFalse(self.broker.mock_calls)

    def test_entry_scan_journal_reports_transient_skip_without_consuming_setup(self):
        self.scalping()
        self.cfg.aqte_live_risk_per_trade = 300
        self.armed()
        self.live.automated_entry()
        scan = self.live.status()["entry_scan"]
        self.assertIn("No quick-scalp tier", scan["blocks"]["NIFTY"])
        with closing(sqlite3.connect(str(self.path))) as db:
            row = db.execute("SELECT payload FROM live_audit WHERE kind='ENTRY_SCAN'").fetchone()
        self.assertEqual(json.loads(row[0])["blocks"], scan["blocks"])
        self.assertTrue(self.live.state["automation_on"])
        self.assertFalse(self.live.state["used"])
        self.broker.place_order.assert_not_called()

    def test_custom_stop_target_and_trail_are_copied_into_new_trade_only(self):
        config = {**self.live.state["daily_controls"]["NIFTY"],
                  "stop_percent": 10, "target_rr": 3, "trail_start_r": 2, "daily_loss": 500}
        self.live.update_control("NIFTY", config)
        self.armed()
        proposal = self.live.proposal("NIFTY")
        self.assertEqual(proposal["entry"]["stop"], 90)
        self.assertEqual(proposal["entry"]["target"], 130)
        self.live.confirm(proposal["id"])
        self.assertEqual(self.live.state["active"]["trail_start_r"], 2)
        self.live.set_automation(False)
        self.live.update_control("NIFTY", {**config, "stop_percent": 20})
        self.assertEqual(self.live.state["active"]["initial_stop"], 90)

    def test_limit_can_be_saved_while_on_below_used_count_without_changing_protection(self):
        self.protect()
        active = copy.deepcopy(self.live.state["active"])
        calls = self.broker.place_order.call_count
        response = self.live.update_limit("NIFTY", 1)
        row = response["data"]["NIFTY"]
        self.assertEqual((row["executed"], row["remaining"], row["config"]["max_trades"]), (1, 0, 1))
        self.assertEqual(row["status"], "LIMIT REACHED")
        self.assertTrue(response["limits_editable"])
        self.assertFalse(response["editable"])
        self.assertTrue(self.live.status()["automation_on"])
        self.assertEqual(self.live.state["active"], active)
        self.assertEqual(self.broker.place_order.call_count, calls)
        response = self.live.update_limit("BANKNIFTY", 3)
        self.assertEqual(response["data"]["BANKNIFTY"]["config"]["max_trades"], 3)
        self.assertEqual(response["data"]["NIFTY"]["config"]["max_trades"], 1)
        self.assertEqual(response["account"]["max_trades"], 5)
        self.live.release_owner()
        restored = self.new_service()
        restored.initialize()
        self.addCleanup(restored.release_owner)
        self.assertEqual(restored.state["daily_controls"]["NIFTY"]["max_trades"], 1)

    def test_position_status_uses_cached_quote_remaining_quantity_and_no_broker_calls(self):
        self.protect()
        self.market.engine.options[CONTRACT.token] = tick("option", bid=120, ask=121, price=121)
        self.live.state["active"]["exited"] = 5
        self.broker.reset_mock()
        status = self.live.status()
        metrics = status["active"]["metrics"]
        quantity = CONTRACT.lot_size - 5
        self.assertEqual(metrics["quantity"], quantity)
        self.assertEqual(metrics["points"], 21)
        self.assertEqual(metrics["gross_pnl"], 21 * quantity)
        self.assertEqual(metrics["ltp"], 121)
        self.assertTrue(status["active"]["protection_confirmed"])
        self.broker.orders.assert_not_called()
        self.broker.quote.assert_not_called()
        self.broker.place_order.assert_not_called()
        self.assertNotIn("metrics", self.live.state["active"])
        self.market.failed.set()
        self.assertIsNone(self.live.status()["active"]["metrics"]["net_pnl"])
        self.assertTrue(self.live.status()["active"]["metrics"]["stale"])

    def test_ip_mismatch_proxy_and_other_algo_block_arming(self):
        self.ip.return_value = "8.8.8.8"
        with self.assertRaisesRegex(LiveBlocked, "does not match"):
            self.live.preflight()
        self.assertIsNone(self.live.check)
        self.ip.return_value = "122.177.245.101"
        with patch.dict(os.environ, {"HTTPS_PROXY": "http://localhost:1234"}):
            with self.assertRaisesRegex(LiveBlocked, "Proxy"):
                self.live.preflight()
        self.cfg.algo_auto_trade_enabled, self.cfg.algo_auto_trade_mode = True, "live"
        with self.assertRaisesRegex(LiveBlocked, "other live algo"):
            self.live.preflight()
        self.broker.place_order.assert_not_called()

    def test_selected_exit_pauses_entries_and_only_reprices_its_existing_stop(self):
        self.protect()
        active = self.live.state["active"]
        trade_id = active["id"]
        self.positions.append({"instrument_token": 999, "product": "MIS", "quantity": 10})
        self.broker.reset_mock()
        result = self.live.request_exit(trade_id)
        self.assertEqual(result["active"]["exit_requested"], "MANUAL_EXIT")
        self.assertFalse(result["automation_on"])
        self.assertFalse(result["automation_wanted"], "Manual exit switches standing ON off")
        self.assertFalse(result["killed"])
        self.assertFalse(result["flatten_pending"])
        self.assertTrue(result["armed"])
        self.broker.modify_order.assert_not_called()
        self.live.request_exit(trade_id)
        self.live.reconcile()
        self.broker.modify_order.assert_called_once()
        self.assertEqual(self.broker.modify_order.call_args.kwargs["order_id"], active["protect_id"])
        self.assertEqual(self.broker.modify_order.call_args.kwargs["order_type"], "LIMIT")
        self.broker.place_order.assert_not_called()
        self.broker.cancel_order.assert_not_called()
        self.orders[1].update(status="OPEN")
        self.live.reconcile()
        self.assertFalse(self.live.status()["active"]["protection_confirmed"])
        self.broker.modify_order.assert_called_once()

    def test_selected_exit_rejects_wrong_trade_pending_fill_and_emergency(self):
        with self.assertRaisesRegex(LiveBlocked, "no longer active"):
            self.live.request_exit("a" * 16)
        self.enter()
        active = self.live.state["active"]
        with self.assertRaisesRegex(LiveBlocked, "confirmed remaining fill"):
            self.live.request_exit(active["id"])
        self.live.reconcile()
        with self.assertRaisesRegex(LiveBlocked, "no longer active"):
            self.live.request_exit("b" * 16)
        self.assertIsNone(active["exit_requested"])
        self.assertTrue(self.live.state["automation_on"])
        self.live.state["killed"] = True
        with self.assertRaisesRegex(LiveBlocked, "emergency"):
            self.live.request_exit(active["id"])

    def test_selected_exit_persists_and_preserves_stop_when_quote_or_mutation_is_uncertain(self):
        self.protect()
        trade_id = self.live.state["active"]["id"]
        self.live.request_exit(trade_id)
        self.live.release_owner()
        restored = self.new_service()
        restored.initialize()
        self.addCleanup(restored.release_owner)
        self.assertEqual(restored.state["active"]["exit_requested"], "MANUAL_EXIT")
        self.market.failed.set()
        restored.reconcile()
        self.broker.modify_order.assert_not_called()
        self.assertIn("Broker stop remains", restored.status()["active"]["error"])
        self.market.failed.clear()
        self.broker.modify_order.side_effect = TimeoutError("Unknown exit outcome")
        with self.assertRaises(TimeoutError):
            restored.reconcile()
        with self.assertRaisesRegex(LiveBlocked, "modification outcome unresolved"):
            restored.reconcile()
        self.broker.modify_order.assert_called_once()
        self.assertEqual(len(self.orders), 2)

    def test_status_includes_all_today_trades_counts_and_current_generation_time(self):
        self.live.state["trades"] = [
            {"id": str(n), "entry_at": NOW, "exit_at": NOW, "net_pnl": n, "symbol": "NIFTY"}
            for n in range(25)
        ]
        self.live.state["daily_entries"] = [
            {"id": "0", "at": NOW, "symbol": "NIFTY", "filled": True, "pending": False},
            {"id": "two", "at": NOW, "symbol": "BANKNIFTY", "filled": False, "pending": True},
        ]
        result = self.live.status()
        self.assertEqual(len(result["trades"]), 25)
        self.assertEqual(result["generated_at"], NOW)
        self.assertEqual(result["daily_counts"], {"executed": 25, "reserved": 1})
        self.broker.orders.assert_not_called()

    def test_preflight_only_then_explicit_arm_then_expiring_confirm(self):
        self.live.preflight()
        self.broker.place_order.assert_not_called()
        with self.assertRaisesRegex(LiveBlocked, "OFF"):
            self.live.proposal("NIFTY")
        self.live.arm()
        self.live.set_automation(True)
        proposal = self.live.proposal("NIFTY")
        self.broker.place_order.assert_not_called()
        with patch("services.aqte_live.time.time", return_value=NOW + 16):
            with self.assertRaisesRegex(LiveBlocked, "expired"):
                self.live.confirm(proposal["id"])
        self.broker.place_order.assert_not_called()

    def test_confirm_places_exactly_one_lot_ioc_limit_with_persisted_tag_and_no_duplicate(self):
        self.armed()
        proposal = self.live.proposal("NIFTY")
        self.live.confirm(proposal["id"])
        params = self.broker.place_order.call_args.kwargs
        self.assertEqual((params["quantity"], params["validity"], params["order_type"]),
                         (CONTRACT.lot_size, "IOC", "LIMIT"))
        self.assertEqual(params["price"], proposal["entry"]["maximum"])
        self.assertEqual(params["transaction_type"], "BUY")
        self.assertLessEqual(len(params["tag"]), 20)
        with self.assertRaisesRegex(LiveBlocked, "already used"):
            self.live.confirm(proposal["id"])
        self.assertEqual(self.broker.place_order.call_count, 1)
        self.assertEqual(self.live.pins()[CONTRACT.token], CONTRACT)

    def test_entry_timeout_reconciles_tag_without_ever_resubmitting(self):
        self.armed()
        proposal = self.live.proposal("NIFTY")
        def accepted_timeout(**params):
            self.place(**params)
            raise TimeoutError("Simulated response loss")
        self.broker.place_order.side_effect = accepted_timeout
        self.live.confirm(proposal["id"])
        self.assertFalse(self.live.status()["armed"])
        self.live.reconcile()
        self.assertEqual(self.live.state["active"]["entry_id"], "1")
        self.assertEqual(self.broker.place_order.call_count, 1)

    def test_unknown_order_not_found_never_retries(self):
        self.armed()
        proposal = self.live.proposal("NIFTY")
        self.broker.place_order.side_effect = TimeoutError("No response")
        self.live.confirm(proposal["id"])
        for _ in range(2):
            with self.assertRaisesRegex(LiveBlocked, "no tagged order"):
                self.live.reconcile()
        self.assertEqual(self.broker.place_order.call_count, 1)

    def test_partial_fill_waits_terminal_entry_then_protects_actual_quantity(self):
        self.enter(filled=5)
        self.live.reconcile()
        params = self.broker.place_order.call_args.kwargs
        self.assertEqual((params["transaction_type"], params["quantity"], params["order_type"]),
                         ("SELL", 5, "SL"))
        self.assertEqual(params["trigger_price"], self.live.state["active"]["stop"])
        self.assertLess(params["price"], params["trigger_price"])
        self.orders[1]["status"] = "TRIGGER PENDING"
        self.live.reconcile()
        self.assertEqual(self.live.state["active"]["state"], "PROTECTED")

    def test_pending_partial_entry_cancel_once_no_sell_until_terminal(self):
        self.enter(filled=5)
        self.orders[0]["status"] = "OPEN"
        self.live.reconcile()
        self.live.reconcile()
        self.broker.cancel_order.assert_called_once()
        self.assertEqual(self.broker.place_order.call_count, 1)
        self.orders[0]["status"] = "CANCELLED"
        self.live.reconcile()
        self.assertEqual(self.broker.place_order.call_count, 2)

    def test_stop_ack_not_visible_never_creates_duplicate_sell(self):
        self.enter()
        self.live.reconcile()
        self.orders.pop()
        with self.assertRaisesRegex(LiveBlocked, "Protective order outcome unknown"):
            self.live.reconcile()
        self.assertEqual(self.broker.place_order.call_count, 2)

    def test_protection_timeout_recovers_tag_and_rejected_stop_surfaces(self):
        self.enter()
        def accepted_timeout(**params):
            order_id = self.place(**params)
            self.orders[-1]["status"] = "TRIGGER PENDING"
            raise TimeoutError(order_id)
        self.broker.place_order.side_effect = accepted_timeout
        with self.assertRaises(TimeoutError):
            self.live.reconcile()
        self.live.reconcile()
        self.assertEqual(self.live.state["active"]["protect_id"], "2")
        self.assertEqual(self.broker.place_order.call_count, 2)
        self.orders[1]["status"] = "REJECTED"
        with self.assertRaisesRegex(LiveBlocked, "REJECTED"):
            self.live.reconcile()
        self.assertEqual(self.broker.place_order.call_count, 2)

    def test_target_modifies_existing_sell_and_records_actual_broker_fill(self):
        self.protect()
        target = self.live.state["active"]["target"]
        self.market.engine.options[CONTRACT.token] = tick("option", bid=target + 1, ask=target + 2, price=target + 1)
        self.live.reconcile()
        self.assertEqual(self.broker.place_order.call_count, 2)
        params = self.broker.modify_order.call_args.kwargs
        self.assertEqual((params["order_id"], params["order_type"]), ("2", "LIMIT"))
        self.orders[1].update(status="COMPLETE", filled_quantity=CONTRACT.lot_size, average_price=target + 0.5)
        self.positions[0]["quantity"] = 0
        self.live.reconcile()
        self.assertIsNone(self.live.state["active"])
        self.assertEqual(self.live.state["trades"][0]["exit_price"], target + 0.5)
        self.assertGreater(self.live.state["trades"][0]["net_pnl"], 0)

    def test_trailing_modifies_existing_protection_not_another_order(self):
        self.protect()
        old_stop = self.live.state["active"]["stop"]
        self.market.engine.options[CONTRACT.token] = tick("option", bid=121, ask=122, price=121)
        self.live.reconcile()
        params = self.broker.modify_order.call_args.kwargs
        self.assertEqual(params["order_type"], "SL")
        self.assertGreater(params["trigger_price"], old_stop)
        self.assertEqual(self.broker.place_order.call_count, 2)
        self.assertEqual(self.live.state["active"]["stop"], old_stop, "Do not claim an unconfirmed trigger")
        self.live.reconcile()
        self.assertEqual(self.live.state["active"]["stop"], params["trigger_price"])
        self.assertTrue(self.live.state["active"]["trailing_active"])
        self.assertEqual(self.broker.modify_order.call_count, 1, "A breakeven trail must not cause a premature exit")

    def test_trailing_never_loosens_on_pullback_and_runs_while_off(self):
        self.protect()
        self.live.set_automation(False)
        self.market.engine.options[CONTRACT.token] = tick("option", bid=110, ask=111, price=110)
        self.live.reconcile()
        self.broker.modify_order.assert_not_called()
        self.market.engine.options[CONTRACT.token] = tick("option", bid=125, ask=126, price=125)
        self.live.reconcile()
        raised = self.broker.modify_order.call_args.kwargs["trigger_price"]
        self.live.reconcile()
        self.assertEqual(self.live.state["active"]["stop"], raised)
        self.market.engine.options[CONTRACT.token] = tick("option", bid=120, ask=121, price=120)
        self.live.reconcile()
        self.assertEqual(self.live.state["active"]["stop"], raised)
        self.assertEqual(self.broker.modify_order.call_count, 1)
        self.assertEqual(self.broker.place_order.call_count, 2)

    def test_legacy_trade_trails_at_one_r_not_the_current_controls_setting(self):
        self.protect()
        active = self.live.state["active"]
        active.pop("trail_start_r", None)
        self.live.state["daily_controls"]["NIFTY"]["trail_start_r"] = 3
        entry, risk = active["entry_price"], active["entry_price"] - active["initial_stop"]
        for bid in (entry + risk - CONTRACT.tick_size, entry + risk):
            self.market.engine.options[CONTRACT.token] = tick("option", bid=bid, ask=bid + 1, price=bid)
            self.live.reconcile()
            if bid < entry + risk:
                self.broker.modify_order.assert_not_called()
        self.broker.modify_order.assert_called_once()
        self.assertEqual(self.broker.modify_order.call_args.kwargs["order_type"], "SL")
        self.assertEqual(self.live.status()["trail_starts"]["NIFTY"], 3)
        self.assertNotIn("trail_start_r", self.live.status()["active"])

    def test_trend_to_target_stays_within_kite_modification_cap_and_still_exits(self):
        # Kite rejects the 26th modification of an order; the exit must never be stranded.
        self.protect()
        active = self.live.state["active"]
        entry, risk, target = active["entry_price"], active["entry_price"] - active["initial_stop"], active["target"]
        kite_modify = self.modify
        def capped(**params):
            if self.broker.modify_order.call_count > 25:
                raise RuntimeError("Maximum allowed order modifications exceeded")
            return kite_modify(**params)
        self.broker.modify_order.side_effect = capped
        bid, stops = entry + risk, []
        while bid < target:
            self.market.engine.options[CONTRACT.token] = tick("option", bid=bid, ask=bid + 0.05, price=bid)
            self.live.reconcile()
            stops.append(self.live.state["active"]["stop"])
            bid = round(bid + 0.05, 2)
        self.assertEqual(stops, sorted(stops), "The stop must only ever tighten")
        self.assertGreaterEqual(stops[-1], target - risk * 1.2, "Trail must keep following the trend")
        trail_modifications = self.broker.modify_order.call_count
        self.assertLessEqual(trail_modifications, 20, "Trailing must reserve modifications for the exit")
        self.market.engine.options[CONTRACT.token] = tick("option", bid=target, ask=target + 0.05, price=target)
        self.live.reconcile()
        params = self.broker.modify_order.call_args.kwargs
        self.assertEqual((params["order_type"], self.live.state["active"]["exit_requested"]), ("LIMIT", "TARGET"))
        self.assertEqual(self.broker.modify_order.call_count, trail_modifications + 1)
        self.assertEqual(self.broker.place_order.call_count, 2)

    def test_marketable_exit_limit_is_not_re_modified_and_cap_fails_closed(self):
        self.protect()
        target = self.live.state["active"]["target"]
        self.market.engine.options[CONTRACT.token] = tick("option", bid=target + 1, ask=target + 2, price=target + 1)
        self.live.reconcile()
        self.live.reconcile()
        resting = self.broker.modify_order.call_args.kwargs["price"]
        # A higher bid leaves the resting SELL limit marketable; re-modifying only burns Kite's 25-modify budget.
        self.market.engine.options[CONTRACT.token] = tick("option", bid=target + 3, ask=target + 4, price=target + 3)
        self.live.reconcile()
        self.assertEqual(self.broker.modify_order.call_count, 1)
        self.live.state["active"]["modifications"] = 25
        self.market.engine.options[CONTRACT.token] = tick("option", bid=resting - 1, ask=resting, price=resting - 1)
        with self.assertRaisesRegex(LiveBlocked, "25-modification"):
            self.live.reconcile()
        self.assertEqual(self.broker.modify_order.call_count, 1)

    def test_uncertain_trail_keeps_last_confirmed_stop_until_broker_ack(self):
        self.protect()
        old_stop = self.live.state["active"]["stop"]
        self.market.engine.options[CONTRACT.token] = tick("option", bid=125, ask=126, price=125)
        self.broker.modify_order.side_effect = TimeoutError("Lost trail response")
        with self.assertRaises(TimeoutError):
            self.live.reconcile()
        self.assertEqual(self.live.state["active"]["stop"], old_stop)
        with self.assertRaisesRegex(LiveBlocked, "modification outcome unresolved"):
            self.live.reconcile()
        self.broker.modify_order.assert_called_once()
        self.orders[1].update(self.live.state["active"]["modify"])
        self.live.reconcile()
        self.assertTrue(self.live.state["active"]["trailing_active"])
        self.assertGreater(self.live.state["active"]["stop"], old_stop)
        self.broker.modify_order.assert_called_once()

    def test_emergency_stop_forces_exit_through_existing_stop_even_with_stale_feed(self):
        self.protect()
        self.market.engine.options[CONTRACT.token] = tick("option", at=NOW - 20)
        placed = self.broker.place_order.call_count
        result = self.live.stop_entries()
        self.assertTrue(result["killed"])
        self.assertTrue(result["flatten_pending"])
        self.assertFalse(result["automation_on"])
        modify = self.broker.modify_order.call_args.kwargs
        self.assertEqual((modify["order_id"], modify["order_type"], modify["price"]), ("2", "LIMIT", 94.05))
        self.assertEqual(self.broker.place_order.call_count, placed)
        with self.assertRaisesRegex(LiveBlocked, "latched"):
            self.live.arm()
        self.live.emergency_flatten()
        self.broker.modify_order.assert_called_once()
        self.orders[1].update(status="COMPLETE", filled_quantity=CONTRACT.lot_size, average_price=94.05)
        self.positions[0]["quantity"] = 0
        self.live.emergency_flatten()
        status = self.live.status()
        self.assertFalse(status["flatten_pending"])
        self.assertIsNone(status["active"])
        trade = self.live.state["trades"][-1]
        self.assertEqual((trade["exit_reason"], trade["exit_price"]), ("EMERGENCY_STOP", 94.05))
        self.assertLess(trade["net_pnl"], 0)

    def test_emergency_stop_closes_manual_positions_cancels_orders_then_resets_off(self):
        self.positions = [{"exchange": "NFO", "tradingsymbol": "BANKNIFTYMANUALPE", "product": "NRML",
                           "quantity": -30, "last_price": 200, "instrument_token": 7}]
        self.orders = [{"order_id": "M1", "status": "OPEN", "exchange": "NFO", "tradingsymbol": "NIFTYMANUALCE",
                        "transaction_type": "BUY", "quantity": 75, "filled_quantity": 0, "variety": "regular",
                        "order_type": "LIMIT", "price": 10, "tag": None}]
        self.live.stop_entries()
        exit_order = self.broker.place_order.call_args.kwargs
        self.assertEqual((exit_order["transaction_type"], exit_order["quantity"], exit_order["price"],
                          exit_order["product"], exit_order["tag"]), ("BUY", 30, 210.0, "NRML", "AQTEKILL"))
        self.broker.cancel_order.assert_called_once_with(variety="regular", order_id="M1")
        self.live.emergency_flatten()
        self.assertEqual(self.broker.place_order.call_count, 1)
        self.orders[0]["status"] = "CANCELLED"
        self.orders[1].update(status="COMPLETE", filled_quantity=30, average_price=205)
        with patch("services.aqte_live.time.time", return_value=NOW + 10):
            self.live.emergency_flatten()
        self.assertEqual(self.broker.place_order.call_count, 1, "lagging positions must not double exit")
        with self.assertRaisesRegex(LiveBlocked, "in progress"):
            self.live.reset_emergency()
        self.positions = []
        self.live.emergency_flatten()
        self.assertFalse(self.live.status()["flatten_pending"])
        result = self.live.reset_emergency()
        self.assertFalse(result["killed"])
        self.assertFalse(result["automation_on"])
        self.assertFalse(result["armed"])

    def test_market_open_and_restart_do_not_clear_an_emergency_latch(self):
        self.live.state.update(killed=True, flatten_pending=False, automation_on=False, armed_day=None)
        self.live.save("EMERGENCY_STOP")
        self.live.release_owner()
        restarted = self.new_service()
        self.addCleanup(restarted.release_owner)
        restarted.initialize()
        market_open = datetime(2026, 11, 2, 9, 15, tzinfo=IST).timestamp()
        with patch("services.aqte_live.time.time", return_value=market_open):
            with self.assertRaisesRegex(LiveBlocked, "Emergency stop is latched"):
                restarted.start_automation()
            self.assertTrue(restarted.status()["killed"])
            self.assertFalse(restarted.status()["automation_on"])
        self.ip.assert_not_called()
        self.broker.place_order.assert_not_called()

    def test_owner_reset_keeps_off_then_header_start_waits_for_weekday_entry_hours(self):
        self.live.state.update(killed=True, flatten_pending=False, automation_on=False, armed_day=None)
        sunday = datetime(2026, 11, 1, 23, 28, tzinfo=IST).timestamp()
        with patch("services.aqte_live.time.time", return_value=sunday):
            reset = self.live.reset_emergency()
            self.assertFalse(reset["killed"])
            self.assertFalse(reset["armed"])
            self.assertFalse(reset["automation_on"])
            self.assertFalse(reset["automation_wanted"])
            waiting = self.live.start_automation()
            self.assertTrue(waiting["automation_wanted"])
            self.assertFalse(waiting["automation_on"])
            self.assertFalse(waiting["armed"])
            self.assertEqual(waiting["automation_waiting"], MARKET_WAIT)
            self.assertFalse(self.live.set_automation(False)["automation_wanted"])
        self.ip.assert_not_called()
        for hour, minute, allowed in [(9, 14, False), (9, 15, True), (15, 14, True), (15, 15, False)]:
            with self.subTest(hour=hour, minute=minute):
                at = datetime(2026, 11, 2, hour, minute, tzinfo=IST).timestamp()
                with patch("services.aqte_live.time.time", return_value=at):
                    result = self.live.start_automation()
                    self.assertTrue(result["automation_wanted"])
                    self.assertEqual(result["automation_on"], allowed)
                    self.assertEqual(result["automation_waiting"], None if allowed else MARKET_WAIT)
                    if allowed:
                        self.assertTrue(result["armed"])
                    off = self.live.set_automation(False)
                    self.assertFalse(off["automation_on"])
                    self.assertFalse(off["automation_wanted"])
        self.ip.assert_called_once()
        self.broker.place_order.assert_not_called()
        self.broker.cancel_order.assert_not_called()
        self.broker.modify_order.assert_not_called()

    def test_emergency_exit_rejections_stop_at_cap_and_keep_reset_blocked(self):
        self.positions = [{"exchange": "NFO", "tradingsymbol": "NIFTYMANUALCE", "product": "MIS",
                           "quantity": 75, "last_price": 50, "instrument_token": 8}]

        def reject(**params):
            order_id = self.place(**params)
            self.orders[-1].update(status="REJECTED", status_message="Price band")
            return order_id

        self.broker.place_order.side_effect = reject
        self.live.stop_entries()
        for step in range(1, 8):
            with patch("services.aqte_live.time.time", return_value=NOW + step * 5):
                self.live.emergency_flatten()
        self.assertEqual(self.broker.place_order.call_count, 5)
        self.assertIn("square off in Kite", self.live.status()["error"])
        with self.assertRaisesRegex(LiveBlocked, "in progress"):
            self.live.reset_emergency()

    def test_emergency_stop_latches_during_broker_outage_and_resumes_after_restart(self):
        self.broker.orders.side_effect = ConnectionError("Kite down")
        result = self.live.stop_entries()
        self.assertTrue(result["killed"])
        self.assertTrue(result["flatten_pending"])
        self.assertIn("retrying", result["error"])
        self.live.release_owner()
        restored = self.new_service()
        restored.initialize()
        self.addCleanup(restored.release_owner)
        self.assertTrue(restored.status()["flatten_pending"])
        self.broker.orders.side_effect = lambda: copy.deepcopy(self.orders)
        restored.emergency_flatten()
        self.assertFalse(restored.status()["flatten_pending"])
        self.assertTrue(restored.status()["killed"])

    def test_manual_quantity_change_and_previous_session_fail_closed(self):
        self.protect()
        self.positions[0]["quantity"] = 0
        with self.assertRaisesRegex(LiveBlocked, "possible manual intervention"):
            self.live.reconcile()
        self.broker.modify_order.assert_not_called()
        with patch("services.aqte_live.time.time", return_value=NOW + 86400):
            with self.assertRaisesRegex(LiveBlocked, "Previous-session"):
                self.live.reconcile()

    def test_daily_trade_consecutive_loss_and_cash_limits(self):
        self.armed()
        self.live.state["trades"] = [
            {"entry_at": NOW, "net_pnl": -100} for _ in range(3)
        ]
        with self.assertRaisesRegex(LiveBlocked, "Consecutive"):
            self.live.entry_guard(self.broker)
        self.live.state["trades"] = [{"entry_at": NOW, "net_pnl": -2001}]
        with self.assertRaisesRegex(LiveBlocked, "Daily live loss"):
            self.live.entry_guard(self.broker)
        self.live.state["trades"] = [{"entry_at": NOW, "net_pnl": 1} for _ in range(5)]
        with self.assertRaisesRegex(LiveBlocked, "Maximum daily"):
            self.live.entry_guard(self.broker)
        self.live.state["trades"] = []
        self.broker.margins.return_value = {"available": {"cash": 1}}
        proposal = self.live.proposal("NIFTY")
        with self.assertRaisesRegex(LiveBlocked, "Insufficient"):
            self.live.confirm(proposal["id"])
        self.broker.place_order.assert_not_called()

    def test_changed_ask_limits_and_ip_never_chase(self):
        self.armed()
        proposal = self.live.proposal("NIFTY")
        raw = self.broker.quote(["test"])["test"]
        raw["depth"]["sell"][0]["price"] = 110
        self.broker.quote.side_effect = lambda keys: {keys[0]: raw}
        with self.assertRaisesRegex(LiveBlocked, "no-chase"):
            self.live.confirm(proposal["id"])
        self.ip.return_value = "8.8.8.8"
        with self.assertRaisesRegex(LiveBlocked, "outbound IP changed"):
            self.live.entry_guard(self.broker)
        self.assertFalse(self.live.status()["armed"])
        self.broker.place_order.assert_not_called()

    def test_restart_disarms_preserves_order_identity_and_process_lock(self):
        self.enter()
        other = self.new_service()
        with self.assertRaisesRegex(LiveBlocked, "Another AQTE live process"):
            other.initialize()
        self.live.release_owner()
        other = self.new_service()
        other.initialize()
        self.addCleanup(other.release_owner)
        self.assertFalse(other.status()["armed"])
        self.assertFalse(other.status()["automation_on"])
        self.assertEqual(other.state["active"]["entry_id"], "1")
        other.reconcile()
        self.assertEqual(self.broker.place_order.call_count, 2, "Only missing protective leg is submitted")

    def test_journal_failure_prevents_entry_mutation(self):
        self.armed()
        proposal = self.live.proposal("NIFTY")
        with patch.object(self.live, "save", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                self.live.confirm(proposal["id"])
        self.broker.place_order.assert_not_called()

    def test_automation_defaults_off_and_arming_does_not_place_order(self):
        self.assertFalse(self.live.status()["automation_on"])
        self.live.automated_entry()
        self.broker.place_order.assert_not_called()
        self.live.preflight()
        self.live.arm()
        self.live.automated_entry()
        self.broker.place_order.assert_not_called()
        with self.assertRaisesRegex(LiveBlocked, "OFF"):
            self.live.proposal("NIFTY")
        self.assertFalse(self.live.status()["automation_on"])

    def aligned_snapshot(self):
        snapshot = self.market.engine.snapshot(NOW) | {"recording": True}
        signal = snapshot["data"]["NIFTY"]
        side = 1 if signal["decision"] == "BUY CE" else -1
        # Breakout-aligned evidence, so the signal is labelled as the breakout setup it represents.
        signal.update(strategy="momentum_breakout", confidence=80, model_validated=False, intelligence={
            **signal["intelligence"],
            "ema": {str(n): 100 + side * (10 - i * 2) for i, n in enumerate((9, 20, 50, 100, 200))},
            "close": 100 + side * 11, "vwap": 100 + side * 5, "rsi": 60 if side > 0 else 40,
            "cpr": {"top": 100 + side * 7, "bottom": 100 + side * 3} if side > 0 else
                   {"top": 100 + side * 3, "bottom": 100 + side * 7},
            "supertrend": "BULLISH" if side > 0 else "BEARISH", "volume_ratio": 2,
            "imbalance": side * 0.3, "breakout": side,
            "structure": "HIGHER_HIGH" if side > 0 else "LOWER_LOW",
        })
        return snapshot

    def test_unvalidated_rule_opt_in_is_reported_and_forwarded_to_quality_gate(self):
        signal = self.market.snapshot()["data"]["NIFTY"]
        self.assertFalse(self.live.status()["unvalidated_rules"])
        with patch("services.aqte_live.quality_reason", return_value=None) as quality:
            self.live.control_reason("NIFTY", signal)
            self.assertIs(quality.call_args.args[2], False)
            self.cfg.aqte_live_allow_unvalidated_rules = True
            self.live.control_reason("NIFTY", signal)
            self.assertIs(quality.call_args.args[2], True)
        self.assertTrue(self.live.status()["unvalidated_rules"])

    def test_real_gate_blocks_strict_mode_and_opt_in_enters_one_aligned_lot(self):
        self.quality.stop()
        self.market.snapshot.side_effect = self.aligned_snapshot
        self.armed()
        self.live.automated_entry()
        self.assertIn("validation", self.live.control_reason("NIFTY", self.aligned_snapshot()["data"]["NIFTY"]))
        self.broker.place_order.assert_not_called()
        self.cfg.aqte_live_allow_unvalidated_rules = True
        self.live.automated_entry()
        self.assertEqual(self.broker.place_order.call_count, 1)
        params = self.broker.place_order.call_args.kwargs
        self.assertEqual((params["transaction_type"], params["quantity"]), ("BUY", CONTRACT.lot_size))
        self.live.automated_entry()
        self.assertEqual(self.broker.place_order.call_count, 1, "Only one live position at a time")

    def test_repeated_monitor_fault_is_journaled_once_with_reason(self):
        self.armed()
        for _ in range(3):
            self.live.fault_stop("ConnectionError: Kite down")
        self.live.fault_stop("TokenException: expired")
        self.live.fault_stop("TokenException: expired")
        self.armed()
        self.live.fault_stop("TokenException: expired")
        with closing(sqlite3.connect(str(self.path))) as db:
            rows = db.execute("SELECT payload FROM live_audit WHERE kind='AUTOMATION_FAULT_STOPPED' "
                              "ORDER BY id").fetchall()
        self.assertEqual([json.loads(row[0])["error"] for row in rows],
                         ["ConnectionError: Kite down", "TokenException: expired", "TokenException: expired"])
        status = self.live.status()
        self.assertEqual(status["error"], "TokenException: expired")
        self.assertFalse(status["armed"])
        self.assertFalse(status["automation_on"])

    def test_confirmed_start_checks_and_arms_then_off_can_pause_and_resume(self):
        self.assertFalse(self.live.status()["automation_on"])
        result = self.live.start_automation()
        self.assertTrue(result["armed"])
        self.assertTrue(result["automation_on"])
        self.ip.assert_called()
        self.broker.place_order.assert_not_called()
        self.live.set_automation(False)
        self.assertFalse(self.live.status()["automation_on"])
        self.assertTrue(self.live.start_automation()["automation_on"])
        self.broker.place_order.assert_not_called()

    def test_confirmed_start_never_clears_emergency_or_bypasses_configuration(self):
        self.live.stop_entries()
        with self.assertRaisesRegex(LiveBlocked, "operator review"):
            self.live.start_automation()
        self.assertTrue(self.live.state["killed"])
        self.assertFalse(self.live.status()["automation_on"])
        self.ip.assert_not_called()
        self.broker.place_order.assert_not_called()

    def test_confirmed_start_with_failed_preflight_or_closed_market_stays_on_and_waits(self):
        self.ip.return_value = "1.2.3.4"
        result = self.live.start_automation()
        self.assertTrue(result["automation_wanted"])
        self.assertFalse(result["automation_on"])
        self.assertFalse(result["armed"])
        self.assertIn("1.2.3.4", result["automation_waiting"])
        closed = datetime(2026, 10, 31, 10, 0, tzinfo=IST).timestamp()
        with patch("services.aqte_live.time.time", return_value=closed):
            result = self.live.start_automation()
            self.assertFalse(result["automation_on"])
            self.assertFalse(result["entry_window"])
            self.assertEqual(result["automation_waiting"], MARKET_WAIT)
        self.assertEqual(self.ip.call_count, 1, "No preflight outside the entry window")
        self.broker.place_order.assert_not_called()

    def test_standing_on_survives_restart_and_arms_itself_at_market_open(self):
        saturday = datetime(2026, 10, 31, 10, 0, tzinfo=IST).timestamp()
        with patch("services.aqte_live.time.time", return_value=saturday):
            self.live.start_automation()
            self.live.auto_activate()
            self.assertFalse(self.live.status()["armed"])
        self.ip.assert_not_called()
        self.live.disarm_shutdown()
        self.live.release_owner()
        restored = self.new_service()
        restored.initialize()
        self.addCleanup(restored.release_owner)
        with patch("services.aqte_live.time.time", return_value=datetime(2026, 11, 2, 9, 0, tzinfo=IST).timestamp()):
            restored.auto_activate()
            status = restored.status()
            self.assertTrue(status["automation_wanted"])
            self.assertFalse(status["automation_on"])
            self.assertEqual(status["automation_waiting"], MARKET_WAIT)
        self.ip.assert_not_called()
        with patch("services.aqte_live.time.time", return_value=datetime(2026, 11, 2, 9, 15, tzinfo=IST).timestamp()):
            restored.auto_activate()
            status = restored.status()
            self.assertTrue(status["armed"])
            self.assertTrue(status["automation_on"])
            self.assertIsNone(status["automation_waiting"])
            restored.auto_activate()
        self.ip.assert_called_once()
        self.broker.place_order.assert_not_called()

    def test_standing_on_retries_failed_preflight_once_per_minute_and_journals_reason_once(self):
        self.ip.return_value = "1.2.3.4"
        self.live.start_automation()
        self.live.auto_activate()
        self.assertEqual(self.ip.call_count, 1)
        with patch("services.aqte_live.time.time", return_value=NOW + 61):
            self.live.auto_activate()
        self.assertEqual(self.ip.call_count, 2)
        self.ip.return_value = "122.177.245.101"
        with patch("services.aqte_live.time.time", return_value=NOW + 122):
            self.live.auto_activate()
            status = self.live.status()
            self.assertTrue(status["automation_on"])
            self.assertIsNone(status["automation_waiting"])
        with closing(sqlite3.connect(str(self.path))) as db:
            waits = db.execute("SELECT COUNT(*) FROM live_audit WHERE kind='AUTOMATION_WAITING'").fetchone()[0]
        self.assertEqual(waits, 1)
        self.broker.place_order.assert_not_called()

    def test_standing_on_survives_entry_cutoff_and_rearms_next_trading_day(self):
        self.live.start_automation()
        with patch("services.aqte_live.time.time", return_value=datetime(2026, 10, 30, 15, 15, tzinfo=IST).timestamp()):
            self.live.automated_entry()
            self.live.auto_activate()
            status = self.live.status()
            self.assertFalse(status["automation_on"])
            self.assertTrue(status["automation_wanted"])
            self.assertEqual(status["automation_waiting"], MARKET_WAIT)
        with patch("services.aqte_live.time.time", return_value=datetime(2026, 11, 2, 9, 20, tzinfo=IST).timestamp()):
            self.live.auto_activate()
            self.assertTrue(self.live.status()["automation_on"])
        self.assertEqual(self.ip.call_count, 2)
        self.broker.place_order.assert_not_called()

    def test_fault_keeps_standing_on_but_never_rearms_over_an_open_trade(self):
        self.live.start_automation()
        self.live.fault_stop("ConnectionError: Kite down")
        self.assertFalse(self.live.status()["automation_on"])
        self.assertTrue(self.live.status()["automation_wanted"])
        self.live.auto_activate()
        self.assertEqual(self.ip.call_count, 1, "Fault waits for the retry delay")
        with patch("services.aqte_live.time.time", return_value=NOW + 61):
            self.live.auto_activate()
            self.assertTrue(self.live.status()["automation_on"])
        self.live.set_automation(False)
        self.protect()
        calls = self.ip.call_count
        self.live.fault_stop("ConnectionError: Kite down")
        with patch("services.aqte_live.time.time", return_value=NOW + 61):
            self.live.auto_activate()
            status = self.live.status()
            self.assertFalse(status["automation_on"])
            self.assertIn("open AQTE trade", status["automation_waiting"])
        self.assertEqual(self.ip.call_count, calls)

    def test_off_and_emergency_stop_clear_standing_on(self):
        self.live.start_automation()
        self.assertFalse(self.live.set_automation(False)["automation_wanted"])
        with patch("services.aqte_live.time.time", return_value=NOW + 61):
            self.live.auto_activate()
            self.assertFalse(self.live.status()["automation_on"])
        self.assertTrue(self.live.start_automation()["automation_wanted"])
        stopped = self.live.stop_entries()
        self.assertFalse(stopped["automation_wanted"])
        self.assertIsNone(stopped["automation_waiting"])
        self.live.release_owner()
        restored = self.new_service()
        restored.initialize()
        self.addCleanup(restored.release_owner)
        self.assertFalse(restored.status()["automation_wanted"])

    def test_on_automatically_enters_one_signal_and_off_blocks_further_entries(self):
        with self.assertRaisesRegex(LiveBlocked, "explicitly arm"):
            self.live.set_automation(True)
        self.armed()
        self.live.automated_entry()
        self.broker.place_order.assert_called_once()
        self.live.automated_entry()
        self.broker.place_order.assert_called_once()
        self.live.set_automation(False)
        self.assertFalse(self.live.status()["automation_on"])
        self.live.automated_entry()
        self.broker.place_order.assert_called_once()
        self.assertIsNone(self.live.state["active"]["exit_requested"])

    def test_off_preserves_existing_stop_and_exit_management(self):
        self.protect()
        self.live.set_automation(False)
        self.assertFalse(self.live.status()["automation_on"])
        target = self.live.state["active"]["target"]
        self.market.engine.options[CONTRACT.token] = tick("option", bid=target + 1, ask=target + 2, price=target + 1)
        self.live.reconcile()
        self.assertEqual(self.broker.modify_order.call_args.kwargs["order_id"], "2")
        self.assertEqual(self.broker.place_order.call_count, 2)

    def test_off_invalidates_prepared_order_and_day_change_disables_automation(self):
        self.armed()
        proposal = self.live.proposal("NIFTY")
        self.live.set_automation(False)
        with self.assertRaisesRegex(LiveBlocked, "already used"):
            self.live.confirm(proposal["id"])
        self.broker.place_order.assert_not_called()
        self.live.set_automation(True)
        with patch("services.aqte_live.time.time", return_value=NOW + 86400):
            self.live.automated_entry()
            self.assertFalse(self.live.status()["automation_on"])
        self.broker.place_order.assert_not_called()

    def test_on_waits_for_qualifying_signal_and_stops_at_cutoff(self):
        self.armed()
        snapshot = self.market.snapshot()
        snapshot["data"]["NIFTY"]["decision"] = "WAIT"
        self.market.snapshot.side_effect = lambda: snapshot
        self.live.automated_entry()
        self.broker.place_order.assert_not_called()
        self.assertTrue(self.live.status()["automation_on"])
        cutoff = datetime(2026, 10, 30, 15, 15, tzinfo=IST).timestamp()
        with patch("services.aqte_live.time.time", return_value=cutoff):
            self.live.automated_entry()
            self.assertFalse(self.live.status()["automation_on"])
            with self.assertRaisesRegex(LiveBlocked, "15:15"):
                self.live.set_automation(True)
        self.broker.place_order.assert_not_called()


    def test_entry_session_boundaries_and_off_available_after_close(self):
        self.armed()
        for hour, minute, allowed in [(9, 14, False), (9, 15, True),
                                       (15, 14, True), (15, 15, False), (15, 30, False)]:
            with self.subTest(hour=hour, minute=minute):
                at = datetime(2026, 10, 30, hour, minute, tzinfo=IST).timestamp()
                with patch("services.aqte_live.time.time", return_value=at):
                    if allowed:
                        self.assertTrue(self.live.set_automation(True)["automation_on"])
                        self.live.entry_guard(self.broker)
                    else:
                        with self.assertRaises(LiveBlocked):
                            self.live.set_automation(True)
                        with self.assertRaises(LiveBlocked):
                            self.live.entry_guard(self.broker)
                    self.assertFalse(self.live.set_automation(False)["automation_on"])
        self.broker.place_order.assert_not_called()

    def test_cutoff_turns_off_even_with_open_position_without_removing_protection(self):
        self.protect()
        active = copy.deepcopy(self.live.state["active"])
        cutoff = datetime(2026, 10, 30, 15, 15, tzinfo=IST).timestamp()
        with patch("services.aqte_live.time.time", return_value=cutoff):
            self.live.automated_entry()
            self.assertFalse(self.live.status()["automation_on"])
        self.assertEqual(self.live.state["active"], active)
        self.broker.cancel_order.assert_not_called()
        self.assertEqual(self.broker.place_order.call_count, 2)


class LiveAPITests(unittest.TestCase):
    def test_selected_exit_requires_owner_intent_origin_trade_identity_and_confirmation(self):
        controller = Mock()
        controller.request_exit.return_value = {"automation_on": False}
        body = {"trade_id": "0123456789abcdef", "confirmation": "CLOSE SELECTED AQTE TRADE"}
        with patch("routers.aqte.get_live_service", return_value=controller), patch(
            "routers.aqte.get_settings", return_value=settings()
        ), patch("routers.aqte.app_access_service.validate_session", new_callable=AsyncMock) as session:
            session.return_value = {"authenticated": False}
            self.assertEqual(self.client.post("/api/aqte/live/exit", headers=self.headers, json=body).status_code, 401)
            session.return_value = {"authenticated": True, "username": "admin"}
            self.assertEqual(self.client.post("/api/aqte/live/exit", json=body).status_code, 403)
            self.assertEqual(self.client.post("/api/aqte/live/exit", headers=self.headers | {
                "Origin": "https://untrusted.example"}, json=body).status_code, 403)
            for invalid in ({}, {**body, "trade_id": "bad"}, {**body, "quantity": 5},
                            {**body, "confirmation": "CLOSE ALL KITE POSITIONS"}):
                self.assertEqual(self.client.post("/api/aqte/live/exit", headers=self.headers, json=invalid).status_code, 422)
            controller.request_exit.assert_not_called()
            self.assertEqual(self.client.post("/api/aqte/live/exit", headers=self.headers, json=body).status_code, 200)
            controller.request_exit.assert_called_once_with(body["trade_id"])
            controller.stop_entries.assert_not_called()

    def test_invalid_kite_token_is_explicit_and_does_not_mutate_broker(self):
        from kiteconnect.exceptions import TokenException
        from routers.aqte import live_call
        import asyncio
        from fastapi import HTTPException
        reader = Mock(side_effect=TokenException("Incorrect api_key or access_token"))
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(live_call(reader))
        self.assertEqual(raised.exception.status_code, 409)
        self.assertIn("Sign in again", raised.exception.detail)
        self.assertIn("App-access login is separate", raised.exception.detail)
        reader.assert_called_once_with()

    def setUp(self):
        from routers.aqte import router
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)
        self.headers = {"Origin": "http://localhost:3000", "X-Device-Id": "test-device",
                        "X-AQTE-Intent": "manual-live-control"}

    def test_broker_positions_require_owner_and_return_explicit_failure_without_mutation(self):
        with patch("routers.aqte.broker_positions") as reader, patch(
            "routers.aqte.get_settings", return_value=settings()
        ), patch("routers.aqte.app_access_service.validate_session", new_callable=AsyncMock) as session:
            session.return_value = {"authenticated": False}
            self.assertEqual(self.client.get("/api/aqte/live/broker-positions", headers=self.headers).status_code, 401)
            reader.snapshot.assert_not_called()
            session.return_value = {"authenticated": True, "username": "admin"}
            self.assertEqual(self.client.get("/api/aqte/live/broker-positions").status_code, 403)
            reader.snapshot.return_value = {"positions": [], "read_only": True, "generated_at": NOW}
            response = self.client.get("/api/aqte/live/broker-positions", headers=self.headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["cache-control"], "no-store")
            reader.snapshot.side_effect = TimeoutError("Kite unavailable")
            self.assertEqual(self.client.get("/api/aqte/live/broker-positions", headers=self.headers).status_code, 503)

    def test_live_controls_require_owner_session_intent_origin_and_confirmation(self):
        controller = Mock()
        controller.status.return_value = {"enabled": False}
        controller.arm.return_value = {"armed": True}
        with patch("routers.aqte.get_live_service", return_value=controller), patch(
            "routers.aqte.get_settings", return_value=settings()
        ), patch("routers.aqte.app_access_service.validate_session", new_callable=AsyncMock) as session:
            session.return_value = {"authenticated": False}
            self.assertEqual(self.client.post("/api/aqte/live/arm", headers=self.headers,
                                             json={"confirmation": "ARM REAL TRADING"}).status_code, 401)
            session.return_value = {"authenticated": True, "username": "admin"}
            self.assertEqual(self.client.get("/api/aqte/live/status").status_code, 403)
            self.assertEqual(self.client.get("/api/aqte/live/status", headers=self.headers | {
                "Origin": "https://untrusted.example"}).status_code, 403)
            self.assertEqual(self.client.post("/api/aqte/live/arm", headers=self.headers,
                                             json={"confirmation": "yes"}).status_code, 422)
            self.assertEqual(self.client.post("/api/aqte/live/arm", headers=self.headers,
                                             json={"confirmation": "ARM REAL TRADING"}).status_code, 200)
            controller.arm.assert_called_once()
            controller.confirm.assert_not_called()
            controller.set_automation.return_value = {"automation_on": False}
            self.assertEqual(self.client.post("/api/aqte/live/automation", headers=self.headers,
                                             json={"enabled": True, "confirmation": "STOP NEW ENTRIES"}).status_code, 422)
            controller.set_automation.assert_not_called()
            self.assertEqual(self.client.post("/api/aqte/live/automation", headers=self.headers,
                                             json={"enabled": False, "confirmation": "STOP NEW ENTRIES"}).status_code, 200)
            controller.set_automation.assert_called_once_with(False)
            controller.stop_entries.return_value = {"killed": True}
            controller.reset_emergency.return_value = {"killed": False}
            self.assertEqual(self.client.post("/api/aqte/live/stop", headers=self.headers, json={}).status_code, 422)
            controller.stop_entries.assert_not_called()
            self.assertEqual(self.client.post("/api/aqte/live/stop", headers=self.headers,
                                             json={"confirmation": "CLOSE ALL KITE POSITIONS"}).status_code, 200)
            controller.stop_entries.assert_called_once()
            self.assertEqual(self.client.post("/api/aqte/live/reset", headers=self.headers,
                                             json={"confirmation": "CLOSE ALL KITE POSITIONS"}).status_code, 422)
            controller.reset_emergency.assert_not_called()
            self.assertEqual(self.client.post("/api/aqte/live/reset", headers=self.headers,
                                             json={"confirmation": "RESET EMERGENCY STOP"}).status_code, 200)
            controller.reset_emergency.assert_called_once()

    def test_daily_control_routes_are_owner_only_strict_and_do_not_arm_or_submit(self):
        controller = Mock()
        controller.daily_controls.return_value = {"data": {}, "long_only": True}
        controller.update_control.return_value = {"data": {}, "long_only": True}
        controller.update_limit.return_value = {"data": {}, "long_only": True}
        body = {"symbol": "NIFTY", "config": {"max_trades": 3}}
        with patch("routers.aqte.get_live_service", return_value=controller), patch(
            "routers.aqte.get_settings", return_value=settings()
        ), patch("routers.aqte.app_access_service.validate_session", new_callable=AsyncMock) as session:
            session.return_value = {"authenticated": False}
            self.assertEqual(self.client.post("/api/aqte/live/daily-controls", headers=self.headers,
                                             json=body).status_code, 401)
            self.assertEqual(self.client.post("/api/aqte/live/daily-limit", headers=self.headers,
                                             json={"symbol": "NIFTY", "max_trades": 3}).status_code, 401)
            session.return_value = {"authenticated": True, "username": "admin"}
            self.assertEqual(self.client.get("/api/aqte/live/daily-controls").status_code, 403)
            response = self.client.get("/api/aqte/live/daily-controls", headers=self.headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["cache-control"], "no-store")
            for config in ({"max_trades": 11}, {"enabled": "true"}, {"min_confidence": 74},
                           {"min_confidence": 81}, {"min_confidence": 90}, {"unknown": 1}):
                self.assertEqual(self.client.post("/api/aqte/live/daily-controls", headers=self.headers,
                                                 json={**body, "config": config}).status_code, 422)
            controller.update_control.assert_not_called()
            self.assertEqual(self.client.post("/api/aqte/live/daily-controls", headers=self.headers,
                                             json=body).status_code, 200)
            self.assertEqual(controller.update_control.call_args.args[1]["max_trades"], 3)
            saved = controller.update_control.call_args.args[1]
            self.assertTrue(saved["enabled"])
            self.assertEqual((saved["style"], saved["min_confidence"]), ("both", 75))
            self.assertTrue(all(saved["setups"].values()))
            for minimum in (75, 78, 80):
                self.assertEqual(self.client.post("/api/aqte/live/daily-controls", headers=self.headers,
                                                 json={**body, "config": {"min_confidence": minimum}}).status_code, 200)
                self.assertEqual(controller.update_control.call_args.args[1]["min_confidence"], minimum)
            for value in (0, 11, True, 2.5, "3"):
                self.assertEqual(self.client.post("/api/aqte/live/daily-limit", headers=self.headers,
                                                 json={"symbol": "NIFTY", "max_trades": value}).status_code, 422)
            self.assertEqual(self.client.post("/api/aqte/live/daily-limit", headers=self.headers,
                                             json={"symbol": "NIFTY", "max_trades": 3, "enabled": True}).status_code, 422)
            controller.update_limit.assert_not_called()
            self.assertEqual(self.client.post("/api/aqte/live/daily-limit", headers=self.headers,
                                             json={"symbol": "NIFTY", "max_trades": 3}).status_code, 200)
            controller.update_limit.assert_called_once_with("NIFTY", 3)
            controller.arm.assert_not_called()
            controller.confirm.assert_not_called()
            controller.set_automation.assert_not_called()


if __name__ == "__main__":
    unittest.main()
