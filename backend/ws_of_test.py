import asyncio, json, websockets, datetime

async def test():
    uri = "ws://localhost:8000/ws/market"
    print(f"[{datetime.datetime.now().isoformat()}] Connecting to {uri}...")
    try:
        async with websockets.connect(uri, ping_interval=None) as ws:
            print(f"[{datetime.datetime.now().isoformat()}] Connected!")
            count = 0
            while count < 10:
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=15)
                except asyncio.TimeoutError:
                    print(f"[{datetime.datetime.now().isoformat()}] Timeout waiting for message")
                    break
                ts = datetime.datetime.now().isoformat()
                data = json.loads(msg)
                msg_type = data.get("type", "unknown")
                count += 1
                print(f"\n--- Message {count} [{ts}] type={msg_type} keys={list(data.keys())} ---")
                if msg_type == "tick":
                    td = data.get("data", {})
                    symbol = td.get("symbol", "N/A")
                    price = td.get("price", "N/A")
                    of = td.get("orderFlow", {})
                    has_of = bool(of)
                    print(f"  Symbol: {symbol}")
                    print(f"  Price: {price}")
                    print(f"  orderFlow present: {has_of}")
                    if has_of:
                        print(f"    buyerPercent:  {of.get('buyerPercent', 'N/A')}")
                        print(f"    sellerPercent: {of.get('sellerPercent', 'N/A')}")
                        print(f"    delta:         {of.get('delta', 'N/A')}")
                        print(f"    signal:        {of.get('signal', 'N/A')}")
                    else:
                        print(f"  (No orderFlow data in tick)")
                        print(f"  Tick data keys: {list(td.keys())}")
                elif msg_type == "snapshot":
                    snap = data.get("data", {})
                    symbols = list(snap.keys())
                    print(f"  Snapshot symbols ({len(symbols)}): {symbols}")
                    if symbols:
                        first = symbols[0]
                        fd = snap[first]
                        print(f"  Sample [{first}] keys: {list(fd.keys()) if isinstance(fd, dict) else type(fd)}")
                        if isinstance(fd, dict):
                            of = fd.get("orderFlow", {})
                            print(f"  Sample [{first}] orderFlow present: {bool(of)}")
                            if of:
                                print(f"    buyerPercent:  {of.get('buyerPercent', 'N/A')}")
                                print(f"    sellerPercent: {of.get('sellerPercent', 'N/A')}")
                                print(f"    delta:         {of.get('delta', 'N/A')}")
                                print(f"    signal:        {of.get('signal', 'N/A')}")
                else:
                    preview = json.dumps(data, default=str)[:300]
                    print(f"  Preview: {preview}")
            print(f"\n[{datetime.datetime.now().isoformat()}] Done - received {count} messages")
    except Exception as e:
        print(f"[{datetime.datetime.now().isoformat()}] Error: {type(e).__name__}: {e}")

asyncio.run(test())
