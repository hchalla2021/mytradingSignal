import asyncio, json, websockets

async def test():
    uri = "ws://localhost:8000/ws/market"
    async with websockets.connect(uri, ping_interval=None) as ws:
        for i in range(12):
            msg = await asyncio.wait_for(ws.recv(), timeout=30)
            data = json.loads(msg)
            if data.get("type") == "tick":
                td = data.get("data", {})
                of = td.get("orderFlow")
                if of is None:
                    print(f"Tick {i}: {td.get('symbol')} - NO orderFlow key!")
                elif len(of) == 0:
                    print(f"Tick {i}: {td.get('symbol')} - EMPTY orderFlow dict!")
                else:
                    print(f"Tick {i}: {td.get('symbol')} signal={of.get('signal')} bidQty={of.get('totalBidQty')} delta={of.get('delta')} buyer={of.get('buyerAggressionRatio')}")
            elif data.get("type") == "snapshot":
                snap = data.get("data", {})
                for sym, td in snap.items():
                    of = td.get("orderFlow") if isinstance(td, dict) else None
                    if of:
                        print(f"Snapshot {sym}: signal={of.get('signal')} bidQty={of.get('totalBidQty')} delta={of.get('delta')}")
                    else:
                        print(f"Snapshot {sym}: NO orderFlow")
            else:
                print(f"Msg {i}: type={data.get('type')}")

asyncio.run(test())
