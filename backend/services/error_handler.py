"""Enhanced error handling for API calls - distinguish market closed vs token issues."""
from typing import Optional, Dict, Any
from datetime import datetime
import pytz
from kiteconnect.exceptions import TokenException
from services.market_session_controller import MarketPhase, get_market_phase


def handle_zerodha_error(error: Exception, context: str = "") -> Dict[str, Any]:
    """
    Smart error handler that distinguishes between:
    1. Token expired/invalid
    2. Market closed (token valid, but no data available)
    3. Other API errors
    
    Args:
        error: The exception caught
        context: Context string for logging (e.g., "VOLUME-PULSE", "CANDLE-INTENT")
        
    Returns:
        Dict with error details, user message, and retry strategy
    """
    error_msg = str(error)
    error_type = type(error).__name__
    
    # Get current market phase
    try:
        market_phase = get_market_phase()
    except:
        market_phase = MarketPhase.CLOSED
    
    # Build response
    response = {
        "error_type": error_type,
        "error_message": error_msg,
        "market_phase": market_phase.value if hasattr(market_phase, 'value') else str(market_phase),
        "is_token_issue": False,
        "is_market_closed": False,
        "user_message": "",
        "log_message": "",
        "should_retry": False,
        "severity": "warning"
    }
    
    # Case 1: TokenException during market hours = Real token issue
    if isinstance(error, TokenException) or "token" in error_msg.lower() or "incorrect" in error_msg.lower():
        if market_phase == MarketPhase.LIVE or market_phase == MarketPhase.PRE_OPEN:
            # Token issue during trading hours - CRITICAL
            response.update({
                "is_token_issue": True,
                "user_message": "⚠️ Token expired - Login required",
                "log_message": f"[{context}] ❌ TOKEN EXPIRED during market hours - Authentication required",
                "should_retry": False,
                "severity": "critical"
            })
        else:
            # TokenException when market closed - Less critical (expected behavior)
            response.update({
                "is_market_closed": True,
                "user_message": "📊 Market closed - Showing last session data",
                "log_message": f"[{context}] ℹ️ API call failed (market closed) - Using cached data",
                "should_retry": False,
                "severity": "info"
            })
    
    # Case 2: Market closed explicitly
    elif market_phase == MarketPhase.CLOSED:
        response.update({
            "is_market_closed": True,
            "user_message": "📊 Market closed - Showing last session data",
            "log_message": f"[{context}] ℹ️ Market closed - Using historical data",
            "should_retry": False,
            "severity": "info"
        })
    
    # Case 3: Other API errors
    else:
        response.update({
            "user_message": "⚠️ Data fetch error - Using cached data",
            "log_message": f"[{context}] ⚠️ API Error: {error_msg}",
            "should_retry": True,
            "severity": "warning"
        })
    
    return response


def should_skip_api_call(market_phase: Optional[MarketPhase] = None) -> Dict[str, Any]:
    """
    Check if API calls should be skipped based on market status.
    
    Returns:
        Dict with:
        - skip: bool - Whether to skip the API call
        - reason: str - Why skipping
        - use_cache: bool - Whether to use cached data instead
    """
    if market_phase is None:
        try:
            market_phase = get_market_phase()
        except:
            market_phase = MarketPhase.CLOSED
    
    if market_phase == MarketPhase.CLOSED:
        return {
            "skip": True,
            "reason": "Market closed",
            "use_cache": True,
            "message": "📊 Market closed - Using last session data"
        }
    
    return {
        "skip": False,
        "reason": "Market open",
        "use_cache": False,
        "message": ""
    }


def format_error_log(context: str, error: Exception, additional_info: Optional[Dict] = None) -> None:
    """
    Pretty print error logs with context and market-aware messages.
    
    Args:
        context: Where the error occurred (e.g., "VOLUME-PULSE")
        error: The exception
        additional_info: Optional dict with extra debugging info
    """
    error_details = handle_zerodha_error(error, context)
    
    print(f"\n{'='*60}")
    print(f"[{context}] ERROR HANDLER")
    print(f"{'='*60}")
    print(f"Error Type: {error_details['error_type']}")
    print(f"Market Phase: {error_details['market_phase']}")
    print(f"Severity: {error_details['severity'].upper()}")
    print(f"\n{error_details['log_message']}")
    
    if error_details['is_token_issue'] and error_details['severity'] == 'critical':
        print(f"\n🔑 ACTION REQUIRED:")
        print(f"   → Click LOGIN button to refresh Zerodha token")
        print(f"   → Token expires daily at midnight")
    
    if error_details['is_market_closed']:
        print(f"\nℹ️  NORMAL BEHAVIOR:")
        print(f"   → Market is closed")
        print(f"   → Using last session data")
        print(f"   → No action required")
    
    if additional_info:
        print(f"\nAdditional Info:")
        for key, value in additional_info.items():
            print(f"   → {key}: {value}")
    
    print(f"{'='*60}\n")
