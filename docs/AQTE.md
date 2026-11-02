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
The header reports automation faults and emergency-latch status; controller/position
faults remain explicit in the trade hero. Active AQTE-owned positions remain visible
in the terminal and trade book.
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
The separate Safety & emergency panel and Live setup controls are removed.
The header's confirmed ON flow still performs preflight and daily arming.
Live-status polling and selected-trade exit confirmation remain mounted without
an extra panel; exit-request failures remain explicit. Backend approval, emergency
stop/reset APIs, risk limits and protective management are unchanged.
The header uses a single compact navy **Auto Trade** pill with a green track and
white thumb for backend-confirmed ON, and a neutral track for confirmed OFF.
The same 44px-minimum button requests OFF when ON; from OFF it opens the real-money
ON confirmation. It supports native keyboard activation, visible focus and reduced
motion. Initial loading says Checking; failed, unauthorized, malformed or stale
responses say UNKNOWN, never a confirmed OFF. UNKNOWN disables starting and retains
a separate OFF-request recovery action. A latched emergency is red and cannot be
cleared by ON or by market reopening. Only while latched, a compact **Reset emergency
stop** action appears beside the switch; it requires fresh controller status,
completed square-off, no active AQTE trade and explicit owner confirmation.
Reset calls the existing authenticated reset endpoint and must acknowledge a cleared
latch with automation OFF and unarmed. It never starts trading; ON requires its own
confirmation. Pending, failed or unverified
resets cannot enable ON. The removed safety/setup panel stays removed.
Successful acknowledgements remain available to screen readers;
errors, saving and emergency messages stay visible. No optimistic state or local
storage can enable trading; duplicate clicks and older in-flight polls cannot
overwrite command results. OFF does not cancel existing protection.
Confirmed header ON now calls owner-authenticated `POST /api/aqte/live/start`.
ON is a **standing request** accepted at any time, market open or closed. Under the
controller lock it validates approval and the emergency latch, then saves
`automation_wanted` in the journal. Inside weekday 09:15–15:15 IST entry hours it
immediately runs Kite/static-IP preflight and daily arming, then enables scanning.
Outside those hours the switch shows **ON · Waiting for market**, and the monitor
arms itself at the next 09:15 IST. A failed preflight (IP, Kite token, account not
flat) keeps ON, shows the reason, and retries at most once per minute; it never
places orders. It does not itself submit an entry: only qualifying
signals passing existing daily/quality/risk gates can buy. ON stays saved across
backend restarts, the 15:15 cutoff and new days until you switch OFF, request a
manual exit, or trigger the emergency stop; a latched emergency is not an ordinary
pause and cannot be cleared by ON — use the confirmed emergency reset once Kite is
flat. Missing approval keeps ON locked.
The ON confirmation states the server's entry mode (strict scan-only, or unvalidated
rule entries allowed). **Cancel · stay OFF** and Escape only close the confirmation;
they send no command because automation is already OFF. The risk card shows
**Locked · Live approval required** only when `AQTE_LIVE_ENABLED` or
`AQTE_LIVE_PAPER_VALIDATED` is not true; with approvals present it shows
**Waiting · ON · arms 09:15 IST** (or **arming / preflight**) while a standing ON
waits, and **Not armed · Arms when Auto Trade turns ON** while OFF.
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
The section header's green LIVE badge additionally requires a fresh selected-index
AQTE signal and fresh AQTE spot/futures feeds (`feed_ready`). A healthy dashboard
spot feed cannot hide a stopped AQTE futures feed. The controller's `entry_blocks`
reports each index's rule and estimated one-lot risk blocker without making broker
requests; the terminal and Controls show these before any order attempt. A null
blocker is not a fill or an execution approval: broker, cash, session and daily
budget checks still run at submission.
Existing charts, trading books, authentication and signals retain their own behavior.
AQTE does not disable or change any other module's independently configured execution.

### Reference-style frontend terminal

The current reference-style trade hero includes initial SL separately from the
broker-confirmed current/trailing stop, an open-P&L ring, targets, position quantity,
index chart, lifecycle, futures evidence, protection rules and a tabbed trade book.
**Book All** and **Exit Now** request an exit of the selected AQTE trade only, after
confirmation. Account-wide emergency liquidation remains a separate owner-authenticated
backend operation. The header's confirmed emergency reset only restores OFF.
The status payload includes generation time, executed/reserved counts, all today's
closed trades (not a truncated 20-trade day), and recent earlier exits. Unknown or
stale open marks never contribute a fictitious zero to today's P&L. Missing controller
state shows unverified positions/risk rather than a flat account or "Safe"; last-known
entry/stop levels survive disconnects. Breakeven trades are not counted as losses.

