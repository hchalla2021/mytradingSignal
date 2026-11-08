# MorningEdge

MorningEdge has a separate API, database, Redis instance, strategies, and deployment.
Per the selected shared-login behavior, it now reuses the main application's Zerodha
login and broker token rather than maintaining a second Zerodha login.

## Zerodha connection

Use the existing Zerodha login in the main application header. The main backend writes
only the Kite API key and current access token to the shared
`mytrading-zerodha-auth` Docker volume after login and at startup. The Kite API secret
and other backend environment values are not shared. MorningEdge reads this file
read-only, validates the token with Zerodha before issuing its short-lived HttpOnly
browser session, and then uses the shared token. There is no separate MorningEdge
**Connect Zerodha** button or token prompt.

Start the main backend stack first so it creates and populates the shared token volume.
Then copy `.env.example` to `.env`, configure `MORNINGEDGE_FRONTEND_URL`,
`MORNINGEDGE_PUBLIC_API_URL`, PostgreSQL password, and other service settings, and run
from the repository root:

```powershell
docker compose --env-file morningedge/.env -f docker-compose.morningedge.yml up --build
```

The public API origin must use HTTPS and route HTTP and WSS to port 8010. Build the
frontend with `NEXT_PUBLIC_MORNINGEDGE_API_URL` set to that API origin. Keep the frontend
and API on the same site (for example, `app.example.com` and `api.example.com`) so
browser cookie policies allow the authenticated session. Never commit credentials or
the shared token volume.

## Readiness limitations

Status/config responses include readiness, block reasons, session gates, snapshots, and
reported metrics. Configure PostgreSQL and Redis URLs, host allowlist IP (defaults to
`159.65.147.167`), and a validated model artifact before readiness can change.

This release does not connect/persist through PostgreSQL or Redis in a running worker;
does not provide a KiteTicker worker, instrument mapping, validated model, live order
placement, paper trading, broker execution, or trade management. The adapter and API
scaffold are not production trading functionality. Live orders remain disabled and
arming/approval cannot enable them. Do not treat this service as production-validated or
assume latency targets. Pre-open analysis is scheduled from 09:00 Asia/Kolkata, orders
cannot be enabled before 09:15, and new entries end at 10:30.

Run focused tests:

```powershell
python -m pytest -q
```
