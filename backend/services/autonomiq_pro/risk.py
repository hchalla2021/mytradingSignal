"""Independent Python risk-validation engine and paper-position rules for AUTONOMIQ PRO.

This module is the final authority: AI output can never bypass these checks.
"""

from __future__ import annotations

import math
from datetime import datetime, time
from typing import Any

from . import indicators as ind

TICK = 0.05
REENTRY_COOLDOWN_S = 15 * 60


def price_structure(candles: list[dict[str, Any]]) -> dict[str, Any]:
    recent = candles[-20:]
    if len(recent) < 5:
        raise ValueError("Completed candle structure is unavailable")
    lows, highs = [], []
    for i in range(2, len(recent) - 2):
        neighbours = recent[i - 2:i] + recent[i + 1:i + 3]
        if all(recent[i]["low"] < c["low"] for c in neighbours):
            lows.append(recent[i]["low"])
        if all(recent[i]["high"] > c["high"] for c in neighbours):
            highs.append(recent[i]["high"])
    return {
        "support": min(min(c["low"] for c in recent[-3:]), lows[-1] if lows else recent[-1]["low"]),
        "resistance": max(max(c["high"] for c in recent[-3:]), highs[-1] if highs else recent[-1]["high"]),
        "swing_lows": lows, "swing_highs": highs,
        "previous_candle": {k: recent[-1][k] for k in ("open", "high", "low", "close")},
    }


def live_targets(entry: float, stop: float, quantity: int, cfg: Any, tick_size: float = TICK) -> tuple[float, float]:
    costs = cfg.estimated_round_trip_cost_rupees / quantity + entry * cfg.max_exit_slippage_pct / 100
    risk = entry - stop + costs
    targets = [round(math.ceil((entry + costs + multiple * risk) / tick_size - 1e-10) * tick_size, 8)
               for multiple in (1, max(2, cfg.min_risk_reward))]
    return targets[0], targets[1]


def measured_atr(candles: list[dict[str, Any]]) -> float:
    if len(candles) < 14:
        raise ValueError("At least 14 completed candles are required for hybrid risk")
    for candle in candles:
        o, h, low, c = (candle[k] for k in ("open", "high", "low", "close"))
        if not all(math.isfinite(v) and v > 0 for v in (o, h, low, c)) or not low <= min(o, c) <= max(o, c) <= h:
            raise ValueError("Invalid OHLC data for hybrid risk")
    value = ind.atr(candles)
    if value is None or not math.isfinite(value) or value <= 0:
        raise ValueError("Measured candle ATR is unavailable")
    return value


def hybrid_levels(*, entry: float, bid: float, quantity: int, delta: float, option_type: str,
                  index_candles: list[dict[str, Any]], option_candles: list[dict[str, Any]], cfg: Any,
                  tick_size: float = TICK) -> dict[str, float]:
    """Conservative premium stop with completed-candle invalidation and net-R targets."""
    if (option_type not in ("CE", "PE") or not math.isfinite(delta) or not 0 < abs(delta) <= 1
            or not math.isfinite(entry) or not math.isfinite(bid) or not 0 < bid <= entry
            or delta * (1 if option_type == "CE" else -1) <= 0
            or quantity <= 0 or not math.isfinite(tick_size) or tick_size <= 0):
        raise ValueError("Invalid quote or contract inputs for hybrid risk")
    option_atr, index_atr = measured_atr(option_candles), measured_atr(index_candles)
    option, underlying = price_structure(option_candles), price_structure(index_candles)
    reference = index_candles[-1]["close"]
    buffer = max(option_atr * .2, 2 * (entry - bid), 2 * tick_size)
    invalidation = (reference - underlying["support"] if option_type == "CE"
                    else underlying["resistance"] - reference) + .2 * index_atr
    distance = max(entry - option["support"] + buffer, 1.5 * option_atr, abs(delta) * invalidation)
    stop = round(math.floor((entry - distance) / tick_size + 1e-10) * tick_size, 8)
    if not 0 < stop < bid:
        raise ValueError("Structural stop is invalid or already breached")
    target1, target2 = live_targets(entry, stop, quantity, cfg, tick_size)
    barriers = [level - entry for level in option["swing_highs"] if level > entry]
    prior = [c for c in index_candles if c["date"][:10] < index_candles[-1]["date"][:10]]
    previous_day = prior[-1]["date"][:10] if prior else None
    prior_session = [c for c in prior if c["date"][:10] == previous_day]
    if option_type == "CE":
        levels = [*underlying["swing_highs"]]
        if prior_session:
            levels.append(max(c["high"] for c in prior_session))
        barriers.extend((level - reference) * abs(delta) for level in levels if level > reference)
    else:
        levels = [*underlying["swing_lows"]]
        if prior_session:
            levels.append(min(c["low"] for c in prior_session))
        barriers.extend((reference - level) * abs(delta) for level in levels if level < reference)
    required_room = target2 - entry + buffer
    available_room = min(barriers) if barriers else math.inf
    if available_room < required_room:
        raise ValueError(
            "Insufficient room to the next candle resistance/support for cost-aware T2: "
            f"required option move ₹{required_room:.2f}, available ₹{available_room:.2f} "
            f"(entry ₹{entry:.2f}, stop ₹{stop:.2f}, T2 ₹{target2:.2f})"
        )
    return {"stop_loss": stop, "target1": target1, "target2": target2,
            "risk": round(entry - stop, 8), "option_atr": option_atr}


