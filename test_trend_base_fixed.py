import requests
import time

time.sleep(3)

try:
    for symbol in ["NIFTY", "BANKNIFTY", "SENSEX"]:
        r = requests.get(f'http://127.0.0.1:8000/api/advanced/trend-base/{symbol}', timeout=5)
        data = r.json()
        print(f"\n{symbol}:")
        print(f"  Signal: {data.get('signal')}")
        print(f"  Trend: {data.get('trend')}")
        print(f"  Confidence: {data.get('confidence')}%")
        print(f"  Status: {data.get('status')}")
except Exception as e:
    print(f"Error: {e}")
