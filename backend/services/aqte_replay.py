"""Chronological offline replay of AQTE-recorded quotes, using the paper core."""

import argparse
import json
import sqlite3
from contextlib import closing
from dataclasses import asdict
from datetime import datetime, timedelta
from pathlib import Path

from services.aqte_engine import AQTEEngine, Contract, IST, Policy, Tick


def replay(ticks, contracts, policy=None):
    engine = AQTEEngine(policy)
    engine.contracts = {c.token: c for c in contracts}
    previous = None
    start = end = None
    count = 0
    peak = drawdown = equity = 0
    closed = 0
    for tick in ticks:
        if previous is not None and tick.received < previous:
            raise ValueError("Replay input must be chronological by receive time")
        previous = tick.received
        start = start if start is not None else tick.received
        end = tick.received
        engine.ingest(tick)
        count += 1
        for trade in engine.trades[closed:]:
            equity += trade["net_pnl"]
            peak = max(peak, equity)
            drawdown = max(drawdown, peak - equity)
        closed = len(engine.trades)
        engine.events.clear()
    wins = sum(t["net_pnl"] > 0 for t in engine.trades)
    gross_profit = sum(max(0, t["net_pnl"]) for t in engine.trades)
    gross_loss = -sum(min(0, t["net_pnl"]) for t in engine.trades)
    strategies = {}
    for trade in engine.trades:
        result = strategies.setdefault(trade["strategy"], {"closed": 0, "net_pnl": 0})
        result["closed"] += 1
        result["net_pnl"] = round(result["net_pnl"] + trade["net_pnl"], 2)
    return {
        "mode": "HISTORICAL_PAPER_REPLAY", "ticks": count, "start": start, "end": end,
        "closed": closed, "net_pnl": round(equity, 2), "max_closed_equity_drawdown": round(drawdown, 2),
        "win_rate": wins / closed if closed else None,
        "profit_factor": gross_profit / gross_loss if gross_loss else None,
        "strategies": strategies, "policy": asdict(engine.policy),
        "open_or_pending": list(engine.orders.values()), "trades": engine.trades,
        "limitations": [
            "Observed depth is not a guarantee of exchange queue priority or actual fills.",
            "Fees are conservative estimates, not a date-specific statutory tax calculation.",
            "Open positions are not force-filled at the final historical quote.",
            "Rules are fixed before replay; this report is not out-of-sample ML validation.",
            "Only recorded instruments are available; missing option quotes mean WAIT.",
            "CPR requires previous-day OHLC and is not reconstructed from a partial replay.",
        ],
    }


def replay_database(path, date, max_ticks=250_000, policy=None):
    start = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=IST)
    end = start + timedelta(days=1)
    uri = Path(path).resolve().as_uri() + "?mode=ro"
    with closing(sqlite3.connect(uri, uri=True)) as db:
        count = db.execute("SELECT COUNT(*) FROM aqte_ticks WHERE received>=? AND received<?",
                           (start.timestamp(), end.timestamp())).fetchone()[0]
        if count > max_ticks:
            raise ValueError(f"{count} ticks exceeds replay limit {max_ticks}; increase --max-ticks explicitly")
        contracts = [Contract(**json.loads(row[0])) for row in db.execute("SELECT payload FROM aqte_contracts")]
        rows = db.execute("SELECT payload FROM aqte_ticks WHERE received>=? AND received<? ORDER BY received,id",
                          (start.timestamp(), end.timestamp()))
        return replay((Tick(**json.loads(row[0])) for row in rows), contracts, policy)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, help="AQTE SQLite journal path")
    parser.add_argument("--day", required=True, help="IST day, YYYY-MM-DD")
    parser.add_argument("--max-ticks", type=int, default=250_000)
    parser.add_argument("--slippage-ticks", type=int, default=1)
    args = parser.parse_args()
    if args.max_ticks <= 0 or args.slippage_ticks < 0:
        parser.error("max-ticks must be positive and slippage-ticks must be nonnegative")
    print(json.dumps(replay_database(args.db, args.day, args.max_ticks,
                                    Policy(slippage_ticks=args.slippage_ticks)), indent=2))
