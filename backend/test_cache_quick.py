#!/usr/bin/env python3
"""Quick test of cache connection"""
import asyncio
from services.cache import CacheService

async def test():
    c = CacheService()
    print("Connecting to cache...")
    try:
        await c.connect()
        print("✅ Cache connected OK")
        
        # Try to get cache data
        data = await c.get_all_market_data()
        print(f"✅ Got market data: {len(data)} symbols")
        
        await c.disconnect()
        return True
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = asyncio.run(test())
    exit(0 if success else 1)