def tick(value: float) -> float:
    return round(round(value / TICK) * TICK, 2)


def _leg_ok(leg: dict | None, max_spread_pct: float, max_age_s: float) -> str | None:
    if not leg or leg.get("ask", 0) <= 0 or leg.get("bid", 0) <= 0:
        return "no two-sided quote"
    if leg.get("spread_pct") is None or leg["spread_pct"] > max_spread_pct:
        return f"spread {leg.get('spread_pct')}% > {max_spread_pct}%"
    if leg.get("trade_age_s") is None or leg["trade_age_s"] > max_age_s:
        return f"last trade {leg.get('trade_age_s')}s old"
    if leg.get("delta") is None:
        return "Greeks unavailable"
    return None


def build_plan(symbol: str, action: str, chain: dict, atr_5m: float | None, cfg: Any) -> dict:
    """Pick ATM (or 1-step ITM) contract and derive SL/targets from live premium and spot ATR."""
    kind = "CE" if action == "BUY_CE" else "PE"
    strikes = chain["strikes"]
    atm_index = next((i for i, s in enumerate(strikes) if s["strike"] == chain["atm"]), None)
    if atm_index is None or not atr_5m:
        return {"error": "ATM strike or ATR unavailable"}
    itm_index = atm_index - 1 if kind == "CE" else atm_index + 1
    rejected = []
    for index in (atm_index, itm_index):
        if not 0 <= index < len(strikes):
            continue
        leg = strikes[index].get(kind)
        problem = _leg_ok(leg, cfg.max_spread_pct, cfg.max_option_quote_age_seconds)
        if problem:
            rejected.append(f"{strikes[index]['strike']:g}{kind}: {problem}")
            continue
        entry = tick(leg["ask"])
        expected_move = abs(leg["delta"]) * atr_5m * 1.5
        risk = tick(min(max(expected_move, entry * 0.10), entry * 0.30))
        if risk <= 0 or entry <= risk:
            rejected.append(f"{leg['tradingsymbol']}: invalid risk")
            continue
        return {
            "symbol": symbol, "action": action, "option_type": kind, "exchange": chain["exchange"],
            "tradingsymbol": leg["tradingsymbol"], "strike": strikes[index]["strike"], "expiry": chain["expiry"],
            "lot_size": leg["lot_size"], "lots": 1,
            "entry": entry, "stop_loss": tick(entry - risk), "trailing_sl": tick(entry - risk * 0.5),
            "trail_activation": tick(entry + risk * 0.5),
            "target1": tick(entry + risk), "target2": tick(entry + risk * 2), "risk": risk,
            "risk_reward": round((risk * 2) / risk, 2),
            "risk_rupees": round(risk * leg["lot_size"], 2),
            "quote": {k: leg.get(k) for k in ("ltp", "bid", "ask", "spread_pct", "trade_age_s", "iv",
                                              "delta", "gamma", "theta", "vega", "oi", "volume")},
        }
    return {"error": "No liquid contract: " + "; ".join(rejected)}


