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

## Strategy and safety

The experimental baseline observes NIFTY, BANKNIFTY, and SENSEX during
09:00–09:08 IST and evaluates the 09:15–09:20 IST opening range. A qualified
setup is shown as a candidate only; no order is submitted. Missing, stale, or
unsupported market data results in WAIT/block. The
UI does not synthesize quotes or readiness scores. Actual broker order
placement is not implemented and cannot be enabled from this section.
