"""
🏛️ Advanced SMC & Market Structure — API Router
================================================
WebSocket:  /ws/smc        → real-time structure updates (2s LIVE cadence)
REST:       GET /api/smc   → instant snapshot for page load
"""
import asyncio
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from services.smc_service import smc_manager, get_smc_service

logger = logging.getLogger(__name__)

http_router = APIRouter()
ws_router = APIRouter()


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@http_router.get("/smc")
async def get_smc_snapshot():
    """Latest SMC & market-structure read for all indices."""
    try:
        snapshot = get_smc_service().get_snapshot()
        if not isinstance(snapshot, dict):
            snapshot = {}
        return {
            "success": True,
            "data": snapshot,
            "indices": list(snapshot.keys()),
            "timestamp": _utc_now_iso(),
        }
    except Exception:
        logger.exception("[SMC] snapshot endpoint failure")
        return {
            "success": False,
            "data": {},
            "indices": [],
            "timestamp": _utc_now_iso(),
            "error": "Snapshot unavailable",
        }


@ws_router.websocket("/smc")
async def smc_websocket(websocket: WebSocket):
    """
    Emits:
        { "type": "smc_snapshot", "data": {...} }  — on connect
        { "type": "smc_update",   "data": {...} }  — on material change
        { "type": "smc_heartbeat", ... }           — every 30s idle
    Accepts: { "type": "ping" } → { "type": "pong" }
    """
    await smc_manager.connect(websocket)
    try:
        snapshot = get_smc_service().get_snapshot()
        if snapshot:
            await smc_manager.send_personal(websocket, {
                "type": "smc_snapshot",
                "data": snapshot,
                "timestamp": _utc_now_iso(),
            })

        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                if len(raw) > 2048:
                    continue
                msg = json.loads(raw)
                if msg.get("type") == "ping":
                    await smc_manager.send_personal(websocket, {"type": "pong"})
            except asyncio.TimeoutError:
                try:
                    await smc_manager.send_personal(websocket, {
                        "type": "smc_heartbeat",
                        "timestamp": _utc_now_iso(),
                    })
                except Exception:
                    break
            except json.JSONDecodeError:
                continue

    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("[SMC] WebSocket session error")
    finally:
        await smc_manager.disconnect(websocket)
