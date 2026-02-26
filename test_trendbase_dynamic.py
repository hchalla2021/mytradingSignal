import requests
import json
from datetime import datetime

# Test the dynamic trend-base endpoint
url = "http://localhost:8000/api/advanced/trend-base/NIFTY"

try:
    response = requests.get(url)
    data = response.json()
    
    print(f"\n{'='*70}")
    print(f"Trend Base Endpoint Test - {datetime.now().strftime('%H:%M:%S')}")
    print(f"{'='*70}")
    
    # Extract key info
    print(f"\n📊 NIFTY Trend Base Status:")
    print(f"  Signal: {data.get('signal')}")
    print(f"  Trend: {data.get('trend')}")
    print(f"  Confidence: {data.get('confidence')}%")
    print(f"  Structure Type: {data['structure'].get('type')}")
    print(f"  Integrity Score: {data['structure'].get('integrity_score')}")
    
    print(f"\n💬 Message: {data.get('message')}")
    print(f"📡 Status: {data.get('data_status')}")
    
    # Check if it's using live data
    if data.get('signal') in ['BUY', 'SELL', 'NEUTRAL']:
        if data.get('signal') == 'NEUTRAL':
            print(f"\n✅ SIDEWAYS structure detected (mixed direction)")
        elif data.get('signal') == 'BUY':
            print(f"\n✅ UPTREND structure detected (HIGHER_HIGHS_LOWS)")
        elif data.get('signal') == 'SELL':
            print(f"\n✅ DOWNTREND structure detected (LOWER_HIGHS_LOWS)")
    
    print(f"\n{'='*70}\n")
    
except Exception as e:
    print(f"❌ Error: {e}")
    print(f"Make sure backend is running at http://localhost:8000")
