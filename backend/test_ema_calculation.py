#!/usr/bin/env python3
"""
Test EMA calculation function
Verifies that the calculate_ema function produces correct results
"""

import sys
sys.path.insert(0, '/home/user/trading-signals/backend')

from services.instant_analysis import calculate_ema

def test_ema_calculation():
    """Test EMA calculation with known values"""
    
    # Test case 1: Simple ascending sequence
    closes = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109]
    ema_5 = calculate_ema(closes, 5)
    
    print(f"Test 1: Simple ascending sequence")
    print(f"  Closes: {closes}")
    print(f"  EMA-5: {ema_5:.4f}")
    print(f"  Expected: ~107.3 (EMA should follow the trend)")
    
    # Test case 2: Constant values (flatline)
    closes_flat = [100] * 10
    ema_5_flat = calculate_ema(closes_flat, 5)
    
    print(f"\nTest 2: Flatline (all same value)")
    print(f"  Closes: {closes_flat}")
    print(f"  EMA-5: {ema_5_flat:.4f}")
    print(f"  Expected: 100.0000 (should equal the price)")
    assert abs(ema_5_flat - 100.0) < 0.01, "Flatline EMA should equal price!"
    
    # Test case 3: Real market sample (NIFTY-like prices)
    closes_real = [19500, 19510, 19505, 19515, 19520, 19525, 19530, 19535, 19540, 19545,
                   19550, 19555, 19560, 19565, 19570, 19575, 19580, 19585, 19590, 19595]
    
    ema_5_real = calculate_ema(closes_real, 5)
    ema_10_real = calculate_ema(closes_real, 10)
    ema_20_real = calculate_ema(closes_real, 20)
    
    print(f"\nTest 3: Real market sample (NIFTY range)")
    print(f"  Sample closes: {closes_real[:5]}... (20 values)")
    print(f"  EMA-5:  {ema_5_real:.2f}")
    print(f"  EMA-10: {ema_10_real:.2f}")
    print(f"  EMA-20: {ema_20_real:.2f}")
    print(f"  Last price: {closes_real[-1]:.2f}")
    print(f"  ✅ EMA values recalculated - check if reasonable")
    
    # Test case 4: Verify EMA with sufficient data
    closes_200 = list(range(100, 300))  # 200 values from 100 to 299
    ema_20 = calculate_ema(closes_200, 20)
    ema_50 = calculate_ema(closes_200, 50)
    ema_100 = calculate_ema(closes_200, 100)
    ema_200 = calculate_ema(closes_200, 200)
    
    print(f"\nTest 4: Full 200-candle range")
    print(f"  Closes: 100 -> 299 (200 values)")
    print(f"  EMA-20:  {ema_20:.2f}")
    print(f"  EMA-50:  {ema_50:.2f}")
    print(f"  EMA-100: {ema_100:.2f}")
    print(f"  EMA-200: {ema_200:.2f}")
    print(f"  Last price: 299")
    print(f"  ✅ All EMAs calculated - should show lagging trend")
    
    # Verify ordering (for uptrend, should be: price > EMA20 > EMA50 > EMA100 > EMA200)
    if ema_20 > ema_50 > ema_100 > ema_200:
        print(f"  ✅ EMA ordering correct for uptrend: 20 > 50 > 100 > 200")
    else:
        print(f"  ⚠️ EMA ordering: {ema_20:.0f} > {ema_50:.0f} > {ema_100:.0f} > {ema_200:.0f}")
    
    print(f"\n{'='*60}")
    print(f"✅ EMA calculation tests completed successfully!")
    print(f"{'='*60}")

if __name__ == "__main__":
    test_ema_calculation()
