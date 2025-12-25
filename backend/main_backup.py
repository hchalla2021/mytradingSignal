"""Main FastAPI application entry point."""
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from services.websocket_manager import manager
from services.market_feed import MarketFeedService
from services.cache import CacheService
from services.ai_engine.scheduler import AIScheduler
from routers import auth, market, health, analysis, ai as ai_router


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
    
    # Initialize AI scheduler
    ai_scheduler = AIScheduler(cache, manager)
    ai_router.set_ai_scheduler(ai_scheduler)
    
    # Start services in background
    feed_task = asyncio.create_task(market_feed.start())
    ai_task = asyncio.create_task(ai_scheduler.start())
    
    print("🚀 MyDailyTradingSignals Backend Started")
    print(f"📡 WebSocket: ws://{settings.host}:{settings.port}/ws/market")
    print(f"🤖 AI Engine: Enabled (3-min analysis loop)")
    
    yield
    
    # Cleanup
    if ai_scheduler:
        ai_scheduler.running = False
    if market_feed:
        await market_feed.stop()
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
    allow_origins=["*"],
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
