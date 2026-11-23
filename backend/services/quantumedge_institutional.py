"""Stateful, isolated institutional-style QuantumEdge research and decision layer.

This module is advisory by default. It does not place or veto broker orders.
No inferred aggressor volume is presented as exchange-confirmed buying/selling.
"""

from __future__ import annotations

import json
import math
import os
import sqlite3
import time
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

IST = datetime.now().astimezone().tzinfo


@dataclass(frozen=True)
class InstitutionalConfig:
    mode: str = "shadow"
    outcome_horizon_seconds: int = 1800
    max_age_seconds: float = 5.0
    min_relative_volume: float = 1.0
    min_adx: float = 18.0
    max_spread_fraction: float = 0.03
    min_depth_quantity: int = 0
    atr_chase_fraction: float = 1.25

    def __post_init__(self) -> None:
        if self.mode not in ("shadow", "live_gate"):
            raise ValueError("Institutional mode must be shadow or live_gate")
        if self.outcome_horizon_seconds < 60:
            raise ValueError("Outcome horizon must be at least 60 seconds")
        if not 0 < self.max_spread_fraction <= 0.20:
            raise ValueError("Invalid spread threshold")
        if not math.isfinite(self.atr_chase_fraction) or self.atr_chase_fraction <= 0:
            raise ValueError("Invalid ATR chase threshold")


def from_environment() -> InstitutionalConfig:
    return InstitutionalConfig(
        mode=os.getenv("QUANTUMEDGE_INSTITUTIONAL_MODE", "shadow").strip().lower(),
        outcome_horizon_seconds=int(os.getenv("QUANTUMEDGE_INSTITUTIONAL_OUTCOME_SECONDS", "1800")),
        max_age_seconds=float(os.getenv("QUANTUMEDGE_INSTITUTIONAL_MAX_AGE_SECONDS", "5")),
        min_relative_volume=float(os.getenv("QUANTUMEDGE_INSTITUTIONAL_MIN_RELATIVE_VOLUME", "1")),
        min_adx=float(os.getenv("QUANTUMEDGE_INSTITUTIONAL_MIN_ADX", "18")),
        max_spread_fraction=float(os.getenv("QUANTUMEDGE_INSTITUTIONAL_MAX_SPREAD", "0.03")),
        min_depth_quantity=int(os.getenv("QUANTUMEDGE_INSTITUTIONAL_MIN_DEPTH", "0")),
        atr_chase_fraction=float(os.getenv("QUANTUMEDGE_INSTITUTIONAL_MAX_ATR_CHASE", "1.25")),
    )


def _finite(value: object) -> bool:
    return type(value) in (int, float) and math.isfinite(float(value))


