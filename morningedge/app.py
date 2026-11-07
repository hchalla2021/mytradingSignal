from __future__ import annotations

from datetime import datetime
import secrets
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from config import Settings, get_settings
from pipeline import EventBus, MarketPipeline
from readiness import evaluate_readiness

TZ = ZoneInfo("Asia/Kolkata")
app = FastAPI(title="MorningEdge", version="0.1.0")
settings = get_settings()
pipeline = MarketPipeline()
events = EventBus(capacity=settings.event_queue_capacity)
config_state: dict[str, Any] = {
    "per_trade_loss_cap_inr": None, "daily_loss_cap_inr": None,
    "max_trades_per_day": None, "max_lots": 1, "min_model_confidence_pct": 20,
}
armed = False
approved = False
ws_tokens: dict[str, datetime] = {}


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": "MorningEdge", "process": "alive"}


def operator_auth(authorization: str | None = Header(default=None)) -> None:
    if not settings.operator_token:
        raise HTTPException(503, detail={"readiness": "NOT_READY", "block_reason": "MORNINGEDGE_OPERATOR_TOKEN is not configured"})
    if not authorization or not secrets.compare_digest(authorization, f"Bearer {settings.operator_token}"):
        raise HTTPException(401, detail="Invalid operator credentials")


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
def get_status(_: None = Depends(operator_auth)) -> dict[str, Any]:
    return status_json()


@app.get("/api/v1/config")
def get_config(_: None = Depends(operator_auth)) -> dict[str, Any]:
    return config_json()


@app.put("/api/v1/config")
def put_config(payload: RiskConfig, _: None = Depends(operator_auth)) -> dict[str, Any]:
    now = datetime.now(TZ)
    if now.weekday() < 5 and "09:00" <= now.strftime("%H:%M") < "15:30":
        raise HTTPException(409, detail="Risk configuration can only be changed outside the market session")
    config_state.update(payload.model_dump())
    return config_json()


@app.post("/api/v1/preflight")
def preflight(_: None = Depends(operator_auth)) -> dict[str, Any]:
    status = status_json()
    return {"readiness": status["readiness"], "passed": status["readiness"] == "READY",
            "block_reasons": status["block_reasons"],
            "live_orders_enabled": False}


@app.post("/api/v1/arm")
def arm(_: None = Depends(operator_auth)) -> dict[str, Any]:
    global armed
    status = status_json()
    ready, reasons = status["readiness"], status["block_reasons"]
    if ready != "READY":
        armed = False
        raise HTTPException(409, detail={"readiness": "NOT_READY", "block_reasons": reasons})
    armed = True
    return {"armed": True, "readiness": "READY", "live_orders_enabled": False}


@app.post("/api/v1/approval")
def approve(_: None = Depends(operator_auth)) -> dict[str, Any]:
    global approved
    approved = False
    return {"live_approved": False, "readiness": "NOT_READY",
            "block_reasons": ["Live order execution is deliberately unavailable in this standalone release"]}


@app.post("/api/v1/events/token")
def issue_event_token(_: None = Depends(operator_auth)) -> dict[str, Any]:
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
    if issued is None or (datetime.now(TZ) - issued).total_seconds() > 60:
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
