"""Owner-authenticated controls for the independent QuantEdge Pro strategy."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field

from routers.aqte import live_call, live_operator
from services.aqte_live import get_live_service

router = APIRouter(prefix="/api/quantedge", tags=["QuantEdge Pro"])


class QuantEdgeConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lots: int = Field(ge=1, le=5, strict=True)


class QuantEdgeApproval(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = Field(strict=True)
    confirmation: Literal["ENABLE QUANTEDGE PRO LIVE TRADING", "STOP QUANTEDGE PRO ENTRIES"]


class QuantEdgeExit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    trade_id: str = Field(pattern=r"^QEP[0-9a-f]{13}$")
    confirmation: Literal["CLOSE QUANTEDGE PRO TRADE"]


@router.get("/status", dependencies=[Depends(live_operator)])
async def quantedge_status(response: Response):
    response.headers["Cache-Control"] = "no-store"
    return await live_call(get_live_service().quantedge_status)


@router.post("/config", dependencies=[Depends(live_operator)])
async def save_quantedge_config(body: QuantEdgeConfig):
    return await live_call(get_live_service().set_quantedge_config, body.lots)


@router.post("/approval", dependencies=[Depends(live_operator)])
async def quantedge_approval(body: QuantEdgeApproval):
    expected = "ENABLE QUANTEDGE PRO LIVE TRADING" if body.enabled else "STOP QUANTEDGE PRO ENTRIES"
    if body.confirmation != expected:
        raise HTTPException(status_code=422, detail="QuantEdge Pro confirmation does not match the requested action")
    return await live_call(get_live_service().set_quantedge_approval, body.enabled)


@router.post("/exit", dependencies=[Depends(live_operator)])
async def quantedge_exit(body: QuantEdgeExit):
    if body.confirmation != "CLOSE QUANTEDGE PRO TRADE":
        raise HTTPException(status_code=422, detail="QuantEdge Pro exit confirmation is required")
    return await live_call(get_live_service().request_quantedge_exit, body.trade_id)
