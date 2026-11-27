"""Owner controls for QuantumEdge IntraDay."""

import asyncio
import json
import logging
import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from routers.live_control import live_call, live_operator
from services.aqte_engine import Tick
from services.aqte_live import get_live_service

router = APIRouter(prefix="/api/quantumedge", tags=["QuantumEdge IntraDay Algo"])
logger = logging.getLogger(__name__)


class IndexConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    symbol: Literal["NIFTY", "BANKNIFTY", "SENSEX"]
    enabled: bool
    lots: int = Field(ge=1, le=5, strict=True)
    risk_per_lot: float = Field(gt=0, le=10_000_000)


class RiskLimits(BaseModel):
    model_config = ConfigDict(extra="forbid")
    symbol: Literal["NIFTY", "BANKNIFTY", "SENSEX"]
    risk_per_lot: float = Field(gt=0, le=10_000_000)
    daily_loss_limit: float = Field(gt=0, le=10_000_000)


class MasterApproval(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = Field(strict=True)


class QuantumExit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    trade_id: str = Field(pattern=r"^QEI[0-9a-f]{13}$")


@router.get("/status", dependencies=[Depends(live_operator)])
async def quantumedge_status(response: Response):
    response.headers["Cache-Control"] = "no-store"
    return await live_call(get_live_service().quantumedge_status)


@router.get("/quotes", dependencies=[Depends(live_operator)])
async def quantumedge_quotes(token: list[int] = Query(...)):
    live = get_live_service()
    def owned_tokens() -> set[int]:
        with live.lock:
            return {
                position["contract"]["token"] for position in live.quantumedge_positions()
                if int(position.get("filled") or 0) > int(position.get("exited") or 0)
            }

    owned = await asyncio.to_thread(owned_tokens)
    tokens = set(token)
    if not tokens or not tokens.issubset(owned):
        raise HTTPException(status_code=403, detail="Only owned open-position quotes can be streamed")
    market = live.service()
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[Tick] = asyncio.Queue(maxsize=256)
    overflow = asyncio.Event()

    def offer(tick: Tick) -> None:
        if queue.full():
            overflow.set()
        elif not overflow.is_set():
            queue.put_nowait(tick)

    def publish(tick: Tick) -> None:
        loop.call_soon_threadsafe(offer, tick)

    async def stream():
        listener = market.subscribe_option_quotes(tokens, publish)
        try:
            while not overflow.is_set():
                try:
                    tick = await asyncio.wait_for(queue.get(), timeout=10)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                now = time.time()
                if not market.engine.fresh(tick, now):
                    continue
                expires = min(tick.at, tick.received) + market.engine.policy.stale_seconds
                payload = {"token": tick.token, "price": tick.price, "received_at": tick.received,
                           "valid_for_ms": max(0, (expires - now) * 1000)}
                yield f"data: {json.dumps(payload)}\n\n"
            logger.warning("QuantumEdge quote stream closed because its client could not keep up")
        finally:
            market.unsubscribe_option_quotes(listener)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={
        "Cache-Control": "no-store", "X-Accel-Buffering": "no",
    })


@router.post("/index", dependencies=[Depends(live_operator)])
async def quantumedge_index(body: IndexConfig):
    return await live_call(
        get_live_service().set_quantumedge_index,
        body.symbol, body.enabled, body.lots, body.risk_per_lot,
    )


@router.post("/limits", dependencies=[Depends(live_operator)])
async def quantumedge_limits(body: RiskLimits):
    return await live_call(
        get_live_service().set_quantumedge_limits,
        body.symbol, body.risk_per_lot, body.daily_loss_limit,
    )


@router.post("/approval", dependencies=[Depends(live_operator)])
async def quantumedge_approval(body: MasterApproval):
    return await live_call(get_live_service().set_quantumedge_approval, body.enabled)


@router.post("/exit", dependencies=[Depends(live_operator)])
async def quantumedge_exit(body: QuantumExit):
    return await live_call(get_live_service().request_quantumedge_exit, body.trade_id)
