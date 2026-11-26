"""Shared authenticated transport for the retained live trading controller."""

import asyncio
import logging

from fastapi import Cookie, Header, HTTPException, Request
from kiteconnect.exceptions import TokenException

from config import get_settings
from services.app_access import app_access_service
from services.aqte_live import LiveBlocked

logger = logging.getLogger(__name__)


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
    except TokenException as exc:
        logger.warning("Live request blocked: Kite session expired or invalid; broker login required")
        raise HTTPException(status_code=409, detail=(
            "Kite session expired or invalid. Sign in again using the existing Zerodha login; "
            "verify the configured Kite app if login still fails. App-access login is separate."
        )) from exc
    except LiveBlocked as exc:
        logger.warning("Live request blocked: %s", exc)
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Live operation failed; inspect broker terminal before retrying")
        raise HTTPException(
            status_code=503,
            detail="Live operation failed. Inspect Kite and live status; do not blindly retry.",
        ) from exc
