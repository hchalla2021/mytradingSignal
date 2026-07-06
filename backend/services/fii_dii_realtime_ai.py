"""Realtime institutional flow inference engine.

This service runs a low-latency incremental pipeline on live market ticks and
returns a websocket-safe payload for the FII/DII dashboard.

Inference stack:
- NumPy (always on): feature extraction + fallback scoring.
- LightGBM (optional): non-linear flow-probability calibration.
- PyTorch LSTM (optional): short-horizon sequence momentum.
- TensorFlow (optional): class softmax path (falls back to NumPy).

All optional dependencies degrade gracefully.
"""

from __future__ import annotations

import math
import threading
import time
from collections import deque
from typing import Any, Deque, Dict, Optional

import numpy as np

try:
    import lightgbm as lgb  # type: ignore
    _HAS_LGB = True
except Exception:  # pragma: no cover
    lgb = None  # type: ignore
    _HAS_LGB = False

try:
    import torch  # type: ignore
    import torch.nn as nn  # type: ignore
    _HAS_TORCH = True
except Exception:  # pragma: no cover
    torch = None  # type: ignore
    nn = None  # type: ignore
    _HAS_TORCH = False

try:
    import tensorflow as tf  # type: ignore
    _HAS_TF = True
except Exception:  # pragma: no cover
    tf = None  # type: ignore
    _HAS_TF = False

_SYMBOLS = ("NIFTY", "BANKNIFTY", "SENSEX")
_LSTM_SEQ = 24

# ── Big Player Radar thresholds ───────────────────────────────────────
# A single-tick futures print is flagged as a "big player" (non-retail scale)
# when its notional clears BOTH the absolute floor and the statistical gate
# (mean + Zσ of the rolling per-tick notional baseline). Retail flow almost
# never prints ≥10 Cr in one tick on index futures.
_BLOCK_MIN_CR = {"NIFTY": 12.0, "BANKNIFTY": 8.0, "SENSEX": 6.0}
_BLOCK_Z = 2.5            # BLOCK gate (z-score over rolling baseline)
_MEGA_Z = 5.0             # MEGA prints — very likely institutional program flow
_BASELINE_MIN_TICKS = 20  # need this many notional samples before flagging
_EVENTS_MAX = 40          # rolling feed size
_MAX_SAMPLE_GAP_SEC = 8.0 # volume deltas across longer gaps are multi-trade
                          # aggregates, not single prints — baseline-only


