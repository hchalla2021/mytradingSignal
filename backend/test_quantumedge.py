import json
import hashlib
import os
import tempfile
import unittest
from dataclasses import asdict
from pathlib import Path
from unittest import mock
from datetime import datetime

import pytz

import httpx

from services.aqte_live import AQTELiveService, QUANTUMEDGE_TAG
from services.aqte_engine import AQTEEngine, Candle, Contract
from services.quantumedge_intraday import QuantumEdgeIntradayService, _price_action
from services.quantumedge_strategies import previous_spot_levels, select_setup
from services.aqte_ml import TARGET
from services.quantumedge_ml import FEATURE_NAMES, SCHEMA, THRESHOLD


class QuantumEdgeAIReviewTests(unittest.TestCase):
    def test_claude_review_failure_never_approves_and_is_not_a_strategy_rejection(self):
        approval = '{"action":"BUY_CE","confidence":82,"reason":"Breakout aligned"}'
        cases = [
            ("max_tokens", approval, "AI_UNAVAILABLE"),
            ("model_context_window_exceeded", approval, "AI_UNAVAILABLE"),
            ("end_turn", 'No valid JSON', "AI_UNAVAILABLE"),
            ("end_turn", '{"action":"BUY_CE","confidence":"high","reason":"Aligned"}', "AI_UNAVAILABLE"),
            ("end_turn", '{"action":"BUY_PE","confidence":82,"reason":"Opposite side"}', "AI_UNAVAILABLE"),
            ("end_turn", '{"action":"REJECT","confidence":82,"reason":"Insufficient room"}', "REJECTED"),
            ("end_turn", approval, "APPROVED"),
        ]
        for stop_reason, text, state in cases:
            with self.subTest(stop_reason=stop_reason, text=text), mock.patch.dict(os.environ, {
                "QUANTUMEDGE_AI_ANTHROPIC_API_KEY": "test-key", "QUANTUMEDGE_AI_ENABLED": "true",
                "QUANTUMEDGE_AI_MODEL": "claude-haiku-5-5", "QUANTUMEDGE_AI_MAX_OUTPUT_TOKENS": "384",
                "QUANTUMEDGE_AI_DAILY_BUDGET_USD": "2.5", "QUANTUMEDGE_AI_MONTHLY_BUDGET_USD": "50",
            }), mock.patch("services.quantumedge_intraday.httpx.post", return_value=httpx.Response(200, json={
                "stop_reason": stop_reason, "content": [{"type": "text", "text": text}],
                "usage": {"input_tokens": 70, "output_tokens": 40},
            })) as post:
                service = QuantumEdgeIntradayService()
                evidence = {"structure": "BULLISH"}
                result = service._call_ai({"side": "CE", "price_action": evidence})
                self.assertEqual(result["state"], state)
                self.assertEqual(result["approved"], state == "APPROVED")
                self.assertEqual(service.ai_calls, 1)
                request = post.call_args.kwargs["json"]
                sent = json.loads(request["messages"][0]["content"])
                self.assertEqual(sent["candidate"]["price_action"], evidence)
                self.assertEqual(request["thinking"], {"type": "disabled"})
                self.assertNotIn("temperature", request)
                self.assertEqual(request["max_tokens"], 384)
                output = request["output_config"]["format"]
                self.assertEqual(output["type"], "json_schema")
                self.assertCountEqual(output["schema"]["required"], ("action", "confidence", "reason"))

    def test_budget_precheck_uses_the_same_clamped_output_cap_as_the_request(self):
        with mock.patch.dict(os.environ, {
            "QUANTUMEDGE_AI_ANTHROPIC_API_KEY": "test-key", "QUANTUMEDGE_AI_ENABLED": "true",
            "QUANTUMEDGE_AI_MAX_OUTPUT_TOKENS": "1", "QUANTUMEDGE_AI_DAILY_BUDGET_USD": "0.00005",
            "QUANTUMEDGE_AI_MONTHLY_BUDGET_USD": "50",
        }), mock.patch("services.quantumedge_intraday.httpx.post") as post:
            result = QuantumEdgeIntradayService()._call_ai({"side": "CE"})
            self.assertEqual(result["reason"], "Daily AI budget exhausted")
            post.assert_not_called()

    def test_price_action_uses_closed_contiguous_bars_and_filters_mitigated_fvg(self):
        bars = [{"at": i * 60, "open": 100, "high": 101, "low": 99, "close": 100}
                for i in range(19)]
        bars.extend([
            {"at": 19 * 60, "open": 100, "high": 105, "low": 99, "close": 104},
            {"at": 20 * 60, "open": 104, "high": 110, "low": 104, "close": 109},
        ])
        self.assertIsNone(_price_action(bars, 21 * 60 - 1))
        evidence = _price_action(bars, 21 * 60)
        assert evidence is not None
        self.assertEqual((evidence["structure"], evidence["displacement"]), ("BULLISH", "BULLISH"))
        self.assertEqual((evidence["fvg"]["low"], evidence["fvg"]["high"]), (101, 104))
        self.assertIsNone(_price_action(bars, 22 * 60))
        bars.append({"at": 21 * 60, "open": 103, "high": 105, "low": 102, "close": 103})
        evidence = _price_action(bars, 22 * 60)
        assert evidence is not None
        self.assertEqual(evidence["structure"], "INSIDE_RANGE")
        self.assertIsNone(evidence["fvg"])
        bars[-1]["at"] += 60
        self.assertIsNone(_price_action(bars, 23 * 60))

    def test_gate_requires_lightgbm_then_exact_claude_review(self):
        import lightgbm as lgb
        import numpy as np

        X = np.tile(np.array([[0.] * len(FEATURE_NAMES), [1.] * len(FEATURE_NAMES)]), (50, 1))
        model = lgb.train({"objective": "binary", "num_threads": 1, "verbosity": -1},
                          lgb.Dataset(X, label=X[:, 0], feature_name=list(FEATURE_NAMES)),
                          num_boost_round=12).model_to_string()
        day_end = 1780000000
        bundle = {
            "schema": SCHEMA, "features": list(FEATURE_NAMES), "target": TARGET,
            "model_text": model, "sha256": hashlib.sha256(model.encode()).hexdigest(),
            "coverage": ["NIFTY:CE"],
            "report": {"beats_baseline": True, "train_label_end": day_end - 20000,
                       "holdout_start": day_end - 10000, "holdout_end": day_end,
                       "gate": {"threshold": THRESHOLD, "by_side": {"NIFTY:CE": {
                           "holdout_samples": 40, "passed": 20, "blocked": 20,
                           "passed_mean_return": 0.02, "unfiltered_mean_return": 0.0,
                       }}}},
        }
        candidate = {"symbol": "NIFTY", "side": "CE", "setup_key": "test",
                     "entry": {"quantity": 65}, "contract": {"lot_size": 65}, "signal_at": day_end + 1}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.json"
            path.write_text(json.dumps(bundle), encoding="utf-8")
            with mock.patch.dict(os.environ, {"QUANTUMEDGE_ML_MODE": "gate",
                                              "QUANTUMEDGE_ML_MODEL_PATH": str(path)}):
                service = QuantumEdgeIntradayService()
            with mock.patch("services.quantumedge_intraday.time.time", return_value=day_end + 1), \
                 mock.patch.object(service, "_call_ai", return_value={
                     "approved": True, "state": "APPROVED", "attempted": True,
                 }) as claude:
                veto = service.review({**candidate, "ml_features": X[0]})
                self.assertEqual(veto["ml"]["state"], "VETO")
                claude.assert_not_called()
                approved = service.review({**candidate, "ml_features": X[1]})
                self.assertTrue(approved["approved"])
                self.assertEqual(approved["ml"]["state"], "PASS")
                claude.assert_called_once_with(candidate)
                self.assertEqual(service.approved_candidates(day_end + 1)[0]["ml"]["state"], "PASS")

    def test_missing_model_fails_closed_in_gate_and_not_in_shadow(self):
        for mode, expected in (("gate", "ML_BLOCKED"), ("shadow", "REJECTED")):
            with self.subTest(mode=mode), mock.patch.dict(os.environ, {
                "QUANTUMEDGE_ML_MODE": mode, "QUANTUMEDGE_ML_MODEL_PATH": "",
            }):
                service = QuantumEdgeIntradayService()
                with mock.patch.object(service, "_call_ai", return_value={
                    "approved": False, "state": "REJECTED", "attempted": True,
                }) as claude:
                    result = service.review({"symbol": "SENSEX", "side": "PE", "setup_key": "test"})
                    self.assertEqual(result["state"], expected)
                    self.assertEqual(claude.call_count, int(mode == "shadow"))

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
        self.assertIsNone(service.status()["last_error"])

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
        self.assertIn("16 consecutive completed", result["reason"])

    def test_risk_rejection_reports_estimate_and_cap_per_lot(self):
        service = QuantumEdgeIntradayService()
        now = pytz.timezone("Asia/Kolkata").localize(datetime(2026, 3, 10, 10, 0)).timestamp()
        market = mock.Mock(lock=mock.MagicMock())
        engine = market.engine
        engine.spot, engine.future = {"NIFTY": mock.Mock()}, {"NIFTY": mock.Mock(token=1)}
        engine.fresh.return_value = True
        engine.book.closed = {("future", 1, 60): [
            {"at": now - (45 - i) * 60, "open": 100, "high": 104 if i == 44 else 101,
             "low": 99, "close": 103 if i == 44 else 100, "volume": 150 if i == 44 else 100}
            for i in range(45)
        ]}
        engine.pick.return_value = (1, mock.Mock(lot_size=65, tick_size=0.05),
                                    mock.Mock(ask=100, ask_quantity=130))
        signal = service.evaluate(market, "NIFTY", now, 2, 1000, set(), lambda price, qty: 20)
        self.assertEqual(signal["decision"], "WAIT")
        self.assertEqual(signal["reason"], "Estimated risk ₹1,320.00/lot exceeds the ₹1,000/lot cap")

    def test_selects_nearest_risk_fit_without_switching_expiry(self):
        service = QuantumEdgeIntradayService()
        now = pytz.timezone("Asia/Kolkata").localize(datetime(2026, 3, 10, 10, 0)).timestamp()
        engine = AQTEEngine()
        symbol = "BANKNIFTY"
        engine.spot[symbol] = mock.Mock(price=64000, at=now, received=now)
        engine.future[symbol] = mock.Mock(token=99, at=now, received=now)
        engine.book.closed[("future", 99, 60)] = [
            {"at": now - (45 - i) * 60, "open": 64000, "high": 64004 if i == 44 else 64001,
             "low": 63999, "close": 64003 if i == 44 else 64000, "volume": 150 if i == 44 else 100}
            for i in range(45)
        ]
        for token, strike, expiry, ask in (
            (1, 64000, "2026-03-19", 408.70),
            (2, 64100, "2026-03-26", 170),
            (3, 64200, "2026-03-19", 200),
        ):
            engine.contracts[token] = Contract(symbol, token, f"BANKNIFTY{token}CE", "NFO",
                                               "CE", strike, expiry, 30, 0.05)
            engine.options[token] = mock.Mock(at=now, received=now, bid=ask - 1, ask=ask,
                                              bid_quantity=60, ask_quantity=60, volume=100)
        market = mock.Mock(lock=mock.MagicMock(), engine=engine)
        signal = service.evaluate(market, symbol, now, 1, 3000, set(), engine.costs, daily_budget=1500)
        self.assertEqual((signal["decision"], signal["contract"]["token"]), ("BUY CE", 3))
        self.assertEqual(signal["strategy"], "vwap_pullback")
        self.assertTrue(signal["setup_key"].endswith(":CE:vwap_pullback"))
        self.assertTrue(signal["alternate_strike"])
        self.assertLess(signal["risk"], 1500)
        amounts = signal["risk_breakdown"]
        self.assertEqual(amounts["gross_loss_at_stop_inr"], 1200)
        self.assertEqual(amounts["gross_profit_at_target_inr"], 2400)
        self.assertGreater(amounts["entry_cost_inr"], 0)
        self.assertAlmostEqual(signal["risk"], amounts["gross_loss_at_stop_inr"]
                               + amounts["entry_cost_inr"] + amounts["stop_exit_cost_inr"], delta=.01)
        self.assertAlmostEqual(amounts["net_profit_at_target_inr"], amounts["gross_profit_at_target_inr"]
                               - amounts["entry_cost_inr"] - amounts["target_exit_cost_inr"], delta=.01)
        self.assertEqual(signal["entry"]["reward_risk"], round(amounts["net_profit_at_target_inr"] / signal["risk"], 2))
        blocked = service.evaluate(market, symbol, now, 1, 3000, {3}, engine.costs, daily_budget=1500)
        self.assertEqual(blocked["decision"], "WAIT")
        self.assertIn("No eligible same-expiry CE strike", blocked["reason"])
        self.assertIn("algo budget ₹1,500.00", blocked["reason"])
        self.assertEqual(blocked["price_action"], signal["price_action"])


