# AQTE - Adaptive Quantitative Trading Engine

## Release boundary

This is the **paper-first foundation**, not a production-approved autonomous trading
system. The dashboard has NIFTY, BANK NIFTY and SENSEX index tabs above the charts,
with one full-width index panel visible at a time (NIFTY by default).
There is no full option-chain interface or strategy
configuration panel. The separate opt-in live controller requires explicit daily arming and ON confirmation.
All quantitative decisions run in Python.
AQTE now displays **Real Trade only**.
The redundant Real Trade / paper-disabled banner is visually hidden; the region
retains its screen-reader heading and automation still defaults OFF.
Paper Trade navigation, positions and paper P&L are removed from this section. The production AQTE service runs
**ANALYSIS_ONLY**: candles, signals, tick recording and Real AQTE quote/metrics
support continue, but simulated order creation, fills and management are disabled.
Saved paper state, completed trades and audit records are preserved, not deleted
or replayed into production. Historical replay retains its isolated simulation.
The authenticated paper kill endpoint returns **410** while paper trading is disabled.
Other application paper modules are unchanged.
Selecting Real Trade does not arm a session, enable automation
or submit orders; the existing default-OFF and explicit approval requirements remain.
Real Trade has an authenticated live
controller, locked by default. Its three index cards show WAIT without
paper entries, paper positions or paper P&L. An actual matching AQTE-owned fill
can show LONG OPEN, its broker average and confirmed protection instead.
The shared analysis polling session stays mounted. Index tabs support arrow keys,
Home/End and visible keyboard focus.
The terminal-style layout uses a bordered gradient shell, distinct cyan/amber
selected tabs, per-index accent borders, prominent tabular index prices and separated
signal/risk readouts. Index tabs support arrow keys, Home/End and visible focus.
Index tabs use restrained tinted borders, layered dark backgrounds and a
static selected underline: cyan for NIFTY, indigo for
BANK NIFTY and violet for SENSEX. The visual treatment adds no animations,
layout shifts or changes to trading behavior.
Index selection changes do not add polling or order actions.
Hidden index panels remain mounted; the embedded chart mounts only for the selected index.
Real positions only appear under their own
index; other tabs retain an explicit warning when another index holds a position.
Controller alerts and account-wide emergency protection stay visible.
The red emergency-stop/exit-request control sits at the top-right of the Real
Trade box (full-width on phones). Static-IP preflight and daily arming controls
are inside the collapsed setup disclosure, not in the primary action row.
Their backend safety requirements and explicit daily approval remain unchanged.
Visual accents do not indicate validated predictions or unlock live execution.
Open positions have a shared presentation in both modes: actual average buy entry,
entry time (IST; live time is when AQTE first observes the confirmed fill),
running option LTP, initial and current stop, trailing status,
target, remaining quantity, peak observed points, current points and open gross/net
P&L. Python computes points from the fresh sell bid, not the underlying index or
LTP. P&L requires enough displayed bid quantity for the remaining position and net
deducts estimated entry/exit costs (not broker contract-note charges).
Stale/missing quotes and disconnected views suppress current prices/points/P&L
instead of displaying a misleading zero. Last-known entry, stops and peak remain
visible. Requested trailing changes are separate from broker-confirmed stops;
planned, unconfirmed protection is labelled explicitly. Best observed gain is
the peak bid seen by the engine since entry, not a guaranteed achievable profit.
The existing two-second, non-overlapping snapshot polls use cached market state;
position display adds no broker requests. The embedded price chart is described below.
Metric panels remain visible before entry: the live
execution panel shows labels with `--` values and a waiting-for-entry
message. Missing positions never hide the readouts or imply a zero profit.
Explanations, full position breakdowns, calculation notes and live setup/limits use native
details disclosures, collapsed by default. Summary values, entry time, quantity, trailing
status, pending stop acknowledgements, controller alerts and emergency controls
remain visible. The AQTE header omits the schedule card and expanded automation
help to keep it compact, including when status is unknown. The switch retains
screen-reader help, visible save/status/error messages and explicit ON confirmation.
The redundant header subtitle and bottom Execution notes block are omitted.
The separate Automated Paper Trading tab and its panel are removed from the
chart workspace. Its four remaining chart tabs fill the tab row (two columns on
phones). Existing chart paper overlays/recording, historical records and AQTE
Real controls are unchanged; this removal does not disable a backend engine.
Header columns stack on phones, split across two rows on tablets and align inline
on wide desktops. Tablet charts take the full available row, with depth and daily
controls below; narrow daily counters put labels above their 44px touch controls.
Text and contract identifiers wrap without truncation, and very narrow position
summaries use two columns. These layout changes are scoped to AQTE only.
The research cards (Analysis, Trade Setup, Strategy Logic and Expected Profit)
start collapsed behind keyboard-accessible summaries. The manual Zerodha readout
starts expanded. Long yellow read-only and closed-market paragraphs are replaced
by "Read-only · Manage in Kite" and "Broker readout paused · Positions unverified";
the pause reason remains available in the status tooltip.
Manual broker position summaries use individually bordered light-green metric
tiles with consistent spacing, within a matching dark outer panel. The existing
responsive column layout and read-only/stale semantics are unchanged.
Their existing data polling remains mounted; expanding never starts trading.
Emergency Stop, controller errors and active AQTE-owned positions remain visible.
The six overview cards use light-green borders and higher-contrast labels/values.
Redundant navigation hints, empty rule-score bars and duplicate mode/placeholder
rows are omitted. Missing intelligence, awaiting fills and unconfirmed stops remain
explicit; actual contract names, filled prices and confirmed trailing values stay visible.
Overview values use `--` for unavailable market direction, a WAIT trade decision
or inactive trailing, consistent with missing prices. The underlying WAIT decision
is unchanged; actionable signals, LONG OPEN, confirmed market direction and ACTIVE
trailing remain unchanged.
AQTE uses a 14px (0.875rem) minimum for labels, controls and explanatory text,
16px card titles and position values, a responsive 18–24px section title and
consistent 24px overview values. All six cards share the same sans-serif font,
16px semibold headings and 14px regular supporting labels; the target uses the
same primary-value layout as entry and stop. Chart-axis text is 12px. Very narrow overview layouts
stack into one column to preserve readable text rather than shrinking fonts.
Live setup remains collapsed by default and contains only the required preflight,
daily-arm actions and a concise backend-approval notice. Redundant static-IP/risk
summary boxes, account details and lengthy setup explanations are omitted from
the UI; backend checks, risk limits and protective management are unchanged.
The header uses an illustrated-style Automated Trading Control with separate ON
and OFF buttons. Confirmed ON is bright green; OFF is amber and a latched emergency
stop is red. Unknown status never highlights a confirmed state. ON still requires
daily arming and real-money confirmation; OFF requests only a new-entry pause,
never emergency reset or cancellation of existing protection.
The control heading and ON/OFF buttons align in a compact row with 44px minimum
touch targets and a short acknowledgement beneath. Repeated captions and refresh
explanations are omitted visually; backend persistence and emergency locking remain.
Confirmed header ON now calls owner-authenticated `POST /api/aqte/live/start`.
Under the existing controller lock, it validates approval, weekday/entry hours
and the emergency latch, runs Kite/static-IP preflight and daily arming when
needed, then enables scanning. It does not itself submit an entry: only qualifying
signals passing existing daily/quality/risk gates can buy. OFF pauses entries;
ON can resume an already armed ordinary OFF session. Restart/new day still
defaults OFF; a latched emergency is not an ordinary pause and cannot be cleared
by ON — use the confirmed emergency reset once Kite is flat. Invalid token, failed checks or missing validation still prevent starting.
The compact header badge describes the market feed, not automation. LIVE requires
a fresh shared index tick and socket connection during weekday 09:15–15:30 IST
hours; otherwise it shows FEED OFF during those hours or CLOSED outside them.
The badge follows the title text inline and wraps naturally with it on phones
and tablets, rather than occupying a separate header column. LIVE is green;
CLOSED and FEED OFF are amber/yellow. Feed detection is unchanged.
The heading uses a shrinkable text column alongside a top-aligned icon (smaller
on phones). Title words wrap without truncation; the compact status badge stays
together and moves onto the next line when space is insufficient.
Emergency locking and ON/OFF remain explicit in the separate automation control.
The decorative gear and Auto Trading heading are omitted; the compact ON/OFF
group retains accessible labels and visible emergency, save and error messages.
Removing the heading does not unlock emergency-latched automation.
The verbose unknown/verifying acknowledgement is screen-reader-only to avoid
header clutter. ON remains blocked while status is unknown; explicit error alerts
and the OFF-request action remain visible.
Index prices, entry ranges, maximum buys, stops, targets, position prices, entry
time, quantity and trailing metrics use separate compact bordered tiles. Labels
have consistent contrast, numbers are tabular, and long values/contracts wrap
instead of being truncated. Price tiles use two columns on phones and three
where space permits; explanatory disclosures stay collapsed.
The AQTE shell is fluid with shrinking/wrapping children instead of clipped
overflow. Mobile controls span the available width; live actions stack on phones,
use two columns on tablets and three on large screens. Tabs retain 44px minimum
touch targets. Browser checks cover 320, 375, 390, 640, 768, 820, 1024, 1440 and
1920px viewports in Paper and Real views, with long contracts and large prices.
The underlying index appears before execution details in both views. Compact
price tiles lead with entry, live option LTP, initial stop and current/trailing
stop, followed by target and peak gain; profit, points and percentage-from-entry
sit beneath. The percentage is the option sell-bid return from entry, not a net
P&L percentage. Live profit uses estimated costs and never implies realised gains.
AQTE uses a neutral outer shell and restrained section accents, with soft green
borders explicitly scoped to inner index/position price, time, quantity and
trailing-metric tiles. Tabs, disclosures and status badges retain their own styling;
text and background tints distinguish entry/live prices, risk, trailing stops and targets.
Emergency controls and error alerts keep their red safety styling.
Positive and negative open P&L use green/red text and tints without animations.
Underlying index prices consume the dashboard's existing shared market WebSocket
props directly, without waiting for AQTE's two-second analytical snapshot poll or
opening another connection. Connected LIVE quotes within five seconds show a
LIVE FEED badge plus daily points/percentage change. Otherwise the labelled AQTE
snapshot remains visible; backend signal and position-risk freshness rules are
unchanged. Feed, broker and network latency still apply.
Existing charts, trading books, authentication and signals retain their own behavior.
AQTE does not disable or change any other module's independently configured execution.

