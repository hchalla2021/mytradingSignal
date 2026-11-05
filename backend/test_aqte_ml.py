"""Synthetic ML plumbing tests. These fixtures are not model-performance evidence."""

import asyncio
import copy
import io
import json
import sqlite3
import tempfile
import unittest
from dataclasses import asdict, replace
from pathlib import Path
from unittest.mock import Mock, patch

from services.aqte_engine import AQTEEngine, SYMBOLS
from services.aqte_ml import FEATURE_NAMES, HORIZON_SECONDS, MLUnavailable, Sample, ShadowModel, feature_vector
from services.aqte_ml_training import (
    build_samples, collect_samples, metrics, samples_from_database, split_samples, train_bundle,
    main,
)
from services.aqte_service import AQTEService
from test_aqte import CONTRACT, NOW, START, ready_engine, tick


def candidate():
    engine = ready_engine()
    engine.paper_enabled = False
    engine.orders.clear()
    return engine, engine.snapshot(NOW)["data"]["NIFTY"], engine.options[CONTRACT.token]


def recorded_ticks(*, gain=True, fill=True):
    ticks = []
    for minute in range(201):
        for offset, move in ((0, 0), (20, 5), (40, -5), (50, 0)):
            at = START + minute * 60 + offset
            price = 22000 + minute * .2 + move
            ticks.extend((tick("spot", at=at, price=price),
                          tick(at=at, price=price, volume=minute * 4000 + offset * 50)))
    signal_at = START + 201 * 60
    ticks.extend((tick("spot", at=signal_at), tick("option", at=signal_at),
                  tick(at=signal_at, price=22040.2, volume=201 * 4000),
                  tick(at=signal_at + .5, price=22040.3, volume=201 * 4000 + 5)))
    for second in range(1, 302):
        bid = (107 if gain else 94) if second > 1 else 98.5
        ask = bid + .5
        if not fill:
            bid, ask = 99, 101
        ticks.append(tick("option", at=signal_at + second, price=(bid + ask) / 2, bid=bid, ask=ask))
    return ticks


def synthetic_samples():
    _, signal, quote = candidate()
    features = feature_vector(signal, quote)
    samples = []
    # Six separate labelled sessions; the last two are never used for fitting.
    for date in (0, 3, 4, 5, 6, 7):
        for index in range(60):
            at = NOW - 14 * 86400 + date * 86400 + index * 60
            values = list(features)
            values[12] = .7 + (index % 10) * .2
            samples.append(Sample("NIFTY", 30, at, at + 1, at + 301,
                                  tuple(values), .03 if index % 10 >= 5 else -.02))
    return samples


class FeatureTests(unittest.TestCase):
    def test_available_aqte_candidate_produces_finite_exact_ordered_features(self):
        _, signal, quote = candidate()
        self.assertEqual(signal["decision"], "BUY CE")
        values = feature_vector(signal, quote)
        self.assertEqual(len(values), len(FEATURE_NAMES))
        self.assertEqual(values[:4], (1, 0, 0, 1))
        self.assertAlmostEqual(values[FEATURE_NAMES.index("rsi")], signal["intelligence"]["rsi"] / 100)
        self.assertAlmostEqual(values[FEATURE_NAMES.index("spread_fraction")], 2 / 101)

    def test_missing_future_stale_and_nonfinite_evidence_never_imputed(self):
        _, original, quote = candidate()
        mutations = (
            lambda s: s["intelligence"].update(vwap=None),
            lambda s: s["intelligence"].update(imbalance=None),
            lambda s: s["intelligence"].update(atr=float("nan")),
            lambda s: s["intelligence"].update(at=NOW),
            lambda s: s.update(decision="WAIT"),
            lambda s: s.update(spot="invalid"),
            lambda s: s["contract"].update(side="PE"),
        )
        for change in mutations:
            signal = copy.deepcopy(original)
            change(signal)
            with self.subTest(signal=signal), self.assertRaises(MLUnavailable):
                feature_vector(signal, quote)
        for bad_quote in (replace(quote, at=NOW - 6), replace(quote, at=NOW + 1),
                          replace(quote, bid_quantity=0), replace(quote, token=31)):
            with self.subTest(quote=bad_quote), self.assertRaises(MLUnavailable):
                feature_vector(original, bad_quote)

    def test_both_option_sides_and_all_three_indices(self):
        _, original, quote = candidate()
        for index, symbol in enumerate(SYMBOLS):
            for side in ("CE", "PE"):
                signal = copy.deepcopy(original)
                signal.update(symbol=symbol, decision=f"BUY {side}")
                signal["contract"].update(symbol=symbol, side=side)
                values = feature_vector(signal, replace(quote, symbol=symbol))
                self.assertEqual(values[index], 1)
                self.assertEqual(values[3], float(side == "CE"))


