"""In-memory cache service for ultra-fast data access."""
import json
from typing import Optional, Dict, Any

from config import get_settings

settings = get_settings()

# Shared in-memory cache (module-level singleton)
_SHARED_CACHE: Dict[str, str] = {}


class CacheService:
    """In-memory cache service for market data."""
    
    def __init__(self):
        self.connected = True
    
    @property
    def _memory_cache(self) -> Dict[str, str]:
        """Access the shared cache."""
        return _SHARED_CACHE
    
    async def connect(self):
        """Initialize cache."""
        print("✅ In-memory cache initialized")
        self.connected = True
    
    async def disconnect(self):
        """Disconnect (don't clear shared cache)."""
        print("🔌 Cache connection closed")
    
    async def set(self, key: str, value: Dict[str, Any], expire: int = 60):
        """Set a value in cache."""
        json_value = json.dumps(value)
        _SHARED_CACHE[key] = json_value
    
    async def get(self, key: str) -> Optional[Dict[str, Any]]:
        """Get a value from cache."""
        try:
            value = _SHARED_CACHE.get(key)
            if value:
                return json.loads(value)
            return None
        except Exception:
            return None
    
    async def set_market_data(self, symbol: str, data: Dict[str, Any]):
        """Set market data for a symbol."""
        await self.set(f"market:{symbol}", data, expire=300)
    
    async def get_market_data(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Get market data for a symbol."""
        return await self.get(f"market:{symbol}")
    
    async def get_all_market_data(self) -> Dict[str, Dict[str, Any]]:
        """Get all market data."""
        symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
        result = {}
        for symbol in symbols:
            data = await self.get_market_data(symbol)
            if data:
                result[symbol] = data
        return result
