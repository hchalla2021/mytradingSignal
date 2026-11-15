"""Live Zerodha market intelligence collection for AUTONOMIQ PRO.

Never fabricates data: every missing or stale input is reported as an error so the
risk engine can block trading. The persistent last-known cache is deliberately NOT
used — only the live `market:<SYMBOL>` key that expires 30 s after the last tick.
"""

from __future__ import annotations

import logging
import threading
from datetime import date, datetime, timedelta
from typing import Any

import pytz

from . import indicators as ind

logger = logging.getLogger(__name__)
IST = pytz.timezone("Asia/Kolkata")
SYMBOLS = ("NIFTY", "BANKNIFTY", "SENSEX")
INDEX_TOKENS = {"NIFTY": 256265, "BANKNIFTY": 260105, "SENSEX": 265}
DERIVATIVE_EXCHANGE = {"NIFTY": "NFO", "BANKNIFTY": "NFO", "SENSEX": "BFO"}
RISK_FREE_RATE = 0.065
CHAIN_WIDTH = 8  # strikes on each side of ATM


def parse_ts(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else IST.localize(value)
    if isinstance(value, str) and value:
        try:
            parsed = datetime.fromisoformat(value)
            return parsed if parsed.tzinfo else IST.localize(parsed)
        except ValueError:
            return None
    return None


def completed(candles: list[dict], minutes: int, now: datetime) -> list[dict]:
    """Drop the still-forming candle; analysis uses completed candles only."""
    out = []
    for c in candles:
        start = parse_ts(c.get("date"))
        if start is not None and start + timedelta(minutes=minutes) <= now:
            out.append({"date": start.isoformat(), "open": float(c["open"]), "high": float(c["high"]),
                        "low": float(c["low"]), "close": float(c["close"]), "volume": int(c.get("volume") or 0)})
    return out


class KiteGateway:
    """Thin wrapper around KiteConnect that follows token refreshes from backend/.env."""

    def __init__(self):
        self._lock = threading.Lock()
        self._client = None
        self._key: tuple[str, str] | None = None
        self._instruments: dict[str, tuple[str, list[dict]]] = {}

    def client(self):
        from config import get_settings
        from kiteconnect import KiteConnect

        get_settings.cache_clear()
        settings = get_settings()
        key = (settings.zerodha_api_key, settings.zerodha_access_token)
        if not all(key):
            raise RuntimeError("Zerodha credentials or access token missing")
        with self._lock:
            if self._client is None or self._key != key:
                client = KiteConnect(api_key=key[0], timeout=10)
                client.set_access_token(key[1])
                self._client, self._key = client, key
            return self._client

    def instruments(self, exchange: str, today: str) -> list[dict]:
        cached = self._instruments.get(exchange)
        if cached and cached[0] == today:
            return cached[1]
        rows = [r for r in self.client().instruments(exchange)
                if r.get("name") in SYMBOLS and r.get("instrument_type") in ("FUT", "CE", "PE")]
        if not rows:
            raise RuntimeError(f"Empty {exchange} instrument master")
        self._instruments[exchange] = (today, rows)
        return rows

    def historical(self, token: int, start: datetime, end: datetime, interval: str) -> list[dict]:
        return self.client().historical_data(token, start, end, interval)

    def quote(self, keys: list[str]) -> dict:
        return self.client().quote(keys) if keys else {}


def nearest(rows: list[dict], symbol: str, kind: str, today: date) -> tuple[date | None, list[dict]]:
    matching = [r for r in rows if r["name"] == symbol and r["instrument_type"] == kind and r.get("expiry")]
    expiries = sorted({_as_date(r["expiry"]) for r in matching if _as_date(r["expiry"]) >= today})
    if not expiries:
        return None, []
    return expiries[0], [r for r in matching if _as_date(r["expiry"]) == expiries[0]]


def _as_date(value: Any) -> date:
    return value if isinstance(value, date) and not isinstance(value, datetime) else date.fromisoformat(str(value)[:10])


def build_chain(quotes: dict, contracts: list[dict], exchange: str, spot: float, expiry: date,
                now: datetime) -> dict:
    """Assemble option-chain metrics (PCR, IV, Greeks, liquidity) from a Kite quote response."""
    years = max((IST.localize(datetime.combine(expiry, datetime.min.time())) + timedelta(hours=15, minutes=30)
                 - now).total_seconds(), 60) / (365 * 24 * 3600)
    strikes: dict[float, dict] = {}
    for row in contracts:
        q = quotes.get(f"{exchange}:{row['tradingsymbol']}")
        if not q:
            continue
        depth = q.get("depth") or {}
        bid = (depth.get("buy") or [{}])[0].get("price") or 0
        ask = (depth.get("sell") or [{}])[0].get("price") or 0
        ltp = float(q.get("last_price") or 0)
        traded = parse_ts(q.get("last_trade_time"))
        iv = ind.implied_vol(ltp, spot, float(row["strike"]), years, RISK_FREE_RATE, row["instrument_type"])
        leg = {
            "tradingsymbol": row["tradingsymbol"], "lot_size": int(row.get("lot_size") or 0),
            "ltp": ltp, "bid": float(bid), "ask": float(ask), "oi": int(q.get("oi") or 0),
            "volume": int(q.get("volume") or 0),
            "spread_pct": round((ask - bid) * 100 / ask, 2) if bid > 0 and ask > 0 else None,
            "trade_age_s": round((now - traded).total_seconds(), 1) if traded else None,
            "iv": round(iv * 100, 2) if iv else None,
            **(ind.greeks(spot, float(row["strike"]), years, RISK_FREE_RATE, iv, row["instrument_type"])
               if iv else {"delta": None, "gamma": None, "theta": None, "vega": None}),
        }
        strikes.setdefault(float(row["strike"]), {})[row["instrument_type"]] = leg
    if not strikes:
        raise RuntimeError("Option chain quotes unavailable")
    ordered = sorted(strikes)
    atm = min(ordered, key=lambda k: abs(k - spot))
    ce_oi = sum(s.get("CE", {}).get("oi", 0) for s in strikes.values())
    pe_oi = sum(s.get("PE", {}).get("oi", 0) for s in strikes.values())
    atm_row = strikes[atm]
    ivs = [leg["iv"] for leg in atm_row.values() if leg.get("iv")]
    return {
        "expiry": expiry.isoformat(), "days_to_expiry": round(years * 365, 2), "atm": atm,
        "pcr": round(pe_oi / ce_oi, 3) if ce_oi else None, "call_oi": ce_oi, "put_oi": pe_oi,
        "atm_iv": round(sum(ivs) / len(ivs), 2) if ivs else None,
        "max_call_oi_strike": max(ordered, key=lambda k: strikes[k].get("CE", {}).get("oi", 0)),
        "max_put_oi_strike": max(ordered, key=lambda k: strikes[k].get("PE", {}).get("oi", 0)),
        "strikes": [{"strike": k, **strikes[k]} for k in ordered],
    }


class MarketDataCollector:
    def __init__(self, gateway: KiteGateway | None = None):
        self.gateway = gateway or KiteGateway()
        self._prev_oi: dict[str, tuple[int, int]] = {}

    async def spot(self, symbol: str, now: datetime) -> dict:
        from services.cache import CacheService

        data = await CacheService().get(f"market:{symbol}")
        if not data or not data.get("price"):
            return {"price": None, "fresh": False, "age_s": None, "error": "No live tick"}
        received = parse_ts(data.get("timestamp"))
        age = (now - received).total_seconds() if received else None
        return {"price": float(data["price"]), "change": data.get("change"), "change_pct": data.get("changePercent"),
                "received_at": received.isoformat() if received else None,
                "age_s": round(age, 1) if age is not None else None, "status": data.get("status")}

    def collect_sync(self, symbol: str, spot_price: float | None, now: datetime) -> dict:
        """Blocking Kite calls; run in a worker thread."""
        out: dict[str, Any] = {"symbol": symbol, "errors": [], "candles": {}, "futures": None, "options": None}
        today = now.date()
        try:
            raw5 = self.gateway.historical(INDEX_TOKENS[symbol], now - timedelta(days=6), now, "5minute")
            out["candles"]["5m"] = completed(raw5, 5, now)
            raw15 = self.gateway.historical(INDEX_TOKENS[symbol], now - timedelta(days=12), now, "15minute")
            c15 = completed(raw15, 15, now)
            out["candles"]["15m"] = c15
            out["candles"]["60m"] = ind.resample(c15, 4)
        except Exception as exc:  # noqa: BLE001 — Kite raises many exception types
            out["errors"].append(f"candles: {type(exc).__name__}")
            logger.warning("AUTONOMIQ PRO candle fetch failed for %s: %s", symbol, type(exc).__name__)

        exchange = DERIVATIVE_EXCHANGE[symbol]
        try:
            rows = self.gateway.instruments(exchange, today.isoformat())
        except Exception as exc:  # noqa: BLE001
            out["errors"].append(f"instruments: {type(exc).__name__}")
            return out

        _, futs = nearest(rows, symbol, "FUT", today)
        if futs:
            fut = futs[0]
            try:
                fut_candles = completed(self.gateway.historical(
                    fut["instrument_token"], now.replace(hour=9, minute=15, second=0, microsecond=0), now,
                    "5minute"), 5, now)
                q = self.gateway.quote([f"{exchange}:{fut['tradingsymbol']}"]).get(
                    f"{exchange}:{fut['tradingsymbol']}", {})
                buy, sell = int(q.get("buy_quantity") or 0), int(q.get("sell_quantity") or 0)
                vols = [c["volume"] for c in fut_candles]
                avg = sum(vols[-21:-1]) / len(vols[-21:-1]) if len(vols) > 1 else None
                out["futures"] = {
                    "tradingsymbol": fut["tradingsymbol"], "ltp": q.get("last_price"),
                    "vwap": round(ind.vwap(fut_candles), 2) if ind.vwap(fut_candles) else None,
                    "oi": q.get("oi"), "buy_quantity": buy, "sell_quantity": sell,
                    "order_imbalance": round((buy - sell) / (buy + sell), 3) if buy + sell else None,
                    "volume_ratio": round(vols[-1] / avg, 2) if avg else None,
                }
            except Exception as exc:  # noqa: BLE001
                out["errors"].append(f"futures: {type(exc).__name__}")

        if spot_price:
            expiry, ce = nearest(rows, symbol, "CE", today)
            _, pe = nearest(rows, symbol, "PE", today)
            try:
                strikes = sorted({float(r["strike"]) for r in ce})
                if not strikes or expiry is None:
                    raise RuntimeError("no option contracts")
                atm_index = min(range(len(strikes)), key=lambda i: abs(strikes[i] - spot_price))
                window = set(strikes[max(atm_index - CHAIN_WIDTH, 0): atm_index + CHAIN_WIDTH + 1])
                contracts = [r for r in ce + pe if float(r["strike"]) in window]
                quotes = self.gateway.quote([f"{exchange}:{r['tradingsymbol']}" for r in contracts])
                chain = build_chain(quotes, contracts, exchange, spot_price, expiry, now)
                chain["exchange"] = exchange
                prev = self._prev_oi.get(symbol)
                if prev:
                    chain["call_oi_change"] = chain["call_oi"] - prev[0]
                    chain["put_oi_change"] = chain["put_oi"] - prev[1]
                self._prev_oi[symbol] = (chain["call_oi"], chain["put_oi"])
                out["options"] = chain
            except Exception as exc:  # noqa: BLE001
                out["errors"].append(f"options: {type(exc).__name__}")
        return out

    def quote_contracts(self, keys: list[str]) -> dict:
        return self.gateway.quote(keys)
