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
- If an index has no tick when collection starts but receives a fresh tick before the
  consolidated AI request, its previously skipped option chain is fetched once and
  quant metrics are recalculated. Candle/futures history is not fetched again.
  Recovery failures remain explicit data errors and cannot authorize an entry.
- Restarts do not replay a five-minute slot whose AI request was already claimed.
  The scheduler advances to the next slot, preserving the completed scheduled decision
  instead of overwriting it with `SKIPPED_SLOT_ALREADY_ANALYZED` quant-only output.
  Owner approval still resets OFF; an earlier BUY is never replayed as a new order.
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

A BUY in decision history is a strategy candidate, not proof of an order or fill.
Its execution status and reason are shown alongside it. Risk-blocked candidates
display WAIT on the live card, and alerts distinguish BLOCKED, ENTRY PENDING and
uncertain broker outcomes instead of reporting every BUY candidate as success.

The Live Trading tab shows the last recorded AI request's actual model, time and status,
the next slot, quant score/threshold, and failed risk checks. AI Engine ACTIVE means the
client is available, not that the last scheduled request succeeded. Manual refresh uses
no AI tokens and replaces the displayed cycle with a quant-only view; check the last
recorded AI request and decision history when diagnosing a manual refresh.

The AI Analysis badge and the warning above the live cards report the latest cycle's
actual AI outcome, separately from client readiness. Neutral quant-only decisions also
include the missing AI confirmation reason. A zero score does not mean missing data:
opposing positive and negative factors can cancel; inspect View Details and data errors.
The Analysis tab labels each index's last computation time and the next scheduled cycle.
Both the live cards and Analysis tab separately display Quant, AI, Risk and Broker gates.
A passing quant direction is not an approved trade: when quant qualifies for BUY,
manual quant-only refreshes show `WAIT · AWAITING AI`. Risk is `NOT EVALUATED` until a plan is built, and broker submission
remains `NOT REQUESTED` until the entry gates permit it. Quant direction and AI action
are recorded by the backend; the frontend does not infer approval from a green score.
Manual refresh also retains today's last scheduled result with its timestamp, reason and
execution outcome. This is historical context only, never reused as AI approval for new
quotes or displayed as an active plan. Previous-day scheduled results are not carried forward.
Its rule weights are constants, while rule states, VWAP, depth and OI measurements refresh
with five-minute analysis cycles, even when AI spending is blocked. Live spot ticks update
separately; polling the dashboard every second does not recompute the rules or call AI.

`AUTONOMIQ_PRO_DAILY_BUDGET_USD` and `AUTONOMIQ_PRO_MONTHLY_BUDGET_USD` cap AI spending,
not broker trading risk. The next request must fit an estimated input-plus-output
reservation. `DAILY_BUDGET_INSUFFICIENT` / `MONTHLY_BUDGET_INSUFFICIENT` mean the balance
cannot cover that request even if recorded spend is still below the cap; `*_EXHAUSTED`
means recorded spend has reached the cap. No budget is automatically increased.

`OUTPUT_TOKEN_LIMIT` means Anthropic stopped at `AUTONOMIQ_PRO_MAX_OUTPUT_TOKENS`.
The charged usage is recorded, the response is rejected, and there is no immediate
paid retry. The strategy prompt requests short text for all three indices to reduce
truncation, but a successful complete response is still required. Raising a budget or
token limit increases potential API spending and is an explicit operator decision.

## Live option prices and trailing

- New live entries use the `HYBRID_V1` risk model. The existing scheduled AI request
  receives completed-candle OHLC, confirmed swings, previous-day levels and ATR for
  breakout/pullback assessment. AI still supplies direction only: Python sets prices,
  applies risk/cash/session gates, and never accepts model-generated price levels.
  No additional AI request is made for stops, trailing, polling or each position.
