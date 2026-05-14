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
from datetime import datetime, timezone

from services.candle_intelligence_engine import candle_intel_manager, get_candle_intelligence_service

logger = logging.getLogger(__name__)

http_router = APIRouter()
ws_router = APIRouter()


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── REST snapshot ─────────────────────────────────────────────────────────────

@http_router.get("/candle-intelligence")
async def get_candle_intelligence_snapshot():
    """Instant Candle Intelligence snapshot — use on page load before WebSocket connects."""
    try:
        svc = get_candle_intelligence_service()
        snapshot = svc.get_snapshot()
        if not isinstance(snapshot, dict):
            snapshot = {}

        return {
            "success": True,
            "data": snapshot,
            "indices": list(snapshot.keys()),
            "timestamp": _utc_now_iso(),
        }
    except Exception:
        logger.exception("[CANDLE-INTEL] Snapshot endpoint failure")
        return {
            "success": False,
            "data": {},
            "indices": [],
            "timestamp": _utc_now_iso(),
            "error": "Snapshot unavailable",
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
                if len(raw) > 2048:
                    continue
                msg = json.loads(raw)
                if msg.get("type") == "ping":
                    await candle_intel_manager.send_personal(websocket, {"type": "pong"})
            except asyncio.TimeoutError:
                try:
                    await candle_intel_manager.send_personal(websocket, {
                        "type": "candle_intel_heartbeat",
                        "timestamp": _utc_now_iso(),
                    })
                except Exception:
                    break
            except WebSocketDisconnect:
                break
            except json.JSONDecodeError:
                continue

    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("[CANDLE-INTEL] WebSocket session error")
    finally:
        await candle_intel_manager.disconnect(websocket)
