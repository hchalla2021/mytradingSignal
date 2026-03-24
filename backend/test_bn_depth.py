"""Compare BANKNIFTY depth changes tick-by-tick."""
import asyncio, json, websockets

async def test():
    async with websockets.connect("ws://localhost:8000/ws/market", ping_interval=None) as ws:
        bn_ticks = []
        for i in range(30):
            msg = await asyncio.wait_for(ws.recv(), timeout=15)
            data = json.loads(msg)
            if data.get("type") != "tick":
                continue
            td = data["data"]
            if td.get("symbol") != "BANKNIFTY":
                continue
            of = td.get("orderFlow", {})
            bl = of.get("bidLevels", [])
            al = of.get("askLevels", [])
            bn_ticks.append({
                "price": td["price"],
                "bid": of.get("bid", 0),
                "ask": of.get("ask", 0),
                "bl0_price": bl[0]["price"] if bl else 0,
                "bl0_qty": bl[0]["quantity"] if bl else 0,
                "al0_price": al[0]["price"] if al else 0,
                "al0_qty": al[0]["quantity"] if al else 0,
                "totalBid": of.get("totalBidQty", 0),
                "totalAsk": of.get("totalAskQty", 0),
                "buyer": of.get("buyerAggressionRatio", 0),
                "seller": of.get("sellerAggressionRatio", 0),
                "delta": of.get("delta", 0),
                "sig": of.get("signal", "N/A"),
            })
            if len(bn_ticks) >= 6:
                break

        print("BANKNIFTY tick-by-tick depth comparison:")
        print(f"{'Tick':<5} {'Price':>10} {'Bid L1':>10} {'BidQty':>8} {'Ask L1':>10} {'AskQty':>8} {'TotBid':>8} {'TotAsk':>8} {'Buyer%':>7} {'Delta':>8} {'Sig'}")
        for j, t in enumerate(bn_ticks):
            print(f"{j+1:<5} {t['price']:>10.2f} {t['bl0_price']:>10.2f} {t['bl0_qty']:>8} {t['al0_price']:>10.2f} {t['al0_qty']:>8} {t['totalBid']:>8} {t['totalAsk']:>8} {t['buyer']:>6.1%} {t['delta']:>8.0f} {t['sig']}")
        
        # Check what actually changed
        if len(bn_ticks) >= 2:
            changed = {'price': set(), 'bl0_qty': set(), 'al0_qty': set(), 'buyer': set(), 'delta': set()}
            for t in bn_ticks:
                for k in changed:
                    changed[k].add(t[k])
            print(f"\nUnique values across {len(bn_ticks)} ticks:")
            for k, vals in changed.items():
                status = "CHANGING" if len(vals) > 1 else "STATIC!"
                print(f"  {k}: {len(vals)} unique → {status}")

asyncio.run(test())
