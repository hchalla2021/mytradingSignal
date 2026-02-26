import requests
import json

symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]

for symbol in symbols:
    try:
        r = requests.get(f'http://127.0.0.1:8000/api/advanced/trend-base/{symbol}', timeout=5)
        data = r.json()
        print(f"\n{'='*50}")
        print(f"Symbol: {symbol}")
        print(f"Status Code: {r.status_code}")
        print(f"Response Status: {data.get('status')}")
        print(f"Signal: {data.get('signal')}")
        print(f"Trend: {data.get('trend')}")
        print(f"Confidence: {data.get('confidence')}")
        print(f"Message: {data.get('message', 'N/A')}")
        print(f"Data Status: {data.get('data_status')}")
    except Exception as e:
        print(f"Error for {symbol}: {e}")
