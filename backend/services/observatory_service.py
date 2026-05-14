"""
🔭 Market Intelligence Observatory Service — Production Grade
=============================================================
Tracks daily performance of ALL trading strategy sections.

Architecture:
  - Captures signal snapshots every 30 min during market hours (9:15–15:30 IST)
  - End-of-day report at 15:31 IST comparing morning signals vs actual direction
  - Confidence-weighted accuracy, streak tracking, day classification
  - asyncio.Lock-protected state mutations, atomic file writes, structured logging

Storage: backend/data/observatory/
  YYYY-MM-DD.json  — machine-readable daily report
  YYYY-MM-DD.md    — human-readable daily report
  WEEKLY_SUMMARY.md — rolling 7-day strategy rankings
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
MARKET_OPEN_MIN  = 555   # 09:15
MARKET_CLOSE_MIN = 930   # 15:30

# End-of-day report trigger
REPORT_HOUR, REPORT_MIN = 15, 31

# Snapshot schedule — 30-min cadence starting at 9:30 IST
SNAP_MINUTES: frozenset = frozenset({570, 600, 630, 660, 690, 720, 750, 780, 810, 840, 870, 900})

# Day classification thresholds (% change)
_STRONG_TREND_T = 1.5   # ≥ ±1.5%  → TRENDING_UP / TRENDING_DOWN
_MILD_TREND_T   = 0.50  # ≥ ±0.5%  → MILD_UP / MILD_DOWN
_VOLATILE_T     = 2.0   # day-range / open ≥ 2% → VOLATILE

# Strategy metadata: key → (display_name, category, icon)
STRATEGY_META: Dict[str, Tuple[str, str, str]] = {
    "overall_signal":        ("Overall Consensus",          "aggregate",  "⚡"),
    "market_regime":         ("Market Regime",              "regime",     "🌊"),
    "liquidity_score":       ("Liquidity Intelligence",     "liquidity",  "💧"),
    "market_edge":           ("MarketEdge Intelligence",    "edge",       "🔮"),
    "candle_intelligence":   ("Candle Intelligence",        "candle",     "🕯"),
    "trend_base":            ("Trend Base Structure",       "structure",  "📐"),
    "volume_pulse":          ("Volume Pulse",               "volume",     "📊"),
    "ict_smart_money":       ("ICT Smart Money",            "ict",        "🏦"),
    "institutional_compass": ("Institutional Compass",      "compass",    "🧭"),
    "pred_5m":               ("5-Min Prediction",           "prediction", "⏱"),
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

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
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
                in_session = MARKET_OPEN_MIN <= mins <= MARKET_CLOSE_MIN
                should_snap = False
                if in_session and mins in SNAP_MINUTES:
                    async with self._lock:
                        if mins != self._last_snap_minute:
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

        def entry(direction: Any, confidence: Any = 50, detail: str = "") -> Dict[str, Any]:
            return {
                "signal":     _normalise_signal(direction),
                "confidence": _safe_confidence(confidence),
                "detail":     str(detail),
            }

        # 1. Overall consensus (from WebSocket analysis cache) ─────────────────
        try:
            if analysis:
                strategies["overall_signal"] = entry(
                    analysis.get("signal", "NEUTRAL"),
                    analysis.get("confidence", 50),
                    "Aggregated 12-signal consensus",
                )
        except Exception:
            pass

        # 2. Trend Base (higher-low / lower-high structure) ────────────────────
        try:
            if analysis:
                ts = _safe_confidence(analysis.get("trend_strength", 50))
                if analysis.get("higher_low") is True:
                    strategies["trend_base"] = entry("BULLISH", ts, "Higher-low structure confirmed")
                elif analysis.get("lower_high") is True:
                    strategies["trend_base"] = entry("BEARISH", ts, "Lower-high structure confirmed")
                else:
                    strategies["trend_base"] = entry("NEUTRAL", 50, "No clear higher-low/lower-high")
        except Exception:
            pass

        # 3. Volume Pulse ──────────────────────────────────────────────────────
        try:
            if analysis:
                strategies["volume_pulse"] = entry(
                    analysis.get("volume_signal", "NEUTRAL"),
                    65,
                    "Volume momentum candles",
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
                )
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
                )
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
                        name = STRATEGY_META.get(strat_key, (strat_key, "", ""))[0]
                        strategy_performance[strat_key] = {
                            "strategy_name":      name,
                            "morning_signal":     morning_sig,
                            "morning_confidence": morning_conf,
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
                "| Strategy | Signal | Conf | Correct? |",
                "|----------|--------|------|----------|",
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
                lines.append(f"| {name} | {sig} | {conf}% | {result} |")

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

            meta = STRATEGY_META.get(strat_key, (strat_key, "other", "📌"))
            results.append({
                "strategy_key":      strat_key,
                "strategy_name":     meta[0],
                "category":          meta[1],
                "icon":              meta[2],
                "accuracy":          round(simple_acc, 1),
                "weighted_accuracy": round(w_acc, 1),
                "correct":           b["correct"],
                "total":             b["total"],
                "streak":            streak,
                "avg_confidence":    round(avg_conf, 1),
            })

        results.sort(key=lambda x: (x["weighted_accuracy"], x["total"]), reverse=True)
        return results

    def _generate_recommendation(self, rankings: List[Dict[str, Any]]) -> str:

        results.sort(key=lambda x: (x["weighted_accuracy"], x["total"]), reverse=True)
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
