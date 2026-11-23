# 📈 MyDailyTradingSignals

Real-time trading dashboard for NIFTY, BANKNIFTY, and SENSEX with Zerodha Kite API integration.

**AQTE - Adaptive Quantitative Trading Engine** adds compact NIFTY / BANK NIFTY /
SENSEX section above the charts. Its backend-only, explainable rule baseline uses fresh option
quotes, conservative limit entries, risk checks and a durable journal. There is no paper or
simulated trading: every order is a real Zerodha order placed by the Real Trade controller, which
supports explicitly armed, one-lot broker orders with static-IP preflight, fill reconciliation and
protective stops; live enablement and validation flags default to false. Its header automation switch defaults
OFF; ON authorizes automatic qualifying entries after daily arming, without per-order approval.
OFF blocks new entries while existing broker protection, trailing stops and exits continue.
The compact Auto Trade pill shows backend-confirmed state; unavailable status never
masquerades as OFF. Book All / Exit Now confirm and close only the selected AQTE trade,
separately from the account-wide emergency stop. The one-lot limit remains: percentage
booking and extra staged targets are explicitly unavailable, not simulated.
It does not claim validated ML predictions: by default the live quality gate blocks every
entry, and only the owner opt-in `AQTE_LIVE_ALLOW_UNVALIDATED_RULES=true` lets fully aligned
rule setups place real one-lot orders.
See [AQTE architecture,
APIs, storage, validation and staged rollout](docs/AQTE.md).

**QuantumEdge IntraDay** uses completed-candle Python rules and Claude Haiku
before submitting a qualifying order through the shared Zerodha controller.
The positions and realized P&L in this panel are QuantumEdge-only. A completed
manual Kite trade does not count toward QuantumEdge limits or block a new
signal. Open manual exposure or working orders exclude only that contract
from selection; broker cash and margin checks still apply.
QuantumEdge IntraDay can hold one position per index, up to three total;
other automated strategy lanes remain mutually exclusive with QuantumEdge.
Open QuantumEdge risk is reserved against its existing daily loss budget.
The per-index risk cap does not override the separate ₹1,500 QuantumEdge daily
loss budget. The advanced strike selector is opt-in with
`QUANTUMEDGE_ADVANCED_STRIKE_SELECTION=true`; unset or false preserves the
existing picker. When enabled, it scores fresh subscribed contracts on the
nearest expiry: 40% spot distance, 25% relative spread, 20% two-sided depth,
10% volume rank and 5% open-interest rank. Missing open interest is neutral,
not a blocker. Normal-day candidates must be within two observed strike
intervals of spot; on expiry day they must be within one, keeping selection
near ATM. Contracts must also pass quantity, spread, risk and cost-adjusted
reward/risk checks. If one fails, the next-ranked same-expiry strike is checked.
It sends only a qualifying contract to Claude; approval is not transferable
between strikes. `AI_APPROVED` is not a broker order;
`ENTRY_BLOCKED` shows the execution check that prevented submission. The live
opportunities panel and Claude review use the same
completed one-minute futures price-action context: breaks of the prior
five-bar range, ATR-relative displacement, and the most recent open fair
value gap detected in the lookback. Missing or stale context is not treated
as confirmation. These observations are not a separate entry gate and do
not override risk controls. `AI_UNAVAILABLE` means no usable Claude decision
was received; it does not approve an entry.
The experimental `quantumedge_shadow_fvg` helper is research-only and is not
connected to live signals, orders, or shadow logging. Its results are not a
complete SMC entry filter; `history_ready=false` means the latest contiguous
candle history is insufficient to evaluate it.
The separate price-action stop is opt-in with
`QUANTUMEDGE_PRICE_ACTION_STOP=true`; unset or false preserves the existing
execution behavior. When enabled, new entries require 16 contiguous completed
one-minute futures candles. For CE trades, the invalidation is below a recent
swing low by 0.25 ATR; for PE trades, it is above a recent swing high by
0.25 ATR. A subsequent completed futures candle must close beyond that level
in the opposing direction and beyond the previous candle close to trigger an
exit. The existing option-premium broker stop remains the hard-loss protection;
the futures level is shown separately in the active card. The controller
modifies that trade's existing protective sell order for an exit rather than
placing a competing order. If the futures feed becomes unavailable, the card
reports it while the broker stop remains active. A stop cannot guarantee that
it will not be hit or that a trade will be profitable.
The separate smart trailing mode is opt-in with
`QUANTUMEDGE_SMART_TRAILING_STOP=true` and applies only to new QuantumEdge
positions opened while enabled. It keeps the initial broker stop, moves to
estimated fee-adjusted breakeven after +1R, then allows a further half-R
breakeven phase before using nine contiguous, fresh one-minute option candles
to calculate ATR and a confirmed three-candle premium swing low. It combines
the lower of peak-minus-`max(1.5 × ATR, 0.75R)` and the confirmed swing low
minus 0.25 ATR, then floors the stop at estimated breakeven plus 25% of gains
beyond the initial 1R trigger. The stop only ratchets upward. If candles are unavailable,
stale or discontinuous, the existing R-multiple trailing logic remains the
fallback. The controller still modifies the same protective sell order and
respects Kite's order modification limit. This mode does not guarantee a fill
at the stop price or profit; gaps, slippage and reversals can still cause losses.
Python computes the estimated INR loss at the stop and net profit at the
target for the full quantity. Claude receives the gross amounts and
estimated costs for each leg, rather than recalculating risk from the
per-unit premiums. Haiku 5.5 uses low effort, thinking disabled, and a
structured verdict; unfinished or invalid replies cannot approve a trade.
Live Opportunities refreshes in place with fixed-height rows. On narrow
screens the fields stack; long status details can be scrolled inside each row.
Active Trade shows the option LTP from the same status snapshot as the live
positions table. The stop-to-target bar marks that LTP, not the fixed entry
price. P&L is green for profits, red for losses, and neutral for
zero or unavailable values. QuantumEdge requests status every second while
a position is open and every three seconds otherwise, without overlapping
requests. Actual option quote freshness depends on the market feed.
Algo Positions shows individually bordered summary cards for realized P&L, open P&L,
and open position count. Open P&L is unavailable if an open position has
no broker mark, rather than showing a partial total.
Each live position value has its own bordered cell. The table scrolls
horizontally on narrow screens.

