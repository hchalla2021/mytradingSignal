"""Global indices live adapter service (multi-provider with fallback)."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Any, Dict, Optional, Set
from urllib.parse import quote_plus

import requests
from fastapi import WebSocket
import pytz

logger = logging.getLogger(__name__)
IST = pytz.timezone("Asia/Kolkata")


class GlobalIndicesConnectionManager:
    def __init__(self):
        self._connections: Set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        async with self._lock:
            self._connections.add(ws)

    async def disconnect(self, ws: WebSocket):
        async with self._lock:
            self._connections.discard(ws)

    async def broadcast(self, payload: Dict[str, Any]):
        if not self._connections:
            return
        msg = json.dumps(payload, default=str)
        dead: Set[WebSocket] = set()
        async with self._lock:
            clients = list(self._connections)
        for ws in clients:
            try:
                await asyncio.wait_for(ws.send_text(msg), timeout=3.0)
            except Exception:
                dead.add(ws)
        if dead:
            async with self._lock:
                self._connections -= dead

    async def send_personal(self, ws: WebSocket, payload: Dict[str, Any]):
        try:
            await asyncio.wait_for(ws.send_text(json.dumps(payload, default=str)), timeout=3.0)
        except Exception:
            await self.disconnect(ws)


manager = GlobalIndicesConnectionManager()


class _Provider:
    name = "base"

    def fetch_quote(self, symbol: str) -> Optional[Dict[str, Any]]:
        raise NotImplementedError


class YahooProvider(_Provider):
    name = "yahoo"

    _MAP = {
        "DJI": "%5EDJI",
        "SPX": "%5EGSPC",
        "IXIC": "%5EIXIC",
        "DAX": "%5EGDAXI",
        "FTSE": "%5EFTSE",
        "NIKKEI": "%5EN225",
    }

    # Use chart API on query2 host — avoids 429 from v7/quote endpoint
    _HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
    }

    def fetch_quote(self, symbol: str) -> Optional[Dict[str, Any]]:
        ticker = self._MAP.get(symbol)
        if not ticker:
            return None
        url = f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker}"
        resp = requests.get(url, params={"interval": "1d", "range": "2d"}, headers=self._HEADERS, timeout=5)
        resp.raise_for_status()
        data = resp.json() or {}
        result = ((data.get("chart") or {}).get("result") or [None])[0]
        if not result:
            return None
        meta = result.get("meta") or {}
        price = float(meta.get("regularMarketPrice") or 0)
        prev_close = float(meta.get("chartPreviousClose") or meta.get("previousClose") or 0)
        if price <= 0 or prev_close <= 0:
            return None
        chg = price - prev_close
        chg_pct = (chg / prev_close) * 100
        return {
            "price": round(price, 4),
            "change": round(chg, 4),
            "changePct": round(chg_pct, 4),
            "source": self.name,
        }


class StooqProvider(_Provider):
    name = "stooq"

    # Only DJI and SPX are reliably available on Stooq; others return HTML errors
    _MAP = {
        "DJI": "^dji",
        "SPX": "^spx",
    }

    def fetch_quote(self, symbol: str) -> Optional[Dict[str, Any]]:
        stooq_symbol = self._MAP.get(symbol)
        if not stooq_symbol:
            return None
        url = f"https://stooq.com/q/l/?s={quote_plus(stooq_symbol)}&f=sd2t2ohlcv&h&e=json"
        resp = requests.get(url, timeout=3)
        resp.raise_for_status()
        payload = resp.json() or {}
        rows = payload.get("symbols") or []
        if not rows:
            return None
        row = rows[0]
        close = float(row.get("close") or 0)
        open_ = float(row.get("open") or 0)
        if close <= 0 or open_ <= 0:
            return None
        chg = close - open_
        chg_pct = (chg / open_) * 100
        return {
            "price": round(close, 4),
            "change": round(chg, 4),
            "changePct": round(chg_pct, 4),
            "source": self.name,
        }


class GlobalIndicesService:
    INDICES = {
        "DJI": {"name": "Dow Jones", "region": "US"},
        "SPX": {"name": "S&P 500", "region": "US"},
        "IXIC": {"name": "Nasdaq", "region": "US"},
        "DAX": {"name": "DAX", "region": "EU"},
        "FTSE": {"name": "FTSE 100", "region": "EU"},
        "NIKKEI": {"name": "Nikkei 225", "region": "APAC"},
    }

    POLL_INTERVAL = 4

    def __init__(self):
        self._providers = [YahooProvider(), StooqProvider()]
        self._latest: Dict[str, Dict[str, Any]] = {}
        self._task: Optional[asyncio.Task] = None
        self._running = False

    def _fetch_one(self, symbol: str) -> Dict[str, Any]:
        meta = self.INDICES[symbol]
        for provider in self._providers:
            try:
                q = provider.fetch_quote(symbol)
                if q:
                    return {
                        "symbol": symbol,
                        "name": meta["name"],
                        "region": meta["region"],
                        "price": q["price"],
                        "change": q["change"],
                        "changePct": q["changePct"],
                        "source": q["source"],
                        "status": "LIVE",
                        "timestamp": datetime.now(IST).isoformat(),
                    }
            except Exception as exc:
                logger.debug("Global index provider %s failed for %s: %s", provider.name, symbol, exc)

        fallback = self._latest.get(symbol)
        if fallback:
            stale = dict(fallback)
            stale["status"] = "STALE"
            stale["timestamp"] = datetime.now(IST).isoformat()
            return stale

        return {
            "symbol": symbol,
            "name": meta["name"],
            "region": meta["region"],
            "price": 0,
            "change": 0,
            "changePct": 0,
            "source": "none",
            "status": "UNAVAILABLE",
            "timestamp": datetime.now(IST).isoformat(),
        }

    async def _loop(self):
        while self._running:
            try:
                loop = asyncio.get_event_loop()
                tasks = [loop.run_in_executor(None, self._fetch_one, sym) for sym in self.INDICES.keys()]
                results = await asyncio.gather(*tasks, return_exceptions=True)
                payload: Dict[str, Dict[str, Any]] = {}
                for sym, result in zip(self.INDICES.keys(), results):
                    if isinstance(result, Exception):
                        logger.debug("Global index fetch failed for %s: %s", sym, result)
                        payload[sym] = self._latest.get(sym) or {
                            "symbol": sym,
                            "name": self.INDICES[sym]["name"],
                            "region": self.INDICES[sym]["region"],
                            "price": 0,
                            "change": 0,
                            "changePct": 0,
                            "source": "none",
                            "status": "UNAVAILABLE",
                            "timestamp": datetime.now(IST).isoformat(),
                        }
                    else:
                        payload[sym] = result
                self._latest = payload
                await manager.broadcast({
                    "type": "global_indices_update",
                    "data": payload,
                    "timestamp": datetime.now(IST).isoformat(),
                })
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("Global indices loop error: %s", exc)
            await asyncio.sleep(self.POLL_INTERVAL)

    async def start(self):
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    def get_snapshot(self) -> Dict[str, Dict[str, Any]]:
        return dict(self._latest)


_service: Optional[GlobalIndicesService] = None


def get_global_indices_service() -> GlobalIndicesService:
    global _service
    if _service is None:
        _service = GlobalIndicesService()
    return _service
