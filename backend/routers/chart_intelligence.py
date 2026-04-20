"""
📈 Chart Intelligence — API Router
====================================
WebSocket:  /ws/chart-intelligence       → real-time chart data (3s cadence)
REST:       GET /api/chart-intelligence  → instant snapshot for page load
"""
import asyncio
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from datetime import datetime

from services.chart_intelligence_service import chart_intel_manager, get_chart_intelligence_service

logger = logging.getLogger(__name__)

http_router = APIRouter()
ws_router = APIRouter()


@http_router.get("/chart-intelligence")
async def get_chart_intelligence_snapshot():
    svc = get_chart_intelligence_service()
    snapshot = svc.get_snapshot()
    return {
        "success": True,
        "data": snapshot,
        "indices": list(snapshot.keys()),
        "timestamp": datetime.utcnow().isoformat(),
    }


@ws_router.websocket("/chart-intelligence")
async def chart_intelligence_websocket(websocket: WebSocket):
    await chart_intel_manager.connect(websocket)
    try:
        svc = get_chart_intelligence_service()
        snapshot = svc.get_snapshot()
        if snapshot:
            await chart_intel_manager.send_personal(websocket, {
                "type": "chart_intel_snapshot",
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
        logger.debug("Chart Intelligence WS error: %s", e)
    finally:
        await chart_intel_manager.disconnect(websocket)
