# ExpiryEdge AI Algo

ExpiryEdge AI is an isolated expiry configuration and contract-readiness module.
Its frontend appears as an individual section immediately below MorningEdge in
the AQTE dashboard and is also available at `/expiry-edge-ai`, with a navigation
link in the main dashboard header. API routes, durable weekday configuration,
and contract inspection live in `backend/routers/expiryedge.py` and
`backend/services/expiryedge.py`. NIFTY, BANK NIFTY, and SENSEX each have an
independently saved weekday schedule.

The saved weekday is a preference, not an expiry source. ExpiryEdge reports option
expiries from the current Zerodha NFO/BFO instrument master. The current repository
does not provide an authoritative exchange holiday/expiry-adjustment calendar,
ExpiryEdge-specific market-data and strategy pipeline, or an approved ExpiryEdge
order owner in the existing execution manager. Accordingly, the status API
reports those gaps and keeps live execution disabled. The current frontend is
limited to configuration and readiness diagnostics; it does not submit orders or
produce synthetic signals.

Configuration endpoints require the authenticated app-access owner session,
`X-Device-Id`, and `X-ExpiryEdge-Intent: manual-config`:

- `GET /api/expiryedge/config`
- `PUT /api/expiryedge/config` with `{"symbol":"NIFTY","expiry_weekday":"Tuesday"}` (Monday-Friday)
- `GET /api/expiryedge/status`

Each index schedule is stored in a separate row in a SQLite WAL database under
`backend/data/expiryedge/config.sqlite3`. Existing single-weekday configuration is
migrated as the initial preference for all three indices; each can then be changed
independently. Live entry must remain blocked until an
authoritative holiday/expiry source and an explicitly approved, ownership-safe
execution integration are implemented and independently validated.
