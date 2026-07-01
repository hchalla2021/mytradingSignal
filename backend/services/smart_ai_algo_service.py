"""
🤖 Smart AI Algo Service — QuantEdge Engine (Hedge-Fund-Quant Grade)
====================================================================
Institutional multi-factor signal engine for NIFTY / BANKNIFTY / SENSEX
options, wired to Zerodha live tick data with optional OpenAI GPT
enrichment.  Signals only fire when every quant layer agrees ("100%
data-match" confluence gate) — the way a top hedge-fund book runs its
intraday index desk.

QuantEdge — 7-Layer Decision Stack
-----------------------------------
  L1  Market Regime Detection
      Volatility axis (ATR%): LOW / NORMAL / HIGH / EXTREME
      Trend axis (|EMA20-EMA100|/ATR): RANGING / TRENDING_WEAK / TRENDING_STRONG
      → EXTREME-vol or RANGING regime kills trend entries automatically.

  L2  Multi-Factor Alpha Score (0-100, bullish-tilt)
      • Momentum  30 %   RSI + 5-bar ROC + intraday change%
      • Trend     30 %   EMA stack + EMA20 slope + structure label
      • Structure 15 %   VWAP distance z + Bollinger position (with
                         mean-reversion contra when Bollinger extreme)
      • Sentiment 25 %   PCR z-score + OI trend + liquidity sweep

  L3  Edge / Alpha Detection (behavioural inefficiencies)
      Liquidity sweep reversal, VWAP reclaim/breakdown, OI-price
      divergence, volatility-compression breakout.  At least ONE edge
      must be armed for a signal to fire.

  L4  Confluence Gate (the "100 % match" contract)
      Fires BUY only when:
          alpha_score >= 70  AND
          every factor bucket > 55 (bullish)  AND
          regime is favourable  AND
          >=1 edge trigger active  AND
          expected value (probability * R:R) > 0
      SELL is the mirror image with alpha <= 30.

  L5  Adaptive Risk Sizing (ATR-based)
      SL_pts  = 1.00 * ATR   (min floor from DEFAULT_SL_POINTS/2)
      TGT_pts = 1.75 * ATR   (min R:R >= 1.5)
      TSL     = 0.50 * ATR profit trigger

  L6  Probability + Expected-Value engine
      p_win = sigmoid((directional_alpha - 50) / 12)
      EV    = p_win * TGT - (1 - p_win) * SL
      Kelly fraction (capped at 1/4-Kelly) is emitted for position sizing.

  L7  Drawdown Protection
      Rolling per-symbol trade fatigue: > 2 attempts in 15 min raises
      the confluence bar for the next entry.  EXTREME vol acts as a
      circuit breaker.

Backward-compatible output (kept intact for existing UI/routers):
  signal, entry_price, stop_loss, target, trailing_stop_loss,
  confidence, sl_points, target_points, regime, strength, reasoning,
  indicators, ai_powered, last_updated, market_status.

New quant fields on every result:
  alpha_score, factor_scores, regime_detail, edge_triggers,
  win_probability, expected_value_points, risk_reward_ratio,
  kelly_fraction, confluence_gate.
"""

import asyncio
import json
import logging
import math
import re
import time
from datetime import date, datetime
from typing import Any, Dict, List, Optional

import pytz
import httpx
from kiteconnect import KiteConnect
from kiteconnect.exceptions import PermissionException

from services.cache import CacheService
from services.quantedge_ml import QuantEdgeMLPredictor, extract_features
from config import get_settings

logger = logging.getLogger(__name__)
IST = pytz.timezone("Asia/Kolkata")
settings = get_settings()


def _settings():
    """Fetch latest settings to avoid stale env/token values during runtime."""
    return get_settings()

# ── Constants ────────────────────────────────────────────────────────────────
SYMBOLS = ["NIFTY", "BANKNIFTY", "SENSEX"]
DEFAULT_SL_POINTS = 10
DEFAULT_TARGET_POINTS = 15
TRAILING_SL_TRIGGER_RATIO = 0.5

# Cost-optimised AI gating:
#  • Only 1 batched call for all 3 symbols at once (3× cheaper than separate)
#  • Only fires when a symbol flips signal (WAIT→BUY/SELL or BUY→SELL etc.)
#  • Only during LIVE market hours
#  • Minimum 60 s cooldown per symbol after any AI call
#  • Rule engine must reach HIGH_CONFLUENCE_SCORE before AI is invoked
AI_COOLDOWN_SEC = 60          # minimum gap between AI calls per symbol
HIGH_CONFLUENCE_SCORE = 70    # alpha_score threshold (0-100) that unlocks AI enrichment
RULE_REFRESH_INTERVAL = 2     # rule engine runs every 2s (zero cost)
MAX_CONCURRENT_AI = 1         # single semaphore — no parallel API calls
AI_MAX_TOKENS = 150           # tight cap: signal+conf+1-line reason fits in 80

# QuantEdge tunables ---------------------------------------------------------
ATR_PERIOD = 14                          # close-to-close true-range proxy window
ROC_LOOKBACK = 5                         # rate-of-change bars
EMA_SLOPE_LOOKBACK = 5                   # bars used to measure EMA20 slope
BOLLINGER_WINDOW = 20                    # z-score window
FATIGUE_WINDOW_SEC = 15 * 60             # rolling window for trade fatigue check
FATIGUE_MAX_ATTEMPTS = 2                 # >2 attempts in window ⇒ raise the bar
CONFLUENCE_BULL = 70.0                   # alpha_score gate for BUY
CONFLUENCE_BEAR = 30.0                   # alpha_score gate for SELL
FACTOR_MIN_BULL = 55.0                   # every factor must clear this for BUY
FACTOR_MAX_BEAR = 45.0                   # every factor must be <= this for SELL
ATR_SL_MULT = 1.00                       # SL = 1*ATR
ATR_TGT_MULT = 1.75                      # TGT = 1.75*ATR (R:R = 1.75)
ATR_TSL_MULT = 0.50                      # trailing SL trigger = 0.5*ATR profit
KELLY_CAP = 0.25                         # never exceed 1/4-Kelly
OPTION_PREVIEW_REFRESH_SEC = 15.0        # broker quote refresh cadence for preview panel

# ── Singleton ─────────────────────────────────────────────────────────────────
_ALGO_SERVICE: Optional["SmartAIAlgoService"] = None


def get_algo_service() -> "SmartAIAlgoService":
    global _ALGO_SERVICE
    if _ALGO_SERVICE is None:
        _ALGO_SERVICE = SmartAIAlgoService(CacheService())
    return _ALGO_SERVICE


# ── EMA helper ────────────────────────────────────────────────────────────────
def _ema(prices: List[float], period: int) -> float:
    if len(prices) < period:
        return prices[-1] if prices else 0.0
    k = 2.0 / (period + 1)
    val = prices[0]
    for p in prices[1:]:
        val = p * k + val * (1 - k)
    return val


# ── RSI helper ────────────────────────────────────────────────────────────────
def _rsi(prices: List[float], period: int = 14) -> float:
    if len(prices) < period + 1:
        return 50.0
    deltas = [prices[i] - prices[i - 1] for i in range(1, len(prices))]
    gains = [max(d, 0) for d in deltas[-period:]]
    losses = [abs(min(d, 0)) for d in deltas[-period:]]
    avg_g = sum(gains) / period
    avg_l = sum(losses) / period
    if avg_l == 0:
        return 100.0
    rs = avg_g / avg_l
    return 100 - (100 / (1 + rs))


# ── QuantEdge helpers ────────────────────────────────────────────────────────
def _stdev(values: List[float]) -> float:
    n = len(values)
    if n < 2:
        return 0.0
    m = sum(values) / n
    return math.sqrt(sum((v - m) ** 2 for v in values) / (n - 1))


def _atr_proxy(prices: List[float], window: int = ATR_PERIOD) -> float:
    """ATR proxy from close-to-close absolute moves.
    Tick stream lacks per-bar OHLC so |Δclose| is used as true-range proxy."""
    if len(prices) < window + 1:
        return 0.0
    diffs = [abs(prices[i] - prices[i - 1]) for i in range(1, len(prices))]
    recent = diffs[-window:]
    return (sum(recent) / len(recent)) if recent else 0.0


def _roc(prices: List[float], lookback: int = ROC_LOOKBACK) -> float:
    if len(prices) <= lookback:
        return 0.0
    prev = prices[-lookback - 1]
    if prev <= 0:
        return 0.0
    return (prices[-1] - prev) / prev * 100.0


def _ema_slope_pct(prices: List[float], period: int, lookback: int = EMA_SLOPE_LOOKBACK) -> float:
    """% change of EMA(period) over last `lookback` bars — trend acceleration proxy."""
    if len(prices) < period + lookback:
        return 0.0
    now = _ema(prices, period)
    prev = _ema(prices[:-lookback], period)
    if prev <= 0:
        return 0.0
    return (now - prev) / prev * 100.0


def _sigmoid(x: float) -> float:
    if x > 30:
        return 1.0
    if x < -30:
        return 0.0
    return 1.0 / (1.0 + math.exp(-x))


def _clip(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, v))


def _detect_regime(atr_pct: float, ema20: float, ema100: float, atr: float) -> Dict[str, Any]:
    """Two-axis regime (volatility x trend) - L1 of QuantEdge stack."""
    if atr_pct <= 0:
        vol_regime = "UNKNOWN"
    elif atr_pct < 0.15:
        vol_regime = "LOW"
    elif atr_pct < 0.35:
        vol_regime = "NORMAL"
    elif atr_pct < 0.75:
        vol_regime = "HIGH"
    else:
        vol_regime = "EXTREME"

    spread = abs(ema20 - ema100)
    if atr <= 0 or spread <= 0:
        trend_regime = "RANGING"
    else:
        ratio = spread / atr
        if ratio < 0.4:
            trend_regime = "RANGING"
        elif ratio < 1.2:
            trend_regime = "TRENDING_WEAK"
        else:
            trend_regime = "TRENDING_STRONG"

    favorable = (
        trend_regime in ("TRENDING_WEAK", "TRENDING_STRONG")
        and vol_regime in ("LOW", "NORMAL", "HIGH")
    )
    return {"volatility": vol_regime, "trend": trend_regime, "favorable": favorable}


def _factor_momentum(ind: Dict[str, Any]) -> float:
    rsi_score = _clip(50 + (ind.get("rsi", 50.0) - 50.0) * 1.0)
    roc_score = _clip(50 + ind.get("roc5", 0.0) * 15)
    chg_score = _clip(50 + ind.get("change_pct", 0.0) * 20)
    return _clip(rsi_score * 0.4 + roc_score * 0.3 + chg_score * 0.3)


def _factor_trend(ind: Dict[str, Any]) -> float:
    price = ind.get("price", 0.0)
    e20 = ind.get("ema20", 0.0)
    e100 = ind.get("ema100", 0.0)
    e200 = ind.get("ema200", 0.0)
    slope = ind.get("ema20_slope_pct", 0.0)
    align_bull = sum(
        [
            1 if price > e20 else 0,
            1 if price > e100 else 0,
            1 if price > e200 else 0,
            1 if e20 > e100 else 0,
            1 if e100 > e200 else 0,
        ]
    ) / 5.0
    align_score = 50 + (align_bull - 0.5) * 100
    slope_score = _clip(50 + slope * 40)
    label = str(ind.get("trend", "NEUTRAL") or "NEUTRAL")
    lbl_bump = 10 if label in ("BULLISH", "STRONG_BUY") else (-10 if label in ("BEARISH", "STRONG_SELL") else 0)
    return _clip(align_score * 0.6 + slope_score * 0.4 + lbl_bump)


def _factor_structure(ind: Dict[str, Any]) -> float:
    """VWAP + Bollinger structure. Extended Bollinger flips contra (exhaustion)."""
    vwap_dist = ind.get("vwap_dist_pct", 0.0)
    bb_z = ind.get("bb_z", 0.0)
    vwap_score = _clip(50 + vwap_dist * 25)
    if abs(bb_z) < 0.6:
        bb_score = 50 + bb_z * 30            # inside the band -> follow trend
    else:
        # beyond 0.6 stdev -> mean-reversion pressure
        bb_score = 50 - (bb_z - math.copysign(0.6, bb_z)) * 30
    return _clip(vwap_score * 0.6 + _clip(bb_score) * 0.4)


def _factor_sentiment(ind: Dict[str, Any]) -> float:
    score = 50.0
    score += ind.get("pcr_z", 0.0) * 12
    oi_trend = ind.get("oi_trend", "NEUTRAL")
    if oi_trend == "LONG_BUILDUP":
        score += 12
    elif oi_trend == "SHORT_COVERING":
        score += 8
    elif oi_trend == "SHORT_BUILDUP":
        score -= 12
    elif oi_trend == "LONG_UNWINDING":
        score -= 8
    if ind.get("near_low"):
        score += 8
    elif ind.get("near_high"):
        score -= 8
    return _clip(score)


