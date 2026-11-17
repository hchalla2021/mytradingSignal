"""Cost-aware risk calculations for AUTONOMIQ PRO live execution.

These calculations do not place orders or guarantee fills. The executor supplies
broker-reconciled positions, pending intents, fresh prices and cost estimates.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Mapping, Sequence

from .config import AutonomiqConfig

SYMBOLS: frozenset[str] = frozenset(("NIFTY", "BANKNIFTY", "SENSEX"))


def _finite(value: float, name: str, *, minimum: float | None = None) -> float:
    if not math.isfinite(value) or (minimum is not None and value < minimum):
        raise ValueError(f"{name} must be finite" + (f" and at least {minimum}" if minimum is not None else ""))
    return value


@dataclass(frozen=True)
class Exposure:
    symbol: str
    net_pnl: float
    remaining_risk: float


@dataclass(frozen=True)
class EntryRisk:
    symbol: str
    entry: float
    stop: float
    quantity: int
    lot_size: int
    estimated_round_trip_cost: float
    estimated_exit_slippage: float

    def estimated_loss(self) -> float:
        if self.symbol not in SYMBOLS:
            raise ValueError("Unsupported index")
        _finite(self.entry, "entry", minimum=0.01)
        _finite(self.stop, "stop", minimum=0.01)
        if self.stop >= self.entry:
            raise ValueError("Stop must be below entry")
        if type(self.quantity) is not int or self.quantity <= 0:
            raise ValueError("Quantity must be a positive integer")
        if type(self.lot_size) is not int or self.lot_size <= 0:
            raise ValueError("Lot size must be a positive integer")
        if self.quantity != self.lot_size:
            raise ValueError("Only one lot per index is permitted")
        _finite(self.estimated_round_trip_cost, "estimated round-trip cost", minimum=0)
        _finite(self.estimated_exit_slippage, "estimated exit slippage", minimum=0)
        return ((self.entry - self.stop) * self.quantity
                + self.estimated_round_trip_cost + self.estimated_exit_slippage)


def entry_rejections(
    candidate: EntryRisk,
    *,
    realized_net: Mapping[str, float],
    exposures: Sequence[Exposure],
    pending: Sequence[Exposure],
    trades_today: int,
    cfg: AutonomiqConfig,
) -> list[str]:
    """Assess one entry using estimated net P&L and worst-case reserved risk.

    Pending intents count toward position/trade limits and reserve loss budget;
    trades_today counts filled entries and excludes pending intents. The caller
    must serialize this check with persisting its new intent.
    """
    loss = candidate.estimated_loss()
    _finite(cfg.index_daily_loss_limit_rupees, "index daily loss limit", minimum=0)
    if type(trades_today) is not int or trades_today < 0:
        raise ValueError("trades_today must be a non-negative integer")
    if set(realized_net) != set(SYMBOLS):
        raise ValueError("Realized P&L is required for every index")
    for symbol, pnl in realized_net.items():
        if symbol not in SYMBOLS:
            raise ValueError("Unsupported index in realized P&L")
        _finite(pnl, "realized P&L")
    all_exposures = [*exposures, *pending]
    for item in all_exposures:
        if item.symbol not in SYMBOLS:
            raise ValueError("Unsupported index in exposure")
        _finite(item.net_pnl, "exposure P&L")
        _finite(item.remaining_risk, "remaining risk", minimum=0)
    if any(item.net_pnl != 0 for item in pending):
        raise ValueError("Pending entries must not include position P&L")

    index_pnl = realized_net.get(candidate.symbol, 0.0) + sum(
        item.net_pnl for item in exposures if item.symbol == candidate.symbol
    )
    global_pnl = sum(realized_net.values()) + sum(item.net_pnl for item in exposures)
    index_reserved = sum(item.remaining_risk for item in all_exposures if item.symbol == candidate.symbol)
    global_reserved = sum(item.remaining_risk for item in all_exposures)
    reasons: list[str] = []
    if loss > cfg.max_risk_per_trade_rupees:
        reasons.append(f"Estimated per-trade loss ₹{loss:,.2f} exceeds ₹{cfg.max_risk_per_trade_rupees:,.2f}")
    for scope, limit, pnl, reserved in (
        ("Index", cfg.index_daily_loss_limit_rupees, index_pnl, index_reserved),
        ("Global", cfg.daily_loss_limit_rupees, global_pnl, global_reserved),
    ):
        if pnl - reserved - loss < -limit:
            reasons.append(
                f"{scope} daily loss budget exceeded: estimated new loss including costs/slippage "
                f"₹{loss:,.2f} exceeds available ₹{limit + pnl - reserved:,.2f} "
                f"(limit ₹{limit:,.2f}; net P&L ₹{pnl:,.2f}; reserved ₹{reserved:,.2f})"
            )
    if len(all_exposures) >= cfg.max_open_positions:
        reasons.append("Global position limit reached")
    if any(item.symbol == candidate.symbol for item in all_exposures):
        reasons.append("Index already has an open position or pending entry")
    if trades_today + len(pending) >= cfg.max_trades_per_day:
        reasons.append("Daily trade limit reached")
    return reasons


@dataclass(frozen=True)
class TrailDecision:
    stop: float
    activated: bool
    exit_required: bool


def trailing_stop(
    *,
    entry: float,
    initial_stop: float,
    current_stop: float,
    highest_bid: float,
    current_bid: float,
    option_atr: float,
    quantity: int,
    estimated_round_trip_cost: float,
    estimated_exit_slippage: float,
    tick_size: float,
) -> TrailDecision:
    """Return a monotonic 2x option-ATR trail, activated at +1R.

    R includes estimated round-trip costs. A stop at or above the current bid
    requires an exit rather than submitting an invalid new protective trigger.
    """
    _finite(entry, "entry", minimum=0.01)
    _finite(initial_stop, "initial stop", minimum=0.01)
    _finite(current_stop, "current stop", minimum=0.01)
    _finite(highest_bid, "highest bid", minimum=0.01)
    _finite(current_bid, "current bid", minimum=0.01)
    _finite(option_atr, "option ATR", minimum=0.01)
    _finite(estimated_round_trip_cost, "estimated round-trip cost", minimum=0)
    _finite(estimated_exit_slippage, "estimated exit slippage", minimum=0)
    _finite(tick_size, "tick size", minimum=0.000001)
    if type(quantity) is not int or quantity <= 0:
        raise ValueError("Quantity must be a positive integer")
    if initial_stop >= entry or current_stop < initial_stop or highest_bid < current_bid:
        raise ValueError("Inconsistent stop or bid history")
    costs = estimated_round_trip_cost + estimated_exit_slippage
    risk_points = entry - initial_stop + costs / quantity
    activated = highest_bid >= entry + risk_points
    if not activated:
        return TrailDecision(current_stop, False, current_bid <= current_stop)
    breakeven = entry + costs / quantity
    candidate = max(current_stop, breakeven, highest_bid - 2 * option_atr)
    stop = max(current_stop, round(math.ceil((candidate / tick_size) - 1e-10) * tick_size, 8))
    return TrailDecision(stop, True, current_bid <= stop)
