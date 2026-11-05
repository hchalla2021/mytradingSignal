import asyncio
import copy
import json
import queue
import sqlite3
import tempfile
import unittest
from dataclasses import replace
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.aqte_engine import IST, day, intelligence
from services.aqte_morning import MorningRules, MorningService, complete_ohlcv, content_hash, event
from services.aqte_morning_store import MorningStore
from services.aqte_service import AQTEService
from services.cache import CacheService
from test_aqte import CONTRACT, START, THURSDAY, tick
import test_aqte_live as live_tests


def opening_rules(direction=1, **overrides):
    rules = MorningRules()
    for second in range(3):
        price = 22100 + second * 6 * direction
        rules.accept(tick(at=START + second, price=price, bid=price - 1, ask=price + 1,
                          volume=1000 + second * 100,
                          buy_depth=200 if direction > 0 else 100,
                          sell_depth=100 if direction > 0 else 200), {})
        rules.accept(tick("spot", at=START + second, price=22100 + second * 3 * direction), {})
    context = dict(completed=201, future_token=20, features={"atr": 20, "ema": {"9": 22010, "20": 22000},
                                          "at": THURSDAY + 374 * 60},
                   previous_close=22000, options=[(CONTRACT, tick("option", at=START + 2))])
    context.update(overrides)
    if direction < 0:
        context["options"] = [(replace(CONTRACT, side="PE"), tick("option", at=START + 2))]
    return rules, context


def market_fixture(path):
    market = AQTEService(path)
    market.started = True
    market.feed_connected = True
    market.configured_days = {"NFO": day(START), "BFO": day(START)}
    market.engine.contracts = {CONTRACT.token: CONTRACT}
    market.subscribed = {CONTRACT.token}
    market.engine.previous_day["NIFTY"] = dict(high=22020, low=21980, close=22000)
    bars = market.engine.book.closed["future", 20, 60]
    bars.extend(dict(at=THURSDAY + (174 + i) * 60, open=22000, high=22010,
                     low=21990, close=22000, volume=1000) for i in range(201))
    rules, _ = opening_rules()
    for tape in rules.tapes.values():
        for value in tape:
            market.engine.ingest(value)
    market.engine.ingest(tick("option", at=START + 2))
    morning = MorningService(market, CacheService(), "postgresql://test-only")
    morning.rules = rules
    with patch("time.time", return_value=START + 2):
        contexts = morning.collect_contexts(START + 2)
        morning.signals = {symbol: rules.evaluate(symbol, contexts[symbol], START + 2)
                           for symbol in ("NIFTY", "BANKNIFTY", "SENSEX")}
    morning.error = None
    morning.last_commit = START + 2
    market.morning = morning
    return market, morning


