# MorningEdge (standalone backend)

Python 3.12 service, intentionally isolated from the existing trading application.
For local development, run from this directory after installing `requirements.txt`:
`uvicorn app:app --host 0.0.0.0 --port 8010`. For the independent container deployment,
copy `.env.example` to `.env`, fill its required values, then run from the repository root:
`docker compose --env-file morningedge/.env -f docker-compose.prod.yml -f docker-compose.morningedge.yml up --build`.
Set `MORNINGEDGE_PUBLIC_API_URL` to the HTTPS origin routed to the MorningEdge service
(port 8010); the host reverse proxy must forward HTTP and WSS. Do not commit credentials.
`MORNINGEDGE_OPERATOR_TOKEN`
protects API and WS requests with `Authorization: Bearer …`; WebSocket clients send the
same header for HTTP endpoints. Obtain a one-use, 60-second WebSocket credential from
`POST /api/v1/events/token` over authenticated HTTPS, then connect to
`ws://host:8010/api/v1/events?token=…` (use `wss://` behind TLS). The short-lived token
is single-use and independent of application/AQTE cookies. Frontend contract:
`GET /api/v1/status`, `GET/PUT /api/v1/config`,
`POST /api/v1/preflight`, `POST /api/v1/arm`, `POST /api/v1/approval`, and
`/api/v1/events` (the WS path is explicitly `/api/v1/events`).

Status/config responses are JSON, with risk fields nested under `risk` on config,
and status includes readiness, block reasons, session gates, snapshots, and metrics.
Configure independent Zerodha credentials, operator credential, PostgreSQL and Redis
URLs, host allowlist IP (defaults to `159.65.147.167`), and a validated model artifact
before readiness can change. MorningEdge currently exposes PostgreSQL/Redis persistence
interfaces and KiteTicker ingestion adapter but does not connect/persist in a running
worker. The instrument-token map and OAuth login callback must be configured by the
deployment. No validated model is provided; confidence >=20% is a minimum setting, not
evidence of validation. No order placement, paper trading, broker execution, or trade
management is enabled; arming/approval cannot enable orders. Do not treat this service
as production-validated or assume latency targets.

Pre-open ticks are accepted from 09:00 Asia/Kolkata, orders cannot be enabled before
09:15, and new entries end at 10:30. This release reports readiness only and does not
implement order execution.

Run focused tests: `python -m pytest -q`.

**HTTPS is required outside local development.** Terminate TLS at a trusted reverse proxy,
use HTTPS/WSS, do not expose this service over public plaintext HTTP, and provision a
high-entropy operator token through the deployment secret manager. Set independent
Zerodha API key, secret, and access token only in the service environment; never put
them in frontend code, URLs, source control, or logs. WebSocket token query strings must
be redacted from proxy/access logs.
