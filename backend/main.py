"""Main FastAPI application entry point (production safe)."""

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
    vix,
)
from routers.compass import http_router as compass_http, ws_router as compass_ws
from routers.liquidity import http_router as liq_http, ws_router as liq_ws
from routers.ict import http_router as ict_http, ws_router as ict_ws

# Windows console fix already applied in config/__init__.py

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

    # 🔄 Restore last market candles from disk (instant OI Momentum on startup)
    try:
        from services.candle_backup_service import CandleBackupService
        await CandleBackupService.restore_all_symbols(cache)
        print("✅ Candle data restored from backup")
    except Exception as e:
        print(f"⚠️  Candle restore skipped: {e}")

    # 🔥 Inject cache into diagnostics module
    from routers import diagnostics as diagnostics_module
    diagnostics_module.set_cache_instance(cache)

    # 🔥 PRODUCTION MARKET FEED: Use MarketFeedService (battle-tested)
    # Order flow analysis is injected into its _update_and_broadcast pipeline
    print("\n✅ Using MarketFeedService with Order Flow Analysis")
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

    # 🧭 Start Institutional Market Compass Service
    try:
        from services.compass_service import get_compass_service
        compass_svc = get_compass_service()
        await compass_svc.start()
        print("🧭 Institutional Market Compass: ACTIVE")
    except Exception as e:
        print(f"⚠️  Compass Service init error: {e}")

    # ⚡ Start Pure Liquidity Intelligence Service
    try:
        from services.liquidity_service import get_liquidity_service
        liq_svc = get_liquidity_service()
        await liq_svc.start()
        print("⚡ Pure Liquidity Intelligence: ACTIVE")
    except Exception as e:
        print(f"⚠️  Liquidity Service init error: {e}")

    # 🏦 Start ICT Smart Money Intelligence Service
    try:
        from services.ict_engine import get_ict_service
        ict_svc = get_ict_service()
        await ict_svc.start()
        print("🏦 ICT Smart Money Intelligence: ACTIVE")
    except Exception as e:
        print(f"⚠️  ICT Service init error: {e}")

    print("🚀 Backend READY")
    yield

    # Shutdown
    print("🛑 Backend shutting down...")

    # 📦 Backup candle data to disk before shutdown
    try:
        from services.candle_backup_service import CandleBackupService
        await CandleBackupService.backup_all_symbols(cache)
        print("✅ Candle data backed up to disk")
    except Exception as e:
        print(f"⚠️  Candle backup on shutdown failed: {e}")
    
    # Stop OI Momentum Broadcaster
    try:
        from services.oi_momentum_broadcaster import stop_oi_momentum_broadcaster
        await stop_oi_momentum_broadcaster()
    except Exception:
        pass

    # Stop Compass Service
    try:
        from services.compass_service import get_compass_service
        await get_compass_service().stop()
    except Exception:
        pass

    # Stop Liquidity Service
    try:
        from services.liquidity_service import get_liquidity_service
        await get_liquidity_service().stop()
    except Exception:
        pass

    # Stop ICT Service
    try:
        from services.ict_engine import get_ict_service
        await get_ict_service().stop()
    except Exception:
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

# CORS — Starlette 0.50+ requires explicit origins (not ["*"]) for preflight to work
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
app.include_router(vix.router, tags=["India VIX"])

# 🧭 Institutional Market Compass
app.include_router(compass_ws,   prefix="/ws",  tags=["Compass"])
app.include_router(compass_http, prefix="/api", tags=["Compass"])

# ⚡ Pure Liquidity Intelligence
app.include_router(liq_ws,   prefix="/ws",  tags=["Liquidity"])
app.include_router(liq_http, prefix="/api", tags=["Liquidity"])

# 🏦 ICT Smart Money Intelligence
app.include_router(ict_ws,   prefix="/ws",  tags=["ICT"])
app.include_router(ict_http, prefix="/api", tags=["ICT"])


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
