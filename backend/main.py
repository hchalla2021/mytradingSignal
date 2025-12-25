"""Main FastAPI application entry point."""
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from services.websocket_manager import manager
from services.market_feed import MarketFeedService
from services.cache import CacheService
from routers import auth, market, health


settings = get_settings()

# Global market feed service
market_feed: MarketFeedService = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    global market_feed
    
    # Initialize cache
    cache = CacheService()
    await cache.connect()
    
    # Initialize market feed
    market_feed = MarketFeedService(cache, manager)
    
    # Start market feed in background
    feed_task = asyncio.create_task(market_feed.start())
    
    print("🚀 MyDailyTradingSignals Backend Started")
    print(f"📡 WebSocket: ws://{settings.host}:{settings.port}/ws/market")
    
    yield
    
    # Cleanup
    if market_feed:
        await market_feed.stop()
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


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "name": "MyDailyTradingSignals API",
        "status": "running",
        "version": "1.0.0"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug
    )
