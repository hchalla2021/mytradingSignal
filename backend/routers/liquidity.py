"""
⚡ Pure Liquidity Intelligence — API Router
==========================================
WebSocket:  /ws/liquidity       → real-time liquidity updates (1.5s cadence)
REST:       GET /api/liquidity  → instant snapshot for page load
"""
import asyncio
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from datetime import datetime

from services.liquidity_service import liquidity_manager, get_liquidity_service

logger = logging.getLogger(__name__)

http_router = APIRouter()
ws_router   = APIRouter()


# ── REST snapshot ─────────────────────────────────────────────────────────────

@http_router.get("/liquidity")
async def get_liquidity_snapshot():
    """
    Instant liquidity snapshot — use on page load before WebSocket connects.
    Returns latest PCR sentiment, OI buildup, price momentum for all indices.
    """
    svc      = get_liquidity_service()
    snapshot = svc.get_snapshot()
    return {
        "success":   True,
        "data":      snapshot,
        "indices":   list(snapshot.keys()),
        "timestamp": datetime.utcnow().isoformat(),
    }


# ── WebSocket ─────────────────────────────────────────────────────────────────

@ws_router.websocket("/liquidity")
async def liquidity_websocket(websocket: WebSocket):
    """
    WebSocket endpoint for Pure Liquidity Intelligence live updates.

    Message types emitted:
        { "type": "liquidity_snapshot", "data": {...} }   — on connect
        { "type": "liquidity_update",   "data": {...} }   — every ~1.5s
        { "type": "liquidity_heartbeat","timestamp": "…" } — every 30s

    Client can send:
        { "type": "ping" }  → responds with { "type": "pong" }
    """
    await liquidity_manager.connect(websocket)

    try:
        svc      = get_liquidity_service()
        snapshot = svc.get_snapshot()
        if snapshot:
            await liquidity_manager.send_personal(websocket, {
                "type":      "liquidity_snapshot",
                "data":      snapshot,
                "timestamp": datetime.utcnow().isoformat(),
            })

        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                msg = json.loads(raw)
                if msg.get("type") == "ping":
                    await liquidity_manager.send_personal(websocket, {"type": "pong"})
            except asyncio.TimeoutError:
                await liquidity_manager.send_personal(websocket, {
                    "type":      "liquidity_heartbeat",
                    "timestamp": datetime.utcnow().isoformat(),
                })

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug(f"⚡ Liquidity WS error: {e}")
    finally:
        await liquidity_manager.disconnect(websocket)