- Entry remains an IOC limit at a freshly verified ask. Tick rounding cannot raise
  the limit beyond the approved slippage cap. An IOC can partially fill or not fill;
  no algorithm can guarantee the best price or prevent every loss.
- Hybrid initial stops use the widest required distance from recent option lows,
  confirmed option swing support, measured 14-bar option ATR, and delta-translated
  underlying candle/swing invalidation. The buffer includes volatility and spread.
  CE uses underlying support; PE uses underlying resistance. A stop that exceeds
  configured loss budgets is rejected, never tightened artificially to make it fit.
- Targets include estimated costs and exit slippage: T1 is a net 1R milestone and
  T2 is at least net 2R (or the configured higher minimum). Nearby confirmed option
  resistance and directional underlying swings/previous-day levels can veto entry
  when there is insufficient projected room. Delta translation is an approximation,
  not a promised future option price. Targets are recalculated from confirmed fills
  without widening the structural stop. T1 tightens protection; T2 requests an exit,
  not a guaranteed fill or an additional partial-profit order.
- New-position trailing activates at cost-inclusive +1R and uses the highest observed
  bid, measured option ATR and completed-candle support. It never loosens a stop.
  Execution candle history is cached per instrument/completed five-minute boundary;
  forming, stale or invalid history cannot drive entries or new trailing levels.
  Missing trailing history retains existing protection; stop breaches, T2 and requested
  exits are still handled. Existing positions retain their prior trailing model.
- Live index cards use muted charcoal surfaces, soft borders and prominent tabular
  prices. Closed-trade summaries are omitted from live cards; recorded orders
  remain available in the Trades tab. This is presentation only: entry gates,
  quote freshness, fill-based values, trailing rules and operator controls are unchanged.
- Decorative neon glows and pulsing feed dots are disabled. Gain, loss and warning
  states retain distinct, desaturated colors; live polling and freshness checks are unchanged.
- Trade prices and live/trailing P&L appear before the entry-check explanations.
  Larger tabular values and cyan entry, red stop, amber trailing and green target
  accents emphasize the monitoring area. Broker-state and stale-quote warnings remain
  beside these values; unavailable prices are never filled with illustrative numbers.
- The header, navigation, system-status tiles and spot-price cards share that theme.
  Tabs and market-alert text wrap on smaller screens instead of requiring sideways
  scrolling. Live-order permissions, warning colors, refresh behavior, prices and
  sparkline data remain unchanged; this area stays expanded.
- AI Market Analysis and Live Alerts share the same presentation. Summaries, metric
  values and history messages wrap to fit their panel instead of requiring sideways
  scrolling. Phone layouts stack panels and place each full message beneath its time,
  index and action. The existing five-record preview and independent View Details
  expansion remain unchanged.
- The analysis overview and AI metric tiles are collapsed by default behind a native
  keyboard-accessible disclosure. Recent decisions and alerts remain visible. Side-by-side
  panels share header, history-row and footer tracks, including wrapped messages and
  expanded lists; stacked layouts do not reserve an empty overview area for alerts.
- Filled positions use fresh full-depth option ticks from the existing Kite connection.
  Their contracts remain subscribed while owned, even when ATM strikes rotate.
  Quote marks and highest observed bids are sampled every second independently of AI.
  Snapshots also read the latest cached option bid without a broker REST request.
- The UI polls once per second with no overlapping requests, aborts timed-out requests,
  and displays the actual option bid and its age. Gross P&L uses the actual average fill
  and remaining filled quantity; estimated net P&L also includes realized partial exits
  and configured costs. Live-position quotes expire after five seconds, or sooner if
  the configured quote-age limit is stricter, matching the executor. Stale quotes hide
  live valuations, including the gross summary; fixed fill and stop prices stay visible.
- Account/order/position reconciliation and stop management remain on a five-second
  cadence, not one broker REST/modification request per tick. Unavailable streamed quotes
  fall back to REST during management; there is no synthetic price interpolation.
