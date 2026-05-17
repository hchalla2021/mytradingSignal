"""AI augmentation layer for market regime intelligence.

This module is intentionally dependency-tolerant:
- Uses TensorFlow ops when available for inference calculations.
- Falls back to NumPy-only calculations when TensorFlow is unavailable.

The output is deterministic and safe for production even without a trained
deep model checkpoint. It is designed as a pluggable interface so a trained
Keras model can be swapped in later without changing API contracts.
"""

from __future__ import annotations

import math
from collections import deque
from typing import Any, Deque, Dict

import numpy as np

try:
    import tensorflow as tf
except Exception:  # pragma: no cover - optional dependency
    tf = None


class MarketRegimeAIEngine:
    """Lightweight AI inference wrapper for real-time regime intelligence."""

    def __init__(self, seq_len: int = 64):
        self._seq_len = seq_len
        self._symbol_buffers: Dict[str, Deque[float]] = {}

    def _buf(self, symbol: str) -> Deque[float]:
        if symbol not in self._symbol_buffers:
            self._symbol_buffers[symbol] = deque(maxlen=self._seq_len)
        return self._symbol_buffers[symbol]

    def _softmax_np(self, logits: np.ndarray) -> np.ndarray:
        shifted = logits - np.max(logits)
        exp_v = np.exp(shifted)
        denom = np.sum(exp_v)
        if denom <= 0:
            return np.ones_like(logits) / len(logits)
        return exp_v / denom

    def infer(
        self,
        *,
        symbol: str,
        regime_score: float,
        direction_strength: float,
        intraday_pct: float,
        factors: Dict[str, Dict[str, Any]],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        # Convert key inputs to stable numeric features.
        f_directional = float((factors.get("directional_move") or {}).get("score", 0.0)) / 100.0
        f_ema = float((factors.get("ema_alignment") or {}).get("score", 0.0)) / 100.0
        f_consistency = float((factors.get("candle_consistency") or {}).get("score", 0.0)) / 100.0
        f_range = float((factors.get("range_expansion") or {}).get("score", 0.0)) / 100.0
        f_volume = float((factors.get("volume_trend") or {}).get("score", 0.0)) / 100.0
        f_oi = float((factors.get("oi_conviction") or {}).get("score", 0.0)) / 100.0
        f_recent = float((factors.get("recent_momentum") or {}).get("score", 0.0)) / 100.0

        price = float(context.get("price", 0.0) or 0.0)
        vix = float(context.get("vix", 0.0) or 0.0)
        pcr = float(context.get("pcr", 0.0) or 0.0)

        # Keep a short streaming sequence for sequence-derived signals.
        buf = self._buf(symbol)
        if price > 0:
            buf.append(price)

        if len(buf) >= 8:
            arr = np.asarray(buf, dtype=np.float64)
            returns = np.diff(arr) / np.maximum(arr[:-1], 1e-9)
            seq_momentum = float(np.mean(returns[-7:]))
            seq_vol = float(np.std(returns[-14:])) if len(returns) >= 14 else float(np.std(returns))
        else:
            seq_momentum = float(intraday_pct) / 100.0
            seq_vol = 0.0

        # Regime class logits in a fixed class order.
        # [STRONG_TRENDING_BULLISH, TRENDING_BULLISH, NEUTRAL,
        #  SIDEWAYS, TRENDING_BEARISH, STRONG_TRENDING_BEARISH]
        trend_core = (0.38 * f_ema) + (0.24 * f_consistency) + (0.18 * f_recent) + (0.20 * f_range)
        bull_core = trend_core + max(0.0, seq_momentum * 120.0) / 100.0
        bear_core = trend_core + max(0.0, -seq_momentum * 120.0) / 100.0
        sideways_core = max(0.0, 1.0 - trend_core) + max(0.0, 0.6 - abs(seq_momentum) * 100.0)
        neutral_core = 1.0 - abs(0.5 - trend_core)

        logits_np = np.array(
            [
                (bull_core * 2.2) + (regime_score / 100.0) + (direction_strength / 180.0),
                (bull_core * 1.6) + (f_directional * 0.6),
                neutral_core,
                sideways_core,
                (bear_core * 1.6) + (f_directional * 0.6),
                (bear_core * 2.2) + (regime_score / 100.0) + (direction_strength / 180.0),
            ],
            dtype=np.float64,
        )

        if tf is not None:
            logits_tf = tf.convert_to_tensor(logits_np, dtype=tf.float32)
            probs = tf.nn.softmax(logits_tf).numpy().astype(float)
            provider = "tensorflow"
        else:
            probs = self._softmax_np(logits_np).astype(float)
            provider = "numpy_fallback"

        regime_probabilities = {
            "STRONG_TRENDING_BULLISH": round(float(probs[0]) * 100, 2),
            "TRENDING_BULLISH": round(float(probs[1]) * 100, 2),
            "NEUTRAL": round(float(probs[2]) * 100, 2),
            "SIDEWAYS": round(float(probs[3]) * 100, 2),
            "TRENDING_BEARISH": round(float(probs[4]) * 100, 2),
            "STRONG_TRENDING_BEARISH": round(float(probs[5]) * 100, 2),
        }

        trend_cont_prob = min(99.0, max(1.0, (f_recent * 45.0) + (f_ema * 35.0) + (f_consistency * 20.0)))
        reversal_prob = min(99.0, max(1.0, (seq_vol * 2800.0) + (max(0.0, 0.45 - f_recent) * 50.0)))

        # 5-minute return projection in basis points.
        projected_return_bps = (seq_momentum * 10000.0 * 0.6) + ((intraday_pct * 100.0) * 0.1)

        liquidity_pulse = min(100.0, max(0.0, (f_volume * 60.0) + (f_oi * 40.0)))
        fake_breakout_risk = min(100.0, max(0.0, (100.0 - f_consistency * 100.0) * 0.55 + seq_vol * 2200.0))
        stop_hunt_risk = min(100.0, max(0.0, (seq_vol * 2600.0) + (max(0.0, 18.0 - vix) * 1.7)))

        # Institutional activity proxy from OI + volume + directional coherence.
        institutional_activity = min(
            100.0,
            max(0.0, (f_oi * 45.0) + (f_volume * 35.0) + (f_directional * 20.0)),
        )

        return {
            "provider": provider,
            "featureVersion": "regime_ai_v1",
            "regimeProbabilities": regime_probabilities,
            "sequencePrediction": {
                "next5mReturnBps": round(float(projected_return_bps), 2),
                "trendContinuationProb": round(float(trend_cont_prob), 2),
                "reversalProb": round(float(reversal_prob), 2),
            },
            "microstructure": {
                "liquidityPulse": round(float(liquidity_pulse), 2),
                "fakeBreakoutRisk": round(float(fake_breakout_risk), 2),
                "stopHuntRisk": round(float(stop_hunt_risk), 2),
                "institutionalActivityScore": round(float(institutional_activity), 2),
                "pcrContext": round(float(pcr), 3),
                "vixContext": round(float(vix), 2),
            },
        }
