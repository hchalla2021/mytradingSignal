"""
System Health Status Endpoint
✅ Exposes all 3 independent state machines
✅ Auth State (VALID/EXPIRED/REQUIRED)
✅ Feed State (CONNECTED/STALE/DISCONNECTED)
✅ Market Session (PRE_OPEN/LIVE/CLOSED)
"""
from fastapi import APIRouter
from datetime import datetime
import pytz

from services.market_session_controller import market_session, MarketPhase
from services.auth_state_machine import auth_state_manager
from services.feed_watchdog import feed_watchdog

router = APIRouter()
IST = pytz.timezone('Asia/Kolkata')


@router.get("/health")
async def get_system_health():
    """
    Get complete system health status
    
    Returns 3 independent states:
    1. Market Session (time-based, always accurate)
    2. Auth State (token validity)
    3. Feed State (websocket health)
    """
    now = datetime.now(IST)
    
    # 1. Market Session State (NEVER depends on auth/feed)
    market_phase = market_session.get_current_phase(now)
    market_desc = market_session.get_phase_description(market_phase)
    seconds_to_next = market_session.seconds_until_next_phase(now)
    
    # 2. Auth State (token validity)
    auth_info = auth_state_manager.get_state_info()
    
    # 3. Feed State (websocket health)
    feed_metrics = feed_watchdog.get_health_metrics()
    
    # Overall system status priority:
    # 1. AUTH_REQUIRED → Show login
    # 2. FEED_DISCONNECTED → Show "Reconnecting..."
    # 3. MARKET_SESSION → Show actual status
    
    if auth_state_manager.requires_login:
        priority_status = "AUTH_REQUIRED"
        priority_message = "Login required to view live data"
    elif feed_watchdog.requires_reconnect and market_session.is_data_flow_expected(now):
        priority_status = "FEED_DISCONNECTED"
        priority_message = "Reconnecting to market feed..."
    else:
        priority_status = "MARKET_SESSION"
        priority_message = market_desc["description"]
    
    return {
        "timestamp": now.isoformat(),
        
        # Priority status for UI
        "priority_status": priority_status,
        "priority_message": priority_message,
        
        # Market Session (always accurate)
        "market": {
            "phase": market_phase.value,
            "title": market_desc["title"],
            "description": market_desc["description"],
            "icon": market_desc["icon"],
            "color": market_desc["color"],
            "is_trading_hours": market_session.is_trading_hours(now),
            "data_flow_expected": market_session.is_data_flow_expected(now),
            "seconds_to_next_phase": seconds_to_next,
            "next_phase_in_minutes": round(seconds_to_next / 60, 1),
        },
        
        # Auth State
        "auth": {
            "state": auth_info["state"],
            "is_valid": auth_info["is_valid"],
            "requires_login": auth_info["requires_login"],
            "token_age_hours": auth_info["token_age_hours"],
            "last_success": auth_info["last_success"],
            "consecutive_failures": auth_info["consecutive_failures"],
        },
        
        # Feed State
        "feed": {
            "state": feed_metrics["state"],
            "is_healthy": feed_metrics["is_healthy"],
            "is_stale": feed_metrics["is_stale"],
            "requires_reconnect": feed_metrics["requires_reconnect"],
            "last_tick_seconds_ago": feed_metrics["last_tick_seconds_ago"],
            "uptime_minutes": feed_metrics["uptime_minutes"],
            "total_ticks": feed_metrics["total_ticks"],
            "total_reconnects": feed_metrics["total_reconnects"],
            "connection_quality": feed_metrics["connection_quality"],
        },
    }


@router.get("/health/market")
async def get_market_status():
    """Get only market session status (fast endpoint)"""
    now = datetime.now(IST)
    phase = market_session.get_current_phase(now)
    desc = market_session.get_phase_description(phase)
    
    return {
        "phase": phase.value,
        "title": desc["title"],
        "description": desc["description"],
        "icon": desc["icon"],
        "is_trading_hours": market_session.is_trading_hours(now),
        "timestamp": now.isoformat(),
    }


@router.get("/health/auth")
async def get_auth_status():
    """Get only auth status"""
    return auth_state_manager.get_state_info()


@router.get("/health/feed")
async def get_feed_status():
    """Get only feed status"""
    return feed_watchdog.get_health_metrics()


@router.post("/health/auth/verify")
async def verify_token():
    """Verify token with actual Zerodha API call"""
    is_valid, error = await auth_state_manager.verify_token_with_api()
    
    return {
        "is_valid": is_valid,
        "error": error,
        "state": auth_state_manager.current_state.value,
    }


@router.get("/health/summary")
async def get_health_summary():
    """Get quick health summary (for monitoring)"""
    now = datetime.now(IST)
    
    market_phase = market_session.get_current_phase(now)
    auth_valid = auth_state_manager.is_valid
    feed_healthy = feed_watchdog.is_healthy
    
    # System is "healthy" if:
    # - Auth is valid OR market is closed
    # - Feed is healthy OR market is closed
    market_closed = market_phase == MarketPhase.CLOSED
    
    system_healthy = (auth_valid or market_closed) and (feed_healthy or market_closed)
    
    return {
        "healthy": system_healthy,
        "market_phase": market_phase.value,
        "auth_valid": auth_valid,
        "feed_healthy": feed_healthy,
        "requires_action": auth_state_manager.requires_login,
        "timestamp": now.isoformat(),
    }
