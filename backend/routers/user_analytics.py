"""User analytics API endpoints."""

from fastapi import APIRouter
from pydantic import BaseModel

from services.user_analytics import user_analytics

router = APIRouter()


class VisitPayload(BaseModel):
    """Client visit payload."""

    visitor_id: str
    user_id: str | None = None
    user_name: str | None = None


@router.post("/visit")
async def register_visit(payload: VisitPayload):
    """Register a user visit (best-effort analytics)."""
    await user_analytics.register_visit(
        visitor_id=payload.visitor_id,
        user_id=payload.user_id,
        user_name=payload.user_name,
    )
    return {"ok": True}


@router.get("/summary")
async def analytics_summary(limit: int = 10):
    """Get aggregate and per-user analytics."""
    return await user_analytics.get_summary(limit=limit)
