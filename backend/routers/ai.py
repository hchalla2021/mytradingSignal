"""
AI Analysis Router - REST Endpoints
Get AI predictions and alerts
"""
from fastapi import APIRouter, HTTPException
from typing import Optional

router = APIRouter()

# Will be injected by main.py
ai_scheduler = None


@router.get("/ai/analysis/{symbol}")
async def get_ai_analysis(symbol: str):
    """Get latest AI analysis for a symbol."""
    if not ai_scheduler:
        raise HTTPException(status_code=503, detail="AI engine not initialized")
    
    symbol = symbol.upper()
    if symbol not in ["NIFTY", "BANKNIFTY", "SENSEX"]:
        raise HTTPException(status_code=400, detail="Invalid symbol")
    
    analysis = await ai_scheduler.get_latest_analysis(symbol)
    
    if not analysis:
        raise HTTPException(status_code=404, detail="No analysis available yet")
    
    return analysis


@router.get("/ai/analysis/all")
async def get_all_ai_analysis():
    """Get AI analysis for all symbols."""
    if not ai_scheduler:
        raise HTTPException(status_code=503, detail="AI engine not initialized")
    
    results = {}
    for symbol in ["NIFTY", "BANKNIFTY", "SENSEX"]:
        analysis = await ai_scheduler.get_latest_analysis(symbol)
        if analysis:
            results[symbol] = analysis
    
    return results


@router.get("/ai/status")
async def get_ai_status():
    """Get AI engine status."""
    if not ai_scheduler:
        return {"enabled": False, "message": "AI engine not initialized"}
    
    return {
        "enabled": True,
        "running": ai_scheduler.running,
        "interval_seconds": ai_scheduler.analysis_interval,
        "symbols": ["NIFTY", "BANKNIFTY", "SENSEX"],
        "features": {
            "llm": ai_scheduler.llm_client.model,
            "alerts": ai_scheduler.alert_service.enabled,
        }
    }


def set_ai_scheduler(scheduler):
    """Set AI scheduler instance."""
    global ai_scheduler
    ai_scheduler = scheduler
