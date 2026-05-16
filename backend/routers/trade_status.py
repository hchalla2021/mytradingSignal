from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Query

from services.cache import get_cache
from services.market_regime_service import get_market_regime_service

router = APIRouter(prefix="/api/trade-status", tags=["trade-status"])


MODULE_MANIFEST: list[dict[str, Any]] = [
    {
        "id": "market_liquidity",
        "title": "Market Liquidity Intelligence",
        "zone": "execution",
        "priority": 20,
        "supportsSymbols": True,
        "defaultEnabled": True,
    },
    {
        "id": "market_compass",
        "title": "Market Compass",
        "zone": "intel",
        "priority": 30,
        "supportsSymbols": True,
        "defaultEnabled": True,
    },
    {
        "id": "global_impact",
        "title": "Global Impact Radar",
        "zone": "global",
        "priority": 40,
        "supportsSymbols": False,
        "defaultEnabled": True,
    },
    {
        "id": "global_risk",
        "title": "Global Risk Panel",
        "zone": "risk",
        "priority": 50,
        "supportsSymbols": False,
        "defaultEnabled": True,
    },
]

TRACKED_SYMBOLS = ("NIFTY", "BANKNIFTY", "SENSEX")


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _coerce_confidence(value: Any) -> int:
    confidence = _safe_float(value, 0.0)
    if confidence <= 1:
        confidence *= 100
    return int(max(0, min(100, round(confidence))))


def _signal_from_tick(tick: dict[str, Any]) -> str:
    analysis = tick.get("analysis") or {}
    analysis_signal = str(analysis.get("signal") or "").upper()
    if analysis_signal:
        return analysis_signal

    trend = str(tick.get("trend") or "neutral").lower()
    if trend == "bullish":
        return "BUY"
    if trend == "bearish":
        return "SELL"
    return "NEUTRAL"


def _pressure(signal: str) -> tuple[int, int]:
    normalized = signal.upper()
    if "STRONG_BUY" in normalized:
        return 78, 22
    if "BUY" in normalized or "BULL" in normalized:
        return 64, 36
    if "STRONG_SELL" in normalized:
        return 22, 78
    if "SELL" in normalized or "BEAR" in normalized:
        return 36, 64
    return 50, 50


def _risk_label(vix: float, change_pct: float) -> str:
    abs_move = abs(change_pct)
    if vix >= 23 or abs_move >= 2.0:
        return "HIGH"
    if vix >= 17 or abs_move >= 1.0:
        return "MEDIUM"
    return "LOW"


def _volatility_level(vix: float) -> str:
    if vix <= 0:
        return "UNKNOWN"
    if vix < 14:
        return "LOW"
    if vix < 18:
        return "NORMAL"
    if vix < 23:
        return "HIGH"
    return "EXTREME"


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.get("/manifest")
async def get_trade_status_manifest() -> dict[str, Any]:
    return {
        "engine": "trade-status",
        "version": "1.0.0",
        "modules": MODULE_MANIFEST,
        "generated_at": _iso_now(),
    }


@router.get("/snapshot")
async def get_trade_status_snapshot(
    symbol: str = Query(default="NIFTY", pattern="^(NIFTY|BANKNIFTY|SENSEX)$")
) -> dict[str, Any]:
    cache = get_cache()
    market_data = await cache.get_all_market_data()

    snapshot = market_data.get(symbol)
    connected_symbols = [
        item_symbol
        for item_symbol, item_data in market_data.items()
        if item_data and item_data.get("status") in {"LIVE", "PRE_OPEN", "FREEZE"}
    ]

    return {
        "symbol": symbol,
        "snapshot": snapshot,
        "connected_symbols": connected_symbols,
        "market_count": len(market_data),
        "generated_at": _iso_now(),
    }


