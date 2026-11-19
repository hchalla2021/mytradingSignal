import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from datetime import datetime

import pytz

import httpx

from services.aqte_live import AQTELiveService, QUANTUMEDGE_TAG
from services.quantumedge_intraday import QuantumEdgeIntradayService


class QuantumEdgeAIReviewTests(unittest.TestCase):
    def test_new_signal_is_ai_reviewed_once_and_then_deduplicated(self):
        service = QuantumEdgeIntradayService()
        candidate = {"symbol": "NIFTY", "side": "CE", "setup_key": "QUANTUMEDGE:NIFTY:1:CE"}
        with mock.patch.object(service, "_call_ai", return_value={
            "approved": True, "state": "APPROVED", "action": "BUY_CE",
            "confidence": 82, "reason": "Aligned", "attempted": True,
        }) as review:
            first = service.review(candidate)
            second = service.review(candidate)
        self.assertTrue(first["approved"])
        self.assertEqual(second["state"], "DUPLICATE")
        review.assert_called_once()
        self.assertEqual(service.approved_candidates(2)[0]["symbol"], "NIFTY")

    def test_ai_rejection_is_persisted_for_the_signal(self):
        service = QuantumEdgeIntradayService()
        candidate = {"symbol": "SENSEX", "side": "PE", "setup_key": "QUANTUMEDGE:SENSEX:2:PE"}
        with mock.patch.object(service, "_call_ai", return_value={
            "approved": False, "state": "REJECTED", "action": "REJECT",
            "reason": "Insufficient room", "attempted": True,
        }) as review:
            self.assertFalse(service.review(candidate)["approved"])
            duplicate = service.review(candidate)
        self.assertEqual(duplicate["state"], "DUPLICATE")
        review.assert_called_once()
        self.assertEqual(service.last_result["SENSEX"]["reason"], "Insufficient room")
        self.assertEqual(service.last_result["SENSEX"]["setup_key"], candidate["setup_key"])

    def test_quantumedge_tags_are_distinct_from_existing_quantedge_tags(self):
        self.assertIsNotNone(QUANTUMEDGE_TAG.fullmatch("QEI0123456789abcE"))
        self.assertIsNone(QUANTUMEDGE_TAG.fullmatch("QEP0123456789abcE"))

    def test_previous_session_candle_cannot_qualify_today(self):
        service = QuantumEdgeIntradayService()
        now = pytz.timezone("Asia/Kolkata").localize(datetime(2026, 3, 10, 9, 20)).timestamp()
        market = mock.Mock()
        market.lock = mock.MagicMock()
        market.engine = mock.Mock()
        spot, future = mock.Mock(), mock.Mock(token=1)
        market.engine.spot = {"NIFTY": spot}
        market.engine.future = {"NIFTY": future}
        market.engine.fresh.return_value = True
        previous = pytz.timezone("Asia/Kolkata").localize(datetime(2026, 3, 9, 9, 16)).timestamp()
        market.engine.book.closed = {
            ("future", 1, 60): [
                {"at": previous + i * 60, "open": 100, "high": 102, "low": 99,
                 "close": 101 + i, "volume": 1000}
                for i in range(30)
            ]
        }
        result = service.evaluate(market, "NIFTY", now, 1, 500, set(), lambda price, qty: 1)
        self.assertEqual(result["decision"], "WAIT")
        self.assertIn("21 completed", result["reason"])


class QuantumEdgeControlTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.live = AQTELiveService(path=Path(self.directory.name) / "live.sqlite3",
                                    market=mock.Mock(), settings=mock.Mock(), broker=mock.Mock())
        self.live.initialize()
        self.live.market.lock = mock.MagicMock()
        self.live.market.engine.options = {}
        self.addCleanup(self.live.release_owner)
        self.live.ready = True
        self.live.save = mock.Mock()

    def test_index_controls_are_independent(self):
        status = self.live.set_quantumedge_index("NIFTY", False, 2, 750)
        self.assertFalse(status["indices"]["NIFTY"]["enabled"])
        self.assertEqual(status["indices"]["NIFTY"]["lots"], 2)
        self.assertTrue(status["indices"]["BANKNIFTY"]["enabled"])
        self.assertEqual(status["indices"]["SENSEX"]["risk_per_lot"], 500)

    def test_master_toggle_does_not_change_existing_quantedge(self):
        self.live.state["quantedge"]["enabled"] = True
        self.live.config_guard = mock.Mock()
        with mock.patch.dict(os.environ, {
            "QUANTUMEDGE_DEPLOYMENT_MODE": "production",
            "QUANTUMEDGE_ALLOW_LOCAL_LIVE": "false",
        }):
            self.live.set_quantumedge_approval(True)
        self.assertTrue(self.live.state["quantumedge"]["enabled"])
        self.assertTrue(self.live.state["quantedge"]["enabled"])

    def test_production_live_refuses_local_debug_urls(self):
        self.live.state["quantumedge"]["enabled"] = False
        cfg = mock.Mock(
            aqte_live_enabled=True, force_outbound_ipv4=True,
            aqte_live_static_ip="159.65.147.167",
            frontend_url="http://localhost:3000",
            cors_origins="http://localhost:3000",
            redirect_url="http://localhost:8000/api/auth/callback",
            debug=True,
        )
        self.live.settings = lambda: cfg
        with mock.patch.dict(os.environ, {"AQTE_LIVE_DEPLOYMENT_MODE": "production"}):
            with self.assertRaisesRegex(Exception, "non-local callback/origin"):
                self.live.config_guard()

    def test_master_toggle_blocks_unsafe_local_deployment(self):
        self.live.config_guard = mock.Mock()
        with mock.patch.dict(os.environ, {
            "QUANTUMEDGE_DEPLOYMENT_MODE": "local",
            "QUANTUMEDGE_ALLOW_LOCAL_LIVE": "false",
        }):
            with self.assertRaisesRegex(Exception, "explicit local live opt-in"):
                self.live.set_quantumedge_approval(True)
        self.assertFalse(self.live.state["quantumedge"]["enabled"])

    def test_square_off_only_accepts_quantumedge_owned_trade(self):
        original_request_exit = self.live.request_exit
        self.live.state["active"] = {
            "id": "QEI0123456789abc", "owner": "QUANTUMEDGE",
            "contract": {}, "symbol": "NIFTY",
        }
        self.live.request_exit = mock.Mock()
        self.live.request_quantumedge_exit("QEI0123456789abc")
        self.live.request_exit.assert_called_once_with("QEI0123456789abc")

        self.live.state["active"]["owner"] = "QUANTEDGE"
        with self.assertRaisesRegex(Exception, "no longer active"):
            self.live.request_quantumedge_exit("QEI0123456789abc")

        self.live.state["quantumedge"]["enabled"] = True
        self.live.state["quantedge"]["enabled"] = True
        self.live.state["active"] = {
            "id": "QEI0123456789abc", "owner": "QUANTUMEDGE", "entry_day": "2026-03-10",
            "filled": 1, "exited": 0, "exit_requested": None,
        }
        self.live.save = mock.Mock()
        self.live.status = mock.Mock(return_value={})
        with mock.patch("services.aqte_live.time.time",
                        return_value=pytz.timezone("Asia/Kolkata").localize(
                            datetime(2026, 3, 10, 10, 0)).timestamp()):
            original_request_exit("QEI0123456789abc")
        self.assertFalse(self.live.state["quantumedge"]["enabled"])
        self.assertTrue(self.live.state["quantedge"]["enabled"])

    def test_active_trade_pauses_ai_reviews_to_protect_reconciliation(self):
        self.live.state["quantumedge"]["enabled"] = True
        self.live.state["active"] = {"owner": "QUANTUMEDGE", "id": "QEI0123456789abc"}
        candidate = {
            "decision": "BUY CE", "symbol": "SENSEX", "side": "CE",
            "setup_key": "QUANTUMEDGE:SENSEX:1:CE", "signal_at": 1,
            "entry": {"reward_risk": 2, "quantity": 1, "maximum": 100, "stop": 90, "target": 120},
            "risk": 1000, "contract": {}, "strategy": "test",
        }
        self.live.quantumedge_candidate = mock.Mock(side_effect=[
            {"decision": "WAIT"}, {"decision": "WAIT"}, candidate,
        ])
        self.live.quantumedge.review = mock.Mock(return_value={
            "approved": True, "state": "APPROVED", "attempted": True,
        })
        self.live.book = mock.Mock(return_value={"busy": set()})
        with mock.patch("services.aqte_live.entry_window", return_value=True):
            self.live.automated_quantumedge_entry()
        self.live.quantumedge.review.assert_not_called()
        self.live.quantumedge.consume_approved = mock.Mock()
        self.assertIsNotNone(self.live.state["active"])

    def test_status_separates_zerodha_auth_from_market_phase(self):
        self.live.quantumedge_candidate = mock.Mock(return_value={"decision": "WAIT"})
        cases = (
            ((9, 3), "PRE_OPEN", False),
            ((9, 10), "AUCTION_FREEZE", False),
            ((9, 20), "NORMAL", True),
            ((15, 20), "CLOSING_AUCTION", False),
            ((15, 55), "POST_MARKET", False),
            ((16, 10), "CLOSED", False),
        )
        for clock, phase, entry in cases:
            with self.subTest(phase=phase):
                at = pytz.timezone("Asia/Kolkata").localize(datetime(2026, 3, 10, *clock)).timestamp()
                from services.auth_state_machine import AuthStateManager
                with mock.patch("services.aqte_live.time.time", return_value=at), \
                     mock.patch.object(AuthStateManager, "is_authenticated",
                                       new_callable=mock.PropertyMock, return_value=True):
                    status = self.live.quantumedge_status()
                self.assertTrue(status["zerodha_connected"])
                self.assertEqual(status["market_phase"], phase)
                self.assertEqual(status["entry_window"], entry)

    def test_status_exposes_explicit_wait_states_and_holiday_blocks_entries(self):
        self.live.state["quantumedge"]["enabled"] = False
        self.live.quantumedge_candidate = mock.Mock(return_value={
            "decision": "WAIT", "symbol": "NIFTY", "reason": "Fresh spot required",
        })
        normal = pytz.timezone("Asia/Kolkata").localize(datetime(2026, 3, 10, 10, 0)).timestamp()
        holiday = pytz.timezone("Asia/Kolkata").localize(datetime(2026, 3, 31, 10, 0)).timestamp()
        with mock.patch("services.aqte_live.time.time", return_value=normal):
            status = self.live.quantumedge_status()
        self.assertEqual(status["signals"]["NIFTY"]["status"], "WAIT_MASTER")
        with mock.patch("services.aqte_live.time.time", return_value=holiday):
            status = self.live.quantumedge_status()
        self.assertEqual(status["market_phase"], "CLOSED")
        self.assertEqual(status["signals"]["NIFTY"]["status"], "WAIT_SESSION")
        self.assertFalse(status["entry_window"])

    def test_active_snapshot_exposes_broker_mark_and_entry_time(self):
        self.live.state["active"] = {
            "id": "QEI0123456789abc", "owner": "QUANTUMEDGE", "symbol": "NIFTY",
            "contract": {"token": 7, "lot_size": 65, "trading_symbol": "NIFTYTESTCE"},
            "entry_price": 100, "filled": 65, "exited": 0, "entry_at": 123,
        }
        tick = mock.Mock(price=102)
        self.live.market.lock = mock.MagicMock()
        self.live.market.engine.options = {7: tick}
        self.live.market.engine.fresh.return_value = True

        active = self.live.quantumedge_active()

        self.assertEqual(active["ltp"], 102)
        self.assertEqual(active["unrealized"], 130)
        self.assertEqual(active["entry_at"], 123)

    def test_ai_approval_is_rejected_if_live_candidate_changes(self):
        approved = {
            "symbol": "NIFTY", "setup_key": "QUANTUMEDGE:NIFTY:1:CE",
            "contract": {"token": 1}, "entry": {"maximum": 100},
            "risk": 500,
        }
        self.live.quantumedge_proposal = mock.Mock(return_value={
            "id": "proposal", **approved, "contract": {"token": 2},
        })
        with self.assertRaisesRegex(Exception, "AI-approved signal changed"):
            self.live.quantumedge_proposal_for_approval(approved, set())

    def test_emergency_paths_revoke_quantumedge_standing_approval(self):
        self.live.state["quantumedge"]["enabled"] = True
        self.live.emergency_flatten = mock.Mock()
        self.live.status = mock.Mock(return_value={})
        self.live.stop_entries()
        self.assertFalse(self.live.state["quantumedge"]["enabled"])
        self.live.state["quantumedge"]["enabled"] = True
        self.live.fault_stop("test fault")
        self.assertFalse(self.live.state["quantumedge"]["enabled"])


if __name__ == "__main__":
    unittest.main()
