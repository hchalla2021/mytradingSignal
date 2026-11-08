from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
import json
import logging
import secrets
from typing import Any
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from config import Settings, get_settings
from pipeline import EventBus, MarketPipeline
from readiness import evaluate_readiness

TZ = ZoneInfo("Asia/Kolkata")
logger = logging.getLogger("morningedge")
app = FastAPI(title="MorningEdge", version="0.1.0")
settings = get_settings()
parsed_frontend_url = urlparse(settings.frontend_url)
frontend_origin = (f"{parsed_frontend_url.scheme}://{parsed_frontend_url.netloc}"
                  if parsed_frontend_url.scheme and parsed_frontend_url.netloc else "")
if frontend_origin:
    app.add_middleware(
        CORSMiddleware, allow_origins=[frontend_origin], allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "OPTIONS"], allow_headers=["Content-Type"],
    )
pipeline = MarketPipeline()
events = EventBus(capacity=settings.event_queue_capacity)
config_state: dict[str, Any] = {
    "per_trade_loss_cap_inr": None, "daily_loss_cap_inr": None,
    "max_trades_per_day": None, "max_lots": 1, "min_model_confidence_pct": 20,
}
armed = False
approved = False
ws_tokens: dict[str, datetime] = {}
browser_sessions: dict[str, datetime] = {}
SESSION_LIFETIME = timedelta(hours=12)


def refresh_shared_zerodha_auth() -> bool:
    try:
        credentials = json.loads(settings.shared_zerodha_auth_file.read_text(encoding="utf-8"))
    except FileNotFoundError:
        settings.api_key = ""
        settings.access_token = ""
        return False
    except (OSError, json.JSONDecodeError) as error:
        raise HTTPException(503, detail="Shared Zerodha credentials are unavailable or invalid") from error
    api_key = credentials.get("api_key") if isinstance(credentials, dict) else None
    access_token = credentials.get("access_token") if isinstance(credentials, dict) else None
    if not isinstance(api_key, str) or not api_key or not isinstance(access_token, str) or not access_token:
        raise HTTPException(503, detail="Shared Zerodha credentials are incomplete")
    settings.api_key = api_key
    settings.access_token = access_token
    return True


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": "MorningEdge", "process": "alive"}


def browser_auth(request: Request) -> str:
    if not refresh_shared_zerodha_auth():
        raise HTTPException(401, detail="Connect Zerodha using the main application login")
    if request.method in {"POST", "PUT"} and frontend_origin:
        if request.headers.get("origin") != frontend_origin:
            raise HTTPException(403, detail="Invalid browser request origin")
    session_id = request.cookies.get("morningedge_session", "")
    expires_at = browser_sessions.get(session_id)
    if not expires_at or expires_at <= datetime.now(TZ):
        browser_sessions.pop(session_id, None)
        raise HTTPException(401, detail="Zerodha connection required")
    return session_id




@app.get("/api/v1/auth/session")
async def auth_session(request: Request, response: Response) -> dict[str, bool]:
    try:
        browser_auth(request)
        return {"authenticated": True, "zerodha_connected": True}
    except HTTPException as error:
        if error.status_code != 401:
            raise
    if not refresh_shared_zerodha_auth():
        return {"authenticated": False, "zerodha_connected": False}
    from kiteconnect import KiteConnect

    try:
        kite = KiteConnect(api_key=settings.api_key)
        kite.set_access_token(settings.access_token)
        await asyncio.to_thread(kite.profile)
    except Exception as error:
        logger.warning("Main Zerodha token validation failed (%s)", type(error).__name__)
        return {"authenticated": False, "zerodha_connected": False}
    now = datetime.now(TZ)
    for session_id, expires in list(browser_sessions.items()):
        if expires <= now:
            browser_sessions.pop(session_id, None)
    session_id = secrets.token_urlsafe(32)
    browser_sessions[session_id] = now + SESSION_LIFETIME
    secure_cookie = settings.frontend_url.startswith("https://")
    response.set_cookie(
        "morningedge_session", session_id, max_age=int(SESSION_LIFETIME.total_seconds()),
        httponly=True, secure=secure_cookie,
        samesite="none" if secure_cookie else "lax", path="/",
    )
    return {"authenticated": True, "zerodha_connected": True}


@app.post("/api/v1/auth/logout")
def logout(request: Request, response: Response, _: str = Depends(browser_auth)) -> dict[str, bool]:
    browser_sessions.pop(request.cookies.get("morningedge_session", ""), None)
    secure_cookie = settings.frontend_url.startswith("https://")
    response.delete_cookie(
        "morningedge_session", path="/", secure=secure_cookie, httponly=True,
        samesite="none" if secure_cookie else "lax",
    )
    return {"authenticated": False}