The one-lot/single-position execution limit is unchanged. Book 25%/50%/75% are
explicitly unavailable; T2/T3 have no invented prices. There is one full-position
target. Reaching it uses the executable sell bid, not LTP, and is not labelled an
exit fill. Buyer/seller figures are labelled futures depth shares. Live futures OI
and its change from the previous completed minute are reported only when supplied by Kite;
rule scores are not calibrated win probabilities. Seller-spike,
OI-drop, EMA/VWAP/RSI exit rules from the picture are not enabled or simulated.
Protective-management status is independent of the new-entry switch: OFF continues
existing stops/trailing/exit reconciliation. Cancelled stops and repriced LIMIT exits
are not presented as confirmed trigger-pending SL protection. The chart remains
underlying-index history, so option entry/SL levels are not plotted on its price scale.

This presentation is confined to the AQTE section. Other dashboard sections are
unchanged. Existing index/trade-book keyboard navigation, daily saves, ON
confirmation, emergency stop, manual-Kite read-only behavior and risk gates are
preserved.
The optional left-side Dashboard, Live Market, Analysis, Positions & P&L and Risk
Control shortcuts are not rendered. Their sidebar column is removed at every
viewport size; all corresponding content and trading controls remain available.

- The chart lazy-loads the existing `lightweight-charts` dependency and reuses
  `useChartHistory` and its shared request cache. Supported view-only frames are
  1m, 3m, 5m (default), 15m and 1h. Only the selected index chart is visible. Each chart
  mounts on first selection and stays cached for later tab switches. It reuses the already-connected index feed; no extra WebSocket
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
  show `--` with explanations. Open P&L is a quote-based estimate with estimated
  costs, never a forecast or execution promise.
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
pilot** now exists in `backend/services/aqte_live.py`, with owner-authenticated automation
in `frontend/components/AQTEAutomationSwitch.tsx` and status/selected-trade exits in
`frontend/components/AQTELiveController.tsx`. It remains disabled by default.
Scores are explainable rule scores, not calibrated ML probabilities. There are no
profitability or fill guarantees.

## Repository findings and reuse

### Manually purchased Kite positions

The trade book's Positions tab displays read-only Zerodha positions for the
selected index in the compact price, points/percentage and P&L layout.
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
be managed in Kite during normal operation. The selected-trade exit never touches
them; the separately confirmed account-wide emergency stop does close them.
This display does not approve or enable real automation.

- FastAPI lifespan owns a shared `MarketFeedService` and KiteTicker connection.
- Existing authentication saves the active daily Kite access token and reconnects
  the feed after token changes. AQTE does not create an app, alter credentials,
  change the redirect URL, implement another login or store tokens in its journal.
- Spot index packets have no exchange timestamp or tradable volume. AQTE explicitly
  uses receipt timestamps for spot freshness; derivative timestamps must come from Kite.
