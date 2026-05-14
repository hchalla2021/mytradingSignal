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
from datetime import datetime, timezone

from services.market_edge_service import edge_manager, get_market_edge_service

logger = logging.getLogger(__name__)

http_router = APIRouter()
ws_router = APIRouter()


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── REST snapshot ─────────────────────────────────────────────────────────────

@http_router.get("/market-edge")
async def get_market_edge_snapshot():
    """Instant MarketEdge snapshot — use on page load before WebSocket connects."""
    try:
        svc = get_market_edge_service()
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
        logger.exception("[MARKET-EDGE] Snapshot endpoint failure")
        return {
            "success": False,
            "data": {},
            "indices": [],
            "timestamp": _utc_now_iso(),
            "error": "Snapshot unavailable",
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
                if len(raw) > 2048:
                    continue
                msg = json.loads(raw)
                if msg.get("type") == "ping":
                    await edge_manager.send_personal(websocket, {"type": "pong"})
            except asyncio.TimeoutError:
                try:
                    await edge_manager.send_personal(websocket, {
                        "type": "edge_heartbeat",
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
        logger.exception("[MARKET-EDGE] WebSocket session error")
    finally:
        await edge_manager.disconnect(websocket)
