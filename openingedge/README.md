# OpeningEdge Global Cues

OpeningEdge now provides one read-only dashboard section: global and pre-open
market intelligence. It has no trade approval, order execution, AI review,
risk configuration, or broker-write capability.

The service uses the same `ZERODHA_API_KEY` and `ZERODHA_ACCESS_TOKEN` stored
in `backend/.env` for its dashboard Kite session. It subscribes to Zerodha
global indices plus India pre-open context, including GIFT NIFTY, index
futures, India VIX, selected equities, and NIFTY option data used for PCR/IV.

The exposed API is intentionally limited to:

- `GET /health`
- `GET /api/status`

The frontend proxy requires the existing authenticated dashboard session and
device ID before forwarding the status read. Do not expose the standalone
service on port 8012 publicly.

GIFT NIFTY comes from Zerodha's `NSEIX:GIFT NIFTY` instrument. Global indices
come from Zerodha's `GLOBAL` segment. GIFT/GLOBAL timestamps are shown as
`RECENT` because provider delay is not independently verified. `LAST` values
are cached snapshots and are never presented as live.

US VIX uses an optional FRED daily close via
`OPENINGEDGE_FRED_API_KEY`. News tone uses the optional
`OPENINGEDGE_MARKETAUX_API_TOKEN`. Both are display-only and never participate
in trading decisions.

Run locally from the repository root:

```powershell
.\.venv\Scripts\python.exe -m uvicorn openingedge.main:app --host 127.0.0.1 --port 8012
```

Production Compose mounts `backend/.env` read-only and stores cue snapshots in
the `openingedge-data` volume. Restarting the service can lose the current
session's captured pre-open samples.
