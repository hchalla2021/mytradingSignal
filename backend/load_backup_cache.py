"""
Load last cached market data from backup file into memory cache
This restores the previous session's market data
"""

import asyncio
import json
from pathlib import Path
from services.cache import CacheService

# Load backup data from file
BACKUP_FILE = Path(__file__).parent / "data" / "market_backup.json"


async def load_backup_to_cache():
    """Load backup data from file into cache"""
    print("\n" + "="*80)
    print("📂 LOADING LAST CACHED MARKET DATA FROM BACKUP")
    print("="*80 + "\n")
    
    if not BACKUP_FILE.exists():
        print(f"❌ Backup file not found: {BACKUP_FILE}")
        return False
    
    # Read backup file
    try:
        with open(BACKUP_FILE, 'r') as f:
            backup_data = json.load(f)
        print(f"✅ Loaded backup file with {len(backup_data)} symbols\n")
    except Exception as e:
        print(f"❌ Error reading backup file: {e}")
        return False
    
    # Load into cache
    cache = CacheService()
    await cache.connect()
    
    try:
        for symbol, data in backup_data.items():
            print(f"📊 Restoring {symbol}...")
            print(f"   Price: ₹{data.get('price', 0):,.2f}")
            print(f"   Change: {data.get('changePercent', 0):.2f}%")
            print(f"   Status: {data.get('status', 'UNKNOWN')}")
            print(f"   Analysis: {'✅ Present' if data.get('analysis') else '❌ Missing'}\n")
            
            # Cache the data with 5-minute TTL (300 seconds)
            await cache.set_market_data(symbol, data)
        
        # Verify all data is in cache
        print("✅ VERIFICATION - Data in cache:")
        all_data = await cache.get_all_market_data()
        for symbol, data in all_data.items():
            if data:
                print(f"   ✅ {symbol}: ₹{data.get('price', 0):,.2f}")
            else:
                print(f"   ❌ {symbol}: No data")
        
        print(f"\n{'='*80}")
        print("✅ CACHE RESTORED - REFRESH FRONTEND TO SEE DATA")
        print("="*80 + "\n")
        
        return True
        
    except Exception as e:
        print(f"❌ ERROR loading to cache: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        await cache.disconnect()


if __name__ == "__main__":
    success = asyncio.run(load_backup_to_cache())
    exit(0 if success else 1)
