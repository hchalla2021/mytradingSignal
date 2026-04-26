"""Main FastAPI application entry point (production safe)."""

import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

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
from routers.expiry_explosion import http_router as expiry_http, ws_router as expiry_ws
from routers.market_edge import http_router as edge_http, ws_router as edge_ws
from routers.candle_intelligence import http_router as candle_intel_http, ws_router as candle_intel_ws
from routers.market_regime import http_router as regime_http, ws_router as regime_ws
from routers.strike_intelligence import http_router as strike_intel_http, ws_router as strike_intel_ws
from routers.chart_intelligence import http_router as chart_intel_http, ws_router as chart_intel_ws

# Windows console fix already applied in config/__init__.py

settings = get_settings()
logger = logging.getLogger("mytradingsignal")

market_feed: MarketFeedService | None = None

# Rate limiter — use a dedicated empty config file so slowapi does not
# re-read backend/.env with platform-default encoding on Windows.
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["60/minute"],
    config_filename=".slowapi.env",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager — ultra-fast startup.

    Strategy: yield ASAP so HTTP requests are accepted immediately.
    Heavy services boot in a background task after yield.
    """
    global market_feed

    print("⚡ FastAPI starting...")

    # ── Quick env validation (sync, instant) ──────────────────────────
    validation_errors = []
    if not settings.zerodha_api_key:
        validation_errors.append("❌ ZERODHA_API_KEY is not set")
    if not settings.zerodha_api_secret:
        validation_errors.append("❌ ZERODHA_API_SECRET is not set")
    if not settings.jwt_secret or settings.jwt_secret == "change-this-in-production":
        validation_errors.append("❌ JWT_SECRET is not set or using default value")
    if not settings.redis_url:
        validation_errors.append("⚠️  REDIS_URL not set — in-memory cache active")
    if validation_errors:
        for error in validation_errors:
            print(f"  {error}")
    else:
        print("✅ Config OK")

    # ── Auth check (sync, instant) ────────────────────────────────────
    auth_state_manager.force_recheck()
    is_auth = auth_state_manager.is_authenticated
    print(f"🔐 Auth: {'✅ Authenticated' if is_auth else '⚠️ Not authenticated — login via UI'}")

    # ── Minimum init: cache + market feed (instant — in-memory cache) ─
    from services.unified_auth_service import unified_auth

    cache = CacheService()
    await cache.connect()
    print("✅ Cache ready")

    from routers import diagnostics as diagnostics_module
    diagnostics_module.set_cache_instance(cache)

    market_feed = MarketFeedService(cache, manager)
    diagnostics_module.set_market_feed_instance(market_feed)

    # Token watcher (file system monitor — instant)
    token_observer = start_token_watcher(market_feed, auth_state_manager)

    # ── Variables shared with shutdown ────────────────────────────────
    scheduler = None
    feed_task = None
    _bg_boot: asyncio.Task | None = None

    async def _boot_services():
        """Boot all heavy services in background AFTER server is accepting requests."""
        nonlocal scheduler, feed_task

        # Auth monitor
        await unified_auth.start_auto_refresh_monitor()

        # Candle backup restoration (non-critical disk I/O)
        try:
            from services.candle_backup_service import CandleBackupService
            await CandleBackupService.restore_all_symbols(cache)
        except Exception:
            pass

        # All services in parallel
        async def start_scheduler():
            nonlocal scheduler, feed_task
            if settings.enable_scheduler:
                from services.market_hours_scheduler import get_scheduler
                scheduler = get_scheduler(market_feed)
                await scheduler.start()
                print("⏰ Scheduler: ON")
            else:
                feed_task = asyncio.create_task(market_feed.start())
                print("🧪 Feed: immediate start")

        async def start_oi_broadcaster():
            try:
                from services.oi_momentum_broadcaster import start_oi_momentum_broadcaster
                await start_oi_momentum_broadcaster()
                print("📊 OI Momentum: ON")
            except Exception as exc:
                logger.error("OI Momentum broadcaster failed to start: %s", exc, exc_info=True)

        async def start_compass():
            try:
                from services.compass_service import get_compass_service
                await get_compass_service().start()
                print("🧭 Compass: ON")
            except Exception as exc:
                logger.error("Compass service failed to start: %s", exc, exc_info=True)

        async def start_liquidity():
            try:
                from services.liquidity_service import get_liquidity_service
                await get_liquidity_service().start()
                print("⚡ Liquidity: ON")
            except Exception as exc:
                logger.error("Liquidity service failed to start: %s", exc, exc_info=True)

        async def start_ict():
            try:
                from services.ict_engine import get_ict_service
                await get_ict_service().start()
                print("🏦 ICT: ON")
            except Exception as exc:
                logger.error("ICT engine failed to start: %s", exc, exc_info=True)

        async def start_expiry_explosion():
            try:
                from services.expiry_explosion_service import get_expiry_explosion_service
                await get_expiry_explosion_service().start()
                print("💥 Expiry Explosion: ON")
            except Exception as exc:
                logger.error("Expiry Explosion service failed to start: %s", exc, exc_info=True)

        async def start_market_edge():
            try:
                from services.market_edge_service import get_market_edge_service
                await get_market_edge_service().start()
                print("📈 MarketEdge: ON")
            except Exception as exc:
                logger.error("MarketEdge service failed to start: %s", exc, exc_info=True)

        async def start_candle_intelligence():
            try:
                from services.candle_intelligence_engine import get_candle_intelligence_service
                await get_candle_intelligence_service().start()
                print("🕯️ Candle Intelligence: ON")
            except Exception as exc:
                logger.error("Candle Intelligence service failed to start: %s", exc, exc_info=True)

        async def start_market_regime():
            try:
                from services.market_regime_service import get_market_regime_service
                await get_market_regime_service().start()
                print("📊 Market Regime: ON")
            except Exception as exc:
                logger.error("Market Regime service failed to start: %s", exc, exc_info=True)

        async def start_strike_intelligence():
            try:
                from services.strike_intelligence_service import get_strike_intelligence_service
                await get_strike_intelligence_service().start()
                print("🎯 Strike Intelligence: ON")
            except Exception as exc:
                logger.error("Strike Intelligence service failed to start: %s", exc, exc_info=True)

        async def start_chart_intelligence():
            try:
                from services.chart_intelligence_service import get_chart_intelligence_service
                await get_chart_intelligence_service().start()
                print("📈 Chart Intelligence: ON")
            except Exception as exc:
                logger.error("Chart Intelligence service failed to start: %s", exc, exc_info=True)

        await asyncio.gather(
            start_scheduler(),
            start_oi_broadcaster(),
            start_compass(),
            start_liquidity(),
            start_ict(),
            start_expiry_explosion(),
            start_market_edge(),
            start_candle_intelligence(),
            start_market_regime(),
            start_strike_intelligence(),
            start_chart_intelligence(),
        )
        print("🚀 All services READY")

    # 🔥 Fire background boot — server starts accepting HTTP immediately
    _bg_boot = asyncio.create_task(_boot_services())

    print("🚀 Backend accepting requests (services booting in background...)")
    yield

    # Shutdown
    print("🛑 Backend shutting down...")

    # Wait for background boot to finish (if still running) before cleanup
    if _bg_boot and not _bg_boot.done():
        try:
            await asyncio.wait_for(_bg_boot, timeout=5)
        except (asyncio.TimeoutError, Exception):
            _bg_boot.cancel()

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

    # Stop Expiry Explosion Service
    try:
        from services.expiry_explosion_service import get_expiry_explosion_service
        await get_expiry_explosion_service().stop()
    except Exception:
        pass

    # Stop MarketEdge Intelligence Service
    try:
        from services.market_edge_service import get_market_edge_service
        await get_market_edge_service().stop()
    except Exception:
        pass

    # Stop Candle Intelligence Engine
    try:
        from services.candle_intelligence_engine import get_candle_intelligence_service
        await get_candle_intelligence_service().stop()
    except Exception:
        pass

    # Stop Market Regime Service
    try:
        from services.market_regime_service import get_market_regime_service
        await get_market_regime_service().stop()
    except Exception:
        pass

    # Stop Strike Intelligence Service
    try:
        from services.strike_intelligence_service import get_strike_intelligence_service
        await get_strike_intelligence_service().stop()
    except Exception:
        pass

    # Stop Chart Intelligence Service
    try:
        from services.chart_intelligence_service import get_chart_intelligence_service
        await get_chart_intelligence_service().stop()
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

# Rate limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS — custom middleware for reliable localhost support
# Production: only the configured domain. Dev: also localhost.
_cors_base = {"https://mydailytradesignals.com"}
if settings.debug:
    _cors_base.update({
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
    })
# Also merge any extra origins from config (includes frontend_url + any CORS_ORIGINS env)
for _o in settings.cors_origins_list:
    _cors_base.add(_o)
_cors_origins = list(_cors_base)
print(f"🔧 CORS origins loaded: {_cors_origins}")


@app.middleware("http")
async def cors_middleware(request: Request, call_next):
    origin = request.headers.get("origin")
    
    # Handle preflight OPTIONS
    if request.method == "OPTIONS" and origin:
        if origin in _cors_origins:
            return JSONResponse(
                content="OK",
                status_code=200,
                headers={
                    "Access-Control-Allow-Origin": origin,
                    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD",
                    "Access-Control-Allow-Headers": request.headers.get("access-control-request-headers", "*"),
                    "Access-Control-Allow-Credentials": "true",
                    "Access-Control-Max-Age": "600",
                },
            )
        else:
            return JSONResponse(content="Disallowed CORS origin", status_code=400)
    
    # Handle simple/actual requests
    response = await call_next(request)
    if origin and origin in _cors_origins:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Vary"] = "Origin"
    return response

# ── Global exception handler — prevents stack trace leaks ────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch unhandled exceptions and return safe JSON response."""
    logger.error("Unhandled error on %s %s: %s", request.method, request.url.path, exc, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
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

# 💥 Expiry Explosion Zone
app.include_router(expiry_ws,   prefix="/ws",  tags=["Expiry Explosion"])
app.include_router(expiry_http, prefix="/api", tags=["Expiry Explosion"])

# 📈 MarketEdge Intelligence
app.include_router(edge_ws,   prefix="/ws",  tags=["MarketEdge"])
app.include_router(edge_http, prefix="/api", tags=["MarketEdge"])

# 🕯️ Candle Intelligence Engine
app.include_router(candle_intel_ws,   prefix="/ws",  tags=["Candle Intelligence"])
app.include_router(candle_intel_http, prefix="/api", tags=["Candle Intelligence"])

# 📊 Market Regime Intelligence
app.include_router(regime_ws,   prefix="/ws",  tags=["Market Regime"])
app.include_router(regime_http, prefix="/api", tags=["Market Regime"])

# 🎯 Strike Intelligence
app.include_router(strike_intel_ws,   prefix="/ws",  tags=["Strike Intelligence"])
app.include_router(strike_intel_http, prefix="/api", tags=["Strike Intelligence"])

# 📈 Chart Intelligence
app.include_router(chart_intel_ws,   prefix="/ws",  tags=["Chart Intelligence"])
app.include_router(chart_intel_http, prefix="/api", tags=["Chart Intelligence"])


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
