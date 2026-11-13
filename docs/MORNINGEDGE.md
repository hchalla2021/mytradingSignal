# MorningEdge AI

MorningEdge is a separate dashboard section and FastAPI service mounted above
ExpiryEdge. Its market feed, state, service authentication, and configuration
are independent; it does not import from the main backend or use ExpiryEdge
market data.

## Local setup

1. Copy `morningedge\.env.example` to `morningedge\.env` for service-local
   settings.
2. The standalone service reads only `ZERODHA_API_KEY` and
   `ZERODHA_ACCESS_TOKEN` from `backend\.env`. It does not read or expose the
   Zerodha API secret or unrelated backend variables.
3. This build is a live market-data monitor only. Broker order execution is not implemented.
4. Start the isolated service:

   ```powershell
   docker compose -f docker-compose.morningedge.yml up --build
   ```

5. The section uses the existing authenticated dashboard session; there is no
   MorningEdge token or owner secret to type into the UI. In local development,
   configure the server-side proxy in `frontend\.env.local`:

   ```dotenv
   MORNINGEDGE_API_URL=http://127.0.0.1:8010
   BACKEND_API_URL=http://127.0.0.1:8000
   ```

6. Restart the frontend.

The header's **LIVE FEED ON/OFF** control connects or disconnects the Kite
market-data feed. It does not enable trading; trade control stays OFF because
order placement is not implemented. Turning the feed OFF clears live ticks so
the UI cannot present stale prices as current. Service, authentication, and
feed errors are shown in the section.

The standalone Compose file binds its API to localhost only and mounts
`backend\.env` read-only so the service can obtain the two Kite credentials.
Production Compose keeps the API on the private Docker network and mounts the
configured backend environment file read-only. The frontend proxy validates
the existing app-access cookie and device ID before returning status.

## Production with PM2

On a PM2 host (frontend and backend are PM2 processes, no Docker daemon),
MorningEdge needs its own PM2 process. Without it nothing listens on port 8010
and the section reports that the standalone service is unreachable. The service
uses the backend virtualenv and reads the token from `backend/.env`; do not copy
it into a second environment file.

`scripts/ensure-morningedge.sh` is idempotent and safe to run after every deploy.
It checks the dependencies, starts MorningEdge on `127.0.0.1:8010` when it is
missing, and restarts it only when it is not online. It runs `pm2 save` only
after `/health` answers.

```bash
cd /var/www/mytradingSignal
bash scripts/ensure-morningedge.sh
curl -sS http://127.0.0.1:8010/api/status
systemctl is-enabled pm2-root
```

Allow time for the instrument catalog and feed connection. Health should
eventually report `feed: connected`, and `/api/status` should show `LIVE` index
status, fresh timestamps, and `trade_enabled: false`. An HTTP 200 health response
alone does not prove a working feed.

A healthy instance does not need a restart for a new Zerodha token. Every 15
seconds MorningEdge rereads `backend/.env` and reconnects in-process when the
token changes, for example after the daily login. That keeps today's in-memory
pre-open ticks. If the feed stays down with an unchanged token, it retries after
60 seconds, doubling the wait up to 15 minutes.

After deploying changes to `morningedge/`, load the new code with
`pm2 restart morningedge` before 09:00 or after 15:30 IST. A restart discards the
day's collected ticks.

The 9 AM timer from `scripts/setup-9am-autostart.sh` runs the ensure script
first and then restarts the other PM2 processes, leaving a healthy MorningEdge
running. After changing that setup script, rerun it once on the droplet to
reinstall `/usr/local/bin/market-9am-start.sh`.

The frontend proxy defaults to `http://127.0.0.1:8010`. If production overrides
`MORNINGEDGE_API_URL`, ensure it points there rather than the Docker hostname;
changing a frontend runtime environment variable requires restarting that process.

### Routing

The dashboard calls `/morningedge-api/api/status`. This Next.js route is
deliberately outside `/api/`: production Nginx sends every `/api/*` request to
the FastAPI backend, which would return 404. The site's existing `location /`
already proxies this path to Next.js, so no Nginx change is needed. Do not
expose port 8010 publicly; the Next.js route enforces the dashboard session and
device-ID checks.

Without credentials, both `http://127.0.0.1:3000/morningedge-api/api/status` and
`https://mydailytradesignals.com/morningedge-api/api/status` must return 401 with
`Sign in to view MorningEdge.` Then verify live prices in the signed-in
dashboard. Starting after the morning collection windows cannot recover missed
pre-open or opening-range ticks, so WAIT for incomplete coverage is expected
even with a healthy feed.

## Strategy and safety

The experimental baseline observes NIFTY, BANKNIFTY, and SENSEX during
09:00–09:08 IST and evaluates the 09:15–09:20 IST opening range. A qualified
setup is shown as a candidate only; no order is submitted. Missing, stale, or
unsupported market data results in WAIT/block. The
UI does not synthesize quotes or readiness scores. Actual broker order
placement is not implemented and cannot be enabled from this section.
