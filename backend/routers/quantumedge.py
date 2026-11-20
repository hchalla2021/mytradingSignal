"""Owner controls for QuantumEdge IntraDay."""

from typing import Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field

from routers.aqte import live_call, live_operator
from services.aqte_live import get_live_service

router = APIRouter(prefix="/api/quantumedge", tags=["QuantumEdge IntraDay Algo"])


class IndexConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    symbol: Literal["NIFTY", "BANKNIFTY", "SENSEX"]
    enabled: bool
    lots: int = Field(ge=1, le=5, strict=True)
    risk_per_lot: int = Field(ge=100, le=10_000, strict=True)


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


@router.post("/index", dependencies=[Depends(live_operator)])
async def quantumedge_index(body: IndexConfig):
    return await live_call(
        get_live_service().set_quantumedge_index,
        body.symbol, body.enabled, body.lots, body.risk_per_lot,
    )


@router.post("/approval", dependencies=[Depends(live_operator)])
async def quantumedge_approval(body: MasterApproval):
    return await live_call(get_live_service().set_quantumedge_approval, body.enabled)


@router.post("/exit", dependencies=[Depends(live_operator)])
async def quantumedge_exit(body: QuantumExit):
    return await live_call(get_live_service().request_quantumedge_exit, body.trade_id)