class LabelTests(unittest.TestCase):
    def test_historical_signal_mode_is_isolated_from_live_rules_and_paper_orders(self):
        with self.assertRaisesRegex(ValueError, "paper_enabled=False"):
            AQTEEngine(research_only=True)
        at = START + 201 * 60 + .5
        snapshots = {}
        for research in (False, True):
            engine = AQTEEngine(paper_enabled=False, research_only=research)
            engine.contracts[CONTRACT.token] = CONTRACT
            for raw in recorded_ticks():
                if raw.received > at:
                    break
                engine.ingest(raw)
            snapshots[research] = engine.snapshot(at)
            self.assertFalse(engine.orders)
            self.assertFalse(engine.trades)
            signal = snapshots[research]["data"]["NIFTY"]
            self.assertIsNone(signal["intelligence"]["cpr"], "Historical CPR must not be fabricated")
            self.assertFalse(signal["model_validated"])
        self.assertEqual(snapshots[False]["mode"], "ANALYSIS_ONLY")
        self.assertEqual(snapshots[False]["data"]["NIFTY"]["decision"], "WAIT")
        self.assertEqual(snapshots[True]["mode"], "RESEARCH_ONLY")
        historical = snapshots[True]["data"]["NIFTY"]
        self.assertEqual(historical["decision"], "BUY CE")
        self.assertEqual(historical["entry"]["maximum"], 100, "Research preserves the original midpoint cap")

    def test_observed_no_chase_fill_and_costed_horizon_labels(self):
        winners, counts = build_samples(recorded_ticks(), [CONTRACT])
        losers, _ = build_samples(recorded_ticks(gain=False), [CONTRACT])
        self.assertEqual(counts["candidates"], 1)
        self.assertEqual(len(winners), 1)
        self.assertEqual(len(losers), 1)
        win, loss = winners[0], losers[0]
        self.assertEqual(win.features, loss.features)
        self.assertEqual((win.label, loss.label), (1, 0))
        self.assertEqual(win.entry_at, win.signal_at + 1)
        self.assertEqual(win.label_at, win.entry_at + HORIZON_SECONDS)
        engine = AQTEEngine()
        entry, exit_price = 99.05, 106.95
        expected = ((exit_price - entry) * 15 - engine.costs(entry, 15) - engine.costs(exit_price, 15)) / (entry * 15)
        self.assertAlmostEqual(win.net_return, expected)

    def test_midpoint_never_filled_on_signal_or_assumed_filled_at_ask(self):
        samples, counts = build_samples(recorded_ticks(fill=False), [CONTRACT])
        self.assertEqual(samples, [])
        self.assertEqual(counts["expired_or_incomplete"], 1)

    def test_research_rejects_a_quote_above_midpoint_even_when_below_the_live_ask_cap(self):
        at = START + 201 * 60
        ticks = [replace(raw, bid=100, ask=100.5) if raw.kind == "option" and raw.received > at else raw
                 for raw in recorded_ticks(fill=False)]
        samples, counts = build_samples(ticks, [CONTRACT])
        self.assertEqual(counts["candidates"], 1)
        self.assertEqual(samples, [])
        self.assertEqual(counts["expired_or_incomplete"], 1)

    def test_missing_exit_is_not_a_loss_or_fabricated_close(self):
        samples, counts = build_samples(recorded_ticks()[:-1], [CONTRACT])
        self.assertEqual(samples, [])
        self.assertEqual(counts["expired_or_incomplete"], 1)

    def test_gap_before_entry_or_during_holding_censors_label(self):
        ticks = recorded_ticks()
        at = START + 201 * 60
        for start, end in ((1, 9), (40, 49)):
            incomplete = [t for t in ticks if not at + start <= t.received <= at + end]
            with self.subTest(gap=(start, end)):
                samples, counts = build_samples(incomplete, [CONTRACT])
                self.assertEqual(samples, [])
                self.assertEqual(counts["quote_gap_or_invalid"], 1)

    def test_late_or_insufficient_depth_exit_not_counted(self):
        for changed in (replace(recorded_ticks()[-1], bid_quantity=0),
                        replace(recorded_ticks()[-1], received=START + 201 * 60 + 310)):
            ticks = recorded_ticks()
            ticks[-1] = changed
            samples, _ = build_samples(ticks, [CONTRACT])
            self.assertEqual(samples, [])

    def test_future_warmup_gap_cannot_generate_training_sample(self):
        ticks = [t for t in recorded_ticks() if not START + 100 * 60 <= t.at < START + 101 * 60]
        samples, _ = build_samples(ticks, [CONTRACT])
        self.assertEqual(samples, [])

    def test_input_order_and_missing_contract_rejected(self):
        ticks = recorded_ticks()
        with self.assertRaisesRegex(ValueError, "ordered"):
            build_samples([ticks[2], ticks[0]], [CONTRACT])
        with self.assertRaisesRegex(ValueError, "metadata"):
            build_samples(ticks, [])

    def test_entry_gap_below_stop_invalidates_not_retried(self):
        ticks = recorded_ticks()
        at = START + 201 * 60 + 1
        ticks = [replace(t, bid=70, ask=71) if t.received == at else t for t in ticks]
        samples, counts = build_samples(ticks, [CONTRACT])
        self.assertEqual(samples, [])
        self.assertEqual(counts["entry_gapped_below_stop"], 1)

    def test_no_hypothetical_fill_at_the_expiry_boundary(self):
        at = START + 201 * 60
        ticks = [replace(t, bid=98.5, ask=99) if t.kind == "option" and t.received == at + 30 else t
                 for t in recorded_ticks(fill=False)]
        samples, counts = build_samples(ticks, [CONTRACT])
        self.assertEqual(samples, [])
        self.assertEqual(counts["expired_or_incomplete"], 1)

    def test_fresh_option_cannot_enter_on_stale_underlying(self):
        at = START + 201 * 60
        ticks = [replace(t, bid=98.5, ask=99) if t.kind == "option" and t.received == at + 10 else t
                 for t in recorded_ticks(fill=False)]
        samples, counts = build_samples(ticks, [CONTRACT])
        self.assertEqual(samples, [])
        self.assertEqual(counts["entry_underlying_or_session_stale"], 1)


