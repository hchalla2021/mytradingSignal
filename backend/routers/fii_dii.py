"""
FII / DII flow router — exposes the real NSE-sourced snapshot.

GET /api/fii-dii          - cached snapshot (5–30 min TTL)
GET /api/fii-dii?force=1  - force re-fetch from NSE
"""

from fastapi import APIRouter, Query

from services.fii_dii_service import fii_dii_service

router = APIRouter()


@router.get("/fii-dii", tags=["FII / DII"])
async def get_fii_dii(force: bool = Query(False, description="Bypass cache and re-fetch from NSE")):
    snap = await fii_dii_service.get_snapshot(force=force)
    return snap
