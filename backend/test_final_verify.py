import asyncio, json, websockets

async def test():
    uri = "ws://localhost:8000/ws/market"
    async with websockets.connect(uri, ping_interval=None) as ws:
        bn_values = []
        sx_values = []
        for i in range(15):
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=20)
            except asyncio.TimeoutError:
                print(f"Timeout waiting for msg {i}")
                break
            data = json.loads(msg)
            
            if data.get("type") == "tick":
                td = data.get("data", {})
                sym = td.get("symbol")
                of = td.get("orderFlow", {})
                if sym in ("BANKNIFTY", "SENSEX") and of:
                    entry = {
                        "sym": sym,
                        "bidQty": of.get("totalBidQty"),
                        "askQty": of.get("totalAskQty"),
                        "delta": of.get("delta"),
                        "signal": of.get("signal"),
                        "buyer%": of.get("buyerAggressionRatio"),
                    }
                    if sym == "BANKNIFTY":
                        bn_values.append(entry)
                    else:
                        sx_values.append(entry)
                    print(f"  {sym}: bidQty={entry['bidQty']} askQty={entry['askQty']} delta={entry['delta']} signal={entry['signal']} buyer={entry['buyer%']}")
        
        print(f"\n=== BANKNIFTY ticks: {len(bn_values)} ===")
        for v in bn_values:
            print(f"  bidQty={v['bidQty']} askQty={v['askQty']} delta={v['delta']} signal={v['signal']}")
        if len(bn_values) >= 2:
            bids = [v['bidQty'] for v in bn_values]
            print(f"  CHANGING? bidQty range: {min(bids)} - {max(bids)}, diff={max(bids)-min(bids)}")
        
        print(f"\n=== SENSEX ticks: {len(sx_values)} ===")
        for v in sx_values:
            print(f"  bidQty={v['bidQty']} askQty={v['askQty']} delta={v['delta']} signal={v['signal']}")
        if len(sx_values) >= 2:
            bids = [v['bidQty'] for v in sx_values]
            print(f"  CHANGING? bidQty range: {min(bids)} - {max(bids)}, diff={max(bids)-min(bids)}")

asyncio.run(test())