With Master Trade enabled, any one of the 14 strategies in
[the QuantumEdge strategy registry](backend/services/quantumedge_strategies.py)
can qualify for contract checks and Claude review. The registry order
breaks ties for the same direction; opposing matches stand aside. Signals
use completed candles, including closed 5m/15m bars for trend alignment.
Prior-day, CPR and Camarilla breakouts use aligned spot candles and
dated previous-session spot OHLC, not futures prices. The order-flow
rule uses signed candle volume as a proxy, not aggressor-side trade delta.
The strategy is tied to
the approval and checked again before order submission. The same candle,
contract and quantity can use a lower rechecked entry limit if estimated
risk does not increase and all live checks still pass. Higher prices or
risk are blocked. A normal Claude rejection appears on the affected
opportunity rather than as an engine error. The selected
setup appears in Live Opportunities. The shortlist is not a win-rate
ranking; it has not been validated for profitability.
The scanner tries the first approved setup immediately instead of waiting
for reviews on the remaining indices. It still rechecks the entry window,
contract and risk before submitting. Review and final confirmation times
are recorded separately in the AQTE latency diagnostics.

It can also require a QuantumEdge-specific LightGBM veto check:

- `QUANTUMEDGE_ML_MODE=off` (default): preserve rules + Claude behavior.
- `QUANTUMEDGE_ML_MODE=shadow`: show the score without affecting orders.
- `QUANTUMEDGE_ML_MODE=gate`: require Python rules, LightGBM and Claude to agree.
  An unavailable, stale or unsupported model blocks new QuantumEdge entries.
  The expanded strategy set requires a v4 artifact and 21 fresh bars for
  ML features. The three prior-session spot-level rules cannot pass the
  ML gate because historical spot OHLC is not available in the tick replay.

Train offline from complete, dated Kite tick journal backups using the backend
environment. From `backend` in PowerShell, for example:

