#!/usr/bin/env python
"""Quick test of VIX API endpoint."""
import requests
import json
import time
import sys

time.sleep(2)

try:
    url = 'http://localhost:8000/api/vix'
    print(f"Testing: {url}")
    response = requests.get(url, timeout=5)
    print(f"✓ Status: {response.status_code}")
    data = response.json()
    print(f"✓ Response:\n{json.dumps(data, indent=2)}")
    sys.exit(0)
except Exception as e:
    print(f"✗ Error: {type(e).__name__}: {e}")
    sys.exit(1)
