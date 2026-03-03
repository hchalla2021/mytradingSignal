"""India VIX (INDIAVIX) real-time data endpoint."""
import logging
from fastapi import APIRouter
from typing import Dict, Any
from datetime import datetime, timedelta
import pytz

from services.cache import get_cache

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["vix"])

IST = pytz.timezone("Asia/Kolkata")

# VIX instrument token used by Zerodha historical API
_VIX_INSTRUMENT_TOKEN = 264969

# Module-level stores — survive cache TTL expiry within the process
_last_known_vix: Dict[str, Any] = {}
_prev_close_cache: Dict[str, Any] = {}  # {"value": 13.70, "date": "2026-02-27", "fetched_at": ...}


async def _get_prev_close() -> float | None:
    """Get VIX previous day close using Zerodha historical API (cached for 1 hour)."""
    global _prev_close_cache
    # Return cached if fresh (within 1 hour)
    if _prev_close_cache:
        fetched = _prev_close_cache.get("fetched_at", 0)
        if (datetime.now(IST).timestamp() - fetched) < 3600:
            return _prev_close_cache.get("value")

    try:
        from config import get_settings
        from kiteconnect import KiteConnect
        settings = get_settings()
        if not settings.zerodha_api_key or not settings.zerodha_access_token:
            return _prev_close_cache.get("value")
        kite = KiteConnect(api_key=settings.zerodha_api_key)
        kite.set_access_token(settings.zerodha_access_token)
        to_date = datetime.now(IST)
        from_date = to_date - timedelta(days=10)
        hist = kite.historical_data(_VIX_INSTRUMENT_TOKEN, from_date, to_date, "day")
        if hist and len(hist) >= 2:
            # Last completed day's close (second-to-last candle)
            prev = hist[-2]
            _prev_close_cache = {
                "value": prev["close"],
                "date": str(prev["date"]),
                "fetched_at": datetime.now(IST).timestamp(),
            }
            return prev["close"]
        elif hist and len(hist) == 1:
            _prev_close_cache = {
                "value": hist[0]["close"],
                "date": str(hist[0]["date"]),
                "fetched_at": datetime.now(IST).timestamp(),
            }
            return hist[0]["close"]
    except Exception as e:
        log.warning("VIX historical prev close fetch failed: %s", e)
    return _prev_close_cache.get("value")


async def _fetch_vix_from_zerodha() -> Dict[str, Any] | None:
    """Direct REST call to Zerodha — gets LTP + historical prev close for accurate change."""
    try:
        from config import get_settings
        from kiteconnect import KiteConnect
        settings = get_settings()
        if not settings.zerodha_api_key or not settings.zerodha_access_token:
            return None
        kite = KiteConnect(api_key=settings.zerodha_api_key)
        kite.set_access_token(settings.zerodha_access_token)
        quotes = kite.quote(["NSE:INDIA VIX"])
        q = quotes.get("NSE:INDIA VIX")
        if not q:
            return None

        ltp = q["last_price"]
        if not ltp or ltp <= 0:
            return None

        # Get accurate previous close from historical data
        prev_close = await _get_prev_close()
        if prev_close and prev_close > 0:
            change = round(ltp - prev_close, 2)
            change_pct = round((change / prev_close) * 100, 2)
        else:
            change = 0.0
            change_pct = 0.0

        # Get today's OHLC from historical (quote OHLC is garbage for VIX)
        today_ohlc = await _get_today_ohlc(kite, ltp)

        return {
            "price": ltp,
            "change": change,
            "changePercent": change_pct,
            "high": today_ohlc["high"],
            "low": today_ohlc["low"],
            "open": today_ohlc["open"],
            "close": prev_close or ltp,
            "timestamp": datetime.now(IST).isoformat(),
            "status": "LIVE",
        }
    except Exception as e:
        log.warning("VIX Zerodha REST fallback failed: %s", e)
        return None


async def _get_today_ohlc(kite, ltp: float) -> Dict[str, float]:
    """Get today's VIX OHLC from historical API (quote OHLC is wrong for VIX)."""
    try:
        today = datetime.now(IST).date()
        hist = kite.historical_data(
            _VIX_INSTRUMENT_TOKEN,
            datetime.combine(today, datetime.min.time()),
            datetime.now(IST),
            "day",
        )
        if hist:
            d = hist[-1]
            return {"open": d["open"], "high": d["high"], "low": d["low"]}
    except Exception:
        pass
    return {"open": ltp, "high": ltp, "low": ltp}


