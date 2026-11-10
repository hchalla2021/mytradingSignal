"""Authenticated ExpiryEdge configuration and listed-contract diagnostics."""

import asyncio
from datetime import datetime
import logging
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response
from kiteconnect import KiteConnect
from pydantic import BaseModel, ConfigDict, Field

from config import get_settings
from services.app_access import app_access_service
from services.expiryedge import SYMBOLS, UNDERLYINGS, WEEKDAYS, get_config, listed_expiries, save_config
from services.aqte_live import get_live_service
from services.expiryedge_ai import live_market_snapshots
from services.instrument_catalog import instrument_catalog
from routers.aqte import live_call, live_operator

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


class ExpiryEdgeAIApproval(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = Field(strict=True)
    confirmation: Literal["ENABLE EXPIRYEDGE AI LIVE TRADING", "STOP EXPIRYEDGE AI ENTRIES"]
    symbol: Literal["NIFTY", "BANKNIFTY", "SENSEX"] = "NIFTY"


class ExpiryEdgeAIExit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    trade_id: str = Field(pattern=r"^EAI[0-9a-f]{13}$")
    confirmation: Literal["CLOSE EXPIRYEDGE AI TRADE"]
    symbol: Literal["NIFTY", "BANKNIFTY", "SENSEX"] | None = None


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
    now = datetime.now(IST)
    strategy_snapshots = await asyncio.to_thread(
        live_market_snapshots, get_live_service().service(), now.timestamp()
    )
    expiry_gates = {}
    for symbol in SYMBOLS:
        nearest = instruments[symbol][0] if instruments[symbol] else None
        configured_weekday = config["schedules"][symbol]["weekday"]
        is_listed_expiry_day = bool(nearest and nearest["expiry"] == now.date().isoformat())
        is_configured_weekday = configured_weekday == now.strftime("%A")
        eligible = is_listed_expiry_day and is_configured_weekday
        expiry_gates[symbol] = {
            "eligible": eligible,
            "is_listed_expiry_day": is_listed_expiry_day,
            "is_configured_weekday": is_configured_weekday,
            "configured_weekday": configured_weekday,
        }
        signal = strategy_snapshots[symbol]["signal"]
        if not eligible:
            if not configured_weekday:
                reason = "Save this index's expiry weekday before evaluating an expiry-day setup"
            elif not is_configured_weekday:
                reason = f"Waiting for the configured {configured_weekday} expiry weekday"
            else:
                reason = "Today is not an expiry date in the current Zerodha option instrument master"
            strategy_snapshots[symbol]["signal"] = {
                **signal, "ready": False, "decision": "WAIT", "side": None,
                "setup_key": None, "reason": reason,
            }
    reasons = [
        "Authoritative exchange holiday/expiry-adjustment calendar is not configured",
    ]
    if any(not config["schedules"][symbol]["weekday"] for symbol in SYMBOLS):
        reasons.insert(0, "Save an expiry weekday for each index before session validation")
    for symbol in SYMBOLS:
        snapshot = strategy_snapshots[symbol]
        if snapshot["market_data"]["state"] != "CONNECTED":
            reasons.append(f"{symbol} futures feed is not fresh in the ExpiryEdge strategy pipeline")
        elif not expiry_gates[symbol]["eligible"]:
            reasons.append(f"{symbol}: {snapshot['signal']['reason']}")
        elif not snapshot["signal"]["ready"]:
            reasons.append(f"{symbol}: {snapshot['signal']['reason']}")
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
        "market_data": strategy_snapshots["NIFTY"]["market_data"],
        "signal": strategy_snapshots["NIFTY"]["signal"],
        "markets": strategy_snapshots,
        "expiry_gates": expiry_gates,
        "instruments": matches,
        "expiry_calendar": {"state": "UNVERIFIED"},
        "live_orders_enabled": bool(settings.aqte_live_enabled and settings.expiryedge_ai_live_enabled),
        "block_reasons": reasons,
    }


@router.get("/live/status", dependencies=[Depends(live_operator)])
async def read_live_status(response: Response, symbol: Literal["NIFTY", "BANKNIFTY", "SENSEX"] = "NIFTY"):
    response.headers["Cache-Control"] = "no-store"
    return await live_call(get_live_service().expiryedge_ai_status, symbol)


@router.post("/live/approval", dependencies=[Depends(live_operator)])
async def approve_live(body: ExpiryEdgeAIApproval, response: Response):
    response.headers["Cache-Control"] = "no-store"
    expected = "ENABLE EXPIRYEDGE AI LIVE TRADING" if body.enabled else "STOP EXPIRYEDGE AI ENTRIES"
    if body.confirmation != expected:
        raise HTTPException(status_code=422, detail="ExpiryEdge AI confirmation does not match the requested action")
    return await live_call(get_live_service().set_expiryedge_ai_enabled, body.enabled, body.symbol)


@router.post("/live/exit", dependencies=[Depends(live_operator)])
async def exit_live(body: ExpiryEdgeAIExit, response: Response):
    response.headers["Cache-Control"] = "no-store"
    if body.confirmation != "CLOSE EXPIRYEDGE AI TRADE":
        raise HTTPException(status_code=422, detail="ExpiryEdge AI exit confirmation is required")
    return await live_call(get_live_service().request_expiryedge_ai_exit, body.trade_id, body.symbol)
