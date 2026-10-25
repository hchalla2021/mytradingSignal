"""Order Flow Intelligence API (near-month NIFTY / BANKNIFTY / SENSEX futures).

HTTP: GET /api/order-flow/snapshot?symbol=&interval=&date=&token=
      GET /api/order-flow/replay?symbol=&interval=&days=
WS:   /ws/order-flow?symbol=&interval=   → snapshot, then incremental updates (≈1/s, only when changed)
No orders are ever placed from here.
"""

import asyncio
import json
import logging
import time
from datetime import date
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect

from services.order_flow_analysis import aggregate, analyze
from services.order_flow_engine import ROW_SIZE, order_flow_engine, session_date

logger = logging.getLogger(__name__)
http_router = APIRouter(prefix="/order-flow", tags=["Order Flow"])
ws_router = APIRouter()

SYMBOLS = ("NIFTY", "BANKNIFTY", "SENSEX")
INTERVALS = (1, 3, 5, 15, 30, 60)
METHOD = ("Aggressor side estimated per ~1s KiteTicker snapshot: quote rule vs prior best bid/ask, "
          "midpoint rule inside the spread, then tick rule. Zerodha does not publish trade-by-trade aggressor flags.")
_contracts: Dict[int, Dict[str, Any]] = {}
_cache: Dict[tuple, tuple] = {}


def _validate(symbol: str, interval: int) -> str:
    symbol = symbol.upper()
    if symbol not in SYMBOLS:
        raise HTTPException(status_code=400, detail="symbol must be NIFTY, BANKNIFTY or SENSEX")
    if interval not in INTERVALS:
        raise HTTPException(status_code=400, detail=f"interval must be one of {INTERVALS} minutes")
    return symbol


async def _contract(symbol: str, token: Optional[int]) -> Optional[Dict[str, Any]]:
    if token is None:
        return None
    if token not in _contracts:
        try:
            from services.futures_chart_service import futures_chart_service
            for item in await futures_chart_service.contracts(symbol):
                _contracts[int(item["token"])] = item
        except Exception as error:  # lot size only affects rupee P&L; replay falls back to points
            logger.warning("Order flow contract lookup failed: %s", error)
    return _contracts.get(token)


def _today() -> str:
    return session_date(time.time())


def _dom(symbol: str, token: Optional[int]) -> Optional[Dict[str, Any]]:
    dom = order_flow_engine.dom(symbol)
    return dom if dom and (token is None or dom.get("token") == token) else None


async def build_snapshot(symbol: str, interval: int, day: Optional[str] = None, token: Optional[int] = None,
                         latest_recorded: bool = False) -> Dict[str, Any]:
    """`latest_recorded` (display only): when today has no recording yet, return the most recent recorded session,
    flagged with `latestRecorded`, instead of an empty snapshot. Trading/paper callers must leave it off."""
    requested_today = day is None
    day = day or _today()
    live_token = order_flow_engine.current_token(symbol)
    if token is not None and day == _today() and live_token is not None and token != live_token:
        return {"available": False, "symbol": symbol, "interval": interval, "date": day,
                "reason": "Order flow is recorded live for the near-month contract only.", "recordedToken": live_token}
    key = (symbol, interval, day, token, latest_recorded and requested_today)
    now = time.time()
    cached = _cache.get(key)
    if cached and now - cached[0] < 0.8:
        return cached[1]
    minutes = await asyncio.to_thread(order_flow_engine.session_minutes, symbol, day)
    if token is not None:
        minutes = [m for m in minutes if m.get("token") == token]
    if not minutes and requested_today and latest_recorded:
        sessions = await asyncio.to_thread(order_flow_engine.stored_sessions, symbol, 5)
        earlier = next((session for session in sessions if session < day), None)
        if earlier:
            previous = await build_snapshot(symbol, interval, earlier, token)
            if previous.get("available"):
                return {**previous, "latestRecorded": True, "lastTick": order_flow_engine.last_tick(symbol),
                        "reason": f"No order flow recorded today yet; showing the last recorded session ({earlier})."}
    contract_token = token or (minutes[-1].get("token") if minutes else live_token)
    contract = await _contract(symbol, contract_token)
    row = ROW_SIZE[symbol]
    last_tick = order_flow_engine.last_tick(symbol)
    result = analyze(aggregate(minutes, interval), row=row, tick=(contract or {}).get("tickSize", 0.05) or 0.05,
                     now=now, exchange="BFO" if symbol == "SENSEX" else "NFO",
                     lot_size=(contract or {}).get("lotSize"),
                     feed_age=(now - last_tick) if last_tick and day == _today() else None)
    payload = {
        "available": bool(minutes), "symbol": symbol, "interval": interval, "date": day, "row": row,
        "token": contract_token, "contract": contract, "source": "ZERODHA_KITE_TICKER_FULL", "method": METHOD,
        "reason": None if minutes else "No order flow recorded for this session yet (recording starts when the backend receives futures ticks).",
        "recordedFrom": minutes[0]["t"] if minutes else None, "lastTick": last_tick, "generatedAt": now,
        "zones": order_flow_engine.zones(symbol) if day == _today() else [],
        "dom": _dom(symbol, contract_token) if day == _today() else None,
        **result,
    }
    for stale in [k for k, (at, _) in _cache.items() if now - at > 60]:
        del _cache[stale]
    _cache[key] = (now, payload)
    return payload


