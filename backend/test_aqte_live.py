import copy
import os
import tempfile
import threading
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.aqte_live import AQTELiveService, LiveBlocked
from test_aqte import CONTRACT, IST, NOW, ready_engine, tick


def settings(**overrides):
    values = dict(aqte_live_enabled=True, aqte_live_paper_validated=True,
                  aqte_live_static_ip="122.177.245.101", aqte_live_risk_per_trade=500,
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

    def test_daily_controls_save_only_while_off_persist_and_never_arm(self):
        config = {**self.live.state["daily_controls"]["NIFTY"], "max_trades": 3, "min_confidence": 95}
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
        self.assertEqual(restored.state["daily_controls"]["NIFTY"]["min_confidence"], 95)
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
        self.assertIn("90", self.live.control_reason("NIFTY", self.market.snapshot()["data"]["NIFTY"]))
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

    def test_confirmed_start_failed_preflight_or_closed_session_stays_off(self):
        self.ip.return_value = "1.2.3.4"
        with self.assertRaises(LiveBlocked):
            self.live.start_automation()
        self.assertFalse(self.live.status()["automation_on"])
        self.assertFalse(self.live.status()["armed"])
        closed = datetime(2026, 10, 31, 10, 0, tzinfo=IST).timestamp()
        with patch("services.aqte_live.time.time", return_value=closed):
            with self.assertRaisesRegex(LiveBlocked, "09:15"):
                self.live.start_automation()
        self.broker.place_order.assert_not_called()

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
            for config in ({"max_trades": 11}, {"enabled": "true"}, {"min_confidence": 80}, {"unknown": 1}):
                self.assertEqual(self.client.post("/api/aqte/live/daily-controls", headers=self.headers,
                                                 json={**body, "config": config}).status_code, 422)
            controller.update_control.assert_not_called()
            self.assertEqual(self.client.post("/api/aqte/live/daily-controls", headers=self.headers,
                                             json=body).status_code, 200)
            self.assertEqual(controller.update_control.call_args.args[1]["max_trades"], 3)
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
