# MorningEdge (standalone live market monitor)

Independent FastAPI service; no backend, AQTE, or ExpiryEdge imports. Run with
`uvicorn main:app --app-dir morningedge --port 8010 --env-file morningedge/.env`.
Copy `.env.example` to `.env` for service-local settings. The service reads only
`ZERODHA_API_KEY` and `ZERODHA_ACCESS_TOKEN` from `backend/.env`; neither value
is returned by an endpoint or sent to the browser. The service does not read the
Zerodha API secret or unrelated backend variables.

The browser does not ask for a separate MorningEdge token. The frontend server
proxy validates the existing app-access session cookie and device ID before it
requests status or relays the feed control. Keep the service reachable only over
localhost or a private container network.

The operator can turn the independent KiteTicker feed ON or OFF in the section.
It provides real NIFTY, BANKNIFTY, and SENSEX ticks, pre-open observations from
09:00–09:08 IST, opening-range observations from 09:15–09:20 IST, and a
market-derived candidate signal. Feed OFF disconnects the socket and clears
live ticks. Missing credentials, ticks, contracts, freshness, or quote quality
are surfaced as errors or WAIT states instead of synthetic values.
Zerodha access tokens are time-limited. If the Kite WebSocket reports
`403 Forbidden`, generate a fresh daily access token, update
`ZERODHA_ACCESS_TOKEN` in `backend/.env`, and restart the MorningEdge service.

**Broker order execution is not implemented.** The current service only monitors
market data and reports candidate signals; it creates no positions. Trade
execution remains OFF. Install dependencies with
`pip install -r morningedge/requirements.txt`.
