"""Application access authentication service.

Provides device-bound app login with optional single-device lock and 24h sessions.
"""

from __future__ import annotations

import base64
import json
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from config import get_settings
from services.cache import get_cache, CacheService

settings = get_settings()


class AppAccessError(Exception):
    """Base app access error."""


class AppAccessLockedError(AppAccessError):
    """Raised when app is locked by another device."""


class AppAccessAuthService:
    """Manages app-level authentication sessions."""

    def __init__(self) -> None:
        self._cache: CacheService = get_cache()
        self._lock_key = "app_access:active_device_lock"
        self._session_prefix = "app_access:session:"

    @staticmethod
    def _now() -> datetime:
        return datetime.now(timezone.utc)

    @staticmethod
    def _normalize_device_id(device_id: str | None) -> str:
        value = (device_id or "").strip()
        if not value:
            raise AppAccessError("Missing device identifier")
        return value[:128]

    @staticmethod
    def make_password_hash(password: str, iterations: int = 200_000) -> str:
        """Create a pbkdf2_sha256 hash string for .env usage."""
        salt = base64.urlsafe_b64encode(secrets.token_bytes(16)).decode("utf-8").rstrip("=")
        digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt.encode("utf-8"),
            iterations,
        )
        encoded = base64.urlsafe_b64encode(digest).decode("utf-8").rstrip("=")
        return f"pbkdf2_sha256${iterations}${salt}${encoded}"

    @staticmethod
    def _verify_password(password: str) -> bool:
        if settings.app_access_password_hash:
            parts = settings.app_access_password_hash.split("$")
            if len(parts) != 4 or parts[0] != "pbkdf2_sha256":
                return False
            _, iterations_raw, salt, expected = parts
            try:
                iterations = int(iterations_raw)
            except ValueError:
                return False

            digest = hashlib.pbkdf2_hmac(
                "sha256",
                password.encode("utf-8"),
                salt.encode("utf-8"),
                iterations,
            )
            actual = base64.urlsafe_b64encode(digest).decode("utf-8").rstrip("=")
            return hmac.compare_digest(actual, expected)

        if settings.app_access_password:
            return hmac.compare_digest(password, settings.app_access_password)

        return False

    @staticmethod
    def _config_is_ready() -> bool:
        return bool(settings.app_access_username and (settings.app_access_password_hash or settings.app_access_password))

    @staticmethod
    def _ttl_seconds() -> int:
        hours = max(1, settings.app_access_session_hours)
        return int(timedelta(hours=hours).total_seconds())

    async def login(self, username: str, password: str, device_id: str) -> dict[str, Any]:
        """Authenticate and create a 24h device-bound session."""
        if not self._config_is_ready():
            raise AppAccessError("App access credentials are not configured")

        normalized_username = (username or "").strip()
        normalized_device = self._normalize_device_id(device_id)

        if not hmac.compare_digest(normalized_username, settings.app_access_username):
            raise AppAccessError("Invalid username or password")

        if not self._verify_password(password or ""):
            raise AppAccessError("Invalid username or password")

        ttl_seconds = self._ttl_seconds()
        now = self._now()
        expires_at = now + timedelta(seconds=ttl_seconds)

        lock = await self._cache.get(self._lock_key)
        lock_device = (lock or {}).get("device_id")
        if settings.app_access_single_device and lock_device and lock_device != normalized_device:
            raise AppAccessLockedError("App is already active on another device")

        session_token = secrets.token_urlsafe(48)
        session_key = f"{self._session_prefix}{session_token}"

        await self._cache.setex(
            session_key,
            ttl_seconds,
            value=json.dumps({
                "username": normalized_username,
                "device_id": normalized_device,
                "created_at": now.isoformat(),
                "expires_at": expires_at.isoformat(),
            }),
        )

        await self._cache.set(self._lock_key, {
            "device_id": normalized_device,
            "username": normalized_username,
            "expires_at": expires_at.isoformat(),
        }, expire=ttl_seconds)

        return {
            "session_token": session_token,
            "username": normalized_username,
            "expires_at": expires_at.isoformat(),
            "ttl_seconds": ttl_seconds,
        }

    async def validate_session(self, session_token: str | None, device_id: str | None) -> dict[str, Any]:
        """Validate session token and device binding."""
        if not session_token:
            return {"authenticated": False, "reason": "missing_session"}

        try:
            normalized_device = self._normalize_device_id(device_id)
        except AppAccessError:
            return {"authenticated": False, "reason": "missing_device"}

        session_key = f"{self._session_prefix}{session_token}"
        raw_session = await self._cache.get(session_key)
        if not raw_session:
            return {"authenticated": False, "reason": "expired_or_invalid"}

        session_device = raw_session.get("device_id")
        if session_device != normalized_device:
            return {"authenticated": False, "reason": "device_mismatch"}

        return {
            "authenticated": True,
            "username": raw_session.get("username", "admin"),
            "device_id": session_device,
            "expires_at": raw_session.get("expires_at"),
        }

    async def logout(self, session_token: str | None, device_id: str | None) -> None:
        """Logout current session and release lock for that device."""
        if not session_token:
            return

        session_key = f"{self._session_prefix}{session_token}"
        data = await self._cache.get(session_key)
        await self._cache.delete(session_key)

        if not data:
            return

        lock = await self._cache.get(self._lock_key)
        if not lock:
            return

        if lock.get("device_id") == data.get("device_id"):
            await self._cache.delete(self._lock_key)


app_access_service = AppAccessAuthService()
