"""Contract-specific futures OHLCV; never combines cash prices or different expiries."""

import asyncio
import logging
import time
from datetime import date, datetime

from kiteconnect import KiteConnect

from config import get_settings
from services.chart_history_service import (
    ChartHistoryService, ChartHistoryUnavailable, INTERVALS, IST, TOKENS,
)

logger = logging.getLogger(__name__)


class FuturesChartService(ChartHistoryService):
    def __init__(self, db_path=None):
        super().__init__(db_path)
        self._instruments = {}
        self._instrument_locks = {}

    def _instrument_token(self, symbol):
        return int(symbol.removeprefix("FUT:"))

    def _fetch_instruments(self, exchange):
        settings = get_settings()
        if not settings.zerodha_api_key or not settings.zerodha_access_token:
            raise ChartHistoryUnavailable("Connect Zerodha to load futures contracts.")
        client = KiteConnect(api_key=settings.zerodha_api_key, timeout=15)
        client.set_access_token(settings.zerodha_access_token)
        return client.instruments(exchange)

    async def contracts(self, symbol, now=None):
        if symbol not in TOKENS:
            raise ValueError("Unsupported futures symbol")
        today = (now or datetime.now(IST)).date()
        exchange = "BFO" if symbol == "SENSEX" else "NFO"
        lock = self._instrument_locks.setdefault(exchange, asyncio.Lock())
        async with lock:
            cached = self._instruments.get(exchange)
            if cached is None or time.monotonic() - cached[0] >= 3600:
                try:
                    rows = await asyncio.to_thread(self._fetch_instruments, exchange)
                    if not rows:
                        raise ChartHistoryUnavailable(f"Zerodha returned no {exchange} instruments. Retry later.")
                except ChartHistoryUnavailable:
                    raise
                except Exception as error:
                    logger.exception("Unable to load Zerodha %s futures contracts", exchange)
                    raise ChartHistoryUnavailable(
                        "Unable to load Zerodha futures contracts. Check your session and exchange subscription."
                    ) from error
                rows = [
                    row for row in rows if row.get("instrument_type") == "FUT"
                    and row.get("name") in TOKENS and row.get("exchange") == exchange
                ]
                cached = (time.monotonic(), rows)
                self._instruments[exchange] = cached
        contracts = []
        for row in cached[1]:
            if row.get("instrument_type") != "FUT" or row.get("name") != symbol or row.get("exchange") != exchange:
                continue
            expiry = row["expiry"]
            if isinstance(expiry, datetime):
                expiry = expiry.date()
            elif isinstance(expiry, str):
                expiry = date.fromisoformat(expiry)
            if expiry < today:
                continue
            contracts.append({
                "token": int(row["instrument_token"]),
                "symbol": symbol,
                "tradingSymbol": row["tradingsymbol"],
                "exchange": exchange,
                "expiry": expiry.isoformat(),
                "lotSize": int(row["lot_size"]),
                "tickSize": float(row["tick_size"]),
            })
        return sorted(contracts, key=lambda contract: (contract["expiry"], contract["token"]))

    async def page(self, symbol, interval, token, before=None, now=None):
        interval = str(interval)
        if interval not in INTERVALS:
            raise ValueError("Unsupported futures interval")
        contracts = await self.contracts(symbol, now)
        contract = next((item for item in contracts if item["token"] == token), None)
        if contract is None:
            raise ValueError("Select a currently listed futures contract for this index.")
        result = await self._page(f"FUT:{token}", interval, before, now, include_daily=False)
        return {
            **result, "source": "ZERODHA_FUTURES", "volumeSource": "SAME_FUTURES_CONTRACT",
            "contract": contract, "refreshSeconds": 20,
        }


futures_chart_service = FuturesChartService()
