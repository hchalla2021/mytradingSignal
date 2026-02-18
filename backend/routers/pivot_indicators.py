"""
Pivot Points & Technical Indicators Router
==========================================
API endpoints for EMA 20/50, Classic Pivots, Camarilla Pivots, and Supertrend.
Always returns data - never fails.
❤️ IMPROVED: Smart caching (no cache during 9:15-3:30 IST trading hours)
"""

from fastapi import APIRouter
from typing import Optional, Dict
from datetime import datetime
from pytz import timezone
from services.pivot_indicators_service import get_pivot_service
from services.cache import get_cache

router = APIRouter(prefix="/api/advanced", tags=["Pivot Indicators"])


@router.get("/pivot-indicators/last-session")
async def get_last_session_pivots() -> Dict:
    """
    Get pivot levels from the last trading session.
    Used when market is closed to display historical trader data.
    Returns calculated pivots from last session's OHLC data.
    
    Status values:
    - CACHED: Data from last trading session
    - HISTORICAL: Calculated from backup
    - NO_DATA: No historical data available
    """
    try:
        service = get_pivot_service()
        result = service.get_last_session_pivots()
        return result if result else {
            "NIFTY": {"symbol": "NIFTY", "status": "NO_DATA", "current_price": None},
            "BANKNIFTY": {"symbol": "BANKNIFTY", "status": "NO_DATA", "current_price": None},
            "SENSEX": {"symbol": "SENSEX", "status": "NO_DATA", "current_price": None},
        }
    except Exception as e:
        print(f"❌ [LAST-SESSION] Error: {str(e)}")
        import traceback
        traceback.print_exc()
        
        return {
            "NIFTY": {"symbol": "NIFTY", "status": "ERROR", "reason": str(e), "current_price": None},
            "BANKNIFTY": {"symbol": "BANKNIFTY", "status": "ERROR", "reason": str(e), "current_price": None},
            "SENSEX": {"symbol": "SENSEX", "status": "ERROR", "reason": str(e), "current_price": None},
        }


@router.get("/pivot-indicators/{symbol}")
async def get_pivot_indicators(symbol: str) -> Dict:
    """
    Get technical indicators for a symbol.
    Always returns data (LIVE, CACHED, or OFFLINE fallback).
    Never throws errors - graceful degradation.
    
    🔥 IMPROVEMENT: Smart caching during trading hours
    - 9:15-3:30 IST (Mon-Fri): NO CACHE - fresh analysis every request
    - Outside hours: 60s cache for efficiency
    """
    symbol = symbol.upper()
    
    if symbol not in ["NIFTY", "BANKNIFTY", "SENSEX"]:
        return {
            "symbol": symbol,
            "status": "ERROR",
            "reason": "INVALID_SYMBOL",
            "message": f"Invalid symbol: {symbol}. Use NIFTY, BANKNIFTY, or SENSEX."
        }
    
    try:
        # Trading hours detection (9:15 AM - 3:30 PM IST, Mon-Fri)
        ist = timezone('Asia/Kolkata')
        current_time = datetime.now(ist)
        is_weekday = current_time.weekday() < 5  # Mon=0, Fri=4
        current_hm = current_time.time()
        trading_start = datetime.strptime("09:15", "%H:%M").time()
        trading_end = datetime.strptime("15:30", "%H:%M").time()
        is_trading = is_weekday and (trading_start <= current_hm <= trading_end)
        
        # Smart caching strategy
        cache = get_cache()
        cache_key = f"pivot_indicators:{symbol}"
        
        # During trading hours: NO CACHE for live analysis
        # Outside trading hours: 60s cache for efficiency
        if is_trading:
            print(f"[PIVOT-INDICATORS] 🔥 Trading hours (9:15-3:30) - NO CACHE for live updates")
        else:
            cached = await cache.get(cache_key)
            if cached:
                print(f"[PIVOT-INDICATORS] ⚡ Cache hit for {symbol} (60s cache outside trading hours)")
                return cached
        
        service = get_pivot_service()
        result = await service.get_indicators(symbol)
        
        # Always return something (fallback is built into service)
        if result:
            # Cache strategy: no cache during trading, 60s outside
            if not is_trading:
                await cache.set(cache_key, result, expire=60)
                print(f"[PIVOT-INDICATORS] 💾 Non-trading hours - Cached for 60s")
            return result
        else:
            return {
                "symbol": symbol,
                "status": "OFFLINE",
                "reason": "SERVICE_ERROR"
            }
    except Exception as e:
        # Log error but don't crash - return offline response
        print(f"❌ [PIVOT-INDICATORS] Error for {symbol}: {str(e)}")
        return {
            "symbol": symbol,
            "status": "OFFLINE",
            "reason": "SERVICE_ERROR",
            "error": str(e),
            "current_price": None,
            "change_percent": 0,
        }


@router.get("/pivot-indicators")
async def get_all_pivot_indicators() -> Dict[str, Optional[Dict]]:
    """
    Get technical indicators for all indices.
    Always returns data for each symbol - never fails.
    """
    try:
        service = get_pivot_service()
        
        import asyncio
        results = await asyncio.gather(
            service.get_indicators("NIFTY"),
            service.get_indicators("BANKNIFTY"),
            service.get_indicators("SENSEX"),
            return_exceptions=True
        )
        
        def safe_result(r, symbol):
            if isinstance(r, Exception):
                print(f"❌ [PIVOT-INDICATORS] Exception for {symbol}: {str(r)}")
                return {
                    "symbol": symbol,
                    "status": "OFFLINE",
                    "reason": "SERVICE_ERROR",
                    "error": str(r),
                    "current_price": None,
                    "change_percent": 0,
                }
            return r if r else {
                "symbol": symbol,
                "status": "OFFLINE",
                "reason": "NO_DATA",
                "current_price": None,
                "change_percent": 0,
            }
        
        return {
            "NIFTY": safe_result(results[0], "NIFTY"),
            "BANKNIFTY": safe_result(results[1], "BANKNIFTY"),
            "SENSEX": safe_result(results[2], "SENSEX"),
        }
    except Exception as e:
        # Global error - still return valid structure
        print(f"❌ [PIVOT-INDICATORS] Global error: {str(e)}")
        return {
            "NIFTY": {"symbol": "NIFTY", "status": "OFFLINE", "reason": "GLOBAL_ERROR", "error": str(e), "current_price": None},
            "BANKNIFTY": {"symbol": "BANKNIFTY", "status": "OFFLINE", "reason": "GLOBAL_ERROR", "error": str(e), "current_price": None},
            "SENSEX": {"symbol": "SENSEX", "status": "OFFLINE", "reason": "GLOBAL_ERROR", "error": str(e), "current_price": None},
        }
