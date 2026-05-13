"""Global indices REST + WebSocket router."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from services.global_indices_service import manager, get_global_indices_service

http_router = APIRouter()
ws_router = APIRouter()


@http_router.get("/global-indices")
async def get_global_indices_snapshot():
    svc = get_global_indices_service()
    snap = svc.get_snapshot()
    return {
        "success": True,
        "data": snap,
        "timestamp": datetime.utcnow().isoformat(),
    }


@ws_router.websocket("/global-indices")
async def global_indices_ws(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        svc = get_global_indices_service()
        snap = svc.get_snapshot()
        if snap:
            await manager.send_personal(websocket, {
                "type": "global_indices_snapshot",
                "data": snap,
                "timestamp": datetime.utcnow().isoformat(),
            })

        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                msg = json.loads(raw)
                if msg.get("type") == "ping":
                    await manager.send_personal(websocket, {"type": "pong"})
            except asyncio.TimeoutError:
                await manager.send_personal(websocket, {
                    "type": "global_indices_heartbeat",
                    "timestamp": datetime.utcnow().isoformat(),
                })
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(websocket)
