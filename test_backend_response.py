import requests
import json

r = requests.get('http://127.0.0.1:8000/api/analysis/oi-momentum/NIFTY', timeout=5)
data = r.json()

print("✓ All fields in response:")
print(json.dumps(data, indent=2))
