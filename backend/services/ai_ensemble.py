"""Real-Time AI Ensemble + Online Calibrator for Chart Intelligence.

Combines per-engine class probabilities, an online logistic-regression
calibrator that learns from realised candle outcomes, and a feature
sanitizer in a single low-latency module.

Design goals:
  * Stateless per-call API, per-symbol state held in singleton agents.
  * Pure NumPy — no GPU, no training files, sub-millisecond inference.
  * Fail-safe: any internal error returns a graceful neutral payload so
    upstream callers can keep streaming without disruption.
"""

from __future__ import annotations

from collections import deque
from threading import Lock
from time import time
from typing import Any, Deque, Dict, List, Optional, Tuple

import numpy as np

# 5-class layout: STRONG_BUY, BUY, NEUTRAL, SELL, STRONG_SELL
CLASS_KEYS: Tuple[str, ...] = ("STRONG_BUY", "BUY", "NEUTRAL", "SELL", "STRONG_SELL")
N_CLASSES = len(CLASS_KEYS)


# ──────────────────────────────────────────────────────────────────────────────
# Feature sanitization

class FeatureSanitizer:
    """Strips NaN/inf, clips outliers, and produces a stable feature vector."""

    @staticmethod
    def clean(arr: np.ndarray, lo: float = -1e6, hi: float = 1e6) -> np.ndarray:
        if arr.size == 0:
            return arr
        out = np.nan_to_num(arr, nan=0.0, posinf=hi, neginf=lo)
        return np.clip(out, lo, hi)

    @staticmethod
    def probs_to_signed(probs: Dict[str, float]) -> float:
        """Map 5-class distribution to a signed bull-bear score in [-1, +1]."""
        sb = float(probs.get("STRONG_BUY", 0.0)) / 100.0
        b  = float(probs.get("BUY", 0.0)) / 100.0
        s  = float(probs.get("SELL", 0.0)) / 100.0
        ss = float(probs.get("STRONG_SELL", 0.0)) / 100.0
        return float(np.clip((sb * 1.0 + b * 0.5) - (ss * 1.0 + s * 0.5), -1.0, 1.0))


# ──────────────────────────────────────────────────────────────────────────────
# Online logistic-regression calibrator

class OnlineCalibrator:
    """Tiny SGD logistic regressor that maps a signed score → P(up).

    Updates lazily: only when we observe a realised outcome for a previously
    issued prediction. Weights persist in-process for the session lifetime.
    """

    __slots__ = ("_w", "_b", "_lr", "_lock")

    def __init__(self, lr: float = 0.05):
        self._w = 1.0   # weight on signed score
        self._b = 0.0   # bias
        self._lr = lr
        self._lock = Lock()

    def predict(self, score: float) -> float:
        z = self._w * float(score) + self._b
        # numerically stable sigmoid
        if z >= 0:
            ez = np.exp(-z)
            return float(1.0 / (1.0 + ez))
        ez = np.exp(z)
        return float(ez / (1.0 + ez))

    def update(self, score: float, y_up: int) -> None:
        """SGD step: BCE loss on a single realised observation."""
        with self._lock:
            p = self.predict(score)
            err = p - float(y_up)
            self._w -= self._lr * err * float(score)
            self._b -= self._lr * err
            # Light L2 regularization to prevent runaway weights
            self._w *= 0.9995

    def snapshot(self) -> Dict[str, float]:
        return {"w": round(self._w, 4), "b": round(self._b, 4)}


# ──────────────────────────────────────────────────────────────────────────────
# Per-symbol ensemble agent

class _PendingPrediction:
    __slots__ = ("ts", "spot", "score", "p_up")

    def __init__(self, ts: float, spot: float, score: float, p_up: float):
        self.ts = ts
        self.spot = spot
        self.score = score
        self.p_up = p_up


