"""Quick test script to verify India VIX API endpoint."""
import requests
import json

def test_vix_endpoint():
    """Test the /api/vix endpoint."""
    url = "http://localhost:8000/api/vix"
    
    print("🔍 Testing India VIX API Endpoint")
    print(f"📍 URL: {url}")
    print("-" * 50)
    
    try:
        response = requests.get(url, timeout=5)
        print(f"✅ Response Status: {response.status_code}")
        
        if response.ok:
            data = response.json()
            print(f"\n📊 VIX Data Received:")
            print(json.dumps(data, indent=2))
            
            # Check what we got
            if data.get('value') is None:
                print("\n⚠️  WARNING: value is None")
                print("   This means INDIAVIX is not in the market cache yet.")
                print("   Make sure the market feed has subscribed to INDIAVIX token.")
                print("   Expected token: 256170")
            else:
                print(f"\n✅ VIX Value: {data['value']}")
                print(f"✅ Volatility Level: {data['volatilityLevel']}")
        else:
            print(f"❌ Error: {response.status_code}")
            print(response.text)
            
    except requests.exceptions.ConnectionError:
        print("❌ ERROR: Cannot connect to backend")
        print("   Make sure backend is running at http://localhost:8000")
        print("   Run: python -m uvicorn main:app --reload")
    except Exception as e:
        print(f"❌ ERROR: {type(e).__name__}: {e}")

if __name__ == "__main__":
    try:
        import requests
    except ImportError:
        print("Please install requests: pip install requests")
        exit(1)
    
    test_vix_endpoint()