```powershell
..\.venv\Scripts\python.exe -m services.quantumedge_ml_training --db C:\backups\aqte.sqlite3 --from-day YYYY-MM-DD --to-day YYYY-MM-DD --max-ticks 3000000 --output C:\backups\quantumedge-model.json
```

The replay needs at least six labelled historical IST sessions (newest two held
out), 200 training observations and 50 holdout observations. It tests a
predefined 0.60 score threshold and reports which index/option sides pass the
holdout checks. The score is not a calibrated probability. Replay models
one-lot setups with a ₹1,000 risk cap and a cost-adjusted five-minute exit, not
actual broker fills, stop/trailing performance or profitability. Review the
report in shadow mode first. For production, store the artifact under the
persistent AQTE volume and set
`QUANTUMEDGE_ML_MODEL_PATH=data/aqte/quantumedge-model.json`. Relative paths are
resolved from the backend root on both local Windows runs and Linux containers;
absolute paths remain supported. Restart the backend and check the dashboard's
ML status before manually approving live trading.

**Strategy Workspace** groups MarketEdge Intelligence, Trend Base (Higher-Low Structure),
Expiry Explosion Zone, and CRT-Based BTST Strategies into four section tabs. The selector uses
two columns on phones/iPads and four on desktop, consistent sans-serif typography, readable
12px minimum small text, and 48px minimum touch targets. All panels remain mounted for live
updates and state preservation. Trend Base and BTST include independent index tabs.

**Market Analysis** combines Advanced SMC & Market Structure, Greeks Overview, Today's Market
Regime, Volume Pulse, ICT Bias, and Institutional Compass into six section tabs. Only one section
is visible; all stay mounted to preserve live updates and nested index selections. The selector
uses two columns on phones, three on tablets, and six on wide desktops, with keyboard navigation
and 48px minimum touch targets. Volume Pulse now also has NIFTY / BANKNIFTY / SENSEX index tabs.

**Institutional Flow** contains FII/DII Flow and Official Cash Flow. The NIFTY / BANKNIFTY /
SENSEX selector controls the index-specific view; Official Cash Flow is market-wide, so its
reporting date is shown without an index selector. Per-index flow figures are estimates, not
official transactions; allocated fallback values are labeled accordingly. AQTE retains its
internal 5-minute strategy confirmation provider independently of this workspace.

**Live Market Indices** uses compact NIFTY, BANKNIFTY, and SENSEX tabs, with NIFTY selected
by default and one full-width card visible at a time on mobile and desktop. All three cards
continue receiving live updates while hidden. Use Left/Right arrows or Home/End to switch
tabs with the keyboard. Equal-width, touch-friendly tabs use an emerald selected state and
underline; exchange badges appear on tablet/desktop and collapse on phones to keep labels aligned.
**Advanced SMC & Market Structure** and **Greeks Overview** share the same responsive index tabs.
Each defaults independently to NIFTY; hidden cards keep their state and live updates. Missing SMC
data shows a building-structure message for the selected index instead of hiding its tab.
**Strike Intelligence** also uses these tabs for its detailed per-index strike cards, keeping the
cross-index terminal overview above them. Its selection is independent and hidden cards retain live data.

The standalone **Market Liquidity** dashboard section and its dedicated browser stream/polling
hook have been removed. Other liquidity views and the backend liquidity service remain available;
the Observatory still consumes that service.
The main dashboard also omits **Candle Intelligence Engine** and **Smart Money / Order Logic**.
The candle engine remains available in the trade-status module; shared order-flow hooks and
backend services are preserved for other consumers.

The Advanced Chart synchronizes visible pane ranges only when they differ and resizes canvases
only when their actual dimensions change. Unchanged live OHLCV frames skip redundant candle writes;
indicator tail updates start at the engine's first changed bar to avoid repeatedly resetting plotted data.

### Futures Chart

Chart views adapt to phones and tablets (including touch-screen iPad landscape).
Manual drawing controls and their sidebar tab are removed from Advanced Chart, preserving
the full plot width. Chart panning, zooming, crosshair, indicators and CPR remain available.
Indicator/setup controls overlay the plot instead of pushing it down. History,
futures contract settings and detailed readouts use expandable menus without remounting charts.
Timeframes scroll horizontally; controls retain 44px touch targets, and mobile selects use 16px
text to avoid iOS input zoom. **Full chart** expands either view to the browser viewport without
requiring the native Fullscreen API (works on iOS); Exit full chart or Escape restores the dashboard.
The page scroll lock is restored on exit/unmount. Charts resize with viewport/orientation changes;
desktop drawing rails remain available. Pan/zoom and data/strategy calculations are unchanged.

