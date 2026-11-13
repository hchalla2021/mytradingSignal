"""Generate a transparent daily-bar option momentum proxy report.

This is a research benchmark over daily option bhavcopy rows, not a replay of
the app's intraday algorithms or a representation of executable live fills.
"""

import argparse
import csv
import json
import math
import sqlite3
import statistics
from datetime import datetime, timezone
from pathlib import Path

from openpyxl import Workbook

from services.historical_option_data import DATA_DIR, DEFAULT_DB


DEFAULT_OUTPUT_DIR = DATA_DIR / "daily_option_proxy_report"
METHOD = (
    "For each symbol and trade date, find contracts whose previous valid daily "
    "option bar closed above its open. Select at most one contract per symbol/day "
    "by highest previous-day volume, then highest previous-day open interest. "
    "Enter at the selected contract's current-day open and exit at its close. "
    "No commissions, taxes, slippage, bid/ask spread, lot sizing, or fill "
    "constraints are modeled. This is a daily option-price momentum proxy, not "
    "a test of AQTE, MorningEdge, QuantEdge Pro, ExpiryEdge, or Algo Desk rules."
)

TRADE_COLUMNS = [
    "symbol", "entry_date", "expiry_date", "strike", "option_type",
    "signal_date", "signal_open", "signal_close", "signal_volume",
    "signal_open_interest", "entry_open", "exit_close", "premium_points",
    "gross_return_pct",
]


