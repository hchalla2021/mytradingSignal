import asyncio, json, websockets

async def test():
    uri = "ws://localhost:8000/ws/market"
    print(f"Connecting to {uri}...")
    try:
        async with websockets.connect(uri, ping_interval=None) as ws:
            print("Connected! Listening for 15 messages (60s timeout per msg)...\n")
            for i in range(15):
                msg = await asyncio.wait_for(ws.recv(), timeout=60)
                data = json.loads(msg)
                msg_type = data.get("type")

                if msg_type == "tick":
                    d = data.get("data", {})
                    of = d.get("orderFlow", {})
                    print(f"[Msg {i+1}] TICK")
                    print(f"  symbol:               {d.get('symbol')}")
                    print(f"  signal:               {d.get('signal')}")
                    print(f"  totalBidQty:          {of.get('totalBidQty')}")
                    print(f"  totalAskQty:          {of.get('totalAskQty')}")
                    print(f"  delta:                {of.get('delta')}")
                    print(f"  buyerAggressionRatio: {of.get('buyerAggressionRatio')}")
                    print(flush=True)

                elif msg_type == "snapshot":
                    snap = data.get("data", {})
                    print(f"[Msg {i+1}] SNAPSHOT ({len(snap)} symbols)")
                    for sym, d in snap.items():
                        of = d.get("orderFlow", {})
                        print(f"  {sym}: orderFlow present={bool(of)}, totalBidQty={of.get('totalBidQty')}, totalAskQty={of.get('totalAskQty')}, delta={of.get('delta')}, buyerAggr={of.get('buyerAggressionRatio')}")
                    print(flush=True)

                else:
                    print(f"[Msg {i+1}] TYPE={msg_type}, keys={list(data.keys())}")
                    print(flush=True)

            print("Test COMPLETE - received 15 messages successfully.")
    except asyncio.TimeoutError:
        print(f"TIMEOUT waiting for next message after {i} messages received.")
    except Exception as e:
        print(f"Error: {type(e).__name__}: {e}")

asyncio.run(test())
