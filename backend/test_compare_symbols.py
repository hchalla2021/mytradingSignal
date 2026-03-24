"""Compare order flow across NIFTY, BANKNIFTY, SENSEX."""
import asyncio, json, websockets

async def test():
    async with websockets.connect("ws://localhost:8000/ws/market", ping_interval=None) as ws:
        symbols = {}
        for i in range(25):
            msg = await asyncio.wait_for(ws.recv(), timeout=15)
            data = json.loads(msg)
            if data.get("type") != "tick":
                continue
            td = data["data"]
            sym = td.get("symbol", "?")
            of = td.get("orderFlow", {})
            if sym not in symbols:
                symbols[sym] = []
            if len(symbols[sym]) >= 3:
                continue
            symbols[sym].append({
                "price": td.get("price"),
                "sig": of.get("signal", "N/A"),
                "conf": of.get("signalConfidence", 0),
                "buyer": of.get("buyerAggressionRatio", 0),
                "seller": of.get("sellerAggressionRatio", 0),
                "delta": of.get("delta", 0),
                "trend": of.get("deltaTrend", "?"),
                "bidQty": of.get("totalBidQty", 0),
                "askQty": of.get("totalAskQty", 0),
                "bid": of.get("bid", 0),
                "ask": of.get("ask", 0),
                "buyDom": of.get("buyDomination"),
                "sellDom": of.get("sellDomination"),
                "bidLevels": len(of.get("bidLevels", [])),
                "askLevels": len(of.get("askLevels", [])),
                "pred": of.get("fiveMinPrediction", {}).get("direction", "?"),
                "predConf": of.get("fiveMinPrediction", {}).get("confidence", 0),
                "ticks": of.get("fiveMinPrediction", {}).get("tickCount", 0),
                "buyDomPct": of.get("fiveMinPrediction", {}).get("buyDominancePct", 0),
                "sellDomPct": of.get("fiveMinPrediction", {}).get("sellDominancePct", 0),
                "imbalance": of.get("liquidityImbalance", 0),
            })

        for sym in ["NIFTY", "BANKNIFTY", "SENSEX"]:
            ticks = symbols.get(sym, [])
            print(f"\n{'='*70}")
            print(f"  {sym} ({len(ticks)} ticks)")
            print(f"{'='*70}")
            for j, t in enumerate(ticks):
                print(f"  Tick {j+1}: price={t['price']}")
                print(f"    Signal:    {t['sig']} (conf={t['conf']:.0%})")
                print(f"    Buyer:     {t['buyer']:.1%}  Seller: {t['seller']:.1%}")
                print(f"    Delta:     {t['delta']}  Trend: {t['trend']}")
                print(f"    Bid/Ask:   {t['bid']} / {t['ask']}")
                print(f"    BidQty:    {t['bidQty']}  AskQty: {t['askQty']}")
                print(f"    Levels:    {t['bidLevels']}x{t['askLevels']}")
                print(f"    BuyDom:    {t['buyDom']}  SellDom: {t['sellDom']}")
                print(f"    Imbalance: {t['imbalance']:.3f}")
                print(f"    5min:      {t['pred']} conf={t['predConf']:.0%} ticks={t['ticks']}")
                print(f"    BuyDom%:   {t['buyDomPct']}%  SellDom%: {t['sellDomPct']}%")
            
            # Check for changing values
            if len(ticks) >= 2:
                price_change = ticks[-1]["price"] != ticks[0]["price"]
                buyer_change = ticks[-1]["buyer"] != ticks[0]["buyer"]
                delta_change = ticks[-1]["delta"] != ticks[0]["delta"]
                print(f"\n    VALUES CHANGING: price={'YES' if price_change else 'NO'} "
                      f"buyer={'YES' if buyer_change else 'NO'} "
                      f"delta={'YES' if delta_change else 'NO'}")

asyncio.run(test())