def _clip(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def _softmax_np(logits: np.ndarray) -> np.ndarray:
    shifted = logits - float(np.max(logits))
    exp_v = np.exp(shifted)
    den = float(np.sum(exp_v))
    if den <= 0:
        return np.array([1.0 / len(logits)] * len(logits), dtype=float)
    return exp_v / den


def _build_lgb_model() -> Optional[Any]:
    if not _HAS_LGB:
        return None
    try:
        rng = np.random.default_rng(seed=20260528)
        n = 3072
        mom = rng.normal(0.0, 1.0, size=n)
        vol = rng.uniform(0.0, 1.0, size=n)
        oi = rng.normal(0.0, 1.0, size=n)
        accel = rng.normal(0.0, 1.0, size=n)
        spread = rng.uniform(0.0, 1.0, size=n)
        x = np.stack([mom, vol, oi, accel, spread], axis=1)
        latent = 0.45 * mom + 0.25 * oi + 0.20 * accel - 0.15 * vol + rng.normal(0.0, 0.25, size=n)
        y = (latent > 0).astype(int)
        return lgb.train(
            {
                "objective": "binary",
                "metric": "binary_logloss",
                "learning_rate": 0.08,
                "num_leaves": 15,
                "min_data_in_leaf": 24,
                "verbosity": -1,
            },
            lgb.Dataset(x, label=y),
            num_boost_round=70,
        )
    except Exception:  # pragma: no cover
        return None


def _build_lstm_model() -> Optional[Any]:
    if not _HAS_TORCH:
        return None
    try:
        torch.manual_seed(20260528)

        class TinyLSTM(nn.Module):  # type: ignore[misc]
            def __init__(self) -> None:
                super().__init__()
                self.lstm = nn.LSTM(input_size=1, hidden_size=10, num_layers=1, batch_first=True)
                self.head = nn.Linear(10, 1)

            def forward(self, x):  # type: ignore[override]
                out, _ = self.lstm(x)
                return self.head(out[:, -1, :]).squeeze(-1)

        net = TinyLSTM()
        opt = torch.optim.Adam(net.parameters(), lr=5e-3)
        loss_fn = nn.MSELoss()

        rng = np.random.default_rng(seed=20260528)
        n = 192
        l = _LSTM_SEQ + 1
        seqs = np.zeros((n, l), dtype=np.float32)
        for i in range(n):
            phi = rng.uniform(-0.2, 0.8)
            sigma = rng.uniform(0.0007, 0.0022)
            prev = 0.0
            for t in range(l):
                prev = phi * prev + rng.normal(0.0, sigma)
                seqs[i, t] = prev

        x = torch.from_numpy(seqs[:, :-1]).unsqueeze(-1)
        y = torch.from_numpy(seqs[:, -1])

        net.train()
        for _ in range(36):
            opt.zero_grad()
            pred = net(x)
            loss = loss_fn(pred, y)
            loss.backward()
            opt.step()
        net.eval()
        return net
    except Exception:  # pragma: no cover
        return None


_LGB_MODEL = _build_lgb_model()
_LSTM_MODEL = _build_lstm_model()


class FIIDIIRealtimeAIEngine:
    """Incremental inference engine for institutional flow."""

    def __init__(self) -> None:
        self._price_hist: Dict[str, Deque[float]] = {s: deque(maxlen=96) for s in _SYMBOLS}
        self._ret_hist: Dict[str, Deque[float]] = {s: deque(maxlen=96) for s in _SYMBOLS}
        self._vol_hist: Dict[str, Deque[float]] = {s: deque(maxlen=96) for s in _SYMBOLS}
        self._oi_hist: Dict[str, Deque[float]] = {s: deque(maxlen=96) for s in _SYMBOLS}
        self._tick_no: Dict[str, int] = {s: 0 for s in _SYMBOLS}
        self._last_symbol: Dict[str, Dict[str, Any]] = {}
        # ── Big Player Radar state ─────────────────────────────────────
        self._bp_last_cum_vol: Dict[str, float] = {s: -1.0 for s in _SYMBOLS}
        self._bp_last_oi: Dict[str, float] = {s: 0.0 for s in _SYMBOLS}
        self._bp_last_sample_ts: Dict[str, float] = {s: 0.0 for s in _SYMBOLS}
        self._bp_notional_hist: Dict[str, Deque[float]] = {s: deque(maxlen=180) for s in _SYMBOLS}
        self._bp_events: Deque[Dict[str, Any]] = deque(maxlen=_EVENTS_MAX)
        self._bp_session: Dict[str, Dict[str, float]] = {
            s: {"buyCr": 0.0, "sellCr": 0.0} for s in _SYMBOLS
        }
        self._bp_session_date: str = time.strftime("%Y-%m-%d")
        # True once the KiteTicker futures feed drives the radar directly —
        # the slower snapshot path must then stop consuming the same counter.
        self._bp_direct_feed: Dict[str, bool] = {s: False for s in _SYMBOLS}
        # Futures contract price path (tick rule for aggressor side).
        self._bp_price_hist: Dict[str, Deque[float]] = {s: deque(maxlen=8) for s in _SYMBOLS}
        self._last_snapshot: Dict[str, Any] = {
            "generatedAt": "",
            "aggregate": {},
            "indices": {},
            "models": {
                "numpy": True,
                "lightgbm": _LGB_MODEL is not None,
                "pytorch": _LSTM_MODEL is not None,
                "tensorflow": _HAS_TF,
            },
        }
        self._lock = threading.Lock()

    def _lgb_prob(self, feat: np.ndarray) -> float:
        if _LGB_MODEL is None:
            return 0.5
        try:
            return float(_LGB_MODEL.predict(feat.reshape(1, -1))[0])
        except Exception:  # pragma: no cover
            return 0.5

    def _lstm_return(self, rets: np.ndarray) -> float:
        if _LSTM_MODEL is None or rets.size < _LSTM_SEQ:
            return 0.0
        try:
            tail = rets[-_LSTM_SEQ:].astype(np.float32)
            x = torch.from_numpy(tail).view(1, _LSTM_SEQ, 1)  # type: ignore[union-attr]
            with torch.no_grad():  # type: ignore[union-attr]
                out = _LSTM_MODEL(x)
            return float(out.item())
        except Exception:  # pragma: no cover
            return 0.0

    def _class_probs(self, logits: np.ndarray) -> np.ndarray:
        if not _HAS_TF:
            return _softmax_np(logits)
        try:
            tf_logits = tf.convert_to_tensor(logits.reshape(1, -1), dtype=tf.float32)
            probs = tf.nn.softmax(tf_logits).numpy()[0]
            return np.asarray(probs, dtype=float)
        except Exception:  # pragma: no cover
            return _softmax_np(logits)

    def _infer_symbol(self, symbol: str) -> Dict[str, Any]:
        prices = np.asarray(self._price_hist[symbol], dtype=float)
        rets = np.asarray(self._ret_hist[symbol], dtype=float)
        vols = np.asarray(self._vol_hist[symbol], dtype=float)
        ois = np.asarray(self._oi_hist[symbol], dtype=float)

        if prices.size < 3:
            return {
                "symbol": symbol,
                "fiiScore": 0,
                "diiScore": 0,
                "aggregateScore": 0,
                "confidence": 8,
                "inflowCr": 0.0,
                "outflowCr": 0.0,
                "netCr": 0.0,
                "grossCr": 0.0,
                "fiiSide": "NEUTRAL",
                "diiSide": "NEUTRAL",
                "signal": "BALANCED",
                "modelBlend": {"numpy": 1.0, "lightgbm": 0.0, "lstm": 0.0, "tensorflow": 0.0},
            }

        ret_mean = float(np.mean(rets[-12:])) if rets.size else 0.0
        ret_std = float(np.std(rets[-24:])) if rets.size > 1 else 0.0
        vol_mean = float(np.mean(vols[-12:])) if vols.size else 0.0
        oi_delta = float(ois[-1] - ois[-2]) if ois.size >= 2 else 0.0
        oi_base = float(max(abs(ois[-1]), 1.0)) if ois.size else 1.0
        oi_mom = oi_delta / oi_base
        accel = float(ret_mean - np.mean(rets[-24:-12])) if rets.size >= 24 else ret_mean
        spread = float(_clip(ret_std * 1200.0, 0.0, 1.0))

        feat = np.array([
            _clip(ret_mean * 550.0, -2.0, 2.0),
            _clip(ret_std * 1200.0, 0.0, 2.5),
            _clip(oi_mom * 600.0, -2.0, 2.0),
            _clip(accel * 650.0, -2.0, 2.0),
            spread,
        ], dtype=float)

        lgb_prob = self._lgb_prob(feat)
        lgb_score = _clip((lgb_prob - 0.5) * 200.0, -100.0, 100.0)

        lstm_ret = self._lstm_return(rets)
        lstm_score = _clip(lstm_ret * 120000.0, -100.0, 100.0)

        numpy_score = _clip(
            60.0 * feat[0] + 20.0 * feat[2] + 20.0 * feat[3] - 14.0 * feat[1],
            -100.0,
            100.0,
        )

        logits = np.array([
            numpy_score + 0.5 * lgb_score,
            -abs(numpy_score) * 0.6,
            -numpy_score - 0.5 * lgb_score,
        ], dtype=float)
        probs = self._class_probs(logits)

        blend_numpy = 0.56
        blend_lgb = 0.28 if _LGB_MODEL is not None else 0.0
        blend_lstm = 0.16 if _LSTM_MODEL is not None else 0.0
        total_blend = blend_numpy + blend_lgb + blend_lstm
        if total_blend <= 0:
            total_blend = 1.0
        blend_numpy /= total_blend
        blend_lgb /= total_blend
        blend_lstm /= total_blend

        aggregate_score = _clip(
            blend_numpy * numpy_score + blend_lgb * lgb_score + blend_lstm * lstm_score,
            -100.0,
            100.0,
        )

        fii_score = _clip(0.72 * aggregate_score + 18.0 * feat[2], -100.0, 100.0)
        dii_score = _clip(0.68 * aggregate_score * -0.35 + 60.0 * (probs[0] - probs[2]), -100.0, 100.0)

        gross_proxy = max(90.0, abs(vol_mean) * 0.0012 + abs(ois[-1] if ois.size else 0.0) * 0.00035)
        net_cr = gross_proxy * _clip(aggregate_score / 100.0, -0.85, 0.85)
        inflow = max(0.0, (gross_proxy + net_cr) * 0.5)
        outflow = max(0.0, gross_proxy - inflow)

        conf = int(round(_clip(30.0 + abs(aggregate_score) * 0.45 + (1.0 - spread) * 20.0, 12.0, 96.0)))

        return {
            "symbol": symbol,
            "fiiScore": int(round(fii_score)),
            "diiScore": int(round(dii_score)),
            "aggregateScore": int(round(aggregate_score)),
            "confidence": conf,
            "inflowCr": round(inflow, 2),
            "outflowCr": round(outflow, 2),
            "netCr": round(inflow - outflow, 2),
            "grossCr": round(inflow + outflow, 2),
            "fiiSide": "BUY" if fii_score > 10 else "SELL" if fii_score < -10 else "NEUTRAL",
            "diiSide": "BUY" if dii_score > 10 else "SELL" if dii_score < -10 else "NEUTRAL",
            "signal": "BUY_PRESSURE" if aggregate_score > 12 else "SELL_PRESSURE" if aggregate_score < -12 else "BALANCED",
            "modelBlend": {
                "numpy": round(blend_numpy, 2),
                "lightgbm": round(blend_lgb, 2),
                "lstm": round(blend_lstm, 2),
                "tensorflow": 1.0 if _HAS_TF else 0.0,
            },
        }

    def _detect_big_print(
        self, symbol: str, price: float, cum_volume: float, oi: float
    ) -> None:
        """Flag single-tick prints too large to be retail (live block detector).

        Uses cumulative futures volume deltas: Δvol × price = notional traded
        in this tick. Big players (FII/DII/prop/HNI desks) leave ≥10 Cr
        single-tick footprints; retail order flow almost never does. Side is
        read from tick price direction, refined by OI delta:
          price↑ + OI↑ = aggressive long entry, price↓ + OI↑ = short entry,
          price↓ + OI↓ = long exit,          price↑ + OI↓ = short covering.
        """
        # Session day rollover → reset cumulative counters.
        today = time.strftime("%Y-%m-%d")
        if today != self._bp_session_date:
            self._bp_session_date = today
            for s in _SYMBOLS:
                self._bp_session[s] = {"buyCr": 0.0, "sellCr": 0.0}
            self._bp_events.clear()

        last_cum = self._bp_last_cum_vol[symbol]
        self._bp_last_cum_vol[symbol] = cum_volume
        now_mono = time.monotonic()
        gap = now_mono - self._bp_last_sample_ts[symbol] if self._bp_last_sample_ts[symbol] > 0 else 1e9
        self._bp_last_sample_ts[symbol] = now_mono
        if last_cum < 0 or cum_volume <= 0 or price <= 0:
            self._bp_last_oi[symbol] = oi
            return
        dvol = cum_volume - last_cum
        if dvol <= 0:  # feed replay / day reset / no fresh trades
            self._bp_last_oi[symbol] = oi
            return

        notional_cr = (dvol * price) / 1e7  # ₹ Cr traded in this tick
        hist = self._bp_notional_hist[symbol]
        baseline = np.asarray(hist, dtype=float) if hist else np.array([], dtype=float)
        # A delta spanning a long sampling gap aggregates many trades — it can
        # NOT be attributed to one big player. Feed the baseline, never flag.
        flaggable = gap <= _MAX_SAMPLE_GAP_SEC
        hist.append(notional_cr)

        d_oi = oi - self._bp_last_oi[symbol] if self._bp_last_oi[symbol] > 0 else 0.0
        self._bp_last_oi[symbol] = oi

        if baseline.size < _BASELINE_MIN_TICKS or not flaggable:
            return
        mean = float(np.mean(baseline))
        std = float(np.std(baseline))
        if std <= 0:
            std = max(0.5, mean * 0.5)
        z = (notional_cr - mean) / std
        floor_cr = _BLOCK_MIN_CR.get(symbol, 10.0)
        if z < _BLOCK_Z or notional_cr < floor_cr:
            return

        # Aggressor side from tick direction; OI refines the read.
        # Prefer the futures contract's own price path (direct KiteTicker
        # feed); fall back to spot returns when running off snapshot polling.
        fut_prices = self._bp_price_hist[symbol]
        if len(fut_prices) >= 2:
            last_ret = fut_prices[-1] - fut_prices[-2]
            if abs(last_ret) < 1e-9:
                last_ret = fut_prices[-1] - fut_prices[0]
        else:
            rets = self._ret_hist[symbol]
            last_ret = rets[-1] if rets else 0.0
            if abs(last_ret) < 1e-9 and len(rets) >= 3:
                last_ret = sum(list(rets)[-3:])
        side = "BUY" if last_ret > 0 else ("SELL" if last_ret < 0 else ("BUY" if d_oi > 0 else "SELL"))

        if side == "BUY":
            read = "Fresh long entry" if d_oi > 0 else ("Short covering" if d_oi < 0 else "Aggressive buying")
        else:
            read = "Fresh short entry" if d_oi > 0 else ("Long unwinding" if d_oi < 0 else "Aggressive selling")

        kind = "MEGA" if z >= _MEGA_Z else "BLOCK"
        confidence = int(round(_clip(40.0 + z * 12.0, 40.0, 96.0)))

        self._bp_session[symbol]["buyCr" if side == "BUY" else "sellCr"] += notional_cr
        self._bp_events.appendleft({
            "ts": time.strftime("%H:%M:%S"),
            "symbol": symbol,
            "side": side,
            "notionalCr": round(notional_cr, 2),
            "price": round(price, 2),
            "zScore": round(z, 1),
            "kind": kind,
            "oiDelta": round(d_oi, 0),
            "read": read,
            "confidence": confidence,
        })

    def ingest_futures_tick(
        self, symbol: str, price: float, cum_volume: float, oi: float
    ) -> None:
        """Feed a real single-tick futures print into the Big Player Radar.

        Called from the KiteTicker thread with the current-month futures
        contract's cumulative volume — true per-tick deltas, which is the
        signal `_detect_big_print` was designed for. Index spot ticks carry
        no volume, so without this feed the radar never arms. Marks the
        symbol as direct-fed so the snapshot path won't consume the same
        volume counter twice.
        """
        if symbol not in _SYMBOLS:
            return
        with self._lock:
            self._bp_direct_feed[symbol] = True
            if price > 0:
                self._bp_price_hist[symbol].append(price)
            try:
                self._detect_big_print(symbol, price, cum_volume, oi)
            except Exception:  # noqa: BLE001 - radar must never break the feed
                pass

    def _big_players_payload(self) -> Dict[str, Any]:
        per_symbol: Dict[str, Any] = {}
        total_buy = total_sell = 0.0
        for s in _SYMBOLS:
            b = self._bp_session[s]["buyCr"]
            sl = self._bp_session[s]["sellCr"]
            total_buy += b
            total_sell += sl
            per_symbol[s] = {
                "buyCr": round(b, 2),
                "sellCr": round(sl, 2),
                "netCr": round(b - sl, 2),
            }
        events = list(self._bp_events)[:12]
        return {
            "sessionDate": self._bp_session_date,
            "sessionBuyCr": round(total_buy, 2),
            "sessionSellCr": round(total_sell, 2),
            "sessionNetCr": round(total_buy - total_sell, 2),
            "eventsToday": len(self._bp_events),
            "perSymbol": per_symbol,
            "events": events,
            "note": (
                "Live large-lot detector on index futures prints — single-tick notional "
                f"≥ z{_BLOCK_Z}σ over rolling baseline AND above per-symbol ₹ Cr floor. "
                "Institutional/HNI-scale footprints; official FII/DII attribution only at EOD."
            ),
        }

    def update_tick(self, symbol: str, tick: Dict[str, Any]) -> Dict[str, Any]:
        if symbol not in _SYMBOLS:
            return self.get_snapshot()

        with self._lock:
            price = max(0.0, _safe_float(tick.get("price"), 0.0))
            volume = max(0.0, _safe_float(tick.get("volume"), 0.0))
            oi = max(0.0, _safe_float(tick.get("oi"), 0.0))

            ph = self._price_hist[symbol]
            rh = self._ret_hist[symbol]
            vh = self._vol_hist[symbol]
            oh = self._oi_hist[symbol]

            prev_price = ph[-1] if ph else price
            ph.append(price)
            if prev_price > 0:
                rh.append((price - prev_price) / prev_price)
            else:
                rh.append(0.0)
            vh.append(volume)
            oh.append(oi)

            # Live large-lot (big player) print detection on this tick.
            # Skipped when the KiteTicker futures feed drives the radar
            # directly — both paths read the same cumulative volume counter
            # and double-feeding would split/duplicate the deltas.
            if not self._bp_direct_feed.get(symbol):
                try:
                    self._detect_big_print(symbol, price, volume, oi)
                except Exception:  # noqa: BLE001 - radar must never break scoring
                    pass

            self._tick_no[symbol] += 1
            recompute = self._tick_no[symbol] % 2 == 0 or symbol not in self._last_symbol
            if recompute:
                self._last_symbol[symbol] = self._infer_symbol(symbol)

            indices: Dict[str, Any] = {}
            for s in _SYMBOLS:
                if s in self._last_symbol:
                    indices[s] = self._last_symbol[s]

            if not indices:
                return self._last_snapshot

            agg_scores = [float(v.get("aggregateScore", 0.0)) for v in indices.values()]
            fii_scores = [float(v.get("fiiScore", 0.0)) for v in indices.values()]
            dii_scores = [float(v.get("diiScore", 0.0)) for v in indices.values()]
            confs = [float(v.get("confidence", 0.0)) for v in indices.values()]
            total_in = float(sum(float(v.get("inflowCr", 0.0)) for v in indices.values()))
            total_out = float(sum(float(v.get("outflowCr", 0.0)) for v in indices.values()))

            aggregate_score = int(round(float(np.mean(agg_scores)))) if agg_scores else 0
            aggregate_conf = int(round(float(np.mean(confs)))) if confs else 0

            payload = {
                "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                "aggregate": {
                    "fiiScore": int(round(float(np.mean(fii_scores)))) if fii_scores else 0,
                    "diiScore": int(round(float(np.mean(dii_scores)))) if dii_scores else 0,
                    "aggregateScore": aggregate_score,
                    "confidence": aggregate_conf,
                    "signal": "BUY_PRESSURE" if aggregate_score > 12 else "SELL_PRESSURE" if aggregate_score < -12 else "BALANCED",
                    "inflowCr": round(total_in, 2),
                    "outflowCr": round(total_out, 2),
                    "netCr": round(total_in - total_out, 2),
                    "grossCr": round(total_in + total_out, 2),
                    "note": "Realtime blend: NumPy + LightGBM + LSTM (+ TensorFlow softmax when installed).",
                },
                "indices": indices,
                "bigPlayers": self._big_players_payload(),
                "models": {
                    "numpy": True,
                    "lightgbm": _LGB_MODEL is not None,
                    "pytorch": _LSTM_MODEL is not None,
                    "tensorflow": _HAS_TF,
                },
            }
            self._last_snapshot = payload
            return payload

    def get_snapshot(self) -> Dict[str, Any]:
        with self._lock:
            snap = dict(self._last_snapshot)
            # Always ship radar state, even before the first full recompute.
            snap["bigPlayers"] = self._big_players_payload()
            return snap


fii_dii_realtime_ai_engine = FIIDIIRealtimeAIEngine()
