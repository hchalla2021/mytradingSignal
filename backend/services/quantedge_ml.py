"""
QuantEdge Layer-8 — Streaming ML Predictor
==========================================
Predicts the next-N-tick directional bias (UP / DOWN) for each symbol
using an online-refit classifier.  Feeds a probability back into the
Smart AI Algo confidence layer as a soft boost / veto.

Design:
  • Primary backend  : LightGBM (already listed in backend/requirements.txt).
  • Fallback backend : pure-NumPy logistic regression trained with SGD.
                       Chosen automatically when LightGBM cannot be imported.

Data path:
  1. `observe_and_predict(symbol, features, price)` is called every rule
     tick.  The current feature vector + spot price are pushed into a
     pending queue keyed by the tick counter.
  2. When a pending sample matures (HORIZON_TICKS later) it is labelled
     with `1` if future_price - price > NOISE_FLOOR * price, else `0`.
     Samples where |move| < NOISE_FLOOR are discarded (flat).
  3. Every REFIT_INTERVAL new labels the model is retrained on the
     rolling buffer (max BUFFER_SIZE samples).
  4. Prediction is emitted only after MIN_TRAIN_SAMPLES have been
     observed; before that the predictor returns UNKNOWN.

The predictor is stateless w.r.t. the FastAPI request loop and safe to
call from `SmartAIAlgoService._tick`.
"""

from __future__ import annotations

import contextlib
import logging
import os
import pickle
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Deque, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

try:  # optional heavy dep — provided by backend/requirements.txt
    import lightgbm as lgb  # type: ignore
    _LGB_AVAILABLE = True
except Exception:  # pragma: no cover - fallback path
    lgb = None  # type: ignore
    _LGB_AVAILABLE = False

# ── Tunables ──────────────────────────────────────────────────────────────
HORIZON_TICKS = 30              # ≈ 60 s look-ahead at RULE_REFRESH_INTERVAL=2 s
NOISE_FLOOR = 0.0005            # 0.05 % — anything smaller counts as "flat"
BUFFER_SIZE = 800               # rolling training buffer per symbol
REFIT_INTERVAL = 40             # retrain every N new labelled samples
MIN_TRAIN_SAMPLES = 120         # emit predictions only after this many samples
CONFIDENT_PROB = 0.65           # prob above this triggers the feedback loop
VETO_PROB = 0.70                # prob above this on the *opposite* side vetoes
MODEL_DIR_ENV = "QUANTEDGE_ML_DIR"


# ── Feature vector layout (STABLE — do not reorder without bumping schema) ─
FEATURE_NAMES: Tuple[str, ...] = (
    "alpha_score",
    "f_momentum",
    "f_trend",
    "f_structure",
    "f_sentiment",
    "rsi",
    "roc5",
    "roc10",
    "atr_pct",
    "ema20_slope_pct",
    "bb_z",
    "vwap_dist_pct",
    "pcr_z",
    "oi_trend_code",
    "vol_regime_code",
    "trend_regime_code",
)

_OI_TREND_CODE = {
    "SHORT_BUILDUP": -1.0,
    "LONG_UNWINDING": -0.5,
    "NEUTRAL": 0.0,
    "SHORT_COVERING": 0.5,
    "LONG_BUILDUP": 1.0,
}
_VOL_REGIME_CODE = {"UNKNOWN": 0.0, "LOW": 0.25, "NORMAL": 0.5, "HIGH": 0.75, "EXTREME": 1.0}
_TREND_REGIME_CODE = {"RANGING": 0.0, "TRENDING_WEAK": 0.5, "TRENDING_STRONG": 1.0, "UNKNOWN": 0.0}


