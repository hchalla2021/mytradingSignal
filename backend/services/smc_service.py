"""
🏛️ Advanced SMC & Market Structure — Service
=============================================
Isolated runner around services.smc_engine:
  • own ConnectionManager (zero shared state with other engines)
  • reads only CacheService keys written by market_feed:
      market:{SYM}                    — live spot / PCR / OI / prev-day levels
      analysis_candles:{SYM}          — closed 5m candles (newest first)
      analysis_candles_15m:{SYM}      — closed 15m candles (newest first)
  • 2s cadence LIVE / 30s otherwise, broadcast only on material change
  • peer candles passed in for SMT divergence (NIFTY⇄BANKNIFTY, SENSEX→NIFTY)
"""

import asyncio
import copy
import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Set, Tuple

import pytz
from fastapi import WebSocket

from services.cache import CacheService
from services.smc_engine import analyze_symbol

logger = logging.getLogger(__name__)
IST = pytz.timezone("Asia/Kolkata")

INDICES = ["NIFTY", "BANKNIFTY", "SENSEX"]
SMT_PEER = {"NIFTY": "BANKNIFTY", "BANKNIFTY": "NIFTY", "SENSEX": "NIFTY"}
LIVE_INTERVAL = 2.0
IDLE_INTERVAL = 30.0
CANDLE_DEPTH = 200


class SMCConnectionManager:
    """Isolated WebSocket manager for /ws/smc."""

    def __init__(self) -> None:
        self._connections: Set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._connections.add(ws)

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(ws)

    async def broadcast(self, data: Dict[str, Any]) -> None:
        if not self._connections:
            return
        msg = json.dumps(data, default=str)
        async with self._lock:
            clients = list(self._connections)
        dead: Set[WebSocket] = set()
        for ws in clients:
            try:
                await asyncio.wait_for(ws.send_text(msg), timeout=3.0)
            except Exception:
                dead.add(ws)
        if dead:
            async with self._lock:
                self._connections -= dead

    async def send_personal(self, ws: WebSocket, data: Dict[str, Any]) -> None:
        try:
            await asyncio.wait_for(ws.send_text(json.dumps(data, default=str)), timeout=3.0)
        except Exception:
            await self.disconnect(ws)

    @property
    def client_count(self) -> int:
        return len(self._connections)


smc_manager = SMCConnectionManager()


def _parse_candle(item: Any) -> Optional[Dict[str, Any]]:
    if isinstance(item, dict):
        return item
    if isinstance(item, str):
        try:
            parsed = json.loads(item)
            return parsed if isinstance(parsed, dict) else None
        except (ValueError, TypeError):
            return None
    return None


