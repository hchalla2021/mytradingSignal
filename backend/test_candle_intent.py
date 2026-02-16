import requests
import json

# Test Candle Intent API
print("Testing Candle Intent API...")
print("="*60)

try:
    url = "http://localhost:8000/api/advanced/candle-intent/NIFTY"
    print(f"Testing: {url}")
    
    response = requests.get(url, timeout=15)
    print(f"\n✅ Status Code: {response.status_code}")
    
    data = response.json()
    print(f"\n📊 Response Data:")
    print(json.dumps(data, indent=2))
    
    # Check if values exist
    print(f"\n🔍 Key Values:")
    print(f"Symbol: {data.get('symbol', 'N/A')}")
    print(f"Professional Signal: {data.get('professional_signal', 'N/A')}")
    print(f"Pattern Type: {data.get('pattern', {}).get('type', 'N/A')}")
    print(f"Pattern Intent: {data.get('pattern', {}).get('intent', 'N/A')}")
    print(f"Status: {data.get('status', 'N/A')}")
    
except requests.exceptions.Timeout:
    print(f"❌ Error: Request timed out (15 seconds)")
except requests.exceptions.ConnectionError:
    print(f"❌ Error: Cannot connect to backend server")
except Exception as e:
    print(f"❌ Error: {e}")