def validate(plan: dict, *, cfg: Any, now: datetime, session: dict, spot: dict, state: dict,
             open_trades: list[dict], day_stats: dict, recent_trades: list[dict]) -> dict:
    checks: list[dict] = []

    def check(name: str, passed: bool, detail: str = "") -> None:
        checks.append({"name": name, "passed": bool(passed), "detail": detail})

    check("Kill switch off", not state.get("kill_switch"), "Kill switch engaged" if state.get("kill_switch") else "")
    check("Engine enabled", cfg.enabled and state.get("engine_enabled", True))
    check("Trading day", session["trading_day"], session["reason"])
    in_window = cfg.market_start <= now.time() <= cfg.entry_cutoff
    check("Entry window", in_window, f"{cfg.market_start:%H:%M}–{cfg.entry_cutoff:%H:%M} IST")
    check("Spot data fresh", bool(spot.get("fresh")), f"age {spot.get('age_s')}s")
    if plan.get("error"):
        check("Contract selection", False, plan["error"])
        return {"approved": False, "checks": checks}

    q = plan["quote"]
    check("Option quote fresh", q.get("trade_age_s") is not None
          and q["trade_age_s"] <= cfg.max_option_quote_age_seconds, f"last trade {q.get('trade_age_s')}s ago")
    check("Spread acceptable", q.get("spread_pct") is not None and q["spread_pct"] <= cfg.max_spread_pct,
          f"{q.get('spread_pct')}%")
    sl_valid = 0 < plan["stop_loss"] < plan["trailing_sl"] < plan["entry"] < plan["target1"] < plan["target2"]
    check("Stop-loss structure valid", sl_valid,
          f"SL {plan['stop_loss']} < entry {plan['entry']} < T1 {plan['target1']} < T2 {plan['target2']}")
    check("Risk/reward", plan["risk_reward"] >= cfg.min_risk_reward, f"{plan['risk_reward']} ≥ {cfg.min_risk_reward}")
    risk_within_limit = plan["risk_rupees"] <= cfg.max_risk_per_trade_rupees
    quantity = plan["lot_size"] * plan["lots"]
    check("Risk per trade", risk_within_limit,
          f"Stop risk ₹{plan['risk_rupees']:,.2f} {'within' if risk_within_limit else 'exceeds'} "
          f"₹{cfg.max_risk_per_trade_rupees:,.2f} limit "
          f"({quantity} units x {plan['entry'] - plan['stop_loss']:.2f} stop points; before fees/slippage)")
    duplicate = any(t["symbol"] == plan["symbol"] for t in open_trades)
    check("No duplicate position", not duplicate, "Open position already exists" if duplicate else "")
    check("Position limit", len(open_trades) < cfg.max_open_positions,
          f"{len(open_trades)}/{cfg.max_open_positions} open")
    check("Daily trade limit", day_stats["trades"] < cfg.max_trades_per_day,
          f"{day_stats['trades']}/{cfg.max_trades_per_day} today")
    unrealized = sum(((t.get("last_price") or t["entry"]) - t["entry"]) * t["lot_size"] * t["lots"]
                     for t in open_trades)
    pnl = day_stats["realized"] + unrealized
    check("Daily loss limit", pnl > -cfg.daily_loss_limit_rupees,
          f"day P&L ₹{pnl:,.0f} vs limit -₹{cfg.daily_loss_limit_rupees:,.0f}")
    cooldown = _in_cooldown(plan["symbol"], recent_trades, now)
    check("Re-entry cooldown", not cooldown, "Closed < 15 min ago" if cooldown else "")
    return {"approved": all(c["passed"] for c in checks), "checks": checks}


def _in_cooldown(symbol: str, trades: list[dict], now: datetime) -> bool:
    for t in trades:
        if t["symbol"] == symbol and t.get("closed_at"):
            try:
                closed = datetime.fromisoformat(t["closed_at"])
            except ValueError:
                continue
            if 0 <= (now - closed).total_seconds() < REENTRY_COOLDOWN_S:
                return True
    return False


def manage_position(trade: dict, price: float, now_time: time, square_off: time) -> dict:
    """Return updates for one open paper trade given the latest executable (bid) price.

    The active stop starts at the stop-loss and trails 1R behind price once price reaches
    entry + 0.5R; at T1 it is at least breakeven. T2 exits the trade.
    """
    entry, risk = trade["entry"], trade["risk"]
    stop = trade["trailing_sl"]
    if price >= entry + risk * 0.5:
        stop = max(stop, tick(price - risk))
    if price >= trade["target1"]:
        stop = max(stop, entry)
    updates: dict[str, Any] = {"last_price": price, "trailing_sl": stop}
    reason = None
    if price <= stop:
        reason = "STOP_LOSS" if stop <= trade["stop_loss"] else "TRAILING_SL"
    elif price >= trade["target2"]:
        reason = "TARGET2"
    elif now_time >= square_off:
        reason = "SQUARE_OFF"
    if reason:
        updates.update(status="CLOSED", exit_price=price, exit_reason=reason,
                       pnl=round((price - entry) * trade["lot_size"] * trade["lots"], 2))
    return updates
