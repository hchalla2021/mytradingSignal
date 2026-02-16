import requests
import json

# Test Zone Control API
print("Testing Zone Control API...")
print("="*60)

try:
    url = "http://localhost:8000/api/advanced/zone-control/NIFTY"
    print(f"Testing: {url}")
    
    response = requests.get(url, timeout=15)
    print(f"\n✅ Status Code: {response.status_code}")
    
    data = response.json()
    print(f"\n📊 Response Data:")
    print(json.dumps(data, indent=2))
    
    # Check if values exist
    print(f"\n🔍 Key Values:")
    print(f"Current Price: ₹{data.get('current_price', 'N/A')}")
    print(f"Breakdown Risk: {data.get('breakdown_risk', 'N/A')}%")
    print(f"Bounce Probability: {data.get('bounce_probability', 'N/A')}%")
    print(f"Zone Strength: {data.get('zone_strength', 'N/A')}")
    print(f"Signal: {data.get('signal', 'N/A')}")
    print(f"Status: {data.get('status', 'N/A')}")
    
except requests.exceptions.Timeout:
    print(f"❌ Error: Request timed out (15 seconds)")
except requests.exceptions.ConnectionError:
    print(f"❌ Error: Cannot connect to backend server")
except Exception as e:
    print(f"❌ Error: {e}")
