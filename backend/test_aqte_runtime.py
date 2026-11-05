"""Offline regressions for AQTE preparation, bounded scheduling, recovery and measured diagnostics."""

import asyncio
import copy
import json
import queue
import sqlite3
import statistics
import sys
import tempfile
import threading
import time
import unittest
from dataclasses import replace
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.aqte_engine import AQTEEngine, CandleBook, IST, closed_intelligence, day, intelligence, live_intelligence
from services.aqte_engines import option_chain, prepare_evaluation, resample
from services.aqte_features import FeatureCache
from services.aqte_live import AQTELiveService
from services.aqte_runtime import EngineWorkers, Latencies
from services.aqte_service import AQTEService
from services.instrument_catalog import InstrumentCatalog
from test_aqte import NOW, START, THURSDAY, ready_engine, tick
from test_aqte_engines import bars


def wait_until(predicate):
    deadline = time.monotonic() + 3
    while not predicate():
        if time.monotonic() >= deadline:
            raise AssertionError("Bounded background operation did not complete")
        time.sleep(.005)


class FeatureTests(unittest.TestCase):
    def test_same_candle_cache_is_exact_and_live_depth_and_oi_are_not_cached(self):
        baseline = ready_engine(paper_enabled=False)
        optimized = copy.deepcopy(baseline)
        metrics = Latencies()
        optimized.feature_cache = FeatureCache(metrics)
        for index in range(1, 50):
            update = tick(at=NOW + index / 100, price=22040 + index / 10,
                          buy_depth=200 + index, oi=1000 + index)
            baseline.ingest(update)
            optimized.ingest(update)
            self.assertEqual(optimized.signals, baseline.signals)
        counters = metrics.snapshot()["counters"]
        self.assertEqual(counters["feature_revisions"], 1)
        self.assertEqual(counters["feature_cache_hits"], 48)

    def test_cache_preserves_full_session_vwap_beyond_201_bars(self):
        engine = AQTEEngine(paper_enabled=False)
        history = bars(300)
        at = START + 300 * 60
        engine.seed_bars(20, history, at)
        future = tick(at=at)
        cached = FeatureCache(Latencies()).get(engine.book, 20, at)
        actual = live_intelligence(cached["values"], future)
        self.assertEqual(actual, intelligence(history, future))
        self.assertNotEqual(actual["vwap"], intelligence(history[-201:], future)["vwap"])

    def test_history_correction_and_previous_day_context_invalidate_cache(self):
        engine = ready_engine(paper_enabled=False)
        features = FeatureCache(Latencies())
        first = features.get(engine.book, 20, NOW, engine.previous_day["NIFTY"])
        correction = {**list(engine.book.closed[("future", 20, 60)])[10], "volume": 500_000}
        self.assertEqual(engine.seed_bars(20, [correction], NOW), 1)
        corrected = features.get(engine.book, 20, NOW, engine.previous_day["NIFTY"])
        self.assertNotEqual(first["values"]["vwap"], corrected["values"]["vwap"])
        changed = features.get(engine.book, 20, NOW, dict(high=22100, low=22000, close=22050))
        self.assertNotEqual(corrected["values"]["cpr"], changed["values"]["cpr"])

    def test_partial_features_enable_independent_rules_without_enabling_entry(self):
        engine = AQTEEngine(paper_enabled=False)
        at = START + 22 * 60
        engine.seed_bars(20, bars(22), at)
        engine.ingest(tick("spot", at=at, price=111))
        engine.ingest(tick(at=at, price=111))
        signal = engine.snapshot(at)["data"]["NIFTY"]
        self.assertEqual(signal["decision"], "WAIT")
        partial = FeatureCache(Latencies()).get(engine.book, 20, at)
        jobs, _ = prepare_evaluation(signal, live=engine.future["NIFTY"], spot=engine.spot["NIFTY"],
                                     bars=partial["bars"], partial_info=live_intelligence(
                                         partial["values"], engine.future["NIFTY"]), now=at)
        self.assertNotEqual(jobs["momentum"]()["status"], "MONITORING")
        self.assertEqual(jobs["trend"]()["status"], "MONITORING")
        self.assertIsNone(partial["values"]["ema"]["200"])

    def test_higher_timeframes_reject_interior_missing_minutes(self):
        history = bars(15)
        self.assertEqual(len(resample(history, 300)), 3)
        self.assertEqual(len(resample(history[:3] + history[4:], 300)), 2)
        self.assertEqual(resample(history[:3] + history[4:], 900), [])

    def test_adx_readiness_and_pivots_use_real_completed_bars(self):
        previous = dict(high=110, low=90, close=100)
        short = closed_intelligence(bars(20), START + 20 * 60, previous, partial=True)
        complete = closed_intelligence(bars(28), START + 28 * 60, previous, partial=True)
        self.assertIsNone(short["adx"])
        self.assertAlmostEqual(complete["adx"], 100)
        self.assertEqual(complete["pivots"], dict(pivot=100, r1=110, s1=90, r2=120, s2=80))

    def test_duplicate_and_out_of_order_ticks_do_not_change_bars(self):
        book = CandleBook()
        first = tick()
        self.assertTrue(book.add(first))
        self.assertFalse(book.add(replace(first, received=NOW + .1)))
        self.assertFalse(book.add(replace(first, at=NOW - 1, received=NOW + .2)))
        self.assertTrue(book.add(replace(first, buy_depth=300, received=NOW + .3)))
        self.assertEqual(dict(book.rejected), dict(duplicate=1, out_of_order=1))

    def test_arriving_option_quote_rechecks_live_rules_without_waiting_for_another_futures_tick(self):
        engine = ready_engine(paper_enabled=False)
        self.assertEqual(engine.signals["NIFTY"]["decision"], "BUY CE")
        engine.options.clear()
        engine.analyze("NIFTY", NOW)
        self.assertEqual(engine.signals["NIFTY"]["decision"], "WAIT")
        engine.ingest(tick("option", at=NOW + .1))
        self.assertEqual(engine.signals["NIFTY"]["decision"], "BUY CE")
        self.assertEqual(engine.future["NIFTY"].at, NOW)


