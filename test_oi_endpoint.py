import requests
import json

try:
    r = requests.get("http://localhost:8000/api/analysis/oi-momentum/NIFTY", timeout=5)
    print(f"Status: {r.status_code}")
    if r.status_code == 200:
        data = r.json()
        print(f"Signal: {data.get('final_signal')}")
        print(f"Confidence: {data.get('confidence')}%")
        print(f"Current Price: {data.get('current_price')}")
    else:
        print(f"Error: {r.text[:200]}")
except Exception as e:
    print(f"Exception: {e}")
