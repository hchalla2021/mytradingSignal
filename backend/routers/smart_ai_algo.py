"""
🤖 Smart AI Algo Router
=======================
REST + WebSocket endpoints for the Smart AI Algo section.

Endpoints:
  GET  /api/algo/signals         → all 3 symbols snapshot
  GET  /api/algo/signals/{sym}   → single symbol
  POST /api/algo/adjust          → update SL/Target for a symbol
  GET  /api/algo/status          → algo on/off state
  POST /api/algo/toggle          → enable/disable AI enrichment
  WS   /ws/algo                  → live stream (2s cadence)
"""

import asyncio
import logging
import time
from typing import Any, Dict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from pydantic import BaseModel, Field

from config import get_settings
from services.smart_ai_algo_service import get_algo_service

logger = logging.getLogger(__name__)

http_router = APIRouter(prefix="/api/algo", tags=["smart-ai-algo"])
ws_router = APIRouter(tags=["smart-ai-algo-ws"])

VALID_SYMBOLS = {"NIFTY", "BANKNIFTY", "SENSEX"}


# ── REST ─────────────────────────────────────────────────────────────────────

@http_router.get("/signals")
async def get_all_signals() -> Dict[str, Any]:
    svc = get_algo_service()
    return {
        "status": "ok",
        "data": svc.get_all_results(),
        "ai_enabled": svc.get_ai_enabled(),
        "ts": int(time.time() * 1000),
    }


@http_router.get("/signals/{symbol}")
async def get_signal(symbol: str) -> Dict[str, Any]:
    symbol = symbol.upper()
    if symbol not in VALID_SYMBOLS:
        raise HTTPException(status_code=404, detail=f"Unknown symbol: {symbol}")
    svc = get_algo_service()
    return {
        "status": "ok",
        "data": svc.get_result(symbol),
        "ai_enabled": svc.get_ai_enabled(),
        "ts": int(time.time() * 1000),
    }


@http_router.get("/status")
async def get_status() -> Dict[str, Any]:
    """Return current on/off state of AI enrichment."""
    svc = get_algo_service()
    settings = get_settings()
    return {
        "status": "ok",
        "ai_enabled": svc.get_ai_enabled(),
        "auto_trade_enabled": settings.algo_auto_trade_enabled,
        "auto_trade_mode": (settings.algo_auto_trade_mode or "paper").lower().strip(),
        "min_trade_confidence": int(settings.algo_min_trade_confidence),
        "min_trade_strength": int(settings.algo_min_trade_strength),
        "trade_cooldown_sec": int(settings.algo_trade_cooldown_sec),
        "live_exchange": (settings.algo_live_exchange or "NFO").upper().strip(),
        "ts": int(time.time() * 1000),
    }


@http_router.get("/trades")
async def get_trades(limit: int = 100) -> Dict[str, Any]:
    """Recent auto-trade events for Smart AI Algo (paper/live)."""
    svc = get_algo_service()
    trades = svc.get_trade_history(limit=limit)
    return {
        "status": "ok",
        "count": len(trades),
        "data": trades,
        "ts": int(time.time() * 1000),
    }


class AdjustRequest(BaseModel):
    symbol: str
    sl_points: float = Field(default=10.0, ge=1, le=500)
    target_points: float = Field(default=15.0, ge=1, le=1000)


@http_router.post("/adjust")
async def adjust_sl_target(req: AdjustRequest) -> Dict[str, Any]:
    sym = req.symbol.upper()
    if sym not in VALID_SYMBOLS:
        raise HTTPException(status_code=404, detail=f"Unknown symbol: {sym}")
    svc = get_algo_service()
    svc.update_sl_target(sym, req.sl_points, req.target_points)
    return {
        "status": "ok",
        "symbol": sym,
        "sl_points": req.sl_points,
        "target_points": req.target_points,
    }


class ToggleRequest(BaseModel):
    enabled: bool


@http_router.post("/toggle")
async def toggle_algo(req: ToggleRequest) -> Dict[str, Any]:
    """Enable or disable AI (OpenAI) enrichment.
    Rule-based signals always continue — only token spend stops when disabled.
    """
    svc = get_algo_service()
    svc.set_ai_enabled(req.enabled)
    return {
        "status": "ok",
        "ai_enabled": req.enabled,
        "message": "AI enrichment ENABLED" if req.enabled else "AI enrichment DISABLED — zero token spend",
        "ts": int(time.time() * 1000),
    }


# ── WebSocket ────────────────────────────────────────────────────────────────

@ws_router.websocket("/ws/algo")
async def ws_algo(websocket: WebSocket) -> None:
    await websocket.accept()
    svc = get_algo_service()
    try:
        # Send initial snapshot + ai_enabled state immediately
        await websocket.send_json({
            "type": "snapshot",
            "data": svc.get_all_results(),
            "ai_enabled": svc.get_ai_enabled(),
            "ts": int(time.time() * 1000),
        })

        while True:
            await asyncio.sleep(2)
            await websocket.send_json({
                "type": "update",
                "data": svc.get_all_results(),
                "ai_enabled": svc.get_ai_enabled(),
                "ts": int(time.time() * 1000),
            })
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.debug("Algo WS closed: %s", exc)
        try:
            await websocket.close()
        except Exception:
            pass
