# OpeningEdge AI (independent dashboard)

This is a new dashboard below QuantumEdge. It has its own KiteTicker connection
and configuration database and does not import any other trading section.
It reads the Zerodha key and access token and the existing QuantumEdge Haiku
configuration from `backend/.env`, which is mounted read-only in production.
Lots default to one; loss per trade and
the daily loss limit must be explicitly saved.
Open **Pre-open data & risk settings** on an index card to edit its lots and
loss per trade. Open **Daily risk settings** below the dashboard to edit the
daily limit.

The independent Zerodha feed starts ON after a service restart. The header's
Zerodha badge shows the actual connection state. The private feed-control API
can stop the connection asynchronously; previous snapshots can remain visible
as LAST and in-flight requests may finish. Turning the feed OFF clears captured
pre-open samples, so a complete review requires continuous new coverage.

The header **TRADE** control records owner approval, not a market-data switch.
ON and OFF are shown separately from execution readiness and reset OFF on service
restart. **Live entries are currently locked in code**, regardless of approval
or environment flags: the broker lifecycle needs further safety validation.
ON does not place or authorize automatic orders while execution is locked.
OFF blocks new entries; do not assume an existing order or position is protected
or closed. Inspect and manage any existing position in Kite.

The experimental broker code has not been validated for production, including
partial fills, manual intervention, broker order identity, disconnected feeds,
and uncertain stop modifications. Do not remove the execution lock or deploy
this as live order management until these paths have been addressed and tested.

The independent Haiku setup review uses `QUANTUMEDGE_AI_ANTHROPIC_API_KEY`,
falling back to `AUTONOMIQ_PRO_ANTHROPIC_API_KEY`, and respects
`QUANTUMEDGE_AI_ENABLED`, `QUANTUMEDGE_AI_MODEL`,
`QUANTUMEDGE_AI_MAX_OUTPUT_TOKENS`, and `QUANTUMEDGE_AI_TIMEOUT_SECONDS`.
It does not share QuantumEdge's AI budget counters. A durable reservation limits
this service to one attempted call per index per day, at most three total,
including failed or interrupted attempts, provided all instances use the same
persistent SQLite database. Haiku is called only after 09:15 and before 15:30
IST when a fresh connected live quote breaks the complete pre-open range in
the direction already confirmed by pre-open movement and the recent previous
session close. Complete coverage requires at least five samples from no later
than 09:01 to at least 09:07 with no gap over 90 seconds. Missing, stale or
conflicting inputs result in no call. The quote, pre-open range, prior-session
OHLC and all these qualifying checks are supplied to Haiku. Optional global,
news, PCR and IV dashboard cues remain display-only and are not algo inputs.
The review is advisory only; it does not place or authorize an order, and its
reported confidence is not a calibrated probability. The service must be
running before the pre-open sampling window to qualify that day's setup.
Provider connectivity and configured model access must be verified separately;
configuration alone does not establish that either is available.

OpeningEdge is currently a market monitor, not a live position manager. A stale
or disconnected tick is never shown as live; a separately fetched last quote
may be shown as LAST instead.

The intelligence panel is **display-only**, independent of Haiku and trade
decisions. Its USA, Europe, Asia Pacific, India and News groups can be expanded;
the regional header previews identify their specific index and retain its
source status. Green and red show positive and negative changes, not trading
recommendations. GIFT NIFTY comes from Zerodha's `NSEIX:GIFT NIFTY` instrument;
global indices come from Zerodha's `GLOBAL` segment. Neither uses Groww.
The same OpeningEdge KiteTicker connection also subscribes to India VIX,
nearest NIFTY and BANKNIFTY futures, nearest USDINR and MCX GOLD futures (not
spot FX or spot gold), ten selected stocks, and dynamically selected NIFTY
options. Quotes require timestamps no more than 30 seconds old and a connected
feed. GIFT and GLOBAL data with recent timestamps are labeled **RECENT**, not
LIVE, because the provider's market-data delay has not been verified. Instrument
lists refresh once per day after 08:30 IST; missing segments are retried every
five minutes without opening a second socket. Kite permits three WebSocket
connections per API key, so other applications may compete for that limit.

The service also retrieves actual Zerodha quote snapshots on startup and every
five minutes. When live ticks are unavailable, valid snapshots up to seven days
old are shown as **LAST**, with their exchange timestamps. LAST is not live and
is never used in Haiku review or trading; snapshots can also be from earlier
in the current session. Composite basket and PCR snapshots require matching
dates and at most five minutes between their component timestamps. Last
snapshots cannot reconstruct a missed pre-open auction or historical IV.

