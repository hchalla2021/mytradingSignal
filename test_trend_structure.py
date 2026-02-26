import requests
import json
from datetime import datetime

# Test the backend API response
url = "http://localhost:8000/api/analysis/analyze/NIFTY"

try:
    response = requests.get(url)
    data = response.json()
    
    print(f"\n{'='*60}")
    print(f"API Response for NIFTY - {datetime.now().strftime('%H:%M:%S')}")
    print(f"{'='*60}")
    
    # Check if analysis was successful
    if 'signal' in data:
        print(f"✅ Signal: {data.get('signal')}")
        print(f"✅ Confidence: {data.get('confidence', 'N/A')}")
    
    # Check indicators
    indicators = data.get('indicators', {})
    
    # Key fields to check
    print(f"\n📊 Key Indicator Fields:")
    print(f"  Price: ₹{indicators.get('price', 'N/A')}")
    print(f"  EMA 20: {indicators.get('ema_20', 'N/A')}")
    print(f"  EMA 200: {indicators.get('ema_200', 'N/A')}")
    
    # Trend structure fields
    print(f"\n🎯 Trend Structure Fields:")
    trend_structure = indicators.get('trend_structure', 'NOT_FOUND')
    market_structure = indicators.get('market_structure', 'NOT_FOUND')
    swing_pattern = indicators.get('swing_pattern', 'NOT_FOUND')
    structure_confidence = indicators.get('structure_confidence', 'NOT_FOUND')
    
    print(f"  trend_structure: {trend_structure}")
    print(f"  market_structure: {market_structure}")
    print(f"  swing_pattern: {swing_pattern}")
    print(f"  structure_confidence: {structure_confidence}")
    
    # Check if fields exist
    if trend_structure == 'NOT_FOUND':
        print(f"\n⚠️  WARNING: trend_structure field is MISSING from API response!")
        print(f"\n📋 Available indicator fields:")
        for key in sorted(indicators.keys()):
            print(f"    - {key}")
    else:
        print(f"\n✅ trend_structure is being returned correctly!")
    
    print(f"\n{'='*60}\n")

except Exception as e:
    print(f"❌ Error: {e}")
    print(f"Make sure backend is running at http://localhost:8000")
