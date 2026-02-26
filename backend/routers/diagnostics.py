"""
Diagnostic endpoint for troubleshooting market data flow
Helps identify if Zerodha connection is working and data is flowing
"""

from fastapi import APIRouter
from services.cache import CacheService
from services.auth_state_machine import auth_state_manager
from config import get_settings
import json
from datetime import datetime
import pandas as pd

router = APIRouter(prefix="/api/diagnostics", tags=["Diagnostics"])

# Global cache instance (will be injected by main.py)
_cache: CacheService | None = None

# Global market feed instance (will be injected by main.py)
_market_feed = None

def set_cache_instance(cache: CacheService):
    """Inject cache instance for diagnostics"""
    global _cache
    _cache = cache

def set_market_feed_instance(market_feed):
    """Inject market feed instance for diagnostics"""
    global _market_feed
    _market_feed = market_feed

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

@router.get("/market-status")
async def market_status_endpoint():
    """Get current market status (LIVE, CLOSED, PRE_OPEN, etc)"""
    try:
        from services.market_feed import get_market_status
        
        status = get_market_status()
        
        return {
            "status": "ok",
            "market_status": status,
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        import traceback
        return {
            "status": "error",
            "message": str(e),
            "traceback": traceback.format_exc(),
            "timestamp": datetime.now().isoformat()
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

@router.get("/oi-momentum-debug")
async def oi_momentum_debug():
    """
    Comprehensive OI Momentum diagnostic - Shows:
    1. Last market values for all symbols
    2. OI Momentum signal status
    3. Candle data availability
    4. Any errors or issues
    """
    if not _cache:
        return {
            "status": "error",
            "message": "Cache not initialized"
        }
    
    try:
        symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
        results = {
            "timestamp": datetime.now().isoformat(),
            "auth_status": {
                "authenticated": auth_state_manager.is_authenticated,
                "state": str(auth_state_manager.current_state)
            },
            "market_data": {},
            "candle_data": {},
            "oi_momentum_signals": {},
            "debug_info": []
        }
        
        # 1. Get latest market data from cache
        for symbol in symbols:
            try:
                market_data = await _cache.get_market_data(symbol)
                
                if market_data:
                    results["market_data"][symbol] = {
                        "price": market_data.get("price"),
                        "change": market_data.get("change"),
                        "changePercent": market_data.get("changePercent"),
                        "volume": market_data.get("volume"),
                        "oi": market_data.get("oi"),
                        "status": market_data.get("status"),
                        "timestamp": market_data.get("timestamp"),
                        "trend": market_data.get("trend"),
                        "data_available": True
                    }
                else:
                    results["market_data"][symbol] = {
                        "data_available": False,
                        "message": "No market data in cache"
                    }
                    results["debug_info"].append(f"⚠️ {symbol}: No market data found in cache")
            except Exception as e:
                results["market_data"][symbol] = {
                    "data_available": False,
                    "error": str(e)
                }
                results["debug_info"].append(f"❌ {symbol}: Market data fetch error: {e}")
        
        # 2. Get candle data status
        for symbol in symbols:
            try:
                candle_key = f"analysis_candles:{symbol}"
                candles_json = await _cache.lrange(candle_key, 0, 199)
                
                candle_count = len(candles_json) if candles_json else 0
                
                results["candle_data"][symbol] = {
                    "candle_count": candle_count,
                    "has_data": candle_count > 0,
                    "minimum_required": 20,
                    "sufficient": candle_count >= 20,
                    "message": f"✅ {candle_count} candles available" if candle_count >= 20 
                          else f"⚠️ Only {candle_count} candles (need 20)" if candle_count > 0
                          else "❌ No candles in cache"
                }
                
                if candle_count > 0:
                    # Show last candle details
                    try:
                        last_candle = json.loads(candles_json[0])
                        results["candle_data"][symbol]["last_candle"] = {
                            "timestamp": last_candle.get("timestamp"),
                            "close": last_candle.get("close"),
                            "volume": last_candle.get("volume"),
                            "oi": last_candle.get("oi")
                        }
                    except:
                        pass
                
                if candle_count < 20:
                    results["debug_info"].append(
                        f"⚠️ {symbol}: Only {candle_count} candles (OI Momentum needs 20). "
                        f"Will work once {20 - candle_count} more candles arrive"
                    )
            except Exception as e:
                results["candle_data"][symbol] = {
                    "error": str(e),
                    "has_data": False
                }
                results["debug_info"].append(f"❌ {symbol}: Candle fetch error: {e}")
        
        # 3. Get OI Momentum signals
        try:
            from services.oi_momentum_service import OIMomentumService
            from routers.analysis import oi_momentum_service
            
            for symbol in symbols:
                try:
                    # Get candles from cache
                    candle_key = f"analysis_candles:{symbol}"
                    candles_json = await _cache.lrange(candle_key, 0, 199)
                    
                    if not candles_json or len(candles_json) < 20:
                        results["oi_momentum_signals"][symbol] = {
                            "signal": "NO_SIGNAL",
                            "reason": f"Insufficient candles ({len(candles_json) if candles_json else 0}/20)",
                            "ready": False
                        }
                        continue
                    
                    # Parse candles
                    candles = []
                    for candle_json in reversed(candles_json):
                        try:
                            candles.append(json.loads(candle_json))
                        except:
                            continue
                    
                    if len(candles) < 20:
                        results["oi_momentum_signals"][symbol] = {
                            "signal": "NO_SIGNAL",
                            "reason": f"Could not parse candles ({len(candles)}/20)",
                            "ready": False
                        }
                        continue
                    
                    # Build dataframes
                    df_5m = pd.DataFrame(candles)
                    
                    # Build 15-minute DataFrame
                    df_15m_data = []
                    for i in range(0, len(candles) - 2, 3):
                        chunk = candles[i:i+3]
                        if len(chunk) == 3:
                            df_15m_data.append({
                                'open': chunk[0]['open'],
                                'high': max(c['high'] for c in chunk),
                                'low': min(c['low'] for c in chunk),
                                'close': chunk[-1]['close'],
                                'volume': sum(c.get('volume', 0) for c in chunk),
                                'oi': chunk[-1].get('oi', 0)
                            })
                    df_15m = pd.DataFrame(df_15m_data)
                    
                    # Get current values
                    current_price = df_5m.iloc[-1]['close'] if len(df_5m) > 0 else 0
                    current_oi = df_5m.iloc[-1].get('oi') if len(df_5m) > 0 else None
                    current_volume = df_5m.iloc[-1]['volume'] if len(df_5m) > 0 else None
                    
                    # Analyze
                    signal_data = oi_momentum_service.analyze_signal(
                        symbol=symbol,
                        df_5min=df_5m,
                        df_15min=df_15m,
                        current_price=current_price,
                        current_oi=current_oi,
                        current_volume=current_volume
                    )
                    
                    results["oi_momentum_signals"][symbol] = {
                        "signal_5m": signal_data.get("signal_5m"),
                        "signal_15m": signal_data.get("signal_15m"),
                        "final_signal": signal_data.get("final_signal"),
                        "confidence": signal_data.get("confidence"),
                        "ready": True,
                        "current_price": current_price,
                        "top_reasons": signal_data.get("reasons", [])[:3],
                        "metrics": signal_data.get("metrics", {})
                    }
                    
                except Exception as e:
                    results["oi_momentum_signals"][symbol] = {
                        "signal": "ERROR",
                        "error": str(e),
                        "ready": False
                    }
                    results["debug_info"].append(f"❌ {symbol}: OI Momentum analysis error: {e}")
        except Exception as e:
            results["debug_info"].append(f"❌ OI Momentum service error: {e}")
        
        # Summary
        results["summary"] = {
            "total_symbols": len(symbols),
            "symbols_with_market_data": sum(1 for s in symbols if s in results["market_data"] and results["market_data"][s].get("data_available")),
            "symbols_with_candles": sum(1 for s in symbols if s in results["candle_data"] and results["candle_data"][s].get("sufficient")),
            "symbols_with_signals": sum(1 for s in symbols if s in results["oi_momentum_signals"] and results["oi_momentum_signals"][s].get("ready")),
            "overall_status": "✅ ALL SYSTEMS GO" if (
                sum(1 for s in symbols if s in results["market_data"] and results["market_data"][s].get("data_available")) == len(symbols) and
                sum(1 for s in symbols if s in results["oi_momentum_signals"] and results["oi_momentum_signals"][s].get("ready")) == len(symbols)
            ) else "⚠️ PARTIAL DATA" if sum(1 for s in symbols if s in results["market_data"] and results["market_data"][s].get("data_available")) > 0
            else "❌ NO DATA"
        }
        
        return results
    
    except Exception as e:
        import traceback
        return {
            "status": "error",
            "message": str(e),
            "traceback": traceback.format_exc()
        }

@router.get("/connection-health")
async def connection_health():
    """
    Quick health check for market feed connection.
    Returns detailed status of WebSocket and data flow.
    """
    if not _market_feed:
        return {
            "status": "error",
            "message": "Market feed not initialized"
        }
    
    try:
        from services.feed_watchdog import feed_watchdog
        from services.market_feed import get_market_status
        
        health = _market_feed.get_connection_health()
        watchdog_metrics = feed_watchdog.get_health_metrics()
        market_status = get_market_status()
        
        return {
            "status": "ok",
            "timestamp": datetime.now().isoformat(),
            "websocket": {
                "is_connected": health["is_connected"],
                "has_kws": health["has_kws"],
                "is_running": health["is_running"],
                "using_rest_fallback": health["using_rest_fallback"],
                "last_tick_age_seconds": health["last_tick_age_seconds"],
                "symbols_with_data": health["symbols_with_data"],
                "symbols_without_data": health["symbols_without_data"],
            },
            "watchdog": {
                "state": watchdog_metrics["state"],
                "is_healthy": watchdog_metrics["is_healthy"],
                "is_stale": watchdog_metrics["is_stale"],
                "requires_reconnect": watchdog_metrics["requires_reconnect"],
                "last_tick_seconds_ago": watchdog_metrics["last_tick_seconds_ago"],
                "total_ticks": watchdog_metrics["total_ticks"],
                "total_reconnects": watchdog_metrics["total_reconnects"],
                "connection_quality": watchdog_metrics["connection_quality"],
            },
            "market": {
                "status": market_status,
                "is_open": market_status in ("PRE_OPEN", "FREEZE", "LIVE"),
            },
            "auth": {
                "authenticated": auth_state_manager.is_authenticated,
                "state": str(auth_state_manager.current_state),
            },
            "recommendation": _get_health_recommendation(health, watchdog_metrics, market_status)
        }
    
    except Exception as e:
        import traceback
        return {
            "status": "error",
            "message": str(e),
            "error_type": type(e).__name__,
            "timestamp": datetime.now().isoformat()
        }


def _get_health_recommendation(health, watchdog_metrics, market_status):
    """Recommend action based on health status"""
    
    # Check for issues
    issues = []
    
    if not health["is_connected"] and market_status in ("PRE_OPEN", "FREEZE", "LIVE"):
        issues.append("WebSocket not connected during market hours")
    
    if watchdog_metrics["is_stale"]:
        issues.append(f"Feed is stale - no ticks for {watchdog_metrics.get('last_tick_seconds_ago', 0)}s")
    
    if health["using_rest_fallback"]:
        issues.append("Using REST API fallback (WebSocket not available)")
    
    if watchdog_metrics["requires_reconnect"] and market_status in ("PRE_OPEN", "FREEZE", "LIVE"):
        issues.append("Feed requires reconnection")
    
    if not issues:
        return "✅ All systems healthy - Market feed is working properly"
    
    if len(issues) == 1 and "REST API fallback" in issues[0]:
        return f"⚠️ {issues[0]}. This is OK outside market hours. If this persists during market hours, try: POST /api/diagnostics/force-reconnect"
    
    # Multiple issues or critical issue during market hours
    if len(issues) > 0 and market_status in ("PRE_OPEN", "FREEZE", "LIVE"):
        return "🔥 CRITICAL: " + " | ".join(issues) + ". RUN: POST /api/diagnostics/force-reconnect"
    
    return "⚠️ " + " | ".join(issues)


@router.post("/force-reconnect")
async def force_reconnect():
    """
    🔥 EMERGENCY FIX: Force reconnection to Zerodha market feed
    
    This endpoint:
    1. Closes the current WebSocket connection
    2. Clears all stale market data from cache
    3. Triggers immediate reconnection
    4. Re-fetches initial market data
    5. Resets the market status
    
    Use this if the feed gets stuck showing old data or stuck on PRE_OPEN.
    """
    if not _market_feed:
        return {
            "status": "error",
            "message": "Market feed not initialized",
            "timestamp": datetime.now().isoformat()
        }
    
    try:
        import asyncio
        
        print("\n" + "="*80)
        print("🔥 FORCE RECONNECT TRIGGERED")
        print("="*80)
        
        # 1. Close existing connection
        print("🛑 Closing existing WebSocket connection...")
        if _market_feed.kws:
            try:
                _market_feed.kws.close()
                await asyncio.sleep(1)
            except Exception as e:
                print(f"⚠️ Error closing WebSocket: {e}")
        
        # Reset the connection flags
        _market_feed._is_connected = False
        _market_feed._using_rest_fallback = False
        _market_feed._consecutive_403_errors = 0
        _market_feed._retry_delay = 5
        _market_feed.last_prices.clear()
        _market_feed.last_update_time.clear()
        
        print("✅ Connection closed and state reset")
        
        # 2. Clear stale market data from cache to force fresh fetch
        print("🧹 Clearing stale market data from cache...")
        if _cache:
            symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
            for symbol in symbols:
                try:
                    await _cache.delete(f"market:{symbol}")
                    print(f"   ✅ Cleared {symbol}")
                except:
                    pass
        
        # 3. Reset watchdog state
        print("🐕 Resetting watchdog...")
        from services.feed_watchdog import feed_watchdog
        feed_watchdog._state = feed_watchdog.FeedState.DISCONNECTED
        feed_watchdog._last_tick_time = None
        feed_watchdog._consecutive_403_errors = 0
        feed_watchdog._reconnect_count = 0
        
        # 4. Trigger reconnection
        print("🔄 Triggering reconnection...")
        await _market_feed._attempt_reconnect()
        
        # 5. Wait a bit for connection to establish
        await asyncio.sleep(2)
        
        # 6. Fetch initial data
        print("📊 Fetching initial market data...")
        await _market_feed._fetch_and_cache_last_data()
        
        print("✅ FORCE RECONNECT COMPLETE")
        print("="*80 + "\n")
        
        return {
            "status": "success",
            "message": "Market feed reconnected successfully",
            "actions": [
                "❌ Closed old WebSocket connection",
                "🧹 Cleared stale market data",
                "🐕 Reset watchdog state",
                "🔄 Triggered reconnection",
                "📊 Fetched fresh market data"
            ],
            "next_step": "Market data should now be live. Check /ws/market WebSocket for updates.",
            "timestamp": datetime.now().isoformat(),
            "market_status": {
                "is_connected": _market_feed.is_connected,
                "using_rest_fallback": _market_feed._using_rest_fallback,
                "has_kws": bool(_market_feed.kws),
                "running": _market_feed.running
            }
        }
    
    except Exception as e:
        print(f"❌ Force reconnect failed: {e}")
        import traceback
        traceback.print_exc()
        
        return {
            "status": "error",
            "message": f"Force reconnect failed: {str(e)}",
            "error_type": type(e).__name__,
            "timestamp": datetime.now().isoformat()
        }