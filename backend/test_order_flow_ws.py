"""Test WebSocket order flow data is live on every tick."""
import asyncio, json, websockets

async def test():
    uri = "ws://localhost:8000/ws/market"
    print(f"Connecting to {uri}...")
    async with websockets.connect(uri, ping_interval=None) as ws:
        print("Connected!")
        of_count = 0
        for i in range(8):
            msg = await asyncio.wait_for(ws.recv(), timeout=15)
            data = json.loads(msg)
            if data.get("type") == "tick":
                td = data.get("data", {})
                of = td.get("orderFlow", {})
                has_of = bool(of and (of.get("bid", 0) > 0 or of.get("totalBidQty", 0) > 0))
                sig = of.get("signal", "N/A") if of else "N/A"
                conf = of.get("signalConfidence", 0) if of else 0
                buyer = of.get("buyerAggressionRatio", 0) if of else 0
                seller = of.get("sellerAggressionRatio", 0) if of else 0
                pred = of.get("fiveMinPrediction", {}) if of else {}
                pred_dir = pred.get("direction", "N/A")
                pred_conf = pred.get("confidence", 0)
                tick_count = pred.get("tickCount", 0)
                buy_dom = pred.get("buyDominancePct", 0)
                sell_dom = pred.get("sellDominancePct", 0)
                bid = of.get("bid", 0) if of else 0
                ask = of.get("ask", 0) if of else 0
                total_bid = of.get("totalBidQty", 0) if of else 0
                total_ask = of.get("totalAskQty", 0) if of else 0
                bid_levels = of.get("bidLevels", []) if of else []
                ask_levels = of.get("askLevels", []) if of else []
                sym = td.get("symbol", "?")
                price = td.get("price", 0)
                if has_of:
                    of_count += 1
                print(f"Tick {i+1}: {sym} price={price} | OF={'YES' if has_of else 'NO'} sig={sig} conf={conf:.0%} buyer={buyer:.1%} seller={seller:.1%}")
                print(f"  Bid={bid} Ask={ask} BidQty={total_bid} AskQty={total_ask} Levels={len(bid_levels)}x{len(ask_levels)}")
                print(f"  5min: {pred_dir} conf={pred_conf:.0%} ticks={tick_count} buyDom={buy_dom:.1f}% sellDom={sell_dom:.1f}%")
            elif data.get("type") == "snapshot":
                symbols = list(data.get("data", {}).keys())
                print(f"Snapshot: {symbols}")
        print(f"\nOrder flow present: {of_count}/8 ticks")
        print("Test PASSED!" if of_count > 0 else "Test FAILED - no order flow data!")

asyncio.run(test())
