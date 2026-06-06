"""FII / DII REST + WebSocket router.

HTTP:
  GET /api/fii-dii          - cached official snapshot
  GET /api/fii-dii?force=1  - force official re-fetch

WebSocket:
  /ws/fii-dii               - hybrid live stream (official + realtime inference)
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from services.cache import get_cache
from services.fii_dii_realtime_ai import fii_dii_realtime_ai_engine
from services.fii_dii_service import fii_dii_service

router = APIRouter()
ws_router = APIRouter()

_SYMBOLS = ("NIFTY", "BANKNIFTY", "SENSEX")
_OFFICIAL_REFRESH_SEC = 60
_REALTIME_PUSH_SEC = 2


class _FIIDIIWSManager:
    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections.add(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(websocket)

    async def send_personal(self, websocket: WebSocket, payload: dict) -> None:
        await websocket.send_json(payload)


_ws_manager = _FIIDIIWSManager()


async def _build_realtime_snapshot() -> dict:
    """Build realtime proxy from latest live market ticks in cache.

    This does not mutate official FII/DII numbers; it provides low-latency
    directional inference between official publishes.
    """
    cache = get_cache()
    market = await cache.get_all_market_data()

    for symbol in _SYMBOLS:
        tick = market.get(symbol) if isinstance(market, dict) else None
        if isinstance(tick, dict) and tick.get("price"):
            fii_dii_realtime_ai_engine.update_tick(symbol, tick)

    snap = fii_dii_realtime_ai_engine.get_snapshot()
    if not snap:
        return {
            "generatedAt": datetime.utcnow().isoformat(),
            "aggregate": {
                "fiiScore": 0,
                "diiScore": 0,
                "aggregateScore": 0,
                "confidence": 0,
                "signal": "BALANCED",
                "inflowCr": 0.0,
                "outflowCr": 0.0,
                "netCr": 0.0,
                "grossCr": 0.0,
                "note": "Realtime inference waiting for live ticks.",
            },
            "indices": {},
            "models": {
                "numpy": True,
                "lightgbm": False,
                "pytorch": False,
                "tensorflow": False,
            },
        }
    return snap


@router.get("/fii-dii", tags=["FII / DII"])
async def get_fii_dii(force: bool = Query(False, description="Bypass cache and re-fetch from source")):
    official = await fii_dii_service.get_snapshot(force=force)
    realtime = await _build_realtime_snapshot()
    return {
        **official,
        "realtime": realtime,
    }


@ws_router.websocket("/fii-dii")
async def fii_dii_websocket(websocket: WebSocket):
    await _ws_manager.connect(websocket)
    try:
        official = await fii_dii_service.get_snapshot(force=False)
        realtime = await _build_realtime_snapshot()
        await _ws_manager.send_personal(
            websocket,
            {
                "type": "fii_dii_snapshot",
                "data": {
                    "official": official,
                    "realtime": realtime,
                },
                "timestamp": datetime.utcnow().isoformat(),
            },
        )

        official_refresh_due = asyncio.get_event_loop().time() + _OFFICIAL_REFRESH_SEC
        realtime_push_due = asyncio.get_event_loop().time() + _REALTIME_PUSH_SEC

        while True:
            now = asyncio.get_event_loop().time()
            timeout = max(0.1, min(official_refresh_due, realtime_push_due) - now)

            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=timeout)
                msg = json.loads(raw)
                if msg.get("type") == "ping":
                    await _ws_manager.send_personal(websocket, {"type": "pong"})
            except asyncio.TimeoutError:
                pass

            now = asyncio.get_event_loop().time()
            if now >= realtime_push_due:
                realtime = await _build_realtime_snapshot()
                await _ws_manager.send_personal(
                    websocket,
                    {
                        "type": "fii_dii_realtime_update",
                        "data": realtime,
                        "timestamp": datetime.utcnow().isoformat(),
                    },
                )
                realtime_push_due = now + _REALTIME_PUSH_SEC

            if now >= official_refresh_due:
                official = await fii_dii_service.get_snapshot(force=False)
                await _ws_manager.send_personal(
                    websocket,
                    {
                        "type": "fii_dii_official_update",
                        "data": official,
                        "timestamp": datetime.utcnow().isoformat(),
                    },
                )
                official_refresh_due = now + _OFFICIAL_REFRESH_SEC

    except WebSocketDisconnect:
        pass
    finally:
        await _ws_manager.disconnect(websocket)
