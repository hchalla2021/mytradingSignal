import asyncio, websockets, json

async def test():
    async with websockets.connect('ws://127.0.0.1:8000/ws/market', ping_interval=None, close_timeout=5) as ws:
        for i in range(4):
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=5)
                data = json.loads(msg)
                t = data.get('type', '')
                if t == 'snapshot':
                    for sym, tick in data.get('data', {}).items():
                        print(f"{sym}: price={tick.get('price')} vol={tick.get('volume')} oi={tick.get('oi')}")
                elif t == 'tick':
                    d = data.get('data', {})
                    print(f"tick {d.get('symbol')}: price={d.get('price')} vol={d.get('volume')} oi={d.get('oi')}")
            except asyncio.TimeoutError:
                break

asyncio.run(test())
