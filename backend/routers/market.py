"""Market data WebSocket endpoint."""
import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from datetime import datetime

from config import get_settings
from services.websocket_manager import manager
from services.cache import CacheService

router = APIRouter()
settings = get_settings()


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
    await manager.connect(websocket)
    
    cache = CacheService()
    await cache.connect()
    
    try:
        # Send initial market data snapshot
        initial_data = await cache.get_all_market_data()
        
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
                await manager.send_personal(websocket, {
                    "type": "keepalive",
                    "timestamp": datetime.now().isoformat()
                })
                
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"❌ WebSocket error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        heartbeat_task.cancel()
        await manager.disconnect(websocket)
        await cache.disconnect()