@http_router.get("/snapshot")
async def order_flow_snapshot(symbol: str = "NIFTY", interval: int = Query(5), date_: Optional[date] = Query(None, alias="date"),
                              token: Optional[int] = None, latest: bool = False):
    symbol = _validate(symbol, interval)
    return await build_snapshot(symbol, interval, date_.isoformat() if date_ else None, token, latest_recorded=latest)


@http_router.get("/replay")
async def order_flow_replay(symbol: str = "NIFTY", interval: int = Query(5), days: int = Query(20, ge=1, le=60)):
    """Historical replay over every stored session: same rules, next-bar-open fills, spread-based slippage, fees."""
    symbol = _validate(symbol, interval)
    sessions = sorted(await asyncio.to_thread(order_flow_engine.stored_sessions, symbol, days))
    trades, results = [], []
    for day in sessions:
        snapshot = await build_snapshot(symbol, interval, day)
        if not snapshot["available"]:
            continue
        closed = [s for s in snapshot["signals"] if s["status"] == "closed"]
        trades.extend({**s, "date": day} for s in closed)
        results.append({"date": day, **snapshot["replay"]})
    nets = [t.get("pnl", {}).get("net", t["points"]) for t in trades]
    wins = [n for n in nets if n > 0]
    losses = [n for n in nets if n <= 0]
    return {
        "symbol": symbol, "interval": interval, "sessions": results, "trades": trades[-200:],
        "total": {"trades": len(nets), "winRate": round(len(wins) / len(nets), 3) if nets else None,
                  "net": round(sum(nets), 2),
                  "profitFactor": round(sum(wins) / -sum(losses), 2) if losses and sum(losses) < 0 else None},
        "note": "Paper replay only. Recorded sessions only; no live orders are placed.",
    }


@ws_router.websocket("/order-flow")
async def order_flow_websocket(websocket: WebSocket):
    await websocket.accept()
    try:
        symbol = _validate(websocket.query_params.get("symbol", "NIFTY"), int(websocket.query_params.get("interval", "5")))
        interval = int(websocket.query_params.get("interval", "5"))
        raw_token = websocket.query_params.get("token")
        token = int(raw_token) if raw_token else None
        latest = websocket.query_params.get("latest") in ("1", "true")
    except (HTTPException, ValueError) as error:
        await websocket.send_text(json.dumps({"type": "error", "detail": getattr(error, "detail", str(error))}))
        await websocket.close()
        return
    signature = None
    try:
        snapshot = await build_snapshot(symbol, interval, None, token, latest_recorded=latest)
        await websocket.send_text(json.dumps({"type": "snapshot", "data": snapshot}, separators=(",", ":")))
        if "bars" not in snapshot:  # requested contract is not the recorded one; nothing to stream
            await websocket.close()
            return
        signature = (snapshot["lastTick"], len(snapshot["bars"]))
        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=1.0)
                if raw == "ping":
                    await websocket.send_text('{"type":"pong"}')
                continue
            except asyncio.TimeoutError:
                pass
            snapshot = await build_snapshot(symbol, interval, None, token, latest_recorded=latest)
            current = (snapshot["lastTick"], len(snapshot["bars"]))
            if current == signature:
                continue
            new_bar = signature is not None and current[1] != signature[1]
            signature = current
            update = {key: value for key, value in snapshot.items() if key != "bars"}
            update["bars"] = snapshot["bars"][-3:] if not new_bar else snapshot["bars"][-4:]
            await websocket.send_text(json.dumps({"type": "update", "data": update}, separators=(",", ":")))
    except WebSocketDisconnect:
        pass
    except Exception as error:
        logger.warning("Order flow websocket closed: %s", error)
