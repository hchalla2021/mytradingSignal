"""AI augmentation layer for Strike Intelligence.

Production-grade streaming inference for option-strike intelligence.

Engines (in order of preference, all optional except NumPy):
    * NumPy                  - always required; ultra-fast feature math.
    * LightGBM               - bullish probability, buyer-momentum, liquidity-imbalance scoring.
    * PyTorch LSTM           - sequence-level next-move prediction (32-step return window).
    * TensorFlow             - softmax over class logits (legacy path, retained).

Every optional engine degrades gracefully when its package is unavailable so
the live FastAPI worker keeps streaming even on a minimal install.

Warm-start: LightGBM and the LSTM are initialised once at module load on
synthetic intraday-style sequences (sub-second total). This guarantees the
first live tick already returns useful ML scores instead of zeros.

Contract: ``StrikeIntelligenceAIEngine.infer()`` returns the exact same dict
keys as the previous engine. A new optional ``mlScoring`` key is appended.
"""

from __future__ import annotations

import logging
from collections import deque
from threading import Lock
from typing import Any, Deque, Dict, List, Optional

import numpy as np

logger = logging.getLogger(__name__)

# ── Optional ML engines (graceful import) ────────────────────────────────────

try:
    import lightgbm as lgb  # type: ignore
    _HAS_LGB = True
except Exception:  # pragma: no cover - optional dependency
    lgb = None  # type: ignore
    _HAS_LGB = False

try:
    import torch  # type: ignore
    import torch.nn as nn  # type: ignore
    _HAS_TORCH = True
except Exception:  # pragma: no cover - optional dependency
    torch = None  # type: ignore
    nn = None  # type: ignore
    _HAS_TORCH = False

try:
    import tensorflow as tf  # type: ignore
    _HAS_TF = True
except Exception:  # pragma: no cover - optional dependency
    tf = None  # type: ignore
    _HAS_TF = False


# ── Helpers ──────────────────────────────────────────────────────────────────

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


def _softmax_np(logits: np.ndarray) -> np.ndarray:
    shifted = logits - np.max(logits)
    exp_v = np.exp(shifted)
    den = float(np.sum(exp_v))
    if den <= 0:
        return np.ones_like(logits) / len(logits)
    return exp_v / den


def _clip01(x: float) -> float:
    if x < 0.0:
        return 0.0
    if x > 1.0:
        return 1.0
    return x


# ── LightGBM warm-start ─────────────────────────────────────────────────────
#
# Feature vector (10 dims) shared by every LGBM model:
#   [ce_flow, pe_flow, oi_bias, oi_momentum, score_norm, confidence_norm,
#    seq_momentum, seq_vol, bos_diff_norm, trap_density]

_LGB_FEATURE_DIM = 10
_LGB_LOCK = Lock()


def _make_lgbm_models() -> Optional[Dict[str, Any]]:
    """Train tiny LightGBM models on synthetic option-flow features."""
    if not _HAS_LGB:
        return None
    try:
        rng = np.random.default_rng(seed=20260522)
        n = 4096
        ce_flow = rng.uniform(0.30, 0.70, size=n)
        pe_flow = 1.0 - ce_flow
        oi_bias = rng.uniform(-0.6, 0.6, size=n)
        oi_momentum = rng.normal(0.0, 0.0008, size=n)
        score_norm = rng.uniform(-1.0, 1.0, size=n)
        conf_norm = rng.uniform(0.0, 1.0, size=n)
        seq_mom = rng.normal(0.0, 0.0015, size=n)
        seq_vol = rng.uniform(0.0, 0.004, size=n)
        bos_diff = rng.uniform(-1.0, 1.0, size=n)
        trap_density = rng.uniform(0.0, 1.0, size=n)

        X = np.stack(
            [ce_flow, pe_flow, oi_bias, oi_momentum, score_norm, conf_norm,
             seq_mom, seq_vol, bos_diff, trap_density],
            axis=1,
        )

        latent = (
            0.45 * (ce_flow - pe_flow)
            + 18.0 * oi_momentum
            + 25.0 * seq_mom
            + 0.30 * score_norm
            + 0.20 * bos_diff
            - 0.35 * trap_density * np.sign(score_norm)
            + rng.normal(0.0, 0.15, size=n)
        )
        y_bull = (latent > 0).astype(int)
        y_mom = latent.astype(float)
        y_liq = (np.abs(ce_flow - pe_flow) * (0.4 + 0.6 * conf_norm) + rng.normal(0.0, 0.05, size=n)).clip(0.0, 1.0)

        common = dict(
            num_leaves=15,
            min_data_in_leaf=20,
            learning_rate=0.08,
            feature_fraction=0.9,
            verbosity=-1,
        )
        bull = lgb.train(
            {**common, "objective": "binary", "metric": "binary_logloss"},
            lgb.Dataset(X, label=y_bull),
            num_boost_round=80,
        )
        mom = lgb.train(
            {**common, "objective": "regression", "metric": "l2"},
            lgb.Dataset(X, label=y_mom),
            num_boost_round=80,
        )
        liq = lgb.train(
            {**common, "objective": "regression", "metric": "l2"},
            lgb.Dataset(X, label=y_liq),
            num_boost_round=60,
        )
        logger.info("StrikeAI: LightGBM warm-start trained (n=%d).", n)
        return {"bull": bull, "momentum": mom, "liquidity": liq}
    except Exception as exc:  # pragma: no cover - never break the worker
        logger.warning("StrikeAI: LightGBM warm-start failed (%s); disabling.", exc)
        return None


