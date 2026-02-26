import requests
import json
from datetime import datetime

print("\n" + "="*80)
print("TREND BASE DIAGNOSTIC - Comprehensive Analysis")
print("="*80)

# Test 1: Check main analysis endpoint
print("\n[TEST 1] Main Analysis Endpoint (/api/analysis/analyze/NIFTY)")
print("-" * 80)
try:
    response = requests.get("http://localhost:8000/api/analysis/analyze/NIFTY")
    data = response.json()
    indicators = data.get('indicators', {})
    
    print(f"Price: ₹{indicators.get('price', 'N/A')}")
    print(f"EMA 20: {indicators.get('ema_20', 'N/A')}")
    print(f"EMA 200: {indicators.get('ema_200', 'N/A')}")
    print(f"\n🔍 Trend Structure Fields:")
    print(f"  trend_structure: {indicators.get('trend_structure', '❌ MISSING')}")
    print(f"  market_structure: {indicators.get('market_structure', '❌ MISSING')}")
    print(f"  structure_confidence: {indicators.get('structure_confidence', '❌ MISSING')}")
    print(f"  swing_pattern: {indicators.get('swing_pattern', '❌ MISSING')}")
except Exception as e:
    print(f"❌ Error: {e}")

# Test 2: Check trend-base endpoint
print("\n\n[TEST 2] Trend Base Endpoint (/api/advanced/trend-base/NIFTY)")
print("-" * 80)
try:
    response = requests.get("http://localhost:8000/api/advanced/trend-base/NIFTY")
    data = response.json()
    
    print(f"Signal: {data.get('signal', 'N/A')}")
    print(f"Trend: {data.get('trend', 'N/A')}")
    print(f"Confidence: {data.get('confidence', 'N/A')}%")
    print(f"Structure Type: {data['structure'].get('type', 'N/A')}")
    print(f"Integrity Score: {data['structure'].get('integrity_score', 'N/A')}")
except Exception as e:
    print(f"❌ Error: {e}")

# Test 3: Check all three indices
print("\n\n[TEST 3] All Three Indices Status")
print("-" * 80)
for symbol in ['NIFTY', 'BANKNIFTY', 'SENSEX']:
    try:
        response = requests.get(f"http://localhost:8000/api/advanced/trend-base/{symbol}")
        data = response.json()
        signal = data.get('signal', '?')
        confidence = data.get('confidence', '?')
        structure = data['structure'].get('type', '?')
        
        # Map signal to emoji
        emoji = "🟢" if signal == "BUY" else "🔴" if signal == "SELL" else "🟡"
        print(f"{emoji} {symbol:12} → {signal:10} ({confidence}%) [{structure}]")
    except Exception as e:
        print(f"❌ {symbol}: {e}")

print("\n" + "="*80)
print("DIAGNOSTIC COMPLETE")
print("="*80)
print("\n📋 Expected Results:")
print("  • If market is UP: trend_structure should be 'HIGHER_HIGHS_LOWS' (🟢 BUY)")
print("  • If market is DOWN: trend_structure should be 'LOWER_HIGHS_LOWS' (🔴 SELL)")
print("  • If market is MIXED: trend_structure should be 'SIDEWAYS' (🟡 NEW)")
print("\n💡 If all show 'SIDEWAYS' with 54% confidence:")
print("  → Backend code may not have restarted")
print("  → Or market is genuinely in consolidation (no clear trend)")
print("  → Restart backend: cd backend && uvicorn main:app --reload --host 0.0.0.0 --port 8000")
print("\n")
