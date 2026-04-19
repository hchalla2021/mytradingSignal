"""
📊 Market Regime — API Router
===============================
WebSocket:  /ws/market-regime       → real-time regime signals (5s cadence)
REST:       GET /api/market-regime  → instant snapshot for page load
"""
import asyncio
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from datetime import datetime

from services.market_regime_service import regime_manager, get_market_regime_service

logger = logging.getLogger(__name__)

http_router = APIRouter()
ws_router = APIRouter()


# ── REST snapshot ─────────────────────────────────────────────────────────────

@http_router.get("/market-regime")
async def get_market_regime_snapshot():
    """Instant Market Regime snapshot — use on page load before WebSocket connects."""
    svc = get_market_regime_service()
    snapshot = svc.get_snapshot()
    return {
        "success": True,
        "data": snapshot,
        "indices": list(snapshot.keys()),
        "timestamp": datetime.utcnow().isoformat(),
    }


# ── WebSocket ─────────────────────────────────────────────────────────────────

@ws_router.websocket("/market-regime")
async def market_regime_websocket(websocket: WebSocket):
    """
    WebSocket endpoint for Market Regime Intelligence live updates.

    Message types emitted:
        { "type": "regime_snapshot", "data": {...} }    — on connect
        { "type": "regime_update",   "data": {...} }    — every ~5s
        { "type": "regime_heartbeat","timestamp": "…" } — every 30s

    Client can send:
        { "type": "ping" }  → responds with { "type": "pong" }
    """
    await regime_manager.connect(websocket)

    try:
        svc = get_market_regime_service()
        snapshot = svc.get_snapshot()
        if snapshot:
            await regime_manager.send_personal(websocket, {
                "type": "regime_snapshot",
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
        logger.debug("Market Regime WS error: %s", e)
    finally:
        await regime_manager.disconnect(websocket)