class QuantumEdgeStrategyTests(unittest.TestCase):
    start = pytz.timezone("Asia/Kolkata").localize(datetime(2026, 3, 10, 9, 15)).timestamp()

    def bar(self, i: int, close: float = 100, *, low: float = 99, high: float = 101,
            volume: int = 100, op: float = 100) -> Candle:
        return Candle(at=self.start + i * 60, open=op, close=close, low=low, high=high, volume=volume)

    def test_opening_range_takes_priority_only_after_closed_volume_confirmation(self):
        bars = [self.bar(i) for i in range(14)]
        bars.extend([self.bar(14, 102, low=101, high=102, op=101),
                     self.bar(15, 103, low=102, high=104, op=102, volume=149)])
        now = self.start + 16 * 60
        self.assertIsNone(select_setup(bars, now - 1)[0])
        proxy, _ = select_setup(bars, now)
        assert proxy is not None
        self.assertEqual(proxy["id"], "volume_imbalance")
        self.assertIn("not aggressor-side", proxy["reason"])
        bars[-1]["volume"] = 150
        setup, _ = select_setup(bars, now)
        assert setup is not None
        self.assertEqual((setup["id"], setup["side"]), ("opening_range", "CE"))

    def test_prior_session_strategies_use_spot_and_reject_stale_candles(self):
        bars = [self.bar(i, 200, low=199, high=201, op=200) for i in range(16)]
        now = self.start + 16 * 60
        source = {"high": 110, "low": 90, "close": 104,
                  "prepared_for": "2026-03-10", "session_day": "2026-03-09"}
        levels = previous_spot_levels(source, "2026-03-10")
        cases = ((109, 111, "previous_day_break"), (101, 105, "cpr_break"),
                 (111, 116, "camarilla_break"))
        for before, after, key in cases:
            with self.subTest(strategy=key):
                spot = [self.bar(14, before), self.bar(15, after)]
                setup, _ = select_setup(bars, now, spot_bars=spot, prior_spot=levels)
                assert setup is not None
                self.assertEqual((setup["id"], setup["side"]), (key, "CE"))
                self.assertIsNone(select_setup(bars, now, spot_bars=spot[:1], prior_spot=levels)[0])
        self.assertIsNone(previous_spot_levels(source, "2026-03-11"))

    def test_opposing_spot_and_futures_setups_do_not_qualify(self):
        bars = [self.bar(i) for i in range(14)]
        bars.extend([self.bar(14, 102, low=101, high=102, op=101),
                     self.bar(15, 103, low=102, high=104, op=102, volume=150)])
        now = self.start + 16 * 60
        spot = [self.bar(14, 91), self.bar(15, 89)]
        self.assertEqual(select_setup(bars, now, spot_bars=spot, prior_spot=(110, 90, 100)),
                         (None, "Qualified setups point in opposite directions"))

    def test_sweep_only_can_qualify_without_opening_history(self):
        bars = [self.bar(i) for i in range(20, 34)]
        bars.extend([self.bar(34, 100, high=103),
                     self.bar(35, 98, low=97, high=100, volume=130)])
        now = self.start + 36 * 60
        setup, _ = select_setup(bars, now)
        assert setup is not None
        self.assertEqual((setup["id"], setup["side"]), ("liquidity_sweep", "PE"))
        self.assertIsNone(select_setup(bars[:-3] + bars[-2:], now)[0])
        self.assertIsNone(select_setup(bars, now + 60)[0])


class QuantumEdgeControlTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.live = AQTELiveService(path=Path(self.directory.name) / "live.sqlite3",
                                    market=mock.Mock(), settings=mock.Mock(), broker=mock.Mock())
        self.live.initialize()
        self.live.market.lock = mock.MagicMock()
        self.live.market.engine = mock.Mock(wraps=AQTEEngine(), spot={}, future={}, options={},
                                           contracts={}, previous_day={})
        self.addCleanup(self.live.release_owner)
        self.live.ready = True
        self.live.save = mock.Mock()

    def test_index_controls_are_independent(self):
        status = self.live.set_quantumedge_index("NIFTY", False, 2, 750)
        self.assertNotIn("shadow_strategies", status)
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

    def test_first_approval_reaches_confirmation_without_reviewing_other_indices(self):
        live = self.live
        live.state["quantumedge"]["enabled"] = True
        live.book = mock.Mock(return_value={"busy": set()})
        live.quantumedge_activate = mock.Mock(return_value=True)
        live.config_guard = mock.Mock()
        now = pytz.timezone("Asia/Kolkata").localize(datetime(2026, 3, 10, 10, 0)).timestamp()
        live.quantumedge_candidate = mock.Mock(side_effect=lambda symbol, busy: {
            "symbol": symbol, "decision": "BUY CE", "side": "CE", "setup_key": symbol,
            "signal_at": now - 1, "risk": 500,
            "entry": {"reward_risk": 2 if symbol == "NIFTY" else 1.8},
        })
        calls = mock.Mock()
        calls.review.return_value = {"approved": True, "ml": {"state": "OFF"}}
        calls.propose.return_value = {"id": "test-proposal"}
        live.quantumedge.review = calls.review
        live.quantumedge_proposal_for_approval = calls.propose
        live.confirm = calls.confirm

        with mock.patch("services.aqte_live.time.time", return_value=now):
            live.automated_quantumedge_entry()
        self.assertEqual([call[0] for call in calls.mock_calls], ["review", "propose", "confirm"])
        self.assertEqual(calls.review.call_args.args[0]["symbol"], "NIFTY")
        calls.confirm.assert_called_once_with("test-proposal")

        calls.reset_mock()
        with mock.patch("services.aqte_live.time.time", return_value=now), mock.patch(
            "services.aqte_live.entry_window", side_effect=[True, True, False],
        ):
            live.automated_quantumedge_entry()
        calls.review.assert_called_once()
        calls.propose.assert_not_called()
        calls.confirm.assert_not_called()

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

    def test_daily_budget_blocks_ai_and_execution_even_within_index_cap(self):
        from services.auth_state_machine import AuthStateManager

        live = self.live
        live.state["quantumedge"]["enabled"] = True
        live.state["quantumedge"]["indices"]["BANKNIFTY"]["risk_per_lot"] = 3000
        live.state["armed_day"] = "2026-03-10"
        now = pytz.timezone("Asia/Kolkata").localize(datetime(2026, 3, 10, 10, 0)).timestamp()
        candidate = {"symbol": "BANKNIFTY", "decision": "BUY CE", "side": "CE",
                     "setup_key": "bank", "signal_at": now - 1, "risk": 2604.15,
                     "entry": {"reward_risk": 1.8}}
        live.quantumedge_candidate = mock.Mock(side_effect=lambda symbol, busy: (
            dict(candidate) if symbol == "BANKNIFTY" else {"decision": "WAIT"}))
        live.book = mock.Mock(return_value={"busy": set()})
        live.config_guard = mock.Mock()
        live.confirm = mock.Mock()
        live.quantumedge.last_result["BANKNIFTY"] = {"setup_key": "bank", "state": "APPROVED"}
        with mock.patch("services.aqte_live.time.time", return_value=now), mock.patch.object(
            AuthStateManager, "is_authenticated", new_callable=mock.PropertyMock, return_value=True
        ), mock.patch.object(live.quantumedge, "review") as review, mock.patch.object(
            live.quantumedge, "approved_candidates", return_value=[candidate]
        ):
            status = live.quantumedge_status()
            live.automated_quantumedge_entry()
            review.assert_not_called()
        signal = status["signals"]["BANKNIFTY"]
        self.assertEqual(signal["status"], "ENTRY_BLOCKED")
        self.assertIn("₹2,604.15", signal["reason"])
        self.assertIn("₹1,500", signal["reason"])
        live.confirm.assert_not_called()

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

    def test_ai_approval_accepts_only_same_size_with_no_price_or_risk_increase(self):
        approved = {
            "symbol": "NIFTY", "setup_key": "QUANTUMEDGE:NIFTY:1:CE:multi_timeframe",
            "contract": {"token": 1}, "entry": {"maximum": 100, "quantity": 65},
            "risk": 500, "ml": {"state": "OFF"},
        }
        for price, quantity, risk, changed in (
            (99.95, 65, 497.50, None),
            (100.05, 65, 497.50, "entry price increased"),
            (99.95, 65, 500.01, "risk increased"),
            (99.95, 130, 497.50, "quantity changed"),
        ):
            with self.subTest(price=price, quantity=quantity, risk=risk):
                fresh = {**approved, "id": "test", "risk": risk, "execution_context": {},
                         "entry": {"maximum": price, "quantity": quantity}}
                self.live.proposals["test"] = fresh
                self.live.quantumedge_proposal = mock.Mock(return_value=fresh)
                if changed:
                    with self.assertRaisesRegex(Exception, changed):
                        self.live.quantumedge_proposal_for_approval(approved, set())
                    self.assertNotIn("test", self.live.proposals)
                else:
                    proposal = self.live.quantumedge_proposal_for_approval(approved, set())
                    self.assertEqual(proposal["entry"], {"maximum": 99.95, "quantity": 65})
                    self.assertEqual(proposal["risk"], 497.50)

    def test_live_confirm_blocks_gate_proposal_without_model_evidence(self):
        self.live.quantumedge.ml.mode = "gate"
        self.live.proposals["test"] = {"owner": "QUANTUMEDGE", "expires_at": float("inf"),
                                       "execution_context": {}}
        self.live.entry_guard = mock.Mock()
        with self.assertRaisesRegex(Exception, "no current LightGBM approval"):
            self.live.confirm("test")
        self.live.entry_guard.assert_not_called()
        self.live.broker.return_value.place_order.assert_not_called()

    def test_confirm_rechecks_ml_and_does_not_count_completed_manual_fills(self):
        now = pytz.timezone("Asia/Kolkata").localize(datetime(2026, 3, 10, 10, 0)).timestamp()
        contract = Contract("NIFTY", 7, "NIFTYTESTCE", "NFO", "CE", 24500, "2026-03-19", 65, 0.05)
        candidate = {
            "symbol": "NIFTY", "side": "CE", "decision": "BUY CE", "contract": asdict(contract),
            "risk": 500, "setup_key": "test", "signal_at": now - 1, "strategy": "test",
            "entry": {"maximum": 100, "stop": 95, "target": 115, "quantity": 65},
            "ml_features": (1.0,) * len(FEATURE_NAMES), "reason": "test",
        }
        live = self.live
        live.state["quantumedge"]["enabled"] = True
        live.state.update(armed_day="2026-03-10", account="test-account")
        live.config_guard = mock.Mock(return_value=mock.Mock(
            aqte_live_static_ip="192.0.2.1", aqte_live_max_trades=5,
            aqte_live_max_losses=2, aqte_live_daily_loss=1500,
        ))
        live.checked_outbound_ip = mock.Mock(return_value="192.0.2.1")
        live.quantumedge_candidate = mock.Mock(return_value=candidate)
        live.status = mock.Mock(return_value={})
        market = live.market
        market.health_lock = mock.MagicMock()
        market.started, market.feed_connected, market.evaluators = True, True, None
        market.gaps = {}
        market.failed.is_set.return_value = False
        market.engine.killed = False
        market.engine.contracts = {7: contract}
        market.engine.fresh.return_value = True
        broker = live.broker.return_value
        broker.profile.return_value = {"user_id": "test-account"}
        broker.orders.return_value = [
            {"instrument_token": 7, "status": "COMPLETE", "transaction_type": action, "filled_quantity": 65}
            for action in ("BUY", "SELL")
        ]
        broker.positions.return_value = {"net": [
            {"instrument_token": 7, "quantity": 0, "pnl": -2000},
            {"instrument_token": 8, "quantity": 65, "pnl": -1000},
        ]}
        self.assertEqual(live.book(broker)["busy"], {8})
        broker.quote.return_value = {"NFO:NIFTYTESTCE": {}}
        broker.margins.return_value = {"available": {"cash": 10000}}
        broker.place_order.return_value = "mock-order"
        ml = live.quantumedge.ml
        ml.mode, ml.model_id = "gate", "test-model"
        ml.status = mock.Mock(return_value={"ready": True})
        approved = {**candidate, "ml": {"state": "PASS", "model_id": ml.model_id}}
        live.quantumedge_candidate.return_value = {
            **candidate, "entry": {**candidate["entry"], "maximum": 99.95}, "risk": 497.50,
        }
        with mock.patch("services.aqte_live.time.time", return_value=now), mock.patch(
            "services.aqte_service.normalize", return_value=mock.Mock(
                token=7, at=now, bid=99, ask=99.95, ask_quantity=65),
        ), mock.patch.object(ml, "assess", side_effect=[
            {"allows_review": False}, {"allows_review": True, "state": "PASS", "score": 0.8},
        ]) as assess:
            proposal = live.quantumedge_proposal_for_approval(approved, set())
            with self.assertRaisesRegex(Exception, "no longer passes"):
                live.confirm(proposal["id"])
            broker.place_order.assert_not_called()
            proposal = live.quantumedge_proposal_for_approval(approved, set())
            live.confirm(proposal["id"])
            self.assertEqual(assess.call_args.args[0]["ml_features"], candidate["ml_features"])
        broker.place_order.assert_called_once()
        self.assertEqual(broker.place_order.call_args.kwargs["price"], 99.95)
        self.assertTrue(QUANTUMEDGE_TAG.fullmatch(broker.place_order.call_args.kwargs["tag"]))
        self.assertEqual(len(live.state["daily_entries"]), 1)
        self.assertEqual(broker.place_order.call_args.kwargs["validity"], "IOC")
        self.assertEqual(live.state["active"]["execution_context"]["quantumedge_ml"]["score"], 0.8)

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
