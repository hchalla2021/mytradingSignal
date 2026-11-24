# SMC Apex AI

Independent service and dashboard section for NIFTY, BANKNIFTY and SENSEX.
It is embedded above the existing dashboard and also available alone at
`/smc-apex`, without mounting other strategy sections.
The dashboard follows the supplied neon-green layout, but never copies its
example prices, score, approvals or trade fills. It uses vector icons rather
than the image's decorative bull/brain artwork.

## Isolation and startup

`smcapex` owns its KiteConnect/KiteTicker clients, SQLite candle memory,
configuration, strategy evaluation, Anthropic requests and execution journal.
It does not import or query another algorithm, market-feed service, Redis
signal cache, or trading database. The existing backend provides **only**
authenticated request transport. Shared resources are the Zerodha/Anthropic
credentials and app authentication signing key.

The production Compose stack starts `smcapex-api` independently. Local
`start.ps1` also starts the service. For direct development commands, start
this process separately from the existing backend, from the repository root:

```powershell
.\.venv\Scripts\python.exe -m uvicorn smcapex.main:app --host 127.0.0.1 --port 8014 --workers 1
```

Do not use multiple workers or reload this service with open trades. Its feed
connects on startup even with live entry OFF. Credential changes reconnect
its own feed and disable new entries. No credential values are exposed in
the API, database or AI evidence.

The service reads the shared backend environment file without modifying it:

| Variable | Purpose |
| --- | --- |
| `ZERODHA_API_KEY`, `ZERODHA_ACCESS_TOKEN` | Existing Zerodha credentials |
| `SMCAPEX_ANTHROPIC_API_KEY` | Optional dedicated key; falls back to `AUTONOMIQ_PRO_ANTHROPIC_API_KEY`, then `ANTHROPIC_API_KEY` |
| `SMCAPEX_AI_MODEL` | Required explicit Anthropic model ID; no guessed model |
| `SMCAPEX_LIVE_ENABLED` | Deployment permission; only the exact value `true` enables UI live arming |
| `SMCAPEX_AI_MAX_CALLS_PER_DAY` | Independent attempt cap, default 12, maximum 100 |
| `SMCAPEX_SERVICE_TOKEN` | Optional dedicated signing secret, at least 32 characters; otherwise uses existing `JWT_SECRET` |
| `SMCAPEX_BACKEND_ENV_FILE` | Environment-file location for the independent process |
| `SMCAPEX_DB_PATH` | Independent persistent SQLite path |
| `SMCAPEX_API_URL` | Existing backend's private transport destination; default `http://127.0.0.1:8014` |

If using a dedicated signing secret, configure the same value for the
backend and independent service. Keep port 8014 private. Production exposes
no Apex port publicly and mounts credentials read-only. Ensure storage is
persistent: deleting the journal destroys order-ownership evidence.

## Causal evidence and FVG definition

All candle timestamps normalize to `Asia/Kolkata`. Regular session boundaries
are 09:15-15:30, not midnight or UTC-hour boundaries. For example, 1h candles
start at 09:15, 10:15, etc.; the final session bar is shortened. Nonstandard
special sessions are not supported. Weekends are excluded; holiday trading
cannot qualify without fresh actual exchange ticks.

The service bootstraps 30 calendar days of exchange minute candles and one
year of completed daily candles. It refreshes minute history independently.
Kite REST timezone-less timestamps are interpreted as exchange IST;
KiteTicker's local epoch-converted timestamps are converted from the process
timezone to IST. They must not be normalized by the same naive-time assumption.
Zerodha spot-index packets can carry a zero/1970 timestamp or omit it. These
quotes use actual WebSocket receipt time, identified in the index card's
tooltip and accessible label; converting the zero timestamp can raise `OSError` on Windows.
Receipt freshness is not proof of exchange latency. Entries still require
fresh exchange-timed futures/depth as well as a spot receipt within five
seconds. Receipt-only spot quotes never create live candles: their FVG and
structure evidence comes only from completed exchange historical candles.
Futures never use this receipt-time fallback. Other invalid timestamps are
rejected per tick without aborting the rest of the batch.
Rejected-tick warnings are shown in Execution Status for the selected index and logged, not
misreported as a whole-service failure. They clear only when a valid tick for
that same spot/future stream arrives. Stale quotes remain visibly stale even
if the socket is connected; the service does not invent ticks to keep LIVE.
Real received candles are persisted without synthesizing missing bars.
Live candle construction requires first/last coverage and no tick gap over
10 seconds; rejected live bars must await exchange historical coverage.
Persistent memory retains received candles, not hypothetical candles missed
while offline.
Intraday structural evaluation uses the latest 256 completed bars per frame.
When a live spot quote is unavailable or stale, the index card displays the
most recent stored completed daily close. Its exchange session date and
non-live status are available in the card tooltip and Trade Details.
The displayed change compares that close with the previous completed close;
it is unavailable if no previous close is stored. After 15:31 IST the service
refreshes completed daily history once, including today's bar only if the
exchange actually supplied one. If history is unavailable, the card labels
any retained tick as last received rather than inventing a close. These
display-only values never satisfy live tick, depth or execution checks.

