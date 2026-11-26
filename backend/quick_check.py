#!/usr/bin/env python3
import requests
market = requests.get('http://localhost:8000/api/system/health/market', timeout=5)
feed = requests.get('http://localhost:8000/api/system/health/feed', timeout=5)
market.raise_for_status()
feed.raise_for_status()
print(f"Market: {market.json().get('phase')}")
print(f"Feed: {feed.json().get('state')}")
print(f"Healthy: {feed.json().get('is_healthy')}")
