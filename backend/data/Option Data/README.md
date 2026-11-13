# Historical option data

The CSV files in this directory are imported offline with:

```powershell
cd backend
..\.venv\Scripts\python.exe -m services.historical_option_data
```

The command validates each source and creates `options_history.sqlite3` beside
the CSVs. Imports are streamed and each symbol import is transactional.
Malformed/duplicate records are quarantined with line numbers and raw values.
Rows with inconsistent OHLC are retained for non-price fields but marked
`ohlc_valid = 0`; they must not be used as price bars. The command reports
indexed, rejected, and OHLC-invalid counts. The database is a derived local
index; the CSV source files remain unchanged.

This catalog contains daily option bhavcopy OHLC, volume, and open interest.
It is **not** intraday quote, underlying-index candle, order-book, or fill data.
It cannot establish realistic intraday VWAP/order-flow/ORB/BOS signals or
execution results. The importer is not connected to market startup, strategy
signals, approvals, or order placement. Existing live algos remain untouched.

## Daily option momentum proxy (research only)

Run the daily-bar benchmark and export its trade log and summary as CSV, JSON,
and Excel:

```powershell
cd backend
..\.venv\Scripts\python.exe -m services.daily_option_proxy_backtest
```

By default, reports are written under
`backend/data/Option Data/daily_option_proxy_report/`. The proxy signals when a
contract's prior valid daily bar closed above its open, selects at most one
contract per index/day by prior-day volume and open interest, buys at the next
available valid daily bar's open, and exits at that bar's close. Costs, slippage,
lot sizing, and executable-fill constraints are excluded.

These reports are **not a backtest of AQTE, MorningEdge, QuantEdge Pro,
ExpiryEdge, or the Algo Desk**, and must not be used to enable live order
execution.
