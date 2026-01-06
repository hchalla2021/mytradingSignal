"""Main FastAPI application entry point."""
# Fix Windows console encoding for emoji characters
import sys
import io
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from services.websocket_manager import manager
from services.market_feed import MarketFeedService
from services.cache import CacheService
from services.token_watcher import start_token_watcher

from routers import auth, market, health, analysis, advanced_analysis, token_status, system_health


settings = get_settings()

# Global services
market_feed: MarketFeedService = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    global market_feed
    
    print("⚡ FastAPI: Starting up (optimized for speed)...")
    
    # 🔥 AUTO-UPDATE FUTURES TOKENS (if needed)
    from services.auto_futures_updater import check_and_update_futures_on_startup
    await check_and_update_futures_on_startup()
    
    # Initialize cache (in-memory, instant)
    cache = CacheService()
    await cache.connect()
    
    # Initialize market feed
    market_feed = MarketFeedService(cache, manager)
    
    # Start token watcher (lightweight file watcher)
    token_observer = start_token_watcher(market_feed)
    
    # 🕐 PRODUCTION: Automatic Market Hours Scheduler
    # Starts feed at 8:50 AM, stops at 3:35 PM IST automatically
    from services.market_hours_scheduler import get_scheduler
    scheduler = get_scheduler(market_feed)
    await scheduler.start()
    
    print("🚀 Backend Ready!")
    print(f"📡 WebSocket: ws://{settings.host}:{settings.port}/ws/market")
    print("⏰ Market Hours Scheduler: ACTIVE (Auto-start/stop)")
    
    yield
    
    # Cleanup
    if scheduler:
        await scheduler.stop()
    if market_feed:
        await market_feed.stop()
    token_observer.stop()
    token_observer.join()
    await cache.disconnect()
    print("👋 Backend shutdown complete")


app = FastAPI(
    title="MyDailyTradingSignals API",
    description="Real-time trading dashboard backend with Zerodha integration",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(health.router, tags=["Health"])
app.include_router(system_health.router, prefix="/api/system", tags=["System Health"])
app.include_router(token_status.router, tags=["Token Status"])
app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])
app.include_router(market.router, prefix="/ws", tags=["Market Data"])
app.include_router(analysis.router, tags=["Analysis"])
app.include_router(advanced_analysis.router, tags=["Advanced Technical Analysis"])


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "name": "MyDailyTradingSignals API",
        "status": "running",
        "version": "1.0.0",
        "features": ["InstantSignal", "PCR Analysis", "Volume Pulse", "Trend Base", "Zone Control"]
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug
    )
