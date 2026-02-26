import requests
import time

time.sleep(3)

try:
    r = requests.get('http://127.0.0.1:8000/api/analysis/oi-momentum/NIFTY', timeout=5)
    print('✓ Status:', r.status_code)
    data = r.json()
    print(f"Signal: {data.get('final_signal')}, Confidence: {data.get('confidence')}%")
    print(f"Current Price: ₹{data.get('current_price')}")
except Exception as e:
    print(f'✗ Error: {e}')
