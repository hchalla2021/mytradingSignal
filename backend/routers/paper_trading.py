"""Paper-only chart signal intake and durable history."""

import logging
from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from services.paper_trading import get_paper_trading_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/paper-trading", tags=["Paper Trading"])


class ChartSignal(BaseModel):
    strategy: str = Field(min_length=1, max_length=120)
    side: Literal["BUY", "SELL"]
    signal_price: float = Field(gt=0, allow_inf_nan=False)
    rationale: list[str] = Field(max_length=40)
    tags: list[str] = Field(max_length=30)


class ChartFrame(BaseModel):
    source: Literal["observatory-chart"]
    symbol: Literal["NIFTY", "BANKNIFTY", "SENSEX"]
    timeframe: Literal[3, 5, 15, 30, 60]
    candle_at: datetime
    setup: dict
    signals: list[ChartSignal] = Field(max_length=100)


@router.post("/signals")
async def accept_chart_signals(frame: ChartFrame):
    payload = frame.model_dump(mode="json")
    try:
        return await get_paper_trading_service().run(get_paper_trading_service().submit, payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/history")
async def history(day: date | None = None, limit: int = Query(100, ge=1, le=500),
                  offset: int = Query(0, ge=0)):
    return await get_paper_trading_service().run(get_paper_trading_service().snapshot,
                                   day.isoformat() if day else None, limit, offset)


@router.get("/events")
async def events(trade_id: str = Query(min_length=1, max_length=300)):
    return await get_paper_trading_service().run(get_paper_trading_service().events, trade_id)


@router.get("/report")
async def day_report(day: date | None = None):
    return await get_paper_trading_service().run(get_paper_trading_service().export_day, day.isoformat() if day else None)


@router.get("/chart")
async def chart_trades(symbol: Literal["NIFTY", "BANKNIFTY", "SENSEX"],
                       timeframe: int = Query(...), day: date | None = None):
    if timeframe not in {3, 5, 15, 30, 60}:
        raise HTTPException(status_code=422, detail="timeframe must be one of 3, 5, 15, 30, 60")
    return await get_paper_trading_service().run(get_paper_trading_service().chart_snapshot,
                                   symbol, timeframe, day.isoformat() if day else None)
