"""Authenticated transport only. Apex has no dependency on other strategy engines."""

import hashlib
import hmac
import logging
import os
import time

import httpx
from fastapi import APIRouter, HTTPException, Request, Response

from config import get_settings
from services.app_access import app_access_service

router = APIRouter(prefix="/api/smc-apex", tags=["SMC Apex AI"])
logger = logging.getLogger(__name__)


@router.api_route("/{path:path}", methods=["GET", "PUT"])
async def proxy(path: str, request: Request):
    allowed = request.method == "GET" and path in {"status", "trade-control"} or request.method == "PUT" and (
        path in {"daily", "trade-control"} or path in {f"config/{s}" for s in ("NIFTY", "BANKNIFTY", "SENSEX")})
    if not allowed:
        raise HTTPException(404, "Unknown Apex endpoint")
    cfg = get_settings()
    session = await app_access_service.validate_session(
        request.cookies.get("app_access_token"), request.headers.get("X-Device-Id"))
    if not session.get("authenticated") or session.get("username") != cfg.app_access_username:
        raise HTTPException(401, "Dashboard owner authentication required")
    if request.method == "PUT":
        origins = {cfg.frontend_url.rstrip("/"), *(u.strip().rstrip("/") for u in cfg.cors_origins.split(","))}
        intent = "manual-live-control" if path == "trade-control" else "save-configuration"
        origin = request.headers.get("origin", "").rstrip("/")
        if not origin or origin not in origins or request.headers.get("X-Apex-Intent") != intent:
            raise HTTPException(403, "Invalid Apex control origin or intent")
    body = await request.body()
    if len(body) > 2048:
        raise HTTPException(413, "Apex request too large")
    secret = os.getenv("SMCAPEX_SERVICE_TOKEN") or cfg.jwt_secret
    if len(secret) < 32:
        raise HTTPException(503, "Apex gateway signing key is not configured")
    stamp = str(time.time())
    service_path = f"/api/{path}"
    message = f"{stamp}\n{request.method}\n{service_path}\n".encode() + body
    headers = {"X-Apex-Time": stamp, "X-Apex-Signature": hmac.new(
        secret.encode(), message, hashlib.sha256).hexdigest(), "Content-Type": "application/json"}
    target = (os.getenv("SMCAPEX_API_URL") or "http://127.0.0.1:8014").rstrip("/") + service_path
    try:
        async with httpx.AsyncClient(timeout=5 if request.method == "GET" and path == "trade-control" else 15) as client:
            result = await client.request(request.method, target, headers=headers, content=body)
    except httpx.HTTPError as exc:
        logger.warning("SMC Apex gateway unavailable: %s", type(exc).__name__)
        raise HTTPException(503, "Independent SMC Apex service unavailable; live status cannot be verified") from exc
    return Response(result.content, status_code=result.status_code, media_type="application/json",
                    headers={"Cache-Control": "no-store"})