Switching index/contract or interval fits a recent candle group in both charts, with balanced
left/right padding and width-aware spacing for phones, tablets and desktops instead of leaving
half the plot empty. Sparse new sessions are centred too. Hidden charts defer this until they have a visible size. Resizing preserves
centring only while the view is still centred; manual panning and live ticks do not continually
reset the view. Explicit Advanced Chart history/range controls keep their selected range.

AQTE is the first dashboard section below the shared header and system/connection banners.
The Advanced Chart / Futures Chart workspace follows it.
**Live Market Indices** remains immediately below the chart workspace. Its institutional snapshot
continues to come from the institutional-flow workspace, regardless of visual section order.

The Advanced Chart, Futures Chart and Futures Advanced Chart view
selectors use matching section-title typography, emerald active styling, and at least 52px
touch targets. Phones show a two-column grid; tablets and desktops show four aligned,
equal-width tabs. All working tabs remain available.

The cash-index Advanced Chart omits the unsupported 1-minute option. Working chart controls
still disable temporarily when loading or when their action is not currently available,
including futures contract selection and the footprint view before order flow is recorded.

All three charts use the same near-month futures delta box for the selected index.
The measured delta remains labelled estimated and is shown as **Buyer / Seller pressure** only.
The box shows 🟢 BUY / 🔴 SELL only on the candle where the PRO gate (below) confirms an entry,
🔵 HOLD while that trade is open, and 🟡 WAIT otherwise; stale, disconnected, archived, future-dated,
off-session or failed feeds always show WAIT. Production
cash-chart WebSocket reconnects use the configured/same-origin server, never localhost fallbacks.

### PRO confirmation gate (the only source of BUY / SELL)

Advanced Chart, Futures Chart and Futures Advanced Chart all show one shared **PRO GATE** panel
(`frontend/lib/pro-confluence.ts`, `frontend/hooks/useProConfluence.ts`). It evaluates **closed 5m
near-month futures candles** with recorded order flow and gives BUY or SELL only when **every** check passes:

| Check | BUY (SELL is the mirror) |
|---|---|
| History / window | ≥ 50 closed candles; signal candle closes 09:30–15:00 IST |
| Trend | EMA 9 > 21 > 50, close above session VWAP |
| Higher timeframes | 15m and 60m: none against, at least one with |
| Candle | Green, closes in the upper half of its range |
| Delta / CVD | Recorded delta ≥ +15% of volume (≥ 60% coverage), CVD rising over 3 candles |
| Open interest | Not short build-up (passes when OI is not reported) |
| Stretch / stop | ≤ 1.5 ATR from EMA 21; engine stop 0.3–2 ATR away |
| Room | Nearest resistance / PDH at least 1.5R away |
| Score / flip | Confluence score ≥ 70 with gap ≥ 35; previous candle did not lean the other way |

Each check is listed with ✔ / ✘ and its live value, so the reason for every WAIT is visible.
Plan: entry = signal close (replay enters next candle open), SL = engine stop, T1 = 1.5R (book half,
SL to breakeven), T2 = 3R, exit by 15:15 IST, 3-candle cool-down after a stop. Today's signals are
replayed without look-ahead and drawn as `✔ BUY/SELL` and `EXIT` labels plus SL/T1/T2 lines on all three
charts (shifted by the recorded basis onto the cash Advanced Chart); the panel shows today's W/L and points.
The older VWAP, rejection-engine, recorded-OF, candle-flow and server-guidance BUY/SELL labels are no
longer drawn; the Futures Advanced "Score engine" shows bias only. Delta aggressor side is estimated
from Kite ticks, and bars without a recording fail the delta check by design.
**No system wins every trade** — the gate filters weak and counter-trend entries; always use the stop-loss.

### Level battle (break or reject?)

