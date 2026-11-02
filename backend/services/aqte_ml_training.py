"""Offline AQTE LightGBM research training from a read-only tick journal."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sqlite3
from collections import Counter
from contextlib import closing
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterable

from services.aqte_engine import AQTEEngine, Contract, IST, Tick, day, round_tick, session
from services.aqte_ml import FEATURE_NAMES, HORIZON_SECONDS, SCHEMA, TARGET, MLUnavailable, Sample, feature_vector


@dataclass
class Pending:
    symbol: str
    token: int
    signal_at: float
    features: tuple[float, ...]
    limit: float
    stop: float
    lot: int
    tick_size: float
    entry_at: float | None = None
    entry_price: float | None = None
    last_quote_at: float | None = None
    last_received_at: float | None = None


def build_samples(ticks: Iterable[Tick], contracts: Iterable[Contract]) -> tuple[list[Sample], dict[str, int]]:
    engine = AQTEEngine(paper_enabled=False)
    engine.contracts = {c.token: c for c in contracts}
    pending: list[Pending] = []
    samples: list[Sample] = []
    seen: dict[str, float] = {}
    counts: Counter[str] = Counter()
    previous = -math.inf
    for tick in ticks:
        if tick.received < previous:
            raise ValueError("ML ticks must be ordered by receipt time")
        previous = tick.received
        counts["ticks"] += 1
        if tick.kind == "option" and tick.token not in engine.contracts:
            raise ValueError("Option tick has no contemporaneous contract metadata")
        alive = []
        for candidate in pending:
            deadline = (candidate.entry_at + HORIZON_SECONDS + 5 if candidate.entry_at is not None
                        else candidate.signal_at + engine.policy.order_lifetime)
            if tick.received > deadline or (candidate.entry_at is None and tick.received == deadline) or (
                day(tick.received) != day(candidate.signal_at)
            ):
                counts["expired_or_incomplete"] += 1
                continue
            if tick.kind != "option" or tick.token != candidate.token or tick.received <= candidate.signal_at:
                alive.append(candidate)
                continue
            valid = engine.fresh(tick, tick.received) and session(tick.at) and (
                0 < tick.bid <= tick.ask and math.isfinite(tick.ask) and tick.bid_quantity >= candidate.lot
                and tick.ask_quantity >= candidate.lot
            )
            if not valid or (candidate.last_quote_at is not None and (
                tick.at < candidate.last_quote_at or tick.at - candidate.last_quote_at > 5
            )) or (candidate.last_received_at is not None and (
                tick.received <= candidate.last_received_at or tick.received - candidate.last_received_at > 5
            )):
                counts["quote_gap_or_invalid"] += 1
                continue
            candidate.last_received_at = tick.received
            if candidate.entry_at is None:
                candidate.last_quote_at = tick.at
                if tick.bid <= candidate.stop:
                    counts["entry_gapped_below_stop"] += 1
                    continue
                fill = round_tick(tick.ask + engine.policy.slippage_ticks * candidate.tick_size,
                                  candidate.tick_size, up=True)
                if tick.at > candidate.signal_at and candidate.stop < fill <= candidate.limit and (
                    (tick.ask - tick.bid) / tick.ask <= engine.policy.spread_fraction
                ):
                    if not engine.fresh(engine.spot.get(candidate.symbol), tick.received) or (
                        not engine.fresh(engine.future.get(candidate.symbol), tick.received)
                    ) or engine.risk_reason(tick.received):
                        counts["entry_underlying_or_session_stale"] += 1
                        continue
                    candidate.entry_at = tick.received
                    candidate.entry_price = fill
                    candidate.last_quote_at = tick.at
                alive.append(candidate)
                continue
            candidate.last_quote_at = tick.at
            if tick.received - candidate.entry_at < HORIZON_SECONDS or tick.at < candidate.entry_at + HORIZON_SECONDS:
                alive.append(candidate)
                continue
            entry_price = candidate.entry_price
            if entry_price is None:
                raise ValueError("ML sample entry price missing after an observed fill")
            exit_price = round_tick(max(candidate.tick_size, tick.bid - candidate.tick_size), candidate.tick_size)
            net = (exit_price - entry_price) * candidate.lot - engine.costs(entry_price, candidate.lot) - (
                engine.costs(exit_price, candidate.lot))
            sample = Sample(candidate.symbol, candidate.token, candidate.signal_at, candidate.entry_at,
                            tick.received, candidate.features, net / (entry_price * candidate.lot))
            sample.validate()
            samples.append(sample)
        pending = alive
        engine.ingest(tick)
        engine.events.clear()
        if tick.kind != "future":
            continue
        signal = engine.snapshot(tick.received)["data"][tick.symbol]
        if signal["decision"] == "WAIT" or not signal["entry"]:
            continue
        contract = signal["contract"]
        candle_at = signal["intelligence"]["at"]
        if seen.get(tick.symbol) == candle_at:
            continue
        seen[tick.symbol] = candle_at
        try:
            features = feature_vector(signal, engine.options[contract["token"]])
        except MLUnavailable:
            counts["unusable_features"] += 1
            continue
        pending.append(Pending(tick.symbol, contract["token"], signal["at"], features,
                               signal["entry"]["maximum"], signal["entry"]["stop"],
                               contract["lot_size"], contract["tick_size"],
                               last_quote_at=engine.options[contract["token"]].at,
                               last_received_at=engine.options[contract["token"]].received))
        counts["candidates"] += 1
    counts["expired_or_incomplete"] += len(pending)
    counts["labelled"] = len(samples)
    return sorted(samples, key=lambda item: item.signal_at), dict(counts)


def samples_from_database(path: Path, first_day: str, last_day: str, max_ticks: int) -> tuple[list[Sample], dict[str, int]]:
    start = datetime.strptime(first_day, "%Y-%m-%d").replace(tzinfo=IST)
    end = datetime.strptime(last_day, "%Y-%m-%d").replace(tzinfo=IST) + timedelta(days=1)
    if end <= start or max_ticks <= 0:
        raise ValueError("Invalid ML date range or max-ticks")
    with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        db.execute("BEGIN")
        size = db.execute("SELECT COUNT(*) FROM aqte_ticks WHERE received>=? AND received<?",
                          (start.timestamp(), end.timestamp())).fetchone()[0]
        if size > max_ticks:
            raise ValueError(f"{size} ticks exceeds --max-ticks={max_ticks}; choose a smaller range or explicit cap")
        if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='aqte_contract_history'").fetchone():
            raise ValueError("Journal lacks dated contract metadata; collect new sessions after the ML recorder update")
        samples: list[Sample] = []
        counts: Counter[str] = Counter()
        current = start
        while current < end:
            next_day = current + timedelta(days=1)
            contracts = [Contract(**json.loads(row[0])) for row in db.execute(
                "SELECT payload FROM aqte_contract_history WHERE session_day=?", (current.date().isoformat(),))]
            rows = db.execute("SELECT payload FROM aqte_ticks WHERE received>=? AND received<? ORDER BY received,id",
                              (current.timestamp(), next_day.timestamp()))
            daily_samples, daily_counts = build_samples((Tick(**json.loads(row[0])) for row in rows), contracts)
            samples.extend(daily_samples)
            counts.update(daily_counts)
            current = next_day
        return samples, dict(counts)


def split_samples(samples: list[Sample]) -> tuple[list[Sample], list[Sample]]:
    for sample in samples:
        sample.validate()
    keys = [(s.symbol, s.token, s.signal_at) for s in samples]
    if len(keys) != len(set(keys)):
        raise ValueError("Duplicate ML observations would overweight training/evaluation")
    ordered = sorted(samples, key=lambda sample: sample.signal_at)
    sessions = sorted({day(sample.signal_at) for sample in ordered})
    if len(sessions) < 6:
        raise ValueError("Need at least six labelled IST sessions; newest two are held out")
    test = [sample for sample in ordered if day(sample.signal_at) in sessions[-2:]]
    boundary = test[0].signal_at - HORIZON_SECONDS
    train = [sample for sample in ordered if day(sample.signal_at) not in sessions[-2:] and sample.label_at < boundary]
    if len(train) < 200 or len(test) < 50:
        raise ValueError(f"Insufficient labelled data: train={len(train)} (need 200), holdout={len(test)} (need 50)")
    if any({sample.label for sample in part} != {0, 1} for part in (train, test)):
        raise ValueError("Both positive and non-positive outcomes are required in train and holdout")
    if set(s.symbol for s in test) - set(s.symbol for s in train):
        raise ValueError("Holdout contains indices absent from training")
    if {(s.symbol, s.features[3]) for s in test} - {(s.symbol, s.features[3]) for s in train}:
        raise ValueError("Holdout contains index/option sides absent from training")
    return train, test


def collect_samples(paths: list[Path], first_day: str, last_day: str, max_ticks: int) -> tuple[list[Sample], dict[str, int]]:
    observations: dict[tuple[str, int, float], Sample] = {}
    counts: Counter[str] = Counter()
    for path in paths:
        samples, extracted = samples_from_database(path, first_day, last_day, max_ticks)
        counts.update(extracted)
        for sample in samples:
            key = (sample.symbol, sample.token, sample.signal_at)
            if key in observations and observations[key] != sample:
                raise ValueError("Overlapping archives contain conflicting ML observations; use complete session backups")
            observations[key] = sample
    counts["unique_labelled"] = len(observations)
    return sorted(observations.values(), key=lambda sample: sample.signal_at), dict(counts)


def metrics(labels, predictions) -> dict[str, float]:
    import numpy as np

    truth, scores = np.asarray(labels), np.asarray(predictions)
    if truth.size == 0 or truth.shape != scores.shape or not np.all(np.isfinite(scores)) or (
        np.any(scores < 0) or np.any(scores > 1)
    ):
        raise ValueError("Invalid evaluation probabilities")
    clipped = np.clip(scores, 1e-12, 1 - 1e-12)
    return dict(log_loss=float(-np.mean(truth * np.log(clipped) + (1 - truth) * np.log(1 - clipped))),
                brier=float(np.mean((scores - truth) ** 2)), accuracy=float(np.mean((scores >= 0.5) == truth)))


def train_bundle(samples: list[Sample]) -> dict[str, Any]:
    import lightgbm as lgb
    import numpy as np

    train, test = split_samples(samples)
    x = np.asarray([sample.features for sample in train], dtype=np.float64)
    labels = np.asarray([sample.label for sample in train])
    dataset = lgb.Dataset(x, label=labels, feature_name=list(FEATURE_NAMES))
    # Holdout never participates in tuning, early stopping or refitting.
    booster = lgb.train(dict(objective="binary", learning_rate=0.04, num_leaves=7,
                             min_data_in_leaf=20, lambda_l2=2, verbosity=-1,
                             seed=17, num_threads=1, deterministic=True, force_col_wise=True),
                        dataset, num_boost_round=60)
    probability = booster.predict(np.asarray([sample.features for sample in test]), num_threads=1)
    truth = [sample.label for sample in test]
    baseline = np.full(len(test), labels.mean())
    evaluation = metrics(truth, probability)
    baseline_metrics = metrics(truth, baseline)
    per_symbol = {}
    for symbol in sorted({sample.symbol for sample in test}):
        mask = np.asarray([sample.symbol == symbol for sample in test])
        per_symbol[symbol] = dict(samples=int(mask.sum()),
                                  **metrics(np.asarray(truth)[mask], probability[mask]))
    model_text = booster.model_to_string()
    return dict(
        schema=SCHEMA, target=TARGET, features=list(FEATURE_NAMES), mode="SHADOW",
        validated=False, calibrated=False, affects_orders=False,
        symbols=sorted({sample.symbol for sample in train}),
        coverage=sorted({f"{sample.symbol}:{'CE' if sample.features[3] else 'PE'}" for sample in train}),
        sha256=hashlib.sha256(model_text.encode("utf-8")).hexdigest(), model_text=model_text,
        report=dict(
            training_samples=len(train), holdout_samples=len(test),
            train_label_end=max(s.label_at for s in train), holdout_start=test[0].signal_at,
            holdout_end=max(s.label_at for s in test), holdout_days=sorted({day(s.signal_at) for s in test}),
            horizon_seconds=HORIZON_SECONDS, embargo_seconds=HORIZON_SECONDS,
            evaluation=evaluation, constant_baseline=baseline_metrics, by_symbol=per_symbol,
            beats_baseline=evaluation["log_loss"] < baseline_metrics["log_loss"] and (
                evaluation["brier"] < baseline_metrics["brier"]),
            feature_importance=dict(zip(FEATURE_NAMES, booster.feature_importance(importance_type="gain").tolist())),
            library_versions=dict(lightgbm=lgb.__version__, numpy=np.__version__),
            limitations=[
                "Research-only, uncalibrated probabilities; passing these metrics does not approve live use.",
                "Labels assume observed one-lot no-chase fills and five-minute exits, not actual queue priority.",
                "Positive net return at five minutes is not the live stop/trailing/target outcome.",
                "Costs use AQTE Policy estimates and one tick of entry/exit slippage.",
                "Overlapping samples are correlated; whole sessions are held out with a time embargo.",
                "Only recorded contracts/quotes are available; replay does not recover missing CPR or OI/Greeks.",
                "Current-session warm-up, rule selection and live guards remain unchanged.",
            ],
        ),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, nargs="+", type=Path, help="One or more complete SQLite journal backups")
    parser.add_argument("--from-day", required=True)
    parser.add_argument("--to-day", required=True)
    parser.add_argument("--output-dir", required=True, type=Path, help="New research output directory; never overwritten")
    parser.add_argument("--max-ticks", type=int, default=2_000_000)
    args = parser.parse_args()
    try:
        if args.output_dir.exists():
            raise ValueError("Output directory already exists; choose a new research run directory")
        samples, counts = collect_samples(args.db, args.from_day, args.to_day, args.max_ticks)
        bundle = train_bundle(samples)
        bundle["report"]["dataset"] = counts
        bundle["report"]["policy"] = asdict(AQTEEngine().policy)
        args.output_dir.mkdir(parents=True, exist_ok=False)
        temporary = args.output_dir / "model.json.tmp"
        try:
            temporary.write_text(json.dumps(bundle, allow_nan=False, indent=2), encoding="utf-8")
            temporary.replace(args.output_dir / "model.json")
        finally:
            temporary.unlink(missing_ok=True)
    except (ValueError, OSError, sqlite3.Error, ImportError) as exc:
        parser.exit(1, f"AQTE ML training failed: {exc}\n")
    print(json.dumps(bundle["report"], indent=2, allow_nan=False))
    print(f"Shadow-only model: {args.output_dir / 'model.json'}")


if __name__ == "__main__":
    main()
