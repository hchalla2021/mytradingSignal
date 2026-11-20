"""QuantumEdge-specific LightGBM veto over rule-qualified option setups."""

from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
from typing import TYPE_CHECKING, Any

from services.aqte_engine import SYMBOLS
from services.aqte_ml import HORIZON_SECONDS, MLUnavailable, TARGET

if TYPE_CHECKING:
    import lightgbm

SCHEMA = "quantumedge-option-quality-v4"
FEATURE_NAMES = (
    "nifty", "banknifty", "sensex", "is_ce", "ema_gap_pct", "relative_rsi",
    "relative_volume", "breakout_atr", "body_atr", "atr_pct",
    "vwap_distance_atr", "trend_5m_atr", "trend_15m_atr",
    "spread_fraction", "bid_depth_lots", "ask_depth_lots", "premium_spot_pct",
    "moneyness_pct", "net_reward_risk",
)
THRESHOLD = 0.60
MAX_MODEL_AGE = 30 * 86400


class QuantumEdgeML:
    def __init__(self) -> None:
        self.mode = os.getenv("QUANTUMEDGE_ML_MODE", "off").strip().lower()
        self.error: str | None = None
        self.model_id: str | None = None
        self.booster: lightgbm.Booster | None = None
        self.sides: set[str] = set()
        self.coverage: set[str] = set()
        self.holdout_end = 0.0
        self.path = os.getenv("QUANTUMEDGE_ML_MODEL_PATH", "").strip()
        self.load_attempted = False

    @staticmethod
    def eligible_sides(bundle: dict[str, Any]) -> set[str]:
        gate = bundle["report"]["gate"]
        if gate["threshold"] != THRESHOLD or bundle["report"]["beats_baseline"] is not True:
            return set()
        valid = {f"{symbol}:{side}" for symbol in SYMBOLS for side in ("CE", "PE")}
        return {
            key for key, row in gate["by_side"].items()
            if key in valid and key in bundle["coverage"]
            and row["holdout_samples"] >= 30 and row["passed"] >= 10 and row["blocked"] >= 10
            and row["passed"] + row["blocked"] == row["holdout_samples"]
            and math.isfinite(row["passed_mean_return"]) and math.isfinite(row["unfiltered_mean_return"])
            and row["passed_mean_return"] > max(0, row["unfiltered_mean_return"])
        }

    def load(self) -> None:
        if self.load_attempted or self.mode == "off":
            return
        self.load_attempted = True
        if self.mode not in {"shadow", "gate"}:
            self.error = "Invalid QUANTUMEDGE_ML_MODE; use off, shadow or gate"
            return
        try:
            if not self.path:
                raise MLUnavailable("QUANTUMEDGE_ML_MODEL_PATH is not configured")
            bundle = json.loads(Path(self.path).read_text(encoding="utf-8"))
            if (bundle["schema"], bundle["features"], bundle["target"]) != (SCHEMA, list(FEATURE_NAMES), TARGET):
                raise MLUnavailable("QuantumEdge ML artifact schema, feature order or target mismatch")
            model_text = bundle["model_text"]
            digest = hashlib.sha256(model_text.encode("utf-8")).hexdigest()
            if digest != bundle["sha256"]:
                raise MLUnavailable("QuantumEdge ML artifact checksum mismatch")
            report = bundle["report"]
            train_end, test_start, test_end = (float(report[key]) for key in
                                              ("train_label_end", "holdout_start", "holdout_end"))
            if not all(map(math.isfinite, (train_end, test_start, test_end))) or not (
                0 < train_end < test_start - HORIZON_SECONDS < test_start < test_end
            ):
                raise MLUnavailable("QuantumEdge ML requires a chronological embargoed holdout")
            sides = self.eligible_sides(bundle)
            if self.mode == "gate" and not sides:
                raise MLUnavailable("No index/side met the QuantumEdge holdout gate requirements")
            import lightgbm as lgb

            try:
                booster = lgb.Booster(model_str=model_text)
            except lgb.basic.LightGBMError as exc:
                raise MLUnavailable("LightGBM could not read QuantumEdge model") from exc
            if tuple(booster.feature_name()) != FEATURE_NAMES or not booster.dump_model()["objective"].startswith("binary"):
                raise MLUnavailable("QuantumEdge model must be a binary classifier with matching features")
            self.holdout_end, self.sides, self.model_id = test_end, sides, digest[:16]
            self.coverage = set(bundle["coverage"])
            self.booster = booster
        except MLUnavailable as exc:
            self.error = str(exc)
        except (OSError, ImportError, ValueError, KeyError, TypeError, AttributeError) as exc:
            self.error = f"QuantumEdge ML load failed ({type(exc).__name__})"

    def status(self, now: float) -> dict[str, Any]:
        error = self.error
        if self.booster is not None and not 0 < now - self.holdout_end <= MAX_MODEL_AGE:
            error = "QuantumEdge ML artifact is stale or its holdout has not ended"
        return {"mode": self.mode, "model_id": self.model_id, "error": error,
                "ready": self.booster is not None and not error, "eligible_sides": sorted(self.sides)}

    def assess(self, candidate: dict[str, Any], now: float) -> dict[str, Any]:
        if self.mode == "off":
            return {"state": "OFF", "allows_review": True}
        self.load()
        status = self.status(now)
        reason = status["error"]
        score = None
        if not reason and self.booster is not None:
            key = f'{candidate["symbol"]}:{candidate["side"]}'
            if self.mode == "gate" and key not in self.sides:
                reason = "ML holdout did not qualify this index/side"
            elif key not in self.coverage:
                reason = "ML has no training coverage for this index/side"
            elif candidate["entry"]["quantity"] != candidate["contract"]["lot_size"]:
                reason = "QuantumEdge ML replay only validated one-lot setups"
            else:
                import lightgbm as lgb
                import numpy as np

                features = candidate.get("ml_features", ())
                if len(features) != len(FEATURE_NAMES) or not all(map(math.isfinite, features)):
                    reason = "QuantumEdge ML needs complete finite features"
                else:
                    try:
                        score = float(self.booster.predict(np.asarray([features]), num_threads=1)[0])
                    except (lgb.basic.LightGBMError, ValueError) as exc:
                        reason = f"LightGBM prediction failed ({type(exc).__name__})"
                    if score is not None and not 0 <= score <= 1:
                        score, reason = None, "LightGBM score is invalid"
        if reason or score is None:
            state = "UNAVAILABLE"
        else:
            state = "SHADOW" if self.mode == "shadow" else "PASS" if score >= THRESHOLD else "VETO"
            if state == "VETO":
                reason = f"LightGBM score {score:.3f} below {THRESHOLD:.2f}"
        return {"state": state, "score": score, "reason": reason, "model_id": self.model_id,
                "allows_review": self.mode == "shadow" or state == "PASS"}
