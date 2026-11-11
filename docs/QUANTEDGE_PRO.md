# QuantEdge Pro

QuantEdge Pro is an independent, long-only options strategy. It evaluates completed one-minute futures candles from the shared market feed; it does not consume AQTE signals, AQTE engine votes, or dashboard state.

## Entry rules

The current explainable rule set requires all of the following on the same completed candle:

- Close beyond the prior 20-candle Bollinger band (2 standard deviations).
- Directional candle with body at least 65% of its range and close in the top/bottom 20%.
- Candle range at least 1.2 times ATR(14).
- Volume at least 1.5 times the preceding 20-candle average.
- RSI(14) confirmation above 55 for CE or below 45 for PE; RSI alone never creates a signal.

Candidates use fresh shared option quotes, available ask depth for the configured quantity, a maximum 3% spread, and busy-contract exclusion. The option premium stop is 20% below the proposed limit; the target is twice that risk distance. Estimated risk including configured cost estimates must remain at or below INR 500 per trade, with net reward/risk of at least 1.5.

## Live controls and risk

- Live approval is OFF by default and is reset OFF when the backend restarts; refreshing the dashboard page does not reset a manually enabled approval.
- Configure 1–5 lots. The owner can set the strategy approval ON or OFF at any time. ON is a standing approval: outside the weekday 09:15–15:15 IST entry window, no broker preflight or orders run. Before an eligible signal can reach the broker, QuantEdge Pro performs preflight and session arming; failed checks leave orders blocked and expose the reason. Backend restart resets approval to OFF.
- Daily limits are five entries and INR 1,500 realized/open loss. Existing account-wide limits, static-IP checks, market-session gates, broker quote checks, margin checks, and reconciliation remain in force.
- AQTE, QuantEdge Pro, and 12 Algo Desk entry approvals are independent. They share one serialized execution manager, which allows only one pending/open automated trade at a time; other enabled scans wait and then evaluate fresh signals. The monitor scans QuantEdge Pro, 12 Algo Desk, then AQTE.
- Signal/status polling uses the in-memory market feed. QuantEdge Pro reads the broker order/position book only after a fully qualified candidate needs execution, then rechecks it before submission; WAIT scans do not poll the broker account.
- All owners reuse the existing Kite integration; QuantEdge Pro does not open a second broker connection.
- QuantEdge Pro orders use a `QEP`-prefixed tag. The shared manager may manage only tagged algorithm quantities. Untagged manual Kite orders/positions are excluded from ownership and mark their contract busy; QEP does not cancel, modify, or exit them. The shared emergency stop can cancel or close recognized AQTE- and QEP-owned positions/orders, but never manual or other-app trades.
- Disabling new entries does not remove existing stop protection. A QuantEdge Pro manual exit endpoint verifies the active trade is QEP-owned before requesting an exit.

No profitability or latency claim is made. The strategy is not a validated or calibrated probability model; verify broker fills and risk independently.