All three charts also show a **LEVEL BATTLE** panel and a chart overlay (`frontend/lib/level-battle.ts`,
`frontend/lib/level-battle-primitive.ts`, `frontend/hooks/useLevelBattle.ts`, `frontend/components/LevelBattle.tsx`).
Levels come from each chart's own candles: EMA 9/20/21/50/100/200, session VWAP (futures charts), and from
the previous session Camarilla R1–R4/S1–S4, CPR TC/P/BC, pivot R1/R2/S1/S2 and PDH/PDL. Lines closer than
two zones merge into one confluence zone.

- **Zone** = 0.25 × ATR(14) of 5m near-month futures; a level is **AT** inside the zone, **NEAR** within 1.2 ATR.
  The nearest support and resistance are always shown (max 4 levels).
- **Buyers / Sellers** = recorded futures volume traded inside the zone today and in the last 30 minutes,
  plus resting bids/asks from the 5-level book when the level is close. The cash chart maps levels to futures via the recorded basis.
- **Factors** (positive = level holds): zone and recent buy/sell imbalance, last 3 candles' delta push,
  approach speed, earlier rejects/breaks today, repeated tests, confluence, EMA 21 vs 50 trend and book ratio.
- **Call:** hold ≥ 65% → **REJECT**, ≤ 35% → **BREAK**, otherwise **NEUTRAL**; shown as ↑% / ↓% with points
  to the next level above and below. The zone flashes while price is testing it.

These are estimates from sampled, aggressor-estimated ticks — wait for the candle to close at the level and always use the stop-loss.

The Observatory's **Futures Chart** tab is separate from the cash-index chart and paper trading.
Use the responsive NIFTY / BANKNIFTY / SENSEX index tabs (not an index dropdown),
then select an expiry year and contract. The tabs share the dashboard's emerald active style,
equal-width touch targets and Arrow/Home/End keyboard navigation. Switching index resets the
expiry selection to its nearest listed contract while retaining the interval.
Contracts come from
Zerodha's NFO/BFO instrument master using actual exchange expiry dates, not estimated month-end dates.
October/November/December 2026 and 2027 expiries appear only if currently listed by Zerodha;
future candles and unavailable contracts are never invented. The nearest listed expiry is the default.

Near-month intraday candles use the existing same-contract order-flow WebSocket (about one update
per second when ticks change). The stream connects in parallel with the initial REST snapshot;
late REST responses cannot rewind newer streamed data. Only contiguous, gap-free recordings from
the candle's opening minute can create live OHLCV bars. Partial startup/gap recordings may update
the price/extrema of an existing official forming candle, preserving its official open and volume;
they never create missing bars or revise closed candles.
The status distinguishes LIVE from HISTORY; stale/disconnected, off-session, daily and other-expiry
views do not claim to be live. Official history reconciles every 20 seconds after each request.
Recorded ticks are sampled, not an exchange trade-by-trade feed.
The cash Advanced Chart refreshes its current price every broadcast cycle (target 0.5 seconds),
including while broker history reconciliation is pending. History reconciles every 20 seconds,
separately from live-price refresh, so slow historical requests do not freeze candle motion.
Order-flow subscribers for the same symbol/interval share cached analytics; calculation runs
off the API event loop so it does not block delivery to other charts.
Dashboard model inference also runs off the event loop, serialized by the engine's lock.
The chart stream ignores older frames (including frames queued for the next animation),
keeps a single reconnect chain, and cancels reconnects on unmount.
The chart plots EMA 9/20, session VWAP and traded volume from the **same selected contract**.
EMA 9/20 use the existing SMA-seeded incremental engine and need 9/20 candles respectively.
RVOL 20 is current candle volume divided by the average volume of the previous 20 candles,
excluding the current bar. Intraday windows reset each IST session; daily windows span days.
No ratio is shown before a full baseline or when baseline volume is zero. Forming RVOL is provisional.
Volume bars at RVOL >= 2 are highlighted; green/red represents candle direction, not aggressor delta.
True volume-at-price footprint and buyer/seller delta are explicitly unavailable: Zerodha historical
OHLCV does not contain the trade-level aggressor data required to reconstruct them accurately.
No candle-color or synthetic bid/ask estimates are presented as real footprint/delta.
Unchanged history does not reset chart data; candle-tail revisions/appends use series updates,
while historical corrections, contract switches, and interval changes rebuild the series.
The futures endpoint skips unused daily-pivot context, making one broker history request per
uncached page rather than two. History and contract lookup reuse a Kite HTTP session per
worker thread to avoid repeated TLS handshakes without sharing sessions across concurrent
workers. A credential change replaces and closes that thread's old session; TLS verification
remains enabled. Recently viewed contract/interval snapshots are retained in a
bounded browser memory cache and shown immediately on return while refreshing; their original
refresh timestamps are preserved so cached snapshots cannot masquerade as fresh data.
Contract lists are cached for one hour within the IST date; Refresh / retry forces revalidation.
The default NIFTY five-minute contract/history and futures bundle warm in the background shortly
after the chart workspace mounts, instead of waiting for the Futures tab click. Warm data renders
on the first frame. After first opening, the futures view remains mounted across workspace tab
switches to preserve expiry/interval/zoom; its polling and stream pause while hidden.
After the selected futures chart loads, the nearest contracts for the other indices are warmed
sequentially at the selected interval. Switching to a warm chart displays its snapshot immediately;
foreground loads share any in-flight preload, and a fresh snapshot is not fetched twice.
Warm-up failures are logged and remain retryable; snapshots never cross contract/index/interval keys.
VWAP uses cumulative HLC3 times volume divided by cumulative volume, resetting each IST date.
It is unavailable on daily charts or without volume.
The latest history window is 14 days intraday or one year daily, limited by the contract's available history.
Changing expiry never stitches contracts or mixes futures volume with cash-index prices.
This tab does not generate paper orders.