def extract_features(result_or_ind: Dict[str, Any]) -> List[float]:
    """Build the stable 16-dim feature vector from a QuantEdge result dict.

    Accepts either the full result payload from ``_rule_engine`` (which
    embeds ``indicators`` and ``factor_scores``) or a plain indicator dict
    that already carries the QuantEdge fields.
    """
    factor_scores = result_or_ind.get("factor_scores") or {}
    ind = result_or_ind.get("indicators") or result_or_ind
    regime_detail = (result_or_ind.get("regime_detail") or ind.get("regime_detail") or {})

    alpha = float(result_or_ind.get("alpha_score", 50.0) or 50.0)
    f_m = float(factor_scores.get("momentum", 50.0) or 50.0)
    f_t = float(factor_scores.get("trend", 50.0) or 50.0)
    f_s = float(factor_scores.get("structure", 50.0) or 50.0)
    f_n = float(factor_scores.get("sentiment", 50.0) or 50.0)

    rsi = float(ind.get("rsi", 50.0) or 50.0)
    roc5 = float(ind.get("roc5", 0.0) or 0.0)
    roc10 = float(ind.get("roc10", 0.0) or 0.0)
    atr_pct = float(ind.get("atr_pct", 0.0) or 0.0)
    slope = float(ind.get("ema20_slope_pct", 0.0) or 0.0)
    bb_z = float(ind.get("bb_z", 0.0) or 0.0)
    vwap_d = float(ind.get("vwap_dist_pct", 0.0) or 0.0)
    pcr_z = float(ind.get("pcr_z", 0.0) or 0.0)

    oi_code = _OI_TREND_CODE.get(str(ind.get("oi_trend", "NEUTRAL")).upper(), 0.0)
    vol_code = _VOL_REGIME_CODE.get(str(regime_detail.get("volatility", "UNKNOWN")).upper(), 0.0)
    trend_code = _TREND_REGIME_CODE.get(str(regime_detail.get("trend", "UNKNOWN")).upper(), 0.0)

    return [
        alpha / 100.0,
        f_m / 100.0,
        f_t / 100.0,
        f_s / 100.0,
        f_n / 100.0,
        rsi / 100.0,
        max(-5.0, min(5.0, roc5)) / 5.0,
        max(-5.0, min(5.0, roc10)) / 5.0,
        max(0.0, min(2.0, atr_pct)) / 2.0,
        max(-2.0, min(2.0, slope)) / 2.0,
        max(-3.0, min(3.0, bb_z)) / 3.0,
        max(-2.0, min(2.0, vwap_d)) / 2.0,
        max(-4.0, min(4.0, pcr_z)) / 4.0,
        oi_code,
        vol_code,
        trend_code,
    ]


# ── Pure-NumPy logistic regression (fallback backend) ─────────────────────
class _NumpySGDLogReg:
    """Minimal SGD-trained logistic regression — no sklearn dependency."""

    def __init__(self, n_features: int, lr: float = 0.05, l2: float = 1e-4):
        import numpy as _np
        self._np = _np
        self.w = _np.zeros(n_features, dtype=_np.float64)
        self.b = 0.0
        self.lr = lr
        self.l2 = l2
        self.n_features = n_features

    def _sigmoid(self, z):
        return 1.0 / (1.0 + self._np.exp(-self._np.clip(z, -30, 30)))

    def refit(self, X, y, epochs: int = 6) -> None:
        np = self._np
        Xa = np.asarray(X, dtype=np.float64)
        ya = np.asarray(y, dtype=np.float64)
        if Xa.ndim != 2 or Xa.shape[1] != self.n_features:
            return
        # Full-batch gradient descent (buffer is small, cheap)
        for _ in range(epochs):
            z = Xa @ self.w + self.b
            p = self._sigmoid(z)
            grad_w = Xa.T @ (p - ya) / len(ya) + self.l2 * self.w
            grad_b = float((p - ya).mean())
            self.w -= self.lr * grad_w
            self.b -= self.lr * grad_b

    def predict_proba_up(self, x: List[float]) -> float:
        np = self._np
        xa = np.asarray(x, dtype=np.float64)
        return float(self._sigmoid(xa @ self.w + self.b))


