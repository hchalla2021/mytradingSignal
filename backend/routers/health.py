"""Health check endpoints."""
from fastapi import APIRouter
from datetime import datetime

router = APIRouter()


@router.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "service": "MyDailyTradingSignals API"
    }


@router.get("/health/ready")
async def readiness_check():
    """Readiness check for Kubernetes/Docker."""
    return {
        "ready": True,
        "timestamp": datetime.now().isoformat()
    }