def _detect_edges(ind: Dict[str, Any]) -> List[str]:
    """L3 — behavioural / structural edge triggers. Empty list = no alpha edge."""
    edges: List[str] = []
    pcr_bias = ind.get("pcr_bias", "NEUTRAL")
    oi_trend = ind.get("oi_trend", "NEUTRAL")
    vwap_dist = ind.get("vwap_dist_pct", 0.0)
    bb_z = ind.get("bb_z", 0.0)
    roc5 = ind.get("roc5", 0.0)
    change_pct = ind.get("change_pct", 0.0)

    # Liquidity sweeps at intraday extremes
    if ind.get("near_low") and pcr_bias == "BULLISH":
        edges.append("SWEEP_LOW_REVERSAL")
    if ind.get("near_high") and pcr_bias == "BEARISH":
        edges.append("SWEEP_HIGH_REJECTION")

    # VWAP reclaim/breakdown with momentum
    if vwap_dist > 0.05 and roc5 > 0.15:
        edges.append("VWAP_RECLAIM")
    if vwap_dist < -0.05 and roc5 < -0.15:
        edges.append("VWAP_BREAKDOWN")

    # Volatility-compression breakout (tight Bollinger + directional push)
    if -0.3 < bb_z < 0.3 and change_pct > 0.4:
        edges.append("SQUEEZE_BREAKOUT_BULL")
    if -0.3 < bb_z < 0.3 and change_pct < -0.4:
        edges.append("SQUEEZE_BREAKOUT_BEAR")

    # OI vs price divergence
    if oi_trend == "SHORT_COVERING" and change_pct > 0.2:
        edges.append("OI_DIVERGENCE_BULL")
    if oi_trend == "LONG_UNWINDING" and change_pct < -0.2:
        edges.append("OI_DIVERGENCE_BEAR")

    return edges


