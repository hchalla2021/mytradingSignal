import asyncio, websockets, json

async def test():
    try:
        async with websockets.connect('ws://127.0.0.1:8000/ws/market', ping_interval=None, close_timeout=5) as ws:
            print('Connected!')
            for i in range(5):
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=5)
                    data = json.loads(msg)
                    t = data.get('type', 'unknown')
                    if t == 'snapshot':
                        payload = data.get('data', {})
                        for sym, tick in payload.items():
                            price = tick.get('price')
                            status = tick.get('status')
                            chg = tick.get('changePercent')
                            trend = tick.get('trend')
                            ts = tick.get('timestamp')
                            print(f"  {sym}: price={price}, status={status}, change={chg}%, trend={trend}, ts={ts}")
                    elif t == 'tick':
                        d = data.get('data', {})
                        print(f"  tick -> {d.get('symbol')}: price={d.get('price')}, status={d.get('status')}")
                    else:
                        print(f"  [{t}]")
                except asyncio.TimeoutError:
                    print('No more messages (timeout)')
                    break
    except Exception as e:
        print(f'Error: {e}')

asyncio.run(test())