**VWAP-only entry/exit calculation (reference):** a closed candle must cross its session VWAP or bounce/reject
VWAP as support/resistance, close in the trade direction and directional half of its range,
and have volume at least the average of the
previous five same-session bars. No EMA/RSI/Supertrend confirmations are calculated for this strategy.
Support bounces start above the prior VWAP, wick through both prior and current VWAP, and close
back above both; resistance rejections use the symmetric below-to-above wick and close below both.
Stops use the latest three-bar swing plus one actual contract tick; targets are 1R and 2R.
Only one setup is tracked at a time, with no new setup whose candle closes at/after 15:10 IST.
Its BUY/SELL, T1 and EXIT labels are no longer drawn on the chart; chart labels come only from the PRO gate.
These are hypothetical closed-OHLC replay levels, not executed trades: entry uses the next completed
bar's open, T1 books half, and the remaining stop moves to breakeven starting the following bar.
Stop takes priority when stop and target both occur in one candle; adverse stop gaps use the worse open.
The position exits at session close (or the last observed candle if session-end data is missing).
Fees and slippage are excluded. Polling delays both entries and exits; no guaranteed performance is implied.
Current guidance is disabled on daily intervals, failed/stale refreshes, delayed candles, or outside
the weekday IST trading session; historical labels remain explicitly replay-only.

APIs: `GET /api/chart-intelligence/futures/contracts?symbol=NIFTY` and
`GET /api/chart-intelligence/futures/history?symbol=NIFTY&token=<listed-token>&interval=5`.
The history API also accepts `before=YYYY-MM-DD` for earlier pages.
A valid Zerodha session and applicable exchange/historical-data permissions are required.
Failures are shown explicitly; refresh and last-candle timestamps distinguish stale candles from fresh requests.

---

## 🚀 Quick Start

### Local Development
```powershell
.\start.ps1
```

### Production Deployment
```powershell
# 1. Prepare production configuration
.\prepare_production.ps1

# 2. Deploy to Digital Ocean
git push origin main
# SSH to server and run: ./deploy_digitalocean.sh
```

### Check Production Readiness
```powershell
.\check_production.ps1
```

---

## 📁 Project Structure

```
mytradingSignal/
├── backend/              # Python FastAPI backend
├── frontend/             # Next.js frontend
├── docs/                 # Complete documentation
├── scripts/              # Utility scripts
├── archive/              # Old scripts (archived)
│
├── start.ps1                    # 🚀 Start system
├── deploy_digitalocean.sh       # 🌐 Deploy to production
├── prepare_production.ps1/.sh   # ⚙️ Prepare for deployment
└── check_production.ps1         # ✅ Validate production readiness
```

