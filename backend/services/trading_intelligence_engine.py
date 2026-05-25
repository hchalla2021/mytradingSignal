"""
⚡ Trading Intelligence Engine — Institutional-Grade Real-Time AI
================================================================
Event-driven, incremental AI engine for NIFTY / BANKNIFTY / SENSEX.

Stack (all optional except NumPy — graceful degradation):
    NumPy       — feature math, rolling stats, softmax fallback (always on)
    LightGBM    — bullish probability + flow/momentum probability (CPU, ~5 MB)
    PyTorch     — LSTM next-return prediction over a 32-tick window
    TensorFlow  — 5-class softmax head (NumPy softmax fallback)

Architecture:
    Zerodha tick → MarketFeed → cache (market:{SYMBOL})
                                      │
                                      ▼
                       TradingIntelligenceEngine
                          • rolling ring buffers (NumPy)
                          • incremental features
                          • LightGBM + LSTM + TF inference
                                      │
                                      ▼
                            ws:/ws/intelligence
                            (incremental updates, 1.5s LIVE / 30s CLOSED)
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import deque
from threading import Lock
from typing import Any, Deque, Dict, List, Optional, Set, Tuple

import numpy as np
from fastapi import WebSocket

from services.cache import CacheService

logger = logging.getLogger(__name__)

# ── Optional ML engines ──────────────────────────────────────────────────────

try:
    import lightgbm as lgb  # type: ignore
    _HAS_LGB = True
except Exception:
    lgb = None  # type: ignore
    _HAS_LGB = False

try:
    import torch  # type: ignore
    import torch.nn as nn  # type: ignore
    _HAS_TORCH = True
except Exception:
    torch = None  # type: ignore
    nn = None  # type: ignore
    _HAS_TORCH = False

# TensorFlow disabled - numpy softmax fallback used (faster startup)
tf = None  # type: ignore
_HAS_TF = False


SYMBOLS: Tuple[str, ...] = ("NIFTY", "BANKNIFTY", "SENSEX")
CLASSES: Tuple[str, ...] = ("STRONG_SELL", "SELL", "NEUTRAL", "BUY", "STRONG_BUY")
_SEQ_LEN = 32
_FEAT_DIM = 12
_BUFFER = 128
_SPARK_LEN = 48


# ── helpers ──────────────────────────────────────────────────────────────────

def _f(v: Any, d: float = 0.0) -> float:
    try:
        if v is None:
            return d
        return float(v)
    except (TypeError, ValueError):
        return d


def _clip(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return lo if x < lo else hi if x > hi else x


def _softmax(z: np.ndarray) -> np.ndarray:
    z = z - z.max()
    e = np.exp(z)
    return e / max(e.sum(), 1e-9)


# ── Warm-trained models (built at import) ────────────────────────────────────

def _train_lgbm() -> Optional[Dict[str, Any]]:
    if not _HAS_LGB:
        return None
    try:
        rng = np.random.default_rng(7)
        n = 4096
        X = rng.standard_normal((n, _FEAT_DIM)).astype(np.float32)
        # Synthetic regime: bullishness is a weighted sum of features
        w = np.array([1.2, 0.8, 0.5, -0.4, 0.7, 0.3, -0.5, 0.4, 0.6, -0.3, 0.2, 0.5], dtype=np.float32)
        z = X @ w + 0.2 * rng.standard_normal(n).astype(np.float32)
        y_bull = (z > 0).astype(np.int32)
        y_flow = ((X @ np.array([0.2, 0.5, -0.3, 0.8, 0.4, -0.2, 0.3, 0.6, -0.4, 0.5, 0.2, -0.3], dtype=np.float32)) > 0).astype(np.int32)

        params = dict(
            objective="binary",
            num_leaves=15,
            learning_rate=0.08,
            min_data_in_leaf=20,
            verbose=-1,
            num_threads=1,
        )
        bull = lgb.train(params, lgb.Dataset(X, label=y_bull), num_boost_round=40)
        flow = lgb.train(params, lgb.Dataset(X, label=y_flow), num_boost_round=40)
        return {"bull": bull, "flow": flow}
    except Exception:
        logger.exception("[TIE] LightGBM warm-train failed")
        return None


def _train_lstm():
    if not _HAS_TORCH:
        return None
    try:
        rng = np.random.default_rng(11)

        class TinyLSTM(nn.Module):  # type: ignore
            def __init__(self) -> None:
                super().__init__()
                self.lstm = nn.LSTM(input_size=1, hidden_size=16, batch_first=True)
                self.head = nn.Linear(16, 1)

            def forward(self, x):  # type: ignore
                out, _ = self.lstm(x)
                return self.head(out[:, -1, :])

        torch.manual_seed(11)
        model = TinyLSTM()
        opt = torch.optim.Adam(model.parameters(), lr=5e-3)
        loss_fn = nn.MSELoss()

        # synthetic AR(1) sequences
        n = 256
        seqs = np.zeros((n, _SEQ_LEN, 1), dtype=np.float32)
        targets = np.zeros((n, 1), dtype=np.float32)
        for i in range(n):
            phi = rng.uniform(0.3, 0.85)
            s = np.zeros(_SEQ_LEN + 1, dtype=np.float32)
            for t in range(1, _SEQ_LEN + 1):
                s[t] = phi * s[t - 1] + 0.05 * rng.standard_normal()
            seqs[i, :, 0] = s[:_SEQ_LEN]
            targets[i, 0] = s[_SEQ_LEN] - s[_SEQ_LEN - 1]

        X = torch.from_numpy(seqs)
        y = torch.from_numpy(targets)
        for _ in range(4):
            opt.zero_grad()
            pred = model(X)
            loss = loss_fn(pred, y)
            loss.backward()
            opt.step()
        model.eval()
        return model
    except Exception:
        logger.exception("[TIE] LSTM warm-train failed")
        return None


def _train_tf_head():
    if not _HAS_TF:
        return None
    try:
        rng = np.random.default_rng(23)
        n = 2048
        X = rng.standard_normal((n, 6)).astype(np.float32)
        w = np.array([1.0, 0.6, -0.4, 0.5, 0.3, -0.2], dtype=np.float32)
        z = X @ w + 0.2 * rng.standard_normal(n).astype(np.float32)
        y = np.digitize(z, bins=[-0.8, -0.25, 0.25, 0.8]).astype(np.int32)

        model = tf.keras.Sequential([
            tf.keras.layers.Input(shape=(6,)),
            tf.keras.layers.Dense(24, activation="relu"),
            tf.keras.layers.Dense(5, activation="softmax"),
        ])
        model.compile(optimizer=tf.keras.optimizers.Adam(2e-3), loss="sparse_categorical_crossentropy")
        model.fit(X, y, epochs=2, batch_size=128, verbose=0)
        return model
    except Exception:
        logger.exception("[TIE] TF head warm-train failed")
        return None


_LGB = _train_lgbm()
_LSTM = _train_lstm()
_TF_HEAD = _train_tf_head()

if _LGB:    logger.info("[TIE] LightGBM warm-trained")
if _LSTM:   logger.info("[TIE] PyTorch LSTM warm-trained")
if _TF_HEAD: logger.info("[TIE] TensorFlow head warm-trained")


# ── Connection manager ───────────────────────────────────────────────────────

class IntelligenceConnectionManager:
    def __init__(self) -> None:
        self._clients: Set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._clients.add(ws)

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._clients.discard(ws)

    @property
    def clients(self) -> int:
        return len(self._clients)

    async def send_personal(self, ws: WebSocket, payload: Dict[str, Any]) -> None:
        try:
            await ws.send_text(json.dumps(payload, default=str))
        except Exception:
            pass

    async def broadcast(self, payload: Dict[str, Any]) -> None:
        if not self._clients:
            return
        text = json.dumps(payload, default=str)
        dead: List[WebSocket] = []
        for ws in list(self._clients):
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(ws)
        if dead:
            async with self._lock:
                for ws in dead:
                    self._clients.discard(ws)


# ── Per-symbol rolling state ─────────────────────────────────────────────────

class _SymbolState:
    __slots__ = (
        "symbol", "prices", "rets", "vols", "pcrs", "ois",
        "sparkline", "last_price", "last_tick_ts", "last_emit_ts",
        "lstm_pred", "snapshot",
    )

    def __init__(self, symbol: str) -> None:
        self.symbol = symbol
        self.prices: Deque[float] = deque(maxlen=_BUFFER)
        self.rets: Deque[float] = deque(maxlen=_BUFFER)
        self.vols: Deque[float] = deque(maxlen=_BUFFER)
        self.pcrs: Deque[float] = deque(maxlen=_BUFFER)
        self.ois: Deque[float] = deque(maxlen=_BUFFER)
        self.sparkline: Deque[float] = deque(maxlen=_SPARK_LEN)
        self.last_price: float = 0.0
        self.last_tick_ts: float = 0.0
        self.last_emit_ts: float = 0.0
        self.lstm_pred: float = 0.0
        self.snapshot: Optional[Dict[str, Any]] = None

    def ingest(self, tick: Dict[str, Any]) -> bool:
        """Append latest tick to ring buffers. Returns True if price changed."""
        p = _f(tick.get("price"))
        if p <= 0:
            return False
        changed = p != self.last_price
        if changed or not self.prices:
            self.prices.append(p)
            if self.last_price > 0:
                self.rets.append((p - self.last_price) / self.last_price)
            else:
                self.rets.append(0.0)
            self.sparkline.append(p)
            self.last_price = p
        self.vols.append(_f(tick.get("volume")))
        self.pcrs.append(_f(tick.get("pcr"), 1.0))
        self.ois.append(_f(tick.get("oi")))
        self.last_tick_ts = time.time()
        return changed


# ── Engine ───────────────────────────────────────────────────────────────────

class TradingIntelligenceEngine:
    def __init__(self) -> None:
        self.cache = CacheService()
        self._state: Dict[str, _SymbolState] = {s: _SymbolState(s) for s in SYMBOLS}
        self._lock = Lock()

    # ── Feature extraction (NumPy, vectorized) ──────────────────────────────
    def _features(self, st: _SymbolState, tick: Dict[str, Any]) -> np.ndarray:
        prices = np.asarray(st.prices, dtype=np.float32) if st.prices else np.array([st.last_price or 1.0], dtype=np.float32)
        rets   = np.asarray(st.rets,   dtype=np.float32) if st.rets   else np.zeros(1, dtype=np.float32)

        pct = _f(tick.get("changePercent"))
        pcr = _f(tick.get("pcr"), 1.0)
        oi  = _f(tick.get("oi"))
        vol = _f(tick.get("volume"))
        hi  = _f(tick.get("high"))
        lo  = _f(tick.get("low"))
        px  = max(st.last_price, 1.0)

        # rolling stats
        ret_mean = float(rets[-16:].mean()) if rets.size else 0.0
        ret_std  = float(rets[-32:].std())  if rets.size > 1 else 0.0
        ema_short = float(prices[-5:].mean())   if prices.size else px
        ema_long  = float(prices[-20:].mean())  if prices.size else px
        trend_strength = (ema_short - ema_long) / px

        # range / volatility proxy
        range_pct = (hi - lo) / px if px > 0 else 0.0
        # PCR z-score using recent window
        pcr_arr = np.asarray(st.pcrs, dtype=np.float32) if st.pcrs else np.array([1.0], dtype=np.float32)
        pcr_mean = float(pcr_arr.mean())
        pcr_std  = float(pcr_arr.std()) or 1e-3
        pcr_z = (pcr - pcr_mean) / pcr_std
        # OI delta
        oi_arr = np.asarray(st.ois, dtype=np.float32) if st.ois else np.array([oi or 1.0], dtype=np.float32)
        oi_delta = (oi - float(oi_arr.mean())) / max(float(oi_arr.mean()), 1.0)
        # Volume z
        vol_arr = np.asarray(st.vols, dtype=np.float32) if st.vols else np.array([vol or 1.0], dtype=np.float32)
        vol_z = (vol - float(vol_arr.mean())) / max(float(vol_arr.std()), 1.0)

        feats = np.array([
            pct / 1.5,
            ret_mean * 100.0,
            ret_std * 100.0,
            trend_strength * 100.0,
            range_pct * 100.0,
            (pcr - 1.0),
            _clip(pcr_z, -3.0, 3.0),
            _clip(oi_delta, -1.0, 1.0),
            _clip(vol_z, -3.0, 3.0),
            1.0 if tick.get("trend") == "bullish" else -1.0 if tick.get("trend") == "bearish" else 0.0,
            st.lstm_pred * 100.0,
            float(len(prices)) / _BUFFER,
        ], dtype=np.float32)
        return feats

    def _lgbm_probs(self, feats: np.ndarray) -> Tuple[float, float]:
        if _LGB is None:
            # NumPy fallback: logistic-like score
            bull = float(1.0 / (1.0 + np.exp(-(feats[0] + 0.5 * feats[3] + 0.3 * feats[6]))))
            flow = float(1.0 / (1.0 + np.exp(-(feats[5] + 0.3 * feats[8] + 0.2 * feats[7]))))
            return bull, flow
        try:
            X = feats.reshape(1, -1)
            bull = float(_LGB["bull"].predict(X)[0])
            flow = float(_LGB["flow"].predict(X)[0])
            return _clip(bull), _clip(flow)
        except Exception:
            return 0.5, 0.5

    def _lstm_pred(self, st: _SymbolState) -> float:
        if _LSTM is None or not _HAS_TORCH or len(st.rets) < _SEQ_LEN:
            # NumPy fallback: weighted recent return mean
            if not st.rets:
                return 0.0
            arr = np.asarray(st.rets, dtype=np.float32)[-_SEQ_LEN:]
            w = np.linspace(0.3, 1.0, arr.size, dtype=np.float32)
            return float((arr * w).sum() / w.sum())
        try:
            seq = np.asarray(st.rets, dtype=np.float32)[-_SEQ_LEN:].reshape(1, _SEQ_LEN, 1)
            with torch.no_grad():
                out = _LSTM(torch.from_numpy(seq)).item()
            return _clip(out, -0.05, 0.05)
        except Exception:
            return 0.0

    def _classify(self, bull: float, flow: float, lstm: float, feats: np.ndarray) -> Tuple[np.ndarray, int]:
        # Inputs for the head: [bull, flow, lstm*100, trend_strength, range_pct, pct]
        x = np.array([bull, flow, lstm * 100.0, feats[3], feats[4], feats[0]], dtype=np.float32)
        if _TF_HEAD is None or not _HAS_TF:
            # NumPy logistic-style mapping to 5 classes
            score = (bull - 0.5) * 2.0 + 0.4 * lstm * 100.0 + 0.3 * feats[3] + 0.2 * (flow - 0.5) * 2.0
            centers = np.array([-1.0, -0.4, 0.0, 0.4, 1.0], dtype=np.float32)
            logits = -np.abs(centers - score) * 2.0
            probs = _softmax(logits)
        else:
            try:
                probs = _TF_HEAD(x.reshape(1, -1), training=False).numpy()[0].astype(np.float32)
            except Exception:
                probs = np.array([0.05, 0.15, 0.6, 0.15, 0.05], dtype=np.float32)
        idx = int(np.argmax(probs))
        return probs, idx

    # ── Greeks (derived from real features) ─────────────────────────────────
    def _greeks(self, st: _SymbolState, tick: Dict[str, Any], lstm: float) -> Dict[str, Dict[str, Any]]:
        px = max(st.last_price, 1.0)
        pct = _f(tick.get("changePercent"))
        hi  = _f(tick.get("high"))
        lo  = _f(tick.get("low"))
        pcr = _f(tick.get("pcr"), 1.0)

        delta = _clip(pct / 1.5, -0.99, 0.99)
        gamma = _clip(max(hi - lo, 0.0) / px, 0.0, 0.05)

        rets = np.asarray(st.rets, dtype=np.float32) if st.rets else np.zeros(1, dtype=np.float32)
        vega = float(_clip(rets[-32:].std() * 120.0, 0.0, 1.0)) if rets.size > 1 else _clip(abs(pct) / 1.5, 0.0, 1.0)

        # session decay (9:15→15:30 IST mins=555..930)
        lt = time.localtime()
        mins = lt.tm_hour * 60 + lt.tm_min
        decay = _clip((mins - 555) / 375.0, 0.05, 1.0)
        theta = -_clip(0.005 + decay * 0.04, 0.005, 0.05)

        rho = _clip((pcr - 1.0) * 0.5, -0.5, 0.5)
        vanna = _clip(delta * vega * 0.5 + lstm * 0.2, -0.5, 0.5)

        def bias_signed(v: float) -> str:
            return "Buy" if v > 0.02 else "Sell" if v < -0.02 else "Neutral"

        return {
            "DELTA": {"value": delta, "bias": bias_signed(delta)},
            "GAMMA": {"value": gamma, "bias": "Buy"},
            "VEGA":  {"value": vega,  "bias": "Buy"},
            "THETA": {"value": theta, "bias": "Sell"},
            "RHO":   {"value": rho,   "bias": bias_signed(rho)},
            "VANNA": {"value": vanna, "bias": bias_signed(vanna)},
        }

    # ── Institutional intelligence: traps, breakouts, SMC, volume ───────────
    def _intelligence(
        self,
        st: _SymbolState,
        tick: Dict[str, Any],
        lstm: float,
        bull: float,
        flow: float,
    ) -> Dict[str, Any]:
        prices = np.asarray(st.prices, dtype=np.float32) if st.prices else np.array([st.last_price or 1.0], dtype=np.float32)
        rets   = np.asarray(st.rets,   dtype=np.float32) if st.rets   else np.zeros(1, dtype=np.float32)
        vols   = np.asarray(st.vols,   dtype=np.float32) if st.vols   else np.zeros(1, dtype=np.float32)
        ois    = np.asarray(st.ois,    dtype=np.float32) if st.ois    else np.zeros(1, dtype=np.float32)

        px = max(st.last_price, 1.0)
        hi = _f(tick.get("high")) or px
        lo = _f(tick.get("low"))  or px
        pcr = _f(tick.get("pcr"), 1.0)
        vol = _f(tick.get("volume"))
        oi  = _f(tick.get("oi"))

        # Volume spike z-score → 0..1
        vol_mean = float(vols.mean()) if vols.size else 0.0
        vol_std  = float(vols.std())  if vols.size > 1 else 1.0
        vol_z    = (vol - vol_mean) / max(vol_std, 1.0)
        volume_spike = float(_clip((vol_z + 1.0) / 3.0, 0.0, 1.0))

        # OI delta intensity (institutional positioning)
        oi_mean = float(ois.mean()) if ois.size else 0.0
        oi_intensity = float(_clip(abs(oi - oi_mean) / max(oi_mean, 1.0), 0.0, 1.0))

        # Swing high/low over recent window (SMC structure)
        win = prices[-32:] if prices.size >= 8 else prices
        swing_hi = float(win.max()) if win.size else px
        swing_lo = float(win.min()) if win.size else px

        # Fake breakout: pierced the swing then reverted within a few ticks
        last_n = prices[-8:] if prices.size >= 8 else prices
        broke_up   = bool(last_n.size and float(last_n.max()) > swing_hi * 0.9999 and px < swing_hi)
        broke_down = bool(last_n.size and float(last_n.min()) < swing_lo * 1.0001 and px > swing_lo)
        last_rets  = rets[-8:] if rets.size >= 4 else rets
        reversal_strength = float(abs(last_rets.sum())) if last_rets.size else 0.0
        fake_breakout = float(_clip(reversal_strength * 200.0, 0.0, 1.0)) if (broke_up or broke_down) else 0.0

        # Liquidity trap: extreme PCR + counter-direction LSTM signal
        pcr_extreme = abs(pcr - 1.0)
        contra = (pcr > 1.2 and lstm < -0.002) or (pcr < 0.8 and lstm > 0.002)
        liquidity_trap = float(_clip(pcr_extreme * 1.5 + (0.4 if contra else 0.0), 0.0, 1.0))

        # Stop-hunt: wick excursion vs body
        wick = max(hi - lo, 0.0) / px if px > 0 else 0.0
        body = abs(_f(tick.get("changePercent"))) / 100.0
        stop_hunt = float(_clip((wick - body * 1.5) * 30.0, 0.0, 1.0)) if wick > 0 else 0.0

        # SMC structure classification
        bos_up    = px > swing_hi * 0.9998 and lstm > 0
        bos_down  = px < swing_lo * 1.0002 and lstm < 0
        choch_up   = broke_down and px > (swing_lo + (swing_hi - swing_lo) * 0.6) and lstm > 0
        choch_down = broke_up   and px < (swing_lo + (swing_hi - swing_lo) * 0.4) and lstm < 0
        if choch_up:
            structure = "CHoCH_UP"
        elif choch_down:
            structure = "CHoCH_DOWN"
        elif bos_up:
            structure = "BOS_UP"
        elif bos_down:
            structure = "BOS_DOWN"
        else:
            structure = "RANGE"

        # Institutional activity composite
        institutional = float(_clip(
            0.45 * oi_intensity + 0.35 * volume_spike + 0.20 * abs(bull - 0.5) * 2.0,
            0.0, 1.0,
        ))

        # Compact alerts (severity ordered)
        alerts: List[Dict[str, str]] = []
        if liquidity_trap > 0.65:
            alerts.append({"kind": "LIQUIDITY_TRAP", "tone": "warn",
                           "text": f"Liquidity trap risk · PCR {pcr:.2f}"})
        if fake_breakout > 0.55:
            direction = "above" if broke_up else "below"
            alerts.append({"kind": "FAKE_BREAKOUT", "tone": "warn",
                           "text": f"Fake breakout {direction} swing"})
        if stop_hunt > 0.6:
            alerts.append({"kind": "STOP_HUNT", "tone": "warn",
                           "text": "Stop-hunt wick detected"})
        if volume_spike > 0.75:
            alerts.append({"kind": "VOLUME_SPIKE", "tone": "info",
                           "text": f"Volume spike +{vol_z:.1f}σ"})
        if structure in ("BOS_UP", "CHoCH_UP"):
            alerts.append({"kind": structure, "tone": "bull", "text": f"SMC {structure.replace('_', ' ')}"})
        elif structure in ("BOS_DOWN", "CHoCH_DOWN"):
            alerts.append({"kind": structure, "tone": "bear", "text": f"SMC {structure.replace('_', ' ')}"})
        if institutional > 0.7:
            alerts.append({"kind": "INSTITUTIONAL", "tone": "info",
                           "text": "Institutional flow active"})

        return {
            "liquidityTrap":  round(liquidity_trap, 3),
            "fakeBreakout":   round(fake_breakout, 3),
            "stopHunt":       round(stop_hunt, 3),
            "volumeSpike":    round(volume_spike, 3),
            "institutional":  round(institutional, 3),
            "oiIntensity":    round(oi_intensity, 3),
            "structure":      structure,
            "swingHigh":      round(swing_hi, 2),
            "swingLow":       round(swing_lo, 2),
            "alerts":         alerts[:4],
        }

    # ── Public: per-tick inference ──────────────────────────────────────────
    def infer(self, symbol: str, tick: Dict[str, Any]) -> Dict[str, Any]:
        t0 = time.perf_counter()
        st = self._state[symbol]
        st.ingest(tick)

        feats = self._features(st, tick)
        bull, flow = self._lgbm_probs(feats)
        lstm = self._lstm_pred(st)
        st.lstm_pred = lstm
        probs, idx = self._classify(bull, flow, lstm, feats)
        signal = CLASSES[idx]

        # strength 1..5 from prob mass + class index distance from neutral
        conf = float(probs[idx])
        dist = abs(idx - 2) / 2.0
        strength = int(np.clip(round(1 + (conf * 0.6 + dist * 0.4) * 4), 1, 5))

        greeks = self._greeks(st, tick, lstm)
        intel  = self._intelligence(st, tick, lstm, bull, flow)

        snap = {
            "symbol": symbol,
            "price": _f(tick.get("price")),
            "change": _f(tick.get("change")),
            "changePercent": _f(tick.get("changePercent")),
            "signal": signal,
            "signalLabel": signal.replace("_", " ").title().upper(),
            "signalStrength": strength,
            "confidence": round(conf * 100.0, 1),
            "probabilities": {CLASSES[i]: round(float(probs[i]), 4) for i in range(5)},
            "lstmReturnPred": round(lstm * 100.0, 4),
            "bullishProbability": round(bull * 100.0, 2),
            "flowProbability": round(flow * 100.0, 2),
            "tiles": greeks,
            "intelligence": intel,
            "sparkline": list(st.sparkline),
            "engines": {
                "numpy": True,
                "lightgbm": _LGB is not None,
                "pytorchLSTM": _LSTM is not None,
                "tensorflow": _TF_HEAD is not None,
            },
            "latencyMs": round((time.perf_counter() - t0) * 1000.0, 3),
            "timestamp": tick.get("timestamp") or time.time(),
            "status": tick.get("status") or "OFFLINE",
            "trend": tick.get("trend") or "neutral",
        }
        st.snapshot = snap
        st.last_emit_ts = time.time()
        return snap

    async def refresh_from_cache(self, symbol: str) -> Optional[Dict[str, Any]]:
        tick = await self.cache.get_market_data(symbol)
        if not tick:
            return self._state[symbol].snapshot
        return self.infer(symbol, tick)

    async def snapshot_all(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        for s in SYMBOLS:
            snap = await self.refresh_from_cache(s)
            if snap:
                out[s] = snap
        return out


# ── Singletons ───────────────────────────────────────────────────────────────

intelligence_engine = TradingIntelligenceEngine()
intelligence_manager = IntelligenceConnectionManager()

_loop_task: Optional[asyncio.Task] = None
_loop_running: bool = False


# ── Broadcast loop ───────────────────────────────────────────────────────────

async def _broadcast_loop() -> None:
    global _loop_running
    _loop_running = True
    logger.info("[TIE] Broadcast loop started")
    try:
        while _loop_running:
            try:
                snaps = await intelligence_engine.snapshot_all()
                any_live = any(s.get("status") == "LIVE" for s in snaps.values())
                if snaps and intelligence_manager.clients:
                    await intelligence_manager.broadcast({
                        "type": "intelligence_update",
                        "data": snaps,
                        "timestamp": time.time(),
                    })
                await asyncio.sleep(1.5 if any_live else 15.0)
            except Exception:
                logger.exception("[TIE] Broadcast iteration failed")
                await asyncio.sleep(3.0)
    finally:
        logger.info("[TIE] Broadcast loop stopped")


async def start_intelligence_loop() -> None:
    global _loop_task
    if _loop_task and not _loop_task.done():
        return
    _loop_task = asyncio.create_task(_broadcast_loop())


async def stop_intelligence_loop() -> None:
    global _loop_running, _loop_task
    _loop_running = False
    if _loop_task:
        try:
            await asyncio.wait_for(_loop_task, timeout=2.0)
        except Exception:
            pass
        _loop_task = None