Timeframe roles:

- 1m: first post-confirmation FVG rejection trigger.
- 3m: completed microstructure breakout confirmation.
- 5m: primary displacement, sweep, order block and FVG setup.
- 15m / 30m / 1h: directional alignment using strictly confirmed rising/falling
  swing highs and lows, with two right-side candles before a pivot is known.
- Daily: previous completed trading-day high/low/close, confirmed swings and
  daily FVG context.

Every aggregated candle requires the exact expected sequence of actual
minute bars. Duplicates, missing minutes, cross-session formations and
forming/future candles are rejected.

A qualifying FVG requires three contiguous completed 5m candles:

1. Bullish gap: third low > first high; bearish gap: third high < first low.
2. Middle body >= 1.2 times prior robust median true range, body/range >= 70%.
3. Gap width >= 10% of that prior range.
4. Middle body must cross the first candle's wick boundary; an opening jump
   alone cannot create an accepted displacement.
5. Subsequent far-boundary touches invalidate the gap, including on 1m data.
   Partial mitigation is explicitly distinguished from invalidation.
6. Gap must be from today's session and no more than eight completed 5m
   bars old. Only the first post-confirmation intragap rejection can trigger.

Entry additionally requires a pre-displacement sweep/reclaim of an already
known pool, a displacement close through the opposite internal boundary,
an uninvalidated preceding opposite candle (operational order-block
definition), 3m confirmation, higher-frame swing alignment, and an already
observed/unbroken liquidity target with structural reward/risk >= 2.
FVGs are audited on every intraday frame and Daily. An active opposing
15m/30m/1h/Daily gap covering entry vetoes the setup. Daily formations skip
weekends but reject other missing calendar weekdays conservatively; the
service does not invent holiday candles to complete a gap.

These are explicit **operational definitions**, not proof of institutional
intent. A mathematically valid FVG can still lose; “no false trades” and
“world's best” are not guarantees software or Claude can establish.

## Depth, statistics and AI

Nearest-expiry index futures supply real displayed bid/ask depth. Direction
requires at least 55% displayed bid quantity for CE or at most 45% for PE;
futures and option spread/freshness/liquidity gates must also pass.

Kite does **not** provide aggressor-tagged individual trades, queue identity,
or market-by-order data. Therefore true footprint delta/absorption is
**unavailable**, not fabricated from quotes. Displayed depth can be cancelled
or spoofed and is explicitly labeled a proxy.

Robust range statistics validate displacement. No untrained ML model,
fabricated training accuracy or made-up win probability has order authority.
A trained model would require separately collected data, causal labels,
walk-forward calibration and an explicitly reviewed rollout.

Only qualified market evidence goes to Anthropic, under the owner's stated
permission. It includes recent candles, rule evidence, previous-day levels
and futures depth, not credentials, account identifiers or other sections.
Claude is a veto, never an executor or a source of replacement prices.
Its JSON must have a strict boolean and matching setup ID/direction/contract.
Timeouts, truncation, malformed or contradictory responses block entry.

There is at most one call per FVG/index, at least five minutes between Apex
calls, and an independent daily attempt cap. Attempts are journaled before
the request, so interrupted attempts are not automatically retried. AI
continues qualifying signals while live entry is OFF. The confluence gauge
is the fraction of deterministic checks passed, **not** a success probability.

## UI configuration and execution

The header has one compact, touch-friendly **LIVE TRADE ON/OFF** toggle. Its
highlight is server-confirmed, never optimistic. A lightweight signed
`GET /api/trade-control` status check runs separately from candle/dashboard
snapshots, so market analysis does not block live-state polling.
While the connection is unknown, the toggle displays `...` and clicking it
sends only an OFF request. Connection retries are automatic, without a
separate badge or retry button. Submission errors show the exact
missing prerequisite, and conflicting acknowledgements are not accepted.
The toggle is briefly locked while a control request is being confirmed.

If the toggle remains `...`, ensure the independent process is
running on port 8014 (or its configured private URL). Starting the existing
backend alone does not start this separate service; use `start.ps1`, the
Compose stack, or the independent startup command above. A missing service
cannot be resolved by relabeling the switch as OFF.

OFF does not disconnect market data or stop monitoring existing protective
orders. Zerodha connection interruptions can therefore occur while OFF; they
appear under Execution Status as retrying connection warnings, not as switch
failures. New entries are disabled and stay blocked until each affected
connection operation succeeds. If order monitoring is unavailable, inspect
any open Apex orders in Kite. Unrelated service and protective-order errors
remain visible and are not cleared by a connection recovery.