class SymbolEnsembleAgent:
    """Per-symbol state: rolling history, pending prediction, hit-rate trail."""

    def __init__(self, history_len: int = 50):
        self.calibrator = OnlineCalibrator(lr=0.04)
        self._pending: Optional[_PendingPrediction] = None
        self._trail: Deque[int] = deque(maxlen=history_len)  # 1 = hit, 0 = miss
        self._hist_p: Deque[float] = deque(maxlen=history_len)
        self._lock = Lock()
        self._last_spot: float = 0.0

    @staticmethod
    def _outcome(spot_then: float, spot_now: float, predicted_up: bool) -> int:
        if spot_then <= 0 or spot_now <= 0:
            return 0
        move_pct = (spot_now - spot_then) / spot_then
        # 5 bps deadband to avoid learning noise on flat moves
        if abs(move_pct) < 5e-5:
            return 1 if not predicted_up and abs(move_pct) < 2e-5 else 0
        went_up = move_pct > 0
        return 1 if (went_up == predicted_up) else 0

    def step(self, *, spot: float, engine_probs: Dict[str, float]) -> Dict[str, Any]:
        now = time()
        score = FeatureSanitizer.probs_to_signed(engine_probs)

        with self._lock:
            # Settle prior pending prediction if it has aged at least 30 seconds
            if self._pending is not None and (now - self._pending.ts) >= 30.0 and spot > 0:
                pred_up = self._pending.p_up >= 0.5
                hit = self._outcome(self._pending.spot, spot, pred_up)
                # Train calibrator on realised label (1 if price went up)
                realised_up = 1 if spot > self._pending.spot else 0
                self.calibrator.update(self._pending.score, realised_up)
                self._trail.append(hit)
                self._hist_p.append(self._pending.p_up)
                self._pending = None

            # Issue new prediction
            p_up = self.calibrator.predict(score)
            if spot > 0:
                self._pending = _PendingPrediction(ts=now, spot=spot, score=score, p_up=p_up)

            self._last_spot = spot
            hits = sum(self._trail)
            n = len(self._trail)
            hit_rate = round((hits / n) * 100.0, 2) if n > 0 else 0.0

        # Re-cast unified P(up) into a 5-class distribution that re-weights the
        # engine probs toward the calibrator's view, preserving total mass.
        unified = self._reweight(engine_probs, p_up)
        confidence = round(abs(p_up - 0.5) * 200.0, 2)  # 0..100

        return {
            "provider": "online_calibrator+ensemble",
            "version": "ai_ensemble_v1",
            "unifiedProbUp": round(float(p_up) * 100.0, 2),
            "confidence": confidence,
            "classProbabilities": unified,
            "signedScore": round(score, 4),
            "calibrator": self.calibrator.snapshot(),
            "hitRatePct": hit_rate,
            "samples": n,
            "trail": list(self._trail),
        }

    @staticmethod
    def _reweight(probs: Dict[str, float], p_up: float) -> Dict[str, float]:
        """Blend engine class distribution with the calibrator's P(up).

        Splits target mass: P(up) into STRONG_BUY+BUY, (1-P(up)) into
        SELL+STRONG_SELL, and a fixed neutral floor of 8%. Preserves the
        relative ratios within bull and bear sides from the engine.
        """
        sb = max(0.0, float(probs.get("STRONG_BUY", 0.0)))
        b  = max(0.0, float(probs.get("BUY", 0.0)))
        s  = max(0.0, float(probs.get("SELL", 0.0)))
        ss = max(0.0, float(probs.get("STRONG_SELL", 0.0)))

        bull_sum = sb + b
        bear_sum = s + ss
        bull_ratio_sb = (sb / bull_sum) if bull_sum > 0 else 0.5
        bear_ratio_ss = (ss / bear_sum) if bear_sum > 0 else 0.5

        neutral = 8.0
        avail = 100.0 - neutral
        bull_total = avail * float(p_up)
        bear_total = avail * float(1.0 - p_up)

        return {
            "STRONG_BUY":  round(bull_total * bull_ratio_sb, 2),
            "BUY":         round(bull_total * (1.0 - bull_ratio_sb), 2),
            "NEUTRAL":     round(neutral, 2),
            "SELL":        round(bear_total * (1.0 - bear_ratio_ss), 2),
            "STRONG_SELL": round(bear_total * bear_ratio_ss, 2),
        }


# ──────────────────────────────────────────────────────────────────────────────
# Module-level registry

_AGENTS: Dict[str, SymbolEnsembleAgent] = {}
_REG_LOCK = Lock()


def get_agent(symbol: str) -> SymbolEnsembleAgent:
    with _REG_LOCK:
        a = _AGENTS.get(symbol)
        if a is None:
            a = SymbolEnsembleAgent()
            _AGENTS[symbol] = a
        return a


def compute_ensemble(
    *,
    symbol: str,
    spot: float,
    engine_probs: Dict[str, float],
) -> Dict[str, Any]:
    """Public entry point — call from chart_intelligence_ai.infer().

    Never raises: returns a neutral payload on any internal error so the
    upstream payload always remains well-formed.
    """
    try:
        return get_agent(symbol).step(spot=float(spot), engine_probs=engine_probs)
    except Exception:  # pragma: no cover - defensive
        return {
            "provider": "online_calibrator+ensemble",
            "version": "ai_ensemble_v1",
            "unifiedProbUp": 50.0,
            "confidence": 0.0,
            "classProbabilities": {
                "STRONG_BUY": 18.0, "BUY": 22.0,
                "NEUTRAL": 20.0,
                "SELL": 22.0, "STRONG_SELL": 18.0,
            },
            "signedScore": 0.0,
            "calibrator": {"w": 1.0, "b": 0.0},
            "hitRatePct": 0.0,
            "samples": 0,
            "trail": [],
        }
