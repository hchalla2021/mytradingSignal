# AUTONOMIQ PRO

AUTONOMIQ PRO is an independent index-options analysis and execution module for NIFTY,
BANKNIFTY, and SENSEX. It does not use or control the platform's other trading algorithms.

## Analysis

- The backend scheduler starts analysis at 09:00 IST and runs on five-minute slots
  through 15:20 IST, including the manage-only period after the 14:45 entry cutoff.
  Each slot settles for five seconds; the final 15:20 slot is still eligible after
  15:20:00, but no new analysis slot starts at 15:25.
- A scheduled cycle collects Zerodha market data, computes Python indicators and quant
  signals, then sends one consolidated strategy request to Anthropic when AI is enabled
  and within its configured budget.
- Scheduled cycles use Claude Fable 5 (`claude-fable-5-2`) by default, including regular
  five-minute analysis slots. The configured AI budget and availability checks still
  apply, so the model request may be skipped after a budget cap or AI failure.
- Local and production can both run analysis with their own Zerodha and Anthropic
  credentials. The frontend is not required for the backend scheduler to run.
- No simulated trades are opened. Historical paper-trade storage is legacy and is not
  used by the active scheduler or displayed as live performance.
- Collection uses a separate current clock for each index. Spot freshness is checked
  again after the AI response, option ages advance during analysis, and broker quotes
  and the entry window are checked against the actual submission clock.
- The 15-minute history lookback is 30 calendar days to seed the 60-minute EMA50.
  Only full groups of four 15-minute candles become hourly bars; a previous session's
  short closing bucket is not treated as a full hourly candle.

## Why an enabled system can return WAIT

Live Trading ON is permission, not an instruction to force an entry. The Python quant
score must reach `AUTONOMIQ_PRO_MIN_SIGNAL_SCORE` in the same direction as the AI BUY
(default +60 for CE or -60 for PE). Conflicting indicators, an extended move, missing
or stale data, AI WAIT, exhausted budgets, and contract/risk checks can all prevent entry.
Market movement alone does not establish a qualifying signal, and model quality does
not guarantee profitable or frequent trades.

The Live Trading tab shows the last recorded AI request's actual model, time and status,
the next slot, quant score/threshold, and failed risk checks. AI Engine ACTIVE means the
client is available, not that the last scheduled request succeeded. Manual refresh uses
no AI tokens and replaces the displayed cycle with a quant-only view; check the last
recorded AI request and decision history when diagnosing a manual refresh.

## Live-order boundary

- Live execution is gated by `AUTONOMIQ_PRO_DEPLOYMENT_MODE=production`; the production
  Compose service sets this value. Leave it unset in local/development environments.
- The owner live-trading switch is reset OFF at backend startup; startup also attempts to
  cancel any pending AUTONOMIQ entry orders. Enabling it requires one browser
  confirmation and an authenticated owner control request, plus an active engine,
  configured AI, and successful Zerodha account preflight. Turning it OFF is immediate
  and blocks new entries while owned positions continue to be managed.
- Local/development analysis never submits real orders. The live toggle is unavailable
  there, and paper trading is disabled.
- An entry additionally requires an active entry session, AI/quant BUY agreement, a valid
  one-lot option contract, a fresh two-sided quote, spread/slippage and cash checks, no
  conflicting broker position/order, and the independent risk limits.
- Entries use marketable LIMIT IOC orders. A broker acknowledgement is not a fill; the
  backend reconciles order history and positions before treating an entry as filled.
  Re-observing a completed entry must not reset protection recovery or an exit state.
- AUTONOMIQ tags and manages only its own orders. If broker positions do not match its
  ledger, it stops modifying that contract and raises an alert for reconciliation.
- Switching live entries OFF blocks new submissions and attempts to cancel pending
  AUTONOMIQ entry orders; it continues managing AUTONOMIQ-owned open positions. The kill
  switch blocks entries and requests exits for owned positions.

## Risk and reporting

Defaults are ₹1,000 estimated risk per trade, five filled entries per day, three open
positions globally, and a ₹3,000 daily loss limit. The strategy is capped at one lot per
index and one open position per index. Values are controlled by AUTONOMIQ PRO
configuration in `backend/.env`. When the estimated daily loss reaches the configured
limit, the executor disables new entries and requests exits for its owned positions.
Live entry checks also reserve a fixed ₹1,000 per-index daily loss budget, including
costs and pending risk; increasing the configurable per-trade cap does not raise it.
This is not a guaranteed maximum loss: gaps, stale data, broker outages, and unfilled
exit orders can cause actual losses to exceed the configured threshold.

The executor places a protective stop after an entry fill, reconciles partial fills,
updates trailing protection, and requests exits at targets, on owner/AI exit requests,
or at square-off. Exit orders are limit orders and can remain unfilled; monitor the
Zerodha order book and positions. Dashboard net P&L includes a configured estimated
round-trip cost, not contract-note-confirmed charges.
Trailing profit/loss points and percent show the current stop relative to entry; they
are not realized P&L or a guaranteed fill price. Rejected and unfilled entry records
remain in the trade history but are not displayed as open positions.

The production deployment currently uses one backend worker and a persistent SQLite
ledger. Do not scale AUTONOMIQ PRO to multiple backend replicas without shared
coordination and ledger/lock changes.

## Deployment status

The implementation must still be reviewed and deployed in the production environment
before live use. Tests do not submit broker orders. Keep the owner switch OFF until the
production configuration, Zerodha account, order reconciliation, and operational
monitoring have been independently verified.