- Terminal AUTONOMIQ order events from the existing Kite connection request earlier
  reconciliation, throttled to at most one pass per second. Events never directly
  declare fills, place orders, request AI or enable trading; account/order/position
  verification remains authoritative. Manual order events do not accelerate this loop.
- Position state is read again for each index after the AI reply. A position closed
  while AI was running cannot produce a current HOLD/EXIT using the old input holdings.
  Unreconciled positions do not claim that protection has been confirmed.
- Entry premium is the fixed broker fill, not a moving quote. The initial stop and targets
  are not supposed to follow every tick. Trailing still activates at cost-inclusive +1R,
  retains the T1 profit floor and never loosens. Legacy positions use their original
  stop-distance proxy; `HYBRID_V1` positions use measured option-candle ATR.
  Displayed trailing protection advances only after broker acknowledgement.
- Open-position broker state and its last reconciliation time are shown separately from
  new-entry gates. A new-entry `NOT REQUESTED` or `BLOCKED` is not the state of an already
  filled/protected position; the exact candidate blocker remains visible.
- Orders and positions are separate broker snapshots. A transient mismatch blocks all
  order changes, but later verified fills of the exact owned exit/stop order can still
  close the ledger. Matching account, order ID, tag, contract, SELL side and bounded fill
  quantities are required. Partial fills retain the reconciliation block; manual orders
  never resolve it. Disputed positions do not show live valuations.
  A triggered SL may be reported by Zerodha as a filled LIMIT; its owned protective ID
  still identifies it as a stop exit. Closed history displays the actual exit fill.
- Live index cards omit closed-trade history and do not keep marking closed trades
  with subsequent option ticks. Closed order records remain in Trades. Analysis and decision
  history remain explicitly recorded snapshots, not current broker positions.
- Up to the configured three simultaneous positions are allowed, one per distinct
  index. A BANKNIFTY position alone does not block a qualifying NIFTY or SENSEX entry.
  Broker submissions and shared-budget reservations stay serialized to prevent races;
  cash, combined risk, uncertain executions, entry windows and daily limits still apply.

## Live-order boundary

- Production live execution uses `AUTONOMIQ_PRO_DEPLOYMENT_MODE=production`; the production
  Compose service sets this value. Local execution is disabled by default and requires
  both `AUTONOMIQ_PRO_DEPLOYMENT_MODE=local` and `AUTONOMIQ_PRO_ALLOW_LOCAL_LIVE=true`.
  The backend configuration, not the browser hostname, determines order eligibility.
  The same live-order lifecycle and safety checks apply in both environments.
- The owner live-trading switch is reset OFF at backend startup; startup also attempts to
  cancel any pending AUTONOMIQ entry orders. Enabling it requires one browser
  confirmation and an authenticated owner control request, plus an active engine,
  configured AI, and successful Zerodha account preflight. Turning it OFF is immediate
  and blocks new entries while owned positions continue to be managed.
- An expired or invalid Zerodha session blocks ON and returns an explicit reconnect
  error. Use the dashboard LOGIN to authorize Zerodha again, then retry the switch.
  A connected market feed alone does not confirm that broker account/order access
  is valid; failed preflight never enables live entries.
- An opted-in local deployment exposes the same owner live toggle as production.
  Configuring local-live eligibility does not authorize entries: the switch remains OFF
  until the owner confirms and AI/broker preflight succeeds. Paper trading stays disabled.
  Without the opt-in the local switch remains disabled and reports the required setting.
- An entry additionally requires an active entry session, AI/quant BUY agreement, a valid
  one-lot option contract, a fresh two-sided quote, spread/slippage and cash checks, no
  conflicting broker position/order, and the independent risk limits.
- Entries use marketable LIMIT IOC orders. A broker acknowledgement is not a fill; the
  backend reconciles order history and positions before treating an entry as filled.
  Re-observing a completed entry must not reset protection recovery or an exit state.
