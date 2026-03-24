import asyncio, json, websockets

async def test():
    uri = "ws://127.0.0.1:8000/ws/market"
    print(f"Connecting to {uri}...")
    try:
        async with websockets.connect(uri, ping_interval=None) as ws:
            print("Connected!\n")
            for i in range(8):
                msg = await asyncio.wait_for(ws.recv(), timeout=15)
                data = json.loads(msg)
                msg_type = data.get("type")
                
                if msg_type == "tick":
                    td = data.get("data", {})
                    symbol = td.get("symbol", "?")
                    signal = td.get("signal")
                    totalBidQty = td.get("totalBidQty")
                    delta = td.get("delta")
                    signal_status = "NONE/NULL" if signal is None else f"{signal}"
                    print(f"[Msg {i+1}] TICK: symbol={symbol}, signal={signal_status}, totalBidQty={totalBidQty}, delta={delta}")
                    
                elif msg_type == "snapshot":
                    snap_data = data.get("data", {})
                    print(f"[Msg {i+1}] SNAPSHOT: {len(snap_data)} symbols")
                    for sym, sdata in list(snap_data.items())[:3]:
                        of = sdata.get("orderFlow", {})
                        sig = of.get("signal") if of else None
                        bid = of.get("totalBidQty") if of else None
                        dlt = of.get("delta") if of else None
                        sig_status = "NONE/NULL" if sig is None else f"{sig}"
                        print(f"  {sym}: orderFlow.signal={sig_status}, totalBidQty={bid}, delta={dlt}")
                    
                else:
                    print(f"[Msg {i+1}] {msg_type}: keys={list(data.keys())[:6]}")
            
            print("\n=== Test PASSED - WebSocket is working! ===")
    except Exception as e:
        print(f"Error: {type(e).__name__}: {e}")

asyncio.run(test())