class MorningRulesTests(unittest.TestCase):
    def test_postgres_url_is_excluded_from_settings_exports_and_repr(self):
        from config import Settings
        field = Settings.model_fields["aqte_morning_postgres_url"]
        self.assertTrue(field.exclude)
        self.assertFalse(field.repr)

    def test_chart_candle_aggregation_keeps_ohlcv_oi_and_drops_incomplete_buckets(self):
        bars = [dict(at=START + i * 60, open=100 + i, high=105 + i, low=95 + i,
                     close=102 + i, volume=10 + i, oi=1000 + i) for i in range(7)]
        candles = complete_ohlcv(bars, 300)
        self.assertEqual(len(candles), 1)
        self.assertEqual(candles[0], dict(at=int(START // 300) * 300, open=100, high=109,
                                         low=95, close=106, volume=60, oi=1004, oi_open=1000))

    def test_snapshot_hash_ignores_capture_time_but_tracks_data_changes(self):
        first = {"at": START, "bids": [[22000, 50]], "volume": 1000}
        self.assertEqual(content_hash(first), content_hash(first | {"at": START + 1}))
        self.assertNotEqual(content_hash(first), content_hash(first | {"volume": 1001}))

    def test_real_tick_confirmation_can_qualify_at_091502_without_a_completed_opening_candle(self):
        rules, context = opening_rules()
        signal = rules.evaluate("NIFTY", context, START + 2)
        self.assertEqual(signal["decision"], "BUY CE")
        self.assertEqual(signal["strategy"], "morning_gap_and_go")
        self.assertTrue(all(rule["passed"] for rule in signal["rules"]))
        self.assertEqual(signal["entry"]["quantity"], CONTRACT.lot_size)
        self.assertFalse(signal["model_validated"])

    def test_bearish_gap_reversal(self):
        rules, context = opening_rules(-1)
        signal = rules.evaluate("NIFTY", context, START + 2)
        self.assertEqual(signal["decision"], "BUY PE")
        self.assertEqual(signal["strategy"], "morning_gap_reversal")

    def test_original_engine_still_requires_fifteen_completed_opening_minutes(self):
        with tempfile.TemporaryDirectory() as directory:
            market, morning = market_fixture(Path(directory) / "market.sqlite3")
            future = market.engine.future["NIFTY"]
            bars = list(market.engine.book.closed["future", future.token, 60])
            self.assertIsNone(intelligence(bars, future, market.engine.previous_day["NIFTY"]))
            self.assertEqual(morning.signals["NIFTY"]["decision"], "BUY CE")
            self.assertEqual(market.engine.snapshot(START + 2)["data"]["NIFTY"]["decision"], "WAIT")

    def test_no_forced_sideways_trade(self):
        rules, context = opening_rules()
        tape = rules.tapes["NIFTY", "future"]
        rules.tapes["NIFTY", "future"] = type(tape)(
            (replace(value, price=22100 + i * 0.1) for i, value in enumerate(tape)), maxlen=240)
        result = rules.evaluate("NIFTY", context, START + 2)
        self.assertEqual(result["decision"], "WAIT")
        self.assertIn("direction", [rule["id"] for rule in result["rules"] if not rule["passed"]])

    def test_missing_depth_is_unavailable_not_neutral_evidence(self):
        rules, context = opening_rules()
        tape = rules.tapes["NIFTY", "future"]
        tape[-1] = replace(tape[-1], buy_depth=0, sell_depth=0)
        signal = rules.evaluate("NIFTY", context, START + 2)
        self.assertEqual(signal["decision"], "WAIT")
        self.assertIsNone(signal["evidence"]["imbalance"])

    def test_stale_missing_history_and_recovery_each_block_only_morning(self):
        rules, context = opening_rules()
        for now, changes in ((START + 6, {}), (START + 2, {"completed": 200}),
                             (START + 2, {"future_token": 21}),
                             (START + 2, {"blocked": "Shared futures/feed recovery is incomplete"})):
            with self.subTest(now=now, changes=changes):
                result = rules.evaluate("NIFTY", context | changes, now)
                self.assertEqual(result["decision"], "WAIT")
                self.assertIsNone(result["entry"])

    def test_cutoff_and_preopen_are_not_entry_windows(self):
        rules, context = opening_rules()
        for at in (START - 1, START + 75 * 60):
            self.assertEqual(rules.evaluate("NIFTY", context, at)["decision"], "WAIT")

    def test_one_tick_does_not_confirm_a_direction(self):
        rules, context = opening_rules()
        rules.tapes["NIFTY", "future"].popleft()
        rules.tapes["NIFTY", "future"].popleft()
        self.assertEqual(rules.evaluate("NIFTY", context, START + 2)["decision"], "WAIT")

    def test_option_volume_spread_depth_and_age_are_mandatory(self):
        rules, context = opening_rules()
        quote = context["options"][0][1]
        for bad in (replace(quote, volume=0), replace(quote, bid=90),
                    replace(quote, bid_quantity=CONTRACT.lot_size - 1), replace(quote, at=START - 4)):
            with self.subTest(quote=bad):
                result = rules.evaluate("NIFTY", context | {"options": [(CONTRACT, bad)]}, START + 2)
                self.assertEqual(result["decision"], "WAIT")

    def test_equal_distance_and_spread_use_reported_oi_and_keep_ranking_liquidity(self):
        rules, context = opening_rules()
        alternative = replace(CONTRACT, token=31, trading_symbol="NIFTY_TEST_OI")
        context["options"].append((alternative, tick("option", token=31, at=START + 2, oi=5000)))
        signal = rules.evaluate("NIFTY", context, START + 2)
        self.assertEqual(signal["contract"]["token"], 31)
        self.assertEqual(signal["options"]["rows"][0]["oi"], 5000)
        self.assertGreater(signal["options"]["rows"][0]["spread"], 0)

    def test_preopen_receipt_only_index_is_not_a_verified_auction_price(self):
        rules = MorningRules()
        at = START - 10 * 60
        rules.accept(tick("spot", at=at), {"ohlc": {"close": 22000}})
        record = rules.preopen["NIFTY:spot"]
        self.assertEqual(record["time_basis"], "receipt_only")
        self.assertEqual(record["verified_count"], 0)
        self.assertEqual(record["primary_count"], 1)
        self.assertIsNone(record["indicative_auction_price"])
        self.assertIsNone(record["high"])

    def test_verified_futures_primary_window_is_frozen_after_0907(self):
        rules = MorningRules()
        for seconds, price in ((-600, 22000), (-300, 22100)):
            at = START + seconds
            rules.accept(tick(at=at, price=price), {"exchange_timestamp": datetime.fromtimestamp(at, IST),
                                                  "last_trade_time": datetime.fromtimestamp(at, IST)})
        record = rules.preopen["NIFTY:future"]
        self.assertEqual(record["primary_high"], 22000)
        self.assertEqual(record["high"], 22100)
        self.assertEqual(record["verified_count"], 2)

    def test_preopen_quote_timestamp_cannot_refresh_yesterdays_last_trade(self):
        rules = MorningRules()
        at = START - 600
        rules.accept(tick(at=at), {"exchange_timestamp": datetime.fromtimestamp(at, IST),
                                  "last_trade_time": datetime.fromtimestamp(at - 86400, IST)})
        record = rules.preopen["NIFTY:future"]
        self.assertFalse(record["price_time_verified"])
        self.assertIsNone(record["high"])

    def test_momentum_orb_sweep_scalp_and_trend_have_distinct_confirmation(self):
        for setup in ("momentum", "orb", "liquidity_sweep", "scalp", "trend_continuation"):
            with self.subTest(setup=setup):
                rules, context = opening_rules(previous_close=22100)
                now = START + 2
                if setup == "orb":
                    now += 60
                    for kind in ("spot", "future"):
                        tape = rules.tapes["NIFTY", kind]
                        rules.tapes["NIFTY", kind] = type(tape)(
                            (replace(t, at=t.at + 60, received=t.received + 60) for t in tape), maxlen=240)
                    context["options"] = [(CONTRACT, tick("option", at=now))]
                    context["opening_bar"] = dict(at=START, high=22105, low=22095)
                elif setup == "liquidity_sweep":
                    rules.preopen["NIFTY:future"] = dict(low=22104, high=22120)
                elif setup in ("scalp", "trend_continuation"):
                    context["features"]["atr"] = 30 if setup == "trend_continuation" else 40
                    if setup == "scalp":
                        context["features"]["ema"] = {"9": 22000, "20": 22010}
                signal = rules.evaluate("NIFTY", context, now)
                self.assertEqual(signal["strategy"], "morning_" + setup)

    def test_forming_opening_bar_is_never_an_orb_reference(self):
        rules, context = opening_rules(previous_close=22100)
        context["opening_bar"] = dict(at=START, high=22105, low=22095)
        signal = rules.evaluate("NIFTY", context, START + 2)
        self.assertFalse(signal["evidence"]["setup_checks"]["orb"])

    def test_duplicate_out_of_order_and_previous_day_ticks_are_rejected(self):
        rules = MorningRules()
        original = tick(at=START)
        self.assertIsNone(rules.accept(original, {}))
        self.assertEqual(rules.accept(replace(original, received=START + 1), {}), "Duplicate tick")
        self.assertEqual(rules.accept(replace(original, at=START - 1, received=START + 1), {}),
                         "Out-of-order source timestamp")
        self.assertEqual(rules.accept(replace(original, at=START - 86400), {}), "Stale/future source timestamp")

    def test_reconnect_discards_incomplete_confirmation_and_observed_vwap(self):
        rules, context = opening_rules()
        rules.accept(tick(at=START + 10, price=22200), {})
        self.assertEqual(len(rules.tapes["NIFTY", "future"]), 1)
        self.assertEqual(rules.vwap["NIFTY"]["volume"], 0)
        self.assertEqual(rules.evaluate("NIFTY", context, START + 10)["decision"], "WAIT")

    def test_exit_confirmation_works_after_entry_cutoff(self):
        rules, _ = opening_rules(-1)
        late = START + 76 * 60
        for kind in ("future", "spot"):
            rules.tapes["NIFTY", kind].clear()
        for i in range(3):
            for kind in ("future", "spot"):
                rules.accept(tick(kind, at=late + i, price=22100 - i * 4, volume=1000 + i), {})
        active = dict(symbol="NIFTY", entry_at=START, contract={"side": "CE"},
                      peak=120, entry_price=100, initial_stop=90,
                      execution_context={"morning_evidence": {"atr": 20, "reference": 22100}})
        self.assertEqual(rules.exit_reason(active, late + 2), "MORNING_FALSE_BREAKOUT")


class MorningLiveTests(unittest.TestCase):
    setUp = live_tests.LiveTests.setUp
    new_service = live_tests.LiveTests.new_service
    place = live_tests.LiveTests.place
    modify = live_tests.LiveTests.modify
    armed = live_tests.LiveTests.armed

    def prepare(self):
        self.market, self.morning = market_fixture(Path(self.directory.name) / "market.sqlite3")
        self.live.market = self.market
        self.cfg.aqte_live_allow_unvalidated_rules = True
        self.broker.quote.side_effect = lambda keys: {
            keys[0]: {"instrument_token": CONTRACT.token, "last_price": 100,
                      "timestamp": datetime.fromtimestamp(START + 2, IST), "volume": 100_000,
                      "depth": {"buy": [{"price": 99, "quantity": 100}],
                                "sell": [{"price": 101, "quantity": 100}]}}}

    def test_both_approvals_then_existing_order_path_records_real_pending_not_fill(self):
        self.prepare()
        with patch("time.time", return_value=START + 2):
            self.live.set_morning(True)
            self.armed()
            proposal = self.live.proposal("NIFTY")
            self.assertTrue(proposal["strategy"].startswith("morning_"))
            self.live.confirm(proposal["id"])
            active = self.live.state["active"]
            self.assertEqual(active["filled"], 0)
            self.assertEqual(active["quantity"], CONTRACT.lot_size)
            self.assertEqual(active["entry_id"], "1")
            self.assertEqual(active["execution_context"]["entry_engine"], "AQTE Independent Morning Engine")
            self.assertIn("morning_evidence", active["execution_context"])
            self.live.automated_entry()
            self.assertEqual(self.broker.place_order.call_count, 1)

    def test_morning_default_off_does_not_change_existing_selection(self):
        self.prepare()
        with patch("time.time", return_value=START + 2):
            self.armed()
            self.live.automated_entry()
            self.broker.place_order.assert_not_called()
            self.assertFalse(self.live.state.get("morning_enabled", False))

    def test_morning_approval_cannot_bypass_global_auto_trade(self):
        self.prepare()
        with patch("time.time", return_value=START + 2):
            self.live.set_morning(True)
            with self.assertRaisesRegex(live_tests.LiveBlocked, "OFF"):
                self.live.proposal("NIFTY")
            self.broker.place_order.assert_not_called()

    def test_storage_and_validation_faults_block_morning_not_regular_styles(self):
        self.prepare()
        with patch("time.time", return_value=START + 2):
            self.live.set_morning(True)
            signal = self.morning.signals["NIFTY"]
            self.morning.error = "Durable storage unavailable"
            self.assertIn("storage", self.live.control_reason("NIFTY", signal).lower())
            self.morning.error = None
            self.cfg.aqte_live_allow_unvalidated_rules = False
            self.assertIn("not paper-validated", self.live.control_reason("NIFTY", signal))

    def test_emergency_stop_blocks_new_morning_approval(self):
        self.prepare()
        self.live.state["killed"] = True
        with self.assertRaisesRegex(live_tests.LiveBlocked, "Emergency stop"):
            self.live.set_morning(True)
        self.assertIsNot(self.live.state.get("morning_enabled"), True)

    def test_setup_families_share_one_opportunity_identity_but_directions_do_not(self):
        self.prepare()
        signal = self.morning.signals["NIFTY"]
        key = self.live.setup_key("NIFTY", signal)
        self.assertEqual(key, self.live.setup_key("NIFTY", signal | {"strategy": "morning_momentum"}))
        self.assertNotEqual(key, self.live.setup_key("NIFTY", signal | {"decision": "BUY PE"}))

    def test_morning_stop_is_not_overwritten_by_swing_percentage(self):
        self.prepare()
        with patch("time.time", return_value=START + 2):
            signal = self.morning.signals["NIFTY"]
            self.live.state["daily_controls"]["NIFTY"]["stop_percent"] = 30
            entry, risk = self.live.entry_levels("NIFTY", signal)
            self.assertEqual(entry["stop"], signal["entry"]["stop"])
            self.assertGreaterEqual(entry["reward_risk"], 1.5)
            self.assertLessEqual(risk, self.cfg.aqte_live_risk_per_trade)

    def test_partial_fill_is_protected_and_turning_off_morning_does_not_remove_it(self):
        self.prepare()
        with patch("time.time", return_value=START + 2):
            self.live.set_morning(True)
            self.armed()
            proposal = self.live.proposal("NIFTY")
            self.live.confirm(proposal["id"])
            self.orders[0].update(status="CANCELLED", filled_quantity=5, average_price=101)
            self.positions = [{"instrument_token": CONTRACT.token, "product": "MIS", "quantity": 5,
                               "exchange": CONTRACT.exchange, "tradingsymbol": CONTRACT.trading_symbol,
                               "last_price": 100}]
            self.live.reconcile()
            self.assertEqual(self.orders[1]["quantity"], 5)
            self.assertEqual(self.orders[1]["transaction_type"], "SELL")
            self.assertEqual(self.orders[1]["order_type"], "SL")
            self.assertEqual(self.live.state["active"]["filled"], 5)
            self.live.set_morning(False)
            self.assertEqual(self.live.state["active"]["protect_id"], "2")
            self.assertEqual(self.morning.active_token, CONTRACT.token)

    def test_manual_contract_is_untouched_and_alternate_strike_uses_morning_stop(self):
        self.prepare()
        alternate = replace(CONTRACT, token=31, strike=22050, trading_symbol="NIFTY_TEST_ALT")
        self.market.engine.contracts[31] = alternate
        self.market.subscribed.add(31)
        self.market.engine.options[31] = tick("option", token=31, at=START + 2, price=63, bid=62, ask=63)
        self.positions = [{"instrument_token": CONTRACT.token, "product": "MIS", "quantity": 15,
                           "exchange": CONTRACT.exchange, "tradingsymbol": CONTRACT.trading_symbol, "last_price": 100}]
        original_positions = copy.deepcopy(self.positions)
        with patch("time.time", return_value=START + 2):
            self.live.set_morning(True)
            self.armed()
            proposal = self.live.proposal("NIFTY")
            self.assertEqual(proposal["contract"]["token"], 31)
            self.assertEqual(proposal["setup_key"], self.live.setup_key("NIFTY", self.morning.signals["NIFTY"]))
            self.assertIn("risk_distance", proposal["entry"])
            self.assertEqual(self.positions, original_positions)
            self.broker.modify_order.assert_not_called()
            self.broker.cancel_order.assert_not_called()

    def test_morning_rejection_and_expiry_are_in_existing_opportunity_journal(self):
        self.prepare()
        with patch("time.time", return_value=START + 2):
            self.armed()
            self.live.record_opportunities(self.market.snapshot())
            record = next(value for value in self.live.opportunities.values() if value["style"] == "morning")
            self.assertEqual(record["state"], "REJECTED")
            self.assertIn("approval", record["reason"])
            self.morning.signals["NIFTY"].update(decision="WAIT", entry=None, contract=None)
            self.live.record_opportunities(self.market.snapshot())
            self.assertEqual(self.live.opportunities[record["key"]]["state"], "EXPIRED")

    def test_owner_auth_and_matching_confirmation_are_required(self):
        from routers import aqte
        app = FastAPI()
        app.include_router(aqte.router)
        with TestClient(app) as client:
            response = client.post("/api/aqte/live/morning", json={
                "enabled": True, "confirmation": "ENABLE MORNING REAL TRADING"})
            self.assertEqual(response.status_code, 403)
            app.dependency_overrides[aqte.live_operator] = lambda: "test-owner"
            response = client.post("/api/aqte/live/morning", json={
                "enabled": False, "confirmation": "ENABLE MORNING REAL TRADING"})
            self.assertEqual(response.status_code, 422)


class MorningRecorderTests(unittest.IsolatedAsyncioTestCase):
    async def test_shared_enqueue_to_commit_to_snapshot_wakes_the_existing_controller(self):
        with tempfile.TemporaryDirectory() as directory:
            market, _ = market_fixture(Path(directory) / "market.sqlite3")
            store = Mock(dsn="postgresql://offline-test", pool=object(), error=None)
            store.backend = "postgresql"
            store.configured = True
            store.connect = AsyncMock(return_value=True)
            store.restore = AsyncMock(return_value={"preopen": {}, "lost": False})
            store.close = AsyncMock()
            writing, release = asyncio.Event(), asyncio.Event()

            async def write(records):
                writing.set()
                await release.wait()

            store.write = AsyncMock(side_effect=write)
            morning = MorningService(market, CacheService(), store=store)
            market.morning = morning
            market.listener = Mock()
            for second in range(3):
                at = START + second
                with patch("time.time", return_value=at):
                    for kind, token, increment in (("future", 20, 6), ("spot", 10, 3)):
                        price = 22100 + second * increment
                        market.enqueue("NIFTY", kind, {
                            "instrument_token": token, "last_price": price, "volume_traded": 1000 + second * 100,
                            "exchange_timestamp": datetime.fromtimestamp(at, IST),
                            "depth": {"buy": [{"price": price - 1, "quantity": 200}],
                                      "sell": [{"price": price + 1, "quantity": 100}]}})
            with patch("time.time", return_value=START + 2):
                await morning.start()
                try:
                    with patch("services.order_flow_engine.order_flow_engine.live_summary", return_value={
                        "at": START + 2, "bids": [[22099, 20, 2]], "asks": [[22101, 30, 2]],
                        "estimated_buy_aggressor_volume": 100, "estimated_sell_aggressor_volume": 20,
                        "unclassified_volume": 10, "aggressor_side_is_estimated": True}):
                        await asyncio.wait_for(writing.wait(), 2)
                        self.assertEqual(morning.signals, {}, "An uncommitted signal must not be published")
                        release.set()
                        for _ in range(100):
                            if morning.signals and market.listener.called:
                                break
                            await asyncio.sleep(0.01)
                        snapshot = market.snapshot()
                        self.assertEqual(snapshot["data"]["NIFTY"]["morning"]["decision"], "BUY CE")
                        self.assertEqual(snapshot["data"]["NIFTY"]["decision"], "WAIT")
                        self.assertEqual(market.diagnostics()["morning"]["last_commit"], START + 2)
                        self.assertTrue(market.listener.called)
                        records = store.write.call_args.args[0]
                        self.assertEqual(sum(r["kind"] == "TICK" for r in records), 6)
                        self.assertTrue(any(r["kind"] == "DECISION" for r in records))
                        candles = next(r for r in records if r["kind"] == "CHART_CANDLES")
                        self.assertEqual(len(candles["payload"]["futures_1m"]), 201)
                        self.assertEqual(candles["payload"]["historical_candles_completed"], 201)
                        flow = next(r for r in records if r["kind"] == "ORDER_FLOW")
                        self.assertTrue(flow["payload"]["aggressor_side_is_estimated"])
                        self.assertTrue(flow["payload"]["fresh"])
                        chain = next(r for r in records if r["kind"] == "OPTION_CHAIN")
                        self.assertEqual(len(chain["payload"]["contracts"]), 1)
                        self.assertEqual(chain["payload"]["contracts"][0]["bid"], 99)
                        self.assertIsNone(chain["payload"]["pcr"])
                finally:
                    release.set()
                    await morning.stop()

    async def test_sqlite_wal_write_is_idempotent_and_restores_preopen_and_loss_state(self):
        with tempfile.TemporaryDirectory() as directory:
                    store = MorningStore(path=Path(directory) / "morning.sqlite3")
                    await store.connect()
                    context = {"NIFTY:future": {"primary_high": 22000, "primary_low": 21900}}
                    records = [
                        event("PREOPEN_CONTEXT", START, context),
                        {"id": f"DATA_LOSS:{day(START)}", "at": START, "symbol": None,
                         "kind": "DATA_LOSS", "payload": {"reason": "queue overflow"}},
                    ]
                    await store.write(records)
                    await store.write(records)
                    restored = await store.restore(START)
                    self.assertEqual(restored["preopen"], context)
                    self.assertTrue(restored["lost"])
                    connection = sqlite3.connect(store.path)
                    try:
                        self.assertEqual(connection.execute("SELECT COUNT(*) FROM aqte_morning_events").fetchone()[0], 2)
                    finally:
                        connection.close()
                    await store.close()

    async def test_default_sqlite_wal_records_durably_without_postgres_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            market = AQTEService(Path(directory) / "market.sqlite3")
            path = Path(directory) / "morning.sqlite3"
            morning = MorningService(market, CacheService(), store=MorningStore(path=path))
            await morning.start()
            for _ in range(40):
                if morning.last_commit:
                    break
                await asyncio.sleep(0.01)
            self.assertEqual(morning.store.backend, "sqlite-wal")
            self.assertTrue(path.exists())
            self.assertIsNotNone(morning.last_commit)
            self.assertIsNone(morning.error)
            await morning.stop()

    async def test_bounded_queue_overflow_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            morning = MorningService(AQTEService(Path(directory) / "market.sqlite3"), CacheService())
            morning.queue = queue.Queue(maxsize=1)
            record = event("TEST", START, {})
            morning.put(record)
            morning.put(record)
            morning.error = None
            morning.last_commit = START
            self.assertEqual(morning.queue.qsize(), 1)
            self.assertIn("lost data", morning.block_reason(START))

    async def test_postgres_write_is_transactional_and_conflict_safe(self):
        store = MorningStore("postgresql://test-only")
        connection = Mock()
        connection.executemany = AsyncMock()
        connection.transaction.return_value = AsyncMock()
        store.pool = Mock()
        store.pool.acquire.return_value = AsyncMock()
        store.pool.acquire.return_value.__aenter__.return_value = connection
        store.ready = True
        record = event("DECISION", START, {"observed": datetime.fromtimestamp(START, IST)}, "NIFTY")
        await store.write([record])
        sql, rows = connection.executemany.call_args.args
        self.assertIn("ON CONFLICT(id) DO NOTHING", sql)
        self.assertEqual(rows[0][0], record["id"])
        self.assertEqual(json.loads(rows[0][4])["observed"], datetime.fromtimestamp(START, IST).isoformat())
        self.assertEqual(store.last_commit, START)

    async def test_commit_failure_never_publishes_a_qualified_signal(self):
        with tempfile.TemporaryDirectory() as directory:
            market, morning = market_fixture(Path(directory) / "market.sqlite3")
            morning.signals = {}
            morning.restored_day = day(START)
            morning.store = Mock(dsn="postgresql://test-only", pool=object())
            morning.store.write = AsyncMock(side_effect=OSError("test database outage"))
            morning.store.close = AsyncMock()
            morning.stopping = True
            morning.put(event("TEST", START + 2, {}))
            with patch("time.time", return_value=START + 2):
                await morning.run()
            self.assertEqual(morning.signals, {})
            self.assertIn("storage unavailable", morning.error)
            self.assertEqual(morning.store.write.await_count, 1)

    async def test_preopen_restore_keeps_primary_window_and_loss_latch(self):
        store = MorningStore("postgresql://test-only")
        store.pool = Mock()
        store.ready = True
        context = {"NIFTY:future": {"primary_high": 22000, "primary_low": 21900, "time_basis": "exchange"}}
        store.pool.fetchval = AsyncMock(side_effect=[json.dumps(context), True])
        restored = await store.restore(START)
        self.assertEqual(restored["preopen"], context)
        self.assertTrue(restored["lost"])
        self.assertIn(f"DATA_LOSS:{day(START)}", store.pool.fetchval.call_args.args)

    def test_orderflow_summary_exposes_five_level_imbalance_profile_walls_and_oi_change(self):
        from services.order_flow_engine import OrderFlowEngine
        with tempfile.TemporaryDirectory() as directory:
            engine = OrderFlowEngine(Path(directory) / "flow.sqlite3")
            depth = {"buy": [{"price": 99 - i, "quantity": 1000 if i == 0 else 20, "orders": 3} for i in range(5)],
                     "sell": [{"price": 101 + i, "quantity": 10, "orders": 1} for i in range(5)]}
            for second in range(8):
                engine.ingest_futures("NIFTY", 20, {
                    "last_price": 101, "volume_traded": 1000 + second * 100,
                    "exchange_timestamp": datetime.fromtimestamp(START + second, IST), "depth": depth,
                    "total_buy_quantity": 1080, "total_sell_quantity": 50, "oi": 1000 + second,
                    "oi_day_high": 1025, "oi_day_low": 990})
            summary = engine.live_summary("NIFTY")
            self.assertEqual(summary["best_bid"], 99)
            self.assertEqual(summary["best_ask"], 101)
            self.assertGreater(summary["five_level_depth_imbalance"], 0)
            self.assertEqual(summary["estimated_buy_aggressor_volume"], 700)
            self.assertEqual(summary["oi_change_this_minute"], 7)
            self.assertTrue(summary["volume_profile"])
            self.assertTrue(summary["depth_zones"])
            self.assertTrue(summary["aggressor_side_is_estimated"])

    async def test_option_tick_is_saved_once_with_full_available_depth_volume_and_oi(self):
        with tempfile.TemporaryDirectory() as directory:
            market = AQTEService(Path(directory) / "market.sqlite3")
            market.engine.contracts[CONTRACT.token] = CONTRACT
            morning = Mock()
            market.morning = morning
            raw = {"instrument_token": CONTRACT.token, "last_price": 100, "volume_traded": 1234, "oi": 5678,
                   "exchange_timestamp": datetime.fromtimestamp(START, IST),
                   "depth": {"buy": [{"price": 99, "quantity": 30, "orders": 2}],
                             "sell": [{"price": 101, "quantity": 45, "orders": 3}]}}
            with patch("services.aqte_service.time.time", return_value=START):
                self.assertTrue(market.option_tick(raw))
            morning.enqueue.assert_called_once_with("NIFTY", "option", raw)
            self.assertEqual(raw["depth"]["buy"][0]["orders"], 2)

    async def test_invalid_nonfinite_tick_is_recorded_as_rejected_without_poisoning_batch(self):
        with tempfile.TemporaryDirectory() as directory:
            market, morning = market_fixture(Path(directory) / "market.sqlite3")
            records = [event("TICK", START + 2, {"kind": "future", "raw": {
                "instrument_token": 20, "last_price": float("nan")}}, "NIFTY")]
            with patch("time.time", return_value=START + 2):
                morning.process(records)
            self.assertEqual(records[0]["payload"]["analysis_rejection"], "Malformed non-JSON tick payload")
            json.dumps(records, allow_nan=False)

    async def test_after_cutoff_only_active_morning_contract_and_underlyings_are_captured(self):
        with tempfile.TemporaryDirectory() as directory:
            morning = MorningService(AQTEService(Path(directory) / "market.sqlite3"), CacheService())
            with patch("time.time", return_value=START + 76 * 60):
                morning.enqueue("NIFTY", "future", {"instrument_token": 20})
                self.assertTrue(morning.queue.empty())
                morning.active_token = 30
                morning.enqueue("NIFTY", "option", {"instrument_token": 31})
                self.assertTrue(morning.queue.empty())
                morning.enqueue("NIFTY", "option", {"instrument_token": 30})
                morning.enqueue("NIFTY", "future", {"instrument_token": 20})
                self.assertEqual(morning.queue.qsize(), 2)


if __name__ == "__main__":
    unittest.main()
