"""Main FastAPI application entry point (production safe)."""

import sys
import io
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from services.websocket_manager import manager
from services.market_feed import MarketFeedService
from services.cache import CacheService
from services.token_watcher import start_token_watcher

from routers import (
    auth,
    market,
    health,
    analysis,
    advanced_analysis,
    token_status,
    system_health,
)

# Windows console fix (safe, ignored on Linux)
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

settings = get_settings()

market_feed: MarketFeedService | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager (production safe)."""
    global market_feed

    print("⚡ FastAPI starting...")
    
    # 🔒 PRODUCTION VALIDATION
    if settings.is_production:
        print("\n🔍 Running production environment checks...")
        
        # Check critical environment variables
        validation_errors = []
        
        if not settings.zerodha_api_key:
            validation_errors.append("❌ ZERODHA_API_KEY is not set")
        
        if not settings.zerodha_api_secret:
            validation_errors.append("❌ ZERODHA_API_SECRET is not set")
        
        if not settings.jwt_secret or settings.jwt_secret == "change-this-in-production":
            validation_errors.append("❌ JWT_SECRET is not set or using default value")
        
        if not settings.redis_url:
            validation_errors.append("⚠️  REDIS_URL not set - using in-memory cache (not recommended for production)")
        
        if validation_errors:
            print("\n🚨 PRODUCTION CONFIGURATION ERRORS:")
            for error in validation_errors:
                print(f"   {error}")
            print("\n💡 Set required environment variables before deploying to production")
            print("   See docs/ENVIRONMENT_SETUP.md for details\n")
            # Don't crash in production - let it start but warn heavily
        else:
            print("✅ Production environment configuration valid")
    
    print("\n🚀 Starting services...")

    # Auto update futures on startup
    from services.auto_futures_updater import check_and_update_futures_on_startup
    await check_and_update_futures_on_startup()

    # Cache
    cache = CacheService()
    await cache.connect()

    # Market feed
    market_feed = MarketFeedService(cache, manager)

    # Token watcher
    token_observer = start_token_watcher(market_feed)

    # Scheduler / Feed startup
    scheduler = None
    feed_task = None

    if settings.enable_scheduler:
        from services.market_hours_scheduler import get_scheduler
        scheduler = get_scheduler(market_feed)
        await scheduler.start()
        print("⏰ Market Scheduler: ACTIVE")
    else:
        print("🧪 Scheduler disabled → starting feed immediately")
        feed_task = asyncio.create_task(market_feed.start())

    print("🚀 Backend READY")
    yield

    # Shutdown
    print("🛑 Backend shutting down...")
    if scheduler:
        await scheduler.stop()
    if market_feed:
        await market_feed.stop()
    if feed_task:
        feed_task.cancel()

    token_observer.stop()
    token_observer.join()
    await cache.disconnect()
    print("👋 Shutdown complete")


app = FastAPI(
    title="MyDailyTradingSignals API",
    description="Real-time trading dashboard backend",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(health.router, tags=["Health"])
app.include_router(system_health.router, prefix="/api/system", tags=["System Health"])
app.include_router(token_status.router, tags=["Token Status"])
app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])

# ✅ IMPORTANT: keep WS router clean
app.include_router(market.router, prefix="/ws", tags=["Market Data"])

app.include_router(analysis.router, tags=["Analysis"])
app.include_router(advanced_analysis.router, tags=["Advanced Technical Analysis"])


@app.get("/")
async def root():
    return {
        "name": "MyDailyTradingSignals API",
        "status": "running",
        "version": "1.0.0",
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
        proxy_headers=True,   # ✅ IMPORTANT FOR MOBILE
    )
