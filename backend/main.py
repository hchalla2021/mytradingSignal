"""Main FastAPI application entry point."""
# Fix Windows console encoding for emoji characters
import sys
import io
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from services.websocket_manager import manager
from services.market_feed import MarketFeedService
from services.cache import CacheService

# Try to import AI engine (optional - may not be available without openai package)
try:
    from services.ai_engine.scheduler import AIScheduler
    AI_ENGINE_AVAILABLE = True
except ImportError as e:
    print(f"⚠️ AI Engine not available: {e}")
    print("   Backend will run without AI analysis (InstantSignal still works)")
    AIScheduler = None
    AI_ENGINE_AVAILABLE = False

from routers import auth, market, health, analysis, ai as ai_router, buy_on_dip, advanced_analysis


settings = get_settings()

# Global services
market_feed: MarketFeedService = None
ai_scheduler: AIScheduler = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    global market_feed, ai_scheduler
    
    # Initialize cache
    cache = CacheService()
    await cache.connect()
    
    # Initialize market feed
    market_feed = MarketFeedService(cache, manager)
    
    # Initialize AI scheduler with FULL ERROR ISOLATION (only if available)
    if AI_ENGINE_AVAILABLE and AIScheduler:
        try:
            ai_scheduler = AIScheduler(market_feed, cache, manager)
            ai_router.set_ai_scheduler(ai_scheduler)
            print("✅ AI Engine initialized with error isolation")
            print("   - OpenAI errors won't crash backend")
            print("   - Circuit breaker: auto-disable on repeated failures")
            print("   - InstantSignal always works independently")
        except Exception as e:
            print(f"⚠️ AI Engine initialization failed:")
            print(f"   Error: {str(e)}")
            print(f"   Backend continues with InstantSignal only")
            import traceback
            traceback.print_exc()
            ai_scheduler = None
    else:
        print("⚠️ AI Engine not available (OpenAI not installed)")
        print("   Backend running with InstantSignal analysis only")
        print("   To enable: pip install openai")
        ai_scheduler = None
    
    # Start services in background with error isolation
    feed_task = asyncio.create_task(market_feed.start())
    
    # Start AI scheduler if available - WRAPPED TO PREVENT CRASHES
    ai_task = None
    if ai_scheduler:
        try:
            # Wrap AI task to catch all errors
            async def safe_ai_task():
                try:
                    await ai_scheduler.start()
                except Exception as e:
                    print(f"❌ AI Engine crashed (isolated): {str(e)[:100]}")
                    print(f"   Backend continues running normally")
                    print(f"   InstantSignal still working")
                    import traceback
                    traceback.print_exc()
            
            ai_task = asyncio.create_task(safe_ai_task())
            print("🤖 AI Engine: ENABLED (3-min analysis loop)")
            print("   Fully isolated - errors won't crash backend")
        except Exception as e:
            print(f"⚠️ AI Engine start failed: {e}")
    
    print("🚀 MyDailyTradingSignals Backend Started")
    print(f"📡 WebSocket: ws://{settings.host}:{settings.port}/ws/market")
    
    yield
    
    # Cleanup
    if ai_scheduler:
        ai_scheduler.running = False
    if market_feed:
        await market_feed.stop()
    if ai_task:
        ai_task.cancel()
    feed_task.cancel()
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
app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])
app.include_router(market.router, prefix="/ws", tags=["Market Data"])
app.include_router(analysis.router, tags=["Analysis"])
app.include_router(ai_router.router, tags=["AI Engine"])
app.include_router(buy_on_dip.router, tags=["Buy-on-Dip"])
app.include_router(advanced_analysis.router, tags=["Advanced Technical Analysis"])


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "name": "MyDailyTradingSignals API",
        "status": "running",
        "version": "1.0.0",
        "ai_enabled": ai_scheduler is not None
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug
    )