---

## 📚 Documentation

| Document | Purpose |
|----------|---------|
| [DEPLOYMENT_SUMMARY.md](DEPLOYMENT_SUMMARY.md) | Quick deployment guide |
| [PRODUCTION_READINESS_REPORT.md](PRODUCTION_READINESS_REPORT.md) | Complete audit report |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Environment setup |
| [docs/DIGITAL_OCEAN_DEPLOYMENT_CHECKLIST.md](docs/DIGITAL_OCEAN_DEPLOYMENT_CHECKLIST.md) | Deployment steps |
| [docs/DAILY_CHECKLIST.md](docs/DAILY_CHECKLIST.md) | Daily operations |

---

## ⚙️ Architecture

```
Zerodha WebSocket → Python Backend → Redis Cache → FastAPI WebSocket → Next.js UI
```

**Backend:** FastAPI + KiteTicker + Redis  
**Frontend:** Next.js 14 + TypeScript + TailwindCSS  
**Deployment:** Docker Compose on Digital Ocean

## Order Flow (Futures Chart + Advanced Chart)

Drawn directly on the candles (no panels): only **big-player Buy Order Flow / Sell
Order Flow** prints, at most 2 per session. A closed candle qualifies only when all of
these hold (score >= 85):

- a setup: stop-run reversal (sweeps the 10-bar extreme and closes back), absorption
  wick (>= 55% of range) or an aggressive drive candle (body >= 65%, range >= 1.6x avg);
- big participation: volume >= 2.5x the 20-bar average (range >= 2x when volume is absent);
- a major level: PDH/PDL/PDC, day high/low, opening range, VWAP, EMA20/50 or a round
  number (NIFTY 100, BANKNIFTY/SENSEX 500); crash/climax moves into the level add weight;
- recorded tick flow (when available) must not disagree; opposing delta vetoes the print.

Every print is then validated: entry at the close, stop beyond the candle extreme, and it
must reach the minimum points (NIFTY 20, BANKNIFTY 50, SENSEX 60, or 0.8 ATR if larger)
within 10 bars before the stop. Confirmed prints show `+N pts`; the newest unresolved
print is a dashed "confirming" label; failed prints are hidden but still counted in the
"Flow valid X/Y" figure next to the chart, so the hit rate is never overstated.
FII/DII identity is not in any live feed: "big player" means volume and range anomalies
at key levels, which is an estimate, not a guarantee.
Labels never overlap: ENTRY/EXIT labels take priority, and on the futures chart labels
stay above the volume bars. The
heavier overlays (footprint, profile, POC/VAH/VAL, walls, delta strip, SL/T1/T2 plan)
remain available via `OrderFlowPrimitive({ detail: true, ... })`.

- `GET /api/order-flow/snapshot?symbol=NIFTY&interval=5m`
- `GET /api/order-flow/replay?symbol=NIFTY&interval=5m` (paper replay, fees + slippage)
- `WS /ws/order-flow?symbol=NIFTY&interval=5m`

Limits (shown in the UI tooltip): the aggressor side is **estimated** (Lee-Ready on
Kite ~1/s full-mode snapshots), only the near-month contract is recorded, the
footprint exists only from when the backend started recording, confidence is a
rule score rather than a probability, and nothing is ever executed — paper only.
Restart the backend after updating so the order-flow router is loaded.

---

## ⚠️ Important: Daily Login Required

Zerodha tokens expire every 24 hours at midnight.

**Login Window:** 8:00 AM - 8:45 AM (before market open)

**What Happens:**
- 8:50 AM: System validates token
- 8:55 AM: Connects to Zerodha (if valid)
- 9:00 AM: Live market data flows automatically

**If You Forget:** Frontend shows "LOGIN REQUIRED" (no reconnection loops)

See [docs/DAILY_CHECKLIST.md](docs/DAILY_CHECKLIST.md) for details.

---

## 🛠️ Environment Configuration

**Backend:** `backend/.env`
```env
ZERODHA_API_KEY=your_key
ZERODHA_API_SECRET=your_secret
ENABLE_SCHEDULER=true
REDIS_URL=redis://localhost:6379
```