# ── PyTorch LSTM warm-start ─────────────────────────────────────────────────

_LSTM_SEQ_LEN = 32
_LSTM_LOCK = Lock()


def _make_lstm_model() -> Optional[Any]:
    """Build a tiny LSTM and pretrain it on synthetic AR(1) regimes."""
    if not _HAS_TORCH:
        return None
    try:
        torch.manual_seed(20260522)

        class TinyLSTM(nn.Module):  # type: ignore[misc]
            def __init__(self) -> None:
                super().__init__()
                self.lstm = nn.LSTM(input_size=1, hidden_size=12, num_layers=1, batch_first=True)
                self.head = nn.Linear(12, 1)

            def forward(self, x):  # type: ignore[override]
                out, _ = self.lstm(x)
                return self.head(out[:, -1, :]).squeeze(-1)

        net = TinyLSTM()
        opt = torch.optim.Adam(net.parameters(), lr=5e-3)
        loss_fn = nn.MSELoss()

        rng = np.random.default_rng(seed=20260522)
        N = 256
        L = _LSTM_SEQ_LEN + 1
        seqs = np.zeros((N, L), dtype=np.float32)
        for i in range(N):
            phi = rng.uniform(-0.3, 0.85)  # AR(1) coef
            sigma = rng.uniform(0.0008, 0.0025)
            x_prev = 0.0
            for t in range(L):
                x_prev = phi * x_prev + rng.normal(0.0, sigma)
                seqs[i, t] = x_prev
        X = torch.from_numpy(seqs[:, :-1]).unsqueeze(-1)
        y = torch.from_numpy(seqs[:, -1])

        net.train()
        for _ in range(40):
            opt.zero_grad()
            pred = net(X)
            loss = loss_fn(pred, y)
            loss.backward()
            opt.step()
        net.eval()
        logger.info("StrikeAI: PyTorch LSTM warm-start trained (N=%d, L=%d).", N, _LSTM_SEQ_LEN)
        return net
    except Exception as exc:  # pragma: no cover
        logger.warning("StrikeAI: LSTM warm-start failed (%s); disabling.", exc)
        return None


_LGB_MODELS: Optional[Dict[str, Any]] = _make_lgbm_models()
_LSTM_NET: Optional[Any] = _make_lstm_model()


# ── Engine ──────────────────────────────────────────────────────────────────

