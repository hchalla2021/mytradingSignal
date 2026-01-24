"""Market data WebSocket endpoint."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from datetime import datetime
from typing import Dict, Any, Optional

from config import get_settings
from services.websocket_manager import manager
from services.cache import CacheService

router = APIRouter()
settings = get_settings()

# Thread pool for blocking Zerodha calls
_executor = ThreadPoolExecutor(max_workers=2)


def _fetch_zerodha_quotes() -> Dict[str, Any]:
    """Fetch live quotes from Zerodha REST API (blocking call)"""
    try:
        from kiteconnect import KiteConnect
        
        kite = KiteConnect(api_key=settings.zerodha_api_key)
        if settings.zerodha_access_token:
            kite.set_access_token(settings.zerodha_access_token)
        else:
            print("⚠️ No access token for quote fetch")
            return {}
        
        # Fetch all indices
        instruments = ["NSE:NIFTY 50", "NSE:NIFTY BANK", "BSE:SENSEX"]
        quotes = kite.quote(instruments)
        
        results = {}
        symbol_map = {
            "NSE:NIFTY 50": "NIFTY",
            "NSE:NIFTY BANK": "BANKNIFTY", 
            "BSE:SENSEX": "SENSEX"
        }
        
        for inst, symbol in symbol_map.items():
            if inst in quotes:
                q = quotes[inst]
                ohlc = q.get('ohlc', {})
                last_price = q.get('last_price', 0)
                close_price = ohlc.get('close', last_price)
                change = last_price - close_price if close_price else 0
                change_pct = (change / close_price * 100) if close_price else 0
                
                results[symbol] = {
                    "symbol": symbol,
                    "price": last_price,
                    "high": ohlc.get('high', last_price),
                    "low": ohlc.get('low', last_price),
                    "open": ohlc.get('open', last_price),
                    "close": close_price,
                    "volume": q.get('volume', 0),
                    "oi": q.get('oi', 0),
                    "change": change,
                    "changePercent": round(change_pct, 2),
                    "timestamp": datetime.now().isoformat(),
                    "status": "CLOSED",
                    "trend": "bullish" if change > 0 else "bearish" if change < 0 else "neutral",
                }
                print(f"📊 Fetched {symbol}: ₹{last_price:,.2f} ({change_pct:+.2f}%)")
        
        return results
    except Exception as e:
        print(f"❌ Zerodha quote fetch error: {e}")
        return {}


async def _get_market_data_with_fallback(cache: CacheService) -> Dict[str, Any]:
    """Get market data from cache, fallback to Zerodha REST API if empty"""
    # Try cache first
    cached_data = await cache.get_all_market_data()
    
    # Check if we have valid data for all symbols
    symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
    missing = [s for s in symbols if s not in cached_data or not cached_data.get(s) or not cached_data.get(s, {}).get('price')]
    
    if not missing:
        print(f"✅ All market data in cache: {list(cached_data.keys())}")
        return cached_data
    
    # Fetch from Zerodha REST API
    print(f"📡 Cache empty/incomplete for {missing}, fetching from Zerodha REST API...")
    
    loop = asyncio.get_event_loop()
    try:
        zerodha_data = await loop.run_in_executor(_executor, _fetch_zerodha_quotes)
        
        if zerodha_data:
            # Cache the fetched data
            for symbol, data in zerodha_data.items():
                await cache.set_market_data(symbol, data)
                print(f"💾 Cached {symbol}: ₹{data.get('price', 0):,.2f}")
            
            # Merge with any existing cached data
            cached_data.update(zerodha_data)
            print(f"✅ Cached {len(zerodha_data)} symbols from Zerodha REST API")
        else:
            print("⚠️ No data returned from Zerodha REST API")
    except Exception as e:
        print(f"❌ REST API fallback failed: {e}")
        import traceback
        traceback.print_exc()
    
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


@router.websocket("/market")
async def market_websocket(websocket: WebSocket):
    """
    WebSocket endpoint for real-time market data.
    
    Sends:
    - Initial snapshot of all market data
    - Live tick updates as they arrive
    - Heartbeat every 30 seconds
    """
    print("🔌 [WS-MARKET] New WebSocket connection request...")
    await manager.connect(websocket)
    print(f"✅ [WS-MARKET] Client connected. Total clients: {manager.connection_count}")
    
    cache = CacheService()
    await cache.connect()
    
    try:
        # Send initial market data snapshot (with REST API fallback)
        print("📊 [WS-MARKET] Fetching initial market data...")
        initial_data = await _get_market_data_with_fallback(cache)
        print(f"📊 [WS-MARKET] Got data for: {list(initial_data.keys())} ({len(initial_data)} symbols)")
        
        # ✅ INSTANT FIX: Generate analysis for cached data if missing
        try:
            from services.instant_analysis import InstantSignal
            for symbol, data in initial_data.items():
                if data and not data.get("analysis"):
                    print(f"🔍 Generating analysis for cached {symbol} data...")
                    analysis_result = InstantSignal.analyze_tick(data)
                    if analysis_result:
                        data["analysis"] = analysis_result
                        # Update cache with analysis
                        await cache.set_market_data(symbol, data)
                        print(f"✅ Analysis generated and cached for {symbol}")
        except Exception as e:
            print(f"⚠️ Could not generate analysis for cached data: {e}")
        
        await manager.send_personal(websocket, {
            "type": "snapshot",
            "data": initial_data,
            "timestamp": datetime.now().isoformat()
        })
        
        # Start heartbeat task with market status refresh
        async def heartbeat():
            from services.market_feed import get_market_status
            while True:
                await asyncio.sleep(settings.ws_ping_interval)
                try:
                    # 🔥 FIX: Include market status in heartbeat to ensure UI always has current status
                    current_status = get_market_status()
                    await manager.send_personal(websocket, {
                        "type": "heartbeat",
                        "timestamp": datetime.now().isoformat(),
                        "connections": manager.connection_count,
                        "marketStatus": current_status  # Add current market status
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