### Reference-style frontend terminal

The AQTE section alone now uses the supplied dark-terminal visual layout:
six overview cards (market view, signal, entry, SL,
trailing SL and target), central candlesticks, an order-flow/indicator readout,
a control rail, four analysis/setup/strategy/illustrative-return cards and a compact
position summary. Native disclosures retain the full position breakdown and
calculation notes. Other dashboard sections and the backend are unchanged by this
redesign. Existing index/mode keyboard navigation, daily saves, ON confirmation,
emergency stop, manual-Kite read-only behavior and risk gates are preserved.
The optional left-side Dashboard, Live Market, Analysis, Positions & P&L and Risk
Control shortcuts are not rendered. Their sidebar column is removed at every
viewport size; all corresponding content and trading controls remain available.

- The chart lazy-loads the existing `lightweight-charts` dependency and reuses
  `useChartHistory` and its shared request cache. Supported view-only frames are
  1m, 3m, 5m (default), 15m and 1h. There is only one embedded chart, regardless of the number
  of index panels. It reuses the already-connected index feed; no extra WebSocket
  and no faster analytical/broker polling are introduced.
- Live candles and EMA overlays update incrementally without recreating the chart,
  uploading the whole history on ticks or resetting the user's chart viewport.
  Background older-history prefetch keeps existing candles visible (no full-chart
  loading overlay), restores the visible time range after prepending history, and
  retains newer live candles. Older-page failures use a non-blocking retry warning
  rather than blanking the chart; live ticks continue during history prefetch.
  ResizeObserver keeps the canvas sized to its card and disconnects on unmount.
  The chart is **index history**, not option or futures candles. Futures intelligence
  is labelled separately; EMA chart overlays are display-only and never drive trades.
  Index-tick volume is not invented.
