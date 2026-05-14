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
from datetime import datetime, timezone

from services.liquidity_service import liquidity_manager, get_liquidity_service

logger = logging.getLogger(__name__)

http_router = APIRouter()
ws_router   = APIRouter()


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── REST snapshot ─────────────────────────────────────────────────────────────

@http_router.get("/liquidity")
async def get_liquidity_snapshot():
    """
    Instant liquidity snapshot — use on page load before WebSocket connects.
    Returns latest PCR sentiment, OI buildup, price momentum for all indices.
    """
    try:
        svc = get_liquidity_service()
        snapshot = svc.get_snapshot()
        if not isinstance(snapshot, dict):
            snapshot = {}

        return {
            "success":   True,
            "data":      snapshot,
            "indices":   list(snapshot.keys()),
            "timestamp": _utc_now_iso(),
        }
    except Exception:
        logger.exception("[LIQUIDITY] Snapshot endpoint failure")
        return {
            "success": False,
            "data": {},
            "indices": [],
            "timestamp": _utc_now_iso(),
            "error": "Snapshot unavailable",
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
                "timestamp": _utc_now_iso(),
            })

        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                if len(raw) > 2048:
                    continue
                msg = json.loads(raw)
                if msg.get("type") == "ping":
                    await liquidity_manager.send_personal(websocket, {"type": "pong"})
            except asyncio.TimeoutError:
                try:
                    await liquidity_manager.send_personal(websocket, {
                        "type":      "liquidity_heartbeat",
                        "timestamp": _utc_now_iso(),
                    })
                except Exception:
                    break

    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("[LIQUIDITY] WebSocket session error")
    finally:
        await liquidity_manager.disconnect(websocket)
