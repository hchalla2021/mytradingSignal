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
from services.auth_state_machine import auth_state_manager

from routers import (
    auth,
    market,
    health,
    analysis,
    advanced_analysis,
    token_status,
    system_health,
    pivot_indicators,
    diagnostics,
    market_outlook,
    market_positioning,
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
    
    # 🔒 PRODUCTION VALIDATION (always check)
    print("\n🔍 Running environment checks...")
    
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
        print("\n🚨 CONFIGURATION WARNINGS:")
        for error in validation_errors:
            print(f"   {error}")
        print("\n💡 Set required environment variables before deploying to production")
        print("   See docs/ENVIRONMENT_SETUP.md for details\n")
        # Don't crash - let it start but warn heavily
    else:
        print("✅ Environment configuration valid")
    
    print("\n🚀 Starting services...")

    # 🔐 AUTH STATE MANAGER - Centralized auth (ONLY ONE AUTH SYSTEM)
    print("🔐 Initializing Auth State Manager...")
    
    # Force recheck of token state
    auth_state_manager.force_recheck()
    current_auth_state = auth_state_manager.current_state
    print(f"   Auth Status: {current_auth_state}")
    
    if not auth_state_manager.is_authenticated:
        print("⚠️  WARNING: Zerodha token not authenticated")
        print("   Services will start but may not connect to Zerodha")
        print("   Please login via UI or run: python quick_token_fix.py")
    
    # Start unified auth auto-refresh monitor
    from services.unified_auth_service import unified_auth
    await unified_auth.start_auto_refresh_monitor()
    print("✅ Token expiry monitor started")

    # Auto update futures on startup - DISABLED TO PREVENT STARTUP HANG
    # from services.auto_futures_updater import check_and_update_futures_on_startup
    # await check_and_update_futures_on_startup()
    print("⚠️ Futures auto-update disabled to prevent startup hang")

    # Cache
    cache = CacheService()
    await cache.connect()

    # 🔥 Inject cache into diagnostics module
    from routers import diagnostics as diagnostics_module
    diagnostics_module.set_cache_instance(cache)

    # 🔥 PRODUCTION MARKET FEED: Always use LIVE Zerodha feed
    # If not authenticated, feed won't start but API will serve cached/error data
    # This prevents any mock/test data in production
    print("\n✅ Using LIVE Zerodha Market Feed (Production Mode)")
    if not auth_state_manager.is_authenticated:
        print("   ⚠️  Not authenticated - Feed will not start until you login")
        print("   💡 Click 🔑 LOGIN in the app to authenticate with Zerodha")
    market_feed = MarketFeedService(cache, manager)
    
    # 🔥 Inject market_feed into diagnostics module for force-reconnect endpoint
    diagnostics_module.set_market_feed_instance(market_feed)

    # Token watcher (file system monitor for .env changes)
    token_observer = start_token_watcher(market_feed, auth_state_manager)

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

    # 🚀 Start OI Momentum Live Broadcaster
    try:
        from services.oi_momentum_broadcaster import start_oi_momentum_broadcaster
        await start_oi_momentum_broadcaster()
        print("🚀 OI Momentum Broadcaster: ACTIVE (live mode)")
    except Exception as e:
        print(f"⚠️  OI Momentum Broadcaster init error: {e}")

    print("🚀 Backend READY")
    yield

    # Shutdown
    print("🛑 Backend shutting down...")
    
    # Stop OI Momentum Broadcaster
    try:
        from services.oi_momentum_broadcaster import stop_oi_momentum_broadcaster
        await stop_oi_momentum_broadcaster()
    except:
        pass
    
    # Stop unified auth monitor
    from services.unified_auth_service import unified_auth
    await unified_auth.stop_auto_refresh_monitor()
    
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
app.include_router(diagnostics.router, tags=["Diagnostics"])
app.include_router(token_status.router, tags=["Token Status"])
app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])

# ✅ IMPORTANT: keep WS router clean
app.include_router(market.router, prefix="/ws", tags=["Market Data"])

app.include_router(analysis.router, tags=["Analysis"])
app.include_router(advanced_analysis.router, tags=["Advanced Technical Analysis"])
app.include_router(pivot_indicators.router, tags=["Pivot Indicators"])
app.include_router(market_outlook.router, tags=["Market Outlook"])
app.include_router(market_positioning.router, tags=["Market Positioning"])


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
