"""Debug order flow window accumulation."""
import asyncio
import sys
sys.path.insert(0, ".")

from services.order_flow_analyzer import order_flow_analyzer
from datetime import datetime
import pytz

IST = pytz.timezone("Asia/Kolkata")

async def main():
    # Simulate 5 ticks for NIFTY
    prices = [23001.0, 23002.0, 23003.0, 23004.0, 23005.0]
    for i, p in enumerate(prices):
        tick = {
            "instrument_token": 0,
            "last_price": p,
            "volume_traded": 100000,
            "oi": 0,
            "ohlc": {"open": 23000, "high": 23010, "low": 22990, "close": 23000},
            "depth": {},
            "bid": 0,
            "ask": 0,
        }
        metrics = await order_flow_analyzer.process_zerodha_tick(tick, "NIFTY")
        print(f"Tick {i+1}: bid={metrics.bid} ask={metrics.ask} delta={metrics.delta} "
              f"buyer={metrics.buyer_aggression:.3f} seller={metrics.seller_aggression:.3f} "
              f"ts={metrics.timestamp}")

    # Now check the window
    window = order_flow_analyzer.windows["NIFTY"]
    print(f"\nWindow metrics count: {len(window.metrics)}")
    print(f"Window tick_count: {window.tick_count}")
    print(f"Window running_delta: {window.running_delta}")
    
    # Check get_metrics_in_window
    in_window = window.get_metrics_in_window()
    print(f"Metrics in window (5min): {len(in_window)}")
    
    if window.metrics:
        first = window.metrics[0]
        last = window.metrics[-1]
        now = datetime.now(IST)
        print(f"First metric ts: {first.timestamp}")
        print(f"Last metric ts: {last.timestamp}")
        print(f"Now: {now}")
        print(f"First is timezone-aware: {first.timestamp.tzinfo is not None}")
        print(f"Now is timezone-aware: {now.tzinfo is not None}")
        # Direct comparison
        from datetime import timedelta
        window_start = now - timedelta(seconds=300)
        print(f"Window start: {window_start}")
        print(f"First >= window_start: {first.timestamp >= window_start}")
    
    # Get full prediction
    prediction = window.get_5min_prediction()
    print(f"\n5min prediction: {prediction}")
    
    # Get current metrics
    current = order_flow_analyzer.get_current_metrics("NIFTY")
    print(f"\nCurrent metrics fiveMinPrediction: {current.get('fiveMinPrediction')}")

asyncio.run(main())