- A rejected or cancelled zero-fill IOC entry is reconciled to REJECTED or UNFILLED,
  releases its pending-position reservation, and is not automatically resubmitted.
  Broker rejection reasons appear in alerts and the Trades tab. Broker precheck errors
  are recorded per index without discarding the other indices' decisions; uncertain
  submission results remain ENTRY_UNKNOWN and block retries pending reconciliation.
- AUTONOMIQ tags and manages only its own orders. If broker positions do not match its
  ledger, it stops modifying that contract and raises an alert for reconciliation.
- Switching live entries OFF blocks new submissions and attempts to cancel pending
  AUTONOMIQ entry orders; it continues managing AUTONOMIQ-owned open positions. The kill
  switch blocks entries and requests exits for owned positions.

### Zerodha IP and trigger-price troubleshooting

Both AQTE and AUTONOMIQ PRO call KiteConnect `place_order` for BUY LIMIT IOC entries
and submit a SELL SL order with `trigger_price` after an entry fill. AUTONOMIQ does
not place a pending stop-entry BUY order: its trigger price is the protective stop.
An IOC entry can be cancelled unfilled if its limit cannot execute.

`AQTE_LIVE_STATIC_IP` belongs to AQTE's outbound-IP preflight; AUTONOMIQ does not
read it. Writing an IP in an environment file does not configure network egress or
register that IP with Zerodha. The executing computer/server's actual public outbound IP must
be allowed for the Kite app whose API key is used by AUTONOMIQ. Successful quotes,
profile access or a connected feed alone do not prove order-placement permission.
Check the execution detail and Zerodha order book for the broker's actual response;
do not increase risk limits or repeatedly retry an uncertain order to test connectivity.

### Local-to-production workflow

1. Stop new entries on the other deployment. Run only one live executor per broker account;
   local and production have separate ledgers and do not share approval or daily-risk state.
   Do not stop a process managing open positions: keep it managing its own trades until
   they are closed and pending orders are reconciled before moving execution.
2. Locally set `AUTONOMIQ_PRO_DEPLOYMENT_MODE=local` and
   `AUTONOMIQ_PRO_ALLOW_LOCAL_LIVE=true` in `backend/.env`, then restart the backend to load
   updated code. Local live execution places real orders; it is not a simulation.
   For a real-money local session, stop the development backend in its terminal and run
   without auto-reload (do not start a second server on the same port):

   ```powershell
   Set-Location backend
   ..\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
   ```

   Do not use `--reload` or edit backend code during an armed live session. Each reload is
   a restart and intentionally resets owner approval OFF. A signal received while OFF is
   not replayed after ON; the next entry must qualify from fresh analysis and quotes.
3. Use the local dashboard LOGIN if candles/futures report `TokenException`. Production
   login does not refresh the local broker session. Ensure the local machine's outbound
   IP is permitted for the Kite app; the production server's static IP is not local egress.
4. In Settings, confirm deployment mode `local`, local live opt-in `true`, and execution
   allowed `true`. Sign in as owner and turn Live trading ON with its real-order confirmation.
   Broker/AI preflight failures leave it OFF. Existing signal and monetary risk limits still apply.
5. To return to production, first finish/reconcile local trades and switch local entries OFF.
   Deploy the same code with mode `production` (the production Compose service sets it), use
   production credentials/egress, and manually authorize production again after startup.
   The local opt-in need not be enabled in production. No trades or approvals migrate automatically.

## Risk and reporting

SQLite schema version 5 adds the protective/exit tracking columns missing from
early version-4 databases without deleting trades or resetting execution state.
The migration also accepts version-4 databases where those columns already exist.
Startup must complete the migration before position reconciliation begins.

