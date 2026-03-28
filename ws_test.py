import asyncio, json, websockets
async def test():
    uri = 'ws://localhost:8000/ws/market'
    async with websockets.connect(uri) as ws:
        for i in range(3):
            msg = await asyncio.wait_for(ws.recv(), timeout=10)
            data = json.loads(msg)
            msg_type = data.get('type', 'unknown')
            if msg_type == 'tick':
                tick = data.get('data', {})
                print(f"TICK: {tick.get('symbol')} = {tick.get('price')} (status: {tick.get('status')})")
            elif msg_type == 'snapshot':
                snap = data.get('data', {})
                for sym, d in snap.items():
                    if d: print(f"SNAPSHOT: {sym} = {d.get('price')} (status: {d.get('status')})")
            elif msg_type == 'connection_status':
                print(f"STATUS: {data.get('quality')} - {data.get('message')}")
            else:
                print(f"MSG: {msg_type}")
asyncio.run(test())
