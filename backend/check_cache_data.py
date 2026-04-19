"""Check what's in the cache for candle data."""
import asyncio, json, sys
sys.path.insert(0, ".")
from services.cache import CacheService, _SHARED_CACHE

async def main():
    cache = CacheService()
    
    # Check market data
    for sym in ["NIFTY", "BANKNIFTY", "SENSEX", "INDIAVIX"]:
        data = await cache.get_market_data(sym)
        if data:
            print(f"market:{sym} -> price={data.get('price')}, open={data.get('open')}, "
                  f"high={data.get('high')}, low={data.get('low')}, "
                  f"changePercent={data.get('changePercent')}, ltp={data.get('ltp')}")
        else:
            print(f"market:{sym} -> EMPTY")
    
    print()
    
    # Check candle data
    for sym in ["NIFTY", "BANKNIFTY", "SENSEX"]:
        for tf in ["5m", "15m", "3m"]:
            if tf == "5m":
                key = f"analysis_candles:{sym}"
            elif tf == "15m":
                key = f"analysis_candles_15m:{sym}"
            else:
                key = f"analysis_candles_3m:{sym}"
            
            items = await cache.lrange(key, 0, 99)
            print(f"{key}: {len(items)} candles")
            if items:
                c = items[0]
                if isinstance(c, str):
                    try:
                        c = json.loads(c)
                    except:
                        pass
                print(f"  First: {c}")
                if len(items) > 1:
                    c2 = items[-1]
                    if isinstance(c2, str):
                        try:
                            c2 = json.loads(c2)
                        except:
                            pass
                    print(f"  Last: {c2}")
    
    print()
    
    # Check raw shared cache keys for candles
    candle_keys = [k for k in _SHARED_CACHE.keys() if "candle" in k.lower()]
    print(f"Candle-related keys in _SHARED_CACHE: {candle_keys}")
    
    for key in candle_keys[:3]:
        raw = _SHARED_CACHE[key]
        if isinstance(raw, tuple):
            val, exp = raw
            if isinstance(val, str):
                try:
                    parsed = json.loads(val)
                    if isinstance(parsed, list):
                        print(f"  {key}: list with {len(parsed)} items")
                        if parsed:
                            print(f"    First: {parsed[0]}")
                    else:
                        print(f"  {key}: type={type(parsed).__name__}")
                except:
                    print(f"  {key}: raw string len={len(val)}")
            elif isinstance(val, list):
                print(f"  {key}: list with {len(val)} items")
            else:
                print(f"  {key}: type={type(val).__name__}")
        elif isinstance(raw, list):
            print(f"  {key}: list with {len(raw)} items")
        else:
            print(f"  {key}: type={type(raw).__name__}")

asyncio.run(main())
