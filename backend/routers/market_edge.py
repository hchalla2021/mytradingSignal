"""
📈 MarketEdge Intelligence — API Router
=========================================
WebSocket:  /ws/market-edge       → real-time edge signals (3s cadence)
REST:       GET /api/market-edge  → instant snapshot for page load
"""
import asyncio
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from datetime import datetime

from services.market_edge_service import edge_manager, get_market_edge_service

logger = logging.getLogger(__name__)

http_router = APIRouter()
ws_router = APIRouter()


# ── REST snapshot ─────────────────────────────────────────────────────────────

@http_router.get("/market-edge")
async def get_market_edge_snapshot():
    """Instant MarketEdge snapshot — use on page load before WebSocket connects."""
    svc = get_market_edge_service()
    snapshot = svc.get_snapshot()
    return {
        "success": True,
        "data": snapshot,
        "indices": list(snapshot.keys()),
        "timestamp": datetime.utcnow().isoformat(),
    }


# ── WebSocket ─────────────────────────────────────────────────────────────────

@ws_router.websocket("/market-edge")
async def market_edge_websocket(websocket: WebSocket):
    """
    WebSocket endpoint for MarketEdge Intelligence live updates.

    Message types emitted:
        { "type": "edge_snapshot", "data": {...} }    — on connect
        { "type": "edge_update",   "data": {...} }    — every ~3s
        { "type": "edge_heartbeat","timestamp": "…" } — every 30s

    Client can send:
        { "type": "ping" }  → responds with { "type": "pong" }
    """
    await edge_manager.connect(websocket)

    try:
        svc = get_market_edge_service()
        snapshot = svc.get_snapshot()
        if snapshot:
            await edge_manager.send_personal(websocket, {
                "type": "edge_snapshot",
                "data": snapshot,
            })

        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=60)
                msg = json.loads(raw)
                if msg.get("type") == "ping":
                    await edge_manager.send_personal(websocket, {"type": "pong"})
            except asyncio.TimeoutError:
                try:
                    await edge_manager.send_personal(websocket, {
                        "type": "edge_heartbeat",
                        "timestamp": datetime.utcnow().isoformat(),
                    })
                except Exception:
                    break
            except WebSocketDisconnect:
                break
            except json.JSONDecodeError:
                continue

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug(f"📈 MarketEdge WS error: {e}")
    finally:
        await edge_manager.disconnect(websocket)