class JournalTests(unittest.TestCase):
    def test_dated_contracts_readonly_extraction_and_archive_dedup(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "aqte.sqlite3"
            service = AQTEService(path)
            service.initialize()
            service.engine.contracts[30] = CONTRACT
            with service.connect() as db:
                service.persist(db, recorded_ticks())
                # A later catalog can reuse a token. Historical labels must ignore it.
                db.execute("UPDATE aqte_contracts SET payload=?", (json.dumps(asdict(replace(CONTRACT, lot_size=500))),))
            before = path.read_bytes()
            samples, _ = samples_from_database(path, "2026-10-30", "2026-10-30", 2000)
            self.assertEqual(len(samples), 1)
            combined, counts = collect_samples([path, path], "2026-10-30", "2026-10-30", 2000)
            self.assertEqual(combined, samples)
            self.assertEqual(counts["unique_labelled"], 1)
            self.assertEqual(path.read_bytes(), before)
            with self.assertRaisesRegex(ValueError, "max-ticks"):
                samples_from_database(path, "2026-10-30", "2026-10-30", 10)
            with service.connect() as db:
                db.execute("DROP TABLE aqte_contract_history")
            with self.assertRaisesRegex(ValueError, "dated contract metadata"):
                samples_from_database(path, "2026-10-30", "2026-10-30", 2000)

    def test_missing_db_never_created(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "missing.sqlite3"
            with self.assertRaises(sqlite3.OperationalError):
                samples_from_database(path, "2026-10-30", "2026-10-30", 100)
            self.assertFalse(path.exists())

    def test_cli_insufficient_data_exits_nonzero_and_creates_no_model(self):
        with tempfile.TemporaryDirectory() as directory:
            path, output = Path(directory) / "aqte.sqlite3", Path(directory) / "model"
            service = AQTEService(path)
            service.initialize()
            service.engine.contracts[30] = CONTRACT
            with service.connect() as db:
                service.persist(db, recorded_ticks())
            arguments = ["aqte_ml_training", "--db", str(path), "--from-day", "2026-10-30",
                         "--to-day", "2026-10-30", "--output-dir", str(output)]
            errors = io.StringIO()
            with patch("sys.argv", arguments), patch("sys.stderr", errors), self.assertRaises(SystemExit) as raised:
                main()
            self.assertEqual(raised.exception.code, 1)
            self.assertIn("six labelled IST sessions", errors.getvalue())
            self.assertFalse(output.exists())


class TrainingTests(unittest.TestCase):
    def test_split_is_chronological_embargoed_and_checks_data_quality(self):
        samples = synthetic_samples()
        train, test = split_samples(list(reversed(samples)))
        self.assertEqual((len(train), len(test)), (240, 120))
        self.assertLess(max(s.label_at for s in train), min(s.signal_at for s in test) - HORIZON_SECONDS)
        cases = (samples[:200], samples + [samples[0]],
                 [replace(s, net_return=.1) for s in samples],
                 [replace(s, label_at=s.entry_at) for s in samples],
                 [replace(s, features=(float("nan"),) * len(FEATURE_NAMES)) for s in samples])
        for invalid in cases:
            with self.subTest(count=len(invalid)), self.assertRaises(ValueError):
                split_samples(invalid)

    def test_unknown_index_in_holdout_is_not_treated_as_validated(self):
        samples = synthetic_samples()
        samples[-1] = replace(samples[-1], symbol="SENSEX")
        with self.assertRaisesRegex(ValueError, "absent from training"):
            split_samples(samples)

    def test_evaluation_metrics_match_hand_calculation(self):
        result = metrics([0, 1], [.25, .75])
        self.assertAlmostEqual(result["log_loss"], .28768207245)
        self.assertAlmostEqual(result["brier"], .0625)
        self.assertEqual(result["accuracy"], 1)
        with self.assertRaises(ValueError):
            metrics([0, 1], [float("nan"), .9])

    def test_actual_lightgbm_training_roundtrip_and_holdout_is_not_fitted(self):
        samples = synthetic_samples()
        bundle = train_bundle(samples)
        altered = [replace(s, net_return=-s.net_return) if i >= 240 else s for i, s in enumerate(samples)]
        alternate = train_bundle(altered)
        self.assertEqual(bundle["model_text"], alternate["model_text"])
        self.assertNotEqual(bundle["report"]["evaluation"], alternate["report"]["evaluation"])
        self.assertFalse(bundle["validated"])
        self.assertFalse(bundle["affects_orders"])
        self.assertEqual(bundle["mode"], "SHADOW")
        self.assertEqual(bundle["report"]["training_samples"], 240)
        self.assertIn("constant_baseline", bundle["report"])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.json"
            path.write_text(json.dumps(bundle), encoding="utf-8")
            model = ShadowModel.load(path)
            _, signal, quote = candidate()
            result = model.predict(signal, quote)
            self.assertEqual(result["status"], "SHADOW")
            self.assertFalse(result["validated"])
            self.assertFalse(result["calibrated"])
            self.assertLessEqual(0, result["probability_positive_net_return"])
            self.assertGreaterEqual(1, result["probability_positive_net_return"])
            service = AQTEService(Path(directory) / "aqte.sqlite3", ml_model_path=path)
            service.initialize()
            service.load_ml()
            service.engine, _, _ = candidate()
            before = service.engine.snapshot(NOW)
            service.capture_ml(tick())
            with patch("services.aqte_service.time.time", return_value=NOW):
                service.score_ml()
            self.assertEqual(service.ml_state["status"], "READY")
            self.assertEqual(service.ml_state["observations"]["NIFTY"], result)
            self.assertEqual(service.engine.snapshot(NOW), before)
            unsupported = copy.deepcopy(signal)
            unsupported["contract"]["side"] = "PE"
            unsupported["decision"] = "BUY PE"
            with self.assertRaisesRegex(MLUnavailable, "option side"):
                model.predict(unsupported, quote)
            model.holdout_end = NOW
            with self.assertRaisesRegex(MLUnavailable, "holdout period"):
                model.predict(signal, quote)
            signal["symbol"] = "SENSEX"
            with self.assertRaisesRegex(MLUnavailable, "coverage"):
                model.predict(signal, quote)
            for key, value in (("schema", "other-model"), ("features", list(reversed(FEATURE_NAMES))),
                               ("sha256", "tampered"), ("validated", True), ("mode", "LIVE"),
                               ("report", {**bundle["report"], "holdout_end": bundle["report"]["holdout_start"] - 1}),
                               ("model_text", bundle["model_text"] + "\n")):
                corrupt = {**bundle, key: value}
                path.write_text(json.dumps(corrupt), encoding="utf-8")
                with self.subTest(field=key), self.assertRaises(MLUnavailable):
                    ShadowModel.load(path)


class RuntimeTests(unittest.TestCase):
    def make_service(self, directory):
        service = AQTEService(Path(directory) / "aqte.sqlite3")
        service.initialize()
        engine, _, _ = candidate()
        service.engine = engine
        service.started = True
        service.ml_model = Mock()
        service.ml_model.predict.return_value = dict(status="SHADOW", probability_positive_net_return=.99,
                                                     observed_at=NOW, affects_orders=False, validated=False)
        return service

    def test_shadow_never_mutates_rule_signals_orders_risk_or_validation(self):
        with tempfile.TemporaryDirectory() as directory, patch("services.aqte_service.time.time", return_value=NOW):
            service = self.make_service(directory)
            before = service.engine.snapshot(NOW)
            original_orders = copy.deepcopy(service.engine.orders)
            service.capture_ml(tick())
            service.capture_ml(tick(at=NOW + .1))
            model = service.ml_model
            service.score_ml()
            service.score_ml()
            self.assertEqual(service.engine.snapshot(NOW), before)
            self.assertEqual(service.engine.orders, original_orders)
            self.assertFalse(service.failed.is_set())
            model.predict.assert_called_once()
            self.assertNotIn("ml", service.engine.signals["NIFTY"])
            self.assertFalse(service.snapshot()["ml"]["affects_orders"])
            record = json.loads((Path(directory) / "aqte-ml-shadow.jsonl").read_text())
            self.assertEqual(tuple(record["features"]), FEATURE_NAMES)
            expected = feature_vector(before["data"]["NIFTY"], service.engine.options[30])
            self.assertEqual(tuple(record["features"].values()), expected)

    def test_missing_model_and_corrupt_artifact_are_explicit_not_fake_probabilities(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "missing.json"
            service = AQTEService(Path(directory) / "aqte.sqlite3", ml_model_path=path)
            for payload in (None, "[]", '{"model_text": "invalid"}'):
                if payload is not None:
                    path.write_text(payload)
                with self.assertLogs("services.aqte_service", level="ERROR"):
                    service.load_ml()
                self.assertEqual(service.ml_state["status"], "UNAVAILABLE")
                self.assertIsNone(service.ml_model)
                self.assertFalse(service.failed.is_set())
                self.assertEqual(service.ml_state["observations"], {})
            disabled = AQTEService(Path(directory) / "disabled.sqlite3")
            self.assertIsNone(disabled.ml_model_path)
            self.assertEqual(disabled.ml_state["status"], "DISABLED")

    def test_ml_recording_failure_does_not_fault_live_recorder(self):
        with tempfile.TemporaryDirectory() as directory, patch("services.aqte_service.time.time", return_value=NOW):
            service = self.make_service(directory)
            before = service.engine.snapshot(NOW)
            service.capture_ml(tick())
            with patch.object(Path, "open", side_effect=PermissionError("read-only")), self.assertLogs(
                "services.aqte_service", level="ERROR"
            ):
                service.score_ml()
            self.assertIsNone(service.ml_model)
            self.assertEqual(service.ml_state["status"], "UNAVAILABLE")
            self.assertFalse(service.failed.is_set())
            self.assertEqual(service.engine.snapshot(NOW), before)

    def test_delayed_background_candidate_has_no_probability(self):
        with tempfile.TemporaryDirectory() as directory:
            service = self.make_service(directory)
            service.capture_ml(tick())
            with patch("services.aqte_service.time.time", return_value=NOW + 6), self.assertLogs(
                "services.aqte_service", level="WARNING"
            ):
                service.score_ml()
            service.ml_model.predict.assert_not_called()
            self.assertNotIn("probability_positive_net_return", service.ml_state["observations"]["NIFTY"])

    def test_disabled_service_does_not_import_or_start_lightgbm(self):
        async def exercise():
            with tempfile.TemporaryDirectory() as directory:
                service = AQTEService(Path(directory) / "aqte.sqlite3")
                with patch.object(ShadowModel, "load", side_effect=AssertionError("must remain disabled")):
                    await service.start()
                    self.assertIsNone(service.ml_task)
                    await service.stop()
        asyncio.run(exercise())


if __name__ == "__main__":
    unittest.main()