class RiskConfig(BaseModel):
    per_trade_loss_cap_inr: float | None = Field(default=None, gt=0)
    daily_loss_cap_inr: float | None = Field(default=None, gt=0)
    max_trades_per_day: int | None = Field(default=None, ge=1)
    max_lots: int = Field(default=1, ge=1, le=5)
    min_model_confidence_pct: float = Field(default=20, ge=20, le=100)


def config_json() -> dict[str, Any]:
    return {"risk": dict(config_state), "instruments": ["NIFTY", "BANKNIFTY", "SENSEX"],
            "session_timezone": "Asia/Kolkata", "preopen_data_from": "09:00",
            "no_orders_before": "09:15", "new_entries_end": "10:30"}


def status_json() -> dict[str, Any]:
    now = datetime.now(TZ)
    readiness, reasons = evaluate_readiness(settings, config_state)
    readiness, reasons = readiness, list(reasons)
    if not pipeline.has_fresh_real_data(now):
        reasons.append("No fresh, timestamp-validated real market data")
    if not settings.model_validated:
        reasons.append("Validated model artifact is not configured")
    reasons.append("Independent live order execution has not been implemented")
    if now.weekday() >= 5 or now.strftime("%H:%M") < "09:00" or now.strftime("%H:%M") >= "15:30":
        reasons.append("Outside the Asia/Kolkata market session")
    return {
        "service": "MorningEdge", "readiness": "READY" if not reasons else "NOT_READY",
        "block_reasons": reasons, "armed": armed, "live_approved": approved,
        "live_orders_enabled": False, "websocket_path": "/api/v1/events",
        "session": {"timezone": "Asia/Kolkata", "local_time": now.isoformat(),
                    "preopen_data_from": "09:00", "orders_not_before": "09:15",
                    "new_entries_end": "10:30"},
        "instruments": pipeline.snapshots(), "metrics": pipeline.metrics(),
    }


@app.get("/api/v1/status")
def get_status(_: str = Depends(browser_auth)) -> dict[str, Any]:
    return status_json()


@app.get("/api/v1/config")
def get_config(_: str = Depends(browser_auth)) -> dict[str, Any]:
    return config_json()


@app.put("/api/v1/config")
def put_config(payload: RiskConfig, _: str = Depends(browser_auth)) -> dict[str, Any]:
    now = datetime.now(TZ)
    if now.weekday() < 5 and "09:00" <= now.strftime("%H:%M") < "15:30":
        raise HTTPException(409, detail="Risk configuration can only be changed outside the market session")
    config_state.update(payload.model_dump())
    return config_json()


@app.post("/api/v1/preflight")
def preflight(_: str = Depends(browser_auth)) -> dict[str, Any]:
    status = status_json()
    return {"readiness": status["readiness"], "passed": status["readiness"] == "READY",
            "block_reasons": status["block_reasons"],
            "live_orders_enabled": False}


@app.post("/api/v1/arm")
def arm(_: str = Depends(browser_auth)) -> dict[str, Any]:
    global armed
    status = status_json()
    ready, reasons = status["readiness"], status["block_reasons"]
    if ready != "READY":
        armed = False
        raise HTTPException(409, detail={"readiness": "NOT_READY", "block_reasons": reasons})
    armed = True
    return {"armed": True, "readiness": "READY", "live_orders_enabled": False}


@app.post("/api/v1/approval")
def approve(_: str = Depends(browser_auth)) -> dict[str, Any]:
    global approved
    approved = False
    return {"live_approved": False, "readiness": "NOT_READY",
            "block_reasons": ["Live order execution is deliberately unavailable in this standalone release"]}


@app.post("/api/v1/events/token")
def issue_event_token(_: str = Depends(browser_auth)) -> dict[str, Any]:
    now = datetime.now(TZ)
    for existing, issued in list(ws_tokens.items()):
        if (now - issued).total_seconds() > 60:
            ws_tokens.pop(existing, None)
    token = secrets.token_urlsafe(32)
    ws_tokens[token] = now
    return {"token": token, "expires_in_seconds": 60, "websocket_path": "/api/v1/events"}


@app.websocket("/api/v1/events")
async def event_stream(websocket: WebSocket) -> None:
    token = websocket.query_params.get("token", "")
    issued = ws_tokens.pop(token, None)
    session_id = websocket.cookies.get("morningedge_session", "")
    session_expires = browser_sessions.get(session_id)
    if (frontend_origin and websocket.headers.get("origin") != frontend_origin
            or issued is None or (datetime.now(TZ) - issued).total_seconds() > 60
            or not session_expires or session_expires <= datetime.now(TZ)):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    queue = events.subscribe()
    try:
        while True:
            await websocket.send_json(await queue.get())
    except WebSocketDisconnect:
        pass
    finally:
        events.unsubscribe(queue)
