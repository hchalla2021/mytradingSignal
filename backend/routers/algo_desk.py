"""Owner-only API for the 12 Algo Desk: twelve independent option-buying algos on the shared AQTE live lane."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field

from routers.aqte import live_call, live_operator
from services.aqte_live import get_live_service
from services.expiryedge_algos import ALGO_KEYS

router = APIRouter(prefix="/api/algo-desk", tags=["12 Algo Desk"], dependencies=[Depends(live_operator)])

Symbol = Literal["NIFTY", "BANKNIFTY", "SENSEX"]
AlgoKey = Literal[ALGO_KEYS]
ENABLE_PHRASE = "ENABLE ALGO DESK LIVE TRADING"
STOP_PHRASE = "STOP ALGO DESK ENTRIES"
EXIT_PHRASE = "CLOSE ALGO DESK TRADE"


class AlgoApproval(BaseModel):
    model_config = ConfigDict(extra="forbid")
    algo: AlgoKey
    enabled: bool = Field(strict=True)
    confirmation: Literal["ENABLE ALGO DESK LIVE TRADING", "STOP ALGO DESK ENTRIES"]
    symbol: Symbol = "NIFTY"


class AlgoExit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    trade_id: str = Field(pattern=r"^XEA[0-9a-f]{13}$")
    confirmation: Literal["CLOSE ALGO DESK TRADE"]
    symbol: Symbol | None = None


@router.get("/status")
async def status(response: Response, symbol: Symbol = Query("NIFTY")):
    response.headers["Cache-Control"] = "no-store"
    return await live_call(get_live_service().expiryedge_status, symbol)


@router.post("/approval")
async def approval(body: AlgoApproval, response: Response):
    response.headers["Cache-Control"] = "no-store"
    if body.confirmation != (ENABLE_PHRASE if body.enabled else STOP_PHRASE):
        raise HTTPException(status_code=422, detail="12 Algo Desk confirmation does not match the requested action")
    return await live_call(get_live_service().set_expiryedge_algo, body.algo, body.enabled, body.symbol)


@router.post("/exit")
async def exit_trade(body: AlgoExit, response: Response):
    response.headers["Cache-Control"] = "no-store"
    if body.confirmation != EXIT_PHRASE:
        raise HTTPException(status_code=422, detail="12 Algo Desk exit confirmation is required")
    return await live_call(get_live_service().request_expiryedge_exit, body.trade_id, body.symbol)
