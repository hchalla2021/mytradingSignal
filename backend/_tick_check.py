import asyncio

async def check():
    from services.cache import CacheService
    cache = CacheService()
    await cache.connect()
    
    d1 = await cache.get_market_data('NIFTY')
    if d1:
        of1 = d1.get('orderFlow', {})
        print(f'T1: price={d1.get("price")}, ts={d1.get("timestamp")}, status={d1.get("status")}')
        print(f'    buyAggr={of1.get("buyerAggressionRatio")}, sellAggr={of1.get("sellerAggressionRatio")}, delta={of1.get("delta")}, signal={of1.get("signal")}')
    else:
        print('NO DATA')
    
    await asyncio.sleep(3)
    
    d2 = await cache.get_market_data('NIFTY')
    if d2:
        of2 = d2.get('orderFlow', {})
        print(f'T2: price={d2.get("price")}, ts={d2.get("timestamp")}, status={d2.get("status")}')
        print(f'    buyAggr={of2.get("buyerAggressionRatio")}, sellAggr={of2.get("sellerAggressionRatio")}, delta={of2.get("delta")}, signal={of2.get("signal")}')
        
        changed = d1.get('timestamp') != d2.get('timestamp')
        print(f'')
        print(f'TICKS FLOWING: {changed}')
    
    from services.feed_watchdog import feed_watchdog
    m = feed_watchdog.get_health_metrics()
    print(f'WATCHDOG: state={m.get("state")}, healthy={m.get("is_healthy")}, last_tick={m.get("last_tick_seconds_ago")}s ago')
    
    await cache.disconnect()

asyncio.run(check())
