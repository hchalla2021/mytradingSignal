import asyncio, json, websockets

async def test():
    uri = "ws://localhost:8000/ws/market"
    async with websockets.connect(uri, ping_interval=None) as ws:
        for i in range(5):
            msg = await asyncio.wait_for(ws.recv(), timeout=15)
            data = json.loads(msg)
            if data.get("type") == "tick":
                of = data.get("data", {}).get("orderFlow", {})
                sym = data.get("data", {}).get("symbol")
                print(f"Tick {sym} orderFlow keys: {list(of.keys())}")
                print(f"  Full orderFlow: {json.dumps(of, indent=2)}")
                break
            elif data.get("type") == "snapshot":
                snap = data.get("data", {})
                for sym, d in snap.items():
                    of = d.get("orderFlow", {})
                    print(f"Snapshot {sym} orderFlow keys: {list(of.keys())}")
                    print(f"  Full orderFlow: {json.dumps(of, indent=2)}")
                    break
                break

asyncio.run(test())
