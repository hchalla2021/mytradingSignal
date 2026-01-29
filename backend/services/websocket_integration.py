"""
🔥 PRODUCTION WEBSOCKET INTEGRATION SCRIPT
Switch between old and production WebSocket managers
"""

from services.production_market_feed import ProductionMarketFeedService
from services.market_feed import MarketFeedService
from services.cache import CacheService
from services.websocket_manager import manager
from config import get_settings

settings = get_settings()

def create_production_market_feed():
    """Create production market feed service"""
    cache = CacheService()
    return ProductionMarketFeedService(cache, manager)

def create_legacy_market_feed():
    """Create legacy market feed service"""
    cache = CacheService()
    return MarketFeedService(cache, manager)

# Toggle between production and legacy
USE_PRODUCTION_FEED = getattr(settings, 'use_production_websocket', True)

def get_market_feed_service():
    """Get the appropriate market feed service"""
    if USE_PRODUCTION_FEED:
        print("🔥 Using PRODUCTION WebSocket Manager")
        return create_production_market_feed()
    else:
        print("🧪 Using Legacy WebSocket Manager")
        return create_legacy_market_feed()