- The current AQTE dashboard API does not expose a five-level option book or Greeks.
  The reference's fabricated-looking depth, IV/Greek values, calibrated ML percentages,
  extra targets and scalp profits are **not copied as data**. Unavailable fields
  show `--` with explanations. Expected profit is a gross arithmetic illustration
  of the actual paper entry/target/quantity only, never a forecast or execution promise.
- Real overview values come from the already-polled live controller, limited to the
  selected index. Unconfirmed stop requests are not promoted to confirmed SL/TSL.
  Manual Kite prices remain in the separate read-only position summary below.
  Paper entry plans never leak into real execution cards. Missing/stale controller
  or option state hides current LTP/profit; stale futures intelligence is not shown
  as a current market view.
- All terminal CSS is scoped under `.aqte-theme`; container queries adapt the six-card
  desktop layout to three/two cards and stacked chart/controls on tablets and phones.
  There is no tick-flash animation or new animation/rendering dependency.

The paper engine never submits broker orders. An **opt-in, explicitly armed automated live
pilot** now exists in `backend/services/aqte_live.py`, with owner-authenticated controls
in `frontend/components/AQTELivePanel.tsx`. It remains disabled by default.
Scores are explainable rule scores, not calibrated ML probabilities. There are no
profitability or fill guarantees.

## Repository findings and reuse

### Manually purchased Kite positions

When there is no AQTE-managed position for the selected index, the Real Trade
execution box displays read-only Zerodha positions in the same compact price,
points/percentage and P&L layout instead of an unrelated waiting-for-entry box.
The source is explicitly labelled Kite read-only; gross LTP P&L is never labelled
net. Unavailable initial stop, target, entry time and trailing history are not
fabricated. A single working stop trigger is displayed in the current-SL tile;
multiple stops remain individually listed with quantities instead of picking one.
`/api/aqte/live/broker-positions` uses the existing owner-session
authentication, existing Kite token and a three-second account/token-scoped cache.
It reads net NFO/BFO NIFTY, BANKNIFTY and SENSEX exposure, quotes and working orders;
it never adopts positions or calls broker mutations and works with automation OFF.
Actual broker average entry, signed quantity, fresh LTP, direction-adjusted points,
percentage and open gross LTP P&L are shown (fees excluded). Missing/stale quotes
and failed broker requests suppress current profit rather than showing zero.
Broker failures are explicit; the dashboard must not imply a flat account.

Only same-contract/exchange/product opposite-side working SL/SL-M orders are
listed, including remaining quantities and status. Coverage may be partial;
GTT/external stops are not verified. Current triggers do not establish initial SL
or trailing history, which remain explicitly unavailable. Manual positions must
be managed in Kite: AQTE's emergency stop does not liquidate these positions.
This display does not approve or enable real automation.

- FastAPI lifespan owns a shared `MarketFeedService` and KiteTicker connection.
- Existing authentication saves the active daily Kite access token and reconnects
  the feed after token changes. AQTE does not create an app, alter credentials,
  change the redirect URL, implement another login or store tokens in its journal.
- Spot index packets have no exchange timestamp or tradable volume. AQTE explicitly
  uses receipt timestamps for spot freshness; derivative timestamps must come from Kite.
- Current `CacheService` is an in-process TTL cache, **not Redis-backed**, even when
  `REDIS_URL` is configured. Existing paper books use SQLite, not PostgreSQL.
- Deployment is currently single-worker. AQTE follows that topology and adds an
  isolated Docker volume rather than migrating existing data stores.

## Structure and data flow

```text
Existing KiteTicker
  |- existing spot/futures consumers (unchanged)
  |- AQTE nonblocking bounded queue
  |    |- raw quote journal (7-day retention)
  |    |- completed candles: 1s / 5s / 15s / 1m / 3m / 5m
  |    |- futures indicators and explainable strategy candidates
  |    |- actual option instrument metadata + fresh bid/ask liquidity gates
  |    |- risk reservations -> limit pending -> filled -> trailed -> closed
  |    `- isolated durable state / trades / audit events
  `- selected CE/PE MODE_FULL subscriptions on the same connection

GET /api/aqte/snapshot -> presentation-only React cards (2-second polling)
```

