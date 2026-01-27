#!/usr/bin/env python3

import asyncio
from services.market_feed import MarketFeedService
from services.cache import CacheService
from services.websocket_manager import manager

async def force_fetch():
    cache = CacheService()
    await cache.connect()
    feed = MarketFeedService(cache, manager)
    print('=== FORCING DATA FETCH ===')
    success = await feed._fetch_and_cache_last_data()
    print(f'Data fetch result: {success}')
    
    if success:
        nifty_data = await cache.get_market_data('NIFTY')
        banknifty_data = await cache.get_market_data('BANKNIFTY')
        sensex_data = await cache.get_market_data('SENSEX')
        
        if nifty_data:
            print(f'NIFTY cached: {nifty_data["price"]} change={nifty_data["change"]}')
        if banknifty_data:
            print(f'BANKNIFTY cached: {banknifty_data["price"]} change={banknifty_data["change"]}')
        if sensex_data:
            print(f'SENSEX cached: {sensex_data["price"]} change={sensex_data["change"]}')
            
        if not any([nifty_data, banknifty_data, sensex_data]):
            print('❌ No data was cached despite successful fetch')
    else:
        print('❌ Data fetch failed')
    
    await cache.disconnect()

if __name__ == "__main__":
    asyncio.run(force_fetch())