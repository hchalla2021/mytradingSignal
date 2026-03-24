import asyncio, json

async def test():
    from services.cache import CacheService
    cache = CacheService()
    await cache.connect()

    for sym in ['NIFTY', 'BANKNIFTY', 'SENSEX']:
        data = await cache.get_market_data(sym)
        if data:
            of = data.get('orderFlow', {})
            price = data.get('price')
            bid = of.get('bid', 0)
            ask = of.get('ask', 0)
            spread = of.get('spread', 0)
            delta = of.get('delta', 0)
            signal = of.get('signal', '-')
            conf = of.get('signalConfidence', 0)
            bidQty = of.get('totalBidQty', 0)
            askQty = of.get('totalAskQty', 0)
            trend = of.get('deltaTrend', '-')
            print(f'{sym}: price={price}, bid={bid}, ask={ask}, spread={spread}, delta={delta}, signal={signal}, conf={conf}, bidQty={bidQty}, askQty={askQty}, trend={trend}')
        else:
            print(f'{sym}: NO DATA in cache')

    await cache.disconnect()

asyncio.run(test())
