"""Test order flow window accumulation over time."""
import asyncio, json, websockets

async def test():
    uri = "ws://localhost:8000/ws/market"
    print(f"Connecting to {uri}...")
    async with websockets.connect(uri, ping_interval=None) as ws:
        print("Connected! Waiting for ticks to accumulate...")
        nifty_ticks = 0
        for i in range(20):
            msg = await asyncio.wait_for(ws.recv(), timeout=15)
            data = json.loads(msg)
            if data.get("type") == "tick":
                td = data.get("data", {})
                sym = td.get("symbol", "?")
                of = td.get("orderFlow", {})
                pred = of.get("fiveMinPrediction", {})
                tick_count = pred.get("tickCount", -1)
                buy_dom = pred.get("buyDominancePct", -1)
                sell_dom = pred.get("sellDominancePct", -1)
                buyer = of.get("buyerAggressionRatio", 0)
                seller = of.get("sellerAggressionRatio", 0)
                sig = of.get("signal", "N/A")
                conf = of.get("signalConfidence", 0)
                if sym == "NIFTY":
                    nifty_ticks += 1
                    print(f"NIFTY #{nifty_ticks}: sig={sig} conf={conf:.0%} "
                          f"buyer={buyer:.1%} seller={seller:.1%} "
                          f"5min_ticks={tick_count} buyDom={buy_dom}% sellDom={sell_dom}%")
                elif i < 5:  # Show a few others too
                    print(f"{sym}: sig={sig} conf={conf:.0%} 5min_ticks={tick_count}")
        
        print(f"\nTotal NIFTY ticks seen: {nifty_ticks}")
        # Check last prediction has accumulated
        if tick_count > 0:
            print("5-min prediction ACCUMULATING")
        else:
            print("5-min prediction still showing 0 ticks")

asyncio.run(test())
