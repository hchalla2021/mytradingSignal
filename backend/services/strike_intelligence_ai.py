"""AI augmentation layer for Strike Intelligence.

This module adds TensorFlow-ready predictive analytics on top of the existing
strike scoring engine while remaining production-safe when TensorFlow is not
installed.
"""

from __future__ import annotations

from collections import deque
from typing import Any, Deque, Dict, List

import numpy as np

try:
    import tensorflow as tf
except Exception:  # pragma: no cover - optional dependency
    tf = None


def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def _safe_int(v: Any, default: int = 0) -> int:
    try:
        return int(v) if v is not None else default
    except (TypeError, ValueError):
        return default


class StrikeIntelligenceAIEngine:
    """Streaming AI inference for option-strike intelligence."""

    def __init__(self, seq_len: int = 96):
        self._seq_len = seq_len
        self._buffers: Dict[str, Deque[float]] = {}

    def _get_buf(self, symbol: str) -> Deque[float]:
        if symbol not in self._buffers:
            self._buffers[symbol] = deque(maxlen=self._seq_len)
        return self._buffers[symbol]

    def _softmax_np(self, logits: np.ndarray) -> np.ndarray:
        shifted = logits - np.max(logits)
        exp_v = np.exp(shifted)
        den = np.sum(exp_v)
        if den <= 0:
            return np.ones_like(logits) / len(logits)
        return exp_v / den

    def infer(
        self,
        *,
        symbol: str,
        strikes: List[Dict[str, Any]],
        spot: float,
        atm: int,
        signal: str,
        score: float,
        confidence: int,
        regime: str,
        world_market: Dict[str, Any],
    ) -> Dict[str, Any]:
        buf = self._get_buf(symbol)
        if spot > 0:
            buf.append(float(spot))

        if len(buf) >= 10:
            arr = np.asarray(buf, dtype=np.float64)
            rets = np.diff(arr) / np.maximum(arr[:-1], 1e-9)
            seq_momentum = float(np.mean(rets[-8:]))
            seq_vol = float(np.std(rets[-20:])) if len(rets) >= 20 else float(np.std(rets))
            seq_trend_strength = min(1.0, abs(seq_momentum) * 140.0)
        else:
            seq_momentum = float(score) / 2500.0
            seq_vol = 0.0
            seq_trend_strength = min(1.0, abs(float(score)) / 100.0)

        ce_vol = sum(_safe_int((r.get("ce") or {}).get("volume")) for r in strikes)
        pe_vol = sum(_safe_int((r.get("pe") or {}).get("volume")) for r in strikes)
        ce_oi = sum(_safe_int((r.get("ce") or {}).get("oi")) for r in strikes)
        pe_oi = sum(_safe_int((r.get("pe") or {}).get("oi")) for r in strikes)
        ce_oi_chg = sum(_safe_int((r.get("ce") or {}).get("oiChange")) for r in strikes)
        pe_oi_chg = sum(_safe_int((r.get("pe") or {}).get("oiChange")) for r in strikes)

        total_vol = max(1, ce_vol + pe_vol)
        total_oi = max(1, ce_oi + pe_oi)
        ce_flow = ce_vol / total_vol
        pe_flow = pe_vol / total_vol
        oi_bias = (ce_oi - pe_oi) / total_oi
        oi_momentum = (ce_oi_chg - pe_oi_chg) / max(1.0, float(total_oi))

        trap_count = 0
        bos_up = 0
        bos_down = 0
        for row in strikes:
            ce_s = (row.get("ce") or {}).get("signals") or {}
            pe_s = (row.get("pe") or {}).get("signals") or {}
            if bool(ce_s.get("trap")):
                trap_count += 1
            if bool(pe_s.get("trap")):
                trap_count += 1
            bos_sig = ce_s.get("bos")
            if bos_sig == "UP":
                bos_up += 1
            elif bos_sig == "DOWN":
                bos_down += 1

        strike_count = max(1, len(strikes))
        trap_risk = min(100.0, (trap_count / (strike_count * 2.0)) * 120.0 + (seq_vol * 3200.0))
        fake_breakout_risk = min(100.0, max(0.0, trap_risk * 0.62 + abs(bos_up - bos_down) * 4.0))
        stop_hunt_risk = min(100.0, max(0.0, seq_vol * 4200.0 + (20.0 if regime == "TRAP_ZONE" else 0.0)))

        institutional_activity = min(
            100.0,
            max(
                0.0,
                (abs(oi_momentum) * 900000.0)
                + (max(ce_flow, pe_flow) * 35.0)
                + (min(100.0, abs(score)) * 0.35),
            ),
        )

        trend_cont_prob = min(99.0, max(1.0, (seq_trend_strength * 40.0) + (abs(score) * 0.45) + confidence * 0.20))
        reversal_prob = min(99.0, max(1.0, 100.0 - trend_cont_prob + (trap_risk * 0.25)))

        # Return projection in points and direction label.
        projected_pts = (seq_momentum * spot * 10.0) + (score * 0.12)
        if projected_pts > 2.0:
            projected_dir = "UP"
        elif projected_pts < -2.0:
            projected_dir = "DOWN"
        else:
            projected_dir = "SIDEWAYS"

        # Regime class logits in fixed order.
        # [STRONG_BUY, BUY, NEUTRAL, SELL, STRONG_SELL]
        strength = min(1.0, abs(score) / 60.0)
        bull_core = max(0.0, strength + (ce_flow - pe_flow) * 0.9 + max(0.0, seq_momentum * 150.0))
        bear_core = max(0.0, strength + (pe_flow - ce_flow) * 0.9 + max(0.0, -seq_momentum * 150.0))
        neutral_core = max(0.0, 1.0 - strength + (0.30 if projected_dir == "SIDEWAYS" else 0.0))

        logits_np = np.array(
            [
                bull_core * 2.2 + confidence / 120.0,
                bull_core * 1.5 + max(0.0, score) / 160.0,
                neutral_core,
                bear_core * 1.5 + max(0.0, -score) / 160.0,
                bear_core * 2.2 + confidence / 120.0,
            ],
            dtype=np.float64,
        )

        if tf is not None:
            probs = tf.nn.softmax(tf.convert_to_tensor(logits_np, dtype=tf.float32)).numpy().astype(float)
            provider = "tensorflow"
        else:
            probs = self._softmax_np(logits_np).astype(float)
            provider = "numpy_fallback"

        # SMC proxy signals from strike flow + BOS + OI behavior.
        if bos_up > bos_down and oi_momentum > 0:
            smc_state = "BULLISH_DISPLACEMENT"
        elif bos_down > bos_up and oi_momentum < 0:
            smc_state = "BEARISH_DISPLACEMENT"
        elif trap_risk >= 45:
            smc_state = "LIQUIDITY_SWEEP_RISK"
        else:
            smc_state = "BALANCED"

        smc_score = min(100.0, max(0.0, abs(bos_up - bos_down) * 12.0 + abs(oi_momentum) * 600000.0))

        # Multi-timeframe correlation proxy using streaming sequence windows.
        if len(buf) >= 48:
            arr = np.asarray(buf, dtype=np.float64)
            r = np.diff(arr) / np.maximum(arr[:-1], 1e-9)
            micro = float(np.mean(r[-8:]))
            medium = float(np.mean(r[-24:]))
            macro = float(np.mean(r[-48:]))
        else:
            micro = seq_momentum
            medium = seq_momentum * 0.8
            macro = seq_momentum * 0.6

        def _trend_label(v: float) -> str:
            if v > 0.0007:
                return "BULL"
            if v < -0.0007:
                return "BEAR"
            return "NEUTRAL"

        micro_t = _trend_label(micro)
        medium_t = _trend_label(medium)
        macro_t = _trend_label(macro)
        aligned = int(micro_t == medium_t) + int(medium_t == macro_t) + int(micro_t == macro_t)
        alignment_pct = round((aligned / 3.0) * 100.0, 2)

        world_bias = str(world_market.get("bias") or "NEUTRAL")
        if world_bias == "BULLISH":
            corr_bias = "POSITIVE_RISK_ON"
        elif world_bias == "BEARISH":
            corr_bias = "RISK_OFF"
        else:
            corr_bias = "MIXED"

        return {
            "provider": provider,
            "featureVersion": "strike_ai_v1",
            "classProbabilities": {
                "STRONG_BUY": round(float(probs[0]) * 100.0, 2),
                "BUY": round(float(probs[1]) * 100.0, 2),
                "NEUTRAL": round(float(probs[2]) * 100.0, 2),
                "SELL": round(float(probs[3]) * 100.0, 2),
                "STRONG_SELL": round(float(probs[4]) * 100.0, 2),
            },
            "sequencePrediction": {
                "nextMove": projected_dir,
                "nextMovePts": round(float(projected_pts), 2),
                "trendContinuationProb": round(float(trend_cont_prob), 2),
                "reversalProb": round(float(reversal_prob), 2),
                "horizonSec": 300,
            },
            "microstructure": {
                "liquidityScore": round(float(max(0.0, min(100.0, (ce_flow + pe_flow) * 50.0 + institutional_activity * 0.5))), 2),
                "fakeBreakoutRisk": round(float(fake_breakout_risk), 2),
                "stopHuntRisk": round(float(stop_hunt_risk), 2),
                "institutionalActivity": round(float(institutional_activity), 2),
                "ceFlowPct": round(float(ce_flow * 100.0), 2),
                "peFlowPct": round(float(pe_flow * 100.0), 2),
            },
            "smc": {
                "state": smc_state,
                "score": round(float(smc_score), 2),
                "bosUpCount": bos_up,
                "bosDownCount": bos_down,
            },
            "multiTimeframe": {
                "micro": {"trend": micro_t, "momentum": round(float(micro * 10000.0), 2)},
                "medium": {"trend": medium_t, "momentum": round(float(medium * 10000.0), 2)},
                "macro": {"trend": macro_t, "momentum": round(float(macro * 10000.0), 2)},
                "alignmentPct": alignment_pct,
                "worldCorrelationBias": corr_bias,
            },
            "execution": {
                "preferredSide": "CE" if signal in ("BUY", "STRONG_BUY") else "PE" if signal in ("SELL", "STRONG_SELL") else "NONE",
                "actionability": "HIGH" if confidence >= 75 else "MEDIUM" if confidence >= 55 else "LOW",
                "confidence": confidence,
            },
        }