def _readonly_connection(db_path):
    uri = Path(db_path).resolve().as_uri() + "?mode=ro"
    connection = sqlite3.connect(uri, uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def _quality_report(connection):
    rows = connection.execute(
        """
        SELECT symbol, COUNT(*) AS indexed_rows,
               SUM(CASE WHEN ohlc_valid=1 AND open>0 AND close>0
                        THEN 1 ELSE 0 END) AS usable_price_rows,
               SUM(CASE WHEN ohlc_valid=0 THEN 1 ELSE 0 END) AS invalid_ohlc_rows,
               SUM(CASE WHEN underlying_price IS NOT NULL AND underlying_price>0
                        THEN 1 ELSE 0 END) AS rows_with_underlying,
               MIN(trade_date) AS first_trade_date,
               MAX(trade_date) AS last_trade_date
        FROM option_daily
        GROUP BY symbol
        ORDER BY symbol
        """
    ).fetchall()
    return [dict(row) for row in rows]


def _trade_rows(connection):
    query = """
        WITH usable AS (
            SELECT trade_date, symbol, expiry_date, strike, option_type,
                   open, close, volume_contracts, open_interest
            FROM option_daily
            WHERE ohlc_valid=1 AND open>0 AND close>0
              AND volume_contracts>0
        ),
        with_previous AS (
            SELECT *,
                   LAG(trade_date) OVER contract_order AS signal_date,
                   LAG(open) OVER contract_order AS signal_open,
                   LAG(close) OVER contract_order AS signal_close,
                   LAG(volume_contracts) OVER contract_order AS signal_volume,
                   LAG(open_interest) OVER contract_order AS signal_open_interest
            FROM usable
            WINDOW contract_order AS (
                PARTITION BY symbol, expiry_date, strike, option_type
                ORDER BY trade_date
            )
        ),
        candidates AS (
            SELECT *,
                   ROW_NUMBER() OVER (
                       PARTITION BY symbol, trade_date
                       ORDER BY signal_volume DESC, signal_open_interest DESC,
                                expiry_date, strike, option_type
                   ) AS daily_pick
            FROM with_previous
            WHERE signal_date IS NOT NULL
              AND signal_open>0
              AND signal_close>signal_open
              AND signal_volume>0
        )
        SELECT symbol, trade_date AS entry_date, expiry_date, strike, option_type,
               signal_date, signal_open, signal_close, signal_volume,
               signal_open_interest, open AS entry_open, close AS exit_close
        FROM candidates
        WHERE daily_pick=1
        ORDER BY symbol, entry_date
    """
    for row in connection.execute(query):
        trade = dict(row)
        trade["premium_points"] = trade["exit_close"] - trade["entry_open"]
        trade["gross_return_pct"] = (
            trade["premium_points"] / trade["entry_open"] * 100.0
        )
        yield trade


def _max_drawdown(returns):
    log_equity = log_peak = 0.0
    drawdown = 0.0
    for value in returns:
        log_equity += math.log1p(value)
        log_peak = max(log_peak, log_equity)
        drawdown = min(drawdown, math.expm1(log_equity - log_peak))
    return drawdown * 100.0


def summarize(trades):
    summaries = []
    for symbol in ("NIFTY", "BANKNIFTY", "SENSEX"):
        selected = [trade for trade in trades if trade["symbol"] == symbol]
        returns = [trade["gross_return_pct"] / 100.0 for trade in selected]
        winners = [value for value in returns if value > 0]
        losers = [value for value in returns if value < 0]
        gross_profit = sum(winners)
        gross_loss = abs(sum(losers))
        log_compounded = sum(math.log1p(value) for value in returns)
        compounded_return = (
            math.expm1(log_compounded) * 100.0
            if log_compounded < math.log(float.fromhex("0x1.fffffffffffffp+1023"))
            else None
        )
        summaries.append({
            "symbol": symbol,
            "trade_count": len(selected),
            "first_entry_date": selected[0]["entry_date"] if selected else None,
            "last_entry_date": selected[-1]["entry_date"] if selected else None,
            "win_rate_pct": len(winners) / len(returns) * 100.0 if returns else 0.0,
            "average_trade_return_pct": statistics.mean(
                trade["gross_return_pct"] for trade in selected
            ) if selected else 0.0,
            "median_trade_return_pct": statistics.median(
                trade["gross_return_pct"] for trade in selected
            ) if selected else 0.0,
            "profit_factor": gross_profit / gross_loss if gross_loss else None,
            "compounded_return_pct": compounded_return,
            "max_drawdown_pct": _max_drawdown(returns),
            "sum_premium_points": sum(
                trade["premium_points"] for trade in selected
            ),
            "costs_included": False,
        })
    return summaries


def _write_csv(path, rows, columns):
    with path.open("w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.DictWriter(stream, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def _write_workbook(path, report):
    workbook = Workbook(write_only=True)
    method_sheet = workbook.create_sheet("Method")
    method_sheet.append(["Daily option momentum proxy"])
    method_sheet.append([METHOD])
    method_sheet.append(["Warning", report["warning"]])
    method_sheet.append(["Generated at (UTC)", report["generated_at_utc"]])
    method_sheet.append(["Input database", report["input_database"]])

    for sheet_name, rows in (
        ("Summary", report["summary"]),
        ("Data quality", report["data_quality"]),
    ):
        sheet = workbook.create_sheet(sheet_name)
        if rows:
            headers = list(rows[0])
            sheet.append(headers)
            for row in rows:
                sheet.append([row.get(header) for header in headers])

    trade_sheet = workbook.create_sheet("Trades")
    trade_sheet.append(TRADE_COLUMNS)
    for trade in report["trades"]:
        trade_sheet.append([trade.get(column) for column in TRADE_COLUMNS])
    workbook.save(path)


def generate_report(db_path=DEFAULT_DB, output_dir=DEFAULT_OUTPUT_DIR):
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    connection = _readonly_connection(db_path)
    try:
        quality = _quality_report(connection)
        trades = list(_trade_rows(connection))
    finally:
        connection.close()

    report = {
        "report_type": "DAILY_OPTION_MOMENTUM_PROXY_NOT_LIVE_ALGO_BACKTEST",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "input_database": str(Path(db_path).resolve()),
        "method": METHOD,
        "warning": (
            "Gross daily-bar proxy only. Results are not evidence of live "
            "profitability and do not test the app's intraday strategy rules. "
            "Daily OHLC cannot determine intraday signal order or actual fills."
        ),
        "assumptions": {
            "maximum_positions_per_symbol_per_day": 1,
            "selection": "highest previous-day option volume, then open interest",
            "entry": "selected option daily open",
            "exit": "same option daily close",
            "costs_and_slippage": "excluded",
            "capital_model": (
                "compounded return assumes full account allocation on each "
                "successive trade; illustrative and not a sizing recommendation"
            ),
            "missing_or_invalid_prices": "excluded",
            "underlying_signal": "not used",
            "expiry_roll": "not modeled; contracts are grouped by expiry and strike",
        },
        "data_quality": quality,
        "summary": summarize(trades),
        "trade_count": len(trades),
        "trades": trades,
    }

    _write_csv(output_dir / "daily_option_proxy_trades.csv", trades, TRADE_COLUMNS)
    _write_csv(
        output_dir / "daily_option_proxy_summary.csv",
        report["summary"],
        list(report["summary"][0]),
    )
    (output_dir / "daily_option_proxy.json").write_text(
        json.dumps(report, indent=2, allow_nan=False),
        encoding="utf-8",
    )
    _write_workbook(output_dir / "daily_option_proxy.xlsx", report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    args = parser.parse_args()
    try:
        report = generate_report(args.db, args.output_dir)
    except (OSError, sqlite3.Error, ValueError) as error:
        parser.exit(1, f"Daily option proxy backtest failed: {error}\n")
    print(json.dumps({
        "mode": report["report_type"],
        "trade_count": report["trade_count"],
        "summary": report["summary"],
        "output_dir": str(args.output_dir.resolve()),
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