# ── Per-symbol predictor state ────────────────────────────────────────────
@dataclass
class _SymbolState:
    pending: Deque[Tuple[int, List[float], float]] = field(default_factory=lambda: deque(maxlen=HORIZON_TICKS * 3))
    buffer_X: Deque[List[float]] = field(default_factory=lambda: deque(maxlen=BUFFER_SIZE))
    buffer_y: Deque[int] = field(default_factory=lambda: deque(maxlen=BUFFER_SIZE))
    labels_since_fit: int = 0
    total_labels: int = 0
    tick_counter: int = 0
    model: Any = None
    backend: str = "none"


# ── Main predictor ────────────────────────────────────────────────────────
class QuantEdgeMLPredictor:
    """Online ML forecaster shared across NIFTY / BANKNIFTY / SENSEX."""

    def __init__(self, symbols: List[str], model_dir: Optional[str] = None):
        self._states: Dict[str, _SymbolState] = {s: _SymbolState() for s in symbols}
        self._model_dir = model_dir or os.environ.get(MODEL_DIR_ENV) or os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "quantedge_ml"
        )
        with contextlib.suppress(Exception):
            os.makedirs(self._model_dir, exist_ok=True)
        self._backend_name = "lightgbm" if _LGB_AVAILABLE else "numpy_sgd"
        for s in symbols:
            self._load(s)
        logger.info("QuantEdge ML predictor ready (backend=%s, dir=%s)", self._backend_name, self._model_dir)

    # ── Persistence ────────────────────────────────────────────────
    def _model_path(self, symbol: str) -> str:
        ext = "lgb.txt" if self._backend_name == "lightgbm" else "pkl"
        return os.path.join(self._model_dir, f"{symbol}.{ext}")

    def _save(self, symbol: str) -> None:
        st = self._states.get(symbol)
        if not st or st.model is None:
            return
        path = self._model_path(symbol)
        try:
            if self._backend_name == "lightgbm":
                st.model.save_model(path)
            else:
                with open(path, "wb") as fh:
                    pickle.dump(st.model, fh)
        except Exception as exc:  # pragma: no cover - disk faults
            logger.debug("QuantEdge ML save failed for %s: %s", symbol, exc)

    def _load(self, symbol: str) -> None:
        st = self._states.get(symbol)
        if not st:
            return
        path = self._model_path(symbol)
        if not os.path.exists(path):
            return
        try:
            if self._backend_name == "lightgbm":
                st.model = lgb.Booster(model_file=path)
                st.backend = "lightgbm"
            else:
                with open(path, "rb") as fh:
                    st.model = pickle.load(fh)
                st.backend = "numpy_sgd"
            logger.info("QuantEdge ML loaded model for %s from %s", symbol, path)
        except Exception as exc:
            logger.debug("QuantEdge ML load failed for %s: %s", symbol, exc)

    # ── Training ───────────────────────────────────────────────────
    def _refit(self, symbol: str) -> None:
        st = self._states[symbol]
        if len(st.buffer_X) < MIN_TRAIN_SAMPLES:
            return
        X = list(st.buffer_X)
        y = list(st.buffer_y)

        # Guard against a degenerate all-one-class buffer.
        # Reset the counter so we don't re-enter refit every tick until the
        # buffer naturally becomes balanced again.
        if sum(y) in (0, len(y)):
            st.labels_since_fit = 0
            return

        if self._backend_name == "lightgbm":
            try:
                import numpy as _np  # local import — required only on refit
                X_arr = _np.asarray(X, dtype=_np.float32)
                y_arr = _np.asarray(y, dtype=_np.int32)
                train_set = lgb.Dataset(X_arr, label=y_arr, free_raw_data=False)
                params = {
                    "objective": "binary",
                    "metric": "binary_logloss",
                    "learning_rate": 0.06,
                    "num_leaves": 15,
                    "min_data_in_leaf": 8,
                    "feature_fraction": 0.9,
                    "bagging_fraction": 0.9,
                    "bagging_freq": 3,
                    "verbose": -1,
                }
                booster = lgb.train(params, train_set, num_boost_round=80)
                st.model = booster
                st.backend = "lightgbm"
            except Exception as exc:
                logger.warning("QuantEdge ML lgb refit failed for %s: %s (falling back)", symbol, exc)
                self._backend_name = "numpy_sgd"

        if self._backend_name == "numpy_sgd":
            try:
                if not isinstance(st.model, _NumpySGDLogReg):
                    st.model = _NumpySGDLogReg(n_features=len(FEATURE_NAMES))
                st.model.refit(X, y)
                st.backend = "numpy_sgd"
            except Exception as exc:
                logger.warning("QuantEdge ML numpy refit failed for %s: %s", symbol, exc)
                st.model = None

        st.labels_since_fit = 0
        # Persist after each refit — cheap for both backends
        self._save(symbol)

    # ── Public API ─────────────────────────────────────────────────
    def observe_and_predict(self, symbol: str, features: List[float], price: float) -> Dict[str, Any]:
        if symbol not in self._states:
            self._states[symbol] = _SymbolState()
        st = self._states[symbol]
        st.tick_counter += 1

        # Enqueue the sample for delayed labelling
        if price > 0 and len(features) == len(FEATURE_NAMES):
            st.pending.append((st.tick_counter, list(features), float(price)))

        # Label any samples whose horizon has now matured
        matured = 0
        while st.pending and (st.tick_counter - st.pending[0][0]) >= HORIZON_TICKS:
            _t0, feat0, p0 = st.pending.popleft()
            if p0 <= 0:
                continue
            move_pct = (price - p0) / p0
            if abs(move_pct) < NOISE_FLOOR:
                continue  # flat — skip
            st.buffer_X.append(feat0)
            st.buffer_y.append(1 if move_pct > 0 else 0)
            st.labels_since_fit += 1
            st.total_labels += 1
            matured += 1

        if st.labels_since_fit >= REFIT_INTERVAL:
            self._refit(symbol)

        return self._predict(st, features)

    def _predict(self, st: _SymbolState, features: List[float]) -> Dict[str, Any]:
        base = {
            "direction": "UNKNOWN",
            "probability": 0.5,
            "confidence": 0,
            "horizon_ticks": HORIZON_TICKS,
            "expected_move_pct": 0.0,
            "samples_trained": st.total_labels,
            "buffer_size": len(st.buffer_X),
            "backend": st.backend,
            "model_status": "warmup",
        }
        if st.model is None or len(st.buffer_X) < MIN_TRAIN_SAMPLES or len(features) != len(FEATURE_NAMES):
            return base

        try:
            if st.backend == "lightgbm":
                import numpy as _np
                prob_up = float(st.model.predict(_np.asarray([features], dtype=_np.float32))[0])
            elif isinstance(st.model, _NumpySGDLogReg):
                prob_up = st.model.predict_proba_up(features)
            else:
                return base
        except Exception as exc:
            logger.debug("QuantEdge ML predict failed: %s", exc)
            base["model_status"] = "error"
            return base

        prob_up = max(0.0, min(1.0, prob_up))
        directional = abs(prob_up - 0.5) * 2.0  # 0..1
        direction = "UP" if prob_up > 0.5 else "DOWN" if prob_up < 0.5 else "FLAT"
        # Expected move heuristic: scale directional confidence by recent noise floor
        expected_move_pct = round((prob_up - 0.5) * 2.0 * 0.2, 3)  # bounded ±0.2 %
        return {
            "direction": direction,
            "probability": round(prob_up, 3),
            "confidence": round(directional * 100),
            "horizon_ticks": HORIZON_TICKS,
            "expected_move_pct": expected_move_pct,
            "samples_trained": st.total_labels,
            "buffer_size": len(st.buffer_X),
            "backend": st.backend,
            "model_status": "live",
        }

    def snapshot(self) -> Dict[str, Any]:
        return {
            "backend": self._backend_name,
            "model_dir": self._model_dir,
            "symbols": {
                s: {
                    "total_labels": st.total_labels,
                    "buffer": len(st.buffer_X),
                    "trained": st.model is not None,
                }
                for s, st in self._states.items()
            },
        }
