"""
FII / DII real-flow service.

Single source: Moneycontrol's `fii_dii_activity` SSR page.
The page embeds the latest N trade days of FII/DII cash-segment NET flows
inside a `__NEXT_DATA__` JSON blob. We parse that blob, treat the newest
row as the "current" snapshot and the rest as rolling history.

NSE's official report endpoint is intentionally NOT used — it is heavily
rate-limited and frequently 403s without a cookie dance, and returns only
the single latest trade-day row (no built-in history).

Buy/sell split is NOT available from this source. Only net flows + the
derived trend metrics. Consumers should treat buyValue/sellValue/gross
fields as 0 when `source == 'Moneycontrol'`.

Public surface:
    await fii_dii_service.get_snapshot() -> dict

Extra payload (when available from source row):
        fiiFnO: FII segment-wise flows in ₹ Cr
            - indexFuturesCr, indexOptionsCr, stockFuturesCr, stockOptionsCr
            - totalFnOCr
            - stance per segment + overall (bullish/bearish/neutral)
        marketContext: NIFTY/SENSEX daily change context from same row
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

import httpx

from services.cache import get_cache

logger = logging.getLogger(__name__)

# Moneycontrol — primary (and only) source.
_MC_HOME = "https://www.moneycontrol.com/"
_MC_FII_DII_PAGE = "https://www.moneycontrol.com/stocks/marketstats/fii_dii_activity/index.php"

# India Standard Time (UTC+5:30)
_IST = timezone(timedelta(hours=5, minutes=30))

_CACHE_KEY = "fii_dii:snapshot"
_HISTORY_KEY = "fii_dii:history"   # rolling list of past trade-date snapshots
_HISTORY_MAX = 10                  # keep last 10 trade days
_HISTORY_TTL = 60 * 60 * 24 * 30   # 30 days

# Refresh cadences (seconds) — Moneycontrol updates its SSR blob at most every
# few minutes; we poll fast enough to catch the post-close provisional update.
_TTL_PUBLISH_WINDOW = 30    # 16:30–19:30 IST Mon–Fri — catches provisional publish ASAP
_TTL_MARKET_HOURS = 120     # 09:15–15:30 IST Mon–Fri — backstop during cash session
_TTL_OFF_HOURS = 1800       # weekday evenings / early morning — every 30 min
_TTL_WEEKEND = 6 * 3600     # Sat / Sun — no fresh prints; 6 h is plenty

_DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": _MC_HOME,
    "Connection": "keep-alive",
}

_NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>',
    re.DOTALL,
)

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
    """Singleton service that pulls FII/DII flow numbers from Moneycontrol."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._last_fetch_ms: int = 0

    # --- network ----------------------------------------------------------

    async def _fetch_mc_rows(self) -> List[Dict[str, Any]]:
        """
        GET the Moneycontrol fii_dii_activity page and extract the
        `fiiDiiData` array (newest-first) from its __NEXT_DATA__ blob.

        Each element has: date (YYYY-MM-DD), fDate, fiiCM (cash net ₹Cr,
        comma-formatted signed string), diiCM, plus F&O sub-segments which
        we don't expose.
        """
        async with httpx.AsyncClient(
            headers=_DEFAULT_HEADERS,
            follow_redirects=True,
            timeout=12.0,
        ) as client:
            resp = await client.get(_MC_FII_DII_PAGE)
            resp.raise_for_status()
            html = resp.text

        m = _NEXT_DATA_RE.search(html)
        if not m:
            raise ValueError("Moneycontrol: __NEXT_DATA__ blob not found in HTML")
        try:
            blob = json.loads(m.group(1))
        except json.JSONDecodeError as exc:
            raise ValueError(f"Moneycontrol: __NEXT_DATA__ not valid JSON: {exc}") from exc

        rows = (
            blob.get("props", {})
                .get("pageProps", {})
                .get("FiiDiiData", {})
                .get("fiiDiiData", [])
        ) or []
        if not isinstance(rows, list) or not rows:
            raise ValueError("Moneycontrol: fiiDiiData array missing / empty")
        return rows

    # --- parsing ----------------------------------------------------------

    @staticmethod
    def _to_float(v: Any) -> float:
        if v is None:
            return 0.0
        if isinstance(v, (int, float)):
            return float(v)
        s = re.sub(r"[,\s\u20b9]", "", str(v))
        try:
            return float(s)
        except ValueError:
            return 0.0

    @staticmethod
    def _segment_stance(value_cr: float, eps: float = 100.0) -> str:
        if value_cr > eps:
            return "bullish"
        if value_cr < -eps:
            return "bearish"
        return "neutral"

    @staticmethod
    def _fmt_date(raw: Any) -> str:
        """Convert MC 'YYYY-MM-DD' (or 'DD-Mon-YYYY' already) into 'DD-Mon-YYYY'."""
        if not raw:
            return ""
        s = str(raw)[:10]
        for fmt in ("%Y-%m-%d", "%d-%b-%Y", "%d-%B-%Y"):
            try:
                return datetime.strptime(s, fmt).strftime("%d-%b-%Y")
            except ValueError:
                continue
        return s

    def _parse_day_rows(self, raw: List[Dict[str, Any]]) -> List[Tuple[str, float, float]]:
        """Return list of (tradeDate, fii_net_cr, dii_net_cr) — newest first."""
        out: List[Tuple[str, float, float]] = []
        seen: set[str] = set()
        for entry in raw:
            d = self._fmt_date(entry.get("date") or entry.get("fDate"))
            if not d or d in seen:
                continue
            seen.add(d)
            out.append((
                d,
                self._to_float(entry.get("fiiCM")),
                self._to_float(entry.get("diiCM")),
            ))
        return out

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
        self,
        cache: Any,
        day_rows: List[Tuple[str, float, float]],
    ) -> List[Dict[str, Any]]:
        """
        Persist last N trade-date snapshots in cache.

        `day_rows` is the freshly-parsed MC list (newest first). We merge it
        with whatever is in the cache, dedup by trade date (MC values win
        because they are the latest available), and keep at most _HISTORY_MAX.
        """
        try:
            existing = await cache.get(_HISTORY_KEY) or []
            if not isinstance(existing, list):
                existing = []
        except Exception:
            existing = []

        fresh_by_date: Dict[str, Dict[str, Any]] = {}
        for trade_date, fii_net, dii_net in day_rows:
            if not trade_date:
                continue
            fresh_by_date[trade_date] = {
                "tradeDate": trade_date,
                "fiiNetCr": round(fii_net, 2),
                "diiNetCr": round(dii_net, 2),
                "netCr": round(fii_net + dii_net, 2),
                "fiiGrossCr": 0.0,
                "diiGrossCr": 0.0,
            }

        # Start with cached rows that MC didn't return (preserve older days
        # that have aged off the SSR page), then layer fresh MC rows on top.
        merged_map: Dict[str, Dict[str, Any]] = {}
        for h in existing:
            d = h.get("tradeDate")
            if d:
                merged_map[d] = h
        merged_map.update(fresh_by_date)

        # Sort oldest → newest by parsed date (fallback: lexical on raw string)
        def _key(h: Dict[str, Any]) -> Tuple[int, str]:
            d = self._parse_trade_date(h.get("tradeDate", ""))
            return (int(d.timestamp()) if d else 0, h.get("tradeDate", ""))

        merged = sorted(merged_map.values(), key=_key)[-_HISTORY_MAX:]

        try:
            await cache.set(_HISTORY_KEY, merged, expire=_HISTORY_TTL)
        except Exception as exc:
            logger.warning("FII/DII: history persist failed: %s", exc)
        return merged

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
        # Trading day windows (IST, Mon–Fri):
        #   16:30–19:30 → publish window, poll every 30 s
        #   09:15–15:30 → cash session, backstop poll every 2 min
        #   anything else weekday → every 30 min
        # Saturday / Sunday → no fresh print is possible; 6 h cache.
        if now_ist.weekday() >= 5:
            return _TTL_WEEKEND
        mins = now_ist.hour * 60 + now_ist.minute
        if 16 * 60 + 30 <= mins < 19 * 60 + 30:
            return _TTL_PUBLISH_WINDOW
        if 9 * 60 + 15 <= mins < 15 * 60 + 30:
            return _TTL_MARKET_HOURS
        return _TTL_OFF_HOURS

    @staticmethod
    def _parse_trade_date(s: str) -> Optional[datetime]:
        """Parse NSE 'DD-Mon-YYYY' as IST midnight."""
        if not s:
            return None
        for fmt in ("%d-%b-%Y", "%d-%B-%Y"):
            try:
                d = datetime.strptime(s, fmt)
                return d.replace(tzinfo=_IST)
            except ValueError:
                continue
        return None

    # --- freshness helpers ------------------------------------------------

    @staticmethod
    def _staleness_bucket(age_sec: int, ttl_sec: int) -> str:
        if age_sec <= max(60, ttl_sec // 2):
            return "fresh"
        if age_sec <= ttl_sec * 2:
            return "recent"
        return "stale"

    def _apply_freshness(self, snap: Dict[str, Any], now_ist: datetime) -> Dict[str, Any]:
        """Recompute dataAgeSec / nextRefreshAt / recommendedPollSec / staleness.

        Called both on a fresh build (age ≈ 0) and every cache hit so the UI
        always sees an accurate countdown rather than the value at write-time.
        """
        ttl = self._ttl_for(now_ist)
        try:
            fetched = datetime.fromisoformat(snap.get("fetchedAt", ""))
        except (TypeError, ValueError):
            fetched = now_ist
        if fetched.tzinfo is None:
            fetched = fetched.replace(tzinfo=_IST)
        age = max(0, int((now_ist - fetched).total_seconds()))
        next_refresh = fetched + timedelta(seconds=ttl)
        next_in = max(0, int((next_refresh - now_ist).total_seconds()))
        snap["dataAgeSec"] = age
        snap["nextRefreshAt"] = next_refresh.isoformat()
        snap["nextRefreshInSec"] = next_in
        snap["recommendedPollSec"] = ttl
        snap["staleness"] = self._staleness_bucket(age, ttl)
        return snap

    # --- public API -------------------------------------------------------

    async def get_snapshot(self, force: bool = False) -> Dict[str, Any]:
        cache = get_cache()
        now_ist = self._ist_now()
        if not force:
            cached = await cache.get(_CACHE_KEY)
            if cached:
                cached["fromCache"] = True
                return self._apply_freshness(cached, now_ist)

        async with self._lock:
            # double-check inside the lock
            now_ist = self._ist_now()
            if not force:
                cached = await cache.get(_CACHE_KEY)
                if cached:
                    cached["fromCache"] = True
                    return self._apply_freshness(cached, now_ist)
            try:
                raw = await self._fetch_mc_rows()
                day_rows = self._parse_day_rows(raw)
            except Exception as exc:
                logger.error("FII/DII: snapshot build failed: %s", exc)
                return {
                    "success": False,
                    "error": "MC_FETCH_FAILED",
                    "message": str(exc),
                    "source": "Moneycontrol",
                    "fetchedAt": now_ist.isoformat(),
                    "fii": None,
                    "dii": None,
                    "regime": None,
                }

            if not day_rows:
                return {
                    "success": False,
                    "error": "INCOMPLETE_PAYLOAD",
                    "message": "Moneycontrol fiiDiiData empty after parse.",
                    "source": "Moneycontrol",
                    "fetchedAt": now_ist.isoformat(),
                    "fii": None,
                    "dii": None,
                    "regime": None,
                }

            # Newest row = current snapshot; the rest go into history.
            latest_date, fii_net, dii_net = day_rows[0]
            latest_row = next(
                (
                    e for e in raw
                    if self._fmt_date(e.get("date") or e.get("fDate")) == latest_date
                ),
                raw[0] if raw else {},
            )
            fii = _FlowRow(category="FII", date=latest_date, buy_value=0.0,
                           sell_value=0.0, net_value=fii_net)
            dii = _FlowRow(category="DII", date=latest_date, buy_value=0.0,
                           sell_value=0.0, net_value=dii_net)

            # Segment-wise FII F&O flows (₹ Cr) available in Moneycontrol row.
            # Useful to mirror participant-segment style dashboards intraday.
            fii_idx_fut = self._to_float(latest_row.get("fiiIdxFut"))
            fii_idx_opt = self._to_float(latest_row.get("fiiIdxOpt"))
            fii_stk_fut = self._to_float(latest_row.get("fiiStkFut"))
            fii_stk_opt = self._to_float(latest_row.get("fiiStkOpt"))
            fii_fno_total = fii_idx_fut + fii_idx_opt + fii_stk_fut + fii_stk_opt

            fii_fno = {
                "indexFuturesCr": round(fii_idx_fut, 2),
                "indexOptionsCr": round(fii_idx_opt, 2),
                "stockFuturesCr": round(fii_stk_fut, 2),
                "stockOptionsCr": round(fii_stk_opt, 2),
                "totalFnOCr": round(fii_fno_total, 2),
                "stance": {
                    "indexFutures": self._segment_stance(fii_idx_fut),
                    "indexOptions": self._segment_stance(fii_idx_opt),
                    "stockFutures": self._segment_stance(fii_stk_fut),
                    "stockOptions": self._segment_stance(fii_stk_opt),
                    "overall": self._segment_stance(fii_fno_total),
                },
            }

            market_context = {
                "niftyClose": round(self._to_float(latest_row.get("niftyClose")), 2),
                "niftyPrevClose": round(self._to_float(latest_row.get("niftyPrevClose")), 2),
                "niftyChange": round(self._to_float(latest_row.get("niftyChange")), 2),
                "niftyChangePct": round(self._to_float(latest_row.get("niftyChangePer")), 3),
                "sensexClose": round(self._to_float(latest_row.get("sensexClose")), 2),
                "sensexPrevClose": round(self._to_float(latest_row.get("sensexPrevClose")), 2),
                "sensexChange": round(self._to_float(latest_row.get("sensexChange")), 2),
                "sensexChangePct": round(self._to_float(latest_row.get("sensexChangePer")), 3),
            }

            regime = self._regime(fii.net_value, dii.net_value)
            derived = self._derive_metrics(fii, dii)

            # Persist + merge history (MC always ships ~30+ prior days, so
            # DoD / 5D / streak are accurate from the very first request).
            history = await self._update_history(cache, day_rows)
            trend = self._trend_from_history(history)

            snapshot: Dict[str, Any] = {
                "success": True,
                "source": "Moneycontrol",
                "endpoint": _MC_FII_DII_PAGE,
                "fetchedAt": now_ist.isoformat(),
                "tradeDate": latest_date,
                "fii": {**fii.as_dict(), **derived["fii"]},
                "dii": {**dii.as_dict(), **derived["dii"]},
                "netInstitutionalCr": round(fii.net_value + dii.net_value, 2),
                "grossTurnoverCr": derived["grossTurnoverCr"],
                "dominance": derived["dominance"],
                "absorptionPct": derived["absorptionPct"],
                "fiiFnO": fii_fno,
                "marketContext": market_context,
                "regime": regime,
                "trend": trend,
                "history": history,
                "hasBuySellSplit": False,  # MC only exposes net flows
                "fromCache": False,
            }

            self._last_fetch_ms = int(time.time() * 1000)
            self._apply_freshness(snapshot, now_ist)
            await cache.set(_CACHE_KEY, snapshot, expire=self._ttl_for(now_ist))
            return snapshot


fii_dii_service = FIIDIIService()
