"""
🏦 ICT Smart Money Intelligence — API Router
=============================================
WebSocket:  /ws/ict       → real-time ICT updates (2s cadence)
REST:       GET /api/ict  → instant snapshot for page load

Completely isolated — own WebSocket manager, own computation,
zero shared state with any other service.
"""
import asyncio
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from datetime import datetime

from services.ict_engine import ict_manager, get_ict_service

logger = logging.getLogger(__name__)

http_router = APIRouter()
ws_router = APIRouter()


# ── REST snapshot ─────────────────────────────────────────────────────────────

@http_router.get("/ict")
async def get_ict_snapshot():
    """
    Instant ICT Smart Money snapshot — use on page load before WebSocket connects.
    Returns Order Blocks, FVGs, Market Structure, Sweeps for all indices.
    """
    svc = get_ict_service()
    snapshot = await svc.get_snapshot()
    return {
        "success": True,
        "data": snapshot,
        "indices": list(snapshot.keys()),
        "timestamp": datetime.utcnow().isoformat(),
    }


# ── WebSocket ─────────────────────────────────────────────────────────────────

@ws_router.websocket("/ict")
async def ict_websocket(websocket: WebSocket):
    """
    WebSocket endpoint for ICT Smart Money Intelligence live updates.

    Message types emitted:
        { "type": "ict_snapshot", "data": {...} }   — on connect
        { "type": "ict_update",   "data": {...} }   — every ~2s
        { "type": "ict_heartbeat","timestamp": "…" } — every 30s

    Client can send:
        { "type": "ping" }  → responds with { "type": "pong" }
    """
    await ict_manager.connect(websocket)

    try:
        svc = get_ict_service()
        snapshot = await svc.get_snapshot()
        if snapshot:
            await ict_manager.send_personal(websocket, {
                "type": "ict_snapshot",
                "data": snapshot,
                "timestamp": datetime.utcnow().isoformat(),
            })

        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                msg = json.loads(raw)
                if msg.get("type") == "ping":
                    await ict_manager.send_personal(websocket, {"type": "pong"})
            except asyncio.TimeoutError:
                await ict_manager.send_personal(websocket, {
                    "type": "ict_heartbeat",
                    "timestamp": datetime.utcnow().isoformat(),
                })

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug(f"🏦 ICT WS error: {e}")
    finally:
        await ict_manager.disconnect(websocket)
