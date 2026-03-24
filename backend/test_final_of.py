"""Final comprehensive test - verify every order flow value is live and non-zero."""
import asyncio, json, websockets

async def test():
    uri = "ws://localhost:8000/ws/market"
    print("Connecting...")
    async with websockets.connect(uri, ping_interval=None) as ws:
        print("Connected! Collecting ticks...")
        
        seen_symbols = {}
        for i in range(15):
            msg = await asyncio.wait_for(ws.recv(), timeout=15)
            data = json.loads(msg)
            if data.get("type") != "tick":
                continue
            td = data["data"]
            sym = td.get("symbol", "?")
            of = td.get("orderFlow", {})
            if not of or of.get("bid", 0) == 0:
                continue
            
            if sym not in seen_symbols:
                seen_symbols[sym] = 0
            seen_symbols[sym] += 1
            
            # Only show latest for each symbol
            if seen_symbols[sym] > 2:
                continue
            
            pred = of.get("fiveMinPrediction", {})
            analysis = td.get("analysis")
            
            print(f"\n{'='*70}")
            print(f"  {sym} - LIVE ORDER FLOW (tick #{seen_symbols[sym]})")
            print(f"{'='*70}")
            print(f"  Price:       {td.get('price')}")
            print(f"  Signal:      {of.get('signal')} (conf: {of.get('signalConfidence',0):.0%})")
            print(f"  Delta Trend: {of.get('deltaTrend')}")
            print(f"  Bid/Ask:     {of.get('bid')} / {of.get('ask')} (spread: {of.get('spread')})")
            print(f"  Bid Qty:     {of.get('totalBidQty')} ({of.get('totalBidOrders')} orders)")
            print(f"  Ask Qty:     {of.get('totalAskQty')} ({of.get('totalAskOrders')} orders)")
            print(f"  Delta:       {of.get('delta')}")
            print(f"  Buyer %:     {of.get('buyerAggressionRatio',0):.1%}")
            print(f"  Seller %:    {of.get('sellerAggressionRatio',0):.1%}")
            print(f"  Imbalance:   {of.get('liquidityImbalance',0):.3f}")
            print(f"  Buy Domin:   {of.get('buyDomination')}")
            print(f"  Sell Domin:  {of.get('sellDomination')}")
            print(f"  Bid Depth:   {of.get('bidDepth')}")
            print(f"  Ask Depth:   {of.get('askDepth')}")
            
            # Bid/Ask levels
            bid_levels = of.get("bidLevels", [])
            ask_levels = of.get("askLevels", [])
            print(f"  --- Market Depth ({len(bid_levels)} bid x {len(ask_levels)} ask levels) ---")
            for j, bl in enumerate(bid_levels[:3]):
                print(f"    BID L{j+1}: {bl.get('price')} qty={bl.get('quantity')} orders={bl.get('orders')}")
            for j, al in enumerate(ask_levels[:3]):
                print(f"    ASK L{j+1}: {al.get('price')} qty={al.get('quantity')} orders={al.get('orders')}")
            
            # 5-min prediction
            print(f"  --- 5-Min Prediction ---")
            print(f"    Direction:  {pred.get('direction')}")
            print(f"    Confidence: {pred.get('confidence',0):.0%}")
            print(f"    Reasoning:  {pred.get('reasoning')}")
            print(f"    Ticks:      {pred.get('tickCount')}")
            print(f"    Avg Delta:  {pred.get('avgDelta')}")
            print(f"    Buy Dom %:  {pred.get('buyDominancePct')}")
            print(f"    Sell Dom %: {pred.get('sellDominancePct')}")
            
            # Analysis
            if analysis:
                print(f"  --- Analysis ---")
                print(f"    Signal: {analysis.get('signal')} conf={analysis.get('confidence')}")
            
        # Check completeness
        print(f"\n{'='*70}")
        print(f"  SUMMARY")
        print(f"{'='*70}")
        all_ok = True
        for sym in ["NIFTY", "BANKNIFTY", "SENSEX"]:
            count = seen_symbols.get(sym, 0)
            status = "OK" if count > 0 else "MISSING"
            if count == 0:
                all_ok = False
            print(f"  {sym}: {count} ticks with order flow [{status}]")
        
        print(f"\n  RESULT: {'ALL WORKING' if all_ok else 'SOME VALUES MISSING'}")

asyncio.run(test())
