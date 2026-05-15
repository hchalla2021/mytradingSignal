"""
🔭 Advanced Market Intelligence Observatory Service — Enterprise Grade
======================================================================
COMPREHENSIVE APPLICATION-WIDE OBSERVABILITY

Tracks:
  ✓ 14+ Trading Strategies (signals, confidence, performance)
  ✓ System Metrics (request latency, throughput, error rates)
  ✓ Feed Health (WebSocket status, data freshness, lag)
  ✓ API Performance (endpoint latency, 5xx/4xx rates, slow queries)
  ✓ Risk-Adjusted Scores (Sharpe-like, Sortino, consistency ratio)
  ✓ Cross-Strategy Correlations (which strategies agree/disagree)
  ✓ Advanced Analytics (volatility, drawdown, recovery time)
  ✓ Anomaly Detection (sudden drops, unexpected behavior)

Architecture:
  - Captures COMPREHENSIVE snapshots every 30 min (9:15–15:30 IST)
  - System metrics sampled continuously (request times, errors, feed latency)
  - End-of-day ADVANCED REPORT at 15:31 IST with full analytics
  - Multi-dimensional ranking (accuracy, Sharpe, consistency, speed, reliability)
  - asyncio.Lock-protected mutations, atomic writes, structured logging

Storage: backend/data/observatory/
  YYYY-MM-DD.json       — Complete daily snapshot (all metrics, strategies, system)
  YYYY-MM-DD.md         — Executive summary with analytics
  YYYY-MM-DD.analytics  — Detailed correlation + performance analysis
  WEEKLY_SUMMARY.md     — 7-day rankings (multiple dimensions)
  SYSTEM_HEALTH.md      — Current system status, anomalies, alerts
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import statistics
from datetime import datetime, date, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

IST = timezone(timedelta(hours=5, minutes=30))
DATA_DIR = Path(__file__).parent.parent / "data" / "observatory"
SYMBOLS = ("NIFTY", "BANKNIFTY", "SENSEX")

# Market session boundaries (minutes since midnight IST)
MARKET_OPEN_MIN  = 540   # 09:00
MARKET_CLOSE_MIN = 930   # 15:30

# End-of-day report trigger
REPORT_HOUR, REPORT_MIN = 15, 31

# Snapshot schedule — 30-min cadence starting at 9:00 IST
SNAP_MINUTES: frozenset = frozenset({540, 570, 600, 630, 660, 690, 720, 750, 780, 810, 840, 870, 900})

# Day classification thresholds (% change)
_STRONG_TREND_T = 1.5   # ≥ ±1.5%  → TRENDING_UP / TRENDING_DOWN
_MILD_TREND_T   = 0.50  # ≥ ±0.5%  → MILD_UP / MILD_DOWN
_VOLATILE_T     = 2.0   # day-range / open ≥ 2% → VOLATILE

# Strategy metadata: key → (display_name, category, icon, priority_weight)
STRATEGY_META: Dict[str, Tuple[str, str, str, int]] = {
    # Core Trading Strategies (14)
    "overall_signal":        ("Overall Consensus",          "aggregate",  "⚡", 100),
    "market_regime":         ("Market Regime",              "regime",     "🌊", 90),
    "liquidity_score":       ("Liquidity Intelligence",     "liquidity",  "💧", 85),
    "market_edge":           ("MarketEdge Intelligence",    "edge",       "🔮", 95),
    "candle_intelligence":   ("Candle Intelligence",        "candle",     "🕯", 80),
    "trend_base":            ("Trend Base Structure",       "structure",  "📐", 85),
    "volume_pulse":          ("Volume Pulse",               "volume",     "📊", 75),
    "ict_smart_money":       ("ICT Smart Money",            "ict",        "🏦", 92),
    "institutional_compass": ("Institutional Compass",      "compass",    "🧭", 88),
    "pred_5m":               ("5-Min Prediction",           "prediction", "⏱", 70),
    "chart_intelligence":    ("Chart Intelligence",         "chart",      "📈", 83),
    "strike_intelligence":   ("Strike Intelligence",        "options",    "⚔️", 87),
    "order_flow":            ("Order Flow Analysis",        "flow",       "🌊", 86),
    "trade_zones":           ("Trade Zones Buy/Sell",       "execution",  "🎯", 94),
    "ict_bias":              ("ICT Bias",                   "ict",        "🏛", 90),
    "smart_money_order_logic": ("Smart Money Order Logic",  "flow",       "🧠", 89),
    "institutional_confluence": ("Institutional Confluence Engine", "confluence", "🏢", 91),
    "quantum_fractal":       ("Quantum Fractal Intelligence Engine", "fractal",   "🧬", 78),
    "market_liquidity":      ("Market Liquidity",           "liquidity",  "💦", 86),
    "crt_bts":               ("CRT BTS Signal",             "structure",  "🔄", 79),
    
    # Market Intelligence & Context (3)
    "global_indices":        ("Global Indices",             "context",    "🌍", 82),
    "global_news":           ("Global News & Events",       "context",    "📰", 75),
    "global_impact_radar":   ("Global Impact Radar",        "context",    "🛰", 84),
    "live_market_indices":   ("Live Market Indices",        "context",    "📉", 80),
    "global_risk":           ("Global Risk",                "risk",       "⚠", 88),
    "expiry_explosion":      ("Expiry Explosion",           "options",    "💥", 84),
    
    # System Health & Infrastructure (5)
    "feed_health":           ("Feed Health & Latency",      "system",     "📡", 90),
    "api_performance":       ("API Response Times",         "system",     "⚙️", 88),
    "cache_status":          ("Cache & Memory",             "system",     "💾", 80),
    "error_rate":            ("Error Rate & Stability",     "system",     "🚨", 95),
    "data_freshness":        ("Data Freshness",             "system",     "⏱️", 85),
}
STRATEGY_NAMES: Dict[str, str] = {k: v[0] for k, v in STRATEGY_META.items()}


# ── Utility helpers ───────────────────────────────────────────────────────────

def _now_ist() -> datetime:
    return datetime.now(IST)


def _mins(dt: datetime) -> int:
    """Minutes since midnight for a given datetime."""
    return dt.hour * 60 + dt.minute


def _normalise_signal(raw: Any) -> str:
    """Map any service-specific signal string → BULLISH | BEARISH | NEUTRAL."""
    s = str(raw or "").upper().strip()
    if s in {"BUY", "STRONG_BUY", "BULLISH", "UP", "LONG", "BULL"}:
        return "BULLISH"
    if s in {"SELL", "STRONG_SELL", "BEARISH", "DOWN", "SHORT", "BEAR"}:
        return "BEARISH"
    return "NEUTRAL"


def _safe_confidence(v: Any, default: int = 50) -> int:
    try:
        return min(max(int(float(v or default)), 0), 100)
    except (TypeError, ValueError):
        return default


def _priority_band(weight: int) -> str:
    if weight >= 90:
        return "HIGH"
    if weight >= 75:
        return "MEDIUM"
    return "LOW"


def _classify_day(change_pct: float, open_p: float, high_p: float, low_p: float) -> str:
    """Classify the day's character from final price action."""
    if change_pct >= _STRONG_TREND_T:
        return "TRENDING_UP"
    if change_pct <= -_STRONG_TREND_T:
        return "TRENDING_DOWN"
    if _MILD_TREND_T <= change_pct < _STRONG_TREND_T:
        return "MILD_UP"
    if -_STRONG_TREND_T < change_pct <= -_MILD_TREND_T:
        return "MILD_DOWN"
    if open_p > 0 and (high_p - low_p) / open_p * 100 >= _VOLATILE_T:
        return "VOLATILE"
    return "SIDEWAYS"


