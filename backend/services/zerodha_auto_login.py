"""
One-click Zerodha login automation.
=====================================
Performs the full Kite Connect handshake server-side using credentials
from .env (ZERODHA_USER_ID / ZERODHA_PASSWORD / ZERODHA_TOTP_SECRET):

  1. POST kite.zerodha.com/api/login          → request_id
  2. POST kite.zerodha.com/api/twofa          → TOTP second factor
  3. GET  /connect/login?api_key=…            → walk redirects, capture request_token
  4. KiteConnect.generate_session             → access_token

Used by POST /api/auth/auto-login so the dashboard 🔑 button refreshes the
token in one click without navigating to the Zerodha page.

SECURITY: credentials never leave this machine; they are read from the
local .env only and are never logged or returned in responses.
"""

import asyncio
import logging
from typing import Any, Dict
from urllib.parse import parse_qs, urlparse

import requests

logger = logging.getLogger(__name__)

KITE_BASE = "https://kite.zerodha.com"
HTTP_TIMEOUT = 15
MAX_REDIRECT_HOPS = 8


class AutoLoginError(Exception):
    """Raised with a user-safe message when any handshake step fails."""


def _totp_now(secret: str) -> str:
    try:
        import pyotp
    except ImportError as exc:
        raise AutoLoginError("pyotp not installed — run: pip install pyotp") from exc
    try:
        return pyotp.TOTP(secret.replace(" ", "").upper()).now()
    except Exception as exc:
        raise AutoLoginError("Invalid ZERODHA_TOTP_SECRET (must be the base32 TOTP key)") from exc


def _handshake_blocking(api_key: str, user_id: str, password: str,
                        totp_secret: str) -> str:
    """Run the login → twofa → connect redirect chain. Returns request_token."""
    s = requests.Session()
    s.headers.update({"User-Agent": "Mozilla/5.0", "X-Kite-Version": "3"})

    # 1. Password login
    r = s.post(f"{KITE_BASE}/api/login",
               data={"user_id": user_id, "password": password},
               timeout=HTTP_TIMEOUT)
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    if r.status_code != 200 or body.get("status") != "success":
        msg = body.get("message") or f"HTTP {r.status_code}"
        raise AutoLoginError(f"Zerodha rejected user/password: {msg}")
    request_id = (body.get("data") or {}).get("request_id")
    if not request_id:
        raise AutoLoginError("Zerodha login did not return request_id")

    # 2. TOTP two-factor
    r = s.post(f"{KITE_BASE}/api/twofa",
               data={"user_id": user_id, "request_id": request_id,
                     "twofa_value": _totp_now(totp_secret), "twofa_type": "totp"},
               timeout=HTTP_TIMEOUT)
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    if r.status_code != 200 or body.get("status") != "success":
        msg = body.get("message") or f"HTTP {r.status_code}"
        raise AutoLoginError(f"TOTP verification failed: {msg}")

    # 3. Connect flow — walk redirects manually so we capture request_token
    #    BEFORE the chain reaches our own /api/auth/callback.
    url = f"{KITE_BASE}/connect/login?v=3&api_key={api_key}"
    for _ in range(MAX_REDIRECT_HOPS):
        r = s.get(url, allow_redirects=False, timeout=HTTP_TIMEOUT)
        location = r.headers.get("location", "")
        if not location:
            break
        qs = parse_qs(urlparse(location).query)
        token = (qs.get("request_token") or [None])[0]
        if token:
            return token
        url = location if location.startswith("http") else f"{KITE_BASE}{location}"
    raise AutoLoginError("Could not obtain request_token — check that the app's "
                         "redirect URL matches REDIRECT_URL in .env")


async def auto_login(settings: Any) -> Dict[str, Any]:
    """Full one-click login. Returns kite.generate_session() payload."""
    user_id = getattr(settings, "zerodha_user_id", "") or ""
    password = getattr(settings, "zerodha_password", "") or ""
    totp_secret = getattr(settings, "zerodha_totp_secret", "") or ""
    if not (user_id and password and totp_secret):
        raise AutoLoginError(
            "One-click login not configured — add ZERODHA_USER_ID, "
            "ZERODHA_PASSWORD and ZERODHA_TOTP_SECRET to backend/.env")

    loop = asyncio.get_event_loop()
    request_token = await asyncio.wait_for(
        loop.run_in_executor(
            None,
            lambda: _handshake_blocking(settings.zerodha_api_key, user_id,
                                        password, totp_secret)),
        timeout=45.0)

    from kiteconnect import KiteConnect
    kite = KiteConnect(api_key=settings.zerodha_api_key)
    data = await asyncio.wait_for(
        loop.run_in_executor(
            None,
            lambda: kite.generate_session(request_token,
                                          api_secret=settings.zerodha_api_secret)),
        timeout=15.0)
    logger.info("✅ One-click Zerodha login succeeded for user %s", data.get("user_id"))
    return data
