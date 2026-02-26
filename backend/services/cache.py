"""In-memory cache service for ultra-fast data access with TTL support."""
import json
import time
import os
from typing import Optional, Dict, Any, List, Tuple
from pathlib import Path

from config import get_settings

settings = get_settings()

# Shared in-memory cache (module-level singleton)
# Format: {key: (value_json, expire_timestamp)}
_SHARED_CACHE: Dict[str, Tuple[str, float]] = {}
_cache_instance: Optional['CacheService'] = None

# Backup file location (persists across restarts)
BACKUP_FILE = Path(__file__).parent.parent / "data" / "market_backup.json"


def _ensure_backup_dir():
    """Ensure the data directory exists."""
    BACKUP_FILE.parent.mkdir(parents=True, exist_ok=True)


def _load_backup_from_file() -> Dict[str, Any]:
    """Load backup data from file on startup."""
    try:
        if BACKUP_FILE.exists():
            with open(BACKUP_FILE, 'r') as f:
                data = json.load(f)
                print(f"✅ Loaded market backup from file: {list(data.keys())}")
                return data
    except Exception as e:
        print(f"⚠️ Could not load backup file: {e}")
    return {}


def _save_backup_to_file(symbol: str, data: Dict[str, Any]):
    """Save backup data to file for persistence."""
    try:
        _ensure_backup_dir()
        # Load existing data
        existing = {}
        if BACKUP_FILE.exists():
            with open(BACKUP_FILE, 'r') as f:
                existing = json.load(f)
        
        # Update with new data
        existing[symbol] = {
            **data,
            '_backup_time': time.time(),
            '_backup_timestamp': time.strftime('%Y-%m-%d %H:%M:%S')
        }
        
        # Save back
        with open(BACKUP_FILE, 'w') as f:
            json.dump(existing, f, indent=2)
        
    except Exception as e:
        print(f"⚠️ Could not save backup to file: {e}")


class CacheService:
    """In-memory cache service for market data with TTL expiration."""
    
    def __init__(self):
        self.connected = True
    
    @property
    def _memory_cache(self) -> Dict[str, Tuple[str, float]]:
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
        """Set a value in cache with TTL expiration."""
        json_value = json.dumps(value)
        expire_at = time.time() + expire
        _SHARED_CACHE[key] = (json_value, expire_at)
    
    async def get(self, key: str) -> Optional[Dict[str, Any]]:
        """Get a value from cache (returns None if expired)."""
        try:
            cached = _SHARED_CACHE.get(key)
            if cached:
                value_json, expire_at = cached
                # Check if expired
                if time.time() < expire_at:
                    return json.loads(value_json)
                else:
                    # Expired - delete from cache
                    del _SHARED_CACHE[key]
                    return None
            return None
        except Exception:
            return None
    
    async def delete(self, key: str):
        """Delete a key from cache."""
        if key in _SHARED_CACHE:
            del _SHARED_CACHE[key]
    
    async def clear_pattern(self, pattern: str):
        """Clear all keys matching pattern (e.g., 'oi_change_*')."""
        keys_to_delete = [k for k in _SHARED_CACHE.keys() if pattern.rstrip('*') in k]
        for key in keys_to_delete:
            del _SHARED_CACHE[key]
        return len(keys_to_delete)
    
    async def set_market_data(self, symbol: str, data: Dict[str, Any]):
        """Set market data for a symbol with proper TTL."""
        # ✅ SIMPLE: Store market data with 5-second TTL
        # NO complex fallback chains or file backups
        # Market data should come from live sources only
        await self.set(f"market:{symbol}", data, expire=5)
    
    async def get_market_data(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Get market data for a symbol - simple, no fallbacks."""
        # ✅ SIMPLE: Only return live cache data
        # If cache is expired, return None (forces fresh fetch from Zerodha)
        data = await self.get(f"market:{symbol}")
        if data:
            return data
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
        expire_at = time.time() + expire
        _SHARED_CACHE[key] = (value, expire_at)
    
    async def lrange(self, key: str, start: int, end: int) -> List[str]:
        """Get range from list (Redis-compatible API)."""
        cached = _SHARED_CACHE.get(key)
        if cached:
            try:
                value, expire_at = cached
                if time.time() >= expire_at:
                    del _SHARED_CACHE[key]
                    return []
                items = json.loads(value)
                if isinstance(items, list):
                    return items[start:end+1] if end >= 0 else items[start:]
            except:
                pass
        return []
    
    async def lpush(self, key: str, value: str):
        """Push to list (Redis-compatible API)."""
        cached = _SHARED_CACHE.get(key)
        expire_at = time.time() + 3600  # Default 1 hour for lists - REFRESH on each push
        if cached:
            try:
                existing_value, existing_expire = cached
                items = json.loads(existing_value)
                if isinstance(items, list):
                    items.insert(0, value)
                    # CRITICAL FIX: Refresh TTL when new data is pushed (was using existing_expire)
                    _SHARED_CACHE[key] = (json.dumps(items), expire_at)  # Refresh TTL
                    return
            except:
                pass
        _SHARED_CACHE[key] = (json.dumps([value]), expire_at)
    
    async def ltrim(self, key: str, start: int, end: int):
        """Trim list (Redis-compatible API)."""
        cached = _SHARED_CACHE.get(key)
        if cached:
            try:
                value, expire_at = cached
                items = json.loads(value)
                if isinstance(items, list):
                    trimmed = items[start:end+1] if end >= 0 else items[start:]
                    _SHARED_CACHE[key] = (json.dumps(trimmed), expire_at)
            except:
                pass
    
    async def expire(self, key: str, seconds: int):
        """Set expiration on existing key (Redis-compatible API)."""
        cached = _SHARED_CACHE.get(key)
        if cached:
            value, _ = cached
            _SHARED_CACHE[key] = (value, time.time() + seconds)


# Global cache instance getter
async def get_redis() -> CacheService:
    """Get or create cache instance."""
    global _cache_instance
    if _cache_instance is None:
        _cache_instance = CacheService()
        await _cache_instance.connect()
    return _cache_instance


def get_cache() -> CacheService:
    """Get cache instance synchronously."""
    global _cache_instance
    if _cache_instance is None:
        _cache_instance = CacheService()
    return _cache_instance
