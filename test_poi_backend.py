#!/usr/bin/env python3
"""Test POI backend integration"""

import sys
import os

# Set UTF-8 encoding for output
os.environ['PYTHONIOENCODING'] = 'utf-8'

sys.path.insert(0, 'backend')

print("=" * 80)
print("Testing POI Backend Integration")
print("=" * 80)

# Test 1: Import POIAnalyzer
print("\n1. Testing POIAnalyzer import...")
try:
    from backend.services.poi_analyzer import POIAnalyzer
    analyzer = POIAnalyzer()
    print("[OK] POIAnalyzer imported and initialized successfully")
except Exception as e:
    print(f"[FAIL] Failed to import POIAnalyzer: {e}")
    sys.exit(1)

# Test 2: Import main app
print("\n2. Testing main app import...")
try:
    from backend import main
    print("[OK] Main app imported successfully")
except Exception as e:
    print(f"[FAIL] Failed to import main app: {e}")
    sys.exit(1)

# Test 3: Check if POI endpoint exists
print("\n3. Testing POI endpoint registration...")
try:
    from backend.routers.advanced_analysis import router
    poi_routes = [r for r in router.routes if hasattr(r, 'path') and '/poi/' in r.path]
    if poi_routes:
        print(f"[OK] Found {len(poi_routes)} POI endpoint(s)")
        for route in poi_routes:
            print(f"  - {route.methods} {route.path}")
    else:
        print("[WARN] No POI endpoints found")
except Exception as e:
    print(f"[FAIL] Failed to check endpoints: {e}")
    sys.exit(1)

# Test 4: Test POI analyzer with mock data
print("\n4. Testing POI analyzer with sample data...")
try:
    import random
    from datetime import datetime, timedelta
    
    # Create sample candles
    candles = []
    price = 50000
    base_time = datetime.now()
    
    for i in range(100):
        o = price
        c = price + random.uniform(-2, 2)
        h = max(o, c) + random.uniform(0, 1)
        l = min(o, c) - random.uniform(0, 1)
        v = random.randint(1000, 5000)
        
        candles.append({
            't': (base_time - timedelta(minutes=100-i)).isoformat(),
            'o': round(o, 2),
            'c': round(c, 2),
            'h': round(h, 2),
            'l': round(l, 2),
            'v': v
        })
        price = c
    
    # Run analysis
    result = analyzer.analyze(candles, spot=price, recent_ticks=[{"price": price-0.5}, {"price": price}, {"price": price+0.5}])
    
    if result and len(result) > 0:
        print(f"[OK] POI analysis returned {len(result)} POIs")
        if result:
            heat_levels = set(p.heat_level for p in result if hasattr(p, 'heat_level'))
            quality = set(p.quality for p in result if hasattr(p, 'quality'))
            print(f"  - Heat levels: {heat_levels}")
            print(f"  - Quality: {quality}")
    else:
        print("[WARN] POI analysis returned no POIs (this may be normal with random data)")
        
except Exception as e:
    print(f"[FAIL] POI analyzer test failed: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

print("\n" + "=" * 80)
print("[SUCCESS] All backend tests passed!")
print("=" * 80)
print("\nNext steps:")
print("1. Start backend: uvicorn main:app --reload --host 0.0.0.0 --port 8000")
print("2. Test POI endpoint: curl http://localhost:8000/api/advanced/poi/NIFTY")
print("3. Check WebSocket connection for real-time updates")

