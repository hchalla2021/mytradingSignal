"""Market data WebSocket endpoint."""
import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from datetime import datetime
from typing import Dict, Any, Optional

from config import get_settings
from services.websocket_manager import manager
from services.cache import CacheService

router = APIRouter()
settings = get_settings()




async def _get_market_data_with_fallback(cache: CacheService) -> Dict[str, Any]:
    """Get market data from cache (fast, non-blocking!)"""
    # 🔥 CRITICAL: Only return what's in cache immediately - NO blocking REST calls!
    # The WebSocket needs to respond quickly to new client connections
    # Market data will flow in via ticks once market_feed populates the cache
    
    cached_data = await cache.get_all_market_data()
    
    symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
    present = len([s for s in symbols if s in cached_data and cached_data.get(s, {}).get('price')])
    
    if present > 0:
        print(f"✅ Market data in cache: {present}/{len(symbols)} symbols")
    else:
        print(f"⏳ Cache empty - waiting for market_feed to populate via ticks")
    
    return cached_data


@router.get("/cache/{symbol}")
async def get_cache_data(symbol: str):
    """Debug endpoint to check raw cache data for a symbol"""
    cache = CacheService()
    await cache.connect()
    try:
        data = await cache.get_market_data(symbol)
        return {
            "symbol": symbol,
            "data": data,
            "has_data": data is not None,
            "timestamp": datetime.now().isoformat()
        }
    finally:
        await cache.disconnect()


@router.get("/vwap-live/{symbol}")
async def get_vwap_live(symbol: str):
    """
    Get LIVE intraday VWAP for a futures symbol
    
    ✅ Uses ONLY live Zerodha API data - NO hardcoded/dummy data
    
    URL: GET /api/market/vwap-live/NIFTY
    
    Returns:
    {
        "symbol": "NIFTY",
        "success": true,
        "vwap": 25599.33,              # Live VWAP from Zerodha candles
        "current_price": 25605.00,     # Live price from Zerodha
        "position": {
            "position": "ABOVE",
            "distance": 5.67,
            "distance_pct": 0.0221,
            "signal": "BULLISH"
        },
        "candles_used": 156,           # Fresh candles from today 9:15 AM
        "last_update": "2025-02-13 14:30:00 IST",
        "total_volume": 45000000
    }
    """
    try:
        from kiteconnect import KiteConnect
        from services.vwap_live_service import VWAPLiveCalculator
        import asyncio
        
        symbol = symbol.upper()
        
        # Validate symbol is a futures contract
        valid_symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
        if symbol not in valid_symbols:
            return {
                "success": False,
                "error": f"Invalid symbol: {symbol}. Must be one of {valid_symbols}",
                "symbol": symbol
            }
        
        # Initialize Zerodha connection with LIVE access token
        kite = KiteConnect(api_key=settings.zerodha_api_key)
        if not settings.zerodha_access_token:
            return {
                "success": False,
                "error": "No Zerodha access token configured",
                "symbol": symbol
            }
        kite.set_access_token(settings.zerodha_access_token)
        
        # Get current month's futures token using ContractManager (auto-switches monthly!)
        from services.contract_manager import ContractManager
        
        try:
            manager = ContractManager(kite)
            instrument_token = manager.get_current_contract_token(symbol, debug=False)
            
            if not instrument_token:
                # Fallback to hardcoded tokens from config
                token_map = {
                    "NIFTY": settings.nifty_fut_token,
                    "BANKNIFTY": settings.banknifty_fut_token,
                    "SENSEX": settings.sensex_fut_token,
                }
                instrument_token = token_map.get(symbol)
                
                if not instrument_token:
                    return {
                        "success": False,
                        "error": f"No futures token found for {symbol}. ContractManager failed and no fallback configured.",
                        "symbol": symbol
                    }
                
                print(f"   ⚠️  Using fallback token from config: {instrument_token}")
            else:
                print(f"   ✅ Using ContractManager token: {instrument_token}")
        except Exception as e:
            print(f"   ⚠️  ContractManager error: {e}. Falling back to config tokens...")
            # Fallback to hardcoded tokens
            token_map = {
                "NIFTY": settings.nifty_fut_token,
                "BANKNIFTY": settings.banknifty_fut_token,
                "SENSEX": settings.sensex_fut_token,
            }
            instrument_token = token_map.get(symbol)
            if not instrument_token:
                return {
                    "success": False,
                    "error": f"Token resolution failed for {symbol}",
                    "symbol": symbol
                }
        
        # Get current price from LIVE Zerodha API
        print(f"\n🔄 [VWAP-LIVE] {symbol}: Fetching live data from Zerodha...")
        try:
            # Fetch latest 5m candle to get current price
            from datetime import datetime, timedelta
            import pytz
            
            IST = pytz.timezone('Asia/Kolkata')
            now = datetime.now(IST)
            market_open = now.replace(hour=9, minute=15, second=0, microsecond=0)
            
            latest_data = kite.historical_data(
                instrument_token=instrument_token,
                from_date=market_open,
                to_date=now,
                interval="5minute"
            )
            
            if latest_data and len(latest_data) > 0:
                current_price = latest_data[-1]['close']  # Latest candle close
            else:
                return {
                    "success": False,
                    "error": f"Zerodha returned no data for token {instrument_token}. Token may have expired.",
                    "symbol": symbol,
                    "debug_token": instrument_token
                }
            
            print(f"   💹 Live Price: ₹{current_price:,.2f}")
        except Exception as e:
            return {
                "success": False,
                "error": f"Failed to fetch current price: {str(e)}",
                "symbol": symbol
            }
        
        # Calculate VWAP using LIVE 5-minute candles from market open
        print(f"   📊 Calculating VWAP from live market data...")
        
        loop = asyncio.get_event_loop()
        calculator = VWAPLiveCalculator(kite)
        
        # Run in executor to avoid blocking
        result = await loop.run_in_executor(
            None,
            lambda: calculator.get_live_vwap_complete(
                symbol=symbol,
                instrument_token=instrument_token,
                current_price=current_price,
                interval="5minute",
                debug=False
            )
        )
        
        if result['success']:
            print(f"   ✅ VWAP: ₹{result['vwap']:,.2f}")
            print(f"   📍 Position: {result['position']['position']} ({result['position']['signal']})")
            print(f"   📈 Candles used: {result['candles_used']} (from 9:15 AM)")
        else:
            print(f"   ❌ VWAP calculation failed: {result.get('error')}")
        
        return result
        
    except Exception as e:
        print(f"❌ [VWAP-LIVE] Endpoint error: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            "success": False,
            "error": str(e),
            "symbol": symbol if 'symbol' in locals() else "UNKNOWN",
            "error_type": type(e).__name__
        }


