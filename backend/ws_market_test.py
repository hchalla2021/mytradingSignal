import asyncio, json, websockets

async def test():
    uri = "ws://localhost:8000/ws/market"
    print(f"Connecting to {uri}...")
    try:
        async with websockets.connect(uri, ping_interval=None, open_timeout=15) as ws:
            print("Connected!")
            tick_count = 0
            for i in range(8):
                msg = await asyncio.wait_for(ws.recv(), timeout=30)
                data = json.loads(msg)
                msg_type = data.get("type")
                if msg_type == "tick":
                    td = data.get("data", {})
                    sym = td.get("symbol")
                    price = td.get("price")
                    has_analysis = "YES" if td.get("analysis") else "NO"
                    print(f"TICK: {sym} price={price} analysis={has_analysis}")
                    tick_count += 1
                elif msg_type == "snapshot":
                    symbols = list(data.get("data", {}).keys())
                    prices = {k: round(v.get("price",0),2) for k, v in data.get("data", {}).items() if v}
                    print(f"SNAPSHOT: {prices}")
                elif msg_type == "connection_status":
                    mkt = data.get("market_status")
                    qual = data.get("quality")
                    print(f"STATUS: market={mkt}, quality={qual}")
                else:
                    print(f"{msg_type.upper()}")

            if tick_count > 0:
                print(f"\nSUCCESS: {tick_count} live ticks received!")
            else:
                print("\nWARNING: No tick messages")
    except asyncio.TimeoutError:
        print("TIMEOUT: No messages received")
    except Exception as e:
        print(f"Error: {type(e).__name__}: {e}")

asyncio.run(test())