| File | Responsibility |
|---|---|
| `backend/services/aqte_engine.py` | Pure candles, indicators, strategies, risk checks and paper lifecycle |
| `backend/services/aqte_service.py` | Shared-feed adapter, option subscription rotation, bounded worker and persistence |
| `backend/services/aqte_replay.py` | Offline chronological replay and performance report |
| `backend/routers/aqte.py` | Read endpoints, paper stop and owner-authenticated manual live controls |
| `frontend/components/AQTESection.tsx` | Compact index-only presentation and connection recovery |
| `backend/test_aqte.py` | Core, replay, API, storage and worker tests |
| `frontend/tests/aqte.test.cjs` | Card isolation, no controls, stale/failure suppression and retry tests |

### Market data and intelligence

The existing connection supplies spot and near-month futures ticks. A background
task fetches the NFO/BFO instrument catalogs once per IST day using the existing
authenticated Kite client. It selects the nearest unexpired expiry and three nearest
strikes per index, subscribes both CE and PE in full mode, and refreshes the selection
every minute. Open and pending contracts stay subscribed across strike rotation.
Reconnect attaches the new authenticated client/socket; no additional socket is opened.
Catalog and subscription failures are logged and surfaced in the snapshot.

Quotes record LTP, exchange/receipt time, cumulative volume, top bid/ask and quantities,
and aggregate five-level buying/selling depth. Buy/sell depth imbalance is an order-book
proxy, **not identified aggressor flow or institutional activity**. Candles calculate
incremental volume without treating the first cumulative-volume tick as traded volume.
Gaps are not synthesized; instrument tokens and candle intervals remain separate.

Analysis uses **201 contiguous completed one-minute futures candles from the current
IST session**. It calculates SMA-seeded EMA 9/20/50/100/200, Wilder RSI/ATR,
SuperTrend, observed-session futures VWAP, relative volume, depth imbalance, range
breakouts, sweep/reclaim and market-structure proxies. CPR is contextual previous-day
**spot** CPR from the existing feed; it is not misrepresented as futures CPR or used
to place futures-derived stops. Missing contextual CPR stays null.

Strategies are momentum breakout, liquidity reversal, trend continuation and
mean reversion. Candidates opposed by book imbalance are discarded before selecting
the highest-scoring supported candidate. Output is BUY CE, BUY PE or WAIT with reasons.
There is **no LLM tick processing, synthetic option contract, fabricated quote or ML
prediction**. The baseline uses a conservative premium-distance stop; a learned
optimal-entry model is a later milestone.

### Entry and paper execution (isolated historical replay only)

- Select actual, unexpired instruments with broker-provided lot size and tick size.
- Require fresh spot, futures and option quotes; derivatives require exchange time.
- Require positive two-sided prices, volume, enough visible ask quantity for a lot
  and spread <= 3% of ask.
- Rest a tick-aligned limit at or below the initial midpoint, with a 30-second expiry.
  The maximum price is frozen; subsequent rising asks never move it upward.
- Never fill on the signal tick. A later exchange/receipt quote must offer the whole
  lot at ask plus configured adverse slippage **at or below** the resting limit.
- A premium gap below the planned stop invalidates the pending entry.
- Risk includes estimated entry/exit costs. Net planned reward/risk must be >= 1.5.
- Start with one lot; if that lot cannot fit the budget, WAIT rather than round up.
- Initial stop is 20% of premium or three spreads (whichever is larger), with tick
  constraints. Target is twice the planned price distance; these are **rule levels,
  not learned optimal prices**.
- Trail only after an observed 1R advance. Check the prior stop before changing it.
- Stop/forced exits use the next executable bid minus adverse slippage; gaps may
  exceed the stop budget. Target fills never improve beyond the resting target.
- Exits require sufficient visible bid quantity. Missing quotes/depth do not become
  successful fills. Data gaps are journaled; open risk remains explicit.
- No entries after 15:15 IST; square-off starts at 15:25 on an observed fresh quote.
  A missed session exit remains open until a later executable quote.
- **Partial profit booking is intentionally deferred:** the initial quantity is one
  indivisible lot. Multi-lot partial exits need their own validated order lifecycle.

### Risk policy

Defaults in the backend `Policy` dataclass:

| Policy | Default |
|---|---|
| Starting paper capital | INR 100,000 |
| Per-trade maximum planned risk including estimated costs | 0.5% of paper equity |
| Daily loss budget | INR 2,000 |
| Maximum filled trades/day | 5, with pending trade-slot reservations |
| Consecutive losing trades/day | 3 |
| Position limit | One lot and one order/position per index |
| Freshness | <= 5 seconds for both exchange and receipt time |
| Re-entry cooldown | 5 minutes per index |
| Kill switch | Latched across restarts; cancels pending entries and exits on fresh executable quotes |

Pending and open trades reserve capital and planned risk across all three indices.
Daily realized results, observed unrealized P&L and stale open-position quotes block
new entries when appropriate. Planned risk is not a guaranteed maximum loss.
Worker, queue or journal failures fail closed for new entries and require restart;
the interface suppresses BUY during recorder failure.

### Persistence and deployment