def _build_response(raw: Dict[str, Any], status_override: str | None = None) -> Dict[str, Any]:
    """Build a uniform VIX API response from raw market data."""
    v = raw.get("price", 0)
    return {
        "value": round(v, 2) if v else None,
        "change": round(raw.get("change", 0), 2),
        "changePercent": round(raw.get("changePercent", 0), 2),
        "high": round(raw.get("high", v), 2),
        "low": round(raw.get("low", v), 2),
        "open": round(raw.get("open", v), 2),
        "close": round(raw.get("close", v), 2),
        "timestamp": raw.get("timestamp", datetime.now(IST).isoformat()),
        "status": status_override or raw.get("status", "LIVE"),
        "volatilityLevel": _get_volatility_level(v) if v else "UNKNOWN",
        "marketFearScore": _calculate_fear_score(v) if v else 0,
    }


_EMPTY: Dict[str, Any] = {
    "value": None, "change": 0, "changePercent": 0,
    "high": 0, "low": 0, "open": 0, "close": 0,
    "timestamp": "", "status": "NO_DATA",
    "volatilityLevel": "UNKNOWN", "marketFearScore": 0,
}


async def _correct_vix_change(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Fix change/changePercent using historical previous close.
    
    Zerodha quote API returns ohlc.close == last_price for VIX,
    making change always 0. We use historical data for the true prev close.
    Also filters out bogus OHLC values (VIX should be 8-50 range).
    """
    raw = dict(raw)  # shallow copy — never mutate shared cache dict
    ltp = raw.get("price", 0)
    if not ltp or ltp <= 0:
        return raw

    prev_close = await _get_prev_close()
    if prev_close and prev_close > 0:
        raw["change"] = round(ltp - prev_close, 2)
        raw["changePercent"] = round(((ltp - prev_close) / prev_close) * 100, 2)
        raw["close"] = prev_close

    # Filter bogus OHLC: VIX values should be in 5-80 range
    for key in ("high", "low", "open"):
        val = raw.get(key, 0)
        if val and (val > 80 or val < 3):
            raw[key] = ltp

    return raw


async def get_vix_data() -> Dict[str, Any]:
    """Get India VIX — tries cache → last-known → Zerodha REST."""
    global _last_known_vix
    try:
        cache = get_cache()
        raw = await cache.get("market:INDIAVIX")

        if raw and raw.get("price"):
            raw = await _correct_vix_change(raw)
            resp = _build_response(raw)
            _last_known_vix = raw  # persist for next call
            return resp

        if _last_known_vix:
            return _build_response(_last_known_vix, status_override="CACHED")

        # Last resort — direct REST call to Zerodha
        direct = await _fetch_vix_from_zerodha()
        if direct and direct.get("price"):
            # Cache it ourselves with longer TTL so we don't hit Zerodha repeatedly
            await cache.set("market:INDIAVIX", direct, expire=300)
            _last_known_vix = direct
            return _build_response(direct)

        return {**_EMPTY, "timestamp": datetime.now(IST).isoformat()}

    except Exception as e:
        log.error("VIX data fetch error: %s", e)
        if _last_known_vix:
            return _build_response(_last_known_vix, status_override="CACHED")
        return {**_EMPTY, "timestamp": datetime.now(IST).isoformat()}


def _get_volatility_level(vix_value: float) -> str:
    """Classify VIX value into volatility levels.
    
    VIX Range  | Level
    10-13      | LOW - Very stable market
    14-17      | NORMAL - Healthy market condition
    18-22      | HIGH - Volatile market
    23+        | EXTREME - Panic selling / extreme fear
    """
    if vix_value < 14:
        return "LOW"
    elif vix_value < 18:
        return "NORMAL"
    elif vix_value < 23:
        return "HIGH"
    else:
        return "EXTREME"


def _calculate_fear_score(vix_value: float) -> float:
    """Calculate market fear index (0-100) from VIX value.
    
    Psychological measure: (vix_value / 25) * 100
    Represents perceived market fear level.
    """
    return round(min((vix_value / 25) * 100, 100), 1)


@router.get("/vix")
async def get_vix():
    """Get current India VIX — live Zerodha feed only, no dummy data."""
    return await get_vix_data()


@router.get("/vix/historical")
async def get_vix_historical(limit: int = 100):
    """Get historical VIX 5-minute candles from cache."""
    limit = max(1, min(limit, 500))
    try:
        cache = get_cache()
        
        # Get candles from cache (same format as market candles)
        candle_key = "analysis_candles:INDIAVIX"
        candles_json = await cache.lrange(candle_key, 0, limit - 1)
        
        if not candles_json:
            return {
                "candles": [],
                "timestamp": datetime.now(IST).isoformat(),
                "status": "NO_DATA"
            }
        
        import json
        candles = [json.loads(c) for c in candles_json]
        
        return {
            "candles": candles[:limit],
            "count": len(candles),
            "timestamp": datetime.now(IST).isoformat(),
            "status": "OK"
        }
    
    except Exception as e:
        log.error("Error fetching historical VIX: %s", e)
        return {
            "candles": [],
            "timestamp": datetime.now(IST).isoformat(),
            "status": "ERROR",
        }