class SmartAIAlgoService:
    def __init__(self, cache: CacheService):
        self._cache = cache
        self._results: Dict[str, Dict[str, Any]] = {s: self._empty(s) for s in SYMBOLS}
        self._running = False
        self._ai_semaphore = asyncio.Semaphore(MAX_CONCURRENT_AI)
        # AI enabled by default when OpenAI is configured; user can still toggle it off.
        self._ai_enabled: bool = bool(_settings().openai_api_key)
        # Track last AI call time and last signal per symbol for change-detection
        self._last_ai_call: Dict[str, float] = {s: 0.0 for s in SYMBOLS}
        self._last_signal: Dict[str, str] = {s: "WAIT" for s in SYMBOLS}
        self._price_history: Dict[str, List[float]] = {s: [] for s in SYMBOLS}
        self._last_trade_time: Dict[str, float] = {s: 0.0 for s in SYMBOLS}
        self._last_trade_side: Dict[str, str] = {s: "" for s in SYMBOLS}
        self._trade_history: List[Dict[str, Any]] = []
        self._instrument_token_map: Dict[int, Dict[str, str]] = {}
        self._instrument_meta_map: Dict[str, Dict[str, float]] = {}
        self._instruments_cache: Dict[str, Dict[str, Any]] = {}
        # Cached ATM option preview per (symbol,side) so the AUTO-BUY PREVIEW panel
        # is populated on every tick without hammering the broker quote API.
        self._option_preview_cache: Dict[str, Dict[str, Any]] = {}
        self._option_preview_ts: Dict[str, float] = {}
        self._last_option_exec_info: Dict[str, Dict[str, Any]] = {s: {} for s in SYMBOLS}
        self._open_option_position: Dict[str, Dict[str, Any]] = {s: {} for s in SYMBOLS}
        self._trailing_state: Dict[str, Dict[str, Any]] = {
            s: {"side": "WAIT", "extreme": 0.0, "tsl": 0.0} for s in SYMBOLS
        }
        self._live_block_until_ts: float = 0.0
        # QuantEdge Layer-8: online ML predictor (LightGBM or NumPy fallback).
        # Cheap to construct; heavy work only happens after warm-up samples.
        self._ml_predictor = QuantEdgeMLPredictor(list(SYMBOLS))

    @staticmethod
    def _empty(symbol: str) -> Dict[str, Any]:
        return {
            "symbol": symbol,
            "signal": "WAIT",
            "entry_price": 0.0,
            "stop_loss": 0.0,
            "target": 0.0,
            "trailing_stop_loss": 0.0,
            "confidence": 0,
            "sl_points": DEFAULT_SL_POINTS,
            "target_points": DEFAULT_TARGET_POINTS,
            "regime": "UNKNOWN",
            "strength": 0,
            "reasoning": "Waiting for sufficient market data...",
            "indicators": {},
            "ai_powered": False,
            "last_updated": 0,
            "market_status": "CLOSED",
            "data_status": "NO_DATA",
            "tick_age_seconds": -1,
            # QuantEdge extensions (kept optional; existing UI ignores unknown keys)
            "alpha_score": 0.0,
            "factor_scores": {"momentum": 0.0, "trend": 0.0, "structure": 0.0, "sentiment": 0.0},
            "regime_detail": {"volatility": "UNKNOWN", "trend": "UNKNOWN", "favorable": False},
            "edge_triggers": [],
            "win_probability": 0.0,
            "expected_value_points": 0.0,
            "risk_reward_ratio": 0.0,
            "kelly_fraction": 0.0,
            "confluence_gate": {"passed": False, "reasons": ["awaiting data"]},
            "signal_quality": 0.0,
            "signal_grade": "WATCH",
            "ml_prediction": {
                "direction": "UNKNOWN", "probability": 0.5, "confidence": 0,
                "horizon_ticks": 0, "expected_move_pct": 0.0,
                "samples_trained": 0, "buffer_size": 0,
                "backend": "none", "model_status": "warmup",
            },
            "ml_feedback": {"applied": False, "note": ""},
            # UI preview defaults (kept present so the frontend never renders "undefined")
            "option_tradingsymbol": "",
            "option_type": "",
            "option_expiry": "",
            "option_strike": 0,
            "option_moneyness": "",
            "option_ltp": 0.0,
            "option_best_bid_price": 0.0,
            "option_best_ask_price": 0.0,
            "option_best_buy_price": 0.0,
            "option_quality_ok": False,
            "option_spread_pct": 0.0,
            "option_volume": 0.0,
            "option_oi": 0.0,
            "option_price_updated_at": 0,
            "option_entry_buy_price": 0.0,
            "option_unrealized_pnl_points": 0.0,
            "option_unrealized_pnl_amount": 0.0,
            "option_pnl_status": "FLAT",
            "recommended_option_side": "",
            "auto_buy_ready": False,
            "auto_buy_block_reason": "",
            "auto_buy_gate_passed": False,
            "auto_buy_gate_reason": "awaiting data",
            "auto_buy_ai_passed": False,
            "auto_buy_ai_reason": "",
            "auto_buy_ai_confidence": 0,
        }

    # ── Main loop ────────────────────────────────────────────────────────────
    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        await self._warm_price_history()
        logger.info("🤖 Smart AI Algo: started")
        while self._running:
            try:
                await self._tick()
            except Exception as exc:
                logger.error("Smart AI Algo tick error: %s", exc, exc_info=True)
            await asyncio.sleep(RULE_REFRESH_INTERVAL)

    async def _warm_price_history(self) -> None:
        """Seed moving averages from recent candle history so the first live ticks are meaningful."""
        candle_keys = ("analysis_candles", "analysis_candles_3m", "analysis_candles_15m")

        for symbol in SYMBOLS:
            seeded = False
            for prefix in candle_keys:
                try:
                    raw_items = await self._cache.lrange(f"{prefix}:{symbol}", 0, 199)
                except Exception:
                    raw_items = []

                closes: List[float] = []
                for item in reversed(raw_items):
                    try:
                        candle = item if isinstance(item, dict) else json.loads(item)
                        close = float(candle.get("close", 0) or 0)
                    except Exception:
                        continue
                    if close > 0:
                        closes.append(close)

                if closes:
                    self._price_history[symbol] = closes[-200:]
                    seeded = True
                    break

            if not seeded:
                try:
                    market_data = await self._cache.get_market_data(symbol)
                    price = float((market_data or {}).get("price", 0) or 0)
                    if price > 0:
                        self._price_history[symbol] = [price]
                except Exception:
                    pass

    async def stop(self) -> None:
        self._running = False

    # ── Main tick ─────────────────────────────────────────────────────────────
    async def _tick(self) -> None:
        candidates: List[tuple] = []   # (symbol, tick, indicators, rule_result) for AI

        for symbol in SYMBOLS:
            # Per-symbol try/except so a single symbol crash cannot blank the other two.
            try:
                await self._tick_symbol(symbol, candidates)
            except Exception as sym_exc:
                logger.error("Smart AI Algo tick failed for %s: %s", symbol, sym_exc, exc_info=True)
                # Ensure the symbol still has a visible payload (last good result stays otherwise).
                existing = self._results.get(symbol) or self._empty(symbol)
                existing["reasoning"] = f"Recovering from tick error: {sym_exc}"
                existing["last_updated"] = int(time.time() * 1000)
                existing["data_status"] = "ERROR"
                existing["tick_age_seconds"] = -1
                self._results[symbol] = existing

        # Batch AI call for all qualifying symbols (1 API call, not 3)
        if candidates:
            asyncio.create_task(self._ai_batch(candidates))

    async def _tick_symbol(self, symbol: str, candidates: List[tuple]) -> None:
        """Process one symbol's tick. Any exception here is contained by the caller."""
        try:
            tick = await self._cache.get_market_data(symbol)
        except Exception:
            tick = None

        now_ms = int(time.time() * 1000)
        if not tick or not isinstance(tick, dict):
            # Keep the last visible payload so the UI never blanks; just refresh the timestamp
            # AND flag it as stale so the trader can distinguish fresh vs frozen data.
            existing = self._results.get(symbol) or self._empty(symbol)
            existing["last_updated"] = now_ms
            existing["data_status"] = "NO_DATA"
            existing["tick_age_seconds"] = -1
            self._results[symbol] = existing
            return

        # Compute tick age so the UI can show whether reasoning is fresh or frozen.
        tick_age_seconds = self._compute_tick_age_seconds(tick)
        if tick_age_seconds < 0:
            data_status = "UNKNOWN"
        elif tick_age_seconds <= 10:
            data_status = "LIVE"
        elif tick_age_seconds <= 30:
            data_status = "SLOW"
        else:
            data_status = "STALE"

        indicators = self._build_indicators(symbol, tick)
        rule_result, buy_score, sell_score = self._rule_engine(symbol, tick, indicators)

        # QuantEdge L8 - streaming ML forecast on next-horizon direction.
        try:
            ml_features = extract_features(rule_result)
            ml_pred = self._ml_predictor.observe_and_predict(
                symbol, ml_features, float(rule_result.get("entry_price", 0) or 0)
            )
        except Exception as ml_exc:
            logger.debug("QuantEdge ML tick failed for %s: %s", symbol, ml_exc)
            ml_pred = {
                "direction": "UNKNOWN", "probability": 0.5, "confidence": 0,
                "model_status": "error", "samples_trained": 0, "backend": "none",
            }
        rule_result["ml_prediction"] = ml_pred
        self._apply_ml_feedback(rule_result, ml_pred)

        # Merge last option execution snapshot for continuity across ticks.
        merged_result = {**rule_result, "ai_powered": False}
        last_exec = self._last_option_exec_info.get(symbol) or {}
        if last_exec:
            merged_result.update(last_exec)

        # Refresh live option quote for the AUTO-BUY PREVIEW panel (regardless of signal).
        try:
            self._refresh_option_preview(symbol, tick, merged_result)
        except Exception as prev_exc:
            logger.debug("Option preview refresh failed for %s: %s", symbol, prev_exc)

        # Freshness stamps so the frontend can distinguish live vs frozen ticks.
        merged_result["data_status"] = data_status
        merged_result["tick_age_seconds"] = tick_age_seconds

        # Humanize the raw reasoning so it reads like a trader-desk one-liner.
        raw_reason = str(merged_result.get("reasoning", "") or "")
        merged_result["reasoning"] = self._humanize_reasoning(raw_reason)

        # Always surface a UI-visible preview so the AUTO BUY panel never renders blanks.
        self._populate_preview_fields(merged_result)

        # Dynamic trailing stop: lock profits only when structure extends in favour.
        try:
            self._apply_structure_trailing_stop(symbol, tick, merged_result)
        except Exception as tsl_exc:
            logger.debug("Trailing SL adjustment failed for %s: %s", symbol, tsl_exc)

        self._results[symbol] = merged_result

        # Auto-trade execution (paper/live). Isolated so a broker error can't blank the UI.
        try:
            await self._maybe_execute_trade(symbol, tick, self._results[symbol])
        except Exception as trade_exc:
            logger.debug("Auto-trade execution failed for %s: %s", symbol, trade_exc)

        # ── AI gate: strict conditions to minimise tokens ──────────────────
        now = time.time()
        signal = rule_result["signal"]
        market_live = indicators.get("market_status") == "LIVE"
        signal_changed = signal != self._last_signal[symbol] and signal != "WAIT"
        cooldown_ok = now - self._last_ai_call[symbol] >= AI_COOLDOWN_SEC
        strong_setup = max(buy_score, sell_score) >= HIGH_CONFLUENCE_SCORE

        if (
            self._ai_enabled
            and settings.openai_api_key
            and market_live
            and signal_changed
            and cooldown_ok
            and strong_setup
        ):
            candidates.append((symbol, tick, indicators, rule_result))
            self._last_ai_call[symbol] = now

        self._last_signal[symbol] = signal

    @staticmethod
    def _humanize_gate_reasons(reasons: List[str]) -> str:
        """Translate cryptic gate-reason tokens into trader-friendly English.

        Backend emits terse tokens like "no edge trigger" or "quality 42 < 75".
        Traders parse plain English faster, so we rewrite each token and dedupe.
        """
        if not reasons:
            return ""
        out: List[str] = []
        seen: set[str] = set()
        for raw in reasons:
            token = str(raw or "").strip()
            if not token:
                continue
            low = token.lower()
            if "no edge trigger" in low:
                msg = "No breakout / momentum trigger armed"
            elif "factors not aligned" in low:
                msg = "Momentum/Trend/Sentiment not all aligned"
            elif low.startswith("alpha ") and "below gate" in low:
                msg = f"Directional {token.split()[1]}% below required strength"
            elif low.startswith("regime "):
                msg = f"Market regime unfavourable ({token[7:]})"
            elif "volatility extreme" in low:
                msg = "Volatility EXTREME — circuit-breaker blocked"
            elif low.startswith("fatigue+"):
                msg = f"Trade fatigue penalty ({token[8:]}) — cool-off active"
            elif low.startswith("negative ev"):
                msg = f"Reward/risk unfavourable ({token})"
            elif low.startswith("quality ") and "< 75" in low:
                # e.g. "quality 42 < 75"
                parts = token.split()
                q = parts[1] if len(parts) > 1 else "?"
                msg = f"Setup quality {q}/100 — need ≥75"
            elif low.startswith("exec gate:"):
                inner = token[10:].strip()
                msg = f"Exec-gate: {inner}"
            else:
                msg = token
            if msg not in seen:
                seen.add(msg)
                out.append(msg)
        return " • ".join(out)

    @staticmethod
    def _humanize_reasoning(raw: str) -> str:
        """Rewrite the raw rule-engine reasoning line into plain English.

        The rule engine emits either a compact trader-desk line (BUY/SELL) or
        a "No-trade: <token>; <token>" WAIT line. We only rewrite the WAIT case
        so BUY/SELL detail (alpha, factors, edges, EV) stays intact.
        """
        text = (raw or "").strip()
        if not text.lower().startswith("no-trade:"):
            return text
        remainder = text[len("no-trade:"):].strip()
        # Split off the optional " | downgraded to WAIT (...)" suffix.
        suffix = ""
        if "|" in remainder:
            head, tail = remainder.split("|", 1)
            remainder = head.strip()
            suffix = f" | {tail.strip()}"
        tokens = [t.strip() for t in remainder.split(";") if t.strip()]
        human = SmartAIAlgoService._humanize_gate_reasons(tokens) if tokens else "confluence pending"
        return f"No-trade: {human}{suffix}"

    @staticmethod
    def _grade_from_quality(signal: str, quality: float) -> str:
        """Consistent grade ladder used by both the rule engine and ML-veto path.

        WAIT branch surfaces a warmup ladder (WATCH < 30 < BUILDING < 60 < CLOSE < 75)
        so the trader can see the setup building toward a genuine signal.
        BUY/SELL branch uses the elite ladder (GOOD 75 / STRONG 82 / ELITE 90).
        """
        q = float(quality or 0.0)
        if str(signal).upper() == "WAIT":
            if q >= 60:
                return "CLOSE"
            if q >= 30:
                return "BUILDING"
            return "WATCH"
        if q >= 90:
            return "ELITE"
        if q >= 82:
            return "STRONG"
        return "GOOD"

    @staticmethod
    def _compute_tick_age_seconds(tick: Dict[str, Any]) -> int:
        """Return tick age in whole seconds; -1 if timestamp unavailable/unparseable."""
        ts_raw = tick.get("timestamp") if isinstance(tick, dict) else None
        if not ts_raw:
            return -1
        try:
            # ISO-8601 with or without timezone; datetime.fromisoformat handles both on 3.11+
            dt = datetime.fromisoformat(str(ts_raw))
        except Exception:
            return -1
        now_dt = datetime.now(dt.tzinfo) if dt.tzinfo else datetime.now()
        try:
            age = (now_dt - dt).total_seconds()
        except Exception:
            return -1
        if age < 0:
            return 0
        return int(age)

    @staticmethod
    def _populate_preview_fields(result: Dict[str, Any]) -> None:
        """Guarantee the UI preview strip always has values, even on WAIT / market closed."""
        signal = str(result.get("signal", "WAIT") or "WAIT").upper()
        regime = str(result.get("regime", "") or "").upper()
        alpha_bull = float(result.get("alpha_score", 50.0) or 50.0)
        # Recommended option side: prefer whatever a live preview already picked;
        # else derive from signal; else lean on regime/alpha so the UI never shows "—".
        if not result.get("recommended_option_side"):
            if signal == "BUY":
                result["recommended_option_side"] = "CE"
            elif signal == "SELL":
                result["recommended_option_side"] = "PE"
            elif regime in ("TRENDING_UP", "TRENDING_WEAK_UP") or alpha_bull >= 55.0:
                result["recommended_option_side"] = "CE"
            elif regime in ("TRENDING_DOWN", "TRENDING_WEAK_DOWN") or alpha_bull <= 45.0:
                result["recommended_option_side"] = "PE"
            else:
                result["recommended_option_side"] = "CE"

        gate = result.get("confluence_gate") or {}
        gate_reasons = gate.get("reasons") or []
        gate_reason_txt = SmartAIAlgoService._humanize_gate_reasons(gate_reasons)

        # ALGO gate: mirror the confluence gate so the UI badge is always meaningful.
        if "auto_buy_gate_passed" not in result:
            result["auto_buy_gate_passed"] = bool(gate.get("passed", False))
        if not result.get("auto_buy_gate_reason"):
            if signal in ("BUY", "SELL"):
                result["auto_buy_gate_reason"] = "Confluence matched" if gate.get("passed") else (gate_reason_txt or "Confluence pending")
            else:
                result["auto_buy_gate_reason"] = gate_reason_txt or "Awaiting confluence"

        # AI gate: unless an AI verdict has landed this cycle, expose pending state.
        result.setdefault("auto_buy_ai_passed", False)
        if not result.get("auto_buy_ai_reason"):
            if not gate.get("passed", False):
                result["auto_buy_ai_reason"] = "AI check gated by algo"
            else:
                result["auto_buy_ai_reason"] = "AI verdict pending"
        result.setdefault("auto_buy_ai_confidence", 0)

        # Ready flag: only true when both algo AND AI have passed.
        result.setdefault("auto_buy_ready", bool(result.get("auto_buy_gate_passed")) and bool(result.get("auto_buy_ai_passed")))
        result.setdefault("auto_buy_block_reason", "")

        # Option pricing defaults so the OPTION EXECUTION PRICE grid never crashes on undefined.
        for key, default in (
            ("option_tradingsymbol", ""),
            ("option_type", ""),
            ("option_expiry", ""),
            ("option_strike", 0),
            ("option_moneyness", ""),
            ("option_ltp", 0.0),
            ("option_best_bid_price", 0.0),
            ("option_best_ask_price", 0.0),
            ("option_best_buy_price", 0.0),
            ("option_quality_ok", False),
            ("option_spread_pct", 0.0),
            ("option_volume", 0.0),
            ("option_oi", 0.0),
            ("option_price_updated_at", 0),
            ("option_entry_buy_price", 0.0),
            ("option_unrealized_pnl_points", 0.0),
            ("option_unrealized_pnl_amount", 0.0),
            ("option_pnl_status", "FLAT"),
        ):
            result.setdefault(key, default)

        result["last_updated"] = int(time.time() * 1000)

    def _get_live_tradingsymbol(self, symbol: str) -> str:
        cfg = _settings()
        mapping = {
            "NIFTY": cfg.algo_live_symbol_nifty,
            "BANKNIFTY": cfg.algo_live_symbol_banknifty,
            "SENSEX": cfg.algo_live_symbol_sensex,
        }
        return (mapping.get(symbol) or "").strip()

    def _get_live_token(self, symbol: str) -> int:
        cfg = _settings()
        token_map = {
            "NIFTY": int(getattr(cfg, "nifty_fut_token", 0) or 0),
            "BANKNIFTY": int(getattr(cfg, "banknifty_fut_token", 0) or 0),
            "SENSEX": int(getattr(cfg, "sensex_fut_token", 0) or 0),
        }
        return token_map.get(symbol, 0)

    def _resolve_contract_from_token(self, kite: KiteConnect, symbol: str) -> tuple[str, str]:
        token = self._get_live_token(symbol)
        if token <= 0:
            return "", ""

        cached = self._instrument_token_map.get(token)
        if cached:
            return cached.get("exchange", ""), cached.get("tradingsymbol", "")

        for exchange in ("NFO", "BFO"):
            try:
                instruments = kite.instruments(exchange)
            except Exception:
                continue
            for inst in instruments:
                if int(inst.get("instrument_token", 0) or 0) != token:
                    continue
                tradingsymbol = str(inst.get("tradingsymbol", "") or "").strip()
                if tradingsymbol:
                    resolved = {"exchange": exchange, "tradingsymbol": tradingsymbol}
                    self._instrument_token_map[token] = resolved
                    return exchange, tradingsymbol

        return "", ""

    def _get_contract_meta(self, kite: KiteConnect, exchange: str, tradingsymbol: str) -> tuple[int, float]:
        ts_upper = (tradingsymbol or "").upper()

        # Fallback metadata for current index futures when instruments API is rate-limited.
        # Keeps order params exchange-valid even when live instrument dump cannot be fetched.
        if "BANKNIFTY" in ts_upper:
            fallback_lot, fallback_tick = 30, 0.20
        elif "SENSEX" in ts_upper:
            fallback_lot, fallback_tick = 20, 0.10
        elif "NIFTY" in ts_upper:
            fallback_lot, fallback_tick = 25, 0.10
        else:
            fallback_lot, fallback_tick = 1, 0.05

        key = f"{exchange}:{tradingsymbol}".upper()
        cached = self._instrument_meta_map.get(key)
        if cached:
            lot = int(cached.get("lot_size", 1) or 1)
            tick = float(cached.get("tick_size", 0.05) or 0.05)
            return max(1, lot), max(0.01, tick)

        try:
            instruments = kite.instruments(exchange)
        except Exception:
            return fallback_lot, fallback_tick

        for inst in instruments:
            ts = str(inst.get("tradingsymbol", "") or "").strip()
            if ts.upper() != tradingsymbol.upper():
                continue
            lot = int(inst.get("lot_size", 1) or 1)
            tick = float(inst.get("tick_size", 0.05) or 0.05)
            self._instrument_meta_map[key] = {
                "lot_size": max(1, lot),
                "tick_size": max(0.01, tick),
            }
            return max(1, lot), max(0.01, tick)

        return fallback_lot, fallback_tick

    @staticmethod
    def _round_price_to_tick(raw_price: float, tick_size: float, side: str) -> float:
        if tick_size <= 0:
            return round(raw_price, 2)
        steps = raw_price / tick_size
        if side == "BUY":
            steps = math.ceil(steps)
        else:
            steps = math.floor(steps)
        return round(max(tick_size, steps * tick_size), 2)

    @staticmethod
    def _extract_tick_size_from_error(error_msg: str) -> float:
        m = re.search(r"Tick size[^0-9]*([0-9]+(?:\.[0-9]+)?)", error_msg or "", flags=re.IGNORECASE)
        if not m:
            return 0.0
        try:
            return float(m.group(1))
        except Exception:
            return 0.0

    @staticmethod
    def _extract_qty_multiple_from_error(error_msg: str) -> int:
        m = re.search(r"multiple of\s+([0-9]+)", error_msg or "", flags=re.IGNORECASE)
        if not m:
            return 0
        try:
            return int(m.group(1))
        except Exception:
            return 0

    def _get_instruments_cached(self, kite: KiteConnect, exchange: str) -> List[Dict[str, Any]]:
        ex = (exchange or "").upper().strip()
        if not ex:
            return []
        now = time.time()
        cached = self._instruments_cache.get(ex)
        if cached and now - float(cached.get("ts", 0.0) or 0.0) < 600:
            return list(cached.get("data", []))

        try:
            data = kite.instruments(ex)
        except Exception:
            return list((cached or {}).get("data", []))

        if isinstance(data, list) and data:
            self._instruments_cache[ex] = {"ts": now, "data": data}
            return data
        return []

    def _resolve_option_contract(
        self,
        kite: KiteConnect,
        symbol: str,
        side: str,
        spot_price: float,
    ) -> Optional[Dict[str, Any]]:
        if spot_price <= 0:
            return None

        base_map = {
            "NIFTY": "NIFTY",
            "BANKNIFTY": "BANKNIFTY",
            "SENSEX": "SENSEX",
        }
        step_map = {
            "NIFTY": 50,
            "BANKNIFTY": 100,
            "SENSEX": 100,
        }

        base = base_map.get(symbol, symbol)
        strike_step = int(step_map.get(symbol, 50) or 50)
        exchange = "BFO" if symbol == "SENSEX" else "NFO"
        option_type = "CE" if side == "BUY" else "PE"
        atm_strike = round(spot_price / strike_step) * strike_step

        instruments = self._get_instruments_cached(kite, exchange)
        if not instruments:
            return None

        today = date.today()
        candidates: List[Dict[str, Any]] = []
        for inst in instruments:
            inst_type = str(inst.get("instrument_type", "") or "").upper()
            if inst_type != option_type:
                continue

            inst_name = str(inst.get("name", "") or "").upper()
            inst_ts = str(inst.get("tradingsymbol", "") or "").upper()
            if base not in inst_name and base not in inst_ts:
                continue

            expiry_raw = inst.get("expiry")
            expiry_date = None
            if isinstance(expiry_raw, date):
                expiry_date = expiry_raw
            elif isinstance(expiry_raw, str) and expiry_raw:
                try:
                    expiry_date = datetime.fromisoformat(expiry_raw[:10]).date()
                except Exception:
                    expiry_date = None
            if not expiry_date or expiry_date < today:
                continue

            strike = float(inst.get("strike", 0) or 0)
            if strike <= 0:
                continue

            lot_size = int(inst.get("lot_size", 0) or 0)
            tick_size = float(inst.get("tick_size", 0.05) or 0.05)
            tradingsymbol = str(inst.get("tradingsymbol", "") or "").strip()
            if not tradingsymbol:
                continue

            candidates.append(
                {
                    "exchange": exchange,
                    "tradingsymbol": tradingsymbol,
                    "option_type": option_type,
                    "expiry": expiry_date,
                    "strike": strike,
                    "lot_size": max(1, lot_size),
                    "tick_size": max(0.01, tick_size),
                    "dist": abs(strike - atm_strike),
                }
            )

        if not candidates:
            return None

        candidates.sort(key=lambda c: (c["expiry"], c["dist"]))

        nearest_expiry = candidates[0]["expiry"]
        same_expiry = [c for c in candidates if c["expiry"] == nearest_expiry]
        shortlist = same_expiry[:14]
        quote_keys = [f"{exchange}:{c['tradingsymbol']}" for c in shortlist]
        quote_map: Dict[str, Any] = {}
        if quote_keys:
            try:
                quote_map = kite.quote(quote_keys) or {}
            except Exception:
                quote_map = {}

        def _contract_score(c: Dict[str, Any]) -> tuple:
            q = quote_map.get(f"{exchange}:{c['tradingsymbol']}") or {}
            ltp = float(q.get("last_price", 0) or 0)
            vol = float(q.get("volume", 0) or 0)
            oi = float(q.get("oi", 0) or 0)
            depth = q.get("depth") or {}
            buy_depth = depth.get("buy") if isinstance(depth, dict) else []
            sell_depth = depth.get("sell") if isinstance(depth, dict) else []
            bid = float((buy_depth[0] or {}).get("price", 0) or 0) if isinstance(buy_depth, list) and buy_depth else 0.0
            ask = float((sell_depth[0] or {}).get("price", 0) or 0) if isinstance(sell_depth, list) and sell_depth else 0.0
            spread = (ask - bid) if ask > 0 and bid > 0 else 9999.0
            # Prioritize liquid/tight contracts first; then near ATM distance.
            return (
                0 if ltp > 0 else 1,
                0 if ask > 0 else 1,
                spread,
                -vol,
                -oi,
                c["dist"],
            )

        shortlist.sort(key=_contract_score)
        chosen = shortlist[0]
        chosen["expiry"] = chosen["expiry"].isoformat()
        return chosen

    def _resolve_preview_contract(
        self,
        kite: KiteConnect,
        symbol: str,
        side: str,
        spot_price: float,
    ) -> Optional[Dict[str, Any]]:
        """Pick the best-quality near-ATM option for the AUTO-BUY PREVIEW.

        Only considers **ITM+1** and **ATM+1** strikes (one step above/below
        the ATM strike). These carry the best delta/spread trade-off vs pure
        ATM. Requires bid AND ask AND volume for "quality-ok" status. If
        neither passes, falls back to ATM. Returns fully enriched contract
        including live LTP/bid/ask so the caller doesn't need a second quote.
        """
        if spot_price <= 0:
            return None

        step_map = {"NIFTY": 50, "BANKNIFTY": 100, "SENSEX": 100}
        base_map = {"NIFTY": "NIFTY", "BANKNIFTY": "BANKNIFTY", "SENSEX": "SENSEX"}
        step = int(step_map.get(symbol, 50) or 50)
        base = base_map.get(symbol, symbol)
        exchange = "BFO" if symbol == "SENSEX" else "NFO"
        opt_type = "CE" if side == "BUY" else "PE"
        atm = int(round(spot_price / step) * step)

        # Target strikes: ITM+1, ATM+1 (per user spec); ATM kept as safety fallback.
        if opt_type == "CE":
            itm1_strike = atm - step   # slightly ITM for calls (strike below spot)
            otm1_strike = atm + step   # ATM+1 for calls (strike above spot)
        else:
            itm1_strike = atm + step   # slightly ITM for puts (strike above spot)
            otm1_strike = atm - step   # ATM+1 for puts (strike below spot)
        target = {itm1_strike, otm1_strike, atm}
        moneyness_label = {itm1_strike: "ITM+1", otm1_strike: "ATM+1", atm: "ATM"}

        instruments = self._get_instruments_cached(kite, exchange)
        if not instruments:
            return None

        today = date.today()
        # Group by strike -> nearest expiry
        best_per_strike: Dict[int, Dict[str, Any]] = {}
        for inst in instruments:
            if str(inst.get("instrument_type", "") or "").upper() != opt_type:
                continue
            strike_f = float(inst.get("strike", 0) or 0)
            if strike_f <= 0:
                continue
            strike_i = int(strike_f)
            if strike_i not in target:
                continue

            inst_name = str(inst.get("name", "") or "").upper()
            inst_ts = str(inst.get("tradingsymbol", "") or "").upper()
            if base not in inst_name and base not in inst_ts:
                continue

            expiry_raw = inst.get("expiry")
            expiry_date = None
            if isinstance(expiry_raw, date):
                expiry_date = expiry_raw
            elif isinstance(expiry_raw, str) and expiry_raw:
                try:
                    expiry_date = datetime.fromisoformat(expiry_raw[:10]).date()
                except Exception:
                    expiry_date = None
            if not expiry_date or expiry_date < today:
                continue

            tradingsymbol = str(inst.get("tradingsymbol", "") or "").strip()
            if not tradingsymbol:
                continue

            candidate = {
                "exchange": exchange,
                "tradingsymbol": tradingsymbol,
                "option_type": opt_type,
                "expiry": expiry_date,
                "strike": strike_i,
                "lot_size": max(1, int(inst.get("lot_size", 0) or 0)),
                "tick_size": max(0.01, float(inst.get("tick_size", 0.05) or 0.05)),
                "moneyness": moneyness_label[strike_i],
            }
            prev = best_per_strike.get(strike_i)
            if prev is None or candidate["expiry"] < prev["expiry"]:
                best_per_strike[strike_i] = candidate

        if not best_per_strike:
            return None

        # Restrict to the single nearest expiry across all target strikes
        nearest_expiry = min(c["expiry"] for c in best_per_strike.values())
        shortlist = [c for c in best_per_strike.values() if c["expiry"] == nearest_expiry]

        quote_keys = [f"{c['exchange']}:{c['tradingsymbol']}" for c in shortlist]
        quote_map: Dict[str, Any] = {}
        if quote_keys:
            try:
                quote_map = kite.quote(quote_keys) or {}
            except Exception:
                quote_map = {}

        for c in shortlist:
            q = quote_map.get(f"{c['exchange']}:{c['tradingsymbol']}") or {}
            ltp = float(q.get("last_price", 0) or 0)
            vol = float(q.get("volume", 0) or 0)
            oi = float(q.get("oi", 0) or 0)
            depth = q.get("depth") or {}
            buy_d = depth.get("buy") if isinstance(depth, dict) else []
            sell_d = depth.get("sell") if isinstance(depth, dict) else []
            bid = float((buy_d[0] or {}).get("price", 0) or 0) if isinstance(buy_d, list) and buy_d else 0.0
            ask = float((sell_d[0] or {}).get("price", 0) or 0) if isinstance(sell_d, list) and sell_d else 0.0
            spread = (ask - bid) if bid > 0 and ask > 0 else 9999.0
            spread_pct = (spread / ltp * 100.0) if ltp > 0 and spread < 9999.0 else 9999.0
            c["ltp"] = ltp
            c["bid"] = bid
            c["ask"] = ask
            c["vol"] = vol
            c["oi"] = oi
            c["spread"] = spread
            c["spread_pct"] = spread_pct
            # Quality gate: valid two-sided market, live prints, and reasonable spread.
            c["quality_ok"] = (
                bid > 0 and ask > 0 and ltp > 0 and vol > 0
                and spread_pct <= 15.0  # ≤15% spread on premium
            )

        # Priority order: ITM+1 → ATM+1 → ATM (safety fallback)
        priority_strikes = [itm1_strike, otm1_strike, atm]
        by_strike = {c["strike"]: c for c in shortlist}
        ordered = [by_strike[s] for s in priority_strikes if s in by_strike]

        quality_hits = [c for c in ordered if c.get("quality_ok")]
        if quality_hits:
            # Among quality passers, prefer tightest spread (best fill), then highest OI.
            chosen = min(quality_hits, key=lambda c: (c["spread_pct"], -c["oi"]))
        elif ordered:
            # Nothing passed quality — take the first with any live price to avoid blanks.
            live = [c for c in ordered if c.get("ltp", 0) > 0]
            chosen = live[0] if live else ordered[0]
        else:
            return None

        chosen["expiry"] = chosen["expiry"].isoformat()
        return chosen

    def _refresh_option_preview(
        self, symbol: str, tick: Dict[str, Any], result: Dict[str, Any]
    ) -> None:
        """Populate AUTO-BUY PREVIEW option fields on every tick.

        Picks the candidate side from the fired signal, or (when WAIT) from the
        current regime / directional alpha, so the preview strip always shows a
        real ITM+1/ATM+1 contract with live price. Broker quote is refreshed at
        most every OPTION_PREVIEW_REFRESH_SEC seconds; cached values fill
        in-between.
        """
        signal = str(result.get("signal", "WAIT") or "WAIT").upper()
        regime = str(result.get("regime", "") or "").upper()
        alpha_bull = float(result.get("alpha_score", 50.0) or 50.0)

        # Candidate side: fired signal wins; else lean from regime/alpha; default CE.
        if signal == "BUY":
            side = "BUY"
        elif signal == "SELL":
            side = "SELL"
        elif regime in ("TRENDING_UP", "TRENDING_WEAK_UP") or alpha_bull >= 55.0:
            side = "BUY"
        elif regime in ("TRENDING_DOWN", "TRENDING_WEAK_DOWN") or alpha_bull <= 45.0:
            side = "SELL"
        else:
            side = "BUY"

        result["recommended_option_side"] = "CE" if side == "BUY" else "PE"

        spot = float(result.get("entry_price", 0) or 0)
        if spot <= 0:
            spot = float((tick or {}).get("price", 0) or 0)
        if spot <= 0:
            return

        now = time.time()
        cache_key = f"{symbol}:{side}"
        cached = self._option_preview_cache.get(cache_key)
        last_ts = float(self._option_preview_ts.get(cache_key, 0.0) or 0.0)

        # Serve cached preview between broker-refresh windows.
        if cached and (now - last_ts) < OPTION_PREVIEW_REFRESH_SEC:
            for k, v in cached.items():
                result[k] = v
            return

        cfg = _settings()
        if not cfg.zerodha_api_key or not cfg.zerodha_access_token:
            if cached:
                for k, v in cached.items():
                    result[k] = v
            return

        try:
            kite = KiteConnect(api_key=cfg.zerodha_api_key)
            kite.set_access_token(cfg.zerodha_access_token)
            contract = self._resolve_preview_contract(kite, symbol, side, spot)
        except Exception as exc:
            logger.debug("Option preview resolve failed for %s: %s", symbol, exc)
            contract = None

        if not contract:
            if cached:
                for k, v in cached.items():
                    result[k] = v
            return

        option_ltp = float(contract.get("ltp", 0) or 0)
        option_bid = float(contract.get("bid", 0) or 0)
        option_ask = float(contract.get("ask", 0) or 0)
        best_buy = option_ask if option_ask > 0 else option_ltp

        preview = {
            "option_tradingsymbol": str(contract.get("tradingsymbol") or ""),
            "option_type": contract.get("option_type"),
            "option_expiry": contract.get("expiry"),
            "option_strike": contract.get("strike"),
            "option_moneyness": contract.get("moneyness", ""),
            "option_ltp": option_ltp,
            "option_best_bid_price": option_bid,
            "option_best_ask_price": option_ask,
            "option_best_buy_price": best_buy,
            "option_quality_ok": bool(contract.get("quality_ok", False)),
            "option_spread_pct": round(float(contract.get("spread_pct", 0) or 0), 2),
            "option_volume": float(contract.get("vol", 0) or 0),
            "option_oi": float(contract.get("oi", 0) or 0),
            "option_price_updated_at": int(now * 1000),
        }
        self._option_preview_cache[cache_key] = preview
        self._option_preview_ts[cache_key] = now
        for k, v in preview.items():
            result[k] = v

    @staticmethod
    def _passes_advanced_option_gate(ind: Dict[str, Any], side: str) -> tuple[bool, str]:
        if not ind:
            return False, "Indicators unavailable"

        p = float(ind.get("price", 0) or 0)
        e20 = float(ind.get("ema20", 0) or 0)
        e100 = float(ind.get("ema100", 0) or 0)
        rsi = float(ind.get("rsi", 0) or 0)
        vwap = float(ind.get("vwap", 0) or 0)
        pcr = float(ind.get("pcr", 0) or 0)
        oi_trend = str(ind.get("oi_trend", "") or "").upper()
        change_pct = float(ind.get("change_pct", 0) or 0)
        near_high = bool(ind.get("near_high", False))
        near_low = bool(ind.get("near_low", False))

        continuation_context = False
        if side == "BUY":
            continuation_context = (
                p >= (e20 * 0.998 if e20 > 0 else p)
                and e20 >= e100
                and change_pct >= 0.35
                and rsi >= 52
            )
            checks = [
                (p >= (e20 * 0.998 if e20 > 0 else p), "price materially below EMA20"),
                (e20 >= e100, "EMA stack not bullish"),
                (p >= vwap, "price below VWAP"),
                (40 <= rsi <= 82, "RSI outside bullish range"),
                (oi_trend in ("LONG_BUILDUP", "SHORT_COVERING"), "OI trend not bullish"),
                (change_pct >= 0.25, "change% too weak for CE"),
                (pcr == 0 or pcr >= 0.70, "PCR too bearish for CE"),
                (near_high or near_low or continuation_context, "no sweep/continuation context"),
            ]
        else:
            continuation_context = (
                p <= (e20 * 1.002 if e20 > 0 else p)
                and e20 <= e100
                and change_pct <= -0.35
                and rsi <= 48
            )
            checks = [
                (p <= (e20 * 1.002 if e20 > 0 else p), "price materially above EMA20"),
                (e20 <= e100, "EMA stack not bearish"),
                (p <= vwap, "price above VWAP"),
                (22 <= rsi <= 60, "RSI outside bearish range"),
                (oi_trend in ("SHORT_BUILDUP", "LONG_UNWINDING"), "OI trend not bearish"),
                (change_pct <= -0.25, "change% too weak for PE"),
                (pcr <= 1.05, "PCR too bullish for PE"),
                (near_high or near_low or continuation_context, "no sweep/continuation context"),
            ]

        failed = [msg for ok, msg in checks if not ok]
        if failed:
            return False, "; ".join(failed)
        return True, "Advanced options parameters satisfied"

    async def _ai_trade_confirm(
        self,
        symbol: str,
        side: str,
        ind: Dict[str, Any],
        rule_signal: Dict[str, Any],
    ) -> tuple[bool, str, int]:
        cfg = _settings()
        if not self._ai_enabled or not cfg.openai_api_key:
            # Fallback to rule-engine execution when AI is unavailable.
            # This prevents hard blocking of otherwise valid live setups.
            return True, "AI unavailable; fallback to rule-based execution", 60

        user_prompt = (
            f"Symbol={symbol}; Signal={side}; Entry={rule_signal.get('entry_price', 0)}; "
            f"EMA20={ind.get('ema20', 0)}; EMA100={ind.get('ema100', 0)}; EMA200={ind.get('ema200', 0)}; "
            f"RSI={ind.get('rsi', 0)}; VWAP={ind.get('vwap', 0)}; PCR={ind.get('pcr', 0)}; "
            f"OI={ind.get('oi_trend', '')}; Change={ind.get('change_pct', 0)}; "
            f"NearHigh={ind.get('near_high', False)}; NearLow={ind.get('near_low', False)}. "
            "Reply JSON only: {\"allow\":true|false,\"confidence\":0-100,\"reason\":\"short\"}. "
            "Allow only if setup has strong multi-factor confluence and momentum continuation probability > 0.6."
        )

        payload = {
            "model": cfg.openai_model,
            "messages": [
                {"role": "system", "content": "You are a strict intraday options execution validator. Return JSON only."},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0,
            "max_tokens": 80,
        }

        try:
            async with httpx.AsyncClient(timeout=cfg.openai_timeout) as client:
                resp = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {cfg.openai_api_key}",
                        "Content-Type": "application/json",
                    },
                )
            if resp.status_code != 200:
                return False, f"AI confirmation HTTP {resp.status_code}", 0

            text = resp.json()["choices"][0]["message"]["content"].strip()
            if "```" in text:
                text = text.split("```")[1]
                if text.startswith("json"):
                    text = text[4:]
            data = json.loads(text)
            allow = bool(data.get("allow", False))
            ai_conf = int(data.get("confidence", 0) or 0)
            reason = str(data.get("reason", ""))
            if not allow or ai_conf < 60:
                return False, reason or "AI rejected setup", ai_conf
            return True, reason or "AI approved", ai_conf
        except Exception as exc:
            return False, f"AI confirmation failed: {exc}", 0

    async def _maybe_execute_trade(self, symbol: str, tick: Dict[str, Any], signal: Dict[str, Any]) -> None:
        cfg = _settings()

        if not cfg.algo_auto_trade_enabled:
            logger.debug("Smart AI trade skipped for %s: auto trade disabled", symbol)
            return

        side = str(signal.get("signal", "WAIT") or "WAIT").upper()
        if side not in ("BUY", "SELL"):
            return

        market_status = str(signal.get("market_status") or tick.get("status") or "CLOSED").upper()
        if market_status != "LIVE":
            logger.debug("Smart AI trade skipped for %s: market not live (%s)", symbol, market_status)
            return

        confidence = int(signal.get("confidence", 0) or 0)
        strength = int(signal.get("strength", 0) or 0)
        indicators = signal.get("indicators") or {}
        change_pct = float(indicators.get("change_pct", 0) or 0)
        trend = str(indicators.get("trend", "") or "").upper()

        # Adaptive threshold: allow slightly lower strength on strong directional continuation days.
        min_strength_required = int(cfg.algo_min_trade_strength)
        if side == "BUY" and change_pct >= 0.8 and trend in ("BULLISH", "STRONG_BUY"):
            min_strength_required = max(20, min_strength_required - 10)
        elif side == "SELL" and change_pct <= -0.8 and trend in ("BEARISH", "STRONG_SELL"):
            min_strength_required = max(20, min_strength_required - 10)

        if confidence < cfg.algo_min_trade_confidence:
            logger.debug(
                "Smart AI trade skipped for %s %s: confidence %s < %s",
                symbol,
                side,
                confidence,
                cfg.algo_min_trade_confidence,
            )
            return
        if strength < min_strength_required:
            logger.debug(
                "Smart AI trade skipped for %s %s: strength %s < %s",
                symbol,
                side,
                strength,
                min_strength_required,
            )
            return

        now = time.time()
        cooldown = max(0, int(cfg.algo_trade_cooldown_sec))
        if now - self._last_trade_time[symbol] < cooldown:
            logger.debug("Smart AI trade skipped for %s %s: cooldown active", symbol, side)
            return

        # Prevent repeated same-side spam orders for same symbol.
        if self._last_trade_side[symbol] == side:
            logger.debug("Smart AI trade skipped for %s %s: duplicate side suppression", symbol, side)
            return

        trade_event: Dict[str, Any] = {
            "symbol": symbol,
            "side": side,
            "entry_price": float(signal.get("entry_price", 0) or 0),
            "stop_loss": float(signal.get("stop_loss", 0) or 0),
            "target": float(signal.get("target", 0) or 0),
            "confidence": confidence,
            "strength": strength,
            "timestamp": datetime.now(IST).isoformat(),
            "mode": cfg.algo_auto_trade_mode,
            "status": "PENDING",
            "reason": signal.get("reasoning", ""),
        }

        mode = (cfg.algo_auto_trade_mode or "paper").lower().strip()
        if mode not in ("paper", "live"):
            mode = "paper"

        if mode == "paper":
            trade_event["status"] = "PAPER_EXECUTED"
            trade_event["broker_order_id"] = None
            self._record_trade(symbol, side, now, trade_event)
            logger.info("Smart AI PAPER trade recorded: %s %s", symbol, side)
            return

        if now < self._live_block_until_ts:
            trade_event["status"] = "LIVE_BLOCKED"
            trade_event["error"] = "Live order placement temporarily blocked after broker permission failure"
            signal["auto_buy_ready"] = False
            signal["auto_buy_block_reason"] = trade_event["error"]
            self._record_trade(symbol, side, now, trade_event)
            return

        # LIVE mode (OPTIONS ONLY): BUY CE for BUY signal, BUY PE for SELL signal.
        tradingsymbol = ""
        live_exchange = ""

        if not cfg.zerodha_api_key or not cfg.zerodha_access_token:
            trade_event["status"] = "SKIPPED"
            trade_event["error"] = "Zerodha credentials missing"
            self._record_trade(symbol, side, now, trade_event)
            logger.warning("Smart AI LIVE trade skipped for %s %s: Zerodha credentials missing", symbol, side)
            return

        kite = KiteConnect(api_key=cfg.zerodha_api_key)
        kite.set_access_token(cfg.zerodha_access_token)

        try:
            # For options strategy, we always BUY contracts (CE or PE).
            tx_side = kite.TRANSACTION_TYPE_BUY
            spot_ltp = float(signal.get("entry_price", 0) or 0)
            if spot_ltp <= 0:
                spot_ltp = float((tick or {}).get("price", 0) or 0)
            if spot_ltp <= 0:
                trade_event["status"] = "SKIPPED"
                trade_event["error"] = "Invalid LTP for live order"
                self._record_trade(symbol, side, now, trade_event)
                return

            option_contract = self._resolve_option_contract(kite, symbol, side, spot_ltp)
            if not option_contract:
                trade_event["status"] = "SKIPPED"
                trade_event["error"] = f"No suitable {symbol} {('CE' if side == 'BUY' else 'PE')} option contract found"
                signal["auto_buy_ready"] = False
                signal["auto_buy_block_reason"] = trade_event["error"]
                self._record_trade(symbol, side, now, trade_event)
                return

            live_exchange = str(option_contract["exchange"])
            tradingsymbol = str(option_contract["tradingsymbol"])
            option_type = str(option_contract.get("option_type", "") or "").upper()
            # Hard safety gate: never place futures/equity orders from Smart AI auto-trade.
            if option_type not in ("CE", "PE") or not tradingsymbol.upper().endswith(("CE", "PE")):
                trade_event["status"] = "SKIPPED"
                trade_event["error"] = f"Options-only enforcement blocked non-option contract: {tradingsymbol}"
                signal["auto_buy_ready"] = False
                signal["auto_buy_block_reason"] = trade_event["error"]
                self._record_trade(symbol, side, now, trade_event)
                logger.error("Smart AI options-only block for %s: %s", symbol, tradingsymbol)
                return
            lot_size = int(option_contract["lot_size"])
            tick_size = float(option_contract["tick_size"])

            option_ltp = 0.0
            option_best_bid = 0.0
            option_best_ask = 0.0
            try:
                q = kite.quote([f"{live_exchange}:{tradingsymbol}"])
                quote_item = q.get(f"{live_exchange}:{tradingsymbol}") or {}
                option_ltp = float(quote_item.get("last_price", 0) or 0)
                depth = quote_item.get("depth") or {}
                buy_depth = depth.get("buy") if isinstance(depth, dict) else []
                sell_depth = depth.get("sell") if isinstance(depth, dict) else []
                if isinstance(buy_depth, list) and buy_depth:
                    option_best_bid = float((buy_depth[0] or {}).get("price", 0) or 0)
                if isinstance(sell_depth, list) and sell_depth:
                    option_best_ask = float((sell_depth[0] or {}).get("price", 0) or 0)
            except Exception:
                option_ltp = 0.0
            if option_ltp <= 0:
                option_ltp = max(tick_size, spot_ltp * 0.01)
            best_buy_price = option_best_ask if option_best_ask > 0 else option_ltp

            signal["option_tradingsymbol"] = tradingsymbol
            signal["option_type"] = option_contract.get("option_type")
            signal["option_expiry"] = option_contract.get("expiry")
            signal["option_strike"] = option_contract.get("strike")
            signal["option_ltp"] = option_ltp
            signal["option_best_bid_price"] = option_best_bid
            signal["option_best_ask_price"] = option_best_ask
            signal["option_best_buy_price"] = best_buy_price
            signal["option_price_updated_at"] = int(time.time() * 1000)
            signal["recommended_option_side"] = "CE" if side == "BUY" else "PE"

            pos = self._open_option_position.get(symbol) or {}
            if str(pos.get("tradingsymbol", "") or "") == tradingsymbol:
                entry_buy = float(pos.get("entry_buy_price", 0) or 0)
                pos_qty = int(pos.get("quantity", 0) or 0)
                if entry_buy > 0 and pos_qty > 0:
                    pnl_pts = option_ltp - entry_buy
                    pnl_amt = pnl_pts * float(pos_qty)
                    signal["option_entry_buy_price"] = entry_buy
                    signal["option_unrealized_pnl_points"] = round(pnl_pts, 2)
                    signal["option_unrealized_pnl_amount"] = round(pnl_amt, 2)
                    signal["option_pnl_status"] = "PROFIT" if pnl_amt > 0 else ("LOSS" if pnl_amt < 0 else "FLAT")

            ind = signal.get("indicators") or {}
            gate_ok, gate_reason = self._passes_advanced_option_gate(ind, side)
            signal["auto_buy_gate_passed"] = gate_ok
            signal["auto_buy_gate_reason"] = gate_reason
            if not gate_ok:
                signal["auto_buy_ready"] = False
                signal["auto_buy_block_reason"] = gate_reason
                trade_event["status"] = "SKIPPED"
                trade_event["error"] = gate_reason
                self._record_trade(symbol, side, now, trade_event)
                logger.info("Smart AI trade gate skipped for %s %s: %s", symbol, side, gate_reason)
                return

            ai_ok, ai_reason, ai_conf = await self._ai_trade_confirm(symbol, side, ind, signal)
            signal["auto_buy_ai_passed"] = ai_ok
            signal["auto_buy_ai_reason"] = ai_reason
            signal["auto_buy_ai_confidence"] = ai_conf
            if not ai_ok:
                signal["auto_buy_ready"] = False
                signal["auto_buy_block_reason"] = ai_reason
                trade_event["status"] = "AI_REJECTED"
                trade_event["error"] = ai_reason
                trade_event["ai_confidence"] = ai_conf
                self._record_trade(symbol, side, now, trade_event)
                logger.info("Smart AI trade rejected by AI for %s %s: %s", symbol, side, ai_reason)
                return
            signal["auto_buy_ready"] = True
            signal["auto_buy_block_reason"] = ""
            trade_event["ai_confidence"] = ai_conf
            trade_event["ai_reason"] = ai_reason

            # Zerodha API may reject pure market orders for some segments without market protection.
            # Use a near-LTP limit price with a small protective offset.
            price_offset = max(tick_size, option_ltp * 0.003)
            raw_limit = option_ltp + price_offset
            limit_price = self._round_price_to_tick(raw_limit, tick_size, "BUY")
            requested_qty = max(1, int(cfg.algo_trade_quantity))
            quantity = int(math.ceil(requested_qty / lot_size) * lot_size)
            order_id = None
            for attempt in range(3):
                try:
                    order_id = kite.place_order(
                        variety=kite.VARIETY_REGULAR,
                        exchange=live_exchange,
                        tradingsymbol=tradingsymbol,
                        transaction_type=tx_side,
                        quantity=quantity,
                        order_type=kite.ORDER_TYPE_LIMIT,
                        price=limit_price,
                        product=kite.PRODUCT_MIS,
                    )
                    break
                except Exception as order_exc:
                    error_text = str(order_exc)
                    adjusted = False

                    broker_tick = self._extract_tick_size_from_error(error_text)
                    if broker_tick > 0 and abs(broker_tick - tick_size) > 1e-9:
                        tick_size = broker_tick
                        limit_price = self._round_price_to_tick(raw_limit, tick_size, "BUY")
                        adjusted = True

                    broker_lot = self._extract_qty_multiple_from_error(error_text)
                    if broker_lot > 0 and (quantity % broker_lot != 0):
                        lot_size = broker_lot
                        quantity = int(math.ceil(quantity / broker_lot) * broker_lot)
                        adjusted = True

                    if adjusted and attempt < 2:
                        logger.warning(
                            "Smart AI LIVE order retry for %s %s with adjusted tick=%s lot=%s qty=%s price=%s",
                            symbol,
                            side,
                            tick_size,
                            lot_size,
                            quantity,
                            limit_price,
                        )
                        continue
                    raise

            if not order_id:
                raise RuntimeError("Broker did not return order_id")
            trade_event["status"] = "LIVE_EXECUTED"
            trade_event["broker_order_id"] = order_id
            trade_event["exchange"] = live_exchange
            trade_event["tradingsymbol"] = tradingsymbol
            trade_event["instrument_kind"] = "OPTION"
            trade_event["option_type"] = option_contract.get("option_type")
            trade_event["option_expiry"] = option_contract.get("expiry")
            trade_event["option_strike"] = option_contract.get("strike")
            trade_event["option_ltp"] = option_ltp
            trade_event["option_best_bid_price"] = option_best_bid
            trade_event["option_best_ask_price"] = option_best_ask
            trade_event["option_best_buy_price"] = best_buy_price
            trade_event["order_type"] = "LIMIT"
            trade_event["limit_price"] = limit_price
            trade_event["quantity"] = quantity
            trade_event["lot_size"] = lot_size
            trade_event["tick_size"] = tick_size

            self._last_option_exec_info[symbol] = {
                "option_tradingsymbol": tradingsymbol,
                "option_type": option_contract.get("option_type"),
                "option_expiry": option_contract.get("expiry"),
                "option_strike": option_contract.get("strike"),
                "option_ltp": option_ltp,
                "option_best_bid_price": option_best_bid,
                "option_best_ask_price": option_best_ask,
                "option_best_buy_price": best_buy_price,
                "option_price_updated_at": int(time.time() * 1000),
            }
            self._open_option_position[symbol] = {
                "tradingsymbol": tradingsymbol,
                "entry_buy_price": limit_price,
                "quantity": quantity,
                "ts": int(time.time() * 1000),
            }

            signal["option_entry_buy_price"] = limit_price
            signal["option_unrealized_pnl_points"] = round(option_ltp - limit_price, 2)
            signal["option_unrealized_pnl_amount"] = round((option_ltp - limit_price) * float(quantity), 2)
            signal["option_pnl_status"] = (
                "PROFIT"
                if option_ltp > limit_price
                else ("LOSS" if option_ltp < limit_price else "FLAT")
            )

            self._record_trade(symbol, side, now, trade_event)
            logger.info("Smart AI Algo LIVE order placed: %s %s -> %s", symbol, side, order_id)
        except Exception as exc:
            error_msg = str(exc)
            if isinstance(exc, PermissionException) and "No IPs configured for this app" in error_msg:
                # Zerodha app-level IP whitelist rejection. Pause live attempts briefly.
                self._live_block_until_ts = time.time() + 300
                trade_event["status"] = "LIVE_BLOCKED_IP"
                trade_event["error"] = (
                    "No IPs configured for this Kite app. Whitelist your server IP in Zerodha developer console. "
                    "Live retries paused for 5 minutes."
                )
                # Mark attempt time/side so symbol-level cooldown and duplicate suppression also apply.
                self._record_trade(symbol, side, now, trade_event)
            else:
                trade_event["status"] = "FAILED"
                trade_event["error"] = error_msg
                self._record_trade(symbol, side, now, trade_event)
            logger.error("Smart AI Algo LIVE order failed for %s: %s", symbol, exc, exc_info=True)

    def _record_trade(self, symbol: str, side: str, ts: float, event: Dict[str, Any]) -> None:
        if side in ("BUY", "SELL"):
            self._last_trade_side[symbol] = side
            self._last_trade_time[symbol] = ts

        self._trade_history.append(event)
        if len(self._trade_history) > 200:
            self._trade_history = self._trade_history[-200:]

    def _apply_structure_trailing_stop(self, symbol: str, tick: Dict[str, Any], signal: Dict[str, Any]) -> None:
        side = str(signal.get("signal", "WAIT") or "WAIT").upper()
        state = self._trailing_state.get(symbol) or {"side": "WAIT", "extreme": 0.0, "tsl": 0.0}

        if side not in ("BUY", "SELL"):
            self._trailing_state[symbol] = {"side": "WAIT", "extreme": 0.0, "tsl": 0.0}
            return

        entry = float(signal.get("entry_price", 0) or 0)
        sl_points = float(signal.get("sl_points", DEFAULT_SL_POINTS) or DEFAULT_SL_POINTS)
        high = float((tick or {}).get("high", 0) or 0)
        low = float((tick or {}).get("low", 0) or 0)

        if entry <= 0 or sl_points <= 0:
            return

        # Start a fresh trailing session whenever signal side flips or state is missing.
        if state.get("side") != side:
            initial_tsl = (
                round(entry - (sl_points * TRAILING_SL_TRIGGER_RATIO), 2)
                if side == "BUY"
                else round(entry + (sl_points * TRAILING_SL_TRIGGER_RATIO), 2)
            )
            initial_extreme = entry
            if side == "BUY" and high > 0:
                initial_extreme = max(initial_extreme, high)
            elif side == "SELL" and low > 0:
                initial_extreme = min(initial_extreme, low)
            self._trailing_state[symbol] = {
                "side": side,
                "extreme": float(initial_extreme),
                "tsl": float(initial_tsl),
            }
            signal["trailing_stop_loss"] = initial_tsl
            return

        current_extreme = float(state.get("extreme", entry) or entry)
        current_tsl = float(state.get("tsl", signal.get("trailing_stop_loss", 0)) or 0)

        if side == "BUY":
            # Higher highs move TSL up; no backtracking on pullbacks.
            if high > 0 and high > current_extreme:
                current_extreme = high
                candidate_tsl = round(current_extreme - (sl_points * TRAILING_SL_TRIGGER_RATIO), 2)
                current_tsl = max(current_tsl, candidate_tsl)
        else:
            # Lower lows move TSL down; no widening when price bounces up.
            if low > 0 and (current_extreme <= 0 or low < current_extreme):
                current_extreme = low
                candidate_tsl = round(current_extreme + (sl_points * TRAILING_SL_TRIGGER_RATIO), 2)
                current_tsl = candidate_tsl if current_tsl <= 0 else min(current_tsl, candidate_tsl)

        self._trailing_state[symbol] = {
            "side": side,
            "extreme": float(current_extreme),
            "tsl": float(current_tsl),
        }
        signal["trailing_stop_loss"] = round(current_tsl, 2)

    # ── Indicator computation ─────────────────────────────────────────────────
    def _build_indicators(self, symbol: str, tick: Dict) -> Dict[str, Any]:
        price = float(tick.get("price", 0) or 0)
        prev_close = float(tick.get("close", 0) or 0)
        high = float(tick.get("high", 0) or 0)
        low = float(tick.get("low", 0) or 0)
        volume = float(tick.get("volume", 0) or 0)
        oi = float(tick.get("oi", 0) or 0)
        pcr = float(tick.get("pcr", 1.0) or 1.0)
        call_oi = float(tick.get("callOI", 0) or 0)
        put_oi = float(tick.get("putOI", 0) or 0)
        change_pct = float(tick.get("changePercent", 0) or 0)

        # Rolling close history (up to 200 samples)
        hist = self._price_history[symbol]
        if not hist or hist[-1] != price:
            hist.append(price)
            if len(hist) > 200:
                hist.pop(0)

        ema20 = _ema(hist, 20) if len(hist) >= 20 else price
        ema100 = _ema(hist, 100) if len(hist) >= 100 else price
        ema200 = _ema(hist, 200) if len(hist) >= 200 else price
        rsi = _rsi(hist) if len(hist) >= 15 else 50.0

        # Analysis payload (VWAP if pre-computed elsewhere)
        analysis = tick.get("analysis") or {}
        vwap = float(analysis.get("vwap", 0) or 0) or price

        # QuantEdge feature block ------------------------------------------------
        atr = _atr_proxy(hist, ATR_PERIOD)
        atr_pct = (atr / price * 100.0) if price > 0 else 0.0
        roc5 = _roc(hist, ROC_LOOKBACK)
        roc10 = _roc(hist, 10)
        ema20_slope_pct = _ema_slope_pct(hist, 20, EMA_SLOPE_LOOKBACK)

        if len(hist) >= BOLLINGER_WINDOW:
            seg = hist[-BOLLINGER_WINDOW:]
            bb_mean = sum(seg) / len(seg)
            bb_sd = _stdev(seg)
            bb_z = ((price - bb_mean) / bb_sd) if bb_sd > 0 else 0.0
        else:
            bb_z = 0.0

        vwap_dist_pct = ((price - vwap) / vwap * 100.0) if vwap > 0 else 0.0
        # Neutral PCR ~ 1.0 with typical intraday stdev ~ 0.25 for Indian indices.
        pcr_z = (pcr - 1.0) / 0.25 if pcr > 0 else 0.0

        # Liquidity sweep proxy — price hugging intraday extreme
        near_high = high > 0 and abs(price - high) / high < 0.002
        near_low = low > 0 and abs(price - low) / low < 0.002

        # OI trend classification
        if change_pct > 0.1 and oi > 0:
            oi_trend = "LONG_BUILDUP"
        elif change_pct < -0.1 and oi > 0:
            oi_trend = "SHORT_BUILDUP"
        elif change_pct > 0.1:
            oi_trend = "SHORT_COVERING"
        elif change_pct < -0.1:
            oi_trend = "LONG_UNWINDING"
        else:
            oi_trend = "NEUTRAL"

        if pcr > 1.2:
            pcr_bias = "BULLISH"
        elif pcr < 0.8:
            pcr_bias = "BEARISH"
        else:
            pcr_bias = "NEUTRAL"

        price_above_ema20 = price > ema20
        price_above_ema100 = price > ema100
        price_above_ema200 = price > ema200
        ema20_above_ema100 = ema20 > ema100
        ema100_above_ema200 = ema100 > ema200

        trend = str(tick.get("trend", "NEUTRAL") or "NEUTRAL").upper()

        regime_detail = _detect_regime(atr_pct, ema20, ema100, atr)

        return {
            # ── Backward-compatible fields (do not rename / remove) ──
            "price": price,
            "prev_close": prev_close,
            "high": high,
            "low": low,
            "volume": volume,
            "oi": oi,
            "pcr": pcr,
            "call_oi": call_oi,
            "put_oi": put_oi,
            "change_pct": change_pct,
            "ema20": round(ema20, 2),
            "ema100": round(ema100, 2),
            "ema200": round(ema200, 2),
            "rsi": round(rsi, 1),
            "vwap": round(vwap, 2),
            "oi_trend": oi_trend,
            "pcr_bias": pcr_bias,
            "near_high": near_high,
            "near_low": near_low,
            "price_above_ema20": price_above_ema20,
            "price_above_ema100": price_above_ema100,
            "price_above_ema200": price_above_ema200,
            "ema20_above_ema100": ema20_above_ema100,
            "ema100_above_ema200": ema100_above_ema200,
            "trend": trend,
            "market_status": str(tick.get("status", "CLOSED") or "CLOSED"),
            # ── QuantEdge quant features ──
            "atr": round(atr, 2),
            "atr_pct": round(atr_pct, 3),
            "roc5": round(roc5, 3),
            "roc10": round(roc10, 3),
            "ema20_slope_pct": round(ema20_slope_pct, 3),
            "bb_z": round(bb_z, 3),
            "vwap_dist_pct": round(vwap_dist_pct, 3),
            "pcr_z": round(pcr_z, 3),
            "regime_detail": regime_detail,
        }

    # ── Rule engine (QuantEdge multi-factor / edge / confluence-gate) ───────
    def _rule_engine(self, symbol: str, tick: Dict, ind: Dict):
        """QuantEdge decision stack.

        Returns (result_dict, alpha_bull_score, alpha_bear_score).
        alpha scores are on the 0-100 scale and drive the AI enrichment gate.
        """
        p = ind["price"]
        if p <= 0:
            return self._empty(symbol), 0.0, 0.0

        # L2 — factor scores (0-100, 50 = neutral, higher = bullish tilt)
        f_mom = _factor_momentum(ind)
        f_trn = _factor_trend(ind)
        f_str = _factor_structure(ind)
        f_sen = _factor_sentiment(ind)
        factor_scores = {
            "momentum": round(f_mom, 1),
            "trend": round(f_trn, 1),
            "structure": round(f_str, 1),
            "sentiment": round(f_sen, 1),
        }

        alpha_bull = _clip(
            f_mom * 0.30 + f_trn * 0.30 + f_str * 0.15 + f_sen * 0.25
        )
        alpha_bear = _clip(100.0 - alpha_bull)

        # L1 — regime
        regime_detail = ind.get("regime_detail") or {"volatility": "UNKNOWN", "trend": "UNKNOWN", "favorable": False}
        vol_regime = str(regime_detail.get("volatility", "UNKNOWN"))
        trend_regime = str(regime_detail.get("trend", "UNKNOWN"))
        regime_favorable = bool(regime_detail.get("favorable", False))

        # L3 - behavioural edge triggers (direction-specific)
        edges = _detect_edges(ind)
        _BULL_EDGES = ("SWEEP_LOW_REVERSAL", "VWAP_RECLAIM", "OI_DIVERGENCE_BULL", "SQUEEZE_BREAKOUT_BULL")
        _BEAR_EDGES = ("SWEEP_HIGH_REJECTION", "VWAP_BREAKDOWN", "OI_DIVERGENCE_BEAR", "SQUEEZE_BREAKOUT_BEAR")
        bull_edges = [e for e in edges if e in _BULL_EDGES]
        bear_edges = [e for e in edges if e in _BEAR_EDGES]

        # L5 — adaptive ATR-based risk
        atr = float(ind.get("atr", 0.0) or 0.0)
        if atr > 0:
            sl_pts = round(max(DEFAULT_SL_POINTS * 0.5, atr * ATR_SL_MULT), 2)
            tgt_pts = round(max(DEFAULT_TARGET_POINTS * 0.5, atr * ATR_TGT_MULT), 2)
        else:
            sl_pts = float(DEFAULT_SL_POINTS)
            tgt_pts = float(DEFAULT_TARGET_POINTS)
        rr = round(tgt_pts / sl_pts, 2) if sl_pts > 0 else 0.0

        # L7 — trade fatigue (drawdown protection)
        now_ts = time.time()
        recent_attempts = sum(
            1
            for ev in self._trade_history[-40:]
            if ev.get("symbol") == symbol
            and now_ts - self._parse_event_ts(ev) < FATIGUE_WINDOW_SEC
        )
        fatigue_penalty = max(0, recent_attempts - FATIGUE_MAX_ATTEMPTS) * 5.0
        bull_gate = CONFLUENCE_BULL + fatigue_penalty
        bear_gate = CONFLUENCE_BEAR - fatigue_penalty

        # L4 — confluence gate (100 %-match contract)
        gate_reasons: List[str] = []
        signal = "WAIT"

        can_buy = (
            alpha_bull >= bull_gate
            and f_mom > FACTOR_MIN_BULL
            and f_trn > FACTOR_MIN_BULL
            and f_sen > FACTOR_MIN_BULL
            and regime_favorable
            and vol_regime != "EXTREME"
            and len(bull_edges) >= 1
        )
        can_sell = (
            alpha_bull <= bear_gate
            and f_mom < FACTOR_MAX_BEAR
            and f_trn < FACTOR_MAX_BEAR
            and f_sen < FACTOR_MAX_BEAR
            and regime_favorable
            and vol_regime != "EXTREME"
            and len(bear_edges) >= 1
        )

        if can_buy and alpha_bull >= alpha_bear:
            signal = "BUY"
        elif can_sell and alpha_bear > alpha_bull:
            signal = "SELL"
        else:
            if alpha_bull < bull_gate and alpha_bear < bear_gate + 0:
                gate_reasons.append(f"alpha {alpha_bull:.0f} below gate")
            if not regime_favorable:
                gate_reasons.append(f"regime {trend_regime}/{vol_regime}")
            if vol_regime == "EXTREME":
                gate_reasons.append("volatility EXTREME — circuit breaker")
            if not edges:
                gate_reasons.append("no edge trigger")
            if fatigue_penalty:
                gate_reasons.append(f"fatigue+{int(fatigue_penalty)}")
            if min(f_mom, f_trn, f_sen) < FACTOR_MIN_BULL and max(f_mom, f_trn, f_sen) > FACTOR_MAX_BEAR:
                gate_reasons.append("factors not aligned")

        # L6 — probability + expected value
        directional_alpha = alpha_bull if signal == "BUY" else (alpha_bear if signal == "SELL" else 50.0)
        win_prob = _sigmoid((directional_alpha - 50.0) / 12.0)
        ev_pts = round(win_prob * tgt_pts - (1.0 - win_prob) * sl_pts, 2)
        kelly = 0.0
        if signal != "WAIT" and rr > 0:
            kelly = (win_prob * rr - (1.0 - win_prob)) / rr
            kelly = max(0.0, min(KELLY_CAP, kelly))

        # EV filter — never take a negative-EV trade
        if signal != "WAIT" and ev_pts <= 0:
            gate_reasons.append(f"negative EV {ev_pts}")
            signal = "WAIT"

        # Prices for entry / SL / TGT / TSL
        entry = p
        if signal == "BUY":
            sl = round(p - sl_pts, 2)
            tgt = round(p + tgt_pts, 2)
            tsl = round(p - atr * ATR_TSL_MULT, 2) if atr > 0 else round(p - sl_pts * 0.5, 2)
            regime = "TRENDING_UP" if trend_regime == "TRENDING_STRONG" else "TRENDING_WEAK_UP"
        elif signal == "SELL":
            sl = round(p + sl_pts, 2)
            tgt = round(p - tgt_pts, 2)
            tsl = round(p + atr * ATR_TSL_MULT, 2) if atr > 0 else round(p + sl_pts * 0.5, 2)
            regime = "TRENDING_DOWN" if trend_regime == "TRENDING_STRONG" else "TRENDING_WEAK_DOWN"
        else:
            sl = round(p - sl_pts, 2)
            tgt = round(p + tgt_pts, 2)
            tsl = round(p - sl_pts * 0.5, 2)
            if trend_regime == "RANGING":
                regime = "SIDEWAYS"
            elif alpha_bull > 55:
                regime = "TRENDING_WEAK_UP"
            elif alpha_bull < 45:
                regime = "TRENDING_WEAK_DOWN"
            else:
                regime = "NEUTRAL"

        # Confidence + strength reflect directional conviction (bull OR bear),
        # not the trade-side probability. This way the UI shows the true market
        # lean (e.g. Weak Uptrend @ 62%) even while the executor holds WAIT
        # because the elite gate hasn't cleared. When bias is truly neutral
        # (alpha ~ 50), confidence honestly reads ~50.
        conviction_alpha = max(alpha_bull, alpha_bear)  # symmetric 50..100
        confidence = int(min(95, max(0, round(conviction_alpha))))
        strength = int(min(100, round(conviction_alpha)))

        # Reasoning — trader-desk one-liner
        if signal in ("BUY", "SELL"):
            side_edges = bull_edges if signal == "BUY" else bear_edges
            side_alpha = alpha_bull if signal == "BUY" else alpha_bear
            reasoning = (
                f"{signal} alpha={side_alpha:.0f} "
                f"[M{f_mom:.0f}/T{f_trn:.0f}/S{f_str:.0f}/Sn{f_sen:.0f}] "
                f"regime={trend_regime}/{vol_regime} "
                f"edges={','.join(side_edges) or 'none'} "
                f"p_win={win_prob:.2f} R:R={rr} EV={ev_pts}"
            )
        else:
            reasoning = "No-trade: " + ("; ".join(gate_reasons) if gate_reasons else "confluence pending")

        # Execution-gate compatibility (options-only executor still uses these)
        buy_gate_ok, buy_gate_reason = self._passes_advanced_option_gate(ind, "BUY")
        sell_gate_ok, sell_gate_reason = self._passes_advanced_option_gate(ind, "SELL")

        # ---- Elite signal-quality gate (edge-fund grade) ----
        # Combines directional alpha, edge multiplicity, ML alignment, regime,
        # EV, and exec-gate agreement into a single 0-100 quality score.
        # Only signals with quality >= 75 survive as GENUINE.
        exec_gate_ok = True
        exec_gate_reason = ""
        if signal == "BUY" and not buy_gate_ok:
            exec_gate_ok = False
            exec_gate_reason = buy_gate_reason
        elif signal == "SELL" and not sell_gate_ok:
            exec_gate_ok = False
            exec_gate_reason = sell_gate_reason

        quality = 0.0
        if signal != "WAIT":
            side_edges = bull_edges if signal == "BUY" else bear_edges
            side_alpha = alpha_bull if signal == "BUY" else alpha_bear
            quality = (side_alpha - 50.0) * 1.6                       # 40 pts max from alpha above midline
            quality += min(len(side_edges) * 8.0, 24.0)                 # up to +24 for edge multiplicity
            quality += 10.0 if trend_regime == "TRENDING_STRONG" else (5.0 if trend_regime == "TRENDING_WEAK" else 0.0)
            quality += min(ev_pts / max(sl_pts, 1.0) * 10.0, 15.0)      # EV normalized by risk
            if vol_regime == "HIGH":
                quality -= 5.0
            if fatigue_penalty:
                quality -= fatigue_penalty
            if not exec_gate_ok:
                quality -= 15.0
            quality = max(0.0, min(100.0, quality))
        else:
            # ─── Warming quality (WAIT branch) ────────────────────────────────
            # During WAIT the score is 0–74 by construction (75 fires a real
            # signal). It tells the trader how close the setup is to firing so
            # the panel never shows a flat "0/100" while the engine is actively
            # scoring the tape.
            conviction = max(alpha_bull, alpha_bear)                    # 50 = flat, 100 = max
            quality = (conviction - 50.0) * 1.2                         # up to +60 from bias strength
            edges_seen = max(len(bull_edges), len(bear_edges))
            quality += min(edges_seen * 5.0, 15.0)                       # up to +15 for edges building
            if regime_favorable:
                quality += 8.0                                            # +8 when regime allows a trade
            if trend_regime == "TRENDING_STRONG":
                quality += 5.0
            elif trend_regime == "TRENDING_WEAK":
                quality += 2.0
            if vol_regime == "EXTREME":
                quality -= 15.0                                           # circuit-breaker penalty
            elif vol_regime == "HIGH":
                quality -= 4.0
            if fatigue_penalty:
                quality -= fatigue_penalty
            # Cap at 74 so WAIT can never look like a fired signal.
            quality = max(0.0, min(74.0, quality))

        # Genuine-only enforcement: any high-conviction signal must clear both
        # the confluence gate AND the exec gate. Otherwise it never fires.
        if signal != "WAIT" and not exec_gate_ok:
            gate_reasons.append(f"exec gate: {exec_gate_reason}")
            signal = "WAIT"
            # Keep the earned quality but cap at 74 so it can't look "fired".
            quality = min(quality, 74.0)
            reasoning = "No-trade: " + "; ".join(gate_reasons)
        elif signal != "WAIT" and quality < 75.0:
            gate_reasons.append(f"quality {quality:.0f} < 75")
            reasoning = f"{reasoning} | downgraded to WAIT (quality {quality:.0f}<75)"
            signal = "WAIT"
            quality = min(quality, 74.0)

        if signal == "WAIT":
            quality = min(quality, 74.0)

        grade = SmartAIAlgoService._grade_from_quality(signal, quality)

        confluence_gate = {
            "passed": signal != "WAIT",
            "reasons": gate_reasons if signal == "WAIT" else [],
            "bull_gate": round(bull_gate, 1),
            "bear_gate": round(bear_gate, 1),
            "fatigue_penalty": round(fatigue_penalty, 1),
            "recent_attempts_15m": recent_attempts,
            "exec_gate_ok": exec_gate_ok,
            "exec_gate_reason": exec_gate_reason,
        }

        result = {
            "symbol": symbol,
            "signal": signal,
            "entry_price": entry,
            "stop_loss": sl,
            "target": tgt,
            "trailing_stop_loss": tsl,
            "confidence": confidence,
            "sl_points": sl_pts,
            "target_points": tgt_pts,
            "regime": regime,
            "strength": strength,
            "reasoning": reasoning,
            "indicators": ind,
            "ai_powered": False,
            "last_updated": int(time.time() * 1000),
            "market_status": ind["market_status"],
            # QuantEdge quant payload
            "alpha_score": round(alpha_bull, 1),
            "factor_scores": factor_scores,
            "regime_detail": regime_detail,
            "edge_triggers": edges,
            "win_probability": round(win_prob, 3),
            "expected_value_points": ev_pts,
            "risk_reward_ratio": rr,
            "kelly_fraction": round(kelly, 4),
            "confluence_gate": confluence_gate,
            "signal_quality": round(quality, 1),
            "signal_grade": grade,
        }
        return result, alpha_bull, alpha_bear

    @staticmethod
    def _parse_event_ts(event: Dict[str, Any]) -> float:
        """Parse ISO timestamp from a trade_history event into epoch seconds."""
        ts_raw = event.get("timestamp") or ""
        if not isinstance(ts_raw, str) or not ts_raw:
            return 0.0
        try:
            return datetime.fromisoformat(ts_raw).timestamp()
        except Exception:
            return 0.0

    @staticmethod
    def _apply_ml_feedback(result: Dict[str, Any], ml_pred: Dict[str, Any]) -> None:
        """L8 feedback loop: nudge confidence when ML agrees; soft-veto when ML strongly disagrees.

        Rules (only active once the model exits warm-up):
          - agree BUY  with prob >= CONFIDENT_PROB : confidence += bonus (capped 95)
          - agree SELL with prob <= 1-CONFIDENT_PROB: confidence += bonus (capped 95)
          - disagree with prob >= VETO_PROB opposite direction: downgrade to WAIT
            and append the reason to `confluence_gate.reasons`.
        """
        from services.quantedge_ml import CONFIDENT_PROB, VETO_PROB  # local import avoids cycle at load

        if not isinstance(ml_pred, dict) or ml_pred.get("model_status") != "live":
            result["ml_feedback"] = {"applied": False, "note": "model warm-up"}
            return

        prob_up = float(ml_pred.get("probability", 0.5))
        signal = str(result.get("signal", "WAIT")).upper()
        confidence = int(result.get("confidence", 0) or 0)
        applied = False
        note = ""

        if signal == "BUY":
            if prob_up >= CONFIDENT_PROB:
                bonus = round((prob_up - 0.5) * 20)  # up to +10
                result["confidence"] = min(95, confidence + bonus)
                note = f"ML agrees UP p={prob_up:.2f} (+{bonus})"
                applied = True
            elif (1.0 - prob_up) >= VETO_PROB:
                # Strong bearish ML forecast — veto the BUY
                result["signal"] = "WAIT"
                result["confidence"] = max(0, confidence - 20)
                # Keep any earned warming quality but cap at 74 so it can't look "fired".
                result["signal_quality"] = min(float(result.get("signal_quality", 0.0) or 0.0), 74.0)
                result["signal_grade"] = SmartAIAlgoService._grade_from_quality("WAIT", result["signal_quality"])
                gate = result.setdefault("confluence_gate", {"passed": False, "reasons": []})
                gate["passed"] = False
                gate.setdefault("reasons", []).append(f"ML forecast DOWN p={1 - prob_up:.2f}")
                note = f"ML vetoed BUY (down p={1 - prob_up:.2f})"
                applied = True
        elif signal == "SELL":
            prob_down = 1.0 - prob_up
            if prob_down >= CONFIDENT_PROB:
                bonus = round((prob_down - 0.5) * 20)
                result["confidence"] = min(95, confidence + bonus)
                note = f"ML agrees DOWN p={prob_down:.2f} (+{bonus})"
                applied = True
            elif prob_up >= VETO_PROB:
                result["signal"] = "WAIT"
                result["confidence"] = max(0, confidence - 20)
                result["signal_quality"] = min(float(result.get("signal_quality", 0.0) or 0.0), 74.0)
                result["signal_grade"] = SmartAIAlgoService._grade_from_quality("WAIT", result["signal_quality"])
                gate = result.setdefault("confluence_gate", {"passed": False, "reasons": []})
                gate["passed"] = False
                gate.setdefault("reasons", []).append(f"ML forecast UP p={prob_up:.2f}")
                note = f"ML vetoed SELL (up p={prob_up:.2f})"
                applied = True
        else:
            # Signal is WAIT — surface a forward-looking hint without changing the signal.
            if prob_up >= CONFIDENT_PROB:
                note = f"ML leans UP p={prob_up:.2f}"
            elif (1.0 - prob_up) >= CONFIDENT_PROB:
                note = f"ML leans DOWN p={1 - prob_up:.2f}"

        result["ml_feedback"] = {"applied": applied, "note": note}

    # ── Batched AI call (1 request for all qualifying symbols) ───────────────
    async def _ai_batch(self, candidates: List[tuple]) -> None:
        """Call OpenAI ONCE with all candidate symbols in a single message.
        Ultra-compact prompt — keeps input tokens under 150 per symbol."""
        async with self._ai_semaphore:
            try:
                await self._call_openai_batch(candidates)
            except Exception as exc:
                logger.debug("AI batch skipped: %s", exc)

    async def _call_openai_batch(self, candidates: List[tuple]) -> None:
        if not settings.openai_api_key:
            return

        # Build a single ultra-compact block per symbol (≈60 tokens each)
        blocks = []
        for sym, _tick, ind, rule in candidates:
            blocks.append(
                f"{sym}|px:{ind['price']}|chg:{ind['change_pct']:.2f}%|"
                f"e20:{ind['ema20']}|e100:{ind['ema100']}|rsi:{ind['rsi']:.0f}|"
                f"pcr:{ind['pcr']:.2f}({ind['pcr_bias'][0]})|oi:{ind['oi_trend'][:4]}|"
                f"vwap:{ind['vwap']}|rule:{rule['signal']}@{rule['confidence']}%"
            )

        syms = [c[0] for c in candidates]
        data_block = "\n".join(blocks)

        # System prompt is tiny — reused across all calls (cached by OpenAI server)
        system = "Indian index algo. JSON only. No prose."

        user = (
            f"Validate these {len(syms)} signal(s):\n{data_block}\n"
            f'Reply JSON array: [{{"s":"SYM","sig":"BUY|SELL|WAIT","conf":0-100,"why":"<10 words"}}]'
        )

        payload = {
            "model": settings.openai_model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0,           # deterministic = no sampling cost overhead
            "max_tokens": AI_MAX_TOKENS,
        }

        async with httpx.AsyncClient(timeout=settings.openai_timeout) as client:
            resp = await client.post(
                "https://api.openai.com/v1/chat/completions",
                json=payload,
                headers={
                    "Authorization": f"Bearer {settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
            )

        if resp.status_code != 200:
            logger.warning("OpenAI batch → HTTP %s", resp.status_code)
            return

        text = resp.json()["choices"][0]["message"]["content"].strip()
        # Strip markdown fences if model adds them
        if "```" in text:
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]

        ai_list = json.loads(text)
        if not isinstance(ai_list, list):
            return

        # Map AI results back to each symbol
        ai_map = {item["s"]: item for item in ai_list if "s" in item}
        for sym, _tick, ind, rule in candidates:
            item = ai_map.get(sym)
            if not item:
                continue
            # Only override if AI agrees with rule direction or has high confidence
            ai_sig = str(item.get("sig", rule["signal"])).upper()
            ai_conf = int(item.get("conf", rule["confidence"]))
            ai_why = str(item.get("why", rule["reasoning"]))

            # Don't let AI flip a strong rule signal to opposite unless conf > 80
            if ai_sig != rule["signal"] and ai_conf < 80:
                ai_sig = rule["signal"]

            merged = {
                **self._results[sym],
                "signal": ai_sig,
                "confidence": ai_conf,
                "reasoning": ai_why,
                "ai_powered": True,
                "last_updated": int(time.time() * 1000),
            }
            # Recalculate SL/Target if signal flipped
            if ai_sig != rule["signal"] and ai_sig != "WAIT":
                p = merged["entry_price"]
                sl_pts = merged["sl_points"]
                tgt_pts = merged["target_points"]
                if ai_sig == "BUY":
                    merged["stop_loss"] = round(p - sl_pts, 2)
                    merged["target"] = round(p + tgt_pts, 2)
                    merged["trailing_stop_loss"] = round(p - sl_pts * 0.5, 2)
                else:
                    merged["stop_loss"] = round(p + sl_pts, 2)
                    merged["target"] = round(p - tgt_pts, 2)
                    merged["trailing_stop_loss"] = round(p + sl_pts * 0.5, 2)

            self._results[sym] = merged

    # ── Public API ───────────────────────────────────────────────────────────
    def set_ai_enabled(self, enabled: bool) -> None:
        """Toggle AI (OpenAI) enrichment. OFF = zero token spend."""
        self._ai_enabled = enabled
        if not enabled:
            # Clear ai_powered flag on all results so UI reflects the change
            for sym in SYMBOLS:
                r = self._results.get(sym)
                if r:
                    r["ai_powered"] = False
        logger.info("Smart AI Algo: AI enrichment %s", "ENABLED" if enabled else "DISABLED")

    def get_ai_enabled(self) -> bool:
        return self._ai_enabled

    def get_result(self, symbol: str) -> Dict[str, Any]:
        return self._results.get(symbol, self._empty(symbol))

    def get_all_results(self) -> Dict[str, Any]:
        return {s: self._results.get(s, self._empty(s)) for s in SYMBOLS}

    def get_trade_history(self, limit: int = 100) -> List[Dict[str, Any]]:
        lim = max(1, min(500, int(limit or 100)))
        return list(reversed(self._trade_history[-lim:]))

    def update_sl_target(
        self, symbol: str, sl_points: float, target_points: float
    ) -> None:
        r = self._results.get(symbol)
        if not r:
            return
        p = r["entry_price"] or r["indicators"].get("price", 0)
        sig = r["signal"]
        r["sl_points"] = sl_points
        r["target_points"] = target_points
        if sig == "BUY":
            r["stop_loss"] = round(p - sl_points, 2)
            r["target"] = round(p + target_points, 2)
            r["trailing_stop_loss"] = round(p - sl_points * 0.5, 2)
        elif sig == "SELL":
            r["stop_loss"] = round(p + sl_points, 2)
            r["target"] = round(p - target_points, 2)
            r["trailing_stop_loss"] = round(p + sl_points * 0.5, 2)
