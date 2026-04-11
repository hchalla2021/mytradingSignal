"""
🕯️ Candle Intelligence Engine — API Router
=============================================
WebSocket:  /ws/candle-intelligence       → real-time candle analysis (2s cadence)
REST:       GET /api/candle-intelligence  → instant snapshot for page load
"""
import asyncio
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from datetime import datetime

from services.candle_intelligence_engine import candle_intel_manager, get_candle_intelligence_service

logger = logging.getLogger(__name__)

http_router = APIRouter()
ws_router = APIRouter()


# ── REST snapshot ─────────────────────────────────────────────────────────────

@http_router.get("/candle-intelligence")
async def get_candle_intelligence_snapshot():
    """Instant Candle Intelligence snapshot — use on page load before WebSocket connects."""
    svc = get_candle_intelligence_service()
    snapshot = svc.get_snapshot()
    return {
        "success": True,
        "data": snapshot,
        "indices": list(snapshot.keys()),
        "timestamp": datetime.utcnow().isoformat(),
    }


# ── WebSocket ─────────────────────────────────────────────────────────────────

@ws_router.websocket("/candle-intelligence")
async def candle_intelligence_websocket(websocket: WebSocket):
    """
    WebSocket endpoint for Candle Intelligence Engine live updates.

    Message types emitted:
        { "type": "candle_intel_snapshot", "data": {...} }    — on connect
        { "type": "candle_intel_update",   "data": {...} }    — every ~2s
        { "type": "candle_intel_heartbeat","timestamp": "…" } — every 30s

    Client can send:
        { "type": "ping" }  → responds with { "type": "pong" }
    """
    await candle_intel_manager.connect(websocket)

    try:
        svc = get_candle_intelligence_service()
        snapshot = svc.get_snapshot()
        if snapshot:
            await candle_intel_manager.send_personal(websocket, {
                "type": "candle_intel_snapshot",
                "data": snapshot,
            })

        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=60)
                msg = json.loads(raw)
                if msg.get("type") == "ping":
                    await candle_intel_manager.send_personal(websocket, {"type": "pong"})
            except asyncio.TimeoutError:
                try:
                    await candle_intel_manager.send_personal(websocket, {
                        "type": "candle_intel_heartbeat",
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
        logger.debug(f"🕯️ Candle Intel WS error: {e}")
    finally:
        await candle_intel_manager.disconnect(websocket)
