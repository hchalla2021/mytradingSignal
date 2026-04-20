"""
🎯 Strike Intelligence — API Router
=====================================
WebSocket:  /ws/strike-intelligence       → real-time strike signals (5s cadence)
REST:       GET /api/strike-intelligence  → instant snapshot for page load
"""
import asyncio
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from datetime import datetime

from services.strike_intelligence_service import strike_intel_manager, get_strike_intelligence_service

logger = logging.getLogger(__name__)

http_router = APIRouter()
ws_router = APIRouter()


# ── REST snapshot ─────────────────────────────────────────────────────────────

@http_router.get("/strike-intelligence")
async def get_strike_intelligence_snapshot():
    """Instant Strike Intelligence snapshot — use on page load before WebSocket connects."""
    svc = get_strike_intelligence_service()
    snapshot = svc.get_snapshot()
    return {
        "success": True,
        "data": snapshot,
        "indices": list(snapshot.keys()),
        "timestamp": datetime.utcnow().isoformat(),
    }


# ── WebSocket ─────────────────────────────────────────────────────────────────

@ws_router.websocket("/strike-intelligence")
async def strike_intelligence_websocket(websocket: WebSocket):
    """
    WebSocket endpoint for Strike Intelligence live updates.

    Message types emitted:
        { "type": "strike_intel_snapshot", "data": {...} }   — on connect
        { "type": "strike_intel_update",   "data": {...} }   — every ~5s
        { "type": "strike_intel_heartbeat","timestamp": "…" } — every 30s

    Client can send:
        { "type": "ping" }  → responds with { "type": "pong" }
    """
    await strike_intel_manager.connect(websocket)

    try:
        svc = get_strike_intelligence_service()
        snapshot = svc.get_snapshot()
        if snapshot:
            await strike_intel_manager.send_personal(websocket, {
                "type": "strike_intel_snapshot",
                "data": snapshot,
            })

        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
                if msg.get("type") == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))
            except json.JSONDecodeError:
                pass

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug("Strike Intelligence WS error: %s", e)
    finally:
        await strike_intel_manager.disconnect(websocket)
