"""
Diagnostic endpoint for troubleshooting market data flow
Helps identify if Zerodha connection is working and data is flowing
"""

from fastapi import APIRouter
from services.cache import CacheService
from services.auth_state_machine import auth_state_manager
from config import get_settings
import json

router = APIRouter(prefix="/api/diagnostics", tags=["Diagnostics"])

# Global cache instance (will be injected by main.py)
_cache: CacheService | None = None

def set_cache_instance(cache: CacheService):
    """Inject cache instance for diagnostics"""
    global _cache
    _cache = cache

@router.get("/market-data-status")
async def market_data_status():
    """Check if market data is flowing and what the current values are"""
    if not _cache:
        return {
            "status": "error",
            "message": "Cache not initialized",
            "timestamp": None
        }
    
    try:
        nifty = await _cache.get("market:NIFTY")
        banknifty = await _cache.get("market:BANKNIFTY")
        sensex = await _cache.get("market:SENSEX")
        
        return {
            "status": "ok",
            "auth": {
                "is_authenticated": auth_state_manager.is_authenticated,
                "state": str(auth_state_manager.current_state),
                "has_token": bool(get_settings().zerodha_access_token),
            },
            "market_data": {
                "NIFTY": nifty,
                "BANKNIFTY": banknifty,
                "SENSEX": sensex,
            },
            "has_data": {
                "NIFTY": nifty is not None,
                "BANKNIFTY": banknifty is not None,
                "SENSEX": sensex is not None,
            }
        }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
            "timestamp": None
        }

@router.get("/zerodha-connection")
async def zerodha_connection_status():
    """Check Zerodha connection status"""
    settings = get_settings()
    
    return {
        "zerodha_configured": {
            "api_key_set": bool(settings.zerodha_api_key),
            "api_secret_set": bool(settings.zerodha_api_secret),
            "access_token_set": bool(settings.zerodha_access_token),
        },
        "auth_status": {
            "is_authenticated": auth_state_manager.is_authenticated,
            "state": str(auth_state_manager.current_state),
        },
        "message": "Use /api/diagnostics/market-data-status for current market data" if auth_state_manager.is_authenticated else "Zerodha authentication required for live data. Using mock data feed."
    }
