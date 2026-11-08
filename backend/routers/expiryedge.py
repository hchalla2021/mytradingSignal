"""Authenticated ExpiryEdge configuration and listed-contract diagnostics."""

import asyncio
from datetime import datetime
import logging
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response
from kiteconnect import KiteConnect
from pydantic import BaseModel

from config import get_settings
from services.app_access import app_access_service
from services.expiryedge import SYMBOLS, UNDERLYINGS, WEEKDAYS, get_config, listed_expiries, save_config
from services.instrument_catalog import instrument_catalog

router = APIRouter(prefix="/api/expiryedge", tags=["ExpiryEdge"])
logger = logging.getLogger(__name__)
IST = ZoneInfo("Asia/Kolkata")


async def expiryedge_operator(
    request: Request,
    app_access_token: str | None = Cookie(default=None),
    x_device_id: str | None = Header(default=None),
    x_expiryedge_intent: str | None = Header(default=None),
) -> str:
    settings = get_settings()
    allowed = {settings.frontend_url.rstrip("/"),
               *(origin.strip().rstrip("/") for origin in settings.cors_origins.split(","))}
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/") not in allowed:
        raise HTTPException(status_code=403, detail="Untrusted ExpiryEdge origin")
    if x_expiryedge_intent != "manual-config":
        raise HTTPException(status_code=403, detail="ExpiryEdge configuration intent header required")
    session = await app_access_service.validate_session(app_access_token, x_device_id)
    if not session.get("authenticated") or session.get("username") != settings.app_access_username:
        raise HTTPException(status_code=401, detail="Sign in with the configured owner app-access session")
    return session["username"]


class ExpiryConfigRequest(BaseModel):
    symbol: Literal["NIFTY", "BANKNIFTY", "SENSEX"]
    expiry_weekday: Literal["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]


@router.get("/config")
async def read_config(response: Response, _: str = Depends(expiryedge_operator)):
    response.headers["Cache-Control"] = "no-store"
    return await asyncio.to_thread(get_config)


@router.put("/config")
async def update_config(payload: ExpiryConfigRequest, response: Response, _: str = Depends(expiryedge_operator)):
    response.headers["Cache-Control"] = "no-store"
    if payload.expiry_weekday not in WEEKDAYS:
        raise HTTPException(status_code=422, detail="Expiry weekday must be Monday through Friday")
    try:
        return await asyncio.to_thread(save_config, payload.symbol, payload.expiry_weekday)
    except OSError as error:
        logger.exception("ExpiryEdge configuration persistence failed")
        raise HTTPException(status_code=503, detail="ExpiryEdge configuration could not be saved") from error


@router.get("/status")
async def read_status(response: Response, _: str = Depends(expiryedge_operator)):
    response.headers["Cache-Control"] = "no-store"
    settings = get_settings()
    if not settings.zerodha_api_key or not settings.zerodha_access_token:
        raise HTTPException(status_code=503, detail="Zerodha credentials are unavailable; connect using the main application")

    def load_contracts():
        kite = KiteConnect(api_key=settings.zerodha_api_key, timeout=5)
        kite.set_access_token(settings.zerodha_access_token)
        result = {}
        for symbol, (exchange, underlying) in UNDERLYINGS.items():
            rows = instrument_catalog.get(kite, exchange)
            result[symbol] = listed_expiries(rows, underlying, datetime.now(IST).date())
        return result

    try:
        instruments = await asyncio.to_thread(load_contracts)
    except Exception as error:
        logger.exception("ExpiryEdge could not refresh broker instrument master")
        raise HTTPException(status_code=503, detail="Current Zerodha instrument master is unavailable") from error

    config = await asyncio.to_thread(get_config)
    reasons = [
        "Authoritative exchange holiday/expiry-adjustment calendar is not configured",
        "ExpiryEdge live execution is disabled; no approved ExpiryEdge order owner is connected",
        "ExpiryEdge-specific live market-data and strategy pipeline is not connected",
    ]
    if any(not config["schedules"][symbol]["weekday"] for symbol in SYMBOLS):
        reasons.insert(0, "Save an expiry weekday for each index before session validation")
    matches = {}
    for symbol, expiries in instruments.items():
        nearest = expiries[0] if expiries else None
        matches[symbol] = {
            "next_listed_expiry": nearest,
            "configured_weekday_matches": (
                bool(nearest) and datetime.fromisoformat(nearest["expiry"]).strftime("%A") ==
                config["schedules"][symbol]["weekday"]
                if config["schedules"][symbol]["weekday"] else None
            ),
            "configured_weekday": config["schedules"][symbol]["weekday"],
        }
    return {
        "service": "ExpiryEdge",
        "market_data": {"state": "NOT_CONNECTED", "last_tick_at": None},
        "instruments": matches,
        "expiry_calendar": {"state": "UNVERIFIED"},
        "live_orders_enabled": False,
        "block_reasons": reasons,
    }
