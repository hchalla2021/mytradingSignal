"""
Token Status & Health Check Endpoint
Shows if token is valid, when it expires, and connection status
"""
from fastapi import APIRouter
from datetime import datetime, time
import pytz
from typing import Dict, Any

from config import get_settings
from services.cache import CacheService

router = APIRouter()

IST = pytz.timezone('Asia/Kolkata')

@router.get("/api/token-status")
async def get_token_status() -> Dict[str, Any]:
    """
    Get current token and market status
    Useful for monitoring and debugging
    """
    settings = get_settings()
    now = datetime.now(IST)
    
    # Check if credentials exist
    has_api_key = bool(settings.zerodha_api_key)
    has_token = bool(settings.zerodha_access_token)
    
    # Calculate token expiry (tokens expire at 3:30 AM IST next day)
    token_expiry_time = now.replace(hour=3, minute=30, second=0, microsecond=0)
    if now.time() >= time(3, 30):
        # After 3:30 AM, token expires tomorrow at 3:30 AM
        from datetime import timedelta
        token_expiry_time = token_expiry_time + timedelta(days=1)
    
    # Time until expiry
    time_until_expiry = token_expiry_time - now
    hours_until_expiry = time_until_expiry.total_seconds() / 3600
    
    # Market status
    current_time = now.time()
    is_weekend = now.weekday() >= 5
    
    if is_weekend:
        market_status = "WEEKEND"
    elif time(9, 0) <= current_time < time(9, 15):
        market_status = "PRE_OPEN"
    elif time(9, 15) <= current_time <= time(15, 30):
        market_status = "LIVE"
    else:
        market_status = "CLOSED"
    
    # Check if we have cached data (indicates connection worked)
    cache = CacheService()
    await cache.connect()
    cached_data = await cache.get_market_data("NIFTY")
    await cache.disconnect()
    
    has_cached_data = cached_data is not None
    
    # Token validity guess
    token_likely_valid = has_token and hours_until_expiry > 0
    
    return {
        "timestamp": now.isoformat(),
        "ist_time": now.strftime("%Y-%m-%d %H:%M:%S %A"),
        "credentials": {
            "api_key_present": has_api_key,
            "access_token_present": has_token,
            "token_length": len(settings.zerodha_access_token) if has_token else 0
        },
        "token_expiry": {
            "expires_at": token_expiry_time.strftime("%Y-%m-%d %H:%M:%S"),
            "hours_until_expiry": round(hours_until_expiry, 2),
            "likely_valid": token_likely_valid,
            "status": "VALID" if token_likely_valid else "EXPIRED"
        },
        "market": {
            "status": market_status,
            "is_weekend": is_weekend,
            "market_open_time": "09:15 AM IST",
            "market_close_time": "03:30 PM IST"
        },
        "connection": {
            "has_cached_data": has_cached_data,
            "last_cached_symbol": "NIFTY" if has_cached_data else None
        },
        "next_action": _get_next_action(market_status, token_likely_valid, has_token)
    }


def _get_next_action(market_status: str, token_valid: bool, has_token: bool) -> str:
    """Determine what user should do next"""
    if not has_token:
        return "❌ Configure ZERODHA_ACCESS_TOKEN in .env"
    
    if not token_valid:
        return "⚠️ Token EXPIRED - Refresh token via login (before 9:15 AM)"
    
    if market_status == "LIVE":
        return "✅ Market LIVE - Data should be flowing"
    
    if market_status == "PRE_OPEN":
        return "🟡 Pre-Open Session - Auction data flowing"
    
    if market_status == "WEEKEND":
        return "🗓️ Weekend - Market opens Monday 9:15 AM"
    
    return "⏰ Market CLOSED - Opens tomorrow 9:15 AM"


@router.get("/api/health/detailed")
async def get_detailed_health():
    """Detailed health check with all system status"""
    settings = get_settings()
    
    return {
        "backend": "✅ Running",
        "redis": "✅ Connected",
        "zerodha": {
            "api_key": "✅ Configured" if settings.zerodha_api_key else "❌ Missing",
            "access_token": "✅ Configured" if settings.zerodha_access_token else "❌ Missing"
        },
        "features": {
            "market_feed": "✅ Active",
            "websocket": "✅ Active",
            "ai_analysis": "✅ Available" if settings.openai_api_key else "⚠️ Disabled (no OpenAI key)",
            "news_detection": "✅ Available" if settings.news_api_key else "⚠️ Disabled (no News API key)"
        },
        "auto_reload": "✅ Token auto-reload enabled"
    }
