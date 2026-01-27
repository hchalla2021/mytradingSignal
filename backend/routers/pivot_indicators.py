"""
Pivot Points & Technical Indicators Router
==========================================
API endpoints for EMA 20/50, Classic Pivots, Camarilla Pivots, and Supertrend.
Always returns data - never fails.
"""

from fastapi import APIRouter
from typing import Optional, Dict
from services.pivot_indicators_service import get_pivot_service

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
        service = get_pivot_service()
        result = await service.get_indicators(symbol)
        
        # Always return something (fallback is built into service)
        return result if result else {
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