Defaults are ₹1,000 estimated risk per trade, five filled entries per day, three open
positions globally, and a ₹3,000 daily loss limit. The strategy is capped at one lot per
index and one open position per index. Values are controlled by AUTONOMIQ PRO
configuration in `backend/.env`. When the estimated daily loss reaches the configured
limit, the executor disables new entries and requests exits for its owned positions.
Live entry checks also reserve an independent per-index daily loss budget, including
costs and pending risk. `AUTONOMIQ_PRO_INDEX_DAILY_LOSS_LIMIT_RUPEES` configures this
budget and defaults to ₹1,000 in both local and production deployments. It must be
finite and non-negative. Increasing the per-trade cap does not raise this separate
budget, and increasing the index budget does not raise the global daily limit.
For an explicitly authorized ₹2,000 local index budget, set
`AUTONOMIQ_PRO_INDEX_DAILY_LOSS_LIMIT_RUPEES=2000` only in the local `backend/.env`.
Production retains its default unless its own environment explicitly overrides it;
do not upload the local environment file.
The analysis-stage Risk per trade check reports the one-lot stop risk
`(entry - stop_loss) x lot_size x lots`, before fees/slippage, and explicitly states
whether that amount is within or exceeds the cap. The executor then independently
checks fresh-quote risk including estimated round-trip costs and exit slippage.
An AI/quant BUY remains BLOCKED if either check fails.
A cost-aware live rejection also marks the signal's Risk gate BLOCKED
and persists the failed check, rather than retaining the earlier analysis-only PASSED.
Budget rejections show estimated new loss, available budget, configured limit, net
P&L and reserved risk; they do not imply that a trade has already lost that amount.
The minimum position is one exchange lot: fractional-lot sizing, arbitrarily tightening
the strategy stop, or increasing limits automatically are not used to force an otherwise
rejected entry.
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
Live-card entry and target prices are shown only for a broker-confirmed filled
quantity; the entry premium uses the actual broker fill average, not the planned
limit. Unsubmitted plans and unfilled/uncertain intents keep live prices and P&L
blank. Pending intents are not sent to the AI as held positions.

An explicit Zerodha permission refusal is REJECTED, not an uncertain submission.
Legacy same-day ENTRY_UNKNOWN records containing the explicit IP-denial response
can reconcile to REJECTED only after account verification and broker reads confirm
no order bearing the owned tag, no order ID or recorded fill, and no position in
that contract. History and an audit record are retained. Network errors, missing
acknowledgements, older-day records and ambiguous broker evidence remain blocked
for reconciliation. A rejected slot is not retried; only a fresh qualifying signal
can create another entry after owner authorization and all checks pass.

Trailing calculations continue above T1: the stop keeps following the highest fresh
bid once the cost-inclusive activation threshold is met, with the existing T1
breakeven floor. A pullback never loosens the stop. The stored trailing price advances
only after Zerodha acknowledges the SL modification; a rejected update retains the
previous stop and raises an error.

Live cards use the owned order/position state for their primary status, independently
of the latest AI signal. Pending entries show their submitted entry limit, but do not
show an active SL, trailing SL or position P&L before a fill is confirmed. Open-position
live P&L requires a fresh position quote; stop prices remain visible if that quote is stale.
When analysis inputs are missing, the card reports DATA UNAVAILABLE and unavailable
signal strength instead of presenting a zero score as a low-strength signal. Without
a qualified BUY plan or an owned order/position, entry and stop prices stay blank;
WAIT is not an instruction to submit a broker order.

An empty Trades tab also shows the latest per-index action, execution status and
blocking reason, with the next scheduled analysis time. Manual quant-only refreshes
are explicitly identified; neither a bullish market banner nor owner approval ON
constitutes a BUY signal or an order acknowledgement.

The production deployment currently uses one backend worker and a persistent SQLite
ledger. Do not scale AUTONOMIQ PRO to multiple backend replicas without shared
coordination and ledger/lock changes.

## Deployment status

The implementation must still be reviewed and deployed in the production environment
before live use. Tests do not submit broker orders. Keep the owner switch OFF until the
production configuration, Zerodha account, order reconciliation, and operational
monitoring have been independently verified.
