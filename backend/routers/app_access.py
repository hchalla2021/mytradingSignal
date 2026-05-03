"""App-level username/password access router."""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Response, Cookie
from pydantic import BaseModel

from config import get_settings
from services.app_access import (
    app_access_service,
    AppAccessError,
    AppAccessLockedError,
)

settings = get_settings()
router = APIRouter()


class AppAccessLoginRequest(BaseModel):
    username: str
    password: str


@router.get("/session")
async def app_access_session(
    x_device_id: str | None = Header(default=None, alias="X-Device-Id"),
    app_access_token: str | None = Cookie(default=None),
):
    """Check whether current device has a valid app-access session."""
    result = await app_access_service.validate_session(
        session_token=app_access_token,
        device_id=x_device_id,
    )
    return result


@router.post("/login")
async def app_access_login(
    payload: AppAccessLoginRequest,
    response: Response,
    x_device_id: str | None = Header(default=None, alias="X-Device-Id"),
):
    """Login with app-level username/password and bind to current device."""
    try:
        data = await app_access_service.login(
            username=payload.username,
            password=payload.password,
            device_id=x_device_id,
        )
    except AppAccessLockedError as exc:
        raise HTTPException(status_code=423, detail=str(exc)) from exc
    except AppAccessError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    cookie_max_age = data["ttl_seconds"]
    response.set_cookie(
        key="app_access_token",
        value=data["session_token"],
        max_age=cookie_max_age,
        expires=cookie_max_age,
        httponly=True,
        secure=not settings.debug,
        samesite="lax",
        path="/",
    )

    return {
        "authenticated": True,
        "username": data["username"],
        "expires_at": data["expires_at"],
        "single_device_lock": settings.app_access_single_device,
    }


@router.post("/logout")
async def app_access_logout(
    response: Response,
    x_device_id: str | None = Header(default=None, alias="X-Device-Id"),
    app_access_token: str | None = Cookie(default=None),
):
    """Logout app-level session for this device."""
    await app_access_service.logout(
        session_token=app_access_token,
        device_id=x_device_id,
    )
    response.delete_cookie("app_access_token", path="/")
    return {"ok": True}