@router.get("/engine")
async def get_trade_status_engine(
    symbol: str = Query(default="NIFTY", pattern="^(NIFTY|BANKNIFTY|SENSEX)$")
) -> dict[str, Any]:
    """Unified institutional snapshot powering the Trade Status command center."""
    cache = get_cache()

    market_data = await cache.get_all_market_data()
    vix_tick = await cache.get("market:INDIAVIX") or {}

    vix_value = _safe_float(vix_tick.get("price") or vix_tick.get("ltp"), 0.0)
    vix_change_pct = _safe_float(vix_tick.get("changePercent"), 0.0)

    try:
        regime_snapshot = get_market_regime_service().get_snapshot()
    except Exception:
        regime_snapshot = {}

    connected_symbols = [
        item_symbol
        for item_symbol, item_data in market_data.items()
        if item_symbol in TRACKED_SYMBOLS
        and item_data
        and item_data.get("status") in {"LIVE", "PRE_OPEN", "FREEZE"}
    ]

    symbols: dict[str, dict[str, Any]] = {}
    bullish_count = 0
    bearish_count = 0
    neutral_count = 0
    confidence_total = 0

    for ticker in TRACKED_SYMBOLS:
        tick = market_data.get(ticker) or {}
        signal = _signal_from_tick(tick)
        confidence = _coerce_confidence((tick.get("analysis") or {}).get("confidence"))
        buy_pressure, sell_pressure = _pressure(signal)
        change_pct = _safe_float(tick.get("changePercent"), 0.0)
        risk_level = _risk_label(vix_value, change_pct)

        if "BUY" in signal.upper() or "BULL" in signal.upper():
            bullish_count += 1
        elif "SELL" in signal.upper() or "BEAR" in signal.upper():
            bearish_count += 1
        else:
            neutral_count += 1

        confidence_total += confidence

        regime = regime_snapshot.get(ticker) if isinstance(regime_snapshot, dict) else None

        symbols[ticker] = {
            "symbol": ticker,
            "price": _safe_float(tick.get("price"), 0.0),
            "change_pct": round(change_pct, 2),
            "status": tick.get("status", "UNKNOWN"),
            "signal": signal,
            "confidence": confidence,
            "buy_pressure": buy_pressure,
            "sell_pressure": sell_pressure,
            "risk": risk_level,
            "regime": (regime or {}).get("regime", "NEUTRAL"),
            "regime_score": int(round(_safe_float((regime or {}).get("regimeScore"), 0.0))),
            "pulse_5m": (tick.get("analysis") or {}).get("signal", "NEUTRAL"),
            "timestamp": tick.get("timestamp") or _iso_now(),
        }

    active_signal_key = f"trade_status:last_signal:{symbol}"
    active_prev = await cache.get(active_signal_key) or {}
    active_current = (symbols.get(symbol) or {}).get("signal", "NEUTRAL")
    alerts: list[dict[str, Any]] = []

    if active_prev.get("signal") and active_prev.get("signal") != active_current:
        alerts.append(
            {
                "id": f"{symbol}:{int(datetime.now(timezone.utc).timestamp())}",
                "level": "INFO",
                "symbol": symbol,
                "title": "Signal Shift Detected",
                "message": f"{symbol} changed from {active_prev.get('signal')} to {active_current}.",
                "timestamp": _iso_now(),
            }
        )

    await cache.set(active_signal_key, {"signal": active_current}, expire=3600)

    avg_conf = int(round(confidence_total / max(len(TRACKED_SYMBOLS), 1)))
    active_status = (symbols.get(symbol) or {}).get("status", "UNKNOWN")

    return {
        "engine": "trade-status",
        "version": "1.1.0",
        "generated_at": _iso_now(),
        "meta": {
            "active_symbol": symbol,
            "market_phase": active_status,
            "connected_symbols": connected_symbols,
            "refresh_interval_ms": 2500,
            "latency_budget_ms": 120,
        },
        "global": {
            "vix": {
                "value": round(vix_value, 2),
                "change_pct": round(vix_change_pct, 2),
                "volatility_level": _volatility_level(vix_value),
                "fear_score": max(0, min(100, int(round(vix_value * 4)))),
            },
            "breadth": {
                "bullish_count": bullish_count,
                "bearish_count": bearish_count,
                "neutral_count": neutral_count,
                "total": len(TRACKED_SYMBOLS),
                "avg_confidence": avg_conf,
            },
        },
        "symbols": symbols,
        "alerts": alerts,
        "modules": MODULE_MANIFEST,
    }
