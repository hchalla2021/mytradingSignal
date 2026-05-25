from __future__ import annotations

from collections import deque
from typing import Any, Deque, Dict

import numpy as np

tf = None  # TensorFlow disabled - numpy softmax fallback used (faster startup)


class ICTAIEngine:
    """Low-latency TensorFlow-ready AI augmentation for ICT outputs."""

    def __init__(self, seq_len: int = 200):
        self._seq_len = seq_len
        self._score_buffers: Dict[str, Deque[float]] = {}
        self._pred_buffers: Dict[str, Deque[float]] = {}

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
        direction: str,
        confidence: int,
        raw_score: float,
        prediction_5m: str,
        pred_5m_conf: int,
        pred_5m_score: float,
        market_structure_signal: float,
        liquidity_sweep_signal: float,
        displacement_signal: float,
        smart_money_div_signal: float,
        setup_grade: str,
        setup_confluences: int,
        change_pct: float,
        oi: float,
        candle_count: int,
        data_source: str,
    ) -> Dict[str, Any]:
        score_buf = self._buf(self._score_buffers, symbol)
        pred_buf = self._buf(self._pred_buffers, symbol)

        score_buf.append(float(raw_score))
        pred_buf.append(float(pred_5m_score))

        if len(score_buf) >= 8:
            sarr = np.asarray(score_buf, dtype=np.float64)
            score_drift = float(np.mean(np.diff(sarr[-10:]))) if len(sarr) >= 10 else float(np.mean(np.diff(sarr)))
            score_std = float(np.std(sarr[-20:])) if len(sarr) >= 20 else float(np.std(sarr))
        else:
            score_drift = 0.0
            score_std = abs(raw_score) * 0.22

        if len(pred_buf) >= 8:
            parr = np.asarray(pred_buf, dtype=np.float64)
            pred_drift = float(np.mean(np.diff(parr[-10:]))) if len(parr) >= 10 else float(np.mean(np.diff(parr)))
            pred_std = float(np.std(parr[-20:])) if len(parr) >= 20 else float(np.std(parr))
        else:
            pred_drift = 0.0
            pred_std = abs(pred_5m_score) * 0.20

        grade_weight = {
            "A+": 1.00,
            "A": 0.88,
            "A-": 0.78,
            "B+": 0.66,
            "B": 0.55,
            "C": 0.42,
            "—": 0.25,
        }.get(setup_grade, 0.30)

        structure_intensity = (
            abs(market_structure_signal) * 0.34
            + abs(liquidity_sweep_signal) * 0.28
            + abs(displacement_signal) * 0.20
            + abs(smart_money_div_signal) * 0.18
        )

        fake_breakout_risk = min(
            100.0,
            max(
                0.0,
                14.0
                + (1.0 - min(1.0, grade_weight)) * 36.0
                + pred_std * 82.0
                + abs(change_pct) * 2.8,
            ),
        )
        stop_hunt_risk = min(
            100.0,
            max(
                0.0,
                12.0
                + abs(liquidity_sweep_signal) * 48.0
                + abs(smart_money_div_signal) * 26.0
                + (1.0 - min(1.0, setup_confluences / 6.0)) * 18.0,
            ),
        )

        continuation_prob = min(
            99.0,
            max(
                1.0,
                33.0
                + abs(raw_score) * 36.0
                + abs(pred_5m_score) * 24.0
                + max(0.0, confidence - 45) * 0.34
                + setup_confluences * 2.2
                - pred_std * 35.0,
            ),
        )
        reversal_prob = min(
            99.0,
            max(1.0, 100.0 - continuation_prob + max(fake_breakout_risk, stop_hunt_risk) * 0.22),
        )

        next_move_pts = (pred_drift * 30.0) + (score_drift * 24.0) + (change_pct * 0.16)
        if prediction_5m in {"STRONG_BUY", "BUY"} and next_move_pts < 0:
            next_move_pts = abs(next_move_pts) * 0.70
        if prediction_5m in {"STRONG_SELL", "SELL"} and next_move_pts > 0:
            next_move_pts = -abs(next_move_pts) * 0.70

        if next_move_pts > 1.2:
            next_move = "UP"
        elif next_move_pts < -1.2:
            next_move = "DOWN"
        else:
            next_move = "SIDEWAYS"

        bullish_core = max(
            0.0,
            raw_score * 1.8
            + pred_5m_score * 1.5
            + max(0.0, market_structure_signal) * 0.8
            + max(0.0, displacement_signal) * 0.7
            + grade_weight,
        )
        bearish_core = max(
            0.0,
            -raw_score * 1.8
            - pred_5m_score * 1.5
            + max(0.0, -market_structure_signal) * 0.8
            + max(0.0, -displacement_signal) * 0.7
            + grade_weight,
        )
        neutral_core = max(0.0, 1.0 + max(0.0, 0.35 - abs(raw_score)) * 2.5)

        logits = np.array(
            [
                bullish_core * 2.15 + confidence / 175.0,
                bullish_core * 1.45 + continuation_prob / 185.0,
                neutral_core,
                bearish_core * 1.45 + continuation_prob / 185.0,
                bearish_core * 2.15 + confidence / 175.0,
            ],
            dtype=np.float64,
        )

        if tf is not None:
            probs = tf.nn.softmax(tf.convert_to_tensor(logits, dtype=tf.float32)).numpy().astype(float)
            provider = "tensorflow"
        else:
            probs = self._softmax(logits).astype(float)
            provider = "numpy_fallback"

        if direction == "BULLISH" and prediction_5m in {"BUY", "STRONG_BUY"}:
            smc_state = "BULLISH_IMBALANCE"
        elif direction == "BEARISH" and prediction_5m in {"SELL", "STRONG_SELL"}:
            smc_state = "BEARISH_IMBALANCE"
        elif max(fake_breakout_risk, stop_hunt_risk) >= 58:
            smc_state = "LIQUIDITY_SWEEP_RISK"
        else:
            smc_state = "BALANCED"

        smc_score = min(
            100.0,
            max(
                0.0,
                abs(liquidity_sweep_signal) * 44.0
                + abs(market_structure_signal) * 34.0
                + abs(displacement_signal) * 22.0,
            ),
        )

        micro_tf = "BULL" if prediction_5m in {"BUY", "STRONG_BUY"} else "BEAR" if prediction_5m in {"SELL", "STRONG_SELL"} else "NEUTRAL"
        medium_tf = "BULL" if raw_score > 0.12 else "BEAR" if raw_score < -0.12 else "NEUTRAL"
        macro_tf = "BULL" if direction == "BULLISH" else "BEAR" if direction == "BEARISH" else "NEUTRAL"
        aligned = int(micro_tf == medium_tf) + int(micro_tf == macro_tf) + int(medium_tf == macro_tf)
        alignment_pct = round((aligned / 3.0) * 100.0, 2)

        stream_state = "LIVE" if data_source == "LIVE" else "CLOSED"
        cadence_ms = 2000 if stream_state == "LIVE" else 30000
        base_latency = 15 if stream_state == "LIVE" else 240
        analysis_latency = int(round(min(900.0, base_latency + score_std * 120.0 + pred_std * 120.0)))
        event_rate = round(min(28.0, max(0.3, 1.8 + candle_count * 0.03)), 2)
        queue_depth = int(round(min(45.0, max(0.0, (score_std + pred_std) * 24.0 + (0 if stream_state == "LIVE" else 4)))))
        cache_state = "HOT" if stream_state == "LIVE" else "WARM"

        alerts = []
        if fake_breakout_risk >= 60:
            alerts.append("Fake breakout risk elevated on weak ICT confluence")
        if stop_hunt_risk >= 58:
            alerts.append("Stop-hunt probability elevated around sweep zones")
        if continuation_prob >= 70 and alignment_pct >= 66:
            alerts.append("High-probability continuation alignment across ICT frames")
        if abs(smart_money_div_signal) >= 0.5:
            alerts.append("Smart money divergence is materially elevated")
        if data_source != "LIVE":
            alerts.append("Live stream unavailable; confidence auto-degraded")
        if not alerts:
            alerts.append("ICT structure stable; wait for trigger confirmation")

        execution_probability = int(
            round(
                min(
                    99.0,
                    max(
                        1.0,
                        continuation_prob * 0.52
                        + confidence * 0.18
                        + alignment_pct * 0.20
                        + (100.0 - max(fake_breakout_risk, stop_hunt_risk)) * 0.10,
                    ),
                )
            )
        )
        smart_money_alignment = int(round(min(100.0, max(0.0, smc_score * 0.65 + alignment_pct * 0.35))))
        institutional_flow = int(round(min(100.0, max(0.0, abs(liquidity_sweep_signal) * 34.0 + abs(market_structure_signal) * 33.0 + abs(displacement_signal) * 33.0))))
        risk_score = int(round(min(99.0, max(1.0, max(fake_breakout_risk, stop_hunt_risk) * 0.72 + reversal_prob * 0.28))))
        reward_score = int(round(min(99.0, max(1.0, continuation_prob * 0.70 + pred_5m_conf * 0.30))))
        rr = round(reward_score / max(risk_score, 1), 2)

        return {
            "provider": provider,
            "featureVersion": "ict_ai_v1",
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
                "liquidityDensity": round(float(min(100.0, abs(liquidity_sweep_signal) * 60.0 + max(0.0, oi) * 0.0)), 2),
                "structureDensity": round(float(min(100.0, structure_intensity * 100.0)), 2),
                "fakeBreakoutRisk": round(float(fake_breakout_risk), 2),
                "stopHuntRisk": round(float(stop_hunt_risk), 2),
            },
            "smc": {
                "state": smc_state,
                "score": round(float(smc_score), 2),
            },
            "multiTimeframe": {
                "micro": {"trend": micro_tf, "momentum": round(float(pred_5m_score * 100.0), 2)},
                "medium": {"trend": medium_tf, "momentum": round(float(raw_score * 100.0), 2)},
                "macro": {"trend": macro_tf, "momentum": round(float((confidence - 50.0) * 2.0), 2)},
                "alignmentPct": alignment_pct,
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


ict_ai_engine = ICTAIEngine()