- AQTE consumes only KiteTicker packets. The dashboard's REST quote fallback keeps
  prices visible but never feeds AQTE, so signals stay WAIT ("Market data stale:
  futures last tick Ns ago") while it is active. During market hours the feed retries the WebSocket every 30s
  (longer during token-check backoff); ordinary `1006` network drops use KiteTicker's
  own reconnects, and only a rejected `403 Forbidden` handshake forces REST fallback.
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

Analysis uses **201 contiguous completed one-minute futures candles**, ending in the
minute immediately before the latest futures tick. The window continues across the
overnight close (previous session 15:29 → today 09:15 is not a gap), but any missing
intraday minute resets it. Signals also wait for an **opening range of 15 completed
one-minute candles from 09:15 IST**, so the first evaluation is at **09:30 IST**, and
VWAP uses today's candles only. Each signal reports `warmup` and `opening`
(`completed`/`required`). On restart the backend replays the previous session's last
~4.4 hours of recorded futures ticks; on weekdays from 09:00 it also fills missing
completed minutes from Kite `historical_data` (one-minute futures, last five days).
History never overwrites the forming minute or the latest two live minutes; if the
historical API is unavailable, warm-up continues from live ticks and retries every
five minutes.
It calculates SMA-seeded EMA 9/20/50/100/200, Wilder RSI/ATR,
SuperTrend, today's futures VWAP, relative volume, depth imbalance, range
breakouts, sweep/reclaim and market-structure proxies. CPR is contextual previous-day
**spot** CPR from the existing feed; it is not misrepresented as futures CPR or used
to place futures-derived stops. Missing contextual CPR stays null.

Strategies are momentum breakout, liquidity reversal, trend continuation and
mean reversion. Candidates opposed by book imbalance are discarded before selecting
the highest-scoring supported candidate. Output is BUY CE, BUY PE or WAIT with reasons.
There is **no LLM tick processing, synthetic option contract, fabricated quote or ML
order decision**. Optional LightGBM research predictions run separately in shadow
mode; the baseline still uses a conservative premium-distance stop.

The terminal labels this **Rule-Based Trade Engine**, not an ML model. Its empty-trade
card displays the current backend WAIT reason for the index's selected style
(Quick scalp or Swing), the warm-up and opening-range counts, and the last skipped
automatic-entry check. An older backend without counts still displays its WAIT reason.
The rule card uses the same `directional_checks` as automatic Scalp/Swing entry, not
frontend copies of thresholds. PASS means aligned with the selected **CE or PE** bias:
bearish EMA, below-VWAP price and sell-side depth can PASS a PE check. SuperTrend and
20-candle structure are labelled separately; neither alone is called the overall trend.
The indicator count is not a probability, nor approval to bypass contract, cost, risk,
validation or broker gates. Candidate scores are neutral, style-specific and hidden for WAIT.
The default card stays compact: SuperTrend, the selected style's EMA alignment,
VWAP, RSI, book imbalance, one-minute OI change, relative volume and the rule score.
One keyboard-accessible **Advanced details** disclosure is closed initially. It holds
full EMA values, raw OI/depth quantities and shares, candle/tick timestamps, structure,
breakout/ATR/CPR evidence and every entry requirement. All calculations and hidden
values keep updating while collapsed; expanding it changes presentation only.
The eight primary rows stay mounted during loading, stale evidence and reconnects;
unavailable readings become muted `--` placeholders rather than collapsing the card
or retaining stale numbers. Fixed row/value slots, tabular digits and 14px indicator
text prevent tick-driven reflow. Narrow cards stack each label and value, and expanded
details have a keyboard-scrollable fixed-height area. Only manual disclosure changes
expand or collapse the card. Green buy/bullish and rose sell/bearish text describe
direction; amber means waiting. Check icons separately show backend entry alignment:
sell pressure can have rose text and a green PASS icon for a PE setup.

`intelligence.live` preserves Kite's futures token, exchange/receipt times, LTP,
top-five queued buy/sell quantities and optional `oi`. Candle-derived EMA, RSI, ATR,
SuperTrend, VWAP and relative volume use **completed one-minute futures bars** and
show their close time separately from the live tick. Volume displays the completed
minute and prior-20-minute mean; a zero baseline is unavailable, not a fabricated 0x.
The reference for OI change is the same contract's immediately preceding completed
minute (`oi_reference_at` is that minute's close boundary), never the first tick or a
different expiry/session. A missing current OI, missing reference, zero reference and
measured zero change remain distinct. Older journals without OI still load; live
ticks establish a reference after a minute closes. OI is informational futures data,
not a substitute for validated option-chain OI/PCR/Greeks and not a new entry/exit trigger.

Snapshots include `rule_checks` for both styles and clear them on stale spot/futures
data. The UI checks the per-index `feed_ready` flag and signal/tick ages (five seconds),
validates all indicator fields and check IDs, and ages the display every second even
while a poll is pending. Missing freshness metadata from an older backend is explicitly
unverified, not LIVE. Missing/stale controller style never falls back to the other
strategy's score. Expand **Advanced details** to see every execution threshold.
No fake entry, LTP, stop or trailing price is filled in before a real AQTE order exists.
Installed libraries do not imply inference is connected: the separate QuantEdge
LightGBM/NumPy classifiers predict underlying direction, not a validated AQTE
option-entry outcome. They are not silently substituted for this strategy. A trained
AQTE model requires a defined target/features contract, leakage-safe out-of-sample
evaluation including costs, calibration and explicit approval before live integration.

### Optional Python ML research (shadow only)

`backend/services/aqte_ml.py` defines a dedicated AQTE feature/target contract.
`backend/services/aqte_ml_training.py` trains a **LightGBM binary classifier**, using
NumPy for arrays and evaluation. These are already declared dependencies. It does
not reuse the unrelated QuantEdge underlying-direction models or add TensorFlow,
PyTorch, an LLM, or default-valued synthetic market inputs.

**Target:** positive estimated net option return **300 seconds after an observed
hypothetical one-lot no-chase fill**, conditional on such a fill. This is not the
probability that an order fills, hits its target, or wins under live stop/trailing
management. Predictions are explicitly **uncalibrated and unvalidated**.

- Replay uses the existing rule engine in analysis-only mode. No broker client,
  network requests, real orders or training on the live event loop.
- Sample at most the first qualifying candidate per index/completed candle.
  The same feature extractor is used offline and in runtime shadow inference.
- Features include index/option side, EMA differences, RSI/ATR, futures VWAP
  distance, SuperTrend, relative volume, imbalance, breakout/sweep, actual
  premium/spread/depth, moneyness, expiry and time of session.
  Missing, non-finite, stale or future-dated evidence is rejected, not imputed.
- Label only a **later** quote offering at least a lot, with ask plus one adverse
  tick at or below the original midpoint limit and strictly before the existing
  30-second expiry. Spot/futures and the entry session must still be valid.
  A gap below the original stop cancels the hypothetical entry.
- Require valid continuous option quotes with no gap over five seconds from
  candidate through the five-minute exit; require one-lot bid depth too.
  Deduct one tick of exit slippage and existing Policy cost estimates.
  An unfilled candidate, missing exit, stale quote or data gap is **censored**,
  never relabelled as a loss, a win, or a forced fill.
- New journals preserve contract metadata by IST session/token in
  `aqte_contract_history`. Old journals without dated metadata are rejected:
  today's catalog cannot reliably describe historical reused option tokens.
  Historical CPR/OI/Greeks are not reconstructed or fabricated.
- Training needs **six labelled sessions, at least 200 training and 50 holdout
  samples, and both outcome classes in each partition**. The newest two sessions
  are held out in full; training labels must end at least five minutes before
  holdout starts. Model settings are fixed; no holdout tuning, early stopping,
  random row split, or refit on test labels.
- Evaluation reports log loss, Brier score, threshold accuracy, per-index metrics
  and a constant training-base-rate benchmark. Overlapping labels within sessions
  remain correlated. Minimum sample counts and beating this baseline are plumbing
  gates, **not statistical proof or permission to trade**.

#### Collect and train offline

Raw ticks expire after seven days. Six labelled trading sessions generally require
multiple **complete, consistent SQLite backups** taken before retention expires.
Use SQLite's online backup facility (including its WAL state), not a plain copy of
an active database. Keep backups locally/privately; do not upload account journals.
The trainer accepts multiple backups, deduplicates identical observations and
rejects conflicting overlaps. Missing older metadata is not backfilled from today.

Windows example, from `backend` (replace paths/dates with your actual backups):

```powershell
& ..\.venv\Scripts\python.exe -m services.aqte_ml_training `
  --db .\archive\week-1.sqlite3 .\archive\week-2.sqlite3 `
  --from-day 2026-10-19 --to-day 2026-10-30 `
  --max-ticks 2000000 --output-dir .\data\aqte-ml\research-001
```

The tick cap applies per input backup. Databases are opened **read-only**.
Insufficient data exits nonzero without producing a model. The output directory
must be new; existing research results are never overwritten. `model.json` holds
LightGBM text (not pickle), feature/target schema, checksum, covered indices and
the chronological evaluation report. Archive it with its source dataset and code
revision. Synthetic unit-test fixtures verify mechanics only; they are not an
approved model and are never installed as a runtime artifact.

#### Observe without changing orders

ML is **disabled by default**. After reviewing a real-data research artifact, set
only this backend setting to its readable local/container path, then restart the
backend:

```dotenv
AQTE_ML_SHADOW_MODEL_PATH=/app/data/aqte-ml/research-001/model.json
```

For Windows, use an absolute Windows path instead. In shared-production mode the
setting belongs on the single production backend, **not** a second local live
controller. Training does not change this setting, deploy code, approve a model,
arm automation, enable indices or switch Auto Trade ON.

The existing analysis snapshot exposes a separate `ml` object:
`DISABLED`, `READY` (artifact loaded, waiting for candidates), or `UNAVAILABLE`,
plus timestamped last `observations` per index. Each probability is a **historical
shadow observation** with its candidate time/token, not a fresh order signal or
win-rate display. Index/option-side combinations absent from training have no prediction. A missing,
corrupt or incompatible artifact produces an explicit unavailable status, never
a fabricated 50% probability. Observations at or before the artifact's holdout
end are rejected to prevent applying a future-trained model to earlier evidence.
Training/holdout end timestamps accompany each prediction so model age is visible.

Inference uses one LightGBM thread in a background task. The feed worker only
captures a bounded copy of the first candidate per index/candle; prediction and
audit writes run outside its lock. Results append to `aqte-ml-shadow.jsonl` beside
the AQTE journal (retain/rotate it as an audit file). Scoring or audit-write failure
is logged and surfaced separately, without faulting the live recorder.

**There is no live ML filter or automatic promotion in this version.**
`decision`, rule `confidence`, `model_validated`, daily controls, the 201-candle
warm-up, price limits, stop/target logic and all broker gates are unchanged.
No prediction can authorize or veto an order. Any future live filter requires a
separate implementation, independent forward validation/calibration including
realistic costs and exits, and explicit risk approval. No model guarantees profits.

### 12 strategy engines (advisory ranking and veto)

`backend/services/aqte_engines.py` evaluates 12 read-only engines on every snapshot,
from the same locked state the rules use: Momentum, Breakout, Trend Following,
Liquidity Sweep, Order Flow, Scalping (reuses the live scalp rule checks), Mean
Reversion, Volatility Breakout, Options Intelligence, Multi-Timeframe, Statistical
Arbitrage and ML Prediction. Inputs are only live Kite data already subscribed by
AQTE: futures 1-minute candles and ticks (depth, best bid/ask queues, OI change), spot,
the nearest-expiry ATM±1 CE/PE quotes and India VIX (`NSE:INDIA VIX`, token resolved
daily with `kite.ltp`, stale after 15 s).

- Each rule is PASS, FAIL, or null (no evidence). An engine is **Satisfied** when every
  rule passes, **Partial** at ≥ 50%, **Monitoring** while any input is missing, otherwise
  **Not satisfied**. A stale feed or closed market shows all 12 as Monitoring with the reason.
- Options Intelligence computes Black-Scholes IV (bisection on the live premium) and
  delta, gamma, theta/day and vega/1% with `AQTE_RISK_FREE_RATE`; PCR is put OI ÷ call
  OI over the **subscribed strikes only** and is unavailable unless both sides report OI.
- Context: regime from EMA stack + SuperTrend; volatility from VIX (< 13 Low, < 20
  Moderate, else High); liquidity from the worse ATM spread (≤ 1% High, ≤ 3% Moderate).
- ML Prediction is the existing shadow model; it is displayed but never votes.

**Authority.** Order authority is unchanged: only the validated Scalp/Swing rules,
daily controls and risk gates can produce an entry, and only the single live
controller (`aqte_live.py`) places orders. The engines can (1) rank which index's
qualifying entry is taken first (actionable, then aligned satisfied engines, then rule
score) and (2) veto an entry when at least `AQTE_ENGINE_VETO_MIN` satisfied engines
oppose it and outnumber those aligned (`AQTE_ENGINE_VETO=false` disables the veto).
They never approve or create an order. An engine failure is logged once and leaves the
rule snapshot and entries unaffected.

The dashboard's engine deck (inside the existing AQTE section) shows the 12 cards with
filters and per-rule evidence on demand, the market context strip, the controller's top
ranked opportunity with its exact block reason, an orchestration and risk checklist
from live controller state, and engine status-change events.

Note: `market_feed.py` still maps INDIAVIX to token 256170, which publishes no ticks;
AQTE subscribes the verified token separately and ignores non-AQTE index ticks.

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
| Per-trade maximum planned risk including estimated costs | 0.5% of paper equity (paper mode only; live uses `AQTE_LIVE_RISK_PER_TRADE`) |
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
Recorded futures ticks (today plus the previous session's tail) rebuild candles **without
replaying trades or filling orders against past quotes**, and Kite one-minute history
fills missing completed minutes when available. A new installation with no history
access must warm up for 201 completed live minutes. Missing
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
secrets or order permissions are changed by recording this address. For the
DigitalOcean deployment, set `AQTE_LIVE_STATIC_IP` to the droplet's measured outbound
IPv4 and add that address to Kite as well (see **Production checklist** below).

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
The compact Auto Trade pill uses a green track only for confirmed ON, a neutral
OFF track, an explicitly UNKNOWN state on failure, and a red emergency state.
ON/OFF actions are automatically journalled by the existing backend.
Page refresh restores the authoritative state using GET only, never by replaying
an ON request or trusting local storage. A saved/confirmed acknowledgement is
shown only after a successful response; unknown outcomes remain explicit.
Backend restarts and session rollover disarm the session but keep a standing ON,
which re-arms through a fresh preflight in the next entry window; safety stops
re-arm only after a one-minute delay and never over an open AQTE trade.
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
- New installations start **OFF**. Once switched ON, Auto Trade stays ON (restarts
  and new days included) until OFF, a manual exit or an emergency stop.
- Preflight (IP/Kite/flat account) and daily arming run automatically inside each
  weekday entry window; outside it ON simply waits.
- Click the header switch, then **Confirm ON · real money**. This authorizes automatic
  qualifying real entries without per-order approval, using all existing entry checks.
- **OFF blocks new entry orders**, invalidates prepared proposals, and retains broker
  protection, trailing stops, target/stop exits and reconciliation for existing trades.
- Already submitted or in-flight broker orders cannot be undone by changing a switch.
  ON/OFF and submissions are serialized; wait for acknowledged OFF, not a local click.
- A new day, shutdown/restart or monitoring fault disarms the session; a standing ON
  re-arms with a fresh preflight. Emergency stop and manual exit clear ON.
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
  retain their captured protection settings. The `AQTE_LIVE_RISK_PER_TRADE` one-lot
  ceiling (default INR 1,000, maximum 2,000),
  account loss ceiling, cash, broker, stale-data and one-position guards still apply.
  Planned reward/risk is recomputed after estimated fees and must be at least 1.5.
- **Entry style** per index: **Quick scalp** (default) or **Swing**. SL % and target
  multiple apply to Swing; trailing applies to both. Style can only change while OFF.
  Saved preferences from before the style field keep **Swing** on upgrade; they
  never silently switch a standing live ON request to a different strategy.
  Select Quick scalp explicitly while OFF to change an existing index.
- Eligible indices are considered in descending score order; weak, sideways,
  incomplete or unvalidated evidence never becomes a forced trade.

#### Quick scalp (10 / 20 / 30 points)

A separate rules engine produces a quick-scalp sub-signal on every completed candle
(`signal.scalp`). It targets fixed **option-premium points** per index from
`AQTE_SCALP_POINTS` (default NIFTY 10/20/30, BANKNIFTY 20/40/60, SENSEX 30/60/90);
the stop is `points x AQTE_SCALP_STOP_RATIO` (default 0.4, i.e. 4/8/12 for NIFTY).

Rules (all required, futures 1-minute):

- Bias: price above VWAP **and** EMA 9 above EMA 20 for CE (both below for PE).
- SuperTrend aligned; RSI 55-80 (CE) or 20-45 (PE).
- Fresh 20-candle breakout in the same direction with volume at least 1.5x.
- Order-book imbalance at least 0.10 in the trade direction.
- No chasing: price within 2 ATR of EMA 20.

Tier selection: strength 1 allows only the first tier. Strength 2 (EMA 20/50 aligned,
volume 2x, imbalance 0.2) allows two tiers. Strength 3 (full EMA stack, volume 2.5x,
close beyond CPR, HH/LL structure) allows all three. A heuristic reach filter requires
points <= 0.5 assumed ATM delta x 4 x futures ATR. This is not a measured option
Greek or a prediction that the target will be reached. Invalid premium/stop tiers
fall through to smaller eligible tiers. The live controller then picks the
**largest allowed tier whose one-lot risk fits `AQTE_LIVE_RISK_PER_TRADE`** with net
reward/risk >= 1.5 after costs. Example with a INR 101 NIFTY premium and a 65 lot:
30 points (SL 89 / target 131) costs about INR 839 of risk; at a INR 500 cap it shrinks
to 10 points (SL 97 / target 111, about INR 319). Rule score is 70/75/80 by tier
count; it is not a win probability.
Confirmation uses the freshly rechecked tier, stop and target and cannot increase
the original approved price cap or planned risk. A weaker setup or reduced risk
limit cannot submit an obsolete larger tier.

With `AQTE_LIVE_ALLOW_UNVALIDATED_RULES=true`, a quick-scalp entry passes the quality
gate when the scalp rules still hold at submission; strict mode blocks it like every
unvalidated rule. Scalp entries use the same IOC, broker stop, target-modify,
trailing (from +1R), 15:25 session exit and daily limits as Swing.

**Important current limitation:** these controls do not train or validate a predictive
model. The existing rule baseline tops out at 80, is unvalidated and cannot pass the
minimum 90. Validated option-chain OI/PCR/Greeks and liquidity-sweep confirmation are
**not implemented**. In the default **strict** mode their absence is an explicit final
blocker, so Auto Trade ON scans but never places an entry.

`AQTE_LIVE_ALLOW_UNVALIDATED_RULES=true` is a separate, default-off owner opt-in for
real money. It skips only the minimum rule score, model-validation and missing
option-chain blockers. Every Swing entry must still pass directional EMA 9/20/50/100/200,
VWAP, SuperTrend, RSI band, CPR, volume (at least 1.5x), order-flow imbalance (at least
0.15), breakout and structure checks, plus all risk, broker and one-position guards.
A non-numeric score always blocks. The ON confirmation and `GET /api/aqte/live/status`
(`unvalidated_rules`) report the active mode.
Quick scalp instead requires all of the scalp checks listed above. LightGBM is
installed for the separate, optional shadow research pipeline; it neither approves
these entries nor has a validated quick-scalp model. Installing more ML libraries
does not provide a trained model, reliable execution or profitable signals.

Even with the opt-in, entries are selective by design:

- Analysis needs 201 contiguous completed one-minute futures candles (carried over from
  the previous session) plus 15 opening candles, so the earliest signal is
  **09:30 IST**. Restart replay and Kite history backfill restore the window; a
  brand-new install without history access needs about 3.4 hours of live data.
- In paper mode the engine only emits BUY when one lot of the nearest-strike option fits
  about INR 500 of risk (0.5% of its INR 100,000 paper capital). In production
  ANALYSIS_ONLY mode that paper budget does not apply: the signal is emitted and the
  live proposal alone sizes it against `AQTE_LIVE_RISK_PER_TRADE` (default INR 1,000).
  Swing risk is premium x lot size x SL% + costs; at a 20% SL and a 65-unit NIFTY lot
  that allows a premium of about INR 73. Quick scalp shrinks its tier instead.
  Blocked setups are logged as "One lot exceeds live per-trade risk limit" or
  "No quick-scalp tier fits..."; the cap is never raised automatically.

A rule score is not a calibrated win probability; none of these checks guarantee
profitable trades or execution.

The centralized settings are in `backend/config/__init__.py`; environment overrides
are documented in `backend/.env.production.example`. The built-in static IP default is
`122.177.245.101` (a local workstation); production must set the droplet's outbound
IPv4. Development did not change your private environment or submit orders.

```dotenv
AQTE_LIVE_ENABLED=false
AQTE_LIVE_PAPER_VALIDATED=false
AQTE_LIVE_STATIC_IP=159.65.147.167
AQTE_LIVE_ALLOW_UNVALIDATED_RULES=false
AQTE_LIVE_RISK_PER_TRADE=1000
AQTE_LIVE_DAILY_LOSS=2000
AQTE_LIVE_MAX_TRADES=5
AQTE_LIVE_MAX_LOSSES=3
AQTE_SCALP_POINTS=NIFTY:10/20/30,BANKNIFTY:20/40/60,SENSEX:30/60/90
AQTE_SCALP_STOP_RATIO=0.4
AQTE_ENGINE_VETO=true
AQTE_ENGINE_VETO_MIN=2
AQTE_RISK_FREE_RATE=0.065
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

The signed-in configured app owner, at any time (market open or closed):

1. Clicks the header **Auto Trade** switch and **Confirm ON · real money**.
2. Inside weekday 09:15–15:15 IST the backend runs the static-IP, Kite profile and
   flat-account preflight and arms the current session; outside those hours, or if a
   check fails, ON stays saved with the reason shown and retries automatically.
3. The monitor consumes qualifying signals automatically through the same short-lived,
   server-generated proposal and broker revalidation path; no individual BUY click is needed.

### Production checklist (DigitalOcean)

Live automation runs only where the backend's outbound IPv4 is in the Kite allowlist.
Use one trading host: disable live trading locally (`AQTE_LIVE_ENABLED=false`) once
production is live.

**Keep production configuration outside the Git checkout.** Compose accepts
`BACKEND_ENV_FILE` for both its startup environment and the writable token-watcher
mount. For example, copy the existing server settings once to a host-only file,
restrict its permissions, and use it for deployment:

```bash
cd /root/mytradingSignal
test -f /root/mytradingSignal.runtime.env || cp backend/.env /root/mytradingSignal.runtime.env
chmod 600 /root/mytradingSignal.runtime.env
export BACKEND_ENV_FILE=/root/mytradingSignal.runtime.env
git pull --ff-only origin main
bash deploy_digitalocean.sh
```

Never copy the local development settings over this file. Export the same
`BACKEND_ENV_FILE` for every subsequent Compose/deploy command. Without it,
`backend/.env` remains the backward-compatible default. Both deployment wrappers
validate the selected file before rebuilding. A Git push alone does **not** deploy
or restart production; a successful deployment still needs fresh AQTE futures,
spot and option data, owner/broker authentication, and all execution gates.

1. **Kite Connect app:** add the droplet IPv4 (for example `159.65.147.167`) to the
   developer profile IP whitelist and set the redirect URL to
   `https://mydailytradesignals.com/api/auth/callback`. Kite accepts one redirect URL
   per app, so production login and local login conflict.
2. **Server runtime env file** (never uploaded by the deploy scripts): production
   `FRONTEND_URL`, `REDIRECT_URL` and `CORS_ORIGINS`; `APP_ACCESS_USERNAME` and
   `APP_ACCESS_PASSWORD_HASH`; `AQTE_LIVE_ENABLED=true`, `AQTE_LIVE_PAPER_VALIDATED=true`,
   `AQTE_LIVE_STATIC_IP=<droplet IPv4>`, `FORCE_OUTBOUND_IPV4=true`; Smart AI Algo not
   in live mode; no proxy variables. Set `AQTE_LIVE_ALLOW_UNVALIDATED_RULES=true` only
   if you accept unvalidated real-money entries; otherwise ON only scans.
3. **Verify egress** on the server: `curl -4 https://api.ipify.org` must print the
   same IPv4 as `AQTE_LIVE_STATIC_IP`. `bash scripts/check-production-env.sh` reports
   localhost URLs, missing approvals and IP mismatches without printing secrets.
4. **Deploy:** `scripts/deploy-to-do.ps1 <droplet-ip>` uploads a checked source archive
   that excludes `.env*`, the Kite token and runtime data, and `deploy_digitalocean.sh`
   uses `git pull`. Both run the settings check and stop before rebuilding on errors.
   After editing `backend/.env`, recreate the backend:
   `docker compose -f docker-compose.prod.yml up -d backend` (a plain restart keeps
   the old environment).
5. **Each trading day:** complete the Kite login on the production site (the Kite token
   expires daily; until then ON waits with a token error), keep the desired indices
   enabled in the Real tab controls (they default to disabled and are stored in the
   production journal). Auto Trade can be switched ON any time; it stays ON and arms
   itself from 09:15 IST.
   Production has its own journal; reset an emergency latch there only once Kite is flat.

### Local UI and production sharing real execution

Use this mode to test local frontend changes against the **same production account,
orders, Auto Trade switch, controls and risk limits**. It does not test local backend
changes and is not an isolated test account: ON, OFF, exits and Emergency Stop from
either dashboard affect the same real production account.

1. Keep Kite's production whitelist IP and callback unchanged. The local public IP
   is irrelevant because only the production backend sends broker orders.
2. In local `backend/.env`, keep `AQTE_LIVE_ENABLED=false`. Do not run a second live
   controller. If the local journal has an open trade, reconcile it before stopping
   the local backend; otherwise the local backend is not needed for this mode.
3. Set these values in local `frontend/.env.local`, then restart `npm run dev`:

   ```dotenv
   NEXT_PUBLIC_SHARED_PRODUCTION=true
   DEV_PRODUCTION_ORIGIN=https://mydailytradesignals.com
   ```

   This development-only mode overrides the ordinary API/WS URLs. The Next.js server
   proxies `/api/*` and `/ws/*` over HTTPS to production, before local API routes
   can run. This includes feeds that use fixed same-origin paths.
   Chart, strike and regime feeds cannot fall back to a local backend in this mode.
   Production builds ignore the flag. The switch shows **Shared production · REAL ORDERS**.
4. On the **production server**, append the exact local browser origins to the existing
   `CORS_ORIGINS` list (retain any other trusted origins):

   ```dotenv
   CORS_ORIGINS=https://mydailytradesignals.com,http://localhost:3000,http://127.0.0.1:3000
   ```

   Keep `FRONTEND_URL` and `REDIRECT_URL` pointing at production and keep `DEBUG=false`.
   Recreate the backend from the deployment directory:
   `docker compose -f docker-compose.prod.yml up -d --force-recreate backend`.
   The proxy preserves Origin; it does not bypass the owner/origin guard. Until the
   server explicitly allows localhost, live controls return `403 Untrusted live-control origin`.
   Only trust local origins while using trusted local software, and remove them when
   shared testing is finished. Never use a wildcard origin.
5. Open `http://localhost:3000` and sign in using the **production app-access credentials**.
   Sign in separately on the production dashboard. Sessions remain device-bound;
   no cookies, credentials or Kite tokens are copied between installations.
   The same-origin proxy avoids cross-site cookie blocking and retains Secure/HttpOnly
   cookie attributes; use a current browser with localhost secure-cookie support.
   If production has `APP_ACCESS_SINGLE_DEVICE=true`, a second origin has a different
   device ID and may be locked out. Deliberately set it to `false` on the server only
   if concurrent dashboard sessions are intended, then recreate the backend.
6. Perform daily Kite login on the production site, using its existing callback.
   The local dashboard reads the resulting production auth/feed state. An expired
   production Kite token still blocks trades; local login cannot override broker checks.

Verify the production status in both dashboards before enabling any real orders.
Do not turn ON merely to test connectivity. To return to independent local development,
set `NEXT_PUBLIC_SHARED_PRODUCTION=false` and restart the frontend, leaving local live
execution disabled until an intentional, separately reviewed host handover.

Automatic entries are permitted **only while ON and armed**. The controller does not trust browser prices or quantity.
It rechecks settings, IP, account identity, flat account, current signal, timestamp,
spread/depth, cash, one-lot quantity, risk budget and cutoff before submission.
One pending/open live trade is allowed across all indices; planned risk is capped at
`AQTE_LIVE_RISK_PER_TRADE` (default INR 1,000) including estimated costs, with daily limits of INR 2,000, five filled trades
and three consecutive losses. Those are planned limits, not guarantees against gaps.

The entry is a no-chase **IOC LIMIT** priced at the signal's **ask** (marketable now),
never above it; a fresh broker ask above that limit skips the entry. Paper replay alone
rests at the midpoint. Transient skips (quote moved, stale for a moment, approval
expired, levels changed) keep Auto Trade ON and armed, are shown as the last entry check,
and retry that index after 5 seconds; they never consume the strategy candle.
The broker-reported actual
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
(a standing ON re-arms through a fresh preflight)
but preserves active order identities and reconciles protection. Previous-session
unresolved trades, rejected/cancelled stops and manual position changes block automation
and require broker-terminal reconciliation.

### Selected trade exit / Book All

`POST /api/aqte/live/exit` requires the captured 16-character AQTE `trade_id` and
`{"confirmation":"CLOSE SELECTED AQTE TRADE"}`. The controller rejects changed,
missing, unfilled or previous-session trades and emergency-latched sessions.
It durably records the request and pauses new entries without setting the emergency
latch. The normal monitor rechecks broker account, order identity and remaining
quantity, then reprices only that trade's existing protective SELL to a marketable
LIMIT. It never creates a competing exit, closes another position, or cancels manual
orders. Stale quotes retain the stop and surface an explicit warning; uncertain
modifications must reconcile before another mutation. Requests survive restart;
an acknowledgement is not a fill guarantee. The confirmation keeps the original
trade identity even when tabs/polls change, traps keyboard focus and supports Escape.

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
| GET | `/api/aqte/live/status` | Generation time, readiness, limits, executed/reserved counts, real order status, today's exits and recent history |
| GET | `/api/aqte/live/daily-controls` | Owner-only saved index settings, IST executed/reserved counts and quality blockers |
| POST | `/api/aqte/live/daily-controls` | Save `{"symbol":"NIFTY","config":{...}}` while OFF; strict `IndexControl` schema; no broker mutation |
| POST | `/api/aqte/live/daily-limit` | Save `{"symbol":"NIFTY","max_trades":3}` while ON or OFF; only the 1–10 entry cap changes, never lot size or protection |
| POST | `/api/aqte/live/preflight` | Verify direct outbound IPv4 and existing Kite account |
| POST | `/api/aqte/live/arm` | Body `{"confirmation":"ARM REAL TRADING"}` |
| POST | `/api/aqte/live/automation` | `{"enabled":true,"confirmation":"START AUTOMATED REAL TRADING"}` or `{"enabled":false,"confirmation":"STOP NEW ENTRIES"}` |
| POST | `/api/aqte/live/start` | Confirmed ON: preflight/arm if needed, then enable scanning under existing gates |
| POST | `/api/aqte/live/proposal` | Compatibility/internal proposal path; blocked while OFF |
| POST | `/api/aqte/live/confirm` | Compatibility confirmation path; blocked while OFF and still subject to all risk checks |
| POST | `/api/aqte/live/exit` | Pause new entries and request only the confirmed, identified AQTE trade's exit |
| POST | `/api/aqte/live/stop` | Latch account-wide emergency, cancel open Kite orders and square off all Kite positions |

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
