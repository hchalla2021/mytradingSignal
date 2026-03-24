import asyncio, json, websockets

async def test():
    uri = "ws://localhost:8000/ws/market"
    print(f"Connecting to {uri}...")
    try:
        async with websockets.connect(uri, ping_interval=None) as ws:
            print("Connected!")
            for i in range(3):
                msg = await asyncio.wait_for(ws.recv(), timeout=10)
                data = json.loads(msg)
                print(f"Message {i+1}: type={data.get('type')}, keys={list(data.keys())[:5]}")
                if data.get("type") == "tick":
                    td = data.get("data", {})
                    print(f"  Tick: {td.get('symbol')} price={td.get('price')}")
                elif data.get("type") == "snapshot":
                    symbols = list(data.get("data", {}).keys())
                    print(f"  Snapshot symbols: {symbols}")
            print("Test PASSED - WebSocket is working!")
    except Exception as e:
        print(f"Error: {type(e).__name__}: {e}")

asyncio.run(test())
