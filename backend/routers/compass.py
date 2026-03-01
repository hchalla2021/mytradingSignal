"""
Institutional Market Compass — API Router
==========================================
WebSocket: /ws/compass       → real-time compass updates (2s cadence)
REST:       GET /api/compass  → instant snapshot for page load
"""
import asyncio
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from datetime import datetime

from services.compass_service import compass_manager, get_compass_service

logger = logging.getLogger(__name__)

# Two separate routers so each can be mounted under its own prefix
http_router = APIRouter()
ws_router   = APIRouter()


# ── REST snapshot ────────────────────────────────────────────────────

@http_router.get("/compass")
async def get_compass_snapshot():
    """
    Instant compass snapshot — use this on page load before WebSocket connects.
    Returns the latest computed direction/confidence for all three indices.
    """
    svc = get_compass_service()
    snapshot = svc.get_snapshot()
    return {
        "success": True,
        "data": snapshot,
        "indices": list(snapshot.keys()),
        "timestamp": datetime.utcnow().isoformat(),
    }


# ── WebSocket ────────────────────────────────────────────────────────────

@ws_router.websocket("/compass")
async def compass_websocket(websocket: WebSocket):
    """
    WebSocket endpoint for Institutional Market Compass live updates.

    Message types emitted:
        { "type": "compass_snapshot", "data": {...} }   — on connect
        { "type": "compass_update",   "data": {...} }   — every ~2s
        { "type": "compass_heartbeat","timestamp": "…" } — every 30s

    Client can send:
        { "type": "ping" }  → responds with { "type": "pong" }
    """
    await compass_manager.connect(websocket)

    try:
        # Send immediate snapshot for zero-latency page load
        svc = get_compass_service()
        snapshot = svc.get_snapshot()
        if snapshot:
            await compass_manager.send_personal(websocket, {
                "type": "compass_snapshot",
                "data": snapshot,
                "timestamp": datetime.utcnow().isoformat(),
            })

        # Keep-alive loop
        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                msg = json.loads(raw)
                if msg.get("type") == "ping":
                    await compass_manager.send_personal(websocket, {"type": "pong"})
            except asyncio.TimeoutError:
                # Heartbeat every 30 seconds
                await compass_manager.send_personal(websocket, {
                    "type": "compass_heartbeat",
                    "timestamp": datetime.utcnow().isoformat(),
                })

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug(f"🧭 Compass WS error: {e}")
    finally:
        await compass_manager.disconnect(websocket)