Default database: `backend/data/aqte/aqte.sqlite3`. Override its absolute location with
`AQTE_DB_PATH`. Use one backend worker; two workers would create competing paper books.
The deployment compose file persists `/app/data/aqte` using the `aqte-data` volume.

The additive, idempotent schema is created on startup:

- `aqte_ticks`: chronological quote records and receive timestamps; raw records older
  than seven days are removed on startup.
- `aqte_contracts`: real instrument metadata for replay.
- `aqte_state`: durable pending/open orders, kill state and re-entry deduplication.
- `aqte_trades`: completed trades with costs and net paper P&L.
- `aqte_events`: limit, fill, trail, cancellation, exit, data-gap and stop audit events.

Each worker batch writes ticks, events and state in one WAL transaction. The engine
stops on a transaction failure; uncommitted in-memory progress is not presented as
healthy execution. On restart, committed orders and all completed trades are restored.
Current-day recorded futures ticks rebuild candles **without replaying trades or
filling orders against past quotes**. A new installation must warm up for 201 completed
minutes (earliest approximately 12:36 IST with uninterrupted data from 09:15). Missing
historical data must never be treated as an already warmed/validated model.

No DigitalOcean/PM2/Nginx credentials or existing environment files are changed.
The existing `/api` reverse proxy covers these endpoints. The existing IPv4 setting is
reused, but it **does not prove static-IP compliance**: an operator must verify the
actual outbound IP against the broker allowlist before any future live rollout.
An expired Kite token still requires the existing daily authentication flow.

The operator-reported static IPv4 address is **122.177.245.101**. This is a declared
address, not a verified egress measurement. Allowlist it in the existing Kite app
only for a backend host that actually egresses through that address. A DigitalOcean
droplet may have a different outbound IP from a local workstation; verify on the
deployment host. No machine network configuration, broker allowlist, environment
secrets or order permissions are changed by recording this address.