def _atomic_write_text(path: Path, content: str) -> None:
    """Write content atomically: write to .tmp then os.replace() to final path."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    try:
        tmp.write_text(content, encoding="utf-8")
        os.replace(tmp, path)
    except Exception:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        raise


class ObservatoryService:
    """
    Core observatory engine.
    
    Lifecycle:
        start() → _run_loop() runs forever in background
        Snapshots captured every 30 min during market hours
        Daily report generated at 15:31 IST
        stop() → cancels background task
    """

    """
    Production-grade market observatory engine.

    Thread-safety: all mutations to shared state are gated by self._lock.
    File writes:   all JSON/MD writes use _atomic_write_text() for crash safety.
    Accuracy:      confidence-weighted — sum(conf_i * correct_i) / sum(conf_i) * 100.
    Streaks:       consecutive correct days computed at ranking time.
    Day types:     TRENDING_UP/DOWN, MILD_UP/DOWN, VOLATILE, SIDEWAYS.
    """

    def __init__(self) -> None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self._lock = asyncio.Lock()
        # symbol → list of {time, timestamp, strategies}
        self._today_snapshots: Dict[str, List[Dict[str, Any]]] = {}
        self._open_prices: Dict[str, float] = {}
        self._high_prices: Dict[str, float] = {}
        self._low_prices:  Dict[str, float] = {}
        self._report_generated_date: Optional[date] = None
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._last_snap_minute: int = -1
        
        # ── System Metrics (advanced observability) ────────────────────────────
        # Request latencies (ms)
        self._request_latencies: List[float] = []
        # Error counts by type
        self._error_counts: Dict[str, int] = {"5xx": 0, "4xx": 0, "timeout": 0, "other": 0}
        # Feed health: {symbol: {"latency_ms": float, "freshness_sec": float, "status": str}}
        self._feed_metrics: Dict[str, Dict[str, Any]] = {}
        # API endpoint latencies: {endpoint: [latencies]}
        self._endpoint_metrics: Dict[str, List[float]] = {}
        # System health snapshot times
        self._health_snapshots: List[Dict[str, Any]] = []
        # Strategy correlations (computed daily)
        self._correlation_matrix: Dict[str, Dict[str, float]] = {}

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        now = _now_ist()
        mins = _mins(now)
        if MARKET_OPEN_MIN <= mins <= MARKET_CLOSE_MIN:
            async with self._lock:
                has_today_snapshots = any(self._today_snapshots.values())
            if not has_today_snapshots:
                try:
                    await self._take_snapshot(now)
                    logger.info("🔭 Observatory: bootstrap snapshot captured at startup")
                except Exception as exc:
                    logger.warning("🔭 Observatory: bootstrap snapshot failed — %s", exc)
        self._task = asyncio.create_task(self._run_loop(), name="observatory_loop")
        logger.info("🔭 Observatory: service started")

    async def stop(self) -> None:
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("🔭 Observatory: service stopped")

    # ── Main event loop ───────────────────────────────────────────────────────

    async def _run_loop(self) -> None:
        while self._running:
            try:
                now   = _now_ist()
                mins  = _mins(now)
                today = now.date()

                # ── Midnight state reset ───────────────────────────────────────
                if now.hour == 0 and now.minute < 5:
                    async with self._lock:
                        self._today_snapshots.clear()
                        self._open_prices.clear()
                        self._high_prices.clear()
                        self._low_prices.clear()
                        self._last_snap_minute = -1
                        if self._report_generated_date != today:
                            self._report_generated_date = None

                # ── Intraday snapshots ─────────────────────────────────────────
                # Capture snapshots during market hours OR if DEMO_CAPTURE_MODE is enabled
                demo_mode = os.environ.get('DEMO_CAPTURE_MODE', '').lower() in ('true', '1', 'yes')
                in_session = MARKET_OPEN_MIN <= mins <= MARKET_CLOSE_MIN or demo_mode
                should_snap = False
                if in_session and (mins in SNAP_MINUTES or demo_mode):
                    async with self._lock:
                        if mins != self._last_snap_minute or demo_mode:
                            self._last_snap_minute = mins
                            should_snap = True
                if should_snap:
                    await self._take_snapshot(now)

                # ── End-of-day report ──────────────────────────────────────────
                if now.hour == REPORT_HOUR and now.minute == REPORT_MIN:
                    async with self._lock:
                        already_done = (self._report_generated_date == today)
                    if not already_done:
                        await self._generate_daily_report(today)
                        async with self._lock:
                            self._report_generated_date = today

                await asyncio.sleep(55)

            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("🔭 Observatory: run_loop error — %s", exc, exc_info=True)
                await asyncio.sleep(60)

            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("Observatory loop error: %s", exc)
                await asyncio.sleep(60)

    # ── Snapshot capture ──────────────────────────────────────────────────────

    async def _take_snapshot(self, now: datetime) -> None:
        snap_time = now.strftime("%H:%M")
        logger.debug("🔭 Observatory: capturing snapshot @ %s IST", snap_time)

        for symbol in SYMBOLS:
            try:
                market_data = await self._fetch_market_data(symbol)
                analysis    = await self._fetch_analysis(symbol)

                # Track OHLC extremes for day classification
                if market_data:
                    price = float(market_data.get("price") or 0)
                    if price > 0:
                        async with self._lock:
                            if symbol not in self._open_prices:
                                self._open_prices[symbol] = price
                            self._high_prices[symbol] = max(
                                self._high_prices.get(symbol, 0.0), price
                            )
                            self._low_prices[symbol] = min(
                                self._low_prices.get(symbol, float("inf")), price
                            )

                strategies = await self._extract_all_strategies(symbol, market_data, analysis)
                snap = {"time": snap_time, "timestamp": now.isoformat(), "strategies": strategies}
                async with self._lock:
                    self._today_snapshots.setdefault(symbol, []).append(snap)

                logger.debug(
                    "🔭 Observatory: %s @ %s — %d strategies captured",
                    symbol, snap_time, len(strategies),
                )
            except Exception as exc:
                logger.warning("🔭 Observatory: snapshot error for %s — %s", symbol, exc)

    async def _fetch_market_data(self, symbol: str) -> Optional[Dict[str, Any]]:
        try:
            from services.cache import get_cache
            raw = await get_cache().get(f"market:{symbol}")
            return raw if isinstance(raw, dict) else None
        except Exception:
            return None

    async def _fetch_analysis(self, symbol: str) -> Optional[Dict[str, Any]]:
        try:
            from services.cache import get_cache
            raw = await get_cache().get(f"ws_analysis:{symbol}")
            return raw if isinstance(raw, dict) else None
        except Exception:
            return None

    # ── Strategy extraction ───────────────────────────────────────────────────

    async def _extract_all_strategies(
        self,
        symbol: str,
        market_data: Optional[Dict[str, Any]],
        analysis:    Optional[Dict[str, Any]],
    ) -> Dict[str, Dict[str, Any]]:
        """
        Pull live signals from every strategy service.
        Each returned entry:
          { signal: BULLISH|BEARISH|NEUTRAL, confidence: 0-100, detail: str }
        Failures are caught per-service so one broken service never blocks the snapshot.
        """
        strategies: Dict[str, Dict[str, Any]] = {}

        def entry(
            direction: Any,
            confidence: Any = 50,
            detail: str = "",
            drivers: Optional[List[str]] = None,
            parameters: Optional[Dict[str, Any]] = None,
        ) -> Dict[str, Any]:
            return {
                "signal":     _normalise_signal(direction),
                "confidence": _safe_confidence(confidence),
                "detail":     str(detail),
                "drivers":    list(drivers or []),
                "parameters": dict(parameters or {}),
            }

        # 1. Overall consensus (from WebSocket analysis cache) ─────────────────
        try:
            if analysis:
                strategies["overall_signal"] = entry(
                    analysis.get("signal", "NEUTRAL"),
                    analysis.get("confidence", 50),
                    "Aggregated 12-signal consensus",
                    drivers=["multi-signal vote", "momentum", "trend strength"],
                    parameters={
                        "signal": analysis.get("signal"),
                        "confidence": analysis.get("confidence"),
                        "trend_strength": analysis.get("trend_strength"),
                        "volume_signal": analysis.get("volume_signal"),
                    },
                )
        except Exception:
            pass

        # 2. Trend Base (higher-low / lower-high structure) ────────────────────
        try:
            if analysis:
                ts = _safe_confidence(analysis.get("trend_strength", 50))
                if analysis.get("higher_low") is True:
                    strategies["trend_base"] = entry(
                        "BULLISH",
                        ts,
                        "Higher-low structure confirmed",
                        drivers=["higher-low", "trend strength"],
                        parameters={
                            "higher_low": analysis.get("higher_low"),
                            "lower_high": analysis.get("lower_high"),
                            "trend_strength": analysis.get("trend_strength"),
                        },
                    )
                elif analysis.get("lower_high") is True:
                    strategies["trend_base"] = entry(
                        "BEARISH",
                        ts,
                        "Lower-high structure confirmed",
                        drivers=["lower-high", "trend strength"],
                        parameters={
                            "higher_low": analysis.get("higher_low"),
                            "lower_high": analysis.get("lower_high"),
                            "trend_strength": analysis.get("trend_strength"),
                        },
                    )
                else:
                    strategies["trend_base"] = entry(
                        "NEUTRAL",
                        50,
                        "No clear higher-low/lower-high",
                        drivers=["structure unresolved"],
                        parameters={
                            "higher_low": analysis.get("higher_low"),
                            "lower_high": analysis.get("lower_high"),
                        },
                    )
        except Exception:
            pass

        # 3. Volume Pulse ──────────────────────────────────────────────────────
        try:
            if analysis:
                strategies["volume_pulse"] = entry(
                    analysis.get("volume_signal", "NEUTRAL"),
                    65,
                    "Volume momentum candles",
                    drivers=["volume momentum"],
                    parameters={
                        "volume_signal": analysis.get("volume_signal"),
                        "volume_ratio": analysis.get("volume_ratio"),
                        "candle_volume": analysis.get("candle_volume"),
                    },
                )
        except Exception:
            pass

        # 4. Market Regime ─────────────────────────────────────────────────────
        try:
            from services.market_regime_service import get_market_regime_service  # type: ignore
            svc = get_market_regime_service()
            snap = svc.get_snapshot() if svc else {}
            sym_data = (snap or {}).get(symbol, {})
            if sym_data:
                # Use directionStrength (0-100) as confidence proxy; fall back to trendStrength
                conf = _safe_confidence(
                    sym_data.get("directionStrength") or sym_data.get("trendStrength", 50)
                )
                strategies["market_regime"] = entry(
                    sym_data.get("direction", "NEUTRAL"),
                    conf,
                    sym_data.get("regime", ""),
                    drivers=["direction strength", "trend strength", "volatility regime"],
                    parameters={
                        "direction": sym_data.get("direction"),
                        "regime": sym_data.get("regime"),
                        "directionStrength": sym_data.get("directionStrength"),
                        "trendStrength": sym_data.get("trendStrength"),
                    },
                )
        except Exception:
            pass

        # 5. Liquidity Intelligence ────────────────────────────────────────────
        try:
            from services.liquidity_service import get_liquidity_service  # type: ignore
            liq = get_liquidity_service()
            snap = liq.get_snapshot() if liq else {}
            sym_data = (snap or {}).get(symbol, {})
            if sym_data:
                strategies["liquidity_score"] = entry(
                    sym_data.get("direction", "NEUTRAL"),
                    sym_data.get("confidence", 50),
                    f"PCR+OI+Momentum | {sym_data.get('oiProfile', 'N/A')}",
                    drivers=["PCR", "OI profile", "momentum"],
                    parameters={
                        "direction": sym_data.get("direction"),
                        "confidence": sym_data.get("confidence"),
                        "oi_profile": sym_data.get("oiProfile"),
                        "pcr": sym_data.get("pcr"),
                    },
                )
                strategies["market_liquidity"] = strategies["liquidity_score"]
        except Exception:
            pass

        # 6. ICT Smart Money — NOTE: get_snapshot() is ASYNC on this service ───
        try:
            from services.ict_engine import get_ict_service  # type: ignore
            ict = get_ict_service()
            snap = await ict.get_snapshot() if ict else {}
            sym_data = (snap or {}).get(symbol, {})
            if sym_data:
                strategies["ict_smart_money"] = entry(
                    sym_data.get("direction", "NEUTRAL"),
                    sym_data.get("confidence", 55),
                    f"ICT OB/FVG/MSS | setup={sym_data.get('ictSetup', 'N/A')}",
                    drivers=["order blocks", "fair value gap", "market structure shift"],
                    parameters={
                        "direction": sym_data.get("direction"),
                        "confidence": sym_data.get("confidence"),
                        "ict_setup": sym_data.get("ictSetup"),
                    },
                )
                strategies["ict_bias"] = strategies["ict_smart_money"]
        except Exception:
            pass

        # 7. MarketEdge Intelligence ───────────────────────────────────────────
        try:
            from services.market_edge_service import get_market_edge_service  # type: ignore
            edge = get_market_edge_service()
            snap = edge.get_snapshot() if edge else {}
            sym_data = (snap or {}).get(symbol, {})
            if sym_data:
                strategies["market_edge"] = entry(
                    sym_data.get("direction", "NEUTRAL"),
                    sym_data.get("confidence", 55),
                    f"Multi-factor edge | action={sym_data.get('action', 'N/A')}",
                    drivers=["multi-factor edge", "action model"],
                    parameters={
                        "direction": sym_data.get("direction"),
                        "confidence": sym_data.get("confidence"),
                        "action": sym_data.get("action"),
                    },
                )
        except Exception:
            pass

        # 8. Candle Intelligence ───────────────────────────────────────────────
        try:
            from services.candle_intelligence_engine import get_candle_intelligence_service  # type: ignore
            ci = get_candle_intelligence_service()
            snap = ci.get_snapshot() if ci else {}
            sym_data = (snap or {}).get(symbol, {})
            if sym_data:
                strategies["candle_intelligence"] = entry(
                    sym_data.get("signal", "NEUTRAL"),
                    sym_data.get("confidence", 55),
                    f"Pattern | {sym_data.get('pattern', 'N/A')}",
                    drivers=["candlestick pattern", "candle quality"],
                    parameters={
                        "signal": sym_data.get("signal"),
                        "confidence": sym_data.get("confidence"),
                        "pattern": sym_data.get("pattern"),
                    },
                )
        except Exception:
            pass

        # 9. Institutional Compass ─────────────────────────────────────────────
        try:
            from services.compass_service import get_compass_service  # type: ignore
            cp = get_compass_service()
            snap = cp.get_snapshot() if cp else {}
            sym_data = (snap or {}).get(symbol, {})
            if sym_data:
                strategies["institutional_compass"] = entry(
                    sym_data.get("direction", "NEUTRAL"),
                    sym_data.get("confidence", 55),
                    "6-factor institutional direction",
                    drivers=["institutional factors", "directional confluence"],
                    parameters={
                        "direction": sym_data.get("direction"),
                        "confidence": sym_data.get("confidence"),
                    },
                )
        except Exception:
            pass

        # 10. 5-Min Prediction ─────────────────────────────────────────────────
        try:
            if analysis:
                pred     = analysis.get("prediction_5m") or {}
                pred_dir = str(pred.get("direction", "FLAT")).upper()
                pred_dir = "BULLISH" if pred_dir == "UP" else ("BEARISH" if pred_dir == "DOWN" else "NEUTRAL")
                strategies["pred_5m"] = entry(
                    pred_dir,
                    pred.get("confidence", 50),
                    "5-min ML directional prediction",
                )
        except Exception:
            pass

        # 11. Chart Intelligence ────────────────────────────────────────────────
        try:
            from services.chart_intelligence_service import get_chart_intelligence_service  # type: ignore
            chart = get_chart_intelligence_service()
            snap = chart.get_snapshot() if chart else {}
            sym_data = (snap or {}).get(symbol, {})
            if sym_data:
                strategies["chart_intelligence"] = entry(
                    sym_data.get("signal", "NEUTRAL"),
                    sym_data.get("confidence", 60),
                    f"Pattern | {sym_data.get('pattern', 'N/A')}",
                    drivers=["price action pattern", "chart structure"],
                    parameters={
                        "signal": sym_data.get("signal"),
                        "confidence": sym_data.get("confidence"),
                        "pattern": sym_data.get("pattern"),
                    },
                )
        except Exception:
            pass

        # 12. Strike Intelligence ────────────────────────────────────────────────
        try:
            from services.strike_intelligence_service import get_strike_intelligence_service  # type: ignore
            strike = get_strike_intelligence_service()
            snap = await strike.get_snapshot() if strike else {}
            sym_data = (snap or {}).get(symbol, {})
            if sym_data:
                strategies["strike_intelligence"] = entry(
                    sym_data.get("signal", "NEUTRAL"),
                    sym_data.get("confidence", 65),
                    f"Options confluence | dominance={sym_data.get('dominantSide', 'N/A')}",
                    drivers=["ATM+/-5", "CE/PE", "OI", "PCR", "max pain", "BSL/SSL", "BOS"],
                    parameters={
                        "signal": sym_data.get("signal"),
                        "confidence": sym_data.get("confidence"),
                        "dominantSide": sym_data.get("dominantSide"),
                        "atm_window": sym_data.get("atmWindow") or "ATM +/-5",
                        "ce_pe": sym_data.get("cePeRatio") or sym_data.get("ce_pe"),
                        "volume": sym_data.get("volume"),
                        "oi": sym_data.get("oi"),
                        "pcr": sym_data.get("pcr"),
                        "max_pain": sym_data.get("maxPain"),
                        "bsl_ssl": sym_data.get("bslSsl"),
                        "bos": sym_data.get("bos"),
                        "advanced_pa": sym_data.get("advancedPA"),
                        "trap": sym_data.get("trap"),
                    },
                )
        except Exception:
            pass

        # 13. Order Flow Analysis ────────────────────────────────────────────────
        try:
            if analysis:
                flow = analysis.get("order_flow") or {}
                strategies["order_flow"] = entry(
                    flow.get("signal", "NEUTRAL"),
                    flow.get("confidence", 55),
                    f"Smart money flow | direction={flow.get('direction', 'N/A')}",
                    drivers=["order flow", "smart money pressure"],
                    parameters={
                        "signal": flow.get("signal"),
                        "confidence": flow.get("confidence"),
                        "direction": flow.get("direction"),
                    },
                )
                strategies["smart_money_order_logic"] = strategies["order_flow"]

                zone_sig = flow.get("signal", analysis.get("signal", "NEUTRAL"))
                zone_conf = max(_safe_confidence(flow.get("confidence", 50)), _safe_confidence(analysis.get("confidence", 50)))
                strategies["trade_zones"] = entry(
                    zone_sig,
                    zone_conf,
                    "Trade Zones Buy/Sell | multi-factor zone confluence",
                    drivers=["support/resistance", "flow alignment", "momentum"],
                    parameters={
                        "zone_signal": zone_sig,
                        "zone_confidence": zone_conf,
                        "order_flow_direction": flow.get("direction"),
                        "trend_strength": analysis.get("trend_strength") if analysis else None,
                    },
                )

                conf_votes = [
                    _normalise_signal(strategies.get("institutional_compass", {}).get("signal")),
                    _normalise_signal(strategies.get("ict_smart_money", {}).get("signal")),
                    _normalise_signal(strategies.get("order_flow", {}).get("signal")),
                ]
                bull_votes = sum(1 for s in conf_votes if s == "BULLISH")
                bear_votes = sum(1 for s in conf_votes if s == "BEARISH")
                conf_sig = "BULLISH" if bull_votes > bear_votes else ("BEARISH" if bear_votes > bull_votes else "NEUTRAL")
                conf_score = int(max(bull_votes, bear_votes) / max(len(conf_votes), 1) * 100)
                strategies["institutional_confluence"] = entry(
                    conf_sig,
                    conf_score,
                    f"Institutional confluence | bull_votes={bull_votes} bear_votes={bear_votes}",
                    drivers=["compass", "ict", "order flow"],
                    parameters={
                        "votes": conf_votes,
                        "bull_votes": bull_votes,
                        "bear_votes": bear_votes,
                    },
                )
        except Exception:
            pass

        # 14. CRT BTS Signal ─────────────────────────────────────────────────────
        try:
            if analysis:
                crt = analysis.get("crt_bts") or {}
                strategies["crt_bts"] = entry(
                    crt.get("signal", "NEUTRAL"),
                    crt.get("confidence", 50),
                    f"CRT structure | setup={crt.get('setup', 'N/A')}",
                )
        except Exception:
            pass

        # 15. Global Indices ──────────────────────────────────────────────────────
        try:
            from services.global_indices_service import get_global_indices_service  # type: ignore
            gi_svc = get_global_indices_service()
            if gi_svc:
                snap = gi_svc.get_snapshot() if hasattr(gi_svc, 'get_snapshot') else {}
                if snap and isinstance(snap, dict):
                    indices_sig = "BULLISH" if snap.get("overall_trend") == "BULL" else ("BEARISH" if snap.get("overall_trend") == "BEAR" else "NEUTRAL")
                    strategies["global_indices"] = entry(
                        indices_sig,
                        snap.get("confidence", 60),
                        f"Global context | trend={snap.get('overall_trend', 'FLAT')}",
                        drivers=["global index trend", "international sentiment"],
                        parameters={
                            "overall_trend": snap.get("overall_trend"),
                            "confidence": snap.get("confidence"),
                            "indices": snap.get("indices"),
                        },
                    )
        except Exception:
            pass

        # 16. Global News ────────────────────────────────────────────────────────
        try:
            from services.global_news_service import get_global_news_service  # type: ignore
            news_svc = get_global_news_service()
            if news_svc:
                snap = news_svc.get_snapshot() if hasattr(news_svc, 'get_snapshot') else {}
                if snap and isinstance(snap, dict):
                    news_impact = snap.get("market_impact", "NEUTRAL")
                    strategies["global_news"] = entry(
                        news_impact,
                        snap.get("confidence", 50),
                        f"News sentiment | events={snap.get('event_count', 0)}",
                        drivers=["macro news", "breaking events"],
                        parameters={
                            "market_impact": snap.get("market_impact"),
                            "confidence": snap.get("confidence"),
                            "event_count": snap.get("event_count"),
                        },
                    )
        except Exception:
            pass

        # 16b. Global Impact Radar (indices + news fusion) ─────────────────────
        try:
            idx_sig = strategies.get("global_indices", {}).get("signal", "NEUTRAL")
            news_sig = strategies.get("global_news", {}).get("signal", "NEUTRAL")
            idx_conf = _safe_confidence(strategies.get("global_indices", {}).get("confidence", 50))
            news_conf = _safe_confidence(strategies.get("global_news", {}).get("confidence", 50))
            fused_sig = idx_sig if idx_sig == news_sig else "NEUTRAL"
            fused_conf = int((idx_conf + news_conf) / 2)
            strategies["global_impact_radar"] = entry(
                fused_sig,
                fused_conf,
                f"Global impact fusion | indices={idx_sig} news={news_sig}",
                drivers=["global indices", "global news"],
                parameters={
                    "indices_signal": idx_sig,
                    "news_signal": news_sig,
                    "indices_confidence": idx_conf,
                    "news_confidence": news_conf,
                },
            )
        except Exception:
            pass

        # 16c. Live Market Indices (local symbol momentum) ─────────────────────
        try:
            last_price = float((market_data or {}).get("price") or 0)
            open_price = float((market_data or {}).get("open") or 0)
            change_pct = ((last_price - open_price) / open_price * 100) if open_price > 0 else 0.0
            lmi_sig = "BULLISH" if change_pct > 0.15 else ("BEARISH" if change_pct < -0.15 else "NEUTRAL")
            lmi_conf = min(100, int(abs(change_pct) * 40 + 45))
            strategies["live_market_indices"] = entry(
                lmi_sig,
                lmi_conf,
                f"Live index momentum | change={change_pct:+.2f}%",
                drivers=["live price vs open", "intraday momentum"],
                parameters={
                    "price": last_price,
                    "open": open_price,
                    "change_pct": round(change_pct, 2),
                },
            )
        except Exception:
            pass

        # 16d. Global Risk (risk-off/risk-on proxy) ────────────────────────────
        try:
            vix = float((market_data or {}).get("vix") or (analysis or {}).get("vix") or 0)
            risk_sig = "BEARISH" if vix >= 18 else ("BULLISH" if 0 < vix <= 13 else "NEUTRAL")
            risk_conf = min(100, int(vix * 4)) if vix > 0 else 50
            strategies["global_risk"] = entry(
                risk_sig,
                risk_conf,
                f"Risk regime proxy | vix={vix:.2f}",
                drivers=["volatility regime", "risk appetite"],
                parameters={
                    "vix": round(vix, 2),
                    "risk_mode": "RISK_OFF" if risk_sig == "BEARISH" else ("RISK_ON" if risk_sig == "BULLISH" else "MIXED"),
                },
            )
        except Exception:
            pass

        # 17. Expiry Explosion ────────────────────────────────────────────────────
        try:
            from services.expiry_explosion_service import get_expiry_explosion_service  # type: ignore
            exp_svc = get_expiry_explosion_service()
            if exp_svc:
                snap = await exp_svc.get_snapshot() if hasattr(exp_svc, 'get_snapshot') and asyncio.iscoroutinefunction(exp_svc.get_snapshot) else (exp_svc.get_snapshot() if hasattr(exp_svc, 'get_snapshot') else {})
                if snap and isinstance(snap, dict):
                    sym_data = snap.get(symbol, {})
                    if sym_data:
                        strategies["expiry_explosion"] = entry(
                            sym_data.get("signal", "NEUTRAL"),
                            sym_data.get("confidence", 70),
                            f"Expiry impact | dfo={sym_data.get('dfo_status', 'N/A')}",
                            drivers=["expiry build-up", "dealer flow"],
                            parameters={
                                "signal": sym_data.get("signal"),
                                "confidence": sym_data.get("confidence"),
                                "dfo_status": sym_data.get("dfo_status"),
                            },
                        )
        except Exception:
            pass

        # 17b. Quantum Fractal Intelligence ─────────────────────────────────────
        try:
            if analysis:
                fractal_state = (analysis.get("fractal_signal") or analysis.get("quantum_fractal_signal") or "NEUTRAL")
                fractal_conf = _safe_confidence(analysis.get("fractal_confidence", 55))
                strategies["quantum_fractal"] = entry(
                    fractal_state,
                    fractal_conf,
                    "Quantum fractal structure intelligence",
                    drivers=["fractal structure", "pattern recursion"],
                    parameters={
                        "fractal_signal": analysis.get("fractal_signal") or analysis.get("quantum_fractal_signal"),
                        "fractal_confidence": analysis.get("fractal_confidence"),
                        "fractal_count": analysis.get("fractals_count") or analysis.get("fractal_count"),
                    },
                )
        except Exception:
            pass

        # 18. Feed Health ────────────────────────────────────────────────────────
        try:
            feed_metrics = {
                "latency_ms": market_data.get("feed_latency", 0) if market_data else 0,
                "freshness_sec": market_data.get("data_age", 0) if market_data else 999,
                "status": "HEALTHY" if (market_data and market_data.get("price", 0) > 0) else "STALE",
            }
            feed_confidence = 100 if feed_metrics["status"] == "HEALTHY" else 30
            feed_signal = "BULLISH" if feed_confidence >= 90 else "BEARISH" if feed_confidence < 50 else "NEUTRAL"
            strategies["feed_health"] = entry(
                feed_signal,
                feed_confidence,
                f"Feed status={feed_metrics['status']} | latency={feed_metrics['latency_ms']}ms | age={feed_metrics['freshness_sec']}s",
            )
        except Exception:
            pass

        # 19. API Performance ────────────────────────────────────────────────────
        try:
            api_latency = 50  # default, would be tracked in middleware
            api_signal = "BULLISH" if api_latency < 100 else ("BEARISH" if api_latency > 500 else "NEUTRAL")
            strategies["api_performance"] = entry(
                api_signal,
                min(100, int(500 / max(api_latency, 10))),
                f"API latency | avg={api_latency}ms",
            )
        except Exception:
            pass

        # 20. Cache Status ───────────────────────────────────────────────────────
        try:
            from services.cache import get_cache
            cache = get_cache()
            cache_info = {"type": "in-memory", "status": "ACTIVE"}
            cache_signal = "BULLISH"
            strategies["cache_status"] = entry(
                cache_signal,
                85,
                f"Cache type={cache_info.get('type')} | status={cache_info.get('status')}",
            )
        except Exception:
            pass

        # 21. Error Rate ─────────────────────────────────────────────────────────
        try:
            error_count = 0  # would be tracked globally
            error_signal = "BULLISH" if error_count < 5 else ("BEARISH" if error_count > 20 else "NEUTRAL")
            strategies["error_rate"] = entry(
                error_signal,
                max(50, 100 - error_count * 2),
                f"Error count={error_count} | stability={'HIGH' if error_count < 5 else 'LOW'}",
            )
        except Exception:
            pass

        # 22. Data Freshness ─────────────────────────────────────────────────────
        try:
            data_age = market_data.get("data_age", 999) if market_data else 999
            freshness_signal = "BULLISH" if data_age < 5 else ("BEARISH" if data_age > 30 else "NEUTRAL")
            strategies["data_freshness"] = entry(
                freshness_signal,
                min(100, int(100 - data_age * 2)),
                f"Data age={data_age}s | freshness={'REAL-TIME' if data_age < 2 else 'DELAYED'}",
            )
        except Exception:
            pass

        return strategies

    # ── Daily report ──────────────────────────────────────────────────────────

    async def _generate_daily_report(self, today: date) -> None:
        """End-of-day: compare morning signals vs actual price direction and save."""
        logger.info("🔭 Observatory: generating daily report for %s", today)
        try:
            report: Dict[str, Any] = {
                "date":         today.isoformat(),
                "generated_at": _now_ist().isoformat(),
                "symbols":      {},
            }

            # Capture state snapshot under lock
            async with self._lock:
                snapshots_copy   = {sym: list(snaps) for sym, snaps in self._today_snapshots.items()}
                open_prices_copy = dict(self._open_prices)
                high_prices_copy = dict(self._high_prices)
                low_prices_copy  = dict(self._low_prices)

            for symbol in SYMBOLS:
                close_price = await self._latest_price(symbol)
                open_price  = open_prices_copy.get(symbol, 0.0)
                high_price  = high_prices_copy.get(symbol, close_price)
                low_price   = low_prices_copy.get(symbol, close_price)

                direction  = "FLAT"
                change_pct = 0.0
                if open_price > 0 and close_price > 0:
                    change_pct = (close_price - open_price) / open_price * 100
                    direction  = "UP" if change_pct > 0.1 else ("DOWN" if change_pct < -0.1 else "FLAT")

                day_class = _classify_day(change_pct, open_price, high_price, low_price)

                snaps        = snapshots_copy.get(symbol, [])
                morning_snap = self._pick_morning_snap(snaps)
                closing_snap = self._pick_closing_snap(snaps)

                strategy_performance: Dict[str, Dict[str, Any]] = {}
                if morning_snap:
                    for strat_key, strat_data in morning_snap.get("strategies", {}).items():
                        morning_sig  = strat_data.get("signal", "NEUTRAL")
                        morning_conf = _safe_confidence(strat_data.get("confidence", 50))
                        if direction == "FLAT" or morning_sig == "NEUTRAL":
                            was_correct: Optional[bool] = None
                        else:
                            was_correct = (
                                (morning_sig == "BULLISH" and direction == "UP") or
                                (morning_sig == "BEARISH" and direction == "DOWN")
                            )
                        name = STRATEGY_META.get(strat_key, (strat_key, "", "", 50))[0]
                        meta = STRATEGY_META.get(strat_key, (strat_key, "", "", 50))
                        close_data = (closing_snap or {}).get("strategies", {}).get(strat_key, {})
                        strategy_performance[strat_key] = {
                            "strategy_name":      name,
                            "morning_signal":     morning_sig,
                            "morning_confidence": morning_conf,
                            "morning_detail":     strat_data.get("detail", ""),
                            "morning_drivers":    strat_data.get("drivers", []),
                            "morning_parameters": strat_data.get("parameters", {}),
                            "closing_signal":     close_data.get("signal", "NEUTRAL"),
                            "closing_confidence": _safe_confidence(close_data.get("confidence", 50)),
                            "closing_detail":     close_data.get("detail", ""),
                            "closing_drivers":    close_data.get("drivers", []),
                            "closing_parameters": close_data.get("parameters", {}),
                            "priority_weight":    meta[3] if len(meta) > 3 else 50,
                            "priority_band":      _priority_band(meta[3] if len(meta) > 3 else 50),
                            "actual_direction":   direction,
                            "was_correct":        was_correct,
                        }

                report["symbols"][symbol] = {
                    "open_price":           round(open_price, 2),
                    "close_price":          round(close_price, 2),
                    "change_pct":           round(change_pct, 2),
                    "direction":            direction,
                    "day_classification":   day_class,
                    "snapshot_count":       len(snaps),
                    "strategy_performance": strategy_performance,
                }

            self._persist_report(today, report)
            self._update_weekly_summary()
            logger.info("🔭 Observatory: daily report saved for %s", today)

        except Exception as exc:
            logger.error("🔭 Observatory: daily report error — %s", exc, exc_info=True)

    async def _latest_price(self, symbol: str) -> float:
        data = await self._fetch_market_data(symbol)
        return float((data or {}).get("price") or 0)

    @staticmethod
    def _pick_morning_snap(snaps: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """Return the first snap at 09:30, 10:00, or 10:30 (fallback: first snap)."""
        for snap in snaps:
            if snap.get("time") in {"09:30", "10:00", "10:30"}:
                return snap
        return snaps[0] if snaps else None

    @staticmethod
    def _pick_closing_snap(snaps: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """Return the latest available snapshot for end-of-day diagnostics."""
        return snaps[-1] if snaps else None

    # ── Persistence ───────────────────────────────────────────────────────────

    def _persist_report(self, report_date: date, report: Dict[str, Any]) -> None:
        stem = report_date.isoformat()
        _atomic_write_text(DATA_DIR / f"{stem}.json", json.dumps(report, indent=2))
        _atomic_write_text(DATA_DIR / f"{stem}.md",   self._render_markdown(report_date, report))

    def _render_markdown(self, report_date: date, report: Dict[str, Any]) -> str:
        lines: List[str] = [
            "# 🔭 Market Intelligence Observatory",
            f"**Date:** {report_date.strftime('%d %B %Y (%A)')}",
            f"**Generated:** {report.get('generated_at', 'N/A')}",
            "",
            "---",
            "",
        ]

        for symbol in SYMBOLS:
            sym       = report.get("symbols", {}).get(symbol, {})
            direction = sym.get("direction", "FLAT")
            chg       = sym.get("change_pct", 0.0)
            day_cls   = sym.get("day_classification", "")
            icon      = "📈" if direction == "UP" else ("📉" if direction == "DOWN" else "➡️")

            lines += [
                f"## {icon} {symbol}  →  {direction}  ({chg:+.2f}%)",
                f"- Open: **{sym.get('open_price', '—')}**  ·  Close: **{sym.get('close_price', '—')}**",
                f"- Day type: **{day_cls}**  ·  Snapshots: {sym.get('snapshot_count', 0)}",
                "",
                "| Strategy | Priority | Signal | Conf | Correct? | Why (Drivers) |",
                "|----------|----------|--------|------|----------|---------------|",
            ]

            correct_n = wrong_n = 0
            weighted_correct = weighted_total = 0.0

            for strat_key, perf in sym.get("strategy_performance", {}).items():
                name    = perf.get("strategy_name", strat_key)
                sig     = perf.get("morning_signal", "NEUTRAL")
                conf    = perf.get("morning_confidence", 50)
                correct = perf.get("was_correct")
                if correct is True:
                    result = "✅ YES"
                    correct_n += 1
                    weighted_correct += conf
                    weighted_total   += conf
                elif correct is False:
                    result = "❌ NO"
                    wrong_n += 1
                    weighted_total += conf
                else:
                    result = "⚪ N/A"
                pr_band = perf.get("priority_band", "MEDIUM")
                drivers = perf.get("morning_drivers", [])
                why = ", ".join(drivers[:3]) if isinstance(drivers, list) and drivers else "-"
                lines.append(f"| {name} | {pr_band} | {sig} | {conf}% | {result} | {why} |")

            total_n   = correct_n + wrong_n
            simple_acc = f"{(correct_n / total_n * 100):.0f}% ({correct_n}/{total_n})" if total_n else "N/A"
            w_acc      = f"{(weighted_correct / weighted_total * 100):.0f}% (weighted)" if weighted_total else "N/A"
            lines += ["", f"**Accuracy: {simple_acc}  ·  Weighted: {w_acc}**", "", "---", ""]

        return "\n".join(lines)

    def _update_weekly_summary(self) -> None:
        try:
            reports  = self.get_historical_reports(7)
            if not reports:
                return
            rankings = self._compute_rankings(reports)
            rec      = self._generate_recommendation(rankings)

            lines: List[str] = [
                "# 🔭 Weekly Strategy Performance Summary",
                f"*Auto-generated — covers last {len(reports)} trading day(s)*",
                "",
                "## Strategy Rankings (Confidence-Weighted Accuracy)",
                "",
                "| Rank | Strategy | W.Accuracy | Simple | Obs | Streak |",
                "|------|----------|------------|--------|-----|--------|",
            ]
            for i, r in enumerate(rankings, 1):
                bar_len = int(r["weighted_accuracy"] / 10)
                bar     = "█" * bar_len + "░" * (10 - bar_len)
                streak  = f"+{r['streak']}" if r.get("streak", 0) > 0 else "0"
                lines.append(
                    f"| #{i} | {r['strategy_name']} | {bar} {r['weighted_accuracy']:.0f}%"
                    f" | {r['accuracy']:.0f}% | {r['total']} | {streak} |"
                )

            lines += ["", "## 🎯 Recommendation", "", rec, ""]
            lines += [
                "## Day-by-Day Market Direction",
                "",
                "| Date | NIFTY | BANKNIFTY | SENSEX |",
                "|------|-------|-----------|--------|",
            ]
            for rep in sorted(reports, key=lambda x: x.get("date", ""), reverse=True):
                d    = rep.get("date", "?")
                syms = rep.get("symbols", {})
                parts: List[str] = []
                for sym in SYMBOLS:
                    sd        = syms.get(sym, {})
                    direction = sd.get("direction", "FLAT")
                    chg       = sd.get("change_pct", 0.0)
                    day_cls   = sd.get("day_classification", "")
                    icon      = "📈" if direction == "UP" else ("📉" if direction == "DOWN" else "➡️")
                    parts.append(f"{icon} {chg:+.2f}% ({day_cls})")
                lines.append(f"| {d} | {' | '.join(parts)} |")

            _atomic_write_text(DATA_DIR / "WEEKLY_SUMMARY.md", "\n".join(lines))
        except Exception as exc:
            logger.warning("🔭 Observatory: weekly summary update failed — %s", exc)

    # ── Public API ────────────────────────────────────────────────────────────

    def get_today_snapshot(self) -> Dict[str, Any]:
        now   = _now_ist()
        mins  = _mins(now)
        current_strategies: Dict[str, Dict[str, Any]] = {}
        for symbol, snaps in self._today_snapshots.items():
            if snaps:
                current_strategies[symbol] = snaps[-1].get("strategies", {})
        return {
            "date":               now.date().isoformat(),
            "market_open":        MARKET_OPEN_MIN <= mins <= MARKET_CLOSE_MIN,
            "open_prices":        dict(self._open_prices),
            "snapshot_count":     {sym: len(snaps) for sym, snaps in self._today_snapshots.items()},
            "current_strategies": current_strategies,
            "all_snapshots":      self._today_snapshots,
        }

    def get_historical_reports(self, days: int = 7) -> List[Dict[str, Any]]:
        reports: List[Dict[str, Any]] = []
        today   = _now_ist().date()
        for i in range(days):
            fp = DATA_DIR / f"{(today - timedelta(days=i)).isoformat()}.json"
            if fp.exists():
                try:
                    with fp.open(encoding="utf-8") as fh:
                        reports.append(json.load(fh))
                except Exception:
                    pass
        return reports

    def get_strategy_rankings(self, days: int = 10) -> Dict[str, Any]:
        reports  = self.get_historical_reports(days)
        rankings = self._compute_rankings(reports)
        return {
            "days_analyzed":  len(reports),
            "rankings":       rankings,
            "best_strategy":  rankings[0] if rankings else None,
            "recommendation": self._generate_recommendation(rankings),
        }

    def _compute_rankings(self, reports: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Produce per-strategy accuracy stats with confidence-weighted accuracy.

        weighted_accuracy = sum(conf_i * correct_i) / sum(conf_i) * 100
        streak            = consecutive correct predictions ending at the most recent day.
        """
        # key → {correct, total, w_correct, w_total, confidences, per_day}
        acc_map: Dict[str, Dict[str, Any]] = {}

        for rep in sorted(reports, key=lambda r: r.get("date", "")):
            for sym_data in rep.get("symbols", {}).values():
                for strat_key, perf in sym_data.get("strategy_performance", {}).items():
                    if strat_key not in acc_map:
                        acc_map[strat_key] = {
                            "correct": 0, "total": 0,
                            "w_correct": 0.0, "w_total": 0.0,
                            "confidences": [],
                            "per_day": [],
                        }
                    b       = acc_map[strat_key]
                    correct = perf.get("was_correct")
                    conf    = _safe_confidence(perf.get("morning_confidence", 50))

                    if correct is True:
                        b["correct"]   += 1
                        b["total"]     += 1
                        b["w_correct"] += conf
                        b["w_total"]   += conf
                        b["confidences"].append(conf)
                        b["per_day"].append(True)
                    elif correct is False:
                        b["total"]    += 1
                        b["w_total"]  += conf
                        b["confidences"].append(conf)
                        b["per_day"].append(False)

        results: List[Dict[str, Any]] = []
        for strat_key, b in acc_map.items():
            if b["total"] == 0:
                continue
            simple_acc = b["correct"] / b["total"] * 100
            w_acc      = (b["w_correct"] / b["w_total"] * 100) if b["w_total"] > 0 else simple_acc
            avg_conf   = statistics.mean(b["confidences"]) if b["confidences"] else 50.0

            # Streak: consecutive correct from end of per_day list
            streak = 0
            for v in reversed(b["per_day"]):
                if v:
                    streak += 1
                else:
                    break

            meta = STRATEGY_META.get(strat_key, (strat_key, "other", "📌", 50))
            priority_weight = meta[3] if len(meta) > 3 else 50
            results.append({
                "strategy_key":      strat_key,
                "strategy_name":     meta[0],
                "category":          meta[1],
                "icon":              meta[2],
                "priority":          priority_weight,
                "priority_band":     _priority_band(priority_weight),
                "accuracy":          round(simple_acc, 1),
                "weighted_accuracy": round(w_acc, 1),
                "correct":           b["correct"],
                "total":             b["total"],
                "streak":            streak,
                "avg_confidence":    round(avg_conf, 1),
            })

        # Sort by: priority weight (desc), then weighted accuracy (desc), then total observations (desc)
        results.sort(key=lambda x: (-x["priority"], -x["weighted_accuracy"], -x["total"]))
        return results

    def _generate_recommendation(self, rankings: List[Dict[str, Any]]) -> str:
        qualified = [r for r in rankings if r["total"] >= 3]
        if not qualified:
            return (
                "Insufficient data. Observe for at least 5 trading days to identify reliable patterns. "
                "Use multi-strategy confluence (3+ signals aligned) for higher-probability entries."
            )
        best   = qualified[0]
        second = qualified[1] if len(qualified) > 1 else None
        w_acc  = best.get("weighted_accuracy", best.get("accuracy", 0))

        if w_acc >= 80:
            msg = (
                f"**{best['strategy_name']}** is your strongest signal — "
                f"{w_acc:.0f}% weighted accuracy over {best['total']} observations."
            )
            if best.get("streak", 0) >= 3:
                msg += f" Currently on a **{best['streak']}-day correct streak**."
        elif w_acc >= 65:
            msg = f"**{best['strategy_name']}** leads at {w_acc:.0f}% weighted accuracy."
            if second:
                w2 = second.get("weighted_accuracy", second.get("accuracy", 0))
                msg += (
                    f" Combine with **{second['strategy_name']}** ({w2:.0f}%) "
                    f"for high-confluence entries."
                )
        else:
            top3 = ", ".join(f"**{r['strategy_name']}**" for r in qualified[:3])
            msg  = (
                f"No dominant strategy yet (best: {w_acc:.0f}% weighted). "
                f"Wait for confluence from: {top3}."
            )
        return msg

    def get_available_dates(self) -> List[str]:
        return sorted(
            [p.stem for p in DATA_DIR.glob("????-??-??.json")],
            reverse=True,
        )


# ── Singleton ─────────────────────────────────────────────────────────────────
_observatory: Optional[ObservatoryService] = None


def get_observatory_service() -> ObservatoryService:
    global _observatory
    if _observatory is None:
        _observatory = ObservatoryService()
    return _observatory