class SMCStructureService:
    """Background loop: compute → diff → broadcast → snapshot."""

    def __init__(self, cache: CacheService) -> None:
        self._cache = cache
        self._latest: Dict[str, Any] = {}
        self._last_view: Dict[str, Tuple] = {}
        self._task: Optional[asyncio.Task] = None
        self._running = False

    # ── Cache reads ────────────────────────────────────────────────────────

    async def _read_candles(self, key: str) -> List[Dict[str, Any]]:
        raw = await self._cache.lrange(key, 0, CANDLE_DEPTH - 1)
        out: List[Dict[str, Any]] = []
        for item in reversed(raw):  # newest-first in cache → oldest-first for TA
            c = _parse_candle(item)
            if c and not c.get("_live"):
                out.append(c)
        return out

    async def _read_spot(self, symbol: str) -> Tuple[Dict[str, Any], bool]:
        data = await self._cache.get_market_data(symbol)
        if isinstance(data, dict) and float(data.get("price") or 0) > 0:
            return data, str(data.get("status", "")).upper() == "LIVE"
        return {}, False

    async def _read_live_candle(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Read the in-progress candle without treating it as confirmed structure."""
        live = await self._cache.get(f"analysis_candles_live:{symbol}")
        return live if isinstance(live, dict) and live.get("_live") else None

    # ── Compute one full frame ─────────────────────────────────────────────

    async def _compute_all(self) -> Dict[str, Any]:
        candles_5m: Dict[str, List[Dict[str, Any]]] = {}
        candles_15m: Dict[str, List[Dict[str, Any]]] = {}
        spots: Dict[str, Dict[str, Any]] = {}
        live_candles: Dict[str, Optional[Dict[str, Any]]] = {}
        live_flags: Dict[str, bool] = {}

        for sym in INDICES:
            candles_5m[sym] = await self._read_candles(f"analysis_candles:{sym}")
            candles_15m[sym] = await self._read_candles(f"analysis_candles_15m:{sym}")
            live_candles[sym] = await self._read_live_candle(sym)
            spots[sym], live_flags[sym] = await self._read_spot(sym)

        now_ist = datetime.now(IST)
        frame: Dict[str, Any] = {}
        for sym in INDICES:
            peer = SMT_PEER[sym]
            try:
                result = analyze_symbol(
                    symbol=sym,
                    candles_5m=candles_5m[sym],
                    candles_15m=candles_15m[sym],
                    spot=spots[sym],
                    peer_candles_5m=candles_5m.get(peer) or [],
                    peer_symbol=peer,
                    now_ist=now_ist,
                    live_candle=live_candles[sym],
                )
            except Exception:
                logger.exception("[SMC] analyze_symbol failed for %s", sym)
                continue
            if result:
                result["dataSource"] = "LIVE" if live_flags[sym] else "MARKET_CLOSED"
                result["timestamp"] = now_ist.isoformat()
                frame[sym] = result
        return frame

    @staticmethod
    def _view(row: Dict[str, Any]) -> Tuple:
        """Compact fingerprint — broadcast only when something material moved."""
        plan = row.get("tradePlan") or {}
        pred = row.get("prediction") or {}
        act = plan.get("traderAction") or {}
        return (
            row.get("verdict"),
            row.get("confidence"),
            round(float(row.get("score") or 0), 3),
            (row.get("structure") or {}).get("ltf", {}).get("bias"),
            (row.get("probabilities") or {}).get("continuation"),
            plan.get("stopLoss"),
            act.get("call"),
            act.get("urgency"),
            round(float((row.get("metrics") or {}).get("price") or 0), 1),
            pred.get("direction"),
            pred.get("conviction"),
            (pred.get("magnet") or {}).get("level"),
        )

    # ── Loop / lifecycle ───────────────────────────────────────────────────

    async def _loop(self) -> None:
        logger.info("🏛️ SMC Structure service loop started")
        while self._running:
            try:
                frame = await self._compute_all()
                changed: Dict[str, Any] = {}
                for sym, row in frame.items():
                    self._latest[sym] = row
                    view = self._view(row)
                    # Live overlays must follow every feed frame, not only
                    # structural changes at candle close.
                    is_live = row.get("dataSource") == "LIVE"
                    if is_live or self._last_view.get(sym) != view:
                        self._last_view[sym] = view
                        changed[sym] = row
                if changed:
                    await smc_manager.broadcast({
                        "type": "smc_update",
                        "data": changed,
                        "timestamp": datetime.now(IST).isoformat(),
                    })
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("[SMC] loop error")

            try:
                from services.market_feed import get_market_status
                status = get_market_status()
            except Exception:
                status = "CLOSED"
            await asyncio.sleep(LIVE_INTERVAL if status == "LIVE" else IDLE_INTERVAL)
        logger.info("🏛️ SMC Structure service stopped")

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("🏛️ SMC Structure service started (isolated)")

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    def get_snapshot(self) -> Dict[str, Any]:
        return copy.deepcopy(self._latest)


_instance: Optional[SMCStructureService] = None


def get_smc_service() -> SMCStructureService:
    global _instance
    if _instance is None:
        _instance = SMCStructureService(CacheService())
    return _instance
