"""Test if InstantSignal.analyze_tick() is working"""
from services.instant_analysis import InstantSignal

print("=" * 60)
print("TESTING INSTANT ANALYSIS MODULE")
print("=" * 60)

# Sample tick data
test_tick = {
    'symbol': 'NIFTY',
    'price': 26000.0,
    'changePercent': 0.5,
    'volume': 1000000,
    'high': 26100,
    'low': 25900,
    'open': 25950,
    'close': 26000,
    'pcr': 1.2,
    'oi': 500000,
    'oi_change': 5.0,
    'trend': 'bullish'
}

print(f"\n📊 Test Tick Data:")
for key, value in test_tick.items():
    print(f"  {key}: {value}")

print(f"\n🔍 Calling InstantSignal.analyze_tick()...")
result = InstantSignal.analyze_tick(test_tick)

if result:
    print(f"\n✅ SUCCESS! Analysis generated")
    print(f"   Keys: {list(result.keys())}")
    print(f"   Signal: {result.get('signal')}")
    print(f"   Confidence: {result.get('confidence')}")
    if 'indicators' in result:
        print(f"   Indicators: {list(result['indicators'].keys())}")
else:
    print(f"\n❌ FAILED! Analysis returned None")

print("\n" + "=" * 60)