class SchedulingTests(unittest.TestCase):
    def test_option_features_run_only_in_their_own_job(self):
        engine = ready_engine(paper_enabled=False)
        with patch("services.aqte_engines.option_chain", wraps=option_chain) as calculate:
            jobs, metadata = prepare_evaluation(engine.snapshot(NOW)["data"]["NIFTY"],
                                               live=engine.future["NIFTY"], spot=engine.spot["NIFTY"], now=NOW)
            jobs["momentum"]()
            calculate.assert_not_called()
            self.assertIsNone(metadata["options"])
            jobs["options"]()
            calculate.assert_called_once()
            self.assertIsNotNone(metadata["options"])

    def test_option_feature_failure_cannot_prevent_unrelated_engine_evaluation(self):
        engine = ready_engine(paper_enabled=False)
        with patch("services.aqte_engines.option_chain", side_effect=ValueError("Invalid option feature")):
            jobs, metadata = prepare_evaluation(engine.snapshot(NOW)["data"]["NIFTY"],
                                               live=engine.future["NIFTY"], spot=engine.spot["NIFTY"], now=NOW)
            with self.assertRaises(ValueError):
                jobs["options"]()
            self.assertNotEqual(jobs["momentum"]()["status"], "MONITORING")
            self.assertIsNone(metadata["options"])

    def test_slow_or_failed_engine_does_not_block_others_and_pending_work_is_bounded(self):
        release, started, healthy = threading.Event(), threading.Event(), threading.Event()
        metrics = Latencies()
        workers = EngineWorkers(metrics)
        observed = []
        def slow():
            started.set()
            release.wait(5)
            return {"status": "MONITORING"}
        try:
            workers.submit("NIFTY", "momentum", NOW, slow)
            self.assertTrue(started.wait(1))
            for index in range(100):
                workers.submit("NIFTY", "momentum", NOW + index, lambda index=index: observed.append(index) or {})
            workers.submit("NIFTY", "breakout", NOW, lambda: 1 / 0)
            workers.submit("BANKNIFTY", "trend", NOW, lambda: healthy.set() or {})
            self.assertTrue(healthy.wait(1), "Independent engines must publish before the slow evaluator finishes")
            self.assertEqual(workers.diagnostics()["pending"], 1)
            release.set()
            wait_until(lambda: workers.diagnostics()["running"] == 0)
            self.assertEqual(observed, [99])
            self.assertEqual(metrics.snapshot()["counters"]["engine_jobs_coalesced"], 99)
            self.assertIn("ZeroDivisionError", workers.snapshot()[("NIFTY", "breakout")]["error"])
        finally:
            release.set()
            workers.close()

    def test_running_snapshots_do_not_evaluate_engines_and_expired_votes_are_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            service = AQTEService(Path(directory) / "aqte.sqlite3")
            service.engine = ready_engine(paper_enabled=False)
            service.started = True
            service.configured_days = {"NFO": day(NOW), "BFO": day(NOW)}
            service.evaluators = EngineWorkers(service.metrics)
            try:
                with patch("services.aqte_service.time.time", return_value=NOW):
                    service.schedule_engines()
                    wait_until(lambda: service.evaluators.diagnostics()["running"] == 0)
                    with patch("services.aqte_service.evaluate", side_effect=AssertionError("HTTP recomputation")):
                        snapshot = service.snapshot()
                    self.assertEqual(len(snapshot["data"]["NIFTY"]["engines"]), 12)
                    self.assertTrue(service.metrics.snapshot()["latency"])
                with patch("services.aqte_service.time.time", return_value=NOW + 6):
                    snapshot = service.snapshot()
                    self.assertEqual(snapshot["data"]["NIFTY"]["orchestration"]["monitoring"], 12)
            finally:
                service.evaluators.close()

    def test_latency_samples_are_bounded_and_report_actual_observations(self):
        metrics = Latencies(capacity=4)
        for value in range(20):
            metrics.observe("test", value)
        report = metrics.snapshot()["latency"]["test"]
        self.assertEqual((report["count"], report["samples"], report["max_ms"]), (20, 4, 19))
        self.assertEqual(report["p50_ms"], 17)


