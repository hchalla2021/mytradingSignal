"""AUTONOMIQ PRO HTTP API — independent of every other trading section."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict

from config import get_settings
from services.app_access import app_access_service
from services.autonomiq_pro.live_executor import LiveExecutionBlocked
from services.autonomiq_pro.orchestrator import get_orchestrator

router = APIRouter(prefix="/api/autonomiq-pro", tags=["AUTONOMIQ PRO"])
logger = logging.getLogger(__name__)


async def owner(
    request: Request,
    app_access_token: str | None = Cookie(default=None),
    x_device_id: str | None = Header(default=None),
    x_autonomiq_intent: str | None = Header(default=None),
) -> str:
    cfg = get_settings()
    allowed = {cfg.frontend_url.rstrip("/"), *(u.strip().rstrip("/") for u in cfg.cors_origins.split(","))}
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/") not in allowed:
        raise HTTPException(status_code=403, detail="Untrusted origin")
    if x_autonomiq_intent != "operator-control":
        raise HTTPException(status_code=403, detail="Explicit operator intent header required")
    session = await app_access_service.validate_session(app_access_token, x_device_id)
    if not session.get("authenticated") or session.get("username") != cfg.app_access_username:
        raise HTTPException(status_code=401, detail="Sign in with the owner app-access session")
    return session["username"]


class ControlRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    engine_enabled: bool | None = None
    auto_paper_trading: bool | None = None
    kill_switch: bool | None = None
    live_trading_enabled: bool | None = None
    confirm_live: str | None = None


def _service():
    service = get_orchestrator()
    if not service.running:
        raise HTTPException(status_code=503, detail="AUTONOMIQ PRO engine is not running")
    return service


@router.get("/snapshot")
async def snapshot(response: Response):
    response.headers["Cache-Control"] = "no-store"
    try:
        return await _service().snapshot()
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — never leak internals
        logger.exception("AUTONOMIQ PRO snapshot failed")
        raise HTTPException(status_code=503, detail="AUTONOMIQ PRO snapshot unavailable") from exc


@router.get("/health")
async def health(response: Response):
    response.headers["Cache-Control"] = "no-store"
    service = get_orchestrator()
    return {"module": "autonomiq-pro", **service.health()}


@router.post("/control")
async def control(body: ControlRequest, actor: str = Depends(owner)):
    changes = body.model_dump(exclude_none=True)
    confirm_live = changes.pop("confirm_live", None)
    if not changes:
        raise HTTPException(status_code=422, detail="No control change supplied")
    if changes.get("auto_paper_trading"):
        raise HTTPException(status_code=409, detail="Simulated trading has been disabled")
    if changes.get("live_trading_enabled") and confirm_live != "ENABLE_AUTONOMIQ_LIVE_TRADING":
        raise HTTPException(status_code=409, detail="Explicit live-trading confirmation is required")
    try:
        return await _service().control(actor, changes, confirm_live=confirm_live)
    except LiveExecutionBlocked as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/analyze")
async def analyze(actor: str = Depends(owner)):
    service = _service()
    runtime = service.runtime()
    if runtime["kill_switch"] or not runtime["engine_enabled"]:
        raise HTTPException(status_code=409, detail="Engine disabled or kill switch engaged")
    started = service.trigger("MANUAL")
    await asyncio.to_thread(service.store.audit, actor, "manual_analyze", {"started": started})
    return {"started": started, "detail": (
        "Analysis started; quant setup must pass and one AI call is allowed per 5-minute slot"
        if started else "An analysis is already running or this 5-minute slot is already claimed"
    )}