### APIs

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/aqte/snapshot` | Three signals, intelligence, entries, positions, risk and health |
| GET | `/api/aqte/journal?limit=100` | Most recent trades and audit events; limit 1-500 |
| POST | `/api/aqte/kill` | Disabled in production (410); historical paper controls require an access JWT |

The kill endpoint accepts `Authorization: Bearer <application-access-JWT>`, **not** a
Kite access token or refresh JWT. There is deliberately no unauthenticated control,
no automatic rearming. Separate live-pilot controls are described below. A latched stop requires an explicit future
operator-reviewed rearming workflow; restarting alone does not clear it.

The UI uses existing API-origin resolution, non-overlapping two-second polling,
an eight-second timeout and automatic retry. Old BUY details are hidden on failed,
invalid or stale responses; the backend also withdraws stale signals. The shared
market WebSocket and all other data providers remain mounted.

## Historical replay and validation

From `backend`, replay one IST day of AQTE-recorded quotes:

```powershell
..\.venv\Scripts\python.exe -m services.aqte_replay --db .\data\aqte\aqte.sqlite3 --day 2026-10-30
```

The database is opened read-only. Replay processes receive-time order, rejects unordered
programmatic input, uses only completed candles and subsequent option quotes, applies
the same risk gates, and never force-closes the last position. It reports trades, net
P&L, win rate, profit factor, strategy breakdown, closed-equity drawdown and open/pending
positions. Explicitly increase `--max-ticks` for more than 250,000 records. Stress fills
with `--slippage-ticks`. Compare fixed-policy chronological days; do not tune on test days.

Default simulation costs are INR 20 per entry/exit plus 0.15% of each side's turnover,
and one tick of adverse slippage on executable quotes. These are conservative **estimates**,
not exchange/date-specific brokerage, STT, stamp duty, GST or other statutory tax advice.
Real queue position, latency, market impact and partial fills are not modeled.
Replay of recorded subscribed instruments has selection bias and is not full-chain ML
validation. No retrospective CPR is synthesized from incomplete history.

Validation commands:

```powershell
Set-Location backend
..\.venv\Scripts\python.exe -m unittest test_aqte test_paper_trading test_order_flow_paper -q
Set-Location ..\frontend
node --test tests\aqte.test.cjs tests\institutional-workspace.test.cjs tests\chart-workspace.test.cjs tests\chart-paper-trading.test.cjs
.\node_modules\.bin\next.cmd lint --file components\AQTESection.tsx --file app\page.tsx
.\node_modules\.bin\tsc.cmd --noEmit --incremental false
```

## Incremental implementation plan

1. **Implemented: isolated rule-based paper foundation.** Shared Kite data, real
   option subscriptions, candles, explainable candidates, conservative entry limits,
   risk reservations, durable paper orders/journal, chronological replay, compact UI.
2. **Data-platform hardening.** Provision PostgreSQL and actual Redis, migrate only
   AQTE tables with versioned migrations, add a single execution leader and durable
   stream offsets, archival/retention jobs, exchange calendars, richer depth recordings,
   date-specific fee schedules, telemetry and realistic partial-fill simulation.
   Do not silently substitute SQLite/in-process memory when production storage fails.
3. **Offline predictive ML.** Define forward-only labels and time-based train/validation/
   test splits with an embargo, version data/features, fit baseline models, calibrate
   probabilities, evaluate net costs/slippage, monitor drift and publish model cards.
   Only load approved artifacts with documented out-of-sample results; keep WAIT for
   missing/unapproved models. No per-tick external LLM requests.
4. **Paper acceptance gate.** Evaluate unseen sessions across regimes, stress disconnects,
   token expiry, restart, slippage and costs. Agree minimum sample size, loss/drawdown
   limits and operational acceptance criteria before declaring any model validated.
   Profitable backtests alone are not authorization for live trading.
5. **Explicit manual approval.** Add operator authorization, approval expiry, broker
   order-ID reconciliation, idempotency, actual fills, exchange-accepted protection,
   market-calendar/static-IP checks and emergency recovery procedures.
6. **Controlled live pilot, separately approved.** One-lot cap, explicit feature gate,
   daily operator arming, broker-side risk controls and reconciliation. Multi-lot
   partial profit booking and autonomous execution come only after this pilot.

Infrastructure migration, validated ML and autonomous execution remain unimplemented.
The controlled live pilot below implements a limited part of milestones 5-6; it does not
constitute production approval or successful broker validation.

## Opt-in automated live pilot - default OFF

The **AUTO REAL TRADING ON/OFF** switch is at the far right of the AQTE heading,
visible from either tab. It controls real entries, not market recording or the separate
paper book. The browser never starts automation merely by mounting or changing tabs.
Backend state is authoritative. Status failures display UNKNOWN with an OFF-request
action instead of pretending automation is stopped.
The header LIVE CONTROL badge and automation button use green text for confirmed
automation ON and amber/yellow for OFF or unknown status; emergency stop is red.
The switch uses a prominent solid ON/OFF/EMERGENCY STOP label and stronger matching
border. ON/OFF actions are automatically journalled by the existing backend.
Page refresh restores the authoritative state using GET only, never by replaying
an ON request or trusting local storage. A saved/confirmed acknowledgement is
shown only after a successful response; unknown outcomes remain explicit.
Backend restarts, session rollover and safety stops still reset automation OFF.
The badge consumes the existing switch status poll and acknowledged actions, adding
no polling. Selecting the Real Trade view alone never makes the badge green.

- The backend enforces the regular **09:15–15:30 IST** session, the **15:15**
  new-entry cutoff and the **15:25** square-off start. Entry automation changes to
  OFF at the cutoff even with an open AQTE position; protection and reconciliation
  continue. Square-off requests are not guaranteed fills.
- ON buys only qualifying CE/PE setups for enabled indices using saved maximum
  trade counts and risk settings. It does not force a trade or control paper
  trading, market data or manually opened Kite positions.
- OFF is the reversible pause for new entries and remains available outside
  market hours. Emergency Stop is not a pause: see **Emergency Stop · close all** below.
- New installations, every backend restart and daily arming start **OFF**.
- Complete IP/Kite preflight and explicitly arm the current session first.
- Click the header switch, then **Confirm ON · real money**. This authorizes automatic
  qualifying real entries without per-order approval, using all existing entry checks.
- **OFF blocks new entry orders**, invalidates prepared proposals, and retains broker
  protection, trailing stops, target/stop exits and reconciliation for existing trades.
- Already submitted or in-flight broker orders cannot be undone by changing a switch.
  ON/OFF and submissions are serialized; wait for acknowledged OFF, not a local click.
- A new day, shutdown/restart, emergency stop or monitoring fault clears automation.
  Existing open positions continue to be reconciled regardless of the switch.
- ON never means "buy immediately": no valid fresh signal means no entry. Only one
  pending/open live trade is allowed across the three indices, and used strategy candles
  cannot submit duplicate entries.

Trailing is always enabled for open live positions: after the bid advances by the
saved threshold (default +1R; R is actual fill price minus initial stop), the requested stop follows the highest fresh
observed bid by that fixed initial-risk distance. The trigger is tick-rounded and never
lowered. It modifies the same broker SELL SL rather than creating another exit order.
The interface shows the **broker-confirmed** SL separately from any pending requested SL;
lost modification responses are reconciled, never blindly retried. A profitable trailing
stop above entry is not mistaken for an invalid initial entry. Trailing and exits still
run when the entry switch is OFF. Quotes between monitor samples are not reconstructed;
gaps, partial fills and stop-limit non-execution remain real risks.

### Real-only daily trade controls

The compact **Daily trade limit** box at the top-right of the Real tab
stores independent NIFTY, BANKNIFTY and SENSEX preferences in the existing live SQLite
journal. Paper trading and read-only manual Kite positions are unaffected.

- Each index defaults to **disabled**, a maximum of **5** entries/day and minimum
  rule score **90/100**. Three always-visible rows have **− / count / + / Save**.
  Adjust each index from 1–10, then press its own Save button. Amber counts are drafts;
  polling does not overwrite them. Saved limits persist until manually changed,
  while executed/reserved counts reset on the IST day.
  Limits can be changed even while automation is ON, under the same controller lock
  used for submissions. A decrease below used/reserved trades blocks further entries,
  not existing protection; it cannot retract an already-submitted order. Saving does not
  arm the session, enable the global switch, or place an order.
- Limits are maxima, never quotas. Zero entries is an acceptable outcome. The
  account-wide maximum remains **5 across all indices**, not five per index;
  larger saved index limits cannot override this ceiling.
- Enable/disable and advanced risk settings remain under a collapsed disclosure and
  require automation OFF. The dedicated limit-only endpoint cannot alter those settings,
  quantity, existing positions, arming or the global automation switch. A trade is still
  exactly one lot; the displayed count is **maximum trades**, not lots per trade.
- The panel reports saved limit, executed, pending/reserved and remaining entries,
  direction, candidate and WAIT reason. Unsaved drafts survive polling.
  An uncertain entry reserves a slot before submission; any partial fill consumes
  one entry, never two. Confirmed unfilled cancellations/rejections release the slot.
  Counts use the exchange's IST session day and survive backend restarts.
- Only BUY CE / BUY PE can open positions. SELL orders remain protective/closing
  orders for owned quantities. Duplicate strategy candles, a five-minute same-contract
  cooldown and near-identical premium re-entries (less than 1% apart) are blocked.
- Saved SL percentage (5–30%), target (2–5R), trailing activation (1–3R) and daily
  index loss budget (up to INR 2,000) apply to future entries only. Existing trades
  retain their captured protection settings. The INR 500 one-lot per-trade ceiling,
  account loss ceiling, cash, broker, stale-data and one-position guards still apply.
  Planned reward/risk is recomputed after estimated fees and must be at least 1.5.
- Eligible indices are considered in descending score order; weak, sideways,
  incomplete or unvalidated evidence never becomes a forced trade.

**Important current limitation:** these controls do not train or validate a predictive
model. The existing rule baseline tops out at 80, is unvalidated and cannot pass the
minimum 90. Even a synthetic higher score must pass directional EMA 9/20/50/100/200,
VWAP, SuperTrend, RSI, CPR, volume, order-flow and breakout checks. Validated option-chain
OI/PCR/Greeks and liquidity-sweep confirmation are **not implemented**; their absence
is an explicit final blocker, not inferred or replaced by an inflated confidence score.
Consequently this stricter live policy remains WAIT until the missing evidence and
validation are actually implemented. A rule score is not a calibrated win probability;
none of these checks guarantee profitable trades or execution.

The centralized settings are in `backend/config/__init__.py`; environment overrides
are documented in `backend/.env.production.example`. The default static IP is
`122.177.245.101`. Development did not change your private environment or submit orders.

```dotenv
AQTE_LIVE_ENABLED=false
AQTE_LIVE_PAPER_VALIDATED=false
AQTE_LIVE_STATIC_IP=122.177.245.101
AQTE_LIVE_RISK_PER_TRADE=500
AQTE_LIVE_DAILY_LOSS=2000
AQTE_LIVE_MAX_TRADES=5
AQTE_LIVE_MAX_LOSSES=3
FORCE_OUTBOUND_IPV4=true
```

Only an operator who has completed paper acceptance should approve the two enablement
flags. Restart the backend after changes. First verify the saved Kite allowlist and the
backend host's outbound IPv4; a browser's IP is insufficient. The preflight contacts
`https://api.ipify.org` over direct HTTPS with no credentials or account/order payloads;
it then validates the existing Kite profile and requires a flat broker account without
working orders. Proxy environment variables and a separately enabled live Smart AI Algo
block the pilot. Matching this public-IP check cannot prove the broker's own allowlist;
Kite's actual permission checks remain authoritative. Do not edit machine routing to
impersonate an allowlisted address.