def aggregate(bars: Sequence[Mapping[str, Any]], seconds: int, now: float | None = None) -> list[dict[str, Any]]:
    grouped: dict[int, list[Mapping[str, Any]]] = {}
    for bar in bars:
        at = bar.get("at")
        if _finite(at):
            grouped.setdefault(int(float(at) // seconds) * seconds, []).append(bar)
    result = []
    for bucket in sorted(grouped):
        group = grouped[bucket]
        if now is not None and bucket + seconds > now:
            continue
        if not group:
            continue
        result.append({
            "at": bucket,
            "open": float(group[0]["open"]),
            "high": max(float(item["high"]) for item in group),
            "low": min(float(item["low"]) for item in group),
            "close": float(group[-1]["close"]),
            "volume": sum(int(item.get("volume") or 0) for item in group),
        })
    return result


def dmi_adx(bars: Sequence[Mapping[str, Any]], period: int = 14) -> dict[str, Any]:
    if len(bars) < period + 1:
        return {"plus_di": None, "-di": None, "adx": None, "slope": None, "state": "UNAVAILABLE"}
    plus_dm, minus_dm, tr = [], [], []
    for previous, current in zip(bars, bars[1:]):
        up_move = float(current["high"]) - float(previous["high"])
        down_move = float(previous["low"]) - float(current["low"])
        plus_dm.append(up_move if up_move > down_move and up_move > 0 else 0.0)
        minus_dm.append(down_move if down_move > up_move and down_move > 0 else 0.0)
        tr.append(max(
            float(current["high"]) - float(current["low"]),
            abs(float(current["high"]) - float(previous["close"])),
            abs(float(current["low"]) - float(previous["close"])),
        ))
    if len(tr) < period:
        return {"plus_di": None, "-di": None, "adx": None, "slope": None, "state": "UNAVAILABLE"}
    smooth_tr = sum(tr[-period:])
    smooth_plus = sum(plus_dm[-period:])
    smooth_minus = sum(minus_dm[-period:])
    plus_di = 100 * smooth_plus / smooth_tr if smooth_tr > 0 else None
    minus_di = 100 * smooth_minus / smooth_tr if smooth_tr > 0 else None
    dx = (100 * abs(smooth_plus - smooth_minus) / (smooth_plus + smooth_minus)
          if smooth_plus + smooth_minus > 0 else 0.0)
    return {
        "plus_di": round(plus_di, 2) if plus_di is not None else None,
        "-di": round(minus_di, 2) if minus_di is not None else None,
        "adx": round(dx, 2),
        "slope": None,
        "state": "STRONG" if dx >= 25 else "TRENDING" if dx >= 18 else "WEAK",
    }


def find_three_candle_fvgs(bars: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    zones = []
    if len(bars) < 3:
        return zones
    for index in range(2, len(bars)):
        first, middle, third = bars[index - 2], bars[index - 1], bars[index]
        bull = float(third["low"]) - float(first["high"])
        bear = float(first["low"]) - float(third["high"])
        if bull > 0:
            zones.append({"side": "BULLISH", "low": float(first["high"]),
                          "high": float(third["low"]), "formed_at": float(third["at"])})
        elif bear > 0:
            zones.append({"side": "BEARISH", "low": float(third["high"]),
                          "high": float(first["low"]), "formed_at": float(third["at"])})
    return zones[-20:]


def completed_candle(bars: Sequence[Mapping[str, Any]], now: float, interval: int) -> list[dict[str, Any]]:
    out = []
    seen = set()
    for bar in bars:
        at = bar.get("at")
        if not _finite(at):
            continue
        at = float(at)
        if at + interval <= now and at not in seen:
            seen.add(at)
            out.append(dict(bar))
    return out


class InstitutionalDecisionEngine:
    def __init__(self, db_path: str | Path | None = None, config: InstitutionalConfig | None = None) -> None:
        self.path = Path(db_path or Path(__file__).resolve().parent.parent / "data" / "aqte" /
                          "quantumedge-institutional.sqlite3")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.config = config or from_environment()
        self._migrate()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(str(self.path), timeout=10)
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA busy_timeout=5000")
        return connection

    def _migrate(self) -> None:
        with closing(self._connect()) as db, db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS qe_institutional_candles (
                    symbol TEXT NOT NULL, interval_seconds INTEGER NOT NULL, at REAL NOT NULL,
                    open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL,
                    volume REAL NOT NULL, source TEXT NOT NULL, PRIMARY KEY(symbol,interval_seconds,at));
                CREATE TABLE IF NOT EXISTS qe_institutional_context (
                    symbol TEXT NOT NULL, at REAL NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL,
                    PRIMARY KEY(symbol,at,kind));
                CREATE TABLE IF NOT EXISTS qe_institutional_decisions (
                    id TEXT PRIMARY KEY, at REAL NOT NULL, symbol TEXT NOT NULL,
                    direction TEXT, payload TEXT NOT NULL, outcome_at REAL,
                    outcome_payload TEXT);
                CREATE INDEX IF NOT EXISTS qe_decision_time ON qe_institutional_decisions(at);
            """)

    def persist_candles(self, symbol: str, bars: Sequence[Mapping[str, Any]]) -> None:
        rows = []
        for interval in (60, 120, 180, 300, 900, 1800, 3600, 86400):
            timeframe = aggregate(bars, interval)
            for bar in timeframe[-30:]:
                rows.append((symbol, interval, float(bar["at"]), float(bar["open"]), float(bar["high"]),
                             float(bar["low"]), float(bar["close"]), float(bar["volume"]), "AGGREGATED_CANDLE"))
        with closing(self._connect()) as db, db:
            db.executemany("""
                INSERT OR REPLACE INTO qe_institutional_candles
                (symbol,interval_seconds,at,open,high,low,close,volume,source)
                VALUES(?,?,?,?,?,?,?,?,?)""", rows)

    def load_candles(self, symbol: str, interval: int, limit: int = 600) -> list[dict[str, Any]]:
        with closing(self._connect()) as db:
            rows = db.execute("""
                SELECT at,open,high,low,close,volume FROM qe_institutional_candles
                WHERE symbol=? AND interval_seconds=? ORDER BY at DESC LIMIT ?""",
                (symbol, interval, limit)).fetchall()
        return [{"at": at, "open": op, "high": high, "low": low, "close": close, "volume": volume}
                for at, op, high, low, close, volume in reversed(rows)]

    def persist_context(self, symbol: str, now: float, kind: str, payload: Mapping[str, Any]) -> None:
        with closing(self._connect()) as db, db:
            db.execute("""
                INSERT OR REPLACE INTO qe_institutional_context(symbol,at,kind,payload)
                VALUES(?,?,?,?)""", (symbol, now, kind, json.dumps(payload, allow_nan=False)))

    def _option_evidence(self, contract: Mapping[str, Any] | None,
                         quote: Any, now: float) -> tuple[dict[str, Any], list[str]]:
        vetoes = []
        evidence = {"contract": None, "quote": None, "greeks": "UNAVAILABLE"}
        if not contract or quote is None:
            vetoes.append("MISSING_OPTION_CONTRACT_OR_QUOTE")
            return evidence, vetoes
        try:
            bid, ask = float(getattr(quote, "bid", 0) or 0), float(getattr(quote, "ask", 0) or 0)
            bid_qty = int(getattr(quote, "bid_quantity", 0) or 0)
            ask_qty = int(getattr(quote, "ask_quantity", 0) or 0)
            volume = int(getattr(quote, "volume", 0) or 0)
            oi = getattr(quote, "oi", None)
            at, received = float(getattr(quote, "at", 0) or 0), float(getattr(quote, "received", 0) or 0)
        except (TypeError, ValueError, OverflowError):
            vetoes.append("INVALID_OPTION_QUOTE")
            return evidence, vetoes
        age = now - received if received else math.inf
        spread = (ask - bid) / ask if 0 < bid <= ask else None
        evidence["contract"] = dict(contract)
        evidence["quote"] = {
            "ltp": float(getattr(quote, "price", 0) or 0), "bid": bid, "ask": ask,
            "bid_quantity": bid_qty, "ask_quantity": ask_qty, "volume": volume,
            "oi": oi if _finite(oi) else None, "spread_fraction": round(spread, 5) if spread is not None else None,
            "exchange_timestamp": at, "received": received, "age_seconds": round(age, 3),
            "depth_source": "ZERODHA_FULL_DEPTH_PENDING_QUANTITIES",
            "greeks_source": "UNAVAILABLE",
        }
        if age < 0 or age > self.config.max_age_seconds:
            vetoes.append("STALE_OPTION_QUOTE")
        if spread is None or spread > self.config.max_spread_fraction:
            vetoes.append("EXCESSIVE_OR_MISSING_OPTION_SPREAD")
        if volume <= 0:
            vetoes.append("ZERO_OPTION_VOLUME")
        if bid_qty <= 0 or ask_qty <= 0:
            vetoes.append("MISSING_OPTION_BOOK_DEPTH")
        if self.config.min_depth_quantity > 0:
            if bid_qty < self.config.min_depth_quantity or ask_qty < self.config.min_depth_quantity:
                vetoes.append("OPTION_BOOK_DEPTH_BELOW_MINIMUM")
        return evidence, vetoes

    def evaluate(
        self,
        *,
        symbol: str,
        now: float,
        candidate: Mapping[str, Any] | None,
        bars_1m: Sequence[Mapping[str, Any]],
        spot: Any,
        future: Any,
        contract: Mapping[str, Any] | None,
        quote: Any,
        pcr: Mapping[str, Any] | None = None,
        order_flow: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        vetoes: list[str] = []
        bars_1m = completed_candle(bars_1m, now, 60)
        if len(bars_1m) < 16:
            vetoes.append("INSUFFICIENT_COMPLETED_1M_CANDLES")
        self.persist_candles(symbol, bars_1m)

        timeframe = {}
        for label, interval in (("1m", 60), ("2m", 120), ("3m", 180), ("5m", 300),
                                ("15m", 900), ("30m", 1800), ("1h", 3600), ("1d", 86400)):
            values = aggregate(bars_1m, interval, now)
            timeframe[label] = {
                "bars": len(values),
                "contiguous": len(values) >= (2 if interval >= 300 else 16),
                "dmi_adx": dmi_adx(values),
                "fvgs": find_three_candle_fvgs(values),
            }

        direction = candidate.get("side") if isinstance(candidate, Mapping) else None
        if direction not in ("CE", "PE"):
            vetoes.append("MISSING_CONFIRMED_DIRECTION")
        if not candidate or candidate.get("decision") not in ("BUY CE", "BUY PE"):
            vetoes.append("MISSING_CONFIRMED_SETUP")

        if not spot or not future:
            vetoes.append("MISSING_SPOT_OR_FUTURES")
        elif (not _finite(getattr(spot, "received", None)) or
              not _finite(getattr(future, "received", None)) or
              now - float(getattr(spot, "received", 0)) > self.config.max_age_seconds or
              now - float(getattr(future, "received", 0)) > self.config.max_age_seconds):
            vetoes.append("STALE_SPOT_OR_FUTURES")

        regime = timeframe["1h"]["dmi_adx"]
        setup15 = timeframe["15m"]["dmi_adx"]
        setup5 = timeframe["5m"]["dmi_adx"]
        if regime["plus_di"] is None or setup15["plus_di"] is None or setup5["plus_di"] is None:
            vetoes.append("INCOMPLETE_MTF_DMI_ADX")
        elif direction == "CE" and (setup15["-di"] is not None and setup15["-di"] > setup15["plus_di"]):
            vetoes.append("15M_DI_CONFLICTS_WITH_CE")
        elif direction == "PE" and (setup15["plus_di"] is not None and setup15["plus_di"] > setup15["-di"]):
            vetoes.append("15M_DI_CONFLICTS_WITH_PE")

        current = bars_1m[-1]
        previous = bars_1m[-2] if len(bars_1m) >= 2 else None
        close = float(current["close"])
        prior_close = float(previous["close"]) if previous else None
        avg_volume = sum(float(bar["volume"]) for bar in bars_1m[-21:-1]) / 20 if len(bars_1m) >= 21 else None
        relative_volume = float(current["volume"]) / avg_volume if avg_volume and avg_volume > 0 else None
        if relative_volume is None or relative_volume < self.config.min_relative_volume:
            vetoes.append("MISSING_OR_LOW_RELATIVE_VOLUME")

        option_evidence, option_vetoes = self._option_evidence(contract, quote, now)
        vetoes.extend(option_vetoes)

        pcr_evidence = dict(pcr or {})
        pcr_value = pcr_evidence.get("pcr")
        pcr_sentiment = pcr_evidence.get("sentiment")
        if not _finite(pcr_value) or pcr_value <= 0:
            vetoes.append("MISSING_PCR")

        if pcr_sentiment in ("bullish", "bearish") and direction:
            if direction == "CE" and pcr_sentiment == "bearish":
                vetoes.append("PCR_CONFLICTS_WITH_CE")
            if direction == "PE" and pcr_sentiment == "bullish":
                vetoes.append("PCR_CONFLICTS_WITH_PE")

        flow_evidence = dict(order_flow or {})
        if not flow_evidence:
            vetoes.append("MISSING_ORDER_FLOW")
        elif flow_evidence.get("aggressor_side_is_estimated") is not True:
            vetoes.append("ORDER_FLOW_MISSING_ESTIMATE_PROVENANCE")

        entry = candidate.get("entry") if isinstance(candidate, Mapping) else None
        stop = entry.get("stop") if isinstance(entry, Mapping) else None
        target = entry.get("target") if isinstance(entry, Mapping) else None
        maximum = entry.get("maximum") if isinstance(entry, Mapping) else None
        risk = candidate.get("risk") if isinstance(candidate, Mapping) else None
        if not all(_finite(value) and float(value) > 0 for value in (stop, target, maximum, risk)):
            vetoes.append("MISSING_OR_INVALID_STRUCTURAL_PREMIUM_RISK")
        elif direction == "CE" and not (stop < maximum < target):
            vetoes.append("INVALID_CE_STOP_TARGET_STRUCTURE")
        elif direction == "PE" and not (stop < maximum < target):
            vetoes.append("INVALID_PE_STOP_TARGET_STRUCTURE")

        unique_vetoes = list(dict.fromkeys(vetoes))
        permission = "ALLOW" if not unique_vetoes else "NO_TRADE"
        score = max(0, 100 - 8 * len(unique_vetoes))
        decision_id = f"QEI-{symbol}-{int(now * 1000)}-{direction or 'NONE'}"
        decision = {
            "decision_id": decision_id,
            "at": now,
            "outcome_at": now + self.config.outcome_horizon_seconds,
            "symbol": symbol,
            "direction": direction,
            "mode": self.config.mode,
            "permission": permission,
            "score": score,
            "mandatory_conditions": [
                "fresh_spot_and_futures",
                "contiguous_completed_candles",
                "higher_timeframe_not_conflicting",
                "relative_volume",
                "option_spread_depth_volume",
                "pcr_context",
                "structural_stop_target",
            ],
            "vetoes": unique_vetoes,
            "market_regime": {
                "1h": timeframe["1h"]["dmi_adx"],
                "30m": timeframe["30m"]["dmi_adx"],
                "15m": timeframe["15m"]["dmi_adx"],
                "5m": timeframe["5m"]["dmi_adx"],
            },
            "timeframes": timeframe,
            "liquidity": {
                "order_flow": flow_evidence,
                "previous_close": prior_close,
                "current_close": close,
            },
            "pcr": pcr_evidence,
            "option": option_evidence,
            "relative_volume": relative_volume,
            "underlying": {
                "spot": float(getattr(spot, "price", 0) or 0),
                "futures": float(getattr(future, "price", 0) or 0),
            },
            "candidate": dict(candidate) if isinstance(candidate, Mapping) else None,
        }
        self.persist_context(symbol, now, "institutional_decision_context", {
            "market_regime": decision["market_regime"],
            "timeframe_bars": {label: values["bars"] for label, values in timeframe.items()},
            "liquidity": decision["liquidity"],
            "pcr": pcr_evidence,
            "option": option_evidence,
            "relative_volume": relative_volume,
        })
        with closing(self._connect()) as db, db:
            db.execute("""
                INSERT OR REPLACE INTO qe_institutional_decisions
                (id,at,symbol,direction,payload,outcome_at,outcome_payload)
                VALUES(?,?,?,?,?,?,NULL)""",
                (decision_id, now, symbol, direction, json.dumps(decision, allow_nan=False),
                 decision["outcome_at"]))
        return decision

    def due_outcomes(self, now: float) -> list[dict[str, Any]]:
        with closing(self._connect()) as db:
            rows = db.execute("""
                SELECT id,payload FROM qe_institutional_decisions
                WHERE outcome_at<=? AND outcome_payload IS NULL ORDER BY at""", (now,)).fetchall()
        return [{"id": row[0], "payload": json.loads(row[1])} for row in rows]

    def record_outcome(self, decision_id: str, now: float, payload: Mapping[str, Any]) -> None:
        with closing(self._connect()) as db, db:
            db.execute("""
                UPDATE qe_institutional_decisions
                SET outcome_payload=? WHERE id=?""",
                (json.dumps(dict(payload), allow_nan=False), decision_id))
