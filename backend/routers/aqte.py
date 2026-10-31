"""Read-only AQTE dashboard and an authenticated, one-way paper kill switch."""

import asyncio
import logging
import sqlite3
from typing import Literal

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Query, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from services.aqte_service import get_aqte_service
from services.auth import auth_service
from services.aqte_live import LiveBlocked, get_live_service
from services.app_access import app_access_service
from config import get_settings
from services.aqte_broker_positions import broker_positions
from services.aqte_daily_control import IndexControl

router = APIRouter(prefix="/api/aqte", tags=["AQTE"])
logger = logging.getLogger(__name__)
bearer = HTTPBearer()


def operator(credentials: HTTPAuthorizationCredentials = Depends(bearer)):
    try:
        token = auth_service.verify_token(credentials.credentials)
    except ValidationError as exc:
        logger.warning("AQTE rejected JWT with malformed claims")
        raise HTTPException(status_code=401, detail="Invalid access JWT claims") from exc
    if token is None or token.type != "access":
        raise HTTPException(status_code=401, detail="A valid application access JWT is required")
    return token.sub


@router.get("/snapshot")
async def snapshot(response: Response):
    response.headers["Cache-Control"] = "no-store"
    return await asyncio.to_thread(get_aqte_service().snapshot)


@router.get("/journal")
async def journal(response: Response, limit: int = Query(100, ge=1, le=500)):
    response.headers["Cache-Control"] = "no-store"
    try:
        return await asyncio.to_thread(get_aqte_service().history, limit)
    except sqlite3.Error as exc:
        logger.exception("AQTE journal unavailable")
        raise HTTPException(status_code=503, detail="AQTE journal unavailable") from exc


@router.post("/kill", dependencies=[Depends(operator)])
async def kill():
    if not get_aqte_service().engine.paper_enabled:
        raise HTTPException(status_code=410, detail="AQTE paper trading is disabled; use the separate AQTE live controls")
    try:
        return await asyncio.to_thread(get_aqte_service().kill)
    except sqlite3.Error as exc:
        raise HTTPException(status_code=503, detail="Stop latched but journal write failed") from exc


async def live_operator(
    request: Request,
    app_access_token: str | None = Cookie(default=None),
    x_device_id: str | None = Header(default=None),
    x_aqte_intent: str | None = Header(default=None),
):
    cfg = get_settings()
    allowed = {cfg.frontend_url.rstrip("/"), *(url.strip().rstrip("/") for url in cfg.cors_origins.split(","))}
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/") not in allowed:
        raise HTTPException(status_code=403, detail="Untrusted live-control origin")
    if x_aqte_intent != "manual-live-control":
        raise HTTPException(status_code=403, detail="Explicit live-control intent header required")
    session = await app_access_service.validate_session(app_access_token, x_device_id)
    if not session.get("authenticated") or session.get("username") != cfg.app_access_username:
        raise HTTPException(status_code=401, detail="Sign in with the configured owner app-access session")
    return session["username"]


async def live_call(method, *args):
    try:
        return await asyncio.to_thread(method, *args)
    except LiveBlocked as exc:
        logger.warning("AQTE live request blocked: %s", exc)
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("AQTE live operation failed; inspect broker terminal before retrying")
        raise HTTPException(status_code=503, detail="Live operation failed. Inspect Kite and AQTE status; do not blindly retry.") from exc


class ArmLive(BaseModel):
    confirmation: Literal["ARM REAL TRADING"]


class LiveProposal(BaseModel):
    symbol: Literal["NIFTY", "BANKNIFTY", "SENSEX"]


class ConfirmLive(BaseModel):
    proposal_id: str = Field(min_length=32, max_length=32)
    confirmation: Literal["PLACE REAL ORDER"]


class AutomationLive(BaseModel):
    enabled: bool = Field(strict=True)
    confirmation: Literal["START AUTOMATED REAL TRADING", "STOP NEW ENTRIES"]


class DailyControlUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    symbol: Literal["NIFTY", "BANKNIFTY", "SENSEX"]
    config: IndexControl


class DailyLimitUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    symbol: Literal["NIFTY", "BANKNIFTY", "SENSEX"]
    max_trades: int = Field(ge=1, le=10, strict=True)


@router.post("/live/daily-limit", dependencies=[Depends(live_operator)])
async def save_daily_limit(body: DailyLimitUpdate):
    return await live_call(get_live_service().update_limit, body.symbol, body.max_trades)


@router.get("/live/daily-controls", dependencies=[Depends(live_operator)])
async def daily_controls(response: Response):
    response.headers["Cache-Control"] = "no-store"
    return await live_call(get_live_service().daily_controls)


@router.post("/live/daily-controls", dependencies=[Depends(live_operator)])
async def save_daily_controls(body: DailyControlUpdate):
    return await live_call(get_live_service().update_control, body.symbol, body.config.model_dump())


@router.get("/live/status", dependencies=[Depends(live_operator)])
async def live_status(response: Response):
    response.headers["Cache-Control"] = "no-store"
    return await live_call(get_live_service().status)


@router.get("/live/broker-positions", dependencies=[Depends(live_operator)])
async def live_broker_positions(response: Response):
    response.headers["Cache-Control"] = "no-store"
    return await live_call(broker_positions.snapshot)


@router.post("/live/preflight", dependencies=[Depends(live_operator)])
async def live_preflight():
    return await live_call(get_live_service().preflight)


@router.post("/live/arm", dependencies=[Depends(live_operator)])
async def live_arm(body: ArmLive):
    return await live_call(get_live_service().arm)


@router.post("/live/proposal", dependencies=[Depends(live_operator)])
async def live_proposal(body: LiveProposal):
    return await live_call(get_live_service().proposal, body.symbol)


@router.post("/live/confirm", dependencies=[Depends(live_operator)])
async def live_confirm(body: ConfirmLive):
    return await live_call(get_live_service().confirm, body.proposal_id)


@router.post("/live/stop", dependencies=[Depends(live_operator)])
async def live_stop():
    return await live_call(get_live_service().stop_entries)


@router.post("/live/automation", dependencies=[Depends(live_operator)])
async def live_automation(body: AutomationLive):
    expected = "START AUTOMATED REAL TRADING" if body.enabled else "STOP NEW ENTRIES"
    if body.confirmation != expected:
        raise HTTPException(status_code=422, detail="Automation confirmation does not match the requested state")
    return await live_call(get_live_service().set_automation, body.enabled)
