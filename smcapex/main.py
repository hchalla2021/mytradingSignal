from __future__ import annotations

import hashlib
import hmac
import math
from contextlib import asynccontextmanager
from datetime import datetime
from time import time as epoch

from fastapi import Depends, FastAPI, HTTPException, Request

from .config import DailyRisk, IndexRisk, TradeControl, anthropic_key, credentials
from .engine import IST, SYMBOLS
from .runtime import Runtime

runtime: Runtime | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global runtime
    runtime = Runtime()
    runtime.start()
    try:
        yield
    finally:
        runtime.stop()


async def gateway(request: Request):
    stamp = request.headers.get("X-Apex-Time", "")
    try:
        seconds = float(stamp)
    except ValueError as exc:
        raise HTTPException(403, "Missing signed gateway request") from exc
    if not math.isfinite(seconds) or abs(epoch() - seconds) > 30:
        raise HTTPException(403, "Expired gateway request")
    cfg = credentials()
    secret = cfg.get("SMCAPEX_SERVICE_TOKEN") or cfg.get("JWT_SECRET")
    if not secret or len(secret) < 32:
        raise HTTPException(503, "Apex gateway signing key is not configured")
    body = await request.body()
    if len(body) > 2048:
        raise HTTPException(413, "Request too large")
    message = f"{stamp}\n{request.method}\n{request.url.path}\n".encode() + body
    signature = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, request.headers.get("X-Apex-Signature", "")):
        raise HTTPException(403, "Invalid gateway signature")


app = FastAPI(title="SMC Apex AI", lifespan=lifespan)


def service() -> Runtime:
    if runtime is None:
        raise HTTPException(503, "Apex service starting")
    return runtime


@app.get("/health")
def health():
    current = service()
    if not current.worker or not current.worker.is_alive():
        raise HTTPException(503, "Apex worker is not running")
    return {"service": "SMC Apex AI", "feed": current.feed, "live": current.executor.enabled}


@app.get("/api/status", dependencies=[Depends(gateway)])
def status():
    return service().status()


@app.get("/api/trade-control", dependencies=[Depends(gateway)])
async def control_status():
    current = service()
    cfg = credentials()
    blockers = []
    live_enabled = cfg.get("LIVE_TRADE_ENABLED", "").lower() == "true"
    if not live_enabled:
        blockers.append("Live order permission is disabled: set LIVE_TRADE_ENABLED=true.")
    if not cfg.get("AI_MODEL"):
        blockers.append("Set AI_MODEL for Claude approval.")
    if not anthropic_key(cfg):
        blockers.append("Anthropic approval key unavailable.")
    missing = [symbol for symbol in SYMBOLS if symbol not in current.configured_indices]
    if missing:
        blockers.append(f"Save risk settings for {', '.join(missing)}.")
    if not current.daily_configured:
        blockers.append("Save the Apex daily loss limit.")
    if current.feed != "CONNECTED" or not current.history_loaded:
        blockers.append("Waiting for the independent feed and candle history.")
    blockers.extend(current.connection_warnings())
    if current.executor.halted:
        blockers.append(current.executor.halted)
    return {"live": current.executor.enabled, "at": datetime.now(IST).isoformat(), "block_reasons": blockers}


@app.put("/api/config/{symbol}", dependencies=[Depends(gateway)])
def save_config(symbol: str, payload: IndexRisk):
    if symbol not in SYMBOLS:
        raise HTTPException(404, "Unknown index")
    current = service()
    with current.lock:
        if current.executor.active():
            raise HTTPException(409, "Risk settings are locked until the open Apex position or order is resolved")
        current.store.save(symbol, payload.model_dump())
        current.configured_indices.add(symbol)
    return {"saved": True}


@app.put("/api/daily", dependencies=[Depends(gateway)])
def save_daily(payload: DailyRisk):
    current = service()
    with current.lock:
        if current.executor.active():
            raise HTTPException(409, "The daily limit is locked until the open Apex position or order is resolved")
        current.store.save("daily", payload.model_dump())
        current.daily_configured = True
    return {"saved": True}


@app.put("/api/trade-control", dependencies=[Depends(gateway)])
def control(payload: TradeControl):
    current = service()
    # OFF must not wait behind an AI network request.
    if not payload.enabled:
        current.executor.disable()
        return {"live": False, "protective_exits": "RETAINED"}
    if current.executor.halted:
        raise HTTPException(409, current.executor.halted)
    # Standing intent is immediate; the worker still applies every gate before any BUY.
    current.executor.enabled = True
    return {"live": True, "protective_exits": "RETAINED"}
