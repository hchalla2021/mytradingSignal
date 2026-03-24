import asyncio, json, websockets

async def inspect():
    uri = "ws://localhost:8000/ws/market"
    async with websockets.connect(uri, ping_interval=None) as ws:
        for i in range(4):
            msg = await asyncio.wait_for(ws.recv(), timeout=15)
            data = json.loads(msg)
            mt = data.get("type")
            if mt == "tick":
                td = data.get("data", {})
                print(f"\n=== TICK for {td.get('symbol')} ===")
                for k, v in sorted(td.items()):
                    print(f"  {k}: {v}")
                break
            elif mt == "snapshot":
                snap = data.get("data", {})
                for sym in list(snap.keys())[:1]:
                    print(f"\n=== SNAPSHOT entry for {sym} ===")
                    for k, v in sorted(snap[sym].items()):
                        print(f"  {k}: {v}")

asyncio.run(inspect())
