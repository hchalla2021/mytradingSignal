"""Lightweight user analytics service.

Tracks login counts, unique visitors, and currently active app users.
All state is in-memory and isolated from trading functionality.
"""

from __future__ import annotations

import asyncio
import hashlib
import re
from datetime import datetime, timezone
from typing import Any


_ID_PATTERN = re.compile(r"[^a-zA-Z0-9._:@-]")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sanitize_identifier(raw_value: str | None, prefix: str) -> str:
    raw = (raw_value or "").strip()
    if not raw:
        return f"{prefix}:unknown"
    cleaned = _ID_PATTERN.sub("", raw)
    if cleaned:
        return cleaned[:96]
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]
    return f"{prefix}:{digest}"


def _display_name(user_name: str | None, user_id: str | None, visitor_id: str) -> str:
    if user_name and user_name.strip():
        return user_name.strip()[:64]
    if user_id and user_id.strip():
        return user_id.strip()[:64]
    if len(visitor_id) > 14:
        return f"guest-{visitor_id[-8:]}"
    return visitor_id


class UserAnalyticsService:
    """In-memory analytics registry for user usage stats."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._login_events = 0
        self._visit_events = 0
        self._logins: dict[str, dict[str, Any]] = {}
        self._users: dict[str, dict[str, Any]] = {}
        self._sessions: dict[str, dict[str, Any]] = {}

    async def register_login(self, user_id: str, user_name: str | None = None) -> None:
        uid = _sanitize_identifier(user_id, "user")
        now = _now_iso()

        async with self._lock:
            self._login_events += 1
            login_entry = self._logins.get(uid)
            if login_entry is None:
                login_entry = {
                    "user_id": uid,
                    "user_name": (user_name or uid)[:64],
                    "login_count": 0,
                    "last_login_at": now,
                }
                self._logins[uid] = login_entry

            login_entry["login_count"] += 1
            login_entry["last_login_at"] = now
            if user_name and user_name.strip():
                login_entry["user_name"] = user_name.strip()[:64]

            combined = self._users.get(uid)
            if combined is None:
                combined = {
                    "id": uid,
                    "display_name": _display_name(user_name, uid, uid),
                    "user_id": uid,
                    "visitor_id": uid,
                    "source": "login",
                    "first_seen_at": now,
                    "last_seen_at": now,
                    "visit_count": 0,
                    "login_count": 0,
                }
                self._users[uid] = combined

            combined["last_seen_at"] = now
            combined["login_count"] = login_entry["login_count"]
            if user_name and user_name.strip():
                combined["display_name"] = user_name.strip()[:64]

    async def register_visit(
        self,
        visitor_id: str,
        user_id: str | None = None,
        user_name: str | None = None,
    ) -> None:
        vid = _sanitize_identifier(visitor_id, "visitor")
        uid = _sanitize_identifier(user_id, "user") if user_id else None
        key = uid or vid
        now = _now_iso()

        async with self._lock:
            self._visit_events += 1
            record = self._users.get(key)
            if record is None:
                record = {
                    "id": key,
                    "display_name": _display_name(user_name, uid, vid),
                    "user_id": uid,
                    "visitor_id": vid,
                    "source": "auth" if uid else "visitor",
                    "first_seen_at": now,
                    "last_seen_at": now,
                    "visit_count": 0,
                    "login_count": self._logins.get(uid, {}).get("login_count", 0) if uid else 0,
                }
                self._users[key] = record

            record["last_seen_at"] = now
            record["visit_count"] += 1
            record["source"] = "auth" if uid else record["source"]
            record["visitor_id"] = vid
            if uid:
                record["user_id"] = uid
                record["login_count"] = self._logins.get(uid, {}).get("login_count", record["login_count"])
            if user_name and user_name.strip():
                record["display_name"] = user_name.strip()[:64]

    async def connect_session(
        self,
        session_id: str,
        visitor_id: str,
        user_id: str | None = None,
        user_name: str | None = None,
    ) -> None:
        sid = _sanitize_identifier(session_id, "session")
        vid = _sanitize_identifier(visitor_id, "visitor")
        uid = _sanitize_identifier(user_id, "user") if user_id else None
        now = _now_iso()

        await self.register_visit(visitor_id=vid, user_id=uid, user_name=user_name)

        async with self._lock:
            self._sessions[sid] = {
                "session_id": sid,
                "visitor_id": vid,
                "user_id": uid,
                "connected_at": now,
                "last_seen_at": now,
            }

    async def disconnect_session(self, session_id: str) -> None:
        sid = _sanitize_identifier(session_id, "session")
        async with self._lock:
            self._sessions.pop(sid, None)

    async def get_summary(self, limit: int = 10) -> dict[str, Any]:
        safe_limit = max(1, min(limit, 50))

        async with self._lock:
            active_identity_ids = {
                session.get("user_id") or session.get("visitor_id")
                for session in self._sessions.values()
                if (session.get("user_id") or session.get("visitor_id"))
            }

            users = []
            for entry in self._users.values():
                user_id = entry.get("user_id")
                identity_key = user_id or entry.get("visitor_id")
                users.append(
                    {
                        "id": entry.get("id"),
                        "display_name": entry.get("display_name"),
                        "user_id": user_id,
                        "source": entry.get("source", "visitor"),
                        "visit_count": entry.get("visit_count", 0),
                        "login_count": entry.get("login_count", 0),
                        "last_seen_at": entry.get("last_seen_at"),
                        "is_active": identity_key in active_identity_ids,
                    }
                )

            users.sort(
                key=lambda item: (
                    item.get("is_active", False),
                    item.get("last_seen_at") or "",
                ),
                reverse=True,
            )

            return {
                "totals": {
                    "logged_in_users": len(self._logins),
                    "login_events": self._login_events,
                    "app_users": len(self._users),
                    "active_users": len(active_identity_ids),
                    "visit_events": self._visit_events,
                },
                "users": users[:safe_limit],
                "generated_at": _now_iso(),
            }


user_analytics = UserAnalyticsService()