In **Real Trade**, the signed-in configured app owner performs:

1. **Check static IP & Kite** (read-only broker calls).
2. **Arm real trading today** within 60 seconds of preflight during the regular session.
3. Switch **AUTO REAL TRADING ON** in the heading and confirm real-money automation.
4. The monitor consumes qualifying signals automatically through the same short-lived,
   server-generated proposal and broker revalidation path; no individual BUY click is needed.

Automatic entries are permitted **only while ON and armed**. The controller does not trust browser prices or quantity.
It rechecks settings, IP, account identity, flat account, current signal, timestamp,
spread/depth, cash, one-lot quantity, risk budget and cutoff before submission.
One pending/open live trade is allowed across all indices; planned risk is capped at
INR 500 including estimated costs, with daily limits of INR 2,000, five filled trades
and three consecutive losses. Those are planned limits, not guarantees against gaps.

The entry is a no-chase **IOC LIMIT**, not a market order. The broker-reported actual
fill quantity and average price are authoritative. After the entry is terminal,
the controller places a broker **SELL SL (stop-limit)** for the actual filled quantity.
Partial IOC fills are protected at their actual quantity. There is necessarily a
broker/network interval between the entry fill and the stop acknowledgement; this
is not an atomic bracket order. Keep Kite open throughout the pilot.

Targets, trailing and emergency exits modify the **same sell order**, never a competing
SELL that could accidentally open a short. A triggered stop or requested exit becomes
an aggressively priced limit updated from fresh observed bids. A stop-limit or exit
limit can remain unfilled after gaps or thin liquidity. Broker rejection, missing
protection or inconsistent positions requires immediate operator attention in Kite;
the controller does not manufacture successful exits or blindly submit another SELL.
Stale data disarms entries and retains existing broker protection. Automatic session
exit requests begin at 15:25 IST when executable fresh data is available.

The durable `backend/data/aqte/live.sqlite3` journal records intents **before** mutation,
broker IDs, unique tags, fills, exits and audit events. A separate OS file lock prevents
two local processes from owning the same live journal. Use one backend worker and one
host; this is not a distributed execution-leader implementation. Do not share the broker
account with manual trading, another execution app or a second deployment during this
pilot. Pre-entry broker reads cannot prevent an external concurrent order.

