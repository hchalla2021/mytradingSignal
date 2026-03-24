import asyncio

async def check():
    from services.cache import CacheService
    from services.feed_watchdog import feed_watchdog
    cache = CacheService()
    await cache.connect()
    
    d1 = await cache.get_market_data("NIFTY")
    t1 = d1.get("timestamp", "") if d1 else ""
    p1 = d1.get("price", 0) if d1 else 0
    
    await asyncio.sleep(3)
    
    d2 = await cache.get_market_data("NIFTY")
    t2 = d2.get("timestamp", "") if d2 else ""
    p2 = d2.get("price", 0) if d2 else 0
    
    print(f"T1: price={p1} ts={t1}")
    print(f"T2: price={p2} ts={t2}")
    print(f"TICKS FLOWING: {t1 != t2}")
    
    m = feed_watchdog.get_health_metrics()
    print(f"WATCHDOG: state={m.get('state')} healthy={m.get('is_healthy')} last_tick={m.get('last_tick_seconds_ago')}s")
    
    await cache.disconnect()

asyncio.run(check())