The breadth indicator is advances/declines in a fixed ten-stock proxy, **not**
exchange-wide or NIFTY 50 breadth; the stock indicator is its equal-weight
average percentage change, not index-weighted performance. All ten require
fresh quotes and previous closes. The pre-open gap compares the last observed
NIFTY pre-open tick against the recent previous close and is frozen after
complete coverage; it is not the exchange's official auction price.
NIFTY PCR uses put OI divided by call OI for the five nearest paired strikes
in the nearest option expiry, not the full option chain; all ten OI ticks
must be fresh. ATM IV is an indicative average of call and put bid/ask-midpoint
Black-Scholes estimates, using a fixed 6% annual interest rate and zero
dividend yield. Missing, stale, crossed or non-invertible markets make the
estimate unavailable. Expand each row to see source and assumptions.
When the pre-open tick was not recorded, the panel instead labels and shows the
last completed session's opening gap: the Zerodha daily open versus the previous
session's close. This is not a recorded pre-open tick. Actual frozen pre-open
gaps and valid live ATM IV estimates are saved in the OpeningEdge database,
shown as LAST when no current value is available, and marked STALE after seven
days. These saved observations are display-only and survive restarts; a value
cannot be reconstructed when the required market data was never recorded.
US VIX uses the CBOE daily close via FRED, not a live quote. Set
`OPENINGEDGE_FRED_API_KEY` privately in `backend/.env` or the service environment
after obtaining your own [FRED API key](https://fred.stlouisfed.org/docs/api/api_key.html).
The shared backend key is suitable only for a private single-user deployment;
FRED requires each user of an application to use their own key. Do not enable
this integration on a multi-user deployment without implementing per-user keys.
The service attempts at most one FRED request per six hours per persistent
database, including failed attempts. It labels the observation date, retains
the required CBOE/FRED attribution, and marks data older than 14 days stale.
FRED data is display-only, never used for trading or AI development, training,
analysis or review; verify FRED and CBOE terms for your use. India VIX is shown
separately and is not substituted for US VIX.

News tone optionally uses Marketaux's free financial news API. Register for
your own token at https://www.marketaux.com/register and set
`OPENINGEDGE_MARKETAUX_API_TOKEN` privately in `backend/.env` or the service
environment; never share the token in chat. Check Marketaux's terms for your
use, including any restrictions on storing and displaying derived data.
The free tier currently permits 100 requests a day and up to three articles
per request. OpeningEdge reserves at most one attempt per hour per persistent
database, including failed attempts. HTTP 429 pauses requests for at least 24
hours or the provider's longer Retry-After. The result is the mean of per-article
means of India-related entity scores from up to three English articles in the
last 24 hours, with duplicate entity names counted once per article. It is not
NIFTY sentiment or a representative market-wide measure. The oldest and newest
article timestamps and sample size are displayed; a saved reading older than
48 hours is marked STALE. No article text is saved or displayed. It is
display-only and never used by Haiku or trading. Availability and actual
account access must be verified with your own token.
No latency or probability is implied.

Run locally from the repository root with the existing virtualenv:

```powershell
.\.venv\Scripts\python.exe -m uvicorn openingedge.main:app --host 127.0.0.1 --port 8012
```

In separate terminals, run the usual backend and frontend. The frontend's
server-side `OPENINGEDGE_API_URL` defaults to `http://127.0.0.1:8012`.
The browser proxy requires the existing dashboard session and device ID;
configuration writes also require same-origin and an intent header. Do not
expose port 8012 publicly: the standalone service is not authenticated.
Production Compose uses private-network services and a persistent database
volume. PM2 deployments must start the service independently:

```bash
cd /var/www/mytradingSignal
bash scripts/ensure-openingedge.sh
```

The helper touches only the `openingedge` PM2 process, binds port 8012 to
loopback, validates the status API, and saves the process list for reboot
restoration (PM2 startup must already be configured). Healthy processes are
not restarted. If the virtualenv is elsewhere, set `OPENINGEDGE_VENV_BIN`.
Install `openingedge/requirements.txt` there if the dependency check fails.
After changing OpeningEdge Python code, restart only `openingedge` outside the
pre-open window; a restart loses captured samples and resets approval OFF.

For an HTTPS reverse proxy, the frontend location must overwrite `Host` with
the public host and `X-Forwarded-Proto` with the external scheme:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
```

OpeningEdge writes validate the browser Origin against this host and scheme,
not Next.js's internal listening address. Dashboard authentication, device ID,
and intent checks remain required. Never expose the standalone API publicly.
In Compose, bring up `openingedge-api` explicitly when deploying only selected
services; starting `backend` alone does not start OpeningEdge. Do not upload
local `openingedge/data`, environment files or tokens to production.