Lost entry/stop acknowledgements are reconciled by tag/ID from the broker order book,
not retried. Unresolved order modifications block further changes until observed in the
broker book. Broker position quantity must match AQTE fills. Restart disarms entries
but preserves active order identities and reconciles protection. Previous-session
unresolved trades, rejected/cancelled stops and manual position changes block automation
and require broker-terminal reconciliation.

### Emergency Stop · close all

For market crashes or broker problems. After a confirmation step
(`POST /api/aqte/live/stop` with `{"confirmation": "CLOSE ALL KITE POSITIONS"}`) the
backend immediately latches `killed`, turns automation OFF, disarms, and sets
`flatten_pending`. It then, on the call and every 2 seconds until Kite is flat:

- cancels **every** open Kite order (AQTE and manual);
- closes **every** non-zero Kite net position (NFO/BFO/NSE/BSE, AQTE and manual) with a
  marketable LIMIT DAY order 5% through the broker LTP, tagged `AQTEKILL`, using the
  position's product. An existing matching AQTE stop order is repriced instead of duplicated;
- does not depend on the AQTE tick feed, so stale market data cannot block the exit;
- waits 4 seconds after each send (and after newly completed fills) so lagging position
  data cannot create a reverse position; broker errors are logged and retried;
- after 5 rejected exits for an instrument, or an unsupported exchange, stops retrying it
  and shows "square off in Kite".

`flatten_pending` persists, so square-off resumes after a backend restart. When Kite
reports no open positions or orders, the AQTE trade is journaled with its emergency exit
fills. **Reset emergency stop** (`POST /api/aqte/live/reset` with
`{"confirmation": "RESET EMERGENCY STOP"}`) is only accepted when flat; automation stays OFF
until confirmed ON again. Fills are not guaranteed: price bands, freeze quantity (no
auto-slicing), holdings and other brokers are not covered — always verify in Kite.

All `/api/aqte/live/*` endpoints require the existing owner app-access cookie, matching
`X-Device-Id`, `X-AQTE-Intent: manual-live-control`, and an allowed browser Origin.
They do not accept Kite access tokens from the browser.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/aqte/live/status` | Readiness, IP preflight, limits, real order status and recent exits |
| GET | `/api/aqte/live/daily-controls` | Owner-only saved index settings, IST executed/reserved counts and quality blockers |
| POST | `/api/aqte/live/daily-controls` | Save `{"symbol":"NIFTY","config":{...}}` while OFF; strict `IndexControl` schema; no broker mutation |
| POST | `/api/aqte/live/daily-limit` | Save `{"symbol":"NIFTY","max_trades":3}` while ON or OFF; only the 1–10 entry cap changes, never lot size or protection |
| POST | `/api/aqte/live/preflight` | Verify direct outbound IPv4 and existing Kite account |
| POST | `/api/aqte/live/arm` | Body `{"confirmation":"ARM REAL TRADING"}` |
| POST | `/api/aqte/live/automation` | `{"enabled":true,"confirmation":"START AUTOMATED REAL TRADING"}` or `{"enabled":false,"confirmation":"STOP NEW ENTRIES"}` |
| POST | `/api/aqte/live/proposal` | Compatibility/internal proposal path; blocked while OFF |
| POST | `/api/aqte/live/confirm` | Compatibility confirmation path; blocked while OFF and still subject to all risk checks |
| POST | `/api/aqte/live/stop` | Latch emergency stop and request a reconciled exit |

These controls are independent of the older paper-only `/api/aqte/kill`, which is
disabled in production and cannot stop Real AQTE analysis.

### Production Zerodha login

The login page uses the shared `API_CONFIG.endpoint()` resolver for both one-click
and broker login, including same-origin production routing when no public API
URL was baked into the frontend image. It no longer blocks login simply because
`NEXT_PUBLIC_API_URL` is absent. One-click login failures are reported before
opening the existing broker login flow. Production still requires correct Nginx
`/api` routing, backend credentials and the configured Kite redirect URL.

### Deployment and login diagnostics

- A working homepage with **502** on `/api/app-access/session` and backend health
  indicates an unavailable Nginx backend upstream, not incorrect app credentials.
  Inspect backend startup logs and Nginx errors before changing login settings.
- The backend Docker context must preserve package `__init__.py` files. The
  `_*.py` private-script exclusion has an explicit `!__init__.py` exception:
  otherwise `config.get_settings` is missing in the built image.
- After deploying this correction, rebuild the backend image and verify backend
  health and app-access session before attempting login. Do not delete data volumes.
- Kite `TokenException` is a separate broker-session failure. AQTE live endpoints
  report **409** with a Zerodha re-login instruction, never empty successful positions
  or an authentication bypass. App-access authentication remains separate.
- The manual Kite position readout contacts the broker only during the regular
  09:15–15:30 IST weekday session with a healthy recorder and fresh index feed.
  Outside that window or during feed loss it returns an explicit paused reason,
  not a claim that no positions exist, and clears the short-lived readout cache.
  The UI keeps status polling so the readout resumes when fresh feed returns.
  AQTE-owned position reconciliation, stops and emergency controls are NOT paused.
  Exchange holidays are handled by the absent fresh feed; token renewal may still
  be necessary before the next session. App login remains available after hours.
Broker fees remain conservative estimates, not actual contract-note charges. No
profitability claim, IP-compliance certification or live fill verification is implied.
Validate the controller using `python -m unittest test_aqte_live`; all broker and IP
operations in that suite are mocked. Actual activation and one-lot live acceptance
remain operator tasks, not actions performed by the implementation or test suite.