class PreparationTests(unittest.TestCase):
    def test_catalog_diagnostics_do_not_wait_for_broker_downloads(self):
        cache, broker = InstrumentCatalog(), Mock()
        started, release, inspected = threading.Event(), threading.Event(), threading.Event()
        def download(exchange):
            started.set()
            release.wait(5)
            return [dict(instrument_token=20)]
        broker.instruments.side_effect = download
        refresh = threading.Thread(target=lambda: cache.get(broker, "NFO"))
        inspect = threading.Thread(target=lambda: (cache.diagnostics(), inspected.set()))
        refresh.start()
        try:
            self.assertTrue(started.wait(1))
            inspect.start()
            self.assertTrue(inspected.wait(1), "Monitoring must not wait behind network I/O")
        finally:
            release.set()
            refresh.join(5)
            if inspect.ident is not None:
                inspect.join(5)

    def test_daily_master_is_shared_persistent_and_never_uses_yesterday_after_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = InstrumentCatalog(directory)
            broker = Mock()
            broker.instruments.return_value = [dict(instrument_token=20, expiry=datetime(2026, 11, 24).date())]
            now = datetime.fromtimestamp(NOW, IST)
            self.assertIs(cache.get(broker, "NFO", now), cache.get(broker, "NFO", now))
            restored = InstrumentCatalog(directory)
            self.assertEqual(restored.get(broker, "NFO", now)[0]["expiry"], datetime(2026, 11, 24).date())
            self.assertEqual(broker.instruments.call_count, 1)
            broker.instruments.side_effect = ConnectionError("offline")
            with self.assertRaises(ConnectionError):
                restored.get(broker, "NFO", now + timedelta(days=1))
            self.assertEqual(restored.diagnostics()["NFO"]["error"], "ConnectionError")

    def test_corrupt_daily_master_is_refetched_not_treated_as_ready(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "NFO.json").write_text(json.dumps(dict(day=day(NOW), rows=[])), encoding="utf-8")
            cache, broker = InstrumentCatalog(directory), Mock()
            broker.instruments.return_value = [dict(instrument_token=20)]
            self.assertEqual(cache.get(broker, "NFO", datetime.fromtimestamp(NOW, IST)), [dict(instrument_token=20)])
            broker.instruments.assert_called_once_with("NFO")

    def test_preopen_history_completes_previous_session_without_fabricating_opening_bars(self):
        with tempfile.TemporaryDirectory() as directory:
            service = AQTEService(Path(directory) / "aqte.sqlite3")
            preopen = START - 20 * 60
            service.engine.book.add(tick(at=THURSDAY + 374 * 60))
            broker = Mock()
            broker.historical_data.return_value = [
                dict(date=datetime.fromtimestamp(THURSDAY + index * 60, IST),
                     open=100, high=102, low=99, close=101, volume=100)
                for index in range(375)]
            self.assertEqual(service.backfill(broker, {20: "NIFTY"}, preopen), 375)
            features = service.features.get(service.engine.book, 20, preopen)
            self.assertEqual(features["completed"], 201)
            self.assertEqual(features["opening"], 0)
            self.assertIsNotNone(features["values"]["ema"]["200"])
            self.assertIsNone(features["values"]["vwap"])
            broker.place_order.assert_not_called()

    def test_futures_gap_requires_authoritative_history_before_recovery(self):
        with tempfile.TemporaryDirectory() as directory:
            service = AQTEService(Path(directory) / "aqte.sqlite3")
            service.engine = ready_engine(paper_enabled=False)
            missing = NOW - 180
            service.mark_gap("NIFTY", "future", 20, missing, "Test queue overflow")
            broker = Mock()
            broker.historical_data.return_value = [
                dict(date=datetime.fromtimestamp(missing, IST), open=22000, high=22001, low=21999, close=22000, volume=100)]
            service.backfill(broker, {20: "NIFTY"}, NOW)
            self.assertNotIn(20, service.gaps)
            self.assertEqual(service.metrics.snapshot()["counters"]["feed_recoveries"], 1)

    def test_disconnect_marks_futures_for_repair_without_locking_the_tick_worker(self):
        with tempfile.TemporaryDirectory() as directory:
            service = AQTEService(Path(directory) / "aqte.sqlite3")
            service.engine = ready_engine(paper_enabled=False)
            disconnected = threading.Event()
            callback = threading.Thread(target=lambda: (service.set_feed_connection(False), disconnected.set()))
            self.addCleanup(callback.join, 5)
            with service.lock:
                callback.start()
                self.assertTrue(disconnected.wait(1), "Kite callbacks must not wait for the market lock")
            self.assertEqual(service.gaps[20]["minutes"], {NOW})
            service.set_feed_connection(True)
            self.assertIn(20, service.gaps, "Reconnect alone does not prove complete candles")

    def test_loss_across_minutes_also_repairs_the_resumed_cumulative_volume(self):
        with tempfile.TemporaryDirectory() as directory:
            service = AQTEService(Path(directory) / "aqte.sqlite3")
            service.initialize()
            service.engine.book.add(tick(at=NOW - 1, volume=100))
            service.started = True
            service.queue = queue.Queue(maxsize=1)
            service.queue.put(tick("spot"))
            with patch("services.aqte_service.time.time", return_value=NOW):
                service.enqueue("NIFTY", "future", dict(instrument_token=20, last_price=22000, volume=500,
                                                       exchange_timestamp=datetime.fromtimestamp(NOW, IST)))
            service.queue.get_nowait()
            service.queue.put(tick(at=NOW + 60, volume=1000))
            service.stop_event.set()
            with patch("services.aqte_service.time.time", return_value=NOW + 60):
                service.run()
            self.assertIn(NOW + 60, service.gaps[20]["minutes"])
            self.assertEqual(service.engine.book.current[("future", 20, 60)]["volume"], 900)
            service.engine.book.add(tick(at=NOW + 240, volume=1500))
            broker = Mock()
            broker.historical_data.return_value = [
                dict(date=datetime.fromtimestamp(at, IST), open=22000, high=22001, low=21999, close=22000, volume=500)
                for at in (NOW, NOW + 60)]
            service.backfill(broker, {20: "NIFTY"}, NOW + 240)
            self.assertNotIn(20, service.gaps)
            repaired = next(b for b in service.engine.book.closed[("future", 20, 60)] if b["at"] == NOW + 60)
            self.assertEqual(repaired["volume"], 500)

    def test_restart_cannot_forget_unverified_futures_candles(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "aqte.sqlite3"
            original = AQTEService(path)
            original.initialize()
            with original.connect() as db:
                original.persist(db, [tick(at=NOW - 60), tick(at=NOW, volume=1000)])
            restored = AQTEService(path)
            with patch("services.aqte_service.datetime") as clock:
                clock.now.return_value = datetime.fromtimestamp(NOW, IST)
                restored.initialize()
            self.assertEqual(restored.gaps[20]["minutes"], {NOW - 60, NOW})
            self.assertIn("exchange verification", restored.gaps[20]["reason"])

    def test_obsolete_gap_outside_retained_history_cannot_block_forever(self):
        with tempfile.TemporaryDirectory() as directory:
            service = AQTEService(Path(directory) / "aqte.sqlite3")
            service.engine = ready_engine(paper_enabled=False)
            service.mark_gap("NIFTY", "future", 20, THURSDAY, "Old outage")
            broker = Mock()
            broker.historical_data.side_effect = AssertionError("Gap no longer affects any retained features")
            service.backfill(broker, {20: "NIFTY"}, NOW)
            self.assertNotIn(20, service.gaps)
            broker.historical_data.assert_not_called()

    def test_malformed_packet_is_rejected_before_it_can_corrupt_the_journal(self):
        with tempfile.TemporaryDirectory() as directory:
            service = AQTEService(Path(directory) / "aqte.sqlite3")
            service.started = True
            service.enqueue("NIFTY", "spot", dict(instrument_token=10, last_price=float("nan")))
            self.assertTrue(service.queue.empty())
            self.assertFalse(service.failed.is_set())
            self.assertEqual(service.metrics.snapshot()["counters"]["malformed_ticks"], 1)

    def test_short_lived_opportunity_is_journaled_even_between_controller_scans(self):
        with tempfile.TemporaryDirectory() as directory:
            service = AQTEService(Path(directory) / "aqte.sqlite3")
            service.initialize()
            service.engine = ready_engine(paper_enabled=False)
            service.capture_signals(NOW)
            generated = [event for event in service.engine.events if event["kind"] == "OPPORTUNITY_GENERATED"]
            self.assertTrue(generated)
            service.engine.signals["NIFTY"].update(decision="WAIT", entry=None, scalp=None)
            service.capture_signals(NOW + .01)
            with service.connect() as db:
                service.persist(db)
            events = service.history(100)["events"]
            expired = {event["key"] for event in events if event["kind"] == "OPPORTUNITY_EXPIRED"}
            self.assertTrue({event["key"] for event in generated}.issubset(expired))


class EventLoopTests(unittest.IsolatedAsyncioTestCase):
    async def test_transient_journal_failure_retries_without_losing_or_duplicating_the_batch(self):
        with tempfile.TemporaryDirectory() as directory:
            service = AQTEService(Path(directory) / "aqte.sqlite3")
            persist = service.persist
            attempted = threading.Event()
            def unavailable_once(db, ticks, record=None):
                if not attempted.is_set():
                    attempted.set()
                    raise sqlite3.OperationalError("Temporary journal outage")
                return persist(db, ticks, record)
            service.queue.put(tick("spot", at=time.time()))
            with patch.object(service, "persist", side_effect=unavailable_once):
                await service.start()
                try:
                    await asyncio.to_thread(wait_until, service.failed.is_set)
                    self.assertFalse(service.snapshot()["recording"])
                    await asyncio.to_thread(wait_until, lambda: not service.failed.is_set())
                    self.assertTrue(service.snapshot()["recording"])
                    self.assertIsNone(service.engine.fault)
                    with service.connect() as db:
                        self.assertEqual(db.execute("SELECT COUNT(*) FROM aqte_ticks").fetchone()[0], 1)
                    self.assertEqual(service.metrics.snapshot()["counters"]["journal_recoveries"], 1)
                finally:
                    await service.stop()

    async def test_order_updates_wake_existing_monitor_without_tick_driven_rest_polling(self):
        live = AQTELiveService(market=Mock(), settings=Mock())
        live.loop = asyncio.get_running_loop()
        scanned = threading.Event()
        live.reconcile = Mock()
        live.prepare_session = Mock()
        live.auto_activate = Mock()
        live.scan_entries = Mock(side_effect=scanned.set)
        task = asyncio.create_task(live.monitor())
        try:
            self.assertTrue(await asyncio.to_thread(scanned.wait, 1))
            initial = live.reconcile.call_count
            scanned.clear()
            live.wake()
            self.assertTrue(await asyncio.to_thread(scanned.wait, 1))
            self.assertEqual(live.reconcile.call_count, initial, "Market events must not trigger broker REST storms")
            scanned.clear()
            live.broker_update(dict(order_id="123", tag="0123456789abcdefE", status="COMPLETE", filled_quantity=15))
            self.assertTrue(await asyncio.to_thread(scanned.wait, 1))
            self.assertEqual(live.reconcile.call_count, initial + 1)
            self.assertIsNone(live.state["active"], "An update alone must not invent an executed position")
        finally:
            live.stop_event.set()
            live.wake_event.set()
            await task

    async def test_spot_queue_overflow_recovers_on_a_real_fresh_packet(self):
        with tempfile.TemporaryDirectory() as directory:
            service = AQTEService(Path(directory) / "aqte.sqlite3")
            service.queue = queue.Queue(maxsize=1)
            service.started = True
            service.enqueue("NIFTY", "spot", dict(instrument_token=10, last_price=22000))
            service.enqueue("NIFTY", "spot", dict(instrument_token=10, last_price=22001))
            self.assertIn(10, service.gaps)
            service.started = False
            await service.start()
            try:
                await asyncio.to_thread(wait_until, lambda: not service.gaps)
                self.assertTrue(service.snapshot()["recording"])
            finally:
                await service.stop()

    async def test_kite_connect_subscribes_immediately_and_defers_blocking_preparation(self):
        from services.market_feed import MarketFeedService
        service = MarketFeedService(Mock(), Mock())
        service._loop = asyncio.get_running_loop()
        socket = Mock()
        service._load_connection_context = Mock(return_value=True)
        with patch("services.market_feed.feed_watchdog"), patch("services.market_feed.auth_state_manager"):
            service._on_connect(socket, {})
            socket.subscribe.assert_called_once()
            service._load_connection_context.assert_not_called()
            await asyncio.sleep(.01)
            await service._prepare_task
        service._load_connection_context.assert_called_once()


class DiagnosticAccessTests(unittest.TestCase):
    def test_internal_monitor_requires_existing_owner_authorization(self):
        from routers.aqte import live_operator, router
        app = FastAPI()
        app.include_router(router)
        client = TestClient(app)
        self.assertEqual(client.get("/api/aqte/live/diagnostics").status_code, 403)
        app.dependency_overrides[live_operator] = lambda: "owner"
        with tempfile.TemporaryDirectory() as directory:
            market = AQTEService(Path(directory) / "aqte.sqlite3")
            live = AQTELiveService(market=market)
            with patch("routers.aqte.get_aqte_service", return_value=market), \
                    patch("routers.aqte.get_live_service", return_value=live):
                response = client.get("/api/aqte/live/diagnostics")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertEqual(set(response.json()), {"market", "execution"})
            self.assertIsNone(response.json()["market"]["feed"]["connected"])
            self.assertFalse(response.json()["execution"]["ready"])
            self.assertEqual(len(response.json()["market"]["evaluations"]["NIFTY"]["engines"]), 12)
            self.assertEqual(response.json()["execution"]["limits"]["max_lots"], 1)
            self.assertIn("entry_blocks", response.json()["execution"])


def benchmark():
    """Local fixture CPU timings only: no broker client, orders, or performance assertions."""
    baseline = ready_engine(paper_enabled=False)
    optimized = copy.deepcopy(baseline)
    optimized.feature_cache = FeatureCache(Latencies())
    service = AQTEService()
    service.engine, service.started = optimized, True
    service.configured_days = {"NFO": day(NOW), "BFO": day(NOW)}
    def measure(name, function, count):
        samples = []
        for _ in range(count):
            before = time.perf_counter_ns()
            function()
            samples.append((time.perf_counter_ns() - before) / 1_000_000)
        samples.sort()
        return name, dict(samples=count, median_ms=round(statistics.median(samples), 4),
                          p95_ms=round(samples[int(count * .95) - 1], 4))
    with patch("services.aqte_service.time.time", return_value=NOW):
        result = dict([
            measure("uncached_analysis", lambda: baseline.analyze("NIFTY", NOW), 1000),
            measure("cached_analysis", lambda: optimized.analyze("NIFTY", NOW), 1000),
            measure("synchronous_snapshot", service.snapshot, 200),
        ])
        service.evaluators = EngineWorkers(service.metrics)
        try:
            service.schedule_engines()
            wait_until(lambda: service.evaluators.diagnostics()["running"] == 0)
            name, values = measure("cached_snapshot", service.snapshot, 200)
            result[name] = values
        finally:
            service.evaluators.close()
    print(json.dumps(dict(workload="Local test fixture; not live broker latency", measurements=result), indent=2))


if __name__ == "__main__":
    if sys.argv[1:] == ["--benchmark"]:
        benchmark()
    else:
        unittest.main()