class StrikeIntelligenceAIEngine:
    """Streaming AI inference for option-strike intelligence."""

    def __init__(self, seq_len: int = 96):
        self._seq_len = max(_LSTM_SEQ_LEN + 4, seq_len)
        self._buffers: Dict[str, Deque[float]] = {}

    def _get_buf(self, symbol: str) -> Deque[float]:
        if symbol not in self._buffers:
            self._buffers[symbol] = deque(maxlen=self._seq_len)
        return self._buffers[symbol]

    def _lgbm_predict(self, feat: np.ndarray) -> Dict[str, float]:
        if _LGB_MODELS is None:
            return {}
        try:
            with _LGB_LOCK:
                bull = float(_LGB_MODELS["bull"].predict(feat.reshape(1, -1))[0])
                mom = float(_LGB_MODELS["momentum"].predict(feat.reshape(1, -1))[0])
                liq = float(_LGB_MODELS["liquidity"].predict(feat.reshape(1, -1))[0])
            return {
                "bullProb": _clip01(bull),
                "momentum": float(mom),
                "liquidityImbalance": _clip01(liq),
            }
        except Exception as exc:  # pragma: no cover
            logger.debug("StrikeAI: LightGBM inference failed (%s).", exc)
            return {}

    def _lstm_predict(self, returns: np.ndarray) -> Dict[str, float]:
        if _LSTM_NET is None or returns.size < _LSTM_SEQ_LEN:
            return {}
        try:
            tail = returns[-_LSTM_SEQ_LEN:].astype(np.float32)
            with _LSTM_LOCK:
                with torch.no_grad():  # type: ignore[union-attr]
                    x = torch.from_numpy(tail).view(1, _LSTM_SEQ_LEN, 1)  # type: ignore[union-attr]
                    pred = float(_LSTM_NET(x).item())
            recent_vol = float(np.std(tail)) if tail.size > 1 else 0.0
            denom = max(recent_vol, 1e-6)
            z = abs(pred) / denom
            confidence = _clip01(min(1.0, z / 2.5))
            return {"nextReturn": pred, "confidence": confidence}
        except Exception as exc:  # pragma: no cover
            logger.debug("StrikeAI: LSTM inference failed (%s).", exc)
            return {}

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
            rets = np.zeros(0, dtype=np.float64)
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
        trap_density = min(1.0, trap_count / (strike_count * 2.0))
        trap_risk = min(100.0, trap_density * 120.0 + (seq_vol * 3200.0))
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

        # ── LightGBM scoring ─────────────────────────────────────────────
        feat = np.array(
            [
                ce_flow,
                pe_flow,
                oi_bias,
                oi_momentum,
                float(score) / 100.0,
                float(confidence) / 100.0,
                seq_momentum,
                seq_vol,
                (bos_up - bos_down) / float(strike_count),
                trap_density,
            ],
            dtype=np.float64,
        )
        lgbm = self._lgbm_predict(feat)

        # ── PyTorch LSTM next-move prediction ────────────────────────────
        lstm = self._lstm_predict(rets) if rets.size else {}

        # ── Blended sequence prediction (LSTM > NumPy fallback) ──────────
        if lstm:
            lstm_ret = float(lstm.get("nextReturn", 0.0))
            lstm_conf = float(lstm.get("confidence", 0.0))
            projected_pts = (lstm_ret * spot * 1.0) + (score * 0.05)
            trend_cont_prob = min(99.0, max(1.0,
                lstm_conf * 55.0
                + (abs(score) * 0.30)
                + confidence * 0.18
            ))
        else:
            projected_pts = (seq_momentum * spot * 10.0) + (score * 0.12)
            trend_cont_prob = min(99.0, max(1.0, (seq_trend_strength * 40.0) + (abs(score) * 0.45) + confidence * 0.20))

        if projected_pts > 2.0:
            projected_dir = "UP"
        elif projected_pts < -2.0:
            projected_dir = "DOWN"
        else:
            projected_dir = "SIDEWAYS"

        reversal_prob = min(99.0, max(1.0, 100.0 - trend_cont_prob + (trap_risk * 0.25)))

        # ── Class logits (LGBM-aware) ────────────────────────────────────
        strength = min(1.0, abs(score) / 60.0)
        bull_core = max(0.0, strength + (ce_flow - pe_flow) * 0.9 + max(0.0, seq_momentum * 150.0))
        bear_core = max(0.0, strength + (pe_flow - ce_flow) * 0.9 + max(0.0, -seq_momentum * 150.0))
        neutral_core = max(0.0, 1.0 - strength + (0.30 if projected_dir == "SIDEWAYS" else 0.0))

        if lgbm:
            lgb_bull_bias = (float(lgbm.get("bullProb", 0.5)) - 0.5) * 2.0  # -1..1
            bull_core *= 1.0 + max(0.0, lgb_bull_bias) * 0.45
            bear_core *= 1.0 + max(0.0, -lgb_bull_bias) * 0.45

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

        if _HAS_TF and tf is not None:
            try:
                probs = tf.nn.softmax(tf.convert_to_tensor(logits_np, dtype=tf.float32)).numpy().astype(float)
                softmax_provider = "tensorflow"
            except Exception:  # pragma: no cover
                probs = _softmax_np(logits_np).astype(float)
                softmax_provider = "numpy_fallback"
        else:
            probs = _softmax_np(logits_np).astype(float)
            softmax_provider = "numpy_fallback"

        engines: List[str] = []
        if _LGB_MODELS is not None:
            engines.append("lightgbm")
        if _LSTM_NET is not None:
            engines.append("torch_lstm")
        if softmax_provider == "tensorflow":
            engines.append("tensorflow")
        provider = "+".join(engines) if engines else "numpy_fallback"

        if bos_up > bos_down and oi_momentum > 0:
            smc_state = "BULLISH_DISPLACEMENT"
        elif bos_down > bos_up and oi_momentum < 0:
            smc_state = "BEARISH_DISPLACEMENT"
        elif trap_risk >= 45:
            smc_state = "LIQUIDITY_SWEEP_RISK"
        else:
            smc_state = "BALANCED"

        smc_score = min(100.0, max(0.0, abs(bos_up - bos_down) * 12.0 + abs(oi_momentum) * 600000.0))

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

        ml_scoring: Dict[str, Any] = {
            "provider": provider,
            "engines": engines,
            "lgbm": {
                "available": _LGB_MODELS is not None,
                "bullishProb": round(_clip01(lgbm.get("bullProb", 0.5)) * 100.0, 2) if lgbm else None,
                "buyerMomentum": round(float(lgbm.get("momentum", 0.0)), 4) if lgbm else None,
                "liquidityImbalance": round(_clip01(lgbm.get("liquidityImbalance", 0.0)) * 100.0, 2) if lgbm else None,
            },
            "lstm": {
                "available": _LSTM_NET is not None,
                "nextReturnPct": round(float(lstm.get("nextReturn", 0.0)) * 100.0, 4) if lstm else None,
                "nextMovePts": round(float(lstm.get("nextReturn", 0.0)) * spot, 2) if lstm else None,
                "confidence": round(float(lstm.get("confidence", 0.0)) * 100.0, 2) if lstm else None,
                "seqLen": _LSTM_SEQ_LEN,
                "samples": int(rets.size),
            },
            "softmaxProvider": softmax_provider,
        }

        return {
            "provider": provider,
            "featureVersion": "strike_ai_v2_ml",
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
            "mlScoring": ml_scoring,
        }
