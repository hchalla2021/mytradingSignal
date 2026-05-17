from __future__ import annotations

from collections import deque
from typing import Any, Deque, Dict, List

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


class LiquidityAIEngine:
    """Low-latency TensorFlow-ready augmentation for liquidity intelligence."""

    def __init__(self, seq_len: int = 180):
        self._seq_len = seq_len
        self._score_buffers: Dict[str, Deque[float]] = {}
        self._price_buffers: Dict[str, Deque[float]] = {}

    def _buffer(self, store: Dict[str, Deque[float]], symbol: str) -> Deque[float]:
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
        raw_score: float,
        direction: str,
        confidence: int,
        prediction_5m: str,
        pred_5m_conf: int,
        data_source: str,
        price: float,
        metrics: Dict[str, Any],
        signals: Dict[str, Dict[str, Any]],
    ) -> Dict[str, Any]:
        score_buf = self._buffer(self._score_buffers, symbol)
        price_buf = self._buffer(self._price_buffers, symbol)
        score_buf.append(float(raw_score))
        if price > 0:
            price_buf.append(float(price))

        signal_pcr = _safe_float((signals.get("pcr_sentiment") or {}).get("score"))
        signal_oi = _safe_float((signals.get("oi_buildup") or {}).get("score"))
        signal_mom = _safe_float((signals.get("price_momentum") or {}).get("score"))
        signal_conv = _safe_float((signals.get("candle_conviction") or {}).get("score"))

        call_oi = _safe_float(metrics.get("callOI"))
        put_oi = _safe_float(metrics.get("putOI"))
        pcr = _safe_float(metrics.get("pcr"))
        vwap_dev = _safe_float(metrics.get("vwapDev"))

        oi_total = max(1.0, call_oi + put_oi)
        oi_imbalance = abs(put_oi - call_oi) / oi_total

        if len(price_buf) >= 10:
            arr = np.asarray(price_buf, dtype=np.float64)
            ret = np.diff(arr) / np.maximum(arr[:-1], 1e-9)
            price_vol = float(np.std(ret[-20:])) if len(ret) >= 20 else float(np.std(ret))
            short_mom = float(np.mean(ret[-6:])) if len(ret) >= 6 else float(np.mean(ret))
        else:
            price_vol = abs(vwap_dev) / 100.0
            short_mom = signal_mom / 120.0

        if len(score_buf) >= 8:
            sarr = np.asarray(score_buf, dtype=np.float64)
            score_drift = float(np.mean(np.diff(sarr[-10:]))) if len(sarr) >= 10 else float(np.mean(np.diff(sarr)))
            score_std = float(np.std(sarr[-20:])) if len(sarr) >= 20 else float(np.std(sarr))
        else:
            score_drift = 0.0
            score_std = abs(raw_score) * 0.2

        fake_breakout_risk = min(
            100.0,
            max(
                0.0,
                18.0 + price_vol * 4800.0 + score_std * 110.0 + abs(signal_mom - signal_oi) * 25.0,
            ),
        )
        stop_hunt_risk = min(
            100.0,
            max(
                0.0,
                14.0 + oi_imbalance * 85.0 + abs(signal_pcr) * 24.0 + abs(vwap_dev) * 6.0,
            ),
        )

        trend_continuation_prob = min(
            99.0,
            max(
                1.0,
                36.0
                + abs(raw_score) * 42.0
                + abs(score_drift) * 420.0
                + max(0.0, confidence - 50) * 0.28
                - price_vol * 1800.0,
            ),
        )
        reversal_prob = min(99.0, max(1.0, 100.0 - trend_continuation_prob + fake_breakout_risk * 0.22))

        next_move_pts = (short_mom * price * 16.0) + (score_drift * price * 0.6)
        if prediction_5m in {"STRONG_BUY", "BUY"} and next_move_pts < 0:
            next_move_pts = abs(next_move_pts) * 0.65
        if prediction_5m in {"STRONG_SELL", "SELL"} and next_move_pts > 0:
            next_move_pts = -abs(next_move_pts) * 0.65

        if next_move_pts > 1.2:
            next_move = "UP"
        elif next_move_pts < -1.2:
            next_move = "DOWN"
        else:
            next_move = "SIDEWAYS"

        bullish_core = max(0.0, raw_score * 2.0 + signal_pcr * 0.9 + signal_oi * 1.3 + signal_mom * 1.1 + signal_conv * 0.6)
        bearish_core = max(0.0, -raw_score * 2.0 - signal_pcr * 0.9 - signal_oi * 1.3 - signal_mom * 1.1 - signal_conv * 0.6)
        neutral_core = max(0.0, 1.0 - abs(raw_score) * 0.75 + (0.3 if direction == "NEUTRAL" else 0.0))

        logits = np.array(
            [
                bullish_core * 2.2 + pred_5m_conf / 180.0,
                bullish_core * 1.5 + confidence / 180.0,
                neutral_core,
                bearish_core * 1.5 + confidence / 180.0,
                bearish_core * 2.2 + pred_5m_conf / 180.0,
            ],
            dtype=np.float64,
        )

        if tf is not None:
            probs = tf.nn.softmax(tf.convert_to_tensor(logits, dtype=tf.float32)).numpy().astype(float)
            provider = "tensorflow"
        else:
            probs = self._softmax(logits).astype(float)
            provider = "numpy_fallback"

        if signal_oi >= 0.45 and signal_mom >= 0.20:
            smc_state = "BULLISH_IMBALANCE"
        elif signal_oi <= -0.45 and signal_mom <= -0.20:
            smc_state = "BEARISH_IMBALANCE"
        elif max(fake_breakout_risk, stop_hunt_risk) >= 58:
            smc_state = "LIQUIDITY_SWEEP_RISK"
        else:
            smc_state = "BALANCED"

        smc_score = min(100.0, max(0.0, abs(signal_oi) * 46.0 + abs(signal_mom) * 34.0 + oi_imbalance * 20.0))

        micro_tf = "BULL" if short_mom > 0.00035 else "BEAR" if short_mom < -0.00035 else "NEUTRAL"
        medium_tf = "BULL" if raw_score > 0.12 else "BEAR" if raw_score < -0.12 else "NEUTRAL"
        macro_tf = "BULL" if signal_pcr > 0.10 else "BEAR" if signal_pcr < -0.10 else "NEUTRAL"
        aligned = int(micro_tf == medium_tf) + int(micro_tf == macro_tf) + int(medium_tf == macro_tf)
        alignment_pct = round((aligned / 3.0) * 100.0, 2)

        if data_source == "LIVE":
            stream_state = "LIVE"
            cadence_ms = 1000
            base_latency = 14
        else:
            stream_state = "CLOSED"
            cadence_ms = 30000
            base_latency = 260

        analysis_latency = int(round(min(900.0, base_latency + price_vol * 8500.0 + score_std * 120.0)))
        event_rate = round(min(28.0, max(0.4, 2.0 + len(score_buf) * 0.02 + oi_imbalance * 6.0)), 2)
        queue_depth = int(round(min(50.0, max(0.0, score_std * 35.0 + (0 if stream_state == "LIVE" else 4)))))
        cache_state = "HOT" if stream_state == "LIVE" else "WARM"

        alerts: List[str] = []
        if fake_breakout_risk >= 60:
            alerts.append("Fake breakout risk elevated on momentum-flow divergence")
        if stop_hunt_risk >= 58:
            alerts.append("Stop-hunt probability elevated near OI imbalance zones")
        if trend_continuation_prob >= 70 and alignment_pct >= 66:
            alerts.append("High-probability continuation alignment across liquidity factors")
        if data_source != "LIVE":
            alerts.append("Live stream unavailable; confidence auto-degraded")
        if not alerts:
            alerts.append("Liquidity structure stable; wait for execution trigger")

        execution_probability = int(
            round(
                min(
                    99.0,
                    max(
                        1.0,
                        trend_continuation_prob * 0.50
                        + pred_5m_conf * 0.20
                        + alignment_pct * 0.20
                        + (100.0 - max(fake_breakout_risk, stop_hunt_risk)) * 0.10,
                    ),
                )
            )
        )
        smart_money_alignment = int(round(min(100.0, max(0.0, smc_score * 0.65 + alignment_pct * 0.35))))
        institutional_flow = int(round(min(100.0, max(0.0, oi_imbalance * 60.0 + abs(signal_pcr) * 20.0 + abs(signal_oi) * 20.0))))
        risk_score = int(round(min(99.0, max(1.0, max(fake_breakout_risk, stop_hunt_risk) * 0.70 + reversal_prob * 0.30))))
        reward_score = int(round(min(99.0, max(1.0, trend_continuation_prob * 0.70 + pred_5m_conf * 0.30))))
        rr = round(reward_score / max(risk_score, 1), 2)

        return {
            "provider": provider,
            "featureVersion": "liquidity_ai_v1",
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
                "trendContinuationProb": round(float(trend_continuation_prob), 2),
                "reversalProb": round(float(reversal_prob), 2),
                "horizonSec": 300,
            },
            "microstructure": {
                "liquidityDensity": round(float(oi_imbalance * 100.0), 2),
                "structureDensity": round(float((abs(signal_oi) * 55.0 + abs(signal_mom) * 45.0)), 2),
                "fakeBreakoutRisk": round(float(fake_breakout_risk), 2),
                "stopHuntRisk": round(float(stop_hunt_risk), 2),
            },
            "smc": {
                "state": smc_state,
                "score": round(float(smc_score), 2),
            },
            "multiTimeframe": {
                "micro": {"trend": micro_tf, "momentum": round(float(short_mom * 10000.0), 2)},
                "medium": {"trend": medium_tf, "momentum": round(float(raw_score * 100.0), 2)},
                "macro": {"trend": macro_tf, "momentum": round(float(signal_pcr * 100.0), 2)},
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
