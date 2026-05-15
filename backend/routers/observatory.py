"""
🔭 Market Intelligence Observatory — REST API Router
====================================================
GET  /api/observatory/snapshot        — today's live strategy signals
GET  /api/observatory/report?days=7   — historical daily reports
GET  /api/observatory/rankings?days=10 — strategy accuracy rankings
GET  /api/observatory/daily/{date}    — one specific day's report
GET  /api/observatory/dates           — list of available report dates
POST /api/observatory/capture         — manually trigger a snapshot
"""
import json
import logging
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from services.observatory_service import get_observatory_service, DATA_DIR

logger = logging.getLogger(__name__)

http_router = APIRouter(prefix="/api/observatory", tags=["Observatory"])


@http_router.get("/snapshot")
async def get_today_snapshot():
    """
    Current day's live strategy signal state.
    Returns all snapshots taken today + the most recent strategy readings.
    """
    svc = get_observatory_service()
    return {
        "success": True,
        "data": svc.get_today_snapshot(),
        "timestamp": datetime.utcnow().isoformat(),
    }


@http_router.get("/report")
async def get_historical_report(days: int = Query(default=7, ge=1, le=30)):
    """Last N days of end-of-day strategy performance reports."""
    svc = get_observatory_service()
    reports = svc.get_historical_reports(days)
    return {
        "success": True,
        "reports": reports,
        "count": len(reports),
        "days_requested": days,
        "timestamp": datetime.utcnow().isoformat(),
    }


@http_router.get("/rankings")
async def get_strategy_rankings(days: int = Query(default=10, ge=1, le=30)):
    """Strategy accuracy rankings over the last N trading days."""
    svc = get_observatory_service()
    data = svc.get_strategy_rankings(days)
    return {
        "success": True,
        "data": data,
        "timestamp": datetime.utcnow().isoformat(),
    }


@http_router.get("/dates")
async def get_available_dates():
    """List all dates for which observatory reports exist."""
    svc = get_observatory_service()
    dates = svc.get_available_dates()
    return {
        "success": True,
        "dates": dates,
        "count": len(dates),
        "timestamp": datetime.utcnow().isoformat(),
    }


@http_router.get("/daily/{report_date}")
async def get_daily_report(report_date: str):
    """
    Retrieve a specific day's full report (JSON + Markdown).
    report_date format: YYYY-MM-DD
    """
    json_path = DATA_DIR / f"{report_date}.json"
    md_path = DATA_DIR / f"{report_date}.md"

    if not json_path.exists():
        raise HTTPException(status_code=404, detail=f"No observatory report found for {report_date}")

    try:
        with open(json_path, encoding="utf-8") as fh:
            report = json.load(fh)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read report: {exc}")

    markdown = ""
    if md_path.exists():
        try:
            with open(md_path, encoding="utf-8") as fh:
                markdown = fh.read()
        except Exception:
            pass

    return {
        "success": True,
        "report": report,
        "markdown": markdown,
        "timestamp": datetime.utcnow().isoformat(),
    }


@http_router.get("/weekly-summary")
async def get_weekly_summary():
    """Return the latest auto-generated weekly Markdown summary."""
    summary_path = DATA_DIR / "WEEKLY_SUMMARY.md"
    if not summary_path.exists():
        return {
            "success": True,
            "markdown": "No weekly summary available yet. Reports are generated at market close (15:31 IST).",
            "timestamp": datetime.utcnow().isoformat(),
        }
    try:
        with open(summary_path, encoding="utf-8") as fh:
            content = fh.read()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {
        "success": True,
        "markdown": content,
        "timestamp": datetime.utcnow().isoformat(),
    }


@http_router.post("/capture")
async def manual_capture():
    """
    Manually trigger a strategy snapshot (useful for testing outside market hours).
    """
    from services.observatory_service import _now_ist
    svc = get_observatory_service()
    await svc._take_snapshot(_now_ist())
    return {
        "success": True,
        "message": "Snapshot captured successfully",
        "snapshot": svc.get_today_snapshot(),
        "timestamp": datetime.utcnow().isoformat(),
    }
