import asyncio, json, websockets

async def test():
    uri = "ws://localhost:8000/ws/market"
    print(f"Connecting to {uri}...")
    try:
        async with websockets.connect(uri, ping_interval=None) as ws:
            print("Connected! Listening for 15 messages...\n")
            for i in range(15):
                msg = await asyncio.wait_for(ws.recv(), timeout=15)
                data = json.loads(msg)
                msg_type = data.get("type")

                if msg_type == "tick":
                    d = data.get("data", {})
                    of = d.get("orderFlow", {})
                    print(f"[Msg {i+1}] TICK")
                    print(f"  symbol:              {d.get('symbol')}")
                    print(f"  signal:              {d.get('signal')}")
                    print(f"  totalBidQty:         {of.get('totalBidQty')}")
                    print(f"  totalAskQty:         {of.get('totalAskQty')}")
                    print(f"  delta:               {of.get('delta')}")
                    print(f"  buyerAggressionRatio:{of.get('buyerAggressionRatio')}")
                    print()

                elif msg_type == "snapshot":
                    snap = data.get("data", {})
                    print(f"[Msg {i+1}] SNAPSHOT ({len(snap)} symbols)")
                    for sym, d in snap.items():
                        of = d.get("orderFlow", {})
                        has_of = bool(of)
                        print(f"  {sym}: orderFlow present={has_of}, keys={list(of.keys())}")
                    print()

                else:
                    print(f"[Msg {i+1}] TYPE={msg_type}, keys={list(data.keys())}")
                    print()

            print("Test COMPLETE - received 15 messages successfully.")
    except Exception as e:
        print(f"Error: {type(e).__name__}: {e}")

asyncio.run(test())
