import asyncio, json, sys
sys.path.insert(0, '.')

from services.order_flow_analyzer import order_flow_analyzer

async def test():
    # Simulate 5 ticks for BANKNIFTY with varying prices
    prices = [52700, 52710, 52705, 52715, 52720]
    for p in prices:
        tick = {
            "instrument_token": 0,
            "last_price": p,
            "volume_traded": 1000000,
            "oi": 50000,
            "ohlc": {"open": 52650, "high": 52730, "low": 52640, "close": 52680},
            "depth": {},
            "bid": 0,
            "ask": 0,
        }
        result = await order_flow_analyzer.process_zerodha_tick(tick, "BANKNIFTY")
        print(f"process_tick price={p}: signal={result.signal}, delta={result.delta}, bidQty={result.total_bid_qty}, askQty={result.total_ask_qty}")
    
    # Now get_current_metrics
    m = order_flow_analyzer.get_current_metrics("BANKNIFTY")
    print(f"\nget_current_metrics:")
    for k in ['signal', 'signalConfidence', 'totalBidQty', 'totalAskQty', 'delta', 'buyerAggressionRatio']:
        print(f"  {k}: {m.get(k)} (type={type(m.get(k)).__name__})")
    
    # Check if empty
    print(f"\nFull keys: {list(m.keys())}")
    print(f"Empty? {len(m) == 0}")

asyncio.run(test())
