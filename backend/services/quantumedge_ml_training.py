"""Replay QuantumEdge rules and train a LightGBM artifact from read-only Kite tick journals."""

import argparse
import json
import sqlite3
from contextlib import nullcontext
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

from services.aqte_engine import IST
from services.aqte_live import entry_window
from services.aqte_ml import TARGET
from services.aqte_ml_training import collect_samples, train_bundle
from services.quantumedge_intraday import DAILY_LOSS_LIMIT, QuantumEdgeIntradayService
from services.quantumedge_ml import FEATURE_NAMES, SCHEMA, THRESHOLD, QuantumEdgeML


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, nargs="+", type=Path)
    parser.add_argument("--from-day", required=True)
    parser.add_argument("--to-day", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--max-ticks", type=int, default=2_000_000)
    args = parser.parse_args()
    rules = QuantumEdgeIntradayService()

    def select(engine, tick):
        if not entry_window(tick.received):
            return None
        market = SimpleNamespace(engine=engine, lock=nullcontext())
        signal = rules.evaluate(market, tick.symbol, tick.received, 1, 1000, set(), engine.costs,
                                daily_budget=DAILY_LOSS_LIMIT)
        return signal if signal.get("ml_features") else None

    try:
        if args.output.exists():
            raise ValueError("Output already exists; choose a fresh model path")
        if datetime.strptime(args.to_day, "%Y-%m-%d").date() >= datetime.now(IST).date():
            raise ValueError("Use historical IST dates only; the current trading day cannot be a holdout")
        samples, counts = collect_samples(args.db, args.from_day, args.to_day, args.max_ticks,
                                          select=select, feature_names=FEATURE_NAMES)
        bundle = train_bundle(samples, feature_names=FEATURE_NAMES, schema=SCHEMA, target=TARGET,
                              gate_threshold=THRESHOLD)
        eligible = sorted(QuantumEdgeML.eligible_sides(bundle))
        report = bundle["report"]
        report["dataset"] = counts
        report["eligible_sides"] = eligible
        report["replay_profile"] = {"lots": 1, "risk_per_lot_inr": 1000}
        report["limitations"] = [
            "Uncalibrated classifier score; not a probability of a profitable live trade.",
            "Labels use observed no-chase quote fills and estimated net return after five minutes, "
            "not realized stop/target/trailing or actual broker execution.",
            "Does not simulate Claude decisions, shared broker capacity, or live execution latency.",
            "Prior-session spot OHLC is not available in tick replay; the three spot-level strategies "
            "do not have ML features and cannot pass the LightGBM gate.",
        ]
        artifact = json.dumps(bundle, indent=2, allow_nan=False)
        with args.output.open("x", encoding="utf-8") as file:
            file.write(artifact)
    except (ValueError, OSError, sqlite3.Error, ImportError) as exc:
        parser.exit(1, f"QuantumEdge ML training failed: {exc}\n")
    print(json.dumps(report, indent=2, allow_nan=False))
    print(f"Artifact: {args.output}. {'Gate eligible for listed sides only.' if eligible else 'Shadow only.'}")


if __name__ == "__main__":
    main()
