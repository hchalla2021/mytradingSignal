"""Global Impact Radar — REST + WebSocket routers."""

from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from services.global_news_service import get_global_news_service

http_router = APIRouter()
ws_router   = APIRouter()
logger      = logging.getLogger(__name__)

# Cache-Control max-age matches the backend refresh interval (5 min = 300s)
_CACHE_MAX_AGE = 60  # seconds — conservative: allow 1-min client-side caching


@http_router.get("/global-news")
async def get_global_news() -> JSONResponse:
    """
    Returns the latest global news snapshot with HTTP cache headers.
    ETag enables conditional GET so repeat polls skip the response body
    when data has not changed — reducing unnecessary data transfer.

    Lazy-initialization: if the background boot silently failed to start
    the service (exception swallowed in _boot_services), the first incoming
    request triggers a synchronous refresh so data is always returned.
    """
    svc = get_global_news_service()

    # Lazy fallback: service was never initialized during boot
    if svc._cache is None:
        logger.warning("GlobalNewsService cache is None — boot likely failed. "
                       "Triggering lazy refresh on first request.")
        try:
            await svc._refresh()
        except Exception as exc:  # noqa: BLE001
            logger.error("Lazy refresh failed: %s", exc, exc_info=True)

    snap = svc.get_snapshot()

    payload = {
        "success": True,
        "data": snap,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    # Stable ETag derived from item IDs + heat score — cheap to compute
    etag_source = f"{snap.get('total', 0)}:{snap.get('heat_score', 0)}:{snap.get('last_updated', '')}"
    etag = f'"{hashlib.md5(etag_source.encode()).hexdigest()[:16]}"'  # noqa: S324 — non-security use

    return JSONResponse(
        content=payload,
        headers={
            "Cache-Control": f"public, max-age={_CACHE_MAX_AGE}, stale-while-revalidate=30",
            "ETag": etag,
        },
    )


async def _ws_global_news_handler(websocket: WebSocket) -> None:
    """Live push WebSocket — sends a new snapshot to the client on every RSS refresh."""
    svc = get_global_news_service()
    await websocket.accept()
    # Lazy init in case the background boot silently failed
    if svc._cache is None:
        try:
            await svc._refresh()
        except Exception as exc:
            logger.error("WS lazy refresh failed: %s", exc, exc_info=True)
    svc._ws_clients.add(websocket)
    try:
        # Send current snapshot immediately so the client has data on connect
        await websocket.send_json(svc.get_snapshot())
        while True:
            try:
                # Wait for any client frame (we don't expect any, but must drain)
                await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
            except asyncio.TimeoutError:
                # Keepalive ping every 30 s
                await websocket.send_json({"type": "ping"})
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        svc._ws_clients.discard(websocket)
        try:
            await websocket.close()
        except Exception:
            pass


@ws_router.websocket("/global-news")
async def ws_global_news(websocket: WebSocket) -> None:
    await _ws_global_news_handler(websocket)


@ws_router.websocket("/market/ws/global-news")
async def ws_global_news_legacy(websocket: WebSocket) -> None:
    """Compatibility endpoint for older frontend bundles.

    Legacy clients appended /ws/global-news to a /ws/market base URL,
    producing /ws/market/ws/global-news.
    """
    await _ws_global_news_handler(websocket)
