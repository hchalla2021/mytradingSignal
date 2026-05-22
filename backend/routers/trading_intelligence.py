"""
⚡ Trading Intelligence Engine — API Router
==========================================
WebSocket:  /ws/intelligence       → real-time AI updates
REST:       GET /api/intelligence  → instant snapshot for page load
"""
import asyncio
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from services.trading_intelligence_engine import (
    intelligence_engine,
    intelligence_manager,
    start_intelligence_loop,
)

logger = logging.getLogger(__name__)

http_router = APIRouter()
ws_router = APIRouter()


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@http_router.get("/intelligence")
async def get_intelligence_snapshot():
    try:
        snaps = await intelligence_engine.snapshot_all()
        return {
            "success": True,
            "data": snaps,
            "indices": list(snaps.keys()),
            "timestamp": _utc_now_iso(),
        }
    except Exception:
        logger.exception("[TIE] Snapshot endpoint failure")
        return {
            "success": False,
            "data": {},
            "indices": [],
            "timestamp": _utc_now_iso(),
            "error": "Snapshot unavailable",
        }


@ws_router.websocket("/intelligence")
async def intelligence_websocket(websocket: WebSocket):
    await intelligence_manager.connect(websocket)
    try:
        await start_intelligence_loop()

        snaps = await intelligence_engine.snapshot_all()
        if snaps:
            await intelligence_manager.send_personal(websocket, {
                "type": "intelligence_snapshot",
                "data": snaps,
                "timestamp": _utc_now_iso(),
            })

        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                if len(raw) > 2048:
                    continue
                msg = json.loads(raw)
                if msg.get("type") == "ping":
                    await intelligence_manager.send_personal(websocket, {"type": "pong"})
            except asyncio.TimeoutError:
                try:
                    await intelligence_manager.send_personal(websocket, {
                        "type": "intelligence_heartbeat",
                        "timestamp": _utc_now_iso(),
                    })
                except Exception:
                    break
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("[TIE] WebSocket session error")
    finally:
        await intelligence_manager.disconnect(websocket)
