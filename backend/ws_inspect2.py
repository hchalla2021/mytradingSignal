import asyncio, json, websockets

async def inspect():
    uri = "ws://localhost:8000/ws/market"
    async with websockets.connect(uri, ping_interval=None) as ws:
        for i in range(5):
            msg = await asyncio.wait_for(ws.recv(), timeout=15)
            data = json.loads(msg)
            mt = data.get("type")
            if mt == "tick":
                td = data.get("data", {})
                print("=== TICK ===")
                for k in sorted(td.keys()):
                    print(f"  {k}: {td[k]}")
                break
            elif mt == "snapshot":
                snap = data.get("data", {})
                for sym in list(snap.keys())[:1]:
                    print(f"=== SNAPSHOT for {sym} ===")
                    for k in sorted(snap[sym].keys()):
                        print(f"  {k}: {snap[sym][k]}")

asyncio.run(inspect())
