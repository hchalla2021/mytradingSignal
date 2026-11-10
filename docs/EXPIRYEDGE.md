# ExpiryEdge AI Algo

ExpiryEdge AI is an isolated expiry configuration and contract-readiness module.
Its frontend appears as an individual section immediately below MorningEdge in
the AQTE dashboard and is also available at `/expiry-edge-ai`, with a navigation
link in the main dashboard header. API routes, durable weekday configuration,
and contract inspection live in `backend/routers/expiryedge.py` and
`backend/services/expiryedge.py`. NIFTY, BANK NIFTY, and SENSEX each have an
independently saved weekday schedule.

The standalone signal evaluator independently consumes completed one-minute futures
bars for NIFTY, BANKNIFTY, and SENSEX from the shared authenticated Kite feed. It
checks the completed first five-minute opening range, a one-minute close beyond that
range, VWAP agreement, and ATR-based invalidation/trailing distances. A signal is
shown only on the configured weekday when the current Zerodha option instrument
master lists that index's expiry for today. This is a rule-based signal, not a
validated AI model. The panel refreshes its status every five seconds and labels its
prices as underlying futures metrics rather than option entry or order levels.

The saved weekday is a preference, not an expiry source. The current Zerodha NFO/BFO
instrument master is used to check whether today is the nearest listed expiry, but the
repository does not provide an authoritative exchange holiday/expiry-adjustment
calendar or historical replay validation. The standalone executor has its own owner,
position state, and risk controls; it never manages manual trades or the 12 Algo Desk.
Live execution is OFF by default and requires both `AQTE_LIVE_ENABLED=true` and
`EXPIRYEDGE_AI_LIVE_ENABLED=true`, owner approval in the panel, and the normal daily
Kite preflight/arming checks. The independent feature flag is deliberately false by
default and should only be enabled after mock validation and operator checks.
Dashboard quote connectivity is displayed separately from each ExpiryEdge evaluator
feed; a connected dashboard socket alone does not mean the backend has fresh futures
bars.

The standalone policy is one listed ATM option lot, limit-IOC entry, one trade per
day across the three indices, maximum ₹3,000 risk per trade and daily owner loss,
20% initial premium stop, no fixed target, breakeven at +1R and then a non-loosening
0.5R trailing gap. Only fresh Zerodha-listed contracts and fresh quotes with adequate
depth and acceptable spread are considered. Turning Trade OFF prevents new entries;
an existing ExpiryEdge AI position remains protected and managed until closed.

Configuration endpoints require the authenticated app-access owner session,
`X-Device-Id`, and `X-ExpiryEdge-Intent: manual-config`:

- `GET /api/expiryedge/config`
- `PUT /api/expiryedge/config` with `{"symbol":"NIFTY","expiry_weekday":"Tuesday"}` (Monday-Friday)
- `GET /api/expiryedge/status`
- `GET /api/expiryedge/live/status`
- `POST /api/expiryedge/live/approval`
- `POST /api/expiryedge/live/exit`

The live-control routes additionally require the authenticated owner session,
`X-Device-Id`, and `X-AQTE-Intent: manual-live-control`. Live approvals require an
explicit action-specific confirmation value. Manual mode is the default.

Each index schedule is stored in a separate row in a SQLite WAL database under
`backend/data/expiryedge/config.sqlite3`. Existing single-weekday configuration is
migrated as the initial preference for all three indices; each can then be changed
independently. Do not enable the independent feature flag until the mock tests and
operator validation have been completed. This flag does not bypass the ordinary
AQTE live enablement, owner approval, or session preflight requirements.
