"""
FII / DII real-flow service.

Fetches official Foreign and Domestic Institutional cash-segment numbers
straight from NSE's public report endpoint (the same JSON that powers
https://www.nseindia.com/reports/fii-dii). Replaces the synthetic
tick-derived proxy that previously showed inverted signs.

Public surface:
    await fii_dii_service.get_snapshot() -> dict
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

import httpx

from services.cache import get_cache

logger = logging.getLogger(__name__)

# NSE endpoints
_NSE_HOME = "https://www.nseindia.com"
_NSE_REPORT_PAGE = "https://www.nseindia.com/reports/fii-dii"
_NSE_FII_DII_API = "https://www.nseindia.com/api/fiidiiTradeReact"

# India Standard Time (UTC+5:30)
_IST = timezone(timedelta(hours=5, minutes=30))

_CACHE_KEY = "fii_dii:snapshot"
_HISTORY_KEY = "fii_dii:history"   # rolling list of past trade-date snapshots
_HISTORY_MAX = 10                  # keep last 10 trade days
_HISTORY_TTL = 60 * 60 * 24 * 30   # 30 days
_TTL_LIVE = 300       # 5 min while market window active
_TTL_PUBLISHED = 1800  # 30 min after daily publish

_DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": _NSE_REPORT_PAGE,
    "Connection": "keep-alive",
}

# -------------------------------------------------------------------- types --

@dataclass(frozen=True)
class _FlowRow:
    category: str          # 'FII' | 'DII'
    date: str              # 'DD-Mon-YYYY'
    buy_value: float       # ₹ Cr
    sell_value: float      # ₹ Cr
    net_value: float       # ₹ Cr  (positive = inflow / net buy)

    def as_dict(self) -> Dict[str, Any]:
        return {
            "category": self.category,
            "date": self.date,
            "buyValueCr": round(self.buy_value, 2),
            "sellValueCr": round(self.sell_value, 2),
            "netValueCr": round(self.net_value, 2),
        }


# -------------------------------------------------------------------- impl --

class FIIDIIService:
    """Singleton service that pulls FII/DII flow numbers from NSE."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._cookie_jar: Optional[httpx.Cookies] = None
        self._last_fetch_ms: int = 0

    # --- network ----------------------------------------------------------

    async def _bootstrap_cookies(self, client: httpx.AsyncClient) -> None:
        """NSE blocks API calls unless the client first 'visits' the site."""
        try:
            await client.get(_NSE_HOME, timeout=8.0)
            await client.get(_NSE_REPORT_PAGE, timeout=8.0)
            self._cookie_jar = client.cookies
        except Exception as exc:
            logger.warning("FII/DII: cookie bootstrap failed: %s", exc)

    async def _fetch_raw(self) -> List[Dict[str, Any]]:
        """Hit the NSE JSON endpoint. Returns the raw list."""
        async with httpx.AsyncClient(
            headers=_DEFAULT_HEADERS,
            follow_redirects=True,
            timeout=10.0,
        ) as client:
            if self._cookie_jar is None:
                await self._bootstrap_cookies(client)
            elif self._cookie_jar:
                client.cookies = self._cookie_jar

            try:
                resp = await client.get(_NSE_FII_DII_API, timeout=10.0)
                if resp.status_code in (401, 403):
                    # cookie expired — re-bootstrap once
                    self._cookie_jar = None
                    await self._bootstrap_cookies(client)
                    resp = await client.get(_NSE_FII_DII_API, timeout=10.0)
                resp.raise_for_status()
                data = resp.json()
                if not isinstance(data, list):
                    raise ValueError(f"unexpected payload shape: {type(data)}")
                return data
            except (httpx.HTTPError, ValueError) as exc:
                logger.warning("FII/DII: NSE fetch failed: %s", exc)
                raise

    # --- parsing ----------------------------------------------------------

    @staticmethod
    def _classify(category: str) -> Optional[str]:
        c = (category or "").upper()
        if "FII" in c or "FPI" in c:
            return "FII"
        if "DII" in c:
            return "DII"
        return None

    @staticmethod
    def _to_float(v: Any) -> float:
        if v is None:
            return 0.0
        if isinstance(v, (int, float)):
            return float(v)
        s = re.sub(r"[,\s₹]", "", str(v))
        try:
            return float(s)
        except ValueError:
            return 0.0

    def _parse(self, raw: List[Dict[str, Any]]) -> List[_FlowRow]:
        rows: List[_FlowRow] = []
        seen: set[str] = set()
        for entry in raw:
            cat = self._classify(entry.get("category", ""))
            if cat is None or cat in seen:
                continue
            seen.add(cat)
            rows.append(
                _FlowRow(
                    category=cat,
                    date=str(entry.get("date", "")),
                    buy_value=self._to_float(entry.get("buyValue")),
                    sell_value=self._to_float(entry.get("sellValue")),
                    net_value=self._to_float(entry.get("netValue")),
                )
            )
        return rows

    # --- regime reasoning -------------------------------------------------

    @staticmethod
    def _regime(fii_net: float, dii_net: float) -> Dict[str, Any]:
        """
        Lightweight rule-based regime classification over real flows.
        Tags traders see at a glance:
          DOMESTIC_LED_RALLY  : FII selling, DII absorbing (DII > 0 > FII)
          FOREIGN_LED_RALLY   : FII buying, DII trimming  (FII > 0 > DII)
          BOTH_BUYING         : FII > 0 and DII > 0
          BOTH_SELLING        : FII < 0 and DII < 0
          MIXED               : near-zero on either side
        """
        eps = 250.0  # ₹ Cr noise floor
        f_pos, f_neg = fii_net > eps, fii_net < -eps
        d_pos, d_neg = dii_net > eps, dii_net < -eps

        if f_neg and d_pos:
            label, bias = "DOMESTIC_LED", "bullish-domestic"
            note = "DIIs absorbing foreign selling — domestic-led tape."
        elif f_pos and d_neg:
            label, bias = "FOREIGN_LED", "bullish-foreign"
            note = "FIIs buying while DIIs book — foreign-led rally."
        elif f_pos and d_pos:
            label, bias = "BOTH_BUYING", "bullish"
            note = "Both FIIs and DIIs are net buyers — strong demand."
        elif f_neg and d_neg:
            label, bias = "BOTH_SELLING", "bearish"
            note = "Both FIIs and DIIs are net sellers — broad distribution."
        else:
            label, bias = "MIXED", "neutral"
            note = "Flows balanced near zero — no clear institutional bias."

        net_total = fii_net + dii_net
        confidence = min(100.0, (abs(fii_net) + abs(dii_net)) / 100.0)  # ~10000 Cr → 100%
        return {
            "label": label,
            "bias": bias,
            "note": note,
            "netTotalCr": round(net_total, 2),
            "confidence": round(confidence, 1),
        }

    # --- derived intelligence (hidden signals from same raw data) ---------

    @staticmethod
    def _side_metrics(row: "_FlowRow") -> Dict[str, Any]:
        gross = row.buy_value + row.sell_value
        ratio = (row.buy_value / row.sell_value) if row.sell_value > 0 else 0.0
        # participation skew: -1 = pure sell, +1 = pure buy
        skew = ((row.buy_value - row.sell_value) / gross) if gross > 0 else 0.0
        return {
            "grossTurnoverCr": round(gross, 2),
            "buySellRatio": round(ratio, 3),
            "skew": round(skew, 3),
        }

    def _derive_metrics(self, fii: "_FlowRow", dii: "_FlowRow") -> Dict[str, Any]:
        fii_side = self._side_metrics(fii)
        dii_side = self._side_metrics(dii)
        gross_total = fii_side["grossTurnoverCr"] + dii_side["grossTurnoverCr"]

        # Dominance: which side moved more capital (signed by direction).
        fii_mag, dii_mag = abs(fii.net_value), abs(dii.net_value)
        if fii_mag >= dii_mag and fii_mag > 0:
            dominance = {"side": "FII", "shareOfNet": round(fii_mag / (fii_mag + dii_mag), 3)}
        elif dii_mag > 0:
            dominance = {"side": "DII", "shareOfNet": round(dii_mag / (fii_mag + dii_mag), 3)}
        else:
            dominance = {"side": "NONE", "shareOfNet": 0.0}

        # Absorption: when FII sells & DII buys (or vice versa), how much of the
        # exiting side's flow was absorbed by the opposing side. 100% = fully absorbed.
        absorption_pct = 0.0
        if fii.net_value < 0 and dii.net_value > 0:
            absorption_pct = min(100.0, (dii.net_value / abs(fii.net_value)) * 100.0) if fii.net_value != 0 else 0.0
        elif dii.net_value < 0 and fii.net_value > 0:
            absorption_pct = min(100.0, (fii.net_value / abs(dii.net_value)) * 100.0) if dii.net_value != 0 else 0.0

        return {
            "fii": fii_side,
            "dii": dii_side,
            "grossTurnoverCr": round(gross_total, 2),
            "dominance": dominance,
            "absorptionPct": round(absorption_pct, 1),
        }

    # --- rolling history --------------------------------------------------

    async def _update_history(
        self, cache: Any, fii: "_FlowRow", dii: "_FlowRow"
    ) -> List[Dict[str, Any]]:
        """Persist last N trade-date snapshots in cache (dedup by date)."""
        try:
            existing = await cache.get(_HISTORY_KEY) or []
            if not isinstance(existing, list):
                existing = []
        except Exception:
            existing = []

        trade_date = fii.date or dii.date
        if not trade_date:
            return existing[-_HISTORY_MAX:]

        # dedup by trade date — replace if same day, append if new
        kept = [h for h in existing if h.get("tradeDate") != trade_date]
        kept.append({
            "tradeDate": trade_date,
            "fiiNetCr": round(fii.net_value, 2),
            "diiNetCr": round(dii.net_value, 2),
            "netCr": round(fii.net_value + dii.net_value, 2),
            "fiiGrossCr": round(fii.buy_value + fii.sell_value, 2),
            "diiGrossCr": round(dii.buy_value + dii.sell_value, 2),
        })
        kept = kept[-_HISTORY_MAX:]

        try:
            await cache.set(_HISTORY_KEY, kept, expire=_HISTORY_TTL)
        except Exception as exc:
            logger.warning("FII/DII: history persist failed: %s", exc)
        return kept

    @staticmethod
    def _trend_from_history(history: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Compute multi-day trend signals over cached history."""
        if not history:
            return {
                "days": 0, "fiiCum5dCr": 0.0, "diiCum5dCr": 0.0, "netCum5dCr": 0.0,
                "fiiDayChangeCr": 0.0, "diiDayChangeCr": 0.0,
                "fiiStreakDays": 0, "diiStreakDays": 0,
                "fiiTrend": "flat", "diiTrend": "flat",
            }

        # last 5 days for cumulative
        window = history[-5:]
        fii_cum = sum(h.get("fiiNetCr", 0.0) for h in window)
        dii_cum = sum(h.get("diiNetCr", 0.0) for h in window)
        net_cum = sum(h.get("netCr", 0.0) for h in window)

        # day-over-day delta vs previous trade day
        last = history[-1]
        prev = history[-2] if len(history) >= 2 else None
        fii_dod = (last.get("fiiNetCr", 0.0) - prev.get("fiiNetCr", 0.0)) if prev else 0.0
        dii_dod = (last.get("diiNetCr", 0.0) - prev.get("diiNetCr", 0.0)) if prev else 0.0

        # consecutive same-sign streak (buy or sell)
        def _streak(side: str) -> Tuple[int, str]:
            if not history:
                return 0, "flat"
            sign = 1 if history[-1].get(side, 0.0) > 0 else (-1 if history[-1].get(side, 0.0) < 0 else 0)
            if sign == 0:
                return 0, "flat"
            n = 0
            for h in reversed(history):
                v = h.get(side, 0.0)
                cur = 1 if v > 0 else (-1 if v < 0 else 0)
                if cur != sign:
                    break
                n += 1
            return n, ("accumulating" if sign > 0 else "distributing")

        fii_n, fii_trend = _streak("fiiNetCr")
        dii_n, dii_trend = _streak("diiNetCr")

        return {
            "days": len(history),
            "fiiCum5dCr": round(fii_cum, 2),
            "diiCum5dCr": round(dii_cum, 2),
            "netCum5dCr": round(net_cum, 2),
            "fiiDayChangeCr": round(fii_dod, 2),
            "diiDayChangeCr": round(dii_dod, 2),
            "fiiStreakDays": fii_n,
            "diiStreakDays": dii_n,
            "fiiTrend": fii_trend,
            "diiTrend": dii_trend,
        }

    # --- IST clock helpers ------------------------------------------------

    @staticmethod
    def _ist_now() -> datetime:
        return datetime.now(_IST)

    def _ttl_for(self, now_ist: datetime) -> int:
        # NSE publishes the day's provisional FII/DII roughly between 17:00 and 18:30 IST.
        # During the live cash session (09:15–15:30) numbers are still yesterday's
        # close — refresh slowly. Right around publish window refresh fast.
        h, m = now_ist.hour, now_ist.minute
        if (h == 17) or (h == 18 and m < 30):
            return 120   # publish window — poll often
        if 9 <= h < 16:
            return _TTL_LIVE
        return _TTL_PUBLISHED

    # --- public API -------------------------------------------------------

    async def get_snapshot(self, force: bool = False) -> Dict[str, Any]:
        cache = get_cache()
        if not force:
            cached = await cache.get(_CACHE_KEY)
            if cached:
                cached["fromCache"] = True
                return cached

        async with self._lock:
            # double-check inside the lock
            if not force:
                cached = await cache.get(_CACHE_KEY)
                if cached:
                    cached["fromCache"] = True
                    return cached

            now_ist = self._ist_now()
            try:
                raw = await self._fetch_raw()
                rows = self._parse(raw)
            except Exception as exc:
                logger.error("FII/DII: snapshot build failed: %s", exc)
                return {
                    "success": False,
                    "error": "NSE_FETCH_FAILED",
                    "message": str(exc),
                    "source": "NSE",
                    "fetchedAt": now_ist.isoformat(),
                    "fii": None,
                    "dii": None,
                    "regime": None,
                }

            fii = next((r for r in rows if r.category == "FII"), None)
            dii = next((r for r in rows if r.category == "DII"), None)

            if fii is None or dii is None:
                return {
                    "success": False,
                    "error": "INCOMPLETE_PAYLOAD",
                    "message": "FII or DII row missing in NSE response.",
                    "source": "NSE",
                    "fetchedAt": now_ist.isoformat(),
                    "fii": fii.as_dict() if fii else None,
                    "dii": dii.as_dict() if dii else None,
                    "regime": None,
                }

            regime = self._regime(fii.net_value, dii.net_value)
            derived = self._derive_metrics(fii, dii)

            # Update rolling history and compute trend metrics (5d cumulative, slope, etc.)
            history = await self._update_history(cache, fii, dii)
            trend = self._trend_from_history(history)

            snapshot: Dict[str, Any] = {
                "success": True,
                "source": "NSE",
                "endpoint": _NSE_FII_DII_API,
                "fetchedAt": now_ist.isoformat(),
                "tradeDate": fii.date or dii.date,
                "fii": {**fii.as_dict(), **derived["fii"]},
                "dii": {**dii.as_dict(), **derived["dii"]},
                "netInstitutionalCr": round(fii.net_value + dii.net_value, 2),
                "grossTurnoverCr": derived["grossTurnoverCr"],
                "dominance": derived["dominance"],
                "absorptionPct": derived["absorptionPct"],
                "regime": regime,
                "trend": trend,
                "history": history,
                "fromCache": False,
            }

            self._last_fetch_ms = int(time.time() * 1000)
            await cache.set(_CACHE_KEY, snapshot, expire=self._ttl_for(now_ist))
            return snapshot


fii_dii_service = FIIDIIService()