@router.websocket("/market")
async def market_websocket(websocket: WebSocket):
    """
    WebSocket endpoint for real-time market data.
    
    Sends:
    - Initial snapshot of all market data
    - Live tick updates as they arrive
    - Heartbeat every 30 seconds with connection status
    
    🔥 Enhanced Status Messages:
    - Tells client if using WebSocket or REST fallback
    - Shows connection quality
    - Warns about token expiration
    """
    print("🔌 [WS-MARKET] New WebSocket connection request...")
    await manager.connect(websocket)
    print(f"✅ [WS-MARKET] Client connected. Total clients: {manager.connection_count}")
    
    cache = CacheService()
    print("🔌 [WS-MARKET] Connecting to cache...")
    try:
        await cache.connect()
        print("✅ [WS-MARKET] Cache connected")
    except Exception as e:
        print(f"❌ [WS-MARKET] Cache connection failed: {e}")
        await manager.disconnect(websocket)
        return
    
    try:
        # 🔥 NEW: Send connection status info to client
        from services.market_feed import get_market_status
        from services.auth_state_machine import auth_state_manager
        from services.feed_watchdog import feed_watchdog
        
        print("🔌 [WS-MARKET] Getting market status...")
        market_status = get_market_status()
        print(f"   Market status: {market_status}")
        
        auth_state = auth_state_manager.current_state
        feed_state = feed_watchdog.get_health_metrics()
        
        # Determine connection mode and quality message
        connection_mode = "WebSocket"
        connection_quality = "UNKNOWN"
        status_message = "Initializing..."
        
        # Check if using REST fallback (from feed_watchdog metrics)
        if feed_state.get('using_rest_fallback'):
            connection_mode = "REST API Polling"
            status_message = "⚠️ Using REST API (WebSocket temporarily unavailable)"
        else:
            connection_mode = "WebSocket"
        
        # Assess connection quality
        if feed_state.get('is_healthy'):
            connection_quality = "EXCELLENT"
            status_message = "✓ Connected and receiving live data"
        elif feed_state.get('is_stale'):
            connection_quality = "DEGRADED"
            status_message = "⚠️ Connected but low tick frequency"
        elif feed_state.get('requires_reconnect') and market_status in ("PRE_OPEN", "LIVE"):
            connection_quality = "POOR"
            status_message = "⚠️ Reconnecting to market feed..."
        
        # Check auth status
        if auth_state_manager.requires_login:
            status_message = "🔐 Please login to enable live data"
        
        # Send connection status to client
        print("🔌 [WS-MARKET] Sending connection status...")
        await manager.send_personal(websocket, {
            "type": "connection_status",
            "mode": connection_mode,
            "quality": connection_quality,
            "message": status_message,
            "market_status": market_status,
            "auth_required": auth_state_manager.requires_login,
            "timestamp": datetime.now().isoformat()
        })
        print("✅ [WS-MARKET] Connection status sent")
        
        # Send initial market data snapshot (with REST API fallback)
        print("📊 [WS-MARKET] Fetching initial market data from cache...")
        initial_data = await _get_market_data_with_fallback(cache)
        print(f"📊 [WS-MARKET] Got data for: {list(initial_data.keys())} ({len(initial_data)} symbols)")
        
        # 🔥 CRITICAL FIX: Ensure all snapshot data has FRESH market status
        # Not cached/stale status from when data was last received
        from services.market_feed import get_market_status
        current_market_status = get_market_status()
        
        for symbol, data in initial_data.items():
            if data:
                data["status"] = current_market_status  # Always use current status, not cached
        
        # 🔥 SEND SNAPSHOT IMMEDIATELY - Don't block on analysis generation!
        print("📊 [WS-MARKET] Sending snapshot to client...")
        await manager.send_personal(websocket, {
            "type": "snapshot",
            "data": initial_data,
            "timestamp": datetime.now().isoformat(),
            "marketStatus": current_market_status  # Also include at message level
        })
        print("✅ [WS-MARKET] Snapshot sent to client")
        
        # 🔥 GENERATE ANALYSIS ASYNC - Don't block UI from getting data
        async def generate_analysis_async():
            """Generate analysis in background without blocking snapshot"""
            try:
                from services.instant_analysis import InstantSignal
                print(f"\n{'='*80}")
                print(f"🔍 GENERATING ANALYSIS FOR INITIAL SNAPSHOT (Background Task)")
                print(f"{'='*80}\n")
                
                for symbol, data in initial_data.items():
                    if data:
                        print(f"📊 Processing {symbol}: price={data.get('price')}, has_analysis={bool(data.get('analysis'))}")
                        if not data.get("analysis"):
                            print(f"   → Generating analysis for {symbol}...")
                            analysis_result = await InstantSignal.analyze_tick(data)
                            if analysis_result:
                                data["analysis"] = analysis_result
                                # Update cache with analysis
                                await cache.set_market_data(symbol, data)
                                print(f"   ✅ Analysis generated for {symbol}: signal={analysis_result.get('signal')}, confidence={analysis_result.get('confidence')}")
                            else:
                                print(f"   ❌ Analysis returned None for {symbol}")
                        else:
                            print(f"   ✓ Analysis already present for {symbol}")
                    else:
                        print(f"   ⚠️ No data for {symbol}")
                
                print(f"\n{'='*80}\n")
            except Exception as e:
                print(f"❌ Background analysis error: {e}")
                import traceback
                traceback.print_exc()
        
        # Start analysis in background task
        asyncio.create_task(generate_analysis_async())
        
        # Start heartbeat task with market status refresh
        async def heartbeat():
            from services.market_feed import get_market_status
            from services.feed_watchdog import feed_watchdog
            from services.auth_state_machine import auth_state_manager
            
            while True:
                await asyncio.sleep(settings.ws_ping_interval)
                try:
                    # 🔥 FIX: Include market status in heartbeat to ensure UI always has current status
                    current_status = get_market_status()
                    
                    # 🔥 NEW: Add connection health info to heartbeat
                    feed_metrics = feed_watchdog.get_health_metrics()
                    
                    await manager.send_personal(websocket, {
                        "type": "heartbeat",
                        "timestamp": datetime.now().isoformat(),
                        "connections": manager.connection_count,
                        "marketStatus": current_status,
                        "connectionHealth": {
                            "state": feed_metrics["state"],
                            "is_healthy": feed_metrics["is_healthy"],
                            "is_stale": feed_metrics["is_stale"],
                            "connection_quality": round(feed_metrics.get("connection_quality", 0), 1),
                            "using_rest_fallback": feed_metrics.get("using_rest_fallback", False),
                            "last_tick_seconds_ago": feed_metrics.get("last_tick_seconds_ago"),
                        }
                    })
                except Exception:
                    break
        
        heartbeat_task = asyncio.create_task(heartbeat())
        
        # Keep connection alive and handle incoming messages
        while True:
            try:
                data = await asyncio.wait_for(
                    websocket.receive_text(),
                    timeout=float(settings.ws_timeout)
                )
                
                # Handle ping from client
                if data == "ping":
                    await manager.send_personal(websocket, {
                        "type": "pong",
                        "timestamp": datetime.now().isoformat()
                    })
                    
            except asyncio.TimeoutError:
                # Send keepalive
                try:
                    await manager.send_personal(websocket, {
                        "type": "keepalive",
                        "timestamp": datetime.now().isoformat()
                    })
                except RuntimeError:
                    # WebSocket already closed, break the loop
                    break
            except (WebSocketDisconnect, RuntimeError):
                # Client disconnected or WebSocket not connected
                break
                
    except WebSocketDisconnect:
        pass
    except RuntimeError as e:
        # Handle "WebSocket is not connected" errors silently
        if "not connected" not in str(e):
            print(f"❌ WebSocket runtime error: {e}")
    except Exception as e:
        print(f"❌ WebSocket error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        try:
            heartbeat_task.cancel()
        except:
            pass
        await manager.disconnect(websocket)
        await cache.disconnect()
