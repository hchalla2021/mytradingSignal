"""Market data WebSocket endpoint."""
import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from datetime import datetime

from services.websocket_manager import manager
from services.cache import CacheService

router = APIRouter()


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
        await manager.send_personal(websocket, {
            "type": "snapshot",
            "data": initial_data,
            "timestamp": datetime.now().isoformat()
        })
        
        # Start heartbeat task
        async def heartbeat():
            while True:
                await asyncio.sleep(30)
                try:
                    await manager.send_personal(websocket, {
                        "type": "heartbeat",
                        "timestamp": datetime.now().isoformat(),
                        "connections": manager.connection_count
                    })
                except Exception:
                    break
        
        heartbeat_task = asyncio.create_task(heartbeat())
        
        # Keep connection alive and handle incoming messages
        while True:
            try:
                data = await asyncio.wait_for(
                    websocket.receive_text(),
                    timeout=60.0
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
        print(f"WebSocket error: {e}")
    finally:
        heartbeat_task.cancel()
        await manager.disconnect(websocket)
        await cache.disconnect()
