"""
💥 Expiry Explosion Zone — API Router
=======================================
WebSocket:  /ws/expiry-explosion        → real-time expiry signals (2s cadence)
REST:       GET /api/expiry-explosion   → instant snapshot for page load
"""
import asyncio
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from datetime import datetime

from services.expiry_explosion_service import expiry_manager, get_expiry_explosion_service

logger = logging.getLogger(__name__)

http_router = APIRouter()
ws_router = APIRouter()


# ── REST snapshot ─────────────────────────────────────────────────────────────

@http_router.get("/expiry-explosion")
async def get_expiry_explosion_snapshot():
    """
    Instant expiry explosion snapshot — use on page load before WebSocket connects.
    Returns latest gamma/OI/volume/PCR analysis for all indices.
    """
    svc = get_expiry_explosion_service()
    snapshot = svc.get_snapshot()
    return {
        "success": True,
        "data": snapshot,
        "indices": list(snapshot.keys()),
        "timestamp": datetime.utcnow().isoformat(),
    }


# ── WebSocket ─────────────────────────────────────────────────────────────────

@ws_router.websocket("/expiry-explosion")
async def expiry_explosion_websocket(websocket: WebSocket):
    """
    WebSocket endpoint for Expiry Explosion Zone live updates.

    Message types emitted:
        { "type": "expiry_snapshot", "data": {...} }    — on connect
        { "type": "expiry_update",   "data": {...} }    — every ~2s
        { "type": "expiry_heartbeat","timestamp": "…" } — every 30s

    Client can send:
        { "type": "ping" }  → responds with { "type": "pong" }
    """
    await expiry_manager.connect(websocket)

    try:
        svc = get_expiry_explosion_service()
        snapshot = svc.get_snapshot()
        if snapshot:
            await expiry_manager.send_personal(websocket, {
                "type": "expiry_snapshot",
                "data": snapshot,
            })

        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=60)
                msg = json.loads(raw)
                if msg.get("type") == "ping":
                    await expiry_manager.send_personal(websocket, {"type": "pong"})
            except asyncio.TimeoutError:
                # Send keepalive
                try:
                    await expiry_manager.send_personal(websocket, {
                        "type": "expiry_heartbeat",
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
        logger.debug(f"💥 Expiry WS error: {e}")
    finally:
        await expiry_manager.disconnect(websocket)
