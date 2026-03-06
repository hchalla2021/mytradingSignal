"""In-memory cache service for ultra-fast data access with TTL support."""
import json
import time
import os
from typing import Optional, Dict, Any, List, Tuple
from pathlib import Path
from datetime import datetime

from config import get_settings
from services.persistent_market_state import PersistentMarketState

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
        """
        Set market data for a symbol with proper TTL.
        Also saves to persistent storage for cross-closure availability.
        """
        # ✅ FIX: 30-second TTL prevents data disappearing during slow tick periods
        # Old 5s TTL caused cache expiry between ticks → frontend showed OFFLINE/CLOSED
        # 30s is safe: data is overwritten on every tick anyway (~every 0.5-2s)
        await self.set(f"market:{symbol}", data, expire=30)
        
        # 🔥 SILENT PERSISTENCE: Save to persistent state WITHOUT disrupting live flow
        # This runs in background - doesn't block market feed
        try:
            PersistentMarketState.save_market_state(symbol, data)
        except Exception as e:
            # Silently catch - don't disrupt market feed on persistence error
            pass
    
    async def get_market_data(self, symbol: str) -> Optional[Dict[str, Any]]:
        """
        Get market data for a symbol with intelligent fallback.
        
        Priority:
        1. Return live real-time data from in-memory cache (if available & fresh)
        2. Return persistent last-known state if live data expired/unavailable
        3. Return None only as last resort
        
        This ensures Live Market Indices always shows last known data 
        across market closures, weekends, holidays.
        """
        # Try to get live data first
        data = await self.get(f"market:{symbol}")
        if data:
            return data
        
        # 🔥 INTELLIGENT FALLBACK: No live data? Use persistent cache
        # This happens when:
        # - Market is closed (no ticks coming in)
        # - Zerodha token expired (WebSocket reconnecting)
        # - First load (data not in memory yet)
        persistent_data = PersistentMarketState.get_last_known_state(symbol)
        if persistent_data:
            return persistent_data
        
        # Last resort: no data available at all
        return None
    
    async def get_all_market_data(self) -> Dict[str, Dict[str, Any]]:
        """
        Get all market data for all symbols with intelligent fallback.
        Uses live data when available, falls back to persistent cache otherwise.
        """
        symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
        result = {}
        for symbol in symbols:
            # This now uses the intelligent fallback logic in get_market_data
            data = await self.get_market_data(symbol)
            if data:
                result[symbol] = data
        return result
    
    def get_persistent_cache_info(self, symbol: str) -> Optional[Dict[str, Any]]:
        """
        Get metadata about the persistent cache for a symbol.
        Useful for debugging / understanding data freshness.
        """
        last_update = PersistentMarketState.get_last_update_time(symbol)
        time_since_update = PersistentMarketState.get_time_since_last_update(symbol)
        
        if last_update is None:
            return None
        
        return {
            'last_update_unix_time': last_update,
            'last_update_datetime': datetime.fromtimestamp(last_update).isoformat(),
            'seconds_since_update': round(time_since_update, 1) if time_since_update else None,
            'minutes_since_update': round((time_since_update or 0) / 60, 1) if time_since_update else None,
            'is_from_persistent_cache': True,
        }
    
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
    
    async def llen(self, key: str) -> int:
        """Get length of list (Redis-compatible API)."""
        cached = _SHARED_CACHE.get(key)
        if cached:
            try:
                value, expire_at = cached
                if time.time() >= expire_at:
                    del _SHARED_CACHE[key]
                    return 0
                items = json.loads(value)
                return len(items) if isinstance(items, list) else 0
            except:
                pass
        return 0
    
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
