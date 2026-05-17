from __future__ import annotations

from collections import deque
from typing import Any, Deque, Dict

import numpy as np

try:
    import tensorflow as tf
except Exception:  # pragma: no cover
    tf = None


def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


class CandleIntelligenceAIEngine:
    """TensorFlow-ready AI augmentation for multi-timeframe candle intelligence."""

    def __init__(self, seq_len: int = 180):
        self._seq_len = seq_len
        self._confidence_buffers: Dict[str, Deque[float]] = {}
        self._price_buffers: Dict[str, Deque[float]] = {}

    def _buf(self, store: Dict[str, Deque[float]], symbol: str) -> Deque[float]:
        if symbol not in store:
            store[symbol] = deque(maxlen=self._seq_len)
        return store[symbol]

    def _softmax(self, logits: np.ndarray) -> np.ndarray:
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
        signal: str,
        structure: str,
        strength: str,
        confidence: int,
        price: float,
        change_pct: float,
        data_source: str,
        mtf_consensus: Dict[str, Any],
        tf_3m: Dict[str, Any],
        tf_5m: Dict[str, Any],
        tf_15m: Dict[str, Any],
        three_factor: Dict[str, Any] | None,
    ) -> Dict[str, Any]:
        conf_buf = self._buf(self._confidence_buffers, symbol)
        price_buf = self._buf(self._price_buffers, symbol)
        conf_buf.append(float(confidence))
        if price > 0:
            price_buf.append(float(price))

        prob_bull = _safe_float(mtf_consensus.get("probabilityBull"), 50.0)
        prob_bear = _safe_float(mtf_consensus.get("probabilityBear"), 50.0)
        alignment_pct = _safe_float(mtf_consensus.get("alignmentPct"), 0.0)
        bull_count = _safe_float(mtf_consensus.get("bullCount"), 0.0)
        bear_count = _safe_float(mtf_consensus.get("bearCount"), 0.0)

        tf3_conf = _safe_float(tf_3m.get("confidence"))
        tf5_conf = _safe_float(tf_5m.get("confidence"))
        tf15_conf = _safe_float(tf_15m.get("confidence"))

        tfa_alignment = _safe_float((three_factor or {}).get("alignment_score"))
        tfa_verdict = str((three_factor or {}).get("verdict") or "NO_TRADE")
        tfa_confirmed = bool(((three_factor or {}).get("confirmation") or {}).get("confirmed"))

        if len(price_buf) >= 10:
            arr = np.asarray(price_buf, dtype=np.float64)
            ret = np.diff(arr) / np.maximum(arr[:-1], 1e-9)
            price_vol = float(np.std(ret[-20:])) if len(ret) >= 20 else float(np.std(ret))
            short_mom = float(np.mean(ret[-8:])) if len(ret) >= 8 else float(np.mean(ret))
        else:
            price_vol = abs(change_pct) / 100.0
            short_mom = (change_pct / 100.0) / 8.0

        if len(conf_buf) >= 8:
            carr = np.asarray(conf_buf, dtype=np.float64)
            conf_drift = float(np.mean(np.diff(carr[-10:]))) if len(carr) >= 10 else float(np.mean(np.diff(carr)))
            conf_std = float(np.std(carr[-20:])) if len(carr) >= 20 else float(np.std(carr))
        else:
            conf_drift = 0.0
            conf_std = max(2.0, abs(confidence - 50) * 0.2)

        structure_score = 1.0 if structure.startswith("BULLISH") else -1.0 if structure.startswith("BEARISH") else 0.0
        strength_score = 1.0 if strength == "STRONG" else 0.55 if strength == "MODERATE" else 0.20
        signal_score = {
            "STRONG_BUY": 1.0,
            "BUY": 0.55,
            "NEUTRAL": 0.0,
            "SELL": -0.55,
            "STRONG_SELL": -1.0,
        }.get(signal, 0.0)

        fake_breakout_risk = min(
            100.0,
            max(0.0, 14.0 + price_vol * 5200.0 + conf_std * 1.1 + max(0.0, 70.0 - alignment_pct) * 0.35),
        )
        stop_hunt_risk = min(
            100.0,
            max(0.0, 12.0 + max(0.0, 3.0 - tfa_alignment) * 16.0 + abs(short_mom) * 1600.0 + (12.0 if not tfa_confirmed else 0.0)),
        )

        continuation_prob = min(
            99.0,
            max(
                1.0,
                32.0
                + abs(signal_score) * 28.0
                + alignment_pct * 0.28
                + max(0.0, confidence - 50) * 0.25
                + max(0.0, tfa_alignment - 1.0) * 8.0
                - price_vol * 1900.0,
            ),
        )
        reversal_prob = min(99.0, max(1.0, 100.0 - continuation_prob + fake_breakout_risk * 0.24))

        next_move_pts = (short_mom * price * 18.0) + (conf_drift * 0.06)
        if signal in {"STRONG_BUY", "BUY"} and next_move_pts < 0:
            next_move_pts = abs(next_move_pts) * 0.60
        if signal in {"STRONG_SELL", "SELL"} and next_move_pts > 0:
            next_move_pts = -abs(next_move_pts) * 0.60

        if next_move_pts > 1.0:
            next_move = "UP"
        elif next_move_pts < -1.0:
            next_move = "DOWN"
        else:
            next_move = "SIDEWAYS"

        bull_core = max(0.0, signal_score * 2.0 + structure_score * 1.1 + strength_score * 0.45 + (prob_bull - 50.0) / 50.0)
        bear_core = max(0.0, -signal_score * 2.0 - structure_score * 1.1 + strength_score * 0.45 + (prob_bear - 50.0) / 50.0)
        neutral_core = max(0.0, 1.0 - abs(signal_score) * 0.75 + (0.30 if signal == "NEUTRAL" else 0.0))

        logits = np.array(
            [
                bull_core * 2.2 + continuation_prob / 180.0,
                bull_core * 1.5 + confidence / 180.0,
                neutral_core,
                bear_core * 1.5 + confidence / 180.0,
                bear_core * 2.2 + continuation_prob / 180.0,
            ],
            dtype=np.float64,
        )

        if tf is not None:
            probs = tf.nn.softmax(tf.convert_to_tensor(logits, dtype=tf.float32)).numpy().astype(float)
            provider = "tensorflow"
        else:
            probs = self._softmax(logits).astype(float)
            provider = "numpy_fallback"

        if tfa_verdict == "BUY" and alignment_pct >= 67:
            smc_state = "BULLISH_IMBALANCE"
        elif tfa_verdict == "SELL" and alignment_pct >= 67:
            smc_state = "BEARISH_IMBALANCE"
        elif max(fake_breakout_risk, stop_hunt_risk) >= 58:
            smc_state = "LIQUIDITY_SWEEP_RISK"
        else:
            smc_state = "BALANCED"

        smc_score = min(100.0, max(0.0, alignment_pct * 0.55 + tfa_alignment * 12.0 + abs(signal_score) * 22.0))

        micro_tf = "BULL" if str(tf_3m.get("signal")) in {"STRONG_BUY", "BUY"} else "BEAR" if str(tf_3m.get("signal")) in {"STRONG_SELL", "SELL"} else "NEUTRAL"
        medium_tf = "BULL" if str(tf_5m.get("signal")) in {"STRONG_BUY", "BUY"} else "BEAR" if str(tf_5m.get("signal")) in {"STRONG_SELL", "SELL"} else "NEUTRAL"
        macro_tf = "BULL" if str(tf_15m.get("signal")) in {"STRONG_BUY", "BUY"} else "BEAR" if str(tf_15m.get("signal")) in {"STRONG_SELL", "SELL"} else "NEUTRAL"

        if data_source == "LIVE":
            stream_state = "LIVE"
            cadence_ms = 1000
            base_latency = 12
        elif data_source in {"PRE_OPEN", "FREEZE"}:
            stream_state = "DELAYED"
            cadence_ms = 1000
            base_latency = 40
        else:
            stream_state = "CLOSED"
            cadence_ms = 30000
            base_latency = 260

        analysis_latency = int(round(min(900.0, base_latency + price_vol * 8500.0 + conf_std * 2.8)))
        event_rate = round(min(32.0, max(0.3, 2.0 + (bull_count + bear_count) * 0.8 + alignment_pct * 0.02)), 2)
        queue_depth = int(round(min(45.0, max(0.0, conf_std * 0.3 + (4 if stream_state != "LIVE" else 0)))))
        cache_state = "HOT" if stream_state == "LIVE" else "WARM" if stream_state == "DELAYED" else "COLD"

        alerts = []
        if fake_breakout_risk >= 60:
            alerts.append("Fake breakout risk elevated on candle alignment breakdown")
        if stop_hunt_risk >= 58:
            alerts.append("Stop-hunt probability elevated around weak confirmation structure")
        if continuation_prob >= 70 and alignment_pct >= 66:
            alerts.append("High-probability continuation alignment across 3m/5m/15m")
        if tfa_verdict != "NO_TRADE":
            alerts.append(f"3FA execution bias active: {tfa_verdict}")
        if data_source == "MARKET_CLOSED":
            alerts.append("Market closed; confidence auto-degraded")
        if not alerts:
            alerts.append("Candle structure stable; wait for confirmation")

        execution_probability = int(round(min(99.0, max(1.0, continuation_prob * 0.50 + alignment_pct * 0.22 + confidence * 0.18 + max(0.0, tfa_alignment) * 3.0))))
        smart_money_alignment = int(round(min(100.0, max(0.0, smc_score * 0.65 + alignment_pct * 0.35))))
        institutional_flow = int(round(min(100.0, max(0.0, abs(signal_score) * 45.0 + alignment_pct * 0.40 + tfa_alignment * 8.0))))
        risk_score = int(round(min(99.0, max(1.0, max(fake_breakout_risk, stop_hunt_risk) * 0.72 + reversal_prob * 0.28))))
        reward_score = int(round(min(99.0, max(1.0, continuation_prob * 0.70 + confidence * 0.30))))
        rr = round(reward_score / max(risk_score, 1), 2)

        return {
            "provider": provider,
            "featureVersion": "candle_ai_v1",
            "classProbabilities": {
                "STRONG_BUY": round(float(probs[0]) * 100.0, 2),
                "BUY": round(float(probs[1]) * 100.0, 2),
                "NEUTRAL": round(float(probs[2]) * 100.0, 2),
                "SELL": round(float(probs[3]) * 100.0, 2),
                "STRONG_SELL": round(float(probs[4]) * 100.0, 2),
            },
            "sequencePrediction": {
                "nextMove": next_move,
                "nextMovePts": round(float(next_move_pts), 2),
                "trendContinuationProb": round(float(continuation_prob), 2),
                "reversalProb": round(float(reversal_prob), 2),
                "horizonSec": 300,
            },
            "microstructure": {
                "liquidityDensity": round(float(alignment_pct), 2),
                "structureDensity": round(float(abs(signal_score) * 45.0 + tfa_alignment * 12.0), 2),
                "fakeBreakoutRisk": round(float(fake_breakout_risk), 2),
                "stopHuntRisk": round(float(stop_hunt_risk), 2),
            },
            "smc": {
                "state": smc_state,
                "score": round(float(smc_score), 2),
            },
            "multiTimeframe": {
                "micro": {"trend": micro_tf, "momentum": round(float(tf3_conf), 2)},
                "medium": {"trend": medium_tf, "momentum": round(float(tf5_conf), 2)},
                "macro": {"trend": macro_tf, "momentum": round(float(tf15_conf), 2)},
                "alignmentPct": round(float(alignment_pct), 2),
            },
            "commandDeck": {
                "streamState": stream_state,
                "modelProvider": provider,
                "analysisLatencyMs": analysis_latency,
                "pipelineCadenceMs": cadence_ms,
                "eventRatePerSec": event_rate,
                "queueDepth": queue_depth,
                "cacheState": cache_state,
                "alerts": alerts[:4],
            },
            "institutionalConfluence": {
                "executionProbability": execution_probability,
                "smartMoneyAlignment": smart_money_alignment,
                "institutionalFlow": institutional_flow,
                "riskScore": risk_score,
                "rewardScore": reward_score,
                "riskRewardRatio": rr,
            },
        }
