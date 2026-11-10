# 6 Algo Desk

The 6 Algo Desk is its own dashboard section, rendered directly below **ExpiryEdge AI Algo**.
ExpiryEdge AI Algo is unchanged and separate: it remains the expiry-weekday and contract-readiness
module described in [EXPIRYEDGE.md](./EXPIRYEDGE.md) and places no orders.

Frontend: `frontend/components/AlgoDeskSection.tsx` (mounted by `AQTESection.tsx`).
Backend: `backend/routers/algo_desk.py` and `backend/services/expiryedge_algos.py`, executed by the
shared AQTE live lane in `backend/services/aqte_live.py`.

## Algorithms

| # | Algo | Idea |
|---|------|------|
| 01 | Adaptive VWAP Pro | Trend pullback to session VWAP |
| 02 | Order Flow Momentum | Depth imbalance with candle-volume pressure |
| 03 | Liquidity Sweep + BOS | Stop run, then break of structure |
| 04 | ORB Retest Pro | Opening-range breakout and retest (entries until 12:30 IST) |
| 05 | Failed Breakout Reversal | Trap reversal after a false break |
| 06 | Volatility Expansion Pro | Bollinger squeeze release |

Every rule reads live Kite-fed AQTE state only: completed one-minute futures candles from the shared,
history-seeded candle book and the latest futures tick (depth, best bid/ask quantity, OI). A live
candidate additionally requires a fresh, liquid option quote. Order Flow Momentum's candle-volume
pressure is a candle-direction-weighted volume proxy, not exchange-reported aggressor-side delta. A
stale spot/futures tick or unresolved futures-history gap blocks every signal until the feed recovers.
A rule whose evidence is missing or stale is shown as waiting and can never trade. Each of the six
strategy sections has independent NIFTY, BANK NIFTY and SENSEX tabs for its signal, rules, live price
and symbol-specific position history. Selecting a tab in one strategy does not change the other
strategy sections. Trade approval remains per strategy across all three indices, and the shared live
lane still permits only one pending/open automated trade at a time.

Each algo has its own setup and entry rules (5-7 each), listed with their requirement text in
`RULEBOOK` in `expiryedge_algos.py`. Before the open, during warm-up, or when the feed is stale, each
strategy section still shows its own setup and rules, all waiting (`0 / N`), with the data reason
underneath. Pass/fail values fill in from completed Kite futures candles while the market is live.
`test_rulebook_matches_each_live_evaluator` keeps `RULEBOOK` identical to the live evaluators.

## Modes

- **Live (Auto)** (`TRADE ON`): the algo places real Zerodha orders when every rule passes.
- **Manual** (`TRADE OFF`): live signals and rules only; no orders.
- There is no paper-trade mode. Every algo defaults to Manual. TRADE ON asks for a browser confirmation;
  switching to Manual never does. A standing ON choice is journaled and re-arms on the next session.

## Execution and risk

- Orders go through the shared AQTE live lane: same Kite connection, broker preflight, session arm,
  risk limits and protective-stop monitor. Orders are tagged `XEA<13 hex>E` / `XEA<13 hex>S`.
- AQTE Auto Trade, QuantEdge Pro and each Desk algo have independent approvals; enabling one does not
  switch another off. All entry scans use the same serialized order manager, which allows only one
  pending/open automated trade across all owners. While that slot is occupied, other enabled scans
  wait and reevaluate fresh signals after it clears; stale candidates are not queued.
- Each monitor pass scans QuantEdge Pro, then the 6 Algo Desk, then AQTE. If an earlier scan submits
  an order, later scans in that pass wait for the shared slot.
- Entries 09:15–15:15 IST on trading days. A trigger candle is acted on only within 90 s of closing.
- 1 lot; risk per trade, daily loss, max trades and max losses are the account-wide AQTE live limits;
  at most 2 entries per algo per day.
- Option stop 8–35% of premium, target 2R, trailing stop from 1R, net reward/risk at least 1.5.
- Live trading still requires `AQTE_LIVE_ENABLED`, a healthy live journal and no latched emergency stop.
  Three consecutive unexpected scan errors switch every algo to Manual.
- Manual Kite trades are never closed, cancelled or modified; their contracts are treated as busy.
- **Exit trade** closes only the selected `XEA` trade and switches that algo to Manual. The shared
  emergency stop (`POST /api/aqte/live/stop`) also covers `XEA` orders.

## API

Owner-only, like the AQTE live controls: `app_access_token` cookie plus headers `X-Device-Id` and
`X-AQTE-Intent: manual-live-control`. Responses are `Cache-Control: no-store`.

| Method | Path | Body |
|--------|------|------|
| GET | `/api/algo-desk/status?symbol=NIFTY` | `signals` for the requested symbol and `signals_by_symbol` for all three indices; `symbol`: `NIFTY`, `BANKNIFTY` or `SENSEX` |
| POST | `/api/algo-desk/approval` | `{"algo", "enabled", "confirmation", "symbol"?}`; confirmation `ENABLE ALGO DESK LIVE TRADING` (ON) or `STOP ALGO DESK ENTRIES` (OFF) |
| POST | `/api/algo-desk/exit` | `{"trade_id": "XEA…", "confirmation": "CLOSE ALGO DESK TRADE", "symbol"?}` |

## Internal identifiers

For journal and order-tag compatibility the lane owner stays `EXPIRYEDGE`, the journal key stays
`expiryedge` and the tag prefix stays `XEA`. Startup discards approvals for the six retired strategies
while retaining historical trades. Only the user-facing name is "6 Algo Desk".

## Tests

```powershell
cd backend
..\.venv\Scripts\python.exe -X utf8 -m unittest test_expiryedge test_expiryedge_algos
cd ..\frontend
node --test --test-name-pattern="6 Algo Desk" tests\aqte.test.cjs
```

No profitability claim is made. These strategies are not validated; run an algo in Manual first and
verify its signals before turning TRADE ON.
