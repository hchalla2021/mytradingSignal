import asyncio, websockets, json

async def test():
    try:
        async with websockets.connect('ws://127.0.0.1:8000/ws/chart-intelligence', ping_interval=None, close_timeout=5) as ws:
            print('Connected to chart intelligence WS')
            for i in range(4):
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=8)
                    data = json.loads(msg)
                    t = data.get('type', 'unknown')
                    print(f'[{t}]')
                    if t in ('snapshot', 'update', 'chart_intel_snapshot', 'chart_intel_update'):
                        payload = data.get('data', {})
                        for sym, sdata in payload.items():
                            candles = sdata.get('candles5m', [])
                            print(f'  {sym}: {len(candles)} candles5m')
                            if candles:
                                print(f'  Last 3:')
                                for c in candles[-3:]:
                                    print(f"    t={c['t'][:16]}  o={c['o']}  c={c['c']}  v={c['v']}")
                    break
                except asyncio.TimeoutError:
                    print('Timeout')
                    break
    except Exception as e:
        print(f'Error: {type(e).__name__}: {e}')

asyncio.run(test())
