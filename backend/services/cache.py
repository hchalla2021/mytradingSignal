"""In-memory cache service for ultra-fast data access."""
import json
from typing import Optional, Dict, Any, List

from config import get_settings

settings = get_settings()

# Shared in-memory cache (module-level singleton)
_SHARED_CACHE: Dict[str, str] = {}
_cache_instance: Optional['CacheService'] = None


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
        print("[OK] In-memory cache initialized")
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
        """Set market data for a symbol with 24-hour backup."""
        # Save to live cache (5 minutes)
        await self.set(f"market:{symbol}", data, expire=300)
        
        # 🔥 SAVE 24-HOUR BACKUP - Persists last market data
        await self.set(f"market_backup:{symbol}", data, expire=86400)
    
    async def get_market_data(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Get market data for a symbol with fallback to backup."""
        # Try live cache first
        data = await self.get(f"market:{symbol}")
        if data:
            return data
        
        # 🔥 FALLBACK TO 24-HOUR BACKUP if live data not available
        backup_data = await self.get(f"market_backup:{symbol}")
        if backup_data:
            # Mark as cached data
            backup_data["_cached"] = True
            backup_data["_cache_message"] = "📊 Last market data (Token may be expired - Click LOGIN)"
            return backup_data
        
        return None
    
    async def get_all_market_data(self) -> Dict[str, Dict[str, Any]]:
        """Get all market data."""
        symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
        result = {}
        for symbol in symbols:
            data = await self.get_market_data(symbol)
            if data:
                result[symbol] = data
        return result
    
    async def setex(self, key: str, expire: int, value: str):
        """Set a value with expiration (Redis-compatible API)."""
        _SHARED_CACHE[key] = value
    
    async def lrange(self, key: str, start: int, end: int) -> List[str]:
        """Get range from list (Redis-compatible API)."""
        # Simple implementation - store as JSON array
        value = _SHARED_CACHE.get(key)
        if value:
            try:
                items = json.loads(value)
                if isinstance(items, list):
                    return items[start:end+1] if end >= 0 else items[start:]
            except:
                pass
        return []
    
    async def lpush(self, key: str, value: str):
        """Push to list (Redis-compatible API)."""
        existing = _SHARED_CACHE.get(key)
        if existing:
            try:
                items = json.loads(existing)
                if isinstance(items, list):
                    items.insert(0, value)
                    _SHARED_CACHE[key] = json.dumps(items)
                    return
            except:
                pass
        _SHARED_CACHE[key] = json.dumps([value])
    
    async def ltrim(self, key: str, start: int, end: int):
        """Trim list (Redis-compatible API)."""
        existing = _SHARED_CACHE.get(key)
        if existing:
            try:
                items = json.loads(existing)
                if isinstance(items, list):
                    _SHARED_CACHE[key] = json.dumps(items[start:end+1] if end >= 0 else items[start:])
            except:
                pass
    
    async def expire(self, key: str, seconds: int):
        """Set expiration (Redis-compatible API) - no-op for in-memory."""
        pass


# Global cache instance getter
async def get_redis() -> CacheService:
    """Get or create cache instance."""
    global _cache_instance
    if _cache_instance is None:
        _cache_instance = CacheService()
        await _cache_instance.connect()
    return _cache_instance