**Frontend:** `frontend/.env.local`
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws/market
```

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for complete setup.

---

## 🎯 Features

- ✅ Real-time market data (Zerodha KiteTicker WebSocket)
- ✅ Token expiry handling (no reconnection loops)
- ✅ Market hours scheduler (automatic 9 AM connection)
- ✅ EMA-based trading signals (20/50/100/200 EMA)
- ✅ VWAP 5-minute live data
- ✅ Volume analysis (Futures contracts)
- ✅ Dark theme trader-friendly UI
- ✅ WebSocket live updates
- ✅ Docker production deployment

---

## 🔧 Development Commands

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

On Windows, run the backend with the project's virtual environment so it uses the pinned
dependencies (including `requests==2.32.3`), not a globally installed Python:

```powershell
cd backend
..\.venv\Scripts\python.exe -m pip install -r requirements.txt
..\.venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Docker
```bash
docker compose -f docker-compose.prod.yml config --quiet
docker compose -f docker-compose.prod.yml up -d --build
```

Production images exclude local environment files and keep backend secrets in the runtime
`env_file`/mount. The frontend defaults to same-origin API/WebSocket URLs; configure the production
reverse proxy to forward `/api` and `/ws` to the backend. `NEXT_PUBLIC_*` values, when explicitly
supplied, must be present at frontend build time, not just container startup.
Health checks use Python/Node already installed in the respective images, without requiring curl.
Both deployment scripts detect the Compose plugin (`docker compose`) or standalone
`docker-compose` independently of Docker. If neither works, they install standalone Compose
on the root-owned Linux deployment host. Upload, download, configuration and startup failures
stop deployment instead of printing success. Invoke the Windows script from any directory;
it uploads a checked source archive of this repository (excluding `.env*`, the Kite token,
runtime data, dependencies and build output, so server settings are never overwritten),
then runs the remote commands with Bash. Both scripts run `scripts/check-production-env.sh`
on the server first: localhost URLs fail the deploy; missing AQTE approvals or an outbound
IPv4 that differs from `AQTE_LIVE_STATIC_IP` are reported without printing secrets.
See the AQTE [production checklist](docs/AQTE.md#production-checklist-digitalocean).
Windows PowerShell logging stays ASCII and uploaded shell line endings are normalized
before execution. Deployment regression checks (mocked commands; no server access):

```powershell
powershell -NoProfile -ExecutionPolicy RemoteSigned -File scripts\tests\test-deploy-to-do.ps1
```
```bash
bash scripts/tests/test-compose.sh
```

Neither script brings down running containers or prunes shared Docker caches before building.
Container startup is not a readiness guarantee: check every service's health and the
same-origin reverse proxy before allowing live traffic. Docker builds do not require
`frontend/.env.local` (it is deliberately excluded from the image).
The frontend build creates an empty `public` directory when no static assets exist.
Keep `order-flow-data` too: `ORDER_FLOW_DB_PATH` points the live footprint/delta recording
database into that volume so recordings survive container recreation. Existing deployments
must back up and migrate any old `/app/data/order_flow.sqlite3` recording before switching
to `/app/data/order_flow/order_flow.sqlite3`; the new volume does not import it automatically.
Custom `.next*` build-check directories are excluded from the frontend Docker context.
Keep `aqte-data` for the AQTE recording and live-order journals. New volumes inherit the
non-root app user's image-directory ownership. Existing volumes may need an ownership
repair after a backup; do not delete trading journals to fix permissions.

---

## 📦 Archive Folder

Old deployment/diagnostic scripts have been moved to `archive/` folder to keep the project clean. These are kept for reference but are not needed for production.

---

## 📞 Support

**Deployment Issues:** See [DEPLOYMENT_SUMMARY.md](DEPLOYMENT_SUMMARY.md)  
**Token Issues:** See [docs/TOKEN_MANAGEMENT.md](docs/TOKEN_MANAGEMENT.md)  
**Configuration:** See [docs/CONFIGURATION.md](docs/CONFIGURATION.md)

---

## 📄 License

See [LICENSE](LICENSE) file for details.

---

**Last Updated:** February 2026  
**Status:** ✅ Production Ready