Click **Risk settings** beside the live toggle, then choose NIFTY, BANKNIFTY
or SENSEX in the panel. Each index displays its saved status; select and save
each separately. Unsaved entries remain in the panel when switching indices,
but closing it discards them. Enter/save free-text lots, per-trade
maximum exposure, index daily loss cap, initial premium stop %, maximum
option spread, entry hours and combined Apex daily loss cap. Inputs are
validated server-side. Each index needs its own saved settings plus the
combined cap before that index can execute orders. Configuration can be saved while ON if no Apex
order/position is open; the worker rereads the latest caps and spread limit
under its submission lock immediately before buying. Configuration locks
while an owned order/position is active. Configure each index deliberately; no risk defaults are silently
used for orders.

Every service restart starts live entry **OFF**. Deployment permission alone
does not arm it. ON immediately records standing entry intent without waiting
for broker profile requests, candle analysis or a setup. It is not immediate
unconditional buying. Missing deployment/AI/risk/feed prerequisites remain
visible below the header and block orders in the worker. Unresolved owned-order
halts still prevent ON. A setup must satisfy rules, fresh depth/options, Claude, revalidated
structure, approval expiry, spot-drift limits and saved risk gates.
Only option buying (CE/PE), MIS, and one total active Apex position are
supported. Contracts and lot/tick sizes come from the actual instrument
catalog. Expired/occupied contracts are not traded.

Per-trade and daily caps are independent maximums, so a smaller daily cap
does not prevent saving a larger per-trade cap. Both still apply to every
entry, and a small daily cap may mean no one-lot setup can execute.
Validation errors appear directly in the settings form, beside Save.
Saving settings does not require a fresh market snapshot; API failures still
surface explicitly in the form.

Risk reserves **full premium debit + 1% + Rs 100 charge allowance**, not
merely a planned stop distance. This intentionally limits exposure even if
a stop fails to fill. Closed losses (after charge reserve) plus open reserved
exposure consume index/global daily budgets. Profits do not replenish them.
Displayed gross P&L comes only from journaled entry/exit fills; the
charge-reserved figure is not an exact broker tax/fee statement.

Entries are IOC limit orders. Partial final fills get protection only for the
actual owned quantity. Every intent is committed before broker submission.
Timeouts/uncertain submissions are never blindly retried. Ownership requires
the exact journaled tag, order ID, instrument, side, product and quantity.
Manual trades and other algorithms do not enter Apex P&L.
Completed foreign fills after entry also trigger mixed-ownership protection,
even if a manual round trip leaves the net contract quantity unchanged.

OFF blocks new buys and waits for an already-started submission before
acknowledging. It does not cancel broker protective stops or disable exit
monitoring. A buy already sent to the exchange cannot be undone by OFF.
Filled positions receive SL-limit protection. After +1R, the stop monotonically
locks breakeven and then half the additional rise beyond 1R. Structural
invalidation, 15:15 session cutoff or +3R converts the **existing** exit order
to a marketable limit; no competing second sell is created. Trailing uses at
most 18 modifications, reserving the remainder of a 24-attempt budget for
exits; uncertain attempts also consume this persisted budget. +1R/+2R are
milestones, not partial exits; displayed targets are risk multiples, not
premium forecasts.

### Operational limitations — read before live use

- Broker entry and stop placement are not atomic. There is an unprotected
  interval between a fill and accepted stop. SL-limit exits can remain
  unfilled in gaps, circuits or thin books. Price, fee and fill guarantees
  are not possible.
- Keep manual/other-strategy activity on **different contracts**. Detected
  mixed ownership, quantity mismatches, cancelled/rejected stops, duplicate
  tags or unresolved submissions disable new entries and require operator
  reconciliation in Kite. Existing protective broker orders are not blindly
  cancelled. Concurrent manual activity between broker snapshots cannot be
  perfectly identified by any client.
- Partial exits remain broker-managed; new entries are halted and no
  duplicate sell is permitted.
- If feed/API/process connectivity fails, existing broker stops remain, but
  dynamic trailing/session management requires a running service and fresh
  quotes. Check Kite directly on warnings.
- After restart, unresolved historical intents fail closed if absent from
  today's order book. Do not erase the journal or force ON to bypass this.
  Broker-side reconciliation by the operator is required.
- Backtesting, walk-forward validation, replay/soak testing and exchange-side
  acceptance have not been established by mocked unit tests. Do not treat
  this implementation as production-certified or guaranteed profitable.

## Validation

From the repository root:

```powershell
.\.venv\Scripts\python.exe -X utf8 -m unittest smcapex.test_apex
Push-Location backend
..\.venv\Scripts\python.exe -X utf8 -m unittest test_smc_apex_gateway
Pop-Location
Set-Location frontend
npx.cmd --no-install tsc --noEmit --incremental false
npm.cmd run lint
```

Unit tests use only synthetic fixtures, an in-memory database, mocked broker
orders and `httpx.MockTransport`. They place no real trades and make no paid
AI requests.
