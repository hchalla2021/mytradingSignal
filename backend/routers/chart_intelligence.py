"""
📈 Chart Intelligence — API Router
====================================
WebSocket:  /ws/chart-intelligence       → real-time chart data (3s cadence)
REST:       GET /api/chart-intelligence  → instant snapshot for page load
"""
import asyncio
import json
import logging
from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from datetime import date, datetime
from typing import Optional

from services.chart_intelligence_service import chart_intel_manager, get_chart_intelligence_service
from services.chart_history_service import chart_history_service, ChartHistoryUnavailable
from services.futures_chart_service import futures_chart_service

logger = logging.getLogger(__name__)

http_router = APIRouter()
ws_router = APIRouter()


@http_router.get("/chart-intelligence/futures/contracts")
async def get_futures_contracts(symbol: str = "NIFTY"):
    try:
        return {"contracts": await futures_chart_service.contracts(symbol)}
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except ChartHistoryUnavailable as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@http_router.get("/chart-intelligence/futures/history")
async def get_futures_history(
    token: int = Query(..., gt=0), symbol: str = "NIFTY",
    interval: str = Query("5"), before: Optional[date] = None,
):
    try:
        return await futures_chart_service.page(symbol, interval, token, before)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except ChartHistoryUnavailable as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@http_router.get("/chart-intelligence/history")
async def get_chart_history(symbol: str = "NIFTY", interval: str = Query("5"), before: Optional[date] = None):
    try:
        return await chart_history_service.page(symbol, interval, before)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except ChartHistoryUnavailable as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


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
