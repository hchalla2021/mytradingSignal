"""Health check endpoints."""
from fastapi import APIRouter
from datetime import datetime
from services.market_feed import get_market_status, IST

router = APIRouter()


@router.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "service": "MyDailyTradingSignals API"
    }


@router.get("/health/ready")
async def readiness_check():
    """Readiness check for Kubernetes/Docker."""
    return {
        "ready": True,
        "timestamp": datetime.now().isoformat()
    }


@router.get("/api/market-status")
async def market_status():
    """Get current market status (PRE_OPEN, LIVE, or CLOSED).
    
    Frontend should poll this endpoint every 30 seconds to update UI.
    This ensures market status is always current without server restart.
    
    Returns:
        - status: PRE_OPEN (9:00-9:15), LIVE (9:15-15:30), or CLOSED
        - time: Current IST time
        - message: Human-readable status message
    """
    now = datetime.now(IST)
    status = get_market_status()
    
    # Generate user-friendly message
    messages = {
        "PRE_OPEN": "🔔 Pre-open session (9:00-9:15 AM) - Auction matching in progress",
        "LIVE": "🟢 Market is LIVE - Trading in progress",
        "CLOSED": "🔴 Market closed - Showing last traded prices"
    }
    
    return {
        "status": status,
        "time": now.strftime("%H:%M:%S"),
        "date": now.strftime("%Y-%m-%d"),
        "day": now.strftime("%A"),
        "message": messages.get(status, "Unknown status"),
        "isTrading": status in ("PRE_OPEN", "LIVE")
    }
