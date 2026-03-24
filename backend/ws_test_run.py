import asyncio, json, websockets

async def test():
    uri = "ws://localhost:8000/ws/market"
    print(f"Connecting to {uri}...")
    try:
        async with websockets.connect(uri, ping_interval=None, open_timeout=15) as ws:
            print("Connected!")
            tick_count = 0
            for i in range(5):
                msg = await asyncio.wait_for(ws.recv(), timeout=30)
                data = json.loads(msg)
                msg_type = data.get("type")
                print(f"Message {i+1}: type={msg_type}")
                if msg_type == "tick":
                    td = data.get("data", {})
                    sym = td.get("symbol")
                    price = td.get("price")
                    has_analysis = "YES" if td.get("analysis") else "NO"
                    print(f"  Tick: {sym} price={price} analysis={has_analysis}")
                    tick_count += 1
                elif msg_type == "snapshot":
                    symbols = list(data.get("data", {}).keys())
                    prices = {k: v.get("price") for k, v in data.get("data", {}).items() if v}
                    print(f"  Snapshot symbols: {symbols}, prices: {prices}")
                elif msg_type == "connection_status":
                    mkt = data.get("market_status")
                    qual = data.get("quality")
                    print(f"  Status: market={mkt}, quality={qual}")
                else:
                    print(f"  keys={list(data.keys())[:5]}")

            if tick_count > 0:
                print(f"SUCCESS: Received {tick_count} live ticks!")
            else:
                print("WARNING: No tick messages received (only status/snapshot)")
    except asyncio.TimeoutError:
        print("TIMEOUT: No messages received within 30 seconds")
    except Exception as e:
        print(f"Error: {type(e).__name__}: {e}")

asyncio.run(test())
